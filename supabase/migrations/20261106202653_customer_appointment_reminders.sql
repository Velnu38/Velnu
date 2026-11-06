-- Opt-in transactional email for scheduled jobs, using the existing metered outbox.
create table private.appointment_reminder_rules (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default false
);
alter table private.appointment_reminder_rules enable row level security;
revoke all on private.appointment_reminder_rules from public,anon,authenticated,service_role;

alter table private.finviant_email_outbox drop constraint finviant_email_outbox_document_kind_check;
alter table private.finviant_email_outbox add constraint finviant_email_outbox_document_kind_check
  check (document_kind in ('invoice','estimate','change_order','invoice_reminder','schedule','appointment_reminder'));
-- Documents retain one pending message per document. Reminders use one per scheduled start.
drop index private.idx_fv_outbox_pending_document;
create unique index idx_fv_outbox_pending_document
  on private.finviant_email_outbox (business_id,document_kind,document_id)
  where document_kind<>'appointment_reminder' and status in ('queued','sending','uncertain','reconciliation_required');
create unique index appointment_reminder_once_per_start
  on private.finviant_email_outbox (business_id,document_id,(customer_snapshot->>'starts_at'))
  where document_kind='appointment_reminder';
create index appointment_reminder_upcoming_jobs on public.jobs (scheduled_start,business_id)
  where status='scheduled' and scheduled_start is not null;

create function public.get_appointment_reminders(p_business uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_primary_owner(p_business) then
    raise exception 'Only the primary owner can manage customer appointment reminders.' using errcode='42501';
  end if;
  return jsonb_build_object(
    'enabled',coalesce((select enabled from private.appointment_reminder_rules where business_id=p_business),false),
    'ready',private.effective_plan(p_business)='pro' and coalesce(
      (select email_active from private.managed_delivery_accounts where business_id=p_business),false));
end $$;

create function public.set_appointment_reminders(p_business uuid,p_enabled boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare state jsonb;
begin
  state:=public.get_appointment_reminders(p_business);
  if p_enabled is null or (p_enabled and not (state->>'ready')::boolean) then
    raise exception 'Business Pro and activated Finviant email are required.' using errcode='42501';
  end if;
  insert into private.appointment_reminder_rules(business_id,actor_id,enabled)
  values(p_business,auth.uid(),p_enabled)
  on conflict(business_id) do update set actor_id=excluded.actor_id,enabled=excluded.enabled;
  return public.get_appointment_reminders(p_business);
end $$;

create function private.appointment_reminder_snapshot(b uuid,job uuid,actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('starts_at',extract(epoch from j.scheduled_start),'time_label',
    to_char(j.scheduled_start at time zone w.timezone,'FMDay, FMMonth DD, YYYY "at" FMHH12:MI AM'),
    'timezone',w.timezone,'business_name',w.name,'recipient',btrim(c.email),
    'customer_id',c.id,'reply_to',coalesce(nullif(a.reply_to,''),w.email))
  from public.jobs j
  join public.businesses w on w.id=j.business_id
  join public.customers c on c.business_id=j.business_id and c.id=j.customer_id
  join private.appointment_reminder_rules r on r.business_id=j.business_id and r.enabled and r.actor_id=actor
  join private.managed_delivery_accounts a on a.business_id=j.business_id and a.email_active
  where j.business_id=b and j.id=job and j.status='scheduled' and j.scheduled_start>now()
    and not c.archived and btrim(c.email) ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$'
    and private.is_primary_owner(b,actor) and private.can_manage_schedule(b,actor)
    and private.member_module_access(b,actor,'billing') and private.effective_plan(b)='pro';
$$;

create function public.prepare_due_appointment_reminders() returns integer
language plpgsql security definer set search_path='' as $$
declare item record; snapshot jsonb; message_id uuid; subject text; message_body text; payload jsonb; n integer:=0;
begin
  if not pg_try_advisory_xact_lock(61106202653::bigint) then return 0; end if;
  for item in
    select j.id,j.business_id,r.actor_id
    from public.jobs j
    join private.appointment_reminder_rules r on r.business_id=j.business_id and r.enabled
    join private.managed_delivery_accounts a on a.business_id=j.business_id and a.email_active
    join public.customers c on c.business_id=j.business_id and c.id=j.customer_id
    where j.status='scheduled' and not c.archived
      and btrim(c.email) ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$'
      and j.scheduled_start between now()+interval '22 hours' and now()+interval '24 hours'
      and private.effective_plan(j.business_id)='pro'
      and coalesce((select used from private.tier_usage where business_id=j.business_id and feature='email'
        and period=private.tier_period('pro','email')),0)<private.tier_limit('pro','email')
      and not exists(select 1 from private.finviant_email_outbox o where o.business_id=j.business_id
        and o.document_kind='appointment_reminder' and o.document_id=j.id
        and o.customer_snapshot->>'starts_at'=extract(epoch from j.scheduled_start)::text)
    order by j.scheduled_start,j.id limit 20
  loop
    snapshot:=private.appointment_reminder_snapshot(item.business_id,item.id,item.actor_id);
    if snapshot is null then continue; end if;
    message_id:=gen_random_uuid();
    subject:=left(regexp_replace((snapshot->>'business_name')||': Appointment reminder',E'[\r\n]',' ','g'),200);
    message_body:='Your appointment is scheduled for '||(snapshot->>'time_label')||
      ' ('||(snapshot->>'timezone')||'). Please contact '||(snapshot->>'business_name')||' if you need to make a change.';
    payload:=jsonb_build_object('from','Finviant Office <adminsupport@finviant.com>',
      'to',jsonb_build_array(snapshot->>'recipient'),'subject',subject,'text',message_body,
      'tags',jsonb_build_array(jsonb_build_object('name','finviant_request_id','value',message_id::text)));
    if (snapshot->>'reply_to') ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then
      payload:=payload||jsonb_build_object('reply_to',jsonb_build_array(snapshot->>'reply_to'));
    end if;
    begin
      insert into private.finviant_email_outbox(id,business_id,actor_id,document_kind,document_id,payload,customer_snapshot)
      values(message_id,item.business_id,item.actor_id,'appointment_reminder',item.id,payload,snapshot);
      insert into public.messages(id,business_id,customer_id,direction,channel,recipient,subject,body,provider,status)
      values(message_id,item.business_id,(snapshot->>'customer_id')::uuid,'outbound','email',
        snapshot->>'recipient',subject,message_body,'resend','queued');
      n:=n+1;
    exception when insufficient_privilege or unique_violation or raise_exception then
      -- A quota or entitlement can change while the worker is scanning the queue.
      continue;
    end;
  end loop;
  return n;
end $$;

revoke all on function public.get_appointment_reminders(uuid),public.set_appointment_reminders(uuid,boolean)
  from public,anon,service_role;
grant execute on function public.get_appointment_reminders(uuid),public.set_appointment_reminders(uuid,boolean)
  to authenticated;
revoke all on function private.appointment_reminder_snapshot(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.prepare_due_appointment_reminders() from public,anon,authenticated;
grant execute on function public.prepare_due_appointment_reminders() to service_role;

-- Revalidate the exact appointment and recipient before every provider claim.
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
 if o.document_kind='appointment_reminder' and o.customer_snapshot is distinct from
   private.appointment_reminder_snapshot(o.business_id,o.document_id,o.actor_id) then
  update private.finviant_email_outbox set status='reconciliation_required',last_code='appointment_changed' where id=o.id;
  update public.messages set status='failed' where id=o.id and business_id=o.business_id;
  return jsonb_build_object('id',o.id,'status','reconciliation_required');
 end if;
 if o.document_kind<>'appointment_reminder' and o.customer_snapshot is not null and (o.customer_snapshot-'status'-'finviant_branding') is distinct from (private.customer_document_snapshot(o.business_id,case when o.document_kind='invoice_reminder' then 'invoice' else o.document_kind end,o.document_id)-'status'-'finviant_branding') then update private.finviant_email_outbox set status='reconciliation_required',last_code='document_changed' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
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
