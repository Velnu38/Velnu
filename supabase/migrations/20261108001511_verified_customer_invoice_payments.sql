-- A safe, disabled-until-connected customer payments lane. Finviant subscription
-- billing and arbitrary external/manual payment links remain separate.
create table private.customer_payment_merchants (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  stripe_account_id text not null check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  livemode boolean not null default false,
  enabled boolean not null default false,
  verified_at timestamptz,
  verification_reference text,
  unique(stripe_account_id,livemode)
);
create table private.customer_invoice_checkouts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  invoice_id uuid not null references public.invoices(id),
  revision_id uuid not null,
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  request_id uuid not null,
  stripe_account_id text not null,
  livemode boolean not null,
  amount_minor bigint not null check (amount_minor between 50 and 99999999),
  currency text not null check (currency='usd'),
  status text not null default 'reserved' check(status in('reserved','open','pending','paid','failed','expired','review_required')),
  stripe_session_id text unique,
  stripe_payment_intent text,
  checkout_url text,
  payment_id uuid references public.payments(id),
  review_reason text,
  expires_at timestamptz not null default now()+interval '24 hours',
  created_at timestamptz not null default now(),
  unique(business_id,request_id)
);
create unique index customer_invoice_one_checkout on private.customer_invoice_checkouts(invoice_id)
  where status in('reserved','open','pending');
create index customer_checkout_intent on private.customer_invoice_checkouts(stripe_account_id,stripe_payment_intent);
create table private.customer_payment_webhook_events (
  stripe_account_id text not null,
  livemode boolean not null,
  event_id text not null,
  checkout_id uuid references private.customer_invoice_checkouts(id),
  outcome text not null,
  created_at timestamptz not null default now(),
  primary key(stripe_account_id,livemode,event_id)
);
create table private.customer_invoice_refunds (
  stripe_account_id text not null,
  refund_id text not null,
  checkout_id uuid not null references private.customer_invoice_checkouts(id),
  amount_minor bigint not null check(amount_minor>0),
  refunded_at timestamptz not null,
  primary key(stripe_account_id,refund_id)
);
alter table private.customer_payment_merchants enable row level security;
alter table private.customer_invoice_checkouts enable row level security;
alter table private.customer_payment_webhook_events enable row level security;
alter table private.customer_invoice_refunds enable row level security;
revoke all on private.customer_payment_merchants,private.customer_invoice_checkouts,
  private.customer_payment_webhook_events,private.customer_invoice_refunds from public,anon,authenticated,service_role;

-- A verified Connect onboarding flow must populate this table server-side.
-- There is deliberately no client-callable "bind arbitrary account" function.
create function private.customer_payment_context(p_token_hash text) returns jsonb
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

create function public.get_customer_payment_context(p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$begin return private.customer_payment_context(p_token_hash);end $$;

create function public.reserve_customer_checkout(p_token_hash text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb; c private.customer_invoice_checkouts%rowtype; i public.invoices%rowtype;
begin
  context:=private.customer_payment_context(p_token_hash);
  if p_request_id is null or context->>'state'<>'ready' then raise exception 'Online payment is unavailable.' using errcode='23514';end if;
  select * into i from public.invoices where id=(context->>'invoice_id')::uuid for update;
  context:=private.customer_payment_context(p_token_hash);
  if context->>'state'<>'ready' then raise exception 'Invoice changed. Reload before paying.' using errcode='23514';end if;
  select * into c from private.customer_invoice_checkouts where business_id=i.business_id and request_id=p_request_id;
  if found and (c.invoice_id<>i.id or c.revision_id<>(context->>'revision_id')::uuid) then
    raise exception 'Payment request belongs to another invoice revision.' using errcode='23514';
  end if;
  update private.customer_invoice_checkouts set status='expired'
    where invoice_id=i.id and status='open' and expires_at<=now();
  select * into c from private.customer_invoice_checkouts where invoice_id=i.id and status in('reserved','open','pending') for update;
  if found then
    if c.revision_id<>(context->>'revision_id')::uuid or c.amount_minor<>(context->>'balance_minor')::bigint
      or c.stripe_account_id<>context->>'stripe_account_id' or c.livemode<>(context->>'livemode')::boolean then
      raise exception 'An earlier online payment needs review before another can start.' using errcode='23514';
    end if;
    return to_jsonb(c)||jsonb_build_object('number',i.invoice_number);
  end if;
  if exists(select 1 from private.customer_invoice_checkouts where business_id=i.business_id and request_id=p_request_id) then
    raise exception 'This payment attempt is closed. Reload the invoice before trying again.' using errcode='23514';
  end if;
  insert into private.customer_invoice_checkouts(business_id,invoice_id,revision_id,token_hash,request_id,stripe_account_id,livemode,amount_minor,currency)
    values(i.business_id,i.id,(context->>'revision_id')::uuid,p_token_hash,p_request_id,context->>'stripe_account_id',(context->>'livemode')::boolean,(context->>'balance_minor')::bigint,'usd') returning * into c;
  return to_jsonb(c)||jsonb_build_object('number',i.invoice_number);
end $$;

create function public.attach_customer_checkout(p_checkout uuid,p_session text,p_url text,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.customer_invoice_checkouts%rowtype; context jsonb;
begin
  select * into c from private.customer_invoice_checkouts where id=p_checkout for update;
  if not found or p_session is null or p_url is null or p_expires_at is null or p_session !~ '^cs_[A-Za-z0-9_]+$' or p_url !~ '^https://checkout[.]stripe[.]com/'
    or p_expires_at<=now() or p_expires_at>now()+interval '25 hours' then raise exception 'Payment page could not be verified.' using errcode='23514';end if;
  if c.stripe_session_id is not null and c.stripe_session_id<>p_session then raise exception 'Payment session conflict.' using errcode='23514';end if;
  if c.status in('paid','pending') then return jsonb_build_object('accepted',false,'state',c.status);end if;
  context:=private.customer_payment_context(c.token_hash);
  if context->>'state'<>'ready' or (context->>'revision_id')::uuid<>c.revision_id or (context->>'balance_minor')::bigint<>c.amount_minor then
    update private.customer_invoice_checkouts set status='review_required',stripe_session_id=p_session,review_reason='invoice_changed_before_checkout' where id=c.id;
    return jsonb_build_object('accepted',false,'state','review_required');
  end if;
  update private.customer_invoice_checkouts set status='open',stripe_session_id=p_session,checkout_url=p_url,expires_at=p_expires_at where id=c.id;
  return jsonb_build_object('accepted',true,'state','ready');
end $$;

create function public.get_customer_checkout_event_context(p_checkout uuid,p_account text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c private.customer_invoice_checkouts%rowtype;
begin
  select * into c from private.customer_invoice_checkouts where id=p_checkout and stripe_account_id=p_account;
  if not found then return null;end if;
  return to_jsonb(c);
end $$;

create function public.apply_customer_payment_event(p_event_id text,p_account text,p_checkout uuid,p_session text,
  p_payment_intent text,p_amount_minor bigint,p_currency text,p_livemode boolean,p_status text,p_occurred_at timestamptz,p_method text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.customer_invoice_checkouts%rowtype; i public.invoices%rowtype; payment uuid;
begin
  select * into c from private.customer_invoice_checkouts where id=p_checkout and stripe_account_id=p_account;
  if not found then raise exception 'Unknown invoice payment.' using errcode='23514';end if;
  select * into i from public.invoices where id=c.invoice_id for update;
  select * into c from private.customer_invoice_checkouts where id=p_checkout for update;
  if p_event_id is null or p_session is null or p_amount_minor is null or p_currency is null or p_livemode is null or p_status is null or p_method is null
    or c.livemode is distinct from p_livemode or p_currency<>c.currency or p_amount_minor<>c.amount_minor
    or p_session !~ '^cs_[A-Za-z0-9_]+$' or (c.stripe_session_id is not null and c.stripe_session_id<>p_session)
    or p_status not in('paid','pending','failed','expired') or p_method not in('card','ach','other') or p_event_id !~ '^evt_[A-Za-z0-9]+$'
    or p_occurred_at is null or p_occurred_at>now()+interval '5 minutes' then raise exception 'Invoice payment verification failed.' using errcode='23514';end if;
  if p_status in('paid','pending') and coalesce(p_payment_intent,'') !~ '^pi_[A-Za-z0-9]+$' then raise exception 'Verified payment reference required.';end if;
  if (p_payment_intent is not null and p_payment_intent !~ '^pi_[A-Za-z0-9]+$')
    or (c.stripe_payment_intent is not null and p_payment_intent is not null and c.stripe_payment_intent<>p_payment_intent) then
    raise exception 'Payment reference conflict.' using errcode='23514';end if;
  insert into private.customer_payment_webhook_events(stripe_account_id,livemode,event_id,checkout_id,outcome)
    values(p_account,p_livemode,p_event_id,c.id,p_status) on conflict do nothing;
  if not found then return jsonb_build_object('duplicate',true,'state',c.status);end if;
  if c.status='paid' then return jsonb_build_object('duplicate',true,'state','paid');end if;
  update private.customer_invoice_checkouts set stripe_session_id=p_session,stripe_payment_intent=coalesce(p_payment_intent,stripe_payment_intent) where id=c.id;
  if p_status<>'paid' then
    if p_status='pending' and c.status in('failed','expired','review_required') then return jsonb_build_object('state',c.status);end if;
    if c.status<>'review_required' and not(c.status='pending' and p_status='expired') then
      update private.customer_invoice_checkouts set status=p_status where id=c.id;
    end if;
    return jsonb_build_object('state',p_status);
  end if;
  if i.status in('draft','void') or round(coalesce(i.balance_due,0)*100)::bigint<c.amount_minor then
    update private.customer_invoice_checkouts set status='review_required',review_reason='settled_payment_needs_reconciliation' where id=c.id;
    return jsonb_build_object('state','review_required');
  end if;
  insert into public.payments(business_id,invoice_id,amount,method,provider,provider_payment_id,status,paid_at,notes)
    values(c.business_id,c.invoice_id,c.amount_minor/100.0,p_method,'stripe_customer',p_account||':'||p_payment_intent,'succeeded',p_occurred_at,'Verified online invoice payment')
    returning id into payment;
  update private.customer_invoice_checkouts set status='paid',payment_id=payment where id=c.id;
  return jsonb_build_object('state','paid','payment_id',payment);
end $$;

-- Refunds retain original gross receipts and separate immutable cash outflows.
-- The invoice balance follows net received funds, and the workbook shows the
-- refund on its actual date rather than rewriting the historical receipt.
create function public.apply_customer_payment_refund(p_event_id text,p_account text,p_checkout uuid,p_payment_intent text,
  p_livemode boolean,p_currency text,p_refunds jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.customer_invoice_checkouts%rowtype; r jsonb; refunded bigint; original private.customer_invoice_refunds%rowtype;
begin
  select * into c from private.customer_invoice_checkouts where id=p_checkout and stripe_account_id=p_account;
  if not found then raise exception 'Unknown refund invoice.';end if;
  perform 1 from public.invoices where id=c.invoice_id for update;
  select * into c from private.customer_invoice_checkouts where id=p_checkout for update;
  if p_event_id is null or p_livemode is null or p_currency is null or p_refunds is null or p_payment_intent is null
    or c.livemode is distinct from p_livemode or p_currency<>c.currency or c.stripe_payment_intent is distinct from p_payment_intent
    or c.payment_id is null or jsonb_typeof(p_refunds)<>'array' or jsonb_array_length(p_refunds)>100
    or p_event_id !~ '^evt_[A-Za-z0-9]+$' then raise exception 'Refund verification failed.';end if;
  insert into private.customer_payment_webhook_events(stripe_account_id,livemode,event_id,checkout_id,outcome)
    values(p_account,p_livemode,p_event_id,c.id,'refund') on conflict do nothing;
  if not found then return jsonb_build_object('duplicate',true);end if;
  for r in select value from jsonb_array_elements(p_refunds) loop
    if r->>'id' is null or r->>'amount_minor' is null or r->>'refunded_at' is null or r->>'id' !~ '^re_[A-Za-z0-9]+$' or (r->>'amount_minor')::bigint<=0
      or (r->>'refunded_at')::timestamptz>now()+interval '5 minutes' then raise exception 'Invalid verified refund.';end if;
    select * into original from private.customer_invoice_refunds where stripe_account_id=p_account and refund_id=r->>'id';
    if found then
      if original.checkout_id<>c.id or original.amount_minor<>(r->>'amount_minor')::bigint then raise exception 'Refund identifier conflict.';end if;
    else
      insert into private.customer_invoice_refunds(stripe_account_id,refund_id,checkout_id,amount_minor,refunded_at)
        values(p_account,r->>'id',c.id,(r->>'amount_minor')::bigint,(r->>'refunded_at')::timestamptz);
    end if;
  end loop;
  select coalesce(sum(amount_minor),0) into refunded from private.customer_invoice_refunds where checkout_id=c.id;
  if refunded>c.amount_minor then raise exception 'Refund exceeds original payment.';end if;
  begin
    update public.payments set status=case when refunded=c.amount_minor then 'refunded' when refunded>0 then 'partially_refunded' else 'succeeded' end where id=c.payment_id;
  exception when raise_exception then
    if sqlerrm not like 'This deposit is credited on a final invoice.%' then raise;end if;
    -- A credited deposit and its final invoice require a combined adjustment.
    -- Retain verified cash evidence and stop retries without rewriting either
    -- historical invoice or silently dropping a real provider refund.
    update private.customer_invoice_checkouts set status='review_required',review_reason='credited_deposit_refund' where id=c.id;
    insert into public.business_activity(business_id) values(c.business_id) on conflict(business_id)
      do update set version=public.business_activity.version+1,updated_at=now();
    return jsonb_build_object('state','review_required','refunded_minor',refunded);
  end;
  return jsonb_build_object('refunded_minor',refunded);
end $$;

create function public.list_customer_payment_reviews(p_business uuid)
returns table(id uuid,invoice_id uuid,invoice_number text,amount numeric,currency text,reason text,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.has_business_role(p_business,array['owner','admin','office'])
    or not(private.member_module_access(p_business,auth.uid(),'finances') or private.member_module_access(p_business,auth.uid(),'billing')) then raise exception 'Financial access required.' using errcode='42501';end if;
  return query select c.id,c.invoice_id,i.invoice_number,c.amount_minor/100.0,upper(c.currency),c.review_reason,c.created_at
    from private.customer_invoice_checkouts c join public.invoices i on i.id=c.invoice_id where c.business_id=p_business and c.status='review_required';
end $$;

create or replace function private.commerce_payment_guard() returns trigger language plpgsql set search_path='' as $$
declare s text; refunded bigint; expected text;
begin
  if tg_op='DELETE' then raise exception 'Payment records cannot be deleted';end if;
  if tg_op='UPDATE' and(new.invoice_id<>old.invoice_id or new.business_id<>old.business_id or new.amount<>old.amount or new.paid_at<>old.paid_at) then raise exception 'Posted payment details are immutable';end if;
  select status into s from public.invoices where id=new.invoice_id and business_id=new.business_id for update;
  if s is null or s in('draft','void') then raise exception 'Payments require an issued non-void invoice';end if;
  if new.amount<>round(new.amount,2) or new.amount>1000000000 then raise exception 'Invalid payment amount';end if;
  if tg_op='UPDATE' and old.provider='stripe_customer' and (new.provider is distinct from old.provider or new.provider_payment_id is distinct from old.provider_payment_id) then
    raise exception 'Verified payment identity is immutable';end if;
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

create function public.list_invoice_cash_activity(p_business uuid,p_from timestamptz default null,p_to timestamptz default null)
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
    where p.business_id=p_business and (p.status='succeeded' or (p.provider='stripe_customer' and p.status in('partially_refunded','refunded')))
      and (p_from is null or p.paid_at>=p_from) and (p_to is null or p.paid_at<p_to)
    union all
    select r.refund_id,c.invoice_id,i.invoice_number,r.amount_minor/100.0,'expense'::text,r.refunded_at,upper(c.currency),p.method
    from private.customer_invoice_refunds r join private.customer_invoice_checkouts c on c.id=r.checkout_id
    join public.invoices i on i.id=c.invoice_id and i.business_id=c.business_id join public.payments p on p.id=c.payment_id
    where c.business_id=p_business and (p_from is null or r.refunded_at>=p_from) and (p_to is null or r.refunded_at<p_to);
end $$;
create or replace function private.commerce_paid_recalc() returns trigger language plpgsql security definer set search_path='' as $$
declare i uuid; paid numeric(12,2);
begin
  i:=case when tg_op='DELETE' then old.invoice_id else new.invoice_id end;
  select coalesce(sum(p.amount-coalesce((select sum(r.amount_minor)/100.0 from private.customer_invoice_refunds r
    join private.customer_invoice_checkouts c on c.id=r.checkout_id where c.payment_id=p.id),0)) filter(where p.status in('succeeded','partially_refunded')),0)
    into paid from public.payments p where p.invoice_id=i;
  update public.invoices set amount_paid=paid,status=case when status='void' then 'void' when total>0 and paid>=total then 'paid' when paid>0 then 'partial' when sent_at is null then 'draft' else 'sent' end,
    paid_at=case when total>0 and paid>=total then coalesce(paid_at,now()) else null end where id=i;
  if tg_op='DELETE' then return old;end if;return new;
end $$;

-- Trigger-only calculation needs the private refund ledger. Existing financial
-- write/tenant guards still authorize the row before these totals are checked.
create or replace function public.prevent_invoice_overpayment() returns trigger language plpgsql security definer set search_path='' as $$
declare invoice_total numeric; existing_paid numeric; incoming numeric;
begin
  if new.status not in('succeeded','partially_refunded') then return new;end if;
  select total into invoice_total from public.invoices where id=new.invoice_id and business_id=new.business_id for update;
  if invoice_total is null then return new;end if;
  select coalesce(sum(p.amount-coalesce((select sum(r.amount_minor)/100.0 from private.customer_invoice_refunds r
    join private.customer_invoice_checkouts c on c.id=r.checkout_id where c.payment_id=p.id),0)),0)
    into existing_paid from public.payments p where p.invoice_id=new.invoice_id and p.business_id=new.business_id
      and p.status in('succeeded','partially_refunded') and (tg_op='INSERT' or p.id<>new.id);
  incoming:=new.amount-coalesce((select sum(r.amount_minor)/100.0 from private.customer_invoice_refunds r
    join private.customer_invoice_checkouts c on c.id=r.checkout_id where c.payment_id=new.id),0);
  if incoming<0 or existing_paid+incoming>invoice_total then raise exception 'Payment would overpay the remaining invoice balance.' using errcode='23514';end if;
  return new;
end $$;
revoke all on function public.prevent_invoice_overpayment() from public,anon,authenticated,service_role;

create function public.list_customer_payment_refunds(p_business uuid,p_from timestamptz default null,p_to timestamptz default null)
returns table(id text,invoice_id uuid,invoice_number text,amount numeric,refunded_at timestamptz,currency text)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.has_business_role(p_business,array['owner','admin','office'])
    or not(private.member_module_access(p_business,auth.uid(),'finances') or private.member_module_access(p_business,auth.uid(),'billing')) then raise exception 'Financial access required.' using errcode='42501';end if;
  return query select r.refund_id,c.invoice_id,i.invoice_number,r.amount_minor/100.0,r.refunded_at,c.currency
    from private.customer_invoice_refunds r join private.customer_invoice_checkouts c on c.id=r.checkout_id
    join public.invoices i on i.id=c.invoice_id where c.business_id=p_business
      and (p_from is null or r.refunded_at>=p_from) and (p_to is null or r.refunded_at<p_to) order by r.refund_id;
end $$;

-- Minimal, tenant-scoped invalidation. No financial/customer payload is broadcast.
create table public.business_activity (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.business_activity enable row level security;
revoke all on public.business_activity from public,anon,authenticated,service_role;
grant select on public.business_activity to authenticated;
create policy business_activity_read on public.business_activity for select to authenticated using(private.is_business_member(business_id));
create function private.bump_business_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare b uuid;
begin
  b:=case when tg_op='DELETE' then old.business_id else new.business_id end;
  insert into public.business_activity(business_id) values(b) on conflict(business_id)
    do update set version=public.business_activity.version+1,updated_at=now();
  if tg_op='DELETE' then return old;end if;return new;
end $$;
do $$declare t text;begin
  foreach t in array array['invoices','estimates','change_orders','payments','jobs','bookkeeping_entries'] loop
    execute format('create trigger finviant_business_activity after insert or update or delete on public.%I for each row execute function private.bump_business_activity()',t);
  end loop;
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='business_activity') then
    alter publication supabase_realtime add table public.business_activity;
  end if;
end $$;

revoke all on function private.customer_payment_context(text),private.bump_business_activity() from public,anon,authenticated,service_role;
revoke all on function public.get_customer_payment_context(text),public.reserve_customer_checkout(text,uuid),public.attach_customer_checkout(uuid,text,text,timestamptz),
  public.get_customer_checkout_event_context(uuid,text),public.apply_customer_payment_event(text,text,uuid,text,text,bigint,text,boolean,text,timestamptz,text),
  public.apply_customer_payment_refund(text,text,uuid,text,boolean,text,jsonb),public.list_customer_payment_refunds(uuid,timestamptz,timestamptz),public.list_invoice_cash_activity(uuid,timestamptz,timestamptz),public.list_customer_payment_reviews(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_customer_payment_context(text),public.reserve_customer_checkout(text,uuid),public.attach_customer_checkout(uuid,text,text,timestamptz),
  public.get_customer_checkout_event_context(uuid,text),public.apply_customer_payment_event(text,text,uuid,text,text,bigint,text,boolean,text,timestamptz,text),
  public.apply_customer_payment_refund(text,text,uuid,text,boolean,text,jsonb) to service_role;
grant execute on function public.list_customer_payment_refunds(uuid,timestamptz,timestamptz) to authenticated;
grant execute on function public.list_invoice_cash_activity(uuid,timestamptz,timestamptz) to authenticated;
grant execute on function public.list_customer_payment_reviews(uuid) to authenticated;
