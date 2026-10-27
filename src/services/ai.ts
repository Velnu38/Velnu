import { supabase } from '../lib/supabase'


async function explainFunctionError(error: unknown, type: 'transcription' | 'command'): Promise<Error> {
  const context = (error as { context?: unknown } | null)?.context
  if (context instanceof Response) {
    const data = await context.clone().json().catch(() => null) as { error?: string } | null
    const serverMessage = data?.error || ''
    const serverCode = (data as { code?: string } | null)?.code
    if (serverCode === 'transcription_not_configured') return new Error(serverMessage)
    if (context.status === 503 && /OPENAI_API_KEY/i.test(serverMessage)) {
      return new Error(type === 'transcription'
        ? 'Cloud transcription is not configured yet. On iPhone Safari try browser dictation, or use the keyboard microphone in the text box and tap Review invoice.'
        : 'AI command interpretation is not configured yet. You can create a one-item invoice draft by dictating or typing: Create an invoice for Bob Smith for $150.')
    }
    if (serverMessage && context.status < 500) return new Error(serverMessage)
    return new Error(type === 'transcription'
      ? 'Could not transcribe the recording (server ' + context.status + '). Use the keyboard microphone in the text box.'
      : 'Could not interpret the command (server ' + context.status + '). Please try again.')
  }
  return error instanceof Error ? error : new Error('Unable to contact Finviant Office. Please try again.')
}

export type AiCommandSource = 'text' | 'voice'

export async function interpretCommand(businessId: string, transcript: string, source: AiCommandSource = 'text') {
  const clean = transcript.trim()
  if (!clean) throw new Error('Command is empty')

  const { data, error } = await supabase.functions.invoke('ai-command', {
    body: { business_id: businessId, transcript: clean, source },
  })

  if (error) throw await explainFunctionError(error, 'command')
  return data
}

export async function confirmAiAction(actionId: string) {
  const { error } = await supabase
    .from('ai_actions')
    .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
    .eq('id', actionId)
    .eq('status', 'proposed')

  if (error) throw error
}

export async function rejectAiAction(actionId: string) {
  const { error } = await supabase
    .from('ai_actions')
    .update({ status: 'rejected' })
    .eq('id', actionId)
    .eq('status', 'proposed')

  if (error) throw error
}

export async function executeAiAction(actionId: string) {
  const { data, error } = await supabase.functions.invoke('execute-ai-action', {
    body: { action_id: actionId },
  })

  if (error) throw await explainFunctionError(error, 'command')
  return data
}

export async function getTranscriptionStatus(businessId: string): Promise<{ configured: boolean; model: string | null }> {
  const { data, error } = await supabase.functions.invoke('transcribe-voice', {
    body: { action: 'status', business_id: businessId },
  })
  if (error) throw await explainFunctionError(error, 'transcription')
  return { configured: data?.configured === true, model: typeof data?.model === 'string' ? data.model : null }
}

export async function transcribeVoice(businessId: string, audio: Blob, durationSeconds?: number, prompt?: string) {
  const form = new FormData()
  const mime = (audio.type || '').toLowerCase()
  const extension = mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : mime.includes('mpeg') ? 'mp3' : mime.includes('flac') ? 'flac' : 'webm'
  form.append('audio', audio, 'finviant-command.' + extension)
  form.append('business_id', businessId)
  if (durationSeconds && Number.isFinite(durationSeconds)) form.append('duration_seconds', durationSeconds.toFixed(2))
  if (prompt) form.append('prompt', prompt)

  const { data, error } = await supabase.functions.invoke('transcribe-voice', {
    body: form,
  })

  if (error) throw await explainFunctionError(error, 'transcription')
  return data as { transcript: string; transcription_id: string }
}
