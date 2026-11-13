import {test,expect} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {mkdir} from 'node:fs/promises'
import {mock,B,C,E,J,U,customer} from './audit-fixture.mjs'

const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-expose-headers':'content-range','content-range':'0-0/1'}
async function setup(page,{sms=false,unavailable=false,personal=false,tax=0,owner=true,emailFailure=false}={}){
 const state=await mock(page,{defaultTax:tax,owner});state.sent=[];state.personalDrafts=[]
 state.customers[0]={...customer,first_name:'Taylor',last_name:'Morgan',email:'taylor@example.test',phone:'+17575550123'}
 await page.route('**/rest/v1/business_members?**',r=>r.fulfill({headers,json:{business_id:B,role:owner?'owner':'office',access_modules:['calendar','jobs','billing','finances'],businesses:{id:B,name:'Harbor Home Services',created_by_user_id:U,timezone:'America/New_York',profile_completed_at:'2026-01-01T00:00:00Z'}}}))
 await page.route('**/rest/v1/rpc/get_delivery_setup',r=>r.fulfill({headers,json:{plan:personal==='basic'?'basic':personal?'free':'pro',managed_email_ready:!unavailable&&!personal,managed_sms_ready:sms,personal_email_ready:personal,personal_sms_ready:false}}))
 await page.route('**/rest/v1/service_items?**',r=>r.fulfill({headers,json:[{id:J,description:'Kitchen cabinet repair',unit_price:250,tax_rate:0}]}))
 await page.route('**/rest/v1/service_packages?**',r=>r.fulfill({headers,json:[{id:E,name:'Seasonal service',items:[{description:'Labor',quantity:2,unit_price:50,tax_rate:0},{description:'Materials',quantity:1,unit_price:100,tax_rate:5}]}]}))
 await page.route('**/functions/v1/send-invoice-email',r=>{if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers});const body=r.request().postDataJSON();state.sent.push({channel:'email',body});return r.fulfill({headers,status:emailFailure&&state.sent.length===1?503:200,json:emailFailure&&state.sent.length===1?{error:'Synthetic uncertain email outcome'}:{email_id:J,status:'accepted',recipient:body.expected_recipient}})})
 await page.route('**/rest/v1/rpc/prepare_personal_document',r=>{state.personalDrafts.push(r.request().postDataJSON());return r.fulfill({headers,json:{snapshot:{kind:'invoice',number:'INV-1043',status:'draft',total:250,items:[],customer:{name:'Taylor Morgan',email:'taylor@example.test',phone:'+17575550123'},company:{name:'Harbor Home Services'}}}})})
 await page.route('**/rest/v1/rpc/record_sms_permission',r=>r.fulfill({headers,json:null}))
 await page.route('**/functions/v1/send-document-sms',r=>{if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers});state.sent.push({channel:'sms',body:r.request().postDataJSON()});return r.fulfill({headers,json:{status:'accepted'}})})
 return state
}
async function open(page){await page.goto('/?view=invoices&new=1');return page.getByRole('dialog',{name:'Create an invoice',exact:true})}
async function enter(form){await form.getByRole('combobox',{name:'Customer',exact:true}).fill('Taylor');await form.getByRole('option',{name:/Taylor Morgan/}).click();await form.getByLabel('Line 1 description',{exact:true}).fill('Kitchen cabinet repair');await form.getByLabel('Line 1 unit price',{exact:true}).fill('250')}
async function review(form){await form.getByRole('button',{name:'Review invoice',exact:true}).click();await expect(form.getByText(/Draft saved · Not sent/)).toBeVisible()}
async function scan(page){const results=await new AxeBuilder({page}).include('.invoice-simple-create').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(results.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,reason:n.failureSummary}))}))).toEqual([])}

for(const width of [320,390,430,1440])test(`simple invoice essentials, inline options and direct review at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:width===430?932:844});const state=await setup(page);const form=await open(page);await enter(form)
 await expect(form.getByLabel('Line 1 quantity',{exact:true})).toBeHidden();await expect(form.getByLabel('Invoice date',{exact:true})).toBeHidden();await expect(form.getByRole('button',{name:'Cancel',exact:true})).toHaveCount(0)
 await expect(form.getByRole('button',{name:'+ Add item',exact:true})).toHaveCount(1);await expect(form.getByRole('button',{name:'Manage existing schedules',exact:true})).toHaveCount(0)
 await mkdir('tmp/invoice-simple',{recursive:true});await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:`tmp/invoice-simple/create-${width}.png`,fullPage:true});await scan(page)
 await form.locator('.invoice-more-options>summary').click();await expect(form.getByLabel('Payment terms',{exact:true})).toHaveValue('0');await expect(form.getByLabel('Due date',{exact:true})).toHaveCount(0)
 await form.getByLabel('Payment terms',{exact:true}).selectOption('30');await expect(form.getByLabel('Due date',{exact:true})).toHaveCount(0);await page.screenshot({path:`tmp/invoice-simple/options-${width}.png`,fullPage:true})
 await form.locator('.invoice-more-options>summary').click();await review(form)
 await expect(form.getByRole('button',{name:'Send Finviant Email',exact:true})).toBeEnabled();await expect(form.getByRole('button',{name:'Choose delivery',exact:true})).toHaveCount(0);await expect(form.getByRole('button',{name:'Save draft',exact:true})).toHaveCount(0)
 await expect(form.getByRole('article',{name:'Invoice summary'})).toContainText('$250.00');expect(state.documents).toHaveLength(1);expect(state.sent).toHaveLength(0)
 expect(await form.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await scan(page);await page.screenshot({path:`tmp/invoice-simple/review-${width}.png`,fullPage:true})
 await form.locator('.invoice-pdf-export>summary').click();await expect(form.getByRole('region',{name:'Invoice PDF',exact:true}).getByRole('button',{name:'Download PDF',exact:true})).toBeEnabled()
})
test('Save draft skips review and requires no delivery contact',async({page})=>{
 const state=await setup(page);const form=await open(page);await form.getByRole('button',{name:'Create a new customer',exact:true}).click();await form.getByLabel('Customer name',{exact:true}).fill('New customer');await form.getByLabel('Line 1 description',{exact:true}).fill('Repair');await form.getByLabel('Line 1 unit price',{exact:true}).fill('40');await form.getByRole('button',{name:'Save draft',exact:true}).click();await expect.poll(()=>state.documents.length).toBe(1);expect(state.documents[0].payload.new_customer.email).toBeNull();expect(state.sent).toHaveLength(0);await expect(form).toHaveCount(0)
})
test('one item chooser copies saved service prices and preserves package quantities and tax',async({page})=>{
 const state=await setup(page);const form=await open(page);await form.getByRole('combobox',{name:'Customer',exact:true}).fill('Taylor');await form.getByRole('option',{name:/Taylor Morgan/}).click()
 expect(state.calls.some(c=>/service_items|service_packages/.test(c.path))).toBe(false)
 await form.getByRole('button',{name:'+ Add item',exact:true}).click();await form.getByRole('button',{name:/Kitchen cabinet repair.*Saved service/}).click();await expect(form.getByLabel('Line 1 unit price',{exact:true})).toHaveValue('250')
 await form.getByRole('button',{name:'+ Add item',exact:true}).click();await form.getByRole('button',{name:/Seasonal service.*2 items/}).click();await expect(form.getByLabel('Line 2 quantity',{exact:true})).toHaveValue('2');await expect(form.getByLabel('Line 3 unit price',{exact:true})).toHaveValue('100')
 await form.getByRole('button',{name:'Save draft',exact:true}).click();await expect.poll(()=>state.documents.length).toBe(1);expect(state.documents[0].payload.items.map(l=>[l.quantity,l.unit_price,l.tax_rate])).toEqual([[1,250,0],[2,50,0],[1,100,5]])
})
test('custom dates, per-item tax, references and internal notes survive creation',async({page})=>{
 const state=await setup(page,{tax:5});const form=await open(page);await enter(form);await form.locator('.invoice-more-options>summary').click();await form.getByLabel('Payment terms',{exact:true}).selectOption('custom');await form.getByLabel('Due date',{exact:true}).fill('2027-01-15');await form.getByLabel('Customer PO / reference (optional)',{exact:true}).fill('PO-123');await form.locator('textarea').fill('Internal only');await form.getByText('Per-item tax rates',{exact:false}).click();await form.getByLabel('Line 1 Tax rate (%)',{exact:true}).fill('0');await form.getByRole('button',{name:'Save draft',exact:true}).click();await expect.poll(()=>state.documents.length).toBe(1);expect(state.documents[0].payload).toMatchObject({due_date:'2027-01-15',customer_reference:'PO-123',notes:'Internal only',items:[{tax_rate:0}]});expect(state.sent).toHaveLength(0)
})
test('direct Finviant Email sends only on click and uncertain retry reuses the invoice and operation',async({page})=>{
 const state=await setup(page,{emailFailure:true});const form=await open(page);await enter(form);await review(form);const send=form.getByRole('button',{name:'Send Finviant Email',exact:true});await expect(send).toBeEnabled();expect(state.sent).toHaveLength(0);await send.click();await expect(form.getByRole('alert')).toContainText('Synthetic uncertain email outcome');await form.getByRole('button',{name:'Retry Finviant Email',exact:true}).click();await expect.poll(()=>state.sent.length).toBe(2);expect(state.sent[0].body).toEqual(state.sent[1].body);expect(state.sent[0].body).toMatchObject({invoice_id:E,expected_recipient:'taylor@example.test'});expect(state.sent[0].body.expected_revision_id).toBeTruthy();expect(state.documents).toHaveLength(1)
})
test('direct Finviant SMS retains recipient consent and does not send from review alone',async({page})=>{
 await page.setViewportSize({width:390,height:932});const state=await setup(page,{sms:true});const form=await open(page);await enter(form);await review(form);const send=form.getByRole('button',{name:'Send Finviant SMS',exact:true});await expect(send).toBeDisabled();expect(state.sent).toHaveLength(0);await form.getByRole('checkbox',{name:/customer agreed/}).check();await expect(send).toBeEnabled();await scan(page);await page.screenshot({path:'tmp/invoice-simple/review-sms-390.png',fullPage:true});await send.click();await expect.poll(()=>state.sent.length).toBe(1);expect(state.sent[0]).toMatchObject({channel:'sms',body:{recipient:'+17575550123',document_id:E,kind:'invoice'}});expect(state.documents).toHaveLength(1)
})
test('unavailable providers are not presented as available send actions',async({page})=>{
 const state=await setup(page,{unavailable:true});const form=await open(page);await enter(form);await review(form);await expect(form.getByText(/No sending method is ready/)).toBeVisible();await expect(form.getByRole('button',{name:/Send Finviant/})).toHaveCount(0);await expect(form.getByRole('button',{name:'Choose delivery',exact:true})).toHaveCount(0);expect(state.sent).toHaveLength(0)
})
for(const personal of [true,'basic'])test(`configured ${personal===true?'Free':'Individual'} personal email prepares an app handoff without a managed send`,async({page})=>{
 const state=await setup(page,{personal});const form=await open(page);await enter(form);await review(form);await expect(form.getByRole('button',{name:'Open email app',exact:true})).toBeEnabled();await expect(form.getByRole('button',{name:'Send Finviant Email',exact:true})).toHaveCount(0);await form.getByRole('button',{name:'Open email app',exact:true}).click();await expect.poll(()=>state.personalDrafts.length).toBe(1);expect(state.sent).toHaveLength(0)
})
test('job handoff prefills saved customer and work without inventing a price',async({page})=>{
 const state=await setup(page);await page.route('**/rest/v1/jobs?**',r=>r.fulfill({headers,json:{id:J,title:'Kitchen cabinet repair',status:'completed',customer_id:C,source_estimate_id:null,customers:[state.customers[0]],properties:[]}}));await page.route('**/rest/v1/rpc/get_job_workflow_context',r=>r.fulfill({headers,json:[{job_id:J,active_appointment:null,invoice:null}]}));await page.goto('/?view=invoices&job='+J);const form=page.getByRole('dialog',{name:'Create an invoice',exact:true});await expect(form.getByLabel('Line 1 description',{exact:true})).toHaveValue('Kitchen cabinet repair');await expect(form.getByLabel('Line 1 unit price',{exact:true})).toHaveValue('');expect(state.documents).toHaveLength(0)
})
test('job billing reuses an existing invoice instead of creating another draft',async({page})=>{
 const state=await setup(page)
 await page.route('**/rest/v1/jobs?**',r=>r.fulfill({headers,json:{id:J,title:'Kitchen cabinet repair',status:'completed',customer_id:C,source_estimate_id:null,customers:[state.customers[0]],properties:[]}}))
 await page.route('**/rest/v1/rpc/get_job_workflow_context',r=>r.fulfill({headers,json:[{job_id:J,active_appointment:null,invoice:{id:E,status:'sent',number:'INV-QA'}}]}))
 await page.goto('/?view=invoices&job='+J);await expect(page).toHaveURL(new RegExp('document='+E));await expect(page.getByRole('heading',{name:'INV-QA',exact:true})).toBeVisible();await expect(page.getByRole('dialog',{name:'Create an invoice',exact:true})).toHaveCount(0);expect(state.documents).toHaveLength(0);expect(state.sent).toHaveLength(0)
})
test('job approved pricing follows the existing estimate conversion review',async({page})=>{
 const state=await setup(page)
 await page.route('**/rest/v1/jobs?**',r=>r.fulfill({headers,json:{id:J,title:'Kitchen cabinet repair',status:'completed',customer_id:C,source_estimate_id:E,customers:[state.customers[0]],properties:[]}}))
 await page.route('**/rest/v1/rpc/get_job_workflow_context',r=>r.fulfill({headers,json:[{job_id:J,active_appointment:null,invoice:null}]}))
 const estimate={id:E,estimate_number:'EST-APPROVED',customer_id:C,status:'accepted',issue_date:'2026-10-01',total:250,subtotal:250,tax_amount:0,customers:state.customers[0]}
 await page.route('**/rest/v1/estimates?**',r=>r.fulfill({headers,json:new URL(r.request().url()).searchParams.has('id')?estimate:[estimate]}))
 await page.goto('/?view=invoices&job='+J);await expect(page).toHaveURL(new RegExp('view=estimates&document='+E));await expect(page.getByRole('dialog',{name:'Estimate preview',exact:true})).toBeVisible();expect(state.documents).toHaveLength(0);expect(state.sent).toHaveLength(0);expect(state.calls.some(c=>c.path.endsWith('/convert_estimate_to_invoice'))).toBe(false)
})
test('saved-item button edits require discard confirmation, then a saved review closes cleanly',async({page})=>{
 const state=await setup(page);await page.goto('/?view=invoices&new=1&customer='+C);const form=page.getByRole('dialog',{name:'Create an invoice',exact:true})
 await form.getByRole('button',{name:'+ Add item',exact:true}).click();await form.getByRole('button',{name:/Kitchen cabinet repair.*Saved service/}).click()
 let prompts=0;page.once('dialog',async dialog=>{prompts++;await dialog.dismiss()});await form.getByRole('button',{name:'Close',exact:true}).click();await expect(form).toBeVisible();expect(prompts).toBe(1);expect(state.documents).toHaveLength(0)
 await review(form);page.on('dialog',async dialog=>{prompts++;await dialog.dismiss()});await form.getByRole('button',{name:'Close invoice review',exact:true}).click();await expect(form).toHaveCount(0);expect(prompts).toBe(1);expect(state.documents).toHaveLength(1);expect(state.sent).toHaveLength(0)
})
test('PDF export keeps native file sharing without recording an invoice send',async({page})=>{
 const state=await setup(page,{personal:true});await page.addInitScript(()=>{Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.__sharedInvoiceFiles=data.files.length}})})
 const form=await open(page);await enter(form);await review(form);await form.locator('.invoice-pdf-export>summary').click();await form.getByRole('button',{name:'Share PDF',exact:true}).click();await expect(form.getByText('PDF shared. Use your document sending options to record a completed send.',{exact:true})).toBeVisible();expect(await page.evaluate(()=>window.__sharedInvoiceFiles)).toBe(1);expect(state.documents).toHaveLength(1);expect(state.sent).toHaveLength(0);expect(state.calls.some(call=>call.path.endsWith('/confirm_personal_document_sent'))).toBe(false)
})
