import {JSDOM,VirtualConsole} from 'jsdom'
import {readFileSync} from 'node:fs'
import {webcrypto} from 'node:crypto'
import assert from 'node:assert/strict'
const html=readFileSync('tmp/operations-review/preview.html','utf8'),wait=ms=>new Promise(r=>setTimeout(r,ms))
async function scenario(name,verify){
 const errors=[],console=new VirtualConsole();console.on('jsdomError',e=>{if(!/navigation|HTMLCanvasElement|window.scrollTo/.test(e.message))errors.push(e.message)})
 const dom=new JSDOM(html,{url:'https://finviant.test/qa?screen=jobs&scenario='+name,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console,beforeParse(w){Object.defineProperty(w,'crypto',{value:webcrypto});w.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.confirm=()=>true;w.alert=()=>{};w.fetch=async()=>new Response('{}',{headers:{'content-type':'application/json'}})}})
 const doc=dom.window.document
 const button=(name,root=doc)=>[...root.querySelectorAll('button')].find(b=>(b.textContent.trim()===name||b.getAttribute('aria-label')===name)&&!b.closest('[hidden]'))
 const tab=(name,root=doc)=>[...root.querySelectorAll('[role=tab]')].find(b=>b.textContent.trim()===name&&!b.closest('[hidden]'))
 async function until(fn){for(let i=0;i<160;i++){if(fn())return;await wait(25)}throw Error(name+': expected result not reached: '+doc.getElementById('root')?.textContent?.slice(-2400))}
 async function click(el){assert.ok(el,'click target exists');el.click();await wait(90)}
 async function fill(el,value){assert.ok(el);const setter=Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:el.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype,'value').set;setter.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await wait(30)}
 const dialog=()=>doc.querySelector('dialog[open]')
 try{await until(()=>button('List')&&doc.querySelector('.jobs-record-list')&&!doc.querySelector('.jobs-record-list').textContent.includes('Loading jobs'));await verify({doc,until,click,button,tab,fill,dialog,window:dom.window});assert.deepEqual(errors,[]);process.stdout.write('PASS job management DOM: '+name+'\n')}finally{dom.window.close()}
}
await scenario('mixed',async({doc,until,click,button,tab,fill,dialog})=>{
 assert.equal(tab('Jobs').getAttribute('aria-selected'),'true');await fill(doc.querySelector('input[type=search]'),'Kitchen')
 await click(button('Manage'));await until(()=>doc.querySelector('.jm-workspace h2'))
 assert.equal(tab('Job Management').getAttribute('aria-selected'),'true');assert.match(doc.querySelector('.jm-workspace').textContent,/Kitchen renovation/)
 await click(tab('Materials'));await click(button('+ Add material'));await until(()=>dialog()?.querySelector('input'))
 await fill(dialog().querySelector('input'),'Paver blocks');await click(button('Save material',dialog()));await until(()=>!dialog());await until(()=>doc.querySelector('.jm-panel:not([hidden])').textContent.includes('Paver blocks'))
 await click(button('Edit Paver blocks'));await until(()=>dialog());await fill(dialog().querySelector('select'),'received');await click(button('Save material',dialog()));await until(()=>!dialog());await until(()=>doc.querySelector('.jm-panel:not([hidden])').textContent.includes('Received'))
 await click(tab('Tasks'));await click(button('+ Add task'));await until(()=>dialog());await fill(dialog().querySelector('input'),'Final site inspection');await fill(dialog().querySelectorAll('select')[1],'high');await click(button('Save task',dialog()));await until(()=>!dialog());await until(()=>doc.querySelector('.jm-task-list').textContent.includes('Final site inspection'))
 assert.match(doc.querySelector('.jm-task-list').textContent,/High priority/)
 await click(button('Templates'));await until(()=>dialog());await fill(dialog().querySelector('input'),'Standard finish');await click(button('Save template',dialog()));await until(()=>!dialog())
 await click(button('Templates'));await until(()=>dialog()?.textContent.includes('Standard finish'));await click(button('Apply',dialog()));await until(()=>!dialog());await until(()=>doc.querySelectorAll('.jm-task-list li').length===6)
 await click(tab('Billing'));await until(()=>doc.querySelector('.jm-workspace .job-cost-grid'));assert.match(doc.querySelector('.jm-workspace .job-cost-grid').textContent,/\$2,570.00/)
 await click(tab('Jobs'));await until(()=>doc.querySelector('.jobs-record-list'));assert.equal(doc.querySelector('input[type=search]').value,'Kitchen','directory search survives tab switching')
 await click(tab('Job Management'));await until(()=>doc.querySelector('.jm-workspace h2'));assert.match(doc.querySelector('.jm-workspace h2').textContent,/Kitchen/)
 await click(button('Complete job'));await until(()=>dialog()?.textContent.includes('Review before completing'));assert.equal(button('Complete job',dialog()).disabled,true)
 const check=dialog().querySelector('input[type=checkbox]');await click(check);assert.equal(button('Complete job',dialog()).disabled,false);await click(button('Complete job',dialog()));await until(()=>!dialog());await until(()=>doc.querySelector('.jm-job-header .jm-status')?.textContent==='Completed');assert.match(doc.querySelector('.jm-workspace').textContent,/Review invoice/)
})
await scenario('approved',async({doc,until,click,tab,button})=>{
 await click(tab('Job Management'));await until(()=>button('Manage approved work'));await click(button('Manage approved work'));await until(()=>doc.querySelector('.jm-workspace h2')?.textContent==='Backyard patio');assert.equal(doc.querySelectorAll('.jm-approved-work').length,0)
})
await scenario('restricted',async({doc,until,click,tab,button})=>{
 await click(button('Manage'));await until(()=>doc.querySelector('.jm-workspace h2'));assert.equal(tab('Billing'),undefined);assert.equal(tab('Changes'),undefined);assert.equal(button('Complete job'),undefined);assert.equal(button('+ Add task'),undefined);await click(tab('Materials'));assert.equal(button('+ Add material'),undefined);assert.doesNotMatch(doc.querySelector('.jm-panel:not([hidden])').textContent,/Estimated total/)
})
await scenario('empty',async({doc,until,click,tab})=>{
 await click(tab('Job Management'));await until(()=>doc.querySelector('.jm-queue-empty'));assert.match(doc.querySelector('.jm-queue-empty').textContent,/Your work starts here/);assert.equal(doc.querySelector('.jm-workspace'),null)
})
await scenario('failure',async({doc,until,click,tab,button})=>{
 await click(button('Manage'));await until(()=>doc.querySelector('.jm-error'));assert.notEqual(button('Complete job')?.disabled,false);assert.equal(doc.querySelector('.jm-financial-lines'),null);assert.ok(button('Retry job'))
})
