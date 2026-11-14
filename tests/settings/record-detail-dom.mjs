import assert from 'node:assert/strict'
import {JSDOM,VirtualConsole} from 'jsdom'
import {createServer} from 'vite'

process.env.VITE_SUPABASE_URL='https://test.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY='test-key'
process.env.VITE_ENABLE_PRIVATE_BETA_EMAIL='true'
const vc=new VirtualConsole()
vc.on('jsdomError',error=>{if(!/Not implemented: navigation/.test(error.message))throw error})
const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'https://finviant.test/',pretendToBeVisual:true,virtualConsole:vc})
for(const name of ['window','document','HTMLElement','HTMLInputElement','Element','Node','Event','CustomEvent','MouseEvent','KeyboardEvent','MutationObserver','HTMLDialogElement','history','location','localStorage','sessionStorage'])globalThis[name]=name==='window'?dom.window:dom.window[name]
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
HTMLDialogElement.prototype.showModal=function(){this.open=true}
HTMLDialogElement.prototype.close=function(){this.open=false}
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client')
const root=createRoot(document.getElementById('root'))
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}})
const B='11111111-1111-4111-8111-111111111111',D='55555555-5555-4555-8555-555555555555',R='77777777-7777-4777-8777-777777777777',T='a'.repeat(64)
let pdfRequests=0,sendCalls=[],queryFilters=[],messageStatus='sent',copied=[],shares=[],sent=0,copyPreparations=0,failSend=true,plan='pro'
let releaseSend=null,holdSend=false
let supabase
const objectUrls=new Map();let nextUrl=0
const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL
URL.createObjectURL=blob=>{const url='blob:https://finviant.test/'+(++nextUrl);objectUrls.set(url,blob);return url}
URL.revokeObjectURL=url=>objectUrls.delete(url)
Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>copied.push(text)},configurable:true})
Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true})
Object.defineProperty(navigator,'share',{value:async data=>shares.push(data),configurable:true})
globalThis.fetch=async()=>{pdfRequests++;return new Response('%PDF-1.7\nSaved reviewed document',{headers:{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="Invoice.pdf"','X-Finviant-Revision-Id':R}})}
const tick=()=>act(()=>new Promise(resolve=>setTimeout(resolve,35)))
const mount=async(Component,props,key)=>{await act(async()=>root.render(React.createElement(Component,{...props,key})));await tick()}
const button=label=>[...document.querySelectorAll('button')].find(item=>item.textContent.trim()===label)
const click=async label=>{const item=button(label);assert.ok(item,label+' exists');assert.equal(item.disabled,false);await act(async()=>item.click());await tick()}
try{
 ;({supabase}=await server.ssrLoadModule('/src/lib/supabase.ts'))
 supabase.auth.getSession=async()=>({data:{session:{access_token:'owner-token',user:{id:'owner'}}},error:null})
 supabase.rpc=async name=>name==='get_delivery_setup'?{data:{plan,personal_email_ready:true,personal_sms_ready:true,managed_email_ready:true,managed_sms_ready:false},error:null}:{data:null,error:null}
 supabase.from=table=>{
  assert.equal(table,'messages');const filters=[]
  const query={select:()=>query,eq:(key,value)=>{filters.push([key,value]);return query},maybeSingle:async()=>{queryFilters.push(filters);return{data:{status:messageStatus},error:null}}}
  return query
 }
 Object.defineProperty(supabase,'functions',{configurable:true,value:{invoke:async(name,{body})=>{
  sendCalls.push({name,body})
  if(holdSend)await new Promise(resolve=>{releaseSend=resolve})
  if(failSend)return{data:null,error:{context:new Response(JSON.stringify({error:'Email outcome is uncertain. Retry this same send.'}),{status:503})}}
  return{data:{status:'accepted',email_id:'provider-id',recipient:'customer@example.test'},error:null}
 }}})
 const {RecordTabs,RecordMoreMenu,RecordActionBar}=await server.ssrLoadModule('/src/components/RecordDetail.tsx')
 const {default:Dialog,DocumentDeliveryRecovery:Recovery}=await server.ssrLoadModule('/src/components/DocumentDeliveryDialog.tsx')
 const {default:LegacyActions}=await server.ssrLoadModule('/src/components/DocumentActions.tsx')
 const h=React.createElement
 function Tabs(){const [active,setActive]=React.useState('details');return h(RecordTabs,{tabs:[{id:'details',label:'Details'},{id:'photos',label:'Photos & expenses'},{id:'activity',label:'Activity'}],active,onChange:setActive})}
 await mount(Tabs,{},'tabs')
 const tabs=[...document.querySelectorAll('[role=tab]')]
 assert.deepEqual(tabs.map(tab=>tab.textContent),['Details','Photos & expenses','Activity'])
 await act(async()=>tabs[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));await tick()
 assert.equal(tabs[1].getAttribute('aria-selected'),'true');assert.equal(document.activeElement,tabs[1])
 await mount(RecordActionBar,{primary:h('button',null,'Send'),secondary:h('button',null,'Edit'),more:h('button',null,'Archive')},'actions')
 assert.equal(document.querySelectorAll('.record-action-primary>button').length,1)
 assert.equal(document.querySelectorAll('.record-action-secondary>button').length,1)
 assert.equal(document.querySelector('details').open,false)
 await act(async()=>document.querySelector('summary').click());await tick()
 assert.equal(document.querySelector('details').open,true)
 await act(async()=>document.querySelector('summary').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
 assert.equal(document.querySelector('details').open,false)
 await mount(RecordActionBar,{primary:h('button',null,'Send'),more:h(React.Fragment,null,false,null,h(React.Fragment,null,false))},'empty-more')
 assert.equal(document.querySelector('details'),null,'empty conditional actions never create an empty More')
 await mount(RecordMoreMenu,{children:h('button',{'data-keep-dialog':true},'Expand review')},'embedded')
 await act(async()=>document.querySelector('summary').click());await click('Expand review')
 assert.equal(document.querySelector('details').open,true,'embedded review toggle remains open')
 await mount(LegacyActions,{primary:null,secondary:h('button',null,'Change order action')},'legacy')
 assert.equal(document.querySelector('summary').textContent.trim(),'More actions⌄')
 assert.equal(document.querySelector('details').open,false,'change order compatibility keeps secondary actions collapsed')

 const props={businessId:B,kind:'invoice',documentId:D,email:'customer@example.test',phone:'+17575550123',onEditContact:()=>{},onSent:()=>{sent++},onClose:()=>{}}
 await mount(Dialog,{...props,open:false},'closed')
 assert.equal(pdfRequests,0);assert.equal(sendCalls.length,0)
 await mount(Dialog,{...props,open:true},'send')
 assert.equal(sendCalls.length,0,'opening delivery never sends')
 assert.equal(document.querySelector('iframe'),null,'PDF begins as compact row')
 assert.equal([...document.querySelectorAll('button')].filter(item=>item.textContent==='Download PDF').length,1)
 await click('View PDF');assert.ok(document.querySelector('iframe'))
 await click('Send Email');assert.match(document.body.textContent,/Retry this same send/)
 assert.equal(sendCalls[0].body.expected_revision_id,R)
 failSend=false;holdSend=true
 await act(async()=>button('Retry email').click());await tick()
 assert.equal(document.querySelector('[aria-label="Close delivery"]').disabled,true,'busy delivery cannot be closed')
 assert.equal(sendCalls[1].body.request_id,sendCalls[0].body.request_id,'retry preserves the same operation')
 await act(async()=>releaseSend());await tick();holdSend=false
 assert.equal(sent,1);assert.match(document.body.textContent,/accepted for delivery/)

 let attention=null,opened=0
 const recover={businessId:B,kind:'invoice',documentId:D,onOpen:()=>{opened++},onRecoveryChange:value=>{attention=value}}
 await mount(Recovery,recover,'accepted-recovery')
 assert.equal(document.querySelector('.record-delivery-recovery'),null,'accepted operation never hides primary action')
 assert.equal(attention,false)
 assert.deepEqual(queryFilters.at(-1),[['business_id',B],['invoice_id',D],['id',sendCalls[0].body.request_id]])
 messageStatus='uncertain';await mount(Recovery,recover,'uncertain-recovery')
 assert.equal(attention,true);await click('Review delivery');assert.equal(opened,1)
 assert.equal(sendCalls.length,2,'recovery never attempts another send')
 sessionStorage.setItem(`finviant-send:owner:${B}:invoice:${D}`,JSON.stringify({token:T,channel:'email'}))
 messageStatus='sent';await mount(Recovery,recover,'personal-recovery')
 assert.match(document.body.textContent,/app draft is waiting for confirmation/)
 await mount(Dialog,{...props,open:true,initialIntent:'retry'},'personal-retry')
 assert.ok(button('Confirm sent'),'reviewing an existing app draft opens its confirmation without preparing a new send')
 assert.equal(button('Send Email'),undefined)
 sessionStorage.removeItem(`finviant-send:owner:${B}:invoice:${D}`)

 await mount(Dialog,{...props,open:true,initialIntent:'schedule'},'schedule')
 assert.equal([...document.querySelectorAll('details')].find(item=>item.querySelector('summary')?.textContent==='Schedule email delivery').open,true)
 assert.equal(sendCalls.length,2,'schedule intent never sends automatically')
 await mount(Dialog,{...props,open:true,initialIntent:'share'},'pro-copy')
 assert.ok(button('Send Email'));assert.equal(button('Open email app'),undefined,'Pro copy defaults to managed sending')
 plan='free';await mount(Dialog,{...props,open:true},'personal-compact')
 assert.equal([...document.querySelectorAll('button')].filter(item=>item.textContent==='Download PDF').length,1,'compact personal delivery has one PDF download')
 assert.ok(button('Send Text'));assert.ok(button('Copy Link'));assert.ok(button('Prepare PDF to share'));plan='pro'
 const before=sendCalls.length
 await mount(Dialog,{...props,open:true,readOnly:true,prepareCopy:async()=>{copyPreparations++;return{url:'https://finviant.test/?document_share='+T,revisionId:R}}},'copy')
 assert.equal(button('Send Email'),undefined);assert.equal(button('Send Text'),undefined)
 await click('Copy Link');assert.equal(copied.at(-1),'https://finviant.test/?document_share='+T)
 await click('Share PDF');assert.equal(shares.length,1);assert.equal(copyPreparations,1);assert.equal(sendCalls.length,before)
 await mount(Dialog,{...props,open:true,readOnly:true,prepareCopy:async()=>({url:'https://finviant.test/?document_share='+T,revisionId:'changed-revision'})},'changed-copy')
 const prior=copied.length;await click('Copy Link')
 assert.equal(copied.length,prior);assert.match(document.body.textContent,/changed after review/)
 console.log('Record UI: keyboard tabs, collapsed actions, compact delivery, exact retry/PDF guards, scoped recovery, and closed-copy sharing passed')
}finally{
 await act(async()=>root.unmount());await supabase?.auth.stopAutoRefresh();await supabase?.removeAllChannels();await server.close();URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;dom.window.close()
}
process.exit(0)
