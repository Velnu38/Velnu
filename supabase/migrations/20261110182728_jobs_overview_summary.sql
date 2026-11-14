-- Complete server totals and bounded overview cards; no client-wide scan or truncation.
create function public.get_jobs_overview(p_business uuid,p_customer uuid default null,p_worker uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;billing boolean;zone text;day_start timestamptz;day_end timestamptz;
begin
 perform private.require_record_module(p_business,'jobs');
 billing:=coalesce(private.member_module_access(p_business,auth.uid(),'billing'),false) and exists(select 1 from public.business_members where business_id=p_business and user_id=auth.uid() and role in('owner','admin','office'));
 select coalesce(timezone,'America/New_York') into zone from public.businesses where id=p_business;
 day_start:=date_trunc('day',now() at time zone zone) at time zone zone;
 day_end:=(date_trunc('day',now() at time zone zone)+interval '1 day') at time zone zone;
 with base as materialized (
  select j.id,j.status,j.scheduled_start,j.scheduled_end,j.assigned_user_ids,
   lower(concat_ws(' ',j.title,j.status,case j.status when 'lead' then 'Needs scheduling' when 'in_progress' then 'In progress' else j.status end,c.first_name,c.last_name,c.company)) search_text,
   coalesce(a.starts_at=j.scheduled_start and (j.scheduled_end is null or a.ends_at is null or a.ends_at=j.scheduled_end),false) booked,
   case when billing then inv.status end invoice_status
  from public.jobs j left join public.customers c on c.id=j.customer_id and c.business_id=p_business
  left join lateral (select starts_at,ends_at from public.appointments where business_id=p_business and job_id=j.id and status in('scheduled','confirmed','in_progress') order by (status='in_progress') desc,starts_at,id limit 1)a on true
  left join lateral (select status from public.invoices where billing and business_id=p_business and status<>'void' and deposit_estimate_id is null and (job_id=j.id or estimate_id=j.source_estimate_id) order by (job_id=j.id) desc nulls last,created_at desc,id limit 1)inv on true
  where j.business_id=p_business and (p_customer is null or j.customer_id=p_customer) and (p_worker is null or p_worker=any(j.assigned_user_ids))
 ),flags as materialized (
  select *,jsonb_build_object('all',true,'active',status in('lead','scheduled','in_progress'),
   'today',booked and scheduled_start>=day_start and scheduled_start<day_end and status not in('completed','canceled'),
   'unscheduled',status in('lead','scheduled') and not booked,'in_progress',status='in_progress',
   'billing',billing and status='completed' and (invoice_status is null or invoice_status='draft'),
   'attention',status in('scheduled','in_progress') and booked and scheduled_start<=now() and case when scheduled_end is not null then scheduled_end<=now() else scheduled_start<day_start end,
   'unassigned',status in('lead','scheduled','in_progress') and coalesce(cardinality(assigned_user_ids),0)=0,
   'scheduled',status in('lead','scheduled') and booked,'completed',status='completed',
   'history',status in('completed','canceled'),
   'upcoming',status not in('completed','canceled','in_progress') and booked and scheduled_start>=day_end,
   'current',status not in('completed','canceled') and (status='in_progress' or not booked or scheduled_start<day_end)) filters
  from base
 )
 ,focus as materialized (select id, row_number() over(order by (status='in_progress') desc,scheduled_start nulls last,id) priority from flags where (filters->>'active')::boolean order by (status='in_progress') desc,scheduled_start nulls last,id limit 4),
 agenda as materialized (select id,row_number() over(order by scheduled_start,id) priority from flags where booked and (filters->>'active')::boolean and case when exists(select 1 from flags where (filters->>'today')::boolean) then (filters->>'today')::boolean else scheduled_start>=now() end order by scheduled_start,id limit 4),
 selected as (select id from focus union select id from agenda),
 workflows as (select value from jsonb_array_elements(public.get_job_workflow_context(p_business,coalesce((select array_agg(id) from selected),'{}'::uuid[])))),
 hydrated as (select j.id,jsonb_build_object(
  'id',j.id,'title',j.title,'status',j.status,'scheduled_start',j.scheduled_start,'scheduled_end',j.scheduled_end,'assigned_user_ids',j.assigned_user_ids,'customer_id',j.customer_id,'source_estimate_id',j.source_estimate_id,
  'customers',case when c.id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('id',c.id,'first_name',c.first_name,'last_name',c.last_name,'company',c.company)) end,
  'active_appointment',w.value->'active_appointment','invoice',w.value->'invoice') item
  from selected s join public.jobs j on j.id=s.id and j.business_id=p_business
  left join public.customers c on c.id=j.customer_id and c.business_id=p_business
  left join workflows w on w.value->>'job_id'=j.id::text)
 select jsonb_build_object(
  'focus',coalesce((select jsonb_agg(h.item order by f.priority) from focus f join hydrated h using(id)),'[]'::jsonb),
  'agenda',coalesce((select jsonb_agg(h.item order by a.priority) from agenda a join hydrated h using(id)),'[]'::jsonb),
  'counts',(select jsonb_object_agg(key,n) from (select k.key,count(f.id) filter(where (f.filters->>k.key)::boolean) n from unnest(array['all','active','today','unscheduled','in_progress','billing','attention','unassigned','scheduled','completed','current','upcoming','history']) k(key) left join flags f on true group by k.key)x),
  'crew_today',coalesce((select jsonb_object_agg(worker,n) from (select worker,count(distinct id) n from flags cross join lateral unnest(assigned_user_ids) as w(worker) where (filters->>'today')::boolean group by worker)c),'{}'::jsonb),
  'checked_at',now()) into result;
 return result;
end $$;
revoke all on function public.get_jobs_overview(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.get_jobs_overview(uuid,uuid,uuid) to authenticated;
