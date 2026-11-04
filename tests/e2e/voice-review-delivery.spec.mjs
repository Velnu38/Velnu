import {test,expect} from '@playwright/test'
import {mock,C} from './audit-fixture.mjs'
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'}
async function review(page,kind='invoice',contact={email:'customer@example.test'},options={}){
 const state=await mock(page,{ai:true});state.customers[0]={...state.customers[0],...contact,updated_at:'2026-11-04T10:00:00Z'}
 await page.goto('/');await page.getByRole('button',{name:'Talk to Fin'}).click();await page.getByRole('textbox',{name:'Describe your invoice or request'}).fill(`Create ${kind} for Test Customer for landscaping $200 and painting $100`);await page.getByRole('button',{name:`Review ${kind}`,exact:true}).click()
 const region=page.getByRole('region',{name:`Review ${kind} draft`});await expect(region.getByRole('combobox',{name:'Customer',exact:true})).toHaveValue(C)
 return {state,region}
}
for(const kind of ['invoice','estimate'])for(const width of [390,1440])test(`review directly emails ${kind} once at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:950});const {state,region}=await review(page,kind);const sends=[]
 await page.route('**/functions/v1/send-*-email',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
  sends.push(route.request().postDataJSON());await new Promise(r=>setTimeout(r,100));return route.fulfill({status:200,headers:cors,json:{status:'accepted',email_id:'email-1',recipient:'customer@example.test'}})
 })
 await expect(region.getByText('To: customer@example.test')).toBeVisible();await expect(region.getByRole('button',{name:`Text ${kind}`})).toHaveCount(0)
 await page.screenshot({path:`test-results/voice-review-${kind}-${width}.png`,fullPage:true})
 await region.getByRole('button',{name:`Email ${kind}`,exact:true}).dblclick()
 await expect(page.getByRole('status').filter({hasText:'Email accepted for delivery to customer@example.test'})).toBeVisible()
 expect(state.documents).toHaveLength(1);expect(sends).toHaveLength(1);expect(sends[0].expected_recipient).toBe('customer@example.test');expect(sends[0].request_id).toBeTruthy();expect(sends[0].invoice_id||sends[0].document_id).toBe('44444444-4444-4444-8444-444444444444')
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
test('unknown send outcome preserves document and request ID, locks reviewed data',async({page})=>{
 const {state,region}=await review(page);const sends=[]
 await page.route('**/functions/v1/send-invoice-email',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
  sends.push(route.request().postDataJSON());return route.fulfill({status:sends.length===1?503:200,headers:cors,json:sends.length===1?{error:'Outcome uncertain. Retry the same send.'}:{status:'accepted',email_id:'email-1',recipient:'customer@example.test'}})
 })
 await region.getByRole('button',{name:'Email invoice',exact:true}).click();await expect(region.getByRole('alert')).toContainText('Outcome uncertain');await expect(region.getByRole('textbox',{name:'Line 1 description'})).toBeDisabled();await expect(region.getByRole('button',{name:'Done — keep saved document'})).toBeEnabled()
 await region.getByRole('button',{name:'Retry email',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Email accepted'})).toBeVisible();expect(state.documents).toHaveLength(1);expect(sends).toHaveLength(2);expect(sends[1]).toEqual(sends[0])
})
test('no contacts means no send buttons; adding email inline enables sending',async({page})=>{
 const {region}=await review(page,'estimate',{email:null,phone:null});await expect(region.getByRole('button',{name:'Email estimate'})).toHaveCount(0);await expect(region.getByRole('button',{name:'Text estimate'})).toHaveCount(0)
 await region.getByText('Add email or phone to send (optional)',{exact:true}).click();await region.getByRole('textbox',{name:'Customer email'}).fill('bad-email');await expect(region.getByRole('button',{name:'Email estimate'})).toBeDisabled();await region.getByRole('textbox',{name:'Customer email'}).fill('new@example.test');await expect(region.getByRole('button',{name:'Email estimate'})).toBeEnabled()
})
test('phone-only customer shows SMS setup state, with no false send or email option',async({page})=>{
 const {region,state}=await review(page,'invoice',{email:null,phone:'7575550123'});await expect(region.getByRole('button',{name:'Email invoice'})).toHaveCount(0);await expect(region.getByRole('button',{name:'Text invoice'})).toBeDisabled();await expect(region.getByText(/Customer text delivery is awaiting SMS setup/)).toBeVisible();await region.getByRole('button',{name:'Save draft invoice'}).click();expect(state.documents).toHaveLength(1);expect(state.calls.filter(c=>c.path.includes('send-'))).toHaveLength(0)
})
test('contact edit only patches reviewed fields with business and version guards',async({page})=>{
 const {region}=await review(page);let patch
 await page.route('**/rest/v1/customers?*',async route=>{
  if(route.request().method()!=='PATCH')return route.fallback()
  patch={body:route.request().postDataJSON(),url:route.request().url()};return route.fulfill({status:200,headers:cors,json:{id:C,first_name:'Test',last_name:'Customer',email:'updated@example.test',phone:null,updated_at:'2026-11-04T11:00:00Z'}})
 })
 await region.getByText('Customer contact details',{exact:true}).click();await region.getByRole('textbox',{name:'Customer email'}).fill('updated@example.test');await region.getByRole('button',{name:'Save draft invoice'}).click();await expect.poll(()=>patch).toBeTruthy();expect(patch.body).toEqual({email:'updated@example.test',phone:null});expect(patch.url).toContain('business_id=eq.');expect(patch.url).toContain('updated_at=eq.')
})
test('customer contact conflict prevents document creation or delivery',async({page})=>{
 const {region,state}=await review(page)
 await page.route('**/rest/v1/customers?*',async route=>{
  if(route.request().method()!=='PATCH')return route.fallback()
  return route.fulfill({status:406,headers:cors,json:{code:'PGRST116',message:'No rows'}})
 })
 await region.getByText('Customer contact details',{exact:true}).click();await region.getByRole('textbox',{name:'Customer email'}).fill('updated@example.test');await region.getByRole('button',{name:'Email invoice',exact:true}).click();await expect(region.getByRole('alert')).toContainText('changed elsewhere');expect(state.documents).toHaveLength(0)
})
test('new customer contact is saved atomically with document before email, save failure never sends',async({page})=>{
 const {region}=await review(page);const writes=[],sends=[]
 await region.getByRole('combobox',{name:'Customer',exact:true}).selectOption('__new__');await region.getByRole('textbox',{name:'New customer name or company'}).fill('New Customer')
 await region.getByText('Add email or phone to send (optional)',{exact:true}).click();await region.getByRole('textbox',{name:'Customer email'}).fill('new@example.test')
 await page.route('**/rest/v1/rpc/create_document',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
  writes.push(route.request().postDataJSON());return route.fulfill({status:writes.length===1?503:200,headers:cors,json:writes.length===1?{message:'Save unavailable'}:{id:'44444444-4444-4444-8444-444444444444',total:300,status:'draft'}})
 })
 await page.route('**/functions/v1/send-invoice-email',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
  sends.push(route.request().postDataJSON());return route.fulfill({status:200,headers:cors,json:{status:'accepted',email_id:'email-new',recipient:'new@example.test'}})
 })
 await region.getByRole('button',{name:'Email invoice',exact:true}).click();await expect(region.getByRole('alert')).toBeVisible();expect(sends).toHaveLength(0)
 await region.getByRole('button',{name:'Email invoice',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Email accepted'})).toBeVisible();expect(writes[0]).toEqual(writes[1]);expect(writes[0].payload.new_customer.email).toBe('new@example.test');expect(sends).toHaveLength(1)
})
