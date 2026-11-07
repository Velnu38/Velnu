import { useRef, useState, type FormEvent } from 'react'
import { DateTime } from 'luxon'
import type { CurrentBusiness } from '../lib/business'
import { canAccess, canOpenView } from '../lib/workspaceAccess'
import { addManualEntry, ReceiptUploadPending, type EntryDirection } from '../services/bookkeeping'
import FormDialog from './FormDialog'
import ReceiptScanField from './ReceiptScanField'
import { useTierUsage } from '../lib/useTierUsage'
import type { ReceiptFile } from '../services/receiptCapture'

export default function FinancialEntryDialog({business,onClose,onSaved}:{business:CurrentBusiness;onClose:()=>void;onSaved:(date:string,direction:EntryDirection)=>void}) {
 const [direction,setDirection]=useState<EntryDirection|null>(null)
 const [amount,setAmount]=useState(''),[category,setCategory]=useState('Materials & supplies'),[description,setDescription]=useState(''),[notes,setNotes]=useState('')
 const [entryDate,setEntryDate]=useState(()=>DateTime.now().setZone(business.timezone||'America/New_York').toISODate()!)
 const [busy,setBusy]=useState(false),[error,setError]=useState('')
 const [receipt,setReceipt]=useState<ReceiptFile|null>(null),[scanning,setScanning]=useState(false),[uploadPending,setUploadPending]=useState(false)
 const plan=useTierUsage(business.id)?.plan
 const locked=busy||scanning||uploadPending
 const inFlight=useRef(false),retry=useRef<string|null>(null)
 if(!canAccess(business,'finances'))return null
 function chooseEntry(kind:EntryDirection) {
  setDirection(kind);setCategory(kind==='income'?'Other received income':'Materials & supplies')
 }
 async function saveManual(event:FormEvent) {
  event.preventDefault();if(inFlight.current||scanning||!direction)return
  inFlight.current=true;setBusy(true);setError('')
  try {
   const payload={business_id:business.id,direction,entry_date:entryDate,category,description,notes,amount:Number(amount)}
   retry.current ||= crypto.randomUUID()
   await addManualEntry({...payload,id:retry.current},direction==='expense'?receipt:null)
  }catch(e){if(e instanceof ReceiptUploadPending){setUploadPending(true);window.dispatchEvent(new Event('finviant-work-changed'))}setError(e instanceof Error?e.message:'Unable to save entry.');inFlight.current=false;setBusy(false);return}
  inFlight.current=false;setBusy(false)
  onSaved(entryDate,direction)
  window.dispatchEvent(new Event('finviant-work-changed'))
 }
 const entryOptions=<div className="home-create-options financial-entry-options">{(['income','expense'] as const).map(kind=><button type="button" key={kind} onClick={()=>chooseEntry(kind)}><strong>{kind==='income'?'Add Income':'Add Expense'}</strong></button>)}</div>
 return <FormDialog label={direction==='income'?'Add Income':direction==='expense'?'Add Expense':'Add financial entry'} busy={busy||scanning} cleanVersion={uploadPending} onClose={onClose}>
  <div className="modal-head"><h2>{direction==='income'?'Add Income':direction==='expense'?(receipt?'Review expense':'Add Expense'):'Add Entry'}</h2><button type="button" className="icon-button" aria-label="Close" disabled={busy||scanning} onClick={onClose}>×</button></div>
  {!direction&&plan==='free'&&entryOptions}
  {direction!=='income'&&<ReceiptScanField business={business} plan={plan} disabled={locked} onBusy={setScanning} onPhoto={setReceipt} onStart={()=>{if(!direction)chooseEntry('expense')}} onRead={draft=>{
    setEntryDate(draft.date || '')
    setAmount(draft.total || '')
    if(draft.vendor)setDescription(draft.vendor)
  }}/>}
  {!direction&&plan!=='free'&&entryOptions}
  {direction&&<>
  {direction==='income'&&<p>Payment for an existing invoice? {canOpenView(business,'payments')?<a href="/?view=payments&action=record">Select invoice and record payment</a>:'Record it through your authorized billing team.'} Invoice payments appear automatically. Use this form only for other income.</p>}
  {error&&<p role="alert" className="error-text">{error}</p>}
        <form className="bookkeeping-entry-form" onSubmit={saveManual}>
          <label>Entry type <select value={direction} disabled={locked||!!receipt} onChange={e => chooseEntry(e.target.value as EntryDirection)}>
            <option value="expense">Expense / money spent</option><option value="income">Other income / money received</option></select></label>
          <label>Transaction date <input aria-label="Transaction date" type="date" value={entryDate} disabled={locked} onChange={e => setEntryDate(e.target.value)} required /></label>
          <label>Amount in USD ($) <input aria-label="Amount in USD" type="number" min="0.01" max="100000000" step=".01" value={amount} disabled={locked} onChange={e => setAmount(e.target.value)} required /></label>
          <label>Category <select value={category} disabled={locked} onChange={e => setCategory(e.target.value)}>
            {(direction === 'expense' ? ['Materials & supplies','Equipment & tools','Fuel & travel','Contractor payments','Software & subscriptions','Office expenses','Insurance','Other expense']
              : ['Other received income','Cash sale (not invoiced)','Additional service income','Miscellaneous income']).map(x => <option key={x}>{x}</option>)}
          </select></label>
          <label className="full">Description <input aria-label="Description" value={description} disabled={locked} maxLength={400} onChange={e => setDescription(e.target.value)} placeholder="What was paid for?" required /></label>
          <label className="full">Notes (optional) <textarea aria-label="Notes" value={notes} disabled={locked} maxLength={2000} rows={2} onChange={e => setNotes(e.target.value)} placeholder="Receipt or reference notes" /></label>
          <p className="bookkeeping-small full">This creates a bookkeeping record only. It does not withdraw, deposit, charge, or transfer funds.</p>
          <div className="bookkeeping-entry-actions full"><button type="button" className="secondary-button" disabled={busy||scanning} onClick={() => onClose()}>{uploadPending?'Close':'Cancel'}</button>
            <button className="primary-button" disabled={busy||scanning}>{busy ? 'Saving…' : uploadPending ? 'Retry receipt upload' : 'Save entry'}</button></div>
        </form>

  </>}
 </FormDialog>
}
