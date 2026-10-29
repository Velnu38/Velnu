import { FormEvent, useEffect, useRef, useState } from 'react'
import { canWrite, type CurrentBusiness } from '../lib/business'
import { listCustomers } from '../services/customers'
import { createJob, listJobs, updateJobStatus } from '../services/jobs'
import GoogleMapTools from '../components/GoogleMapTools'
import CustomerPropertySelect from '../components/CustomerPropertySelect'
import { formatServiceAddress, type ServiceAddress } from '../lib/googleMaps'
import { jobGroup, type JobGroup } from '../lib/jobGroups'
import type { ReminderJob } from '../services/reminders'
import { readableError } from '../lib/errors'

type Customer = { id: string; first_name: string | null; last_name: string | null; company: string | null }
type Property = ServiceAddress & { id: string; label: string | null }
type Job = ReminderJob & { status: string; scheduled_start: string | null; customers: Customer | Customer[] | null; properties?: Property[] | null }

export default function JobsPage({ business, embedded = false, onCreateReminder }: { business: CurrentBusiness; embedded?: boolean; onCreateReminder?: (job: ReminderJob) => void }) {
  const Heading = embedded ? 'h2' : 'h1'
  const [group, setGroup] = useState<JobGroup>('current')
  const [loading, setLoading] = useState(true)
  const [jobs, setJobs] = useState<Job[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pendingSave = useRef<{ fingerprint: string; id: string } | null>(null)
  const saving = useRef(false)
  const mounted = useRef(false)
  const requestId = useRef(0)
  const [form, setForm] = useState({ customer_id: '', property_id: '', title: '', description: '', scheduled_start: '' })

  async function refresh() {
    const request = ++requestId.current
    setLoading(true)
    try {
    const [jobRows, customerRows] = await Promise.all([listJobs(business.id), listCustomers(business.id)])
    if (!mounted.current || request !== requestId.current) return
    setJobs(jobRows as Job[])
    setCustomers(customerRows as Customer[])
    setError('')
    } finally { if (mounted.current && request === requestId.current) setLoading(false) }
  }

  useEffect(() => {
    mounted.current = true
    void refresh().catch(err => { if (mounted.current) setError(readableError(err, 'Unable to load jobs')) })
    return () => { mounted.current = false; requestId.current++ }
  }, [business.id])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving.current) return
    saving.current = true
    const fingerprint = JSON.stringify(form)
    if (!pendingSave.current || pendingSave.current.fingerprint !== fingerprint) pendingSave.current = { fingerprint, id: crypto.randomUUID() }
    setBusy(true)
    setError('')
    try {
      await createJob(business.id, {
        request_id: pendingSave.current.id,
        customer_id: form.customer_id,
        property_id: form.property_id || undefined,
        title: form.title,
        description: form.description,
        scheduled_start: form.scheduled_start ? new Date(form.scheduled_start).toISOString() : undefined,
      })
      pendingSave.current = null
      setGroup(jobGroup({ status: form.scheduled_start ? 'scheduled' : 'lead', scheduled_start: form.scheduled_start || null }))
      setForm({ customer_id: '', property_id: '', title: '', description: '', scheduled_start: '' })
      setShowForm(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create job')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  async function changeStatus(jobId: string, status: 'lead' | 'scheduled' | 'in_progress' | 'completed' | 'canceled') {
    try { await updateJobStatus(jobId, status); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to update the job') }
  }

  const grouped: Record<JobGroup, Job[]> = { current: [], upcoming: [], history: [] }
  const now = new Date()
  for (const job of jobs) grouped[jobGroup(job, now)].push(job)

  return (
    <div className="page-stack">
      <div className="page-heading split-heading">
        <div><p className="eyebrow">Jobs</p><Heading>Keep every job moving.</Heading></div>
        <div className="work-heading-actions"><button type="button" className="secondary-button compact" disabled={loading} onClick={() => void refresh().catch(err => setError(readableError(err, 'Unable to load jobs')))}>Refresh</button>{canWrite(business.role) && <button className="primary-button compact" onClick={() => setShowForm(true)}>+ New job</button>}</div>
      </div>
      {error && !showForm && <p className="form-message error-text" role="alert">{error}</p>}
      <nav className="work-filters" aria-label="Job timing">{(['current', 'upcoming', 'history'] as const).map(item => <button type="button" key={item} aria-pressed={group === item} onClick={() => setGroup(item)}>{item === 'current' ? 'Current' : item === 'upcoming' ? 'Upcoming' : 'History'}{!loading && !error && <span>{grouped[item].length}</span>}</button>)}</nav>
      <p className="work-group-description">{group === 'current' ? 'In progress, scheduled today or earlier, and jobs awaiting a date.' : group === 'upcoming' ? 'Jobs scheduled for tomorrow or later that have not started.' : 'Completed and canceled jobs stay here for reference.'}</p>
      <section className="list-card" aria-label={`${group} jobs`} aria-busy={loading}>
        {loading ? <p className="work-list-message" role="status">Loading jobs…</p> : error ? <p className="work-list-message">Select Refresh to try again.</p> : grouped[group].length === 0 ? <div className="empty-state"><div className="empty-icon">J</div><h3>{group === 'history' ? 'No past jobs' : `No ${group} jobs`}</h3><p>{group === 'upcoming' ? 'Future scheduled work will appear here.' : group === 'history' ? 'Completed and canceled work will appear here.' : 'Create a job or check Upcoming for your next scheduled work.'}</p></div> : grouped[group].map((job) => {
          const customer = Array.isArray(job.customers) ? job.customers[0] : job.customers
          const customerName = customer ? ([customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer') : 'Customer'
          return <article className="job-row" key={job.id}>
            <div className="row-main"><strong>{job.title}</strong><span>{customerName}{job.scheduled_start ? ` · ${new Date(job.scheduled_start).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : ' · Not scheduled'}</span>{job.properties?.[0] && <div className="job-location"><span className="job-location-address">{formatServiceAddress(job.properties[0])}</span><GoogleMapTools address={job.properties[0]} compact /></div>}</div>
            <div className="job-row-actions">{onCreateReminder && canWrite(business.role) && <button type="button" className="secondary-button small-button" aria-label={`Add reminder for ${job.title}`} onClick={() => onCreateReminder(job)}>+ Reminder</button>}<select aria-label={`Status for ${job.title}`} value={job.status} disabled={!canWrite(business.role)} onChange={(e) => changeStatus(job.id, e.target.value as any)}>
              <option value="lead">Lead</option><option value="scheduled" disabled={!job.scheduled_start}>Scheduled</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="canceled">Canceled</option>
            </select></div>
          </article>
        })}
      </section>
      {showForm && <div className="modal-backdrop" onMouseDown={() => setShowForm(false)}><section className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><p className="eyebrow">New job</p><h2>Create a job</h2></div><button className="icon-button" onClick={() => setShowForm(false)}>×</button></div>
        <form className="form-grid" onSubmit={submit}>
          <label className="full">Customer<select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value, property_id: '' })} required><option value="">Choose customer…</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{[customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company}</option>)}</select></label>
          <CustomerPropertySelect businessId={business.id} customerId={form.customer_id} value={form.property_id} onChange={propertyId => setForm(prev => ({ ...prev, property_id: propertyId }))} disabled={busy} />
          <label className="full">Job title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Replace water heater" required /></label>
          <label className="full">Description<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <label className="full">Schedule<input type="datetime-local" value={form.scheduled_start} onChange={(e) => setForm({ ...form, scheduled_start: e.target.value })} /></label>
          {error && <p className="form-message error-text full">{error}</p>}
          <div className="modal-actions full"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save job'}</button></div>
        </form>
      </section></div>}
    </div>
  )
}
