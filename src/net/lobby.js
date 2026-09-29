// Lista de salas con Supabase Presence: cada host "trackea" su sala en un canal compartido.
// Cuando el host cierra la pestaña o se desconecta, la sala desaparece sola.
import { supabase, clientId } from './supabase.js'

let channel = null
let ready = false
let myRoom = null
const listeners = new Set()

function listRooms() {
  if (!channel) return []
  const state = channel.presenceState()
  const rooms = []
  for (const key in state) for (const meta of state[key]) if (meta.room) rooms.push(meta.room)
  return rooms.sort((a, b) => a.createdAt - b.createdAt)
}

function ensureChannel() {
  if (channel) return
  channel = supabase.channel('picadito:lobby', { config: { presence: { key: clientId } } })
  channel.on('presence', { event: 'sync' }, () => {
    const rooms = listRooms()
    for (const fn of listeners) fn(rooms)
  })
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      ready = true
      if (myRoom) channel.track({ room: myRoom })
    }
  })
}

export function watchRooms(fn) {
  ensureChannel()
  listeners.add(fn)
  fn(listRooms())
  return () => listeners.delete(fn)
}

export function advertiseRoom(room) {
  ensureChannel()
  myRoom = room
  if (ready) channel.track({ room })
}

export function stopAdvertising() {
  myRoom = null
  if (channel && ready) channel.untrack()
}
