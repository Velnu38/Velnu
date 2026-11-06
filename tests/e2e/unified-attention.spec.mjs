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
async function mock(page,{signedIn=true,conflict=false}={}){
 const state={calls:[],booked:false,bookedSlot:null,approved:false,customers:[customer],completed:false,notes:"Mow and trim",workflowDelay:0,pendingWorkflow:0}
 if(signedIn){const head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),body=Buffer.from(JSON.stringify({sub:U,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');await page.addInitScript(session=>localStorage.setItem('sb-example-auth-token',JSON.stringify(session)),{access_token:`${head}.${body}.test`,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user})}
 await page.route('https://example.supabase.co/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();let body;try{body=req.postDataJSON()}catch{}
  state.calls.push({path,method,body})
  const reply=(value,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-expose-headers':'content-range','content-range':Array.isArray(value)?`0-${Math.max(0,value.length-1)}/${value.length}`:'0-0/0'},body:JSON.stringify(value)})
  if(method==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,DELETE'},body:''})
  if(path.endsWith('/auth/v1/user'))return reply(user)
  if(path.endsWith('/rpc/get_membership_entry'))return reply(B)
  if(path.endsWith('/user_plan_preferences'))return reply({selected_tier:'pro'})
  if(path.endsWith('/user_agreement_acceptances'))return reply({id:E,agreement_version:'2026-10-26-v2'})
  if(path.endsWith('/business_members'))return reply({business_id:B,role:'owner',access_modules:['calendar','jobs','billing','finances'],businesses:business})
  if(path.endsWith('/business_settings'))return reply({default_tax_rate:0,pricing_adjustment_percent:0,payment_links:[],payment_instructions:''})
  if(path.endsWith('/rpc/get_plan_usage'))return reply({plan:'pro',ai_limit:0,voice_limit:0})
  if(path.endsWith('/rpc/get_schedule_team'))return reply(team)
  if(path.endsWith('/rpc/get_dashboard_attention_page')){
   const value=attentionPage(body,{workflow:{approved:state.booked?[]:[{id:E,estimate_number:'EST-QA',customer_name:'Test Customer',offer:state.approved?{status:'approved',expires_at:'2099-01-01'}:null}],completed:[],approved_count:state.booked?0:1,completed_count:0}})
   const delay=state.workflowDelay;state.workflowDelay=0;state.pendingWorkflow++
   try{if(delay)await new Promise(resolve=>setTimeout(resolve,delay));return await reply(value)}finally{state.pendingWorkflow--}
  }
  if(path.endsWith('/rpc/get_dashboard_invoice_totals'))return reply({open_invoices:0,outstanding_balance:0})
  if(path.endsWith('/rpc/get_scheduling_context'))return reply({preferences:{work_days:[1,2,3,4,5],start_minutes:480,end_minutes:1020,duration_minutes:120,buffer_minutes:30,notice_hours:24},team,time_off:[],properties:[{id:P,label:'Job site',address:'1 Test Street'}],estimate:body.p_estimate?{id:E,number:'EST-QA',customer_id:C,job_id:null,property_id:P,title:'Mow and trim',scope:'Mow and trim × 2',customer_name:'Test Customer',customer_email:'customer@example.test'}:undefined,offer:null})
  if(path.endsWith('/rpc/suggest_scheduling_slots'))return reply(slots.map(({starts_at,ends_at})=>({starts_at,ends_at})))
  if(path.endsWith('/rpc/book_approved_estimate')){state.booked=true;state.bookedSlot=body.p_input;return reply({job_id:J,already_booked:false})}
  if(path.endsWith('/calendar_work'))return reply(state.bookedSlot?[{source_key:'appointment:'+J,job_id:J,document_kind:'estimate',document_id:E,title:state.bookedSlot.title,status:'confirmed',assigned_user_ids:state.bookedSlot.workers,starts_at:state.bookedSlot.starts_at,ends_at:state.bookedSlot.ends_at}]:[])
  if(path.endsWith('/rpc/approve_scheduling_offer')){state.approved=true;return reply({id:body.p_request,status:'approved',expires_at:DateTime.now().plus({days:7}).toISO()})}
  if(path.endsWith('/functions/v1/work-scheduling')){if(body.action==='complete'){state.completed=true;return reply({job_id:J,status:'completed',invoice_ready:true,invoice_id:E})}return reply({status:'accepted'})}
  if(path.endsWith('/rpc/save_scheduling_preferences'))return reply(null)
  if(path.endsWith('/rpc/customer_schedule_offer')){
   if(body.p_slot){if(conflict)return reply({code:'23P01',message:'That time was just booked. Please choose another option.'},409);state.booked=true}
   return reply({business_name:'Scheduling QA',business_phone:'555-0100',title:'Mow and trim',timezone:zone,note:'Please choose a time.',address:'1 Test Street',status:state.booked?'booked':'approved',expires_at:DateTime.now().plus({days:7}).toISO(),slots:state.booked?[]:slots,confirmed:state.booked?slots[0]:null})
  }
  if(path.endsWith('/customers')){if(method==='POST'){state.customers.push(body);return reply(body,201)}return reply(state.customers)}
  if(path.endsWith('/estimates')){
   const rows=[{id:E,estimate_number:'EST-QA',customer_id:C,status:'accepted',issue_date:'2026-10-01',total:105,subtotal:100,tax_amount:5,customers:customer}]
   return reply(url.searchParams.has('status')?rows.filter(row=>'eq.'+row.status===url.searchParams.get('status')):rows)
  }
  if(path.endsWith('/estimate_items'))return reply([{id:P,description:'Mow and trim',quantity:2,unit_price:50,tax_rate:5,line_total:100}])
  if(path.endsWith('/jobs')){
   if(method==='PATCH'){state.notes=body.description;return reply({id:J})}
   const job={id:J,title:'Garden maintenance',description:state.notes,status:'scheduled',customer_id:C,scheduled_start:slots[0].starts_at,scheduled_end:slots[0].ends_at,assigned_user_ids:[U],customers:customer,properties:[{id:P,address_line1:'1 Test Street',city:'Chesapeake',state:'VA',postal_code:'23322'}]}
   return reply(req.headers().accept?.includes('vnd.pgrst.object')||req.headers().accept?.includes('vnd.pgrst.object')?job:[job])
  }
  return reply([])
 })
 return state
}

for(const width of [1440,390])test(`one attention area below billing and shared job notes at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const state=await mock(page);await page.goto('/')
 const billing=page.getByRole('article',{name:'Needs attention overview'})
 await billing.getByRole('button',{name:/^Your next steps Needs Attention/}).click()
 const attention=page.getByRole('region',{name:'Needs Attention',exact:true})
 await expect(attention).toContainText('Test Customer')
 await expect(attention.getByText('No items need attention.')).toHaveCount(0)
 await billing.getByRole('button',{name:/^Awaiting Customer Approval/}).click()
 await expect(billing.getByRole('button',{name:'Schedule job',exact:true})).toHaveCount(0)
 await billing.getByRole('group',{name:'Home work queue'}).getByRole('button',{name:/^Needs attention/}).click()
 await expect(page.getByRole('heading',{name:'Your next steps',exact:true})).toHaveCount(0)
 await expect(page.getByRole('heading',{name:'To do',exact:true})).toHaveCount(0)
 await expect(page.getByRole('button',{name:/Needs Attention/}).first()).toBeVisible()
 await attention.getByRole('button',{name:'Schedule job',exact:true}).click()
 let dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Time already agreed',exact:true}).click()
 await expect(dialog.getByRole('button',{name:'Confirm booking',exact:true})).toBeEnabled()
 await expect(dialog.getByRole('checkbox',{name:/I have agreed/})).toHaveCount(0)
 await dialog.getByRole('button',{name:'Confirm booking',exact:true}).click()
 await expect(dialog.getByRole('status')).toContainText('Job booked')
 await dialog.getByRole('button',{name:'Close scheduling'}).click()
 await expect(attention.getByRole('button',{name:'Schedule job',exact:true})).toHaveCount(0)
 const calendar=page.getByRole('region',{name:'Work calendar'})
 await calendar.getByRole('button',{name:'Next week',exact:true}).click();await calendar.getByRole('button',{name:'Next week',exact:true}).click()
 await calendar.locator('.calendar-event').click()
 dialog=page.getByRole('dialog',{name:'Job details',exact:true})
 await expect(dialog).toContainText('1 Test Street')
 await dialog.getByLabel('Job notes and materials needed').fill('Bring mulch, gloves and two bags of seed')
 await dialog.getByRole('button',{name:'Save job details'}).click()
 await expect(dialog.getByRole('status')).toContainText('Job details saved')
 await dialog.getByRole('button',{name:'Close',exact:true}).click()
 await page.goto('/?view=work&document='+J)
 dialog=page.getByRole('dialog',{name:'Job details',exact:true})
 await expect(dialog.getByLabel('Job notes and materials needed')).toHaveValue('Bring mulch, gloves and two bags of seed')
 expect(state.notes).toBe('Bring mulch, gloves and two bags of seed')
 expect(state.calls.filter(c=>c.path.endsWith('/functions/v1/work-scheduling'))).toHaveLength(0)
})
