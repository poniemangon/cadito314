// IA simple para rellenar equipos. Devuelve el mismo formato de input que un humano
// ({ mx, my, aim, shoot, lift, cover }), así la simulación no distingue bots de humanos.
import { PLAYER, BALL, KICK } from './constants.js'

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

export function createBrain() {
  return { charging: null, lift: 0, aimY: 0, aimTimer: 0 }
}

export function botInput(state, me, brain) {
  const input = { mx: 0, my: 0, shoot: false, lift: 0, cover: false }
  let run = false // correr (sprint)
  if (state.phase === 'ended') return input

  const { field, ball } = state
  const hw = field.width / 2
  const hh = field.height / 2
  const gw = field.goalWidth / 2
  const atk = me.team === 'red' ? 1 : -1
  const goalX = atk * hw
  const ownX = -atk * hw

  if (--brain.aimTimer <= 0) {
    brain.aimY = (Math.random() * 2 - 1) * gw * 0.6
    brain.aimTimer = 90 + Math.random() * 90
  }

  const mates = state.players.filter((p) => p.team === me.team)
  const idx = mates.indexOf(me)
  const n = mates.length
  const hasKeeper = field.perTeam >= 3 && n >= 3
  const ballNearOwnGoal = Math.abs(ball.x - ownX) < field.width * 0.22

  // si en un saque el humano no se mueve, después de 1,5 s saca un bot
  const restartPhase = state.phase === 'kickoff' || state.phase === 'setpiece'
  brain.kickoffTicks = restartPhase ? (brain.kickoffTicks || 0) + 1 : 0
  const skipHumans = brain.kickoffTicks > 90

  // quién va a buscar la pelota: el más cercano (el arquero solo si está cerca de su arco)
  let chaser = null
  let best = Infinity
  mates.forEach((p, i) => {
    if (hasKeeper && i === 0 && !ballNearOwnGoal) return
    if (skipHumans && !p.isBot) return
    const d = Math.hypot(p.x - ball.x, p.y - ball.y)
    if (d < best) {
      best = d
      chaser = p
    }
  })

  const dBall = Math.hypot(ball.x - me.x, ball.y - me.y)
  let tx
  let ty
  const waitingKickoff =
    (state.phase === 'kickoff' && state.kickoffTeam !== me.team) ||
    (state.phase === 'setpiece' && state.restart.team !== me.team) ||
    state.phase === 'out'

  if (ball.owner === me.id) {
    // conducir hacia el arco y definir
    tx = goalX
    ty = brain.aimY
    const gx = goalX - me.x
    const gy = brain.aimY - me.y
    const dGoal = Math.hypot(gx, gy)
    const facing = (me.fx * gx + me.fy * gy) / (dGoal || 1)
    const pressure = state.players.some((p) => p.team !== me.team && Math.hypot(p.x - me.x, p.y - me.y) < 55)
    if (!brain.charging) {
      if (dGoal < field.width * 0.33 && facing > 0.85) {
        // remate: casi siempre por abajo, a veces a media altura
        brain.charging = { ticks: 15 + Math.random() * 30, lift: Math.random() < 0.3 ? 0.15 + Math.random() * 0.2 : 0 }
      } else if (pressure && dGoal > field.width * 0.45 && Math.random() < 0.04) {
        brain.charging = { ticks: 15 + Math.random() * 25, lift: 0.55 + Math.random() * 0.35 } // globo
      }
    }
    run = !pressure && dGoal > 200 && me.stamina > 45
    input.cover = pressure && dGoal > field.width * 0.5 && !brain.charging // cubrirla si lo aprietan lejos del arco
  } else if (chaser === me && !waitingKickoff) {
    // ir a buscarla, anticipando hacia dónde va
    const k = Math.min(dBall / 3, 25)
    tx = ball.x + ball.vx * k
    ty = ball.y + ball.vy * k
    // entrar desde el lado de tu propio arco
    tx -= atk * (PLAYER.radius + BALL.radius) * 0.5
    run = dBall > 110 && me.stamina > 30
    // pelota suelta cerca y bien orientado: le pega de primera
    const reach = PLAYER.radius + BALL.radius + KICK.reach
    if (!brain.charging && dBall < reach && ball.z < KICK.maxHeight && (ball.x - me.x) * atk > 0 && Math.random() < 0.15) {
      brain.charging = { ticks: 3 + Math.random() * 7, lift: ballNearOwnGoal ? 0.5 : 0 } // cerca de su arco, la revienta para arriba
    }
    // la tiene un rival a unos metros: de vez en cuando se tira a barrer
    const rivalHasIt = ball.owner && state.players.some((p) => p.id === ball.owner && p.team !== me.team)
    if (rivalHasIt && !brain.charging && dBall > 45 && dBall < 75 && Math.random() < 0.012) {
      brain.charging = { ticks: 16 + Math.random() * 20, tackle: true, lift: 0 }
    }
  } else if (hasKeeper && idx === 0) {
    tx = ownX + atk * (PLAYER.radius + 12)
    ty = clamp(ball.y * 0.6, -gw, gw)
  } else if ((!hasKeeper && n >= 2 && idx === 0) || (hasKeeper && idx === 1) || (hasKeeper && field.perTeam >= 5 && idx === 2)) {
    // defensor: entre la pelota y el arco propio
    const lane = idx === 2 ? 1 : -1
    tx = ownX + (ball.x - ownX) * 0.35
    ty = ball.y * 0.5 + (field.perTeam >= 5 ? lane * hh * 0.25 : 0)
  } else {
    // atacante: se abre para recibir
    const lane = idx % 2 === 0 ? 1 : -1
    tx = clamp(ball.x + atk * field.width * 0.15, -hw + 60, hw - 60)
    ty = lane * hh * 0.4
  }

  if (brain.charging) {
    // apunta al arco (con un poco de error para que no sean perfectos)
    if (brain.charging.aimError === undefined) brain.charging.aimError = (Math.random() * 2 - 1) * 0.15
    input.aim = brain.charging.tackle
      ? Math.atan2(ball.y + ball.vy * 8 - me.y, ball.x + ball.vx * 8 - me.x) // barrida: hacia donde va a estar la pelota
      : Math.atan2(brain.aimY - ball.y, goalX - ball.x) + brain.charging.aimError
    brain.lift = brain.charging.lift || 0
    if (brain.charging.ticks-- > 0) input.shoot = true
    else brain.charging = null // soltar = patear
  }

  // un rival viene con la pelota: postura defensiva para cerrarle el paso
  const rivalOwner = ball.owner && state.players.find((p) => p.id === ball.owner && p.team !== me.team)
  if (rivalOwner && dBall > 28 && dBall < 90 && !brain.charging) input.cover = true
  input.lift = brain.lift // (se manda también en el tick en que suelta, que es cuando se usa)

  steer(me, tx, ty, input, run)
  return input
}

// Moverse hacia (tx, ty): intensidad 1 = correr, 0.85 = caminar rápido
function steer(me, tx, ty, input, run) {
  const dx = tx - me.x
  const dy = ty - me.y
  const d = Math.hypot(dx, dy)
  if (d < 6) return
  const mag = run ? 1 : 0.85
  input.mx = (dx / d) * mag
  input.my = (dy / d) * mag
}
