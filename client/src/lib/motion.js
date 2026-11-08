// Animation pipeline: VRMA oneshots + Mixamo FBX idle/walk, with crossfades.
// Animation credits to pixiv Inc.'s VRoid Project for VRMA clips.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  createVRMAnimationClip,
  VRMAnimationLoaderPlugin,
} from '@pixiv/three-vrm-animation'
import { loadMixamoClip } from './fbxClip.js'

const FADE = 0.45

const VRMA = {
  show: '/motions/VRMA_01.vrma',
  greet: '/motions/VRMA_02.vrma',
  peace: '/motions/VRMA_03.vrma',
  shoot: '/motions/VRMA_04.vrma',
  spin: '/motions/VRMA_05.vrma',
  pose: '/motions/VRMA_06.vrma',
  squat: '/motions/VRMA_07.vrma',
  answer: '/motions/answer.vrma',
  kebab: '/motions/kebab.vrma',
  machia: '/motions/machia.vrma',
  obf: '/motions/obf.vrma',
  countach: '/motions/countach.vrma',
  sunday: '/motions/sunday.vrma',
  genius: '/motions/genius.vrma',
  junkroad: '/motions/junkroad.vrma',
  smile: '/motions/smile.vrma',
  lovely: '/motions/lovely.vrma',
  sparkle: '/motions/sparkle.vrma',
  bond: '/motions/bond.vrma',
}

const FBX = {
  idle: '/motions/standing-idle.fbx',
  walk: '/motions/catwalk.fbx',
}

const FACE = ['happy', 'relaxed', 'surprised', 'sad']

export const CLIP_META = [
  { name: 'idle', group: 'Mixamo', loop: true },
  { name: 'walk', group: 'Mixamo', loop: true },
  { name: 'greet', group: 'Core' },
  { name: 'peace', group: 'Core' },
  { name: 'show', group: 'Core' },
  { name: 'shoot', group: 'Core' },
  { name: 'spin', group: 'Core' },
  { name: 'pose', group: 'Core' },
  { name: 'squat', group: 'Core' },
  { name: 'smile', group: 'Pose' },
  { name: 'lovely', group: 'Pose' },
  { name: 'sparkle', group: 'Pose' },
  { name: 'bond', group: 'Pose' },
  { name: 'answer', group: 'Dance', loop: true },
  { name: 'kebab', group: 'Dance', loop: true },
  { name: 'machia', group: 'Dance', loop: true },
  { name: 'obf', group: 'Dance', loop: true },
  { name: 'countach', group: 'Dance', loop: true },
  { name: 'sunday', group: 'Dance', loop: true },
  { name: 'genius', group: 'Dance', loop: true },
  { name: 'junkroad', group: 'Dance', loop: true },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const DANCES = CLIP_META.filter((c) => c.group === 'Dance').map((c) => c.name)

function pick(names) {
  return names[Math.floor(Math.random() * names.length)]
}

/** Pick a body clip from user prompt + bot reply. */
export function pickTalkClip(reply = '', prompt = '') {
  const t = `${prompt}\n${reply}`.toLowerCase()
  if (/dance|dancing|party|踊|ノリ/.test(t)) return pick(DANCES)
  if (/walk|come here|come closer|let'?s go|follow|歩く|おいで/.test(t)) return 'walk'
  if (/spin|turn around|回/.test(t)) return 'spin'
  if (/sit|squat|sit down|しゃが/.test(t)) return 'squat'
  if (/pose|photo|cheeks|ピース/.test(t)) return 'pose'
  if (/shoot|fight|bang|撃/.test(t)) return 'shoot'
  if (/hello|hi\b|hey|yo\b|こんにちは|やあ|おはよう/.test(t)) return 'greet'
  if (/bye|goodnight|goodbye|see you|バイバイ|おやすみ/.test(t)) return 'greet'
  if (/love|cute|pretty|beautiful|hug|可愛|かわいい|好き/.test(t)) {
    return pick(['lovely', 'smile', 'peace'])
  }
  if (/wow|omg|surpris|what\?|!!|\?{2,}/.test(t)) return 'show'
  if (/\?/.test(reply)) return 'show'
  if (/!/.test(reply) || /ehehe|えへへ|yay|hora/.test(t)) return pick(['peace', 'smile', 'spin'])
  return 'peace'
}

export class Motion {
  constructor(vrm) {
    this.vrm = vrm
    this.mixer = new THREE.AnimationMixer(vrm.scene)
    this._anims = {}
    this._clips = {}
    this._current = null
    this._locked = false
    this._pendingIdle = false
    this._cycleGen = 0
    this.playing = false
    this.currentName = null
    this.onChange = null
    this._face = { happy: 0.2, relaxed: 0.16, surprised: 0, sad: 0 }
    this._targetFace = { happy: 0.2, relaxed: 0.16, surprised: 0, sad: 0 }
    this.ready = this._loadAll()
  }

  list() {
    return CLIP_META.map((meta) => ({
      ...meta,
      ready: !!(this._clips[meta.name] || this._anims[meta.name]),
    }))
  }

  _emit() {
    this.onChange?.(this.currentName, this.list())
  }

  async _loadAll() {
    const gltf = new GLTFLoader()
    gltf.register((parser) => new VRMAnimationLoaderPlugin(parser))

    // VRMA first so greet/talk are not blocked by Mixamo FBX.
    await Promise.all(
      Object.entries(VRMA).map(async ([name, url]) => {
        try {
          const asset = await gltf.loadAsync(url)
          const vrma = asset.userData.vrmAnimations?.[0]
          if (vrma) this._anims[name] = vrma
        } catch (err) {
          console.warn(`VRMA ${name} failed:`, err)
        }
      })
    )

    this._emit()
    this._loadFbx()
  }

  async _loadFbx() {
    await Promise.all(
      Object.entries(FBX).map(async ([name, url]) => {
        try {
          const clip = await loadMixamoClip(url, this.vrm)
          if (clip?.tracks?.length) this._clips[name] = clip
          else console.warn(`FBX ${name} produced no tracks`)
        } catch (err) {
          console.warn(`FBX ${name} failed:`, err)
        }
      })
    )
    this._emit()
    if (this._pendingIdle) {
      this._pendingIdle = false
      this._startIdle()
    }
  }

  _clip(name) {
    if (this._clips[name]) return this._clips[name]
    const vrma = this._anims[name]
    if (!vrma) return null
    this._clips[name] = createVRMAnimationClip(vrma, this.vrm)
    return this._clips[name]
  }

  play(name, { loop = false, force = false, fade = FADE, hold = false, restart = false } = {}) {
    if (this._locked && !force) return false
    const clip = this._clip(name)
    if (!clip?.tracks?.length) return false

    const next = this.mixer.clipAction(clip)
    if (
      !restart &&
      this._current === next &&
      next.isRunning() &&
      next.enabled &&
      this.currentName === name
    ) {
      return true
    }

    next.reset()
    next.enabled = true
    next.paused = false
    next.setEffectiveTimeScale(1)
    next.setEffectiveWeight(1)
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1)
    next.clampWhenFinished = !loop
    next.play()

    const prev = this._current
    // fadeIn multiplies action.weight — never leave weight at 0 or the clip stays invisible.
    if (prev && prev !== next) next.crossFadeFrom(prev, fade, false)
    else next.stopFading()

    this._current = next
    this.currentName = name
    this.playing = true
    this._setLookAt(name === 'idle')
    this._emit()

    if (!loop) {
      this._locked = !hold
      const onDone = (e) => {
        if (e.action !== next) return
        this.mixer.removeEventListener('finished', onDone)
        if (this._current === next) {
          this._locked = false
          if (!hold) this._startIdle()
        }
      }
      this.mixer.addEventListener('finished', onDone)
    } else {
      this._locked = false
    }
    return true
  }

  preview(name) {
    this.stopCycle()
    const meta = CLIP_META.find((c) => c.name === name)
    return this.play(name, { loop: !!meta?.loop, force: true, restart: true })
  }

  stopCycle() {
    this._cycleGen += 1
  }

  async cycleAll() {
    const gen = ++this._cycleGen
    const names = this.list().filter((c) => c.ready).map((c) => c.name)
    for (const name of names) {
      if (gen !== this._cycleGen) return
      const meta = CLIP_META.find((c) => c.name === name)
      const loop = !!meta?.loop
      this.play(name, { loop, force: true, hold: true })
      if (loop) await sleep(3500)
      else await this._waitFinish()
    }
    if (gen === this._cycleGen) this._startIdle()
  }

  _waitFinish() {
    const action = this._current
    if (!action) return Promise.resolve()
    return new Promise((resolve) => {
      const onDone = (e) => {
        if (e.action !== action) return
        this.mixer.removeEventListener('finished', onDone)
        resolve()
      }
      this.mixer.addEventListener('finished', onDone)
    })
  }

  _startIdle() {
    this._locked = false
    this._targetFace = { happy: 0.18, relaxed: 0.2, surprised: 0, sad: 0 }
    if (!this.play('idle', { loop: true, force: true })) {
      this._pendingIdle = true
      this.playing = false
      this._setLookAt(true)
    }
  }

  _setLookAt(on) {
    if (this.vrm.lookAt) this.vrm.lookAt.autoUpdate = on
  }

  wave() {
    this._targetFace = { happy: 0.7, relaxed: 0.05, surprised: 0.12, sad: 0 }
    if (!this.play('greet', { force: true })) this._startIdle()
  }

  startTalk(text = '', prompt = '') {
    const t = String(text)
    const together = `${prompt} ${t}`
    if (/\?/.test(t)) {
      this._targetFace = { happy: 0.25, relaxed: 0, surprised: 0.45, sad: 0 }
    } else if (/!/.test(together) || /love|cute|happy|yay|ehehe|えへへ/i.test(together)) {
      this._targetFace = { happy: 0.65, relaxed: 0.05, surprised: 0.1, sad: 0 }
    } else {
      this._targetFace = { happy: 0.45, relaxed: 0.08, surprised: 0.06, sad: 0 }
    }

    const name = pickTalkClip(t, prompt)
    const meta = CLIP_META.find((c) => c.name === name)
    const loop = !!meta?.loop
    if (!this.play(name, { loop, force: true, hold: loop })) this.play('peace', { force: true })
  }

  endTalk() {
    this._targetFace = { happy: 0.18, relaxed: 0.2, surprised: 0, sad: 0 }
    const meta = CLIP_META.find((c) => c.name === this.currentName)
    if (meta?.loop && this.currentName !== 'idle') this._startIdle()
  }

  walk() {
    return this.play('walk', { loop: true, force: true })
  }

  _updateFace(dt) {
    const em = this.vrm.expressionManager
    if (!em) return
    for (const name of FACE) {
      this._face[name] += (this._targetFace[name] - this._face[name]) * Math.min(1, dt * 6)
      em.setValue(name, this._face[name])
    }
  }

  update(dt) {
    this.mixer.update(dt)
    this._updateFace(dt)
  }
}
