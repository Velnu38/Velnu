-- Read-only projection of existing message, outbox, task and callback records.
-- Definer access is needed only for private delivery metadata. No private table grants.
create function public.get_invoice_reminder_history(p_business uuid,p_invoice uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not private.fin_access(p_business,'invoices') or not exists(select 1 from public.invoices where id=p_invoice and business_id=p_business) then raise exception 'Invoice history unavailable' using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 50 or (p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid history page' using errcode='22023';end if;
 with records as (
  select coalesce(m.id,t.id) id,coalesce(m.created_at,t.created_at) created_at,
   coalesce(m.channel,'email') channel,
   left(coalesce(m.recipient,t.snapshot#>>'{customer,email}'),320) recipient,
   case when t.reminder then 'automatic' when m.provider='personal_app_reminder' then 'personal' when m.provider='personal_app' then 'personal_unclassified' else 'manual' end source,
   coalesce(o.actor_id,t.actor_id,s.actor_id) actor_id,
   case when m.provider='personal_app_reminder' then case when confirmed.id is not null then 'user_reported' when m.status='failed' then 'canceled' else 'draft_opened' end
    when m.provider='personal_app' then 'user_reported'
    when o.status='failed' and event.event_type='email.suppressed' then 'suppressed'
    when o.status='failed' and event.event_type='email.bounced' then 'bounced'
    when o.status='reconciliation_required' and o.attempts=0 and o.last_code in('automatic_reminder_settings_changed','document_not_sendable','document_changed','schedule_changed','access_revoked','entitlement_expired') then 'suppressed'
    when o.status='reconciliation_required' then 'uncertain'
    when o.status is not null then o.status
    when t.status='blocked' then 'suppressed'
    when t.status='canceled' then 'canceled'
    when t.status='scheduled' then 'queued'
    when m.status='sent' then 'accepted'
    else coalesce(m.status,'uncertain') end status,
   coalesce(confirmed.sent_at,m.sent_at) sent_at,o.last_event_at,
   o.attempts,o.next_attempt_at,
   case when o.last_code='automatic_reminder_settings_changed' and o.attempts=0 then 'Stopped before sending because the invoice or reminder settings changed.' when o.last_code is not null or t.last_error is not null then 'Delivery needs review. No retry is started from history.' end detail,
   coalesce((select jsonb_agg(jsonb_build_object('type',e.event_type,'at',e.occurred_at) order by e.occurred_at,e.event_id) from private.finviant_delivery_events e where e.provider_id=o.provider_id),'[]'::jsonb) events
  from (select * from public.messages where business_id=p_business and invoice_id=p_invoice and direction='outbound') m
  full join (select * from private.delivery_tasks where business_id=p_business and kind='invoice' and document_id=p_invoice and reminder) t on t.id=m.id
  left join private.finviant_email_outbox o on o.id=m.id and o.business_id=p_business and o.document_id=p_invoice and o.document_kind in('invoice','invoice_reminder')
  left join private.document_shares s on m.provider in('personal_app_reminder','personal_app') and s.token_hash=m.provider_message_id and s.business_id=p_business and s.document_id=p_invoice and s.kind='invoice'
  left join lateral (select x.id,x.sent_at from public.messages x where m.provider='personal_app_reminder' and x.business_id=p_business and x.invoice_id=p_invoice and x.provider='personal_app' and x.provider_message_id=m.provider_message_id order by x.created_at limit 1) confirmed on true
  left join lateral (select case when count(distinct e.event_type)=1 then min(e.event_type) end event_type from private.finviant_delivery_events e where e.provider_id=o.provider_id and e.occurred_at=o.last_event_at and e.event_type in('email.delivered','email.failed','email.bounced','email.suppressed','email.complained')) event on true
  where t.reminder or m.subject like 'Payment reminder:%' or m.provider='personal_app_reminder'
   or m.provider='personal_app' and not exists(select 1 from public.messages draft where draft.business_id=p_business and draft.invoice_id=p_invoice and draft.provider='personal_app_reminder' and draft.provider_message_id=m.provider_message_id)
 ), labeled as (
  select r.id,r.created_at,r.channel,r.recipient,r.source,r.status,r.sent_at,r.last_event_at,r.attempts,r.next_attempt_at,r.detail,r.events,
   case when r.source='automatic' then 'Automatic rule' when r.actor_id=auth.uid() then 'You' when member.user_id is not null then coalesce(nullif(left(profile.full_name,100),''),'Team member') else 'Initiator unavailable' end initiator
  from records r left join public.business_members member on member.business_id=p_business and member.user_id=r.actor_id
  left join public.user_profiles profile on profile.user_id=member.user_id
 ), page as (
  select * from labeled where p_before_at is null or (created_at,id)<(p_before_at,p_before_id) order by created_at desc,id desc limit p_limit+1
 )
 select jsonb_build_object('invoice_id',p_invoice,
  'items',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from (select * from page order by created_at desc,id desc limit p_limit)x),'[]'::jsonb),
  'has_more',(select count(*)>p_limit from page),
  'last_attempt',(select to_jsonb(x) from labeled x where source<>'personal_unclassified' order by created_at desc,id desc limit 1),
  'last_success',(select to_jsonb(x) from labeled x where status in('accepted','delivered') order by coalesce(last_event_at,sent_at,created_at) desc,id desc limit 1)) into result;
 return result;
end $$;
revoke all on function public.get_invoice_reminder_history(uuid,uuid,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_invoice_reminder_history(uuid,uuid,timestamptz,uuid,integer) to authenticated;

-- Record only an explicitly requested native reminder handoff in the existing messages table.
-- Never send, enqueue provider work, alter balances or mark the invoice sent here.
create function public.record_invoice_reminder_draft(p_business uuid,p_token text,p_channel text,p_canceled boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare share private.document_shares%rowtype;review jsonb;recipient text;
begin
 if auth.uid() is null or not private.fin_access(p_business,'invoices',true) then raise exception 'Billing access required' using errcode='42501';end if;
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_channel is null or p_channel not in('email','sms') or p_canceled is null then raise exception 'Invalid reminder draft';end if;
 select * into share from private.document_shares where business_id=p_business and token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and actor_id=auth.uid() and kind='invoice' and (p_canceled or revoked_at is null and expires_at>now());
 if not found then raise exception 'Reminder draft unavailable' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('reminder-draft:'||share.token_hash,0));
 if p_canceled then
  update public.messages set status='failed' where business_id=p_business and invoice_id=share.document_id and provider='personal_app_reminder' and provider_message_id=share.token_hash and channel=p_channel and status='queued';return;
 end if;
 review:=private.invoice_reminder_review(auth.uid(),p_business,share.document_id);
 recipient:=case when p_channel='email' then review->>'email' else review->>'phone' end;
 if recipient is null or recipient is distinct from share.snapshot#>>array['customer',case when p_channel='email' then 'email' else 'phone' end] then raise exception 'Recipient changed. Prepare a fresh reminder.';end if;
 if not exists(select 1 from public.messages where business_id=p_business and provider='personal_app_reminder' and provider_message_id=share.token_hash) then
  insert into public.messages(business_id,customer_id,invoice_id,direction,channel,recipient,subject,body,provider,provider_message_id,status)
  values(p_business,(review->>'customer_id')::uuid,share.document_id,'outbound',p_channel,recipient,'Payment reminder: app draft','Draft opened in a personal app. Sending and delivery are not verified.','personal_app_reminder',share.token_hash,'queued');
 end if;
end $$;
revoke all on function public.record_invoice_reminder_draft(uuid,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.record_invoice_reminder_draft(uuid,text,text,boolean) to authenticated;
