import { useEffect, useId, useRef, useState } from 'react'
import type { CurrentBusiness } from '../lib/business'
import { prepareRecordImage } from '../lib/businessStorage'
import type { VelnuTier } from '../lib/pricing'
import { isPrimaryOwner } from '../lib/workspaceAccess'
import { scanReceipt, type ReceiptDraft, type ReceiptFile } from '../services/receiptCapture'
import PlanRestriction from './PlanRestriction'
import StorageUsage from './StorageUsage'
import './record-resources.css'

const receiptImages = 'image/jpeg,image/png,image/webp'

export default function ReceiptScanField({ business, plan, disabled, onStart, onBusy, onPhoto, onRead }: {
  business: CurrentBusiness
  plan: VelnuTier | undefined
  disabled: boolean
  onStart?: () => void
  onBusy: (busy: boolean) => void
  onPhoto: (photo: ReceiptFile | null) => void
  onRead: (draft: ReceiptDraft) => void
}) {
  const [photo, setPhoto] = useState<ReceiptFile | null>(null)
  const [preview, setPreview] = useState('')
  const [reading, setReading] = useState(false)
  const [result, setResult] = useState<ReceiptDraft | null>(null)
  const [error, setError] = useState('')
  const [choosing, setChoosing] = useState(false)
  const choicesId = useId()
  const cameraInput = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const operation = useRef(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  useEffect(() => {
    if (!photo) { setPreview(''); return }
    const url = URL.createObjectURL(photo.blob)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])
  async function choose(file: File) {
    if (operation.current || disabled || !plan || plan === 'free') return
    operation.current = true
    setChoosing(false)
    onStart?.()
    setReading(true); onBusy(true); setError(''); setResult(null)
    try {
      const blob = await prepareRecordImage(file, 3400)
      if (blob.size > 5_000_000) throw new Error('Choose a smaller receipt photo.')
      if (!active.current) return
      const next = { blob, name: file.name.slice(0, 240) || 'Receipt.jpg' }
      setPhoto(next); onPhoto(next)
      const draft = await scanReceipt(business.id, blob)
      if (active.current) { setResult(draft); onRead(draft) }
    } catch (e) {
      if (active.current) setError(e instanceof Error ? e.message : 'Unable to read the receipt.')
    } finally {
      operation.current = false
      if (active.current) { setReading(false); onBusy(false) }
    }
  }
  if (!plan) return null
  if (plan === 'free') return <div className="full"><PlanRestriction plan={plan} required="basic" feature="Receipt scanning" canUpgrade={isPrimaryOwner(business)} /></div>
  return <section className="full receipt-capture" aria-label="Receipt capture">
    <button type="button" className="primary-button receipt-scan-button" aria-expanded={choosing} aria-controls={choicesId}
      aria-describedby={choicesId + '-hint'} disabled={disabled || reading} onClick={() => setChoosing(value => !value)}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path d="M4 6h4l2-3h4l2 3h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="4"/>
      </svg>
      Scan receipt
    </button>
    <p className="quiet receipt-scan-hint" id={choicesId + '-hint'}>Take a photo or upload a receipt image</p>
    <div id={choicesId} hidden={!choosing} className="receipt-source-choices">
      <div className="record-resource-actions">
        <button type="button" className="secondary-button" disabled={disabled || reading} onClick={() => cameraInput.current?.click()}>Take photo</button>
        <button type="button" className="secondary-button" disabled={disabled || reading} onClick={() => imageInput.current?.click()}>Upload image</button>
      </div>
      <p className="quiet">Use one receipt per image. Finviant uses Amazon Textract to read it.</p>
    </div>
    {([['Take receipt photo', cameraInput, 'environment'], ['Upload receipt image', imageInput, undefined]] as const).map(([label, input, capture]) =>
      <input key={label} ref={input} type="file" aria-label={label} hidden accept={receiptImages} capture={capture} disabled={disabled || reading} onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file) void choose(file)
      }} />
    )}
    {reading && <p role="status">Reading receipt…</p>}
    {photo && <div>
      {preview && <a href={preview} target="_blank" rel="noopener noreferrer"><img className="receipt-preview" src={preview} alt="Preview selected receipt" /></a>}
      <StorageUsage businessId={business.id} warningsOnly />
      <button type="button" className="text-button" disabled={disabled || reading} onClick={() => {
        setPhoto(null); onPhoto(null); setResult(null); setError('')
      }}>Remove photo</button>
    </div>}
    {error && <p role="alert">{error}</p>}
    {result && <>
      <p role="status">{result.warning || 'Review the scanned date, amount and description before saving.'}</p>
      {(result.tax !== null || result.items.length > 0) && <details>
        <summary>Details read from the receipt</summary>
        {result.tax !== null && <p>Tax on receipt ${result.tax}</p>}
        {result.items.length > 0 && <ul>{result.items.map((item, index) => <li key={index}>{item}</li>)}</ul>}
      </details>}
    </>}
  </section>
}
