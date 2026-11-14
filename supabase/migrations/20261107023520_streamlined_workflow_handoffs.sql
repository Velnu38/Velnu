-- Persist an invoice's selected service location through the existing atomic
-- document creation path, including installations with an older core body.
alter table public.invoices add column if not exists property_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.invoices'::regclass and conname='invoices_service_property_fkey'
  ) then
    alter table public.invoices add constraint invoices_service_property_fkey
      foreign key (property_id, business_id) references public.properties(id, business_id)
      on delete set null (property_id);
  end if;
  if to_regprocedure('private.create_document(uuid,text,uuid,jsonb)') is null then
    alter function public.create_document(uuid,text,uuid,jsonb) set schema private;
  end if;
end $$;

create or replace function private.validate_invoice_location() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.property_id is null then
    if new.job_id is not null then
      select j.property_id into new.property_id from public.jobs j
      where j.id=new.job_id and j.business_id=new.business_id and j.customer_id=new.customer_id;
    end if;
    if new.property_id is null and new.estimate_id is not null then
      select e.property_id into new.property_id from public.estimates e
      where e.id=new.estimate_id and e.business_id=new.business_id and e.customer_id=new.customer_id;
    end if;
  end if;
  if new.property_id is not null and not exists (
    select 1 from public.properties p
    where p.id=new.property_id and p.business_id=new.business_id and p.customer_id=new.customer_id
  ) then
    raise exception 'Choose a service address belonging to this customer' using errcode='23503';
  end if;
  return new;
end $$;

drop trigger if exists invoice_validate_location on public.invoices;
create trigger invoice_validate_location
before insert or update of property_id, customer_id, job_id, estimate_id on public.invoices
for each row execute function private.validate_invoice_location();

create or replace function public.create_document(target_business_id uuid, document_kind text, request_id uuid, payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare
  document jsonb;
  site uuid;
begin
  document := private.create_document(target_business_id, document_kind, request_id, payload);
  site := nullif(payload->>'property_id','')::uuid;
  if document_kind='invoice' and site is not null then
    update public.invoices i set property_id=site
    where i.business_id=target_business_id and i.id=(document->>'id')::uuid
      and i.property_id is distinct from site;
    document := document || jsonb_build_object('property_id',site);
  end if;
  return document;
end $$;

revoke all on function private.create_document(uuid,text,uuid,jsonb),public.create_document(uuid,text,uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function private.create_document(uuid,text,uuid,jsonb),public.create_document(uuid,text,uuid,jsonb) to authenticated, service_role;

-- Making a reviewed quote available for approval is separate from confirming
-- delivery through a personal app. Only the actor who prepared a share can
-- release it, and the approval stays bound to the reviewed scope and price.
alter table private.document_shares add column if not exists approval_ready_at timestamptz;

create or replace function private.release_personal_approval(p_business uuid,p_token text) returns void
language plpgsql security definer set search_path='' as $$
declare
  share private.document_shares%rowtype;
  current_snapshot jsonb;
begin
  if auth.uid() is null or p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise exception 'Share unavailable' using errcode='42501';
  end if;
  select * into share from private.document_shares
  where business_id=p_business and token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
    and actor_id=auth.uid() and revoked_at is null and expires_at>now()
  for update;
  if not found or share.kind not in ('estimate','change_order')
     or not private.fin_access(p_business, case share.kind when 'estimate' then 'estimates' else 'change_orders' end, true) then
    raise exception 'Share unavailable' using errcode='42501';
  end if;
  current_snapshot := private.customer_document_snapshot(p_business,share.kind,share.document_id)
    || jsonb_build_object('finviant_branding',share.snapshot->'finviant_branding');
  if current_snapshot->>'status' not in ('draft','sent') or
     (current_snapshot-'status'-'balance_due'-'amount_paid') is distinct from (share.snapshot-'status'-'balance_due'-'amount_paid') then
    raise exception 'This document changed. Review it and prepare a fresh link.' using errcode='23514';
  end if;
  update private.document_shares set approval_ready_at=coalesce(approval_ready_at,now()) where token_hash=share.token_hash;
end $$;

create or replace function public.release_personal_approval(p_business uuid,p_token text) returns void
language sql set search_path='' as $$ select private.release_personal_approval(p_business,p_token) $$;

revoke all on function private.release_personal_approval(uuid,text),public.release_personal_approval(uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.release_personal_approval(uuid,text),public.release_personal_approval(uuid,text) to authenticated;

create or replace function public.get_shared_document(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare share private.document_shares%rowtype; snap jsonb;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Link unavailable' using errcode='42501';end if;
  select * into share from private.document_shares
  where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and revoked_at is null and expires_at>now();
  if not found then raise exception 'This link is expired or unavailable.' using errcode='42501';end if;
  snap:=private.customer_document_snapshot(share.business_id,share.kind,share.document_id)
    || jsonb_build_object('finviant_branding',share.snapshot->'finviant_branding');
  if (snap-'status'-'balance_due'-'amount_paid') is distinct from (share.snapshot-'status'-'balance_due'-'amount_paid') then
    raise exception 'This document changed. Request a fresh link from the business.' using errcode='23514';
  end if;
  if snap->>'status'='void' then raise exception 'This document was voided.';end if;
  return snap || jsonb_build_object(
    'approval_token', case when snap->>'status'='sent' or
      (snap->>'status'='draft' and share.approval_ready_at is not null) then share.approval_token end,
    'approval_ready_at', share.approval_ready_at, 'expires_at', share.expires_at
  );
end $$;

-- NULL means a conventional approval link, whose original status rules apply.
create or replace function private.personal_approval_available(p_business uuid,p_kind text,p_document uuid,p_hash text)
returns boolean language plpgsql stable set search_path='' as $$
declare share private.document_shares%rowtype; snap jsonb;
begin
  select * into share from private.document_shares
  where business_id=p_business and kind=p_kind and document_id=p_document and approval_token is not null
    and encode(sha256(convert_to(approval_token,'UTF8')),'hex')=p_hash
  limit 1;
  if not found then return null;end if;
  if share.revoked_at is not null or share.expires_at<=now() then return false;end if;
  snap:=private.customer_document_snapshot(p_business,p_kind,p_document)
    || jsonb_build_object('finviant_branding',share.snapshot->'finviant_branding');
  return (snap->>'status'='sent' or (snap->>'status'='draft' and share.approval_ready_at is not null))
    and (snap-'status'-'balance_due'-'amount_paid') = (share.snapshot-'status'-'balance_due'-'amount_paid');
end $$;

revoke all on function private.personal_approval_available(uuid,text,uuid,text) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.consume_document_approval(p_token_hash text, p_action text, p_typed_name text, p_user_agent text, p_terms_agreed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  l public.document_approval_links%rowtype;
  existing public.document_approvals%rowtype;
  snap jsonb;
  amount numeric;
  result_id uuid;
  personal boolean;
begin
  if p_action not in ('approved','declined') then raise exception 'INVALID_ACTION' using errcode='22023'; end if;
  if char_length(btrim(coalesce(p_typed_name,''))) < 2 or char_length(btrim(p_typed_name)) > 200 then raise exception 'INVALID_NAME' using errcode='22023'; end if;

  select * into l from public.document_approval_links where token_hash=p_token_hash for update;
  if not found then raise exception 'LINK_NOT_FOUND' using errcode='P0002'; end if;

  select * into existing from public.document_approvals where approval_link_id=l.id;
  if found then
    return jsonb_build_object('approval_id',existing.id,'action',existing.action,'already_consumed',true,'created_at',existing.created_at,'amount',existing.amount_at_action,'document_type',existing.document_type);
  end if;

  if l.revoked_at is not null then raise exception 'LINK_REVOKED' using errcode='P0001'; end if;
  if l.expires_at <= now() then raise exception 'LINK_EXPIRED' using errcode='P0001'; end if;

  if l.document_type='estimate' then
    select e.total,
      jsonb_build_object(
        'document_type','estimate','id',e.id,'number',e.estimate_number,'status',e.status,'issue_date',e.issue_date,'expires_on',e.expires_on,
        'subtotal',e.subtotal,'tax_amount',e.tax_amount,'total',e.total,'customer_message',e.customer_message,
        'items',coalesce((select jsonb_agg(jsonb_build_object('description',i.description,'quantity',i.quantity,'unit_price',i.unit_price,'tax_rate',i.tax_rate,'line_total',i.line_total) order by i.sort_order) from public.estimate_items i where i.estimate_id=e.id),'[]'::jsonb)
      ) into amount,snap
    from public.estimates e where e.id=l.estimate_id and e.business_id=l.business_id for update;
    if not found then raise exception 'DOCUMENT_NOT_FOUND' using errcode='P0002'; end if;
    personal := private.personal_approval_available(l.business_id,l.document_type,l.estimate_id,p_token_hash);
    if personal is false or ((snap->>'status') <> 'sent' and personal is distinct from true) then
      raise exception 'DOCUMENT_NOT_APPROVABLE' using errcode='P0001';
    end if;
    if p_action='approved' and p_terms_agreed is distinct from true then
      raise exception 'TERMS_NOT_ACCEPTED' using errcode='22023';
    end if;
    if p_action='approved' then
      snap:=snap || jsonb_build_object(
        'terms_accepted',true,
        'terms_accepted_at',now(),
        'terms_version','estimate_agreement_2026_10_v1',
        'terms_statement','I have reviewed the estimate, including the scope, prices, taxes, total amount, validity date, and any additional terms shown above. I agree to these terms and authorize the issuing business to proceed with the quoted work.'
      );
    else
      snap:=snap || jsonb_build_object('terms_accepted',false);
    end if;
    update public.estimates set status=case when p_action='approved' then 'accepted' else 'declined' end where id=l.estimate_id;
  else
    perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||l.business_id::text,0));
    select coalesce((c.change_totals->>'revised_total')::numeric,c.total),
      jsonb_build_object(
        'document_type','change_order','id',c.id,'number',c.change_order_number,'status',c.status,'title',c.title,'description',c.description,'reason',c.reason,
        'change_totals',c.change_totals,'schedule_impact_days',c.schedule_impact_days,'schedule_note',c.schedule_note,'issue_date',c.issue_date,
        'subtotal',c.subtotal,'tax_amount',c.tax_amount,'total',c.total,'customer_message',c.customer_message,
        'items',coalesce((select jsonb_agg(jsonb_build_object('description',i.description,'quantity',i.quantity,'unit_price',i.unit_price,'tax_rate',i.tax_rate,'line_total',i.line_total) order by i.sort_order) from public.change_order_items i where i.change_order_id=c.id),'[]'::jsonb)
      ) into amount,snap
    from public.change_orders c where c.id=l.change_order_id and c.business_id=l.business_id for update;
    if not found then raise exception 'DOCUMENT_NOT_FOUND' using errcode='P0002'; end if;
    personal := private.personal_approval_available(l.business_id,l.document_type,l.change_order_id,p_token_hash);
    if personal is false or ((snap->>'status') <> 'sent' and personal is distinct from true) then
      raise exception 'DOCUMENT_NOT_APPROVABLE' using errcode='P0001';
    end if;
    update public.change_orders set status=case when p_action='approved' then 'approved' else 'declined' end where id=l.change_order_id;
  end if;

  insert into public.document_approvals(approval_link_id,business_id,document_type,estimate_id,change_order_id,action,typed_name,amount_at_action,document_snapshot,user_agent)
  values(l.id,l.business_id,l.document_type,l.estimate_id,l.change_order_id,p_action,btrim(p_typed_name),amount,snap,left(p_user_agent,500))
  returning id into result_id;

  update public.document_approval_links set revoked_at=now() where id=l.id;
  return jsonb_build_object('approval_id',result_id,'action',p_action,'already_consumed',false,'amount',amount,'document_type',l.document_type);
end $function$;
