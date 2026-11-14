import {test,expect} from '@playwright/test'
import {mkdir} from 'node:fs/promises'
import {openJobSection} from './job-workspace-navigation.mjs'
const job='44444444-4444-4444-8444-444444444444'
for(const width of [320,390])for(const stage of ['paid','pending'])test(`supported journey ${stage} at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844})
 await page.goto(`/tests/operations/preview.html?screen=jobs&scenario=journey&journeyStage=${stage}&job=${job}&layout=phone`)
 const workspace=page.getByRole('region',{name:'Selected job workspace',exact:true})
 await expect(workspace).toBeVisible()
 await expect(workspace.locator('.jm-phone-status')).toHaveText(stage==='paid'?'Closed · Paid':'Payment pending')
 await expect(workspace.locator('.jm-next-action').getByRole('link')).toHaveText(stage==='paid'?'View payment history':'View payment status')
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await mkdir('tmp/journey-review',{recursive:true})
 if(width===390)await page.screenshot({path:`tmp/journey-review/${stage}-phone.png`,fullPage:true})
 await openJobSection(page,'Activity history')
 await expect(workspace.getByLabel('Workflow activity', {exact:true})).toContainText('Issued invoice link opened')
 await expect(workspace.getByLabel('Workflow activity', {exact:true})).toContainText('security scanner')
 await expect(workspace.getByLabel('Workflow activity', {exact:true}).getByRole('button',{name:'Refresh activity',exact:true})).toHaveCount(1)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 if(width===390&&stage==='paid')await page.screenshot({path:'tmp/journey-review/activity-phone.png',fullPage:true})
})
