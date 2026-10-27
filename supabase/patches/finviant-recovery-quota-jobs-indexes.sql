-- Applied in staging on 2026-10-27. Requires the existing foundation and recovery-phase1 patch.
-- Replay in an isolated migration rehearsal before production. No production deployment is authorized.
create table if not exists private.finviant_ai_attempt_budget (
 business_id uuid not null references public.businesses(id) on delete cascade,
 period date not null,kind text not null check(kind in('command','transcription')),
 attempts integer not null default 0 check(attempts>=0),minute_start timestamptz not null default now(),
 minute_attempts integer not null default 0 check(minute_attempts>=0),primary key(business_id,period,kind));
alter table private.finviant_ai_attempt_budget enable row level security;
revoke all on private.finviant_ai_attempt_budget from public,anon,authenticated;
create or replace function private.finviant_reserve_ai_attempt(p_business_id uuid,p_kind text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare b private.finviant_ai_attempt_budget%rowtype;usage jsonb;limit_value integer;stored_usage integer;period_start date:=date_trunc('month',now() at time zone 'UTC')::date;next_attempt integer;
begin
 if auth.uid() is null or not private.is_business_member(p_business_id) then raise exception 'Business access denied' using errcode='42501';end if;
 if p_kind is null or p_kind not in('command','transcription') then raise exception 'Invalid AI operation' using errcode='22023';end if;
 usage:=private.get_plan_usage(p_business_id);
 limit_value:=(usage->>case when p_kind='command' then 'ai_limit' else 'voice_limit' end)::integer;
 stored_usage:=coalesce((usage->>case when p_kind='command' then 'ai_used' else 'voice_used' end)::integer,0);
 if usage->>'plan'<>'pro' or coalesce(limit_value,0)<=0 then raise exception 'Activated AI plan required' using errcode='42501';end if;
 insert into private.finviant_ai_attempt_budget(business_id,period,kind) values(p_business_id,period_start,p_kind) on conflict do nothing;
 select * into b from private.finviant_ai_attempt_budget where business_id=p_business_id and period=period_start and kind=p_kind for update;
 next_attempt:=greatest(b.attempts,stored_usage)+1;
 if next_attempt>limit_value then raise exception 'AI_ATTEMPT_BUDGET_EXHAUSTED' using errcode='P0001';end if;
 if b.minute_start>now()-interval '1 minute' and b.minute_attempts>=10 then raise exception 'AI_RATE_LIMIT' using errcode='P0001';end if;
 update private.finviant_ai_attempt_budget set attempts=next_attempt,minute_attempts=case when b.minute_start<=now()-interval '1 minute' then 1 else b.minute_attempts+1 end,minute_start=case when b.minute_start<=now()-interval '1 minute' then now() else b.minute_start end where business_id=p_business_id and period=period_start and kind=p_kind;
 return jsonb_build_object('reserved',true,'remaining',limit_value-next_attempt,'period',period_start);
end;$fn$;
revoke all on function private.finviant_reserve_ai_attempt(uuid,text) from public,anon;
grant execute on function private.finviant_reserve_ai_attempt(uuid,text) to authenticated;
create or replace function public.reserve_ai_provider_attempt(p_business_id uuid,p_kind text) returns jsonb language sql security invoker set search_path='' as $fn$ select private.finviant_reserve_ai_attempt(p_business_id,p_kind); $fn$;
revoke all on function public.reserve_ai_provider_attempt(uuid,text) from public,anon;
grant execute on function public.reserve_ai_provider_attempt(uuid,text) to authenticated;
comment on table private.finviant_ai_attempt_budget is 'Conservative pre-provider attempt budget: failed and uncertain calls remain counted. Not a dollar-denominated billing ledger.';

create or replace function public.create_job_atomic(target_business_id uuid,request_id uuid,payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare old_row public.jobs%rowtype;new_row public.jobs%rowtype;fingerprint text;cid uuid;pid uuid;job_title text;
begin
 if auth.uid() is null or not private.can_write_business(target_business_id) then raise exception 'Write permission required' using errcode='42501';end if;
 if request_id is null or payload is null or jsonb_typeof(payload)<>'object' then raise exception 'Invalid job request' using errcode='22023';end if;
 if nullif(payload->>'scheduled_start','') is not null then return public.create_scheduled_job(target_business_id,request_id,payload);end if;
 fingerprint:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('velnu-scheduled-job-'||target_business_id::text||request_id::text,0));
 select * into old_row from public.jobs j where j.business_id=target_business_id and j.request_id=create_job_atomic.request_id;
 if found then if old_row.request_fingerprint is distinct from fingerprint then raise exception 'Request already saved different content' using errcode='23505';end if;return to_jsonb(old_row);end if;
 cid:=nullif(payload->>'customer_id','')::uuid;pid:=nullif(payload->>'property_id','')::uuid;job_title:=btrim(coalesce(payload->>'title',''));
 if length(job_title) not between 1 and 200 or length(coalesce(payload->>'description',''))>4000 then raise exception 'Invalid job details' using errcode='22023';end if;
 if cid is null or not exists(select 1 from public.customers c where c.id=cid and c.business_id=target_business_id and not c.archived) then raise exception 'Customer unavailable' using errcode='23503';end if;
 if pid is not null and not exists(select 1 from public.properties p where p.id=pid and p.business_id=target_business_id and p.customer_id=cid) then raise exception 'Service location unavailable' using errcode='23503';end if;
 if nullif(payload->>'scheduled_end','') is not null then raise exception 'A scheduled end requires a start' using errcode='22023';end if;
 insert into public.jobs(business_id,customer_id,property_id,title,description,status,request_id,request_fingerprint) values(target_business_id,cid,pid,job_title,nullif(btrim(payload->>'description'),''),'lead',request_id,fingerprint) returning * into new_row;
 return to_jsonb(new_row);
end;$fn$;
revoke all on function public.create_job_atomic(uuid,uuid,jsonb) from public,anon;
grant execute on function public.create_job_atomic(uuid,uuid,jsonb) to authenticated;

-- Only rehearse this index pass on the small staging database; use reviewed concurrent
-- production index migrations on large tables, rather than blindly reusing this block.
set local lock_timeout='2s';set local statement_timeout='45s';
do $fn$ declare f record;cols text;index_name text;begin
 for f in select c.conrelid,c.conname,c.conkey,t.relname from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where c.contype='f' and n.nspname='public' order by cardinality(c.conkey) desc,t.relname,c.conname loop
 if not exists(select 1 from pg_index i where i.indrelid=f.conrelid and i.indisvalid and i.indpred is null and i.indnkeyatts>=cardinality(f.conkey) and (i.indkey::smallint[])[0:cardinality(f.conkey)-1] @> f.conkey) then
 select string_agg(format('%I',a.attname),',' order by k.ord) into cols from unnest(f.conkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=f.conrelid and a.attnum=k.attnum;
 index_name:='idx_fv_fk_'||left(f.relname,32)||'_'||left(md5(f.conname),10);execute format('create index if not exists %I on public.%I (%s)',index_name,f.relname,cols);end if;end loop;
end;$fn$;
create index if not exists idx_fv_messages_email_hour on public.messages(business_id,created_at desc) where channel='email' and direction='outbound';
create index if not exists idx_fv_ai_action_owner_recent on public.ai_actions(user_id,created_at desc);
create index if not exists idx_fv_voice_user_created on public.voice_transcriptions(user_id,created_at desc);
create index if not exists idx_fv_invoice_items_parent_tenant on public.invoice_items(invoice_id,business_id);
create index if not exists idx_fv_estimate_items_parent_tenant on public.estimate_items(estimate_id,business_id);
create index if not exists idx_fv_jobs_customer_tenant on public.jobs(customer_id,business_id);
create index if not exists idx_fv_payments_invoice_tenant on public.payments(invoice_id,business_id);
drop index if exists public.idx_fv_fk_invoice_items_b47675c90b;
drop index if exists public.idx_fv_fk_estimate_items_d582c413d8;
drop index if exists public.idx_jobs_customer;
drop index if exists public.idx_payments_invoice;
do $guard$ begin
 if to_regclass('public.invoices_estimate_unique') is not null then
  if exists(select 1 from pg_index where indexrelid=to_regclass('public.invoice_single_conversion') and indisunique and indisvalid) and not exists(select 1 from pg_constraint where conindid=to_regclass('public.invoices_estimate_unique')) then execute 'drop index public.invoices_estimate_unique';else raise exception 'Invoice uniqueness safety check failed';end if;
 end if;
end;$guard$;
