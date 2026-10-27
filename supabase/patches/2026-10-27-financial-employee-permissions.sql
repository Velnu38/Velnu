-- Keep ordinary field updates separate from financial authority.
-- Only owners, admins and office users can mutate financial records.
-- Internal service-role operations with no end-user JWT remain governed by
-- their separately authenticated backend paths, not this employee-role check.
create or replace function private.velnu_financial_role_guard()
returns trigger
language plpgsql security invoker
set search_path = ''
as $fn$
declare workspace_id uuid;
begin
  workspace_id := case when tg_op = 'DELETE' then old.business_id else new.business_id end;
  if (select auth.uid()) is not null
     and not private.has_business_role(workspace_id, array['owner','admin','office'])
  then
    raise exception 'Only an owner, administrator, or office user may change financial records';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$fn$;
do $add_finance_guards$
declare t text;
begin
  foreach t in array array[
    'invoices', 'invoice_items', 'estimates', 'estimate_items',
    'payments', 'change_orders', 'change_order_items', 'bookkeeping_entries'
  ] loop
    execute format('drop trigger if exists velnu_financial_access on public.%I', t);
    execute format('create trigger velnu_financial_access before insert or update or delete on public.%I for each row execute function private.velnu_financial_role_guard()', t);
  end loop;
end;
$add_finance_guards$;
