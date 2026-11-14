import {supabase} from '../lib/supabase'
export type NoticeSnapshot={customer_id:string;invoice_id:string|null;job_id:string|null;payload:{to:string[];subject:string;text:string}}
export type NoticeReview={id:string;eligible:boolean;status:string;snapshot:NoticeSnapshot|null}
async function rpc<T>(name:string,args:Record<string,unknown>):Promise<T>{const{data,error}=await supabase.rpc(name,args);if(error)throw error;return data as T}
export function noticeStatus(status:string){return ({pending:'Preparing',queued:'Queued',sending:'Sending',accepted:'Accepted for delivery',delivered:'Delivered',failed:'Failed',uncertain:'Outcome unconfirmed',reconciliation_required:'Needs review',blocked:'Needs attention',skipped:'Not sent'} as Record<string,string>)[status]||'Status unavailable'}
export async function reviewJourneyNotice(business:string,event:string){
 const data=await rpc<NoticeReview>('review_journey_notice',{p_business:business,p_event:event})
 if(!data||data.id!==event||typeof data.eligible!=='boolean'||typeof data.status!=='string'||data.eligible&&(!data.snapshot||!Array.isArray(data.snapshot.payload?.to)||data.snapshot.payload.to.length!==1||typeof data.snapshot.payload.to[0]!=='string'||typeof data.snapshot.payload.subject!=='string'||typeof data.snapshot.payload.text!=='string'))throw Error('The customer notice could not be verified.')
 return data
}
export async function queueJourneyNotice(business:string,review:NoticeReview){
 const data=await rpc<{id:string;status:string}>('queue_reviewed_journey_notice',{p_business:business,p_event:review.id,p_expected:review.snapshot})
 if(!data||data.id!==review.id||typeof data.status!=='string')throw Error('The notice result is not confirmed. Check this same notice before trying again.')
 return data
}
export type NoticeSettings={booking_confirmation:boolean;payment_receipt:boolean;version:number;ready:boolean}
function verifySettings(data:NoticeSettings){if(!data||[data.booking_confirmation,data.payment_receipt,data.ready].some(v=>typeof v!=='boolean')||!Number.isSafeInteger(data.version)||data.version<0)throw Error('Notification settings could not be verified.');return data}
export async function getJourneyNoticeSettings(business:string){return verifySettings(await rpc<NoticeSettings>('get_journey_notice_settings',{p_business:business}))}
export async function saveJourneyNoticeSettings(business:string,settings:NoticeSettings){return verifySettings(await rpc<NoticeSettings>('save_journey_notice_settings',{p_business:business,p_booking:settings.booking_confirmation,p_receipt:settings.payment_receipt,p_version:settings.version}))}
