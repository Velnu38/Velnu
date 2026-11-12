import { supabase } from '../lib/supabase'
import { getDocumentChangeContext } from './changeOrders'

export type InvoicePaymentOperations = {
  state: 'clear' | 'pending' | 'review_required' | 'unavailable'
  message?: string
  refunds: Array<{ id:string;amount:number;refunded_at:string;currency:string }>
}
export type InvoiceWork = {
  job: {id:string;title:string;status:string;scheduled_start:string|null;scheduled_end:string|null;completed_at:string|null}|null
  appointment: {id:string;starts_at:string;ends_at:string|null;status:string}|null
  available: boolean
}
export async function getInvoiceDetail(businessId: string, invoiceId: string, options: {work?:boolean;calendar?:boolean;paymentOperations?:boolean} = {}) {
  const [invoice, items, payments, messages] = await Promise.all([
    supabase
      .from('invoices')
      .select('created_at,updated_at,id,invoice_number,status,issue_date,due_date,subtotal,tax_amount,total,amount_paid,balance_due,notes,customer_message,customer_reference,sent_at,paid_at,payment_links,payment_instructions,issuer_snapshot,customer_id,job_id,estimate_id,deposit_estimate_id,deposit_source_invoice_id,deposit_credit,properties!invoices_service_property_fkey(address_line1,address_line2,city,state,postal_code),customers!invoices_customer_id_fkey(id,first_name,last_name,company,email,phone)')
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
      .select('id,amount,method,status,paid_at,notes,provider')
      .eq('business_id', businessId)
      .eq('invoice_id', invoiceId)
      .order('paid_at', { ascending: false }),
    supabase
      .from('messages')
      .select('id,direction,channel,recipient,subject,body,provider,status,sent_at,created_at')
      .eq('business_id', businessId)
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  if (invoice.error) throw invoice.error
  if (items.error) throw items.error
  if (payments.error) throw payments.error
  // A missing activity read must not hide the invoice or imply an empty history.

  const operations: Promise<InvoicePaymentOperations> = options.paymentOperations ? Promise.resolve(supabase.rpc('get_invoice_payment_operations', {
    p_business:businessId,p_invoice:invoiceId,
  })).then(result => {
    if(result.error || !result.data || !['clear','pending','review_required'].includes(result.data.state) || !Array.isArray(result.data.refunds)) throw Error('Payment status unavailable')
    return result.data as InvoicePaymentOperations
  }).catch(() => ({state:'unavailable',message:'Payment processing and refund status could not be verified. Refresh before recording another payment.',refunds:[]})) : Promise.resolve({state:'unavailable',refunds:[]})
  const linkedWork: Promise<InvoiceWork> = options.work && invoice.data.job_id ? (async()=>{
    const [job,appointment] = await Promise.all([
      supabase.from('jobs').select('id,title,status,scheduled_start,scheduled_end,completed_at').eq('business_id',businessId).eq('id',invoice.data.job_id).maybeSingle(),
      options.calendar ? supabase.from('appointments').select('id,starts_at,ends_at,status').eq('business_id',businessId).eq('job_id',invoice.data.job_id)
        .in('status',['scheduled','confirmed','in_progress']).order('starts_at',{ascending:false}).limit(1).maybeSingle() : Promise.resolve({data:null,error:null}),
    ])
    if(job.error || appointment.error || !job.data) return {job:null,appointment:null,available:false}
    return {job:job.data,appointment:appointment.data,available:true}
  })().catch(()=>({job:null,appointment:null,available:false})) : Promise.resolve({job:null,appointment:null,available:true})
  const changes = options.paymentOperations && !invoice.data.deposit_estimate_id ? getDocumentChangeContext('invoice',invoiceId)
    .then(context=>({canChange:context.can_change===true,workStatus:context.work_status})).catch(()=>({canChange:false,workStatus:''})) : Promise.resolve({canChange:false,workStatus:''})
  const [paymentOperations,work,changeOrderContext] = await Promise.all([operations,linkedWork,changes])

  return {
    invoice: invoice.data,
    items: items.data ?? [],
    payments: payments.data ?? [],
    messages: messages.error ? [] : messages.data ?? [],
    messagesUnavailable: !!messages.error,
    paymentOperations,
    work,
    changeOrderContext,
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
