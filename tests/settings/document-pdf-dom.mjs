import assert from 'node:assert/strict'
import { JSDOM, VirtualConsole } from 'jsdom'
import { createServer } from 'vite'

process.env.VITE_SUPABASE_URL='https://test.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test-key'
process.env.VITE_ENABLE_PRIVATE_BETA_EMAIL='true'
const vc=new VirtualConsole()
vc.on('jsdomError',error=>{if(!/Not implemented: navigation/.test(error.message))throw error})
const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'https://finviant.test/',pretendToBeVisual:true,virtualConsole:vc})
for(const key of ['window','document','HTMLElement','HTMLInputElement','Element','Node','Event','CustomEvent','MouseEvent','MutationObserver','HTMLDialogElement','history','location','localStorage','sessionStorage'])globalThis[key]=key==='window'?dom.window:dom.window[key]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
HTMLDialogElement.prototype.showModal=function(){this.open=true}
HTMLDialogElement.prototype.close=function(){this.open=false}
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const React=await import('react')
const { act }=React
const {createRoot}=await import('react-dom/client')
const root=createRoot(document.getElementById('root'))
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}})
const B='11111111-1111-4111-8111-111111111111',R='77777777-7777-4777-8777-777777777777',T='a'.repeat(64)
const bytes=new TextEncoder().encode('%PDF-1.7\nThe same frozen issued document bytes')
let mode='pdf',plan='pro',shareCancelled=false,pdfRequests=[],rpcCalls=[],functionCalls=[],downloads=[],urls=new Map(),counter=0,paymentState='not_connected'
const snapshot={kind:'invoice',number:'INV-PDF',status:'sent',live_status:'partial',issue_date:'2026-11-07',due_date:'2026-11-07',expires_on:null,subtotal:100,tax_amount:0,total:100,balance_due:100,amount_paid:0,live_balance_due:25,live_amount_paid:75,revision_id:R,customer_message:null,payment_instructions:'Reference INV-PDF.',payment_links:[],items:[{description:'Frozen work',quantity:1,unit_price:100,line_total:100}],customer:{name:'Test Customer',first_name:'Test',last_name:'Customer',email:'delivered@resend.dev',phone:null},company:{name:'Test Business',email:'owner@example.test',phone:null},finviant_branding:false,expires_at:null,pro_actions_enabled:false,action_state:'read_only'}
const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL
URL.createObjectURL=blob=>{const value='blob:https://finviant.test/'+(++counter);urls.set(value,blob);return value}
URL.revokeObjectURL=url=>urls.delete(url)
dom.window.HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push({name:this.download,blob:urls.get(this.href)})}
Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true})
Object.defineProperty(navigator,'share',{value:async()=>{if(shareCancelled)throw new DOMException('Cancelled','AbortError')},configurable:true})
globalThis.fetch=async(url,options)=>{
 assert.equal(String(url),'https://test.supabase.co/functions/v1/document-pdf')
 pdfRequests.push({headers:options.headers,body:JSON.parse(options.body)})
 if(mode==='html')return new Response('<html>login</html>',{headers:{'Content-Type':'text/html'}})
 return new Response(bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="INV-PDF.pdf"','X-Finviant-Revision-Id':R,'ETag':'"document-hash"'}})
}
const tick=()=>act(()=>new Promise(resolve=>setTimeout(resolve,45)))
const button=name=>[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===name)
const click=async name=>{const el=button(name);assert.ok(el,`${name} exists`);assert.equal(el.disabled,false);await act(async()=>el.click());await tick()}
const mount=async(Component,props,key,strict=false)=>{await act(async()=>root.render(strict?React.createElement(React.StrictMode,null,React.createElement(Component,{...props,key})):React.createElement(Component,{...props,key})));await tick()}
let supabase
try{
 ;({supabase}=await server.ssrLoadModule('/src/lib/supabase.ts'))
 supabase.auth.getSession=async()=>({data:{session:{access_token:'owner-only-token',user:{id:'owner'}}},error:null})
 supabase.rpc=async(name,args)=>{
  rpcCalls.push({name,args})
  if(name==='get_delivery_setup')return{data:{plan,email:'owner@example.test',personal_email_ready:true,personal_sms_ready:false,managed_email_ready:true,managed_sms_ready:false},error:null}
  if(name==='prepare_personal_document')return{data:{snapshot},error:null}
  if(name==='get_shared_document')return{data:snapshot,error:null}
  return{data:null,error:null}
 }
 Object.defineProperty(supabase,'functions',{configurable:true,value:{invoke:async(name,{body})=>{
  functionCalls.push({name,body})
  if(name==='customer-approval')return{data:{business_name:'Test Business',document_type:'estimate',document:{estimate_number:'EST-PDF'},customer:snapshot.customer,expires_at:null,completed:null,action_state:'available'},error:null}
  if(name==='customer-invoice-checkout')return{data:{available:paymentState==='ready',state:paymentState,message:paymentState==='not_connected'?'Online invoice payment is not activated. Contact the business.':'Confirm payment status with the business before paying again.'},error:null}
  return{data:{status:'accepted',email_id:'receipt',recipient:'delivered@resend.dev'},error:null}
 }}})
 const pdfService=await server.ssrLoadModule('/src/services/documentPdf.ts')
 const {default:Viewer}=await server.ssrLoadModule('/src/components/DocumentPdfPreview.tsx')
 const {default:Creation}=await server.ssrLoadModule('/src/components/CreationPreview.tsx')
 const {default:Delivery}=await server.ssrLoadModule('/src/components/DocumentDelivery.tsx')
 const {default:Personal}=await server.ssrLoadModule('/src/components/PersonalDocumentDelivery.tsx')
 const {default:Customer}=await server.ssrLoadModule('/src/pages/SharedDocumentPage.tsx')
 const {default:Approval}=await server.ssrLoadModule('/src/pages/CustomerApprovalPage.tsx')
 const artifact=await pdfService.getDocumentPdf({token:T,tokenType:'share'})
 assert.deepEqual(new Uint8Array(await artifact.blob.arrayBuffer()),bytes)
 assert.equal(pdfRequests.at(-1).headers.Authorization,undefined,'customer PDFs never forward an owner access token')
 assert.equal(pdfRequests.at(-1).body.token,T)
 assert.equal(artifact.revisionId,R)
 await pdfService.getDocumentPdf({businessId:B,kind:'invoice',documentId:'invoice'})
 assert.equal(pdfRequests.at(-1).headers.Authorization,'Bearer owner-only-token')
 mode='html';await assert.rejects(()=>pdfService.getDocumentPdf({token:T,tokenType:'share'}),/did not return a PDF/);mode='pdf'

 await mount(Viewer,{source:{token:T,tokenType:'share'},title:'Issued PDF'},'viewer')
 assert.ok(document.querySelector('iframe[src^="blob:"]'))
 assert.equal(document.querySelector('object'),null,'PDF embedding preserves object-src:none security policy')
 await click('Download PDF')
 assert.deepEqual(new Uint8Array(await downloads.at(-1).blob.arrayBuffer()),bytes,'download uses the exact preview artifact')

 let saves=0,reviewed=null
 const props={paper:{business:{id:B,name:'Test Business'},kind:'invoice',customer:snapshot.customer,issued:'2026-11-07',ending:'2026-11-07',items:snapshot.items,subtotal:100,tax:0,total:100},busy:false,error:'',onBack:()=>{},onSave:()=>{},saveForDelivery:async()=>{saves++;return'invoice'},onEmail:version=>{reviewed=version}}
 await mount(Creation,props,'creation',true)
 assert.equal(saves,1,'StrictMode prepares one saved draft, not duplicate documents')
 assert.ok(document.querySelector('iframe'))
 await click('Send Email');assert.equal(reviewed,R,'creation send binds the version shown in its PDF preview')

 functionCalls=[];await mount(Delivery,{businessId:B,kind:'invoice',documentId:'saved',email:'delivered@resend.dev',onEditContact:()=>{},onSent:()=>{}},'delivery')
 await click('Send Email')
 assert.equal(functionCalls.find(call=>call.name==='send-invoice-email').body.expected_revision_id,R)

 await mount(Customer,{token:T},'customer')
 assert.match(document.body.textContent,/Current balance: \$25\.00/)
 assert.match(document.body.textContent,/Paid: \$75\.00/)
 assert.equal(button('Pay invoice'),undefined,'read-only links have no Pro customer checkout')
 assert.ok(document.querySelector('iframe'))
 snapshot.payment_links=[{provider:'paypal',url:'https://paypal.me/TestBusiness'}]
 await mount(Customer,{token:T},'customer-manual-current')
 const manualPayment=()=>document.querySelector('a[href^="https://paypal.me/TestBusiness"]')
 assert.ok(manualPayment(),'current lower-tier invoices retain manual payment options')
 assert.equal(manualPayment().href,'https://paypal.me/TestBusiness/25.00USD','manual links request only the current outstanding balance')
 assert.equal(manualPayment().target,'_blank');assert.equal(manualPayment().rel,'noopener noreferrer')
 for(const state of ['superseded','void','unavailable','expired']){
  snapshot.action_state=state
  await mount(Customer,{token:T},'customer-manual-'+state)
  assert.equal(manualPayment(),null,'historical or unavailable copies cannot invite another payment')
 }
 snapshot.action_state='read_only'
 snapshot.revision_id=undefined
 await mount(Customer,{token:T},'customer-legacy-history')
 assert.equal(manualPayment(),null,'legacy history with no canonical revision cannot request another payment')
 snapshot.revision_id=R
 snapshot.pro_actions_enabled=true
 await mount(Customer,{token:T},'customer-pro')
 assert.match(document.body.textContent,/Online invoice payment is not activated/)
 assert.equal(button('Pay invoice'),undefined,'missing merchant setup cannot pretend to accept payments')
 paymentState='review_required'
 await mount(Customer,{token:T},'customer-review-required')
 assert.equal(manualPayment(),null,'reconciliation blocks manual payment shortcuts as well as automatic checkout')
 paymentState='not_connected'

 await mount(Approval,{token:T},'approval')
 assert.ok(document.querySelector('iframe'))
 assert.equal(button('Accept estimate and agree to terms').disabled,true,'approval still requires explicit consent')
 const approvals=await server.ssrLoadModule('/src/services/approvals.ts')
 await approvals.submitCustomerApproval(T,'approved','Test Customer',true,R)
 assert.equal(functionCalls.at(-1).body.expected_revision_id,R,'approval is bound to the reviewed PDF revision')

 plan='basic';rpcCalls=[];shareCancelled=true
 await mount(Personal,{businessId:B,kind:'invoice',documentId:'native',email:'delivered@resend.dev',setup:{plan:'basic',personal_email_ready:true,personal_sms_ready:false},disabled:false,onEditContact:()=>{},onSent:()=>{}},'personal')
 await click('Prepare PDF to share');await click('Share PDF by email')
 assert.match(document.body.textContent,/Sharing cancelled/)
 assert.equal(button('Confirm sent'),undefined)
 assert.equal(rpcCalls.filter(call=>call.name==='confirm_personal_document_sent').length,0)
 console.log('PASS: stored-PDF bytes and privacy, HTML/error rejection, exact preview/download, once-only creation, reviewed revision sends/approvals, live customer overlays, payment readiness, native sharing cancellation')
}finally{
 await act(async()=>root.unmount());await supabase?.auth.stopAutoRefresh();await supabase?.removeAllChannels();await server.close();dom.window.close();URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke
}
process.exit(0)
