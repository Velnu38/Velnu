import { DateTime } from 'luxon'
import type { WorkbookLine } from './workbookTypes.js'
export type FinancialPeriod = 1 | 3 | 6 | 12
export type FinancialBucket = { key: string; label: string; fullLabel: string; from: string; to: string; income: number; expenses: number }

export function financialRange(months: FinancialPeriod, day: string, zone: string) {
  const now = DateTime.fromISO(day, { zone })
  const start = now.startOf('month').minus({ months: months - 1 })
  const end = now.startOf('month').plus({ months: 1 })
  return { from: start.toISODate()!, to: end.toISODate()!, timezone: zone, label: months === 1 ? start.toFormat('MMMM yyyy') : `${start.toFormat('MMM yyyy')} – ${end.minus({ days: 1 }).toFormat('MMM yyyy')}` }
}
export function financialTotals(rows: WorkbookLine[]) {
  let income = 0, expenses = 0
  for (const row of rows) {
    if (row.currency !== 'USD') continue
    // Sum integer cents so the expanded entries reconcile to the displayed totals.
    if (row.direction === 'income') income += Math.round(row.amount * 100)
    else expenses += Math.round(row.amount * 100)
  }
  return { income: income / 100, expenses: expenses / 100, net: (income - expenses) / 100 }
}
export function financialBuckets(rows: WorkbookLine[], months: FinancialPeriod, day: string, zone: string): FinancialBucket[] {
  const range = financialRange(months, day, zone)
  const start = DateTime.fromISO(range.from, { zone })
  const count = months === 1 ? start.daysInMonth! : months
  const buckets = Array.from({ length: count }, (_, index) => {
    const from = start.plus(months === 1 ? { days: index } : { months: index })
    const to = from.plus(months === 1 ? { days: 1 } : { months: 1 })
    return { key: months === 1 ? from.toISODate()! : from.toFormat('yyyy-MM'), label: months === 1 ? from.toFormat('d') : from.toFormat('MMM'), fullLabel: from.toFormat(months === 1 ? 'MMMM d, yyyy' : 'MMMM yyyy'), from: from.toISODate()!, to: to.toISODate()!, income: 0, expenses: 0 }
  })
  const index = new Map(buckets.map(bucket => [bucket.key, bucket]))
  for (const row of rows) {
    const bucket = index.get(row.entry_date.slice(0, months === 1 ? 10 : 7))
    if (!bucket || row.currency !== 'USD') continue
    if (row.direction === 'income') bucket.income += Math.round(row.amount * 100)
    else bucket.expenses += Math.round(row.amount * 100)
  }
  for (const bucket of buckets) { bucket.income /= 100; bucket.expenses /= 100 }
  return buckets
}
