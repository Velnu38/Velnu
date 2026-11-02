import {test,expect} from '@playwright/test'
import {DateTime} from 'luxon'

// Browser fixtures only: all authentication, database and delivery calls are intercepted.
const B='11111111-1111-4111-8111-111111111111',U='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',E='44444444-4444-4444-8444-444444444444',P='55555555-5555-4555-8555-555555555555',J='66666666-6666-4666-8666-666666666666'
const zone='America/New_York',user={id:U,email:'owner@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}
const business={id:B,name:'Scheduling QA',created_by_user_id:U,timezone:zone,profile_completed_at:'2026-10-01T00:00:00Z',document_accent:'#2563eb'}
const customer={id:C,first_name:'Test',last_name:'Customer',company:null,email:'customer@example.test'}
const team=[{id:U,label:'Owner',role:'owner',is_you:true},{id:J,label:'Field worker',role:'technician',is_you:false}]
const slots=Array.from({length:3},(_,n)=>({id:`77777777-7777-4777-8777-${String(n+1).padStart(12,'0')}`,starts_at:DateTime.now().setZone(zone).plus({days:14+n}).set({hour:9,minute:0,second:0,millisecond:0}).toISO(),ends_at:DateTime.now().setZone(zone).plus({days:14+n}).set({hour:11,minute:0,second:0,millisecond:0}).toISO()}))
async function mock(page,{signedIn=true,conflict=false,completedWork=false,ai=false,owner=true}={}){
 const state={calls:[],booked:false,approved:false,customers:[customer],completed:false,documents:[],entries:[],changes:[],imported:[]}
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
  if(path.endsWith('/business_members'))return reply({business_id:B,role:owner?'owner':'office',access_modules:['calendar','jobs','billing','finances'],businesses:business})
  if(path.endsWith('/business_settings'))return reply({default_tax_rate:0,pricing_adjustment_percent:0,payment_links:[],payment_instructions:''})
  if(path.endsWith('/rpc/get_document_change_context'))return reply({business_id:B,document_id:body.p_document,kind:body.p_kind,number:body.p_kind==='invoice'?'INV-QA':'EST-QA',customer_id:C,customer_name:'Test Customer',job_id:null,estimate_id:body.p_kind==='estimate'?E:null,work_status:completedWork?'completed':'unscheduled',can_change:!completedWork,total:105,address:'1 Test Street',items:[{description:'Original work',quantity:2,unit_price:50,tax_rate:5}]})
  if(path.endsWith('/rpc/create_document_change_order')){state.changes.push(body);return reply({id:P,status:'draft',total:20})}
  if(path.endsWith('/rpc/create_document')){state.documents.push(body);return reply({id:E,status:'draft',total:250})}
  if(path.endsWith('/rpc/import_customer_contacts')){state.imported.push(...body.p_contacts);return reply({imported:body.p_contacts.length,skipped:0,already_imported:0})}
  if(path.endsWith('/appointments')){if(method==='POST'){const entry={...body,updated_at:new Date().toISOString()};state.entries.push(entry);return reply(entry,201)}return reply([])}
  if(path.endsWith('/calendar_work'))return reply(state.entries.map(e=>({source_key:'appointment:'+e.id,title:e.title,starts_at:e.starts_at,ends_at:e.ends_at,status:'scheduled',document_kind:'work',document_id:e.id,job_id:null,assigned_user_ids:[U]})))
  if(path.endsWith('/functions/v1/transcribe-voice'))return reply({configured:false})
  if(path.endsWith('/rpc/get_plan_usage'))return reply({plan:ai?'pro':'free',ai_limit:ai?100:0,ai_used:0,voice_limit:ai?100:0})
  if(path.endsWith('/rpc/get_schedule_team'))return reply(team)
  if(path.endsWith('/rpc/get_workflow_next_actions'))return reply({approved:state.booked?[]:[{id:E,estimate_number:'EST-QA',customer_name:'Test Customer',offer:state.approved?{status:'approved',expires_at:'2099-01-01'}:null}],completed:[]})
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
  if(path.endsWith('/customers')){if(method==='POST'){state.customers.push(body);return reply(body,201)}return reply(state.customers)}
  if(path.endsWith('/estimates'))return reply([{id:E,estimate_number:'EST-QA',customer_id:C,status:'accepted',issue_date:'2026-10-01',total:105,subtotal:100,tax_amount:5,customers:customer}])
  if(path.endsWith('/estimate_items'))return reply([{id:P,description:'Mow and trim',quantity:2,unit_price:50,tax_rate:5,line_total:100}])
  if(path.endsWith('/jobs'))return reply([])
  return reply([])
 })
 return state
}

for(const width of [1440,390])test(`navigation returns to the previous workspace page at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await mock(page);await page.goto('/')
 await page.getByRole('button',{name:'Customers',exact:true}).click();await expect(page.getByRole('heading',{name:'Everyone you work for, in one place.'})).toBeVisible()
 await page.getByRole('button',{name:'← Back',exact:true}).click();await expect(page.getByRole('region',{name:'Guided next steps'})).toBeVisible()
 if(width===390){await page.getByRole('button',{name:'More',exact:true}).click();await expect(page.getByRole('button',{name:'Change Orders',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Settings',exact:true}).click()}else await page.getByRole('button',{name:'Settings',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Payment options',exact:true})).toHaveCount(0)
 await page.goBack();await expect(page.getByRole('region',{name:'Guided next steps'})).toBeVisible()
})
for(const kind of ['invoice','estimate'])for(const width of [1440,390])test(`typed customer and ${kind} payment choices stay together at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const state=await mock(page);await page.goto('/?view='+kind+'s');await page.getByRole('button',{name:'+ New '+kind,exact:true}).click()
 await page.getByLabel('Customer name',{exact:true}).fill('New Typed Customer')
 await page.getByPlaceholder('Description',{exact:true}).fill('Only this work');await page.getByPlaceholder('Unit price',{exact:true}).fill('250')
 await page.getByText('How customers can pay',{exact:true}).click();await page.getByRole('checkbox',{name:'Stripe',exact:true}).check();await page.getByLabel('Stripe payment link',{exact:true}).fill('https://buy.stripe.com/owner-link');await page.getByLabel('Payment instructions',{exact:true}).fill('Use your invoice number')
 await page.getByRole('button',{name:'Create '+kind,exact:true}).click();await expect.poll(()=>state.documents.length).toBe(1)
 const input=state.documents[0].payload;expect(input.new_customer.first_name).toBe('New');expect(input.new_customer.last_name).toBe('Typed Customer');expect(input.payment_links).toEqual([{provider:'stripe',url:'https://buy.stripe.com/owner-link'}]);expect(input.items[0].description).toBe('Only this work')
 expect(state.calls.filter(c=>c.path.endsWith('/customers')&&c.method==='POST')).toHaveLength(0)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
for(const kind of ['invoice','estimate'])test(`${kind} change order automatically uses the original document without selecting a job`,async({page})=>{
 const state=await mock(page);await page.goto('/?view='+kind+'s')
 if(kind==='invoice')await page.locator('.invoice-open').first().click();else await page.getByRole('button',{name:/Preview/}).first().click()
 await page.getByRole('button',{name:'Change order',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Create change order'});await expect(dialog.getByRole('region',{name:'Original document'})).toContainText('Test Customer');await expect(dialog.getByRole('region',{name:'Original document'})).toContainText('1 Test Street');await expect(dialog.getByLabel('Job',{exact:true})).toHaveCount(0)
 await dialog.getByPlaceholder('Description',{exact:true}).fill('Additional work only');await dialog.getByPlaceholder('Unit price',{exact:true}).fill('20')
 await dialog.getByRole('button',{name:'Create change order',exact:true}).click();await expect.poll(()=>state.changes.length).toBe(1)
 expect(state.changes[0].p_kind).toBe(kind);expect(state.changes[0].p_document).toBe(E);expect(state.changes[0].p_input.items[0].description).toBe('Additional work only');expect(state.changes[0].p_input).not.toHaveProperty('customer_id')
})
test('completed work has no new change-order action',async({page})=>{
 await mock(page,{completedWork:true});await page.goto('/?view=invoices');await page.locator('.invoice-open').first().click();await expect(page.getByRole('button',{name:'Change order',exact:true})).toHaveCount(0)
})
for(const width of [1440,390])test(`click a calendar date and save a manual event at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const state=await mock(page);await page.goto('/');const calendar=page.getByRole('region',{name:'Work calendar'});await expect(calendar.getByLabel('Calendar date')).toHaveCount(0)
 const date=calendar.getByRole('group',{name:'Choose a day in the week'}).getByRole('button').first();await date.click();const dialog=page.getByRole('dialog',{name:'Add to your calendar'});await expect(dialog).toBeVisible();await dialog.getByLabel('Title',{exact:true}).fill('Pick up materials');await dialog.getByLabel('Details',{exact:true}).fill('Collect the order before the job');await expect(dialog.getByRole('button',{name:'Use OpenAI assistant'})).toBeDisabled()
 await dialog.getByRole('button',{name:'Add event',exact:true}).click();await expect.poll(()=>state.entries.length).toBe(1);expect(state.entries[0].notes).toBe('Collect the order before the job');expect(state.entries[0].assigned_user_id).toBe(U);await expect(dialog).toHaveCount(0)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
test('activated calendar AI opens the existing assistant with the selected date for review',async({page})=>{
 await mock(page,{ai:true});await page.goto('/');await page.getByRole('button',{name:'+ Add entry',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Add to your calendar'});await dialog.getByLabel('Title',{exact:true}).fill('Mow the lawn');await dialog.getByRole('button',{name:'Use OpenAI assistant',exact:true}).click()
 await expect(page.locator('.assistant-panel')).toBeVisible();await expect(page.locator('.assistant-panel textarea')).toHaveValue(/Schedule a job on \d{4}-\d{2}-\d{2} in America\/New_York.*Mow the lawn/)
})
for(const width of [1440,390])test(`owner reviews phone contact cards before importing at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const state=await mock(page);await page.goto('/?view=customers');await page.getByRole('button',{name:'Import contacts',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Import phone contacts'});const card=(name,email)=>'BEGIN:VCARD\nVERSION:3.0\nFN:'+name+'\nEMAIL:'+email+'\nEND:VCARD\n'
 await dialog.getByLabel('Contacts file (.vcf)',{exact:true}).setInputFiles({name:'owner-contacts.vcf',mimeType:'text/vcard',buffer:Buffer.from(card('Business Customer','business@example.test')+card('Personal Contact','personal@example.test'))})
 await dialog.getByRole('checkbox',{name:/Personal Contact/}).uncheck();expect(state.imported).toHaveLength(0);await dialog.getByRole('button',{name:'Import selected contacts',exact:true}).click();await expect(dialog.getByRole('status').filter({hasText:'Import complete'})).toBeVisible();expect(state.imported).toHaveLength(1);expect(state.imported[0].email).toBe('business@example.test')
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
})
test('non-owner cannot see bulk phone contact import',async({page})=>{await mock(page,{owner:false});await page.goto('/?view=customers');await expect(page.getByRole('button',{name:'Import contacts',exact:true})).toHaveCount(0)})
