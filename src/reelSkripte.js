import { supabase } from './supabase'

// ── Reel-Skripte (v4.101.0) ────────────────────────────────────────────────
// Tabelle reel_skripte (sql/reel-skripte.sql), eine Zeile je Skript.
// Ablauf: Drehzettel (PDF, Agentur) → Video-LINK (Model, z. B. Dropbox)
// → Reel-Link + Account + Datum (wer postet) → Lyra misst pro Reel.
// Der Status wird aus den Feldern abgeleitet, nicht gespeichert.

// v4.106.0: mit Cutter und Freigabe
//   freigegeben → (Model dreht) → schnitt (nur wenn der Account einen Cutter hat)
//   → pruefung (Freigabe) → bereit (Poster) → gepostet
export const STATUS = {
  freigegeben: { t: 'Drehzettel da',     f: '#f59e0b', icon: '📄' },
  schnitt:     { t: 'Im Schnitt',        f: '#a855f7', icon: '✂️' },
  pruefung:    { t: 'Zur Freigabe',      f: '#f97316', icon: '👀' },
  bereit:      { t: 'Bereit zum Posten', f: '#06b6d4', icon: '🎬' },
  gepostet:    { t: 'gepostet',          f: '#10b981', icon: '✅' },
  verworfen:   { t: 'verworfen',         f: '#6b7280', icon: '✕' },
}

// Welche Accounts einen Cutter haben (social_account_cutter). Wird von den
// Ansichten geladen, die das wissen dürfen (cutterSetzen). Ohne diese Info
// (z. B. im Model-Portal) wird aus „Im Schnitt“ „Zur Freigabe“ — für das
// Model ist beides „Video da“.
let CUTTER = new Set()
export function cutterSetzen(zeilen = []) { CUTTER = new Set(zeilen.map(z => z.model_name + '|' + z.account)) }
export const hatCutter = (s) => CUTTER.has(s.model_name + '|' + s.ziel_account)
export async function cutterLaden() {
  const { data, error } = await supabase.from('social_account_cutter').select('model_name, account, cutter_name')
  if (!error) cutterSetzen(data || [])
  return error ? [] : (data || [])
}

const nach = (a, b) => !!a && (!b || new Date(a) > new Date(b))

// v4.108.0: „Model postet selbst“ je Account (model_social_service.account_modus)
let MODUS = {}
export function modusSetzen(services = []) {
  MODUS = {}
  for (const sv of services || []) for (const [acc, m] of Object.entries(sv?.account_modus || {})) MODUS[sv.model_name + '|' + acc] = m || {}
}
export const postetModel = (s) => MODUS[s.model_name + '|' + s.ziel_account]?.posten === 'model'
export const modusVon = (model, account) => MODUS[model + '|' + account] || {}

// Links werden beim „Zurück“ nicht gelöscht: ein Link gilt nur, wenn er
// NACH dem Zurück (und ein Schnitt nach dem letzten Video) kam.
export function videoGilt(s) {
  return !!s.video_link && !(s.zurueck_an === 'model' && !nach(s.video_am, s.zurueck_am))
}
export function schnittGilt(s) {
  return !!s.schnitt_link && nach(s.schnitt_am, s.video_am) && !(s.zurueck_an === 'cutter' && !nach(s.schnitt_am, s.zurueck_am))
}
// Das Video, das gepostet wird: der Schnitt, sonst das Rohvideo des Models
export const endVideo = (s) => (schnittGilt(s) ? s.schnitt_link : s.video_link) || ''

export function statusVon(s) {
  if (s.verworfen) return 'verworfen'
  if (s.reel_url) return 'gepostet'
  if (postetModel(s)) return 'freigegeben' // Model dreht, schneidet und postet selbst
  if (s.freigabe_am && nach(s.freigabe_am, s.zurueck_am)) return 'bereit'
  if (!videoGilt(s)) return 'freigegeben'
  if (schnittGilt(s)) return 'pruefung'
  if (hatCutter(s)) return 'schnitt'
  return 'pruefung'
}

// Seit wann steht das Skript im aktuellen Schritt?
export function seitVon(s) {
  const st = statusVon(s)
  if (st === 'gepostet') return s.gepostet_am
  if (st === 'bereit') return s.freigabe_am
  if (st === 'pruefung') return schnittGilt(s) ? s.schnitt_am : s.video_am
  if (st === 'schnitt') return s.video_am
  return s.zurueck_an === 'model' && s.zurueck_am ? s.zurueck_am : s.erstellt_am
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

// ── v4.103.0: Anlegen an einer Stelle (Steuerung + Mehrfach-Upload) ────────
// Lädt die PDF hoch, legt das Skript an (Nummer vergibt die Datenbank) und
// schickt auf Wunsch dem Model einen Telegram-Hinweis.
// Rückgabe: { nr } oder { fehler: 'Text' }, dazu ggf. info (Telegram-Hinweis).
const TG_NEU = 'Neuer Drehzettel {nr} 🎬 „{titel}“{fuer}. Du findest ihn in deinem Portal unter „Social“. Wenn das Video fertig ist, dort einfach den Link (z. B. Dropbox) einfügen. Danke! 💛'

export async function skriptAnlegen({ model, titel, datei, ziel, wer, telegram }) {
  const t = String(titel || '').trim().slice(0, 120)
  if (!model) return { fehler: 'Kein Model gewählt.' }
  if (!t) return { fehler: 'Kein Titel.' }
  if (!datei) return { fehler: 'Keine PDF.' }
  const up = await drehzettelHochladen(model, datei)
  if (up.fehler) return { fehler: 'PDF ging nicht hoch: ' + up.fehler.message }
  const { data, error } = await supabase.from('reel_skripte')
    .insert({ model_name: model, titel: t, drehzettel_url: up.url, ziel_account: ziel || null, erstellt_von: wer || null })
    .select('nr').single()
  if (error) return { fehler: 'Nicht gespeichert: ' + error.message }
  const { logActivity } = await import('./activity')
  logActivity('reel.skript', { entity: `${model} ${data.nr}`, detail: `Drehzettel „${t}“${ziel ? ` für ${ziel}` : ''}` })
  let info = ''
  if (telegram) {
    const { sendTelegramMessage, zugestellt } = await import('./telegram')
    const { data: m } = await supabase.from('models_contact').select('telegram_id').eq('name', model).maybeSingle()
    if (!m?.telegram_id) info = 'keine Telegram-ID'
    else {
      const text = TG_NEU.replace('{nr}', data.nr).replace('{titel}', t).replace('{fuer}', ziel ? ` für ${ziel}` : '')
      try {
        const r = await sendTelegramMessage(m.telegram_id, text)
        const ok = zugestellt(r)
        await supabase.from('messages').insert({ model_name: model, model_telegram_id: m.telegram_id, direction: 'out', contact_type: 'model', message_type: 'announcement', text, status: ok ? 'sent' : 'failed', sent_by: wer })
        if (!ok) info = 'Telegram nicht angekommen'
      } catch { info = 'Telegram nicht angekommen' }
    }
  }
  return { nr: data.nr, info }
}

// Dateiname → Vorschlag für Model, Account, Titel.
// Versteht z. B. „Sandra_@sandra.wayneee_Gym-Transition.pdf“ und
// „Sandra – Küche Outfit-Wechsel.pdf“. Was nicht erkannt wird, bleibt leer.
export function dateinameLesen(name, modelNamen = []) {
  const basis = String(name || '').replace(/\.pdf$/i, '').trim()
  const teile = basis.split(/\s*[_–—]\s*|\s+-\s+/).map(x => x.trim()).filter(Boolean)
  let model = '', account = ''
  const rest = []
  for (const p of teile) {
    if (!account && p.startsWith('@')) { account = p; continue }
    const m = !model && modelNamen.find(n => n.toLowerCase() === p.toLowerCase())
    if (m) { model = m; continue }
    rest.push(p)
  }
  // „Gym-Transition“ (ohne Leerzeichen) → „Gym Transition“; „Outfit-Wechsel“ in einem Satz bleibt
  const titel = rest.map(p => p.includes(' ') ? p : p.replace(/-/g, ' ')).join(' ').replace(/\s+/g, ' ').trim()
  return { model, account, titel }
}

// ── v4.104.0: Instagram-Account durch die Agentur anlegen ──────────────────
// Landet im Board (model_board, social_media) mit von_agentur = true —
// sichtbar für Chatter und Model, aber nur Staff darf ihn ändern/löschen
// (sql/agentur-accounts.sql). Eingabe: @handle, handle oder Instagram-Link.
export async function agenturAccountAnlegen(model, eingabe, wer) {
  const roh = String(eingabe || '').trim()
  const handle = (roh.match(/instagram\.com\/([^/?#\s]+)/i)?.[1] || roh.replace(/^@/, '')).trim()
  if (!model) return { fehler: 'Kein Model gewählt.' }
  if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) return { fehler: 'Das sieht nicht nach einem Instagram-Namen aus.' }
  const url = `https://www.instagram.com/${handle}`
  const { data: vorhanden } = await supabase.from('model_board').select('content, sort_order').eq('model_name', model).eq('category', 'social_media')
  if ((vorhanden || []).some(x => instaHandle(x.content).toLowerCase() === '@' + handle.toLowerCase())) return { fehler: `@${handle} steht schon im Board.` }
  const sort = Math.max(-1, ...(vorhanden || []).map(x => Number(x.sort_order) || 0)) + 1
  const { error } = await supabase.from('model_board').insert({ model_name: model, category: 'social_media', title: 'instagram', content: url, sort_order: sort, von_agentur: true })
  if (error) return { fehler: 'Nicht gespeichert: ' + error.message }
  try { await supabase.from('model_board_activity').insert({ model_name: model, action: 'hinzugefügt', category: 'social_media', details: `Instagram @${handle} (von der Agentur)` }) } catch { /* optional */ }
  const { logActivity } = await import('./activity')
  logActivity('social.account', { entity: model, detail: `@${handle} angelegt${wer ? ` von ${wer}` : ''}` })
  return { handle: '@' + handle }
}
