-- Record detail actions share authoritative work/payment state. Read projections
-- do not expose provider identifiers or grant access to another module's data.
create function private.require_record_module(b uuid,feature text,writing boolean default false) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or feature not in('jobs','billing','calendar')
   or not coalesce(private.is_business_member(b),false)
   or not coalesce(private.member_module_access(b,auth.uid(),feature),false)
   or (writing and not coalesce(private.can_write_business(b),false))
   or (feature='billing' and not exists(select 1 from public.business_members where business_id=b and user_id=auth.uid() and role in('owner','admin','office'))) then
   raise exception 'Record access is required.' using errcode='42501';end if;
end $$;
revoke all on function private.require_record_module(uuid,text,boolean) from public,anon,authenticated,service_role;

create table private.record_action_requests(
 business_id uuid not null references public.businesses(id) on delete cascade,
 action text not null check(action in('reopen_job','revise_estimate')),
 request_id uuid not null,actor_id uuid not null references auth.users(id),source_id uuid not null,
 result jsonb not null,created_at timestamptz not null default now(),transaction_id xid8 not null default pg_current_xact_id(),
 primary key(business_id,action,request_id)
);
alter table private.record_action_requests enable row level security;
revoke all on private.record_action_requests from public,anon,authenticated,service_role;

create function private.guard_reviewed_job_reopen() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.status in('completed','canceled') and new.status in('lead','scheduled','in_progress') and not exists(
  select 1 from private.record_action_requests r where r.business_id=old.business_id and r.action='reopen_job'
   and r.source_id=old.id and r.actor_id=auth.uid() and r.transaction_id=pg_current_xact_id()
 ) then raise exception 'Use Reopen job to review a new appointment for closed work.' using errcode='23514';end if;
 return new;
end $$;
create trigger reviewed_job_reopen before update of status on public.jobs for each row execute function private.guard_reviewed_job_reopen();
revoke all on function private.guard_reviewed_job_reopen() from public,anon,authenticated,service_role;

create function public.get_job_workflow_context(p_business uuid,p_jobs uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;billing boolean;
begin
 perform private.require_record_module(p_business,'jobs');
 if p_jobs is null or cardinality(p_jobs)>200 then raise exception 'Choose at most 200 jobs.' using errcode='22023';end if;
 billing:=coalesce(private.member_module_access(p_business,auth.uid(),'billing'),false) and exists(
  select 1 from public.business_members where business_id=p_business and user_id=auth.uid() and role in('owner','admin','office'));
 select coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,
  'active_appointment',(select jsonb_build_object('id',a.id,'status',a.status,'starts_at',a.starts_at,'ends_at',a.ends_at)
   from public.appointments a where a.business_id=p_business and a.job_id=j.id and a.status in('scheduled','confirmed','in_progress') order by a.starts_at desc,a.id limit 1),
  'invoice',case when billing then (select jsonb_build_object('id',i.id,'status',i.status,'number',i.invoice_number,'balance_due',i.balance_due)
   from public.invoices i where i.business_id=p_business and i.status<>'void' and i.deposit_estimate_id is null
   and (i.job_id=j.id or i.estimate_id=j.source_estimate_id) order by (i.job_id=j.id) desc nulls last,i.created_at desc,i.id limit 1) end
 ) order by j.id),'[]'::jsonb) into result from public.jobs j where j.business_id=p_business and j.id=any(p_jobs);
 return result;
end $$;

create function public.get_estimate_workflow_context(p_business uuid,p_estimates uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;jobs_allowed boolean;calendar_allowed boolean;
begin
 perform private.require_record_module(p_business,'billing');
 if p_estimates is null or cardinality(p_estimates)>200 then raise exception 'Choose at most 200 estimates.' using errcode='22023';end if;
 jobs_allowed:=coalesce(private.member_module_access(p_business,auth.uid(),'jobs'),false);
 calendar_allowed:=coalesce(private.member_module_access(p_business,auth.uid(),'calendar'),false);
 select coalesce(jsonb_agg(jsonb_build_object('estimate_id',e.id,
  'job',case when jobs_allowed then (select jsonb_build_object('id',j.id,'title',j.title,'status',j.status,'scheduled_start',j.scheduled_start,'scheduled_end',j.scheduled_end,'assigned_user_ids',j.assigned_user_ids)
    from public.jobs j where j.business_id=p_business and j.id=e.job_id) end,
  'appointment',case when jobs_allowed then (select jsonb_build_object('id',a.id,'status',a.status,'starts_at',a.starts_at,'ends_at',a.ends_at)
    from public.appointments a where a.business_id=p_business and a.job_id=e.job_id and a.status in('scheduled','confirmed','in_progress') order by a.starts_at desc,a.id limit 1) end,
  'schedule',case when calendar_allowed then (select jsonb_build_object('id',d.id,'status',d.status,'scheduled_start_time',d.scheduled_start_time,'scheduled_end_time',d.scheduled_end_time,'timezone',d.timezone)
    from public.document_schedules d where d.business_id=p_business and d.estimate_id=e.id and d.status in('planned','scheduled') order by d.scheduled_start_time desc,d.id limit 1) end,
  'invitation',case when jobs_allowed and calendar_allowed then (select jsonb_build_object('id',o.id,'status',case when o.status='approved' and o.expires_at<=now() then 'expired' else o.status end,'expires_at',o.expires_at)
    from private.scheduling_offers o where o.business_id=p_business and o.estimate_id=e.id and o.status<>'revoked' order by o.approved_at desc,o.id limit 1) end,
  'final_invoice_id',(select i.id from public.invoices i where i.business_id=p_business and i.estimate_id=e.id and i.deposit_estimate_id is null order by (i.status<>'void') desc,i.created_at desc,i.id limit 1)
 ) order by e.id),'[]'::jsonb) into result from public.estimates e where e.business_id=p_business and e.id=any(p_estimates);
 return result;
end $$;

create function public.get_invoice_payment_operations(p_business uuid,p_invoice uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare state text;refunds jsonb;
begin
 perform private.require_record_module(p_business,'billing');
 if not exists(select 1 from public.invoices where id=p_invoice and business_id=p_business) then raise exception 'Invoice unavailable.' using errcode='42501';end if;
 state:=case when exists(select 1 from private.customer_invoice_checkouts where business_id=p_business and invoice_id=p_invoice and status='review_required') then 'review_required'
  when exists(select 1 from private.customer_invoice_checkouts where business_id=p_business and invoice_id=p_invoice and status='pending') then 'pending' else 'clear' end;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.refund_id,'amount',r.amount_minor/100.0,'refunded_at',r.refunded_at,'currency',c.currency) order by r.refunded_at,r.refund_id),'[]'::jsonb)
 into refunds from private.customer_invoice_refunds r join private.customer_invoice_checkouts c on c.id=r.checkout_id where c.business_id=p_business and c.invoice_id=p_invoice;
 return jsonb_build_object('state',state,'refunds',refunds,'message',case state
  when 'pending' then 'A customer payment is processing. Wait for confirmation before recording another payment.'
  when 'review_required' then 'An online payment or refund needs reconciliation. Review the payment before recording another.' end);
end $$;

create function public.reopen_job(p_job uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.jobs%rowtype;b uuid;saved private.record_action_requests%rowtype;result jsonb;workers uuid[];
begin
 select business_id into b from public.jobs where id=p_job;
 perform private.require_record_module(b,'jobs',true);
 if p_request is null or not private.can_manage_schedule(b) then raise exception 'Dispatch access and a saved request are required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
 select * into j from public.jobs where id=p_job and business_id=b for update;
 select * into saved from private.record_action_requests where business_id=b and action='reopen_job' and request_id=p_request;
 if found then
  if saved.actor_id<>auth.uid() or saved.source_id<>p_job then raise exception 'This request belongs to another action.' using errcode='23505';end if;
  return saved.result||jsonb_build_object('already_reopened',true,'status',j.status);end if;
 if j.status not in('completed','canceled') then raise exception 'This job is already open. Refresh its current appointment.' using errcode='23514';end if;
 workers:=j.assigned_user_ids;
 if cardinality(workers)>0 then
  begin perform private.validate_scheduling_workers(b,workers);
  exception when insufficient_privilege or invalid_parameter_value then workers:='{}'::uuid[];end;
 end if;
 -- Preserve closed appointments and invoices as history. A fresh reviewed
 -- appointment is required; reopening never silently restores an old time.
 update public.appointments set status='canceled' where business_id=b and job_id=j.id and status in('scheduled','confirmed','in_progress');
 result:=jsonb_build_object('job_id',j.id,'status','lead','already_reopened',false,'reopened_from',jsonb_build_object(
  'status',j.status,'completed_at',j.completed_at,'scheduled_start',j.scheduled_start,'scheduled_end',j.scheduled_end,'assigned_user_ids',j.assigned_user_ids));
 insert into private.record_action_requests(business_id,action,request_id,actor_id,source_id,result) values(b,'reopen_job',p_request,auth.uid(),j.id,result);
 update public.jobs set status='lead',completed_at=null,scheduled_start=null,scheduled_end=null,assigned_user_ids=workers where id=j.id and business_id=b;
 return result;
end $$;

create function public.create_revised_estimate(p_estimate uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.estimates%rowtype;b uuid;today date;zone text;saved private.record_action_requests%rowtype;payload jsonb;items jsonb;created jsonb;result jsonb;
begin
 select business_id into b from public.estimates where id=p_estimate;
 perform private.require_record_module(b,'billing',true);
 if p_request is null then raise exception 'A saved revision request is required.' using errcode='22023';end if;
 -- Match the delivery lock order so a pending send cannot race the revision.
 perform pg_advisory_xact_lock(hashtextextended('finviant-email:'||b::text,0));
 select * into e from public.estimates where id=p_estimate and business_id=b for update;
 select * into saved from private.record_action_requests where business_id=b and action='revise_estimate' and request_id=p_request;
 if found then
  if saved.actor_id<>auth.uid() or saved.source_id<>p_estimate then raise exception 'This request belongs to another action.' using errcode='23505';end if;
  return saved.result||jsonb_build_object('already_created',true);end if;
 select timezone into zone from public.businesses where id=b;today:=(now() at time zone coalesce(zone,'UTC'))::date;
 if e.id is null or not coalesce(e.status in('declined','expired') or (e.status='sent' and e.expires_on<today),false) then
  raise exception 'Only declined or expired estimates can be revised into a new draft.' using errcode='23514';end if;
 if exists(select 1 from private.finviant_email_outbox where business_id=b and document_kind='estimate' and document_id=e.id and status in('queued','sending','uncertain','reconciliation_required')) then
  raise exception 'Resolve the existing send before creating a revised draft.' using errcode='23514';end if;
 if (select count(*) from private.record_action_requests where business_id=b and action='revise_estimate' and created_at>now()-interval '1 hour')>=100 then
  raise exception 'Open an existing revised draft or try again later.' using errcode='54000';end if;
 select coalesce(jsonb_agg(jsonb_build_object('description',description,'quantity',quantity,'unit_price',unit_price,'tax_rate',tax_rate) order by sort_order,id),'[]'::jsonb)
 into items from public.estimate_items where business_id=b and estimate_id=e.id;
 payload:=jsonb_build_object('customer_id',e.customer_id,'property_id',e.property_id,'issue_date',today,'expires_on',today+30,
  'notes',e.notes,'customer_message',e.customer_message,'items',items);
 -- Reuse the existing atomic creation path: normal numbering, quota, pricing,
 -- customer/site and issuer guards run exactly as for any new draft. Payment
 -- destinations inherit today's owner-managed defaults; staff never supply or
 -- revive a historical payment destination in a new quote.
 created:=public.create_document(b,'estimate',p_request,payload);
 result:=jsonb_build_object('estimate_id',created->>'id','already_created',false);
 insert into private.record_action_requests(business_id,action,request_id,actor_id,source_id,result) values(b,'revise_estimate',p_request,auth.uid(),e.id,result);
 return result;
end $$;

create function public.prepare_document_copy(p_business uuid,p_kind text,p_document uuid,p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare hash text;existing private.document_shares%rowtype;v private.document_versions%rowtype;published jsonb;
begin
 perform private.require_record_module(p_business,'billing',true);
 if p_kind is null or p_document is null or p_kind not in('invoice','estimate','change_order') or p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid document copy.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-email:'||p_business::text,0));
 hash:=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 select * into existing from private.document_shares where token_hash=hash for update;
 if found then
  if existing.business_id<>p_business or existing.kind<>p_kind or existing.document_id<>p_document or existing.actor_id<>auth.uid() or existing.revoked_at is not null or existing.approval_token is not null then
   raise exception 'Copy request conflicts with an existing link.' using errcode='23505';end if;
  return jsonb_build_object('snapshot',existing.snapshot,'revision_id',existing.revision_id,'token',p_token,'expires_at',null);end if;
 if (select count(*) from private.document_shares where business_id=p_business and created_at>now()-interval '1 hour')>=100 then raise exception 'Reuse an existing copy or try again later.' using errcode='54000';end if;
 -- Unchanged bodies reuse their canonical bytes. An edited draft gets a new
 -- version rather than accidentally copying its earlier preview. Prior links
 -- and approval receipts keep their original immutable versions.
 published:=private.publish_document_version(auth.uid(),p_business,p_kind,p_document);
 select * into v from private.document_versions where id=(published->>'version_id')::uuid;
 insert into private.document_shares(token_hash,business_id,kind,document_id,actor_id,snapshot,approval_token,revision_id,expires_at)
 values(hash,p_business,p_kind,p_document,auth.uid(),v.snapshot,null,v.id,'infinity'::timestamptz);
 return jsonb_build_object('snapshot',v.snapshot,'revision_id',v.id,'token',p_token,'expires_at',null);
end $$;

-- A no-op save must still repair a missing active appointment. Preserve this
-- function's identity and existing optimistic concurrency/availability guards.
do $$declare definition text;patched text;needle text:='if (j.scheduled_start,j.scheduled_end) is not distinct from (s,e) then return;end if;';begin
 definition:=pg_get_functiondef('private.save_job_appointment(uuid,timestamptz,timestamptz,timestamptz,timestamptz,boolean)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Job appointment guard patch target missing.';end if;
 patched:=replace(definition,needle,'if (j.scheduled_start,j.scheduled_end) is not distinct from (s,e) and exists(select 1 from public.appointments where business_id=j.business_id and job_id=j.id and status in(''scheduled'',''confirmed'',''in_progress'') and starts_at is not distinct from s and ends_at is not distinct from e) then return;end if;');
 execute patched;
end $$;

-- Legacy clients cannot complete only the calendar entry and skip the job's
-- invoicing workflow. Job-driven synchronization already updates the parent
-- first, as does update_appointment_workflow below. Standalone events stay free
-- to manage their own attendance status.
create function private.guard_linked_appointment_lifecycle() returns trigger
language plpgsql security definer set search_path='' as $$
declare j public.jobs%rowtype;
begin
 if old.job_id is not null and (new.job_id,new.business_id) is distinct from (old.job_id,old.business_id) then
  raise exception 'A job appointment keeps its work history. Review a new appointment from the job.' using errcode='23514';end if;
 if new.job_id is null or new.status is not distinct from old.status then return new;end if;
 if old.status in('completed','canceled','no_show') and new.status in('scheduled','confirmed','in_progress') then
  raise exception 'Open the job and review a new appointment instead of changing an old calendar entry.' using errcode='23514';end if;
 select * into j from public.jobs where id=new.job_id and business_id=new.business_id;
 if not found then raise exception 'Linked job unavailable.' using errcode='42501';end if;
 if (new.status='completed' and j.status<>'completed')
  or (new.status='canceled' and j.status not in('completed','canceled'))
  or (new.status='in_progress' and j.status<>'in_progress')
  or (new.status='no_show' and (j.status<>'lead' or j.scheduled_start is not null or j.scheduled_end is not null)) then
  raise exception 'Open the job to update its work status and invoice handoff.' using errcode='23514';end if;
 return new;
end $$;
create trigger linked_appointment_lifecycle before update of status,job_id,business_id on public.appointments for each row execute function private.guard_linked_appointment_lifecycle();
revoke all on function private.guard_linked_appointment_lifecycle() from public,anon,authenticated,service_role;

create function public.update_appointment_workflow(p_appointment uuid,p_status text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.appointments%rowtype;j public.jobs%rowtype;b uuid;result jsonb;
begin
 select business_id into b from public.appointments where id=p_appointment;
 perform private.require_record_module(b,'calendar',true);
 if p_status is null or p_status not in('scheduled','confirmed','in_progress','completed','canceled','no_show') then raise exception 'Invalid appointment status.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-schedule:'||b::text,0));
 select * into a from public.appointments where id=p_appointment and business_id=b for update;
 if a.job_id is null then update public.appointments set status=p_status where id=a.id;return jsonb_build_object('appointment_id',a.id,'status',p_status);end if;
 perform private.require_record_module(b,'jobs',true);
 select * into j from public.jobs where id=a.job_id and business_id=b for update;
 if not found then raise exception 'Linked job unavailable.' using errcode='42501';end if;
 if a.status in('completed','canceled','no_show') then
  if p_status=a.status then return jsonb_build_object('appointment_id',a.id,'status',a.status,'job_id',j.id,'already_updated',true);end if;
  raise exception 'Open the job and review a new appointment instead of changing an old calendar entry.' using errcode='23514';end if;
 if p_status='completed' then
  result:=public.complete_job_workflow(j.id,auth.uid(),false);
 elsif p_status='in_progress' then
  if j.status in('completed','canceled') then raise exception 'Reopen the job before starting it.' using errcode='23514';end if;
  update public.jobs set status='in_progress' where id=j.id;
 elsif p_status='canceled' then
  if j.status='completed' then raise exception 'Reopen the completed job before canceling it.' using errcode='23514';end if;
  update public.jobs set status='canceled' where id=j.id;
 elsif p_status in('scheduled','confirmed') then
  if j.status in('completed','canceled') then raise exception 'Reopen the job before reviewing its schedule.' using errcode='23514';end if;
  if j.status='in_progress' then raise exception 'Use the job details to review work already in progress.' using errcode='23514';end if;
  update public.jobs set status='scheduled' where id=j.id;
 else
  if j.status in('completed','canceled') then raise exception 'This job is closed. Open its history instead.' using errcode='23514';end if;
  -- A no-show closes only this attendance record; the job requires a newly
  -- reviewed appointment and does not count as completed or invoice-ready.
  update public.jobs set status='lead',scheduled_start=null,scheduled_end=null where id=j.id;
 end if;
 update public.appointments set status=p_status where id=a.id;
 return coalesce(result,'{}'::jsonb)||jsonb_build_object('appointment_id',a.id,'status',p_status,'job_id',j.id);
end $$;

-- Completion may reuse an already-issued invoice. Report its real state rather
-- than telling the office that every linked invoice is a new draft.
do $$declare definition text;needle text:='''invoice_ready'',invoice is not null,''invoice_id''';begin
 definition:=pg_get_functiondef('public.complete_job_workflow(uuid,uuid,boolean)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Job completion context patch target missing.';end if;
 execute replace(definition,needle,'''invoice_ready'',invoice is not null,''invoice_status'',case when finance then (select status from public.invoices where id=invoice and business_id=b) end,''invoice_id''');
end $$;

-- Reject known processing/reconciliation races at the same invoice lock used
-- by verified provider settlement. Identical manual-payment retries still work.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.record_manual_payment(uuid,uuid,uuid,numeric,text,text)'::regprocedure);
 definition:=replace(definition,'FUNCTION public.record_manual_payment(','FUNCTION private.record_manual_payment_before_record_actions(');
 -- Qualified parameter names inside the copied legacy implementation refer to
 -- its new function name, preserving its original idempotency comparisons.
 definition:=replace(definition,'record_manual_payment.request_id','record_manual_payment_before_record_actions.request_id');
 definition:=replace(definition,'record_manual_payment.invoice_id','record_manual_payment_before_record_actions.invoice_id');
 execute definition;
end $$;
revoke all on function private.record_manual_payment_before_record_actions(uuid,uuid,uuid,numeric,text,text) from public,anon,authenticated,service_role;
create or replace function public.record_manual_payment(target_business_id uuid,invoice_id uuid,request_id uuid,payment_amount numeric,payment_method text,payment_note text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_record_module(target_business_id,'billing',true);
 perform pg_advisory_xact_lock(hashtextextended(target_business_id::text||request_id::text,0));
 if exists(select 1 from public.payments p where p.business_id=target_business_id and p.request_id=record_manual_payment.request_id) then
  return private.record_manual_payment_before_record_actions(target_business_id,invoice_id,request_id,payment_amount,payment_method,payment_note);end if;
 perform 1 from public.invoices i where i.business_id=target_business_id and i.id=record_manual_payment.invoice_id for update;
 if not found then raise exception 'Invoice unavailable.' using errcode='42501';end if;
 if exists(select 1 from private.customer_invoice_checkouts where business_id=target_business_id and customer_invoice_checkouts.invoice_id=record_manual_payment.invoice_id and status in('pending','review_required')) then
  raise exception 'A customer payment is processing or needs review. Reconcile it before recording another payment.' using errcode='23514';end if;
 return private.record_manual_payment_before_record_actions(target_business_id,invoice_id,request_id,payment_amount,payment_method,payment_note);
end $$;

create function private.guard_manual_payment_operations() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 -- Legacy/manual clients can omit provider or use their own label. Every new
 -- succeeded receipt must respect processing payments; verified Stripe ledger
 -- settlement is checked separately by commerce_payment_guard.
 if new.provider='stripe_customer' or new.status<>'succeeded' then return new;end if;
 if tg_op='UPDATE' and (new.business_id,new.invoice_id,new.amount,new.status,new.provider)
   is not distinct from (old.business_id,old.invoice_id,old.amount,old.status,old.provider) then return new;end if;
 perform private.require_record_module(new.business_id,'billing',true);
 perform 1 from public.invoices where id=new.invoice_id and business_id=new.business_id for update;
 if not found then raise exception 'Invoice unavailable.' using errcode='42501';end if;
 if exists(select 1 from private.customer_invoice_checkouts c where c.business_id=new.business_id and c.invoice_id=new.invoice_id and c.status in('pending','review_required')) then
  raise exception 'A customer payment is processing or needs review. Reconcile it before recording another payment.' using errcode='23514';end if;
 return new;
end $$;
create trigger manual_payment_operations before insert or update of business_id,invoice_id,amount,status,provider on public.payments for each row execute function private.guard_manual_payment_operations();
revoke all on function private.guard_manual_payment_operations() from public,anon,authenticated,service_role;

revoke all on function public.get_job_workflow_context(uuid,uuid[]),public.get_estimate_workflow_context(uuid,uuid[]),public.get_invoice_payment_operations(uuid,uuid),public.reopen_job(uuid,uuid),public.create_revised_estimate(uuid,uuid),public.prepare_document_copy(uuid,text,uuid,text),public.update_appointment_workflow(uuid,text),public.record_manual_payment(uuid,uuid,uuid,numeric,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_job_workflow_context(uuid,uuid[]),public.get_estimate_workflow_context(uuid,uuid[]),public.get_invoice_payment_operations(uuid,uuid),public.reopen_job(uuid,uuid),public.create_revised_estimate(uuid,uuid),public.prepare_document_copy(uuid,text,uuid,text),public.update_appointment_workflow(uuid,text),public.record_manual_payment(uuid,uuid,uuid,numeric,text,text) to authenticated;
