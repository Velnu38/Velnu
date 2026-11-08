-- The owner's existing administrator identity is the only beta tier-test exception.
create table private.beta_tier_test_admins(user_id uuid primary key references auth.users(id) on delete cascade);
alter table private.beta_tier_test_admins enable row level security;
revoke all on private.beta_tier_test_admins from public,anon,authenticated,service_role;
insert into private.beta_tier_test_admins(user_id)
select u.id from auth.users u join private.platform_operators p on p.user_id=u.id and p.active
where lower(u.email)='mbarone5@verizon.net' and u.email_confirmed_at is not null;
create or replace function private.can_test_tiers(b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.is_primary_owner(b)
 and coalesce((select enabled from private.workspace_feature_flags where name='tier_testing'),false)
 and exists(select 1 from private.beta_tier_test_admins a join private.platform_operators p on p.user_id=a.user_id and p.active where a.user_id=auth.uid());
$$;
create function private.beta_business_plan_locked(b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select enabled from private.workspace_feature_flags where name='ten_pro_test_accounts'),false)
 and exists(select 1 from public.businesses x join private.test_account_slots s on s.user_id=x.created_by_user_id where x.id=b)
 and not exists(select 1 from public.businesses x join private.beta_tier_test_admins a on a.user_id=x.created_by_user_id join private.platform_operators p on p.user_id=a.user_id and p.active where x.id=b);
$$;
revoke all on function private.beta_business_plan_locked(uuid) from public,anon,authenticated,service_role;
create or replace function private.effective_plan(b uuid) returns text language sql stable security definer set search_path='' as $$
 select coalesce((select o.tier from private.tier_test_overrides o
 join private.workspace_feature_flags f on f.name='tier_testing' and f.enabled
 join public.businesses x on x.id=o.business_id and x.created_by_user_id=o.actor_id
 join private.beta_tier_test_admins a on a.user_id=o.actor_id
 join private.platform_operators p on p.user_id=a.user_id and p.active
 where o.business_id=b),
 case when private.beta_business_plan_locked(b) then 'pro' end,
 (select plan from private.business_entitlements where business_id=b and (valid_until is null or valid_until>now())),'free');
$$;

create or replace function private.get_plan_usage(target_business_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t text:=private.effective_plan(target_business_id); m date:=date_trunc('month',now() at time zone 'UTC')::date; result jsonb;
begin
 if auth.uid() is null or not private.is_business_member(target_business_id) then raise exception 'Not authorized' using errcode='42501';end if;
 select jsonb_build_object('plan',t,'actual_plan',coalesce((select plan from private.business_entitlements where business_id=target_business_id and(valid_until is null or valid_until>now())),'free'),
 'testing',private.can_test_tiers(target_business_id) and exists(select 1 from private.tier_test_overrides o join private.workspace_feature_flags f on f.name='tier_testing' and f.enabled where o.business_id=target_business_id),
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
 'delivery_mode',case when t in('basic','pro') then 'managed' else 'personal' end,'financial_history',t<>'free') into result;
 return result || jsonb_build_object('beta_locked',private.beta_business_plan_locked(target_business_id));
end $$;
