import test from 'node:test'
import assert from 'node:assert/strict'
import { estimateActionState, estimateResponseDeadline, estimateResponseExpired, estimateWorkState, type EstimateActionPermissions } from '../../src/lib/estimateActions'

const owner: EstimateActionPermissions = { canManage: true, canSchedule: true, canOpenJob: true, canOpenInvoice: true }
const viewer: EstimateActionPermissions = { canManage: false, canSchedule: false, canOpenJob: true, canOpenInvoice: true }
const jobId = 'job-1'
const window = { scheduled_start: '2040-03-12T13:00:00Z', scheduled_end: '2040-03-12T15:00:00Z' }

test('the six stored estimate statuses select one lifecycle action without inventing viewed', () => {
  const expected = { draft: 'send', sent: 'follow_up', accepted: 'schedule_job', declined: null, expired: 'revise', converted: 'open_invoice' }
  for (const [status, key] of Object.entries(expected)) assert.equal(estimateActionState({ status }, { final_invoice_id: 'invoice-1' }, owner).primary?.key || null, key, status)
  assert.equal(estimateActionState({ status: 'viewed' }, {}, owner).primary, null)
  assert.equal(estimateActionState({ status: 'viewed' }, {}, owner).displayStatus, 'Unavailable')
  assert.equal(estimateActionState({ status: 'converted' }, {}, owner).primary, null, 'an existing invoice ID is required, rather than creating another invoice')
})

test('a response deadline uses the entire business date across DST boundaries', () => {
  assert.equal(estimateResponseDeadline('2026-03-08', 'America/New_York'), '2026-03-09T04:00:00.000Z', 'the spring day has 23 hours')
  assert.equal(estimateResponseDeadline('2026-11-01', 'America/New_York'), '2026-11-02T05:00:00.000Z', 'the fall day has 25 hours')
  assert.equal(estimateResponseExpired({ expires_on: '2026-03-08' }, 'America/New_York', new Date('2026-03-09T03:59:59.999Z')), false)
  assert.equal(estimateResponseExpired({ expires_on: '2026-03-08' }, 'America/New_York', new Date('2026-03-09T04:00:00Z')), true)
  const expiredResponse = estimateActionState({ status: 'sent', expires_on: '2026-03-08' }, { timezone: 'America/New_York' }, owner, new Date('2026-03-09T04:00:00Z'))
  assert.equal(expiredResponse.displayStatus, 'Response expired')
  assert.equal(expiredResponse.primary?.key, 'follow_up', 'a derived response deadline does not silently mutate the stored lifecycle')
  assert.equal(estimateActionState({ status: 'accepted', expires_on: '2026-03-08' }, { timezone: 'America/New_York' }, owner, new Date('2026-03-09T04:00:00Z')).displayStatus, 'Approved', 'an existing approval does not expire after acceptance')
})

test('missing or malformed dates never claim a verified expiry', () => {
  for (const date of [null, '', 'bad', '2026-02-30', '2026-11-08T00:00:00Z']) assert.equal(estimateResponseDeadline(date, 'America/New_York'), null)
  assert.equal(estimateResponseDeadline('2026-11-08', 'Invalid/Zone'), '2026-11-09T00:00:00.000Z', 'bad workspace zones use a deterministic UTC fallback')
  assert.equal(estimateResponseExpired({ expires_on: '2026-11-08' }, 'UTC', new Date(NaN)), false)
})

test('job identity by itself does not mean an appointment is booked', () => {
  const state = estimateActionState({ status: 'accepted', job_id: jobId }, { job: { id: jobId, status: 'scheduled', scheduled_start: null }, appointment: null }, owner)
  assert.equal(state.work.kind, 'needs_scheduling')
  assert.deepEqual(state.primary, { key: 'schedule_job', label: 'Schedule job', jobId })
  const unavailable = estimateActionState({ status: 'accepted', job_id: jobId }, { job: { id: 'another-job', status: 'scheduled', ...window } }, owner)
  assert.equal(unavailable.work.kind, 'unavailable')
  assert.equal(unavailable.primary?.key, 'open_job', 'the known record can be opened without creating duplicate work')
})

test('loaded context with no active appointment repairs the existing job despite its timestamps', () => {
  const estimate = { status: 'accepted', job_id: jobId }
  const job = { id: jobId, status: 'scheduled', ...window }
  for (const workflow of [{ job, appointment: null }, { job, contextLoaded: true }]) {
    const state = estimateActionState(estimate, workflow, owner)
    assert.equal(state.work.kind, 'needs_scheduling')
    assert.equal(state.work.startsAt, null, 'stale job timestamps are not shown as an active appointment')
    assert.deepEqual(state.primary, { key: 'schedule_job', label: 'Schedule job', jobId })
  }
  const unloaded = estimateActionState(estimate, { job }, owner)
  assert.equal(unloaded.work.kind, 'unavailable', 'missing context is distinct from a verified empty active appointment result')
  assert.equal(unloaded.primary?.key, 'open_job', 'the unverified context only offers the existing read path')
  assert.equal(unloaded.work.startsAt, null)
})

test('a current appointment wins over stale job timestamps and closed appointments do not reopen', () => {
  const job = { id: jobId, status: 'scheduled', ...window }
  const state = estimateActionState({ status: 'accepted', job_id: jobId }, { job, appointment: { id: 'appointment-1', status: 'confirmed', starts_at: '2040-03-13T14:00:00Z', ends_at: '2040-03-13T16:00:00Z' } }, owner)
  assert.equal(state.primary?.key, 'open_job')
  assert.equal(state.work.startsAt, '2040-03-13T14:00:00Z')
  for (const status of ['canceled', 'cancelled', 'no_show', 'completed']) {
    const closed = estimateActionState({ status: 'accepted', job_id: jobId }, { job, appointment: { status, starts_at: window.scheduled_start, ends_at: window.scheduled_end } }, owner)
    assert.equal(closed.work.kind, 'needs_scheduling', status)
    assert.equal(closed.primary?.key, 'schedule_job', status)
  }
})

test('completed, canceled, and in-progress work preserves its job action', () => {
  for (const [status, kind] of [['completed', 'completed'], ['canceled', 'canceled'], ['in_progress', 'in_progress']]) {
    const state = estimateActionState({ status: 'accepted', job_id: jobId }, { job: { id: jobId, status, ...window } }, owner)
    assert.equal(state.work.kind, kind)
    assert.equal(state.primary?.key, 'open_job')
  }
})

test('an existing document schedule or live invitation is visible without issuing another booking', () => {
  for (const status of ['scheduled', 'planned']) {
    const state = estimateActionState({ status: 'accepted' }, { schedule: { id: 'schedule-1', status, scheduled_start_time: window.scheduled_start, scheduled_end_time: window.scheduled_end } }, owner)
    assert.equal(state.primary?.key, 'open_schedule')
    assert.equal(state.work.kind, status === 'planned' ? 'planned' : 'scheduled')
  }
  const now = new Date('2040-03-01T00:00:00Z')
  const invitation = { id: 'offer-1', status: 'approved', expires_at: '2040-03-02T00:00:00Z' }
  const pending = estimateActionState({ status: 'accepted' }, { invitation }, owner, now)
  assert.equal(pending.work.kind, 'pending_invitation')
  assert.equal(pending.primary?.key, 'schedule_job', 'the scheduling dialog reviews existing options before replacing them')
  for (const status of ['revoked', 'paused', 'expired', 'booked']) assert.equal(estimateActionState({ status: 'accepted' }, { invitation: { ...invitation, status } }, owner, now).primary?.key, 'schedule_job')
  assert.equal(estimateActionState({ status: 'accepted' }, { invitation }, owner, new Date(invitation.expires_at)).primary?.key, 'schedule_job')
})

test('roles and scheduling entitlements are honored without a hard-coded Pro gate for manual booking', () => {
  for (const status of ['draft', 'sent', 'expired', 'declined', 'accepted']) assert.equal(estimateActionState({ status }, {}, viewer).primary, null, status)
  const noBookingAllowance = { ...owner, canSchedule: false }
  assert.equal(estimateActionState({ status: 'accepted' }, {}, noBookingAllowance).primary, null)
  assert.equal(estimateActionState({ status: 'accepted' }, {}, owner).primary?.key, 'schedule_job', 'existing Free/Individual manual booking permission is supplied by the caller')
  assert.equal(estimateActionState({ status: 'converted' }, { final_invoice_id: 'invoice-1' }, { ...owner, canOpenInvoice: false }).primary, null)
  assert.equal(estimateActionState({ status: 'accepted', job_id: jobId }, { job: { id: jobId, status: 'scheduled', ...window } }, { ...owner, canOpenJob: false }).primary, null)
})

test('revision eligibility is separate from the quiet declined action and current approvals', () => {
  assert.equal(estimateActionState({ status: 'declined' }, {}, owner).canRevise, true)
  assert.equal(estimateActionState({ status: 'declined' }, {}, owner).primary, null)
  assert.equal(estimateActionState({ status: 'expired' }, {}, owner).canRevise, true)
  assert.equal(estimateActionState({ status: 'sent', expires_on: '2026-11-08' }, { timezone: 'UTC' }, owner, new Date('2026-11-09T00:00:00Z')).canRevise, true)
  assert.equal(estimateActionState({ status: 'sent', expires_on: '2026-11-08' }, { timezone: 'UTC' }, owner, new Date('2026-11-08T23:59:59Z')).canRevise, false)
  assert.equal(estimateActionState({ status: 'accepted', expires_on: '2026-11-08' }, { timezone: 'UTC' }, owner, new Date('2026-11-09T00:00:00Z')).canRevise, false)
  assert.equal(estimateActionState({ status: 'expired' }, {}, viewer).canRevise, false)
})

test('invalid schedule ranges do not advertise booked work', () => {
  assert.equal(estimateWorkState({ status: 'accepted' }, { schedule: { status: 'scheduled', scheduled_start_time: 'bad' } }).kind, 'needs_scheduling')
  assert.equal(estimateWorkState({ status: 'accepted', job_id: jobId }, { job: { id: jobId, status: 'scheduled', ...window, scheduled_end: window.scheduled_start }, appointment: null }).kind, 'needs_scheduling')
  assert.equal(estimateWorkState({ status: 'accepted', job_id: jobId }, { job: { id: jobId, status: 'scheduled', ...window }, appointment: { status: 'confirmed', starts_at: 'bad' } }).kind, 'needs_scheduling', 'a malformed active row cannot prove a booking')
})
