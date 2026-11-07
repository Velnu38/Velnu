-- Internal testing only. Disabled by default; enable explicitly on staging after seeding existing users.
create table private.test_account_slots (
 slot smallint primary key check (slot between 1 and 10),
 user_id uuid not null unique references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
alter table private.test_account_slots enable row level security;
revoke all on private.test_account_slots from public,anon,authenticated,service_role;
insert into private.workspace_feature_flags(name,enabled) values('ten_pro_test_accounts',false) on conflict do nothing;

create function private.claim_test_account_slot() returns trigger
language plpgsql security definer set search_path='' as $$
declare available smallint;
begin
 if not coalesce((select enabled from private.workspace_feature_flags where name='ten_pro_test_accounts'),false) then return new;end if;
 -- Serialize signups; the 1..10 primary-key domain also gives an absolute database cap.
 perform pg_advisory_xact_lock(710326110310::bigint);
 select n::smallint into available from generate_series(1,10) n
 where not exists(select 1 from private.test_account_slots s where s.slot=n) order by n limit 1;
 if available is null then raise exception 'Private testing is limited to 10 accounts. Contact the test administrator.' using errcode='23514';end if;
 insert into private.test_account_slots(slot,user_id) values(available,new.id);
 insert into public.user_plan_preferences(user_id,selected_tier) values(new.id,'pro')
 on conflict(user_id) do update set selected_tier='pro';
 return new;
end $$;
revoke all on function private.claim_test_account_slot() from public,anon,authenticated,service_role;
create trigger finviant_claim_test_account_slot after insert on auth.users
for each row execute function private.claim_test_account_slot();

create function private.grant_test_business_pro() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if coalesce((select enabled from private.workspace_feature_flags where name='ten_pro_test_accounts'),false)
 and exists(select 1 from private.test_account_slots where user_id=new.created_by_user_id) then
  insert into private.business_entitlements(business_id,plan,valid_until) values(new.id,'pro',null)
  on conflict(business_id) do update set plan='pro',valid_until=null,updated_at=now();
 end if;
 return new;
end $$;
revoke all on function private.grant_test_business_pro() from public,anon,authenticated,service_role;
create trigger finviant_grant_test_business_pro after insert on public.businesses
for each row execute function private.grant_test_business_pro();
