import {test,expect} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {mkdir,writeFile} from 'node:fs/promises'
import {mock,B,C,J,U,customer} from './audit-fixture.mjs'
import {mockJobDirectory} from './job-directory-fixture.mjs'
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'}
async function fixture(page,{restricted=false,populated=false,completed=false,longTitle=false}={}){
 const state=await mock(page,{ai:true})
 const job={id:J,customer_id:C,customers:[customer],properties:[],title:'Kitchen renovation',description:'Keep the side gate closed.',status:'in_progress',scheduled_start:null,scheduled_end:null,assigned_user_ids:[U],updated_at:'2026-11-12T01:00:00Z',active_appointment:null,invoice:null}
 const data={tasks:[{id:'task-1',title:'Install cabinet doors',completed:false,version:1,priority:'high',worker_id:U,due_on:null}],materials:[],templates:[],visits:[],activity:[],financial_access:!restricted,billing_access:!restricted,calendar_access:!restricted,time:[],recorded_expenses:0,documents:[],changes:[],budget:null,pending_time_minutes:0,uncalculated_expenses:0}
 if(populated){
  job.customers=[{...customer,first_name:'Taylor',last_name:'Morgan',phone:'+17575550100'}];job.properties=[{address_line1:'124 Oak Street',city:'Chesapeake',state:'VA',postal_code:'23320'}];job.status='scheduled';job.scheduled_start='2099-11-16T19:00:00Z';job.scheduled_end='2099-11-16T21:00:00Z';job.active_appointment={id:'77777777-7777-4777-8777-777777777777',starts_at:job.scheduled_start,ends_at:job.scheduled_end,status:'scheduled'};
  data.tasks=[{...data.tasks[0],due_on:'2099-11-16'},{id:'task-2',title:'Final inspection',completed:false,version:1,priority:'normal',worker_id:null,due_on:'2099-11-17'},...[3,4,5].map(n=>({id:'task-'+n,title:'Completed preparation '+n,completed:true,version:1,priority:'normal',worker_id:U,due_on:null}))];
  data.activity=[{id:1,event:'Visit scheduled',created_at:'2026-11-12T15:30:00Z',actor:'Alex Carter'}];
  data.materials=[{id:'material-1',name:'Cabinet hardware',quantity:12,unit:'pieces',supplier:'',estimated_cost:96,status:'received',version:1}];
  data.visits=[{...job.active_appointment,job_id:J,title:'Kitchen installation',worker_ids:[U],version:1}];
 }
 if(longTitle)job.title='TEST ONLY - estimate and approval-link delivery check with a long service description';
 if(completed){job.status='completed';job.active_appointment=null;data.visits=[]}
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
const tile=(page,name)=>page.getByRole('navigation',{name:/^(Work|Billing|Records) sections$/}).getByRole('button',{name,exact:true})
async function fits(page){await page.evaluate(()=>document.fonts.ready);const result=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,internal:[...document.querySelectorAll('body *')].filter(el=>el.clientWidth>0&&el.scrollWidth>el.clientWidth+1).slice(-20).map(el=>({tag:el.tagName,cls:el.className,scroll:el.scrollWidth,client:el.clientWidth,overflow:getComputedStyle(el).overflow,text:el.textContent.slice(0,60)})),overflow:[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+.5||r.left<-.5)}).slice(-20).map(el=>({tag:el.tagName,cls:el.className,text:el.textContent.slice(0,60),rect:{x:el.getBoundingClientRect().x,width:el.getBoundingClientRect().width},font:getComputedStyle(el).fontSize}))}));expect(result.scroll,JSON.stringify(result)).toBeLessThanOrEqual(result.width)}
async function shot(page,name){await page.evaluate(()=>document.fonts.ready);await mkdir('tmp/ux-review',{recursive:true});await page.screenshot({path:`tmp/ux-review/phone-flow-${name}.png`,fullPage:!name.startsWith('editor-')})}
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
  await area(page,group).click();await expect(page.getByRole('navigation',{name:/^(Work|Billing|Records) sections$/}).getByRole('button')).toHaveCount(items.length)
  await fits(page);await shot(page,`${group}-${viewport.width}`)
  for(const name of items){
   await tile(page,name).click();await expect(page.locator('.jm-panel:not([hidden])')).toBeVisible()
   await fits(page)
   await area(page,group).click()
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
 await area(page,'Work').click();await page.reload();await expect(tile(page,'Tasks & templates')).toBeVisible()
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
 const result=await new AxeBuilder({page}).include('.jm-direct-sections').include('.jm-section-groups').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(result.violations.map(v=>v.id)).toEqual([])
 await tile(page,'Tasks & templates').click();await expect(page.getByRole('button',{name:'+ Add task',exact:true})).toHaveCount(0)
})
test('desktop retains its complete workspace when moving between phone and desktop widths',async({page})=>{
 await fixture(page);await page.setViewportSize({width:1440,height:1000});await page.goto(`/?view=work&workspace=management&job=${J}`)
 await area(page,'Work').click();await expect(tile(page,'Materials')).toBeVisible();await tile(page,'Materials').click()
 await page.setViewportSize({width:390,height:844});await expect(page.getByRole('tabpanel',{name:'Materials',exact:true})).toBeVisible();await area(page,'Work').click()
 await page.setViewportSize({width:1440,height:1000});await expect(tile(page,'Tasks & templates')).toBeVisible();await expect(tile(page,'Tasks & templates')).toHaveAttribute('aria-pressed','true')
})
test('phone entry starts with the directory and opens only the selected job',async({page})=>{
 await page.setViewportSize({width:390,height:844});await fixture(page);await page.goto('/?view=work&workspace=management');
 await expect(page.getByRole('region',{name:'Selected job workspace',exact:true})).toHaveCount(0);
 await expect(page.getByRole('searchbox',{name:'Search jobs',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Open job Kitchen renovation',exact:true}).click();
 const card=page.getByRole('region',{name:'Selected job workspace',exact:true});await expect(card).toBeVisible();
 const box=await card.boundingBox();expect(box.y).toBeLessThan(460);
 await expect(page.getByRole('button',{name:'‹ All jobs',exact:true})).toBeVisible();await shot(page,'entry-390');
 await page.getByRole('button',{name:'‹ All jobs',exact:true}).click();await expect(page.getByRole('searchbox',{name:'Search jobs',exact:true})).toBeVisible();
})

for(const width of [375,390,393,430])test(`phone mockup populated screen comparisons at ${width}px`,async({page})=>{
 test.setTimeout(120000);await page.setViewportSize({width,height:844});const state=await fixture(page,{populated:true});await page.goto(`/?view=work&workspace=management&job=${J}`);
 await expect(page.getByRole('region',{name:'Job summary',exact:true})).toBeVisible();
 const viewport=await page.evaluate(()=>({layout:innerWidth,visual:visualViewport?.width,scale:visualViewport?.scale,root:document.documentElement.clientWidth}));expect(viewport.layout).toBe(width);expect(viewport.visual).toBeCloseTo(width,0);expect(viewport.scale).toBe(1);
 await page.evaluate(()=>scrollTo(0,0));await shot(page,`mockup-Summary-${width}`);const quick=await page.locator('.jm-create-actions').first().locator('a,button').evaluateAll(els=>els.map(el=>({x:el.getBoundingClientRect().x,width:el.getBoundingClientRect().width})).sort((a,b)=>a.x-b.x));expect(quick).toHaveLength(3);for(let i=1;i<quick.length;i++){expect(quick[i].x).toBeGreaterThanOrEqual(quick[i-1].x+quick[i-1].width);expect(Math.abs(quick[i].width-quick[0].width)).toBeLessThan(2);}
 for(const [group,items] of [['Work',['Tasks & templates','Visits & crew','Materials','Photos & expenses']],['Billing',['Invoices','Costs & budget','Change orders']],['Records',['Activity history','Completion reports']]]){
  await area(page,group).click();await page.evaluate(()=>scrollTo(0,0));await fits(page);await shot(page,`mockup-${group}-${width}`);if(width===390){const typography=await page.getByRole('navigation',{name:/^(Work|Billing|Records) sections$/}).getByRole('button').first().evaluate(el=>({family:getComputedStyle(el).fontFamily,weight:getComputedStyle(el).fontWeight,size:getComputedStyle(el).fontSize}));expect(Number(typography.weight)).toBeGreaterThanOrEqual(600);await writeFile(`tmp/ux-review/typography-${group}.json`,JSON.stringify(typography));}if(width===390&&group==='Records'){await area(page,'Summary').click();await page.locator('.jm-notes-disclosure summary').click();await expect(page.getByLabel('Job notes',{exact:true})).toBeVisible();await fits(page);await shot(page,'editor-job-details-390');await area(page,'Records').click();}
  for(const name of items){await tile(page,name).click();await expect(page.locator('.jm-panel:not([hidden])')).toBeVisible();await fits(page);await page.evaluate(()=>scrollTo(0,0));await shot(page,`mockup-panel-${name.replaceAll(/[^a-z]/gi,'')}-${width}`);
   if(width===390){const panel=page.locator('.jm-panel:not([hidden])');const editors=panel.getByRole('button').filter({hasText:/^(\+ ?)?Add (task|material|visit|expense)$|^Templates$|^Assign crew$|^Reschedule next visit$|^\+ Plan visit$/});const labels=await editors.allTextContents();for(const label of labels){const button=panel.getByRole('button',{name:label.trim(),exact:true});if(!await button.isEnabled())continue;await button.click();const dialog=page.getByRole('dialog').last();await expect(dialog).toBeVisible();await fits(page);await shot(page,`editor-${name.replaceAll(/[^a-z]/gi,'')}-${label.replaceAll(/[^a-z]/gi,'')}-${width}`);await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);}}
   if(width===390 && name==='Photos & expenses'){await page.getByRole('button',{name:'Add expense manually',exact:true}).click();await expect(page.getByRole('button',{name:'Save expense',exact:true})).toBeVisible();await fits(page);await shot(page,'inline-expense-390');await page.getByRole('button',{name:'Cancel',exact:true}).click();}
   if(width===390 && name==='Costs & budget'){for(const label of ['Budget & variance','Time & labor cost']){await page.locator('.work-plan-section>summary').filter({hasText:label}).click();await fits(page);await shot(page,`inline-${label.replaceAll(/[^a-z]/gi,'')}-390`);await page.locator('.work-plan-section>summary').filter({hasText:label}).click();}}
   await area(page,group).click();
  }
 }
 expect(state.calls.some(c=>/send-|create_dispatched|complete_job|manage_job_workspace/.test(c.path))).toBe(false);
})


test('phone mockup existing edit and completion forms retain controls',async({page})=>{
 await page.setViewportSize({width:390,height:844});const state=await fixture(page,{populated:true});
 await page.goto(`/?view=work&workspace=management&job=${J}`);
 await expect(page.getByRole('region',{name:'Job summary',exact:true})).toBeVisible();
 await area(page,'Work').click();await tile(page,'Tasks & templates').click();
 const completed=page.locator('.jm-completed-tasks');await expect(completed).not.toHaveAttribute('open','');await completed.locator('summary').click();
 await expect(completed.getByRole('checkbox')).toHaveCount(3);await expect(completed.getByRole('button',{name:'Remove Completed preparation 3',exact:true})).toBeEnabled();
 await completed.getByRole('button',{name:'Edit Completed preparation 3',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();await shot(page,'editor-completed-task-390');await page.keyboard.press('Escape');
 await area(page,'Work').click();await tile(page,'Materials').click();
 await page.getByRole('button',{name:'Edit Cabinet hardware',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await shot(page,'editor-existing-material-390');await page.keyboard.press('Escape');
 await area(page,'Work').click();await tile(page,'Visits & crew').click();
 await page.getByRole('button',{name:'Edit visit',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await shot(page,'editor-existing-visit-390');await page.keyboard.press('Escape');
 expect(state.calls.some(c=>/send-|create_dispatched|complete_job|manage_job_workspace/.test(c.path))).toBe(false);
 await fixture(page,{populated:true,completed:true});await page.goto(`/?view=work&workspace=management&job=${J}&section=reports`);await expect(page.getByRole('button',{name:'+ Create report version',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'+ Create report version',exact:true}).click();await expect(page.getByRole('dialog',{name:'Create completion report',exact:true})).toBeVisible();await fits(page);await shot(page,'editor-completion-report-390');await page.keyboard.press('Escape');
});

for(const width of [320,390])test(`phone mockup long job names retain full viewport at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});await fixture(page,{populated:true,longTitle:true});await page.goto(`/?view=work&workspace=management&job=${J}`);
 await expect(page.getByRole('region',{name:'Job summary',exact:true})).toBeVisible();await fits(page);await expect(page.locator('.jm-job-header h2')).toContainText('with a long service description');await shot(page,`long-title-${width}`);
 await page.getByRole('button',{name:'‹ All jobs',exact:true}).click();await expect(page.getByRole('searchbox',{name:'Search jobs',exact:true})).toBeVisible();await fits(page);
});

// The first sequential card must be inspected independently of the other cards.
test('phone Summary card reference candidate preserves readable controls and actions',async({page})=>{
 await page.setViewportSize({width:390,height:844});const state=await fixture(page,{populated:true});
 await page.goto(`/?view=work&workspace=management&job=${J}`);
 await expect(page.getByRole('region',{name:'Job summary',exact:true})).toBeVisible();
 await page.evaluate(()=>document.fonts.ready);await fits(page);
 const metrics=await page.evaluate(()=>{const rect=s=>{const el=document.querySelector(s),r=el.getBoundingClientRect(),c=getComputedStyle(el);return {x:r.x,y:r.y,width:r.width,height:r.height,font:c.fontSize,weight:c.fontWeight}};return {picker:rect('.jm-section-groups button'),card:rect('.jm-phone-workspace'),next:rect('.jm-next-action'),actions:rect('.jm-job-actions'),progress:rect('.jm-progress-line')}});
 expect(metrics.picker.height).toBeGreaterThanOrEqual(44);
 expect(metrics.card.width).toBeGreaterThanOrEqual(362);
 expect(metrics.card.width).toBeLessThanOrEqual(390);
 await expect(page.locator(".jm-phone-workspace .jm-notes-disclosure")).toHaveCount(0);
 await expect(page.locator(".jm-summary-secondary .jm-notes-disclosure")).toBeVisible();
 expect(metrics.actions.height).toBeGreaterThanOrEqual(44);
 await mkdir('tmp/ux-review',{recursive:true});await writeFile('tmp/ux-review/summary-card-metrics.json',JSON.stringify(metrics,null,2));
 await shot(page,'summary-card-candidate-390');
 await page.getByRole('button',{name:'Review visit',exact:true}).click();
 await expect(page.getByRole('tabpanel',{name:'Schedule & Crew',exact:true})).toBeVisible();
 await area(page,'Work').click();
 await area(page,'Summary').click();await page.getByRole('button',{name:'＋ Add task',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Add task',exact:true})).toBeVisible();await page.keyboard.press('Escape');
 await page.locator('.jm-notes-disclosure summary').click();await expect(page.getByLabel('Job notes',{exact:true})).toBeVisible();
 expect(state.calls.some(c=>/send-|create_dispatched|complete_job|manage_job_workspace/.test(c.path))).toBe(false);
});
