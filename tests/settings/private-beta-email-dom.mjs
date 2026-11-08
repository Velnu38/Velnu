import {JSDOM} from 'jsdom'
import {createServer} from 'vite'
import assert from 'node:assert/strict'

process.env.VITE_SUPABASE_URL='https://test.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test-key'
process.env.VITE_ENABLE_CUSTOMER_ACTIONS='false'
process.env.VITE_ENABLE_PRIVATE_BETA_EMAIL='true'
const dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:'http://localhost/tests/beta-email',pretendToBeVisual:true})
for(const key of ['window','document','HTMLElement','Element','Node','Event','MouseEvent','MutationObserver','HTMLDialogElement','history','location','localStorage','sessionStorage'])globalThis[key]=key==='window'?dom.window:dom.window[key]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
const realFetch=globalThis.fetch
const PDF_REVISION='77777777-7777-4777-8777-777777777777'
globalThis.fetch=async(url,options)=>String(url).endsWith('/functions/v1/document-pdf')
 ?new Response(new TextEncoder().encode('%PDF-1.7\ncanonical-test-pdf'),{headers:{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="Invoice.pdf"','X-Finviant-Revision-Id':PDF_REVISION}})
 :realFetch(url,options)
const realAnchorClick=dom.window.HTMLAnchorElement.prototype.click
dom.window.HTMLAnchorElement.prototype.click=function(){if(!this.download)return realAnchorClick.call(this)}

globalThis.IS_REACT_ACT_ENVIRONMENT=true
const React=await import('react')
const {createRoot}=await import('react-dom/client')
const {act}=React
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}})
const root=createRoot(document.getElementById('root'))
const tick=()=>act(()=>new Promise(resolve=>setTimeout(resolve,30)))
const button=name=>[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===name)
const calls=[]
let outcome='accepted',plan='pro',betaStopConfirmed=true
let supabase
try{
  ;({supabase}=await server.ssrLoadModule('/src/lib/supabase.ts'))
  supabase.auth.getSession=async()=>({data:{session:{user:{id:'owner'},access_token:'owner-test-token'}},error:null})
  supabase.rpc=async name=>({data:name==='get_delivery_setup'?{plan,email:'owner@example.test',phone:'+17575550100',personal_email_ready:true,personal_sms_ready:false,managed_email_ready:true,managed_sms_ready:false,acknowledged:true}:null,error:null})
  const invoke=async(name,input)=>{
    calls.push({name,...input.body})
    if(outcome!=='accepted')return {data:null,error:{context:new Response(JSON.stringify({code:outcome,beta_send_not_started:outcome==='beta_recipient_not_approved'&&betaStopConfirmed,error:outcome==='beta_recipient_not_approved'?'Private beta email can only be sent to approved test addresses.':'Email outcome uncertain.'}),{status:outcome==='beta_recipient_not_approved'?403:503})}}
    return {data:{status:'accepted',email_id:'beta-receipt',recipient:'delivered@resend.dev'},error:null}
  }
  Object.defineProperty(supabase,'functions',{value:{invoke},configurable:true})
  const flags=await server.ssrLoadModule('/src/lib/releaseFlags.ts')
  assert.equal(flags.customerActionsEnabled,false)
  assert.equal(flags.emailDeliveryEnabled,true)
  const {default:DocumentDelivery}=await server.ssrLoadModule('/src/components/DocumentDelivery.tsx')
  const mount=async key=>{await act(async()=>root.render(React.createElement(DocumentDelivery,{key,businessId:'business',kind:'invoice',documentId:key,email:'delivered@resend.dev',phone:'+17575550100',onEditContact:()=>{},onSent:()=>{}})));await tick()}
  const click=async name=>{const el=button(name);assert.ok(el,`${name} exists`);await act(async()=>el.click());await tick()}

  await mount('blocked-recipient')
  assert.equal(button('Send Email').disabled,false)
  assert.equal(button('Send Text').disabled,true)
  assert.match(document.body.textContent,/Private beta email sends only to approved test addresses/)
  outcome='beta_recipient_not_approved';await click('Send Email')
  assert.match(document.querySelector('[role=alert]').textContent,/approved test addresses/)
  assert.equal(document.querySelector('[role=status]'),null)
  outcome='accepted';await click('Retry email')
  assert.match(document.querySelector('[role=status]').textContent,/Email accepted for delivery/)
  assert.notEqual(calls[0].request_id,calls[1].request_id)
  assert.equal(button('Email accepted').disabled,true)

  await mount('uncertain-send')
  outcome='delivery_unconfirmed';await click('Send Email')
  outcome='accepted';await click('Retry email')
  assert.equal(calls[2].request_id,calls[3].request_id)

  plan='basic';await mount('personal-email')
  assert.equal(button('Send Email').disabled,false)
  assert.match(document.body.textContent,/Personal email downloads the finished PDF/)
  assert.doesNotMatch(document.body.textContent,/Private beta email sends only/)
  assert.equal(calls.length,4)

  const {sendInvoiceReminder}=await server.ssrLoadModule('/src/services/invoiceReminders.ts')
  const review={invoice_id:'reminder',email:'delivered@resend.dev'}
  outcome='beta_recipient_not_approved';await assert.rejects(()=>sendInvoiceReminder('business',review),/approved test addresses/)
  outcome='accepted';await sendInvoiceReminder('business',review)
  assert.notEqual(calls[4].request_id,calls[5].request_id)
  const {sendReviewedDocument}=await server.ssrLoadModule('/src/services/reviewDelivery.ts')
  const explicit='11111111-1111-4111-8111-111111111111'
  outcome='beta_recipient_not_approved';await assert.rejects(()=>sendReviewedDocument('business','invoice','voice-draft','delivered@resend.dev',explicit),/approved test addresses/)
  outcome='accepted';await sendReviewedDocument('business','invoice','voice-draft','delivered@resend.dev',explicit)
  assert.equal(calls[6].request_id,explicit)
  assert.notEqual(calls[6].request_id,calls[7].request_id)
  plan='pro';await mount('unfinished-beta-stop')
  outcome='beta_stop_unconfirmed';await click('Send Email')
  assert.match(document.querySelector('[role=alert]').textContent,/uncertain/)
  outcome='accepted';await click('Retry email')
  assert.equal(calls[8].request_id,calls[9].request_id)
  assert.match(document.querySelector('[role=status]').textContent,/Email accepted for delivery/)
  betaStopConfirmed=false
  outcome='beta_recipient_not_approved';await assert.rejects(()=>sendReviewedDocument('business','invoice','missing-beta-stop-proof','delivered@resend.dev'),/approved test addresses/)
  outcome='accepted';await sendReviewedDocument('business','invoice','missing-beta-stop-proof','delivered@resend.dev')
  assert.equal(calls[10].request_id,calls[11].request_id)
  console.log('PASS: beta email flag, managed email UI, SMS gate, proven beta rejection recovery, uncertain-send idempotency, personal sending, reminder recovery, explicit voice-send recovery, unconfirmed-stop idempotency, missing-proof idempotency')
}finally{
  await act(async()=>root.unmount())
  await supabase?.auth.stopAutoRefresh()
  await server.close()
  dom.window.close()
}
process.exit(0)
