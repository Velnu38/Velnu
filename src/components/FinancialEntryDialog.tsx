import { useRef, useState, type FormEvent } from 'react'
import { DateTime } from 'luxon'
import type { CurrentBusiness } from '../lib/business'
import { canAccess, canOpenView } from '../lib/workspaceAccess'
import { addManualEntry, type EntryDirection } from '../services/bookkeeping'
import FormDialog from './FormDialog'

export default function FinancialEntryDialog({business,onClose,onSaved}:{business:CurrentBusiness;onClose:()=>void;onSaved:(date:string,direction:EntryDirection)=>void}) {
 const [direction,setDirection]=useState<EntryDirection|null>(null)
 const [amount,setAmount]=useState(''),[category,setCategory]=useState('Materials & supplies'),[description,setDescription]=useState(''),[notes,setNotes]=useState('')
 const [entryDate,setEntryDate]=useState(()=>DateTime.now().setZone(business.timezone||'America/New_York').toISODate()!)
 const [busy,setBusy]=useState(false),[error,setError]=useState('')
 const inFlight=useRef(false),retry=useRef<{signature:string;id:string}|null>(null)
 if(!canAccess(business,'finances'))return null
 async function saveManual(event:FormEvent) {
  event.preventDefault();if(inFlight.current||!direction)return
  inFlight.current=true;setBusy(true);setError('')
  try {
   const payload={business_id:business.id,direction,entry_date:entryDate,category,description,notes,amount:Number(amount)}
   const signature=JSON.stringify(payload)
   if(retry.current?.signature!==signature)retry.current={signature,id:crypto.randomUUID()}
   await addManualEntry({...payload,id:retry.current.id})
  }catch(e){setError(e instanceof Error?e.message:'Unable to save entry.');inFlight.current=false;setBusy(false);return}
  inFlight.current=false;setBusy(false)
  onSaved(entryDate,direction)
  window.dispatchEvent(new Event('finviant-work-changed'))
 }
 return <FormDialog label={direction==='income'?'Add Income':direction==='expense'?'Add Expense':'Add financial entry'} busy={busy} onClose={onClose}>
  <div className="modal-head"><h2>{direction==='income'?'Add Income':direction==='expense'?'Add Expense':'Add Entry'}</h2><button type="button" className="icon-button" aria-label="Close" disabled={busy} onClick={onClose}>×</button></div>
  {!direction?<div className="home-create-options">{(['income','expense'] as const).map(kind=><button type="button" key={kind} onClick={()=>{setDirection(kind);setCategory(kind==='income'?'Other received income':'Materials & supplies')}}><strong>{kind==='income'?'Add Income':'Add Expense'}</strong></button>)}</div>:<>
  {direction==='income'&&<p>Payment for an existing invoice? {canOpenView(business,'payments')?<a href="/?view=payments&action=record">Select invoice and record payment</a>:'Record it through your authorized billing team.'} Invoice payments appear automatically. Use this form only for other income.</p>}
  {error&&<p role="alert" className="error-text">{error}</p>}
        <form className="bookkeeping-entry-form" onSubmit={saveManual}>
          <label>Entry type <select value={direction} onChange={e => { setDirection(e.target.value as EntryDirection); setCategory(e.target.value === 'income' ? 'Other received income' : 'Materials & supplies') }}>
            <option value="expense">Expense / money spent</option><option value="income">Other income / money received</option></select></label>
          <label>Transaction date <input aria-label="Transaction date" type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)} required /></label>
          <label>Amount in USD ($) <input aria-label="Amount in USD" type="number" min="0.01" max="100000000" step=".01" value={amount} onChange={e => setAmount(e.target.value)} required /></label>
          <label>Category <select value={category} onChange={e => setCategory(e.target.value)}>
            {(direction === 'expense' ? ['Materials & supplies','Equipment & tools','Fuel & travel','Contractor payments','Software & subscriptions','Office expenses','Insurance','Other expense']
              : ['Other received income','Cash sale (not invoiced)','Additional service income','Miscellaneous income']).map(x => <option key={x}>{x}</option>)}
          </select></label>
          <label className="full">Description <input aria-label="Description" value={description} maxLength={400} onChange={e => setDescription(e.target.value)} placeholder="What was paid for?" required /></label>
          <label className="full">Notes (optional) <textarea aria-label="Notes" value={notes} maxLength={2000} rows={2} onChange={e => setNotes(e.target.value)} placeholder="Receipt or reference notes" /></label>
          <p className="bookkeeping-small full">This creates a bookkeeping record only. It does not withdraw, deposit, charge, or transfer funds.</p>
          <div className="bookkeeping-entry-actions full"><button type="button" className="secondary-button" disabled={busy} onClick={() => onClose()}>Cancel</button>
            <button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save entry'}</button></div>
        </form>

  </>}
 </FormDialog>
}
