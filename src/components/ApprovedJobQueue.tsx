import {flushSync} from 'react-dom'
import {useEffect,useRef,useState} from 'react'
import type {CurrentBusiness} from '../lib/business'
import {canWrite} from '../lib/business'
import {canAccess} from '../lib/workspaceAccess'
import {getJobManagementPage,prepareApprovedWork,type ApprovedWork,type ManagementPage} from '../services/jobManagement'
import FormDialog from './FormDialog'

export default function ApprovedJobQueue({business,customerScope,search,revision,onOpen,page,onPage}:{business:CurrentBusiness;customerScope:string;search:string;revision:number;page:number;onPage:(page:number)=>void;onOpen:(id:string)=>void}){
 const [retry,setRetry]=useState(0),[result,setResult]=useState<{key:string;data:ManagementPage}|null>(null),[error,setError]=useState(''),[review,setReview]=useState<ApprovedWork|null>(null),[busy,setBusy]=useState(false)
 const active=useRef(true),scope=useRef(business.id),saving=useRef(false);scope.current=business.id
 useEffect(()=>{active.current=true;return()=>{active.current=false}},[business.id])
 const key=JSON.stringify([business.id,business.role,business.access_modules,customerScope,search,page,revision,retry]),data=result?.key===key?result.data:null
 useEffect(()=>{let active=true;setError('');void getJobManagementPage(business.id,{filter:'approved',customer:customerScope,search,page}).then(data=>{if(active)setResult({key,data})}).catch(e=>{if(active)setError(e.message||'Could not load approved estimates.')});return()=>{active=false}},[key])
 async function create(){if(!review||saving.current||!canWrite(business.role)||!canAccess(business,'jobs'))return;saving.current=true;setBusy(true);setError('');const businessId=business.id;try{const id=await prepareApprovedWork(businessId,review.id);if(active.current&&scope.current===businessId){flushSync(()=>setReview(null));onOpen(id)}}catch(e){if(active.current&&scope.current===businessId)setError(e instanceof Error?e.message:'Retry this same approved estimate.')}finally{saving.current=false;if(active.current&&scope.current===businessId)setBusy(false)}}
 return <section aria-label="Approved estimates ready for a job">
  <p className="quiet">Approved estimates and their linked jobs. Estimates without a job need explicit setup; agreed prices stay with the estimate.</p>
  {error&&!review&&<p role="alert">{error} <button type="button" className="text-button" onClick={()=>setRetry(v=>v+1)}>Retry approved work</button></p>}{!data&&!error&&<p role="status">Loading approved work…</p>}
  {data?.entries.map(entry=>entry.kind==='job'?<article className="module-job-card" key={'job:'+entry.data.id}><button type="button" className="unified-job-title" onClick={()=>onOpen(entry.data.id)} aria-label={'Open job '+entry.data.title}>{entry.data.title}<span aria-hidden="true">›</span></button><span>{(Array.isArray(entry.data.customers)?entry.data.customers:entry.data.customers?[entry.data.customers]:[]).map(c=>[c.first_name,c.last_name].filter(Boolean).join(' ')||c.company).join(', ')}</span><small>Linked approved work · {entry.data.status.replaceAll('_',' ')}</small></article>:<article className="module-job-card" key={'approved:'+entry.data.id}><strong>{entry.data.title}</strong><span>{entry.data.customer} · {entry.data.estimate_number}</span><span>Approved estimate · No job created</span>{canWrite(business.role)&&canAccess(business,'jobs')&&<button type="button" className="secondary-button" onClick={()=>{setError('');setReview(entry.data)}}>Review job setup</button>}</article>)}
  {data&&!data.total&&<p>No approved work in this view.</p>}
  {data&&data.total>10&&<nav aria-label="Approved work pages"><button type="button" className="secondary-button" disabled={data.page===0} onClick={()=>onPage(Math.max(0,data.page-1))}>Previous</button><span>Page {data.page+1} of {Math.ceil(data.total/10)}</span><button type="button" className="secondary-button" disabled={(data.page+1)*10>=data.total} onClick={()=>onPage(data.page+1)}>Next</button></nav>}
  {review&&<FormDialog label="Create job from approved estimate" busy={busy} onClose={()=>setReview(null)}><header className="modal-head"><h2>Review job setup</h2><button type="button" className="icon-button" aria-label="Close job setup" disabled={busy} onClick={()=>setReview(null)}>×</button></header><h3>{review.title}</h3><p>{review.customer} · {review.estimate_number}</p><p>This creates or opens the job linked to this approved estimate. Review visits and crew in the job. Approved pricing is retained; no invoice is sent.</p>{error&&<p role="alert">{error}</p>}<button type="button" className="primary-button" disabled={busy} onClick={()=>void create()}>{busy?'Preparing…':'Create job from estimate'}</button></FormDialog>}
 </section>
}
