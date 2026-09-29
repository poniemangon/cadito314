// Conexiones WebRTC entre jugadores. La señalización (offer/answer/ICE) viaja por un canal
// broadcast de Supabase propio de cada sala; después, todo va directo entre navegadores.
import { supabase } from './supabase.js'

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }]
const CONNECT_TIMEOUT = 15000

function signalingChannel(roomId, myId, onSignal) {
  const ch = supabase.channel(`picadito:room:${roomId}`, { config: { broadcast: { self: false } } })
  ch.on('broadcast', { event: 'sig' }, ({ payload }) => {
    if (payload && payload.to === myId) onSignal(payload)
  })
  const ready = new Promise((resolve, reject) => {
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve()
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error('No se pudo conectar al servidor de salas'))
    })
  })
  return {
    ready,
    send: (to, kind, data) => ch.send({ type: 'broadcast', event: 'sig', payload: { to, from: myId, kind, data } }),
    close: () => supabase.removeChannel(ch),
  }
}

// Envuelve un RTCPeerConnection con dos canales: 'r' (confiable, ordenado) y 'u' (rápido, puede perder paquetes).
function wrapConnection(pc, reliable, fast) {
  let onMessage = null
  let onClose = null
  let closed = false
  const early = [] // mensajes que llegan antes de que alguien escuche
  const handle = (e) => {
    let msg
    try {
      msg = JSON.parse(e.data)
    } catch {
      return
    }
    if (onMessage) onMessage(msg)
    else early.push(msg)
  }
  const finish = () => {
    if (closed) return
    closed = true
    if (onClose) onClose()
  }
  reliable.onmessage = handle
  fast.onmessage = handle
  reliable.onclose = finish
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') finish()
  })
  return {
    sendReliable(msg) {
      if (reliable.readyState === 'open') reliable.send(JSON.stringify(msg))
    },
    sendFast(msg) {
      if (fast.readyState === 'open') fast.send(JSON.stringify(msg))
    },
    onMessage(fn) {
      onMessage = fn
      while (early.length) fn(early.shift())
    },
    onClose(fn) {
      onClose = fn
    },
    get isOpen() {
      return !closed && reliable.readyState === 'open'
    },
    close() {
      try {
        pc.close()
      } catch {
        // ya estaba cerrada
      }
      finish()
    },
  }
}

// Host: acepta conexiones entrantes. onConnection(peerId, connection, meta)
export function listenForPeers(roomId, onConnection) {
  const pending = new Map() // peerId → { pc, iceQueue }
  const sig = signalingChannel(roomId, roomId, async (msg) => {
    if (msg.kind === 'offer') {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      const entry = { pc, iceQueue: [], channels: {} }
      pending.set(msg.from, entry)
      pc.onicecandidate = (e) => e.candidate && sig.send(msg.from, 'ice', e.candidate.toJSON())
      pc.ondatachannel = (e) => {
        const ch = e.channel
        entry.channels[ch.label] = ch
        ch.onopen = () => {
          const { r, u } = entry.channels
          if (r && u && r.readyState === 'open' && u.readyState === 'open' && !entry.done) {
            entry.done = true
            pending.delete(msg.from)
            onConnection(msg.from, wrapConnection(pc, r, u), msg.data.meta || {})
          }
        }
      }
      try {
        await pc.setRemoteDescription(msg.data.sdp)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        sig.send(msg.from, 'answer', { sdp: pc.localDescription.toJSON() })
        for (const c of entry.iceQueue) pc.addIceCandidate(c).catch(() => {})
        entry.iceQueue = null
      } catch {
        pc.close()
        pending.delete(msg.from)
      }
    } else if (msg.kind === 'ice') {
      const entry = pending.get(msg.from)
      if (!entry) return
      if (entry.iceQueue) entry.iceQueue.push(msg.data)
      else entry.pc.addIceCandidate(msg.data).catch(() => {})
    }
  })
  return {
    ready: sig.ready,
    close() {
      for (const { pc } of pending.values()) pc.close()
      sig.close()
    },
  }
}

// Cliente: se conecta al host de la sala.
export async function connectToHost(roomId, myId, meta) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  const reliable = pc.createDataChannel('r')
  const fast = pc.createDataChannel('u', { ordered: false, maxRetransmits: 0 })
  let iceQueue = []
  const sig = signalingChannel(roomId, myId, async (msg) => {
    if (msg.kind === 'answer') {
      await pc.setRemoteDescription(msg.data.sdp)
      for (const c of iceQueue) pc.addIceCandidate(c).catch(() => {})
      iceQueue = null
    } else if (msg.kind === 'ice') {
      if (iceQueue) iceQueue.push(msg.data)
      else pc.addIceCandidate(msg.data).catch(() => {})
    }
  })

  try {
    await sig.ready
    pc.onicecandidate = (e) => e.candidate && sig.send(roomId, 'ice', e.candidate.toJSON())
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    sig.send(roomId, 'offer', { sdp: pc.localDescription.toJSON(), meta })

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No se pudo conectar con el host (¿la sala sigue abierta?)')), CONNECT_TIMEOUT)
      const check = () => {
        if (reliable.readyState === 'open' && fast.readyState === 'open') {
          clearTimeout(timer)
          resolve()
        }
      }
      reliable.onopen = check
      fast.onopen = check
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'failed') {
          clearTimeout(timer)
          reject(new Error('Falló la conexión con el host (red bloqueada o NAT estricto)'))
        }
      })
    })
  } catch (err) {
    pc.close()
    sig.close()
    throw err
  }
  sig.close() // ya conectados: la señalización no hace falta más
  return wrapConnection(pc, reliable, fast)
}
