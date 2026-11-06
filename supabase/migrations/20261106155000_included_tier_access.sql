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
