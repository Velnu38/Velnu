import {useRef,useState,type FormEvent} from 'react'
import type {CurrentBusiness} from '../lib/business'
import {canWrite} from '../lib/business'
import {canAccess} from '../lib/workspaceAccess'
import {localInstant} from '../lib/calendarTime'
import {createReminder,type ReminderJob} from '../services/reminders'
import FormDialog from './FormDialog'
export default function JobReminderDialog({business,job,onClose,onSaved}:{business:CurrentBusiness;job:ReminderJob;onClose:()=>void;onSaved:()=>void}){
 const [at,setAt]=useState(''),[note,setNote]=useState('Follow up on '+job.title),[error,setError]=useState(''),[busy,setBusy]=useState(false),saving=useRef(false),request=useRef<{signature:string;id:string}|null>(null)
 const zone=business.timezone||'UTC'
 async function submit(e:FormEvent){e.preventDefault();if(saving.current||!canWrite(business.role)||!canAccess(business,'calendar'))return;saving.current=true;setBusy(true);setError('');try{const dueAt=localInstant(at,zone),signature=JSON.stringify([job.id,dueAt,note]);if(request.current?.signature!==signature)request.current={signature,id:crypto.randomUUID()};await createReminder(business,{id:request.current.id,jobId:job.id,customerId:job.customer_id,note,dueAt});onSaved()}catch(e){setError(e instanceof Error?e.message:'Could not save the reminder. Retry this form.')}finally{saving.current=false;setBusy(false)}}
 return <FormDialog label="Add job reminder" busy={busy} onClose={onClose}><header className="modal-head"><h2>Add reminder</h2><button type="button" className="icon-button" aria-label="Close reminder" disabled={busy} onClick={onClose}>×</button></header><form className="form-grid" onSubmit={submit}><label className="full">Remind me at ({zone})<input type="datetime-local" required value={at} onChange={e=>setAt(e.target.value)}/></label><label className="full">Reminder note<textarea required maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></label>{error&&<p role="alert">{error}</p>}<button type="submit" className="primary-button" disabled={busy}>Save reminder</button></form></FormDialog>
}
