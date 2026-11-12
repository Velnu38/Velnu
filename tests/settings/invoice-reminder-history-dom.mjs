import assert from 'node:assert/strict'
import {JSDOM,VirtualConsole} from 'jsdom'
import {createServer} from 'vite'
process.env.VITE_SUPABASE_URL='https://test.supabase.co';process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test-key'
const dom=new JSDOM('<div id="root"></div>',{url:'https://finviant.test/',pretendToBeVisual:true,virtualConsole:new VirtualConsole()})
for(const key of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','Element','Node','Event','CustomEvent','MutationObserver','history','location','localStorage','sessionStorage'])globalThis[key]=key==='window'?dom.window:dom.window[key]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client'),root=createRoot(document.getElementById('root'))
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}})

let supabase,calls=[],resolveSlow,fail=false
const item=(n,status='accepted')=>({id:String(n),created_at:'2026-11-01T12:00:00Z',channel:'email',recipient:'synthetic@example.test',source:'manual',initiator:'You',status,attempts:1,detail:null,events:[]})
const states=['queued','sending','accepted','delivered','failed','bounced','canceled','suppressed','uncertain','draft_opened','user_reported']
const first=states.map((state,n)=>item(n,state))
const text=()=>document.body.textContent
async function click(label){await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent===label).click())}
try{
 ({supabase}=await server.ssrLoadModule('/src/lib/supabase.ts'))
 supabase.rpc=async(name,params)=>{
  calls.push({name,params});assert.equal(name,'get_invoice_reminder_history')
  if(params.p_invoice==='slow')return new Promise(resolve=>{resolveSlow=resolve})
  if(fail)return {data:null,error:{message:'private provider credential must not be displayed'}}
  return {data:{invoice_id:params.p_invoice,items:params.p_before_id?[first.at(-1),item(99)]:first,has_more:!params.p_before_id,last_attempt:first[0],last_success:first[3]},error:null}
 }
 const {default:Component}=await server.ssrLoadModule('/src/components/InvoiceReminderHistory.tsx')
 const render=(invoiceId='invoice',businessId='business')=>act(async()=>root.render(React.createElement(Component,{businessId,invoiceId,timezone:'America/New_York'})))
 await render();assert.equal(calls.length,1);for(const label of ['Queued','Sending','Accepted by provider','Delivered','Failed','Bounced','Canceled','Suppressed','Uncertain','Draft opened','User-reported sent'])assert.ok(text().includes(label),label)
 assert.match(text(),/America\/New_York/);assert.match(text(),/synthetic@example.test/);assert.match(text(),/Initiated by: You/)
 await click('Load older reminders');assert.equal(calls.at(-1).params.p_before_id,first.at(-1).id);assert.equal(document.querySelectorAll('ol>li').length,12);assert.ok(!text().includes('Load older reminders'))
 fail=true;await click('Refresh reminder history');assert.match(text(),/history is unavailable/);assert.ok(!text().includes('credential'));assert.ok(!text().includes('No reminders recorded'))
 fail=false;await click('Retry reminder history');assert.equal(document.querySelectorAll('ol>li').length,11)
 await render('slow');assert.match(text(),/Loading reminder history/);assert.ok(!text().includes('synthetic@example.test'))
 await render('other','other-business');await act(async()=>resolveSlow({data:{invoice_id:'slow',items:[],has_more:false,last_attempt:null,last_success:null},error:null}));assert.equal(document.querySelectorAll('ol>li').length,11);assert.equal(calls.at(-1).params.p_business,'other-business')
 await act(async()=>root.render(null));await render();assert.equal(calls.at(-1).params.p_invoice,'invoice');assert.equal(document.querySelectorAll('ol>li').length,11)
 supabase.from=table=>{const result=table==='messages'?{data:null,error:{message:'Unavailable'}}:{data:table==='invoices'?{id:'invoice',job_id:null}:[],error:null};const chain={};for(const method of ['select','eq','single','order','limit'])chain[method]=()=>chain;chain.then=resolve=>Promise.resolve(result).then(resolve);return chain}
 const {getInvoiceDetail}=await server.ssrLoadModule('/src/services/invoiceDetail.ts');const detail=await getInvoiceDetail('business','invoice');assert.equal(detail.invoice.id,'invoice');assert.equal(detail.messagesUnavailable,true);assert.deepEqual(detail.messages,[])
 console.log('PASS: all statuses, local timezone, scoped recipient/initiator, paging/deduplication, error/retry, remount persistence and stale scope protection; read RPC only.')
}finally{await act(async()=>root.unmount());await supabase?.auth.stopAutoRefresh();await supabase?.removeAllChannels();await server.close();dom.window.close()}
process.exit(0)
