import './scheduling/scheduling.css'
import type { PaymentLink } from '../services/settings'
import { paymentProviders } from '../lib/paymentLinks'
export type DocumentPayments={payment_links:PaymentLink[];payment_instructions:string}
export default function PaymentOptionsFields({value,onChange,editable=true}:{value:DocumentPayments;onChange:(next:DocumentPayments)=>void;editable?:boolean}) {
  return <details className="document-payment-options"><summary>How customers can pay</summary><p className="quiet">Choose payment methods and instructions for this document. Payment links use your own business accounts.</p>
    <fieldset disabled={!editable}><legend>Payment methods</legend><div className="form-grid">{paymentProviders.map(p=>{const link=value.payment_links.find(l=>l.provider===p.id);return <div key={p.id}><label className="settings-checkbox"><input type="checkbox" checked={!!link} onChange={e=>onChange({...value,payment_links:e.target.checked?[...value.payment_links,{provider:p.id,url:''}]:value.payment_links.filter(l=>l.provider!==p.id)})}/>{p.name}</label>{link&&<label>{p.name} payment link<input type="url" required maxLength={1000} placeholder={p.example} value={link.url} onChange={e=>onChange({...value,payment_links:value.payment_links.map(l=>l.provider===p.id?{...l,url:e.target.value.trim()}:l)})}/></label>}</div>})}</div>
    <label>Payment instructions<textarea maxLength={2000} placeholder="Cash, check, or instructions for your Stripe or Square payment link" value={value.payment_instructions} onChange={e=>onChange({...value,payment_instructions:e.target.value})}/></label></fieldset>
    {!editable&&<p className="quiet">The primary account owner manages payment destinations.</p>}
  </details>
}
