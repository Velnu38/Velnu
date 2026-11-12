import {test,expect} from '@playwright/test'
import {DateTime} from 'luxon'
import {mock} from './audit-fixture.mjs'

// Populated synthetic reference capture; no real account or provider writes.
for(const width of [320,390,430])test(`Home calendar mockup composition at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900})
 await mock(page)
 const day=DateTime.now().setZone('America/New_York').startOf('day')
 const job='66666666-6666-4666-8666-666666666666'
 await page.route('**/api/calendar?**',route=>route.fulfill({json:{events:[],issues:[],connections:0}}))
 await page.route('**/rest/v1/calendar_work?**',route=>route.fulfill({headers:{'content-range':'0-0/1'},json:[{source_key:'job:'+job,title:'Landscaping',starts_at:day.set({hour:9}).toISO(),ends_at:day.set({hour:11}).toISO(),status:'scheduled',job_status:'scheduled',document_kind:'work',document_id:job,job_id:job,customer_name:'Sample Customer A',assigned_user_ids:[]}]}))
 await page.route('**/rest/v1/jobs?**',route=>route.fulfill({headers:{'content-range':'0-0/1'},json:[{id:job,status:'scheduled',description:'',customers:{first_name:'Sample',last_name:'Customer A'},properties:null}]}))
 await page.goto('/?view=dashboard')
 const card=page.getByRole('region',{name:'Work calendar',exact:true})
 await expect(card.getByText('Sample Customer A',{exact:true})).toBeVisible()
 await expect(card.getByRole('button',{name:'Start job',exact:true})).toBeVisible()
 await expect(card.getByText('Connect a calendar',{exact:true})).toBeVisible()
 const metrics=await card.evaluate(el=>{
  const r=el.getBoundingClientRect(),prev=el.querySelector('[aria-label="Previous week"]').getBoundingClientRect(),next=el.querySelector('[aria-label="Next week"]').getBoundingClientRect(),today=[...el.querySelectorAll('button')].find(e=>e.textContent==='Today').getBoundingClientRect()
  return {fits:r.left>=0&&r.right<=innerWidth,arrows:prev.x<today.x&&today.x<next.x,overflow:document.documentElement.scrollWidth>innerWidth}
 })
 expect(metrics).toEqual({fits:true,arrows:true,overflow:false})
 await card.screenshot({path:`test-results/home-calendar-reference-${width}.png`})
 await card.locator('.home-calendar-team>summary').click()
 await expect(card.getByRole('combobox',{name:/Scheduled work for/})).toBeVisible()
 await card.getByRole('button',{name:'Month',exact:true}).click()
 await expect(card.getByRole('group',{name:'Choose a day in the month'})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await card.screenshot({path:`test-results/home-calendar-month-${width}.png`})
})
