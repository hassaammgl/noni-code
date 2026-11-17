// Browser TTS.
//
// Primary engine: Transformers.js running Supertonic ONNX locally in a worker.
// Fallback: the Web Speech API. Japanese text goes straight to Web Speech,
// since the Supertonic model is English-only.

import { createGenerationGate } from './generationGate.js'
import { preprocessSpeechText } from './speechText.js'
import { synthesizeTts, prewarmTts } from './ttsEngine.js'
import { DEFAULT_VOICE } from './voices.js'

const JAPANESE = /[\u3040-\u30ff\u4e00-\u9faf]/
const HINDI = /[\u0900-\u097f]/
const URDU = /[\u0600-\u06ff]/

function fallbackLang(text) {
  if (JAPANESE.test(text)) return 'ja'
  if (HINDI.test(text)) return 'hi'
  if (URDU.test(text)) return 'ur'
  return ''
}

export class TTS {
  constructor() {
    this.voices = []
    this.ready = false
    this.lastEngine = 'none'
    this.lastError = ''
    this._ctx = null
    this._source = null
    this._pending = null
    this._gate = createGenerationGate()
    this._playing = false
    this._onPageHide = () => this.cancel()
    this._onVoicesChanged = () => this._loadVoices()
    this._loadVoices()
    if (this.supported) {
      window.speechSynthesis.addEventListener('voiceschanged', this._onVoicesChanged)
    }
    window.addEventListener('pagehide', this._onPageHide)
  }

  get supported() {
    return 'speechSynthesis' in window
  }

  get isSpeaking() {
    return this._playing
  }

  _loadVoices() {
    if (!this.supported) return
    this.voices = window.speechSynthesis.getVoices()
    this.ready = true
  }

  _audioCtx() {
    if (!this._ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext
      this._ctx = new Ctx()
    }
    return this._ctx
  }

  _pickVoice(preferred = 'en') {
    if (!this.voices.length) return null
    const lang = String(preferred).toLowerCase()
    const matches = this.voices.filter((v) => v.lang.toLowerCase().startsWith(lang))
    const neural = matches.find((v) => /neural|natural|online/i.test(v.name))
    return neural || matches[0] || this.voices[0]
  }

  // Start downloading the model before the first reply is ready.
  prewarm(onProgress) {
    prewarmTts(onProgress).catch((err) => {
      console.warn('[tts] model prewarm failed:', err)
    })
  }

  async speak(
    text,
    { voice = DEFAULT_VOICE, lang = 'en', rate = 1, pitch = 1, onStart, onEnd, onStatus } = {},
  ) {
    const spoken = preprocessSpeechText(text)
    if (!spoken) {
      this.lastEngine = 'none'
      this.lastError = ''
      onEnd?.()
      return
    }

    this.cancel()
    const gen = this._gate.next()
    this._playing = true
    this.lastEngine = 'none'
    this.lastError = ''

    const done = () => {
      if (!this._gate.isCurrent(gen)) return
      this._playing = false
      onEnd?.()
    }

    const browserLang = fallbackLang(spoken)
    if (browserLang) {
      onStatus?.('fallback')
      await this._speakWeb(spoken, { lang: browserLang, rate, pitch, onStart, onEnd: done })
      return
    }

    try {
      onStatus?.('loading')
      const { audio, samplingRate } = await synthesizeTts({
        text: spoken,
        voice,
        onProgress: (p) => onStatus?.('loading', p.progress),
      })
      if (!this._gate.isCurrent(gen)) return
      this.lastEngine = 'transformers'
      this.lastError = ''
      onStatus?.('speaking')
      await this._play(audio, samplingRate, { gen, onStart })
      if (!this._gate.isCurrent(gen)) return
      done()
      return
    } catch (err) {
      if (!this._gate.isCurrent(gen)) {
        done()
        return
      }
      this.lastError = err?.message || String(err)
      console.warn('[tts] Transformers.js TTS failed, using browser speech:', err)
    }

    if (!this._gate.isCurrent(gen)) return
    onStatus?.('fallback')
    await this._speakWeb(spoken, { lang, rate, pitch, onStart, onEnd: done })
  }

  async _play(audio, samplingRate, { gen, onStart }) {
    if (!audio?.length) throw new Error('TTS returned empty audio')
    const ctx = this._audioCtx()
    if (ctx.state === 'suspended') await ctx.resume()
    if (!this._gate.isCurrent(gen)) return

    const buffer = ctx.createBuffer(1, audio.length, samplingRate)
    buffer.copyToChannel(audio, 0)

    const source = ctx.createBufferSource()
    source.buffer = buffer

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.65
    source.connect(analyser)
    analyser.connect(ctx.destination)

    this._source = source

    await new Promise((resolve, reject) => {
      source.onended = resolve
      try {
        source.start()
        onStart?.(analyser)
      } catch (err) {
        reject(err)
      }
    })
    if (this._source === source) this._source = null
  }

  _speakWeb(text, { lang, rate, pitch, onStart, onEnd }) {
    return new Promise((resolve) => {
      if (!this.supported) {
        this.lastError = 'Web Speech unavailable'
        onEnd?.()
        resolve()
        return
      }

      const u = new SpeechSynthesisUtterance(text)
      u.lang = lang
      u.rate = rate
      u.pitch = pitch
      const voice = this._pickVoice(lang)
      if (voice) u.voice = voice

      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(watchdog)
        if (this._pending === handle) this._pending = null
        onEnd?.()
        resolve()
      }

      u.onstart = () => {
        this.lastEngine = 'webspeech'
        this.lastError = ''
        onStart?.()
      }
      u.onend = finish
      u.onerror = (e) => {
        const reason = e?.error || ''
        if (reason && reason !== 'canceled' && reason !== 'interrupted') {
          this.lastError = `Web Speech: ${reason}`
        }
        finish()
      }

      const handle = { finish }
      this._pending = handle
      const watchdog = setTimeout(
        finish,
        Math.max(4000, (text.length * 90) / rate),
      )
      setTimeout(() => {
        if (this._pending !== handle) {
          finish()
          return
        }
        window.speechSynthesis.speak(u)
      }, 60)
    })
  }

  cancel() {
    this._gate.bump()
    this._playing = false
    if (this._source) {
      try {
        this._source.stop()
      } catch {
        /* already stopped */
      }
      this._source = null
    }
    const pending = this._pending
    this._pending = null
    if (this.supported) window.speechSynthesis.cancel()
    pending?.finish()
  }

  dispose() {
    this.cancel()
    window.removeEventListener('pagehide', this._onPageHide)
    if (this.supported) {
      window.speechSynthesis.removeEventListener('voiceschanged', this._onVoicesChanged)
    }
    if (this._ctx) {
      this._ctx.close().catch(() => {})
      this._ctx = null
    }
    this.voices = []
  }
}
