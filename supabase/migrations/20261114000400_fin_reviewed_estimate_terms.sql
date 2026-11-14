-- Extend the existing reviewed Fin document operations. Permissions, version checks
-- and execution approval remain in their original functions; no new executor exists.
do $migration$
declare f record;definition text;updated text;finish_count integer:=0;catalog jsonb;read_fields jsonb;
begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname like 'fin_finish_turn%'
 loop
  definition:=pg_get_functiondef(f.oid);
  updated:=replace(definition,'when ''create_estimate'' then array[''issue_date'',''expires_on'',''notes'',''items'']','when ''create_estimate'' then array[''issue_date'',''expires_on'',''notes'',''items'',''payment_terms_days'']');
  updated:=replace(updated,'when ''update_estimate'' then array[''expires_on'',''notes'',''items'']','when ''update_estimate'' then array[''expires_on'',''notes'',''items'',''payment_terms_days'']');
  if updated<>definition then execute updated;finish_count:=finish_count+1;end if;
 end loop;
 if finish_count=0 then raise exception 'Fin estimate field validator could not be located' using errcode='23514';end if;
 catalog:=private.fin_account_catalog();read_fields:=catalog#>'{resources,estimates,read_fields}';
 if jsonb_typeof(read_fields) is distinct from 'array' then raise exception 'Fin estimate read catalog could not be located' using errcode='23514';end if;
 if not(read_fields?'payment_terms_days') then
  catalog:=jsonb_set(catalog,'{resources,estimates,read_fields}',read_fields||jsonb_build_array('payment_terms_days'));
  -- Preserve every existing resource and writable field; this is read metadata only.
  execute format('create or replace function private.fin_account_catalog() returns jsonb language sql immutable set search_path='''' as %L','select '||quote_literal(catalog::text)||'::jsonb');
 end if;
end $migration$;
