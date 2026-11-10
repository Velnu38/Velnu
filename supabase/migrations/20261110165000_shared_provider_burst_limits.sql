-- Shared, bounded bursts supplement (never replace) the existing monthly quotas.
-- Only existing, authorized provider reservation paths can reach these counters.
create table private.provider_burst_buckets (
 resource text not null check(resource in('ai','receipt','upload')),
 scope text not null check(scope in('global','business','actor')),
 subject uuid not null,
 theoretical_at timestamptz not null,
 updated_at timestamptz not null default now(),
 primary key(resource,scope,subject)
);
alter table private.provider_burst_buckets enable row level security;
revoke all on private.provider_burst_buckets from public,anon,authenticated,service_role;
create index provider_burst_buckets_expiry on private.provider_burst_buckets(updated_at);

create function private.reserve_provider_burst(p_resource text,p_business uuid,p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
declare current_time_value timestamptz:=clock_timestamp(); old_time timestamptz; next_time timestamptz;
 limits integer[]; subjects uuid[]; scopes text[]:=array['global','business','actor'];
 i integer; step interval; retry_seconds integer;
begin
 if p_business is null or p_actor is null then raise exception 'Provider access required.' using errcode='42501';end if;
 limits:=case p_resource when 'ai' then array[120,20,12] when 'receipt' then array[60,12,6] when 'upload' then array[300,60,20] end;
 if limits is null then raise exception 'Unsupported provider operation.' using errcode='22023';end if;
 subjects:=array['00000000-0000-0000-0000-000000000000'::uuid,p_business,p_actor];
 -- Stable lock order across all replicas. The whole reservation is atomic: a
 -- later rejection rolls back earlier bucket changes and the parent reservation.
 for i in 1..3 loop
  step:=make_interval(secs=>60.0/limits[i]);
  insert into private.provider_burst_buckets(resource,scope,subject,theoretical_at)
   values(p_resource,scopes[i],subjects[i],current_time_value) on conflict do nothing;
  select theoretical_at into old_time from private.provider_burst_buckets
   where resource=p_resource and scope=scopes[i] and subject=subjects[i] for update;
  next_time:=greatest(old_time,current_time_value)+step;
  if next_time>current_time_value+interval '60 seconds' then
   retry_seconds:=greatest(1,ceil(extract(epoch from next_time-current_time_value-interval '60 seconds'))::integer);
   raise sqlstate 'PGRST' using
    message=jsonb_build_object('code','FINVIANT_BURST_LIMIT','message','Too many requests. Wait before trying again.','details',retry_seconds::text)::text,
    detail=jsonb_build_object('status',429,'headers',jsonb_build_object('Retry-After',retry_seconds::text,'Cache-Control','no-store'))::text;
  end if;
  update private.provider_burst_buckets set theoretical_at=next_time,updated_at=current_time_value
   where resource=p_resource and scope=scopes[i] and subject=subjects[i];
 end loop;
end $$;
revoke all on function private.reserve_provider_burst(text,uuid,uuid) from public,anon,authenticated,service_role;

-- A new request's monthly usage and first provider attempt commit together.
-- A burst rejection therefore cannot spend a new Fin/voice allowance.
create function public.reserve_ai_request(p_business uuid,p_request uuid,p_feature text,p_units integer default 1) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if public.reserve_tier_request(p_business,p_request,p_feature,p_units) is distinct from true then
  raise exception 'This request already reserved usage. Check the saved result before starting another.' using errcode='23505';
 end if;
 return public.reserve_ai_provider_attempt(p_business,case p_feature when 'ai' then 'command' else 'transcription' end);
end $$;
revoke all on function public.reserve_ai_request(uuid,uuid,text,integer) from public,anon,service_role;
grant execute on function public.reserve_ai_request(uuid,uuid,text,integer) to authenticated;

-- Fail closed on schema drift instead of replacing newer authorization logic.
-- Existing identity/module/plan checks execute before the new atomic guard.
do $$
declare signature text;definition text;needle text;replacement text;
begin
 for signature,needle,replacement in select * from(values
 ('private.fin_begin_turn(uuid,uuid,uuid,text)',
  ' perform private.reserve_tier_usage(b,r,''ai'',1);',
  ' perform public.reserve_ai_request(b,r,''ai'',1);'),
 ('private.fin_begin_turn(uuid,uuid,uuid,text)',
  ' return jsonb_build_object(''revision'',x.revision,''history'',x.history,''cached'',null);',
  ' return jsonb_build_object(''revision'',x.revision,''history'',x.history,''cached'',null,''provider_reserved'',true);'),
 ('private.finviant_reserve_ai_attempt(uuid,text)',
  ' insert into private.finviant_ai_attempt_budget(business_id,period,kind)',
  E' perform private.reserve_provider_burst(''ai'',p_business_id,auth.uid());\n insert into private.finviant_ai_attempt_budget(business_id,period,kind)'),
 ('private.reserve_receipt_scan(uuid,uuid,uuid)',
  '  insert into private.receipt_scan_requests values(p_business,p_request,month_start);',
  E'  perform private.reserve_provider_burst(''receipt'',p_business,p_actor);\n  insert into private.receipt_scan_requests values(p_business,p_request,month_start);'),
 ('private.reserve_attachment(uuid,text,text,bigint)',
  '  perform pg_advisory_xact_lock(hashtextextended(''finviant-storage:''||b::text,0));',
  E'  perform private.reserve_provider_burst(''upload'',b,p_actor);\n  perform pg_advisory_xact_lock(hashtextextended(''finviant-storage:''||b::text,0));')
 )p(signature,needle,replacement) loop
  if to_regprocedure(signature) is null then raise exception 'Provider guard target is missing: %',signature;end if;
  definition:=pg_get_functiondef(to_regprocedure(signature));
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
    or position('private.reserve_provider_burst' in definition)>0 then raise exception 'Provider guard target changed: %',signature;end if;
  execute replace(definition,needle,replacement);
 end loop;
end $$;

create function private.prune_provider_burst_buckets() returns integer
language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
 delete from private.provider_burst_buckets where (resource,scope,subject) in
  (select resource,scope,subject from private.provider_burst_buckets where updated_at<now()-interval '1 day' order by updated_at limit 10000 for update skip locked);
 get diagnostics removed=row_count;return removed;
end $$;
revoke all on function private.prune_provider_burst_buckets() from public,anon,authenticated,service_role;
select cron.schedule('finviant-provider-burst-expiry','17 * * * *','select private.prune_provider_burst_buckets()');

create function public.get_provider_burst_health() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('checked_at',now(),'buckets',count(*),'stale_buckets',count(*) filter(where updated_at<now()-interval '1 day'),
  'global_cooling_down',count(*) filter(where scope='global' and theoretical_at>now()+interval '59 seconds')) from private.provider_burst_buckets;
$$;
revoke all on function public.get_provider_burst_health() from public,anon,authenticated;
grant execute on function public.get_provider_burst_health() to service_role;
