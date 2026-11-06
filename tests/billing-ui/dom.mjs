import {JSDOM} from 'jsdom'
import {createServer} from 'vite'
import assert from 'node:assert/strict'
process.env.VITE_SUPABASE_URL='https://test.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test-key'
const dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:'http://localhost/tests/billing-ui/index.html',pretendToBeVisual:true})
for(const key of ['window','document','HTMLElement','Element','Node','Event','MouseEvent','PopStateEvent','MutationObserver','HTMLDialogElement','history','location','localStorage'])globalThis[key]=key==='window'?dom.window:dom.window[key]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window)
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')}
dom.window.confirm=()=>true
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {act}=await import('react')
const server=await createServer({server:{middlewareMode:true},appType:'custom'})
const tick=()=>act(()=>new Promise(r=>setTimeout(r,30)))
const button=(name,scope=document)=>[...scope.querySelectorAll('button')].find(b=>b.textContent.trim()===name)
async function click(b){assert.ok(b,'Button exists');await act(async()=>b.click());await tick()}
async function amount(value){const input=document.querySelector('dialog input[type=number]');await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));input.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})}
try{
 await act(async()=>{await server.ssrLoadModule('/tests/billing-ui/harness.tsx')});await tick()
 assert.match(document.body.textContent,/Deposit credited/)
 await click(button('Record partial payment'))
 await amount('25');await click(button('Record partial payment',document.querySelector('dialog')))
 assert.equal(window.calls.find(c=>c.name==='record_manual_payment')?.input.payment_amount,25)
 await click(button('Mark Paid'));assert.equal(document.querySelector('dialog input[type=number]').value,'50');assert.equal(document.querySelector('dialog input[type=number]').readOnly,true)
 await click(button('Mark Paid',document.querySelector('dialog')))
 assert.equal(window.calls.filter(c=>c.name==='record_manual_payment').reduce((sum,c)=>sum+c.input.payment_amount,0),75)
 assert.equal(button('Mark Paid'),undefined)
 // Mount the estimate billing action using the same React and service instance.
 await act(async()=>{await server.ssrLoadModule('/tests/billing-ui/deposit-harness.tsx')});await tick()
 await click(button('Create deposit invoice'));await amount('30');await click(button('Create draft deposit invoice'))
 assert.equal(window.calls.at(-1).input.p_amount,30);assert.match(location.search,/view=invoices&document=/)
 console.log('PASS: rendered deposit credit, partial payment, full remaining settlement, paid action removal, deposit creation and invoice navigation')
}finally{const {supabase}=await server.ssrLoadModule('/src/lib/supabase.ts');await supabase.auth.stopAutoRefresh();await server.close();dom.window.close()}
process.exit(0)
