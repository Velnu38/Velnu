import { supabase } from '../lib/supabase'
import { asList } from './relations'

export async function listAppointments(businessId: string, from?: string, to?: string) {
  let query = supabase
    .from('appointments')
    .select('id,title,starts_at,ends_at,status,customer_id,job_id,customers!appointments_customer_id_fkey(id,first_name,last_name,company),jobs!appointments_job_id_fkey(id,title,status,properties!jobs_property_id_fkey(id,label,address_line1,address_line2,city,state,postal_code))')
    .eq('business_id', businessId)
    .neq('status', 'canceled')
    .order('starts_at', { ascending: true })

  if (from) query = query.gte('starts_at', from)
  if (to) query = query.lt('starts_at', to)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map((row: any) => ({ ...row, customers: asList(row.customers), jobs: asList(row.jobs).map((job: any) => ({ ...job, properties: asList(job.properties) })) }))
}

export async function updateAppointmentStatus(appointmentId: string, status: 'scheduled' | 'confirmed' | 'in_progress' | 'completed' | 'canceled' | 'no_show') {
  const { error } = await supabase.from('appointments').update({ status }).eq('id', appointmentId)
  if (error) throw error
}
