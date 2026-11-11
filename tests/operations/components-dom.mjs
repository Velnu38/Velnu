import {JSDOM,VirtualConsole} from 'jsdom'
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {webcrypto} from 'node:crypto'
// This is a DOM simulation, not a real-browser or physical-device certificate.
const html=readFileSync('tmp/operations-review/preview.html','utf8'),errors=[]
const console=new VirtualConsole();console.on('jsdomError',e=>{if(!/navigation|HTMLCanvasElement|window.scrollTo/.test(e.message))errors.push(e)})
const dom=new JSDOM(html,{url:'https://finviant.test/qa',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console,beforeParse(w){Object.defineProperty(w,'crypto',{value:webcrypto});w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.confirm=()=>true;w.URL.createObjectURL=()=> 'blob:qa';w.URL.revokeObjectURL=()=>{};w.fetch=async()=>new Response('{}',{headers:{'content-type':'application/json'}})}})
const wait=ms=>new Promise(r=>setTimeout(r,ms)),doc=dom.window.document
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await wait(30)}throw Error('Expected DOM result not reached: '+doc.body.textContent?.slice(0,900))}
const button=(text,scope=doc)=>[...scope.querySelectorAll('button')].find(b=>b.textContent.trim()===text||b.getAttribute('aria-label')===text)
const click=async(text,scope=doc)=>{const b=button(text,scope);assert.ok(b,text+' exists');assert.equal(b.disabled,false,text+' enabled');b.click();await wait(70)}
try{
 await until(()=>doc.querySelector('.receivable-cards')?.textContent.includes('$18,750.00'))
 await click('View breakdown');assert.match(doc.querySelector('.finance-detail-grid').textContent,/Receivables aging/);assert.match(doc.querySelector('.finance-detail-grid').textContent,/31–60 days/)
 const income=doc.querySelector('.performance-metric.income');income.click();await wait(70);assert.ok(doc.querySelector('#financial-transactions'));assert.match(doc.querySelector('#financial-transactions').textContent,/Invoice payment/)
 await click('Jobs dashboard');await until(()=>button('Board'));await click('Board');assert.match(doc.querySelector('.job-board').textContent,/Kitchen renovation/)
 const card=[...doc.querySelectorAll('.job-board-card')].find(c=>c.textContent.includes('Kitchen renovation'));await click('Job details',card);await until(()=>doc.querySelector('dialog[open]'))
 const dialog=doc.querySelector('dialog[open]');await click('Work plan',dialog);await until(()=>dialog.textContent.includes('Work checklist'))
 const field=dialog.querySelector('.work-plan-add input');Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(field,'Inspect finish quality');field.dispatchEvent(new dom.window.Event('input',{bubbles:true}));await wait(70);await click('Add checklist item',dialog);await until(()=>dialog.querySelector('.job-checklist').textContent.includes('Inspect finish quality'))
 const item=[...dialog.querySelectorAll('.job-checklist li')].find(li=>li.textContent.includes('Inspect finish quality'));item.querySelector('input').click();await wait(90);assert.equal(item.querySelector('input').checked,true);assert.match(dialog.textContent,/\$2,570.00/)
 await click('Activity',dialog);await until(()=>dialog.textContent.includes('Work plan updated'));await click('Close',dialog);await until(()=>!doc.querySelector('dialog[open]'))
 await click('Payment setup');await until(()=>doc.body.textContent.includes('Customer surcharge collection is off.'))
 const providers=[...doc.querySelectorAll('.payment-provider-setting h4')].map(h=>h.textContent);assert.deepEqual(providers,['Stripe','Square'])
 const fee=doc.querySelector('.fee-policy-form');const checkbox=fee.querySelector('input');checkbox.click();const select=fee.querySelector('select');select.value='300';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await wait(70);await click('Save fee preference');await until(()=>doc.body.textContent.includes('Processing-fee preference saved'))
 assert.match(doc.body.textContent,/Customer surcharge collection is off/);assert.match(doc.body.textContent,/No fee is added to debit, prepaid/);assert.equal(errors.length,0,errors.map(e=>e.message).join('\n'))
 process.stdout.write('PASS DOM: cash/aging drilldowns, Jobs board, checklist save/complete/activity, two payment providers and capped inactive fee preference.\n')
}finally{dom.window.close()}
