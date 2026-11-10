import assert from 'node:assert/strict'
import {JSDOM,VirtualConsole} from 'jsdom'
import {createServer} from 'vite'
process.env.VITE_SUPABASE_URL='https://test.supabase.co';process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test-key'
const dom=new JSDOM('<div id="root"></div>',{url:'https://finviant.test/',pretendToBeVisual:true,virtualConsole:new VirtualConsole()})
for(const key of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','Element','Node','Event','CustomEvent','MutationObserver','history','location','localStorage','sessionStorage'])globalThis[key]=key==='window'?dom.window:dom.window[key]
dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false};
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client'),root=createRoot(document.getElementById('root'))
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}})
let supabase,calls=[]
let settings={plan:'pro',ready_email:true,ready_sms:true,rule:{enabled:false,lead_hours:48,channel:'email'},tasks:[]}
let override={mode:'custom',lead_hours:36,channel:'email',recipient_phone:'+12125550100',sms_consented:false,sms_opted_out:false,effective:{enabled:true,lead_hours:36,channel:'email'},business_rule:{enabled:true,lead_hours:48,channel:'sms'},shared_occurrence:true}
async function change(el,value){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('change',{bubbles:true}))})}
try{
 ({supabase}=await server.ssrLoadModule('/src/lib/supabase.ts'))
 supabase.rpc=async(name,args)=>{calls.push({name,args});if(name==='get_appointment_reminder_settings')return {data:structuredClone(settings),error:null};if(name==='save_appointment_reminder_settings'){settings.rule={enabled:args.p_enabled,lead_hours:args.p_lead_hours,channel:args.p_channel};return {data:structuredClone(settings),error:null}};if(name==='record_appointment_sms_permission'){override.sms_consented=true;return {data:true,error:null}};if(name==='save_appointment_reminder_override'){override={...override,mode:args.p_mode,lead_hours:args.p_lead_hours,channel:args.p_channel}};return {data:structuredClone(override),error:null}}
 const {default:Defaults}=await server.ssrLoadModule('/src/components/settings/AppointmentReminderDefaults.tsx')
 await act(async()=>root.render(React.createElement(Defaults,{businessId:'business'})))
 assert.equal(document.querySelector('input[type=number]').value,'48');assert.equal(document.querySelector('input[type=checkbox]').checked,false);assert.equal(calls.length,1)
 await act(async()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
 assert.equal(calls.at(-1).args.p_enabled,false);assert.match(document.body.textContent,/paused/)
 const {default:Dialog}=await server.ssrLoadModule('/src/components/scheduling/AppointmentReminderDialog.tsx')
 await act(async()=>root.render(React.createElement(Dialog,{businessId:'business',appointmentId:'appointment',onClose:()=>{}})))
 assert.match(document.body.textContent,/Linked entries/)
 await change(document.querySelector('select'),'inherit');assert.match(document.body.textContent,/48 hours before arrival by SMS/)
 assert.equal(document.querySelector('input[type=checkbox]').checked,false)
 await act(async()=>document.querySelector('input[type=checkbox]').click())
 await act(async()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
 assert.deepEqual(calls.at(-2),{name:'record_appointment_sms_permission',args:{p_business:'business',p_appointment:'appointment',p_consent:true,p_expected_phone:'+12125550100'}})
 assert.equal(calls.at(-1).name,'save_appointment_reminder_override');assert.match(document.body.textContent,/No message was sent/)
 await change(document.querySelector('select'),'off');assert.equal(document.querySelector('input[type=checkbox]'),null)
 console.log('PASS: 48h disabled defaults, explicit save, shared occurrence, inherited SMS preview, purpose-specific expected-phone consent, off control.')
}finally{await act(async()=>root.unmount());await supabase?.auth.stopAutoRefresh();await supabase?.removeAllChannels();await server.close();dom.window.close()}
process.exit(0)
