import type { DocumentChangeOrderContext } from '../lib/documentChangeOrders'
import type { ChangeOrderAmounts } from '../lib/changeOrderAmounts'
import { validateDocumentInput } from '../lib/financialValidation'
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

export async function listChangeOrders(businessId: string, context?: DocumentChangeOrderContext) {
  let query = supabase
    .from('change_orders')
    .select('created_at,updated_at,id,change_order_number,status,title,description,reason,schedule_impact_days,schedule_note,source_invoice_id,estimate_id,issue_date,subtotal,tax_amount,total,change_totals,sent_at,approved_at,declined_at,customer_id,job_id,customers!change_orders_customer_id_fkey(id,first_name,last_name,company,email,phone),jobs!change_orders_job_id_fkey(id,title,status)')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
  if (context) {
    const scope = context.documentType === 'invoice'
      ? `source_invoice_id.eq.${context.documentId}`
      : `and(source_invoice_id.is.null,estimate_id.eq.${context.documentId})`
    const legacy = context.jobId
      ? `,and(source_invoice_id.is.null,estimate_id.is.null,job_id.eq.${context.jobId})` : ''
    query = query.eq('customer_id', context.customerId).or(scope + legacy)
  }
  const { data, error } = await query

  if (error) throw error
  return (data ?? []).map((row: any) => ({ ...row, customers: asList(row.customers), jobs: asList(row.jobs) }))
}

export async function createChangeOrder(businessId: string, input: ChangeOrderInput & { request_id?: string }) {
  validateDocumentInput(input)
  if (typeof input.job_id !== 'string' || !input.job_id.trim()) throw new Error('Choose an existing job and customer')
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 4000) throw new Error('Change order title is required and must be at most 4,000 characters')
  if (!Number.isInteger(input.schedule_impact_days ?? 0) || Math.abs(input.schedule_impact_days ?? 0) > 3650) throw new Error('Enter a valid schedule impact in whole days')
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

export type DocumentChangeSource={business_id:string;document_id:string;kind:'invoice'|'estimate';number:string;customer_id:string;customer_name:string;customer_email?:string|null;customer_phone?:string|null;job_id:string|null;estimate_id:string|null;work_status:string;can_change:boolean;total:number;current_total?:number;deposit_paid?:number;other_paid?:number;address:string|null;items:Array<{description:string;quantity:number;unit_price:number;tax_rate:number}>}
export async function getDocumentChangeContext(kind:'invoice'|'estimate',id:string):Promise<DocumentChangeSource>{
 const {data,error}=await supabase.rpc('get_document_change_context',{p_kind:kind,p_document:id});if(error)throw error;return data
}
export type ChangeSourceLine = {id:string;description:string;quantity:number;unit_price:number;tax_rate:number}
export type ChangeLineRevision = {id:string;previous:ChangeSourceLine;description:string;quantity:number;unit_price:number}

export async function getChangeOrderSourceLines(kind:'invoice'|'estimate',id:string):Promise<ChangeSourceLine[]> {
 const {data,error}=await supabase.rpc('get_change_order_source_lines',{p_kind:kind,p_document:id})
 if(error)throw error
 if(!Array.isArray(data))throw new Error('The original line items could not be loaded.')
 return data
}

export async function createDocumentChangeOrder(kind:'invoice'|'estimate',id:string,request:string,input:{title:string;description:string;reason:string;schedule_impact_days:number;schedule_note:string;expected_current_total?:number;items:ChangeOrderLineInput[]},revision?:ChangeLineRevision){
 if(!revision || input.items.length)validateDocumentInput({customer_id:id,items:input.items})
 const {data,error}=await supabase.rpc(revision?'create_linked_change_order':'create_document_change_order',{p_kind:kind,p_document:id,p_request:request,p_input:input,...(revision?{p_revision:revision}:{})});if(error)throw error;return data
}

export async function listChangeOrderItems(businessId:string,id:string){
 const {data,error}=await supabase.from('change_order_items').select('id,description,quantity,unit_price,tax_rate,line_total').eq('business_id',businessId).eq('change_order_id',id).order('sort_order',{ascending:true})
 if(error)throw error
 return data??[]
}

export type ChangeOrderBilling = {
 action:'awaiting_approval'|'billed'|'included_on_final'|'verify_existing'|'add_to_draft'|'create_invoice'|'manual_review'|'scope_only'
 invoice_id?:string
 number?:string|null
 total?:number
 change_total?:number
 status?:string
}

export async function getChangeOrderBilling(id:string):Promise<ChangeOrderBilling> {
 const {data,error}=await supabase.rpc('get_change_order_billing',{p_change:id})
 if(error)throw error
 return data
}

export async function billApprovedChangeOrder(id:string,action:'add_to_draft'|'create_invoice',total:number):Promise<ChangeOrderBilling> {
 const {data,error}=await supabase.rpc('bill_approved_change_order',{p_change:id,p_action:action,p_expected_total:total})
 if(error)throw error
 return data
}
