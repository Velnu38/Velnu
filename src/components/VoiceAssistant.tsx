import { useRef, useState } from 'react'
import { isQuickInvoiceCommand } from '../lib/quickInvoice'
import QuickInvoiceReview from './QuickInvoiceReview'
import type { CurrentBusiness } from '../lib/business'
import { confirmAiAction, executeAiAction, interpretCommand, rejectAiAction, transcribeVoice, type AiCommandSource } from '../services/ai'

type BrowserSpeechResult = { results: ArrayLike<ArrayLike<{ transcript: string }>> }
type BrowserRecognizer = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: BrowserSpeechResult) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type ParsedAction = {
  action_id: string
  intent: string
  confidence?: number
  requires_confirmation?: boolean
  fields?: Record<string, any>
  clarification_question?: string | null
}

function friendlyIntent(intent: string) {
  return intent.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase())
}

function describe(action: ParsedAction) {
  const f = action.fields ?? {}
  const customer = f.customer_name || f.company_name
  const parts = [customer, f.job_title, f.change_order_title, f.job_description].filter(Boolean)
  if (f.invoice_number) parts.push(`Invoice ${f.invoice_number}`)
  if (Array.isArray(f.line_items) && f.line_items.length) {
    parts.push(f.line_items.map((x: any) => {
      const tax = Number(x.tax_rate ?? 0)
      return `${x.description} — ${x.quantity} × $${Number(x.unit_price).toFixed(2)}${tax ? ` + ${tax}% tax` : ''}`
    }).join(', '))
  }
  if (f.payment_amount) parts.push(`Payment $${Number(f.payment_amount).toFixed(2)}`)
  if (f.payment_method) parts.push(String(f.payment_method).toUpperCase())
  if (f.scheduled_at_text) parts.push(`Starts ${String(f.scheduled_at_text)}`)
  if (f.scheduled_end_text) parts.push(`Ends ${String(f.scheduled_end_text)}`)
  if (Number.isInteger(f.schedule_impact_days) && f.schedule_impact_days !== 0) parts.push(`${f.schedule_impact_days > 0 ? '+' : ''}${f.schedule_impact_days} day schedule impact`)
  return parts.join(' · ') || 'Velnu is ready to perform this action.'
}

function ResultView({ result }: { result: any }) {
  if (!result) return null
  const payload = result.result ?? result
  if (payload.total_outstanding !== undefined) return <p className="assistant-result">{payload.count} unpaid invoice{payload.count === 1 ? '' : 's'} · ${Number(payload.total_outstanding).toFixed(2)} outstanding</p>
  if (payload.outstanding !== undefined) return <p className="assistant-result">{payload.customers} customers · {payload.active_jobs} active jobs · ${Number(payload.outstanding).toFixed(2)} outstanding</p>
  if (payload.change_order) return <p className="assistant-result">Change order {payload.change_order.change_order_number ?? ''} created for ${Number(payload.change_order.total ?? 0).toFixed(2)}. Customer approval is still required.</p>
  if (payload.invoice) return <p className="assistant-result">Invoice {payload.invoice.invoice_number ?? ''} is ready. Balance: ${Number(payload.invoice.balance_due ?? payload.invoice.total ?? 0).toFixed(2)}</p>
  if (payload.estimate) return <p className="assistant-result">Estimate {payload.estimate.estimate_number ?? ''} created for ${Number(payload.estimate.total ?? 0).toFixed(2)}</p>
  if (payload.job) return <p className="assistant-result">Job “{payload.job.title}” created.</p>
  if (payload.customer) return <p className="assistant-result">Customer saved.</p>
  if (payload.payment) return <p className="assistant-result">Payment of ${Number(payload.payment.amount).toFixed(2)} recorded.</p>
  if (Array.isArray(payload.jobs) || Array.isArray(payload.invoices)) return <p className="assistant-result">Found {payload.jobs?.length ?? 0} jobs and {payload.invoices?.length ?? 0} invoices in this customer’s history.</p>
  return <p className="assistant-result">Done.</p>
}

export default function VoiceAssistant({ business, onChanged }: { business: CurrentBusiness; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [action, setAction] = useState<ParsedAction | null>(null)
  const [quickInvoiceRequest, setQuickInvoiceRequest] = useState<string | null>(null)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recognizerRef = useRef<BrowserRecognizer | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingStartedAtRef = useRef<number | null>(null)

  function reset() {
    setAction(null); setResult(null); setQuickInvoiceRequest(null); setError(''); setText('')
  }

  async function parseCommand(command: string, source: AiCommandSource) {
    setError(''); setResult(null); setAction(null)
    if (isQuickInvoiceCommand(command)) {
      // A single-line draft can be reviewed and saved even without a paid AI key.
      // Never save financial changes automatically.
      setText(command)
      setQuickInvoiceRequest(command)
      return
    }
    setQuickInvoiceRequest(null)
    setBusy(true)
    try {
      const parsed = await interpretCommand(business.id, command, source) as ParsedAction
      setAction(parsed)
      setText(command)
      if (parsed.clarification_question) return
      if (!parsed.requires_confirmation && parsed.action_id) {
        const executed = await executeAiAction(parsed.action_id)
        setResult(executed)
        onChanged()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Velnu could not understand that request')
    } finally {
      setBusy(false)
    }
  }

  async function submitText() {
    if (text.trim()) await parseCommand(text.trim(), 'text')
  }

  async function toggleRecording() {
    if (recording) {
      if (recognizerRef.current) {
        setBusy(true)
        recognizerRef.current.stop()
      } else recorderRef.current?.stop()
      return
    }
    setError(''); setAction(null); setQuickInvoiceRequest(null); setResult(null)
    // Prefer browser dictation where supported. It does not require our OpenAI API key.
    // Support differs by browser, so retain a typed/keyboard-dictation fallback.
    const speechWindow = window as typeof window & {
      SpeechRecognition?: new () => BrowserRecognizer
      webkitSpeechRecognition?: new () => BrowserRecognizer
    }
    const SpeechCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
    if (SpeechCtor) {
      const speech = new SpeechCtor()
      speech.lang = 'en-US'
      speech.continuous = false
      speech.interimResults = false
      let spoken = ''
      let speechError = ''
      speech.onresult = (event) => {
        spoken = Array.from(event.results, item => item[0]?.transcript || '').join(' ').trim()
        setText(spoken)
      }
      speech.onerror = (event) => {
        speechError = event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'Microphone access was denied. Allow the microphone in Safari or use your keyboard microphone below.'
          : `Browser dictation did not finish (${event.error}). Use the keyboard microphone in the text box below.`
        setError(speechError)
      }
      speech.onend = () => {
        if (recognizerRef.current !== speech) return
        recognizerRef.current = null
        setRecording(false)
        setBusy(false)
        if (!speechError && spoken) void parseCommand(spoken, 'voice')
        else if (!speechError) setError('No speech was captured. Tap the microphone again, or use your phone keyboard microphone below.')
      }
      recognizerRef.current = speech
      try { speech.start(); setRecording(true) }
      catch (err) {
        recognizerRef.current = null
        setRecording(false)
        setBusy(false)
        setError(err instanceof Error ? err.message : 'Could not start the microphone. Use keyboard dictation below.')
      }
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (typeof MediaRecorder === 'undefined') {
        stream.getTracks().forEach(track => track.stop())
        setError('This browser does not support recording. Use the keyboard microphone in the text box below.')
        return
      }
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recordingStartedAtRef.current = Date.now()
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        setRecording(false); setBusy(true)
        const startedAt = recordingStartedAtRef.current
        recordingStartedAtRef.current = null
        const durationSeconds = startedAt ? Math.max((Date.now() - startedAt) / 1000, 0.01) : undefined
        try {
          if (!chunksRef.current.length) throw new Error('No audio was recorded. Use your phone keyboard microphone below.')
          const audio = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          const transcribed = await transcribeVoice(business.id, audio, durationSeconds)
          setText(transcribed.transcript)
          await parseCommand(transcribed.transcript, 'voice')
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Voice transcription failed')
          setBusy(false)
        }
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
    } catch (err) {
      recordingStartedAtRef.current = null
      setError(err instanceof Error ? err.message : 'Microphone access is unavailable')
    }
  }

  async function confirm() {
    if (!action?.action_id) return
    setBusy(true); setError('')
    try {
      await confirmAiAction(action.action_id)
      const executed = await executeAiAction(action.action_id)
      setResult(executed)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally { setBusy(false) }
  }

  async function reject() {
    if (action?.action_id) await rejectAiAction(action.action_id)
    reset()
  }

  return <>
    <button className="voice-fab" onClick={() => { setOpen(true); reset() }} aria-label="Talk to Velnu"><span className="mic-dot">●</span><span>Talk to Velnu</span></button>
    {open && <div className="assistant-backdrop" onMouseDown={() => !recording && setOpen(false)}><section className="assistant-panel" onMouseDown={(e) => e.stopPropagation()}>
      <div className="assistant-head"><div><p className="eyebrow">Velnu Office</p><h2>What do you need done?</h2></div><button className="icon-button" onClick={() => !recording && setOpen(false)}>×</button></div>
      <button className={`record-button ${recording ? 'recording' : ''}`} onClick={toggleRecording} disabled={busy}><span className="record-orb">●</span>{recording ? 'Tap to stop' : busy ? 'Working…' : 'Tap and speak'}</button>
      <div className="assistant-divider"><span>or dictate / type it</span></div>
      <p className="assistant-help">On iPhone, you can also tap the keyboard microphone, speak, tap Done, then tap Review invoice. Recording or typing never sends an invoice automatically.</p>
      <div className="command-box"><textarea aria-label="Describe your invoice or request" value={text} onChange={(e) => { setText(e.target.value); setQuickInvoiceRequest(null); setAction(null); setResult(null) }} placeholder="Create an invoice for Bob Smith for $150 for faucet repair…" /><button className="primary-button compact" onClick={submitText} disabled={busy || !text.trim()}>{isQuickInvoiceCommand(text) ? 'Review invoice' : 'Send command'}</button></div>
      {quickInvoiceRequest && <QuickInvoiceReview business={business} command={quickInvoiceRequest} onCancel={() => setQuickInvoiceRequest(null)} onSaved={(invoice) => { setQuickInvoiceRequest(null); setText(''); setResult({ invoice }); onChanged() }} />}
      {action && !result && <div className="action-preview"><span className="intent-pill">{friendlyIntent(action.intent)}</span><h3>{action.clarification_question || 'Ready to do this?'}</h3><p>{action.clarification_question ? 'Add the missing detail and send the command again.' : describe(action)}</p>{action.requires_confirmation && !action.clarification_question && <div className="preview-actions"><button className="secondary-button" onClick={reject}>Cancel</button><button className="primary-button" onClick={confirm} disabled={busy}>{busy ? 'Working…' : 'Confirm'}</button></div>}</div>}
      <ResultView result={result} />
      {error && <p className="form-message error-text">{error}</p>}
      <div className="assistant-hints"><span>“Who hasn’t paid me?”</span><span>“Create a customer named Bob Smith.”</span><span>“Add $475 labor to Smith’s kitchen job as a change order.”</span></div>
    </section></div>}
  </>
}
