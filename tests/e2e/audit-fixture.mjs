import {customerSearchResponse} from './job-customer-fixture.mjs'
import {mockJobDirectory} from './job-directory-fixture.mjs'
import { fulfillPdf } from './document-pdf-fixture.mjs'
import { createWork } from './navigation.mjs'
import {attentionPage} from './attention-fixture.mjs'
import {test,expect} from '@playwright/test'
import {DateTime} from 'luxon'

// Browser fixtures only: all authentication, database and delivery calls are intercepted.
const B='11111111-1111-4111-8111-111111111111',U='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',E='44444444-4444-4444-8444-444444444444',P='55555555-5555-4555-8555-555555555555',J='66666666-6666-4666-8666-666666666666'
const zone='America/New_York',user={id:U,email:'owner@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}
const business={id:B,name:'Scheduling QA',created_by_user_id:U,timezone:zone,profile_completed_at:'2026-10-01T00:00:00Z',document_accent:'#2563eb'}
const customer={id:C,first_name:'Test',last_name:'Customer',company:null,email:'customer@example.test'}
const team=[{id:U,label:'Owner',role:'owner',is_you:true},{id:J,label:'Field worker',role:'technician',is_you:false}]
const slots=Array.from({length:3},(_,n)=>({id:`77777777-7777-4777-8777-${String(n+1).padStart(12,'0')}`,starts_at:DateTime.now().setZone(zone).plus({days:14+n}).set({hour:9,minute:0,second:0,millisecond:0}).toISO(),ends_at:DateTime.now().setZone(zone).plus({days:14+n}).set({hour:11,minute:0,second:0,millisecond:0}).toISO()}))
async function mock(page,{signedIn=true,conflict=false,completedWork=false,ai=false,owner=true,defaultTax=0}={}){
 const state={calls:[],booked:false,approved:false,customers:[customer],completed:false,documents:[],documentUpdates:[],savedDocuments:{},entries:[],changes:[],imported:[]}
 function savedDocument(kind,payload,updated='2026-11-04T10:00:00Z'){
  const items=payload.items.map((item,index)=>({...item,id:`line-${index}`,sort_order:index,line_total:Math.round(item.quantity*item.unit_price*100)/100}))
  const subtotal=items.reduce((sum,item)=>sum+item.line_total,0)
  const tax_amount=items.reduce((sum,item)=>sum+Math.round(item.line_total*item.tax_rate)/100,0)
  return {...payload,id:E,[kind+'_number']:kind==='invoice'?'INV-QA':'EST-QA',status:'draft',updated_at:updated,created_at:updated,items,subtotal,tax_amount,total:subtotal+tax_amount,amount_paid:0,balance_due:subtotal+tax_amount,customers:state.customers.find(person=>person.id===payload.customer_id)||customer,payment_links:[],payment_instructions:''}
 }
 if(signedIn){const head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),body=Buffer.from(JSON.stringify({sub:U,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');await page.addInitScript(session=>localStorage.setItem('sb-example-auth-token',JSON.stringify(session)),{access_token:`${head}.${body}.test`,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user})}
 await page.route('https://example.supabase.co/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();let body;try{body=req.postDataJSON()}catch{}
  state.calls.push({path,method,body})
  const reply=(value,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-expose-headers':'content-range','content-range':Array.isArray(value)?`0-${Math.max(0,value.length-1)}/${value.length}`:'0-0/0'},body:JSON.stringify(value)})
  if(method==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,DELETE'},body:''})
  if(path.endsWith('/functions/v1/document-pdf'))return fulfillPdf(route)
  if(path.endsWith('/rpc/business_onboarding_status'))return reply({required:false,completed:true})
  if(path.endsWith('/auth/v1/user'))return reply(user)
  if(path.endsWith('/rpc/get_private_beta_access'))return reply({allowed:true})
  if(path.endsWith('/rpc/get_financial_overview'))return reply({currency_supported:true,as_of:DateTime.now().toISODate(),receivables:{invoices:0,outstanding:0,overdue:0,overdue_count:0},aging:[],customers:[],oldest:[]})
  if(path.endsWith('/rpc/get_membership_entry'))return reply(B)
  if(path.endsWith('/user_plan_preferences'))return reply({selected_tier:'pro'})
  if(path.endsWith('/user_agreement_acceptances'))return reply({id:E,agreement_version:'2026-10-26-v2'})
  if(path.endsWith('/business_members'))return reply({business_id:B,role:owner?'owner':'office',access_modules:['calendar','jobs','billing','finances'],businesses:business})
  if(path.endsWith('/business_settings'))return reply({default_tax_rate:defaultTax,pricing_adjustment_percent:0,payment_links:[],payment_instructions:''})
  if(path.endsWith('/rpc/get_document_change_context'))return reply({business_id:B,document_id:body.p_document,kind:body.p_kind,number:body.p_kind==='invoice'?'INV-QA':'EST-QA',customer_id:C,customer_name:'Test Customer',job_id:null,estimate_id:body.p_kind==='estimate'?E:null,work_status:completedWork?'completed':'unscheduled',can_change:!completedWork,total:105,address:'1 Test Street',items:[{description:'Original work',quantity:2,unit_price:50,tax_rate:5}]})
  if(path.endsWith('/rpc/create_document_change_order')){state.changes.push(body);return reply({id:P,status:'draft',total:20})}
  if(path.endsWith('/rpc/create_document')){
   state.documents.push(body)
   const record=savedDocument(body.document_kind,body.payload)
   state.savedDocuments[body.document_kind]=record
   return reply(record)
  }
  if(path.endsWith('/rpc/update_draft_document')){
   const existing=state.savedDocuments[body.document_kind]
   if(!existing||body.document_id!==existing.id||body.expected_updated_at!==existing.updated_at)return reply({message:'Draft version mismatch'},409)
   state.documentUpdates.push(body)
   const record=savedDocument(body.document_kind,{...existing,...body.payload},new Date(Date.parse(existing.updated_at)+1000).toISOString())
   state.savedDocuments[body.document_kind]=record
   return reply(record)
  }
  for(const kind of ['invoice','estimate']){
   const saved=state.savedDocuments[kind]
   if(saved&&path.endsWith('/'+kind+'s'))return reply(url.searchParams.has('id')?saved:[saved])
   if(saved&&path.endsWith('/'+kind+'_items'))return reply(saved.items)
  }
  if(path.endsWith('/rpc/import_customer_contacts')){state.imported.push(...body.p_contacts);return reply({imported:body.p_contacts.length,skipped:0,already_imported:0})}
  if(path.endsWith('/appointments')){if(method==='POST'){const entry={...body,updated_at:new Date().toISOString()};state.entries.push(entry);return reply(entry,201)}return reply([])}
  if(path.endsWith('/calendar_work'))return reply(state.entries.map(e=>({source_key:'appointment:'+e.id,title:e.title,starts_at:e.starts_at,ends_at:e.ends_at,status:'scheduled',document_kind:'work',document_id:e.id,job_id:null,assigned_user_ids:[U]})))
  if(path.endsWith('/functions/v1/transcribe-voice'))return reply({configured:false})
  if(path.endsWith('/rpc/get_delivery_automation'))return reply({plan:ai?'pro':'free',ready:true,rule:{enabled:false,after_days:3,repeat_days:7,max_reminders:3},tasks:[]})
  if(path.endsWith('/rpc/get_delivery_setup'))return reply({plan:'pro',email:'owner@example.test',phone:'+17575550100',personal_email_ready:false,personal_sms_ready:false,managed_email_ready:true,managed_sms_ready:false,acknowledged:true,reply_to:'owner@example.test',sms_reply_route:null})
  if(path.endsWith('/rpc/get_job_management')||path.endsWith('/rpc/get_job_workspace'))return reply({tasks:[],materials:[],templates:[],visits:[],activity:[],financial_access:true,billing_access:true,calendar_access:true,time:[],documents:[],changes:[],recorded_expenses:0,budget:null,pending_time_minutes:0,uncalculated_expenses:0})
  if(path.endsWith('/rpc/get_plan_usage'))return reply({plan:ai?'pro':'free',ai_limit:ai?100:0,ai_used:0,voice_limit:ai?100:0})
  if(path.endsWith('/rpc/get_schedule_team'))return reply(team)
  if(path.endsWith('/rpc/get_dashboard_attention_page'))return reply(attentionPage(body,{workflow:{approved:state.booked?[]:[{id:E,estimate_number:'EST-QA',customer_name:'Test Customer',offer:state.approved?{status:'approved',expires_at:'2099-01-01'}:null}],completed:[]}}))
  if(path.endsWith('/rpc/get_dashboard_invoice_totals'))return reply({open_invoices:0,outstanding_balance:0})
  if(path.endsWith('/rpc/get_scheduling_context'))return reply({preferences:{work_days:[1,2,3,4,5],start_minutes:480,end_minutes:1020,duration_minutes:120,buffer_minutes:30,notice_hours:24},team,time_off:[],properties:[{id:P,label:'Job site',address:'1 Test Street'}],estimate:body.p_estimate?{id:E,number:'EST-QA',customer_id:C,job_id:null,property_id:P,title:'Mow and trim',scope:'Mow and trim × 2',customer_name:'Test Customer',customer_email:'customer@example.test'}:undefined,offer:null})
  if(path.endsWith('/rpc/suggest_scheduling_slots'))return reply(slots.map(({starts_at,ends_at})=>({starts_at,ends_at})))
  if(path.endsWith('/rpc/book_approved_estimate')){state.booked=true;return reply({job_id:J,already_booked:false})}
  if(path.endsWith('/rpc/approve_scheduling_offer')){state.approved=true;return reply({id:body.p_request,status:'approved',expires_at:DateTime.now().plus({days:7}).toISO()})}
  if(path.endsWith('/functions/v1/work-scheduling')){if(body.action==='complete'){state.completed=true;return reply({job_id:J,status:'completed',invoice_ready:true,invoice_id:E})}return reply({status:'accepted'})}
  if(path.endsWith('/rpc/save_scheduling_preferences'))return reply(null)
  if(path.endsWith('/rpc/customer_schedule_offer')){
   if(body.p_slot){if(conflict)return reply({code:'23P01',message:'That time was just booked. Please choose another option.'},409);state.booked=true}
   return reply({business_name:'Scheduling QA',business_phone:'555-0100',title:'Mow and trim',timezone:zone,note:'Please choose a time.',address:'1 Test Street',status:state.booked?'booked':'approved',expires_at:DateTime.now().plus({days:7}).toISO(),slots:state.booked?[]:slots,confirmed:state.booked?slots[0]:null})
  }
  if(path.endsWith('/invoices')){const invoice={id:E,invoice_number:'INV-QA',customer_id:C,job_id:null,estimate_id:null,status:'sent',issue_date:'2026-10-01',total:105,subtotal:100,tax_amount:5,amount_paid:0,balance_due:105,customers:customer,payment_links:[],payment_instructions:''};return reply(url.searchParams.get('id')?invoice:[invoice])}
  if(path.endsWith('/invoice_items'))return reply([{id:P,description:'Original work',quantity:2,unit_price:50,tax_rate:5,line_total:100}])
  if(path.endsWith('/change_orders'))return reply(state.changes.map(c=>({id:P,customer_id:C,job_id:null,estimate_id:c.p_kind==='estimate'?E:null,source_invoice_id:c.p_kind==='invoice'?E:null,title:c.p_input.title,status:'draft',total:20,customers:[customer],jobs:[]})))
  if (path.endsWith('/rpc/search_job_customers')) return reply(customerSearchResponse(state.customers,body))
  if(path.endsWith('/customers')){if(method==='POST'){state.customers.push(body);return reply(body,201)}return reply(state.customers)}
  if(path.endsWith('/estimates'))return reply([{id:E,estimate_number:'EST-QA',customer_id:C,status:'accepted',issue_date:'2026-10-01',total:105,subtotal:100,tax_amount:5,customers:customer}])
  if(path.endsWith('/estimate_items'))return reply([{id:P,description:'Mow and trim',quantity:2,unit_price:50,tax_rate:5,line_total:100}])
  if(path.endsWith('/jobs'))return reply([])
  return reply([])
 })
 await mockJobDirectory(page,()=>[])
 return state
}


export {mock,B,U,C,E,P,J,customer,business}
