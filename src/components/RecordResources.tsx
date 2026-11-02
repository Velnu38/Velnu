import { canAccess } from '../lib/workspaceAccess'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { DateTime } from 'luxon'
import { canManageFinances, canWrite, type CurrentBusiness } from '../lib/business'
import { readableError } from '../lib/errors'
import { addManualEntry, removeManualEntry } from '../services/bookkeeping'
import { listRecordExpenses, listRecordPhotos, recordColumn, removeRecordPhoto, uploadRecordPhoto, type RecordExpense, type RecordPhoto, type RecordTarget } from '../services/recordResources'
import './record-resources.css'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export default function RecordResources({ business, target }: { business: CurrentBusiness; target: RecordTarget }) {
  const finance = canManageFinances(business.role) && canAccess(business,'finances')
  const photoWrite = target.kind === 'job' ? canWrite(business.role) : finance
  const [photos, setPhotos] = useState<RecordPhoto[]>([])
  const [expenses, setExpenses] = useState<RecordExpense[]>([])
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [version, setVersion] = useState(0), [showExpense, setShowExpense] = useState(false)
  const [form, setForm] = useState({ date: DateTime.now().setZone(business.timezone || 'America/New_York').toISODate()!, amount: '', category: 'Materials', description: '' })
  const operation = useRef(false)
  const pendingExpense = useRef<{ signature: string; id: string } | null>(null)
  const uploadInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let active = true
    setLoading(true)
    void Promise.all([listRecordPhotos(business.id, target), finance ? listRecordExpenses(business.id, target) : Promise.resolve([])])
      .then(([nextPhotos, nextExpenses]) => { if (active) { setPhotos(nextPhotos); setExpenses(nextExpenses) } })
      .catch(err => { if (active) setError(readableError(err, 'Unable to load photos and expenses.')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [business.id, target.kind, target.id, finance, version])
  useEffect(() => {
    // Renew private image URLs while the panel is open; no permanent public links.
    const refresh = () => { if (!document.hidden && !operation.current) setVersion(value => value + 1) }
    const timer = window.setInterval(refresh, 600_000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [])
  async function run(action: () => Promise<void>, success: string) {
    if (operation.current) return
    operation.current = true; setBusy(true); setError(''); setNotice('')
    try { await action(); setNotice(success) }
    catch (err) { setError(readableError(err, 'The change could not be saved.')) }
    finally { operation.current = false; setBusy(false); setVersion(value => value + 1) }
  }
  async function upload(files: File[]) {
    await run(async () => {
      if (files.length > 10) throw new Error('Select up to 10 pictures at a time.')
      for (const file of files) await uploadRecordPhoto(business.id, target, file)
    }, `${files.length === 1 ? 'Picture' : 'Pictures'} added.`)
    if (uploadInput.current) uploadInput.current.value = ''
  }
  async function saveExpense(event: FormEvent) {
    event.preventDefault()
    await run(async () => {
      const signature = JSON.stringify({ business: business.id, target, form })
      if (pendingExpense.current?.signature !== signature) pendingExpense.current = { signature, id: crypto.randomUUID() }
      await addManualEntry({ id: pendingExpense.current.id, business_id: business.id,
        direction: 'expense', entry_date: form.date, amount: Number(form.amount), category: form.category,
        description: form.description, [recordColumn(target.kind)]: target.id })
      pendingExpense.current = null
      setShowExpense(false); setForm(value => ({ ...value, amount: '', description: '' }))
    }, 'Expense saved to this record and Financial Performance.')
  }
  const totalCents = expenses.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0)
  return <section className="record-resources calendar-no-print" aria-label="Photos and expenses">
    <div className="record-resources-head"><div><h2>Photos &amp; expenses</h2><p className="quiet">Internal business records. Expenses do not change customer charges.</p></div><button type="button" className="secondary-button compact" disabled={busy || loading} onClick={() => { setError(''); setVersion(v => v + 1) }}>Refresh photos &amp; expenses</button></div>
    {error && <p role="alert" className="form-message error-text">{error}</p>}
    {notice && <p role="status" className="form-message">{notice}</p>}
    {busy && <p role="status">Saving…</p>}
    <div className="record-resources-head"><h3>Photos</h3>{photoWrite && <label className={`secondary-button compact photo-upload${busy ? ' disabled' : ''}`}>Add pictures<input ref={uploadInput} type="file" aria-label="Add pictures" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={event => { const files = Array.from(event.target.files || []); if (files.length) void upload(files) }} /></label>}</div>
    <p className="quiet">JPG, PNG, or WebP · up to 10 MB each. Add job pictures or receipt photos.</p>
    {loading ? <p role="status">Loading photos and expenses…</p> : photos.length === 0 ? <p className="quiet">No pictures added yet.</p> : <div className="record-photo-grid">{photos.map(photo => <figure key={photo.id}>
      {photo.url ? <a href={photo.url} target="_blank" rel="noopener noreferrer"><img src={photo.url} alt={photo.file_name} loading="lazy" /></a> : <div className="photo-unavailable">Upload incomplete or preview unavailable. Refresh or remove this picture.</div>}
      <figcaption>{photo.file_name}</figcaption>
      {finance && <button type="button" className="text-button" disabled={busy} aria-label={`Remove picture ${photo.file_name}`} onClick={() => { if (window.confirm('Remove this picture from the record?')) void run(() => removeRecordPhoto(business.id, photo), 'Picture removed.') }}>Remove picture</button>}
    </figure>)}</div>}
    <div className="record-resources-head"><h3>Expenses{finance && !loading ? ` · ${money.format(totalCents / 100)}` : ''}</h3>{finance && <button type="button" className="primary-button compact" disabled={busy} onClick={() => setShowExpense(value => !value)}>{showExpense ? 'Close expense form' : 'Add expense'}</button>}</div>
    {!finance ? <p className="quiet">Expense records are available to owners, administrators, and office staff.</p> : <>
      {showExpense && <form className="form-grid record-expense-form" onSubmit={saveExpense}>
        <label>Date<input type="date" value={form.date} required disabled={busy} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
        <label>Amount ($)<input type="number" min="0.01" max="1000000000" step="0.01" value={form.amount} required disabled={busy} onChange={e => setForm({ ...form, amount: e.target.value })} /></label>
        <label>Category<select value={form.category} disabled={busy} onChange={e => setForm({ ...form, category: e.target.value })}>{['Materials', 'Labor', 'Equipment', 'Travel', 'Other'].map(category => <option key={category}>{category}</option>)}</select></label>
        <label>Description<input value={form.description} maxLength={4000} required disabled={busy} placeholder="Supplies, subcontractor, mileage…" onChange={e => setForm({ ...form, description: e.target.value })} /></label>
        <div className="modal-actions full"><button type="button" className="secondary-button" disabled={busy} onClick={() => setShowExpense(false)}>Cancel</button><button className="primary-button" disabled={busy}>Save expense</button></div>
      </form>}
      {!loading && (expenses.length === 0 ? <p className="quiet">No expenses recorded yet.</p> : <ul className="record-expense-list">{expenses.map(expense => <li key={expense.id}><div><strong>{expense.description}</strong><span>{expense.entry_date} · {expense.category}</span></div><strong>{money.format(Number(expense.amount))}</strong><button type="button" className="text-button" disabled={busy} aria-label={`Remove expense ${expense.description}`} onClick={() => { if (window.confirm('Remove this expense from the record and Financial Performance?')) void run(() => removeManualEntry(business.id, expense.id), 'Expense removed.') }}>Remove</button></li>)}</ul>)}
    </>}
  </section>
}

export function RecordResourcesDialog({ business, target, title, onClose }: { business: CurrentBusiness; target: RecordTarget; title: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="record-resource-dialog" aria-label={`${title} photos and expenses`} onCancel={onClose}>
    <div className="record-resources-head"><div><p className="eyebrow">{target.kind}</p><h2>{title}</h2></div><button type="button" className="secondary-button compact" onClick={onClose}>Close</button></div>
    <RecordResources key={`${business.id}:${target.kind}:${target.id}`} business={business} target={target} />
  </dialog>
}
