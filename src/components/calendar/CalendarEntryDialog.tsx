import { useTierUsage } from '../../lib/useTierUsage'
import FormDialog from '../FormDialog'
import BookExistingJobDialog from '../scheduling/BookExistingJobDialog'
import '../scheduling/scheduling.css'
import { useEffect,useRef,useState,type FormEvent } from 'react'
import { DateTime } from 'luxon'
import type { CurrentBusiness } from '../../lib/business'
import { canAccess,canUseAssistant } from '../../lib/workspaceAccess'
import { createReminder } from '../../services/reminders'
import { getScheduleTeam,type Worker } from '../../services/schedulingWorkflow'
import { getCalendarEntry,saveCalendarEntry,cancelCalendarEntry,type CalendarEntry } from '../../services/calendarEntries'
import { announceCalendarChange } from '../../services/calendar'
export default function CalendarEntryDialog({business,day,entryId,onClose,onSaved}:{business:CurrentBusiness;day:string;entryId?:string;onClose:()=>void;onSaved:()=>void}) {
  const zone=business.timezone||'America/New_York',saving=useRef(false),retry=useRef<{signature:string;id:string}|null>(null)
  const dispatch=['owner','admin','office'].includes(business.role)&&canAccess(business,'jobs')&&canAccess(business,'calendar')
  const usage = useTierUsage(business.id)
  const teamScheduling = usage?.plan === 'pro'
  const ai = !!usage && canUseAssistant(business) && usage.ai_limit > 0 && usage.voice_limit > 0 && usage.ai_used < usage.ai_limit
  const [bookJob,setBookJob]=useState(false)
  const [kind,setKind]=useState<'event'|'reminder'>(entryId||dispatch?'event':'reminder'),[title,setTitle]=useState(''),[notes,setNotes]=useState(''),[start,setStart]=useState(day+'T09:00'),[end,setEnd]=useState(day+'T10:00')
  const [team,setTeam]=useState<Worker[]>([]),[selectedWorker,setWorker]=useState(''),[previous,setPrevious]=useState<CalendarEntry>(),[loading,setLoading]=useState(!!entryId),[busy,setBusy]=useState(false),[error,setError]=useState('')
  useEffect(()=>{let active=true;void getScheduleTeam(business.id).then(rows=>{if(active){setTeam(rows);if(!entryId)setWorker(rows.find(w=>w.is_you)?.id||rows[0]?.id||'')}}).catch(()=>{});
    if(entryId)void getCalendarEntry(business.id,entryId).then(row=>{if(!active)return;setPrevious(row);setTitle(row.title);setNotes(row.notes||'');setStart(DateTime.fromISO(row.starts_at).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm"));setEnd(row.ends_at?DateTime.fromISO(row.ends_at).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm"):'');setWorker(row.assigned_user_id||'')}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[business.id,entryId,zone])
  const worker = teamScheduling ? selectedWorker : team.find(item => item.is_you)?.id || ''
  function close(){if(!saving.current)onClose()}
  async function submit(event:FormEvent){event.preventDefault();if(saving.current)return;if(kind==='event'&&!dispatch){setError('Dispatch access is required to edit calendar events.');return}saving.current=true;setBusy(true);setError('')
    try{
      const s=DateTime.fromISO(start,{zone}),e=DateTime.fromISO(end,{zone})
      if(!s.isValid||s.toFormat("yyyy-MM-dd'T'HH:mm")!==start)throw new Error('Choose a valid start time in your business timezone.')
      if(s.getPossibleOffsets().length>1||(kind==='event'&&e.isValid&&e.getPossibleOffsets().length>1))throw new Error('That time occurs twice during daylight saving. Choose a different time.')
      if(kind==='event'&&(!e.isValid||e<=s||e.diff(s,'hours').hours>12||e.toFormat("yyyy-MM-dd'T'HH:mm")!==end))throw new Error('Choose an end after the start, up to 12 hours later.')
      if(kind==='event'&&!worker)throw new Error('Your calendar assignment could not be loaded. Reopen this entry to try again.')
      const signature=JSON.stringify({kind,title,notes,start,end,worker})
      if(retry.current?.signature!==signature)retry.current={signature,id:crypto.randomUUID()}
      if(kind==='reminder')await createReminder(business,{id:retry.current.id,note:[title.trim(),notes.trim()].filter(Boolean).join('\n'),dueAt:s.toUTC().toISO()!})
      else await saveCalendarEntry(business.id,{id:previous?.id||retry.current.id,title,notes,starts_at:s.toUTC().toISO()!,ends_at:e.toUTC().toISO()!,assigned_user_id:worker},previous)
      announceCalendarChange();onSaved();onClose()
    }catch(e){setError(e instanceof Error?e.message:'The calendar save is not confirmed. Retry this entry.')}finally{saving.current=false;setBusy(false)}
  }
  return <><FormDialog label={entryId?'Calendar entry':'Add to your calendar'} busy={busy} onClose={close} wide><header className="guided-dialog-head"><div><p className="eyebrow">{DateTime.fromISO(day,{zone}).toFormat('cccc, MMMM d, yyyy')}</p><h2 id="calendar-entry-title">{entryId?'Calendar entry':'Add to your calendar'}</h2></div><button type="button" className="calendar-arrow" aria-label="Close calendar entry" disabled={busy} onClick={close}>×</button></header>
    {loading?<p role="status">Loading calendar entry…</p>:<form className="form-grid" onSubmit={submit}>
      {!entryId&&<div className="full guided-mode" role="group" aria-label="Entry type"><button type="button" aria-pressed={kind==='event'} disabled={!dispatch||busy} onClick={()=>setKind('event')}>Event</button><button type="button" aria-pressed={kind==='reminder'} disabled={busy} onClick={()=>setKind('reminder')}>Reminder</button>{dispatch&&<button type="button" disabled={busy} onClick={()=>setBookJob(true)}>Book existing job</button>}</div>}
      {!entryId&&!ai&&<p className="quiet full">AI entry requires activated AI access. You can add this entry manually.</p>}
      <label className="full">Title<input required maxLength={200} value={title} disabled={busy} onChange={e=>setTitle(e.target.value)} placeholder="Customer visit, supply pickup, or follow-up"/></label>
      <label className="full">Details<textarea maxLength={1800} value={notes} disabled={busy} onChange={e=>setNotes(e.target.value)}/></label>
      <label>{kind==='event'?'Starts':'Remind me on'}<input type="datetime-local" required value={start} disabled={busy} onChange={e=>setStart(e.target.value)}/></label>
      {kind==='event'&&<><label>Ends<input type="datetime-local" required value={end} disabled={busy} onChange={e=>setEnd(e.target.value)}/></label>{teamScheduling && <label className="full">Team member<select required value={worker} disabled={busy} onChange={e=>setWorker(e.target.value)}><option value="">Choose team member</option>{team.map(w=><option key={w.id} value={w.id}>{w.label}{w.is_you?' (you)':''}</option>)}</select></label>}</>}
      {kind==='event' && !teamScheduling && previous?.assigned_user_id && worker && previous.assigned_user_id !== worker && <p className="quiet full">Saving assigns this event to you. Team scheduling requires Business Pro.</p>}
      <p className="quiet full">Times use {zone.replaceAll('_',' ')}. This saves to Finviant and does not send a customer message.</p>
      {error&&<p role="alert" className="form-message error-text full">{error}</p>}
      {previous&&dispatch&&!previous.job_id&&<button type="button" className="text-button danger-action full" disabled={busy} onClick={async()=>{if(saving.current||!window.confirm('Cancel this calendar event? It will leave the active schedule and remain in your records.'))return;saving.current=true;setBusy(true);setError('');try{await cancelCalendarEntry(business.id,previous);onSaved();onClose()}catch(e){setError(e instanceof Error?e.message:'Unable to cancel event.')}finally{saving.current=false;setBusy(false)}}}>Cancel event</button>}
      <div className="modal-actions full"><button type="button" className="secondary-button" disabled={busy} onClick={close}>Back to calendar</button><button className="primary-button" disabled={busy||loading||kind==='event'&&!worker||!!entryId&&(!previous||!dispatch)}>{busy?'Saving…':entryId?'Save calendar entry':'Add '+kind}</button></div>
    </form>}
  </FormDialog>{bookJob&&<BookExistingJobDialog business={business} day={day} onClose={()=>setBookJob(false)} onSaved={()=>{
    onSaved()
    if(!title.trim()&&!notes.trim())onClose()
  }}/>}</>
}
