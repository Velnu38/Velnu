import {useState,useRef,type FormEvent} from 'react'
import {saveWorker,type WorkerProfile} from '../../services/workers'
import {useUnsavedChanges} from '../../lib/unsavedChanges'
const clock=(n:number)=>n===1440?'00:00':`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`
export default function WorkerHoursEditor({businessId,worker,onSaved,onBusy,disabled}:{businessId:string;worker:WorkerProfile;onSaved:()=>void;onBusy:(busy:boolean)=>void;disabled:boolean}){
 const [editing,setEditing]=useState(false),[draft,setDraft]=useState(worker),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false)
 const lock=useRef(false),guard=useUnsavedChanges(busy)
 async function submit(event:FormEvent){event.preventDefault();if(lock.current||disabled)return;lock.current=true;setBusy(true);onBusy(true);setError('');try{
  const {id,is_owner:_,updated_at,...input}=draft
  await saveWorker(businessId,id,input,updated_at);guard.markClean();setEditing(false);setSaved(true);onSaved()
 }catch(e){setError(e instanceof Error?e.message:'Unable to save worker hours.')}finally{lock.current=false;setBusy(false);onBusy(false)}}
 return <section className="settings-inset"><h3>Normal weekly hours</h3><p>{worker.use_business_hours?'Uses business working hours.':'Uses this worker’s custom weekly hours.'} One start/end time applies to the selected days.</p>
 {!editing?<button type="button" className="secondary-button" disabled={disabled} onClick={()=>{setDraft(worker);setError('');setSaved(false);setEditing(true)}}>Edit {worker.name} hours</button>:<form onSubmit={submit} onChangeCapture={guard.markDirty}>
 <fieldset disabled={busy||disabled}><legend>{worker.name} weekly schedule</legend><label><input type="checkbox" checked={draft.use_business_hours} onChange={e=>setDraft({...draft,use_business_hours:e.target.checked})}/> Use business working hours</label>
 {!draft.use_business_hours&&<><div className="scheduling-days">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d,n)=><label key={d}><input type="checkbox" checked={draft.work_days.includes(n+1)} onChange={e=>setDraft({...draft,work_days:e.target.checked?[...draft.work_days,n+1]:draft.work_days.filter(day=>day!==n+1)})}/>{d}</label>)}</div><div className="guided-form-grid">{(['start_minutes','end_minutes'] as const).map(field=><label key={field}>{field==='start_minutes'?'Starts':'Ends'}<input type="time" required value={clock(draft[field])} onChange={e=>{const [h,m]=e.target.value.split(':').map(Number);setDraft({...draft,[field]:field==='end_minutes'&&h===0&&m===0?1440:h*60+m})}}/></label>)}</div>{draft.end_minutes===1440&&<p className="quiet">Ends at midnight (the start of the next day).</p>}</>}
 </fieldset><div className="settings-actions"><button className="primary-button" disabled={busy||disabled||!draft.work_days.length||!Number.isFinite(draft.start_minutes)||!Number.isFinite(draft.end_minutes)||draft.end_minutes<=draft.start_minutes}>{busy?'Saving…':'Save worker hours'}</button><button type="button" className="secondary-button" disabled={busy} onClick={()=>{if(guard.canClose()){guard.markClean();setEditing(false)}}}>Cancel</button></div></form>}
 {error&&<p role="alert">{error}</p>}{saved&&<p role="status">Worker hours saved.</p>}</section>
}
