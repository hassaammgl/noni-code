// In-browser TTS worker. Downloads and runs Supertonic through Transformers.js.

import { pipeline, env } from '@huggingface/transformers'

env.allowLocalModels = false

const MODEL_ID = 'onnx-community/Supertonic-TTS-ONNX'
const VOICE_BASE = `https://huggingface.co/${MODEL_ID}/resolve/main/voices`

let synthesizer = null
let loading = null

function makeProgress() {
  const files = new Map()
  return (p) => {
    if (p?.status !== 'progress' || !p.file || !p.total) return
    files.set(p.file, { loaded: p.loaded || 0, total: p.total })
    let loaded = 0
    let total = 0
    for (const item of files.values()) {
      loaded += item.loaded
      total += item.total
    }
    self.postMessage({
      type: 'progress',
      progress: total ? loaded / total : 0,
      loaded,
      total,
    })
  }
}

function load() {
  if (synthesizer) return Promise.resolve(synthesizer)
  if (!loading) {
    loading = pipeline('text-to-speech', MODEL_ID, {
      dtype: 'fp32',
      device: 'wasm',
      progress_callback: makeProgress(),
    })
      .then((pipe) => {
        synthesizer = pipe
        return pipe
      })
      .finally(() => {
        loading = null
      })
  }
  return loading
}

function voiceUrl(voice) {
  const id = /^[FM][1-5]$/.test(String(voice || '')) ? voice : 'F1'
  return `${VOICE_BASE}/${id}.bin`
}

self.onmessage = async (event) => {
  const { id, type, text, voice, steps, speed } = event.data || {}
  try {
    if (type === 'load') {
      await load()
      self.postMessage({ type: 'loaded', id })
      return
    }

    if (type !== 'speak') return
    const tts = await load()
    const audio = await tts(String(text || ''), {
      speaker_embeddings: voiceUrl(voice),
      num_inference_steps: Number(steps) || 5,
      speed: Number(speed) || 1,
    })
    const samples =
      audio?.audio instanceof Float32Array ? audio.audio : new Float32Array(audio?.audio || [])
    self.postMessage(
      {
        type: 'audio',
        id,
        audio: samples,
        samplingRate: audio?.sampling_rate || 44100,
      },
      [samples.buffer],
    )
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err?.message || String(err) })
  }
}
