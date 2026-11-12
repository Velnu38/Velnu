import {test,expect} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import {mock,B,U,C,E,P,J,customer} from './audit-fixture.mjs'
import {mockJobDirectory} from './job-directory-fixture.mjs'
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'}
async function fixture(page){
 const state=await mock(page,{ai:true})
 const person={...customer,first_name:'Taylor',last_name:'Morgan',phone:'+17575550100'};state.customers=[person]
 const job={id:J,customer_id:C,customers:[person],properties:[],title:'Kitchen renovation',status:'scheduled',scheduled_start:'2099-11-16T19:00:00Z',assigned_user_ids:[U],updated_at:'2026-11-12T01:00:00Z',active_appointment:{id:P,starts_at:'2099-11-16T19:00:00Z',ends_at:'2099-11-16T21:00:00Z',status:'scheduled'},invoice:null}
 await mockJobDirectory(page,()=>[job])
 const rpc=(name,json)=>page.route('**/rpc/'+name,r=>r.fulfill({headers,json}))
 await rpc('get_job_workflow_context',[{job_id:J,active_appointment:job.active_appointment,invoice:null}])
 await rpc('get_worker_roster',{plan:'pro',active_count:3,worker_limit:25,workers:['Owner','Alex Carter','Jamie Lee'].map((name,i)=>({id:[U,J,P][i],name,trade:'',active:true,is_owner:i===0,use_business_hours:true,work_days:[1,2,3,4,5],start_minutes:480,end_minutes:1020,updated_at:'2026-11-12T00:00:00Z'}))})
 await page.route('**/api/calendar?**',r=>r.fulfill({json:{integrations:[],providers:{google:false,outlook:false}}}))
 await rpc('get_appointment_reminder_settings',{plan:'pro',ready:false,email_ready:false,sms_ready:false,rule:{enabled:false,lead_hours:48,channel:'email'}})
 await page.route('**/rest/v1/customers?**',r=>r.fulfill({headers,json:new URL(r.request().url()).searchParams.has('id')?person:[person]}))
 await page.route('**/rest/v1/jobs?**',r=>r.fulfill({headers,json:new URL(r.request().url()).searchParams.has('id')?job:[job]}))
 return state
}
async function capture(page,name,width){
 await page.evaluate(()=>document.fonts.ready)
 const dialog=page.getByRole('dialog').last();if(await dialog.count())await dialog.evaluate(el=>el.scrollTop=0)
 await page.evaluate(()=>scrollTo(0,0))
 const size=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&getComputedStyle(e).visibility!=='hidden'&&(r.right>innerWidth+1||r.left< -1)}).slice(0,12).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent.slice(0,50)}))}))
 await mkdir('tmp/workspace-review',{recursive:true})
 await page.screenshot({path:`tmp/workspace-review/${name}-${width}.png`,fullPage:!(await dialog.count())})
 await writeFile(`tmp/workspace-review/${name}-${width}.json`,JSON.stringify(size))
 expect(size.scroll,JSON.stringify(size)).toBeLessThanOrEqual(size.viewport)
 await expect(page.getByRole('heading',{name:'This page could not be opened',exact:true})).toHaveCount(0)
 if(width<=900){const shell=await page.locator('.app-shell').boundingBox();expect(Math.abs(shell.width-width)).toBeLessThan(2)}
}
for(const width of [320,390,430,768,1440])test(`shared scheme main screens ${width}px`,async({page})=>{
 test.setTimeout(120000);await page.setViewportSize({width,height:900});await fixture(page)
 for(const [name,url,ready] of [['home','dashboard','.dashboard-page'],['jobs','work&workspace=jobs&layout=list','.jobs-module'],['invoices','invoices','.invoice-module'],['estimates','estimates','.estimates-module'],['more','settings','.more-navigation'],['team','settings&section=team','.worker-row'],['customers','customers','.customer-row']]){
  await page.goto('/?view='+url);await expect(page.locator(ready).first()).toBeVisible();await capture(page,name,width)
 }
 await page.goto('/?view=dashboard');await page.getByRole('button',{name:'Quick Links',exact:true}).click();await capture(page,'quick-links',width)
 const dialog=page.getByRole('dialog');if(width<=900){const box=await dialog.boundingBox();expect(box.width).toBe(width);expect(box.height).toBe(900)}
})
for(const kind of ['invoice','estimate'])test(`shared scheme ${kind} editor and detail sections`,async({page})=>{
 test.setTimeout(120000);await page.setViewportSize({width:390,height:844});const state=await fixture(page)
 await page.goto(`/?view=${kind}s&new=1`);await expect(page.getByRole('dialog')).toBeVisible();await capture(page,kind+'-editor',390)
 await page.getByRole('combobox',{name:'Customer',exact:true}).fill('Taylor');await page.getByRole('option').first().click();await page.getByPlaceholder('Description',{exact:true}).fill('Repair service');await page.getByPlaceholder('Unit price',{exact:true}).fill('150');await capture(page,kind+'-editor-populated',390)
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByPlaceholder('Description',{exact:true})).toHaveValue('Repair service')
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Cancel',exact:true}).click()
 if(kind==='invoice')await page.goto('/?view=invoices&document='+E)
 else {await page.goto('/?view=estimates');await page.getByRole('button',{name:/Open estimate/}).first().click()}
 await expect(page.getByRole('tab',{name:'Details',exact:true})).toBeVisible()
 for(const tab of ['Details','Photos & expenses','Activity']){await page.getByRole('tab',{name:new RegExp('^'+tab.replace('&','\\&'))}).click();await capture(page,kind+'-'+tab.replaceAll(/[^a-z]/gi,''),390)}
 expect(state.calls.some(c=>/send-document|send-invoice|record_payment|charge/.test(c.path))).toBe(false)
})
test('shared scheme subsequent destinations and team sections',async({page})=>{
 test.setTimeout(180000);await page.setViewportSize({width:390,height:844});await fixture(page)
 for(const [name,url] of [['schedule','schedule'],['reminders','reminders'],['bookkeeping','bookkeeping'],['payments','payments'],['customer-detail','customers&document='+C],...['company','documents','delivery','customer_reminders','calendar','storage','archive','support','plans','subscription'].map(s=>[s,'settings&section='+s])]){
  await page.goto('/?view='+url);await expect(page.locator('.workspace-inner>.page-stack')).toBeVisible();await page.waitForLoadState('networkidle');await capture(page,name,390)
 }
 await page.goto('/?view=settings&section=team');await expect(page.locator('.worker-row').first()).toBeVisible()
 for(const name of ['Availability','Account Access','Workers']){await page.getByRole('navigation',{name:'Team management sections'}).getByRole('button',{name,exact:true}).click();await page.waitForLoadState('networkidle');await capture(page,'team-'+name.replaceAll(' ',''),390)}
 await page.getByRole('button',{name:'Add worker',exact:true}).click();await capture(page,'worker-editor',390)
})
