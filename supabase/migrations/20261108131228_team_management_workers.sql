-- Internal worker records have no authentication authority. Keep legacy IDs so
CREATE OR REPLACE FUNCTION private.fin_resolve_ref(b uuid, ref text, results jsonb, expected_types text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare kind text;rid uuid;entry jsonb;row_data jsonb;tab text;sch text:='public';pk text:='id';scope_col text:='business_id';
begin
 if ref like '$step:%' then entry:=results->substring(ref from 7)::integer;kind:=entry->>'resource';rid:=nullif(entry->>'id','')::uuid;
 else kind:=split_part(ref,':',1);rid:=nullif(split_part(ref,':',2),'')::uuid;end if;
 if rid is null or kind is null or not(kind=any(expected_types)) or not private.fin_access(b,kind) then raise exception 'Invalid account record reference.' using errcode='42501';end if;
 tab:=case kind when 'business_profile' then 'businesses' when 'document_settings' then 'business_settings' when 'team_members' then 'business_members' when 'workers' then 'worker_profiles' else kind end;
 if kind='business_profile' then scope_col:='id';end if;
 if kind in ('document_settings','scheduling_preferences') then pk:='business_id';end if;
 if kind='team_members' then pk:='user_id';end if;
 if kind in ('workers','scheduling_preferences','worker_time_off','team_invitations') then sch:='private';end if;
 if kind in ('customers','properties','business_profile','document_settings','invoices','estimates','jobs','appointments','reminders','change_orders','bookkeeping_entries','team_members','workers','team_invitations','scheduling_preferences','worker_time_off') then
  execute format('select 1 from %I.%I where %I=$1 and %I=$2 for update',sch,tab,pk,scope_col) using rid,b;
 end if;
 row_data:=(public.fin_lookup_records(b,jsonb_build_object('resource',kind,'id',rid,'order','oldest')))->'rows'->0;
 if row_data is null then raise exception 'Record unavailable in this account.' using errcode='42501';end if;
 return row_data||jsonb_build_object('_resource',kind);
end $function$;

-- existing jobs, appointments, offers and time off retain their assignments.
create table private.worker_profiles (
 business_id uuid not null references public.businesses(id) on delete cascade,
 id uuid not null default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 120),
 trade text not null default '' check(length(trade)<=120), active boolean not null default true,
 is_owner boolean not null default false, use_business_hours boolean not null default true,
 work_days integer[] not null default array[1,2,3,4,5] check(cardinality(work_days) between 1 and 7 and work_days <@ array[1,2,3,4,5,6,7]),
 start_minutes integer not null default 480 check(start_minutes between 0 and 1439),
 end_minutes integer not null default 1020 check(end_minutes between 1 and 1440 and end_minutes>start_minutes),
 updated_at timestamptz not null default clock_timestamp(), primary key(business_id,id)
);
alter table private.worker_profiles enable row level security;
revoke all on private.worker_profiles from public,anon,authenticated;
create index worker_profiles_active on private.worker_profiles(business_id,active);

insert into private.worker_profiles(business_id,id,name,trade,is_owner)
select m.business_id,m.user_id,coalesce(nullif(split_part(u.email,'@',1),''),'Worker'),
 case when private.is_primary_owner(m.business_id,m.user_id) then 'Owner / operator' else 'Worker' end,
 private.is_primary_owner(m.business_id,m.user_id)
from public.business_members m join auth.users u on u.id=m.user_id
where private.is_primary_owner(m.business_id,m.user_id) or (m.role<>'viewer' and private.member_module_access(m.business_id,m.user_id,'jobs') and private.member_module_access(m.business_id,m.user_id,'calendar'));
-- Preserve referenced legacy workers even after account permission changes.
insert into private.worker_profiles(business_id,id,name,active,is_owner)
select distinct x.business_id,x.id,coalesce(nullif(split_part(u.email,'@',1),''),'Previous worker'),false,false
from (select business_id,user_id as id from private.worker_time_off
 union select business_id,assigned_user_id from public.appointments where assigned_user_id is not null
 union select business_id,unnest(assigned_user_ids) from public.jobs
 union select business_id,unnest(assigned_user_ids) from private.scheduling_offers) x
left join auth.users u on u.id=x.id on conflict do nothing;

alter table private.worker_time_off drop constraint if exists worker_time_off_user_id_fkey;
alter table private.worker_time_off drop constraint if exists worker_time_off_business_id_user_id_fkey;
alter table private.worker_time_off add constraint worker_time_off_profile_fkey foreign key(business_id,user_id) references private.worker_profiles(business_id,id);
alter table public.appointments drop constraint if exists appointments_assigned_user_id_fkey;
alter table public.appointments add constraint appointments_worker_profile_fkey foreign key(business_id,assigned_user_id) references private.worker_profiles(business_id,id);

create function private.worker_limit(b uuid) returns integer language sql stable security definer set search_path='' as $$
 select case private.effective_plan(b) when 'pro' then 25 when 'basic' then 5 else 1 end
$$;
create function private.ensure_owner_worker() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if private.is_primary_owner(new.business_id,new.user_id) then
 insert into private.worker_profiles(business_id,id,name,trade,is_owner)
 values(new.business_id,new.user_id,coalesce((select nullif(split_part(email,'@',1),'') from auth.users where id=new.user_id),'Owner'),'Owner / operator',true)
 on conflict do nothing;end if;return new;
end $$;
create trigger worker_owner_profile after insert on public.business_members for each row execute function private.ensure_owner_worker();

create function private.worker_roster(b uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.can_manage_schedule(b) then raise exception 'Worker management access is required.' using errcode='42501';end if;
 return jsonb_build_object('plan',private.effective_plan(b),'worker_limit',private.worker_limit(b),
 'active_count',(select count(*) from private.worker_profiles where business_id=b and active),
 'workers',coalesce((select jsonb_agg(to_jsonb(w)-'business_id' order by lower(w.name),w.id) from private.worker_profiles w where business_id=b),'[]'::jsonb));
end $$;
create function public.get_worker_roster(p_business uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.worker_roster(p_business)$$;

create function private.save_worker_profile(b uuid,worker uuid,input jsonb,expected timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare old_worker private.worker_profiles%rowtype; will_active boolean; own boolean; days integer[]; start_m integer; end_m integer; business_hours boolean;
begin
 if auth.uid() is null or not private.can_manage_schedule(b) then raise exception 'Worker management access is required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
 if worker is null or jsonb_typeof(input) is distinct from 'object' then raise exception 'Check worker details.' using errcode='22023';end if;
 select * into old_worker from private.worker_profiles where business_id=b and id=worker for update;
 if old_worker.id is not null and old_worker.updated_at is distinct from expected then raise exception 'This worker changed. Reload Team Management before saving.' using errcode='40001';end if;
 if old_worker.id is null and expected is not null then raise exception 'Worker not found.' using errcode='23503';end if;
 own:=coalesce(old_worker.is_owner,false);will_active:=coalesce((input->>'active')::boolean,true);
 if private.effective_plan(b)='free' and (not own or not will_active) then raise exception 'Free includes the owner worker only. Individual includes five active workers.' using errcode='42501';end if;
 if will_active and (old_worker.id is null or not old_worker.active) and (select count(*) from private.worker_profiles where business_id=b and active)>=private.worker_limit(b) then
 raise exception 'Your active worker limit is reached. Make an unused worker inactive or change plans.' using errcode='23514';end if;
 if old_worker.active and not will_active and (
 exists(select 1 from public.jobs where business_id=b and worker=any(assigned_user_ids) and status in('lead','scheduled','in_progress')) or
 exists(select 1 from public.appointments where business_id=b and assigned_user_id=worker and status in('scheduled','confirmed','in_progress') and coalesce(ends_at,starts_at)>now()) or
 exists(select 1 from private.scheduling_offers where business_id=b and worker=any(assigned_user_ids) and status='approved' and expires_at>now())) then
 raise exception 'Reassign open jobs and revoke pending booking invitations before making this worker inactive.' using errcode='23514';end if;
 select array_agg(value::integer) into days from jsonb_array_elements_text(coalesce(input->'work_days','[1,2,3,4,5]'::jsonb));
 start_m:=coalesce((input->>'start_minutes')::integer,480);end_m:=coalesce((input->>'end_minutes')::integer,1020);
 business_hours:=coalesce((input->>'use_business_hours')::boolean,true);
 insert into private.worker_profiles(business_id,id,name,trade,active,is_owner,use_business_hours,work_days,start_minutes,end_minutes)
 values(b,worker,btrim(input->>'name'),coalesce(btrim(input->>'trade'),''),will_active,own,business_hours,days,start_m,end_m)
 on conflict(business_id,id) do update set name=excluded.name,trade=excluded.trade,active=excluded.active,use_business_hours=excluded.use_business_hours,
 work_days=excluded.work_days,start_minutes=excluded.start_minutes,end_minutes=excluded.end_minutes,updated_at=clock_timestamp();
end $$;
create function public.save_worker_profile(p_business uuid,p_id uuid,p_input jsonb,p_expected timestamptz default null) returns void
language sql security invoker set search_path='' as $$select private.save_worker_profile(p_business,p_id,p_input,p_expected)$$;

create or replace function private.validate_scheduling_workers(b uuid,workers uuid[]) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if workers is null or cardinality(workers) not between 1 and private.worker_limit(b) or array_position(workers,null) is not null
 or cardinality(workers)<>(select count(distinct x) from unnest(workers) x) then
 raise exception 'Choose different active workers within your plan allowance.' using errcode='22023';end if;
 if exists(select 1 from unnest(workers) x where not exists(select 1 from private.worker_profiles w where w.business_id=b and w.id=x and w.active and (private.effective_plan(b)<>'free' or w.is_owner))) then
 raise exception 'A selected worker is inactive or unavailable on this plan. Refresh the worker list.' using errcode='42501';end if;
end $$;

create or replace function private.schedule_team(b uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.member_module_access(b,auth.uid(),'calendar') or not private.member_module_access(b,auth.uid(),'jobs') then
 raise exception 'Team schedule access is required.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'label',w.name,'role',w.trade,'is_you',w.id=auth.uid(),'active',w.active) order by lower(w.name),w.id)
 from private.worker_profiles w where w.business_id=b),'[]'::jsonb);
end $$;

create or replace function private.manage_worker_time_off(b uuid,worker uuid,s timestamptz,e timestamptz,note text,remove_id uuid default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.can_manage_schedule(b) then raise exception 'Scheduling access is required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
 if remove_id is not null then
 delete from private.worker_time_off t where t.id=remove_id and business_id=b and (private.effective_plan(b)<>'free' or exists(select 1 from private.worker_profiles w where w.business_id=b and w.id=t.user_id and w.is_owner));return;end if;
 perform private.validate_scheduling_workers(b,array[worker]);
 if s is null or e is null or e<=s or e-s>interval '90 days' or length(coalesce(note,''))>200 then raise exception 'Check the time-off dates and note.' using errcode='22023';end if;
 if exists(select 1 from public.jobs where business_id=b and (worker=any(assigned_user_ids) or cardinality(assigned_user_ids)=0) and status in('scheduled','in_progress') and scheduled_start<e and coalesce(scheduled_end,scheduled_start+interval '2 hours')>s)
 or exists(select 1 from public.appointments where business_id=b and (assigned_user_id=worker or assigned_user_id is null) and status in('scheduled','confirmed','in_progress') and starts_at<e and coalesce(ends_at,starts_at+interval '2 hours')>s) then
 raise exception 'This worker already has work during that period. Reassign or reschedule it before blocking time.' using errcode='23P01';end if;
 insert into private.worker_time_off(business_id,user_id,starts_at,ends_at,note) values(b,worker,s,e,coalesce(btrim(note),''));
end $$;

revoke all on function private.worker_limit(uuid),private.ensure_owner_worker(),private.worker_roster(uuid),private.save_worker_profile(uuid,uuid,jsonb,timestamptz),public.get_worker_roster(uuid),public.save_worker_profile(uuid,uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function private.worker_roster(uuid),private.save_worker_profile(uuid,uuid,jsonb,timestamptz),public.get_worker_roster(uuid),public.save_worker_profile(uuid,uuid,jsonb,timestamptz) to authenticated;

CREATE OR REPLACE FUNCTION private.scheduling_context(b uuid, estimate uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e public.estimates%rowtype;result jsonb;
begin
 if not private.can_manage_schedule(b) then raise exception 'Scheduling access is required.' using errcode='42501';end if;
 result:=jsonb_build_object('preferences',to_jsonb(private.schedule_defaults(b)),
 'team',coalesce((select jsonb_agg(w) from jsonb_array_elements(private.schedule_team(b)) w where (w->>'active')::boolean and (private.effective_plan(b)<>'free' or exists(select 1 from private.worker_profiles p where p.business_id=b and p.id=(w->>'id')::uuid and p.is_owner))),'[]'::jsonb),
 'time_off',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'user_id',t.user_id,'starts_at',t.starts_at,'ends_at',t.ends_at,'note',t.note) order by t.starts_at)
 from private.worker_time_off t where t.business_id=b and t.ends_at>now() and t.starts_at<now()+interval '60 days'),'[]'::jsonb));
 if estimate is not null then
 if not private.member_module_access(b,auth.uid(),'billing') then raise exception 'Estimate access is required.' using errcode='42501';end if;
 select * into e from public.estimates where id=estimate and business_id=b;
 if not found or e.status not in('accepted','converted') then raise exception 'Approve the estimate before scheduling.' using errcode='23514';end if;
 result:=result||jsonb_build_object('estimate',jsonb_build_object('id',e.id,'number',e.estimate_number,'customer_id',e.customer_id,'job_id',e.job_id,'property_id',e.property_id,
 'title',coalesce((select left(description,200) from public.estimate_items where estimate_id=e.id order by sort_order,id limit 1),'Service visit'),
 'scope',coalesce((select string_agg(description||' × '||quantity::text,E'\n' order by sort_order,id) from public.estimate_items where estimate_id=e.id),''),
 'customer_name',(select coalesce(nullif(btrim(concat_ws(' ',first_name,last_name)),''),company,'Customer') from public.customers where id=e.customer_id),
 'customer_email',(select email from public.customers where id=e.customer_id)),
 'properties',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'label',p.label,'address',concat_ws(', ',p.address_line1,p.address_line2,p.city,p.state,p.postal_code)))
 from public.properties p where p.business_id=b and p.customer_id=e.customer_id),'[]'::jsonb),
 'offer',(select jsonb_build_object('id',o.id,'status',o.status,'expires_at',o.expires_at,'job_id',o.job_id) from private.scheduling_offers o where o.estimate_id=e.id order by approved_at desc limit 1));
 end if;return result;
end $function$;


CREATE OR REPLACE FUNCTION private.assign_job_crew(job uuid, workers uuid[], expected_start timestamp with time zone, expected_end timestamp with time zone, expected_workers uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j public.jobs;
begin
  j:=private.lock_job_for_scheduling(job);
  if private.effective_plan(j.business_id) not in ('basic','pro') then
    raise exception 'Crew assignment requires Individual or Business Pro.' using errcode='42501';
  end if;
  perform private.validate_scheduling_workers(j.business_id,workers);
  if (j.scheduled_start,j.scheduled_end) is distinct from (expected_start,expected_end) then
    raise exception 'The appointment changed. Reopen the job to review the latest time.' using errcode='40001';
  end if;
  if j.assigned_user_ids @> workers and j.assigned_user_ids <@ workers then return;end if;
  if j.assigned_user_ids is distinct from expected_workers then
    raise exception 'The crew changed. Reopen the job to review the latest assignment.' using errcode='40001';
  end if;
  if j.scheduled_start is not null and j.scheduled_end is null then
    raise exception 'Set the appointment end time before assigning a different crew.' using errcode='23514';
  end if;
  update public.jobs set assigned_user_ids=workers where id=j.id and business_id=j.business_id;
  update public.appointments
    set assigned_user_id=workers[1]
    where job_id=j.id and business_id=j.business_id and status in ('scheduled','confirmed','in_progress')
      and (assigned_user_id is null or not (assigned_user_id=any(workers)));
end $function$;


CREATE OR REPLACE FUNCTION private.save_job_appointment(job uuid, s timestamp with time zone, e timestamp with time zone, expected_start timestamp with time zone, expected_end timestamp with time zone, use_my_schedule boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j public.jobs; workers uuid[]; solo boolean;
begin
  j:=private.lock_job_for_scheduling(job);
  if s is null or e is null or e<=s or e-s>interval '12 hours' then
    raise exception 'Choose a start and end time, up to 12 hours.' using errcode='22023';
  end if;
  if (j.scheduled_start,j.scheduled_end) is not distinct from (s,e) and exists(select 1 from public.appointments where business_id=j.business_id and job_id=j.id and status in('scheduled','confirmed','in_progress') and starts_at is not distinct from s and ends_at is not distinct from e) then return;end if;
  if (j.scheduled_start,j.scheduled_end) is distinct from (expected_start,expected_end) then
    raise exception 'The appointment changed. Reopen the job to review the latest time.' using errcode='40001';
  end if;

  workers:=j.assigned_user_ids;
  solo:=private.effective_plan(j.business_id)='free';
  if solo and cardinality(workers)>0 and workers<>array[auth.uid()] then
    if use_my_schedule is distinct from true then
      raise exception 'Confirm that this appointment can move to your schedule.' using errcode='42501';
    end if;
    workers:=array[auth.uid()];
  elsif cardinality(workers)=0 and exists(select 1 from private.worker_profiles where business_id=j.business_id and id=auth.uid() and active) then
    workers:=array[auth.uid()];
  end if;

  -- The existing job and appointment guards enforce availability and booking allowances.
  update public.jobs set scheduled_start=s,scheduled_end=e,assigned_user_ids=workers,
    status=case when status='in_progress' then status else 'scheduled' end
    where id=j.id and business_id=j.business_id;
  update public.appointments set starts_at=s,ends_at=e,
    assigned_user_id=case when assigned_user_id=any(workers) then assigned_user_id else workers[1] end
    where job_id=j.id and business_id=j.business_id and status in ('scheduled','confirmed','in_progress');
  if not found then
    insert into public.appointments(business_id,customer_id,job_id,title,starts_at,ends_at,status,assigned_user_id)
    values(j.business_id,j.customer_id,j.id,j.title,s,e,'confirmed',workers[1]);
  end if;
end $function$;


CREATE OR REPLACE FUNCTION private.guard_job_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 if auth.uid() is not null and cardinality(new.assigned_user_ids)>0 and not private.can_manage_schedule(new.business_id) then
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
end $function$;


CREATE OR REPLACE FUNCTION private.guard_appointment_crew()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare workers uuid[];
begin
 if new.status not in ('scheduled','confirmed','in_progress') then return new;end if;
 if tg_op='UPDATE' and (new.assigned_user_id,new.starts_at,new.ends_at,new.job_id) is not distinct from(old.assigned_user_id,old.starts_at,old.ends_at,old.job_id)
   and old.status in ('scheduled','confirmed','in_progress') then return new;end if;
 if new.assigned_user_id is not null then
   if auth.uid() is not null and not private.can_manage_schedule(new.business_id) then raise exception 'Dispatch access is required to change assignments.' using errcode='42501';end if;
   perform private.validate_scheduling_workers(new.business_id,array[new.assigned_user_id]);
 end if;
 select assigned_user_ids into workers from public.jobs where id=new.job_id and business_id=new.business_id;
 if coalesce(cardinality(workers),0)=0 and new.assigned_user_id is not null then workers:=array[new.assigned_user_id];end if;
 if coalesce(cardinality(workers),0)=0 then select array_agg(w.id) into workers from private.worker_profiles w where w.business_id=new.business_id and w.active;end if;
 if coalesce(cardinality(workers),0)>0 then
   perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||new.business_id::text,0));
   if not private.scheduling_slot_free(new.business_id,workers,new.starts_at,coalesce(new.ends_at,new.starts_at+make_interval(mins=>(private.schedule_defaults(new.business_id)).duration_minutes)),new.job_id,new.id) then
     raise exception 'The assigned crew is already booked. Choose another time.' using errcode='23P01';end if;
 end if;
 return new;
end $function$;


CREATE OR REPLACE FUNCTION private.scheduling_slot_free(b uuid, workers uuid[], s timestamp with time zone, e timestamp with time zone, exclude_job uuid DEFAULT NULL::uuid, exclude_appointment uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare prefs private.scheduling_preferences%rowtype;pad interval;
begin
 if s is null or e is null or e<=s then return false;end if;
 if exists(select 1 from private.worker_profiles w cross join lateral (select s at time zone coalesce(nullif((select timezone from public.businesses where id=b),''),'America/New_York') ls,e at time zone coalesce(nullif((select timezone from public.businesses where id=b),''),'America/New_York') le) local_time
 where w.business_id=b and w.id=any(workers) and not w.use_business_hours and
 (ls::date<>le::date or extract(isodow from ls)::integer<>all(w.work_days) or extract(hour from ls)*60+extract(minute from ls)<w.start_minutes or extract(hour from le)*60+extract(minute from le)>w.end_minutes)) then return false;end if;
 prefs:=private.schedule_defaults(b);pad:=make_interval(mins=>prefs.buffer_minutes);
 -- Old work without an assignment blocks all crews until the dispatcher assigns it.
 if exists(select 1 from public.jobs j where j.business_id=b and j.id is distinct from exclude_job
 and j.status in('scheduled','in_progress') and j.scheduled_start is not null
 and (cardinality(j.assigned_user_ids)=0 or j.assigned_user_ids && workers)
 and j.scheduled_start<e+pad and coalesce(j.scheduled_end,j.scheduled_start+make_interval(mins=>prefs.duration_minutes))>s-pad) then return false;end if;
 if exists(select 1 from public.appointments a left join public.jobs j on j.id=a.job_id and j.business_id=a.business_id
 where a.business_id=b and (exclude_job is null or a.job_id is distinct from exclude_job) and a.id is distinct from exclude_appointment and a.status in('scheduled','confirmed','in_progress')
 and (a.job_id is null or j.scheduled_start is null)
 and (a.assigned_user_id is null or a.assigned_user_id=any(workers))
 and a.starts_at<e+pad and coalesce(a.ends_at,a.starts_at+make_interval(mins=>prefs.duration_minutes))>s-pad) then return false;end if;
 if exists(select 1 from public.document_schedules d where d.business_id=b and d.status in('planned','scheduled')
 and d.scheduled_start_time<e+pad and d.scheduled_end_time>s-pad) then return false;end if;
 return not exists(select 1 from private.worker_time_off t where t.business_id=b and t.user_id=any(workers)
 and t.starts_at<e and t.ends_at>s);
end $function$;



-- Make the new invoker RPCs visible immediately after the migration.
notify pgrst, 'reload schema';
