import {readableError} from '../lib/errors'
import {useEffect,useRef,useState,type FormEvent} from 'react'
import FormDialog from './FormDialog'
import {supabase} from '../lib/supabase'
import {archiveCustomer,updateCustomer,type CustomerInput} from '../services/customers'

export default function CustomerEditDialog({businessId,customerId,contactField,onClose,onSaved,onDeleted}:{businessId:string;customerId:string;contactField?:'email'|'phone';onClose:()=>void;onSaved:()=>void;onDeleted?:()=>void}) {
 const [form,setForm]=useState<CustomerInput|null>(null),[version,setVersion]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const [confirmDelete,setConfirmDelete]=useState(false)
 const saving=useRef(false)
 async function deleteContact(){
  if(saving.current||!onDeleted)return
  saving.current=true;setBusy(true);setError('')
  try{await archiveCustomer(customerId,businessId,version);onClose();onDeleted()}
  catch(err){setError(readableError(err,'Unable to delete contact. Please try again.'))}
  finally{saving.current=false;setBusy(false)}
 }
 useEffect(()=>{let active=true;void supabase.from('customers').select('*').eq('business_id',businessId).eq('id',customerId).single().then(({data,error})=>{if(!active)return;if(error)setError('Unable to load customer. Close and try again.');else{setForm(data);setVersion(data.updated_at)}});return()=>{active=false}},[businessId,customerId])
 const heading=contactField==='email'?'Edit customer email':contactField==='phone'?'Edit customer phone':'Edit customer'
 return <FormDialog label={heading} busy={busy} onClose={onClose}>
  <div className="modal-head"><h2>{heading}</h2><button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button></div>
  {!form&&!error&&<p role="status">Loading customer…</p>}
  {form&&!confirmDelete&&<form className="form-grid" onSubmit={async(e:FormEvent)=>{e.preventDefault();if(saving.current)return;saving.current=true;setBusy(true);setError('');try{await updateCustomer(customerId,form,businessId,version);onSaved();onClose()}catch(err){setError(readableError(err,'Unable to save customer. Your changes are still here.'))}finally{saving.current=false;setBusy(false)}}}>
   {(contactField?[contactField]:['first_name','last_name','company','email','phone'] as const).map(key=><label key={key}>{({first_name:'First name',last_name:'Last name',company:'Company (if applicable)',email:'Email',phone:'Phone'})[key]}<input type={key==='email'?'email':key==='phone'?'tel':'text'} maxLength={key==='email'?254:160} value={form[key]||''} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}
   {!contactField&&<label className="full">Internal notes<textarea maxLength={4000} value={form.notes||''} onChange={e=>setForm({...form,notes:e.target.value})}/></label>}
   <div className="modal-actions full"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy}>{busy?'Saving…':'Save customer changes'}</button></div>
   {onDeleted&&<button type="button" className="secondary-button error-text" onClick={()=>{setError('');setConfirmDelete(true)}}>Delete Contact</button>}
  </form>}
  {form&&confirmDelete&&<section aria-label="Confirm contact deletion">
   <h3>Delete this contact?</h3>
   <p>{[form.first_name,form.last_name].filter(Boolean).join(' ')||form.company||'This contact'} will be removed from your active customer list. Existing invoices, estimates, payments, jobs, and service addresses will be retained. Unsaved contact edits will be discarded.</p>
   <div className="modal-actions"><button type="button" className="secondary-button" onClick={()=>{setConfirmDelete(false);setError('')}}>Keep contact</button><button type="button" className="secondary-button error-text" disabled={busy} onClick={()=>void deleteContact()}>{busy?'Deleting…':'Confirm Delete Contact'}</button></div>
  </section>}
  {error&&<p role="alert" className="error-text">{error}</p>}
 </FormDialog>
}
