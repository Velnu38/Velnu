import {useEffect,useRef,type ComponentProps} from 'react'
import FinBrand from './FinBrand'
import DocumentPaper from './DocumentPaper'
import {validDeliveryEmail} from './DocumentDeliveryOptions'
import {normalizeMobile} from '../lib/smsPhone'
import {customerActionsEnabled} from '../lib/releaseFlags'
export default function CreationPreview({paper,busy,error,saved=false,onBack,onSave,onEmail}:{paper:ComponentProps<typeof DocumentPaper>;busy:boolean;error:string;saved?:boolean;onBack:()=>void;onSave:()=>void;onEmail:()=>void}){
 const heading=useRef<HTMLHeadingElement>(null)
 useEffect(()=>{heading.current?.focus();heading.current?.closest('dialog')?.scrollTo({top:0})},[])
 const email=paper.customer?.email?.trim()||'',phone=paper.customer?.phone?.trim()||''
 const emailValid=validDeliveryEmail(email),phoneValid=!!normalizeMobile(phone)
 return <section className="creation-preview" data-saving={busy?'true':undefined}>
 <button type="button" className="back-button" data-keep-dialog disabled={busy} onClick={onBack}>← Back to edit</button>
 <div className="creation-brand"><FinBrand wordmark/></div>
 <h2 ref={heading} tabIndex={-1}>{paper.kind==='invoice'?'Invoice':'Estimate'} preview</h2>
 <DocumentPaper {...paper}/>
 {error&&<p role="alert" className="form-message error-text">{error}</p>}
 {saved&&<p role="status">This document is saved. Delivery is not confirmed. Retry uses the same document; Back to edit opens its saved record.</p>}
 <div className="creation-delivery-actions">
 <div><button type="button" className="primary-button" disabled aria-describedby="creation-sms-help">Send SMS</button><small id="creation-sms-help">{phoneValid?'SMS delivery is awaiting setup.':phone?'Correct mobile number in customer details.':'Add mobile number in customer details.'}</small></div>
 <div><button type="button" className="primary-button" disabled={busy||!emailValid||!customerActionsEnabled} onClick={onEmail} aria-describedby="creation-email-help">{busy?'Working…':'Send Email'}</button><small id="creation-email-help">{!emailValid?'Add a valid email in customer details.':!customerActionsEnabled?'Email delivery is not enabled for this private test app.':`To: ${email}`}</small></div>
 <div><button type="button" className="secondary-button" disabled={busy} onClick={onSave}>{busy?'Working…':saved?'Done':'Save Draft'}</button><small>{saved?'Open the saved document.':'Save without sending.'}</small></div>
 </div></section>
}
