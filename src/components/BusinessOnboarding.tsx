import {useEffect,useRef,useState,type FormEvent} from 'react'
import FinBrand from './FinBrand'
import PrivateBetaNotice from './PrivateBetaNotice'
import SmsSetup from './settings/SmsSetup'
import {supabase} from '../lib/supabase'
import {createBusiness,updateBusinessProfile,draftFromBusiness,emptyBusinessProfile,type CurrentBusiness} from '../lib/business'
import {getDeliverySetup,saveDeliverySetup,type DeliverySetup} from '../services/tiers'
import {useUnsavedChanges} from '../lib/unsavedChanges'
type Channel='email'|'text'|'both'
type Progress={required:boolean;channels:Channel|null;completed?:boolean}
async function progress(id:string,channels?:Channel,complete=false):Promise<Progress>{
 const {data,error}=await supabase.rpc('business_onboarding_status',{p_business:id,p_channels:channels??null,p_complete:complete})
 if(error)throw new Error(error.message)
 return data
}
export default function BusinessOnboarding({business,onCreated}:{business?:CurrentBusiness;onCreated:(business:CurrentBusiness)=>void}){
 const [draft,setDraft]=useState(()=>business?draftFromBusiness(business):{...emptyBusinessProfile})
 const [saved,setSaved]=useState(business??null),[channel,setChannel]=useState<Channel|''>(''),[step,setStep]=useState(0)
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(!!business),[error,setError]=useState(''),[delivery,setDelivery]=useState<DeliverySetup|null>(null)
 const [accountEmail,setAccountEmail]=useState(''),[ack,setAck]=useState(false),[emailApp,setEmailApp]=useState(false),[textApp,setTextApp]=useState(false),[verifyMobile,setVerifyMobile]=useState(false)
 const running=useRef(false),requestId=useRef(crypto.randomUUID()),guard=useUnsavedChanges(busy)
 const wantsEmail=channel==='email'||channel==='both',wantsText=channel==='text'||channel==='both'
 useEffect(()=>{let active=true;void supabase.auth.getUser().then(r=>{if(active)setAccountEmail(r.data.user?.email??'')}).catch(()=>{});
  if(business)void progress(business.id).then(async p=>{const d=await getDeliverySetup(business.id);if(active){setChannel(p.channels??'');setDelivery(d);setAck(d.acknowledged);setEmailApp(d.personal_email_ready);setTextApp(d.personal_sms_ready);setStep(p.channels?2:0)}}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)})
  return()=>{active=false}
 },[business?.id])
 function update(key:keyof typeof draft,value:string){setDraft(d=>({...d,[key]:value}));setError('')}
 async function loadReadiness(id:string){setDelivery(null);try{setError('');setDelivery(await getDeliverySetup(id))}catch(e){setError(e instanceof Error?e.message:'Could not check sending readiness. Retry before finishing.')}}
 async function saveContacts(event:FormEvent){event.preventDefault();if(running.current)return
  if(!channel){setError('Choose Email, Text or Both.');return}
  if(wantsText&&!/^[0-9]{10,15}$/.test(draft.phone.replace(/\D/g,''))){setError('Enter a valid mobile number with area code.');return}
  running.current=true;setBusy(true);setError('')
  try{const record=saved?await updateBusinessProfile(saved,draft):await createBusiness(draft,requestId.current);setSaved(record)
   await progress(record.id,channel);guard.markClean();setStep(2);await loadReadiness(record.id)
  }catch(e){setError(e instanceof Error?e.message:'Unable to save. Your entries are kept; please retry.')}
  finally{running.current=false;setBusy(false)}
 }
 async function finish(event:FormEvent){event.preventDefault();if(running.current||!saved||!channel||!delivery||!ack)return
  running.current=true;setBusy(true);setError('')
  try{const d=await saveDeliverySetup(saved.id,{email:draft.email,phone:draft.phone,emailReady:wantsEmail&&emailApp,smsReady:wantsText&&textApp});setDelivery(d)
   const p=await progress(saved.id,channel,true);if(!p.completed)throw new Error('Setup completion could not be confirmed. Please retry.')
   guard.markClean();window.dispatchEvent(new Event('finviant-delivery-changed'));setStep(3)
  }catch(e){setError(e instanceof Error?e.message:'Unable to confirm setup completion. Please retry.')}
  finally{running.current=false;setBusy(false)}
 }
 const emailManaged=delivery?.plan!=='free',smsManaged=delivery?.plan==='pro'
 const emailStatus=emailManaged?(delivery?.managed_email_ready?'Finviant email activated':'Finviant email activation pending'):(emailApp?'Personal email app confirmed by you':'Personal email app setup needed')
 const textStatus=smsManaged?(delivery?.managed_sms_ready?'Finviant texting activated':'Text verification / sender activation pending'):(textApp?'Personal text app confirmed by you':'Personal text app setup needed')
 const field=(key:keyof typeof draft,label:string,placeholder:string,type='text',required=false)=><label>{label}<input type={type} value={draft[key]??''} required={required} disabled={busy} maxLength={key==='email'?254:160} placeholder={placeholder} onChange={e=>update(key,e.target.value)}/></label>
 return <main className="onboarding-page"><section className="onboarding-card quick-onboarding"><FinBrand/>
  <ol className="onboarding-progress" aria-label="Business setup progress">{['Welcome','Business contact','Sending readiness','Setup saved'].map((s,i)=><li key={s} aria-current={step===i?'step':undefined} className={i<=step?'active':''}><span>{i<step?'✓':i+1}</span>{s}</li>)}</ol>
  {loading?<p role="status">Restoring your saved setup…</p>:<>
  {step===0&&<form onSubmit={e=>{e.preventDefault();if(!draft.name.trim()||!channel){setError('Enter your business name and choose a sending method.');return}setError('');setStep(1)}} onChangeCapture={guard.markDirty}>
   <h1>Thank You for choosing Finviant!</h1><p>Let’s get your business ready. Start with the essentials—you can personalize it later.</p><PrivateBetaNotice compact disclosure/>
   {field('name','Business name · Required','Your business name','text',true)}<p className="quiet">Appears on your invoices, estimates, and customer messages.</p>
   <fieldset className="onboarding-channels"><legend>How will you send customer documents? · Required</legend>{(['email','text','both'] as const).map(c=><label key={c} className={channel===c?'selected':''}><input type="radio" name="sending-method" required value={c} checked={channel===c} onChange={()=>setChannel(c)}/>{c==='both'?'Both':c==='email'?'Email':'Text'}</label>)}</fieldset>
   <p className="quiet">We’ll ask only for the information your sending methods need. Your plan determines which sending options are available.</p><button className="primary-button" disabled={busy}>Continue</button>
  </form>}
  {step===1&&<form onSubmit={saveContacts} onChangeCapture={guard.markDirty}><h1>Where customers can reach you</h1>
   {wantsEmail&&<>{field('email','Business reply email · Required','name@yourbusiness.com','email',true)}<p className="quiet">Your business documents use this contact address. Your account email remains your sign-in. Finviant-managed replies use the verified reply address shown in sending setup.</p>{accountEmail&&<button type="button" className="text-button" onClick={()=>{update('email',accountEmail);guard.markDirty()}}>Use my verified account email</button>}<p className="quiet">Saving a reply address does not verify or activate a Finviant sending account.</p></>}
   {wantsText&&<>{field('phone','Business / owner mobile · Required for texting','(555) 555-1234','tel',true)}<p className="quiet">For personal texting, use a mobile number with a working messaging app. Business Pro also requires owner verification and an approved Finviant sending number. Your mobile number alone does not activate Finviant texting.</p></>}
   <details className="onboarding-optional"><summary>Optional business details</summary><p className="quiet">Address details appear on customer documents. You can add these later; sender registration may request additional details separately.</p>{field('legal_name','Legal name · Optional','Optional — if different')}{field('website','Website · Optional','Optional — yourbusiness.com')}{field('address_line1','Street address · Optional','Optional — business address')}{field('address_line2','Address line 2 · Optional','Optional — suite or unit')}{field('city','City · Optional','Optional — city')}{field('state','State / region · Optional','Optional — state')}{field('postal_code','Postal / ZIP code · Optional','Optional — ZIP code')}</details>
   <div className="onboarding-actions"><button type="button" className="text-button" disabled={busy} onClick={()=>setStep(0)}>Back</button><button className="primary-button" disabled={busy}>{busy?'Saving…':'Save & continue'}</button></div>
  </form>}
  {step===2&&<form onSubmit={finish} onChangeCapture={guard.markDirty}><h1>Check your sending methods</h1><p>Your business details are saved. Sending availability is checked separately.</p>
   {!delivery?<><p role="status">Sending status could not be confirmed yet.</p><button type="button" className="secondary-button" disabled={busy} onClick={()=>saved&&void loadReadiness(saved.id)}>Retry sending status</button></>:<><button type="button" className="text-button" disabled={busy} onClick={()=>saved&&void loadReadiness(saved.id)}>Refresh sending status</button><p className="eyebrow">{delivery.plan==='pro'?'Business Pro':delivery.plan==='basic'?'Individual':'Free'}</p><div className="onboarding-readiness" aria-live="polite">{wantsEmail&&<article><strong>Email</strong><p>✓ Reply email saved</p><p>{emailStatus}</p>{emailManaged&&<small>Requires verified sender activation and reply handling. Finviant reply address: {delivery.reply_to || 'not configured'}. Saving a contact address does not replace verified reply routing. Beta email is limited to approved recipients.</small>}</article>}{wantsText&&<article><strong>Text</strong><p>✓ Mobile number saved</p><p>{textStatus}</p>{smsManaged&&<small>Requires owner verification, approved sending number, recipient permission and reply handling.</small>}</article>}</div>
   <details><summary>Using your own email or messaging apps</summary><p>Configure your device’s sending app. The account selected in that app is the actual sender; you must select Send there. Finviant cannot confirm personal-app delivery.</p>{wantsEmail&&<label className="onboarding-check"><input type="checkbox" checked={emailApp} onChange={e=>setEmailApp(e.target.checked)}/>My email app is configured.</label>}{wantsText&&<label className="onboarding-check"><input type="checkbox" checked={textApp} onChange={e=>setTextApp(e.target.checked)}/>My text app and mobile service are configured.</label>}</details>
   {wantsText&&smsManaged&&saved&&<><button type="button" className="text-button" onClick={()=>setVerifyMobile(v=>!v)}>{verifyMobile?'Hide mobile verification':'Verify owner mobile'}</button>{verifyMobile&&<p className="quiet">Verify below or finish in More → Text Messaging Setup after opening your workspace.</p>}</>}
   <label className="onboarding-check"><input type="checkbox" required checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/>I understand sending must be activated or my personal app configured, and I must review recipients and obtain required permission. Provider costs and limits apply.</label>
   <p className="quiet">Pending channels stay unavailable through Finviant until activated. Copy Link and PDF options remain available. Detailed sending setup, sample drafts, and registration are available in More.</p>
   <div className="onboarding-actions"><button type="button" className="text-button" disabled={busy} onClick={()=>{setStep(1);setError('')}}>Back</button><button className="primary-button" disabled={busy||!ack}>{busy?'Saving setup…':'Save & finish setup'}</button></div></>}
  </form>}
  {step===2&&verifyMobile&&saved&&<SmsSetup businessId={saved.id}/>}
  {step===3&&saved&&<div role="status" className="onboarding-complete"><span className="onboarding-success" aria-hidden="true">✓</span><h1>Your required business details are saved!</h1><p>Your workspace is ready. All required setup fields are complete.</p><ul><li>✓ Business name saved</li>{wantsEmail&&<li>✓ Reply email saved</li>}{wantsText&&<li>✓ Mobile number saved</li>}</ul><div className="onboarding-readiness">{wantsEmail&&<p>{emailStatus}</p>}{wantsText&&<p>{textStatus}</p>}</div><p className="quiet">Saving your details does not activate pending sending services. You can finish those checks from More.</p><button type="button" className="primary-button" onClick={()=>onCreated({...saved,onboarding_required:false})}>Open my dashboard</button><p className="onboarding-later"><a href="/?view=settings&section=documents">Add logo later</a><span aria-hidden="true"> · </span><a href="/?view=settings&section=company">Tell Fin about your business</a></p><p className="quiet">These are optional. You can update your details anytime in More.</p></div>}
  {error&&<p role="alert" className="form-message error-text">{error}</p>}
  </>}
 </section></main>
}
