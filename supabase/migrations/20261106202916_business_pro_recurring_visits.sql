-- Preserve recurring drafts on Individual and suspend only automatic visits.
CREATE OR REPLACE FUNCTION private.create_recurring_invoice(source uuid, request uuid, options jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i public.invoices%rowtype;p private.recurring_invoice_plans%rowtype;b uuid;site uuid;fp text;payload jsonb;workers uuid[];d date;today date;zone text;ending date;
begin
 select * into i from public.invoices where id=source;b:=i.business_id;
 if b is null or auth.uid() is null or not private.is_primary_owner(b) or not private.can_write_business(b) or not private.member_module_access(b,auth.uid(),'billing') then raise exception 'Primary owner billing access is required.' using errcode='42501';end if;
 if private.effective_plan(b)='free' then raise exception 'Recurring drafts require Individual or Business Pro.' using errcode='42501';end if;
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
  if private.effective_plan(b)<>'pro' then raise exception 'Automatic visit scheduling requires Business Pro.' using errcode='42501';end if;
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
end $function$;

CREATE OR REPLACE FUNCTION private.process_recurring_plan(plan uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p private.recurring_invoice_plans%rowtype;o private.recurring_invoice_occurrences%rowtype;
 b uuid; previous_actor text:=coalesce(current_setting('request.jwt.claim.sub',true),'');
 today date; document jsonb;job jsonb;start_at timestamptz;local_start timestamp;iteration integer;failure text;
begin
 select business_id into b from private.recurring_invoice_plans where id=plan;
 if b is null then return;end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
 select * into p from private.recurring_invoice_plans where id=plan for update;
 if p.status<>'active' then return;end if;
 if private.effective_plan(b)='free' then update private.recurring_invoice_plans set status='paused',last_error='Recurring drafts require Individual or Business Pro. Resume after upgrading.' where id=plan;return;end if;
 if not private.is_primary_owner(b,p.created_by) or not private.member_module_access(b,p.created_by,'billing') then
  update private.recurring_invoice_plans set status='paused',last_error='Owner access changed. Review this recurring invoice.' where id=plan;return;end if;
 perform set_config('request.jwt.claim.sub',p.created_by::text,true);
 if not exists(select 1 from public.customers where id=p.customer_id and business_id=b and not archived) or not exists(select 1 from public.invoices where id=p.source_invoice_id and business_id=b and status<>'void') then raise exception 'Review the active customer and source invoice.';end if;
 if not private.can_write_business(b) then raise exception 'Complete the current account agreement before recurring work can continue.';end if;
 if p.schedule_visit and private.effective_plan(b)='pro' and (not private.member_module_access(b,p.created_by,'jobs') or not private.member_module_access(b,p.created_by,'calendar')) then raise exception 'Jobs and calendar access are required for these recurring visits.';end if;
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
   if p.schedule_visit and o.job_id is null and private.effective_plan(b)<>'pro' then
    o.schedule_error:='Automatic visits are paused on this plan. Arrange the appointment manually or upgrade to Business Pro.';
   elsif p.schedule_visit and o.job_id is null then
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
end $function$;
