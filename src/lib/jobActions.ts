import { DateTime } from 'luxon'

export type JobStatus = 'lead' | 'scheduled' | 'in_progress' | 'completed' | 'canceled'
export const jobStatusLabels: Record<JobStatus, string> = {
  lead: 'Needs scheduling', scheduled: 'Scheduled', in_progress: 'In progress', completed: 'Completed', canceled: 'Canceled',
}
export type JobAppointment = { id: string; status: string; starts_at: string; ends_at: string | null }
export type JobInvoice = { id: string; status: string; number: string | null; balance_due?: number | string | null }
type JobActionRecord = { status: string; scheduled_start: string | null; scheduled_end?: string | null; active_appointment?: JobAppointment | null }

/** A retained job timestamp is not proof that an appointment is still active. */
export function hasActiveJobAppointment(job: JobActionRecord): boolean {
  const appointment = job.active_appointment
  if (!appointment || !['scheduled', 'confirmed', 'in_progress'].includes(appointment.status) || !job.scheduled_start) return false
  const start = Date.parse(appointment.starts_at), jobStart = Date.parse(job.scheduled_start)
  if (!Number.isFinite(start) || start !== jobStart) return false
  if (job.scheduled_end && appointment.ends_at && Date.parse(job.scheduled_end) !== Date.parse(appointment.ends_at)) return false
  return true
}

export function nextJobAction(job: JobActionRecord, canEdit: boolean, canDispatch: boolean): 'schedule' | 'start' | 'complete' | null {
  if (!canEdit || !['lead', 'scheduled', 'in_progress'].includes(job.status)) return null
  if (job.status === 'in_progress') return 'complete'
  if (!hasActiveJobAppointment(job)) return canDispatch ? 'schedule' : null
  return 'start'
}

/** Keep unfinished older appointments visible when Current is replaced by Active. */
export function jobNeedsStatusUpdate(job: JobActionRecord, now: Date, zone: string): boolean {
  if (!['scheduled', 'in_progress'].includes(job.status) || !job.scheduled_start) return false
  if ('active_appointment' in job && !hasActiveJobAppointment(job)) return false
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

export function jobStatusNotice(status: JobStatus, result?: { invoice_ready: boolean; needs_pricing: boolean; invoice_status?: string | null } | void): string {
  if (status !== 'completed') return `Job status updated to ${jobStatusLabels[status].toLowerCase()}.`
  if (result?.invoice_ready) return result.invoice_status === 'draft'
    ? 'Job completed. An invoice draft is ready for the office to review; nothing was sent.'
    : 'Job completed. The linked invoice is available for office review; nothing was sent.'
  if (result?.needs_pricing) return 'Job completed. Add the charges from the next-step prompt to prepare its invoice.'
  return 'Job completed. Its invoice needs an office review.'
}

export function jobInvoiceAction(result?: { job_id: string; invoice_id: string | null; needs_pricing: boolean } | void) {
  if (result?.invoice_id) return { label: 'Review invoice', href: '/?view=invoices&document=' + encodeURIComponent(result.invoice_id) }
  if (result?.needs_pricing) return { label: 'Add charges', href: '/?view=invoices&job=' + encodeURIComponent(result.job_id) }
  return null
}

export function linkedJobInvoiceAction(invoice: JobInvoice | null | undefined) {
  if (!invoice || invoice.status === 'void') return null
  return { label: invoice.status === 'draft' ? 'Review invoice' : 'View invoice', href: '/?view=invoices&document=' + encodeURIComponent(invoice.id) }
}
