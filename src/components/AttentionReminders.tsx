import './reminders.css'
import {lazy,Suspense,useState} from 'react'
import type {CurrentBusiness} from '../lib/business'
import type {DashboardSnapshot} from '../services/dashboard'
import {completeWorkReminder} from '../services/reminders'
const ReminderDetailsDialog=lazy(()=>import('./ReminderDetailsDialog'))
export default function AttentionReminders({business,reminders}:{business:CurrentBusiness;reminders:DashboardSnapshot['dueReminders']}) {
 const [reminderId,setReminderId]=useState<string|null>(null)
 const [busy,setBusy]=useState<string|null>(null),[error,setError]=useState('')
 async function done(id:string){if(busy)return;setBusy(id);setError('');try{await completeWorkReminder(business,id)}catch{setError('Unable to complete this reminder. Try again.')}finally{setBusy(null)}}
 return <div className="attention-reminders">{error&&<p role="alert">{error}</p>}<ul className="calendar-reminders">{reminders.map(row=><li key={row.id}><button type="button" className="reminder-open" aria-label={`Open reminder ${row.note||'Follow up'}`} onClick={()=>setReminderId(row.id)}><strong>{row.note||'Follow up'}</strong><span>{new Date(row.due_at).toLocaleString([], {timeZone:business.timezone||'America/New_York'})}</span><small>{business.role==='viewer'?'View reminder':'Edit reminder'} →</small></button>{business.role!=='viewer'&&<button className="primary-button compact attention-action" aria-label={`Complete ${row.note||'reminder'}`} disabled={busy!==null} onClick={()=>void done(row.id)}>Done</button>}</li>)}</ul>{reminderId&&<Suspense fallback={<p role="status">Opening reminder…</p>}><ReminderDetailsDialog key={business.id+reminderId} business={business} reminderId={reminderId} onClose={()=>setReminderId(null)}/></Suspense>}</div>
}
