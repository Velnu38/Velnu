import {test,expect} from '@playwright/test'
import {mock,B,C,E} from './audit-fixture.mjs'
import {readFile} from 'node:fs/promises'
import {PDF_BYTES,PDF_REVISION} from './document-pdf-fixture.mjs'
async function openSavedDelivery(page){
 await page.getByRole('region',{name:'Record actions',exact:true}).locator('summary').filter({hasText:'More'}).click()
 await page.getByRole('button',{name:'Send invoice copy',exact:true}).click()
}
async function setup(page,{tier='pro',canTest=true,ready=false,managed=false}={}){
 const base=await mock(page,{ai:true});base.customers[0]={...base.customers[0],phone:'+17575550123'};const state={tier,testing:false,saves:[],sent:[],shares:0,prepared:[],appointmentReminders:false,documents:base.documents,calls:base.calls}
 const usage=()=>({plan:state.tier,actual_plan:'pro',testing:state.testing,can_test:canTest,introductory:state.tier==='free',period_end:'2026-12-01',customers_used:1,customers_limit:state.tier==='free'?10:null,jobs_used:0,jobs_limit:state.tier==='free'?5:null,seats_used:1,seats_limit:state.tier==='pro'?5:1,ai_used:0,ai_limit:state.tier==='free'?20:state.tier==='basic'?150:600,voice_used:0,voice_limit:state.tier==='free'?10:state.tier==='basic'?60:180,email_used:0,email_limit:state.tier==='pro'?2000:0,sms_used:0,sms_limit:state.tier==='pro'?200:0})
 const delivery=()=>({plan:state.tier,email:'owner@example.test',phone:'+17575550100',personal_email_ready:ready,personal_sms_ready:ready,managed_email_ready:managed,managed_sms_ready:false,acknowledged:ready,reply_to:null,sms_reply_route:null})
 const snap={kind:'invoice',number:'INV-QA',status:'draft',issue_date:'2026-11-06',total:105,subtotal:100,tax_amount:5,amount_paid:0,balance_due:105,company:{name:'Scheduling QA',email:'owner@example.test'},customer:{name:'Test Customer',email:'customer@example.test',phone:'+17575550123'},items:[{description:'Original work',quantity:2,unit_price:50,line_total:100}],payment_links:[],finviant_branding:state.tier==='free'}
 await page.route('https://example.supabase.co/rest/v1/rpc/**',async route=>{const path=new URL(route.request().url()).pathname.split('/').pop(),body=route.request().postDataJSON(),reply=x=>route.fulfill({contentType:'application/json',body:JSON.stringify(x)})
 if(path==='get_plan_usage')return reply(usage())
 if(path==='set_tier_test'){state.tier=body.p_tier||'pro';state.testing=!!body.p_tier;return reply(usage())}
 if(path==='get_delivery_setup')return reply(delivery())
 if(path==='save_delivery_setup'){state.saves.push(body);ready=true;return reply(delivery())}
 if(path==='get_delivery_automation')return reply({plan:state.tier,ready:false,rule:{enabled:false,after_days:3,repeat_days:7,max_reminders:3},tasks:[]})
 if(path==='get_business_storage_usage'){const limit=state.tier==='free'?100000000:state.tier==='basic'?2000000000:10000000000;return reply({plan:state.tier,used_bytes:0,limit_bytes:limit,remaining_bytes:limit,pending_bytes:0,file_count:0,logo_allowed:state.tier!=='free',warning:'none'})}
 if(path==='prepare_personal_document'){
  const saved=base.savedDocuments[body.p_kind]
  const snapshot=saved?{...snap,kind:body.p_kind,number:saved[body.p_kind+'_number'],items:saved.items,subtotal:saved.subtotal,tax_amount:saved.tax_amount,total:saved.total,balance_due:saved.balance_due,customer:{name:'Test Customer',email:saved.customers.email,phone:saved.customers.phone}}:snap
  state.shares++;state.prepared.push({request:body,snapshot});return reply({snapshot:{...snapshot,revision_id:PDF_REVISION},expires_at:'2026-12-06'})
 }
 if(path==='release_personal_approval')return reply(null)
 if(path==='confirm_personal_document_sent'){state.sent.push(body);return reply(null)}
 if(path==='get_shared_document')return reply({...snap,expires_at:'2026-12-06'})
 return route.fallback()
 });return state
}
test('owner tests all three plans and restores access without resetting records',async({page})=>{
 const s=await setup(page);await page.goto('/?view=settings&section=plans');await expect(page.getByRole('heading',{name:'Plans & Usage'})).toBeVisible();await expect(page.locator('.tier-price').filter({hasText:'$19.95'})).toBeVisible();await page.getByRole('button',{name:'Test Free',exact:true}).click();await expect(page.getByRole('button',{name:'Testing Free',exact:true})).toBeDisabled();expect(s.tier).toBe('free');await expect(page.getByRole('region',{name:'Business storage'})).toContainText('0 MB of 100 MB');await page.getByRole('button',{name:'Test Individual',exact:true}).click();expect(s.tier).toBe('basic');await expect(page.getByRole('region',{name:'Business storage'})).toContainText('0 MB of 2 GB');await page.getByRole('button',{name:'Test Business Pro',exact:true}).click();expect(s.tier).toBe('pro');await expect(page.getByRole('region',{name:'Business storage'})).toContainText('0 MB of 10 GB');await page.getByRole('button',{name:'Restore Business Pro access'}).click();expect(s.testing).toBe(false)
})
test('ordinary owners see comparison but cannot grant a test entitlement',async({page})=>{await setup(page,{canTest:false});await page.goto('/?view=settings&section=plans');await expect(page.getByRole('heading',{name:'Plans & Usage'})).toBeVisible();await expect(page.getByRole('button',{name:/^Test (Free|Individual|Business Pro)$/})).toHaveCount(0)})
test('personal app setup requires acknowledgement and enables explicit final-send workflow',async({page})=>{
 const s=await setup(page,{tier:'free'});await page.goto('/?view=settings&section=delivery');await expect(page.getByRole('button',{name:'Save sending setup',exact:true})).toBeDisabled();await page.getByLabel('My email app is configured', {exact:false}).check();await page.getByLabel('My messaging app and mobile service', {exact:false}).check();await page.getByLabel('I understand personal-app messages', {exact:false}).check();await page.getByRole('button',{name:'Save sending setup',exact:true}).click();await expect.poll(()=>s.saves.length).toBe(1)
 await page.goto('/?view=invoices&document='+E)
 await openSavedDelivery(page)
 const email=page.getByRole('button',{name:'Send Email',exact:true})
 await expect(email).toBeEnabled()
 await expect(page.getByRole('button',{name:'Send Text',exact:true})).toBeDisabled()
 await email.click()
 expect(s.sent).toHaveLength(0)
 await page.getByRole('button',{name:'Confirm sent',exact:true}).click()
 await expect.poll(()=>s.sent.length).toBe(1)
 expect(s.sent[0].p_channel).toBe('email')
})
test('Business Pro exposes activation requirements, safe fallback and disabled automation',async({page})=>{
 await setup(page);await page.goto('/?view=settings&section=delivery');await expect(page.getByText('Pending verified sender activation',{exact:false})).toBeVisible();await expect(page.getByLabel('Enable overdue invoice email reminders')).toBeDisabled();await page.goto('/?view=invoices&document='+E);await openSavedDelivery(page);await expect(page.getByRole('button',{name:'Send Email',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Send Text',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Use my email or text app instead'}).click();await expect(page.getByRole('button',{name:'Open email app',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Send Text',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Copy Link',exact:true})).toBeEnabled()
})
test('mobile plan comparison stays inside the viewport',async({page})=>{await page.setViewportSize({width:390,height:844});await setup(page);await page.goto('/?view=settings&section=plans');await expect(page.getByRole('heading',{name:'Plans & Usage'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/tier-mobile.png',fullPage:true})})

for(const tier of ['free','basic'])for(const kind of ['invoice','estimate'])test(`${tier} ${kind} creation saves before personal sending and never calls a managed provider`,async({page})=>{
 const state=await setup(page,{tier,ready:true});await page.goto('/?view='+kind+'s');await page.getByRole('button',{name:'Create '+kind,exact:true}).click();const form=page.getByRole('dialog',{name:'Create an '+kind,exact:true});
 await form.getByRole('combobox',{name:'Customer',exact:true}).fill('Test');await form.getByRole('option',{name:/Test Customer/}).click();await form.getByLabel('Line 1 description',{exact:true}).fill('Lawn maintenance');await form.getByLabel('Line 1 unit price',{exact:true}).fill('250');await form.getByRole('button',{name:'Preview',exact:true}).click();
 const pdf=form.getByRole('region',{name:kind==='invoice'?'Invoice PDF':'Estimate PDF',exact:true})
 await expect(pdf.getByRole('button',{name:'Download PDF',exact:true})).toBeEnabled()
 await expect(pdf.locator('iframe')).toHaveAttribute('src',/^blob:/)
 await expect.poll(()=>state.documents.length).toBe(1)
 expect(state.documents[0]).toMatchObject({document_kind:kind,payload:{customer_id:C,items:[{description:'Lawn maintenance',unit_price:250}]}})
 expect(state.calls.filter(call=>call.path.endsWith('/document-pdf')&&call.method==='POST').at(-1).body).toEqual({business_id:B,document_kind:kind,document_id:E})
 const downloading=page.waitForEvent('download');await pdf.getByRole('button',{name:'Download PDF',exact:true}).click()
 const download=await downloading;expect(await readFile(await download.path())).toEqual(PDF_BYTES)
 // Branding inside the canonical PDF is asserted by the real PDF renderer tests, not a synthetic HTML preview.
 await expect(form.getByText('Removing Finviant branding is unavailable on the Free plan.',{exact:true})).toHaveCount(tier==='free'?1:0)
 await expect(form.getByRole('link',{name:'Explore Individual',exact:true})).toHaveCount(tier==='free'?1:0)
 if(tier==='basic'){
  await expect(form.getByRole('button',{name:'Send Email',exact:true})).toBeDisabled()
  await form.getByRole('button',{name:'Use my email or text app',exact:true}).click()
 }
 const emailLabel=tier==='basic'?'Open email app':'Send Email'
 await expect(form.getByRole('button',{name:emailLabel,exact:true})).toBeEnabled();await expect(form.getByRole('button',{name:'Send Text',exact:true})).toBeEnabled()
 await form.getByRole('button',{name:kind==='invoice'?emailLabel:'Send Text',exact:true}).click()
 await expect.poll(()=>state.shares).toBe(1)
 expect(state.prepared[0].request).toMatchObject({p_business:B,p_kind:kind,p_document:E})
 expect(state.prepared[0].snapshot).toMatchObject({kind,total:250,finviant_branding:tier==='free',items:[{description:'Lawn maintenance',unit_price:250}]})
 expect(state.calls.some(c=>c.path.includes('/send-'))).toBe(false);expect(state.sent).toHaveLength(0)
 await expect(form.getByRole('link',{name:'Reopen draft in your app'})).toHaveAttribute('href',kind==='invoice'?/^mailto:/:/^sms:/)
 await expect(form.getByRole('button',{name:/^(Send (Email|Text)|Open email app)$/})).toHaveCount(0)
 // Native sms/mailto handoff can move focus out of Chrome. Return to the
 // application as a user does after sending before testing its confirmation.
 await page.bringToFront()
 await expect.poll(()=>page.evaluate(()=>document.hasFocus())).toBe(true)
 // Capture real input delivery without dispatching synthetic events or retrying the click.
 await page.evaluate(()=>{
  window.__personalSendInput=[]
  for(const type of ['pointerdown','pointerup','mousedown','mouseup','click'])document.addEventListener(type,event=>{
   const target=event.target instanceof Element?event.target:null
   const button=target?.closest('button')
   window.__personalSendInput.push({type,tag:target?.tagName,label:button?.textContent?.trim(),trusted:event.isTrusted,defaultPrevented:event.defaultPrevented,focused:document.hasFocus(),x:event.clientX,y:event.clientY,disabled:button?.disabled})
  },true)
 })
 try {
  await form.getByRole('button',{name:'Confirm sent'}).click()
  await expect.poll(()=>state.sent.length).toBe(1)
 } finally {
  const events=await page.evaluate(()=>window.__personalSendInput)
  if(state.sent.length!==1)console.log('Personal send confirmation diagnostics',JSON.stringify({events,ui:await form.innerText(),calls:state.calls.filter(c=>/confirm_personal|prepare_personal|release_personal/.test(c.path)).map(c=>({path:c.path,method:c.method}))}))
  await test.info().attach('personal-send-input-events',{body:Buffer.from(JSON.stringify(events,null,2)),contentType:'application/json'})
 }
 expect(state.sent[0].p_channel).toBe(kind==='invoice'?'email':'sms')
 expect(state.documents).toHaveLength(1)
})

for (const tier of ['free','basic','pro']) test(`More shows setup appropriate for ${tier}`,async({page})=>{
 await setup(page,{tier})
 await page.goto('/?view=settings')
 const links=page.getByRole('region',{name:'Setup and connections'})
 await expect(links.getByRole('link',{name:/^Team Management/})).toBeVisible()
 await expect(links.getByRole('link',{name:/^Working Hours/})).toHaveCount(0)
 await expect(links.getByRole('link',{name:/^Email & Text Setup/})).toHaveCount(1)
 await expect(links.getByRole('link',{name:/^Calendar Connections/})).toHaveCount(tier==='free'?0:1)
 await expect(page.getByRole('link',{name:/^Schedule/})).toBeVisible()
})

test('a blocked settings link names the current tier and focuses the qualifying plan',async({page})=>{
 await setup(page,{tier:'free'})
 await page.goto('/?view=settings&section=calendar')
 await expect(page.getByRole('heading',{name:'Calendar Connections'})).toBeVisible()
 await expect(page.getByText('Calendar Connections is unavailable on the Free plan.')).toBeVisible()
 await page.getByRole('link',{name:'Explore Individual'}).click()
 await expect(page.getByRole('article',{name:'Individual plan'})).toBeFocused()
 await expect(page.getByRole('button',{name:'Test Individual',exact:true})).toBeEnabled()
})
