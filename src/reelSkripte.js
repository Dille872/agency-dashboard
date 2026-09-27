import { supabase } from './supabase'

// ── Reel-Skripte (v4.101.0) ────────────────────────────────────────────────
// Tabelle reel_skripte (sql/reel-skripte.sql), eine Zeile je Skript.
// Ablauf: Drehzettel (PDF, Agentur) → Video-LINK (Model, z. B. Dropbox)
// → Reel-Link + Account + Datum (wer postet) → Lyra misst pro Reel.
// Der Status wird aus den Feldern abgeleitet, nicht gespeichert.

export const STATUS = {
  freigegeben: { t: 'Drehzettel da', f: '#f59e0b', icon: '📄' },
  gedreht:     { t: 'Video da',      f: '#06b6d4', icon: '🎬' },
  gepostet:    { t: 'gepostet',      f: '#10b981', icon: '✅' },
  verworfen:   { t: 'verworfen',     f: '#6b7280', icon: '✕' },
}

export function statusVon(s) {
  if (s.verworfen) return 'verworfen'
  if (s.reel_url) return 'gepostet'
  if (s.video_link) return 'gedreht'
  return 'freigegeben'
}

export const linkOk = (v) => /^https?:\/\/\S+\.\S+/i.test(String(v || '').trim())
export const mitHttps = (v) => { const t = String(v || '').trim(); return !t ? '' : /^https?:\/\//i.test(t) ? t : `https://${t}` }

// @handle aus einem Instagram-Link (Tracking-Anhänge wie ?igsh=… fallen weg)
export const instaHandle = (url) => {
  const m = String(url || '').match(/instagram\.com\/([^/?#]+)/i)
  return m ? '@' + m[1] : String(url || '').trim()
}

export async function skripteLaden(name, { mitVerworfenen = true } = {}) {
  let q = supabase.from('reel_skripte').select('*').eq('model_name', name).order('erstellt_am', { ascending: false })
  if (!mitVerworfenen) q = q.eq('verworfen', false)
  const { data, error } = await q
  if (error) return { fehlt: true, liste: [] }
  return { fehlt: false, liste: data || [] }
}

export async function skriptAendern(id, felder) {
  const { error } = await supabase.from('reel_skripte').update(felder).eq('id', id)
  return error || null
}

// Drehzettel hochladen (Bucket chat-attachments, wie die Admin-Anhänge).
export async function drehzettelHochladen(name, file) {
  const ext = ((file.name || '').split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf'
  const sicher = String(name).replace(/[^a-zA-Z0-9_-]/g, '_')
  const path = `drehzettel/${sicher}/${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${ext}`
  const { error } = await supabase.storage.from('chat-attachments').upload(path, file, {
    contentType: file.type || 'application/pdf', cacheControl: '31536000',
  })
  if (error) return { fehler: error }
  const { data } = supabase.storage.from('chat-attachments').getPublicUrl(path)
  return { url: data.publicUrl }
}

export const tagKurz = (iso) => iso ? new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : ''
