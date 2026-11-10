-- Customer appointment reminders: owner-enabled, purpose-specific consent, durable occurrence suppression.
create table private.appointment_reminder_rules (
 business_id uuid primary key references public.businesses(id) on delete cascade,
 actor_id uuid not null references auth.users(id), enabled boolean not null default false,
 lead_hours integer not null default 48 check(lead_hours between 1 and 720),
 channel text not null default 'email' check(channel in('email','sms'))
);
create table private.appointment_reminder_overrides (
 appointment_id uuid primary key references public.appointments(id) on delete cascade,
 business_id uuid not null references public.businesses(id) on delete cascade,
 mode text not null check(mode in('inherit','off','custom')),
 lead_hours integer not null default 48 check(lead_hours between 1 and 720),
 channel text not null default 'email' check(channel in('email','sms'))
);
-- Appointment permission never grants permission to send financial document texts.
create table private.appointment_sms_permissions (
 business_id uuid not null references public.businesses(id) on delete cascade,
 phone text not null check(phone ~ '^\+1[0-9]{10}$'), actor_id uuid not null references auth.users(id),
 consented_at timestamptz not null default now(), primary key(business_id,phone)
);
create table private.appointment_reminder_queue (
 id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id) on delete cascade,
 appointment_id uuid references public.appointments(id) on delete set null,occurrence_id uuid not null,
 starts_at timestamptz not null,due_at timestamptz not null,channel text not null check(channel in('email','sms')),
 snapshot jsonb not null,status text not null default 'queued' check(status in('queued','sending','accepted','failed','uncertain','blocked')),
 provider_id text,last_error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(business_id,occurrence_id,starts_at)
);
create index appointment_reminder_rules_actor on private.appointment_reminder_rules(actor_id);
create index appointment_reminder_overrides_business on private.appointment_reminder_overrides(business_id);
create index appointment_sms_permissions_actor on private.appointment_sms_permissions(actor_id);
create index appointment_reminder_queue_appointment on private.appointment_reminder_queue(appointment_id);
create index appointment_reminder_due on private.appointment_reminder_queue(due_at) where status='queued';
alter table private.appointment_reminder_rules enable row level security;
alter table private.appointment_reminder_overrides enable row level security;
alter table private.appointment_sms_permissions enable row level security;
alter table private.appointment_reminder_queue enable row level security;
revoke all on private.appointment_reminder_rules,private.appointment_reminder_overrides,private.appointment_sms_permissions,private.appointment_reminder_queue from public,anon,authenticated,service_role;

-- All sibling appointment rows for one job/start represent one customer occurrence.
-- An Off sibling wins. Conflicting custom values fail closed, independently of row order.
create function private.appointment_reminder_occurrence(p_appointment uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare a public.appointments;canonical uuid;cnt integer;off_found boolean;custom_count integer;status_conflict boolean;chosen jsonb;mode text;
begin
 select * into a from public.appointments where id=p_appointment;if not found then return null;end if;
 select count(*),min(x.id::text) filter(where x.status in('scheduled','confirmed'))::uuid,
 coalesce(bool_or(o.mode='off'),false),count(distinct (o.lead_hours,o.channel)) filter(where o.mode='custom'),
 bool_or(x.status in('scheduled','confirmed')) and bool_or(x.status not in('scheduled','confirmed'))
 into cnt,canonical,off_found,custom_count,status_conflict
 from public.appointments x left join private.appointment_reminder_overrides o on o.appointment_id=x.id and o.business_id=x.business_id
 where x.business_id=a.business_id and coalesce(x.job_id,x.id)=coalesce(a.job_id,a.id) and x.starts_at=a.starts_at;
 select jsonb_build_object('lead_hours',o.lead_hours,'channel',o.channel) into chosen
 from public.appointments x join private.appointment_reminder_overrides o on o.appointment_id=x.id and o.business_id=x.business_id
 where x.business_id=a.business_id and coalesce(x.job_id,x.id)=coalesce(a.job_id,a.id) and x.starts_at=a.starts_at and o.mode='custom' order by x.id limit 1;
 mode:=case when off_found then 'off' when custom_count>0 then 'custom' else 'inherit' end;
 return jsonb_build_object('business_id',a.business_id,'occurrence_id',coalesce(a.job_id,a.id),'starts_at',a.starts_at,'canonical_id',canonical,
 'mode',mode,'lead_hours',coalesce((chosen->>'lead_hours')::integer,48),'channel',coalesce(chosen->>'channel','email'),
 'shared_occurrence',cnt>1,'occurrence_status_conflict',status_conflict,'occurrence_conflict',custom_count>1 or status_conflict);
end $$;

create function public.get_appointment_reminder_settings(p_business uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 if not private.is_primary_owner(p_business) then raise exception 'Primary owner access required' using errcode='42501';end if;
 return jsonb_build_object('plan',private.effective_plan(p_business),
 'ready_email',coalesce((select email_active and reply_to is not null and reply_to ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' from private.managed_delivery_accounts where business_id=p_business),false),
 'ready_sms',coalesce((select sms_active and sms_from is not null and sms_reply_route is not null from private.managed_delivery_accounts where business_id=p_business),false) and private.sms_owner_phone_verified(p_business),
 'rule',coalesce((select to_jsonb(r)-'business_id'-'actor_id' from private.appointment_reminder_rules r where business_id=p_business),'{"enabled":false,"lead_hours":48,"channel":"email"}'::jsonb),
 'tasks',coalesce((select jsonb_agg(x) from(select id,appointment_id,starts_at,due_at,channel,status,last_error from private.appointment_reminder_queue where business_id=p_business order by created_at desc limit 25)x),'[]'::jsonb));
end $$;
create function public.save_appointment_reminder_settings(p_business uuid,p_enabled boolean,p_lead_hours integer,p_channel text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb;
begin
 s:=public.get_appointment_reminder_settings(p_business);
 if p_enabled is null or p_lead_hours is null or p_lead_hours not between 1 and 720 or p_channel is null or p_channel not in('email','sms') then raise exception 'Choose a channel and 1–720 hours notice.';end if;
 if p_enabled and (s->>'plan'<>'pro' or not coalesce((s->>('ready_'||p_channel))::boolean,false)) then raise exception 'Business Pro and activated delivery are required.' using errcode='42501';end if;
 insert into private.appointment_reminder_rules values(p_business,auth.uid(),p_enabled,p_lead_hours,p_channel)
 on conflict(business_id) do update set actor_id=excluded.actor_id,enabled=excluded.enabled,lead_hours=excluded.lead_hours,channel=excluded.channel;
 return public.get_appointment_reminder_settings(p_business);
end $$;
create function public.get_appointment_reminder_override(p_business uuid,p_appointment uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare occurrence jsonb;v_phone text;r private.appointment_reminder_rules;
begin
 if not private.can_manage_schedule(p_business) or not exists(select 1 from public.appointments where business_id=p_business and id=p_appointment) then raise exception 'Appointment access required' using errcode='42501';end if;
 occurrence:=private.appointment_reminder_occurrence(p_appointment);
 select regexp_replace(coalesce(c.phone,''),'[^0-9]','','g') into v_phone from public.appointments a join public.customers c on c.id=a.customer_id and c.business_id=a.business_id where a.id=coalesce((occurrence->>'canonical_id')::uuid,p_appointment) and a.business_id=p_business;
 if length(v_phone)=10 then v_phone:='1'||v_phone;end if;v_phone:='+'||v_phone;if v_phone !~ '^\+1[0-9]{10}$' then v_phone:=null;end if;
 select * into r from private.appointment_reminder_rules where business_id=p_business;
 return (occurrence-'business_id'-'occurrence_id'-'starts_at'-'canonical_id')||jsonb_build_object(
 'business_rule',jsonb_build_object('enabled',coalesce(r.enabled,false),'lead_hours',coalesce(r.lead_hours,48),'channel',coalesce(r.channel,'email')),
 'recipient_phone',v_phone,'sms_consented',exists(select 1 from private.appointment_sms_permissions where business_id=p_business and phone=v_phone),
 'sms_opted_out',exists(select 1 from private.sms_opt_outs where phone=v_phone),
 'effective',jsonb_build_object('enabled',coalesce(r.enabled,false) and occurrence->>'canonical_id' is not null and occurrence->>'mode'<>'off' and not (occurrence->>'occurrence_conflict')::boolean,
 'lead_hours',case when occurrence->>'mode'='custom' then (occurrence->>'lead_hours')::integer else coalesce(r.lead_hours,48) end,
 'channel',case when occurrence->>'mode'='custom' then occurrence->>'channel' else coalesce(r.channel,'email') end));
end $$;
create function public.save_appointment_reminder_override(p_business uuid,p_appointment uuid,p_mode text,p_lead_hours integer,p_channel text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.appointments;locked_a public.appointments;
begin
 perform public.get_appointment_reminder_override(p_business,p_appointment);
 if p_mode is null or p_mode not in('inherit','off','custom') or p_lead_hours is null or p_lead_hours not between 1 and 720 or p_channel is null or p_channel not in('email','sms') then raise exception 'Choose valid reminder settings.';end if;
 select * into a from public.appointments where id=p_appointment and business_id=p_business;
 if not found then raise exception 'Appointment changed. Review it again.';end if;
 -- Take the occurrence lock before any row lock: sibling saves must not deadlock on FK checks.
 perform pg_advisory_xact_lock(hashtextextended('appointment-reminder:'||a.business_id::text||':'||coalesce(a.job_id,a.id)::text||':'||extract(epoch from a.starts_at)::text,0));
 select * into locked_a from public.appointments where id=p_appointment and business_id=p_business for update;
 if not found or (locked_a.job_id,locked_a.starts_at) is distinct from (a.job_id,a.starts_at) then raise exception 'Appointment changed. Review it again.' using errcode='40001';end if;
 insert into private.appointment_reminder_overrides(appointment_id,business_id,mode,lead_hours,channel)
 select x.id,x.business_id,p_mode,p_lead_hours,p_channel from public.appointments x
 where x.business_id=a.business_id and coalesce(x.job_id,x.id)=coalesce(a.job_id,a.id) and x.starts_at=a.starts_at
 on conflict(appointment_id) do update set mode=excluded.mode,lead_hours=excluded.lead_hours,channel=excluded.channel;
 return public.get_appointment_reminder_override(p_business,p_appointment);
end $$;
create function public.record_appointment_sms_permission(p_business uuid,p_appointment uuid,p_consent boolean,p_expected_phone text) returns void language plpgsql security definer set search_path='' as $$
declare details jsonb;phone text;
begin
 details:=public.get_appointment_reminder_override(p_business,p_appointment);phone:=details->>'recipient_phone';
 if p_expected_phone is null or p_expected_phone is distinct from phone then raise exception 'Recipient changed. Review the current phone before confirming permission.' using errcode='23514';end if;
 if p_consent is distinct from true or phone is null then raise exception 'Confirm permission for this US mobile recipient.' using errcode='42501';end if;
 if (details->>'sms_opted_out')::boolean then raise exception 'This recipient opted out. They must reply START before receiving texts.' using errcode='42501';end if;
 insert into private.appointment_sms_permissions(business_id,phone,actor_id) values(p_business,phone,auth.uid()) on conflict do nothing;
end $$;

-- VOLATILE intentionally obtains fresh statement snapshots, including after a quota-lock wait.
create function private.appointment_reminder_snapshot(p_appointment uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare occurrence jsonb;a public.appointments;r private.appointment_reminder_rules;d private.managed_delivery_accounts;c public.customers;b public.businesses;lead integer;ch text;recipient text;body text;payload jsonb;
begin
 occurrence:=private.appointment_reminder_occurrence(p_appointment);
 if occurrence is null or occurrence->>'canonical_id' is null or occurrence->>'mode'='off' or (occurrence->>'occurrence_conflict')::boolean then return null;end if;
 select * into a from public.appointments where id=(occurrence->>'canonical_id')::uuid;
 if not found or a.status not in('scheduled','confirmed') or a.starts_at<=clock_timestamp() then return null;end if;
 -- Future visits have independent appointment starts; the parent job's first start is not authoritative for them.
 if a.job_id is not null and not exists(select 1 from public.jobs j where j.id=a.job_id and j.business_id=a.business_id and j.status not in('completed','canceled') and j.customer_id=a.customer_id) then return null;end if;
 -- Conflicting sibling customer identities cannot authorize a customer-facing message.
 if exists(select 1 from public.appointments x where x.business_id=a.business_id and coalesce(x.job_id,x.id)=coalesce(a.job_id,a.id) and x.starts_at=a.starts_at and x.customer_id is distinct from a.customer_id) then return null;end if;
 select * into r from private.appointment_reminder_rules where business_id=a.business_id;
 if not found or not r.enabled or not private.is_primary_owner(a.business_id,r.actor_id) or private.effective_plan(a.business_id)<>'pro' then return null;end if;
 lead:=case when occurrence->>'mode'='custom' then (occurrence->>'lead_hours')::integer else r.lead_hours end;ch:=case when occurrence->>'mode'='custom' then occurrence->>'channel' else r.channel end;
 if a.created_at>a.starts_at-make_interval(hours=>lead) then return null;end if;
 select * into d from private.managed_delivery_accounts where business_id=a.business_id;
 select * into c from public.customers where business_id=a.business_id and id=a.customer_id;
 if not found or c.archived or c.preferred_contact='none' then return null;end if;
 select * into b from public.businesses where id=a.business_id;
 if b.name is null or b.timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=b.timezone) then return null;end if;
 if ch='email' then
  recipient:=btrim(c.email);
  if not coalesce(d.email_active,false) or d.reply_to is null or d.reply_to !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' or recipient is null or recipient !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then return null;end if;
 else
  recipient:=regexp_replace(coalesce(c.phone,''),'[^0-9]','','g');if length(recipient)=10 then recipient:='1'||recipient;end if;recipient:='+'||recipient;
  if not coalesce(d.sms_active,false) or d.sms_from is null or d.sms_reply_route is null or not exists(select 1 from auth.users u where u.id=r.actor_id and u.email_confirmed_at is not null and u.phone_confirmed_at is not null and u.phone ~ '^\+?[1-9][0-9]{7,14}$') or recipient !~ '^\+1[0-9]{10}$'
   or not exists(select 1 from private.appointment_sms_permissions where business_id=a.business_id and phone=recipient) or exists(select 1 from private.sms_opt_outs where phone=recipient) then return null;end if;
 end if;
 body:=left(b.name,80)||': Appointment reminder for '||to_char(a.starts_at at time zone b.timezone,'Mon DD, YYYY HH24:MI')||' ('||b.timezone||'). Contact the business if you need to change your appointment.';
 if ch='sms' then body:=body||' Reply STOP to opt out.';end if;
 payload:=jsonb_build_object('from','Finviant Office <adminsupport@finviant.com>','to',jsonb_build_array(recipient),'subject','Appointment reminder','text',body);
 if nullif(d.reply_to,'') is not null then payload:=payload||jsonb_build_object('reply_to',jsonb_build_array(d.reply_to));end if;
 return jsonb_build_object('business_id',a.business_id,'actor_id',r.actor_id,'customer_id',c.id,'appointment_id',a.id,'occurrence_id',coalesce(a.job_id,a.id),'starts_at',a.starts_at,'due_at',a.starts_at-make_interval(hours=>lead),'lead_hours',lead,'mode',occurrence->>'mode','channel',ch,'recipient',recipient,'sender',case when ch='email' then 'Finviant Office <adminsupport@finviant.com>' else d.sms_from end,'subject','Appointment reminder','body',body,'payload',payload);
end $$;
create function public.prepare_due_appointment_reminders() returns integer language plpgsql security definer set search_path='' as $$
declare a record;s jsonb;n integer:=0;added integer;
begin
 perform pg_advisory_xact_lock(61109221000::bigint);
 for a in select id from public.appointments where starts_at>now() and starts_at<=now()+interval '720 hours' and status in('scheduled','confirmed') order by starts_at,id loop
  s:=private.appointment_reminder_snapshot(a.id);if s is null or (s->>'due_at')::timestamptz>now() then continue;end if;
  insert into private.appointment_reminder_queue(business_id,appointment_id,occurrence_id,starts_at,due_at,channel,snapshot)
  values((s->>'business_id')::uuid,(s->>'appointment_id')::uuid,(s->>'occurrence_id')::uuid,(s->>'starts_at')::timestamptz,(s->>'due_at')::timestamptz,s->>'channel',s) on conflict do nothing;
  get diagnostics added=row_count;n:=n+added;if n>=50 then exit;end if;
 end loop;return n;
end $$;
create function public.list_due_appointment_reminders(p_email_enabled boolean,p_sms_enabled boolean) returns table(id uuid,channel text) language sql stable security definer set search_path='' as $$
 select q.id,q.channel from private.appointment_reminder_queue q where status='queued' and due_at<=now() and ((q.channel='email' and p_email_enabled is true) or (q.channel='sms' and p_sms_enabled is true)) order by due_at,id limit 25
$$;
create function public.claim_appointment_reminder(p_request uuid,p_private_beta boolean default true) returns jsonb language plpgsql security definer set search_path='' as $$
declare q private.appointment_reminder_queue;s jsonb;fresh jsonb;units integer;gsm boolean;septets integer;
 gsm_base text:=E'@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&''()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
 gsm_extension text:=E'\f^{}\\[~]|€';
begin
 select * into q from private.appointment_reminder_queue where id=p_request for update;if not found then raise exception 'Reminder not found';end if;
 if q.status<>'queued' then return jsonb_build_object('id',q.id,'status',q.status);end if;
 perform pg_advisory_xact_lock(hashtextextended('appointment-reminder:'||q.business_id::text||':'||q.occurrence_id::text||':'||extract(epoch from q.starts_at)::text,0));
 s:=private.appointment_reminder_snapshot(q.appointment_id);
 if s is null or s is distinct from q.snapshot or q.due_at>now() then
  update private.appointment_reminder_queue set status='blocked',last_error='Appointment, settings, recipient, consent or access changed.',updated_at=now() where id=q.id;
  return jsonb_build_object('id',q.id,'status','blocked');end if;
 if q.channel='email' and p_private_beta is distinct from false and not coalesce(private.private_beta_email_payload_allowed(q.business_id,s->'payload'),false) then
  update private.appointment_reminder_queue set status='blocked',last_error='Private beta recipient not approved.',updated_at=now() where id=q.id;
  return jsonb_build_object('id',q.id,'status','blocked');end if;
 select bool_and(strpos(gsm_base,ch)>0 or strpos(gsm_extension,ch)>0),sum(case when strpos(gsm_extension,ch)>0 then 2 else 1 end)::integer,sum(case when ascii(ch)>65535 then 2 else 1 end)::integer
 into gsm,septets,units from (select substr(s->>'body',i,1) ch from generate_series(1,length(s->>'body')) i) chars;
 units:=case when q.channel='email' then 1 when gsm then case when septets<=160 then 1 else ceil(septets/153.0)::integer end when units<=70 then 1 else ceil(units/67.0)::integer end;
 -- An exception rolls the reservation back before the durable blocked result is recorded.
 begin
  perform private.reserve_tier_usage(q.business_id,q.id,q.channel,units);
  fresh:=private.appointment_reminder_snapshot(q.appointment_id);
  if fresh is null or fresh is distinct from s then raise exception 'REMINDER_CHANGED_DURING_RESERVATION';end if;
  if q.channel='email' and p_private_beta is distinct from false and not coalesce(private.private_beta_email_payload_allowed(q.business_id,fresh->'payload'),false) then raise exception 'REMINDER_BETA_CHANGED_DURING_RESERVATION';end if;
 exception when others then
  update private.appointment_reminder_queue set status='blocked',last_error='Delivery allowance unavailable or eligibility changed during reservation.',updated_at=now() where id=q.id;
  return jsonb_build_object('id',q.id,'status','blocked');
 end;
 update private.appointment_reminder_queue set status='sending',updated_at=now() where id=q.id;
 return s||jsonb_build_object('id',q.id,'status','claimed','segments',units);
end $$;
create function public.finish_appointment_reminder(p_request uuid,p_status text,p_provider text) returns void language plpgsql security definer set search_path='' as $$
declare q private.appointment_reminder_queue;
begin
 if p_status is null or p_status not in('accepted','failed','uncertain') or length(coalesce(p_provider,''))>200 then raise exception 'Invalid provider result';end if;
 select * into q from private.appointment_reminder_queue where id=p_request for update;if not found or q.status<>'sending' then return;end if;
 if p_status='accepted' and (p_provider is null or (q.channel='sms' and p_provider !~ '^SM[0-9a-fA-F]{32}$') or (q.channel='email' and p_provider !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')) then raise exception 'Valid provider receipt required';end if;
 update private.appointment_reminder_queue set status=p_status,provider_id=p_provider,updated_at=now() where id=q.id;
 if p_status='accepted' then
  insert into public.messages(id,business_id,customer_id,direction,channel,recipient,subject,body,provider,provider_message_id,status,sent_at)
  values(q.id,q.business_id,(q.snapshot->>'customer_id')::uuid,'outbound',q.channel,q.snapshot->>'recipient',q.snapshot->>'subject',q.snapshot->>'body',case when q.channel='email' then 'resend' else 'twilio' end,p_provider,'sent',now()) on conflict(id) do nothing;
 end if;
end $$;
revoke all on function private.appointment_reminder_occurrence(uuid),private.appointment_reminder_snapshot(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_appointment_reminder_settings(uuid),public.save_appointment_reminder_settings(uuid,boolean,integer,text),public.get_appointment_reminder_override(uuid,uuid),public.save_appointment_reminder_override(uuid,uuid,text,integer,text),public.record_appointment_sms_permission(uuid,uuid,boolean,text) from public,anon,service_role;
grant execute on function public.get_appointment_reminder_settings(uuid),public.save_appointment_reminder_settings(uuid,boolean,integer,text),public.get_appointment_reminder_override(uuid,uuid),public.save_appointment_reminder_override(uuid,uuid,text,integer,text),public.record_appointment_sms_permission(uuid,uuid,boolean,text) to authenticated;
revoke all on function public.prepare_due_appointment_reminders(),public.list_due_appointment_reminders(boolean,boolean),public.claim_appointment_reminder(uuid,boolean),public.finish_appointment_reminder(uuid,text,text) from public,anon,authenticated;
grant execute on function public.prepare_due_appointment_reminders(),public.list_due_appointment_reminders(boolean,boolean),public.claim_appointment_reminder(uuid,boolean),public.finish_appointment_reminder(uuid,text,text) to service_role;
