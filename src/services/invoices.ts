import { validateDocumentInput } from '../lib/financialValidation'
import { supabase } from '../lib/supabase'
import { asList } from './relations'

export interface InvoiceLineInput {
  description: string
  quantity: number
  unit_price: number
  tax_rate?: number
}

export async function listInvoices(businessId: string) {
  const { data, error } = await supabase
    .from('invoices')
    .select('id,invoice_number,status,issue_date,due_date,subtotal,tax_amount,total,amount_paid,balance_due,customer_id,customers!invoices_customer_id_fkey(id,first_name,last_name,company)')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map((row: any) => ({ ...row, customers: asList(row.customers) }))
}

export async function createInvoice(
  businessId: string,
  input: { customer_id: string; due_date?: string; notes?: string; customer_message?: string; request_id?: string; items: InvoiceLineInput[] },
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
      due_date: input.due_date || null,
      notes: input.notes?.trim() || null,
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
}
