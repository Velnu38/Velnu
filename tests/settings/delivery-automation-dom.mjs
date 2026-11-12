import assert from 'node:assert/strict'
import {JSDOM,VirtualConsole} from 'jsdom'
import {createServer} from 'vite'
process.env.VITE_SUPABASE_URL='https://test.supabase.co';process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test-key'
const dom=new JSDOM('<div id="root"></div>',{url:'https://finviant.test/',pretendToBeVisual:true,virtualConsole:new VirtualConsole()})
for(const key of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','Element','Node','Event','CustomEvent','MutationObserver','history','location','localStorage','sessionStorage'])globalThis[key]=key==='window'?dom.window:dom.window[key]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client'),root=createRoot(document.getElementById('root'))
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}})
let supabase,calls=[],readResolve,saveResolve
let state={plan:'pro',ready:true,rule:{enabled:false,after_days:2,repeat_days:7,max_reminders:3},tasks:[]}
const text=()=>document.body.textContent
const submit=()=>act(async()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
try{
 ({supabase}=await server.ssrLoadModule('/src/lib/supabase.ts'))
 supabase.rpc=async(name,params)=>{
  calls.push({name,params})
  if(name==='get_delivery_automation'){
   if(params.p_business==='slow')return new Promise(resolve=>{readResolve=resolve})
   return {data:structuredClone(state),error:null}
  }
  assert.equal(name,'save_reminder_rule')
  return new Promise(resolve=>{saveResolve=resolve})
 }
 const {default:Component}=await server.ssrLoadModule('/src/components/settings/DeliveryAutomation.tsx')
 const render=businessId=>act(async()=>root.render(React.createElement(Component,{businessId})))
 await render('fresh');assert.equal(calls.length,1);assert.match(text(),/Saved business rule: Paused.*Email only.*2 days overdue, every 7 days, maximum 3/)
 assert.equal(document.querySelector('input[type=checkbox]').checked,false)
 await act(async()=>document.querySelector('input[type=checkbox]').click());assert.match(text(),/Saved business rule: Paused/)
 await act(async()=>{const f=document.querySelector('form');f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})
 assert.equal(calls.filter(c=>c.name==='save_reminder_rule').length,1)
 const oldSave=saveResolve
 state={...state,rule:{enabled:false,after_days:6,repeat_days:10,max_reminders:2}}
 await render('other');assert.match(text(),/6 days overdue, every 10 days, maximum 2/)
 await act(async()=>oldSave({data:{...state,rule:{enabled:true,after_days:2,repeat_days:7,max_reminders:3}},error:null}))
 assert.match(text(),/Saved business rule: Paused.*6 days overdue/);assert.equal(document.querySelector('input[type=checkbox]').checked,false)
 await submit();assert.equal(calls.at(-1).params.p_business,'other');assert.equal(calls.at(-1).params.p_enabled,false)
 await act(async()=>saveResolve({data:structuredClone(state),error:null}));assert.match(text(),/emails paused/)
 await render('slow');assert.match(text(),/Loading customer reminder defaults/);assert.doesNotMatch(text(),/6 days overdue/)
 state={...state,rule:{enabled:true,after_days:4,repeat_days:8,max_reminders:4}};await render('latest')
 await act(async()=>readResolve({data:{...state,rule:{enabled:false,after_days:2,repeat_days:7,max_reminders:3}},error:null}))
 assert.match(text(),/Saved business rule: Enabled.*4 days overdue, every 8 days, maximum 4/)
 console.log('PASS: saved versus edited defaults, disabled fresh rule, preserved custom rule, duplicate save and stale business read/save protection; no send RPC.')
}finally{await act(async()=>root.unmount());await supabase?.auth.stopAutoRefresh();await supabase?.removeAllChannels();await server.close();dom.window.close()}
process.exit(0)
