-- Future-event opt-in only. Reuse the existing quota, leased transport and signed delivery receipts.
create table private.journey_notice_policies(
 business_id uuid primary key references public.businesses(id) on delete cascade,
 actor_id uuid not null references auth.users(id),booking_confirmation boolean not null default false,
 payment_receipt boolean not null default false,version integer not null default 1,updated_at timestamptz not null default now()
);
alter table private.workflow_events add unique(id,business_id);
create table private.journey_notices(
 id uuid primary key,business_id uuid not null references public.businesses(id) on delete cascade,
 actor_id uuid not null references auth.users(id),policy_version integer,manual boolean not null default false,
 customer_id uuid,email text,state text not null default 'pending' check(state in('pending','queued','blocked','skipped')),
 snapshot jsonb,last_code text,attempts integer not null default 0,next_attempt_at timestamptz not null default now(),
 created_at timestamptz not null default now(),foreign key(id,business_id) references private.workflow_events(id,business_id) on delete cascade
);
create index journey_notices_due on private.journey_notices(next_attempt_at,id) where state in('pending','blocked');
create index journey_notices_business on private.journey_notices(business_id,created_at desc);
alter table private.journey_notice_policies enable row level security;
alter table private.journey_notices enable row level security;
revoke all on private.journey_notice_policies,private.journey_notices from public,anon,authenticated,service_role;

create function public.get_journey_notice_settings(p_business uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p private.journey_notice_policies%rowtype;
begin
 if auth.uid() is null or not private.is_primary_owner(p_business) then raise exception 'Primary owner access required' using errcode='42501';end if;
 select * into p from private.journey_notice_policies where business_id=p_business;
 return jsonb_build_object('booking_confirmation',coalesce(p.booking_confirmation,false),'payment_receipt',coalesce(p.payment_receipt,false),'version',coalesce(p.version,0),
 'ready',private.effective_plan(p_business)='pro' and exists(select 1 from private.managed_delivery_accounts where business_id=p_business and email_active and reply_to ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$'));
end $$;
create function public.save_journey_notice_settings(p_business uuid,p_booking boolean,p_receipt boolean,p_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare settings jsonb;p private.journey_notice_policies%rowtype;
begin
 settings:=public.get_journey_notice_settings(p_business);
 if p_booking is null or p_receipt is null or p_version is null then raise exception 'Choose notification settings' using errcode='22023';end if;
 if (p_booking or p_receipt) and (settings->>'ready')::boolean is not true then raise exception 'Business Pro and an activated email sender are required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('journey-policy:'||p_business,0));
 select * into p from private.journey_notice_policies where business_id=p_business for update;
 if coalesce(p.version,0)<>p_version then raise exception 'Notification settings changed. Reload before saving.' using errcode='40001';end if;
 if p.actor_id=auth.uid() and p.booking_confirmation=p_booking and p.payment_receipt=p_receipt then return public.get_journey_notice_settings(p_business);end if;
 insert into private.journey_notice_policies(business_id,actor_id,booking_confirmation,payment_receipt)
 values(p_business,auth.uid(),p_booking,p_receipt) on conflict(business_id) do update set actor_id=excluded.actor_id,booking_confirmation=excluded.booking_confirmation,payment_receipt=excluded.payment_receipt,version=private.journey_notice_policies.version+1,updated_at=now();
 return public.get_journey_notice_settings(p_business);
end $$;
revoke all on function public.get_journey_notice_settings(uuid),public.save_journey_notice_settings(uuid,boolean,boolean,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_journey_notice_settings(uuid),public.save_journey_notice_settings(uuid,boolean,boolean,integer) to authenticated;

create function private.capture_journey_notice() returns trigger
language plpgsql security definer set search_path='' as $$
declare p private.journey_notice_policies%rowtype;c public.customers%rowtype;customer uuid;
begin
 select * into p from private.journey_notice_policies where business_id=new.business_id;
 if p.business_id is null or not ((new.kind='appointment_booked' and new.facts->>'status'='confirmed' and p.booking_confirmation) or (new.kind='payment_received' and p.payment_receipt)) then return new;end if;
 if new.invoice_id is not null then select customer_id into customer from public.invoices where id=new.invoice_id and business_id=new.business_id;
 else customer:=(new.facts->>'customer_id')::uuid;end if;
 select * into c from public.customers where business_id=new.business_id and id=customer;
 insert into private.journey_notices(id,business_id,actor_id,policy_version,customer_id,email) values(new.id,new.business_id,p.actor_id,p.version,c.id,c.email) on conflict do nothing;
 return new;
end $$;
revoke all on function private.capture_journey_notice() from public,anon,authenticated,service_role;
create trigger capture_journey_notice after insert on private.workflow_events for each row execute function private.capture_journey_notice();

-- The snapshot is deterministic: compare it again immediately before any provider request.
create function private.journey_notice_snapshot(p_notice uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare n private.journey_notices%rowtype;e private.workflow_events%rowtype;p private.journey_notice_policies%rowtype;
 c public.customers%rowtype;j public.jobs%rowtype;i public.invoices%rowtype;b public.businesses%rowtype;
 reply text;subject text;body text;zone text;allowed boolean;customer uuid;
begin
 select * into n from private.journey_notices where id=p_notice;
 if not found then return null;end if;
 select * into e from private.workflow_events where id=n.id and business_id=n.business_id;
 select * into b from public.businesses where id=n.business_id;
 if e.id is null or e.created_at<now()-interval '23 hours' or private.effective_plan(n.business_id)<>'pro'
 or not coalesce(private.member_module_access(n.business_id,n.actor_id,'billing'),false)
 or not exists(select 1 from public.business_members where business_id=n.business_id and user_id=n.actor_id and role in('owner','admin','office')) then return null;end if;
 if not n.manual then
  select * into p from private.journey_notice_policies where business_id=n.business_id;
  allowed:=p.actor_id=n.actor_id and p.version=n.policy_version and private.is_primary_owner(n.business_id,n.actor_id)
   and ((e.kind='appointment_booked' and p.booking_confirmation) or (e.kind='payment_received' and p.payment_receipt));
  if allowed is not true then return null;end if;
 elsif e.kind not in('appointment_changed','appointment_canceled') or not coalesce(private.member_module_access(n.business_id,n.actor_id,'calendar'),false) then return null;end if;
 select reply_to into reply from private.managed_delivery_accounts where business_id=n.business_id and email_active;
 if reply is null or reply !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then return null;end if;
 if e.kind='payment_received' then
  select * into i from public.invoices where id=e.invoice_id and business_id=n.business_id;
  if i.id is null or i.status not in('partial','paid') or private.journey_payment_state(i.id)<>'none'
   or i.amount_paid is distinct from (e.facts->>'amount_paid')::numeric or i.balance_due is distinct from (e.facts->>'balance_due')::numeric then return null;end if;
  customer:=i.customer_id;subject:='Payment recorded · '||coalesce(i.invoice_number,'Invoice');
  body:='Thank you. Your payment has been recorded for invoice '||coalesce(i.invoice_number,'')||E'.\nTotal applied: '||coalesce(b.currency,'USD')||' '||i.amount_paid||E'\nRemaining balance: '||coalesce(b.currency,'USD')||' '||i.balance_due||case when i.status='paid' then E'\nThis invoice is paid.' else E'\nKeep your invoice for the remaining balance and payment instructions.' end;
 else
  select * into j from public.jobs where id=e.job_id and business_id=n.business_id;
  if j.id is null then return null;end if;
  customer:=j.customer_id;zone:=coalesce(nullif(b.timezone,''),'UTC');
  if customer is distinct from (e.facts->>'customer_id')::uuid then return null;end if;
  if e.kind='appointment_canceled' then
   if exists(select 1 from public.appointments a where a.business_id=n.business_id and a.job_id=j.id and a.starts_at=(e.facts->>'starts_at')::timestamptz and a.ends_at=(e.facts->>'ends_at')::timestamptz and a.status in('scheduled','confirmed','in_progress')) then return null;end if;
   subject:='Appointment canceled';body:='Your appointment for '||j.title||' on '||to_char((e.facts->>'starts_at')::timestamptz at time zone zone,'Mon DD, YYYY HH12:MI AM')||' ('||zone||') has been canceled.';
  else
   if j.status in('completed','canceled') or (e.facts->>'starts_at')::timestamptz<=now()
    or not exists(select 1 from public.appointments a where a.business_id=n.business_id and a.job_id=j.id and a.customer_id=customer and a.starts_at=(e.facts->>'starts_at')::timestamptz and a.ends_at=(e.facts->>'ends_at')::timestamptz and a.status='confirmed') then return null;end if;
   subject:=case when e.kind='appointment_changed' then 'Appointment updated' else 'Appointment confirmed' end;
   body:=case when e.kind='appointment_changed' then 'Your new appointment time for ' else 'Your appointment for ' end||j.title||' is '||to_char((e.facts->>'starts_at')::timestamptz at time zone zone,'Mon DD, YYYY HH12:MI AM')||' to '||to_char((e.facts->>'ends_at')::timestamptz at time zone zone,'HH12:MI AM')||' ('||zone||').';
  end if;
 end if;
 select * into c from public.customers where business_id=n.business_id and id=customer;
 if c.id is null or c.id is distinct from n.customer_id or c.email is distinct from n.email or c.archived is not false or c.preferred_contact='none'
  or c.email is null or c.email !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then return null;end if;
 subject:=left(regexp_replace(b.name||': '||subject,E'[\r\n]',' ','g'),180);
 body:=b.name||E'\n\nHello '||coalesce(nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''),c.company,'Customer')||E',\n\n'||body||E'\n\nReply to this email if you need assistance.';
 return jsonb_build_object('customer_id',c.id,'invoice_id',e.invoice_id,'job_id',e.job_id,'payload',jsonb_build_object('from','Finviant Office <adminsupport@finviant.com>','to',jsonb_build_array(c.email),'reply_to',jsonb_build_array(reply),'subject',subject,'text',body,'tags',jsonb_build_array(jsonb_build_object('name','finviant_request_id','value',n.id::text))));
end $$;
revoke all on function private.journey_notice_snapshot(uuid) from public,anon,authenticated,service_role;

alter table private.finviant_email_outbox drop constraint finviant_email_outbox_document_kind_check;
alter table private.finviant_email_outbox add constraint finviant_email_outbox_document_kind_check check(document_kind in('invoice','estimate','change_order','schedule','invoice_reminder','business_card','journey_notice'));
create function private.queue_journey_notice(p_notice uuid,p_expected jsonb default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare n private.journey_notices%rowtype;reviewed_snapshot jsonb;
begin
 select * into n from private.journey_notices where id=p_notice for update;
 if not found then return false;end if;
 if exists(select 1 from private.finviant_email_outbox where id=n.id and business_id=n.business_id) then return true;end if;
 reviewed_snapshot:=private.journey_notice_snapshot(n.id);
 if reviewed_snapshot is null then update private.journey_notices set state='blocked',last_code='notice_not_eligible',attempts=attempts+1,next_attempt_at=now()+interval '15 minutes' where id=n.id;return false;end if;
 if n.manual and reviewed_snapshot is distinct from p_expected then raise exception 'Customer or appointment changed. Review the notice again.' using errcode='40001';end if;
 if (select count(*) from private.finviant_email_outbox where business_id=n.business_id and created_at>now()-interval '1 hour')>=100 then raise exception 'Email rate limit reached' using errcode='54000';end if;
 insert into public.messages(id,business_id,customer_id,invoice_id,direction,channel,recipient,subject,body,provider,status)
 values(n.id,n.business_id,(reviewed_snapshot->>'customer_id')::uuid,(reviewed_snapshot->>'invoice_id')::uuid,'outbound','email',n.email,reviewed_snapshot#>>'{payload,subject}',reviewed_snapshot#>>'{payload,text}','resend','queued');
 insert into private.finviant_email_outbox(id,business_id,actor_id,document_kind,document_id,payload) values(n.id,n.business_id,n.actor_id,'journey_notice',n.id,reviewed_snapshot->'payload');
 update private.journey_notices set state='queued',snapshot=reviewed_snapshot,last_code=null where id=n.id;return true;
end $$;
revoke all on function private.queue_journey_notice(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.prepare_due_journey_notices() returns integer
language plpgsql security definer set search_path='' as $$
declare n private.journey_notices%rowtype;prepared integer:=0;
begin
 for n in select * from private.journey_notices where not manual and state in('pending','blocked') and attempts<8 and next_attempt_at<=now() and created_at>now()-interval '23 hours' order by next_attempt_at,id limit 10 for update skip locked loop
  begin
   if private.queue_journey_notice(n.id) then prepared:=prepared+1;end if;
  exception when others then
   update private.journey_notices set state='blocked',last_code='notice_preparation_failed',attempts=attempts+1,next_attempt_at=now()+interval '15 minutes' where id=n.id;
  end;
 end loop;return prepared;
end $$;
revoke all on function public.prepare_due_journey_notices() from public,anon,authenticated,service_role;
grant execute on function public.prepare_due_journey_notices() to service_role;

-- Manual/Fin reminders use the same payment hold as the automatic scheduler.
alter function private.invoice_reminder_review(uuid,uuid,uuid) rename to invoice_reminder_review_before_payment_hold;
create function private.invoice_reminder_review(actor uuid,b uuid,doc uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result:=private.invoice_reminder_review_before_payment_hold(actor,b,doc);
 if private.journey_payment_state(doc)<>'none' then raise exception 'A payment is active or needs reconciliation. Confirm its outcome before requesting another payment.' using errcode='23514';end if;
 return result;
end $$;
revoke all on function private.invoice_reminder_review_before_payment_hold(uuid,uuid,uuid),private.invoice_reminder_review(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.review_journey_notice(p_business uuid,p_event uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e private.workflow_events%rowtype;c public.customers%rowtype;n private.journey_notices%rowtype;snapshot jsonb;
begin
 if auth.uid() is null or not coalesce(private.member_module_access(p_business,auth.uid(),'calendar'),false) or not coalesce(private.member_module_access(p_business,auth.uid(),'billing'),false) or not private.has_business_role(p_business,array['owner','admin','office']) then raise exception 'Office scheduling and billing access required' using errcode='42501';end if;
 select * into e from private.workflow_events where business_id=p_business and id=p_event and kind in('appointment_changed','appointment_canceled');
 if not found then raise exception 'Appointment change unavailable' using errcode='42501';end if;
 select c0.* into c from public.customers c0 join public.jobs j on j.customer_id=c0.id and j.business_id=c0.business_id where j.id=e.job_id and j.business_id=p_business;
 insert into private.journey_notices as existing_notice(id,business_id,actor_id,manual,customer_id,email) values(e.id,p_business,auth.uid(),true,c.id,c.email)
 on conflict(id) do update set customer_id=excluded.customer_id,email=excluded.email
 where existing_notice.manual and existing_notice.actor_id=auth.uid() and not exists(select 1 from private.finviant_email_outbox where id=existing_notice.id);
 select * into n from private.journey_notices where id=e.id and business_id=p_business;
 if n.actor_id<>auth.uid() then raise exception 'Another authorized user prepared this notice. Review its history before sending.' using errcode='42501';end if;
 snapshot:=private.journey_notice_snapshot(n.id);
 return jsonb_build_object('id',n.id,'eligible',snapshot is not null,'snapshot',snapshot,'status',coalesce((select status from private.finviant_email_outbox where id=n.id),n.state));
end $$;
create function public.queue_reviewed_journey_notice(p_business uuid,p_event uuid,p_expected jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare reviewed jsonb;
begin
 reviewed:=public.review_journey_notice(p_business,p_event);
 if (reviewed->>'eligible')::boolean is not true then raise exception 'This notice is no longer eligible. Check customer contact, appointment and email setup.' using errcode='23514';end if;
 if private.queue_journey_notice(p_event,p_expected) is not true then raise exception 'Notice could not be queued';end if;
 return jsonb_build_object('id',p_event,'status',(select status from private.finviant_email_outbox where id=p_event and business_id=p_business));
end $$;
revoke all on function public.review_journey_notice(uuid,uuid),public.queue_reviewed_journey_notice(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.review_journey_notice(uuid,uuid),public.queue_reviewed_journey_notice(uuid,uuid,jsonb) to authenticated;

alter function public.claim_document_email(uuid,boolean) rename to claim_document_email_before_journey_notices;
alter function public.claim_document_email_before_journey_notices(uuid,boolean) set schema private;
revoke all on function private.claim_document_email_before_journey_notices(uuid,boolean) from public,anon,authenticated,service_role;
create function public.claim_document_email(p_request uuid,p_pdf_capable boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o private.finviant_email_outbox%rowtype;n private.journey_notices%rowtype;
begin
 select * into o from private.finviant_email_outbox where id=p_request for update;
 if found and o.document_kind='journey_notice' then
  if o.status in('sending','uncertain') then return jsonb_build_object('id',o.id,'status',case when o.status='sending' then 'busy' else 'uncertain' end);end if;
  if o.status='queued' then
   select * into n from private.journey_notices where id=o.id and business_id=o.business_id;
   if n.id is null or n.snapshot is distinct from private.journey_notice_snapshot(n.id) then
    update private.finviant_email_outbox set status='reconciliation_required',last_code='journey_state_changed' where id=o.id;
    update private.journey_notices set state='skipped',last_code='journey_state_changed' where id=o.id;
    update public.messages set status='failed' where id=o.id and business_id=o.business_id and status='queued';
    return jsonb_build_object('id',o.id,'status','reconciliation_required');
   end if;
  end if;
 end if;
 return private.claim_document_email_before_journey_notices(p_request,p_pdf_capable);
end $$;
revoke all on function public.claim_document_email(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.claim_document_email(uuid,boolean) to service_role;

-- Add delivery outcomes to the existing authorized history, without exposing payloads.
alter function public.get_workflow_activity(uuid,uuid,uuid,integer) rename to get_workflow_activity_before_notices;
alter function public.get_workflow_activity_before_notices(uuid,uuid,uuid,integer) set schema private;
revoke all on function private.get_workflow_activity_before_notices(uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
create function public.get_workflow_activity(p_business uuid,p_job uuid default null,p_invoice uuid default null,p_page integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;items jsonb;
begin
 result:=private.get_workflow_activity_before_notices(p_business,p_job,p_invoice,p_page);
 if coalesce(private.member_module_access(p_business,auth.uid(),'billing'),false) and private.has_business_role(p_business,array['owner','admin','office']) then
  select coalesce(jsonb_agg(e.item||coalesce((select jsonb_build_object('notice',jsonb_build_object('status',coalesce(o.status,n.state))) from private.journey_notices n left join private.finviant_email_outbox o on o.id=n.id and o.business_id=n.business_id where n.business_id=p_business and n.id=(e.item->>'id')::uuid),'{}'::jsonb) order by e.ordinality),'[]'::jsonb)
  into items from jsonb_array_elements(result->'items') with ordinality e(item,ordinality);
  result:=result||jsonb_build_object('items',items);
 end if;return result;
end $$;
revoke all on function public.get_workflow_activity(uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_workflow_activity(uuid,uuid,uuid,integer) to authenticated;

create function public.get_job_change_notice(p_business uuid,p_job uuid,p_start timestamptz,p_end timestamptz) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare event uuid;
begin
 if auth.uid() is null or not coalesce(private.member_module_access(p_business,auth.uid(),'calendar'),false) or not coalesce(private.member_module_access(p_business,auth.uid(),'billing'),false) or not private.has_business_role(p_business,array['owner','admin','office']) then raise exception 'Office scheduling access required' using errcode='42501';end if;
 select e.id into event from private.workflow_events e join public.jobs j on j.id=e.job_id and j.business_id=e.business_id
 where e.business_id=p_business and e.job_id=p_job and e.kind='appointment_changed' and e.created_at>now()-interval '23 hours'
 and j.status not in('completed','canceled') and exists(select 1 from public.appointments a where a.business_id=p_business and a.job_id=p_job and a.starts_at=p_start and a.ends_at=p_end and a.status in('scheduled','confirmed','in_progress'))
 and (e.facts->>'starts_at')::timestamptz=p_start and (e.facts->>'ends_at')::timestamptz=p_end
 order by e.created_at desc,e.id desc limit 1;return event;
end $$;
revoke all on function public.get_job_change_notice(uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.get_job_change_notice(uuid,uuid,timestamptz,timestamptz) to authenticated;

alter function private.owner_archive_sources(uuid,uuid) rename to owner_archive_sources_before_notices;
create function private.owner_archive_sources(b uuid,owner_id uuid) returns table(collection text,payload jsonb)
language sql stable security definer set search_path='' as $$
 select * from private.owner_archive_sources_before_notices(b,owner_id)
 union all select 'private.journey_notice_policies'::text,to_jsonb(p) from private.journey_notice_policies p where p.business_id=b
 union all select 'private.journey_notices'::text,to_jsonb(n)-'snapshot' from private.journey_notices n where n.business_id=b;
$$;
revoke all on function private.owner_archive_sources_before_notices(uuid,uuid),private.owner_archive_sources(uuid,uuid) from public,anon,authenticated,service_role;
