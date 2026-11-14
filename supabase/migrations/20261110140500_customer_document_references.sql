-- Customer-visible reference belongs to this document, never to an invoice total.
-- New/copy drafts default to empty; issued revisions retain their original bytes.
alter table public.invoices add column customer_reference text check(customer_reference is null or (length(btrim(customer_reference)) between 1 and 120 and customer_reference !~ '[[:cntrl:]]'));
alter table public.estimates add column customer_reference text check(customer_reference is null or (length(btrim(customer_reference)) between 1 and 120 and customer_reference !~ '[[:cntrl:]]'));
create function private.guard_customer_reference() returns trigger language plpgsql set search_path='' as $$
begin
 if new.customer_reference is distinct from old.customer_reference and old.status<>'draft' then
  raise exception 'Customer references can only change on a draft. Create a revised document instead.' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function private.guard_customer_reference() from public,anon,authenticated,service_role;
create trigger guard_customer_reference before update on public.invoices for each row execute function private.guard_customer_reference();
create trigger guard_customer_reference before update on public.estimates for each row execute function private.guard_customer_reference();

create function private.inherit_invoice_customer_reference() returns trigger language plpgsql set search_path='' as $$
begin
 if new.customer_reference is null and new.status='draft' and (tg_op='INSERT' or old.status='draft') then
  select e.customer_reference into new.customer_reference from public.estimates e
  where e.business_id=new.business_id and e.customer_id=new.customer_id
   and e.id=coalesce(new.estimate_id,new.deposit_estimate_id,(select source_estimate_id from public.jobs where id=new.job_id and business_id=new.business_id));
 end if;
 return new;
end $$;
revoke all on function private.inherit_invoice_customer_reference() from public,anon,authenticated,service_role;
create trigger inherit_invoice_customer_reference before insert or update of estimate_id,deposit_estimate_id,job_id on public.invoices for each row execute function private.inherit_invoice_customer_reference();

-- Preserve current authorization, request fingerprints, approved line guards,
-- timestamps and issued snapshot behavior in the existing atomic paths.
CREATE OR REPLACE FUNCTION private.create_document(target_business_id uuid, document_kind text, request_id uuid, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$declare new_id uuid;result jsonb;x jsonb;k integer:=0;customer uuid;site uuid;new_customer jsonb;links jsonb;instructions text;dt date;issued date;today date;fingerprint text;begin if auth.uid() is null or not private.can_write_business(target_business_id) then raise exception 'Not authorized' using errcode='42501';end if;if document_kind not in('invoice','estimate') or request_id is null then raise exception 'Invalid document request';end if;fingerprint:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended(target_business_id::text||request_id::text,0));if document_kind='invoice' then select to_jsonb(i) into result from public.invoices i where business_id=target_business_id and i.request_id=create_document.request_id;else select to_jsonb(e) into result from public.estimates e where business_id=target_business_id and e.request_id=create_document.request_id;end if;if result is not null then if result->>'request_fingerprint' is distinct from fingerprint then raise exception 'This request already saved different content. Open the saved document before starting another.' using errcode='23505';end if;return result;end if;if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 50 then raise exception 'Add 1 to 50 line items' using errcode='23514';end if;if length(coalesce(payload->>'notes',''))>4000 or length(coalesce(payload->>'customer_message',''))>4000 then raise exception 'Notes must be at most 4000 characters';end if;customer:=(payload->>'customer_id')::uuid;new_customer:=payload->'new_customer';
if new_customer is not null and jsonb_typeof(new_customer)='object' then
 if length(btrim(coalesce(new_customer->>'first_name','')))+length(btrim(coalesce(new_customer->>'last_name','')))=0 then raise exception 'Enter a customer name';end if;
 if length(coalesce(new_customer->>'first_name',''))>160 or length(coalesce(new_customer->>'last_name',''))>160 or length(coalesce(new_customer->>'email',''))>254 or length(coalesce(new_customer->>'phone',''))>40 then raise exception 'Customer details are too long';end if;
 insert into public.customers(id,business_id,first_name,last_name,email,phone) values(customer,target_business_id,nullif(btrim(new_customer->>'first_name'),''),nullif(btrim(new_customer->>'last_name'),''),nullif(btrim(new_customer->>'email'),''),nullif(btrim(new_customer->>'phone'),'')) on conflict(id) do nothing;
 if not exists(select 1 from public.customers c where c.id=customer and c.business_id=target_business_id and not c.archived and c.first_name is not distinct from nullif(btrim(new_customer->>'first_name'),'') and c.last_name is not distinct from nullif(btrim(new_customer->>'last_name'),'') and c.email is not distinct from nullif(btrim(new_customer->>'email'),'') and c.phone is not distinct from nullif(btrim(new_customer->>'phone'),'')) then raise exception 'These customer details were saved differently. Refresh and choose the saved customer.' using errcode='23505';end if;
end if;
if payload ? 'business_contact' then
 if not private.is_primary_owner(target_business_id) then raise exception 'Only the primary owner can change business contact details.' using errcode='42501';end if;
 if jsonb_typeof(payload->'business_contact')<>'object' or length(coalesce(payload->'business_contact'->>'email',''))>254 or length(coalesce(payload->'business_contact'->>'phone',''))>40 then raise exception 'Enter valid business contact details.';end if;
 if nullif(btrim(payload->'business_contact'->>'email'),'') is not null and btrim(payload->'business_contact'->>'email') !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then raise exception 'Enter a valid business reply email.';end if;
 if coalesce(payload->'business_contact'->>'phone','') ~ '[[:cntrl:]]' then raise exception 'Enter a valid contact phone.';end if;
 update public.businesses set email=nullif(btrim(payload->'business_contact'->>'email'),''),phone=nullif(btrim(payload->'business_contact'->>'phone'),'') where id=target_business_id;
end if;
if (payload ? 'payment_links' or payload ? 'payment_instructions') and not private.is_primary_owner(target_business_id) then raise exception 'Only the primary account owner can set payment destinations.' using errcode='42501';end if;
if payload ? 'payment_links' and jsonb_typeof(payload->'payment_links')<>'array' then raise exception 'Choose valid payment methods';end if;
links:=coalesce(payload->'payment_links',(select payment_links from public.business_settings where business_id=target_business_id),'[]'::jsonb);
instructions:=coalesce(payload->>'payment_instructions',(select payment_instructions from public.business_settings where business_id=target_business_id),'');
if length(instructions)>2000 then raise exception 'Payment instructions must be at most 2000 characters';end if;
site:=nullif(payload->>'property_id','')::uuid;if site is not null and not exists(select 1 from public.properties p where p.id=site and p.business_id=target_business_id and p.customer_id=customer) then raise exception 'Choose a service address belonging to this customer' using errcode='23503';end if;today:=(now() at time zone(select timezone from public.businesses where id=target_business_id))::date;
issued:=coalesce(nullif(payload->>'issue_date','')::date,today);
if issued>today or issued<date '1900-01-01' then raise exception 'Choose an issue date from 1900 through today';end if;
if nullif(payload->>'issue_date','') is not null and (payload->>'issue_date' !~ '^\d{4}-\d{2}-\d{2}$' or issued::text<>payload->>'issue_date') then raise exception 'Choose a valid issue date';end if;
dt:=nullif(case when document_kind='invoice' then payload->>'due_date' else payload->>'expires_on' end,'')::date;
if dt is not null and dt<issued then raise exception 'Due or expiration date cannot precede the issue date';end if;if document_kind='invoice' then insert into public.invoices(business_id,customer_id,issue_date,due_date,notes,customer_message,customer_reference,request_id,request_fingerprint,payment_links,payment_instructions,work_completed) values(target_business_id,customer,issued,dt,payload->>'notes',payload->>'customer_message',nullif(btrim(payload->>'customer_reference'),''),request_id,fingerprint,links,instructions,coalesce((payload->>'work_completed')::boolean,false)) returning id into new_id;else insert into public.estimates(business_id,customer_id,property_id,issue_date,expires_on,notes,customer_message,customer_reference,request_id,request_fingerprint,payment_links,payment_instructions) values(target_business_id,customer,site,issued,dt,payload->>'notes',payload->>'customer_message',nullif(btrim(payload->>'customer_reference'),''),request_id,fingerprint,links,instructions) returning id into new_id;end if;for x in select value from jsonb_array_elements(payload->'items') loop if document_kind='invoice' then insert into public.invoice_items(invoice_id,business_id,description,quantity,unit_price,tax_rate,sort_order) values(new_id,target_business_id,btrim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'tax_rate')::numeric,0),k);else insert into public.estimate_items(estimate_id,business_id,description,quantity,unit_price,tax_rate,sort_order) values(new_id,target_business_id,btrim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'tax_rate')::numeric,0),k);end if;k:=k+1;end loop;if document_kind='invoice' then select to_jsonb(i) into result from public.invoices i where id=new_id;else select to_jsonb(e) into result from public.estimates e where id=new_id;end if;return result;end$function$;

CREATE OR REPLACE FUNCTION public.update_draft_document(target_business_id uuid, document_kind text, document_id uuid, expected_updated_at timestamp with time zone, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$declare d jsonb;t text;it text;fk text;x jsonb;k integer:=0;result jsonb;dt date; protected record; match_index integer; kept_items jsonb;begin if auth.uid() is null or not private.can_write_business(target_business_id) then raise exception 'Not authorized' using errcode='42501';end if;if document_kind not in('invoice','estimate') then raise exception 'Invalid document type';end if;t:=case when document_kind='invoice' then 'invoices' else 'estimates' end;it:=case when document_kind='invoice' then 'invoice_items' else 'estimate_items' end;fk:=document_kind||'_id';execute format('select to_jsonb(d) from public.%I d where id=$1 and business_id=$2 for update',t) into d using document_id,target_business_id;if d is null or d->>'status'<>'draft' then raise exception 'Only an available draft can be edited';end if;if expected_updated_at is null or(d->>'updated_at')::timestamptz<>expected_updated_at then raise exception 'This draft changed in another session. Reload it before saving.' using errcode='40001';end if;if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 50 then raise exception 'Add 1 to 50 line items';end if;if length(coalesce(payload->>'notes',''))>4000 or length(coalesce(payload->>'customer_message',''))>4000 then raise exception 'Notes must be at most 4000 characters';end if;dt:=nullif(coalesce(payload->>'due_date',payload->>'expires_on'),'')::date;if dt is not null and dt<(d->>'issue_date')::date then raise exception 'Due or expiration date cannot precede the issue date';end if;execute format('update public.%I set customer_id=$1,%I=$2,notes=$3,customer_message=$4,customer_reference=$7 where id=$5 and business_id=$6',t,case when document_kind='invoice' then 'due_date' else 'expires_on' end) using(payload->>'customer_id')::uuid,dt,payload->>'notes',payload->>'customer_message',document_id,target_business_id,case when payload?'customer_reference' then nullif(btrim(payload->>'customer_reference'),'') else d->>'customer_reference' end;kept_items:=payload->'items';
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

create or replace function private.create_job_invoice(job uuid,request uuid,items jsonb,due date default null,details jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.jobs%rowtype;b uuid;existing uuid;document jsonb;
begin
 select business_id into b from public.jobs where id=job;
 if b is null or auth.uid() is null or not private.member_module_access(b,auth.uid(),'jobs') or not private.member_module_access(b,auth.uid(),'billing')
 or not exists(select 1 from public.business_members where business_id=b and user_id=auth.uid() and role in('owner','admin','office')) then raise exception 'Job and billing access are required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
 select * into j from public.jobs where id=job and business_id=b for update;
 select id into existing from public.invoices where job_id=j.id and business_id=b and status<>'void' order by created_at limit 1;
 if existing is not null then return jsonb_build_object('id',existing,'already_created',true);end if;
 document:=public.create_document(b,'invoice',request,jsonb_build_object('customer_id',j.customer_id,'job_id',j.id,'items',items,'due_date',due,'issue_date',details->>'issue_date','notes',details->>'notes','customer_reference',details->>'customer_reference','work_completed',coalesce((details->>'work_completed')::boolean,false))||jsonb_strip_nulls(jsonb_build_object('business_contact',details->'business_contact'))||jsonb_strip_nulls(jsonb_build_object('payment_links',details->'payment_links','payment_instructions',details->>'payment_instructions')));
 update public.invoices set job_id=j.id where id=(document->>'id')::uuid and business_id=b;
 return document||jsonb_build_object('already_created',false);
end $$;

create or replace function private.customer_document_snapshot(b uuid,k text,d uuid) returns jsonb
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
  ) || case when nullif(doc->>'customer_reference','') is not null then jsonb_build_object('customer_reference',doc->>'customer_reference') else '{}'::jsonb end || case when jsonb_typeof(doc->'change_totals')='object' then jsonb_build_object('change_totals',doc->'change_totals') else '{}'::jsonb end;
end $$;
