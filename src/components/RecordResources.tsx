import { AttachmentStorageWarning } from './StorageUsage'
import FormDialog from './FormDialog'
import {useUnsavedChanges} from '../lib/unsavedChanges'
import { canAccess } from '../lib/workspaceAccess'
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { DateTime } from 'luxon'
import { canManageFinances, canWrite, type CurrentBusiness } from '../lib/business'
import { readableError } from '../lib/errors'
import { addManualEntry, removeManualEntry, ReceiptUploadPending } from '../services/bookkeeping'
import { listRecordExpenses, listRecordPhotos, recordColumn, removeRecordPhoto, uploadRecordPhoto, type RecordExpense, type RecordPhoto, type RecordTarget } from '../services/recordResources'
import ReceiptScanField from './ReceiptScanField'
import ReceiptLink from './ReceiptLink'
import { useTierUsage } from '../lib/useTierUsage'
import type { ReceiptFile } from '../services/receiptCapture'
import type { StorageUsage } from '../lib/businessStorage'
import './record-resources.css'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const emptyExpense = (zone: string) => ({ date: DateTime.now().setZone(zone).toISODate()!, amount: '', category: 'Materials', description: '' })

export default function RecordResources({ business, target, active = true, photoInputRef }: { business: CurrentBusiness; target: RecordTarget; active?: boolean;photoInputRef?:RefObject<HTMLInputElement|null> }) {
  const finance = canManageFinances(business.role) && canAccess(business,'finances')
  const plan = useTierUsage(business.id)?.plan
  const [receipt, setReceipt] = useState<ReceiptFile | null>(null)
  const [scanning, setScanning] = useState(false), [uploadPending, setUploadPending] = useState(false)
  const photoWrite = target.kind === 'job' ? canWrite(business.role) : finance
  const [photos, setPhotos] = useState<RecordPhoto[] | null>(null)
  const [expenses, setExpenses] = useState<RecordExpense[] | null>(null)
  const [photoError, setPhotoError] = useState(''), [expenseError, setExpenseError] = useState('')
  const [photoVersion, setPhotoVersion] = useState(0), [expenseVersion, setExpenseVersion] = useState(0)
  const [uploadUsage, setUploadUsage] = useState<StorageUsage | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [receiptVersion, setReceiptVersion] = useState(0), [showExpense, setShowExpense] = useState(false)
  const zone = business.timezone || 'America/New_York'
  const [form, setForm] = useState(()=>emptyExpense(zone))
  const [dirty,setDirty]=useState(false)
  const guard=useUnsavedChanges(busy||scanning)
  const operation = useRef(false)
  const pendingExpense = useRef<{ signature: string; id: string } | null>(null)
  const uploadInput = useRef<HTMLInputElement>(null)
  const hasPhotos = !!photos?.length
  useEffect(() => {
    if (!active) return
    let current = true
    void listRecordPhotos(business.id, target)
      .then(rows => { if (current) { setPhotos(rows); setPhotoError('') } })
      .catch(err => { if (current) setPhotoError(readableError(err, 'Unable to load photos.')) })
    return () => { current = false }
  }, [business.id, target.kind, target.id, active, photoVersion])
  useEffect(() => {
    if (!active || !finance) return
    let current = true
    void listRecordExpenses(business.id, target)
      .then(rows => { if (current) { setExpenses(rows); setExpenseError('') } })
      .catch(err => { if (current) setExpenseError(readableError(err, 'Unable to load expenses.')) })
    return () => { current = false }
  }, [business.id, target.kind, target.id, active, finance, expenseVersion])
  useEffect(() => {
    if (!active) return
    const visible = () => !document.hidden && !operation.current
    const refresh = () => {
      if (!visible()) return
      setPhotoVersion(value => value + 1)
      if (finance) setExpenseVersion(value => value + 1)
    }
    // Only the photo previews expire. Keep the expense list stable between changes.
    const timer = hasPhotos ? window.setInterval(() => { if (visible()) setPhotoVersion(value => value + 1) }, 45_000) : undefined
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [active, finance, hasPhotos])
  function reloadPhotos() {
    setPhotoError('')
    setPhotoVersion(value => value + 1)
  }
  function reloadExpenses() {
    setExpenseError('')
    setExpenseVersion(value => value + 1)
  }
  function refreshFinance() {
    window.dispatchEvent(new Event('finviant-work-changed'))
  }
  async function run(action: () => Promise<void>, success: string, reload: () => void) {
    if (operation.current) return
    operation.current = true; setBusy(true); setError(''); setNotice('')
    try { await action(); setNotice(success) }
    catch (err) { setError(readableError(err, 'The change could not be saved.')) }
    finally { operation.current = false; setBusy(false); reload() }
  }
  async function upload(files: File[]) {
    await run(async () => {
      if (files.length > 10) throw new Error('Select up to 10 pictures at a time.')
      for (const file of files) await uploadRecordPhoto(business.id, target, file, setUploadUsage)
    }, `${files.length === 1 ? 'Picture' : 'Pictures'} added.`, reloadPhotos)
    if (uploadInput.current) uploadInput.current.value = ''
  }
  function updateExpense(next:typeof form){setForm(next);setDirty(true);guard.markDirty()}
  function closeExpense(){
    setShowExpense(false);setReceipt(null);setUploadPending(false);pendingExpense.current=null
    setReceiptVersion(value=>value+1);setForm(emptyExpense(zone));setDirty(false);guard.markClean()
  }
  async function saveExpense(event: FormEvent) {
    event.preventDefault()
    if (scanning) return
    await run(async () => {
      const signature = JSON.stringify({ business: business.id, target, form })
      if (!pendingExpense.current || (!receipt && pendingExpense.current.signature !== signature)) {
        pendingExpense.current = { signature, id: crypto.randomUUID() }
      }
      try {
        await addManualEntry({ id: pendingExpense.current.id, business_id: business.id,
          direction: 'expense', entry_date: form.date, amount: Number(form.amount), category: form.category,
          description: form.description, [recordColumn(target.kind)]: target.id }, receipt)
      } catch (e) {
        if (e instanceof ReceiptUploadPending) {
          setUploadPending(true);guard.markClean();setDirty(false)
          refreshFinance()
        }
        throw e
      }
      closeExpense()
      refreshFinance()
    }, 'Expense saved to this record and Financial Performance.', reloadExpenses)
  }
  const totalCents = expenses?.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0) ?? 0
  const addActions = !showExpense && (finance || photoWrite) && <div className="record-resource-actions">
    {finance && <button type="button" className={plan === 'basic' || plan === 'pro' ? 'secondary-button' : 'primary-button'}
      disabled={busy||scanning} onClick={()=>setShowExpense(true)}>Add expense manually</button>}
    {photoWrite && <label className={`secondary-button photo-upload${busy||scanning ? ' disabled' : ''}`}>
      {target.kind === 'job' ? 'Add job photos' : 'Add photos'}
      <input ref={node=>{uploadInput.current=node;if(photoInputRef)photoInputRef.current=node}} type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy||scanning}
        onChange={event => { const files = Array.from(event.target.files || []); if (files.length) void upload(files) }} />
    </label>}
  </div>
  return <section data-editor-independent data-unsaved={dirty} data-saving={busy||scanning} aria-busy={busy||scanning} className="record-resources calendar-no-print" aria-label="Photos and expenses">
    <p className="quiet record-private-note">Private business records</p>
    {plan !== 'basic' && plan !== 'pro' && addActions}
    {finance && <ReceiptScanField key={receiptVersion} business={business} plan={plan} disabled={busy||scanning||uploadPending} onStart={()=>{setError('');setNotice('');setShowExpense(true)}} onBusy={setScanning}
      onPhoto={photo=>{setReceipt(photo);setDirty(true);guard.markDirty()}}
      onRead={draft=>updateExpense({...form,date:draft.date||'',amount:draft.total||'',description:draft.vendor||form.description})}/>}
    {(plan === 'basic' || plan === 'pro') && addActions}
    <AttachmentStorageWarning usage={uploadUsage} />
    {error && <p role="alert" className="form-message error-text">{error}</p>}
    {notice && <p role="status" className="form-message">{notice}</p>}
    {busy && <p role="status">Saving…</p>}
    {finance && <>
      {showExpense && <form className="form-grid record-expense-form" onSubmit={saveExpense}>
        <h3 className="full">{receipt ? 'Review expense' : 'Add expense'}</h3>
        <label>Date<input type="date" value={form.date} required disabled={busy||scanning||uploadPending} onChange={e => updateExpense({ ...form, date: e.target.value })} /></label>
        <label>Amount ($)<input type="number" min="0.01" max="1000000000" step="0.01" value={form.amount} required disabled={busy||scanning||uploadPending} onChange={e => updateExpense({ ...form, amount: e.target.value })} /></label>
        <label>Category<select value={form.category} disabled={busy||scanning||uploadPending} onChange={e => updateExpense({ ...form, category: e.target.value })}>{['Materials', 'Labor', 'Equipment', 'Travel', 'Other'].map(category => <option key={category}>{category}</option>)}</select></label>
        <label>Description<input value={form.description} maxLength={4000} required disabled={busy||scanning||uploadPending} placeholder="Supplies, subcontractor, mileage…" onChange={e => updateExpense({ ...form, description: e.target.value })} /></label>
        <div className="modal-actions full"><button type="button" className="secondary-button" data-keep-dialog disabled={busy||scanning} onClick={()=>{if(guard.canClose())closeExpense()}}>{uploadPending?'Close':'Cancel'}</button><button className="primary-button" disabled={busy||scanning}>{uploadPending?'Retry receipt upload':'Save expense'}</button></div>
      </form>}
      <section className="record-resource-section" aria-label="Expenses">
        <div className="record-resources-head"><h3>Expenses</h3>{expenses && <strong>{money.format(totalCents / 100)}</strong>}</div>
        {expenseError && <p className="form-message error-text" role="alert">{expenseError} <button type="button" className="text-button" onClick={reloadExpenses}>Try expenses again</button></p>}
        {!expenses && !expenseError && <p role="status">Loading expenses…</p>}
        {expenses && (expenses.length === 0 ? <p className="quiet">No expenses yet.</p> : <ul className="record-expense-list">{expenses.map(expense => <li key={expense.id}><div><strong>{expense.description}</strong><span>{expense.entry_date} · {expense.category}</span>{expense.receiptPath&&<ReceiptLink path={expense.receiptPath}/>}</div><strong>{money.format(Number(expense.amount))}</strong><button type="button" className="text-button" disabled={busy||scanning} aria-label={`Remove expense ${expense.description}`} onClick={() => {
          if (window.confirm('Remove this expense from the record and Financial Performance?')) void run(async()=>{await removeManualEntry(business.id, expense.id, expense.receiptPath);refreshFinance()}, 'Expense removed.', reloadExpenses)
        }}>Remove</button></li>)}</ul>)}
      </section>
    </>}
    {!finance && <p className="quiet">Expense records are available to owners, administrators, and office staff.</p>}
    <section className="record-resource-section" aria-label={target.kind === 'job' ? 'Job photos' : 'Photos'}>
      <h3>{target.kind === 'job' ? 'Job photos' : 'Photos'}</h3>
      {(photoError || photos?.some(photo=>!photo.url)) && <p className="form-message error-text" role="alert">
        {photoError || 'Some photo previews are unavailable.'} <button type="button" className="text-button" onClick={reloadPhotos}>Try photos again</button>
      </p>}
      {!photos && !photoError && <p role="status">Loading photos…</p>}
      {photos && (photos.length === 0 ? <p className="quiet">No photos yet.</p> : <div className="record-photo-grid">{photos.map(photo => <figure key={photo.id}>
        {photo.url ? <a href={photo.url} target="_blank" rel="noopener noreferrer"><img src={photo.url} alt={photo.file_name} loading="lazy" /></a> : <div className="photo-unavailable">Preview unavailable</div>}
        <figcaption>{photo.file_name}</figcaption>
        {finance && <button type="button" className="text-button" disabled={busy||scanning} aria-label={`Remove picture ${photo.file_name}`} onClick={() => {
          if (window.confirm('Remove this picture from the record?')) void run(() => removeRecordPhoto(business.id, photo), 'Picture removed.', reloadPhotos)
        }}>Remove picture</button>}
      </figure>)}</div>)}
    </section>
  </section>
}

export function RecordResourcesDialog({ business, target, title, linkedJobId, onClose }: { business: CurrentBusiness; target: RecordTarget; title: string; linkedJobId?: string | null; onClose: () => void }) {
  return <FormDialog label={`${title} photos and expenses`} onClose={onClose} wide autoFocusFields={false}>
    <div className="modal-head record-resources-head"><div><p className="eyebrow">{title}</p><h2>Photos &amp; expenses</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button></div>
    {linkedJobId && canAccess(business,'jobs') && <p className="record-linked-job"><a href={`/?view=work&document=${encodeURIComponent(linkedJobId)}&tab=photos-expenses`}>View linked job photos &amp; expenses</a></p>}
    <RecordResources key={`${business.id}:${target.kind}:${target.id}`} business={business} target={target} />
  </FormDialog>
}
