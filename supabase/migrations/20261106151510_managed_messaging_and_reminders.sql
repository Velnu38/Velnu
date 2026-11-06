-- Managed SMS: durable operation, explicit recipient permission, no uncertain retries.
create table private.sms_permissions(business_id uuid not null references public.businesses(id) on delete cascade,phone text not null,actor_id uuid not null references auth.users(id),consented_at timestamptz not null default now(),primary key(business_id,phone));
create index sms_permissions_actor on private.sms_permissions(actor_id);
create table private.sms_opt_outs(phone text primary key,updated_at timestamptz not null default now());
create table private.managed_sms (
 id uuid primary key,business_id uuid not null references public.businesses(id) on delete cascade,actor_id uuid not null references auth.users(id),
 kind text not null,document_id uuid not null,token_hash text not null references private.document_shares(token_hash),
 phone text not null,sender text not null,body text not null,segments integer not null check(segments between 1 and 10),
 status text not null default 'queued' check(status in('queued','sending','accepted','delivered','failed','uncertain','blocked')),
 provider_id text unique,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index managed_sms_business on private.managed_sms(business_id,created_at);
create index managed_sms_actor on private.managed_sms(actor_id);
create index managed_sms_share on private.managed_sms(token_hash);
create unique index managed_sms_unique_sender on private.managed_delivery_accounts(sms_from) where sms_active;
alter table private.sms_permissions enable row level security;
alter table private.sms_opt_outs enable row level security;
alter table private.managed_sms enable row level security;
revoke all on private.sms_permissions,private.sms_opt_outs,private.managed_sms from public,anon,authenticated,service_role;
create policy no_client_access on private.sms_permissions to authenticated using(false);
create policy no_client_access on private.sms_opt_outs to authenticated using(false);
create policy no_client_access on private.managed_sms to authenticated using(false);
create function public.record_sms_permission(p_business uuid,p_phone text,p_consent boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.fin_access(p_business,'invoices',true) or p_consent is distinct from true or p_phone is null or p_phone !~ '^\+1[0-9]{10}$' then raise exception 'Confirm permission for this US mobile recipient.' using errcode='42501';end if;
 if exists(select 1 from private.sms_opt_outs where phone=p_phone) then raise exception 'This recipient opted out. They must opt in again by replying START.' using errcode='42501';end if;
 insert into private.sms_permissions(business_id,phone,actor_id) values(p_business,p_phone,auth.uid()) on conflict do nothing;
end $$;
create function public.prepare_managed_sms(p_actor uuid,p_business uuid,p_kind text,p_document uuid,p_request uuid,p_token text,p_recipient text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.document_shares;o private.managed_sms;recipient text;sender text;content text;units integer;snap jsonb;
begin
 perform set_config('request.jwt.claim.sub',p_actor::text,true);
 if not private.fin_access(p_business,case p_kind when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end,true) or private.effective_plan(p_business)<>'pro' then raise exception 'Business Pro billing access is required.' using errcode='42501';end if;
 select sms_from into sender from private.managed_delivery_accounts where business_id=p_business and sms_active and sms_reply_route is not null;
 if sender is null or not private.sms_owner_phone_verified(p_business) then raise exception 'Finviant SMS sender activation and owner verification are required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('managed-sms:'||p_business::text,0));
 select * into o from private.managed_sms where id=p_request;
 if found then if o.actor_id<>p_actor or o.business_id<>p_business or o.document_id<>p_document or o.kind<>p_kind or o.phone<>p_recipient then raise exception 'Send request changed' using errcode='23505';end if;return jsonb_build_object('id',o.id,'status',o.status,'recipient',o.phone,'provider_id',o.provider_id);end if;
 select * into s from private.document_shares where business_id=p_business and document_id=p_document and kind=p_kind and actor_id=p_actor and token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and revoked_at is null and expires_at>now();
 if not found then raise exception 'Prepare a fresh customer link.';end if;
 snap:=public.get_shared_document(p_token);
 recipient:=regexp_replace(snap#>>'{customer,phone}','[^0-9]','','g');
 if length(recipient)=10 then recipient:='1'||recipient;end if;recipient:='+'||recipient;
 if recipient !~ '^\+1[0-9]{10}$' or recipient is distinct from p_recipient then raise exception 'Review the saved US mobile recipient.' using errcode='23514';end if;
 if exists(select 1 from private.sms_opt_outs where phone=recipient) or not exists(select 1 from private.sms_permissions where business_id=p_business and phone=recipient) then raise exception 'Recipient permission is required, and opted-out recipients cannot receive texts.' using errcode='42501';end if;
 if exists(select 1 from private.managed_sms where business_id=p_business and document_id=p_document and kind=p_kind and status in('queued','sending','uncertain')) then raise exception 'A text for this document is pending. Check activity before sending again.';end if;
 content:=left(regexp_replace(snap#>>'{company,name}','[^A-Za-z0-9 .,]','','g'),50)||': '||replace(p_kind,'_',' ')||' '||left(regexp_replace(coalesce(snap->>'number',''),'[^A-Za-z0-9-]','','g'),30)||'. Review: https://finviant.com/?document_share='||p_token||' Reply STOP to opt out.';
 units:=case when length(content)<=160 then 1 else ceil(length(content)/153.0)::integer end;
 perform private.reserve_tier_usage(p_business,p_request,'sms',units);
 insert into private.managed_sms(id,business_id,actor_id,kind,document_id,token_hash,phone,sender,body,segments) values(p_request,p_business,p_actor,p_kind,p_document,s.token_hash,recipient,sender,content,units);
 return jsonb_build_object('id',p_request,'status','queued','recipient',recipient,'segments',units);
end $$;
create function public.claim_managed_sms(p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o private.managed_sms;
begin
 select * into o from private.managed_sms where id=p_request for update;
 if not found then raise exception 'Send unavailable';end if;
 if o.status<>'queued' then return jsonb_build_object('id',o.id,'status',o.status,'provider_id',o.provider_id,'recipient',o.phone);end if;
 perform set_config('request.jwt.claim.sub',o.actor_id::text,true);
 if not private.fin_access(o.business_id,case o.kind when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end,true) or private.effective_plan(o.business_id)<>'pro' or not coalesce((select sms_active from private.managed_delivery_accounts where business_id=o.business_id),false) or exists(select 1 from private.sms_opt_outs where phone=o.phone) then
 update private.managed_sms set status='blocked' where id=o.id;return jsonb_build_object('status','blocked');end if;
 if exists(select 1 from private.document_shares s where s.token_hash=o.token_hash and ((s.snapshot-'status'-'finviant_branding') is distinct from (private.customer_document_snapshot(o.business_id,o.kind,o.document_id)-'status'-'finviant_branding') or s.revoked_at is not null or s.expires_at<=now())) then update private.managed_sms set status='blocked' where id=o.id;return jsonb_build_object('status','blocked');end if;
 update private.managed_sms set status='sending',updated_at=now() where id=o.id;
 return jsonb_build_object('id',o.id,'status','claimed','recipient',o.phone,'sender',o.sender,'body',o.body,'segments',o.segments);
end $$;
create function public.finish_managed_sms(p_request uuid,p_status text,p_provider text) returns void language plpgsql security definer set search_path='' as $$
declare o private.managed_sms;customer uuid;t text;
begin
 if p_status is null or p_status not in('accepted','delivered','failed','uncertain') or (p_provider is not null and p_provider !~ '^SM[0-9a-fA-F]{32}$') then raise exception 'Invalid provider result';end if;
 select * into o from private.managed_sms where id=p_request for update;
 if not found or o.status='delivered' or (o.provider_id is not null and o.provider_id is distinct from p_provider) then return;end if;
 if o.status='failed' or (o.status='accepted' and p_status='uncertain') then return;end if;
 update private.managed_sms set status=p_status,provider_id=coalesce(provider_id,p_provider),updated_at=now() where id=o.id;
 if p_status in('accepted','delivered') then
  t:=case o.kind when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end;
  execute format('update public.%I set status=''sent'' where business_id=$1 and id=$2 and status=''draft''',t) using o.business_id,o.document_id;
  execute format('select customer_id from public.%I where business_id=$1 and id=$2',t) into customer using o.business_id,o.document_id;
  insert into public.messages(id,business_id,customer_id,invoice_id,estimate_id,change_order_id,direction,channel,recipient,subject,body,provider,provider_message_id,status,sent_at)
  values(o.id,o.business_id,customer,case when o.kind='invoice' then o.document_id end,case when o.kind='estimate' then o.document_id end,case when o.kind='change_order' then o.document_id end,'outbound','sms',o.phone,'Finviant text',o.body,'twilio',p_provider,case when p_status='delivered' then 'delivered' else 'sent' end,now())
  on conflict(id) do update set status=excluded.status,provider_message_id=excluded.provider_message_id;
 else update public.messages set status=case when p_status='failed' then 'failed' else status end where id=o.id;end if;
end $$;
create function public.record_managed_sms_inbound(p_from text,p_to text,p_body text,p_sid text) returns void language plpgsql security definer set search_path='' as $$
declare b uuid;c uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('sms-inbound:'||p_sid,0));
 if p_sid is null or p_sid !~ '^SM[0-9a-fA-F]{32}$' or p_from !~ '^\+1[0-9]{10}$' or length(p_body)>1600 then raise exception 'Invalid inbound text';end if;
 select business_id into b from private.managed_delivery_accounts where sms_from=p_to and sms_active;
 if b is null then return;end if;
 if upper(btrim(p_body)) in('STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT') then insert into private.sms_opt_outs(phone) values(p_from) on conflict do nothing;
 elsif upper(btrim(p_body)) in('START','UNSTOP') then delete from private.sms_opt_outs where phone=p_from;end if;
 select case when count(*)=1 then min(id::text)::uuid end into c from public.customers where business_id=b and right(regexp_replace(phone,'[^0-9]','','g'),10)=right(p_from,10);
 if not exists(select 1 from public.messages where provider='twilio' and provider_message_id=p_sid) then
  insert into public.messages(business_id,customer_id,direction,channel,recipient,body,provider,provider_message_id,status,sent_at) values(b,c,'inbound','sms',p_from,p_body,'twilio',p_sid,'received',now());
 end if;
end $$;
revoke all on function public.record_sms_permission(uuid,text,boolean) from public,anon,service_role;
grant execute on function public.record_sms_permission(uuid,text,boolean) to authenticated;
revoke all on function public.prepare_managed_sms(uuid,uuid,text,uuid,uuid,text,text),public.claim_managed_sms(uuid),public.finish_managed_sms(uuid,text,text),public.record_managed_sms_inbound(text,text,text,text) from public,anon,authenticated;
grant execute on function public.prepare_managed_sms(uuid,uuid,text,uuid,uuid,text,text),public.claim_managed_sms(uuid),public.finish_managed_sms(uuid,text,text),public.record_managed_sms_inbound(text,text,text,text) to service_role;
-- Owner-enabled email automation, off by default, with frozen scheduled reviews.
create table private.reminder_rules(business_id uuid primary key references public.businesses(id) on delete cascade,actor_id uuid not null references auth.users(id),enabled boolean not null default false,after_days integer not null default 3 check(after_days between 1 and 30),repeat_days integer not null default 7 check(repeat_days between 3 and 30),max_reminders integer not null default 3 check(max_reminders between 1 and 5),updated_at timestamptz not null default now());
create index reminder_rules_actor on private.reminder_rules(actor_id);
create table private.delivery_tasks(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id) on delete cascade,actor_id uuid not null references auth.users(id),kind text not null check(kind in('invoice','estimate','change_order')),document_id uuid not null,due_at timestamptz not null,snapshot jsonb,reminder boolean not null default false,status text not null default 'scheduled' check(status in('scheduled','queued','blocked','canceled')),last_error text,created_at timestamptz not null default now());
create index delivery_tasks_due on private.delivery_tasks(due_at) where status='scheduled';
create index delivery_tasks_business on private.delivery_tasks(business_id,document_id);
create index delivery_tasks_actor on private.delivery_tasks(actor_id);
alter table private.reminder_rules enable row level security;
alter table private.delivery_tasks enable row level security;
revoke all on private.reminder_rules,private.delivery_tasks from public,anon,authenticated,service_role;
create policy no_client_access on private.reminder_rules to authenticated using(false);
create policy no_client_access on private.delivery_tasks to authenticated using(false);
create function public.get_delivery_automation(p_business uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_primary_owner(p_business) then raise exception 'Only the primary owner can manage automatic sending.' using errcode='42501';end if;
 return jsonb_build_object('plan',private.effective_plan(p_business),'ready',coalesce((select email_active from private.managed_delivery_accounts where business_id=p_business),false),
 'rule',coalesce((select to_jsonb(r)-'actor_id'-'business_id' from private.reminder_rules r where business_id=p_business),'{"enabled":false,"after_days":3,"repeat_days":7,"max_reminders":3}'::jsonb),
 'tasks',coalesce((select jsonb_agg(x) from(select id,kind,document_id,due_at,reminder,status,last_error from private.delivery_tasks where business_id=p_business order by created_at desc limit 25)x),'[]'::jsonb));
end $$;
create function public.save_reminder_rule(p_business uuid,p_enabled boolean,p_after integer,p_repeat integer,p_max integer) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.is_primary_owner(p_business) then raise exception 'Owner access required' using errcode='42501';end if;
 if p_enabled and (private.effective_plan(p_business)<>'pro' or not coalesce((select email_active from private.managed_delivery_accounts where business_id=p_business),false)) then raise exception 'Business Pro and activated Finviant email are required before enabling reminders.' using errcode='42501';end if;
 insert into private.reminder_rules(business_id,actor_id,enabled,after_days,repeat_days,max_reminders) values(p_business,auth.uid(),p_enabled,p_after,p_repeat,p_max) on conflict(business_id) do update set actor_id=excluded.actor_id,enabled=excluded.enabled,after_days=excluded.after_days,repeat_days=excluded.repeat_days,max_reminders=excluded.max_reminders,updated_at=now();
 return public.get_delivery_automation(p_business);
end $$;
create function public.schedule_document_email(p_business uuid,p_kind text,p_document uuid,p_request uuid,p_due timestamptz,p_cancel boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare snap jsonb;
begin
 if not private.fin_access(p_business,case p_kind when 'invoice' then 'invoices' when 'estimate' then 'estimates' else 'change_orders' end,true) then raise exception 'Billing access required' using errcode='42501';end if;
 if p_cancel then update private.delivery_tasks set status='canceled' where id=p_request and business_id=p_business and status in('scheduled','blocked');return;end if;
 if private.effective_plan(p_business)<>'pro' or not coalesce((select email_active from private.managed_delivery_accounts where business_id=p_business),false) then raise exception 'Business Pro and activated Finviant email are required.' using errcode='42501';end if;
 if p_due is null or p_due<now()+interval '5 minutes' or p_due>now()+interval '90 days' then raise exception 'Choose a time from 5 minutes to 90 days ahead.';end if;
 snap:=private.customer_document_snapshot(p_business,p_kind,p_document);
 if snap#>>'{customer,email}' is null or snap->>'status' not in('draft','sent','viewed','partial','overdue') then raise exception 'Review a sendable document and customer email.';end if;
 if exists(select 1 from private.delivery_tasks where id=p_request) then
  if not exists(select 1 from private.delivery_tasks where id=p_request and business_id=p_business and kind=p_kind and document_id=p_document and due_at=p_due and snapshot=snap) then raise exception 'Scheduled request changed' using errcode='23505';end if;return;
 end if;
 insert into private.delivery_tasks(id,business_id,actor_id,kind,document_id,due_at,snapshot) values(p_request,p_business,auth.uid(),p_kind,p_document,p_due,snap);
end $$;
create function public.prepare_due_delivery_tasks() returns integer language plpgsql security definer set search_path='' as $$
declare r record;t private.delivery_tasks;snap jsonb;n integer:=0;
begin
 -- No paid provider request here: populate the existing idempotent outbox only.
 perform pg_advisory_xact_lock(61106151510::bigint);
 for r in select i.id,i.business_id,rules.actor_id from public.invoices i join private.reminder_rules rules on rules.business_id=i.business_id and rules.enabled
  join private.managed_delivery_accounts a on a.business_id=i.business_id and a.email_active
  where private.effective_plan(i.business_id)='pro' and i.status in('sent','viewed','partial','overdue') and i.balance_due>0 and i.due_date<=current_date-rules.after_days
  and (select count(*) from private.delivery_tasks d where d.business_id=i.business_id and d.document_id=i.id and d.reminder and d.status<>'canceled')<rules.max_reminders
  and not exists(select 1 from private.delivery_tasks d where d.business_id=i.business_id and d.document_id=i.id and d.reminder and d.status<>'canceled' and (d.created_at>now()-make_interval(days=>rules.repeat_days) or d.status in('scheduled','blocked')))
  order by i.due_date,i.id limit 10
 loop
  insert into private.delivery_tasks(business_id,actor_id,kind,document_id,due_at,reminder) values(r.business_id,r.actor_id,'invoice',r.id,now(),true);
 end loop;
 for t in select * from private.delivery_tasks where status='scheduled' and due_at<=now() order by due_at,id limit 10 for update skip locked
 loop
  begin
   if private.effective_plan(t.business_id)<>'pro' then raise exception 'Business Pro access is no longer active.';end if;
   if t.reminder then
    if not exists(select 1 from private.reminder_rules where business_id=t.business_id and enabled) then update private.delivery_tasks set status='canceled' where id=t.id;continue;end if;
    snap:=private.invoice_reminder_review(t.actor_id,t.business_id,t.document_id);
    perform public.prepare_invoice_reminder_email(t.actor_id,t.business_id,t.document_id,t.id,snap);
   else
    snap:=private.customer_document_snapshot(t.business_id,t.kind,t.document_id);
    if snap is distinct from t.snapshot then raise exception 'Document or recipient changed. Review and schedule again.';end if;
    perform public.prepare_document_email(t.actor_id,t.business_id,t.kind,t.document_id,t.id,'https://finviant.com');
   end if;
   update private.delivery_tasks set status='queued',last_error=null where id=t.id;n:=n+1;
  exception when others then update private.delivery_tasks set status='blocked',last_error=left(sqlerrm,300) where id=t.id;
  end;
 end loop;return n;
end $$;
revoke all on function public.get_delivery_automation(uuid),public.save_reminder_rule(uuid,boolean,integer,integer,integer),public.schedule_document_email(uuid,text,uuid,uuid,timestamptz,boolean) from public,anon,service_role;
grant execute on function public.get_delivery_automation(uuid),public.save_reminder_rule(uuid,boolean,integer,integer,integer),public.schedule_document_email(uuid,text,uuid,uuid,timestamptz,boolean) to authenticated;
revoke all on function public.prepare_due_delivery_tasks() from public,anon,authenticated;
grant execute on function public.prepare_due_delivery_tasks() to service_role;
