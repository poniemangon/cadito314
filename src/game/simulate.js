// Simulación pura y determinista: step(state, inputs) avanza un tick.
// No usa Math.random ni nada del navegador, así el host online puede correr exactamente esto.
import {
  PLAYER, STAMINA, BALL, KICK, CONTROL, TACKLE, JOCKEY, MOVE, FIELDS, FORMATIONS, MARGIN, POST_RADIUS,
  JUMP, NET_BOUNCE, POST_BOUNCE, MATCH_TICKS, GOAL_PAUSE_TICKS, OUT_PAUSE_TICKS, SETPIECE_RADIUS, VARIANTS,
} from './constants.js'

const NO_INPUT = Object.freeze({ up: false, down: false, left: false, right: false, sprint: false, shoot: false, lob: false, jump: false })

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const ownSide = (team) => (team === 'red' ? -1 : 1)

export function createMatch(mode, roster, variant = 'futsal') {
  const field = FIELDS[mode]
  const state = {
    mode,
    variant, // 'futsal' | 'fulbo'
    field,
    tick: 0,
    time: 0,
    overtime: false,
    phase: 'kickoff', // kickoff | play | goal | out | setpiece | ended
    restart: null, // fulbo: { type: 'lateral' | 'corner' | 'goalkick', team, x, y }
    phaseTimer: 0,
    kickoffTeam: 'red',
    score: { red: 0, blue: 0 },
    possession: { red: 0, blue: 0 },
    lastTouch: null,
    lastGoal: null,
    winner: null,
    players: roster.map((r) => ({
      id: r.id,
      name: r.name,
      team: r.team,
      isBot: !!r.isBot,
      x: 0, y: 0, vx: 0, vy: 0,
      z: 0, vz: 0, // salto
      headerWindow: 0,
      fx: -ownSide(r.team), fy: 0, // hacia dónde mira
      stamina: STAMINA.max,
      exhausted: false,
      sprinting: false,
      chargeType: null, // 'ground' | 'lob'
      charge: 0,
      pending: null, // { type, power, ticks }
      prevShoot: false,
      prevLob: false,
      controlCooldown: 0,
      tackleCooldown: 0,
      action: null, // { type: 'slide' | 'fallen' | 'getup' | 'stumble', ticks, ... }
      aim: null,
      jockey: false,
      shielding: false, // cubriendo la pelota (click der. con la pelota)
      lift: 0, // altura elegida para el tiro que está cargando (0..1)
    })),
    ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, owner: null, inNet: false },
    events: [],
  }
  resetKickoff(state, 'red')
  return state
}

function resetKickoff(state, team) {
  const { field } = state
  const hw = field.width / 2
  const hh = field.height / 2
  state.phase = 'kickoff'
  state.kickoffTeam = team
  state.lastTouch = null
  state.restart = null
  Object.assign(state.ball, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, owner: null, inNet: false })
  const formation = FORMATIONS[field.perTeam]
  for (const t of ['red', 'blue']) {
    const mirror = t === 'red' ? 1 : -1
    state.players.filter((p) => p.team === t).forEach((p, i) => {
      const [fx, fy] = formation[i % formation.length]
      p.x = fx * hw * mirror
      p.y = fy * hh
      p.vx = p.vy = 0
      p.fx = mirror
      p.fy = 0
      p.chargeType = null
      p.charge = 0
      p.pending = null
      p.controlCooldown = 0
      p.tackleCooldown = 0
      p.action = null
      p.z = p.vz = 0
      p.headerWindow = 0
    })
  }
}

export function step(state, inputs) {
  state.tick++
  state.events.length = 0
  if (state.phase === 'ended') return state

  const { ball, players } = state

  for (const p of players) handleInput(state, p, inputs[p.id] || NO_INPUT)

  for (const p of players) {
    p.x += p.vx
    p.y += p.vy
    p.vx *= PLAYER.damping
    p.vy *= PLAYER.damping
    if (p.controlCooldown > 0) p.controlCooldown--
    if (p.tackleCooldown > 0) p.tackleCooldown--
    if (p.z > 0 || p.vz > 0) {
      p.vz -= JUMP.gravity
      p.z += p.vz
      if (p.z <= 0) {
        p.z = 0
        p.vz = 0
        p.headerWindow = 0
      }
    }
  }

  moveBall(state)
  for (const p of players) if (p.headerWindow > 0) tryHeader(state, p)
  for (const p of players) if (p.action && p.action.type === 'slide') slideContacts(state, p)

  const e = PLAYER.bCoef * PLAYER.bCoef
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      collideCircles(players[i], PLAYER.radius, PLAYER.invMass, players[j], PLAYER.radius, PLAYER.invMass, e)
    }
  }
  {
    for (const p of players) {
      // la pelota choca con el cuerpo si está a su altura (saltando, el cuerpo sube)
      if (ball.z >= p.z + PLAYER.height || ball.z + 2 * BALL.radius <= p.z) continue
      if (p.action && p.action.type === 'fallen') continue // tirado en el piso, la pelota pasa
      // el que la conduce no la hace rebotar: la lleva pegada; en postura defensiva, la amortigua
      const e = ball.owner === p.id ? 0 : p.jockey ? JOCKEY.bounce : PLAYER.bCoef * BALL.bCoef
      const r = PLAYER.radius + (p.jockey ? JOCKEY.blockExtra : 0)
      const pvx = p.vx
      const pvy = p.vy
      if (collideCircles(p, r, PLAYER.invMass, ball, BALL.radius, BALL.invMass, e)) {
        if (p.jockey && ball.owner !== p.id) {
          // bloqueo: el jugador queda firme y la pelota queda muerta adelante suyo
          const dx = ball.x - p.x
          const dy = ball.y - p.y
          const d = Math.hypot(dx, dy) || 1
          ball.vx = pvx * 0.5 + (dx / d) * JOCKEY.blockPush
          ball.vy = pvy * 0.5 + (dy / d) * JOCKEY.blockPush
          p.vx = pvx * 0.85
          p.vy = pvy * 0.85
        }
        touch(state, p)
      }
    }
  }

  constrainBall(state)
  for (const p of players) constrainPlayer(state, p)

  updatePossession(state)
  dribble(state)
  updateRules(state)
  return state
}

// ---------------------------------------------------------------- input / patadas

function handleInput(state, p, inp) {
  // barriéndose, en el piso o levantándose: no se controla al jugador
  if (p.action) {
    p.chargeType = null
    p.charge = 0
    p.pending = null
    p.sprinting = false
    p.jockey = false
    p.shielding = false
    p.lift = 0
    p.prevShoot = inp.shoot
    p.prevLob = inp.lob
    p.prevJump = inp.jump
    if (--p.action.ticks <= 0) p.action = p.action.type === 'slide' ? { type: 'getup', ticks: TACKLE.getupTicks } : null
    return
  }

  // Movimiento: vector (mx, my) cuyo largo (0..1) es la intensidad: poco = caminar despacio, 1 = correr.
  // Sale de la distancia de la mira al jugador (o de cuánto empujás el joystick en el celular).
  let ax = 0
  let ay = 0
  let mag = 0
  if (Number.isFinite(inp.mx) && Number.isFinite(inp.my)) {
    const len = Math.hypot(inp.mx, inp.my)
    if (len >= 0.05) {
      ax = inp.mx / len
      ay = inp.my / len
      mag = Math.min(1, len)
    }
  }
  const moving = mag > 0
  const owner = state.ball.owner === p.id

  // Cubrir (click der.): con la pelota, la protegés con el cuerpo; sin la pelota, postura defensiva
  const cover = !!inp.cover && p.z === 0 && p.vz <= 0
  p.shielding = cover && owner
  p.jockey = cover && !owner
  if (p.jockey) {
    // de frente a la pelota, moviéndose de costado
    const cur = Math.atan2(p.fy, p.fx)
    let diff = Math.atan2(state.ball.y - p.y, state.ball.x - p.x) - cur
    diff = Math.atan2(Math.sin(diff), Math.cos(diff))
    const a = cur + clamp(diff, -JOCKEY.turnRate, JOCKEY.turnRate)
    p.fx = Math.cos(a)
    p.fy = Math.sin(a)
  } else if (moving) {
    // el cuerpo gira de a poco hacia donde vas
    const cur = Math.atan2(p.fy, p.fx)
    let diff = Math.atan2(ay, ax) - cur
    diff = Math.atan2(Math.sin(diff), Math.cos(diff))
    const a = cur + clamp(diff, -PLAYER.turnRate, PLAYER.turnRate)
    p.fx = Math.cos(a)
    p.fy = Math.sin(a)
  }
  // apuntar en 360°: ángulo en radianes en coordenadas de la cancha, o null
  p.aim = typeof inp.aim === 'number' && Number.isFinite(inp.aim) ? inp.aim : null

  // Sprint: mira lejos (o joystick a fondo)
  const sprint = mag >= MOVE.sprintAt && !cover && !p.exhausted && p.stamina > 0
  if (sprint) {
    p.stamina = Math.max(0, p.stamina - STAMINA.drain)
    if (p.stamina === 0) p.exhausted = true
  } else {
    p.stamina = Math.min(STAMINA.max, p.stamina + (moving ? STAMINA.regenMoving : STAMINA.regenIdle))
    if (p.exhausted && p.stamina >= STAMINA.recover) p.exhausted = false
  }
  p.sprinting = sprint

  // caminando, la velocidad depende de qué tan lejos está la mira
  let acc = sprint ? PLAYER.sprintAccel : PLAYER.accel * clamp(mag / MOVE.sprintAt, MOVE.minMag, 1)
  if (owner) acc *= PLAYER.dribbleFactor
  if (p.jockey) acc *= JOCKEY.speedFactor
  if (p.shielding) acc *= JOCKEY.shieldSpeed
  // si querés ir contra tu inercia, frena más fuerte (cambios de dirección más ágiles)
  if (p.vx * ax + p.vy * ay < 0) acc *= PLAYER.brakeBoost
  p.vx += ax * acc
  p.vy += ay * acc

  // Patear (click izq.): un toque = pase por abajo; mantener = más potencia;
  // subir la mira mientras cargás (inp.lift, 0..1) = más altura. Sin la pelota: barrida.
  if (!p.chargeType && inp.shoot && !p.prevShoot) p.chargeType = 'kick'
  if (p.chargeType) {
    p.lift = clamp(Number(inp.lift) || 0, 0, 1)
    if (inp.shoot) {
      p.charge = Math.min(KICK.maxCharge, p.charge + 1)
    } else {
      const charge = p.charge
      const power = Math.max(1, charge) / KICK.maxCharge
      const lift = p.lift
      p.chargeType = null
      p.charge = 0
      p.lift = 0
      const ball = state.ball
      const dist = Math.hypot(ball.x - p.x, ball.y - p.y) - PLAYER.radius - BALL.radius
      const ballComing = ball.z <= KICK.maxHeight && dist <= KICK.reach + KICK.firstTimeWindow
      if (owner || ballComing) {
        // le pega ya, o apenas llegue (de primera)
        p.pending = { power, lift, ticks: KICK.buffer, aim: p.aim }
      } else {
        startSlide(p, charge / KICK.maxCharge)
      }
    }
  } else {
    p.lift = 0
  }
  p.prevShoot = inp.shoot

  if (p.pending) {
    if (state.ball.owner === p.id || inReach(p, state.ball)) {
      kickBall(state, p, p.pending.power, p.pending.lift, p.aim ?? p.pending.aim)
      p.pending = null
    } else if (--p.pending.ticks <= 0) {
      p.pending = null
    }
  }
}

// ---------------------------------------------------------------- quites y barridas

function standingTackle(state, p) {
  if (p.tackleCooldown > 0) return
  p.tackleCooldown = TACKLE.standCooldown
  const ball = state.ball
  const d = Math.hypot(ball.x - p.x, ball.y - p.y)
  const owner = ball.owner ? state.players.find((q) => q.id === ball.owner) : null
  const canTake = d <= TACKLE.standRange && ball.z < CONTROL.maxHeight && (!owner || owner.team !== p.team)
  if (!canTake) {
    p.action = { type: 'stumble', ticks: TACKLE.missTicks }
    state.events.push({ type: 'tackle', by: p.id, success: false })
    return
  }
  if (owner) owner.controlCooldown = TACKLE.victimCooldown
  ball.owner = p.id
  p.controlCooldown = 0
  touch(state, p)
  state.events.push({ type: 'tackle', by: p.id, success: true })
}

function startSlide(p, power) {
  const dx = p.aim !== null ? Math.cos(p.aim) : p.fx
  const dy = p.aim !== null ? Math.sin(p.aim) : p.fy
  const speed = TACKLE.slideMin + (TACKLE.slideMax - TACKLE.slideMin) * power
  p.fx = dx
  p.fy = dy
  p.vx = dx * speed
  p.vy = dy * speed
  p.stamina = Math.max(0, p.stamina - TACKLE.staminaCost)
  p.action = { type: 'slide', ticks: TACKLE.slideTicks, dx, dy, hitBall: false, hitPlayer: false }
  p.controlCooldown = TACKLE.slideTicks + 5
}

function slideContacts(state, p) {
  const a = p.action
  const ball = state.ball
  const speed = Math.hypot(p.vx, p.vy)
  if (!a.hitBall && ball.z < BALL.radius * 1.4 && Math.hypot(ball.x - p.x, ball.y - p.y) < PLAYER.radius + BALL.radius + TACKLE.slideBallReach) {
    const owner = ball.owner ? state.players.find((q) => q.id === ball.owner) : null
    if (owner && owner !== p) owner.controlCooldown = TACKLE.victimCooldown
    ball.owner = null
    ball.vx = a.dx * (speed + 2) + ball.vx * 0.2
    ball.vy = a.dy * (speed + 2) + ball.vy * 0.2
    a.hitBall = true
    touch(state, p)
    state.events.push({ type: 'slideBall', by: p.id })
  }
  if (a.hitPlayer || speed < 1.5) return
  for (const q of state.players) {
    if (q === p || q.team === p.team || (q.action && q.action.type === 'fallen')) continue
    if (Math.hypot(q.x - p.x, q.y - p.y) > PLAYER.radius * 2 + TACKLE.slideHitReach) continue
    q.action = { type: 'fallen', ticks: TACKLE.fallTicks }
    q.controlCooldown = TACKLE.fallTicks + 10
    q.vx += a.dx * speed * 0.3
    q.vy += a.dy * speed * 0.3
    if (ball.owner === q.id) ball.owner = null
    a.hitPlayer = true
    // si derribó al rival sin tocar antes la pelota, es falta (por ahora solo se avisa)
    state.events.push({ type: a.hitBall ? 'takedown' : 'foul', by: p.id, on: q.id })
    break
  }
}

function tryHeader(state, p) {
  p.headerWindow--
  const b = state.ball
  const rel = b.z + BALL.radius - p.z // altura del centro de la pelota respecto de los pies
  if (rel < JUMP.headMin || rel > JUMP.headMax) return
  if (Math.hypot(b.x - p.x, b.y - p.y) - PLAYER.radius - BALL.radius > JUMP.headerReach) return
  const ang = p.aim !== null ? p.aim : Math.atan2(p.fy, p.fx)
  const sp = JUMP.headerSpeed * VARIANTS[state.variant].kickMult
  b.vx = Math.cos(ang) * sp + p.vx * 0.3
  b.vy = Math.sin(ang) * sp + p.vy * 0.3
  b.vz = JUMP.headerLift
  b.owner = null
  p.headerWindow = 0
  p.headed = true // un cabezazo por salto
  p.controlCooldown = CONTROL.cooldown
  touch(state, p)
  state.events.push({ type: 'header', by: p.id })
}

function inReach(p, ball) {
  const d = Math.hypot(ball.x - p.x, ball.y - p.y)
  return d - PLAYER.radius - BALL.radius <= KICK.reach && ball.z <= KICK.maxHeight
}

// Velocidad inicial de la pelota para una patada (se usa para patear y para dibujar la trayectoria)
export function kickLaunch(state, p, power, lift, aim) {
  const ball = state.ball
  let dx, dy
  if (aim !== null && aim !== undefined) {
    dx = Math.cos(aim)
    dy = Math.sin(aim)
  } else if (ball.owner === p.id) {
    dx = p.fx
    dy = p.fy
  } else {
    dx = ball.x - p.x
    dy = ball.y - p.y
  }
  const len = Math.hypot(dx, dy) || 1
  dx /= len
  dy /= len
  const mult = VARIANTS[state.variant].kickMult
  // por abajo es más rápida; cuanto más alto, más se parece a un globo
  const ground = KICK.groundMin + (KICK.groundMax - KICK.groundMin) * power
  const lob = KICK.lobMinSpeed + (KICK.lobMaxSpeed - KICK.lobMinSpeed) * power
  const h = (ground + (lob - ground) * lift) * mult
  return {
    vx: p.vx * 0.4 + dx * h,
    vy: p.vy * 0.4 + dy * h,
    vz: lift > 0.03 ? lift * KICK.liftMax * (0.55 + 0.45 * power) : null, // null = rasante
  }
}

// Trayectoria prevista de una patada (puntos x, y, z), para dibujar la curva mientras cargás
export function predictKick(state, p, power, lift, aim, steps = 120) {
  const rules = VARIANTS[state.variant]
  const ball = state.ball
  const near = Math.hypot(ball.x - p.x, ball.y - p.y) - PLAYER.radius - BALL.radius <= KICK.reach + KICK.firstTimeWindow
  const v = kickLaunch(state, p, power, lift, aim)
  const sp = Math.hypot(v.vx - p.vx * 0.4, v.vy - p.vy * 0.4) || 1
  const ux = (v.vx - p.vx * 0.4) / sp
  const uy = (v.vy - p.vy * 0.4) / sp
  const b = near
    ? { x: ball.x, y: ball.y, z: ball.z, vx: v.vx, vy: v.vy, vz: v.vz ?? 0 }
    : { x: p.x + ux * (PLAYER.radius + BALL.radius), y: p.y + uy * (PLAYER.radius + BALL.radius), z: 0, vx: v.vx, vy: v.vy, vz: v.vz ?? 0 }
  const pts = []
  let bounces = 0
  for (let i = 0; i < steps; i++) {
    if (b.z > 0 || b.vz > 0) b.vz -= BALL.gravity
    b.x += b.vx
    b.y += b.vy
    b.z += b.vz
    if (b.z <= 0) {
      b.z = 0
      if (b.vz < -BALL.minBounce) {
        b.vz = -b.vz * BALL.bounce
        b.vx *= BALL.bounceFriction
        b.vy *= BALL.bounceFriction
        if (++bounces > 1) break
      } else b.vz = 0
    }
    const damp = b.z > 0 ? rules.airDamping : rules.groundDamping
    b.vx *= damp
    b.vy *= damp
    if (b.z === 0) {
      const s = Math.hypot(b.vx, b.vy)
      const next = s - rules.rollingFriction
      if (next <= BALL.stopSpeed) break
      b.vx *= next / s
      b.vy *= next / s
    }
    // en futsal la pelota rebota en las paredes: la curva termina ahí
    if (rules.walls && (Math.abs(b.y) + BALL.radius > state.field.height / 2 || Math.abs(b.x) + BALL.radius > state.field.width / 2)) break
    pts.push({ x: b.x, y: b.y, z: b.z })
  }
  return pts
}

function kickBall(state, p, power, lift, aim) {
  const ball = state.ball
  const v = kickLaunch(state, p, power, lift, aim)
  ball.vx = v.vx
  ball.vy = v.vy
  ball.vz = v.vz === null ? ball.vz * 0.3 : v.vz
  const type = v.vz === null ? 'ground' : lift < 0.45 ? 'mid' : 'lob'
  ball.owner = null
  p.controlCooldown = CONTROL.cooldown
  touch(state, p)
  state.events.push({ type: 'kick', kind: type, power, by: p.id })
}

function touch(state, p) {
  state.lastTouch = p.id
  if (state.phase === 'kickoff' || state.phase === 'setpiece') state.phase = 'play'
}

// ---------------------------------------------------------------- pelota

function moveBall(state) {
  const b = state.ball
  if (b.z > 0 || b.vz > 0) b.vz -= BALL.gravity
  b.x += b.vx
  b.y += b.vy
  b.z += b.vz
  if (b.z <= 0) {
    b.z = 0
    if (b.vz < -BALL.minBounce) {
      b.vz = -b.vz * BALL.bounce
      b.vx *= BALL.bounceFriction
      b.vy *= BALL.bounceFriction
      state.events.push({ type: 'bounce' })
    } else {
      b.vz = 0
    }
  }
  const rules = VARIANTS[state.variant]
  const damp = b.z > 0 ? rules.airDamping : rules.groundDamping
  b.vx *= damp
  b.vy *= damp
  // rodando, además, un frenado fijo: un pase sin potencia se queda corto y la pelota se detiene
  if (b.z === 0 && !b.owner) {
    const sp = Math.hypot(b.vx, b.vy)
    const next = sp - rules.rollingFriction
    if (next <= BALL.stopSpeed) {
      b.vx = 0
      b.vy = 0
    } else {
      b.vx *= next / sp
      b.vy *= next / sp
    }
  }
}

// Futsal: paredes tipo Haxball, la pelota nunca sale (rebota en las líneas a cualquier altura).
// Fulbo: la pelota sale; solo la frenan los carteles de afuera y la red del arco.
// En los dos, solo es gol si cruza la línea por el arco y por debajo del travesaño (ball.inNet).
function constrainBall(state) {
  const { field, ball: b } = state
  const rules = VARIANTS[state.variant]
  const r = BALL.radius
  const hw = field.width / 2
  const hh = field.height / 2
  const gw = field.goalWidth / 2
  const side = b.x >= 0 ? 1 : -1
  const ax = Math.abs(b.x)
  const inMouth = Math.abs(b.y) < gw

  if (!b.inNet && ax > hw && inMouth && b.z + r < field.crossbar) b.inNet = true

  if (rules.walls) {
    if (b.y - r < -hh) {
      b.y = -hh + r
      if (b.vy < 0) b.vy = -b.vy * rules.wallBounce
    } else if (b.y + r > hh) {
      b.y = hh - r
      if (b.vy > 0) b.vy = -b.vy * rules.wallBounce
    }
    if (!b.inNet && ax + r > hw && !(inMouth && b.z + r < field.crossbar)) {
      b.x = side * (hw - r)
      if (side * b.vx > 0) {
        b.vx = -b.vx * rules.wallBounce
        if (inMouth) state.events.push({ type: 'crossbar' })
      }
    }
  } else {
    // carteles alrededor
    const ex = hw + MARGIN
    const ey = hh + MARGIN
    if (Math.abs(b.x) + r > ex) {
      b.x = Math.sign(b.x) * (ex - r)
      b.vx = -b.vx * rules.wallBounce
    }
    if (Math.abs(b.y) + r > ey) {
      b.y = Math.sign(b.y) * (ey - r)
      b.vy = -b.vy * rules.wallBounce
    }
    // desde afuera (por el costado o por atrás) el arco es sólido
    if (!b.inNet && ax > hw && b.z < field.crossbar) {
      if (inMouth) {
        // pasó por arriba del travesaño y cae sobre el techo de la red
        b.z = field.crossbar
        if (b.vz < 0) b.vz = -b.vz * 0.3
      } else {
        collideRect(b, r, hw, -gw, hw + field.goalDepth, gw)
        collideRect(b, r, -hw - field.goalDepth, -gw, -hw, gw)
      }
    }
  }

  if (b.inNet) {
    // adentro del arco: red lateral, de fondo y "techo"
    if (ax + r > hw + field.goalDepth) {
      b.x = side * (hw + field.goalDepth - r)
      if (side * b.vx > 0) b.vx = -b.vx * NET_BOUNCE
    }
    if (b.y - r < -gw) {
      b.y = -gw + r
      if (b.vy < 0) b.vy = -b.vy * NET_BOUNCE
    } else if (b.y + r > gw) {
      b.y = gw - r
      if (b.vy > 0) b.vy = -b.vy * NET_BOUNCE
    }
    if (b.z + 2 * r > field.crossbar) {
      b.z = Math.max(0, field.crossbar - 2 * r)
      if (b.vz > 0) b.vz = -b.vz * 0.3
    }
  }

  if (b.z < field.crossbar) {
    for (const px of [-hw, hw]) {
      for (const py of [-gw, gw]) {
        if (collideStatic(b, r, px, py, POST_RADIUS, POST_BOUNCE)) state.events.push({ type: 'post' })
      }
    }
  }
}

// ---------------------------------------------------------------- posesión / conducción

function updatePossession(state) {
  const { ball: b, players } = state
  if (b.z > CONTROL.maxHeight) {
    b.owner = null
    return
  }
  const base = PLAYER.radius + BALL.radius + CONTROL.radius
  let owner = null
  let ownerDist = Infinity
  if (b.owner) {
    owner = players.find((p) => p.id === b.owner) || null
    if (owner) {
      ownerDist = Math.hypot(b.x - owner.x, b.y - owner.y)
      if (ownerDist > base + CONTROL.keepExtra) {
        owner = null
        ownerDist = Infinity
      }
    }
  }

  let best = null
  let bestDist = Infinity
  for (const p of players) {
    if (p === owner || p.controlCooldown > 0 || p.action || p.z > 0) continue
    const d = Math.hypot(b.x - p.x, b.y - p.y)
    if (d > base || d >= bestDist) continue
    if (Math.hypot(b.vx - p.vx, b.vy - p.vy) > CONTROL.maxTrapSpeed) continue
    best = p
    bestDist = d
  }

  const margin = CONTROL.stealMargin + (owner && owner.shielding ? JOCKEY.shieldMargin : 0)
  if (best && (!owner || bestDist + margin < ownerDist)) {
    if (owner) owner.controlCooldown = CONTROL.cooldown // al que se la roban no la recupera al instante
    owner = best
    state.events.push({ type: 'possession', by: best.id })
  }

  b.owner = owner ? owner.id : null
  if (owner) {
    touch(state, owner)
    if (state.phase === 'play') state.possession[owner.team]++
  }
}

function dribble(state) {
  const b = state.ball
  if (!b.owner) return
  const p = state.players.find((q) => q.id === b.owner)
  const lead = PLAYER.radius + BALL.radius + 2 + (p.sprinting ? CONTROL.sprintLead : 0)
  const tx = p.x + p.fx * lead
  const ty = p.y + p.fy * lead
  let px = (tx - b.x) * CONTROL.pull + (p.vx - b.vx) * CONTROL.match
  let py = (ty - b.y) * CONTROL.pull + (p.vy - b.vy) * CONTROL.match
  const m = Math.hypot(px, py)
  if (m > CONTROL.maxPull) {
    px *= CONTROL.maxPull / m
    py *= CONTROL.maxPull / m
  }
  b.vx += px
  b.vy += py
}

// ---------------------------------------------------------------- jugadores

function constrainPlayer(state, p) {
  const { field } = state
  const r = PLAYER.radius
  const hw = field.width / 2
  const hh = field.height / 2
  const gw = field.goalWidth / 2

  const m = VARIANTS[state.variant].playerMargin
  p.x = clamp(p.x, -hw - m + r, hw + m - r)
  p.y = clamp(p.y, -hh - m + r, hh + m - r)

  // los arcos son sólidos para los jugadores
  collideRect(p, r, hw, -gw, hw + field.goalDepth, gw)
  collideRect(p, r, -hw - field.goalDepth, -gw, -hw, gw)
  for (const px of [-hw, hw]) for (const py of [-gw, gw]) collideStatic(p, r, px, py, POST_RADIUS, 0)

  if (state.phase === 'kickoff') {
    const own = ownSide(p.team)
    if (p.x * own < 0) {
      p.x = 0
      p.vx = 0
    }
    if (p.team !== state.kickoffTeam) {
      const R = field.kickoffRadius + r
      const d = Math.hypot(p.x, p.y)
      if (d < R) {
        const nx = d ? p.x / d : own
        const ny = d ? p.y / d : 0
        p.x = nx * R
        p.y = ny * R
      }
    }
  }

  // en un saque (lateral, córner, saque de arco) los rivales se alejan de la pelota
  if (state.phase === 'setpiece' && p.team !== state.restart.team) {
    const b = state.ball
    const R = SETPIECE_RADIUS + r
    const dx = p.x - b.x
    const dy = p.y - b.y
    const d = Math.hypot(dx, dy)
    if (d < R) {
      const nx = d ? dx / d : 1
      const ny = d ? dy / d : 0
      p.x = b.x + nx * R
      p.y = b.y + ny * R
    }
  }
}

// ---------------------------------------------------------------- reglas

function updateRules(state) {
  const { field, ball } = state
  const hw = field.width / 2
  const gw = field.goalWidth / 2

  if (state.phase === 'play' || state.phase === 'kickoff' || state.phase === 'setpiece') {
    if (ball.inNet && Math.abs(ball.x) - BALL.radius > hw && Math.abs(ball.y) < gw) {
      const team = ball.x > 0 ? 'red' : 'blue'
      state.score[team]++
      const scorer = state.players.find((p) => p.id === state.lastTouch)
      state.lastGoal = { team, scorer: scorer ? scorer.name : null, own: scorer ? scorer.team !== team : false }
      state.phase = 'goal'
      state.phaseTimer = GOAL_PAUSE_TICKS
      ball.owner = null
      state.events.push({ type: 'goal', team })
      return
    }
  }

  if (state.phase === 'play' && !VARIANTS[state.variant].walls && checkOut(state)) return

  if (state.phase === 'out') {
    if (--state.phaseTimer <= 0) placeRestart(state)
  } else if (state.phase === 'play') {
    state.time++
    if (!state.overtime && state.time >= MATCH_TICKS) {
      if (state.score.red === state.score.blue) {
        state.overtime = true
        state.events.push({ type: 'overtime' })
      } else {
        endMatch(state)
      }
    }
  } else if (state.phase === 'goal') {
    if (--state.phaseTimer <= 0) {
      if (state.overtime || state.time >= MATCH_TICKS) endMatch(state)
      else resetKickoff(state, state.lastGoal.team === 'red' ? 'blue' : 'red')
    }
  }
}

// Fulbo: ¿salió la pelota? Lateral para el rival del último que la tocó; por el fondo,
// córner si la tocó un defensor, saque de arco si la tocó un atacante.
function checkOut(state) {
  const { field, ball } = state
  const r = BALL.radius
  const hw = field.width / 2
  const hh = field.height / 2
  const other = (t) => (t === 'red' ? 'blue' : 'red')
  const last = state.players.find((p) => p.id === state.lastTouch)
  const lastTeam = last ? last.team : null
  let restart = null

  if (Math.abs(ball.y) - r > hh) {
    restart = { type: 'lateral', team: lastTeam ? other(lastTeam) : 'red', x: clamp(ball.x, -hw + 20, hw - 20), y: Math.sign(ball.y) * hh }
  } else if (Math.abs(ball.x) - r > hw && !ball.inNet) {
    const sx = Math.sign(ball.x)
    const sy = Math.sign(ball.y) || 1
    const defending = sx > 0 ? 'blue' : 'red'
    if (lastTeam === defending) {
      restart = { type: 'corner', team: other(defending), x: sx * hw, y: sy * hh }
    } else {
      restart = { type: 'goalkick', team: defending, x: sx * (hw - field.areaDepth * 0.6), y: sy * field.areaHeight * 0.25 }
    }
  }
  if (!restart) return false

  state.restart = restart
  state.phase = 'out'
  state.phaseTimer = OUT_PAUSE_TICKS
  ball.owner = null
  state.events.push({ type: 'out', restart: restart.type, team: restart.team })
  return true
}

function placeRestart(state) {
  const R = state.restart
  Object.assign(state.ball, { x: R.x, y: R.y, z: 0, vx: 0, vy: 0, vz: 0, owner: null, inNet: false })
  state.phase = 'setpiece'
  state.lastTouch = null
  for (const p of state.players) {
    p.pending = null
    p.chargeType = null
    p.charge = 0
  }
}

function endMatch(state) {
  state.phase = 'ended'
  const { red, blue } = state.score
  state.winner = red > blue ? 'red' : blue > red ? 'blue' : null
  state.events.push({ type: 'end' })
}

// ---------------------------------------------------------------- colisiones

function collideCircles(a, ra, ima, b, rb, imb, e) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d2 = dx * dx + dy * dy
  const R = ra + rb
  if (d2 >= R * R || d2 === 0) return false
  const d = Math.sqrt(d2)
  const nx = dx / d
  const ny = dy / d
  const pen = R - d
  const tot = ima + imb
  a.x -= nx * pen * (ima / tot)
  a.y -= ny * pen * (ima / tot)
  b.x += nx * pen * (imb / tot)
  b.y += ny * pen * (imb / tot)
  const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
  if (rv < 0) {
    const j = (-(1 + e) * rv) / tot
    a.vx -= nx * j * ima
    a.vy -= ny * j * ima
    b.vx += nx * j * imb
    b.vy += ny * j * imb
  }
  return true
}

function collideStatic(o, r, cx, cy, cr, e) {
  const dx = o.x - cx
  const dy = o.y - cy
  const d2 = dx * dx + dy * dy
  const R = r + cr
  if (d2 >= R * R || d2 === 0) return false
  const d = Math.sqrt(d2)
  const nx = dx / d
  const ny = dy / d
  o.x = cx + nx * R
  o.y = cy + ny * R
  const vn = o.vx * nx + o.vy * ny
  if (vn < 0) {
    o.vx -= (1 + e) * vn * nx
    o.vy -= (1 + e) * vn * ny
  }
  return true
}

function collideRect(o, r, x0, y0, x1, y1) {
  const cx = clamp(o.x, x0, x1)
  const cy = clamp(o.y, y0, y1)
  const dx = o.x - cx
  const dy = o.y - cy
  const d2 = dx * dx + dy * dy
  let nx, ny
  if (d2 > 0) {
    if (d2 >= r * r) return
    const d = Math.sqrt(d2)
    nx = dx / d
    ny = dy / d
    o.x = cx + nx * r
    o.y = cy + ny * r
  } else {
    // el centro quedó adentro: salir por el lado más cercano
    const opts = [
      [o.x - x0, -1, 0],
      [x1 - o.x, 1, 0],
      [o.y - y0, 0, -1],
      [y1 - o.y, 0, 1],
    ].sort((a, b) => a[0] - b[0])
    ;[, nx, ny] = opts[0]
    if (nx) o.x = nx < 0 ? x0 - r : x1 + r
    else o.y = ny < 0 ? y0 - r : y1 + r
  }
  const vn = o.vx * nx + o.vy * ny
  if (vn < 0) {
    o.vx -= vn * nx
    o.vy -= vn * ny
  }
}
