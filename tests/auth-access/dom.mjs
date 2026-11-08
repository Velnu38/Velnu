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
 await act(async()=>{await server.ssrLoadModule('/tests/auth-access/harness.tsx')});await tick()
 await input('Email','TEST@example.test');await input('Password','existing');await submit()
 assert.match(document.body.textContent,/Forgot password/);assert.doesNotMatch(document.body.textContent,/private stack trace/)
 await click(button('Forgot password?'));await submit()
 assert.equal(window.requests.at(-1).type,'reset');assert.equal(window.requests.at(-1).email,'test@example.test');assert.match(window.requests.at(-1).options.redirectTo,/recovery=1/)
 await click(button('Back to sign in'));await click(button('New to Finviant Office? Create an account'))
 await input('Password','short');let count=window.requests.length;await submit();assert.equal(window.requests.length,count);assert.match(document.body.textContent,/15 characters/)
 await input('Password','unique passphrase here');count=window.requests.length;await input('Confirm password','wrong passphrase here');await submit();assert.equal(window.requests.length,count);assert.match(document.body.textContent,/do not match/);await click(button('Show password'));assert.equal(document.querySelector('input[name=password]').type,'text');await click(button('Hide password'));await input('Confirm password','unique passphrase here');await submit();assert.match(document.body.textContent,/check your email/i)
 await act(async()=>window.mountRecovery(false,false));await tick();assert.match(document.body.textContent,/invalid or expired/)
 await act(async()=>window.mountRecovery(true,false));await tick();await input('New password','unique passphrase here');await input('Confirm password','different passphrase here');await submit();assert.match(document.body.textContent,/do not match/)
 await input('Confirm password','unique passphrase here');await submit();assert.match(document.body.textContent,/Password updated/);assert.equal(button('Return to Finviant Office').disabled,true)
 await click(button('Retry signing out other sessions'));assert.equal(button('Return to Finviant Office').disabled,false)
 console.log('PASS: sign-in privacy, normalized reset email, recovery redirect, signup length/verification, expired link, password mismatch and global sign-out failure/retry')
}finally{const {supabase}=await server.ssrLoadModule('/src/lib/supabase.ts');await supabase.auth.stopAutoRefresh();await server.close();dom.window.close()}
process.exit(0)
