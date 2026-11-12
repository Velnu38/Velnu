import {test,expect} from '@playwright/test'
import {mock,E,C,customer} from './audit-fixture.mjs'
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'}
const reply=(route,json,status=200)=>route.fulfill({status,headers,json})
for(const width of [390,1280])test(`invoice and Send Reminder expose read-only history at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:950});const state=await mock(page,{ai:true});let reads=0
 const invoice={id:E,customer_id:C,invoice_number:'INV-HISTORY',status:'overdue',issue_date:'2026-01-01',due_date:'2026-01-02',created_at:'2026-01-01T12:00:00Z',total:105,subtotal:100,tax_amount:5,amount_paid:25,balance_due:80,customers:customer}
 await page.route('**/rest/v1/rpc/get_invoice_payment_operations',route=>reply(route,{state:'clear',refunds:[]}))
 await page.route('**/rest/v1/invoices?*',route=>reply(route,new URL(route.request().url()).searchParams.has('id')?invoice:[invoice]))
 const row={id:E,created_at:'2026-11-01T12:00:00Z',channel:'email',recipient:'synthetic@example.test',source:'automatic',initiator:'Automatic rule',status:'uncertain',attempts:1,detail:null,events:[]}
 await page.route('**/rest/v1/rpc/get_invoice_reminder_history',route=>{reads++;return reply(route,{invoice_id:E,items:[row],has_more:false,last_attempt:row,last_success:null})})
 // History must remain accessible even when a reminder can no longer be prepared.
 await page.route('**/rest/v1/rpc/get_invoice_reminder_review',route=>reply(route,{message:'This invoice is no longer overdue.'},400))
 await page.goto('/?view=invoices&document='+E)
 await page.getByRole('button',{name:'Reminder history',exact:true}).click()
 let history=page.getByRole('region',{name:'Invoice reminder history'});await expect(history).toContainText('Uncertain');await expect(history).toContainText('Automatic rule');await expect(history).toContainText('Viewing or refreshing history never sends')
 await history.getByRole('button',{name:'Refresh reminder history'}).click();expect(reads).toBeGreaterThan(1)
 await page.reload();await page.getByRole('button',{name:'Reminder history',exact:true}).click();await expect(history).toContainText('synthetic@example.test')
 await page.getByRole('button',{name:'Send reminder',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Send invoice reminder'});await dialog.getByRole('button',{name:'View reminder history'}).click();await expect(dialog.getByRole('region',{name:'Invoice reminder history'})).toContainText('Uncertain')
 expect(state.calls.some(call=>call.path.includes('/send-'))).toBe(false)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
