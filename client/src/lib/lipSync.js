// Lip-sync engine.
//
// Two modes:
//  1. amplitude - derive mouth openness from a live AnalyserNode
//  2. visemes   - timed shapes (from startSpeech() or Rhubarb)
//
// Web Speech TTS has no audio tap, so speak() uses startSpeech() to drive
// visemes from the spoken text instead of a silent analyser.

import * as THREE from 'three'

// Rhubarb / vowel names -> VRM 1.x expression presets (aa/ih/ou/ee/oh).
const VISEME_TO_VRM = {
  A: 'aa',
  E: 'ee',
  I: 'ih',
  O: 'oh',
  U: 'ou',
  '@': 'aa',
  ih: 'ih',
  oh: 'oh',
  ou: 'ou',
  aa: 'aa',
  ee: 'ee',
  M: 'oh',
  B: 'oh',
  P: 'oh',
  X: 'aa',
  rest: 'aa',
}

const MOUTH_SHAPES = ['aa', 'ih', 'ou', 'ee', 'oh', 'A', 'I', 'U', 'E', 'O']
const SHAPE_ALIASES = {
  aa: ['aa', 'A'],
  ih: ['ih', 'I'],
  ou: ['ou', 'U'],
  ee: ['ee', 'E'],
  oh: ['oh', 'O'],
}

const VOWEL_VISEME = {
  a: 'A',
  e: 'E',
  i: 'I',
  y: 'I',
  o: 'O',
  u: 'U',
  w: 'U',
}

export class LipSync {
  constructor(vrm) {
    this.vrm = vrm
    this.mode = 'amplitude'
    this.analyser = null
    this.visemes = [] // [{start, end, name}]
    this.visemeIdx = 0
    this._visemeTime = 0

    this.target = 0
    this.current = 0
  }

  attachAnalyser(analyser) {
    this.analyser = analyser
    this.data = new Uint8Array(analyser.fftSize)
  }

  setVisemes(visemes) {
    this.visemes = visemes
    this.visemeIdx = 0
    this._visemeTime = 0
    this.mode = 'viseme'
  }

  // Approximate visemes from text. Used because SpeechSynthesis is not
  // routable into Web Audio, so amplitude lip-sync stays silent.
  startSpeech(text) {
    const visemes = []
    let t = 0
    for (const ch of String(text || '')) {
      if (/[\s.,!?;:…]/.test(ch)) {
        visemes.push({ start: t, end: t + 0.1, name: 'rest' })
        t += 0.1
        continue
      }
      const vowel = VOWEL_VISEME[ch.toLowerCase()]
      const dur = vowel ? 0.09 : 0.055
      visemes.push({ start: t, end: t + dur, name: vowel || 'A' })
      t += dur
    }
    this.setVisemes(visemes)
  }

  endSpeech() {
    this.reset()
  }

  _applyExpression(name, value) {
    const em = this.vrm?.expressionManager
    if (!em) return
    for (const key of SHAPE_ALIASES[name] || [name]) em.setValue(key, value)
  }

  _clearMouth() {
    for (const name of MOUTH_SHAPES) this._applyExpression(name, 0)
  }

  _targetFromAmplitude() {
    if (!this.data || !this.analyser) return 0
    this.analyser.getByteTimeDomainData(this.data)
    let sum = 0
    for (let i = 0; i < this.data.length; i++) {
      const v = (this.data[i] - 128) / 128
      sum += v * v
    }
    const rms = Math.sqrt(sum / this.data.length)
    return THREE.MathUtils.clamp(rms * 10, 0, 0.95)
  }

  _currentViseme(time) {
    const list = this.visemes
    if (!list.length) return null
    while (this.visemeIdx < list.length && list[this.visemeIdx].end < time) {
      this.visemeIdx++
    }
    const v = list[this.visemeIdx]
    if (!v || time < v.start) return null
    return v
  }

  _proceduralTalk(time) {
    const pulse = Math.abs(Math.sin(time * 14))
    const envelope = 0.55 + 0.45 * Math.abs(Math.sin(time * 3.1))
    return THREE.MathUtils.clamp(pulse * envelope * 0.7, 0, 0.85)
  }

  _targetFromVisemes(time) {
    const last = this.visemes[this.visemes.length - 1]
    if (!last) return this._proceduralTalk(time)
    if (time > last.end) return this._proceduralTalk(time)
    const v = this._currentViseme(time)
    if (!v) return 0
    return this._mouthFromName(v.name)
  }

  _mouthFromName(name) {
    if (name === 'rest' || name === 'X' || name === 'x') return 0
    switch (name) {
      case 'A':
      case 'aa':
        return 0.8
      case 'E':
      case 'ee':
        return 0.7
      case 'I':
      case 'ih':
        return 0.45
      case 'O':
      case 'oh':
        return 0.4
      case 'U':
      case 'ou':
        return 0.35
      case 'M':
      case 'B':
      case 'P':
        return 0.3
      default:
        return 0.4
    }
  }

  // dt is frame delta in seconds.
  update(dt) {
    if (!this.vrm?.expressionManager) return

    if (this.visemes.length) this._visemeTime += dt

    const amp = this._targetFromAmplitude()
    const viseme = this.visemes.length ? this._currentViseme(this._visemeTime) : null
    const target =
      amp > 0.04 ? amp : this.visemes.length ? this._targetFromVisemes(this._visemeTime) : amp

    this.target = THREE.MathUtils.lerp(this.target, target, 0.35)
    this.target = THREE.MathUtils.clamp(this.target, 0, 1)
    this.current = THREE.MathUtils.lerp(this.current, this.target, 0.4)

    const mouth = this.current
    this._clearMouth()

    if (this.mode === 'viseme' && viseme && mouth > 0.01) {
      const shape = VISEME_TO_VRM[viseme.name] || 'aa'
      this._applyExpression(shape, mouth)
    } else {
      this._applyExpression('aa', mouth * 0.95)
      this._applyExpression('ih', mouth * 0.25)
      this._applyExpression('ou', mouth * 0.3)
      this._applyExpression('ee', mouth * 0.4)
      this._applyExpression('oh', mouth * 0.5)
    }

    const jaw = this.vrm.humanoid?.getNormalizedBoneNode?.('jaw')
    if (jaw) jaw.rotation.x = mouth * 0.28

    return this.current > 0.02
  }

  reset() {
    this.target = 0
    this.current = 0
    this.mode = 'amplitude'
    this.visemes = []
    this.visemeIdx = 0
    this._visemeTime = 0
    this.analyser = null
    this.data = null
    this._clearMouth()
    const jaw = this.vrm?.humanoid?.getNormalizedBoneNode?.('jaw')
    if (jaw) jaw.rotation.x = 0
  }
}
