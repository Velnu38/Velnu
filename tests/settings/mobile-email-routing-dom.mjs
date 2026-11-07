import {JSDOM,VirtualConsole} from 'jsdom'
import {createServer} from 'vite'
import assert from 'node:assert/strict'

process.env.VITE_SUPABASE_URL='https://test.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test-key'
process.env.VITE_ENABLE_CUSTOMER_ACTIONS='false'
process.env.VITE_ENABLE_PRIVATE_BETA_EMAIL='true'
const consoleOutput=new VirtualConsole()
let nativeNavigations=0
consoleOutput.on('jsdomError',error=>{
  if(/Not implemented: navigation/.test(error.message))nativeNavigations++
  else console.error(error)
})
const dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:'https://finviant.test/?view=invoices',pretendToBeVisual:true,virtualConsole:consoleOutput})
for(const key of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','HTMLTextAreaElement','Element','Node','Event','CustomEvent','MouseEvent','MutationObserver','HTMLDialogElement','history','location','localStorage','sessionStorage'])globalThis[key]=key==='window'?dom.window:dom.window[key]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
Object.defineProperty(window,'innerWidth',{value:390,configurable:true})
Object.defineProperty(window,'innerHeight',{value:844,configurable:true})
HTMLDialogElement.prototype.showModal=function(){this.open=true}
HTMLDialogElement.prototype.close=function(){this.open=false}
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const React=await import('react')
const {createRoot}=await import('react-dom/client')
const {act}=React
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}})
const root=createRoot(document.getElementById('root'))
const tick=()=>act(()=>new Promise(resolve=>setTimeout(resolve,40)))
const button=name=>[...document.querySelectorAll('button')].find(el=>typeof name==='string'?el.textContent.trim()===name:name.test(el.textContent.trim()))
const calls=[]
let plan='pro',setupFailure=false,visibility='visible',setupReads=0,managedPreviewSends=0
Object.defineProperty(document,'visibilityState',{get:()=>visibility,configurable:true})
const B='11111111-1111-4111-8111-111111111111',U='22222222-2222-4222-8222-222222222222'
const email='delivered@resend.dev'
const snapshot={kind:'invoice',number:'INV-MOBILE',status:'draft',issue_date:'2026-11-07',due_date:'2026-11-07',expires_on:null,subtotal:1,tax_amount:0,total:1,balance_due:1,amount_paid:0,customer_message:null,payment_instructions:null,payment_links:[],items:[{description:'Mobile route check',quantity:1,unit_price:1,line_total:1}],customer:{name:'Test Recipient',email,phone:null},company:{name:'Test Company',email:'owner@example.test',phone:null},finviant_branding:false,expires_at:'2026-12-01T00:00:00Z'}
const setup=()=>({plan,email:'owner@example.test',phone:null,personal_email_ready:true,personal_sms_ready:false,managed_email_ready:true,managed_sms_ready:false,acknowledged:true,reply_to:'owner@example.test',sms_reply_route:null})
const personalCalls=()=>calls.filter(c=>c.name==='prepare_personal_document').length
const managedCalls=()=>calls.filter(c=>c.name.startsWith('send-')).length
let supabase
try{
  ;({supabase}=await server.ssrLoadModule('/src/lib/supabase.ts'))
  supabase.auth.getSession=async()=>({data:{session:{user:{id:U}}},error:null})
  supabase.rpc=async(name,args)=>{
    if(name==='get_delivery_setup'){
      setupReads++
      return setupFailure?{data:null,error:{message:'Sending setup could not be refreshed'}}:{data:setup(),error:null}
    }
    calls.push({name,args})
    if(name==='prepare_personal_document')return {data:{snapshot},error:null}
    if(name==='get_invoice_reminder_review')return {data:{invoice_id:args.p_invoice,customer_id:'customer',number:'INV-MOBILE',email,phone:null,balance:1,due_date:'2026-11-06',version:'review',subject:'Invoice reminder',body:'Test reminder',last_reminder:null},error:null}
    return {data:null,error:null}
  }
  Object.defineProperty(supabase,'functions',{value:{invoke:async(name,input)=>{
    calls.push({name,...input.body})
    return {data:{status:'accepted',email_id:'mobile-receipt',recipient:email},error:null}
  }},configurable:true})
  const {default:DocumentDelivery}=await server.ssrLoadModule('/src/components/DocumentDelivery.tsx')
  const {default:CreationPreview}=await server.ssrLoadModule('/src/components/CreationPreview.tsx')
  const {default:InvoiceReminderDialog}=await server.ssrLoadModule('/src/components/InvoiceReminderDialog.tsx')
  const business={id:B,name:'Test Company',timezone:'America/New_York'}
  const mount=async(Component,props,key)=>{
    await act(async()=>root.render(React.createElement(Component,{...props,key})))
    await tick()
  }
  const savedProps=id=>({businessId:B,kind:'invoice',documentId:id,email,phone:null,onEditContact:()=>{},onSent:()=>{}})
  const previewProps=id=>({paper:{business,kind:'invoice',customer:{first_name:'Test',last_name:'Recipient',email},issued:'2026-11-07',ending:'2026-11-07',items:[{description:'Mobile route check',quantity:1,unit_price:1}],subtotal:1,tax:0,total:1},busy:false,error:'',onBack:()=>{},onSave:()=>{},saveForDelivery:async()=>id,onEmail:()=>{managedPreviewSends++}})
  const click=async name=>{
    const target=button(name)
    assert.ok(target,`Button ${name} is present`)
    assert.equal(target.disabled,false,`Button ${name} is enabled`)
    await act(async()=>target.click())
    await tick()
  }
  const reset=()=>{calls.length=0;nativeNavigations=0;managedPreviewSends=0;setupFailure=false;sessionStorage.clear()}

  // A phone returning from another tab must refresh a cross-device tier change.
  reset();plan='basic';await mount(DocumentDelivery,savedProps('focus-refresh'),'focus-refresh')
  assert.match(document.body.textContent,/Opens your email or messaging app/)
  const beforeFocus=setupReads;plan='pro'
  await act(async()=>window.dispatchEvent(new Event('focus')));await tick()
  assert.ok(setupReads>beforeFocus,'Focus refreshes authoritative sending setup')
  await click('Send Email')
  assert.equal(managedCalls(),1);assert.equal(personalCalls(),0);assert.equal(nativeNavigations,0)

  reset();plan='basic';await mount(DocumentDelivery,savedProps('visible-refresh'),'visible-refresh')
  plan='pro';visibility='hidden';await act(async()=>document.dispatchEvent(new Event('visibilitychange')))
  visibility='visible';await act(async()=>document.dispatchEvent(new Event('visibilitychange')));await tick()
  await click('Send Email')
  assert.equal(managedCalls(),1);assert.equal(personalCalls(),0);assert.equal(nativeNavigations,0)

  // The creation preview can be open while another device restores Pro access.
  reset();plan='basic';await mount(CreationPreview,previewProps('stale-preview'),'stale-preview')
  plan='pro';await click('Send Email')
  assert.equal(managedPreviewSends,1,'A stale personal preview routes its click through current Pro sending')
  assert.equal(personalCalls(),0);assert.equal(nativeNavigations,0)

  reset();plan='basic';await mount(CreationPreview,previewProps('failed-refresh'),'failed-refresh')
  setupFailure=true;await click('Send Email')
  assert.equal(managedPreviewSends,0);assert.equal(personalCalls(),0);assert.equal(nativeNavigations,0)
  assert.match(document.body.textContent,/could not be refreshed|unable|try again/i)

  // A saved external draft is uncertain; expose an explicit review, never change Pro's default route.
  reset();plan='pro'
  sessionStorage.setItem(['finviant-send',U,B,'invoice','pending-pro'].join(':'),JSON.stringify({token:'a'.repeat(64),channel:'email'}))
  await mount(DocumentDelivery,savedProps('pending-pro'),'pending-pro')
  assert.ok(button('Send Email'),'Pro retains its managed Send Email action')
  assert.equal(button('Send Email').disabled,true,'Unresolved external draft blocks a duplicate send')
  assert.equal(personalCalls(),0,'Pending draft is not reopened automatically')
  await click(/Review (?:earlier|previous).*app draft/i)
  await click('I did not send it')
  await click('Send Email')
  assert.equal(managedCalls(),1);assert.equal(nativeNavigations,0)

  // Reminders previously displayed the personal Send Email before the Pro sender.
  reset();plan='pro'
  await mount(InvoiceReminderDialog,{business,invoiceId:'pro-reminder',onClose:()=>{},onSent:()=>{}},'pro-reminder')
  assert.doesNotMatch(document.body.textContent,/Opens your email or messaging app/)
  await click(button('Send Email')?'Send Email':'Send Email with Finviant')
  assert.equal(calls.filter(c=>c.name==='send-invoice-reminder').length,1)
  assert.equal(personalCalls(),0);assert.equal(nativeNavigations,0)

  // An earlier native invoice/reminder draft can also represent an unconfirmed send.
  reset();plan='pro'
  sessionStorage.setItem(['finviant-send',U,B,'invoice','pending-reminder'].join(':'),JSON.stringify({token:'b'.repeat(64),channel:'email'}))
  await mount(InvoiceReminderDialog,{business,invoiceId:'pending-reminder',onClose:()=>{},onSent:()=>{}},'pending-reminder')
  const pendingReminderSend=button('Send Email')||button('Send Email with Finviant')
  assert.ok(pendingReminderSend,'Pro reminder retains its managed sending action')
  assert.equal(pendingReminderSend.disabled,true,'An unresolved native draft blocks a duplicate managed reminder')
  assert.equal(personalCalls(),0,'Pro reminder does not reopen the earlier native draft automatically')
  assert.equal(nativeNavigations,0)
  await click(/Review (?:earlier|previous).*app draft/i)
  await click('I did not send it')
  await click(button('Send Email')?'Send Email':'Send Email with Finviant')
  assert.equal(calls.filter(c=>c.name==='send-invoice-reminder').length,1)
  assert.equal(nativeNavigations,0,'Resolving an earlier draft returns to Finviant sending')

  // Personal sending is still available after an explicit, clearly named Pro choice.
  reset();plan='pro';await mount(DocumentDelivery,savedProps('explicit-personal'),'explicit-personal')
  await click(/Use my email/)
  assert.equal(button('Send Email'),undefined,'The explicit personal route is not labelled as Finviant Send Email')
  await click('Open email app')
  assert.equal(personalCalls(),1);assert.equal(nativeNavigations,1);assert.equal(managedCalls(),0)

  for(const tier of ['free','basic']){
    reset();plan=tier
    await mount(CreationPreview,previewProps('personal-'+tier),'personal-'+tier)
    await click('Send Email')
    assert.equal(personalCalls(),1,`${tier} keeps personal-app sending`)
    assert.equal(nativeNavigations,1);assert.equal(managedPreviewSends,0)
  }
  console.log('PASS: mobile Pro focus/visibility refresh, current-tier creation route, failed-refresh blocking, pending invoice/reminder draft safety, managed reminder default, explicit personal alternative, Free/Individual personal sending')
}finally{
  await act(async()=>root.unmount())
  await supabase?.auth.stopAutoRefresh()
  await server.close()
  dom.window.close()
}
process.exit(0)
