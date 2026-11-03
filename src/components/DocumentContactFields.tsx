import type { CurrentBusiness } from '../lib/business'
export type DocumentContact = { email: string; phone: string }
export default function DocumentContactFields({business,value,onChange}:{business:CurrentBusiness;value:DocumentContact;onChange:(value:DocumentContact)=>void}) {
 return <details className="document-payment-options"><summary>Your business contact</summary>
  <p className="quiet">Customers see these details on your invoices and estimates. Email replies go to your business email when delivery is enabled. Your personal phone is optional; adding a number does not activate text delivery.</p>
  <fieldset disabled={!business.primary_owner}><div className="form-grid">
   <label>Business reply email<input type="email" maxLength={254} autoComplete="email" value={value.email} onChange={e=>onChange({...value,email:e.target.value})}/></label>
   <label>Business contact phone<input type="tel" maxLength={40} autoComplete="tel" value={value.phone} onChange={e=>onChange({...value,phone:e.target.value})}/></label>
  </div></fieldset><p className="quiet">{business.primary_owner?'Changes save with this document and become your business contact for future documents. Both fields are optional.':'The primary owner can update these contact details.'}</p>
 </details>
}
