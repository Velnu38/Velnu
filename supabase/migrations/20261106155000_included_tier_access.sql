-- Included features use the same plan resolver as quotas. Existing records are retained.

CREATE OR REPLACE FUNCTION private.velnu_has_accepted_terms()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select auth.uid() is not null and exists(select 1 from public.user_agreement_acceptances a
    where a.user_id=auth.uid() and a.terms_accepted and a.ai_disclosure_acknowledged
      and a.electronic_records_consent and a.agreement_version in
      ('2026-10-26-v1','2026-10-26-v2','2026-10-27-v3','2026-11-06-v4','2026-11-06-v5'));
$function$;

CREATE OR REPLACE FUNCTION private.is_business_member(target_business_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (private.effective_plan(target_business_id)='pro' or private.is_primary_owner(target_business_id)) and private.velnu_has_accepted_terms() and exists (
    select 1 from public.business_members bm
    where bm.business_id=target_business_id and bm.user_id=(select auth.uid())
  );
$function$;

CREATE OR REPLACE FUNCTION private.can_write_business(target_business_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (private.effective_plan(target_business_id)='pro' or private.is_primary_owner(target_business_id)) and private.velnu_has_accepted_terms() and exists (
    select 1 from public.business_members bm
    where bm.business_id=target_business_id and bm.user_id=(select auth.uid())
      and bm.role in ('owner','admin','office','technician')
  );
$function$;

CREATE OR REPLACE FUNCTION private.has_business_role(target_business_id uuid, allowed_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (private.effective_plan(target_business_id)='pro' or private.is_primary_owner(target_business_id)) and private.velnu_has_accepted_terms() and exists (
    select 1 from public.business_members bm
    where bm.business_id=target_business_id and bm.user_id=(select auth.uid())
      and bm.role=any(allowed_roles)
  );
$function$;

CREATE OR REPLACE FUNCTION private.member_module_access(b uuid, actor uuid, feature text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select (private.effective_plan(b)='pro' or private.is_primary_owner(b,actor)) and exists(select 1 from public.business_members m where m.business_id=b and m.user_id=actor
 and (private.is_primary_owner(b,actor) or (feature=any(m.access_modules)
 and (feature not in('billing','finances') or m.role in('owner','admin','office')))));
$function$;

CREATE OR REPLACE FUNCTION private.full_workspace_access(b uuid, actor uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select private.member_module_access(b,actor,'calendar') and private.member_module_access(b,actor,'jobs') and private.member_module_access(b,actor,'billing') and private.member_module_access(b,actor,'finances');
$function$;

CREATE OR REPLACE FUNCTION private.ai_confirmation_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$begin if current_user in('authenticated','anon') then if auth.uid() is null or auth.uid()<>old.user_id or not private.fin_access(old.business_id,'profile') or old.status<>'proposed' or new.status not in('confirmed','rejected') then raise exception 'Only your own pending proposals can be confirmed or rejected' using errcode='42501';end if;if old.parsed_payload->>'clarification_question' is not null and new.status='confirmed' then raise exception 'Clarify this command before confirming';end if;end if;return new;end$function$;

CREATE OR REPLACE FUNCTION private.execute_confirmed_action(target_action_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.ai_actions%rowtype;f jsonb;r jsonb;customer uuid;matches integer;requested text;obj uuid;job uuid;doc jsonb;item jsonb;k integer:=0;kind text;start_at timestamptz;end_at timestamptz;
begin
 if not private.full_workspace_access((select business_id from public.ai_actions where id=target_action_id and user_id=auth.uid()),auth.uid()) then raise exception 'Assistant access denied' using errcode='42501';end if;
if auth.uid() is null then raise exception 'Sign in to continue' using errcode='42501';end if;
select * into a from public.ai_actions where id=target_action_id and user_id=auth.uid() for update;
if not found or not private.can_write_business(a.business_id) then raise exception 'This action requires access to the business' using errcode='42501';end if;
if a.status='executed' then return jsonb_build_object('action_id',a.id,'status','executed','result',a.parsed_payload->'execution_result','already_executed',true);end if;
if a.parsed_payload->>'clarification_question' is not null then raise exception 'Clarify the command before executing';end if;
if a.intent in('list_unpaid_invoices','customer_history','business_summary') then if a.status not in('proposed','confirmed') then raise exception 'Action is not ready';end if;elsif a.status<>'confirmed' then raise exception 'Review and confirm this action first';end if;f:=a.parsed_payload->'fields';
if a.intent in('create_job','create_invoice','create_estimate','schedule_job','create_change_order','customer_history') then requested:=lower(regexp_replace(btrim(coalesce(f->>'customer_name',f->>'company_name','')),'\s+',' ','g'));if requested='' then raise exception 'Specify the customer name';end if;select count(*),min(id::text)::uuid into matches,customer from public.customers where business_id=a.business_id and not archived and(lower(regexp_replace(btrim(concat_ws(' ',first_name,last_name)),'\s+',' ','g'))=requested or lower(regexp_replace(btrim(coalesce(company,'')),'\s+',' ','g'))=requested);if matches<>1 then raise exception 'Found % matching customers. Use the manual form to select the correct customer.',matches;end if;end if;
case a.intent
when 'create_customer' then
if nullif(btrim(coalesce(f->>'customer_name',f->>'company_name','')),'') is null then raise exception 'Customer name required';end if;
insert into public.customers(business_id,first_name,last_name,company,email,phone,notes) values(a.business_id,nullif(split_part(coalesce(f->>'customer_name',''),' ',1),''),nullif(regexp_replace(coalesce(f->>'customer_name',''),'^[^ ]+\s*',''),''),f->>'company_name',f->>'email',f->>'phone',f->>'notes') returning id into obj;select jsonb_build_object('customer',to_jsonb(c)) into r from public.customers c where id=obj;
when 'create_invoice','create_estimate' then
kind:=case when a.intent='create_invoice' then 'invoice' else 'estimate' end;doc:=public.create_document(a.business_id,kind,a.id,jsonb_build_object('customer_id',customer,'items',f->'line_items','due_date',case when kind='invoice' then f->>'due_date_text' else null end,'notes',f->>'notes'));r:=jsonb_build_object(kind,doc);
when 'record_payment' then
select count(*),min(id::text)::uuid into matches,obj from public.invoices where business_id=a.business_id and invoice_number=f->>'invoice_number' and(nullif(btrim(coalesce(f->>'customer_name',f->>'company_name','')),'') is null or customer_id in(select id from public.customers where business_id=a.business_id and(lower(btrim(concat_ws(' ',first_name,last_name)))=lower(btrim(coalesce(f->>'customer_name',f->>'company_name'))) or lower(btrim(company))=lower(btrim(coalesce(f->>'customer_name',f->>'company_name'))))));if matches<>1 then raise exception 'Specify the exact invoice number';end if;doc:=public.record_manual_payment(a.business_id,obj,a.id,(f->>'payment_amount')::numeric,coalesce(f->>'payment_method','other'),coalesce(f->>'notes','Manually verified payment, entered with AI assistance'));r:=jsonb_build_object('payment',doc);
when 'create_job','schedule_job' then
if nullif(btrim(coalesce(f->>'job_title',f->>'job_description','')),'') is null then raise exception 'Job title required';end if;
if a.intent='schedule_job' then start_at:=(f->>'scheduled_at_text')::timestamptz;end_at:=(f->>'scheduled_end_text')::timestamptz;if start_at is null or start_at<now() or(end_at is not null and end_at<start_at) then raise exception 'Use a future start time and a valid end time';end if;end if;
insert into public.jobs(business_id,customer_id,title,description,status,scheduled_start,scheduled_end) values(a.business_id,customer,coalesce(f->>'job_title',f->>'job_description'),f->>'job_description',case when a.intent='schedule_job' then 'scheduled' else 'lead' end,start_at,end_at) returning id into job;
if a.intent='schedule_job' then insert into public.appointments(business_id,customer_id,job_id,title,starts_at,ends_at,status) values(a.business_id,customer,job,coalesce(f->>'job_title',f->>'job_description'),start_at,end_at,'scheduled');end if;
select jsonb_build_object('job',to_jsonb(j)) into r from public.jobs j where id=job;
when 'create_change_order' then
select count(*),min(id::text)::uuid into matches,job from public.jobs where business_id=a.business_id and customer_id=customer and status not in('canceled','completed') and(nullif(f->>'job_title','') is null or lower(btrim(title))=lower(btrim(f->>'job_title')));
if matches<>1 then raise exception 'Specify exactly one active job for this customer';end if;if jsonb_typeof(f->'line_items') is distinct from 'array' or jsonb_array_length(f->'line_items') not between 1 and 50 then raise exception 'Add 1 to 50 change-order line items';end if;
insert into public.change_orders(business_id,customer_id,job_id,title,description,reason,schedule_impact_days,schedule_note,status) values(a.business_id,customer,job,coalesce(f->>'change_order_title',f->>'job_description','Change order'),f->>'job_description',f->>'notes',coalesce((f->>'schedule_impact_days')::integer,0),f->>'schedule_note','draft') returning id into obj;
for item in select value from jsonb_array_elements(f->'line_items') loop insert into public.change_order_items(business_id,change_order_id,description,quantity,unit_price,tax_rate,sort_order) values(a.business_id,obj,item->>'description',(item->>'quantity')::numeric,(item->>'unit_price')::numeric,coalesce((item->>'tax_rate')::numeric,0),k);k:=k+1;end loop;
select jsonb_build_object('change_order',to_jsonb(c)) into r from public.change_orders c where id=obj;
when 'business_summary' then r:=public.get_dashboard_metrics(a.business_id);r:=r||jsonb_build_object('customers',r->'customer_count','active_jobs',(select count(*) from public.jobs where business_id=a.business_id and status not in('completed','canceled')));
when 'list_unpaid_invoices' then r:=public.get_dashboard_metrics(a.business_id);r:=jsonb_build_object('count',r->'open_count','total_outstanding',r->'outstanding','invoices',coalesce((select jsonb_agg(to_jsonb(i)) from(select id,invoice_number,balance_due,due_date from public.invoices where business_id=a.business_id and status not in('draft','void') and balance_due>0 order by due_date nulls last limit 50)i),'[]'::jsonb),'list_limit',50);
when 'customer_history' then r:=jsonb_build_object('customer_id',customer,'invoices',coalesce((select jsonb_agg(to_jsonb(i)) from(select id,invoice_number,status,total,balance_due from public.invoices where business_id=a.business_id and customer_id=customer order by created_at desc limit 20)i),'[]'::jsonb),'jobs',coalesce((select jsonb_agg(to_jsonb(j)) from(select id,title,status from public.jobs where business_id=a.business_id and customer_id=customer order by created_at desc limit 20)j),'[]'::jsonb));
else raise exception 'This action is not supported';end case;
update public.ai_actions set status='executed',executed_at=now(),parsed_payload=parsed_payload||jsonb_build_object('execution_result',r) where id=a.id;return jsonb_build_object('action_id',a.id,'status','executed','result',r);
end$function$;

create function private.has_paid_plan(b uuid) returns boolean language sql stable security definer set search_path='' as $$select private.is_business_member(b) and private.effective_plan(b)<>'free'$$;
revoke all on function private.has_paid_plan(uuid) from public,anon,service_role;
grant execute on function private.has_paid_plan(uuid) to authenticated;

drop policy if exists approval_pro_only on public.document_approval_links;
drop policy if exists velnu_approval_paid_only on public.document_approval_links;
alter policy branding_read on public.business_branding using(private.is_business_member(business_id));
alter policy branding_insert on public.business_branding with check(private.has_business_role(business_id,array['owner','admin']) and private.has_paid_plan(business_id));
alter policy branding_update on public.business_branding using(private.has_business_role(business_id,array['owner','admin']) and private.has_paid_plan(business_id)) with check(private.has_business_role(business_id,array['owner','admin']) and private.has_paid_plan(business_id));

alter policy velnu_agreement_acceptance_insert on public.user_agreement_acceptances with check (
 user_id=auth.uid() and agreement_version in('2026-10-27-v3','2026-11-06-v4','2026-11-06-v5')
 and terms_accepted and ai_disclosure_acknowledged and electronic_records_consent
 and acceptance_method='checkbox_and_button' and selected_tier_at_acceptance is not null
 and exists(select 1 from public.user_plan_preferences p where p.user_id=auth.uid() and p.selected_tier=user_agreement_acceptances.selected_tier_at_acceptance));

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
end $function$;

CREATE OR REPLACE FUNCTION private.set_recurring_invoice_status(plan uuid, state text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p private.recurring_invoice_plans%rowtype;today date;
begin
 select * into p from private.recurring_invoice_plans where id=plan;
 if not found or auth.uid() is null or not private.is_primary_owner(p.business_id) or not private.can_write_business(p.business_id) or not private.member_module_access(p.business_id,auth.uid(),'billing') then raise exception 'Primary owner billing access is required.' using errcode='42501';end if;
 if state='active' and private.effective_plan(p.business_id)='free' then raise exception 'Recurring drafts require Individual or Business Pro.' using errcode='42501';end if;
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
end $function$;
