import { validateScheduleWindow } from '../../src/lib/scheduleTime.ts'

function equal(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error('Expected ' + JSON.stringify(expected) + '; got ' + JSON.stringify(actual))
}
function rejects(start: string, end: string, message: string) {
  let caught: unknown
  try { validateScheduleWindow(start, end) } catch (error) { caught = error }
  if (!(caught instanceof Error)) throw new Error('Expected validation failure')
  equal(caught.message, message)
}

Deno.test('unit 01: missing start fails before any write', () => {
  rejects('', '', 'Choose a valid start time')
})
Deno.test('unit 02: non-date and malformed start are rejected', () => {
  rejects('not a date', '', 'Choose a valid start time')
  rejects('2026-06-01Txx:00', '', 'Choose a valid start time')
})
Deno.test('unit 03: impossible calendar dates cannot silently roll forward', () => {
  rejects('2026-02-30T10:00', '', 'Choose a valid start time')
})
Deno.test('unit 04: invalid end is rejected instead of silently omitted', () => {
  rejects('2026-11-03T10:00', 'wrong-end', 'End time must be after the start time')
})
Deno.test('unit 05: same start and end reject zero-duration appointment', () => {
  rejects('2026-11-03T10:00', '2026-11-03T10:00', 'End time must be after the start time')
})
Deno.test('unit 06: end before start is rejected', () => {
  rejects('2026-11-03T11:00', '2026-11-03T10:00', 'End time must be after the start time')
})
Deno.test('unit 07: optional end returns null without inventing duration', () => {
  const result = validateScheduleWindow('2026-11-03T10:00', '')
  equal(result.startsAt, new Date('2026-11-03T10:00').toISOString())
  equal(result.endsAt, null)
})
Deno.test('unit 08: a valid overnight window retains both instants', () => {
  const start = '2026-11-03T23:30'
  const end = '2026-11-04T00:30'
  const result = validateScheduleWindow(start, end)
  equal(result.startsAt, new Date(start).toISOString())
  equal(result.endsAt, new Date(end).toISOString())
})
