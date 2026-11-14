import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { recordFixture, asUser, asAnon, val, ids } from './record-action-fixture.ts'

const start = '2030-01-07T10:00:00Z', end = '2030-01-07T11:00:00Z'
const rpc = (db: PGlite, name: string, params: unknown[]) => val(db, `select public.${name}(${params.map((_, i) => '$' + (i + 1)).join(',')}) value`, params)
const row = async (db: PGlite, table: string, id: string) => (await db.query<any>(`select * from public.${table} where id=$1`, [id])).rows[0]
const denied = (f: () => Promise<unknown>, code = '42501') => assert.rejects(f, (e: any) => e.code === code)
async function admin(db: PGlite, fn: () => Promise<unknown>) { await db.exec('reset role'); try { return await fn() } finally { await asUser(db) } }
async function document(db: PGlite, kind = 'estimate', status = 'draft') {
  const d = await rpc(db, 'create_document', [ids.business, kind, randomUUID(), { customer_id: ids.customer, property_id: ids.site, notes: 'Reviewed scope', customer_message: 'Thank you', payment_links: [], payment_instructions: 'Cash accepted', items: [{ description: 'Mow and trim', quantity: 2, unit_price: 50, tax_rate: 5 }] }])
  if (status !== 'draft') await db.query(`update public.${kind === 'estimate' ? 'estimates' : 'invoices'} set status=$1 where id=$2`, [status, d.id])
  return d.id as string
}
async function job(db: PGlite, status = 'lead', estimate: string | null = null, workers: string[] = []) {
  const id = randomUUID()
  await db.query('insert into public.jobs(id,business_id,customer_id,property_id,title,status,source_estimate_id,assigned_user_ids) values($1,$2,$3,$4,\'Reviewed work\',$5,$6,$7)', [id, ids.business, ids.customer, ids.site, status, estimate, workers])
  if (estimate) await db.query('update public.estimates set job_id=$1 where id=$2', [id, estimate])
  return id
}
async function appointment(db: PGlite, j: string | null, status = 'confirmed') {
  return (await db.query<{ id: string }>('insert into public.appointments(business_id,customer_id,job_id,title,starts_at,ends_at,status) values($1,$2,$3,\'Reviewed visit\',$4,$5,$6) returning id', [ids.business, ids.customer, j, start, end, status])).rows[0].id
}
async function withDb(run: (db: PGlite) => Promise<void>) { const db = await recordFixture(); try { await run(db) } finally { await db.close() } }

test('job context enforces tenant/module boundaries and gives jobs-only staff appointment truth without financial details', () => withDb(async db => {
  const j = await job(db, 'scheduled'), closed = await appointment(db, j, 'canceled')
  const foreign = randomUUID(); await admin(db, () => db.query("with customer as (insert into public.customers(business_id,first_name) values($2,'Other tenant') returning id) insert into public.jobs(id,business_id,customer_id,title) select $1,$2,id,'Other tenant work' from customer", [foreign, ids.other]))
  await db.query('update public.jobs set scheduled_start=$1,scheduled_end=$2 where id=$3', [start, end, j])
  const i = await document(db, 'invoice', 'sent'); await db.query('update public.invoices set job_id=$1 where id=$2', [j, i])
  await admin(db, () => db.query("update public.business_members set access_modules=array['jobs'] where user_id=$1", [ids.worker]))
  await asUser(db, ids.worker)
  let context = await rpc(db, 'get_job_workflow_context', [ids.business, [j, foreign]])
  assert.equal(context.length, 1); assert.equal(context[0].active_appointment, null); assert.equal(context[0].invoice, null)
  await asUser(db); const active = await appointment(db, j)
  await asUser(db, ids.worker); context = await rpc(db, 'get_job_workflow_context', [ids.business, [j]])
  assert.equal(context[0].active_appointment.id, active); assert.notEqual(context[0].active_appointment.id, closed); assert.equal(context[0].invoice, null)
  await denied(() => rpc(db, 'get_job_workflow_context', [ids.other, [j]]))
  await denied(() => rpc(db, 'get_job_workflow_context', [ids.business, Array(201).fill(j)]), '22023')
  await denied(() => rpc(db, 'get_job_workflow_context', [ids.business, null]), '22023')
  assert.deepEqual(await rpc(db, 'get_job_workflow_context', [ids.business, []]), [])
  await denied(() => rpc(db, 'get_estimate_workflow_context', [ids.business, []]))
  await denied(() => rpc(db, 'get_invoice_payment_operations', [ids.business, i]))
  await asUser(db); context = await rpc(db, 'get_job_workflow_context', [ids.business, [j]])
  assert.deepEqual(Object.keys(context[0].invoice).sort(), ['balance_due', 'id', 'number', 'status']); assert.equal(context[0].invoice.id, i)
  await admin(db, () => db.query("update public.business_members set access_modules=array['calendar'] where user_id=$1", [ids.worker])); await asUser(db, ids.worker)
  await denied(() => rpc(db, 'get_job_workflow_context', [ids.business, [j]]))
  await asUser(db, ids.outsider); await denied(() => rpc(db, 'get_job_workflow_context', [ids.business, [j]]))
  await asAnon(db); await denied(() => rpc(db, 'get_job_workflow_context', [ids.business, [j]]))
}))

test('reopening preserves the same job, closed appointment and invoice history and deduplicates a saved request', () => withDb(async db => {
  const j = await job(db, 'scheduled', null, [ids.worker]); await db.query('update public.jobs set scheduled_start=$1,scheduled_end=$2 where id=$3', [start, end, j])
  const a = await appointment(db, j); await db.query("update public.jobs set status='completed',completed_at=now() where id=$1", [j])
  const i = await document(db, 'invoice', 'sent'); await db.query('update public.invoices set job_id=$1 where id=$2', [j, i]); const before = await row(db, 'invoices', i)
  const request = randomUUID(), first = await rpc(db, 'reopen_job', [j, request])
  assert.equal(first.job_id, j); assert.equal(first.status, 'lead'); assert.equal(first.already_reopened, false); assert.equal(first.reopened_from.status, 'completed'); assert.deepEqual(first.reopened_from.assigned_user_ids, [ids.worker])
  const reopened = await row(db, 'jobs', j); assert.equal(reopened.scheduled_start, null); assert.equal(reopened.scheduled_end, null); assert.equal(reopened.completed_at, null); assert.deepEqual(reopened.assigned_user_ids, [ids.worker])
  assert.equal((await row(db, 'appointments', a)).status, 'completed'); assert.deepEqual(await row(db, 'invoices', i), before)
  await denied(() => db.query("update public.appointments set status='confirmed' where id=$1", [a]), '23514')
  await denied(() => db.query("update public.appointments set job_id=null,status='confirmed' where id=$1", [a]), '23514')
  await denied(() => db.query('update public.appointments set job_id=null where id=$1', [a]), '23514')
  assert.equal((await rpc(db, 'reopen_job', [j, request])).already_reopened, true)
  assert.equal(await val(db, 'select count(*)::int value from public.jobs'), 1); assert.equal(await val(db, 'select count(*)::int value from public.invoices'), 1)
  const other = await job(db, 'canceled'); await denied(() => rpc(db, 'reopen_job', [other, request]), '23505')
  await asUser(db, ids.worker); await denied(() => rpc(db, 'reopen_job', [other, randomUUID()]))
  await asUser(db); await denied(() => rpc(db, 'reopen_job', [j, randomUUID()]), '23514')
}))

test('reopening clears historical ineligible crew and a same-time appointment save repairs absence without reviving history', () => withDb(async db => {
  const j = await job(db, 'canceled', null, [ids.worker])
  await admin(db, () => db.query("update public.business_members set role='viewer' where user_id=$1", [ids.worker]))
  await rpc(db, 'reopen_job', [j, randomUUID()]); assert.deepEqual((await row(db, 'jobs', j)).assigned_user_ids, [])
  await db.query("update public.jobs set status='scheduled',scheduled_start=$1,scheduled_end=$2 where id=$3", [start, end, j])
  const old = await appointment(db, j, 'canceled')
  await rpc(db, 'save_job_appointment', [j, start, end, start, end, false])
  const entries = (await db.query<any>('select id,status from public.appointments where job_id=$1 order by id', [j])).rows
  assert.equal(entries.length, 2); assert.equal(entries.find(a => a.id === old).status, 'canceled'); assert.equal(entries.filter(a => a.status === 'confirmed').length, 1)
  await rpc(db, 'save_job_appointment', [j, start, end, start, end, false]); assert.equal(await val(db, 'select count(*)::int value from public.appointments where job_id=$1', [j]), 2)
  const active = entries.find(a => a.status === 'confirmed').id
  await db.query("update public.appointments set starts_at='2030-01-07T12:00Z',ends_at='2030-01-07T13:00Z' where id=$1", [active])
  await rpc(db, 'save_job_appointment', [j, start, end, start, end, false]); assert.equal((await row(db, 'appointments', active)).starts_at.toISOString(), new Date(start).toISOString())
}))

test('revised estimates use ordinary draft numbering and quota once, preserve source and exclude work, invoice and approval side effects', () => withDb(async db => {
  const e = await document(db); await db.query("update public.estimates set status='expired',expires_on=current_date-1 where id=$1", [e])
  const before = await row(db, 'estimates', e), oldItems = (await db.query('select description,quantity,unit_price,tax_rate from public.estimate_items where estimate_id=$1', [e])).rows
  await db.query("update public.business_settings set payment_instructions='Current owner instructions' where business_id=$1", [ids.business])
  const usage = await admin(db, () => val(db, 'select coalesce(sum(documents),0)::int value from private.monthly_usage')) as number
  const request = randomUUID(), result = await rpc(db, 'create_revised_estimate', [e, request]), copy = await row(db, 'estimates', result.estimate_id)
  assert.notEqual(copy.id, e); assert.equal(copy.status, 'draft'); assert.notEqual(copy.estimate_number, before.estimate_number); assert.equal(copy.job_id, null); assert.equal(copy.property_id, ids.site)
  assert.equal(await val(db, 'select issue_date::text value from public.estimates where id=$1', [copy.id]), await val(db, "select (now() at time zone (select timezone from public.businesses where id=$1))::date::text value", [ids.business]))
  assert.equal(await val(db, 'select (expires_on-issue_date)::int value from public.estimates where id=$1', [copy.id]), 30)
  assert.equal(copy.notes, before.notes); assert.equal(copy.customer_message, before.customer_message); assert.equal(copy.payment_instructions, 'Current owner instructions')
  assert.deepEqual((await db.query('select description,quantity,unit_price,tax_rate from public.estimate_items where estimate_id=$1', [copy.id])).rows, oldItems)
  assert.deepEqual(await row(db, 'estimates', e), before)
  assert.deepEqual(await rpc(db, 'create_revised_estimate', [e, request]), { estimate_id: copy.id, already_created: true })
  assert.equal(await admin(db, () => val(db, 'select coalesce(sum(documents),0)::int value from private.monthly_usage')), usage + 1)
  for (const table of ['jobs', 'invoices', 'document_approval_links', 'document_approvals']) assert.equal(await admin(db, () => val(db, `select count(*)::int value from public.${table}`)), 0)
  const current = await document(db, 'estimate', 'sent'); await denied(() => rpc(db, 'create_revised_estimate', [current, randomUUID()]), '23514')
  await denied(() => rpc(db, 'create_revised_estimate', [current, request]), '23505')
  await admin(db, () => db.query("insert into private.finviant_email_outbox(id,business_id,actor_id,document_kind,document_id,payload,status) values($1,$2,$3,'estimate',$4,'{}','uncertain')", [randomUUID(), ids.business, ids.owner, e]))
  await denied(() => rpc(db, 'create_revised_estimate', [e, randomUUID()]), '23514')
  await asUser(db, ids.worker); await denied(() => rpc(db, 'create_revised_estimate', [e, randomUUID()]))
}))

test('read-only copied documents are immutable revision shares with no approval authority or approval records', () => withDb(async db => {
  const e = await document(db, 'estimate', 'accepted'), token = 'a'.repeat(64)
  const first = await rpc(db, 'prepare_document_copy', [ids.business, 'estimate', e, token])
  assert.equal(first.token, token); assert.equal(first.expires_at, null); assert.equal(first.snapshot.customer.name, 'Customer'); assert.equal(first.snapshot.items.length, 1)
  assert.deepEqual(await rpc(db, 'prepare_document_copy', [ids.business, 'estimate', e, token]), first)
  assert.equal(await admin(db, () => val(db, 'select count(*)::int value from private.document_shares')), 1)
  assert.equal(await admin(db, () => val(db, 'select count(*)::int value from private.document_shares where approval_token is not null')), 0)
  for (const table of ['document_approval_links', 'document_approvals']) assert.equal(await admin(db, () => val(db, `select count(*)::int value from public.${table}`)), 0)
  await denied(() => rpc(db, 'prepare_document_copy', [ids.other, 'estimate', e, 'b'.repeat(64)]))
  await denied(() => rpc(db, 'prepare_document_copy', [ids.business, 'estimate', randomUUID(), token]), '23505')
  await asUser(db, ids.worker); await denied(() => rpc(db, 'prepare_document_copy', [ids.business, 'estimate', e, 'c'.repeat(64)]))
}))

test('pending and review payment operations block new manual payments while identical prior receipts replay safely', () => withDb(async db => {
  const i = await document(db, 'invoice', 'sent'), request = randomUUID()
  const pay = (amount: number, req = randomUUID()) => rpc(db, 'record_manual_payment', [ids.business, i, req, amount, 'cash', 'Received'])
  const first = await pay(10, request)
  await denied(() => val(db, 'select private.record_manual_payment_before_record_actions($1,$2,$3,5,\'cash\',\'\') value', [ids.business, i, randomUUID()]))
  const checkout = randomUUID()
  await admin(db, () => db.query("insert into private.customer_invoice_checkouts(id,business_id,invoice_id,revision_id,token_hash,request_id,stripe_account_id,livemode,amount_minor,currency,status,stripe_payment_intent) values($1,$2,$3,$4,$5,$6,'acct_sensitive',false,9500,'usd','pending','pi_sensitive')", [checkout, ids.business, i, randomUUID(), 'a'.repeat(64), randomUUID()]))
  assert.equal((await rpc(db, 'get_invoice_payment_operations', [ids.business, i])).state, 'pending')
  await denied(() => pay(5), '23514'); assert.deepEqual(await pay(10, request), first); await assert.rejects(() => pay(11, request))
  await admin(db, () => db.query("update private.customer_invoice_checkouts set status='review_required' where id=$1", [checkout]))
  await admin(db, () => db.query("insert into private.customer_invoice_refunds(stripe_account_id,refund_id,checkout_id,amount_minor,refunded_at) values('acct_sensitive','re_receipt',$1,125,now())", [checkout]))
  const context = await rpc(db, 'get_invoice_payment_operations', [ids.business, i]); assert.equal(context.state, 'review_required'); assert.equal(context.refunds[0].amount, 1.25); assert.equal(context.refunds[0].id, 're_receipt'); assert.equal(context.refunds[0].currency, 'usd')
  assert.doesNotMatch(JSON.stringify(context), /acct_sensitive|pi_sensitive|revision_id|token_hash|request_id/)
  await denied(() => pay(5), '23514'); assert.equal(Number((await row(db, 'invoices', i)).amount_paid), 10); assert.equal(await val(db, 'select count(*)::int value from public.payments'), 1)
  await asUser(db, ids.worker); await denied(() => rpc(db, 'get_invoice_payment_operations', [ids.business, i])); await denied(() => pay(5))
}))

test('linked Calendar completion executes the real job completion and invoice workflow once, including invoice status', () => withDb(async db => {
  const e = await document(db, 'estimate', 'accepted'), j = await job(db, 'in_progress', e), a = await appointment(db, j)
  const completed = await rpc(db, 'update_appointment_workflow', [a, 'completed'])
  assert.equal((await row(db, 'jobs', j)).status, 'completed'); assert.equal((await row(db, 'appointments', a)).status, 'completed'); assert.equal(completed.invoice_ready, true); assert.equal(completed.invoice_status, 'draft')
  const i = await row(db, 'invoices', completed.invoice_id); assert.equal(i.job_id, j); assert.equal(Number(i.total), 105)
  const replay = await rpc(db, 'update_appointment_workflow', [a, 'completed']); assert.equal(replay.already_updated, true); assert.equal(await val(db, 'select count(*)::int value from public.invoices'), 1)
  await rpc(db, 'reopen_job', [j, randomUUID()])
  assert.equal((await rpc(db, 'update_appointment_workflow', [a, 'completed'])).already_updated, true); assert.equal((await row(db, 'jobs', j)).status, 'lead')
  await denied(() => rpc(db, 'update_appointment_workflow', [a, 'canceled']), '23514'); assert.equal(await val(db, 'select count(*)::int value from public.invoices'), 1)
  const standalone = await appointment(db, null); const solo = await rpc(db, 'update_appointment_workflow', [standalone, 'completed']); assert.equal(solo.job_id, undefined); assert.equal((await row(db, 'jobs', j)).status, 'lead'); assert.equal(await val(db, 'select count(*)::int value from public.invoices'), 1)
}))

test('Calendar completion reuses an already-issued invoice and technicians receive no finance identifiers', () => withDb(async db => {
  const e = await document(db, 'estimate', 'accepted'), j = await job(db, 'in_progress', e)
  const i = await rpc(db, 'convert_estimate_to_invoice', [e]); await db.query("update public.invoices set status='sent' where id=$1", [i]); const a = await appointment(db, j)
  const completed = await rpc(db, 'update_appointment_workflow', [a, 'completed']); assert.equal(completed.invoice_id, i); assert.equal(completed.invoice_status, 'sent'); assert.equal(await val(db, 'select count(*)::int value from public.invoices'), 1)
  const other = await job(db, 'in_progress'), otherVisit = await appointment(db, other)
  await asUser(db, ids.worker); const staff = await rpc(db, 'update_appointment_workflow', [otherVisit, 'completed']); assert.equal(staff.invoice_id, null); assert.equal(staff.invoice_status, null); assert.equal(staff.invoice_ready, false)
  await asUser(db); assert.equal((await row(db, 'jobs', other)).status, 'completed')
}))

test('legacy direct writes cannot bypass reviewed reopening, linked completion or payment reconciliation guards', () => withDb(async db => {
  const j = await job(db, 'scheduled'), a = await appointment(db, j)
  await denied(() => db.query("update public.appointments set status='completed' where id=$1", [a]), '23514')
  assert.equal((await row(db, 'jobs', j)).status, 'scheduled'); assert.equal((await row(db, 'appointments', a)).status, 'confirmed')
  await db.query("update public.jobs set status='completed',completed_at=now() where id=$1", [j])
  await denied(() => db.query("update public.jobs set status='lead' where id=$1", [j]), '23514')
  await denied(() => rpc(db, 'set_job_status_atomic', [j, 'scheduled']), '23514')
  await denied(() => db.query("insert into private.record_action_requests(business_id,action,request_id,actor_id,source_id,result) values($1,'reopen_job',$2,$3,$4,'{}')", [ids.business, randomUUID(), ids.owner, j]))
  await rpc(db, 'reopen_job', [j, randomUUID()]); await db.query("update public.jobs set status='completed' where id=$1", [j])
  await denied(() => db.query("update public.jobs set status='lead' where id=$1", [j]), '23514')
  const i = await document(db, 'invoice', 'sent')
  await admin(db, () => db.query("insert into private.customer_invoice_checkouts(business_id,invoice_id,revision_id,token_hash,request_id,stripe_account_id,livemode,amount_minor,currency,status) values($1,$2,$3,$4,$5,'acct_test',false,10500,'usd','pending')", [ids.business, i, randomUUID(), 'b'.repeat(64), randomUUID()]))
  await denied(() => db.query("insert into public.payments(business_id,invoice_id,request_id,amount,method,status,provider) values($1,$2,$3,5,'cash','succeeded','manual')", [ids.business, i, randomUUID()]), '23514')
  await denied(() => db.query("insert into public.payments(business_id,invoice_id,request_id,amount,method,status) values($1,$2,$3,5,'cash','succeeded')", [ids.business, i, randomUUID()]), '23514')
  await denied(() => db.query("insert into public.payments(business_id,invoice_id,request_id,amount,method,status,provider) values($1,$2,$3,5,'cash','succeeded','other')", [ids.business, i, randomUUID()]), '23514')
  assert.equal(Number((await row(db, 'invoices', i)).amount_paid), 0)
}))

test('a new copy captures edited draft content while an existing copy token remains frozen', () => withDb(async db => {
  const e = await document(db), first = await rpc(db, 'prepare_document_copy', [ids.business, 'estimate', e, 'd'.repeat(64)])
  await db.query("update public.estimate_items set description='New reviewed scope',unit_price=75 where estimate_id=$1", [e])
  const next = await rpc(db, 'prepare_document_copy', [ids.business, 'estimate', e, 'e'.repeat(64)])
  assert.notEqual(first.revision_id, next.revision_id); assert.equal(next.snapshot.items[0].description, 'New reviewed scope'); assert.equal(Number(next.snapshot.total), 157.5)
  assert.deepEqual(await rpc(db, 'prepare_document_copy', [ids.business, 'estimate', e, 'd'.repeat(64)]), first)
  assert.equal(await admin(db, () => val(db, 'select count(*)::int value from private.document_versions where document_id=$1', [e])), 2)
  assert.equal(await admin(db, () => val(db, 'select count(*)::int value from public.document_approval_links')), 0)
}))

test('authorized office staff can revise an estimate using current owner-managed payment defaults', () => withDb(async db => {
  const e = await document(db, 'estimate', 'declined'), source = await row(db, 'estimates', e)
  await db.query("update public.business_settings set payment_instructions='Current owner instructions' where business_id=$1", [ids.business])
  await admin(db, () => db.query("update public.business_members set role='office' where user_id=$1", [ids.worker])); await asUser(db, ids.worker)
  const revised = await rpc(db, 'create_revised_estimate', [e, randomUUID()]), copy = await row(db, 'estimates', revised.estimate_id)
  assert.equal(copy.status, 'draft'); assert.deepEqual(copy.payment_links, source.payment_links); assert.equal(copy.payment_instructions, 'Current owner instructions'); assert.notEqual(copy.payment_instructions, source.payment_instructions)
  assert.deepEqual(await row(db, 'estimates', e), source)
}))

test('job context prioritizes directly linked invoices over historical estimate invoices with no job link', () => withDb(async db => {
  const e = await document(db, 'estimate', 'accepted'), historic = await rpc(db, 'convert_estimate_to_invoice', [e])
  assert.equal((await row(db, 'invoices', historic)).job_id, null)
  const j = await job(db, 'lead', e), direct = await document(db, 'invoice', 'sent')
  await db.query('update public.invoices set job_id=$1 where id=$2', [j, direct])
  const context = await rpc(db, 'get_job_workflow_context', [ids.business, [j]])
  assert.equal(context[0].invoice.id, direct)
}))

test('estimate context respects module projections, tenant filtering and bounded batch reads', () => withDb(async db => {
  const e = await document(db, 'estimate', 'accepted'), j = await job(db, 'scheduled', e), a = await appointment(db, j)
  let context = await rpc(db, 'get_estimate_workflow_context', [ids.business, [e, randomUUID()]])
  assert.equal(context.length, 1); assert.equal(context[0].job.id, j); assert.equal(context[0].appointment.id, a)
  await denied(() => rpc(db, 'get_estimate_workflow_context', [ids.business, Array(201).fill(e)]), '22023')
  await denied(() => rpc(db, 'get_estimate_workflow_context', [ids.business, null]), '22023')
  await admin(db, () => db.query("update public.business_members set role='office',access_modules=array['billing'] where user_id=$1", [ids.worker])); await asUser(db, ids.worker)
  context = await rpc(db, 'get_estimate_workflow_context', [ids.business, [e]])
  assert.equal(context[0].job, null); assert.equal(context[0].appointment, null); assert.equal(context[0].schedule, null); assert.equal(context[0].invitation, null)
  await denied(() => rpc(db, 'get_estimate_workflow_context', [ids.other, [e]]))
  await asAnon(db); await denied(() => rpc(db, 'get_estimate_workflow_context', [ids.business, [e]]))
}))
