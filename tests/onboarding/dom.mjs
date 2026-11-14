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
async function input(label,value){const field=[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith(label)).querySelector('input');await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(field,value);field.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});}
async function submit(){await act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));await tick()}
try{
 await act(async()=>{await server.ssrLoadModule('/tests/onboarding/harness.tsx')});await tick()
 assert.match(document.body.textContent,/Thank You for choosing Finviant/)
 await input('Business name','Demo Company');await click(document.querySelector('input[value=both]'));await submit()
 assert.match(document.body.textContent,/Business reply email · Required/)
 assert.match(document.body.textContent,/Required for texting/)
 await click(button('Use my verified account email'));await input('Business / owner mobile','123');await submit();assert.match(document.body.textContent,/valid mobile/)
 await input('Business / owner mobile','7575550123');await submit()
 assert.equal(window.insertCount,1);assert.match(document.body.textContent,/activation pending/)
 assert.equal(button('Save & finish setup').disabled,true)
 await click([...document.querySelectorAll('.onboarding-check input')].at(-1))
 window.failComplete=true;await submit();assert.match(document.body.textContent,/Test save failure/);assert.equal(window.opened,false)
 window.failComplete=false;await submit();assert.match(document.body.textContent,/All required setup fields are complete/)
 assert.equal(window.insertCount,1);await click(button('Open my dashboard'));assert.equal(window.opened,true)
 await act(async()=>window.resume());await tick();assert.match(document.body.textContent,/Check your sending methods/);assert.doesNotMatch(document.body.textContent,/Thank You/)
 console.log('PASS: required contact selection, prefill, mobile validation, pending activation, failed save retry, explicit completion and resumed setup without duplicate business')
}finally{const {supabase}=await server.ssrLoadModule('/src/lib/supabase.ts');await supabase.auth.stopAutoRefresh();await server.close();dom.window.close()}
process.exit(0)
