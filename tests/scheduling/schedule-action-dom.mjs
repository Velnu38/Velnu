import assert from 'node:assert/strict'
import {JSDOM,VirtualConsole} from 'jsdom'
import {createServer} from 'vite'
process.env.VITE_SUPABASE_URL='https://test.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test-key'
const dom=new JSDOM('<div id="root"></div>',{url:'https://finviant.test/?view=schedule',pretendToBeVisual:true,virtualConsole:new VirtualConsole()})
for(const key of ['window','document','HTMLElement','HTMLInputElement','Element','Node','Event','CustomEvent','MutationObserver','history','location','localStorage','sessionStorage'])globalThis[key]=key==='window'?dom.window:dom.window[key]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
let confirmations=0;window.confirm=()=>{confirmations++;return true}
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client')
const root=createRoot(document.getElementById('root')),server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}})
const b='11111111-1111-4111-8111-111111111111',job='22222222-2222-4222-8222-222222222222'
const starts=new Date(Date.now()+86400000).toISOString(),ends=new Date(Date.now()+90000000).toISOString()
let records=[{id:'active',title:'Linked work',starts_at:starts,ends_at:ends,status:'confirmed',customers:[],jobs:[{id:job,title:'Linked work',status:'scheduled',properties:[]}]},{id:'standalone',title:'Office visit',starts_at:starts,ends_at:ends,status:'scheduled',customers:[],jobs:[]}]
const calls=[];let directWrites=0,supabase
const tick=()=>act(()=>new Promise(resolve=>setTimeout(resolve,45)))
const findButton=name=>[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===name)
try{
 ;({supabase}=await server.ssrLoadModule('/src/lib/supabase.ts'))
 const channel={on(){return channel},subscribe(){return channel}}
 supabase.channel=()=>channel;supabase.removeChannel=async()=>{}
 supabase.from=table=>{assert.equal(table,'appointments');const q={select(){return q},eq(){return q},neq(){return q},order(){return q},gte(){return q},lte(){return q},lt(){return q},update(){directWrites++;throw new Error('Direct appointment writes bypass job completion')},then(resolve){return Promise.resolve({data:structuredClone(records),error:null}).then(resolve)}};return q}
 supabase.rpc=async(name,args)=>{calls.push({name,args});assert.equal(name,'update_appointment_workflow');const record=records.find(row=>row.id===args.p_appointment);record.status=args.p_status;if(record.jobs.length)record.jobs[0].status=args.p_status;return{data:{job_id:record.jobs[0]?.id,invoice_id:'invoice',invoice_ready:true,invoice_status:'draft',needs_pricing:false},error:null}}
 const {default:Schedule}=await server.ssrLoadModule('/src/pages/SchedulePage.tsx')
 const business={id:b,name:'Test business',role:'owner',timezone:'America/New_York',primary_owner:true,access_modules:['jobs','calendar','billing','finances']}
 await act(async()=>root.render(React.createElement(Schedule,{business})));await tick()
 assert.equal(document.querySelectorAll('select').length,1,'only standalone events retain an attendance selector')
 assert.ok(findButton('Start job'));assert.ok(findButton('Book or reschedule job'))
 await act(async()=>findButton('Start job').click());await tick()
 assert.equal(calls.at(-1).args.p_status,'in_progress');assert.ok(findButton('Mark complete'))
 await act(async()=>findButton('Mark complete').click());await tick()
 assert.equal(confirmations,1);assert.equal(calls.at(-1).args.p_status,'completed');assert.match(document.body.textContent,/invoice draft is ready/i);assert.equal(findButton('Mark complete'),undefined)
 const standalone=document.querySelector('select');standalone.value='confirmed';await act(async()=>standalone.dispatchEvent(new Event('change',{bubbles:true})));await tick()
 assert.equal(calls.at(-1).args.p_appointment,'standalone');assert.equal(calls.at(-1).args.p_status,'confirmed');assert.equal(directWrites,0)
 console.log('PASS: Calendar linked work uses one job lifecycle and actual invoice handoff; closed work has no duplicate action; standalone attendance and confirmation are preserved')
}finally{await act(async()=>root.unmount());await supabase?.auth.stopAutoRefresh();await supabase?.removeAllChannels();await server.close();dom.window.close()}
process.exit(0)
