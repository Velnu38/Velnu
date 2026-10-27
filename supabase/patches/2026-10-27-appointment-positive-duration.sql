-- Staging appointment time integrity: preserve nullable ends, reject zero-length visits.
alter table public.appointments
  drop constraint if exists appointments_end_after_start_check;
alter table public.appointments
  add constraint appointments_end_after_start_check
  check (ends_at is null or ends_at > starts_at);
