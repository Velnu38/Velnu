import {supabase} from '../lib/supabase'
import {announceCalendarChange} from '../lib/workEvents'
export type JobTask={id:string;title:string;completed:boolean;due_on:string|null;worker_id:string|null;version:number;visit_id?:string|null;priority?:'low'|'normal'|'high'}
export type JobTime={id:string;worked_on:string;worker_id:string|null;minutes:number;hourly_cost:number;note:string;version?:number}
export type JobBudget={revenue:number;cost:number;hours:number;version:number}
export type JobWorkspace={tasks:JobTask[];activity:{id:number;event:string;created_at:string}[];financial_access:boolean;budget?:JobBudget|null;time?:JobTime[];recorded_expenses?:number;pending_time_minutes?:number;uncalculated_expenses?:number;invoiced?:number;collected?:number;invoices?:{id:string;number:string|null;status:string;total:number;balance_due:number}[]}
export type FinanceOverview={currency_supported:boolean;as_of:string;receivables:{invoices:number;outstanding:number;overdue:number;overdue_count:number};aging:{bucket:string;count:number;amount:number}[];customers:{customer_id:string;customer:string;balance:number;invoices:number}[];oldest:{id:string;invoice_number:string;due_date:string;balance_due:number}[]}
export async function getJobWorkspace(business:string,job:string):Promise<JobWorkspace>{const{data,error}=await supabase.rpc('get_job_workspace',{p_business:business,p_job:job});if(error)throw error;if(!data||!Array.isArray(data.tasks)||!Array.isArray(data.activity)||typeof data.financial_access!=='boolean')throw Error('Work plan response could not be verified.');return data}
export async function manageJobWorkspace(business:string,job:string,action:string,payload:Record<string,unknown>):Promise<JobWorkspace>{const{data,error}=await supabase.rpc('manage_job_workspace',{p_business:business,p_job:job,p_action:action,p_payload:payload});if(error)throw error;announceCalendarChange();return data}
export async function getFinancialOverview(business:string):Promise<FinanceOverview>{const{data,error}=await supabase.rpc('get_financial_overview',{p_business:business});if(error)throw error;if(!data||Array.isArray(data)||typeof data.currency_supported!=='boolean'||(data.currency_supported&&(!data.receivables||!Array.isArray(data.aging)||!Array.isArray(data.customers)||!Array.isArray(data.oldest))))throw Error('Financial overview could not be verified.');return data}
export async function copyDocumentToDraft(business:string,kind:'invoice'|'estimate',id:string,request:string){const{data,error}=await supabase.rpc('copy_document_to_draft',{p_business:business,p_kind:kind,p_id:id,p_request:request});if(error)throw error;if(!data?.id||data.status!=='draft')throw Error('The new draft could not be confirmed. Refresh before trying again.');announceCalendarChange();return data as {id:string;status:string}}

export type JobPlanSummary={job_id:string;tasks_total:number;tasks_completed:number;due_tasks:number;financial_access:boolean;hours?:number;tracked_cost?:number;budget_cost?:number|null}
export async function getJobPlanSummaries(business:string,jobs:string[]):Promise<JobPlanSummary[]>{
 if(!jobs.length)return []
 if(jobs.length>4)throw Error('Choose up to four job summaries.')
 const{data,error}=await supabase.rpc('get_job_plan_summaries',{p_business:business,p_jobs:jobs})
 if(error)throw error
 if(!Array.isArray(data)||data.length!==jobs.length||jobs.some(id=>!data.some(row=>row.job_id===id))||data.some(row=>typeof row.financial_access!=='boolean'||!Number.isInteger(row.tasks_total)||!Number.isInteger(row.tasks_completed)||!Number.isInteger(row.due_tasks)||row.financial_access&&(!Number.isFinite(Number(row.hours))||!Number.isFinite(Number(row.tracked_cost)))))throw Error('Job summaries could not be verified.')
 return data
}
