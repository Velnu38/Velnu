import {useId} from 'react'
import {normalizeMobile} from '../lib/smsPhone'
import {customerActionsEnabled} from '../lib/releaseFlags'
import type {DeliveryDocumentKind} from '../services/reviewDelivery'
import './document-review.css'

export const validDeliveryEmail=(value:string)=>value.length<=254&&/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value.trim())

/** One contact-aware delivery layout for both unsaved and saved reviews. */
export default function DocumentDeliveryOptions({kind,email='',phone='',disabled=false,contactDisabled=false,emailDisabled=false,sending=false,emailLabel='Send Email',onEmail,onEditContact,hideSms=false}:{
 kind:DeliveryDocumentKind;email?:string|null;phone?:string|null;disabled?:boolean;contactDisabled?:boolean;emailDisabled?:boolean;sending?:boolean;emailLabel?:string;hideSms?:boolean;onEmail:()=>void;onEditContact?:()=>void
}){
 const id=useId(),address=email?.trim()||'',number=phone?.trim()||''
 const emailValid=!!address&&validDeliveryEmail(address),phoneValid=!!normalizeMobile(number)
 return <section className="document-delivery" aria-label={hideSms?"Email sending":"Send to customer"}>
  <div className="document-delivery-heading"><h2>Send to customer</h2>{onEditContact&&<button type="button" className="text-button" disabled={contactDisabled||sending} onClick={onEditContact}>{address||number?'Edit customer contact':'Add email or phone'}</button>}</div>
  <p className="quiet">{kind==='invoice'?'Send this invoice to the customer.':'Send this '+kind.replace('_',' ')+' for customer approval.'}</p>
  <div className="document-delivery-grid">
   {<div className="document-delivery-option"><span id={id+'-email'}>{emailValid?'To: '+address:'Add a valid email address'}</span><button type="button" className="primary-button" aria-describedby={id+'-email'+(!customerActionsEnabled?' '+id+'-email-status':'')} disabled={disabled||emailDisabled||sending||!customerActionsEnabled||!emailValid} onClick={onEmail}>{sending?'Sending email…':emailLabel}</button>{!customerActionsEnabled&&<p id={id+'-email-status'} className="quiet">Email delivery is not enabled for this private test app.</p>}</div>}
   {!hideSms&&<div className="document-delivery-option"><span id={id+'-phone'}>{phoneValid?'To: '+number:'Add a valid mobile number'}</span><button type="button" className="primary-button" disabled aria-describedby={id+'-phone '+id+'-sms-status'}>Send Text</button><p id={id+'-sms-status'} className="quiet">Customer text delivery is awaiting SMS setup. No text has been sent.</p></div>}
  </div>
  {address&&!emailValid&&<p className="form-message error-text">Correct the customer email address to enable email delivery.</p>}
  {number&&!phoneValid&&<p className="form-message error-text">Correct the customer phone number to enable SMS delivery.</p>}
  {!address&&!number&&<p className="quiet">Add a customer email or mobile number to enable its sending option once delivery is configured. You can keep this as a draft.</p>}
 </section>
}
