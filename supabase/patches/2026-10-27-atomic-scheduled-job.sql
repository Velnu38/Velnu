-- Scheduled jobs and their customer appointments commit together, or neither does.
-- A stable per-business request_id makes browser retries safe.
alter table public.jobs add column if not exists request_id uuid;
alter table public.jobs add column if not exists request_fingerprint text;
create unique index if not exists idx_velnu_jobs_scheduled_request
  on public.jobs (business_id, request_id) where request_id is not null;

create or replace function public.create_scheduled_job(
  target_business_id uuid, request_id uuid, payload jsonb
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  existing_row public.jobs%rowtype;
  created_row public.jobs%rowtype;
  customer_uuid uuid;
  property_uuid uuid;
  scheduled_from timestamptz;
  scheduled_until timestamptz;
  job_title text;
  job_description text;
  fingerprint text;
  appointment_uuid uuid;
begin
  if (select auth.uid()) is null or not private.can_write_business(target_business_id) then
    raise exception 'Not authorized to schedule work' using errcode='42501';
  end if;
  if request_id is null or payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Invalid scheduled job request' using errcode='22023';
  end if;

  fingerprint := encode(sha256(convert_to(payload::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'velnu-scheduled-job-' || target_business_id::text || request_id::text, 0
  ));
  select * into existing_row from public.jobs
  where business_id=target_business_id and jobs.request_id=create_scheduled_job.request_id;
  if found then
    if existing_row.request_fingerprint is distinct from fingerprint then
      raise exception 'This scheduling request already saved different content'
        using errcode='23505';
    end if;
    select a.id into appointment_uuid from public.appointments a
      where a.business_id=target_business_id and a.job_id=existing_row.id limit 1;
    if appointment_uuid is null then
      raise exception 'Saved scheduling request has no appointment; contact support'
        using errcode='23514';
    end if;
    return to_jsonb(existing_row) || jsonb_build_object('appointment_id', appointment_uuid);
  end if;

  job_title := btrim(coalesce(payload->>'title', ''));
  if length(job_title) < 1 or length(job_title) > 200 then
    raise exception 'Job title must be 1 to 200 characters' using errcode='23514';
  end if;
  job_description := nullif(btrim(coalesce(payload->>'description', '')), '');
  customer_uuid := nullif(payload->>'customer_id', '')::uuid;
  property_uuid := nullif(payload->>'property_id', '')::uuid;
  scheduled_from := nullif(payload->>'scheduled_start', '')::timestamptz;
  scheduled_until := nullif(payload->>'scheduled_end', '')::timestamptz;
  if customer_uuid is null or not exists (
    select 1 from public.customers c
    where c.id=customer_uuid and c.business_id=target_business_id
  ) then
    raise exception 'Choose a customer belonging to this business' using errcode='23503';
  end if;
  if property_uuid is not null and not exists (
    select 1 from public.properties p
    where p.id=property_uuid and p.customer_id=customer_uuid and p.business_id=target_business_id
  ) then
    raise exception 'Choose a service location belonging to this customer' using errcode='23503';
  end if;
  if scheduled_from is null or
    (scheduled_until is not null and scheduled_until <= scheduled_from) then
    raise exception 'End time must be after the start time' using errcode='23514';
  end if;

  insert into public.jobs (
    business_id, customer_id, property_id, title, description, status,
    scheduled_start, scheduled_end, request_id, request_fingerprint
  ) values (
    target_business_id, customer_uuid, property_uuid, job_title, job_description, 'scheduled',
    scheduled_from, scheduled_until, request_id, fingerprint
  ) returning * into created_row;

  insert into public.appointments (
    business_id, customer_id, job_id, title, starts_at, ends_at, status
  ) values (
    target_business_id, customer_uuid, created_row.id, job_title,
    scheduled_from, scheduled_until, 'scheduled'
  ) returning id into appointment_uuid;

  return to_jsonb(created_row) || jsonb_build_object('appointment_id', appointment_uuid);
end;
$$;

revoke all on function public.create_scheduled_job(uuid,uuid,jsonb) from public,anon;
grant execute on function public.create_scheduled_job(uuid,uuid,jsonb) to authenticated;
