import {isFinQuestion} from '../lib/finRequest'
import {createVoicePauseDetector} from '../lib/voicePause'
import CreatedDocumentDelivery from './CreatedDocumentDelivery'
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
  const [entryMode, setEntryMode] = useState<'voice' | 'text'>('text')
  const pauseDetector = useRef<ReturnType<typeof createVoicePauseDetector>>(null)
  const [voiceMode, setVoiceMode] = useState<'cloud' | 'browser'>('cloud')
  const captureStarting=useRef(false),captureGeneration=useRef(0)
  const [workingMessage,setWorkingMessage]=useState('')
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
      mounted.current = false;captureGeneration.current++
      pauseDetector.current?.stop()
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
  // Preflight in the background. A status request never disables the tap target
  // or consumes the gesture that Safari requires for microphone permission.
  useEffect(() => {
    let active=true
    void getTranscriptionStatus(business.id).then(status=>{if(active)setVoiceMode(status.configured?'cloud':'browser')}).catch(()=>{
      // A temporary status failure does not prove cloud transcription is disabled.
      if(active)setVoiceMode('cloud')
    })
    return()=>{active=false}
  },[business.id])

  useEffect(()=>{
    const openEntry=(event:Event)=>{const text=(event as CustomEvent<{text?:string}>).detail?.text;if(typeof text!=="string"||text.length>2000)return;setOpen(true);setAction(null);setResult(null);setQuickInvoiceRequest(null);setConversation([]);setError('');setText(text)}
    window.addEventListener('finviant-assistant-entry',openEntry);return()=>window.removeEventListener('finviant-assistant-entry',openEntry)
  },[])

  useEffect(()=>{
    const openTyping=()=>{setEntryMode('text');setOpen(true)}
    window.addEventListener('finviant-assistant-type',openTyping)
    return()=>window.removeEventListener('finviant-assistant-type',openTyping)
  },[])

  function reset() {
    setEntryMode('text')
    setAction(null); setResult(null); setQuickInvoiceRequest(null); setError(''); setVoiceStatus(''); setText('')
  }

  async function parseCommand(command: string, source: AiCommandSource) {
    if (mutationInFlight.current) return
    setError(''); setVoiceStatus(''); setResult(null); setAction(null)
    if (isVoiceDocumentCommand(command)) {
      setText(command);setQuickInvoiceRequest(null);setBusy(true);setWorkingMessage('Fin is preparing your draft…');mutationInFlight.current=true
      try {
        const seed=await interpretDocument(business.id,command)
        setQuickInvoiceRequest({command,seed,notice:'Fin prepared these lines. Check the details before saving.'})
      } catch {
        setQuickInvoiceRequest({command,seed:parseVoiceDocument(command),notice:'Using the on-device draft parser. Review each line; Fin’s language service could not be reached.'})
      } finally {setBusy(false);setWorkingMessage('');mutationInFlight.current=false}
      return
    }
    setQuickInvoiceRequest(null)
    setBusy(true);setWorkingMessage('Fin is thinking…');mutationInFlight.current=true
    try {
      if(isFinQuestion(command)){
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
      setBusy(false);setWorkingMessage('');mutationInFlight.current=false
    }
  }

  async function submitText() {
    if (text.trim()) await parseCommand(text.trim(), 'text')
  }

  function stopBrowserDictation(speech:BrowserRecognizer) {
    if(recordingTimeoutRef.current!==null)window.clearTimeout(recordingTimeoutRef.current)
    recordingTimeoutRef.current=null
    try { speech.stop() } catch { /* Finalize the captured words below. */ }
    // Some browsers omit the final end event after interruption or permission loss.
    if(recognizerRef.current===speech)recordingTimeoutRef.current=window.setTimeout(()=>speech.onend?.(),3000)
  }

  function startBrowserDictation(note = '') {
    const speechWindow = window as typeof window & {
      SpeechRecognition?: new () => BrowserRecognizer
      webkitSpeechRecognition?: new () => BrowserRecognizer
    }
    const SpeechCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
    if (!SpeechCtor) {
      setVoiceStatus('')
      setError('Voice recording is unavailable in this browser. Type below or use your device’s keyboard microphone.')
      return
    }
    const speech = new SpeechCtor()
    speech.lang = 'en-US'
    speech.continuous = false
    speech.interimResults = true
    let spoken = ''
    let speechError = ''
    speech.onresult = event => {
      if(recognizerRef.current!==speech)return
      spoken = Array.from(event.results, item => item[0]?.transcript || '').join(' ').trim()
      if (spoken) {
        setText(spoken)
        setVoiceStatus('Speech captured. Review the words before saving or sending.')
        setError('')
      }
    }
    speech.onerror = event => {
      speechError = event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'Microphone access was blocked. Allow it in your browser’s site settings, or type below.'
        : event.error === 'no-speech'
        ? 'No speech detected by the browser. Speak after tapping the microphone, or try your device keyboard microphone.'
        : event.error === 'network'
        ? 'Browser dictation could not connect. Use your device keyboard microphone.'
        : 'Browser dictation stopped before detecting speech. Use your device keyboard microphone.'
      setVoiceStatus('')
      setError(speechError)
      speech.onerror=null
      stopBrowserDictation(speech)
    }
    speech.onend = () => {
      if (recognizerRef.current !== speech) return
      if(recordingTimeoutRef.current!==null)window.clearTimeout(recordingTimeoutRef.current)
      recordingTimeoutRef.current=null
      recognizerRef.current = null
      setRecording(false)
      setBusy(false)
      if (spoken) {
        setText(spoken)
        setError('')
        void parseCommand(spoken, 'voice')
      } else if (!speechError) {
        setVoiceStatus('')
        setError('No text detected by the browser. Use the microphone on your device keyboard in the text box.')
      }
    }
    recognizerRef.current = speech
    try {
      setRecording(true)
      speech.start()
      recordingTimeoutRef.current=window.setTimeout(()=>{if(recognizerRef.current===speech)stopBrowserDictation(speech)},110000)
      setVoiceStatus(note || 'Listening… Speak your request, then pause.')
    } catch (err) {
      recognizerRef.current = null
      setRecording(false)
      setVoiceStatus('')
      setError(err instanceof Error ? err.message : 'Could not start speech recognition. Use your keyboard microphone.')
    }
  }

  async function startCloudRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      captureStarting.current=false;setBusy(false)
      startBrowserDictation('Audio recording is unavailable in this browser. Using browser dictation instead.')
      return
    }
    let stream: MediaStream | null = null
    const generation=++captureGeneration.current
    let permissionTimer:ReturnType<typeof setTimeout>|undefined
    try {
      pauseDetector.current = createVoicePauseDetector()
      const permission=navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      void permission.then(value=>{if(generation!==captureGeneration.current||!mounted.current)value.getTracks().forEach(track=>track.stop())}).catch(()=>{})
      stream = await Promise.race([permission,new Promise<never>((_,reject)=>{permissionTimer=setTimeout(()=>{captureGeneration.current++;reject(new Error('Microphone permission is still pending. Allow access in your browser, then tap again, or type below.'))},15000)})])
      clearTimeout(permissionTimer)
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
        pauseDetector.current?.stop();pauseDetector.current=null
        recorder.onstop=null;recorder.ondataavailable=null
        if(recordingTimeoutRef.current!==null)window.clearTimeout(recordingTimeoutRef.current)
        recordingTimeoutRef.current=null
        if(recorder.state==='recording'){try{recorder.stop()}catch{/* Already stopped. */}}
        activeStream.getTracks().forEach(track=>track.stop())
        recorderRef.current=null;recordingStartedAtRef.current=null;chunksRef.current=[]
        setRecording(false);setBusy(false);setVoiceStatus('')
        setError('The microphone recording stopped unexpectedly. Try again or type below.')
      }
      recorder.onstop = async () => {
        pauseDetector.current?.stop();pauseDetector.current=null
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
          if(!mounted.current)return
          if (!transcript.transcript?.trim()) throw new Error('No text detected. Try a clearer recording.')
          const words = transcript.transcript.trim()
          setText(words)
          await parseCommand(words, 'voice')
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
      const detectsPauses=pauseDetector.current?.start(activeStream,()=>{
        if(recorder.state==='recording')recorder.stop()
      },()=>{
        cancelRecording()
        setError('No speech detected. Check that your microphone is connected and allowed, then try again or type below.')
      })
      setVoiceStatus(detectsPauses ? 'Listening… Speak your request, then pause. Fin will respond automatically.' : 'Listening… Speak your request, then choose Finish recording.')
      recordingTimeoutRef.current = window.setTimeout(() => {
        if (recorder.state === 'recording') { try { recorder.stop() } catch { /* Already stopped. */ } }
      }, 110_000)
    } catch (err) {
      pauseDetector.current?.stop();pauseDetector.current=null
      stream?.getTracks().forEach(track => track.stop())
      recorderRef.current = null
      recordingStartedAtRef.current = null
      setRecording(false)
      setBusy(false)
      setVoiceStatus('')
      const message = err instanceof DOMException && err.name==='NotAllowedError'
        ? 'Microphone access was blocked. Allow Microphone in this browser’s site settings for Finviant, then try again. You can also type below.'
        : err instanceof DOMException && err.name==='NotFoundError'
        ? 'No microphone was found. Connect a microphone or type below.'
        : err instanceof DOMException && err.name==='NotReadableError'
        ? 'Another app or your device settings prevented microphone access. Close other recording apps and try again, or type below.'
        : err instanceof Error ? err.message : 'Microphone is unavailable.'
      setError('The microphone could not start. ' + message)
    } finally { clearTimeout(permissionTimer);captureStarting.current=false }
  }

  function cancelRecording() {
    captureGeneration.current++
    pauseDetector.current?.stop();pauseDetector.current=null
    if(recordingTimeoutRef.current!==null)window.clearTimeout(recordingTimeoutRef.current)
    recordingTimeoutRef.current=null
    const recorder=recorderRef.current
    if(recorder){recorder.onstop=null;recorder.ondataavailable=null;recorder.onerror=null;if(recorder.state==='recording')recorder.stop();recorder.stream.getTracks().forEach(track=>track.stop())}
    const speech=recognizerRef.current
    if(speech){speech.onend=null;speech.onresult=null;speech.onerror=null;try{speech.stop()}catch{/* Already stopped. */}}
    recorderRef.current=null;recognizerRef.current=null;chunksRef.current=[];recordingStartedAtRef.current=null
    setEntryMode('text');setRecording(false);setBusy(false);setVoiceStatus('Recording cancelled. You can type below or try the microphone again.')
  }

  function toggleRecording() {
    if (recording) {
      if (recognizerRef.current) {
        setBusy(true)
        stopBrowserDictation(recognizerRef.current)
      } else if (recorderRef.current?.state === 'recording') {
        recorderRef.current.stop()
      }
      return
    }
    if (busy || captureStarting.current) return
    setEntryMode('voice')
    setError('')
    setAction(null)
    setQuickInvoiceRequest(null)
    setResult(null)
    if (voiceMode === 'cloud') {
      captureStarting.current=true;setBusy(true);setVoiceStatus('Opening microphone… Allow access if your browser asks.')
      // Begin getUserMedia in the actual tap handler, before any await.
      // This preserves user activation on Safari and other mobile browsers.
      void startCloudRecording()
    } else {
      // Likewise, start browser recognition before leaving the tap handler.
      startBrowserDictation('Listening… Speak your request, then pause.')
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

  const payload=result?.result??result
  const createdKind=payload?.invoice?.id?'invoice':payload?.estimate?.id?'estimate':payload?.change_order?.id?'change_order':null
  return <>
    <div className="fin-launcher"><button type="button" className="voice-fab" onClick={()=>{setText('');setOpen(true);toggleRecording()}} aria-label="Talk to Fin"><span className="fin-launcher-orb"><FinMark onDark/></span><span className="fin-launcher-caption">Ask <FinName onDark/><small>Tap to speak</small></span></button><button type="button" className="fin-type-entry" onClick={()=>{setEntryMode('text');setOpen(true)}}>Type to Fin</button></div>
    {open && <FormDialog label="Fin — your office assistant" cleanVersion={result??conversation} busy={busy||recording} disableFields={false} onClose={()=>setOpen(false)} wide><section className="assistant-panel">
      <div className="assistant-head"><div><p className="eyebrow">Fin · Your office assistant</p><h2>{quickInvoiceRequest?'Review '+quickInvoiceRequest.seed.kind:createdKind?'Review '+createdKind.replace('_',' '):'What can I help you with?'}</h2></div><button className="icon-button" disabled={busy||recording} onClick={() => {if(!busy&&!recording)setOpen(false)}} type="button" aria-label="Close">×</button></div>
      {!quickInvoiceRequest&&!createdKind&&<>
      {conversation.length>0&&<section className="fin-conversation" aria-label="Conversation with Fin" aria-live="polite" tabIndex={0}>{conversation.map((turn,index)=><article key={index}><p className="fin-question"><strong>You</strong>{turn.question}</p><ResultView result={turn.response}/></article>)}<div ref={conversationEnd}/></section>}
      {recording&&<div className="fin-recording-state"><span className="fin-listening-mark" aria-hidden="true"><FinMark onDark/></span><strong>Listening…</strong><div className="fin-recording-actions"><button type="button" className="secondary-button" onClick={toggleRecording} disabled={busy}>Finish recording</button><button type="button" data-keep-dialog className="text-button" onClick={cancelRecording} disabled={busy}>Cancel recording</button></div></div>}
      {!recording&&!busy&&(entryMode==='text'||error||conversation.length>0||action)&&<button type="button" className="secondary-button fin-speak-again" onClick={toggleRecording}>{error?'Try microphone again':conversation.length||action?'Speak a follow-up':'Speak instead'}</button>}
      {workingMessage&&<p className="fin-working" role="status">{workingMessage}</p>}
      {voiceStatus&&<p className="assistant-help" role="status">{voiceStatus}</p>}
      <p className="assistant-help">{conversation.length?'Ask a follow-up by voice or type below.':'Speak or type a question, invoice, estimate, or task.'}</p>
      <details className="fin-help"><summary>Using Fin and your business data</summary><button type="button" className="text-button" onClick={()=>textAreaRef.current?.focus()}>Use keyboard dictation</button><p className="assistant-help">Ask about your saved business profile, customers, unpaid invoices or upcoming work. Fin uses current records in this business; its answers show the records checked. Teach Fin through Settings → Company profile. Business questions are available to owners and administrators. Tap in the text box and use your device’s keyboard dictation if available, or type your request. Check that your words appear, then review the invoice or estimate. Say each description and dollar amount, for example: “Create an estimate for Bob Smith for mowing $100 and edging $40, total $140.” When OpenAI transcription is enabled, the large microphone records audio securely for server transcription; otherwise Finviant Office uses browser dictation. Speech may be processed by OpenAI and the resulting text is saved to your business account. Nothing is sent to customers without review.</p></details>
      <div className="command-box"><textarea ref={textAreaRef} aria-label="Describe your invoice or request" value={text} disabled={busy||recording} onChange={(e) => { setText(e.target.value); setQuickInvoiceRequest(null); setAction(null); setResult(null) }} maxLength={6000} placeholder={conversation.length?"Ask a follow-up…":"Ask a question or describe what you need…"} /><button type="button" className="primary-button compact fin-submit" aria-label={isVoiceDocumentCommand(text)?`Review ${voiceDocumentKind(text)}`:'Ask Fin'} onClick={submitText} disabled={busy || recording || !text.trim()}>{busy&&!recording?'Working…':isVoiceDocumentCommand(text) ? `Review ${voiceDocumentKind(text)}` : <>Ask <FinName onDark/></>}</button></div>
      {conversation.length>0&&<div className="fin-conversation-controls"><span>Fin uses recent messages and current business records.</span><button type="button" className="text-button" disabled={busy||recording} onClick={()=>{setConversation([]);reset();textAreaRef.current?.focus()}}>New conversation</button></div>}
      </>}
      {quickInvoiceRequest && <QuickInvoiceReview business={business} key={quickInvoiceRequest.command} command={quickInvoiceRequest.command} initialSeed={quickInvoiceRequest.seed} parserNotice={quickInvoiceRequest.notice} onCancel={() => setQuickInvoiceRequest(null)} onSaved={(document,kind,delivery) => { setQuickInvoiceRequest(null); setText(''); setResult({[kind]:document,delivery}); onChanged() }} />}
      {action && !result && <div className="action-preview"><span className="intent-pill">{friendlyIntent(action.intent)}</span><h3>{action.clarification_question || 'Ready to do this?'}</h3><p>{action.clarification_question ? 'Add the missing detail and send the command again.' : describe(action)}</p>{action.requires_confirmation && !action.clarification_question && <div className="preview-actions"><button data-keep-dialog className="secondary-button" onClick={reject} disabled={busy}>Cancel</button><button className="primary-button" onClick={confirm} disabled={busy}>{busy ? 'Working…' : 'Confirm'}</button></div>}</div>}
      <ResultView result={result} />
      {createdKind&&!payload.delivery&&<CreatedDocumentDelivery key={payload[createdKind].id} business={business} kind={createdKind} documentId={payload[createdKind].id} onChanged={onChanged} onBusyChange={setBusy}/>}
      {createdKind&&<div className="preview-actions"><button type="button" className="secondary-button" aria-label="Close review" disabled={busy} onClick={()=>setOpen(false)}>Done</button><button type="button" className="text-button" disabled={busy} onClick={reset}>New request</button></div>}
      {error && <p role="alert" className="form-message error-text">{error}</p>}
      {!quickInvoiceRequest&&!createdKind&&conversation.length===0&&<div className="assistant-hints"><span>“Who hasn’t paid me?”</span><span>“Create a customer named Bob Smith.”</span><span>“Add $475 labor to Smith’s kitchen job as a change order.”</span></div>}
    </section></FormDialog>}
  </>
}
