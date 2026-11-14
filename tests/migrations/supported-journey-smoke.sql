-- Owned disposable Supabase only; called after the unchanged full migration replay.
-- Real database functions, simulated JWT identity and synthetic records, no provider calls.
begin;
do $journey$
#variable_conflict use_variable
declare
 owner_id uuid:=gen_random_uuid(); business_id uuid:=gen_random_uuid(); customer_id uuid:=gen_random_uuid();
 estimate_id uuid; job_id uuid; invoice_id uuid; appointment_id uuid; revision_id uuid;
 request_id uuid:=gen_random_uuid(); payment_id uuid:=gen_random_uuid(); offer_id uuid:=gen_random_uuid();
 share_token text:=encode(gen_random_bytes(32),'hex'); schedule_token text:=encode(gen_random_bytes(32),'hex');
 invoice_token text:=encode(gen_random_bytes(32),'hex'); approval_hash text;
 doc jsonb; offered jsonb; result jsonb; facts jsonb; slot jsonb; event_id uuid; settings jsonb;
 today date:=(now() at time zone 'America/New_York')::date; visit_version integer;
begin
 insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
 values(owner_id,'authenticated','authenticated','journey-owner@example.test',now(),now(),now());
 insert into auth.sessions(id,user_id) values(owner_id,owner_id);
 insert into public.user_agreement_acceptances(user_id,agreement_version,terms_accepted,ai_disclosure_acknowledged,electronic_records_consent)
 values(owner_id,'2026-11-06-v5',true,true,true);
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('session_id',owner_id)::text,true);
 insert into public.businesses(id,name,created_by_user_id,timezone)
 values(business_id,'Synthetic journey replay',owner_id,'America/New_York');
 insert into private.business_entitlements(business_id,plan) values(business_id,'pro')
 on conflict on constraint business_entitlements_pkey do update set plan='pro',valid_until=null;
 -- Sender readiness is synthetic and rolled back. Delivery worker/vault stay disabled.
 insert into private.managed_delivery_accounts(business_id,email_active,reply_to)
 values(business_id,true,'journey-owner@example.test');
 execute 'set local role authenticated';
 insert into public.customers(id,business_id,first_name,last_name,email)
 values(customer_id,business_id,'Journey','Synthetic','journey-customer@example.test');
 perform public.save_worker_profile(business_id,owner_id,jsonb_build_object('name','Synthetic crew','active',true),null);
 settings:=public.get_journey_notice_settings(business_id);
 if settings->>'booking_confirmation'<>'false' or settings->>'payment_receipt'<>'false' then
  raise exception 'New notifications must start disabled' using errcode='23514',constraint='journey_default_off';
 end if;
 perform public.save_journey_notice_settings(business_id,true,true,0);
 doc:=public.create_document(business_id,'estimate',request_id,jsonb_build_object(
  'customer_id',customer_id,'issue_date',today,'expires_on',today+30,'payment_terms_days',15,
  'items',jsonb_build_array(jsonb_build_object('description','Agreed synthetic repair','quantity',2,'unit_price',50,'tax_rate',5))));
 estimate_id:=(doc->>'id')::uuid;
 doc:=public.prepare_personal_document(business_id,'estimate',estimate_id,share_token);
 revision_id:=(doc->>'revision_id')::uuid;
 approval_hash:=encode(sha256(convert_to(doc->>'approval_token','UTF8')),'hex');
 if doc#>>'{snapshot,customer_message}' not like '%Invoice payment terms: Net 15 days.%' then
  raise exception 'Agreed revision omitted payment terms' using errcode='23514',constraint='journey_visible_terms';
 end if;
 -- Explicit owner confirmation records an unverified personal-app send, not provider delivery.
 perform public.confirm_personal_document_sent(business_id,share_token,'email');
 execute 'reset role';
 result:=public.consume_document_approval(approval_hash,'approved','Journey Synthetic','Synthetic replay',true,revision_id);
 perform public.consume_document_approval(approval_hash,'approved','Journey Synthetic','Synthetic replay',true,revision_id);
 select e.job_id into job_id from public.estimates e where e.id=estimate_id;
 if job_id is null or (select count(*) from public.jobs j where j.source_estimate_id=estimate_id)<>1 then
  raise exception 'Customer approval must create one job' using errcode='23514',constraint='journey_one_job';
 end if;
 execute 'set local role authenticated';
 offered:=public.suggest_scheduling_slots(business_id,array[owner_id],60,today);
 slot:=offered->0;
 if slot is null then raise exception 'No synthetic crew slot' using errcode='23514',constraint='journey_slot';end if;
 perform public.approve_scheduling_offer(estimate_id,offer_id,jsonb_build_object('title','Synthetic repair',
  'workers',jsonb_build_array(owner_id),'slots',jsonb_build_array(slot),'note','','recipient_email','journey-customer@example.test'),
  encode(sha256(convert_to(schedule_token,'UTF8')),'hex'));
 execute 'reset role';
 result:=public.customer_schedule_offer(schedule_token);
 result:=public.customer_schedule_offer(schedule_token,(result#>>'{slots,0,id}')::uuid,'Journey Synthetic');
 if result->>'status'<>'booked' or (select count(*) from public.appointments a where a.job_id=job_id)<>1 then
  raise exception 'Customer booking must reuse one job and visit' using errcode='23514',constraint='journey_one_visit';
 end if;
 select a.id into appointment_id from public.appointments a where a.job_id=job_id;
 if public.prepare_due_journey_notices()<>1 or public.prepare_due_journey_notices()<>0 then
  raise exception 'Booking confirmation preparation is not replay safe' using errcode='23514',constraint='journey_one_confirmation';
 end if;
 -- A fast test cannot wait for the future visit. Move only this synthetic visit
 -- back two weeks (same weekday/local working hour); keep every source guard enabled.
 update public.appointments a set starts_at=a.starts_at-interval '14 days',ends_at=a.ends_at-interval '14 days' where a.id=appointment_id;
 execute 'set local role authenticated';
 select a.visit_version into visit_version from public.appointments a where a.id=appointment_id;
 perform public.manage_job_visit(business_id,job_id,'start',jsonb_build_object('id',appointment_id,'version',visit_version));
 select a.visit_version into visit_version from public.appointments a where a.id=appointment_id;
 perform public.manage_job_visit(business_id,job_id,'finish',jsonb_build_object('id',appointment_id,'version',visit_version));
 result:=public.complete_job_workflow(job_id,owner_id,false);invoice_id:=(result->>'invoice_id')::uuid;
 if invoice_id is null or (result->>'invoice_ready')::boolean is not true then
  raise exception 'Completion did not prepare a final invoice' using errcode='23514',constraint='journey_final_draft';
 end if;
 result:=public.complete_job_workflow(job_id,owner_id,true);
 if (result->>'invoice_id')::uuid<>invoice_id or (select count(*) from public.invoices i where i.estimate_id=estimate_id)<>1
  or not exists(select 1 from public.invoices i where i.id=invoice_id and i.status='draft' and i.total=105 and i.due_date=i.issue_date+15) then
  raise exception 'Final draft must preserve scope, terms and retry identity' using errcode='23514',constraint='journey_final_scope_terms';
 end if;
 doc:=public.prepare_personal_document(business_id,'invoice',invoice_id,invoice_token);
 perform public.confirm_personal_document_sent(business_id,invoice_token,'email');
 execute 'reset role';
 perform public.record_customer_invoice_open(invoice_token);
 if not exists(select 1 from public.invoices i where i.id=invoice_id and i.status='viewed') then
  raise exception 'Current issued revision opening was not tracked' using errcode='23514',constraint='journey_invoice_open';
 end if;
 execute 'set local role authenticated';
 perform public.record_manual_payment(business_id,invoice_id,payment_id,40,'cash','Synthetic received payment');
 perform public.record_manual_payment(business_id,invoice_id,payment_id,40,'cash','Synthetic received payment');
 if not exists(select 1 from public.invoices i where i.id=invoice_id and i.status='partial' and i.balance_due=65) then
  raise exception 'Partial payment retry changed the ledger' using errcode='23514',constraint='journey_partial_payment';
 end if;
 perform public.record_manual_payment(business_id,invoice_id,gen_random_uuid(),65,'cash','Synthetic final payment');
 facts:=public.get_job_management(business_id,job_id)->'journey';
 if facts->>'workStatus'<>'completed' or facts#>>'{invoice,status}'<>'paid' or (facts#>>'{invoice,balanceDue}')::numeric<>0
  or facts->>'payment'<>'none' or (facts->>'remainingVisits')::integer<>0 then
  raise exception 'Completed and paid journey facts are inconsistent' using errcode='23514',constraint='journey_settled';
 end if;
 execute 'reset role';
 if public.prepare_due_journey_notices()<>1 or public.prepare_due_journey_notices()<>0 then
  raise exception 'Prepare only the current cumulative receipt' using errcode='23514',constraint='journey_one_current_receipt';
 end if;
 select n.id into event_id from private.journey_notices n join private.workflow_events e on e.id=n.id
 where e.invoice_id=invoice_id and e.kind='payment_received' and n.state='queued';
 if event_id is null or (select payload->>'text' from private.finviant_email_outbox where id=event_id) not like '%This invoice is paid.%' then
  raise exception 'Paid receipt omitted the verified balance' using errcode='23514',constraint='journey_receipt_balance';
 end if;
 if (select count(*) from private.workflow_events e where e.invoice_id=invoice_id and e.kind='payment_received')<>2 then
  raise exception 'Distinct payment transitions were lost' using errcode='23514',constraint='journey_payment_events';
 end if;
end $journey$;
rollback;
