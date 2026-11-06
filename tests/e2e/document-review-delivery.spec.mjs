import {workflow,start,save,docStep,item} from './fin-workflow-fixture.mjs'
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
  await page.getByRole('button',{name:'Change order',exact:true}).click()
  await page.getByRole('dialog',{name:'Create change order'}).getByRole('button',{name:'Close',exact:true}).click()
  await page.getByRole('button',{name:'Review / Send'}).click()
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
 if(hasEmail)await expect(delivery.getByRole('button',{name:'Send Email'})).toBeEnabled()
 else await expect(delivery.getByRole('button',{name:'Send Email'})).toBeDisabled()
 if(hasSms){await expect(delivery.getByRole('button',{name:'Send Text'})).toBeDisabled();await expect(delivery).toContainText('pending sender activation')}
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
 const delivery=await openReview(page,kind);await delivery.getByRole('button',{name:'Send Email',exact:true}).dblclick()
 await expect(page.getByRole('status').filter({hasText:'Email accepted for delivery'})).toBeVisible()
 await expect(delivery).toHaveCount(1)
 expect(sends).toHaveLength(1);expect(sends[0].expected_recipient).toBe('customer@example.test');expect(sends[0].business_id).toBe(B)
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
 await page.getByRole('button',{name:'← Invoices',exact:true}).click();await page.locator('.invoice-open').first().click()
 delivery=page.getByRole('region',{name:'Send to customer'});await delivery.getByRole('button',{name:'Send Email',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Email accepted for delivery'})).toBeVisible();expect(sends).toHaveLength(2);expect(sends[0]).toEqual(sends[1])
})
for(const kind of ['invoice','estimate'])test(`Fin retains delivery controls immediately after saving a ${kind} draft`,async({page})=>{
 const {state,executions}=await workflow(page,{steps:[docStep(kind,[item('Landscaping',100)])],contact:{email:'customer@example.test',phone:'7575550123'}})
 await start(page,`Create ${kind} for Test Customer for landscaping $100`);expect(executions).toHaveLength(0);await save(page)
 const dialog=page.getByRole('dialog',{name:'Fin — your office assistant'})
 await expect(dialog.getByRole('region',{name:'Send to customer'})).toBeVisible();await expect(dialog.getByRole('button',{name:'Send Email',exact:true})).toBeEnabled()
 await expect(dialog.getByRole('button',{name:'Send Text',exact:true})).toBeVisible();expect(state.documents).toHaveLength(1)
 expect(state.calls.some(call=>call.path.includes('/send-'))).toBe(false)
})
test('creating a change order opens its review and delivery controls automatically',async({page})=>{
 const {state}=await setup(page);await page.goto('/?view=invoices&document='+E);await page.getByRole('button',{name:'Change order',exact:true}).click()
 const form=page.getByRole('dialog',{name:'Create change order'});await form.getByLabel('Line 1 description').fill('Two fixtures');await form.getByLabel('Line 1 unit price').fill('50')
 await form.getByRole('button',{name:'Create change order',exact:true}).click()
 const review=page.getByRole('dialog',{name:'Review change order'});await expect(review).toBeVisible();await expect(review.getByRole('button',{name:'Send Email'})).toBeEnabled();await expect(review.getByText('Two fixtures',{exact:true})).toBeVisible();expect(state.changes).toHaveLength(1)
})
test('switching change orders ignores a late line-item response from the previous review',async({page})=>{
 const {order}=await setup(page);const otherId='77777777-7777-4777-8777-777777777777';let releaseFirst
 const firstReleased=new Promise(resolve=>{releaseFirst=resolve})
 const other={...order,id:otherId,change_order_number:'CO-OTHER',title:'Different work'}
 await page.route('**/rest/v1/change_orders?*',route=>reply(route,[order,other]))
 let firstStarted=false
 await page.route('**/rest/v1/change_order_items?*',async route=>{
  const first=new URL(route.request().url()).searchParams.get('change_order_id')==='eq.'+P
  if(first){firstStarted=true;await firstReleased}
  return reply(route,[{id:E,description:first?'First order lines':'Second order lines',quantity:1,unit_price:100,line_total:100,tax_rate:5}])
 })
 await page.goto('/?view=invoices&document='+E);await page.getByRole('button',{name:'Change order',exact:true}).click();await page.getByRole('dialog',{name:'Create change order'}).getByRole('button',{name:'Close',exact:true}).click()
 await page.getByRole('button',{name:'Review / Send'}).first().click();await expect.poll(()=>firstStarted).toBe(true)
 await page.getByRole('button',{name:'Close review',exact:true}).click();await page.getByRole('button',{name:'Review / Send'}).last().click()
 const review=page.getByRole('dialog',{name:'Review change order'});await expect(review.getByText('Second order lines',{exact:true})).toBeVisible()
 const lateResponse=page.waitForResponse(response=>response.url().includes('/change_order_items')&&new URL(response.url()).searchParams.get('change_order_id')==='eq.'+P)
 releaseFirst();await lateResponse
 await expect(review.getByText('Second order lines',{exact:true})).toBeVisible();await expect(review.getByText('First order lines',{exact:true})).toHaveCount(0)
})
