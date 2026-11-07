export type MicrophoneStage = 'access' | 'recorder' | 'dictation'
export type MicrophoneFailure = {
  code: string
  stage: MicrophoneStage
  kind: 'permission' | 'context' | 'device' | 'recorder' | 'unavailable'
  title: string
  message: string
  detail: string
}

export function checkMicrophoneContext() {
  if (!window.isSecureContext) throw new DOMException('Open Finviant using its secure HTTPS address.', 'SecurityError')
  const doc = document as Document & { permissionsPolicy?: { allowsFeature: (feature: string) => boolean }; featurePolicy?: { allowsFeature: (feature: string) => boolean } }
  const policy = doc.permissionsPolicy || doc.featurePolicy
  if (policy && !policy.allowsFeature('microphone')) throw new DOMException('This browser view does not permit microphone access. Open Finviant directly in your browser.', 'MicrophonePolicyError')
}

/** Let the browser choose its native encoder first. A supported-format claim
 * does not guarantee that construction/start succeeds on the current device. */
export function startCompatibleRecorder(stream: MediaStream, attach: (recorder: MediaRecorder) => void) {
  const formats: Array<string | undefined> = [undefined, 'audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']
  let failure: unknown = new DOMException('No compatible audio recorder is available.', 'NotSupportedError')
  for (const mimeType of formats) {
    let recorder: MediaRecorder | undefined
    try {
      if (mimeType && typeof MediaRecorder.isTypeSupported === 'function' && !MediaRecorder.isTypeSupported(mimeType)) continue
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      attach(recorder)
      recorder.start()
      return recorder
    } catch (error) {
      failure = error
      if (recorder) {
        recorder.onstop = null; recorder.ondataavailable = null; recorder.onerror = null
        if (recorder.state !== 'inactive') { try { recorder.stop() } catch { /* Failed encoder is discarded. */ } }
      }
    }
  }
  throw failure
}

export function describeMicrophoneFailure(error: unknown, stage: MicrophoneStage): MicrophoneFailure {
  const value = error as { name?: string; message?: string } | null
  const code = typeof value?.name === 'string' ? value.name : 'UnknownError'
  const detail = typeof value?.message === 'string' ? value.message.slice(0,300) : ''
  const base = { code, stage, detail }
  if (code === 'service-not-allowed') return { ...base, kind: 'unavailable', title: 'Browser dictation is unavailable', message: 'Your browser’s speech service is disabled. Retry audio recording, or type below and use your keyboard’s microphone.' }
  if (code === 'MicrophonePolicyError' || code === 'SecurityError' || code === 'InvalidStateError') return { ...base, kind: 'context', title: 'Open Finviant directly to use voice', message: 'This browser view cannot start the microphone. Open the secure app directly, then tap Ask Fin.' }
  if (stage !== 'recorder' && (code === 'NotAllowedError' || code === 'PermissionDeniedError' || code === 'not-allowed' || code === 'service-not-allowed')) return { ...base, kind: 'permission', title: 'Microphone access was blocked', message: 'Allow microphone access for Finviant in this browser. The app cannot change that permission for you.' }
  if (code === 'MicrophonePermissionTimeout') return { ...base, kind: 'permission', title: 'Microphone permission is still pending', message: 'Choose Allow in the browser permission prompt, then retry. You can type or use your keyboard’s microphone below.' }
  if (code === 'NotFoundError' || code === 'DevicesNotFoundError') return { ...base, kind: 'device', title: 'No microphone is available', message: 'Check that your phone or headset microphone is connected. You can still type your request below.' }
  if (stage === 'access' && (code === 'NotReadableError' || code === 'TrackStartError' || code === 'AbortError')) return { ...base, kind: 'device', title: 'Your phone could not open the microphone', message: 'Finish any call or recording in another app, then retry. If it continues, reopen this browser. Typing is available below.' }
  if (stage === 'recorder') return { ...base, kind: 'recorder', title: 'Audio recording is unavailable', message: 'Microphone access was granted, but the browser could not record usable audio. Try browser dictation or use your keyboard’s microphone below.' }
  return { ...base, kind: 'unavailable', title: 'Voice is unavailable in this browser', message: 'Try browser dictation if available, or tap Type instead and use your keyboard’s microphone.' }
}

export function microphonePermissionSteps(userAgent = navigator.userAgent) {
  if (/CriOS/.test(userAgent)) return ['In Chrome, use the microphone icon beside the address bar to allow microphone access for this site.', 'If Chrome has no microphone permission, open your iPhone Settings → Apps → Chrome and enable Microphone.', 'Return here and tap Retry microphone.']
  if (/iPhone|iPad|iPod/.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return ['In Safari, open the Page Menu beside the address bar, then Website Settings → Microphone → Allow.', 'If needed, check iPhone Settings → Apps → Safari → Microphone and select Ask.', 'Return here and tap Retry microphone.']
  if (/Android/.test(userAgent)) return ['In Chrome, open Settings → Site settings → Microphone. Select Finviant under Blocked and allow access.', 'Also allow Microphone for your browser in your phone’s app permissions.', 'Return here and tap Retry microphone.']
  return ['Open the site permissions beside this browser’s address bar and allow Microphone for Finviant.', 'Check that your device also allows microphone access for this browser.', 'Return here and tap Retry microphone.']
}
