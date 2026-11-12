-- Additive shared backpressure. No provider activation or entitlement changes.
alter table private.provider_burst_buckets drop constraint provider_burst_buckets_resource_check;
alter table private.provider_burst_buckets add constraint provider_burst_buckets_resource_check
 check(resource in('ai','receipt','upload','pdf','email','sms','public_link'));

-- One bounded row per resource, no content, IP addresses or bearer tokens.
-- Fixed UTC days: this is an attempt ceiling, not a dollar billing guarantee.
create table private.provider_daily_attempts (
 resource text primary key check(resource in('ai','receipt','upload','pdf','email','sms')),
 period date not null,
 attempts integer not null check(attempts>=0)
);
alter table private.provider_daily_attempts enable row level security;
revoke all on private.provider_daily_attempts from public,anon,authenticated,service_role;
create function private.reserve_daily_provider_attempt(p_resource text) returns void
language plpgsql security definer set search_path='' as $$
declare today date:=(clock_timestamp() at time zone 'UTC')::date; cap integer; used integer; retry integer;
begin
 cap:=case p_resource when 'ai' then 7200 when 'receipt' then 3600 when 'upload' then 18000
  when 'pdf' then 7200 when 'email' then 6000 when 'sms' then 3000 end;
 if cap is null then raise exception 'Unsupported provider operation' using errcode='22023';end if;
 insert into private.provider_daily_attempts values(p_resource,today,1)
 on conflict(resource) do update set period=today,
 attempts=case when provider_daily_attempts.period<>today then 1 else provider_daily_attempts.attempts+1 end
 where provider_daily_attempts.period<>today or provider_daily_attempts.attempts<cap
 returning attempts into used;
 if used is null then
  retry:=greatest(1,ceil(extract(epoch from ((today+1)::timestamp at time zone 'UTC')-clock_timestamp()))::integer);
  raise sqlstate 'PGRST' using
   message=jsonb_build_object('code','FINVIANT_DAILY_LIMIT','message','Daily service allowance reached. Manual work remains available.','details',retry::text)::text,
   detail=jsonb_build_object('status',429,'headers',jsonb_build_object('Retry-After',retry::text,'Cache-Control','no-store'))::text;
 end if;
end $$;
revoke all on function private.reserve_daily_provider_attempt(text) from public,anon,authenticated,service_role;

create or replace function private.reserve_provider_burst(p_resource text,p_business uuid,p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
declare current_time_value timestamptz:=clock_timestamp(); old_time timestamptz; next_time timestamptz;
 limits integer[]; subjects uuid[]; scopes text[]:=array['global','business','actor'];
 i integer; step interval; retry_seconds integer;
begin
 if p_business is null or p_actor is null then raise exception 'Provider access required.' using errcode='42501';end if;
 limits:=case p_resource when 'ai' then array[120,20,12] when 'receipt' then array[60,12,6] when 'upload' then array[300,60,20] when 'pdf' then array[120,30,12] when 'email' then array[100,20,12] when 'sms' then array[50,12,6] when 'public_link' then array[600,120,60] end;
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
 if p_resource<>'public_link' then perform private.reserve_daily_provider_attempt(p_resource);end if;
end $$;
revoke all on function private.reserve_provider_burst(text,uuid,uuid) from public,anon,authenticated,service_role;


-- Guard the transition that actually spends an attempt, including worker retries.
-- Rejection rolls back the lease/status/attempt counter; queued work remains queued.
create function private.guard_message_provider_attempt() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='sending' and (old.status is distinct from new.status
   or (tg_table_name='finviant_email_outbox' and (to_jsonb(new)->>'attempts') is distinct from (to_jsonb(old)->>'attempts'))) then
  perform private.reserve_provider_burst(case when tg_table_name='appointment_reminder_queue' then to_jsonb(new)->>'channel' when tg_table_name='finviant_email_outbox' then 'email' else 'sms' end,new.business_id,coalesce(to_jsonb(new)->>'actor_id',to_jsonb(new)#>>'{snapshot,actor_id}')::uuid);
 end if;
 return new;
end $$;
revoke all on function private.guard_message_provider_attempt() from public,anon,authenticated,service_role;
create trigger email_provider_attempt before update on private.finviant_email_outbox for each row execute function private.guard_message_provider_attempt();
create trigger sms_provider_attempt before update on private.managed_sms for each row execute function private.guard_message_provider_attempt();
create trigger card_sms_provider_attempt before update on private.business_card_sms for each row execute function private.guard_message_provider_attempt();

create trigger appointment_provider_attempt before update on private.appointment_reminder_queue for each row execute function private.guard_message_provider_attempt();

-- Keep original authorization and token validity checks. Hash-derived link UUIDs
-- only identify already valid links; invalid-token/IP flood control belongs at ingress.
do $$
declare signature text; definition text; needle text; replacement text;
begin
 for signature,needle,replacement in select * from(values
 ('public.get_owner_document_version(uuid,text,uuid)',
  '  return private.publish_document_version(auth.uid(),p_business,p_kind,p_document);',
  E'  declare result jsonb; begin\n   result:=private.publish_document_version(auth.uid(),p_business,p_kind,p_document);\n   perform private.reserve_provider_burst(''public_link'',p_business,auth.uid());\n   return result;\n  end;'),
 ('public.get_document_pdf_version(text,text)',
  '  return jsonb_build_object(''version_id'',version.id,''business_id'',b,',
  E'  perform private.reserve_provider_burst(''public_link'',b,substring(hash,1,32)::uuid);\n  return jsonb_build_object(''version_id'',version.id,''business_id'',b,'),
 ('public.get_shared_document(text)',
  '  return (context->''snapshot'')||',
  E'  perform private.reserve_provider_burst(''public_link'',(select business_id from private.document_shares where token_hash=encode(sha256(convert_to(p_token,''UTF8'')),''hex'')),substring(encode(sha256(convert_to(p_token,''UTF8'')),''hex''),1,32)::uuid);\n  return (context->''snapshot'')||'),
 ('private.customer_schedule_offer(text,uuid,text)',
  ' return view||jsonb_build_object(''status'',state,',
  E' perform private.reserve_provider_burst(''public_link'',b,substring(hash,1,32)::uuid);\n return view||jsonb_build_object(''status'',state,'),
 ('public.consume_document_approval(text,text,text,text,boolean)',
  '    return private.consume_document_approval_before_versions(p_token_hash,p_action,p_typed_name,p_user_agent,p_terms_agreed);',
  E'    result:=private.consume_document_approval_before_versions(p_token_hash,p_action,p_typed_name,p_user_agent,p_terms_agreed);\n    perform private.reserve_provider_burst(''public_link'',link.business_id,substring(p_token_hash,1,32)::uuid);\n    return result;'),
 ('public.consume_document_approval(text,text,text,text,boolean)',
  '  return result||jsonb_build_object(''revision_id'',link.document_version_id);',
  E'  perform private.reserve_provider_burst(''public_link'',link.business_id,substring(p_token_hash,1,32)::uuid);\n  return result||jsonb_build_object(''revision_id'',link.document_version_id);'),
 ('private.read_business_card(text)',
  ' return jsonb_build_object(''card'',l.card,',
  E' perform private.reserve_provider_burst(''public_link'',l.business_id,substring(l.token_hash,1,32)::uuid);\n return jsonb_build_object(''card'',l.card,')
 )p(signature,needle,replacement) loop
  if to_regprocedure(signature) is null then raise exception 'Abuse guard target missing: %',signature;end if;
  definition:=pg_get_functiondef(to_regprocedure(signature));
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Abuse guard target changed: %',signature;end if;
  execute replace(definition,needle,replacement);
 end loop;
end $$;
alter function private.read_business_card(text) volatile;

-- Called only on a cache miss, before font/logo reads or rendering. Existing
-- cached PDFs stay downloadable when render capacity is exhausted.
create function public.reserve_document_pdf_render(p_version uuid) returns void
language plpgsql security definer set search_path='' as $$
declare b uuid;
begin
 select business_id into b from private.document_versions where id=p_version;
 if b is null then raise exception 'Document unavailable' using errcode='42501';end if;
 perform private.reserve_provider_burst('pdf',b,p_version);
end $$;
revoke all on function public.reserve_document_pdf_render(uuid) from public,anon,authenticated;
grant execute on function public.reserve_document_pdf_render(uuid) to service_role;

-- Public payment lookups share link backpressure; internal reconciliation reads
-- retain their stable, unthrottled context helper so recovery cannot be starved.
create or replace function public.get_customer_payment_context(p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb;
begin
 context:=private.customer_payment_context(p_token_hash);
 perform private.reserve_provider_burst('public_link',(context->>'business_id')::uuid,substring(p_token_hash,1,32)::uuid);
 return context;
end $$;
