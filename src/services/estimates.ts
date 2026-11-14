import type { DocumentPayments } from '../components/PaymentOptionsFields'
import type { newCustomerFields } from '../components/CustomerEntry'
import { collectBusinessRecords } from '../lib/businessRecords'
import { validateDocumentInput } from '../lib/financialValidation'
import { supabase } from '../lib/supabase'
import { asList } from './relations'
import { createShareToken } from '../lib/personalDelivery'
import {estimatePaymentMessage} from '../lib/estimatePaymentTerms'

export type EstimateWorkflowContext = {
  estimate_id: string
  job: { id: string; title?: string; status: string; scheduled_start: string | null; scheduled_end: string | null; assigned_user_ids?: string[] } | null
  appointment: { id: string; status: string; starts_at: string; ends_at: string | null } | null
  schedule: { id: string; status: string; scheduled_start_time: string; scheduled_end_time: string; timezone?: string } | null
  invitation: { status: string; expires_at: string } | null
  final_invoice_id: string | null
}

/** A read-only projection; booking and customer authority stay in their existing RPCs. */
export async function getEstimateWorkflowContexts(businessId: string, estimateIds: string[]) {
  const ids = [...new Set(estimateIds)]
  const rows: EstimateWorkflowContext[] = []
  for (let offset = 0; offset < ids.length; offset += 200) {
    const { data, error } = await supabase.rpc('get_estimate_workflow_context', { p_business: businessId, p_estimates: ids.slice(offset, offset + 200) })
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('The estimate work details could not be verified. Refresh before scheduling.')
    rows.push(...data as EstimateWorkflowContext[])
  }
  return rows
}

/** Reuse requestId after an uncertain response; the issued agreement is never reopened. */
export async function createRevisedEstimate(estimateId: string, requestId: string) {
  const { data, error } = await supabase.rpc('create_revised_estimate', { p_estimate: estimateId, p_request: requestId })
  if (error) throw error
  if (!data?.estimate_id || typeof data.estimate_id !== 'string') throw new Error('The revised draft could not be confirmed. Retry this same request; do not create another estimate.')
  return data as { estimate_id: string; already_created: boolean }
}

export async function prepareEstimateCopy(businessId: string, estimateId: string, token = createShareToken()) {
  const { data, error } = await supabase.rpc('prepare_document_copy', { p_business: businessId, p_kind: 'estimate', p_document: estimateId, p_token: token })
  if (error) throw error
  if (!data?.snapshot || typeof data.revision_id !== 'string') throw new Error('The read-only estimate copy could not be verified. Try this same copy again.')
  return { url: new URL('/?document_share=' + token, window.location.origin).toString(), revisionId: data.revision_id as string }
}

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
    .select('created_at,updated_at,id,estimate_number,status,issue_date,expires_on,subtotal,tax_amount,total,customer_id,property_id,job_id,notes,customer_message,customer_reference,issuer_snapshot,properties!estimates_property_business_fkey(address_line1,address_line2,city,state,postal_code),customers!estimates_customer_id_fkey(id,first_name,last_name,company,email,phone)', { count: 'exact' })
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
  input: Partial<DocumentPayments> & { new_customer?:ReturnType<typeof newCustomerFields>; customer_id: string; property_id?: string; issue_date?: string; expires_on?: string; notes?: string; customer_reference?: string; customer_message?: string; payment_terms_days?:number|null; request_id?: string; items: EstimateLineInput[] },
) {
  validateDocumentInput({...input,customer_message:estimatePaymentMessage(input.customer_message||'',input.payment_terms_days==null?'':String(input.payment_terms_days))})

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
      customer_reference: input.customer_reference?.trim() || null,
      customer_message: input.customer_message?.trim() || null,
      ...(input.payment_terms_days!==undefined?{payment_terms_days:input.payment_terms_days}:{}),
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
