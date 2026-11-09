-- Bounded dashboard reads. Existing full workspaces remain the editing source of truth.
create function private.get_job_plan_summaries(p_business uuid,p_jobs uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare financial boolean; today date; result jsonb;
begin
 if private.job_workspace_access(p_business) is not true or p_jobs is null or cardinality(p_jobs)>4
 or (select count(*) from public.jobs where business_id=p_business and id=any(p_jobs))<>cardinality(p_jobs)
 then raise exception 'Job overview access required.' using errcode='42501';end if;
 financial:=(private.job_workspace_access(p_business,true) and (select currency from public.businesses where id=p_business)='USD') is true;
 select (now() at time zone coalesce(timezone,'UTC'))::date into today from public.businesses where id=p_business;
 select coalesce(jsonb_agg(jsonb_build_object(
  'job_id',j.id,'tasks_total',(select count(*) from private.job_tasks where business_id=p_business and job_id=j.id),
  'tasks_completed',(select count(*) from private.job_tasks where business_id=p_business and job_id=j.id and completed),
  'due_tasks',(select count(*) from private.job_tasks where business_id=p_business and job_id=j.id and not completed and due_on<=today),
  'financial_access',financial
 )||case when financial then jsonb_build_object(
  'hours',coalesce((select sum(minutes)/60.0 from private.job_time_entries where business_id=p_business and job_id=j.id),0),
  'tracked_cost',round(coalesce((select sum(minutes/60.0*hourly_cost) from private.job_time_entries where business_id=p_business and job_id=j.id),0)+
   coalesce((select sum(amount) from public.bookkeeping_entries e where e.business_id=p_business and direction='expense' and currency='USD' and
    (e.job_id=j.id or e.invoice_id in(select id from public.invoices where business_id=p_business and job_id=j.id) or e.estimate_id in(select id from public.estimates where business_id=p_business and job_id=j.id))),0),2),
  'budget_cost',(select cost from private.job_budgets where business_id=p_business and job_id=j.id)
 ) else '{}'::jsonb end order by array_position(p_jobs,j.id)),'[]'::jsonb) into result
 from public.jobs j where j.business_id=p_business and j.id=any(p_jobs);
 return result;
end $$;
revoke all on function private.get_job_plan_summaries(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function private.get_job_plan_summaries(uuid,uuid[]) to authenticated;
create function public.get_job_plan_summaries(p_business uuid,p_jobs uuid[]) returns jsonb
language sql stable security invoker set search_path='' as $$select private.get_job_plan_summaries(p_business,p_jobs)$$;
revoke all on function public.get_job_plan_summaries(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_job_plan_summaries(uuid,uuid[]) to authenticated;
