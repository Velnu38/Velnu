import { useRef,useState } from 'react'
import { createCustomer } from '../../services/customers'
export type QuickCustomerRecord={id:string;first_name:string|null;last_name:string|null;company:string|null;email?:string|null;phone?:string|null}
export default function QuickCustomer({businessId,onCreated}:{businessId:string;onCreated:(customer:QuickCustomerRecord)=>void}) {
  const [open,setOpen]=useState(false),[name,setName]=useState(''),[email,setEmail]=useState(''),[phone,setPhone]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const saving=useRef(false),pending=useRef<{signature:string;id:string}|null>(null)
  async function save(){
    if(saving.current||!name.trim())return
    if(email&&!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email.trim())){setError('Enter a valid email address, or leave it blank.');return}
    saving.current=true;setBusy(true);setError('')
    try{
      const words=name.trim().split(/\s+/),input={first_name:words[0],last_name:words.slice(1).join(' '),email,phone},signature=JSON.stringify(input)
      if(pending.current?.signature!==signature)pending.current={signature,id:crypto.randomUUID()}
      const customer=await createCustomer(businessId,input,pending.current.id)
      onCreated(customer);setOpen(false);setName('');setEmail('');setPhone('');pending.current=null
    }catch(e){setError(e instanceof Error?e.message:'Customer creation is not confirmed. Retry with the same details.')}
    finally{saving.current=false;setBusy(false)}
  }
  if(!open)return <button type="button" className="text-button" onClick={()=>setOpen(true)}>+ Add customer without leaving this draft</button>
  return <fieldset className="guided-workers" onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void save()}}}><legend>New customer</legend><div className="guided-form-grid"><label>Name<input autoComplete="name" maxLength={160} value={name} onChange={e=>setName(e.target.value)}/></label><label>Email (optional)<input type="email" autoComplete="email" maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Phone (optional)<input type="tel" autoComplete="tel" maxLength={40} value={phone} onChange={e=>setPhone(e.target.value)}/></label></div>{error&&<p role="alert" className="form-message error-text">{error}</p>}<div className="guided-actions"><button type="button" className="secondary-button compact" disabled={busy} onClick={()=>setOpen(false)}>Cancel new customer</button><button type="button" className="primary-button compact" disabled={busy||!name.trim()} onClick={()=>void save()}>{busy?'Adding customer…':'Add & select customer'}</button></div></fieldset>
}
