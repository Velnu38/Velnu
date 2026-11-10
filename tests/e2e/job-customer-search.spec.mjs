import {test,expect} from '@playwright/test'
import {mock,B,C,customer} from './audit-fixture.mjs'
import {customerSearchResponse} from './job-customer-fixture.mjs'
for(const width of [390,1440])test(`Jobs defers customer reads until a bounded draft search and recovers at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});await mock(page,{ai:true});let customerScans=0,failed=false;const calls=[];
 const extra={...customer,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',first_name:'José',last_name:'Muñoz',phone:'7575559876'},rows=[customer,extra];
 page.on('request',r=>{if(new URL(r.url()).pathname==='/rest/v1/customers')customerScans++});
 await page.route('**/rpc/search_job_customers',r=>{const p=r.request().postDataJSON();calls.push(p);expect(p.p_business).toBe(B);return r.fulfill({json:failed?{}:customerSearchResponse(rows,p)})});
 await page.goto('/?view=work');await expect(page.getByRole('button',{name:'Create job',exact:true})).toBeVisible();expect(calls).toHaveLength(0);expect(customerScans).toBe(0);
 await page.getByRole('button',{name:'Create job',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Create a job',exact:true}),picker=dialog.getByRole('combobox',{name:'Customer',exact:true});
 await picker.fill('jose');await expect(dialog.getByRole('option')).toHaveCount(1);await dialog.getByRole('option',{name:/José Muñoz/}).click();await expect(picker).toHaveValue('José Muñoz');await expect(dialog.getByRole('button',{name:'Change customer',exact:true})).toBeVisible();
 await dialog.getByLabel('Job title',{exact:true}).fill('Keep this draft');await dialog.getByRole('button',{name:'Change customer',exact:true}).click();failed=true;await picker.fill('Test');await expect(dialog.getByRole('alert')).toContainText('Customer suggestions could not load');await expect(dialog.getByRole('option')).toHaveCount(0);await expect(dialog.getByLabel('Job title',{exact:true})).toHaveValue('Keep this draft');
 failed=false;await dialog.getByRole('button',{name:'Retry customers',exact:true}).click();await expect(dialog.getByRole('option')).toHaveCount(1);await dialog.getByRole('option').click();await expect(picker).toHaveValue('Test Customer');await expect.poll(()=>calls.some(p=>p.p_selected===C)).toBe(true);expect(customerScans).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
})
