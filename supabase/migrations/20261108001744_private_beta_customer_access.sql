-- Customer document pages may be public without opening beta registration or
-- exposing business tables. Existing test accounts remain authorized.
create table private.private_beta_registration_allowlist (
 email text primary key check (email=lower(btrim(email)) and length(email)<=254),
 allowed boolean not null default true,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now()
);
alter table private.private_beta_registration_allowlist enable row level security;
revoke all on private.private_beta_registration_allowlist from public,anon,authenticated,service_role;
insert into private.private_beta_registration_allowlist(email)
select distinct lower(btrim(email)) from auth.users where email is not null;

create function private.guard_private_beta_registration() returns trigger
language plpgsql security definer set search_path='' as $$
declare token text:=new.raw_user_meta_data->>'finviant_invite';
begin
 if not coalesce((select enabled from private.workspace_feature_flags where name='ten_pro_test_accounts'),false) then return new;end if;
 if exists(select 1 from private.private_beta_registration_allowlist a where a.email=lower(btrim(new.email)) and a.allowed) then return new;end if;
 if token ~ '^[a-f0-9]{64}$' and exists(
  select 1 from private.team_invitations i where i.email=lower(btrim(new.email))
   and i.token_hash=encode(sha256(convert_to(token,'UTF8')),'hex') and i.revoked_at is null
   and i.accepted_at is null and i.expires_at>now()
 ) then return new;end if;
 raise exception 'Finviant private beta requires an approved email or invitation.' using errcode='42501';
end $$;
revoke all on function private.guard_private_beta_registration() from public,anon,authenticated,service_role;
create trigger finviant_private_beta_registration before insert on auth.users
for each row execute function private.guard_private_beta_registration();

create function public.get_private_beta_access() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare enabled boolean;
begin
 if auth.uid() is null then raise exception 'Sign in to open your workspace.' using errcode='42501';end if;
 enabled:=coalesce((select f.enabled from private.workspace_feature_flags f where f.name='ten_pro_test_accounts'),false);
 return jsonb_build_object('private_beta',enabled,'allowed',not enabled or exists(
  select 1 from private.test_account_slots s join auth.users u on u.id=s.user_id
  where s.user_id=auth.uid() and u.email_confirmed_at is not null
 ));
end $$;
revoke all on function public.get_private_beta_access() from public,anon,authenticated,service_role;
grant execute on function public.get_private_beta_access() to authenticated;

create function public.manage_private_beta_registration(p_email text default null,p_allow boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare access jsonb;address text;
begin
 access:=private.platform_admin_request('access','{}'::jsonb);
 if access->>'operator' is distinct from 'true' or access->>'mfa_required' is distinct from 'false' then
  raise exception 'Verify Finviant administrator access.' using errcode='42501';
 end if;
 if p_email is not null then
  address:=lower(btrim(p_email));
  if length(address)>254 or address !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then raise exception 'Enter a valid email.' using errcode='22023';end if;
  insert into private.private_beta_registration_allowlist(email,allowed,created_by) values(address,coalesce(p_allow,false),auth.uid())
  on conflict(email) do update set allowed=excluded.allowed;
  insert into private.platform_admin_audit(actor,action,outcome) values(auth.uid(),'beta_registration_access','allowed');
 end if;
 return jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('email',a.email,'allowed',a.allowed,'registered',exists(select 1 from auth.users u where lower(u.email)=a.email)) order by a.email) from private.private_beta_registration_allowlist a),'[]'::jsonb),'account_limit',10);
end $$;
revoke all on function public.manage_private_beta_registration(text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.manage_private_beta_registration(text,boolean) to authenticated;

-- All anonymous document access goes through narrow token-checked functions,
-- never directly through the business tables or their identity sequences.
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;
