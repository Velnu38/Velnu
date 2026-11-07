import {useEffect,useRef,useState,type FormEvent} from 'react'
import {getSmsSetupStatus,requestMobileCode,confirmMobileCode,type SmsSetupStatus} from '../../services/smsSetup'
import {normalizeMobile} from '../../lib/smsPhone'
import {useUnsavedChanges} from '../../lib/unsavedChanges'
export default function SmsSetup({businessId}:{businessId:string}){
 const [status,setStatus]=useState<SmsSetupStatus|null>(null),[phone,setPhone]=useState(''),[requested,setRequested]=useState(''),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[until,setUntil]=useState(0),[now,setNow]=useState(Date.now())
 const inFlight=useRef(false),sequence=useRef(0),guard=useUnsavedChanges(busy)
 const remaining=Math.max(0,Math.ceil((until-now)/1000)),normalized=normalizeMobile(phone)
 useEffect(()=>{if(until<=Date.now())return;const timer=window.setTimeout(()=>setNow(Date.now()),1000);return()=>clearTimeout(timer)},[until,now])
 async function refresh(){const n=++sequence.current;try{const next=await getSmsSetupStatus(businessId);if(n===sequence.current){setStatus(next);setError('')}}catch(e){if(n===sequence.current)setError((e as Error).message)}}
 useEffect(()=>{setStatus(null);setPhone('');setRequested('');setCode('');void refresh();return()=>{sequence.current++}},[businessId])
 async function send(){
  if(inFlight.current||remaining>0||!normalized)return
  inFlight.current=true;setBusy(true);setError('');setNotice('');setUntil(Date.now()+60000);setNow(Date.now())
  try{const target=await requestMobileCode(businessId,phone,requested===normalized);setRequested(target);setCode('');setNotice('Verification requested. Enter the six-digit code when it arrives.')}catch(e){setError((e as Error).message)}finally{inFlight.current=false;setBusy(false)}
 }
 async function verify(e:FormEvent){e.preventDefault();if(inFlight.current||!requested||requested!==normalized)return
  inFlight.current=true;setBusy(true);setError('');setNotice('')
  try{setStatus(await confirmMobileCode(businessId,requested,code.trim()));setRequested('');setCode('');setPhone('');guard.markClean();setNotice('Your mobile number is verified. Messaging activation still needs the provider setup below.')}catch(e){setError((e as Error).message)}finally{inFlight.current=false;setBusy(false)}
 }
 return <section className="settings-panel" aria-label="Owner mobile verification" data-saving={busy?'true':undefined}>
  <h2>Text messaging setup</h2><p>Before sending texts, the primary business owner must verify an SMS-capable mobile number. Account creation continues to use email.</p>
  {!status&&!error&&<p role="status">Checking your verified number…</p>}
  {status&&<p className="form-message" role="status">{status.owner_mobile_verified?`Owner mobile verified · ending ${status.phone_last4}`:'Owner mobile verification required. SMS sending is locked until verification succeeds.'}</p>}
  {status&&!status.phone_verification_available&&<p className="form-message">Mobile verification is awaiting SMS provider setup. Your email login remains available.</p>}
  <form onSubmit={verify} onInputCapture={guard.markDirty}><fieldset className="form-dialog-fields" disabled={busy||!status}>
   <label>Owner mobile number<input type="tel" autoComplete="tel" inputMode="tel" maxLength={32} placeholder="+1 757 555 0123" value={phone} onChange={e=>{setPhone(e.target.value);setCode('');setError('');setNotice('')}}/></label>
   <p className="quiet">This verifies the number on your account. It is separate from the business contact printed on documents, the texting sender, and your customers’ phone numbers.</p>
   <button type="button" className="secondary-button" disabled={!normalized||remaining>0||status?.phone_verification_available!==true} onClick={()=>void send()}>{busy?'Working…':remaining>0?`Wait ${remaining}s`:requested===normalized?'Resend verification code':'Send verification code'}</button>
   {requested&&requested===normalized&&<><label>Verification code<input type="text" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} required/></label><button className="primary-button" disabled={!/^\d{6}$/.test(code)}>{busy?'Checking…':'Verify mobile number'}</button></>}
  </fieldset></form>
  {notice&&<p className="form-message" role="status">{notice}</p>}{error&&<p className="form-message error-text" role="alert">{error}</p>}
  <button type="button" className="text-button" disabled={busy} onClick={()=>void refresh()}>Refresh verification status</button>
  <div className="settings-inset"><h3>Messaging activation</h3><p>Customer invoice and estimate texting is awaiting provider activation. Verifying your mobile is one required step; sender registration, recipient permission and delivery configuration are also required. No customer message is sent by this setup.</p></div>
 </section>
}
