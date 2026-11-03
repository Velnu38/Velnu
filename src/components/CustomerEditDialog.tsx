import {readableError} from '../lib/errors'
import {useEffect,useRef,useState,type FormEvent} from 'react'
import FormDialog from './FormDialog'
import {supabase} from '../lib/supabase'
import {updateCustomer,type CustomerInput} from '../services/customers'

export default function CustomerEditDialog({businessId,customerId,onClose,onSaved}:{businessId:string;customerId:string;onClose:()=>void;onSaved:()=>void}) {
 const [form,setForm]=useState<CustomerInput|null>(null),[version,setVersion]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const saving=useRef(false)
 useEffect(()=>{let active=true;void supabase.from('customers').select('*').eq('business_id',businessId).eq('id',customerId).single().then(({data,error})=>{if(!active)return;if(error)setError('Unable to load customer. Close and try again.');else{setForm(data);setVersion(data.updated_at)}});return()=>{active=false}},[businessId,customerId])
 return <FormDialog label="Edit customer" busy={busy} onClose={onClose}>
  <div className="modal-head"><h2>Edit customer</h2><button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button></div>
  {!form&&!error&&<p role="status">Loading customer…</p>}
  {form&&<form className="form-grid" onSubmit={async(e:FormEvent)=>{e.preventDefault();if(saving.current)return;saving.current=true;setBusy(true);setError('');try{await updateCustomer(customerId,form,businessId,version);onSaved();onClose()}catch(err){setError(readableError(err,'Unable to save customer. Your changes are still here.'))}finally{saving.current=false;setBusy(false)}}}>
   {(['first_name','last_name','company','email','phone'] as const).map(key=><label key={key}>{({first_name:'First name',last_name:'Last name',company:'Company',email:'Email',phone:'Phone'})[key]}<input type={key==='email'?'email':key==='phone'?'tel':'text'} maxLength={key==='email'?254:160} value={form[key]||''} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}
   <label className="full">Internal notes<textarea maxLength={4000} value={form.notes||''} onChange={e=>setForm({...form,notes:e.target.value})}/></label>
   <div className="modal-actions full"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy}>{busy?'Saving…':'Save customer changes'}</button></div>
  </form>}{error&&<p role="alert" className="error-text">{error}</p>}
 </FormDialog>
}
