import { lazy,Suspense,useState } from 'react'
import type { CurrentBusiness } from '../../lib/business'
import { useTierUsage } from '../../lib/useTierUsage'
import { canAccess } from '../../lib/workspaceAccess'
import { completeJob,type WorkflowActions } from '../../services/schedulingWorkflow'
import './scheduling.css'
const ScheduleEstimateDialog=lazy(()=>import('./ScheduleEstimateDialog'))
export default function WorkflowNextSteps({business,data,embedded=false}:{business:CurrentBusiness;data:WorkflowActions;embedded?:boolean}) {
  const [error,setError]=useState(''),[estimate,setEstimate]=useState<{id:string;mode:'book'|'offer'}|null>(null),[busy,setBusy]=useState<string|null>(null)
  const teamScheduling=useTierUsage(business.id)?.plan==='pro'
  const allowed=['owner','admin','office'].includes(business.role)&&['jobs','calendar','billing'].every(m=>canAccess(business,m as 'jobs'|'calendar'|'billing'))
  async function prepare(job:string){setBusy(job);setError('');try{const result=await completeJob(job,true);if(!result.invoice_ready)throw new Error(result.needs_pricing?'Add the work and price before creating this invoice.':'The job is completed; its invoice needs review.')}catch(e){setError(e instanceof Error?e.message:'Unable to prepare the invoice.')}finally{setBusy(null)}}
  if(!allowed || (!error&&!data?.approved.length&&!data?.completed.length&&!estimate))return null
  return <section className={embedded ? "workflow-next attention-workflow" : "workflow-next dashboard-tile"} aria-label="Guided next steps">{!embedded&&<h2 className="dashboard-tile-title">Your next steps</h2>}
    {error&&<p role="alert">{error}</p>}
    <ul>{data.approved.map(row=>{
      const offer=row.offer?.status==='approved'?row.offer:null
      const reviewLink=offer&&teamScheduling
      const appointmentStatus=!offer?'Not booked':Date.parse(offer.expires_at)<=Date.now()
        ?'Booking link expired':teamScheduling?'Waiting for customer':'Booking link paused'
      return <li key={row.id}><div><strong>{row.customer_name} · {row.estimate_number || 'Approved estimate'}</strong><span>Appointment: {appointmentStatus}</span></div><button type="button" className="primary-button compact attention-action" onClick={()=>setEstimate({id:row.id,mode:reviewLink?'offer':'book'})}>{reviewLink?'Manage invitation':'Schedule job'}</button></li>
    })}
    {data.completed.map(row=><li key={row.id}><div><strong>{row.title}</strong><span>{row.invoice_id?'Work completed. Invoice draft ready for your review.':row.error_code==='pricing_required'?'Work completed. Add the charges for this job.':row.error_code==='deposit_needs_settlement'?'Settle the deposit invoice (or void it if unpaid), then prepare the final invoice.':'Work completed. Finish preparing the invoice.'}</span></div><div className="workflow-actions">{row.invoice_id?<a className="primary-button compact attention-action" href={`/?view=invoices&document=${encodeURIComponent(row.invoice_id)}`}>Review invoice</a>:row.error_code==='pricing_required'?<a className="primary-button compact attention-action" href={`/?view=invoices&job=${encodeURIComponent(row.id)}`}>Add charges & invoice</a>:<button type="button" className="primary-button compact attention-action" disabled={busy!==null} onClick={()=>void prepare(row.id)}>{busy===row.id?'Preparing…':'Prepare invoice draft'}</button>}</div></li>)}</ul>
    {estimate&&<Suspense fallback={<p role="status">Opening scheduling…</p>}><ScheduleEstimateDialog business={business} estimateId={estimate.id} initialMode={estimate.mode} onClose={()=>setEstimate(null)}/></Suspense>}
  </section>
}
