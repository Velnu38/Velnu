-- A document version is an immutable customer-facing artifact. Access tokens,
-- action deadlines, delivery receipts, and payment progress are separate state.
create table private.document_versions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null check (kind in ('invoice','estimate','change_order')),
  document_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  snapshot jsonb not null,
  snapshot_hash text not null check (snapshot_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  action_expires_at timestamptz,
  pdf_bucket text, pdf_path text, pdf_sha256 text, pdf_byte_size bigint, pdf_created_at timestamptz,
  unique (business_id,kind,document_id,revision_number),
  check (pdf_sha256 is null or pdf_sha256 ~ '^[a-f0-9]{64}$'),
  check (pdf_byte_size is null or pdf_byte_size > 0)
);
create unique index document_versions_current on private.document_versions(business_id,kind,document_id) where superseded_at is null;
alter table private.document_versions enable row level security;
revoke all on private.document_versions from public,anon,authenticated,service_role;

create function private.guard_document_version() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.id,new.business_id,new.kind,new.document_id,new.revision_number,new.snapshot,new.snapshot_hash,new.created_at,new.action_expires_at)
    is distinct from (old.id,old.business_id,old.kind,old.document_id,old.revision_number,old.snapshot,old.snapshot_hash,old.created_at,old.action_expires_at) then
    raise exception 'A published document version is immutable.' using errcode='23514';end if;
  if old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at then
    raise exception 'A superseded document version cannot be reopened.' using errcode='23514';end if;
  return new;
end $$;
create trigger document_version_immutable before update on private.document_versions for each row execute function private.guard_document_version();
revoke all on function private.guard_document_version() from public,anon,authenticated,service_role;

alter table private.document_shares add column revision_id uuid references private.document_versions(id);
alter table private.document_shares add column legacy_pdf_version_id uuid references private.document_versions(id);
alter table private.document_shares add column rotated_to_hash text references private.document_shares(token_hash);
alter table public.document_approval_links add column document_version_id uuid references private.document_versions(id);
alter table public.document_approval_links add column legacy_pdf_version_id uuid references private.document_versions(id);
-- Existing issued approvals retain their entitlement; newly published approvals
-- check the current plan again when an action is attempted.
alter table public.document_approval_links add column legacy_entitlement boolean not null default true;
alter table public.document_approval_links alter column legacy_entitlement set default false;

alter function private.customer_document_snapshot(uuid,text,uuid) rename to customer_document_snapshot_legacy;

create function private.document_action_deadline(b uuid,k text,doc jsonb,issued timestamptz default now())
returns timestamptz language plpgsql stable set search_path='' as $$
declare zone text;
begin
  if k='estimate' then
    if nullif(doc->>'expires_on','') is null then return null;end if;
    select coalesce(timezone,'UTC') into zone from public.businesses where id=b;
    return ((doc->>'expires_on')::date + 1)::timestamp at time zone coalesce(zone,'UTC');
  end if;
  if k='change_order' then return issued + interval '30 days';end if;
  return null;
end $$;

create function private.customer_document_snapshot(b uuid,k text,d uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare doc jsonb; lines jsonb; customer_row jsonb; customer_public jsonb; company_row jsonb; company_public jsonb;
  location_row jsonb; location_public jsonb; property_id uuid; job_row jsonb; t text; fk text; field text;
begin
  if k not in ('invoice','estimate','change_order') then raise exception 'Invalid document' using errcode='22023';end if;
  t:=case k when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end;
  fk:=k||'_id';
  execute format('select to_jsonb(x) from public.%I x where business_id=$1 and id=$2',t) into doc using b,d;
  if doc is null then raise exception 'Document unavailable' using errcode='42501';end if;
  execute format('select coalesce(jsonb_agg(jsonb_build_object(''id'',id,''description'',description,''quantity'',quantity,''unit_price'',unit_price,''tax_rate'',tax_rate,''line_total'',line_total,''sort_order'',sort_order) order by sort_order,id),''[]''::jsonb) from public.%I where business_id=$1 and %I=$2',k||'_items',fk) into lines using b,d;
  select to_jsonb(c) into customer_row from public.customers c where c.business_id=b and c.id=(doc->>'customer_id')::uuid;
  customer_public:=jsonb_build_object('id',customer_row->'id','name',coalesce(nullif(btrim(concat_ws(' ',customer_row->>'first_name',customer_row->>'last_name')),''),customer_row->>'company','Customer'));
  foreach field in array array['first_name','last_name','company','email','phone','address_line1','address_line2','city','state','postal_code','country'] loop
    customer_public:=customer_public||jsonb_build_object(field,customer_row->field);
  end loop;
  select to_jsonb(x) into company_row from public.businesses x where id=b;
  if jsonb_typeof(doc->'issuer_snapshot')='object' then company_row:=company_row||(doc->'issuer_snapshot');end if;
  company_public:='{}'::jsonb;
  foreach field in array array['name','legal_name','email','phone','website','address_line1','address_line2','city','state','postal_code','country','logo_path','document_accent','document_footer'] loop
    company_public:=company_public||jsonb_build_object(field,company_row->field);
  end loop;
  property_id:=nullif(doc->>'property_id','')::uuid;
  if property_id is null and nullif(doc->>'job_id','') is not null then
    select to_jsonb(j) into job_row from public.jobs j where j.business_id=b and j.id=(doc->>'job_id')::uuid;
    property_id:=nullif(job_row->>'property_id','')::uuid;
  end if;
  if property_id is null and k='change_order' then
    if nullif(doc->>'estimate_id','') is not null then
      select nullif(to_jsonb(e)->>'property_id','')::uuid into property_id from public.estimates e where e.business_id=b and e.id=(doc->>'estimate_id')::uuid;
    elsif nullif(doc->>'source_invoice_id','') is not null then
      select nullif(to_jsonb(i)->>'property_id','')::uuid into property_id from public.invoices i where i.business_id=b and i.id=(doc->>'source_invoice_id')::uuid;
    end if;
  end if;
  if property_id is not null then
    select to_jsonb(p) into location_row from public.properties p where p.id=property_id and p.business_id=b and p.customer_id=(doc->>'customer_id')::uuid;
  end if;
  location_public:=null;
  if location_row is not null then
    location_public:='{}'::jsonb;
    foreach field in array array['label','address_line1','address_line2','city','state','postal_code'] loop
      location_public:=location_public||jsonb_build_object(field,location_row->field);
    end loop;
  end if;
  return jsonb_build_object(
    'schema_version',1,'document_id',d,'kind',k,'number',doc->>(k||'_number'),'status',doc->>'status',
    'issue_date',doc->>'issue_date','due_date',doc->>'due_date','expires_on',doc->>'expires_on',
    'subtotal',doc->'subtotal','tax_amount',doc->'tax_amount','total',doc->'total',
    'deposit_credit',coalesce(doc->'deposit_credit','0'::jsonb),'amount_paid',doc->'amount_paid','balance_due',doc->'balance_due',
    'currency',coalesce(company_row->>'currency','USD'),'customer_message',doc->>'customer_message',
    'payment_links',case when k='invoice' then coalesce(doc->'payment_links','[]'::jsonb) else '[]'::jsonb end,
    'payment_instructions',case when k='invoice' then doc->>'payment_instructions' end,
    'title',doc->>'title','description',doc->>'description','reason',doc->>'reason',
    'schedule_impact_days',doc->'schedule_impact_days','schedule_note',doc->>'schedule_note',
    'items',lines,'customer',customer_public,'company',company_public,'service_location',location_public,
    'service_address',nullif(concat_ws(', ',nullif(location_row->>'address_line1',''),nullif(location_row->>'address_line2',''),nullif(location_row->>'city',''),nullif(location_row->>'state',''),nullif(location_row->>'postal_code','')),''),
    'finviant_branding',private.effective_plan(b)='free'
  ) || case when jsonb_typeof(doc->'change_totals')='object' then jsonb_build_object('change_totals',doc->'change_totals') else '{}'::jsonb end;
end $$;

create function private.document_version_body(snapshot jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select snapshot - array['revision_id','revision_number','revision_created_at','status','amount_paid','balance_due','finviant_branding']
$$;

create function private.publish_document_version(p_actor uuid,p_business uuid,p_kind text,p_document uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare snap jsonb; digest text; current_version private.document_versions%rowtype; fresh private.document_versions%rowtype;
  next_revision integer; created timestamptz:=now(); deadline timestamptz; t text; exists_doc boolean;
begin
  if p_actor is null or p_kind not in ('invoice','estimate','change_order') or
     not private.member_module_access(p_business,p_actor,'billing') or not exists(
       select 1 from public.business_members where business_id=p_business and user_id=p_actor and role in ('owner','admin','office')) then
    raise exception 'Document access denied' using errcode='42501';
  end if;
  t:=case p_kind when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end;
  execute format('select true from public.%I where business_id=$1 and id=$2 for update',t) into exists_doc using p_business,p_document;
  if exists_doc is distinct from true then raise exception 'Document unavailable' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended('document-version:'||p_business::text||':'||p_kind||':'||p_document::text,0));
  snap:=private.customer_document_snapshot(p_business,p_kind,p_document);
  if jsonb_array_length(snap->'items')=0 then raise exception 'Add line items before publishing a document.' using errcode='23514';end if;
  digest:=encode(sha256(convert_to(private.document_version_body(snap)::text,'UTF8')),'hex');
  select * into current_version from private.document_versions where business_id=p_business and kind=p_kind and document_id=p_document and superseded_at is null for update;
  if found and current_version.snapshot_hash=digest then
    return jsonb_build_object('version_id',current_version.id,'business_id',p_business,'kind',p_kind,'document_id',p_document,'snapshot',current_version.snapshot);
  end if;
  -- Reopening an unchanged PDF is unlimited. Only a distinct publication uses
  -- this budget, under a business-wide lock so concurrent documents cannot race.
  perform pg_advisory_xact_lock(hashtextextended('document-publication-budget:'||p_business::text,0));
  if (select count(*) from private.document_versions where business_id=p_business and created_at>now()-interval '1 hour')>=100 then
    raise exception 'Please reuse a published PDF or try again later.' using errcode='54000';
  end if;
  if current_version.id is not null then update private.document_versions set superseded_at=created where id=current_version.id;end if;
  select coalesce(max(revision_number),0)+1 into next_revision from private.document_versions where business_id=p_business and kind=p_kind and document_id=p_document;
  fresh.id:=gen_random_uuid();
  snap:=snap||jsonb_build_object('revision_id',fresh.id,'revision_number',next_revision,'revision_created_at',created);
  deadline:=private.document_action_deadline(p_business,p_kind,snap,created);
  insert into private.document_versions(id,business_id,kind,document_id,revision_number,snapshot,snapshot_hash,created_at,action_expires_at)
    values(fresh.id,p_business,p_kind,p_document,next_revision,snap,digest,created,deadline) returning * into fresh;
  return jsonb_build_object('version_id',fresh.id,'business_id',p_business,'kind',p_kind,'document_id',p_document,'snapshot',snap);
end $$;

create function public.get_owner_document_version(p_business uuid,p_kind text,p_document uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.fin_access(p_business,case p_kind when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end,true) then
    raise exception 'Document access denied' using errcode='42501';
  end if;
  return private.publish_document_version(auth.uid(),p_business,p_kind,p_document);
end $$;

create function private.create_document_share(p_actor uuid,p_business uuid,p_kind text,p_document uuid,p_token text,p_revision uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare published jsonb; version private.document_versions%rowtype; existing private.document_shares%rowtype;
  hash text; approval text; deadline timestamptz; t text; exists_doc boolean;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid share identifier' using errcode='22023';end if;
  if p_actor is null or not private.member_module_access(p_business,p_actor,'billing') or not exists(
    select 1 from public.business_members where business_id=p_business and user_id=p_actor and role in ('owner','admin','office')) then
    raise exception 'Document access denied' using errcode='42501';
  end if;
  hash:=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  t:=case p_kind when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end;
  execute format('select true from public.%I where business_id=$1 and id=$2 for update',t) into exists_doc using p_business,p_document;
  if exists_doc is distinct from true then raise exception 'Document unavailable' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended('document-share:'||p_business::text,0));
  select * into existing from private.document_shares where token_hash=hash;
  if found then
    if existing.business_id<>p_business or existing.document_id<>p_document or existing.kind<>p_kind or existing.actor_id<>p_actor then raise exception 'Share identifier conflict' using errcode='42501';end if;
    if existing.revoked_at is not null then raise exception 'Link revoked. Prepare a new link.' using errcode='42501';end if;
    if p_revision is not null and existing.revision_id is distinct from p_revision then raise exception 'Share revision conflict' using errcode='23505';end if;
    select * into version from private.document_versions where id=existing.revision_id;
    return jsonb_build_object('snapshot',existing.snapshot,'version_id',existing.revision_id,'revision_id',existing.revision_id,'token',p_token,'expires_at',coalesce(version.action_expires_at,case when existing.revision_id is null then existing.expires_at end));
  end if;
  if (select count(*) from private.document_shares where business_id=p_business and created_at>now()-interval '1 hour')>=100 then raise exception 'Please reuse an existing link or try later.';end if;
  if p_revision is null then
    published:=private.publish_document_version(p_actor,p_business,p_kind,p_document);
    p_revision:=(published->>'version_id')::uuid;
  end if;
  select * into version from private.document_versions where id=p_revision and business_id=p_business and kind=p_kind and document_id=p_document;
  if not found or version.superseded_at is not null then raise exception 'This document revision is no longer current.' using errcode='23514';end if;
  if version.snapshot_hash is distinct from encode(sha256(convert_to(private.document_version_body(private.customer_document_snapshot(p_business,p_kind,p_document))::text,'UTF8')),'hex') then
    raise exception 'The document changed after its PDF was prepared. Review the current version.' using errcode='23514';end if;
  deadline:=version.action_expires_at;
  if p_kind in ('estimate','change_order') then
    approval:=encode(extensions.gen_random_bytes(32),'hex');
    insert into public.document_approval_links(business_id,document_type,estimate_id,change_order_id,token_hash,expires_at,created_by_user_id,document_version_id,legacy_entitlement)
    values(p_business,p_kind,case when p_kind='estimate' then p_document end,case when p_kind='change_order' then p_document end,
      encode(sha256(convert_to(approval,'UTF8')),'hex'),coalesce(deadline,'infinity'::timestamptz),p_actor,p_revision,false);
  end if;
  insert into private.document_shares(token_hash,business_id,kind,document_id,actor_id,snapshot,approval_token,revision_id,expires_at)
    values(hash,p_business,p_kind,p_document,p_actor,version.snapshot,approval,p_revision,'infinity'::timestamptz);
  return jsonb_build_object('snapshot',version.snapshot,'version_id',p_revision,'revision_id',p_revision,'token',p_token,'expires_at',deadline,'approval_token',approval);
end $$;

create or replace function public.prepare_personal_document(p_business uuid,p_kind text,p_document uuid,p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.fin_access(p_business,case p_kind when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end,true) then
    raise exception 'Document access denied' using errcode='42501';end if;
  return private.create_document_share(auth.uid(),p_business,p_kind,p_document,p_token);
end $$;

create function private.document_share_context(p_token_hash text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare share private.document_shares%rowtype; version private.document_versions%rowtype; link public.document_approval_links%rowtype;
  decision public.document_approvals%rowtype; live jsonb; snap jsonb; t text; state text:='read_only';reason text:='This document is available to view.';
  pro boolean; deadline timestamptz; superseded boolean:=false; complete jsonb;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Link unavailable' using errcode='42501';end if;
  select * into share from private.document_shares where token_hash=p_token_hash and revoked_at is null;
  if not found then raise exception 'This link is revoked or unavailable.' using errcode='42501';end if;
  select * into version from private.document_versions where id=share.revision_id;
  snap:=coalesce(version.snapshot,share.snapshot);
  superseded:=version.superseded_at is not null;
  deadline:=case when share.revision_id is null then share.expires_at else version.action_expires_at end;
  pro:=private.effective_plan(share.business_id)='pro';
  t:=case share.kind when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end;
  execute format('select to_jsonb(x) from public.%I x where business_id=$1 and id=$2',t) into live using share.business_id,share.document_id;
  if share.approval_token is not null then
    select * into link from public.document_approval_links where token_hash=encode(sha256(convert_to(share.approval_token,'UTF8')),'hex');
    select * into decision from public.document_approvals where approval_link_id=link.id;
    if decision.id is not null then complete:=jsonb_build_object('action',decision.action,'typed_name',decision.typed_name,'amount',decision.amount_at_action,'created_at',decision.created_at,'terms_agreed',decision.document_snapshot->'terms_accepted','revision_id',link.document_version_id);end if;
  end if;
  if live is null then state:='unavailable';reason:='The original record is no longer available. This copy is read only.';
  elsif complete is not null or live->>'status' in ('accepted','approved','declined','converted') then state:='completed';reason:='A decision has already been recorded. This copy is read only.';
  elsif live->>'status'='void' then state:='void';reason:='This document was voided. This copy is read only.';
  elsif live->>'status'='expired' then state:='expired';reason:='The response deadline passed. This copy is read only.';
  elsif superseded or (version.id is not null and version.snapshot_hash is distinct from encode(sha256(convert_to(private.document_version_body(private.customer_document_snapshot(share.business_id,share.kind,share.document_id))::text,'UTF8')),'hex')) then
    superseded:=true;state:='superseded';reason:='The document changed or a newer version was issued. This copy is read only.';
  elsif share.kind='invoice' and live->>'status'='paid' then state:='paid';reason:='This invoice is paid.';
  elsif share.kind='invoice' then
    if pro and live->>'status' in ('sent','viewed','partial','overdue') and coalesce((live->>'balance_due')::numeric,0)>0 then state:='payment_due';reason:='Payment is due.';end if;
  elsif deadline is not null and deadline<=now() then state:='expired';reason:='The response deadline passed. This copy is read only.';
  elsif not pro and not coalesce(link.legacy_entitlement,share.revision_id is null) then state:='read_only';reason:='This document is available to view and download.';
  elsif link.revoked_at is not null then state:='read_only';reason:='Approval for this link was revoked. This copy is read only.';
  elsif live->>'status'='sent' or (live->>'status'='draft' and share.approval_ready_at is not null) then state:='available';reason:='Review this document before recording your decision.';
  else state:='pending_release';reason:='The business is preparing this document for approval.';end if;
  return jsonb_build_object('business_id',share.business_id,'document_id',share.document_id,'kind',share.kind,
    'revision_id',share.revision_id,'revision_number',snap->'revision_number','snapshot',snap,'snapshot_hash',version.snapshot_hash,
    'live_status',live->>'status','balance_due',live->'balance_due','amount_paid',live->'amount_paid','currency',coalesce(snap->>'currency','USD'),
    'superseded',superseded,'action_expires_at',deadline,'action_state',state,'action_reason',reason,
    'publication_ready',true,'pro_actions_enabled',pro,'completed',complete,
    'approval_token',case when state='available' then share.approval_token end,'approval_ready_at',share.approval_ready_at);
end $$;

create or replace function private.release_personal_approval(p_business uuid,p_token text) returns void
language plpgsql security definer set search_path='' as $$
declare share private.document_shares%rowtype; version private.document_versions%rowtype; current_snapshot jsonb;
begin
  if auth.uid() is null or p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Share unavailable' using errcode='42501';end if;
  select * into share from private.document_shares where business_id=p_business and token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and actor_id=auth.uid() and revoked_at is null for update;
  if not found or share.kind not in ('estimate','change_order') or not private.fin_access(p_business,case share.kind when 'estimate' then 'estimates' else 'change_orders' end,true) then
    raise exception 'Share unavailable' using errcode='42501';end if;
  if share.revision_id is not null then
    -- Copying/sending a lower-tier PDF remains available; only live controls are gated.
    if private.effective_plan(p_business)<>'pro' then return;end if;
    select * into version from private.document_versions where id=share.revision_id;
    if version.superseded_at is not null or (version.action_expires_at is not null and version.action_expires_at<=now()) then
      raise exception 'This approval deadline passed or the document was superseded.' using errcode='23514';end if;
    current_snapshot:=private.customer_document_snapshot(p_business,share.kind,share.document_id);
    if current_snapshot->>'status' not in ('draft','sent') or version.snapshot_hash is distinct from encode(sha256(convert_to(private.document_version_body(current_snapshot)::text,'UTF8')),'hex') then
      raise exception 'This document changed. Review it and prepare a fresh link.' using errcode='23514';end if;
  else
    if share.expires_at<=now() then raise exception 'Approval link expired' using errcode='23514';end if;
    current_snapshot:=private.customer_document_snapshot_legacy(p_business,share.kind,share.document_id)||jsonb_build_object('finviant_branding',share.snapshot->'finviant_branding');
    if current_snapshot->>'status' not in ('draft','sent') or (current_snapshot-'status'-'balance_due'-'amount_paid') is distinct from (share.snapshot-'status'-'balance_due'-'amount_paid') then
      raise exception 'This document changed. Review it and prepare a fresh link.' using errcode='23514';end if;
  end if;
  update private.document_shares set approval_ready_at=coalesce(approval_ready_at,now()) where token_hash=share.token_hash;
end $$;

create or replace function private.personal_approval_available(p_business uuid,p_kind text,p_document uuid,p_hash text)
returns boolean language plpgsql stable set search_path='' as $$
declare share private.document_shares%rowtype; snap jsonb; context jsonb;
begin
  select * into share from private.document_shares where business_id=p_business and kind=p_kind and document_id=p_document and approval_token is not null
    and encode(sha256(convert_to(approval_token,'UTF8')),'hex')=p_hash order by (revoked_at is null) desc,created_at desc limit 1;
  if not found then return null;end if;
  if share.revoked_at is not null then return false;end if;
  if share.revision_id is not null then
    context:=private.document_share_context(share.token_hash);
    return context->>'action_state'='available';
  end if;
  if share.expires_at<=now() then return false;end if;
  snap:=private.customer_document_snapshot_legacy(p_business,p_kind,p_document)||jsonb_build_object('finviant_branding',share.snapshot->'finviant_branding');
  return (snap->>'status'='sent' or (snap->>'status'='draft' and share.approval_ready_at is not null))
    and (snap-'status'-'balance_due'-'amount_paid')=(share.snapshot-'status'-'balance_due'-'amount_paid');
end $$;

create or replace function public.confirm_personal_document_sent(p_business uuid,p_token text,p_channel text) returns void
language plpgsql security definer set search_path='' as $$
declare share private.document_shares%rowtype; version private.document_versions%rowtype; current_snapshot jsonb; t text; customer_id uuid;
begin
  if p_channel is null or p_channel not in ('email','sms') or p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid personal delivery';end if;
  select * into share from private.document_shares where business_id=p_business and token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and actor_id=auth.uid() and revoked_at is null;
  if not found or not private.fin_access(p_business,case share.kind when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end,true) then raise exception 'Not authorized' using errcode='42501';end if;
  if share.kind='change_order' then perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||p_business::text,0));end if;
  t:=case share.kind when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end;
  execute format('select customer_id from public.%I where id=$1 and business_id=$2 for update',t) into customer_id using share.document_id,p_business;
  select * into share from private.document_shares where token_hash=share.token_hash and revoked_at is null for update;
  if not found then raise exception 'Share unavailable' using errcode='42501';end if;
  if share.revision_id is null then
    if share.expires_at<=now() then raise exception 'Link expired';end if;
    current_snapshot:=private.customer_document_snapshot_legacy(p_business,share.kind,share.document_id)||jsonb_build_object('finviant_branding',share.snapshot->'finviant_branding');
    if (current_snapshot-'status'-'balance_due'-'amount_paid') is distinct from (share.snapshot-'status'-'balance_due'-'amount_paid') then raise exception 'Document changed. Prepare a fresh draft.';end if;
  else
    select * into version from private.document_versions where id=share.revision_id;
    current_snapshot:=private.customer_document_snapshot(p_business,share.kind,share.document_id);
    if version.superseded_at is not null or version.snapshot_hash is distinct from encode(sha256(convert_to(private.document_version_body(current_snapshot)::text,'UTF8')),'hex') then raise exception 'Document changed. Prepare a fresh draft.' using errcode='23514';end if;
  end if;
  t:=case share.kind when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end;
  execute format('select customer_id from public.%I where id=$1 and business_id=$2',t) into customer_id using share.document_id,p_business;
  execute format('update public.%I set status=''sent'' where id=$1 and business_id=$2 and status=''draft''',t) using share.document_id,p_business;
  if not exists(select 1 from public.messages where business_id=p_business and provider_message_id=share.token_hash and provider='personal_app') then
    insert into public.messages(business_id,customer_id,invoice_id,estimate_id,change_order_id,direction,channel,recipient,subject,body,provider,provider_message_id,status,sent_at)
    values(p_business,customer_id,
      case when share.kind='invoice' then share.document_id end,case when share.kind='estimate' then share.document_id end,case when share.kind='change_order' then share.document_id end,
      'outbound',p_channel,coalesce(share.snapshot#>>array['customer',case when p_channel='email' then 'email' else 'phone' end],''),
      'Owner reported personal-app send','Owner confirmed sending through their own app. Delivery is not verified.','personal_app',share.token_hash,'sent',now());
  end if;
end $$;

create or replace function public.release_personal_approval(p_business uuid,p_token text) returns void
language sql security definer set search_path='' as $$ select private.release_personal_approval(p_business,p_token) $$;

-- Legacy tokens did not store a complete printable version. On their first PDF
-- view, preserve the historical fields they did store and freeze a full version
-- once. This never reopens or replaces another version's approval authority.
create function private.freeze_legacy_document_version(p_business uuid,p_kind text,p_document uuid,p_snapshot jsonb,p_created timestamptz,p_deadline timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare snap jsonb; version_id uuid:=gen_random_uuid(); revision integer; has_current boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('document-version:'||p_business::text||':'||p_kind||':'||p_document::text,0));
  snap:=private.customer_document_snapshot(p_business,p_kind,p_document)||coalesce(p_snapshot,'{}'::jsonb);
  snap:=snap||jsonb_build_object('company',(private.customer_document_snapshot(p_business,p_kind,p_document)->'company')||coalesce(p_snapshot->'company','{}'::jsonb),
    'customer',(private.customer_document_snapshot(p_business,p_kind,p_document)->'customer')||coalesce(p_snapshot->'customer','{}'::jsonb));
  select coalesce(max(revision_number),0)+1,bool_or(superseded_at is null) into revision,has_current from private.document_versions where business_id=p_business and kind=p_kind and document_id=p_document;
  snap:=snap||jsonb_build_object('schema_version',1,'revision_id',version_id,'revision_number',revision,'revision_created_at',p_created,'legacy_snapshot',true);
  insert into private.document_versions(id,business_id,kind,document_id,revision_number,snapshot,snapshot_hash,created_at,action_expires_at,superseded_at)
  values(version_id,p_business,p_kind,p_document,revision,snap,
    encode(sha256(convert_to(private.document_version_body(snap)::text,'UTF8')),'hex'),p_created,p_deadline,case when has_current then now() end);
  return version_id;
end $$;

create function public.get_document_pdf_version(p_token text,p_token_type text default 'document_share') returns jsonb
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
      version_id:=private.freeze_legacy_document_version(b,k,d,receipt,link.created_at,link.expires_at);
      update public.document_approval_links set legacy_pdf_version_id=version_id where id=link.id;
    end if;
  else raise exception 'Invalid token type' using errcode='22023';end if;
  select * into version from private.document_versions where id=version_id;
  if not found then raise exception 'Document version unavailable' using errcode='42501';end if;
  return jsonb_build_object('version_id',version.id,'business_id',b,'kind',k,'document_id',d,'snapshot',version.snapshot);
end $$;

create function public.get_customer_approval_document(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare link public.document_approval_links%rowtype; decision public.document_approvals%rowtype; artifact jsonb; snap jsonb;
  live jsonb; state text; reason text; share_context jsonb; share_hash text; t text; deadline timestamptz;
begin
  if p_token is null or length(p_token)<32 or length(p_token)>200 then raise exception 'Invalid approval token' using errcode='42501';end if;
  select * into link from public.document_approval_links where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  if not found then raise exception 'Approval link not found' using errcode='P0002';end if;
  select * into decision from public.document_approvals where approval_link_id=link.id;
  if link.revoked_at is not null and decision.id is null then raise exception 'Approval link has been revoked' using errcode='42501';end if;
  artifact:=public.get_document_pdf_version(p_token,'approval');snap:=artifact->'snapshot';
  select token_hash into share_hash from private.document_shares where approval_token=p_token and revoked_at is null order by created_at desc limit 1;
  if share_hash is not null then
    share_context:=private.document_share_context(share_hash);state:=share_context->>'action_state';reason:=share_context->>'action_reason';
  else
    t:=case link.document_type when 'estimate' then 'estimates' else 'change_orders' end;
    execute format('select to_jsonb(x) from public.%I x where business_id=$1 and id=$2',t) into live using link.business_id,coalesce(link.estimate_id,link.change_order_id);
    if decision.id is not null then state:='completed';reason:='A decision has already been recorded.';
    elsif live is null then state:='unavailable';reason:='The original record is unavailable.';
    elsif live->>'status' not in ('draft','sent') then state:='completed';reason:='This document is read only.';
    elsif link.expires_at<=now() then state:='expired';reason:='The response deadline passed. This copy is read only.';
    elsif not link.legacy_entitlement and private.effective_plan(link.business_id)<>'pro' then state:='read_only';reason:='This document is available to view and download.';
    elsif link.document_version_id is not null and exists(select 1 from private.document_versions v where v.id=link.document_version_id and v.superseded_at is not null) then state:='superseded';reason:='A newer version was issued. This copy is read only.';
    else state:='available';reason:='Review this document before recording your decision.';end if;
  end if;
  return jsonb_build_object('business_name',snap#>>'{company,name}','business_profile',snap->'company','finviant_branding',snap->'finviant_branding',
    'document_type',link.document_type,'document',snap||jsonb_build_object('estimate_number',snap->>'number','change_order_number',snap->>'number'),
    'items',snap->'items','customer',snap->'customer','expires_at',case when link.expires_at='infinity'::timestamptz then null else link.expires_at end,
    'revision_id',artifact->'version_id','snapshot',snap,'action_state',state,'action_reason',reason,
    'completed',case when decision.id is not null then jsonb_build_object('action',decision.action,'typed_name',decision.typed_name,'amount',decision.amount_at_action,'created_at',decision.created_at,'terms_agreed',decision.document_snapshot->'terms_accepted','revision_id',artifact->'version_id') end);
end $$;

-- Preserve all existing status/ledger/consent guards and idempotency. Add an
-- immutable-version check before that established transaction is executed.
alter function public.consume_document_approval(text,text,text,text,boolean) set schema private;
alter function private.consume_document_approval(text,text,text,text,boolean) rename to consume_document_approval_before_versions;

create function public.consume_document_approval(p_token_hash text,p_action text,p_typed_name text,p_user_agent text,p_terms_agreed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare link public.document_approval_links%rowtype; version private.document_versions%rowtype; result jsonb; current_snapshot jsonb; receipt jsonb; t text;
begin
  select * into link from public.document_approval_links where token_hash=p_token_hash;
  if not found then raise exception 'LINK_NOT_FOUND' using errcode='P0002';end if;
  if link.document_type='change_order' then perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||link.business_id::text,0));end if;
  t:=case link.document_type when 'estimate' then 'estimates' else 'change_orders' end;
  execute format('select to_jsonb(x) from public.%I x where id=$1 and business_id=$2 for update',t) into current_snapshot using coalesce(link.estimate_id,link.change_order_id),link.business_id;
  select * into link from public.document_approval_links where token_hash=p_token_hash for update;
  if exists(select 1 from public.document_approvals where approval_link_id=link.id) then
    return private.consume_document_approval_before_versions(p_token_hash,p_action,p_typed_name,p_user_agent,p_terms_agreed);
  end if;
  if link.document_version_id is not null then
    select * into version from private.document_versions where id=link.document_version_id;
    if version.superseded_at is not null then raise exception 'DOCUMENT_SUPERSEDED' using errcode='23514';end if;
    if not link.legacy_entitlement and private.effective_plan(link.business_id)<>'pro' then raise exception 'PRO_ACTION_REQUIRED' using errcode='42501';end if;
    current_snapshot:=private.customer_document_snapshot(link.business_id,link.document_type,coalesce(link.estimate_id,link.change_order_id));
    if version.snapshot_hash is distinct from encode(sha256(convert_to(private.document_version_body(current_snapshot)::text,'UTF8')),'hex') then raise exception 'DOCUMENT_SUPERSEDED' using errcode='23514';end if;
  end if;
  result:=private.consume_document_approval_before_versions(p_token_hash,p_action,p_typed_name,p_user_agent,p_terms_agreed);
  if version.id is not null then
    select document_snapshot into receipt from public.document_approvals where approval_link_id=link.id;
    update public.document_approvals set document_snapshot=version.snapshot||jsonb_build_object(
      'document_type',link.document_type,'id',version.document_id,'number',version.snapshot->>'number',
      'terms_accepted',receipt->'terms_accepted','terms_accepted_at',receipt->'terms_accepted_at','terms_version',receipt->'terms_version','terms_statement',receipt->'terms_statement')
      where approval_link_id=link.id;
  end if;
  return result||jsonb_build_object('revision_id',link.document_version_id);
end $$;

create function public.consume_document_approval(p_token_hash text,p_action text,p_typed_name text,p_user_agent text,p_terms_agreed boolean,p_expected_revision_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare version_id uuid;
begin
  select document_version_id into version_id from public.document_approval_links where token_hash=p_token_hash;
  if p_expected_revision_id is not null and version_id is distinct from p_expected_revision_id then raise exception 'DOCUMENT_SUPERSEDED' using errcode='23514';end if;
  return public.consume_document_approval(p_token_hash,p_action,p_typed_name,p_user_agent,p_terms_agreed);
end $$;

create or replace function public.get_shared_document(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Link unavailable' using errcode='42501';end if;
  context:=private.document_share_context(encode(sha256(convert_to(p_token,'UTF8')),'hex'));
  return (context->'snapshot')||jsonb_build_object('live_status',context->'live_status','live_amount_paid',context->'amount_paid','live_balance_due',context->'balance_due',
    'approval_token',context->'approval_token','approval_ready_at',context->'approval_ready_at','expires_at',context->'action_expires_at',
    'action_state',context->'action_state','action_reason',context->'action_reason','completed',context->'completed','pro_actions_enabled',context->'pro_actions_enabled');
end $$;

create function public.rotate_document_share(p_business uuid,p_token text,p_new_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old private.document_shares%rowtype; old_link public.document_approval_links%rowtype; old_hash text; new_hash text; replacement_approval text; t text; exists_doc boolean;
begin
  if auth.uid() is null or p_token is null or p_new_token is null or p_token !~ '^[a-f0-9]{64}$' or p_new_token !~ '^[a-f0-9]{64}$' or p_token=p_new_token then raise exception 'Invalid replacement link' using errcode='22023';end if;
  old_hash:=encode(sha256(convert_to(p_token,'UTF8')),'hex');new_hash:=encode(sha256(convert_to(p_new_token,'UTF8')),'hex');
  select * into old from private.document_shares where token_hash=old_hash and business_id=p_business;
  if not found or not private.fin_access(p_business,case old.kind when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end,true) then raise exception 'Share unavailable' using errcode='42501';end if;
  t:=case old.kind when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end;
  execute format('select true from public.%I where id=$1 and business_id=$2 for update',t) into exists_doc using old.document_id,p_business;
  perform pg_advisory_xact_lock(hashtextextended('document-share:'||p_business::text,0));
  select * into old from private.document_shares where token_hash=old_hash and business_id=p_business for update;
  if old.rotated_to_hash=new_hash then return jsonb_build_object('token',p_new_token,'version_id',old.revision_id,'rotated',true);end if;
  if old.revoked_at is not null then raise exception 'This link was already revoked or replaced.' using errcode='42501';end if;
  if exists(select 1 from private.document_shares where token_hash=new_hash) then raise exception 'Share identifier conflict' using errcode='23505';end if;
  replacement_approval:=old.approval_token;
  if old.approval_token is not null then
    select * into old_link from public.document_approval_links where token_hash=encode(sha256(convert_to(old.approval_token,'UTF8')),'hex') for update;
    if old_link.id is not null and not exists(select 1 from public.document_approvals where approval_link_id=old_link.id) then
      replacement_approval:=encode(extensions.gen_random_bytes(32),'hex');
      insert into public.document_approval_links(business_id,document_type,estimate_id,change_order_id,token_hash,expires_at,created_by_user_id,document_version_id,legacy_entitlement)
      values(old_link.business_id,old_link.document_type,old_link.estimate_id,old_link.change_order_id,
        encode(sha256(convert_to(replacement_approval,'UTF8')),'hex'),old_link.expires_at,auth.uid(),old_link.document_version_id,old_link.legacy_entitlement);
      update public.document_approval_links set revoked_at=coalesce(revoked_at,now()) where id=old_link.id;
    end if;
  end if;
  insert into private.document_shares(token_hash,business_id,kind,document_id,actor_id,snapshot,approval_token,created_at,expires_at,approval_ready_at,revision_id)
    values(new_hash,old.business_id,old.kind,old.document_id,auth.uid(),old.snapshot,replacement_approval,now(),old.expires_at,old.approval_ready_at,old.revision_id);
  update private.document_shares set revoked_at=now(),rotated_to_hash=new_hash where token_hash=old_hash;
  return jsonb_build_object('token',p_new_token,'version_id',old.revision_id,'rotated',true);
end $$;

create function public.issue_document_approval_link(p_business uuid,p_kind text,p_document uuid,p_rotate boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare published jsonb; version private.document_versions%rowtype; existing private.document_shares%rowtype;
  link public.document_approval_links%rowtype; prepared jsonb; view_token text; approval text; t text; status text;
begin
  if auth.uid() is null or p_kind not in ('estimate','change_order') or not private.fin_access(p_business,case p_kind when 'estimate' then 'estimates' else 'change_orders' end,true) then
    raise exception 'Document access denied' using errcode='42501';end if;
  if private.effective_plan(p_business)<>'pro' then raise exception 'Live customer approval requires Business Pro. The PDF remains available.' using errcode='42501';end if;
  published:=private.publish_document_version(auth.uid(),p_business,p_kind,p_document);
  select * into version from private.document_versions where id=(published->>'version_id')::uuid;
  t:=case p_kind when 'estimate' then 'estimates' else 'change_orders' end;
  execute format('select status from public.%I where id=$1 and business_id=$2 for update',t) into status using p_document,p_business;
  if status<>'sent' then raise exception 'Mark this document as sent before issuing customer approval.' using errcode='23514';end if;
  if version.action_expires_at is not null and version.action_expires_at<=now() then raise exception 'The document response deadline has passed.' using errcode='23514';end if;
  perform pg_advisory_xact_lock(hashtextextended('document-share:'||p_business::text,0));
  if not p_rotate then
    select s.* into existing from private.document_shares s join public.document_approval_links l on l.token_hash=encode(sha256(convert_to(s.approval_token,'UTF8')),'hex')
      where s.business_id=p_business and s.kind=p_kind and s.document_id=p_document and s.revision_id=version.id and s.revoked_at is null
        and l.revoked_at is null and l.expires_at>now() order by s.created_at desc limit 1;
    if existing.token_hash is not null then approval:=existing.approval_token;end if;
  end if;
  if approval is null then
    if p_rotate then
      update public.document_approval_links l set revoked_at=coalesce(l.revoked_at,now()) where l.business_id=p_business and l.document_type=p_kind
        and coalesce(l.estimate_id,l.change_order_id)=p_document and not exists(select 1 from public.document_approvals a where a.approval_link_id=l.id);
      update private.document_shares set revoked_at=coalesce(revoked_at,now()) where business_id=p_business and kind=p_kind and document_id=p_document;
    end if;
    view_token:=encode(extensions.gen_random_bytes(32),'hex');
    prepared:=private.create_document_share(auth.uid(),p_business,p_kind,p_document,view_token,version.id);
    approval:=prepared->>'approval_token';
  end if;
  select * into link from public.document_approval_links where token_hash=encode(sha256(convert_to(approval,'UTF8')),'hex');
  return jsonb_build_object('approval_link_id',link.id,'token',approval,'expires_at',version.action_expires_at,
    'revision_id',version.id,'relative_url','/?approval='||approval);
end $$;

create function public.revoke_document_share(p_business uuid,p_token text) returns void
language plpgsql security definer set search_path='' as $$
declare share private.document_shares%rowtype; t text; exists_doc boolean;
begin
  if auth.uid() is null or p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Share unavailable' using errcode='42501';end if;
  select * into share from private.document_shares where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and business_id=p_business;
  if not found or not private.fin_access(p_business,case share.kind when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end,true) then raise exception 'Share unavailable' using errcode='42501';end if;
  t:=case share.kind when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end;
  execute format('select true from public.%I where id=$1 and business_id=$2 for update',t) into exists_doc using share.document_id,p_business;
  select * into share from private.document_shares where token_hash=share.token_hash for update;
  update private.document_shares set revoked_at=coalesce(revoked_at,now()) where token_hash=share.token_hash;
  -- A different still-valid read link may share the same action authority.
  if share.approval_token is not null and not exists(select 1 from private.document_shares where approval_token=share.approval_token and token_hash<>share.token_hash and revoked_at is null) then
    update public.document_approval_links set revoked_at=coalesce(revoked_at,now()) where token_hash=encode(sha256(convert_to(share.approval_token,'UTF8')),'hex');
  end if;
end $$;

revoke all on function private.customer_document_snapshot_legacy(uuid,text,uuid),private.customer_document_snapshot(uuid,text,uuid),private.document_action_deadline(uuid,text,jsonb,timestamptz),private.document_version_body(jsonb),private.publish_document_version(uuid,uuid,text,uuid),private.create_document_share(uuid,uuid,text,uuid,text,uuid),private.document_share_context(text) from public,anon,authenticated,service_role;
grant execute on function private.publish_document_version(uuid,uuid,text,uuid),private.create_document_share(uuid,uuid,text,uuid,text,uuid),private.document_share_context(text) to service_role;
revoke all on function public.get_owner_document_version(uuid,text,uuid),public.rotate_document_share(uuid,text,text),public.revoke_document_share(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_owner_document_version(uuid,text,uuid),public.rotate_document_share(uuid,text,text),public.revoke_document_share(uuid,text) to authenticated;
revoke all on function public.get_shared_document(text),public.prepare_personal_document(uuid,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_shared_document(text) to anon,authenticated;
grant execute on function public.prepare_personal_document(uuid,text,uuid,text) to authenticated;
revoke all on function private.freeze_legacy_document_version(uuid,text,uuid,jsonb,timestamptz,timestamptz),private.consume_document_approval_before_versions(text,text,text,text,boolean),private.release_personal_approval(uuid,text),private.personal_approval_available(uuid,text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.get_document_pdf_version(text,text),public.get_customer_approval_document(text),public.consume_document_approval(text,text,text,text,boolean),public.consume_document_approval(text,text,text,text,boolean,uuid),public.release_personal_approval(uuid,text),public.confirm_personal_document_sent(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_document_pdf_version(text,text),public.get_customer_approval_document(text) to anon,authenticated,service_role;
grant execute on function public.consume_document_approval(text,text,text,text,boolean),public.consume_document_approval(text,text,text,text,boolean,uuid) to service_role;
grant execute on function public.release_personal_approval(uuid,text),public.confirm_personal_document_sent(uuid,text,text) to authenticated;
revoke all on function public.issue_document_approval_link(uuid,text,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.issue_document_approval_link(uuid,text,uuid,boolean) to authenticated;
