import { supabase } from '../lib/supabase'
import { asList } from './relations'

export interface JobInput {
  customer_id: string
  title: string
  description?: string
  status?: 'lead' | 'scheduled' | 'in_progress' | 'completed' | 'canceled'
  scheduled_start?: string
  scheduled_end?: string
}

export async function listJobs(businessId: string) {
  const { data, error } = await supabase
    .from('jobs')
    .select('id, title, description, status, scheduled_start, scheduled_end, customer_id, customers!jobs_customer_id_fkey(id,first_name,last_name,company)')
    .eq('business_id', businessId)
    .order('scheduled_start', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map((row: any) => ({ ...row, customers: asList(row.customers) }))
}

export async function createJob(businessId: string, input: JobInput) {
  if (!input.customer_id) throw new Error('Choose a customer')
  if (!input.title.trim()) throw new Error('Job title is required')

  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      business_id: businessId,
      customer_id: input.customer_id,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      status: input.status ?? (input.scheduled_start ? 'scheduled' : 'lead'),
      scheduled_start: input.scheduled_start || null,
      scheduled_end: input.scheduled_end || null,
    })
    .select()
    .single()

  if (error) throw error

  if (input.scheduled_start) {
    const { error: appointmentError } = await supabase.from('appointments').insert({
      business_id: businessId,
      customer_id: input.customer_id,
      job_id: job.id,
      title: job.title,
      starts_at: input.scheduled_start,
      ends_at: input.scheduled_end || null,
      status: 'scheduled',
    })

    if (appointmentError) {
      await supabase.from('jobs').delete().eq('id', job.id)
      throw appointmentError
    }
  }

  return job
}

export async function updateJobStatus(jobId: string, status: JobInput['status']) {
  const payload: Record<string, unknown> = { status }
  if (status === 'completed') payload.completed_at = new Date().toISOString()
  const { error } = await supabase.from('jobs').update(payload).eq('id', jobId)
  if (error) throw error

  if (status === 'completed' || status === 'canceled') {
    const appointmentStatus = status === 'completed' ? 'completed' : 'canceled'
    const { error: appointmentError } = await supabase
      .from('appointments')
      .update({ status: appointmentStatus })
      .eq('job_id', jobId)
      .in('status', ['scheduled', 'confirmed', 'in_progress'])
    if (appointmentError) throw appointmentError
  }
}
