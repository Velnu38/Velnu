import {test,expect} from '@playwright/test'
import {mock,B,business} from './audit-fixture.mjs'
for(const width of [390,1440])for(const kind of ['Income','Expense'])test(`financial ${kind} entry saves and refreshes at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await mock(page,{ai:true});let rows=[],writes=[]
 await page.route('**/rest/v1/bookkeeping_entries*',route=>{
  if(route.request().method()==='POST'){const body=route.request().postDataJSON();writes.push(body);rows=[{...body,currency:'USD'}];return route.fulfill({status:201,json:body})}
  return route.fulfill({json:rows,headers:{'content-range':`0-0/${rows.length}`,'access-control-expose-headers':'content-range'}})
 })
 await page.goto('/');const widget=page.getByRole('region',{name:'Financial Performance',exact:true})
 await widget.getByRole('button',{name:'+ Add Entry',exact:true}).click();await page.getByRole('button',{name:'Add '+kind,exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Add '+kind,exact:true});await expect(dialog.getByRole('button',{name:'Ask Fin',exact:true})).toBeVisible()
 await dialog.getByLabel('Amount in USD',{exact:true}).fill('125');await dialog.getByLabel('Description',{exact:true}).fill('Manual test')
 await dialog.getByRole('button',{name:'Save entry',exact:true}).click();await expect(dialog).toHaveCount(0);expect(writes).toHaveLength(1);expect(writes[0].direction).toBe(kind.toLowerCase());expect(writes[0].business_id).toBe(B)
 await expect(widget.getByRole('status')).toContainText(kind+' saved');await expect(widget.locator('.performance-metric.'+kind.toLowerCase())).toContainText('$125.00')
 await expect(widget).toContainText('Net Cash Flow')
})
test('invoice income opens existing payment recording instead of creating manual income',async({page})=>{
 const state=await mock(page);await page.goto('/');await page.getByRole('button',{name:'+ Add Entry',exact:true}).click();await page.getByRole('button',{name:'Add Income',exact:true}).click();await page.getByRole('link',{name:'Select invoice and record payment'}).click();await expect(page.getByRole('dialog',{name:'Record a payment already received'})).toBeVisible();expect(state.calls.some(c=>c.path.endsWith('/bookkeeping_entries')&&c.method==='POST')).toBe(false)
})
test('out of period entry confirms saved without changing selected period',async({page})=>{
 await mock(page);await page.route('**/rest/v1/bookkeeping_entries*',r=>r.fulfill({json:r.request().method()==='POST'?r.request().postDataJSON():[]}));await page.goto('/');await page.getByRole('button',{name:'+ Add Entry',exact:true}).click();await page.getByRole('button',{name:'Add Expense',exact:true}).click();const d=page.getByRole('dialog',{name:'Add Expense'});await d.getByLabel('Transaction date').fill('2020-01-01');await d.getByLabel('Amount in USD',{exact:true}).fill('5');await d.getByLabel('Description',{exact:true}).fill('Old expense');await d.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'outside the selected period'})).toBeVisible()
})
