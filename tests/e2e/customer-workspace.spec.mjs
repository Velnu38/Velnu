import {mockJobDirectory} from './job-directory-fixture.mjs'
import { test, expect } from '@playwright/test'
import { createWork } from './navigation.mjs'
import { mock, B, C, E, P, J } from './audit-fixture.mjs'
const other='99999999-9999-4999-8999-999999999999'
const version='2026-11-04T15:00:00Z'
async function setup(page,{conflict=false,failCreate=false,deleteConflict=false}={}){
 const state=await mock(page)
 state.customers=[{id:C,first_name:'Jane',last_name:'Doe',company:null,email:'jane@example.test',phone:'7575551234',updated_at:version},{id:other,first_name:'Amy',last_name:'Adams',company:null},{id:J,first_name:null,last_name:null,company:'Bayside LLC'},{id:P,first_name:'Zoe',last_name:' brown ',company:null},{id:E,first_name:'Chris',last_name:null,company:'Zebra Services'}]
 const locations=[{id:P,business_id:B,customer_id:C,label:'Home',address_line1:'123 Example Street',city:'Chesapeake',state:'VA',postal_code:'23322',address_line2:null,access_notes:'Gate 98765',updated_at:version}]
 const writes=[],reads=[]
 const reply=(r,data,status=200)=>r.fulfill({status,contentType:'application/json',headers:{'access-control-expose-headers':'content-range','content-range':Array.isArray(data)?`0-${Math.max(0,data.length-1)}/${data.length}`:'0-0/1'},body:JSON.stringify(data)})
 const filtered=(data,q)=>data.filter(row=>['id','customer_id'].every(key=>!q.has(key)||q.get(key)==='eq.'+row[key]))
 await page.route('**/rest/v1/rpc/get_job_workflow_context',r=>{
  const body=r.request().postDataJSON()
  expect(body.p_business).toBe(B)
  return reply(r,body.p_jobs.filter(id=>[J,E,other].includes(id)).map(job_id=>({job_id,active_appointment:null,invoice:null})))
 })
 await page.route('**/rest/v1/customers?**',r=>{
  const q=new URL(r.request().url()).searchParams
  if(r.request().method()==='PATCH'){
   writes.push({method:'PATCH',table:'customers',q:Object.fromEntries(q),body:r.request().postDataJSON()})
   if(deleteConflict)return reply(r,{code:'PGRST116',message:'zero rows'},406)
   const row=state.customers.find(c=>q.get('id')==='eq.'+c.id);Object.assign(row,r.request().postDataJSON());return reply(r,row)}
  const rows=filtered(state.customers,q).filter(row=>q.get('archived')!=='eq.false'||!row.archived);return reply(r,q.has('id')?rows[0]:rows)
 })
 await page.route('**/rest/v1/properties?**',r=>{
  const req=r.request(),q=new URL(req.url()).searchParams
  if(req.method()==='PATCH'){
   writes.push({method:'PATCH',q:Object.fromEntries(q),body:req.postDataJSON()})
   if(conflict)return reply(r,{code:'PGRST116',message:'zero rows'},406)
   const row=locations.find(x=>q.get('id')==='eq.'+x.id);Object.assign(row,req.postDataJSON());return reply(r,row)
  }
  if(req.method()==='POST'){const row={...req.postDataJSON(),updated_at:version};writes.push({method:'POST',body:row});locations.push(row);return reply(r,row,201)}
  return reply(r,filtered(locations,q))
 })
 await page.route('**/rest/v1/rpc/create_customer_with_address',async r=>{
  const body=r.request().postDataJSON();writes.push({method:'RPC',body})
  if(failCreate){failCreate=false;return reply(r,{message:'Please retry the address save'},503)}
  const row={id:body.request_id,...body.payload,updated_at:version};state.customers.push(row);locations.push({id:body.request_id,customer_id:row.id,...body.payload.address,updated_at:version});return reply(r,row)
 })
 const recordsFor=table=>{
  const base={customer_id:C,customers:state.customers[0],total:100,balance_due:100,amount_paid:0,issue_date:'2026-11-03',created_at:version,updated_at:version}
  const records=table==='jobs'?[{...base,id:J,title:'Jane current job',status:'in_progress',scheduled_start:null},{...base,id:E,title:'Jane completed job',status:'completed',scheduled_start:null}]:[{...base,id:E,status:'draft',invoice_number:'INV-JANE',estimate_number:'EST-JANE'}]
  return [...records,{...base,id:other,customer_id:other,status:'draft',title:'Other customer job',invoice_number:'INV-OTHER',estimate_number:'EST-OTHER',customers:state.customers[1]}]
 }
 for(const table of ['jobs','estimates','invoices'])await page.route(`**/rest/v1/${table}?**`,r=>{
  const q=new URL(r.request().url()).searchParams;reads.push({table,q:Object.fromEntries(q)})
  const data=filtered(recordsFor(table),q)
  return reply(r,q.has('id')?data[0]:data)
 })
 await mockJobDirectory(page,params=>{reads.push({table:'jobs_page',q:params});return recordsFor('jobs').map(row=>({...row,active_appointment:null,invoice:null}))})
 return {state,locations,writes,reads}
}
test('customer list is last-name alphabetical with company fallback, and legacy Locations opens Customers',async({page})=>{
 await setup(page);await page.goto('/?view=locations')
 await expect(page).toHaveURL(/view=customers/)
 await expect(page.locator('.customer-row strong')).toHaveText(['Adams, Amy','brown, Zoe','Doe, Jane','Bayside LLC','Chris'])
 await expect(page.getByRole('button',{name:'Locations',exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:/New customer/}).click();await expect(page.getByLabel('Company (if applicable)',{exact:true})).toBeVisible();await expect(page.getByLabel('Street address (optional)',{exact:true})).toBeVisible()
})
for(const width of [1440,390])test(`snapshot routes only selected customer records and keeps navigation at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const {reads}=await setup(page);await page.goto('/?view=customers&document='+C)
 const snapshot=page.getByRole('region',{name:'Customer snapshot',exact:true});await expect(snapshot).toBeVisible();await expect(snapshot.getByRole('link')).toHaveCount(3)
 const contact=page.getByRole('region',{name:'Customer contact',exact:true}),address=contact.getByRole('group',{name:'Address',exact:true});await expect(address).toContainText('123 Example Street');await expect(address.getByRole('button',{name:'+ Add address',exact:true})).toBeVisible();await expect(contact.getByRole('button',{name:'Edit customer',exact:true})).toBeVisible();await expect(page.locator('.customer-addresses')).toHaveCount(0);await expect(page.getByRole('heading',{name:'Address & service locations',exact:true})).toHaveCount(0)
 expect(await address.evaluate((el)=>Boolean(el.compareDocumentPosition(document.querySelector('.customer-snapshot')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true)
 await expect(page.locator('.customer-document-history')).toHaveCount(0)
 await expect(page.getByRole('link',{name:/Get driving directions to/})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
 await page.screenshot({path:`test-results/customer-profile-${width}.png`,fullPage:true})
 for(const [kind,view] of [['jobs','work'],['estimates','estimates'],['invoices','invoices']]){
  await page.getByRole('link',{name:`View ${kind} for Jane Doe`}).click();await expect(page).toHaveURL(new RegExp(`view=${view}&customer=${C}`))
  await expect(page.getByLabel('Customer filter')).toContainText('Jane Doe')
  if(kind==='jobs'){await page.getByRole('button',{name:'Open filters',exact:true}).click();await page.getByRole('combobox',{name:'Job view'}).selectOption('all');await expect(page.getByRole('button',{name:'Open job Jane current job',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Open job Jane completed job',exact:true})).toBeVisible();await expect(page.locator('.jobs-record-list')).not.toContainText('Other customer job')}
  else {await expect(page.locator('.module-record-list')).toContainText(kind==='invoices'?'INV-JANE':'EST-JANE');await expect(page.locator('.module-record-list')).not.toContainText('OTHER')}
  if(kind==='jobs'){const request=reads.filter(r=>r.table==='jobs_page').at(-1);expect(request.q.p_business).toBe(B);expect(request.q.p_customer).toBe(C)}else{const request=reads.filter(r=>r.table===kind).at(-1);expect(request.q.business_id).toBe('eq.'+B);expect(request.q.customer_id).toBe('eq.'+C)}
  await page.getByRole('link',{name:'Back to customer',exact:true}).click();await expect(snapshot).toBeVisible()
 }
 await page.getByRole('link',{name:'View invoices for Jane Doe'}).click();await page.getByRole('link',{name:'View all invoices',exact:true}).click();await expect(page).toHaveURL(/view=invoices$/);await expect(page.locator('.module-record-list')).toContainText('INV-OTHER')
})
test('new customer and address submit together and reuse the request after failure',async({page})=>{
 const {writes}=await setup(page,{failCreate:true});await page.goto('/?view=customers');await page.getByRole('button',{name:/New customer/}).click()
 const dialog=page.getByRole('dialog',{name:'Add a customer',exact:true});await dialog.getByLabel('First name',{exact:true}).fill('Taylor');await dialog.getByLabel('Last name',{exact:true}).fill('Smith');await dialog.getByLabel('Street address (optional)',{exact:true}).fill('42 New Street');await dialog.getByLabel('City',{exact:true}).fill('Chesapeake')
 await dialog.getByRole('button',{name:'Save customer',exact:true}).click();await expect(dialog).toContainText('Please retry the address save');await expect(dialog.getByLabel('Street address (optional)',{exact:true})).toHaveValue('42 New Street')
 await dialog.getByRole('button',{name:'Save customer',exact:true}).click();await expect(page.getByRole('heading',{name:'Taylor Smith',exact:true})).toBeVisible();await expect(page.getByText('42 New Street',{exact:true})).toBeVisible()
 expect(writes).toHaveLength(2);expect(writes[0].body.request_id).toBe(writes[1].body.request_id);expect(writes[0].body.target_business_id).toBe(B);expect(writes[0].body.payload.address.address_line1).toBe('42 New Street')
})
test('customer location can be edited without changing its identity and maps exclude access notes',async({page})=>{
 const {writes}=await setup(page);await page.goto('/?view=customers&document='+C);await page.getByRole('button',{name:'Edit address 123 Example Street'}).click()
 const dialog=page.getByRole('dialog',{name:'Edit address',exact:true});await dialog.getByLabel('Street address',{exact:true}).fill('456 Updated Street');await dialog.getByRole('button',{name:'Save address',exact:true}).click();await expect(dialog).toHaveCount(0)
 const map=page.getByRole('link',{name:/View 456 Updated Street/});await expect(map).toBeVisible();expect(await map.getAttribute('href')).not.toContain('98765')
 expect(writes[0].q).toMatchObject({business_id:'eq.'+B,customer_id:'eq.'+C,id:'eq.'+P,updated_at:'eq.'+version});expect(writes[0].body).not.toHaveProperty('customer_id')
 await page.getByRole('button',{name:'Edit customer',exact:true}).click();await expect(page.getByLabel('Company (if applicable)',{exact:true})).toBeVisible()
})
test('stale address edit preserves user input and shows a recoverable conflict',async({page})=>{
 await setup(page,{conflict:true});await page.goto('/?view=customers&document='+C);await page.getByRole('button',{name:'Edit address 123 Example Street'}).click();const dialog=page.getByRole('dialog',{name:'Edit address',exact:true});await dialog.getByLabel('Street address',{exact:true}).fill('Unsaved edit');await dialog.getByRole('button',{name:'Save address',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('changed elsewhere');await expect(dialog.getByLabel('Street address',{exact:true})).toHaveValue('Unsaved edit')
})
test('additional addresses stay with their customer and are available when selecting a job location',async({page})=>{
 const {locations,writes}=await setup(page);await page.goto('/?view=customers&document='+C)
 await page.getByRole('button',{name:'+ Add address',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Add address',exact:true})
 await dialog.getByLabel('Location name (optional)',{exact:true}).fill('Rental');await dialog.getByLabel('Street address',{exact:true}).fill('789 Rental Street');await dialog.getByRole('button',{name:'Save address',exact:true}).click();await expect(dialog).toHaveCount(0)
 await expect(page.getByText('123 Example Street',{exact:true})).toBeVisible();await expect(page.getByText('789 Rental Street',{exact:true})).toBeVisible();expect(locations).toHaveLength(2);expect(writes[0].body.customer_id).toBe(C);expect(writes[0].body.business_id).toBe(B)
 await createWork(page,'job');await page.getByRole('combobox',{name:'Customer',exact:true}).click();await page.locator('[data-customer-id="'+C+'"]').click();await expect(page.getByLabel('Service location',{exact:true}).getByRole('option',{name:/789 Rental Street/})).toHaveCount(1)
})

for(const width of [390,1440])test(`customer rows have visible dividers, last-name labels and keyboard access at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await setup(page);await page.goto('/?view=customers')
 const rows=page.getByRole('region',{name:'Customer directory'}).locator('.customer-row-button')
 await expect(rows).toHaveCount(5);await expect(rows.first()).toContainText('Adams, Amy');await expect(rows.nth(1)).toContainText('brown, Zoe')
 for(let i=0;i<4;i++){await expect(rows.nth(i)).toHaveCSS('border-bottom-width','2px');await expect(rows.nth(i)).toHaveCSS('border-bottom-color','rgb(198, 210, 223)')}
 await expect(rows.last()).toHaveCSS('border-bottom-width','0px');await expect(rows.nth(1)).toHaveCSS('background-color','rgb(247, 250, 252)')
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:`test-results/customer-directory-${width}.png`,fullPage:true})
 await rows.filter({hasText:'Doe, Jane'}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'Jane Doe',exact:true})).toBeVisible()
})

test('last-name order is preserved across pagination and search',async({page})=>{
 const {state}=await setup(page);state.customers=Array.from({length:31},(_,i)=>({id:`99999999-9999-4999-8999-${String(i).padStart(12,'0')}`,first_name:'Contact '+String(31-i),last_name:'Surname '+String(i).padStart(2,'0')})).reverse()
 await page.goto('/?view=customers');await expect(page.locator('.customer-row strong')).toHaveText(Array.from({length:25},(_,i)=>`Surname ${String(i).padStart(2,'0')}, Contact ${31-i}`))
 await page.getByRole('navigation',{name:'customers pages'}).getByRole('button',{name:'Next'}).click();await expect(page.locator('.customer-row strong')).toHaveText(Array.from({length:6},(_,n)=>`Surname ${25+n}, Contact ${6-n}`))
 await page.getByLabel('Search customers').fill('Surname 0');await expect(page.locator('.customer-row strong')).toHaveText(Array.from({length:10},(_,i)=>`Surname 0${i}, Contact ${31-i}`));await expect(page.getByRole('navigation',{name:'customers pages'})).toContainText('Page 1 of 1')
})

test('a contact without an address can add one directly from its Address field',async({page})=>{
 const {locations,writes}=await setup(page);locations.splice(0)
 await page.goto('/?view=customers&document='+C);const address=page.getByRole('region',{name:'Customer contact'}).getByRole('group',{name:'Address',exact:true})
 await expect(address).toContainText('No address added');await address.getByRole('button',{name:'+ Add address',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Add address',exact:true});await dialog.getByLabel('Street address',{exact:true}).fill('456 Contact Street');await dialog.getByLabel('City',{exact:true}).fill('Chesapeake');await dialog.getByRole('button',{name:'Save address',exact:true}).click()
 await expect(address).toContainText('456 Contact Street');await expect(address.getByRole('link',{name:/Get driving directions to/})).toBeVisible();expect(writes[0].body.customer_id).toBe(C);expect(locations).toHaveLength(1)
})

test('alphabetic surnames stay ahead of numbered imports across pages and after a last-name edit',async({page})=>{
 const {state}=await setup(page)
 state.customers.push(...Array.from({length:100},(_,n)=>({id:`qa-${n}`,first_name:'QA Customer',last_name:String(n+1).padStart(3,'0'),company:`Synthetic client ${n+1}`})))
 await page.goto('/?view=customers')
 await expect(page.locator('.customer-row strong').first()).toHaveText('Adams, Amy')
 expect((await page.locator('.customer-row strong').allTextContents()).slice(0,5)).toEqual(['Adams, Amy','brown, Zoe','Doe, Jane','Bayside LLC','Chris'])
 await page.getByRole('navigation',{name:'customers pages'}).getByRole('button',{name:'Next'}).click()
 await expect(page.locator('.customer-row strong').first()).toHaveText('021, QA Customer')
 await page.getByLabel('Search customers').fill('Amy')
 await expect(page.locator('.customer-row strong')).toHaveText(['Adams, Amy'])
 state.customers.find(c=>c.first_name==='Amy').last_name='Zimmerman'
 await page.evaluate(()=>window.dispatchEvent(new Event('finviant-assistant-saved')))
 await expect(page.locator('.customer-row strong')).toHaveText(['Zimmerman, Amy'])
 await page.getByLabel('Search customers').fill('')
 expect((await page.locator('.customer-row strong').allTextContents()).slice(0,3)).toEqual(['brown, Zoe','Doe, Jane','Zimmerman, Amy'])
})

for(const conflict of [false,true])test('delete contact confirms and preserves history; conflict='+conflict,async({page})=>{
 const {writes,state,locations}=await setup(page,{deleteConflict:conflict})
 await page.goto('/?view=customers&document='+C)
 await page.getByRole('button',{name:'Edit customer',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Edit customer',exact:true})
 await dialog.getByRole('button',{name:'Delete Contact',exact:true}).click()
 await expect(dialog).toContainText('will be retained')
 await dialog.getByRole('button',{name:'Keep contact',exact:true}).click()
 expect(writes).toHaveLength(0)
 await dialog.getByRole('button',{name:'Delete Contact',exact:true}).click()
 // A click can finish before the asynchronous PATCH reaches the route fixture.
 // Wait for its actual response, retaining the exact write-count/version checks.
 const archiveResponse=page.waitForResponse(response=>response.request().method()==='PATCH'&&new URL(response.url()).pathname.endsWith('/customers'))
 await dialog.getByRole('button',{name:'Confirm Delete Contact',exact:true}).click()
 await archiveResponse
 expect(writes).toHaveLength(1)
 expect(writes[0]).toMatchObject({table:'customers',body:{archived:true},q:{id:'eq.'+C,business_id:'eq.'+B,updated_at:'eq.'+version}})
 expect(locations).toHaveLength(1)
 if(conflict){await expect(dialog).toContainText('changed elsewhere');expect(state.customers[0].archived).toBeUndefined()}
 else{
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/view=customers$/)
  await expect(page.locator('.customer-row strong')).not.toContainText(['Doe, Jane'])
  expect(state.customers.find(c=>c.id===C).email).toBe('jane@example.test')
 }
 expect(writes).toHaveLength(1)
})
