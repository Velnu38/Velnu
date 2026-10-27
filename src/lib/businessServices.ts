import { supabase } from './supabase'
import {
  normalizeInterests, serviceCatalog, type ServiceId, type ServiceInterest,
  type PlanInterest, defaultServiceInterest,
} from './serviceCatalog'

export async function loadBusinessServiceInterests(businessId: string): Promise<ServiceInterest | null> {
  const { data, error } = await supabase.from('business_service_interests')
    .select('preferred_plan,selected_services').eq('business_id',businessId).maybeSingle()
  if (error) throw error
  if (!data) return null
  return normalizeInterests({
    plan: data.preferred_plan,
    services: data.selected_services,
  })
}
export async function saveBusinessServiceInterests(businessId: string, value: ServiceInterest): Promise<void> {
  const { data: auth, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!auth.user) throw new Error('Sign in to save your service choices.')
  const interest = normalizeInterests(value)
  const { error } = await supabase.from('business_service_interests').upsert({
    business_id: businessId,
    preferred_plan: interest.plan,
    selected_services: interest.services,
    updated_by: auth.user.id,
  }, { onConflict: 'business_id' })
  if (error) throw error
}

export type { ServiceId, ServiceInterest, PlanInterest }
export { serviceCatalog, defaultServiceInterest }
