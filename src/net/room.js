// Salas online. El host es la autoridad: guarda la sala, corre la física y reparte el estado.
// Mensajes (JSON):
//   cliente → host: hello-less (el nombre va en la conexión) · {t:'team', team} · {t:'chat', text} · {t:'i', s, i} (input)
//   host → cliente: {t:'welcome', you} · {t:'lobby', room} · {t:'start', match} · {t:'end'} · {t:'chat', from, text}
//                   {t:'s', ...} (snapshot) · {t:'kick'} · {t:'reject', reason}
import { FIELDS } from '../game/constants.js'
import { clientId } from './supabase.js'
import { advertiseRoom, stopAdvertising } from './lobby.js'
import { listenForPeers, connectToHost } from './rtc.js'

const BOT_NAMES = ['Tito', 'Pipa', 'Chino', 'Cholo', 'Beto', 'Lalo', 'Nacho', 'Tucu', 'Ruso', 'Flaco']
const MAX_SPECTATORS = 4
const cleanName = (s) => String(s || '').trim().slice(0, 14) || 'Jugador'
const cleanText = (s) => String(s || '').trim().slice(0, 200)

function createEmitter() {
  const fns = new Set()
  return {
    on(fn) {
      fns.add(fn)
      return () => fns.delete(fn)
    },
    emit(ev) {
      for (const fn of fns) fn(ev)
    },
  }
}

// Arma el plantel del partido: humanos de cada equipo y, si corresponde, bots hasta completar.
// En cada equipo los bots van primero, así los humanos quedan en los puestos más adelantados.
export function buildMatchRoster(room) {
  const perTeam = FIELDS[room.mode].perTeam
  const roster = []
  let k = 0
  for (const team of ['red', 'blue']) {
    const humans = room.players.filter((p) => p.team === team).slice(0, perTeam)
    const bots = room.fillBots ? perTeam - humans.length : 0
    for (let i = 0; i < bots; i++) roster.push({ id: `bot${k}`, name: BOT_NAMES[k++ % BOT_NAMES.length], team, isBot: true })
    for (const h of humans) roster.push({ id: h.id, name: h.name, team, isBot: false })
  }
  return roster
}

// ---------------------------------------------------------------- host

export function createRoomHost({ name, hostName, mode, variant, isPrivate = false }) {
  const events = createEmitter()
  const room = {
    id: clientId,
    name: cleanText(name) || `Sala de ${cleanName(hostName)}`,
    hostId: clientId,
    mode,
    variant,
    fillBots: true,
    private: !!isPrivate, // privada: no aparece en la lista, solo se entra con el link
    started: false,
    createdAt: Date.now(),
    players: [{ id: clientId, name: cleanName(hostName), team: 'red' }],
  }
  const conns = new Map() // peerId → conexión
  const inputs = new Map() // peerId → { s, i }
  let match = null
  let closed = false

  const perTeam = () => FIELDS[room.mode].perTeam
  const count = (team) => room.players.filter((p) => p.team === team).length

  function publicRoom() {
    return { ...room, players: room.players.map((p) => ({ ...p })) }
  }

  function changed() {
    if (closed) return
    const snapshot = publicRoom()
    for (const c of conns.values()) c.sendReliable({ t: 'lobby', room: snapshot })
    if (room.private) stopAdvertising()
    else advertiseRoom({
      id: room.id,
      name: room.name,
      host: room.players.find((p) => p.id === room.hostId)?.name,
      mode: room.mode,
      variant: room.variant,
      humans: room.players.filter((p) => p.team !== 'spec').length,
      max: perTeam() * 2,
      started: room.started,
      createdAt: room.createdAt,
    })
    events.emit({ type: 'lobby', room: snapshot })
  }

  function chat(from, text) {
    const msg = { t: 'chat', from, text: cleanText(text) }
    if (!msg.text) return
    for (const c of conns.values()) c.sendReliable(msg)
    events.emit({ type: 'chat', from, text: msg.text })
  }

  function pickTeam() {
    const red = count('red')
    const blue = count('blue')
    if (red < perTeam() && red <= blue) return 'red'
    if (blue < perTeam()) return 'blue'
    if (red < perTeam()) return 'red'
    return 'spec'
  }

  function setTeam(id, team) {
    const p = room.players.find((q) => q.id === id)
    if (!p || room.started || p.team === team) return
    if (team !== 'spec' && count(team) >= perTeam()) return
    p.team = team
    changed()
  }

  function removePlayer(id) {
    const conn = conns.get(id)
    conns.delete(id)
    inputs.delete(id)
    const p = room.players.find((q) => q.id === id)
    room.players = room.players.filter((q) => q.id !== id)
    if (conn) conn.close()
    if (p) chat(null, `${p.name} salió de la sala`)
    changed()
  }

  const listener = listenForPeers(room.id, (peerId, conn, meta) => {
    if (closed) return conn.close()
    const spectators = count('spec')
    const team = pickTeam()
    if (team === 'spec' && spectators >= MAX_SPECTATORS) {
      conn.sendReliable({ t: 'reject', reason: 'La sala está llena' })
      setTimeout(() => conn.close(), 500)
      return
    }
    const player = { id: peerId, name: cleanName(meta.name), team: room.started ? 'spec' : team }
    room.players.push(player)
    conns.set(peerId, conn)
    conn.onMessage((m) => {
      if (m.t === 'i') {
        const prev = inputs.get(peerId)
        if (!prev || m.s > prev.s) inputs.set(peerId, m)
      } else if (m.t === 'team') {
        setTeam(peerId, m.team)
      } else if (m.t === 'chat') {
        chat(player.name, m.text)
      }
    })
    conn.onClose(() => removePlayer(peerId))
    conn.sendReliable({ t: 'welcome', you: peerId })
    if (room.started && match) conn.sendReliable({ t: 'start', match })
    chat(null, `${player.name} entró a la sala`)
    changed()
  })

  changed()

  return {
    isHost: true,
    localId: clientId,
    ready: listener.ready,
    getRoom: publicRoom,
    getMatch: () => match,
    on: events.on,
    setTeam: (team) => setTeam(clientId, team),
    sendChat: (text) => chat(room.players.find((p) => p.id === clientId)?.name, text),
    setSettings(patch) {
      if (room.started) return
      if (patch.mode && FIELDS[patch.mode]) {
        room.mode = patch.mode
        // si achicás la cancha, los que sobran pasan a espectadores
        for (const team of ['red', 'blue']) {
          room.players.filter((p) => p.team === team).slice(perTeam()).forEach((p) => (p.team = 'spec'))
        }
      }
      if (patch.variant) room.variant = patch.variant
      if (typeof patch.fillBots === 'boolean') room.fillBots = patch.fillBots
      if (typeof patch.private === 'boolean') room.private = patch.private
      if (typeof patch.name === 'string') room.name = cleanText(patch.name) || room.name
      changed()
    },
    kick(id) {
      if (id === clientId) return
      const conn = conns.get(id)
      if (conn) conn.sendReliable({ t: 'kick' })
      setTimeout(() => removePlayer(id), 200)
    },
    startMatch() {
      if (room.started) return
      match = { mode: room.mode, variant: room.variant, roster: buildMatchRoster(room) }
      room.started = true
      for (const c of conns.values()) c.sendReliable({ t: 'start', match })
      changed()
      events.emit({ type: 'start', match })
    },
    endMatch() {
      if (!room.started) return
      room.started = false
      match = null
      for (const c of conns.values()) c.sendReliable({ t: 'end' })
      changed()
      events.emit({ type: 'end' })
    },
    // --- durante el partido
    getInput: (id) => inputs.get(id)?.i || null,
    isConnected: (id) => id === clientId || conns.has(id),
    broadcastSnapshot(snap) {
      for (const c of conns.values()) c.sendFast(snap)
    },
    close() {
      closed = true
      stopAdvertising()
      for (const c of conns.values()) c.close()
      conns.clear()
      listener.close()
    },
  }
}

// ---------------------------------------------------------------- cliente

export async function joinRoom(roomId, playerName) {
  const conn = await connectToHost(roomId, clientId, { name: cleanName(playerName) })
  const events = createEmitter()
  let room = null
  let match = null
  let seq = 0
  let left = false
  const snaps = [] // los dos últimos snapshots con su hora de llegada

  const firstLobby = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('El host no respondió')), 8000)
    conn.onMessage((m) => {
      if (m.t === 'lobby') {
        room = m.room
        clearTimeout(timer)
        resolve()
        events.emit({ type: 'lobby', room })
      } else if (m.t === 's') {
        const last = snaps[snaps.length - 1]
        if (last && m.k <= last.snap.k) return // llegó tarde o desordenado
        snaps.push({ snap: m, at: performance.now() })
        if (snaps.length > 2) snaps.shift()
      } else if (m.t === 'start') {
        match = m.match
        snaps.length = 0
        events.emit({ type: 'start', match })
      } else if (m.t === 'end') {
        match = null
        events.emit({ type: 'end' })
      } else if (m.t === 'chat') {
        events.emit({ type: 'chat', from: m.from, text: m.text })
      } else if (m.t === 'kick') {
        left = true
        events.emit({ type: 'closed', reason: 'El host te sacó de la sala' })
      } else if (m.t === 'reject') {
        clearTimeout(timer)
        left = true
        reject(new Error(m.reason))
      }
    })
  })
  conn.onClose(() => {
    if (!left) events.emit({ type: 'closed', reason: 'Se cerró la sala o se perdió la conexión con el host' })
    left = true
  })

  try {
    await firstLobby
  } catch (err) {
    conn.close()
    throw err
  }

  return {
    isHost: false,
    localId: clientId,
    getRoom: () => room,
    getMatch: () => match,
    on: events.on,
    setTeam: (team) => conn.sendReliable({ t: 'team', team }),
    sendChat: (text) => conn.sendReliable({ t: 'chat', text }),
    sendInput: (input) => conn.sendFast({ t: 'i', s: ++seq, i: input }),
    getSnapshots: () => snaps,
    close() {
      left = true
      conn.close()
    },
  }
}
