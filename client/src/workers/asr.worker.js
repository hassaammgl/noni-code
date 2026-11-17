// In-browser speech-to-text worker. Runs Whisper through Transformers.js.

import { pipeline, env } from '@huggingface/transformers'

env.allowLocalModels = false

const MODEL_ID = 'onnx-community/whisper-small'

let transcriber = null
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
  if (transcriber) return Promise.resolve(transcriber)
  if (!loading) {
    loading = pipeline('automatic-speech-recognition', MODEL_ID, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: makeProgress(),
    })
      .then((pipe) => {
        transcriber = pipe
        return pipe
      })
      .finally(() => {
        loading = null
      })
  }
  return loading
}

self.onmessage = async (event) => {
  const { id, type, audio } = event.data || {}
  try {
    if (type === 'load') {
      await load()
      self.postMessage({ type: 'loaded', id })
      return
    }

    if (type !== 'transcribe') return
    const asr = await load()
    const samples = audio instanceof Float32Array ? audio : new Float32Array(audio || [])
    const output = await asr(samples, {
      task: 'transcribe',
    })
    self.postMessage({ type: 'text', id, text: String(output?.text || '').trim() })
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err?.message || String(err) })
  }
}
