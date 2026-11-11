import {test,expect} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {mock,B,U,J,customer} from './audit-fixture.mjs'
import {mkdir} from 'node:fs/promises'
import {managementPage} from './job-directory-fixture.mjs'

async function scan(page,selector){
  const result=await new AxeBuilder({page}).include(selector).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
  expect(result.violations.map(v=>({id:v.id,description:v.description,nodes:v.nodes.map(n=>n.target)}))).toEqual([])
}
async function home(page){
  const state=await mock(page,{ai:true})
  const jobs=[{id:J,title:'Prepare the work site',status:'in_progress',customer_id:customer.id,customers:[customer],properties:[],assigned_user_ids:[],active_appointment:null,invoice:null}]
  await page.route('**/rpc/get_job_management_page',route=>route.fulfill({json:managementPage(jobs,[],[{job_id:J,tasks_total:2,tasks_completed:0,due_tasks:1,materials_needed:0,pending_changes:0}],route.request().postDataJSON(),true,'America/New_York')}))
  return state
}
for(const width of [390,1440])test(`Home, chooser, customer and saved review accessibility at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});const state=await home(page);await page.goto('/?view=dashboard')
  const attention=page.getByRole('region',{name:'Work needs attention',exact:true})
  await expect(attention.getByText('Prepare the work site',{exact:true})).toBeVisible()
  await expect(attention.getByRole('link',{name:/Prepare the work site/})).toHaveAttribute('href',/section=tasks/)
  await scan(page,'.home-work-attention')
  await mkdir('tmp/ux-review',{recursive:true});await page.screenshot({path:`tmp/ux-review/home-${width}.png`,fullPage:true})
  await page.getByRole('button',{name:'Quick Links',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Create',exact:true})).toBeVisible()
  await expect(page.getByRole('heading',{name:'Go to / Share',exact:true})).toBeVisible()
  await scan(page,'.home-create-options')
  await page.getByRole('navigation',{name:'Create work and quick links'}).getByRole('link',{name:'+ New invoice',exact:true}).click()
  await page.getByRole('combobox',{name:'Customer',exact:true}).fill('Test')
  await page.getByRole('option').first().click()
  await scan(page,'.customer-entry')
  await page.getByPlaceholder('Description',{exact:true}).fill('Reviewed work')
  await page.getByPlaceholder('Unit price',{exact:true}).fill('100')
  await page.getByRole('button',{name:'Preview',exact:true}).click()
  await expect(page.getByText('Draft saved. Review the PDF before choosing a delivery option.',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Download PDF',exact:true})).toBeEnabled()
  await scan(page,'.creation-review-bar')
  expect(state.documents).toHaveLength(1)
  expect(state.calls.some(c=>/send-document|send-invoice/.test(c.path))).toBe(false)
})
test('mobile job groups retain all sections, completion safeguards and direct section links',async({page})=>{
  await page.setViewportSize({width:390,height:900})
  await page.goto('/tests/operations/preview.html?screen=jobs&scenario=mixed')
  await page.getByRole('searchbox').fill('Kitchen')
  await page.getByRole('button',{name:'Manage job',exact:true}).click()
  await expect(page.getByRole('group',{name:'Job workspace areas'})).toBeVisible()
  await scan(page,'.jm-section-groups')
  await mkdir('tmp/ux-review',{recursive:true});await page.screenshot({path:'tmp/ux-review/job-mobile.png',fullPage:true})
  for(const [group,sections] of [['Work',['Tasks','Schedule & Crew','Materials','Photos & Expenses']],['Billing',['Billing','Changes']],['Records',['Activity','Completion Report']],['Summary',['Overview']]]){
    await page.getByRole('group',{name:'Job workspace areas'}).getByRole('button',{name:group,exact:true}).click()
    for(const section of sections)await expect(page.getByRole('tab',{name:section,exact:true})).toBeVisible()
  }
  await expect(page.locator('.jm-next-action')).toContainText('Review materials')
  await page.getByRole('button',{name:'Review completion',exact:true}).click()
  await expect(page.getByRole('dialog',{name:'Complete job review'}).getByRole('button',{name:'Complete job',exact:true})).toBeDisabled()
  await page.getByRole('button',{name:'Keep working',exact:true}).click()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
test('settings grouping keeps existing section URLs and passes scoped accessibility checks',async({page})=>{
  await page.setViewportSize({width:390,height:900});await home(page);await page.goto('/?view=settings')
  await expect(page.getByRole('heading',{name:'Business & team',exact:true})).toBeVisible()
  await expect(page.getByRole('link',{name:/Team Management/})).toHaveAttribute('href','/?view=settings&section=team')
  await scan(page,'.more-navigation')
})
test('accessibility engine detects an intentionally broken isolated control',async({page})=>{
  await page.goto('/');await page.setContent('<main><button></button></main>')
  const result=await new AxeBuilder({page}).include('main').analyze()
  expect(result.violations.map(v=>v.id)).toContain('button-name')
})
test('workspace preference honors user/business key and explicit directory links',async({page})=>{
  await home(page);await page.goto('/?view=dashboard')
  await page.evaluate(({B,U})=>localStorage.setItem(`finviant-jobs-workspace:v1:${U}:${B}`,'management'),{B,U})
  await page.goto('/?view=work');await expect(page.getByRole('tab',{name:'Job Management',exact:true})).toHaveAttribute('aria-selected','true')
  await page.goto('/?view=work&workspace=jobs');await expect(page.getByRole('tab',{name:'Jobs',exact:true})).toHaveAttribute('aria-selected','true')
})
