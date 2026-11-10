import JobManagement from '../components/JobManagement'
import {RecordTabs} from '../components/RecordDetail'
import {confirmNavigation} from '../lib/unsavedChanges'
import JobsOverview, {type JobsOverviewFilter} from '../components/JobsOverview'
import '../components/operations.css'
import RefreshButton from '../components/RefreshButton'
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
import { FormEvent, useEffect, useId, useRef, useState } from 'react'
import { canWrite, type CurrentBusiness } from '../lib/business'
import { searchJobCustomers } from '../services/customers'
import { createJob, getJob, getJobsOverview, getJobDirectoryPage, updateJobStatus, type JobWorkflow } from '../services/jobs'
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
import { hasActiveJobAppointment, jobInvoiceAction, jobNeedsStatusUpdate, jobStatusConfirmation, jobStatusLabels, jobStatusNotice, linkedJobInvoiceAction, nextJobAction, type JobStatus } from '../lib/jobActions'
import JobCustomerPicker from '../components/JobCustomerPicker'

type Customer = { id: string; first_name: string | null; last_name: string | null; company: string | null; email?: string | null; phone?: string | null }
type Property = ServiceAddress & { id: string; label: string | null }
type Job = ReminderJob & JobWorkflow & { status: string; scheduled_start: string | null; scheduled_end?: string | null; assigned_user_ids?: string[]; customers: Customer | Customer[] | null; properties?: Property[] | null }
type JobQuickFilter = Exclude<JobsOverviewFilter,'all'|'history'> | null

export default function JobsPage({ business, embedded = false, onCreateReminder }: { business: CurrentBusiness; embedded?: boolean; onCreateReminder?: (job: ReminderJob) => void }) {
  const customerScope = new URLSearchParams(window.location.search).get('customer') || ''
  const timezone = business.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const Heading = embedded ? 'h2' : 'h1'
  const [layout,setLayout]=useState<'overview'|'list'|'board'>('list')
  const initialQuery=new URLSearchParams(window.location.search)
  const managementKey=['finviant-job-selection',business.id,business.role,business.access_modules?.join(','),customerScope].join(':')
  const [workspace,setWorkspace]=useState<'jobs'|'management'>(initialQuery.get('workspace')==='management'?'management':'jobs')
  const [managementOpened,setManagementOpened]=useState(workspace==='management')
  const [managementComplete,setManagementComplete]=useState(false)
  const [selectedJob,setSelectedJob]=useState<string|null>(()=>{if(initialQuery.get('workspace')==='management')return initialQuery.get('job')||initialQuery.get('document');try{return sessionStorage.getItem(managementKey)}catch{return null}})
  const workspaceId=useId()
  function selectManagedJob(id:string|null){
    setSelectedJob(id);setManagementComplete(false)
    try{if(id)sessionStorage.setItem(managementKey,id);else sessionStorage.removeItem(managementKey)}catch{/* Selection still works when browser storage is unavailable. */}
    const url=new URL(location.href);url.searchParams.set('workspace','management');url.searchParams.delete('document');url.searchParams.delete('section');if(id)url.searchParams.set('job',id);else url.searchParams.delete('job');history.replaceState(history.state,'',url.pathname+url.search)
  }
  function changeWorkspace(next:'jobs'|'management'){
    if(next===workspace||!confirmNavigation())return
    setWorkspace(next);setManagementOpened(next==='management')
    const url=new URL(location.href);if(next==='management'){url.searchParams.set('workspace','management');if(selectedJob)url.searchParams.set('job',selectedJob)}else{url.searchParams.delete('workspace');url.searchParams.delete('job');url.searchParams.delete('section')}history.replaceState(history.state,'',url.pathname+url.search)
  }
  function openManagement(id:string,complete=false){if(!confirmNavigation())return;selectManagedJob(id);setManagementComplete(complete);setWorkspace('management');setManagementOpened(true)}
  const [detailsJob,setDetailsJob]=useState<{id:string;initialPhotos?:boolean;initialSchedule?:boolean;initialPlan?:boolean}|null>(null)
  const [group, setGroup] = useState<JobGroup | 'all'>('all')
  const [quickFilter, setQuickFilter] = useState<JobQuickFilter>(customerScope ? null : 'active')
  const [overviewRevision,setOverviewRevision]=useState(0)
  const [clock,setClock]=useState(Date.now())
  useEffect(()=>{const timer=window.setInterval(()=>setClock(Date.now()),60000);return()=>window.clearInterval(timer)},[])
  const [loading, setLoading] = useState(true)
  const [jobs, setJobs] = useState<Job[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [directory,setDirectory]=useState<Awaited<ReturnType<typeof getJobDirectoryPage>>|null>(null)
  const [directorySearch,setDirectorySearch]=useState(''),[directoryPage,setDirectoryPage]=useState(0)
  const [directoryQuery,setDirectoryQuery]=useState('')
  useEffect(()=>{const timer=window.setTimeout(()=>setDirectoryQuery(directorySearch),200);return()=>window.clearTimeout(timer)},[directorySearch])
  const accessKey=[business.id,business.role,business.access_modules?.join(',')].join(':')
  const useDirectory=workspace==='jobs'&&layout!=='overview'
  const useOverview=workspace==='jobs'&&layout==='overview'
  const [overviewData,setOverviewData]=useState<Awaited<ReturnType<typeof getJobsOverview>>|null>(null)
  const [showForm, setShowForm] = useState(()=>new URLSearchParams(window.location.search).get('new')==='1'&&canWrite(business.role))
  useEffect(()=>{const url=new URL(location.href);if(url.searchParams.has('new')){url.searchParams.delete('new');url.searchParams.delete('day');url.searchParams.delete('schedule');history.replaceState(history.state,'',url.pathname+url.search)}},[])
  const [noAddress,setNoAddress]=useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [newCrew,setNewCrew]=useState<string[]>([]),[newDuration,setNewDuration]=useState(120)
  const [notice,setNotice]=useState(''),[dispatch,setDispatch]=useState<Job|null>(null),[team,setTeam]=useState<Worker[]>([]),[workerFilter,setWorkerFilter]=useState('all')
  const usage = useTierUsage(business.id)
  const teamScheduling = usage?.plan === 'pro' || usage?.plan === 'basic'
  const bookingLimit=usage?.plan==='free'&&usage.jobs_limit!==null&&usage.jobs_used>=usage.jobs_limit
  const assignedWorkers = teamScheduling ? newCrew : team.filter(worker => worker.is_you).map(worker => worker.id)
  const canDispatch=['owner','admin','office'].includes(business.role)&&canAccess(business,'calendar')&&canAccess(business,'jobs')
  useEffect(()=>{let active=true;void getScheduleTeam(business.id).then(rows=>{if(active){setTeam(rows);setNewCrew(rows.filter(w=>w.is_you&&w.active!==false).map(w=>w.id))}}).catch(()=>{});return()=>{active=false}},[business.id])
  const query = new URLSearchParams(window.location.search)
  const [requireAppointment,setRequireAppointment]=useState(()=>canDispatch&&query.get('schedule')==='1')
  const jobFormLabel = requireAppointment ? 'Add a job to the calendar' : 'Create a job'
  function closeJobForm() { setShowForm(false); setRequireAppointment(false) }
  const requestedJob = useRef(query.get('view') === 'work' && query.get('workspace')!=='management' ? query.get('document') : null)
  const requestedSchedule = useRef(query.get('schedule') === '1')
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

  async function refresh(background=false,_directoryOnly=false) {
    const request = ++requestId.current
    if(!background)setLoading(true)
    try {
    const [jobResult, customerRows, linkedJob] = await Promise.all([useDirectory?getJobDirectoryPage(business.id,{customerId:customerScope,filter:quickFilter||group,workerId:teamScheduling&&workerFilter!=='all'?workerFilter:undefined,search:directoryQuery,page:directoryPage}):useOverview?getJobsOverview(business.id,customerScope,teamScheduling&&workerFilter!=='all'?workerFilter:undefined):Promise.resolve(null), customerScope?searchJobCustomers(business.id,'',customerScope).then(d=>d.selected?[d.selected]:[]):Promise.resolve([]), requestedJob.current ? getJob(business.id, requestedJob.current) : Promise.resolve(null)])
    if (!mounted.current || request !== requestId.current) return
    if (linkedJob) {
      setDetailsJob({id:linkedJob.id,initialPhotos:query.get('tab')==='photos-expenses',initialSchedule:requestedSchedule.current})
      if (requestedSchedule.current) { const url = new URL(location.href); url.searchParams.delete('schedule'); history.replaceState(history.state, '', url.pathname + url.search + url.hash); requestedSchedule.current = false }
      setGroup('all'); setQuickFilter(null); requestedJob.current = null
    }
    if(useDirectory){const page=jobResult as Awaited<ReturnType<typeof getJobDirectoryPage>>;setDirectory(page);setJobs(page.items as Job[])}else if(useOverview){const summary=jobResult as Awaited<ReturnType<typeof getJobsOverview>>;setOverviewData(summary);setJobs([...new Map([...summary.focus,...summary.agenda].map(j=>[j.id,j])).values()] as Job[])}else setJobs([])
    setOverviewRevision(v=>v+1)
    setCustomers(customerRows as Customer[])
    setError('')
    } finally { if (mounted.current && request === requestId.current) setLoading(false) }
  }

  const overviewMinute=useRef(Math.floor(clock/60000))
  useEffect(()=>{const minute=Math.floor(clock/60000);if(minute===overviewMinute.current)return;overviewMinute.current=minute;if(useOverview)void refresh(true,true).catch(err=>setError(readableError(err,'Unable to refresh the job overview.')))},[Math.floor(clock/60000)])

  useBusinessRefresh(business.id,()=>refresh(true).catch(err=>setError(readableError(err,'Unable to refresh jobs.'))))

  useEffect(() => {
    mounted.current = true
    void refresh(false,true).catch(err => { if (mounted.current) setError(readableError(err, 'Unable to load jobs')) })
    return () => { mounted.current = false; requestId.current++ }
  }, [accessKey,customerScope,useDirectory,useOverview,useDirectory?quickFilter:null,useDirectory?group:null,workspace==='jobs'?workerFilter:null,workspace==='jobs'?teamScheduling:null,useDirectory?directoryQuery:null,useDirectory?directoryPage:null])

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
  const now = new Date(clock)
  for (const job of filteredJobs) { grouped[jobGroup({...job,scheduled_start:hasActiveJobAppointment(job)?job.active_appointment!.starts_at:null}, now, timezone)].push(job); grouped.all.push(job) }
  const todayDate = DateTime.fromJSDate(now,{zone:timezone}).toISODate()
  const todayJobs = filteredJobs.filter(job => hasActiveJobAppointment(job) && DateTime.fromISO(job.active_appointment!.starts_at).setZone(timezone).toISODate() === todayDate && !['completed','canceled'].includes(job.status))
  const activeJobs = filteredJobs.filter(job => ['lead','scheduled','in_progress'].includes(job.status))
    .sort((a,b) => Number(jobNeedsStatusUpdate(b,now,timezone)) - Number(jobNeedsStatusUpdate(a,now,timezone)))
  const unscheduledJobs = filteredJobs.filter(job => ['lead','scheduled'].includes(job.status) && !hasActiveJobAppointment(job))
  const inProgressJobs=filteredJobs.filter(j=>j.status==='in_progress')
  const billingJobs=canAccess(business,'billing')?filteredJobs.filter(j=>j.status==='completed'&&(!j.invoice||['draft','void'].includes(j.invoice.status))):[]
  const attentionJobs=activeJobs.filter(j=>jobNeedsStatusUpdate(j,now,timezone))
  const unassignedJobs=activeJobs.filter(j=>!j.assigned_user_ids?.length)
  const scheduledJobs=activeJobs.filter(j=>j.status!=='in_progress'&&hasActiveJobAppointment(j))
  const completedJobs=filteredJobs.filter(j=>j.status==='completed')
  const legacySelectedJobs = quickFilter === 'today' ? todayJobs
    : quickFilter === 'active' ? activeJobs
      : quickFilter === 'unscheduled' ? unscheduledJobs
      : quickFilter === 'in_progress' ? inProgressJobs
      : quickFilter === 'billing' ? billingJobs
      : quickFilter === 'attention' ? attentionJobs
      : quickFilter === 'unassigned' ? unassignedJobs
      : quickFilter === 'scheduled' ? scheduledJobs
      : quickFilter === 'completed' ? completedJobs
        : grouped[group]
  const selectedJobs=useDirectory?jobs:legacySelectedJobs
  const localList = useRecordList(legacySelectedJobs, row => [row.title, row.status, jobStatusLabels[row.status as JobStatus], ...(Array.isArray(row.customers) ? row.customers : row.customers ? [row.customers] : []).map(c => [c.first_name,c.last_name,c.company].join(' '))].join(' '))

  const recordList={...localList,...(useDirectory?{visible:jobs,search:directorySearch,page:directory?.page??0,pages:Math.max(1,Math.ceil((directory?.total??0)/25)),total:directory?.total??0}:{}),
    setSearch:(value:string)=>{setDirectorySearch(value.slice(0,200));setDirectoryPage(0);localList.setSearch(value.slice(0,200))},
    setPage:(value:Parameters<typeof localList.setPage>[0])=>{setDirectoryPage(value);localList.setPage(value)}}

  return (
    <div className="page-stack workspace-module jobs-module"><WorkspaceBack />
      <div className="page-heading split-heading module-page-heading">
        <div><p className="eyebrow">Jobs</p><Heading>{workspace==='management'?'Job Management':'Jobs'}</Heading><p className="module-page-intro">{workspace==='management'?'Approved work. Organized execution.':'Find your jobs, review their history, or choose Manage to organize the work.'}</p></div>
        <div className="work-heading-actions"><RefreshButton busy={loading} onClick={() => void refresh().catch(err => setError(readableError(err, 'Unable to load jobs')))}/>{canWrite(business.role)&&<button type="button" className="primary-button compact" onClick={openNewJob}><span aria-hidden="true">＋</span> Create job</button>}</div>
      </div>
      {error && !showForm && <p className="form-message error-text" role="alert">{error}</p>}
      <CustomerRecordScope customerId={customerScope} customers={customers} view="work"/>
      <div className="jobs-workspace-tabs"><RecordTabs label="Jobs workspace" tabs={[{id:workspaceId+'-jobs',label:'Jobs'},{id:workspaceId+'-management',label:'Job Management'}]} active={workspaceId+'-'+workspace} onChange={id=>changeWorkspace(id===workspaceId+'-management'?'management':'jobs')}/></div>
      <div role="tabpanel" id={workspaceId+'-management-panel'} aria-labelledby={workspaceId+'-management-tab'} hidden={workspace!=='management'}>{managementOpened&&<JobManagement key={managementKey} business={business} team={team} customerScope={customerScope} selectedJobId={selectedJob} onSelect={selectManagedJob} initialComplete={managementComplete} revision={overviewRevision} onUpdated={()=>void refresh(true,true).catch(err=>setError(readableError(err,'Unable to refresh jobs')))}/>}</div>
      <div role="tabpanel" id={workspaceId+'-jobs-panel'} aria-labelledby={workspaceId+'-jobs-tab'} hidden={workspace!=='jobs'}>
      <nav className="jobs-hub-navigation" aria-label="Job workspace views"><div className="view-switch" role="group" aria-label="Job view">{(['overview','list','board'] as const).map(view=><button type="button" key={view} aria-pressed={layout===view} onClick={()=>setLayout(view)}>{view==='overview'?'Overview':view==='list'?'List':'Board'}</button>)}</div><span>Plan · Assign · Track · Invoice</span></nav>
      {notice&&<p role="status" className="guided-success">{notice} {invoiceAction&&canAccess(business,"billing")&&<a href={invoiceAction.href}>{invoiceAction.label}</a>}</p>}
      {layout==='overview'&&(loading?<p role="status">Loading job dashboard…</p>:error?<p>Select Refresh to load the job dashboard.</p>:overviewData?<JobsOverview business={business} data={overviewData} team={team} now={now} revision={overviewRevision} canCreate={canWrite(business.role)&&canAccess(business,'jobs')} onCreate={openNewJob} onOpen={(id,initialPlan)=>setDetailsJob({id,initialPlan})} onFilter={filter=>{setLayout('list');setWorkerFilter('all');recordList.setSearch('');recordList.setPage(0);if(filter==='all'||filter==='history'){setQuickFilter(null);setGroup(filter)}else{setQuickFilter(filter);setGroup('all')}}}/>:<p role="status">Loading job dashboard…</p>)}
      {layout!=='overview'&&<>
      <details className="jobs-filter-panel"><summary>Filter jobs · {quickFilter?({today:'Today',active:'Active work',unscheduled:'Needs scheduling',in_progress:'In progress',billing:'Ready for billing',attention:'Past appointments',unassigned:'Unassigned',scheduled:'Scheduled',completed:'Completed'}[quickFilter]):group==='all'?'All jobs':group==='history'?'History':'Upcoming'}</summary>
      <nav className="work-filters module-job-filters" aria-label="Job timing">{([{id:'today',label:'Today',count:todayJobs.length},{id:'active',label:'Active',count:activeJobs.length},{id:'unscheduled',label:'Needs scheduling',count:unscheduledJobs.length},{id:'all',label:'All',count:grouped.all.length},{id:'upcoming',label:'Upcoming',count:grouped.upcoming.length},{id:'history',label:'History',count:grouped.history.length}] as const).map(item=><button type="button" key={item.id} aria-pressed={quickFilter===item.id||quickFilter===null&&group===item.id} onClick={()=>{if(item.id==='all'||item.id==='upcoming'||item.id==='history'){setQuickFilter(null);setGroup(item.id)}else{setQuickFilter(item.id);setGroup('all')}recordList.setPage(0)}}>{item.label}<span>{loading?'—':useDirectory?(directory?.counts[item.id]??0):item.count}</span></button>)}</nav>
      {teamScheduling&&team.length>0&&<label className="worker-select">Assigned team member<select value={workerFilter} onChange={e=>{setWorkerFilter(e.target.value);recordList.setPage(0)}}><option value="all">Everyone</option>{team.map(w=><option key={w.id} value={w.id}>{w.is_you?'My jobs · ':''}{w.label}</option>)}</select></label>}
      <p className="work-group-description">Use timing and worker filters together. Completed and canceled jobs remain in History.</p></details>
      {(useDirectory||(!loading&&!error))&&<RecordListControls label="jobs" list={recordList} showPagination={false}/>}
      </>}
      {layout==='board'&&!loading&&!error&&<section className="job-board" aria-label="Job progress board">{[{id:'lead',label:'Needs scheduling'},{id:'scheduled',label:'Scheduled'},{id:'in_progress',label:'In progress'},{id:'finished',label:'Finished'}].filter(stage=>stage.id!=='finished'||selectedJobs.some(j=>['completed','canceled'].includes(j.status))).map(stage=>{const column=recordList.visible.filter(j=>stage.id===(['completed','canceled'].includes(j.status)?'finished':j.status==='in_progress'?'in_progress':hasActiveJobAppointment(j)?'scheduled':'lead'));return <section key={stage.id} className="job-board-column"><h3>{stage.label}<span>{column.length}</span></h3>{column.map(j=>{const c=Array.isArray(j.customers)?j.customers[0]:j.customers;const crew=team.filter(w=>j.assigned_user_ids?.includes(w.id));return <article className="job-board-card" key={j.id}><strong>{j.title}</strong><span>{c?[c.first_name,c.last_name].filter(Boolean).join(' ')||c.company:'Customer'}</span>{hasActiveJobAppointment(j)&&<small>{DateTime.fromISO(j.active_appointment!.starts_at).setZone(timezone).toFormat('MMM d · h:mm a')}</small>}<small>{crew.length?crew.map(w=>w.label).join(', '):'Crew not assigned'}</small>{['completed','canceled'].includes(j.status)&&<small>{jobStatusLabels[j.status as JobStatus]}</small>}<div className="jm-inline-actions"><button type="button" className="primary-button compact" onClick={()=>openManagement(j.id)}>Manage</button><button type="button" className="secondary-button compact" onClick={()=>setDetailsJob({id:j.id})}>Open job</button></div></article>})}{!column.length&&<p className="quiet">No jobs on this page.</p>}</section>})}</section>}
      {layout==='board'&&loading&&<p role="status">Loading job board…</p>}
      {layout==='list'&&<section className="module-record-list jobs-record-list" aria-label={`${quickFilter || group} jobs`} aria-busy={loading}>
        {loading ? <p className="work-list-message" role="status">Loading jobs…</p> : error ? <p className="work-list-message">Select Refresh to try again.</p> : selectedJobs.length === 0 ? <div className="empty-state"><div className="empty-icon">J</div><h3>{quickFilter === 'today' ? 'No jobs scheduled today' : quickFilter === 'active' ? 'No active jobs' : quickFilter === 'unscheduled' ? 'Nothing needs scheduling' : group === 'all' ? 'No jobs yet' : group === 'history' ? 'No past jobs' : quickFilter ? 'No jobs in this view' : `No ${group} jobs`}</h3><p>{quickFilter === 'today' ? 'Appointments scheduled for today will appear here.' : quickFilter === 'active' ? 'Current and upcoming jobs will appear here.' : quickFilter === 'unscheduled' ? 'Jobs without an appointment will appear here.' : group === 'upcoming' ? 'Future scheduled work will appear here.' : group === 'history' ? 'Completed and canceled work will appear here.' : 'Choose another filter, return to Overview, or create a job.'}</p></div> : recordList.visible.map((job) => {
          const customer = Array.isArray(job.customers) ? job.customers[0] : job.customers
          const customerName = customer ? ([customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer') : 'Customer'
          const crew = team.filter(worker => job.assigned_user_ids?.includes(worker.id)).map(worker => worker.label)
          const action = nextJobAction(job, canWrite(business.role) && canAccess(business,'jobs'), canDispatch)
          const invoiceLink = canAccess(business,'billing') ? linkedJobInvoiceAction(job.invoice) : null
          const booked = hasActiveJobAppointment(job)
          const needsUpdate = jobNeedsStatusUpdate(job,now,timezone)
          return <article className="job-row module-job-card" key={job.id}>
            <div className="row-main module-job-main"><div className="module-job-time">{booked && job.active_appointment ? <><strong>{new Date(job.active_appointment.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: timezone })}</strong><span>{new Date(job.active_appointment.starts_at).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: timezone })}</span></> : <><strong>{job.status==='completed'?'Completed':job.status==='canceled'?'Canceled':'Not booked'}</strong><span>{['completed','canceled'].includes(job.status)?'History':'Appointment'}</span></>}</div><div className="module-job-copy"><strong className="job-card-title">{job.title}</strong><span>{customerName}</span>{job.properties?.[0] && <div className="job-location"><span className="job-location-address">{formatServiceAddress(job.properties[0])}</span><GoogleMapTools address={job.properties[0]} compact directionsOnly /></div>}{(teamScheduling || crew.length > 0) && <small className="module-job-crew">{crew.length ? `Crew · ${crew.join(', ')}` : 'Crew not assigned'}</small>}{canAccess(business,'billing') && job.invoice && <small>Invoice · {job.invoice.number || job.invoice.status} · {job.invoice.status.replaceAll('_',' ')}</small>}</div></div>
            <div className="module-job-actions">
              <span className={`module-record-status ${job.status === 'completed' ? 'is-positive' : job.status === 'lead' ? 'is-pending' : ''}`}>{jobStatusLabels[job.status as JobStatus] || job.status.replaceAll('_',' ')}</span>
              {needsUpdate && <span className="job-status-followup">Past appointment · confirm job status</span>}
              <div className="job-row-actions">
                <button type="button" className="primary-button compact" onClick={()=>openManagement(job.id)}>Manage</button><button type="button" className="secondary-button compact" onClick={()=>setDetailsJob({id:job.id})}>Open job</button>
                {action ? <button type="button" className="primary-button compact" disabled={busy} onClick={()=>action==='schedule'?setDispatch(job):action==='complete'?openManagement(job.id,true):void changeStatus(job.id,'in_progress')}>{action==='schedule'?'Schedule job':action==='start'?'Start job':'Mark complete'}</button> : job.status==='completed' && invoiceLink ? <a className="primary-button compact" href={invoiceLink.href}>{invoiceLink.label}</a> : null}
              </div>
            </div>
          </article>
        })}
      </section>}
      {layout!=='overview' && !loading && !error && <RecordListPagination label="jobs" list={recordList} className="jobs-bottom-pagination" />}
      </div>
      {detailsJob&&<JobDetailsDialog key={detailsJob.id} business={business} jobId={detailsJob.id} initialPhotos={detailsJob.initialPhotos} initialSchedule={detailsJob.initialSchedule} initialPlan={detailsJob.initialPlan} onCreateReminder={onCreateReminder} onUpdated={()=>void refresh().catch(err=>setError(readableError(err,'Unable to refresh jobs')))} onClose={()=>{setDetailsJob(null);void refresh().catch(err=>setError(readableError(err,'Unable to refresh jobs')))}}/>}
      {dispatch&&<DispatchJobDialog business={business} job={dispatch} needsAppointmentRepair={!hasActiveJobAppointment(dispatch)} onClose={()=>setDispatch(null)} onSaved={()=>{setInvoiceAction(null);setNotice('Appointment saved. Confirm the time with your customer.');void refresh().catch(()=>setError('The schedule was saved, but the list could not refresh. Select Refresh to load the updated jobs.'))}}/>}
      {showForm && <FormDialog label={jobFormLabel} busy={busy} onClose={closeJobForm}>
        <div className="modal-head"><div><p className="eyebrow">New job</p><h2>{jobFormLabel}</h2></div><button className="icon-button" onClick={closeJobForm} aria-label="Close" type="button">×</button></div>
        <form className="form-grid" onSubmit={submit}>
          <JobCustomerPicker key={accessKey} businessId={business.id} seed={customers.find(c=>c.id===form.customer_id)} value={form.customer_id} disabled={busy} onChange={customer_id => setForm(prev => ({ ...prev, customer_id, property_id: '' }))} />
          <QuickCustomer businessId={business.id} onCreated={customer=>{setCustomers(value=>[...value,customer]);setForm(value=>({...value,customer_id:customer.id,property_id:''}))}}/>
          <CustomerPropertySelect selectSingle businessId={business.id} customerId={form.customer_id} value={form.property_id} onChange={propertyId => setForm(prev => ({ ...prev, property_id: propertyId }))} disabled={busy} />
          <label className="full">{!requireAppointment&&!form.property_id&&<span><input type="checkbox" checked={noAddress} onChange={e=>setNoAddress(e.target.checked)}/> Continue with no service address (for remote work or an address to confirm)</span>}</label>
          <label className="full">Job title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Replace water heater" required /></label>
          <label className="full">Description<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          {bookingLimit&&<PlanRestriction plan="free" required="basic" feature="new job bookings" limit canUpgrade={isPrimaryOwner(business)}/>}
          <label className="full">{requireAppointment?'Starts':'Schedule ('+timezone+')'}<input type="datetime-local" required={requireAppointment} disabled={!canDispatch||bookingLimit} value={form.scheduled_start} onChange={(e) => setForm({ ...form, scheduled_start: e.target.value })} /></label>
          {requireAppointment&&<label className="full">Ends<input type="datetime-local" value={form.scheduled_end} disabled={bookingLimit} onChange={event=>setForm({...form,scheduled_end:event.target.value})}/></label>}
          {!requireAppointment&&form.scheduled_start&&canDispatch&&<><label>Job length<select value={newDuration} onChange={e=>setNewDuration(Number(e.target.value))}>{[30,60,90,120,180,240,360,480,720].map(n=><option key={n} value={n}>{n<60?`${n} minutes`:`${n/60} hours`}</option>)}</select></label>{teamScheduling && <fieldset className="guided-workers full"><legend>Assigned crew</legend>{team.filter(w=>w.active!==false).map(w=><label key={w.id}><input type="checkbox" checked={newCrew.includes(w.id)} onChange={e=>setNewCrew(value=>e.target.checked?[...value,w.id]:value.filter(id=>id!==w.id))}/>{w.label}{w.is_you?' (you)':''}</label>)}</fieldset>}</>}{error && <p className="form-message error-text full">{error}</p>}
          <div className="modal-actions full"><button type="button" className="secondary-button" onClick={closeJobForm}>Cancel</button><button className="primary-button" disabled={busy||bookingLimit&&(requireAppointment||!!form.scheduled_start)||!requireAppointment&&!!form.scheduled_start&&(!form.property_id&&!noAddress||!assignedWorkers.length)}>{busy ? 'Saving…' : requireAppointment ? 'Schedule job' : 'Save job'}</button></div>
        </form>
      </FormDialog>}
    </div>
  )
}
