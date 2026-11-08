import { useEffect, useRef, useState } from 'react'
import { listOllamaModels, loadSavedModel, saveModel, streamReply } from './lib/chat.js'
import {
  noniHealth,
  noniClear,
  noniHistoryList,
  noniHistoryLoad,
  noniNewSession,
  noniSetPlan,
  streamFromNoni,
} from './lib/noni.js'
import { createGenerationGate } from './lib/generationGate.js'
import {
  CHARACTER_VOICES,
  loadSavedVoice,
  saveVoice,
} from './lib/voices.js'
import { prewarmAsr, transcribeSpeech } from './lib/asrEngine.js'
import { startRecording } from './lib/mic.js'
import { Waifu } from './lib/waifu.js'

const HALLUCINATIONS = new Set([
  'you',
  'okay',
  'bye',
  'thank you',
  'thanks',
  'thanks for watching',
  'thank you for watching',
])

function cleanTranscript(text, { voicedMs = 0, durationMs = 0 } = {}) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  if (/^(you[\s,.!?]*)+$/i.test(t)) return ''
  const key = t.toLowerCase().replace(/[.!?,]+$/g, '').trim()
  if (HALLUCINATIONS.has(key) && (voicedMs < 800 || durationMs < 1200)) return ''
  return t
}

/* ---------------------------------------------------------------- icons */

function Svg({ children, className = 'h-4 w-4', ...rest }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

const SparklesIcon = (p) => (
  <Svg {...p}>
    <path d="M12 3.5 13.8 8l4.5 1.8-4.5 1.8L12 16l-1.8-4.4L5.7 9.8 10.2 8 12 3.5Z" />
    <path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" />
  </Svg>
)

const ChevronDownIcon = (p) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
)

const MicIcon = (p) => (
  <Svg {...p}>
    <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3" />
  </Svg>
)

const SendIcon = (p) => (
  <Svg {...p}>
    <path d="m21.5 2.5-7 19-4.2-8.3L2 9l19.5-6.5Z" />
    <path d="M21.5 2.5 10.3 13.2" />
  </Svg>
)

const StopIcon = (p) => (
  <Svg {...p}>
    <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
  </Svg>
)

const CpuIcon = (p) => (
  <Svg {...p}>
    <rect x="7" y="7" width="10" height="10" rx="2" />
    <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
  </Svg>
)

const VolumeIcon = (p) => (
  <Svg {...p}>
    <path d="M4 9v6h4l5 4V5L8 9H4Z" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7" />
  </Svg>
)

const XIcon = (p) => (
  <Svg {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
)

const RefreshIcon = (p) => (
  <Svg {...p}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 4v7h-7" />
  </Svg>
)

const AlertIcon = (p) => (
  <Svg {...p}>
    <path d="M12 3 22 20H2L12 3Z" />
    <path d="M12 9v5M12 17.5v.5" />
  </Svg>
)

/* ------------------------------------------------------------- animation */

function sameList(a, b) {
  return a.length === b.length && a.every((item, i) => item === b[i])
}

function ModelPicker({ models, value, onChange, onOpen }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    function onPointer(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [])

  const label = models.includes(value) ? value : models[0] || 'No model'

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => {
          if (!open) onOpen?.()
          setOpen((v) => !v)
        }}
        aria-label="Ollama model"
        aria-expanded={open}
        title={label}
        className="flex max-w-[8rem] items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-medium text-white/65 transition hover:bg-white/[0.08] hover:text-white sm:max-w-[10rem]"
      >
        <CpuIcon className="h-3 w-3 shrink-0 text-violet-300/80" />
        <span className="truncate">{label}</span>
        <ChevronDownIcon
          className={`h-3 w-3 shrink-0 text-white/35 transition ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-64 overflow-hidden rounded-2xl border border-white/10 bg-[#0c0c16]/95 p-1.5 shadow-2xl backdrop-blur-2xl">
          <p className="px-2.5 pb-1 pt-1.5 text-[9px] font-medium uppercase tracking-[0.2em] text-white/30">
            Ollama model
          </p>
          {!models.length && (
            <p className="px-2.5 py-2 text-[11px] text-white/45">
              Start Ollama, then retry.
            </p>
          )}
          <div className="chat-scroll max-h-52 overflow-y-auto">
            {models.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  onChange(name)
                  setOpen(false)
                }}
                className={`block w-full truncate rounded-xl px-2.5 py-2 text-left text-[11px] transition ${
                  name === value
                    ? 'bg-violet-500/25 text-white'
                    : 'text-white/60 hover:bg-white/[0.06] hover:text-white'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function VoicePicker({ value, onChange }) {
  return (
    <div className="relative flex shrink-0 items-center rounded-full border border-white/10 bg-white/[0.04] py-1.5 pl-2.5 pr-6 text-[10px] font-medium text-white/65 transition hover:bg-white/[0.08]">
      <VolumeIcon className="h-3 w-3 text-fuchsia-300/80" />
      <select
        value={value}
        onChange={onChange}
        aria-label="Character voice"
        className="ml-1.5 cursor-pointer appearance-none bg-transparent pr-1 outline-none"
      >
        {CHARACTER_VOICES.map((v) => (
          <option key={v.id} value={v.id} className="bg-[#0c0c16] text-white">
            {v.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-2 h-3 w-3 text-white/35" />
    </div>
  )
}

function upsertBot(prev, content, streaming) {
  const next = [...prev]
  const last = next[next.length - 1]
  const msg = { role: 'bot', content, streaming }
  if (last?.role === 'bot') next[next.length - 1] = msg
  else next.push(msg)
  return next
}

function shortText(value, max = 600) {
  const text = String(value ?? '')
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function formatArgs(args) {
  try {
    const text = JSON.stringify(args ?? {})
    return text.length > 220 ? `${text.slice(0, 220)}…` : text
  } catch {
    return ''
  }
}

/** Chat ke andar ek tool call ka compact row. */
function ToolRow({ step }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px]">
      <div className="flex items-center gap-2">
        <CpuIcon className="h-3.5 w-3.5 shrink-0 text-violet-300" />
        <span className="font-medium text-white/75">{step.name}</span>
        {step.running ? (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-300" />
        ) : step.isError ? (
          <span className="text-rose-300/90">failed</span>
        ) : (
          <span className="text-emerald-300/80">done</span>
        )}
        <span className="ml-auto text-[9px] uppercase tracking-[0.16em] text-white/25">
          tool
        </span>
      </div>
      {step.args && Object.keys(step.args).length > 0 && (
        <pre className="mt-1 overflow-hidden whitespace-pre-wrap break-all text-white/35">
          {formatArgs(step.args)}
        </pre>
      )}
      {step.result && (
        <pre
          className={`mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words ${
            step.isError ? 'text-rose-300/80' : 'text-white/55'
          }`}
        >
          {shortText(step.result)}
        </pre>
      )}
    </div>
  )
}

function statusFor({
  llmBusy,
  voiceState,
  voiceDetail,
  micState,
  listening,
}) {
  if (llmBusy)
    return {
      label: 'Thinking',
      cls: 'border-violet-400/25 bg-violet-500/15 text-violet-200',
      dot: 'bg-violet-300 animate-pulse',
    }
  if (voiceState === 'loading')
    return {
      label: `Loading voice${voiceDetail ? ` ${voiceDetail}` : '…'}`,
      cls: 'border-amber-400/25 bg-amber-500/15 text-amber-200',
      dot: 'bg-amber-300 animate-pulse',
    }
  if (voiceState === 'speaking')
    return {
      label: 'Speaking',
      cls: 'border-fuchsia-400/25 bg-fuchsia-500/15 text-fuchsia-200',
      dot: 'bg-fuchsia-300 animate-pulse',
    }
  if (micState === 'recording')
    return {
      label: 'Listening',
      cls: 'border-rose-400/25 bg-rose-500/15 text-rose-200',
      dot: 'bg-rose-300 animate-pulse',
    }
  if (micState === 'starting')
    return {
      label: 'Starting mic',
      cls: 'border-amber-400/25 bg-amber-500/15 text-amber-200',
      dot: 'bg-amber-300 animate-pulse',
    }
  if (micState === 'transcribing')
    return {
      label: 'Transcribing',
      cls: 'border-violet-400/25 bg-violet-500/15 text-violet-200',
      dot: 'bg-violet-300 animate-pulse',
    }
  if (voiceState === 'interrupted')
    return {
      label: 'Stopped',
      cls: 'border-white/10 bg-white/[0.05] text-white/50',
      dot: 'bg-white/40',
    }
  if (voiceState === 'error')
    return {
      label: 'Voice unavailable',
      cls: 'border-rose-400/25 bg-rose-500/15 text-rose-200',
      dot: 'bg-rose-300',
    }
  if (listening)
    return {
      label: 'Listening mode',
      cls: 'border-emerald-400/25 bg-emerald-500/15 text-emerald-200',
      dot: 'bg-emerald-300 animate-pulse',
    }
  return {
    label: 'Ready',
    cls: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200/90',
    dot: 'bg-emerald-300',
  }
}

export default function App() {
  const logRef = useRef(null)
  const busyRef = useRef(false)
  const canvasRef = useRef(null)
  const waifuRef = useRef(null)
  const turnRef = useRef(createGenerationGate())
  const micRef = useRef(null)
  const micTimerRef = useRef(null)
  const micStateRef = useRef('idle')
  const listeningRef = useRef(false)

  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [ttsPlaying, setTtsPlaying] = useState(false)
  const [voiceState, setVoiceState] = useState('idle')
  const [voiceDetail, setVoiceDetail] = useState('')
  const [voice, setVoice] = useState(loadSavedVoice)
  const [micState, setMicState] = useState('idle')
  const [listening, setListening] = useState(false)
  const [micError, setMicError] = useState('')
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [ollamaUp, setOllamaUp] = useState(false)
  const [ollamaModels, setOllamaModels] = useState([])
  const [ollamaModel, setOllamaModel] = useState(loadSavedModel)
  const [noniUp, setNoniUp] = useState(false)
  const [noniMeta, setNoniMeta] = useState(null)
  const [planMode, setPlanMode] = useState(false)
  const [confirmReq, setConfirmReq] = useState(null)
  const [askReq, setAskReq] = useState(null)
  const [askValue, setAskValue] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historySessions, setHistorySessions] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const confirmResolveRef = useRef(null)
  const askResolveRef = useRef(null)

  useEffect(() => {
    let alive = true
    async function check() {
      const info = await noniHealth()
      if (alive) {
        setNoniMeta(info ?? null)
        setNoniUp(!!info?.ok)
        if (info) setPlanMode(!!info.planMode)
      }
    }
    check()
    const id = setInterval(check, 15000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  /** noni ke confirm/ask events ko modal se jodo. */
  function decide(event, data) {
    if (event === 'confirm') {
      return new Promise((resolve) => {
        confirmResolveRef.current = resolve
        setConfirmReq(data)
      })
    }
    if (event === 'plan') {
      return new Promise((resolve) => {
        confirmResolveRef.current = resolve
        setConfirmReq({ ...data, plan: true })
      })
    }
    if (event === 'ask') {
      return new Promise((resolve) => {
        askResolveRef.current = resolve
        setAskReq(data)
        setAskValue('')
      })
    }
    return false
  }

  function answerConfirm(allow) {
    if (confirmReq?.plan && allow) setPlanMode(false)
    confirmResolveRef.current?.(allow)
    confirmResolveRef.current = null
    setConfirmReq(null)
  }

  function answerAsk(value) {
    const answer = String(value ?? '').trim()
    askResolveRef.current?.(answer)
    askResolveRef.current = null
    setAskReq(null)
    setAskValue('')
  }

  async function openHistory() {
    setHistoryOpen(true)
    if (!noniUp) return
    setHistoryLoading(true)
    try {
      const data = await noniHistoryList()
      setHistorySessions(data.sessions ?? [])
    } catch (err) {
      console.warn('history list failed:', err)
    } finally {
      setHistoryLoading(false)
    }
  }

  async function chooseSession(id) {
    try {
      const data = await noniHistoryLoad(id)
      setMessages(
        (data.messages ?? []).map((m) => ({
          role: m.role === 'assistant' ? 'bot' : m.role,
          content: m.content,
          streaming: false,
        })),
      )
      setHistoryOpen(false)
    } catch (err) {
      console.warn('history load failed:', err)
    }
  }

  async function newChat() {
    if (noniUp) {
      try {
        await noniNewSession()
      } catch (err) {
        console.warn('new session failed:', err)
      }
    }
    setMessages([])
    setHistoryOpen(false)
  }

  async function togglePlan() {
    if (!noniUp) return
    const next = !planMode
    setPlanMode(next)
    try {
      const res = await noniSetPlan(next)
      setPlanMode(!!res.planMode)
    } catch (err) {
      console.warn('plan toggle failed:', err)
      setPlanMode(!next)
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    const waifu = new Waifu({
      canvas,
      onReady: () => {
        if (cancelled) return
        waifuRef.current = waifu
        setReady(true)
      },
      onError: (err) => {
        if (cancelled) return
        console.error(err)
        setLoadError(err?.message || String(err))
      },
    })
    waifuRef.current = waifu

    return () => {
      cancelled = true
      waifu.dispose()
      if (waifuRef.current === waifu) waifuRef.current = null
    }
  }, [])

  function markBusy(next) {
    busyRef.current = next
    setBusy(next)
  }

  function applyOllamaList(ok, models) {
    setOllamaUp(ok && models.length > 0)
    setOllamaModels((prev) => (sameList(prev, models) ? prev : models))
    setOllamaModel((current) =>
      models.includes(current) ? current : models[0] || current,
    )
  }

  async function refreshOllamaModels() {
    const { ok, models } = await listOllamaModels()
    applyOllamaList(ok, models)
  }

  useEffect(() => {
    if (ollamaModel) saveModel(ollamaModel)
  }, [ollamaModel])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (document.hidden) return
      const { ok, models } = await listOllamaModels()
      if (!cancelled) applyOllamaList(ok, models)
    }
    load()
    const id = setInterval(load, 4000)
    const onVisible = () => {
      if (!document.hidden) load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => {
    return () => {
      listeningRef.current = false
      clearTimeout(micTimerRef.current)
      micRef.current?.cancel()
      micRef.current = null
    }
  }, [])

  async function submit(text) {
    const trimmed = text.trim()
    if (!trimmed || !waifuRef.current) return
    if (busyRef.current === 'llm') return
    if (busyRef.current === 'tts') waifuRef.current.stopSpeaking()

    if (micRef.current) {
      clearTimeout(micTimerRef.current)
      micRef.current.cancel()
      micRef.current = null
      setMic('idle')
    }

    if (trimmed === '/clear') {
      setInput('')
      setMessages([])
      if (noniUp) noniClear().catch(() => {})
      return
    }

    const turn = turnRef.current.next()
    markBusy('llm')
    // Download the voice model while Ollama is generating.
    waifuRef.current.tts?.prewarm()
    setInput('')
    setSpeaking(true)
    setTtsPlaying(false)
    setVoiceState('thinking')
    setVoiceDetail('')

    const userMsg = { role: 'user', content: trimmed }
    setMessages((prev) => [...prev, userMsg])

    let reply = ''
    const onToken = (piece) => {
      reply += piece
      setMessages((prev) => upsertBot(prev, reply, true))
    }
    const onEvent = (event, data) => {
      if (event === 'assistant_start') {
        reply = ''
      } else if (event === 'tool_call') {
        setMessages((prev) => [
          ...prev.map((m) =>
            m.role === 'bot' && m.streaming ? { ...m, streaming: false } : m,
          ),
          {
            role: 'tool',
            id: `${Date.now()}-${Math.random()}`,
            name: data.name,
            args: data.args,
            result: '',
            isError: false,
            running: true,
          },
        ])
      } else if (event === 'tool_result') {
        setMessages((prev) => {
          const next = [...prev]
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === 'tool' && next[i].running) {
              next[i] = {
                ...next[i],
                result: String(data.result ?? ''),
                isError: !!data.isError,
                running: false,
              }
              break
            }
          }
          return next
        })
      } else if (event === 'done' && data.text) {
        reply = data.text
      } else if (event === 'warn') {
        console.warn('[noni]', data.message)
      }
    }

    try {
      if (noniUp) {
        try {
          reply = await streamFromNoni(trimmed, {
            model: ollamaModel,
            onToken,
            onEvent,
            decide,
          })
          setOllamaUp(true)
        } catch (err) {
          // Server gir gaya to purane direct-Ollama mode pe fallback
          console.warn('noni server unavailable, falling back to Ollama:', err)
          setNoniUp(false)
          if (reply) throw err
          const result = await streamReply(trimmed, messages, { model: ollamaModel, onToken })
          reply = result.text
          if (result.source === 'local') setOllamaUp(false)
          else setOllamaUp(true)
        }
      } else {
        const result = await streamReply(trimmed, messages, { model: ollamaModel, onToken })
        reply = result.text
        if (result.source === 'local') setOllamaUp(false)
        else if (result.source === 'ollama') setOllamaUp(true)
      }
    } catch (err) {
      console.error(err)
      reply = "Hmm, I couldn't reach my brain (Ollama). Make sure it's running!"
      setOllamaUp(false)
    }

    if (!turnRef.current.isCurrent(turn)) return
    if (reply) setMessages((prev) => upsertBot(prev, reply, false))

    try {
      // Speak only the finished assistant reply, never streamed/tool fragments.
      if (reply && waifuRef.current) {
        markBusy('tts')
        setTtsPlaying(true)
        setVoiceState('speaking')
        await waifuRef.current.speak(reply, {
          prompt: trimmed,
          voice,
          onStatus: (status, detail) => {
            if (status === 'loading') {
              setVoiceState('loading')
              setVoiceDetail(
                typeof detail === 'number' ? `${Math.round(detail * 100)}%` : '',
              )
            } else if (status === 'speaking' || status === 'fallback') {
              setVoiceState('speaking')
              setVoiceDetail('')
            }
          },
        })
      }
    } catch (err) {
      console.warn('TTS skipped:', err)
    } finally {
      if (!turnRef.current.isCurrent(turn)) return
      const ttsError = waifuRef.current?.tts?.lastError
      markBusy(false)
      setTtsPlaying(false)
      setSpeaking(false)
      setVoiceDetail('')
      setVoiceState(ttsError ? 'error' : 'idle')
      scheduleListening(450)
    }
  }

  function stopTalk() {
    turnRef.current.bump()
    waifuRef.current?.stopSpeaking()
    setTtsPlaying(false)
    setSpeaking(false)
    setVoiceDetail('')
    setVoiceState('interrupted')
    markBusy(false)
    scheduleListening(450)
  }

  function setMic(next) {
    micStateRef.current = next
    setMicState(next)
  }

  function scheduleListening(delay = 450) {
    clearTimeout(micTimerRef.current)
    micTimerRef.current = null
    if (!listeningRef.current) return
    micTimerRef.current = setTimeout(() => {
      if (listeningRef.current) startListening()
    }, delay)
  }

  async function startListening() {
    if (!listeningRef.current) return
    if (micRef.current || micStateRef.current !== 'idle') return
    if (busyRef.current) return

    setMicError('')
    setMic('starting')
    try {
      const recorder = await startRecording({
        silenceMs: 1300,
        minVoicedMs: 300,
        maxMs: 30000,
        onSilence: () => finishRecording(),
      })
      if (!listeningRef.current) {
        recorder.cancel()
        setMic('idle')
        return
      }
      micRef.current = recorder
      setMic('recording')
      prewarmAsr().catch(() => {})
    } catch (err) {
      console.warn('Microphone failed:', err)
      setMicError(err?.message || 'Microphone unavailable')
      listeningRef.current = false
      setListening(false)
      setMic('idle')
    }
  }

  async function finishRecording() {
    const recorder = micRef.current
    if (!recorder) return
    micRef.current = null
    clearTimeout(micTimerRef.current)
    setMic('transcribing')
    let submitted = false
    try {
      const result = await recorder.stop()
      const { audio, voicedMs = 0, peak = 0, rms = 0, durationMs = 0 } = result || {}
      console.log(
        `[mic] captured ${Math.round(durationMs)}ms · voiced ${voicedMs}ms · peak ${peak.toFixed(3)} · rms ${rms.toFixed(4)}`,
      )
      if (!audio?.length) return
      const hasSpeech = voicedMs >= 250 || peak >= 0.05
      if (!hasSpeech || durationMs < 300 || peak < 0.02) {
        console.log('[mic] skipped quiet clip')
        return
      }
      const { text } = await transcribeSpeech(audio)
      const trimmed = cleanTranscript(text, { voicedMs, durationMs })
      console.log('[mic] transcript:', JSON.stringify(text))
      if (trimmed) {
        submitted = true
        setMicError('')
        setMic('idle')
        submit(trimmed)
      }
    } catch (err) {
      console.warn('Speech transcription failed:', err)
      setMicError(err?.message || 'Speech transcription failed')
    } finally {
      setMic('idle')
      if (!submitted) scheduleListening(700)
    }
  }

  function toggleListening() {
    if (listeningRef.current) {
      listeningRef.current = false
      setListening(false)
      clearTimeout(micTimerRef.current)
      micTimerRef.current = null
      if (micRef.current) {
        micRef.current.cancel()
        micRef.current = null
      }
      setMic('idle')
      setMicError('')
      return
    }

    listeningRef.current = true
    setListening(true)
    setMicError('')
    startListening()
  }

  function onKey(e) {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    submit(input)
  }

  const waitingForReply = speaking && messages.at(-1)?.role === 'user'
  const llmBusy = busy === 'llm'
  const status = statusFor({ llmBusy, voiceState, voiceDetail, micState, listening })
  const placeholder =
    micState === 'recording'
      ? 'Listening… pause to send'
      : listening
        ? 'Listening mode is on — speak anytime'
        : llmBusy
          ? 'Thinking…'
          : ttsPlaying
            ? 'Type to interrupt…'
            : noniUp
              ? 'Ask Noni about this repo…'
              : 'Talk to your waifu…'

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#06060b] text-white lg:flex-row">
      {/* ------------------------------------------------ character stage */}
      <main className="relative h-[38vh] w-full shrink-0 overflow-hidden lg:h-full lg:min-w-0 lg:flex-1 lg:shrink">
        <canvas ref={canvasRef} className="absolute inset-0 z-0 h-full w-full" />

        <div className="pointer-events-none absolute inset-0 z-10">
          <div className="absolute -left-32 -top-24 h-80 w-80 rounded-full bg-violet-600/25 blur-[110px]" />
          <div className="absolute -right-24 top-1/3 h-96 w-96 rounded-full bg-fuchsia-500/15 blur-[120px]" />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#06060b] via-[#06060b]/60 to-transparent" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(6,6,11,0.65)_100%)]" />
        </div>

        {!ready && !loadError && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#06060b]">
            <div className="h-10 w-10 animate-spin rounded-full border border-transparent border-r-fuchsia-400 border-t-violet-400" />
            <p className="text-xs text-white/40">Summoning Noni…</p>
          </div>
        )}

        {loadError && (
          <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
            <p className="max-w-sm rounded-2xl border border-rose-400/15 bg-rose-500/[0.06] p-3 text-center text-[11px] leading-relaxed text-rose-200/80">
              Model load failed: {loadError}
            </p>
          </div>
        )}
      </main>

      {/* ------------------------------------------------------- chat */}
      <aside
        id="chat-sidebar"
        className="relative z-30 flex min-h-0 w-full flex-1 flex-col bg-[#0a0a13]/90 backdrop-blur-2xl lg:h-full lg:w-[430px] lg:flex-none lg:border-l lg:border-white/10 xl:w-[460px]"
      >
          <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-white/10 px-4 py-3">
            <div className="relative">
              <div
                className={`absolute -inset-1 rounded-full blur-md ${
                  micState === 'recording'
                    ? 'bg-rose-500/30'
                    : listening
                      ? 'bg-emerald-400/20'
                      : 'bg-violet-500/20'
                }`}
              />
              <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-violet-950/40">
                <SparklesIcon className="h-4 w-4" />
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-semibold tracking-wide">Noni</p>
                <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
              </div>
              <p className="mt-0.5 truncate text-[10px] text-white/40">
                {status.label}
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={openHistory}
                disabled={!noniUp}
                title={noniUp ? 'Saved chats' : 'History needs noni serve'}
                className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-medium text-white/60 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-35"
              >
                History
              </button>
              <button
                type="button"
                onClick={newChat}
                title="New chat"
                className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-medium text-white/60 transition hover:bg-white/[0.08] hover:text-white"
              >
                + New
              </button>
              <button
                type="button"
                onClick={togglePlan}
                disabled={!noniUp}
                title={
                  noniUp
                    ? 'Plan mode: read-only investigation, approve the plan before any edit'
                    : 'Plan mode needs noni serve'
                }
                className={`rounded-full border px-2.5 py-1.5 text-[10px] font-medium transition disabled:opacity-35 ${
                  planMode
                    ? 'border-violet-400/40 bg-violet-500/20 text-violet-100'
                    : 'border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white'
                }`}
              >
                {planMode ? 'Plan ON' : 'Plan'}
              </button>
              <div
                className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-medium sm:flex ${status.cls}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                {status.label}
              </div>
              <button
                type="button"
                onClick={refreshOllamaModels}
                title="Refresh Ollama models"
                className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-medium text-white/55 transition hover:bg-white/[0.08] hover:text-white md:flex"
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    noniUp || ollamaUp ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
                <span className="max-w-[9rem] truncate">
                  {noniUp
                    ? `Noni${noniMeta?.tools ? ` · ${noniMeta.tools} tools` : ''}`
                    : ollamaUp
                      ? ollamaModel || 'Ollama'
                      : 'Ollama offline'}
                </span>
                <RefreshIcon className="h-3 w-3 text-white/30" />
              </button>
            </div>
          </div>

          <div
            ref={logRef}
            className="chat-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4"
          >
            {messages.length === 0 && !waitingForReply ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 px-1 text-center">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full bg-violet-500/25 blur-xl" />
                  <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-xl shadow-violet-950/50">
                    <SparklesIcon className="h-6 w-6" />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-semibold text-white/90">
                    Hey, I&apos;m Noni.
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-white/40">
                    {noniUp
                      ? 'Agent mode — tools, files aur todos sab yahin se. Bolo ya type karo.'
                      : 'Type a message, or turn on listening mode and just talk.'}
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {(noniUp
                    ? ['What is this repo?', 'List the tools', 'Read README', 'Where is the agent loop?']
                    : ['Say hi', 'Tell me a joke', 'Dance for me', 'How are you?']
                  ).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => submit(s)}
                      disabled={llmBusy}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] text-white/55 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3.5">
                {messages.map((m, i) => {
                  if (m.role === 'tool') {
                    return <ToolRow key={m.id ?? i} step={m} />
                  }
                  return m.role === 'bot' ? (
                    <div key={i} className="flex items-start gap-2.5">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-violet-500/80 to-fuchsia-500/80 shadow-md">
                        <SparklesIcon className="h-3.5 w-3.5" />
                      </div>
                      <div
                        className={`${
                          i === messages.length - 1 ? 'bot-last' : ''
                        } max-w-[86%] rounded-2xl rounded-tl-md border border-white/10 bg-white/[0.055] px-3.5 py-2.5 text-[13.5px] leading-relaxed text-white/85 backdrop-blur`}
                      >
                        {m.content}
                        {m.streaming && (
                          <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse rounded-full bg-violet-300 align-middle" />
                        )}
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[86%] rounded-2xl rounded-br-md bg-gradient-to-br from-violet-500 to-fuchsia-500 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-white shadow-lg shadow-violet-950/40">
                        {m.content}
                      </div>
                    </div>
                  )
                })}

                {waitingForReply && (
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-violet-500/80 to-fuchsia-500/80">
                      <SparklesIcon className="h-3.5 w-3.5" />
                    </div>
                    <div className="rounded-2xl rounded-tl-md border border-white/10 bg-white/[0.055] px-4 py-3">
                      <div className="flex gap-1">
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-300/70"
                            style={{ animationDelay: `${i * 0.15}s` }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-white/10 bg-[#080810]/60 p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <ModelPicker
                models={ollamaModels}
                value={ollamaModel}
                onOpen={refreshOllamaModels}
                onChange={(name) => {
                  setOllamaModel(name)
                  saveModel(name)
                }}
              />
              <VoicePicker
                value={voice}
                onChange={(e) => {
                  setVoice(e.target.value)
                  saveVoice(e.target.value)
                }}
              />
              <span className="ml-auto flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-[0.18em] text-white/25">
                <span
                  className={`h-1 w-1 rounded-full ${
                    listening ? 'bg-emerald-400' : 'bg-white/30'
                  }`}
                />
                {listening ? 'Live' : 'Ready'}
              </span>
            </div>

            {micError && (
              <p className="mb-2 px-1 text-[10px] text-rose-300/90">{micError}</p>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleListening}
                disabled={micState === 'transcribing'}
                title={
                  listening ? 'Turn off listening mode' : 'Turn on listening mode'
                }
                aria-label={
                  listening ? 'Stop listening mode' : 'Start listening mode'
                }
                aria-pressed={listening}
                className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border transition disabled:opacity-50 ${
                  micState === 'recording'
                    ? 'border-rose-400/40 bg-rose-500 text-white shadow-lg shadow-rose-900/40'
                    : listening
                      ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/15'
                      : 'border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white'
                }`}
              >
                {micState === 'recording' && (
                  <span className="absolute inset-0 animate-ping rounded-2xl bg-rose-500/25" />
                )}
                {micState === 'starting' || micState === 'transcribing' ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : micState === 'recording' ? (
                  <StopIcon className="h-4 w-4" />
                ) : (
                  <MicIcon className="h-4 w-4" />
                )}
              </button>

              <div className="flex h-10 min-w-0 flex-1 items-center rounded-2xl border border-white/10 bg-white/[0.035] px-3 transition focus-within:border-violet-400/40 focus-within:bg-white/[0.055]">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKey}
                  placeholder={placeholder}
                  disabled={llmBusy}
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/30 disabled:opacity-60"
                />
              </div>

              {ttsPlaying && (
                <button
                  type="button"
                  onClick={stopTalk}
                  title="Stop speaking"
                  aria-label="Stop speaking"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-rose-400/30 bg-rose-500/15 text-rose-300 transition hover:bg-rose-500/25"
                >
                  <StopIcon className="h-4 w-4" />
                </button>
              )}

              <button
                type="button"
                onClick={() => submit(input)}
                disabled={llmBusy || micState === 'transcribing' || !input.trim()}
                title="Send"
                aria-label="Send message"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-950/50 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <SendIcon className="h-[18px] w-[18px] -translate-x-px" />
              </button>
            </div>
          </div>
      </aside>

      {/* ---------------------------------------------------- history */}
      {historyOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-3xl border border-white/10 bg-[#0d0d18] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <p className="text-sm font-semibold">History</p>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                aria-label="Close history"
                className="rounded-xl p-1.5 text-white/40 transition hover:bg-white/10 hover:text-white"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {historyLoading ? (
                <p className="px-3 py-4 text-xs text-white/40">Loading…</p>
              ) : historySessions.length === 0 ? (
                <p className="px-3 py-4 text-xs text-white/40">
                  Koi saved chat nahi. Messages bhejo, phir yahan dikhengi.
                </p>
              ) : (
                historySessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => chooseSession(s.id)}
                    className={`mb-1 flex w-full items-center gap-2 rounded-2xl border px-3 py-2 text-left transition ${
                      s.id === noniMeta?.sessionId
                        ? 'border-violet-400/30 bg-violet-500/10'
                        : 'border-transparent hover:border-white/10 hover:bg-white/[0.05]'
                    }`}
                  >
                    <span className="w-8 shrink-0 text-[10px] text-white/30">
                      #{s.id}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-white/80">
                        {s.title}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-white/35">
                        {new Date(s.updatedAt).toLocaleString()}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>

            <div className="border-t border-white/10 p-3">
              <button
                type="button"
                onClick={newChat}
                className="w-full rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110"
              >
                + New chat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ agent dialogs */}
      {confirmReq && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/60 p-5 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0d0d18] p-5 shadow-2xl">
            <p className="text-sm font-semibold text-white">
              {confirmReq.plan
                ? 'Plan ready — approve and execute?'
                : confirmReq.strict
                  ? 'Risky command — allow anyway?'
                  : `Allow ${confirmReq.name || 'this action'}?`}
            </p>
            {confirmReq.preview && (
              <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-black/40 p-3 text-[11px] text-white/70">
                {confirmReq.preview}
              </pre>
            )}
            {confirmReq.plan && (
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-violet-500/[0.07] p-3 text-[11px] leading-relaxed text-violet-100/80">
                {confirmReq.plan}
              </pre>
            )}
            {!!confirmReq.warnings?.length && (
              <ul className="mt-3 space-y-1 text-[11px] text-amber-300/90">
                {confirmReq.warnings.map((w) => (
                  <li key={w}>⚠ {w}</li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => answerConfirm(false)}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-white/70 transition hover:bg-white/[0.08] hover:text-white"
              >
                {confirmReq.plan ? 'Keep planning' : 'Deny'}
              </button>
              <button
                type="button"
                onClick={() => answerConfirm(true)}
                className="rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 px-3.5 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-950/40 transition hover:brightness-110"
              >
                {confirmReq.plan ? 'Approve & execute' : 'Allow'}
              </button>
            </div>
          </div>
        </div>
      )}

      {askReq && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/60 p-5 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0d0d18] p-5 shadow-2xl">
            <p className="text-sm font-semibold text-white">{askReq.question}</p>
            {!!askReq.options?.length && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {askReq.options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => answerAsk(option)}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/65 transition hover:bg-white/[0.09] hover:text-white"
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
            <form
              className="mt-4 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (askValue.trim()) answerAsk(askValue)
              }}
            >
              <input
                value={askValue}
                onChange={(e) => setAskValue(e.target.value)}
                placeholder="Type your answer"
                autoFocus
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white outline-none focus:border-violet-400/40"
              />
              <button
                type="submit"
                disabled={!askValue.trim()}
                className="rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- overlays */}
    </div>
  )
}
