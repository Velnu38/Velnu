import { lazy,Suspense,useEffect,useState } from 'react'
import type { CurrentBusiness } from '../../lib/business'
import { canAccess } from '../../lib/workspaceAccess'
import { completeJob,workflowNextActions,type WorkflowActions } from '../../services/schedulingWorkflow'
import './scheduling.css'
const ScheduleEstimateDialog=lazy(()=>import('./ScheduleEstimateDialog'))
export default function WorkflowNextSteps({business,refreshVersion=0,embedded=false}:{business:CurrentBusiness;refreshVersion?:number;embedded?:boolean}) {
  const [data,setData]=useState<WorkflowActions|null>(null),[error,setError]=useState(''),[estimate,setEstimate]=useState<string|null>(null),[version,setVersion]=useState(0),[busy,setBusy]=useState<string|null>(null)
  const [showAll,setShowAll]=useState(false)
  const allowed=['owner','admin','office'].includes(business.role)&&['jobs','calendar','billing'].every(m=>canAccess(business,m as 'jobs'|'calendar'|'billing'))
  useEffect(()=>{
    if(!allowed)return
    let active=true
    const refresh=()=>{if(document.hidden)return;void workflowNextActions(business.id).then(value=>{if(!value || !Array.isArray(value.approved)||!Array.isArray(value.completed))throw new Error('Next steps could not be loaded.');if(active){setData(value);setError('')}}).catch(e=>{if(active)setError(e.message)})}
    refresh();const timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);window.addEventListener('finviant-work-changed',refresh)
    return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('finviant-work-changed',refresh)}
  },[business.id,allowed,version,refreshVersion])
  async function prepare(job:string){setBusy(job);setError('');try{const result=await completeJob(job,true);if(!result.invoice_ready)throw new Error(result.needs_pricing?'Add the work and price before creating this invoice.':'The job is completed; its invoice needs review.');setVersion(v=>v+1)}catch(e){setError(e instanceof Error?e.message:'Unable to prepare the invoice.')}finally{setBusy(null)}}
  if(!allowed || (!error&&!data?.approved.length&&!data?.completed.length&&!estimate))return null
  return <section className="workflow-next" aria-label="Guided next steps">{!embedded&&<h2>Your Next Steps:</h2>}<p>Finviant keeps the work moving. You review customer invitations and invoices before anything is sent.</p>
    {error&&<p role="alert">{error} <button type="button" className="text-button" onClick={()=>setVersion(v=>v+1)}>Retry next steps</button></p>}
    <ul>{data?.approved.slice(0,showAll?20:3).map(row=><li key={row.id}><div><strong>{row.customer_name} · {row.estimate_number || 'Approved estimate'}</strong><span>{row.offer?.status==='approved'&&Date.parse(row.offer.expires_at)>Date.now()?'Waiting for the customer to choose a time.':'Estimate approved. Choose the crew and offer appointment times.'}</span></div><button type="button" className="primary-button compact" onClick={()=>setEstimate(row.id)}>{row.offer?.status==='approved'?'Review times':'Schedule job'}</button></li>)}
    {data?.completed.slice(0,showAll?20:3).map(row=><li key={row.id}><div><strong>{row.title}</strong><span>{row.invoice_id?'Work completed. Invoice draft ready for your review.':row.error_code==='pricing_required'?'Work completed. Add the charges for this job.':'Work completed. Finish preparing the invoice.'}</span></div><div className="workflow-actions">{row.invoice_id?<a className="primary-button compact" href={`/?view=invoices&document=${encodeURIComponent(row.invoice_id)}`}>Review invoice</a>:row.error_code==='pricing_required'?<a className="primary-button compact" href={`/?view=invoices&job=${encodeURIComponent(row.id)}`}>Add charges & invoice</a>:<button type="button" className="primary-button compact" disabled={busy!==null} onClick={()=>void prepare(row.id)}>{busy===row.id?'Preparing…':'Prepare invoice draft'}</button>}</div></li>)}</ul>
    {((data?.approved.length || 0)>3||(data?.completed.length || 0)>3)&&<button type="button" className="text-button" aria-expanded={showAll} onClick={()=>setShowAll(value=>!value)}>{showAll?'Show fewer next steps':'Show more next steps'}</button>}
    {estimate&&<Suspense fallback={<p role="status">Opening scheduling…</p>}><ScheduleEstimateDialog business={business} estimateId={estimate} onSaved={()=>setVersion(v=>v+1)} onClose={()=>setEstimate(null)}/></Suspense>}
  </section>
}
