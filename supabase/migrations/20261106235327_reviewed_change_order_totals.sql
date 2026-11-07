-- Keep a signed, tax-inclusive agreement summary separate from billing lines.
-- Issued documents and older approval links retain their historical data.
alter table public.change_orders add column change_totals jsonb;

create function private.change_order_scope_amounts(b uuid,k text,d uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  with documents as (
    select e.id estimate_id,null::uuid invoice_id,e.customer_id,e.job_id
    from public.estimates e where k='estimate' and e.id=d and e.business_id=b
    union all
    select coalesce(v.estimate_id,v.deposit_estimate_id),v.id,v.customer_id,coalesce(e.job_id,v.job_id)
    from public.invoices v
    left join public.estimates e on e.id=coalesce(v.estimate_id,v.deposit_estimate_id) and e.business_id=b
    where k='invoice' and v.id=d and v.business_id=b
  ), source as (
    select s.*,case
      when e.id is null then v.subtotal+v.tax_amount-coalesce((
        select sum(i.line_total+round(i.line_total*i.tax_rate/100,2))
        from public.invoice_items i join public.change_orders co on co.id=i.source_change_order_id
        where i.invoice_id=v.id and i.business_id=b and co.source_invoice_id=v.id
      ),0)
      when f.id is null then e.total
      when exists(select 1 from public.invoice_items i where i.invoice_id=f.id and i.source_estimate_line_id is not null)
        or exists(select 1 from private.change_order_billing a join public.change_orders co on co.id=a.change_order_id
          where a.invoice_id=f.id and co.estimate_id=e.id and co.approved_at<=f.created_at) then
        e.total+coalesce((select sum(i.line_total+round(i.line_total*i.tax_rate/100,2)) from public.invoice_items i
          where i.invoice_id=f.id and i.business_id=b and i.source_estimate_line_id is null and i.source_change_order_id is null),0)
      -- Older converted invoices have no source line identifiers. Their gross
      -- already included the estimate changes approved at the time of conversion.
      else f.subtotal+f.tax_amount-coalesce((
        select sum(i.line_total+round(i.line_total*i.tax_rate/100,2)) from public.invoice_items i
        where i.invoice_id=f.id and i.business_id=b and i.source_change_order_id is not null
      ),0)-coalesce((
        select sum(co.total) from public.change_orders co where co.business_id=b and co.customer_id=s.customer_id
          and co.status='approved' and co.source_invoice_id is null and co.approved_at<=f.created_at
          and (co.estimate_id=e.id or (co.estimate_id is null and co.job_id=e.job_id))
          and not exists(select 1 from private.change_order_billing a where a.change_order_id=co.id)
      ),0)
    end base
    from documents s
    left join public.estimates e on e.id=s.estimate_id and e.business_id=b
    left join public.invoices v on v.id=s.invoice_id and v.business_id=b
    left join public.invoices f on f.estimate_id=s.estimate_id and f.business_id=b and f.status<>'void'
  ), related as (
    select v.id,v.amount_paid,v.deposit_estimate_id from public.invoices v cross join source s
    where v.business_id=b and v.customer_id=s.customer_id and v.status<>'void'
      and (v.id=s.invoice_id or (s.estimate_id is not null and s.estimate_id in (v.estimate_id,v.deposit_estimate_id)))
  ), approved as (
    select co.id,coalesce((co.change_totals->>'change_amount')::numeric,co.total) amount
    from public.change_orders co cross join source s
    where co.business_id=b and co.customer_id=s.customer_id and co.status='approved' and
      (co.source_invoice_id=s.invoice_id or (s.estimate_id is not null and
        (co.estimate_id=s.estimate_id or co.source_invoice_id in (select id from related)
          or (co.source_invoice_id is null and co.estimate_id is null and co.job_id=s.job_id))))
  ), payments as (
    select coalesce(sum(v.amount_paid) filter(where v.deposit_estimate_id is not null),0) deposit_paid,
      coalesce(sum(v.amount_paid) filter(where v.deposit_estimate_id is null),0) other_paid
    from public.invoices v cross join source s
    where v.business_id=b and v.customer_id=s.customer_id and v.status<>'void'
      and (v.id in (select id from related) or exists(select 1 from private.change_order_billing a
        join approved c on c.id=a.change_order_id where a.invoice_id=v.id))
  )
  select jsonb_build_object('current_total',s.base+coalesce((select sum(amount) from approved),0),
    'deposit_paid',p.deposit_paid,'other_paid',p.other_paid)
  from source s cross join payments p
$$;

create function private.write_change_order_totals(p_change uuid,p_kind text,p_document uuid,p_expected numeric,
  p_subtotal_delta numeric default null,p_tax_delta numeric default null,p_offset numeric default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.change_orders%rowtype; scope jsonb; base numeric; delta numeric;
begin
  select * into strict c from public.change_orders where id=p_change;
  scope:=private.change_order_scope_amounts(c.business_id,p_kind,p_document);
  base:=(scope->>'current_total')::numeric;
  delta:=c.total+p_offset;
  if base is null or (p_expected is not null and p_expected<>base) then
    raise exception 'The current total changed. Reopen the change order to review the latest amount.' using errcode='40001';
  end if;
  if base+delta<0 then
    raise exception 'The revised total cannot be below zero. Review the change amount.' using errcode='23514';
  end if;
  update public.change_orders set change_totals=scope||jsonb_build_object(
    'change_amount',delta,'revised_total',base+delta,'revision_subtotal',p_subtotal_delta,'revision_tax',p_tax_delta,
    'manual_billing',coalesce(p_subtotal_delta<0,false) or p_offset<>0
  ) where id=c.id returning * into c;
  return to_jsonb(c);
end $$;

-- Linked and addition-only drafts use the same locking and permission checks.
create function private.create_scoped_change_order(p_kind text,p_document uuid,p_request uuid,p_input jsonb,
  p_subtotal_delta numeric default null,p_tax_delta numeric default null,p_offset numeric default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb;b uuid;existing jsonb;body jsonb;result jsonb;
begin
  context:=private.document_change_context(p_kind,p_document);b:=(context->>'business_id')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
  context:=private.document_change_context(p_kind,p_document);
  select to_jsonb(c) into existing from public.change_orders c where c.business_id=b and c.request_id=p_request;
  if existing is not null then
    if (p_kind='invoice' and (existing->>'source_invoice_id')::uuid is distinct from p_document)
      or (p_kind='estimate' and (existing->>'source_invoice_id' is not null or (existing->>'estimate_id')::uuid is distinct from p_document)) then
      raise exception 'This request belongs to a different source document.' using errcode='23505';
    end if;
    context:=context||jsonb_build_object('customer_id',existing->>'customer_id','job_id',existing->>'job_id','estimate_id',existing->>'estimate_id');
  elsif not coalesce((context->>'can_change')::boolean,false) then
    raise exception 'This work is complete or the document is no longer active.' using errcode='23514';
  end if;
  body:=coalesce(p_input,'{}'::jsonb)||jsonb_build_object('customer_id',context->>'customer_id','job_id',context->>'job_id',
    'estimate_id',context->>'estimate_id','source_invoice_id',case when p_kind='invoice' then p_document end,
    'notes','Requested from '||p_kind||' '||coalesce(context->>'number',p_document::text)||'.');
  result:=public.create_change_order_document(b,p_request,body);
  if existing is not null then return result; end if;
  return private.write_change_order_totals((result->>'id')::uuid,p_kind,p_document,
    (p_input->>'expected_current_total')::numeric,p_subtotal_delta,p_tax_delta,p_offset);
end $$;

create function private.create_scoped_change_order_entry(p_kind text,p_document uuid,p_request uuid,p_input jsonb)
returns jsonb language sql security definer set search_path='' as $$
  select private.create_scoped_change_order(p_kind,p_document,p_request,p_input)
$$;
create or replace function public.create_document_change_order(p_kind text,p_document uuid,p_request uuid,p_input jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.create_scoped_change_order_entry(p_kind,p_document,p_request,p_input)
$$;

create function private.document_change_review_context(k text,d uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb;
begin
  context:=private.document_change_context(k,d);
  return context||private.change_order_scope_amounts((context->>'business_id')::uuid,k,d);
end $$;
create or replace function public.get_document_change_context(p_kind text,p_document uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select private.document_change_review_context(p_kind,p_document)
$$;

-- Capture the agreed amount and reject a stale offer rather than changing it
-- under the customer. Changes to separately recorded payments do not reprice it.
create function private.guard_reviewed_change_totals() returns trigger
language plpgsql security definer set search_path='' as $$
declare current_amount numeric; k text; d uuid; expected_change numeric; r private.change_order_line_revisions;
begin
  if new.change_totals is null or new.status not in ('sent','approved') or new.status=old.status then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||new.business_id::text,0));
  k:=case when new.source_invoice_id is null then 'estimate' else 'invoice' end;
  d:=coalesce(new.source_invoice_id,new.estimate_id);
  current_amount:=(private.change_order_scope_amounts(new.business_id,k,d)->>'current_total')::numeric;
  if current_amount is distinct from (new.change_totals->>'current_total')::numeric then
    raise exception 'The approved scope total changed. Create a fresh change order for the new total.' using errcode='23514';
  end if;
  select * into r from private.change_order_line_revisions where change_order_id=new.id;
  expected_change:=new.total+coalesce((new.change_totals->>'revision_subtotal')::numeric
    +(new.change_totals->>'revision_tax')::numeric
    -(r.billed_line->>'unit_price')::numeric
    -round((r.billed_line->>'unit_price')::numeric*(r.billed_line->>'tax_rate')::numeric/100,2),0);
  if expected_change is distinct from (new.change_totals->>'change_amount')::numeric then
    raise exception 'The saved change items differ from the reviewed total. Create a fresh change order.' using errcode='23514';
  end if;
  return new;
end $$;
create trigger guard_reviewed_change_totals before update of status on public.change_orders
for each row execute function private.guard_reviewed_change_totals();

create function private.protect_change_totals() returns trigger
language plpgsql set search_path='' as $$
begin
  if current_user in ('authenticated','anon') and
    (case when tg_op='INSERT' then new.change_totals is not null else new.change_totals is distinct from old.change_totals end) then
    raise exception 'Change totals are set when a change order is saved.' using errcode='42501';
  end if;
  return new;
end $$;
create trigger protect_change_totals before insert or update of change_totals on public.change_orders
for each row execute function private.protect_change_totals();

revoke all on function private.change_order_scope_amounts(uuid,text,uuid),
  private.write_change_order_totals(uuid,text,uuid,numeric,numeric,numeric,numeric),
  private.create_scoped_change_order(text,uuid,uuid,jsonb,numeric,numeric,numeric),
  private.create_scoped_change_order_entry(text,uuid,uuid,jsonb),private.document_change_review_context(text,uuid),
  private.guard_reviewed_change_totals(),private.protect_change_totals() from public,anon,authenticated,service_role;
grant execute on function private.create_scoped_change_order_entry(text,uuid,uuid,jsonb),
  private.document_change_review_context(text,uuid) to authenticated;

-- Use approval order, including when the latest change lowers the price.
create sequence private.change_revision_approval_sequence;
alter table private.change_order_line_revisions add column approval_sequence bigint;
revoke all on sequence private.change_revision_approval_sequence from public,anon,authenticated,service_role;

create or replace function private.current_change_source_lines(b uuid,kind text,document uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
  with source as (
    select coalesce(i.source_estimate_line_id,i.id) id,i.description,i.quantity,i.unit_price,i.tax_rate,i.sort_order,
      case when i.source_estimate_line_id is not null then v.estimate_id end estimate_id
    from public.invoice_items i join public.invoices v on v.id=i.invoice_id and v.business_id=i.business_id
    where kind='invoice' and i.invoice_id=document and i.business_id=b and i.source_change_order_id is null
      and (v.estimate_id is null or i.source_estimate_line_id is not null
        or exists(select 1 from public.invoice_items anchor where anchor.invoice_id=document
          and anchor.business_id=b and anchor.source_estimate_line_id is not null)
        or not exists(select 1 from public.change_orders historical where historical.business_id=b
          and historical.estimate_id=v.estimate_id and historical.source_invoice_id is null and historical.status='approved'))
    union all
    select id,description,quantity,unit_price,tax_rate,sort_order,document estimate_id
    from public.estimate_items where kind='estimate' and estimate_id=document and business_id=b
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'description',s.description) ||
    coalesce(r.revised,jsonb_build_object('quantity',s.quantity,'unit_price',s.unit_price,'tax_rate',s.tax_rate))
    order by s.sort_order,s.id),'[]'::jsonb)
  from source s
  left join lateral (
    select lr.revised
    from private.change_order_line_revisions lr
    join public.change_orders co on co.id=lr.change_order_id
    where lr.source_line_id=s.id and co.business_id=b and co.status='approved'
      and ((kind='invoice' and co.source_invoice_id=document)
        or (s.estimate_id is not null and co.source_invoice_id is null and co.estimate_id=s.estimate_id)
        or (s.estimate_id is not null and exists(select 1 from public.invoices i
          where i.id=co.source_invoice_id and i.business_id=b and i.estimate_id=s.estimate_id)))
    order by lr.approval_sequence desc nulls last,co.approved_at desc nulls last,co.created_at desc,co.id desc limit 1
  ) r on true;
$$;

create or replace function public.create_linked_change_order(p_kind text,p_document uuid,p_request uuid,p_input jsonb,p_revision jsonb)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb;b uuid;old_line jsonb;new_line jsonb;previous jsonb;
  q numeric;price numeric;rate numeric;delta numeric;old_amount numeric;new_amount numeric;
  tax_delta numeric; charge numeric; description text; offset_amount numeric;
  result jsonb;existing public.change_orders%rowtype;prior_revision private.change_order_line_revisions%rowtype;
  items jsonb;signature text;line_id uuid;
begin
  context:=private.document_change_context(p_kind,p_document);b:=(context->>'business_id')::uuid;
  if p_request is null or jsonb_typeof(p_input) is distinct from 'object'
     or jsonb_typeof(p_input->'items') is distinct from 'array' or pg_column_size(p_input)>60000 then
    raise exception 'Invalid change order request.' using errcode='22023';
  end if;
  line_id:=(p_revision->>'id')::uuid;
  if line_id is null then raise exception 'Choose an original line item.' using errcode='22023';end if;
  signature:=encode(sha256(convert_to(jsonb_build_array(p_kind,p_document,p_input,p_revision)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
  select * into existing from public.change_orders where business_id=b and request_id=p_request;
  if found then
    select * into prior_revision from private.change_order_line_revisions where change_order_id=existing.id;
    if prior_revision.previous->>'request_fingerprint' is distinct from signature then
      raise exception 'This request already saved different content.' using errcode='23505';
    end if;
    return to_jsonb(existing);
  end if;
  select value into old_line from jsonb_array_elements(private.current_change_source_lines(b,p_kind,p_document))
  where value->>'id'=line_id::text;
  if old_line is null or old_line is distinct from p_revision->'previous' then
    raise exception 'This line changed. Reload the original document and review the latest approved values.' using errcode='23514';
  end if;
  q:=(p_revision->>'quantity')::numeric;price:=(p_revision->>'unit_price')::numeric;rate:=(old_line->>'tax_rate')::numeric;
  description:=btrim(coalesce(p_revision->>'description',old_line->>'description'));
  if q is null or q not between 0 and 100000 or q<>round(q,2)
     or price is null or price not between 0 and 10000000 or price<>round(price,2) or length(description) not between 1 and 1000 then
    raise exception 'Check the revised quantity and price.' using errcode='22023';
  end if;
  old_amount:=round((old_line->>'quantity')::numeric*(old_line->>'unit_price')::numeric,2);
  new_amount:=round(q*price,2);delta:=new_amount-old_amount;
  if (q,price,description) is not distinct from ((old_line->>'quantity')::numeric,(old_line->>'unit_price')::numeric,old_line->>'description')
     and nullif(btrim(p_input->>'description'),'') is null and jsonb_array_length(p_input->'items')=0
     and coalesce((p_input->>'schedule_impact_days')::integer,0)=0 then
    raise exception 'Revise an item or describe the scope change.' using errcode='22023';
  end if;
  tax_delta:=round(new_amount*rate/100,2)-round(old_amount*rate/100,2);
  -- Standard invoices carry non-negative charges. Preserve any difference
  -- they cannot represent exactly for a credit or billing review.
  charge:=case when delta>0 and delta<=10000000 and round(delta*rate/100,2)=tax_delta then delta else 0 end;
  offset_amount:=delta+tax_delta-charge-round(charge*rate/100,2);
  previous:=old_line||jsonb_build_object('request_fingerprint',signature);
  new_line:=jsonb_build_object('description',description,'quantity',q,'unit_price',price,'tax_rate',rate);
  items:=jsonb_build_array(jsonb_build_object(
    'description',format('%s: %s × $%s → %s: %s × $%s',left(old_line->>'description',310),old_line->>'quantity',old_line->>'unit_price',
      left(description,310),q,price),'quantity',1,'unit_price',charge,'tax_rate',rate)) || (p_input->'items');
  result:=private.create_scoped_change_order(p_kind,p_document,p_request,p_input||jsonb_build_object('items',items),delta,tax_delta,offset_amount);
  insert into private.change_order_line_revisions(change_order_id,source_line_id,previous,revised,billed_line)
  values((result->>'id')::uuid,line_id,previous,new_line,items->0);
  return result;
end $$;

create or replace function private.check_change_order_line_revision() returns trigger
language plpgsql security definer set search_path='' as $$
declare saved private.change_order_line_revisions%rowtype;actual jsonb;kind text;document uuid;
begin
  if new.status not in ('sent','approved') or new.status=old.status then return new;end if;
  select * into saved from private.change_order_line_revisions where change_order_id=new.id;
  if not found then return new;end if;
  perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||new.business_id::text,0));
  kind:=case when new.source_invoice_id is null then 'estimate' else 'invoice' end;
  document:=coalesce(new.source_invoice_id,new.estimate_id);
  select value into actual from jsonb_array_elements(private.current_change_source_lines(new.business_id,kind,document))
  where value->>'id'=saved.source_line_id::text;
  if not exists(select 1 from public.change_order_items i where i.change_order_id=new.id
      and i.business_id=new.business_id and i.sort_order=0 and
      jsonb_build_object('description',i.description,'quantity',i.quantity,'unit_price',i.unit_price,'tax_rate',i.tax_rate)=saved.billed_line) then
    raise exception 'The linked adjustment was changed. Create a new change order before requesting approval.' using errcode='23514';
  end if;
  if actual is distinct from (saved.previous-'request_fingerprint') then
    raise exception 'An approved change updated this line. Create a new change order using the latest values.' using errcode='23514';
  end if;
  if new.status='approved' then
    update private.change_order_line_revisions set approval_sequence=nextval('private.change_revision_approval_sequence')
    where change_order_id=new.id and source_line_id=saved.source_line_id;
  end if;
  return new;
end $$;

create or replace function private.change_order_billing_state(c public.change_orders) returns jsonb
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
  if parent.id is null or parent.status='void' or parent.deposit_estimate_id is not null
    or coalesce((c.change_totals->>'manual_billing')::boolean,false) then
    return jsonb_build_object('action','manual_review');
  end if;
  if c.total=0 then return jsonb_build_object('action','scope_only');end if;
  return jsonb_build_object('action',case when parent.status='draft' then 'add_to_draft' else 'create_invoice' end,
    'invoice_id',parent.id,'number',parent.invoice_number,'total',parent.total,'change_total',c.total);
end $$;

create or replace function private.prepare_estimate_final(p_estimate uuid,p_due date default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.estimates%rowtype; d public.invoices%rowtype; iid uuid; co record; n integer; b uuid;
begin
 select business_id into b from public.estimates where id=p_estimate;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
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
 select iid,e.business_id,l.description,l.quantity,l.unit_price,l.tax_rate,ordinality::integer-1,l.id
 from jsonb_array_elements(private.current_change_source_lines(e.business_id,'estimate',e.id)) with ordinality as item(value,ordinality)
 cross join lateral jsonb_to_record(item.value) as l(id uuid,description text,quantity numeric,unit_price numeric,tax_rate numeric)
 where l.quantity>0 order by item.ordinality;
 select coalesce(max(sort_order),0)+1 into n from public.invoice_items where invoice_id=iid;
 -- Approved additions are copied once, together with the original approved scope.
 for co in select c.id,c.change_order_number,c.title from public.change_orders c where c.business_id=e.business_id and c.status='approved' and c.source_invoice_id is null and not exists(select 1 from private.change_order_billing a where a.change_order_id=c.id) and (c.estimate_id=e.id or (c.estimate_id is null and c.job_id=e.job_id)) order by c.created_at,c.id loop
  insert into public.invoice_items(invoice_id,business_id,description,quantity,unit_price,tax_rate,sort_order,source_change_order_id)
  select iid,business_id,left('Change order '||coalesce(co.change_order_number,co.title)||': '||description,1000),quantity,unit_price,tax_rate,n+row_number() over(order by sort_order,id)::integer,co.id
  from public.change_order_items where change_order_id=co.id
    and (sort_order<>0 or not exists(select 1 from private.change_order_line_revisions where change_order_id=co.id))
  order by sort_order,id;
  insert into private.change_order_billing(change_order_id,invoice_id) values(co.id,iid);
  select coalesce(max(sort_order),0)+1 into n from public.invoice_items where invoice_id=iid;
 end loop;
 if not exists(select 1 from public.invoice_items where invoice_id=iid) then
   raise exception 'There is no remaining scope to invoice. Review the approved changes.' using errcode='23514';
 end if;
 if exists(select 1 from public.invoices where id=iid and deposit_credit>subtotal+tax_amount) then
   raise exception 'The deposit exceeds the revised total. Review a credit or refund before issuing a final invoice.' using errcode='23514';
 end if;
 update public.estimates set status='converted' where id=e.id;
 return iid;
end $$;

create or replace function private.customer_document_snapshot(b uuid,k text,d uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare doc jsonb; lines jsonb; c jsonb;company jsonb;t text;fk text;
begin
 if k not in('invoice','estimate','change_order') then raise exception 'Invalid document';end if;
 t:=case k when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end;
 fk:=k||'_id';
 execute format('select to_jsonb(x) from public.%I x where business_id=$1 and id=$2',t) into doc using b,d;
 if doc is null then raise exception 'Document unavailable' using errcode='42501';end if;
 execute format('select coalesce(jsonb_agg(jsonb_build_object(''description'',description,''quantity'',quantity,''unit_price'',unit_price,''tax_rate'',tax_rate,''line_total'',line_total) order by sort_order,id),''[]''::jsonb) from public.%I where business_id=$1 and %I=$2',k||'_items',fk) into lines using b,d;
 select jsonb_build_object('name',coalesce(nullif(btrim(concat_ws(' ',first_name,last_name)),''),customers.company,'Customer'),'email',email,'phone',phone) into c from public.customers where business_id=b and id=(doc->>'customer_id')::uuid;
 select jsonb_build_object('name',name,'email',email,'phone',phone,'address_line1',address_line1,'city',city,'state',state,'postal_code',postal_code) into company from public.businesses where id=b;
 if jsonb_typeof(doc->'issuer_snapshot')='object' then company:=jsonb_build_object('name',doc#>>'{issuer_snapshot,name}','email',doc#>>'{issuer_snapshot,email}','phone',doc#>>'{issuer_snapshot,phone}','address_line1',doc#>>'{issuer_snapshot,address_line1}','city',doc#>>'{issuer_snapshot,city}','state',doc#>>'{issuer_snapshot,state}','postal_code',doc#>>'{issuer_snapshot,postal_code}');end if;
 return jsonb_build_object('kind',k,'number',doc->>(k||'_number'),'status',doc->>'status','issue_date',doc->>'issue_date','due_date',doc->>'due_date','expires_on',doc->>'expires_on',
 'subtotal',doc->'subtotal','tax_amount',doc->'tax_amount','total',doc->'total','balance_due',doc->'balance_due','amount_paid',doc->'amount_paid',
 'customer_message',doc->>'customer_message','payment_links',case when k='invoice' then coalesce(doc->'payment_links','[]') else '[]'::jsonb end,
 'payment_instructions',case when k='invoice' then doc->>'payment_instructions' end,'title',doc->>'title','items',lines,'customer',c,'company',company,'finviant_branding',private.effective_plan(b)='free')
    || case when jsonb_typeof(doc->'change_totals')='object' then jsonb_build_object('change_totals',doc->'change_totals') else '{}'::jsonb end;
end $$;

CREATE OR REPLACE FUNCTION public.consume_document_approval(p_token_hash text, p_action text, p_typed_name text, p_user_agent text, p_terms_agreed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  l public.document_approval_links%rowtype;
  existing public.document_approvals%rowtype;
  snap jsonb;
  amount numeric;
  result_id uuid;
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
    if (snap->>'status') <> 'sent' then raise exception 'DOCUMENT_NOT_APPROVABLE' using errcode='P0001'; end if;
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
    if (snap->>'status') <> 'sent' then raise exception 'DOCUMENT_NOT_APPROVABLE' using errcode='P0001'; end if;
    update public.change_orders set status=case when p_action='approved' then 'approved' else 'declined' end where id=l.change_order_id;
  end if;

  insert into public.document_approvals(approval_link_id,business_id,document_type,estimate_id,change_order_id,action,typed_name,amount_at_action,document_snapshot,user_agent)
  values(l.id,l.business_id,l.document_type,l.estimate_id,l.change_order_id,p_action,btrim(p_typed_name),amount,snap,left(p_user_agent,500))
  returning id into result_id;

  update public.document_approval_links set revoked_at=now() where id=l.id;
  return jsonb_build_object('approval_id',result_id,'action',p_action,'already_consumed',false,'amount',amount,'document_type',l.document_type);
end $function$;

CREATE OR REPLACE FUNCTION public.prepare_document_email(p_actor uuid, p_business uuid, p_kind text, p_document uuid, p_request uuid, p_origin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o private.finviant_email_outbox%rowtype;d jsonb;b record;c record;items_text text;body_text text;subj text;label text;number text;tok text;approval_url text;plan_name text;new_payload jsonb;
begin
 if not private.member_module_access(p_business,p_actor,'billing') then raise exception 'Billing access denied' using errcode='42501';end if;
 if p_actor is null or p_request is null or p_document is null or p_kind is null or p_kind not in('invoice','estimate','change_order') then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if p_origin is null or p_origin not in('https://finviant.com','https://www.finviant.com','https://app.finviant.com') then raise exception 'INVALID_APP_ORIGIN' using errcode='22023';end if;
 if not exists(select 1 from public.business_members where business_id=p_business and user_id=p_actor and role in('owner','admin','office')) or not exists(select 1 from public.user_agreement_acceptances where user_id=p_actor and terms_accepted and ai_disclosure_acknowledged and electronic_records_consent) then raise exception 'ACCESS_DENIED' using errcode='42501';end if;
 plan_name:=private.effective_plan(p_business);
 if plan_name is distinct from 'pro' then raise exception 'PAID_FEATURE_REQUIRED' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-email:'||p_business::text,0));
 select * into o from private.finviant_email_outbox where id=p_request;
 if found then if o.business_id<>p_business or o.document_kind<>p_kind or o.document_id<>p_document then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;return jsonb_build_object('id',o.id,'status',o.status);end if;
 select * into o from private.finviant_email_outbox where business_id=p_business and document_kind=p_kind and document_id=p_document and status in('queued','sending','uncertain','reconciliation_required') order by created_at desc limit 1;
 if found then return jsonb_build_object('id',o.id,'status',o.status);end if;
 if (select count(*) from private.finviant_email_outbox where business_id=p_business and created_at>now()-interval '1 hour')>=100 then raise exception 'EMAIL_RATE_LIMIT' using errcode='P0001';end if;
 select name,email,phone,currency into b from public.businesses where id=p_business;if not found then raise exception 'BUSINESS_NOT_FOUND' using errcode='P0002';end if;
 if p_kind='invoice' then
  select jsonb_build_object('customer_id',customer_id,'number',invoice_number,'status',status,'total',total,'amount_paid',amount_paid,'balance_due',balance_due,'issue_date',issue_date,'due_date',due_date,'customer_message',customer_message,'issuer_snapshot',issuer_snapshot,'payment_links',payment_links,'payment_instructions',payment_instructions) into d from public.invoices where id=p_document and business_id=p_business for update;
  select string_agg(description||' | Qty '||quantity::text||' x '||unit_price::text||case when tax_rate>0 and round(line_total*tax_rate/100,2)<>0 then ' | Tax '||tax_rate::text||'%' else '' end,E'\n' order by sort_order,id) into items_text from public.invoice_items where invoice_id=p_document and business_id=p_business;label:='Invoice';
 elsif p_kind='estimate' then
  select jsonb_build_object('customer_id',customer_id,'number',estimate_number,'status',status,'total',total,'issue_date',issue_date,'customer_message',customer_message,'issuer_snapshot',issuer_snapshot) into d from public.estimates where id=p_document and business_id=p_business for update;
  select string_agg(description||' | Qty '||quantity::text||' x '||unit_price::text||case when tax_rate>0 and round(line_total*tax_rate/100,2)<>0 then ' | Tax '||tax_rate::text||'%' else '' end,E'\n' order by sort_order,id) into items_text from public.estimate_items where estimate_id=p_document and business_id=p_business;label:='Estimate';
 else
  select jsonb_build_object('customer_id',customer_id,'number',change_order_number,'status',status,'total',total,'issue_date',issue_date,'customer_message',customer_message,'title',title,'schedule_impact_days',schedule_impact_days,'change_totals',change_totals,'issuer_snapshot',issuer_snapshot) into d from public.change_orders where id=p_document and business_id=p_business for update;
  select string_agg(description||case when jsonb_typeof(d->'change_totals')='object' then ''
    else ' | Qty '||quantity::text||' x '||unit_price::text end,E'\n' order by sort_order,id) into items_text from public.change_order_items where change_order_id=p_document and business_id=p_business;label:='Change order';
 end if;
 if d is null then raise exception 'DOCUMENT_NOT_FOUND' using errcode='P0002';end if;
 if d->>'status' in('void','converted','expired','declined','accepted','approved') then raise exception 'DOCUMENT_NOT_SENDABLE' using errcode='23514';end if;
 if items_text is null then raise exception 'LINE_ITEMS_REQUIRED' using errcode='23514';end if;
 select id,first_name,last_name,company,email into c from public.customers where id=(d->>'customer_id')::uuid and business_id=p_business;
 if not found or c.email is null or c.email !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then raise exception 'VALID_RECIPIENT_REQUIRED' using errcode='23514';end if;
 if jsonb_typeof(d->'issuer_snapshot')='object' then b.name:=coalesce(d#>>'{issuer_snapshot,name}',b.name);b.email:=d#>>'{issuer_snapshot,email}';b.phone:=d#>>'{issuer_snapshot,phone}';end if;number:=coalesce(d->>'number',label);subj:=regexp_replace(b.name||': '||label||' '||number,E'[\r\n]',' ','g');
 body_text:=b.name||E'\n'||label||' '||number||E'\n\nHello '||coalesce(nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''),c.company,'Customer')||E',\n\n'||coalesce(d->>'title','')||E'\n'||items_text||case when jsonb_typeof(d->'change_totals')='object' then
   E'\n\nCurrent total: '||coalesce(b.currency,'USD')||' '||(d#>>'{change_totals,current_total}')||
   E'\nThis change: '||coalesce(b.currency,'USD')||' '||(d#>>'{change_totals,change_amount}')||
   E'\nRevised total: '||coalesce(b.currency,'USD')||' '||(d#>>'{change_totals,revised_total}')
 else E'\n\nTotal: '||coalesce(b.currency,'USD')||' '||(d->>'total') end||E'\n'||coalesce(d->>'customer_message','');
 if p_kind='invoice' then
  body_text:=body_text||E'\nPaid: '||coalesce(d->>'amount_paid','0')||E'\nBalance due: '||coalesce(d->>'balance_due','0')||E'\nDue date: '||coalesce(d->>'due_date','Contact the business')||E'\n'||coalesce(d->>'payment_instructions','')||E'\nPayments are handled by the business directly with its external provider. Include the invoice number with payment.'||coalesce((select string_agg(E'\nPay with '||(l->>'provider')||': '||private.invoice_payment_url(l->>'provider',l->>'url',(d->>'balance_due')::numeric,number,coalesce(b.currency,'USD')),'' order by l->>'provider') from jsonb_array_elements(coalesce(d->'payment_links','[]'::jsonb)) l where coalesce((d->>'balance_due')::numeric,0)>0),'');

 else
  tok:=encode(extensions.gen_random_bytes(32),'hex');approval_url:=p_origin||'/?approval='||tok;
  insert into public.document_approval_links(business_id,document_type,estimate_id,change_order_id,token_hash,expires_at,created_by_user_id) values(p_business,p_kind,case when p_kind='estimate' then p_document end,case when p_kind='change_order' then p_document end,encode(sha256(convert_to(tok,'UTF8')),'hex'),now()+interval '14 days',p_actor);
  body_text:=body_text||E'\n\nReview the scope, amount and terms: '||approval_url||E'\nThis private review link expires in 14 days.';

 end if;
 new_payload:=jsonb_build_object('from','Finviant Office <adminsupport@finviant.com>','to',jsonb_build_array(btrim(c.email)),'subject',subj,'text',body_text,'tags',jsonb_build_array(jsonb_build_object('name','finviant_request_id','value',p_request::text)));
 if p_kind='invoice' then new_payload:=new_payload||jsonb_build_object('html','<div style="font-family:Arial,sans-serif;color:#193843"><pre style="white-space:pre-wrap;font-family:inherit">'||private.html_escape(body_text)||'</pre>'||coalesce((select string_agg('<a style="display:inline-block;padding:12px 18px;margin:6px;border:1px solid #b7d7ce;border-radius:8px;color:#174d43;text-decoration:none" href="'||private.html_escape(private.invoice_payment_url(l->>'provider',l->>'url',(d->>'balance_due')::numeric,number,coalesce(b.currency,'USD')))||'">Pay with '||private.html_escape(case l->>'provider' when 'paypal' then 'PayPal' when 'venmo' then 'Venmo' when 'cashapp' then 'Cash App' when 'stripe' then 'Stripe' else 'Payment provider' end)||'</a>','' order by l->>'provider') from jsonb_array_elements(coalesce(d->'payment_links','[]'::jsonb)) l where coalesce((d->>'balance_due')::numeric,0)>0),'')||'</div>');end if;
 if b.email is not null and b.email ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then new_payload:=new_payload||jsonb_build_object('reply_to',jsonb_build_array(b.email));end if;
 insert into public.messages(id,business_id,customer_id,invoice_id,estimate_id,change_order_id,direction,channel,recipient,subject,body,provider,status) values(p_request,p_business,c.id,case when p_kind='invoice' then p_document end,case when p_kind='estimate' then p_document end,case when p_kind='change_order' then p_document end,'outbound','email',c.email,subj,body_text,'resend','queued');
 insert into private.finviant_email_outbox(id,business_id,actor_id,document_kind,document_id,payload) values(p_request,p_business,p_actor,p_kind,p_document,new_payload);
 return jsonb_build_object('id',p_request,'status','queued');
end;$function$;
