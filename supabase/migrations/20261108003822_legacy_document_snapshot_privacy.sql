-- Historical bearer links may read only the customer-facing data stored when
-- they were created. Never fill missing history from a possibly reassigned or
-- edited live document, customer, company, or service location.
create or replace function private.freeze_legacy_document_version(p_business uuid,p_kind text,p_document uuid,p_snapshot jsonb,p_created timestamptz,p_deadline timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare snap jsonb; version_id uuid:=gen_random_uuid(); revision integer;
begin
  if p_business is null or p_document is null or p_kind is null or p_kind not in ('invoice','estimate','change_order')
    or p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object'
    or jsonb_typeof(p_snapshot->'items') is distinct from 'array'
    or jsonb_array_length(p_snapshot->'items')=0 then
    raise exception 'LEGACY_DOCUMENT_SNAPSHOT_UNAVAILABLE' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('document-version:'||p_business::text||':'||p_kind||':'||p_document::text,0));
  -- Older approval receipts stored scope and totals, but did not always store
  -- issuer/customer identities. Keep unavailable fields blank rather than
  -- inventing history from the current tenant records.
  snap:=p_snapshot||jsonb_build_object(
    'kind',p_kind,'document_id',p_document,
    'company',case when jsonb_typeof(p_snapshot->'company')='object' then p_snapshot->'company' else '{}'::jsonb end,
    'customer',case when jsonb_typeof(p_snapshot->'customer')='object' then p_snapshot->'customer' else '{}'::jsonb end,
    'currency',coalesce(nullif(p_snapshot->>'currency',''),'USD'));
  select coalesce(max(revision_number),0)+1 into revision from private.document_versions
    where business_id=p_business and kind=p_kind and document_id=p_document;
  snap:=snap||jsonb_build_object('schema_version',1,'revision_id',version_id,'revision_number',revision,
    'revision_created_at',p_created,'legacy_snapshot',true);
  insert into private.document_versions(id,business_id,kind,document_id,revision_number,snapshot,snapshot_hash,created_at,action_expires_at,superseded_at)
  values(version_id,p_business,p_kind,p_document,revision,snap,
    encode(sha256(convert_to(private.document_version_body(snap)::text,'UTF8')),'hex'),p_created,p_deadline,now());
  return version_id;
end $$;
revoke all on function private.freeze_legacy_document_version(uuid,text,uuid,jsonb,timestamptz,timestamptz) from public,anon,authenticated,service_role;

create or replace function public.get_document_pdf_version(p_token text,p_token_type text default 'document_share') returns jsonb
language plpgsql security definer set search_path='' as $$
declare share private.document_shares%rowtype; link public.document_approval_links%rowtype; version private.document_versions%rowtype;
  version_id uuid; snapshot jsonb; b uuid; k text; d uuid; hash text; receipt jsonb;
begin
  if p_token is null or length(p_token)<32 or length(p_token)>200 then raise exception 'Link unavailable' using errcode='42501';end if;
  hash:=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  if p_token_type='document_share' then
    select * into share from private.document_shares where token_hash=hash and revoked_at is null for update;
    if not found then raise exception 'Link unavailable' using errcode='42501';end if;
    b:=share.business_id;k:=share.kind;d:=share.document_id;version_id:=coalesce(share.revision_id,share.legacy_pdf_version_id);
    if version_id is null then
      version_id:=private.freeze_legacy_document_version(b,k,d,share.snapshot,share.created_at,share.expires_at);
      update private.document_shares set legacy_pdf_version_id=version_id where token_hash=hash;
    end if;
  elsif p_token_type='approval' then
    select * into link from public.document_approval_links where token_hash=hash for update;
    if not found or (link.revoked_at is not null and not exists(select 1 from public.document_approvals where approval_link_id=link.id)) then raise exception 'Link unavailable' using errcode='42501';end if;
    b:=link.business_id;k:=link.document_type;d:=coalesce(link.estimate_id,link.change_order_id);version_id:=coalesce(link.document_version_id,link.legacy_pdf_version_id);
    if version_id is null then
      select document_snapshot into receipt from public.document_approvals where approval_link_id=link.id;
      if receipt is null then
        select s.snapshot into receipt from private.document_shares s
          where s.business_id=b and s.kind=k and s.document_id=d and s.approval_token=p_token and s.revoked_at is null
          order by s.created_at desc limit 1;
      end if;
      version_id:=private.freeze_legacy_document_version(b,k,d,receipt,link.created_at,link.expires_at);
      update public.document_approval_links set legacy_pdf_version_id=version_id where id=link.id;
    end if;
  else raise exception 'Invalid token type' using errcode='22023';end if;
  select * into version from private.document_versions where id=version_id;
  if not found or version.business_id is distinct from b or version.kind is distinct from k or version.document_id is distinct from d then
    raise exception 'Document version unavailable' using errcode='42501';end if;
  return jsonb_build_object('version_id',version.id,'business_id',b,'kind',k,'document_id',d,'snapshot',version.snapshot);
end $$;
revoke all on function public.get_document_pdf_version(text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_document_pdf_version(text,text) to anon,authenticated,service_role;

-- A changed document must not disclose another customer's current financial
-- progress through an old bearer URL. Legacy snapshots have no canonical
-- customer identity, so they retain their recorded values without live money.
-- Preserve the existing function identity so previously prepared RPC plans and
-- other stored dependencies also execute the new privacy gate.
do $$
declare definition text; helper text;
begin
  definition:=pg_get_functiondef('private.document_share_context(text)'::regprocedure);
  helper:=replace(definition,'FUNCTION private.document_share_context(','FUNCTION private.document_share_context_before_privacy(');
  if helper=definition then raise exception 'DOCUMENT_CONTEXT_PRIVACY_PATCH_TARGET_MISSING';end if;
  execute helper;
end $$;
revoke all on function private.document_share_context_before_privacy(text) from public,anon,authenticated,service_role;
create or replace function private.document_share_context(p_token_hash text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare context jsonb; version private.document_versions%rowtype; changed boolean;
begin
  context:=private.document_share_context_before_privacy(p_token_hash);
  changed:=coalesce((context->>'superseded')::boolean,false);
  if context->>'revision_id' is not null and context->>'action_state'<>'unavailable' then
    select * into version from private.document_versions where id=(context->>'revision_id')::uuid;
    changed:=changed or version.id is null or version.snapshot_hash is distinct from encode(sha256(convert_to(
      private.document_version_body(private.customer_document_snapshot((context->>'business_id')::uuid,context->>'kind',(context->>'document_id')::uuid))::text,'UTF8')),'hex');
  end if;
  if context->>'revision_id' is null or changed or context->>'action_state'='unavailable' then
    context:=context||jsonb_build_object(
      'live_status',context#>'{snapshot,status}',
      'amount_paid',context#>'{snapshot,amount_paid}',
      'balance_due',context#>'{snapshot,balance_due}');
  end if;
  if changed then
    context:=context||jsonb_build_object('superseded',true,'approval_token',null);
    if context->>'completed' is null then
      context:=context||jsonb_build_object('action_state','superseded','action_reason','The document changed or a newer version was issued. This copy is read only.');
    end if;
  elsif context->>'revision_id' is null and context->>'kind'='invoice' then
    context:=context||jsonb_build_object('action_state','read_only','action_reason','This older invoice copy preserves its recorded values. Contact the business for current payment status.');
  end if;
  return context;
end $$;
revoke all on function private.document_share_context(text) from public,anon,authenticated,service_role;
grant execute on function private.document_share_context(text) to service_role;

-- Existing enriched legacy artifacts are not reliable historical evidence.
-- Retire their public mappings without modifying immutable snapshots or issued
-- canonical versions. A subsequent authorized token read freezes safe history.
update private.document_versions set superseded_at=now()
where snapshot->>'legacy_snapshot'='true' and superseded_at is null;
update private.document_shares set legacy_pdf_version_id=null where legacy_pdf_version_id is not null;
update public.document_approval_links set legacy_pdf_version_id=null where legacy_pdf_version_id is not null;
