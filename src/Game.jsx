import { useEffect, useRef } from 'react'
import { FIELDS, DT } from './game/constants.js'
import { createMatch, step } from './game/simulate.js'
import { createBrain, botInput } from './game/bot.js'
import { createKeyboard } from './game/input.js'
import { render, updateCamera, drawHud, screenToWorld } from './game/render.js'
import { createRenderer3D, drawLabels3D, screenToWorldInput } from './game/render3d.js'
import { encodeSnapshot, applySnapshot } from './net/snapshot.js'

const BOT_NAMES = ['Tito', 'Pipa', 'Chino', 'Cholo', 'Beto', 'Lalo', 'Nacho', 'Tucu', 'Ruso', 'Flaco']
const OFFLINE_ID = 'me'
const AIM_DEADZONE = 24 // unidades de cancha alrededor del jugador donde el cursor no cambia la dirección
const SNAPSHOT_EVERY = 2 // el host manda el estado cada 2 ticks (30 por segundo)
const TPS_SENSITIVITY = 0.0032 // radianes por píxel de mouse en tercera persona

// En tu equipo los bots van primero, así vos quedás en el puesto más adelantado (no de arquero).
function buildRoster(mode, team, name, withBots) {
  const me = { id: OFFLINE_ID, name: name || 'Jugador', team }
  if (!withBots) return [me]
  const n = FIELDS[mode].perTeam
  const roster = []
  let k = 0
  for (const t of ['red', 'blue']) {
    const bots = t === team ? n - 1 : n
    for (let i = 0; i < bots; i++) roster.push({ id: `bot${k}`, name: BOT_NAMES[k++ % BOT_NAMES.length], team: t, isBot: true })
    if (t === team) roster.push(me)
  }
  return roster
}

// Timer en un Web Worker: el navegador casi no lo frena cuando la pestaña queda en segundo plano,
// así el host sigue simulando aunque cambies de pestaña.
function createBackgroundTicker(fn) {
  const src = 'setInterval(() => postMessage(0), 1000 / 60)'
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
  const worker = new Worker(url)
  worker.onmessage = fn
  return () => {
    worker.terminate()
    URL.revokeObjectURL(url)
  }
}

// online: null (offline) · { session, match } (session = host o cliente de net/room.js)
// view: '3d' (isométrica) | 'tps' (tercera persona) | '2d'
export default function Game({ mode, variant, team, name, withBots, view = '3d', relativeMove, online, onExit }) {
  const view3d = view !== '2d'
  const viewMode = view // (dentro del efecto, `view` es el tamaño de pantalla)
  const glRef = useRef(null)
  const hudRef = useRef(null)
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit

  useEffect(() => {
    const hudCanvas = hudRef.current
    const ctx = hudCanvas.getContext('2d')
    const session = online ? online.session : null
    const isClient = !!session && !session.isHost
    const localId = session ? session.localId : OFFLINE_ID
    const matchMode = online ? online.match.mode : mode
    const matchVariant = online ? online.match.variant : variant
    const roster = online ? online.match.roster : buildRoster(mode, team, name, withBots)

    let state = createMatch(matchMode, roster, matchVariant)
    let brains = new Map()
    const brainFor = (id) => {
      if (!brains.has(id)) brains.set(id, createBrain())
      return brains.get(id)
    }

    const tps = viewMode === 'tps'
    const r3d = view3d ? createRenderer3D(glRef.current, state, tps ? 'tps' : 'iso') : null
    const cam2d = { x: 0, y: 0, scale: 1, ready: false }
    const keyboard = createKeyboard()
    const view = { w: 0, h: 0 }
    const endHint = !session ? 'R: revancha  ·  Esc: menú' : isClient ? 'Esperando al host  ·  Esc: volver a la sala' : 'R: revancha  ·  Esc: volver a la sala'

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      view.w = window.innerWidth
      view.h = window.innerHeight
      hudCanvas.width = view.w * dpr
      hudCanvas.height = view.h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (r3d) r3d.resize(view.w, view.h)
    }
    resize()
    window.addEventListener('resize', resize)

    // mouse para apuntar en 360°
    const mouse = { x: 0, y: 0, active: false }
    const onMouseMove = (e) => {
      mouse.x = e.clientX
      mouse.y = e.clientY
      mouse.active = true
    }
    window.addEventListener('mousemove', onMouseMove)

    // Tercera persona: la cámara gira con el mouse (se captura con un click, Esc lo suelta)
    const startMe = state.players.find((p) => p.id === localId)
    let camYaw = startMe && startMe.team === 'blue' ? Math.PI : 0
    let unlockedAt = 0
    const locked = () => document.pointerLockElement === hudCanvas
    const onLookMove = (e) => {
      if (tps && locked()) camYaw += e.movementX * TPS_SENSITIVITY
    }
    const onCanvasDown = (e) => {
      if (tps && !locked()) {
        e.stopPropagation() // este click solo captura el mouse, no patea
        hudCanvas.requestPointerLock()
      }
    }
    const onLockChange = () => {
      if (!locked()) unlockedAt = performance.now()
    }
    document.addEventListener('mousemove', onLookMove)
    hudCanvas.addEventListener('mousedown', onCanvasDown)
    document.addEventListener('pointerlockchange', onLockChange)

    // Último ángulo válido: si el cursor queda encima del jugador, se mantiene (evita que tiemble).
    let lastAim = null
    const readLocalInput = () => {
      const raw = keyboard.read()
      if (tps) {
        // W adelante (hacia donde mira la cámara), S atrás, A/D de costado; el tiro sale hacia la cámara
        let fwd = (raw.up ? 1 : 0) - (raw.down ? 1 : 0)
        let side = (raw.right ? 1 : 0) - (raw.left ? 1 : 0)
        if (fwd && side) {
          fwd *= Math.SQRT1_2
          side *= Math.SQRT1_2
        }
        const c = Math.cos(camYaw)
        const s = Math.sin(camYaw)
        return { ...raw, aim: camYaw, mx: fwd * c - side * s, my: fwd * s + side * c }
      }
      const me = state.players.find((p) => p.id === localId)
      if (mouse.active && me) {
        const pt = r3d ? r3d.screenToGround(mouse.x, mouse.y) : screenToWorld(cam2d, view, mouse.x, mouse.y)
        if (pt && Math.hypot(pt.x - me.x, pt.y - me.y) > AIM_DEADZONE) lastAim = Math.atan2(pt.y - me.y, pt.x - me.x)
      }
      if (lastAim === null) return r3d ? screenToWorldInput(raw) : raw

      const inp = { ...raw, aim: lastAim }
      if (relativeMove) {
        // W = hacia el cursor. S, A y D son fijos según la pantalla (abajo, izquierda, derecha).
        const sx = (raw.right ? 1 : 0) - (raw.left ? 1 : 0)
        const sy = raw.down ? 1 : 0
        // en isométrico, "abajo/izquierda/derecha de la pantalla" son diagonales de la cancha
        let mx = r3d ? (sx - sy) * Math.SQRT1_2 : sx
        let my = r3d ? (sx + sy) * Math.SQRT1_2 : sy
        if (raw.up) {
          mx += Math.cos(lastAim)
          my += Math.sin(lastAim)
        }
        const len = Math.hypot(mx, my)
        inp.mx = len > 0.01 ? mx / len : 0
        inp.my = len > 0.01 ? my / len : 0
        return inp
      }
      return r3d ? screenToWorldInput(inp) : inp
    }

    const onKey = (e) => {
      if (e.code === 'Escape') {
        // en tercera persona, el primer Esc solo suelta el mouse
        if (locked()) return document.exitPointerLock()
        if (performance.now() - unlockedAt < 300) return
        onExitRef.current()
      }
      if (e.code === 'KeyR' && !isClient && state.phase === 'ended') {
        state = createMatch(matchMode, roster, matchVariant)
        brains = new Map()
      }
    }
    window.addEventListener('keydown', onKey)

    // Paso fijo de 1/60 s. Offline y host simulan; el cliente solo manda su input.
    let last = performance.now()
    let acc = 0
    const pump = () => {
      const now = performance.now()
      acc += Math.min(0.25, (now - last) / 1000)
      last = now
      while (acc >= DT) {
        acc -= DT
        const local = readLocalInput()
        if (isClient) {
          session.sendInput(local)
          continue
        }
        const inputs = { [localId]: local }
        for (const p of state.players) {
          if (p.id === localId) continue
          // los bots, y los humanos que se desconectaron, los maneja la IA
          if (p.isBot || (session && !session.isConnected(p.id))) inputs[p.id] = botInput(state, p, brainFor(p.id))
          else if (session) inputs[p.id] = session.getInput(p.id) || undefined
        }
        step(state, inputs)
        if (session && state.tick % SNAPSHOT_EVERY === 0) session.broadcastSnapshot(encodeSnapshot(state))
      }
    }
    const stopTicker = createBackgroundTicker(pump)

    // Cliente: dibuja el último estado del host, interpolado entre los dos últimos snapshots.
    let hasSnapshot = false
    const applyRemote = () => {
      const snaps = session.getSnapshots()
      if (!snaps.length) return
      const b = snaps[snaps.length - 1]
      const a = snaps.length > 1 ? snaps[0] : null
      const interval = a ? Math.max(10, b.at - a.at) : 33
      const alpha = Math.min(1, (performance.now() - b.at) / interval)
      applySnapshot(state, b.snap, a ? a.snap : null, alpha)
      // tu flecha de apuntado responde al instante, sin esperar al host
      const me = state.players.find((p) => p.id === localId)
      if (me && lastAim !== null) me.aim = lastAim
      hasSnapshot = true
    }

    let raf
    const frame = () => {
      pump()
      if (isClient) applyRemote()
      if (import.meta.env.DEV) window.__state = state

      if (r3d) {
        r3d.update(state, localId, { yaw: camYaw })
        r3d.render()
        ctx.clearRect(0, 0, view.w, view.h)
        drawLabels3D(ctx, state, localId, r3d.project)
        drawHud(ctx, state, view, localId, endHint)
      } else {
        updateCamera(cam2d, state, view, localId)
        render(ctx, state, cam2d, view, localId, endHint)
      }
      if (tps && !locked() && state.phase !== 'ended') {
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.beginPath()
        ctx.roundRect(view.w / 2 - 190, view.h - 150, 380, 38, 10)
        ctx.fill()
        ctx.fillStyle = '#fff'
        ctx.font = '600 15px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('Hacé click para mover la cámara con el mouse', view.w / 2, view.h - 131)
      }
      if (isClient && !hasSnapshot) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)'
        ctx.fillRect(0, 0, view.w, view.h)
        ctx.fillStyle = '#fff'
        ctx.font = '600 20px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('Esperando datos del host…', view.w / 2, view.h / 2)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      stopTicker()
      keyboard.dispose()
      if (r3d) r3d.dispose()
      window.removeEventListener('resize', resize)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mousemove', onLookMove)
      hudCanvas.removeEventListener('mousedown', onCanvasDown)
      document.removeEventListener('pointerlockchange', onLockChange)
      if (locked()) document.exitPointerLock()
    }
  }, [mode, variant, team, name, withBots, view, relativeMove, online])

  return (
    <div className="game">
      {view3d && <canvas ref={glRef} className="game-canvas" />}
      <canvas ref={hudRef} className="game-canvas hud" />
    </div>
  )
}
