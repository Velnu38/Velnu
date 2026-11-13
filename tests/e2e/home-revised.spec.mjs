import {test,expect} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {DateTime} from 'luxon'
import {mkdir} from 'node:fs/promises'
import {mock,B,U,C,E,J,customer} from './audit-fixture.mjs'
import {managementPage} from './job-directory-fixture.mjs'

const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-expose-headers':'content-range'}
async function fixture(page,{restricted=false,financeOnly=false,failure=false,paymentReview=false}={}){
 const state=await mock(page,{ai:true,owner:!restricted&&!financeOnly});state.networkPaths=[];page.on('request',request=>state.networkPaths.push(new URL(request.url()).pathname))
 const today=DateTime.now().setZone('America/New_York'),date=today.toISODate()
 const jobs=[{id:J,title:'Kitchen cabinet repair',status:'in_progress',customer_id:C,customers:[{...customer,first_name:'Taylor',last_name:'Morgan'}],properties:[],assigned_user_ids:[U],active_appointment:null,invoice:null},{id:'77777777-7777-4777-8777-777777777777',title:'Bathroom finish work',status:'scheduled',customer_id:C,customers:[{...customer,first_name:'Avery',last_name:'Ellis'}],properties:[],assigned_user_ids:[],active_appointment:null,invoice:null}]
 const reply=(r,json)=>r.fulfill({headers:{...headers,'content-range':Array.isArray(json)?`0-${Math.max(0,json.length-1)}/${json.length}`:'0-0/1'},json})
 await page.route('**/api/calendar?**',r=>reply(r,{events:[],issues:[],connections:0}))
 await page.route('**/rest/v1/business_members?**',r=>reply(r,{business_id:B,role:restricted?'technician':financeOnly?'office':'owner',access_modules:restricted?['calendar','jobs']:financeOnly?['finances']:['calendar','jobs','billing','finances'],businesses:{id:B,name:'Harbor Home Services',created_by_user_id:U,timezone:'America/New_York',profile_completed_at:'2026-01-01T00:00:00Z'}}))
 await page.route('**/rest/v1/calendar_work?**',r=>reply(r,jobs.map((j,i)=>({source_key:'job:'+j.id,title:j.title,job_id:j.id,starts_at:today.set({hour:i?14:9,minute:0,second:0}).toUTC().toISO(),ends_at:today.set({hour:i?15:11,minute:0,second:0}).toUTC().toISO(),status:'confirmed',document_kind:'work',document_id:j.id,assigned_user_ids:j.assigned_user_ids}))))
 await page.route('**/rest/v1/jobs?**',r=>reply(r,new URL(r.request().url()).searchParams.get('id')?.startsWith('eq.')?jobs[0]:jobs))
 await page.route('**/rest/v1/rpc/get_job_management_page',r=>reply(r,managementPage(jobs,[],[{job_id:J,tasks_total:1,tasks_completed:0,due_tasks:1,materials_needed:0,pending_changes:0},{job_id:jobs[1].id,tasks_total:0,tasks_completed:0,due_tasks:0,materials_needed:1,pending_changes:0}],r.request().postDataJSON(),!restricted,'America/New_York')))
 await page.route('**/rest/v1/rpc/get_dashboard_attention_page',r=>failure?r.fulfill({status:503,headers,json:{message:'Synthetic unavailable queue'}}):reply(r,{page:1,page_size:5,total:1,attention_count:1,approval_count:0,category_counts:{schedule:0,invoice:0,overdue:1,follow_up:0},items:[{kind:'invoice',data:{id:E,invoice_number:'INV-1042',due_date:'2026-01-01',balance_due:250,customers:[customer]}}]}))
 await page.route('**/rest/v1/rpc/get_financial_overview',r=>reply(r,{currency_supported:true,as_of:date,receivables:{invoices:2,outstanding:1200,overdue:250,overdue_count:1},aging:[],customers:[],oldest:[]}))
 await page.route('**/rest/v1/rpc/list_invoice_cash_activity**',r=>reply(r,[{id:'cash-1',invoice_id:E,amount:8250,occurred_at:today.toUTC().toISO(),direction:'income',currency:'USD',method:'cash',invoice_number:'INV-1040'}]))
 await page.route('**/rest/v1/bookkeeping_entries?**',r=>reply(r,[{id:'cost-1',entry_date:date,direction:'expense',amount:2100,currency:'USD',category:'Materials',description:'Synthetic materials',source_kind:'manual',record_photos:[]}]))
 await page.route('**/rest/v1/rpc/list_customer_payment_reviews**',r=>reply(r,paymentReview?[{id:'review-1',invoice_id:E,invoice_number:'INV-1042',amount:100,currency:'USD',reason:'manual_review',created_at:today.toISO()}]:[]))
 return state
}
for(const width of [320,390,430,1440])test(`revised Home matches approved cards and preserves their destinations at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:930});const state=await fixture(page);await page.goto('/?view=dashboard')
 const calendar=page.getByRole('region',{name:'Work calendar',exact:true}),attention=page.getByRole('region',{name:'Needs attention overview',exact:true}),finance=page.getByRole('region',{name:'Financial Performance',exact:true})
 await expect(calendar.getByRole('heading',{name:'Today',exact:true})).toBeVisible();await expect(calendar.getByText('Taylor Morgan',{exact:true})).toBeVisible();await expect(calendar.getByText('Avery Ellis',{exact:true})).toBeVisible()
 await expect(attention.getByRole('button',{name:/Invoice review/})).toBeVisible();await expect(attention.getByRole('button',{name:/Work blockers/})).toBeVisible();await expect(attention.locator('.home-count')).toHaveText('3')
 await expect(finance.locator('.home-period-label')).toContainText('USD');await expect(finance.getByText('$8,250.00',{exact:true})).toBeVisible();await expect(finance.getByText('$2,100.00',{exact:true})).toBeVisible();await expect(finance.getByText('$6,150.00',{exact:true})).toBeVisible();await expect(finance).toContainText('Outstanding $1,200.00 · $250.00 overdue')
 await expect(page.getByRole('button',{name:'Quick Links',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'+ New',exact:true})).toHaveCount(0);await expect(calendar.getByRole('button',{name:'Month',exact:true})).toHaveCount(0)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 for(const amount of await finance.locator('.home-financial-values dd').all())expect((await amount.boundingBox()).height).toBeLessThan(30)
 await mkdir('tmp/home-revised',{recursive:true});await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:`tmp/home-revised/home-${width}.png`,fullPage:true})
 const a11y=await new AxeBuilder({page}).include('.home-revised').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(a11y.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([])
 await calendar.getByRole('button',{name:'Calendar',exact:true}).click();await expect(calendar.getByRole('heading',{name:'Weekly Schedule',exact:true})).toBeFocused();await expect(calendar.getByRole('button',{name:'Month',exact:true})).toBeVisible();await calendar.getByRole('button',{name:'Next week',exact:true}).click();await page.getByRole('button',{name:'‹ Back to Today',exact:true}).click();await expect(calendar.getByRole('button',{name:'Calendar',exact:true})).toBeFocused();await expect(calendar.getByText('Taylor Morgan',{exact:true})).toBeVisible()
 await finance.getByRole('button',{name:'View finances',exact:true}).click();await expect(finance.getByRole('heading',{name:'Financial Performance',exact:true})).toBeFocused();await expect(finance.getByRole('button',{name:'Add transaction',exact:true})).toBeVisible();await page.getByRole('button',{name:'‹ Back to overview',exact:true}).click();await expect(finance.getByRole('button',{name:'View finances',exact:true})).toBeFocused()
 await attention.getByRole('button',{name:/Invoice review/}).click();await expect(page.getByRole('group',{name:'Home work queue'})).toBeVisible();await page.getByRole('button',{name:'‹ Back to Needs Attention',exact:true}).click();await expect(page.getByRole('button',{name:/Invoice review/})).toBeFocused()
 await page.getByRole('button',{name:/Work blockers/}).click();await expect(page.getByRole('region',{name:'Work needs attention',exact:true}).getByRole('link',{name:/Kitchen cabinet repair/})).toHaveAttribute('href',/section=tasks/)
 expect(state.networkPaths.filter(path=>path.endsWith('/rpc/get_financial_overview'))).toHaveLength(1)
 expect(state.calls.some(c=>/send-|create_document|set_job_status|work-scheduling/.test(c.path))).toBe(false)
})
test('revised Home preserves permissions and does not read financial queues for a worker',async({page})=>{
 const state=await fixture(page,{restricted:true});await page.goto('/?view=dashboard');await expect(page.getByRole('heading',{name:'Today',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/Work blockers/})).toBeVisible();await expect(page.getByRole('button',{name:/Invoice review/})).toHaveCount(0);await expect(page.getByRole('region',{name:'Financial Performance',exact:true})).toHaveCount(0)
 expect(state.networkPaths.some(path=>/get_dashboard_attention_page|get_financial_overview|list_customer_payment_reviews|list_invoice_cash_activity/.test(path))).toBe(false)
})
test('unavailable billing counts never appear as all clear and expose a retry',async({page})=>{
 await fixture(page,{failure:true});await page.goto('/?view=dashboard');const card=page.getByRole('region',{name:'Needs attention overview',exact:true});await expect(card.getByRole('alert')).toContainText('Billing review is unavailable');await expect(card.locator('.home-count')).toHaveText('—');await expect(card.getByRole('button',{name:'Retry reviews',exact:true})).toBeVisible()
})
test('payment reconciliation stays visible and opens the original review queue',async({page})=>{
 await fixture(page,{paymentReview:true});await page.goto('/?view=dashboard');const card=page.getByRole('region',{name:'Needs attention overview',exact:true});await expect(card.locator('.home-count')).toHaveText('!');await card.getByRole('button',{name:/Invoice review.*Payment review required/}).click();await expect(page.getByRole('region',{name:'Payments to review',exact:true}).getByRole('link',{name:'Review invoice',exact:true})).toHaveAttribute('href',new RegExp('document='+E))
})

test('Today opens the original job details without changing its status',async({page})=>{
 const state=await fixture(page);await page.goto('/?view=dashboard');await page.getByRole('region',{name:'Work calendar',exact:true}).getByRole('link',{name:/Kitchen cabinet repair/}).click();await expect(page.getByRole('dialog',{name:'Job details',exact:true})).toBeVisible();expect(state.networkPaths.some(path=>/set_job_status|work-scheduling/.test(path))).toBe(false)
})

test('finance-only access keeps cash summaries without reading billing or job queues',async({page})=>{
 const state=await fixture(page,{financeOnly:true});await page.goto('/?view=dashboard');await expect(page.getByRole('region',{name:'Financial Performance',exact:true})).toContainText('$6,150.00');await expect(page.getByRole('button',{name:/Invoice review/})).toHaveCount(0);await expect(page.getByRole('button',{name:/Work blockers/})).toHaveCount(0);expect(state.networkPaths.some(path=>/get_dashboard_attention_page|get_job_management_page/.test(path))).toBe(false)
})
