import { supabase } from '../lib/supabase'
import { announceCalendarChange } from './calendar'

export type RecurringStatus = 'active'|'paused'|'ended'
export type RecurringFilter = 'current'|'all'|RecurringStatus
export type RecurringPlan = {
 id:string; source_invoice_id:string; title:string; cadence:string; next_date:string; end_date:string|null;
 status:RecurringStatus; last_error:string|null; schedule_visit:boolean; timezone:string; visit_time:string; due_days:number; created_at:string;
 occurrences:Array<{id:string;bill_date:string;invoice_id:string|null;job_id:string|null;schedule_error:string|null}>
}
export type RecurringPage = {items:RecurringPlan[];has_more:boolean;counts:{active:number;paused:number;ended:number}}
export type RecurringOptions = {title:string;cadence:'weekly'|'fortnightly'|'monthly'|'quarterly'|'yearly';first_date:string;end_date:string;due_days:number;schedule_visit:boolean;visit_time:string;duration_minutes:number;workers:string[]}

export async function listRecurringPlans(business:string,status:RecurringFilter='current',before?:{created_at:string;id:string}):Promise<RecurringPage>{
 const {data,error}=await supabase.rpc('get_recurring_invoice_page',{p_business:business,p_status:status,p_before:before?.created_at??null,p_before_id:before?.id??null})
 if(error)throw error
 if(!data||!Array.isArray(data.items)||data.items.length>25||typeof data.has_more!=='boolean'||!data.counts||data.items.some((p:RecurringPlan)=>!p.id||!p.created_at||!Array.isArray(p.occurrences)))throw Error('Recurring schedules could not be verified. Refresh to try again.')
 return data
}
export async function createRecurringPlan(invoice:string,request:string,options:RecurringOptions){
 const title=options.title.trim()
 if(!title||title.length>200)throw Error('Enter a schedule name of up to 200 characters.')
 if(!Number.isInteger(options.due_days)||options.due_days<0||options.due_days>365)throw Error('Choose 0–365 days until payment is due.')
 if(options.schedule_visit&&(!options.workers.length||options.workers.length>20))throw Error('Choose between 1 and 20 available worker profiles.')
 const {data,error}=await supabase.rpc('create_recurring_invoice',{p_invoice:invoice,p_request:request,p_options:{...options,title}})
 if(error)throw error
 if(!data||data.id!==request||!['active','paused','ended'].includes(data.status))throw Error('The schedule result could not be confirmed. Retry these same settings.')
 announceCalendarChange()
 return data as {id:string;status:RecurringStatus}
}
export async function setRecurringStatus(plan:string,status:'active'|'paused'){
 const {error}=await supabase.rpc('set_recurring_invoice_status',{p_plan:plan,p_status:status})
 if(error)throw error
 announceCalendarChange()
}
