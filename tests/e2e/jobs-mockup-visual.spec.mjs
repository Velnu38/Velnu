import {test,expect} from '@playwright/test'
import {mkdir} from 'node:fs/promises'
import {mock,B,C,U,customer} from './audit-fixture.mjs'
import {mockJobDirectory} from './job-directory-fixture.mjs'

const job=(id,title,status,person,property,completed_at=null)=>({
 id:`99999999-9999-4999-8999-${String(id).padStart(12,'0')}`,business_id:B,customer_id:C,title,status,completed_at,scheduled_start:null,assigned_user_ids:[U],customers:[{...customer,first_name:person.split(' ')[0],last_name:person.split(' ')[1]}],properties:property?[{id:`property-${id}`,label:property,address_line1:property==='Cedar Lane'?'1400 Cedar Lane':'22 Harbor View',city:'Chesapeake',state:'VA',postal_code:'23320'}]:[],active_appointment:null,invoice:null
})
const jobs=[
 job(1,'Kitchen renovation','lead','Taylor Morgan','Cedar Lane'),
 job(2,'HVAC replacement','lead','Jordan Lee',null),
 job(3,'Deck replacement','in_progress','Morgan Ellis','Harbor View'),
 job(4,'Fence installation','completed','Chris Nguyen','Harbor View','2024-11-10T15:00:00Z'),
]
async function screenshot(page,name){
 await page.evaluate(()=>document.fonts.ready)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await mkdir('tmp/jobs-directory-review',{recursive:true})
 await page.screenshot({path:`tmp/jobs-directory-review/${name}.png`})
}

test('Jobs phone mockup states render and preserve the directory handoffs',async({page})=>{
 await page.setViewportSize({width:390,height:844})
 await mock(page,{ai:true})
 await mockJobDirectory(page,()=>jobs)
 await page.goto('/?view=work')
 const cards=page.locator('.jobs-record-list>article')
 await expect(page.getByRole('combobox',{name:'Job view'})).toBeVisible()
 await expect(cards).toHaveCount(3)

 await page.getByRole('button',{name:'Open filters'}).click()
 await expect(page.locator('.unified-filters')).toBeVisible()
 await page.getByRole('group',{name:'Job layout',exact:true}).getByRole('button',{name:'Board'}).click()
 await expect(page.getByRole('region',{name:'Job Management Kanban',exact:true})).toBeVisible()
 await page.getByRole('group',{name:'Job layout',exact:true}).getByRole('button',{name:'List'}).click()
 await page.getByRole('combobox',{name:'Job view'}).selectOption('all')
 await page.getByRole('button',{name:'Close filters'}).click()
 await expect(cards).toHaveCount(4)
 await screenshot(page,'jobs-all-390')

 await page.getByRole('combobox',{name:'Job view'}).selectOption('unscheduled')
 await expect(cards).toHaveCount(2)
 await screenshot(page,'jobs-needs-scheduling-390')

 await page.getByRole('combobox',{name:'Job view'}).selectOption('in_progress')
 await expect(cards).toHaveCount(1)
 await expect(cards.first()).toContainText('Deck replacement')
 await screenshot(page,'jobs-in-progress-390')

 await page.getByRole('combobox',{name:'Job view'}).selectOption('completed')
 await expect(cards).toHaveCount(1)
 await expect(cards.first().getByRole('button',{name:/^Open job/})).toBeVisible()
 await screenshot(page,'jobs-completed-390')

 await page.getByRole('combobox',{name:'Job view'}).selectOption('active')
 await page.getByRole('button',{name:'Open filters'}).click()
 await page.getByRole('searchbox',{name:'Search jobs'}).fill('Morgan')
 await expect(cards).toHaveCount(2)
 await screenshot(page,'jobs-search-filter-390')

 await page.getByRole('button',{name:'＋ New job',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Create a job',exact:true})
 await expect(dialog.locator('.form-grid > label').first()).toContainText('Job title')
 expect((await dialog.boundingBox()).width).toBe(390)
 await screenshot(page,'jobs-new-job-390')
})
