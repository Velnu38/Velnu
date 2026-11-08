import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import type { PGlite } from '@electric-sql/pglite'
import { actor, fixture, ids } from '../scheduling/fixture.ts'

const baseline = await readFile('supabase/migrations/20261028173902_finviant_complete_application_bootstrap.sql', 'utf8')
function block(source: string, marker: string, terminator = 'end $$;') {
  const start = source.indexOf(marker)
  assert.ok(start >= 0, marker)
  const end = source.indexOf(terminator, start)
  assert.ok(end >= 0, marker + ' terminator')
  return source.slice(start, end + terminator.length)
}
function core(name: string) { return block(baseline, 'CREATE OR REPLACE FUNCTION ' + name + '(', '$function$;') }
export const val = async (db: PGlite, sql: string, args: unknown[] = []) => (await db.query<{ value: any }>(sql, args)).rows[0].value
export async function asUser(db: PGlite, who = ids.owner) {
  await db.exec('reset role')
  await actor(db, who)
  await db.exec('set role authenticated')
}
export async function asAnon(db: PGlite) { await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);set role anon") }
export async function recordFixture() {
  const db = await fixture(true)
  try {
  await db.exec('reset role')
  for (const table of ['change_order_items', 'payments', 'document_approval_links', 'document_approvals']) {
    const shape = baseline.match(new RegExp('create table "public"\\."' + table + '" \\(([\\s\\S]*?)\\);', 'i'))!
    await db.exec('create table public.' + table + ' (' + shape[1] + ');alter table public.' + table + ' add primary key(id);')
  }
  await db.exec('alter table public.document_approval_links add unique(token_hash);alter table public.document_approvals add unique(approval_link_id);')
  for (const name of ['private.valid_payment_links', 'public.recalc_change_order', 'private.commerce_change_item_guard', 'public.record_manual_payment', 'private.commerce_paid_recalc', 'private.commerce_payment_guard', 'private.commerce_number', 'public.set_job_status_atomic']) await db.exec(core(name))
  const ownerSql = await readFile('supabase/migrations/20261102170333_owner_team_document_settings.sql', 'utf8')
  await db.exec(block(ownerSql, 'create function private.guard_invoice_destinations('))
  await db.exec(`create trigger change_item_guard before insert or update or delete on public.change_order_items for each row execute function private.commerce_change_item_guard();
    create trigger change_item_recalc after insert or update or delete on public.change_order_items for each row execute function public.recalc_change_order();
    create trigger payment_guard before insert or update or delete on public.payments for each row execute function private.commerce_payment_guard();
    create trigger payment_recalc after insert or update or delete on public.payments for each row execute function private.commerce_paid_recalc();
    create trigger commerce_number before insert on public.estimates for each row execute function private.commerce_number();
    create trigger commerce_number before insert on public.invoices for each row execute function private.commerce_number();
    grant select,insert,update,delete on public.payments,public.change_order_items to authenticated;`)
  await db.exec(await readFile('supabase/migrations/20261102231643_document_workflow_and_contact_import.sql', 'utf8'))
  await db.exec(await readFile('supabase/migrations/20261106131110_estimate_deposit_final_balance.sql', 'utf8'))
  await db.exec("alter table public.user_agreement_acceptances add column agreement_version text default '2026-11-06-v5';insert into public.user_agreement_acceptances(user_id,terms_accepted,ai_disclosure_acknowledged,electronic_records_consent) values('" + ids.worker + "',true,true,true),('" + ids.outsider + "',true,true,true)")
  const included = await readFile('supabase/migrations/20261106155000_included_tier_access.sql', 'utf8')
  for (const name of ['private.velnu_has_accepted_terms', 'private.is_business_member', 'private.can_write_business', 'private.member_module_access']) await db.exec(block(included, 'CREATE OR REPLACE FUNCTION ' + name + '(', '$function$;').replaceAll('target_business_id','b'))
  const tierShape = await readFile('tests/tiers/schema.sql', 'utf8')
  await db.exec(block(tierShape, 'create table private.monthly_usage(', ');'))
  const tiers = await readFile('supabase/migrations/20261106150713_tier_entitlements_and_personal_delivery.sql', 'utf8')
  await db.exec(block(tiers, 'create or replace function private.commerce_quota('))
  await db.exec(`create trigger commerce_quota before insert on public.estimates for each row execute function private.commerce_quota();
    create trigger commerce_quota before insert on public.invoices for each row execute function private.commerce_quota();`)
  const shareStart = tiers.indexOf('create table private.document_shares (')
  await db.exec(tiers.slice(shareStart, tiers.indexOf('create function private.customer_document_snapshot(', shareStart)))
  const versions = await readFile('supabase/migrations/20261108001428_canonical_customer_document_revisions.sql', 'utf8')
  await db.exec(versions.slice(0, versions.indexOf('alter table private.document_shares')))
  await db.exec('alter table private.document_shares add column revision_id uuid references private.document_versions(id);alter table public.change_orders add column change_totals jsonb;')
  for (const name of ['private.customer_document_snapshot', 'private.document_action_deadline', 'private.document_version_body', 'private.publish_document_version']) await db.exec(block(versions, 'create function ' + name + '(', name.endsWith('body') ? '$$;' : 'end $$;'))
  const payments = await readFile('supabase/migrations/20261108001511_verified_customer_invoice_payments.sql', 'utf8')
  await db.exec(payments.slice(payments.indexOf('create table private.customer_payment_merchants'), payments.indexOf('alter table private.customer_payment_merchants')))
  await db.exec(block(payments, 'create or replace function private.commerce_payment_guard('))
  const live = await readFile('supabase/migrations/20261108003415_live_customer_scheduling.sql', 'utf8')
  await db.exec(block(live, 'create or replace function private.guard_job_schedule('))
  await db.exec(block(live, 'create or replace function private.guard_appointment_crew('))
  await db.exec(await readFile('supabase/migrations/20261108011707_record_action_consistency.sql', 'utf8'))
  await asUser(db)
  return db
  } catch (error) { await db.close(); throw error }
}
export { ids }
