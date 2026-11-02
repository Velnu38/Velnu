import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calendarRange, workOnDay } from '../../src/lib/calendarView.js'
import { financialRange, financialBuckets, financialTotals } from '../../src/lib/dashboardFinance.js'
import type { WorkbookLine } from '../../src/services/bookkeeping.js'
const zone = 'America/New_York'
test('calendar week and month cross DST and leap dates using local midnights', () => {
  const week = calendarRange('2026-11-01', zone, 'week')
  assert.equal(week.start.toISODate(), '2026-10-26')
  assert.equal(week.end.toISODate(), '2026-11-02')
  assert.equal(week.end.diff(week.start, 'hours').hours, 169)
  const month = calendarRange('2028-02-29', zone, 'month')
  assert.equal(month.days.length % 7, 0)
  assert.ok(month.days.some(day => day.toISODate() === '2028-02-29'))
  assert.throws(() => calendarRange('2026-02-30', zone, 'month'))
})
test('multi-day events are shown on each overlapped day, excluding their exact end boundary', () => {
  const work = [{source_key:'job:1',title:'Overnight',description:'',starts_at:'2026-11-01T23:00:00-05:00',ends_at:'2026-11-03T00:00:00-05:00',document_kind:'work',document_id:'1',status:'scheduled'}]
  assert.equal(workOnDay(work,'2026-11-01',zone).length,1)
  assert.equal(workOnDay(work,'2026-11-02',zone).length,1)
  assert.equal(workOnDay(work,'2026-11-03',zone).length,0)
})
test('financial periods cross years and daily buckets include leap day; cents reconcile', () => {
  assert.equal(financialRange(3,'2027-01-04',zone).from,'2026-11-01')
  const rows = [
    {entry_date:'2028-02-29',direction:'income',amount:.1,currency:'USD'},
    {entry_date:'2028-02-29',direction:'income',amount:.2,currency:'USD'},
    {entry_date:'2028-02-29',direction:'expense',amount:.1,currency:'USD'},
    {entry_date:'2028-02-29',direction:'income',amount:100,currency:'EUR'},
  ] as WorkbookLine[]
  assert.deepEqual(financialTotals(rows),{income:.3,expenses:.1,net:.2})
  const days=financialBuckets(rows,1,'2028-02-29',zone)
  assert.equal(days.length,29);assert.equal(days.at(-1)?.income,.3)
  for (const n of [3,6,12] as const) assert.equal(financialBuckets(rows,n,'2028-02-29',zone).length,n)
})
