import { collectBusinessRecords } from '../lib/businessRecords'
import { supabase } from '../lib/supabase'
import { asList } from './relations'
import { completeJob } from './schedulingWorkflow'

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

export async function listJobs(businessId: string) {
  const data = await collectBusinessRecords((from, to) => supabase
    .from('jobs')
    .select('id, title, description, status, scheduled_start, scheduled_end, assigned_user_ids, source_estimate_id, customer_id, property_id, customers!jobs_customer_id_fkey(id,first_name,last_name,company),properties!jobs_property_id_fkey(id,label,address_line1,address_line2,city,state,postal_code)', { count: 'exact' })
    .eq('business_id', businessId)
    .order('id').range(from, to))
  data.sort((a, b) => String(a.scheduled_start || '9999').localeCompare(String(b.scheduled_start || '9999')) || a.id.localeCompare(b.id))
  return (data ?? []).map((row: any) => ({ ...row, customers: asList(row.customers), properties: asList(row.properties) }))
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
  return data
}
export async function updateJobStatus(jobId: string, status: JobInput['status']) {
  if (!status) throw new Error('Choose a job status')
  if (status === 'completed') return completeJob(jobId)
  const { data, error } = await supabase.rpc('set_job_status_atomic', { p_job_id: jobId, p_status: status })
  if (error) throw error
  if (!data?.id || data.status !== status) throw new Error('Job status could not be confirmed. Refresh before changing it again.')
}

/** Resolve a source link directly, including jobs beyond the first list page. */
export async function getJob(businessId: string, id: string) {
  const { data, error } = await supabase.from('jobs')
    .select('id,title,description,status,scheduled_start,scheduled_end,assigned_user_ids,source_estimate_id,customer_id,customers!jobs_customer_id_fkey(id,first_name,last_name,company)')
    .eq('business_id', businessId).eq('id', id).single()
  if (error) throw error
  return { ...data, customers: asList(data.customers) }
}
