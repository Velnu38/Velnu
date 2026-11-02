-- Document-scoped changes can exist before a job is scheduled.
alter table public.change_orders alter column job_id drop not null;
alter table public.change_orders add column source_invoice_id uuid;
alter table public.change_orders add constraint change_order_source_invoice_tenant_fk foreign key(source_invoice_id,business_id) references public.invoices(id,business_id);
create index change_order_source_invoice_idx on public.change_orders(source_invoice_id,business_id) where source_invoice_id is not null;
alter table public.change_orders add constraint change_order_has_source check(job_id is not null or estimate_id is not null or source_invoice_id is not null);
alter table public.estimates add column payment_links jsonb;
alter table public.estimates add column payment_instructions text;
alter table public.estimates add constraint estimate_payment_links_valid check(payment_links is null or private.valid_payment_links(payment_links));
alter table public.estimates add constraint estimate_payment_instructions_length check(length(payment_instructions)<=2000);
create trigger owner_estimate_destinations before insert or update on public.estimates for each row execute function private.guard_invoice_destinations();

create function private.document_change_context(kind text,document uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb;b uuid;customer uuid;job uuid;estimate uuid;site uuid;job_status text;items jsonb;eligible boolean;
begin
 if kind='invoice' then select to_jsonb(i) into d from public.invoices i where i.id=document;
 elsif kind='estimate' then select to_jsonb(e) into d from public.estimates e where e.id=document;
 else raise exception 'Choose an invoice or estimate.' using errcode='22023';end if;
 b:=(d->>'business_id')::uuid;
 if b is null or auth.uid() is null or not private.member_module_access(b,auth.uid(),'billing') or not private.can_write_business(b) then raise exception 'Document access is required.' using errcode='42501';end if;
 customer:=(d->>'customer_id')::uuid;job:=(d->>'job_id')::uuid;
 estimate:=case when kind='estimate' then document else (d->>'estimate_id')::uuid end;
 if job is null and estimate is not null then select e.job_id into job from public.estimates e where e.id=estimate and e.business_id=b;end if;
 if job is not null then select j.status,j.property_id into job_status,site from public.jobs j where j.id=job and j.business_id=b;end if;
 if site is null and estimate is not null then select e.property_id into site from public.estimates e where e.id=estimate and e.business_id=b;end if;
 eligible:=case when kind='invoice' then d->>'status' in('draft','sent','viewed','partial','paid','overdue') else d->>'status' in('draft','sent','accepted','converted') end and coalesce(job_status,'unscheduled') not in('completed','canceled');
 if kind='invoice' then select jsonb_agg(jsonb_build_object('description',description,'quantity',quantity,'unit_price',unit_price,'tax_rate',tax_rate) order by sort_order) into items from public.invoice_items where invoice_id=document and business_id=b;
 else select jsonb_agg(jsonb_build_object('description',description,'quantity',quantity,'unit_price',unit_price,'tax_rate',tax_rate) order by sort_order) into items from public.estimate_items where estimate_id=document and business_id=b;end if;
 return jsonb_build_object('business_id',b,'document_id',document,'kind',kind,'number',coalesce(d->>'invoice_number',d->>'estimate_number'),'customer_id',customer,
 'customer_name',(select coalesce(nullif(btrim(concat_ws(' ',first_name,last_name)),''),company,'Customer') from public.customers where id=customer and business_id=b),
 'job_id',job,'estimate_id',estimate,'work_status',coalesce(job_status,'unscheduled'),'can_change',eligible,'total',d->'total','items',coalesce(items,'[]'::jsonb),
 'address',(select concat_ws(', ',address_line1,address_line2,city,state,postal_code) from public.properties where id=site and business_id=b));
end $$;
create function public.get_document_change_context(p_kind text,p_document uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.document_change_context(p_kind,p_document) $$;
revoke all on function private.document_change_context(text,uuid),public.get_document_change_context(text,uuid) from public,anon;
grant execute on function private.document_change_context(text,uuid),public.get_document_change_context(text,uuid) to authenticated;

create function private.guard_change_order_source() returns trigger language plpgsql security definer set search_path='' as $$
declare source_customer uuid;source_job uuid;source_status text;
begin
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||new.business_id::text,0));
 if tg_op='UPDATE' then
  if(new.business_id,new.customer_id,new.job_id,new.estimate_id,new.source_invoice_id) is distinct from(old.business_id,old.customer_id,old.job_id,old.estimate_id,old.source_invoice_id) then raise exception 'A change order must keep its original document and customer.' using errcode='23514';end if;
  if new.status not in('sent','approved') or new.status=old.status then return new;end if;
 end if;
 if new.source_invoice_id is not null then
  select i.customer_id,coalesce(i.job_id,e.job_id),i.status into source_customer,source_job,source_status from public.invoices i left join public.estimates e on e.id=i.estimate_id and e.business_id=i.business_id where i.id=new.source_invoice_id and i.business_id=new.business_id for share of i;
  if not found or source_customer<>new.customer_id or (new.job_id is not null and source_job is distinct from new.job_id) or source_status='void' then raise exception 'The source invoice is unavailable or no longer matches this work.' using errcode='23514';end if;
 elsif new.estimate_id is not null then
  select e.customer_id,e.job_id,e.status into source_customer,source_job,source_status from public.estimates e where e.id=new.estimate_id and e.business_id=new.business_id for share;
  if not found or source_customer<>new.customer_id or (new.job_id is not null and source_job is distinct from new.job_id) or source_status in('declined','expired') then raise exception 'The source estimate is unavailable or no longer matches this work.' using errcode='23514';end if;
 end if;
 source_job:=coalesce(source_job,new.job_id);
 if source_job is not null and not exists(select 1 from public.jobs j where j.id=source_job and j.business_id=new.business_id and j.customer_id=new.customer_id and j.status not in('completed','canceled')) then raise exception 'Change orders are available while work is not complete.' using errcode='23514';end if;
 return new;
end $$;
create trigger a_document_change_order_source before insert or update on public.change_orders for each row execute function private.guard_change_order_source();
revoke all on function private.guard_change_order_source() from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.create_change_order_document(target_business_id uuid, request_id uuid, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$declare r jsonb;cid uuid;x jsonb;k integer:=0;fp text;begin if auth.uid() is null or not private.can_write_business(target_business_id) then raise exception 'Not authorized' using errcode='42501';end if;if request_id is null then raise exception 'Request ID is required';end if;fp:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended(target_business_id::text||request_id::text,0));select to_jsonb(c) into r from public.change_orders c where business_id=target_business_id and c.request_id=create_change_order_document.request_id;if r is not null then if r->>'request_fingerprint'<>fp then raise exception 'This request saved different content. Open the saved change order first.';end if;return r;end if;if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 50 or length(btrim(coalesce(payload->>'title',''))) not between 1 and 200 or pg_column_size(payload)>65536 then raise exception 'Use a title and 1 to 50 line items within the size limit';end if;if abs(coalesce((payload->>'schedule_impact_days')::integer,0))>3650 then raise exception 'Schedule impact is outside the supported range';end if;insert into public.change_orders(business_id,customer_id,job_id,estimate_id,source_invoice_id,title,description,reason,schedule_impact_days,schedule_note,notes,customer_message,request_id,request_fingerprint,status) values(target_business_id,(payload->>'customer_id')::uuid,(payload->>'job_id')::uuid,nullif(payload->>'estimate_id','')::uuid,nullif(payload->>'source_invoice_id','')::uuid,btrim(payload->>'title'),payload->>'description',payload->>'reason',coalesce((payload->>'schedule_impact_days')::integer,0),payload->>'schedule_note',payload->>'notes',payload->>'customer_message',request_id,fp,'draft') returning id into cid;for x in select value from jsonb_array_elements(payload->'items') loop insert into public.change_order_items(business_id,change_order_id,description,quantity,unit_price,tax_rate,sort_order) values(target_business_id,cid,btrim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'tax_rate')::numeric,0),k);k:=k+1;end loop;select to_jsonb(c) into r from public.change_orders c where id=cid;return r;end$function$;


create function public.create_document_change_order(p_kind text,p_document uuid,p_request uuid,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare context jsonb;b uuid;existing jsonb;body jsonb;
begin
 context:=public.get_document_change_context(p_kind,p_document);b:=(context->>'business_id')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('document-changes:'||p_document::text,0));
 select to_jsonb(c) into existing from public.change_orders c where c.business_id=b and c.request_id=p_request;
 if existing is not null then
  if (p_kind='invoice' and (existing->>'source_invoice_id')::uuid is distinct from p_document) or (p_kind='estimate' and (existing->>'source_invoice_id' is not null or (existing->>'estimate_id')::uuid is distinct from p_document)) then raise exception 'This request belongs to a different source document.' using errcode='23505';end if;
  context:=context||jsonb_build_object('customer_id',existing->>'customer_id','job_id',existing->>'job_id','estimate_id',existing->>'estimate_id');
 end if;
 body:=coalesce(p_input,'{}'::jsonb)||jsonb_build_object('customer_id',context->>'customer_id','job_id',context->>'job_id','estimate_id',context->>'estimate_id',
 'source_invoice_id',case when p_kind='invoice' then p_document else null end,'notes','Requested from '||p_kind||' '||coalesce(context->>'number',p_document::text)||'.');
 -- An identical completed request remains safely readable after work completes.
 if existing is null and not coalesce((context->>'can_change')::boolean,false) then raise exception 'This work is complete or the document is no longer active.' using errcode='23514';end if;
 return public.create_change_order_document(b,p_request,body);
end $$;
revoke all on function public.create_document_change_order(text,uuid,uuid,jsonb) from public,anon;
grant execute on function public.create_document_change_order(text,uuid,uuid,jsonb) to authenticated;

-- One transaction saves a typed customer and the document; failed pricing/quota saves neither.
CREATE OR REPLACE FUNCTION public.create_document(target_business_id uuid, document_kind text, request_id uuid, payload jsonb)
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
if dt is not null and dt<issued then raise exception 'Due or expiration date cannot precede the issue date';end if;if document_kind='invoice' then insert into public.invoices(business_id,customer_id,issue_date,due_date,notes,customer_message,request_id,request_fingerprint,payment_links,payment_instructions) values(target_business_id,customer,issued,dt,payload->>'notes',payload->>'customer_message',request_id,fingerprint,links,instructions) returning id into new_id;else insert into public.estimates(business_id,customer_id,property_id,issue_date,expires_on,notes,customer_message,request_id,request_fingerprint,payment_links,payment_instructions) values(target_business_id,customer,site,issued,dt,payload->>'notes',payload->>'customer_message',request_id,fingerprint,links,instructions) returning id into new_id;end if;for x in select value from jsonb_array_elements(payload->'items') loop if document_kind='invoice' then insert into public.invoice_items(invoice_id,business_id,description,quantity,unit_price,tax_rate,sort_order) values(new_id,target_business_id,btrim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'tax_rate')::numeric,0),k);else insert into public.estimate_items(estimate_id,business_id,description,quantity,unit_price,tax_rate,sort_order) values(new_id,target_business_id,btrim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'tax_rate')::numeric,0),k);end if;k:=k+1;end loop;if document_kind='invoice' then select to_jsonb(i) into result from public.invoices i where id=new_id;else select to_jsonb(e) into result from public.estimates e where id=new_id;end if;return result;end$function$;


CREATE OR REPLACE FUNCTION public.convert_estimate_to_invoice(target_estimate_id uuid, target_due_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$declare e public.estimates%rowtype;i uuid;begin select * into e from public.estimates where id=target_estimate_id for update;if not found or not private.can_write_business(e.business_id) then raise exception 'Estimate unavailable' using errcode='42501';end if;select id into i from public.invoices where estimate_id=e.id;if i is not null then return i;end if;if e.status<>'accepted' then raise exception 'Accept the estimate before converting it' using errcode='23514';end if;if target_due_date is not null and target_due_date<(now() at time zone(select timezone from public.businesses where id=e.business_id))::date then raise exception 'Invoice due date cannot be in the past';end if;if not exists(select 1 from public.estimate_items where estimate_id=e.id and business_id=e.business_id) then raise exception 'Estimate has no line items';end if;insert into public.invoices(business_id,customer_id,job_id,estimate_id,due_date,notes,customer_message,payment_links,payment_instructions) values(e.business_id,e.customer_id,e.job_id,e.id,target_due_date,e.notes,e.customer_message,coalesce(e.payment_links,(select payment_links from public.business_settings where business_id=e.business_id),'[]'::jsonb),coalesce(e.payment_instructions,(select payment_instructions from public.business_settings where business_id=e.business_id),'')) returning id into i;insert into public.invoice_items(invoice_id,business_id,description,quantity,unit_price,tax_rate,sort_order) select i,business_id,description,quantity,unit_price,tax_rate,sort_order from public.estimate_items where estimate_id=e.id and business_id=e.business_id order by sort_order;update public.estimates set status='converted' where id=e.id;return i;end$function$;


-- Import only owner-reviewed name/contact fields. No messages, credentials or phone-book access.
create function public.import_customer_contacts(p_business uuid,p_contacts jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item jsonb;cid uuid;first text;last text;mail text;v_phone text;imported integer:=0;skipped integer:=0;replayed integer:=0;existing public.customers%rowtype;
begin
 if auth.uid() is null or not private.is_primary_owner(p_business) or not private.can_write_business(p_business) then raise exception 'Only the primary account owner can import contacts.' using errcode='42501';end if;
 if jsonb_typeof(p_contacts) is distinct from 'array' or jsonb_array_length(p_contacts) not between 1 and 100 or pg_column_size(p_contacts)>262144 then raise exception 'Import 1 to 100 reviewed contacts per batch.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('contact-import:'||p_business::text,0));
 for item in select value from jsonb_array_elements(p_contacts) loop
  cid:=(item->>'id')::uuid;first:=nullif(btrim(item->>'first_name'),'');last:=nullif(btrim(item->>'last_name'),'');mail:=nullif(btrim(item->>'email'),'');v_phone:=nullif(btrim(item->>'phone'),'');
  if cid is null or coalesce(first,last) is null or length(coalesce(first,''))>160 or length(coalesce(last,''))>160 or length(coalesce(mail,''))>254 or length(coalesce(v_phone,''))>40 or (mail is not null and mail !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$') then raise exception 'Check the selected contact names, emails and v_phone numbers.' using errcode='22023';end if;
  select * into existing from public.customers where id=cid and business_id=p_business;
  if found then
   if (existing.first_name,existing.last_name,existing.email,existing.phone) is distinct from(first,last,mail,v_phone) then raise exception 'A contact retry contains different details.' using errcode='23505';end if;
   replayed:=replayed+1;continue;
  end if;
  if exists(select 1 from public.customers c where c.business_id=p_business and not c.archived and
    ((mail is not null and lower(c.email)=lower(mail)) or (v_phone is not null and length(regexp_replace(v_phone,'[^0-9]','','g'))>=7 and regexp_replace(c.phone,'[^0-9]','','g')=regexp_replace(v_phone,'[^0-9]','','g')) or
     (mail is null and v_phone is null and lower(btrim(concat_ws(' ',c.first_name,c.last_name)))=lower(btrim(concat_ws(' ',first,last)))))) then skipped:=skipped+1;continue;end if;
  insert into public.customers(id,business_id,first_name,last_name,email,phone) values(cid,p_business,first,last,mail,v_phone);imported:=imported+1;
 end loop;
 return jsonb_build_object('imported',imported,'skipped',skipped,'already_imported',replayed);
end $$;
revoke all on function public.import_customer_contacts(uuid,jsonb) from public,anon;
grant execute on function public.import_customer_contacts(uuid,jsonb) to authenticated;

create or replace function public.complete_job_workflow(p_job uuid,p_actor uuid,p_retry_only boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.jobs%rowtype;b uuid;quote public.estimates%rowtype;invoice uuid;failure text;finance boolean;
begin
 select business_id into b from public.jobs where id=p_job;
 if b is null or p_actor is null or not private.member_module_access(b,p_actor,'jobs') or not exists(select 1 from public.business_members where business_id=b and user_id=p_actor and role<>'viewer') then
 raise exception 'Job access is required.' using errcode='42501';end if;
 finance:=private.member_module_access(b,p_actor,'billing');
 if p_retry_only and not finance then raise exception 'Billing access is required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
 select * into j from public.jobs where id=p_job for update;
 if j.status='canceled' then raise exception 'Reopen a canceled job before completing it.' using errcode='23514';end if;
 if p_retry_only and j.status<>'completed' then raise exception 'Complete the job first.' using errcode='23514';end if;
 update public.jobs set status='completed',completed_at=coalesce(completed_at,now()) where id=j.id;
 select id into invoice from public.invoices where job_id=j.id and business_id=b and status<>'void' order by created_at limit 1;
 if invoice is null then
 select * into quote from public.estimates where business_id=b and job_id=j.id and status in('accepted','converted') order by created_at limit 1;
 if found then
 begin
 if exists(select 1 from public.invoices where estimate_id=quote.id) then raise exception 'Existing invoice needs review.' using errcode='23514';end if;
 if not exists(select 1 from public.estimate_items where estimate_id=quote.id and business_id=b) then raise exception 'Approved scope is missing.' using errcode='23514';end if;
 insert into public.invoices(business_id,customer_id,job_id,estimate_id,notes,customer_message,payment_links,payment_instructions)
 values(b,quote.customer_id,j.id,quote.id,quote.notes,quote.customer_message,
 coalesce(quote.payment_links,(select payment_links from public.business_settings where business_id=b),'[]'::jsonb),
 coalesce(quote.payment_instructions,(select payment_instructions from public.business_settings where business_id=b),'')) returning id into invoice;
 insert into public.invoice_items(invoice_id,business_id,description,quantity,unit_price,tax_rate,sort_order)
 select invoice,business_id,description,quantity,unit_price,tax_rate,sort_order from public.estimate_items where estimate_id=quote.id and business_id=b order by sort_order;
 update public.estimates set status='converted' where id=quote.id and status='accepted';
 exception when others then invoice:=null;failure:=case when sqlstate in('23514','P0001') then 'document_limit_or_review' else 'invoice_preparation_failed' end;end;
 else failure:='pricing_required';end if;end if;
 insert into private.job_invoice_results(job_id,business_id,invoice_id,error_code) values(j.id,b,invoice,failure)
 on conflict(job_id) do update set invoice_id=excluded.invoice_id,error_code=excluded.error_code,updated_at=now();
 return jsonb_build_object('job_id',j.id,'status','completed','invoice_ready',invoice is not null,'invoice_id',case when finance then invoice else null end,
 'needs_pricing',failure='pricing_required','needs_review',failure is not null);
end $$;

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
 document:=public.create_document(b,'invoice',request,jsonb_build_object('customer_id',j.customer_id,'job_id',j.id,'items',items,'due_date',due,'issue_date',details->>'issue_date','notes',details->>'notes')||jsonb_strip_nulls(jsonb_build_object('payment_links',details->'payment_links','payment_instructions',details->>'payment_instructions')));
 update public.invoices set job_id=j.id where id=(document->>'id')::uuid and business_id=b;
 return document||jsonb_build_object('already_created',false);
end $$;

-- Staff can copy an owner's quoted destination, but cannot invent a destination.
create or replace function private.guard_invoice_destinations() returns trigger language plpgsql set search_path='' as $$
declare settings public.business_settings%rowtype; quoted boolean:=false;
begin
 if auth.uid() is null then return new;end if;
 if tg_op='INSERT' then
  select * into settings from public.business_settings where business_id=new.business_id;
  if tg_table_name='invoices' and nullif(to_jsonb(new)->>'estimate_id','') is not null then
   select new.payment_links=coalesce(e.payment_links,settings.payment_links,'[]'::jsonb) and new.payment_instructions=coalesce(e.payment_instructions,settings.payment_instructions,'') into quoted
   from public.estimates e where e.id=(to_jsonb(new)->>'estimate_id')::uuid and e.business_id=new.business_id;
  end if;
  if new.payment_links is distinct from coalesce(settings.payment_links,'[]'::jsonb) or new.payment_instructions is distinct from coalesce(settings.payment_instructions,'') then
   if not private.is_primary_owner(new.business_id) and not coalesce(quoted,false) then raise exception 'Only the primary owner can set payment destinations' using errcode='42501';end if;
  end if;
 elsif (new.payment_links is distinct from old.payment_links or new.payment_instructions is distinct from old.payment_instructions) and not private.is_primary_owner(new.business_id) then raise exception 'Only the primary owner can change payment destinations' using errcode='42501';end if;
 return new;
end $$;
create function private.freeze_estimate_payments() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status<>'draft' and (new.payment_links,new.payment_instructions) is distinct from(old.payment_links,old.payment_instructions) then raise exception 'Issued estimate payment instructions are locked.' using errcode='23514';end if;
 return new;
end $$;
create trigger freeze_estimate_payments before update on public.estimates for each row execute function private.freeze_estimate_payments();
revoke all on function private.freeze_estimate_payments() from public,anon,authenticated;
