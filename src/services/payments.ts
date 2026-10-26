import { supabase } from '../lib/supabase'
import { asList } from './relations'

export async function listPayments(businessId: string) {
  const { data, error } = await supabase
    .from('payments')
    .select('id,amount,method,status,paid_at,notes,invoice_id,invoices!payments_invoice_id_fkey(invoice_number,total,balance_due,customers!invoices_customer_id_fkey(id,first_name,last_name,company))')
    .eq('business_id', businessId)
    .order('paid_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map((row: any) => ({ ...row, invoices: asList(row.invoices).map((invoice: any) => ({ ...invoice, customers: asList(invoice.customers) })) }))
}

export async function listOpenInvoices(businessId: string) {
  const { data, error } = await supabase
    .from('invoices')
    .select('id,invoice_number,total,amount_paid,balance_due,customers!invoices_customer_id_fkey(id,first_name,last_name,company)')
    .eq('business_id', businessId)
    .gt('balance_due', 0)
    .neq('status', 'void')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map((row: any) => ({ ...row, customers: asList(row.customers) }))
}

export async function recordPayment(
  businessId: string,
  input: { invoice_id: string; amount: number; method: 'cash' | 'check' | 'card' | 'ach' | 'other'; notes?: string },
) {
  if (!input.invoice_id) throw new Error('Choose an invoice')
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Enter a valid payment amount')

  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select('balance_due')
    .eq('id', input.invoice_id)
    .eq('business_id', businessId)
    .single()

  if (invoiceError) throw invoiceError
  if (input.amount > Number(invoice.balance_due)) throw new Error('Payment cannot exceed the invoice balance')

  const { data, error } = await supabase
    .from('payments')
    .insert({
      business_id: businessId,
      invoice_id: input.invoice_id,
      amount: input.amount,
      method: input.method,
      status: 'succeeded',
      notes: input.notes?.trim() || null,
    })
    .select('id,amount,method,status,paid_at')
    .single()

  if (error) throw error
  return data
}
