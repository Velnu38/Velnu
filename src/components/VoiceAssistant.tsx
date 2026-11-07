import { finInvoiceDraft, namedInvoiceSource, type FinInvoiceDraft } from '../lib/voiceDocument'
import { findInvoiceSources, resolveInvoiceSource, type InvoiceSource, type InvoiceSourceTarget } from '../services/finInvoiceSources'
import { canAccess } from '../lib/workspaceAccess'
import FinCustomerSuggestions from './FinCustomerSuggestions'
import FinActionButton from './FinActionButton'
import {setAssistantWorking} from '../lib/assistantEntry'
import {createVoicePauseDetector} from '../lib/voicePause'
import {checkMicrophoneContext,describeMicrophoneFailure,startCompatibleRecorder,type MicrophoneFailure,type MicrophoneStage} from '../lib/microphone'
import MicrophoneRecovery from './MicrophoneRecovery'
import CreatedDocumentDelivery from './CreatedDocumentDelivery'
import {FinMark} from './FinBrand'
import FormDialog from './FormDialog'
import { useEffect, useRef, useState } from 'react'
import FinWorkflowReview from './FinWorkflowReview'
import {requestFin,executeFinReview,cancelFinReview,type FinReply,type FinExecution} from '../services/finWorkflow'
import {uiCatalog,recordHref,navigationHref,type Plan} from '../../supabase/functions/fin-workflow/protocol'
import type { CurrentBusiness } from '../lib/business'
import {transcribeVoice,getTranscriptionStatus,type AiCommandSource} from '../services/ai'

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

function SafeFinText({text}:{text:string}){return <>{text.split(/(\*\*[^*\n]{1,100}\*\*)/g).map((part,i)=>part.startsWith('**')&&part.endsWith('**')?<strong key={i}>{part.slice(2,-2)}</strong>:part)}</>}
function FinResponse({result,onNavigate}:{result:FinReply;onNavigate:()=>void}){return <section className="fin-answer" aria-label="Fin’s answer"><p className="eyebrow">Fin · Your office assistant</p><p className="fin-answer-text"><SafeFinText text={result.answer}/></p>{result.clarification&&<p className="fin-clarification"><strong>{result.clarification}</strong></p>}{result.sources?.length>0&&<details><summary>Based on saved records</summary><ul>{result.sources.map(s=><li key={s.key}>{s.label}{recordHref(s.key)&&<a href={recordHref(s.key)!} onClick={onNavigate}>Open record</a>}</li>)}</ul></details>}{result.navigation?.map(key=>Object.hasOwn(uiCatalog,key)&&<a key={key} className="secondary-button" href={navigationHref(key)!} onClick={onNavigate}>Open {uiCatalog[key as keyof typeof uiCatalog]}</a>)}<details><summary>Records checked and limits</summary><p>Checked {new Date(result.as_of).toLocaleString()}</p><ul>{result.limits?.map((l:string)=><li key={l}>{l}</li>)}</ul></details></section>}

export default function VoiceAssistant({ business, onChanged, onOpenInvoice }: { business: CurrentBusiness; onChanged: () => void; onOpenInvoice: (draft: FinInvoiceDraft | InvoiceSourceTarget) => boolean }) {
  const [open, setOpen] = useState(false)
  const [entryRevision,setEntryRevision]=useState(0)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [invoiceSources, setInvoiceSources] = useState<InvoiceSource[]>([])
  const [conversation,setConversation]=useState<Array<{question:string;response:FinReply}>>([])
  const [plan,setPlan]=useState<Plan|null>(null),[execution,setExecution]=useState<FinExecution|null>(null)
  const thread=useRef(crypto.randomUUID()),retryRequest=useRef<{text:string;id:string}|null>(null)
  const conversationEnd=useRef<HTMLDivElement|null>(null)
  useEffect(()=>{if(!plan&&!execution)conversationEnd.current?.scrollIntoView({block:'nearest',behavior:'instant'})},[conversation,plan,execution])
  const executionHeading=useRef<HTMLHeadingElement>(null);useEffect(()=>{if(execution){executionHeading.current?.focus({preventScroll:true});executionHeading.current?.closest('dialog')?.scrollTo({top:0})}},[execution])
  const [error, setError] = useState('')
  const [voiceStatus, setVoiceStatus] = useState('')
  const [entryMode, setEntryMode] = useState<'voice' | 'text'>('text')
  const pauseDetector = useRef<ReturnType<typeof createVoicePauseDetector>>(null)
  const [voiceMode, setVoiceMode] = useState<'cloud' | 'browser'>('cloud')
  const [microphoneFailure,setMicrophoneFailure]=useState<MicrophoneFailure|null>(null)
  const preferredVoiceMethod=useRef<'cloud'|'browser'|null>(null)
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
    void getTranscriptionStatus(business.id).then(status=>{if(active&&!preferredVoiceMethod.current)setVoiceMode(status.configured?'cloud':'browser')}).catch(()=>{
      // A temporary status failure does not prove cloud transcription is disabled.
      if(active&&!preferredVoiceMethod.current)setVoiceMode('cloud')
    })
    return()=>{active=false}
  },[business.id])

  useEffect(()=>{setAssistantWorking(busy||recording);return()=>setAssistantWorking(false)},[busy,recording])
  useEffect(()=>{
    const openEntry=(event:Event)=>{const incoming=(event as CustomEvent<{text?:string}>).detail?.text;if(typeof incoming!=="string"||incoming.length>2000)return;if(busy||recording)return;setOpen(true);setEntryRevision(v=>v+1);setEntryMode('text');setError('');if(!plan&&!text.trim())setText(incoming);else setVoiceStatus('Finish or clear the current request or review, then choose Ask Fin in the form again. Your entries are preserved.')}
    window.addEventListener('finviant-assistant-entry',openEntry);return()=>window.removeEventListener('finviant-assistant-entry',openEntry)
  },[busy,recording,plan,text])

  useEffect(()=>{
    const openTyping=()=>{setEntryMode('text');setOpen(true)}
    window.addEventListener('finviant-assistant-type',openTyping)
    return()=>window.removeEventListener('finviant-assistant-type',openTyping)
  },[])

  function reset() {
    setInvoiceSources([])
    setMicrophoneFailure(null)
    setEntryMode('text')
    setError(''); setVoiceStatus(''); setText('')
  }

  async function openInvoiceSource(source: InvoiceSource) {
    const target = await resolveInvoiceSource(business.id, source)
    if (mounted.current && onOpenInvoice(target)) {
      setOpen(false)
      reset()
    }
  }

  async function chooseInvoiceSource(source: InvoiceSource) {
    if (mutationInFlight.current) return
    mutationInFlight.current = true
    setBusy(true); setError('')
    try { await openInvoiceSource(source) }
    catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : 'Unable to open the saved work.') }
    finally { mutationInFlight.current = false; if (mounted.current) setBusy(false) }
  }

  async function parseCommand(command: string, source: AiCommandSource, customerId?: string) {
    if (mutationInFlight.current) return
    if(plan&&/^yes[.! ]*$/i.test(command.trim())){setText('');await confirm({id:plan.id,version:plan.version});return}
    if(plan&&/^no[.! ]*$/i.test(command.trim())){setText('');await reject();return}
    setInvoiceSources([])
    const sourceRequest = !plan && namedInvoiceSource(command)
    if (sourceRequest && canAccess(business, 'billing') && (sourceRequest.kind !== 'job' || canAccess(business, 'jobs'))) {
      mutationInFlight.current = true
      setBusy(true); setError(''); setWorkingMessage('Fin is finding the saved work…')
      try {
        const matches = await findInvoiceSources(business.id, sourceRequest)
        if (mounted.current && matches.length === 1) await openInvoiceSource(matches[0])
        else if (mounted.current) setInvoiceSources(matches)
      } catch (err) {
        if (mounted.current) { setText(command); setError(err instanceof Error ? err.message : 'Unable to find the saved work.') }
      } finally {
        mutationInFlight.current = false
        if (mounted.current) { setBusy(false); setWorkingMessage('') }
      }
      return
    }
    const invoice = finInvoiceDraft(command, customerId)
    if (invoice && canAccess(business, 'billing')) {
      if (onOpenInvoice(invoice)) {
        setOpen(false); reset()
      }
      return
    }
    setError('');setMicrophoneFailure(null);setVoiceStatus('');setPlan(null);setExecution(null)
    setBusy(true);setWorkingMessage('Fin is checking your account and preparing the next step…');mutationInFlight.current=true
    const request=retryRequest.current?.text===command?retryRequest.current:{text:command,id:crypto.randomUUID()}
    retryRequest.current=request
    try {
      const response=await requestFin(business.id,thread.current,request.id,command)
      if(!mounted.current)return
      setConversation(turns=>[...turns,{question:command,response}].slice(-12));setPlan(response.plan||null);setExecution(response.execution||null);setText('');retryRequest.current=null
    } catch(error){if(mounted.current){setText(command);setError(error instanceof Error?error.message:'Fin could not complete this request.')}}
    finally{if(mounted.current){setBusy(false);setWorkingMessage('')}mutationInFlight.current=false}
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
      setMicrophoneFailure(describeMicrophoneFailure(new DOMException('Browser dictation is not available.','NotSupportedError'),'dictation'))
      return
    }
    let speech:BrowserRecognizer
    try { speech=new SpeechCtor() } catch(error) { setMicrophoneFailure(describeMicrophoneFailure(error,'dictation'));setVoiceStatus('');setBusy(false);return }
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
      if(event.error==='not-allowed'||event.error==='service-not-allowed')setMicrophoneFailure(describeMicrophoneFailure({name:event.error,message:speechError},'dictation'))
      else setError(speechError)
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
        if(speechError){setError(speechError+' Check the captured words below before submitting.');setVoiceStatus('Your partial request is preserved below.')}
        else {setError('');void parseCommand(spoken, 'voice')}
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
      setMicrophoneFailure(describeMicrophoneFailure(err,'dictation'))
    }
  }

  async function startCloudRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      captureStarting.current=false;setBusy(false)
      startBrowserDictation('Audio recording is unavailable in this browser. Using browser dictation instead.')
      return
    }
    let stream: MediaStream | null = null
    let stage:MicrophoneStage='access'
    const generation=++captureGeneration.current
    let permissionTimer:ReturnType<typeof setTimeout>|undefined
    try {
      checkMicrophoneContext()
      // Request the native microphone immediately; optional audio processing
      // must never prevent device access or choose the encoder for the browser.
      const permission=navigator.mediaDevices.getUserMedia({ audio: true })
      pauseDetector.current = createVoicePauseDetector()
      void permission.then(value=>{if(generation!==captureGeneration.current||!mounted.current)value.getTracks().forEach(track=>track.stop())}).catch(()=>{})
      stream = await Promise.race([permission,new Promise<never>((_,reject)=>{permissionTimer=setTimeout(()=>{captureGeneration.current++;reject(new DOMException('Microphone permission is still pending. Choose Allow in the browser prompt, then retry.','MicrophonePermissionTimeout'))},15000)})])
      clearTimeout(permissionTimer)
      if (!mounted.current) { stream.getTracks().forEach(track => track.stop()); return }
      stage='recorder'
      const activeStream = stream
      recordingStartedAtRef.current = Date.now()
      const recorder=startCompatibleRecorder(activeStream,recorder=>{
      chunksRef.current = []
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onerror = event => {
        pauseDetector.current?.stop();pauseDetector.current=null
        recorder.onstop=null;recorder.ondataavailable=null
        if(recordingTimeoutRef.current!==null)window.clearTimeout(recordingTimeoutRef.current)
        recordingTimeoutRef.current=null
        if(recorder.state==='recording'){try{recorder.stop()}catch{/* Already stopped. */}}
        activeStream.getTracks().forEach(track=>track.stop())
        recorderRef.current=null;recordingStartedAtRef.current=null;chunksRef.current=[]
        setRecording(false);setBusy(false);setVoiceStatus('')
        setMicrophoneFailure(describeMicrophoneFailure((event as Event & {error?:unknown}|undefined)?.error||new Error('The microphone recording stopped unexpectedly.'),'recorder'))
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
      })
      recorderRef.current=recorder
      setBusy(false)
      setRecording(true)
      const detectsPauses=pauseDetector.current?.start(activeStream,()=>{
        if(recorder.state==='recording')recorder.stop()
      },()=>{
        cancelRecording()
        setError('No speech detected. Check that your microphone is connected and allowed, then try again or type below.')
      },()=>{if(recorderRef.current===recorder)setVoiceStatus('Listening… Speak your request, then choose Finish recording.')})
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
      setMicrophoneFailure(describeMicrophoneFailure(err,stage))
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

  function toggleRecording(method=voiceMode) {
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
    setMicrophoneFailure(null)
    setError('')
    if (method === 'cloud') {
      captureStarting.current=true;setBusy(true);setVoiceStatus('Opening microphone… Allow access if your browser asks.')
      // Begin getUserMedia in the actual tap handler, before any await.
      // This preserves user activation on Safari and other mobile browsers.
      void startCloudRecording()
    } else {
      // Likewise, start browser recognition before leaving the tap handler.
      startBrowserDictation('Listening… Speak your request, then pause.')
    }
  }

  function chooseVoiceMethod(method:'cloud'|'browser') {
    preferredVoiceMethod.current=method
    setVoiceMode(method)
    toggleRecording(method)
  }

  function openAssistant() {
    // Opening Fin never requests microphone access or discards a pending request.
    // Speaking remains a direct tap inside the panel for Safari user activation.
    setEntryMode('text')
    setOpen(true)
  }

  async function confirm(approval?:{id:string;version:number}) {
    if(!plan||mutationInFlight.current||text.trim()&&!approval)return
    if(approval&&(approval.id!==plan.id||approval.version!==plan.version))return
    if(Date.parse(plan.expires_at)<=Date.now()){setError('This review expired. Ask Fin to refresh it.');return}
    mutationInFlight.current=true;setBusy(true);setError('')
    try{const saved=await executeFinReview(business.id,thread.current,plan);if(!mounted.current)return;setExecution(saved);setPlan(null);onChanged()}
    catch(error){if(mounted.current)setError(error instanceof Error?error.message:'The save result is not confirmed. Retry the same review.')}
    finally{mutationInFlight.current=false;if(mounted.current)setBusy(false)}
  }
  async function reject() {
    if(!plan||mutationInFlight.current)return
    mutationInFlight.current=true;setBusy(true);setError('')
    try{await cancelFinReview(business.id,thread.current,plan);if(mounted.current){setPlan(null);setVoiceStatus('Plan cancelled. No changes were saved.')}}
    catch(error){if(mounted.current)setError(error instanceof Error?error.message:'Cancellation could not be confirmed.')}
    finally{mutationInFlight.current=false;if(mounted.current)setBusy(false)}
  }
  async function newConversation(){if(plan){try{await cancelFinReview(business.id,thread.current,plan);setPlan(null)}catch{setError('Cancel the pending plan before starting a new conversation.');return}}thread.current=crypto.randomUUID();retryRequest.current=null;setConversation([]);setExecution(null);reset();textAreaRef.current?.focus()}

  const speechWindow=window as typeof window & {SpeechRecognition?:unknown;webkitSpeechRecognition?:unknown}
  const browserDictationAvailable=typeof speechWindow.SpeechRecognition==='function'||typeof speechWindow.webkitSpeechRecognition==='function'
  return <>
    <div className="fin-launcher"><FinActionButton onClick={openAssistant} aria-label="Ask Fin" title="Ask Fin · speak or type"/></div>
    {open && <FormDialog key={entryRevision} label="Fin — your office assistant" navigationScope="fin" autoFocusFields={entryMode==='text'} cleanVersion={execution??conversation} busy={busy||recording} disableFields={false} onClose={()=>setOpen(false)} wide><section className="assistant-panel">
      <div className="assistant-head"><div><p className="eyebrow">Fin · Your office assistant</p><h2>{plan?'Review your request':'What can I help you with?'}</h2></div><button className="icon-button" disabled={busy||recording} onClick={() => {if(!busy&&!recording)setOpen(false)}} type="button" aria-label="Close">×</button></div>
      {plan&&<FinWorkflowReview plan={plan} timezone={business.timezone||'America/New_York'} busy={busy||recording} hasEdits={!!text.trim()} onConfirm={()=>void confirm()} onCancel={()=>void reject()} onEdit={()=>textAreaRef.current?.focus()}/>}
      {execution&&<section className="fin-execution" aria-label="Fin’s completed steps"><h3 ref={executionHeading} tabIndex={-1}>Saved to this account</h3><ul>{execution.steps.map((step,index)=><li key={index}>{step.label} — {step.status==='awaiting_send_review'?'Ready for delivery review; not sent':'Completed'}{recordHref(step.resource+':'+step.id)&&<a href={recordHref(step.resource+':'+step.id)!} onClick={()=>setOpen(false)}>Open record</a>}</li>)}</ul>{execution.steps.filter((step,index,all)=>['invoices','estimates','change_orders'].includes(step.resource)&&all.map(other=>other.id).lastIndexOf(step.id)===index&&step.operation!=='void_invoice'&&step.operation!=='record_payment').map(step=><CreatedDocumentDelivery key={step.id} business={business} kind={step.resource==='invoices'?'invoice':step.resource==='estimates'?'estimate':'change_order'} documentId={step.id} onChanged={onChanged} onBusyChange={setBusy}/>)}</section>}
      {<>
      {conversation.length>0&&<section className="fin-conversation" aria-label="Conversation with Fin" aria-live="polite" tabIndex={0}>{conversation.map((turn,index)=><article key={index}><p className="fin-question"><strong>You</strong>{turn.question}</p><FinResponse result={turn.response} onNavigate={()=>setOpen(false)}/></article>)}<div ref={conversationEnd}/></section>}
      {microphoneFailure&&<MicrophoneRecovery failure={microphoneFailure} canDictate={browserDictationAvailable} onRetry={()=>chooseVoiceMethod('cloud')} onDictate={()=>chooseVoiceMethod('browser')} onType={()=>{setMicrophoneFailure(null);setError('');setEntryMode('text');setVoiceStatus('Type below, or use the microphone on your phone’s keyboard.');textAreaRef.current?.focus()}}/>}
      {recording&&<div className="fin-recording-state"><span className="fin-listening-mark" aria-hidden="true"><FinMark onDark/></span><strong>Listening…</strong><div className="fin-recording-actions"><button type="button" className="secondary-button" onClick={()=>toggleRecording()} disabled={busy}>Finish recording</button><button type="button" data-keep-dialog className="text-button" onClick={cancelRecording} disabled={busy}>Cancel recording</button></div></div>}
      {!microphoneFailure&&!recording&&!busy&&(entryMode==='text'||error||conversation.length>0)&&<button type="button" className="secondary-button fin-speak-again" onClick={()=>toggleRecording()}>{error?'Try microphone again':conversation.length?'Speak a follow-up':'Speak instead'}</button>}
      {workingMessage&&<p className="fin-working" role="status">{workingMessage}</p>}
      {invoiceSources.length>0&&<section aria-label="Matching saved work"><h3>Which record should this invoice use?</h3><ul>{invoiceSources.map(source=><li key={source.id}><button type="button" className="text-button" disabled={busy} onClick={()=>void chooseInvoiceSource(source)}>{source.label}</button></li>)}</ul></section>}
      {voiceStatus&&<p className="assistant-help" role="status">{voiceStatus}</p>}
      <p className="assistant-help">{conversation.length?'Ask a follow-up by voice or type below.':'Speak or type a question, invoice, estimate, or task.'}</p>
      <details className="fin-help"><summary>Using Fin and your business data</summary><button type="button" className="text-button" onClick={()=>textAreaRef.current?.focus()}>Use keyboard dictation</button><p className="assistant-help">Ask about your saved business profile, customers, unpaid invoices or upcoming work. Fin uses current records in this business; its answers show the records checked. Teach Fin through More → Company Profile. Fin respects your role and the modules the account owner enables. Tap in the text box and use your device’s keyboard dictation if available, or type your request. Check that your words appear, then review the invoice or estimate. Say each description and dollar amount, for example: “Create an estimate for Bob Smith for mowing $100 and edging $40, total $140.” When OpenAI transcription is enabled, the large microphone records audio securely for server transcription; otherwise Finviant Office uses browser dictation. Speech may be processed by OpenAI and the resulting text is saved to your business account. Nothing is sent to customers without review.</p></details>
      <div className="command-box"><textarea ref={textAreaRef} aria-label="Describe your invoice or request" value={text} disabled={busy||recording} onChange={(e) => { setText(e.target.value); }} maxLength={6000} placeholder={conversation.length?"Ask a follow-up…":"Ask a question or describe what you need…"} /><FinActionButton aria-label="Ask Fin" onClick={submitText} disabled={busy || recording || !text.trim()} working={busy&&!recording}/></div>
      <FinCustomerSuggestions key={business.id} businessId={business.id} text={text} disabled={busy||recording} onSelect={(value, customerId)=>{if(canAccess(business, 'billing') && finInvoiceDraft(text)) void parseCommand(text, 'text', customerId); else {setText(value);textAreaRef.current?.focus()}}}/>
      {conversation.length>0&&<div className="fin-conversation-controls"><span>Fin uses recent messages and current business records.</span><button type="button" className="text-button" disabled={busy||recording} onClick={()=>void newConversation()}>New conversation</button></div>}
      </>}
      {error && <p role="alert" className="form-message error-text">{error}</p>}
      {conversation.length===0&&<div className="assistant-hints"><span>“Who hasn’t paid me?”</span><span>“Create a customer named Bob Smith.”</span><span>“Add $475 labor to Smith’s kitchen job as a change order.”</span></div>}
    </section></FormDialog>}
  </>
}
