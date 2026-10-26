import { supabase } from '../lib/supabase'

export async function getInvoiceDetail(businessId: string, invoiceId: string) {
  const [invoice, items, payments, messages] = await Promise.all([
    supabase
      .from('invoices')
      .select('id,invoice_number,status,issue_date,due_date,subtotal,tax_amount,total,amount_paid,balance_due,notes,customer_message,sent_at,paid_at,customer_id,job_id,estimate_id,customers!invoices_customer_id_fkey(id,first_name,last_name,company,email,phone)')
      .eq('business_id', businessId)
      .eq('id', invoiceId)
      .single(),
    supabase
      .from('invoice_items')
      .select('id,description,quantity,unit_price,tax_rate,line_total,sort_order')
      .eq('business_id', businessId)
      .eq('invoice_id', invoiceId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('payments')
      .select('id,amount,method,status,paid_at,notes,provider,provider_payment_id')
      .eq('business_id', businessId)
      .eq('invoice_id', invoiceId)
      .order('paid_at', { ascending: false }),
    supabase
      .from('messages')
      .select('id,direction,channel,recipient,subject,body,status,sent_at,created_at')
      .eq('business_id', businessId)
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  if (invoice.error) throw invoice.error
  if (items.error) throw items.error
  if (payments.error) throw payments.error
  if (messages.error) throw messages.error

  return {
    invoice: invoice.data,
    items: items.data ?? [],
    payments: payments.data ?? [],
    messages: messages.data ?? [],
  }
}

export async function createInvoiceReminder(
  businessId: string,
  invoiceId: string,
  customerId: string,
  dueAt: string,
  note?: string,
) {
  const { data, error } = await supabase
    .from('reminders')
    .insert({
      business_id: businessId,
      invoice_id: invoiceId,
      customer_id: customerId,
      kind: 'invoice_follow_up',
      due_at: dueAt,
      status: 'pending',
      note: note?.trim() || null,
    })
    .select('id,due_at,status,note')
    .single()

  if (error) throw error
  return data
}
