import assert from 'node:assert/strict'
import {JSDOM,VirtualConsole} from 'jsdom'
import {createServer} from 'vite'
process.env.VITE_SUPABASE_URL='https://test.supabase.co';process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test-key'
const dom=new JSDOM('<div id="root"></div>',{url:'https://finviant.test/',pretendToBeVisual:true,virtualConsole:new VirtualConsole()})
for(const key of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','Element','Node','Event','CustomEvent','MutationObserver','history','location','localStorage','sessionStorage'])globalThis[key]=key==='window'?dom.window:dom.window[key]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client'),root=createRoot(document.getElementById('root'))
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}})
let supabase,saved=0,readResolve,saveResolve
let state={mode:'inherit',after_days:2,repeat_days:7,max_reminders:3,master_enabled:false,defaults:{after_days:2,repeat_days:7,max_reminders:3}}
const text=()=>document.body.textContent
async function select(mode){await act(async()=>{const el=document.querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,mode);el.dispatchEvent(new Event('change',{bubbles:true}))})}
async function submit(){await act(async()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))}
try{
 ({supabase}=await server.ssrLoadModule('/src/lib/supabase.ts'))
 supabase.rpc=async(name,params)=>{
  if(name==='get_invoice_reminder_preference'){
   if(params.p_invoice==='slow')return await new Promise(resolve=>{readResolve=resolve})
   return {data:structuredClone(state),error:null}
  }
  assert.equal(name,'save_invoice_reminder_preference');saved++
  state={...state,mode:params.p_mode,after_days:params.p_after,repeat_days:params.p_repeat,max_reminders:params.p_max}
  return await new Promise(resolve=>{saveResolve=()=>resolve({data:structuredClone(state),error:null})})
 }
 const {default:Component}=await server.ssrLoadModule('/src/components/InvoiceReminderPreference.tsx')
 const render=async(invoiceId)=>await act(async()=>root.render(React.createElement(Component,{businessId:'business',invoiceId})))
 await render('invoice')
 assert.match(text(),/Default: 2 days after the due date, then every 7 days, up to 3 reminders/)
 assert.match(text(),/paused business-wide/);assert.equal(saved,0)
 await select('custom');assert.match(text(),/Saved preference: Use business defaults/);assert.deepEqual([...document.querySelectorAll('input[type=number]')].map(e=>e.value),['2','7','3']);assert.equal(saved,0)
 await act(async()=>{const form=document.querySelector('form');form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})
 assert.equal(saved,1);assert.equal(document.querySelector('button').disabled,true)
 await act(async()=>saveResolve());assert.match(text(),/No message was sent now/)
 await select('off');assert.equal(document.querySelectorAll('input').length,0);await submit();await act(async()=>saveResolve());assert.equal(state.mode,'off');assert.match(text(),/Saved preference: Off/);assert.equal(saved,2)
 await render('slow');assert.match(text(),/Loading reminder settings/)
 state={...state,mode:'custom',after_days:9,repeat_days:10,max_reminders:4}
 await render('new-invoice');assert.deepEqual([...document.querySelectorAll('input')].map(e=>e.value),['9','10','4'])
 await act(async()=>readResolve({data:{...state,mode:'off'},error:null}));assert.equal(document.querySelector('select').value,'custom')
 console.log('PASS: invoice inheritance, custom timing, off, no auto-save/send, explicit save deduplication, preserved custom timing, stale-read protection.')
}finally{await act(async()=>root.unmount());await supabase?.auth.stopAutoRefresh();await supabase?.removeAllChannels();await server.close();dom.window.close()}
process.exit(0)
