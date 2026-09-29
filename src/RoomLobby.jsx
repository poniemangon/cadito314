import { useEffect, useRef, useState } from 'react'
import { FIELDS, VARIANTS, TEAM_NAMES } from './game/constants.js'

const TEAMS = [
  { key: 'red', label: TEAM_NAMES.red },
  { key: 'blue', label: TEAM_NAMES.blue },
  { key: 'spec', label: 'Espectadores' },
]

// Menú de la sala: equipos, configuración (solo host), completar con bots y chat.
export default function RoomLobby({ session, chat, onLeave, onWatch }) {
  const [room, setRoom] = useState(() => session.getRoom())
  const [text, setText] = useState('')
  const chatRef = useRef(null)
  const isHost = session.isHost
  const me = session.localId

  useEffect(() => session.on((ev) => ev.type === 'lobby' && setRoom(ev.room)), [session])
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [chat])

  if (!room) return null
  const perTeam = FIELDS[room.mode].perTeam
  const inTeam = (team) => room.players.filter((p) => p.team === team)
  const myTeam = room.players.find((p) => p.id === me)?.team

  const send = (e) => {
    e.preventDefault()
    if (text.trim()) session.sendChat(text)
    setText('')
  }

  return (
    <div className="screen">
      <div className="menu wide lobby">
        <div className="menu-head">
          <button type="button" className="link" onClick={onLeave}>
            ← Salir
          </button>
          <h2>{room.name}</h2>
          <span className="tag">{isHost ? 'Sos el host' : 'Invitado'}</span>
        </div>

        <div className="settings">
          <div className="field">
            <span>Modalidad</span>
            <div className="options">
              {Object.entries(VARIANTS).map(([key, v]) => (
                <button
                  type="button"
                  key={key}
                  disabled={!isHost || room.started}
                  className={room.variant === key ? 'active' : ''}
                  onClick={() => session.setSettings({ variant: key })}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>Cancha</span>
            <div className="options">
              {Object.entries(FIELDS).map(([key, f]) => (
                <button
                  type="button"
                  key={key}
                  disabled={!isHost || room.started}
                  className={room.mode === key ? 'active' : ''}
                  onClick={() => session.setSettings({ mode: key })}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={room.fillBots}
              disabled={!isHost || room.started}
              onChange={(e) => session.setSettings({ fillBots: e.target.checked })}
            />
            Completar los lugares libres con bots
          </label>
        </div>

        <div className="teams">
          {TEAMS.map(({ key, label }) => {
            const players = inTeam(key)
            const full = key !== 'spec' && players.length >= perTeam
            const bots = key !== 'spec' && room.fillBots ? perTeam - players.length : 0
            return (
              <div className={`team-col ${key}`} key={key}>
                <div className="team-title">
                  {label}
                  {key !== 'spec' && (
                    <small>
                      {players.length}/{perTeam}
                    </small>
                  )}
                </div>
                <ul>
                  {players.map((p) => (
                    <li key={p.id} className={p.id === me ? 'me' : ''}>
                      <span>
                        {p.name}
                        {p.id === room.hostId && <em> (host)</em>}
                        {p.id === me && <em> (vos)</em>}
                      </span>
                      {isHost && p.id !== me && !room.started && (
                        <button type="button" className="kick" title="Sacar de la sala" onClick={() => session.kick(p.id)}>
                          ×
                        </button>
                      )}
                    </li>
                  ))}
                  {Array.from({ length: Math.max(0, bots) }, (_, i) => (
                    <li key={`bot${i}`} className="bot">
                      Bot
                    </li>
                  ))}
                </ul>
                {myTeam !== key && !room.started && (
                  <button type="button" className="small" disabled={full} onClick={() => session.setTeam(key)}>
                    {full ? 'Lleno' : 'Unirme'}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <div className="chat">
          <div className="chat-log" ref={chatRef}>
            {chat.length === 0 && <p className="empty">Chat de la sala</p>}
            {chat.map((m, i) => (
              <p key={i} className={m.from ? '' : 'system'}>
                {m.from && <strong>{m.from}: </strong>}
                {m.text}
              </p>
            ))}
          </div>
          <form onSubmit={send}>
            <input value={text} maxLength={200} placeholder="Escribí algo…" onChange={(e) => setText(e.target.value)} />
            <button type="submit" className="small">
              Enviar
            </button>
          </form>
        </div>

        {room.started ? (
          <button type="button" className="play" onClick={onWatch}>
            Partido en curso — ver
          </button>
        ) : isHost ? (
          <button type="button" className="play" onClick={() => session.startMatch()}>
            Empezar partido
          </button>
        ) : (
          <p className="waiting">Esperando que el host empiece el partido…</p>
        )}
      </div>
    </div>
  )
}
