import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {createServer} from 'vite'
process.env.VITE_SUPABASE_URL='https://test.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test-key'
const dom=new JSDOM('<div id="root"></div>',{url:'https://finviant.test/',pretendToBeVisual:true})
for(const name of ['window','document','HTMLElement','Element','Node','Event','CustomEvent','MutationObserver','localStorage','sessionStorage'])globalThis[name]=name==='window'?dom.window:dom.window[name]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client')
const root=createRoot(document.getElementById('root'))
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}})
const B='11111111-1111-4111-8111-111111111111'
const business={id:B,name:'Fixture',role:'owner',primary_owner:true,access_modules:['finances'],timezone:'UTC'}
const row={id:'expense-1',entry_date:new Date().toISOString().slice(0,10),direction:'expense',amount:49,currency:'USD',category:'Materials',description:'Supply Store',record_photos:[{storage_path:B+'/receipt.jpg'}]}
let hold=false,fail=false,releases=[],supabase
const query=load=>{const q=new Proxy({},{get:(_,key)=>key==='then'?(resolve,reject)=>Promise.resolve().then(load).then(resolve,reject):()=>q});return q}
const tick=()=>act(()=>new Promise(resolve=>setTimeout(resolve,20)))
try{
 ;({supabase}=await server.ssrLoadModule('/src/lib/supabase.ts'))
 supabase.auth.getSession=async()=>({data:{session:null},error:null})
 supabase.channel=()=>{const channel={on:()=>channel,subscribe:()=>channel};return channel}
 supabase.removeChannel=async()=>{}
 supabase.rpc=name=>query(()=>({data:name==='get_plan_usage'?{plan:'basic',financial_history:true}:[],error:null,count:0}))
 supabase.from=table=>query(async()=>{
  if(table!=='bookkeeping_entries')return {data:[],error:null,count:0}
  if(hold)await new Promise(resolve=>releases.push(resolve))
  return fail?{data:null,error:{message:'Read unavailable'}}:{data:[row],error:null,count:1}
 })
 const {default:Financial}=await server.ssrLoadModule('/src/components/FinancialPerformance.tsx')
 const render=async(version,scope=business)=>{await act(async()=>root.render(React.createElement(Financial,{business:scope,refreshVersion:version,compact:true})));await tick()}
 await render(0);await tick()
 const metric=document.querySelector('.performance-metric.expense')
 assert.match(metric.textContent,/49\.00/)
 await act(async()=>metric.click())
 const transaction=document.querySelector('.transaction-list>li'),receipt=transaction.querySelector('details')
 receipt.open=true
 hold=true;await render(1)
 assert.match(document.body.textContent,/Refreshing financial transactions\. Showing the last successful update/)
 assert.equal(metric.disabled,false,'a background refresh cannot swallow the metric click')
 assert.equal(document.querySelector('.transaction-list>li'),transaction,'refresh preserves the open transaction')
 assert.equal(document.querySelector('.receipt-link'),receipt)
 assert.equal(receipt.open,true,'refresh preserves an expanded receipt')
 await act(async()=>{releases.splice(0).forEach(resolve=>resolve())});await tick()
 fail=true;await render(2)
 await act(async()=>{releases.splice(0).forEach(resolve=>resolve())});await tick()
 assert.match(document.body.textContent,/Read unavailable/)
 assert.equal(document.querySelector('.transaction-list'),null,'failed reads hide stale transactions')
 assert.equal(metric.disabled,true)
 assert.doesNotMatch(document.querySelector('.performance-metrics').textContent,/49\.00|\$0\.00/)
 fail=false;hold=false;await render(3);await tick()
 hold=true;await render(4,{...business,id:'22222222-2222-4222-8222-222222222222'})
 assert.doesNotMatch(document.querySelector('.performance-metrics').textContent,/49\.00/,'workspace changes never reuse prior balances')
 assert.equal(document.querySelector('.transaction-list'),null)
 await act(async()=>{releases.splice(0).forEach(resolve=>resolve())});await tick()
 console.log('PASS: stable financial controls and receipt state during refresh; failed and different-workspace reads hide prior balances.')
}finally{await act(async()=>root.unmount());await supabase?.auth.stopAutoRefresh();await supabase?.removeAllChannels();await server.close();dom.window.close()}
process.exit(0)
