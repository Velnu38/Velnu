import type { ChangeOrderAmounts } from '../lib/changeOrderAmounts'
import {supabase} from '../lib/supabase'
import {createShareToken,personalEmailHref,personalSmsHref} from '../lib/personalDelivery'
import {normalizeMobile} from '../lib/smsPhone'
import type {DeliveryDocumentKind} from './reviewDelivery'
export type SharedDocument={change_totals?:ChangeOrderAmounts|null;kind:DeliveryDocumentKind;number:string;status:string;issue_date:string;due_date:string|null;expires_on:string|null;subtotal:number;tax_amount:number;total:number;balance_due:number|null;amount_paid:number|null;customer_message:string|null;payment_instructions:string|null;payment_links:{provider:string;url:string}[];items:{description:string;quantity:number;unit_price:number;line_total:number}[];customer:{name:string;email:string|null;phone:string|null};company:{name:string;email:string|null;phone:string|null};finviant_branding:boolean;approval_token?:string|null;expires_at:string}
export type PreparedShare={token:string;url:string;subject:string;body:string;snapshot:SharedDocument}
export async function preparePersonalDocument(business:string,kind:DeliveryDocumentKind,id:string,token=createShareToken()):Promise<PreparedShare>{
 const{data,error}=await supabase.rpc('prepare_personal_document',{p_business:business,p_kind:kind,p_document:id,p_token:token});if(error)throw new Error(error.message)
 if(!data?.snapshot||!Array.isArray(data.snapshot.items))throw new Error('The saved document could not be prepared.')
 const snapshot=data.snapshot as SharedDocument,url=new URL('/?document_share='+token,window.location.origin).toString()
 const label=kind==='change_order'?'Change order':kind==='estimate'?'Estimate':'Invoice',subject=`${snapshot.company.name}: ${label} ${snapshot.number||''}`.trim()
 return {token,url,subject,body:`${subject}\n\nHello ${snapshot.customer.name},\n\nPlease review your ${label.toLowerCase()}: ${url}\n\nTotal: $${Number(snapshot.total).toFixed(2)}${kind==='invoice'?`\nBalance due: $${Number(snapshot.balance_due??snapshot.total).toFixed(2)}`:''}\n\n${snapshot.company.name}`,snapshot}
}
export async function confirmPersonalSent(business:string,token:string,channel:'email'|'sms'){const{error}=await supabase.rpc('confirm_personal_document_sent',{p_business:business,p_token:token,p_channel:channel});if(error)throw new Error(error.message)}
export async function getSharedDocument(token:string):Promise<SharedDocument>{const{data,error}=await supabase.rpc('get_shared_document',{p_token:token});if(error)throw new Error(error.message);return data}

export type PersonalChannel = 'email' | 'sms'
export type PendingPersonalSend = { token: string; channel: PersonalChannel }

export async function releasePersonalApproval(businessId: string, kind: DeliveryDocumentKind, token: string) {
  if (kind === 'invoice') return
  const { error } = await supabase.rpc('release_personal_approval', { p_business: businessId, p_token: token })
  if (error) throw new Error(error.message)
}

export function nativeDocumentDraft(share: PreparedShare, channel: PersonalChannel, recipient: string, reminder?: { subject: string; body: string }) {
  const customer = share.snapshot.customer
  if (channel === 'email') {
    if (customer.email?.trim().toLowerCase() !== recipient.trim().toLowerCase()) throw new Error('The saved recipient changed. Review the contact before sending.')
    return personalEmailHref(customer.email || '', reminder?.subject || share.subject, reminder ? reminder.body + '\n\nReview: ' + share.url : share.body)
  }
  if (normalizeMobile(customer.phone || '') !== normalizeMobile(recipient)) throw new Error('The saved recipient changed. Review the contact before sending.')
  return personalSmsHref(customer.phone || '', (reminder?.subject || share.subject) + '\nReview: ' + share.url)
}

async function pendingKey(business: string, kind: DeliveryDocumentKind, document: string) {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ? ['finviant-send', data.session.user.id, business, kind, document].join(':') : null
}

export async function readPendingPersonalSend(business: string, kind: DeliveryDocumentKind, document: string): Promise<PendingPersonalSend | null> {
  try {
    const key = await pendingKey(business, kind, document)
    const saved = key && sessionStorage.getItem(key)
    if (!saved) return null
    const value = JSON.parse(saved)
    return /^[a-f0-9]{64}$/.test(value.token) && ['email','sms'].includes(value.channel) ? value : null
  } catch { return null }
}

export async function storePendingPersonalSend(business: string, kind: DeliveryDocumentKind, document: string, pending: PendingPersonalSend | null) {
  try {
    const key = await pendingKey(business, kind, document)
    if (key && pending) sessionStorage.setItem(key, JSON.stringify(pending))
    else if (key) sessionStorage.removeItem(key)
  } catch { /* The current confirmation is still available if browser storage is disabled. */ }
}
