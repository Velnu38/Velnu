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
 await act(async()=>{await server.ssrLoadModule('/tests/admin-mfa/harness.tsx')});await tick()
 await click(button('Set up authenticator'))
 const key=[...document.querySelectorAll('input')].find(i=>i.readOnly)
 assert.equal(key?.value,'TESTONLYSETUPKEY')
 assert.match(document.body.textContent,/Time based/)
 assert.ok(document.querySelector('details img'))
 const form=document.querySelector('form')
 await act(async()=>form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));await tick()
 assert.match(document.body.textContent,/Test invalid code/)
 assert.equal(key.value,'TESTONLYSETUPKEY')
 window.acceptMfa=true
 await act(async()=>form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));await tick()
 assert.equal([...document.querySelectorAll('input')].some(i=>i.value==='TESTONLYSETUPKEY'),false)
 assert.match(document.body.textContent,/Test logins/)
 console.log('PASS: manual key enrollment, QR fallback, failed verification retry, verified dashboard and secret removal')
}finally{const {supabase}=await server.ssrLoadModule('/src/lib/supabase.ts');await supabase.auth.stopAutoRefresh();await server.close();dom.window.close()}
process.exit(0)
