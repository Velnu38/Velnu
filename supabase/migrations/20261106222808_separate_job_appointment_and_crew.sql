-- Separate customer appointment changes from crew-only changes.
create function private.lock_job_for_scheduling(job uuid) returns public.jobs
language plpgsql security definer set search_path='' as $$
declare b uuid; j public.jobs;
begin
  select business_id into b from public.jobs where id=job;
  if b is null or not private.can_manage_schedule(b) then
    raise exception 'Scheduling access is required.' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
  select * into j from public.jobs where id=job and business_id=b for update;
  if not found or j.status in ('completed','canceled') then
    raise exception 'Reopen this job before changing its schedule or crew.' using errcode='23514';
  end if;
  return j;
end $$;

create function private.assign_job_crew(job uuid,workers uuid[],expected_start timestamptz,expected_end timestamptz,expected_workers uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare j public.jobs;
begin
  j:=private.lock_job_for_scheduling(job);
  if private.effective_plan(j.business_id)<>'pro' then
    raise exception 'Crew assignment requires Business Pro.' using errcode='42501';
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
end $$;

create function private.save_job_appointment(job uuid,s timestamptz,e timestamptz,expected_start timestamptz,expected_end timestamptz,use_my_schedule boolean)
returns void language plpgsql security definer set search_path='' as $$
declare j public.jobs; workers uuid[]; solo boolean;
begin
  j:=private.lock_job_for_scheduling(job);
  if s is null or e is null or e<=s or e-s>interval '12 hours' then
    raise exception 'Choose a start and end time, up to 12 hours.' using errcode='22023';
  end if;
  if (j.scheduled_start,j.scheduled_end) is not distinct from (s,e) then return;end if;
  if (j.scheduled_start,j.scheduled_end) is distinct from (expected_start,expected_end) then
    raise exception 'The appointment changed. Reopen the job to review the latest time.' using errcode='40001';
  end if;

  workers:=j.assigned_user_ids;
  solo:=private.effective_plan(j.business_id)<>'pro';
  if solo and cardinality(workers)>0 and workers<>array[auth.uid()] then
    if use_my_schedule is distinct from true then
      raise exception 'Confirm that this appointment can move to your schedule.' using errcode='42501';
    end if;
    workers:=array[auth.uid()];
  elsif solo and j.scheduled_start is null and cardinality(workers)=0 then
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
end $$;

create function public.assign_job_crew(p_job uuid,p_workers uuid[],p_expected_start timestamptz,p_expected_end timestamptz,p_expected_workers uuid[])
returns void language sql security invoker set search_path='' as $$
  select private.assign_job_crew(p_job,p_workers,p_expected_start,p_expected_end,p_expected_workers)
$$;

create function public.save_job_appointment(p_job uuid,p_start timestamptz,p_end timestamptz,p_expected_start timestamptz,p_expected_end timestamptz,p_use_my_schedule boolean)
returns void language sql security invoker set search_path='' as $$
  select private.save_job_appointment(p_job,p_start,p_end,p_expected_start,p_expected_end,p_use_my_schedule)
$$;

revoke all on function private.lock_job_for_scheduling(uuid) from public,anon,authenticated,service_role;
revoke all on function private.assign_job_crew(uuid,uuid[],timestamptz,timestamptz,uuid[]),
  private.save_job_appointment(uuid,timestamptz,timestamptz,timestamptz,timestamptz,boolean),
  public.assign_job_crew(uuid,uuid[],timestamptz,timestamptz,uuid[]),
  public.save_job_appointment(uuid,timestamptz,timestamptz,timestamptz,timestamptz,boolean)
  from public,anon,authenticated,service_role;
grant execute on function private.assign_job_crew(uuid,uuid[],timestamptz,timestamptz,uuid[]),
  private.save_job_appointment(uuid,timestamptz,timestamptz,timestamptz,timestamptz,boolean),
  public.assign_job_crew(uuid,uuid[],timestamptz,timestamptz,uuid[]),
  public.save_job_appointment(uuid,timestamptz,timestamptz,timestamptz,timestamptz,boolean)
  to authenticated;
