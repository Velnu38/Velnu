import {JSDOM,VirtualConsole} from 'jsdom'
import {readFileSync} from 'node:fs'
import {webcrypto} from 'node:crypto'
import assert from 'node:assert/strict'
const html=readFileSync('tmp/operations-review/preview.html','utf8'),wait=ms=>new Promise(r=>setTimeout(r,ms))
for(const scenario of ['mixed','restricted']){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/navigation|HTMLCanvasElement|window.scrollTo/.test(e.message))errors.push(e.message)})
 let confirmAllowed=true
 const dom=new JSDOM(html,{url:'https://finviant.test/qa?screen=jobs&scenario='+scenario,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){Object.defineProperty(w,'crypto',{value:webcrypto});w.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.confirm=()=>confirmAllowed;w.alert=()=>{};w.fetch=async()=>new Response('{}',{headers:{'content-type':'application/json'}})}})
 const doc=dom.window.document
 const visible=e=>!e.closest('[hidden]')
 const button=(name,root=doc)=>[...root.querySelectorAll('button')].find(e=>visible(e)&&(e.textContent.trim().replace(/\s*→$/,'')===name||e.getAttribute('aria-label')===name))
 const tile=name=>[...doc.querySelectorAll('.jm-direct-sections>button')].find(e=>visible(e)&&e.textContent===name)
 const group=name=>button(name,doc.querySelector('.jm-section-groups'))
 const until=async fn=>{for(let i=0;i<160;i++){if(fn())return;await wait(25)}throw Error(scenario+': timed out '+doc.body.textContent.slice(-1800))}
 const click=async el=>{assert.ok(el,'expected clickable control');el.click();await wait(70)}
 const fill=async(el,value)=>{assert.ok(el);const proto=el.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:el.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await wait(40)}
 try{
  await until(()=>doc.querySelector('.unified-job-title'));await click(doc.querySelector('.unified-job-title'));await until(()=>doc.querySelector('.jm-phone-summary'))
  assert.equal(doc.querySelector('.jm-workspace > .record-tabs'),null,'no redundant desktop tab row')
  assert.equal(doc.querySelector('.jm-overview-grid'),null,'retired dashboard does not crowd phone summary')
  assert.ok(doc.querySelector('.jm-job-actions a[href^="tel:"]'),'existing call handoff retained')
  assert.ok(doc.querySelector('.jm-summary-secondary .jm-workspace-footer'),'secondary job actions retained below main card')
  await click(group('Work'));assert.equal(doc.querySelectorAll('.jm-direct-sections>button').length,4)
  for(const [label,section] of [['Tasks & templates','tasks'],['Visits & crew','schedule'],['Materials','materials'],['Photos & expenses','photos']]){
   await click(tile(label));assert.equal(new URL(dom.window.location.href).searchParams.get('section'),section)
   assert.ok(doc.querySelector('.jm-panel:not([hidden])'));assert.ok(doc.querySelector('.jm-section-groups'),'primary navigation remains available')
   await click(group('Work'));assert.ok(tile(label));assert.equal(new URL(dom.window.location.href).searchParams.get('panel'),null)
  }
  if(scenario==='mixed'){
   await click(tile('Tasks & templates'));await click(button('+ Add task'));await until(()=>doc.querySelector('dialog[open]'))
   const dialog=doc.querySelector('dialog[open]');await fill(dialog.querySelector('input'),'Phone finish task');await click(button('Save task',dialog));await until(()=>!doc.querySelector('dialog[open]'));await until(()=>doc.querySelector('.jm-task-list').textContent.includes('Phone finish task'))
   await click(group('Work'));await click(group('Billing'));assert.equal(doc.querySelectorAll('.jm-direct-sections>button').length,3)
   await click(tile('Costs & budget'));assert.equal(new URL(dom.window.location.href).searchParams.get('billing'),'costs');await until(()=>doc.querySelector('.job-cost-grid'));assert.ok(doc.querySelector('.jm-panel:not([hidden]) > div[hidden]'),'invoice list separated from costs')
   await click(group('Billing'));await click(tile('Invoices'));assert.equal(new URL(dom.window.location.href).searchParams.get('billing'),null);assert.ok(doc.querySelector('.jm-panel:not([hidden]) > div:not([hidden])'),'invoice list is the active view');await click(group('Billing'))
   await click(group('Summary'));await fill(doc.querySelector('.jm-summary-secondary textarea'),'Unsaved phone notes');confirmAllowed=false;await click(group('Work'));assert.ok(doc.querySelector('.jm-phone-summary'),'unsaved notes block navigation');assert.equal(doc.querySelector('.jm-summary-secondary textarea').value,'Unsaved phone notes');confirmAllowed=true
  }else{assert.equal(group('Billing'),undefined);await click(tile('Tasks & templates'));assert.equal(button('+ Add task'),undefined);await click(group('Work'))}
  await click(group('Records'));assert.ok(tile('Activity history'));assert.ok(tile('Completion reports'));await click(tile('Activity history'));await click(group('Records'));await click(group('Summary'))
  await click(button('‹ All jobs'));await until(()=>!doc.querySelector('.jm-workspace'));assert.ok(doc.querySelector('.jobs-record-list'),'browse retains filters and paging')
  assert.deepEqual(errors,[]);console.log('PASS phone job flow DOM:',scenario)
 }finally{dom.window.close()}
}
