-- Skip durably suppressed occurrences before expensive recipient/consent snapshots.
-- The existing unique occurrence index covers this check. Claim-time revalidation,
-- all queue statuses, batch size, locks, and service-only grants remain unchanged.
create or replace function public.prepare_due_appointment_reminders() returns integer language plpgsql security definer set search_path='' as $$
declare a record;s jsonb;n integer:=0;added integer;
begin
 perform pg_advisory_xact_lock(61109221000::bigint);
 for a in
  select ap.id from public.appointments ap
  where ap.starts_at>now() and ap.starts_at<=now()+interval '720 hours' and ap.status in('scheduled','confirmed')
   and not exists(select 1 from private.appointment_reminder_queue q
    where q.business_id=ap.business_id and q.occurrence_id=coalesce(ap.job_id,ap.id) and q.starts_at=ap.starts_at)
  order by ap.starts_at,ap.id loop
  s:=private.appointment_reminder_snapshot(a.id);if s is null or (s->>'due_at')::timestamptz>now() then continue;end if;
  insert into private.appointment_reminder_queue(business_id,appointment_id,occurrence_id,starts_at,due_at,channel,snapshot)
  values((s->>'business_id')::uuid,(s->>'appointment_id')::uuid,(s->>'occurrence_id')::uuid,(s->>'starts_at')::timestamptz,(s->>'due_at')::timestamptz,s->>'channel',s) on conflict do nothing;
  get diagnostics added=row_count;n:=n+added;if n>=50 then exit;end if;
 end loop;return n;
end $$;
