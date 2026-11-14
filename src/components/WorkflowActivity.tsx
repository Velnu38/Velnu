import {useEffect,useRef,useState} from 'react'
import {DocumentTime} from './DocumentRecord'
import {getWorkflowActivity,workflowLabels,type WorkflowEvent} from '../services/workflowActivity'
import JourneyNoticeReview from './JourneyNoticeReview'
import {noticeStatus} from '../services/journeyNotices'

type WorkEntry={id:number;event:string;created_at:string;actor?:string}
export default function WorkflowActivity({businessId,jobId,invoiceId,timezone,entries=[],refreshKey='',canNotify=false}:{businessId:string;jobId?:string;invoiceId?:string;timezone?:string|null;entries?:WorkEntry[];refreshKey?:string;canNotify?:boolean}){
  const[events,setEvents]=useState<WorkflowEvent[]>([]),[page,setPage]=useState(-1),[total,setTotal]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const generation=useRef(0),flight=useRef(false)
  const scope=businessId+':'+(jobId||'')+':'+(invoiceId||'')
  const[loadedScope,setLoadedScope]=useState('')
  const[review,setReview]=useState<string|null>(null)
  useEffect(()=>setReview(null),[scope])
  async function load(append=false){
    if(flight.current)return
    flight.current=true;const token=generation.current;setBusy(true);setError('')
    try{const next=await getWorkflowActivity(businessId,{job:jobId,invoice:invoiceId},append?page+1:0)
      if(token===generation.current){setLoadedScope(scope);setEvents(previous=>append?[...previous,...next.items.filter(e=>!previous.some(p=>p.id===e.id))]:next.items);setPage(next.page);setTotal(next.total)}
    }catch{if(token===generation.current)setError('Workflow history is unavailable. Refresh to verify the latest activity.')}
    finally{if(token===generation.current){flight.current=false;setBusy(false)}}
  }
  useEffect(()=>{generation.current++;flight.current=false;setEvents([]);setPage(-1);setTotal(0);void load();return()=>{generation.current++}},[businessId,jobId,invoiceId,refreshKey])
  const visibleEvents=loadedScope===scope?events:[]
  const timeline=[...entries.map(e=>({id:'work:'+e.id,label:e.event,at:e.created_at,actor:e.actor||'Team',notice:undefined as WorkflowEvent['notice']})),...visibleEvents.map(e=>({id:e.id,label:workflowLabels[e.kind],at:e.created_at,actor:'Workflow',notice:e.notice}))].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||a.id.localeCompare(b.id))
  return <div aria-label="Workflow activity">
    {error&&<p role="alert">{error}</p>}{busy&&<p role="status">Loading workflow activity…</p>}
    <button type="button" className="text-button" disabled={busy} onClick={()=>void load()}>Refresh activity</button>
    {timeline.length?<ol className="jm-activity">{timeline.map(e=><li key={e.id}><strong>{e.label}</strong><small>{e.actor} · <DocumentTime value={e.at} timezone={timezone||undefined}/></small>{e.notice&&<small>Customer email: {noticeStatus(e.notice.status)}</small>}{canNotify&&visibleEvents.some(v=>v.id===e.id&&['appointment_changed','appointment_canceled'].includes(v.kind))&&<button type="button" className="text-button" onClick={()=>setReview(e.id)}>{e.notice&&!['pending','blocked'].includes(e.notice.status)?'View customer notice':'Review customer notice'}</button>}</li>)}</ol>:!busy&&!error&&<p className="quiet">No workflow activity recorded yet.</p>}
    {visibleEvents.some(e=>e.kind==='invoice_opened')&&<p className="quiet">A link opening can come from a preview or security scanner; it does not confirm that a person read the invoice.</p>}
    {loadedScope===scope&&events.length<total&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>void load(true)}>Load older activity</button>}
    {review&&<JourneyNoticeReview key={scope+review} businessId={businessId} eventId={review} onClose={()=>setReview(null)} onSaved={()=>void load()}/>}
  </div>
}
