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
async function mock(page,{signedIn=true,conflict=false,plan='pro',job=null}={}){
 const state={calls:[],booked:false,bookedSlot:null,approved:false,customers:[customer],completed:false,workflowDelay:0,pendingWorkflow:0,job,crewConflict:false}
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
  if(path.endsWith('/rpc/get_plan_usage'))return reply({plan,ai_limit:0,voice_limit:0})
  if(path.endsWith('/rpc/get_schedule_team'))return reply(team)
  if(path.endsWith('/rpc/get_dashboard_attention_page')){
   const value=attentionPage(body,{workflow:{approved:state.booked?[]:[{id:E,estimate_number:'EST-QA',customer_name:'Test Customer',offer:state.approved?{status:'approved',expires_at:'2099-01-01'}:null}],completed:[],approved_count:state.booked?0:1,completed_count:0}})
   const delay=state.workflowDelay;state.workflowDelay=0;state.pendingWorkflow++
   try{if(delay)await new Promise(resolve=>setTimeout(resolve,delay));return await reply(value)}finally{state.pendingWorkflow--}
  }
  if(path.endsWith('/rpc/get_dashboard_invoice_totals'))return reply({open_invoices:0,outstanding_balance:0})
  if(path.endsWith('/rpc/get_scheduling_context'))return reply({preferences:{work_days:[1,2,3,4,5],start_minutes:480,end_minutes:1020,duration_minutes:120,buffer_minutes:30,notice_hours:24},team,time_off:[],properties:[{id:P,label:'Job site',address:'1 Test Street'}],estimate:body.p_estimate?{id:E,number:'EST-QA',customer_id:C,job_id:null,property_id:P,title:'Mow and trim',scope:'Mow and trim × 2',customer_name:'Test Customer',customer_email:'customer@example.test'}:undefined,offer:null})
  if(path.endsWith('/rpc/suggest_scheduling_slots'))return reply(slots.map(({starts_at,ends_at})=>({starts_at,ends_at})))
  if(path.endsWith('/rpc/book_approved_estimate')){
   state.booked=true;state.bookedSlot=body.p_input
   state.job={id:J,title:body.p_input.title,status:'scheduled',scheduled_start:body.p_input.starts_at,scheduled_end:body.p_input.ends_at,assigned_user_ids:body.p_input.workers,customer_id:C,customers:customer,properties:[]}
   return reply({job_id:J,already_booked:false})
  }
  if(path.endsWith('/rpc/assign_job_crew')){
   if(state.crewConflict)return reply({code:'23P01',message:'A selected worker is already booked.'},409)
   state.job={...state.job,assigned_user_ids:body.p_workers}
   return reply(null)
  }
  if(path.endsWith('/rpc/save_job_appointment')){
   state.job={...state.job,scheduled_start:body.p_start,scheduled_end:body.p_end}
   return reply(null)
  }
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
  if(path.endsWith('/jobs'))return reply(url.searchParams.has('id')?state.job:state.job?[state.job]:[])
  return reply([])
 })
 return state
}
const scheduleWork=page=>page.getByRole('group',{name:'Needs Attention categories'}).getByRole('button',{name:/^Schedule work/})
const scheduleQueue=page=>page.getByRole('region',{name:'Needs scheduling',exact:true})
for(const width of [1440,390])test(`guided booking proposes crew availability and needs explicit owner approval at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const state=await mock(page);await page.goto('/')
 await scheduleWork(page).click()
 const next=scheduleQueue(page);await expect(next).toContainText('Test Customer')
 expect(state.calls.filter(c=>/approve_scheduling_offer|work-scheduling/.test(c.path))).toHaveLength(0)
 await next.getByRole('button',{name:'Schedule job',exact:true}).click()
 const dialog=page.getByRole('dialog')
 await expect(dialog.getByRole('button',{name:'Book appointment',exact:true})).toHaveAttribute('aria-pressed','true')
 await dialog.getByRole('button',{name:'Send booking link',exact:true}).click()
 await expect(dialog.getByRole('group',{name:'Available appointment times'})).toBeVisible()
 await expect(dialog.getByRole('button',{name:'Approve & email customer',exact:true})).toBeDisabled()
 expect(state.calls.filter(c=>/approve_scheduling_offer|work-scheduling/.test(c.path))).toHaveLength(0)
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
 await dialog.getByRole('checkbox',{name:/I approve these/}).check()
 await dialog.getByRole('button',{name:'Approve & email customer',exact:true}).click()
 await expect(dialog.getByRole('status')).toContainText('email provider accepted')
 const approved=state.calls.find(c=>c.path.endsWith('/rpc/approve_scheduling_offer'))
 expect(approved.body.p_input.recipient_email).toBe('customer@example.test');expect(approved.body.p_input.workers).toEqual([U]);expect(approved.body.p_input.property_id).toBe(P)
 const messages=state.calls.filter(c=>c.path.endsWith('/functions/v1/work-scheduling'));expect(messages).toHaveLength(1);expect(messages[0].body.approved).toBe(true)
 await page.screenshot({path:`test-results/guided-scheduling-${width}.png`,fullPage:true})
 await dialog.getByRole('button',{name:'Done'}).click()
 await expect(next).toContainText('Waiting for customer')
 await next.getByRole('button',{name:'Manage invitation'}).click()
 await expect(page.getByRole('dialog').getByRole('button',{name:'Send booking link',exact:true})).toHaveAttribute('aria-pressed','true')
})
test('phone agreement books once and sends no customer message',async({page})=>{
 const state=await mock(page);await page.goto('/');await scheduleWork(page).click()
 await scheduleQueue(page).getByRole('button',{name:'Schedule job',exact:true}).click()
 await expect(scheduleWork(page)).toHaveAccessibleName('Schedule work 1')
 const dialog=page.getByRole('dialog')
 const confirm=dialog.getByRole('button',{name:'Confirm booking',exact:true})
 await expect(confirm).toBeDisabled()
 await dialog.getByRole('radio').first().check()
 await expect(confirm).toBeEnabled()
 await confirm.evaluate(button=>{button.click();button.click()})
 await expect(dialog.getByRole('status')).toContainText('No customer message was sent.')
 await expect(dialog.getByRole('link',{name:'Open job'})).toHaveAttribute('href','/?view=work&document='+J)
 expect(state.calls.filter(c=>c.path.endsWith('/rpc/book_approved_estimate'))).toHaveLength(1)
 expect(state.calls.filter(c=>c.path.endsWith('/functions/v1/work-scheduling'))).toHaveLength(0)
 await dialog.getByRole('button',{name:'Close scheduling'}).click()
 await expect(scheduleQueue(page)).toContainText('No work needs scheduling.')
 await expect(scheduleWork(page)).toHaveAccessibleName('Schedule work 0')
 const calendar=page.getByRole('region',{name:'Work calendar'})
 await calendar.getByRole('button',{name:'Next week',exact:true}).click()
 await calendar.getByRole('button',{name:'Next week',exact:true}).click()
 await expect(calendar.locator('.calendar-work-list')).toContainText('Mow and trim')
})

test('an older next-step response cannot restore a booking resolved by a newer refresh',async({page})=>{
 const state=await mock(page);await page.goto('/')
 await scheduleWork(page).click()
 await expect(scheduleWork(page)).toHaveAccessibleName('Schedule work 1')
 await expect.poll(()=>state.pendingWorkflow).toBe(0)
 state.workflowDelay=800
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
 await expect.poll(()=>state.pendingWorkflow).toBe(1)
 state.booked=true
 await page.evaluate(()=>window.dispatchEvent(new Event('finviant-work-changed')))
 await expect(scheduleQueue(page)).toContainText('No work needs scheduling.')
 await expect(scheduleWork(page)).toHaveAccessibleName('Schedule work 0')
 await expect.poll(()=>state.pendingWorkflow).toBe(0)
 await expect(scheduleQueue(page)).toContainText('No work needs scheduling.')
 await expect(scheduleWork(page)).toHaveAccessibleName('Schedule work 0')
})

for(const width of [1440,390])test(`dashboard tiles share surfaces and typography at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await mock(page);await page.goto('/')
 await expect(scheduleWork(page)).toHaveAccessibleName('Schedule work 1')
 await expect(page.locator('.home-overview .dashboard-tile')).toHaveCount(3)
 const appearance=await page.locator('.dashboard-tile').evaluateAll(tiles=>tiles.map(tile=>{
  const style=getComputedStyle(tile),title=getComputedStyle(tile.querySelector('.dashboard-tile-title'))
  return {background:style.backgroundColor,border:style.borderColor,borderWidth:style.borderWidth,radius:style.borderRadius,font:style.fontFamily,titleFont:title.fontFamily,titleSize:title.fontSize,titleWeight:title.fontWeight,titleColor:title.color}
 }))
 for(const tile of appearance)expect(tile).toEqual(appearance[0])
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:`test-results/uniform-dashboard-${width}.png`,fullPage:true})
})
for(const width of [1440,390])test(`customer chooses and confirms one appointment without an account at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const state=await mock(page,{signedIn:false});await page.goto('/?booking='+'a'.repeat(64))
 await expect(page.getByRole('heading',{name:'Choose a time that works for you'})).toBeVisible()
 await page.getByRole('radio').first().check();await page.getByLabel('Your full name').fill('Test Customer')
 const confirm=page.getByRole('button',{name:'Confirm this appointment'})
 await expect(confirm).toBeEnabled()
 await confirm.evaluate(button=>{button.click();button.click()})
 await expect(page.getByRole('heading',{name:'Your appointment is confirmed'})).toBeVisible()
 expect(state.calls.filter(c=>c.path.endsWith('/rpc/customer_schedule_offer')&&c.body.p_slot)).toHaveLength(1)
 expect(state.calls.some(c=>c.path.includes('/auth/v1'))).toBe(false)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Add to calendar (.ics)'}).click();expect((await download).suggestedFilename()).toBe('Finviant-appointment.ics')
})
test('stale customer slot reports a conflict and never claims confirmation',async({page})=>{
 await mock(page,{signedIn:false,conflict:true});await page.goto('/?booking='+'a'.repeat(64));await page.getByRole('radio').first().check();await page.getByLabel('Your full name').fill('Test Customer');await page.getByRole('button',{name:'Confirm this appointment'}).click()
 await expect(page.getByRole('alert')).toContainText('just booked');await expect(page.getByRole('heading',{name:'Your appointment is confirmed'})).toHaveCount(0)
 await expect(page.getByRole('button',{name:'Refresh appointment times'})).toBeVisible()
})
test('a typed customer stays in the estimate draft without losing line-item work',async({page})=>{
 await mock(page);await page.goto('/?view=estimates');await createWork(page, 'estimate')
 await page.getByPlaceholder('Description',{exact:true}).fill('Keep this scope');await page.getByPlaceholder('Unit price',{exact:true}).fill('250')
 await page.getByRole('button',{name:'Create a new customer',exact:true}).click()
 await page.getByLabel('Customer name',{exact:true}).fill('New Customer')
 await page.getByText('Add email or phone (optional)',{exact:true}).click()
 await page.getByLabel('Customer email',{exact:true}).fill('new@example.test')
 await expect(page.getByPlaceholder('Description',{exact:true})).toHaveValue('Keep this scope')
 await expect(page.getByPlaceholder('Unit price',{exact:true})).toHaveValue('250')
 await expect(page.getByLabel('Customer name',{exact:true})).toHaveValue('New Customer')
})

for (const plan of ['free', 'basic']) test(`${plan} opens manual booking with the owner selected and one contextual upgrade link`, async ({page}) => {
 const state=await mock(page,{plan})
 await page.goto('/')
 await scheduleWork(page).click()
 await scheduleQueue(page).getByRole('button',{name:'Schedule job',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Find a time that works'})
 await expect(dialog.getByText('Customer self-booking is unavailable on the '+(plan==='free'?'Free':'Individual')+' plan.')).toBeVisible()
 await expect(dialog.getByRole('link',{name:'View Business Pro upgrade'})).toHaveAttribute('href','/?view=settings&section=plans&tier=pro')
 await expect(dialog.getByRole('group',{name:'Scheduling method'})).toHaveCount(0)
 await expect(dialog.getByRole('group',{name:'Crew for this appointment'})).toHaveCount(0)
 await dialog.getByRole('radio').first().check()
 await dialog.getByRole('button',{name:'Confirm booking'}).click()
 await expect(page.getByRole('dialog',{name:'Your next step is ready'}).getByRole('status')).toContainText('No customer message was sent.')
 const booking=state.calls.filter(call=>call.path.endsWith('/rpc/book_approved_estimate'))
 expect(booking).toHaveLength(1)
 expect(booking[0].body.p_input.workers).toEqual([U])
 expect(state.calls.some(call=>call.path.endsWith('/rpc/approve_scheduling_offer'))).toBe(false)
})


test('a crew conflict offers rescheduling without moving the appointment or switching its crew', async ({page}) => {
 await page.setViewportSize({width:390,height:850})
 const original={id:J,title:'Crew test',customer_id:C,customers:customer,properties:[],status:'scheduled',
  assigned_user_ids:[U],scheduled_start:slots[0].starts_at,scheduled_end:slots[0].ends_at}
 const state=await mock(page,{job:original})
 await page.goto('/?view=work&document='+J)
 const job=page.getByRole('dialog',{name:'Job details',exact:true})
 await expect(job).toContainText('Crew test')
 const assign=job.getByRole('button',{name:'Assign crew',exact:true})
 await assign.click()
 const crew=page.getByRole('dialog',{name:'Assign crew',exact:true})
 await expect(crew.locator('input[type=datetime-local]')).toHaveCount(0)
 await crew.getByRole('checkbox',{name:'Owner (you)'}).uncheck()
 await crew.getByRole('checkbox',{name:'Field worker'}).check()
 state.crewConflict=true
 await crew.getByRole('button',{name:'Save crew'}).click()
 await expect(crew.getByRole('alert')).toContainText('selected crew is unavailable')
 expect(state.job).toEqual(original)
 expect(state.calls.find(call=>call.path.endsWith('/rpc/assign_job_crew')).body).toMatchObject({
  p_job:J,p_workers:[J],p_expected_start:original.scheduled_start,p_expected_end:original.scheduled_end,p_expected_workers:[U],
 })

 await crew.getByRole('button',{name:'Reschedule appointment'}).click()
 const appointment=page.getByRole('dialog',{name:'Reschedule appointment',exact:true})
 await expect(appointment.getByRole('checkbox')).toHaveCount(0)
 await expect(appointment.getByRole('button',{name:'Save new time'})).toBeDisabled()
 expect(state.calls.filter(call=>call.path.endsWith('/rpc/save_job_appointment'))).toHaveLength(0)
 await appointment.getByLabel('Start',{exact:true}).fill(DateTime.fromISO(slots[1].starts_at).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm"))
 await appointment.getByRole('button',{name:'Save new time'}).click()
 await expect(job.getByRole('status')).toContainText('Appointment saved')
 expect(state.job.assigned_user_ids).toEqual([U])
 expect(Date.parse(state.job.scheduled_start)).toBe(Date.parse(slots[1].starts_at))
 expect(Date.parse(state.job.scheduled_end)).toBe(Date.parse(slots[1].ends_at))

 state.crewConflict=false
 await assign.click()
 await crew.getByRole('checkbox',{name:'Owner (you)'}).uncheck()
 await crew.getByRole('checkbox',{name:'Field worker'}).check()
 await crew.getByRole('button',{name:'Save crew'}).click()
 await expect(job.getByRole('status')).toContainText('Crew saved')
 await expect(job.getByText('Field worker',{exact:true})).toBeVisible()
 expect(state.job.assigned_user_ids).toEqual([J])
 expect(Date.parse(state.job.scheduled_start)).toBe(Date.parse(slots[1].starts_at))
 expect(state.calls.some(call=>call.path.endsWith('/functions/v1/work-scheduling'))).toBe(false)
})
