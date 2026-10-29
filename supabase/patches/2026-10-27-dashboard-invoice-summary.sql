-- Compute dashboard invoice totals in Postgres without downloading every open balance.
-- SECURITY INVOKER preserves existing business/tenant row-level security.
create or replace function public.get_dashboard_invoice_totals(target_business_id uuid)
returns table(open_invoices bigint, outstanding_balance numeric)
language sql stable security invoker
set search_path = ''
as $$
  select count(*)::bigint, coalesce(sum(i.balance_due), 0)::numeric
  from public.invoices as i
  where i.business_id = target_business_id
    and i.balance_due > 0
    and i.status not in ('draft', 'void');
$$;
revoke all on function public.get_dashboard_invoice_totals(uuid) from public, anon;
grant execute on function public.get_dashboard_invoice_totals(uuid) to authenticated;

create index if not exists idx_velnu_invoices_open_balance
  on public.invoices (business_id) include (balance_due)
  where balance_due > 0 and status not in ('draft', 'void');
