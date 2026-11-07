import {supabase} from '../lib/supabase'
import type {ReviewDeliveryReceipt} from './reviewDelivery'
export type InvoiceReminderReview={invoice_id:string;customer_id:string;number:string|null;email:string|null;phone:string|null;balance:number;due_date:string;version:string;subject:string;body:string;last_reminder:{at:string;channel:string;status:string}|null}
export async function getInvoiceReminderReview(business:string,invoice:string):Promise<InvoiceReminderReview>{
 const {data,error}=await supabase.rpc('get_invoice_reminder_review',{p_business:business,p_invoice:invoice})
 if(error)throw new Error(error.message||'Unable to prepare the reminder.')
 if(data?.invoice_id!==invoice||typeof data.body!=='string'||typeof data.subject!=='string')throw new Error('The reminder could not be verified.')
 return data
}
const pending=new Map<string,string>()
const key=(business:string,invoice:string)=>`finviant:invoice-reminder:${business}:${invoice}`
export async function sendInvoiceReminder(business:string,review:InvoiceReminderReview):Promise<ReviewDeliveryReceipt>{
 const storageKey=key(business,review.invoice_id)
 let id=pending.get(storageKey);try{id=id||sessionStorage.getItem(storageKey)||undefined}catch{/* Optional storage. */}
 id=id||crypto.randomUUID();pending.set(storageKey,id);try{sessionStorage.setItem(storageKey,id)}catch{/* In-memory retries remain protected. */}
 const {data,error}=await supabase.functions.invoke('send-invoice-reminder',{body:{business_id:business,invoice_id:review.invoice_id,request_id:id,expected_recipient:review.email,review}})
 if(error){let detail;try{detail=error.context instanceof Response?await error.context.clone().json():null}catch{/* Fall back to a safe retry message. */}throw new Error(detail?.error||'Reminder delivery is not confirmed. Retry this same reminder or check invoice activity.')}
 if(!data?.email_id||!['accepted','delivered'].includes(data.status)||data.recipient?.toLowerCase()!==review.email?.trim().toLowerCase())throw new Error('Reminder delivery is not confirmed. Retry this same reminder or check invoice activity.')
 pending.delete(storageKey);try{sessionStorage.removeItem(storageKey)}catch{/* Optional storage. */}
 return data
}
