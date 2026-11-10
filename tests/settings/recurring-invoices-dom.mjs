import assert from 'node:assert/strict'
import {JSDOM,VirtualConsole} from 'jsdom'
import {createServer} from 'vite'
process.env.VITE_SUPABASE_URL='https://test.supabase.co';process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test-key'
const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/Not implemented: navigation/.test(e.message))throw e})
const dom=new JSDOM('<div id="root"></div>',{url:'https://finviant.test/',pretendToBeVisual:true,virtualConsole:vc})
for(const name of ['window','document','HTMLElement','HTMLInputElement','Element','Node','Event','CustomEvent','MouseEvent','KeyboardEvent','MutationObserver','HTMLDialogElement','history','location','localStorage','sessionStorage'])globalThis[name]=name==='window'?dom.window:dom.window[name]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.requestAnimationFrame=cb=>setTimeout(cb,0);globalThis.cancelAnimationFrame=clearTimeout
HTMLElement.prototype.scrollIntoView=function(){};HTMLDialogElement.prototype.showModal=function(){this.open=true};HTMLDialogElement.prototype.close=function(){this.open=false}
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client'),root=createRoot(document.getElementById('root'))
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}})
const business={id:'11111111-1111-4111-8111-111111111111',role:'owner',primary_owner:true,timezone:'America/New_York',access_modules:['billing','jobs','calendar']}
let supabase,plan='basic',calls=[],status='active',failCreate=true,saved=0
const fixture={id:'22222222-2222-4222-8222-222222222222',source_invoice_id:'source',title:'Monthly lawn service',cadence:'monthly',next_date:'2027-01-01',end_date:null,status:'active',last_error:null,schedule_visit:false,timezone:'America/New_York',visit_time:'09:00',due_days:7,created_at:'2026-11-01T00:00:00Z',occurrences:[]}
const tick=()=>act(()=>new Promise(r=>setTimeout(r,35)))
const button=t=>[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===t)
const click=async text=>{assert.ok(button(text),text);await act(async()=>button(text).click());await tick()}
try{
 ({supabase}=await server.ssrLoadModule('/src/lib/supabase.ts'))
 supabase.rpc=async(name,args)=>{calls.push({name,args})
  if(name==='get_plan_usage')return{data:{plan},error:null}
  if(name==='get_schedule_team')return{data:[{id:'worker-profile',label:'Roster worker',active:true}],error:null}
  if(name==='get_recurring_invoice_page')return{data:{items:[{...fixture,status}],has_more:false,counts:{active:status==='active'?1:0,paused:status==='paused'?1:0,ended:0}},error:null}
  if(name==='set_recurring_invoice_status'){status=args.p_status;return{data:null,error:null}}
  if(name==='create_recurring_invoice'){if(failCreate){failCreate=false;return{data:null,error:Error('Synthetic lost response')}}return{data:{id:args.p_request,status:'active'},error:null}}
  throw Error('Unexpected RPC '+name)
 }
 const {RecurringSchedulesDialog,RepeatInvoiceDialog}=await server.ssrLoadModule('/src/components/RecurringInvoices.tsx')
 await act(async()=>root.render(React.createElement(RecurringSchedulesDialog,{business,onClose:()=>{}})));await tick();await tick()
 assert.match(document.body.textContent,/Monthly lawn service/);assert.ok(button('Pause schedule'))
 window.confirm=()=>false;await click('Pause schedule');assert.equal(calls.filter(c=>c.name==='set_recurring_invoice_status').length,0)
 window.confirm=()=>true;const pause=button('Pause schedule');await act(async()=>{pause.click();pause.click()});await tick();await tick()
 assert.equal(calls.filter(c=>c.name==='set_recurring_invoice_status').length,1);assert.ok(button('Resume schedule'))
 await click('Resume schedule');assert.equal(status,'active');assert.ok(button('Pause schedule'))
 await act(async()=>root.render(React.createElement(RepeatInvoiceDialog,{business,invoiceId:'source',invoiceNumber:'INV-100',onClose:()=>{},onSaved:()=>saved++,key:'repeat'})));await tick();await tick()
 assert.match(document.body.textContent,/Nothing is sent to the customer or charged automatically/)
 assert.equal(document.querySelector('input[type=checkbox]'),null,'Individual keeps draft-only recurrence')
 const submit=button('Create recurring schedule');assert.ok(submit&&!submit.disabled)
 await act(async()=>{submit.click();submit.click()});await tick();assert.equal(calls.filter(c=>c.name==='create_recurring_invoice').length,1);assert.match(document.body.textContent,/Synthetic lost response/)
 await click('Create recurring schedule');await tick();const creates=calls.filter(c=>c.name==='create_recurring_invoice')
 assert.equal(creates.length,2);assert.equal(creates[0].args.p_request,creates[1].args.p_request,'unknown outcome retries retain the request identity');assert.deepEqual(creates[0].args.p_options,creates[1].args.p_options)
 assert.equal(saved,1);assert.equal(button('Create recurring schedule'),undefined);assert.ok(document.querySelector('a[href="/?view=invoices&recurring=1"]'))
 plan='free';await act(async()=>root.render(React.createElement(RepeatInvoiceDialog,{business,invoiceId:'source',invoiceNumber:'INV-100',onClose:()=>{},onSaved:()=>{},key:'free'})));await tick();await tick();assert.equal(button('Create recurring schedule').disabled,true)
 plan='pro';await act(async()=>root.render(React.createElement(RepeatInvoiceDialog,{business,invoiceId:'source',invoiceNumber:'INV-100',onClose:()=>{},onSaved:()=>{},key:'pro'})));await tick();await tick()
 const visits=document.querySelector('input[type=checkbox]');assert.ok(visits);await act(async()=>visits.click());await tick();assert.match(document.body.textContent,/Roster worker/);assert.match(document.body.textContent,/No accounts, invitations or employee notifications/)
 const before=calls.filter(c=>c.name==='get_recurring_invoice_page').length
 await act(async()=>root.render(React.createElement(RecurringSchedulesDialog,{business:{...business,role:'office',primary_owner:false},onClose:()=>{},key:'office'})));await tick();assert.equal(document.querySelector('dialog'),null);assert.equal(calls.filter(c=>c.name==='get_recurring_invoice_page').length,before)
 assert.ok(!calls.some(c=>/send|invite|charge|reserve_ai/.test(c.name)))
 console.log('PASS recurring owner visibility, pause confirmation, duplicate-click guard, draft-only Individual, stable create retry, Free restriction, roster-only Pro visits and no sends/charges/Fin usage')
}finally{await act(async()=>root.unmount());await supabase?.auth.stopAutoRefresh();await supabase?.removeAllChannels();await server.close();dom.window.close()}
process.exit(0)
