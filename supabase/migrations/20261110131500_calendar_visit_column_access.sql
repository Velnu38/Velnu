-- The invoker calendar view now reads each visit's assigned roster workers.
-- Restore that existing calendar projection without granting the whole table,
-- financial/customer fields, write access, login or scheduler/Vault access.
grant select (visit_worker_ids) on public.appointments to calendar_worker;
