// Estado compacto que el host manda a los clientes (~30 veces por segundo).
// Los clientes lo aplican sobre un estado creado con createMatch() para poder dibujarlo.

const r2 = (v) => Math.round(v * 100) / 100
const r3 = (v) => Math.round(v * 1000) / 1000

export function encodeSnapshot(state) {
  const b = state.ball
  return {
    t: 's',
    k: state.tick,
    ph: state.phase,
    pt: state.phaseTimer,
    tm: state.time,
    ot: state.overtime,
    ko: state.kickoffTeam,
    sc: [state.score.red, state.score.blue],
    po: [state.possession.red, state.possession.blue],
    lg: state.lastGoal,
    w: state.winner,
    rs: state.restart,
    b: [r2(b.x), r2(b.y), r2(b.z), r2(b.vx), r2(b.vy), r2(b.vz), b.owner, b.inNet ? 1 : 0],
    p: state.players.map((p) => [
      p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.vx), r2(p.vy), r3(p.fx), r3(p.fy),
      Math.round(p.stamina), p.exhausted ? 1 : 0, p.sprinting ? 1 : 0, p.chargeType, p.charge,
      p.action ? p.action.type : null, p.action ? p.action.ticks : 0, p.aim === null ? null : r3(p.aim), p.jockey ? 1 : 0,
    ]),
  }
}

// Aplica el snapshot `to`, interpolando posiciones desde `from` (alpha 0..1) para que se vea suave.
export function applySnapshot(state, to, from = null, alpha = 1) {
  const lerp = (a, b) => (from ? a + (b - a) * alpha : b)
  state.tick = to.k
  state.phase = to.ph
  state.phaseTimer = to.pt
  state.time = to.tm
  state.overtime = to.ot
  state.kickoffTeam = to.ko
  state.score.red = to.sc[0]
  state.score.blue = to.sc[1]
  state.possession.red = to.po[0]
  state.possession.blue = to.po[1]
  state.lastGoal = to.lg
  state.winner = to.w
  state.restart = to.rs

  const b = state.ball
  const fb = from ? from.b : null
  const big = fb && Math.hypot(to.b[0] - fb[0], to.b[1] - fb[1]) > 80 // teletransporte (saque, gol): no interpolar
  b.x = big || !fb ? to.b[0] : lerp(fb[0], to.b[0])
  b.y = big || !fb ? to.b[1] : lerp(fb[1], to.b[1])
  b.z = big || !fb ? to.b[2] : lerp(fb[2], to.b[2])
  b.vx = to.b[3]
  b.vy = to.b[4]
  b.vz = to.b[5]
  b.owner = to.b[6]
  b.inNet = !!to.b[7]

  const prev = new Map()
  if (from) for (const row of from.p) prev.set(row[0], row)
  for (const row of to.p) {
    const p = state.players.find((q) => q.id === row[0])
    if (!p) continue
    const f = prev.get(row[0])
    const jump = f && Math.hypot(row[1] - f[1], row[2] - f[2]) > 80
    p.x = f && !jump ? lerp(f[1], row[1]) : row[1]
    p.y = f && !jump ? lerp(f[2], row[2]) : row[2]
    p.z = f && !jump ? lerp(f[3], row[3]) : row[3]
    p.vx = row[4]
    p.vy = row[5]
    p.fx = row[6]
    p.fy = row[7]
    p.stamina = row[8]
    p.exhausted = !!row[9]
    p.sprinting = !!row[10]
    p.chargeType = row[11]
    p.charge = row[12]
    p.action = row[13] ? { type: row[13], ticks: row[14] } : null
    p.aim = row[15]
    p.jockey = !!row[16]
  }
}
