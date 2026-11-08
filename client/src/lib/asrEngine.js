// Main-thread client for the Transformers.js speech-to-text worker.

import AsrWorker from '../workers/asr.worker.js?worker'
import { createWorkerClient } from './workerClient.js'

let client = null

function getClient() {
  if (!client) client = createWorkerClient(AsrWorker)
  return client
}

export function prewarmAsr(onProgress) {
  return getClient()
    .request('load', {}, { onProgress })
    .then(() => undefined)
}

export function transcribeSpeech(audio, onProgress) {
  return getClient()
    .request('transcribe', { audio }, { transfer: [audio.buffer], onProgress })
    .then((msg) => ({ text: msg.text || '' }))
}

export function disposeAsrEngine() {
  client?.dispose()
  client = null
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', disposeAsrEngine)
}
