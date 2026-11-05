import test from 'node:test'
import assert from 'node:assert/strict'
import { jobNeedsStatusUpdate, jobStatusConfirmation, jobStatusNotice, nextJobAction } from '../../src/lib/jobActions'

test('field staff can start and finish work while scheduling remains an office action', () => {
  const unscheduled = { status: 'lead', scheduled_start: null }
  assert.equal(nextJobAction(unscheduled, true, true), 'schedule')
  assert.equal(nextJobAction(unscheduled, true, false), null)
  assert.equal(nextJobAction({ status: 'scheduled', scheduled_start: '2026-11-05T10:00:00Z' }, true, false), 'start')
  assert.equal(nextJobAction({ status: 'in_progress', scheduled_start: null }, true, false), 'complete')
  for (const status of ['lead', 'scheduled', 'in_progress', 'completed', 'canceled']) {
    assert.equal(nextJobAction({ status, scheduled_start: '2026-11-05T10:00:00Z' }, false, true), null)
  }
  for (const status of ['completed', 'canceled']) assert.equal(nextJobAction({ status, scheduled_start: null }, true, true), null)
})

test('unfinished appointments need attention after their end, without flagging ongoing multi-day work or history', () => {
  const now = new Date('2026-11-05T17:00:00Z')
  const old = { status: 'scheduled', scheduled_start: '2026-11-04T15:00:00Z', scheduled_end: '2026-11-04T17:00:00Z' }
  assert.equal(jobNeedsStatusUpdate(old, now, 'America/New_York'), true)
  assert.equal(jobNeedsStatusUpdate({ ...old, status: 'in_progress', scheduled_end: '2026-11-06T17:00:00Z' }, now, 'America/New_York'), false)
  for (const status of ['completed', 'canceled']) assert.equal(jobNeedsStatusUpdate({ ...old, status }, now, 'America/New_York'), false)
  assert.equal(jobNeedsStatusUpdate({ ...old, scheduled_start: 'bad', scheduled_end: null }, now, 'America/New_York'), false)
})

test('appointments without an end use the business day, including daylight-saving changes', () => {
  const now = new Date('2026-11-02T04:30:00Z') // Still November 1 in New York after the DST change.
  const job = { status: 'scheduled', scheduled_start: '2026-11-01T10:00:00Z', scheduled_end: null }
  assert.equal(jobNeedsStatusUpdate(job, now, 'America/New_York'), false)
  assert.equal(jobNeedsStatusUpdate(job, now, 'UTC'), true)
  assert.equal(jobNeedsStatusUpdate({ ...job, scheduled_start: '2026-10-31T10:00:00Z' }, now, 'America/New_York'), true)
})

test('completion and cancellation retain confirmations and explain the invoice handoff', () => {
  assert.match(jobStatusConfirmation('completed')!, /office review; nothing is sent/)
  assert.match(jobStatusConfirmation('canceled')!, /remains in history/)
  assert.equal(jobStatusConfirmation('in_progress'), null)
  assert.match(jobStatusNotice('completed', { invoice_ready: true, needs_pricing: false }), /draft.*nothing was sent/)
  assert.match(jobStatusNotice('completed', { invoice_ready: false, needs_pricing: true }), /Add the charges/)
})
