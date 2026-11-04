-- Keep the customer's address in the existing service-location model; no copied address columns.
create or replace function public.create_customer_with_address(target_business_id uuid, request_id uuid, payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  customer_fields jsonb;
  address_fields jsonb;
  saved_customer public.customers;
  saved_address public.properties;
  address jsonb := payload->'address';
begin
  if auth.uid() is null or not private.can_write_business(target_business_id) then
    raise exception 'Customer access denied' using errcode='42501';
  end if;
  if request_id is null or jsonb_typeof(payload) is distinct from 'object' or jsonb_typeof(address) is distinct from 'object' then
    raise exception 'Customer and address details are required';
  end if;
  customer_fields := jsonb_build_object(
    'id',request_id,'business_id',target_business_id,
    'first_name',nullif(btrim(payload->>'first_name'),''),
    'last_name',nullif(btrim(payload->>'last_name'),''),
    'company',nullif(btrim(payload->>'company'),''),
    'email',nullif(btrim(payload->>'email'),''),
    'phone',nullif(btrim(payload->>'phone'),''),
    'notes',nullif(btrim(payload->>'notes'),''),
    'preferred_contact',nullif(btrim(payload->>'preferred_contact'),'')
  );
  if coalesce(customer_fields->>'first_name',customer_fields->>'last_name',customer_fields->>'company') is null then
    raise exception 'Enter a customer name or company';
  end if;
  if customer_fields->>'email' is not null and customer_fields->>'email' !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then
    raise exception 'Enter a valid customer email';
  end if;
  if nullif(btrim(address->>'address_line1'),'') is null then raise exception 'Street address is required'; end if;
  address_fields := jsonb_build_object(
    'id',request_id,'business_id',target_business_id,'customer_id',request_id,'label',null,
    'address_line1',btrim(address->>'address_line1'),
    'address_line2',nullif(btrim(address->>'address_line2'),''),
    'city',nullif(btrim(address->>'city'),''),'state',nullif(btrim(address->>'state'),''),
    'postal_code',nullif(btrim(address->>'postal_code'),''),'access_notes',null
  );
  -- Serialize retries, including two requests whose first response was lost.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(request_id::text,0));
  select * into saved_customer from public.customers where id=request_id and business_id=target_business_id;
  if found then
    select * into saved_address from public.properties where id=request_id and business_id=target_business_id and customer_id=request_id;
    if not found or not (to_jsonb(saved_customer) @> customer_fields) or not (to_jsonb(saved_address) @> address_fields) then
      raise exception 'This customer request was already saved with different details. Reload customers before trying again.';
    end if;
    return to_jsonb(saved_customer);
  end if;
  insert into public.customers(id,business_id,first_name,last_name,company,email,phone,notes,preferred_contact)
  select x.id,x.business_id,x.first_name,x.last_name,x.company,x.email,x.phone,x.notes,x.preferred_contact
  from jsonb_populate_record(null::public.customers,customer_fields) x returning * into saved_customer;
  insert into public.properties(id,business_id,customer_id,label,address_line1,address_line2,city,state,postal_code,access_notes)
  select x.id,x.business_id,x.customer_id,x.label,x.address_line1,x.address_line2,x.city,x.state,x.postal_code,x.access_notes
  from jsonb_populate_record(null::public.properties,address_fields) x;
  return to_jsonb(saved_customer);
end;
$$;
revoke all on function public.create_customer_with_address(uuid,uuid,jsonb) from public,anon,service_role;
grant execute on function public.create_customer_with_address(uuid,uuid,jsonb) to authenticated;
