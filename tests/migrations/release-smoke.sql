-- Only the credential-free, owned disposable replay database runs this file.
-- Real managed Auth/Storage and final application definitions; no helper stubs.
-- Database role/JWT-claim simulation, not hosted Auth sessions or provider tests.
begin;
-- Force the database day ahead of the first business at every time of day.
-- Document dates belong to the business timezone, not the CI runner/server.
set local time zone 'Pacific/Kiritimati';
do $$declare health jsonb; metric text;begin
 if has_function_privilege('anon','public.finviant_ops_health()','EXECUTE')
  or has_function_privilege('authenticated','public.finviant_ops_health()','EXECUTE')
  or not has_function_privilege('service_role','public.finviant_ops_health()','EXECUTE') then
  raise exception 'Worker health must retain service-only access' using errcode='23514',constraint='replay_health_acl';
 end if;
 health:=public.finviant_ops_health();
 foreach metric in array array['calendar_stale','calendar_dead','calendar_reconnect_required','appointment_stale','appointment_uncertain','appointment_failed_last_day','recurring_overdue','recurring_needs_review'] loop
  if jsonb_typeof(health->metric) is distinct from 'number' or (health->>metric)::bigint<>0 then
   raise exception 'Disposable empty database has missing or unhealthy worker metrics' using errcode='23514',constraint='replay_health_metrics';
  end if;
 end loop;
end $$;
-- View dependencies evolve with Job Management. Check the actual final view,
-- not a copied fixture, against the dedicated worker's column privileges.
do $$begin
 if exists(
  select 1 from pg_rewrite r join pg_depend d on d.classid='pg_rewrite'::regclass and d.objid=r.oid and d.refclassid='pg_class'::regclass
  join pg_attribute a on a.attrelid=d.refobjid and a.attnum=d.refobjsubid
  where r.ev_class='public.calendar_work'::regclass and d.refobjid<>r.ev_class and d.refobjsubid>0
  and not has_column_privilege('calendar_worker',a.attrelid,a.attnum,'SELECT')
 ) then raise exception 'Calendar projection has an unreadable dependency' using errcode='23514',constraint='replay_calendar_column_grants';end if;
 if has_table_privilege('calendar_worker','public.appointments','SELECT')
  or has_column_privilege('calendar_worker','public.invoices','total','SELECT')
  or has_table_privilege('calendar_worker','public.appointments','UPDATE') then
  raise exception 'Calendar worker has broader access than its projection requires' using errcode='23514',constraint='replay_calendar_narrow_grants';
 end if;
end $$;
do $$
declare
 owner_a uuid:=gen_random_uuid(); owner_b uuid:=gen_random_uuid();
 business_a uuid:=gen_random_uuid(); business_b uuid:=gen_random_uuid();
 customer uuid:=gen_random_uuid(); worker uuid:=gen_random_uuid();
 request uuid:=gen_random_uuid(); receipt uuid:=gen_random_uuid();
 business_today date;
 invoice uuid; estimate uuid; job uuid; data jsonb; payload jsonb; blocked boolean; reference_draft uuid; copy_id uuid; version_time timestamptz; original_snapshot jsonb;
begin
 insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
 values(owner_a,'authenticated','authenticated','replay-a@example.test',now(),now(),now()),
       (owner_b,'authenticated','authenticated','replay-b@example.test',now(),now(),now());
 insert into auth.sessions(id,user_id) values(owner_a,owner_a),(owner_b,owner_b); -- SQL role simulation only
 insert into public.user_agreement_acceptances(user_id,agreement_version,terms_accepted,ai_disclosure_acknowledged,electronic_records_consent)
 values(owner_a,'2026-11-06-v5',true,true,true),(owner_b,'2026-11-06-v5',true,true,true);
 perform set_config('request.jwt.claim.sub',owner_a::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('session_id',owner_a)::text,true);
 insert into public.businesses(id,name,created_by_user_id,timezone) values(business_a,'Replay synthetic A',owner_a,'Pacific/Pago_Pago');
 perform set_config('request.jwt.claim.sub',owner_b::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('session_id',owner_b)::text,true);
 insert into public.businesses(id,name,created_by_user_id,timezone) values(business_b,'Replay synthetic B',owner_b,'Pacific/Kiritimati');
 insert into private.business_entitlements(business_id,plan) values(business_a,'pro'),(business_b,'pro')
 on conflict(business_id) do update set plan='pro',valid_until=null;

 perform set_config('request.jwt.claim.sub',owner_a::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('session_id',owner_a)::text,true);
 execute 'set local role authenticated';
 select (now() at time zone timezone)::date into business_today from public.businesses where id=business_a;
 if business_today>=current_date then raise exception 'Replay must exercise different business and server dates' using errcode='23514',constraint='replay_business_date_boundary';end if;
 insert into public.customers(id,business_id,first_name,last_name) values(customer,business_a,'Replay','Synthetic');
 insert into public.service_packages(business_id,name,items) values(business_a,'Synthetic service package','[{"description":"Synthetic package line","quantity":2,"unit_price":50,"tax_rate":5}]');
 payload:=jsonb_build_object('customer_id',customer,'customer_reference','PO-1109','items',jsonb_build_array(jsonb_build_object('description','Reference fixture','quantity',1,'unit_price',50,'tax_rate',0)));
 data:=public.create_document(business_a,'invoice',gen_random_uuid(),payload);reference_draft:=(data->>'id')::uuid;
 if data->>'customer_reference' is distinct from 'PO-1109' or (data->>'total')::numeric<>50 then raise exception 'Customer reference or amount was not saved atomically' using errcode='23514',constraint='replay_customer_reference';end if;
 select updated_at into version_time from public.invoices where id=reference_draft;
 data:=public.update_draft_document(business_a,'invoice',reference_draft,version_time,payload||jsonb_build_object('customer_reference','PO-1110'));
 if data->>'customer_reference' is distinct from 'PO-1110' then raise exception 'Reference draft edit failed' using errcode='23514',constraint='replay_reference_edit';end if;
 data:=public.copy_document_to_draft(business_a,'invoice',reference_draft,gen_random_uuid());copy_id:=(data->>'id')::uuid;
 if data->>'customer_reference' is not null or (data->>'amount_paid')::numeric<>0 then raise exception 'Copied draft retained transaction reference or payments' using errcode='23514',constraint='replay_reference_clone';end if;
 update public.invoices set status='sent' where id=reference_draft;
 blocked:=false;begin update public.invoices set customer_reference='CHANGED' where id=reference_draft;exception when check_violation then blocked:=true;end;
 if not blocked then raise exception 'Issued customer reference was mutable' using errcode='23514',constraint='replay_reference_immutable';end if;
 execute 'reset role';
 original_snapshot:=private.customer_document_snapshot(business_a,'invoice',reference_draft);
 if original_snapshot->>'customer_reference' is distinct from 'PO-1110' then raise exception 'Customer snapshot omits reference' using errcode='23514',constraint='replay_reference_snapshot';end if;
 execute 'set local role authenticated';
 perform public.save_worker_profile(business_a,worker,jsonb_build_object('name','Replay roster worker','active',true),null);
 payload:=jsonb_build_object('customer_id',customer,'issue_date',business_today,'due_date',business_today,
   'items',jsonb_build_array(jsonb_build_object('description','Synthetic service','quantity',2,'unit_price',50,'tax_rate',5)));
 blocked:=false;
 begin perform public.create_document(business_a,'invoice',gen_random_uuid(),payload||jsonb_build_object('issue_date',current_date,'due_date',current_date));
 exception when raise_exception then blocked:=true;end;
 if not blocked then raise exception 'Server date bypassed the future business-date guard' using errcode='23514',constraint='replay_future_business_date';end if;
 data:=public.create_document(business_a,'invoice',request,payload); invoice:=(data->>'id')::uuid;
 if (data->>'issue_date')::date is distinct from business_today then raise exception 'Document date does not match the business day' using errcode='23514',constraint='replay_business_document_date';end if;
 if (public.create_document(business_a,'invoice',request,payload)->>'id')::uuid is distinct from invoice then raise exception 'Document retry was not idempotent' using errcode='23514',constraint='replay_document_retry';end if;
 if (select total from public.invoices where id=invoice)<>105 then raise exception 'Server invoice tax/total calculation failed' using errcode='23514',constraint='replay_invoice_total';end if;
 update public.invoices set status='sent' where id=invoice;
 perform public.record_manual_payment(business_a,invoice,receipt,30,'cash','Synthetic local receipt');
 perform public.record_manual_payment(business_a,invoice,receipt,30,'cash','Synthetic local receipt');
 if (select balance_due from public.invoices where id=invoice)<>75 or (select count(*) from public.payments where invoice_id=invoice)<>1 then raise exception 'Payment retry or remaining balance calculation failed' using errcode='23514',constraint='replay_payment_retry';end if;

 data:=public.create_document(business_a,'estimate',gen_random_uuid(),payload||jsonb_build_object('expires_on',business_today+30));
 estimate:=(data->>'id')::uuid;
 update public.estimates set status='accepted' where id=estimate;
 select job_id into job from public.estimates where id=estimate;
 if job is null or (select count(*) from public.jobs where source_estimate_id=estimate)<>1 then raise exception 'Approved estimate did not create exactly one job' using errcode='23514',constraint='replay_approval_job';end if;
 update public.estimates set status='accepted' where id=estimate;
 if (select count(*) from public.jobs where source_estimate_id=estimate)<>1 then raise exception 'Approval retry duplicated the job' using errcode='23514',constraint='replay_approval_retry';end if;

 perform set_config('request.jwt.claim.sub',owner_b::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('session_id',owner_b)::text,true);
 if exists(select 1 from public.service_packages where business_id=business_a) then raise exception 'Second tenant read service packages' using errcode='23514',constraint='replay_packages_tenant';end if;
 if exists(select 1 from public.customers where business_id=business_a) or exists(select 1 from public.invoices where id=invoice) or exists(select 1 from public.jobs where id=job) then raise exception 'Second tenant read another tenant record' using errcode='23514',constraint='replay_tenant_read';end if;
 blocked:=false;begin perform public.get_job_management(business_a,job);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Second tenant invoked another tenant management RPC' using errcode='23514',constraint='replay_tenant_rpc';end if;
 blocked:=false;begin perform public.save_worker_profile(business_a,gen_random_uuid(),jsonb_build_object('name','Unauthorized worker'),null);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Second tenant changed another tenant roster' using errcode='23514',constraint='replay_tenant_roster';end if;
 execute 'reset role';
 if (select count(*) from auth.users)<>2 or (select count(*) from public.business_members)<>2 then raise exception 'Adding a roster worker created account access' using errcode='23514',constraint='replay_roster_accounts';end if;
end $$;
rollback;
