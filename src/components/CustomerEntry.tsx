import './scheduling/scheduling.css'
export type CustomerDraft = { name: string; email: string; phone: string; company?:string }
export type CustomerChoice = { id: string; first_name: string | null; last_name: string | null; company: string | null }
export const emptyCustomerDraft = (): CustomerDraft => ({name:'',email:'',phone:''})
export function newCustomerFields(draft:CustomerDraft) {
  const words=draft.name.trim().split(/\s+/)
  if(!draft.name.trim()&&!draft.company?.trim())throw new Error('Enter the customer name or choose a saved customer.')
  if(draft.email.trim()&&!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(draft.email.trim()))throw new Error('Enter a valid customer email or leave it blank.')
  return {company:draft.company?.trim()||null,first_name:draft.name.trim()?words[0]:null,last_name:words.slice(1).join(' ')||null,email:draft.email.trim()||null,phone:draft.phone.trim()||null}
}
export default function CustomerEntry({customers,value,draft,onChange,onDraft,disabled=false}:{customers:CustomerChoice[];value:string;draft:CustomerDraft;onChange:(id:string)=>void;onDraft:(next:CustomerDraft)=>void;disabled?:boolean}) {
  const name=(c:CustomerChoice)=>[c.first_name,c.last_name].filter(Boolean).join(' ')||c.company||'Customer'
  const selected=customers.find(c=>c.id===value)
  const matches=draft.name.trim()?customers.filter(c=>name(c).toLowerCase().includes(draft.name.trim().toLowerCase())).slice(0,5):[]
  return <fieldset className="customer-entry full" disabled={disabled}><legend>Customer</legend>
    <label>Customer name<input aria-label="Customer name" readOnly={!!value} required={!value&&!draft.company?.trim()} autoComplete="name" maxLength={160} value={selected?name(selected):draft.name} placeholder="Type a new name or choose a saved customer" onChange={e=>{onChange('');onDraft({...draft,name:e.target.value})}}/></label>
    {value&&<button type="button" className="text-button" onClick={()=>{onChange('');onDraft(emptyCustomerDraft())}}>Use a new customer instead</button>}
    {!value&&<label>Company name (optional)<input value={draft.company||''} maxLength={160} onChange={e=>onDraft({...draft,company:e.target.value})}/></label>}
    {!value&&matches.length>0&&<div className="customer-matches" aria-label="Matching saved customers">{matches.map(c=><button key={c.id} type="button" className="text-button" onClick={()=>onChange(c.id)}>Use {name(c)}</button>)}</div>}
    {!value&&<details><summary>Add email or phone (optional)</summary><div className="form-grid"><label>Customer email<input type="email" autoComplete="email" maxLength={254} value={draft.email} onChange={e=>onDraft({...draft,email:e.target.value})}/></label><label>Customer phone<input type="tel" autoComplete="tel" maxLength={40} value={draft.phone} onChange={e=>onDraft({...draft,phone:e.target.value})}/></label></div></details>}
    {customers.length>0&&<details open={!!value}><summary>Choose from saved customers</summary><label>Saved customer<select aria-label="Customer" value={value} onChange={e=>onChange(e.target.value)}><option value="">Enter a new customer above</option>{customers.map(c=><option key={c.id} value={c.id}>{name(c)}</option>)}</select></label></details>}
    {!value&&<p className="quiet">New customer details are saved with this document.</p>}
  </fieldset>
}
