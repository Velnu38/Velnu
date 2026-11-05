import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

type Operation={id:string;kind:string;status:string;provider_id:string|null;created_at:string;result:{message?:string}}
type TestStatus={sms_owner_verified?:boolean;subscription?:{status:string;cancel_at_period_end:boolean}|null;configuration:{stripe:boolean;stripe_webhook:boolean;connect_webhook:boolean;sms:boolean};state:{stripe_account?:string;stripe_customer?:string;stripe_subscription?:string};operations:Operation[];invoices:{id:string;invoice_number:string;balance_due:number}[]}
export { integrationTestingAvailable } from '../../lib/settingsNavigation'
async function invoke(body:Record<string,unknown>){
 const {data,error}=await supabase.functions.invoke('private-integration-testing',{body})
 if(error){const context=(error as {context?:unknown}).context;if(context instanceof Response){const value=await context.clone().json().catch(()=>null);if(value?.error)throw new Error(value.error)}throw new Error('Integration tests could not be reached. Retry status before starting another test.')}
 if(data?.error)throw new Error(data.error)
 return data
}
export default function IntegrationTesting({businessId}:{businessId:string}){
 const [status,setStatus]=useState<TestStatus|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
 const [plan,setPlan]=useState('pro'),[invoice,setInvoice]=useState(''),[phone,setPhone]=useState(''),[consent,setConsent]=useState(false)
 const [link,setLink]=useState<{url:string;action:string}|null>(null)
 const inFlight=useRef(false),ids=useRef(new Map<string,string>()),version=useRef(0)
 async function refresh(){const n=++version.current;try{const next=await invoke({business_id:businessId,action:'status'});if(n===version.current){setStatus(next);setError('')}}catch(e){if(n===version.current)setError((e as Error).message)}}
 useEffect(()=>{setStatus(null);setLink(null);setError('');ids.current.clear();void refresh();return()=>{version.current++}},[businessId])
 async function run(action:string){
  if(inFlight.current)return
  inFlight.current=true;setBusy(true);setError('');setMessage('');setLink(null)
  try{
   const fields=action==='subscription'?{plan}:action==='invoice'?{invoice_id:invoice}:action==='sms'?{phone:phone.trim(),consent}:{}
   const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(fields))))).map(b=>b.toString(16).padStart(2,'0')).join('')
   const key='finviant-integration-v1:'+businessId+':'+action+':'+fingerprint
   let id=ids.current.get(key)
   try{id=id||sessionStorage.getItem(key)||undefined}catch{/* Optional retry storage. */}
   if(!id)id=crypto.randomUUID()
   ids.current.set(key,id);try{sessionStorage.setItem(key,id)}catch{/* Keep the in-memory ID. */}
   const result=await invoke({business_id:businessId,action,request_id:id,...fields})
   if(result.url){const url=new URL(result.url);if(url.protocol!=='https:'||!['checkout.stripe.com','connect.stripe.com','billing.stripe.com'].includes(url.hostname)||url.username||url.password)throw new Error('Provider link could not be verified.');setLink({url:result.url,action})}
   setMessage(result.message||(result.url?'Your test is ready. Open Stripe below. Returning from Stripe does not confirm a successful payment.':'Refresh results to confirm the outcome.'))
   await refresh()
  }catch(e){setError((e as Error).message)}finally{inFlight.current=false;setBusy(false)}
 }
 const config=status?.configuration
 return <section className="settings-panel integration-tests" aria-label="Private integration tests">
  <h2>Integration testing</h2>
  <p className="form-message"><strong>Internal testing only.</strong> Stripe uses test money. Test payments do not change invoice balances or activate paid access. Twilio sends real texts only to approved tester numbers and may incur messaging charges.</p>
  <p>Keep important records backed up. Testing data may be reset. Website access remains restricted separately from these provider tests.</p>
  <button type="button" className="secondary-button" disabled={busy} onClick={()=>void refresh()}>Refresh test results</button>
  {error&&<p className="form-message error-text" role="alert">{error}</p>}
  {message&&<p className="form-message" role="status">{message}</p>}
  {link&&<p><a className="primary-button" href={link.url} target="_blank" rel="noopener noreferrer">{link.action==='connect'?'Continue test merchant setup':link.action==='portal'?'Open test billing portal':'Open test checkout'}</a></p>}
  {!status&&!error&&<p role="status">Checking test configuration…</p>}
  {status&&<>
   <section className="settings-inset"><h3>Finviant subscription test</h3>
    <p>{config?.stripe&&config.stripe_webhook?'Test checkout is configured.':'Setup needed: Stripe test key and signed webhook.'}</p>
    {status.subscription&&<p role="status">Test subscription: {status.subscription.status}{status.subscription.cancel_at_period_end?' — cancellation scheduled at period end.':''}</p>}
    <label>Test plan<select value={plan} disabled={busy} onChange={e=>setPlan(e.target.value)}><option value="basic">Basic — $9.99/month in test money</option><option value="pro">Pro — $24.99/month in test money, five users</option></select></label>
    <div className="settings-actions"><button type="button" className="primary-button" disabled={busy||!config?.stripe||!config.stripe_webhook||!!status.state.stripe_subscription} onClick={()=>void run('subscription')}>Prepare test subscription</button><button type="button" className="secondary-button" disabled={busy||!config?.stripe||!status.state.stripe_customer} onClick={()=>void run('portal')}>Manage test subscription</button></div>
    <p className="quiet">Use Stripe test card details only. The portal supports payment-method changes, billing history and cancellation. Refresh here after returning.</p>
   </section>
   <section className="settings-inset"><h3>Customer invoice payment test</h3>
    <p>Payments belong to the business’s separate test merchant account.</p>
    <button type="button" className="secondary-button" disabled={busy||!config?.stripe} onClick={()=>void run('connect')}>{status.state.stripe_account?'Continue test merchant setup':'Set up test merchant'}</button>
    <label>Issued invoice to test<select value={invoice} disabled={busy} onChange={e=>setInvoice(e.target.value)}><option value="">Choose an invoice</option>{status.invoices.map(i=><option key={i.id} value={i.id}>{i.invoice_number} — ${Number(i.balance_due).toFixed(2)} unpaid</option>)}</select></label>
    <button type="button" className="primary-button" disabled={busy||!invoice||!status.state.stripe_account||!config?.stripe||!config.stripe_webhook||!config.connect_webhook} onClick={()=>void run('invoice')}>Prepare test invoice payment</button>
    {!config?.connect_webhook&&<p className="quiet">A signed Connect test webhook is required. The latest 100 issued invoices with an unpaid balance are available here; use a dedicated test invoice.</p>}
   </section>
   <section className="settings-inset"><h3>Twilio SMS delivery test</h3>
    <p>{config?.sms?'Tester messaging is configured.':'Setup needed: Twilio credentials, sending number and approved recipient list.'}</p>
    {status.sms_owner_verified!==true&&<p className="form-message">Verify your owner mobile first in <a href="/?view=settings&sms_setup=1">Text messaging setup</a>.</p>}
    <label>Approved tester phone<input type="tel" autoComplete="off" placeholder="+17575550123" value={phone} disabled={busy} onChange={e=>{setPhone(e.target.value);setConsent(false)}}/></label>
    <label><span><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/> I have permission to send this test text to this number.</span></label>
    <p className="quiet">Message: “Finviant internal test: SMS delivery is working. No payment is requested.”</p>
    <button type="button" className="primary-button" disabled={busy||status.sms_owner_verified!==true||!config?.sms||!consent||!/^\+[1-9]\d{7,14}$/.test(phone.trim())} onClick={()=>void run('sms')}>{busy?'Processing test…':'Send approved test text'}</button>
   </section>
   <section className="settings-inset"><h3>Recent test results</h3>
    <p className="quiet">Accepted means the provider received the request. Paid and Delivered require verified provider confirmation.</p>
    {!status.operations.length?<p>No tests recorded yet.</p>:<ul className="integration-test-results">{status.operations.map(op=><li key={op.id}><strong>{op.kind==='invoice'?'Invoice payment':op.kind==='sms'?'SMS':op.kind} · {op.status}</strong><span>{new Date(op.created_at).toLocaleString()}</span>{op.result.message&&<span>{op.result.message}</span>}</li>)}</ul>}
   </section>
  </>}
 </section>
}
