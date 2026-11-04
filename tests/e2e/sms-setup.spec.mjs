import {test,expect} from '@playwright/test'
import {mock,B,U} from './audit-fixture.mjs'
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PUT,OPTIONS'}
for(const width of [1440,390])test(`owner verifies mobile only at SMS setup, with server confirmation at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});await mock(page);await page.route('https://example.supabase.co/auth/v1/settings',route=>route.fulfill({status:200,contentType:'application/json',headers,body:JSON.stringify({external:{phone:true}})}));let verified=false,requests=0,checks=0;let requestedPhone=''
 await page.route('https://example.supabase.co/rest/v1/rpc/get_sms_setup_status',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers,body:''})
  expect(route.request().postDataJSON().p_business).toBe(B);return route.fulfill({status:200,contentType:'application/json',headers,body:JSON.stringify({owner_mobile_verified:verified,phone_last4:verified?'0123':null,customer_sms_enabled:false})})
 })
 await page.route('https://example.supabase.co/auth/v1/user',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers,body:''})
  const user={id:U,email:'owner@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}
  if(route.request().method()==='PUT'){requests++;requestedPhone=route.request().postDataJSON().phone;expect(requestedPhone).toBe('+17575550123')}
  return route.fulfill({status:200,contentType:'application/json',headers,body:JSON.stringify(user)})
 })
 await page.route('https://example.supabase.co/auth/v1/verify',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers,body:''})
  checks++;const b=route.request().postDataJSON();expect(b.phone).toBe(requestedPhone);expect(b.type).toBe('phone_change')
  if(b.token!=='123456')return route.fulfill({status:403,contentType:'application/json',headers,body:JSON.stringify({code:'otp_expired',msg:'Token has expired or is invalid'})})
  verified=true;return route.fulfill({status:200,contentType:'application/json',headers,body:JSON.stringify({access_token:Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:U,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test',refresh_token:'test',expires_in:3600,token_type:'bearer',user:{id:U,email:'owner@example.test',phone:'17575550123',phone_confirmed_at:new Date().toISOString(),aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}})})
 })
 await page.goto('/?view=settings&sms_setup=1');const setup=page.getByRole('region',{name:'Owner mobile verification',exact:true});await expect(setup.getByText(/SMS sending is locked/)).toBeVisible()
 const phone=setup.getByRole('textbox',{name:'Owner mobile number',exact:true}),send=setup.getByRole('button',{name:'Send verification code',exact:true});await expect(send).toBeDisabled();await phone.fill('123');await expect(send).toBeDisabled();await phone.fill('(757) 555-0123');await send.dblclick();await expect.poll(()=>requests).toBe(1)
 await expect(setup.getByRole('textbox',{name:'Verification code',exact:true})).toBeVisible();await expect(setup.getByRole('button',{name:/Wait \d+s/})).toBeDisabled();await setup.getByRole('textbox',{name:'Verification code',exact:true}).fill('000000');await setup.getByRole('button',{name:'Verify mobile number',exact:true}).click();await expect(setup.getByRole('alert')).toContainText('invalid or expired');await expect(setup.getByText(/SMS sending is locked/)).toBeVisible()
 await setup.getByRole('textbox',{name:'Verification code',exact:true}).fill('123456');await setup.getByRole('button',{name:'Verify mobile number',exact:true}).click();await expect(setup.getByText('Owner mobile verified · ending 0123',{exact:true})).toBeVisible();expect(checks).toBe(2);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
test('SMS provider setup errors preserve email signup and never pretend a number was verified',async({page})=>{
 await mock(page);await page.route('https://example.supabase.co/auth/v1/settings',route=>route.fulfill({status:200,contentType:'application/json',headers,body:JSON.stringify({external:{phone:true}})}));await page.route('https://example.supabase.co/rest/v1/rpc/get_sms_setup_status',async route=>route.fulfill({status:200,contentType:'application/json',headers,body:JSON.stringify({owner_mobile_verified:false,phone_last4:null,customer_sms_enabled:false})}))
 await page.route('https://example.supabase.co/auth/v1/user',async route=>{if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});if(route.request().method()!=='PUT')return route.fallback();return route.fulfill({status:400,contentType:'application/json',headers,body:JSON.stringify({msg:'Phone provider is disabled',code:'phone_provider_disabled'})})})
 await page.goto('/?view=settings&sms_setup=1');const setup=page.getByRole('region',{name:'Owner mobile verification',exact:true});await setup.getByRole('textbox',{name:'Owner mobile number',exact:true}).fill('+17575550123');await setup.getByRole('button',{name:'Send verification code',exact:true}).click();await expect(setup.getByRole('alert')).toContainText('awaiting SMS provider setup');await expect(setup.getByRole('textbox',{name:'Owner mobile number',exact:true})).toHaveValue('+17575550123');await expect(setup.getByRole('textbox',{name:'Verification code',exact:true})).toHaveCount(0)
})

test('unconfigured phone authentication disables code requests before any verification text',async({page})=>{
 await mock(page);let requested=false;await page.route('https://example.supabase.co/auth/v1/settings',route=>route.fulfill({status:200,contentType:'application/json',headers,body:JSON.stringify({external:{phone:false}})}));await page.route('https://example.supabase.co/rest/v1/rpc/get_sms_setup_status',route=>route.fulfill({status:200,contentType:'application/json',headers,body:JSON.stringify({owner_mobile_verified:false,phone_last4:null,customer_sms_enabled:false})}));await page.route('https://example.supabase.co/auth/v1/user',async route=>{if(route.request().method()==='PUT')requested=true;return route.fallback()})
 await page.goto('/?view=settings&sms_setup=1');const setup=page.getByRole('region',{name:'Owner mobile verification',exact:true});await setup.getByRole('textbox',{name:'Owner mobile number',exact:true}).fill('+17575550123');await expect(setup.getByRole('button',{name:'Send verification code',exact:true})).toBeDisabled();await expect(setup.getByText(/awaiting SMS provider setup/)).toBeVisible();expect(requested).toBe(false)
})
