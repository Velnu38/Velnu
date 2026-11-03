-- Optional invoice work tracking is independent of payment status.
alter table public.invoices add column work_completed boolean not null default false;
alter table public.invoices add column work_completed_at timestamptz;
create function private.track_invoice_work() returns trigger language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||new.business_id::text,0));
 if new.job_id is not null and exists(select 1 from public.jobs where id=new.job_id and business_id=new.business_id and status='completed') then new.work_completed:=true;end if;
 if new.work_completed then new.work_completed_at:=case when tg_op='UPDATE' and old.work_completed then old.work_completed_at else now() end;
 else new.work_completed_at:=null;end if;
 return new;
end $$;
create trigger a_invoice_work_tracking before insert or update on public.invoices for each row execute function private.track_invoice_work();
revoke all on function private.track_invoice_work() from public,anon,authenticated;

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
if dt is not null and dt<issued then raise exception 'Due or expiration date cannot precede the issue date';end if;if document_kind='invoice' then insert into public.invoices(business_id,customer_id,issue_date,due_date,notes,customer_message,request_id,request_fingerprint,payment_links,payment_instructions,work_completed) values(target_business_id,customer,issued,dt,payload->>'notes',payload->>'customer_message',request_id,fingerprint,links,instructions,coalesce((payload->>'work_completed')::boolean,false)) returning id into new_id;else insert into public.estimates(business_id,customer_id,property_id,issue_date,expires_on,notes,customer_message,request_id,request_fingerprint,payment_links,payment_instructions) values(target_business_id,customer,site,issued,dt,payload->>'notes',payload->>'customer_message',request_id,fingerprint,links,instructions) returning id into new_id;end if;for x in select value from jsonb_array_elements(payload->'items') loop if document_kind='invoice' then insert into public.invoice_items(invoice_id,business_id,description,quantity,unit_price,tax_rate,sort_order) values(new_id,target_business_id,btrim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'tax_rate')::numeric,0),k);else insert into public.estimate_items(estimate_id,business_id,description,quantity,unit_price,tax_rate,sort_order) values(new_id,target_business_id,btrim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'tax_rate')::numeric,0),k);end if;k:=k+1;end loop;if document_kind='invoice' then select to_jsonb(i) into result from public.invoices i where id=new_id;else select to_jsonb(e) into result from public.estimates e where id=new_id;end if;return result;end$function$;

create or replace function private.document_change_context(kind text,document uuid) returns jsonb
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
 if coalesce((d->>'work_completed')::boolean,false) or (kind='estimate' and exists(select 1 from public.invoices where estimate_id=document and business_id=b and work_completed)) then job_status:='completed';end if;
 eligible:=case when kind='invoice' then d->>'status' in('draft','sent','viewed','partial','paid','overdue') else d->>'status' in('draft','sent','accepted','converted') end and coalesce(job_status,'unscheduled') not in('completed','canceled');
 if kind='invoice' then select jsonb_agg(jsonb_build_object('description',description,'quantity',quantity,'unit_price',unit_price,'tax_rate',tax_rate) order by sort_order) into items from public.invoice_items where invoice_id=document and business_id=b;
 else select jsonb_agg(jsonb_build_object('description',description,'quantity',quantity,'unit_price',unit_price,'tax_rate',tax_rate) order by sort_order) into items from public.estimate_items where estimate_id=document and business_id=b;end if;
 return jsonb_build_object('business_id',b,'document_id',document,'kind',kind,'number',coalesce(d->>'invoice_number',d->>'estimate_number'),'customer_id',customer,
 'customer_name',(select coalesce(nullif(btrim(concat_ws(' ',first_name,last_name)),''),company,'Customer') from public.customers where id=customer and business_id=b),
 'customer_email',(select email from public.customers where id=customer and business_id=b),'customer_phone',(select phone from public.customers where id=customer and business_id=b),
 'job_id',job,'estimate_id',estimate,'work_status',coalesce(job_status,'unscheduled'),'can_change',eligible,'total',d->'total','items',coalesce(items,'[]'::jsonb),
 'address',(select concat_ws(', ',address_line1,address_line2,city,state,postal_code) from public.properties where id=site and business_id=b));
end $$;

create or replace function private.guard_change_order_source() returns trigger language plpgsql security definer set search_path='' as $$
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
 if new.source_invoice_id is not null and exists(select 1 from public.invoices where id=new.source_invoice_id and business_id=new.business_id and work_completed) or new.estimate_id is not null and exists(select 1 from public.invoices where estimate_id=new.estimate_id and business_id=new.business_id and work_completed) then raise exception 'Change orders are available while work is not complete.' using errcode='23514';end if;
 source_job:=coalesce(source_job,new.job_id);
 if source_job is not null and not exists(select 1 from public.jobs j where j.id=source_job and j.business_id=new.business_id and j.customer_id=new.customer_id and j.status not in('completed','canceled')) then raise exception 'Change orders are available while work is not complete.' using errcode='23514';end if;
 return new;
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
 document:=public.create_document(b,'invoice',request,jsonb_build_object('customer_id',j.customer_id,'job_id',j.id,'items',items,'due_date',due,'issue_date',details->>'issue_date','notes',details->>'notes','work_completed',coalesce((details->>'work_completed')::boolean,false))||jsonb_strip_nulls(jsonb_build_object('business_contact',details->'business_contact'))||jsonb_strip_nulls(jsonb_build_object('payment_links',details->'payment_links','payment_instructions',details->>'payment_instructions')));
 update public.invoices set job_id=j.id where id=(document->>'id')::uuid and business_id=b;
 return document||jsonb_build_object('already_created',false);
end $$;

-- Plans/occurrences are private; only checked RPCs and the database scheduler can act.
create table private.recurring_invoice_plans (
 id uuid primary key, business_id uuid not null references public.businesses(id) on delete cascade,
 source_invoice_id uuid not null, created_by uuid references auth.users(id) on delete set null,
 customer_id uuid not null, property_id uuid, template jsonb not null, fingerprint text not null,
 title text not null check(length(title) between 1 and 200),
 cadence text not null check(cadence in('weekly','fortnightly','monthly','quarterly','yearly')),
 anchor_date date not null, next_index integer not null default 0 check(next_index>=0), next_date date not null,
 end_date date, due_days integer not null check(due_days between 0 and 365), timezone text not null,
 schedule_visit boolean not null default false, visit_time time not null default '09:00',
 duration_minutes integer not null default 60 check(duration_minutes between 15 and 720), workers uuid[] not null default '{}',
 status text not null default 'active' check(status in('active','paused','ended')), last_error text,
 created_at timestamptz not null default now(),
 foreign key(source_invoice_id,business_id) references public.invoices(id,business_id),
 foreign key(customer_id,business_id) references public.customers(id,business_id),
 foreign key(property_id,business_id) references public.properties(id,business_id),
 check(end_date is null or end_date>=anchor_date),unique(id,business_id)
);
create unique index recurring_plans_active_source on private.recurring_invoice_plans(source_invoice_id) where status='active';
create index recurring_plans_due on private.recurring_invoice_plans(next_date) where status='active';
create index recurring_plans_business on private.recurring_invoice_plans(business_id);
create index recurring_plans_source on private.recurring_invoice_plans(source_invoice_id,business_id);
create index recurring_plans_property on private.recurring_invoice_plans(property_id,business_id);
create index recurring_plans_customer on private.recurring_invoice_plans(customer_id,business_id);
create index recurring_plans_owner on private.recurring_invoice_plans(created_by);
create table private.recurring_invoice_occurrences (
 id uuid primary key default gen_random_uuid(), plan_id uuid not null, business_id uuid not null,
 bill_date date not null, invoice_id uuid, job_id uuid, schedule_error text, created_at timestamptz not null default now(),
 unique(plan_id,bill_date), foreign key(plan_id,business_id) references private.recurring_invoice_plans(id,business_id) on delete cascade,
 foreign key(invoice_id,business_id) references public.invoices(id,business_id), foreign key(job_id,business_id) references public.jobs(id,business_id)
);
create index recurring_occurrence_plan on private.recurring_invoice_occurrences(plan_id,business_id);
create index recurring_occurrence_invoice on private.recurring_invoice_occurrences(invoice_id,business_id);
create index recurring_occurrence_job on private.recurring_invoice_occurrences(job_id,business_id);
alter table private.recurring_invoice_plans enable row level security;
alter table private.recurring_invoice_occurrences enable row level security;
revoke all on private.recurring_invoice_plans,private.recurring_invoice_occurrences from public,anon,authenticated;

-- Always calculate from the original anchor: Jan 31 -> Feb 28 -> Mar 31.
create function private.recurring_date(anchor date,cadence text,n integer) returns date language sql immutable set search_path='' as $$
 select case cadence when 'weekly' then anchor+7*n when 'fortnightly' then anchor+14*n
 when 'monthly' then (anchor+make_interval(months=>n))::date when 'quarterly' then (anchor+make_interval(months=>3*n))::date
 when 'yearly' then (anchor+make_interval(years=>n))::date end
$$;
revoke all on function private.recurring_date(date,text,integer) from public,anon,authenticated;

-- Worker is never exposed to browser roles. It revalidates the stored primary owner,
-- terms, modules and plan limits on every run. The temporary actor context permits
-- existing document/crew guards to run; it is restored before returning.
create function private.process_recurring_plan(plan uuid) returns void language plpgsql security definer set search_path='' as $$
declare p private.recurring_invoice_plans%rowtype;o private.recurring_invoice_occurrences%rowtype;
 b uuid; previous_actor text:=coalesce(current_setting('request.jwt.claim.sub',true),'');
 today date; document jsonb;job jsonb;start_at timestamptz;local_start timestamp;iteration integer;failure text;
begin
 select business_id into b from private.recurring_invoice_plans where id=plan;
 if b is null then return;end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
 select * into p from private.recurring_invoice_plans where id=plan for update;
 if p.status<>'active' then return;end if;
 if not private.is_primary_owner(b,p.created_by) or not private.member_module_access(b,p.created_by,'billing') then
  update private.recurring_invoice_plans set status='paused',last_error='Owner access changed. Review this recurring invoice.' where id=plan;return;end if;
 perform set_config('request.jwt.claim.sub',p.created_by::text,true);
 if not exists(select 1 from public.customers where id=p.customer_id and business_id=b and not archived) or not exists(select 1 from public.invoices where id=p.source_invoice_id and business_id=b and status<>'void') then raise exception 'Review the active customer and source invoice.';end if;
 if not private.can_write_business(b) then raise exception 'Complete the current account agreement before recurring work can continue.';end if;
 if p.schedule_visit and (not private.member_module_access(b,p.created_by,'jobs') or not private.member_module_access(b,p.created_by,'calendar')) then raise exception 'Jobs and calendar access are required for these recurring visits.';end if;
 today:=(now() at time zone p.timezone)::date;
 if p.next_date<today-31 then
  update private.recurring_invoice_plans set status='paused',last_error='Missed more than 31 days. Resume to skip missed dates and continue with the next visit.' where id=plan;
 else
  for iteration in 1..2 loop
   if p.end_date is not null and p.next_date>p.end_date then update private.recurring_invoice_plans set status='ended',last_error=null where id=plan;exit;end if;
   insert into private.recurring_invoice_occurrences(plan_id,business_id,bill_date) values(plan,b,p.next_date) on conflict(plan_id,bill_date) do nothing;
   select * into o from private.recurring_invoice_occurrences where plan_id=plan and bill_date=p.next_date for update;
   -- Existing manually linked work is adopted before retrying an uncertain schedule.
   if o.invoice_id is not null and o.job_id is null then select job_id into o.job_id from public.invoices where id=o.invoice_id and business_id=b;end if;
   if p.schedule_visit and o.job_id is null then
    begin
     if p.next_date<today then raise exception 'The visit date has passed. Open the invoice to arrange any remaining work.';end if;
     local_start:=p.next_date+p.visit_time;start_at:=local_start at time zone p.timezone;
     if start_at at time zone p.timezone<>local_start or exists(select 1 from generate_series(-120,120,15) mins where mins<>0 and (start_at+make_interval(mins=>mins)) at time zone p.timezone=local_start) then raise exception 'This visit falls in a daylight-saving clock change. Arrange its time manually.';end if;
     if start_at<now() then raise exception 'The visit time has passed. Arrange remaining work manually.';end if;
     perform private.validate_scheduling_workers(b,p.workers);
     insert into public.jobs(business_id,customer_id,property_id,title,description,status,scheduled_start,scheduled_end,assigned_user_ids,request_id,request_fingerprint)
     values(b,p.customer_id,p.property_id,p.title,(select string_agg(value->>'description',E'\n') from jsonb_array_elements(p.template->'items')),'scheduled',start_at,start_at+make_interval(mins=>p.duration_minutes),p.workers,o.id,encode(sha256(convert_to(p.id::text||p.next_date::text,'UTF8')),'hex')) returning id into o.job_id;
     insert into public.appointments(business_id,customer_id,job_id,title,starts_at,ends_at,status,assigned_user_id)
     values(b,p.customer_id,o.job_id,p.title,start_at,start_at+make_interval(mins=>p.duration_minutes),'scheduled',p.workers[1]);
     o.schedule_error:=null;
    exception when others then
     o.job_id:=null;
     o.schedule_error:=case when sqlstate='23P01' then 'This visit conflicts with booked work. Open the invoice to choose another time.' when sqlstate='22023' then 'Review the assigned worker or visit time.' else 'This visit needs scheduling review. Check the time, worker and account limits.' end;
    end;
   elsif o.job_id is not null then o.schedule_error:=null;end if;
   if o.invoice_id is null and o.job_id is not null then select id into o.invoice_id from public.invoices where business_id=b and job_id=o.job_id and status<>'void' order by created_at limit 1;end if;
   if p.next_date<=today and o.invoice_id is null then
    document:=public.create_document(b,'invoice',o.id,p.template||jsonb_build_object('customer_id',p.customer_id,'issue_date',p.next_date,'due_date',p.next_date+p.due_days,'work_completed',false));
    o.invoice_id:=(document->>'id')::uuid;
   end if;
   if o.invoice_id is not null and o.job_id is not null then update public.invoices set job_id=o.job_id where id=o.invoice_id and business_id=b;end if;
   update private.recurring_invoice_occurrences set invoice_id=o.invoice_id,job_id=o.job_id,schedule_error=o.schedule_error where id=o.id;
   if p.next_date>today then exit;end if;
   p.next_index:=p.next_index+1;p.next_date:=private.recurring_date(p.anchor_date,p.cadence,p.next_index);
   update private.recurring_invoice_plans set next_index=p.next_index,next_date=p.next_date,last_error=null where id=plan;
  end loop;
 end if;
 perform set_config('request.jwt.claim.sub',previous_actor,true);
exception when others then
 perform set_config('request.jwt.claim.sub',previous_actor,true);
 update private.recurring_invoice_plans set status='paused',last_error='Recurring invoices paused. Review customer details, access and account limits, then resume.' where id=plan;
end $$;
revoke all on function private.process_recurring_plan(uuid) from public,anon,authenticated;

create function private.recurring_invoice_list(b uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_primary_owner(b) or not private.can_write_business(b) or not private.member_module_access(b,auth.uid(),'billing') then raise exception 'Primary owner billing access is required.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from(select p.id,p.source_invoice_id,p.title,p.cadence,p.next_date,p.end_date,p.status,p.last_error,p.schedule_visit,p.timezone,p.visit_time,p.due_days,
 (select coalesce(jsonb_agg(to_jsonb(y)),'[]'::jsonb) from(select o.id,o.bill_date,o.invoice_id,o.job_id,(select status from public.invoices where id=o.invoice_id and business_id=b) invoice_status,case when exists(select 1 from public.document_schedules where invoice_id=o.invoice_id and business_id=b and status in('scheduled','confirmed','in_progress','completed')) then null else o.schedule_error end schedule_error from private.recurring_invoice_occurrences o where o.plan_id=p.id order by bill_date desc limit 12)y) occurrences
 from private.recurring_invoice_plans p where business_id=b order by created_at desc limit 100)x),'[]'::jsonb);
end $$;
create function public.get_recurring_invoices(p_business uuid) returns jsonb language sql security invoker set search_path='' as $$select private.recurring_invoice_list(p_business)$$;

create function private.create_recurring_invoice(source uuid,request uuid,options jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype;p private.recurring_invoice_plans%rowtype;b uuid;site uuid;fp text;payload jsonb;workers uuid[];d date;today date;zone text;ending date;
begin
 select * into i from public.invoices where id=source;b:=i.business_id;
 if b is null or auth.uid() is null or not private.is_primary_owner(b) or not private.can_write_business(b) or not private.member_module_access(b,auth.uid(),'billing') then raise exception 'Primary owner billing access is required.' using errcode='42501';end if;
 if request is null or options is null or jsonb_typeof(options)<>'object' or pg_column_size(options)>8192 then raise exception 'Invalid recurring invoice setup.' using errcode='22023';end if;
 fp:=encode(sha256(convert_to(source::text||options::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
 select * into p from private.recurring_invoice_plans where id=request;
 if found then if p.business_id<>b or p.fingerprint<>fp then raise exception 'This request saved different recurring details.' using errcode='23505';end if;return jsonb_build_object('id',p.id,'status',p.status);end if;
 if exists(select 1 from private.recurring_invoice_plans where business_id=b and source_invoice_id=source and status='active') then raise exception 'This invoice already has an active repeat schedule. Pause it before adding another.';end if;
 if i.status='void' or not exists(select 1 from public.customers where id=i.customer_id and business_id=b and not archived) then raise exception 'Choose an active invoice and customer.';end if;
 select timezone into zone from public.businesses where id=b;today:=(now() at time zone zone)::date;
 d:=(options->>'first_date')::date;ending:=nullif(options->>'end_date','')::date;
 if d is null or d<today or d>today+3650 or (ending is not null and (ending<d or ending>d+3650)) then raise exception 'Choose a first date from today through the next 10 years and a later end date.';end if;
 if options->>'cadence' not in('weekly','fortnightly','monthly','quarterly','yearly') or options->>'cadence' is null then raise exception 'Choose a repeat interval.';end if;
 if (select count(*) from private.recurring_invoice_plans where business_id=b and status<>'ended')>=100 then raise exception 'Review existing recurring invoices before adding more.';end if;
 select jsonb_build_object('items',jsonb_agg(jsonb_build_object('description',description,'quantity',quantity,'unit_price',unit_price,'tax_rate',tax_rate) order by sort_order),'customer_message',i.customer_message,'payment_links',i.payment_links,'payment_instructions',i.payment_instructions) into payload from public.invoice_items where invoice_id=i.id and business_id=b;
 if payload->'items'='null'::jsonb or payload->'items' is null then raise exception 'Add line items to the invoice first.';end if;
 workers:=array[auth.uid()];
 if coalesce((options->>'schedule_visit')::boolean,false) then
  if not private.member_module_access(b,auth.uid(),'jobs') or not private.member_module_access(b,auth.uid(),'calendar') then raise exception 'Jobs and calendar access is required.' using errcode='42501';end if;
  select array_agg(value::uuid) into workers from jsonb_array_elements_text(coalesce(options->'workers','[]'::jsonb));
  if cardinality(workers) is null or cardinality(workers) not between 1 and 20 then raise exception 'Choose at least one worker.';end if;
  perform private.validate_scheduling_workers(b,workers);
 end if;
 select coalesce((select property_id from public.jobs where id=i.job_id and business_id=b),(select property_id from public.estimates where id=i.estimate_id and business_id=b)) into site;
 insert into private.recurring_invoice_plans(id,business_id,source_invoice_id,created_by,customer_id,property_id,template,fingerprint,title,cadence,anchor_date,next_date,end_date,due_days,timezone,schedule_visit,visit_time,duration_minutes,workers)
 values(request,b,i.id,auth.uid(),i.customer_id,site,payload,fp,btrim(options->>'title'),options->>'cadence',d,d,ending,(options->>'due_days')::integer,zone,coalesce((options->>'schedule_visit')::boolean,false),coalesce(nullif(options->>'visit_time','')::time,time '09:00'),coalesce((options->>'duration_minutes')::integer,60),workers);
 perform private.process_recurring_plan(request);
 return jsonb_build_object('id',request,'status',(select status from private.recurring_invoice_plans where id=request));
end $$;
create function public.create_recurring_invoice(p_invoice uuid,p_request uuid,p_options jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.create_recurring_invoice(p_invoice,p_request,p_options)$$;

create function private.set_recurring_invoice_status(plan uuid,state text) returns void language plpgsql security definer set search_path='' as $$
declare p private.recurring_invoice_plans%rowtype;today date;
begin
 select * into p from private.recurring_invoice_plans where id=plan;
 if not found or auth.uid() is null or not private.is_primary_owner(p.business_id) or not private.can_write_business(p.business_id) or not private.member_module_access(p.business_id,auth.uid(),'billing') then raise exception 'Primary owner billing access is required.' using errcode='42501';end if;
 if state not in('active','paused') then raise exception 'Choose pause or resume.';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||p.business_id::text,0));
 select * into p from private.recurring_invoice_plans where id=plan for update;
 today:=(now() at time zone p.timezone)::date;
 if state='active' then
  if exists(select 1 from private.recurring_invoice_plans where source_invoice_id=p.source_invoice_id and id<>plan and status='active') then raise exception 'Another repeat schedule is active for this invoice. Pause it first.';end if;
  while p.next_date<today loop p.next_index:=p.next_index+1;p.next_date:=private.recurring_date(p.anchor_date,p.cadence,p.next_index);end loop;
 end if;
 update private.recurring_invoice_plans set status=state,next_index=p.next_index,next_date=p.next_date,last_error=null where id=plan;
 if state='active' then perform private.process_recurring_plan(plan);end if;
end $$;
create function public.set_recurring_invoice_status(p_plan uuid,p_status text) returns void language sql security invoker set search_path='' as $$select private.set_recurring_invoice_status(p_plan,p_status)$$;

revoke all on function private.recurring_invoice_list(uuid),public.get_recurring_invoices(uuid),private.create_recurring_invoice(uuid,uuid,jsonb),public.create_recurring_invoice(uuid,uuid,jsonb),private.set_recurring_invoice_status(uuid,text),public.set_recurring_invoice_status(uuid,text) from public,anon;
grant execute on function private.recurring_invoice_list(uuid),public.get_recurring_invoices(uuid),private.create_recurring_invoice(uuid,uuid,jsonb),public.create_recurring_invoice(uuid,uuid,jsonb),private.set_recurring_invoice_status(uuid,text),public.set_recurring_invoice_status(uuid,text) to authenticated;

create function private.run_recurring_invoices() returns integer language plpgsql security definer set search_path='' as $$
declare item record;processed integer:=0;
begin
 for item in select id from private.recurring_invoice_plans where status='active' order by next_date,created_at limit 100 loop
  perform private.process_recurring_plan(item.id);processed:=processed+1;
 end loop;
 return processed;
end $$;
revoke all on function private.run_recurring_invoices() from public,anon,authenticated;
-- One bounded database job prepares drafts; it never invokes a delivery or payment API.
create extension if not exists pg_cron;
select cron.schedule('finviant-recurring-invoice-drafts','*/15 * * * *','select private.run_recurring_invoices()');
