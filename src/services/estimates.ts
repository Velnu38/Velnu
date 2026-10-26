import { supabase } from '../lib/supabase'
import { asList } from './relations'

export interface EstimateLineInput {
  description: string
  quantity: number
  unit_price: number
  tax_rate?: number
}

export async function listEstimates(businessId: string) {
  const { data, error } = await supabase
    .from('estimates')
    .select('id,estimate_number,status,issue_date,expires_on,subtotal,tax_amount,total,customer_id,notes,customer_message,customers!estimates_customer_id_fkey(id,first_name,last_name,company,email,phone)')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map((row: any) => ({ ...row, customers: asList(row.customers) }))
}

export async function createEstimate(
  businessId: string,
  input: { customer_id: string; expires_on?: string; notes?: string; customer_message?: string; items: EstimateLineInput[] },
) {
  if (!input.customer_id) throw new Error('Choose a customer')
  if (!input.items.length) throw new Error('Add at least one line item')

  for (const item of input.items) {
    if (!item.description.trim()) throw new Error('Every line item needs a description')
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error('Quantity must be greater than zero')
    if (!Number.isFinite(item.unit_price) || item.unit_price < 0) throw new Error('Unit price cannot be negative')
    if ((item.tax_rate ?? 0) < 0) throw new Error('Tax rate cannot be negative')
  }

  const { data: estimate, error } = await supabase
    .from('estimates')
    .insert({
      business_id: businessId,
      customer_id: input.customer_id,
      status: 'draft',
      expires_on: input.expires_on || null,
      notes: input.notes?.trim() || null,
      customer_message: input.customer_message?.trim() || null,
    })
    .select('id,estimate_number')
    .single()

  if (error) throw error

  const rows = input.items.map((item, index) => ({
    estimate_id: estimate.id,
    business_id: businessId,
    description: item.description.trim(),
    quantity: item.quantity,
    unit_price: item.unit_price,
    tax_rate: item.tax_rate ?? 0,
    sort_order: index,
  }))

  const { error: itemError } = await supabase.from('estimate_items').insert(rows)
  if (itemError) {
    await supabase.from('estimates').delete().eq('id', estimate.id)
    throw itemError
  }

  const { data: full, error: fullError } = await supabase
    .from('estimates')
    .select('id,estimate_number,status,subtotal,tax_amount,total,expires_on')
    .eq('id', estimate.id)
    .single()

  if (fullError) throw fullError
  return full
}

export async function updateEstimateStatus(estimateId: string, status: 'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'converted') {
  const { error } = await supabase.from('estimates').update({ status }).eq('id', estimateId)
  if (error) throw error
}

export async function convertEstimateToInvoice(estimateId: string, dueDate?: string) {
  const { data, error } = await supabase.rpc('convert_estimate_to_invoice', {
    target_estimate_id: estimateId,
    target_due_date: dueDate || null,
  })

  if (error) throw error
  return data as string
}


export async function listEstimateItems(businessId: string, estimateId: string) {
  const { data, error } = await supabase.from('estimate_items')
    .select('id,description,quantity,unit_price,tax_rate,line_total,sort_order')
    .eq('business_id', businessId).eq('estimate_id', estimateId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data ?? []
}
