import type { DocumentPayments } from '../components/PaymentOptionsFields'
import type { newCustomerFields } from '../components/CustomerEntry'
import { collectBusinessRecords } from '../lib/businessRecords'
import { validateDocumentInput } from '../lib/financialValidation'
import { supabase } from '../lib/supabase'
import { asList } from './relations'

export interface EstimateLineInput {
  description: string
  quantity: number
  unit_price: number
  tax_rate?: number
}

export async function listEstimates(businessId: string, customerId?: string) {
  const data = await collectBusinessRecords((from, to) => {
    let query = supabase
    .from('estimates')
    .select('created_at,updated_at,id,estimate_number,status,issue_date,expires_on,subtotal,tax_amount,total,customer_id,property_id,job_id,notes,customer_message,issuer_snapshot,customers!estimates_customer_id_fkey(id,first_name,last_name,company,email,phone)', { count: 'exact' })
    .eq('business_id', businessId)
    .order('id').range(from, to)
    if (customerId) query = query.eq('customer_id', customerId)
    return query
  })
  data.sort((a, b) => String(b.issue_date).localeCompare(String(a.issue_date)) || b.id.localeCompare(a.id))
  return (data ?? []).map((row: any) => ({ ...row, customers: asList(row.customers) }))
}

export async function createEstimate(
  businessId: string,
  input: Partial<DocumentPayments> & { new_customer?:ReturnType<typeof newCustomerFields>; customer_id: string; property_id?: string; issue_date?: string; expires_on?: string; notes?: string; customer_message?: string; request_id?: string; items: EstimateLineInput[] },
) {
  validateDocumentInput(input)

  // This database function inserts the document and all line items atomically.
  // An identical request_id can be retried safely after a lost network response.
  const { data, error } = await supabase.rpc('create_document', {
    target_business_id: businessId,
    document_kind: 'estimate',
    request_id: input.request_id ?? crypto.randomUUID(),
    payload: {
      customer_id: input.customer_id,
      ...(input.new_customer?{new_customer:input.new_customer}:{}),
      ...(input.payment_links?{payment_links:input.payment_links}:{}),
      ...(input.payment_instructions!==undefined?{payment_instructions:input.payment_instructions}:{}),
      ...(input.property_id ? { property_id: input.property_id } : {}),
      ...(input.issue_date ? { issue_date: input.issue_date } : {}),
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
