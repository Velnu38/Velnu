import {test,expect} from '@playwright/test'
import {mock,B} from './audit-fixture.mjs'
const CID='88888888-8888-4888-8888-888888888888'
const sample={id:CID,title:'Calendar issue',description:'My reminder disappeared.',priority:'normal',status:'open',version:1,created_at:'2026-11-03T12:00:00Z',updated_at:'2026-11-03T12:00:00Z',business_name:'Test business'}
async function intercept(page,name,handler){await page.route('https://example.supabase.co/rest/v1/rpc/'+name,async route=>{
 if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST,OPTIONS'},body:''})
 const value=await handler(route.request().postDataJSON());await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(value)})
})}
for(const width of [1440,390]){
 test(`administration refuses customer access and requests MFA before loading data at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await mock(page);const calls=[];let operator=false
  await intercept(page,'platform_admin_request',b=>{calls.push(b);return operator?{operator:true,mfa_required:true}:{error:'Finviant administrator access is restricted.'}})
  await page.goto('/admin');await expect(page.getByRole('alert')).toContainText('restricted')
  operator=true;await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.getByRole('heading',{name:'Verify administrator access'})).toBeVisible()
  expect(calls.every(b=>b.p_action==='access')).toBe(true);await expect(page.getByRole('button',{name:'Set up authenticator'})).toBeVisible()
 })
 test(`administrator can update support cases with an internal note and reload conflicts at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await mock(page);let current={...sample},writes=0;const messages=[]
  await intercept(page,'platform_admin_request',b=>{
   if(b.p_action==='access')return{operator:true,mfa_required:false}
   if(b.p_action==='overview')return{checked_at:sample.created_at,accounts:1,account_limit:10,pro_workspaces:1,open_cases:1,database:'Connected',email_queue:0,email_failures:0,billing:'Live billing not activated',provider_note:'Provider configuration requires verification.'}
   if(b.p_action==='cases')return{total:1,rows:[current]}
   if(b.p_action==='case')return{case:current,messages}
   if(b.p_action==='update_case'){writes++;if(writes===1){current={...current,version:2};return{error:'This case changed. Reload it; your note has been preserved.',conflict:true}}current={...current,status:b.p_input.status,version:3};messages.push({id:'1',body:b.p_input.body,audience:b.p_input.audience,created_at:sample.created_at});return{case:current,messages}}
   return{rows:[],total:0}
  })
  await page.goto('/admin');await expect(page.getByText('1 / 10')).toBeVisible();await page.getByRole('button',{name:'Customer issues',exact:true}).click();await page.getByRole('button',{name:'Calendar issue',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Manage support case'});await dialog.getByRole('combobox',{name:'Status',exact:true}).selectOption('in_progress');await dialog.getByLabel('Internal note',{exact:true}).fill('Checking the reminder handler.')
  await dialog.getByRole('button',{name:'Save case update'}).click();await expect(dialog.getByRole('alert')).toContainText('This case changed');await dialog.getByRole('button',{name:'Reload case'}).click();await expect(dialog.getByLabel('Internal note',{exact:true})).toHaveValue('Checking the reminder handler.');page.once('dialog',d=>d.dismiss());await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'Save case update'}).dblclick();await expect(dialog.getByText('Checking the reminder handler.')).toBeVisible();expect(writes).toBe(2)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 })
 test(`customer support preserves a failed submission and retries without duplicating its request at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await mock(page);const ids=[];let fail=true,created=false
  await intercept(page,'platform_admin_request',()=>({error:'Restricted'}))
  await intercept(page,'support_request',b=>{if(b.p_action==='list')return{total:created?1:0,rows:created?[sample]:[]};if(b.p_action==='create'){ids.push(b.p_input.request_id);if(fail){fail=false;return{error:'Temporary failure. Please retry.'}}created=true;return{case:sample,messages:[]}}return{case:sample,messages:[]}})
  await page.goto('/?view=settings');await page.getByRole('button',{name:'Help & support',exact:true}).click();await page.getByRole('button',{name:'Report an issue',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Report an issue'});await dialog.getByLabel('Issue title').fill('Calendar issue');await dialog.getByLabel('What happened?').fill('My reminder disappeared.');await dialog.getByRole('button',{name:'Submit issue'}).click();await expect(dialog.getByRole('alert')).toContainText('Temporary failure');await expect(dialog.getByLabel('What happened?')).toHaveValue('My reminder disappeared.')
  await dialog.getByRole('button',{name:'Submit issue'}).click();await expect(page.getByRole('dialog',{name:'Your support case'})).toBeVisible();expect(ids.length).toBe(2);expect(ids[0]).toBe(ids[1])
 })
}
