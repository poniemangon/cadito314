// Vista 3D con Three.js (isométrica o tercera persona). Solo dibuja: la física sigue siendo
// simulate.js (mundo 2D + altura). Ejes: física x → X, física y → Z, altura → Y.
import * as THREE from 'three'
import { PLAYER, BALL, STAMINA, KICK, MARGIN, VARIANTS } from './constants.js'
import { drawPitch, chargeColor } from './render.js'
import { makePlayerModel, animatePlayer, HEAD_TOP } from './player3d.js'

const ISO_DIR = new THREE.Vector3(-1, 1, 1).normalize() // del objetivo hacia la cámara
const CAMERA_DISTANCE = 2000
const FIT_MAX_VIEW = 760 // si con este alto visible entra toda la cancha, se muestra entera y fija
const FOLLOW_VIEW = 540 // si no entra, la cámara sigue a tu jugador con este zoom
const AIM_PLANE_HEIGHT = 20
// Tercera persona: cámara detrás del jugador
const TPS = { distance: 125, height: 62, lookAhead: 70, lookHeight: 22, fov: 58 }

// Con la cámara en diagonal, las flechas se interpretan en coordenadas de pantalla:
// ↑ en pantalla = (+x, -y) en la cancha, → = (+x, +y).
export function screenToWorldInput(inp) {
  const sx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0)
  const sy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0)
  const wx = sx - sy
  const wy = sx + sy
  return { ...inp, right: wx > 0, left: wx < 0, down: wy > 0, up: wy < 0 }
}

// view: 'iso' (isométrica) | 'tps' (tercera persona)
export function createRenderer3D(canvas, state, view = 'iso') {
  const { field } = state
  const hw = field.width / 2
  const hh = field.height / 2
  const gw = field.goalWidth / 2

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#10240f')
  const tps = view === 'tps'
  const camera = tps ? new THREE.PerspectiveCamera(TPS.fov, 1, 1, 7000) : new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 5000)

  // ---------------------------------------------------------------- luces
  scene.add(new THREE.HemisphereLight('#eef6ff', '#2c4a24', 1.5))
  const sun = new THREE.DirectionalLight('#fff3dd', 2.3)
  sun.position.set(-350, 900, -450)
  sun.castShadow = true
  const ext = Math.hypot(hw + MARGIN, hh + MARGIN) + 60
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 10, far: 3000 })
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0006
  scene.add(sun, sun.target)

  // ---------------------------------------------------------------- cancha
  const fw = field.width + 2 * MARGIN
  const fh = field.height + 2 * MARGIN
  const texScale = Math.min(2.5, 4096 / fw)
  const tc = document.createElement('canvas')
  tc.width = Math.round(fw * texScale)
  tc.height = Math.round(fh * texScale)
  const tctx = tc.getContext('2d')
  tctx.scale(texScale, texScale)
  tctx.translate(fw / 2, fh / 2)
  drawPitch(tctx, field, hw, hh, state.variant)
  const pitchTex = new THREE.CanvasTexture(tc)
  pitchTex.colorSpace = THREE.SRGBColorSpace
  pitchTex.anisotropy = renderer.capabilities.getMaxAnisotropy()
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), new THREE.MeshStandardMaterial({ map: pitchTex, roughness: 0.95 }))
  pitch.rotation.x = -Math.PI / 2
  pitch.receiveShadow = true
  scene.add(pitch)

  const futsal = VARIANTS[state.variant].walls
  scene.background = new THREE.Color(futsal ? '#1c1f24' : '#10240f')
  if (tps) {
    // en tercera persona se ve el horizonte: cielo (o techo oscuro en futsal) y niebla a lo lejos
    const sky = futsal ? '#1f2227' : '#9cc4ea'
    scene.background = new THREE.Color(sky)
    scene.fog = new THREE.Fog(sky, 1100, 3200)
  }
  const outside = new THREE.Mesh(
    new THREE.PlaneGeometry(8000, 8000),
    new THREE.MeshStandardMaterial({ color: futsal ? '#2a2e34' : '#1f3d1d', roughness: 1 }),
  )
  outside.rotation.x = -Math.PI / 2
  outside.position.y = -0.5
  outside.receiveShadow = true
  scene.add(outside)

  if (futsal) addGlassWalls(scene, field)
  else addBoards(scene, hw + MARGIN, hh + MARGIN)
  if (tps) addStands(scene, hw + MARGIN + 60, hh + MARGIN + 60, futsal)
  scene.add(buildGoal(field, -1), buildGoal(field, 1))

  // ---------------------------------------------------------------- pelota
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL.radius, 32, 20),
    new THREE.MeshStandardMaterial({ map: makeBallTexture(), roughness: 0.45 }),
  )
  // en tercera persona la pelota se dibuja más chica (más realista); la física no cambia
  const ballScale = 1 // (la pelota ya tiene tamaño realista en la física)
  ball.scale.setScalar(ballScale)
  scene.add(ball)
  const ballShadow = new THREE.Mesh(
    new THREE.CircleGeometry(BALL.radius, 24),
    new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.45, depthWrite: false }),
  )
  ballShadow.rotation.x = -Math.PI / 2
  scene.add(ballShadow)
  const lastBall = { x: state.ball.x, y: state.ball.y }
  const rollQ = new THREE.Quaternion()
  const rollAxis = new THREE.Vector3()

  // ---------------------------------------------------------------- jugadores
  const meshes = new Map()

  // flecha de apuntado del jugador local (en el piso)
  const arrowShape = new THREE.Shape()
  const a0 = PLAYER.radius + 6
  arrowShape.moveTo(a0, -2)
  arrowShape.lineTo(a0 + 26, -2)
  arrowShape.lineTo(a0 + 26, -7)
  arrowShape.lineTo(a0 + 40, 0)
  arrowShape.lineTo(a0 + 26, 7)
  arrowShape.lineTo(a0 + 26, 2)
  arrowShape.lineTo(a0, 2)
  const aimArrow = new THREE.Mesh(
    new THREE.ShapeGeometry(arrowShape).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.7, depthWrite: false }),
  )
  scene.add(aimArrow)

  // ---------------------------------------------------------------- cámara
  const cam = { target: new THREE.Vector3(), ready: false, view: FOLLOW_VIEW, fits: false, w: 1, h: 1 }
  const tmp = new THREE.Vector3()
  const focus = new THREE.Vector3()
  const lookAt = new THREE.Vector3()
  let lastTime = performance.now()

  function resize(w, h) {
    cam.w = w
    cam.h = h
    renderer.setSize(w, h, false)
    const aspect = w / h
    if (tps) {
      camera.aspect = aspect
      camera.updateProjectionMatrix()
      return
    }
    // ¿entra toda la cancha en pantalla?
    camera.position.copy(ISO_DIR).multiplyScalar(CAMERA_DISTANCE)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    let mx = 0
    let my = 0
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const y of [0, 20]) {
          tmp.set(sx * (hw + MARGIN), y, sz * (hh + MARGIN)).applyMatrix4(camera.matrixWorldInverse)
          mx = Math.max(mx, Math.abs(tmp.x))
          my = Math.max(my, Math.abs(tmp.y))
        }
      }
    }
    const fitView = Math.max(2 * my, (2 * mx) / aspect) * 1.18
    cam.fits = fitView <= FIT_MAX_VIEW
    cam.view = cam.fits ? fitView : FOLLOW_VIEW
    camera.left = (-cam.view * aspect) / 2
    camera.right = (cam.view * aspect) / 2
    camera.top = cam.view / 2
    camera.bottom = -cam.view / 2
    camera.updateProjectionMatrix()
  }

  // opts.yaw: hacia dónde mira la cámara en tercera persona (radianes, coordenadas de cancha)
  function update(state, localId, opts = {}) {
    const b = state.ball

    const now = performance.now()
    const dt = Math.min(0.1, (now - lastTime) / 1000)
    lastTime = now

    for (const p of state.players) {
      let m = meshes.get(p.id)
      if (!m) {
        const number = state.players.filter((q) => q.team === p.team).indexOf(p) + 1
        m = makePlayerModel(p, number, p.id === localId)
        meshes.set(p.id, m)
        scene.add(m.root)
      }
      animatePlayer(m, p, dt)
      const owns = b.owner === p.id
      m.possRing.visible = owns
      if (owns) m.possRing.material.opacity = 0.55 + 0.3 * Math.sin(state.tick * 0.2)
    }

    const local = state.players.find((p) => p.id === localId)
    aimArrow.visible = !!local && state.phase !== 'ended'
    if (local) {
      const ang = local.aim ?? Math.atan2(local.fy, local.fx)
      aimArrow.position.set(local.x, 0.8, local.y)
      aimArrow.rotation.y = -ang
      const t = local.chargeType ? local.charge / KICK.maxCharge : 0
      aimArrow.scale.setScalar(1 + t * 0.8)
      aimArrow.material.color.set(chargeColor(local, state) || '#ffffff')
      aimArrow.material.opacity = local.chargeType ? 0.9 : 0.55
    }

    // rodar la pelota según lo que se movió
    const dx = b.x - lastBall.x
    const dz = b.y - lastBall.y
    const dist = Math.hypot(dx, dz)
    if (dist > 0.001 && dist < 60) {
      rollAxis.set(dz, 0, -dx).normalize()
      rollQ.setFromAxisAngle(rollAxis, dist / (BALL.radius * ballScale))
      ball.quaternion.premultiply(rollQ)
    }
    lastBall.x = b.x
    lastBall.y = b.y
    ball.position.set(b.x, b.z + BALL.radius * ballScale, b.y)
    const hk = Math.min(b.z, 200) / 200
    ballShadow.position.set(b.x, 0.4, b.y)
    ballShadow.scale.setScalar((1 - hk * 0.45) * ballScale)
    ballShadow.material.opacity = 0.45 * (1 - hk * 0.7)

    // cámara
    const me = state.players.find((p) => p.id === localId)
    if (tps) {
      if (me) {
        // detrás del jugador, mirando hacia donde apunta la cámara
        const yaw = opts.yaw ?? Math.atan2(me.fy, me.fx)
        const dx = Math.cos(yaw)
        const dz = Math.sin(yaw)
        tmp.set(me.x, (me.z || 0) * 0.5, me.y)
        if (!cam.ready) {
          focus.copy(tmp)
          cam.ready = true
        }
        focus.lerp(tmp, clamp01(dt * 14))
        camera.position.set(focus.x - dx * TPS.distance, focus.y + TPS.height, focus.z - dz * TPS.distance)
        lookAt.set(focus.x + dx * TPS.lookAhead, focus.y + TPS.lookHeight, focus.z + dz * TPS.lookAhead)
      } else {
        // espectador: cámara de transmisión desde el costado, siguiendo la pelota
        tmp.set(b.x * 0.8, 0, 0)
        if (!cam.ready) {
          focus.copy(tmp)
          cam.ready = true
        }
        focus.lerp(tmp, clamp01(dt * 3))
        camera.position.set(focus.x, 420, hh + MARGIN + 520)
        lookAt.set(focus.x, 0, 0)
      }
      camera.lookAt(lookAt)
      camera.updateMatrixWorld()
      return
    }
    if (cam.fits || !me) {
      tmp.set(cam.fits ? 0 : b.x, 0, cam.fits ? 0 : b.y)
    } else {
      tmp.set(me.x + (b.x - me.x) * 0.3, 0, me.y + (b.y - me.y) * 0.3)
    }
    if (!cam.ready) {
      cam.target.copy(tmp)
      cam.ready = true
    }
    cam.target.lerp(tmp, 0.1)
    camera.position.copy(cam.target).addScaledVector(ISO_DIR, CAMERA_DISTANCE)
    camera.lookAt(cam.target)
    camera.updateMatrixWorld()
  }

  function render() {
    renderer.render(scene, camera)
  }

  // mundo → píxeles de pantalla (para nombres y barras en el HUD 2D)
  const pv = new THREE.Vector3()
  function project(x, y, z) {
    pv.set(x, z, y).project(camera)
    if (pv.z > 1) return null // detrás de la cámara
    return { x: ((pv.x + 1) / 2) * cam.w, y: ((1 - pv.y) / 2) * cam.h }
  }

  // píxeles de pantalla → punto en coordenadas de la cancha (para apuntar con el mouse).
  // Se usa un plano a la altura del torso, no el piso: así, al pasar el mouse por encima del
  // cuerpo dibujado, la dirección coincide con lo que ves.
  const raycaster = new THREE.Raycaster()
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -AIM_PLANE_HEIGHT)
  const ndc = new THREE.Vector2()
  const hit = new THREE.Vector3()
  function screenToGround(sx, sy) {
    ndc.set((sx / cam.w) * 2 - 1, -(sy / cam.h) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    if (!raycaster.ray.intersectPlane(ground, hit)) return null
    return { x: hit.x, y: hit.z }
  }

  function dispose() {
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose()
      if (o.material) {
        for (const mat of [].concat(o.material)) {
          if (mat.map) mat.map.dispose()
          mat.dispose()
        }
      }
    })
    renderer.dispose()
  }

  return { resize, update, render, project, screenToGround, dispose }
}

// ---------------------------------------------------------------- nombres y barras

export function drawLabels3D(ctx, state, localId, project) {
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  for (const p of state.players) {
    const isMe = p.id === localId
    const top = project(p.x, p.y, HEAD_TOP + 4 + (p.z || 0))
    if (!top) continue
    let y = top.y

    if (p.chargeType) {
      const w = 40
      const t = p.charge / KICK.maxCharge
      y -= 10
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(top.x - w / 2 - 1, y - 1, w + 2, 8)
      ctx.fillStyle = chargeColor(p, state)
      ctx.fillRect(top.x - w / 2, y, w * t, 6)
      y -= 4
    }

    ctx.font = `${isMe ? 700 : 600} 12px system-ui, sans-serif`
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'
    ctx.strokeText(p.name, top.x, y)
    ctx.fillStyle = isMe ? '#fff' : 'rgba(255,255,255,0.8)'
    ctx.fillText(p.name, top.x, y)

    if (isMe) {
      const feet = project(p.x, p.y, 0)
      if (!feet) continue
      const w = 32
      const t = p.stamina / STAMINA.max
      const sy = feet.y + PLAYER.radius * 0.6 + 6
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(feet.x - w / 2 - 1, sy - 1, w + 2, 6)
      ctx.fillStyle = p.exhausted ? '#e0564a' : t < 0.3 ? '#f0b429' : '#5ee07a'
      ctx.fillRect(feet.x - w / 2, sy, w * t, 4)
    }
  }
}

// ---------------------------------------------------------------- escenario

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

function buildGoal(field, side) {
  const g = new THREE.Group()
  const hw = field.width / 2
  const gw = field.goalWidth / 2
  const bar = field.crossbar
  const depth = field.goalDepth
  const x0 = side * hw
  const x1 = side * (hw + depth)
  const frame = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3, metalness: 0.2 })
  const R = 3.5

  for (const z of [-gw, gw]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(R, R, bar, 12), frame)
    post.position.set(x0, bar / 2, z)
    g.add(post)
    const backPost = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, bar, 6), frame)
    backPost.position.set(x1, bar / 2, z)
    g.add(backPost)
    const topSide = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, depth, 6), frame)
    topSide.rotation.z = Math.PI / 2
    topSide.position.set((x0 + x1) / 2, bar, z)
    g.add(topSide)
  }
  const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(R, R, field.goalWidth + 2 * R, 12), frame)
  crossbar.rotation.x = Math.PI / 2
  crossbar.position.set(x0, bar, 0)
  g.add(crossbar)
  const backTop = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, field.goalWidth, 6), frame)
  backTop.rotation.x = Math.PI / 2
  backTop.position.set(x1, bar, 0)
  g.add(backTop)
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true
  })

  const net = (w, h) => {
    const tex = makeNetTexture()
    tex.repeat.set(w / 8, h / 8)
    return new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false })
  }
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(depth, field.goalWidth), net(depth, field.goalWidth))
  roof.rotation.x = -Math.PI / 2
  roof.position.set((x0 + x1) / 2, bar, 0)
  const back = new THREE.Mesh(new THREE.PlaneGeometry(field.goalWidth, bar), net(field.goalWidth, bar))
  back.rotation.y = Math.PI / 2
  back.position.set(x1, bar / 2, 0)
  g.add(roof, back)
  for (const z of [-gw, gw]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(depth, bar), net(depth, bar))
    s.position.set((x0 + x1) / 2, bar / 2, z)
    g.add(s)
  }
  return g
}

// Futsal: paredes de vidrio sobre las líneas (semitransparentes para que no tapen el juego),
// abiertas en la boca del arco por debajo del travesaño.
function addGlassWalls(scene, field) {
  const hw = field.width / 2
  const hh = field.height / 2
  const gw = field.goalWidth / 2
  const bar = field.crossbar
  const H = 70
  const T = 4
  const glass = new THREE.MeshStandardMaterial({
    color: '#cfe6ff', transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide,
  })
  const frame = new THREE.MeshStandardMaterial({ color: '#d9dde3', transparent: true, opacity: 0.55, roughness: 0.4, depthWrite: false })
  // panel de vidrio: centro (x, z), largo, alto, desde y0, orientado sobre X o sobre Z
  const panel = (x, z, len, y0, h, alongZ) => {
    const g = new THREE.Mesh(new THREE.BoxGeometry(alongZ ? T : len, h, alongZ ? len : T), glass)
    g.position.set(x, y0 + h / 2, z)
    g.renderOrder = 2
    scene.add(g)
    const rail = new THREE.Mesh(new THREE.BoxGeometry(alongZ ? T + 1 : len, 3, alongZ ? len : T + 1), frame)
    rail.position.set(x, y0 + h, z)
    rail.renderOrder = 3
    scene.add(rail)
  }
  const ex = hw + T / 2
  const ez = hh + T / 2
  panel(0, -ez, 2 * hw + 2 * T, 0, H, false)
  panel(0, ez, 2 * hw + 2 * T, 0, H, false)
  for (const sx of [-1, 1]) {
    const seg = hh - gw
    panel(sx * ex, -(gw + seg / 2), seg, 0, H, true)
    panel(sx * ex, gw + seg / 2, seg, 0, H, true)
    panel(sx * ex, 0, 2 * gw, bar, H - bar, true) // encima del arco
  }
  // parantes cada tanto (dan referencia de dónde está la pared)
  const postGeo = new THREE.BoxGeometry(3, H, 3)
  const addPost = (x, z) => {
    const m = new THREE.Mesh(postGeo, frame)
    m.position.set(x, H / 2, z)
    scene.add(m)
  }
  for (let x = -hw; x <= hw + 1; x += 100) {
    addPost(x, -ez)
    addPost(x, ez)
  }
  for (const sx of [-1, 1]) for (const z of [-hh, -gw, gw, hh]) addPost(sx * ex, z)
}

// Tribunas escalonadas alrededor (se ven sobre todo en tercera persona)
function addStands(scene, ex, ez, indoor) {
  const colors = indoor ? ['#3a3f47', '#454b54', '#4f5661'] : ['#5b6470', '#6a7480', '#7a8490']
  const crowd = ['#e0564a', '#4a7de0', '#f2f2f2', '#f0b429', '#2bd46b', '#222']
  const steps = 5
  const depth = 26
  const rise = 16
  const add = (x, z, w, d, h, color) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }))
    m.position.set(x, h / 2, z)
    m.receiveShadow = true
    scene.add(m)
  }
  for (let i = 0; i < steps; i++) {
    const off = i * depth + depth / 2
    const h = (i + 1) * rise
    const col = colors[i % colors.length]
    add(0, -ez - off, 2 * (ex + off), depth, h, col)
    add(0, ez + off, 2 * (ex + off), depth, h, col)
    add(-ex - off, 0, depth, 2 * ez, h, col)
    add(ex + off, 0, depth, 2 * ez, h, col)
  }
  // público: cubitos de colores sobre los escalones de los costados largos
  const personGeo = new THREE.BoxGeometry(5, 9, 5)
  const mats = crowd.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }))
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < steps; i++) {
    const off = i * depth + depth / 2
    const y = (i + 1) * rise + 4.5
    for (let x = -ex; x < ex; x += 11) {
      for (const side of [-1, 1]) {
        if (rnd() < 0.45) continue
        const m = new THREE.Mesh(personGeo, mats[Math.floor(rnd() * mats.length)])
        m.position.set(x + rnd() * 5, y, side * (ez + off))
        scene.add(m)
      }
    }
  }
}

function addBoards(scene, ex, ez) {
  const colors = ['#e0564a', '#f2f2f2', '#4a7de0', '#1d1d1d']
  const mats = colors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }))
  const H = 14
  const T = 5
  const seg = 110
  const place = (len, fn) => {
    const n = Math.ceil(len / seg)
    for (let i = 0; i < n; i++) {
      const l = len / n
      const m = new THREE.Mesh(new THREE.BoxGeometry(l - 2, H, T), mats[i % mats.length])
      m.castShadow = true
      m.receiveShadow = true
      fn(m, -len / 2 + l * (i + 0.5))
      scene.add(m)
    }
  }
  place(2 * ex, (m, t) => m.position.set(t, H / 2, -ez - T / 2))
  place(2 * ex, (m, t) => m.position.set(t, H / 2, ez + T / 2))
  place(2 * ez, (m, t) => {
    m.rotation.y = Math.PI / 2
    m.position.set(-ex - T / 2, H / 2, t)
  })
  place(2 * ez, (m, t) => {
    m.rotation.y = Math.PI / 2
    m.position.set(ex + T / 2, H / 2, t)
  })
}

function makeNetTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const ctx = c.getContext('2d')
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'
  ctx.lineWidth = 2
  ctx.strokeRect(0, 0, 32, 32)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

function makeBallTexture() {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#fafafa'
  ctx.fillRect(0, 0, 256, 128)
  ctx.fillStyle = '#1a1a1a'
  const spots = [[32, 20], [96, 20], [160, 20], [224, 20], [0, 64], [64, 64], [128, 64], [192, 64], [256, 64], [32, 108], [96, 108], [160, 108], [224, 108]]
  for (const [x, y] of spots) {
    ctx.beginPath()
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2
      ctx.lineTo(x + Math.cos(a) * 13, y + Math.sin(a) * 11)
    }
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
