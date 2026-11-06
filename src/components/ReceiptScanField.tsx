import { useEffect, useRef, useState } from 'react'
import type { CurrentBusiness } from '../lib/business'
import { prepareRecordImage } from '../lib/businessStorage'
import type { VelnuTier } from '../lib/pricing'
import { isPrimaryOwner } from '../lib/workspaceAccess'
import { scanReceipt, type ReceiptDraft, type ReceiptFile } from '../services/receiptCapture'
import PlanRestriction from './PlanRestriction'

export default function ReceiptScanField({ business, plan, disabled, onBusy, onPhoto, onRead }: {
  business: CurrentBusiness
  plan: VelnuTier | undefined
  disabled: boolean
  onBusy: (busy: boolean) => void
  onPhoto: (photo: ReceiptFile | null) => void
  onRead: (draft: ReceiptDraft) => void
}) {
  const [photo, setPhoto] = useState<ReceiptFile | null>(null)
  const [preview, setPreview] = useState('')
  const [reading, setReading] = useState(false)
  const [result, setResult] = useState<ReceiptDraft | null>(null)
  const [error, setError] = useState('')
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
    <label>Scan receipt
      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || reading} onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file) void choose(file)
      }} />
    </label>
    <p className="quiet">Use one receipt per photo. Finviant sends the image to Amazon Textract to read the expense details.</p>
    {reading && <p role="status">Reading receipt…</p>}
    {photo && <div>
      {preview && <a href={preview} target="_blank" rel="noopener noreferrer"><img className="receipt-preview" src={preview} alt="Preview selected receipt" /></a>}
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
