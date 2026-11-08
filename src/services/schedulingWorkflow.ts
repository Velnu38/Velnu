import { supabase } from '../lib/supabase'
import { announceCalendarChange } from './calendar'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type Worker = {id:string;label:string;role:string;is_you:boolean}
export type Slot = {id?:string;starts_at:string;ends_at:string}
export type SchedulingPreferences = {work_days:number[];start_minutes:number;end_minutes:number;duration_minutes:number;buffer_minutes:number;notice_hours:number}
export type SchedulingContext = {
  preferences:SchedulingPreferences;team:Worker[]
  time_off:Array<{id:string;user_id:string;starts_at:string;ends_at:string;note:string}>
  properties?:Array<{id:string;label:string|null;address:string}>
  estimate?:{id:string;number:string|null;customer_id:string;job_id:string|null;property_id:string|null;title:string;scope:string;customer_name:string;customer_email:string|null}
  offer?:{id:string;status:string;expires_at:string;job_id:string|null}|null
}
export type OfferInput = {title:string;property_id:string|null;workers:string[];slots:Slot[];note:string;recipient_email?:string|null}
export type BookingView = {business_name:string;business_phone:string|null;title:string;timezone:string;note:string;address:string|null;status:'approved'|'booked'|'canceled'|'expired'|'paused'|'replaced'|'revoked'|'unavailable';status_reason?:string;can_book?:boolean;checked_at?:string;booking_reference?:string|null;business_email?:string|null;business_logo_path?:string|null;document_accent?:string|null;estimate_number?:string|null;booked_at?:string|null;expires_at:string;slots:Required<Slot>[];confirmed:(Slot&{status?:'scheduled'|'confirmed'|'in_progress'|'completed'|'canceled'})|null}
export type Completion = {job_id:string;status:'completed';invoice_ready:boolean;invoice_id:string|null;invoice_status?:string|null;needs_pricing:boolean;needs_review:boolean}
export type WorkflowActions = {approved_count?:number;completed_count?:number;approved:Array<{id:string;estimate_number:string|null;customer_name:string;offer:{status:string;expires_at:string}|null}>;completed:Array<{id:string;title:string;invoice_id:string|null;invoice_status:string|null;error_code:string|null}>}
async function rpc<T>(name:string,args:Record<string,unknown>):Promise<T> {
  const {data,error}=await supabase.rpc(name,args)
  if(error) throw Object.assign(new Error(error.message || 'This change could not be saved.'), { code: error.code })
  return data as T
}
async function action<T>(body:Record<string,unknown>):Promise<T> {
  const {data,error}=await supabase.functions.invoke('work-scheduling',{body})
  if(error) {
    if(error.context instanceof Response) {
      const response=await error.context.clone().json().catch(()=>null)
      if(response?.error) throw new Error(response.error)
    }
    throw new Error('The result is not confirmed. Refresh and retry the same action.')
  }
  if(data?.error) throw new Error(data.error)
  return data as T
}
export function getSchedulingContext(business:string,estimate?:string) {return rpc<SchedulingContext>('get_scheduling_context',{p_business:business,p_estimate:estimate || null})}
export function getScheduleTeam(business:string) {return rpc<Worker[]>('get_schedule_team',{p_business:business}).then(value=>{if(!Array.isArray(value))throw new Error('The team list is unavailable.');return value})}
export function suggestSlots(business:string,workers:string[],duration:number,from:string) {return rpc<Slot[]>('suggest_scheduling_slots',{p_business:business,p_workers:workers,p_duration:duration,p_from:from})}
export function workflowNextActions(business:string) {return rpc<WorkflowActions>('get_workflow_next_actions',{p_business:business})}
export async function tokenHash(token:string) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')
}
export function newBookingToken() {return Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('')}
export async function approveOffer(estimate:string,id:string,input:OfferInput,token:string) {
  return rpc<{id:string;status:string;expires_at:string}>('approve_scheduling_offer',{p_estimate:estimate,p_request:id,p_input:input,p_hash:await tokenHash(token)})
}
export async function bookApprovedEstimate(estimate:string,input:Omit<OfferInput,'slots'|'note'>&Slot) {
  const result=await rpc<{job_id:string;already_booked:boolean}>('book_approved_estimate',{p_estimate:estimate,p_input:input})
  announceCalendarChange();return result
}
let publicBookingClient: SupabaseClient | undefined
export async function customerBooking(token:string,slot?:string,name?:string) {
  // A customer link has its own narrow authority, independent of any staff session.
  publicBookingClient ??= createClient(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
  const {data,error}=await publicBookingClient.rpc('customer_schedule_offer',{p_token:token,p_slot:slot || null,p_name:name || null})
  if(error) throw Object.assign(new Error(error.message || 'This scheduling link is unavailable.'),{code:error.code})
  if(!data||typeof data.business_name!=='string'||!Array.isArray(data.slots)||typeof data.timezone!=='string')throw new Error('The appointment details could not be verified. Refresh the invitation and try again.')
  return data as BookingView
}
export function sendAvailability(offer:string,token:string,sendId:string) {return action<{status:string;warning?:string|null}>({action:'send_availability',offer_id:offer,token,send_id:sendId,approved:true})}
export async function completeJob(job:string,retryOnly=false) {const result=await action<Completion>({action:retryOnly?'prepare_invoice':'complete',job_id:job});announceCalendarChange();return result}
export async function saveSchedulingPreferences(business:string,input:SchedulingPreferences) {await rpc('save_scheduling_preferences',{p_business:business,p_input:input})}
export function manageTimeOff(business:string,worker:string,start:string,end:string,note:string,remove?:string) {return rpc('manage_worker_time_off',{p_business:business,p_worker:worker,p_start:start,p_end:end,p_note:note,p_remove:remove || null})}
type JobScheduleSnapshot = {id:string;scheduled_start:string|null;scheduled_end?:string|null;assigned_user_ids?:string[]}
export async function assignJobCrew(job:JobScheduleSnapshot,workers:string[]) {
  await rpc('assign_job_crew',{p_job:job.id,p_workers:workers,p_expected_workers:job.assigned_user_ids??[],
    p_expected_start:job.scheduled_start,p_expected_end:job.scheduled_end??null})
  announceCalendarChange()
}
export async function saveJobAppointment(job:JobScheduleSnapshot,start:string,end:string,useMySchedule:boolean) {
  await rpc('save_job_appointment',{p_job:job.id,p_start:start,p_end:end,p_expected_start:job.scheduled_start,
    p_expected_end:job.scheduled_end??null,p_use_my_schedule:useMySchedule})
  announceCalendarChange()
}
export function createJobInvoice(job:string,request:string,items:Array<{description:string;quantity:number;unit_price:number;tax_rate:number}>,due?:string,details?:{issue_date:string;notes:string;payment_links?:import('./settings').PaymentLink[];payment_instructions?:string}) {return rpc<{id:string;already_created:boolean}>('create_job_invoice',{p_job:job,p_request:request,p_items:items,p_due:due || null,p_details:details || {}})}

export type InvoiceJobContext = SchedulingContext & {
 invoice:{id:string;number:string|null;customer_id:string;customer_name:string;job_id:string|null;property_id:string|null;title:string;scope:string};
 schedule:{starts_at:string;ends_at:string}|null;
}
export function getInvoiceJobContext(invoice:string) {return rpc<InvoiceJobContext>('get_invoice_job_context',{p_invoice:invoice})}
export async function bookInvoiceJob(invoice:string,request:string,input:{title:string;property_id:string|null;workers:string[];starts_at:string;ends_at:string}) {
 const result=await rpc<{job_id:string;already_created:boolean}>('book_invoice_job',{p_invoice:invoice,p_request:request,p_input:input});
 if(!result?.job_id)throw new Error('The job result could not be confirmed. Retry the same scheduling request.');
 announceCalendarChange();return result
}
