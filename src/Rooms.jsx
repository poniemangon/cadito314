import { useEffect, useState } from 'react'
import { FIELDS, VARIANTS } from './game/constants.js'
import { watchRooms } from './net/lobby.js'
import { parseRoomCode } from './net/invite.js'

// Lista de salas abiertas + crear una sala nueva.
export default function Rooms({ name, busy, error, onJoin, onCreate, onBack }) {
  const [rooms, setRooms] = useState([])
  const [creating, setCreating] = useState(false)
  const [roomName, setRoomName] = useState(`Sala de ${name || 'Jugador'}`)
  const [mode, setMode] = useState('2v2')
  const [variant, setVariant] = useState('futsal')
  const [isPrivate, setIsPrivate] = useState(false)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')

  useEffect(() => watchRooms(setRooms), [])

  const create = (e) => {
    e.preventDefault()
    onCreate({ name: roomName, mode, variant, isPrivate })
  }

  const joinByCode = (e) => {
    e.preventDefault()
    const id = parseRoomCode(code)
    if (!id) return setCodeError('Pegá un link de invitación o un código de sala')
    setCodeError('')
    onJoin(id)
  }

  return (
    <div className="screen">
      <div className="menu wide">
        <div className="menu-head">
          <button type="button" className="link" onClick={onBack}>← Menú</button>
          <h2>Salas online</h2>
          <button type="button" className="small" onClick={() => setCreating((v) => !v)} disabled={busy}>
            {creating ? 'Cancelar' : '+ Crear sala'}
          </button>
        </div>

        {error && <div className="error">{error}</div>}

        {creating && (
          <form className="create" onSubmit={create}>
            <label className="field">
              <span>Nombre de la sala</span>
              <input value={roomName} maxLength={40} onChange={(e) => setRoomName(e.target.value)} />
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
            <label className="check">
              <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
              Sala privada (solo se entra con el link)
            </label>
            <button className="play" type="submit" disabled={busy}>
              {busy ? 'Creando…' : 'Crear y entrar'}
            </button>
          </form>
        )}

        <form className="join-code" onSubmit={joinByCode}>
          <input value={code} placeholder="Pegá un link de invitación o un código" onChange={(e) => setCode(e.target.value)} />
          <button type="submit" className="small" disabled={busy}>
            {busy ? '…' : 'Entrar'}
          </button>
        </form>
        {codeError && <div className="error">{codeError}</div>}

        <div className="room-list">
          {rooms.length === 0 && <p className="empty">No hay salas abiertas. ¡Creá una!</p>}
          {rooms.map((r) => (
            <div className="room-row" key={r.id}>
              <div className="room-info">
                <strong>{r.name}</strong>
                <small>
                  {VARIANTS[r.variant]?.label} · {FIELDS[r.mode]?.label} · host: {r.host}
                  {r.started ? ' · jugando' : ''}
                </small>
              </div>
              <span className="room-count">
                {r.humans}/{r.max}
              </span>
              <button type="button" className="small" disabled={busy} onClick={() => onJoin(r.id)}>
                {busy ? '…' : r.started ? 'Mirar' : 'Entrar'}
              </button>
            </div>
          ))}
        </div>
        <small className="hint">
          Las salas se conectan directo entre navegadores. Si sos host, dejá la pestaña abierta: si la cerrás, la sala se cierra.
        </small>
      </div>
    </div>
  )
}
