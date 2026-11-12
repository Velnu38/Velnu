import {supabase} from '../lib/supabase'
export type ReminderHistoryItem={id:string;created_at:string;channel:string;recipient:string|null;source:string;initiator:string;status:string;sent_at?:string|null;last_event_at?:string|null;attempts:number|null;detail:string|null;events:{type:string;at:string}[]}
export type ReminderHistoryPage={invoice_id:string;items:ReminderHistoryItem[];has_more:boolean;last_attempt:ReminderHistoryItem|null;last_success:ReminderHistoryItem|null}
const labels:Record<string,string>={queued:'Queued',sending:'Sending',accepted:'Accepted by provider',sent:'Accepted by provider',delivered:'Delivered',failed:'Failed',bounced:'Bounced',canceled:'Canceled',suppressed:'Suppressed',uncertain:'Uncertain',draft_opened:'Draft opened',user_reported:'User-reported sent — delivery unverified',complained:'Complaint reported',delivery_delayed:'Delivery delayed'}
export function reminderHistoryStatus(status:string){return Object.hasOwn(labels,status)?labels[status]:'Unknown — needs review'}
function validItem(value:unknown):value is ReminderHistoryItem{
 if(!value||typeof value!=='object')return false
 const v=value as ReminderHistoryItem
 return typeof v.id==='string'&&typeof v.created_at==='string'&&Number.isFinite(Date.parse(v.created_at))&&[v.sent_at,v.last_event_at].every(at=>at==null||typeof at==='string'&&Number.isFinite(Date.parse(at)))&&typeof v.channel==='string'&&typeof v.status==='string'&&typeof v.source==='string'&&typeof v.initiator==='string'&&(v.recipient===null||typeof v.recipient==='string')&&(v.detail===null||typeof v.detail==='string')&&(v.attempts===null||Number.isInteger(v.attempts)&&v.attempts>=0)&&Array.isArray(v.events)&&v.events.every(e=>typeof e.type==='string'&&typeof e.at==='string'&&Number.isFinite(Date.parse(e.at)))
}
export async function getInvoiceReminderHistory(business:string,invoice:string,before?:ReminderHistoryItem):Promise<ReminderHistoryPage>{
 const {data,error}=await supabase.rpc('get_invoice_reminder_history',{p_business:business,p_invoice:invoice,p_before_at:before?.created_at??null,p_before_id:before?.id??null,p_limit:20})
 if(error||data?.invoice_id!==invoice||!Array.isArray(data.items)||data.items.length>20||!data.items.every(validItem)||typeof data.has_more!=='boolean'||data.last_attempt!==null&&!validItem(data.last_attempt)||data.last_success!==null&&!validItem(data.last_success))throw Error('Reminder history unavailable')
 return data
}
export async function recordInvoiceReminderDraft(business:string,token:string,channel:'email'|'sms',canceled=false){
 const {error}=await supabase.rpc('record_invoice_reminder_draft',{p_business:business,p_token:token,p_channel:channel,p_canceled:canceled})
 if(error)throw Error('The reminder draft could not be recorded. Refresh before trying again.')
}
