import {useEffect,useState} from 'react'
import type {CurrentBusiness} from '../lib/business'
import {useBusinessRefresh} from '../lib/useBusinessRefresh'
import {getJobManagementPage,type ManagementPage} from '../services/jobManagement'

/** Reuses the authorized, ten-row management query. Counts cover all matching jobs. */
export default function OperationalAttention({business,refreshVersion}:{business:CurrentBusiness;refreshVersion:number}){
  const [page,setPage]=useState(0),[retry,setRetry]=useState(0)
  const [result,setResult]=useState<{key:string;data:ManagementPage}|null>(null),[failure,setFailure]=useState<{key:string}|null>(null)
  const key=JSON.stringify([business.id,business.role,business.access_modules,page,retry,refreshVersion])
  useBusinessRefresh(business.id,()=>setRetry(value=>value+1))
  useEffect(()=>{let active=true;void getJobManagementPage(business.id,{filter:'attention',search:'',page}).then(data=>{if(active){setResult({key,data});setFailure(null)}}).catch(()=>{if(active)setFailure({key})});return()=>{active=false}},[key])
  const data=result?.key===key?result.data:null,error=failure?.key===key
  return <section className="dashboard-tile home-work-attention" aria-label="Work needs attention" aria-busy={!data&&!error}>
    <div className="work-card-heading"><div><p className="eyebrow">Job Management</p><h2 className="dashboard-tile-title">Work needs attention</h2></div><a href="/?view=work&workspace=management">Manage jobs</a></div>
    {error?<p role="alert">Work attention is unavailable. <button type="button" onClick={()=>setRetry(v=>v+1)}>Retry work attention</button></p>:!data?<p role="status">Checking work…</p>:<>
      <p>{data.total?`${data.total} ${data.total===1?'job needs':'jobs need'} review. Each job appears once.`:'No work blockers found.'}</p>
      <ul className="home-work-list">{data.entries.map(entry=>{
        if(entry.kind!=='job')return null
        const job=entry.data,signal=data.signals.find(s=>s.job_id===job.id)
        const reasons=[signal?.due_tasks?`${signal.due_tasks} tasks due`:null,signal?.materials_needed?`${signal.materials_needed} materials outstanding`:null,!job.assigned_user_ids?.length?'Crew unassigned':null,signal?.pending_changes?`${signal.pending_changes} changes to review`:null].filter(Boolean)
        const section=signal?.due_tasks?'tasks':signal?.materials_needed?'materials':!job.assigned_user_ids?.length?'schedule':signal?.pending_changes?'changes':'overview'
        return <li key={job.id}><a href={`/?view=work&workspace=management&job=${encodeURIComponent(job.id)}&section=${section}`}><strong>{job.title}</strong><span>{reasons.join(' · ')||'Review work status'}</span></a></li>
      })}</ul>
      {data.total>10&&<nav aria-label="Work attention pages"><button type="button" disabled={data.page===0} onClick={()=>setPage(data.page-1)}>Previous jobs</button><span>Page {data.page+1} of {Math.ceil(data.total/10)}</span><button type="button" disabled={(data.page+1)*10>=data.total} onClick={()=>setPage(data.page+1)}>Next jobs</button></nav>}
      <small>Checked {new Date(data.checked_at).toLocaleString()}. Visits are shown in your work calendar; billing follow-ups remain below.</small>
    </>}
  </section>
}
