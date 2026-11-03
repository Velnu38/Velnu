import { lazy,Suspense,useEffect,useState } from 'react'
import type { CurrentBusiness } from '../../lib/business'
import { listRecurringInvoices,type RecurringPlan } from '../../services/recurringInvoices'
const RecurringInvoicesDialog=lazy(()=>import('../RecurringInvoicesDialog'))
export default function RecurringNextSteps({business,refreshVersion=0}:{business:CurrentBusiness;refreshVersion?:number}){
 const [plans,setPlans]=useState<RecurringPlan[]>([]),[error,setError]=useState(''),[open,setOpen]=useState(false),[version,setVersion]=useState(0)
 useEffect(()=>{if(!business.primary_owner)return;let active=true;const refresh=()=>{if(document.hidden)return;void listRecurringInvoices(business.id).then(v=>{if(active){setPlans(v);setError('')}}).catch(()=>{if(active)setError('Recurring invoice next steps are unavailable.')})};refresh();const timer=setInterval(refresh,30000);window.addEventListener('finviant-work-changed',refresh);window.addEventListener('focus',refresh);return()=>{active=false;clearInterval(timer);window.removeEventListener('finviant-work-changed',refresh);window.removeEventListener('focus',refresh)}},[business.id,business.primary_owner,refreshVersion,version])
 if(!business.primary_owner)return null
 const drafts=plans.flatMap(p=>p.occurrences.filter(o=>o.invoice_id&&o.invoice_status==='draft').map(o=>({...o,title:p.title}))).slice(0,3)
 const needsReview=plans.some(p=>p.last_error||p.occurrences.some(o=>o.schedule_error))
 return <div className="recurring-next-steps">{error&&<p role="status">{error} <button className="text-button" onClick={()=>setVersion(v=>v+1)}>Retry recurring next steps</button></p>}
  <ul className="calendar-reminders">{drafts.map(o=><li key={o.id}><div><strong>{o.title}</strong><span>Recurring invoice draft ready · {o.bill_date}</span></div><a className="secondary-button compact" href={`/?view=invoices&document=${encodeURIComponent(o.invoice_id!)}`}>Review invoice</a></li>)}</ul>
  {needsReview&&<button className="text-button" onClick={()=>setOpen(true)}>Review recurring invoice or visit setup</button>}
  {open&&<Suspense fallback={<p role="status">Opening recurring invoices…</p>}><RecurringInvoicesDialog business={business} onClose={()=>{setOpen(false);setVersion(v=>v+1)}}/></Suspense>}
 </div>
}
