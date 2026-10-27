import { supabase } from '../lib/supabase'
import { asList } from './relations'

export interface JobInput {
  customer_id: string
  property_id?: string
  title: string
  description?: string
  status?: 'lead' | 'scheduled' | 'in_progress' | 'completed' | 'canceled'
  scheduled_start?: string
  scheduled_end?: string
  /** Reuse for the same submission after a network timeout; changes require a new ID. */
  request_id?: string
}

export async function listJobs(businessId: string) {
  const { data, error } = await supabase
    .from('jobs')
    .select('id, title, description, status, scheduled_start, scheduled_end, customer_id, property_id, customers!jobs_customer_id_fkey(id,first_name,last_name,company),properties!jobs_property_id_fkey(id,label,address_line1,address_line2,city,state,postal_code)')
    .eq('business_id', businessId)
    .order('scheduled_start', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map((row: any) => ({ ...row, customers: asList(row.customers), properties: asList(row.properties) }))
}

export async function createJob(businessId: string, input: JobInput) {
  if (!input.customer_id) throw new Error('Choose a customer')
  if (!input.title.trim()) throw new Error('Job title is required')
  // One Postgres transaction creates the scheduled job and its appointment.
  // The RPC checks tenant and property ownership and serializes retries by request ID.
  if (input.scheduled_start) {
    const { data, error } = await supabase.rpc('create_scheduled_job', {
      target_business_id: businessId,
      request_id: input.request_id ?? crypto.randomUUID(),
      payload: {
        customer_id: input.customer_id,
        property_id: input.property_id || null,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        scheduled_start: input.scheduled_start,
        scheduled_end: input.scheduled_end || null,
      },
    })
    if (error) throw error
    if (!data?.id || !data?.appointment_id) throw new Error('Scheduling result was incomplete. Check the calendar before retrying.')
    return data
  }

  if (input.property_id) {
    const { data: property, error: propertyError } = await supabase.from('properties')
      .select('id').eq('business_id', businessId).eq('customer_id', input.customer_id).eq('id', input.property_id).maybeSingle()
    if (propertyError) throw propertyError
    if (!property) throw new Error('Choose a service location that belongs to this customer.')
  }

  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      business_id: businessId,
      customer_id: input.customer_id,
      property_id: input.property_id || null,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      status: input.status ?? (input.scheduled_start ? 'scheduled' : 'lead'),
      scheduled_start: input.scheduled_start || null,
      scheduled_end: input.scheduled_end || null,
    })
    .select()
    .single()

  if (error) throw error

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
