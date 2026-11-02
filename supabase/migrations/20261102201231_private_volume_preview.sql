-- Explicit operator-only allowance for a named test workspace; no paid entitlements.
-- Empty by default. Never enable for a production/customer workspace.
create table private.volume_test_workspaces(business_id uuid primary key references public.businesses(id),expires_at timestamptz not null);
alter table private.volume_test_workspaces enable row level security;
revoke all on private.volume_test_workspaces from public,anon,authenticated,service_role;
create function private.volume_preview_enabled(b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.volume_test_workspaces where business_id=b and expires_at>now());
$$;
revoke all on function private.volume_preview_enabled(uuid) from public,anon;
grant execute on function private.volume_preview_enabled(uuid) to authenticated,service_role;
CREATE OR REPLACE FUNCTION private.commerce_quota()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  pro boolean;
  preview boolean;
  m date := date_trunc('month', now() at time zone 'UTC')::date;
  n bigint;
  total bigint;
  lim integer;
begin
  pro := private.is_pro(new.business_id);
  preview := private.volume_preview_enabled(new.business_id);
  insert into private.monthly_usage(business_id,month)
  values(new.business_id,m) on conflict do nothing;
  perform 1 from private.monthly_usage
   where business_id=new.business_id and month=m for update;

  if tg_table_name='customers' then
    select count(*) into n from public.customers
    where business_id=new.business_id;
    lim:=case when pro then 5000 else 250 end;
    if n>=lim then
      raise exception 'Customer storage limit reached (%)',lim
      using errcode='23514';
    end if;

  elsif tg_table_name in ('invoices','estimates','change_orders') then
    -- Free: ten invoices and estimates combined, per UTC month.
    -- Change orders retain the existing general document quota but do NOT
    -- consume invoice/estimate slots.
    if not pro and not preview and tg_table_name in ('invoices','estimates') then
      select invoice_estimate_documents into n
      from private.monthly_usage where business_id=new.business_id and month=m;
      if n>=10 then
        raise exception 'Free plan limit reached: 10 invoices and estimates combined per month. Existing records remain available.'
        using errcode='23514';
      end if;
    end if;

    -- Overall safeguard remains in place for change orders and premium usage.
    select documents into n from private.monthly_usage
      where business_id=new.business_id and month=m;
    lim:=case when preview then 5000 when pro then 1000 else 100 end;
    if n>=lim then
      raise exception 'Monthly document limit reached (%). Existing documents remain available.',lim
      using errcode='23514';
    end if;

    select
      (select count(*) from public.invoices where business_id=new.business_id)
      +(select count(*) from public.estimates where business_id=new.business_id)
      +(select count(*) from public.change_orders where business_id=new.business_id)
      into total;
    if total >= (case when pro or preview then 20000 else 1000 end) then
      raise exception 'Stored document limit reached. Export your records or upgrade.'
      using errcode='23514';
    end if;

    update private.monthly_usage
      set documents=documents+1,
        invoice_estimate_documents=invoice_estimate_documents
          + case when tg_table_name in ('invoices','estimates') then 1 else 0 end
      where business_id=new.business_id and month=m;
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION private.get_plan_usage(target_business_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  pro boolean;
  preview boolean;
  u private.monthly_usage%rowtype;
  stored bigint;
  people bigint;
begin
  if auth.uid() is null or not private.is_business_member(target_business_id) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  pro:=private.is_pro(target_business_id);
  preview:=private.volume_preview_enabled(target_business_id);
  select * into u from private.monthly_usage
    where business_id=target_business_id
      and month=date_trunc('month',now() at time zone 'UTC')::date;
  select (select count(*) from public.invoices where business_id=target_business_id)
       +(select count(*) from public.estimates where business_id=target_business_id)
       +(select count(*) from public.change_orders where business_id=target_business_id) into stored;
  select count(*) into people from public.customers where business_id=target_business_id;

  return jsonb_build_object(
    'volume_test',preview,
    'plan',case when pro then 'pro' else 'free' end,
    'period_end',(date_trunc('month',now() at time zone 'UTC')+interval '1 month')::date,
    'documents_used', case when pro or preview then coalesce(u.documents,0) else coalesce(u.invoice_estimate_documents,0) end,
    'documents_limit', case when preview then 5000 when pro then 1000 else 10 end,
    'invoice_estimate_documents_used',coalesce(u.invoice_estimate_documents,0),
    'invoice_estimate_documents_limit',case when preview then 5000 when pro then 1000 else 10 end,
    'stored_documents',stored,
    'stored_limit',case when pro or preview then 20000 else 1000 end,
    'customers_used',people,
    'customers_limit',case when pro then 5000 else 250 end,
    'ai_used',coalesce(u.ai,0),
    'ai_limit',case when pro then 50 else 0 end,
    'voice_used',coalesce(u.voice,0),
    'voice_limit',case when pro then 50 else 0 end,
    'email_used',coalesce(u.email,0),
    'email_limit',case when pro then 250 else 0 end,
    'logo_bytes_limit',case when pro then 131072 else 0 end
  );
end;
$function$;
