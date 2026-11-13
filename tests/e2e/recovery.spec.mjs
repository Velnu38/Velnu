import {customerSearchResponse} from './job-customer-fixture.mjs'
import {mockJobDirectory} from './job-directory-fixture.mjs'
import {workflow,start,save,review,step,cors} from './fin-workflow-fixture.mjs'
import { createWork } from './navigation.mjs'
import { test, expect } from '@playwright/test'
const B='11111111-1111-4111-8111-111111111111', U='33333333-3333-4333-8333-333333333333', C='44444444-4444-4444-8444-444444444444', A='55555555-5555-4555-8555-555555555555'
const user={id:U,email:'qa@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}
const customer={id:C,first_name:'Demo',last_name:'Customer',company:null,email:'customer@example.test',archived:false}
async function setup(page,options={}){
 const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:U,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test'
 await page.addInitScript(s=>localStorage.setItem('sb-example-auth-token',JSON.stringify(s)),{access_token:token,refresh_token:'refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user})
 const s={requests:[],errors:[],confirmations:0,executions:0,created:0,rejections:0,jobAttempts:0,jobs:options.jobs||[]}
 page.on('pageerror',e=>s.errors.push(e.message))
 await page.route('https://example.supabase.co/**',async route=>{
  const r=route.request(),path=new URL(r.url()).pathname,method=r.method(); let body=null; try{body=r.postDataJSON()}catch{}
  s.requests.push({path,method,body})
  const json=(value,status=200)=>route.fulfill({status,contentType:'application/json',headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': Array.isArray(value) ? `0-${Math.max(0,value.length-1)}/${value.length}` : '0-0/1' },body:JSON.stringify(value)})
  if(method==='OPTIONS')return route.fulfill({status:200,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:''})
  if(path.endsWith('/rpc/get_private_beta_access'))return json({allowed:true})
  if(path.endsWith('/rpc/business_onboarding_status'))return json({required:false,completed:true})
  if(path.endsWith('/rpc/get_job_workflow_context'))return json((body.p_jobs||[]).map(id=>({job_id:id,active_appointment:null,invoice:null})))
  if(path.endsWith('/user'))return json(user)
  if(path.endsWith('/user_plan_preferences'))return json({user_id:U,selected_tier:'pro'})
  if(path.endsWith('/user_agreement_acceptances'))return json({id:A,agreement_version:'2026-10-27-v3'})
  if(path.endsWith('/business_members'))return json({role:'owner',business_id:B,businesses:{id:B,created_by_user_id:U,name:'Recovery Test',profile_completed_at:'2026-01-01T00:00:00Z'}})
  if(path.endsWith('/rpc/get_job_management')||path.endsWith('/rpc/get_job_workspace'))return json({tasks:[],materials:[],templates:[],visits:[],activity:[],financial_access:true,billing_access:true,calendar_access:true,time:[],documents:[],changes:[],recorded_expenses:0,budget:null,pending_time_minutes:0,uncalculated_expenses:0})
  if(path.endsWith('/rpc/get_plan_usage'))return json({plan:'pro',ai_limit:50,voice_limit:50,logo_bytes_limit:131072})
  if(path.endsWith('/rpc/get_dashboard_invoice_totals'))return json({open_invoices:0,outstanding_balance:0})
  if (path.endsWith('/rpc/search_job_customers')) return json(customerSearchResponse([customer],body))
  if(path.endsWith('/customers'))return json([customer])
  if(path.endsWith('/jobs'))return json(new URL(r.url()).searchParams.has('id')?s.jobs.find(job=>job.id===new URL(r.url()).searchParams.get('id')?.replace('eq.','')):s.jobs)
  if(path.endsWith('/rpc/create_job_atomic')){
   s.jobAttempts++
   if(!s.jobs.length)s.jobs.push({id:A,title:body.payload.title,status:'lead',customers:customer,scheduled_start:null})
   if(options.jobLost&&s.jobAttempts===1)return json({message:'Job response lost after commit',code:'500'},500)
   return json(s.jobs[0])
  }
  if(path.endsWith('/functions/v1/work-scheduling'))return json({error:'Unable to update linked appointment'},409)
  if(path.endsWith('/rpc/set_job_status_atomic'))return json({message:'Unable to update linked appointment',code:'23514'},409)
  return json([])
 })
 await page.goto('/?view=dashboard')
 await mockJobDirectory(page,()=>s.jobs.map(job=>({...job,active_appointment:null,invoice:null})))
 return s
}
async function setupFin(page,options={}){
 const planned=options.payment?{...step('record_payment',{amount:'90.00',payment_method:'cash'}),label:'Cash payment of $90.00 for Demo Customer'}:{...step('create_customer',{first_name:'Demo',last_name:'Customer'}),label:'Demo Customer'}
 await workflow(page,{steps:[planned]})
 const s={executions:[],rejections:[],created:new Set(),errors:[]};page.on('pageerror',e=>s.errors.push(e.message))
 await page.route('**/rest/v1/rpc/fin_execute_review',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
  const body=route.request().postDataJSON();s.executions.push(body)
  if(options.confirmLost&&s.executions.length===1)return route.fulfill({status:503,headers:cors,json:{message:'Save could not be confirmed. Retry this review.'}})
  s.created.add(body.p_review)
  if(options.executeLost&&s.executions.length===1)return route.fulfill({status:503,headers:cors,json:{message:'Response lost after commit. Retry this review.'}})
  if(options.slow)await new Promise(r=>setTimeout(r,150))
  return route.fulfill({status:200,headers:cors,json:{status:'completed',steps:[{operation:planned.operation,resource:options.payment?'payments':'customers',id:C,label:planned.label,status:'completed'}]}})
 })
 await page.route('**/rest/v1/rpc/fin_cancel_review',route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
  s.rejections.push(route.request().postDataJSON())
  return route.fulfill({status:options.rejectLost&&s.rejections.length===1?503:200,headers:cors,json:options.rejectLost&&s.rejections.length===1?{message:'Temporary error'}:null})
 })
 await start(page,options.payment?'Record a cash payment of $90 for Demo Customer':'Create a customer named Demo Customer')
 await expect(review(page).getByRole('button',{name:'Yes, make these changes',exact:true})).toBeVisible()
 return s
}
test('failed save before mutation can be retried using the same review; one mutation',async({page})=>{
 const s=await setupFin(page,{confirmLost:true});await save(page)
 await expect(page.getByRole('alert')).toContainText('Save could not be confirmed');expect(s.created.size).toBe(0)
 await save(page);await expect(page.getByRole('region',{name:'Fin’s completed steps'})).toContainText('Demo Customer')
 expect(s.executions).toHaveLength(2);expect(s.executions[1]).toEqual(s.executions[0]);expect(s.created.size).toBe(1);expect(s.errors).toEqual([])
})
test('lost execution response retries the same review without creating a second record',async({page})=>{
 const s=await setupFin(page,{executeLost:true});await save(page)
 await expect(page.getByRole('alert')).toContainText('Response lost after commit');expect(s.created.size).toBe(1)
 await save(page);await expect(page.getByRole('region',{name:'Fin’s completed steps'})).toContainText('Demo Customer')
 expect(s.executions).toHaveLength(2);expect(s.executions[1]).toEqual(s.executions[0]);expect(s.created.size).toBe(1);expect(s.errors).toEqual([])
})
test('failed cancellation is visible and recoverable, never executes action',async({page})=>{
 const s=await setupFin(page,{rejectLost:true});await review(page).getByRole('button',{name:'No, cancel',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('Cancellation could not be confirmed')
 await review(page).getByRole('button',{name:'No, cancel',exact:true}).click();await expect(review(page)).toHaveCount(0)
 expect(s.executions).toHaveLength(0);expect(s.rejections).toHaveLength(2);expect(s.rejections[1]).toEqual(s.rejections[0]);expect(s.errors).toEqual([])
})
test('rapid confirmation attempts use an immediate in-flight guard',async({page})=>{
 const s=await setupFin(page,{slow:true})
 await review(page).getByRole('button',{name:'Yes, make these changes',exact:true}).evaluate(button=>{button.click();button.click()})
 await expect(page.getByRole('region',{name:'Fin’s completed steps'})).toContainText('Demo Customer')
 expect(s.executions).toHaveLength(1);expect(s.created.size).toBe(1)
})
test('recorded payment is described as a payment, not a newly created invoice',async({page})=>{
 await setupFin(page,{payment:true});await save(page)
 await expect(page.getByRole('region',{name:'Fin’s completed steps'})).toContainText('Cash payment of $90.00 for Demo Customer')
 await expect(page.getByRole('region',{name:'Send to customer'})).toHaveCount(0)
})
test('job creation preserves request identity after a lost response',async({page})=>{
 const s=await setup(page,{jobLost:true})
 await createWork(page,'job')
 await page.getByRole('combobox',{name:'Customer',exact:true}).click();await page.locator('[data-customer-id="'+C+'"]').click()
 await page.getByLabel('Job title',{exact:true}).fill('Recovery demonstration')
 await page.getByRole('button',{name:'Create job',exact:true}).click()
 await expect(page.getByRole('dialog',{name:'Create a job',exact:true}).getByRole('alert')).toBeVisible()
 await expect(page.getByLabel('Job title',{exact:true})).toHaveValue('Recovery demonstration')
 await page.getByRole('button',{name:'Create job',exact:true}).click()
 await expect(page.locator('.modal')).toHaveCount(0)
 const calls=s.requests.filter(r=>r.path.endsWith('/rpc/create_job_atomic'))
 expect(calls).toHaveLength(2);expect(calls[0].body.request_id).toBe(calls[1].body.request_id)
 expect(s.jobs).toHaveLength(1);expect(s.errors).toEqual([])
})
test('job status failure remains visible and makes no separate appointment write',async({page})=>{
 const s=await setup(page,{jobs:[{id:A,customer_id:C,title:'Existing job',status:'in_progress',customers:customer,scheduled_start:null}]})
 await page.goto('/?view=work&document='+A)
 const dialog=page.getByRole('region',{name:'Selected job workspace',exact:true})
 await page.locator('.jm-workspace-footer summary').click();await page.getByRole('button',{name:'Review completion',exact:true}).click();const completion=page.getByRole('dialog',{name:'Complete job review',exact:true});await completion.getByRole('button',{name:'Complete job',exact:true}).click()
 await expect(completion.getByRole('alert')).toContainText('Unable to update linked appointment')
 expect(s.requests.filter(r=>r.path.endsWith('/functions/v1/work-scheduling')&&r.body?.action==='complete')).toHaveLength(1)
 expect(s.requests.filter(r=>r.path.endsWith('/appointments')&&r.method==='PATCH')).toHaveLength(0)
 expect(s.jobs[0].status).toBe('in_progress');expect(s.errors).toEqual([])
})
