import {JSDOM,VirtualConsole} from 'jsdom'
import {createServer} from 'vite'
import assert from 'node:assert/strict'
process.env.VITE_SUPABASE_URL='https://test.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test-key'
process.env.VITE_ENABLE_CUSTOMER_ACTIONS='false'
process.env.VITE_ENABLE_PRIVATE_BETA_EMAIL='true'
const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'https://finviant.test/?booking='+('a'.repeat(64)),pretendToBeVisual:true,virtualConsole:new VirtualConsole()})
for(const key of ['window','document','HTMLElement','HTMLInputElement','Element','Node','Event','CustomEvent','MouseEvent','MutationObserver','HTMLDialogElement','history','location','localStorage','sessionStorage'])globalThis[key]=key==='window'?dom.window:dom.window[key]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
let visibility='visible'
Object.defineProperty(document,'visibilityState',{get:()=>visibility,configurable:true})
HTMLDialogElement.prototype.showModal=function(){this.open=true};HTMLDialogElement.prototype.close=function(){this.open=false}
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client')
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}})
const root=createRoot(document.getElementById('root'))
const T='a'.repeat(64),S1='11111111-1111-4111-8111-111111111111',S2='22222222-2222-4222-8222-222222222222'
const slots=[{id:S1,starts_at:'2040-03-12T13:00:00Z',ends_at:'2040-03-12T15:00:00Z'},{id:S2,starts_at:'2040-03-13T14:00:00Z',ends_at:'2040-03-13T16:00:00Z'}]
const base=()=>({business_name:'Barone Test Services',business_phone:'+17575550100',title:'Approved landscape service',timezone:'America/New_York',note:'We look forward to taking care of your property.',address:'123 Test Lane',status:'approved',can_book:true,expires_at:'2040-03-20T23:59:00Z',slots:structuredClone(slots),confirmed:null,booking_reference:'TEST1234',estimate_number:'EST-TEST'})
let view=base(),outcome='success',viewFailure=false,confirmationRelease=null,calls=[],downloads=[],objectUrls=new Map(),n=0,sent=[]
const realCreate=URL.createObjectURL,realRevoke=URL.revokeObjectURL
URL.createObjectURL=blob=>{const url='blob:https://finviant.test/'+(++n);objectUrls.set(url,blob);return url};URL.revokeObjectURL=url=>objectUrls.delete(url)
dom.window.HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push(objectUrls.get(this.href))}
globalThis.fetch=async(url,options)=>{
 if(String(url).endsWith('/functions/v1/work-scheduling')){sent.push({name:'work-scheduling',body:JSON.parse(options.body)});return new Response(JSON.stringify({status:'sent'}),{headers:{'Content-Type':'application/json'}})}
 assert.match(String(url),/\/rest\/v1\/rpc\/customer_schedule_offer$/)
 const input=JSON.parse(options.body),authorization=new Headers(options.headers).get('authorization')
 calls.push(input);assert.equal(authorization,'Bearer test-key','a customer invitation never carries a staff session')
 if(input.p_slot){
  if(outcome==='deferred')await new Promise(resolve=>{confirmationRelease=resolve})
  if(outcome==='conflict'){view.slots=structuredClone([slots[1]]);return new Response(JSON.stringify({message:'That time is no longer available.',code:'P0001'}),{status:409,headers:{'Content-Type':'application/json'}})}
  view={...view,status:'booked',can_book:false,slots:[],confirmed:{...slots.find(slot=>slot.id===input.p_slot),status:'scheduled'}}
  if(outcome==='lost-response')return new Response(JSON.stringify({message:'Connection lost after confirmation',code:'unknown'}),{status:502,headers:{'Content-Type':'application/json'}})
 }else if(viewFailure)throw new Error('Network unavailable')
 return new Response(JSON.stringify(view),{headers:{'Content-Type':'application/json'}})
}
const tick=()=>act(()=>new Promise(resolve=>setTimeout(resolve,40)))
const button=name=>[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===name)
const mount=async(key)=>{await act(async()=>root.render(React.createElement(Page,{key,token:T})));await tick()}
const click=async name=>{const el=button(name);assert.ok(el,`${name} exists`);assert.equal(el.disabled,false,`${name} enabled`);await act(async()=>el.click());await tick()}
async function choose(id){const el=document.querySelector(`input[name="customer-slot"][value="${id}"]`);assert.ok(el);await act(async()=>el.click());await tick()}
async function fullName(value){const el=[...document.querySelectorAll('input')].find(el=>el.autocomplete==='name');assert.ok(el);await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))});await tick()}
let Page,supabase
try{
 ;({supabase}=await server.ssrLoadModule('/src/lib/supabase.ts'))
 supabase.auth.getSession=async()=>({data:{session:{access_token:'staff-token-must-not-be-sent',user:{id:'staff'}}},error:null})
 ;({default:Page}=await server.ssrLoadModule('/src/pages/CustomerBookingPage.tsx'))
 await mount('professional')
 assert.match(document.body.textContent,/Barone Test Services/)
 assert.match(document.body.textContent,/123 Test Lane/)
 assert.match(document.body.textContent,/EST-TEST/)
 assert.match(document.body.textContent,/America\/New York/)
 assert.equal(document.querySelectorAll('input[name=customer-slot]').length,2)
 assert.match(document.querySelector('input[name=customer-slot]').closest('label').textContent,/9:00 AM–11:00 AM/,'DST uses the business appointment timezone')
 assert.equal(button('Confirm appointment').disabled,true)
 await choose(S1);await fullName('Alex Customer')
 assert.equal(button('Confirm appointment').disabled,false)
 const zoneToggle=[...document.querySelectorAll('input[type=checkbox]')][0]
 if(zoneToggle){await act(async()=>zoneToggle.click());await tick();assert.match(document.querySelector('input[name=customer-slot]').closest('label').textContent,/1:00 PM–3:00 PM/)}
 view.slots=[structuredClone(slots[1])]
 await act(async()=>window.dispatchEvent(new Event('focus')));await tick()
 assert.match(document.body.textContent,/no longer available/)
 assert.equal(document.querySelector('input[name=customer-slot]:checked'),null)
 assert.equal(document.querySelector('input[autocomplete=name]').value,'Alex Customer','background updates preserve name entry')
 assert.equal(button('Confirm appointment').disabled,true)

 view=base();outcome='conflict';calls=[];await mount('conflict')
 await choose(S1);await fullName('Alex Customer');await click('Confirm appointment')
 assert.match(document.querySelector('[role=alert]').textContent,/just taken/)
 assert.equal(document.querySelectorAll('input[name=customer-slot]').length,1)
 assert.equal(document.querySelector('input[autocomplete=name]').value,'Alex Customer')
 assert.equal(document.querySelector('input[name=customer-slot]:checked'),null)
 assert.equal(calls.filter(call=>call.p_slot).length,1)

 view=base();outcome='deferred';calls=[];await mount('dedup')
 await choose(S1);await fullName('Alex Customer')
 await act(async()=>{button('Confirm appointment').click();button('Confirm appointment')?.click()});await tick()
 assert.equal(calls.filter(call=>call.p_slot).length,1,'double clicks submit one booking')
 assert.ok(confirmationRelease)
 await act(async()=>confirmationRelease());await tick()
 assert.match(document.body.textContent,/Your appointment is confirmed/)
 assert.match(document.body.textContent,/TEST1234/)
 assert.equal(document.querySelectorAll('input[name=customer-slot]').length,0)
 await click('Add to my calendar');await click('Add to my calendar')
 assert.equal(downloads.length,2)
 const calendar1=await downloads[0].text(),calendar2=await downloads[1].text()
 assert.match(calendar1,/DTSTART:20400312T130000Z/)
 assert.equal(calendar1.match(/UID:[^\r]+/)[0],calendar2.match(/UID:[^\r]+/)[0],'calendar exports reuse a stable appointment UID')
 assert.ok(!calendar1.includes(T),'a private scheduling token never enters the calendar file')

 view=base();outcome='lost-response';calls=[];await mount('reconcile')
 await choose(S2);await fullName('Alex Customer');await click('Confirm appointment')
 assert.match(document.body.textContent,/Your appointment is confirmed/,'a lost confirmation response reconciles from the server receipt')
 assert.equal(document.querySelector('[role=alert]'),null)
 assert.equal(calls.filter(call=>call.p_slot).length,1)

 view=base();outcome='deferred';await mount('token-switch')
 await choose(S1);await fullName('Alex Customer')
 await act(async()=>button('Confirm appointment').click());await tick()
 const releaseOld=confirmationRelease
 view={...base(),title:'A different private invitation'}
 await act(async()=>root.render(React.createElement(Page,{key:'token-switch',token:'b'.repeat(64)})));await tick()
 await act(async()=>releaseOld());await tick()
 assert.match(document.body.textContent,/A different private invitation/)
 assert.doesNotMatch(document.body.textContent,/Your appointment is confirmed/,'an old response cannot confirm a different invitation')

 outcome='success'
 for(const state of ['expired','paused','revoked','canceled','unavailable']){
  view={...base(),status:state,can_book:false,slots:[],status_reason:'Contact the business for a new appointment invitation.'}
  await mount(state)
  assert.equal(document.querySelectorAll('input[name=customer-slot]').length,0)
  assert.equal(button('Confirm appointment'),undefined)
  assert.match(document.body.textContent,/Contact the business/)
 }
 view={...base(),status:'booked',slots:[],confirmed:{...slots[0],status:'canceled'}}
 await mount('appointment-canceled')
 assert.doesNotMatch(document.body.textContent,/Your appointment is confirmed|You’re booked/)
 assert.equal(button('Add to my calendar'),undefined)

 view=base();viewFailure=true;await mount('network-retry')
 assert.match(document.body.textContent,/couldn’t open/)
 viewFailure=false;await click('Try again')
 assert.equal(document.querySelectorAll('input[name=customer-slot]').length,2)

 const flags=await server.ssrLoadModule('/src/lib/releaseFlags.ts')
 assert.equal(flags.customerActionsEnabled,false,'the general customer/SMS release stays disabled')
 assert.equal(flags.customerSchedulingEnabled,true,'only the registered beta scheduling lane is opened')
 let plan='basic',ownerCalls=[]
 const business={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'Barone Test Services',role:'owner',primary_owner:true,timezone:'America/New_York'}
 const context={preferences:{work_days:[1,2,3,4,5],start_minutes:480,end_minutes:1020,duration_minutes:120,buffer_minutes:30,notice_hours:1},team:[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',label:'Owner',role:'owner',is_you:true}],time_off:[],properties:[{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',label:'Home',address:'123 Test Lane'}],estimate:{id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',number:'EST-TEST',customer_id:'ffffffff-ffff-4fff-8fff-ffffffffffff',job_id:null,property_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',title:'Landscape visit',scope:'Approved customer scope',customer_name:'Alex Customer',customer_email:'approved-beta@example.test'}}
 supabase.rpc=async(name,args)=>{
  ownerCalls.push({name,args})
  if(name==='get_plan_usage')return {data:{plan,jobs_limit:null,jobs_used:0},error:null}
  if(name==='get_scheduling_context')return {data:structuredClone(context),error:null}
  if(name==='suggest_scheduling_slots')return {data:structuredClone(slots),error:null}
  if(name==='get_schedule_team')return {data:structuredClone(context.team),error:null}
  if(name==='approve_scheduling_offer')return {data:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',expires_at:'2040-03-20T23:59:00Z',status:'approved'},error:null}
  throw new Error('Unexpected owner RPC: '+name)
 }
 const {default:Owner}=await server.ssrLoadModule('/src/components/scheduling/ScheduleEstimateDialog.tsx')
 const mountOwner=async key=>{await act(async()=>root.render(React.createElement(Owner,{key,business,estimateId:context.estimate.id,initialMode:'offer',onClose:()=>{}})));await act(()=>new Promise(resolve=>setTimeout(resolve,400)))}
 await mountOwner('basic-owner')
 assert.equal(button('Send booking link'),undefined,'lower tiers cannot issue customer self-booking invitations')
 assert.match(document.body.textContent,/Customer self-booking.*Business Pro/s)
 assert.equal(ownerCalls.filter(call=>call.name==='approve_scheduling_offer').length,0)
 plan='pro';await mountOwner('pro-owner')
 assert.ok(button('Send booking link'))
 assert.equal(button('Approve & email customer').disabled,true,'an owner must explicitly approve the scope and times')
 assert.equal(sent.length,0,'reviewing availability sends nothing')
 const approval=document.querySelector('.guided-approval input');assert.ok(approval)
 await act(async()=>approval.click());await tick()
 assert.equal(button('Approve & email customer').disabled,false)
 await click('Approve & create invitation')
 const issued=ownerCalls.filter(call=>call.name==='approve_scheduling_offer')
 assert.equal(issued.length,1)
 assert.match(issued[0].args.p_hash,/^[a-f0-9]{64}$/)
 assert.equal(issued[0].args.p_input.recipient_email,context.estimate.customer_email)
 assert.equal(sent.length,0,'creating a link does not imply sending an email')
 assert.match(document.querySelector('.guided-invitation input').value,/^https:\/\/finviant\.test\/\?booking=[a-f0-9]{64}$/)
 await click('Approve & send email')
 assert.equal(sent.length,1)
 assert.equal(sent[0].name,'work-scheduling')
 assert.equal(sent[0].body.action,'send_availability')
 assert.equal(sent[0].body.approved,true)
 assert.equal(ownerCalls.filter(call=>call.name==='approve_scheduling_offer').length,1,'sending reuses the reviewed invitation')

 // A remote customer booking refreshes an already-open job without replacing notes being edited.
 const jobId='12345678-1234-4234-8234-123456789012'
 let jobReads=0,jobRow={id:jobId,title:'Booked customer visit',description:'Original notes',status:'scheduled',scheduled_start:slots[0].starts_at,scheduled_end:slots[0].ends_at,assigned_user_ids:[context.team[0].id],customer_id:context.estimate.customer_id,customers:[],properties:[]}
 supabase.from=table=>{assert.equal(table,'jobs');const query={select:()=>query,eq:()=>query,single:async()=>{jobReads++;return {data:structuredClone(jobRow),error:null}}};return query}
 supabase.channel=()=>{const channel={on:()=>channel,subscribe:()=>channel};return channel}
 supabase.removeChannel=async()=>({})
 const {default:Job}=await server.ssrLoadModule('/src/components/JobDetailsDialog.tsx')
 await act(async()=>root.render(React.createElement(Job,{key:'live-job',business,jobId,onClose:()=>{}})));await tick()
 assert.match(document.body.textContent,/9:00 AM/)
 jobRow={...jobRow,description:'Updated business notes',scheduled_start:slots[1].starts_at,scheduled_end:slots[1].ends_at}
 await act(async()=>window.dispatchEvent(new Event('focus')));await act(()=>new Promise(resolve=>setTimeout(resolve,220)))
 assert.match(document.body.textContent,/10:00 AM/,'the open job reflects remote appointment time changes')
 const notes=document.querySelector('textarea');assert.equal(notes.value,'Updated business notes')
 await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(notes,'My unsaved job notes');notes.dispatchEvent(new Event('input',{bubbles:true}))});await tick()
 const beforeDirtyRefresh=jobReads
 jobRow={...jobRow,description:'Another remote edit',scheduled_start:slots[0].starts_at,scheduled_end:slots[0].ends_at}
 await act(async()=>window.dispatchEvent(new Event('focus')));await act(()=>new Promise(resolve=>setTimeout(resolve,220)))
 assert.equal(jobReads,beforeDirtyRefresh,'background refresh waits while a notes editor is dirty')
 assert.equal(document.querySelector('textarea').value,'My unsaved job notes','remote booking refresh preserves the owner draft')
 console.log('PASS: professional booking, timezone/DST, live availability, conflict/retry guards, verified receipts, private calendar export, terminal states, Pro-only approved invitations, narrow beta email lane and open-job refresh preserving drafts')
}finally{
 await act(async()=>root.unmount());await supabase?.auth.stopAutoRefresh();await server.close();dom.window.close();URL.createObjectURL=realCreate;URL.revokeObjectURL=realRevoke
}
process.exit(0)
