// Team-Kalender — Admin-Ansicht.
//
// v4.60.0 Stufe 1 · v4.61.0 Telegram/Erinnerungen · v4.62.0 Team-Schichten
// v4.64.0: Stundenraster wie im Entwurf (Seitenleiste links, Raster Mitte,
//          Details rechts), Folgeaufgaben an Events/Terminen, Mobil = Tagesansicht.
// v4.65.0: Wiederholungen (Serie = einzelne Zeilen mit serie_id, damit
//          Erinnerung und „erledigt" pro Termin funktionieren), Erledigt-Meldung
//          ans Team, Abhaken direkt im Admin-Kalender.
//
// Zeit wie im Dienstplan: EINGABE in deutscher Zeit, gespeichert als fester
// Zeitpunkt, ANZEIGE in der eigenen Zeit (Geräte-Uhr bzw. bestätigte Zone)
// oder umschaltbar in deutscher Zeit. Models bleiben getrennt — ihre Termine
// und Urlaube erscheinen nur zum Lesen.
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../supabase'
import { logActivity } from '../activity'
import { sendTelegramMessage, zugestellt } from '../telegram'
import { ladeInaktiveNamen, ohneInaktive } from '../people'
import {
  BERLIN, meineZone, wandzeitZuDatum, datumInZone, zeitIn, utcLabel, ortAus, TEAM_ZONEN,
} from '../zeit'
import ZeitzonenHinweis from './ZeitzonenHinweis'

export const ARTEN = [
  { key: 'aufgabe', label: 'Aufgabe', farbe: '#f59e0b' },
  { key: 'event', label: 'Event', farbe: '#ec4899' },
  { key: 'termin', label: 'Team-Termin', farbe: '#8b5cf6' },
  { key: 'erinnerung', label: 'Erinnerung', farbe: '#06b6d4' },
]
export const artInfo = (k) => ARTEN.find(a => a.key === k) || ARTEN[0]
const MODEL_FARBE = '#10b981'
const SCHICHT_FARBE = '#64748b'
// Admins haben keinen Eintrag in chatters_contact — ihre Telegram-IDs
const ADMIN_TG = { chris: '1538601588', rey: '528328429' }
const ERINNERUNGEN = [
  { min: null, label: 'keine' }, { min: 15, label: '15 Min vorher' }, { min: 30, label: '30 Min vorher' },
  { min: 60, label: '1 Std vorher' }, { min: 120, label: '2 Std vorher' }, { min: 1440, label: '1 Tag vorher' },
]
const FOLGE_OFFSETS = [
  { min: 0, label: 'direkt' }, { min: 15, label: '+15 Min' }, { min: 30, label: '+30 Min' },
  { min: 60, label: '+1 Std' }, { min: 120, label: '+2 Std' },
]
export const WIEDERHOLUNGEN = [
  { key: '', label: 'nicht wiederholen' }, { key: 'taeglich', label: 'täglich' }, { key: 'woechentlich', label: 'wöchentlich' },
  { key: 'zweiwoechentlich', label: 'alle 2 Wochen' }, { key: 'monatlich', label: 'monatlich' },
]
export const wdhLabel = (k) => WIEDERHOLUNGEN.find(w => w.key === k)?.label || 'Serie'
const MAX_SERIE = 60
const MODUS = { anlernen: 'Anlernen', co: 'Co-Schicht', split: 'geteilt' }
const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const STUNDE_PX = 44
const OHNE_ENDE_MIN = 30 // Einträge ohne Ende: so hoch wie 30 Minuten

// Kalendertag-Arithmetik auf "YYYY-MM-DD" (zeitzonenfrei, über 12:00 UTC)
const plusTage = (tag, n) => { const d = new Date(tag + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const wochentag = (tag) => (new Date(tag + 'T12:00:00Z').getUTCDay() + 6) % 7 // Mo=0
const montagVon = (tag) => plusTage(tag, -wochentag(tag))
const kurzTag = (tag) => new Date(tag + 'T12:00:00Z').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
const normName = (s) => String(s || '').trim().toLowerCase()
const tageZwischen = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5)

// Kalendertage einer Serie (deutsche Kalendertage, inkl. Start, bis einschließlich)
export function serienTage(start, regel, bis) {
  if (!regel || !bis) return [start]
  const out = []
  const [y, m, d] = start.split('-').map(Number)
  for (let i = 0; out.length < MAX_SERIE && i < 400; i++) {
    let t
    if (regel === 'monatlich') {
      const dt = new Date(Date.UTC(y, m - 1 + i, d, 12))
      t = dt.toISOString().slice(0, 10)
      if (t > bis) break
      if (dt.getUTCDate() !== d) continue // z. B. 31. im Februar → Monat auslassen
    } else {
      t = plusTage(start, i * (regel === 'taeglich' ? 1 : regel === 'woechentlich' ? 7 : 14))
      if (t > bis) break
    }
    out.push(t)
  }
  return out
}

// v4.65.0: Rückmeldung „erledigt" an Chris und Rey (nicht an sich selbst)
export async function erledigtMelden(e, erledigtVon, wer) {
  const liste = erledigtVon || []
  let stand = ''
  if (!e.fuer_alle && (e.fuer || []).length > 1) {
    const offen = e.fuer.filter(n => !liste.some(x => normName(x) === normName(n)))
    stand = offen.length ? `\n\nNoch offen: ${offen.join(', ')}` : '\n\nDamit sind alle fertig ✓'
  }
  const bezug = e.folge_titel ? `\n↳ Folgeaufgabe zu: ${e.folge_titel}` : ''
  const text = `✅ <b>${wer || 'Jemand'}</b> hat erledigt (Kalender):\n\n${e.titel}${bezug}${stand}`
  for (const [name, id] of Object.entries(ADMIN_TG)) {
    if (name === normName(wer)) continue
    try { await sendTelegramMessage(id, text) } catch (err) { console.error('Telegram:', err) }
  }
}

const leer = () => ({ id: null, titel: '', art: 'aufgabe', tag: datumInZone(new Date(), BERLIN).tag, von: '', bis: '', notiz: '', fuer: [], fuer_alle: false, erinnern_min: null, telegram: true, folgen: [], folgenAlt: [], wiederholung: '', wdhBis: '', serie_id: null, umfang: 'diesen', folge_von: null, altBeginn: null })
const neueFolge = (fuer = []) => ({ tmp: Math.random().toString(36).slice(2), titel: '', bezug: 'ende', offset: 0, fuer: [...fuer] })

// Beginn einer Folgeaufgabe aus Event-Zeiten
const folgeBeginn = (beginn, ende, bezug, offset) => {
  const basis = bezug === 'beginn' || !ende ? beginn : ende
  return new Date(basis.getTime() + (offset || 0) * 60000)
}

// Überlappende Blöcke nebeneinander legen (Spalten innerhalb eines Tages)
function spaltenVerteilen(bloecke) {
  const sortiert = [...bloecke].sort((a, b) => a.start - b.start || b.ende - a.ende)
  let cluster = [], clusterEnde = -1
  const fertig = []
  const abschliessen = () => {
    const spalten = []
    for (const b of cluster) {
      let i = spalten.findIndex(ende => ende <= b.start)
      if (i < 0) { i = spalten.length; spalten.push(0) }
      spalten[i] = b.ende
      b.spalte = i
    }
    for (const b of cluster) { b.spalten = spalten.length; fertig.push(b) }
    cluster = []
  }
  for (const b of sortiert) {
    if (cluster.length && b.start >= clusterEnde) { abschliessen(); clusterEnde = -1 }
    cluster.push(b); clusterEnde = Math.max(clusterEnde, b.ende)
  }
  if (cluster.length) abschliessen()
  return fertig
}

function useBreite() {
  const [b, setB] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1400))
  useEffect(() => {
    const on = () => setB(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return b
}

export default function CalendarTab({ userDisplayName }) {
  const breite = useBreite()
  const mobil = breite < 900
  const [, setZonenStand] = useState(0)
  const [zoneModus, setZoneModus] = useState('lokal') // 'lokal' | 'berlin'
  const anzeigeZone = zoneModus === 'berlin' ? BERLIN : meineZone()
  const heute = datumInZone(new Date(), anzeigeZone).tag
  const [woche, setWoche] = useState(() => montagVon(datumInZone(new Date(), meineZone()).tag))
  const [mobilTag, setMobilTag] = useState(() => datumInZone(new Date(), meineZone()).tag)
  const [eintraege, setEintraege] = useState([])
  const [modelSachen, setModelSachen] = useState([])
  const [personen, setPersonen] = useState([])
  const [teamNamen, setTeamNamen] = useState([])
  const [zonenListe, setZonenListe] = useState([])
  const [ebenen, setEbenen] = useState({ aufgabe: true, event: true, termin: true, erinnerung: true, models: true, schichten: true })
  const [schichten, setSchichten] = useState([])
  const [auswahl, setAuswahl] = useState(null) // { typ: 'eintrag'|'schicht', daten }
  const [form, setForm] = useState(null)
  const [speichert, setSpeichert] = useState(false)
  const [fehler, setFehler] = useState(null)
  const [jetzt, setJetzt] = useState(Date.now())
  const rasterRef = useRef(null)

  useEffect(() => { const t = setInterval(() => setJetzt(Date.now()), 60000); return () => clearInterval(t) }, [])

  const tage = useMemo(() => Array.from({ length: 7 }, (_, i) => plusTage(woche, i)), [woche])
  // Mobil: der gewählte Tag muss in der angezeigten Woche liegen
  useEffect(() => { if (!tage.includes(mobilTag)) setMobilTag(tage.includes(heute) ? heute : tage[0]) }, [tage]) // eslint-disable-line react-hooks/exhaustive-deps
  const sichtbareTage = mobil ? [mobilTag] : tage

  // Beim Öffnen auf ~7 Uhr scrollen (bzw. etwas vor die aktuelle Stunde)
  useEffect(() => {
    if (!rasterRef.current) return
    const h = Math.max(0, Math.min(7, new Date().getHours() - 2))
    rasterRef.current.scrollTop = h * STUNDE_PX
  }, [mobil])

  const laden = useCallback(async () => {
    setFehler(null)
    const von = wandzeitZuDatum(plusTage(woche, -1), '00:00', 'UTC').toISOString()
    const bis = wandzeitZuDatum(plusTage(woche, 8), '23:59', 'UTC').toISOString()
    const [k, mc, mb, sc, mo] = await Promise.all([
      supabase.from('team_kalender').select('*').gte('beginn', von).lte('beginn', bis).order('beginn'),
      supabase.from('model_calendar').select('id, model_name, title, description, due_date, due_time, category')
        .in('category', ['termin', 'reise']).gte('due_date', plusTage(woche, -1)).lte('due_date', plusTage(woche, 7)),
      supabase.from('model_board').select('id, model_name, category, title, date, date_from, date_to')
        .in('category', ['reise', 'termine']),
      supabase.from('schedule').select('week_start, status, assignments, shift_times')
        .gte('week_start', plusTage(woche, -7)).lte('week_start', plusTage(woche, 7)),
      supabase.from('models_contact').select('id, name'),
    ])
    if (k.error) { setFehler(k.error.message.includes('team_kalender') ? 'Die Kalender-Tabelle fehlt noch — bitte das SQL „team-kalender.sql" in Supabase ausführen.' : k.error.message); return }
    setEintraege(k.data || [])
    const ende = plusTage(woche, 6)
    const ms = []
    for (const r of mc.data || []) ms.push({ key: 'mc' + r.id, model: r.model_name, titel: r.title, von: r.due_date, bis: r.due_date, art: r.category === 'reise' ? 'Reise' : 'Termin' })
    for (const r of mb.data || []) {
      const von = r.date_from || r.date, bis = r.date_to || r.date_from || r.date
      if (!von || bis < woche || von > ende) continue
      ms.push({ key: 'mb' + r.id, model: r.model_name, titel: r.title, von, bis, art: r.category === 'reise' ? 'Reise/Urlaub' : 'Termin' })
    }
    setModelSachen(ms)

    // Schichten (Plan in deutscher Zeit) → feste Zeitpunkte; gefiltert aufs Team im Memo
    const modelName = Object.fromEntries((mo.data || []).map(m => [String(m.id), m.name]))
    const sch = []
    for (const w of sc.data || []) {
      const zeiten = w.shift_times || {}
      for (const [key, val] of Object.entries(w.assignments || {})) {
        if (!val || !val.chatter || val.chatter === '__FREI__') continue
        const [modelId, planTag, shift] = key.split('__')
        if (!planTag || planTag < plusTage(woche, -1) || planTag > plusTage(woche, 7)) continue
        const spanne = String(val.time_override || zeiten[`${modelId}__${shift}`] || '').replace(/\s*\(DE\)/g, '')
        const [a, b] = spanne.split('-').map(x => x && x.trim())
        if (!a || !/^\d{1,2}:\d{2}$/.test(a)) continue
        const beginn = wandzeitZuDatum(planTag, a, BERLIN)
        let bisD = b && /^\d{1,2}:\d{2}$/.test(b) ? wandzeitZuDatum(planTag, b, BERLIN) : null
        if (bisD && bisD <= beginn) bisD = new Date(bisD.getTime() + 24 * 3600 * 1000)
        const modus = val.trainee ? (MODUS[val.trainee_mode] || MODUS.anlernen) : null
        const basis = { beginn, ende: bisD, shift, model: modelName[modelId] || modelId, entwurf: w.status !== 'live' }
        sch.push({ ...basis, person: val.chatter, zusatz: val.trainee ? `${modus} mit ${val.trainee}` : '' })
        if (val.trainee) sch.push({ ...basis, person: val.trainee, zusatz: `${modus} bei ${val.chatter}` })
      }
    }
    setSchichten(sch)
  }, [woche])

  useEffect(() => { laden() }, [laden])

  const ladePersonen = useCallback(async () => {
    const [c, u, inaktiv] = await Promise.all([
      supabase.from('chatters_contact').select('name, active').order('name'),
      supabase.from('user_roles').select('display_name, roles, role, status'),
      ladeInaktiveNamen(),
    ])
    const chatter = ohneInaktive(c.data || [], inaktiv).map(x => x.name)
    const team = (u.data || [])
      .filter(x => x.status !== 'suspended' && x.status !== 'offboarded')
      .filter(x => [...(x.roles || []), x.role].some(r => ['admin', 'manager', 'dienstplan', 'creator_manager'].includes(r)))
      .map(x => x.display_name).filter(Boolean)
    setTeamNamen(team)
    const alle = [...new Set([...team, ...chatter])].sort((a, b) => a.localeCompare(b, 'de'))
    const { data: oz } = await supabase.from('online_status').select('display_name, zeitzone, zeitzone_bestaetigt').in('display_name', alle)
    const map = Object.fromEntries((oz || []).map(o => [o.display_name, o]))
    setZonenListe(alle.map(n => ({ name: n, team: team.includes(n), zone: map[n]?.zeitzone || null, bestaetigt: !!map[n]?.zeitzone_bestaetigt })))
    setPersonen(alle)
  }, [])
  useEffect(() => { ladePersonen() }, [ladePersonen])

  // ── Blöcke fürs Raster ───────────────────────────────────────────────────
  const tagesGrenzen = useCallback((tag) => {
    const a = wandzeitZuDatum(tag, '00:00', anzeigeZone).getTime()
    const b = wandzeitZuDatum(plusTage(tag, 1), '00:00', anzeigeZone).getTime()
    return [a, b]
  }, [anzeigeZone])

  const bloeckeProTag = useMemo(() => {
    const m = Object.fromEntries(tage.map(t => [t, []]))
    const eintragen = (start, ende, basis) => {
      for (const t of tage) {
        const [a, b] = tagesGrenzen(t)
        if (ende <= a || start >= b) continue
        const s = Math.max(start, a), e = Math.min(ende, b)
        m[t].push({ ...basis, start: (s - a) / 60000, ende: Math.max((e - a) / 60000, (s - a) / 60000 + 20), fortsetzung: start < a, abgeschnitten: ende > b })
      }
    }
    for (const e of eintraege) {
      if (!ebenen[e.art]) continue
      const s = new Date(e.beginn).getTime()
      const en = e.ende ? new Date(e.ende).getTime() : s + OHNE_ENDE_MIN * 60000
      eintragen(s, en, { typ: 'eintrag', id: e.id, daten: e, farbe: artInfo(e.art).farbe })
    }
    if (ebenen.schichten) {
      const team = new Set(teamNamen.map(normName))
      const ich = normName(userDisplayName)
      const gruppen = {}
      for (const x of schichten) {
        const p = normName(x.person)
        if (!team.has(p) && p !== ich) continue
        const s = x.beginn.getTime(), en = x.ende ? x.ende.getTime() : s + 8 * 3600000
        const k = `${p}|${x.shift}|${s}|${en}`
        if (!gruppen[k]) gruppen[k] = { s, en, person: x.person, ich: p === ich, shift: x.shift, entwurf: false, zeilen: [] }
        gruppen[k].zeilen.push(x.zusatz ? `${x.model} · ${x.zusatz}` : x.model)
        if (x.entwurf) gruppen[k].entwurf = true
      }
      for (const [k, g] of Object.entries(gruppen)) eintragen(g.s, g.en, { typ: 'schicht', id: 'sch' + k, daten: g, farbe: SCHICHT_FARBE })
    }
    for (const t of tage) m[t] = spaltenVerteilen(m[t])
    return m
  }, [eintraege, schichten, ebenen, teamNamen, userDisplayName, tage, tagesGrenzen])

  const modelProTag = useMemo(() => {
    const m = Object.fromEntries(tage.map(t => [t, []]))
    if (!ebenen.models) return m
    for (const s of modelSachen) for (const t of tage) if (t >= s.von && t <= s.bis) m[t].push(s)
    return m
  }, [modelSachen, tage, ebenen])

  // ── Formular ──────────────────────────────────────────────────────────────
  const oeffneNeu = (tag, stunde) => {
    const f = leer()
    if (tag) {
      // Klick ins Raster: Zeitpunkt in der Anzeige-Zone → deutsche Zeit fürs Formular
      const zeitpunkt = wandzeitZuDatum(tag, `${String(stunde ?? 9).padStart(2, '0')}:00`, anzeigeZone)
      const de = datumInZone(zeitpunkt, BERLIN)
      f.tag = de.tag; if (stunde != null) f.von = de.zeit
    }
    setForm(f); setAuswahl(null)
  }
  const oeffneBearbeiten = (e) => {
    const b = datumInZone(e.beginn, BERLIN)
    const folgenAlt = eintraege.filter(x => x.folge_von === e.id)
    setForm({ id: e.id, titel: e.titel, art: e.art, tag: b.tag, von: b.zeit, bis: e.ende ? zeitIn(e.ende, BERLIN) : '', notiz: e.notiz || '', fuer: e.fuer || [], fuer_alle: !!e.fuer_alle, erinnern_min: e.erinnern_min ?? null, telegram: false, folgen: [], folgenAlt, wiederholung: e.wiederholung || '', wdhBis: '', serie_id: e.serie_id || null, umfang: 'diesen', folge_von: e.folge_von || null, altBeginn: e.beginn })
    setAuswahl(null)
  }
  const formBeginn = form && form.tag && form.von ? wandzeitZuDatum(form.tag, form.von, BERLIN) : null
  const formEnde = (() => {
    if (!formBeginn || !form.bis) return null
    let e = wandzeitZuDatum(form.tag, form.bis, BERLIN)
    if (e <= formBeginn) e = new Date(e.getTime() + 24 * 3600 * 1000)
    return e
  })()

  // Telegram an die Empfänger — Uhrzeit in IHRER Zeit (online_status.zeitzone), sonst DE
  const benachrichtigen = async (e, geaendert) => {
    const namen = e.fuer_alle ? personen : (e.fuer || [])
    const [kc, os] = await Promise.all([
      supabase.from('chatters_contact').select('name, telegram_id').in('name', namen),
      supabase.from('online_status').select('display_name, zeitzone').in('display_name', namen),
    ])
    const tg = Object.fromEntries((kc.data || []).filter(x => x.telegram_id).map(x => [x.name, x.telegram_id]))
    const zonen = Object.fromEntries((os.data || []).filter(x => x.zeitzone).map(x => [x.display_name, x.zeitzone]))
    const ok = [], fehlt = [], fehler = []
    const a = artInfo(e.art)
    for (const n of namen) {
      if (n === userDisplayName) continue
      const id = tg[n] || ADMIN_TG[normName(n)]
      if (!id) { fehlt.push(n); continue }
      const zone = zonen[n] || BERLIN
      const b = new Date(e.beginn)
      const wann = `${b.toLocaleDateString('de-DE', { timeZone: zone, weekday: 'long', day: '2-digit', month: '2-digit' })}, ${zeitIn(b, zone)} Uhr`
      const zusatz = zone === BERLIN ? ' (deutsche Zeit)' : ` (deine Zeit · DE ${zeitIn(b, BERLIN)})`
      const bezug = (e.folge_titel ? `\nFolgeaufgabe zu: ${e.folge_titel}` : '') + (e.serie_hinweis ? `\n🔁 ${e.serie_hinweis}` : '')
      const text = `🗓 <b>${geaendert ? 'Geändert im Kalender' : 'Neu im Kalender'}</b>${userDisplayName ? ` · von ${userDisplayName}` : ''}\n\n` +
        `<b>${e.titel}</b>\n${a.label} · ${wann}${zusatz}${bezug}${e.notiz ? `\n\n${e.notiz}` : ''}\n\n– Thirteen 87`
      const res = await sendTelegramMessage(id, text)
      if (zugestellt(res)) ok.push(n); else fehler.push(n)
    }
    return { ok, fehlt, fehler }
  }

  // Beginn/Ende eines Termins an einem deutschen Kalendertag mit den Formular-Uhrzeiten
  const zeitenAm = (tag) => {
    const b = wandzeitZuDatum(tag, form.von, BERLIN)
    let e = form.bis ? wandzeitZuDatum(tag, form.bis, BERLIN) : null
    if (e && e <= b) e = new Date(e.getTime() + 24 * 3600 * 1000)
    return { beginn: b, ende: e }
  }
  const neueSerie = !!(form && form.wiederholung && !form.serie_id && !form.folge_von)
  const serienVorschau = neueSerie && form.wdhBis && form.tag ? serienTage(form.tag, form.wiederholung, form.wdhBis) : null

  const speichern = async () => {
    if (!form.titel.trim()) { alert('Titel fehlt.'); return }
    if (!form.tag || !form.von) { alert('Datum und Uhrzeit (deutsche Zeit) fehlen.'); return }
    if (!form.fuer_alle && form.fuer.length === 0) { alert('Für wen ist der Eintrag? Personen wählen oder „Ganzes Team".'); return }
    const folgenNeu = form.folgen.filter(f => f.titel.trim())
    if (folgenNeu.some(f => f.fuer.length === 0)) { alert('Jede Folgeaufgabe braucht mindestens eine Person.'); return }
    if (neueSerie && (!form.wdhBis || form.wdhBis <= form.tag)) { alert('Bis wann soll wiederholt werden? Bitte ein Datum nach dem ersten Termin wählen.'); return }
    const tageListe = neueSerie ? serienTage(form.tag, form.wiederholung, form.wdhBis) : [form.tag]
    if (tageListe.length >= MAX_SERIE && !confirm(`Es werden höchstens ${MAX_SERIE} Termine angelegt (bis ${kurzTag(tageListe[tageListe.length - 1])}). Weiter?`)) return

    const beginn = formBeginn, ende = formEnde
    const basis = {
      titel: form.titel.trim(), art: form.art,
      notiz: form.notiz.trim() || null, fuer: form.fuer_alle ? [] : form.fuer, fuer_alle: form.fuer_alle,
      erinnern_min: form.erinnern_min ?? null, geaendert_am: new Date().toISOString(),
    }
    const serieId = tageListe.length > 1 ? crypto.randomUUID() : null
    const serieFelder = serieId ? { serie_id: serieId, wiederholung: form.wiederholung } : {}
    const zeile = (tag) => { const z = zeitenAm(tag); return { ...basis, beginn: z.beginn.toISOString(), ende: z.ende ? z.ende.toISOString() : null } }
    const meldungen = []
    const abbruch = (msg) => { setSpeichert(false); alert('⚠ Nicht gespeichert: ' + msg) }
    setSpeichert(true)

    // 1) Termine anlegen / ändern → ziele = die gespeicherten Zeilen (mit id)
    let ziele = []
    let neuDazu = [] // beim Umwandeln eines bestehenden Eintrags in eine Serie
    if (!form.id) {
      const rows = tageListe.map(t => ({ ...zeile(t), ...serieFelder, erstellt_von: userDisplayName || null }))
      const { data, error } = await supabase.from('team_kalender').insert(rows).select()
      if (error) return abbruch(error.message)
      ziele = data || []
    } else if (form.serie_id && form.umfang === 'folgende') {
      const { data: reihe, error } = await supabase.from('team_kalender').select('*')
        .eq('serie_id', form.serie_id).gte('beginn', form.altBeginn).order('beginn')
      if (error) return abbruch(error.message)
      const delta = tageZwischen(datumInZone(form.altBeginn, BERLIN).tag, form.tag)
      for (const r of reihe || []) {
        const z = zeile(plusTage(datumInZone(r.beginn, BERLIN).tag, delta))
        if (new Date(r.beginn).getTime() !== new Date(z.beginn).getTime() || (r.erinnern_min ?? null) !== (form.erinnern_min ?? null)) z.erinnerung_gesendet = false
        const { data, error: e2 } = await supabase.from('team_kalender').update(z).eq('id', r.id).select().single()
        if (e2) { meldungen.push(`${kurzTag(datumInZone(r.beginn, BERLIN).tag)} nicht geändert: ${e2.message}`); continue }
        ziele.push(data)
      }
      if (!ziele.length) return abbruch(meldungen.join('\n') || 'Keine Termine der Serie gefunden.')
    } else {
      const alt = eintraege.find(x => x.id === form.id)
      const z = { ...zeile(form.tag), ...serieFelder }
      if (!alt || new Date(alt.beginn).getTime() !== beginn.getTime() || (alt.erinnern_min ?? null) !== (form.erinnern_min ?? null)) z.erinnerung_gesendet = false
      const { data, error } = await supabase.from('team_kalender').update(z).eq('id', form.id).select().single()
      if (error) return abbruch(error.message)
      ziele = [data]
      if (tageListe.length > 1) {
        const rows = tageListe.slice(1).map(t => ({ ...zeile(t), ...serieFelder, erstellt_von: userDisplayName || null }))
        const { data: d2, error: e2 } = await supabase.from('team_kalender').insert(rows).select()
        if (e2) meldungen.push(`Weitere Termine der Serie NICHT angelegt: ${e2.message}`)
        else { neuDazu = d2 || []; ziele.push(...neuDazu) }
      }
    }
    ziele.sort((a, b) => new Date(a.beginn) - new Date(b.beginn))
    const zeitVon = (z) => [new Date(z.beginn), z.ende ? new Date(z.ende) : null]

    // 2) Bestehende Folgeaufgaben mitziehen (Zeit + Titel des Events)
    let folgenBestand = []
    if (form.id) {
      const bestehende = ziele.filter(z => !neuDazu.includes(z)).map(z => z.id)
      const { data } = await supabase.from('team_kalender').select('*').in('folge_von', bestehende)
      folgenBestand = data || []
      const perId = Object.fromEntries(ziele.map(z => [z.id, z]))
      for (const f of folgenBestand) {
        const p = perId[f.folge_von]; if (!p) continue
        const upd = {}
        if (f.folge_offset_min != null) {
          const neu = folgeBeginn(...zeitVon(p), f.folge_bezug, f.folge_offset_min)
          if (new Date(f.beginn).getTime() !== neu.getTime()) { upd.beginn = neu.toISOString(); upd.erinnerung_gesendet = false }
        }
        if (f.folge_titel !== p.titel) upd.folge_titel = p.titel
        if (!Object.keys(upd).length) continue
        const { error } = await supabase.from('team_kalender').update({ ...upd, geaendert_am: new Date().toISOString() }).eq('id', f.id)
        if (error) meldungen.push(`Folgeaufgabe „${f.titel}" nicht angepasst: ${error.message}`)
      }
    }

    // 3) Neue Folgeaufgaben für jeden Termin (bei Serie: für jeden Termin der Serie).
    //    Beim Umwandeln in eine Serie bekommen die neuen Termine auch die schon
    //    vorhandenen Folgeaufgaben des ersten Termins.
    const defs = folgenNeu.map(f => ({ titel: f.titel.trim(), bezug: f.bezug, offset: f.offset, fuer: f.fuer, ziele }))
    if (neuDazu.length) {
      for (const f of folgenBestand.filter(x => x.folge_von === form.id && x.folge_offset_min != null)) {
        defs.push({ titel: f.titel, bezug: f.folge_bezug, offset: f.folge_offset_min, fuer: f.fuer || [], ziele: neuDazu })
      }
    }
    const folgeRows = []
    for (const d of defs) for (const z of d.ziele) {
      folgeRows.push({
        titel: d.titel, art: 'aufgabe', beginn: folgeBeginn(...zeitVon(z), d.bezug, d.offset).toISOString(), ende: null,
        notiz: null, fuer: d.fuer, fuer_alle: false, erinnern_min: form.erinnern_min != null ? Math.min(form.erinnern_min, 60) : null,
        folge_von: z.id, folge_bezug: d.bezug, folge_offset_min: d.offset, folge_titel: z.titel, erstellt_von: userDisplayName || null,
      })
    }
    let angelegt = []
    if (folgeRows.length) {
      const { data, error } = await supabase.from('team_kalender').insert(folgeRows).select()
      if (error) meldungen.push(`Folgeaufgaben NICHT angelegt: ${error.message}`)
      else angelegt = data || []
    }
    const erster = ziele[0]
    logActivity(form.id ? 'kalender.edit' : 'kalender.neu', { entity: basis.titel, detail: `${form.tag} ${form.von} (DE)${ziele.length > 1 ? ` · ${ziele.length} Termine` : ''}${angelegt.length ? ` · ${angelegt.length} Folgeaufgabe(n)` : ''}` })

    // 4) Telegram: eine Nachricht pro Person — für den ersten Termin, mit Serien-Hinweis
    if (form.telegram) {
      const letzter = ziele[ziele.length - 1]
      const hinweis = ziele.length > 1
        ? (form.id && !neuDazu.length ? `gilt für diesen und ${ziele.length - 1} weitere Termine` : `${wdhLabel(form.wiederholung)} bis ${kurzTag(datumInZone(letzter.beginn, BERLIN).tag)} (${ziele.length} Termine)`)
        : ''
      const gesamt = { ok: [], fehlt: [], fehler: [] }
      const liste = [{ ...erster, serie_hinweis: hinweis, _geaendert: !!form.id }, ...angelegt.filter(f => f.folge_von === erster.id).map(f => ({ ...f, serie_hinweis: hinweis }))]
      for (const e of liste) {
        const r = await benachrichtigen(e, !!e._geaendert)
        gesamt.ok.push(...r.ok); gesamt.fehlt.push(...r.fehlt); gesamt.fehler.push(...r.fehler)
      }
      const u = (a) => [...new Set(a)]
      if (gesamt.fehlt.length) meldungen.push(`Ohne Telegram-ID: ${u(gesamt.fehlt).join(', ')}`)
      if (gesamt.fehler.length) meldungen.push(`Telegram NICHT angekommen: ${u(gesamt.fehler).join(', ')}`)
    }
    setSpeichert(false)
    if (meldungen.length) alert('Gespeichert.\n\n' + meldungen.join('\n'))
    setForm(null)
    const tag = datumInZone(erster.beginn, anzeigeZone).tag
    setWoche(montagVon(tag)); setMobilTag(tag)
    laden()
  }

  // umfang: 'diesen' | 'folgende' (nur bei Serien)
  const loeschen = async (e, umfang = 'diesen') => {
    let haupt = [e]
    if (umfang === 'folgende' && e.serie_id) {
      const { data, error } = await supabase.from('team_kalender').select('id, titel, beginn').eq('serie_id', e.serie_id).gte('beginn', e.beginn)
      if (error) { alert('⚠ ' + error.message); return }
      haupt = data || []
    }
    const ids = haupt.map(x => x.id)
    const { data: folgen } = await supabase.from('team_kalender').select('id').in('folge_von', ids)
    const nF = (folgen || []).length
    const frage = umfang === 'folgende'
      ? `„${e.titel}": diesen und alle folgenden Termine löschen?\n\n${haupt.length} Termin(e)${nF ? ` + ${nF} Folgeaufgabe(n)` : ''}`
      : nF ? `„${e.titel}" und ${nF} Folgeaufgabe(n) löschen?` : `„${e.titel}" löschen?`
    if (!confirm(frage)) return
    const { error } = await supabase.from('team_kalender').delete().in('id', [...ids, ...(folgen || []).map(f => f.id)])
    if (error) { alert('⚠ Nicht gelöscht: ' + error.message); return }
    logActivity('kalender.loeschen', { entity: e.titel, detail: [haupt.length > 1 ? `${haupt.length} Termine` : '', nF ? `+ ${nF} Folgeaufgabe(n)` : ''].filter(Boolean).join(' ') })
    setAuswahl(null); laden()
  }

  // v4.65.0: Aufgaben, in denen ich stehe, direkt hier abhaken
  const abhaken = async (e, wert) => {
    const { data, error } = await supabase.rpc('kalender_erledigt', { p_id: e.id, p_erledigt: wert })
    if (error) { alert('⚠ Nicht gespeichert: ' + error.message); return }
    if (wert) erledigtMelden(e, data, userDisplayName)
    setAuswahl({ typ: 'eintrag', daten: { ...e, erledigt_von: data || [] } })
    laden()
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12 }
  const inp = { background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }
  const lbl = { fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }
  const btn = (aktiv) => ({ padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: aktiv ? '#7c3aed' : 'transparent', color: aktiv ? '#fff' : 'var(--text-secondary)', border: `1px solid ${aktiv ? '#7c3aed' : 'var(--border)'}`, whiteSpace: 'nowrap' })
  const kopfLabel = { fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }
  const kw = (() => { const d = new Date(woche + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 3); const j = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); return 1 + Math.round(((d - j) / 864e5 - 3 + ((j.getUTCDay() + 6) % 7)) / 7) })()

  const EBENEN = [...ARTEN.map(a => ({ key: a.key, label: a.label, farbe: a.farbe })), { key: 'models', label: 'Models: Termine & Urlaub', farbe: MODEL_FARBE }, { key: 'schichten', label: 'Schichten Team', farbe: SCHICHT_FARBE }]
  const ebenenListe = (
    <div style={{ display: 'flex', flexDirection: mobil ? 'row' : 'column', gap: 6, flexWrap: mobil ? 'nowrap' : 'wrap', overflowX: mobil ? 'auto' : 'visible', alignItems: mobil ? 'center' : 'flex-start', paddingBottom: mobil ? 2 : 0 }}>
      {EBENEN.map(e => (
        <button key={e.key} onClick={() => setEbenen(p => ({ ...p, [e.key]: !p[e.key] }))}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', background: ebenen[e.key] ? 'rgba(255,255,255,0.04)' : 'transparent', color: ebenen[e.key] ? 'var(--text-primary)' : 'var(--text-muted)', border: `1px solid ${ebenen[e.key] ? '#2e2e5a' : 'var(--border)'}`, opacity: ebenen[e.key] ? 1 : 0.55 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: e.farbe }} />{e.label}
        </button>
      ))}
    </div>
  )

  // ── Detail (rechts / mobil als Blatt von unten) ───────────────────────────
  const detailInhalt = auswahl && (auswahl.typ === 'schicht' ? (() => {
    const g = auswahl.daten
    return (
      <>
        <span style={{ alignSelf: 'flex-start', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#cbd5e1', background: 'rgba(100,116,139,0.25)', padding: '3px 8px', borderRadius: 5 }}>Schicht · aus dem Dienstplan</span>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{g.ich ? 'Ich' : g.person} · {/schicht$/i.test(g.shift) ? g.shift : g.shift + 'schicht'}</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{g.zeilen.map((z, i) => <div key={i}>{z}</div>)}</div>
        {g.entwurf && <div style={{ fontSize: 11, color: '#f59e0b' }}>Woche noch im Entwurf</div>}
        <ZonenTabelle beginn={new Date(g.s)} />
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Ändern im Dienstplan.</div>
      </>
    )
  })() : (() => {
    const e = auswahl.daten
    const a = artInfo(e.art)
    const folgen = eintraege.filter(x => x.folge_von === e.id)
    const hauptEvent = e.folge_von ? eintraege.find(x => x.id === e.folge_von) : null
    const ichN = normName(userDisplayName)
    const abhakbar = e.art === 'aufgabe' && !!ichN && (e.fuer_alle || (e.fuer || []).some(n => normName(n) === ichN))
    const ichFertig = (e.erledigt_von || []).some(n => normName(n) === ichN)
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: a.farbe, background: a.farbe + '22', padding: '3px 8px', borderRadius: 5 }}>{a.label}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>angelegt von {e.erstellt_von || '—'}</span>
        </div>
        <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.25 }}>{e.titel}</div>
        {hauptEvent ? <button onClick={() => setAuswahl({ typ: 'eintrag', daten: hauptEvent })} style={{ ...btn(false), alignSelf: 'flex-start', fontSize: 11 }}>↩ Folgeaufgabe zu „{hauptEvent.titel}"</button>
          : e.folge_titel ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>↳ Folgeaufgabe zu „{e.folge_titel}"</div> : null}
        {e.serie_id && <div style={{ fontSize: 12, color: '#c4b5fd' }}>🔁 Wiederholt sich {wdhLabel(e.wiederholung)}</div>}
        {abhakbar && (
          <button onClick={() => abhaken(e, !ichFertig)} style={{ ...btn(false), alignSelf: 'flex-start', background: ichFertig ? 'transparent' : 'rgba(16,185,129,0.15)', color: ichFertig ? 'var(--text-muted)' : '#10b981', borderColor: ichFertig ? 'var(--border)' : 'rgba(16,185,129,0.4)' }}>{ichFertig ? '↺ doch nicht erledigt' : '✓ Ich hab\'s erledigt'}</button>
        )}
        {e.notiz && <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{e.notiz}</div>}
        <div>
          <div style={kopfLabel}>Beginn in jeder Zeitzone</div>
          <ZonenTabelle beginn={e.beginn} />
        </div>
        <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={kopfLabel}>Für wen</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {e.fuer_alle ? <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)' }}>Ganzes Team</span>
              : (e.fuer || []).map(n => {
                const fertig = (e.erledigt_von || []).some(x => normName(x) === normName(n))
                return <span key={n} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, background: fertig ? 'rgba(16,185,129,0.15)' : 'rgba(124,58,237,0.15)', color: fertig ? '#6ee7b7' : '#ddd6fe' }}>{fertig ? '✓ ' : ''}{n}</span>
              })}
          </div>
          {e.fuer_alle && (e.erledigt_von || []).length > 0 && <div style={{ fontSize: 12, color: '#10b981' }}>✓ erledigt von {(e.erledigt_von || []).join(', ')}</div>}
          {e.erinnern_min ? <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>⏰ Erinnerung {ERINNERUNGEN.find(r => r.min === e.erinnern_min)?.label || `${e.erinnern_min} Min vorher`}{e.erinnerung_gesendet ? ' · verschickt' : ''}</div> : null}
        </div>
        {folgen.length > 0 && (
          <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={kopfLabel}>Folgeaufgaben</div>
            {folgen.map(f => {
              const fertig = (f.erledigt_von || []).length
              return (
                <button key={f.id} onClick={() => setAuswahl({ typ: 'eintrag', daten: f })} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, textAlign: 'left', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-primary)', fontFamily: 'inherit' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: artInfo('aufgabe').farbe, flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{f.titel} · {(f.fuer || []).join(', ')} · {zeitIn(f.beginn, anzeigeZone)}</span>
                  {fertig > 0 && <span style={{ color: '#10b981' }}>✓{fertig}</span>}
                </button>
              )
            })}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
          <button onClick={() => oeffneBearbeiten(e)} style={{ ...btn(false), flex: 1 }}>Bearbeiten</button>
          <button onClick={() => loeschen(e)} style={{ ...btn(false), color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' }}>{e.serie_id ? 'Nur diesen löschen' : 'Löschen'}</button>
        </div>
        {e.serie_id && <button onClick={() => loeschen(e, 'folgende')} style={{ ...btn(false), color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' }}>Diesen + alle folgenden löschen</button>}
      </>
    )
  })())

  // ── Raster ────────────────────────────────────────────────────────────────
  const zeitSpalte = mobil ? 40 : 48
  const stundenLinien = Array.from({ length: 24 }, (_, h) => (
    <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: h * STUNDE_PX, borderTop: '1px solid var(--border)', opacity: 0.6 }} />
  ))
  const raster = (
    <div style={{ ...card, overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
      {/* Tageskopf + Model-Zeile */}
      <div style={{ display: 'grid', gridTemplateColumns: `${zeitSpalte}px repeat(${sichtbareTage.length}, minmax(0, 1fr))`, borderBottom: '1px solid var(--border)' }}>
        <div />
        {sichtbareTage.map(t => {
          const istHeute = t === heute
          return (
            <div key={t} style={{ padding: '8px 8px 6px', borderLeft: '1px solid var(--border)', minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: istHeute ? '#c4b5fd' : 'var(--text-secondary)' }}>{TAGE[wochentag(t)]} {kurzTag(t)}{istHeute ? ' · heute' : ''}</span>
                <button onClick={() => oeffneNeu(t)} title="Eintrag an diesem Tag" aria-label={`Eintrag am ${kurzTag(t)}`} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 15, padding: '0 2px' }}>+</button>
              </div>
              {modelProTag[t].map(s => (
                <div key={s.key + t} title={`${s.model} · ${s.art}: ${s.titel}`} style={{ marginTop: 4, fontSize: 10.5, padding: '2px 6px', borderRadius: 5, background: 'rgba(16,185,129,0.14)', color: '#6ee7b7', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.model} · {s.art}: {s.titel}
                </div>
              ))}
            </div>
          )
        })}
      </div>
      {/* Stunden */}
      <div ref={rasterRef} style={{ overflowY: 'auto', maxHeight: mobil ? 'calc(100vh - 330px)' : 640, minHeight: 320 }}>
        <div style={{ display: 'grid', gridTemplateColumns: `${zeitSpalte}px repeat(${sichtbareTage.length}, minmax(0, 1fr))`, position: 'relative', height: 24 * STUNDE_PX }}>
          <div style={{ position: 'relative' }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} style={{ position: 'absolute', top: h * STUNDE_PX, right: 6, fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', transform: 'translateY(2px)' }}>{String(h).padStart(2, '0')}:00</div>
            ))}
          </div>
          {sichtbareTage.map(t => {
            const istHeute = t === heute
            const [a] = tagesGrenzen(t)
            const jetztMin = (jetzt - a) / 60000
            return (
              <div key={t} style={{ position: 'relative', borderLeft: '1px solid var(--border)', background: istHeute ? 'rgba(124,58,237,0.05)' : 'transparent' }}
                onDoubleClick={(ev) => { const r = ev.currentTarget.getBoundingClientRect(); oeffneNeu(t, Math.floor((ev.clientY - r.top) / STUNDE_PX)) }}>
                {stundenLinien}
                {bloeckeProTag[t].map(b => {
                  const top = (b.start / 60) * STUNDE_PX
                  const hoehe = Math.max(((b.ende - b.start) / 60) * STUNDE_PX - 2, 20)
                  const breiteP = 100 / b.spalten
                  const schicht = b.typ === 'schicht'
                  const aktiv = auswahl && ((auswahl.typ === 'eintrag' && auswahl.daten.id === b.id) || (auswahl.typ === 'schicht' && auswahl.daten === b.daten))
                  const e = b.daten
                  return (
                    <button key={b.id + '|' + b.start} onClick={() => setAuswahl({ typ: b.typ, daten: e })}
                      style={{
                        position: 'absolute', top: top + 1, height: hoehe, left: `calc(${b.spalte * breiteP}% + 2px)`, width: `calc(${breiteP}% - 4px)`,
                        boxSizing: 'border-box', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', overflow: 'hidden', padding: '3px 6px',
                        background: schicht ? 'rgba(100,116,139,0.14)' : b.farbe + '26',
                        border: `1px ${schicht && e.entwurf ? 'dashed' : 'solid'} ${b.farbe}66`, borderLeft: `3px solid ${b.farbe}`, borderRadius: 6,
                        borderTopLeftRadius: b.fortsetzung ? 0 : 6, borderBottomLeftRadius: b.abgeschnitten ? 0 : 6,
                        outline: aktiv ? `2px solid ${b.farbe}` : 'none', outlineOffset: 1, color: 'var(--text-primary)', zIndex: aktiv ? 3 : schicht ? 1 : 2,
                      }}>
                      {schicht ? (
                        <>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#cbd5e1', lineHeight: 1.25 }}>{e.ich ? 'Ich' : e.person} · {e.shift}</div>
                          {hoehe > 34 && <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.3 }}>{e.zeilen.join(' · ')}</div>}
                        </>
                      ) : (
                        <>
                          <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.25, color: 'var(--text-primary)', whiteSpace: hoehe < 30 ? 'nowrap' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {e.folge_von ? '↳ ' : ''}{e.serie_id ? '🔁 ' : ''}{e.titel}
                          </div>
                          {hoehe > 30 && <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.3 }}>{zeitIn(e.beginn, anzeigeZone)}{e.ende ? '–' + zeitIn(e.ende, anzeigeZone) : ''} · {e.fuer_alle ? 'Team' : (e.fuer || []).join(', ')}{(e.erledigt_von || []).length ? ` · ✓${e.erledigt_von.length}` : ''}</div>}
                        </>
                      )}
                    </button>
                  )
                })}
                {istHeute && jetztMin >= 0 && jetztMin < 1440 && (
                  <div style={{ position: 'absolute', left: 0, right: 0, top: (jetztMin / 60) * STUNDE_PX, borderTop: '2px solid #ef4444', zIndex: 4, pointerEvents: 'none' }}>
                    <div style={{ position: 'absolute', left: -4, top: -5, width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )

  const zonenUebersicht = (
    <details>
      <summary style={{ cursor: 'pointer', ...kopfLabel, marginBottom: 0, listStyle: 'none' }}>🕒 Zeitzonen · {zonenListe.filter(z => z.bestaetigt).length} bestätigt ▾</summary>
      <div style={{ marginTop: 6, maxHeight: 220, overflowY: 'auto' }}>
        {zonenListe.map(z => (
          <div key={z.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 11, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ color: z.team ? '#c4b5fd' : 'var(--text-primary)' }}>{z.name}</span>
            <span style={{ color: z.zone ? (z.bestaetigt ? '#10b981' : 'var(--text-secondary)') : 'var(--text-muted)', textAlign: 'right' }}>
              {z.zone ? `${ortAus(z.zone)} ${utcLabel(z.zone)}${z.bestaetigt ? ' ✓' : ''}` : 'unbekannt'}
            </span>
          </div>
        ))}
      </div>
    </details>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* eigene Zeitzone bestätigen — wie im Portal */}
      {userDisplayName && <ZeitzonenHinweis displayName={userDisplayName} onZone={() => { setZonenStand(n => n + 1); ladePersonen() }} />}

      {/* Kopfzeile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => setWoche(plusTage(woche, -7))} style={btn(false)} aria-label="Vorige Woche">‹</button>
        <button onClick={() => { setWoche(montagVon(heute)); setMobilTag(heute) }} style={btn(false)}>Heute</button>
        <button onClick={() => setWoche(plusTage(woche, 7))} style={btn(false)} aria-label="Nächste Woche">›</button>
        <div style={{ fontSize: mobil ? 15 : 17, fontWeight: 700, color: 'var(--text-primary)', marginLeft: 4 }}>KW {kw} · {kurzTag(woche)} – {kurzTag(plusTage(woche, 6))}</div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
          {!mobil && 'Zeiten in:'}
          <button onClick={() => setZoneModus('lokal')} style={btn(zoneModus === 'lokal')}>{mobil ? 'meine Zeit' : `meiner Zeit (${ortAus(meineZone())}, ${utcLabel(meineZone())})`}</button>
          <button onClick={() => setZoneModus('berlin')} style={btn(zoneModus === 'berlin')}>{mobil ? 'DE' : 'deutscher Zeit'}</button>
        </div>
      </div>

      {/* Mobil: Neuer Eintrag, Ebenen als Leiste, Tag-Auswahl */}
      {mobil && (
        <>
          <button onClick={() => oeffneNeu(mobilTag)} style={{ ...btn(true), padding: '10px 14px', fontSize: 13 }}>+ Neuer Eintrag</button>
          {ebenenListe}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
            {tage.map(t => {
              const an = t === mobilTag, istHeute = t === heute
              const anzahl = (bloeckeProTag[t] || []).length + (modelProTag[t] || []).length
              return (
                <button key={t} onClick={() => setMobilTag(t)} style={{ padding: '6px 0', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', background: an ? '#7c3aed' : 'var(--bg-card)', color: an ? '#fff' : istHeute ? '#c4b5fd' : 'var(--text-secondary)', border: `1px solid ${an ? '#7c3aed' : 'var(--border)'}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                  <span style={{ fontSize: 11, fontWeight: 700 }}>{TAGE[wochentag(t)]}</span>
                  <span style={{ fontSize: 10 }}>{kurzTag(t).slice(0, 2)}</span>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: anzahl ? (an ? '#fff' : '#a78bfa') : 'transparent' }} />
                </button>
              )
            })}
          </div>
        </>
      )}

      {fehler && <div style={{ ...card, padding: 12, color: '#ef4444', fontSize: 13 }}>⚠ {fehler}</div>}

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        {/* Seitenleiste links (Desktop) */}
        {!mobil && (
          <aside style={{ width: 210, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 12 }}>
            <button onClick={() => oeffneNeu()} style={{ ...btn(true), padding: '10px 14px', fontSize: 13 }}>+ Neuer Eintrag</button>
            <div><div style={kopfLabel}>Ebenen</div>{ebenenListe}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>Doppelklick ins Raster legt einen Eintrag zu dieser Uhrzeit an.</div>
            {zonenUebersicht}
          </aside>
        )}

        {raster}

        {/* Details rechts (Desktop) */}
        {!mobil && auswahl && (
          <aside style={{ ...card, width: 300, flexShrink: 0, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, position: 'sticky', top: 12, maxHeight: 'calc(100vh - 40px)', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setAuswahl(null)} aria-label="Details schließen" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 15 }}>✕</button>
            </div>
            {detailInhalt}
          </aside>
        )}
      </div>

      {mobil && <div style={{ ...card, padding: 12 }}>{zonenUebersicht}</div>}

      {/* Details mobil: Blatt von unten */}
      {mobil && auswahl && (
        <div onClick={() => setAuswahl(null)} style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ ...card, borderRadius: '16px 16px 0 0', width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto' }} />
              <button onClick={() => setAuswahl(null)} aria-label="Schließen" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, position: 'absolute', right: 16 }}>✕</button>
            </div>
            {detailInhalt}
          </div>
        </div>
      )}

      {/* Formular */}
      {form && (
        <div onClick={() => !speichert && setForm(null)} style={{ position: 'fixed', inset: 0, zIndex: 9001, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: mobil ? 'flex-end' : 'center', justifyContent: 'center', padding: mobil ? 0 : 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ ...card, width: mobil ? '100%' : 'min(900px, 100%)', maxHeight: mobil ? '92vh' : '90vh', overflowY: 'auto', padding: mobil ? 16 : 20, borderRadius: mobil ? '16px 16px 0 0' : 12, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 380px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>{form.id ? 'Eintrag bearbeiten' : 'Neuer Eintrag'}</div>
              <label><span style={lbl}>Titel</span><input value={form.titel} onChange={e => setForm({ ...form, titel: e.target.value })} style={inp} placeholder="z. B. Chiara live auf Twitch" /></label>
              <div><span style={lbl}>Art</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {ARTEN.map(a => <button key={a.key} type="button" onClick={() => setForm({ ...form, art: a.key })} style={{ ...btn(form.art === a.key), ...(form.art === a.key ? { background: a.farbe, borderColor: a.farbe } : {}) }}>{a.label}</button>)}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: mobil ? '1fr 1fr' : '1.3fr 1fr 1fr', gap: 10 }}>
                <label style={{ gridColumn: mobil ? '1 / -1' : 'auto' }}><span style={lbl}>Datum (deutsche Zeit)</span><input type="date" value={form.tag} onChange={e => setForm({ ...form, tag: e.target.value })} style={inp} /></label>
                <label><span style={lbl}>von</span><input type="time" value={form.von} onChange={e => setForm({ ...form, von: e.target.value })} style={inp} /></label>
                <label><span style={lbl}>bis (optional)</span><input type="time" value={form.bis} onChange={e => setForm({ ...form, bis: e.target.value })} style={inp} /></label>
              </div>
              {/* v4.65.0: Wiederholung */}
              {form.serie_id ? (
                <div style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 9, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 12, color: '#ddd6fe' }}>🔁 Teil einer Serie ({wdhLabel(form.wiederholung)}). Änderung gilt für:</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => setForm({ ...form, umfang: 'diesen' })} style={btn(form.umfang === 'diesen')}>nur diesen Termin</button>
                    <button type="button" onClick={() => setForm({ ...form, umfang: 'folgende' })} style={btn(form.umfang === 'folgende')}>diesen + alle folgenden</button>
                  </div>
                  {form.umfang === 'folgende' && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Titel, Uhrzeit, Personen, Notiz und Erinnerung werden übernommen. Verschiebst du das Datum, rücken alle folgenden um genauso viele Tage.</div>}
                </div>
              ) : !form.folge_von && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'end' }}>
                  <label><span style={lbl}>Wiederholen</span>
                    <select value={form.wiederholung} onChange={e => setForm({ ...form, wiederholung: e.target.value, wdhBis: form.wdhBis || (form.tag ? plusTage(form.tag, 56) : '') })} style={inp}>
                      {WIEDERHOLUNGEN.map(w => <option key={w.key} value={w.key}>{w.label}</option>)}
                    </select>
                  </label>
                  {form.wiederholung && <label><span style={lbl}>bis einschließlich</span><input type="date" min={form.tag} value={form.wdhBis} onChange={e => setForm({ ...form, wdhBis: e.target.value })} style={inp} /></label>}
                  {serienVorschau && (
                    <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--text-secondary)' }}>
                      → {serienVorschau.length} Termine{serienVorschau.length >= MAX_SERIE ? ' (Maximum)' : ''}: {serienVorschau.slice(0, 4).map(kurzTag).join(', ')}{serienVorschau.length > 4 ? ` … ${kurzTag(serienVorschau[serienVorschau.length - 1])}` : ''}{form.id ? ' — dieser Eintrag wird der erste' : ''}
                    </div>
                  )}
                </div>
              )}
              <div><span style={lbl}>Für wen</span>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-primary)', marginBottom: 6 }}>
                  <input type="checkbox" checked={form.fuer_alle} onChange={e => setForm({ ...form, fuer_alle: e.target.checked })} style={{ accentColor: '#7c3aed' }} /> Ganzes Team (alle Chatter + Team)
                </label>
                {!form.fuer_alle && <PersonenChips personen={personen} team={teamNamen} gewaehlt={form.fuer} onChange={fuer => setForm({ ...form, fuer })} />}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: mobil ? '1fr' : '1fr 1fr', gap: 10, alignItems: 'end' }}>
                <label><span style={lbl}>Erinnerung per Telegram</span>
                  <select value={form.erinnern_min ?? ''} onChange={e => setForm({ ...form, erinnern_min: e.target.value === '' ? null : Number(e.target.value) })} style={inp}>
                    {ERINNERUNGEN.map(r => <option key={r.label} value={r.min ?? ''}>{r.label}</option>)}
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-primary)', paddingBottom: 8 }}>
                  <input type="checkbox" checked={!!form.telegram} onChange={e => setForm({ ...form, telegram: e.target.checked })} style={{ accentColor: '#7c3aed' }} />
                  {form.id ? 'Änderung per Telegram melden' : 'Jetzt per Telegram benachrichtigen'}
                </label>
              </div>
              <label><span style={lbl}>Notiz</span><textarea value={form.notiz} onChange={e => setForm({ ...form, notiz: e.target.value })} rows={2} style={{ ...inp, resize: 'vertical' }} /></label>

              {/* Folgeaufgaben — bei Events und Team-Terminen */}
              {(form.art === 'event' || form.art === 'termin') && (
                <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ ...kopfLabel, marginBottom: 0 }}>Folgeaufgaben</span>
                    <button type="button" onClick={() => setForm({ ...form, folgen: [...form.folgen, neueFolge(form.fuer_alle ? [] : form.fuer)] })} style={btn(false)}>+ Folgeaufgabe</button>
                  </div>
                  {(form.folgenAlt || []).length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {form.folgenAlt.map(f => (
                        <div key={f.id} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          ↳ {f.titel} · {(f.fuer || []).join(', ')}
                          {f.folge_offset_min != null && <span style={{ color: 'var(--text-muted)' }}> · {f.folge_offset_min ? `${f.folge_offset_min} Min ` : ''}{f.folge_bezug === 'beginn' ? 'nach Beginn' : 'nach Ende'} (wandert mit)</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {form.folgen.length === 0 && (form.folgenAlt || []).length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>z. B. „Massennachricht an Chiara-Fans" direkt nach Stream-Ende — für dich, Rey oder die betreuenden Chatter. Verschiebst du das Event, wandert die Aufgabe mit.</div>
                  )}
                  {form.folgen.length > 0 && (serienVorschau?.length > 1 || (form.serie_id && form.umfang === 'folgende')) && (
                    <div style={{ fontSize: 11, color: '#c4b5fd' }}>🔁 Neue Folgeaufgaben werden bei jedem Termin der Serie angelegt.</div>
                  )}
                  {form.folgen.map((f, i) => {
                    const setF = (patch) => setForm({ ...form, folgen: form.folgen.map((x, j) => j === i ? { ...x, ...patch } : x) })
                    const vorschau = formBeginn ? folgeBeginn(formBeginn, formEnde, f.bezug, f.offset) : null
                    return (
                      <div key={f.tmp} style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input value={f.titel} onChange={e => setF({ titel: e.target.value })} placeholder="Titel der Folgeaufgabe" style={{ ...inp, flex: 1 }} />
                          <button type="button" onClick={() => setForm({ ...form, folgen: form.folgen.filter((_, j) => j !== i) })} aria-label="Folgeaufgabe entfernen" style={{ ...btn(false), color: '#ef4444' }}>✕</button>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          <select value={f.offset} onChange={e => setF({ offset: Number(e.target.value) })} style={{ ...inp, width: 'auto' }}>
                            {FOLGE_OFFSETS.map(o => <option key={o.min} value={o.min}>{o.label}</option>)}
                          </select>
                          <select value={f.bezug} onChange={e => setF({ bezug: e.target.value })} style={{ ...inp, width: 'auto' }}>
                            <option value="ende">nach Ende{!form.bis ? ' (ohne Ende = Beginn)' : ''}</option>
                            <option value="beginn">nach Beginn</option>
                          </select>
                          {vorschau && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>→ {zeitIn(vorschau, BERLIN)} DE · {zeitIn(vorschau, meineZone())} bei dir</span>}
                        </div>
                        <PersonenChips personen={personen} team={teamNamen} gewaehlt={f.fuer} onChange={fuer => setF({ fuer })} klein />
                      </div>
                    )
                  })}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, position: mobil ? 'sticky' : 'static', bottom: 0, background: 'var(--bg-card)', paddingTop: mobil ? 8 : 0 }}>
                <button onClick={() => setForm(null)} disabled={speichert} style={{ ...btn(false), flex: mobil ? 1 : 'none' }}>Abbrechen</button>
                <button onClick={speichern} disabled={speichert} style={{ ...btn(true), padding: '8px 18px', flex: mobil ? 2 : 'none' }}>{speichert ? 'Speichert…' : form.id ? 'Speichern' : 'Eintragen'}</button>
              </div>
            </div>
            <div style={{ flex: '0 1 260px', minWidth: 0 }}>
              <div style={kopfLabel}>So sieht es bei den anderen aus</div>
              {formBeginn ? <ZonenTabelle beginn={formBeginn} /> : <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Datum und Uhrzeit eingeben — hier erscheint dann die Uhrzeit in jeder Zeitzone.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Auswahl von Personen: Team oben, Chatter darunter
function PersonenChips({ personen, team, gewaehlt, onChange, klein }) {
  const teamSet = new Set(team)
  const sortiert = [...personen].sort((a, b) => (teamSet.has(b) ? 1 : 0) - (teamSet.has(a) ? 1 : 0) || a.localeCompare(b, 'de'))
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', maxHeight: klein ? 96 : 150, overflowY: 'auto' }}>
      {sortiert.map(p => {
        const an = gewaehlt.includes(p)
        return <button key={p} type="button" onClick={() => onChange(an ? gewaehlt.filter(x => x !== p) : [...gewaehlt, p])}
          style={{ padding: klein ? '3px 8px' : '4px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: an ? 'rgba(124,58,237,0.2)' : 'transparent', color: an ? '#ddd6fe' : teamSet.has(p) ? '#c4b5fd' : 'var(--text-secondary)', border: `1px solid ${an ? '#7c3aed' : 'var(--border)'}` }}>{an ? '✓ ' : ''}{p}</button>
      })}
    </div>
  )
}

// Beginn eines Eintrags in der eigenen Zeit + den Team-Zonen
export function ZonenTabelle({ beginn }) {
  const eigene = meineZone()
  const zonen = [{ zone: eigene, ort: `Du (${ortAus(eigene)})` }, ...TEAM_ZONEN.filter(z => z.zone !== eigene)]
  const tagBerlin = datumInZone(beginn, BERLIN).tag
  return (
    <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 9, padding: '4px 12px' }}>
      {zonen.map((z, i) => {
        const d = datumInZone(beginn, z.zone)
        const andererTag = d.tag !== tagBerlin
        return (
          <div key={z.zone} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>{z.ort}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{utcLabel(z.zone, new Date(beginn))}{andererTag ? ' · ' + new Date(beginn).toLocaleDateString('de-DE', { timeZone: z.zone, weekday: 'short', day: '2-digit', month: '2-digit' }) : ''}</div>
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700, color: z.zone === eigene ? '#c4b5fd' : 'var(--text-primary)' }}>{d.zeit}</div>
          </div>
        )
      })}
    </div>
  )
}
