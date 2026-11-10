import {test,expect} from '@playwright/test'
import {mock,B,C,U,customer} from './audit-fixture.mjs'
import {jobDirectoryPage} from './job-directory-fixture.mjs'

for(const width of [390,1440])test(`Jobs server pages retain search focus and recover from failed pages at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:950});await mock(page,{ai:true})
 const jobs=Array.from({length:61},(_,i)=>({id:'99999999-9999-4999-8999-'+String(i).padStart(12,'0'),business_id:B,customer_id:C,title:`Directory job ${String(i).padStart(2,'0')}`,status:'lead',scheduled_start:null,assigned_user_ids:[U],customers:[customer],properties:[],active_appointment:null,invoice:null}))
 const requests=[];let fail=false
 await page.route('**/rest/v1/rpc/get_job_directory_page',async route=>{
  const args=route.request().postDataJSON();requests.push(args);expect(args.p_business).toBe(B)
  if(fail)return route.fulfill({status:503,json:{message:'Directory temporarily unavailable'}})
  if(args.p_search)await new Promise(resolve=>setTimeout(resolve,350))
  await route.fulfill({json:jobDirectoryPage(jobs,args)})
 })
 await page.goto('/?view=work')
 const cards=page.locator('.jobs-record-list>article'),pager=page.getByRole('navigation',{name:'jobs pages'})
 await expect(cards).toHaveCount(25);await expect(pager).toContainText('61 records · Page 1 of 3')
 await pager.getByRole('button',{name:'Next',exact:true}).click();await expect(pager).toContainText('Page 2 of 3');await expect(cards.first()).toContainText('Directory job 25')
 await pager.getByRole('button',{name:'Next',exact:true}).click();await expect(cards).toHaveCount(11);await expect(pager).toContainText('Page 3 of 3')
 const search=page.getByRole('searchbox',{name:'Search jobs'})
 await search.pressSequentially('Directory job 59',{delay:35})
 await expect(search).toBeFocused();await expect(search).toHaveValue('Directory job 59')
 await expect(cards).toHaveCount(1);await expect(cards.first()).toContainText('Directory job 59');await expect(pager).toContainText('Page 1 of 1')
 expect(requests.some(r=>r.p_page===2)).toBe(true)
 fail=true;await search.fill('failure');await expect(page.getByRole('alert')).toContainText('Directory temporarily unavailable')
 await expect(cards).toHaveCount(0);await expect(search).toHaveValue('failure')
 fail=false;await search.fill('');await expect(cards).toHaveCount(25)
 await expect(pager).toContainText('61 records · Page 1 of 3')
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
