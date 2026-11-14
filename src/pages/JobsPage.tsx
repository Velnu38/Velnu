import {flushSync} from 'react-dom'
import {useEffect,useRef,useState,type FormEvent} from 'react'
import {DateTime} from 'luxon'
import {canWrite,type CurrentBusiness} from '../lib/business'
import {canAccess,isPrimaryOwner} from '../lib/workspaceAccess'
import {confirmNavigation} from '../lib/unsavedChanges'
import {useBusinessRefresh} from '../lib/useBusinessRefresh'
import {localInstant} from '../lib/calendarTime'
import {readableError} from '../lib/errors'
import {formatServiceAddress} from '../lib/googleMaps'
import {hasActiveJobAppointment,jobNeedsStatusUpdate,jobStatusLabels,linkedJobInvoiceAction,type JobStatus} from '../lib/jobActions'
import {searchJobCustomers} from '../services/customers'
import type {CustomerName} from '../lib/customerRecords'
import {createJob,getJobDirectoryPage,updateJobStatus,type JobDirectoryFilter} from '../services/jobs'
import {getScheduleTeam,type Worker} from '../services/schedulingWorkflow'
import type {ReminderJob} from '../services/reminders'
import {useTierUsage} from '../lib/useTierUsage'
import JobManagementWorkspace from '../components/JobManagementWorkspace'
import ApprovedJobQueue from '../components/ApprovedJobQueue'
import JobCustomerPicker from '../components/JobCustomerPicker'
import QuickCustomer from '../components/scheduling/QuickCustomer'
import CustomerPropertySelect from '../components/CustomerPropertySelect'
import FormDialog from '../components/FormDialog'
import WorkspaceBack from '../components/WorkspaceBack'
import CustomerRecordScope from '../components/CustomerRecordScope'
import RefreshButton from '../components/RefreshButton'
import PlanRestriction from '../components/PlanRestriction'
import {RecordListPagination} from '../components/RecordListControls'
import '../components/operations.css'
import '../components/job-management.css'
import '../components/job-phone.css'
import '../components/jobs-directory.css'
import '../components/unified-jobs.css'
import '../components/kanban.css'

type Job=Awaited<ReturnType<typeof getJobDirectoryPage>>['items'][number]
const views:{id:JobDirectoryFilter|'approved';label:string}[]=[{id:'active',label:'Active jobs'},{id:'all',label:'All jobs'},{id:'today',label:'Today'},{id:'upcoming',label:'Upcoming'},{id:'unscheduled',label:'Needs scheduling'},{id:'in_progress',label:'In progress'},{id:'attention',label:'Needs attention'},{id:'unassigned',label:'Crew not assigned'},{id:'scheduled',label:'Scheduled'},{id:'billing',label:'Ready to invoice'},{id:'approved',label:'Approved work'},{id:'history',label:'History'},{id:'completed',label:'Completed'}]
const sections=['tasks','schedule','materials','photos','changes','billing','activity','reports'] as const
export default function JobsPage({business,embedded=false,onCreateReminder}:{business:CurrentBusiness;embedded?:boolean;onCreateReminder?:(job:ReminderJob)=>void}){
 const initial=useRef(new URLSearchParams(location.search)).current,customerScope=initial.get('customer')||''
 const zone=business.timezone||'UTC',canEdit=canWrite(business.role)&&canAccess(business,'jobs'),canSchedule=canEdit&&canAccess(business,'calendar')&&['owner','admin','office'].includes(business.role),canBill=canAccess(business,'billing')&&['owner','admin','office'].includes(business.role)
 const accessKey=[business.id,business.role,business.access_modules?.join(','),customerScope].join(':')
 const active=useRef(true),scope=useRef(accessKey);scope.current=accessKey
 useEffect(()=>{active.current=true;return()=>{active.current=false}},[accessKey])
 const [selected,setSelected]=useState(initial.get('job')||initial.get('document'))
 const requestedSection=initial.get('section')||initial.get('tab')||''
 const [section,setSection]=useState<(typeof sections)[number]|'overview'>(requestedSection==='photos-expenses'?'photos':sections.includes(requestedSection as any)?requestedSection as (typeof sections)[number]:initial.get('plan')==='1'?'tasks':'overview')
 const [intent,setIntent]=useState<'schedule'|undefined>(selected&&initial.get('schedule')==='1'?'schedule':undefined)
 const [filter,setFilter]=useState<JobDirectoryFilter|'approved'>(views.some(v=>v.id===initial.get('jobFilter'))?initial.get('jobFilter') as JobDirectoryFilter:customerScope?'all':'active')
 const [scopeName,setScopeName]=useState<{key:string;customer:CustomerName}|null>(null)
 useEffect(()=>{let current=true;if(customerScope)void searchJobCustomers(business.id,'',customerScope).then(r=>{if(current&&r.selected)setScopeName({key:business.id+':'+customerScope,customer:r.selected})}).catch(()=>{});return()=>{current=false}},[business.id,customerScope])
 const effectiveFilter=filter==='billing'&&!canBill?'active':filter
 const [search,setSearch]=useState(initial.get('jobSearch')||''),[query,setQuery]=useState(search),[page,setPage]=useState(Math.max(0,Number(initial.get('jobPage'))||0)),[worker,setWorker]=useState(initial.get('jobWorker')||'all'),[layout,setLayout]=useState<'list'|'board'>(initial.get('layout')==='board'?'board':'list'),[filtersOpen,setFiltersOpen]=useState(false)
 const [result,setResult]=useState<{key:string;data:Awaited<ReturnType<typeof getJobDirectoryPage>>}|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[notice,setNotice]=useState('')
 const [team,setTeam]=useState<Worker[]>([]),[now,setNow]=useState(Date.now())
 useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),60000);return()=>window.clearInterval(timer)},[])
 const usage=useTierUsage(business.id),teamScheduling=usage?.plan==='pro'||usage?.plan==='basic',limit=usage?.plan==='free'&&usage.jobs_limit!==null&&usage.jobs_used>=usage.jobs_limit
 const scroll=useRef(Number(history.state?.jobListScroll)||0),restore=useRef(!selected&&Number.isFinite(history.state?.jobListScroll)),heading=useRef<HTMLHeadingElement>(null)
 const key=JSON.stringify([accessKey,effectiveFilter,query,page,teamScheduling?worker:'all',revision])
 const data=result?.key===key?result.data:null,loading=!data&&!error&&effectiveFilter!=='approved'
 useEffect(()=>{const t=setTimeout(()=>setQuery(search.trim()),200);return()=>clearTimeout(t)},[search])
 useEffect(()=>{let active=true;setError('');if(effectiveFilter!=='approved'&&!selected)void getJobDirectoryPage(business.id,{customerId:customerScope,filter:effectiveFilter,workerId:teamScheduling&&worker!=='all'?worker:undefined,search:query,page}).then(data=>{if(active)setResult({key,data})}).catch(e=>{if(active)setError(readableError(e,'Could not load jobs.'))});return()=>{active=false}},[key,selected])
 useEffect(()=>{let active=true;void getScheduleTeam(business.id).then(rows=>{if(active){setTeam(rows);setCrew(rows.filter(w=>w.is_you&&w.active!==false).map(w=>w.id))}}).catch(()=>{});return()=>{active=false}},[accessKey])
 useBusinessRefresh(business.id,()=>setRevision(v=>v+1))
 useEffect(()=>{if(selected)return;const url=new URL(location.href);url.searchParams.set('jobFilter',effectiveFilter);for(const [name,value]of [['jobSearch',search],['jobPage',String(page)],['jobWorker',worker],['layout',layout]]){if(value&&value!=='0'&&value!=='all'&&value!=='list')url.searchParams.set(name,value);else url.searchParams.delete(name)}history.replaceState(history.state,'',url.pathname+url.search)},[effectiveFilter,search,page,worker,layout,selected])
 useEffect(()=>{if(!selected&&!loading&&restore.current){restore.current=false;requestAnimationFrame(()=>window.scrollTo({top:scroll.current}))}},[selected,loading])
 function openJob(id:string,next:typeof section='overview',action?:'schedule'){
  if(!confirmNavigation())return
  scroll.current=window.scrollY;history.replaceState({...history.state,jobListScroll:scroll.current},'',location.href);setSection(next);setIntent(action);setSelected(id)
  const url=new URL(location.href);url.searchParams.set('view','work');url.searchParams.set('job',id);url.searchParams.set('section',next);for(const name of ['document','workspace','panel','billing','new','schedule'])url.searchParams.delete(name)
  if(action)url.searchParams.set('schedule','1')
  history.pushState({...history.state,finviantIndex:(Number(history.state?.finviantIndex)||0)+1},'',url.pathname+url.search)
  requestAnimationFrame(()=>window.scrollTo({top:0}))
 }
 function backToJobs(){if(!confirmNavigation())return;const url=new URL(location.href);for(const name of ['job','document','workspace','section','panel','billing','schedule','tab','complete'])url.searchParams.delete(name);history.replaceState(history.state,'',url.pathname+url.search);restore.current=true;setSelected(null);setIntent(undefined)}
 const [showForm,setShowForm]=useState(initial.get('new')==='1'&&canEdit),[addVisit,setAddVisit]=useState(!selected&&(initial.get('schedule')==='1'||!!initial.get('day'))),[busy,setBusy]=useState(false),[formError,setFormError]=useState(''),[crew,setCrew]=useState<string[]>([]),[duration,setDuration]=useState(120),[noAddress,setNoAddress]=useState(false)
 const [form,setForm]=useState({title:'',customer_id:customerScope,property_id:'',description:'',start:initial.get('day')?initial.get('day')+'T09:00':'',end:''})
 const formRequest=useRef<{signature:string;id:string}|null>(null),saving=useRef(false),created=useRef<string|null>(null)
 const assigned=teamScheduling?crew:team.filter(w=>w.is_you&&w.active!==false).map(w=>w.id)
 useEffect(()=>{if(initial.get('new')){const url=new URL(location.href);for(const name of ['new','day','schedule'])url.searchParams.delete(name);history.replaceState(history.state,'',url.pathname+url.search)}},[])
 function closeForm(){if(busy)return;setShowForm(false);created.current=null;setFormError('');setAddVisit(false);setForm({title:'',customer_id:customerScope,property_id:'',description:'',start:'',end:''});formRequest.current=null}
 async function submit(event:FormEvent){
  event.preventDefault();if(saving.current||!canEdit)return;const submittedScope=accessKey;saving.current=true;setBusy(true);setFormError('')
  try{
   if(created.current){setShowForm(false);openJob(created.current);return}
   if(addVisit&&(!canSchedule||limit))throw Error('Scheduling is not available for this job.')
   if(addVisit&&!assigned.length)throw Error('Choose an active crew member.')
   if(addVisit&&!form.property_id&&!noAddress)throw Error('Choose a service location or confirm no service address.')
   const start=addVisit?localInstant(form.start,zone):undefined,end=start?(form.end?localInstant(form.end,zone):DateTime.fromISO(start).plus({minutes:duration}).toISO()!):undefined
   if(start&&end&&Date.parse(end)<=Date.parse(start))throw Error('The end time must be after the start time.')
   const payload={customer_id:form.customer_id,property_id:form.property_id||undefined,title:form.title,description:form.description,scheduled_start:start,scheduled_end:end,...(start?{assigned_user_ids:assigned}:{})},signature=JSON.stringify(payload)
   if(formRequest.current?.signature!==signature)formRequest.current={signature,id:crypto.randomUUID()}
   const job=await createJob(business.id,{...payload,request_id:formRequest.current.id});if(!active.current||scope.current!==submittedScope)return;created.current=job.id
   setNotice(addVisit?'Job and first visit saved.':'Job saved.');flushSync(()=>setShowForm(false));setRevision(v=>v+1);openJob(job.id)
   setForm({title:'',customer_id:customerScope,property_id:'',description:'',start:'',end:''});formRequest.current=null
  }catch(e){if(active.current&&scope.current===submittedScope)setFormError(readableError(e,'Could not save this job. Retry this same form.'))}finally{saving.current=false;if(active.current&&scope.current===submittedScope)setBusy(false)}
 }
 async function startJob(job:Job){
  if(saving.current||!canEdit||!hasActiveJobAppointment(job)||!job.scheduled_start||Date.parse(job.scheduled_start)>Date.now())return
  const submittedScope=accessKey;saving.current=true;setBusy(true);setError('')
  try{await updateJobStatus(job.id,'in_progress');if(active.current&&scope.current===submittedScope){setNotice('Job started.');setRevision(v=>v+1)}}catch(e){if(active.current&&scope.current===submittedScope)setError(readableError(e,'Could not start this job. Refresh before retrying.'))}finally{saving.current=false;if(active.current&&scope.current===submittedScope)setBusy(false)}
 }
 const list={visible:data?.items||[],search,page:data?.page??page,pages:Math.max(1,Math.ceil((data?.total||0)/25)),total:data?.total||0,setSearch:(v:string)=>{setSearch(v.slice(0,200));setPage(0)},setPage:(v:number|((p:number)=>number))=>setPage(v)}
 function card(job:Job){const person=job.customers[0],name=person?[person.first_name,person.last_name].filter(Boolean).join(' ')||person.company:'Customer',booked=hasActiveJobAppointment(job),needsUpdate=jobNeedsStatusUpdate(job,new Date(now),zone),invoice=canBill?linkedJobInvoiceAction(job.invoice):null
  return <article className="module-job-card jobs-directory-card" key={job.id}><div className="jobs-directory-copy"><button type="button" className="unified-job-title" onClick={()=>openJob(job.id)} aria-label={'Open job '+job.title}>{job.title}<span aria-hidden="true">›</span></button><span className="jobs-directory-customer">{name}</span>{job.properties[0]&&<span className="jobs-directory-location">{formatServiceAddress(job.properties[0])}</span>}<div className="jobs-directory-meta"><span className="module-record-status">{jobStatusLabels[job.status as JobStatus]||job.status}</span><span className="jobs-directory-visit">{booked?'Next visit · '+DateTime.fromISO(job.active_appointment!.starts_at).setZone(zone).toFormat('MMM d · h:mm a'):'No active visit'}</span></div>{job.assigned_user_ids?.length>0&&<small>Crew · {job.assigned_user_ids.map((id:string)=>team.find(w=>w.id===id)?.label||'Team member').join(', ')}</small>}</div><div className="jobs-directory-actions">{needsUpdate&&<span className="module-record-status is-overdue">Past visit · Confirm job status</span>}
   {canSchedule&&!booked&&['lead','scheduled'].includes(job.status)?<button type="button" className="primary-button" onClick={()=>openJob(job.id,'schedule','schedule')}>Schedule visit</button>:canEdit&&booked&&['lead','scheduled'].includes(job.status)?<button type="button" className="secondary-button" disabled={busy} onClick={()=>needsUpdate?openJob(job.id):Date.parse(job.scheduled_start||'')<=now?void startJob(job):openJob(job.id,'schedule')}>{needsUpdate?'Review job status':Date.parse(job.scheduled_start||'')<=now?'Start job':'Review visit'}</button>:job.status==='in_progress'&&canEdit?<button type="button" className="secondary-button" onClick={()=>openJob(job.id,'tasks')}>Open checklist</button>:job.status==='completed'&&canBill?<a className="primary-button" href={invoice?.href||'/?view=invoices&job='+job.id}>{invoice?.label||'Review charges'}</a>:null}
  </div></article>
 }
 const Heading=embedded?'h2':'h1'
 return <div className={'page-stack workspace-module jobs-module unified-jobs'+(selected?' phone-job-page':'')}>
  {selected?<><div className="unified-job-heading"><button type="button" className="back-button" onClick={backToJobs}>‹ All jobs</button><span>Job Management</span></div><JobManagementWorkspace key={accessKey+':'+selected} business={business} jobId={selected} team={team} revision={revision} onUpdated={()=>setRevision(v=>v+1)} initialSection={section} initialComplete={canEdit&&initial.get('complete')==='1'} initialIntent={intent} onCreateReminder={onCreateReminder}/></>:<>
   <WorkspaceBack/><header className="page-heading module-page-heading"><Heading ref={heading}>Job Management</Heading>{canEdit&&<button type="button" className="primary-button" onClick={()=>{created.current=null;setShowForm(true)}}>＋ New job</button>}</header>
   <CustomerRecordScope customerId={customerScope} customers={scopeName?.key===business.id+':'+customerScope?[scopeName.customer]:(data?.items||[]).flatMap(j=>j.customers)} view="work"/>{notice&&<p role="status">{notice}</p>}
   <div className="jobs-search-filter-row"><div className="record-list-controls jobs-directory-search"><label>Search jobs<input type="search" aria-label="Search jobs" value={search} maxLength={200} onChange={e=>{setSearch(e.target.value);setPage(0)}} placeholder="Job, customer or location"/></label></div><button type="button" className="jobs-filter-toggle" aria-label={filtersOpen?'Close filters':'Open filters'} aria-expanded={filtersOpen} onClick={()=>setFiltersOpen(v=>!v)}><span aria-hidden="true">▽</span></button></div>
   <div className="unified-view-row"><label><span className="sr-only">Job view</span><select value={effectiveFilter} onChange={e=>{setFilter(e.target.value as typeof filter);setPage(0)}}>{views.filter(v=>v.id!=='billing'||canBill).map(v=><option key={v.id} value={v.id}>{v.label}{v.id!=='approved'&&data?.counts[v.id]!==undefined?' · '+data.counts[v.id]:''}</option>)}</select></label><span>{effectiveFilter==='approved'?'Approved work':data?data.total+' jobs':'Loading…'}</span></div>
   {effectiveFilter!=='approved'&&<div className="kanban-view-controls"><div role="group" aria-label="Job layout">{(['list','board'] as const).map(v=><button type="button" key={v} className="secondary-button" aria-pressed={layout===v} onClick={()=>setLayout(v)}>{v==='list'?'List':'Board'}</button>)}</div><p className="quiet">Board groups this page by work status. Open a job to review tasks, billing and status changes.</p></div>}
   {filtersOpen&&<section className="unified-filters" aria-label="Job filters">{teamScheduling&&<label>Assigned team member<select value={worker} onChange={e=>{setWorker(e.target.value);setPage(0)}} disabled={effectiveFilter==='approved'}><option value="all">Everyone</option>{team.map(w=><option key={w.id} value={w.id}>{w.label}</option>)}</select></label>}<RefreshButton busy={loading} onClick={()=>setRevision(v=>v+1)}/></section>}
   {error&&<p role="alert">{error} <button type="button" className="text-button" onClick={()=>setRevision(v=>v+1)}>Retry jobs</button></p>}
   {effectiveFilter==='approved'?<ApprovedJobQueue page={page} onPage={setPage} business={business} customerScope={customerScope} search={query} revision={revision} onOpen={id=>openJob(id)}/>:<>
    {loading?<p role="status">Loading jobs…</p>:!error&&<section className={layout==='board'?'job-board workflow-kanban':'module-record-list jobs-record-list'} aria-label={layout==='board'?'Job Management Kanban':'Jobs'} tabIndex={layout==='board'?0:undefined}>{layout==='board'?['lead','scheduled','in_progress','completed','canceled'].map(status=>{const jobs=(data?.items||[]).filter(j=>(['lead','scheduled'].includes(j.status)&&!hasActiveJobAppointment(j)?'lead':j.status)===status);return <section key={status} className="job-board-column workflow-lane" aria-label={jobStatusLabels[status as JobStatus]}><header><h2>{jobStatusLabels[status as JobStatus]}</h2><span>{jobs.length} on this page</span></header>{jobs.map(card)}{!jobs.length&&<p className="quiet">No matches on this page.</p>}</section>}):(data?.items||[]).map(card)}{!data?.items.length&&<p>No matching jobs. Choose another view, change your search or create a job.</p>}</section>}
    {!loading&&!error&&<><RecordListPagination label="jobs" list={list}/>{layout==='board'&&<p className="quiet">Board shows this page of results. Use pagination to see more jobs.</p>}</>}
   </>}
  </>}
  {showForm&&<FormDialog label="Create a job" busy={busy} onClose={closeForm} autoFocusFields={false}><header className="modal-head"><h2>New job</h2><button type="button" className="icon-button" aria-label="Close" disabled={busy} onClick={closeForm}>×</button></header><form className="form-grid" onSubmit={submit}>
   <JobCustomerPicker key={accessKey} businessId={business.id} value={form.customer_id} disabled={busy} onChange={id=>setForm(v=>({...v,customer_id:id,property_id:''}))}/><QuickCustomer businessId={business.id} onCreated={c=>setForm(v=>({...v,customer_id:c.id,property_id:''}))}/>
   <label className="full">Job title<input required maxLength={240} value={form.title} onChange={e=>setForm(v=>({...v,title:e.target.value}))}/></label>
   <CustomerPropertySelect selectSingle businessId={business.id} customerId={form.customer_id} value={form.property_id} onChange={property_id=>setForm(v=>({...v,property_id}))} disabled={busy}/>
   <details className="full"><summary>Notes &amp; access instructions</summary><label>Description<textarea maxLength={4000} value={form.description} onChange={e=>setForm(v=>({...v,description:e.target.value}))}/></label></details>
   {canSchedule&&<label className="full settings-checkbox"><input type="checkbox" checked={addVisit} disabled={busy||!!limit} onChange={e=>setAddVisit(e.target.checked)}/>Add first visit</label>}
   {limit&&<PlanRestriction plan="free" required="basic" feature="new job bookings" limit canUpgrade={isPrimaryOwner(business)}/>}
   {addVisit&&canSchedule?<><label className="full">Starts ({zone})<input type="datetime-local" required value={form.start} onChange={e=>setForm(v=>({...v,start:e.target.value}))}/></label><label>Job length<select value={duration} onChange={e=>setDuration(Number(e.target.value))}>{[30,60,90,120,180,240,360,480,720].map(n=><option key={n} value={n}>{n} minutes</option>)}</select></label><details><summary>Custom end time</summary><label>Ends<input type="datetime-local" value={form.end} onChange={e=>setForm(v=>({...v,end:e.target.value}))}/></label></details>{teamScheduling&&<fieldset className="guided-workers full"><legend>Assigned crew</legend>{team.filter(w=>w.active!==false).map(w=><label key={w.id}><input type="checkbox" checked={crew.includes(w.id)} onChange={e=>setCrew(v=>e.target.checked?[...v,w.id]:v.filter(id=>id!==w.id))}/>{w.label}{w.is_you?' (you)':''}</label>)}</fieldset>}{!form.property_id&&<label className="full settings-checkbox"><input type="checkbox" checked={noAddress} onChange={e=>setNoAddress(e.target.checked)}/>Continue with no service address (remote work or address to confirm)</label>}</>:<p className="quiet full">You can schedule this job later.</p>}
   {formError&&<p role="alert" className="full">{formError}</p>}<div className="modal-actions full"><button type="submit" className="primary-button" disabled={busy||!!limit&&addVisit}>{busy?'Saving…':addVisit?'Create & schedule':'Create job'}</button></div>
  </form></FormDialog>}
 </div>
}
