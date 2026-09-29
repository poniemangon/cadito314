// IA simple para rellenar equipos. Devuelve el mismo formato de input que el teclado,
// así la simulación no distingue bots de humanos.
import { PLAYER, BALL, KICK, JUMP } from './constants.js'

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

export function createBrain() {
  return { charging: null, aimY: 0, aimTimer: 0 }
}

export function botInput(state, me, brain) {
  const input = { up: false, down: false, left: false, right: false, sprint: false, shoot: false, lob: false, jump: false, jockey: false }
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
        brain.charging = { key: 'shoot', ticks: 15 + Math.random() * 30 }
      } else if (pressure && dGoal > field.width * 0.45 && Math.random() < 0.04) {
        brain.charging = { key: 'lob', ticks: 15 + Math.random() * 25 }
      }
    }
    input.sprint = !pressure && dGoal > 200 && me.stamina > 45
  } else if (chaser === me && !waitingKickoff) {
    // ir a buscarla, anticipando hacia dónde va
    const k = Math.min(dBall / 3, 25)
    tx = ball.x + ball.vx * k
    ty = ball.y + ball.vy * k
    // entrar desde el lado de tu propio arco
    tx -= atk * (PLAYER.radius + BALL.radius) * 0.5
    input.sprint = dBall > 110 && me.stamina > 30
    // pelota suelta cerca y bien orientado: le pega de primera
    const reach = PLAYER.radius + BALL.radius + KICK.reach
    // (carga corta: si la pelota se escapa, termina en quite y no en barrida)
    if (!brain.charging && dBall < reach && ball.z < KICK.maxHeight && (ball.x - me.x) * atk > 0 && Math.random() < 0.15) {
      brain.charging = { key: ballNearOwnGoal ? 'lob' : 'shoot', ticks: 3 + Math.random() * 7 }
    }
    // la tiene un rival: quite si está pegado, barrida de vez en cuando si está a unos metros
    const rivalHasIt = ball.owner && state.players.some((p) => p.id === ball.owner && p.team !== me.team)
    if (rivalHasIt && !brain.charging && me.tackleCooldown === 0) {
      if (dBall < 34 && Math.random() < 0.06) brain.charging = { key: 'shoot', ticks: 2, tackle: true }
      else if (dBall > 45 && dBall < 75 && Math.random() < 0.012) brain.charging = { key: 'shoot', ticks: 16 + Math.random() * 20, tackle: true }
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

  // salto y cabezazo: pelota alta bajando cerca → saltar, y cabecear cuando llega a la cabeza
  const airborne = me.z > 0 || me.vz > 0
  if (airborne) {
    brain.charging = null
    const rel = ball.z + BALL.radius - me.z
    const near = dBall - PLAYER.radius - BALL.radius < JUMP.headerReach
    brain.headerPress = !brain.headerPress && near && rel > JUMP.headMin && rel < JUMP.headMax
    input.shoot = brain.headerPress
    input.aim = Math.atan2(brain.aimY - me.y, goalX - me.x)
    steer(me, tx, ty, input)
    return input
  }
  if (!waitingKickoff && ball.z > 22 && ball.z < 70 && ball.vz < 0 && dBall < 45 && Math.random() < 0.25) {
    brain.charging = null
    input.jump = true
    steer(me, tx, ty, input)
    return input
  }

  if (brain.charging) {
    // apunta al arco (con un poco de error para que no sean perfectos)
    if (brain.charging.aimError === undefined) brain.charging.aimError = (Math.random() * 2 - 1) * 0.15
    input.aim = brain.charging.tackle
      ? Math.atan2(ball.y + ball.vy * 8 - me.y, ball.x + ball.vx * 8 - me.x) // barrida: hacia donde va a estar la pelota
      : Math.atan2(brain.aimY - ball.y, goalX - ball.x) + brain.charging.aimError
    if (brain.charging.ticks-- > 0) input[brain.charging.key] = true
    else brain.charging = null // soltar = patear
  }

  // un rival viene con la pelota: postura defensiva para cerrarle el paso
  const rivalOwner = ball.owner && state.players.find((p) => p.id === ball.owner && p.team !== me.team)
  if (rivalOwner && dBall > 28 && dBall < 90 && !brain.charging) input.jockey = true

  steer(me, tx, ty, input)
  return input
}

function steer(me, tx, ty, input) {
  const dx = tx - me.x
  const dy = ty - me.y
  const d = Math.hypot(dx, dy)
  if (d < 6) return
  const nx = dx / d
  const ny = dy / d
  input.right = nx > 0.38
  input.left = nx < -0.38
  input.down = ny > 0.38
  input.up = ny < -0.38
}
