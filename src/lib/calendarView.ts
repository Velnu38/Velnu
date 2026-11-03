import { DateTime } from 'luxon'
import type { AgendaWork, AgendaReminder, ConnectedEvent } from './calendarTypes.js'
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

export function remindersOnDay(reminders: AgendaReminder[], day: string, zone: string) {
  return reminders.filter(item => DateTime.fromISO(item.due_at).setZone(zone).toISODate() === day)
}
export function connectedOnDay(events: ConnectedEvent[], day: string, zone: string) {
  const from = DateTime.fromISO(day, { zone }).startOf('day'), to = from.plus({ days: 1 })
  return events.filter(item => item.all_day && item.start_date && item.end_date
    ? item.start_date <= day && item.end_date > day
    : DateTime.fromISO(item.starts_at) < to && DateTime.fromISO(item.ends_at) > from)
    .sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id))
}
