import { useEffect, useRef, useState, type FormEvent } from 'react'
import { DateTime } from 'luxon'
import { canWrite, type CurrentBusiness } from '../lib/business'
import { canAccess, isPrimaryOwner } from '../lib/workspaceAccess'
import { getJob, saveJobNotes, updateJobStatus } from '../services/jobs'
import { getScheduleTeam, type Worker } from '../services/schedulingWorkflow'
import type { ReminderJob } from '../services/reminders'
import { jobStatusConfirmation, jobStatusLabels, jobStatusNotice, type JobStatus } from '../lib/jobActions'
import { formatServiceAddress } from '../lib/googleMaps'
import FormDialog from './FormDialog'
import PlanRestriction from './PlanRestriction'
import GoogleMapTools from './GoogleMapTools'
import RecordResources from './RecordResources'
import { useTierUsage } from '../lib/useTierUsage'
import DispatchJobDialog, { type JobScheduleMode } from './scheduling/DispatchJobDialog'

type Props = {
  business: CurrentBusiness
  jobId: string
  onClose: () => void
  onUpdated?: () => void
  onCreateReminder?: (job: ReminderJob) => void
}

export default function JobDetailsDialog({ business, jobId, onClose, onUpdated, onCreateReminder }: Props) {
  const [job, setJob] = useState<Awaited<ReturnType<typeof getJob>> | null>(null)
  const plan = useTierUsage(business.id)?.plan
  const teamScheduling = plan === 'pro'
  const [team, setTeam] = useState<Worker[] | null>(null)
  const [notes, setNotes] = useState(''), [error, setError] = useState('')
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const [dispatch, setDispatch] = useState<JobScheduleMode | null>(null), [notesVersion, setNotesVersion] = useState(0)
  const saving = useRef(false)
  const canEdit = canWrite(business.role) && canAccess(business, 'jobs')
  const canDispatch = ['owner', 'admin', 'office'].includes(business.role) && canAccess(business, 'jobs') && canAccess(business, 'calendar')
  const canChangeSchedule = canDispatch && job && !['completed', 'canceled'].includes(job.status)
  const zone = business.timezone || 'UTC'

  useEffect(() => {
    let active = true
    void getJob(business.id, jobId).then(row => {
      if (active) { setJob(row); setNotes(row.description || '') }
    }).catch(() => { if (active) setError('Unable to load this job. Close and try again.') })
    void getScheduleTeam(business.id).then(rows => { if (active) setTeam(rows) }).catch(() => {})
    return () => { active = false }
  }, [business.id, jobId])

  async function reloadAfterChange() {
    onUpdated?.()
    try {
      const fresh = await getJob(business.id, jobId)
      // Preserve the notes version used by the optimistic save guard, and the user's draft.
      setJob(current => current ? { ...fresh, description: current.description } : fresh)
    } catch {
      setError('The change was saved, but the updated job could not be loaded. Close and reopen the job to refresh it.')
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (saving.current || !canEdit || !job) return
    saving.current = true; setBusy(true); setError(''); setNotice('')
    try {
      await saveJobNotes(business.id, jobId, notes, job.description ?? null)
      setJob(current => current ? { ...current, description: notes.trim() || null } : current)
      setNotes(notes.trim()); setNotesVersion(value => value + 1)
      setNotice('Job details saved. The calendar and Jobs use this same record.')
      onUpdated?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save job notes. Your changes are still here; try again.')
    } finally { saving.current = false; setBusy(false) }
  }

  async function changeStatus(status: JobStatus) {
    if (saving.current || !canEdit || !job || status === job.status) return
    const confirmation = jobStatusConfirmation(status)
    if (confirmation && !window.confirm(confirmation)) return
    saving.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const result = await updateJobStatus(jobId, status)
      setJob(current => current ? { ...current, status } : current)
      setNotice(jobStatusNotice(status, result))
      await reloadAfterChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update the job status.')
    } finally { saving.current = false; setBusy(false) }
  }

  const crew = team?.filter(worker => job?.assigned_user_ids?.includes(worker.id)).map(worker => worker.label) || []
  const scheduled = (value: string) => DateTime.fromISO(value).setZone(zone).toFormat('MMM d, yyyy · h:mm a')
  return <>
    <FormDialog label="Job details" cleanVersion={notesVersion} busy={busy} onClose={onClose} wide autoFocusFields={false}>
      <div className="record-resources-head"><h2>{job?.title || 'Job details'}</h2><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Close</button></div>
      {error && <p role="alert">{error}</p>}
      {!job && !error && <p role="status">Loading job details…</p>}
      {job && <>
        <p>{job.customers.map(c => [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company).join(', ')}</p>
        <dl className="job-details-summary">
          <div><dt>Status</dt><dd>{jobStatusLabels[job.status as JobStatus] || job.status.replaceAll('_', ' ')}</dd></div>
          <div><dt>Appointment</dt><dd>{job.status === 'canceled' ? 'Canceled' : job.scheduled_start ? scheduled(job.scheduled_start) : 'Not booked'}</dd></div>
          {job.scheduled_end && job.status !== 'canceled' && <div><dt>Ends</dt><dd>{scheduled(job.scheduled_end)}</dd></div>}
          {(teamScheduling || !!job.assigned_user_ids?.length) && <div><dt>Crew</dt><dd>{crew.length ? crew.join(', ') : job.assigned_user_ids?.length ? 'Crew details unavailable' : 'Not assigned'}</dd></div>}
        </dl>
        <p className="quiet">Times shown in {zone.replaceAll('_', ' ')}.</p>
        <p><strong>Service address</strong><br />{job.properties[0] ? formatServiceAddress(job.properties[0]) : 'No service address recorded. Confirm the address with your customer.'}</p>
        {job.properties[0] && <GoogleMapTools address={job.properties[0]} compact />}
        <div className="job-details-controls" data-editor-independent>
          {canEdit && <label>Change status<select aria-label={`Status for ${job.title}`} value={job.status} disabled={busy} onChange={event => void changeStatus(event.target.value as JobStatus)}>
            {(Object.entries(jobStatusLabels) as [JobStatus, string][]).map(([status, label]) => <option key={status} value={status} disabled={status === 'scheduled' && !job.scheduled_start}>{label}</option>)}
          </select></label>}
          {canChangeSchedule && <button type="button" className="secondary-button" disabled={busy} onClick={() => setDispatch('appointment')}>{job.scheduled_start ? 'Reschedule appointment' : 'Book appointment'}</button>}
          {canChangeSchedule && teamScheduling && <button type="button" className="secondary-button" disabled={busy} onClick={() => setDispatch('crew')}>Assign crew</button>}
          {onCreateReminder && canEdit && <button type="button" className="secondary-button" disabled={busy} onClick={() => onCreateReminder({ id: job.id, title: job.title, customer_id: job.customer_id })}>Add reminder</button>}
        </div>
        {canChangeSchedule && plan && !teamScheduling && <PlanRestriction plan={plan} required="pro" feature="Crew assignment" canUpgrade={isPrimaryOwner(business)} />}
        <form className="job-details-notes" data-unsaved={notes !== (job.description || '')} onSubmit={save}>
          <label>Job notes and materials needed<textarea value={notes} maxLength={4000} rows={7} disabled={busy || !canEdit} onChange={event => { setNotes(event.target.value); setNotice('') }} placeholder="Scope, materials to bring, access instructions, and updates…" /></label>
          {canEdit && <button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save job details'}</button>}
        </form>
        {notice && <p role="status">{notice}</p>}
        <details><summary>Photos and expenses</summary><RecordResources business={business} target={{ kind: 'job', id: jobId }} /></details>
      </>}
    </FormDialog>
    {dispatch && job && <DispatchJobDialog key={dispatch} business={business} job={job} mode={dispatch} onReschedule={() => setDispatch('appointment')} onClose={() => setDispatch(null)} onSaved={() => {
      setNotice(dispatch === 'crew' ? 'Crew saved.' : 'Appointment saved. Confirm the time with your customer.')
      setError(''); void reloadAfterChange()
    }} />}
  </>
}
