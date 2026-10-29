-- Prevent business-role escalation and protect the original owner record.
-- Normal owner bootstrap during business creation is allowed for its creator.
create or replace function private.velnu_membership_role_guard()
returns trigger language plpgsql security invoker
set search_path = ''
as $fn$
declare acting_user uuid := (select auth.uid());
declare target_bid uuid;
begin
  target_bid := case when tg_op='DELETE' then old.business_id else new.business_id end;

  if acting_user is null then
    -- Backend service-role maintenance and account deletion remain possible.
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  if tg_op='INSERT' and new.role='owner' then
    if not private.has_business_role(target_bid,array['owner']) then
      if new.user_id <> acting_user
        or not exists(
          select 1 from public.businesses b
          where b.id=target_bid and b.created_by_user_id=acting_user
        )
        or exists(
          select 1 from public.business_members m
          where m.business_id=target_bid and m.role='owner'
        )
      then
        raise exception 'Only the business owner may assign an owner role';
      end if;
    end if;
  end if;

  if tg_op='UPDATE' then
    if new.business_id is distinct from old.business_id
      or new.user_id is distinct from old.user_id then
      raise exception 'A business membership cannot be reassigned';
    end if;
    if old.role='owner' and new.role<>'owner' then
      raise exception 'The owner role cannot be removed without a separate ownership transfer';
    end if;
    if old.role<>'owner' and new.role='owner'
      and not private.has_business_role(target_bid,array['owner']) then
      raise exception 'Only the existing owner can grant owner status';
    end if;
  elsif tg_op='DELETE' then
    if old.role='owner' then
      raise exception 'The business owner cannot be deleted without an ownership transfer';
    end if;
    return old;
  end if;

  return new;
end;
$fn$;

drop trigger if exists velnu_membership_role_guard on public.business_members;
create trigger velnu_membership_role_guard
before insert or update or delete on public.business_members
for each row execute function private.velnu_membership_role_guard();
