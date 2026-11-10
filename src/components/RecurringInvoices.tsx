import { useEffect,useRef,useState,type FormEvent } from 'react'
import { DateTime } from 'luxon'
import type { CurrentBusiness } from '../lib/business'
import { isPrimaryOwner,canAccess } from '../lib/workspaceAccess'
import { useTierUsage } from '../lib/useTierUsage'
import { readableError } from '../lib/errors'
import { getScheduleTeam,type Worker } from '../services/schedulingWorkflow'
import { createRecurringPlan,listRecurringPlans,setRecurringStatus,type RecurringFilter,type RecurringOptions,type RecurringPlan } from '../services/recurringInvoices'
import FormDialog from './FormDialog'

const cadenceLabels={weekly:'Every week',fortnightly:'Every two weeks',monthly:'Every month',quarterly:'Every three months',yearly:'Every year'}

export function RecurringSchedulesDialog({business,onClose}:{business:CurrentBusiness;onClose:()=>void}){
 const usage=useTierUsage(business.id),[filter,setFilter]=useState<RecurringFilter>('current'),[plans,setPlans]=useState<RecurringPlan[]>([])
 const [counts,setCounts]=useState({active:0,paused:0,ended:0}),[more,setMore]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const generation=useRef(0),mounted=useRef(false),flight=useRef(false)
 async function load(append=false){
  const current=++generation.current;setLoading(true);setError('')
  try{const result=await listRecurringPlans(business.id,filter,append?plans.at(-1):undefined)
   if(!mounted.current||current!==generation.current)return
   setPlans(old=>append?[...old,...result.items.filter(row=>!old.some(item=>item.id===row.id))]:result.items);setCounts(result.counts);setMore(result.has_more)
  }catch(e){if(mounted.current&&current===generation.current)setError(readableError(e,'Unable to load recurring schedules.'))}
  finally{if(mounted.current&&current===generation.current)setLoading(false)}
 }
 useEffect(()=>{if(!isPrimaryOwner(business))return;mounted.current=true;setPlans([]);void load();return()=>{mounted.current=false;generation.current++}},[business.id,business.role,business.primary_owner,filter])
 async function change(plan:RecurringPlan){
  if(flight.current)return
  const next=plan.status==='active'?'paused':'active'
  if(!window.confirm(next==='paused'?'Pause future drafts and automatic visits? Existing invoices and booked visits remain unchanged.':'Resume this schedule? Missed dates are skipped. Due drafts and eligible future visits can be created; nothing is sent or charged.'))return
  flight.current=true;setBusy(true);setError('');setNotice('')
  try{await setRecurringStatus(plan.id,next);if(!mounted.current)return;setNotice('Schedule updated. Review its current state below. Existing invoices and booked visits are unchanged.');await load()}
  catch(e){if(mounted.current)setError(readableError(e,'The result is uncertain. Refresh before repeating this change.'))}
  finally{flight.current=false;if(mounted.current)setBusy(false)}
 }
 if(!isPrimaryOwner(business))return null
 return <FormDialog label="Recurring invoices" busy={busy} onClose={onClose} wide autoFocusFields={false}>
  <div className="modal-head"><div><p className="eyebrow">Invoices</p><h2>Recurring invoices</h2></div><button type="button" className="icon-button" aria-label="Close recurring invoices" onClick={onClose}>×</button></div>
  <p>Open a regular invoice and choose <strong>Repeat invoice</strong> to create a schedule. Each generated invoice remains a draft for your review.</p>
  <p className="quiet">No automatic sending or customer charging. Pausing does not cancel visits already booked.</p>
  <div data-editor-independent className="related-page-actions"><label>Show schedules<select value={filter} disabled={loading||busy} onChange={e=>setFilter(e.target.value as RecurringFilter)}><option value="current">Active and paused</option><option value="active">Active</option><option value="paused">Paused</option><option value="ended">Ended</option><option value="all">All</option></select></label><button type="button" className="secondary-button" disabled={loading||busy} onClick={()=>void load()}>Refresh schedules</button></div>
  <p>{counts.active} active · {counts.paused} paused · {counts.ended} ended</p>
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="error-text">{error}</p>}
  {loading&&!plans.length?<p role="status">Loading recurring schedules…</p>:!error&&!plans.length?<p>No schedules in this view.</p>:null}
  <div className="page-stack">{plans.map(plan=><article key={plan.id} className="detail-card"><h3>{plan.title}</h3><p><span className="status-chip">{plan.status}</span> · {cadenceLabels[plan.cadence as keyof typeof cadenceLabels]||plan.cadence} · Next date {plan.next_date}{plan.end_date?' · Ends '+plan.end_date:''}</p>
   <p className="quiet">{plan.schedule_visit?'Drafts and planned visits':'Invoice drafts only'} · {plan.timezone}{plan.schedule_visit?' · '+plan.visit_time.slice(0,5):''} · Payment due {plan.due_days} days after the invoice date.</p>
   {plan.last_error&&<p role="status" className="error-text">{plan.last_error}</p>}
   <div className="related-page-actions"><a href={'/?view=invoices&document='+encodeURIComponent(plan.source_invoice_id)}>Open source invoice</a>{plan.status!=='ended'&&<button type="button" className="secondary-button" disabled={busy||loading||(plan.status==='paused'&&(!usage||usage.plan==='free'))} onClick={()=>void change(plan)}>{plan.status==='active'?'Pause schedule':'Resume schedule'}</button>}</div>
   <details><summary>Recent history ({plan.occurrences.length}, up to 12)</summary>{!plan.occurrences.length?<p>No occurrences yet.</p>:<ul>{plan.occurrences.map(item=><li key={item.id}>{item.bill_date} {item.invoice_id&&<a href={'/?view=invoices&document='+encodeURIComponent(item.invoice_id)}>Open invoice</a>} {item.job_id&&canAccess(business,'jobs')&&<a href={'/?view=work&document='+encodeURIComponent(item.job_id)}>Manage visit</a>} {!item.invoice_id&&!item.job_id&&'Awaiting its due date'}{item.schedule_error&&<p role="status">{item.schedule_error}</p>}</li>)}</ul>}</details>
  </article>)}</div>
  {more&&<button type="button" className="secondary-button" disabled={loading||busy} onClick={()=>void load(true)}>{loading?'Loading…':'Load more schedules'}</button>}
  <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Close</button></div>
 </FormDialog>
}

export function RepeatInvoiceDialog({business,invoiceId,invoiceNumber,onClose,onSaved}:{business:CurrentBusiness;invoiceId:string;invoiceNumber:string;onClose:()=>void;onSaved:()=>void}){
 const usage=useTierUsage(business.id),zone=business.timezone||'America/New_York',today=DateTime.now().setZone(zone).toISODate()!
 const [form,setForm]=useState<RecurringOptions>(()=>({title:'Repeat '+invoiceNumber,cadence:'monthly',first_date:DateTime.now().setZone(zone).plus({months:1}).toISODate()!,end_date:'',due_days:30,schedule_visit:false,visit_time:'09:00',duration_minutes:60,workers:[]}))
 const [team,setTeam]=useState<Worker[]>([]),[teamError,setTeamError]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[notice,setNotice]=useState('')
 const flight=useRef(false),retry=useRef<{signature:string;id:string}|null>(null),mounted=useRef(false)
 const canVisit=usage?.plan==='pro'&&canAccess(business,'jobs')&&canAccess(business,'calendar')
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 useEffect(()=>{let active=true;if(!canVisit)return;void getScheduleTeam(business.id).then(rows=>{if(active)setTeam(rows.filter(w=>w.active!==false))}).catch(()=>{if(active)setTeamError('Worker profiles could not be loaded. Refresh before enabling planned visits.')});return()=>{active=false}},[business.id,canVisit])
 async function submit(event:FormEvent){
  event.preventDefault();if(flight.current||saved)return
  if(!usage||usage.plan==='free'){setError('Recurring drafts require Individual or Business Pro.');return}
  if(form.first_date<today||(form.end_date&&form.end_date<form.first_date)){setError('Choose a first date from today and an end date on or after it.');return}
  if(form.schedule_visit&&(!canVisit||teamError)){setError('Verify Business Pro, calendar access and worker profiles before enabling visits.');return}
  const options={...form,title:form.title.trim()},signature=JSON.stringify({invoiceId,options})
  if(retry.current?.signature!==signature)retry.current={signature,id:crypto.randomUUID()}
  flight.current=true;setBusy(true);setError('')
  try{const result=await createRecurringPlan(invoiceId,retry.current.id,options);if(!mounted.current)return;setSaved(true);setNotice(result.status==='active'?'Schedule created. Review each generated draft before sending.':'Schedule saved as '+result.status+'. Open Recurring invoices to review its status.');onSaved()}
  catch(e){if(mounted.current)setError(readableError(e,'The schedule result is uncertain. Retry the same settings to confirm it.'))}
  finally{flight.current=false;if(mounted.current)setBusy(false)}
 }
 if(!isPrimaryOwner(business))return null
 return <FormDialog label="Repeat invoice" busy={busy} onClose={onClose} cleanVersion={saved}>
  <div className="modal-head"><h2>Repeat invoice</h2><button type="button" className="icon-button" aria-label="Close recurring setup" onClick={onClose}>×</button></div>
  <p>Use the saved line items and prices from <strong>{invoiceNumber}</strong> for future drafts. Later changes to the source invoice do not change this schedule.</p>
  <p className="quiet">Dates use {zone}. Nothing is sent to the customer or charged automatically.</p>
  {saved?<><p role="status">{notice}</p><a href="/?view=invoices&recurring=1">Open recurring schedules</a><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Close</button></div></>:<form className="form-grid" onSubmit={submit}>
   <label className="full">Schedule name<input value={form.title} maxLength={200} required onChange={e=>setForm({...form,title:e.target.value})}/></label>
   <label>Repeat<select value={form.cadence} onChange={e=>setForm({...form,cadence:e.target.value as RecurringOptions['cadence']})}>{Object.entries(cadenceLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   <label>First invoice date<input type="date" min={today} value={form.first_date} required onChange={e=>setForm({...form,first_date:e.target.value})}/></label>
   <label>End date (optional)<input type="date" min={form.first_date} value={form.end_date} onChange={e=>setForm({...form,end_date:e.target.value})}/></label>
   <label>Days until payment is due<input type="number" min={0} max={365} step={1} value={form.due_days} required onChange={e=>setForm({...form,due_days:Number(e.target.value)})}/></label>
   {canVisit&&<label className="full"><input type="checkbox" checked={form.schedule_visit} onChange={e=>setForm({...form,schedule_visit:e.target.checked})}/> Also plan recurring visits</label>}
   {form.schedule_visit&&<><p className="quiet full">Visits use your internal worker roster. No accounts, invitations or employee notifications are created. Conflicts and daylight-saving changes can require manual review.</p><label>Visit time ({zone})<input type="time" value={form.visit_time} required onChange={e=>setForm({...form,visit_time:e.target.value})}/></label><label>Visit duration (minutes)<input type="number" min={15} max={720} step={1} value={form.duration_minutes} required onChange={e=>setForm({...form,duration_minutes:Number(e.target.value)})}/></label><fieldset className="full"><legend>Assign workers (up to 20 per visit)</legend>{team.map(worker=><label key={worker.id}><input type="checkbox" checked={form.workers.includes(worker.id)} onChange={e=>setForm({...form,workers:e.target.checked?[...form.workers,worker.id]:form.workers.filter(id=>id!==worker.id)})}/>{worker.label}</label>)}{teamError&&<p role="alert">{teamError}</p>}</fieldset></>}
   {error&&<p role="alert" className="full error-text">{error}</p>}
   <div className="modal-actions full"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy||!usage||usage.plan==='free'}>{busy?'Saving…':'Create recurring schedule'}</button></div>
  </form>}
 </FormDialog>
}
