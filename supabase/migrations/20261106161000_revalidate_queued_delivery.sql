-- Recheck document eligibility immediately before contacting a provider.
CREATE OR REPLACE FUNCTION public.claim_document_email(p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o private.finviant_email_outbox%rowtype;lease uuid:=gen_random_uuid();current_doc jsonb;begin
 select * into o from private.finviant_email_outbox where id=p_request for update;if not found then raise exception 'SEND_NOT_FOUND' using errcode='P0002';end if;
 if o.status in('accepted','delivered') then return jsonb_build_object('id',o.id,'status',o.status,'provider_id',o.provider_id,'recipient',o.payload->'to'->>0);end if;
 if o.document_kind in('invoice','invoice_reminder','estimate','change_order') then
  current_doc:=private.customer_document_snapshot(o.business_id,case when o.document_kind='invoice_reminder' then 'invoice' else o.document_kind end,o.document_id);
  if current_doc is null or current_doc->>'status' in('void','paid','expired','declined','converted','accepted','approved') or (o.document_kind='invoice_reminder' and current_doc->>'status'='draft') then
   update private.finviant_email_outbox set status='reconciliation_required',last_code='document_not_sendable' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');
  end if;
 end if;
 if o.customer_snapshot is not null and (o.customer_snapshot-'status'-'finviant_branding') is distinct from (private.customer_document_snapshot(o.business_id,case when o.document_kind='invoice_reminder' then 'invoice' else o.document_kind end,o.document_id)-'status'-'finviant_branding') then update private.finviant_email_outbox set status='reconciliation_required',last_code='document_changed' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if o.document_kind='schedule' and not exists(select 1 from private.scheduling_offers x join public.estimates e on e.id=x.estimate_id and e.business_id=x.business_id join public.customers c on c.id=e.customer_id and c.business_id=e.business_id
 where x.id=o.document_id and x.business_id=o.business_id and x.status='approved' and x.expires_at>now() and x.recipient_email=c.email and private.can_manage_schedule(x.business_id,o.actor_id)) then
 update private.finviant_email_outbox set status='reconciliation_required',last_code='schedule_changed' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if o.status in('failed','reconciliation_required') then return jsonb_build_object('id',o.id,'status',o.status);end if;
 if not private.member_module_access(o.business_id,o.actor_id,'billing') then update private.finviant_email_outbox set status='reconciliation_required',last_code='access_revoked' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if not exists(select 1 from public.business_members where business_id=o.business_id and user_id=o.actor_id and role in('owner','admin','office')) then update private.finviant_email_outbox set status='reconciliation_required',last_code='access_revoked' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if (private.effective_plan(o.business_id)<>'pro' or not coalesce((select email_active from private.managed_delivery_accounts where business_id=o.business_id),false)) then update private.finviant_email_outbox set status='reconciliation_required',last_code='entitlement_expired' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if; if o.created_at<now()-interval '23 hours' or o.attempts>=5 then update private.finviant_email_outbox set status='reconciliation_required' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if (o.lease_until>now()) or o.next_attempt_at>now() then return jsonb_build_object('id',o.id,'status','busy');end if;
 update private.finviant_email_outbox set status='sending',attempts=attempts+1,lease_id=lease,lease_until=now()+interval '2 minutes' where id=o.id;
 return jsonb_build_object('id',o.id,'status','claimed','lease',lease,'payload',o.payload);end;$function$;

create or replace function public.claim_managed_sms(p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o private.managed_sms;current_doc jsonb;
begin
 select * into o from private.managed_sms where id=p_request for update;
 if not found then raise exception 'Send unavailable';end if;
 if o.status<>'queued' then return jsonb_build_object('id',o.id,'status',o.status,'provider_id',o.provider_id,'recipient',o.phone);end if;
 perform set_config('request.jwt.claim.sub',o.actor_id::text,true);
 if not private.fin_access(o.business_id,case o.kind when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end,true) or private.effective_plan(o.business_id)<>'pro' or not coalesce((select sms_active from private.managed_delivery_accounts where business_id=o.business_id),false) or exists(select 1 from private.sms_opt_outs where phone=o.phone) then
 update private.managed_sms set status='blocked' where id=o.id;return jsonb_build_object('status','blocked');end if;
 current_doc:=private.customer_document_snapshot(o.business_id,o.kind,o.document_id);
 if current_doc is null or current_doc->>'status' in('void','paid','expired','declined','converted','accepted','approved') or not exists(select 1 from private.document_shares s where s.token_hash=o.token_hash and (s.snapshot-'status'-'finviant_branding') is not distinct from (current_doc-'status'-'finviant_branding') and s.revoked_at is null and s.expires_at>now()) then update private.managed_sms set status='blocked' where id=o.id;return jsonb_build_object('status','blocked');end if;
 update private.managed_sms set status='sending',updated_at=now() where id=o.id;
 return jsonb_build_object('id',o.id,'status','claimed','recipient',o.phone,'sender',o.sender,'body',o.body,'segments',o.segments);
end $$;
