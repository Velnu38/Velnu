import { openWorkArea } from './navigation.mjs'
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
  const json=(value,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(value)})
  if(method==='OPTIONS')return route.fulfill({status:200,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:''})
  if(path.endsWith('/user'))return json(user)
  if(path.endsWith('/user_plan_preferences'))return json({user_id:U,selected_tier:'pro'})
  if(path.endsWith('/user_agreement_acceptances'))return json({id:A,agreement_version:'2026-10-27-v3'})
  if(path.endsWith('/business_members'))return json({role:'owner',business_id:B,businesses:{id:B,name:'Recovery Test',profile_completed_at:'2026-01-01T00:00:00Z'}})
  if(path.endsWith('/rpc/get_plan_usage'))return json({plan:'pro',ai_limit:50,voice_limit:50,logo_bytes_limit:131072})
  if(path.endsWith('/rpc/get_dashboard_invoice_totals'))return json({open_invoices:0,outstanding_balance:0})
  if(path.endsWith('/customers'))return json([customer])
  if(path.endsWith('/jobs'))return json(s.jobs)
  if(path.endsWith('/functions/v1/ai-command'))return json({action_id:A,intent:options.payment?'record_payment':'create_customer',requires_confirmation:true,fields:options.payment?{customer_name:'Demo Customer',payment_amount:90,payment_method:'cash'}:{customer_name:'Demo Customer'},clarification_question:null})
  if(path.endsWith('/rpc/decide_ai_action')){
   expect(body.p_action_id).toBe(A)
   if(body.p_decision==='rejected'){s.rejections++;if(options.rejectLost&&s.rejections===1)return json({message:'Temporary error',code:'500'},500);return json(null)}
   s.confirmations++
   if(options.confirmLost&&s.confirmations===1)return json({message:'Confirmation response lost',code:'500'},500)
   return json(null)
  }
  if(path.endsWith('/functions/v1/execute-ai-action')){
   expect(body.action_id).toBe(A);s.executions++;s.created=1
   if(options.executeLost&&s.executions===1)return json({error:'Response lost after commit'},504)
   if(options.slow)await new Promise(r=>setTimeout(r,150))
   return json({action_id:A,status:'executed',already_executed:s.executions>1,result:options.payment?{payment:{id:C,amount:90},invoice:{id:C,invoice_number:'INV-TEST',balance_due:90}}:{customer:{id:C}}})
  }
  if(path.endsWith('/rpc/create_job_atomic')){
   s.jobAttempts++
   if(!s.jobs.length)s.jobs.push({id:A,title:body.payload.title,status:'lead',customers:customer,scheduled_start:null})
   if(options.jobLost&&s.jobAttempts===1)return json({message:'Job response lost after commit',code:'500'},500)
   return json(s.jobs[0])
  }
  if(path.endsWith('/rpc/set_job_status_atomic'))return json({message:'Unable to update linked appointment',code:'23514'},409)
  return json([])
 })
 await page.goto('/')
 return s
}
async function propose(page,text='Create a customer named Demo Customer'){
 await page.getByRole('button',{name:'Talk to Finviant Office'}).click()
 await page.getByRole('textbox',{name:'Describe your invoice or request'}).fill(text)
 await page.getByRole('button',{name:'Send command'}).click()
 await expect(page.getByRole('button',{name:'Confirm',exact:true})).toBeVisible()
}
test('lost confirmation can be retried using the same action; one mutation',async({page})=>{
 const s=await setup(page,{confirmLost:true});await propose(page)
 await page.getByRole('button',{name:'Confirm',exact:true}).click()
 await expect(page.locator('.assistant-panel .error-text')).toBeVisible()
 expect(s.executions).toBe(0)
 await page.getByRole('button',{name:'Confirm',exact:true}).click()
 await expect(page.getByText('Customer saved.')).toBeVisible()
 expect(s.confirmations).toBe(2);expect(s.created).toBe(1);expect(s.errors).toEqual([])
 expect(s.requests.filter(r=>r.path.endsWith('/ai_actions')&&r.method==='PATCH')).toHaveLength(0)
})
test('lost execution response retries the same action without creating a second record',async({page})=>{
 const s=await setup(page,{executeLost:true});await propose(page)
 await page.getByRole('button',{name:'Confirm',exact:true}).click()
 await expect(page.locator('.assistant-panel .error-text')).toBeVisible()
 await page.getByRole('button',{name:'Confirm',exact:true}).click()
 await expect(page.getByText('Customer saved.')).toBeVisible()
 expect(s.executions).toBe(2);expect(s.created).toBe(1);expect(s.errors).toEqual([])
})
test('failed cancellation is visible and recoverable, never executes action',async({page})=>{
 const s=await setup(page,{rejectLost:true});await propose(page)
 await page.getByRole('button',{name:'Cancel',exact:true}).click()
 await expect(page.getByText(/Cancellation could not be confirmed/)).toBeVisible()
 await page.getByRole('button',{name:'Cancel',exact:true}).click()
 await expect(page.getByRole('button',{name:'Confirm',exact:true})).toHaveCount(0)
 expect(s.executions).toBe(0);expect(s.rejections).toBe(2);expect(s.errors).toEqual([])
})
test('rapid confirmation attempts use an immediate in-flight guard',async({page})=>{
 const s=await setup(page,{slow:true});await propose(page)
 await page.getByRole('button',{name:'Confirm',exact:true}).evaluate(button=>{button.click();button.click()})
 await expect(page.getByText('Customer saved.')).toBeVisible()
 expect(s.executions).toBe(1);expect(s.confirmations).toBe(1)
})
test('recorded payment is described as a payment, not a newly created invoice',async({page})=>{
 await setup(page,{payment:true});await propose(page,'Record a cash payment of $90 for Demo Customer')
 await page.getByRole('button',{name:'Confirm',exact:true}).click()
 await expect(page.getByText('Payment of $90.00 recorded.')).toBeVisible()
 await expect(page.getByText(/Invoice INV-TEST is ready/)).toHaveCount(0)
})
test('job creation preserves request identity after a lost response',async({page})=>{
 const s=await setup(page,{jobLost:true})
 await openWorkArea(page, 'Jobs')
 await page.getByRole('button',{name:'+ New job'}).click()
 await page.getByRole('combobox',{name:'Customer',exact:true}).selectOption(C)
 await page.getByLabel('Job title',{exact:true}).fill('Recovery demonstration')
 await page.getByRole('button',{name:'Save job',exact:true}).click()
 await expect(page.locator('.modal .error-text')).toBeVisible()
 await expect(page.getByLabel('Job title',{exact:true})).toHaveValue('Recovery demonstration')
 await page.getByRole('button',{name:'Save job',exact:true}).click()
 await expect(page.locator('.modal')).toHaveCount(0)
 const calls=s.requests.filter(r=>r.path.endsWith('/rpc/create_job_atomic'))
 expect(calls).toHaveLength(2);expect(calls[0].body.request_id).toBe(calls[1].body.request_id)
 expect(s.jobs).toHaveLength(1);expect(s.errors).toEqual([])
})
test('job status failure remains visible and makes no separate appointment write',async({page})=>{
 const s=await setup(page,{jobs:[{id:A,title:'Existing job',status:'lead',customers:customer,scheduled_start:null}]})
 await openWorkArea(page, 'Jobs')
 await page.locator('.job-row select').selectOption('completed')
 await expect(page.getByRole('alert')).toBeVisible()
 expect(s.requests.filter(r=>r.path.endsWith('/appointments')&&r.method==='PATCH')).toHaveLength(0)
 expect(s.jobs[0].status).toBe('lead');expect(s.errors).toEqual([])
})
