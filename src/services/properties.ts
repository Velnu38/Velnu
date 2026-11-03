import {collectBusinessRecords} from '../lib/businessRecords'
import { supabase } from '../lib/supabase'
import { asList } from './relations'

export interface PropertyInput {
  customer_id: string
  label?: string
  address_line1: string
  address_line2?: string
  city?: string
  state?: string
  postal_code?: string
  access_notes?: string
}

export async function listCustomerProperties(businessId: string, customerId: string) {
  const { data, error } = await supabase
    .from('properties')
    .select('id,label,address_line1,address_line2,city,state,postal_code,access_notes,created_at')
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data
}

export async function createProperty(businessId: string, input: PropertyInput, retryId?:string) {
  if (!input.customer_id) throw new Error('Customer is required')
  if (!input.address_line1.trim()) throw new Error('Street address is required')

  const payload={
      ...(retryId?{id:retryId}:{}),
      business_id: businessId,
      customer_id: input.customer_id,
      label: input.label?.trim() || null,
      address_line1: input.address_line1.trim(),
      address_line2: input.address_line2?.trim() || null,
      city: input.city?.trim() || null,
      state: input.state?.trim() || null,
      postal_code: input.postal_code?.trim() || null,
      access_notes: input.access_notes?.trim() || null,
    }
  const {data,error}=await supabase.from('properties').insert(payload).select().single()
  if(error?.code==='23505'&&retryId){const saved=await supabase.from('properties').select('*').eq('business_id',businessId).eq('id',retryId).maybeSingle();if(saved.error)throw saved.error;if(saved.data&&Object.entries(payload).every(([key,value])=>saved.data[key]===value))return saved.data;throw new Error('This location was already saved with different details. Reload before trying again.')}
  if (error) throw error
  return data
}


/** Every service address the signed-in member is allowed to see for this business. */
export async function listBusinessProperties(businessId: string) {
  const data=await collectBusinessRecords((from,to)=>supabase.from('properties')
    .select('id,customer_id,label,address_line1,address_line2,city,state,postal_code,customers!properties_customer_id_fkey(id,first_name,last_name,company)',{count:'exact'})
    .eq('business_id',businessId).order('id').range(from,to))
  return (data ?? []).map((row: any) => ({ ...row, customers: asList(row.customers) }))
}
