-- Staging only. Replay confirmation after lost responses; current role is rechecked.
create or replace function private.finviant_ai_decision(p_action_id uuid,p_decision text)
returns void language plpgsql security definer set search_path=''
as $$
declare a public.ai_actions%rowtype; r text;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if p_action_id is null or p_decision is null or p_decision not in ('confirmed','rejected') then
    raise exception 'Invalid decision' using errcode='22023'; end if;
  select * into a from public.ai_actions where id=p_action_id and user_id=auth.uid() for update;
  if not found then raise exception 'Action not found' using errcode='P0002'; end if;
  select bm.role into r from public.business_members bm where bm.business_id=a.business_id and bm.user_id=auth.uid() for share;
  if r is null or not private.velnu_has_accepted_terms() then raise exception 'Business access denied' using errcode='42501'; end if;
  if a.intent in ('create_invoice','create_estimate','record_payment','create_change_order') then
    if r not in ('owner','admin','office') then raise exception 'Finance role required' using errcode='42501'; end if;
  elsif a.intent in ('create_customer','create_job','schedule_job') then
    if r not in ('owner','admin','office','technician') then raise exception 'Write permission required' using errcode='42501'; end if;
  else raise exception 'Unsupported action' using errcode='22023'; end if;
  if p_decision='confirmed' and (a.requires_confirmation is distinct from true or nullif(btrim(a.parsed_payload->>'clarification_question'),'') is not null) then
    raise exception 'Clarify the request before confirming' using errcode='23514'; end if;
  if p_decision='confirmed' and a.status in ('confirmed','executed') and a.confirmed_at is not null then return; end if;
  if p_decision='rejected' and a.status='rejected' then return; end if;
  if a.status<>'proposed' and not (p_decision='rejected' and a.status='confirmed') then raise exception 'This action cannot accept that decision' using errcode='23514'; end if;
  update public.ai_actions set status=p_decision, confirmed_at=case when p_decision='confirmed' then now() else a.confirmed_at end where id=a.id;
end;
$$;
revoke all on function private.finviant_ai_decision(uuid,text) from public,anon;
grant execute on function private.finviant_ai_decision(uuid,text) to authenticated;

-- Invoker triggers retain RLS, including for older clients making direct job updates.
create or replace function private.finviant_sync_job_status()
returns trigger language plpgsql security invoker set search_path=''
as $$
begin
  if new.status in ('completed','canceled') then
    update public.appointments set status=new.status where business_id=new.business_id and job_id=new.id and status in ('scheduled','confirmed','in_progress');
  end if;
  return new;
end;
$$;
revoke all on function private.finviant_sync_job_status() from public,anon,authenticated;
drop trigger if exists finviant_sync_job_status on public.jobs;
create trigger finviant_sync_job_status after update of status on public.jobs for each row execute function private.finviant_sync_job_status();

create or replace function private.finviant_guard_active_appointment()
returns trigger language plpgsql security invoker set search_path=''
as $$
declare parent_status text;
begin
  if new.job_id is not null and new.status in ('scheduled','confirmed','in_progress') then
    select j.status into parent_status from public.jobs j where j.id=new.job_id and j.business_id=new.business_id for share;
    if not found then raise exception 'Job is unavailable' using errcode='23503'; end if;
    if parent_status in ('completed','canceled') then raise exception 'Reopen the job before scheduling another appointment' using errcode='23514'; end if;
  end if;
  return new;
end;
$$;
revoke all on function private.finviant_guard_active_appointment() from public,anon,authenticated;
drop trigger if exists finviant_guard_active_appointment on public.appointments;
create trigger finviant_guard_active_appointment before insert or update of status,job_id,business_id on public.appointments for each row execute function private.finviant_guard_active_appointment();
create index if not exists idx_finviant_appointments_job_business on public.appointments(job_id,business_id);

create or replace function public.set_job_status_atomic(p_job_id uuid,p_status text)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare j public.jobs%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if p_job_id is null or p_status is null or p_status not in ('lead','scheduled','in_progress','completed','canceled') then raise exception 'Invalid job status' using errcode='22023'; end if;
  select * into j from public.jobs where id=p_job_id for update;
  if not found then raise exception 'Job not found or not accessible' using errcode='P0002'; end if;
  if not private.can_write_business(j.business_id) then raise exception 'Write permission required' using errcode='42501'; end if;
  update public.jobs set status=p_status, completed_at=case when p_status='completed' then coalesce(j.completed_at,now()) else null end where id=j.id returning * into j;
  return jsonb_build_object('id',j.id,'status',j.status,'completed_at',j.completed_at);
end;
$$;
revoke all on function public.set_job_status_atomic(uuid,text) from public,anon;
grant execute on function public.set_job_status_atomic(uuid,text) to authenticated;
