// Conversational backend backed by the official Ollama JS package, with a
// local fallback so the character still answers when the server is down.

import { Ollama } from 'ollama/browser'

const MODEL_ID = /^[a-zA-Z0-9._:/-]+$/
const MODEL_STORAGE_KEY = 'waifu-ollama-model'

export const OLLAMA_MODEL = 'llama3.1:8b'

export function sanitizeModel(value, fallback = OLLAMA_MODEL) {
  const v = String(value || '').trim()
  if (!v || v.length > 128 || v.includes('..') || v.startsWith('/')) return fallback
  if (!MODEL_ID.test(v)) return fallback
  return v
}

export function loadSavedModel() {
  try {
    return sanitizeModel(localStorage.getItem(MODEL_STORAGE_KEY), '')
  } catch {
    return ''
  }
}

export function saveModel(name) {
  const id = sanitizeModel(name, '')
  if (!id) return
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, id)
  } catch {
    /* ignore */
  }
}

function configuredHosts() {
  const env = import.meta.env?.VITE_OLLAMA_URL
  if (env) return [String(env).replace(/\/$/, '')]
  return ['http://127.0.0.1:11434', 'http://localhost:11434']
}

let cachedHost = ''

function orderedHosts() {
  const hosts = configuredHosts()
  if (!cachedHost) return hosts
  return [cachedHost, ...hosts.filter((h) => h !== cachedHost)]
}

async function withClient(fn) {
  let lastErr
  for (const host of orderedHosts()) {
    try {
      const result = await fn(new Ollama({ host }))
      cachedHost = host
      return result
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr || new Error('Ollama unavailable')
}

function modelNames(models) {
  return [...new Set((models || []).map((m) => m?.name || m?.model).filter(Boolean))]
}

export async function listOllamaModels() {
  try {
    const { models } = await withClient((ollama) => ollama.list())
    return { ok: true, models: modelNames(models) }
  } catch (err) {
    console.warn('Ollama list failed:', err)
    return { ok: false, models: [] }
  }
}

const PERSONA =
  'You are Noni: a female coding companion with dry, deadpan humor. Answer what the user actually said, be specific, ' +
  'and match their language (casual Hinglish in Roman script is preferred). Usually 1-3 short spoken sentences. ' +
  'Never write markdown, lists, or emoji. ' +
  'If the user asks for code changes, explain that the full agent (tools, files) is only available when `noni serve` is running.'

export function localReply(input) {
  const raw = String(input || '').trim()
  const snippet = raw.length > 48 ? `${raw.slice(0, 48)}…` : raw
  if (!snippet) {
    return 'I am here, but Ollama is not running, so I cannot think of a real reply yet.'
  }
  return `I heard "${snippet}", but Ollama is offline so I cannot actually think. Start it and ask me again.`
}

function pushTokens(text, onToken) {
  const parts = text.match(/\S+\s*/g) || [text]
  for (const piece of parts) onToken?.(piece)
}

function chatMessages(input, history) {
  const prior = history
    .filter((m) => m.content && m.role !== 'tool')
    .slice(-8)
    .map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }))
  return [
    { role: 'system', content: PERSONA },
    ...prior,
    { role: 'user', content: input },
  ]
}

function pickModel(model) {
  return sanitizeModel(model)
}

// history is prior turns only — do not include `input` again.
export async function streamReply(input, history, { onToken, model } = {}) {
  try {
    const text = await streamOllama(input, history, onToken, model)
    return { text, source: 'ollama' }
  } catch (err) {
    console.warn('Ollama unavailable, using local reply:', err)
    const text = localReply(input)
    pushTokens(text, onToken)
    return { text, source: 'local' }
  }
}

async function streamOllama(input, history, onToken, model) {
  const modelName = pickModel(model)
  const messages = chatMessages(input, history)
  let lastErr

  for (const host of orderedHosts()) {
    let full = ''
    try {
      const stream = await new Ollama({ host }).chat({
        model: modelName,
        messages,
        stream: true,
        think: false,
        options: { temperature: 0.95, top_p: 0.9 },
      })

      for await (const part of stream) {
        const piece = part.message?.content || ''
        if (piece) {
          full += piece
          onToken?.(piece)
        }
      }

      const text = full.trim()
      if (!text) throw new Error('Ollama returned an empty reply')
      cachedHost = host
      return text
    } catch (err) {
      lastErr = err
      // Tokens already reached the UI — restarting on another host would duplicate them.
      if (full) throw err
    }
  }

  throw lastErr || new Error('Ollama unavailable')
}
