// Links de invitación: ?sala=<código>. El código es el id de la sala (el id del host).
const PARAM = 'sala'

export function inviteUrl(roomId) {
  const url = new URL(location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set(PARAM, roomId)
  return url.toString()
}

// Acepta un código suelto o un link entero pegado
export function parseRoomCode(text) {
  const t = String(text || '').trim()
  if (!t) return null
  try {
    const code = new URL(t).searchParams.get(PARAM)
    if (code) return code
  } catch {
    // no es un link: es un código
  }
  return /^[a-z0-9]{6,32}$/i.test(t) ? t : null
}

export function roomCodeFromUrl() {
  return new URLSearchParams(location.search).get(PARAM)
}

// Mientras estás en una sala, la barra de direcciones muestra su link (así se puede copiar de ahí)
export function setUrlRoom(roomId) {
  const url = roomId ? inviteUrl(roomId) : location.pathname
  history.replaceState(null, '', url)
}
