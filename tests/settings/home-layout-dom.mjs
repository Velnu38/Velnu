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
const B='11111111-1111-4111-8111-111111111111';let filter='attention',payment='clear',count=0,calendarJobStatus=null,calls=[],supabase,plan='pro'
const tick=()=>act(()=>new Promise(r=>setTimeout(r,35)))
const button=t=>[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===t||el.getAttribute('aria-label')===t)
const click=async t=>{assert.ok(button(t),t);await act(async()=>button(t).click());await tick()}
const business={id:B,name:'Home QA',role:'owner',primary_owner:true,access_modules:['calendar','billing','jobs','finances'],timezone:'America/New_York',profile_completed_at:'2026-01-01'}
const invoice={id:'inv',invoice_number:'INV-1',due_date:'2000-01-01',balance_due:100,customers:[]}
try{
 ({supabase}=await server.ssrLoadModule('/src/lib/supabase.ts'))
 supabase.auth.getSession=async()=>({data:{session:{access_token:'test'}},error:null})
 supabase.rpc=(name,args)=>{calls.push({name,args});let data=[]
  if(name==='get_plan_usage')data={plan,financial_history:true}
  if(name==='get_dashboard_invoice_totals')data={open_invoices:1,outstanding_balance:100}
  if(name==='get_schedule_team')data=[{id:'owner',label:'Owner',is_you:true}]
  if(name==='set_job_status_atomic'){calendarJobStatus=args.p_status;data={id:args.p_job_id,status:args.p_status}}
  if(name==='get_invoice_payment_operations')data={state:payment,refunds:[]}
  if(name==='get_dashboard_attention_page'){filter=args.p_filter;data={page:args.p_page,page_size:5,total:filter==='approvals'?2:1,attention_count:1,approval_count:2,category_counts:{schedule:0,invoice:0,overdue:1,follow_up:0},items:filter==='approvals'?[{kind:'estimate',data:{id:'est',document_type:'estimate',number:'EST-1',issue_date:'2026-01-01',total:20,customers:[]}}]:filter==='attention'||filter==='overdue'?[{kind:'invoice',data:invoice}]:[]}}
  const result={data,error:null,count:Array.isArray(data)?data.length:0};const q=Object.assign(Promise.resolve(result),{single:async()=>result,range:()=>Promise.resolve(result),order:()=>q});return q
 }
 supabase.from=table=>{let q;const rows=calendarJobStatus?(table==='jobs'?[{id:'job-qa',status:calendarJobStatus,description:'Keep notes',customers:[],properties:[]}]:table==='calendar_work'?[{id:'appointment:visit',source_key:'appointment:visit',job_id:'job-qa',title:'Scheduled QA job',document_kind:'work',document_id:'job-qa',starts_at:new Date(Date.now()-120000).toISOString(),ends_at:new Date(Date.now()+3600000).toISOString(),status:calendarJobStatus==='completed'?'completed':'confirmed'}]:[]):[];const result=()=>({data:rows,error:null,count:rows.length});q=new Proxy({},{get:(_,key)=>key==='then'?(res,rej)=>Promise.resolve(result()).then(res,rej):()=>q});return q}
 globalThis.fetch=async()=>new Response(JSON.stringify({events:[],issues:[],connections:0}),{headers:{'content-type':'application/json'}})
 const {default:Home}=await server.ssrLoadModule('/src/pages/DashboardPage.tsx')
 const {default:BillingHub}=await server.ssrLoadModule('/src/components/BillingHub.tsx')
 const {default:Calendar}=await server.ssrLoadModule('/src/components/calendar/DailyCalendar.tsx')
 await act(async()=>root.render(React.createElement(Home,{business,onNavigate:()=>{}})));await tick();await tick()
 const trigger=button('Quick Links');assert.ok(trigger);assert.equal(trigger.getAttribute('aria-label'),'Quick Links');assert.equal(trigger.textContent,'Quick Links')
 assert.equal(document.querySelector('.attention-jump'),null)
 assert.ok(document.querySelector('.home-today-card'));assert.ok(document.querySelector('.home-financial-card'));assert.ok(document.querySelector('.home-attention-card'));assert.equal(button('Refresh'),undefined)
 await click('Quick Links');assert.equal(document.querySelector('dialog').getAttribute('aria-label'),'Quick Links')
 for(const destination of ['invoices','estimates','work','reminders','customers'])assert.ok(document.querySelector(`.home-create-options a[href*="view=${destination}"]`))
 assert.equal(document.querySelector('.home-create-options a[aria-label="Team Management"]').getAttribute('href'),'/?view=settings&section=team')
 assert.equal([...document.querySelectorAll('.home-create-options button')].some(el=>/calendar|appointment/i.test(el.textContent)),false,'calendar creation is removed from Quick Links')
 await act(async()=>document.querySelector('button[aria-label="Close"]').click());await tick()
 assert.equal(document.querySelector('.home-header-actions>.refresh-button'),null);const beforeRefresh=calls.filter(c=>c.name==='get_dashboard_invoice_totals').length;await click('Quick Links');await click('Refresh Home');await tick();assert.ok(calls.filter(c=>c.name==='get_dashboard_invoice_totals').length>beforeRefresh,'Home refresh remains available in Quick Links');await click('Calendar');await click('View finances')
 assert.equal(document.querySelector('.worker-select'),null,'solo owner does not need a redundant crew filter')
 const extras=[...document.querySelectorAll('.home-calendar-extras>details')];assert.equal(extras.length,2);assert.ok(extras.every(el=>!el.open));assert.ok(document.querySelector('.home-calendar-extras a'))
 await click('Today');await click('Month');assert.match(document.body.textContent,/Monthly calendar/);await click('Week')
 assert.match(document.body.textContent,/Income received/);assert.ok(button('Add transaction'))
 await act(async()=>document.querySelector('.performance-metric.income').click());await tick();assert.ok(document.querySelector('.financial-transactions'))
 if(document.querySelector('[aria-label="Close transaction details"]'))await act(async()=>document.querySelector('[aria-label="Close transaction details"]').click())
 await act(async()=>root.render(React.createElement(BillingHub,{business,key:'billing',onPendingChange:n=>count=n,approvalBreakdown:{estimates:1,changeOrders:1}})));await tick();await tick()
 assert.ok(button('Send reminder'),'queue is immediately visible');assert.equal(count,1);assert.equal(document.querySelector('.attention-summary-toggle'),null)
 assert.equal(document.querySelector('.attention-pagination div').hidden,true,'one-page queue has no disabled pagination controls')
 const approval=[...document.querySelectorAll('.attention-view-switch button')][1];assert.match(approval.textContent,/1 estimate · 1 change order/)
 await act(async()=>approval.click());await tick();assert.equal(filter,'approvals');assert.match(document.body.textContent,/EST-1/);assert.equal(document.querySelector('.attention-category-pills'),null)
 payment='pending';await act(async()=>root.render(React.createElement(BillingHub,{business,key:'processing'})));await tick();await tick();assert.equal(button('Send reminder'),undefined);assert.ok([...document.querySelectorAll('a')].some(a=>a.textContent==='Payment processing'))
 // Deterministic calendar cache assertions: JSDOM has no competing OS window
 // focus, while the browser journey still verifies every selected-day item.
 let calendarReads=0
 globalThis.fetch=async()=>{calendarReads++;return new Response(JSON.stringify({events:[],issues:[],connections:0}),{headers:{'content-type':'application/json'}})}
 await act(async()=>root.render(React.createElement(Calendar,{business,compact:true,key:'range-cache'})));await tick();await tick()
 assert.equal(calendarReads,1)
 await click('Month');assert.equal(calendarReads,2)
 const otherDay=document.querySelector('.calendar-day:not(.outside-month)[aria-pressed="false"]');assert.ok(otherDay)
 await act(async()=>otherDay.click());await tick();assert.equal(calendarReads,2,'selecting another day in the loaded month does not fetch provider events')
 await act(async()=>window.dispatchEvent(new Event('focus')));await act(()=>new Promise(resolve=>setTimeout(resolve,200)));await tick();assert.equal(calendarReads,3,'returning window focus refreshes provider events')
 await act(async()=>window.dispatchEvent(new Event('finviant-work-changed')));await act(()=>new Promise(resolve=>setTimeout(resolve,200)));await tick();assert.equal(calendarReads,4,'actual work invalidation refreshes provider events')
 await act(async()=>root.render(React.createElement(Calendar,{business:{...business,id:'22222222-2222-4222-8222-222222222222'},compact:true,key:'range-cache'})));await tick();assert.equal(calendarReads,5,'changing workspace cannot reuse another business calendar')
 globalThis.fetch=async()=>new Response(JSON.stringify({events:[],issues:[{provider:'google',email:'test@example.test',reconnect:true}],connections:1}),{headers:{'content-type':'application/json'}})
 await act(async()=>root.render(React.createElement(Calendar,{business,compact:true,key:'reconnect'})));await tick();await tick();assert.equal(document.querySelectorAll('.home-calendar-extras>details')[1].open,true,'connection problems stay visible');assert.match(document.body.textContent,/Reconnect/)
 calendarJobStatus='scheduled';globalThis.fetch=async()=>new Response(JSON.stringify({events:[],issues:[],connections:0}),{headers:{'content-type':'application/json'}})
 await act(async()=>root.render(React.createElement(Calendar,{business,compact:true,key:'job-action'})));await tick();await tick()
 assert.ok(button('Start job'));const start=button('Start job');await act(async()=>{start.click();start.click()});await tick();await tick();assert.equal(calls.filter(c=>c.name==='set_job_status_atomic').length,1);assert.ok(button('Mark complete'))
 let completions=0;Object.defineProperty(supabase,'functions',{configurable:true,value:{invoke:async(name,{body})=>{assert.equal(name,'work-scheduling');assert.equal(body.action,'complete');completions++;calendarJobStatus='completed';return{data:{job_id:'job-qa',invoice_ready:true,invoice_status:'draft'},error:null}}}})
 window.confirm=()=>false;await click('Mark complete');assert.equal(completions,0)
 window.confirm=()=>true;const finish=button('Mark complete');await act(async()=>{finish.click();finish.click()});await tick();await tick();assert.equal(completions,1);assert.match(document.body.textContent,/invoice draft is ready/);assert.equal(button('Mark complete'),undefined)
 await act(async()=>root.render(React.createElement(Calendar,{business:{...business,role:'viewer'},compact:true,key:'viewer'})));await tick();assert.equal(button('Start job'),undefined);assert.equal(button('Mark complete'),undefined);assert.equal(button('Add to calendar'),undefined)
 for(const tier of ['free','basic','pro']){
  plan=tier;calendarJobStatus=null;await act(async()=>root.render(React.createElement(Home,{business,key:'home-'+tier})));await tick();await tick();await click('Quick Links');assert.ok(document.querySelector('.home-create-options a[aria-label="Team Management"]'),'owner Team Management link on '+tier);assert.equal([...document.querySelectorAll('.home-create-options button')].some(el=>/calendar|appointment/i.test(el.textContent)),false)
  await act(async()=>document.querySelector('button[aria-label="Close"]').click());await tick()
 }
 for(const role of ['office','technician','viewer']){
  const member={...business,role,primary_owner:false};await act(async()=>root.render(React.createElement(Home,{business:member,key:role})));await tick();await tick()
  if(role==='viewer'){assert.equal(button('Quick Links'),undefined);continue}
  await click('Quick Links');assert.equal(!!document.querySelector('.home-create-options a[aria-label="Team Management"]'),role==='office');assert.equal([...document.querySelectorAll('.home-create-options button')].some(el=>/calendar|appointment/i.test(el.textContent)),false)
 }
 assert.ok(!calls.some(c=>c.name.startsWith('send_')||c.name==='record_manual_payment'||c.name==='set_tier_test'),'read-only layout checks never send or record money')
 console.log('PASS Home Quick Links, Team Management tier/permission visibility, removed calendar shortcut, visible Refresh, existing destinations, visible queue/filter switching, approval breakdown, pagination, payment-processing guard, calendar modes/Today/solo filter, financial drilldown visible reconnect issues, shared job start/completion confirmation, duplicate-click protection and viewer restrictions')
}finally{await act(async()=>root.unmount());await supabase?.auth.stopAutoRefresh();await supabase?.removeAllChannels();await server.close();dom.window.close()}
process.exit(0)
