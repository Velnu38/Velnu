import {useEffect,useRef,useState,type ComponentProps} from 'react'
import {getDeliverySetup,type DeliverySetup} from '../services/tiers'
import DocumentPaper from './DocumentPaper'
import {validDeliveryEmail} from './DocumentDeliveryOptions'
import {normalizeMobile} from '../lib/smsPhone'
import {customerActionsEnabled} from '../lib/releaseFlags'
export default function CreationPreview({paper,busy,error,saved=false,onBack,onSave,onEmail}:{paper:ComponentProps<typeof DocumentPaper>;busy:boolean;error:string;saved?:boolean;onBack:()=>void;onSave:()=>void;onEmail:()=>void}){
 const [setup,setSetup]=useState<DeliverySetup|null>(null),[setupError,setSetupError]=useState('')
 useEffect(()=>{let active=true;const businessId=paper.business.id;if(!businessId){setSetupError('Reopen this draft to load sending setup.');return}void getDeliverySetup(businessId).then(value=>{if(active)setSetup(value)}).catch(e=>{if(active)setSetupError(e.message)});return()=>{active=false}},[paper.business.id])
 const personal=setup?.plan!=='pro'
 const heading=useRef<HTMLHeadingElement>(null)
 useEffect(()=>{heading.current?.focus();heading.current?.closest('dialog')?.scrollTo({top:0})},[])
 const email=paper.customer?.email?.trim()||'',phone=paper.customer?.phone?.trim()||''
 const emailValid=validDeliveryEmail(email),phoneValid=!!normalizeMobile(phone)
 return <section className="creation-preview" data-saving={busy?'true':undefined}>
 <button type="button" className="back-button" data-keep-dialog disabled={busy} onClick={onBack}>← Back to edit</button>
 <h2 ref={heading} tabIndex={-1}>{paper.kind==='invoice'?'Invoice':'Estimate'} preview</h2>
 <DocumentPaper {...paper}/>
 {error&&<p role="alert" className="form-message error-text">{error}</p>}
 {saved&&<p role="status">This document is saved. Delivery is not confirmed. Retry uses the same document; Back to edit opens its saved record.</p>}
 {setupError&&<p role="alert">{setupError}</p>}<p className="quiet"><a href="/?view=settings&section=delivery">Email &amp; Text Setup</a>. Your selected tier controls how sending works.</p>
 <div className="creation-delivery-actions">
 <div><button type="button" className="primary-button" disabled={busy||!setup||!phoneValid||!(personal?setup.personal_sms_ready:setup.managed_sms_ready)} onClick={onSave} aria-describedby="creation-sms-help">Send Text</button><small id="creation-sms-help">{!phoneValid?'Add a valid mobile number in customer details.':!setup?'Checking sending setup…':(personal?setup.personal_sms_ready:setup.managed_sms_ready)?'Saves the draft, then opens text delivery review.':'Complete text sending setup first.'}</small></div>
 <div><button type="button" className="primary-button" disabled={busy||!emailValid||!setup||!(personal?setup.personal_email_ready:setup.managed_email_ready&&customerActionsEnabled)} onClick={personal?onSave:onEmail} aria-describedby="creation-email-help">{busy?'Working…':'Send Email'}</button><small id="creation-email-help">{!emailValid?'Add a valid email in customer details.':!setup?'Checking sending setup…':personal?`To: ${email}. Saves the draft; finish sending from the saved record using your email app.`:!setup.managed_email_ready?'Finviant email requires sender activation.':`To: ${email}`}</small></div>
 <div><button type="button" className="secondary-button" disabled={busy} onClick={onSave}>{busy?'Working…':saved?'Done':'Save Draft'}</button><small>{saved?'Open the saved document.':'Save without sending.'}</small></div>
 </div></section>
}
