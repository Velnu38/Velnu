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
    .not('status', 'in', '(draft,void)')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map((row: any) => ({ ...row, customers: asList(row.customers) }))
}

export async function recordPayment(
  businessId: string,
  input: { invoice_id: string; amount: number; method: 'cash' | 'check' | 'card' | 'ach' | 'other'; notes?: string; request_id?: string },
) {
  if (!input.invoice_id) throw new Error('Choose an issued invoice')
  const cents = input.amount * 100
  if (!Number.isFinite(input.amount) || input.amount <= 0 || Math.abs(cents - Math.round(cents)) >= 1e-7) {
    throw new Error('Enter a positive payment amount with no more than two decimal places')
  }
  // Locks the invoice, rejects draft/void payments and concurrent overpayments,
  // and prevents duplicate records when the same request is retried.
  const { data, error } = await supabase.rpc('record_manual_payment', {
    target_business_id: businessId,
    invoice_id: input.invoice_id,
    request_id: input.request_id ?? crypto.randomUUID(),
    payment_amount: input.amount,
    payment_method: input.method,
    payment_note: input.notes?.trim() || '',
  })
  if (error) throw error
  return data as { id: string; amount: number; method: string; status: string; paid_at: string }
}
