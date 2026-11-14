import { DateTime } from 'luxon'

export const estimateStatuses = ['draft', 'sent', 'accepted', 'declined', 'expired', 'converted'] as const
export type EstimateStatus = typeof estimateStatuses[number]
export type EstimateActionRecord = {
  status: string
  expires_on?: string | null
  job_id?: string | null
}
type TimeRange = { starts_at: string; ends_at?: string | null }
export type EstimateWorkflowContext = {
  /** Loaded context includes the active appointment key, even when its value is null.
   * Callers that omit that key can explicitly mark the context loaded instead. */
  contextLoaded?: boolean
  job?: { id: string; status: string; scheduled_start?: string | null; scheduled_end?: string | null } | null
  appointment?: TimeRange & { id?: string; status: string } | null
  schedule?: { id?: string; status: string; scheduled_start_time: string; scheduled_end_time?: string | null } | null
  invitation?: { id?: string; status: string; expires_at?: string | null } | null
  final_invoice_id?: string | null
  timezone?: string | null
}
export type EstimateActionPermissions = {
  canManage: boolean
  canSchedule: boolean
  canOpenJob: boolean
  canOpenInvoice: boolean
}
export type EstimatePrimaryAction = {
  key: 'send' | 'follow_up' | 'schedule_job' | 'open_job' | 'open_invoice' | 'revise' | 'open_schedule'
  label: string
  jobId?: string
  invoiceId?: string
}
export type EstimateWorkState = {
  kind: 'none' | 'needs_scheduling' | 'scheduled' | 'in_progress' | 'completed' | 'canceled' | 'pending_invitation' | 'planned' | 'unavailable'
  label: string
  jobId: string | null
  startsAt: string | null
  endsAt: string | null
}

function validZone(zone?: string | null) {
  return zone && DateTime.fromMillis(0).setZone(zone).isValid ? zone : 'UTC'
}

/** The response deadline is the next local midnight, including a short/long DST day. */
export function estimateResponseDeadline(expiresOn?: string | null, zone?: string | null): string | null {
  if (!expiresOn || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return null
  const day = DateTime.fromISO(expiresOn, { zone: validZone(zone) })
  return day.isValid ? day.startOf('day').plus({ days: 1 }).toUTC().toISO() : null
}

export function estimateResponseExpired(estimate: Pick<EstimateActionRecord, 'expires_on'>, zone?: string | null, now = new Date()): boolean {
  const deadline = estimateResponseDeadline(estimate.expires_on, zone)
  return deadline !== null && Number.isFinite(now.getTime()) && now.getTime() >= Date.parse(deadline)
}

function range(start?: string | null, end?: string | null): { startsAt: string; endsAt: string | null } | null {
  if (!start || !Number.isFinite(Date.parse(start))) return null
  if (end && (!Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start))) return null
  return { startsAt: start, endsAt: end || null }
}

/** Operational truth stays separate from the estimate's approval/billing status. */
export function estimateWorkState(estimate: EstimateActionRecord, workflow: EstimateWorkflowContext = {}, now = new Date()): EstimateWorkState {
  const jobId = estimate.job_id || workflow.job?.id || null
  const job = workflow.job?.id === jobId ? workflow.job : null
  const state = (kind: EstimateWorkState['kind'], label: string, times?: { startsAt: string; endsAt: string | null } | null): EstimateWorkState => ({
    kind, label, jobId, startsAt: times?.startsAt || null, endsAt: times?.endsAt || null,
  })
  if (jobId && !job) return state('unavailable', 'Linked job details are unavailable')
  if (job) {
    if (job.status === 'completed') return state('completed', 'Work completed', range(job.scheduled_start, job.scheduled_end))
    if (job.status === 'canceled') return state('canceled', 'Job canceled')
    if (job.status === 'in_progress') return state('in_progress', 'Work in progress', range(job.scheduled_start, job.scheduled_end))
    const appointment = workflow.appointment
    if (appointment && ['scheduled', 'confirmed', 'in_progress'].includes(appointment.status)) {
      const times = range(appointment.starts_at, appointment.ends_at)
      if (times) return state('scheduled', 'Appointment booked', times)
    }
    const contextLoaded = workflow.contextLoaded ?? Object.prototype.hasOwnProperty.call(workflow, 'appointment')
    // Only the active appointment proves a booking. Job timestamps can remain
    // after cancellation or reopening and must never recreate that appointment.
    if (contextLoaded) return state('needs_scheduling', 'Job needs an active appointment')
    return state('unavailable', 'Active appointment details are not loaded')
  }
  const schedule = workflow.schedule
  const scheduleTimes = schedule && range(schedule.scheduled_start_time, schedule.scheduled_end_time)
  if (scheduleTimes && schedule?.status === 'scheduled') return state('scheduled', 'Existing document schedule', scheduleTimes)
  if (scheduleTimes && schedule?.status === 'planned') return state('planned', 'Planned appointment', scheduleTimes)
  const invitation = workflow.invitation
  const invitationDeadline = invitation?.expires_at ? Date.parse(invitation.expires_at) : NaN
  if (invitation?.status === 'approved' && Number.isFinite(invitationDeadline) && invitationDeadline > now.getTime()) return state('pending_invitation', 'Waiting for customer to choose a time')
  return ['accepted', 'converted'].includes(estimate.status) ? state('needs_scheduling', 'Work not scheduled') : state('none', 'No appointment booked')
}

/** This is presentation policy only; server checks still authorize each mutation. */
export function estimateActionState(estimate: EstimateActionRecord, workflow: EstimateWorkflowContext, permissions: EstimateActionPermissions, now = new Date()) {
  const knownStatus = estimateStatuses.includes(estimate.status as EstimateStatus)
  const deadlineExpired = estimateResponseExpired(estimate, workflow.timezone, now)
  const displayStatus = !knownStatus ? 'Unavailable' : estimate.status === 'draft' ? 'Draft'
    : estimate.status === 'sent' ? deadlineExpired ? 'Response expired' : 'Awaiting customer approval'
    : estimate.status === 'accepted' ? 'Approved' : estimate.status === 'converted' ? 'Invoiced'
    : estimate.status === 'declined' ? 'Declined' : 'Expired'
  const work = estimateWorkState(estimate, workflow, now)
  let primary: EstimatePrimaryAction | null = null
  if (knownStatus) {
    if (estimate.status === 'draft' && permissions.canManage) primary = { key: 'send', label: 'Send estimate' }
    else if (estimate.status === 'sent' && permissions.canManage) primary = { key: 'follow_up', label: 'Follow up' }
    else if (estimate.status === 'expired' && permissions.canManage) primary = { key: 'revise', label: 'Create revised draft' }
    else if (estimate.status === 'converted' && workflow.final_invoice_id && permissions.canOpenInvoice) primary = { key: 'open_invoice', label: 'Open invoice', invoiceId: workflow.final_invoice_id }
    else if (estimate.status === 'accepted') {
      if (work.jobId && ['scheduled', 'in_progress', 'completed', 'canceled', 'unavailable'].includes(work.kind) && permissions.canOpenJob) primary = { key: 'open_job', label: 'Open job', jobId: work.jobId }
      else if (!work.jobId && ['scheduled', 'planned'].includes(work.kind) && permissions.canSchedule) primary = { key: 'open_schedule', label: 'View schedule' }
      else if (['needs_scheduling', 'pending_invitation'].includes(work.kind) && permissions.canSchedule) primary = { key: 'schedule_job', label: 'Schedule job', ...(work.jobId ? { jobId: work.jobId } : {}) }
    }
  }
  const canRevise = permissions.canManage && (estimate.status === 'declined' || estimate.status === 'expired' || estimate.status === 'sent' && deadlineExpired)
  return { displayStatus, deadlineExpired, canRevise, work, primary }
}
