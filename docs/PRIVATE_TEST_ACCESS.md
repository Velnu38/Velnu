# Internal tester access

The staging environment is limited to **10 login accounts total, including the administrator**. This cap includes business owners and team logins; it is separate from the normal five seats per Pro business. The existing owner is the first account. The next nine accounts may register through the protected tester link. No invitations are sent automatically. Anyone holding that link can reach the signup page, so share it directly with selected testers.

Each registered tester's business receives a server-managed Pro entitlement with `valid_until = null`. It does not create a Stripe subscription or require payment. Existing member role permissions, tenant isolation and normal Pro usage quotas remain enforced. Provider credentials and sender configuration are still required for AI, email, SMS and payment tests. Granting Pro does not configure providers or enable unfinished integrations.

The account cap is enforced by an auth-user insert trigger and a private slot table whose unique slot must be between 1 and 10. Signup and allocation succeed or roll back together. Password resets, email confirmation and subsequent sign-ins do not consume another slot. Removing a login releases its slot. Browser clients cannot read or modify slots or grant themselves Pro. Business creation automatically grants Pro to an allocated tester. The feature is disabled by default in source migrations and is enabled only on the private staging database.

Activation (database administrator only, staging `xvybcmyoblfgzokaifsx`):

```sql
begin;
lock table auth.users in share row exclusive mode;
do $$begin
 if (select count(*) from auth.users)>10 then raise exception 'More than 10 accounts already exist; reconcile before activation';end if;
end $$;
insert into private.test_account_slots(slot,user_id)
select row_number() over(order by created_at,id)::smallint,id from auth.users;
insert into public.user_plan_preferences(user_id,selected_tier)
select user_id,'pro' from private.test_account_slots
on conflict(user_id) do update set selected_tier='pro';
insert into private.business_entitlements(business_id,plan,valid_until)
select b.id,'pro',null from public.businesses b join private.test_account_slots s on s.user_id=b.created_by_user_id
on conflict(business_id) do update set plan='pro',valid_until=null,updated_at=now();
update private.workspace_feature_flags set enabled=true where name='ten_pro_test_accounts';
commit;
```

Run activation once after the migration. Do not apply this activation to production. Vercel Authentication stays enabled for all deployments. The tester share link is configured separately with no expiration and can be revoked manually; it does not bypass Finviant login or the account cap. Ordinary sessions and password-reset links retain their security expirations.
