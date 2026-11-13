import {openHomePanels} from './navigation.mjs'
import {test,expect} from '@playwright/test'
import {mock,business,B} from './audit-fixture.mjs'

// Synthetic fixture checks: no live account, model, or customer delivery is used.
for (const width of [320,390,1440]) test(`Home keeps financial drill-down, calendar and navigation at ${width}px`, async({page})=>{
 await page.setViewportSize({width,height:900})
 const state=await mock(page,{ai:true})
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('/?view=dashboard')
 await expect(page.getByRole('heading',{name:business.name,exact:true})).toBeVisible()
 const finance=page.getByRole('region',{name:'Financial Performance',exact:true}),calendar=page.getByRole('region',{name:'Work calendar',exact:true})
 await expect(finance).toBeVisible();await expect(calendar).toBeVisible();await openHomePanels(page,['calendar','finances'])
 expect(await finance.evaluate(el=>!!(el.compareDocumentPosition(document.querySelector('.dashboard-calendar'))&Node.DOCUMENT_POSITION_PRECEDING))).toBe(true)
 for(const months of [1,3,6,12]){
  await finance.getByRole('button',{name:`${months} ${months===1?'month':'months'}`,exact:true}).click()
  await expect(finance.locator('.performance-metric.income')).toBeEnabled()
 }
 await finance.locator('.performance-metric.income').click()
 await expect(finance.getByRole('region',{name:'Income transactions',exact:true})).toBeVisible()
 await finance.getByRole('button',{name:'Close transaction details'}).click()
 await finance.locator('.home-financial-trend>summary').click()
 await expect(finance.getByRole('group',{name:/Income and expense chart/})).toBeVisible()
 await calendar.getByRole('button',{name:'Month',exact:true}).click()
 await expect(calendar.getByRole('heading',{name:'Monthly calendar'})).toBeVisible()
 await calendar.getByRole('button',{name:'Week',exact:true}).click()
 await expect(page.locator('.fin-launcher').getByRole('button',{name:'Ask Fin',exact:true})).toBeVisible()
 if(width<901){
  const dock=page.getByRole('navigation',{name:'Workspace navigation',exact:true})
  await expect(dock.getByRole('button')).toHaveCount(5)
  for(const label of ['Home','Invoices','Estimates','Jobs','More'])await expect(dock.getByRole('button',{name:label,exact:true})).toBeVisible()
  await dock.getByRole('button',{name:'More',exact:true}).click()
  const more=page.getByRole('dialog',{name:'More navigation'})
  for(const label of ['Customers','Schedule','Help & Support','Company Profile','Team Management','Email & Text Setup','Invoice & Estimate Setup','Calendar Connections'])await expect(more.getByRole('link',{name:new RegExp('^'+label)})).toBeVisible()
  await more.getByRole('button',{name:'Close',exact:true}).click()
 }else{
  for(const label of ['Home','Invoices','Estimates','Jobs','More'])await expect(page.locator('.sidebar').getByRole('button',{name:label,exact:true})).toBeVisible()
 }
 await expect(page.locator('.fin-brand:visible img').first()).toHaveAttribute('src','/finviant-mark.svg')
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 expect(state.calls.some(c=>c.path.includes('/functions/v1/send-'))).toBe(false)
 expect(errors).toEqual([])
 await page.getByRole('button',{name:'‹ Back to Today',exact:true}).click();await page.getByRole('button',{name:'‹ Back to overview',exact:true}).click();await page.screenshot({path:`test-results/home-screen-${width}.png`,fullPage:true})
})
for(const kind of ['invoice','estimate','job','reminder'])test(`Home creation chooser opens the existing ${kind} editor`,async({page})=>{
 await mock(page);await page.goto('/?view=dashboard')
 const origin=await page.evaluate(()=>performance.timeOrigin)
 await page.getByRole('button',{name:'Quick Links',exact:true}).click()
 const chooser=page.getByRole('dialog',{name:'Quick Links',exact:true})
 await chooser.getByRole('link',{name:'+ New '+kind,exact:true}).click()
 await expect(chooser).toHaveCount(0)
 if(kind==='reminder')await expect(page.getByRole('heading',{name:'Create a reminder',exact:true})).toBeVisible()
 else {
  await expect(page.getByRole('dialog')).toBeVisible()
  if(kind!=='job'){
   const dialog=page.getByRole('dialog',{name:'Create an '+kind,exact:true})
   await expect(dialog.getByRole('combobox',{name:'Customer',exact:true})).toBeVisible()
  }
 }
 expect(await page.evaluate(()=>performance.timeOrigin)).toBe(origin)
})
for(const width of [320,390,1440])test(`Home Quick Links opens the existing Customers directory at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900})
 await mock(page)
 await page.goto('/?view=dashboard')
 const trigger=page.getByRole('button',{name:'Quick Links',exact:true})
 await expect(trigger).toHaveText('Quick Links')
 await expect(trigger.locator('.home-create-label')).toHaveCount(0)
 const subtitle=trigger.getByText('Quick Links',{exact:true})
 await expect(subtitle).toBeVisible()
 const centering=await trigger.evaluate(el=>({textAlign:getComputedStyle(el).textAlign,justify:getComputedStyle(el).justifyContent}))
 expect(centering).toEqual({textAlign:'center',justify:'center'})
 const timeOrigin=await page.evaluate(()=>performance.timeOrigin)
 await subtitle.click()
 const chooser=page.getByRole('dialog',{name:'Quick Links',exact:true})
 await expect(chooser.getByRole('link',{name:'+ New invoice',exact:true})).toBeVisible()
 await expect(chooser.getByRole('link',{name:'+ New estimate',exact:true})).toBeVisible()
 await chooser.getByRole('link',{name:'Customers',exact:true}).click()
 await expect(page.getByRole('region',{name:'Customer directory',exact:true})).toBeVisible()
 await expect(chooser).toHaveCount(0)
 expect(await page.evaluate(()=>performance.timeOrigin)).toBe(timeOrigin)
})
test('Home keeps calendar creation on the calendar and removes it from Quick Links',async({page})=>{
 await mock(page);await page.goto('/?view=dashboard')
 const trigger=page.getByRole('button',{name:'Quick Links',exact:true})
 await trigger.click();await page.keyboard.press('Escape');await expect(trigger).toBeFocused()
 await trigger.click();const chooser=page.getByRole('dialog',{name:'Quick Links',exact:true});await expect(chooser.getByRole('button',{name:'+ New calendar entry',exact:true})).toHaveCount(0);await expect(chooser.getByRole('link',{name:'Team Management',exact:true})).toHaveAttribute('href','/?view=settings&section=team');await chooser.getByRole('button',{name:'Close',exact:true}).click();await openHomePanels(page,['calendar']);await page.getByRole('button',{name:'Add to calendar',exact:true}).click()
 await expect(page.getByRole('dialog',{name:'Add to your calendar',exact:true})).toBeVisible()
})
for(const role of ['technician','viewer'])test(`Home preserves ${role} module and creation restrictions`,async({page})=>{
 await page.setViewportSize({width:390,height:900});const state=await mock(page,{owner:false})
 await page.route('**/rest/v1/business_members?**',route=>route.fulfill({contentType:'application/json',json:{business_id:B,role,access_modules:['calendar','jobs'],businesses:business}}))
 await page.goto('/?view=dashboard')
 await expect(page.getByRole('region',{name:'Work calendar',exact:true})).toBeVisible()
 await expect(page.getByRole('region',{name:'Financial Performance',exact:true})).toHaveCount(0)
 const dock=page.getByRole('navigation',{name:'Workspace navigation'})
 await expect(dock.getByRole('button',{name:'Invoices',exact:true})).toHaveCount(0)
 await expect(dock.getByRole('button',{name:'Estimates',exact:true})).toHaveCount(0)
 if(role==='viewer')await expect(page.getByRole('button',{name:'Quick Links',exact:true})).toHaveCount(0)
 else {
  await page.getByRole('button',{name:'Quick Links',exact:true}).click()
  const chooser=page.getByRole('dialog',{name:'Quick Links',exact:true})
  await expect(chooser.getByRole('link',{name:'+ New invoice',exact:true})).toHaveCount(0)
  await expect(chooser.getByRole('link',{name:'+ New job',exact:true})).toBeVisible()
 }
 expect(state.calls.some(c=>c.path.endsWith('/payments')||c.path.endsWith('/bookkeeping_entries'))).toBe(false)
})

for(const kind of ['invoice','estimate'])test(`The ${kind} list opens its existing editor directly`,async({page})=>{
 await mock(page);await page.goto('/?view='+kind+'s')
 await page.getByRole('button',{name:'Create '+kind,exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Create an '+kind,exact:true})
 await expect(dialog.getByRole('combobox',{name:'Customer',exact:true})).toBeVisible()
})
