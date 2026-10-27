import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { canWrite, type CurrentBusiness } from '../lib/business'
import { listCustomers } from '../services/customers'
import { createJob } from '../services/jobs'
import { listAppointments, updateAppointmentStatus } from '../services/schedule'
import GoogleMapTools from '../components/GoogleMapTools'
import CustomerPropertySelect from '../components/CustomerPropertySelect'
import { formatServiceAddress, type ServiceAddress } from '../lib/googleMaps'
import { validateScheduleWindow } from '../lib/scheduleTime'

type Customer = { id: string; first_name: string | null; last_name: string | null; company: string | null }
type Property = ServiceAddress & { id: string; label: string | null }
type Appointment = { id: string; title: string; starts_at: string; ends_at: string | null; status: string; customers: Customer[] | null; jobs?: Array<{ id: string; title: string; properties?: Property[] }> | null }

function name(customer?: Customer) {
  if (!customer) return 'Customer'
  return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer'
}

export default function SchedulePage({ business }: { business: CurrentBusiness }) {
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ customer_id: '', property_id: '', title: '', description: '', starts_at: '', ends_at: '' })
  const mounted = useRef(false)
  const currentRequest = useRef(0)
  // State-based disabled buttons update after rendering. This ref guards
  // against same-tick double clicks that would otherwise create two jobs.
  const submitting = useRef(false)
  const retryRef = useRef<{ signature: string; requestId: string } | null>(null)

  async function refresh() {
    if (!mounted.current) return
    const request = ++currentRequest.current
    const from = new Date(); from.setHours(0, 0, 0, 0)
    const to = new Date(from); to.setDate(to.getDate() + 45)
    try {
      const [rows, customerRows] = await Promise.all([
        listAppointments(business.id, from.toISOString(), to.toISOString()),
        listCustomers(business.id),
      ])
      if (!mounted.current || request !== currentRequest.current) return
      setAppointments(rows as Appointment[])
      setCustomers(customerRows as Customer[])
      setError('')
    } catch (err) {
      if (mounted.current && request === currentRequest.current) setError(err instanceof Error ? err.message : 'Unable to load schedule')
    }
  }

  useEffect(() => {
    mounted.current = true
    setAppointments([])
    setCustomers([])
    void refresh()
    return () => { mounted.current = false; currentRequest.current++ }
  }, [business.id])

  const grouped = useMemo(() => {
    const groups = new Map<string, Appointment[]>()
    appointments.forEach((appointment) => {
      const key = new Date(appointment.starts_at).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
      groups.set(key, [...(groups.get(key) ?? []), appointment])
    })
    return [...groups.entries()]
  }, [appointments])

  function resetForm() {
    setForm({ customer_id: '', property_id: '', title: '', description: '', starts_at: '', ends_at: '' }); setError(''); retryRef.current = null
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setBusy(true); setError('')
    try {
      const { startsAt, endsAt } = validateScheduleWindow(form.starts_at, form.ends_at)
      const signature = JSON.stringify({
        businessId: business.id, ...form, startsAt, endsAt,
      })
      if (retryRef.current?.signature !== signature) {
        retryRef.current = { signature, requestId: crypto.randomUUID() }
      }
      await createJob(business.id, {
        request_id: retryRef.current.requestId,
        customer_id: form.customer_id,
        property_id: form.property_id || undefined,
        title: form.title,
        description: form.description,
        scheduled_start: startsAt,
        scheduled_end: endsAt ?? undefined,
      })
      resetForm(); setShowForm(false); await refresh()
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Unable to schedule work')
    } finally {
      submitting.current = false
      if (mounted.current) setBusy(false)
    }
  }

  async function changeStatus(id: string, status: Appointment['status']) {
    try { await updateAppointmentStatus(id, status as 'scheduled' | 'confirmed' | 'in_progress' | 'completed' | 'canceled' | 'no_show'); await refresh() }
    catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : 'Unable to update schedule') }
  }

  return <div className="page-stack">
    <div className="page-heading split-heading"><div><p className="eyebrow">Schedule</p><h1>Know where you need to be next.</h1></div>{canWrite(business.role) && <button className="primary-button compact" onClick={() => setShowForm(true)}>+ Schedule work</button>}</div>
    {error && !showForm && <p role="alert" className="form-message error-text">{error}</p>}
    <section className="schedule-card">
      {grouped.length === 0 ? <div className="empty-state"><div className="empty-icon">S</div><h2>Nothing scheduled</h2><p>Schedule a job here or tell Velnu when the work should happen.</p></div> : grouped.map(([date, items]) => <div className="schedule-day" key={date}><div className="schedule-date">{date}</div><div className="schedule-items">{items.map((appointment) => <article className="appointment-row" key={appointment.id}><div className="appointment-time"><strong>{new Date(appointment.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</strong>{appointment.ends_at && <span>{new Date(appointment.ends_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}</div><div className="row-main"><strong>{appointment.title}</strong><span>{name(appointment.customers?.[0])}</span>{appointment.jobs?.[0]?.properties?.[0] && <div className="schedule-location"><span>{formatServiceAddress(appointment.jobs[0].properties![0])}</span><GoogleMapTools address={appointment.jobs[0].properties![0]} compact /></div>}</div><select value={appointment.status} disabled={!canWrite(business.role)} onChange={(e) => changeStatus(appointment.id, e.target.value)}><option value="scheduled">Scheduled</option><option value="confirmed">Confirmed</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="no_show">No show</option><option value="canceled">Canceled</option></select></article>)}</div></div>)}
    </section>
    {showForm && <div className="modal-backdrop" onMouseDown={() => { setShowForm(false); resetForm() }}><section className="modal" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">Schedule work</p><h2>Add a job to the calendar</h2></div><button className="icon-button" onClick={() => { setShowForm(false); resetForm() }}>×</button></div>
      <form className="form-grid" onSubmit={submit}>
        <label className="full">Customer<select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value, property_id: '' })} required><option value="">Choose customer…</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{name(customer)}</option>)}</select></label>
        <CustomerPropertySelect businessId={business.id} customerId={form.customer_id} value={form.property_id} onChange={propertyId => setForm(prev => ({ ...prev, property_id: propertyId }))} disabled={busy} />
        <label className="full">Job title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Replace garbage disposal" required /></label>
        <label>Starts<input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} required /></label>
        <label>Ends<input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} /></label>
        <label className="full">Description<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        {error && <p className="form-message error-text full">{error}</p>}
        <div className="modal-actions full"><button type="button" className="secondary-button" onClick={() => { setShowForm(false); resetForm() }}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Schedule job'}</button></div>
      </form>
    </section></div>}
  </div>
}
