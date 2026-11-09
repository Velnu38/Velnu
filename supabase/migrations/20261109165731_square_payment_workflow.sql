-- Provider costs stay distinguishable from editable manual expenses.
alter table public.bookkeeping_entries add column source_kind text check(source_kind is null or source_kind='square_processing');
create function private.guard_provider_cost_entry() returns trigger language plpgsql set search_path='' as $$
begin
 if auth.uid() is not null and ((tg_op<>'INSERT' and old.source_kind is not null) or (tg_op<>'DELETE' and new.source_kind is not null)) then raise exception 'Verified provider costs are maintained by payment reconciliation.' using errcode='42501';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger provider_cost_entry_guard before insert or update or delete on public.bookkeeping_entries for each row execute function private.guard_provider_cost_entry();
revoke all on function private.guard_provider_cost_entry() from public,anon,authenticated,service_role;

-- Square merchant-owned charges. No platform application fee or subscription purchase.
create table private.square_connections(
 business_id uuid primary key references public.businesses(id) on delete cascade,merchant_id text not null,
 location_id text not null,location_name text not null,currency text not null check(currency='USD'),
 environment text not null check(environment in('sandbox','production')),token_envelope jsonb not null,
 token_expires_at timestamptz not null,token_version integer not null default 1,enabled boolean not null default true,
 connected_at timestamptz not null default now(),unique(merchant_id,environment)
);
create table private.square_oauth_states(
 state_hash text primary key check(state_hash~'^[a-f0-9]{64}$'),business_id uuid not null references public.businesses(id) on delete cascade,
 actor_id uuid not null references auth.users(id),expires_at timestamptz not null default now()+interval '10 minutes'
);
create table private.square_invoice_operations(
 id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id),invoice_id uuid not null,
 request_id uuid not null,created_by uuid references auth.users(id),kind text not null check(kind in('online','pos')),
 environment text not null,merchant_id text not null,location_id text not null,amount_minor bigint not null check(amount_minor between 50 and 99999999),
 currency text not null check(currency='USD'),invoice_total numeric not null,revision_id uuid,
 state_hash text check(state_hash~'^[a-f0-9]{64}$'),order_id text,link_id text,checkout_url text,provider_payment_id text,payment_id uuid references public.payments(id),
 status text not null default 'reserved' check(status in('reserved','open','pending','paid','review_required','canceled')),
 review_reason text,created_at timestamptz not null default now(),unique(business_id,request_id),
 foreign key(invoice_id,business_id) references public.invoices(id,business_id),unique(merchant_id,environment,provider_payment_id),unique(merchant_id,environment,order_id)
);
create unique index square_active_invoice on private.square_invoice_operations(invoice_id) where status in('reserved','open','pending');
create index square_operations_invoice on private.square_invoice_operations(business_id,invoice_id,created_at desc);
create table private.square_payment_refunds(
 merchant_id text not null,environment text not null,refund_id text not null,operation_id uuid not null references private.square_invoice_operations(id),
 amount_minor bigint not null check(amount_minor>0),refunded_at timestamptz not null,primary key(merchant_id,environment,refund_id)
);
create index square_refunds_operation on private.square_payment_refunds(operation_id);
create table private.square_events(
 merchant_id text not null,environment text not null,event_id text not null,outcome text not null,
 operation_id uuid references private.square_invoice_operations(id),created_at timestamptz not null default now(),primary key(merchant_id,environment,event_id)
);
create table private.square_processing_costs(
 operation_id uuid primary key references private.square_invoice_operations(id),amount_minor bigint not null check(amount_minor>=0),
 entry_id uuid references public.bookkeeping_entries(id)
);
create table private.processing_fee_preferences(
 business_id uuid primary key references public.businesses(id) on delete cascade,
 requested boolean not null default false,rate_basis_points integer not null default 0 check(rate_basis_points in(0,50,100,150,200,250,290,300)),
 updated_at timestamptz not null default now()
);
-- A preference cannot self-certify local law, card funding type, processor approval or tax treatment.
-- No surcharge is collected until a provider-supported eligibility path is certified.
alter table private.square_connections enable row level security;
alter table private.square_oauth_states enable row level security;
alter table private.square_invoice_operations enable row level security;
alter table private.square_payment_refunds enable row level security;
alter table private.square_events enable row level security;
alter table private.square_processing_costs enable row level security;
alter table private.processing_fee_preferences enable row level security;
revoke all on private.square_connections,private.square_oauth_states,private.square_invoice_operations,private.square_payment_refunds,private.square_events,private.square_processing_costs,private.processing_fee_preferences from public,anon,authenticated,service_role;

create function private.square_payment_settings(p_business uuid,p_requested boolean default null,p_basis_points integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.square_connections%rowtype; f private.processing_fee_preferences%rowtype;
begin
 if auth.uid() is null or not private.is_primary_owner(p_business) then raise exception 'Primary account owner access required.' using errcode='42501';end if;
 if p_requested is not null then
  if p_basis_points is null then raise exception 'Choose a processing-fee percentage.' using errcode='23514';end if;
  insert into private.processing_fee_preferences(business_id,requested,rate_basis_points) values(p_business,p_requested,p_basis_points)
  on conflict(business_id) do update set requested=excluded.requested,rate_basis_points=excluded.rate_basis_points,updated_at=now();
 end if;
 select * into c from private.square_connections where business_id=p_business;
 select * into f from private.processing_fee_preferences where business_id=p_business;
 return jsonb_build_object('connected',c.business_id is not null,'enabled',coalesce(c.enabled,false),'environment',c.environment,'location',c.location_name,
 'fee_requested',coalesce(f.requested,false),'fee_basis_points',coalesce(f.rate_basis_points,0),'fee_active',false,
 'fee_reason','No customer surcharge is being collected. Separate credit-card fees require supported card eligibility, processor approval and location-specific legal and tax validation. Debit and prepaid cards must be excluded.');
end $$;
create function public.square_payment_settings(p_business uuid,p_requested boolean default null,p_basis_points integer default null) returns jsonb
language sql security invoker set search_path='' as $$select private.square_payment_settings(p_business,p_requested,p_basis_points)$$;
revoke all on function public.square_payment_settings(uuid,boolean,integer),private.square_payment_settings(uuid,boolean,integer) from public,anon,authenticated,service_role;
grant execute on function public.square_payment_settings(uuid,boolean,integer),private.square_payment_settings(uuid,boolean,integer) to authenticated;

-- One narrowly scoped, service-only interface; browser identities are independently
-- verified at the Edge and again here before owner/billing operations.
create function private.square_service(p_action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b uuid;actor uuid;c private.square_connections%rowtype;o private.square_invoice_operations%rowtype;i public.invoices%rowtype;context jsonb;amount bigint;
begin
 b:=nullif(p->>'business_id','')::uuid;actor:=nullif(p->>'actor_id','')::uuid;
 if p_action in('oauth_start','pause','oauth_save') and not private.is_primary_owner(b,actor) then raise exception 'Primary owner access required.' using errcode='42501';end if;
 if p_action in('invoice_status','reserve_pos','pos_context','cancel_pos') and (actor is null or not private.member_module_access(b,actor,'billing') or not exists(select 1 from public.business_members where business_id=b and user_id=actor and role in('owner','admin','office'))) then raise exception 'Billing access required.' using errcode='42501';end if;
 if p_action='oauth_start' then
   delete from private.square_oauth_states where expires_at<now();
   insert into private.square_oauth_states(state_hash,business_id,actor_id) values(p->>'state_hash',b,actor);return '{}'::jsonb;
 elsif p_action='oauth_consume' then
   delete from private.square_oauth_states where state_hash=p->>'state_hash' and expires_at>now() returning business_id,actor_id into b,actor;
   if b is null or not private.is_primary_owner(b,actor) then raise exception 'Connection authorization expired.' using errcode='42501';end if;
   return jsonb_build_object('business_id',b,'actor_id',actor);
 elsif p_action='oauth_save' then
   if exists(select 1 from private.square_connections old where old.business_id=b and (old.merchant_id is distinct from p->>'merchant_id' or old.environment is distinct from p->>'environment' or old.location_id is distinct from p->>'location_id')) then
     raise exception 'Changing the connected Square merchant or location requires reconciliation of existing invoice payments first.' using errcode='23514';end if;
   insert into private.square_connections(business_id,merchant_id,environment,location_id,location_name,currency,token_envelope,token_expires_at)
   values(b,p->>'merchant_id',p->>'environment',p->>'location_id',p->>'location_name','USD',p->'token_envelope',(p->>'token_expires_at')::timestamptz)
   on conflict(business_id) do update set token_envelope=excluded.token_envelope,token_expires_at=excluded.token_expires_at,token_version=private.square_connections.token_version+1,enabled=true;
   return '{}'::jsonb;
 elsif p_action='pause' then update private.square_connections set enabled=false where business_id=b;return '{}'::jsonb;
 elsif p_action='connection' then
   select * into c from private.square_connections where (b is not null and business_id=b) or (b is null and merchant_id=p->>'merchant_id' and environment=p->>'environment');
   return to_jsonb(c);
 elsif p_action='refresh' then
   update private.square_connections set token_envelope=p->'token_envelope',token_expires_at=(p->>'token_expires_at')::timestamptz,token_version=token_version+1 where business_id=b and token_version=(p->>'version')::int;
   return jsonb_build_object('saved',found);
 elsif p_action in('online_context','reserve_online') then
   context:=private.document_share_context(p->>'token_hash');
   if context->>'kind' is distinct from 'invoice' then raise exception 'Invoice link required.' using errcode='42501';end if;
   b:=(context->>'business_id')::uuid;
   select * into i from public.invoices where id=(context->>'document_id')::uuid and business_id=b for update;
   if context->>'publication_ready' is distinct from 'true' or coalesce((context->>'superseded')::boolean,true) or context->>'action_state' is distinct from 'payment_due' or context->>'revision_id' is null or (context->>'action_expires_at')::timestamptz<=now() then return jsonb_build_object('state','not_payable');end if;
 elsif p_action in('invoice_status','reserve_pos') then
   select * into i from public.invoices where id=(p->>'invoice_id')::uuid and business_id=b for update;
 elsif p_action='pos_context' then
   select * into o from private.square_invoice_operations where business_id=b and id=(p->>'operation_id')::uuid and kind='pos' and state_hash=p->>'state_hash';
   if not found then raise exception 'Payment return could not be verified.' using errcode='42501';end if;
   return to_jsonb(o);
 elsif p_action='cancel_pos' then
   select * into o from private.square_invoice_operations where business_id=b and id=(p->>'operation_id')::uuid and kind='pos' and state_hash=p->>'state_hash' for update;
   if not found or o.payment_id is not null or o.order_id is not null or o.status not in('reserved','open','pending') then raise exception 'This payment needs reconciliation in Square.' using errcode='23514';end if;
   update private.square_invoice_operations set status='canceled' where id=o.id;
   insert into private.square_events(merchant_id,environment,event_id,operation_id,outcome) values(o.merchant_id,o.environment,'manual_cancel:'||gen_random_uuid()::text,o.id,'staff_verified_no_payment');
   return jsonb_build_object('state','canceled');
 elsif p_action='operation' then
   select * into o from private.square_invoice_operations where merchant_id=p->>'merchant_id' and environment=p->>'environment' and (order_id=p->>'order_id' or provider_payment_id=p->>'payment_id');return to_jsonb(o);
 elsif p_action='attach' then
   select * into o from private.square_invoice_operations where id=(p->>'operation_id')::uuid for update;
   if not found or o.status not in('reserved','open','pending','canceled','paid') or (o.order_id is not null and o.order_id is distinct from p->>'order_id') then raise exception 'Payment operation changed.' using errcode='23514';end if;
   update private.square_invoice_operations set order_id=p->>'order_id',link_id=p->>'link_id',checkout_url=coalesce(p->>'checkout_url',checkout_url),status=case when status in('paid','canceled') then status else 'open' end where id=o.id;
   return '{}'::jsonb;
 else raise exception 'Unknown Square operation.';end if;
 if i.id is null then raise exception 'Invoice unavailable.' using errcode='42501';end if;
 select * into c from private.square_connections where business_id=b;
 amount:=round(coalesce(i.balance_due,0)*100)::bigint;
 select * into o from private.square_invoice_operations where business_id=b and invoice_id=i.id and status in('reserved','open','pending','review_required') order by created_at desc limit 1;
 if o.id is not null then
 if o.amount_minor<>amount or o.invoice_total<>i.total or (p_action in('online_context','reserve_online') and o.kind='online' and o.revision_id is distinct from nullif(context->>'revision_id','')::uuid) then update private.square_invoice_operations set status='review_required',review_reason='invoice_changed_during_payment' where id=o.id;o.status:='review_required';end if;
 return jsonb_build_object('number',i.invoice_number,'environment',c.environment,'pending_operation_id',o.id,'pending_kind',o.kind,'state',case when o.status='review_required' then 'review_required' else 'pending' end,'operation',case when p_action in('reserve_pos','reserve_online') and o.request_id=(p->>'request_id')::uuid then to_jsonb(o) else null end);end if;
 if exists(select 1 from private.customer_invoice_checkouts where invoice_id=i.id and status in('reserved','open','pending','review_required')) then return jsonb_build_object('state','pending');end if;
 if private.effective_plan(b)<>'pro' then return jsonb_build_object('state','disabled');end if;
 if i.status not in('sent','viewed','partial','overdue') or amount not between 50 and 99999999 or (select currency from public.businesses where id=b) is distinct from 'USD' then return jsonb_build_object('state','not_payable');end if;
 if c.business_id is null or not c.enabled then return jsonb_build_object('state','not_connected');end if;
 if p_action in('reserve_online','reserve_pos') then
   insert into private.square_invoice_operations(business_id,invoice_id,created_by,request_id,kind,merchant_id,location_id,environment,amount_minor,currency,invoice_total,revision_id,state_hash)
   values(b,i.id,actor,(p->>'request_id')::uuid,case when p_action='reserve_pos' then 'pos' else 'online' end,c.merchant_id,c.location_id,c.environment,amount,'USD',i.total,nullif(context->>'revision_id','')::uuid,p->>'state_hash') returning * into o;
 end if;
 return jsonb_build_object('state','ready','business_id',b,'invoice_id',i.id,'number',i.invoice_number,'amount_minor',amount,'currency','USD','environment',c.environment,'location_id',c.location_id,'operation',case when o.id is not null then to_jsonb(o) end);
end $$;
create function public.square_service(p_action text,p jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.square_service(p_action,p)$$;
revoke all on function private.square_service(text,jsonb),public.square_service(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.square_service(text,jsonb),public.square_service(text,jsonb) to service_role;

create function private.apply_square_payment(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o private.square_invoice_operations%rowtype;i public.invoices%rowtype;r jsonb;refund_total bigint;pay uuid;cost private.square_processing_costs%rowtype;entry uuid;owner_id uuid;fees bigint;
begin
 select * into o from private.square_invoice_operations where id=(p->>'operation_id')::uuid;
 if not found then raise exception 'Unknown invoice payment.';end if;
 select * into i from public.invoices where id=o.invoice_id and business_id=o.business_id for update;
 select * into o from private.square_invoice_operations where id=o.id for update;
 if o.merchant_id is distinct from p->>'merchant_id' or o.location_id is distinct from p->>'location_id' or o.environment is distinct from p->>'environment'
 or o.amount_minor is distinct from (p->>'amount_minor')::bigint or o.currency is distinct from p->>'currency'
 or coalesce(p->>'status','') not in('COMPLETED','APPROVED','PENDING','CANCELED','FAILED') or coalesce(p->>'payment_id','') !~ '^[A-Za-z0-9_-]{1,192}$'
 or coalesce(p->>'event_id','') !~ '^[A-Za-z0-9_:.-]{1,200}$' or (o.provider_payment_id is not null and o.provider_payment_id is distinct from p->>'payment_id')
 or p->>'created_at' is null or o.order_id is distinct from p->>'order_id' or (p->>'created_at')::timestamptz<o.created_at-interval '1 minute' or (p->>'created_at')::timestamptz>now()+interval '5 minutes' then raise exception 'Square payment verification failed.' using errcode='23514';end if;
 insert into private.square_events(merchant_id,environment,event_id,operation_id,outcome) values(o.merchant_id,o.environment,p->>'event_id',o.id,p->>'status') on conflict do nothing;
 if not found then return jsonb_build_object('state',o.status,'duplicate',true);end if;
 update private.square_invoice_operations set provider_payment_id=p->>'payment_id' where id=o.id;
 if p->>'status'<>'COMPLETED' then
   if o.payment_id is null and o.status<>'review_required' then update private.square_invoice_operations set status=case when p->>'status' in('CANCELED','FAILED') then 'canceled' else 'pending' end where id=o.id;end if;
   return jsonb_build_object('state',case when o.payment_id is not null then 'paid' else 'pending' end);
 end if;
 if o.payment_id is null then
   if i.status in('draft','void') or i.total<>o.invoice_total or round(i.balance_due*100)::bigint<o.amount_minor then
     update private.square_invoice_operations set status='review_required',review_reason='settled_payment_needs_reconciliation' where id=o.id;return jsonb_build_object('state','review_required');end if;
   insert into public.payments(business_id,invoice_id,amount,method,provider,provider_payment_id,status,paid_at,notes)
   values(o.business_id,o.invoice_id,o.amount_minor/100.0,'card','square_customer',o.environment||':'||o.merchant_id||':'||(p->>'payment_id'),'succeeded',(p->>'created_at')::timestamptz,'Verified Square invoice payment') returning id into pay;
   update private.square_invoice_operations set status='paid',payment_id=pay where id=o.id;o.payment_id:=pay;
 end if;
 if jsonb_typeof(p->'refunds') is distinct from 'array' or jsonb_array_length(p->'refunds')>100 then raise exception 'Invalid refund ledger.';end if;
 for r in select value from jsonb_array_elements(p->'refunds') loop
   if coalesce(r->>'id','') !~ '^[A-Za-z0-9_-]{1,192}$' or (r->>'amount_minor')::bigint<=0 or (r->>'refunded_at')::timestamptz>now()+interval '5 minutes' then raise exception 'Invalid refund evidence.';end if;
   if exists(select 1 from private.square_payment_refunds where merchant_id=o.merchant_id and environment=o.environment and refund_id=r->>'id' and (operation_id<>o.id or amount_minor<>(r->>'amount_minor')::bigint)) then raise exception 'Refund identity conflict.';end if;
   insert into private.square_payment_refunds(merchant_id,environment,refund_id,operation_id,amount_minor,refunded_at)
   values(o.merchant_id,o.environment,r->>'id',o.id,(r->>'amount_minor')::bigint,(r->>'refunded_at')::timestamptz) on conflict do nothing;
 end loop;
 select coalesce(sum(amount_minor),0) into refund_total from private.square_payment_refunds where operation_id=o.id;
 if refund_total>o.amount_minor then raise exception 'Refund exceeds invoice payment.';end if;
 begin
   update public.payments set status=case when refund_total=o.amount_minor then 'refunded' when refund_total>0 then 'partially_refunded' else 'succeeded' end where id=o.payment_id;
 exception when raise_exception then
   if sqlerrm not like 'This deposit is credited on a final invoice.%' then raise;end if;
   update private.square_invoice_operations set status='review_required',review_reason='credited_deposit_refund' where id=o.id;
   insert into public.business_activity(business_id) values(o.business_id) on conflict(business_id) do update set version=public.business_activity.version+1,updated_at=now();
   return jsonb_build_object('state','review_required');
 end;
 fees:=(p->>'processing_fee_minor')::bigint;
 if fees is not null and fees between 0 and o.amount_minor then
   select * into cost from private.square_processing_costs where operation_id=o.id for update;
   if fees=0 and cost.amount_minor>0 then update private.square_invoice_operations set status='review_required',review_reason='processing_fee_adjustment' where id=o.id;return jsonb_build_object('state','review_required');end if;
   select created_by_user_id into owner_id from public.businesses where id=o.business_id;
   if cost.entry_id is null and fees>0 and owner_id is not null then
     insert into public.bookkeeping_entries(business_id,created_by,entry_date,direction,amount,currency,category,description,invoice_id,source_kind)
     values(o.business_id,owner_id,((p->>'created_at')::timestamptz at time zone coalesce((select timezone from public.businesses where id=o.business_id),'America/New_York'))::date,'expense',fees/100.0,'USD','Payment processing','Square processing fee · '||coalesce(i.invoice_number,'Invoice'),i.id,'square_processing') returning id into entry;
   else entry:=cost.entry_id;if entry is not null and fees>0 then update public.bookkeeping_entries set amount=fees/100.0 where id=entry and business_id=o.business_id;end if;end if;
   insert into private.square_processing_costs(operation_id,amount_minor,entry_id) values(o.id,fees,entry) on conflict(operation_id) do update set amount_minor=excluded.amount_minor,entry_id=excluded.entry_id;
 end if;
 return jsonb_build_object('state','paid','payment_id',o.payment_id);
end $$;
create function public.apply_square_payment(p jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.apply_square_payment(p)$$;
revoke all on function private.apply_square_payment(jsonb),public.apply_square_payment(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.apply_square_payment(jsonb),public.apply_square_payment(jsonb) to service_role;

-- All payment lanes serialize on the invoice. A browser return never posts money.
create function private.square_invoice_reservation_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.invoices where id=new.invoice_id and business_id=new.business_id for update;
 if exists(select 1 from private.square_invoice_operations where invoice_id=new.invoice_id and status in('reserved','open','pending','review_required')) then raise exception 'A Square payment is processing or needs review.' using errcode='23514';end if;return new;
end $$;
create trigger stripe_square_reservation before insert on private.customer_invoice_checkouts for each row execute function private.square_invoice_reservation_guard();
revoke all on function private.square_invoice_reservation_guard() from public,anon,authenticated,service_role;

create function private.refunded_payment_minor(p_payment uuid) returns bigint language sql stable security definer set search_path='' as $$
 select coalesce((select sum(r.amount_minor) from private.customer_invoice_refunds r join private.customer_invoice_checkouts c on c.id=r.checkout_id where c.payment_id=p_payment),0)+coalesce((select sum(r.amount_minor) from private.square_payment_refunds r join private.square_invoice_operations o on o.id=r.operation_id where o.payment_id=p_payment),0)
$$;
revoke all on function private.refunded_payment_minor(uuid) from public,anon,authenticated,service_role;

create or replace function private.commerce_payment_guard() returns trigger language plpgsql set search_path='' as $$
declare s text; refunded bigint; expected text;
begin
  if tg_op='DELETE' then raise exception 'Payment records cannot be deleted';end if;
  if tg_op='UPDATE' and(new.invoice_id<>old.invoice_id or new.business_id<>old.business_id or new.amount<>old.amount or new.paid_at<>old.paid_at) then raise exception 'Posted payment details are immutable';end if;
  select status into s from public.invoices where id=new.invoice_id and business_id=new.business_id for update;
  if s is null or s in('draft','void') then raise exception 'Payments require an issued non-void invoice';end if;
  if new.amount<>round(new.amount,2) or new.amount>1000000000 then raise exception 'Invalid payment amount';end if;
  if tg_op='UPDATE' and old.provider in('stripe_customer','square_customer') and (new.provider is distinct from old.provider or new.provider_payment_id is distinct from old.provider_payment_id) then
    raise exception 'Verified payment identity is immutable';end if;
  if new.provider='square_customer' then
    if not exists(select 1 from private.square_invoice_operations o where o.business_id=new.business_id and o.invoice_id=new.invoice_id and o.environment||':'||o.merchant_id||':'||o.provider_payment_id=new.provider_payment_id and o.amount_minor=round(new.amount*100)::bigint and (o.payment_id is null or o.payment_id=new.id)) then raise exception 'Verified Square operation required';end if;
    refunded:=private.refunded_payment_minor(new.id);
    expected:=case when refunded=round(new.amount*100)::bigint then 'refunded' when refunded>0 then 'partially_refunded' else 'succeeded' end;
    if new.status is distinct from expected then raise exception 'Verified Square status follows its refund ledger';end if;
    return new;
  end if;
  if new.provider='stripe_customer' then
    if not exists(select 1 from private.customer_invoice_checkouts c where c.business_id=new.business_id and c.invoice_id=new.invoice_id
      and c.stripe_account_id||':'||c.stripe_payment_intent=new.provider_payment_id and c.amount_minor=round(new.amount*100)::bigint
      and (c.payment_id is null or c.payment_id=new.id)) then raise exception 'Verified checkout required';end if;
    select coalesce(sum(r.amount_minor),0) into refunded from private.customer_invoice_refunds r
      join private.customer_invoice_checkouts c on c.id=r.checkout_id where c.payment_id=new.id;
    expected:=case when refunded=round(new.amount*100)::bigint then 'refunded' when refunded>0 then 'partially_refunded' else 'succeeded' end;
    if new.status is distinct from expected then raise exception 'Verified payment status follows its provider ledger';end if;
  end if;
  if new.status='partially_refunded' then
    select coalesce(sum(r.amount_minor),0) into refunded from private.customer_invoice_refunds r
      join private.customer_invoice_checkouts c on c.id=r.checkout_id where c.payment_id=new.id;
    if new.provider is distinct from 'stripe_customer' or refunded<=0 or refunded>=round(new.amount*100)::bigint then raise exception 'Partial refunds require a verified refund ledger';end if;
  end if;
  return new;
end $$;
create or replace function private.commerce_paid_recalc() returns trigger language plpgsql security definer set search_path='' as $$
declare i uuid; paid numeric(12,2);
begin
  i:=case when tg_op='DELETE' then old.invoice_id else new.invoice_id end;
  select coalesce(sum(p.amount-private.refunded_payment_minor(p.id)/100.0) filter(where p.status in('succeeded','partially_refunded')),0)
    into paid from public.payments p where p.invoice_id=i;
  update public.invoices set amount_paid=paid,status=case when status='void' then 'void' when total>0 and paid>=total then 'paid' when paid>0 then 'partial' when sent_at is null then 'draft' else 'sent' end,
    paid_at=case when total>0 and paid>=total then coalesce(paid_at,now()) else null end where id=i;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create or replace function public.prevent_invoice_overpayment() returns trigger language plpgsql security definer set search_path='' as $$
declare invoice_total numeric; existing_paid numeric; incoming numeric;
begin
  if new.status not in('succeeded','partially_refunded') then return new;end if;
  select total into invoice_total from public.invoices where id=new.invoice_id and business_id=new.business_id for update;
  if invoice_total is null then return new;end if;
  select coalesce(sum(p.amount-private.refunded_payment_minor(p.id)/100.0),0)
    into existing_paid from public.payments p where p.invoice_id=new.invoice_id and p.business_id=new.business_id
      and p.status in('succeeded','partially_refunded') and (tg_op='INSERT' or p.id<>new.id);
  incoming:=new.amount-private.refunded_payment_minor(new.id)/100.0;
  if incoming<0 or existing_paid+incoming>invoice_total then raise exception 'Payment would overpay the remaining invoice balance.' using errcode='23514';end if;
  return new;
end $$;
create or replace function public.list_invoice_cash_activity(p_business uuid,p_from timestamptz default null,p_to timestamptz default null)
returns table(id text,invoice_id uuid,invoice_number text,amount numeric,direction text,occurred_at timestamptz,currency text,method text)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.has_business_role(p_business,array['owner','admin','office'])
    or not(private.member_module_access(p_business,auth.uid(),'finances') or private.member_module_access(p_business,auth.uid(),'billing')) then raise exception 'Financial access required.' using errcode='42501';end if;
  -- One statement/snapshot covers original receipts and refund outflows. A
  -- concurrent provider update cannot display only one half of a refund pair.
  return query
    select p.id::text,p.invoice_id,i.invoice_number,p.amount,'income'::text,p.paid_at,'USD'::text,p.method
    from public.payments p join public.invoices i on i.id=p.invoice_id and i.business_id=p.business_id
    where p.business_id=p_business and (p.status='succeeded' or (p.provider in('stripe_customer','square_customer') and p.status in('partially_refunded','refunded')))
      and (p_from is null or p.paid_at>=p_from) and (p_to is null or p.paid_at<p_to)
    union all
    select r.refund_id,c.invoice_id,i.invoice_number,r.amount_minor/100.0,'expense'::text,r.refunded_at,upper(c.currency),p.method
    from private.customer_invoice_refunds r join private.customer_invoice_checkouts c on c.id=r.checkout_id
    join public.invoices i on i.id=c.invoice_id and i.business_id=c.business_id join public.payments p on p.id=c.payment_id
    where c.business_id=p_business and (p_from is null or r.refunded_at>=p_from) and (p_to is null or r.refunded_at<p_to)
    union all
    select 'square:'||r.refund_id,o.invoice_id,i.invoice_number,r.amount_minor/100.0,'expense'::text,r.refunded_at,'USD'::text,'card'::text
    from private.square_payment_refunds r join private.square_invoice_operations o on o.id=r.operation_id
    join public.invoices i on i.id=o.invoice_id and i.business_id=o.business_id
    where o.business_id=p_business and (p_from is null or r.refunded_at>=p_from) and (p_to is null or r.refunded_at<p_to);
end $$;
create or replace function private.guard_manual_payment_operations() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 -- Legacy/manual clients can omit provider or use their own label. Every new
 -- succeeded receipt must respect processing payments; verified Stripe ledger
 -- settlement is checked separately by commerce_payment_guard.
 if new.provider in('stripe_customer','square_customer') or new.status<>'succeeded' then return new;end if;
 if tg_op='UPDATE' and (new.business_id,new.invoice_id,new.amount,new.status,new.provider)
   is not distinct from (old.business_id,old.invoice_id,old.amount,old.status,old.provider) then return new;end if;
 perform private.require_record_module(new.business_id,'billing',true);
 perform 1 from public.invoices where id=new.invoice_id and business_id=new.business_id for update;
 if not found then raise exception 'Invoice unavailable.' using errcode='42501';end if;
 if exists(select 1 from private.square_invoice_operations where business_id=new.business_id and invoice_id=new.invoice_id and status in('reserved','open','pending','review_required')) then raise exception 'A Square payment is processing or needs review. Verify its status first.' using errcode='23514';end if;
 if exists(select 1 from private.customer_invoice_checkouts c where c.business_id=new.business_id and c.invoice_id=new.invoice_id and c.status in('pending','review_required')) then
  raise exception 'A customer payment is processing or needs review. Reconcile it before recording another payment.' using errcode='23514';end if;
 return new;
end $$;
create or replace function public.get_invoice_payment_operations(p_business uuid,p_invoice uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare state text;refunds jsonb;
begin
 perform private.require_record_module(p_business,'billing');
 if not exists(select 1 from public.invoices where id=p_invoice and business_id=p_business) then raise exception 'Invoice unavailable.' using errcode='42501';end if;
 state:=case when exists(select 1 from private.square_invoice_operations where business_id=p_business and invoice_id=p_invoice and status='review_required') then 'review_required' when exists(select 1 from private.square_invoice_operations where business_id=p_business and invoice_id=p_invoice and status in('reserved','open','pending')) then 'pending' when exists(select 1 from private.customer_invoice_checkouts where business_id=p_business and invoice_id=p_invoice and status='review_required') then 'review_required'
  when exists(select 1 from private.customer_invoice_checkouts where business_id=p_business and invoice_id=p_invoice and status='pending') then 'pending' else 'clear' end;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.refund_id,'amount',r.amount_minor/100.0,'refunded_at',r.refunded_at,'currency',c.currency) order by r.refunded_at,r.refund_id),'[]'::jsonb)
 into refunds from private.customer_invoice_refunds r join private.customer_invoice_checkouts c on c.id=r.checkout_id where c.business_id=p_business and c.invoice_id=p_invoice;
 refunds:=refunds||coalesce((select jsonb_agg(jsonb_build_object('id','square:'||r.refund_id,'amount',r.amount_minor/100.0,'refunded_at',r.refunded_at,'currency','USD') order by r.refunded_at) from private.square_payment_refunds r join private.square_invoice_operations o on o.id=r.operation_id where o.business_id=p_business and o.invoice_id=p_invoice),'[]'::jsonb);
 return jsonb_build_object('state',state,'refunds',refunds,'message',case state
  when 'pending' then 'A customer payment is processing. Wait for confirmation before recording another payment.'
  when 'review_required' then 'An online payment or refund needs reconciliation. Review the payment before recording another.' end);
end $$;
create or replace function public.list_customer_payment_reviews(p_business uuid)
returns table(id uuid,invoice_id uuid,invoice_number text,amount numeric,currency text,reason text,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.has_business_role(p_business,array['owner','admin','office'])
    or not(private.member_module_access(p_business,auth.uid(),'finances') or private.member_module_access(p_business,auth.uid(),'billing')) then raise exception 'Financial access required.' using errcode='42501';end if;
  return query select c.id,c.invoice_id,i.invoice_number,c.amount_minor/100.0,upper(c.currency),c.review_reason,c.created_at
    from private.customer_invoice_checkouts c join public.invoices i on i.id=c.invoice_id where c.business_id=p_business and c.status='review_required'
 union all select o.id,o.invoice_id,i.invoice_number,o.amount_minor/100.0,o.currency,'Square: '||o.review_reason,o.created_at from private.square_invoice_operations o join public.invoices i on i.id=o.invoice_id where o.business_id=p_business and o.status='review_required';
end $$;

create table private.retired_payment_defaults(
 business_id uuid primary key references public.businesses(id) on delete cascade,
 payment_links jsonb not null,payment_service_setups jsonb,retired_at timestamptz not null default now()
);
alter table private.retired_payment_defaults enable row level security;
revoke all on private.retired_payment_defaults from public,anon,authenticated,service_role;
insert into private.retired_payment_defaults(business_id,payment_links,payment_service_setups)
select business_id,payment_links,payment_service_setups from public.business_settings s
where exists(select 1 from jsonb_array_elements(s.payment_links)x where x->>'provider' not in('stripe','square'))
 or exists(select 1 from jsonb_array_elements(coalesce(s.payment_service_setups,'[]'::jsonb))x where x->>'provider' not in('stripe','square'));
update public.business_settings s set payment_links=coalesce((select jsonb_agg(x) from jsonb_array_elements(s.payment_links)x where x->>'provider' in('stripe','square')),'[]'::jsonb),
 payment_service_setups=case when s.payment_service_setups is null then null else coalesce((select jsonb_agg(x) from jsonb_array_elements(s.payment_service_setups)x where x->>'provider' in('stripe','square')),'[]'::jsonb) end;
create function private.only_supported_payment_defaults() returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from jsonb_array_elements(coalesce(new.payment_service_setups,'[]'::jsonb)) x where x->>'provider' not in('stripe','square')) or exists(select 1 from jsonb_array_elements(new.payment_links) x where x->>'provider' not in('stripe','square')) then raise exception 'Choose Stripe or Square for new payment defaults.' using errcode='23514';end if;return new;
end $$;
create trigger supported_payment_defaults before insert or update of payment_links,payment_service_setups on public.business_settings for each row execute function private.only_supported_payment_defaults();
revoke all on function private.only_supported_payment_defaults() from public,anon,authenticated,service_role;

create or replace function private.customer_payment_context(p_token_hash text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare context jsonb; i public.invoices%rowtype; merchant private.customer_payment_merchants%rowtype; amount bigint; state text;
begin
  context:=private.document_share_context(p_token_hash);
  if context->>'kind'<>'invoice' then raise exception 'Invoice link required.' using errcode='42501';end if;
  select * into i from public.invoices where id=(context->>'document_id')::uuid and business_id=(context->>'business_id')::uuid;
  if not found then raise exception 'Invoice unavailable.' using errcode='42501';end if;
  amount:=round(coalesce(i.balance_due,0)*100)::bigint;
  select * into merchant from private.customer_payment_merchants where business_id=i.business_id;
  state:=case
    when exists(select 1 from private.square_invoice_operations where invoice_id=i.id and status='review_required') then 'review_required'
    when exists(select 1 from private.square_invoice_operations where invoice_id=i.id and status in('reserved','open','pending')) then 'pending'
    when private.effective_plan(i.business_id)<>'pro' then 'disabled'
    when exists(select 1 from private.customer_invoice_checkouts where invoice_id=i.id and status='review_required') then 'review_required'
    when context->>'publication_ready' is distinct from 'true' or context->>'revision_id' is null
      or context->>'action_state' is distinct from 'payment_due' or coalesce((context->>'superseded')::boolean,true)
      or (context->>'action_expires_at')::timestamptz<=now()
      or i.status not in('sent','viewed','partial','overdue') or amount not between 50 and 99999999
      or lower(context->>'currency') is distinct from 'usd' then 'not_payable'
    when exists(select 1 from private.customer_invoice_checkouts where invoice_id=i.id and status='pending') then 'pending'
    when merchant.business_id is null or not merchant.enabled or merchant.verified_at is null then 'not_connected'
    else 'ready' end;
  return jsonb_build_object('state',state,'business_id',i.business_id,'invoice_id',i.id,
    'revision_id',context->>'revision_id','number',i.invoice_number,'balance_minor',amount,'currency',lower(context->>'currency'),
    'stripe_account_id',merchant.stripe_account_id,'livemode',merchant.livemode);
end $$;

create function private.supported_draft_payment_destinations() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='draft' then new.payment_links:=coalesce((select jsonb_agg(x) from jsonb_array_elements(new.payment_links)x where x->>'provider' in('stripe','square')),'[]'::jsonb);end if;
 return new;
end $$;
create trigger supported_draft_invoice_payments before insert or update of payment_links on public.invoices for each row execute function private.supported_draft_payment_destinations();
create trigger supported_draft_estimate_payments before insert or update of payment_links on public.estimates for each row execute function private.supported_draft_payment_destinations();
revoke all on function private.supported_draft_payment_destinations() from public,anon,authenticated,service_role;
