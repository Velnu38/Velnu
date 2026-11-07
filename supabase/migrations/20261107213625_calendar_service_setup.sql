-- Calendar runtime credentials are provisioned separately. This migration creates
-- no password, enables no login, schedules no cron job, and sends no HTTP request.
create role calendar_worker
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication bypassrls;
comment on role calendar_worker is
  'Server-only calendar API/worker. Provision a unique password and LOGIN after setup verification.';

grant connect on database postgres to calendar_worker;
grant usage on schema public, private to calendar_worker;
-- This definer function resolves entitlements internally; do not grant access
-- to its entitlement, test-account, or platform-operator dependencies.
grant execute on function private.effective_plan(uuid) to calendar_worker;
grant select (business_id,user_id,role,access_modules)
  on public.business_members to calendar_worker;
grant select (id,timezone) on public.businesses to calendar_worker;
grant select (assigned_user_id,business_id,ends_at,id,job_id,starts_at,status,title)
  on public.appointments to calendar_worker;
grant select (assigned_user_ids,business_id,id,scheduled_end,scheduled_start,status,title)
  on public.jobs to calendar_worker;
grant select (business_id,created_at,id,job_id,status)
  on public.estimates to calendar_worker;
grant select (business_id,created_at,estimate_id,id,job_id,status)
  on public.invoices to calendar_worker;
grant select (
  business_id,description,estimate_id,id,invoice_id,job_title,
  scheduled_end_time,scheduled_start_time,status,timezone
) on public.document_schedules to calendar_worker;
grant select on public.calendar_work to calendar_worker;
grant select,insert,update on private.calendar_integrations to calendar_worker;
-- UPDATE is also required by SELECT ... FOR UPDATE on the OAuth state table.
grant select,insert,update,delete on
  private.calendar_oauth_states,
  private.calendar_sync_queue,
  private.calendar_event_links
to calendar_worker;

-- Synchronous scheduler transport. pg_net is intentionally not used: its shared
-- request queue exposes decrypted headers to database login roles on Supabase.
create extension if not exists http with schema extensions;

create function private.run_calendar_worker() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  worker_secret text;
  protection_bypass text;
  result extensions.http_response;
  payload jsonb;
begin
  -- Defense in depth if a later migration accidentally expands the EXECUTE ACL.
  if current_user <> 'postgres' then
    raise exception 'calendar_scheduler_access_denied' using errcode='42501';
  end if;
  select decrypted_secret into worker_secret from vault.decrypted_secrets
    where name='finviant_calendar_worker_secret';
  select decrypted_secret into protection_bypass from vault.decrypted_secrets
    where name='finviant_vercel_protection_bypass';
  if nullif(worker_secret,'') is null or nullif(protection_bypass,'') is null
    or position(chr(10) in worker_secret)>0 or position(chr(13) in worker_secret)>0
    or position(chr(10) in protection_bypass)>0 or position(chr(13) in protection_bypass)>0 then
    raise exception 'calendar_scheduler_setup_required' using errcode='55000';
  end if;

  begin
    -- Clear any prior connection-local cURL settings, including proxy/TLS
    -- overrides, then require verified TLS and bounded request/connect time.
    -- CONNECTTIMEOUT_MS is unavailable in Supabase's http 1.6; use seconds.
    if not extensions.http_reset_curlopt()
      or not extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','60000')
      or not extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT','10')
      or not extensions.http_set_curlopt('CURLOPT_SSL_VERIFYPEER','1')
      or not extensions.http_set_curlopt('CURLOPT_SSL_VERIFYHOST','2') then
      raise exception 'calendar_scheduler_transport_setup_failed';
    end if;
    select * into result from extensions.http(row(
      'GET',
      'https://finviant.com/api/calendar-worker',
      array[
        extensions.http_header('Authorization','Bearer '||worker_secret),
        extensions.http_header('x-vercel-protection-bypass',protection_bypass)
      ],
      null,null
    )::extensions.http_request);
    perform extensions.http_reset_curlopt();
  exception when others then
    -- Never rethrow a transport message, request headers, or a response body.
    perform extensions.http_reset_curlopt();
    raise exception 'calendar_scheduler_transport_failed' using errcode='08006';
  end;

  if result.status <> 200 then
    raise exception 'calendar_scheduler_http_%',result.status using errcode='P0001';
  end if;
  begin
    payload:=result.content::jsonb;
  exception when others then
    raise exception 'calendar_scheduler_invalid_response' using errcode='P0001';
  end;
  if coalesce(payload->>'processed','') !~ '^[0-9]{1,9}$' then
    raise exception 'calendar_scheduler_invalid_response' using errcode='P0001';
  end if;
  -- Return only the documented bounded-batch count, never raw response data.
  return jsonb_build_object('processed',(payload->>'processed')::integer);
end $$;
alter function private.run_calendar_worker() owner to postgres;
revoke all on function private.run_calendar_worker()
  from public,anon,authenticated,service_role,calendar_worker;
grant execute on function private.run_calendar_worker() to postgres;
comment on function private.run_calendar_worker() is
  'Owner-only synchronous calendar scheduler; fixed HTTPS target, Vault credentials, verified TLS. Configure secrets and cron separately.';
