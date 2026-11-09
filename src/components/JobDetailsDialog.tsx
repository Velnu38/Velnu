import JobWorkPlan from './JobWorkPlan'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { DateTime } from 'luxon'
import { canWrite, type CurrentBusiness } from '../lib/business'
import { canAccess, isPrimaryOwner } from '../lib/workspaceAccess'
import { getJob, reopenJob, saveJobNotes, updateJobStatus } from '../services/jobs'
import { completeJob, getScheduleTeam, type Worker } from '../services/schedulingWorkflow'
import type { ReminderJob } from '../services/reminders'
import { createReminder } from '../services/reminders'
import { hasActiveJobAppointment, jobInvoiceAction, jobStatusConfirmation, jobStatusLabels, jobStatusNotice, linkedJobInvoiceAction, nextJobAction, type JobStatus } from '../lib/jobActions'
import { formatServiceAddress } from '../lib/googleMaps'
import FormDialog from './FormDialog'
import PlanRestriction from './PlanRestriction'
import GoogleMapTools from './GoogleMapTools'
import GoogleReviewRequest from './GoogleReviewRequest'
import RecordResources from './RecordResources'
import { useTierUsage } from '../lib/useTierUsage'
import { useBusinessRefresh } from '../lib/useBusinessRefresh'
import DispatchJobDialog, { type JobScheduleMode } from './scheduling/DispatchJobDialog'
import { RecordDetailHeader, RecordTabs, RecordActionBar } from './RecordDetail'
import { localInstant } from '../lib/calendarTime'

type Props = {
  business: CurrentBusiness
  jobId: string
  initialPhotos?: boolean
  initialSchedule?: boolean
  onClose: () => void
  onUpdated?: () => void
  onCreateReminder?: (job: ReminderJob) => void
}

export default function JobDetailsDialog({ business, jobId, initialPhotos = false, initialSchedule = false, onClose, onUpdated, onCreateReminder }: Props) {
  const [job, setJob] = useState<Awaited<ReturnType<typeof getJob>> | null>(null)
  const plan = useTierUsage(business.id)?.plan
  const teamScheduling = plan === 'pro' || plan === 'basic'
  const [team, setTeam] = useState<Worker[] | null>(null)
  const [notes, setNotes] = useState(''), [error, setError] = useState('')
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const [dispatch, setDispatch] = useState<JobScheduleMode | null>(null), [notesVersion, setNotesVersion] = useState(0)
  const [panel, setPanel] = useState<'details' | 'plan' | 'photos' | 'activity'>(initialPhotos ? 'photos' : 'details')
  const [planOpened,setPlanOpened]=useState(false)
  const [photosOpened, setPhotosOpened] = useState(initialPhotos)
  const tabsId = useId()
  const scheduleIntent = useRef(initialSchedule)
  const reopenRequest = useRef(crypto.randomUUID())
  const reminderRequest = useRef<{signature:string;id:string}|null>(null)
  const [showReminder, setShowReminder] = useState(false), [reminderAt, setReminderAt] = useState(''), [reminderNote, setReminderNote] = useState('')
  const [reminderError, setReminderError] = useState('')
  const saving = useRef(false)
  const request = useRef(0)
  const recordKey = useRef(business.id + ':' + jobId)
  const currentJob = useRef(job), currentNotes = useRef(notes)
  recordKey.current = business.id + ':' + jobId
  currentJob.current = job; currentNotes.current = notes
  const canEdit = canWrite(business.role) && canAccess(business, 'jobs')
  const canDispatch = ['owner', 'admin', 'office'].includes(business.role) && canAccess(business, 'jobs') && canAccess(business, 'calendar')
  const dispatchPermission = useRef(canDispatch)
  dispatchPermission.current = canDispatch
  const canChangeSchedule = canDispatch && job && !['completed', 'canceled'].includes(job.status)
  const canInvoice = ['owner', 'admin', 'office'].includes(business.role) && canAccess(business, 'billing')
  const canRemind = canEdit && canAccess(business, 'calendar')
  const zone = business.timezone || 'UTC'

  useEffect(() => {
    let active = true
    const current = ++request.current
    setJob(null); setNotes(''); setTeam(null); setError(''); setNotice('')
    reopenRequest.current = crypto.randomUUID(); reminderRequest.current = null; setShowReminder(false)
    void getJob(business.id, jobId).then(row => {
      if (active && current === request.current) {
        setJob(row); setNotes(row.description || '')
        if (scheduleIntent.current && dispatchPermission.current && !['completed', 'canceled'].includes(row.status)) setDispatch('appointment')
        scheduleIntent.current = false
      }
    }).catch(() => { if (active && current === request.current) setError('Unable to load this job. Close and try again.') })
    void getScheduleTeam(business.id).then(rows => { if (active) setTeam(rows) }).catch(() => {})
    return () => { active = false; request.current++ }
  }, [business.id, jobId])

  async function refreshJob(afterChange = false) {
    const current = ++request.current, key = business.id + ':' + jobId
    try {
      const fresh = await getJob(business.id, jobId)
      if (current !== request.current || key !== recordKey.current) return
      // Preserve the notes version used by the optimistic save guard, and the user's draft.
      const previous = currentJob.current, dirty = previous && currentNotes.current !== (previous.description || '')
      if (!dirty) { setNotes(fresh.description || ''); setNotesVersion(value => value + 1) }
      setJob(dirty ? { ...fresh, description: previous.description } : fresh)
    } catch {
      if (afterChange && current === request.current && key === recordKey.current) setError('The change was saved, but the updated job could not be loaded. Close and reopen the job to refresh it.')
    }
  }
  useBusinessRefresh(business.id, () => { if (job?.id === jobId && !saving.current) return refreshJob() })
  async function reloadAfterChange() { onUpdated?.(); await refreshJob(true) }

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

  const [invoiceAction, setInvoiceAction] = useState<ReturnType<typeof jobInvoiceAction>>(null)

  async function changeStatus(status: JobStatus) {
    if (saving.current || !canEdit || !job || status === job.status) return
    const confirmation = jobStatusConfirmation(status)
    if (confirmation && !window.confirm(confirmation)) return
    saving.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const result = await updateJobStatus(jobId, status)
      setJob(current => current ? { ...current, status } : current)
      setNotice(jobStatusNotice(status, result))
      setInvoiceAction(jobInvoiceAction(result))
      await reloadAfterChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update the job status.')
    } finally { saving.current = false; setBusy(false) }
  }

  async function reopen() {
    if (saving.current || !job || !canDispatch || !['completed', 'canceled'].includes(job.status)) return
    if (!window.confirm('Reopen this job to arrange more work? Review and save its appointment next. Previous appointments and invoices remain in your records; no customer message is sent.')) return
    saving.current = true; setBusy(true); setError(''); setNotice('')
    try {
      await reopenJob(job.id, reopenRequest.current)
      reopenRequest.current = crypto.randomUUID()
      await reloadAfterChange()
      setNotice('Job reopened. Review and save its appointment; no customer message was sent.')
      setDispatch('appointment')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to reopen the job. Refresh before trying again.') }
    finally { saving.current = false; setBusy(false) }
  }

  async function prepareInvoice() {
    if (saving.current || !job || !canInvoice) return
    saving.current = true; setBusy(true); setError('')
    try {
      const result = await completeJob(job.id, true)
      setInvoiceAction(jobInvoiceAction(result)); setNotice(jobStatusNotice('completed', result))
      await reloadAfterChange()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to prepare the invoice.') }
    finally { saving.current = false; setBusy(false) }
  }

  function addReminder() {
    if (!job) return
    if (onCreateReminder) { onCreateReminder({ id: job.id, title: job.title, customer_id: job.customer_id }); return }
    setReminderNote('Follow up on ' + job.title); setReminderAt(''); setReminderError(''); setShowReminder(true)
  }
  async function saveReminder(event: FormEvent) {
    event.preventDefault()
    if (saving.current || !job || !canRemind) return
    saving.current = true; setBusy(true); setReminderError('')
    try {
      const dueAt = localInstant(reminderAt, zone), signature = JSON.stringify({jobId, dueAt, reminderNote})
      if (reminderRequest.current?.signature !== signature) reminderRequest.current = {signature, id: crypto.randomUUID()}
      await createReminder(business, {id: reminderRequest.current.id, jobId, customerId: job.customer_id, note: reminderNote, dueAt})
      reminderRequest.current = null; setShowReminder(false); setNotice('Reminder saved for this job.')
    } catch (e) { setReminderError(e instanceof Error ? e.message : 'Unable to save the reminder.') }
    finally { saving.current = false; setBusy(false) }
  }

  const crew = team?.filter(worker => job?.assigned_user_ids?.includes(worker.id)).map(worker => worker.label) || []
  const scheduled = (value: string) => DateTime.fromISO(value).setZone(zone).toFormat('MMM d, yyyy · h:mm a')
  function selectPanel(next: 'details' | 'plan' | 'photos' | 'activity') {
    setPanel(next)
    if (next === 'plan') setPlanOpened(true)
    if (next === 'photos') setPhotosOpened(true)
  }
  const dirty = !!job && notes !== (job.description || '')
  const booked = !!job && hasActiveJobAppointment(job)
  const action = job && nextJobAction(job, canEdit, canDispatch)
  const linkedInvoice = canInvoice ? linkedJobInvoiceAction(job?.invoice) : null
  const closed = !!job && ['completed','canceled'].includes(job.status)
  const canCancel = canEdit && !!job && !closed
  const canReopen = canDispatch && closed
  const canRequestReview = job?.status === 'completed' && ['owner','admin','office'].includes(business.role) && canEdit && !!plan
  const hasMoreActions = !!job && (canRemind || canCancel || canReopen || canRequestReview ||
    (canChangeSchedule && (action !== 'schedule' || teamScheduling)) ||
    (linkedInvoice && job.status !== 'completed') || (job.status === 'completed' && canInvoice && !linkedInvoice))
  const primary = action ? <button type="button" className="primary-button" disabled={busy} onClick={() => action === 'schedule' ? setDispatch('appointment') : void changeStatus(action === 'start' ? 'in_progress' : 'completed')}>
    {action === 'schedule' ? 'Schedule job' : action === 'start' ? 'Start job' : 'Mark complete'}
  </button> : job?.status === 'completed' && linkedInvoice ? <a className="primary-button" href={linkedInvoice.href}>{linkedInvoice.label}</a> : null
  const tab = (id: string) => tabsId + '-' + id
  return <>
    <FormDialog label="Job details" cleanVersion={notesVersion} busy={busy} onClose={onClose} wide autoFocusFields={false}>
      <RecordDetailHeader title={job?.title || 'Job details'} eyebrow="Job" subtitle={job ? job.customers.map(c => [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company).join(', ') : business.name}
        status={job ? jobStatusLabels[job.status as JobStatus] || job.status.replaceAll('_', ' ') : undefined}>
        <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Close</button>
      </RecordDetailHeader>
      {error && <p role="alert">{error}</p>}
      {!job && !error && <p role="status">Loading job details…</p>}
      {job && <>
        <RecordActionBar primary={primary} disabled={busy} more={hasMoreActions ? <>
          {canChangeSchedule && action !== 'schedule' && <button type="button" disabled={busy} onClick={() => setDispatch('appointment')}>{booked ? 'Reschedule appointment' : 'Schedule job'}</button>}
          {canChangeSchedule && teamScheduling && <button type="button" disabled={busy} onClick={() => setDispatch('crew')}>Assign crew</button>}
          {canRemind && <button type="button" disabled={busy} onClick={addReminder}>Add reminder</button>}
          {linkedInvoice && job.status !== 'completed' && <a href={linkedInvoice.href}>{linkedInvoice.label}</a>}
          {job.status === 'completed' && canInvoice && !linkedInvoice && (job.source_estimate_id
            ? <button type="button" disabled={busy} onClick={() => void prepareInvoice()}>Prepare invoice</button>
            : <a href={'/?view=invoices&job=' + encodeURIComponent(job.id)}>Add charges &amp; invoice</a>)}
          {canRequestReview && plan && <GoogleReviewRequest business={business} plan={plan} customer={job.customers[0]} />}
          {canCancel && <button type="button" className="danger-action" disabled={busy} onClick={() => void changeStatus('canceled')}>Cancel job</button>}
          {canReopen && <button type="button" disabled={busy} onClick={() => void reopen()}>Reopen job</button>}
        </> : undefined} />
        {notice && <p role="status">{notice} {invoiceAction && canInvoice && !linkedInvoice && <a href={invoiceAction.href}>{invoiceAction.label}</a>}</p>}
        <RecordTabs label="Job sections" tabs={[{id:tab('details'),label:'Details'},{id:tab('plan'),label:'Work plan'},{id:tab('photos'),label:'Photos & expenses'},{id:tab('activity'),label:'Activity'}]}
          active={tab(panel)} onChange={id => selectPanel(id === tab('plan') ? 'plan' : id === tab('photos') ? 'photos' : id === tab('activity') ? 'activity' : 'details')} />
        {planOpened&&<div hidden={panel!=='plan'} role="tabpanel" id={tab('plan')+'-panel'} aria-labelledby={tab('plan')+'-tab'}><JobWorkPlan business={business} jobId={job.id} team={team} canEdit={canEdit} closed={closed}/></div>}
        <div role="tabpanel" id={tab('details')+'-panel'} aria-labelledby={tab('details')+'-tab'} hidden={panel!=='details'}>
        <dl className="job-details-summary">
          <div><dt>Status</dt><dd>{jobStatusLabels[job.status as JobStatus] || job.status.replaceAll('_', ' ')}</dd></div>
          <div><dt>Appointment</dt><dd>{job.status === 'canceled' ? 'Canceled' : booked ? scheduled(job.active_appointment!.starts_at) : job.status === 'completed' && job.scheduled_start ? scheduled(job.scheduled_start) + ' · past appointment' : 'Not booked'}</dd></div>
          {booked && job.active_appointment?.ends_at && <div><dt>Ends</dt><dd>{scheduled(job.active_appointment.ends_at)}</dd></div>}
          {(teamScheduling || !!job.assigned_user_ids?.length) && <div><dt>Crew</dt><dd>{crew.length ? crew.join(', ') : job.assigned_user_ids?.length ? 'Crew details unavailable' : 'Not assigned'}</dd></div>}
        </dl>
        {canInvoice && job.invoice && <p><strong>Invoice</strong> · <a href={linkedInvoice?.href}>{job.invoice.number || 'Invoice'}</a> · {job.invoice.status.replaceAll('_',' ')}</p>}
        {job.status === 'completed' && !job.invoice && canInvoice && <p className="quiet">Work is complete. Use More to prepare an invoice or add the charges.</p>}
        {['completed','canceled'].includes(job.status) && <p className="quiet">This job is in history. Its earlier appointments and financial records stay linked.</p>}
        <p className="quiet">Times shown in {zone.replaceAll('_', ' ')}.</p>
        <p><strong>Service address</strong><br />{job.properties[0] ? formatServiceAddress(job.properties[0]) : 'No service address recorded. Confirm the address with your customer.'}</p>
        {job.properties[0] && <GoogleMapTools address={job.properties[0]} compact />}
        {canChangeSchedule && plan && !teamScheduling && <PlanRestriction plan={plan} required="basic" feature="Crew assignment" canUpgrade={isPrimaryOwner(business)} />}
        <form className="job-details-notes" data-unsaved={dirty} onSubmit={save}>
          <label>Job notes and materials needed<textarea value={notes} maxLength={4000} rows={7} disabled={busy || !canEdit} onChange={event => { setNotes(event.target.value); setNotice('') }} placeholder="Scope, materials to bring, access instructions, and updates…" /></label>
          {canEdit && dirty && <button className="secondary-button" disabled={busy}>{busy ? 'Saving…' : 'Save job details'}</button>}
        </form>
        </div>
        <div role="tabpanel" id={tab('photos')+'-panel'} aria-labelledby={tab('photos')+'-tab'} hidden={panel!=='photos'}>
          {photosOpened && <RecordResources key={business.id+':'+jobId} business={business} target={{ kind: 'job', id: jobId }} active={panel==='photos'} />}
        </div>
        <div role="tabpanel" id={tab('activity')+'-panel'} aria-labelledby={tab('activity')+'-tab'} hidden={panel!=='activity'}>{panel==='activity'&&<JobWorkPlan business={business} jobId={job.id} team={team} canEdit={canEdit} closed={closed} activityOnly/>}
          <h3>Activity</h3><dl className="job-details-summary">
            {job.created_at && <div><dt>Job created</dt><dd>{scheduled(job.created_at)}</dd></div>}
            {job.completed_at && <div><dt>Work completed</dt><dd>{scheduled(job.completed_at)}</dd></div>}
            {job.updated_at && <div><dt>Last updated</dt><dd>{scheduled(job.updated_at)}</dd></div>}
            {job.active_appointment && <div><dt>Current appointment</dt><dd>{scheduled(job.active_appointment.starts_at)} · {job.active_appointment.status.replaceAll('_',' ')}</dd></div>}
          </dl>
          {linkedInvoice && <p><a href={linkedInvoice.href}>{linkedInvoice.label}</a>{job.invoice?.number ? ' · ' + job.invoice.number : ''} · {job.invoice?.status.replaceAll('_',' ')}</p>}
        </div>
      </>}
    </FormDialog>
    {dispatch && job && <DispatchJobDialog key={dispatch} business={business} job={job} needsAppointmentRepair={!hasActiveJobAppointment(job)} mode={dispatch} onReschedule={() => setDispatch('appointment')} onClose={() => setDispatch(null)} onSaved={() => {
      setNotice(dispatch === 'crew' ? 'Crew saved.' : 'Appointment saved. Confirm the time with your customer.')
      setError(''); void reloadAfterChange()
    }} />}
    {showReminder && <FormDialog label="Add job reminder" busy={busy} onClose={() => setShowReminder(false)}>
      <header className="modal-head"><h2>Add reminder</h2><button type="button" className="icon-button" aria-label="Close reminder" disabled={busy} onClick={() => setShowReminder(false)}>×</button></header>
      <form className="form-grid" onSubmit={saveReminder}>
        <label className="full">Remind me at ({zone})<input type="datetime-local" required value={reminderAt} disabled={busy} onChange={event => setReminderAt(event.target.value)} /></label>
        <label className="full">Reminder note<textarea required maxLength={2000} value={reminderNote} disabled={busy} onChange={event => setReminderNote(event.target.value)} /></label>
        {reminderError && <p role="alert" className="full">{reminderError}</p>}
        <div className="modal-actions full"><button type="button" className="secondary-button" disabled={busy} onClick={() => setShowReminder(false)}>Cancel</button><button className="primary-button" disabled={busy}>Save reminder</button></div>
      </form>
    </FormDialog>}
  </>
}
