// ── Buchhaltung (v5.37.0 · v5.37.1) ────────────────────────────────────────
// v5.37.1: Die Zahlen stehen automatisch drin — dieselbe Rechnung wie Billing
// (billingRechnung.js), live für den gewählten Monat/Zeitraum. Solange eine
// Abrechnung nicht mitgeteilt ist, ist sie euer ENTWURF: Extras eintragen
// (z. B. Skripte, Bonus, Abzug), Bezahlt drücken, Rechnung selbst hochladen.
// Mit „Bescheid geben“ werden die Zahlen festgeschrieben, der Chatter sieht sie
// im Portal und bekommt eine Telegram-Nachricht.
// Eine Zeile in chatter_abrechnungen entsteht erst, wenn ihr etwas daran tut.

import { supabase } from './supabase'
import { sendTelegramMessage, notifyAdmins } from './telegram'
import { chatterVerteilen, chatterRechnung, istInaktiv } from './billingRechnung'
import { zeitraumText, abrechnungenPdf } from './billingExport'

export const STATUS = {
  entwurf:  { label: 'Noch nicht mitgeteilt', farbe: '#a78bfa', bg: 'rgba(167,139,250,0.14)' },
  offen:    { label: 'Rechnung fehlt',     farbe: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
  rechnung: { label: 'Rechnung da',        farbe: '#60a5fa', bg: 'rgba(96,165,250,0.15)' },
  klaerung: { label: 'Klärung',            farbe: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  bezahlt:  { label: 'Bezahlt',            farbe: '#34d399', bg: 'rgba(16,185,129,0.15)' },
}

export const euro = (v) => v == null || v === '' || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
export const dollar = (v) => v == null ? '—' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' $'
export const datum = (iso) => iso ? new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''
export const datumZeit = (iso) => iso ? new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
export const heuteIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
export const monatName = (m) => new Date(m + '-15').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
export const fehltTabelle = (error) => !!error && /chatter_abrechnungen|extras|mitgeteilt|does not exist|schema cache/i.test(error.message || '')
export const zahlAus = (t) => { const n = Number(String(t ?? '').trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null }
export const letzterTagVon = (monat) => { const [y, m] = monat.split('-').map(Number); return `${monat}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` }
const round = (v) => Math.round(Number(v || 0) * 100) / 100
const escHtml = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const link = (q = '') => { try { return `${window.location.origin}/${q}` } catch { return '' } }

// Status einer Zeile (ohne Zeile oder nicht mitgeteilt = Entwurf)
export const statusVon = (row) => !row || (!row.mitgeteilt_am && row.status === 'offen') ? 'entwurf' : row.status
export const extrasVon = (row) => Array.isArray(row?.extras) ? row.extras : []
export const extrasSumme = (row) => extrasVon(row).reduce((t, e) => t + Number(e.betrag || 0), 0)
// Gesamtbetrag in € (Anteil + Extras); ohne Kurs: null
export const gesamtEur = (row) => row?.betrag_eur == null ? (extrasVon(row).length ? round(extrasSumme(row)) : null) : round(Number(row.betrag_eur) + extrasSumme(row))

// Zeile aus der Datenbank → Form, die billingExport (PDF) erwartet
export const alsBillingZeile = (a) => ({
  name: a.chatter_name,
  s: a.prozent != null ? { percentage: Number(a.prozent), include_chat: a.nur_chat !== false } : null,
  rev: { chat: Number(a.umsatz_chat_usd || 0), total: Number(a.umsatz_gesamt_usd || 0) },
  x: a.auszahlung_usd != null ? { base: Number(a.basis_usd || 0), auszahlung: Number(a.auszahlung_usd) } : null,
  extras: extrasVon(a),
})
export async function abrechnungPdf(a) {
  return abrechnungenPdf({ art: 'chatter', zeilen: [alsBillingZeile(a)], monat: a.monat, kurs: a.kurs, bis: a.bis, von: a.frei ? a.von : null })
}

// ── Laden ───────────────────────────────────────────────────────────────────
export async function abrechnungenLaden(chatter = null) {
  let q = supabase.from('chatter_abrechnungen').select('*').order('von', { ascending: false }).order('chatter_name')
  if (chatter) q = q.eq('chatter_name', chatter)
  return q
}

// Zeitraum → { ab, ende, bezug, frei, bezeichnung }
export function periode({ monat, von, bis, frei }) {
  const ab = frei ? von : `${monat}-01`
  const ende = frei ? bis : letzterTagVon(monat)
  const bezug = frei ? bis.slice(0, 7) : monat
  return { ab, ende, bezug, frei: !!frei, bezeichnung: frei ? zeitraumText(bezug, ende, ab) : monatName(bezug) }
}

// Live gerechnet (wie Billing) + was schon gespeichert ist, für einen Zeitraum
export async function zeitraumLaden(p) {
  const [c, s, al, snaps, kurse, gesp] = await Promise.all([
    supabase.from('chatters_contact').select('name, active, telegram_id').order('name'),
    supabase.from('billing_settings').select('*').eq('person_type', 'chatter'),
    supabase.from('chatter_aliases').select('*'),
    supabase.from('chatter_snapshots').select('rows,business_date').gte('business_date', p.ab).lte('business_date', p.ende),
    supabase.from('billing_kurse').select('*').eq('monat', p.bezug),
    supabase.from('chatter_abrechnungen').select('*').eq('von', p.ab).eq('bis', p.ende),
  ])
  if (gesp.error) return { fehler: fehltTabelle(gesp.error) ? 'Die Datenbank für die Buchhaltung ist noch nicht auf dem neuen Stand: einmal sql/buchhaltung-entwurf.sql in Supabase ausführen.' : gesp.error.message }
  const chatters = c.data || []
  const settings = s.data || []
  const { proPerson } = chatterVerteilen(chatters, al.data || [], snaps.data || [])
  const kurs = kurse.data?.[0] ? Number(kurse.data[0].usd_eur) : null
  const tage = [...new Set((snaps.data || []).map(x => x.business_date))].sort()
  const tageSoll = Math.round((new Date(p.ende + 'T12:00:00') - new Date(p.ab + 'T12:00:00')) / 864e5) + 1
  const gespeichert = gesp.data || []
  const live = new Map()
  for (const ch of chatters) {
    const st = settings.find(x => x.person_name === ch.name)
    const rev = proPerson[ch.name] || { chat: 0, total: 0 }
    const x = chatterRechnung(st, rev, p.bezug)
    if (!x || !(x.auszahlung > 0) || istInaktiv(st, p.bezug)) continue
    live.set(ch.name, liveZeile(ch.name, st, rev, x, kurs))
  }
  const namen = [...new Set([...live.keys(), ...gespeichert.map(r => r.chatter_name)])].sort((a, b) => a.localeCompare(b, 'de'))
  const telegram = Object.fromEntries(chatters.map(ch => [ch.name, ch.telegram_id || null]))
  const items = namen.map(name => ({ name, live: live.get(name) || null, row: gespeichert.find(r => r.chatter_name === name) || null, telegram: telegram[name] || null }))
  return { items, kurs, tage: tage.length, tageSoll, letzterTag: tage[tage.length - 1] || null }
}

function liveZeile(name, st, rev, x, kurs) {
  return {
    umsatz_chat_usd: round(rev.chat), umsatz_gesamt_usd: round(rev.total), basis_usd: round(x.base),
    prozent: st.percentage, nur_chat: !!st.include_chat, auszahlung_usd: round(x.auszahlung),
    kurs, betrag_eur: kurs ? round(x.auszahlung * kurs) : null,
  }
}
const ZAHLFELDER = ['umsatz_chat_usd', 'umsatz_gesamt_usd', 'basis_usd', 'prozent', 'nur_chat', 'auszahlung_usd', 'kurs', 'betrag_eur']
// Was angezeigt wird: Entwurf → live, mitgeteilt → festgeschrieben
export function anzeige(item) {
  const { row, live } = item
  const fest = row && row.mitgeteilt_am
  const zahlen = fest || !live ? (row || {}) : live
  const pp = item.p || {}
  return { monat: pp.bezug, von: pp.ab, bis: pp.ende, frei: pp.frei, bezeichnung: pp.bezeichnung, ...(row || {}), ...Object.fromEntries(ZAHLFELDER.map(k => [k, zahlen[k] ?? null])), chatter_name: item.name, extras: extrasVon(row) }
}
// Weicht das Festgeschriebene von den aktuellen Daten ab? (z. B. CSV nachgeladen)
export const veraltet = (item) => !!(item.row?.mitgeteilt_am && item.live && Math.abs(Number(item.row.auszahlung_usd || 0) - Number(item.live.auszahlung_usd || 0)) >= 0.01)

// Zeile sicherstellen (entsteht erst bei der ersten Aktion). Gibt die Zeile zurück.
export async function zeileSichern(item, p, wer) {
  if (item.row) return { row: item.row }
  const neu = {
    chatter_name: item.name, monat: p.bezug, von: p.ab, bis: p.ende, frei: p.frei, bezeichnung: p.bezeichnung,
    ...(item.live || {}), freigegeben_von: wer || null,
  }
  const ins = await supabase.from('chatter_abrechnungen').upsert(neu, { onConflict: 'chatter_name,von,bis', ignoreDuplicates: true })
  if (ins.error) return { error: ins.error }
  const { data, error } = await supabase.from('chatter_abrechnungen').select('*').eq('chatter_name', item.name).eq('von', p.ab).eq('bis', p.ende).maybeSingle()
  if (error || !data) return { error: error || { message: 'Zeile nicht gefunden' } }
  return { row: data }
}

export async function extrasSpeichern(row, extras) {
  const sauber = (extras || []).filter(e => e && String(e.text || '').trim() && Number.isFinite(Number(e.betrag)))
    .map(e => ({ text: String(e.text).trim().slice(0, 120), betrag: round(e.betrag) }))
  return supabase.from('chatter_abrechnungen').update({ extras: sauber }).eq('id', row.id)
}

// Bescheid geben: Zahlen festschreiben (aktueller Stand), Chatter sieht es, Telegram
export async function mitteilen(item, p, { wer, telegram = true } = {}) {
  const r = await zeileSichern(item, p, wer)
  if (r.error) return r
  const felder = { mitgeteilt_am: new Date().toISOString(), mitgeteilt_von: wer || null, ...(item.live || {}) }
  const { data, error } = await supabase.from('chatter_abrechnungen').update(felder).eq('id', r.row.id).select().maybeSingle()
  if (error) return { error }
  let gesendet = false
  if (telegram && item.telegram) {
    const res = await sendTelegramMessage(item.telegram, nachricht(data || { ...r.row, ...felder })).catch(() => null)
    gesendet = !!res?.ok
  }
  return { row: data, gesendet }
}

// Neue Zahlen übernehmen (nach CSV-Nachtrag), Status bleibt
export async function zahlenAktualisieren(item) {
  if (!item.row || !item.live) return {}
  return supabase.from('chatter_abrechnungen').update({ ...item.live }).eq('id', item.row.id)
}

export function nachricht(a) {
  const k = a.kurs != null ? Number(a.kurs) : null
  const vorname = String(a.chatter_name).split(' ')[0]
  const z = [
    `Hi ${escHtml(vorname)} 👋`, '',
    `deine Abrechnung für ${escHtml(a.bezeichnung || a.monat)} (${datum(a.von)}–${datum(a.bis)}):`, '',
    `${a.nur_chat === false ? 'Umsatz gesamt' : 'Chat Revenue'}: ${dollar(a.nur_chat === false ? a.umsatz_gesamt_usd : a.umsatz_chat_usd)}`,
  ]
  if (a.prozent != null) z.push(`Dein Satz: ${String(a.prozent).replace('.', ',')} %`, `Dein Anteil: ${dollar(a.auszahlung_usd)}`)
  if (k) z.push(`Kurs: 1 $ = ${String(k).replace('.', ',')} € → ${euro(a.betrag_eur)}`)
  for (const e of extrasVon(a)) z.push(`${Number(e.betrag) < 0 ? '−' : '+'} ${escHtml(e.text)}: ${euro(Math.abs(Number(e.betrag)))}`)
  const g = gesamtEur(a)
  z.push('', g != null ? `👉 Auf deine Rechnung: <b>${euro(g)}</b>` : '👉 Der Euro-Betrag folgt, sobald der Kurs feststeht.')
  z.push('', `🧾 Bitte schreib deine Rechnung und lade sie im Dashboard hoch (Startseite → „Rechnung“).`)
  const l = link(); if (l) z.push(`<a href="${l}">Dashboard öffnen</a>`)
  z.push('', 'Danke für deinen Einsatz! 💜', 'Thirteen 87')
  return z.join('\n')
}

async function telegramVonChatter(name) {
  const { data } = await supabase.from('chatters_contact').select('telegram_id').eq('name', name).maybeSingle()
  return data?.telegram_id || null
}

// ── Rechnung hochladen (Chatter selbst oder Admin für ihn) ───────────────────
export async function rechnungHochladen(a, datei, { betrag = null, durchAdmin = false } = {}) {
  if (!datei) return { error: { message: 'Keine Datei gewählt.' } }
  if (datei.size > 15 * 1024 * 1024) return { error: { message: 'Datei ist größer als 15 MB.' } }
  const endung = (String(datei.name).match(/\.([a-z0-9]{2,5})$/i)?.[1] || 'pdf').toLowerCase()
  const pfad = `${a.chatter_name}/${a.id}-${Date.now()}.${endung}`
  const up = await supabase.storage.from('rechnungen').upload(pfad, datei, { contentType: datei.type || (endung === 'pdf' ? 'application/pdf' : 'image/jpeg'), upsert: false })
  if (up.error) return { error: up.error }
  const url = supabase.storage.from('rechnungen').getPublicUrl(pfad).data.publicUrl
  const felder = { rechnung_url: url, rechnung_name: String(datei.name).slice(0, 120) }
  const b = zahlAus(betrag)
  if (betrag != null && String(betrag).trim() !== '' && b != null) felder.rechnung_betrag = b
  const { error } = await supabase.from('chatter_abrechnungen').update(felder).eq('id', a.id)
  if (error) return { error }
  if (!durchAdmin) {
    try { await notifyAdmins(`🧾 <b>${escHtml(a.chatter_name)}</b> hat die Rechnung für ${escHtml(a.bezeichnung || a.monat)} hochgeladen${felder.rechnung_betrag != null ? ` (${euro(felder.rechnung_betrag)})` : ''}.\n<a href="${link('?tab=buchhaltung')}">Zur Buchhaltung</a>`) } catch { /* nur Hinweis */ }
  }
  return {}
}

// ── Admin-Aktionen ─────────────────────────────────────────────────────────
export async function alsBezahlt(a, { am, betrag, telegram = true }) {
  const b = zahlAus(betrag)
  const { error } = await supabase.from('chatter_abrechnungen').update({ status: 'bezahlt', bezahlt_am: am || heuteIso(), bezahlt_betrag: b }).eq('id', a.id)
  if (error) return { error }
  let info = ''
  if (telegram) {
    const tg = await telegramVonChatter(a.chatter_name)
    if (tg) {
      const r = await sendTelegramMessage(tg, `✅ Deine Abrechnung für ${escHtml(a.bezeichnung || a.monat)} ist bezahlt.\nÜberwiesen am ${datum(am || heuteIso())}${b ? ` · ${euro(b)}` : ''}\n\nThirteen 87`).catch(() => null)
      info = r?.ok ? 'Chatter per Telegram informiert' : 'Telegram ging nicht raus'
    } else info = 'Chatter hat keine Telegram-ID'
  }
  return { info }
}

export async function bezahltZurueck(a) {
  return supabase.from('chatter_abrechnungen').update({ status: a.rechnung_url ? 'rechnung' : 'offen' }).eq('id', a.id)
}

export async function klaerung(a, notiz) {
  const n = String(notiz || '').trim()
  const { error } = await supabase.from('chatter_abrechnungen').update({ status: 'klaerung', klaerung_notiz: n || null }).eq('id', a.id)
  if (error) return { error }
  const tg = await telegramVonChatter(a.chatter_name)
  if (!tg) return { info: 'Chatter hat keine Telegram-ID, bitte selbst Bescheid geben' }
  const r = await sendTelegramMessage(tg, `🧾 Zu deiner Rechnung für ${escHtml(a.bezeichnung || a.monat)} gibt es eine Rückfrage:\n\n${escHtml(n || 'Bitte melde dich kurz.')}\n\nDu kannst im Dashboard eine neue Rechnung hochladen.\n<a href="${link()}">Dashboard öffnen</a>\n\nThirteen 87`).catch(() => null)
  return { info: r?.ok ? 'Chatter per Telegram informiert' : 'Telegram ging nicht raus' }
}

export async function erinnern(liste) {
  let gesendet = 0, ohne = 0
  for (const a of liste) {
    const tg = await telegramVonChatter(a.chatter_name)
    if (!tg) { ohne++; continue }
    const g = gesamtEur(a)
    const r = await sendTelegramMessage(tg, `🧾 Kleine Erinnerung: Deine Rechnung für ${escHtml(a.bezeichnung || a.monat)} fehlt noch.\nAuf die Rechnung: ${g != null ? euro(g) : dollar(a.auszahlung_usd)}\n\nBitte im Dashboard hochladen (Startseite → „Rechnung“).\n<a href="${link()}">Dashboard öffnen</a>\n\nThirteen 87`).catch(() => null)
    if (r?.ok) { gesendet++; await supabase.from('chatter_abrechnungen').update({ erinnert_am: new Date().toISOString() }).eq('id', a.id) }
  }
  return { gesendet, ohne }
}

// Entwurf verwerfen (nur solange nicht mitgeteilt, ohne Rechnung und nicht bezahlt)
export async function zurueckziehen(a) {
  return supabase.from('chatter_abrechnungen').delete().eq('id', a.id)
}
