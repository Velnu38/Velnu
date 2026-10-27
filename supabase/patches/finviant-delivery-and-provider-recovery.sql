-- Consolidated record of the delivery recovery migrations applied to Owedly-Test on 2026-10-27.
-- Requires the existing foundation, entitlement, issuer-snapshot and transactional-document migrations.
-- This is not permission to run on production. Rehearse a complete database restore separately.
create table if not exists private.finviant_email_outbox (
 id uuid primary key,business_id uuid not null references public.businesses(id) on delete cascade,actor_id uuid not null references auth.users(id) on delete cascade,
 document_kind text not null check(document_kind in('invoice','estimate','change_order')),document_id uuid not null,payload jsonb not null,
 status text not null default 'queued' check(status in('queued','sending','uncertain','accepted','delivered','failed','reconciliation_required')),
 attempts integer not null default 0,lease_id uuid,lease_until timestamptz,provider_id text unique,created_at timestamptz not null default now(),next_attempt_at timestamptz not null default now(),last_code text,last_event_at timestamptz);
alter table private.finviant_email_outbox enable row level security;
revoke all on private.finviant_email_outbox from public,anon,authenticated;
create index if not exists idx_fv_outbox_ready on private.finviant_email_outbox(status,next_attempt_at);
create index if not exists idx_fv_outbox_business on private.finviant_email_outbox(business_id,created_at);
create index if not exists idx_fv_outbox_actor on private.finviant_email_outbox(actor_id);
create unique index if not exists idx_fv_outbox_pending_document on private.finviant_email_outbox(business_id,document_kind,document_id) where status in('queued','sending','uncertain','reconciliation_required');
create table if not exists private.finviant_delivery_events(event_id text primary key,provider_id text not null,event_type text not null,occurred_at timestamptz not null,received_at timestamptz not null default now());
alter table private.finviant_delivery_events enable row level security;
revoke all on private.finviant_delivery_events from public,anon,authenticated;
create index if not exists idx_fv_delivery_events_message on private.finviant_delivery_events(provider_id,occurred_at);

create or replace function public.prepare_document_email(p_actor uuid,p_business uuid,p_kind text,p_document uuid,p_request uuid,p_origin text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare o private.finviant_email_outbox%rowtype;d jsonb;b record;c record;items_text text;body_text text;subj text;label text;number text;tok text;approval_url text;plan_name text;new_payload jsonb;
begin
 if p_actor is null or p_request is null or p_document is null or p_kind is null or p_kind not in('invoice','estimate','change_order') then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if p_origin is null or p_origin not in('https://finviant.com','https://www.finviant.com','https://app.finviant.com') then raise exception 'INVALID_APP_ORIGIN' using errcode='22023';end if;
 if not exists(select 1 from public.business_members where business_id=p_business and user_id=p_actor and role in('owner','admin','office')) or not exists(select 1 from public.user_agreement_acceptances where user_id=p_actor and terms_accepted and ai_disclosure_acknowledged and electronic_records_consent) then raise exception 'ACCESS_DENIED' using errcode='42501';end if;
 select plan into plan_name from private.business_entitlements where business_id=p_business and (valid_until is null or valid_until>now());
 if plan_name is null or plan_name not in('basic','pro') or (p_kind<>'invoice' and plan_name<>'pro') then raise exception 'PAID_FEATURE_REQUIRED' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finviant-email:'||p_business::text,0));
 select * into o from private.finviant_email_outbox where id=p_request;
 if found then if o.business_id<>p_business or o.document_kind<>p_kind or o.document_id<>p_document then raise exception 'REQUEST_CONFLICT' using errcode='23505';end if;return jsonb_build_object('id',o.id,'status',o.status);end if;
 select * into o from private.finviant_email_outbox where business_id=p_business and document_kind=p_kind and document_id=p_document and status in('queued','sending','uncertain','reconciliation_required') order by created_at desc limit 1;
 if found then return jsonb_build_object('id',o.id,'status',o.status);end if;
 if (select count(*) from private.finviant_email_outbox where business_id=p_business and created_at>now()-interval '1 hour')>=100 then raise exception 'EMAIL_RATE_LIMIT' using errcode='P0001';end if;
 select name,email,phone,currency into b from public.businesses where id=p_business;if not found then raise exception 'BUSINESS_NOT_FOUND' using errcode='P0002';end if;
 if p_kind='invoice' then
  select jsonb_build_object('customer_id',customer_id,'number',invoice_number,'status',status,'total',total,'amount_paid',amount_paid,'balance_due',balance_due,'issue_date',issue_date,'due_date',due_date,'customer_message',customer_message,'issuer_snapshot',issuer_snapshot) into d from public.invoices where id=p_document and business_id=p_business for update;
  select string_agg(description||' | Qty '||quantity::text||' x '||unit_price::text||' | Tax '||tax_rate::text||'%',E'\n' order by sort_order,id) into items_text from public.invoice_items where invoice_id=p_document and business_id=p_business;label:='Invoice';
 elsif p_kind='estimate' then
  select jsonb_build_object('customer_id',customer_id,'number',estimate_number,'status',status,'total',total,'issue_date',issue_date,'customer_message',customer_message,'issuer_snapshot',issuer_snapshot) into d from public.estimates where id=p_document and business_id=p_business for update;
  select string_agg(description||' | Qty '||quantity::text||' x '||unit_price::text||' | Tax '||tax_rate::text||'%',E'\n' order by sort_order,id) into items_text from public.estimate_items where estimate_id=p_document and business_id=p_business;label:='Estimate';
 else
  select jsonb_build_object('customer_id',customer_id,'number',change_order_number,'status',status,'total',total,'issue_date',issue_date,'customer_message',customer_message,'title',title,'schedule_impact_days',schedule_impact_days,'issuer_snapshot',issuer_snapshot) into d from public.change_orders where id=p_document and business_id=p_business for update;
  select string_agg(description||' | Qty '||quantity::text||' x '||unit_price::text||' | Tax '||tax_rate::text||'%',E'\n' order by sort_order,id) into items_text from public.change_order_items where change_order_id=p_document and business_id=p_business;label:='Change order';
 end if;
 if d is null then raise exception 'DOCUMENT_NOT_FOUND' using errcode='P0002';end if;
 if d->>'status' in('void','converted','expired','declined','accepted','approved') then raise exception 'DOCUMENT_NOT_SENDABLE' using errcode='23514';end if;
 if items_text is null then raise exception 'LINE_ITEMS_REQUIRED' using errcode='23514';end if;
 select id,first_name,last_name,company,email into c from public.customers where id=(d->>'customer_id')::uuid and business_id=p_business;
 if not found or c.email is null or c.email !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then raise exception 'VALID_RECIPIENT_REQUIRED' using errcode='23514';end if;
 if jsonb_typeof(d->'issuer_snapshot')='object' then b.name:=coalesce(d#>>'{issuer_snapshot,name}',b.name);b.email:=d#>>'{issuer_snapshot,email}';b.phone:=d#>>'{issuer_snapshot,phone}';end if;
 number:=coalesce(d->>'number',label);subj:=regexp_replace(b.name||': '||label||' '||number,E'[\r\n]',' ','g');
 body_text:=b.name||E'\n'||label||' '||number||E'\n\nHello '||coalesce(nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''),c.company,'Customer')||E',\n\n'||coalesce(d->>'title','')||E'\n'||items_text||E'\n\nTotal: '||coalesce(b.currency,'USD')||' '||(d->>'total')||E'\n'||coalesce(d->>'customer_message','');
 if p_kind='invoice' then
  body_text:=body_text||E'\nPaid: '||coalesce(d->>'amount_paid','0')||E'\nBalance due: '||coalesce(d->>'balance_due','0')||E'\nDue date: '||coalesce(d->>'due_date','Contact the business')||E'\nContact the business directly for payment arrangements.';
  update public.invoices set status='sent',sent_at=coalesce(sent_at,now()) where id=p_document and business_id=p_business and status='draft';
 else
  tok:=encode(extensions.gen_random_bytes(32),'hex');approval_url:=p_origin||'/?approval='||tok;
  insert into public.document_approval_links(business_id,document_type,estimate_id,change_order_id,token_hash,expires_at,created_by_user_id) values(p_business,p_kind,case when p_kind='estimate' then p_document end,case when p_kind='change_order' then p_document end,encode(sha256(convert_to(tok,'UTF8')),'hex'),now()+interval '14 days',p_actor);
  body_text:=body_text||E'\n\nReview the scope, amount and terms: '||approval_url||E'\nThis private review link expires in 14 days.';
  -- Estimates have no sent_at column. Issuance is distinct from email delivery.
  if p_kind='estimate' then update public.estimates set status='sent' where id=p_document and business_id=p_business and status='draft';else update public.change_orders set status='sent',sent_at=coalesce(sent_at,now()) where id=p_document and business_id=p_business and status='draft';end if;
 end if;
 new_payload:=jsonb_build_object('from','Finviant Office <adminsupport@finviant.com>','to',jsonb_build_array(btrim(c.email)),'subject',subj,'text',body_text,'tags',jsonb_build_array(jsonb_build_object('name','finviant_request_id','value',p_request::text)));
 if b.email is not null and b.email ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then new_payload:=new_payload||jsonb_build_object('reply_to',jsonb_build_array(b.email));end if;
 insert into public.messages(id,business_id,customer_id,invoice_id,estimate_id,change_order_id,direction,channel,recipient,subject,body,provider,status) values(p_request,p_business,c.id,case when p_kind='invoice' then p_document end,case when p_kind='estimate' then p_document end,case when p_kind='change_order' then p_document end,'outbound','email',c.email,subj,body_text,'resend','queued');
 insert into private.finviant_email_outbox(id,business_id,actor_id,document_kind,document_id,payload) values(p_request,p_business,p_actor,p_kind,p_document,new_payload);
 return jsonb_build_object('id',p_request,'status','queued');
end;$fn$;

create or replace function public.claim_document_email(p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare o private.finviant_email_outbox%rowtype;lease uuid:=gen_random_uuid();begin
 select * into o from private.finviant_email_outbox where id=p_request for update;if not found then raise exception 'SEND_NOT_FOUND' using errcode='P0002';end if;
 if o.status in('accepted','delivered') then return jsonb_build_object('id',o.id,'status',o.status,'provider_id',o.provider_id,'recipient',o.payload->'to'->>0);end if;
 if o.status in('failed','reconciliation_required') then return jsonb_build_object('id',o.id,'status',o.status);end if;
 if not exists(select 1 from public.business_members where business_id=o.business_id and user_id=o.actor_id and role in('owner','admin','office')) then update private.finviant_email_outbox set status='reconciliation_required',last_code='access_revoked' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if not exists(select 1 from private.business_entitlements where business_id=o.business_id and plan in('basic','pro') and (valid_until is null or valid_until>now())) then update private.finviant_email_outbox set status='reconciliation_required',last_code='entitlement_expired' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if o.created_at<now()-interval '23 hours' or o.attempts>=5 then update private.finviant_email_outbox set status='reconciliation_required' where id=o.id;return jsonb_build_object('id',o.id,'status','reconciliation_required');end if;
 if o.lease_until>now() or o.next_attempt_at>now() then return jsonb_build_object('id',o.id,'status','busy');end if;
 update private.finviant_email_outbox set status='sending',attempts=attempts+1,lease_id=lease,lease_until=now()+interval '2 minutes' where id=o.id;
 return jsonb_build_object('id',o.id,'status','claimed','lease',lease,'payload',o.payload);end;$fn$;

create or replace function public.finish_document_email(p_request uuid,p_lease uuid,p_result text,p_provider_id text default null,p_code text default null) returns void language plpgsql security definer set search_path='' as $fn$
declare o private.finviant_email_outbox%rowtype;e record;begin
 select * into o from private.finviant_email_outbox where id=p_request for update;if not found then raise exception 'SEND_NOT_FOUND' using errcode='P0002';end if;
 if o.status in('accepted','delivered') then return;end if;
 if o.lease_id is distinct from p_lease or p_lease is null then raise exception 'STALE_SEND_LEASE' using errcode='23514';end if;
 if p_result is null or p_result not in('accepted','uncertain','failed') then raise exception 'INVALID_RESULT' using errcode='22023';end if;
 if p_result='accepted' and (p_provider_id is null or length(p_provider_id)<1 or length(p_provider_id)>200) then raise exception 'INVALID_PROVIDER_ID' using errcode='22023';end if;
 update private.finviant_email_outbox set status=p_result,provider_id=p_provider_id,lease_id=null,lease_until=null,last_code=left(p_code,80),next_attempt_at=now()+interval '30 seconds'*power(2,least(o.attempts,5)) where id=o.id;
 update public.messages set status=case when p_result='accepted' then 'sent' when p_result='failed' then 'failed' else 'queued' end,provider_message_id=p_provider_id,sent_at=case when p_result='accepted' then now() else sent_at end where id=o.id and business_id=o.business_id;
 if p_result='accepted' then select * into e from private.finviant_delivery_events where provider_id=p_provider_id and event_type in('email.delivered','email.bounced','email.complained','email.failed','email.suppressed') order by occurred_at desc,event_id desc limit 1;
  if found then update private.finviant_email_outbox set status=case when e.event_type='email.delivered' then 'delivered' else 'failed' end,last_event_at=e.occurred_at where id=o.id;update public.messages set status=case when e.event_type='email.delivered' then 'delivered' else 'failed' end where id=o.id and business_id=o.business_id;end if;
 end if;end;$fn$;

create or replace function public.record_delivery_event(p_event_id text,p_provider_id text,p_type text,p_occurred timestamptz) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare inserted boolean;o private.finviant_email_outbox%rowtype;new_status text;begin
 if p_event_id is null or p_provider_id is null or p_type is null or length(p_event_id)>200 or length(p_provider_id)>200 or p_type not in('email.sent','email.delivered','email.bounced','email.complained','email.failed','email.suppressed','email.delivery_delayed') or p_occurred is null then raise exception 'INVALID_EVENT' using errcode='22023';end if;
 insert into private.finviant_delivery_events values(p_event_id,p_provider_id,p_type,p_occurred,now()) on conflict do nothing;inserted:=found;if not inserted then return jsonb_build_object('duplicate',true);end if;
 select * into o from private.finviant_email_outbox where provider_id=p_provider_id for update;if not found then return jsonb_build_object('stored',true,'awaiting_acknowledgement',true);end if;
 if o.last_event_at is not null and p_occurred<=o.last_event_at then return jsonb_build_object('stored',true,'stale',true);end if;
 new_status:=case when p_type='email.delivered' then 'delivered' when p_type in('email.bounced','email.complained','email.failed','email.suppressed') then 'failed' else null end;
 if new_status is not null then update private.finviant_email_outbox set status=new_status,last_event_at=p_occurred where id=o.id;update public.messages set status=new_status where id=o.id and business_id=o.business_id;end if;
 return jsonb_build_object('stored',true);end;$fn$;

create or replace function public.record_tagged_delivery_event(p_event_id text,p_provider_id text,p_type text,p_occurred timestamptz,p_request uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare o private.finviant_email_outbox%rowtype;begin
 if p_request is not null then select * into o from private.finviant_email_outbox where id=p_request for update;
  if found and o.attempts>0 and (o.provider_id is null or o.provider_id=p_provider_id) and exists(select 1 from jsonb_array_elements(o.payload->'tags') t where t->>'name'='finviant_request_id' and t->>'value'=p_request::text) then
   update private.finviant_email_outbox set provider_id=p_provider_id,status=case when p_type='email.sent' and status in('sending','uncertain','reconciliation_required','queued') then 'accepted' else status end where id=o.id;
   update public.messages set provider_message_id=p_provider_id,status=case when p_type='email.sent' and status='queued' then 'sent' else status end,sent_at=case when p_type='email.sent' then coalesce(sent_at,now()) else sent_at end where id=o.id and business_id=o.business_id;
  end if;
 end if;
 return public.record_delivery_event(p_event_id,p_provider_id,p_type,p_occurred);
end;$fn$;
revoke all on function public.prepare_document_email(uuid,uuid,text,uuid,uuid,text),public.claim_document_email(uuid),public.finish_document_email(uuid,uuid,text,text,text),public.record_delivery_event(text,text,text,timestamptz),public.record_tagged_delivery_event(text,text,text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.prepare_document_email(uuid,uuid,text,uuid,uuid,text),public.claim_document_email(uuid),public.finish_document_email(uuid,uuid,text,text,text),public.record_delivery_event(text,text,text,timestamptz),public.record_tagged_delivery_event(text,text,text,timestamptz,uuid) to service_role;

-- Stripe sandbox metadata only: these events NEVER activate plans or move money.
create table if not exists private.finviant_payment_events(event_id text primary key,account_id text not null,object_id text not null,event_type text not null,provider_created_at timestamptz not null,received_at timestamptz not null default now(),state text not null default 'awaiting_reconciliation' check(state in('awaiting_reconciliation','reconciled','quarantined')),livemode boolean not null check(livemode=false));
alter table private.finviant_payment_events enable row level security;
revoke all on private.finviant_payment_events from public,anon,authenticated;
create index if not exists idx_fv_payment_inbox_pending on private.finviant_payment_events(state,received_at);
create or replace function public.record_sandbox_payment_event(p_event_id text,p_account_id text,p_object_id text,p_type text,p_created timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare inserted boolean;existing private.finviant_payment_events%rowtype;begin
 if p_event_id is null or p_event_id !~ '^evt_[A-Za-z0-9]+$' or length(p_event_id)>200 or p_account_id is null or p_account_id !~ '^acct_[A-Za-z0-9]+$' or p_object_id is null or length(p_object_id)>200 or p_type is null or length(p_type)>100 or p_created is null then raise exception 'INVALID_PAYMENT_EVENT' using errcode='22023';end if;
 insert into private.finviant_payment_events(event_id,account_id,object_id,event_type,provider_created_at,livemode) values(p_event_id,p_account_id,p_object_id,p_type,p_created,false) on conflict do nothing;inserted:=found;
 if not inserted then select * into existing from private.finviant_payment_events where event_id=p_event_id;if existing.account_id<>p_account_id or existing.object_id<>p_object_id or existing.event_type<>p_type then raise exception 'PAYMENT_EVENT_COLLISION' using errcode='23505';end if;end if;
 return jsonb_build_object('stored',true,'duplicate',not inserted,'state','awaiting_reconciliation');
end;$fn$;
revoke all on function public.record_sandbox_payment_event(text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.record_sandbox_payment_event(text,text,text,text,timestamptz) to service_role;

create or replace function public.list_due_document_emails() returns jsonb language sql security definer set search_path='' as $fn$
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id)),'[]'::jsonb) from(select id from private.finviant_email_outbox where status in('queued','sending','uncertain') and next_attempt_at<=now() and (lease_until is null or lease_until<=now()) order by next_attempt_at,created_at limit 5) q;
$fn$;
create or replace function public.finviant_ops_health() returns jsonb language sql security definer set search_path='' as $fn$
 select jsonb_build_object('database','reachable','checked_at',now(),'email_queued',(select count(*) from private.finviant_email_outbox where status='queued'),'email_uncertain',(select count(*) from private.finviant_email_outbox where status in('uncertain','reconciliation_required')),'email_stale',(select count(*) from private.finviant_email_outbox where status in('queued','sending','uncertain') and created_at<now()-interval '30 minutes'),'sandbox_events_awaiting_reconciliation',(select count(*) from private.finviant_payment_events where state='awaiting_reconciliation'),'failed_email_last_day',(select count(*) from private.finviant_email_outbox where status='failed' and created_at>now()-interval '1 day'));
$fn$;
revoke all on function public.list_due_document_emails(),public.finviant_ops_health() from public,anon,authenticated;
grant execute on function public.list_due_document_emails(),public.finviant_ops_health() to service_role;
