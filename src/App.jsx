import { useEffect, useMemo, useState } from 'react'
import Game from './Game.jsx'
import Rooms from './Rooms.jsx'
import RoomLobby from './RoomLobby.jsx'
import { FIELDS, VARIANTS } from './game/constants.js'
import { onlineAvailable } from './net/supabase.js'
import { createRoomHost, joinRoom } from './net/room.js'

// Solo en desarrollo: ?play=3v3&variant=fulbo arranca el partido directo (útil para probar).
const devParams = import.meta.env.DEV ? new URLSearchParams(location.search) : new URLSearchParams()
const devPlay = devParams.get('play')
const devVariant = devParams.get('variant')

export default function App() {
  const [screen, setScreen] = useState(devPlay in FIELDS ? 'game' : 'menu')
  const [mode, setMode] = useState(devPlay in FIELDS ? devPlay : '1v1')
  const [variant, setVariant] = useState(() => devVariant || (localStorage.getItem('picadito:variant') === 'fulbo' ? 'fulbo' : 'futsal'))
  const [team, setTeam] = useState('red')
  const [name, setName] = useState(() => localStorage.getItem('picadito:name') || '')
  const [withBots, setWithBots] = useState(true)
  const [view3d, setView3d] = useState(() => localStorage.getItem('picadito:view') !== '2d')
  const [relativeMove, setRelativeMove] = useState(() => localStorage.getItem('picadito:move') !== 'fixed')

  // --- online
  const [session, setSession] = useState(null) // host o cliente (net/room.js)
  const [onlineMatch, setOnlineMatch] = useState(null)
  const [chat, setChat] = useState([])
  const [netError, setNetError] = useState('')
  const [busy, setBusy] = useState(false)
  const online = useMemo(() => (session && onlineMatch ? { session, match: onlineMatch } : null), [session, onlineMatch])

  useEffect(() => {
    if (!session) return
    return session.on((ev) => {
      if (ev.type === 'chat') setChat((c) => [...c.slice(-100), { from: ev.from, text: ev.text }])
      else if (ev.type === 'start') {
        setOnlineMatch(ev.match)
        setScreen('online')
      } else if (ev.type === 'end') {
        setOnlineMatch(null)
        setScreen('room')
      } else if (ev.type === 'closed') {
        session.close()
        setSession(null)
        setOnlineMatch(null)
        setNetError(ev.reason)
        setScreen('rooms')
      }
    })
  }, [session])

  const leaveRoom = () => {
    if (session) session.close()
    setSession(null)
    setOnlineMatch(null)
    setChat([])
    setScreen('rooms')
  }

  const createRoom = async (opts) => {
    setBusy(true)
    setNetError('')
    try {
      const host = createRoomHost({ ...opts, hostName: name.trim() })
      await host.ready
      setChat([])
      setSession(host)
      setScreen('room')
    } catch (err) {
      setNetError(err.message || 'No se pudo crear la sala')
    } finally {
      setBusy(false)
    }
  }

  const enterRoom = async (roomId) => {
    setBusy(true)
    setNetError('')
    try {
      const client = await joinRoom(roomId, name.trim())
      setChat([])
      setSession(client)
      setOnlineMatch(client.getMatch()) // si el partido ya empezó, entrás como espectador
      setScreen('room')
    } catch (err) {
      setNetError(err.message || 'No se pudo entrar a la sala')
    } finally {
      setBusy(false)
    }
  }

  if (screen === 'game') {
    return <Game mode={mode} variant={variant} team={team} name={name.trim()} withBots={withBots} view3d={view3d} relativeMove={relativeMove} onExit={() => setScreen('menu')} />
  }

  if (screen === 'online' && online) {
    // host: Esc termina el partido para todos · cliente: Esc vuelve al menú de la sala
    const exit = () => (session.isHost ? session.endMatch() : setScreen('room'))
    return <Game view3d={view3d} relativeMove={relativeMove} online={online} onExit={exit} />
  }

  if (screen === 'rooms') {
    return <Rooms name={name.trim()} busy={busy} error={netError} onJoin={enterRoom} onCreate={createRoom} onBack={() => setScreen('menu')} />
  }

  if (screen === 'room' && session) {
    return <RoomLobby session={session} chat={chat} onLeave={leaveRoom} onWatch={() => setScreen('online')} />
  }

  const start = (e) => {
    e.preventDefault()
    localStorage.setItem('picadito:name', name.trim())
    localStorage.setItem('picadito:variant', variant)
    localStorage.setItem('picadito:view', view3d ? '3d' : '2d')
    localStorage.setItem('picadito:move', relativeMove ? 'mouse' : 'fixed')
    setScreen('game')
  }

  const goOnline = () => {
    localStorage.setItem('picadito:name', name.trim())
    localStorage.setItem('picadito:view', view3d ? '3d' : '2d')
    localStorage.setItem('picadito:move', relativeMove ? 'mouse' : 'fixed')
    setScreen('rooms')
  }

  return (
    <div className="screen">
    <form className="menu" onSubmit={start}>
      <h1>Picadito</h1>

      <label className="field">
        <span>Tu nombre</span>
        <input value={name} maxLength={14} placeholder="Jugador" onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="field">
        <span>Modalidad</span>
        <div className="options">
          {Object.entries(VARIANTS).map(([key, v]) => (
            <button type="button" key={key} className={variant === key ? 'active' : ''} onClick={() => setVariant(key)}>
              {v.label}
            </button>
          ))}
        </div>
        <small className="hint">
          {variant === 'futsal'
            ? 'Piso, pelota rápida y paredes: la pelota rebota y nunca sale.'
            : 'Pasto: la pelota sale. Laterales, córners y saques de arco.'}
        </small>
      </div>

      <div className="field">
        <span>Cancha</span>
        <div className="options">
          {Object.entries(FIELDS).map(([key, f]) => (
            <button type="button" key={key} className={mode === key ? 'active' : ''} onClick={() => setMode(key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Equipo</span>
        <div className="options">
          <button type="button" className={`team red ${team === 'red' ? 'active' : ''}`} onClick={() => setTeam('red')}>
            Rojo
          </button>
          <button type="button" className={`team blue ${team === 'blue' ? 'active' : ''}`} onClick={() => setTeam('blue')}>
            Azul
          </button>
        </div>
      </div>

      <div className="field">
        <span>Vista</span>
        <div className="options">
          <button type="button" className={view3d ? 'active' : ''} onClick={() => setView3d(true)}>
            Isométrica 3D
          </button>
          <button type="button" className={!view3d ? 'active' : ''} onClick={() => setView3d(false)}>
            2D clásica
          </button>
        </div>
      </div>

      <div className="field">
        <span>Movimiento</span>
        <div className="options">
          <button type="button" className={relativeMove ? 'active' : ''} onClick={() => setRelativeMove(true)}>
            Hacia el mouse
          </button>
          <button type="button" className={!relativeMove ? 'active' : ''} onClick={() => setRelativeMove(false)}>
            Fijo
          </button>
        </div>
        <small className="hint">
          {relativeMove
            ? 'W corre hacia el cursor. S, A y D mueven fijo según la pantalla.'
            : 'W/A/S/D mueven siempre en la misma dirección de la pantalla.'}
        </small>
      </div>

      <label className="check">
        <input type="checkbox" checked={withBots} onChange={(e) => setWithBots(e.target.checked)} />
        Completar equipos con bots
      </label>

      <button className="play" type="submit">Jugar solo</button>
      <button className="online" type="button" disabled={!onlineAvailable} onClick={goOnline}>
        {onlineAvailable ? 'Salas online' : 'Salas online (falta configurar Supabase)'}
      </button>

      <ul className="controls">
        <li><kbd>WASD</kbd> mover · <kbd>Mouse</kbd> apuntar (360°)</li>
        <li><kbd>Shift</kbd> correr (gasta stamina)</li>
        <li><kbd>Click izq.</kbd> rasante · <kbd>Click der.</kbd> por arriba — mantené para cargar potencia</li>
        <li>Sin la pelota, <kbd>Click izq.</kbd> = quite · mantenido = barrida</li>
        <li><kbd>Espacio</kbd> saltar · en el aire <kbd>Click izq.</kbd> = cabezazo</li>
      </ul>
    </form>
    </div>
  )
}
