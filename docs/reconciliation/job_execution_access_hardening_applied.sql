-- Read-only recovery of already-applied beta migration 20261110003505 (job_execution_access_hardening).
-- Evidence only, outside supabase/migrations. NOT an instruction to apply or replay.
-- Obtained November 9, 2026 (America/New_York). No hosted changes in this review.
-- Keep privileged implementations outside the exposed schema; public RPCs
-- retain their signatures, caller identity and explicit authorization checks.

alter function public.get_field_access_context(uuid) set schema private;
create function public.get_field_access_context(p_business uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select private.get_field_access_context(p_business)$$;
revoke all on function public.get_field_access_context(uuid),private.get_field_access_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_field_access_context(uuid),private.get_field_access_context(uuid) to authenticated;

alter function public.get_field_accounts(uuid) set schema private;
create function public.get_field_accounts(p_business uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select private.get_field_accounts(p_business)$$;
revoke all on function public.get_field_accounts(uuid),private.get_field_accounts(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_field_accounts(uuid),private.get_field_accounts(uuid) to authenticated;

alter function public.set_field_account(uuid,uuid,uuid,integer) set schema private;
create function public.set_field_account(p_business uuid,p_user uuid,p_worker uuid,p_version integer) returns void
language sql volatile security invoker set search_path='' as $$select private.set_field_account(p_business,p_user,p_worker,p_version)$$;
revoke all on function public.set_field_account(uuid,uuid,uuid,integer),private.set_field_account(uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.set_field_account(uuid,uuid,uuid,integer),private.set_field_account(uuid,uuid,uuid,integer) to authenticated;

alter function public.clear_field_account(uuid,uuid,integer) set schema private;
create function public.clear_field_account(p_business uuid,p_user uuid,p_version integer) returns void
language sql volatile security invoker set search_path='' as $$select private.clear_field_account(p_business,p_user,p_version)$$;
revoke all on function public.clear_field_account(uuid,uuid,integer),private.clear_field_account(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.clear_field_account(uuid,uuid,integer),private.clear_field_account(uuid,uuid,integer) to authenticated;

alter function public.get_field_jobs(uuid,uuid,integer) set schema private;
create function public.get_field_jobs(p_business uuid,p_job uuid default null,p_offset integer default 0) returns jsonb
language sql stable security invoker set search_path='' as $$select private.get_field_jobs(p_business,p_job,p_offset)$$;
revoke all on function public.get_field_jobs(uuid,uuid,integer),private.get_field_jobs(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_field_jobs(uuid,uuid,integer),private.get_field_jobs(uuid,uuid,integer) to authenticated;

alter function public.manage_field_job(uuid,uuid,text,jsonb) set schema private;
create function public.manage_field_job(p_business uuid,p_job uuid,p_action text,p_input jsonb) returns void
language sql volatile security invoker set search_path='' as $$select private.manage_field_job(p_business,p_job,p_action,p_input)$$;
revoke all on function public.manage_field_job(uuid,uuid,text,jsonb),private.manage_field_job(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.manage_field_job(uuid,uuid,text,jsonb),private.manage_field_job(uuid,uuid,text,jsonb) to authenticated;

alter function public.prepare_field_photo(uuid,uuid,uuid,text,integer) set schema private;
create function public.prepare_field_photo(p_business uuid,p_job uuid,p_id uuid,p_name text,p_bytes integer) returns text
language sql volatile security invoker set search_path='' as $$select private.prepare_field_photo(p_business,p_job,p_id,p_name,p_bytes)$$;
revoke all on function public.prepare_field_photo(uuid,uuid,uuid,text,integer),private.prepare_field_photo(uuid,uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.prepare_field_photo(uuid,uuid,uuid,text,integer),private.prepare_field_photo(uuid,uuid,uuid,text,integer) to authenticated;

alter function public.get_job_cost_review(uuid,uuid) set schema private;
create function public.get_job_cost_review(p_business uuid,p_job uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select private.get_job_cost_review(p_business,p_job)$$;
revoke all on function public.get_job_cost_review(uuid,uuid),private.get_job_cost_review(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_job_cost_review(uuid,uuid),private.get_job_cost_review(uuid,uuid) to authenticated;

alter function public.manage_job_cost_review(uuid,uuid,text,jsonb) set schema private;
create function public.manage_job_cost_review(p_business uuid,p_job uuid,p_action text,p_input jsonb) returns void
language sql volatile security invoker set search_path='' as $$select private.manage_job_cost_review(p_business,p_job,p_action,p_input)$$;
revoke all on function public.manage_job_cost_review(uuid,uuid,text,jsonb),private.manage_job_cost_review(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.manage_job_cost_review(uuid,uuid,text,jsonb),private.manage_job_cost_review(uuid,uuid,text,jsonb) to authenticated;

alter function public.get_job_reports(uuid,uuid) set schema private;
create function public.get_job_reports(p_business uuid,p_job uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select private.get_job_reports(p_business,p_job)$$;
revoke all on function public.get_job_reports(uuid,uuid),private.get_job_reports(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_job_reports(uuid,uuid),private.get_job_reports(uuid,uuid) to authenticated;

alter function public.create_job_report(uuid,uuid,uuid,jsonb) set schema private;
create function public.create_job_report(p_business uuid,p_job uuid,p_request uuid,p_input jsonb) returns jsonb
language sql volatile security invoker set search_path='' as $$select private.create_job_report(p_business,p_job,p_request,p_input)$$;
revoke all on function public.create_job_report(uuid,uuid,uuid,jsonb),private.create_job_report(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_job_report(uuid,uuid,uuid,jsonb),private.create_job_report(uuid,uuid,uuid,jsonb) to authenticated;

-- Cover the new foreign keys in declared column order and cache auth.uid()
-- once per statement in the new membership/photo policies.
create index field_time_worker on private.field_time_submissions(business_id,worker_id,worked_on);
create index field_time_job_tenant on private.field_time_submissions(job_id,business_id);
create index job_reports_job_tenant on private.job_completion_reports(job_id,business_id);
create index job_cost_exclusions_job_tenant on private.job_cost_exclusions(job_id,business_id);
alter policy field_membership_self on public.business_members using(user_id=(select auth.uid()) and private.field_mode(business_id));
alter policy field_photos_delete on public.record_photos using(created_by=(select auth.uid()) and expense_id is null and private.field_job_access(business_id,job_id));
alter policy field_photo_objects_delete on storage.objects using(bucket_id='finviant-record-photos' and exists(select 1 from public.record_photos p where p.storage_path=name and p.created_by=(select auth.uid()) and p.expense_id is null and private.field_job_access(p.business_id,p.job_id)));
