import PlanRestriction from '../PlanRestriction'
import {isPrimaryOwner} from '../../lib/workspaceAccess'
import { useTierUsage } from '../../lib/useTierUsage'
import {useEffect,useRef,useState} from 'react'
import {DateTime} from 'luxon'
import type {CurrentBusiness} from '../../lib/business'
import {localInstant} from '../../lib/calendarTime'
import FormDialog from '../FormDialog'
import {bookInvoiceJob,getInvoiceJobContext,type InvoiceJobContext} from '../../services/schedulingWorkflow'

export default function InvoiceJobDialog({business,invoiceId,onClose,onSaved}:{business:CurrentBusiness;invoiceId:string;onClose:()=>void;onSaved:(result:{job_id:string;already_created:boolean})=>void}) {
 const zone=business.timezone || 'America/New_York',saving=useRef(false),request=useRef(crypto.randomUUID())
 const usage=useTierUsage(business.id)
 const plan=usage?.plan
 const teamScheduling=plan==='pro'||plan==='basic'
 const bookingLimit=usage?.plan==='free'&&usage.jobs_limit!==null&&usage.jobs_used>=usage.jobs_limit
 const [context,setContext]=useState<InvoiceJobContext|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const [title,setTitle]=useState(''),[site,setSite]=useState(''),[selectedWorkers,setWorkers]=useState<string[]>([]),[start,setStart]=useState(''),[duration,setDuration]=useState(120)
 useEffect(()=>{let active=true;void getInvoiceJobContext(invoiceId).then(c=>{if(!active)return;setContext(c);setTitle(c.invoice.title);setSite(c.invoice.property_id || (c.properties?.length===1?c.properties[0].id:''));setWorkers(c.team.filter(w=>w.is_you).slice(0,1).map(w=>w.id));setDuration(c.preferences.duration_minutes);if(c.schedule){setStart(DateTime.fromISO(c.schedule.starts_at).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm"));setDuration(Math.round(DateTime.fromISO(c.schedule.ends_at).diff(DateTime.fromISO(c.schedule.starts_at),'minutes').minutes))}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[invoiceId,zone])
 const workers = teamScheduling ? selectedWorkers : context?.team.filter(worker => worker.is_you).map(worker => worker.id) ?? []
 async function save(){if(saving.current||bookingLimit||!context)return;saving.current=true;setBusy(true);setError('');try{const end=DateTime.fromISO(start,{zone}).plus({minutes:duration}).toFormat("yyyy-MM-dd'T'HH:mm");const result=await bookInvoiceJob(invoiceId,request.current,{title:title.trim(),property_id:site||null,workers:[...workers].sort(),starts_at:localInstant(start,zone),ends_at:localInstant(end,zone)});onSaved(result);onClose()}catch(e){setError(e instanceof Error?e.message:'Unable to create the scheduled job.')}finally{saving.current=false;setBusy(false)}}
 return <FormDialog label="Schedule job from invoice" busy={busy} onClose={onClose} wide>
  <div className="modal-head"><div><p className="eyebrow">Invoice to job</p><h2>Schedule the work</h2></div><button type="button" className="icon-button" aria-label="Close scheduling" onClick={onClose}>×</button></div>
  {!context&&!error&&<p role="status">Loading the customer and work…</p>}
  {context&&<><div className="guided-summary"><strong>{context.invoice.customer_name} · {context.invoice.number || 'Invoice'}</strong><p>{context.invoice.scope}</p></div>
   {context.invoice.job_id?<p>This invoice already has a job. <a href={'/?view=work&document='+encodeURIComponent(context.invoice.job_id)}>Open linked job</a> to review its details and schedule.</p>:<form onSubmit={e=>{e.preventDefault();void save()}} className="form-grid">
    <label>Agreed start ({zone})<input type="datetime-local" required autoFocus value={start} onChange={e=>setStart(e.target.value)}/></label>
    <label>Job length<select value={duration} onChange={e=>setDuration(Number(e.target.value))}>{[...new Set([15,30,45,60,90,120,180,240,360,480,600,720,duration])].sort((a,b)=>a-b).map(n=><option key={n} value={n}>{n<60?n+' minutes':n/60+' hours'}</option>)}</select></label>
    <label className="full">Service address<select aria-label="Service address" value={site} onChange={e=>setSite(e.target.value)}><option value="">No saved service address</option>{context.properties?.map(p=><option key={p.id} value={p.id}>{p.label?p.label+' · ':''}{p.address}</option>)}</select></label>
    <details className="full"><summary>{teamScheduling ? 'Job name and crew' : 'Job name'}{teamScheduling && (workers.length===1?' · '+(context.team.find(w=>w.id===workers[0])?.label || '1 selected'): ' · '+workers.length+' selected')}</summary><label>Job name<input required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label>{teamScheduling && <fieldset className="guided-workers"><legend>Assigned crew</legend>{context.team.map(w=><label key={w.id}><input type="checkbox" checked={workers.includes(w.id)} onChange={e=>setWorkers(v=>e.target.checked?[...v,w.id]:v.filter(id=>id!==w.id))}/>{w.label}{w.is_you?' (you)':''}</label>)}</fieldset>}</details>
    {plan==='free'&&<PlanRestriction plan={plan} required="basic" feature="Crew assignment" canUpgrade={isPrimaryOwner(business)}/>}
    {bookingLimit&&<PlanRestriction plan="free" required="basic" feature="new job bookings" limit canUpgrade={isPrimaryOwner(business)}/>}
    <p className="quiet full">Customer, scope and invoice stay linked. The end time is calculated for you. Saving checks availability and creates one job and calendar event. This does not send a customer message or change the invoice balance.</p>
    {teamScheduling&&!workers.length&&<p role="status" className="full">Choose a crew member under Job name and crew.</p>}
    <div className="modal-actions full"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button attention-action" disabled={busy||bookingLimit||!workers.length||!title.trim()}>{busy?'Scheduling…':'Create job & schedule'}</button></div>
   </form>}
  </>}
  {error&&<p role="alert" className="form-message error-text">{error}</p>}
 </FormDialog>
}
