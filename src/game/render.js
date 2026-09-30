// Dibujo en Canvas 2D. Recibe el estado y no lo modifica.
import { PLAYER, BALL, STAMINA, KICK, TACKLE, VARIANTS, MARGIN, POST_RADIUS, HEIGHT_PROJECTION, MATCH_TICKS, TICK_RATE, TEAM_NAMES } from './constants.js'

export const TEAM_COLORS = { red: '#e0564a', blue: '#4a7de0' }

// Color de la barra de potencia: amarillo rasante, naranja globo, rojo si soltando ahora sería barrida
export function chargeColor(p, state) {
  if (!p.chargeType) return null
  if (p.chargeType === 'kick') {
    // amarillo = por abajo; cuanto más altura, más naranja
    const t = Math.min(1, (p.lift || 0) * 1.4)
    return `rgb(255, ${Math.round(225 - t * 66)}, ${Math.round(77 - t * 49)})`
  }
  if (p.chargeType === 'lob') return '#ff9f1c'
  if (p.chargeType === 'mid') return '#5fd8ff'
  if (state.ball.owner !== p.id && p.charge >= TACKLE.slideThreshold) return '#ff3b3b'
  return '#ffe14d'
}

// Cámara: si la cancha entra en pantalla se ve entera; si no, sigue a tu jugador.
// píxeles de pantalla → coordenadas de la cancha (para apuntar con el mouse)
export function screenToWorld(cam, view, sx, sy) {
  return { x: (sx - view.w / 2) / cam.scale + cam.x, y: (sy - view.h / 2) / cam.scale + cam.y }
}

export function updateCamera(cam, state, view, localId) {
  const { field } = state
  const worldW = field.width + 2 * MARGIN + 40
  const worldH = field.height + 2 * MARGIN + 110
  const fit = Math.min(view.w / worldW, view.h / worldH)
  cam.scale = Math.min(1.6, Math.max(fit, 0.8))
  const me = state.players.find((p) => p.id === localId)
  const halfW = view.w / (2 * cam.scale)
  const halfH = view.h / (2 * cam.scale)
  const follow = (target, half, worldHalf) => (half >= worldHalf ? 0 : Math.max(-worldHalf + half, Math.min(worldHalf - half, target)))
  const tx = follow(me ? me.x : state.ball.x, halfW, worldW / 2)
  const ty = follow(me ? me.y : state.ball.y, halfH, worldH / 2) - (halfH >= worldH / 2 ? 20 / cam.scale : 0)
  if (!cam.ready) {
    cam.x = tx
    cam.y = ty
    cam.ready = true
  }
  cam.x += (tx - cam.x) * 0.12
  cam.y += (ty - cam.y) * 0.12
}

export function render(ctx, state, cam, view, localId, endHint) {
  const { field, ball } = state
  const hw = field.width / 2
  const hh = field.height / 2

  ctx.fillStyle = '#1b361a'
  ctx.fillRect(0, 0, view.w, view.h)

  ctx.save()
  ctx.translate(view.w / 2, view.h / 2)
  ctx.scale(cam.scale, cam.scale)
  ctx.translate(-cam.x, -cam.y)

  drawPitch(ctx, field, hw, hh, state.variant)
  drawGoal(ctx, field, -1)
  drawGoal(ctx, field, 1)
  if (VARIANTS[state.variant].walls) drawWalls2D(ctx, field)

  // sombras
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  for (const p of state.players) ellipse(ctx, p.x + 3, p.y + 4, PLAYER.radius, PLAYER.radius * 0.8)
  const h = ball.z
  const shrink = Math.min(h, 200) / 200
  ctx.fillStyle = `rgba(0,0,0,${0.35 - shrink * 0.2})`
  ellipse(ctx, ball.x, ball.y, BALL.radius * (1 - shrink * 0.4), BALL.radius * (1 - shrink * 0.4) * 0.75)

  const owner = ball.owner ? state.players.find((p) => p.id === ball.owner) : null
  if (owner) {
    // indicador de posesión
    ctx.strokeStyle = TEAM_COLORS[owner.team]
    ctx.lineWidth = 3
    ctx.globalAlpha = 0.6 + 0.3 * Math.sin(state.tick * 0.2)
    circle(ctx, owner.x, owner.y, PLAYER.radius + 8)
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  for (const p of state.players) drawPlayer(ctx, p, p.id === localId, state)

  // pelota (dibujada "más arriba" según su altura)
  if (h > 4) {
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(ball.x, ball.y)
    ctx.lineTo(ball.x, ball.y - h * HEIGHT_PROJECTION)
    ctx.stroke()
  }
  const br = BALL.radius * (1 + h / 250)
  const by = ball.y - h * HEIGHT_PROJECTION
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#111'
  ctx.lineWidth = 2
  circle(ctx, ball.x, by, br)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#222'
  circle(ctx, ball.x, by, br * 0.35)
  ctx.fill()

  ctx.restore()
  drawHud(ctx, state, view, localId, endHint)
}

export function drawPitch(ctx, field, hw, hh, variant = 'futsal') {
  if (variant === 'futsal') {
    // piso gris de cancha techada, con tablas sutiles y áreas teñidas
    ctx.fillStyle = '#3c4148'
    ctx.fillRect(-hw - MARGIN, -hh - MARGIN, field.width + 2 * MARGIN, field.height + 2 * MARGIN)
    ctx.fillStyle = '#868c94'
    ctx.fillRect(-hw, -hh, field.width, field.height)
    ctx.fillStyle = 'rgba(255,255,255,0.04)'
    for (let x = -hw; x < hw; x += 64) ctx.fillRect(x, -hh, 32, field.height)
    ctx.fillStyle = 'rgba(60,100,170,0.35)'
    ctx.fillRect(-hw, -field.areaHeight / 2, field.areaDepth, field.areaHeight)
    ctx.fillRect(hw - field.areaDepth, -field.areaHeight / 2, field.areaDepth, field.areaHeight)
  } else {
    ctx.fillStyle = '#3d7838'
    ctx.fillRect(-hw - MARGIN, -hh - MARGIN, field.width + 2 * MARGIN, field.height + 2 * MARGIN)
    const stripes = 12
    const sw = field.width / stripes
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 ? '#4a8b44' : '#46853f'
      ctx.fillRect(-hw + i * sw, -hh, sw, field.height)
    }
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth = 3
  ctx.strokeRect(-hw, -hh, field.width, field.height)
  ctx.beginPath()
  ctx.moveTo(0, -hh)
  ctx.lineTo(0, hh)
  ctx.stroke()
  circle(ctx, 0, 0, field.kickoffRadius)
  ctx.stroke()
  const ad = field.areaDepth
  const ah = field.areaHeight
  ctx.strokeRect(-hw, -ah / 2, ad, ah)
  ctx.strokeRect(hw - ad, -ah / 2, ad, ah)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  for (const x of [0, -hw + ad * 0.7, hw - ad * 0.7]) {
    circle(ctx, x, 0, 3.5)
    ctx.fill()
  }
}

function drawGoal(ctx, field, side) {
  const hw = field.width / 2
  const gw = field.goalWidth / 2
  const x0 = side * hw
  const x1 = side * (hw + field.goalDepth)
  const left = Math.min(x0, x1)
  ctx.fillStyle = 'rgba(255,255,255,0.14)'
  ctx.fillRect(left, -gw, field.goalDepth, field.goalWidth)
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let y = -gw + 8; y < gw; y += 8) {
    ctx.moveTo(x0, y)
    ctx.lineTo(x1, y)
  }
  for (let x = 8; x < field.goalDepth; x += 8) {
    ctx.moveTo(x0 + side * x, -gw)
    ctx.lineTo(x0 + side * x, gw)
  }
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x0, -gw)
  ctx.lineTo(x1, -gw)
  ctx.lineTo(x1, gw)
  ctx.lineTo(x0, gw)
  ctx.stroke()
  // travesaño
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(x0, -gw)
  ctx.lineTo(x0, gw)
  ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#222'
  ctx.lineWidth = 2
  for (const y of [-gw, gw]) {
    circle(ctx, x0, y, POST_RADIUS)
    ctx.fill()
    ctx.stroke()
  }
}

// Paredes de futsal (2D): franja semitransparente sobre las líneas, abierta en los arcos
function drawWalls2D(ctx, field) {
  const hw = field.width / 2
  const hh = field.height / 2
  const gw = field.goalWidth / 2
  const t = 7
  ctx.fillStyle = 'rgba(190,220,255,0.45)'
  ctx.fillRect(-hw - t, -hh - t, field.width + 2 * t, t)
  ctx.fillRect(-hw - t, hh, field.width + 2 * t, t)
  for (const x of [-hw - t, hw]) {
    ctx.fillRect(x, -hh, t, hh - gw)
    ctx.fillRect(x, gw, t, hh - gw)
  }
}

function drawPlayer(ctx, p, isMe, state) {
  const r = PLAYER.radius
  ctx.save()
  ctx.translate(0, -(p.z || 0) * HEIGHT_PROJECTION) // saltando se dibuja más arriba
  const act = p.action && p.action.type
  if (act === 'slide') {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = r
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(p.x - p.vx * 8, p.y - p.vy * 8)
    ctx.stroke()
    ctx.lineCap = 'butt'
  }
  ctx.globalAlpha = act === 'fallen' ? 0.45 : 1
  ctx.fillStyle = TEAM_COLORS[p.team]
  circle(ctx, p.x, p.y, r)
  ctx.fill()
  ctx.lineWidth = p.chargeType ? 3 : 2
  ctx.strokeStyle = p.chargeType ? '#fff' : '#111'
  ctx.stroke()

  // hacia dónde mira
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  circle(ctx, p.x + p.fx * (r - 4), p.y + p.fy * (r - 4), 2.5)
  ctx.fill()

  if (p.sprinting) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(p.x - p.fx * (r + 3) - p.fy * 6, p.y - p.fy * (r + 3) + p.fx * 6)
    ctx.lineTo(p.x - p.fx * (r + 12) - p.fy * 6, p.y - p.fy * (r + 12) + p.fx * 6)
    ctx.moveTo(p.x - p.fx * (r + 3) + p.fy * 6, p.y - p.fy * (r + 3) - p.fx * 6)
    ctx.lineTo(p.x - p.fx * (r + 12) + p.fy * 6, p.y - p.fy * (r + 12) - p.fx * 6)
    ctx.stroke()
  }

  ctx.font = '600 11px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillStyle = isMe ? '#fff' : 'rgba(255,255,255,0.75)'
  ctx.fillText(p.name, p.x, p.y + r + 5)
  ctx.globalAlpha = 1

  // barra de potencia
  if (p.chargeType) {
    const w = 36
    const t = p.charge / KICK.maxCharge
    const y = p.y - r - 14
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(p.x - w / 2 - 1, y - 1, w + 2, 7)
    ctx.fillStyle = chargeColor(p, state)
    ctx.fillRect(p.x - w / 2, y, w * t, 5)
  }

  if (isMe && state.phase !== 'ended') {
    // flecha de apuntado
    const ang = p.aim ?? Math.atan2(p.fy, p.fx)
    const len = 34 + (p.chargeType ? (p.charge / KICK.maxCharge) * 30 : 0)
    const cx = Math.cos(ang)
    const cy = Math.sin(ang)
    ctx.strokeStyle = chargeColor(p, state) || 'rgba(255,255,255,0.6)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(p.x + cx * (r + 5), p.y + cy * (r + 5))
    ctx.lineTo(p.x + cx * (r + len), p.y + cy * (r + len))
    ctx.stroke()
  }

  if (isMe) {
    // stamina (solo la tuya, debajo del nombre)
    const w = 30
    const y = p.y + r + 19
    const t = p.stamina / STAMINA.max
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.fillRect(p.x - w / 2 - 1, y - 1, w + 2, 5)
    ctx.fillStyle = p.exhausted ? '#e0564a' : t < 0.3 ? '#f0b429' : '#5ee07a'
    ctx.fillRect(p.x - w / 2, y, w * t, 3)
    if (state.phase !== 'ended') {
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.moveTo(p.x, p.y - r - (p.chargeType ? 20 : 6))
      ctx.lineTo(p.x - 6, p.y - r - (p.chargeType ? 28 : 14))
      ctx.lineTo(p.x + 6, p.y - r - (p.chargeType ? 28 : 14))
      ctx.fill()
    }
  }
  ctx.restore()
}

export function drawHud(ctx, state, view, localId, endHint = 'R: revancha  ·  Esc: menú', showHelp = true) {
  const cx = view.w / 2
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // marcador
  const boxW = 300
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  ctx.beginPath()
  ctx.roundRect(cx - boxW / 2, 10, boxW, 42, 10)
  ctx.fill()
  ctx.font = '700 20px system-ui, sans-serif'
  ctx.fillStyle = TEAM_COLORS.red
  ctx.fillRect(cx - boxW / 2 + 14, 24, 14, 14)
  ctx.fillStyle = TEAM_COLORS.blue
  ctx.fillRect(cx + boxW / 2 - 28, 24, 14, 14)
  ctx.fillStyle = '#fff'
  ctx.fillText(`${state.score.red}  -  ${state.score.blue}`, cx - 40, 32)
  ctx.font = '600 18px ui-monospace, monospace'
  ctx.fillText(formatClock(state), cx + 55, 32)

  const totalPos = state.possession.red + state.possession.blue
  if (totalPos > 0) {
    const redPct = Math.round((state.possession.red / totalPos) * 100)
    ctx.font = '500 12px system-ui, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    ctx.fillText(`Posesión ${redPct}% - ${100 - redPct}%`, cx, 64)
  }

  const owner = state.ball.owner ? state.players.find((p) => p.id === state.ball.owner) : null
  if (owner && state.phase === 'play') {
    ctx.font = '600 13px system-ui, sans-serif'
    ctx.fillStyle = TEAM_COLORS[owner.team]
    ctx.fillText(owner.id === localId ? 'La tenés vos' : `La tiene ${owner.name}`, cx, 82)
  }

  if (state.overtime && state.phase !== 'ended') banner(ctx, cx, 104, 'GOL DE ORO', '#ffe14d', 14)
  if (state.phase === 'kickoff') banner(ctx, cx, view.h - 60, `Saca ${TEAM_NAMES[state.kickoffTeam]}`, TEAM_COLORS[state.kickoffTeam], 16)
  if (state.restart && (state.phase === 'out' || state.phase === 'setpiece')) {
    const R = state.restart
    const label = `${RESTART_NAMES[R.type]} para ${TEAM_NAMES[R.team]}`
    if (state.phase === 'out') banner(ctx, cx, view.h / 2 - 40, label, TEAM_COLORS[R.team], 34)
    else banner(ctx, cx, view.h - 60, label, TEAM_COLORS[R.team], 16)
  }

  if (state.phase === 'goal' && state.lastGoal) {
    const g = state.lastGoal
    banner(ctx, cx, view.h / 2 - 20, '¡GOOOL!', TEAM_COLORS[g.team], 64)
    if (g.scorer) banner(ctx, cx, view.h / 2 + 30, g.own ? `En contra de ${g.scorer}` : g.scorer, '#fff', 22)
  }

  if (state.phase === 'ended') {
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(0, 0, view.w, view.h)
    const text = state.winner ? `Ganó ${TEAM_NAMES[state.winner]}` : 'Empate'
    banner(ctx, cx, view.h / 2 - 30, text, state.winner ? TEAM_COLORS[state.winner] : '#fff', 52)
    banner(ctx, cx, view.h / 2 + 20, `${state.score.red} - ${state.score.blue}`, '#fff', 30)
    banner(ctx, cx, view.h / 2 + 64, endHint, 'rgba(255,255,255,0.8)', 16)
  }

  if (!showHelp) return
  ctx.textAlign = 'left'
  ctx.font = '500 12px system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.fillText('Mouse: moverte (mira lejos = correr) · Click izq.: patear (mantené = potencia, subí la mira = altura; sin la pelota: barrida) · Click der.: cubrir · Esc: salir', 12, view.h - 14)
}

const RESTART_NAMES = { lateral: 'Lateral', corner: 'Córner', goalkick: 'Saque de arco' }

function formatClock(state) {
  if (state.overtime) {
    const s = Math.floor((state.time - MATCH_TICKS) / TICK_RATE)
    return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }
  const s = Math.ceil(Math.max(0, MATCH_TICKS - state.time) / TICK_RATE)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function banner(ctx, x, y, text, color, size) {
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `800 ${size}px system-ui, sans-serif`
  ctx.lineWidth = Math.max(3, size / 8)
  ctx.strokeStyle = 'rgba(0,0,0,0.7)'
  ctx.strokeText(text, x, y)
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

function circle(ctx, x, y, r) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
}

function ellipse(ctx, x, y, rx, ry) {
  ctx.beginPath()
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()
}
