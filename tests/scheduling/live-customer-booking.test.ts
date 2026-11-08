import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { DateTime } from 'luxon'
import { actor, estimate, fixture, ids } from './fixture.ts'

const hash = (token: string) => createHash('sha256').update(token).digest('hex')
const zone = 'America/New_York'
const day = () => DateTime.now().setZone(zone).plus({ days: 14 }).startOf('week').plus({ days: 1 }).toISODate()!
const value = async (db: PGlite, sql: string, args: unknown[] = []) => (await db.query<{ value: any }>(sql, args)).rows[0].value
async function owner(db: PGlite, id = ids.owner) {
  await db.exec('reset role')
  await actor(db, id)
  await db.exec('set role authenticated')
}
async function anonymous(db: PGlite) {
  await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);set role anon")
}
async function setup(beforeMigration?: (db: PGlite) => Promise<void>) {
  const db = await fixture(true)
  await db.exec(`reset role;
    create function private.is_business_member(b uuid) returns boolean language sql stable security definer set search_path='' as
      $$select exists(select 1 from public.business_members where business_id=b and user_id=auth.uid())$$;
    create table public.business_activity(business_id uuid primary key references public.businesses(id),version bigint not null default 1,updated_at timestamptz not null default now());
    alter table public.business_activity enable row level security;
    revoke all on public.business_activity from public,anon,authenticated,service_role;
    grant select on public.business_activity to authenticated;
    create policy business_activity_read on public.business_activity for select to authenticated using(private.is_business_member(business_id));`)
  const payments = await readFile('supabase/migrations/20261108001511_verified_customer_invoice_payments.sql', 'utf8')
  const from = payments.indexOf('create function private.bump_business_activity()')
  await db.exec(payments.slice(from, payments.indexOf('end $$;', from) + 'end $$;'.length))
  for (const table of ['invoices', 'estimates', 'change_orders', 'jobs']) await db.exec(
    `create trigger finviant_business_activity after insert or update or delete on public.${table} for each row execute function private.bump_business_activity()`)
  if (beforeMigration) {
    await owner(db)
    await db.query('select public.save_scheduling_preferences($1,$2)', [ids.business, {
      work_days: [1, 2, 3, 4, 5], start_minutes: 480, end_minutes: 1020, duration_minutes: 60, buffer_minutes: 0, notice_hours: 0,
    }])
    await beforeMigration(db)
    await db.exec('reset role')
  }
  const migration = await readFile('supabase/migrations/20261108003415_live_customer_scheduling.sql', 'utf8')
  assert.ok(migration.trim(), 'live customer scheduling migration is present')
  await db.exec(migration)
  await owner(db)
  await db.query('select public.save_scheduling_preferences($1,$2)', [ids.business, {
    work_days: [1, 2, 3, 4, 5], start_minutes: 480, end_minutes: 1020, duration_minutes: 60, buffer_minutes: 0, notice_hours: 0,
  }])
  return db
}
const suggestions = (db: PGlite, workers = [ids.owner], from = day()) => value(db, 'select public.suggest_scheduling_slots($1,$2,$3,$4) value', [ids.business, workers, 60, from])
async function invite(db: PGlite, quote: string, workers = [ids.owner], slots?: any[]) {
  const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')
  const request = randomUUID()
  const input = { title: 'Mow and trim', property_id: ids.site, workers, slots: slots || (await suggestions(db, workers)).slice(0, 3), note: 'Please choose a convenient time.', recipient_email: 'customer@example.test' }
  const result = await value(db, 'select public.approve_scheduling_offer($1,$2,$3,$4) value', [quote, request, input, hash(token)])
  return { token, request, input, result }
}
const view = (db: PGlite, token: string) => value(db, 'select public.customer_schedule_offer($1) value', [token])
const confirm = (db: PGlite, token: string, slot: string, name = 'Customer Name') => value(db, 'select public.customer_schedule_offer($1,$2,$3) value', [token, slot, name])
const activity = (db: PGlite) => value(db, 'select coalesce((select version from public.business_activity where business_id=$1),0)::int value', [ids.business])

test('owner Pro invitation is retry-safe and anonymous confirmation creates one job, appointment, and activity update', async () => {
  const db = await setup()
  try {
    const quote = await estimate(db), offered = await invite(db, quote, [ids.owner, ids.worker])
    const retry = await value(db, 'select public.approve_scheduling_offer($1,$2,$3,$4) value', [quote, offered.request, offered.input, hash(offered.token)])
    assert.equal(retry.id, offered.result.id)
    assert.equal((await value(db, 'select public.get_workflow_next_actions($1) value', [ids.business])).approved_count, 1)
    const beforeActivity = await activity(db)
    await anonymous(db)
    const available = await view(db, offered.token)
    assert.equal(available.status, 'approved')
    assert.equal(available.can_book, true)
    assert.equal(available.timezone, zone)
    assert.equal(available.slots.length, 3)
    assert.ok(available.checked_at)
    assert.equal(available.business_id, undefined)
    assert.equal(available.assigned_user_ids, undefined)
    assert.doesNotMatch(JSON.stringify(available), new RegExp([ids.owner, ids.worker, ids.business, 'owner@example.test', 'worker@example.test'].join('|')))
    const selected = available.slots[0]
    const booked = await confirm(db, offered.token, selected.id)
    assert.equal(booked.status, 'booked')
    assert.equal(booked.can_book, false)
    assert.equal((await confirm(db, offered.token, selected.id, 'Changed retry name')).status, 'booked')
    await assert.rejects(() => confirm(db, offered.token, available.slots[1].id), /already confirmed|different/i)
    await assert.rejects(() => db.query('select * from private.scheduling_offers'), /permission denied/)
    await assert.rejects(() => db.query('select * from public.business_activity'), /permission denied/)
    await owner(db)
    assert.ok(await activity(db) > beforeActivity)
    assert.equal(await value(db, 'select count(*)::int value from public.jobs'), 1)
    assert.equal(await value(db, 'select count(*)::int value from public.appointments'), 1)
    assert.equal((await value(db, 'select public.get_workflow_next_actions($1) value', [ids.business])).approved_count, 0)
    const saved = await value(db, 'select to_jsonb(j) value from public.jobs j where source_estimate_id=$1', [quote])
    assert.equal(saved.property_id, ids.site)
    assert.equal(saved.description, 'Mow and trim × 2')
    assert.deepEqual(saved.assigned_user_ids, [ids.owner, ids.worker].sort())
    await db.exec('reset role')
    assert.equal(await value(db, 'select customer_name value from private.scheduling_offers where id=$1', [offered.request]), 'Customer Name')
    await assert.rejects(() => db.query("update private.scheduling_offers set customer_name='Overwritten' where id=$1", [offered.request]), /receipt.*immutable/i)
    await assert.rejects(() => db.query("update private.scheduling_offers set title='Different reviewed work' where id=$1", [offered.request]), /immutable/i)
  } finally { await db.close() }
})

test('a chosen slot must belong to its invitation and unknown tokens do not disclose private records', async () => {
  const db = await setup()
  try {
    const a = await invite(db, await estimate(db)), b = await invite(db, await estimate(db))
    await anonymous(db)
    const aView = await view(db, a.token), bView = await view(db, b.token)
    await assert.rejects(() => confirm(db, a.token, bView.slots[0].id), /this invitation|choose.*time/i)
    await assert.rejects(() => confirm(db, a.token, randomUUID()), /this invitation|choose.*time/i)
    await assert.rejects(() => view(db, hash(a.token)), /unavailable/i)
    await assert.rejects(() => view(db, 'not-a-token'), /unavailable/i)
    assert.equal((await view(db, a.token)).slots.length, aView.slots.length)
    await owner(db)
    assert.equal(await value(db, 'select count(*)::int value from public.jobs'), 0)
    assert.equal(await value(db, 'select count(*)::int value from public.appointments'), 0)
  } finally { await db.close() }
})

test('two stale confirmations cannot double-book and the losing invitation refreshes its available options', async () => {
  const db = await setup()
  try {
    const a = await invite(db, await estimate(db)), b = await invite(db, await estimate(db))
    await anonymous(db)
    const offers = [a, b], views = [await view(db, a.token), await view(db, b.token)]
    assert.equal(views[0].slots[0].starts_at, views[1].slots[0].starts_at)
    const results = await Promise.allSettled(offers.map((offered, i) => confirm(db, offered.token, views[i].slots[0].id)))
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(results.filter(result => result.status === 'rejected').length, 1)
    const loser = results.findIndex(result => result.status === 'rejected')
    const refreshed = await view(db, offers[loser].token)
    assert.ok(!refreshed.slots.some((slot: any) => slot.id === views[loser].slots[0].id))
    assert.ok(refreshed.slots.length > 0)
    await owner(db)
    assert.equal(await value(db, 'select count(*)::int value from public.jobs'), 1)
    await anonymous(db)
    assert.equal((await confirm(db, offers[loser].token, refreshed.slots[0].id)).status, 'booked')
    await owner(db)
    const times = (await db.query<{ scheduled_start: string; scheduled_end: string }>('select scheduled_start,scheduled_end from public.jobs order by scheduled_start')).rows
    assert.equal(times.length, 2)
    assert.ok(Date.parse(times[0].scheduled_end) <= Date.parse(times[1].scheduled_start))
    assert.equal(await value(db, 'select count(*)::int value from public.appointments'), 2)
  } finally { await db.close() }
})

test('pending invitations pause when Pro, staff/crew eligibility, reviewed address, or business timezone changes', async () => {
  for (const changed of ['plan', 'approver', 'billing', 'worker', 'address', 'timezone'] as const) {
    const db = await setup()
    try {
      const offered = await invite(db, await estimate(db), [ids.owner, ids.worker])
      const previous = await view(db, offered.token)
      await db.exec('reset role')
      if (changed === 'plan') await db.query("update private.business_entitlements set plan='free' where business_id=$1", [ids.business])
      if (changed === 'approver') await db.query("update public.business_members set role='technician' where business_id=$1 and user_id=$2", [ids.business, ids.owner])
      if (changed === 'billing') await db.query("update public.business_members set access_modules=array['calendar','jobs'] where business_id=$1 and user_id=$2", [ids.business, ids.owner])
      if (changed === 'worker') await db.query("update public.business_members set role='viewer' where business_id=$1 and user_id=$2", [ids.business, ids.worker])
      if (changed === 'address') await db.query("update public.properties set address_line1='A changed service address' where id=$1", [ids.site])
      if (changed === 'timezone') await db.query("update public.businesses set timezone='America/Los_Angeles' where id=$1", [ids.business])
      await anonymous(db)
      const paused = await view(db, offered.token)
      assert.equal(paused.status, 'paused', changed)
      assert.equal(paused.can_book, false, changed)
      assert.deepEqual(paused.slots, [], changed)
      assert.ok(paused.status_reason, changed)
      assert.equal(paused.address, previous.address, 'the reviewed location stays frozen')
      assert.equal(paused.timezone, previous.timezone, 'the reviewed timezone stays frozen')
      await assert.rejects(() => confirm(db, offered.token, previous.slots[0].id), /review|paused|worker|available|address|timezone|time zone|changed/i)
      await db.exec('reset role')
      assert.equal(await value(db, 'select count(*)::int value from public.jobs'), 0)
    } finally { await db.close() }
  }
})

test('new time off and changed business working hours remove stale options before confirmation', async () => {
  const db = await setup()
  try {
    const offered = await invite(db, await estimate(db), [ids.owner, ids.worker])
    const available = await view(db, offered.token), first = available.slots[0]
    const before = await activity(db)
    await db.query('select public.manage_worker_time_off($1,$2,$3,$4,$5)', [ids.business, ids.worker, first.starts_at, first.ends_at, 'PRIVATE_TIME_OFF_NOTE'])
    assert.ok(await activity(db) > before)
    await anonymous(db)
    const updated = await view(db, offered.token)
    assert.ok(!updated.slots.some((slot: any) => slot.id === first.id))
    assert.doesNotMatch(JSON.stringify(updated), /PRIVATE_TIME_OFF_NOTE/)
    await assert.rejects(() => confirm(db, offered.token, first.id), /choose another|booked|available/i)
    await owner(db)
    await db.query('select public.save_scheduling_preferences($1,$2)', [ids.business, {
      work_days: [1, 2, 3, 4, 5], start_minutes: 960, end_minutes: 1020, duration_minutes: 60, buffer_minutes: 0, notice_hours: 0,
    }])
    await anonymous(db)
    const closed = await view(db, offered.token)
    assert.equal(closed.can_book, false)
    assert.deepEqual(closed.slots, [])
    assert.ok(closed.status_reason)
    await assert.rejects(() => confirm(db, offered.token, available.slots[2].id), /choose another|booked|available/i)
    await owner(db)
    assert.equal(await value(db, 'select count(*)::int value from public.jobs'), 0)
  } finally { await db.close() }
})

test('expired and replaced invitations remain intelligible read-only states', async () => {
  let old: any, current: any, selected: string
  const db = await setup(async db => {
    const quote = await estimate(db)
    old = await invite(db, quote)
    current = await invite(db, quote)
    selected = (await view(db, current.token)).slots[0].id
    await db.exec('reset role')
    await db.query("update private.scheduling_offers set expires_at=now()-interval '1 second' where id=$1", [current.request])
  })
  try {
    await anonymous(db)
    for (const [offered, status] of [[old, 'revoked'], [current, 'expired']] as const) {
      const readOnly = await view(db, offered.token)
      assert.equal(readOnly.status, status)
      assert.equal(readOnly.can_book, false)
      assert.deepEqual(readOnly.slots, [])
      assert.ok(readOnly.status_reason)
      await assert.rejects(() => confirm(db, offered.token, selected!), /expired|replaced|revoked|available/i)
    }
  } finally { await db.close() }
})

test('confirmed receipt follows rescheduling and remains safe after plan/access/expiry changes and cancellation', async () => {
  let quote: string, offered: any, selected: any
  const db = await setup(async db => {
    quote = await estimate(db)
    offered = await invite(db, quote, [ids.owner, ids.worker])
    selected = (await view(db, offered.token)).slots[0]
    await anonymous(db)
    await confirm(db, offered.token, selected.id)
    await db.exec('reset role')
    await db.query("update private.scheduling_offers set expires_at=now()-interval '1 day' where id=$1", [offered.request])
  })
  try {
    await owner(db)
    const job = await value(db, 'select to_jsonb(j) value from public.jobs j where source_estimate_id=$1', [quote!])
    const later = (await suggestions(db, [ids.owner, ids.worker], DateTime.fromISO(day()).plus({ days: 7 }).toISODate()!))[0]
    await db.query('select public.save_job_appointment($1,$2,$3,$4,$5,$6)', [job.id, later.starts_at, later.ends_at, job.scheduled_start, job.scheduled_end, false])
    const changed = await view(db, offered.token)
    assert.equal(Date.parse(changed.confirmed.starts_at), Date.parse(later.starts_at))
    await db.exec('reset role')
    await db.query("update private.business_entitlements set plan='free' where business_id=$1", [ids.business])
    await db.query("update public.business_members set access_modules='{}' where business_id=$1 and user_id=$2", [ids.business, ids.owner])
    await db.query("update public.business_members set role='viewer' where business_id=$1 and user_id=$2", [ids.business, ids.worker])
    await anonymous(db)
    const receipt = await view(db, offered.token)
    assert.equal(receipt.status, 'booked')
    assert.equal(receipt.can_book, false)
    assert.deepEqual(receipt.slots, [])
    assert.equal(Date.parse(receipt.confirmed.starts_at), Date.parse(later.starts_at))
    assert.equal((await confirm(db, offered.token, selected.id)).status, 'booked')
    assert.doesNotMatch(JSON.stringify(receipt), new RegExp([ids.owner, ids.worker, ids.business, 'worker@example.test'].join('|')))
    await db.exec("reset role;select set_config('request.jwt.claim.sub','',false)")
    const beforeCancel = await activity(db)
    await db.query("update public.jobs set status='canceled' where id=$1", [job.id])
    assert.ok(await activity(db) > beforeCancel)
    await anonymous(db)
    assert.equal((await view(db, offered.token)).status, 'canceled')
  } finally { await db.close() }
})

test('reactivating a canceled job or appointment rechecks unchanged-time crew conflicts', async () => {
  const db = await setup()
  try {
    const slot = (await suggestions(db))[0]
    const canceled = await value(db, "insert into public.jobs(business_id,customer_id,title,status,assigned_user_ids,scheduled_start,scheduled_end) values($1,$2,'Canceled work','canceled',$3,$4,$5) returning id value", [ids.business, ids.customer, [ids.owner], slot.starts_at, slot.ends_at])
    await db.query("insert into public.jobs(business_id,customer_id,title,status,assigned_user_ids,scheduled_start,scheduled_end) values($1,$2,'Current booking','scheduled',$3,$4,$5)", [ids.business, ids.customer, [ids.owner], slot.starts_at, slot.ends_at])
    const appointment = await value(db, "insert into public.appointments(business_id,customer_id,title,status,assigned_user_id,starts_at,ends_at) values($1,$2,'Canceled appointment','canceled',$3,$4,$5) returning id value", [ids.business, ids.customer, ids.owner, slot.starts_at, slot.ends_at])
    await assert.rejects(() => db.query("update public.jobs set status='scheduled' where id=$1", [canceled]), /booked|conflict|available/i)
    await assert.rejects(() => db.query("update public.appointments set status='confirmed' where id=$1", [appointment]), /booked|conflict|available/i)
    assert.equal(await value(db, 'select status value from public.jobs where id=$1', [canceled]), 'canceled')
    assert.equal(await value(db, 'select status value from public.appointments where id=$1', [appointment]), 'canceled')
  } finally { await db.close() }
})

test('working windows use precise opening/closing instants and support a configured midnight close', async () => {
  const db = await setup()
  const check = (s: string, e: string) => value(db, 'select private.schedule_window_valid_at($1,$2,$3,$4) value', [ids.business, s, e, '2027-03-13T00:00:00Z'])
  try {
    await db.exec('reset role')
    assert.equal(await check('2027-03-15T08:00:00-04:00', '2027-03-15T17:00:00-04:00'), true)
    assert.equal(await check('2027-03-15T08:00:00-04:00', '2027-03-15T17:00:00.001-04:00'), false)
    assert.equal(await check('2027-03-15T07:59:59.999-04:00', '2027-03-15T09:00:00-04:00'), false)
    assert.equal(await check('2027-03-15T08:00:00-04:00', '2027-03-15T08:14:59.999-04:00'), false)
    await db.query('update private.scheduling_preferences set start_minutes=1320,end_minutes=1440 where business_id=$1', [ids.business])
    assert.equal(await check('2027-03-15T22:00:00-04:00', '2027-03-16T00:00:00-04:00'), true)
    assert.equal(await check('2027-03-15T22:00:00-04:00', '2027-03-16T00:00:00.001-04:00'), false)
    await anonymous(db)
    await assert.rejects(() => check('2027-03-15T22:00:00-04:00', '2027-03-16T00:00:00-04:00'), /permission denied/)
  } finally { await db.close() }
})

test('timezone weekdays, DST transitions, notice, and horizon are checked against one explicit instant', async () => {
  const db = await setup()
  const check = (s: string, e: string, now: string) => value(db, 'select private.schedule_window_valid_at($1,$2,$3,$4) value', [ids.business, s, e, now])
  try {
    await db.exec('reset role')
    await db.query('update private.scheduling_preferences set work_days=array[7],start_minutes=60,end_minutes=240 where business_id=$1', [ids.business])
    assert.equal(await check('2027-03-14T01:30:00-05:00', '2027-03-14T03:30:00-04:00', '2027-03-13T00:00:00Z'), true, 'spring-forward windows use real instants in the business timezone')
    assert.equal(await check('2027-03-14T01:30:00-05:00', '2027-03-14T04:00:00.001-04:00', '2027-03-13T00:00:00Z'), false)
    assert.equal(await check('2027-11-07T01:15:00-04:00', '2027-11-07T01:45:00-05:00', '2027-11-06T00:00:00Z'), true, 'fall-back offsets are not confused with an end before the start')
    await db.query('update private.scheduling_preferences set start_minutes=0,end_minutes=90 where business_id=$1', [ids.business])
    assert.equal(await check('2026-11-01T01:45:00-04:00', '2026-11-01T01:15:00-05:00', '2026-10-31T00:00:00Z'), false, 'a DST fold cannot disguise a start after closing')
    await db.query('update private.scheduling_preferences set start_minutes=90,end_minutes=240 where business_id=$1', [ids.business])
    assert.equal(await check('2026-11-01T01:45:00-04:00', '2026-11-01T01:15:00-05:00', '2026-10-31T00:00:00Z'), false, 'a DST fold cannot disguise an end before opening')
    await db.query("update public.businesses set timezone='Pacific/Kiritimati' where id=$1", [ids.business])
    await db.query('update private.scheduling_preferences set work_days=array[1],start_minutes=480,end_minutes=1020,notice_hours=24 where business_id=$1', [ids.business])
    assert.equal(await check('2027-03-15T08:00:00+14:00', '2027-03-15T09:00:00+14:00', '2027-03-14T08:00:00+14:00'), true, 'a local Monday may be a UTC Sunday')
    assert.equal(await check('2027-03-15T08:00:00+14:00', '2027-03-15T09:00:00+14:00', '2027-03-14T08:00:00.001+14:00'), false, 'notice includes sub-minute precision')
    assert.equal(await check('2027-03-14T08:00:00+14:00', '2027-03-14T09:00:00+14:00', '2027-03-12T00:00:00Z'), false, 'weekdays are checked in the business timezone')
    assert.equal(await check('2027-03-15T08:00:00+14:00', '2027-03-15T09:00:00+14:00', '2026-12-01T00:00:00Z'), false, 'the booking horizon cannot be bypassed')
  } finally { await db.close() }
})

test('only authorized Pro staff may issue customer invitations', async () => {
  const db = await setup()
  try {
    const quote = await estimate(db), offered = await invite(db, quote)
    for (const who of [ids.worker, ids.outsider]) {
      await owner(db, who)
      await assert.rejects(() => value(db, 'select public.approve_scheduling_offer($1,$2,$3,$4) value', [quote, randomUUID(), offered.input, hash('a'.repeat(64))]), /access|required/i)
    }
    await db.exec('reset role')
    await db.query("update private.business_entitlements set plan='basic' where business_id=$1", [ids.business])
    await owner(db)
    await assert.rejects(() => value(db, 'select public.approve_scheduling_offer($1,$2,$3,$4) value', [quote, randomUUID(), offered.input, hash('b'.repeat(64))]), /Business Pro/i)
  } finally { await db.close() }
})

test('a booked job cannot change its reviewed customer, service ownership, or source estimate', async () => {
  const db = await setup()
  try {
    const quote = await estimate(db), offered = await invite(db, quote)
    const selected = (await view(db, offered.token)).slots[0]
    await anonymous(db)
    await confirm(db, offered.token, selected.id)
    await owner(db)
    const job = await value(db, 'select to_jsonb(j) value from public.jobs j where source_estimate_id=$1', [quote])
    const otherQuote = await estimate(db)
    const otherCustomer = await value(db, "insert into public.customers(business_id,first_name) values($1,'Different customer') returning id value", [ids.business])
    const otherSite = await value(db, "insert into public.properties(business_id,customer_id,address_line1) values($1,$2,'Different customer address') returning id value", [ids.business, otherCustomer])
    const before = await activity(db)
    await assert.rejects(() => db.query('update public.jobs set customer_id=$2 where id=$1', [job.id, otherCustomer]), /address|customer/i)
    await assert.rejects(() => db.query('update public.jobs set property_id=$2 where id=$1', [job.id, otherSite]), /address|customer/i)
    await assert.rejects(() => db.query('update public.jobs set customer_id=$2,property_id=$3 where id=$1', [job.id, otherCustomer, otherSite]), /approved estimate.*customer/i)
    await assert.rejects(() => db.query('update public.jobs set source_estimate_id=$2 where id=$1', [job.id, otherQuote]), /estimate link cannot change/i)
    assert.deepEqual(await value(db, 'select to_jsonb(j) value from public.jobs j where id=$1', [job.id]), job)
    assert.equal(await activity(db), before, 'refused changes do not publish a misleading activity update')
  } finally { await db.close() }
})

test('an unscheduled booked job pauses the customer receipt without reopening its invitation', async () => {
  const db = await setup()
  try {
    const quote = await estimate(db), offered = await invite(db, quote)
    const selected = (await view(db, offered.token)).slots[0]
    await anonymous(db)
    const booked = await confirm(db, offered.token, selected.id)
    await owner(db)
    const job = await value(db, 'select job_id value from public.estimates where id=$1', [quote])
    await db.query('update public.jobs set scheduled_start=null,scheduled_end=null where id=$1', [job])
    await anonymous(db)
    const paused = await view(db, offered.token)
    assert.equal(paused.status, 'paused')
    assert.equal(paused.can_book, false)
    assert.deepEqual(paused.slots, [])
    assert.match(paused.status_reason, /reviewing.*time|confirm.*schedule/i)
    assert.equal(paused.booking_reference, booked.booking_reference)
    assert.equal((await confirm(db, offered.token, selected.id)).status, 'paused')
    await assert.rejects(() => confirm(db, offered.token, randomUUID()), /already confirmed/i)
    await owner(db)
    assert.equal(await value(db, 'select count(*)::int value from public.jobs'), 1)
  } finally { await db.close() }
})

test('document calendar placeholders and confirmed jobs enforce conflicts in both directions', async () => {
  const db = await setup()
  try {
    const quote = await estimate(db), offered = await invite(db, quote), otherQuote = await estimate(db)
    const selected = (await view(db, offered.token)).slots[0]
    const placeholder = await value(db, `insert into public.document_schedules(business_id,estimate_id,job_title,description,timezone,status,scheduled_start_time,scheduled_end_time)
      values($1,$2,'Document calendar hold','Reviewed work',$3,'scheduled',$4,$5) returning id value`, [ids.business, otherQuote, zone, selected.starts_at, selected.ends_at])
    await db.query("update public.document_schedules set job_title='Renamed calendar hold' where id=$1", [placeholder])
    await anonymous(db)
    const blocked = await view(db, offered.token)
    assert.ok(!blocked.slots.some((slot: any) => slot.id === selected.id))
    await assert.rejects(() => confirm(db, offered.token, selected.id), (error: any) => error.code === '23P01')
    await owner(db)
    await db.query("update public.document_schedules set status='cancelled' where id=$1", [placeholder])
    await anonymous(db)
    assert.ok((await view(db, offered.token)).slots.some((slot: any) => slot.id === selected.id), 'a canceled hold no longer claims availability')
    assert.equal((await confirm(db, offered.token, selected.id)).status, 'booked')
    await owner(db)
    const insert = (start: string, end: string) => db.query(`insert into public.document_schedules(business_id,estimate_id,job_title,timezone,status,scheduled_start_time,scheduled_end_time)
      values($1,$2,'Conflicting calendar hold',$3,'planned',$4,$5)`, [ids.business, otherQuote, zone, start, end])
    await assert.rejects(() => insert(selected.starts_at, selected.ends_at), (error: any) => error.code === '23P01')
    await db.query('select public.save_scheduling_preferences($1,$2)', [ids.business, {
      work_days: [1, 2, 3, 4, 5], start_minutes: 480, end_minutes: 1020, duration_minutes: 60, buffer_minutes: 30, notice_hours: 0,
    }])
    const bufferedStart = DateTime.fromISO(selected.ends_at).plus({ minutes: 15 }).toISO()!
    await assert.rejects(() => insert(bufferedStart, DateTime.fromISO(bufferedStart).plus({ hours: 1 }).toISO()!), (error: any) => error.code === '23P01')
    assert.equal(await value(db, "select count(*)::int value from public.document_schedules where status in('planned','scheduled')"), 0)
    assert.equal(await value(db, 'select count(*)::int value from public.jobs'), 1)
  } finally { await db.close() }
})

test('Pro connected job journey: customer booking, crew, completion, one invoice, partial/full payment and dashboard totals',async()=>{
 const db=await setup()
 try{
  const bootstrap=await readFile('supabase/migrations/20261028173902_finviant_complete_application_bootstrap.sql','utf8')
  const functionSql=(name:string)=>{const start=bootstrap.indexOf('CREATE OR REPLACE FUNCTION '+name+'(');assert.ok(start>=0);return bootstrap.slice(start,bootstrap.indexOf('$function$;',start)+12)}
  await db.exec('reset role')
  const paymentTable=bootstrap.match(/create table "public"\."payments" \(([\s\S]*?)\);/i)!
  await db.exec('create table public.payments ('+paymentTable[1]+');alter table payments add primary key(id);grant select,insert,update on payments to authenticated;')
  for(const name of ['public.record_manual_payment','private.commerce_paid_recalc','private.commerce_payment_guard','public.get_dashboard_invoice_totals'])await db.exec(functionSql(name))
  await db.exec('create trigger payments_guard before insert or update or delete on payments for each row execute function private.commerce_payment_guard();create trigger payment_recalc after insert or update or delete on payments for each row execute function private.commerce_paid_recalc();create trigger payment_activity after insert or update on payments for each row execute function private.bump_business_activity();')
  await owner(db)
  const quote=await estimate(db),offered=await invite(db,quote,[ids.owner,ids.worker])
  await anonymous(db);const offer=await view(db,offered.token);await confirm(db,offered.token,offer.slots[0].id)
  await owner(db)
  const job=await value(db,'select id value from jobs where source_estimate_id=$1',[quote]);assert.ok(job)
  await db.exec('reset role;set role service_role');
  const completed=await value(db,'select complete_job_workflow($1,$2) value',[job,ids.owner])
  assert.equal(completed.invoice_ready,true);const invoice=completed.invoice_id;assert.ok(invoice)
  const retry=await value(db,'select complete_job_workflow($1,$2,true) value',[job,ids.owner]);assert.equal(retry.invoice_id,invoice);await owner(db)
  assert.equal(await value(db,'select count(*)::int value from invoices where job_id=$1',[job]),1)
  assert.equal(Number(await value(db,'select total value from invoices where id=$1',[invoice])),105)
  // Provider delivery is simulated here; actual PDF attachment and delivery are covered separately.
  await db.query("update invoices set status='sent',sent_at=now() where id=$1",[invoice])
  assert.equal(Number((await value(db,'select to_jsonb(t) value from get_dashboard_invoice_totals($1) t',[ids.business])).outstanding_balance),105)
  const before=await activity(db),payment=randomUUID()
  await value(db,"select record_manual_payment($1,$2,$3,40,'cash','Received') value",[ids.business,invoice,payment])
  await value(db,"select record_manual_payment($1,$2,$3,40,'cash','Received') value",[ids.business,invoice,payment])
  assert.equal(await value(db,'select count(*)::int value from payments'),1)
  assert.equal(await value(db,'select status value from invoices where id=$1',[invoice]),'partial')
  assert.equal(Number(await value(db,'select balance_due value from invoices where id=$1',[invoice])),65)
  await value(db,"select record_manual_payment($1,$2,$3,65,'check','Received') value",[ids.business,invoice,randomUUID()])
  assert.equal(await value(db,'select status value from invoices where id=$1',[invoice]),'paid')
  assert.equal(Number((await value(db,'select to_jsonb(t) value from get_dashboard_invoice_totals($1) t',[ids.business])).outstanding_balance),0)
  assert.ok(await activity(db)>before)
 }finally{await db.close()}
})
