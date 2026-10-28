import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

process.env.TZ = 'America/New_York'
await build({ entryPoints: ['src/lib/jobGroups.ts', 'src/services/reminders.ts', 'src/lib/scheduleTime.ts'], outdir: '.qa-build/work', outbase: 'src', outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm',
  define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'https://qa.invalid', VITE_SUPABASE_PUBLISHABLE_KEY: 'qa-test-only' }) },
})
const { jobGroup } = await import('../../.qa-build/work/lib/jobGroups.mjs')
const { validateScheduleWindow } = await import('../../.qa-build/work/lib/scheduleTime.mjs')
const { listReminders, createReminder, completeWorkReminder } = await import('../../.qa-build/work/services/reminders.mjs')
const now = new Date('2026-10-28T12:00:00-04:00')
const tenant = '11111111-1111-4111-8111-111111111111'
const workspace = { id: tenant, role: 'owner' }
const input = { id: '22222222-2222-4222-8222-222222222222', note: '  Confirm access  ', dueAt: '2099-10-29T10:00:00-04:00' }

test('current includes unscheduled, overdue, today, and in-progress jobs', () => {
  for (const scheduled_start of [null, '2026-10-27T09:00:00-04:00', '2026-10-28T23:59:00-04:00']) {
    assert.equal(jobGroup({ status: 'scheduled', scheduled_start }, now), 'current')
  }
  assert.equal(jobGroup({ status: 'in_progress', scheduled_start: '2026-10-30T09:00:00-04:00' }, now), 'current')
})
test('upcoming begins at local midnight tomorrow, including across DST', () => {
  assert.equal(jobGroup({ status: 'scheduled', scheduled_start: '2026-10-29T00:00:00-04:00' }, now), 'upcoming')
  const fallBack = new Date('2026-11-01T00:30:00-04:00')
  assert.equal(jobGroup({ status: 'scheduled', scheduled_start: '2026-11-01T23:30:00-05:00' }, fallBack), 'current')
  assert.equal(jobGroup({ status: 'scheduled', scheduled_start: '2026-11-02T00:00:00-05:00' }, fallBack), 'upcoming')
})
test('finished jobs remain in history regardless of scheduled date', () => {
  for (const status of ['completed', 'canceled']) for (const scheduled_start of [null, '2026-10-27T09:00:00Z', '2026-10-30T09:00:00Z']) {
    assert.equal(jobGroup({ status, scheduled_start }, now), 'history')
  }
})
test('reminder local times convert to UTC and reject rollover dates and DST gaps', () => {
  assert.equal(validateScheduleWindow('2026-10-29T10:00', '').startsAt, '2026-10-29T14:00:00.000Z')
  assert.throws(() => validateScheduleWindow('2026-02-30T10:00', ''))
  assert.throws(() => validateScheduleWindow('2026-03-08T02:30', ''))
})

async function transport(handler, run) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url)
    assert.equal(url.hostname, 'qa.invalid', 'No external requests allowed')
    assert.ok(url.pathname.endsWith('/reminders'))
    calls.push(request.method)
    return handler(request, url)
  }
  try { await run(calls) } finally { globalThis.fetch = original }
}
const reply = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

test('standalone reminder creation trims text and uses the active workspace', () => transport(async request => {
  assert.equal(request.method, 'POST')
  const body = await request.json()
  assert.deepEqual(body, { id: input.id, business_id: tenant, note: 'Confirm access', due_at: '2099-10-29T14:00:00.000Z', kind: 'general', job_id: null, customer_id: null, status: 'pending' })
  return reply({ id: input.id }, 201)
}, async () => assert.equal(await createReminder(workspace, input), input.id)))

test('job reminder preserves the selected job and customer', () => transport(async request => {
  const body = await request.json()
  assert.equal(body.business_id, tenant)
  assert.equal(body.job_id, 'job-1'); assert.equal(body.customer_id, 'customer-1'); assert.equal(body.kind, 'job_follow_up')
  return reply({ id: input.id }, 201)
}, async () => { await createReminder(workspace, { ...input, jobId: 'job-1', customerId: 'customer-1' }) }))

test('viewers, blank notes, oversized notes, and invalid or past times cannot write', () => transport(() => { assert.fail('Validation must prevent network access') }, async () => {
  await assert.rejects(() => createReminder({ ...workspace, role: 'viewer' }, input), /role/)
  await assert.rejects(() => completeWorkReminder({ ...workspace, role: 'viewer' }, input.id), /role/)
  for (const note of ['  ', 'x'.repeat(2001)]) await assert.rejects(() => createReminder(workspace, { ...input, note }), /characters/)
  for (const dueAt of ['', 'not-a-date', '2000-01-01T00:00:00Z']) await assert.rejects(() => createReminder(workspace, { ...input, dueAt }), /future/)
}))

test('reminder pagination preserves tenant and status filters and reports the exact total', () => transport(async (request, url) => {
  assert.equal(request.method, 'GET')
  assert.equal(url.searchParams.get('business_id'), 'eq.' + tenant)
  assert.equal(url.searchParams.get('status'), 'eq.pending')
  assert.equal(url.searchParams.get('offset'), '50'); assert.equal(url.searchParams.get('limit'), '50')
  assert.equal(url.searchParams.get('order'), 'due_at.asc,id.asc')
  assert.match(request.headers.get('prefer'), /count=exact/)
  return reply([{ id: input.id, jobs: { title: 'Kitchen repair' } }], 200, { 'content-range': '50-50/51' })
}, async () => {
  const result = await listReminders(tenant, 'pending', 50)
  assert.equal(result.total, 51); assert.equal(result.rows[0].jobs[0].title, 'Kitchen repair')
}))

test('completion only updates the selected pending reminder in the current workspace', () => transport(async (request, url) => {
  assert.equal(request.method, 'PATCH')
  assert.equal(url.searchParams.get('business_id'), 'eq.' + tenant)
  assert.equal(url.searchParams.get('id'), 'eq.' + input.id)
  assert.equal(url.searchParams.get('status'), 'eq.pending')
  const body = await request.json()
  assert.equal(body.status, 'completed'); assert.ok(Number.isFinite(Date.parse(body.completed_at)))
  return reply({ id: input.id })
}, async () => { await completeWorkReminder(workspace, input.id) }))

for (const changed of [false, true]) test(`uncertain-save retry ${changed ? 'rejects different details' : 'verifies the same reminder without another insert'}`, () => transport(async (request, url) => {
  if (request.method === 'POST') return reply({ code: '23505', message: 'Duplicate id' }, 409)
  assert.equal(request.method, 'GET')
  assert.equal(url.searchParams.get('business_id'), 'eq.' + tenant)
  assert.equal(url.searchParams.get('id'), 'eq.' + input.id)
  return reply({ id: input.id, business_id: tenant, note: changed ? 'Different' : 'Confirm access', due_at: input.dueAt, kind: 'general', job_id: null, customer_id: null })
}, async calls => {
  if (changed) await assert.rejects(() => createReminder(workspace, input), /different details/)
  else assert.equal(await createReminder(workspace, input), input.id)
  assert.deepEqual(calls, ['POST', 'GET'])
}))

test('server permission errors remain visible and are not mistaken for success', () => transport(() => reply({ code: '42501', message: 'Permission denied' }, 403), async () => {
  await assert.rejects(() => createReminder(workspace, input), err => err.code === '42501')
  await assert.rejects(() => completeWorkReminder(workspace, input.id), err => err.code === '42501')
  await assert.rejects(() => listReminders(tenant, 'pending'), err => err.code === '42501')
}))
