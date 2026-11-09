import {workflow,start,save,docStep,item} from './fin-workflow-fixture.mjs'
import {PDF_REVISION,PDF_BYTES,pdfHeaders,fulfillPdf} from './document-pdf-fixture.mjs'
import {test,expect} from '@playwright/test'
import {mock,B,C,E,P,customer} from './audit-fixture.mjs'
test.setTimeout(60000)
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'}
const reply=(route,json,status=200)=>route.fulfill({status,headers:{...cors,'access-control-expose-headers':'content-range','content-range':Array.isArray(json)?`0-${Math.max(0,json.length-1)}/${json.length}`:'0-0/1'},json})
async function setup(page,contact={email:'customer@example.test',phone:'7575550123'}){
 const state=await mock(page,{ai:true});state.customers[0]={...state.customers[0],...contact}
 const person={...customer,...contact,updated_at:'2026-11-04T10:00:00Z'}
 const common={customer_id:C,status:'draft',issue_date:'2026-11-04',created_at:'2026-11-04T10:00:00Z',total:105,subtotal:100,tax_amount:5,amount_paid:0,balance_due:105,customers:person}
 const invoice={...common,id:E,invoice_number:'INV-QA'},estimate={...common,id:E,estimate_number:'EST-QA'}
 const order={...common,id:P,change_order_number:'CO-QA',source_invoice_id:E,title:'Additional work',description:'Add two fixtures',schedule_impact_days:1,customers:[person]}
 for(const [table,doc] of [['invoices',invoice],['estimates',estimate],['change_orders',order]])await page.route(`**/rest/v1/${table}?*`,route=>reply(route,new URL(route.request().url()).searchParams.has('id')?doc:[doc]))
 await page.route('**/rest/v1/change_order_items?*',route=>reply(route,[{id:E,description:'Two fixtures',quantity:2,unit_price:50,line_total:100,tax_rate:5}]))
 return {state,person,invoice,estimate,order}
}
async function openReview(page,kind){
 await page.goto('/?view='+(kind==='change_order'?'invoices':kind+'s')+'&document='+E)
 if(kind==='change_order'){
  await page.getByRole('button',{name:'Open change order CO-QA'}).click()
 } else {
  const review=kind==='estimate'?page.getByRole('dialog',{name:'Estimate preview',exact:true}):page
  await expect(review.getByRole('region',{name:'Send to customer',exact:true})).toHaveCount(0)
  await review.getByRole('button',{name:'Send '+kind,exact:true}).click()
 }
 return page.getByRole('region',{name:'Send to customer',exact:true})
}
for(const kind of ['invoice','estimate','change_order'])for(const [scenario,contact,hasEmail,hasSms] of [
 ['email only',{email:'customer@example.test',phone:null},true,false],
 ['phone only',{email:null,phone:'7575550123'},false,true],
 ['both',{email:'customer@example.test',phone:'7575550123'},true,true],
 ['neither',{email:null,phone:null},false,false],
 ['invalid',{email:'bad-address',phone:'not-a-number'},false,false],
])test(`${kind} saved review disables unavailable contact channels: ${scenario}`,async({page})=>{
 await page.setViewportSize({width:390,height:950});const {state}=await setup(page,contact);const delivery=await openReview(page,kind)
 await expect(delivery).toBeVisible()
 await expect(delivery.getByRole('button',{name:'Send Email',exact:true})).toHaveCount(1)
 await expect(delivery.getByRole('button',{name:'Send Text',exact:true})).toHaveCount(1)
 await expect(page.getByRole('dialog',{name:kind==='change_order'?'Review change order':'Send '+kind,exact:true}).getByRole('button',{name:'Download PDF',exact:true})).toBeVisible()
 if(hasEmail)await expect(delivery.getByRole('button',{name:'Send Email'})).toBeEnabled()
 else await expect(delivery.getByRole('button',{name:'Send Email'})).toBeDisabled()
 await expect(delivery.getByRole('button',{name:'Send Text'})).toBeDisabled()
 if(hasSms)await expect(delivery).toContainText('pending sender activation')
 if(scenario==='neither')await expect(delivery.getByRole('button',{name:'Add email or phone'})).toBeVisible()
 expect(state.calls.some(call=>call.path.includes('/send-'))).toBe(false)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 if(scenario==='both')await page.screenshot({path:`test-results/saved-${kind}-delivery-mobile.png`,fullPage:true})
})
for(const kind of ['invoice','estimate','change_order'])test(`${kind} sends once directly from review with the displayed recipient`,async({page})=>{
 await setup(page);const sends=[]
 await page.route('**/functions/v1/send-*-email',async route=>{
  if(route.request().method()==='OPTIONS')return reply(route,{},200)
  sends.push(route.request().postDataJSON());await new Promise(r=>setTimeout(r,100));return reply(route,{status:'accepted',email_id:'receipt-1',recipient:'customer@example.test'})
 })
 const delivery=await openReview(page,kind);await expect(delivery.getByRole('button',{name:'Send Email',exact:true})).toBeEnabled();await delivery.getByRole('button',{name:'Send Email',exact:true}).dblclick()
 await expect(page.getByRole('status').filter({hasText:'Email accepted for delivery'})).toBeVisible()
 await expect(delivery).toHaveCount(1)
 expect(sends).toHaveLength(1);expect(sends[0].expected_recipient).toBe('customer@example.test');expect(sends[0].business_id).toBe(B);expect(sends[0].expected_revision_id).toBe(PDF_REVISION)
 expect(sends[0].invoice_id||sends[0].document_id).toBe(kind==='change_order'?P:E)
 if(kind!=='invoice')expect(sends[0].document_type).toBe(kind)
 await expect(delivery.getByRole('button',{name:'Email accepted',exact:true})).toBeDisabled()
})
test('uncertain email uses the same request after closing and reopening the saved review',async({page})=>{
 await setup(page);const sends=[]
 await page.route('**/functions/v1/send-invoice-email',route=>{
  if(route.request().method()==='OPTIONS')return reply(route,{},200)
  sends.push(route.request().postDataJSON());return reply(route,sends.length===1?{error:'Outcome uncertain. Retry the same send.'}:{status:'accepted',email_id:'receipt-1',recipient:'customer@example.test'},sends.length===1?503:200)
 })
 let delivery=await openReview(page,'invoice');await delivery.getByRole('button',{name:'Send Email',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Outcome uncertain')
 await page.getByRole('button',{name:'Close delivery',exact:true}).click()
 await page.getByRole('region',{name:'Delivery needs review'}).getByRole('button',{name:'Review delivery',exact:true}).click()
 delivery=page.getByRole('region',{name:'Send to customer'});await delivery.getByRole('button',{name:'Send Email',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Email accepted for delivery'})).toBeVisible();expect(sends).toHaveLength(2);expect(sends[0]).toEqual(sends[1])
})
for(const kind of ['invoice','estimate'])test(`Fin retains delivery controls immediately after saving a ${kind} draft`,async({page})=>{
 const {state,executions}=await workflow(page,{steps:[docStep(kind,[item('Landscaping',100)])],contact:{email:'customer@example.test',phone:'7575550123'}})
 await start(page,`Create ${kind} for Test Customer for landscaping $100`);expect(executions).toHaveLength(0)
 if(kind==='invoice'){
  const form=page.getByRole('dialog',{name:'Create an invoice',exact:true})
  await expect(form.getByRole('combobox',{name:'Customer',exact:true})).toHaveValue('Test Customer')
  await form.getByRole('button',{name:'Preview',exact:true}).click()
  await expect(form.getByRole('button',{name:'Send Email',exact:true})).toBeEnabled()
  await expect(form.getByRole('button',{name:'Send Text',exact:true})).toBeVisible()
  await form.getByRole('button',{name:'Open saved draft',exact:true}).click()
  await expect.poll(()=>state.documents.length).toBe(1)
  expect(state.calls.some(call=>call.path.includes('/send-'))).toBe(false)
  return
 }
 await save(page)
 const dialog=page.getByRole('dialog',{name:'Fin — your office assistant'})
 await expect(dialog.getByRole('region',{name:'Send to customer'})).toBeVisible();await expect(dialog.getByRole('button',{name:'Send Email',exact:true})).toBeEnabled()
 await expect(dialog.getByRole('button',{name:'Send Text',exact:true})).toBeVisible();expect(state.documents).toHaveLength(1)
 expect(state.calls.some(call=>call.path.includes('/send-'))).toBe(false)
})
test('creating a change order opens its review and delivery controls automatically',async({page})=>{
 const {state}=await setup(page);await page.goto('/?view=invoices&document='+E);await page.getByRole('button',{name:'+ New change order',exact:true}).click()
 const form=page.getByRole('dialog',{name:'Create change order'});await form.getByLabel('Line 1 description').fill('Two fixtures');await form.getByLabel('Line 1 unit price').fill('50')
 await form.getByRole('button',{name:'Save and review',exact:true}).click()
 const review=page.getByRole('dialog',{name:'Review change order'});await expect(review).toBeVisible();await expect(review.getByRole('button',{name:'Send Email'})).toBeEnabled();await expect(review.getByRole('button',{name:'Download PDF',exact:true})).toBeVisible();expect(state.changes).toHaveLength(1);expect(state.changes[0].p_input.items[0]).toMatchObject({description:'Two fixtures',unit_price:50});expect(state.calls.filter(call=>call.path.endsWith('/document-pdf')&&call.method==='POST').at(-1).body).toEqual({business_id:B,document_kind:'change_order',document_id:P})
})
test('switching change orders ignores a late PDF from the previous review and sends only the current revision',async({page})=>{
 const {order}=await setup(page)
 const otherId='77777777-7777-4777-8777-777777777777'
 const otherRevision='99999999-9999-4999-8999-999999999999'
 let releaseFirst,firstStarted=false
 const firstReleased=new Promise(resolve=>{releaseFirst=resolve})
 let finishFirst
 const firstFinished=new Promise(resolve=>{finishFirst=resolve})
 const other={...order,id:otherId,change_order_number:'CO-OTHER',title:'Different work'}
 await page.route('**/rest/v1/change_orders?*',route=>reply(route,[order,other]))
 await page.route('**/functions/v1/document-pdf',async route=>{
  if(route.request().method()==='OPTIONS')return reply(route,{},200)
  const body=route.request().postDataJSON()
  if(body.document_kind!=='change_order')return fulfillPdf(route)
  const first=body.document_id===P
  if(first){firstStarted=true;await firstReleased}
  try {
   await route.fulfill({status:200,headers:{...pdfHeaders,'x-finviant-revision-id':first?PDF_REVISION:otherRevision,'content-disposition':`attachment; filename="${first?'CO-QA':'CO-OTHER'}.pdf"`},body:PDF_BYTES})
  } finally {if(first)finishFirst()}
 })
 const sends=[]
 await page.route('**/functions/v1/send-document-email',route=>{
  if(route.request().method()==='OPTIONS')return reply(route,{},200)
  sends.push(route.request().postDataJSON())
  return reply(route,{status:'accepted',email_id:'receipt-2',recipient:'customer@example.test'})
 })
 await page.goto('/?view=invoices&document='+E)
 await page.getByRole('button',{name:'Open change order CO-QA'}).click()
 await expect.poll(()=>firstStarted).toBe(true)
 const review=page.getByRole('dialog',{name:'Review change order',exact:true})
 await expect(review.getByRole('button',{name:'Send Email',exact:true})).toBeDisabled()
 await review.getByRole('button',{name:'Close review',exact:true}).click()
 await page.getByRole('button',{name:'Open change order CO-OTHER'}).click()
 await expect(review.getByRole('button',{name:'Send Email',exact:true})).toBeEnabled()
 releaseFirst();await firstFinished
 const downloaded=page.waitForEvent('download')
 await review.getByRole('button',{name:'Download PDF',exact:true}).click()
 expect((await downloaded).suggestedFilename()).toBe('CO-OTHER.pdf')
 await review.getByRole('button',{name:'Send Email',exact:true}).click()
 await expect(review.getByRole('status').filter({hasText:'Email accepted for delivery'})).toBeVisible()
 expect(sends).toHaveLength(1)
 expect(sends[0]).toMatchObject({business_id:B,document_type:'change_order',document_id:otherId,expected_revision_id:otherRevision})
})

test('the estimate shows the exact pending, approved, and declined changes without changing the quoted total', async ({ page }) => {
 const { order,state } = await setup(page)
 const matching = { ...order, source_invoice_id: null, estimate_id: E, status: 'sent', total: 20,
   change_totals: { current_total: 105, change_amount: 20, revised_total: 125, deposit_paid: 0, other_paid: 0 } }
 const unrelated = { ...order, id: '77777777-7777-4777-8777-777777777777', estimate_id: E, title: 'Invoice-only change' }
 await page.route('**/rest/v1/change_orders?*', route => reply(route, [matching, unrelated]))
 await page.route('**/rest/v1/rpc/get_document_change_context', route => reply(route, {
   can_change: true, job_id: null, current_total: matching.status === 'approved' ? 125 : 105,
 }))
 await page.route('**/rest/v1/rpc/get_change_order_billing', route => reply(route, { action: 'included_on_final' }))
 await page.goto('/?view=estimates&document=' + E)
 const summary = page.getByRole('region', { name: 'Linked change orders' })
 await expect(summary).toContainText('Awaiting customer approval')
 await expect(summary).toContainText('Proposed total as quoted $125.00')
 await expect(summary).not.toContainText('Invoice-only change')
 await expect(page.getByRole('dialog', { name: 'Create change order' })).toHaveCount(0)
 await summary.getByRole('button', { name: 'Open change order CO-QA' }).click()
 const changeReview=page.getByRole('dialog', { name: 'Review change order',exact:true })
 await expect(changeReview.getByRole('button',{name:'Download PDF',exact:true})).toBeVisible()
 expect(state.calls.filter(call=>call.path.endsWith('/document-pdf')&&call.method==='POST').at(-1).body).toEqual({business_id:B,document_kind:'change_order',document_id:P})
 matching.status = 'approved'
 await page.getByRole('button', { name: 'Close review' }).click()
 await expect(summary).toContainText('Approved project total $125.00')
 await expect(summary).toContainText('Will be included on the final invoice')
 const estimateReview=page.getByRole('dialog', { name: 'Estimate preview', exact:true })
 await expect(estimateReview.locator('.record-detail-header')).toContainText('$105.00')
 await expect(estimateReview.getByRole('region',{name:'Estimate PDF',exact:true}).getByRole('button',{name:'Download PDF',exact:true})).toBeVisible()

 matching.status = 'declined'
 await page.evaluate(() => dispatchEvent(new Event('focus')))
 await expect(summary).toContainText('Declined')
 await expect(summary).not.toContainText('Approved project total')
})

test('the original issued invoice shows the approved project total and the separately billed change', async ({ page }) => {
 const { order, invoice } = await setup(page)
 const issued = { ...invoice, status: 'sent' }
 await page.route('**/rest/v1/invoices?*', route => reply(route, new URL(route.request().url()).searchParams.has('id') ? issued : [issued]))
 const approved = { ...order, status: 'approved', total: 20 }
 await page.route('**/rest/v1/change_orders?*', route => reply(route, [approved]))
 await page.route('**/rest/v1/rpc/get_document_change_context', route => reply(route, { can_change: true, current_total: 125 }))
 const changeInvoice = '77777777-7777-4777-8777-777777777777'
 let billed = false
 const allocation = { action: 'billed', invoice_id: changeInvoice, number: 'INV-CHANGE', status: 'draft' }
 await page.route('**/rest/v1/rpc/get_change_order_billing', route => reply(route, billed ? allocation : { action: 'create_invoice', total: 105, change_total: 20 }))
 await page.route('**/rest/v1/rpc/bill_approved_change_order', route => {
   expect(route.request().postDataJSON()).toMatchObject({ p_change: P, p_action: 'create_invoice', p_expected_total: 105 })
   billed = true
   return reply(route, allocation)
 })
 page.on('dialog', dialog => dialog.accept())
 await page.goto('/?view=invoices&document=' + E)
 const summary = page.getByRole('region', { name: 'Linked change orders' })
 await expect(summary).toContainText('Approved project total $125.00')
 await expect(summary).toContainText('Ready to bill')
 await summary.getByRole('button', { name: 'Review billing CO-QA' }).click()
 const billing = page.getByRole('region', { name: 'Change order billing' })
 await billing.getByRole('button', { name: 'Create change invoice' }).click()
 await expect(billing.getByRole('link', { name: 'Open invoice' })).toHaveAttribute('href', '/?view=invoices&document=' + changeInvoice)
 await page.getByRole('button', { name: 'Close review' }).click()
 await expect(summary).toContainText('Added to draft invoice · INV-CHANGE')
 await expect(summary.getByRole('link', { name: 'Open linked invoice' })).toHaveAttribute('href', '/?view=invoices&document=' + changeInvoice)
 await expect(page.locator('.invoice-hero-balance')).toContainText('Total $105.00')
})

for (const kind of ['invoice','estimate','change_order']) for (const failure of ['unavailable','unverified revision']) test(`${kind}: ${failure} PDF blocks sending until an explicit successful retry`, async ({page}) => {
 const {state}=await setup(page)
 let recovered=false
 const requests=[]
 await page.route('**/functions/v1/document-pdf',route=>{
  if(route.request().method()==='OPTIONS')return reply(route,{},200)
  requests.push(route.request().postDataJSON())
  if(recovered)return fulfillPdf(route)
  if(failure==='unavailable')return reply(route,{error:'The saved PDF is temporarily unavailable.'},503)
  const headers={...pdfHeaders};delete headers['x-finviant-revision-id']
  return route.fulfill({status:200,headers,body:PDF_BYTES})
 })
 const delivery=await openReview(page,kind)
 const dialog=page.getByRole('dialog',{name:kind==='change_order'?'Review change order':'Send '+kind,exact:true})
 await expect(dialog.getByRole('alert')).toContainText(failure==='unavailable'?'temporarily unavailable':'PDF version could not be verified')
 await expect(delivery.getByRole('button',{name:'Send Email',exact:true})).toBeDisabled()
 await expect(delivery.getByRole('button',{name:'Send Text',exact:true})).toBeDisabled()
 await expect(dialog.getByRole('button',{name:'Download PDF',exact:true})).toHaveCount(0)
 expect(state.calls.filter(call=>call.path.includes('/send-'))).toHaveLength(0)
 recovered=true
 await dialog.getByRole('button',{name:'Retry PDF',exact:true}).click()
 await expect(dialog.getByRole('button',{name:'Download PDF',exact:true})).toBeEnabled()
 await expect(delivery.getByRole('button',{name:'Send Email',exact:true})).toBeEnabled()
 await expect(dialog.getByRole('alert')).toHaveCount(0)
 expect(requests.at(-1)).toEqual({business_id:B,document_kind:kind,document_id:kind==='change_order'?P:E})
 expect(state.calls.filter(call=>call.path.includes('/send-'))).toHaveLength(0)
 expect(state.documents).toHaveLength(0)
})
