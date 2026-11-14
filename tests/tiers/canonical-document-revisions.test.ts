import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { B, C, I, U, fixture, plan, user } from './fixture.ts'

const E = '88888888-8888-4888-8888-000000000011'
const J = '88888888-8888-4888-8888-000000000012'
const P = '88888888-8888-4888-8888-000000000013'
const F = '88888888-8888-4888-8888-000000000014'
const I2 = '88888888-8888-4888-8888-000000000015'
const CO = '88888888-8888-4888-8888-000000000016'
const token = 'ab'.repeat(32), secondToken = 'cd'.repeat(32), rotatedToken = 'ef'.repeat(32)
const brand = {
  name: 'Issued Company', legal_name: 'Issued Company LLC', email: 'issued@example.test', phone: '+17575550111',
  website: 'https://issued.example.test', address_line1: '1 Issuer Street', address_line2: 'Suite 7',
  city: 'Norfolk', state: 'VA', postal_code: '23510', logo_path: B + '/logo.svg',
  document_accent: '#123456', document_footer: 'Issued document terms and footer',
}

async function canonicalMigration(db: PGlite) {
  const canonical = (await readdir('supabase/migrations')).find(name => name.endsWith('_canonical_customer_document_revisions.sql'))!
  const sql = await readFile('supabase/migrations/' + canonical, 'utf8')
  assert.ok(sql.trim(), 'canonical publication migration is present')
  await db.exec(sql)
}

async function setup(applyCanonical = true) {
  const db = await fixture()
  await db.exec(`create table public.properties(
    id uuid primary key,business_id uuid,customer_id uuid,label text,address_line1 text,address_line2 text,
    city text,state text,postal_code text,access_notes text,unique(id,business_id));
    create table public.business_settings(business_id uuid,payment_links jsonb,payment_instructions text);
    grant select on public.properties,public.business_settings to authenticated;
    alter table public.customers add column address_line1 text,add column address_line2 text,add column city text,add column state text,add column postal_code text;
    alter table public.change_orders add column change_totals jsonb;
    create function private.can_write_business(uuid) returns boolean language sql as $$select private.fin_access($1,'invoices',true)$$;`)
  const original = await readFile('supabase/migrations/20261102231643_document_workflow_and_contact_import.sql', 'utf8')
  const start = original.indexOf('CREATE OR REPLACE FUNCTION public.create_document(')
  await db.exec(original.slice(start, original.indexOf('end$function$;', start) + 'end$function$;'.length))
  const files = await readdir('supabase/migrations')
  const handoffs = files.find(name => name.endsWith('_streamlined_workflow_handoffs.sql'))!
  await db.exec(await readFile('supabase/migrations/' + handoffs, 'utf8'))
  if (applyCanonical) await canonicalMigration(db)
  await db.query(`insert into public.customers(id,business_id,first_name,last_name,company,email,phone,address_line1,address_line2,city,state,postal_code,notes)
    values($1,$2,'Jordan','Customer','Customer LLC','customer@example.test','+17575550123','2 Customer Road','Unit 4','Norfolk','VA','23511','DO_NOT_EXPOSE_CUSTOMER_NOTE')`, [C, B])
  await db.query(`insert into public.properties(id,business_id,customer_id,label,address_line1,address_line2,city,state,postal_code,access_notes)
    values($1,$2,$3,'Service location','3 Service Avenue','Rear lot','Norfolk','VA','23512','DO_NOT_EXPOSE_ACCESS_CODE')`, [P, B, C])
  await db.query("insert into public.jobs(id,business_id,customer_id,property_id,title) values($1,$2,$3,$4,'Mowing job')", [J, B, C, P])
  await db.query('insert into auth.users(id) values($1)', [F])
  return db
}

async function invoice(db: PGlite, id = I, number = 'INV-CANONICAL') {
  await db.exec('reset role')
  await db.query(`insert into public.invoices(id,business_id,customer_id,job_id,property_id,invoice_number,status,total,subtotal,issue_date,due_date,customer_message,notes,issuer_snapshot,payment_instructions)
    values($1,$2,$3,$4,$5,$6,'draft',100,100,current_date,current_date+30,'Customer-facing invoice terms','DO_NOT_EXPOSE_DOCUMENT_NOTE',$7,'Reference this invoice number')`, [id, B, C, J, P, number, JSON.stringify(brand)])
  await db.query("insert into public.invoice_items(business_id,invoice_id,description,quantity,unit_price,tax_rate,sort_order) values($1,$2,'Mowing',2,50,0,3)", [B, id])
  await user(db)
}

async function estimate(db: PGlite, expired = false) {
  await db.exec('reset role')
  await db.query(`insert into public.estimates(id,business_id,customer_id,job_id,property_id,estimate_number,status,total,subtotal,issue_date,expires_on,customer_message,issuer_snapshot)
    values($1,$2,$3,$4,$5,'EST-CANONICAL','draft',125,125,current_date,
      case when $6 then (now() at time zone (select timezone from public.businesses where id=$2))::date-1 else current_date+45 end,
      'Estimate scope and agreement',$7)`, [E, B, C, J, P, expired, JSON.stringify(brand)])
  await db.query("insert into public.estimate_items(business_id,estimate_id,description,quantity,unit_price,tax_rate) values($1,$2,'Quoted mowing',1,125,0)", [B, E])
  await user(db)
}

async function value(db: PGlite, sql: string, args: unknown[] = []) {
  return (await db.query<{ value: any }>(sql, args)).rows[0].value
}
const ownerVersion = (db: PGlite, kind = 'invoice', id = I) => value(db, 'select public.get_owner_document_version($1,$2,$3) value', [B, kind, id])
const prepare = (db: PGlite, kind = 'invoice', id = I, shareToken = token) => value(db, 'select public.prepare_personal_document($1,$2,$3,$4) value', [B, kind, id, shareToken])
const shared = (db: PGlite, shareToken = token) => value(db, 'select public.get_shared_document($1) value', [shareToken])
const pdfVersion = (db: PGlite, shareToken = token, type = 'document_share') => value(db, 'select public.get_document_pdf_version($1,$2) value', [shareToken, type])
const consume = (db: PGlite, approvalToken: string) => value(db, "select public.consume_document_approval(encode(sha256(convert_to($1,'UTF8')),'hex'),'approved','Jordan Customer','test browser',true) value", [approvalToken])
async function anonymous(db: PGlite) {
  await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);set role anon")
}

test('owner PDF publication is idempotent and does not create links or mark a document sent', async () => {
  const db = await setup()
  try {
    await invoice(db)
    const first = await ownerVersion(db), again = await ownerVersion(db)
    assert.ok(first.version_id)
    assert.equal(again.version_id, first.version_id)
    assert.equal(first.snapshot.kind, 'invoice')
    await db.exec('reset role')
    assert.equal(await value(db, 'select count(*)::int value from private.document_versions'), 1)
    for (const table of ['private.document_shares', 'public.document_approval_links', 'public.messages']) assert.equal(await value(db, 'select count(*)::int value from ' + table), 0)
    assert.equal(await value(db, 'select status value from public.invoices where id=$1', [I]), 'draft')
  } finally { await db.close() }
})

test('published body, owner binding, revision identity, and deadline cannot be overwritten', async () => {
  const db = await setup()
  try {
    await invoice(db)
    const document = await ownerVersion(db)
    await db.exec('reset role')
    for (const [assignment, replacement] of [
      ["snapshot=jsonb_set(snapshot,'{total}',$2::jsonb)", '999'],
      ['business_id=$2::uuid', F],
      ['snapshot_hash=$2', 'ff'.repeat(32)],
      ['revision_number=$2::integer', '99'],
      ['action_expires_at=$2::timestamptz', '2099-01-01T00:00:00Z'],
    ]) await assert.rejects(() => db.query('update private.document_versions set ' + assignment + ' where id=$1', [document.version_id, replacement]), /immutable/i)
    await db.query("update public.invoice_items set description='A genuine revised scope' where invoice_id=$1", [I])
    await user(db)
    await ownerVersion(db)
    await db.exec('reset role')
    await assert.rejects(() => db.query('update private.document_versions set superseded_at=null where id=$1', [document.version_id]), /cannot be reopened/i)
  } finally { await db.close() }
})

test('public view preserves full issued branding, customer, service, and monetary fields without private notes', async () => {
  const db = await setup()
  try {
    await invoice(db)
    const prepared = await prepare(db)
    const initial = await shared(db)
    assert.equal(initial.company.logo_path, brand.logo_path)
    assert.equal(initial.company.document_accent, brand.document_accent)
    assert.equal(initial.company.document_footer, brand.document_footer)
    assert.equal(initial.company.legal_name, brand.legal_name)
    assert.equal(initial.company.address_line2, brand.address_line2)
    assert.equal(initial.customer.first_name, 'Jordan')
    assert.equal(initial.customer.address_line2, 'Unit 4')
    assert.match(initial.service_address, /3 Service Avenue/)
    assert.equal(initial.service_location.address_line2, 'Rear lot')
    assert.equal(initial.items[0].quantity, 2)
    assert.equal(initial.items[0].unit_price, 50)
    assert.equal(initial.items[0].tax_rate, 0)
    assert.equal(initial.total, 100)
    assert.equal(initial.currency, 'USD')
    assert.doesNotMatch(JSON.stringify(initial), /DO_NOT_EXPOSE/)
    await db.exec('reset role')
    await db.query("update public.customers set first_name='Edited',email='edited@example.test',address_line2='Changed' where id=$1", [C])
    await db.query("update public.properties set address_line1='Changed service address' where id=$1", [P])
    await db.query("update public.businesses set name='Edited company',document_footer='Edited footer' where id=$1", [B])
    await anonymous(db)
    const later = await shared(db)
    assert.deepEqual(later.company, initial.company)
    assert.deepEqual(later.customer, initial.customer)
    assert.deepEqual(later.service_location, initial.service_location)
    assert.deepEqual(later.items, initial.items)
    assert.equal(prepared.version_id, initial.revision_id)
    await assert.rejects(() => db.query('select * from private.document_versions'), /permission denied/)
    await assert.rejects(() => db.query('select * from private.document_shares'), /permission denied/)
    await assert.rejects(() => db.query('select private.customer_document_snapshot($1,$2,$3)', [B, 'invoice', I]), /permission denied/)
    await assert.rejects(() => shared(db, 'not-a-token'), /unavailable|invalid/i)
  } finally { await db.close() }
})

test('estimate action deadline follows Valid Until in the business timezone rather than a 14-day limit', async () => {
  const db = await setup()
  try {
    await estimate(db)
    const prepared = await prepare(db, 'estimate', E)
    const expected = await value(db, "select ((e.expires_on+1)::timestamp at time zone b.timezone) value from public.estimates e join public.businesses b on b.id=e.business_id where e.id=$1", [E])
    assert.equal(new Date(prepared.expires_at).getTime(), new Date(expected).getTime())
    assert.ok(new Date(prepared.expires_at).getTime() > Date.now() + 30 * 86400000)
    await anonymous(db)
    assert.equal((await shared(db)).action_state, 'pending_release')
  } finally { await db.close() }
})

test('expired estimate links remain readable but cannot authorize a decision', async () => {
  const db = await setup()
  try {
    await estimate(db, true)
    await prepare(db, 'estimate', E)
    await anonymous(db)
    const document = await shared(db)
    assert.equal(document.number, 'EST-CANONICAL')
    assert.equal(document.action_state, 'expired')
    assert.equal(document.approval_token, null)
    await user(db)
    await assert.rejects(() => db.query('select public.release_personal_approval($1,$2)', [B, token]), /deadline|expired|available|approv/i)
  } finally { await db.close() }
})

test('change-order publications retain scope, reason, schedule impact, and reviewed totals', async () => {
  const db = await setup()
  try {
    await estimate(db)
    await db.exec('reset role')
    const totals = { current_total: 125, change_amount: 25, revised_total: 150 }
    await db.query(`insert into public.change_orders(id,business_id,customer_id,job_id,estimate_id,change_order_number,status,title,description,reason,schedule_impact_days,schedule_note,total,subtotal,customer_message,notes,issuer_snapshot,change_totals)
      values($1,$2,$3,$4,$5,'CO-CANONICAL','draft','Add edging','Edge the front walkway','Customer requested additional work',2,'Move completion two days','25','25','Approve this additional scope','DO_NOT_EXPOSE_CHANGE_ORDER_NOTE',$6,$7)`, [CO, B, C, J, E, JSON.stringify(brand), JSON.stringify(totals)])
    await db.query("insert into public.change_order_items(business_id,change_order_id,description,quantity,unit_price,tax_rate) values($1,$2,'Additional edging',1,25,0)", [B, CO])
    await user(db)
    const prepared = await prepare(db, 'change_order', CO)
    const document = await shared(db)
    assert.equal(document.title, 'Add edging')
    assert.equal(document.description, 'Edge the front walkway')
    assert.equal(document.reason, 'Customer requested additional work')
    assert.equal(document.schedule_impact_days, 2)
    assert.equal(document.schedule_note, 'Move completion two days')
    assert.equal(document.customer_message, 'Approve this additional scope')
    assert.deepEqual(document.change_totals, totals)
    assert.match(document.service_address, /3 Service Avenue/)
    assert.equal(document.company.document_footer, brand.document_footer)
    assert.ok(Math.abs(new Date(prepared.expires_at).getTime() - Date.now() - 30 * 86400000) < 60000)
    assert.doesNotMatch(JSON.stringify(document), /DO_NOT_EXPOSE/)
    await db.query('select public.release_personal_approval($1,$2)', [B, token])
    assert.equal((await shared(db)).action_state, 'available')
  } finally { await db.close() }
})

test('new Free and Individual publications are readable and only current Pro entitlement permits actions', async () => {
  for (const tier of ['free', 'basic']) {
    const db = await setup()
    try {
      await estimate(db)
      await plan(db, tier)
      await prepare(db, 'estimate', E)
      const document = await shared(db)
      assert.equal(document.action_state, 'read_only')
      assert.equal(document.approval_token, null)
      await db.query('select public.release_personal_approval($1,$2)', [B, token])
      assert.equal((await shared(db)).approval_token, null, 'sharing a lower-tier document does not activate an approval')
      await db.exec('reset role')
      assert.equal(await value(db, 'select approval_ready_at value from private.document_shares where token_hash=encode(sha256(convert_to($1,\'UTF8\')),\'hex\')', [token]), null)
      await anonymous(db)
      assert.equal((await shared(db)).number, 'EST-CANONICAL')
    } finally { await db.close() }
  }
  const db = await setup()
  try {
    await estimate(db)
    await prepare(db, 'estimate', E)
    await db.query('select public.release_personal_approval($1,$2)', [B, token])
    const approvalToken = (await shared(db)).approval_token
    assert.ok(approvalToken)
    await plan(db, 'free')
    await db.exec('reset role')
    await assert.rejects(() => consume(db, approvalToken), /pro|plan|approv|available/i)
    await anonymous(db)
    assert.equal((await shared(db)).approval_token, null)
  } finally { await db.close() }
})

test('completed approval is idempotent and retains a read-only issued document receipt', async () => {
  const db = await setup()
  try {
    await estimate(db)
    await prepare(db, 'estimate', E)
    await db.query('select public.release_personal_approval($1,$2)', [B, token])
    const initial = await shared(db), approvalToken = initial.approval_token
    assert.ok(approvalToken)
    const before = await value(db, 'select public.get_customer_approval_document($1) value', [approvalToken])
    assert.equal(before.action_state, 'available')
    assert.equal(before.revision_id, initial.revision_id)
    assert.deepEqual((await pdfVersion(db, approvalToken, 'approval')).snapshot, before.snapshot)
    await invoice(db)
    const foreign = await ownerVersion(db)
    await db.exec('reset role')
    await assert.rejects(() => value(db, "select public.consume_document_approval(encode(sha256(convert_to($1,'UTF8')),'hex'),'approved','Jordan Customer','test browser',true,$2) value", [approvalToken, foreign.version_id]), /DOCUMENT_SUPERSEDED/)
    assert.equal(await value(db, 'select count(*)::int value from public.document_approvals'), 0)
    const accepted = await value(db, "select public.consume_document_approval(encode(sha256(convert_to($1,'UTF8')),'hex'),'approved','Jordan Customer','test browser',true,$2) value", [approvalToken, initial.revision_id])
    assert.equal(accepted.already_consumed, false)
    assert.equal(accepted.revision_id, initial.revision_id)
    assert.equal((await consume(db, approvalToken)).already_consumed, true)
    await anonymous(db)
    const document = await shared(db)
    assert.equal(document.status, 'draft', 'the issued document body stays immutable')
    assert.equal(document.live_status, 'accepted')
    assert.equal(document.action_state, 'completed')
    assert.equal(document.approval_token, null)
    assert.deepEqual(document.items, initial.items)
    assert.equal(document.completed.action, 'approved')
    assert.equal(document.completed.typed_name, 'Jordan Customer')
    const receipt = await value(db, 'select public.get_customer_approval_document($1) value', [approvalToken])
    assert.equal(receipt.action_state, 'completed')
    assert.deepEqual(receipt.snapshot, before.snapshot)
    assert.deepEqual((await pdfVersion(db, approvalToken, 'approval')).snapshot, before.snapshot)
    await db.exec('reset role')
    assert.equal(await value(db, 'select count(*)::int value from public.document_approvals'), 1)
  } finally { await db.close() }
})

test('pre-migration lower-tier approval authority is preserved without granting new lower-tier actions', async () => {
  const db = await setup(false)
  try {
    await estimate(db)
    await plan(db, 'free')
    await prepare(db, 'estimate', E)
    await db.query('select public.release_personal_approval($1,$2)', [B, token])
    const approvalToken = (await shared(db)).approval_token
    assert.ok(approvalToken, 'the legacy flow issued an approval token before this migration')
    await db.exec('reset role')
    await canonicalMigration(db)
    assert.equal((await consume(db, approvalToken)).action, 'approved')
    await anonymous(db)
    assert.equal((await shared(db)).completed.action, 'approved')
  } finally { await db.close() }
})

test('paid invoices and superseded revisions retain their old URL and immutable scope', async () => {
  const db = await setup()
  try {
    await invoice(db)
    const prepared = await prepare(db), original = await shared(db)
    const originalPdf = await pdfVersion(db)
    assert.equal(originalPdf.version_id, prepared.version_id)
    assert.equal(prepared.expires_at, null, 'invoice links do not expire after an arbitrary number of days')
    await db.exec('reset role')
    await db.query("update public.invoices set amount_paid=100,status='paid' where id=$1", [I])
    await anonymous(db)
    const paid = await shared(db)
    assert.equal(paid.action_state, 'paid')
    assert.equal(paid.amount_paid, 0)
    assert.equal(paid.balance_due, 100)
    assert.equal(paid.live_amount_paid, 100)
    assert.equal(paid.live_balance_due, 0)
    assert.deepEqual(paid.items, original.items)
    const paidPdf = await pdfVersion(db)
    assert.equal(paidPdf.version_id, originalPdf.version_id)
    assert.deepEqual(paidPdf.snapshot, originalPdf.snapshot, 'payment progress never rewrites the downloadable PDF body')
    await db.exec('reset role')
    assert.equal(Number(await value(db, "select (snapshot->>'amount_paid')::numeric value from private.document_versions where id=$1", [prepared.version_id])), 0)
    await estimate(db)
    await prepare(db, 'estimate', E, secondToken)
    await db.query('select public.release_personal_approval($1,$2)', [B, secondToken])
    const first = await shared(db, secondToken)
    assert.ok(first.approval_token)
    await db.exec('reset role')
    await db.query("update public.estimate_items set description='Revised quoted work' where estimate_id=$1", [E])
    await user(db)
    const next = await ownerVersion(db, 'estimate', E)
    assert.notEqual(next.version_id, first.revision_id)
    await anonymous(db)
    const previous = await shared(db, secondToken)
    assert.equal(previous.action_state, 'superseded')
    assert.equal(previous.items[0].description, 'Quoted mowing')
    assert.equal(previous.approval_token, null)
    await db.exec('reset role')
    await assert.rejects(() => consume(db, first.approval_token), /superseded|changed|approv|available/i)
  } finally { await db.close() }
})

test('explicit rotation is atomic, replayable, owner-authorized, and revokes only the old view token', async () => {
  const db = await setup()
  try {
    await invoice(db)
    const first = await prepare(db)
    await invoice(db, I2, 'INV-OTHER')
    await prepare(db, 'invoice', I2, secondToken)
    await assert.rejects(() => value(db, 'select public.rotate_document_share($1,$2,$3) value', [B, token, secondToken]), /conflict|used|unavailable|replacement/i)
    assert.equal((await shared(db)).number, 'INV-CANONICAL')
    assert.equal((await shared(db, secondToken)).number, 'INV-OTHER')
    await user(db, F)
    await assert.rejects(() => value(db, 'select public.rotate_document_share($1,$2,$3) value', [B, token, rotatedToken]), /access|owner|available|denied/i)
    await user(db)
    const rotated = await value(db, 'select public.rotate_document_share($1,$2,$3) value', [B, token, rotatedToken])
    const retried = await value(db, 'select public.rotate_document_share($1,$2,$3) value', [B, token, rotatedToken])
    assert.equal(rotated.version_id, first.version_id)
    assert.equal(retried.version_id, rotated.version_id)
    await assert.rejects(() => shared(db), /revoked|unavailable/i)
    assert.equal((await shared(db, rotatedToken)).number, 'INV-CANONICAL')
    await db.query('select public.revoke_document_share($1,$2)', [B, rotatedToken])
    await assert.rejects(() => shared(db, rotatedToken), /revoked|unavailable/i)
    assert.equal((await shared(db, secondToken)).number, 'INV-OTHER')
    await estimate(db)
    const beforeRotation = '12'.repeat(32), afterRotation = '34'.repeat(32)
    await prepare(db, 'estimate', E, beforeRotation)
    await db.query('select public.release_personal_approval($1,$2)', [B, beforeRotation])
    const approvalToken = (await shared(db, beforeRotation)).approval_token
    await value(db, 'select public.rotate_document_share($1,$2,$3) value', [B, beforeRotation, afterRotation])
    const newApprovalToken = (await shared(db, afterRotation)).approval_token
    assert.ok(newApprovalToken)
    assert.notEqual(newApprovalToken, approvalToken, 'explicit rotation replaces unused action authority along with the view token')
    await assert.rejects(() => shared(db, beforeRotation), /revoked|unavailable/i)
    await db.exec('reset role')
    await assert.rejects(() => consume(db, approvalToken), /LINK_REVOKED/)
    assert.equal((await consume(db, newApprovalToken)).action, 'approved')
    await user(db, F)
    await assert.rejects(() => ownerVersion(db), /access|authorized|denied/i)
  } finally { await db.close() }
})

test('approval issuer reuses the current link and atomically rotates authority with Valid Until intact', async () => {
  const db = await setup()
  const issue = (rotate = false) => value(db, 'select public.issue_document_approval_link($1,$2,$3,$4) value', [B, 'estimate', E, rotate])
  try {
    await estimate(db)
    await assert.rejects(() => issue(), /sent/i)
    await db.exec('reset role')
    assert.equal(await value(db, 'select count(*)::int value from private.document_versions'), 0, 'a rejected draft issue leaves no partial publication')
    await db.query("update public.estimates set status='sent' where id=$1", [E])
    await user(db)
    const first = await issue(), again = await issue()
    assert.equal(again.token, first.token)
    assert.equal(again.approval_link_id, first.approval_link_id)
    assert.equal(again.revision_id, first.revision_id)
    assert.equal(new Date(again.expires_at).getTime(), new Date(first.expires_at).getTime())
    const expected = await value(db, "select ((e.expires_on+1)::timestamp at time zone b.timezone) value from public.estimates e join public.businesses b on b.id=e.business_id where e.id=$1", [E])
    assert.equal(new Date(first.expires_at).getTime(), new Date(expected).getTime())
    await db.exec(`reset role;
      create function public.test_block_approval_insert() returns trigger language plpgsql as $$begin raise exception 'TEST_REPLACEMENT_INSERT_FAILED';end$$;
      create trigger test_block_approval_insert before insert on public.document_approval_links for each row execute function public.test_block_approval_insert();`)
    await user(db)
    await assert.rejects(() => issue(true), /TEST_REPLACEMENT_INSERT_FAILED/)
    assert.equal((await issue()).token, first.token, 'a failed replacement leaves the previous link reusable')
    assert.equal((await value(db, 'select public.get_customer_approval_document($1) value', [first.token])).action_state, 'available')
    await db.exec('reset role;drop trigger test_block_approval_insert on public.document_approval_links;drop function public.test_block_approval_insert()')
    assert.equal(await value(db, 'select count(*)::int value from public.document_approval_links'), 1)
    await user(db)
    const replacement = await issue(true)
    assert.notEqual(replacement.token, first.token)
    assert.equal(replacement.revision_id, first.revision_id)
    assert.equal(new Date(replacement.expires_at).getTime(), new Date(first.expires_at).getTime())
    assert.equal((await issue()).token, replacement.token)
    await db.exec('reset role')
    await assert.rejects(() => consume(db, first.token), /LINK_REVOKED/)
    assert.equal((await consume(db, replacement.token)).action, 'approved')
    await plan(db, 'basic')
    await assert.rejects(() => issue(), /Business Pro/i)
  } finally { await db.close() }
})

test('publication budget permits unchanged PDF reuse and refuses a new revision without superseding its current version', async () => {
  const db = await setup()
  const otherBusiness = '77777777-7777-4777-8777-000000000001'
  const otherCustomer = '77777777-7777-4777-8777-000000000002'
  try {
    await invoice(db)
    const original = await ownerVersion(db)
    await db.exec('reset role')
    await db.query(`insert into private.document_versions(business_id,kind,document_id,revision_number,snapshot,snapshot_hash)
      select $1,'invoice',gen_random_uuid(),1,'{"seeded_history":true}'::jsonb,repeat('a',64) from generate_series(1,99)`, [B])
    await user(db)
    assert.equal((await ownerVersion(db)).version_id, original.version_id, 'reopening an unchanged PDF does not spend publication capacity')
    await db.exec('reset role')
    await db.query("update public.invoice_items set description='Changed scope at capacity' where invoice_id=$1", [I])
    await user(db)
    await assert.rejects(() => ownerVersion(db), /reuse a published PDF|try again later/i)
    await db.exec('reset role')
    assert.equal(await value(db, 'select count(*)::int value from private.document_versions where business_id=$1', [B]), 100)
    const retained = await value(db, 'select to_jsonb(v) value from private.document_versions v where id=$1', [original.version_id])
    assert.equal(retained.superseded_at, null, 'a refused publication leaves the old current version active')
    assert.deepEqual(retained.snapshot, original.snapshot)
    assert.equal(await value(db, 'select count(*)::int value from private.document_versions where business_id=$1 and document_id=$2', [B, I]), 1)
    await db.query("insert into public.businesses(id,name,created_by_user_id) values($1,'Other business',$2)", [otherBusiness, U])
    await db.query("insert into public.business_members(business_id,user_id,role) values($1,$2,'owner')", [otherBusiness, U])
    await db.query("insert into public.customers(id,business_id,first_name) values($1,$2,'Other customer')", [otherCustomer, otherBusiness])
    await db.query("insert into public.invoices(id,business_id,customer_id,invoice_number,status,subtotal,total) values($1,$2,$3,'INV-ISOLATED','draft',1,1)", [I2, otherBusiness, otherCustomer])
    await db.query("insert into public.invoice_items(business_id,invoice_id,description,quantity,unit_price) values($1,$2,'Independent work',1,1)", [otherBusiness, I2])
    await db.query(`insert into private.document_versions(business_id,kind,document_id,revision_number,snapshot,snapshot_hash,created_at)
      select $1,'invoice',gen_random_uuid(),1,'{"old_history":true}'::jsonb,repeat('b',64),now()-interval '2 hours' from generate_series(1,100)`, [otherBusiness])
    await user(db)
    const independent = await value(db, 'select public.get_owner_document_version($1,$2,$3) value', [otherBusiness, 'invoice', I2])
    assert.ok(independent.version_id, 'other businesses and history outside the rolling hour do not consume this budget')
    await db.exec('reset role')
    assert.equal(await value(db, "select count(*)::int value from private.document_versions where business_id=$1 and created_at>now()-interval '1 hour'", [otherBusiness]), 1)
  } finally { await db.close() }
})
