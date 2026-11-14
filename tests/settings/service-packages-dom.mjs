import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {createServer} from 'vite'
process.env.VITE_SUPABASE_URL='https://test.supabase.co';process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test-key'
const dom=new JSDOM('<div id="root"></div>',{url:'https://finviant.test/',pretendToBeVisual:true})
for(const key of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','Element','Node','Event','CustomEvent','MouseEvent','MutationObserver'])globalThis[key]=key==='window'?dom.window:dom.window[key]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client'),root=createRoot(document.getElementById('root'))
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}})
let supabase,lines=[{description:'Service A',quantity:'2',unit_price:'50',tax_rate:'5'}],rows=[],saves=0,resolveSave,resolveRead
const text=()=>document.body.textContent
const button=name=>[...document.querySelectorAll('button')].find(b=>b.textContent===name)
async function click(name){const el=button(name);assert.ok(el);assert.equal(el.disabled,false);await act(async()=>el.click())}
async function input(label,value){await act(async()=>{const el=[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith(label)).querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))})}
try{
 ({supabase}=await server.ssrLoadModule('/src/lib/supabase.ts'))
 supabase.from=table=>{assert.equal(table,'service_packages');let op='read',payload,id;const q={select(){return q},eq(k,v){if(k==='id')id=v;return q},order(){return q},range(){return new Promise(resolve=>{resolveRead=()=>resolve({data:structuredClone(rows),count:rows.length,error:null})})},insert(value){op='insert';payload=value;return q},update(value){op='update';payload=value;return q},single:async()=>{if(op==='insert'){saves++;return await new Promise(resolve=>{resolveSave=()=>{const row={id:'saved',...payload};rows.push(row);resolve({data:row,error:null})}})}assert.equal(op,'update');rows=rows.filter(r=>r.id!==id);return {data:{id},error:null}}};return q}
 const {default:Component}=await server.ssrLoadModule('/src/components/ServicePackagePicker.tsx')
 const render=()=>root.render(React.createElement(Component,{businessId:'business',lines,onChange:value=>{lines=value;render()}}))
 await act(async()=>render())
 await act(async()=>{const el=document.querySelector('details');el.open=true;el.dispatchEvent(new Event('toggle'))})
 await input('New package name','Seasonal service');assert.equal(button('Save these lines as a package').disabled,true)
 await act(async()=>resolveRead());assert.equal(saves,0)
 await act(async()=>{button('Save these lines as a package').click();button('Save these lines as a package').click()});assert.equal(saves,1)
 await act(async()=>resolveSave());assert.match(text(),/Package saved/)
 lines=[{description:'',quantity:'1',unit_price:'',tax_rate:'0'}];await act(async()=>render());await click('Add package to draft')
 assert.equal(lines.length,1);assert.equal(lines[0].quantity,'2');assert.equal(lines[0].unit_price,'50')
 lines=Array.from({length:50},()=>({...lines[0]}));await act(async()=>render());await click('Add package to draft');assert.equal(lines.length,50);assert.match(text(),/50-line limit/)
 await click('Remove saved package');assert.equal(rows.length,0);assert.equal(lines.length,50);assert.match(text(),/Existing documents keep their lines/)
 console.log('PASS: package loading guard, explicit save deduplication, quantity/price copy, overflow preservation and archive without document changes.')
}finally{await act(async()=>root.unmount());await supabase?.auth.stopAutoRefresh();await supabase?.removeAllChannels();await server.close();dom.window.close()}
process.exit(0)
