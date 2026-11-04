/** Create/resume inside the tap gesture (required by mobile Safari). Audio stays local. */
export function createVoicePauseDetector() {
  const Audio = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Audio) return null
  let context: AudioContext
  try { context = new Audio(); void context.resume().catch(() => {}) } catch { return null }
  let timer: ReturnType<typeof setInterval> | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    clearInterval(timer)
    try { source?.disconnect() } catch { /* Audio monitoring is optional. */ }
    try { if (context.state !== 'closed') void context.close().catch(() => {}) } catch { /* Device already closed. */ }
  }
  return {
    stop,
    start(stream: MediaStream, onPause: () => void, onEmpty: () => void, onUnavailable: () => void = () => {}) {
      try {
        if (stopped || context.state === 'closed') return false
        // Mobile audio contexts may suspend while the permission prompt is open.
        void context.resume().catch(() => { if (!stopped) { stop(); onUnavailable() } })
        source = context.createMediaStreamSource(stream)
        const analyser = context.createAnalyser()
        analyser.fftSize = 2048
        source.connect(analyser)
        const samples = new Float32Array(analyser.fftSize)
        const started = performance.now()
        let lastSound = started, soundFrames = 0
        timer = setInterval(() => {
          // A suspended audio context cannot measure silence reliably.
          if (context.state !== 'running') return
          try { analyser.getFloatTimeDomainData(samples) } catch { stop(); onUnavailable(); return }
          const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
          const now = performance.now()
          if (rms >= 0.008) { lastSound = now; soundFrames++ }
          if (soundFrames >= 3 && now - lastSound >= 2000) { stop(); onPause() }
          else if (soundFrames < 3 && now - started >= 15000) { stop(); onEmpty() }
        }, 100)
        return true
      } catch { stop(); return false }
    },
  }
}
