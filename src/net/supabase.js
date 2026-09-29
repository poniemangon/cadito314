import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY

// Solo se usa Realtime (presence + broadcast) para listar salas y conectar jugadores por WebRTC.
export const supabase = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null
export const onlineAvailable = !!supabase

// Id de esta pestaña (también es el id de la sala si hosteás, y tu id de jugador online)
export const clientId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).replace(/-/g, '').slice(0, 12)
