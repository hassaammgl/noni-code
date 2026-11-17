// Core 3D engine: renders a VRM anime model with three.js + three-vrm,
// adds idle life (breathing, blinking, gentle sway) and drives lip-sync + TTS.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { VRMLookAtQuaternionProxy } from '@pixiv/three-vrm-animation'
import { LipSync } from './lipSync.js'
import { Motion } from './motion.js'
import { TTS } from './tts.js'

const MODEL_URL = '/models/waifu.vrm'

const BLINK_INTERVAL = [2.5, 5]

export class Waifu {
  constructor({ canvas, onReady, onError }) {
    this.canvas = canvas
    this.onReady = onReady
    this.onError = onError
    this._disposed = false

    this._clock = new THREE.Clock()
    this._blinkTimer = this._randBlink()
    this._blinkAmount = 0
    this._blinkState = 'idle'

    this.vrm = null
    this.tts = new TTS()
    this._onResize = this._onResize.bind(this)
    this._animate = this._animate.bind(this)

    this._initRenderer()
    this._initLights()
    this._loadModel()

    window.addEventListener('resize', this._onResize)
    this.renderer.setAnimationLoop(this._animate)
  }

  _initRenderer() {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x06060b)

    this.camera = new THREE.PerspectiveCamera(28, w / h, 0.1, 20)
    this.camera.position.set(0, 1.22, 3.6)
    this.camera.lookAt(0, 1.0, 0)

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
    })

    this.renderer.setSize(w, h)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    const grid = new THREE.GridHelper(6, 20, 0x302a4a, 0x181528)
    grid.position.y = 0.01
    this.scene.add(grid)
  }

  _initLights() {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x2a2140, 0.95)
    this.scene.add(hemi)

    const key = new THREE.DirectionalLight(0xffffff, 1.35)
    key.position.set(1, 2, 2)
    this.scene.add(key)

    const fill = new THREE.DirectionalLight(0x7c5cff, 0.55)
    fill.position.set(-2, 1, 1)
    this.scene.add(fill)
  }

  _loadModel() {
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    loader.load(
      MODEL_URL,
      (gltf) => {
        if (this._disposed) {
          VRMUtils.deepDispose(gltf.scene)
          return
        }
        const vrm = gltf.userData.vrm
        if (!vrm) {
          this.onError?.(new Error('Not a VRM model'))
          return
        }

        try {
          VRMUtils.removeUnnecessaryVertices(gltf.scene)
          VRMUtils.rotateVRM0(vrm)
        } catch (e) {
          console.warn('VRM optimization skipped:', e)
        }

        this.scene.add(vrm.scene)
        this.vrm = vrm
        this.lipSync = new LipSync(vrm)
        this.motion = new Motion(vrm)
        if (vrm.lookAt) {
          const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt)
          proxy.name = 'lookAtQuaternionProxy'
          vrm.scene.add(proxy)
          vrm.lookAt.target = this.camera
        }
        try {
          this._resetPose()
        } catch (e) {
          console.warn('pose reset skipped:', e)
        }
        this._clock.getDelta()
        this.motion.ready.then(() => {
          if (this._disposed) return
          this._clock.getDelta()
          this.motion.wave()
        })
        this.onReady?.(this)
      },
      undefined,
      (err) => {
        if (this._disposed) return
        console.error('Model load failed:', err)
        this.onError?.(err)
      }
    )
  }

  _resetPose() {
    if (!this.vrm) return
    this.vrm.scene.rotation.y = Math.PI
  }

  _randBlink() {
    const [min, max] = BLINK_INTERVAL
    return min + Math.random() * (max - min)
  }

  async speak(text, { lang = 'en', rate = 1, prompt = '', voice, onStatus } = {}) {
    if (!this.lipSync || this._disposed) return
    try {
      await this.tts.speak(text, {
        voice,
        lang,
        rate,
        onStatus,
        onStart: (analyser) => {
          this.lipSync.startSpeech(text)
          if (analyser) this.lipSync.attachAnalyser(analyser)
          this.motion?.startTalk(text, prompt)
        },
      })
    } finally {
      if (!this._disposed) {
        this.lipSync.endSpeech()
        this.motion?.endTalk()
      }
    }
  }

  stopSpeaking() {
    this.tts?.cancel()
    this.lipSync?.endSpeech?.()
    this.motion?.endTalk?.()
  }
  _onResize() {
    if (this._disposed || !this.renderer) return
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  _animate() {
    if (this._disposed) return
    const dt = Math.min(this._clock.getDelta(), 0.05)
    const vrm = this.vrm

    if (vrm) {
      vrm.scene.rotation.y = Math.PI

      if (this._blinkState === 'idle') {
        this._blinkTimer -= dt
        if (this._blinkTimer <= 0) this._blinkState = 'closing'
      } else if (this._blinkState === 'closing') {
        this._blinkAmount = Math.min(1, this._blinkAmount + dt * 12)
        if (this._blinkAmount >= 1) this._blinkState = 'opening'
      } else {
        this._blinkAmount = Math.max(0, this._blinkAmount - dt * 10)
        if (this._blinkAmount <= 0) {
          this._blinkState = 'idle'
          this._blinkTimer = this._randBlink()
        }
      }
      vrm.expressionManager?.setValue('blink', this._blinkAmount)

      this.motion?.update(dt)
      this.lipSync?.update(dt)
      vrm.update(dt)
    }

    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    if (this._disposed) return
    this._disposed = true

    window.removeEventListener('resize', this._onResize)
    this.tts?.cancel()
    this.renderer?.setAnimationLoop(null)

    if (this.vrm) {
      this.scene.remove(this.vrm.scene)
      VRMUtils.deepDispose(this.vrm.scene)
      this.vrm = null
    }

    this.renderer?.dispose()
    this.renderer = null
  }
}
