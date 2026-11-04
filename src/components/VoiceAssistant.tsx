import {FinMark,FinName} from './FinBrand'
import FormDialog from './FormDialog'
import { useEffect, useRef, useState } from 'react'
import {isVoiceDocumentCommand,voiceDocumentKind,parseVoiceDocument,type VoiceSeed} from '../lib/voiceDocument'
import QuickInvoiceReview from './QuickInvoiceReview'
import type { CurrentBusiness } from '../lib/business'
import { confirmAiAction, executeAiAction, interpretCommand, rejectAiAction, transcribeVoice, getTranscriptionStatus, interpretDocument, askFin, type AiCommandSource, type FinTurn } from '../services/ai'

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
  if (typeof payload.answer==='string') return <section className="fin-answer" aria-label="Fin’s answer"><p className="eyebrow">Fin · Your office assistant</p><p className="fin-answer-text">{payload.answer}</p>{payload.sources?.length>0&&<div><strong>Based on saved records</strong><ul>{payload.sources.map((s:{key:string;label:string})=><li key={s.key}>{s.label}</li>)}</ul></div>}<details><summary>Records checked and limits</summary><p>Checked {new Date(payload.as_of).toLocaleString()}</p><ul>{payload.limits?.map((l:string)=><li key={l}>{l}</li>)}</ul></details></section>
  if (payload.total_outstanding !== undefined) return <p className="assistant-result">{payload.count} unpaid invoice{payload.count === 1 ? '' : 's'} · ${Number(payload.total_outstanding).toFixed(2)} outstanding</p>
  if (payload.outstanding !== undefined) return <p className="assistant-result">{payload.customers} customers · {payload.active_jobs} active jobs · ${Number(payload.outstanding).toFixed(2)} outstanding</p>
  if (payload.change_order) return <p className="assistant-result">Change order {payload.change_order.change_order_number ?? ''} created for ${Number(payload.change_order.total ?? 0).toFixed(2)}. Customer approval is still required.</p>
  if (payload.payment) return <p className="assistant-result">Payment of ${Number(payload.payment.amount).toFixed(2)} recorded.</p>
  if (payload.delivery) return <p className="assistant-result" role="status">{payload.invoice?'Invoice':'Estimate'} saved. Email {payload.delivery.status==='delivered'?'delivered':'accepted for delivery'} to {payload.delivery.recipient}.{payload.delivery.warning&&` ${payload.delivery.warning}`}</p>
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
  const [quickInvoiceRequest, setQuickInvoiceRequest] = useState<{command:string;seed:VoiceSeed;notice:string} | null>(null)
  const [result, setResult] = useState<any>(null)
  const [conversation,setConversation]=useState<FinTurn[]>([])
  const conversationEnd=useRef<HTMLDivElement|null>(null)
  useEffect(()=>{conversationEnd.current?.scrollIntoView({block:'nearest',behavior:'instant'})},[conversation])
  const [error, setError] = useState('')
  const [voiceStatus, setVoiceStatus] = useState('')
  const [voiceMode, setVoiceMode] = useState<'checking' | 'cloud' | 'browser'>('checking')
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
  // Preflight on panel open, NOT when the microphone is tapped. Browser microphone
  // APIs need a live user gesture; awaiting a network status request in the click
  // handler can lose that activation (notably on iPhone Safari).
  useEffect(() => {
    if (!open) return
    let active = true
    setVoiceMode('checking')
    setVoiceStatus('Checking speech-to-text availability…')
    void getTranscriptionStatus(business.id).then(status => {
      if (!active) return
      setVoiceMode(status.configured ? 'cloud' : 'browser')
      setVoiceStatus(status.configured
        ? 'Cloud transcription ready. Tap to record, speak, then tap again to stop. Words appear after processing.'
        : 'Cloud transcription is unavailable. Browser dictation will be tried; the keyboard microphone is another option.')
    }).catch(() => {
      if (!active) return
      setVoiceMode('browser')
      setVoiceStatus('Could not check cloud transcription. Browser dictation will be tried; the keyboard microphone is another option.')
    })
    return () => { active = false }
  }, [open, business.id])

  useEffect(()=>{
    const openEntry=(event:Event)=>{const text=(event as CustomEvent<{text?:string}>).detail?.text;if(typeof text!=="string"||text.length>2000)return;setOpen(true);setAction(null);setResult(null);setQuickInvoiceRequest(null);setConversation([]);setError('');setText(text)}
    window.addEventListener('finviant-assistant-entry',openEntry);return()=>window.removeEventListener('finviant-assistant-entry',openEntry)
  },[])

  function reset() {
    setAction(null); setResult(null); setQuickInvoiceRequest(null); setError(''); setVoiceStatus(''); setText('')
  }

  async function parseCommand(command: string, source: AiCommandSource) {
    if (mutationInFlight.current) return
    setError(''); setVoiceStatus(''); setResult(null); setAction(null)
    if (isVoiceDocumentCommand(command)) {
      setText(command);setQuickInvoiceRequest(null);setBusy(true);mutationInFlight.current=true
      try {
        const seed=await interpretDocument(business.id,command)
        setQuickInvoiceRequest({command,seed,notice:'Fin prepared these lines. Check the details before saving.'})
      } catch {
        setQuickInvoiceRequest({command,seed:parseVoiceDocument(command),notice:'Using the on-device draft parser. Review each line; Fin’s language service could not be reached.'})
      } finally {setBusy(false);mutationInFlight.current=false}
      return
    }
    setQuickInvoiceRequest(null)
    setBusy(true);mutationInFlight.current=true
    try {
      if(/^(?:fin[, :]*)?(?:who|what|when|where|why|how|which|show|tell|do|does|is|are|can|could|would|give|have)\b|\?\s*$/i.test(command)||!/\b(?:create|make|draft|prepare|write|generate|start|schedule|record|add|convert|cancel|delete|send|mark|update)\b/i.test(command)){
        const response=await askFin(business.id,command,conversation);if(!mounted.current)return;setConversation(turns=>[...turns,{question:command,response}].slice(-12));setText('');return
      }
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
      setError(err instanceof Error ? err.message : 'Fin could not understand that request')
    } finally {
      setBusy(false);mutationInFlight.current=false
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
      setError('Cloud transcription is not ready and Safari does not support browser dictation. Tap the text box and use your device keyboard microphone instead.')
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
        ? 'Microphone access was blocked. Allow it in Safari or use your device keyboard microphone.'
        : event.error === 'no-speech'
        ? 'No speech detected by Safari. Speak after tapping the microphone, or try your device keyboard microphone.'
        : event.error === 'network'
        ? 'Safari dictation could not connect. Use your device keyboard microphone.'
        : 'Browser dictation stopped before detecting speech. Use your device keyboard microphone.'
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
        if (isVoiceDocumentCommand(spoken)) void parseCommand(spoken, 'voice')
        else setVoiceStatus('Words captured. Check the text and tap Ask Fin when ready.')
      } else if (!speechError) {
        setVoiceStatus('')
        setError('No text detected by the browser. Use the microphone on your device keyboard in the text box.')
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
          if (isVoiceDocumentCommand(words)) await parseCommand(words, 'voice')
          else setVoiceStatus('Transcription complete. Review the words and tap Ask Fin.')
        } catch (err) {
          setVoiceStatus('')
          setError(err instanceof Error ? err.message : 'Could not transcribe the recording.')
        } finally {
          chunksRef.current = []
          setBusy(false)
        }
      }
      recorder.start()
      setBusy(false)
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
      setBusy(false)
      setVoiceStatus('')
      const message = err instanceof Error ? err.message : 'Microphone is unavailable.'
      setError('Cloud transcription is ready, but the microphone could not start: ' + message)
    }
  }

  function toggleRecording() {
    if (recording) {
      if (recognizerRef.current) {
        setBusy(true)
        recognizerRef.current.stop()
      } else if (recorderRef.current?.state === 'recording') {
        recorderRef.current.stop()
      }
      return
    }
    if (busy || voiceMode === 'checking') return
    setError('')
    setAction(null)
    setQuickInvoiceRequest(null)
    setResult(null)
    if (voiceMode === 'cloud') {
      setBusy(true)
      // Begin getUserMedia in the actual tap handler, before any await.
      // This preserves user activation on Safari and other mobile browsers.
      void startCloudRecording()
    } else {
      // Likewise, start browser recognition before leaving the tap handler.
      startBrowserDictation('Listening. Speak clearly, then tap again to stop.')
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
    {!open&&<div className="fin-launcher"><button className="voice-fab" onClick={()=>setOpen(true)} aria-label="Talk to Fin" aria-describedby="fin-launcher-label"><FinMark/></button><span id="fin-launcher-label">Ask <FinName/> — tap to speak</span></div>}
    {open && <FormDialog label="Fin — your office assistant" cleanVersion={result??conversation} busy={busy||recording} disableFields={false} onClose={()=>setOpen(false)} wide><section className="assistant-panel">
      <div className="assistant-head"><div><p className="eyebrow">Fin · Your office assistant</p><h2>{quickInvoiceRequest?'Review '+quickInvoiceRequest.seed.kind:'What can I help you with?'}</h2></div><button className="icon-button" disabled={busy||recording} onClick={() => {if(!busy&&!recording)setOpen(false)}} type="button" aria-label="Close">×</button></div>
      {!quickInvoiceRequest&&<>
      {conversation.length>0&&<section className="fin-conversation" aria-label="Conversation with Fin" aria-live="polite">{conversation.map((turn,index)=><article key={index}><p className="fin-question"><strong>You</strong>{turn.question}</p><ResultView result={turn.response}/></article>)}<div ref={conversationEnd}/></section>}
      <div className="fin-voice-control"><button type="button" className={`record-button ${recording?'recording':''}`} onClick={toggleRecording} disabled={busy||voiceMode==='checking'} aria-pressed={recording} aria-label={recording?'Tap to stop':voiceMode==='checking'?'Checking voice…':'Tap and speak'}><FinMark/></button><span>{recording?'Listening — tap to stop':voiceMode==='checking'?'Preparing microphone…':'Tap to speak'}</span></div>
      {voiceStatus&&<p className="assistant-help" role="status">{voiceStatus}</p>}
      <p className="assistant-help">{conversation.length?'Ask a follow-up by voice or type below.':'Speak or type a question, invoice, estimate, or task.'}</p>
      <details className="fin-help"><summary>Using Fin and your business data</summary><button type="button" className="text-button" onClick={()=>textAreaRef.current?.focus()}>Use keyboard dictation</button><p className="assistant-help">Ask about your saved business profile, customers, unpaid invoices or upcoming work. Fin uses current records in this business; its answers show the records checked. Teach Fin through Settings → Company profile. Business questions are available to owners and administrators. Tap in the text box and use your device’s keyboard dictation if available, or type your request. Check that your words appear, then review the invoice or estimate. Say each description and dollar amount, for example: “Create an estimate for Bob Smith for mowing $100 and edging $40, total $140.” When OpenAI transcription is enabled, the large microphone records audio securely for server transcription; otherwise Finviant Office uses browser dictation. Speech may be processed by OpenAI and the resulting text is saved to your business account. Nothing is sent to customers without review.</p></details>
      <div className="command-box"><textarea ref={textAreaRef} aria-label="Describe your invoice or request" value={text} disabled={busy||recording} onChange={(e) => { setText(e.target.value); setQuickInvoiceRequest(null); setAction(null); setResult(null) }} maxLength={6000} placeholder={conversation.length?"Ask a follow-up…":"Ask a question or describe what you need…"} /><button type="button" className="primary-button compact" aria-label={isVoiceDocumentCommand(text)?`Review ${voiceDocumentKind(text)}`:'Ask Fin'} onClick={submitText} disabled={busy || recording || !text.trim()}>{isVoiceDocumentCommand(text) ? `Review ${voiceDocumentKind(text)}` : <>Ask <FinName/></>}</button></div>
      {conversation.length>0&&<div className="fin-conversation-controls"><span>Recent conversation stays in this workspace session. Fin checks current records for every answer.</span><button type="button" className="text-button" disabled={busy||recording} onClick={()=>{setConversation([]);reset();textAreaRef.current?.focus()}}>New conversation</button></div>}
      </>}
      {quickInvoiceRequest && <QuickInvoiceReview business={business} key={quickInvoiceRequest.command} command={quickInvoiceRequest.command} initialSeed={quickInvoiceRequest.seed} parserNotice={quickInvoiceRequest.notice} onCancel={() => setQuickInvoiceRequest(null)} onSaved={(document,kind,delivery) => { setQuickInvoiceRequest(null); setText(''); setResult({[kind]:document,delivery}); onChanged() }} />}
      {action && !result && <div className="action-preview"><span className="intent-pill">{friendlyIntent(action.intent)}</span><h3>{action.clarification_question || 'Ready to do this?'}</h3><p>{action.clarification_question ? 'Add the missing detail and send the command again.' : describe(action)}</p>{action.requires_confirmation && !action.clarification_question && <div className="preview-actions"><button data-keep-dialog className="secondary-button" onClick={reject} disabled={busy}>Cancel</button><button className="primary-button" onClick={confirm} disabled={busy}>{busy ? 'Working…' : 'Confirm'}</button></div>}</div>}
      <ResultView result={result} />
      {error && <p className="form-message error-text">{error}</p>}
      {!quickInvoiceRequest&&conversation.length===0&&<div className="assistant-hints"><span>“Who hasn’t paid me?”</span><span>“Create a customer named Bob Smith.”</span><span>“Add $475 labor to Smith’s kitchen job as a change order.”</span></div>}
    </section></FormDialog>}
  </>
}
