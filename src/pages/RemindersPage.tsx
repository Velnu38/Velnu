import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { canWrite, type CurrentBusiness } from '../lib/business'
import { readableError } from '../lib/errors'
import { validateScheduleWindow } from '../lib/scheduleTime'
import { listJobs } from '../services/jobs'
import { completeWorkReminder, createReminder, listReminders, REMINDER_PAGE_SIZE, type ReminderJob, type WorkReminder } from '../services/reminders'

export default function RemindersPage({ business, initialJob }: { business: CurrentBusiness; initialJob?: ReminderJob }) {
  const [rows, setRows] = useState<WorkReminder[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<'pending' | 'completed'>('pending')
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [success, setSuccess] = useState('')
  const [showForm, setShowForm] = useState(!!initialJob && canWrite(business.role))
  const [form, setForm] = useState({ note: '', due: '', jobId: initialJob?.id || '' })
  const [jobs, setJobs] = useState<ReminderJob[]>(initialJob ? [initialJob] : [])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobsError, setJobsError] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [completing, setCompleting] = useState<string | null>(null)
  const saving = useRef(false)
  const completingRef = useRef(false)
  const retry = useRef<{ fingerprint: string; id: string } | null>(null)
  const requestId = useRef(0)
  const mounted = useRef(false)

  const refresh = useCallback(async () => {
    const request = ++requestId.current
    setLoading(true); setError('')
    try {
      const result = await listReminders(business.id, status, offset)
      if (!mounted.current || request !== requestId.current) return
      if (offset > 0 && result.total <= offset) { setOffset(Math.max(0, offset - REMINDER_PAGE_SIZE)); return }
      setRows(result.rows); setTotal(result.total)
    } catch (err) {
      if (mounted.current && request === requestId.current) setError(readableError(err, 'Unable to load reminders'))
    } finally {
      if (mounted.current && request === requestId.current) setLoading(false)
    }
  }, [business.id, status, offset])

  useEffect(() => {
    mounted.current = true
    setRows([]); setTotal(0)
    void refresh()
    return () => { mounted.current = false; requestId.current++ }
  }, [refresh])

  useEffect(() => {
    if (!showForm) return
    let active = true
    setJobsLoading(true); setJobsError('')
    void listJobs(business.id).then(data => { if (active) setJobs(data as ReminderJob[]) })
      .catch(err => { if (active) setJobsError(readableError(err, 'Unable to load jobs. You can still create a standalone reminder.')) })
      .finally(() => { if (active) setJobsLoading(false) })
    return () => { active = false }
  }, [business.id, showForm])

  function closeForm() {
    if (saving.current) return
    setShowForm(false); setForm({ note: '', due: '', jobId: '' }); setFormError(''); retry.current = null
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving.current) return
    saving.current = true; setBusy(true); setFormError(''); setSuccess('')
    try {
      let dueAt: string
      try { dueAt = validateScheduleWindow(form.due, '').startsAt }
      catch { throw new Error('Choose a valid reminder date and time.') }
      const job = jobs.find(item => item.id === form.jobId)
      if (form.jobId && !job) throw new Error('Choose an available job or leave this reminder unlinked.')
      const input = { note: form.note, dueAt, jobId: job?.id, customerId: job?.customer_id }
      const fingerprint = JSON.stringify({ businessId: business.id, ...input })
      if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, id: crypto.randomUUID() }
      await createReminder(business, { ...input, id: retry.current.id })
      if (!mounted.current) return
      retry.current = null; setForm({ note: '', due: '', jobId: '' }); setShowForm(false)
      setSuccess('Reminder created. Review your follow-ups here or from Jobs & schedule.')
      if (status !== 'pending' || offset !== 0) { setStatus('pending'); setOffset(0) }
      else await refresh()
    } catch (err) {
      if (mounted.current) setFormError(readableError(err, 'Unable to create reminder'))
    } finally {
      saving.current = false
      if (mounted.current) setBusy(false)
    }
  }

  async function finish(id: string) {
    if (completingRef.current) return
    completingRef.current = true; setCompleting(id); setActionError(''); setSuccess('')
    try {
      await completeWorkReminder(business, id)
      if (mounted.current) { setSuccess('Reminder completed.'); await refresh() }
    } catch (err) {
      if (mounted.current) setActionError(readableError(err, 'Unable to complete reminder'))
    } finally {
      completingRef.current = false
      if (mounted.current) setCompleting(null)
    }
  }

  return <div className="page-stack">
    <div className="page-heading split-heading"><div><p className="eyebrow">Reminders</p><h2>Keep the next step in sight.</h2></div><div className="work-heading-actions">
      <button type="button" className="secondary-button compact" disabled={loading || busy || !!completing} onClick={() => void refresh()}>Refresh</button>
      {canWrite(business.role) && <button type="button" className="primary-button compact" disabled={showForm} onClick={() => { setShowForm(true); setSuccess('') }}>+ New reminder</button>}
    </div></div>
    {success && <p className="reminder-success" role="status">{success}</p>}
    {showForm && <section className="reminder-composer" aria-labelledby="new-reminder-title">
      <h3 id="new-reminder-title">Create a reminder</h3><p className="quiet">Set a follow-up for your workspace, with an optional link to a job.</p>
      <form className="form-grid" onSubmit={submit}>
        <label className="full">What needs to be done?<textarea autoFocus value={form.note} maxLength={2000} required disabled={busy} placeholder="Call the customer to confirm access" onChange={event => setForm({ ...form, note: event.target.value })} /></label>
        <label>Remind me on<input type="datetime-local" required disabled={busy} value={form.due} onChange={event => setForm({ ...form, due: event.target.value })} /></label>
        <label>Related job (optional)<select value={form.jobId} disabled={busy || jobsLoading} onChange={event => setForm({ ...form, jobId: event.target.value })}><option value="">No linked job</option>{jobs.map(job => <option value={job.id} key={job.id}>{job.title}</option>)}</select></label>
        <p className="quiet full">Times use your device’s local time. Reminders appear here and on the dashboard when due.</p>
        {jobsLoading && <p className="quiet full" role="status">Loading available jobs…</p>}
        {jobsError && <p className="form-message error-text full" role="alert">{jobsError}</p>}
        {formError && <p className="form-message error-text full" role="alert">{formError}</p>}
        <div className="modal-actions full"><button type="button" className="secondary-button" disabled={busy} onClick={closeForm}>Cancel</button><button className="primary-button" disabled={busy || (jobsLoading && !!form.jobId)}>{busy ? 'Saving…' : 'Save reminder'}</button></div>
      </form>
    </section>}
    <nav className="work-filters" aria-label="Reminder status">{(['pending', 'completed'] as const).map(item => <button type="button" key={item} aria-pressed={status === item} disabled={!!completing} onClick={() => { setStatus(item); setOffset(0); setSuccess('') }}>{item === 'pending' ? 'Pending' : 'Completed'}</button>)}</nav>
    {error && <p className="form-message error-text" role="alert">{error}</p>}
    {actionError && <p className="form-message error-text" role="alert">{actionError}</p>}
    <section className="list-card" aria-label={status === 'pending' ? 'Pending reminders' : 'Completed reminders'} aria-busy={loading}>
      {loading ? <p className="work-list-message" role="status">Loading reminders…</p> : error ? <p className="work-list-message">Select Refresh to try again.</p> : rows.length === 0 ? <div className="empty-state"><h3>{status === 'pending' ? 'No pending reminders' : 'No completed reminders'}</h3><p>{status === 'pending' ? 'Create a reminder for your next follow-up.' : 'Reminders you mark done will appear here.'}</p></div> : rows.map(reminder => {
        const due = status === 'pending' && new Date(reminder.due_at).getTime() <= Date.now()
        return <article className="work-reminder-row" key={reminder.id}><div className="row-main"><strong>{reminder.note || reminder.kind.replaceAll('_', ' ')}</strong><span>{reminder.jobs[0]?.title ? `${reminder.jobs[0].title} · ` : ''}{new Date(reminder.due_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span></div><span className={`reminder-state ${due ? 'is-due' : ''}`}>{status === 'completed' ? 'Completed' : due ? 'Due' : 'Upcoming'}</span>{status === 'pending' && canWrite(business.role) && <button type="button" className="secondary-button small-button" disabled={!!completing} aria-label={`Mark ${reminder.note || 'reminder'} done`} onClick={() => void finish(reminder.id)}>{completing === reminder.id ? 'Saving…' : 'Done'}</button>}</article>
      })}
    </section>
    {!loading && !error && total > 0 && <div className="reminder-pagination"><span>{offset + 1}–{offset + rows.length} of {total} reminders</span><div><button type="button" className="secondary-button small-button" disabled={offset === 0 || !!completing} onClick={() => setOffset(Math.max(0, offset - REMINDER_PAGE_SIZE))}>Previous</button><button type="button" className="secondary-button small-button" disabled={offset + rows.length >= total || !!completing} onClick={() => setOffset(offset + REMINDER_PAGE_SIZE)}>Next</button></div></div>}
  </div>
}
