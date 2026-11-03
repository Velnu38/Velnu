-- Internal provider tests only. Never updates invoices, payments or paid entitlements.
create table private.integration_test_state (
 business_id uuid primary key references public.businesses(id) on delete cascade,
 stripe_account text, stripe_customer text, stripe_subscription text,
 updated_at timestamptz not null default now()
);
create table private.integration_test_operations (
 id uuid primary key, business_id uuid not null references public.businesses(id) on delete cascade,
 actor_id uuid not null, kind text not null check(kind in ('subscription','connect','invoice','sms','portal')),
 input jsonb not null, status text not null default 'reserved',
 provider_id text, provider_account text, result jsonb not null default '{}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index integration_test_business_created on private.integration_test_operations(business_id,created_at desc);
create unique index integration_test_provider on private.integration_test_operations(provider_account,provider_id) where provider_id is not null;
create table private.integration_test_events (
 provider text not null, event_id text not null, operation_id uuid not null references private.integration_test_operations(id),
 created_at timestamptz not null default now(),primary key(provider,event_id)
);
alter table private.integration_test_state enable row level security;
alter table private.integration_test_operations enable row level security;
alter table private.integration_test_events enable row level security;
revoke all on private.integration_test_state,private.integration_test_operations,private.integration_test_events from public,anon,authenticated;

create function private.integration_test_context(b uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_primary_owner(b) then raise exception 'Only the primary owner can run integration tests' using errcode='42501';end if;
 return jsonb_build_object('state',coalesce((select to_jsonb(s)-'business_id' from private.integration_test_state s where business_id=b),'{}'),
  'operations',coalesce((select jsonb_agg(x order by created_at desc) from (select id,kind,status,provider_id,created_at,updated_at,result from private.integration_test_operations where business_id=b order by created_at desc limit 20) x),'[]'),
  'invoices',coalesce((select jsonb_agg(x) from (select id,invoice_number,status,balance_due from public.invoices where business_id=b and balance_due>0 and status not in ('draft','void') order by created_at desc limit 100) x),'[]'));
end $$;
create function public.get_integration_test_context(p_business uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select private.integration_test_context(p_business) $$;

create function private.reserve_integration_test(b uuid,r uuid,k text,i jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare row private.integration_test_operations; invoice public.invoices;
begin
 if not private.is_primary_owner(b) then raise exception 'Only the primary owner can run integration tests' using errcode='42501';end if;
 if r is null or k not in ('subscription','connect','invoice','sms','portal') or jsonb_typeof(i)<>'object' or octet_length(i::text)>2048 then raise exception 'Invalid test request';end if;
 perform pg_advisory_xact_lock(hashtextextended(b::text,0));
 select * into row from private.integration_test_operations where id=r;
 if found then
  if row.business_id<>b or row.actor_id<>auth.uid() or row.kind<>k or (row.input - 'amount_cents' - 'invoice_number' - 'currency')<>i then raise exception 'Request ID already used for another operation' using errcode='42501';end if;
  return to_jsonb(row)||jsonb_build_object('fresh',false);
 end if;
 if (select count(*) from private.integration_test_operations where business_id=b and created_at>now()-interval '1 day')>=30 then raise exception 'Daily internal test limit reached';end if;
 if k in ('subscription','connect','invoice') and exists(select 1 from private.integration_test_operations where business_id=b and kind=k and status in ('reserved','open','uncertain') and (k<>'invoice' or input->>'invoice_id'=i->>'invoice_id')) then raise exception 'An existing test needs reconciliation before a new request';end if;
 if k='subscription' and exists(select 1 from private.integration_test_state where business_id=b and stripe_subscription is not null) then raise exception 'Use the existing test subscription portal';end if;
 if k='invoice' then
  select * into invoice from public.invoices where id=(i->>'invoice_id')::uuid and business_id=b;
  if not found or invoice.status in ('draft','void') or invoice.balance_due<=0 then raise exception 'Choose an issued invoice with an unpaid balance';end if;
  -- The client cannot choose amount, currency, merchant or payment destination.
  i:=i||jsonb_build_object('amount_cents',round(invoice.balance_due*100)::bigint,'invoice_number',invoice.invoice_number,'currency',(select lower(currency) from public.businesses where id=b));
 end if;
 insert into private.integration_test_operations(id,business_id,actor_id,kind,input) values(r,b,auth.uid(),k,i) returning * into row;
 return to_jsonb(row)||jsonb_build_object('fresh',true);
end $$;
create function public.reserve_integration_test(p_business uuid,p_request uuid,p_kind text,p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.reserve_integration_test(p_business,p_request,p_kind,p_input)$$;

-- Service-only persistence. Browser callers cannot manufacture provider success or bindings.
create function private.finish_integration_test(r uuid,p_status text,p_provider text,p_account text,p_result jsonb) returns void language plpgsql security definer set search_path='' as $$
declare o private.integration_test_operations;
begin
 if p_status not in ('accepted','uncertain','failed','open') or octet_length(p_result::text)>4096 then raise exception 'Invalid receipt';end if;
 select * into o from private.integration_test_operations where id=r for update;
 if not found then raise exception 'Unknown test operation';end if;
 if o.provider_id is not null and p_provider is distinct from o.provider_id then raise exception 'Provider identity mismatch';end if;
 update private.integration_test_operations set status=case when status in ('paid','delivered','undelivered','canceled','expired') then status else p_status end,
 provider_id=coalesce(provider_id,p_provider),provider_account=coalesce(provider_account,p_account),result=result||p_result,updated_at=now() where id=r;
 if o.kind='connect' and p_status='accepted' and p_provider ~ '^acct_[A-Za-z0-9]+$' then
  insert into private.integration_test_state(business_id,stripe_account) values(o.business_id,p_provider)
  on conflict(business_id) do update set stripe_account=excluded.stripe_account,updated_at=now();
 end if;
end $$;
create function public.finish_integration_test(p_request uuid,p_status text,p_provider text,p_account text,p_result jsonb) returns void language sql security invoker set search_path='' as $$select private.finish_integration_test(p_request,p_status,p_provider,p_account,p_result)$$;

create function private.record_integration_test_event(p_provider text,p_event text,p_request uuid,p_object text,p_account text,p_status text,p_result jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare o private.integration_test_operations;
begin
 select * into o from private.integration_test_operations where id=p_request for update;
 if not found then return false;end if;
 if p_provider='stripe' then
  if o.kind not in ('subscription','invoice') or o.provider_id is distinct from p_object or o.provider_account is distinct from p_account or p_status not in ('paid','expired','failed') then return false;end if;
 elsif p_provider='twilio' then
  if o.kind<>'sms' or (o.provider_id is not null and o.provider_id<>p_object) or p_status not in ('accepted','queued','sending','sent','delivered','undelivered','failed') then return false;end if;
 else return false;end if;
 if octet_length(p_result::text)>4096 then return false;end if;
 insert into private.integration_test_events values(p_provider,p_event,p_request,now()) on conflict do nothing;
 if not found then return true;end if;
 update private.integration_test_operations set provider_id=coalesce(provider_id,p_object),status=case when status in ('paid','delivered','undelivered','failed','expired') then status else p_status end,result=result||p_result,updated_at=now() where id=p_request;
 if o.kind='subscription' and p_status='paid' and p_result->>'customer' ~ '^cus_[A-Za-z0-9]+$' and p_result->>'subscription' ~ '^sub_[A-Za-z0-9]+$' then
  insert into private.integration_test_state(business_id,stripe_customer,stripe_subscription) values(o.business_id,p_result->>'customer',p_result->>'subscription')
  on conflict(business_id) do update set stripe_customer=excluded.stripe_customer,stripe_subscription=excluded.stripe_subscription,updated_at=now();
 end if;
 return true;
end $$;
create function public.record_integration_test_event(p_provider text,p_event text,p_request uuid,p_object text,p_account text,p_status text,p_result jsonb) returns boolean language sql security invoker set search_path='' as $$select private.record_integration_test_event(p_provider,p_event,p_request,p_object,p_account,p_status,p_result)$$;

do $$declare f record;begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.proname in ('integration_test_context','get_integration_test_context','reserve_integration_test','finish_integration_test','record_integration_test_event') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 execute format('grant execute on function %s to %I',f.signature,case when f.proname in ('integration_test_context','get_integration_test_context','reserve_integration_test') then 'authenticated' else 'service_role' end);
 end loop;
end $$;
