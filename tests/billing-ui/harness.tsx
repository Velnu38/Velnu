import React from 'react'
import {createRoot} from 'react-dom/client'
import {supabase} from '../../src/lib/supabase'
import InvoiceDetail from '../../src/components/InvoiceDetail'
import EstimateBilling from '../../src/components/EstimateBilling'
import '../../src/styles.css'
const id='11111111-1111-4111-8111-111111111111'
const business={id,name:'Billing Test',role:'owner',primary_owner:true,timezone:'America/New_York'} as any
const mode=new URLSearchParams(location.search).get('mode')
let invoice={id,invoice_number:'INV-100',status:'sent',issue_date:'2026-11-06',created_at:'2026-11-06T12:00:00Z',updated_at:'2026-11-06T12:00:00Z',subtotal:100,tax_amount:5,total:75,amount_paid:0,balance_due:75,deposit_credit:30,deposit_source_invoice_id:id,estimate_id:id,deposit_estimate_id:null,customer_id:id,customers:{first_name:'Test',last_name:'Customer'},payment_links:[]}
let payments:any[]=[]
;(window as any).calls=[]
;(supabase as any).from=(table:string)=>{let single=false;const chain:any=new Proxy({}, {get:(_,key)=>key==='then'?(resolve:any)=>resolve({data:table==='invoices'?(mode==='deposit'?[]:single?invoice:[invoice]):table==='invoice_items'?[{id,description:'Work',quantity:2,unit_price:50,tax_rate:5,line_total:100}]:table==='payments'?payments:[],error:null}):(...args:any[])=>{if(key==='single')single=true;return chain}});return chain}
;(supabase as any).rpc=async(name:string,input:any)=>{(window as any).calls.push({name,input});if(name==='record_manual_payment'){invoice={...invoice,amount_paid:invoice.amount_paid+input.payment_amount,balance_due:invoice.balance_due-input.payment_amount,status:invoice.balance_due===input.payment_amount?'paid':'partial'};payments.push({id:input.request_id,amount:input.payment_amount,method:input.payment_method,status:'succeeded',paid_at:new Date().toISOString()});return {data:{id:input.request_id},error:null}}return {data:id,error:null}}
createRoot(document.getElementById('root')!).render(mode==='deposit'?<EstimateBilling businessId={id} estimateId={id} total={105} approved canManage timezone="America/New_York"/>:<InvoiceDetail business={business} invoiceId={id} onBack={()=>{}}/>)
