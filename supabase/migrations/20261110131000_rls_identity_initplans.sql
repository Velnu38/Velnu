-- Cache the request identity once per statement. Keep every existing tenant,
-- module, parent-record and field-access predicate, role and policy mode intact.
-- This migration only addresses the 23 verified auth initplan warnings.
do $$
declare p record; changed integer:=0; clause text;
begin
 for p in select * from pg_policies where schemaname='public' and (
  (policyname='owner_module_access' and tablename=any(array[
   'jobs','appointments','reminders','document_schedules','invoices','invoice_items',
   'estimates','estimate_items','change_orders','change_order_items',
   'document_approval_links','document_approvals','messages','payments',
   'bookkeeping_entries','quickbooks_connections','quickbooks_transactions',
   'record_photos','ai_actions','voice_transcriptions']))
  or (tablename='bookkeeping_entries' and policyname='owner_parent_access')
  or (tablename='business_settings' and policyname='module_settings_read')
  or (tablename='user_agreement_acceptances' and policyname='velnu_agreement_acceptance_insert')
 ) order by tablename,policyname loop
  if position('auth.uid()' in coalesce(p.qual,'')||coalesce(p.with_check,''))=0
   or (coalesce(p.qual,'')||coalesce(p.with_check,'')) ~* 'select\s+auth\.uid' then
   raise exception 'Unexpected identity policy definition: %.%',p.tablename,p.policyname;
  end if;
  clause:='';
  if p.qual is not null then clause:=clause||format(' using (%s)',replace(p.qual,'auth.uid()','(select auth.uid())'));end if;
  if p.with_check is not null then clause:=clause||format(' with check (%s)',replace(p.with_check,'auth.uid()','(select auth.uid())'));end if;
  execute format('alter policy %I on public.%I%s',p.policyname,p.tablename,clause);
  changed:=changed+1;
 end loop;
 if changed<>23 then raise exception 'Expected 23 verified identity policies; found %',changed;end if;
end $$;
