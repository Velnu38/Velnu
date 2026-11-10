-- Appointments remain the only calendar source; job dates cache the next visit.
alter table public.appointments add constraint appointments_id_business_id_key unique(id,business_id);
alter table public.appointments add column visit_worker_ids uuid[], add column visit_version integer not null default 1;
update public.appointments a set visit_worker_ids=case when cardinality(j.assigned_user_ids)>0 then j.assigned_user_ids when a.assigned_user_id is not null then array[a.assigned_user_id] else '{}'::uuid[] end
from public.jobs j where j.id=a.job_id and j.business_id=a.business_id;
alter table private.job_tasks add column visit_id uuid;
create index job_tasks_visit on private.job_tasks(visit_id,business_id) where visit_id is not null;
alter table private.job_tasks add constraint job_tasks_visit_fk foreign key(visit_id,business_id) references public.appointments(id,business_id);

create or replace function private.scheduling_slot_free(b uuid,workers uuid[],s timestamptz,e timestamptz,exclude_job uuid default null,exclude_appointment uuid default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare prefs private.scheduling_preferences%rowtype;pad interval;
begin
 if s is null or e is null or e<=s then return false;end if;
 if exists(select 1 from private.worker_profiles w cross join lateral(select s at time zone coalesce(nullif((select timezone from public.businesses where id=b),''),'America/New_York') ls,e at time zone coalesce(nullif((select timezone from public.businesses where id=b),''),'America/New_York') le) local_time
 where w.business_id=b and w.id=any(workers) and not w.use_business_hours and (ls::date<>le::date or extract(isodow from ls)::integer<>all(w.work_days) or extract(hour from ls)*60+extract(minute from ls)<w.start_minutes or extract(hour from le)*60+extract(minute from le)>w.end_minutes)) then return false;end if;
 prefs:=private.schedule_defaults(b);pad:=make_interval(mins=>prefs.buffer_minutes);
 if exists(select 1 from public.jobs j where j.business_id=b and j.id is distinct from exclude_job and j.status in('scheduled','in_progress') and j.scheduled_start is not null
 and not exists(select 1 from public.appointments a where a.business_id=b and a.job_id=j.id and a.status in('scheduled','confirmed','in_progress'))
 and (cardinality(j.assigned_user_ids)=0 or j.assigned_user_ids&&workers) and j.scheduled_start<e+pad and coalesce(j.scheduled_end,j.scheduled_start+make_interval(mins=>prefs.duration_minutes))>s-pad) then return false;end if;
 if exists(select 1 from public.appointments a left join public.jobs j on j.id=a.job_id and j.business_id=a.business_id where a.business_id=b and (exclude_job is null or a.job_id is distinct from exclude_job) and a.id is distinct from exclude_appointment and a.status in('scheduled','confirmed','in_progress')
 and (cardinality(coalesce(a.visit_worker_ids,j.assigned_user_ids,'{}'::uuid[]))=0 and a.assigned_user_id is null or coalesce(a.visit_worker_ids,j.assigned_user_ids,array[a.assigned_user_id])&&workers)
 and a.starts_at<e+pad and coalesce(a.ends_at,a.starts_at+make_interval(mins=>prefs.duration_minutes))>s-pad) then return false;end if;
 if exists(select 1 from public.document_schedules d where d.business_id=b and d.status in('planned','scheduled') and d.scheduled_start_time<e+pad and d.scheduled_end_time>s-pad) then return false;end if;
 return not exists(select 1 from private.worker_time_off t where t.business_id=b and t.user_id=any(workers) and t.starts_at<e and t.ends_at>s);
end $$;

create or replace function private.guard_appointment_crew() returns trigger language plpgsql security definer set search_path='' as $$
declare workers uuid[];
begin
 if tg_op='UPDATE' then
  if (new.business_id,new.job_id) is distinct from(old.business_id,old.job_id) and old.job_id is not null then raise exception 'A planned visit cannot move to another job.' using errcode='23514';end if;
  new.visit_version:=old.visit_version+1;
 end if;
 if new.status not in('scheduled','confirmed','in_progress') then return new;end if;
 if tg_op='UPDATE' and (new.assigned_user_id,new.visit_worker_ids,new.starts_at,new.ends_at,new.job_id) is not distinct from(old.assigned_user_id,old.visit_worker_ids,old.starts_at,old.ends_at,old.job_id) and old.status in('scheduled','confirmed','in_progress') then return new;end if;
 workers:=new.visit_worker_ids;
 if workers is null then select assigned_user_ids into workers from public.jobs where id=new.job_id and business_id=new.business_id;end if;
 if coalesce(cardinality(workers),0)=0 and new.assigned_user_id is not null then workers:=array[new.assigned_user_id];end if;
 if new.job_id is not null then new.visit_worker_ids:=coalesce(workers,'{}'::uuid[]);end if;
 if coalesce(cardinality(workers),0)>0 then
  if auth.uid() is not null and not private.can_manage_schedule(new.business_id) then raise exception 'Dispatch access is required to change assignments.' using errcode='42501';end if;
  perform private.validate_scheduling_workers(new.business_id,workers);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||new.business_id::text,0));
 if new.job_id is not null and exists(select 1 from public.appointments a where a.business_id=new.business_id and a.job_id=new.job_id and a.id<>new.id and a.status in('scheduled','confirmed','in_progress') and a.starts_at<new.ends_at and a.ends_at>new.starts_at) then raise exception 'This job already has a visit at that time.' using errcode='23P01';end if;
 if coalesce(cardinality(workers),0)=0 then select array_agg(id) into workers from private.worker_profiles where business_id=new.business_id and active;end if;
 if not private.scheduling_slot_free(new.business_id,coalesce(workers,'{}'::uuid[]),new.starts_at,coalesce(new.ends_at,new.starts_at+make_interval(mins=>(private.schedule_defaults(new.business_id)).duration_minutes)),new.job_id,new.id) then raise exception 'The crew is unavailable at this time. Review bookings, working hours and time off.' using errcode='23P01';end if;
 return new;
end $$;

create function private.sync_job_visit_cache() returns trigger language plpgsql security definer set search_path='' as $$
declare j public.jobs%rowtype;a public.appointments%rowtype;bid uuid;jid uuid;
begin
 bid:=case when tg_op='DELETE' then old.business_id else new.business_id end;jid:=case when tg_op='DELETE' then old.job_id else new.job_id end;
 if jid is null then return null;end if;
 select * into j from public.jobs where id=jid and business_id=bid for update;
 if not found or j.status in('completed','canceled') then return null;end if;
 select * into a from public.appointments where business_id=bid and job_id=jid and status in('scheduled','confirmed','in_progress') order by (status='in_progress') desc,starts_at,id limit 1;
 update public.jobs set scheduled_start=a.starts_at,scheduled_end=a.ends_at,assigned_user_ids=case when a.id is null then '{}'::uuid[] else coalesce(a.visit_worker_ids,case when a.assigned_user_id is not null then array[a.assigned_user_id] end,j.assigned_user_ids) end,
 status=case when j.status='in_progress' or a.status='in_progress' or exists(select 1 from public.appointments where business_id=bid and job_id=jid and status='completed') then 'in_progress' when a.id is not null then 'scheduled' else 'lead' end
 where business_id=bid and id=jid;
 return null;
end $$;
create trigger z_sync_job_visit_cache after insert or update or delete on public.appointments for each row execute function private.sync_job_visit_cache();
revoke all on function private.sync_job_visit_cache() from public,anon,authenticated,service_role;

create function private.guard_visit_task() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.visit_id is not null and not exists(select 1 from public.appointments where id=new.visit_id and business_id=new.business_id and job_id=new.job_id) then raise exception 'Choose a visit belonging to this job.' using errcode='23514';end if;return new;
end $$;
create trigger job_task_visit_guard before insert or update of visit_id,job_id,business_id on private.job_tasks for each row execute function private.guard_visit_task();
revoke all on function private.guard_visit_task() from public,anon,authenticated,service_role;

create function private.manage_job_visit(p_business uuid,p_job uuid,p_action text,p_input jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare j public.jobs%rowtype;a public.appointments%rowtype;v uuid;workers uuid[];s timestamptz;e timestamptz;
begin
 j:=private.lock_job_for_scheduling(p_job);
 if j.business_id<>p_business then raise exception 'Job unavailable.' using errcode='42501';end if;
 v:=(p_input->>'id')::uuid;
 if v is null then raise exception 'A visit request is required.' using errcode='22023';end if;
 select * into a from public.appointments where id=v for update;
 if found and (a.business_id<>p_business or a.job_id<>p_job) then raise exception 'Visit unavailable.' using errcode='42501';end if;
 if p_action='save' then
  s:=(p_input->>'starts_at')::timestamptz;e:=(p_input->>'ends_at')::timestamptz;
  workers:=array(select jsonb_array_elements_text(p_input->'workers'))::uuid[];
  if s is null or e is null or e<=s or e-s>interval '12 hours' then raise exception 'Choose a start and end time, up to 12 hours.' using errcode='22023';end if;
  perform private.validate_scheduling_workers(p_business,workers);
  if a.id is not null and a.starts_at=s and a.ends_at=e and a.visit_worker_ids=workers and a.title=btrim(p_input->>'title') and a.status in('scheduled','confirmed','in_progress') then return v;end if;
  if coalesce(a.visit_version,0) is distinct from (p_input->>'version')::integer then raise exception 'This visit changed. Refresh before editing.' using errcode='40001';end if;
  if a.id is not null and a.status in('completed','canceled','no_show') then raise exception 'Add a new visit instead of changing visit history.' using errcode='23514';end if;
  if a.id is null and (select count(*) from public.appointments where business_id=p_business and job_id=p_job)>=100 then raise exception 'A job supports 100 visits.' using errcode='23514';end if;
  if length(btrim(coalesce(p_input->>'title',''))) not between 1 and 160 then raise exception 'Enter a visit title, up to 160 characters.' using errcode='22023';end if;
  insert into public.appointments(id,business_id,customer_id,job_id,title,starts_at,ends_at,status,assigned_user_id,visit_worker_ids)
  values(v,p_business,j.customer_id,p_job,btrim(p_input->>'title'),s,e,'confirmed',workers[1],workers)
  on conflict(id) do update set title=excluded.title,starts_at=excluded.starts_at,ends_at=excluded.ends_at,assigned_user_id=excluded.assigned_user_id,visit_worker_ids=excluded.visit_worker_ids;
 elsif p_action in('start','finish','cancel') then
  if a.id is null then raise exception 'Visit unavailable.' using errcode='42501';end if;
  if a.status=(case p_action when 'start' then 'in_progress' when 'finish' then 'completed' else 'canceled' end) then return v;end if;
  if a.visit_version is distinct from(p_input->>'version')::integer then raise exception 'This visit changed. Refresh before editing.' using errcode='40001';end if;
  if a.status not in('scheduled','confirmed','in_progress') then raise exception 'Visit is already closed.' using errcode='23514';end if;
  if p_action<>'cancel' and a.starts_at>now() then raise exception 'A future visit cannot be started or finished.' using errcode='23514';end if;
  update public.appointments set status=case p_action when 'start' then 'in_progress' when 'finish' then 'completed' else 'canceled' end where id=v;
 else raise exception 'Unknown visit action.' using errcode='22023';end if;
 insert into private.job_activity(business_id,job_id,actor_id,event) values(p_business,p_job,auth.uid(),case p_action when 'save' then 'Visit planned: ' when 'start' then 'Visit started: ' when 'finish' then 'Visit finished: ' else 'Visit canceled: ' end||coalesce(p_input->>'title',a.title));
 insert into public.business_activity(business_id) values(p_business) on conflict(business_id) do update set version=public.business_activity.version+1,updated_at=now();
 return v;
end $$;
create function public.manage_job_visit(p_business uuid,p_job uuid,p_action text,p_input jsonb) returns uuid language sql security invoker set search_path='' as $$select private.manage_job_visit(p_business,p_job,p_action,p_input)$$;
revoke all on function private.manage_job_visit(uuid,uuid,text,jsonb),public.manage_job_visit(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.manage_job_visit(uuid,uuid,text,jsonb),public.manage_job_visit(uuid,uuid,text,jsonb) to authenticated;

create or replace function private.assign_job_crew(job uuid,workers uuid[],expected_start timestamptz,expected_end timestamptz,expected_workers uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare j public.jobs%rowtype;a public.appointments%rowtype;
begin
 j:=private.lock_job_for_scheduling(job);if private.effective_plan(j.business_id) not in('basic','pro') then raise exception 'Crew assignment requires Individual or Business Pro.' using errcode='42501';end if;perform private.validate_scheduling_workers(j.business_id,workers);
 if (j.scheduled_start,j.scheduled_end) is distinct from(expected_start,expected_end) or j.assigned_user_ids is distinct from expected_workers then raise exception 'The appointment or crew changed. Refresh before editing.' using errcode='40001';end if;
 select * into a from public.appointments where business_id=j.business_id and job_id=j.id and status in('scheduled','confirmed','in_progress') and starts_at=j.scheduled_start and ends_at=j.scheduled_end order by id limit 1 for update;
 if a.id is not null then update public.appointments set visit_worker_ids=workers,assigned_user_id=workers[1] where id=a.id;
 else update public.jobs set assigned_user_ids=workers where id=j.id;end if;
end $$;
create or replace function private.save_job_appointment(job uuid,s timestamptz,e timestamptz,expected_start timestamptz,expected_end timestamptz,use_my_schedule boolean) returns void language plpgsql security definer set search_path='' as $$
declare j public.jobs%rowtype;a public.appointments%rowtype;workers uuid[];
begin
 j:=private.lock_job_for_scheduling(job);
 workers:=j.assigned_user_ids;
 if private.effective_plan(j.business_id)='free' and cardinality(workers)>0 and workers<>array[auth.uid()] then
  if use_my_schedule is distinct from true then raise exception 'Confirm that this appointment can move to your schedule.' using errcode='42501';end if;workers:=array[auth.uid()];
 elsif cardinality(workers)=0 and exists(select 1 from private.worker_profiles where business_id=j.business_id and id=auth.uid() and active) then workers:=array[auth.uid()];end if;
 if (j.scheduled_start,j.scheduled_end) is not distinct from(s,e) and exists(select 1 from public.appointments where business_id=j.business_id and job_id=j.id and status in('scheduled','confirmed','in_progress') and starts_at=s and ends_at=e) then return;end if;
 if (j.scheduled_start,j.scheduled_end) is distinct from(expected_start,expected_end) then raise exception 'The appointment changed. Refresh before editing.' using errcode='40001';end if;
 select * into a from public.appointments where business_id=j.business_id and job_id=j.id and status in('scheduled','confirmed','in_progress') and starts_at=j.scheduled_start and ends_at=j.scheduled_end order by id limit 1 for update;
 perform private.manage_job_visit(j.business_id,j.id,'save',jsonb_build_object('id',coalesce(a.id,gen_random_uuid()),'version',coalesce(a.visit_version,0),'title',coalesce(a.title,j.title),'starts_at',s,'ends_at',e,'workers',workers));
end $$;
create or replace function private.finish_job_visit(p_business uuid,p_job uuid,p_appointment uuid) returns void language plpgsql security definer set search_path='' as $$
declare v integer;
begin
 select visit_version into v from public.appointments where business_id=p_business and job_id=p_job and id=p_appointment;
 perform private.manage_job_visit(p_business,p_job,'finish',jsonb_build_object('id',p_appointment,'version',v));
end $$;

-- Completing the job may close its last current visit; it must never finish future visits.
create function private.guard_job_remaining_visits() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='completed' and old.status<>'completed' and (exists(select 1 from public.appointments where business_id=new.business_id and job_id=new.id and status in('scheduled','confirmed','in_progress') and starts_at>now()) or (select count(*) from public.appointments where business_id=new.business_id and job_id=new.id and status in('scheduled','confirmed','in_progress'))>1) then raise exception 'Finish or cancel the remaining visits before completing this job.' using errcode='23514';end if;return new;
end $$;
create trigger a_guard_remaining_visits before update of status on public.jobs for each row execute function private.guard_job_remaining_visits();
revoke all on function private.guard_job_remaining_visits() from public,anon,authenticated,service_role;
create or replace function private.guard_job_schedule() returns trigger language plpgsql security definer set search_path='' as $$
declare changed boolean;checked_workers uuid[];checked_end timestamptz;
begin
 changed:=tg_op='INSERT';
 if tg_op='UPDATE' then
   changed:=(new.assigned_user_ids,new.scheduled_start,new.scheduled_end,new.property_id,new.source_estimate_id,new.customer_id)
     is distinct from(old.assigned_user_ids,old.scheduled_start,old.scheduled_end,old.property_id,old.source_estimate_id,old.customer_id)
     or (old.status not in ('scheduled','in_progress') and new.status in ('scheduled','in_progress'));
   if new.source_estimate_id is distinct from old.source_estimate_id then raise exception 'The approved estimate link cannot change.';end if;
 end if;
 if not changed then return new;end if;
 if new.property_id is not null and not exists(select 1 from public.properties where id=new.property_id and business_id=new.business_id and customer_id=new.customer_id) then
   raise exception 'Choose a service address belonging to this customer.' using errcode='23503';end if;
 if auth.uid() is not null and cardinality(new.assigned_user_ids)>0 and not private.can_manage_schedule(new.business_id) and not (pg_trigger_depth()>1 and (new.scheduled_start is null or exists(select 1 from public.appointments a where a.business_id=new.business_id and a.job_id=new.id and a.starts_at=new.scheduled_start and a.ends_at=new.scheduled_end and a.visit_worker_ids=new.assigned_user_ids and a.status in('scheduled','confirmed','in_progress')))) then
   raise exception 'Only dispatch staff can change worker assignments.' using errcode='42501';end if;
 if cardinality(new.assigned_user_ids)>0 then perform private.validate_scheduling_workers(new.business_id,new.assigned_user_ids);end if;
 if new.status in ('scheduled','in_progress') and new.scheduled_start is not null then
   perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||new.business_id::text,0));
   checked_workers:=new.assigned_user_ids;
   if cardinality(checked_workers)=0 then select array_agg(w.id) into checked_workers from private.worker_profiles w where w.business_id=new.business_id and w.active;end if;
   if new.scheduled_end is null and cardinality(new.assigned_user_ids)>0 then raise exception 'Choose an end time before assigning workers.' using errcode='22023';end if;
   checked_end:=coalesce(new.scheduled_end,new.scheduled_start+make_interval(mins=>(private.schedule_defaults(new.business_id)).duration_minutes));
   if checked_end<=new.scheduled_start or not private.scheduling_slot_free(new.business_id,coalesce(checked_workers,'{}'::uuid[]),new.scheduled_start,checked_end,new.id) then
     raise exception 'A selected worker is already booked. Choose another time.' using errcode='23P01';end if;
 end if;
 if new.source_estimate_id is not null and not exists(select 1 from public.estimates e where e.id=new.source_estimate_id and e.business_id=new.business_id and e.customer_id=new.customer_id and e.status in ('accepted','converted')) then
   raise exception 'An approved estimate for this customer is required.' using errcode='23514';end if;
 return new;
end $$;

create or replace view public.calendar_work with (security_invoker=true) as
select 'appointment:'||a.id as source_key, a.business_id, a.title, ''::text as description,
 a.starts_at,a.ends_at,b.timezone,a.status,a.assigned_user_id,
 case when i.id is not null then 'invoice' when e.id is not null then 'estimate' else 'work' end as document_kind,
 coalesce(i.id,e.id,a.job_id,a.id) as document_id, a.job_id,
 coalesce(a.visit_worker_ids,case when cardinality(j.assigned_user_ids)>0 then j.assigned_user_ids when a.assigned_user_id is not null then array[a.assigned_user_id] else '{}'::uuid[] end) as assigned_user_ids
from public.appointments a join public.businesses b on b.id=a.business_id
left join public.jobs j on j.id=a.job_id and j.business_id=a.business_id
left join lateral (select id from public.invoices where job_id=a.job_id and business_id=a.business_id and status<>'void' order by created_at desc,id limit 1) i on true
left join lateral (select id from public.estimates where job_id=a.job_id and business_id=a.business_id order by created_at desc,id limit 1) e on true
where a.status not in ('canceled','no_show') and (j.id is null or j.status<>'canceled')
union all
select 'job:'||j.id,j.business_id,j.title,''::text,j.scheduled_start,j.scheduled_end,b.timezone,j.status,null::uuid,
 case when i.id is not null then 'invoice' when e.id is not null then 'estimate' else 'work' end,coalesce(i.id,e.id,j.id),j.id,j.assigned_user_ids
from public.jobs j join public.businesses b on b.id=j.business_id
left join lateral (select id from public.invoices where job_id=j.id and business_id=j.business_id and status<>'void' order by created_at desc,id limit 1) i on true
left join lateral (select id from public.estimates where job_id=j.id and business_id=j.business_id order by created_at desc,id limit 1) e on true
where j.scheduled_start is not null and j.status<>'canceled' and not exists(select 1 from public.appointments a where a.job_id=j.id and a.business_id=j.business_id)
union all
select 'document:'||s.id,s.business_id,s.job_title,s.description,s.scheduled_start_time,s.scheduled_end_time,s.timezone,
 case when s.status='scheduled' then 'scheduled' else 'approved' end,null::uuid,
 case when coalesce(s.invoice_id,converted.id) is not null then 'invoice' else 'estimate' end,
 coalesce(s.invoice_id,converted.id,s.estimate_id),null::uuid,'{}'::uuid[]
from public.document_schedules s
left join public.estimates e on e.id=s.estimate_id and e.business_id=s.business_id
left join public.invoices i on i.id=s.invoice_id and i.business_id=s.business_id
left join public.invoices converted on converted.estimate_id=e.id and converted.business_id=s.business_id
where s.status<>'cancelled' and (s.status='scheduled' or e.status in ('accepted','converted'))
 and coalesce(e.status,'') not in ('declined','expired') and coalesce(i.status,converted.status,'')<>'void'
 and coalesce(e.job_id,i.job_id,converted.job_id) is null
 and (s.estimate_id is null or converted.id is null or not exists(select 1 from public.document_schedules other where other.invoice_id=converted.id));

create or replace function public.get_job_workflow_context(p_business uuid,p_jobs uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;billing boolean;
begin
 perform private.require_record_module(p_business,'jobs');
 if p_jobs is null or cardinality(p_jobs)>200 then raise exception 'Choose at most 200 jobs.' using errcode='22023';end if;
 billing:=coalesce(private.member_module_access(p_business,auth.uid(),'billing'),false) and exists(
  select 1 from public.business_members where business_id=p_business and user_id=auth.uid() and role in('owner','admin','office'));
 select coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,
  'active_appointment',(select jsonb_build_object('id',a.id,'status',a.status,'starts_at',a.starts_at,'ends_at',a.ends_at)
   from public.appointments a where a.business_id=p_business and a.job_id=j.id and a.status in('scheduled','confirmed','in_progress') order by (a.status='in_progress') desc,a.starts_at,a.id limit 1),
  'invoice',case when billing then (select jsonb_build_object('id',i.id,'status',i.status,'number',i.invoice_number,'balance_due',i.balance_due)
   from public.invoices i where i.business_id=p_business and i.status<>'void' and i.deposit_estimate_id is null
   and (i.job_id=j.id or i.estimate_id=j.source_estimate_id) order by (i.job_id=j.id) desc nulls last,i.created_at desc,i.id limit 1) end
 ) order by j.id),'[]'::jsonb) into result from public.jobs j where j.business_id=p_business and j.id=any(p_jobs);
 return result;
end $$;

alter function private.get_job_management(uuid,uuid) rename to get_job_management_base;
create function private.get_job_management(p_business uuid,p_job uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d jsonb;
begin
 d:=private.get_job_management_base(p_business,p_job);
 if (d->>'calendar_access')::boolean then d:=d||jsonb_build_object('visits',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'starts_at',starts_at,'ends_at',ends_at,'status',status,'worker_ids',coalesce(visit_worker_ids,'{}'::uuid[]),'version',visit_version) order by starts_at,id) from public.appointments where business_id=p_business and job_id=p_job),'[]'::jsonb));end if;
 return d;
end $$;
revoke all on function private.get_job_management_base(uuid,uuid),private.get_job_management(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.get_job_management(uuid,uuid) to authenticated;
-- SQL wrappers must resolve the new implementation, not the renamed function OID.
create or replace function public.get_job_management(p_business uuid,p_job uuid) returns jsonb language sql security invoker set search_path='' as $$select private.get_job_management(p_business,p_job)$$;
create or replace function private.manage_job_management(p_business uuid,p_job uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.jobs%rowtype;m private.job_materials%rowtype;t private.job_tasks%rowtype;template private.job_task_templates%rowtype;application private.job_template_applications%rowtype;item jsonb;event_text text;new_id uuid;previous integer;
begin
 if not coalesce(private.job_workspace_access(p_business),false) or not coalesce(private.can_write_business(p_business),false) then raise exception 'Job editing access required.' using errcode='42501';end if;
 -- Serialize template limits and checklist application consistently before locking a job.
 perform pg_advisory_xact_lock(hashtextextended('finviant-job-management:'||p_business::text,0));
 select * into j from public.jobs where business_id=p_business and id=p_job for update;
 if not found then raise exception 'Job unavailable.' using errcode='42501';end if;
 if j.status in('completed','canceled') then raise exception 'Reopen this job before changing its work plan.' using errcode='23514';end if;
 if p_action in('save_material','remove_material') then
  new_id:=(p_payload->>'id')::uuid;
  select * into m from private.job_materials where id=new_id for update;
  if found and (m.business_id<>p_business or m.job_id<>p_job) then raise exception 'Material unavailable.' using errcode='42501';end if;
  if p_action='remove_material' then
   if m.id is null or m.version is distinct from (p_payload->>'version')::integer then raise exception 'Materials changed. Refresh before editing.' using errcode='40001';end if;
   delete from private.job_materials where id=new_id;event_text:='Material removed: '||m.name;
  else
   if m.id is not null and m.name=btrim(p_payload->>'name') and m.quantity=(p_payload->>'quantity')::numeric and m.unit=coalesce(p_payload->>'unit','') and m.supplier=coalesce(p_payload->>'supplier','') and m.status=p_payload->>'status' and (not (p_payload?'estimated_cost') or m.estimated_cost is not distinct from nullif(p_payload->>'estimated_cost','')::numeric) then return private.get_job_management(p_business,p_job);end if;
   if coalesce(m.version,0) is distinct from (p_payload->>'version')::integer then raise exception 'Materials changed. Refresh before editing.' using errcode='40001';end if;
   if m.id is null and (select count(*) from private.job_materials where business_id=p_business and job_id=p_job)>=200 then raise exception 'A job supports up to 200 materials.' using errcode='23514';end if;
   if p_payload?'estimated_cost' and not coalesce(private.job_workspace_access(p_business,true),false) then raise exception 'Financial access required for costs.' using errcode='42501';end if;
   insert into private.job_materials(id,business_id,job_id,name,quantity,unit,supplier,status,estimated_cost)
   values(new_id,p_business,p_job,btrim(p_payload->>'name'),(p_payload->>'quantity')::numeric,coalesce(p_payload->>'unit',''),coalesce(p_payload->>'supplier',''),p_payload->>'status',nullif(p_payload->>'estimated_cost','')::numeric)
   on conflict(id) do update set name=excluded.name,quantity=excluded.quantity,unit=excluded.unit,supplier=excluded.supplier,status=excluded.status,estimated_cost=case when p_payload?'estimated_cost' then excluded.estimated_cost else private.job_materials.estimated_cost end,version=private.job_materials.version+1,updated_at=now();
   event_text:='Material '||case when m.id is null then 'added: ' else 'updated: ' end||btrim(p_payload->>'name');
  end if;
 elsif p_action='edit_task' then
  select * into t from private.job_tasks where business_id=p_business and job_id=p_job and id=(p_payload->>'id')::uuid for update;
  if not found or t.version is distinct from (p_payload->>'version')::integer then raise exception 'Checklist changed. Refresh before editing.' using errcode='40001';end if;
  if nullif(p_payload->>'worker_id','') is not null and not exists(select 1 from private.worker_profiles where business_id=p_business and id=(p_payload->>'worker_id')::uuid and active) then raise exception 'Choose an active worker from this business.' using errcode='23514';end if;
  update private.job_tasks set title=btrim(p_payload->>'title'),due_on=nullif(p_payload->>'due_on','')::date,worker_id=nullif(p_payload->>'worker_id','')::uuid,priority=p_payload->>'priority',visit_id=nullif(p_payload->>'visit_id','')::uuid,version=version+1,updated_at=now() where id=t.id;
  event_text:='Checklist item updated: '||btrim(p_payload->>'title');
 elsif p_action='save_template' then
  if not private.has_business_role(p_business,array['owner','admin','office']) then raise exception 'Office access required to manage shared templates.' using errcode='42501';end if;
  new_id:=(p_payload->>'id')::uuid;
  select * into template from private.job_task_templates where id=new_id;
  if found then
   if template.business_id<>p_business or template.name<>btrim(p_payload->>'name') then raise exception 'Template request already used.' using errcode='23505';end if;
   return private.get_job_management(p_business,p_job);
  end if;
  if (select count(*) from private.job_task_templates where business_id=p_business)>=50 then raise exception 'A business supports up to 50 templates.' using errcode='23514';end if;
  insert into private.job_task_templates(id,business_id,name,items)
   select new_id,p_business,btrim(p_payload->>'name'),jsonb_agg(jsonb_build_object('title',title,'priority',priority) order by created_at,id) from private.job_tasks where business_id=p_business and job_id=p_job;
  event_text:='Checklist saved as template';
 elsif p_action='apply_template' then
  select * into template from private.job_task_templates where business_id=p_business and id=(p_payload->>'template_id')::uuid;
  if not found then raise exception 'Template unavailable.' using errcode='42501';end if;
  select * into application from private.job_template_applications where business_id=p_business and request_id=(p_payload->>'request_id')::uuid;
  if found then
   if application.job_id<>p_job or application.template_id<>template.id then raise exception 'Template request already used.' using errcode='23505';end if;
   return private.get_job_management(p_business,p_job);
  end if;
  if (select count(*) from private.job_tasks where business_id=p_business and job_id=p_job)+jsonb_array_length(template.items)>100 then raise exception 'A job supports up to 100 checklist items.' using errcode='23514';end if;
  insert into private.job_template_applications values(p_business,p_job,(p_payload->>'request_id')::uuid,template.id);
  for item in select value from jsonb_array_elements(template.items) loop
   insert into private.job_tasks(business_id,job_id,title,priority) values(p_business,p_job,item->>'title',coalesce(item->>'priority','normal'));
  end loop;
  event_text:='Checklist template applied: '||template.name;
 elsif p_action='remove_template' then
  if not private.has_business_role(p_business,array['owner','admin','office']) then raise exception 'Office access required to manage shared templates.' using errcode='42501';end if;
  delete from private.job_task_templates where business_id=p_business and id=(p_payload->>'id')::uuid;
  if not found then raise exception 'Template unavailable.' using errcode='40001';end if;
  event_text:='Checklist template removed';
 else raise exception 'Unknown management action.' using errcode='22023';end if;
 insert into private.job_activity(business_id,job_id,actor_id,event) values(p_business,p_job,auth.uid(),left(event_text,400));
 insert into public.business_activity(business_id) values(p_business) on conflict(business_id) do update set version=public.business_activity.version+1,updated_at=now();
 return private.get_job_management(p_business,p_job);
end $$;

create or replace function private.manage_job_workspace(p_business uuid,p_job uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.jobs%rowtype; t private.job_tasks%rowtype; changed integer; tid uuid; v integer; entry private.job_time_entries%rowtype; event_text text;
begin
 if not private.job_workspace_access(p_business) or not private.can_write_business(p_business) then raise exception 'Job editing access required.' using errcode='42501';end if;
 select * into j from public.jobs where business_id=p_business and id=p_job for update;
 if not found then raise exception 'Job unavailable.' using errcode='42501';end if;
 if p_action='add_task' then
   if j.status in('completed','canceled') then raise exception 'Reopen the job before adding work.' using errcode='23514';end if;
   tid:=(p_payload->>'id')::uuid;
   select * into t from private.job_tasks where id=tid;
   if found then
     if t.business_id<>p_business or t.job_id<>p_job or t.title is distinct from btrim(p_payload->>'title') or t.due_on is distinct from nullif(p_payload->>'due_on','')::date or t.worker_id is distinct from nullif(p_payload->>'worker_id','')::uuid or t.priority is distinct from coalesce(p_payload->>'priority','normal') or t.visit_id is distinct from nullif(p_payload->>'visit_id','')::uuid then raise exception 'Request already contains different work.' using errcode='23505';end if;
     return public.get_job_workspace(p_business,p_job);
   end if;
   if (select count(*) from private.job_tasks where business_id=p_business and job_id=p_job)>=100 then raise exception 'A job can contain up to 100 checklist items.' using errcode='23514';end if;
   if nullif(p_payload->>'worker_id','') is not null and not exists(select 1 from private.worker_profiles where business_id=p_business and id=(p_payload->>'worker_id')::uuid and active) then raise exception 'Choose an active worker from this business.' using errcode='23514';end if;
   insert into private.job_tasks(id,business_id,job_id,title,due_on,worker_id,priority,visit_id) values(tid,p_business,p_job,btrim(p_payload->>'title'),nullif(p_payload->>'due_on','')::date,nullif(p_payload->>'worker_id','')::uuid,coalesce(p_payload->>'priority','normal'),nullif(p_payload->>'visit_id','')::uuid);
   event_text:='Checklist item added';
 elsif p_action in('complete_task','remove_task') then
   if j.status in('completed','canceled') then raise exception 'Reopen the job before changing its checklist.' using errcode='23514';end if;
   tid:=(p_payload->>'id')::uuid;
   select * into t from private.job_tasks where business_id=p_business and job_id=p_job and id=tid for update;
   if not found or t.version is distinct from (p_payload->>'version')::integer then raise exception 'This checklist changed. Refresh before editing.' using errcode='40001';end if;
   if p_action='remove_task' then delete from private.job_tasks where id=tid;event_text:='Checklist item removed';
   else update private.job_tasks set completed=(p_payload->>'completed')::boolean,version=version+1,updated_at=now() where id=tid;event_text:=case when (p_payload->>'completed')::boolean then 'Checklist item completed' else 'Checklist item reopened' end;end if;
 elsif p_action in('save_budget','add_time','remove_time') then
   if not private.job_workspace_access(p_business,true) then raise exception 'Financial and job access required.' using errcode='42501';end if;
   if p_action='save_budget' then
     select version into v from private.job_budgets where business_id=p_business and job_id=p_job for update;
     if coalesce(v,0) is distinct from (p_payload->>'version')::integer then raise exception 'The budget changed. Refresh before editing.' using errcode='40001';end if;
     insert into private.job_budgets(business_id,job_id,revenue,cost,hours) values(p_business,p_job,(p_payload->>'revenue')::numeric,(p_payload->>'cost')::numeric,(p_payload->>'hours')::numeric)
     on conflict(business_id,job_id) do update set revenue=excluded.revenue,cost=excluded.cost,hours=excluded.hours,version=private.job_budgets.version+1,updated_at=now();
     event_text:='Job budget updated';
   elsif p_action='add_time' then
     select * into entry from private.job_time_entries where business_id=p_business and request_id=(p_payload->>'request_id')::uuid;
     if found then
       if entry.job_id<>p_job or entry.minutes is distinct from (p_payload->>'minutes')::integer or entry.hourly_cost is distinct from (p_payload->>'hourly_cost')::numeric or entry.worked_on is distinct from (p_payload->>'worked_on')::date or entry.worker_id is distinct from nullif(p_payload->>'worker_id','')::uuid or entry.note is distinct from coalesce(p_payload->>'note','') then raise exception 'Time request already saved different content.' using errcode='23505';end if;
       return public.get_job_workspace(p_business,p_job);
     end if;
     if (select count(*) from private.job_time_entries where business_id=p_business and job_id=p_job)>=2000 then raise exception 'This job has reached 2,000 time entries.' using errcode='23514';end if;
     if (p_payload->>'worked_on')::date > (now() at time zone coalesce((select timezone from public.businesses where id=p_business),'America/New_York'))::date then raise exception 'Time must be recorded for today or earlier.' using errcode='23514';end if;
     insert into private.job_time_entries(business_id,job_id,worker_id,worked_on,minutes,hourly_cost,note,created_by,request_id)
     values(p_business,p_job,nullif(p_payload->>'worker_id','')::uuid,(p_payload->>'worked_on')::date,(p_payload->>'minutes')::integer,(p_payload->>'hourly_cost')::numeric,coalesce(p_payload->>'note',''),auth.uid(),(p_payload->>'request_id')::uuid);
     event_text:='Time and labor cost recorded';
   else
     delete from private.job_time_entries where business_id=p_business and job_id=p_job and id=(p_payload->>'id')::uuid;get diagnostics changed=row_count;
     if changed<>1 then raise exception 'Time entry unavailable. Refresh the job.' using errcode='40001';end if;
     event_text:='Time entry removed';
   end if;
 else raise exception 'Unknown job action.' using errcode='23514';end if;
 insert into private.job_activity(business_id,job_id,actor_id,event) values(p_business,p_job,auth.uid(),event_text);
 insert into public.business_activity(business_id) values(p_business) on conflict(business_id) do update set version=public.business_activity.version+1,updated_at=now();
 return public.get_job_workspace(p_business,p_job);
end $$;

-- Visit progress is separate from closing the whole job and its invoice handoff.
create or replace function private.guard_linked_appointment_lifecycle() returns trigger language plpgsql security definer set search_path='' as $$
declare j public.jobs%rowtype;dispatch boolean;
begin
 if old.job_id is not null and (new.job_id,new.business_id) is distinct from(old.job_id,old.business_id) then raise exception 'A job visit keeps its work history. Plan a new visit instead.' using errcode='23514';end if;
 if new.job_id is null or new.status is not distinct from old.status then return new;end if;
 if old.status in('completed','canceled','no_show') and new.status in('scheduled','confirmed','in_progress') then raise exception 'Plan a new visit instead of reopening an old calendar entry.' using errcode='23514';end if;
 select * into j from public.jobs where business_id=new.business_id and id=new.job_id;
 if not found then raise exception 'Linked job unavailable.' using errcode='42501';end if;
 if j.status in('completed','canceled') then
  if new.status not in('completed','canceled') then raise exception 'Reopen the job before planning further work.' using errcode='23514';end if;return new;
 end if;
 dispatch:=coalesce(private.can_manage_schedule(new.business_id),false);
 if not dispatch and not (new.status in('completed','in_progress') and private.field_job_access(new.business_id,new.job_id) and exists(select 1 from private.field_accounts f where f.business_id=new.business_id and f.user_id=auth.uid() and f.worker_id=any(coalesce(new.visit_worker_ids,array[new.assigned_user_id])))) then raise exception 'Assigned field or dispatch access is required to update this visit.' using errcode='42501';end if;
 return new;
end $$;
create or replace function public.update_appointment_workflow(p_appointment uuid,p_status text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.appointments%rowtype;j public.jobs%rowtype;b uuid;result jsonb;
begin
 select business_id into b from public.appointments where id=p_appointment;
 perform private.require_record_module(b,'calendar',true);
 if p_status is null or p_status not in('scheduled','confirmed','in_progress','completed','canceled','no_show') then raise exception 'Invalid appointment status.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
 select * into a from public.appointments where id=p_appointment and business_id=b for update;
 if a.job_id is null then update public.appointments set status=p_status where id=a.id;return jsonb_build_object('appointment_id',a.id,'status',p_status);end if;
 perform private.require_record_module(b,'jobs',true);
 select * into j from public.jobs where id=a.job_id and business_id=b for update;
 if not found then raise exception 'Linked job unavailable.' using errcode='42501';end if;
 if a.status in('completed','canceled','no_show') then
  if p_status=a.status then return jsonb_build_object('appointment_id',a.id,'status',a.status,'job_id',j.id,'already_updated',true,'visit_only',j.status<>'completed');end if;
  raise exception 'Open the job and review a new appointment instead of changing an old calendar entry.' using errcode='23514';end if;
 if (select count(*) from public.appointments where business_id=b and job_id=j.id)>1 then
  if p_status in('completed','in_progress','canceled') then
   perform private.manage_job_visit(b,j.id,case p_status when 'completed' then 'finish' when 'in_progress' then 'start' else 'cancel' end,jsonb_build_object('id',a.id,'version',a.visit_version));
  else update public.appointments set status=p_status where id=a.id;end if;
  return jsonb_build_object('appointment_id',a.id,'status',p_status,'job_id',j.id,'visit_only',true);
 end if;
 if p_status='completed' then
  result:=public.complete_job_workflow(j.id,auth.uid(),false);
 elsif p_status='in_progress' then
  if j.status in('completed','canceled') then raise exception 'Reopen the job before starting it.' using errcode='23514';end if;
  update public.jobs set status='in_progress' where id=j.id;
 elsif p_status='canceled' then
  if j.status='completed' then raise exception 'Reopen the completed job before canceling it.' using errcode='23514';end if;
  update public.jobs set status='canceled' where id=j.id;
 elsif p_status in('scheduled','confirmed') then
  if j.status in('completed','canceled') then raise exception 'Reopen the job before reviewing its schedule.' using errcode='23514';end if;
  if j.status='in_progress' then raise exception 'Use the job details to review work already in progress.' using errcode='23514';end if;
  update public.jobs set status='scheduled' where id=j.id;
 else
  if j.status in('completed','canceled') then raise exception 'This job is closed. Open its history instead.' using errcode='23514';end if;
  -- A no-show closes only this attendance record; the job requires a newly
  -- reviewed appointment and does not count as completed or invoice-ready.
  update public.jobs set status='lead',scheduled_start=null,scheduled_end=null where id=j.id;
 end if;
 update public.appointments set status=p_status where id=a.id;
 return coalesce(result,'{}'::jsonb)||jsonb_build_object('appointment_id',a.id,'status',p_status,'job_id',j.id);
end $$;

