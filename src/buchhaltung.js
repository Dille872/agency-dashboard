// ── Buchhaltung (v5.37.0 · v5.37.1) ────────────────────────────────────────
// v5.37.1: Die Zahlen stehen automatisch drin — dieselbe Rechnung wie Billing
// (billingRechnung.js), live für den gewählten Monat/Zeitraum. Solange eine
// Abrechnung nicht mitgeteilt ist, ist sie euer ENTWURF: Extras eintragen
// (z. B. Skripte, Bonus, Abzug), Bezahlt drücken, Rechnung selbst hochladen.
// Mit „Bescheid geben“ werden die Zahlen festgeschrieben, der Chatter sieht sie
// im Portal und bekommt eine Telegram-Nachricht.
// Eine Zeile in chatter_abrechnungen entsteht erst, wenn ihr etwas daran tut.
// v5.39.0: KEIN „Bescheid geben“ mehr und keine automatischen Nachrichten.
// Chatter laden ihre Rechnung jederzeit selbst hoch (Monat wählen → Datei);
// die Zeile legen sie dabei selbst an (meineZeile). Die Zahlen sind immer live,
// bis „Bezahlt“ gedrückt wird — dann werden sie in der Zeile festgehalten.
// v5.38.0: Auch Team (z. B. Alina, in $) und Rechnungen ohne Profil (ehemalige
// Chatter wie Joel) — Einträge von Hand mit Betrag, Währung, Notiz, Datei.
// Aus PDF-Rechnungen werden Summe und IBAN vorgeschlagen (rechnungLesen.js).

import { supabase } from './supabase'
import { sendTelegramMessage, notifyAdmins } from './telegram'
import { chatterVerteilen, chatterRechnung, istInaktiv } from './billingRechnung'
import { zeitraumText, abrechnungenPdf } from './billingExport'
import { signiert, zerlege } from './medien'
import { rechnungLesen } from './rechnungLesen'

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
export const fehltTabelle = (error) => !!error && /chatter_abrechnungen|extras|mitgeteilt|betrag_manuell|waehrung|rechnung_iban|betrag_erkannt|\bart\b|does not exist|schema cache|no unique or exclusion/i.test(error.message || '')
export const zahlAus = (t) => { const n = Number(String(t ?? '').trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null }
export const letzterTagVon = (monat) => { const [y, m] = monat.split('-').map(Number); return `${monat}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` }
const round = (v) => Math.round(Number(v || 0) * 100) / 100
const escHtml = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const link = (q = '') => { try { return `${window.location.origin}/${q}` } catch { return '' } }

export const ART = {
  chatter: { label: 'Chatter' },
  team:    { label: 'Team', farbe: '#22d3ee' },
  extern:  { label: 'Ohne Profil', farbe: '#f472b6' },
}
export const istManuell = (row) => !!row && !!row.art && row.art !== 'chatter'
export const geld = (v, waehrung = 'EUR') => waehrung === 'USD' ? dollar(v) : euro(v)

// Status einer Zeile (Chatter ohne Zeile oder nicht mitgeteilt = Entwurf; Team/Extern nie)
export const statusVon = (row) => !row ? 'offen' : row.status
export const extrasVon = (row) => Array.isArray(row?.extras) ? row.extras : []
export const extrasSumme = (row) => extrasVon(row).reduce((t, e) => t + Number(e.betrag || 0), 0)
// Gesamtbetrag in € (Anteil + Extras); ohne Kurs: null
export const gesamtEur = (row) => istManuell(row)
  ? (row.waehrung === 'USD' ? null : round(Number(row.betrag_manuell || 0) + extrasSumme(row)))
  : row?.betrag_eur == null ? (extrasVon(row).length ? round(extrasSumme(row)) : null) : round(Number(row.betrag_eur) + extrasSumme(row))
// Gesamt in der Währung der Zeile: { wert, waehrung }
export const gesamt = (row) => istManuell(row)
  ? { wert: row.betrag_manuell == null && !extrasVon(row).length ? null : round(Number(row.betrag_manuell || 0) + extrasSumme(row)), waehrung: row.waehrung || 'EUR' }
  : { wert: gesamtEur(row), waehrung: 'EUR' }

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
  const chatterZeilen = gespeichert.filter(r => !istManuell(r))
  const manuell = gespeichert.filter(istManuell)
  const namen = [...new Set([...live.keys(), ...chatterZeilen.map(r => r.chatter_name)])].sort((a, b) => a.localeCompare(b, 'de'))
  const telegram = Object.fromEntries(chatters.map(ch => [ch.name, ch.telegram_id || null]))
  const items = [
    ...namen.map(name => ({ name, live: live.get(name) || null, row: chatterZeilen.find(r => r.chatter_name === name) || null, telegram: telegram[name] || null })),
    ...manuell.sort((a, b) => a.chatter_name.localeCompare(b.chatter_name, 'de')).map(row => ({ name: row.chatter_name, live: null, row, telegram: null, manuell: true })),
  ]
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
  // bezahlt → festgehaltene Zahlen; sonst live (wie Billing)
  const fest = row && row.status === 'bezahlt' && row.auszahlung_usd != null
  const zahlen = fest || !live ? (row || {}) : live
  const pp = item.p || {}
  return { monat: pp.bezug, von: pp.ab, bis: pp.ende, frei: pp.frei, bezeichnung: pp.bezeichnung, ...(row || {}), ...Object.fromEntries(ZAHLFELDER.map(k => [k, zahlen[k] ?? null])), chatter_name: item.name, extras: extrasVon(row) }
}
// Weicht das Festgeschriebene von den aktuellen Daten ab? (z. B. CSV nachgeladen)
export const veraltet = () => false   // v5.39.0: nichts mehr festgeschrieben vor „Bezahlt“

// Zeile sicherstellen (entsteht erst bei der ersten Aktion). Gibt die Zeile zurück.
export async function zeileSichern(item, p, wer) {
  if (item.row) return { row: item.row }
  const neu = {
    chatter_name: item.name, monat: p.bezug, von: p.ab, bis: p.ende, frei: p.frei, bezeichnung: p.bezeichnung,
    ...(item.live || {}), freigegeben_von: wer || null,
  }
  const ins = await supabase.from('chatter_abrechnungen').upsert({ ...neu, art: 'chatter' }, { onConflict: 'chatter_name,von,bis,art', ignoreDuplicates: true })
  if (ins.error) return { error: ins.error }
  const { data, error } = await supabase.from('chatter_abrechnungen').select('*').eq('chatter_name', item.name).eq('von', p.ab).eq('bis', p.ende).eq('art', 'chatter').maybeSingle()
  if (error || !data) return { error: error || { message: 'Zeile nicht gefunden' } }
  return { row: data }
}

// Chatter: eigene Zeile für einen Monat holen oder anlegen (nur Name + Monat)
export async function meineZeile(name, monat) {
  const p = periode({ monat, frei: false })
  const ins = await supabase.from('chatter_abrechnungen').upsert(
    { chatter_name: name, monat: p.bezug, von: p.ab, bis: p.ende, frei: false, bezeichnung: p.bezeichnung, art: 'chatter' },
    { onConflict: 'chatter_name,von,bis,art', ignoreDuplicates: true })
  if (ins.error) return { error: ins.error }
  const { data, error } = await supabase.from('chatter_abrechnungen').select('*').eq('chatter_name', name).eq('von', p.ab).eq('bis', p.ende).eq('art', 'chatter').maybeSingle()
  if (error || !data) return { error: error || { message: 'Konnte nicht angelegt werden' } }
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
export async function rechnungHochladen(a, datei, { betrag = null, iban = null, durchAdmin = false } = {}) {
  if (!datei) return { error: { message: 'Keine Datei gewählt.' } }
  if (datei.size > 15 * 1024 * 1024) return { error: { message: 'Datei ist größer als 15 MB.' } }
  const endung = (String(datei.name).match(/\.([a-z0-9]{2,5})$/i)?.[1] || 'pdf').toLowerCase()
  const pfad = `${a.chatter_name}/${a.id}-${Date.now()}.${endung}`
  const up = await supabase.storage.from('rechnungen').upload(pfad, datei, { contentType: datei.type || (endung === 'pdf' ? 'application/pdf' : 'image/jpeg'), upsert: false })
  if (up.error) return { error: up.error }
  const url = supabase.storage.from('rechnungen').getPublicUrl(pfad).data.publicUrl
  const felder = { rechnung_url: url, rechnung_name: String(datei.name).slice(0, 120) }
  const b = zahlAus(betrag)
  if (betrag != null && String(betrag).trim() !== '' && b != null) { felder.rechnung_betrag = b; felder.betrag_erkannt = false }
  if (iban) felder.rechnung_iban = String(iban).replace(/\s/g, '').toUpperCase()
  // v5.38.0: Summe und IBAN aus der PDF vorschlagen, wenn nichts angegeben ist
  if (felder.rechnung_betrag == null || !felder.rechnung_iban) {
    const g = await rechnungLesen(datei)
    if (felder.rechnung_betrag == null) { felder.rechnung_betrag = g.betrag ?? null; felder.betrag_erkannt = g.betrag != null }
    if (!felder.rechnung_iban && g.iban) felder.rechnung_iban = g.iban
  }
  let { error } = await supabase.from('chatter_abrechnungen').update(felder).eq('id', a.id)
  if (error && /rechnung_iban|betrag_erkannt/.test(error.message || '')) {
    // Datenbank noch ohne die neuen Spalten (sql/buchhaltung-team.sql) → ohne sie speichern
    const { rechnung_iban, betrag_erkannt, ...rest } = felder; void rechnung_iban; void betrag_erkannt
    error = (await supabase.from('chatter_abrechnungen').update(rest).eq('id', a.id)).error
  }
  if (error) return { error }
  if (!durchAdmin) {
    try { await notifyAdmins(`🧾 <b>${escHtml(a.chatter_name)}</b> hat die Rechnung für ${escHtml(a.bezeichnung || a.monat)} hochgeladen${felder.rechnung_betrag != null ? ` (${euro(felder.rechnung_betrag)})` : ''}.\n<a href="${link('?tab=buchhaltung')}">Zur Buchhaltung</a>`) } catch { /* nur Hinweis */ }
  }
  return {}
}

// ── Team & ohne Profil (v5.38.0) ─────────────────────────────────────────────
// Einträge von Hand: Name frei, Monat, Betrag + Währung, Notiz, Datei optional.
export async function manuellSpeichern(row, { name, art, monat, betrag, waehrung, notiz, iban, wer }) {
  const n = String(name || '').trim()
  if (!n) return { error: { message: 'Bitte einen Namen eintragen.' } }
  const b = zahlAus(betrag)
  const felder = {
    chatter_name: n.slice(0, 80), art: art === 'team' ? 'team' : 'extern', waehrung: waehrung === 'USD' ? 'USD' : 'EUR',
    betrag_manuell: b, notiz: String(notiz || '').trim() || null,
    ...(iban !== undefined ? { rechnung_iban: iban ? String(iban).replace(/\s/g, '').toUpperCase() : null } : {}),
  }
  if (row) {
    const { data, error } = await supabase.from('chatter_abrechnungen').update(felder).eq('id', row.id).select().maybeSingle()
    return error ? { error } : { row: data }
  }
  const p = periode({ monat, frei: false })
  const { data, error } = await supabase.from('chatter_abrechnungen').insert({
    ...felder, monat: p.bezug, von: p.ab, bis: p.ende, frei: false, bezeichnung: p.bezeichnung, freigegeben_von: wer || null, status: 'offen',
  }).select().maybeSingle()
  if (error && /duplicate|unique/i.test(error.message || '')) return { error: { message: `Für ${n} gibt es in ${p.bezeichnung} schon einen Eintrag dieser Art — bitte den bearbeiten.` } }
  return error ? { error } : { row: data }
}

// Letzter Eintrag dieser Person (für Vorschläge: Art, Währung, Betrag, Notiz)
export async function letzterEintrag(name) {
  const n = String(name || '').trim()
  if (!n) return null
  const { data } = await supabase.from('chatter_abrechnungen').select('art,waehrung,betrag_manuell,notiz').ilike('chatter_name', n).neq('art', 'chatter').order('von', { ascending: false }).limit(1)
  return data?.[0] || null
}

// Namen fürs Eingabefeld: Team-Mitglieder + Chatter-Kontakte (auch inaktive)
export async function namenVorschlaege() {
  const [u, c] = await Promise.all([
    supabase.from('user_roles').select('display_name'),
    supabase.from('chatters_contact').select('name'),
  ])
  return [...new Set([...(u.data || []).map(x => x.display_name), ...(c.data || []).map(x => x.name)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'))
}

export async function eintragLoeschen(row) {
  return supabase.from('chatter_abrechnungen').delete().eq('id', row.id)
}

// v5.38.1: schon hochgeladene Rechnung nachträglich lesen (Summe/IBAN)
export async function rechnungNeuLesen(row) {
  try {
    const url = await signiert(row.rechnung_url, 600)
    const resp = await fetch(url)
    if (!resp.ok) return { leer: true, grund: 'fehler' }
    const blob = await resp.blob()
    const name = row.rechnung_name || 'rechnung.pdf'
    const typ = blob.type && blob.type !== 'application/octet-stream' ? blob.type : (/\.pdf$/i.test(name) ? 'application/pdf' : '')
    return rechnungLesen(new File([blob], name, { type: typ }))
  } catch { return { leer: true, grund: 'fehler' } }
}

// Betrag/IBAN der Rechnung von Hand setzen (von euch geprüft → nicht mehr „erkannt“)
export async function rechnungsangabenSpeichern(row, { betrag, iban }) {
  const b = String(betrag ?? '').trim() === '' ? null : zahlAus(betrag)
  if (String(betrag ?? '').trim() !== '' && b == null) return { error: { message: 'Betrag bitte als Zahl, z. B. 447,48.' } }
  const felder = { rechnung_betrag: b, betrag_erkannt: false, rechnung_iban: String(iban || '').replace(/\s/g, '').toUpperCase() || null }
  let { error } = await supabase.from('chatter_abrechnungen').update(felder).eq('id', row.id)
  if (error && /rechnung_iban|betrag_erkannt/.test(error.message || '')) error = (await supabase.from('chatter_abrechnungen').update({ rechnung_betrag: b }).eq('id', row.id)).error
  return error ? { error } : {}
}

// v5.39.1: falsch hochgeladene Rechnung wieder entfernen (Datei + Angaben)
export async function rechnungEntfernen(row) {
  const z = zerlege(row.rechnung_url)
  const felder = { rechnung_url: null, rechnung_name: null, rechnung_betrag: null, rechnung_am: null, rechnung_von: null }
  if (row.status !== 'bezahlt') felder.status = 'offen'
  let { error } = await supabase.from('chatter_abrechnungen').update({ ...felder, rechnung_iban: null, betrag_erkannt: false }).eq('id', row.id)
  if (error && /rechnung_iban|betrag_erkannt/.test(error.message || '')) error = (await supabase.from('chatter_abrechnungen').update(felder).eq('id', row.id)).error
  if (error) return { error }
  if (z) await supabase.storage.from(z.bucket).remove([z.pfad]).catch(() => null)   // Datei weg; klappt das nicht, bleibt sie nur ungenutzt liegen
  return {}
}

// ── Admin-Aktionen ─────────────────────────────────────────────────────────
// v5.37.3: nur intern (damit ihr nachschauen könnt) — KEINE Nachricht an den Chatter
export async function alsBezahlt(a, { am, betrag }) {
  const b = zahlAus(betrag)
  const { error } = await supabase.from('chatter_abrechnungen').update({ status: 'bezahlt', bezahlt_am: am || heuteIso(), bezahlt_betrag: b }).eq('id', a.id)
  return error ? { error } : {}
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

// ── Export für die eigene Buchhaltung (v5.37.3) ─────────────────────────────
// Eine ZIP-Datei: alle Rechnungen im gewählten Zeitraum (ein Ordner je Monat)
// + Übersicht.csv (öffnet in Excel/Numbers). Oder nur die Übersicht als CSV.
const sauberName = (t) => String(t || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80)
const zahlCsv = (v) => v == null || v === '' ? '' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })

export async function exportZeilen({ abMonat, bisMonat, nurBezahlt }) {
  let q = supabase.from('chatter_abrechnungen').select('*').gte('monat', abMonat).lte('monat', bisMonat).order('monat').order('chatter_name')
  if (nurBezahlt) q = q.eq('status', 'bezahlt')
  const { data, error } = await q
  if (error) return { error }
  return { zeilen: data || [] }
}

function dateiName(a) {
  const endung = (String(a.rechnung_name || a.rechnung_url || '').match(/\.([a-z0-9]{2,5})(?:$|\?)/i)?.[1] || 'pdf').toLowerCase()
  const zr = a.frei ? `${a.von}_bis_${a.bis}` : a.monat
  return sauberName(`${zr} ${a.chatter_name} Rechnung`) + '.' + endung
}

function uebersichtCsv(zeilen) {
  const kopf = ['Monat', 'Zeitraum von', 'Zeitraum bis', 'Name', 'Art', 'Notiz', 'Umsatz $', 'Satz %', 'Anteil $', 'Kurs', 'Anteil €', 'Betrag (Team/ohne Profil)', 'Extras', 'Extras Summe', 'Gesamt', 'Währung', 'Rechnung', 'Rechnungsbetrag', 'IBAN', 'Rechnung hochgeladen', 'Status', 'Bezahlt am', 'Bezahlt', 'Bezahlt von']
  const zelle = (v) => { const t = String(v ?? ''); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }
  const rows = zeilen.map(a => [
    a.monat, a.von, a.bis, a.chatter_name, (ART[a.art] || ART.chatter).label, a.notiz || '',
    istManuell(a) ? '' : zahlCsv(a.nur_chat === false ? a.umsatz_gesamt_usd : a.umsatz_chat_usd), istManuell(a) ? '' : zahlCsv(a.prozent), istManuell(a) ? '' : zahlCsv(a.auszahlung_usd), !istManuell(a) && a.kurs != null ? String(a.kurs).replace('.', ',') : '',
    istManuell(a) ? '' : zahlCsv(a.betrag_eur), istManuell(a) ? zahlCsv(a.betrag_manuell) : '', extrasVon(a).map(e => `${e.text}: ${zahlCsv(e.betrag)}`).join(' | '), zahlCsv(extrasSumme(a)), zahlCsv(gesamt(a).wert), gesamt(a).waehrung,
    a.rechnung_url ? dateiName(a) : '', zahlCsv(a.rechnung_betrag), a.rechnung_iban || '', a.rechnung_am ? datum(a.rechnung_am) : '',
    (STATUS[statusVon(a)] || STATUS.offen).label, a.bezahlt_am ? datum(a.bezahlt_am) : '', zahlCsv(a.bezahlt_betrag), a.bezahlt_von || '',
  ])
  return '\uFEFF' + [kopf, ...rows].map(r => r.map(zelle).join(';')).join('\r\n')
}

function herunterladen(blob, name) {
  const url = URL.createObjectURL(blob)
  const el = document.createElement('a'); el.href = url; el.download = name
  document.body.appendChild(el); el.click(); el.remove()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}

const exportTitel = (abMonat, bisMonat) => abMonat === bisMonat ? abMonat : `${abMonat}_bis_${bisMonat}`

export async function exportCsv(opt) {
  const r = await exportZeilen(opt)
  if (r.error) return r
  herunterladen(new Blob([uebersichtCsv(r.zeilen)], { type: 'text/csv;charset=utf-8' }), `Buchhaltung-${exportTitel(opt.abMonat, opt.bisMonat)}.csv`)
  return { anzahl: r.zeilen.length }
}

export async function exportZip(opt, fortschritt = () => {}) {
  const r = await exportZeilen(opt)
  if (r.error) return r
  const { zipSync, strToU8 } = await import('fflate')
  const dateien = { 'Übersicht.csv': strToU8(uebersichtCsv(r.zeilen)) }
  const mitDatei = r.zeilen.filter(a => a.rechnung_url)
  const fehlen = []
  let n = 0
  for (const a of mitDatei) {
    fortschritt(++n, mitDatei.length)
    try {
      const url = await signiert(a.rechnung_url, 600)
      const resp = await fetch(url)
      if (!resp.ok) throw new Error('HTTP ' + resp.status)
      const ordner = sauberName(monatName(a.monat))
      let name = `${a.monat} ${ordner}/${dateiName(a)}`
      let i = 2
      while (dateien[name]) name = `${a.monat} ${ordner}/${dateiName(a).replace(/(\.[a-z0-9]+)$/i, ` (${i++})$1`)}`
      dateien[name] = new Uint8Array(await resp.arrayBuffer())
    } catch { fehlen.push(a.chatter_name + ' ' + a.monat) }
  }
  if (fehlen.length) dateien['Nicht geladen.txt'] = strToU8('Diese Rechnungen konnten nicht geladen werden:\n' + fehlen.join('\n'))
  const zip = zipSync(dateien, { level: 0 })   // PDFs/Bilder sind schon komprimiert
  herunterladen(new Blob([zip], { type: 'application/zip' }), `Rechnungen-${exportTitel(opt.abMonat, opt.bisMonat)}.zip`)
  return { anzahl: r.zeilen.length, dateien: mitDatei.length - fehlen.length, fehlen }
}
