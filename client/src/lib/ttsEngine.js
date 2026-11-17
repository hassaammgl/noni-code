// Main-thread client for the Transformers.js TTS worker.

import TtsWorker from '../workers/tts.worker.js?worker'
import { createWorkerClient } from './workerClient.js'

let client = null

function getClient() {
  if (!client) client = createWorkerClient(TtsWorker)
  return client
}

export function prewarmTts(onProgress) {
  return getClient()
    .request('load', {}, { onProgress })
    .then(() => undefined)
}

export function synthesizeTts({ text, voice, steps, speed, onProgress }) {
  return getClient()
    .request('speak', { text, voice, steps, speed }, { onProgress })
    .then((msg) => ({ audio: msg.audio, samplingRate: msg.samplingRate }))
}

export function disposeTtsEngine() {
  client?.dispose()
  client = null
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', disposeTtsEngine)
}
