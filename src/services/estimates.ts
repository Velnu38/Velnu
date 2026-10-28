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
    .select('id,estimate_number,status,issue_date,expires_on,subtotal,tax_amount,total,customer_id,job_id,notes,customer_message,issuer_snapshot,customers!estimates_customer_id_fkey(id,first_name,last_name,company,email,phone)')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map((row: any) => ({ ...row, customers: asList(row.customers) }))
}

export async function createEstimate(
  businessId: string,
  input: { customer_id: string; expires_on?: string; notes?: string; customer_message?: string; request_id?: string; items: EstimateLineInput[] },
) {
  if (!input.customer_id) throw new Error('Choose a customer')
  if (!input.items.length || input.items.length > 50) throw new Error('Enter 1 to 50 line items')
  if (input.notes && input.notes.length > 4000) throw new Error('Internal notes must be at most 4,000 characters')
  if (input.customer_message && input.customer_message.length > 4000) throw new Error('Customer message must be at most 4,000 characters')

  const validMoney = (value: number) => Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7
  for (const item of input.items) {
    if (!item.description.trim()) throw new Error('Every line item needs a description')
    if (!validMoney(item.quantity) || item.quantity <= 0 || item.quantity > 100000) throw new Error('Enter a valid quantity with at most 2 decimal places')
    if (!validMoney(item.unit_price) || item.unit_price < 0 || item.unit_price > 10000000) throw new Error('Enter a valid unit price with at most 2 decimal places')
    const tax = item.tax_rate ?? 0
    if (!validMoney(tax) || tax < 0 || tax > 100) throw new Error('Tax rate must be between 0% and 100%, with at most 2 decimal places')
  }

  // This database function inserts the document and all line items atomically.
  // An identical request_id can be retried safely after a lost network response.
  const { data, error } = await supabase.rpc('create_document', {
    target_business_id: businessId,
    document_kind: 'estimate',
    request_id: input.request_id ?? crypto.randomUUID(),
    payload: {
      customer_id: input.customer_id,
      expires_on: input.expires_on || null,
      notes: input.notes?.trim() || null,
      customer_message: input.customer_message?.trim() || null,
      items: input.items.map(item => ({
        description: item.description.trim(), quantity: item.quantity,
        unit_price: item.unit_price, tax_rate: item.tax_rate ?? 0,
      })),
    },
  })
  if (error) throw error
  return data as { id: string; estimate_number: string | null; status: string; subtotal: number; tax_amount: number; total: number; expires_on: string | null }
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
