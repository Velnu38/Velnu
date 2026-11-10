-- Synthetic acceptance against the already-migrated private-beta schema.
-- No auth users, storage objects, messages or provider charges are created.
-- All fixture records and permission mappings roll back, including on failure.
begin;
do $$
<<job_execution_check>>
declare
 b uuid;office uuid;field_user uuid;worker1 uuid:=gen_random_uuid();worker2 uuid:=gen_random_uuid();customer uuid:=gen_random_uuid();site uuid:=gen_random_uuid();
 estimate_id uuid;job uuid;unassigned_job uuid:=gen_random_uuid();deposit uuid;change_id uuid;invoice_id uuid;invoice_retry uuid;
 visit1 uuid:=gen_random_uuid();visit2 uuid:=gen_random_uuid();visit3 uuid:=gen_random_uuid();task uuid:=gen_random_uuid();photo uuid:=gen_random_uuid();time_request uuid:=gen_random_uuid();expense uuid:=gen_random_uuid();report uuid:=gen_random_uuid();
 data jsonb;second jsonb;payload jsonb;start1 timestamptz;future3 timestamptz;zone text;today date;version integer;blocked boolean;counted integer;cost numeric;balance numeric;
begin
 select x.id,x.created_by_user_id,x.timezone into b,office,zone from public.businesses x
 where private.effective_plan(x.id)='pro' and exists(select 1 from public.business_members m where m.business_id=x.id and m.user_id=x.created_by_user_id and m.role='owner')
 and exists(select 1 from public.user_agreement_acceptances a where a.user_id=x.created_by_user_id and a.terms_accepted and a.ai_disclosure_acknowledged and a.electronic_records_consent)
 and (select count(*) from public.business_members where business_id=x.id)<4 and (select count(*) from private.worker_profiles where business_id=x.id and active)<23
 order by x.id limit 1;
 if b is null then raise exception 'No eligible private-beta workspace for rollback verification';end if;
 select u.id into field_user from auth.users u
 where u.id<>office and not exists(select 1 from public.business_members where business_id=b and user_id=u.id)
 and exists(select 1 from public.user_agreement_acceptances a where a.user_id=u.id and a.terms_accepted and a.ai_disclosure_acknowledged and a.electronic_records_consent)
 order by u.id limit 1;
 if field_user is null then raise exception 'No eligible existing test identity for rollback verification';end if;
 perform set_config('request.jwt.claim.sub',office::text,true);
 today:=(now() at time zone coalesce(zone,'America/New_York'))::date;
 start1:=((today-40)+time '10:00') at time zone coalesce(zone,'America/New_York');future3:=now()+interval '40 days';
 insert into public.business_members(business_id,user_id,role,access_modules) values(b,field_user,'technician','{}');
 insert into private.worker_profiles(business_id,id,name,trade,active,is_owner) values(b,worker1,'QA execution worker one','Test',true,false),(b,worker2,'QA execution worker two','Test',true,false);
 execute 'set local role authenticated';
 if private.is_primary_owner(b) is not true then raise exception 'Owner identity could not be verified';end if;
 insert into public.customers(id,business_id,first_name,last_name) values(customer,b,'QA execution','Synthetic customer');
 insert into public.properties(id,business_id,customer_id,label,address_line1,city,state,postal_code) values(site,b,customer,'QA synthetic site','100 Test Only Lane','Chesapeake','VA','23320');
 data:=public.create_document(b,'estimate',gen_random_uuid(),jsonb_build_object('customer_id',customer,'property_id',site,'issue_date',today,'expires_on',today+30,'notes','QA execution rollback only','items',jsonb_build_array(jsonb_build_object('description','Synthetic repair','quantity',2,'unit_price',50,'tax_rate',5))));
 estimate_id:=(data->>'id')::uuid;
 update public.estimates set status='accepted' where id=estimate_id and business_id=b;
 select job_id into job from public.estimates where id=estimate_id;
 if job is null or (select count(*) from public.jobs where business_id=b and source_estimate_id=estimate_id)<>1 then raise exception 'Approval-to-single-job handoff failed';end if;
 if (select property_id from public.jobs where id=job) is distinct from site then raise exception 'Service site was not retained';end if;
 deposit:=public.create_estimate_deposit(estimate_id,30,null);
 update public.invoices set status='sent' where id=deposit and business_id=b;
 perform public.record_manual_payment(b,deposit,gen_random_uuid(),30,'cash','QA synthetic receipt; rollback only');
 data:=public.get_document_change_context('estimate',estimate_id);
 data:=public.create_document_change_order('estimate',estimate_id,gen_random_uuid(),jsonb_build_object('title','QA approved additional work','description','Synthetic additional work','reason','Rollback test','schedule_impact_days',0,'schedule_note','','expected_current_total',coalesce((data->>'current_total')::numeric,(data->>'total')::numeric),'items',jsonb_build_array(jsonb_build_object('description','Synthetic approved addition','quantity',1,'unit_price',20,'tax_rate',0))));
 change_id:=(data->>'id')::uuid;
 update public.change_orders set status='approved' where id=change_id and business_id=b;
 perform public.manage_job_visit(b,job,'save',jsonb_build_object('id',visit1,'version',0,'title','QA first stage','starts_at',start1,'ends_at',start1+interval '1 hour','workers',array[worker1]));
 perform public.manage_job_visit(b,job,'save',jsonb_build_object('id',visit2,'version',0,'title','QA second stage','starts_at',start1+interval '1 day','ends_at',start1+interval '1 day 1 hour','workers',array[worker2]));
 perform public.manage_job_visit(b,job,'save',jsonb_build_object('id',visit3,'version',0,'title','QA future third stage','starts_at',future3,'ends_at',future3+interval '1 hour','workers',array[worker1]));
 -- Repeating a save cannot create a fourth appointment.
 perform public.manage_job_visit(b,job,'save',jsonb_build_object('id',visit3,'version',0,'title','QA future third stage','starts_at',future3,'ends_at',future3+interval '1 hour','workers',array[worker1]));
 if (select count(*) from public.appointments where business_id=b and job_id=job)<>3 then raise exception 'Visit replay created duplicates';end if;
 if (select count(*) from public.calendar_work where business_id=b and job_id=job)<>3 then raise exception 'Calendar projection duplicated or omitted visits';end if;
 blocked:=false;begin perform public.manage_job_visit(b,job,'save',jsonb_build_object('id',gen_random_uuid(),'version',0,'title','QA overlapping visit','starts_at',future3,'ends_at',future3+interval '1 hour','workers',array[worker1]));exception when exclusion_violation then blocked:=true;end;
 if not blocked then raise exception 'Overlapping visit was allowed';end if;
 perform public.manage_job_workspace(b,job,'add_task',jsonb_build_object('id',task,'title','QA inspect fitting','worker_id',worker1,'visit_id',visit1));
 insert into public.jobs(id,business_id,customer_id,title) values(unassigned_job,b,customer,'QA unassigned job');
 perform public.set_field_account(b,field_user,worker1,0);
 perform set_config('request.jwt.claim.sub',field_user::text,true);
 data:=public.get_field_access_context(b);
 if data->>'restricted'<>'true' or data->>'active'<>'true' then raise exception 'Field identity mapping is not active';end if;
 if (select count(*) from public.business_members where business_id=b and user_id=field_user)<>1 or (select count(*) from public.businesses where id=b)<>1 then raise exception 'Field account cannot load its own sign-in business context';end if;
 if exists(select 1 from public.jobs where business_id=b and id=job) or exists(select 1 from public.customers where business_id=b and id=customer) then raise exception 'Restricted field account exposed general tables';end if;
 data:=public.get_field_jobs(b,job);
 if jsonb_array_length(data)<>1 or jsonb_array_length(data->0->'visits')<>2 or data::text like '%hourly_cost%' then raise exception 'Assigned field response was not scoped or hid the wrong fields';end if;
 blocked:=false;begin perform public.get_field_jobs(b,unassigned_job);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Field account accessed an unrelated job';end if;
 blocked:=false;begin perform public.get_job_workspace(b,job);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Field account accessed office costing';end if;
 perform public.manage_field_job(b,job,'task',jsonb_build_object('id',task,'version',1,'completed',true));
 perform public.manage_field_job(b,job,'start_visit',jsonb_build_object('id',visit1,'version',1));
 data:=public.get_field_jobs(b,job);select (x->>'version')::integer into version from jsonb_array_elements(data->0->'visits') x where x->>'id'=visit1::text;
 perform public.manage_field_job(b,job,'finish_visit',jsonb_build_object('id',visit1,'version',version));
 data:=jsonb_build_object('id',time_request,'worked_on',today,'minutes',90,'note','QA synthetic field time','visit_id',visit1);
 perform public.manage_field_job(b,job,'time',data);perform public.manage_field_job(b,job,'time',data);
 if public.prepare_field_photo(b,job,photo,'QA synthetic incomplete photo.jpg',1000) is distinct from b::text||'/'||photo::text||'.jpg' then raise exception 'Photo destination did not match assigned job metadata';end if;
 if (select count(*) from public.record_photos where id=photo and business_id=b)<>1 then raise exception 'Assigned photo metadata is not readable';end if;
 perform set_config('request.jwt.claim.sub',office::text,true);
 perform public.set_field_account(b,field_user,null,1);
 perform set_config('request.jwt.claim.sub',field_user::text,true);
 if public.get_field_access_context(b)->>'restricted'<>'true' or public.get_field_access_context(b)->>'active'<>'false' then raise exception 'Pausing field access removed its restriction';end if;
 blocked:=false;begin perform public.get_field_jobs(b,job);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Paused field account retained assigned-job access';end if;
 perform set_config('request.jwt.claim.sub',office::text,true);
 perform public.set_field_account(b,field_user,worker1,2);
 data:=public.get_job_cost_review(b,job);
 if jsonb_array_length(data->'pending_time')<>1 then raise exception 'Time replay created duplicate submissions';end if;
 data:=jsonb_build_object('id',time_request,'version',1,'hourly_cost',40);
 perform public.manage_job_cost_review(b,job,'approve_time',data);perform public.manage_job_cost_review(b,job,'approve_time',data);
 data:=public.get_job_workspace(b,job);
 if jsonb_array_length(data->'time')<>1 or (data->'time'->0->>'hourly_cost')::numeric<>40 then raise exception 'Reviewed labor did not post exactly once';end if;
 insert into public.bookkeeping_entries(id,business_id,entry_date,direction,amount,currency,category,description,job_id) values(expense,b,today,'expense',15,'USD','Materials','QA synthetic materials',job);
 perform public.manage_job_cost_review(b,job,'exclude_expense',jsonb_build_object('id',expense,'reason','QA duplicate-cost review'));
 if (public.get_job_workspace(b,job)->>'recorded_expenses')::numeric<>0 then raise exception 'Cost exclusion did not update costing';end if;
 perform public.manage_job_cost_review(b,job,'include_expense',jsonb_build_object('id',expense));
 if (public.get_job_workspace(b,job)->>'recorded_expenses')::numeric<>15 then raise exception 'Restoring cost changed its accounting allocation';end if;
 execute 'reset role';
 blocked:=false;begin perform public.complete_job_workflow(job,office,false);exception when check_violation then blocked:=true;end;
 if not blocked then raise exception 'Whole job completion silently finished remaining visits';end if;
 execute 'set local role authenticated';
 perform public.manage_job_visit(b,job,'save',jsonb_build_object('id',visit3,'version',1,'title','QA rescheduled third stage','starts_at',start1+interval '2 days','ends_at',start1+interval '2 days 1 hour','workers',array[worker1]));
 -- The calendar must close just the second visit on this multi-visit job.
 data:=public.update_appointment_workflow(visit2,'completed');if data->>'visit_only'<>'true' then raise exception 'Calendar completed the whole multi-visit job';end if;
 select visit_version into version from public.appointments where id=visit3;
 perform public.manage_job_visit(b,job,'finish',jsonb_build_object('id',visit3,'version',version));
 execute 'reset role';
 data:=public.complete_job_workflow(job,office,false);
 if (data->>'invoice_ready')::boolean is not true then raise exception 'Final invoice was not prepared: %',data->>'needs_review';end if;
 invoice_id:=(data->>'invoice_id')::uuid;
 invoice_retry:=(public.complete_job_workflow(job,office,true)->>'invoice_id')::uuid;
 if invoice_retry is distinct from invoice_id or (select count(*) from public.invoices where business_id=b and public.invoices.estimate_id=job_execution_check.estimate_id)<>1 then raise exception 'Final invoice retry created a duplicate';end if;
 select total,balance_due into cost,balance from public.invoices where id=invoice_id;
 if cost<>95 or balance<>95 then raise exception 'Approved scope/deposit balance mismatch: %, %',cost,balance;end if;
 execute 'set local role authenticated';
 payload:=jsonb_build_object('summary','QA synthetic completion report; rollback only','photos','[]'::jsonb,'customer_present',true,'signer','QA Synthetic Customer','consent','I acknowledge the work described in this completion report.');
 data:=public.create_job_report(b,job,report,payload);second:=public.create_job_report(b,job,report,payload);
 if data is distinct from second or jsonb_array_length(data->'snapshot'->'visits')<>3 or data->'snapshot'->'signoff'->>'method'<>'Typed in person' then raise exception 'Completion report snapshot/retry failed';end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 blocked:=false;begin perform public.get_job_management(b,job);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Unknown identity accessed job management';end if;
 execute 'reset role';
end $$;
rollback;
select jsonb_build_object('rolled_back',true,'approval_single_job',true,'visits_and_calendar',true,'field_rls_and_permissions',true,'photo_metadata',true,'field_pause',true,'reviewed_time_replay',true,'cost_exclusion',true,'deposit_and_approved_change_balance',true,'invoice_retry',true,'completion_report_replay',true,'unknown_user_denied',true) as execution_verification;
