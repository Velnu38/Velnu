import {useEffect,useRef,useState} from 'react'
import {getInvoiceReminderHistory,type ReminderHistoryPage,type ReminderHistoryItem,reminderHistoryStatus} from '../services/invoiceReminderHistory'

export default function InvoiceReminderHistory({businessId,invoiceId,timezone}:{businessId:string;invoiceId:string;timezone?:string|null}){
 const [page,setPage]=useState<ReminderHistoryPage|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const generation=useRef(0),flight=useRef(false)
 function time(value:string){try{return new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short',timeZone:timezone||'UTC'}).format(new Date(value))+' ('+(timezone||'UTC')+')'}catch{return new Date(value).toISOString()+' (UTC)'}}
 async function load(more=false){
  if(flight.current)return
  flight.current=true;setBusy(true);setError('');const token=generation.current
  const last=more?page?.items.at(-1):undefined
  try{
   const next=await getInvoiceReminderHistory(businessId,invoiceId,last)
   if(token===generation.current)setPage(previous=>({...next,items:more&&previous?[...previous.items,...next.items.filter(item=>!previous.items.some(existing=>existing.id===item.id))]:next.items}))
  }catch{if(token===generation.current)setError('Reminder history is unavailable. Retry to verify the latest status; no message was sent.')}
  finally{if(token===generation.current){flight.current=false;setBusy(false)}}
 }
 useEffect(()=>{generation.current++;flight.current=false;setPage(null);void load();return()=>{generation.current++}},[businessId,invoiceId])
 function summary(item:ReminderHistoryItem|null,successful=false){const at=item&&(successful?(item.status==='delivered'?item.last_event_at:null)||item.sent_at||item.created_at:item.created_at);return item&&at?`${time(at)} · ${reminderHistoryStatus(item.status)}`:'None recorded'}
 return <section className="detail-card" aria-label="Invoice reminder history"><h2>Reminder history</h2>
 <p className="quiet">Viewing or refreshing history never sends a reminder. Provider acceptance is not confirmed delivery.</p>
 {error&&<p role="alert">{error}</p>}{busy&&<p role="status">Loading reminder history…</p>}
 <button type="button" className="text-button" disabled={busy} onClick={()=>void load()}>{error?'Retry reminder history':'Refresh reminder history'}</button>
 {page&&<><p>Last attempt: {summary(page.last_attempt)}</p><p>Last accepted or delivered reminder: {summary(page.last_success,true)}</p>
 {!page.items.length?<p>No reminders recorded for this invoice.</p>:<ol className="message-list">{page.items.map(item=><li className="message-item" key={item.id}>
 <strong>{reminderHistoryStatus(item.status)}</strong><p>{time(item.created_at)} · {item.channel.toUpperCase()} · {item.source==='automatic'?'Automatic':item.source==='personal'?'Personal app':item.source==='personal_unclassified'?'Related personal-app document send — reminder purpose unverified':'Manual'}</p>
 <p>Recipient: {item.recipient||'Not recorded'} · Initiated by: {item.initiator}</p>
 {item.sent_at&&<p>{item.source==='personal'||item.source==='personal_unclassified'?'Reported sent':'Accepted'}: {time(item.sent_at)}</p>}{item.last_event_at&&<p>Latest delivery status: {time(item.last_event_at)}</p>}
 {item.detail&&<p>{item.detail}</p>}{item.attempts!=null&&<p>Provider attempts: {item.attempts}</p>}
 {['uncertain','sending'].includes(item.status)&&<p>Check the existing attempt before retrying. Its outcome is not confirmed.</p>}
 {item.status==='draft_opened'&&<p>Sending and delivery from your app are not verified.</p>}
 {!!item.events.length&&<details><summary>Status history</summary><ul>{item.events.map((event,index)=><li key={index}>{time(event.at)} · {reminderHistoryStatus(event.type.replace('email.',''))}</li>)}</ul></details>}
 </li>)}</ol>}
 {page.has_more&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>void load(true)}>Load older reminders</button>}</>}
 </section>
}
