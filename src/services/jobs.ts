import { collectBusinessRecords } from '../lib/businessRecords'
import { supabase } from '../lib/supabase'
import { asList } from './relations'
import { completeJob } from './schedulingWorkflow'
import { announceCalendarChange } from './calendar'
import type { JobAppointment, JobInvoice } from '../lib/jobActions'

export type JobWorkflow = { active_appointment: JobAppointment | null; invoice: JobInvoice | null }
type WorkflowRow = JobWorkflow & { job_id: string }

async function jobWorkflows(businessId: string, ids: string[]) {
  const rows: WorkflowRow[] = []
  for (let start = 0; start < ids.length; start += 200) {
    const { data, error } = await supabase.rpc('get_job_workflow_context', { p_business: businessId, p_jobs: ids.slice(start, start + 200) })
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('The current job schedule could not be verified. Refresh to try again.')
    if (ids.slice(start, start + 200).some(id => !data.some((row: WorkflowRow) => row.job_id === id))) throw new Error('A job changed or is no longer available. Refresh to review the current jobs.')
    rows.push(...data)
  }
  return new Map(rows.map(row => [row.job_id, { active_appointment: row.active_appointment ?? null, invoice: row.invoice ?? null }]))
}

export interface JobInput {
  customer_id: string
  property_id?: string
  title: string
  description?: string
  status?: 'lead' | 'scheduled' | 'in_progress' | 'completed' | 'canceled'
  scheduled_start?: string
  scheduled_end?: string
  assigned_user_ids?: string[]
  /** Reuse for the same submission after a network timeout; changes require a new ID. */
  request_id?: string
}

export async function listJobs(businessId: string, customerId?: string) {
  const data = await collectBusinessRecords((from, to) => {
    let query = supabase
    .from('jobs')
    .select('id, title, description, status, scheduled_start, scheduled_end, assigned_user_ids, source_estimate_id, customer_id, property_id, created_at, updated_at, completed_at, customers!jobs_customer_id_fkey(id,first_name,last_name,company),properties!jobs_property_id_fkey(id,label,address_line1,address_line2,city,state,postal_code)', { count: 'exact' })
    .eq('business_id', businessId)
    .order('id').range(from, to)
    if (customerId) query = query.eq('customer_id', customerId)
    return query
  })
  data.sort((a, b) => String(a.scheduled_start || '9999').localeCompare(String(b.scheduled_start || '9999')) || a.id.localeCompare(b.id))
  const workflow = await jobWorkflows(businessId, (data ?? []).map(row => row.id))
  return (data ?? []).map((row: any) => ({ ...row, ...workflow.get(row.id), customers: asList(row.customers), properties: asList(row.properties) }))
}

export type JobDirectoryFilter = 'all'|'active'|'today'|'unscheduled'|'in_progress'|'billing'|'attention'|'unassigned'|'scheduled'|'completed'|'current'|'upcoming'|'history'
export async function getJobDirectoryPage(businessId:string,options:{customerId?:string;filter:JobDirectoryFilter;workerId?:string;search:string;page:number}) {
  const {data,error}=await supabase.rpc('get_job_directory_page',{p_business:businessId,p_customer:options.customerId||null,p_filter:options.filter,p_worker:options.workerId||null,p_search:options.search.trim(),p_page:options.page})
  if(error)throw error
  if(!data||!Array.isArray(data.items)||data.items.length>25||!Number.isSafeInteger(data.total)||data.total<0||!Number.isSafeInteger(data.page)||data.page<0||data.page_size!==25||!data.counts||!Number.isSafeInteger(data.counts.all)||data.items.some((j:any)=>!j.id||!Array.isArray(j.customers)||!Array.isArray(j.properties)))throw Error('The job page could not be verified. Refresh to try again.')
  return data as {items:Awaited<ReturnType<typeof listJobs>>;total:number;page:number;page_size:number;counts:Record<JobDirectoryFilter,number>;checked_at:string}
}

export async function createJob(businessId: string, input: JobInput) {
  if (!input.customer_id || !input.title.trim()) throw new Error('Choose a customer and enter a job title')
  const { data, error } = await supabase.rpc(input.scheduled_start && input.assigned_user_ids?.length ? 'create_dispatched_job' : input.scheduled_start ? 'create_scheduled_job' : 'create_job_atomic', {
    target_business_id: businessId, request_id: input.request_id ?? crypto.randomUUID(),
    payload: { customer_id: input.customer_id, property_id: input.property_id || null,
      title: input.title.trim(), description: input.description?.trim() || null,
      scheduled_start: input.scheduled_start || null, scheduled_end: input.scheduled_end || null,
      ...(input.assigned_user_ids ? { assigned_user_ids: input.assigned_user_ids } : {}) },
  })
  if (error) throw error
  if (!data?.id) throw new Error('The job result could not be confirmed. Retry the same submission.')
  announceCalendarChange()
  return data
}
export async function updateJobStatus(jobId: string, status: JobInput['status']) {
  if (!status) throw new Error('Choose a job status')
  if (status === 'completed') return completeJob(jobId)
  const { data, error } = await supabase.rpc('set_job_status_atomic', { p_job_id: jobId, p_status: status })
  if (error) throw error
  if (!data?.id || data.status !== status) throw new Error('Job status could not be confirmed. Refresh before changing it again.')
  announceCalendarChange()
}

/** Resolve a source link directly, including jobs beyond the first list page. */
export async function getJob(businessId: string, id: string) {
  const { data, error } = await supabase.from('jobs')
    .select('id,title,description,status,scheduled_start,scheduled_end,assigned_user_ids,source_estimate_id,customer_id,created_at,updated_at,completed_at,customers!jobs_customer_id_fkey(id,first_name,last_name,company,email,phone),properties!jobs_property_id_fkey(id,label,address_line1,address_line2,city,state,postal_code)')
    .eq('business_id', businessId).eq('id', id).single()
  if (error) throw error
  const workflow = await jobWorkflows(businessId, [id])
  return { ...data, ...workflow.get(id), customers: asList(data.customers), properties: asList(data.properties) }
}

export async function reopenJob(jobId: string, requestId: string) {
  const { data, error } = await supabase.rpc('reopen_job', { p_job: jobId, p_request: requestId })
  if (error) throw error
  if (!data || data.job_id !== jobId || data.status !== 'lead') throw new Error('The reopened job could not be confirmed. Refresh before trying again.')
  announceCalendarChange()
  return data
}

export async function saveJobNotes(businessId: string, id: string, notes: string, previous: string|null) {
  if (notes.length > 4000) throw new Error('Keep job notes within 4,000 characters.')
  let query=supabase.from('jobs').update({description:notes.trim()||null}).eq('business_id',businessId).eq('id',id)
  query=previous===null?query.is('description',null):query.eq('description',previous)
  const {data,error}=await query.select('id').maybeSingle()
  if(error)throw error
  if(!data){const current=await getJob(businessId,id);if(current.description===(notes.trim()||null)){announceCalendarChange();return}throw new Error('This job changed elsewhere. Your edits are still here. Reload the latest details before merging your changes.')}
  if(data?.id !== id) throw new Error('The saved job could not be verified.')
  announceCalendarChange()
}
