-- Fresh Supabase platform prerequisite; not an incremental beta migration.
-- The hosted beta already has pg_cron 1.6.4. The historical scheduler migration
-- references cron.schedule without enabling this platform extension itself.
-- Execute only in a new, empty installation before unchanged app migrations.
create extension if not exists pg_cron;
