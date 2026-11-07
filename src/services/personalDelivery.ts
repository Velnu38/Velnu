import type { ChangeOrderAmounts } from '../lib/changeOrderAmounts'
import {supabase} from '../lib/supabase'
import {createShareToken} from '../lib/personalDelivery'
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
