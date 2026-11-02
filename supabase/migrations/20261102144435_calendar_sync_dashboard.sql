-- Additive: auth.users/businesses and the existing financial tables remain authoritative.
-- No provider HTTP calls run in document transactions. Credentials are never exposed by PostgREST.
create table public.document_schedules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  estimate_id uuid unique, invoice_id uuid unique,
  job_title text not null check (length(btrim(job_title)) between 1 and 200),
  description text not null default '' check (length(description) <= 2000),
  scheduled_start_time timestamptz not null,
  scheduled_end_time timestamptz not null,
  timezone text not null,
  status text not null default 'scheduled' check(status in ('planned','scheduled','cancelled')),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(estimate_id,invoice_id)=1),
  check (scheduled_end_time > scheduled_start_time),
  foreign key(estimate_id,business_id) references public.estimates(id,business_id) on delete cascade,
  foreign key(invoice_id,business_id) references public.invoices(id,business_id) on delete cascade
);
alter table public.document_schedules enable row level security;
revoke all on public.document_schedules from anon,authenticated;
grant select,insert,update,delete on public.document_schedules to authenticated;
create policy calendar_schedule_access on public.document_schedules for all to authenticated
using (exists(select 1 from public.business_members m where m.business_id=document_schedules.business_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','office')))
with check (exists(select 1 from public.business_members m where m.business_id=document_schedules.business_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','office')));

create function private.validate_document_schedule() returns trigger language plpgsql set search_path='' as $$
declare linked_job uuid;
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone) then raise exception 'Invalid IANA timezone' using errcode='22023'; end if;
  if tg_op='UPDATE' and (new.id,new.business_id,new.estimate_id,new.invoice_id) is distinct from (old.id,old.business_id,old.estimate_id,old.invoice_id) then raise exception 'Schedule identity cannot change'; end if;
  if new.estimate_id is not null then select job_id into linked_job from public.estimates where id=new.estimate_id and business_id=new.business_id;
  else select job_id into linked_job from public.invoices where id=new.invoice_id and business_id=new.business_id; end if;
  if linked_job is not null then raise exception 'Schedule linked jobs in Jobs & schedule'; end if;
  new.updated_at:=now(); return new;
end $$;
create trigger validate_document_schedule before insert or update on public.document_schedules for each row execute function private.validate_document_schedule();

create table private.calendar_integrations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  provider text not null check(provider in ('google','outlook')),
  account_id text not null, email text not null,
  calendar_id text not null default 'primary', calendar_name text not null default 'Primary calendar',
  auto_sync boolean not null default false,
  state text not null default 'connected' check(state in ('connected','reconnect_required','disconnecting','disconnected')),
  -- AES-256-GCM envelope with key id, nonce, ciphertext and authentication tag.
  -- Plain access/refresh tokens and MSAL cache exist only in server memory.
  credentials jsonb,
  last_synced_at timestamptz, last_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(business_id,user_id,provider)
);
create index calendar_integrations_business on private.calendar_integrations(business_id);
create table private.calendar_oauth_states (
  state_hash text primary key, business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check(provider in ('google','outlook')),
  browser_hash text not null, verifier jsonb not null,
  expires_at timestamptz not null, created_at timestamptz not null default now()
);
create index calendar_oauth_expiry on private.calendar_oauth_states(expires_at);
create table private.calendar_sync_queue (
  integration_id uuid primary key references private.calendar_integrations(id) on delete cascade,
  revision bigint not null default 1, attempts integer not null default 0,
  available_at timestamptz not null default now(), lease_id uuid, lease_until timestamptz,
  event_name text not null default 'WORK_CHANGED', last_error text, dead boolean not null default false
);
create index calendar_queue_ready on private.calendar_sync_queue(available_at) where not dead;
create table private.calendar_event_links (
  integration_id uuid not null references private.calendar_integrations(id) on delete cascade,
  source_key text not null, calendar_id text not null,
  calendar_event_id text, generation integer not null default 0,
  fingerprint text, updated_at timestamptz not null default now(),
  primary key(integration_id,source_key,calendar_id)
);
-- Defense in depth: these tables have no client policies or client grants.
alter table private.calendar_integrations enable row level security;
alter table private.calendar_oauth_states enable row level security;
alter table private.calendar_sync_queue enable row level security;
alter table private.calendar_event_links enable row level security;
revoke all on private.calendar_integrations,private.calendar_oauth_states,private.calendar_sync_queue,private.calendar_event_links from public,anon,authenticated;

-- The worker reconciles current rows, not stale event payloads. Queue writes are atomic
-- with financial writes and coalesced per integration; revision protects concurrent edits.
create function private.queue_calendar_business(bid uuid, event_name text) returns void
language sql security definer set search_path='' as $$
  insert into private.calendar_sync_queue(integration_id,event_name)
  select id,event_name from private.calendar_integrations where business_id=bid and state<>'disconnected'
  on conflict(integration_id) do update set revision=private.calendar_sync_queue.revision+1,
    available_at=now(),attempts=0,dead=false,event_name=excluded.event_name;
$$;
revoke all on function private.queue_calendar_business(uuid,text) from public,anon,authenticated;
create function private.calendar_work_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform private.queue_calendar_business(case when tg_op='DELETE' then old.business_id else new.business_id end,
    case when tg_table_name='estimates' then 'ESTIMATE_STATUS_CHANGED' when tg_table_name='invoices' then 'INVOICE_STATUS_CHANGED' else 'WORK_CHANGED' end);
  return null;
end $$;
revoke all on function private.calendar_work_changed() from public,anon,authenticated;
do $$ declare t text; begin
  foreach t in array array['document_schedules','estimates','invoices','appointments','jobs'] loop
    execute format('create trigger calendar_work_changed after insert or update or delete on public.%I for each row execute function private.calendar_work_changed()',t);
  end loop;
end $$;
create function private.calendar_membership_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then
    update private.calendar_integrations set state='disconnecting',auto_sync=false where business_id=old.business_id and user_id=old.user_id and state<>'disconnected';
  end if;
  perform private.queue_calendar_business(old.business_id,'MEMBERSHIP_CHANGED');
  return null;
end $$;
revoke all on function private.calendar_membership_changed() from public,anon,authenticated;
create trigger calendar_membership_changed after update or delete on public.business_members for each row execute function private.calendar_membership_changed();

-- RLS is inherited from all underlying tables. Never use a definer view for the dashboard.
create view public.calendar_work with (security_invoker=true) as
select 'appointment:'||a.id as source_key, a.business_id, a.title, ''::text as description,
 a.starts_at,a.ends_at,b.timezone,a.status,a.assigned_user_id,
 case when i.id is not null then 'invoice' when e.id is not null then 'estimate' else 'work' end as document_kind,
 coalesce(i.id,e.id,a.job_id,a.id) as document_id
from public.appointments a join public.businesses b on b.id=a.business_id
left join public.jobs j on j.id=a.job_id and j.business_id=a.business_id
left join lateral (select id from public.invoices where job_id=a.job_id and business_id=a.business_id and status<>'void' order by created_at desc,id limit 1) i on true
left join lateral (select id from public.estimates where job_id=a.job_id and business_id=a.business_id order by created_at desc,id limit 1) e on true
where a.status not in ('canceled','no_show') and (j.id is null or j.status<>'canceled')
union all
select 'job:'||j.id,j.business_id,j.title,''::text,j.scheduled_start,j.scheduled_end,b.timezone,j.status,null::uuid,
 case when i.id is not null then 'invoice' when e.id is not null then 'estimate' else 'work' end,coalesce(i.id,e.id,j.id)
from public.jobs j join public.businesses b on b.id=j.business_id
left join lateral (select id from public.invoices where job_id=j.id and business_id=j.business_id and status<>'void' order by created_at desc,id limit 1) i on true
left join lateral (select id from public.estimates where job_id=j.id and business_id=j.business_id order by created_at desc,id limit 1) e on true
where j.scheduled_start is not null and j.status<>'canceled' and not exists(select 1 from public.appointments a where a.job_id=j.id and a.business_id=j.business_id)
union all
select 'document:'||s.id,s.business_id,s.job_title,s.description,s.scheduled_start_time,s.scheduled_end_time,s.timezone,
 case when s.status='scheduled' then 'scheduled' else 'approved' end,null::uuid,
 case when coalesce(s.invoice_id,converted.id) is not null then 'invoice' else 'estimate' end,
 coalesce(s.invoice_id,converted.id,s.estimate_id)
from public.document_schedules s
left join public.estimates e on e.id=s.estimate_id and e.business_id=s.business_id
left join public.invoices i on i.id=s.invoice_id and i.business_id=s.business_id
left join public.invoices converted on converted.estimate_id=e.id and converted.business_id=s.business_id
where s.status<>'cancelled' and (s.status='scheduled' or e.status in ('accepted','converted'))
 and coalesce(e.status,'') not in ('declined','expired') and coalesce(i.status,converted.status,'')<>'void'
 and coalesce(e.job_id,i.job_id,converted.job_id) is null
 and (s.estimate_id is null or converted.id is null or not exists(select 1 from public.document_schedules other where other.invoice_id=converted.id));
revoke all on public.calendar_work from public,anon,authenticated;
grant select on public.calendar_work to authenticated;

-- A unified projection supplies the requested estimates_invoices contract without
-- duplicating money or changing the existing financial state machine.
create view public.estimates_invoices with (security_invoker=true) as
select e.id,e.business_id as organization_id,'estimate'::text as document_type,e.customer_id,
 s.job_title,s.description,e.subtotal,e.tax_amount,e.total,
 s.scheduled_start_time,s.scheduled_end_time,s.timezone,
 case when e.status in ('declined','expired') or s.status='cancelled' then 'Cancelled'
 when s.status='scheduled' then 'Scheduled' when e.status in ('accepted','converted') then 'Approved'
 when e.status='sent' then 'Sent' else 'Draft' end as status
from public.estimates e left join public.document_schedules s on s.estimate_id=e.id
union all
select i.id,i.business_id,'invoice',i.customer_id,s.job_title,s.description,i.subtotal,i.tax_amount,i.total,
 s.scheduled_start_time,s.scheduled_end_time,s.timezone,
 case when i.status='void' or s.status='cancelled' then 'Cancelled' when i.status='paid' then 'Paid'
 when s.status='scheduled' then 'Scheduled' when i.status='draft' then 'Draft' else 'Sent' end
from public.invoices i left join public.document_schedules s on s.invoice_id=i.id;
revoke all on public.estimates_invoices from public,anon,authenticated;
grant select on public.estimates_invoices to authenticated;
create index document_schedules_business_start on public.document_schedules(business_id,scheduled_start_time);
