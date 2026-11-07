-- Record the exact approved revision separately from the billable difference.
create table private.change_order_line_revisions (
  change_order_id uuid not null references public.change_orders(id) on delete cascade,
  source_line_id uuid not null,
  previous jsonb not null,
  revised jsonb not null,
  billed_line jsonb not null,
  primary key (change_order_id,source_line_id)
);
alter table private.change_order_line_revisions enable row level security;
revoke all on private.change_order_line_revisions from public,anon,authenticated,service_role;

-- Final invoice rows retain their original estimate line identity.
create unique index estimate_items_change_source_tenant on public.estimate_items(id,business_id);
alter table public.invoice_items add column source_estimate_line_id uuid;
alter table public.invoice_items add constraint invoice_items_source_estimate_line_fk
  foreign key (source_estimate_line_id,business_id) references public.estimate_items(id,business_id);
create index invoice_items_source_estimate_line on public.invoice_items(source_estimate_line_id)
  where source_estimate_line_id is not null;
alter table public.invoice_items add column source_change_order_id uuid;
alter table public.invoice_items add constraint invoice_items_source_change_order_fk
  foreign key (source_change_order_id,business_id) references public.change_orders(id,business_id);
create index invoice_items_source_change_order on public.invoice_items(source_change_order_id) where source_change_order_id is not null;

create function private.current_change_source_lines(b uuid,kind text,document uuid) returns jsonb
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
    order by round((lr.revised->>'quantity')::numeric*(lr.revised->>'unit_price')::numeric,2) desc,co.id desc limit 1
  ) r on true;
$$;

create function public.get_change_order_source_lines(p_kind text,p_document uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare context jsonb;
begin
  context:=private.document_change_context(p_kind,p_document);
  return private.current_change_source_lines((context->>'business_id')::uuid,p_kind,p_document);
end $$;

create function public.create_linked_change_order(p_kind text,p_document uuid,p_request uuid,p_input jsonb,p_revision jsonb)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb;b uuid;old_line jsonb;new_line jsonb;previous jsonb;
  q numeric;price numeric;rate numeric;delta numeric;old_amount numeric;new_amount numeric;
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
  if q is null or q not between 0.01 and 100000 or q<>round(q,2)
     or price is null or price not between 0 and 10000000 or price<>round(price,2) then
    raise exception 'Check the revised quantity and price.' using errcode='22023';
  end if;
  old_amount:=round((old_line->>'quantity')::numeric*(old_line->>'unit_price')::numeric,2);
  new_amount:=round(q*price,2);delta:=new_amount-old_amount;
  if delta<=0 then
    raise exception 'This adjustment does not increase the price. Use a credit or scope-only review before billing.' using errcode='23514';
  end if;
  if delta>10000000 or round(delta*rate/100,2)<>round(new_amount*rate/100,2)-round(old_amount*rate/100,2) then
    raise exception 'This change needs a manual billing review because of the amount or tax rounding.' using errcode='23514';
  end if;
  previous:=old_line||jsonb_build_object('request_fingerprint',signature);
  new_line:=jsonb_build_object('quantity',q,'unit_price',price,'tax_rate',rate);
  items:=jsonb_build_array(jsonb_build_object('description',left(old_line->>'description',770)||
    format(' (was %s × $%s; now %s × $%s)',old_line->>'quantity',old_line->>'unit_price',q,price),
    'quantity',1,'unit_price',delta,'tax_rate',rate)) || (p_input->'items');
  result:=public.create_document_change_order(p_kind,p_document,p_request,p_input||jsonb_build_object('items',items));
  insert into private.change_order_line_revisions(change_order_id,source_line_id,previous,revised,billed_line)
  values((result->>'id')::uuid,line_id,previous,new_line,items->0);
  return result;
end $$;

create function private.check_change_order_line_revision() returns trigger
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
  return new;
end $$;
create trigger check_change_order_line_revision before update of status on public.change_orders
for each row execute function private.check_change_order_line_revision();
revoke all on function private.current_change_source_lines(uuid,text,uuid),private.check_change_order_line_revision()
  from public,anon,authenticated,service_role;
revoke all on function public.get_change_order_source_lines(text,uuid),public.create_linked_change_order(text,uuid,uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.get_change_order_source_lines(text,uuid),public.create_linked_change_order(text,uuid,uuid,jsonb,jsonb)
  to authenticated;
