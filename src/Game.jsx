import { useEffect, useRef } from 'react'
import { FIELDS, DT, MOVE, KICK } from './game/constants.js'
import { createMatch, step, predictKick } from './game/simulate.js'
import { createBrain, botInput } from './game/bot.js'
import { createMouseButtons } from './game/input.js'
import { drawHud } from './game/render.js'
import { createRenderer3D, drawLabels3D } from './game/render3d.js'
import { encodeSnapshot, applySnapshot } from './net/snapshot.js'

const BOT_NAMES = ['Tito', 'Pipa', 'Chino', 'Cholo', 'Beto', 'Lalo', 'Nacho', 'Tucu', 'Ruso', 'Flaco']
const OFFLINE_ID = 'me'
const AIM_DEADZONE = 12 // unidades de cancha alrededor del jugador donde la mira no cambia la dirección
const SNAPSHOT_EVERY = 2 // el host manda el estado cada 2 ticks (30 por segundo)
const LIFT_PIXELS = 170 // cuánto hay que subir la mira (en píxeles) para la altura máxima
const JOY_DEADZONE = 0.15

// ¿Pantalla táctil? (celular / tablet): joystick y botones en pantalla
const isTouch = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches

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
export default function Game({ mode, variant, team, name, withBots, online, onExit }) {
  const glRef = useRef(null)
  const hudRef = useRef(null)
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit
  // estado de los controles táctiles (lo escriben los handlers de abajo, lo lee el loop del juego)
  const touch = useRef({ jx: 0, jy: 0, kick: false, kickY: 0, cover: false })
  const knobRef = useRef(null)

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

    const r3d = createRenderer3D(glRef.current, state, 'iso')
    const mouseButtons = createMouseButtons()
    const view = { w: 0, h: 0 }
    const endHint = isTouch
      ? isClient ? 'Esperando al host' : ''
      : !session ? 'R: revancha  ·  Esc: menú' : isClient ? 'Esperando al host  ·  Esc: volver a la sala' : 'R: revancha  ·  Esc: volver a la sala'

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      view.w = window.innerWidth
      view.h = window.innerHeight
      hudCanvas.width = view.w * dpr
      hudCanvas.height = view.h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      r3d.resize(view.w, view.h)
    }
    resize()
    window.addEventListener('resize', resize)

    // la mira es el mouse
    const mouse = { x: 0, y: 0, active: false }
    const onMouseMove = (e) => {
      mouse.x = e.clientX
      mouse.y = e.clientY
      mouse.active = true
    }
    window.addEventListener('mousemove', onMouseMove)

    // Carga del tiro: al apretar, la dirección queda fija donde apuntabas; subir la mira agrega altura
    const charge = { active: false, startY: 0, anchor: null, aim: null, lift: 0, ticks: 0 }
    let lastAim = null

    const readLocalInput = () => {
      const me = state.players.find((p) => p.id === localId)
      const btn = mouseButtons.read()
      const t = touch.current
      const kick = btn.kick || t.kick
      const cover = btn.cover || t.cover
      const pointerY = t.kick ? t.kickY : mouse.y

      if (kick && !charge.active) {
        charge.active = true
        charge.ticks = 0
        charge.startY = pointerY
        charge.aim = lastAim
        charge.anchor = !t.kick && mouse.active ? r3d.screenToGround(mouse.x, mouse.y) : null
      } else if (!kick && charge.active) {
        charge.active = false // (charge.lift se manda igual en este tick: es cuando se patea)
      }
      if (charge.active) {
        charge.ticks++
        charge.lift = Math.max(0, Math.min(1, (charge.startY - pointerY) / LIFT_PIXELS))
      }
      if (!me) return {}

      let mx = 0
      let my = 0
      const jmag = Math.min(1, Math.hypot(t.jx, t.jy))
      if (isTouch) {
        // joystick: misma lógica que la mira (dirección + cuánto lo empujás = velocidad).
        // En isométrico, derecha en pantalla = (+x, +y) en la cancha; abajo = (-x, +y).
        if (jmag > JOY_DEADZONE) {
          const wx = (t.jx - t.jy) * Math.SQRT1_2
          const wy = (t.jx + t.jy) * Math.SQRT1_2
          const wl = Math.hypot(wx, wy)
          const mag = jmag >= 0.92 ? 1 : MOVE.minMag + (0.9 - MOVE.minMag) * ((jmag - JOY_DEADZONE) / (0.92 - JOY_DEADZONE))
          mx = (wx / wl) * mag
          my = (wy / wl) * mag
          if (!charge.active) lastAim = Math.atan2(wy, wx)
        }
        if (charge.active && charge.aim !== null) lastAim = charge.aim
      } else if (mouse.active) {
        // hacia la mira; mientras cargás, hacia el punto donde hiciste click
        const pt = charge.active && charge.anchor ? charge.anchor : r3d.screenToGround(mouse.x, mouse.y)
        if (pt) {
          const dx = pt.x - me.x
          const dy = pt.y - me.y
          const d = Math.hypot(dx, dy)
          if (d > AIM_DEADZONE) lastAim = Math.atan2(dy, dx)
          let mag = 0
          if (d >= MOVE.sprintDist) mag = 1
          else if (d > MOVE.stopDist) mag = MOVE.minMag + (0.9 - MOVE.minMag) * ((d - MOVE.stopDist) / (MOVE.sprintDist - MOVE.stopDist))
          if (mag > 0) {
            mx = (dx / d) * mag
            my = (dy / d) * mag
          }
        }
      }
      return { mx, my, aim: lastAim, shoot: kick, lift: charge.lift, cover }
    }

    const onKey = (e) => {
      if (e.code === 'Escape') onExitRef.current()
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

    // Curva del tiro mientras cargás (se levanta a medida que subís la mira)
    const drawTrajectory = () => {
      const me = state.players.find((p) => p.id === localId)
      if (!me || !charge.active || state.phase === 'ended') return
      const power = Math.min(1, Math.max(1, charge.ticks) / KICK.maxCharge)
      const pts = predictKick(state, me, power, charge.lift, lastAim)
      ctx.save()
      ctx.fillStyle = charge.lift > 0.03 ? '#ff9f1c' : '#ffe14d'
      for (let i = 0; i < pts.length; i += 3) {
        const s = r3d.project(pts[i].x, pts[i].y, pts[i].z)
        if (!s) continue
        ctx.globalAlpha = 0.9 - (i / pts.length) * 0.6
        ctx.beginPath()
        ctx.arc(s.x, s.y, 3, 0, Math.PI * 2)
        ctx.fill()
      }
      // dónde pica por primera vez
      const land = pts.find((p, i) => i > 2 && p.z === 0)
      if (land) {
        const s = r3d.project(land.x, land.y, 0)
        if (s) {
          ctx.globalAlpha = 0.9
          ctx.strokeStyle = ctx.fillStyle
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.ellipse(s.x, s.y, 9, 5, 0, 0, Math.PI * 2)
          ctx.stroke()
        }
      }
      ctx.restore()
    }

    let raf
    const frame = () => {
      pump()
      if (isClient) applyRemote()
      if (import.meta.env.DEV) window.__state = state

      r3d.update(state, localId)
      r3d.render()
      ctx.clearRect(0, 0, view.w, view.h)
      drawTrajectory()
      drawLabels3D(ctx, state, localId, r3d.project)
      drawHud(ctx, state, view, localId, endHint, !isTouch)
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
      mouseButtons.dispose()
      r3d.dispose()
      window.removeEventListener('resize', resize)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousemove', onMouseMove)
    }
  }, [mode, variant, team, name, withBots, online])

  // --- controles táctiles
  const joyDown = (e) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    joyMove(e)
  }
  const joyMove = (e) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const r = e.currentTarget.getBoundingClientRect()
    const radius = r.width / 2
    let dx = (e.clientX - (r.left + radius)) / radius
    let dy = (e.clientY - (r.top + radius)) / radius
    const len = Math.hypot(dx, dy)
    if (len > 1) {
      dx /= len
      dy /= len
    }
    touch.current.jx = dx
    touch.current.jy = dy
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx * radius * 0.6}px, ${dy * radius * 0.6}px)`
  }
  const joyUp = () => {
    touch.current.jx = 0
    touch.current.jy = 0
    if (knobRef.current) knobRef.current.style.transform = ''
  }
  const btnHandlers = (key) => ({
    onPointerDown: (e) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      touch.current[key] = true
      if (key === 'kick') touch.current.kickY = e.clientY
    },
    onPointerMove: (e) => {
      if (key === 'kick' && touch.current.kick) touch.current.kickY = e.clientY
    },
    onPointerUp: () => {
      touch.current[key] = false
    },
    onPointerCancel: () => {
      touch.current[key] = false
    },
  })

  return (
    <div className="game">
      <canvas ref={glRef} className="game-canvas" />
      <canvas ref={hudRef} className="game-canvas hud" />
      {isTouch && (
        <div className="touch">
          <button type="button" className="touch-exit" onClick={() => onExitRef.current()}>
            ✕
          </button>
          <div className="joystick" onPointerDown={joyDown} onPointerMove={joyMove} onPointerUp={joyUp} onPointerCancel={joyUp}>
            <div className="joystick-knob" ref={knobRef} />
          </div>
          <div className="touch-buttons">
            <div className="touch-btn cover" {...btnHandlers('cover')}>
              Cubrir
            </div>
            <div className="touch-btn kick" {...btnHandlers('kick')}>
              Patear
              <small>deslizá ↑ = altura</small>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
