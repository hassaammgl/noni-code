// Convert Mixamo FBX clips to VRM humanoid tracks.
// Based on pixiv/three-vrm humanoidAnimation example.

import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'

const MIXAMO_TO_VRM = {
  mixamorigHips: 'hips',
  mixamorigSpine: 'spine',
  mixamorigSpine1: 'chest',
  mixamorigSpine2: 'upperChest',
  mixamorigNeck: 'neck',
  mixamorigHead: 'head',
  mixamorigLeftShoulder: 'leftShoulder',
  mixamorigLeftArm: 'leftUpperArm',
  mixamorigLeftForeArm: 'leftLowerArm',
  mixamorigLeftHand: 'leftHand',
  mixamorigRightShoulder: 'rightShoulder',
  mixamorigRightArm: 'rightUpperArm',
  mixamorigRightForeArm: 'rightLowerArm',
  mixamorigRightHand: 'rightHand',
  mixamorigLeftUpLeg: 'leftUpperLeg',
  mixamorigLeftLeg: 'leftLowerLeg',
  mixamorigLeftFoot: 'leftFoot',
  mixamorigLeftToeBase: 'leftToes',
  mixamorigRightUpLeg: 'rightUpperLeg',
  mixamorigRightLeg: 'rightLowerLeg',
  mixamorigRightFoot: 'rightFoot',
  mixamorigRightToeBase: 'rightToes',
}

function rigKey(name) {
  return String(name || '').replace(/:/g, '')
}

function findRig(asset, name) {
  return (
    asset.getObjectByName(name) ||
    asset.getObjectByName(name.replace(/:/g, '')) ||
    asset.getObjectByName(name.replace(/^mixamorig/, 'mixamorig:'))
  )
}

export async function loadMixamoClip(url, vrm) {
  const loader = new FBXLoader()
  const res = await fetch(url)
  if (!res.ok) throw new Error(`FBX ${url} ${res.status}`)
  const asset = loader.parse(await res.arrayBuffer(), '/')
  const clip =
    THREE.AnimationClip.findByName(asset.animations, 'mixamo.com') || asset.animations[0]
  if (!clip) throw new Error(`No clip in ${url}`)

  const hips =
    findRig(asset, 'mixamorigHips') ||
    findRig(asset, 'mixamorig:Hips') ||
    asset.getObjectByName('Hips')
  const motionHipsY = hips?.position.y || 1
  const vrmHipsY = vrm.humanoid?.normalizedRestPose?.hips?.position?.[1] || 1
  const hipsScale = vrmHipsY / motionHipsY
  const vrm0 = vrm.meta?.metaVersion === '0'

  const restRotationInverse = new THREE.Quaternion()
  const parentRestWorldRotation = new THREE.Quaternion()
  const quat = new THREE.Quaternion()
  const tracks = []

  for (const track of clip.tracks) {
    const [rigName, propertyName] = track.name.split('.')
    const vrmBone = MIXAMO_TO_VRM[rigKey(rigName)]
    const node = vrm.humanoid?.getNormalizedBoneNode(vrmBone)
    const src = findRig(asset, rigName)
    if (!node || !src || !propertyName) continue

    src.getWorldQuaternion(restRotationInverse).invert()
    src.parent?.getWorldQuaternion(parentRestWorldRotation)

    if (track instanceof THREE.QuaternionKeyframeTrack) {
      const values = track.values.slice()
      for (let i = 0; i < values.length; i += 4) {
        quat.fromArray(values, i)
        quat.premultiply(parentRestWorldRotation).multiply(restRotationInverse)
        quat.toArray(values, i)
      }
      tracks.push(
        new THREE.QuaternionKeyframeTrack(
          `${node.name}.${propertyName}`,
          track.times,
          values.map((v, i) => (vrm0 && i % 2 === 0 ? -v : v))
        )
      )
    } else if (track instanceof THREE.VectorKeyframeTrack && vrmBone === 'hips') {
      const values = track.values.map((v, i) => (vrm0 && i % 3 !== 1 ? -v : v) * hipsScale)
      tracks.push(new THREE.VectorKeyframeTrack(`${node.name}.${propertyName}`, track.times, values))
    }
  }

  return new THREE.AnimationClip(url, clip.duration, tracks)
}
