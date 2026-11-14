-- Canonical journey facts and durable activity. No provider or rule is enabled here.
create table private.workflow_events (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 job_id uuid, invoice_id uuid, revision_id uuid,
 kind text not null check(kind in('job_created','work_started','work_completed','work_canceled','work_reopened','appointment_booked','appointment_changed','appointment_canceled','invoice_opened','payment_received','payment_changed')),
 event_key text not null,
 facts jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 foreign key(job_id,business_id) references public.jobs(id,business_id) on delete cascade,
 foreign key(invoice_id,business_id) references public.invoices(id,business_id) on delete cascade,
 unique(business_id,event_key)
);
alter table private.workflow_events enable row level security;
revoke all on private.workflow_events from public,anon,authenticated,service_role;
create index workflow_events_job on private.workflow_events(business_id,job_id,created_at desc,id desc);
create index workflow_events_invoice on private.workflow_events(business_id,invoice_id,created_at desc,id desc);

create function private.journey_payment_state(p_invoice uuid) returns text
language sql stable security definer set search_path='' as $$
 select case
 when exists(select 1 from private.customer_invoice_checkouts where invoice_id=p_invoice and status='review_required')
   or exists(select 1 from private.square_invoice_operations where invoice_id=p_invoice and status='review_required') then 'review'
 when exists(select 1 from private.customer_invoice_checkouts where invoice_id=p_invoice and (status='pending' or status in('reserved','open') and expires_at>now()))
   or exists(select 1 from private.square_invoice_operations where invoice_id=p_invoice and status in('reserved','open','pending')) then 'pending'
 else 'none' end;
$$;
revoke all on function private.journey_payment_state(uuid) from public,anon,authenticated,service_role;

create function private.job_journey_facts(p_business uuid,p_job uuid,p_work jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare j public.jobs%rowtype; e public.estimates%rowtype; i public.invoices%rowtype; dep public.invoices%rowtype;
 bill boolean:=coalesce((p_work->>'billing_access')::boolean,false); invoice_count integer; delivery text; approval text; priced boolean; deposit text:='not_required';
begin
 select * into j from public.jobs where business_id=p_business and id=p_job;
 if not found then raise exception 'Job unavailable' using errcode='42501';end if;
 select * into e from public.estimates where business_id=p_business and (id=j.source_estimate_id or job_id=j.id) order by (id=j.source_estimate_id) desc nulls last,(status in('accepted','converted')) desc,created_at desc,id limit 1;
 approval:=case when e.id is null then 'not_required' when e.status in('accepted','converted') then 'approved' when e.status='declined' then 'declined' else 'pending' end;
 priced:=e.id is not null and e.status in('accepted','converted');
 if bill then
  select count(*) into invoice_count from public.invoices where business_id=p_business and job_id=j.id and deposit_estimate_id is null and status<>'void';
  select * into i from public.invoices where business_id=p_business and job_id=j.id and deposit_estimate_id is null and status<>'void'
   order by (status<>'paid') desc,created_at,id limit 1;
  priced:=priced or i.id is not null;
  select * into dep from public.invoices where business_id=p_business and deposit_estimate_id=e.id and status<>'void' order by created_at,id limit 1;
  if dep.id is not null then deposit:=case when dep.status='paid' and dep.balance_due<=0 then 'paid' when private.journey_payment_state(dep.id)='review' then 'review' when private.journey_payment_state(dep.id)='pending' then 'pending' else 'unpaid' end;end if;
  select case when o.status='reconciliation_required' then 'uncertain' else o.status end into delivery
   from private.finviant_email_outbox o where o.business_id=p_business and o.document_id=i.id and o.document_kind in('invoice','invoice_reminder') order by o.created_at desc,o.id limit 1;
 end if;
 return jsonb_build_object(
  'workStatus',j.status,'approval',approval,'deposit',deposit,
  'hasVisit',exists(select 1 from public.appointments a where a.business_id=p_business and a.job_id=j.id and a.status in('scheduled','confirmed','in_progress')),
  'remainingVisits',(select count(*) from public.appointments a where a.business_id=p_business and a.job_id=j.id and a.status in('scheduled','confirmed','in_progress')),
  'unfinishedTasks',(select count(*) from jsonb_array_elements(coalesce(p_work->'tasks','[]')) t where coalesce((t->>'completed')::boolean,false) is false),
  'missingMaterials',(select count(*) from jsonb_array_elements(coalesce(p_work->'materials','[]')) m where m->>'status' in('needed','ordered')),
  'pendingChanges',case when bill then (select count(*) from jsonb_array_elements(coalesce(p_work->'changes','[]')) c where c->>'status' in('draft','sent') or c->>'status'='approved' and c->>'billing_action' in('add_to_draft','create_invoice','verify_existing','manual_review')) else 0 end,
  'pricingAgreed',case when bill then priced else false end,'billingVisible',bill,
  'estimateId',case when bill then e.id else null end,'depositInvoiceId',case when bill then dep.id else null end,
  'invoice',case when bill and i.id is not null then jsonb_build_object('id',i.id,'status',i.status,'balanceDue',i.balance_due) else null end,
  'payment',case when not bill then 'none' when invoice_count>1 then 'review' else coalesce(private.journey_payment_state(i.id),'none') end,
  'delivery',case when bill and delivery in('queued','sending','accepted','delivered','failed','uncertain') then delivery else 'none' end);
end $$;
revoke all on function private.job_journey_facts(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

-- Reuse the existing session, tenant, role and module authorization and existing reads.
alter function private.get_job_management(uuid,uuid) rename to get_job_management_before_journey;
revoke all on function private.get_job_management_before_journey(uuid,uuid) from public,anon,authenticated,service_role;
create function private.get_job_management(p_business uuid,p_job uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare work jsonb;
begin
 work:=private.get_job_management_before_journey(p_business,p_job);
 return work||jsonb_build_object('journey',private.job_journey_facts(p_business,p_job,work));
end $$;
revoke all on function private.get_job_management(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.get_job_management(uuid,uuid) to authenticated;

create function private.capture_job_journey() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text;
begin
 if tg_op='INSERT' then kind:='job_created';
 elsif new.status is not distinct from old.status then return new;
 else kind:=case new.status when 'in_progress' then 'work_started' when 'completed' then 'work_completed' when 'canceled' then 'work_canceled' else 'work_reopened' end;end if;
 insert into private.workflow_events(business_id,job_id,kind,event_key,facts)
 values(new.business_id,new.id,kind,'job:'||new.id||':'||kind||':'||txid_current(),jsonb_build_object('status',new.status)) on conflict do nothing;
 return new;
end $$;
revoke all on function private.capture_job_journey() from public,anon,authenticated,service_role;
create trigger capture_job_journey after insert or update of status on public.jobs for each row execute function private.capture_job_journey();

create function private.capture_visit_journey() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text;previous_start timestamptz;previous_end timestamptz;
begin
 if new.job_id is null then return new;end if;
 if tg_op='UPDATE' then
  if (new.starts_at,new.ends_at,new.status,new.customer_id) is not distinct from (old.starts_at,old.ends_at,old.status,old.customer_id) then return new;end if;
  previous_start:=old.starts_at;previous_end:=old.ends_at;
 end if;
 if new.status='canceled' and exists(select 1 from public.appointments a where a.business_id=new.business_id and a.job_id=new.job_id and a.starts_at=new.starts_at and a.ends_at=new.ends_at and a.id<>new.id and a.status in('scheduled','confirmed','in_progress')) then return new;end if;
 kind:=case when new.status='canceled' and (tg_op='INSERT' or old.status<>'canceled') then 'appointment_canceled'
  when tg_op='UPDATE' and new.status in('scheduled','confirmed') and (new.starts_at,new.ends_at) is distinct from (previous_start,previous_end) then 'appointment_changed'
  when new.status in('scheduled','confirmed') and (tg_op='INSERT' or old.status in('canceled','no_show') or new.status='confirmed' and old.status='scheduled') then 'appointment_booked' end;
 if kind is null then return new;end if;
 insert into private.workflow_events(business_id,job_id,kind,event_key,facts)
 values(new.business_id,new.job_id,kind,'visit:'||new.job_id||':'||kind||':'||coalesce(previous_start::text,'new')||':'||coalesce(previous_end::text,'new')||':'||new.starts_at||':'||new.ends_at||':'||txid_current(),
  jsonb_build_object('appointment_id',new.id,'customer_id',new.customer_id,'starts_at',new.starts_at,'ends_at',new.ends_at,'previous_start',previous_start,'previous_end',previous_end,'status',new.status)) on conflict do nothing;
 return new;
end $$;
revoke all on function private.capture_visit_journey() from public,anon,authenticated,service_role;
create trigger capture_visit_journey after insert or update of starts_at,ends_at,status,customer_id on public.appointments for each row execute function private.capture_visit_journey();

create function private.capture_invoice_journey() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text;j uuid;
begin
 if (new.amount_paid,new.balance_due,new.status) is not distinct from (old.amount_paid,old.balance_due,old.status) then return new;end if;
 if new.amount_paid is distinct from old.amount_paid then
  kind:=case when new.amount_paid>old.amount_paid then 'payment_received' else 'payment_changed' end;
  j:=new.job_id;
  if j is null and new.deposit_estimate_id is not null then select id into j from public.jobs where business_id=new.business_id and source_estimate_id=new.deposit_estimate_id;end if;
  insert into private.workflow_events(business_id,job_id,invoice_id,kind,event_key,facts)
  values(new.business_id,j,new.id,kind,'invoice:'||new.id||':'||kind||':'||txid_current()||':'||old.amount_paid||':'||new.amount_paid||':'||new.balance_due,jsonb_build_object('amount_paid',new.amount_paid,'balance_due',new.balance_due,'deposit',new.deposit_estimate_id is not null)) on conflict(business_id,event_key) do nothing;
 end if;
 if new.status in('paid','void') then
  -- A queued operation can be stopped. A claimed/in-flight operation retains its outcome.
  update private.finviant_email_outbox o set status='reconciliation_required',last_code='invoice_settled_or_void'
   where o.business_id=new.business_id and o.document_id=new.id and o.status='queued'
    and (o.document_kind='invoice_reminder' or exists(select 1 from private.delivery_tasks t where t.id=o.id and t.business_id=new.business_id and t.reminder));
  update private.delivery_tasks set status='canceled',last_error='Invoice settled or voided before dispatch.'
   where business_id=new.business_id and document_id=new.id and reminder and status in('scheduled','blocked','queued');
 end if;
 return new;
end $$;
revoke all on function private.capture_invoice_journey() from public,anon,authenticated,service_role;
create trigger capture_invoice_journey after update of amount_paid,status on public.invoices for each row execute function private.capture_invoice_journey();

-- This narrow capability logs the opened issued revision, never a token, IP or user agent.
create function public.record_customer_invoice_open(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare doc jsonb;context jsonb;i public.invoices%rowtype;version uuid;
begin
 doc:=public.get_shared_document(p_token); -- Retain current public-link validation and ingress controls.
 context:=private.document_share_context(encode(sha256(convert_to(p_token,'UTF8')),'hex'));
 if context->>'kind'<>'invoice' or context->>'revision_id' is null then return jsonb_build_object('recorded',false);end if;
 select * into i from public.invoices where business_id=(context->>'business_id')::uuid and id=(context->>'document_id')::uuid for update;
 if not found or i.status not in('sent','viewed','partial','overdue','paid') then return jsonb_build_object('recorded',false);end if;
 version:=(context->>'revision_id')::uuid;
 if not exists(select 1 from private.document_shares where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and business_id=i.business_id and document_id=i.id and kind='invoice' and revision_id=version and revoked_at is null and expires_at>now()) then return jsonb_build_object('recorded',false);end if;
 insert into private.workflow_events(business_id,job_id,invoice_id,revision_id,kind,event_key,facts)
 values(i.business_id,i.job_id,i.id,version,'invoice_opened','opened:'||version,jsonb_build_object('superseded',coalesce((context->>'superseded')::boolean,false))) on conflict do nothing;
 if i.status='sent' and coalesce((context->>'superseded')::boolean,true) is false
  and exists(select 1 from private.document_versions where id=version and business_id=i.business_id and kind='invoice' and document_id=i.id and superseded_at is null) then
  update public.invoices set status='viewed' where id=i.id and business_id=i.business_id and status='sent' and balance_due>0;
 end if;
 return jsonb_build_object('recorded',true);
end $$;
revoke all on function public.record_customer_invoice_open(text) from public,anon,authenticated,service_role;
grant execute on function public.record_customer_invoice_open(text) to anon,authenticated;

create function public.get_workflow_activity(p_business uuid,p_job uuid default null,p_invoice uuid default null,p_page integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare jobs boolean;billing boolean;result jsonb;
begin
 jobs:=coalesce(private.member_module_access(p_business,auth.uid(),'jobs'),false);
 billing:=coalesce(private.member_module_access(p_business,auth.uid(),'billing') and private.has_business_role(p_business,array['owner','admin','office']),false);
 if auth.uid() is null or not(jobs or billing) or p_page is null or p_page not between 0 and 10000 then raise exception 'Workflow access required' using errcode='42501';end if;
 if p_job is not null and (not jobs or not exists(select 1 from public.jobs where id=p_job and business_id=p_business)) then raise exception 'Job access required' using errcode='42501';end if;
 if p_invoice is not null and (not billing or not exists(select 1 from public.invoices where id=p_invoice and business_id=p_business)) then raise exception 'Invoice access required' using errcode='42501';end if;
 with allowed as materialized(select e.id,e.job_id,e.invoice_id,e.kind,e.created_at,e.revision_id from private.workflow_events e
  where e.business_id=p_business and (p_job is null or e.job_id=p_job) and(p_invoice is null or e.invoice_id=p_invoice)
   and (billing or e.invoice_id is null) and(jobs or e.invoice_id is not null)),
 page as(select * from allowed order by created_at desc,id desc limit 25 offset p_page*25)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x) order by created_at desc,id desc) from page x),'[]'::jsonb),'total',(select count(*) from allowed),'page',p_page,'page_size',25) into result;
 return result;
end $$;
revoke all on function public.get_workflow_activity(uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_workflow_activity(uuid,uuid,uuid,integer) to authenticated;

-- Preserve owner export coverage for the new business record without exporting capabilities.
alter function private.owner_archive_sources(uuid,uuid) rename to owner_archive_sources_before_journey;
create function private.owner_archive_sources(b uuid,owner_id uuid) returns table(collection text,payload jsonb)
language sql stable security definer set search_path='' as $$
 select * from private.owner_archive_sources_before_journey(b,owner_id)
 union all
 select 'private.workflow_events'::text,to_jsonb(e) from private.workflow_events e where e.business_id=b;
$$;
revoke all on function private.owner_archive_sources_before_journey(uuid,uuid),private.owner_archive_sources(uuid,uuid) from public,anon,authenticated,service_role;

-- Revalidate pending/uncertain payments at queue preparation and the final reminder claim.
alter function private.invoice_automatic_reminder_eligible(uuid,uuid,uuid,uuid) rename to invoice_reminder_eligible_before_journey;
create function private.invoice_automatic_reminder_eligible(p_business uuid,p_invoice uuid,p_actor uuid,p_request uuid default null) returns boolean
language sql volatile security definer set search_path='' as $$
 select private.invoice_reminder_eligible_before_journey(p_business,p_invoice,p_actor,p_request) and private.journey_payment_state(p_invoice)='none';
$$;
revoke all on function private.invoice_reminder_eligible_before_journey(uuid,uuid,uuid,uuid),private.invoice_automatic_reminder_eligible(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
