-- One effective workspace plan; testing never changes paid entitlements.
create table private.tier_test_overrides (
 business_id uuid primary key references public.businesses(id) on delete cascade,
 tier text not null check(tier in('free','basic','pro')),
 actor_id uuid not null references auth.users(id), updated_at timestamptz not null default now()
);
create index tier_test_actor on private.tier_test_overrides(actor_id);
alter table private.tier_test_overrides enable row level security;
revoke all on private.tier_test_overrides from public,anon,authenticated,service_role;
create policy no_client_access on private.tier_test_overrides to authenticated using(false);
insert into private.workspace_feature_flags(name,enabled) values('tier_testing',false) on conflict do nothing;

create function private.can_test_tiers(b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.is_primary_owner(b) and
 coalesce((select enabled from private.workspace_feature_flags where name='tier_testing'),false)
 and (exists(select 1 from private.test_account_slots where user_id=auth.uid())
 or exists(select 1 from private.platform_operators where user_id=auth.uid() and active));
$$;
create function private.effective_plan(b uuid) returns text language sql stable security definer set search_path='' as $$
 select coalesce((select o.tier from private.tier_test_overrides o
 join private.workspace_feature_flags f on f.name='tier_testing' and f.enabled
 join public.businesses x on x.id=o.business_id and x.created_by_user_id=o.actor_id
 where o.business_id=b and (exists(select 1 from private.test_account_slots s where s.user_id=o.actor_id)
 or exists(select 1 from private.platform_operators p where p.user_id=o.actor_id and p.active))),
 (select plan from private.business_entitlements where business_id=b and (valid_until is null or valid_until>now())),'free');
$$;
create or replace function private.is_pro(b uuid) returns boolean language sql stable security definer set search_path='' as $$select private.effective_plan(b)='pro'$$;
create or replace function private.attachment_plan(b uuid) returns text language sql stable security definer set search_path='' as $$select private.effective_plan(b)$$;
create or replace function private.team_seat_limit(b uuid) returns integer language sql stable security definer set search_path='' as $$select case when private.effective_plan(b)='pro' then 5 else 1 end$$;

create table private.tier_usage (
 business_id uuid not null references public.businesses(id) on delete cascade,
 period date not null, feature text not null check(feature in('ai','voice','email','sms')),
 used integer not null default 0 check(used>=0),primary key(business_id,period,feature)
);
create table private.tier_operations (
 business_id uuid not null references public.businesses(id) on delete cascade,
 request_id uuid not null, feature text not null,period date not null,units integer not null check(units>0),
 created_at timestamptz not null default now(),primary key(business_id,request_id,feature)
);
create table private.tier_bookings (
 business_id uuid not null references public.businesses(id) on delete cascade,
 record_id uuid not null,period date not null,primary key(business_id,record_id)
);
alter table private.tier_usage enable row level security;
alter table private.tier_operations enable row level security;
alter table private.tier_bookings enable row level security;
revoke all on private.tier_usage,private.tier_operations,private.tier_bookings from public,anon,authenticated,service_role;
create policy no_client_access on private.tier_usage to authenticated using(false);
create policy no_client_access on private.tier_operations to authenticated using(false);
create policy no_client_access on private.tier_bookings to authenticated using(false);
-- Existing work is retained and included; cancel/delete does not refill a used slot.
insert into private.tier_bookings(business_id,record_id,period)
 select business_id,id,date_trunc('month',coalesce(scheduled_start,created_at) at time zone 'UTC')::date from public.jobs where scheduled_start is not null;

create function private.tier_limit(t text,f text) returns integer language sql immutable set search_path='' as $$
 select case f when 'ai' then case t when 'pro' then 600 when 'basic' then 150 else 20 end
 when 'voice' then case t when 'pro' then 10800 when 'basic' then 3600 else 600 end
 when 'email' then case when t='pro' then 2000 else 0 end
 when 'sms' then case when t='pro' then 200 else 0 end else 0 end;
$$;
create function private.tier_period(t text,f text) returns date language sql stable set search_path='' as $$
 select case when t='free' and f in('ai','voice') then date '2000-01-01' else date_trunc('month',now() at time zone 'UTC')::date end;
$$;
create function private.reserve_tier_usage(b uuid,r uuid,f text,n integer) returns boolean language plpgsql security definer set search_path='' as $$
declare t text:=private.effective_plan(b); p date:=private.tier_period(t,f); lim integer:=private.tier_limit(t,f); used_now integer; existing private.tier_operations;
begin
 if b is null or r is null or f is null or f not in('ai','voice','email','sms') or n is null or n<1 or n>12000 then raise exception 'Invalid usage request' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('tier-usage:'||b::text||f,0));
 select * into existing from private.tier_operations where business_id=b and request_id=r and feature=f;
 if found then if existing.units<>n then raise exception 'Usage request changed' using errcode='23505';end if;return false;end if;
 insert into private.tier_usage(business_id,period,feature) values(b,p,f) on conflict do nothing;
 select used into used_now from private.tier_usage where business_id=b and period=p and feature=f for update;
 if used_now+n>lim then raise exception '% allowance reached. Open Plans & Usage to review your plan. Existing records remain available.',f using errcode='P0001';end if;
 update private.tier_usage set used=used+n where business_id=b and period=p and feature=f;
 insert into private.tier_operations(business_id,request_id,feature,period,units) values(b,r,f,p,n);
 return true;
end $$;
create function public.reserve_tier_request(p_business uuid,p_request uuid,p_feature text,p_units integer default 1) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not private.fin_access(p_business,'profile') or p_feature is null or p_feature not in('ai','voice') or
 (p_feature='ai' and p_units<>1) or (p_feature='voice' and (p_units<1 or p_units>120)) then raise exception 'Assistant access denied' using errcode='42501';end if;
 return private.reserve_tier_usage(p_business,p_request,p_feature,p_units);
end $$;

create or replace function private.get_plan_usage(target_business_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t text:=private.effective_plan(target_business_id); m date:=date_trunc('month',now() at time zone 'UTC')::date; result jsonb;
begin
 if auth.uid() is null or not private.is_business_member(target_business_id) then raise exception 'Not authorized' using errcode='42501';end if;
 select jsonb_build_object('plan',t,'actual_plan',coalesce((select plan from private.business_entitlements where business_id=target_business_id and(valid_until is null or valid_until>now())),'free'),
 'testing',exists(select 1 from private.tier_test_overrides o join private.workspace_feature_flags f on f.name='tier_testing' and f.enabled where o.business_id=target_business_id),
 'can_test',private.can_test_tiers(target_business_id),'period_end',(m+interval '1 month')::date,'introductory',t='free',
 'customers_used',(select count(*) from public.customers where business_id=target_business_id and not archived),'customers_limit',case when t='free' then 10 end,
 'jobs_used',(select count(*) from private.tier_bookings where business_id=target_business_id and period=m),'jobs_limit',case when t='free' then 5 end,
 'seats_used',(select count(*) from public.business_members where business_id=target_business_id),'seats_limit',private.team_seat_limit(target_business_id),
 'documents_used',coalesce((select documents from private.monthly_usage where business_id=target_business_id and month=m),0),'documents_limit',null,
 'ai_limit',private.tier_limit(t,'ai'),'voice_limit',private.tier_limit(t,'voice')/60,'email_limit',private.tier_limit(t,'email'),'sms_limit',private.tier_limit(t,'sms'),
 'ai_used',coalesce((select used from private.tier_usage where business_id=target_business_id and period=private.tier_period(t,'ai') and feature='ai'),0),
 'voice_used',ceil(coalesce((select used from private.tier_usage where business_id=target_business_id and period=private.tier_period(t,'voice') and feature='voice'),0)/60.0),
 'email_used',coalesce((select used from private.tier_usage where business_id=target_business_id and period=m and feature='email'),0),
 'sms_used',coalesce((select used from private.tier_usage where business_id=target_business_id and period=m and feature='sms'),0),
 'storage_bytes_limit',private.attachment_limit(t),'logo_bytes_limit',case when t='free' then 0 else 2000000 end,
 'delivery_mode',case when t='pro' then 'managed' else 'personal' end,'financial_history',t<>'free') into result;
 return result;
end $$;
create function public.set_tier_test(p_business uuid,p_tier text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.can_test_tiers(p_business) then raise exception 'Private tier testing requires an authorized primary owner.' using errcode='42501';end if;
 if p_tier is not null and p_tier not in('free','basic','pro') then raise exception 'Unknown tier' using errcode='22023';end if;
 if p_tier is null then delete from private.tier_test_overrides where business_id=p_business;
 else insert into private.tier_test_overrides(business_id,tier,actor_id) values(p_business,p_tier,auth.uid()) on conflict(business_id) do update set tier=excluded.tier,actor_id=excluded.actor_id,updated_at=now();end if;
 return private.get_plan_usage(p_business);
end $$;

create or replace function private.commerce_quota() returns trigger language plpgsql security definer set search_path='' as $$
declare m date:=date_trunc('month',now() at time zone 'UTC')::date;n bigint;
begin
 if tg_op='UPDATE' and new.business_id<>old.business_id then raise exception 'Records cannot move between workspaces' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('tier-customers:'||new.business_id::text,0));
 if tg_table_name='customers' then
  if not new.archived and (tg_op='INSERT' or old.archived) and private.effective_plan(new.business_id)='free' then
   select count(*) into n from public.customers where business_id=new.business_id and not archived;
   if n>=10 then raise exception 'Free includes 10 active customers. Archive an inactive customer or choose Individual. Existing records remain available.' using errcode='23514';end if;
  end if;
 elsif tg_op='INSERT' then
  insert into private.monthly_usage(business_id,month) values(new.business_id,m) on conflict do nothing;
  update private.monthly_usage set documents=documents+1,invoice_estimate_documents=invoice_estimate_documents+case when tg_table_name in('invoices','estimates') then 1 else 0 end where business_id=new.business_id and month=m;
 end if;
 return new;
end $$;
drop trigger commerce_quota on public.customers;
create trigger commerce_quota before insert or update on public.customers for each row execute function private.commerce_quota();
create or replace function private.commerce_auxiliary_limit() returns trigger language plpgsql security definer set search_path='' as $$
declare n bigint;b uuid:=new.business_id;
begin
 if pg_column_size(to_jsonb(new))>65536 then raise exception 'Record is too large';end if;
 if tg_op='UPDATE' then if new.business_id<>old.business_id then raise exception 'Records cannot move between workspaces';end if;return new;end if;
 if tg_table_name='business_members' then
  perform pg_advisory_xact_lock(hashtextextended('storage-'||b::text||tg_table_name,0));
  select count(*) into n from public.business_members where business_id=b;
  if n>=private.team_seat_limit(b) then raise exception 'This plan has no available team seats. Business Pro includes five users.' using errcode='23514';end if;
 end if;return new;
end $$;
create function private.enforce_tier_booking() returns trigger language plpgsql security definer set search_path='' as $$
declare r uuid; b uuid:=new.business_id;m date:=date_trunc('month',now() at time zone 'UTC')::date;
begin
 if tg_op='UPDATE' and new.business_id<>old.business_id then raise exception 'Records cannot move between workspaces';end if;
 if tg_table_name='jobs' then
  if new.scheduled_start is null or new.status='canceled' then return new;end if;r:=new.id;
 else
  if new.status='canceled' or (new.customer_id is null and new.job_id is null) then return new;end if;r:=coalesce(new.job_id,new.id);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('tier-bookings:'||b::text,0));
 if exists(select 1 from private.tier_bookings where business_id=b and record_id=r) then return new;end if;
 if private.effective_plan(b)='free' and (select count(*) from private.tier_bookings where business_id=b and period=m)>=5 then
  raise exception 'Free includes 5 new job bookings per UTC month. Choose Individual for more. Existing bookings remain editable.' using errcode='23514';end if;
 insert into private.tier_bookings values(b,r,m);return new;
end $$;
create trigger tier_job_booking before insert or update on public.jobs for each row execute function private.enforce_tier_booking();
create trigger tier_appointment_booking before insert or update on public.appointments for each row execute function private.enforce_tier_booking();

-- Per-user personal-app setup, with separate operator-controlled managed activation.
create table private.delivery_preferences (
 business_id uuid not null references public.businesses(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,
 email text,phone text,email_ready boolean not null default false,sms_ready boolean not null default false,
 acknowledged_at timestamptz not null default now(),primary key(business_id,user_id)
);
create index delivery_preferences_user on private.delivery_preferences(user_id);
create table private.managed_delivery_accounts (
 business_id uuid primary key references public.businesses(id) on delete cascade,
 email_active boolean not null default false,sms_active boolean not null default false,
 sms_from text,reply_to text,sms_reply_route text,activated_at timestamptz
);
alter table private.delivery_preferences enable row level security;
alter table private.managed_delivery_accounts enable row level security;
revoke all on private.delivery_preferences,private.managed_delivery_accounts from public,anon,authenticated,service_role;
create policy no_client_access on private.delivery_preferences to authenticated using(false);
create policy no_client_access on private.managed_delivery_accounts to authenticated using(false);
create function public.get_delivery_setup(p_business uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d private.delivery_preferences;m private.managed_delivery_accounts;
begin
 if not private.is_business_member(p_business) then raise exception 'Not authorized' using errcode='42501';end if;
 select * into d from private.delivery_preferences where business_id=p_business and user_id=auth.uid();
 select * into m from private.managed_delivery_accounts where business_id=p_business;
 return jsonb_build_object('plan',private.effective_plan(p_business),'email',d.email,'phone',d.phone,
 'personal_email_ready',coalesce(d.email_ready,false),'personal_sms_ready',coalesce(d.sms_ready,false),
 'acknowledged',d.acknowledged_at is not null,'managed_email_ready',coalesce(m.email_active,false),
 'managed_sms_ready',coalesce(m.sms_active,false),'reply_to',m.reply_to,'sms_reply_route',m.sms_reply_route);
end $$;
create function public.save_delivery_setup(p_business uuid,p_email text,p_phone text,p_email_ready boolean,p_sms_ready boolean,p_acknowledged boolean) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.is_business_member(p_business) or p_acknowledged is distinct from true then raise exception 'Review and accept the delivery requirements.' using errcode='42501';end if;
 if p_email_ready is null or p_sms_ready is null or length(coalesce(p_email,''))>254 or length(coalesce(p_phone,''))>32
 or (p_email_ready and coalesce(p_email,'') !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$')
 or (p_sms_ready and regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') !~ '^[0-9]{10,15}$') then raise exception 'Enter a valid email and mobile number for the channels you enable.' using errcode='22023';end if;
 insert into private.delivery_preferences(business_id,user_id,email,phone,email_ready,sms_ready) values(p_business,auth.uid(),nullif(btrim(p_email),''),nullif(btrim(p_phone),''),p_email_ready,p_sms_ready)
 on conflict(business_id,user_id) do update set email=excluded.email,phone=excluded.phone,email_ready=excluded.email_ready,sms_ready=excluded.sms_ready,acknowledged_at=now();
 return public.get_delivery_setup(p_business);
end $$;

-- Lock down every new privileged API explicitly, independent of project defaults.
revoke all on function private.can_test_tiers(uuid),private.effective_plan(uuid),private.tier_limit(text,text),private.tier_period(text,text),private.reserve_tier_usage(uuid,uuid,text,integer),private.enforce_tier_booking() from public,anon,authenticated,service_role;
revoke all on function public.set_tier_test(uuid,text),public.get_delivery_setup(uuid),public.save_delivery_setup(uuid,text,text,boolean,boolean,boolean),public.reserve_tier_request(uuid,uuid,text,integer) from public,anon,service_role;
grant execute on function public.set_tier_test(uuid,text),public.get_delivery_setup(uuid),public.save_delivery_setup(uuid,text,text,boolean,boolean,boolean),public.reserve_tier_request(uuid,uuid,text,integer) to authenticated;

-- Route all existing queues and retries through the same plan.
CREATE OR REPLACE FUNCTION private.fin_begin_turn(b uuid, t uuid, r uuid, request text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare x private.fin_threads%rowtype;current_scope jsonb;
begin
 if not private.fin_access(b,'profile') or length(btrim(request)) not between 1 and 6000 or t is null or r is null then raise exception 'Account access or request is invalid.' using errcode='42501';end if;
 insert into private.fin_threads(id,business_id,user_id) values(t,b,auth.uid()) on conflict do nothing;
 select * into x from private.fin_threads where id=t and business_id=b and user_id=auth.uid() for update;
 if not found then raise exception 'Conversation unavailable.' using errcode='42501';end if;
 current_scope:=private.fin_scope(b);
 if x.scope is distinct from current_scope then
  update private.fin_reviews set status='superseded' where thread_id=t and status='pending';
  update private.fin_threads set scope=current_scope,history='[]',response=null,last_request=null,request_text=null,revision=revision+1 where id=t returning * into x;
 end if;
 if btrim(request) ~* '^(yes|confirm|go ahead|do it|okay|ok)[.! ]*$' and x.response is not null and exists(select 1 from private.fin_reviews where id=x.last_request and status='pending' and expires_at>now()) then
 return jsonb_build_object('revision',x.revision,'history',x.history,'cached',x.response||jsonb_build_object('answer','Review the exact details, then use the confirmation button to save. A chat reply does not authorize changes.'));end if;
 if x.last_request=r then
 if x.request_text<>request then raise exception 'This request identifier contains different text.' using errcode='23505';end if;
 return jsonb_build_object('revision',x.revision,'history',x.history,'cached',x.response);end if;
 perform private.reserve_tier_usage(b,r,'ai',1);
 update private.fin_reviews set status='superseded' where thread_id=t and status='pending';
 update private.fin_threads set revision=revision+1,last_request=r,request_text=request,response=null,updated_at=now() where id=t returning * into x;
 return jsonb_build_object('revision',x.revision,'history',x.history,'cached',null);
end $function$;

CREATE OR REPLACE FUNCTION private.finviant_reserve_ai_attempt(p_business_id uuid, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b private.finviant_ai_attempt_budget%rowtype; usage jsonb; limit_value integer; stored_usage integer;
  period_start date:=private.tier_period(private.effective_plan(p_business_id),case when p_kind='command' then 'ai' else 'voice' end); next_attempt integer;
begin
 if not private.fin_access(p_business_id,'profile') then raise exception 'Assistant access denied' using errcode='42501';end if;
 if auth.uid() is null or not private.is_business_member(p_business_id) then raise exception 'Business access denied' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('command','transcription') then raise exception 'Invalid AI operation' using errcode='22023'; end if;
 usage:=private.get_plan_usage(p_business_id);
 limit_value:=(usage->>case when p_kind='command' then 'ai_limit' else 'voice_limit' end)::integer;
 stored_usage:=coalesce((usage->>case when p_kind='command' then 'ai_used' else 'voice_used' end)::integer,0);
 if coalesce(limit_value,0)<=0 then raise exception 'Activated AI plan required' using errcode='42501'; end if;
 insert into private.finviant_ai_attempt_budget(business_id,period,kind) values(p_business_id,period_start,p_kind) on conflict do nothing;
 select * into b from private.finviant_ai_attempt_budget where business_id=p_business_id and period=period_start and kind=p_kind for update;
 limit_value:=limit_value*6;
 next_attempt:=b.attempts+1;
 if next_attempt>limit_value then raise exception 'AI_ATTEMPT_BUDGET_EXHAUSTED' using errcode='P0001'; end if;
 if b.minute_start>now()-interval '1 minute' and b.minute_attempts>=10 then raise exception 'AI_RATE_LIMIT' using errcode='P0001'; end if;
 update private.finviant_ai_attempt_budget set attempts=next_attempt,
 minute_attempts=case when b.minute_start<=now()-interval '1 minute' then 1 else b.minute_attempts+1 end,
 minute_start=case when b.minute_start<=now()-interval '1 minute' then now() else b.minute_start end
 where business_id=p_business_id and period=period_start and kind=p_kind;
 return jsonb_build_object('reserved',true,'remaining',limit_value-next_attempt,'period',period_start);
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_document_email(p_actor uuid, p_business uuid, p_kind text, p_document uuid, p_request uuid, p_origin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o private.finviant_email_outbox%rowtype;d jsonb;b record;c record;items_text text;body_text text;subj text;label text;number text;tok text;approval_url text;plan_name text;new_payload jsonb;
begin
 if not private.member_module_access(p_business,p_actor,'billing') then raise exception 'Billing access denied' using errcode='42501';end if;
 if p_actor is null or p_request is null or p_document is null or p_kind is null or p_kind not in('invoice','estimate','change_order') then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if p_origin is null or p_origin not in('https://finviant.com','https://www.finviant.com','https://app.finviant.com') then raise exception 'INVALID_APP_ORIGIN' using errcode='22023';end if;
 if not exists(select 1 from public.business_members where business_id=p_business and user_id=p_actor and role in('owner','admin','office')) or not exists(select 1 from public.user_agreement_acceptances where user_id=p_actor and terms_accepted and ai_disclosure_acknowledged and electronic_records_consent) then raise exception 'ACCESS_DENIED' using errcode='42501';end if;
 plan_name:=private.effective_plan(p_business);
 if plan_name is distinct from 'pro' then raise exception 'PAID_FEATURE_REQUIRED' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-email:'||p_business::text,0));
 select * into o from private.finviant_email_outbox where id=p_request;
 if found then if o.business_id<>p_business or o.document_kind<>p_kind or o.document_id<>p_document then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;return jsonb_build_object('id',o.id,'status',o.status);end if;
 select * into o from private.finviant_email_outbox where business_id=p_business and document_kind=p_kind and document_id=p_document and status in('queued','sending','uncertain','reconciliation_required') order by created_at desc limit 1;
 if found then return jsonb_build_object('id',o.id,'status',o.status);end if;
 if (select count(*) from private.finviant_email_outbox where business_id=p_business and created_at>now()-interval '1 hour')>=100 then raise exception 'EMAIL_RATE_LIMIT' using errcode='P0001';end if;
 select name,email,phone,currency into b from public.businesses where id=p_business;if not found then raise exception 'BUSINESS_NOT_FOUND' using errcode='P0002';end if;
 if p_kind='invoice' then
  select jsonb_build_object('customer_id',customer_id,'number',invoice_number,'status',status,'total',total,'amount_paid',amount_paid,'balance_due',balance_due,'issue_date',issue_date,'due_date',due_date,'customer_message',customer_message,'issuer_snapshot',issuer_snapshot,'payment_links',payment_links,'payment_instructions',payment_instructions) into d from public.invoices where id=p_document and business_id=p_business for update;
  select string_agg(description||' | Qty '||quantity::text||' x '||unit_price::text||' | Tax '||tax_rate::text||'%',E'\n' order by sort_order,id) into items_text from public.invoice_items where invoice_id=p_document and business_id=p_business;label:='Invoice';
 elsif p_kind='estimate' then
  select jsonb_build_object('customer_id',customer_id,'number',estimate_number,'status',status,'total',total,'issue_date',issue_date,'customer_message',customer_message,'issuer_snapshot',issuer_snapshot) into d from public.estimates where id=p_document and business_id=p_business for update;
  select string_agg(description||' | Qty '||quantity::text||' x '||unit_price::text||' | Tax '||tax_rate::text||'%',E'\n' order by sort_order,id) into items_text from public.estimate_items where estimate_id=p_document and business_id=p_business;label:='Estimate';
 else
  select jsonb_build_object('customer_id',customer_id,'number',change_order_number,'status',status,'total',total,'issue_date',issue_date,'customer_message',customer_message,'title',title,'schedule_impact_days',schedule_impact_days,'issuer_snapshot',issuer_snapshot) into d from public.change_orders where id=p_document and business_id=p_business for update;
  select string_agg(description||' | Qty '||quantity::text||' x '||unit_price::text||' | Tax '||tax_rate::text||'%',E'\n' order by sort_order,id) into items_text from public.change_order_items where change_order_id=p_document and business_id=p_business;label:='Change order';
 end if;
 if d is null then raise exception 'DOCUMENT_NOT_FOUND' using errcode='P0002';end if;
 if d->>'status' in('void','converted','expired','declined','accepted','approved') then raise exception 'DOCUMENT_NOT_SENDABLE' using errcode='23514';end if;
 if items_text is null then raise exception 'LINE_ITEMS_REQUIRED' using errcode='23514';end if;
 select id,first_name,last_name,company,email into c from public.customers where id=(d->>'customer_id')::uuid and business_id=p_business;
 if not found or c.email is null or c.email !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then raise exception 'VALID_RECIPIENT_REQUIRED' using errcode='23514';end if;
 if jsonb_typeof(d->'issuer_snapshot')='object' then b.name:=coalesce(d#>>'{issuer_snapshot,name}',b.name);b.email:=d#>>'{issuer_snapshot,email}';b.phone:=d#>>'{issuer_snapshot,phone}';end if;number:=coalesce(d->>'number',label);subj:=regexp_replace(b.name||': '||label||' '||number,E'[\r\n]',' ','g');
 body_text:=b.name||E'\n'||label||' '||number||E'\n\nHello '||coalesce(nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''),c.company,'Customer')||E',\n\n'||coalesce(d->>'title','')||E'\n'||items_text||E'\n\nTotal: '||coalesce(b.currency,'USD')||' '||(d->>'total')||E'\n'||coalesce(d->>'customer_message','');
 if p_kind='invoice' then
  body_text:=body_text||E'\nPaid: '||coalesce(d->>'amount_paid','0')||E'\nBalance due: '||coalesce(d->>'balance_due','0')||E'\nDue date: '||coalesce(d->>'due_date','Contact the business')||E'\n'||coalesce(d->>'payment_instructions','')||E'\nPayments are handled by the business directly with its external provider. Include the invoice number with payment.'||coalesce((select string_agg(E'\nPay with '||(l->>'provider')||': '||private.invoice_payment_url(l->>'provider',l->>'url',(d->>'balance_due')::numeric,number,coalesce(b.currency,'USD')),'' order by l->>'provider') from jsonb_array_elements(coalesce(d->'payment_links','[]'::jsonb)) l where coalesce((d->>'balance_due')::numeric,0)>0),'');

 else
  tok:=encode(extensions.gen_random_bytes(32),'hex');approval_url:=p_origin||'/?approval='||tok;
  insert into public.document_approval_links(business_id,document_type,estimate_id,change_order_id,token_hash,expires_at,created_by_user_id) values(p_business,p_kind,case when p_kind='estimate' then p_document end,case when p_kind='change_order' then p_document end,encode(sha256(convert_to(tok,'UTF8')),'hex'),now()+interval '14 days',p_actor);
  body_text:=body_text||E'\n\nReview the scope, amount and terms: '||approval_url||E'\nThis private review link expires in 14 days.';

 end if;
 new_payload:=jsonb_build_object('from','Finviant Office <adminsupport@finviant.com>','to',jsonb_build_array(btrim(c.email)),'subject',subj,'text',body_text,'tags',jsonb_build_array(jsonb_build_object('name','finviant_request_id','value',p_request::text)));
 if p_kind='invoice' then new_payload:=new_payload||jsonb_build_object('html','<div style="font-family:Arial,sans-serif;color:#193843"><pre style="white-space:pre-wrap;font-family:inherit">'||private.html_escape(body_text)||'</pre>'||coalesce((select string_agg('<a style="display:inline-block;padding:12px 18px;margin:6px;border:1px solid #b7d7ce;border-radius:8px;color:#174d43;text-decoration:none" href="'||private.html_escape(private.invoice_payment_url(l->>'provider',l->>'url',(d->>'balance_due')::numeric,number,coalesce(b.currency,'USD')))||'">Pay with '||private.html_escape(case l->>'provider' when 'paypal' then 'PayPal' when 'venmo' then 'Venmo' when 'cashapp' then 'Cash App' when 'stripe' then 'Stripe' else 'Payment provider' end)||'</a>','' order by l->>'provider') from jsonb_array_elements(coalesce(d->'payment_links','[]'::jsonb)) l where coalesce((d->>'balance_due')::numeric,0)>0),'')||'</div>');end if;
 if b.email is not null and b.email ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then new_payload:=new_payload||jsonb_build_object('reply_to',jsonb_build_array(b.email));end if;
 insert into public.messages(id,business_id,customer_id,invoice_id,estimate_id,change_order_id,direction,channel,recipient,subject,body,provider,status) values(p_request,p_business,c.id,case when p_kind='invoice' then p_document end,case when p_kind='estimate' then p_document end,case when p_kind='change_order' then p_document end,'outbound','email',c.email,subj,body_text,'resend','queued');
 insert into private.finviant_email_outbox(id,business_id,actor_id,document_kind,document_id,payload) values(p_request,p_business,p_actor,p_kind,p_document,new_payload);
 return jsonb_build_object('id',p_request,'status','queued');
end;$function$;

CREATE OR REPLACE FUNCTION public.prepare_invoice_reminder_email(p_actor uuid, p_business uuid, p_document uuid, p_request uuid, p_review jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare reviewed jsonb;o private.finviant_email_outbox%rowtype;payload jsonb;reply text;
begin
 if p_actor is null or p_request is null or private.member_module_access(p_business,p_actor,'billing') is distinct from true or not exists(select 1 from public.business_members where business_id=p_business and user_id=p_actor and role in('owner','admin','office')) then raise exception 'Billing access required.' using errcode='42501';end if;
 if not exists(select 1 from public.user_agreement_acceptances where user_id=p_actor and terms_accepted and ai_disclosure_acknowledged and electronic_records_consent) or private.effective_plan(p_business)<>'pro' then raise exception 'Verified account and active plan required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-email:'||p_business::text,0));
 perform 1 from public.invoices where id=p_document and business_id=p_business for update;
 if not found then raise exception 'Invoice unavailable.' using errcode='42501';end if;
 select * into o from private.finviant_email_outbox where id=p_request;
 if found then
  if o.business_id<>p_business or o.document_kind<>'invoice' or o.document_id<>p_document or o.payload->>'subject' is distinct from p_review->>'subject' or o.payload->>'text' is distinct from p_review->>'body' or lower(o.payload#>>'{to,0}') is distinct from lower(p_review->>'email') then raise exception 'Reminder request changed. Review the saved request.' using errcode='23505';end if;
  if o.status in('accepted','delivered') then return jsonb_build_object('id',o.id,'status',o.status);end if;
 end if;
 perform 1 from public.customers where business_id=p_business and id=(select customer_id from public.invoices where id=p_document and business_id=p_business) for update;
 reviewed:=private.invoice_reminder_review(p_actor,p_business,p_document);
 if p_review is null or (reviewed-'last_reminder') is distinct from (p_review-'last_reminder') then raise exception 'Invoice or customer details changed. Reload the reminder before sending.' using errcode='23514';end if;
 if coalesce(reviewed->>'email','') !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then raise exception 'Add a valid customer email first.' using errcode='23514';end if;
 if o.id is not null then return jsonb_build_object('id',o.id,'status',o.status);end if;
 if exists(select 1 from private.finviant_email_outbox where business_id=p_business and document_kind='invoice' and document_id=p_document and status in('queued','sending','uncertain','reconciliation_required')) then raise exception 'An invoice email is still pending. Check its activity before sending another.' using errcode='23514';end if;
 if (select count(*) from private.finviant_email_outbox where business_id=p_business and created_at>now()-interval '1 hour')>=100 then raise exception 'Email rate limit reached.';end if;
 payload:=jsonb_build_object('from','Finviant Office <adminsupport@finviant.com>','to',jsonb_build_array(reviewed->>'email'),'subject',reviewed->>'subject','text',reviewed->>'body','tags',jsonb_build_array(jsonb_build_object('name','finviant_request_id','value',p_request::text)));
 select coalesce(i.issuer_snapshot->>'email',b.email) into reply from public.invoices i join public.businesses b on b.id=i.business_id where i.id=p_document and i.business_id=p_business;
 if reply ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then payload:=payload||jsonb_build_object('reply_to',jsonb_build_array(reply));end if;
 insert into public.messages(id,business_id,customer_id,invoice_id,direction,channel,recipient,subject,body,provider,status) values(p_request,p_business,(reviewed->>'customer_id')::uuid,p_document,'outbound','email',reviewed->>'email',reviewed->>'subject',reviewed->>'body','resend','queued');
 insert into private.finviant_email_outbox(id,business_id,actor_id,document_kind,document_id,payload) values(p_request,p_business,p_actor,'invoice',p_document,payload);
 return jsonb_build_object('id',p_request,'status','queued');
end $function$;

CREATE OR REPLACE FUNCTION public.prepare_scheduling_email(p_offer uuid, p_actor uuid, p_request uuid, p_token text, p_origin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o private.scheduling_offers%rowtype;existing private.finviant_email_outbox%rowtype;c record;b record;link text;body text;subject text;payload jsonb;
begin
 if p_request is null or p_token is null or p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_origin is null or p_origin not in('https://finviant.com','https://www.finviant.com') then raise exception 'Invalid scheduling message.' using errcode='22023';end if;
 select * into o from private.scheduling_offers where id=p_offer;
 if not found or not private.can_manage_schedule(o.business_id,p_actor) or not private.member_module_access(o.business_id,p_actor,'billing')
 or encode(sha256(convert_to(p_token,'UTF8')),'hex')<>o.token_hash then raise exception 'Scheduling message access denied.' using errcode='42501';end if;
 if o.status<>'approved' or o.expires_at<=now() then raise exception 'Review fresh appointment options before sending.' using errcode='23514';end if;
 if private.effective_plan(o.business_id)<>'pro' then
 raise exception 'Customer email requires an activated plan.' using errcode='42501';end if;
 if not exists(select 1 from public.user_agreement_acceptances where user_id=p_actor and terms_accepted and ai_disclosure_acknowledged and electronic_records_consent) then
 raise exception 'Review the account agreement before sending customer email.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-email:'||o.business_id::text,0));
 select * into existing from private.finviant_email_outbox where id=p_request;
 if found then if existing.business_id<>o.business_id or existing.document_kind<>'schedule' or existing.document_id<>o.id then raise exception 'This message identifier was already used.' using errcode='23505';end if;
 return jsonb_build_object('id',existing.id,'status',existing.status);end if;
 select * into existing from private.finviant_email_outbox where business_id=o.business_id and document_kind='schedule' and document_id=o.id order by created_at desc limit 1;
 if found then return jsonb_build_object('id',existing.id,'status',existing.status);end if;
 if(select count(*) from private.finviant_email_outbox where business_id=o.business_id and created_at>now()-interval '1 hour')>=100 then raise exception 'Email limit reached. Try later.' using errcode='P0001';end if;
 select customer_row.* into c from public.estimates e join public.customers customer_row on customer_row.id=e.customer_id and customer_row.business_id=e.business_id where e.id=o.estimate_id;
 if c.email is null or c.email !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then raise exception 'Add a valid customer email before sending.' using errcode='23514';end if;
 if c.email is distinct from o.recipient_email then raise exception 'The customer email changed. Review new appointment options before sending.' using errcode='23514';end if;
 select name,email into b from public.businesses where id=o.business_id;
 link:=p_origin||'/?booking='||p_token;subject:=regexp_replace(b.name||': choose a time for '||o.title,E'[\r\n]',' ','g');
 body:='Hello '||coalesce(nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''),c.company,'Customer')||E',\n\nYour estimate is approved. Please choose a time for '||o.title||E'.\n\n'||o.customer_note||E'\n\nChoose and confirm your appointment: '||link||E'\n\nTimes are checked again when you confirm. If none suit you, contact '||b.name||E'.\nThis private invitation expires '||to_char(o.expires_at at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC.';
 payload:=jsonb_build_object('from','Finviant Office <adminsupport@finviant.com>','to',jsonb_build_array(btrim(c.email)),'subject',subject,'text',body,
 'html','<!doctype html><html lang="en"><body style="font-family:Arial,sans-serif;color:#193843;line-height:1.6"><h1>Choose your appointment</h1><p>'||private.html_escape(b.name)||' has reviewed appointment options for '||private.html_escape(o.title)||'.</p><p>'||private.html_escape(o.customer_note)||'</p><p><a href="'||private.html_escape(link)||'" style="background:#174d43;color:white;padding:14px 20px;display:inline-block;border-radius:8px">Choose an appointment</a></p><p>Times are confirmed when you book. If no time works, contact the business.</p></body></html>',
 'tags',jsonb_build_array(jsonb_build_object('name','finviant_request_id','value',p_request::text)));
 if b.email is not null and b.email ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then payload:=payload||jsonb_build_object('reply_to',b.email);end if;
 insert into public.messages(id,business_id,estimate_id,direction,channel,recipient,subject,body,provider,status)
 values(p_request,o.business_id,o.estimate_id,'outbound','email',c.email,subject,body,'resend','queued');
 insert into private.finviant_email_outbox(id,business_id,actor_id,document_kind,document_id,payload) values(p_request,o.business_id,p_actor,'schedule',o.id,payload);
 return jsonb_build_object('id',p_request,'status','queued');
end $function$;

alter table private.finviant_email_outbox add column customer_snapshot jsonb;

CREATE OR REPLACE FUNCTION public.claim_document_email(p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o private.finviant_email_outbox%rowtype;lease uuid:=gen_random_uuid();begin
 select * into o from private.finviant_email_outbox where id=p_request for update;if not found then raise exception 'SEND_NOT_FOUND' using errcode='P0002';end if;
 if o.status in('accepted','delivered') then return jsonb_build_object('id',o.id,'status',o.status,'provider_id',o.provider_id,'recipient',o.payload->'to'->>0);end if;
 if o.customer_snapshot is not null and (o.customer_snapshot-'status'-'finviant_branding') is distinct from (private.customer_document_snapshot(o.business_id,case when o.document_kind='invoice_reminder' then 'invoice' else o.document_kind end,o.document_id)-'status'-'finviant_branding') then update private.finviant_email_outbox set status='reconciliation_required',last_code='document_changed' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if o.document_kind='schedule' and not exists(select 1 from private.scheduling_offers x join public.estimates e on e.id=x.estimate_id and e.business_id=x.business_id join public.customers c on c.id=e.customer_id and c.business_id=e.business_id
 where x.id=o.document_id and x.business_id=o.business_id and x.status='approved' and x.expires_at>now() and x.recipient_email=c.email and private.can_manage_schedule(x.business_id,o.actor_id)) then
 update private.finviant_email_outbox set status='reconciliation_required',last_code='schedule_changed' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if o.status in('failed','reconciliation_required') then return jsonb_build_object('id',o.id,'status',o.status);end if;
 if not private.member_module_access(o.business_id,o.actor_id,'billing') then update private.finviant_email_outbox set status='reconciliation_required',last_code='access_revoked' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if not exists(select 1 from public.business_members where business_id=o.business_id and user_id=o.actor_id and role in('owner','admin','office')) then update private.finviant_email_outbox set status='reconciliation_required',last_code='access_revoked' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if (private.effective_plan(o.business_id)<>'pro' or not coalesce((select email_active from private.managed_delivery_accounts where business_id=o.business_id),false)) then update private.finviant_email_outbox set status='reconciliation_required',last_code='entitlement_expired' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if; if o.created_at<now()-interval '23 hours' or o.attempts>=5 then update private.finviant_email_outbox set status='reconciliation_required' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if (o.lease_until>now()) or o.next_attempt_at>now() then return jsonb_build_object('id',o.id,'status','busy');end if;
 update private.finviant_email_outbox set status='sending',attempts=attempts+1,lease_id=lease,lease_until=now()+interval '2 minutes' where id=o.id;
 return jsonb_build_object('id',o.id,'status','claimed','lease',lease,'payload',o.payload);end;$function$;
create function private.enforce_managed_email() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if private.effective_plan(new.business_id)<>'pro' or not coalesce((select email_active from private.managed_delivery_accounts where business_id=new.business_id),false) then
 raise exception 'Business Pro and activated Finviant email sending are required. Use your personal app while setup is pending.' using errcode='42501';end if;
 if new.document_kind in('invoice','estimate','change_order','invoice_reminder') then new.customer_snapshot:=private.customer_document_snapshot(new.business_id,case when new.document_kind='invoice_reminder' then 'invoice' else new.document_kind end,new.document_id);end if;
 perform private.reserve_tier_usage(new.business_id,new.id,'email',jsonb_array_length(new.payload->'to'));
 return new;
end $$;
revoke all on function private.enforce_managed_email() from public,anon,authenticated,service_role;
create trigger enforce_managed_email before insert on private.finviant_email_outbox for each row execute function private.enforce_managed_email();

-- Only customer-facing fields are exposed by bearer links; never internal notes.
create table private.document_shares (
 token_hash text primary key, business_id uuid not null references public.businesses(id) on delete cascade,
 kind text not null check(kind in('invoice','estimate','change_order')), document_id uuid not null,
 actor_id uuid not null references auth.users(id),snapshot jsonb not null,approval_token text,
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '30 days',revoked_at timestamptz
);
create index document_shares_business on private.document_shares(business_id,kind,document_id);
create index document_shares_actor on private.document_shares(actor_id);
alter table private.document_shares enable row level security;
revoke all on private.document_shares from public,anon,authenticated,service_role;
create policy no_client_access on private.document_shares to authenticated using(false);
create function private.customer_document_snapshot(b uuid,k text,d uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare doc jsonb; lines jsonb; c jsonb;company jsonb;t text;fk text;
begin
 if k not in('invoice','estimate','change_order') then raise exception 'Invalid document';end if;
 t:=case k when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end;
 fk:=k||'_id';
 execute format('select to_jsonb(x) from public.%I x where business_id=$1 and id=$2',t) into doc using b,d;
 if doc is null then raise exception 'Document unavailable' using errcode='42501';end if;
 execute format('select coalesce(jsonb_agg(jsonb_build_object(''description'',description,''quantity'',quantity,''unit_price'',unit_price,''tax_rate'',tax_rate,''line_total'',line_total) order by sort_order,id),''[]''::jsonb) from public.%I where business_id=$1 and %I=$2',k||'_items',fk) into lines using b,d;
 select jsonb_build_object('name',coalesce(nullif(btrim(concat_ws(' ',first_name,last_name)),''),customers.company,'Customer'),'email',email,'phone',phone) into c from public.customers where business_id=b and id=(doc->>'customer_id')::uuid;
 select jsonb_build_object('name',name,'email',email,'phone',phone,'address_line1',address_line1,'city',city,'state',state,'postal_code',postal_code) into company from public.businesses where id=b;
 if jsonb_typeof(doc->'issuer_snapshot')='object' then company:=jsonb_build_object('name',doc#>>'{issuer_snapshot,name}','email',doc#>>'{issuer_snapshot,email}','phone',doc#>>'{issuer_snapshot,phone}','address_line1',doc#>>'{issuer_snapshot,address_line1}','city',doc#>>'{issuer_snapshot,city}','state',doc#>>'{issuer_snapshot,state}','postal_code',doc#>>'{issuer_snapshot,postal_code}');end if;
 return jsonb_build_object('kind',k,'number',doc->>(k||'_number'),'status',doc->>'status','issue_date',doc->>'issue_date','due_date',doc->>'due_date','expires_on',doc->>'expires_on',
 'subtotal',doc->'subtotal','tax_amount',doc->'tax_amount','total',doc->'total','balance_due',doc->'balance_due','amount_paid',doc->'amount_paid',
 'customer_message',doc->>'customer_message','payment_links',case when k='invoice' then coalesce(doc->'payment_links','[]') else '[]'::jsonb end,
 'payment_instructions',case when k='invoice' then doc->>'payment_instructions' end,'title',doc->>'title','items',lines,'customer',c,'company',company,'finviant_branding',private.effective_plan(b)='free');
end $$;
create function public.prepare_personal_document(p_business uuid,p_kind text,p_document uuid,p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare snap jsonb;hash text;approval text;old private.document_shares;
begin
 if not private.fin_access(p_business,case p_kind when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end,true) or p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Document access denied' using errcode='42501';end if;
 hash:=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 select * into old from private.document_shares where token_hash=hash;
 if found then
  if old.business_id<>p_business or old.document_id<>p_document or old.kind<>p_kind or old.actor_id<>auth.uid() then raise exception 'Share identifier conflict' using errcode='42501';end if;
  if old.revoked_at is not null or old.expires_at<=now() then raise exception 'Link expired. Prepare a new link.';end if;
  return jsonb_build_object('snapshot',old.snapshot,'expires_at',old.expires_at);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('document-share:'||p_business::text,0));
 if (select count(*) from private.document_shares where business_id=p_business and created_at>now()-interval '1 hour')>=100 then raise exception 'Please reuse an existing link or try later.';end if;
 snap:=private.customer_document_snapshot(p_business,p_kind,p_document);
 if snap->>'status' in('void','expired','declined','converted','accepted','approved') or jsonb_array_length(snap->'items')=0 then raise exception 'This document cannot be shared. Review its status and line items.' using errcode='23514';end if;
 if p_kind in('estimate','change_order') then
  approval:=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.document_approval_links(business_id,document_type,estimate_id,change_order_id,token_hash,expires_at,created_by_user_id)
  values(p_business,p_kind,case when p_kind='estimate' then p_document end,case when p_kind='change_order' then p_document end,encode(sha256(convert_to(approval,'UTF8')),'hex'),now()+interval '30 days',auth.uid());
 end if;
 insert into private.document_shares(token_hash,business_id,kind,document_id,actor_id,snapshot,approval_token) values(hash,p_business,p_kind,p_document,auth.uid(),snap,approval);
 return jsonb_build_object('snapshot',snap,'expires_at',now()+interval '30 days');
end $$;
create function public.get_shared_document(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.document_shares;snap jsonb;
begin
 if p_token is null or p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Link unavailable' using errcode='42501';end if;
 select * into s from private.document_shares where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and revoked_at is null and expires_at>now();
 if not found then raise exception 'This link is expired or unavailable.' using errcode='42501';end if;
 snap:=private.customer_document_snapshot(s.business_id,s.kind,s.document_id)||jsonb_build_object('finviant_branding',s.snapshot->'finviant_branding');
 -- Quotes must still match the shared scope and amount. Changes require a fresh link.
 if (snap-'status'-'balance_due'-'amount_paid') is distinct from (s.snapshot-'status'-'balance_due'-'amount_paid') then raise exception 'This document changed. Request a fresh link from the business.' using errcode='23514';end if;
 if snap->>'status'='void' then raise exception 'This document was voided.';end if;
 return snap||jsonb_build_object('approval_token',case when snap->>'status'='sent' then s.approval_token end,'expires_at',s.expires_at);
end $$;
create function public.confirm_personal_document_sent(p_business uuid,p_token text,p_channel text) returns void language plpgsql security definer set search_path='' as $$
declare s private.document_shares;current_snap jsonb;t text;
begin
 if p_channel is null or p_channel not in('email','sms') then raise exception 'Invalid channel';end if;
 select * into s from private.document_shares where business_id=p_business and token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and actor_id=auth.uid() and revoked_at is null and expires_at>now() for update;
 if not found or not private.fin_access(p_business,case s.kind when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end,true) then raise exception 'Not authorized' using errcode='42501';end if;
 current_snap:=private.customer_document_snapshot(p_business,s.kind,s.document_id)||jsonb_build_object('finviant_branding',s.snapshot->'finviant_branding');
 if (current_snap-'status'-'balance_due'-'amount_paid') is distinct from (s.snapshot-'status'-'balance_due'-'amount_paid') then raise exception 'Document changed. Prepare a fresh draft.';end if;
 t:=case s.kind when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end;
 execute format('update public.%I set status=''sent'' where id=$1 and business_id=$2 and status=''draft''',t) using s.document_id,p_business;
 -- This is an owner-reported send, not a provider delivery receipt.
 if not exists(select 1 from public.messages where business_id=p_business and provider_message_id=s.token_hash and provider='personal_app') then
  insert into public.messages(business_id,customer_id,invoice_id,estimate_id,change_order_id,direction,channel,recipient,subject,body,provider,provider_message_id,status,sent_at)
  values(p_business,(case s.kind when 'invoice' then (select customer_id from public.invoices where id=s.document_id) when 'estimate' then (select customer_id from public.estimates where id=s.document_id) else (select customer_id from public.change_orders where id=s.document_id) end),
  case when s.kind='invoice' then s.document_id end,case when s.kind='estimate' then s.document_id end,case when s.kind='change_order' then s.document_id end,'outbound',p_channel,
  coalesce(s.snapshot#>>array['customer',case when p_channel='email' then 'email' else 'phone' end],''),'Owner reported personal-app send','Owner confirmed sending through their own app. Delivery is not verified.','personal_app',s.token_hash,'sent',now());
 end if;
end $$;
revoke all on function private.customer_document_snapshot(uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.prepare_personal_document(uuid,text,uuid,text),public.confirm_personal_document_sent(uuid,text,text),public.get_shared_document(text) from public,anon,authenticated,service_role;
grant execute on function public.prepare_personal_document(uuid,text,uuid,text),public.confirm_personal_document_sent(uuid,text,text) to authenticated;
grant execute on function public.get_shared_document(text) to anon,authenticated;

revoke all on function public.prepare_document_email(uuid,uuid,text,uuid,uuid,text),public.claim_document_email(uuid),public.prepare_invoice_reminder_email(uuid,uuid,uuid,uuid,jsonb),public.prepare_scheduling_email(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.prepare_document_email(uuid,uuid,text,uuid,uuid,text),public.claim_document_email(uuid),public.prepare_invoice_reminder_email(uuid,uuid,uuid,uuid,jsonb),public.prepare_scheduling_email(uuid,uuid,uuid,text,text) to service_role;

-- Queueing is not a send. Advance the document only after provider acceptance.
create function private.mark_managed_document_sent() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in('accepted','delivered') and old.status not in('accepted','delivered') and new.document_kind in('invoice','estimate','change_order') then
  execute format('update public.%I set status=''sent'' where business_id=$1 and id=$2 and status=''draft''',case new.document_kind when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end) using new.business_id,new.document_id;
 end if;return new;
end $$;
revoke all on function private.mark_managed_document_sent() from public,anon,authenticated,service_role;
create trigger mark_managed_document_sent after update of status on private.finviant_email_outbox for each row execute function private.mark_managed_document_sent();
