from pathlib import Path
import json

def patch(path,old,new,count=1):
 p=Path(path); s=p.read_text()
 if s.count(old)!=count: raise RuntimeError(f'{path}: expected {count} markers, found {s.count(old)}')
 p.write_text(s.replace(old,new,count))
p='supabase/functions/ai-command/index.ts'
patch(p,'import "jsr:@supabase/functions-js/edge-runtime.d.ts";','import "jsr:@supabase/functions-js/edge-runtime.d.ts";\nimport { providerJson, ProviderRequestError } from "../_shared/providerRequest.ts";')
patch(p,'https://esm.sh/@supabase/supabase-js@2','https://esm.sh/@supabase/supabase-js@2.57.4')
patch(p,'Deno.serve(async(req:Request)=>{','Deno.serve(async(req:Request)=>{const requestId=crypto.randomUUID();const respond=(status:number,body:any)=>{if(status>=400)console.warn(JSON.stringify({service:"ai-command",request_id:requestId,status}));return new Response(JSON.stringify({...body,request_id:requestId}),{status,headers:{...headers,"Cache-Control":"no-store","X-Request-ID":requestId}});};')
patch(p,'const transcript=String(body.transcript??"").trim().slice(0,6000);','if(!body||typeof body!=="object"||typeof body.transcript!=="string")return respond(400,{error:"A text command is required"});const transcript=body.transcript.trim();if(transcript.length>6000)return respond(413,{error:"The command is too long. Please use fewer than 6,001 characters."});')
old='const aiRes=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${openaiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-5-mini",instructions,input,store:false,text:{format:{type:"json_schema",name:"finviant_command",strict:true,schema}}})});if(!aiRes.ok){console.error("OpenAI command parser error",aiRes.status);return respond(502,{error:"Command interpretation failed"});}const aiJson=await aiRes.json();'
new='const {error:budgetError}=await supabase.rpc("reserve_ai_provider_attempt",{p_business_id:businessId,p_kind:"command"});if(budgetError)return respond(budgetError.code==="42501"?403:budgetError.code==="P0001"?429:503,{error:"AI attempt allowance could not be reserved. No provider call was made."});const aiJson=await providerJson("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${openaiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-5-mini",instructions,input,store:false,max_output_tokens:3000,text:{format:{type:"json_schema",name:"finviant_command",strict:true,schema}}})},{timeoutMs:45000,maxBytes:1048576});'
patch(p,old,new)
patch(p,'console.error("Failed to save ai action",actionError)','console.error("Failed to save ai action",actionError.code)')
patch(p,'catch(error){console.error(error);return respond(500,{error:"Unexpected server error"});}','catch(error){if(error instanceof ProviderRequestError){return respond(error.code==="timeout"?504:error.status===429?429:502,{error:"The AI provider did not return a usable answer. No business action was executed. Retry deliberately; provider attempts count toward the safety allowance.",code:"ai_provider_"+error.code});}console.error(JSON.stringify({service:"ai-command",request_id:requestId,code:"unexpected"}));return respond(500,{error:"Unable to prepare the proposal. No business action was executed."});}')
p='supabase/functions/transcribe-voice/index.ts'
patch(p,'import "jsr:@supabase/functions-js/edge-runtime.d.ts";','import "jsr:@supabase/functions-js/edge-runtime.d.ts";\nimport { providerJson, ProviderRequestError } from "../_shared/providerRequest.ts";')
patch(p,'https://esm.sh/@supabase/supabase-js@2','https://esm.sh/@supabase/supabase-js@2.57.4')
s=Path(p).read_text(); a=s.index('    // Basic per-user spending guard'); b=s.index('    const prompt =',a)
s=s[:a]+'''    // Failed and uncertain provider attempts remain counted; row locking prevents overshoot.
    const { error: budgetError } = await db.rpc("reserve_ai_provider_attempt", {
      p_business_id: businessId, p_kind: "transcription",
    });
    if (budgetError) return respond(budgetError.code === "42501" ? 403 : budgetError.code === "P0001" ? 429 : 503, {
      error: "Voice attempt allowance could not be reserved. No provider call was made.",
    });

'''+s[b:]
a=s.index('    let response: Response;'); b=s.index('    const { data: saved,',a)
s=s[:a]+'''    let result: Record<string, unknown>;
    try {
      result = await providerJson("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST", headers: { Authorization: "Bearer " + apiKey }, body: upload,
      }, { timeoutMs: 60000, maxBytes: 262144 });
    } catch (err) {
      const status = err instanceof ProviderRequestError && err.code === "timeout" ? 504
        : err instanceof ProviderRequestError && err.status === 429 ? 429 : 502;
      return respond(status, { error: "Speech processing could not be confirmed. No business record was changed. You can use typed input instead.", code: "voice_provider_unavailable" });
    }
    const transcript = typeof result.text === "string" ? result.text.trim() : "";
    if (!transcript || transcript.length > 6000) return respond(422, { error: "No usable short command was detected. Please type or record a shorter request." });

'''+s[b:]; Path(p).write_text(s)
p='src/services/jobs.ts'; s=Path(p).read_text(); a=s.index('export async function createJob(')
s=s[:a]+'''export async function createJob(businessId: string, input: JobInput) {
  if (!input.customer_id || !input.title.trim()) throw new Error('Choose a customer and enter a job title')
  const { data, error } = await supabase.rpc('create_job_atomic', {
    target_business_id: businessId, request_id: input.request_id ?? crypto.randomUUID(),
    payload: { customer_id: input.customer_id, property_id: input.property_id || null,
      title: input.title.trim(), description: input.description?.trim() || null,
      scheduled_start: input.scheduled_start || null, scheduled_end: input.scheduled_end || null },
  })
  if (error) throw error
  if (!data?.id) throw new Error('The job result could not be confirmed. Retry the same submission.')
  return data
}
export async function updateJobStatus(jobId: string, status: JobInput['status']) {
  if (!status) throw new Error('Choose a job status')
  const { data, error } = await supabase.rpc('set_job_status_atomic', { p_job_id: jobId, p_status: status })
  if (error) throw error
  if (!data?.id || data.status !== status) throw new Error('Job status could not be confirmed. Refresh before changing it again.')
}
'''; Path(p).write_text(s)
p='src/components/VoiceAssistant.tsx'
patch(p,"import { useRef, useState } from 'react'","import { useEffect, useRef, useState } from 'react'")
patch(p,'  const recorderRef = useRef<MediaRecorder | null>(null)','  const mutationInFlight = useRef(false)\n  const mounted = useRef(true)\n  const recorderRef = useRef<MediaRecorder | null>(null)')
patch(p,'  function reset() {','''  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (recordingTimeoutRef.current !== null) window.clearTimeout(recordingTimeoutRef.current)
      const recorder = recorderRef.current
      if (recorder) {
        recorder.onstop = null; recorder.ondataavailable = null; recorder.onerror = null
        if (recorder.state === 'recording') recorder.stop()
        recorder.stream?.getTracks().forEach(track => track.stop())
      }
      const speech = recognizerRef.current
      if (speech) { speech.onend = null; speech.onresult = null; speech.onerror = null; speech.stop() }
      chunksRef.current = []
    }
  }, [])
  function reset() {''')
patch(p,'      const preferredFormats =',"      if (!mounted.current) { stream.getTracks().forEach(track => track.stop()); return }\n      const preferredFormats =")
patch(p,"    if (!action?.action_id) return\n    setBusy(true); setError('')","    if (!action?.action_id || mutationInFlight.current) return\n    mutationInFlight.current = true\n    setBusy(true); setError('')")
patch(p,'    } finally { setBusy(false) }','    } finally { mutationInFlight.current = false; setBusy(false) }')
patch(p,"    if (action?.action_id) await rejectAiAction(action.action_id)\n    reset()","    if (mutationInFlight.current) return\n    mutationInFlight.current = true; setBusy(true); setError('')\n    try { if (action?.action_id) await rejectAiAction(action.action_id); reset() }\n    catch { setError('Cancellation could not be confirmed. Nothing will be automatically executed. Retry cancellation.') }\n    finally { mutationInFlight.current = false; setBusy(false) }")
patch(p,'onClick={reject}>Cancel','onClick={reject} disabled={busy}>Cancel')
line='  if (payload.payment) return <p className="assistant-result">Payment of ${Number(payload.payment.amount).toFixed(2)} recorded.</p>\n'
patch(p,line,''); patch(p,'  if (payload.invoice)',line+'  if (payload.invoice)')
p='src/pages/JobsPage.tsx'
patch(p,"import { FormEvent, useEffect, useState }","import { FormEvent, useEffect, useRef, useState }")
patch(p,"  const [error, setError] = useState('')","  const [error, setError] = useState('')\n  const pendingSave = useRef<{ fingerprint: string; id: string } | null>(null)\n  const saving = useRef(false)")
patch(p,'    event.preventDefault()\n    setBusy(true)',"    event.preventDefault()\n    if (saving.current) return\n    saving.current = true\n    const fingerprint = JSON.stringify(form)\n    if (!pendingSave.current || pendingSave.current.fingerprint !== fingerprint) pendingSave.current = { fingerprint, id: crypto.randomUUID() }\n    setBusy(true)")
patch(p,'      await createJob(business.id, {','      await createJob(business.id, {\n        request_id: pendingSave.current.id,')
patch(p,"      setForm({ customer_id: '', property_id: '', title: '', description: '', scheduled_start: '' })","      pendingSave.current = null\n      setForm({ customer_id: '', property_id: '', title: '', description: '', scheduled_start: '' })")
patch(p,'    } finally {\n      setBusy(false)','    } finally {\n      saving.current = false\n      setBusy(false)')
patch(p,'      <section className="list-card">','      {error && !showForm && <p className="form-message error-text" role="alert">{error}</p>}\n      <section className="list-card">')
p='vercel.json'; s=json.loads(Path(p).read_text()); s['headers']=[{'source':'/(.*)','headers':[{'key':'X-Content-Type-Options','value':'nosniff'},{'key':'Referrer-Policy','value':'no-referrer'},{'key':'X-Frame-Options','value':'DENY'},{'key':'Permissions-Policy','value':'camera=(), microphone=(self), geolocation=()'}]}]; Path(p).write_text(json.dumps(s,indent=2)+'\n')
