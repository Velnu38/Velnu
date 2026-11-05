import { DateTime } from 'luxon'

export type JobStatus = 'lead' | 'scheduled' | 'in_progress' | 'completed' | 'canceled'
export const jobStatusLabels: Record<JobStatus, string> = {
  lead: 'Needs scheduling', scheduled: 'Scheduled', in_progress: 'In progress', completed: 'Completed', canceled: 'Canceled',
}
type JobActionRecord = { status: string; scheduled_start: string | null; scheduled_end?: string | null }

export function nextJobAction(job: JobActionRecord, canEdit: boolean, canDispatch: boolean): 'schedule' | 'start' | 'complete' | null {
  if (!canEdit || !['lead', 'scheduled', 'in_progress'].includes(job.status)) return null
  if (job.status === 'in_progress') return 'complete'
  if (!job.scheduled_start) return canDispatch ? 'schedule' : null
  return 'start'
}

/** Keep unfinished older appointments visible when Current is replaced by Active. */
export function jobNeedsStatusUpdate(job: JobActionRecord, now: Date, zone: string): boolean {
  if (!['scheduled', 'in_progress'].includes(job.status) || !job.scheduled_start) return false
  const start = DateTime.fromISO(job.scheduled_start)
  if (!start.isValid || start.toMillis() > now.getTime()) return false
  const end = job.scheduled_end ? DateTime.fromISO(job.scheduled_end) : null
  if (end?.isValid) return end.toMillis() <= now.getTime()
  return start.toMillis() < DateTime.fromJSDate(now, { zone }).startOf('day').toMillis()
}

export function jobStatusConfirmation(status: JobStatus): string | null {
  if (status === 'completed') return 'Complete this job? Finviant will prepare its invoice for office review; nothing is sent.'
  if (status === 'canceled') return 'Cancel this job and remove its active schedule? The job remains in history.'
  return null
}

export function jobStatusNotice(status: JobStatus, result?: { invoice_ready: boolean; needs_pricing: boolean } | void): string {
  if (status !== 'completed') return `Job status updated to ${jobStatusLabels[status].toLowerCase()}.`
  if (result?.invoice_ready) return 'Job completed. An invoice draft is ready for the office to review; nothing was sent.'
  if (result?.needs_pricing) return 'Job completed. Add the charges from the next-step prompt to prepare its invoice.'
  return 'Job completed. Its invoice needs an office review.'
}
