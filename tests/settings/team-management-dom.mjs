import assert from 'node:assert/strict'
import {JSDOM,VirtualConsole} from 'jsdom'
import {createServer} from 'vite'
process.env.VITE_SUPABASE_URL='https://test.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test-key'
const dom=new JSDOM('<div id="root"></div>',{url:'https://finviant.test/?view=settings&section=team',pretendToBeVisual:true,virtualConsole:new VirtualConsole()})
for(const k of ['window','document','HTMLElement','HTMLInputElement','Element','Node','Event','CustomEvent','MutationObserver','history','location','localStorage','sessionStorage'])globalThis[k]=k==='window'?dom.window:dom.window[k]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client')
const root=createRoot(document.getElementById('root')),server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}})
const business={id:'business',name:'Test business',primary_owner:true,role:'owner',timezone:'America/New_York',access_modules:['calendar','jobs','billing','finances']}
let plan='basic',workers=[{id:'owner',name:'Owner',trade:'Owner / operator',active:true,is_owner:true,use_business_hours:true,work_days:[1,2,3,4,5],start_minutes:480,end_minutes:1020,updated_at:'2026-11-08T12:00:00Z'}]
const calls=[]
const tick=()=>act(()=>new Promise(r=>setTimeout(r,30))),button=name=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===name)
async function click(name){assert.ok(button(name),name);await act(async()=>button(name).click());await tick()}
try{
 const {supabase}=await server.ssrLoadModule('/src/lib/supabase.ts')
 supabase.rpc=async(name,args)=>{calls.push({name,args});let data
  if(name==='get_plan_usage')data={plan}
  else if(name==='get_worker_roster')data={plan,workers:structuredClone(workers),active_count:workers.filter(w=>w.active).length,worker_limit:plan==='pro'?25:plan==='basic'?5:1}
  else if(name==='save_worker_profile'){workers.push({...args.p_input,id:args.p_id,is_owner:false,updated_at:'2026-11-08T13:00:00Z'});data=null}
  else if(name==='get_scheduling_context')data={preferences:{work_days:[1,2,3,4,5],start_minutes:480,end_minutes:1020,duration_minutes:120,buffer_minutes:30,notice_hours:24},team:workers.map(w=>({id:w.id,label:w.name,is_you:w.id==='owner'})),time_off:[]}
  else if(name==='get_team_settings')data={seat_limit:5,pro:true,members:[{user_id:'owner',email:'owner@example.test',role:'owner',primary_owner:true,access_modules:[]}],invitations:[]}
  else throw Error('Unexpected RPC '+name)
  return{data,error:null}
 }
 const {default:Team}=await server.ssrLoadModule('/src/components/settings/TeamManagement.tsx')
 async function mount(key,props={}){await act(async()=>root.render(React.createElement(Team,{key,business,...props})));await tick();await tick()}
 await mount('individual');assert.match(document.body.textContent,/1 of 5 active workers/)
 await click('Add worker')
 const input=[...document.querySelectorAll('label')].find(l=>l.textContent==='Name').querySelector('input')
 await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,'Alex Morgan');input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));input.dispatchEvent(new dom.window.Event('change',{bubbles:true}))});await tick()
 await act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));await tick();await tick()
 assert.match(document.body.textContent,/Alex Morgan/);assert.match(document.body.textContent,/2 of 5 active workers/)
 assert.equal(calls.filter(c=>c.name==='save_worker_profile').length,1)
 await click('Availability');assert.ok(button('Block time'));assert.equal(document.querySelectorAll('select option').length,2)
 await click('Account Access');assert.match(document.body.textContent,/one account user/);assert.equal(button('Send invitation'),undefined)
 assert.ok([...document.querySelectorAll('a')].some(a=>a.textContent==='Explore Business Pro'&&a.getAttribute('href')==='/?view=settings&section=plans&tier=pro'))
 plan='pro';await mount('pro');assert.match(document.body.textContent,/2 of 25 active workers/);await click('Account Access');assert.match(document.body.textContent,/1 of 5 seats/);assert.ok(button('Send invitation'))
 plan='free';workers=workers.slice(0,1);await mount('free');assert.match(document.body.textContent,/1 of 1 active workers/);assert.equal(button('Add worker').disabled,true)
 await mount('office',{business:{...business,primary_owner:false,role:'office'}});assert.equal(button('Account Access'),undefined)
 await mount('legacy',{initialAvailability:true});assert.ok(button('Block time'))
 assert.ok(!calls.some(c=>/invite|send|remove|manage_team/.test(c.name)),'UI review creates no invitations or messages')
 console.log('Team Management: worker creation, availability, tier allowances, separate account seats, delegated access and legacy links passed.')
}finally{await act(async()=>root.unmount());const {supabase}=await server.ssrLoadModule('/src/lib/supabase.ts');await supabase.auth.stopAutoRefresh();await supabase.removeAllChannels();await server.close();dom.window.close()}
process.exit(0)
