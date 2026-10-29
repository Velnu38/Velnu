export type JobGroup = 'current' | 'upcoming' | 'history'

/** Use the same local-day boundaries as the existing schedule. */
export function jobGroup(job: { status: string; scheduled_start: string | null }, now = new Date()): JobGroup {
  if (job.status === 'completed' || job.status === 'canceled') return 'history'
  if (job.status === 'in_progress' || !job.scheduled_start) return 'current'
  const tomorrow = new Date(now)
  tomorrow.setHours(0, 0, 0, 0)
  tomorrow.setDate(tomorrow.getDate() + 1)
  return new Date(job.scheduled_start).getTime() >= tomorrow.getTime() ? 'upcoming' : 'current'
}
