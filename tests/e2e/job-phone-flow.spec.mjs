import {test,expect} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {mkdir} from 'node:fs/promises'
import {mock,B,C,J,U,customer} from './audit-fixture.mjs'
import {mockJobDirectory} from './job-directory-fixture.mjs'
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'}
async function fixture(page,{restricted=false,populated=false}={}){
 const state=await mock(page,{ai:true})
 const job={id:J,customer_id:C,customers:[customer],properties:[],title:'Kitchen renovation',description:'Keep the side gate closed.',status:'in_progress',scheduled_start:null,scheduled_end:null,assigned_user_ids:[U],updated_at:'2026-11-12T01:00:00Z',active_appointment:null,invoice:null}
 const data={tasks:[{id:'task-1',title:'Install cabinet doors',completed:false,version:1,priority:'high',worker_id:U,due_on:null}],materials:[],templates:[],visits:[],activity:[],financial_access:!restricted,billing_access:!restricted,calendar_access:!restricted,time:[],recorded_expenses:0,documents:[],changes:[],budget:null,pending_time_minutes:0,uncalculated_expenses:0}
 if(populated){
  job.customers=[{...customer,first_name:'Taylor',last_name:'Morgan',phone:'+17575550100'}];job.properties=[{address_line1:'124 Oak Street',city:'Chesapeake',state:'VA',postal_code:'23320'}];job.status='scheduled';job.scheduled_start='2099-11-16T19:00:00Z';job.scheduled_end='2099-11-16T21:00:00Z';job.active_appointment={id:'77777777-7777-4777-8777-777777777777',starts_at:job.scheduled_start,ends_at:job.scheduled_end,status:'scheduled'};
  data.tasks=[{...data.tasks[0],due_on:'2099-11-16'},{id:'task-2',title:'Final inspection',completed:false,version:1,priority:'normal',worker_id:null,due_on:'2099-11-17'},...[3,4,5].map(n=>({id:'task-'+n,title:'Completed preparation '+n,completed:true,version:1,priority:'normal',worker_id:U,due_on:null}))];
  data.activity=[{id:1,event:'Visit scheduled',created_at:'2026-11-12T15:30:00Z',actor:'Alex Carter'}];
  data.materials=[{id:'material-1',label:'Cabinet hardware',quantity:12,unit_cost:8,status:'received',version:1}];
  data.visits=[{...job.active_appointment,job_id:J,title:'Kitchen installation',assigned_worker_ids:[U],updated_at:job.updated_at}];
 }
 await mockJobDirectory(page,()=>[job])
 await page.route('**/rest/v1/jobs?**',route=>route.fulfill({headers:cors,json:new URL(route.request().url()).searchParams.has('id')?job:[job]}))
 await page.route('**/rpc/get_job_workflow_context',route=>route.fulfill({headers:cors,json:[{job_id:J,active_appointment:job.active_appointment,invoice:null}]}))
 for(const name of ['get_job_management','get_job_workspace'])await page.route('**/rpc/'+name,route=>route.fulfill({headers:cors,json:data}))
 await page.route('**/rpc/get_job_cost_review',route=>route.fulfill({headers:cors,json:{pending_time:[],expenses:[],possible_duplicate_time:[]}}))
 await page.route('**/rpc/get_job_reports',route=>route.fulfill({headers:cors,json:[]}))
 if(restricted)await page.route('**/rest/v1/business_members?*',async route=>{
  // Preserve the ordinary authenticated fixture's business payload, changing only access.
  const {business}=await import('./audit-fixture.mjs');return route.fulfill({headers:cors,json:{business_id:B,role:'viewer',access_modules:['jobs'],businesses:business}})
 })
 return state
}
const area=(page,name)=>page.getByRole('group',{name:'Job workspace areas'}).getByRole('button',{name,exact:true})
const tile=(page,name)=>page.locator('.jm-quick-tile').filter({has:page.getByText(name,{exact:true})})
async function fits(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)}
async function shot(page,name){await mkdir('tmp/ux-review',{recursive:true});await page.screenshot({path:`tmp/ux-review/phone-flow-${name}.png`,fullPage:!name.startsWith('editor-')})}
for(const viewport of [{width:320,height:568},{width:390,height:844},{width:430,height:932},{width:768,height:1024},{width:844,height:390}])test(`phone job flow fills viewport, preserves every destination and full-screen forms at ${viewport.width}x${viewport.height}`,async({page})=>{
 test.setTimeout(60000)
 await page.setViewportSize(viewport);const state=await fixture(page)
 await page.goto(`/?view=work&workspace=management&job=${J}`)
 await expect(page.getByRole('region',{name:'Job summary',exact:true})).toBeVisible()
 const workspace=page.getByRole('region',{name:'Selected job workspace',exact:true})
 for(const selector of ['.app-shell','.workspace','.topbar']){const shell=await page.locator(selector).boundingBox();expect(Math.abs(shell.width-viewport.width)).toBeLessThan(2)}
 const box=await workspace.boundingBox();expect(box.width).toBeGreaterThanOrEqual(viewport.width-28)
 await expect(workspace.getByRole('tab',{name:'Overview',exact:true})).toHaveCount(0)
 await fits(page);await shot(page,`summary-${viewport.width}`)
 const contrast=await new AxeBuilder({page}).include('.jm-next-action').withTags(['wcag2aa']).analyze();expect(contrast.violations.map(v=>v.id)).toEqual([])
 for(const [group,items] of [['Work',['Tasks & templates','Visits & crew','Materials','Photos & expenses']],['Billing',['Invoices','Costs & budget','Change orders']],['Records',['Activity history','Completion reports']]]){
  await area(page,group).click();await expect(page.locator('.jm-quick-tile')).toHaveCount(items.length)
  await fits(page);await shot(page,`${group}-${viewport.width}`)
  for(const name of items){
   await tile(page,name).click();await expect(page.locator('.jm-panel:not([hidden])')).toBeVisible()
   await fits(page)
   await page.getByRole('button',{name:`‹ Back to ${group}`,exact:true}).click()
   await expect(tile(page,name)).toBeVisible()
  }
 }
 await area(page,'Work').click();await tile(page,'Tasks & templates').click();await shot(page,`tasks-${viewport.width}`)
 await page.getByRole('button',{name:'+ Add task',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Add task',exact:true});await expect(dialog).toBeVisible()
 const rect=await dialog.boundingBox();expect(Math.abs(rect.x)).toBeLessThan(2);expect(Math.abs(rect.y)).toBeLessThan(2);expect(Math.abs(rect.width-viewport.width)).toBeLessThan(2);expect(Math.abs(rect.height-viewport.height)).toBeLessThan(2)
 await expect(dialog.getByLabel('Work to complete')).toBeFocused();await dialog.getByLabel('Work to complete').fill('Keep this unsaved task')
 page.once('dialog',d=>d.dismiss());await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog.getByLabel('Work to complete')).toHaveValue('Keep this unsaved task')
 await shot(page,`editor-${viewport.width}`)
 page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0)
 await page.reload();await expect(page.getByRole('tabpanel',{name:'Tasks',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'‹ Back to Work',exact:true}).click();await page.reload();await expect(tile(page,'Tasks & templates')).toBeVisible()
 await area(page,'Summary').click();await page.locator('.jm-notes-disclosure summary').click();await page.getByLabel('Job notes',{exact:true}).fill('Retain notes on Cancel')
 page.once('dialog',d=>d.dismiss());await area(page,'Work').click();await expect(page.getByLabel('Job notes',{exact:true})).toHaveValue('Retain notes on Cancel')
 page.once('dialog',d=>d.accept());await area(page,'Work').click();await expect(tile(page,'Tasks & templates')).toBeVisible()
 await fits(page)
 expect(state.calls.some(c=>/send-|create_dispatched|complete_job|manage_job_workspace/.test(c.path))).toBe(false)
})
test('phone menus retain role limits and accessible names',async({page})=>{
 await page.setViewportSize({width:390,height:844});await fixture(page,{restricted:true});await page.goto(`/?view=work&workspace=management&job=${J}`)
 await expect(page.getByRole('region',{name:'Job summary',exact:true})).toBeVisible();await expect(area(page,'Billing')).toHaveCount(0)
 await area(page,'Work').click();await expect(tile(page,'Tasks & templates')).toBeVisible()
 const result=await new AxeBuilder({page}).include('.jm-mobile-menu').include('.jm-section-groups').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(result.violations.map(v=>v.id)).toEqual([])
 await tile(page,'Tasks & templates').click();await expect(page.getByRole('button',{name:'+ Add task',exact:true})).toHaveCount(0)
})
test('desktop retains its complete workspace when moving between phone and desktop widths',async({page})=>{
 await fixture(page);await page.setViewportSize({width:1440,height:1000});await page.goto(`/?view=work&workspace=management&job=${J}`)
 await expect(page.getByRole('tab',{name:'Materials',exact:true})).toBeVisible();await page.getByRole('tab',{name:'Materials',exact:true}).click()
 await page.setViewportSize({width:390,height:844});await expect(page.getByRole('tabpanel',{name:'Materials',exact:true})).toBeVisible();await page.getByRole('button',{name:'‹ Back to Work',exact:true}).click()
 await page.setViewportSize({width:1440,height:1000});await expect(page.getByRole('tab',{name:'Tasks',exact:true})).toBeVisible();await expect(page.getByRole('tab',{name:'Tasks',exact:true})).toHaveAttribute('aria-selected','true')
})
test('phone entry starts with the selected job and keeps the shell compact',async({page})=>{
 await page.setViewportSize({width:390,height:844});await fixture(page)
 await page.goto('/?view=work&workspace=management')
 const card=page.getByRole('region',{name:'Selected job workspace',exact:true});await expect(card).toBeVisible()
 await expect(page.locator('.jm-queue')).toBeHidden()
 await expect(page.locator('.jm-summary')).not.toHaveAttribute('open','')
 const box=await card.boundingBox();expect(box.y).toBeLessThan(460)
 const heading=page.getByRole('heading',{name:'Job Management',exact:true});const title=await heading.boundingBox();const create=await page.getByRole('button',{name:'Create job',exact:false}).boundingBox();expect(Math.abs(title.y-create.y)).toBeLessThan(40);expect(title.x+title.width).toBeLessThanOrEqual(create.x)
 await shot(page,'entry-390')
 await page.locator('.jm-mobile-picker select').selectOption('browse');await expect(page.locator('.jm-queue')).toBeVisible()
 await expect(page.getByRole('searchbox',{name:'Find a job',exact:true})).toBeVisible()
})

for(const width of [375,390,393,430])test(`phone mockup populated screen comparisons at ${width}px`,async({page})=>{
 test.setTimeout(120000);await page.setViewportSize({width,height:844});const state=await fixture(page,{populated:true});await page.goto(`/?view=work&workspace=management&job=${J}`);
 await expect(page.getByRole('region',{name:'Job summary',exact:true})).toBeVisible();
 const viewport=await page.evaluate(()=>({layout:innerWidth,visual:visualViewport?.width,scale:visualViewport?.scale,root:document.documentElement.clientWidth}));expect(viewport.layout).toBe(width);expect(viewport.visual).toBeCloseTo(width,0);expect(viewport.scale).toBe(1);
 await page.evaluate(()=>scrollTo(0,0));await shot(page,`mockup-Summary-${width}`);
 for(const [group,items] of [['Work',['Tasks & templates','Visits & crew','Materials','Photos & expenses']],['Billing',['Invoices','Costs & budget','Change orders']],['Records',['Activity history','Completion reports']]]){
  await area(page,group).click();await page.evaluate(()=>scrollTo(0,0));await fits(page);await shot(page,`mockup-${group}-${width}`);
  for(const name of items){await tile(page,name).click();await expect(page.locator('.jm-panel:not([hidden])')).toBeVisible();await fits(page);await page.evaluate(()=>scrollTo(0,0));await shot(page,`mockup-panel-${name.replaceAll(/[^a-z]/gi,'')}-${width}`);
   if(width===390){const panel=page.locator('.jm-panel:not([hidden])');const editors=panel.getByRole('button').filter({hasText:/^(\+ ?)?Add (task|material|visit|expense)$|^Templates$|^Assign crew$|^Reschedule next visit$/});const labels=await editors.allTextContents();for(const label of labels){const button=panel.getByRole('button',{name:label.trim(),exact:true});if(!await button.isEnabled())continue;await button.click();const dialog=page.getByRole('dialog').last();await expect(dialog).toBeVisible();await fits(page);await shot(page,`editor-${name.replaceAll(/[^a-z]/gi,'')}-${label.replaceAll(/[^a-z]/gi,'')}-${width}`);await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);}}
   await page.getByRole('button',{name:`‹ Back to ${group}`,exact:true}).click();
  }
 }
 expect(state.calls.some(c=>/send-|create_dispatched|complete_job|manage_job_workspace/.test(c.path))).toBe(false);
})
