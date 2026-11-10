import {useEffect,useRef,useState} from 'react'
import {DateTime} from 'luxon'
import type {CurrentBusiness} from '../../lib/business'
import {localInstant} from '../../lib/calendarTime'
import {useUnsavedChanges,confirmNavigation,hasUnsavedChanges} from '../../lib/unsavedChanges'
import {getSchedulingContext,manageTimeOff,saveSchedulingPreferences,type SchedulingContext} from '../../services/schedulingWorkflow'
import {getWorkers,type WorkerRoster} from '../../services/workers'
import {wholeLocalDay} from '../../lib/workerAvailability'
import WorkerAvailabilityCalendar from './WorkerAvailabilityCalendar'
import WorkerHoursEditor from './WorkerHoursEditor'
import TeamAvailabilitySummary from './TeamAvailabilitySummary'
import './scheduling.css'
const clock=(n:number)=>n===1440?'00:00':`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`
const minutes=(s:string)=>Number(s.split(':')[0])*60+Number(s.split(':')[1])
export default function SchedulingSettings({business}:{business:CurrentBusiness}){return <AvailabilitySettings key={business.id} business={business}/>}
function AvailabilitySettings({business}:{business:CurrentBusiness}){
 const zone=business.timezone||'America/New_York',today=DateTime.now().setZone(zone).toISODate()!
 const [context,setContext]=useState<SchedulingContext|null>(null),[roster,setRoster]=useState<WorkerRoster|null>(null),[worker,setWorker]=useState(''),[version,setVersion]=useState(0),[loading,setLoading]=useState(true)
 const [busy,setBusy]=useState(false),[workerBusy,setWorkerBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [start,setStart]=useState(''),[end,setEnd]=useState(''),[note,setNote]=useState(''),[blockDate,setBlockDate]=useState(today)
 const lock=useRef(false),alive=useRef(true),businessDirty=useRef(false),businessGuard=useUnsavedChanges(busy),leaveGuard=useUnsavedChanges(busy)
 const [prefsDraft,setPrefsDraft]=useState<SchedulingContext['preferences']|null>(null),[asOf,setAsOf]=useState(''),[loadError,setLoadError]=useState(false),[editorReset,setEditorReset]=useState(0)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 useEffect(()=>{
  let active=true;setLoading(true);setError('')
  void Promise.all([getSchedulingContext(business.id),getWorkers(business.id)]).then(([c,r])=>{
   if(!active)return
   const choices=r.workers.filter(w=>w.active&&c.team.some(t=>t.id===w.id)&&(r.plan!=='free'||w.is_owner))
   if(worker&&!choices.some(w=>w.id===worker)&&hasUnsavedChanges()){setLoadError(true);setError('This worker is no longer available in the latest roster. Your unsaved drafts are preserved. Discard pending changes and refresh before continuing.');return}
   setLoadError(false);setAsOf(DateTime.now().toISO()!);setContext(c);setRoster(r);setPrefsDraft(current=>businessDirty.current?current:c.preferences)
   setWorker(current=>choices.some(w=>w.id===current)?current:choices.find(w=>w.is_owner)?.id||choices[0]?.id||'')
  }).catch(e=>{if(active){setLoadError(true);setError(e instanceof Error?e.message:'Unable to load availability.')}}).finally(()=>{if(active)setLoading(false)})
  return()=>{active=false}
 },[business.id,version])
 const blocked=busy||workerBusy||loading||loadError,p=prefsDraft||context?.preferences
 const choices=roster?.workers.filter(w=>w.active&&context?.team.some(t=>t.id===w.id)&&(roster.plan!=='free'||w.is_owner))||[]
 const selected=choices.find(w=>w.id===worker)
 const timeOff=context?.time_off.filter(t=>t.user_id===worker)||[]
 async function run(action:()=>Promise<unknown>,message:string,kind:'business'|'leave'|'remove'){
  if(lock.current||workerBusy||loadError||loading)return;lock.current=true;setBusy(true);setError('');setNotice('')
  try{await action();if(!alive.current)return
   if(kind==='business'){businessDirty.current=false;businessGuard.markClean();setPrefsDraft(null)}
   if(kind==='leave'){leaveGuard.markClean();setStart('');setEnd('');setNote('')}
   setNotice(message);setVersion(v=>v+1)
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Unable to save.')}finally{lock.current=false;if(alive.current)setBusy(false)}
 }
 function chooseDay(date:string){
  if(!leaveGuard.canClose())return
  const bounds=wholeLocalDay(date,zone);setBlockDate(date);setStart(bounds.start);setEnd(bounds.end);setNote('');leaveGuard.markDirty()
  document.getElementById('worker-time-off-form')?.scrollIntoView?.({behavior:'smooth',block:'nearest'})
 }
 function changeWorker(id:string){
  if(id===worker)return
  if(!confirmNavigation())return
  businessDirty.current=false;businessGuard.markClean();leaveGuard.markClean();if(context)setPrefsDraft(context.preferences)
  setWorker(id);setStart('');setEnd('');setNote('');setError('');setNotice('')
 }
 return <section className="settings-panel availability-settings">
 <div><h2>Worker availability</h2><p className="quiet">Set normal weekly hours, then record leave and other time-off exceptions. Worker profiles do not grant account access.</p></div>
 {loading&&<p role="status">Loading worker availability…</p>}{error&&<p role="alert" className="form-message error-text">{error}</p>}{notice&&<p role="status" className="guided-success">{notice}</p>}
 {!loading&&loadError&&<button type="button" className="secondary-button" onClick={()=>setVersion(v=>v+1)}>Retry availability</button>}
 {context&&roster&&p&&<>
 {!loadError&&<TeamAvailabilitySummary workers={choices} context={context} today={today} zone={zone} asOf={asOf} selected={worker} onSelect={changeWorker} disabled={blocked}/>}
 <button type="button" className="text-button" disabled={blocked} onClick={()=>setVersion(v=>v+1)}>Refresh availability</button>
 {loadError&&<button type="button" className="secondary-button" disabled={busy||workerBusy||loading} onClick={()=>{if(confirmNavigation()){businessDirty.current=false;businessGuard.markClean();leaveGuard.markClean();setPrefsDraft(null);setStart('');setEnd('');setNote('');setEditorReset(n=>n+1);setVersion(v=>v+1)}}}>Discard pending changes and refresh</button>}
 <label className="availability-worker-picker">1. Choose a worker<select value={worker} disabled={blocked} onChange={e=>changeWorker(e.target.value)}>{choices.map(w=><option key={w.id} value={w.id}>{w.name}{w.is_owner?' (owner)':''}</option>)}</select></label>
 {!selected?<p>No active worker profiles are available for this account. Manage your roster in Workers.</p>:<>
 {!loadError&&<WorkerAvailabilityCalendar key={worker+':'+today} worker={selected} context={context} asOf={asOf} zone={zone} today={today} disabled={blocked} onChoose={chooseDay}/>}
 <WorkerHoursEditor key={selected.id+':'+editorReset} businessId={business.id} worker={selected} disabled={blocked} onBusy={setWorkerBusy} onSaved={()=>{setNotice('Worker hours saved.');setVersion(v=>v+1)}}/>
 <section className="scheduling-time-off" id="worker-time-off-form"><h3>2. Add time off for {selected.name}</h3><p className="quiet">Select a calendar day or enter a date range. Full days use midnight to midnight in {zone.replaceAll('_',' ')}. Existing work must be reassigned or rescheduled before overlapping time off can be saved.</p>
 <form onSubmit={e=>{e.preventDefault();void run(()=>manageTimeOff(business.id,worker,localInstant(start,zone),localInstant(end,zone),note),'Time blocked on the calendar.','leave')}} onChangeCapture={leaveGuard.markDirty}>
 <fieldset disabled={blocked}><legend>Time-off dates</legend><div className="availability-day-preset"><label>Full day<input type="date" value={blockDate} onChange={e=>setBlockDate(e.target.value)}/></label><button type="button" className="secondary-button" disabled={!blockDate} onClick={()=>chooseDay(blockDate)}>Use full day</button></div><div className="guided-form-grid"><label>From<input type="datetime-local" required value={start} onChange={e=>setStart(e.target.value)}/></label><label>Until<input type="datetime-local" required value={end} onChange={e=>setEnd(e.target.value)}/></label><label>Note (internal)<input value={note} maxLength={200} onChange={e=>setNote(e.target.value)} placeholder="Vacation, appointment, outside work…"/></label></div></fieldset>
 <div className="settings-actions"><button className="primary-button" disabled={blocked||!start||!end||end<=start}>Block time</button><button type="button" className="text-button" disabled={blocked} onClick={()=>{if(leaveGuard.canClose()){leaveGuard.markClean();setStart('');setEnd('');setNote('')}}}>Clear time-off form</button></div></form>
 <h4>Upcoming time off for {selected.name}</h4><p className="quiet">Blocks overlapping the next 60 days. Longer or later entries remain saved but may not appear here yet.</p>
 {!timeOff.length?<p>No recorded time off in this range.</p>:<ul>{timeOff.map(t=><li key={t.id}><span><strong>{selected.name}</strong><br/>{DateTime.fromISO(t.starts_at).setZone(zone).toLocaleString(DateTime.DATETIME_MED)} – {DateTime.fromISO(t.ends_at).setZone(zone).toLocaleString(DateTime.DATETIME_MED)}{t.note?` · ${t.note}`:''}</span><button type="button" className="text-button" disabled={blocked} aria-label={`Remove blocked time for ${selected.name} on ${DateTime.fromISO(t.starts_at).setZone(zone).toFormat('MMM d, h:mm a')}`} onClick={()=>{if(window.confirm('Remove this blocked time? Normal hours will apply again; existing bookings still take precedence.'))void run(()=>manageTimeOff(business.id,t.user_id,t.starts_at,t.ends_at,t.note,t.id),'Blocked time removed.','remove')}}>Remove</button></li>)}</ul>}
 </section></>}
 <details className="availability-business-hours"><summary>3. Business working hours &amp; booking rules</summary><p className="quiet">These defaults apply to workers who use business hours. Custom worker hours remain unchanged.</p>
 <form onSubmit={e=>{e.preventDefault();void run(()=>saveSchedulingPreferences(business.id,p),'Working hours saved.','business')}} onChangeCapture={()=>{businessDirty.current=true;businessGuard.markDirty()}}>
 <fieldset disabled={blocked}><legend>Working days</legend><div className="scheduling-days">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((label,n)=><label key={label}><input type="checkbox" checked={p.work_days.includes(n+1)} onChange={e=>setPrefsDraft({...p,work_days:e.target.checked?[...p.work_days,n+1]:p.work_days.filter(day=>day!==n+1)})}/>{label}</label>)}</div>
 <div className="guided-form-grid"><label>Work starts<input type="time" required value={clock(p.start_minutes)} onChange={e=>setPrefsDraft({...p,start_minutes:minutes(e.target.value)})}/></label><label>Work ends<input type="time" required value={clock(p.end_minutes)} onChange={e=>setPrefsDraft({...p,end_minutes:e.target.value==='00:00'?1440:minutes(e.target.value)})}/></label>{p.end_minutes===1440&&<p className="quiet">Work ends at midnight (the start of the next day).</p>}<label>Default job length (minutes)<input type="number" required min="15" max="720" step="15" value={p.duration_minutes} onChange={e=>setPrefsDraft({...p,duration_minutes:Number(e.target.value)})}/></label><label>Time between jobs (minutes)<input type="number" required min="0" max="180" step="5" value={p.buffer_minutes} onChange={e=>setPrefsDraft({...p,buffer_minutes:Number(e.target.value)})}/></label><label>Minimum booking notice (hours)<input type="number" required min="0" max="336" value={p.notice_hours} onChange={e=>setPrefsDraft({...p,notice_hours:Number(e.target.value)})}/></label></div></fieldset>
 <button className="primary-button" disabled={blocked||!p.work_days.length||p.end_minutes<=p.start_minutes}>Save scheduling preferences</button></form></details>
 </>}
 </section>
}
