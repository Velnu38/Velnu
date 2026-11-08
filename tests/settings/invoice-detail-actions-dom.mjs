import assert from 'node:assert/strict'
import {JSDOM,VirtualConsole} from 'jsdom'
import {createServer} from 'vite'
process.env.VITE_SUPABASE_URL='https://test.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test-key'
process.env.VITE_ENABLE_PRIVATE_BETA_EMAIL='true'
const vc=new VirtualConsole()
vc.on('jsdomError',failure=>{if(!/Not implemented: navigation/.test(failure.message))throw failure})
const dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:'https://finviant.test/',pretendToBeVisual:true,virtualConsole:vc})
for(const key of ['window','document','HTMLElement','HTMLInputElement','Element','Node','Event','CustomEvent','MouseEvent','MutationObserver','HTMLDialogElement','history','location','localStorage','sessionStorage'])globalThis[key]=key==='window'?dom.window:dom.window[key]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
HTMLDialogElement.prototype.showModal=function(){this.open=true}
HTMLDialogElement.prototype.close=function(){this.open=false}
dom.window.confirm=()=>true
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client')
const root=createRoot(document.getElementById('root'))
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}})
const B='11111111-1111-4111-8111-111111111111',I='22222222-2222-4222-8222-222222222222',J='33333333-3333-4333-8333-333333333333',R='44444444-4444-4444-8444-444444444444'
let invoice,payments,job,appointment,plan='pro',operation='clear',operationsFail=false,managedReady=true,calls=[],reads=0,failPayment=false,pdfReads=0
let messages=[]
const business={id:B,name:'Test Business',role:'owner',primary_owner:true,access_modules:['billing','finances','jobs','calendar'],timezone:'UTC'}
const reset=(status='sent')=>{
 invoice={id:I,invoice_number:'INV-ACTIONS',status,issue_date:'2026-11-01',due_date:'2100-12-31',created_at:'2026-11-01T12:00:00Z',updated_at:'2026-11-01T12:00:00Z',subtotal:100,tax_amount:0,total:100,amount_paid:status==='paid'?100:status==='partial'?25:0,balance_due:status==='paid'?0:status==='partial'?75:100,deposit_credit:0,deposit_source_invoice_id:null,deposit_estimate_id:null,estimate_id:null,job_id:null,customer_id:B,customer_message:'Issued terms',notes:null,customers:{id:B,first_name:'Test',last_name:'Customer',email:'delivered@resend.dev',phone:null}}
 payments=[];messages=[];job=null;appointment=null;operation='clear';operationsFail=false;managedReady=true;plan='pro';calls=[];failPayment=false;sessionStorage.clear()
}
const tick=(ms=40)=>act(()=>new Promise(resolve=>setTimeout(resolve,ms)))
const button=(label,scope=document)=>[...scope.querySelectorAll('button')].find(el=>el.textContent.trim()===label||el.getAttribute('aria-label')===label)
const click=async(label,scope=document)=>{const el=button(label,scope);assert.ok(el,`${label} exists`);assert.equal(el.disabled,false,`${label} enabled`);await act(async()=>el.click());await tick()}
const setInput=async(el,value)=>{assert.ok(el);await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))});await tick()}
const primary=()=>document.querySelector('.record-action-primary button')?.textContent
const secondary=()=>document.querySelector('.record-action-secondary button')?.textContent
const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL
URL.createObjectURL=()=> 'blob:https://finviant.test/pdf';URL.revokeObjectURL=()=>{}
globalThis.fetch=async()=>{pdfReads++;return new Response(new TextEncoder().encode('%PDF-1.7\nInvoice bytes'),{headers:{'content-type':'application/pdf','x-finviant-revision-id':R}})}
try{
 const {supabase}=await server.ssrLoadModule('/src/lib/supabase.ts')
 supabase.auth.getSession=async()=>({data:{session:{access_token:'owner-token',user:{id:'owner'}}},error:null})
 supabase.channel=()=>{const c={on:()=>c,subscribe:()=>c};return c};supabase.removeChannel=async()=>{}
 supabase.from=table=>{
  let single=false,filters=[],select=''
  const query=new Proxy({}, {get:(_,key)=>key==='then'?(resolve)=>{
   if(table==='invoices')reads++
   const data=table==='invoices'?(single?invoice:[invoice]):table==='invoice_items'?[{id:I,description:'Work',quantity:1,unit_price:100,tax_rate:0,line_total:100}]:table==='payments'?payments:table==='jobs'?(single?job:job?[job]:[]):table==='appointments'?(single?appointment:appointment?[appointment]:[]):table==='messages'?(single?messages.find(m=>filters.some(([name,value])=>name==='id'&&value===m.id))||null:messages):[]
   resolve({data,error:null,count:Array.isArray(data)?data.length:1})
  }:(...args)=>{if(key==='single'||key==='maybeSingle')single=true;if(key==='eq')filters.push(args);if(key==='select')select=args[0];return query}})
  return query
 }
 supabase.rpc=async(name,args)=>{
  calls.push({name,args})
  if(name==='get_plan_usage')return{data:{plan,jobs_limit:10,jobs_used:0},error:null}
  if(name==='get_delivery_setup')return{data:{plan,personal_email_ready:true,personal_sms_ready:false,managed_email_ready:managedReady,managed_sms_ready:false},error:null}
  if(name==='get_invoice_payment_operations')return{data:{state:operation,refunds:payments.some(p=>p.status==='partially_refunded')?[{id:'refund-1',amount:25,refunded_at:'2026-11-08T12:00:00Z',currency:'USD'}]:[]},error:operationsFail?{message:'Unavailable'}:null}
  if(name==='get_document_change_context')return{data:{job_id:invoice.job_id,can_change:!['void','completed','canceled'].includes(job?.status||invoice.status),work_status:job?.status||''},error:null}
  if(name==='record_manual_payment'){
   if(failPayment){failPayment=false;return{data:null,error:{message:'Temporary network failure'}}}
   invoice={...invoice,amount_paid:Number(invoice.amount_paid)+args.payment_amount,balance_due:Number(invoice.balance_due)-args.payment_amount,status:Number(invoice.balance_due)===args.payment_amount?'paid':'partial'}
   payments.push({id:args.request_id,amount:args.payment_amount,method:args.payment_method,status:'succeeded',paid_at:'2026-11-08T12:00:00Z'})
   return{data:{id:args.request_id,paid_at:'2026-11-08T12:00:00Z'},error:null}
  }
  return{data:[],error:null}
 }
 Object.defineProperty(supabase,'functions',{configurable:true,value:{invoke:async(name,{body})=>{calls.push({name,args:body});return{data:{status:'accepted',email_id:'sent-1',recipient:'delivered@resend.dev'},error:null}}}})
 const {default:InvoiceDetail}=await server.ssrLoadModule('/src/components/InvoiceDetail.tsx')
 let key=0
 const mount=async(role='owner',modules=business.access_modules)=>{await act(async()=>root.render(React.createElement(InvoiceDetail,{key:++key,business:{...business,role,primary_owner:role==='owner',access_modules:modules},invoiceId:I,onBack:()=>{}})));await tick();await tick()}
 for(const [state,p,s] of [['draft','Send invoice','Edit draft'],['sent','Mark Paid',undefined],['viewed','Mark Paid',undefined],['partial','Mark Paid',undefined],['overdue','Send reminder','Mark Paid'],['paid',undefined,undefined],['void',undefined,undefined]]){
  reset(state);await mount();assert.equal(primary(),p,state);assert.equal(secondary(),s,state)
  assert.equal(document.querySelectorAll('.record-action-primary button').length,p?1:0)
  assert.equal(document.querySelector('iframe'),null,'PDF stays compact until View PDF')
  assert.ok(button('Photos & expenses'));assert.ok(button('Activity0'))
  assert.equal(button('Schedule reminder'),undefined,'internal follow-up is clearly named and kept in More')
  assert.equal(!!document.querySelector('summary')?.textContent?.includes('Schedule this invoice'),false)
 }
 reset('partial');invoice.due_date='2020-01-01';await mount();assert.equal(primary(),'Send reminder');assert.equal(secondary(),'Mark Paid')
 for(const state of ['pending','review_required']){reset('overdue');operation=state;await mount();assert.equal(primary(),undefined);assert.equal(button('Mark Paid'),undefined);assert.equal(button('Void invoice'),undefined);assert.ok(document.querySelector('aside[role=status]'))}
 reset();operationsFail=true;await mount();assert.equal(button('Mark Paid'),undefined);assert.ok(button('Retry payment status'))
 operationsFail=false;await click('Retry payment status');assert.equal(primary(),'Mark Paid')
 reset('draft');invoice.balance_due=0;invoice.total=0;await mount();assert.match(document.querySelector('.record-detail-status').textContent,/Draft/)
 for(const role of ['viewer','technician']){reset();await mount(role,['jobs','calendar']);assert.equal(primary(),undefined);assert.equal(button('Mark sent manually'),undefined);assert.equal(button('Void invoice'),undefined)}
 reset();invoice.job_id=J;job={id:J,title:'Linked job',status:'scheduled',scheduled_start:'2100-01-01T10:00:00Z',scheduled_end:'2100-01-01T11:00:00Z'};appointment={id:J,starts_at:'2100-01-01T10:00:00Z',ends_at:'2100-01-01T11:00:00Z',status:'confirmed'};await mount();assert.match(document.body.textContent,/Appointment:/);assert.equal(button('Schedule job'),undefined);assert.equal([...document.querySelectorAll('a')].filter(el=>el.textContent==='Schedule existing job').length,0)
 reset('paid');invoice.job_id=J;job={id:J,title:'Not done yet',status:'lead',scheduled_start:null,scheduled_end:null};await mount();assert.doesNotMatch(document.body.textContent,/Linked work completed/);assert.ok([...document.querySelectorAll('a')].find(el=>el.textContent==='Schedule existing job'))
 reset();invoice.job_id=J;job={id:J,title:'Missing calendar event',status:'scheduled',scheduled_start:'2100-01-01T10:00:00Z',scheduled_end:'2100-01-01T11:00:00Z'};appointment=null;await mount();assert.match(document.body.textContent,/no active appointment/);assert.ok([...document.querySelectorAll('a')].find(el=>el.textContent==='Schedule existing job'),'repair opens existing work instead of creating a second job')
 reset('draft');invoice.deposit_estimate_id=J;await mount();assert.equal(button('Schedule job'),undefined);assert.match(document.body.textContent,/Schedule the approved estimate, not this deposit invoice/)
 reset('draft');for(const tier of ['free','basic','pro']){plan=tier;await mount();await click('Send invoice');assert.ok(document.querySelector('dialog'));assert.equal(calls.some(c=>c.name==='send-invoice-email'),false,'opening dialog never sends');if(tier==='pro')assert.ok(button('Send Email'));else assert.match(document.querySelector('dialog').textContent,/Personal email/);await click('Close delivery');}
 reset('paid');await mount();await click('Send invoice copy');assert.ok(button('Send Email'));assert.equal(button('Open email app'),undefined,'Pro copies preserve managed sending by default');assert.equal(calls.some(c=>c.name==='send-invoice-email'),false);await click('Close delivery')
 reset();await mount();await click('View PDF');assert.ok(document.querySelector('iframe'))
 await click('Mark Paid');let dialog=document.querySelector('dialog');assert.equal(dialog.querySelector('input[type=number]').value,'100');assert.equal(dialog.querySelector('input[type=number]').readOnly,false)
 await setInput(dialog.querySelector('input[type=number]'),'25');failPayment=true;await click('Record partial payment',dialog);const first=calls.find(c=>c.name==='record_manual_payment').args.request_id;await click('Record partial payment',dialog);assert.equal(calls.filter(c=>c.name==='record_manual_payment').at(-1).args.request_id,first,'partial payment retry uses the same ledger request')
 assert.equal(invoice.balance_due,75);await click('Mark Paid');dialog=document.querySelector('dialog');assert.equal(dialog.querySelector('input[type=number]').value,'75');await click('Mark Paid',dialog);assert.equal(invoice.status,'paid');assert.equal(button('Mark Paid'),undefined)
 await click('Activity2');assert.match(document.querySelector('[role=tabpanel]:not([hidden])').textContent,/Received funds, net of refunds: \$100\.00/)
 reset('partial');payments=[{id:'gross',amount:100,method:'card',provider:'stripe_customer',status:'partially_refunded',paid_at:'2026-11-01T12:00:00Z'}];invoice.amount_paid=75;invoice.balance_due=25;await mount();await click('Activity2');assert.match(document.querySelector('[role=tabpanel]:not([hidden])').textContent,/Customer refund/);assert.match(document.body.textContent,/−\$25\.00/)
 reset('draft');sessionStorage.setItem(`finviant-send:owner:${B}:invoice:${I}`,JSON.stringify({token:'ab'.repeat(32),channel:'email'}));await mount();assert.equal(primary(),undefined);assert.ok(button('Review delivery'));await click('Review delivery');if(button('Review earlier app draft'))await click('Review earlier app draft');assert.ok(button('Confirm sent'))
 reset('draft');sessionStorage.setItem(`finviant-reviewed-email:${B}:invoice:${I}`,'saved-op');messages=[{id:'saved-op',status:'accepted',channel:'email',body:'Earlier accepted send',created_at:'2026-11-01T12:00:00Z'}];await mount();assert.equal(primary(),'Send invoice','accepted send is not mislabeled uncertain')
 reset();await mount();await click('Photos & expenses');await click('Add expense manually');let description=document.querySelector('input[placeholder="Supplies, subcontractor, mileage…"]');await setInput(description,'Keep this unfinished expense');const before=reads;await click('Activity0');await act(async()=>window.dispatchEvent(new Event('finviant-work-changed')));await tick(220);assert.equal(reads,before,'background refresh pauses while an expense draft is dirty');await click('Photos & expenses');assert.equal(document.querySelector('input[placeholder="Supplies, subcontractor, mileage…"]').value,'Keep this unfinished expense')
 console.log('PASS invoice states, overdue partial, role/tier gates, existing work, compact PDF, ledger/full/partial retry, refunds, recovery, dirty tab preservation')
 await act(async()=>root.unmount());await supabase.auth.stopAutoRefresh()
}finally{URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;await server.close();dom.window.close()}
process.exit(0)
