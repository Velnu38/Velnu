import {test,expect} from '@playwright/test'
import {mock,B,business} from './audit-fixture.mjs'
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST,OPTIONS'}
async function navigationMock(page,options){
 const state=await mock(page,options)
 await page.route('**/rest/v1/rpc/get_appointment_reminder_settings',route=>route.fulfill({status:200,headers:cors,json:{plan:'pro',ready_email:false,ready_sms:false,rule:{enabled:false,lead_hours:48,channel:'email'},tasks:[]}}))
 return state
}
async function ask(page,text){
 await page.locator('.fin-launcher').getByRole('button',{name:'Ask Fin',exact:true}).click()
 const panel=page.getByRole('dialog',{name:'Fin — your office assistant'})
 await panel.getByRole('textbox').fill(text)
 await panel.getByRole('button',{name:'Ask Fin',exact:true}).click()
 return panel
}
for(const width of [390,1440])test(`Fin opens customer setup, repeated destinations, context and Back at ${width}px without writes`,async({page})=>{
 await page.setViewportSize({width,height:950});const state=await navigationMock(page,{ai:true});let provider=0
 await page.route('**/functions/v1/fin-workflow',route=>{provider++;return route.abort()})
 await page.goto('/?view=invoices');page.on('dialog',()=>{throw Error('Navigation alone must not ask for confirmation')})
 await ask(page,'Open customer reminders');await expect(page).toHaveURL(/\?view=settings&section=customer_reminders$/)
 await expect(page.getByRole('heading',{name:'Customer Reminders',exact:true})).toBeVisible()
 await ask(page,'Open that');await expect(page.getByRole('dialog',{name:'Fin — your office assistant'})).toHaveCount(0)
 await page.goBack();await expect(page).toHaveURL(/\?view=invoices$/)
 await ask(page,'Open internal follow-ups');await expect(page).toHaveURL(/\?view=reminders$/)
 await page.reload();await expect(page).toHaveURL(/\?view=reminders$/)
 await ask(page,'Open job management');await expect(page).toHaveURL(/view=work&workspace=management$/)
 await ask(page,'Open jobs directory');await expect(page).toHaveURL(/view=work&workspace=jobs$/)
 expect(provider).toBe(0);expect(state.documents).toHaveLength(0)
 expect(state.calls.filter(c=>/fin_execute|fin_create|send-|execute-ai-action/.test(c.path))).toHaveLength(0)
})
test('ambiguous and unavailable destinations keep the current page and request',async({page})=>{
 await navigationMock(page,{ai:true});await page.goto('/?view=customers')
 const panel=await ask(page,'Open reminders');await expect(panel.getByRole('alert')).toContainText('Do you mean Customer Reminders')
 await panel.getByRole('textbox').fill('Open payroll');await panel.getByRole('button',{name:'Ask Fin',exact:true}).click()
 await expect(panel.getByRole('alert')).toContainText('cannot open that destination');await expect(page).toHaveURL(/\?view=customers$/)
 await panel.getByRole('textbox').fill('Customer reminders');await panel.getByRole('button',{name:'Ask Fin',exact:true}).click();await expect(page).toHaveURL(/section=customer_reminders$/)
})
test('fresh access and plan denial keep Fin on the source page',async({page})=>{
 await navigationMock(page,{ai:true});await page.goto('/?view=dashboard')
 await expect(page.locator('.fin-launcher')).toBeVisible()
 await page.route('**/rest/v1/rpc/get_plan_usage',route=>route.fulfill({status:200,headers:cors,json:{plan:'free',ai_limit:0,voice_limit:0}}))
 const panel=await ask(page,'Open invoices');await expect(panel.getByRole('alert')).toContainText('not available on your current plan');await expect(page).toHaveURL(/view=dashboard$/)
})
test('unsaved settings survive Cancel; discard opens the requested page',async({page})=>{
 await navigationMock(page,{ai:true});await page.goto('/?view=settings&section=company')
 await page.getByLabel('Company name',{exact:true}).fill('Keep these edits')
 const canceled=new Promise(resolve=>page.once('dialog',async dialog=>{expect(dialog.message()).toContain('Discard unsaved changes');await dialog.dismiss();resolve()}))
 const panel=await ask(page,'Open invoices');await canceled
 await expect(panel.getByRole('button',{name:'Ask Fin',exact:true})).toBeEnabled()
 await expect(page).toHaveURL(/section=company$/);await expect(panel.getByRole('textbox')).toHaveValue('Open invoices')
 expect(await page.getByLabel('Company name',{exact:true}).inputValue()).toBe('Keep these edits')
 page.once('dialog',dialog=>dialog.accept());await panel.getByRole('button',{name:'Ask Fin',exact:true}).click()
 await expect(page).toHaveURL(/view=invoices$/)
})
test('fresh membership denial cannot open customer setup',async({page})=>{
 await navigationMock(page,{ai:true});await page.goto('/?view=dashboard');await expect(page.locator('.fin-launcher')).toBeVisible()
 await page.route('**/rest/v1/business_members?*',route=>route.fulfill({status:200,headers:cors,json:{business_id:B,role:'viewer',access_modules:[],businesses:business}}))
 const panel=await ask(page,'Open customer reminders');await expect(panel.getByRole('alert')).toContainText('not included in your access');await expect(page).toHaveURL(/view=dashboard$/)
})
test('synthetic browser dictation uses the same direct destination without a workflow call',async({page})=>{
 await navigationMock(page,{ai:true});let provider=0
 await page.route('**/functions/v1/fin-workflow',route=>{provider++;return route.abort()})
 await page.route('**/functions/v1/transcribe-voice',route=>route.fulfill({status:200,headers:cors,json:{configured:false}}))
 await page.addInitScript(()=>{
  window.SpeechRecognition=window.webkitSpeechRecognition=class{
   start(){setTimeout(()=>{this.onresult?.({results:[[{transcript:'Open customer reminders'}]]});this.onend?.()},50)}
   stop(){}
  }
 })
 await page.goto('/?view=dashboard');await page.locator('.fin-launcher').getByRole('button',{name:'Ask Fin',exact:true}).click()
 await page.getByRole('button',{name:'Speak instead',exact:true}).click()
 await expect(page).toHaveURL(/view=settings&section=customer_reminders$/);expect(provider).toBe(0)
})

test('an unambiguous Fin suggestion supplies context without a second provider request',async({page})=>{
 await navigationMock(page,{ai:true});let questions=0
 await page.route('**/functions/v1/fin-workflow',route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
  questions++;return route.fulfill({status:200,headers:cors,json:{answer:'Worker profiles are in Team Management. Account access is separate.',navigation:['team'],sources:[],limits:[],as_of:'2026-11-11T12:00:00Z'}})
 })
 await page.goto('/?view=dashboard');const panel=await ask(page,'Where do I manage worker profiles?')
 await expect(panel.getByRole('region',{name:'Fin’s answer'})).toBeVisible()
 await panel.getByRole('textbox').fill('Take me there');await panel.getByRole('button',{name:'Ask Fin',exact:true}).click()
 await expect(page).toHaveURL(/view=settings&section=team$/);expect(questions).toBe(1)
})
