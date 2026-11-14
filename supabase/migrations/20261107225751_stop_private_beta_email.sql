-- A beta denial can clear a browser's send identifier only when no earlier
-- provider attempt could exist. A reclaimed uncertain operation stays frozen.
create function private.stop_private_beta_email(p_request uuid,p_lease uuid,p_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare before_stop private.finviant_email_outbox%rowtype;after_stop private.finviant_email_outbox%rowtype;provider_observed boolean;
begin
 if p_request is null or p_lease is null or p_code is null
 or p_code not in('beta_recipient_not_approved','beta_configuration_unavailable') then return false;end if;
 select * into before_stop from private.finviant_email_outbox where id=p_request for update;
 if not found or before_stop.status in('accepted','delivered')
 or before_stop.lease_id is distinct from p_lease
 or before_stop.lease_until is null or before_stop.lease_until<=now() then return false;end if;
 select exists(select 1 from public.messages m where m.id=before_stop.id and m.business_id=before_stop.business_id
   and (m.status in('sent','delivered') or m.provider_message_id is not null))
 or exists(select 1 from private.finviant_delivery_events e
   where e.provider_id=before_stop.provider_id
   or e.provider_id in(select m.provider_message_id from public.messages m
     where m.id=before_stop.id and m.business_id=before_stop.business_id)) into provider_observed;
 if before_stop.attempts<>1 or before_stop.status<>'sending'
 or before_stop.provider_id is not null or provider_observed then
  if before_stop.status not in('failed','accepted','delivered') then
   update private.finviant_email_outbox set status='reconciliation_required',
    last_code='beta_stop_unconfirmed',lease_id=null,lease_until=null where id=before_stop.id;
  end if;
  return false;
 end if;
 perform public.finish_document_email(p_request,p_lease,'failed',null,p_code);
 select * into after_stop from private.finviant_email_outbox where id=p_request;
 return after_stop.status='failed' and after_stop.provider_id is null
  and after_stop.lease_id is null and after_stop.lease_until is null
  and after_stop.attempts=1 and after_stop.last_code=p_code
  and after_stop.payload is not distinct from before_stop.payload
  and after_stop.business_id=before_stop.business_id
  and after_stop.actor_id=before_stop.actor_id
  and after_stop.document_kind=before_stop.document_kind
  and after_stop.document_id=before_stop.document_id;
end $$;
revoke all on function private.stop_private_beta_email(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.stop_private_beta_email(uuid,uuid,text) to service_role;

create function public.stop_private_beta_email(p_request uuid,p_lease uuid,p_code text)
returns boolean language sql security invoker set search_path='' as $$
 select private.stop_private_beta_email(p_request,p_lease,p_code);
$$;
revoke all on function public.stop_private_beta_email(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.stop_private_beta_email(uuid,uuid,text) to service_role;
