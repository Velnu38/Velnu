import { compareCustomers } from '../lib/customerRecords'
import type { ServiceAddressDraft } from '../components/ServiceAddressFields'
import { collectBusinessRecords } from '../lib/businessRecords'
import { supabase } from '../lib/supabase'

export interface CustomerInput {
  first_name?: string
  last_name?: string
  company?: string
  email?: string
  phone?: string
  preferred_contact?: 'sms' | 'email' | 'phone' | 'none'
  notes?: string
}

export async function listCustomers(businessId: string) {
  const data = await collectBusinessRecords((from, to) => supabase
    .from('customers')
    .select('*', { count: 'exact' })
    .eq('business_id', businessId)
    .eq('archived', false)
    .order('id').range(from, to))
  data.sort(compareCustomers)
  return data
}

export async function createCustomer(businessId: string, input: CustomerInput, retryId?: string) {
  if (!input.first_name?.trim() && !input.last_name?.trim() && !input.company?.trim()) {
    throw new Error('Enter a customer name or company')
  }

  const payload = {
    ...(retryId ? { id: retryId } : {}),
    business_id: businessId,
    first_name: input.first_name?.trim() || null,
    last_name: input.last_name?.trim() || null,
    company: input.company?.trim() || null,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    preferred_contact: input.preferred_contact || null,
    notes: input.notes?.trim() || null,
  }

  const { data, error } = await supabase.from('customers').insert(payload).select().single()
  if (error?.code==='23505'&&retryId) {
    const previous=await supabase.from('customers').select('*').eq('business_id',businessId).eq('id',retryId).maybeSingle()
    if(previous.error)throw previous.error
    if(previous.data&&Object.entries(payload).every(([key,value])=>previous.data[key]===value))return previous.data
    throw new Error('This customer retry contains different information. Refresh before trying again.')
  }
  if (error) throw error
  return data
}

export async function updateCustomer(customerId: string, input: CustomerInput, businessId: string, version?:string) {
  if(!input.first_name?.trim()&&!input.last_name?.trim()&&!input.company?.trim())throw new Error('Enter a customer name or company.')
  if(input.email?.trim()&&!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(input.email.trim()))throw new Error('Enter a valid email address.')
  const { data, error } = await supabase
    .from('customers')
    .update({
      first_name: input.first_name?.trim() || null,
      last_name: input.last_name?.trim() || null,
      company: input.company?.trim() || null,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      preferred_contact: input.preferred_contact || null,
      notes: input.notes?.trim() || null,
    })
    .eq('id', customerId).eq('business_id',businessId)
    .eq('updated_at',version || '')
    .select()
    .single()

  if (error?.code==='PGRST116') throw new Error('This customer changed elsewhere. Close and reopen the editor before saving.')
  if (error) throw error
  return data
}

export async function archiveCustomer(customerId: string, businessId: string, version: string) {
  const { data, error } = await supabase.from('customers').update({ archived: true })
    .eq('id', customerId).eq('business_id', businessId).eq('updated_at', version).select('id').single()
  if (error?.code === 'PGRST116') throw new Error('This contact changed elsewhere. Close and reopen the editor before deleting.')
  if (error) throw error
  return data
}

/** Edit contact details only, preserving notes, preferences and names. */
export async function updateCustomerContact(businessId:string,customerId:string,version:string,email:string,phone:string){
 if(email&&!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email))throw new Error('Enter a valid customer email.')
 const {data,error}=await supabase.from('customers').update({email:email||null,phone:phone||null}).eq('business_id',businessId).eq('id',customerId).eq('updated_at',version).select().single()
 if(error?.code==='PGRST116')throw new Error('Customer details changed elsewhere. Go back and reopen review to load the current details before sending.')
 if(error)throw error
 return data
}

/** The first address is saved in the same transaction as its new customer. */
export async function createCustomerWithAddress(businessId: string, input: CustomerInput, address: ServiceAddressDraft, requestId: string) {
  if (!Object.values(address).some(value => value.trim())) return createCustomer(businessId, input, requestId)
  if (!address.address_line1.trim()) throw new Error('Enter a street address or leave all address fields blank.')
  const { data, error } = await supabase.rpc('create_customer_with_address', {
    target_business_id: businessId, request_id: requestId, payload: { ...input, address },
  })
  if (error) throw error
  return data as { id: string }
}

export async function searchJobCustomers(businessId:string,query:string,selected='') {
 const {data,error}=await supabase.rpc('search_job_customers',{p_business:businessId,p_query:query,p_selected:selected||null})
 if(error)throw error
 const valid=(c:any)=>c&&typeof c.id==='string'&&['first_name','last_name','company','email','phone'].every(k=>c[k]===null||typeof c[k]==='string')
 if(!data||!Array.isArray(data.items)||data.items.length>8||data.items.some((c:any)=>!valid(c))||new Set(data.items.map((c:any)=>c.id)).size!==data.items.length||(data.selected!==null&&(!valid(data.selected)||data.selected.id!==selected)))throw Error('Customer suggestions could not load. Retry your search.')
 return data as {items:import('../lib/customerSuggestions').CustomerOption[];selected:import('../lib/customerSuggestions').CustomerOption|null}
}
