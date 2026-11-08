import {test,expect} from '@playwright/test'
import {mock,B,business} from './audit-fixture.mjs'
test.setTimeout(60000)
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST,OPTIONS'}
for(const width of [390,1440])test(`Fin has one typed submit, clear voice control and contextual follow-ups at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:950});const state=await mock(page,{ai:true});const requests=[];let fail=false
 await page.route('**/functions/v1/fin-workflow',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
  const body=route.request().postDataJSON();requests.push(body)
  if(fail){fail=false;return route.fulfill({status:503,headers:cors,json:{error:'Temporary failure'}})}
  return route.fulfill({status:200,headers:cors,json:{answer:body.text.startsWith('What about')?'Painting is also a saved service.':'Your saved service is landscaping.',sources:[{key:'profile',label:'Saved company profile'}],as_of:'2026-11-04T12:00:00Z',limits:['Current business records only.']}})
 })
 await page.goto('/?view=dashboard');const launcher=page.locator('.fin-launcher').getByRole('button',{name:'Ask Fin',exact:true});await expect(launcher.locator('.fin-mark')).toHaveAttribute('src','/finviant-mark-on-dark.svg');await expect(page.locator('.fin-brand:visible .fin-wordmark')).toContainText('inviant');await expect(launcher).toHaveCSS('background-color','rgb(16, 44, 75)');await expect(launcher.getByText('Ask Fin',{exact:true})).toBeVisible();await expect(page.locator('.fin-brand:visible')).toContainText('AI Office Assistant')
 const box=await launcher.boundingBox();expect(box.width).toBeGreaterThanOrEqual(48);expect(box.height).toBeGreaterThanOrEqual(48)
 await page.screenshot({path:`test-results/fin-brand-${width}.png`,fullPage:true});await page.locator('.fin-launcher').getByRole('button',{name:'Ask Fin',exact:true}).click()
 const panel=page.getByRole('dialog',{name:'Fin — your office assistant'}),input=panel.getByRole('textbox',{name:'Describe your invoice or request'}),submit=panel.getByRole('button',{name:'Ask Fin',exact:true})
 await expect(submit).toHaveCount(1);await expect(submit.locator('img')).toHaveCount(1);await expect(panel.getByRole('button',{name:'Speak instead',exact:true})).toBeVisible()
 await input.fill('What services do I offer?');await submit.click();await expect(input).toHaveValue('');await expect(panel.getByRole('region',{name:'Fin’s answer'})).toHaveCount(1)
 expect(requests[0]).not.toHaveProperty('history')
 fail=true;await input.fill('What about painting?');await submit.click();await expect(panel.getByRole('alert')).toBeVisible();await expect(input).toHaveValue('What about painting?');await expect(panel.getByRole('region',{name:'Fin’s answer'})).toHaveCount(1)
 await submit.click();await expect(panel.getByRole('region',{name:'Fin’s answer'})).toHaveCount(2);expect(requests[1]).toEqual(requests[2]);expect(requests[2].thread_id).toBe(requests[0].thread_id);await expect(input).toHaveValue('')
 await submit.scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/fin-conversation-${width}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 page.on('dialog',()=>{throw Error('Completed conversation must close without an unsaved-change prompt')});await panel.getByRole('button',{name:'Close',exact:true}).click();await page.locator('.fin-launcher').getByRole('button',{name:'Ask Fin',exact:true}).click();await expect(panel.getByRole('region',{name:'Fin’s answer'})).toHaveCount(2)
 await panel.getByRole('button',{name:'New conversation',exact:true}).click();await expect(panel.getByRole('region',{name:'Fin’s answer'})).toHaveCount(0);await input.fill('What services do I offer?');await submit.click();expect(requests.at(-1).thread_id).not.toBe(requests[0].thread_id)
 expect(state.documents).toHaveLength(0);expect(state.calls.filter(c=>c.path.includes('execute-ai-action'))).toHaveLength(0)
})

test('changing membership role clears the earlier business-question conversation',async({page})=>{
 await mock(page,{ai:true})
 await page.route('**/functions/v1/fin-workflow',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
  return route.fulfill({status:200,headers:cors,json:{answer:'Owner-only saved business answer.',sources:[],limits:[],as_of:'2026-11-04T12:00:00Z'}})
 })
 await page.goto('/?view=dashboard');await page.locator('.fin-launcher').getByRole('button',{name:'Ask Fin',exact:true}).click();await page.getByRole('textbox',{name:'Describe your invoice or request'}).fill('What services do I offer?');await page.getByRole('dialog',{name:'Fin — your office assistant'}).getByRole('button',{name:'Ask Fin',exact:true}).click();await expect(page.getByText('Owner-only saved business answer.',{exact:true})).toBeVisible()
 await page.route('**/rest/v1/business_members?*',route=>route.fulfill({status:200,headers:cors,json:{business_id:B,role:'office',access_modules:['calendar','jobs','billing','finances'],businesses:business}}))
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
 await expect(page.locator('.role-pill')).toHaveText('office',{timeout:15000})
 await expect(page.getByRole('dialog',{name:'Fin — your office assistant'})).toHaveCount(0)
 await page.locator('.fin-launcher').getByRole('button',{name:'Ask Fin',exact:true}).click();await expect(page.getByRole('region',{name:'Conversation with Fin'})).toHaveCount(0);await expect(page.getByText('Owner-only saved business answer.',{exact:true})).toHaveCount(0)
})

test('mobile More does not expose an unavailable assistant',async({page})=>{
 await page.setViewportSize({width:390,height:844});await mock(page,{ai:false});await page.goto('/?view=dashboard')
 const dock=page.getByRole('navigation',{name:'Workspace navigation'})
 await dock.getByRole('button',{name:'More',exact:true}).click()
 await expect(page.getByRole('dialog',{name:'More navigation'}).getByRole('button',{name:'Ask Fin',exact:true})).toHaveCount(0)
 await expect(page.getByRole('dialog',{name:'More navigation'})).toBeVisible()
})
