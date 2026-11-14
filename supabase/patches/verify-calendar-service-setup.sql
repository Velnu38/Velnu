-- Run as postgres after applying calendar_service_setup. All operations roll back.
-- No network request, password, Vault value, or existing record is changed.
begin;

-- PostgreSQL 17 auto-grants role creators ADMIN TRUE but SET FALSE. Permit
-- explicit role switching only for this verification transaction. ROLLBACK
-- restores the original membership, including any existing ADMIN option.
grant calendar_worker to postgres with inherit false, set true;

do $$
declare r record;
begin
  select * into strict r from pg_roles where rolname='calendar_worker';
  if r.rolsuper or r.rolinherit or r.rolcreatedb or r.rolcreaterole
    or r.rolreplication or not r.rolbypassrls then
    raise exception 'Unexpected calendar_worker role attributes';
  end if;
  if has_schema_privilege('calendar_worker','vault','USAGE')
    or has_function_privilege('calendar_worker','private.run_calendar_worker()','EXECUTE') then
    raise exception 'Calendar runtime must not access scheduler credentials';
  end if;
  if not has_function_privilege('calendar_worker','private.effective_plan(uuid)','EXECUTE') then
    raise exception 'Calendar runtime cannot resolve the effective plan';
  end if;
  if exists(select 1 from pg_proc where oid='private.run_calendar_worker()'::regprocedure and prosecdef) then
    raise exception 'Scheduler must remain SECURITY INVOKER';
  end if;
end $$;

set local role calendar_worker;
do $$
declare relation_name text; operation text;
begin
  -- Force view expansion and authorization queries; return no business data.
  perform * from public.calendar_work limit 0;
  perform role,access_modules,private.effective_plan(business_id)
    from public.business_members limit 0;
  perform private.effective_plan(null::uuid);
  perform * from private.calendar_integrations limit 0;
  perform * from private.calendar_oauth_states limit 0 for update;
  perform * from private.calendar_sync_queue limit 0;
  perform * from private.calendar_event_links limit 0;
  update private.calendar_integrations set auto_sync=auto_sync where false;
  insert into private.calendar_sync_queue(integration_id)
    select id from private.calendar_integrations where false;
  delete from private.calendar_sync_queue where false;

  foreach relation_name in array array['invoices','estimates','jobs','business_members','document_schedules'] loop
    foreach operation in array array['INSERT','UPDATE','DELETE'] loop
      if has_table_privilege(current_user,'public.'||relation_name,operation) then
        raise exception 'Unexpected % permission on public.%',operation,relation_name;
      end if;
    end loop;
  end loop;
  begin
    update public.invoices set status=status where false;
    raise exception 'Invoice write unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.estimates where false;
    raise exception 'Estimate deletion unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform total from public.invoices limit 0;
    raise exception 'Invoice amount read unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform decrypted_secret from vault.decrypted_secrets limit 0;
    raise exception 'Vault read unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'calendar setup privileges verified; no HTTP request sent' as result;
rollback;
