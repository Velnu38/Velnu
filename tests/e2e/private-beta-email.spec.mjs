import {test,expect} from '@playwright/test'
import {mock,B,C,E,customer} from './audit-fixture.mjs'

const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'}
const reply=(route,json,status=200)=>route.fulfill({status,headers:cors,json})
async function setup(page,kind='invoice'){
  const state=await mock(page,{ai:true})
  const person={...customer,email:'delivered@resend.dev',phone:'+17575550100'}
  const document={id:E,customer_id:C,status:kind==='estimate'?'sent':'draft',issue_date:'2026-11-07',created_at:'2026-11-07T10:00:00Z',total:100,subtotal:100,tax_amount:0,amount_paid:0,balance_due:100,customers:person,...(kind==='invoice'?{invoice_number:'INV-BETA'}:{estimate_number:'EST-BETA',expires_on:'2099-01-01'})}
  await page.route(`**/rest/v1/${kind}s?*`,route=>reply(route,new URL(route.request().url()).searchParams.has('id')?document:[document]))
  await page.route('**/rest/v1/rpc/get_estimate_workflow_context',route=>reply(route,[{estimate_id:E,job:null,appointment:null,schedule:null,invitation:null,final_invoice_id:null}]))
  await page.route('**/rest/v1/rpc/get_invoice_payment_operations',route=>reply(route,{state:'clear',refunds:[]}))
  await page.goto(`/?view=${kind}s&document=${E}`)
  await page.getByRole('region',{name:'Record actions',exact:true}).getByRole('button',{name:kind==='invoice'?'Send invoice':'Follow up',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:kind==='invoice'?'Send invoice':'Follow up on estimate',exact:true})
  await expect(dialog.getByRole('region',{name:kind==='invoice'?'Invoice PDF':'Estimate PDF',exact:true}).getByRole('button',{name:'Download PDF',exact:true})).toBeEnabled()
  return {state,dialog,delivery:dialog.getByRole('region',{name:'Send to customer',exact:true})}
}

test('private beta enables reviewed email and explicit Pro document approval while text remains gated',async({page})=>{
  const {state,dialog,delivery}=await setup(page,'estimate')
  await expect(delivery.getByText('Private beta email sends only to approved test addresses.')).toBeVisible()
  await expect(delivery.getByRole('button',{name:'Send Email',exact:true})).toBeEnabled()
  await expect(delivery.getByRole('button',{name:'Send Text',exact:true})).toBeDisabled()
  await dialog.getByRole('button',{name:'Close delivery',exact:true}).click()
  const actions=page.getByRole('region',{name:'Record actions',exact:true})
  await expect(actions.getByRole('button',{name:'Customer approval link',exact:true})).toBeHidden()
  await actions.locator('summary').click()
  await expect(actions.getByRole('button',{name:'Customer approval link',exact:true})).toBeEnabled()
  expect(state.calls.some(call=>/\/(send-|create-approval-link|customer-approval)/.test(call.path))).toBe(false)
})

test('private beta submits the displayed recipient once through the normal invoice endpoint',async({page})=>{
  const sends=[]
  const {delivery}=await setup(page)
  await page.route('**/functions/v1/send-invoice-email',async route=>{
    if(route.request().method()==='OPTIONS')return reply(route,{})
    sends.push(route.request().postDataJSON())
    await new Promise(resolve=>setTimeout(resolve,80))
    return reply(route,{status:'accepted',email_id:'beta-receipt',recipient:'delivered@resend.dev'})
  })
  await delivery.getByRole('button',{name:'Send Email',exact:true}).dblclick()
  await expect(delivery.getByRole('status')).toContainText('Email accepted for delivery to delivered@resend.dev')
  expect(sends).toHaveLength(1)
  expect(sends[0]).toMatchObject({business_id:B,invoice_id:E,expected_recipient:'delivered@resend.dev'})
  await expect(delivery.getByRole('button',{name:'Email accepted',exact:true})).toBeDisabled()
})

test('a rejected beta recipient recovers with a fresh operation after approval',async({page})=>{
  const {delivery}=await setup(page)
  const sends=[]
  await page.route('**/functions/v1/send-invoice-email',route=>{
    if(route.request().method()==='OPTIONS')return reply(route,{})
    sends.push(route.request().postDataJSON())
    return sends.length===1
      ?reply(route,{error:'Private beta email can only be sent to approved test addresses.',code:'beta_recipient_not_approved',beta_send_not_started:true},403)
      :reply(route,{status:'accepted',email_id:'beta-receipt',recipient:'delivered@resend.dev'})
  })
  await delivery.getByRole('button',{name:'Send Email',exact:true}).click()
  await expect(delivery.getByRole('alert')).toContainText('Private beta email can only be sent to approved test addresses.')
  await expect(delivery.getByRole('button',{name:'Retry email',exact:true})).toBeEnabled()
  await expect(delivery.getByRole('button',{name:'Edit customer contact',exact:true})).toBeEnabled()
  await expect(delivery.getByRole('status')).toHaveCount(0)
  await delivery.getByRole('button',{name:'Retry email',exact:true}).click()
  await expect(delivery.getByRole('status')).toContainText('Email accepted for delivery')
  expect(sends).toHaveLength(2)
  expect(sends[1].request_id).not.toBe(sends[0].request_id)
})
