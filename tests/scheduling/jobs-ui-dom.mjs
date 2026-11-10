import {JSDOM} from 'jsdom'
import {createServer} from 'vite'
import assert from 'node:assert/strict'
process.env.VITE_SUPABASE_URL='https://test.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test-key'
const dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:'http://localhost/?view=work',pretendToBeVisual:true})
for(const key of ['window','document','HTMLElement','Element','Node','Event','MouseEvent','PopStateEvent','MutationObserver','HTMLDialogElement','history','location','localStorage','HTMLFormElement'])globalThis[key]=key==='window'?dom.window:dom.window[key]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window)
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')}
dom.window.confirm=()=>true
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {act}=await import('react')
const server=await createServer({server:{middlewareMode:true},appType:'custom'})
const tick=()=>act(()=>new Promise(resolve=>setTimeout(resolve,35)))
const button=(text,scope=document)=>[...scope.querySelectorAll('button')].find(node=>node.textContent.trim()===text)
const actionLabels=()=>[...document.querySelectorAll('.record-action-primary button,.record-action-primary a')].map(node=>node.textContent.trim())
async function click(node){assert.ok(node,'Expected control exists');await act(async()=>node.click());await tick()}
async function moreClick(label){const menu=document.querySelector('.record-more');assert.ok(menu);await act(async()=>{menu.open=true});await click(button(label,menu))}
async function render(options){await act(async()=>window.jobsHarness.render(options));await tick();await tick()}
async function editNotes(value){const input=document.querySelector('.job-details-notes textarea');await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));input.dispatchEvent(new dom.window.Event('change',{bubbles:true}))});await tick()}
try{
 await act(async()=>{await server.ssrLoadModule('/tests/scheduling/jobs-ui-harness.tsx')})
 for(const [status,booked,label] of [['lead',false,'Schedule job'],['scheduled',true,'Start job'],['in_progress',true,'Mark complete'],['completed',false,null],['canceled',false,null]]){
  await render({status,booked})
  assert.deepEqual(actionLabels(),label?[label]:[],status+' has one contextual action')
  assert.equal(document.querySelector('select[aria-label^="Status for"]'),null)
  assert.equal(button('Save job details'),undefined,'unchanged notes have no competing Save action')
  assert.deepEqual([...document.querySelectorAll('[role=tab]')].map(tab=>tab.textContent),['Details','Work plan','Photos & expenses','Activity'])
 }
 await render({status:'scheduled',booked:false,retainedTime:true})
 assert.deepEqual(actionLabels(),['Schedule job'],'a retained timestamp cannot authorize Start')
 await click(button('Schedule job'))
 assert.match(document.querySelector('dialog[aria-label="Schedule job"]').textContent,/Schedule job/)
 assert.equal(button('Schedule job',document.querySelector('dialog[aria-label="Schedule job"]')).disabled,false,'same-time appointment repair is available')
 await render({status:'completed',booked:false,invoice:{id:'existing',number:'INV-100',status:'paid',balance_due:0}})
 assert.deepEqual(actionLabels(),['View invoice'])
 assert.doesNotMatch(document.body.textContent,/draft ready|Create invoice/)
 await click(button('Activity'))
 assert.match(document.querySelector('[role=tabpanel]:not([hidden])').textContent,/Job created.*Work completed.*Last updated/s)
 await render({role:'technician',status:'in_progress',invoice:{id:'secret',number:'INV-SECRET',status:'paid'}})
 assert.deepEqual(actionLabels(),['Mark complete'])
 assert.doesNotMatch(document.body.textContent,/INV-SECRET|View invoice|Review invoice|Reopen job/)
 await render({role:'viewer',status:'scheduled'})
 assert.deepEqual(actionLabels(),[])
 assert.equal(document.querySelector('.job-details-notes textarea').disabled,true)
 assert.equal(document.querySelector('.record-more'),null)
 await render({role:'technician',status:'completed',booked:false,modules:['jobs']})
 assert.deepEqual(actionLabels(),[])
 assert.equal(document.querySelector('.record-more'),null,'closed Jobs-only staff do not get an empty or unauthorized More menu')
 await render({status:'canceled',booked:false})
 await moreClick('Reopen job')
 assert.equal(window.jobsHarness.state().calls.filter(call=>call.name==='reopen_job').length,1)
 assert.ok(document.querySelector('dialog[aria-label="Schedule job"]'),'reopening reviews an appointment on the same job')
 await render({status:'scheduled'})
 await editNotes('My unsaved materials list')
 assert.ok(button('Save job details'))
 await click(button('Start job'))
 assert.equal(document.querySelector('.job-details-notes textarea').value,'My unsaved materials list','status refresh preserves draft')
 window.jobsHarness.remoteNotes('Remote office edit')
 await click(button('Save job details'))
 assert.match(document.body.textContent,/changed elsewhere/)
 assert.equal(document.querySelector('.job-details-notes textarea').value,'My unsaved materials list','conflict preserves draft')
 await act(async()=>window.jobsHarness.changeRole('viewer'));await tick()
 assert.equal(document.querySelector('.job-details-notes textarea').value,'My unsaved materials list','permission refresh preserves draft')
 assert.equal(document.querySelector('.job-details-notes textarea').disabled,true)
 assert.deepEqual(actionLabels(),[])
 await render({status:'scheduled'})
 await editNotes('Saved materials list')
 await click(button('Save job details'))
 assert.equal(window.jobsHarness.state().job.description,'Saved materials list')
 assert.equal(button('Save job details'),undefined,'successful save becomes clean')
 await render({status:'scheduled',plan:'basic'})
 assert.ok(button('Assign crew'),'Individual includes crew assignment')
 await render({status:'scheduled',plan:'free'})
 assert.equal(!!button('Assign crew'),false,'Free does not include crew assignment')
 await render({status:'scheduled',plan:'basic'})
 assert.ok(button('Add reminder'),'job reminder no longer depends on an absent parent callback')
 await moreClick('Add reminder')
 assert.ok(document.querySelector('dialog[aria-label="Add job reminder"]'))
 const due=document.querySelector('dialog[aria-label="Add job reminder"] input[type=datetime-local]')
 await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(due,new Date(Date.now()+86400000).toISOString().slice(0,16));due.dispatchEvent(new dom.window.Event('input',{bubbles:true}));due.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})
 await click(button('Save reminder'))
 assert.equal(window.jobsHarness.state().calls.find(call=>call.name==='insert_reminder')?.input.job_id,'22222222-2222-4222-8222-222222222222')
 await render({view:'list',status:'scheduled',booked:false,retainedTime:true})
 await click(button('List'))
 assert.ok(button('Schedule job'))
 assert.equal(button('Start job'),undefined)
 console.log('PASS: all five job states, actual appointment repair, linked paid invoice, role restrictions, tabs/activity, explicit reopen, dirty refresh/conflict/save, Basic crew limits and job reminders')
}finally{
 if(window.jobsHarness)await act(async()=>window.jobsHarness.unmount())
 const {supabase}=await server.ssrLoadModule('/src/lib/supabase.ts');await supabase.auth.stopAutoRefresh();await server.close();dom.window.close()
}
process.exit(0)
