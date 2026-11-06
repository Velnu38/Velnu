import ManagedSmsDelivery from './ManagedSmsDelivery'
import {confirmPersonalSent,preparePersonalDocument,type PreparedShare} from '../services/personalDelivery'
import {personalEmailHref,personalSmsHref} from '../lib/personalDelivery'
import {useEffect,useRef,useState,type ComponentProps} from 'react'
import {getDeliverySetup,type DeliverySetup} from '../services/tiers'
import DocumentPaper from './DocumentPaper'
import {validDeliveryEmail} from './DocumentDeliveryOptions'
import {normalizeMobile} from '../lib/smsPhone'
import {customerActionsEnabled} from '../lib/releaseFlags'
export default function CreationPreview({paper,busy,error,saved=false,onBack,onSave,onEmail,saveForDelivery,canUpgrade=false}:{paper:ComponentProps<typeof DocumentPaper>;busy:boolean;error:string;saved?:boolean;onBack:()=>void;onSave:()=>void;onEmail:()=>void;saveForDelivery:()=>Promise<string|undefined>;canUpgrade?:boolean}){
 const [setup,setSetup]=useState<DeliverySetup|null>(null),[setupError,setSetupError]=useState('')
 useEffect(()=>{let active=true;const businessId=paper.business.id;if(!businessId){setSetupError('Reopen this draft to load sending setup.');return}void getDeliverySetup(businessId).then(value=>{if(active)setSetup(value)}).catch(e=>{if(active)setSetupError(e.message)});return()=>{active=false}},[paper.business.id])
 const personal=setup?.plan!=='pro'
 const [sending,setSending]=useState(false),[deliveryError,setDeliveryError]=useState('')
 const [handoff,setHandoff]=useState<{share:PreparedShare;href:string;channel:'email'|'sms'}|null>(null)
 const flight=useRef(false)
 async function personalSend(channel:'email'|'sms'){
  if(flight.current||!paper.business.id)return
  flight.current=true;setSending(true);setDeliveryError('')
  try{
   const id=await saveForDelivery();if(!id)return
   const share=await preparePersonalDocument(paper.business.id,paper.kind,id)
   const sameRecipient=channel==='email'
    ?share.snapshot.customer.email?.trim().toLowerCase()===email.toLowerCase()
    :normalizeMobile(share.snapshot.customer.phone||'')===normalizeMobile(phone)
   if(!sameRecipient)throw new Error('The saved customer contact changed. Open the saved document to review it before sending.')
   const href=channel==='email'
    ?personalEmailHref(share.snapshot.customer.email||'',share.subject,share.body)
    :personalSmsHref(share.snapshot.customer.phone||'',share.subject+'\nReview: '+share.url)
   setHandoff({share,href,channel})
   window.location.href=href
  }catch(e){setDeliveryError(e instanceof Error?e.message:'Unable to open your sending app.')}
  finally{flight.current=false;setSending(false)}
 }
 async function markSent(){
  if(flight.current||!handoff||!paper.business.id)return
  flight.current=true;setSending(true);setDeliveryError('')
  try{await confirmPersonalSent(paper.business.id,handoff.share.token,handoff.channel);onSave()}
  catch(e){setDeliveryError(e instanceof Error?e.message:'Unable to record the send.')}
  finally{flight.current=false;setSending(false)}
 }
 const locked=busy||sending
 const heading=useRef<HTMLHeadingElement>(null)
 useEffect(()=>{heading.current?.focus();heading.current?.closest('dialog')?.scrollTo({top:0})},[])
 const email=paper.customer?.email?.trim()||'',phone=paper.customer?.phone?.trim()||''
 const emailValid=validDeliveryEmail(email),phoneValid=!!normalizeMobile(phone)
 return <section className="creation-preview" data-saving={locked?'true':undefined}>
 <button type="button" className="back-button" data-keep-dialog disabled={locked} onClick={onBack}>← Back to edit</button>
 <h2 ref={heading} tabIndex={-1}>{paper.kind==='invoice'?'Invoice':'Estimate'} preview</h2>
 <DocumentPaper {...paper} finviantBranding={setup?.plan==='free'}/>
 {canUpgrade&&setup?.plan==='free'&&<p className="quiet"><a href="/?view=settings&section=plans">Compare plans for unbranded {paper.kind}s</a></p>}
 {error&&<p role="alert" className="form-message error-text">{error}</p>}
 {saved&&!handoff&&<p role="status">This document is saved. Delivery is not confirmed. Retry uses the same document; Back to edit opens its saved record.</p>}
 {setupError&&<p role="alert">{setupError}</p>}<p className="quiet"><a href="/?view=settings&section=delivery">Email &amp; Text Setup</a>. Your selected tier controls how sending works.</p>
 <div className="creation-delivery-actions">
 {handoff ? <div>
  <p role="status">Finish sending in your {handoff.channel==='email'?'email':'messaging'} app, then confirm here.</p>
  <button type="button" className="primary-button" disabled={locked} onClick={()=>void markSent()}>I sent it — mark sent</button>
  <button type="button" className="text-button" disabled={locked} onClick={()=>setHandoff(null)}>I did not send it</button>
  <p><a href={handoff.href}>Open the {handoff.channel==='email'?'email':'text'} draft again</a></p>
 </div> : <>
 {setup&&!personal&&paper.business.id
  ? <ManagedSmsDelivery businessId={paper.business.id} kind={paper.kind} phone={phone} ready={setup.managed_sms_ready} disabled={locked} saveDocument={saveForDelivery} onBusyChange={setSending} onSent={onSave}/>
  : <div><button type="button" className="primary-button" disabled={locked||!setup?.personal_sms_ready||!phoneValid} onClick={()=>void personalSend('sms')}>Send Text</button><small>{!phoneValid?'Add a valid mobile number in customer details.':setup?.personal_sms_ready?'Opens a draft in your messaging app.':'Complete text sending setup first.'}</small></div>}
 <div><button type="button" className="primary-button" disabled={locked||!emailValid||!setup||!(personal?setup.personal_email_ready:setup.managed_email_ready&&customerActionsEnabled)} onClick={personal?()=>void personalSend('email'):onEmail}>{locked?'Working…':'Send Email'}</button><small>{!emailValid?'Add a valid email in customer details.':!setup?'Checking sending setup…':personal?`To: ${email}. Opens a draft in your email app.`:!setup.managed_email_ready?'Finviant email requires sender activation.':`To: ${email}`}</small></div>
 </>}
 {deliveryError&&<p role="alert" className="form-message error-text">{deliveryError}</p>}
 <div><button type="button" className="secondary-button" disabled={locked} onClick={onSave}>{busy?'Working…':saved?'Done':'Save Draft'}</button><small>{saved?'Open the saved document.':'Save without sending.'}</small></div>
 </div></section>
}
