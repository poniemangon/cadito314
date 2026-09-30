// Jugador 3D: cuerpo articulado simple (caderas, rodillas, hombros, codos) con animación procedural.
// No usa modelos externos: todo son primitivas de Three.js, así pesa poco y no necesita assets.
// Ejes locales: +X = adelante, +Y = arriba, +Z = derecha.
import * as THREE from 'three'
import { PLAYER, KICK } from './constants.js'

const KITS = {
  red: { shirt: '#d9463b', shorts: '#f4f4f4', socks: '#d9463b', number: '#ffffff' },
  blue: { shirt: '#3f6fd8', shorts: '#1b2340', socks: '#3f6fd8', number: '#ffffff' },
}
const SKINS = ['#f1c7a3', '#e2b088', '#c68e62', '#9a6440', '#6b4128']
const HAIRS = ['#1d140e', '#3b2616', '#6a4322', '#111111', '#b8893f', '#7a2f16']
const BOOTS = ['#111111', '#f5f5f5', '#ff5a1f', '#2bd46b', '#1f7aff', '#ffd400']

// Medidas en unidades de cancha (el jugador mide ≈ 46; el travesaño, 50–70)
const M = {
  thigh: 10.5,
  shin: 10,
  foot: 1.8,
  torso: 13.5,
  neck: 1.6,
  headR: 4.3,
  hipW: 3.6,
  shoulderW: 7.8,
  upperArm: 7.5,
  forearm: 7,
}
const HIP_H = M.thigh + M.shin + M.foot
export const HEAD_TOP = HIP_H + M.torso + M.neck + M.headR * 2 + 1

// Cilindro que cuelga desde su extremo superior (para huesos que rotan desde la articulación)
const limbCache = new Map()
function limb(len, r0, r1) {
  const key = `${len}|${r0}|${r1}`
  if (!limbCache.has(key)) limbCache.set(key, new THREE.CylinderGeometry(r0, r1, len, 10).translate(0, -len / 2, 0))
  return limbCache.get(key)
}

const geo = {
  shorts: new THREE.CylinderGeometry(6.4, 6.8, 5.5, 14),
  chest: new THREE.CylinderGeometry(7.2, 5.8, M.torso, 16, 1, false),
  neck: new THREE.CylinderGeometry(1.7, 1.9, M.neck + 1.2, 8),
  head: new THREE.SphereGeometry(M.headR, 18, 14),
  hair: new THREE.SphereGeometry(M.headR * 1.05, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  nose: new THREE.BoxGeometry(1.2, 1.3, 1),
  hand: new THREE.SphereGeometry(1.5, 8, 6),
  foot: new THREE.BoxGeometry(5.4, 1.9, 2.9),
  ring: new THREE.RingGeometry(PLAYER.radius + 3, PLAYER.radius + 7, 36).rotateX(-Math.PI / 2),
  meRing: new THREE.RingGeometry(PLAYER.radius - 1, PLAYER.radius + 1.5, 36).rotateX(-Math.PI / 2),
}

function shirtTexture(kit, number) {
  // La camiseta es un cilindro: u = 0.25 es el frente (+X), u = 0.75 la espalda.
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const ctx = c.getContext('2d')
  ctx.fillStyle = kit.shirt
  ctx.fillRect(0, 0, 256, 128)
  ctx.fillStyle = 'rgba(255,255,255,0.18)' // cuello
  ctx.fillRect(0, 0, 256, 8)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 5
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.fillStyle = kit.number
  ctx.font = '800 64px system-ui, sans-serif'
  ctx.strokeText(String(number), 192, 64)
  ctx.fillText(String(number), 192, 64)
  ctx.font = '800 22px system-ui, sans-serif'
  ctx.fillText(String(number), 52, 40)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function makePlayerModel(p, number, isMe) {
  const kit = KITS[p.team]
  let hash = 0
  for (const ch of p.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const std = (color, roughness = 0.7) => new THREE.MeshStandardMaterial({ color, roughness })
  const mat = {
    shirt: new THREE.MeshStandardMaterial({ map: shirtTexture(kit, number), roughness: 0.75 }),
    sleeve: std(kit.shirt, 0.75),
    shorts: std(kit.shorts),
    socks: std(kit.socks),
    skin: std(SKINS[hash % SKINS.length], 0.6),
    hair: std(HAIRS[(hash >> 3) % HAIRS.length], 0.9),
    boots: std(BOOTS[(hash >> 6) % BOOTS.length], 0.4),
  }

  const root = new THREE.Group() // posición y hacia dónde mira
  const pose = new THREE.Group() // para acostarlo (barrida, caído)
  root.add(pose)
  const hips = new THREE.Group()
  hips.position.y = HIP_H
  pose.add(hips)

  const shorts = new THREE.Mesh(geo.shorts, mat.shorts)
  shorts.position.y = -1.2
  shorts.scale.x = 0.8
  hips.add(shorts)

  const legs = [-1, 1].map((s) => {
    const hip = new THREE.Group()
    hip.position.set(0, -1.5, s * M.hipW)
    hips.add(hip)
    hip.add(new THREE.Mesh(limb(M.thigh, 2.9, 2.2), mat.skin))
    hip.add(new THREE.Mesh(limb(4.6, 3.4, 3.2), mat.shorts)) // pierna del short
    const knee = new THREE.Group()
    knee.position.y = -M.thigh
    hip.add(knee)
    knee.add(new THREE.Mesh(limb(M.shin, 2.2, 1.6), mat.socks))
    const foot = new THREE.Mesh(geo.foot, mat.boots)
    foot.position.set(1.4, -M.shin - 0.7, 0)
    knee.add(foot)
    return { hip, knee }
  })

  const torso = new THREE.Group() // gira desde la cadera
  hips.add(torso)
  const chest = new THREE.Mesh(geo.chest, mat.shirt)
  chest.position.y = M.torso / 2
  chest.scale.x = 0.72
  torso.add(chest)
  const neck = new THREE.Mesh(geo.neck, mat.skin)
  neck.position.y = M.torso + M.neck / 2
  torso.add(neck)
  const headG = new THREE.Group()
  headG.position.y = M.torso + M.neck + M.headR
  torso.add(headG)
  const head = new THREE.Mesh(geo.head, mat.skin)
  head.scale.set(0.95, 1.08, 0.9)
  const hair = new THREE.Mesh(geo.hair, mat.hair)
  hair.position.y = 0.4
  hair.rotation.z = 0.35 // un poco hacia atrás, así se ve la cara
  const nose = new THREE.Mesh(geo.nose, mat.skin)
  nose.position.set(M.headR * 0.9, -0.3, 0)
  headG.add(head, hair, nose)

  const arms = [-1, 1].map((s) => {
    const sh = new THREE.Group()
    sh.position.set(0, M.torso - 1.6, s * M.shoulderW)
    torso.add(sh)
    sh.add(new THREE.Mesh(limb(3.8, 2.5, 2.3), mat.sleeve))
    sh.add(new THREE.Mesh(limb(M.upperArm, 1.9, 1.6), mat.skin))
    const elbow = new THREE.Group()
    elbow.position.y = -M.upperArm
    sh.add(elbow)
    elbow.add(new THREE.Mesh(limb(M.forearm, 1.6, 1.3), mat.skin))
    const hand = new THREE.Mesh(geo.hand, mat.skin)
    hand.position.y = -M.forearm - 0.8
    elbow.add(hand)
    return { sh, elbow, side: s }
  })

  root.traverse((o) => {
    if (o.isMesh) o.castShadow = true
  })

  const possRing = new THREE.Mesh(geo.ring, new THREE.MeshBasicMaterial({ color: kit.shirt, transparent: true, depthWrite: false }))
  possRing.position.y = 0.6
  possRing.visible = false
  root.add(possRing)
  if (isMe) {
    const meRing = new THREE.Mesh(geo.meRing, new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.85, depthWrite: false }))
    meRing.position.y = 0.5
    root.add(meRing)
  }

  return { root, pose, hips, torso, headG, legs, arms, possRing, phase: 0, amp: 0, yaw: null, kickAnim: 0, prevCharge: null, time: 0 }
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

// Anima el modelo según el estado del jugador. dt en segundos.
export function animatePlayer(m, p, dt) {
  m.time += dt
  const speed = Math.hypot(p.vx, p.vy)
  const run = clamp01(speed / 3.6)

  // girar suave hacia donde mira
  const targetYaw = Math.atan2(-p.fy, p.fx)
  if (m.yaw === null) m.yaw = targetYaw
  let d = targetYaw - m.yaw
  d = Math.atan2(Math.sin(d), Math.cos(d))
  m.yaw += d * clamp01(dt * 14)
  m.root.rotation.y = m.yaw
  m.root.position.set(p.x, p.z || 0, p.y)

  // ciclo de carrera: la fase avanza con la distancia recorrida
  m.phase += speed * dt * 60 * 0.2
  const targetAmp = speed > 0.15 ? 0.3 + 0.55 * run : 0
  m.amp += (targetAmp - m.amp) * clamp01(dt * 10)
  const a = m.amp
  const s = Math.sin(m.phase)
  const c = Math.cos(m.phase)
  const [L, R] = m.legs
  const [AL, AR] = m.arms

  L.hip.rotation.set(0, 0, s * a * 1.1)
  R.hip.rotation.set(0, 0, -s * a * 1.1)
  // la rodilla se dobla cuando la pierna pasa hacia adelante
  L.knee.rotation.z = -(0.08 + Math.max(0, c) * 1.5 * a)
  R.knee.rotation.z = -(0.08 + Math.max(0, -c) * 1.5 * a)
  // brazos opuestos a las piernas, codos doblados al correr
  const breathe = Math.sin(m.time * 2.2) * 0.03 * (1 - a)
  AL.sh.rotation.set(0.12, 0, -s * a * 0.9 + breathe)
  AR.sh.rotation.set(-0.12, 0, s * a * 0.9 + breathe)
  AL.elbow.rotation.z = 0.25 + 0.9 * a
  AR.elbow.rotation.z = 0.25 + 0.9 * a
  // rebote, inclinación hacia adelante y giro de hombros
  m.hips.position.y = HIP_H - 0.8 * a + Math.abs(c) * 1.3 * a
  m.torso.rotation.set(0, s * 0.12 * a, -(0.04 + 0.14 * run + (p.sprinting ? 0.1 : 0)))
  m.headG.rotation.set(0, 0, 0.05 * run)

  // carga del tiro: pierna derecha atrás, brazos abiertos, torso hacia atrás
  if (p.chargeType) {
    const t = p.charge / KICK.maxCharge
    R.hip.rotation.z = -0.35 - 0.75 * t
    R.knee.rotation.z = -0.5 - 0.9 * t
    AL.sh.rotation.x = 0.35 + 0.6 * t
    AR.sh.rotation.x = -0.25 - 0.4 * t
    m.torso.rotation.z = 0.05 + 0.12 * t
  }
  // al soltar: pegada y seguimiento de la pierna
  if (m.prevCharge && !p.chargeType) m.kickAnim = 1
  m.prevCharge = p.chargeType
  if (m.kickAnim > 0) {
    m.kickAnim = Math.max(0, m.kickAnim - dt * 4.5)
    const u = 1 - m.kickAnim
    const ease = 1 - (1 - u) * (1 - u)
    R.hip.rotation.z = -0.9 + 2.0 * ease
    R.knee.rotation.z = -1.1 * (1 - ease)
    m.torso.rotation.z = 0.12 - 0.2 * ease
  }

  // salto: rodillas arriba y brazos arriba
  if ((p.z || 0) > 0.5) {
    L.hip.rotation.z = 0.55
    R.hip.rotation.z = 0.35
    L.knee.rotation.z = -1.1
    R.knee.rotation.z = -0.9
    AL.sh.rotation.set(0.3, 0, 2.3)
    AR.sh.rotation.set(-0.3, 0, 2.3)
    AL.elbow.rotation.z = AR.elbow.rotation.z = 0.3
    m.torso.rotation.z = -0.1
  }

  // postura defensiva (Alt): agachado, piernas flexionadas y abiertas, brazos afuera; pasitos cortos
  if ((p.jockey || p.shielding) && !(p.z > 0.5)) {
    const step = Math.sin(m.phase * 1.4) * 0.18 * Math.min(1, speed / 1.5)
    m.hips.position.y = HIP_H - 4.2
    L.hip.rotation.set(0.28, 0, 0.35 + step)
    R.hip.rotation.set(-0.28, 0, 0.35 - step)
    L.knee.rotation.z = R.knee.rotation.z = -0.85
    AL.sh.rotation.set(0.75, 0, 0.25)
    AR.sh.rotation.set(-0.75, 0, 0.25)
    AL.elbow.rotation.z = AR.elbow.rotation.z = 0.7
    m.torso.rotation.set(0, 0, -0.38)
    m.headG.rotation.set(0, 0, 0.3) // mirando la pelota
  }

  // barrida, caído, levantándose
  const act = p.action && p.action.type
  if (act === 'slide') {
    m.pose.rotation.set(0, 0, 1.2)
    m.pose.position.y = 1.5
    R.hip.rotation.z = 0.3
    R.knee.rotation.z = 0
    L.hip.rotation.z = -0.1
    L.knee.rotation.z = -1.3
    AL.sh.rotation.set(0.5, 0, -1.2)
    AR.sh.rotation.set(-0.5, 0, -1.2)
    m.torso.rotation.set(0, 0, -0.3)
  } else if (act === 'fallen') {
    m.pose.rotation.set(Math.PI / 2, 0, 0)
    m.pose.position.y = 6.5
    L.hip.rotation.z = 0.2
    R.hip.rotation.z = -0.1
    L.knee.rotation.z = -0.4
    R.knee.rotation.z = -0.1
    AL.sh.rotation.set(0.2, 0, 0.8)
    AR.sh.rotation.set(-0.2, 0, -0.4)
    m.torso.rotation.set(0, 0, 0)
  } else if (act === 'getup' || act === 'stumble') {
    const t = clamp01(p.action.ticks / 28)
    m.pose.rotation.set(0, 0, act === 'getup' ? t * 1.2 : 0)
    m.pose.position.y = act === 'getup' ? t * 2 : 0
    if (act === 'stumble') m.torso.rotation.z = -0.45
    L.knee.rotation.z = R.knee.rotation.z = -0.6
  } else {
    m.pose.rotation.set(0, 0, 0)
    m.pose.position.y = 0
  }
}
