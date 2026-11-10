import AppointmentReminderDialog from '../components/scheduling/AppointmentReminderDialog'
import {useBusinessRefresh} from '../lib/useBusinessRefresh'
import BookExistingJobDialog from '../components/scheduling/BookExistingJobDialog'
import WorkspaceBack from '../components/WorkspaceBack'
import { useEffect, useMemo, useRef, useState } from 'react'
import { canWrite, type CurrentBusiness } from '../lib/business'
import { canAccess } from '../lib/workspaceAccess'
import { listAppointments, updateAppointmentStatus } from '../services/schedule'
import GoogleMapTools from '../components/GoogleMapTools'
import { formatServiceAddress, type ServiceAddress } from '../lib/googleMaps'
import { DateTime } from 'luxon'
import { readableError } from '../lib/errors'
import { jobStatusConfirmation, jobStatusLabels, jobStatusNotice, type JobStatus } from '../lib/jobActions'

type Customer = { id: string; first_name: string | null; last_name: string | null; company: string | null; email?: string | null; phone?: string | null }
type Property = ServiceAddress & { id: string; label: string | null }
type Appointment = { id: string; title: string; starts_at: string; ends_at: string | null; status: string; customers: Customer[] | null; jobs?: Array<{ id: string; title: string; status: string; properties?: Property[] }> | null }

function name(customer?: Customer) {
  if (!customer) return 'Customer'
  return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer'
}

export default function SchedulePage({ business, embedded = false }: { business: CurrentBusiness; embedded?: boolean }) {
  const zone=business.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const Heading = embedded ? 'h2' : 'h1'
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [reminderAppointment,setReminderAppointment]=useState<string|null>(null)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [savingAppointment,setSavingAppointment]=useState<string|null>(null)
  const changingStatus=useRef(false)
  const mounted = useRef(false)
  const currentRequest = useRef(0)
  const canBook = ['owner','admin','office'].includes(business.role) && canAccess(business,'jobs') && canAccess(business,'calendar')

  async function refresh() {
    if (!mounted.current) return
    const request = ++currentRequest.current
    const from = DateTime.now().setZone(zone).startOf('day')
    const to = from.plus({days:45})
    try {
      const rows = await listAppointments(business.id, from.toISO()!, to.toISO()!)
      if (!mounted.current || request !== currentRequest.current) return
      setAppointments(rows as Appointment[])
      setError('')
    } catch (err) {
      if (mounted.current && request === currentRequest.current) setError(readableError(err, 'Unable to load schedule'))
    }
  }

  useBusinessRefresh(business.id,()=>refresh())
  useEffect(() => {
    mounted.current = true
    setAppointments([])
    void refresh()
    return () => { mounted.current = false; currentRequest.current++ }
  }, [business.id,zone])

  const grouped = useMemo(() => {
    const groups = new Map<string, Appointment[]>()
    appointments.forEach((appointment) => {
      const key = new Date(appointment.starts_at).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', timeZone:zone })
      groups.set(key, [...(groups.get(key) ?? []), appointment])
    })
    return [...groups.entries()]
  }, [appointments,zone])

  async function changeStatus(id: string, status: Appointment['status']) {
    if(changingStatus.current)return
    const appointment=appointments.find(item=>item.id===id)
    const confirmation=appointment?.jobs?.[0]&&(status==='completed'||status==='canceled')?jobStatusConfirmation(status):null
    if(confirmation&&!window.confirm(confirmation))return
    changingStatus.current=true;setSavingAppointment(id);setError('')
    try { const result=await updateAppointmentStatus(id, status as 'scheduled' | 'confirmed' | 'in_progress' | 'completed' | 'canceled' | 'no_show');if(mounted.current)setNotice(result.visit_only?'Visit updated. The job remains open for further work and office completion.':result.job_id&&status==='completed'?jobStatusNotice('completed',{invoice_ready:result.invoice_ready===true,needs_pricing:result.needs_pricing===true,invoice_status:result.invoice_status}):'Appointment updated.');await refresh() }
    catch (err) { if (mounted.current) setError(readableError(err, 'Unable to update schedule')) }
    finally{changingStatus.current=false;if(mounted.current)setSavingAppointment(null)}
  }

  return <div className="page-stack"><WorkspaceBack />
    <div className="page-heading split-heading"><div><p className="eyebrow">Schedule</p><Heading>Know where you need to be next.</Heading><p className="quiet">Appointment times are shown in {zone.replaceAll('_',' ')}.</p></div><div className="related-page-actions"><a className="secondary-button compact" href="/?view=reminders">Manage Reminders</a>{canBook && <button className="primary-button compact" onClick={() => setShowForm(true)}>Book or reschedule job</button>}</div></div>
    {notice&&<p role="status">{notice}</p>}
    {error && !showForm && <p role="alert" className="form-message error-text">{error}</p>}
    <section className="schedule-card">
      {grouped.length === 0 ? <div className="empty-state"><div className="empty-icon">S</div><h2>Nothing scheduled</h2><p>Schedule a job here or tell Finviant Office when the work should happen.</p></div> : grouped.map(([date, items]) => <div className="schedule-day" key={date}><div className="schedule-date">{date}</div><div className="schedule-items">{items.map((appointment) => <article className="appointment-row" key={appointment.id}><div className="appointment-time"><strong>{new Date(appointment.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone:zone })}</strong>{appointment.ends_at && <span>{new Date(appointment.ends_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone:zone })}</span>}</div><div className="row-main">{appointment.jobs?.[0]&&canAccess(business,'jobs')?<a href={'/?view=work&document='+encodeURIComponent(appointment.jobs[0].id)}><strong>{appointment.title}</strong></a>:<strong>{appointment.title}</strong>}<span>{name(appointment.customers?.[0])}</span>{appointment.jobs?.[0]?.properties?.[0] && <div className="schedule-location"><span>{formatServiceAddress(appointment.jobs[0].properties![0])}</span><GoogleMapTools address={appointment.jobs[0].properties![0]} compact /></div>}</div>{appointment.jobs?.[0]?<div className="appointment-workflow"><span className="status-chip">{jobStatusLabels[appointment.jobs[0].status as JobStatus]||appointment.jobs[0].status.replaceAll('_',' ')}</span>{canWrite(business.role)&&canAccess(business,'jobs')&&['lead','scheduled','in_progress'].includes(appointment.jobs[0].status)&&['scheduled','confirmed','in_progress'].includes(appointment.status)&&<button type="button" className="primary-button compact" disabled={savingAppointment!==null} onClick={()=>void changeStatus(appointment.id,appointment.jobs![0].status==='in_progress'?'completed':'in_progress')}>{savingAppointment===appointment.id?'Updating…':appointment.jobs[0].status==='in_progress'?'Mark complete':'Start job'}</button>}</div>:<select aria-label={'Status for '+appointment.title} value={appointment.status} disabled={!canWrite(business.role)||savingAppointment!==null} onChange={(e) => void changeStatus(appointment.id, e.target.value)}><option value="scheduled">Scheduled</option><option value="confirmed">Confirmed</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="no_show">No show</option><option value="canceled">Canceled</option></select>}{canBook&&<button type="button" className="secondary-button compact" onClick={()=>setReminderAppointment(appointment.id)}>Customer reminder</button>}</article>)}</div></div>)}
    </section>
    {reminderAppointment&&<AppointmentReminderDialog key={reminderAppointment} businessId={business.id} appointmentId={reminderAppointment} onClose={()=>setReminderAppointment(null)}/>}
    {showForm&&canBook&&<BookExistingJobDialog business={business} onClose={()=>setShowForm(false)} onSaved={()=>{
      setNotice('Appointment saved.');void refresh()
    }}/>}
  </div>
}
