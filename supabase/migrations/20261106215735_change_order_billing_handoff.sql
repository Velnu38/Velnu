-- Each approved change can be allocated to one invoice.
create table private.change_order_billing (
  change_order_id uuid primary key references public.change_orders(id),
  invoice_id uuid not null references public.invoices(id)
);
create index change_order_billing_invoice on private.change_order_billing(invoice_id);
alter table private.change_order_billing enable row level security;
revoke all on private.change_order_billing from public,anon,authenticated,service_role;

create function private.change_order_billing_state(c public.change_orders) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare i public.invoices%rowtype; parent public.invoices%rowtype;
begin
  if c.status<>'approved' then return jsonb_build_object('action','awaiting_approval');end if;
  select v.* into i from private.change_order_billing a join public.invoices v on v.id=a.invoice_id
  where a.change_order_id=c.id and v.business_id=c.business_id;
  if found then return jsonb_build_object('action','billed','invoice_id',i.id,'number',i.invoice_number,'status',i.status);end if;
  if c.source_invoice_id is not null then
    select * into parent from public.invoices where id=c.source_invoice_id and business_id=c.business_id;
  elsif c.estimate_id is not null then
    select * into parent from public.invoices where estimate_id=c.estimate_id and business_id=c.business_id;
    if not found then return jsonb_build_object('action','included_on_final');end if;
    -- Older final invoices might already contain this change, but lack an allocation.
    if c.approved_at is null or c.approved_at<=parent.created_at then
      return jsonb_build_object('action','verify_existing','invoice_id',parent.id,'number',parent.invoice_number);
    end if;
  else return jsonb_build_object('action','manual_review');
  end if;
  if parent.id is null or parent.status='void' or c.total<=0 then
    return jsonb_build_object('action','manual_review');
  end if;
  return jsonb_build_object('action',case when parent.status='draft' then 'add_to_draft' else 'create_invoice' end,
    'invoice_id',parent.id,'number',parent.invoice_number,'total',parent.total,'change_total',c.total);
end $$;

create function public.get_change_order_billing(p_change uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.change_orders%rowtype;
begin
  select * into c from public.change_orders where id=p_change;
  if not found or auth.uid() is null or not private.member_module_access(c.business_id,auth.uid(),'billing')
    or not private.can_write_business(c.business_id) then
    raise exception 'Billing access is required.' using errcode='42501';
  end if;
  return private.change_order_billing_state(c);
end $$;

create function public.bill_approved_change_order(p_change uuid,p_action text,p_expected_total numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare state jsonb;c public.change_orders%rowtype;parent public.invoices%rowtype; i uuid; next_sort integer;items jsonb;
begin
  perform public.get_change_order_billing(p_change);
  select * into c from public.change_orders where id=p_change;
  perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||c.business_id::text,0));
  select * into c from public.change_orders where id=p_change for update;
  state:=private.change_order_billing_state(c);
  if state->>'action'='billed' then return state;end if;
  if p_action is null or p_action not in ('add_to_draft','create_invoice')
     or state->>'action' is distinct from p_action then
    raise exception 'Billing changed. Reopen this change order before billing.' using errcode='23514';
  end if;
  select * into parent from public.invoices where id=(state->>'invoice_id')::uuid and business_id=c.business_id for update;
  if not found or parent.status='void' or (parent.status='draft') is distinct from (p_action='add_to_draft')
     or parent.total is distinct from p_expected_total or parent.customer_id<>c.customer_id then
    raise exception 'The invoice changed. Reopen the change order to review the new balance.' using errcode='23514';
  end if;
  if p_action='add_to_draft' then
    i:=parent.id;
    select coalesce(max(sort_order),0)+1 into next_sort from public.invoice_items where invoice_id=i and business_id=c.business_id;
    insert into public.invoice_items(invoice_id,business_id,description,quantity,unit_price,tax_rate,sort_order,source_change_order_id)
    select i,c.business_id,left('Change order '||coalesce(c.change_order_number,c.title)||': '||description,1000),
      quantity,unit_price,tax_rate,next_sort+row_number() over(order by sort_order,id)::integer-1,c.id
    from public.change_order_items where change_order_id=c.id and business_id=c.business_id;
  else
    select jsonb_agg(jsonb_build_object('description',left('Change order '||coalesce(c.change_order_number,c.title)||': '||description,1000),
      'quantity',quantity,'unit_price',unit_price,'tax_rate',tax_rate) order by sort_order,id)
    into items from public.change_order_items where change_order_id=c.id and business_id=c.business_id;
    i:=(public.create_document(c.business_id,'invoice',gen_random_uuid(),jsonb_build_object(
      'customer_id',c.customer_id,'items',items,'customer_message',
      'Approved change order '||coalesce(c.change_order_number,c.title)||' for invoice '||coalesce(parent.invoice_number,parent.id::text)||'.'))->>'id')::uuid;
    update public.invoice_items set source_change_order_id=c.id where invoice_id=i and business_id=c.business_id;
  end if;
  insert into private.change_order_billing(change_order_id,invoice_id) values(c.id,i);
  return private.change_order_billing_state(c);
end $$;

revoke all on function private.change_order_billing_state(public.change_orders) from public,anon,authenticated,service_role;
revoke all on function public.get_change_order_billing(uuid),public.bill_approved_change_order(uuid,text,numeric) from public,anon,service_role;
grant execute on function public.get_change_order_billing(uuid),public.bill_approved_change_order(uuid,text,numeric) to authenticated;

create or replace function private.prepare_estimate_final(p_estimate uuid,p_due date default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.estimates%rowtype; d public.invoices%rowtype; iid uuid; co record; n integer;
begin
 select * into e from public.estimates where id=p_estimate for update;
 if not found then raise exception 'Estimate unavailable.';end if;
 select id into iid from public.invoices where estimate_id=e.id;
 if iid is not null then return iid;end if;
 if e.status<>'accepted' then raise exception 'Accept the estimate before creating its final invoice.';end if;
 if p_due is not null and p_due<(now() at time zone(select timezone from public.businesses where id=e.business_id))::date then raise exception 'Due date cannot be in the past.';end if;
 select * into d from public.invoices where deposit_estimate_id=e.id and status<>'void' for update;
 if found and (d.status<>'paid' or d.amount_paid<>d.total) then raise exception 'Settle the deposit invoice first, or void it if no payment was received, then prepare the final invoice.' using errcode='23514';end if;
 if not exists(select 1 from public.estimate_items where estimate_id=e.id) then raise exception 'The approved estimate has no line items.';end if;
 insert into public.invoices(business_id,customer_id,job_id,estimate_id,due_date,notes,customer_message,payment_links,payment_instructions,deposit_source_invoice_id,deposit_credit)
 values(e.business_id,e.customer_id,e.job_id,e.id,p_due,e.notes,concat_ws(E'\n\n',e.customer_message,case when d.id is not null then 'Deposit received on '||coalesce(d.invoice_number,d.id::text)||': $'||d.amount_paid::text||'. This amount is credited in the final balance below.' end),coalesce(e.payment_links,(select payment_links from public.business_settings where business_id=e.business_id),'[]'::jsonb),coalesce(e.payment_instructions,(select payment_instructions from public.business_settings where business_id=e.business_id),''),d.id,coalesce(d.amount_paid,0)) returning id into iid;
 insert into public.invoice_items(invoice_id,business_id,description,quantity,unit_price,tax_rate,sort_order,source_estimate_line_id)
 select iid,business_id,description,quantity,unit_price,tax_rate,sort_order,id from public.estimate_items where estimate_id=e.id order by sort_order;
 select coalesce(max(sort_order),0)+1 into n from public.invoice_items where invoice_id=iid;
 -- Approved additions are copied once, together with the original approved scope.
 for co in select c.id,c.change_order_number,c.title from public.change_orders c where c.business_id=e.business_id and c.status='approved' and c.source_invoice_id is null and not exists(select 1 from private.change_order_billing a where a.change_order_id=c.id) and (c.estimate_id=e.id or (c.estimate_id is null and c.job_id=e.job_id)) order by c.created_at,c.id loop
  insert into public.invoice_items(invoice_id,business_id,description,quantity,unit_price,tax_rate,sort_order,source_change_order_id)
  select iid,business_id,left('Change order '||coalesce(co.change_order_number,co.title)||': '||description,1000),quantity,unit_price,tax_rate,n+row_number() over(order by sort_order,id)::integer,co.id from public.change_order_items where change_order_id=co.id order by sort_order,id;
  insert into private.change_order_billing(change_order_id,invoice_id) values(co.id,iid);
  select coalesce(max(sort_order),0)+1 into n from public.invoice_items where invoice_id=iid;
 end loop;
 update public.estimates set status='converted' where id=e.id;
 return iid;
end $$;

-- Draft editors must not discard approved, already allocated charges.
create function private.guard_allocated_change_order_item() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.source_estimate_line_id is not null or old.source_change_order_id is not null and exists(select 1 from private.change_order_billing
     where change_order_id=old.source_change_order_id and invoice_id=old.invoice_id) then
    raise exception 'This line comes from approved work. Keep it on the invoice to preserve the approval record.' using errcode='23514';
  end if;
  if tg_op='DELETE' then return old;end if;
  return new;
end $$;
create trigger guard_allocated_change_order_item before update or delete on public.invoice_items
for each row execute function private.guard_allocated_change_order_item();
revoke all on function private.guard_allocated_change_order_item() from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.update_draft_document(target_business_id uuid, document_kind text, document_id uuid, expected_updated_at timestamp with time zone, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$declare d jsonb;t text;it text;fk text;x jsonb;k integer:=0;result jsonb;dt date; protected record; match_index integer; kept_items jsonb;begin if auth.uid() is null or not private.can_write_business(target_business_id) then raise exception 'Not authorized' using errcode='42501';end if;if document_kind not in('invoice','estimate') then raise exception 'Invalid document type';end if;t:=case when document_kind='invoice' then 'invoices' else 'estimates' end;it:=case when document_kind='invoice' then 'invoice_items' else 'estimate_items' end;fk:=document_kind||'_id';execute format('select to_jsonb(d) from public.%I d where id=$1 and business_id=$2 for update',t) into d using document_id,target_business_id;if d is null or d->>'status'<>'draft' then raise exception 'Only an available draft can be edited';end if;if expected_updated_at is null or(d->>'updated_at')::timestamptz<>expected_updated_at then raise exception 'This draft changed in another session. Reload it before saving.' using errcode='40001';end if;if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 50 then raise exception 'Add 1 to 50 line items';end if;if length(coalesce(payload->>'notes',''))>4000 or length(coalesce(payload->>'customer_message',''))>4000 then raise exception 'Notes must be at most 4000 characters';end if;dt:=nullif(coalesce(payload->>'due_date',payload->>'expires_on'),'')::date;if dt is not null and dt<(d->>'issue_date')::date then raise exception 'Due or expiration date cannot precede the issue date';end if;execute format('update public.%I set customer_id=$1,%I=$2,notes=$3,customer_message=$4 where id=$5 and business_id=$6',t,case when document_kind='invoice' then 'due_date' else 'expires_on' end) using(payload->>'customer_id')::uuid,dt,payload->>'notes',payload->>'customer_message',document_id,target_business_id;kept_items:=payload->'items';
if document_kind='invoice' then
 for protected in select description,quantity,unit_price,tax_rate from public.invoice_items
  where invoice_id=document_id and business_id=target_business_id and (source_change_order_id is not null or source_estimate_line_id is not null) order by sort_order,id
 loop
  select ordinality::integer-1 into match_index
  from jsonb_array_elements(kept_items) with ordinality as item(value,ordinality)
  where btrim(value->>'description')=protected.description
    and (value->>'quantity')::numeric=protected.quantity
    and (value->>'unit_price')::numeric=protected.unit_price
    and coalesce((value->>'tax_rate')::numeric,0)=protected.tax_rate
  order by ordinality limit 1;
  if not found then raise exception 'Keep the lines from the approved estimate and change orders on the draft.' using errcode='23514';end if;
  kept_items:=kept_items-match_index;
 end loop;
 delete from public.invoice_items where invoice_id=document_id and business_id=target_business_id and source_change_order_id is null and source_estimate_line_id is null;
 select coalesce(max(sort_order)+1,0) into k from public.invoice_items where invoice_id=document_id and business_id=target_business_id;
else
 execute format('delete from public.%I where %I=$1 and business_id=$2',it,fk) using document_id,target_business_id;
end if;
for x in select value from jsonb_array_elements(kept_items) loop execute format('insert into public.%I(%I,business_id,description,quantity,unit_price,tax_rate,sort_order) values($1,$2,$3,$4,$5,$6,$7)',it,fk) using document_id,target_business_id,btrim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'tax_rate')::numeric,0),k;k:=k+1;end loop;execute format('select to_jsonb(d) from public.%I d where id=$1',t) into result using document_id;return result;end$function$;

create function private.guard_change_invoice_customer() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.customer_id is distinct from old.customer_id
    and (exists(select 1 from private.change_order_billing where invoice_id=old.id)
      or exists(select 1 from public.invoice_items where invoice_id=old.id and business_id=old.business_id and source_estimate_line_id is not null)) then
    raise exception 'This invoice is linked to an approved customer change. Its customer cannot change.' using errcode='23514';
  end if;
  return new;
end $$;
create trigger guard_change_invoice_customer before update of customer_id on public.invoices
for each row execute function private.guard_change_invoice_customer();
revoke all on function private.guard_change_invoice_customer() from public,anon,authenticated,service_role;
