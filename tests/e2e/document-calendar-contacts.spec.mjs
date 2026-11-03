import {test,expect} from '@playwright/test'
import {DateTime} from 'luxon'
import {mock,B,U,C,E,P,J,zone} from './fixtures/document-workspace.mjs'

for(const width of [1440,390])test(`navigation returns to the previous workspace page at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await mock(page);await page.goto('/')
 await page.getByRole('button',{name:'Customers',exact:true}).click();await expect(page.getByRole('heading',{name:'Everyone you work for, in one place.'})).toBeVisible()
 await page.getByRole('button',{name:'← Back',exact:true}).click();await expect(page.getByRole('region',{name:'Guided next steps'})).toBeVisible()
 if(width===390){await page.getByRole('button',{name:'More',exact:true}).click();await expect(page.getByRole('button',{name:'Change Orders',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Settings',exact:true}).click()}else await page.getByRole('button',{name:'Settings',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Payment options',exact:true})).toHaveCount(0)
 await page.goBack();await expect(page.getByRole('region',{name:'Guided next steps'})).toBeVisible()
})
for(const kind of ['invoice','estimate'])for(const width of [1440,390])test(`typed customer and ${kind} payment choices stay together at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const state=await mock(page);await page.goto('/?view='+kind+'s');await page.getByRole('button',{name:'+ New '+kind,exact:true}).click()
 await page.getByLabel('Customer name',{exact:true}).fill('New Typed Customer')
 await page.getByPlaceholder('Description',{exact:true}).fill('Only this work');await page.getByPlaceholder('Unit price',{exact:true}).fill('250')
 await page.getByText('How customers can pay',{exact:true}).click();await page.getByRole('checkbox',{name:'Stripe',exact:true}).check();await page.getByLabel('Stripe payment link',{exact:true}).fill('https://buy.stripe.com/owner-link');await page.getByLabel('Payment instructions',{exact:true}).fill('Use your invoice number')
 await page.getByRole('button',{name:'Create '+kind,exact:true}).click();await expect.poll(()=>state.documents.length).toBe(1)
 const input=state.documents[0].payload;expect(input.new_customer.first_name).toBe('New');expect(input.new_customer.last_name).toBe('Typed Customer');expect(input.payment_links).toEqual([{provider:'stripe',url:'https://buy.stripe.com/owner-link'}]);expect(input.items[0].description).toBe('Only this work')
 expect(state.calls.filter(c=>c.path.endsWith('/customers')&&c.method==='POST')).toHaveLength(0)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
for(const kind of ['invoice','estimate'])test(`${kind} change order automatically uses the original document without selecting a job`,async({page})=>{
 const state=await mock(page);await page.goto('/?view='+kind+'s')
 if(kind==='invoice')await page.locator('.invoice-open').first().click();else await page.getByRole('button',{name:/Preview/}).first().click()
 await page.getByRole('button',{name:'Change order',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Create change order'});await expect(dialog.getByRole('region',{name:'Original document'})).toContainText('Test Customer');await expect(dialog.getByRole('region',{name:'Original document'})).toContainText('1 Test Street');await expect(dialog.getByLabel('Job',{exact:true})).toHaveCount(0)
 await dialog.getByPlaceholder('Description',{exact:true}).fill('Additional work only');await dialog.getByPlaceholder('Unit price',{exact:true}).fill('20')
 await dialog.getByRole('button',{name:'Create change order',exact:true}).click();await expect.poll(()=>state.changes.length).toBe(1)
 expect(state.changes[0].p_kind).toBe(kind);expect(state.changes[0].p_document).toBe(E);expect(state.changes[0].p_input.items[0].description).toBe('Additional work only');expect(state.changes[0].p_input).not.toHaveProperty('customer_id')
})
test('completed work has no new change-order action',async({page})=>{
 await mock(page,{completedWork:true});await page.goto('/?view=invoices');await page.locator('.invoice-open').first().click();await expect(page.getByRole('heading',{name:'INV-QA',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Checking change order…',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Change order',exact:true})).toHaveCount(0)
})
for(const width of [1440,390])test(`click a calendar date and save a manual event at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const state=await mock(page);await page.goto('/');const calendar=page.getByRole('region',{name:'Work calendar'});await expect(calendar.getByLabel('Calendar date')).toHaveCount(0)
 const date=calendar.getByRole('group',{name:'Choose a day in the week'}).getByRole('button').first();await date.click();const dialog=page.getByRole('dialog',{name:'Add to your calendar'});await expect(dialog).toBeVisible();await dialog.getByLabel('Title',{exact:true}).fill('Pick up materials');await dialog.getByLabel('Details',{exact:true}).fill('Collect the order before the job');await expect(dialog.getByRole('button',{name:'Use OpenAI assistant'})).toBeDisabled()
 await dialog.getByRole('button',{name:'Add event',exact:true}).click();await expect.poll(()=>state.entries.length).toBe(1);expect(state.entries[0].notes).toBe('Collect the order before the job');expect(state.entries[0].assigned_user_id).toBe(U);await expect(dialog).toHaveCount(0)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
test('activated calendar AI opens the existing assistant with the selected date for review',async({page})=>{
 await mock(page,{ai:true});await page.goto('/');await page.getByRole('button',{name:'+ Add entry',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Add to your calendar'});await dialog.getByLabel('Title',{exact:true}).fill('Mow the lawn');await dialog.getByRole('button',{name:'Use OpenAI assistant',exact:true}).click()
 await expect(page.locator('.assistant-panel')).toBeVisible();await expect(page.locator('.assistant-panel textarea')).toHaveValue(/Schedule a job on \d{4}-\d{2}-\d{2} in America\/New_York.*Mow the lawn/)
})
for(const width of [1440,390])test(`owner reviews phone contact cards before importing at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const state=await mock(page);await page.goto('/?view=customers');await page.getByRole('button',{name:'Import contacts',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Import phone contacts'});const card=(name,email)=>'BEGIN:VCARD\nVERSION:3.0\nFN:'+name+'\nEMAIL:'+email+'\nEND:VCARD\n'
 await dialog.getByLabel('Contacts file (.vcf)',{exact:true}).setInputFiles({name:'owner-contacts.vcf',mimeType:'text/vcard',buffer:Buffer.from(card('Business Customer','business@example.test')+card('Personal Contact','personal@example.test'))})
 await dialog.getByRole('checkbox',{name:/Personal Contact/}).uncheck();expect(state.imported).toHaveLength(0);await dialog.getByRole('button',{name:'Import selected contacts',exact:true}).click();await expect(dialog.getByRole('status').filter({hasText:'Import complete'})).toBeVisible();expect(state.imported).toHaveLength(1);expect(state.imported[0].email).toBe('business@example.test')
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
})
test('non-owner cannot see bulk phone contact import',async({page})=>{await mock(page,{owner:false});await page.goto('/?view=customers');await expect(page.getByRole('button',{name:'Import contacts',exact:true})).toHaveCount(0)})
