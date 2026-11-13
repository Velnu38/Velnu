import {test,expect} from '@playwright/test'
import {mkdir} from 'node:fs/promises'
import {mock,E,C,J,customer} from './audit-fixture.mjs'
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'}
async function screenshot(page,name){await page.evaluate(()=>document.fonts.ready);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await mkdir('tmp/document-review',{recursive:true});await page.screenshot({path:`tmp/document-review/${name}.png`,fullPage:true})}
for(const width of [320,390,430])test(`invoice mockup list detail and creation at ${width}px`,async({page})=>{
 const state=await mock(page,{ai:true});await page.setViewportSize({width,height:900})
 const invoice={id:E,customer_id:C,job_id:J,invoice_number:'INV-1042',status:'sent',issue_date:'2026-11-12',due_date:'2099-11-30',created_at:'2026-11-12T12:00:00Z',total:12000,subtotal:12000,tax_amount:0,amount_paid:4000,balance_due:8000,customers:customer}
 await page.route('**/rest/v1/invoices?*',r=>r.fulfill({headers:{...headers,'content-range':'0-0/1','access-control-expose-headers':'content-range'},json:new URL(r.request().url()).searchParams.has('id')?invoice:[invoice]}))
 await page.route('**/rest/v1/rpc/get_invoice_payment_operations',r=>r.fulfill({headers,json:{state:'clear',refunds:[]}}))
 await page.goto('/?view=invoices');await expect(page.getByRole('heading',{name:'Invoices',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/Open invoice INV-1042/})).toBeVisible();await screenshot(page,`invoice-list-${width}`)
 await page.getByRole('button',{name:/Open invoice INV-1042/}).click();await expect(page.getByRole('tab',{name:'Details',exact:true})).toBeVisible();await expect(page.locator('.document-phone-summary')).toContainText('$8,000.00');await screenshot(page,`invoice-details-${width}`)
 await page.getByRole('button',{name:'Payments Review payments',exact:true}).click();await expect(page.getByRole('heading',{name:'Payment history',exact:true})).toBeVisible();await screenshot(page,`invoice-activity-${width}`)
 await page.getByRole('tab',{name:'Photos & expenses',exact:true}).click();await screenshot(page,`invoice-resources-${width}`)
 await page.getByRole('button',{name:'← Invoices',exact:true}).click();await page.getByRole('button',{name:'Create invoice',exact:true}).click();const form=page.getByRole('dialog',{name:'Create an invoice',exact:true});await expect(form).toBeVisible();const box=await form.boundingBox();expect(box.width).toBe(width);await screenshot(page,`invoice-create-${width}`)
 expect(state.calls.some(c=>/send-|record_invoice_payment|create_invoice_atomic/.test(c.path))).toBe(false)
})
