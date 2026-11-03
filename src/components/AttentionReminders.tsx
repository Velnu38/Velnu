import {useState} from 'react'
import type {CurrentBusiness} from '../lib/business'
import type {DashboardSnapshot} from '../services/dashboard'
import {completeWorkReminder} from '../services/reminders'
export default function AttentionReminders({business,reminders}:{business:CurrentBusiness;reminders:DashboardSnapshot['dueReminders']}) {
 const [busy,setBusy]=useState<string|null>(null),[error,setError]=useState('')
 async function done(id:string){if(busy)return;setBusy(id);setError('');try{await completeWorkReminder(business,id)}catch{setError('Unable to complete this reminder. Try again.')}finally{setBusy(null)}}
 return <div className="attention-reminders">{error&&<p role="alert">{error}</p>}<ul className="calendar-reminders">{reminders.map(row=><li key={row.id}><div><strong>{row.note||'Follow up'}</strong><span>{new Date(row.due_at).toLocaleString([], {timeZone:business.timezone||'America/New_York'})}</span></div>{business.role!=='viewer'&&<button className="secondary-button compact" aria-label={`Complete ${row.note||'reminder'}`} disabled={busy!==null} onClick={()=>void done(row.id)}>Done</button>}</li>)}</ul></div>
}
