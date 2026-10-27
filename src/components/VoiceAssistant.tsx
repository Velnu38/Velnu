import { useEffect, useRef, useState } from 'react'
import { isQuickInvoiceCommand } from '../lib/quickInvoice'
import QuickInvoiceReview from './QuickInvoiceReview'
import type { CurrentBusiness } from '../lib/business'
import { confirmAiAction, executeAiAction, interpretCommand, rejectAiAction, transcribeVoice, getTranscriptionStatus, type AiCommandSource } from '../services/ai'

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
  return parts.join(' · ') || 'Finviant Office is ready to perform this action.'
}

function ResultView({ result }: { result: any }) {
  if (!result) return null
  const payload = result.result ?? result
  if (payload.total_outstanding !== undefined) return <p className="assistant-result">{payload.count} unpaid invoice{payload.count === 1 ? '' : 's'} · ${Number(payload.total_outstanding).toFixed(2)} outstanding</p>
  if (payload.outstanding !== undefined) return <p className="assistant-result">{payload.customers} customers · {payload.active_jobs} active jobs · ${Number(payload.outstanding).toFixed(2)} outstanding</p>
  if (payload.change_order) return <p className="assistant-result">Change order {payload.change_order.change_order_number ?? ''} created for ${Number(payload.change_order.total ?? 0).toFixed(2)}. Customer approval is still required.</p>
  if (payload.payment) return <p className="assistant-result">Payment of ${Number(payload.payment.amount).toFixed(2)} recorded.</p>
  if (payload.invoice) return <p className="assistant-result">Invoice {payload.invoice.invoice_number ?? ''} is ready. Balance: ${Number(payload.invoice.balance_due ?? payload.invoice.total ?? 0).toFixed(2)}</p>
  if (payload.estimate) return <p className="assistant-result">Estimate {payload.estimate.estimate_number ?? ''} created for ${Number(payload.estimate.total ?? 0).toFixed(2)}</p>
  if (payload.job) return <p className="assistant-result">Job “{payload.job.title}” created.</p>
  if (payload.customer) return <p className="assistant-result">Customer saved.</p>
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
  const [voiceStatus, setVoiceStatus] = useState('')
  const mutationInFlight = useRef(false)
  const mounted = useRef(true)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
  const recognizerRef = useRef<BrowserRecognizer | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingStartedAtRef = useRef<number | null>(null)
  const recordingTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (recordingTimeoutRef.current !== null) window.clearTimeout(recordingTimeoutRef.current)
      const recorder = recorderRef.current
      if (recorder) {
        recorder.onstop = null; recorder.ondataavailable = null; recorder.onerror = null
        if (recorder.state === 'recording') { try { recorder.stop() } catch { /* Already stopped. */ } }
        recorder.stream?.getTracks().forEach(track => track.stop())
      }
      const speech = recognizerRef.current
      if (speech) { speech.onend = null; speech.onresult = null; speech.onerror = null; try { speech.stop() } catch { /* Already stopped. */ } }
      chunksRef.current = []
    }
  }, [])
  function reset() {
    setAction(null); setResult(null); setQuickInvoiceRequest(null); setError(''); setVoiceStatus(''); setText('')
  }

  async function parseCommand(command: string, source: AiCommandSource) {
    setError(''); setVoiceStatus(''); setResult(null); setAction(null)
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
      setError(err instanceof Error ? err.message : 'Finviant Office could not understand that request')
    } finally {
      setBusy(false)
    }
  }

  async function submitText() {
    if (text.trim()) await parseCommand(text.trim(), 'text')
  }

  function startBrowserDictation(note = '') {
    const speechWindow = window as typeof window & {
      SpeechRecognition?: new () => BrowserRecognizer
      webkitSpeechRecognition?: new () => BrowserRecognizer
    }
    const SpeechCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
    if (!SpeechCtor) {
      setVoiceStatus('')
      setError('Cloud transcription is not ready and Safari does not support browser dictation. Tap the text box and use the iPhone keyboard microphone instead.')
      return
    }
    const speech = new SpeechCtor()
    speech.lang = 'en-US'
    speech.continuous = false
    speech.interimResults = true
    let spoken = ''
    let speechError = ''
    speech.onresult = event => {
      spoken = Array.from(event.results, item => item[0]?.transcript || '').join(' ').trim()
      if (spoken) {
        setText(spoken)
        setVoiceStatus('Speech captured. Review the words before saving or sending.')
        setError('')
      }
    }
    speech.onerror = event => {
      speechError = event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'Microphone access was blocked. Allow it in Safari or use your iPhone keyboard microphone.'
        : event.error === 'no-speech'
        ? 'No speech detected by Safari. Speak after tapping the microphone, or try your iPhone keyboard microphone.'
        : event.error === 'network'
        ? 'Safari dictation could not connect. Use your iPhone keyboard microphone.'
        : 'Browser dictation stopped before detecting speech. Use your iPhone keyboard microphone.'
      setVoiceStatus('')
      setError(speechError)
    }
    speech.onend = () => {
      if (recognizerRef.current !== speech) return
      recognizerRef.current = null
      setRecording(false)
      setBusy(false)
      if (spoken) {
        setText(spoken)
        setError('')
        if (isQuickInvoiceCommand(spoken)) void parseCommand(spoken, 'voice')
        else setVoiceStatus('Words captured. Check the text and tap Send command when ready.')
      } else if (!speechError) {
        setVoiceStatus('')
        setError('No text detected by the browser. Use the microphone on your iPhone keyboard in the text box.')
      }
    }
    recognizerRef.current = speech
    try {
      speech.start()
      setRecording(true)
      setVoiceStatus(note || 'Listening in Safari. Speak clearly, then tap to stop.')
    } catch (err) {
      recognizerRef.current = null
      setRecording(false)
      setVoiceStatus('')
      setError(err instanceof Error ? err.message : 'Could not start speech recognition. Use your keyboard microphone.')
    }
  }

  async function startCloudRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      startBrowserDictation('Audio recording is unavailable in this browser. Using browser dictation instead.')
      return
    }
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      if (!mounted.current) { stream.getTracks().forEach(track => track.stop()); return }
      const preferredFormats = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
      const preferredMime = typeof MediaRecorder.isTypeSupported === 'function'
        ? preferredFormats.find(mime => MediaRecorder.isTypeSupported(mime))
        : undefined
      const recorder = preferredMime ? new MediaRecorder(stream, { mimeType: preferredMime }) : new MediaRecorder(stream)
      const activeStream = stream
      recorderRef.current = recorder
      chunksRef.current = []
      recordingStartedAtRef.current = Date.now()
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onerror = () => {
        setError('The microphone recording stopped unexpectedly. Try again or use keyboard dictation.')
      }
      recorder.onstop = async () => {
        if (recordingTimeoutRef.current !== null) window.clearTimeout(recordingTimeoutRef.current)
        recordingTimeoutRef.current = null
        activeStream.getTracks().forEach(track => track.stop())
        recorderRef.current = null
        setRecording(false)
        setBusy(true)
        setVoiceStatus('Converting your recording to text…')
        const startedAt = recordingStartedAtRef.current
        recordingStartedAtRef.current = null
        const durationSeconds = startedAt ? Math.max((Date.now() - startedAt) / 1000, 0.01) : undefined
        try {
          if (!chunksRef.current.length) throw new Error('The recording was empty. Try again, or use keyboard dictation.')
          const mime = recorder.mimeType || chunksRef.current[0]?.type || 'audio/webm'
          const audio = new Blob(chunksRef.current, { type: mime })
          const transcript = await transcribeVoice(business.id, audio, durationSeconds)
          if (!transcript.transcript?.trim()) throw new Error('No text detected. Try a clearer recording.')
          const words = transcript.transcript.trim()
          setText(words)
          if (isQuickInvoiceCommand(words)) await parseCommand(words, 'voice')
          else setVoiceStatus('Transcription complete. Review the words and tap Send command.')
        } catch (err) {
          setVoiceStatus('')
          setError(err instanceof Error ? err.message : 'Could not transcribe the recording.')
        } finally {
          chunksRef.current = []
          setBusy(false)
        }
      }
      recorder.start()
      setRecording(true)
      setVoiceStatus('Recording securely. Speak your request, then tap to stop. Maximum 2 minutes.')
      recordingTimeoutRef.current = window.setTimeout(() => {
        if (recorder.state === 'recording') { try { recorder.stop() } catch { /* Already stopped. */ } }
      }, 110_000)
    } catch (err) {
      stream?.getTracks().forEach(track => track.stop())
      recorderRef.current = null
      recordingStartedAtRef.current = null
      setRecording(false)
      setVoiceStatus('')
      const message = err instanceof Error ? err.message : 'Microphone is unavailable.'
      setError('Cloud transcription is ready, but the microphone could not start: ' + message)
    }
  }

  async function toggleRecording() {
    if (recording) {
      if (recognizerRef.current) {
        setBusy(true)
        recognizerRef.current.stop()
      } else if (recorderRef.current?.state === 'recording') {
        recorderRef.current.stop()
      }
      return
    }

    setError('')
    setVoiceStatus('Checking voice service…')
    setAction(null)
    setQuickInvoiceRequest(null)
    setResult(null)
    setBusy(true)
    try {
      const status = await getTranscriptionStatus(business.id)
      setBusy(false)
      if (status.configured) {
        await startCloudRecording()
      } else {
        startBrowserDictation('Cloud transcription is waiting for OpenAI API setup. Using Safari dictation instead.')
      }
    } catch {
      setBusy(false)
      startBrowserDictation('Could not check the cloud transcription service. Trying browser dictation instead.')
    }
  }

  async function confirm() {
    if (!action?.action_id || mutationInFlight.current) return
    mutationInFlight.current = true
    setBusy(true); setError('')
    try {
      await confirmAiAction(action.action_id)
      const executed = await executeAiAction(action.action_id)
      setResult(executed)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally { mutationInFlight.current = false; setBusy(false) }
  }

  async function reject() {
    if (mutationInFlight.current) return
    mutationInFlight.current = true; setBusy(true); setError('')
    try { if (action?.action_id) await rejectAiAction(action.action_id); reset() }
    catch { setError('Cancellation could not be confirmed. Nothing will be automatically executed. Retry cancellation.') }
    finally { mutationInFlight.current = false; setBusy(false) }
  }

  return <>
    <button className="voice-fab" onClick={() => { setOpen(true); reset() }} aria-label="Talk to Finviant Office"><span className="mic-dot">●</span><span>Talk to Finviant Office</span></button>
    {open && <div className="assistant-backdrop" onMouseDown={() => !recording && setOpen(false)}><section className="assistant-panel" onMouseDown={(e) => e.stopPropagation()}>
      <div className="assistant-head"><div><p className="eyebrow">Finviant Office</p><h2>What do you need done?</h2></div><button className="icon-button" onClick={() => !recording && setOpen(false)}>×</button></div>
      <button className={`record-button ${recording ? 'recording' : ''}`} onClick={toggleRecording} disabled={busy}><span className="record-orb">●</span>{recording ? 'Tap to stop' : busy ? 'Working…' : 'Tap and speak'}</button>
      {voiceStatus && <p className="assistant-help" role="status">{voiceStatus}</p>}
      <button type="button" className="secondary-button compact" onClick={() => { textAreaRef.current?.focus(); setVoiceStatus('The text box is active. Tap the microphone on your iPhone keyboard, speak, and tap Done. Make sure text appears before you submit.') }}>Use iPhone keyboard microphone</button>
      <div className="assistant-divider"><span>or dictate / type it</span></div>
      <p className="assistant-help">iPhone: tap in the text box, use the microphone on the iPhone keyboard, speak, and tap Done. Check that your words appear, then tap Review invoice or Send command. When OpenAI transcription is enabled, the large microphone records audio securely for server transcription; otherwise Finviant Office uses browser dictation. Speech may be processed by OpenAI and the resulting text is saved to your business account. Nothing is sent to customers without review.</p>
      <div className="command-box"><textarea ref={textAreaRef} aria-label="Describe your invoice or request" value={text} onChange={(e) => { setText(e.target.value); setQuickInvoiceRequest(null); setAction(null); setResult(null) }} placeholder="Create an invoice for Bob Smith for $150 for faucet repair…" /><button className="primary-button compact" onClick={submitText} disabled={busy || !text.trim()}>{isQuickInvoiceCommand(text) ? 'Review invoice' : 'Send command'}</button></div>
      {quickInvoiceRequest && <QuickInvoiceReview business={business} command={quickInvoiceRequest} onCancel={() => setQuickInvoiceRequest(null)} onSaved={(invoice) => { setQuickInvoiceRequest(null); setText(''); setResult({ invoice }); onChanged() }} />}
      {action && !result && <div className="action-preview"><span className="intent-pill">{friendlyIntent(action.intent)}</span><h3>{action.clarification_question || 'Ready to do this?'}</h3><p>{action.clarification_question ? 'Add the missing detail and send the command again.' : describe(action)}</p>{action.requires_confirmation && !action.clarification_question && <div className="preview-actions"><button className="secondary-button" onClick={reject} disabled={busy}>Cancel</button><button className="primary-button" onClick={confirm} disabled={busy}>{busy ? 'Working…' : 'Confirm'}</button></div>}</div>}
      <ResultView result={result} />
      {error && <p className="form-message error-text">{error}</p>}
      <div className="assistant-hints"><span>“Who hasn’t paid me?”</span><span>“Create a customer named Bob Smith.”</span><span>“Add $475 labor to Smith’s kitchen job as a change order.”</span></div>
    </section></div>}
  </>
}
