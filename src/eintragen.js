import { supabase } from './supabase'
import { sendTelegramMessage, zugestellt } from './telegram'
import { logActivity } from './activity'
import { wandzeitZuDatum, zeitIn, BERLIN } from './zeit'

// ── Direkt eintragen: Kalender und ToDo (v4.74.0) ───────────────────────────
//
// Aus dem Board heraus einen Termin oder eine Aufgabe anlegen, ohne den
// Kalender- oder ToDo-Tab zu öffnen. Wunsch Christoph: "wenn ich einmal sowas
// plane, nicht nochmal rumklicken".
//
// Geschrieben wird in DIESELBEN Tabellen wie dort (team_kalender, todos), in
// derselben Form — der Eintrag sieht im Kalender aus wie jeder andere. Die
// Telegram-Nachricht hat denselben Wortlaut wie im Kalender (CalendarTab.jsx,
// benachrichtigen) bzw. in TodoTab.jsx. Ändert sich einer davon, hier nachziehen.
//
// Serien, Folgeaufgaben und Vorlagen gibt es hier bewusst nicht — dafür ist
// der Kalender da. Das hier ist der schnelle Weg für den einen Eintrag.

// Admins haben keinen Eintrag in chatters_contact — dieselbe Liste wie in
// CalendarTab.jsx und TodoTab.jsx
const ADMIN_TG = { chris: '1538601588', rey: '528328429' }
const lc = (s) => String(s || '').trim().toLowerCase()

async function telegramIds(namen) {
  const [kc, os] = await Promise.all([
    supabase.from('chatters_contact').select('name, telegram_id').in('name', namen),
    supabase.from('online_status').select('display_name, zeitzone').in('display_name', namen),
  ])
  const tg = Object.fromEntries((kc.data || []).filter(x => x.telegram_id).map(x => [x.name, x.telegram_id]))
  const zonen = Object.fromEntries((os.data || []).filter(x => x.zeitzone).map(x => [x.display_name, x.zeitzone]))
  return { id: (n) => tg[n] || ADMIN_TG[lc(n)] || null, zone: (n) => zonen[n] || BERLIN }
}

export const ARTEN_KURZ = [
  { key: 'aufgabe', label: 'Aufgabe', farbe: '#f59e0b' },
  { key: 'event', label: 'Event', farbe: '#ec4899' },
  { key: 'termin', label: 'Team-Termin', farbe: '#8b5cf6' },
  { key: 'erinnerung', label: 'Erinnerung', farbe: '#06b6d4' },
]

/**
 * Ein Kalendereintrag. tag/von/bis sind deutsche Zeit ("2026-09-22", "20:00").
 * fuer = Namen; fuerAlle = ganzes Team (dann gehen die Nachrichten an alleNamen).
 * Rückgabe: { eintrag, telegram: { ok, fehlt, fehler } }
 */
export async function kalenderEintragen({ titel, art, tag, von, bis, notiz, fuer, fuerAlle, erinnernMin, telegram, alleNamen = [] }, ich) {
  const beginn = wandzeitZuDatum(tag, von, BERLIN)
  let ende = bis ? wandzeitZuDatum(tag, bis, BERLIN) : null
  if (ende && ende <= beginn) ende = new Date(ende.getTime() + 24 * 3600 * 1000)   // über Mitternacht
  const zeile = {
    titel: titel.trim(), art,
    notiz: notiz?.trim() || null, fuer: fuerAlle ? [] : fuer, fuer_alle: !!fuerAlle,
    erinnern_min: erinnernMin ?? null, geaendert_am: new Date().toISOString(),
    model_name: null, beginn: beginn.toISOString(), ende: ende ? ende.toISOString() : null,
    erstellt_von: ich || null,
  }
  const { data, error } = await supabase.from('team_kalender').insert(zeile).select().single()
  if (error) throw error
  logActivity('kalender.neu', { entity: zeile.titel, detail: `${tag} ${von} (DE) · aus einem Board` })

  const erg = { ok: [], fehlt: [], fehler: [] }
  if (telegram) {
    const namen = (fuerAlle ? alleNamen : fuer).filter(n => n && n !== ich)
    if (namen.length) {
      const { id, zone } = await telegramIds(namen)
      const a = ARTEN_KURZ.find(x => x.key === art) || ARTEN_KURZ[0]
      for (const n of namen) {
        const tgId = id(n)
        if (!tgId) { erg.fehlt.push(n); continue }
        const z = zone(n)
        const wann = `${beginn.toLocaleDateString('de-DE', { timeZone: z, weekday: 'long', day: '2-digit', month: '2-digit' })}, ${zeitIn(beginn, z)} Uhr`
        const zusatz = z === BERLIN ? ' (deutsche Zeit)' : ` (deine Zeit · DE ${zeitIn(beginn, BERLIN)})`
        const text = `🗓 <b>Neu im Kalender</b>${ich ? ` · von ${ich}` : ''}\n\n<b>${zeile.titel}</b>\n${a.label} · ${wann}${zusatz}${zeile.notiz ? `\n\n${zeile.notiz}` : ''}\n\n– Thirteen 87`
        try {
          const res = await sendTelegramMessage(tgId, text)
          if (zugestellt(res)) erg.ok.push(n); else erg.fehler.push(n)
        } catch { erg.fehler.push(n) }
      }
    }
  }
  return { eintrag: data, telegram: erg }
}

/**
 * Eine Aufgabe in todos. Telegram wie im ToDo-Tab: an die zugewiesene Person,
 * ohne Zuweisung an die anderen Admins.
 */
export async function todoEintragen({ titel, beschreibung, an, prioritaet = 'normal', telegram }, ich) {
  const { error } = await supabase.from('todos').insert({
    title: titel.trim(),
    description: beschreibung?.trim() || null,
    priority: prioritaet,
    created_by: ich,
    assigned_to: an?.trim() || null,
    read_by: [ich],
  })
  if (error) throw error
  const erg = { ok: [], fehlt: [], fehler: [] }
  if (!telegram) return { telegram: erg }
  const ziele = an?.trim() ? [an.trim()] : Object.keys(ADMIN_TG).map(k => k[0].toUpperCase() + k.slice(1))
  const namen = ziele.filter(n => lc(n) !== lc(ich))
  if (!namen.length) return { telegram: erg }
  const { id } = await telegramIds(namen)
  const text = an?.trim()
    ? `📋 <b>Neue Aufgabe für dich</b>\n\n${titel.trim()}${beschreibung ? '\n' + beschreibung.trim() : ''}\n\nVon: ${ich}`
    : `📋 <b>Neue Aufgabe von ${ich}</b>\n\n${titel.trim()}${beschreibung ? '\n' + beschreibung.trim() : ''}`
  for (const n of namen) {
    const tgId = id(n)
    if (!tgId) { erg.fehlt.push(n); continue }
    try {
      const res = await sendTelegramMessage(tgId, text)
      if (zugestellt(res)) erg.ok.push(n); else erg.fehler.push(n)
    } catch { erg.fehler.push(n) }
  }
  return { telegram: erg }
}
