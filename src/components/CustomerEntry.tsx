import { useState } from 'react'
import CustomerPicker from './CustomerPicker'
import './scheduling/scheduling.css'
export type CustomerDraft = { name: string; email: string; phone: string; company?:string }
export type CustomerChoice = { id: string; first_name: string | null; last_name: string | null; company: string | null; email?: string | null; phone?: string | null }
export const emptyCustomerDraft = (): CustomerDraft => ({name:'',email:'',phone:''})
export function newCustomerFields(draft:CustomerDraft) {
  const words=draft.name.trim().split(/\s+/)
  if(!draft.name.trim()&&!draft.company?.trim())throw new Error('Enter the customer name or choose a saved customer.')
  if(draft.email.trim()&&!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(draft.email.trim()))throw new Error('Enter a valid customer email or leave it blank.')
  return {company:draft.company?.trim()||null,first_name:draft.name.trim()?words[0]:null,last_name:words.slice(1).join(' ')||null,email:draft.email.trim()||null,phone:draft.phone.trim()||null}
}
export default function CustomerEntry({customers,value,draft,onChange,onDraft,disabled=false,showSuggestions=false}:{customers:CustomerChoice[];value:string;draft:CustomerDraft;onChange:(id:string)=>void;onDraft:(next:CustomerDraft)=>void;disabled?:boolean;showSuggestions?:boolean}) {
  const [creating, setCreating] = useState(false)
  return <fieldset className="customer-entry full" disabled={disabled}><legend>Customer</legend>
    {!creating && <CustomerPicker customers={customers} value={value} required disabled={disabled} initialQuery={draft.name} initiallyOpen={showSuggestions}
      onQueryChange={name => onDraft({...draft,name})} onChange={onChange} />}
    {!value && <button type="button" className="text-button" onMouseDown={event => event.preventDefault()} onClick={() => setCreating(current => !current)}>{creating ? 'Search saved customers' : 'Create a new customer'}</button>}
    {creating && !value && <>
      <label>New customer name<input aria-label="Customer name" required={!draft.company?.trim()} autoComplete="name" maxLength={160} value={draft.name} onChange={event => onDraft({...draft,name:event.target.value})}/></label>
      <label>Company (if applicable)<input value={draft.company||''} maxLength={160} onChange={event=>onDraft({...draft,company:event.target.value})}/></label>
      <details><summary>Add email or phone (optional)</summary><div className="form-grid"><label>Customer email<input type="email" autoComplete="email" maxLength={254} value={draft.email} onChange={event=>onDraft({...draft,email:event.target.value})}/></label><label>Customer phone<input type="tel" autoComplete="tel" maxLength={40} value={draft.phone} onChange={event=>onDraft({...draft,phone:event.target.value})}/></label></div></details>
      <p className="quiet">A new customer record will be saved with this document.</p>
    </>}
  </fieldset>
}
