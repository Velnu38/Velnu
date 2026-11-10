import {JSDOM,VirtualConsole} from 'jsdom'
import {createServer} from 'vite'
import assert from 'node:assert/strict'
process.env.VITE_SUPABASE_URL='https://test.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test-key'
process.env.VITE_ENABLE_CUSTOMER_ACTIONS='false'
process.env.VITE_ENABLE_PRIVATE_BETA_EMAIL='true'
const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'https://finviant.test/?view=estimates',pretendToBeVisual:true,virtualConsole:new VirtualConsole()})
for(const key of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','HTMLTextAreaElement','Element','Node','Event','CustomEvent','MouseEvent','MutationObserver','HTMLDialogElement','history','location','localStorage','sessionStorage'])globalThis[key]=key==='window'?dom.window:dom.window[key]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
Object.defineProperty(document,'visibilityState',{get:()=> 'visible',configurable:true})
HTMLDialogElement.prototype.showModal=function(){this.open=true};HTMLDialogElement.prototype.close=function(){this.open=false}
window.confirm=()=>true;window.alert=()=>{}
let copied='';Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{copied=text}},configurable:true})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client')
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]},plugins:[{name:'estimate-record-test-resources',enforce:'pre',resolveId(source){if(source==='../components/RecordResources')return '\0estimate-record-test-resources'},load(id){if(id==='\0estimate-record-test-resources')return `import React from 'react';export default function Resources({target}){const [note,setNote]=React.useState('');return React.createElement('section',{'aria-label':'Private estimate resources','data-record':target.id},'Private photos & expenses',React.createElement('input',{'aria-label':'Expense draft',value:note,onChange:e=>setNote(e.target.value)}))}`}}]})
const root=createRoot(document.getElementById('root'))
const B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',E='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',C='cccccccc-cccc-4ccc-8ccc-cccccccccccc',J='11111111-1111-4111-8111-111111111111',I='22222222-2222-4222-8222-222222222222',R='33333333-3333-4333-8333-333333333333',NEW='44444444-4444-4444-8444-444444444444'
const person={id:C,first_name:'Alex',last_name:'Customer',company:null,email:'beta@example.test',phone:'+17575550100'}
const make=status=>({id:E,customer_id:C,estimate_number:'EST-100',status,issue_date:'2026-11-08',expires_on:'2040-03-12',subtotal:100,tax_amount:0,total:100,job_id:null,created_at:'2026-11-08T12:00:00Z',updated_at:'2026-11-08T12:00:00Z',customers:[person],properties:[],customer_message:'Approved scope'})
const noWork=()=>({estimate_id:E,job:null,appointment:null,schedule:null,invitation:null,final_invoice_id:null})
let rows=[make('draft')],context=noWork(),plan='basic',rpcCalls=[],writes=[],revisionLost=false,revisionCreated=false,pdfRevision=R,copyFailureOnce=false
const copySnapshots=new Map()
let role='owner',primaryOwner=true
const PDF='%PDF-1.7\nTest immutable canonical document\n%%EOF'
URL.createObjectURL=()=> 'blob:https://finviant.test/pdf';URL.revokeObjectURL=()=>{}
dom.window.HTMLAnchorElement.prototype.click=function(){}
globalThis.fetch=async(url,options)=>{assert.match(String(url),/\/functions\/v1\/document-pdf$/,'tests never send customer email');return new Response(PDF,{headers:{'Content-Type':'application/pdf','X-Finviant-Revision-Id':pdfRevision,'Content-Disposition':'inline; filename="estimate.pdf"'}})}
const tick=()=>act(()=>new Promise(resolve=>setTimeout(resolve,45)))
const preview=()=>document.querySelector('.estimate-preview-modal')
const named=(name,within=document)=>[...within.querySelectorAll('button')].find(el=>el.textContent.trim()===name)
const click=async(name,within=document)=>{const el=named(name,within);assert.ok(el,`${name} exists`);assert.equal(el.disabled,false,`${name} enabled`);await act(async()=>el.click());await tick()}
let Page,supabase
function result(table,filters){
 if(table==='estimates')return rows.filter(row=>!filters.id||row.id===filters.id)
 if(table==='customers')return [person]
 if(table==='business_settings')return [{default_tax_rate:0,payment_links:[],payment_instructions:''}]
 if(table==='estimate_items')return [{id:'line',description:'Service',quantity:1,unit_price:100,tax_rate:0,line_total:100,sort_order:0}]
 if(table==='jobs')return context.job?[{...context.job,title:'Existing job',description:'Scope',customers:[],properties:[]}]:[]
 return []
}
try{
 ;({supabase}=await server.ssrLoadModule('/src/lib/supabase.ts'))
 supabase.auth.getSession=async()=>({data:{session:{access_token:'owner-token',user:{id:'staff'}}},error:null})
 supabase.channel=()=>{const ch={on:()=>ch,subscribe:()=>ch};return ch};supabase.removeChannel=async()=>({})
 supabase.from=table=>{const filters={};let mutation=null;const query={select:()=>query,eq:(field,value)=>{filters[field]=value;return query},or:()=>query,order:()=>query,range:()=>query,update:value=>{mutation=value;return query},insert:value=>{mutation=value;return query},single:async()=>({data:result(table,filters)[0]||null,error:null}),maybeSingle:async()=>({data:result(table,filters)[0]||null,error:null}),then:(resolve,reject)=>{if(mutation)writes.push({table,mutation});const data=result(table,filters);return Promise.resolve({data,error:null,count:data.length}).then(resolve,reject)}};return query}
 supabase.rpc=async(name,args)=>{
  rpcCalls.push({name,args})
  if(name==='get_plan_usage')return {data:{plan,jobs_limit:plan==='free'?5:null,jobs_used:0},error:null}
  if(name==='get_job_workflow_context')return {data:[{job_id:J,active_appointment:context.appointment,invoice:null}],error:null}
  if(name==='get_scheduling_context')return {data:{preferences:{duration_minutes:120},team:[{id:'staff',is_you:true,label:'Owner'}]},error:null}
  if(name==='save_job_appointment')return {data:null,error:null}
  if(name==='get_estimate_workflow_context')return {data:rows.map(row=>({...context,estimate_id:row.id})),error:null}
  if(name==='get_document_change_context')return {data:{can_change:false,document_id:E,customer_id:C,job_id:context.job?.id||null,current_total:100,items:[],work_status:context.job?.status||'unscheduled'},error:null}
  if(name==='get_delivery_setup')return {data:{plan,personal_email_ready:true,personal_sms_ready:true,managed_email_ready:true,managed_sms_ready:false,acknowledged:true},error:null}
  if(name==='prepare_document_copy'){
   if(!copySnapshots.has(args.p_token))copySnapshots.set(args.p_token,pdfRevision)
   if(copyFailureOnce){copyFailureOnce=false;return {data:null,error:{message:'Connection lost after this copy was prepared'}}}
   const revision=copySnapshots.get(args.p_token)
   return {data:{snapshot:{revision_id:revision,items:[]},revision_id:revision,token:args.p_token,expires_at:null},error:null}
  }
  if(name==='create_revised_estimate'){
   if(!revisionCreated){rows.push({...make('draft'),id:NEW,estimate_number:'EST-101'});revisionCreated=true}
   if(revisionLost){revisionLost=false;return {data:null,error:{message:'Connection lost after the new draft was saved'}}}
   return {data:{estimate_id:NEW,already_created:true},error:null}
  }
  throw new Error('Unexpected RPC '+name)
 }
 ;({default:Page}=await server.ssrLoadModule('/src/pages/EstimatesPage.tsx'))
 async function mount(status,work=noWork(),options={}){
  rows=[{...make(status),...(options.deadlinePast?{expires_on:'2000-01-01'}:{})}];context=work;plan=options.plan||'basic';role=options.role||'owner';primaryOwner=role==='owner';rpcCalls=[];writes=[];sessionStorage.clear();history.replaceState(null,'','/?view=estimates')
  const business={id:B,name:'Barone Test Services',role,primary_owner:primaryOwner,timezone:'America/New_York',access_modules:['billing','calendar','jobs','finances']}
  await act(async()=>root.render(React.createElement(Page,{key:status+JSON.stringify(options)+JSON.stringify(work),business})));await tick();await tick()
  assert.equal([...document.querySelectorAll('button')].filter(el=>el.textContent.trim()==='Open estimate').length,0,'the row has no duplicate Open estimate action')
  assert.equal(document.querySelector('.record-resources-shortcut'),null,'photos have a consistent detail tab')
  const open=document.querySelector('.module-record-open');assert.ok(open);await act(async()=>open.click());await tick();await tick()
  assert.ok(preview())
  assert.deepEqual([...preview().querySelectorAll('[role=tab]')].map(el=>el.textContent),['Details','Photos & expenses','Activity'])
  assert.equal(preview().querySelector('summary')?.textContent.includes('Schedule this estimate'),false,'legacy scheduling entry is removed')
 }
 const main=()=>preview().querySelector('.record-action-primary')?.textContent.trim()||''
 await mount('draft');assert.equal(main(),'Send estimate');assert.ok(named('Edit draft',preview()));assert.equal(document.querySelector('[aria-label="Send to customer"]'),null,'delivery is a focused action, not a competing panel')
 await click('Photos & expenses',preview());assert.equal(document.querySelector('[aria-label="Private estimate resources"]').dataset.record,E)
 const expenseDraft=document.querySelector('input[aria-label="Expense draft"]');await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(expenseDraft,'Keep this expense draft');expenseDraft.dispatchEvent(new Event('input',{bubbles:true}))});await tick()
 await click('Activity',preview());assert.ok(preview().querySelector('[aria-label="Document record"]'));await click('Photos & expenses',preview());assert.equal(document.querySelector('input[aria-label="Expense draft"]').value,'Keep this expense draft','switching tabs preserves resource edits');assert.equal(rpcCalls.filter(call=>call.name==='create_revised_estimate').length,0)
 await mount('sent');assert.equal(main(),'Follow up');assert.ok(named('Record acceptance',preview()));assert.equal(named('Customer approval link',preview()),undefined,'Individual cannot issue a Pro approval')
 await mount('sent',noWork(),{plan:'pro'});assert.ok(named('Customer approval link',preview()))
 await mount('sent',noWork(),{plan:'pro',deadlinePast:true});assert.equal(main(),'Follow up');assert.match(preview().textContent,/Response expired/);assert.equal(named('Customer approval link',preview()),undefined);assert.ok(named('Create revised draft',preview()));await click('Follow up',preview());assert.ok(document.querySelector('[aria-label="Share estimate copy"]'),'expired response follow-up shares a readonly copy')
 await mount('accepted');assert.equal(main(),'Schedule job');assert.ok(named('Create final invoice now',preview()));assert.ok(named('Create deposit invoice',preview()))
 const booked={...noWork(),job:{id:J,status:'scheduled',scheduled_start:'2040-03-12T13:00:00Z',scheduled_end:'2040-03-12T15:00:00Z'},appointment:{id:I,status:'confirmed',starts_at:'2040-03-12T13:00:00Z',ends_at:'2040-03-12T15:00:00Z'}}
 await mount('accepted',{...booked,appointment:null});assert.equal(main(),'Schedule job','missing active appointment overrides retained job dates');await click('Schedule job',preview());const repair=document.querySelector('dialog[aria-label="Schedule job"]');assert.ok(repair);assert.equal(named('Schedule job',repair).disabled,false,'same-time repair remains available');await click('Schedule job',repair);assert.equal(rpcCalls.filter(call=>call.name==='save_job_appointment').length,1);assert.equal(rpcCalls.filter(call=>call.name==='book_approved_estimate').length,0,'repair never creates another job')
 await mount('accepted',{...noWork(),schedule:{id:I,status:'planned',scheduled_start_time:'2040-03-12T13:00:00Z',scheduled_end_time:'2040-03-12T15:00:00Z'}});assert.equal(main(),'View schedule');assert.match(preview().textContent,/Planned appointment/);assert.equal(named('Schedule job',preview()),undefined)
 await mount('accepted',booked);assert.equal(main(),'Open job');assert.match(preview().textContent,/Appointment booked/);assert.match(preview().textContent,/9:00 AM EDT/);assert.equal(named('Schedule job',preview()),undefined,'a booked job cannot be scheduled twice')
 await click('Share estimate copy',preview());await tick();await click('Copy Link',document.querySelector('[aria-label="Share estimate copy"]'));assert.match(copied,/document_share=[a-f0-9]{64}/);assert.equal(rpcCalls.filter(call=>call.name==='prepare_document_copy').length,1);assert.equal(rpcCalls.filter(call=>/approval|confirm.*sent|prepare_personal/.test(call.name)).length,0,'closed copies never issue approval or mark sent');assert.equal(writes.length,0)
 const originalCopyToken=rpcCalls.find(call=>call.name==='prepare_document_copy').args.p_token
 await act(async()=>document.querySelector('button[aria-label="Close delivery"]').click());await tick()
 pdfRevision='55555555-5555-4555-8555-555555555555';copyFailureOnce=true
 await click('Share estimate copy',preview());await tick();await click('Copy Link',document.querySelector('[aria-label="Share estimate copy"]'))
 assert.ok(document.querySelector('[aria-label="Share estimate copy"] [role="alert"]'),'an uncertain copy response stays available for a safe retry')
 await click('Copy Link',document.querySelector('[aria-label="Share estimate copy"]'))
 const renewedCopies=rpcCalls.filter(call=>call.name==='prepare_document_copy').slice(-2)
 assert.notEqual(renewedCopies[0].args.p_token,originalCopyToken,'a newly reviewed PDF revision gets a fresh immutable share token')
 assert.equal(renewedCopies[0].args.p_token,renewedCopies[1].args.p_token,'an uncertain copy retry stays bound to its reviewed revision')
 assert.doesNotMatch(document.querySelector('[aria-label="Share estimate copy"]').textContent,/changed after review|could not/)
 pdfRevision=R
 await mount('converted',{...booked,final_invoice_id:I});assert.equal(main(),'Open invoice');assert.equal(preview().querySelector('.record-action-primary a').getAttribute('href'),'/?view=invoices&document='+I);assert.equal(named('Create final invoice now',preview()),undefined)
 await mount('declined');assert.equal(main(),'');assert.equal(named('Schedule job',preview()),undefined);assert.ok(named('Create revised draft',preview()),'revision remains quiet in More')
 await mount('expired');assert.equal(main(),'Create revised draft');revisionLost=true;revisionCreated=false
 await click('Create revised draft',preview());assert.match(preview().textContent,/Connection lost/)
 await click('Create revised draft',preview());await tick();
 const revisedEditor=document.querySelector('dialog[aria-label="Edit draft estimate"]');assert.ok(revisedEditor,'a revised draft opens directly for review');assert.equal(new URLSearchParams(location.search).get('document'),NEW);assert.equal(revisedEditor.querySelector('input[aria-label="Line 1 description"]').value,'Service');
 await click('Cancel',revisedEditor);assert.match(preview().textContent,/EST-101/);const revisions=rpcCalls.filter(call=>call.name==='create_revised_estimate');assert.equal(revisions.length,2);assert.equal(revisions[0].args.p_request,revisions[1].args.p_request,'lost-response revision retry reuses one request');assert.equal(rows.find(row=>row.id===E).status,'expired');assert.equal(rows.filter(row=>row.id===NEW).length,1)
 await mount('draft',noWork(),{role:'viewer'});assert.equal(main(),'');assert.equal(named('Edit draft',preview()),undefined);assert.equal(named('Sending options',preview()),undefined)
 await mount('draft',noWork(),{plan:'free'});const upgrade=preview().querySelector('a.plan-navigation-link');assert.ok(upgrade);assert.ok(!upgrade.className.includes('button'),'upgrade navigation is a plain text link')
 sessionStorage.setItem('finviant-send:staff:'+B+':estimate:'+E,JSON.stringify({token:'a'.repeat(64),channel:'email'}))
 await act(async()=>window.dispatchEvent(new Event('focus')));await tick();await tick();assert.match(preview().textContent,/earlier email app draft/);assert.equal(main(),'Confirm sent');assert.equal(named('Mark sent manually',preview()),undefined)
 console.log('PASS: six estimate states, one primary action, three tabs, role/tier gates, real booking/DST, readonly closed sharing, pending recovery, immutable idempotent revisions and plain upgrade links')
}finally{await act(async()=>root.unmount());await supabase?.auth.stopAutoRefresh();await server.close();dom.window.close()}
process.exit(0)
