import {test,expect} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {mkdir} from 'node:fs/promises'
import {mock,E} from './audit-fixture.mjs'

for(const width of [320,390,1440])test(`Radix record tabs retain drafts, panel links and keyboard access at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900})
 await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:4173'?route.continue():route.abort())
 await page.goto('/tests/operations/preview.html?screen=record-tabs')
 const list=page.getByRole('tablist',{name:'Synthetic record sections'})
 const details=list.getByRole('tab',{name:'Details',exact:true}),photos=list.getByRole('tab',{name:'Photos & expenses',exact:true}),activity=list.getByRole('tab',{name:'Activity 3',exact:true})
 await expect(details).toHaveAttribute('aria-selected','true')
 await expect(list.getByRole('tab',{name:'Unavailable',exact:true})).toBeDisabled()
 await page.getByRole('textbox',{name:'Unsaved note'}).fill('Keep this unfinished note')
 await details.focus();await details.press('ArrowRight')
 await expect(photos).toBeFocused();await expect(photos).toHaveAttribute('aria-selected','true')
 await photos.press('End');await expect(activity).toBeFocused();await expect(activity).toHaveAttribute('aria-selected','true')
 await activity.press('ArrowRight');await expect(details).toBeFocused()
 await expect(page.getByRole('textbox',{name:'Unsaved note'})).toHaveValue('Keep this unfinished note')
 await details.press('ArrowLeft');await expect(activity).toBeFocused()
 await activity.press('Home');await expect(details).toBeFocused()
 for(const tab of [details,photos,activity]){
  await tab.click()
  const id=await tab.getAttribute('aria-controls'),tabId=await tab.getAttribute('id')
  await expect(page.locator('[id="'+id+'"]')).toBeVisible()
  await expect(page.locator('[id="'+id+'"]')).toHaveAttribute('aria-labelledby',tabId)
 }
 await details.click();await page.getByRole('checkbox',{name:'Keep current section'}).check()
 await photos.click();await expect(details).toHaveAttribute('aria-selected','true');await expect(photos).toHaveAttribute('aria-selected','false')
 await expect(page.getByRole('textbox',{name:'Unsaved note'})).toHaveValue('Keep this unfinished note')
 await page.getByRole('checkbox',{name:'Keep current section'}).uncheck()
 // Explicitly exercise native click (assistive/programmatic activation).
 await photos.evaluate(element=>element.click());await expect(photos).toHaveAttribute('aria-selected','true')
 await expect(page.getByLabel('Form submission')).toHaveText('Not submitted')
 await page.getByRole('checkbox',{name:'Right-to-left navigation'}).check()
 await details.click();await details.press('ArrowLeft');await expect(photos).toBeFocused()
 await details.click()
 const audit=await new AxeBuilder({page}).include('main').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
 expect(audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.failureSummary)}))).toEqual([])
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await mkdir('work/radix-ui',{recursive:true});await page.screenshot({path:`work/radix-ui/record-tabs-${width}.png`,fullPage:true})
})

test('invoice and estimate record tabs still open their existing panels without writes',async({page})=>{
 const state=await mock(page,{ai:true})
 for(const [view,label]of [['invoices','Invoice details'],['estimates','Estimate sections']]){
  await page.goto('/?view='+view+'&document='+E)
  const list=page.getByRole('tablist',{name:label,exact:true})
  const tabs=list.getByRole('tab')
  await expect(tabs).toHaveCount(3)
  await tabs.first().focus();await tabs.first().press('End')
  await expect(tabs.last()).toHaveAttribute('aria-selected','true')
  await expect(page.getByRole('tabpanel',{name:/Activity/})).toBeVisible()
  await tabs.last().press('Home');await expect(tabs.first()).toHaveAttribute('aria-selected','true')
  await tabs.nth(1).click();await expect(page.getByRole('tabpanel',{name:'Photos & expenses',exact:true})).toBeVisible()
 }
 expect(state.documents).toEqual([]);expect(state.documentUpdates).toEqual([]);expect(state.changes).toEqual([])
 expect(state.calls.filter(call=>!['GET','OPTIONS'].includes(call.method)&&(/\/(?:send-|queue_|create_|update_|manage_|record_)/.test(call.path)||call.path.startsWith('/rest/v1/')&&!call.path.includes('/rpc/')))).toEqual([])
})
