import {JSDOM} from 'jsdom'
import {createServer} from 'vite'
import assert from 'node:assert/strict'
process.env.VITE_SUPABASE_URL='https://test.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test-key'
const dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:'http://localhost/tests/storage',pretendToBeVisual:true})
for(const key of ['window','document','HTMLElement','Element','Node','Event','MouseEvent','MutationObserver','HTMLDialogElement','history','location','localStorage'])globalThis[key]=key==='window'?dom.window:dom.window[key]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {act}=await import('react')
const server=await createServer({server:{middlewareMode:true},appType:'custom'})
const tick=()=>act(()=>new Promise(r=>setTimeout(r,30)))
try {
 await act(async()=>{await server.ssrLoadModule('/tests/storage/harness.tsx')});await tick()
 assert.match(document.body.textContent,/At least 80%/)
 const refresh=[...document.querySelectorAll('button')].find(b=>b.textContent==='Refresh storage')
 for(const [used,expected] of [[95_000_000,/At least 95%/],[100_000_000,/Storage is full/]]) {
  window.setUsage(used);await act(async()=>refresh.click());await tick();assert.match(document.body.textContent,expected)
 }
 assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent==='Add expense manually').disabled,false)
 assert.match(document.body.textContent,/Existing records and payment actions remain available/)
 assert.equal(document.querySelector('progress').getAttribute('value'),'100000000')
 console.log('PASS: rendered storage meter, 80%/95%/full warnings, refresh and independent expense controls')
}finally{const {supabase}=await server.ssrLoadModule('/src/lib/supabase.ts');await supabase.auth.stopAutoRefresh();await server.close();dom.window.close()}
process.exit(0)
