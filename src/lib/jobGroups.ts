import { DateTime } from 'luxon'

export type JobGroup = 'current' | 'upcoming' | 'history'

/** Group dated work by the business day, including DST transitions. */
export function jobGroup(job: { status: string; scheduled_start: string | null }, now = new Date(), zone?: string): JobGroup {
  if (job.status === 'completed' || job.status === 'canceled') return 'history'
  if (job.status === 'in_progress' || !job.scheduled_start) return 'current'
  const tomorrow = DateTime.fromJSDate(now, { zone }).startOf('day').plus({ days: 1 })
  return new Date(job.scheduled_start).getTime() >= tomorrow.toMillis() ? 'upcoming' : 'current'
}
