-- Service-only wrapper: the reviewed address must match the queued recipient.
-- The established queue still owns authorization, entitlements and idempotency.
create or replace function public.prepare_review_document_email(p_actor uuid,p_business uuid,p_kind text,p_document uuid,p_request uuid,p_origin text,p_recipient text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_customer uuid; current_email text; queued jsonb; existing private.finviant_email_outbox%rowtype;
begin
 if p_actor is null or private.member_module_access(p_business,p_actor,'billing') is distinct from true then raise exception 'Billing access denied' using errcode='42501';end if;
 if p_kind is null or p_kind not in ('invoice','estimate','change_order') or p_recipient is null or btrim(p_recipient) !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then raise exception 'Invalid reviewed recipient' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-email:'||p_business::text,0));
 -- Lock in the same order as the existing queue: business, document, customer.
 if p_kind='invoice' then
  select customer_id into target_customer from public.invoices where business_id=p_business and id=p_document for update;
 elsif p_kind='change_order' then
  select customer_id into target_customer from public.change_orders where business_id=p_business and id=p_document for update;
 else
  select customer_id into target_customer from public.estimates where business_id=p_business and id=p_document for update;
 end if;
 if target_customer is null then raise exception 'Document unavailable' using errcode='42501';end if;
 select * into existing from private.finviant_email_outbox where id=p_request;
 if found then
  if existing.business_id<>p_business or existing.document_kind<>p_kind or existing.document_id<>p_document or lower(existing.payload#>>'{to,0}') is distinct from lower(btrim(p_recipient)) then raise exception 'Send request changed' using errcode='23505';end if;
 else
  select email into current_email from public.customers where business_id=p_business and id=target_customer for update;
  if lower(btrim(current_email)) is distinct from lower(btrim(p_recipient)) then raise exception 'Customer email changed. Review the saved document before sending.' using errcode='23514';end if;
 end if;
 queued:=public.prepare_document_email(p_actor,p_business,p_kind,p_document,p_request,p_origin);
 -- The queue can reuse an earlier pending send; never dispatch it to an unreviewed address.
 select * into existing from private.finviant_email_outbox where id=(queued->>'id')::uuid;
 if not found or lower(existing.payload#>>'{to,0}') is distinct from lower(btrim(p_recipient)) then raise exception 'An earlier send uses different customer details. Check document activity.' using errcode='23514';end if;
 return queued;
end $$;
revoke all on function public.prepare_review_document_email(uuid,uuid,text,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.prepare_review_document_email(uuid,uuid,text,uuid,uuid,text,text) to service_role;
