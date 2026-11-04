import {test,expect} from '@playwright/test'
import {mock} from './audit-fixture.mjs'
test.setTimeout(60000)
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST,OPTIONS'}
for(const width of [390,1440])test(`Fin has one typed submit, clear voice control and contextual follow-ups at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:950});const state=await mock(page,{ai:true});const requests=[];let fail=false
 await page.route('**/functions/v1/fin-assistant',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors})
  const body=route.request().postDataJSON();requests.push(body)
  if(fail){fail=false;return route.fulfill({status:503,headers:cors,json:{error:'Temporary failure'}})}
  return route.fulfill({status:200,headers:cors,json:{answer:body.text.startsWith('What about')?'Painting is also a saved service.':'Your saved service is landscaping.',sources:[{key:'profile',label:'Saved company profile'}],as_of:'2026-11-04T12:00:00Z',limits:['Current business records only.']}})
 })
 await page.goto('/');const launcher=page.getByRole('button',{name:'Talk to Fin',exact:true});await expect(launcher.locator('img')).toHaveAttribute('src','/finviant-mark.svg');await expect(page.locator('.fin-brand:visible')).toContainText('AI Office Assistant')
 const box=await launcher.boundingBox();expect(box.width).toBeGreaterThanOrEqual(72);expect(box.height).toBe(box.width)
 await page.screenshot({path:`test-results/fin-brand-${width}.png`,fullPage:true});await launcher.click()
 const panel=page.getByRole('dialog',{name:'Fin — your office assistant'}),input=panel.getByRole('textbox',{name:'Describe your invoice or request'}),submit=panel.getByRole('button',{name:'Ask Fin',exact:true})
 await expect(submit).toHaveCount(1);await expect(submit.locator('img')).toHaveCount(1);await expect(panel.getByRole('button',{name:'Tap and speak',exact:true})).toBeVisible()
 await input.fill('What services do I offer?');await submit.click();await expect(input).toHaveValue('');await expect(panel.getByRole('region',{name:'Fin’s answer'})).toHaveCount(1)
 expect(requests[0].history).toEqual([])
 fail=true;await input.fill('What about painting?');await submit.click();await expect(panel.getByRole('alert')).toBeVisible();await expect(input).toHaveValue('What about painting?');await expect(panel.getByRole('region',{name:'Fin’s answer'})).toHaveCount(1)
 await submit.click();await expect(panel.getByRole('region',{name:'Fin’s answer'})).toHaveCount(2);expect(requests[1]).toEqual(requests[2]);expect(requests[2].history).toEqual([{question:'What services do I offer?',answer:'Your saved service is landscaping.'}]);await expect(input).toHaveValue('')
 await submit.scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/fin-conversation-${width}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 page.on('dialog',()=>{throw Error('Completed conversation must close without an unsaved-change prompt')});await panel.getByRole('button',{name:'Close',exact:true}).click();await launcher.click();await expect(panel.getByRole('region',{name:'Fin’s answer'})).toHaveCount(2)
 await panel.getByRole('button',{name:'New conversation',exact:true}).click();await expect(panel.getByRole('region',{name:'Fin’s answer'})).toHaveCount(0);await input.fill('What services do I offer?');await submit.click();expect(requests.at(-1).history).toEqual([])
 expect(state.documents).toHaveLength(0);expect(state.calls.filter(c=>c.path.includes('execute-ai-action'))).toHaveLength(0)
})
