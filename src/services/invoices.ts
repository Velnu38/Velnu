import {announceCalendarChange} from '../lib/workEvents'
import type { DocumentPayments } from '../components/PaymentOptionsFields'
import type { newCustomerFields } from '../components/CustomerEntry'
import { collectBusinessRecords } from '../lib/businessRecords'
import { validateDocumentInput } from '../lib/financialValidation'
import { supabase } from '../lib/supabase'
import { asList } from './relations'

export interface InvoiceLineInput {
  description: string
  quantity: number
  unit_price: number
  tax_rate?: number
}

export async function listInvoices(businessId: string, customerId?: string) {
  const data = await collectBusinessRecords((from, to) => {
    let query = supabase
    .from('invoices')
    .select('created_at,updated_at,id,invoice_number,status,issue_date,due_date,subtotal,tax_amount,total,amount_paid,balance_due,customer_id,customers!invoices_customer_id_fkey(id,first_name,last_name,company)', { count: 'exact' })
    .eq('business_id', businessId)
    .order('id').range(from, to)
    if (customerId) query = query.eq('customer_id', customerId)
    return query
  })
  data.sort((a, b) => String(b.issue_date).localeCompare(String(a.issue_date)) || b.id.localeCompare(a.id))
  return (data ?? []).map((row: any) => ({ ...row, customers: asList(row.customers) }))
}

export async function createInvoice(
  businessId: string,
  input: Partial<DocumentPayments> & { new_customer?:ReturnType<typeof newCustomerFields>; customer_id: string; property_id?: string; issue_date?: string; due_date?: string; notes?: string; customer_reference?: string; customer_message?: string; request_id?: string; items: InvoiceLineInput[] },
) {
  validateDocumentInput(input)

  // This database function inserts the document and all line items atomically.
  // An identical request_id can be retried safely after a lost network response.
  const { data, error } = await supabase.rpc('create_document', {
    target_business_id: businessId,
    document_kind: 'invoice',
    request_id: input.request_id ?? crypto.randomUUID(),
    payload: {
      customer_id: input.customer_id,
      ...(input.new_customer?{new_customer:input.new_customer}:{}),
      ...(input.payment_links?{payment_links:input.payment_links}:{}),
      ...(input.payment_instructions!==undefined?{payment_instructions:input.payment_instructions}:{}),
      ...(input.property_id ? { property_id: input.property_id } : {}),
      ...(input.issue_date ? { issue_date: input.issue_date } : {}),
      due_date: input.due_date || null,
      notes: input.notes?.trim() || null,
      customer_reference: input.customer_reference?.trim() || null,
      customer_message: input.customer_message?.trim() || null,
      items: input.items.map(item => ({
        description: item.description.trim(), quantity: item.quantity,
        unit_price: item.unit_price, tax_rate: item.tax_rate ?? 0,
      })),
    },
  })
  if (error) throw error
  return data as { id: string; invoice_number: string | null; status: string; subtotal: number; tax_amount: number; total: number; amount_paid: number; balance_due: number; due_date: string | null }
}

export async function updateInvoiceStatus(invoiceId: string, status: 'draft' | 'sent' | 'viewed' | 'partial' | 'paid' | 'overdue' | 'void') {
  const updates: Record<string, unknown> = { status }
  if (status === 'sent') updates.sent_at = new Date().toISOString()
  const { error } = await supabase.from('invoices').update(updates).eq('id', invoiceId)
  if (error) throw error
  announceCalendarChange()
}
