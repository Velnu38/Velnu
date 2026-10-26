import { FormEvent, useEffect, useState } from 'react'
import { canWrite, type CurrentBusiness } from '../lib/business'
import { listCustomers } from '../services/customers'
import { createJob, listJobs, updateJobStatus } from '../services/jobs'
import GoogleMapTools from '../components/GoogleMapTools'
import CustomerPropertySelect from '../components/CustomerPropertySelect'
import { formatServiceAddress, type ServiceAddress } from '../lib/googleMaps'

type Customer = { id: string; first_name: string | null; last_name: string | null; company: string | null }
type Property = ServiceAddress & { id: string; label: string | null }
type Job = { id: string; title: string; status: string; scheduled_start: string | null; customers: Customer | Customer[] | null; properties?: Property[] | null }

export default function JobsPage({ business }: { business: CurrentBusiness }) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ customer_id: '', property_id: '', title: '', description: '', scheduled_start: '' })

  async function refresh() {
    const [jobRows, customerRows] = await Promise.all([listJobs(business.id), listCustomers(business.id)])
    setJobs(jobRows as Job[])
    setCustomers(customerRows as Customer[])
  }

  useEffect(() => { void refresh().catch(err => setError(err instanceof Error ? err.message : 'Unable to load jobs')) }, [business.id])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await createJob(business.id, {
        customer_id: form.customer_id,
        property_id: form.property_id || undefined,
        title: form.title,
        description: form.description,
        scheduled_start: form.scheduled_start ? new Date(form.scheduled_start).toISOString() : undefined,
      })
      setForm({ customer_id: '', property_id: '', title: '', description: '', scheduled_start: '' })
      setShowForm(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create job')
    } finally {
      setBusy(false)
    }
  }

  async function changeStatus(jobId: string, status: 'lead' | 'scheduled' | 'in_progress' | 'completed' | 'canceled') {
    try { await updateJobStatus(jobId, status); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to update the job') }
  }

  return (
    <div className="page-stack">
      <div className="page-heading split-heading">
        <div><p className="eyebrow">Jobs</p><h1>Keep every job moving.</h1></div>
        {canWrite(business.role) && <button className="primary-button compact" onClick={() => setShowForm(true)}>+ New job</button>}
      </div>
      <section className="list-card">
        {jobs.length === 0 ? <div className="empty-state"><div className="empty-icon">J</div><h2>No jobs yet</h2><p>Create a job here or tell Velnu what work you need scheduled.</p></div> : jobs.map((job) => {
          const customer = Array.isArray(job.customers) ? job.customers[0] : job.customers
          const customerName = customer ? ([customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer') : 'Customer'
          return <article className="job-row" key={job.id}>
            <div className="row-main"><strong>{job.title}</strong><span>{customerName}{job.scheduled_start ? ` · ${new Date(job.scheduled_start).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : ''}</span>{job.properties?.[0] && <div className="job-location"><span className="job-location-address">{formatServiceAddress(job.properties[0])}</span><GoogleMapTools address={job.properties[0]} compact /></div>}</div>
            <select value={job.status} disabled={!canWrite(business.role)} onChange={(e) => changeStatus(job.id, e.target.value as any)}>
              <option value="lead">Lead</option><option value="scheduled" disabled={!job.scheduled_start}>Scheduled</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="canceled">Canceled</option>
            </select>
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
