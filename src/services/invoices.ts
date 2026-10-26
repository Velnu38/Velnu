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
  input: { customer_id: string; due_date?: string; notes?: string; customer_message?: string; items: InvoiceLineInput[] },
) {
  if (!input.customer_id) throw new Error('Choose a customer')
  if (!input.items.length) throw new Error('Add at least one line item')

  for (const item of input.items) {
    if (!item.description.trim()) throw new Error('Every line item needs a description')
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error('Quantity must be greater than zero')
    if (!Number.isFinite(item.unit_price) || item.unit_price < 0) throw new Error('Unit price cannot be negative')
    if ((item.tax_rate ?? 0) < 0) throw new Error('Tax rate cannot be negative')
  }

  const { data: invoice, error } = await supabase
    .from('invoices')
    .insert({
      business_id: businessId,
      customer_id: input.customer_id,
      status: 'draft',
      due_date: input.due_date || null,
      notes: input.notes?.trim() || null,
      customer_message: input.customer_message?.trim() || null,
    })
    .select('id,invoice_number')
    .single()

  if (error) throw error

  const rows = input.items.map((item, index) => ({
    invoice_id: invoice.id,
    business_id: businessId,
    description: item.description.trim(),
    quantity: item.quantity,
    unit_price: item.unit_price,
    tax_rate: item.tax_rate ?? 0,
    sort_order: index,
  }))

  const { error: itemError } = await supabase.from('invoice_items').insert(rows)
  if (itemError) {
    await supabase.from('invoices').delete().eq('id', invoice.id)
    throw itemError
  }

  const { data: full, error: fullError } = await supabase
    .from('invoices')
    .select('id,invoice_number,status,subtotal,tax_amount,total,amount_paid,balance_due,due_date')
    .eq('id', invoice.id)
    .single()

  if (fullError) throw fullError
  return full
}

export async function updateInvoiceStatus(invoiceId: string, status: 'draft' | 'sent' | 'viewed' | 'partial' | 'paid' | 'overdue' | 'void') {
  const updates: Record<string, unknown> = { status }
  if (status === 'sent') updates.sent_at = new Date().toISOString()
  const { error } = await supabase.from('invoices').update(updates).eq('id', invoiceId)
  if (error) throw error
}
