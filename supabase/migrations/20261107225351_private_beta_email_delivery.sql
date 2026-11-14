-- Restricted beta delivery is opt-in and independent of production delivery.
insert into private.workspace_feature_flags(name,enabled)
values ('private_beta_email_delivery',false) on conflict do nothing;

create table private.private_beta_email_recipients (
 business_id uuid not null references public.businesses(id) on delete cascade,
 email text not null,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 primary key (business_id,email),
 check (email=lower(btrim(email)) and length(email)<=254 and
        email ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$')
);
alter table private.private_beta_email_recipients enable row level security;
revoke all on private.private_beta_email_recipients from public,anon,authenticated,service_role;

create function private.private_beta_email_payload_allowed(p_business uuid,p_payload jsonb)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare sender text; field text; recipients jsonb; recipient jsonb; address text;
begin
 if not coalesce((select enabled from private.workspace_feature_flags where name='private_beta_email_delivery'),false)
 or not coalesce((select enabled from private.workspace_feature_flags where name='ten_pro_test_accounts'),false)
 or not exists(select 1 from public.businesses b
   join private.test_account_slots s on s.user_id=b.created_by_user_id
   join auth.users u on u.id=s.user_id
   where b.id=p_business and u.email_confirmed_at is not null and
    u.email ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$')
 or private.effective_plan(p_business)<>'pro' then return false;end if;
 select m.reply_to into sender from private.managed_delivery_accounts m
 where m.business_id=p_business and m.email_active;
 if sender is null or sender !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$'
 or not exists(select 1 from private.private_beta_email_recipients r
   where r.business_id=p_business and r.email=lower(btrim(sender)) and r.active)
 or jsonb_typeof(p_payload) is distinct from 'object' then return false;end if;
 if jsonb_typeof(p_payload->'to') is distinct from 'array'
 or jsonb_typeof(p_payload->'reply_to') is distinct from 'array' then return false;end if;
 if jsonb_array_length(p_payload->'to')=0
 or jsonb_array_length(p_payload->'reply_to')<>1
 or jsonb_typeof(p_payload->'reply_to'->0) is distinct from 'string'
 or lower(btrim(p_payload->'reply_to'->>0))<>lower(btrim(sender)) then return false;end if;
 foreach field in array array['to','cc','bcc'] loop
  if not (p_payload ? field) then continue;end if;
  recipients:=p_payload->field;
  if jsonb_typeof(recipients) is distinct from 'array' then return false;end if;
  for recipient in select value from jsonb_array_elements(recipients) loop
   if jsonb_typeof(recipient) is distinct from 'string' then return false;end if;
   address:=lower(btrim(recipient #>> '{}'));
   if length(address)>254 or address !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$'
   or (address not in ('delivered@resend.dev','bounced@resend.dev','complained@resend.dev')
    and not exists(select 1 from private.private_beta_email_recipients r
      where r.business_id=p_business and r.email=address and r.active)) then return false;end if;
  end loop;
 end loop;
 return true;
end $$;
revoke all on function private.private_beta_email_payload_allowed(uuid,jsonb) from public,anon,authenticated,service_role;

create function private.private_beta_email_request_allowed(p_request uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select private.private_beta_email_payload_allowed(o.business_id,o.payload)
  from private.finviant_email_outbox o where o.id=p_request),false);
$$;
revoke all on function private.private_beta_email_request_allowed(uuid) from public,anon,authenticated,service_role;
grant execute on function private.private_beta_email_request_allowed(uuid) to service_role;

-- The exposed wrapper has no definer privileges and returns only a decision.
create function public.private_beta_email_recipient_allowed(p_request uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select private.private_beta_email_request_allowed(p_request);
$$;
revoke all on function public.private_beta_email_recipient_allowed(uuid) from public,anon,authenticated;
grant execute on function public.private_beta_email_recipient_allowed(uuid) to service_role;

create function private.guard_private_beta_email() returns trigger
language plpgsql security definer set search_path='' as $$
declare sender text;
begin
 if not coalesce((select enabled from private.workspace_feature_flags where name='private_beta_email_delivery'),false) then return new;end if;
 if jsonb_typeof(new.payload) is distinct from 'object' then
  raise exception 'BETA_EMAIL_RECIPIENT_NOT_APPROVED' using errcode='42501';
 end if;
 select m.reply_to into sender from private.managed_delivery_accounts m
 where m.business_id=new.business_id and m.email_active;
 -- Replies may only route to the approved activated sender, never a supplied override.
 new.payload:=jsonb_set(new.payload,'{reply_to}',jsonb_build_array(sender),true);
 if not private.private_beta_email_payload_allowed(new.business_id,new.payload) then
  raise exception 'BETA_EMAIL_RECIPIENT_NOT_APPROVED' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function private.guard_private_beta_email() from public,anon,authenticated,service_role;
-- PostgreSQL runs same-kind triggers alphabetically. Reject before usage is reserved.
create trigger beta_email_recipient_guard before insert on private.finviant_email_outbox
for each row execute function private.guard_private_beta_email();

-- Administrator-only enrollment; business creation invokes it after test Pro is granted.
create function private.enroll_private_beta_email(p_business uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare address text;
begin
 if not coalesce((select enabled from private.workspace_feature_flags where name='private_beta_email_delivery'),false)
 or not coalesce((select enabled from private.workspace_feature_flags where name='ten_pro_test_accounts'),false) then return false;end if;
 select lower(btrim(u.email)) into address from public.businesses b
 join private.test_account_slots s on s.user_id=b.created_by_user_id
 join auth.users u on u.id=s.user_id
 where b.id=p_business and u.email_confirmed_at is not null;
 if address is null or length(address)>254 or address !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then return false;end if;
 insert into private.private_beta_email_recipients(business_id,email) values(p_business,address)
 on conflict(business_id,email) do update set active=true;
 insert into private.managed_delivery_accounts(business_id,email_active,reply_to,activated_at)
 values(p_business,true,address,now())
 on conflict(business_id) do update set email_active=true,reply_to=excluded.reply_to,
 activated_at=coalesce(private.managed_delivery_accounts.activated_at,excluded.activated_at);
 return true;
end $$;
revoke all on function private.enroll_private_beta_email(uuid) from public,anon,authenticated,service_role;
grant execute on function private.enroll_private_beta_email(uuid) to postgres;

create function private.enroll_new_private_beta_email() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform private.enroll_private_beta_email(new.id);
 return new;
end $$;
revoke all on function private.enroll_new_private_beta_email() from public,anon,authenticated,service_role;
create trigger zz_enroll_private_beta_email after insert on public.businesses
for each row execute function private.enroll_new_private_beta_email();
