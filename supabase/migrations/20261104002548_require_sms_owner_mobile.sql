-- SMS setup is separate from signup and the business contact printed on documents.
-- Only Auth's server-owned confirmed phone counts; editable user_metadata never does.
create function private.sms_owner_phone_verified(b uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.is_primary_owner(b) and exists(
  select 1 from auth.users u where u.id=auth.uid()
   and u.email_confirmed_at is not null and u.phone_confirmed_at is not null
   and u.phone ~ '^\+?[1-9][0-9]{7,14}$'
 )
$$;
revoke all on function private.sms_owner_phone_verified(uuid) from public,anon,authenticated,service_role;

create function private.sms_setup_status(b uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare verified boolean;
begin
 if not private.is_primary_owner(b) then raise exception 'Only the primary business owner can set up texting' using errcode='42501';end if;
 verified:=private.sms_owner_phone_verified(b);
 return jsonb_build_object('owner_mobile_verified',verified,
  'phone_last4',case when verified then (select right(phone,4) from auth.users where id=auth.uid()) else null end,
  'customer_sms_enabled',false);
end $$;
create function public.get_sms_setup_status(p_business uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select private.sms_setup_status(p_business)$$;
revoke all on function private.sms_setup_status(uuid),public.get_sms_setup_status(uuid) from public,anon,service_role;
grant execute on function private.sms_setup_status(uuid),public.get_sms_setup_status(uuid) to authenticated;

-- Keep the existing private delivery test behind the same requirement, including
-- direct RPC calls. Existing recorded operations are untouched and never resent.
create function private.require_sms_verified_owner() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.kind='sms' and not private.sms_owner_phone_verified(new.business_id) then
  raise exception 'Verify the primary owner mobile number in Text messaging setup before sending SMS' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function private.require_sms_verified_owner() from public,anon,authenticated,service_role;
create trigger require_sms_verified_owner before insert on private.integration_test_operations
 for each row execute function private.require_sms_verified_owner();

create or replace function private.integration_test_context(b uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_primary_owner(b) then raise exception 'Only the primary owner can run integration tests' using errcode='42501';end if;
 return jsonb_build_object('sms_owner_verified',private.sms_owner_phone_verified(b),
  'state',coalesce((select to_jsonb(s)-'business_id' from private.integration_test_state s where business_id=b),'{}'),
  'operations',coalesce((select jsonb_agg(x order by created_at desc) from (select id,kind,status,provider_id,created_at,updated_at,result from private.integration_test_operations where business_id=b order by created_at desc limit 20) x),'[]'),
  'invoices',coalesce((select jsonb_agg(x) from (select id,invoice_number,status,balance_due from public.invoices where business_id=b and balance_due>0 and status not in ('draft','void') order by created_at desc limit 100) x),'[]'));
end $$;
