-- Optional explicit requirements. Existing issued documents and arranged visits retain their history.
alter table public.estimates add column payment_terms_days integer check(payment_terms_days between 0 and 365);
alter table public.invoices add column booking_required boolean not null default false check(not booking_required or deposit_estimate_id is not null);
alter table public.invoices add column journey_terms_review_required boolean not null default false;

create function private.guard_estimate_payment_terms() returns trigger
language plpgsql security definer set search_path='' as $$
declare previous_text text;terms_text text;
begin
 if tg_op='UPDATE' and new.payment_terms_days is distinct from old.payment_terms_days and old.status<>'draft' then raise exception 'Issued payment terms require a reviewed estimate revision.' using errcode='23514';end if;
 if new.status<>'draft' then return new;end if;
 if tg_op='UPDATE' and old.payment_terms_days is not null then
  previous_text:='Invoice payment terms: '||case when old.payment_terms_days=0 then 'Due on issue.' else 'Net '||old.payment_terms_days||' days.' end;
  new.customer_message:=replace(coalesce(new.customer_message,''),E'\n\n'||previous_text,'');
  if new.customer_message=previous_text then new.customer_message:='';end if;
 end if;
 if new.payment_terms_days is not null then
  terms_text:='Invoice payment terms: '||case when new.payment_terms_days=0 then 'Due on issue.' else 'Net '||new.payment_terms_days||' days.' end;
  new.customer_message:=replace(coalesce(new.customer_message,''),E'\n\n'||terms_text,'');
  if new.customer_message=terms_text then new.customer_message:='';end if;
  new.customer_message:=concat_ws(E'\n\n',nullif(btrim(new.customer_message),''),terms_text);
 end if;
 if length(coalesce(new.customer_message,''))>4000 then raise exception 'Customer terms, including payment terms, must fit within 4000 characters.' using errcode='22023';end if;
 return new;
end $$;
revoke all on function private.guard_estimate_payment_terms() from public,anon,authenticated,service_role;
create trigger zz_estimate_payment_terms before insert or update of payment_terms_days,customer_message,status on public.estimates for each row execute function private.guard_estimate_payment_terms();

-- Keep the original invoker/RLS boundary and idempotent document creation.
alter function public.create_document(uuid,text,uuid,jsonb) rename to create_document_before_journey_terms;
alter function public.create_document_before_journey_terms(uuid,text,uuid,jsonb) set schema private;
revoke all on function private.create_document_before_journey_terms(uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.create_document_before_journey_terms(uuid,text,uuid,jsonb) to authenticated,service_role;
create function public.create_document(target_business_id uuid,document_kind text,request_id uuid,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;fresh jsonb;
begin
 result:=private.create_document_before_journey_terms(target_business_id,document_kind,request_id,payload);
 if document_kind='estimate' and payload?'payment_terms_days' and result->>'status'='draft' then
  update public.estimates e set payment_terms_days=nullif(payload->>'payment_terms_days','')::integer where e.business_id=target_business_id and e.id=(result->>'id')::uuid and e.status='draft' returning to_jsonb(e) into fresh;
  if fresh is null then raise exception 'Estimate changed. Reload before setting payment terms.' using errcode='40001';end if;
  result:=result||fresh;
 end if;return result;
end $$;
revoke all on function public.create_document(uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_document(uuid,text,uuid,jsonb) to authenticated,service_role;

alter function public.update_draft_document(uuid,text,uuid,timestamptz,jsonb) rename to update_draft_document_before_journey_terms;
alter function public.update_draft_document_before_journey_terms(uuid,text,uuid,timestamptz,jsonb) set schema private;
revoke all on function private.update_draft_document_before_journey_terms(uuid,text,uuid,timestamptz,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.update_draft_document_before_journey_terms(uuid,text,uuid,timestamptz,jsonb) to authenticated,service_role;
create function public.update_draft_document(target_business_id uuid,document_kind text,document_id uuid,expected_updated_at timestamptz,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;fresh jsonb;
begin
 result:=private.update_draft_document_before_journey_terms(target_business_id,document_kind,document_id,expected_updated_at,payload);
 if document_kind='estimate' and payload?'payment_terms_days' then
  update public.estimates e set payment_terms_days=nullif(payload->>'payment_terms_days','')::integer where e.business_id=target_business_id and e.id=document_id and e.status='draft' returning to_jsonb(e) into fresh;
  if fresh is null then raise exception 'Estimate changed. Reload before setting payment terms.' using errcode='40001';end if;
  result:=result||fresh;
 end if;return result;
end $$;
revoke all on function public.update_draft_document(uuid,text,uuid,timestamptz,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.update_draft_document(uuid,text,uuid,timestamptz,jsonb) to authenticated,service_role;

alter function public.create_revised_estimate(uuid,uuid) rename to create_revised_estimate_before_payment_terms;
alter function public.create_revised_estimate_before_payment_terms(uuid,uuid) set schema private;
revoke all on function private.create_revised_estimate_before_payment_terms(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.create_revised_estimate_before_payment_terms(uuid,uuid) to authenticated;
create function public.create_revised_estimate(p_estimate uuid,p_request uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;days integer;
begin
 result:=private.create_revised_estimate_before_payment_terms(p_estimate,p_request);
 if coalesce((result->>'already_created')::boolean,false) is false then
  select payment_terms_days into days from public.estimates where id=p_estimate;
  update public.estimates set payment_terms_days=days where id=(result->>'estimate_id')::uuid and status='draft';
 end if;return result;
end $$;
revoke all on function public.create_revised_estimate(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_revised_estimate(uuid,uuid) to authenticated;

create function private.guard_final_invoice_payment_terms() returns trigger
language plpgsql security definer set search_path='' as $$
declare days integer;
begin
 if tg_op='INSERT' then new.journey_terms_review_required:=true;
 elsif new.journey_terms_review_required is distinct from old.journey_terms_review_required then raise exception 'The invoice terms review scope cannot be changed.' using errcode='23514';end if;
 if new.status='draft' and new.estimate_id is not null then
  select payment_terms_days into days from public.estimates where id=new.estimate_id and business_id=new.business_id;
  if days is not null then
   if new.issue_date is null then raise exception 'Choose the invoice issue date before calculating agreed payment terms.' using errcode='23514';end if;
   if new.due_date is null then new.due_date:=new.issue_date+days;
   elsif new.due_date<>new.issue_date+days then raise exception 'The due date conflicts with the approved payment terms. Review a revised agreement before changing them.' using errcode='23514';end if;
  end if;
 end if;return new;
end $$;
revoke all on function private.guard_final_invoice_payment_terms() from public,anon,authenticated,service_role;
create trigger zz_final_invoice_payment_terms before insert or update of issue_date,due_date,estimate_id,journey_terms_review_required on public.invoices for each row execute function private.guard_final_invoice_payment_terms();

create function private.require_final_invoice_due_date(p_business uuid,p_invoice uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if exists(select 1 from public.invoices where id=p_invoice and business_id=p_business and journey_terms_review_required and job_id is not null and estimate_id is not null and status='draft' and due_date is null) then
  raise exception 'Choose the final invoice payment due date before publishing or sending. Missing terms are not replaced with a global default.' using errcode='23514';
 end if;
end $$;
revoke all on function private.require_final_invoice_due_date(uuid,uuid) from public,anon,authenticated,service_role;
alter function private.publish_document_version(uuid,uuid,text,uuid) rename to publish_document_version_before_journey_terms;
create function private.publish_document_version(p_actor uuid,p_business uuid,p_kind text,p_document uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_kind='invoice' then perform private.require_final_invoice_due_date(p_business,p_document);end if;
 return private.publish_document_version_before_journey_terms(p_actor,p_business,p_kind,p_document);
end $$;
revoke all on function private.publish_document_version_before_journey_terms(uuid,uuid,text,uuid),private.publish_document_version(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.publish_document_version(uuid,uuid,text,uuid) to service_role;
create function private.guard_journey_invoice_issue() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='draft' and new.status not in('draft','void') and new.journey_terms_review_required and new.job_id is not null and new.estimate_id is not null and new.due_date is null then
  raise exception 'Choose the final invoice payment due date before issuing it.' using errcode='23514';end if;
 return new;
end $$;
revoke all on function private.guard_journey_invoice_issue() from public,anon,authenticated,service_role;
create trigger journey_invoice_issue before update of status on public.invoices for each row execute function private.guard_journey_invoice_issue();

create function public.create_estimate_deposit_with_booking_rule(p_estimate uuid,p_amount numeric,p_due date,p_required boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare invoice uuid;d public.invoices%rowtype;
begin
 if p_required is null then raise exception 'Choose whether this deposit is required before booking.' using errcode='22023';end if;
 if not exists(select 1 from public.estimates e where e.id=p_estimate and private.member_module_access(e.business_id,auth.uid(),'billing') and private.has_business_role(e.business_id,array['owner','admin','office'])) then raise exception 'Billing access required' using errcode='42501';end if;
 invoice:=public.create_estimate_deposit(p_estimate,p_amount,p_due);
 select * into d from public.invoices where id=invoice for update;
 if d.booking_required is distinct from p_required then
  if d.status<>'draft' then raise exception 'Review the existing issued deposit instead of changing its booking requirement.' using errcode='23514';end if;
  update public.invoices set booking_required=p_required where id=d.id;
 end if;return invoice;
end $$;
revoke all on function public.create_estimate_deposit_with_booking_rule(uuid,numeric,date,boolean) from public,anon,authenticated,service_role;
grant execute on function public.create_estimate_deposit_with_booking_rule(uuid,numeric,date,boolean) to authenticated;
create function private.guard_deposit_booking_terms() returns trigger language plpgsql security definer set search_path='' as $$
declare terms_text text:='This deposit must be paid before booking a new appointment.';
begin
 if tg_op='UPDATE' and old.status<>'draft' and new.booking_required is distinct from old.booking_required then raise exception 'Issued deposit booking terms cannot be changed.' using errcode='23514';end if;
 if new.status='draft' and new.deposit_estimate_id is not null then
  if tg_op='UPDATE' and old.booking_required or new.booking_required then
   new.customer_message:=replace(coalesce(new.customer_message,''),E'\n\n'||terms_text,'');
   if new.customer_message=terms_text then new.customer_message:='';end if;
  end if;
  if new.booking_required then new.customer_message:=concat_ws(E'\n\n',nullif(btrim(new.customer_message),''),terms_text);end if;
  if length(coalesce(new.customer_message,''))>4000 then raise exception 'Deposit message and booking terms must fit within 4000 characters.' using errcode='22023';end if;
 end if;return new;
end $$;
revoke all on function private.guard_deposit_booking_terms() from public,anon,authenticated,service_role;
create trigger zz_deposit_booking_terms before insert or update of booking_required,customer_message,status on public.invoices for each row execute function private.guard_deposit_booking_terms();
create function private.required_deposit_settled(p_estimate uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.invoices d where d.deposit_estimate_id=p_estimate and d.booking_required and d.status<>'void'
  and (d.status<>'paid' or d.balance_due>0 or private.journey_payment_state(d.id)<>'none'));
$$;
create function private.assert_booking_deposit(p_estimate uuid) returns void
language plpgsql security definer set search_path='' as $$
declare b uuid;
begin
 select business_id into b from public.estimates where id=p_estimate;
 if b is null then raise exception 'Estimate unavailable' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
 perform 1 from public.estimates where id=p_estimate and business_id=b for update;
 -- Existing arranged work remains intact; a payment exception is handled separately.
 if exists(select 1 from public.appointments a join public.jobs j on j.id=a.job_id and j.business_id=a.business_id where j.business_id=b and j.source_estimate_id=p_estimate and a.status in('scheduled','confirmed','in_progress')) then return;end if;
 perform 1 from public.invoices where business_id=b and deposit_estimate_id=p_estimate and booking_required and status<>'void' for update;
 if not private.required_deposit_settled(p_estimate) then raise exception 'Receive the required deposit before booking a new appointment.' using errcode='23514';end if;
end $$;
revoke all on function private.required_deposit_settled(uuid),private.assert_booking_deposit(uuid) from public,anon,authenticated,service_role;

alter function private.book_estimate_job(uuid,uuid,text,uuid[],timestamptz,timestamptz) rename to book_estimate_job_before_deposit_rule;
-- PL/pgSQL qualifies the title parameter with its function's implicit block
-- label. Keep that qualification valid after renaming the preserved body.
do $migration$
begin
 execute replace(pg_get_functiondef('private.book_estimate_job_before_deposit_rule(uuid,uuid,text,uuid[],timestamptz,timestamptz)'::regprocedure),
  'book_estimate_job.title','book_estimate_job_before_deposit_rule.title');
end $migration$;
create function private.book_estimate_job(estimate uuid,site uuid,title text,workers uuid[],s timestamptz,e timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform private.assert_booking_deposit(estimate);
 return private.book_estimate_job_before_deposit_rule(estimate,site,title,workers,s,e);
end $$;
revoke all on function private.book_estimate_job_before_deposit_rule(uuid,uuid,text,uuid[],timestamptz,timestamptz),private.book_estimate_job(uuid,uuid,text,uuid[],timestamptz,timestamptz) from public,anon,authenticated,service_role;

alter function private.approve_scheduling_offer(uuid,uuid,jsonb,text) rename to approve_scheduling_offer_before_deposit_rule;
create function private.approve_scheduling_offer(estimate uuid,request uuid,input jsonb,hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 -- Preserve the existing permission/plan checks before exposing a billing requirement.
 if not exists(select 1 from public.estimates e where e.id=estimate and private.can_manage_schedule(e.business_id) and private.member_module_access(e.business_id,auth.uid(),'billing')) then raise exception 'Scheduling access required' using errcode='42501';end if;
 perform private.assert_booking_deposit(estimate);
 return private.approve_scheduling_offer_before_deposit_rule(estimate,request,input,hash);
end $$;
revoke all on function private.approve_scheduling_offer_before_deposit_rule(uuid,uuid,jsonb,text),private.approve_scheduling_offer(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function private.approve_scheduling_offer(uuid,uuid,jsonb,text) to authenticated;

alter function private.customer_schedule_offer(text,uuid,text) rename to customer_schedule_offer_before_deposit_rule;
create function private.customer_schedule_offer(hash text,slot uuid default null,chosen_name text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;estimate uuid;
begin
 -- The original body and common booking helper retain token, offer, availability and role checks.
 result:=private.customer_schedule_offer_before_deposit_rule(hash,slot,chosen_name);
 if result->>'status'='approved' then
  select estimate_id into estimate from private.scheduling_offers where token_hash=hash;
  if not private.required_deposit_settled(estimate) then return result||jsonb_build_object('status','paused','can_book',false,'slots','[]'::jsonb,'status_reason','The required deposit must be received before booking. Contact the business.');end if;
 end if;return result;
end $$;
revoke all on function private.customer_schedule_offer_before_deposit_rule(text,uuid,text),private.customer_schedule_offer(text,uuid,text) from public,anon,authenticated,service_role;

create function private.guard_required_booking_deposit() returns trigger language plpgsql security definer set search_path='' as $$
declare estimate uuid;
begin
 if new.job_id is null or new.status not in('scheduled','confirmed','in_progress') then return new;end if;
 if tg_op='UPDATE' and new.job_id is not distinct from old.job_id and old.status in('scheduled','confirmed','in_progress') then return new;end if;
 select source_estimate_id into estimate from public.jobs where id=new.job_id and business_id=new.business_id;
 if estimate is not null then perform private.assert_booking_deposit(estimate);end if;
 return new;
end $$;
revoke all on function private.guard_required_booking_deposit() from public,anon,authenticated,service_role;
create trigger zz_required_booking_deposit before insert or update of status,job_id on public.appointments for each row execute function private.guard_required_booking_deposit();

alter function private.job_journey_facts(uuid,uuid,jsonb) rename to job_journey_facts_before_deposit_rule;
create function private.job_journey_facts(p_business uuid,p_job uuid,p_work jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result:=private.job_journey_facts_before_deposit_rule(p_business,p_job,p_work);
 if coalesce((result->>'billingVisible')::boolean,false) and not exists(select 1 from public.invoices where id=(result->>'depositInvoiceId')::uuid and business_id=p_business and booking_required) then result:=result||jsonb_build_object('deposit','not_required');end if;
 return result;
end $$;
revoke all on function private.job_journey_facts_before_deposit_rule(uuid,uuid,jsonb),private.job_journey_facts(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

alter function private.owner_archive_sources(uuid,uuid) rename to owner_archive_sources_before_booking_terms;
create function private.owner_archive_sources(b uuid,owner_id uuid) returns table(collection text,payload jsonb)
language sql stable security definer set search_path='' as $$
 select s.collection,s.payload||case s.collection
  when 'public.estimates' then coalesce((select jsonb_build_object('payment_terms_days',e.payment_terms_days) from public.estimates e where e.business_id=b and e.id=(s.payload->>'id')::uuid),'{}'::jsonb)
  when 'public.invoices' then coalesce((select jsonb_build_object('booking_required',i.booking_required,'journey_terms_review_required',i.journey_terms_review_required) from public.invoices i where i.business_id=b and i.id=(s.payload->>'id')::uuid),'{}'::jsonb)
  else '{}'::jsonb end
 from private.owner_archive_sources_before_booking_terms(b,owner_id) s;
$$;
revoke all on function private.owner_archive_sources_before_booking_terms(uuid,uuid),private.owner_archive_sources(uuid,uuid) from public,anon,authenticated,service_role;
