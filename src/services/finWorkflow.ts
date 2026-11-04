import {supabase} from '../lib/supabase'
import {invokeAi} from './ai'
import {uiCatalog,uuid} from '../../supabase/functions/fin-workflow/protocol'
import type {Plan} from '../../supabase/functions/fin-workflow/protocol'
export type FinReply={answer:string;clarification?:string|null;sources:{key:string;label:string;href?:string|null}[];limits:string[];as_of:string;timezone?:string;navigation?:string[];plan?:Plan;execution?:FinExecution}
export type FinExecution={status:'completed';steps:{operation:string;resource:string;id:string;label:string;status:'completed'|'awaiting_send_review';channel?:string}[]}
export async function requestFin(business:string,thread:string,request:string,text:string):Promise<FinReply>{
 const query=new URLSearchParams(location.search);const view=query.get('view')==='settings'&&query.has('section')?query.get('section')!:query.get('view')||'dashboard';const id=query.get('document');const page={view:Object.hasOwn(uiCatalog,view)?view:'dashboard',record_id:id&&uuid.test(id)?id:null}
 const {data,error}=await invokeAi('fin-workflow',{body:{business_id:business,thread_id:thread,request_id:request,text,page},timeout:150000})
 if(error){if(error.context instanceof Response){const response=await error.context.clone().json().catch(()=>null);if(response?.error)throw new Error(response.error)}throw new Error('Fin could not finish this request. Your words are still here; retry when ready.')}
 if(typeof data?.answer!=='string'||!Array.isArray(data.sources)||!Array.isArray(data.limits)||data.plan&&(!data.plan.id||!Array.isArray(data.plan.steps)))throw new Error('Fin could not verify a complete response. No changes were saved.')
 return data
}
export async function executeFinReview(business:string,thread:string,plan:Plan):Promise<FinExecution>{
 const {data,error}=await supabase.rpc('fin_execute_review',{p_business:business,p_thread:thread,p_review:plan.id,p_version:plan.version,p_approved:true})
 if(error)throw new Error(error.message||'The result could not be confirmed. Retry this same review to check it safely.')
 if(data?.status!=='completed'||!Array.isArray(data.steps))throw new Error('The result could not be confirmed. Retry this same review; it will not repeat completed changes.')
 return data
}
export async function cancelFinReview(business:string,thread:string,plan:Plan){const {error}=await supabase.rpc('fin_cancel_review',{p_business:business,p_thread:thread,p_review:plan.id});if(error)throw new Error('Cancellation could not be confirmed. Retry cancellation.')}
