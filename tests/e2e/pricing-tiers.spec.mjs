import {test,expect} from '@playwright/test'
import {mock,B,C,E} from './audit-fixture.mjs'
async function setup(page,{tier='pro',canTest=true,ready=false}={}){
 await mock(page,{ai:true});const state={tier,testing:false,saves:[],sent:[],shares:0}
 const usage=()=>({plan:state.tier,actual_plan:'pro',testing:state.testing,can_test:canTest,introductory:state.tier==='free',period_end:'2026-12-01',customers_used:1,customers_limit:state.tier==='free'?10:null,jobs_used:0,jobs_limit:state.tier==='free'?5:null,seats_used:1,seats_limit:state.tier==='pro'?5:1,ai_used:0,ai_limit:state.tier==='free'?20:state.tier==='basic'?150:600,voice_used:0,voice_limit:state.tier==='free'?10:state.tier==='basic'?60:180,email_used:0,email_limit:state.tier==='pro'?2000:0,sms_used:0,sms_limit:state.tier==='pro'?200:0})
 const delivery=()=>({plan:state.tier,email:'owner@example.test',phone:'+17575550100',personal_email_ready:ready,personal_sms_ready:ready,managed_email_ready:false,managed_sms_ready:false,acknowledged:ready,reply_to:null,sms_reply_route:null})
 const snap={kind:'invoice',number:'INV-QA',status:'draft',issue_date:'2026-11-06',total:105,subtotal:100,tax_amount:5,amount_paid:0,balance_due:105,company:{name:'Scheduling QA',email:'owner@example.test'},customer:{name:'Test Customer',email:'customer@example.test',phone:'+17575550123'},items:[{description:'Original work',quantity:2,unit_price:50,line_total:100}],payment_links:[],finviant_branding:state.tier==='free'}
 await page.route('https://example.supabase.co/rest/v1/rpc/**',async route=>{const path=new URL(route.request().url()).pathname.split('/').pop(),body=route.request().postDataJSON(),reply=x=>route.fulfill({contentType:'application/json',body:JSON.stringify(x)})
 if(path==='get_plan_usage')return reply(usage())
 if(path==='set_tier_test'){state.tier=body.p_tier||'pro';state.testing=!!body.p_tier;return reply(usage())}
 if(path==='get_delivery_setup')return reply(delivery())
 if(path==='save_delivery_setup'){state.saves.push(body);ready=true;return reply(delivery())}
 if(path==='get_delivery_automation')return reply({plan:state.tier,ready:false,rule:{enabled:false,after_days:3,repeat_days:7,max_reminders:3},tasks:[]})
 if(path==='get_storage_usage')return reply({used_bytes:0,limit_bytes:state.tier==='free'?100000000:state.tier==='basic'?2000000000:10000000000,pending_bytes:0,warning:'none'})
 if(path==='prepare_personal_document'){state.shares++;return reply({snapshot:snap,expires_at:'2026-12-06'})}
 if(path==='confirm_personal_document_sent'){state.sent.push(body);return reply(null)}
 if(path==='get_shared_document')return reply({...snap,expires_at:'2026-12-06'})
 return route.fallback()
 });return state
}
test('owner tests all three plans and restores access without resetting records',async({page})=>{
 const s=await setup(page);await page.goto('/?view=settings&section=plans');await expect(page.getByRole('heading',{name:'Plans & Usage'})).toBeVisible();await expect(page.getByText('$19.95',{exact:false})).toBeVisible();await page.getByRole('button',{name:'Test Free',exact:true}).click();await expect(page.getByRole('button',{name:'Testing Free',exact:true})).toBeDisabled();expect(s.tier).toBe('free');await page.getByRole('button',{name:'Test Individual',exact:true}).click();expect(s.tier).toBe('basic');await page.getByRole('button',{name:'Test Business Pro',exact:true}).click();expect(s.tier).toBe('pro');await page.getByRole('button',{name:'Restore Business Pro access'}).click();expect(s.testing).toBe(false)
})
test('ordinary owners see comparison but cannot grant a test entitlement',async({page})=>{await setup(page,{canTest:false});await page.goto('/?view=settings&section=plans');await expect(page.getByRole('heading',{name:'Plans & Usage'})).toBeVisible();await expect(page.getByRole('button',{name:/^Test (Free|Individual|Business Pro)$/})).toHaveCount(0)})
test('personal app setup requires acknowledgement and enables explicit final-send workflow',async({page})=>{
 const s=await setup(page,{tier:'free'});await page.goto('/?view=settings&section=delivery');await expect(page.getByRole('button',{name:'Save sending setup',exact:true})).toBeDisabled();await page.getByLabel('My email app is configured', {exact:false}).check();await page.getByLabel('My messaging app and mobile service', {exact:false}).check();await page.getByLabel('I understand personal-app messages', {exact:false}).check();await page.getByRole('button',{name:'Save sending setup',exact:true}).click();await expect.poll(()=>s.saves.length).toBe(1)
 await page.goto('/?view=invoices&document='+E);const email=page.getByRole('link',{name:'Send Email',exact:true});await expect(email).toHaveAttribute('href',/^mailto:customer@example.test\?subject=/);await expect(page.getByRole('link',{name:'Send Text',exact:true})).toHaveAttribute('href',/^sms:/);expect(s.sent).toHaveLength(0)
 await page.evaluate(()=>document.addEventListener('click',event=>{if(event.target.closest('a[href^="mailto:"]'))event.preventDefault()}));await email.click();expect(s.sent).toHaveLength(0);await page.getByRole('button',{name:'I sent it — mark sent',exact:true}).click();await expect.poll(()=>s.sent.length).toBe(1);expect(s.sent[0].p_channel).toBe('email')
})
test('Business Pro exposes activation requirements, safe fallback and disabled automation',async({page})=>{
 await setup(page);await page.goto('/?view=settings&section=delivery');await expect(page.getByText('Pending verified sender activation',{exact:false})).toBeVisible();await expect(page.getByLabel('Enable overdue invoice email reminders')).toBeDisabled();await page.goto('/?view=invoices&document='+E);await expect(page.getByRole('button',{name:'Send Email',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Send Text',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Use my email or text app instead'}).click();await expect(page.getByRole('button',{name:'Copy Link',exact:true})).toBeEnabled()
})
test('mobile plan comparison stays inside the viewport',async({page})=>{await page.setViewportSize({width:390,height:844});await setup(page);await page.goto('/?view=settings&section=plans');await expect(page.getByRole('heading',{name:'Plans & Usage'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/tier-mobile.png',fullPage:true})})
