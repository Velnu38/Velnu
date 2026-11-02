import { DateTime } from 'luxon'
import type { AgendaWork } from './calendarTypes.js'
export type CalendarView = 'week' | 'month'

/** Local calendar arithmetic keeps week/month boundaries correct across DST. */
export function calendarRange(day: string, zone: string, view: CalendarView) {
  const selected = DateTime.fromISO(day, { zone })
  if (!selected.isValid || selected.toISODate() !== day) throw new Error('Choose a valid calendar date.')
  const start = view === 'week' ? selected.startOf('week') : selected.startOf('month').startOf('week')
  const end = view === 'week' ? start.plus({ weeks: 1 }) : selected.endOf('month').startOf('week').plus({ weeks: 1 })
  return { start, end, days: Array.from({ length: Math.round(end.diff(start, 'days').days) }, (_, index) => start.plus({ days: index })) }
}
export function workOnDay(work: AgendaWork[], day: string, zone: string) {
  const from = DateTime.fromISO(day, { zone }).startOf('day').toMillis()
  const to = DateTime.fromISO(day, { zone }).startOf('day').plus({ days: 1 }).toMillis()
  return work.filter(item => {
    const start = DateTime.fromISO(item.starts_at).toMillis()
    return start < to && (item.ends_at ? DateTime.fromISO(item.ends_at).toMillis() > from : start >= from)
  }).sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.source_key.localeCompare(b.source_key))
}
