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

export async function createChangeOrder(businessId: string, input: ChangeOrderInput) {
  if (!input.customer_id) throw new Error('Choose a customer')
  if (!input.job_id) throw new Error('Choose a job')
  if (!input.title.trim()) throw new Error('Change order title is required')
  if (!input.items.length) throw new Error('Add at least one line item')

  for (const item of input.items) {
    if (!item.description.trim()) throw new Error('Every line item needs a description')
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error('Quantity must be greater than zero')
    if (!Number.isFinite(item.unit_price) || item.unit_price < 0) throw new Error('Unit price cannot be negative')
    const taxRate = item.tax_rate ?? 0
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) throw new Error('Tax rate must be between 0 and 100')
  }

  const { data: changeOrder, error } = await supabase
    .from('change_orders')
    .insert({
      business_id: businessId,
      customer_id: input.customer_id,
      job_id: input.job_id,
      estimate_id: input.estimate_id || null,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      reason: input.reason?.trim() || null,
      schedule_impact_days: input.schedule_impact_days ?? 0,
      schedule_note: input.schedule_note?.trim() || null,
      notes: input.notes?.trim() || null,
      customer_message: input.customer_message?.trim() || null,
      status: 'draft',
    })
    .select('id,change_order_number')
    .single()

  if (error) throw error

  const rows = input.items.map((item, index) => ({
    change_order_id: changeOrder.id,
    business_id: businessId,
    description: item.description.trim(),
    quantity: item.quantity,
    unit_price: item.unit_price,
    tax_rate: item.tax_rate ?? 0,
    sort_order: index,
  }))

  const { error: itemError } = await supabase.from('change_order_items').insert(rows)
  if (itemError) {
    await supabase.from('change_orders').delete().eq('id', changeOrder.id)
    throw itemError
  }

  const { data: full, error: fullError } = await supabase
    .from('change_orders')
    .select('id,change_order_number,status,title,subtotal,tax_amount,total,schedule_impact_days')
    .eq('id', changeOrder.id)
    .single()

  if (fullError) throw fullError
  return full
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
