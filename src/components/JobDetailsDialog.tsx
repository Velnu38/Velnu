import {useEffect,useRef,useState,type FormEvent} from 'react'
import type {CurrentBusiness} from '../lib/business'
import {canWrite} from '../lib/business'
import {canAccess} from '../lib/workspaceAccess'
import {getJob,saveJobNotes} from '../services/jobs'
import {formatServiceAddress} from '../lib/googleMaps'
import RecordResources from './RecordResources'
export default function JobDetailsDialog({business,jobId,onClose}:{business:CurrentBusiness;jobId:string;onClose:()=>void}) {
 const dialog=useRef<HTMLDialogElement>(null)
 const [job,setJob]=useState<Awaited<ReturnType<typeof getJob>>|null>(null),[notes,setNotes]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
 const saving=useRef(false)
 useEffect(()=>{dialog.current?.showModal();let active=true;void getJob(business.id,jobId).then(row=>{if(active){setJob(row);setNotes(row.description||'')}}).catch(()=>{if(active)setError('Unable to load this job. Close and try again.')});return()=>{active=false}},[business.id,jobId])
 async function save(e:FormEvent){e.preventDefault();if(saving.current)return;saving.current=true;setBusy(true);setError('');setNotice('');try{await saveJobNotes(business.id,jobId,notes);setNotice('Job details saved. The calendar and Jobs use this same record.')}catch{setError('Unable to save job notes. Your changes are still here; try again.')}finally{saving.current=false;setBusy(false)}}
 return <dialog ref={dialog} className="record-resource-dialog" aria-label="Job details" onCancel={e=>{if(busy)e.preventDefault();else onClose()}}><div className="record-resources-head"><h2>{job?.title||'Job details'}</h2><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Close</button></div>{error&&<p role="alert">{error}</p>}{!job&&!error&&<p role="status">Loading job details…</p>}{job&&<><p><strong>Service address</strong><br/>{job.properties[0]?formatServiceAddress(job.properties[0]):'No service address recorded. Add a customer location before dispatch.'}</p><p>{job.customers.map(c=>[c.first_name,c.last_name].filter(Boolean).join(' ')||c.company).join(', ')} · {job.status.replaceAll('_',' ')}</p><form onSubmit={save}><label>Job notes and materials needed<textarea value={notes} maxLength={4000} rows={7} disabled={busy||!canWrite(business.role)} onChange={e=>{setNotes(e.target.value);setNotice('')}} placeholder="Scope, materials to bring, access instructions, and updates…"/></label>{canWrite(business.role)&&canAccess(business,'jobs')&&<button className="primary-button" disabled={busy}>{busy?'Saving…':'Save job details'}</button>}</form>{notice&&<p role="status">{notice}</p>}<details><summary>Photos and expenses</summary><RecordResources business={business} target={{kind:'job',id:jobId}}/></details></>}</dialog>
}
