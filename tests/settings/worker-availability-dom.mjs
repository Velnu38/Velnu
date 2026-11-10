import assert from 'node:assert/strict'
import {JSDOM,VirtualConsole} from 'jsdom'
import {createServer} from 'vite'
process.env.VITE_SUPABASE_URL='https://test.supabase.co';process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test-key'
const dom=new JSDOM('<div id="root"></div>',{url:'https://finviant.test/',pretendToBeVisual:true,virtualConsole:new VirtualConsole()})
for(const key of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','Element','Node','Event','CustomEvent','MutationObserver','history','location','localStorage','sessionStorage'])globalThis[key]=key==='window'?dom.window:dom.window[key]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true
let confirm=true;window.confirm=()=>confirm;window.alert=()=>{}
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client'),root=createRoot(document.getElementById('root'))
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}})
let supabase,calls=[],plan='basic',failRead=false,holdLeave=null,leaveResolve,staleWorker=false
let workers=[{id:'owner',name:'Owner',trade:'Owner',active:true,is_owner:true,use_business_hours:true,work_days:[1,2,3,4,5],start_minutes:480,end_minutes:1020,updated_at:'v1'},{id:'alex',name:'Alex',trade:'Painter',active:true,is_owner:false,use_business_hours:false,work_days:[1,2,3,4,5],start_minutes:600,end_minutes:1440,updated_at:'v1'}]
let prefs={work_days:[1,2,3,4,5],start_minutes:480,end_minutes:1440,duration_minutes:60,buffer_minutes:30,notice_hours:24},timeOff=[]
const business={id:'business',name:'Synthetic Business',timezone:'America/New_York',role:'owner',primary_owner:true,access_modules:['calendar','jobs']}
const tick=async()=>act(()=>new Promise(r=>setTimeout(r,20)))
const button=(label)=>[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===label)
const field=(label)=>[...document.querySelectorAll('label')].find(e=>e.firstChild?.textContent.trim()===label)?.querySelector('input,select')
async function set(el,value){assert.ok(el,'input exists');await act(async()=>{Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));if(el.tagName!=='SELECT')el.dispatchEvent(new Event('change',{bubbles:true}))});await tick()}
async function click(label){const el=button(label);assert.ok(el,`${label} exists`);assert.equal(el.disabled,false);await act(async()=>el.click());await tick()}
async function submit(form){await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));await tick()}
try{
 ({supabase}=await server.ssrLoadModule('/src/lib/supabase.ts'))
 supabase.rpc=async(name,args)=>{
  calls.push({name,args})
  if(name==='get_worker_roster')return {data:{workers:structuredClone(workers),plan,worker_limit:5,active_count:workers.length},error:failRead?{message:'Availability unavailable'}:null}
  if(name==='get_scheduling_context')return {data:{preferences:structuredClone(prefs),team:workers.map(w=>({id:w.id,label:w.name,is_you:w.is_owner,active:true})),time_off:structuredClone(timeOff)},error:null}
  if(name==='manage_worker_time_off'){
   if(holdLeave)await new Promise(r=>{leaveResolve=r})
   if(args.p_remove)timeOff=timeOff.filter(t=>t.id!==args.p_remove)
   else timeOff.push({id:'leave'+timeOff.length,user_id:args.p_worker,starts_at:args.p_start,ends_at:args.p_end,note:args.p_note})
   return {data:null,error:null}
  }
  if(name==='save_worker_profile'){
   if(staleWorker||args.p_expected!==workers.find(w=>w.id===args.p_id).updated_at)return {data:null,error:{message:'This worker changed. Reload Team Management before saving.'}}
   workers=workers.map(w=>w.id===args.p_id?{...w,...args.p_input,updated_at:'v2'}:w);return {data:null,error:null}
  }
  if(name==='save_scheduling_preferences'){prefs=structuredClone(args.p_input);return {data:null,error:null}}
  throw Error(name)
 }
 const {default:Component}=await server.ssrLoadModule('/src/components/scheduling/SchedulingSettings.tsx')
 let mountKey=0;async function mount(){await act(async()=>root.render(React.createElement(Component,{business,key:++mountKey})));await tick()}
 await mount();assert.match(document.body.textContent,/Team at a glance/);assert.equal(document.querySelectorAll('.team-availability-summary li').length,2)
 assert.match(document.body.textContent,/not attendance or open booking slots/);assert.equal(calls.filter(c=>c.name.startsWith('save_')||c.name==='manage_worker_time_off').length,0)
 // Navigation stays within API coverage and remains keyboard-native controls.
 for(let i=0;i<7;i++)await click('Next week');assert.equal(button('Next week').disabled,true);await click('Today')
 await set(document.querySelector('.availability-worker-picker select'),'alex');assert.match(document.body.textContent,/Alex: normal hours/)
 await click('Edit Alex hours');assert.equal(field('Ends').value,'00:00');assert.match(document.body.textContent,/Ends at midnight/)
 await set(field('Starts'),'11:00');confirm=false;await set(document.querySelector('.availability-worker-picker select'),'owner');assert.equal(document.querySelector('.availability-worker-picker select').value,'alex');confirm=true
 // Failed refresh hides stale calendars but preserves dirty child editor state.
 failRead=true;await click('Refresh availability');assert.equal(document.querySelector('.availability-days'),null);assert.equal(field('Starts').value,'11:00');failRead=false;await click('Retry availability');assert.equal(field('Starts').value,'11:00')
 workers=workers.map(w=>w.id==='alex'?{...w,active:false}:w);await click('Refresh availability');assert.match(document.body.textContent,/unsaved drafts are preserved/);assert.equal(field('Starts').value,'11:00');workers=workers.map(w=>({...w,active:true}));await click('Retry availability')
 // Refresh discovers external updates without throwing away a dirty worker draft/version.
 workers=workers.map(w=>w.id==='alex'?{...w,updated_at:'external',start_minutes:420}:w);await click('Refresh availability');assert.equal(field('Starts').value,'11:00')
 await submit(field('Starts').closest('form'));assert.match(document.body.textContent,/This worker changed/);assert.equal(calls.filter(c=>c.name==='save_worker_profile').at(-1).args.p_expected,'v1')
 await click('Cancel');await click('Edit Alex hours');assert.equal(field('Starts').value,'07:00');await set(field('Starts'),'09:00');await submit(field('Starts').closest('form'));assert.match(document.body.textContent,/Worker hours saved/)
 // A pristine business form follows refreshed server defaults.
 prefs={...prefs,start_minutes:500};await click('Refresh availability');assert.equal(field('Work starts').value,'08:20')
 // Keep a business-hours draft while creating and removing an exception.
 await set(field('Work starts'),'09:30');assert.equal(field('Work ends').value,'00:00')
 await set(field('Full day'),'2026-03-08');await click('Use full day');assert.equal(field('From').value,'2026-03-08T00:00');assert.equal(field('Until').value,'2026-03-09T00:00')
 holdLeave=true;const form=field('From').closest('form');await act(async()=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))});assert.equal(calls.filter(c=>c.name==='manage_worker_time_off').length,1)
 await act(async()=>leaveResolve());holdLeave=null;await tick();assert.equal(field('Work starts').value,'09:30');assert.equal(document.querySelector('.availability-worker-picker select').value,'alex')
 const saved=calls.find(c=>c.name==='manage_worker_time_off').args;assert.equal(saved.p_worker,'alex');assert.equal((Date.parse(saved.p_end)-Date.parse(saved.p_start))/3600000,23)
 await click('Remove');assert.equal(field('Work starts').value,'09:30')
 await submit(field('Work starts').closest('form'));assert.equal(prefs.start_minutes,570);assert.equal(prefs.end_minutes,1440)
 // A read failure hides calendars instead of advertising old information.
 failRead=true;await click('Refresh availability');assert.match(document.body.textContent,/Availability unavailable/);assert.equal(document.querySelector('.availability-days'),null);failRead=false;await click('Retry availability')
 // Free retains only the owner's profile and no writes happen automatically.
 plan='free';await mount();assert.equal(document.querySelectorAll('.availability-worker-picker option').length,1);assert.equal(document.querySelectorAll('.team-availability-summary li').length,1)
 console.log('PASS: worker summary/selection, horizon bounds, midnight, guarded switching, stale worker edits, preserved business drafts on leave writes, DST all-day/dedup, error recovery and free owner-only filtering.')
}finally{await act(async()=>root.unmount());await supabase?.auth.stopAutoRefresh();await supabase?.removeAllChannels();await server.close();dom.window.close()}
process.exit(0)
