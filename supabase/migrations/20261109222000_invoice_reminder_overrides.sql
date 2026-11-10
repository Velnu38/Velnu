-- Invoice preferences never enable the owner's master automatic sending switch.
create table private.invoice_reminder_preferences (
 business_id uuid not null references public.businesses(id) on delete cascade,
 invoice_id uuid primary key references public.invoices(id) on delete cascade,
 mode text not null check(mode in('inherit','off','custom')),
 after_days integer not null check(after_days between 1 and 30),
 repeat_days integer not null check(repeat_days between 3 and 30),
 max_reminders integer not null check(max_reminders between 1 and 5),
 updated_at timestamptz not null default now()
);
alter table private.invoice_reminder_preferences enable row level security;
revoke all on private.invoice_reminder_preferences from public,anon,authenticated,service_role;
create policy no_client_access on private.invoice_reminder_preferences to authenticated using(false);
create function public.get_invoice_reminder_preference(p_business uuid,p_invoice uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare preference private.invoice_reminder_preferences;rule private.reminder_rules;
begin
 if not private.fin_access(p_business,'invoices',true) then raise exception 'Billing management access required' using errcode='42501';end if;
 if not exists(select 1 from public.invoices where business_id=p_business and id=p_invoice) then raise exception 'Invoice unavailable' using errcode='42501';end if;
 select * into preference from private.invoice_reminder_preferences where business_id=p_business and invoice_id=p_invoice;
 select * into rule from private.reminder_rules where business_id=p_business;
 return jsonb_build_object('mode',coalesce(preference.mode,'inherit'),'after_days',coalesce(preference.after_days,rule.after_days,2),
 'repeat_days',coalesce(preference.repeat_days,rule.repeat_days,7),'max_reminders',coalesce(preference.max_reminders,rule.max_reminders,3),
 'master_enabled',coalesce(rule.enabled,false),'defaults',jsonb_build_object('after_days',coalesce(rule.after_days,2),'repeat_days',coalesce(rule.repeat_days,7),'max_reminders',coalesce(rule.max_reminders,3)));
end $$;
create function public.save_invoice_reminder_preference(p_business uuid,p_invoice uuid,p_mode text,p_after integer,p_repeat integer,p_max integer) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not private.fin_access(p_business,'invoices',true) then raise exception 'Billing management access required' using errcode='42501';end if;
 if not exists(select 1 from public.invoices where business_id=p_business and id=p_invoice) then raise exception 'Invoice unavailable' using errcode='42501';end if;
 if p_mode is null or p_mode not in('inherit','off','custom') or p_after is null or p_after not between 1 and 30 or p_repeat is null or p_repeat not between 3 and 30 or p_max is null or p_max not between 1 and 5 then raise exception 'Choose valid invoice reminder timing.' using errcode='22023';end if;
 insert into private.invoice_reminder_preferences(business_id,invoice_id,mode,after_days,repeat_days,max_reminders)
 values(p_business,p_invoice,p_mode,p_after,p_repeat,p_max)
 on conflict(invoice_id) do update set mode=excluded.mode,after_days=excluded.after_days,repeat_days=excluded.repeat_days,max_reminders=excluded.max_reminders,updated_at=now();
 return public.get_invoice_reminder_preference(p_business,p_invoice);
end $$;
revoke all on function public.get_invoice_reminder_preference(uuid,uuid),public.save_invoice_reminder_preference(uuid,uuid,text,integer,integer,integer) from public,anon,service_role;
grant execute on function public.get_invoice_reminder_preference(uuid,uuid),public.save_invoice_reminder_preference(uuid,uuid,text,integer,integer,integer) to authenticated;
-- Shared eligibility is evaluated when queuing and immediately before claiming.
create function private.invoice_automatic_reminder_eligible(p_business uuid,p_invoice uuid,p_actor uuid,p_request uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
 select 1 from public.invoices i join public.businesses b on b.id=i.business_id
 join public.customers c on c.id=i.customer_id and c.business_id=i.business_id and c.archived is false and c.preferred_contact is distinct from 'none'
 join private.reminder_rules rules on rules.business_id=i.business_id and rules.enabled and rules.actor_id=p_actor
 join private.managed_delivery_accounts a on a.business_id=i.business_id and a.email_active
 left join private.invoice_reminder_preferences pref on pref.business_id=i.business_id and pref.invoice_id=i.id
 where i.id=p_invoice and i.business_id=p_business and private.is_primary_owner(p_business,p_actor)
 and private.effective_plan(i.business_id)='pro' and i.status in('sent','viewed','partial','overdue') and i.balance_due>0
 and coalesce(pref.mode,'inherit')<>'off'
 and i.due_date<=(now() at time zone coalesce(nullif(b.timezone,''),'UTC'))::date-(case when pref.mode='custom' then pref.after_days else rules.after_days end)
 and (select count(*) from private.delivery_tasks d where d.business_id=i.business_id and d.document_id=i.id and d.reminder and d.status<>'canceled' and d.id is distinct from p_request)<(case when pref.mode='custom' then pref.max_reminders else rules.max_reminders end)
 and not exists(select 1 from private.delivery_tasks d where d.business_id=i.business_id and d.document_id=i.id and d.reminder and d.status<>'canceled' and d.id is distinct from p_request and (d.created_at>now()-make_interval(days=>(case when pref.mode='custom' then pref.repeat_days else rules.repeat_days end)) or d.status in('scheduled','blocked')))
 );
$$;
revoke all on function private.invoice_automatic_reminder_eligible(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
create or replace function public.prepare_due_delivery_tasks() returns integer language plpgsql security definer set search_path='' as $$
declare r record;t private.delivery_tasks;snap jsonb;n integer:=0;
begin
 perform pg_advisory_xact_lock(61106151510::bigint);
 for r in select i.id,i.business_id,rules.actor_id from public.invoices i join private.reminder_rules rules on rules.business_id=i.business_id and rules.enabled
  where private.invoice_automatic_reminder_eligible(i.business_id,i.id,rules.actor_id)
  order by i.due_date,i.id limit 10
 loop
  insert into private.delivery_tasks(business_id,actor_id,kind,document_id,due_at,reminder) values(r.business_id,r.actor_id,'invoice',r.id,now(),true);
 end loop;
 for t in select * from private.delivery_tasks where status='scheduled' and due_at<=now() order by due_at,id limit 10 for update skip locked
 loop
  begin
   if private.effective_plan(t.business_id)<>'pro' then raise exception 'Business Pro access is no longer active.';end if;
   if t.reminder then
    if not private.invoice_automatic_reminder_eligible(t.business_id,t.document_id,t.actor_id,t.id) then update private.delivery_tasks set status='canceled' where id=t.id;continue;end if;
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
-- Preserve the PDF-aware wrapper and its downstream document and entitlement checks.
alter function public.claim_document_email(uuid,boolean) set schema private;
alter function private.claim_document_email(uuid,boolean) rename to claim_document_email_before_invoice_preferences;
revoke all on function private.claim_document_email_before_invoice_preferences(uuid,boolean) from public,anon,authenticated,service_role;
create function public.claim_document_email(p_request uuid,p_pdf_capable boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o private.finviant_email_outbox%rowtype;
begin
 select * into o from private.finviant_email_outbox where id=p_request for update;
 if found and exists(select 1 from private.delivery_tasks t where t.id=o.id and t.business_id=o.business_id and t.document_id=o.document_id and t.kind='invoice' and t.reminder) then
  if o.status in('uncertain','accepted','delivered') then
   return jsonb_build_object('id',o.id,'status',o.status,'provider_id',o.provider_id,'recipient',o.payload->'to'->>0);
  end if;
  -- An earlier provider attempt may have happened; never mutate that uncertain outcome.
  if o.status='sending' and not exists(select 1 from private.delivery_tasks t where t.id=o.id and private.invoice_automatic_reminder_eligible(t.business_id,t.document_id,t.actor_id,t.id)) then
   return jsonb_build_object('id',o.id,'status','busy');
  end if;
  if o.status='queued' and not exists(select 1 from private.delivery_tasks t where t.id=o.id and private.invoice_automatic_reminder_eligible(t.business_id,t.document_id,t.actor_id,t.id)) then
   update private.finviant_email_outbox set status='reconciliation_required',last_code='automatic_reminder_settings_changed' where id=o.id;
   update private.delivery_tasks set status='canceled',last_error='Automatic reminder eligibility changed before sending.' where id=o.id;
   return jsonb_build_object('id',o.id,'status','reconciliation_required');
  end if;
 end if;
 return private.claim_document_email_before_invoice_preferences(p_request,p_pdf_capable);
end $$;
revoke all on function public.claim_document_email(uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_document_email(uuid,boolean) to service_role;
