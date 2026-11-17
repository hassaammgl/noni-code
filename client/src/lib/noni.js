// Local bridge to `noni serve`: text + tool events over SSE, confirm/ask over POST.
// Standalone Ollama mode stays as fallback when the server is not running.

const BASE = (import.meta.env?.VITE_NONI_URL || 'http://127.0.0.1:4317').replace(
  /\/$/,
  '',
)
const TOKEN = import.meta.env?.VITE_NONI_TOKEN || ''

function headers(extra = {}) {
  return {
    ...(TOKEN ? { 'x-noni-token': TOKEN } : {}),
    ...extra,
  }
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`noni ${path} failed (${res.status})`)
  return res.json().catch(() => ({}))
}

export async function noniHealth(timeoutMs = 1500) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE}/api/health`, {
      headers: headers(),
      signal: controller.signal,
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function noniListModels() {
  return fetch(`${BASE}/api/models`, { headers: headers() }).then((res) =>
    res.ok ? res.json() : { models: [] },
  )
}

export function noniSetModel(model) {
  return post('/api/model', { model })
}

export function noniSetThink(on) {
  return post('/api/think', { on })
}

export function noniSetPlan(on) {
  return post('/api/plan', { on })
}

export function noniClear() {
  return post('/api/clear', {})
}

export function noniHistoryList() {
  return fetch(`${BASE}/api/history`, { headers: headers() }).then((res) =>
    res.ok ? res.json() : Promise.reject(new Error(`history list failed (${res.status})`)),
  )
}

export function noniHistoryLoad(id) {
  return post(`/api/history/${id}/load`, {})
}

export function noniNewSession() {
  return post('/api/history', {})
}

export function noniConfirm(id, allow) {
  return post('/api/confirm', { id, allow: !!allow })
}

export function noniAnswer(id, answer) {
  return post('/api/answer', { id, answer: String(answer ?? '') })
}

function parseFrame(frame) {
  let event = 'message'
  const data = []
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (!data.length) return null
  try {
    return { event, data: JSON.parse(data.join('\n')) }
  } catch {
    return null
  }
}

/**
 * Ek chat turn chalao. `decide(event, data)` se confirm/ask/plan ka jawab do:
 * confirm/plan -> boolean, ask -> string.
 */
export async function streamFromNoni(
  message,
  { model, images = [], onToken, onEvent, decide } = {},
) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify({ message, model, images }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`noni chat failed (${res.status}) ${detail}`.trim())
  }
  if (!res.body) throw new Error('noni chat: no stream body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let failure = ''

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let cut
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      const parsed = parseFrame(frame)
      if (!parsed) continue
      const { event, data } = parsed
      onEvent?.(event, data)

      if (event === 'delta') {
        const piece = data.text || ''
        full += piece
        if (piece) onToken?.(piece)
      } else if (event === 'done') {
        if (data.text) full = data.text
      } else if (event === 'error') {
        failure = data.message || 'agent error'
      } else if (event === 'confirm') {
        const allow = decide ? await decide('confirm', data) : false
        await noniConfirm(data.id, allow).catch(() => {})
      } else if (event === 'plan') {
        const allow = decide ? await decide('plan', data) : false
        await noniConfirm(data.id, allow).catch(() => {})
      } else if (event === 'ask') {
        const answer = decide ? await decide('ask', data) : ''
        await noniAnswer(data.id, answer).catch(() => {})
      }
    }
  }

  if (failure) throw new Error(failure)
  if (!full) throw new Error('noni chat: empty reply')
  return full
}
