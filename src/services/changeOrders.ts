import { supabase } from '../lib/supabase'
import { asList } from './relations'

export interface ChangeOrderLineInput {
  description: string
  quantity: number
  unit_price: number
  tax_rate?: number
}

export interface ChangeOrderInput {
  customer_id: string
  job_id: string
  estimate_id?: string
  title: string
  description?: string
  reason?: string
  schedule_impact_days?: number
  schedule_note?: string
  notes?: string
  customer_message?: string
  items: ChangeOrderLineInput[]
}

export async function listChangeOrders(businessId: string) {
  const { data, error } = await supabase
    .from('change_orders')
    .select('id,change_order_number,status,title,description,reason,schedule_impact_days,schedule_note,issue_date,subtotal,tax_amount,total,sent_at,approved_at,declined_at,customer_id,job_id,customers!change_orders_customer_id_fkey(id,first_name,last_name,company),jobs!change_orders_job_id_fkey(id,title,status)')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map((row: any) => ({ ...row, customers: asList(row.customers), jobs: asList(row.jobs) }))
}

export async function createChangeOrder(businessId: string, input: ChangeOrderInput & { request_id?: string }) {
  if (!input.customer_id || !input.job_id) throw new Error('Choose an existing job and customer')
  if (!input.title?.trim()) throw new Error('Change order title is required')
  if (!input.items.length || input.items.length > 50) throw new Error('Enter 1 to 50 line items')
  if (!Number.isInteger(input.schedule_impact_days ?? 0) || Math.abs(input.schedule_impact_days ?? 0) > 3650) throw new Error('Enter a valid schedule impact in whole days')
  for (const item of input.items) {
    if (!item.description?.trim()) throw new Error('Every line item needs a description')
    if (!Number.isFinite(item.quantity) || item.quantity <= 0 || Math.abs(item.quantity * 100 - Math.round(item.quantity * 100)) > 1e-7) throw new Error('Enter a valid quantity')
    if (!Number.isFinite(item.unit_price) || item.unit_price < 0 || Math.abs(item.unit_price * 100 - Math.round(item.unit_price * 100)) > 1e-7) throw new Error('Enter a valid price')
    const tax = item.tax_rate ?? 0
    if (!Number.isFinite(tax) || tax < 0 || tax > 100 || Math.abs(tax * 100 - Math.round(tax * 100)) > 1e-7) throw new Error('Enter a tax rate between 0 and 100 percent')
  }
  const { data, error } = await supabase.rpc('create_change_order_document', {
    target_business_id: businessId,
    request_id: input.request_id ?? crypto.randomUUID(),
    payload: {
      customer_id: input.customer_id, job_id: input.job_id, estimate_id: input.estimate_id || null,
      title: input.title.trim(), description: input.description?.trim() || null, reason: input.reason?.trim() || null,
      schedule_impact_days: input.schedule_impact_days ?? 0, schedule_note: input.schedule_note?.trim() || null,
      notes: input.notes?.trim() || null, customer_message: input.customer_message?.trim() || null,
      items: input.items.map(item => ({
        description: item.description.trim(), quantity: item.quantity, unit_price: item.unit_price, tax_rate: item.tax_rate ?? 0,
      })),
    },
  })
  if (error) throw error
  return data as { id: string; change_order_number: string | null; status: string; total: number }
}

export async function updateChangeOrderStatus(changeOrderId: string, status: 'draft' | 'sent' | 'approved' | 'declined' | 'void') {
  const { data, error } = await supabase
    .from('change_orders')
    .update({ status })
    .eq('id', changeOrderId)
    .select('id,status,sent_at,approved_at,declined_at')
    .single()
  if (error) throw error
  return data
}
