-- Read-only, schema-only inventory. Contains no users, customer data or secrets.
-- Capture before provisioning and compare with the new project after schema replay.
select jsonb_build_object(
  'tables', (select jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'name', c.relname, 'rls', c.relrowsecurity,
    'force_rls', c.relforcerowsecurity, 'acl', c.relacl::text,
    'columns', (select jsonb_agg(jsonb_build_object(
      'name', a.attname, 'type', format_type(a.atttypid,a.atttypmod),
      'not_null', a.attnotnull, 'identity', a.attidentity,
      'generated', a.attgenerated, 'default', pg_get_expr(d.adbin,d.adrelid)
    ) order by a.attnum) from pg_attribute a left join pg_attrdef d
      on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
    'constraints', (select jsonb_agg(jsonb_build_object('name', k.conname,
      'definition', pg_get_constraintdef(k.oid)) order by k.conname)
      from pg_constraint k where k.conrelid=c.oid),
    'indexes', (select jsonb_agg(pg_get_indexdef(i.indexrelid) order by ci.relname)
      from pg_index i join pg_class ci on ci.oid=i.indexrelid where i.indrelid=c.oid)
  ) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relkind in ('r','p')),
  'policies', (select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname)
    from pg_policies p where schemaname in ('public','private','storage')),
  'functions', (select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,
    'arguments',pg_get_function_identity_arguments(p.oid),'security_definer',p.prosecdef,
    'acl',p.proacl::text,'definition_md5',md5(pg_get_functiondef(p.oid)))
    order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prokind='f'),
  'triggers', (select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,
    'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid))
    order by n.nspname,c.relname,t.tgname)
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private','auth','storage') and not t.tgisinternal),
  'views', (select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,
    'options',c.reloptions,'acl',c.relacl::text,'definition',pg_get_viewdef(c.oid))
    order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relkind in ('v','m')),
  'schemas', (select jsonb_agg(jsonb_build_object('name',nspname,'acl',nspacl::text) order by nspname)
    from pg_namespace where nspname in ('public','private')),
  'default_privileges', (select jsonb_agg(jsonb_build_object('schema',n.nspname,
    'role',r.rolname,'object_type',d.defaclobjtype,'acl',d.defaclacl::text)
    order by n.nspname,r.rolname,d.defaclobjtype)
    from pg_default_acl d join pg_roles r on r.oid=d.defaclrole
    left join pg_namespace n on n.oid=d.defaclnamespace
    where n.nspname in ('public','private') or d.defaclnamespace=0),
  'buckets', (select jsonb_agg(jsonb_build_object('id',id,'public',public,
    'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types) order by id)
    from storage.buckets),
  'migrations', (select jsonb_agg(jsonb_build_object('version',version,'name',name,
    'sql_md5',md5(array_to_string(statements,E'\n'))) order by version)
    from supabase_migrations.schema_migrations)
) as inventory;
