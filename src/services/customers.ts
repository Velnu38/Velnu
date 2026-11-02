import { collectBusinessRecords } from '../lib/businessRecords'
import { supabase } from '../lib/supabase'

export interface CustomerInput {
  first_name?: string
  last_name?: string
  company?: string
  email?: string
  phone?: string
  preferred_contact?: 'sms' | 'email' | 'phone' | 'none'
  notes?: string
}

export async function listCustomers(businessId: string) {
  const data = await collectBusinessRecords((from, to) => supabase
    .from('customers')
    .select('*', { count: 'exact' })
    .eq('business_id', businessId)
    .eq('archived', false)
    .order('id').range(from, to))
  data.sort((a, b) => String(a.last_name || a.company || '').localeCompare(String(b.last_name || b.company || '')) || String(a.first_name || '').localeCompare(String(b.first_name || '')))
  return data
}

export async function createCustomer(businessId: string, input: CustomerInput) {
  if (!input.first_name?.trim() && !input.last_name?.trim() && !input.company?.trim()) {
    throw new Error('Enter a customer name or company')
  }

  const payload = {
    business_id: businessId,
    first_name: input.first_name?.trim() || null,
    last_name: input.last_name?.trim() || null,
    company: input.company?.trim() || null,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    preferred_contact: input.preferred_contact || null,
    notes: input.notes?.trim() || null,
  }

  const { data, error } = await supabase.from('customers').insert(payload).select().single()
  if (error) throw error
  return data
}

export async function updateCustomer(customerId: string, input: CustomerInput) {
  const { data, error } = await supabase
    .from('customers')
    .update({
      first_name: input.first_name?.trim() || null,
      last_name: input.last_name?.trim() || null,
      company: input.company?.trim() || null,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      preferred_contact: input.preferred_contact || null,
      notes: input.notes?.trim() || null,
    })
    .eq('id', customerId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function archiveCustomer(customerId: string) {
  const { error } = await supabase.from('customers').update({ archived: true }).eq('id', customerId)
  if (error) throw error
}
