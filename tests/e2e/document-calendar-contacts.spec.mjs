import { createWork } from './navigation.mjs'
import {attentionPage} from './attention-fixture.mjs'
import {test,expect} from '@playwright/test'
import {DateTime} from 'luxon'
import {fulfillPdf,pdfHeaders,PDF_REVISION} from './document-pdf-fixture.mjs'
import {generateDocumentPdf} from '../../shared/documentPdf.ts'
import {readFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'

// Browser fixtures only: all authentication, database and delivery calls are intercepted.
const B='11111111-1111-4111-8111-111111111111',U='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',E='44444444-4444-4444-8444-444444444444',P='55555555-5555-4555-8555-555555555555',J='66666666-6666-4666-8666-666666666666'
const zone='America/New_York',user={id:U,email:'owner@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}
const business={id:B,name:'Scheduling QA',created_by_user_id:U,timezone:zone,profile_completed_at:'2026-10-01T00:00:00Z',document_accent:'#2563eb'}
const customer={id:C,first_name:'Test',last_name:'Customer',company:null,email:'customer@example.test'}
const team=[{id:U,label:'Owner',role:'owner',is_you:true},{id:J,label:'Field worker',role:'technician',is_you:false}]
const slots=Array.from({length:3},(_,n)=>({id:`77777777-7777-4777-8777-${String(n+1).padStart(12,'0')}`,starts_at:DateTime.now().setZone(zone).plus({days:14+n}).set({hour:9,minute:0,second:0,millisecond:0}).toISO(),ends_at:DateTime.now().setZone(zone).plus({days:14+n}).set({hour:11,minute:0,second:0,millisecond:0}).toISO()}))
async function mock(page,{signedIn=true,conflict=false,completedWork=false,ai=false,owner=true,recurring=false}={}){
 const state={calls:[],booked:false,approved:false,customers:[customer],completed:false,documents:[],entries:[],changes:[],imported:[],recurringPlans:[]}
 if(signedIn){const head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),body=Buffer.from(JSON.stringify({sub:U,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');await page.addInitScript(session=>localStorage.setItem('sb-example-auth-token',JSON.stringify(session)),{access_token:`${head}.${body}.test`,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user})}
 await page.route('https://example.supabase.co/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();let body;try{body=req.postDataJSON()}catch{}
  state.calls.push({path,method,body})
  const reply=(value,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-expose-headers':'content-range','content-range':Array.isArray(value)?`0-${Math.max(0,value.length-1)}/${value.length}`:'0-0/0'},body:JSON.stringify(value)})
  if(method==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,DELETE'},body:''})
  if(path.endsWith('/functions/v1/document-pdf'))return fulfillPdf(route)
  if(path.endsWith('/rpc/get_private_beta_access'))return reply({allowed:true})
  if(path.endsWith('/rpc/business_onboarding_status'))return reply({required:false,completed:true})
  if(path.endsWith('/rpc/get_invoice_payment_operations'))return reply({state:'clear',operations:[],refunds:[]})
  if(path.endsWith('/rpc/get_estimate_workflow_context'))return reply(body.p_estimates.filter(id=>id===E).map(estimate_id=>({estimate_id,job:completedWork?{id:J,status:'completed',scheduled_start:null,scheduled_end:null}:null,appointment:null,schedule:null,invitation:null,final_invoice_id:null})))
  if(path.endsWith('/auth/v1/user'))return reply(user)
  if(path.endsWith('/rpc/get_membership_entry'))return reply(B)
  if(path.endsWith('/user_plan_preferences'))return reply({selected_tier:'pro'})
  if(path.endsWith('/user_agreement_acceptances'))return reply({id:E,agreement_version:'2026-10-26-v2'})
  if(path.endsWith('/business_members'))return reply({business_id:B,role:owner?'owner':'office',access_modules:['calendar','jobs','billing','finances'],businesses:business})
  if(path.endsWith('/business_settings'))return reply({default_tax_rate:0,pricing_adjustment_percent:0,payment_links:[{provider:'stripe',url:'https://buy.stripe.com/owner-link'}],payment_instructions:'Use your invoice number'})
  if(path.endsWith('/rpc/get_document_change_context'))return reply({business_id:B,document_id:body.p_document,kind:body.p_kind,number:body.p_kind==='invoice'?'INV-QA':'EST-QA',customer_id:C,customer_name:'Test Customer',job_id:null,estimate_id:body.p_kind==='estimate'?E:null,work_status:completedWork?'completed':'unscheduled',can_change:!completedWork,total:105,current_total:105,deposit_paid:body.p_kind==='invoice'?25:0,other_paid:0,address:'1 Test Street',items:[{description:'Original work',quantity:2,unit_price:50,tax_rate:5}]})
  if(path.endsWith('/rpc/get_change_order_source_lines'))return reply([{id:P,description:'Original work',quantity:2,unit_price:50,tax_rate:5}])
  if(path.endsWith('/rpc/create_linked_change_order')){state.changes.push(body);return reply({id:P,status:'draft',total:52.50})}
  if(path.endsWith('/rpc/create_document_change_order')){state.changes.push(body);return reply({id:P,status:'draft',total:20})}
  if(path.endsWith('/rpc/create_document')){state.documents.push(body);return reply({id:E,status:'draft',total:250})}
  if(path.endsWith('/rpc/import_customer_contacts')){state.imported.push(...body.p_contacts);return reply({imported:body.p_contacts.length,skipped:0,already_imported:0})}
  if(path.endsWith('/appointments')){if(method==='POST'){const entry={...body,updated_at:new Date().toISOString()};state.entries.push(entry);return reply(entry,201)}return reply([])}
  if(path.endsWith('/calendar_work'))return reply(state.entries.map(e=>({source_key:'appointment:'+e.id,title:e.title,starts_at:e.starts_at,ends_at:e.ends_at,status:'scheduled',document_kind:'work',document_id:e.id,job_id:null,assigned_user_ids:[U]})))
  if(path.endsWith('/functions/v1/transcribe-voice'))return reply({configured:false})
  if(path.endsWith('/rpc/get_plan_usage'))return reply({plan:ai?'pro':recurring?'basic':'free',ai_limit:ai?100:0,ai_used:0,voice_limit:ai?100:0})
  if(path.endsWith('/rpc/create_recurring_invoice')){
   if(!state.recurringPlans.some(p=>p.id===body.p_request))state.recurringPlans.push({id:body.p_request,source_invoice_id:body.p_invoice,...body.p_options,status:'active',next_date:body.p_options.first_date,timezone:zone,created_at:new Date().toISOString(),occurrences:[]})
   return reply({id:body.p_request,status:'active'})
  }
  if(path.endsWith('/rpc/get_recurring_invoice_page'))return reply({items:state.recurringPlans,has_more:false,counts:{active:state.recurringPlans.filter(p=>p.status==='active').length,paused:state.recurringPlans.filter(p=>p.status==='paused').length,ended:0}})
  if(path.endsWith('/rpc/set_recurring_invoice_status')){state.recurringPlans.find(p=>p.id===body.p_plan).status=body.p_status;return reply(null)}
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
  if(path.endsWith('/change_orders'))return reply(state.changes.map(c=>{
   const change=c.p_revision?(c.p_revision.quantity*c.p_revision.unit_price-100)*1.05:20
   return {id:P,customer_id:C,job_id:null,estimate_id:c.p_kind==='estimate'?E:null,source_invoice_id:c.p_kind==='invoice'?E:null,title:c.p_input.title,status:'draft',total:Math.max(0,change),customers:[customer],jobs:[],change_totals:{current_total:105,change_amount:change,revised_total:105+change,deposit_paid:c.p_kind==='invoice'?25:0,other_paid:0,revision_subtotal:c.p_revision?change/1.05:null,revision_tax:c.p_revision?change-change/1.05:null}}
  }))
  if(path.endsWith('/customers')){if(method==='POST'){state.customers.push(body);return reply(body,201)}return reply(state.customers)}
  if(path.endsWith('/estimates')){const estimate={id:E,estimate_number:'EST-QA',customer_id:C,status:'accepted',issue_date:'2026-10-01',total:105,subtotal:100,tax_amount:5,customers:customer};return reply(url.searchParams.has('id')?estimate:[estimate])}
  if(path.endsWith('/estimate_items'))return reply([{id:P,description:'Mow and trim',quantity:2,unit_price:50,tax_rate:5,line_total:100}])
  if(path.endsWith('/jobs'))return reply([])
  return reply([])
 })
 return state
}

for(const width of [1440,390])test(`navigation returns to the previous workspace page at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await mock(page);await page.goto('/?view=dashboard')
 await page.locator(width>900?'.sidebar':'.mobile-nav').getByRole('button',{name:'More',exact:true}).click()
 await page.getByRole('dialog',{name:'More navigation'}).getByRole('link',{name:/^Customers/}).click();await expect(page.getByRole('heading',{name:'Everyone you work for, in one place.'})).toBeVisible()
 await page.getByRole('button',{name:'← Back',exact:true}).click();await expect(page.getByRole('heading',{name:business.name,exact:true})).toBeVisible()
 await page.locator(width>900?'.sidebar':'.mobile-nav').getByRole('button',{name:'More',exact:true}).click();await page.getByRole('dialog',{name:'More navigation'}).getByRole('link',{name:/^Company Profile/}).click()
 await expect(page.getByRole('heading',{name:'Company Profile',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Payment options',exact:true})).toHaveCount(0)
 await page.goBack();await expect(page.getByRole('heading',{name:business.name,exact:true})).toBeVisible()
})
for(const kind of ['invoice','estimate'])for(const width of [1440,390])test(`typed customer and ${kind} payment choices stay together at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const state=await mock(page);await page.goto('/?view='+kind+'s');await createWork(page, kind)
 await page.getByRole('button',{name:'Create a new customer',exact:true}).click()
 await page.getByLabel('Customer name',{exact:true}).fill('New Typed Customer')
 await page.getByPlaceholder('Description',{exact:true}).fill('Only this work');await page.getByPlaceholder('Unit price',{exact:true}).fill('250')
 await page.getByRole('button',{name:'Preview',exact:true}).click()
 await expect(page.getByRole('region',{name:kind==='invoice'?'Invoice PDF':'Estimate PDF',exact:true}).getByRole('button',{name:'Download PDF',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'Open saved draft',exact:true})).toBeEnabled();await expect.poll(()=>state.documents.length).toBe(1)
 const input=state.documents[0].payload;expect(input.new_customer.first_name).toBe('New');expect(input.new_customer.last_name).toBe('Typed Customer');expect(input.payment_links).toEqual([{provider:'stripe',url:'https://buy.stripe.com/owner-link'}]);expect(input.items[0].description).toBe('Only this work')
 expect(state.calls.filter(c=>c.path.endsWith('/customers')&&c.method==='POST')).toHaveLength(0)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
for(const kind of ['invoice','estimate'])test(`${kind} change order automatically uses the original document without selecting a job`,async({page})=>{
 const state=await mock(page);await page.goto('/?view='+kind+'s')
 if(kind==='invoice')await page.getByRole('button',{name:/^Open invoice INV-QA/}).click();else await page.getByRole('button',{name:/^Open estimate EST-QA/}).click()
 await page.getByRole('region',{name:'Record actions',exact:true}).locator('.record-more>summary').click();await page.getByRole('button',{name:kind==='invoice'?'New change order':'Create change order',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Create change order'});await expect(dialog.getByRole('region',{name:'Original document'})).toContainText('Test Customer');await expect(dialog.getByRole('region',{name:'Original document'})).toContainText('1 Test Street');await expect(dialog.getByLabel('Job',{exact:true})).toHaveCount(0)
 await dialog.getByPlaceholder('Description',{exact:true}).fill('Additional work only');await dialog.getByPlaceholder('Unit price',{exact:true}).fill('20')
 await dialog.getByRole('button',{name:'Save and review',exact:true}).click();await expect.poll(()=>state.changes.length).toBe(1)
 expect(state.changes[0].p_kind).toBe(kind);expect(state.changes[0].p_document).toBe(E);expect(state.changes[0].p_input.items[0].description).toBe('Additional work only');expect(state.changes[0].p_input).not.toHaveProperty('customer_id')
})
test('completed work has no new change-order action',async({page})=>{
 await mock(page,{completedWork:true});await page.goto('/?view=invoices');await page.getByRole('button',{name:/^Open invoice INV-QA/}).click();await expect(page.getByRole('heading',{name:'INV-QA',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Checking change order…',exact:true})).toHaveCount(0);await page.getByRole('region',{name:'Record actions',exact:true}).locator('.record-more>summary').click();await expect(page.getByRole('button',{name:'New change order',exact:true})).toHaveCount(0)
})
for(const width of [1440,390])test(`select a calendar date then use Add entry to save a manual event at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const state=await mock(page);await page.goto('/?view=dashboard');const calendar=page.getByRole('region',{name:'Work calendar'});await expect(calendar.getByLabel('Calendar date')).toHaveCount(0)
 const date=calendar.getByRole('group',{name:'Choose a day in the week'}).getByRole('button').first();await date.click();const dialog=page.getByRole('dialog',{name:'Add to your calendar'});await expect(dialog).toHaveCount(0);await calendar.getByRole('button',{name:'Add to calendar',exact:true}).click();await expect(dialog).toBeVisible();await dialog.getByLabel('Title',{exact:true}).fill('Pick up materials');await dialog.getByLabel('Details',{exact:true}).fill('Collect the order before the job');await expect(dialog.getByRole('button',{name:'Ask Fin'})).toBeDisabled()
 await dialog.getByRole('button',{name:'Add event',exact:true}).click();await expect.poll(()=>state.entries.length).toBe(1);expect(state.entries[0].notes).toBe('Collect the order before the job');expect(state.entries[0].assigned_user_id).toBe(U);await expect(dialog).toHaveCount(0)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
test('activated calendar AI opens the existing assistant with the selected date for review',async({page})=>{
 await mock(page,{ai:true});await page.goto('/?view=dashboard');await page.getByRole('button',{name:'Add to calendar',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Add to your calendar'});await dialog.getByLabel('Title',{exact:true}).fill('Mow the lawn');await dialog.getByRole('button',{name:'Ask Fin',exact:true}).click()
 const assistant=page.getByRole('dialog',{name:'Fin — your office assistant'});await expect(assistant).toBeVisible();await expect(assistant.getByLabel('Describe your invoice or request')).toHaveValue(/Help me complete the open “Add to your calendar” form[\s\S]*Title: Mow the lawn[\s\S]*Starts: \d{4}-\d{2}-\d{2}T09:00/);await expect(assistant.getByLabel('Describe your invoice or request')).toHaveValue(/not permission to save, create, send, delete, or change any record/)
})
for(const width of [1440,390])test(`owner reviews phone contact cards before importing at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const state=await mock(page);await page.goto('/?view=customers');await page.getByRole('button',{name:'Import customers',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Import customers'});const card=(name,email)=>'BEGIN:VCARD\nVERSION:3.0\nFN:'+name+'\nEMAIL:'+email+'\nEND:VCARD\n'
 await dialog.getByLabel('Contacts or customer file (.vcf or .csv)',{exact:true}).setInputFiles({name:'owner-contacts.vcf',mimeType:'text/vcard',buffer:Buffer.from(card('Business Customer','business@example.test')+card('Personal Contact','personal@example.test'))})
 await dialog.getByRole('checkbox',{name:/Personal Contact/}).uncheck();expect(state.imported).toHaveLength(0);await dialog.getByRole('button',{name:'Import selected contacts',exact:true}).click();await expect(dialog.getByRole('status').filter({hasText:'Import complete'})).toBeVisible();expect(state.imported).toHaveLength(1);expect(state.imported[0].email).toBe('business@example.test')
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
})
test('non-owner cannot see bulk phone contact import',async({page})=>{await mock(page,{owner:false});await page.goto('/?view=customers');await expect(page.getByRole('button',{name:'Import customers',exact:true})).toHaveCount(0)})

for(const width of [1440,390])test(`selected-day agenda shows every job, local reminders, and connected events at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1050});await mock(page)
 const day=DateTime.now().setZone(zone).startOf('day'),tomorrow=day.plus({days:1})
 let notes='Bring cedar boards, screws, and the approved plan',externalCalls=0,trackingRequests=0
 const externalRanges=[]
 await page.route('https://calendar-tracker.invalid/**',route=>{trackingRequests++;return route.abort()})
 const jobs=Array.from({length:5},(_,n)=>({source_key:'job:day-'+n,title:'Day job '+n,job_id:J,starts_at:day.plus({hours:9+n}).toISO(),ends_at:day.plus({hours:10+n}).toISO(),status:'scheduled',document_kind:'work',document_id:J,assigned_user_ids:[U]}))
 jobs.push({source_key:'job:tomorrow',title:'Tomorrow job',job_id:J,starts_at:tomorrow.plus({hours:9}).toISO(),ends_at:tomorrow.plus({hours:10}).toISO(),status:'scheduled',document_kind:'work',document_id:J,assigned_user_ids:[U]})
 const reminders=[{id:'r1',note:'Order cedar',due_at:day.plus({hours:8}).toISO(),job_id:null,status:'pending'},{id:'r2',note:'Confirm access',due_at:day.plus({hours:10}).toISO(),job_id:null,status:'completed'},{id:'r3',note:'Previous-day reminder',due_at:day.minus({minutes:1}).toISO(),job_id:null,status:'pending'},{id:'r4',note:'Next-day reminder',due_at:tomorrow.toISO(),job_id:null,status:'pending'}]
 const base={provider:'google',email:'owner.other@example.test',calendar_name:'Personal',description:'<img src="https://calendar-tracker.invalid/pixel" onerror="window.calendarInjected=true"><script>window.calendarInjected=true</script><p>Bring the sample finishes</p>',location:'22 Harbor Road',url:'https://calendar.google.com/calendar/event?eid=qa',all_day:false}
 const events=[{...base,id:'external',title:'Supplier appointment',starts_at:day.plus({hours:16}).toISO(),ends_at:day.plus({hours:17}).toISO()},{...base,id:'outlook',provider:'outlook',title:'Outlook delivery',starts_at:day.plus({hours:14}).toISO(),ends_at:day.plus({hours:15}).toISO(),url:'https://outlook.office.com/calendar/item/qa'},{...base,id:'all-day',title:'Trade show',all_day:true,start_date:day.toISODate(),end_date:tomorrow.toISODate(),starts_at:day.toISO(),ends_at:tomorrow.toISO()},{...base,id:'tomorrow',title:'Tomorrow external meeting',starts_at:tomorrow.plus({hours:12}).toISO(),ends_at:tomorrow.plus({hours:13}).toISO()}]
 const reply=(route,value)=>route.fulfill({contentType:'application/json',headers:{'access-control-expose-headers':'content-range','content-range':Array.isArray(value)?`0-${Math.max(0,value.length-1)}/${value.length}`:'0-0/0'},body:JSON.stringify(value)})
 await page.route('**/rest/v1/calendar_work?**',route=>reply(route,jobs))
 await page.route('**/rest/v1/reminders?**',route=>{if(route.request().method()==='PATCH'){const r=reminders.find(row=>new URL(route.request().url()).searchParams.get('id')==='eq.'+row.id);r.status='completed';return reply(route,{id:r.id})}return reply(route,reminders)})
 await page.route('**/rest/v1/jobs?**',route=>{if(route.request().method()==='PATCH'){notes=route.request().postDataJSON().description;return reply(route,{id:J})}const job={id:J,title:'Day job 0',description:notes,status:'scheduled',scheduled_start:jobs[0].starts_at,scheduled_end:jobs[0].ends_at,assigned_user_ids:[U],customers:customer,properties:[{address_line1:'1 Test Street',city:'Chesapeake',state:'VA',postal_code:'23322'}]};return reply(route,route.request().headers().accept?.includes('vnd.pgrst.object')?job:[job])})
 await page.route('**/rest/v1/rpc/get_job_workflow_context',route=>reply(route,[{job_id:J,active_appointment:{id:P,status:'scheduled',starts_at:jobs[0].starts_at,ends_at:jobs[0].ends_at},invoice:null}]))
 await page.route('**/api/calendar?**',route=>{externalCalls++;const params=new URL(route.request().url()).searchParams;externalRanges.push({startDay:params.get('startDay'),endDay:params.get('endDay')});return reply(route,{events,issues:[],connections:2})})
 await page.goto('/?view=dashboard');const calendar=page.getByRole('region',{name:'Work calendar'})
 await expect(calendar.locator('a.calendar-event')).toHaveCount(5)
 await expect(calendar).toContainText('1 Test Street, Chesapeake, VA 23322');await expect(calendar).toContainText(notes)
 await expect(calendar.getByText('Order cedar',{exact:true})).toBeVisible();await expect(calendar.getByText('Confirm access',{exact:true})).toBeVisible()
 await expect(calendar.getByRole('button',{name:'Complete Confirm access'})).toHaveCount(0)
 await expect(calendar.getByText('Previous-day reminder',{exact:true})).toHaveCount(0);await expect(calendar.getByText('Next-day reminder',{exact:true})).toHaveCount(0)
 await expect(calendar.getByText('Supplier appointment',{exact:true})).toBeVisible();await expect(calendar.getByText('Outlook delivery',{exact:true})).toBeVisible();await expect(calendar.getByText('Trade show',{exact:true})).toBeVisible()
 await expect(calendar).toContainText('22 Harbor Road');await expect(calendar).toContainText('owner.other@example.test');await expect(calendar.getByText('Tomorrow external meeting',{exact:true})).toHaveCount(0)
 await calendar.getByRole('button',{name:'Complete Order cedar',exact:true}).click();await expect(calendar.getByRole('button',{name:'Complete Order cedar',exact:true})).toHaveCount(0)
 await calendar.locator('a.calendar-event').first().click();const dialog=page.getByRole('dialog',{name:'Job details'});await expect(dialog).toContainText('1 Test Street');await dialog.getByLabel('Job notes and materials needed').fill('Bring the updated material list');await dialog.getByRole('button',{name:'Save job details'}).click();await expect(dialog.getByRole('status')).toContainText('Job details saved');await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(calendar).toContainText('Bring the updated material list')
 await calendar.getByRole('button',{name:'Month',exact:true}).click();await expect(calendar.getByText('Supplier appointment',{exact:true})).toBeVisible()
 const before=externalCalls;await calendar.getByRole('button',{name:new RegExp(tomorrow.toLocaleString(DateTime.DATE_FULL))}).click()
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(calendar.locator('a.calendar-event')).toHaveCount(1);await expect(calendar.getByText('Tomorrow job',{exact:true})).toBeVisible();await expect(calendar.getByText('Next-day reminder',{exact:true})).toBeVisible();await expect(calendar.getByText('Tomorrow external meeting',{exact:true})).toBeVisible();await expect(calendar.getByText('Trade show',{exact:true})).toHaveCount(0);await expect(calendar.getByText('Order cedar',{exact:true})).toHaveCount(0)
 // Parallel browser contexts can legitimately focus this window and refresh it.
 // Day selection must retain the loaded month range. Exact no-refetch behavior
 // and the separate focus refresh are asserted in home-layout-dom.mjs.
 for(const requested of externalRanges.slice(before))expect(requested).toEqual({startDay:day.startOf('month').startOf('week').toISODate(),endDay:day.endOf('month').startOf('week').plus({weeks:1}).toISODate()})
 await calendar.getByRole('button',{name:new RegExp(day.toLocaleString(DateTime.DATE_FULL))}).click();await calendar.getByRole('button',{name:'Week',exact:true}).click()
 await expect(calendar.getByText('Supplier appointment',{exact:true})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 expect(trackingRequests).toBe(0);expect(await page.evaluate(()=>window.calendarInjected)).toBeUndefined();await expect(calendar.getByText('Bring the sample finishes',{exact:true})).toHaveCount(3)
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`test-results/selected-day-agenda-${width}.png`,fullPage:true})
})
test('connected calendar failure keeps local work usable and retry restores only current-day events',async({page})=>{
 const state=await mock(page);let fail=true
 const start=DateTime.now().setZone(zone).set({hour:9,minute:0});state.entries.push({id:J,title:'Local visit',starts_at:start.toISO(),ends_at:start.plus({hours:1}).toISO()})
 await page.route('**/api/calendar?**',route=>route.fulfill({status:fail?503:200,contentType:'application/json',body:JSON.stringify(fail?{error:'provider_rate_limited'}:{events:[],issues:[],connections:1})}))
 await page.goto('/?view=dashboard');const calendar=page.getByRole('region',{name:'Work calendar'})
 await expect(calendar.getByText('Local visit',{exact:true})).toBeVisible();await expect(calendar).toContainText('Your calendar provider is busy')
 fail=false;await calendar.getByRole('button',{name:'Retry connected calendars'}).click();await expect(calendar).toContainText('No connected-calendar events for this day.');await expect(calendar.getByText('Local visit',{exact:true})).toBeVisible()
})
test('viewer selects dates with the keyboard and sees that day without creation controls',async({page})=>{
 const state=await mock(page);const start=DateTime.now().setZone(zone).startOf('week').plus({hours:9})
 state.entries.push({id:J,title:'Read-only scheduled visit',starts_at:start.toISO(),ends_at:start.plus({hours:1}).toISO()})
 await page.route('**/rest/v1/business_members?**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({business_id:B,role:'viewer',access_modules:['calendar','jobs','billing','finances'],businesses:business})}))
 await page.route('**/api/calendar?**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({events:[],issues:[],connections:0})}))
 await page.goto('/?view=dashboard');const calendar=page.getByRole('region',{name:'Work calendar'}),date=calendar.getByRole('group',{name:'Choose a day in the week'}).getByRole('button').first()
 await date.focus();await page.keyboard.press('Enter');await expect(date).toHaveAttribute('aria-pressed','true');await expect(calendar.getByText('Read-only scheduled visit',{exact:true})).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(calendar.getByRole('button',{name:'Add to calendar'})).toHaveCount(0)
})

for (const [quantity, difference, revised] of [['3','+$52.50','$157.50'],['1','-$52.50','$52.50'],['2','$0.00','$105.00']]) {
 test(`changing an original invoice item to quantity ${quantity} shows and saves the revised agreement`, async ({ page }) => {
  const state = await mock(page)
  let savedPdf
  await page.route('**/functions/v1/document-pdf', async route => {
   if(route.request().method()==='OPTIONS')return route.fulfill({headers:pdfHeaders,body:''})
   const request=route.request().postDataJSON()
   if(request.document_kind!=='change_order')return route.fallback()
   expect(request).toEqual({business_id:B,document_kind:'change_order',document_id:P})
   expect(state.changes).toHaveLength(1)
   const change=state.changes[0],subtotal=change.p_revision.quantity*change.p_revision.unit_price-100,tax=subtotal*0.05
   savedPdf=Buffer.from(await generateDocumentPdf({kind:'change_order',number:'CO-QA',status:'draft',issue_date:'2026-11-07',
    customer:{name:'Test Customer'},company:{name:'Scheduling QA'},title:change.p_input.title,
    subtotal,tax_amount:tax,total:subtotal+tax,
    change_totals:{current_total:105,change_amount:subtotal+tax,revised_total:105+subtotal+tax,deposit_paid:25,other_paid:0,revision_subtotal:subtotal,revision_tax:tax},
    items:[{description:change.p_revision.description,quantity:1,unit_price:0,line_total:0,tax_rate:5}]}))
   return route.fulfill({status:200,headers:pdfHeaders,body:savedPdf})
  })
  await page.goto('/?view=invoices')
  await page.getByRole('button', { name: /^Open invoice INV-QA/ }).click()
  await page.getByRole('region',{name:'Record actions',exact:true}).locator('.record-more>summary').click();await page.getByRole('button', { name: 'New change order', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create change order' })
  await dialog.getByLabel('Current item').selectOption(P)
  await expect(dialog.getByLabel('Revised quantity')).toHaveValue('2')
  await expect(dialog.getByLabel('Revised unit price')).toHaveValue('50')
  await dialog.getByLabel('Revised description').fill('Updated work')
  await dialog.getByLabel('Revised quantity').fill(quantity)
  const totals = dialog.locator('.change-order-totals')
  await expect(totals.locator('dd')).toHaveText(['$105.00', difference, revised, '$25.00', quantity==='3'?'$132.50':quantity==='1'?'$27.50':'$80.00'])
  await dialog.getByRole('button', { name: 'Save and review' }).click()
  await expect.poll(() => state.changes.length).toBe(1)
  expect(state.changes[0].p_revision).toMatchObject({ id: P, description: 'Updated work', quantity: Number(quantity), unit_price: 50 })
  expect(state.changes[0].p_input).toMatchObject({ items: [], expected_current_total: 105 })
  // The saved review uses the canonical PDF, not the closing editor's totals.
  // Waiting for that handoff prevents a transient editor from passing this check.
  await expect(dialog).toHaveCount(0)
  const review=page.getByRole('dialog',{name:'Review change order',exact:true})
  const pdf=review.getByRole('region',{name:'Change order PDF',exact:true})
  await expect(pdf.getByRole('button',{name:'Download PDF',exact:true})).toBeEnabled()
  await expect(pdf.locator('iframe')).toHaveAttribute('src',/^blob:/)
  const downloading=page.waitForEvent('download')
  await pdf.getByRole('button',{name:'Download PDF',exact:true}).click()
  const file=await (await downloading).path()
  expect(await readFile(file)).toEqual(savedPdf)
  const text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'})
  for(const amount of ['$105.00',difference,revised,'$25.00',quantity==='3'?'$132.50':quantity==='1'?'$27.50':'$80.00'])expect(text).toContain(amount)
  for(const label of ['Current total','This change','Revised total','Deposit paid','Remaining if approved'])expect(text).toContain(label)
  expect(state.changes).toHaveLength(1)
  expect(state.calls.some(call=>/send-document|send-invoice/.test(call.path))).toBe(false)
 })
}

test('a customer sees and approves the same revised total shown in the change order', async ({ page }) => {
 const state=await mock(page, { signedIn: false })
 const token='a'.repeat(64),decisions=[]
 const snapshot={kind:'change_order',number:'CO-QA',status:'sent',issue_date:'2026-11-07',revision_id:PDF_REVISION,revision_number:1,revision_created_at:'2026-11-07T12:00:00Z',customer:{name:'Test Customer'},company:{name:'Scheduling QA'},title:'Reduce original scope',schedule_impact_days:0,subtotal:-50,tax_amount:-2.50,total:-52.50,
  change_totals:{current_total:105,change_amount:-52.50,revised_total:52.50,deposit_paid:25,other_paid:0,revision_subtotal:-50,revision_tax:-2.50},
  items:[{description:'Original work → Revised work',quantity:1,unit_price:0,line_total:0,tax_rate:5}]}
 const bytes=Buffer.from(await generateDocumentPdf(snapshot))
 await page.route('**/functions/v1/document-pdf',route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({headers:pdfHeaders,body:''})
  expect(route.request().postDataJSON()).toEqual({token,token_type:'approval'})
  expect(route.request().headers().authorization).toBeUndefined()
  return route.fulfill({status:200,headers:pdfHeaders,body:bytes})
 })
 await page.route('**/functions/v1/customer-approval', async route => {
  if(route.request().method()==='OPTIONS')return route.fulfill({headers:pdfHeaders,body:''})
  const request=route.request().postDataJSON()
  if(request.mode==='approved'){
   expect(request).toMatchObject({token,typed_name:'Test Customer',terms_agreed:true,expected_revision_id:PDF_REVISION})
   decisions.push(request)
  }
  await route.fulfill({json:{document_type:'change_order',business_name:'Scheduling QA',customer:{first_name:'Test',last_name:'Customer'},document:{change_order_number:snapshot.number,change_totals:snapshot.change_totals},action_state:'available',
   completed:decisions.length?{action:'approved',typed_name:'Test Customer',amount:52.50,created_at:new Date().toISOString()}:null}})
 })
 await page.goto('/?approval='+token)
 const pdf=page.getByRole('region',{name:'Change order CO-QA',exact:true})
 await expect(pdf.getByRole('button',{name:'Download PDF',exact:true})).toBeEnabled()
 await expect(pdf.locator('iframe')).toHaveAttribute('src',/^blob:/)
 async function verifyIssuedCopy(){
  const downloading=page.waitForEvent('download');await pdf.getByRole('button',{name:'Download PDF',exact:true}).click()
  const file=await (await downloading).path();expect(await readFile(file)).toEqual(bytes)
  const text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'})
  for(const amount of ['$105.00','-$52.50','$52.50','$25.00','$27.50','-$50.00'])expect(text).toContain(amount)
  for(const label of ['Current total','This change','Revised total','Deposit paid','Remaining if approved'])expect(text).toContain(label)
 }
 await verifyIssuedCopy()
 const approve=page.getByRole('button',{name:'Approve change order and agree to terms',exact:true})
 await expect(approve).toBeDisabled()
 await page.getByLabel('Full name',{exact:true}).fill('Test Customer')
 await page.getByRole('checkbox',{name:/I reviewed the displayed change order/}).check()
 await approve.click()
 await expect(page.getByRole('heading',{name:'Change order approved',exact:true})).toBeVisible()
 expect(decisions).toHaveLength(1)
 await verifyIssuedCopy()
 expect(state.calls.some(call=>call.path.includes('/auth/v1/'))).toBe(false)
})


for(const width of [1440,390])test(`owner recurring invoice setup and pause remain review-first at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const state=await mock(page,{recurring:true});await page.goto('/?view=invoices&document='+E)
 await page.getByRole('region',{name:'Record actions',exact:true}).locator('summary').click()
 await page.getByRole('button',{name:'Repeat invoice',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Repeat invoice',exact:true})
 await expect(dialog).toBeVisible();await expect(dialog.getByText('Nothing is sent to the customer or charged automatically.',{exact:false})).toBeVisible()
 await expect(dialog.getByRole('checkbox')).toHaveCount(0)
 await dialog.getByLabel('Schedule name',{exact:true}).fill('Monthly service')
 await dialog.getByRole('button',{name:'Create recurring schedule',exact:true}).click()
 await expect(dialog.getByRole('status')).toContainText('Schedule created')
 await expect.poll(()=>state.recurringPlans.length).toBe(1)
 await dialog.getByRole('button',{name:'Close',exact:true}).click()
 await page.getByRole('button',{name:'← Invoices',exact:true}).click()
 await page.getByRole('button',{name:'Create invoice',exact:true}).click()
 await page.getByRole('button',{name:'Manage existing schedules',exact:true}).click()
 const schedules=page.getByRole('dialog',{name:'Recurring invoices',exact:true})
 await expect(schedules.getByRole('heading',{name:'Monthly service'})).toBeVisible()
 page.once('dialog',d=>d.dismiss());await schedules.getByRole('button',{name:'Pause schedule'}).click();expect(state.recurringPlans[0].status).toBe('active')
 page.once('dialog',d=>d.accept());await schedules.getByRole('button',{name:'Pause schedule'}).click();await expect(schedules.getByRole('button',{name:'Resume schedule'})).toBeVisible()
 page.once('dialog',d=>d.accept());await schedules.getByRole('button',{name:'Resume schedule'}).click();await expect(schedules.getByRole('button',{name:'Pause schedule'})).toBeVisible()
 expect(state.calls.filter(c=>/create_recurring_invoice$/.test(c.path))).toHaveLength(1)
 expect(state.calls.some(c=>/send-document|send-invoice|charge|reserve_ai/.test(c.path))).toBe(false)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
})
for(const width of [1440,390])test(`office users have no recurring owner controls at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const state=await mock(page,{recurring:true,owner:false});await page.goto('/?view=invoices&recurring=1')
 await expect(page.getByRole('heading',{name:'Invoices',exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'Recurring invoices',exact:true})).toHaveCount(0)
 await expect(page.getByRole('dialog',{name:'Recurring invoices',exact:true})).toHaveCount(0)
 expect(state.calls.some(c=>/get_recurring_invoice_page/.test(c.path))).toBe(false)
})

for(const width of [390,1440])test(`invoice creation card hands recurring drafts to explicit schedule review at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const state=await mock(page,{recurring:true});await page.goto('/?view=invoices')
 const summary=page.getByRole('region',{name:'Invoice summary',exact:true})
 await expect(summary.getByRole('button',{name:/^Overdue/})).toHaveCount(0)
 await expect(page.getByRole('button',{name:'Recurring invoices',exact:true})).toHaveCount(0)
 const create=summary.getByRole('button',{name:'Create invoice',exact:true});await expect(create).toBeInViewport()
 const outstanding=await summary.getByRole('button',{name:/Total Outstanding/}).boundingBox(),action=await create.boundingBox();expect(Math.abs(outstanding.y-action.y)).toBeLessThan(2)
 await create.click();const form=page.getByRole('dialog',{name:'Create an invoice',exact:true})
 const repeat=form.getByRole('checkbox',{name:'Make this a recurring invoice',exact:true});await expect(repeat).not.toBeChecked();await repeat.check()
 expect(state.recurringPlans).toHaveLength(0)
 await form.getByRole('button',{name:'Create a new customer',exact:true}).click();await form.getByLabel('Customer name',{exact:true}).fill('Synthetic Customer')
 await form.getByLabel('Line 1 description',{exact:true}).fill('Monthly maintenance');await form.getByLabel('Line 1 unit price',{exact:true}).fill('250')
 await form.getByRole('button',{name:'Save Draft',exact:true}).click()
 const schedule=page.getByRole('dialog',{name:'Repeat invoice',exact:true});await expect(schedule).toBeVisible()
 expect(state.documents).toHaveLength(1);expect(state.recurringPlans).toHaveLength(0)
 await schedule.getByRole('button',{name:'Create recurring schedule',exact:true}).click();await expect(schedule.getByRole('status')).toContainText('Schedule created')
 expect(state.recurringPlans).toHaveLength(1);expect(state.recurringPlans[0].source_invoice_id).toBe(E)
 expect(state.calls.some(c=>/send-document|send-invoice|charge/.test(c.path))).toBe(false)
})
