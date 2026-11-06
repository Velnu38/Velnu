create or replace function public.record_managed_sms_inbound(p_from text,p_to text,p_body text,p_sid text) returns void language plpgsql security definer set search_path='' as $$
declare b uuid;c uuid;
begin
 if p_sid is null or p_sid !~ '^SM[0-9a-fA-F]{32}$' or p_from is null or p_to is null or p_body is null or p_from !~ '^\+1[0-9]{10}$' or length(p_body)>1600 then raise exception 'Invalid inbound text';end if;
 perform pg_advisory_xact_lock(hashtextextended('sms-inbound:'||p_sid,0));
 if exists(select 1 from public.messages where provider='twilio' and provider_message_id=p_sid) then return;end if;
 select business_id into b from private.managed_delivery_accounts where sms_from=p_to and sms_active;
 if b is null then return;end if;
 if upper(btrim(p_body)) in('STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT') then insert into private.sms_opt_outs(phone) values(p_from) on conflict do nothing;
 elsif upper(btrim(p_body)) in('START','UNSTOP') then delete from private.sms_opt_outs where phone=p_from;end if;
 select case when count(*)=1 then min(id::text)::uuid end into c from public.customers where business_id=b and right(regexp_replace(phone,'[^0-9]','','g'),10)=right(p_from,10);
 insert into public.messages(business_id,customer_id,direction,channel,recipient,body,provider,provider_message_id,status,sent_at) values(b,c,'inbound','sms',p_from,p_body,'twilio',p_sid,'received',now());
end $$;
