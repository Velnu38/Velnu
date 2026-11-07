import {supabase} from '../lib/supabase'
import {collectBusinessRecords} from '../lib/businessRecords'
import {listCustomerProperties} from './properties'

export async function getCustomerDetail(businessId:string,customerId:string,access={billing:true,jobs:true}) {
 const read=(table:string,columns:string)=>collectBusinessRecords<any>((from,to)=>supabase.from(table).select(columns,{count:'exact'}).eq('business_id',businessId).eq('customer_id',customerId).order('id').range(from,to))
 const [customer,properties,jobs,estimates,invoices]=await Promise.all([
  supabase.from('customers').select('*').eq('business_id',businessId).eq('id',customerId).single(),
  listCustomerProperties(businessId,customerId),
  access.jobs?read('jobs','id,title,status,scheduled_start,completed_at,description,created_at'):[],
  access.billing?read('estimates','id,estimate_number,status,total,issue_date,expires_on,created_at,updated_at'):[],
  access.billing?read('invoices','id,invoice_number,status,total,amount_paid,balance_due,issue_date,due_date,created_at,updated_at,sent_at,paid_at'):[],
 ])
 if(customer.error)throw customer.error
 const newest=(rows:any[])=>rows.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))||b.id.localeCompare(a.id))
 return {customer:customer.data,properties,jobs:newest(jobs),estimates:newest(estimates),invoices:newest(invoices)}
}
