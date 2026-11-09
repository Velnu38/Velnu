import {JSDOM,VirtualConsole} from 'jsdom'
import {readFileSync} from 'node:fs'
import {webcrypto} from 'node:crypto'
import assert from 'node:assert/strict'
const html=readFileSync('tmp/operations-review/preview.html','utf8')
const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function scenario(name,verify){
 const errors=[],console=new VirtualConsole();console.on('jsdomError',e=>{if(!/navigation|HTMLCanvasElement|window.scrollTo/.test(e.message))errors.push(e.message)})
 const dom=new JSDOM(html,{url:'https://finviant.test/qa?screen=jobs&scenario='+name,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console,beforeParse(w){Object.defineProperty(w,'crypto',{value:webcrypto});Object.defineProperty(w,'innerWidth',{value:390});w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.confirm=()=>true;w.URL.createObjectURL=()=> 'blob:qa';w.fetch=async()=>new Response('{}',{headers:{'content-type':'application/json'}})}})
 const doc=dom.window.document
 async function until(fn){for(let i=0;i<120;i++){if(fn())return;await wait(25)}throw Error(name+': expected result not reached: '+doc.body.textContent?.slice(-1000))}
 async function click(element){assert.ok(element,'click target exists');element.click();await wait(70)}
 const button=text=>[...doc.querySelectorAll('button')].find(b=>b.textContent.trim()===text||b.getAttribute('aria-label')===text)
 try{await until(()=>doc.querySelector('.jobs-pulse'));await verify({doc,until,click,button});assert.deepEqual(errors,[]);process.stdout.write('PASS jobs overview DOM: '+name+'\n')}finally{dom.window.close()}
}
await scenario('mixed',async({doc,until,click,button})=>{
 assert.equal(button('Overview').getAttribute('aria-pressed'),'true')
 assert.equal(doc.querySelector('input[type=search]'),null,'filters must not push work below the overview')
 assert.equal(doc.querySelector('.jobs-record-list'),null,'overview should not mount duplicate hidden job lists')
 assert.deepEqual([...doc.querySelectorAll('.jobs-pulse strong')].map(x=>x.textContent),['2','1','1','0'])
 await until(()=>doc.querySelector('.job-focus-card progress'))
 assert.equal(doc.querySelector('.job-focus-card progress').value,1)
 assert.match(doc.querySelector('.job-focus-card').textContent,/4.0 h/)
 assert.match(doc.querySelector('.job-focus-card').textContent,/\$2,570/)
 await click(doc.querySelector('.jobs-pulse button'));assert.equal(button('List').getAttribute('aria-pressed'),'true')
 assert.match(doc.querySelector('.jobs-record-list').textContent,/Kitchen renovation/)
 assert.doesNotMatch(doc.querySelector('.jobs-record-list').textContent,/Exterior trim repair/)
 await click(button('Overview'));await click(doc.querySelector('.job-focus-card>.secondary-button'))
 await until(()=>doc.querySelector('dialog[open] .job-checklist'))
 assert.equal([...doc.querySelectorAll('dialog[open] [role=tab]')].find(x=>x.textContent==='Work plan').getAttribute('aria-selected'),'true','work plan opens directly')
})
await scenario('history',async({doc,click,button})=>{
 assert.match(doc.querySelector('.jobs-pulse-heading').textContent,/0 active · 1 completed/)
 assert.equal(doc.querySelector('.jobs-first-run'),null,'existing history is not a first-run empty account')
 assert.match(doc.querySelector('.jobs-priorities').textContent,/Review completed work for billing/)
 const complete=[...doc.querySelectorAll('.jobs-pipeline button')].find(b=>b.textContent.includes('Completed'))
 await click(complete);assert.equal(button('List').getAttribute('aria-pressed'),'true')
 assert.match(doc.querySelector('.jobs-record-list').textContent,/Completed kitchen job/)
 assert.doesNotMatch(doc.querySelector('.jobs-record-list').textContent,/Canceled trim job/)
})
await scenario('empty',async({doc})=>{
 assert.deepEqual([...doc.querySelectorAll('.jobs-pulse strong')].map(x=>x.textContent),['0','0','0','0'])
 assert.match(doc.querySelector('.jobs-first-run').textContent,/Create your first job/)
 assert.match(doc.querySelector('.jobs-first-run').textContent,/Plan & assign/)
 assert.equal(doc.querySelector('.jobs-focus'),null)
 assert.match(doc.querySelector('.jobs-agenda').textContent,/No upcoming appointments/)
})
await scenario('restricted',async({doc,until})=>{
 await until(()=>doc.querySelector('.job-focus-card progress'))
 assert.equal(doc.querySelector('.focus-costs'),null,'finance data must not render without server financial access')
 assert.doesNotMatch(doc.querySelector('.jobs-pulse').textContent,/Ready for billing/)
 assert.equal(doc.querySelector('.jobs-first-run .primary-button'),null)
 assert.equal(doc.querySelector('a[href*="section=team"]'),null,'do not offer owner settings to a viewer')
})
await scenario('failure',async({doc,until})=>{
 await until(()=>doc.querySelector('.job-focus-card')?.textContent.includes('Work plan could not load'))
 assert.equal(doc.querySelector('.focus-costs'),null,'missing work plans must not become false zero costs')
 assert.match(doc.querySelector('.job-focus-card').textContent,/Retry/)
})
