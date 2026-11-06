import {test,expect} from '@playwright/test'
import {workflow,start,ask,review,save,docStep,item,reply} from './fin-workflow-fixture.mjs'
for(const width of [1440,390])for(const kind of ['estimate'])test(`Fin ${kind} reviews separate charges and saves once at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const f=await workflow(page,{steps:[docStep(kind,[item('Mowing',100),item('Edging',40)])]});await start(page,`Create ${kind} for Test Customer: mowing $100 and edging $40 total $140`)
 await expect(review(page)).toContainText('Mowing');await expect(review(page)).toContainText('Edging');await expect(review(page)).toContainText('Total: $140.00');expect(f.executions).toHaveLength(0)
 await review(page).getByRole('button',{name:'Yes, make these changes'}).dblclick();await expect(page.getByRole('region',{name:'Fin’s completed steps'})).toBeVisible();expect(f.executions).toHaveLength(1);expect(f.state.documents[0].payload.items.map(i=>i.unit_price)).toEqual(['100','40']);expect(f.executions[0].p_approved).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:`test-results/fin-saved-${kind}-${width}.png`,fullPage:true})
})
test('stated-total conflict asks for correction before offering a plan, retaining unit quantity on correction',async({page})=>{
 const f=await workflow(page,{respond:(_body,n)=>n===1?reply([],{answer:'The lines calculate to $105.00.',clarification:'Should I use $105.00 or change a line?'}):reply([docStep('estimate',[item('Shrubs',25,3),item('Planting',30)])])});await start(page,'Create estimate for Test Customer: 3 shrubs at $25 each and planting $30 total $150');await expect(review(page)).toHaveCount(0);expect(f.executions).toHaveLength(0);await ask(page,'Use the calculated total of $105.00');await expect(review(page)).toContainText('Total: $105.00');await expect(review(page).getByRole('cell',{name:'3',exact:true})).toBeVisible();expect(f.requests[1].thread_id).toBe(f.requests[0].thread_id)
})
for(const kind of ['estimate'])test(`missing customer ${kind} asks once and retains both prices in the follow-up plan`,async({page})=>{
 const f=await workflow(page,{respond:(_body,n)=>n===1?reply([],{clarification:'Which customer is this for?'}):reply([docStep(kind)])});await start(page,`Create ${kind}: landscaping $200 and painting $100`);await expect(review(page)).toHaveCount(0);await expect(page.getByText('Which customer is this for?',{exact:true})).toBeVisible();await ask(page,'Test Customer');await expect(review(page)).toContainText('Test Customer');await expect(review(page)).toContainText('Total: $300.00');await save(page);expect(f.state.documents[0].payload.items.map(i=>i.unit_price)).toEqual(['200','100']);expect(f.requests[1]).not.toHaveProperty('history')
})
test('an invoice with no named customer keeps both prices and lets the user pick a saved customer', async ({page}) => {
 const f = await workflow(page)
 await start(page, 'Create invoice: landscaping $200 and painting $100')
 const editor = page.getByRole('dialog', {name:'Create an invoice'})
 const customer = editor.getByRole('combobox', {name:'Customer', exact:true})
 await expect(customer).toHaveValue('')
 await expect(editor.getByLabel('Line 1 unit price', {exact:true})).toHaveValue('200')
 await expect(editor.getByLabel('Line 2 unit price', {exact:true})).toHaveValue('100')
 await customer.fill('Test')
 await editor.getByRole('option', {name:/Test Customer/}).click()
 await expect(customer).toHaveValue('Test Customer')
 await expect(editor).toContainText('$300.00')
 expect(f.state.documents).toHaveLength(0)
})
test('business answers show safe formatting and sources without executing a mutation',async({page})=>{
 const f=await workflow(page,{respond:()=>reply([],{answer:'Your services are **landscaping** and painting. <script>alert(1)</script>',sources:[{key:'profile',label:'Saved company profile'}],navigation:['settings','javascript:alert(1)']})});await start(page,'What services do I offer?');const answer=page.getByRole('region',{name:'Fin’s answer'});await expect(answer.locator('strong')).toHaveText('landscaping');await answer.getByText('Based on saved records').click();await expect(answer.getByText('Saved company profile',{exact:true})).toBeVisible();await expect(answer.locator('script')).toHaveCount(0);await expect(answer.getByRole('link')).toHaveCount(1);expect(f.executions).toHaveLength(0)
})
