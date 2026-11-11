-- Read-only, service-only lookup for signed POS event recovery. No browser token,
-- new payment, activation flag, merchant destination or historical row is changed.
create function public.square_pos_event_context(p_merchant text,p_environment text,p_location text,p_operation uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(o) from private.square_invoice_operations o
 join private.square_connections c on c.business_id=o.business_id
  and c.merchant_id=o.merchant_id and c.environment=o.environment and c.location_id=o.location_id
 where o.id=p_operation and o.kind='pos' and o.merchant_id=p_merchant
  and o.environment=p_environment and o.location_id=p_location;
$$;
revoke all on function public.square_pos_event_context(text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.square_pos_event_context(text,text,text,uuid) to service_role;
