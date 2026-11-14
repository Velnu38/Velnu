import {supabase} from '../lib/supabase'
export const workflowLabels:Record<string,string>={job_created:'Job created',work_started:'Work started',work_completed:'Work completed',work_canceled:'Work canceled',work_reopened:'Work reopened',appointment_booked:'Appointment booked',appointment_changed:'Appointment changed',appointment_canceled:'Appointment canceled',invoice_opened:'Issued invoice link opened',payment_received:'Payment applied to invoice',payment_changed:'Applied payment changed'}
export type WorkflowEvent={id:string;job_id:string|null;invoice_id:string|null;kind:string;created_at:string;revision_id:string|null;notice?:{status:string}}
export type WorkflowPage={items:WorkflowEvent[];total:number;page:number;page_size:number}
export async function getWorkflowActivity(business:string,scope:{job?:string;invoice?:string},page=0):Promise<WorkflowPage>{
  const{data,error}=await supabase.rpc('get_workflow_activity',{p_business:business,p_job:scope.job||null,p_invoice:scope.invoice||null,p_page:page})
  if(error)throw error
  if(!data||!Array.isArray(data.items)||!Number.isSafeInteger(data.total)||data.total<0||data.page!==page||data.page_size!==25
    ||data.items.some((e:WorkflowEvent)=>!e||typeof e.id!=='string'||!workflowLabels[e.kind]||!Number.isFinite(Date.parse(e.created_at))||e.notice!=null&&typeof e.notice.status!=='string'))throw Error('Workflow history could not be verified.')
  return data
}

/** Logging must never block the customer's document or payment controls. */
export async function recordInvoiceOpen(token:string):Promise<void>{
  const{error}=await supabase.rpc('record_customer_invoice_open',{p_token:token})
  if(error)throw error
}
