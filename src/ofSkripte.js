// ── OF-Skripte: Storyteller → Freigabe → Model → Script Builder (v5.27.0) ──
// Tabelle of_skripte, Rechte und Zeitstempel regelt die Datenbank
// (sql/storyteller-script-builder.sql). Hier: Laden, Speichern, Statuswechsel
// und die Telegram-Hinweise.
import { supabase } from './supabase'
import { sendTelegramMessage, notifyAdmins } from './telegram'

export const STATUS = {
  entwurf:     { t: 'Entwurf',              f: '#9a9ab5' },
  freigabe:    { t: 'wartet auf Freigabe',  f: '#f59e0b' },
  zurueck:     { t: 'zurück mit Notiz',     f: '#ef4444' },
  beim_model:  { t: 'beim Model',           f: '#ec4899' },
  hochgeladen: { t: 'auf OF · wartet auf CH', f: '#06b6d4' },
  gebaut:      { t: '✓ in CH gebaut',       f: '#10b981' },
  verworfen:   { t: 'verworfen',            f: '#6e6e8a' },
}
export const ARTEN = [
  { k: 'video', t: '🎥 Video' },
  { k: 'bilder', t: '📸 Bilder' },
  { k: 'sonstiges', t: '✨ Sonstiges' },
]
export const artText = (k) => ARTEN.find(a => a.k === k)?.t || k

export const fehltTabelle = (error) => !!error && /of_skripte|ch_video_erledigt|builder_videos|of_models_liste|does not exist|schema cache/i.test(error.message || '')

// Schritte sauber machen: leere raus, Text kürzen
export const schritteSauber = (liste) => (liste || [])
  .map(s => ({ text: String(s?.text || '').trim().slice(0, 500), ...(String(s?.tipp || '').trim() ? { tipp: String(s.tipp).trim().slice(0, 300) } : {}) }))
  .filter(s => s.text)

export async function skripteLaden() {
  const { data, error } = await supabase.from('of_skripte').select('*').order('aktualisiert_am', { ascending: false }).limit(500)
  return { liste: data || [], fehlt: fehltTabelle(error), error }
}

export async function modelsLaden() {
  const r = await supabase.rpc('of_models_liste')
  if (!r.error) return (r.data || []).map(x => x.name)
  const m = await supabase.from('models_contact').select('name, active').order('name')
  return (m.data || []).filter(x => x.active !== false).map(x => x.name)
}

const FELDER = ['model_name', 'titel', 'art', 'schritte', 'outfit', 'laenge', 'notiz_builder', 'faellig', 'status', 'zurueck_notiz']
export async function speichern(s, wer) {
  const zeile = {}
  for (const k of FELDER) if (k in s) zeile[k] = s[k]
  zeile.schritte = schritteSauber(s.schritte)
  for (const k of ['outfit', 'laenge', 'notiz_builder']) if (k in zeile) zeile[k] = String(zeile[k] || '').trim() || null
  if ('faellig' in zeile) zeile.faellig = zeile.faellig || null
  if (s.id) {
    const { data, error } = await supabase.from('of_skripte').update(zeile).eq('id', s.id).select().maybeSingle()
    return { data, error }
  }
  const { data, error } = await supabase.from('of_skripte').insert({ ...zeile, erstellt_von: wer }).select().maybeSingle()
  return { data, error }
}

const kurz = (t, n = 60) => { const s = String(t || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s }

// Storyteller schickt zur Freigabe → Chris/Rey bekommen Bescheid
export async function zurFreigabeGemeldet(s, wer) {
  try { await notifyAdmins(`✍️ <b>${wer}</b> hat ein Skript zur Freigabe geschickt\n\n<b>${s.model_name}</b>: ${kurz(s.titel)}\n\n👉 Dashboard → Kommunikation → Skripte`) } catch { /* nur Hinweis */ }
}

// Admin schaltet frei → Model bekommt Telegram
export async function freischalten(s) {
  const { error } = await supabase.from('of_skripte').update({ status: 'beim_model', zurueck_notiz: null }).eq('id', s.id)
  if (error) return { error }
  let info = ''
  try {
    const { data: m } = await supabase.from('models_contact').select('telegram_id').eq('name', s.model_name).maybeSingle()
    if (m?.telegram_id) {
      const schritte = schritteSauber(s.schritte)
      const r = await sendTelegramMessage(m.telegram_id,
        `✍️ <b>Neues Skript für dich</b>\n\n<b>${kurz(s.titel, 80)}</b>${s.faellig ? `\nbis ${new Date(s.faellig + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}` : ''}\n${schritte.length} Schritt${schritte.length === 1 ? '' : 'e'}\n\n👉 Im Dashboard auf der Startseite unter „Skripte für dich“`)
      info = r?.ok ? 'Model per Telegram benachrichtigt' : 'Telegram an das Model ging nicht raus'
    } else info = 'Model hat keine Telegram-ID, bitte selbst Bescheid geben'
  } catch { info = 'Telegram an das Model ging nicht raus' }
  return { info }
}

export async function zurueckSchicken(s, notiz) {
  return supabase.from('of_skripte').update({ status: 'zurueck', zurueck_notiz: String(notiz || '').trim() || null }).eq('id', s.id)
}

// An alle Script Builder (Telegram-IDs liefert die Datenbank)
export async function builderBenachrichtigen(text) {
  const { data, error } = await supabase.rpc('script_builder_kontakte')
  if (error) return { gesendet: 0 }
  const ids = [...new Set((data || []).map(x => x.telegram).filter(Boolean))]
  let gesendet = 0
  for (const id of ids) {
    try { const r = await sendTelegramMessage(id, text); if (r?.ok) gesendet++ } catch { /* weiter */ }
  }
  return { gesendet, ziele: ids.length }
}

// Model: gedreht & auf OF hochgeladen
export async function alsHochgeladen(s, ofTitel) {
  const { error } = await supabase.from('of_skripte').update({ status: 'hochgeladen', of_titel: String(ofTitel || '').trim() || null }).eq('id', s.id)
  if (error) return { error }
  await builderBenachrichtigen(
    `🧩 <b>Neu zu skripten</b>\n\n<b>${s.model_name}</b> hat „${kurz(s.titel, 80)}“ auf OF hochgeladen.` +
    (String(ofTitel || '').trim() ? `\nTitel auf OF: <i>${kurz(ofTitel, 80)}</i>` : '') +
    (s.notiz_builder ? `\nNotiz: ${kurz(s.notiz_builder, 200)}` : '') +
    `\n\n👉 Dashboard → Skripte → Script Builder`)
  return {}
}

// Model trägt selbst ein Video ein (Videos-Bereich) → Script Builder Bescheid geben
export async function videoGemeldet(model, titel, datum) {
  try {
    await builderBenachrichtigen(
      `🧩 <b>Neues Video zum Skripten</b>\n\n<b>${model}</b> hat ein Video eingetragen: „${kurz(titel, 80)}“` +
      (datum ? `\nVÖ: ${new Date(datum + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}` : '') +
      `\n\n👉 Dashboard → Skripte → Script Builder`)
  } catch { /* nur Hinweis */ }
}

export async function alsGebaut(s, an = true) {
  return supabase.from('of_skripte').update({ status: an ? 'gebaut' : 'hochgeladen' }).eq('id', s.id)
}

export async function builderVideosLaden() {
  const { data, error } = await supabase.rpc('builder_videos')
  return { liste: data || [], fehlt: fehltTabelle(error) }
}
export async function videoErledigt(v, wer, an = true) {
  if (an) return supabase.from('ch_video_erledigt').insert({ video_id: String(v.id), model_name: v.model_name, titel: v.title, gebaut_von: wer })
  return supabase.from('ch_video_erledigt').delete().eq('video_id', String(v.id))
}
