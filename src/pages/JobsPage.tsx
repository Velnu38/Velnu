import PlanRestriction from '../components/PlanRestriction'
import {useBusinessRefresh} from '../lib/useBusinessRefresh'
import CustomerRecordScope from '../components/CustomerRecordScope'
import QuickCustomer from '../components/scheduling/QuickCustomer'
import FormDialog from '../components/FormDialog'
import JobDetailsDialog from '../components/JobDetailsDialog'
import WorkspaceBack from '../components/WorkspaceBack'
import { localInstant } from '../lib/calendarTime'
import { DateTime } from 'luxon'
import RecordListControls, { RecordListPagination, useRecordList } from '../components/RecordListControls'
import { FormEvent, useEffect, useRef, useState } from 'react'
import { canWrite, type CurrentBusiness } from '../lib/business'
import { listCustomers } from '../services/customers'
import { createJob, getJob, listJobs, updateJobStatus } from '../services/jobs'
import GoogleMapTools from '../components/GoogleMapTools'
import CustomerPropertySelect from '../components/CustomerPropertySelect'
import { formatServiceAddress, type ServiceAddress } from '../lib/googleMaps'
import { jobGroup, type JobGroup } from '../lib/jobGroups'
import type { ReminderJob } from '../services/reminders'
import { readableError } from '../lib/errors'
import { canAccess,isPrimaryOwner } from '../lib/workspaceAccess'
import { useTierUsage } from '../lib/useTierUsage'
import DispatchJobDialog from '../components/scheduling/DispatchJobDialog'
import { getScheduleTeam, type Worker } from '../services/schedulingWorkflow'
import { jobInvoiceAction, jobNeedsStatusUpdate, jobStatusConfirmation, jobStatusLabels, jobStatusNotice, nextJobAction, type JobStatus } from '../lib/jobActions'
import CustomerPicker from '../components/CustomerPicker'

type Customer = { id: string; first_name: string | null; last_name: string | null; company: string | null; email?: string | null; phone?: string | null }
type Property = ServiceAddress & { id: string; label: string | null }
type Job = ReminderJob & { status: string; scheduled_start: string | null; scheduled_end?: string | null; assigned_user_ids?: string[]; customers: Customer | Customer[] | null; properties?: Property[] | null }
type JobQuickFilter = 'today' | 'active' | 'unscheduled' | null

export default function JobsPage({ business, embedded = false, onCreateReminder }: { business: CurrentBusiness; embedded?: boolean; onCreateReminder?: (job: ReminderJob) => void }) {
  const customerScope = new URLSearchParams(window.location.search).get('customer') || ''
  const timezone = business.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const Heading = embedded ? 'h2' : 'h1'
  const [detailsJob,setDetailsJob]=useState<{id:string;initialPhotos?:boolean}|null>(null)
  const [group, setGroup] = useState<JobGroup | 'all'>('all')
  const [quickFilter, setQuickFilter] = useState<JobQuickFilter>(customerScope ? null : 'active')
  const [loading, setLoading] = useState(true)
  const [jobs, setJobs] = useState<Job[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [showForm, setShowForm] = useState(()=>new URLSearchParams(window.location.search).get('new')==='1'&&canWrite(business.role))
  useEffect(()=>{const url=new URL(location.href);if(url.searchParams.has('new')){url.searchParams.delete('new');url.searchParams.delete('day');url.searchParams.delete('schedule');history.replaceState(history.state,'',url.pathname+url.search)}},[])
  const [noAddress,setNoAddress]=useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [newCrew,setNewCrew]=useState<string[]>([]),[newDuration,setNewDuration]=useState(120)
  const [notice,setNotice]=useState(''),[dispatch,setDispatch]=useState<Job|null>(null),[team,setTeam]=useState<Worker[]>([]),[workerFilter,setWorkerFilter]=useState('all')
  const usage = useTierUsage(business.id)
  const teamScheduling = usage?.plan === 'pro'
  const bookingLimit=usage?.plan==='free'&&usage.jobs_limit!==null&&usage.jobs_used>=usage.jobs_limit
  const assignedWorkers = teamScheduling ? newCrew : team.filter(worker => worker.is_you).map(worker => worker.id)
  const canDispatch=['owner','admin','office'].includes(business.role)&&canAccess(business,'calendar')&&canAccess(business,'jobs')
  useEffect(()=>{let active=true;void getScheduleTeam(business.id).then(rows=>{if(active){setTeam(rows);setNewCrew(rows.filter(w=>w.is_you).map(w=>w.id))}}).catch(()=>{});return()=>{active=false}},[business.id])
  const query = new URLSearchParams(window.location.search)
  const [requireAppointment,setRequireAppointment]=useState(()=>canDispatch&&query.get('schedule')==='1')
  const jobFormLabel = requireAppointment ? 'Add a job to the calendar' : 'Create a job'
  function closeJobForm() { setShowForm(false); setRequireAppointment(false) }
  const requestedJob = useRef(query.get('view') === 'work' ? query.get('document') : null)
  const pendingSave = useRef<{ fingerprint: string; id: string } | null>(null)
  const saving = useRef(false)
  const mounted = useRef(false)
  const requestId = useRef(0)
  const [form, setForm] = useState(() => {
    const day = query.get('day')
    return { customer_id: customerScope, property_id: '', title: '', description: '', scheduled_end: '',
      scheduled_start: canDispatch && day && /^\d{4}-\d{2}-\d{2}$/.test(day) && DateTime.fromISO(day).isValid ? day + 'T09:00' : '' }
  })
  const [invoiceAction, setInvoiceAction] = useState<ReturnType<typeof jobInvoiceAction>>(null)
  function openNewJob() {
    if (customerScope && customers.some(customer => customer.id === customerScope)) {
      setForm(current => current.customer_id ? current : { ...current, customer_id: customerScope })
    }
    setShowForm(true)
  }

  async function refresh(background=false) {
    const request = ++requestId.current
    if(!background)setLoading(true)
    try {
    const [jobRows, customerRows, linkedJob] = await Promise.all([listJobs(business.id, customerScope), listCustomers(business.id), requestedJob.current ? getJob(business.id, requestedJob.current) : Promise.resolve(null)])
    if (!mounted.current || request !== requestId.current) return
    if (linkedJob) {
      setDetailsJob({id:linkedJob.id,initialPhotos:query.get('tab')==='photos-expenses'})
      setGroup('all'); setQuickFilter(null); requestedJob.current = null
    }
    setJobs(jobRows as Job[])
    setCustomers(customerRows as Customer[])
    setError('')
    } finally { if (mounted.current && request === requestId.current) setLoading(false) }
  }

  useBusinessRefresh(business.id,()=>refresh(true).catch(err=>setError(readableError(err,'Unable to refresh jobs.'))))

  useEffect(() => {
    mounted.current = true
    void refresh().catch(err => { if (mounted.current) setError(readableError(err, 'Unable to load jobs')) })
    return () => { mounted.current = false; requestId.current++ }
  }, [business.id])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving.current) return
    saving.current = true
    const fingerprint = JSON.stringify({form,requireAppointment,workers:requireAppointment?undefined:assignedWorkers,duration:requireAppointment?undefined:newDuration})
    if (!pendingSave.current || pendingSave.current.fingerprint !== fingerprint) pendingSave.current = { fingerprint, id: crypto.randomUUID() }
    setBusy(true)
    setError('')
    try {
      const start = form.scheduled_start ? localInstant(form.scheduled_start, timezone) : undefined
      const end = requireAppointment && form.scheduled_end ? localInstant(form.scheduled_end, timezone) : undefined
      if (requireAppointment && !start) throw new Error('Choose a start time for this appointment.')
      if (start && end && Date.parse(end) <= Date.parse(start)) throw new Error('End time must be after the start time')
      await createJob(business.id, {
        request_id: pendingSave.current.id,
        customer_id: form.customer_id,
        property_id: form.property_id || undefined,
        title: form.title,
        description: form.description,
        scheduled_start: start,
        ...(requireAppointment?{scheduled_end:end}:start&&canDispatch?{
          assigned_user_ids:assignedWorkers,scheduled_end:DateTime.fromISO(start).plus({minutes:newDuration}).toISO()!
        }:{}),
      })
      pendingSave.current = null
      setInvoiceAction(null);setNotice(requireAppointment ? 'Appointment saved.' : 'Job saved.')
      setGroup('all'); setQuickFilter('active'); setWorkerFilter('all'); recordList.setSearch('')
      setForm({ customer_id: '', property_id: '', title: '', description: '', scheduled_start: '', scheduled_end: '' })
      closeJobForm()
      await refresh()
    } catch (err) {
      setError(readableError(err, 'Unable to create job'))
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  async function changeStatus(jobId: string, status: JobStatus) {
    if(saving.current)return
    const confirmation = jobStatusConfirmation(status)
    if(confirmation&&!window.confirm(confirmation))return
    saving.current=true;setBusy(true);setError('');setNotice('');setInvoiceAction(null)
    try { const result=await updateJobStatus(jobId, status); setNotice(jobStatusNotice(status,result)); setInvoiceAction(jobInvoiceAction(result)); await refresh().catch(()=>setError('The job status was saved, but the list could not refresh. Select Refresh to load the updated jobs.')) }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to update the job') }
    finally{saving.current=false;setBusy(false)}
  }

  const filteredJobs = jobs.filter(job => !teamScheduling || workerFilter === 'all' || job.assigned_user_ids?.includes(workerFilter))
  const grouped: Record<JobGroup | 'all', Job[]> = { all: [], current: [], upcoming: [], history: [] }
  const now = new Date()
  for (const job of filteredJobs) { grouped[jobGroup(job, now, timezone)].push(job); grouped.all.push(job) }
  const todayDate = DateTime.now().setZone(timezone).toISODate()
  const todayJobs = filteredJobs.filter(job => job.scheduled_start && DateTime.fromISO(job.scheduled_start).setZone(timezone).toISODate() === todayDate && !['completed','canceled'].includes(job.status))
  const activeJobs = filteredJobs.filter(job => ['lead','scheduled','in_progress'].includes(job.status))
    .sort((a,b) => Number(jobNeedsStatusUpdate(b,now,timezone)) - Number(jobNeedsStatusUpdate(a,now,timezone)))
  const unscheduledJobs = filteredJobs.filter(job => job.status === 'lead' && !job.scheduled_start)
  const selectedJobs = quickFilter === 'today' ? todayJobs
    : quickFilter === 'active' ? activeJobs
      : quickFilter === 'unscheduled' ? unscheduledJobs
        : grouped[group]
  const recordList = useRecordList(selectedJobs, row => [row.title, row.status, jobStatusLabels[row.status as JobStatus], ...(Array.isArray(row.customers) ? row.customers : row.customers ? [row.customers] : []).map(c => [c.first_name,c.last_name,c.company].join(' '))].join(' '))

  return (
    <div className="page-stack workspace-module jobs-module"><WorkspaceBack />
      <div className="page-heading split-heading module-page-heading">
        <div><p className="eyebrow">Jobs</p><Heading>Keep every job moving.</Heading><p className="module-page-intro">{teamScheduling ? 'See the work ahead, assign a crew, and open job details in one place.' : 'See upcoming work, book appointments, and open job details.'}</p></div>
        <div className="work-heading-actions"><button type="button" className="secondary-button compact" disabled={loading} onClick={() => void refresh().catch(err => setError(readableError(err, 'Unable to load jobs')))}>Refresh</button>{canWrite(business.role)&&<button type="button" className="primary-button compact" onClick={openNewJob}><span aria-hidden="true">＋</span> Create job</button>}</div>
      </div>
      {error && !showForm && <p className="form-message error-text" role="alert">{error}</p>}
      <CustomerRecordScope customerId={customerScope} customers={customers} view="work"/>
      <section className="module-summary-grid job-summary-grid" aria-label="Job summary">
        <button type="button" className="module-summary-card" aria-pressed={quickFilter === 'today'} onClick={() => { setQuickFilter('today'); setGroup('all'); recordList.setPage(0) }}><span>Today</span><strong>{todayJobs.length}</strong><small>scheduled jobs</small></button>
        <button type="button" className="module-summary-card" aria-pressed={quickFilter === 'active'} onClick={() => { setQuickFilter('active'); setGroup('all'); recordList.setPage(0) }}><span>Active</span><strong>{activeJobs.length}</strong><small>current and upcoming work</small></button>
        <button type="button" className="module-summary-card module-summary-card-approval" aria-pressed={quickFilter === 'unscheduled'} onClick={() => { setQuickFilter('unscheduled'); setGroup('all'); recordList.setPage(0) }}><span>Needs scheduling</span><strong>{unscheduledJobs.length}</strong><small>jobs without an appointment</small></button>
      </section>
      <nav className="work-filters module-job-filters" aria-label="Job timing">{(['all', 'upcoming', 'history'] as const).map(item => <button type="button" key={item} aria-pressed={quickFilter === null && group === item} onClick={() => { setQuickFilter(null); setGroup(item); recordList.setPage(0) }}>{item === 'all' ? 'All' : item === 'upcoming' ? 'Upcoming' : 'History'}{!loading && !error && <span>{grouped[item].length}</span>}</button>)}</nav>
      {teamScheduling&&team.length>0&&<label className="worker-select">Assigned team member<select value={workerFilter} onChange={e=>{setWorkerFilter(e.target.value);recordList.setPage(0)}}><option value="all">Everyone</option>{team.map(w=><option key={w.id} value={w.id}>{w.is_you?'My jobs · ':''}{w.label}</option>)}</select></label>}
      {notice&&<p role="status" className="guided-success">{notice} {invoiceAction&&canAccess(business,"billing")&&<a href={invoiceAction.href}>{invoiceAction.label}</a>}</p>}
      <p className="work-group-description">{quickFilter === 'today' ? 'Scheduled work for the business day in your timezone.' : quickFilter === 'active' ? 'All unfinished work. Appointments needing a status update appear first.' : quickFilter === 'unscheduled' ? 'Leads that need an appointment before work can begin.' : group === 'all' ? 'All jobs, including completed and canceled work.' : group === 'upcoming' ? 'Jobs scheduled for tomorrow or later that have not started.' : 'Completed and canceled jobs stay here for reference.'}</p>
      {!loading && !error && <RecordListControls label="jobs" list={recordList} showPagination={false} />}
      <section className="module-record-list jobs-record-list" aria-label={`${quickFilter || group} jobs`} aria-busy={loading}>
        {loading ? <p className="work-list-message" role="status">Loading jobs…</p> : error ? <p className="work-list-message">Select Refresh to try again.</p> : selectedJobs.length === 0 ? <div className="empty-state"><div className="empty-icon">J</div><h3>{quickFilter === 'today' ? 'No jobs scheduled today' : quickFilter === 'active' ? 'No active jobs' : quickFilter === 'unscheduled' ? 'Nothing needs scheduling' : group === 'all' ? 'No jobs yet' : group === 'history' ? 'No past jobs' : `No ${group} jobs`}</h3><p>{quickFilter === 'today' ? 'Appointments scheduled for today will appear here.' : quickFilter === 'active' ? 'Current and upcoming jobs will appear here.' : quickFilter === 'unscheduled' ? 'Jobs without an appointment will appear here.' : group === 'upcoming' ? 'Future scheduled work will appear here.' : group === 'history' ? 'Completed and canceled work will appear here.' : 'Choose Create job to add a job, or check Upcoming.'}</p></div> : recordList.visible.map((job) => {
          const customer = Array.isArray(job.customers) ? job.customers[0] : job.customers
          const customerName = customer ? ([customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer') : 'Customer'
          const crew = team.filter(worker => job.assigned_user_ids?.includes(worker.id)).map(worker => worker.label)
          const action = nextJobAction(job, canWrite(business.role) && canAccess(business,'jobs'), canDispatch)
          const needsUpdate = jobNeedsStatusUpdate(job,now,timezone)
          return <article className="job-row module-job-card" key={job.id}>
            <div className="row-main module-job-main"><div className="module-job-time">{job.scheduled_start ? <><strong>{new Date(job.scheduled_start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: timezone })}</strong><span>{new Date(job.scheduled_start).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: timezone })}</span></> : <><strong>Not booked</strong><span>Appointment</span></>}</div><div className="module-job-copy"><strong className="job-card-title">{job.title}</strong><span>{customerName}</span>{job.properties?.[0] && <div className="job-location"><span className="job-location-address">{formatServiceAddress(job.properties[0])}</span><GoogleMapTools address={job.properties[0]} compact directionsOnly /></div>}{(teamScheduling || crew.length > 0) && <small className="module-job-crew">{crew.length ? `Crew · ${crew.join(', ')}` : 'Crew not assigned'}</small>}</div></div>
            <div className="module-job-actions">
              <span className={`module-record-status ${job.status === 'completed' ? 'is-positive' : job.status === 'lead' ? 'is-pending' : ''}`}>{jobStatusLabels[job.status as JobStatus] || job.status.replaceAll('_',' ')}</span>
              {needsUpdate && <span className="job-status-followup">Past appointment · confirm job status</span>}
              <div className="job-row-actions">
                <button type="button" className="secondary-button compact" onClick={()=>setDetailsJob({id:job.id})}>Open job</button>
                {action && <button type="button" className="primary-button compact" disabled={busy} onClick={()=>action==='schedule'?setDispatch(job):void changeStatus(job.id,action==='start'?'in_progress':'completed')}>{action==='schedule'?'Book appointment':action==='start'?'Start job':'Mark complete'}</button>}
              </div>
            </div>
          </article>
        })}
      </section>
      {!loading && !error && <RecordListPagination label="jobs" list={recordList} className="jobs-bottom-pagination" />}
      {detailsJob&&<JobDetailsDialog key={detailsJob.id} business={business} jobId={detailsJob.id} initialPhotos={detailsJob.initialPhotos} onCreateReminder={onCreateReminder} onUpdated={()=>void refresh().catch(err=>setError(readableError(err,'Unable to refresh jobs')))} onClose={()=>{setDetailsJob(null);void refresh().catch(err=>setError(readableError(err,'Unable to refresh jobs')))}}/>}
      {dispatch&&<DispatchJobDialog business={business} job={dispatch} onClose={()=>setDispatch(null)} onSaved={()=>{setInvoiceAction(null);setNotice('Appointment saved. Confirm the time with your customer.');void refresh().catch(()=>setError('The schedule was saved, but the list could not refresh. Select Refresh to load the updated jobs.'))}}/>}
      {showForm && <FormDialog label={jobFormLabel} busy={busy} onClose={closeJobForm}>
        <div className="modal-head"><div><p className="eyebrow">New job</p><h2>{jobFormLabel}</h2></div><button className="icon-button" onClick={closeJobForm} aria-label="Close" type="button">×</button></div>
        <form className="form-grid" onSubmit={submit}>
          <CustomerPicker customers={customers} value={form.customer_id} required disabled={busy} onChange={customer_id => setForm(prev => ({ ...prev, customer_id, property_id: '' }))} />
          <QuickCustomer businessId={business.id} onCreated={customer=>{setCustomers(value=>[...value,customer]);setForm(value=>({...value,customer_id:customer.id,property_id:''}))}}/>
          <CustomerPropertySelect selectSingle businessId={business.id} customerId={form.customer_id} value={form.property_id} onChange={propertyId => setForm(prev => ({ ...prev, property_id: propertyId }))} disabled={busy} />
          <label className="full">{!requireAppointment&&!form.property_id&&<span><input type="checkbox" checked={noAddress} onChange={e=>setNoAddress(e.target.checked)}/> Continue with no service address (for remote work or an address to confirm)</span>}</label>
          <label className="full">Job title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Replace water heater" required /></label>
          <label className="full">Description<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          {bookingLimit&&<PlanRestriction plan="free" required="basic" feature="new job bookings" limit canUpgrade={isPrimaryOwner(business)}/>}
          <label className="full">{requireAppointment?'Starts':'Schedule ('+timezone+')'}<input type="datetime-local" required={requireAppointment} disabled={!canDispatch||bookingLimit} value={form.scheduled_start} onChange={(e) => setForm({ ...form, scheduled_start: e.target.value })} /></label>
          {requireAppointment&&<label className="full">Ends<input type="datetime-local" value={form.scheduled_end} disabled={bookingLimit} onChange={event=>setForm({...form,scheduled_end:event.target.value})}/></label>}
          {!requireAppointment&&form.scheduled_start&&canDispatch&&<><label>Job length<select value={newDuration} onChange={e=>setNewDuration(Number(e.target.value))}>{[30,60,90,120,180,240,360,480,720].map(n=><option key={n} value={n}>{n<60?`${n} minutes`:`${n/60} hours`}</option>)}</select></label>{teamScheduling && <fieldset className="guided-workers full"><legend>Assigned crew</legend>{team.map(w=><label key={w.id}><input type="checkbox" checked={newCrew.includes(w.id)} onChange={e=>setNewCrew(value=>e.target.checked?[...value,w.id]:value.filter(id=>id!==w.id))}/>{w.label}{w.is_you?' (you)':''}</label>)}</fieldset>}</>}{error && <p className="form-message error-text full">{error}</p>}
          <div className="modal-actions full"><button type="button" className="secondary-button" onClick={closeJobForm}>Cancel</button><button className="primary-button" disabled={busy||bookingLimit&&(requireAppointment||!!form.scheduled_start)||!requireAppointment&&!!form.scheduled_start&&(!form.property_id&&!noAddress||!assignedWorkers.length)}>{busy ? 'Saving…' : requireAppointment ? 'Schedule job' : 'Save job'}</button></div>
        </form>
      </FormDialog>}
    </div>
  )
}
