import {openHomePanels} from './navigation.mjs'
import {mockJobDirectory} from './job-directory-fixture.mjs'
import { test, expect } from '@playwright/test'
import { DateTime } from 'luxon'
import { mock as auditMock, B, C, E, J, P, customer } from './audit-fixture.mjs'
import { attentionPage } from './attention-fixture.mjs'
import { workflow, start } from './fin-workflow-fixture.mjs'

const mobile = { width: 390, height: 844 }
const headers = { 'content-range':'0-0/1', 'access-control-expose-headers':'content-range' }
const job = { id:J, customer_id:C, customers:[customer], title:'Landscaping', status:'lead', scheduled_start:null, properties:[] }
async function jobContext(page, completed=()=>false) {
  await page.route('**/rest/v1/rpc/get_job_workflow_context',route=>{
    const body=route.request().postDataJSON();expect(body.p_business).toBe(B)
    return route.fulfill({json:body.p_jobs.filter(id=>id===J).map(job_id=>({job_id,active_appointment:null,invoice:completed()?{id:E,status:'draft',number:'INV-QA'}:null}))})
  })
}
async function mock(page,options) {
  const state=await auditMock(page,options)
  await jobContext(page,()=>state.completed)
  await page.route('**/rest/v1/rpc/get_invoice_payment_operations',route=>route.fulfill({json:{state:'clear',operations:[],refunds:[]}}))
  await page.route('**/rest/v1/rpc/get_estimate_workflow_context',route=>{
    const body=route.request().postDataJSON();expect(body.p_business).toBe(B)
    return route.fulfill({json:body.p_estimates.filter(id=>id===E).map(estimate_id=>({estimate_id,job:null,appointment:null,schedule:null,invitation:null,final_invoice_id:null}))})
  })
  return state
}
async function savedJob(page) {
  await mockJobDirectory(page,()=>[{...job,active_appointment:null,invoice:null}])
  await jobContext(page)
  await page.route('**/rest/v1/jobs?**', route => route.fulfill({
    json:new URL(route.request().url()).searchParams.has('id') ? job : [job], headers,
  }))
}

async function fillInvoice(page) {
  await page.goto('/?view=invoices')
  await page.getByRole('button',{name:'Create invoice',exact:true}).click()
  const editor = page.getByRole('dialog',{name:'Create an invoice',exact:true})
  await editor.getByRole('combobox',{name:'Customer',exact:true}).fill('Test')
  await editor.getByRole('option',{name:/Test Customer/}).click()
  await editor.getByLabel('Line 1 description',{exact:true}).fill('Landscaping')
  await editor.getByLabel('Line 1 unit price',{exact:true}).fill('125')
  return editor
}

test('customer shortcuts use the saved customer and its only location, and Save Draft skips preview',async({page})=>{
  await page.setViewportSize(mobile)
  const state = await mock(page)
  await page.route('**/rest/v1/customers?**',route=>route.fulfill({
    json:new URL(route.request().url()).searchParams.has('id')?{...customer,phone:'+17575550123'}:[customer], headers,
  }))
  await page.route('**/rest/v1/properties?**',route=>route.fulfill({json:[{id:P,label:'Job site',address_line1:'1 Test Street'}],headers}))
  await page.goto('/?view=customers&document='+C)
  await expect(page.getByRole('link',{name:'customer@example.test',exact:true})).toHaveAttribute('href','mailto:customer@example.test')
  await expect(page.getByRole('link',{name:'+17575550123',exact:true})).toHaveAttribute('href','tel:+17575550123')
  await page.getByRole('link',{name:'New invoice',exact:true}).click()
  const editor = page.getByRole('dialog',{name:'Create an invoice',exact:true})
  await expect(editor.getByRole('combobox',{name:'Customer',exact:true})).toHaveValue('Test Customer')
  await expect(editor.getByRole('combobox',{name:'Service location',exact:true})).toHaveValue(P)
  await editor.getByLabel('Line 1 description',{exact:true}).fill('Landscaping')
  await editor.getByLabel('Line 1 unit price',{exact:true}).fill('125')
  await editor.getByRole('button',{name:'Save Draft',exact:true}).click()
  await expect(page).toHaveURL(new RegExp('document='+E))
  expect(state.documents).toHaveLength(1)
  expect(state.documents[0].payload.property_id).toBe(P)
  await page.goto('/?view=customers&document='+C)
  await page.getByRole('link',{name:'New job',exact:true}).click()
  await expect(page.getByRole('dialog').getByRole('combobox',{name:'Customer',exact:true})).toHaveValue('Test Customer')
})

test('mobile preview keeps Send in view and returns from setup to the same saved draft',async({page})=>{
  await page.setViewportSize(mobile)
  const state = await mock(page,{ai:true})
  await page.route('**/rest/v1/rpc/save_delivery_setup',route=>route.fulfill({
    json:{plan:'pro',email:'owner@example.test',phone:'+17575550100',personal_email_ready:true,personal_sms_ready:false,managed_email_ready:true,acknowledged:true},
  }))
  const editor = await fillInvoice(page)
  for(let line=2;line<=6;line++){
    await editor.getByRole('button',{name:'+ Add line',exact:true}).click()
    await editor.getByLabel('Line '+line+' description',{exact:true}).fill('Service '+line)
    await editor.getByLabel('Line '+line+' unit price',{exact:true}).fill('20')
  }
  await editor.getByRole('button',{name:'Preview',exact:true}).click()
  await expect(editor.getByRole('button',{name:'Send Email',exact:true})).toBeInViewport()
  await editor.getByRole('button',{name:'Email & Text Setup',exact:true}).click()
  const setup = page.getByRole('dialog',{name:'Email & Text Setup',exact:true})
  await expect(setup.getByText('Your draft is saved.',{exact:false})).toBeVisible()
  await setup.getByRole('button',{name:'Save and return to preview',exact:true}).click()
  await expect(setup).toHaveCount(0)
  await expect(editor.getByRole('heading',{name:'Invoice preview',exact:true})).toBeVisible()
  expect(state.documents).toHaveLength(1)
  await editor.getByRole('button',{name:'Open saved draft',exact:true}).click()
  await expect(page).toHaveURL(new RegExp('document='+E))
  expect(state.documents).toHaveLength(1)
})

test('Needs Attention opens an exact change order and restores the approval queue on Back',async({page})=>{
  await page.setViewportSize(mobile)
  await mock(page)
  const change = { id:P, customer_id:C, customers:customer, estimate_id:null, source_invoice_id:E,
    status:'sent', change_order_number:'CO-QA', title:'Change materials', total:25, issue_date:'2026-10-03' }
  await page.route('**/rest/v1/rpc/get_dashboard_attention_page',route=>route.fulfill({
    json:attentionPage(route.request().postDataJSON(),{changeOrders:[change]}),
  }))
  await page.route('**/rest/v1/change_orders?**',route=>route.fulfill({json:[change],headers}))
  await page.goto('/?view=dashboard');await openHomePanels(page)
  await expect(page.getByRole('article',{name:'Needs attention overview',exact:true})).toBeVisible()
  const filter = page.getByRole('button',{name:/^Awaiting Customer Approval 1(?: |$)/})
  await filter.click()
  await page.getByRole('link',{name:/open change order CO-QA/i}).click()
  await expect(page).toHaveURL(new RegExp('document='+P))
  await expect(page.getByRole('dialog',{name:'Review change order',exact:true})).toBeVisible()
  await page.evaluate(()=>history.back())
  await expect(filter).toHaveAttribute('aria-pressed','true')
  await expect(page.getByRole('link',{name:/open change order CO-QA/i})).toBeInViewport()
})

test('completed jobs link to the prepared invoice immediately',async({page})=>{
  const state = await mock(page,{ai:true})
  await mockJobDirectory(page,()=>[{...job,status:state.completed?'completed':'in_progress',active_appointment:null,invoice:state.completed?{id:E,status:'draft',number:'INV-QA'}:null}])
  await page.route('**/rest/v1/jobs?**',route=>{
    const row={...job,status:state.completed?'completed':'in_progress'}
    return route.fulfill({json:new URL(route.request().url()).searchParams.has('id')?row:[row],headers})
  })
  await page.route('**/rest/v1/rpc/get_job_management',route=>{
    expect(route.request().postDataJSON()).toMatchObject({p_business:B,p_job:J})
    return route.fulfill({json:{tasks:[],activity:[],materials:[],templates:[],visits:[],financial_access:true,billing_access:true,calendar_access:true,time:[],recorded_expenses:0,changes:[],documents:state.completed?[{id:E,number:'INV-QA',status:'draft',total:105,balance_due:105,amount_paid:0,deposit:false}]:[]}})
  })
  await page.route('**/rest/v1/rpc/get_job_management_signals',route=>route.fulfill({json:route.request().postDataJSON().p_jobs.map(job_id=>({job_id,tasks_total:0,tasks_completed:0,due_tasks:0,materials_needed:0,pending_changes:0}))}))
  await page.goto('/?view=work')
  await page.getByRole('button',{name:'Manage job',exact:true}).click()
  await page.getByRole('button',{name:'Review completion',exact:true}).click()
  const review=page.getByRole('dialog',{name:'Complete job review',exact:true})
  await expect(review).toContainText('No invoice is sent and no payment is recorded.')
  expect(state.completed).toBe(false)
  await review.getByRole('button',{name:'Complete job',exact:true}).click()
  await expect(review).toHaveCount(0)
  const invoiceLink=page.getByRole('status').getByRole('link',{name:'Review invoice',exact:true})
  await expect(invoiceLink).toHaveAttribute('href','/?view=invoices&document='+E)
  await invoiceLink.click()
  await expect(page).toHaveURL(new RegExp('document='+E))
  expect(state.completed).toBe(true)
  expect(state.calls.filter(call=>call.path.endsWith('/functions/v1/work-scheduling')&&call.body.action==='complete')).toHaveLength(1)
  expect(state.calls.some(call=>/\/functions\/v1\/send-/.test(call.path))).toBe(false)
})

test('booking an existing job from the calendar retains the displayed day',async({page})=>{
  await mock(page,{ai:true})
  await savedJob(page)
  await page.goto('/?view=dashboard');await openHomePanels(page)
  const calendar = page.getByRole('region',{name:'Work calendar'})
  await calendar.getByRole('button',{name:'Next week',exact:true}).click()
  const day = DateTime.now().setZone('America/New_York').plus({days:7}).toISODate()
  await calendar.getByRole('button',{name:'Add to calendar',exact:true}).click()
  await page.getByRole('button',{name:'Book existing job',exact:true}).click()
  await page.getByRole('button',{name:/Landscaping · Test Customer/}).click()
  const booking = page.getByRole('dialog',{name:'Schedule job',exact:true})
  await expect(booking.locator('input[type="datetime-local"]').first()).toHaveValue(day+'T09:00')
  await page.goto('/?view=schedule')
  await page.getByRole('button',{name:'Book or reschedule job',exact:true}).click()
  await expect(page.getByRole('button',{name:/Landscaping · Test Customer/})).toBeVisible()
})

test('Fin resolves named work into its invoice editor and keeps ambiguous choices visible',async({page})=>{
  const state = await workflow(page)
  const other = { ...job, id:P, title:'Landscaping cleanup' }
  await page.route('**/rest/v1/rpc/fin_lookup_records',route=>{
    expect(route.request().postDataJSON().p_query.customer_id).toBe(C)
    return route.fulfill({json:{rows:[job,other],complete:true}})
  })
  await page.route('**/rest/v1/invoices?**',route=>new URL(route.request().url()).searchParams.has('job_id') ? route.fulfill({json:[]}) : route.fallback())
  await savedJob(page)
  await start(page,'Create an invoice from the landscaping job for Test Customer')
  const choices = page.getByRole('region',{name:'Matching saved work',exact:true})
  await expect(choices.getByRole('button')).toHaveCount(2)
  await choices.getByRole('button',{name:'Landscaping · Test Customer',exact:true}).click()
  await expect(page.getByRole('dialog',{name:'Create an invoice',exact:true}).getByLabel('Line 1 description',{exact:true})).toHaveValue('Landscaping')
  await expect(page).toHaveURL(new RegExp('job='+J))
  expect(state.requests).toHaveLength(0)
})

test('personal email preserves Confirm sent across a reload of the saved estimate',async({page})=>{
  await mock(page)
  await page.route('**/rest/v1/estimates?**',route=>route.fulfill({json:[{id:E,estimate_number:'EST-QA',status:'draft',issue_date:'2026-10-01',customer_id:C,customers:customer,subtotal:125,total:125,tax_amount:0}],headers}))
  const setup = {plan:'basic',personal_email_ready:true,personal_sms_ready:false,managed_email_ready:false}
  await page.route('**/rest/v1/rpc/get_delivery_setup',route=>route.fulfill({json:setup}))
  await page.route('**/rest/v1/rpc/prepare_personal_document',route=>route.fulfill({json:{
    snapshot:{kind:'estimate',number:'EST-QA',status:'draft',total:125,items:[],customer:{name:'Test Customer',email:customer.email,phone:null},company:{name:'Test Company'}},
  }}))
  let releases=0, confirmations=0
  await page.route('**/rest/v1/rpc/release_personal_approval',route=>{releases++;return route.fulfill({json:null})})
  await page.route('**/rest/v1/rpc/confirm_personal_document_sent',route=>{confirmations++;return route.fulfill({json:null})})
  await page.goto('/?view=estimates&document='+E)
  const estimate=page.getByRole('dialog',{name:'Estimate preview',exact:true})
  await estimate.getByRole('region',{name:'Record actions',exact:true}).getByRole('button',{name:'Send estimate',exact:true}).click()
  const delivery=page.getByRole('dialog',{name:'Send estimate',exact:true})
  await delivery.getByRole('button',{name:'Use my email or text app instead',exact:true}).click()
  await expect(delivery.getByRole('region',{name:'Estimate PDF',exact:true}).getByRole('button',{name:'Download PDF',exact:true})).toBeEnabled()
  const downloading=page.waitForEvent('download')
  await delivery.getByRole('button',{name:'Open email app',exact:true}).click()
  const attachment=await downloading;expect(await attachment.failure()).toBeNull()
  await expect(delivery.getByRole('link',{name:'Reopen draft in your app',exact:true})).toHaveAttribute('href',/^mailto:/)
  await expect(delivery.getByRole('button',{name:'Confirm sent',exact:true})).toBeEnabled()
  expect(releases).toBe(1)
  expect(confirmations).toBe(0)
  await delivery.getByRole('button',{name:'Close delivery',exact:true}).click()
  await expect(delivery).toHaveCount(0)
  await expect(estimate.getByRole('region',{name:'Record actions',exact:true}).getByRole('button',{name:'Confirm sent',exact:true})).toBeEnabled()
  await page.waitForLoadState('load')
  await page.reload()
  await estimate.getByRole('region',{name:'Record actions',exact:true}).getByRole('button',{name:'Confirm sent',exact:true}).click()
  await delivery.getByRole('button',{name:'Use my email or text app instead',exact:true}).click()
  await delivery.getByRole('button',{name:'Confirm sent',exact:true}).click()
  await expect(page.getByText('Recorded as sent through your app.',{exact:true})).toBeVisible()
  expect(confirmations).toBe(1)
})

test('a new customer email can be added in preview after its single draft save without sending',async({page})=>{
  const state=await mock(page,{ai:true}),updates=[]
  const version='2026-11-04T10:00:00Z'
  await page.route('**/rest/v1/customers?**',route=>{
    const request=route.request(),q=new URL(request.url()).searchParams
    const created=state.documents[0]?.payload
    if(created?.new_customer&&!state.customers.some(row=>row.id===created.customer_id))state.customers.push({id:created.customer_id,...created.new_customer,updated_at:version})
    const current=state.customers.find(row=>'eq.'+row.id===q.get('id'))
    if(request.method()==='PATCH'){
      expect(q.get('business_id')).toBe('eq.'+B);expect(q.get('updated_at')).toBe('eq.'+version)
      updates.push(request.postDataJSON());Object.assign(current,request.postDataJSON())
      return route.fulfill({json:current,headers})
    }
    return route.fulfill({json:q.has('id')?current:state.customers,headers:{...headers,'content-range':`0-${state.customers.length-1}/${state.customers.length}`}})
  })
  await page.goto('/?view=invoices')
  await page.getByRole('button',{name:'Create invoice',exact:true}).click()
  const editor=page.getByRole('dialog',{name:'Create an invoice',exact:true})
  await editor.getByRole('button',{name:'Create a new customer',exact:true}).click()
  await editor.getByLabel('Customer name',{exact:true}).fill('New contact')
  await editor.getByLabel('Line 1 description',{exact:true}).fill('Landscaping')
  await editor.getByLabel('Line 1 unit price',{exact:true}).fill('100')
  await editor.getByRole('button',{name:'Preview',exact:true}).click()
  const preview=editor.getByRole('region',{name:'Review and send',exact:true})
  await expect(editor.getByRole('button',{name:'Open saved draft',exact:true})).toBeEnabled()
  await expect(editor.getByRole('region',{name:'Invoice PDF',exact:true}).getByRole('button',{name:'Download PDF',exact:true})).toBeEnabled()
  await expect(preview.getByRole('button',{name:'Send Email',exact:true})).toBeDisabled()
  expect(state.documents).toHaveLength(1)
  await preview.getByRole('button',{name:'Add email',exact:true}).click()
  const contact=page.getByRole('dialog',{name:'Edit customer email',exact:true})
  await contact.getByLabel('Email',{exact:true}).fill('new@example.test')
  await contact.getByRole('button',{name:'Save customer changes',exact:true}).click()
  await expect(contact).toHaveCount(0)
  await expect(preview.getByRole('button',{name:'Send Email',exact:true})).toBeEnabled()
  expect(updates).toHaveLength(1);expect(updates[0].email).toBe('new@example.test')
  expect(state.documents).toHaveLength(1)
  expect(state.calls.filter(call=>/send-reviewed-document|confirm_personal_document_sent/.test(call.path))).toHaveLength(0)
})

test('the invoice payment dialog starts at the balance and accepts a partial payment',async({page})=>{
  await mock(page)
  const writes=[]
  await page.route('**/rest/v1/rpc/record_manual_payment',route=>{
    writes.push(route.request().postDataJSON())
    return route.fulfill({json:{id:P,amount:40,method:'cash',status:'succeeded',paid_at:new Date().toISOString()}})
  })
  await page.goto('/?view=invoices&document='+E)
  await page.getByRole('button',{name:'Mark Paid',exact:true}).click()
  const payment=page.getByRole('dialog',{name:'Mark Paid',exact:true})
  await expect(payment.getByLabel('Amount',{exact:true})).toHaveValue('105')
  await payment.getByLabel('Amount',{exact:true}).fill('40')
  await payment.getByRole('combobox',{name:'Method',exact:true}).selectOption('cash')
  page.once('dialog',confirmation=>confirmation.accept())
  await payment.getByRole('button',{name:'Record partial payment',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'Payment of $40.00 recorded by cash.'})).toBeVisible()
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({target_business_id:B,invoice_id:E,payment_amount:40})
})

test('Billing review opens the billing step for the exact approved change order', async ({ page }) => {
  await mock(page)
  const change = { id:P, customer_id:C, customers:customer, source_invoice_id:E,
    status:'approved', change_order_number:'CO-QA', title:'Change materials', total:25, issue_date:'2026-10-03' }
  await page.route('**/rest/v1/rpc/get_dashboard_attention_page', route => route.fulfill({
    json: { page:1, page_size:5, total:1, attention_count:1, approval_count:0,
      category_counts:{ schedule:0, invoice:1, overdue:0, follow_up:0 },
      items:[{ kind:'change_order_billing', data:{ ...change, customers:[customer], number:'CO-QA', action:'create_invoice' } }] },
  }))
  await page.route('**/rest/v1/change_orders?**', route => route.fulfill({ json:[change], headers }))
  await page.route('**/rest/v1/rpc/get_change_order_billing', route => route.fulfill({ json:{ action:'create_invoice', total:105, change_total:25 } }))
  await page.goto('/?view=dashboard');await openHomePanels(page)
  await page.getByRole('button', { name:'Billing review 1' }).click()
  const row = page.getByRole('link', { name:/open change order CO-QA/i })
  await expect(row).toContainText('Ready to bill')
  await row.click()
  await expect(page.getByRole('region', { name:'Change order billing' }).getByRole('button', { name:'Create change invoice' })).toBeVisible()
  await expect(page.getByRole('link', { name:'Open original invoice' })).toHaveAttribute('href', '/?view=invoices&document='+E)
})
