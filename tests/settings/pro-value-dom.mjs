import assert from 'node:assert/strict'
import {JSDOM,VirtualConsole} from 'jsdom'
import {createServer} from 'vite'
process.env.VITE_SUPABASE_URL='https://test.supabase.co';process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test-key';process.env.VITE_ENABLE_PRIVATE_BETA_EMAIL='true';process.env.VITE_ENABLE_CUSTOMER_ACTIONS='false'
const dom=new JSDOM('<div id="root"></div>',{url:'https://finviant.test/?view=settings&section=plans',pretendToBeVisual:true,virtualConsole:new VirtualConsole()})
for(const key of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','Element','Node','Event','CustomEvent','MutationObserver','history','location','localStorage','sessionStorage'])globalThis[key]=key==='window'?dom.window:dom.window[key]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client'),root=createRoot(document.getElementById('root'))
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}})
const B='11111111-1111-4111-8111-111111111111';let items=[{id:'service-1',description:'Mowing',unit_price:75,tax_rate:5}],created=0,lines=[{description:'',quantity:'1',unit_price:'',tax_rate:'0'}],usageReads=0,supabase
const tick=()=>act(()=>new Promise(resolve=>setTimeout(resolve,40)))
const button=name=>[...document.querySelectorAll('button')].find(b=>b.textContent===name)
const click=async name=>{const b=button(name);assert.ok(b,name);assert.equal(b.disabled,false);await act(async()=>b.click());await tick()}
const change=async(label,value)=>{const el=[...document.querySelectorAll('label')].find(x=>x.textContent.startsWith(label))?.querySelector('select');assert.ok(el,label);await act(async()=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}))});await tick()}
const realFetch=globalThis.fetch;globalThis.fetch=async url=>{assert.ok(String(url).startsWith('/api/calendar?'));return new Response(JSON.stringify({integrations:[],providers:{google:false,outlook:true}}),{headers:{'content-type':'application/json'}})}
try{
 ({supabase}=await server.ssrLoadModule('/src/lib/supabase.ts'))
 supabase.auth.getSession=async()=>({data:{session:{access_token:'fixture'}},error:null})
 supabase.from=table=>{assert.equal(table,'service_items');let op='list',body,selected;const q={select(){return q},order(){return q},eq(key,value){if(key==='business_id')assert.equal(value,B);if(key==='id')selected=value;return q},insert(value){op='insert';body=value;return q},update(value){op='update';body=value;return q},range:async()=>({data:items,count:items.length,error:null}),single:async()=>{if(op==='insert'){created++;const data={...body,id:'new-'+created};items.push(data);return{data,error:null}}items=items.filter(i=>i.id!==selected);return{data:{id:selected},error:null}}};return q}
 const{default:Picker}=await server.ssrLoadModule('/src/components/ServiceItemPicker.tsx')
 function Harness(){const[value,setValue]=React.useState(lines);lines=value;return React.createElement(Picker,{businessId:B,lines:value,onChange:setValue})}
 await act(async()=>root.render(React.createElement(Harness)));const details=document.querySelector('details');await act(async()=>{details.open=true;details.dispatchEvent(new Event('toggle'))});await tick()
 await change('Choose saved service','service-1');await click('Add selected service')
 assert.deepEqual(lines,[{description:'Mowing',quantity:'1',unit_price:'75',tax_rate:'5'}]);assert.equal(created,0)
 await click('Remove saved service');assert.equal(items.length,0);assert.equal(lines[0].unit_price,'75','Removing catalog entry preserves document line')
 await click('Save line as reusable service');assert.equal(created,1);assert.equal(items[0].tax_rate,5);assert.equal(items[0].business_id,B)
 await act(async()=>root.unmount());const root2=createRoot(document.getElementById('root'))
 supabase.rpc=async name=>{if(name==='get_plan_usage'){usageReads++;return{data:{plan:'basic',actual_plan:'basic',testing:false,can_test:false,introductory:false,period_end:'2026-12-01',customers_used:12,customers_limit:null,jobs_used:10,jobs_limit:null,seats_used:1,seats_limit:1,ai_used:10,ai_limit:150,voice_used:2,voice_limit:60,email_used:200,email_limit:250,sms_used:0,sms_limit:0},error:null}}if(name==='get_delivery_setup')return{data:{plan:'basic',managed_email_ready:true,managed_sms_ready:false},error:null};if(name==='get_business_storage_usage')return{data:{plan:'basic',used_bytes:10,limit_bytes:2000000000,pending_bytes:0,warning:'none'},error:null};throw Error('Unexpected RPC '+name)}
 const{default:Plans}=await server.ssrLoadModule('/src/components/settings/PlansAndUsage.tsx');await act(async()=>root2.render(React.createElement(Plans,{businessId:B})));await tick();await tick()
 assert.match(document.body.textContent,/200 \/ 250/);assert.match(document.body.textContent,/At least 80% used/);assert.match(document.body.textContent,/Google: provider setup required/);assert.match(document.body.textContent,/Outlook: ready to connect/);assert.match(document.body.textContent,/Not included/);assert.match(document.body.textContent,/One business workspace per account/)
 const before=usageReads;await click('Refresh');assert.ok(usageReads>before);await act(async()=>root2.unmount())
 console.log('PASS: saved service reuse, price/tax preservation, tenant-scoped save/archive, 250 email meter, 80% warning, excluded SMS, provider setup status, workspace limit and consistent refresh.')
}finally{await supabase?.auth.stopAutoRefresh();await supabase?.removeAllChannels();await server.close();dom.window.close();globalThis.fetch=realFetch}
process.exit(0)
