import {test,expect} from '@playwright/test'
import {mock} from './audit-fixture.mjs'
for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
 test(`private integration center reports configuration and protects SMS consent at ${viewport.width}px`,async({page})=>{
  await page.setViewportSize(viewport);await mock(page)
  const writes=[];let ready=false
  await page.route('https://example.supabase.co/functions/v1/private-integration-testing',async route=>{
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST,OPTIONS'},body:''})
   const body=route.request().postDataJSON();writes.push(body)
   if(body.action==='sms')await new Promise(resolve=>setTimeout(resolve,80))
   const result=body.action==='status'?{configuration:{stripe:ready,stripe_webhook:ready,connect_webhook:ready,sms:ready},state:{},invoices:[],operations:[]}:{status:'accepted',message:'Twilio accepted the test text. Refresh results to check delivery.'}
   await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(result)})
  })
  await page.goto('/?view=settings&integration_test=returned')
  const panel=page.getByRole('region',{name:'Integration testing',exact:true})
  await expect(panel.getByRole('button',{name:'Prepare test subscription'})).toBeDisabled()
  await expect(panel.getByText('Setup needed: Twilio credentials, sending number and approved recipient list.')).toBeVisible()
  ready=true;await panel.getByRole('button',{name:'Refresh test results'}).click()
  const phone=panel.getByRole('textbox',{name:'Approved tester phone'}),send=panel.getByRole('button',{name:'Send approved test text'})
  await phone.fill('+17575550123');await expect(send).toBeDisabled()
  await panel.getByRole('checkbox').check();await expect(send).toBeEnabled();await send.dblclick()
  await expect(panel.getByRole('status')).toHaveText('Twilio accepted the test text. Refresh results to check delivery.')
  const sms=writes.filter(w=>w.action==='sms');expect(sms).toHaveLength(1);expect(sms[0].request_id).toMatch(/^[0-9a-f-]{36}$/)
  await phone.fill('+17575550124');await expect(panel.getByRole('checkbox')).not.toBeChecked();await expect(send).toBeDisabled()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:`test-results/private-integrations-${viewport.width}.png`,fullPage:true})
 })
}
