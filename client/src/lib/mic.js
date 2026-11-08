// Microphone capture + 16 kHz mono conversion for Whisper.
// Includes simple voice-activity detection: once speech starts, recording
// stops after `silenceMs` of quiet (or `maxMs` as a safety cap).

const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return ''
  return (
    MIME_TYPES.find((type) => {
      try {
        return MediaRecorder.isTypeSupported?.(type)
      } catch {
        return false
      }
    }) || ''
  )
}

function toMono16k(buffer, targetRate = 16000) {
  const channels = buffer.numberOfChannels || 1
  const length = buffer.length
  const mono = new Float32Array(length)
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < length; i++) mono[i] += data[i] / channels
  }
  if (buffer.sampleRate === targetRate) return mono

  const ratio = buffer.sampleRate / targetRate
  const outLength = Math.max(1, Math.floor(length / ratio))
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, length - 1)
    const frac = pos - i0
    out[i] = mono[i0] * (1 - frac) + mono[i1] * frac
  }
  return out
}

async function decodeToMono16k(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) throw new Error('Audio decoding unavailable')
  const ctx = new Ctx()
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer())
    return toMono16k(buffer)
  } finally {
    ctx.close().catch(() => {})
  }
}

export async function startRecording({
  silenceMs = 1300,
  minVoicedMs = 300,
  maxMs = 30000,
  onSilence,
  onLevel,
} = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone unavailable')
  }
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Audio recording not supported')
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  })

  const mimeType = pickMime()
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks = []
  recorder.ondataavailable = (e) => {
    if (e.data?.size) chunks.push(e.data)
  }

  // Voice-activity detection.
  const Ctx = window.AudioContext || window.webkitAudioContext
  let ctx = null
  let source = null
  let analyser = null
  let monitor = null
  let data = null
  let noiseSum = 0
  let noiseCount = 0
  const calibrationEnd = performance.now() + 500
  let startedAt = 0
  let voicedMs = 0
  let firstSpeechAt = 0
  let lastSpeechAt = 0
  let silenceFired = false

  if (Ctx) {
    try {
      ctx = new Ctx()
      if (ctx.state === 'suspended') await ctx.resume()
      source = ctx.createMediaStreamSource(stream)
      analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      data = new Uint8Array(analyser.fftSize)

      monitor = setInterval(() => {
        if (silenceFired) return
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / data.length)
        const now = performance.now()

        if (now < calibrationEnd) {
          noiseSum += rms
          noiseCount++
          onLevel?.(rms, 0, false)
          return
        }

        const noise = noiseCount ? noiseSum / noiseCount : 0.005
        const threshold = Math.min(0.03, Math.max(0.012, noise * 2.2))
        const voiced = rms > threshold

        if (voiced) {
          voicedMs += 100
          if (!firstSpeechAt) firstSpeechAt = now
          lastSpeechAt = now
        }
        onLevel?.(rms, threshold, voiced)

        const talkedEnough = voicedMs >= minVoicedMs
        if (talkedEnough && now - lastSpeechAt >= silenceMs) {
          silenceFired = true
          onSilence?.()
          return
        }
        if (now - startedAt >= maxMs) {
          silenceFired = true
          onSilence?.()
        }
      }, 100)
    } catch (err) {
      console.warn('[mic] voice activity detection unavailable:', err)
    }
  }

  let stopPromise = null
  let cancelled = false

  recorder.start()
  startedAt = performance.now()

  function cleanup() {
    if (monitor) clearInterval(monitor)
    monitor = null
    try {
      source?.disconnect()
    } catch {
      /* ignore */
    }
    try {
      analyser?.disconnect()
    } catch {
      /* ignore */
    }
    if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {})
    ctx = null
    for (const track of stream.getTracks()) track.stop()
  }

  function stop() {
    if (stopPromise) return stopPromise
    stopPromise = new Promise((resolve, reject) => {
      const finish = async () => {
        cleanup()
        if (cancelled) {
          resolve({ audio: null, voicedMs: 0 })
          return
        }
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
          if (blob.size < 128) {
            resolve({ audio: null, voicedMs })
            return
          }
          const decoded = await decodeToMono16k(blob)
          let audio = decoded
          // Trim leading/trailing silence around the detected speech region.
          if (firstSpeechAt && lastSpeechAt) {
            const from = Math.max(
              0,
              Math.floor(((firstSpeechAt - startedAt - 250) / 1000) * 16000),
            )
            const to = Math.min(
              decoded.length,
              Math.ceil(((lastSpeechAt - startedAt + 500) / 1000) * 16000),
            )
            if (to - from > 1600) audio = decoded.slice(from, to)
          }
          let peak = 0
          let energy = 0
          for (let i = 0; i < audio.length; i++) {
            const v = audio[i]
            const abs = Math.abs(v)
            if (abs > peak) peak = abs
            energy += v * v
          }
          resolve({
            audio,
            voicedMs,
            peak,
            rms: Math.sqrt(energy / Math.max(1, audio.length)),
            durationMs: (audio.length / 16000) * 1000,
          })
        } catch (err) {
          reject(err)
        }
      }

      recorder.onstop = finish
      recorder.onerror = (event) => {
        cleanup()
        reject(event.error || new Error('Recording failed'))
      }

      try {
        if (recorder.state !== 'inactive') recorder.stop()
        else finish()
      } catch (err) {
        cleanup()
        reject(err)
      }
    })
    return stopPromise
  }

  function cancel() {
    cancelled = true
    cleanup()
    try {
      if (recorder.state !== 'inactive') recorder.stop()
    } catch {
      /* already stopped */
    }
  }

  return { stop, cancel }
}
