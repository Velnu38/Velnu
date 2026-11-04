/** Create/resume inside the tap gesture (required by mobile Safari). Audio stays local. */
export function createVoicePauseDetector() {
  const Audio = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Audio) return null
  let context: AudioContext
  try { context = new Audio(); void context.resume().catch(() => {}) } catch { return null }
  let timer: ReturnType<typeof setInterval> | undefined
  let source: MediaStreamAudioSourceNode | undefined
  const stop = () => {
    clearInterval(timer)
    source?.disconnect()
    if (context.state !== 'closed') void context.close().catch(() => {})
  }
  return {
    stop,
    start(stream: MediaStream, onPause: () => void, onEmpty: () => void) {
      try {
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
          analyser.getFloatTimeDomainData(samples)
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
