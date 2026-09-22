// Team-Kalender — Admin-Ansicht.
//
// v4.60.0 Stufe 1 · v4.61.0 Telegram/Erinnerungen · v4.62.0 Team-Schichten
// v4.64.0: Stundenraster wie im Entwurf (Seitenleiste links, Raster Mitte,
//          Details rechts), Folgeaufgaben an Events/Terminen, Mobil = Tagesansicht.
// v4.65.0: Wiederholungen (Serie = einzelne Zeilen mit serie_id, damit
//          Erinnerung und „erledigt" pro Termin funktionieren), Erledigt-Meldung
//          ans Team, Abhaken direkt im Admin-Kalender.
// v4.67.0: Ansichten Woche / Monat / Liste mit Suche; Handy startet mit der
//          Liste, Filter & Einstellungen in einem Blatt; Handy-Kalender-Abo.
// v4.66.0: Hinweise beim Anlegen (nachts / abwesend / keine Schicht), Model am
//          Eintrag mit Empfängern aus dem Dienstplan, Liste „Offen", Verschieben
//          per Ziehen, Vorlagen, Rückmeldungen der Empfänger.
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
import KalenderAbo from './KalenderAbo'

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
const monatErster = (tag) => tag.slice(0, 8) + '01'
const monatPlus = (tag, n) => { const [y, m] = tag.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1, 12)).toISOString().slice(0, 10) }
const monatName = (tag, kurz) => new Date(tag + 'T12:00:00Z').toLocaleDateString('de-DE', { month: kurz ? 'short' : 'long', year: 'numeric', timeZone: 'UTC' })
const ANSICHT_KEY = (m) => `kalender-ansicht-${m ? 'mobil' : 'desktop'}`
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

const leer = () => ({ id: null, titel: '', art: 'aufgabe', tag: datumInZone(new Date(), BERLIN).tag, von: '', bis: '', notiz: '', fuer: [], fuer_alle: false, erinnern_min: null, telegram: true, folgen: [], folgenAlt: [], wiederholung: '', wdhBis: '', serie_id: null, umfang: 'diesen', folge_von: null, altBeginn: null, model_name: '' })
const neueFolge = (fuer = []) => ({ tmp: Math.random().toString(36).slice(2), titel: '', bezug: 'ende', offset: 0, fuer: [...fuer] })

// v4.66.0: fest eingebaute Vorlagen (eigene kommen aus kalender_vorlagen)
const STANDARD_VORLAGEN = [
  { id: 'std-stream', name: 'Stream + Massennachricht', fest: true, daten: { titel: 'Live-Stream', art: 'event', von: '20:00', bis: '22:00', erinnern_min: 30, folgen: [{ titel: 'Massennachricht an die Fans', bezug: 'ende', offset: 0, fuer: [] }] } },
  { id: 'std-meeting', name: 'Team-Meeting', fest: true, daten: { titel: 'Team-Meeting', art: 'termin', von: '11:00', bis: '12:00', fuer_alle: true, erinnern_min: 60 } },
  { id: 'std-aufgabe', name: 'Aufgabe mit Frist', fest: true, daten: { titel: '', art: 'aufgabe', von: '18:00', erinnern_min: 60 } },
]

// Nachts beim Empfänger = vor 7 Uhr oder ab 23 Uhr in seiner Zone
const NACHT_BIS = 7, NACHT_AB = 23

// Dienstplan-Zeilen → Schichten mit festen Zeitpunkten (Plan ist deutsche Zeit)
export function schichtenAus(rows, modelName, vonTag, bisTag) {
  const sch = []
  for (const w of rows || []) {
    const zeiten = w.shift_times || {}
    for (const [key, val] of Object.entries(w.assignments || {})) {
      if (!val || !val.chatter || val.chatter === '__FREI__') continue
      const [modelId, planTag, shift] = key.split('__')
      if (!planTag || planTag < vonTag || planTag > bisTag) continue
      const spanne = String(val.time_override || zeiten[`${modelId}__${shift}`] || '').replace(/\s*\(DE\)/g, '')
      const [a, b] = spanne.split('-').map(x => x && x.trim())
      if (!a || !/^\d{1,2}:\d{2}$/.test(a)) continue
      const beginn = wandzeitZuDatum(planTag, a, BERLIN)
      let bisD = b && /^\d{1,2}:\d{2}$/.test(b) ? wandzeitZuDatum(planTag, b, BERLIN) : null
      if (bisD && bisD <= beginn) bisD = wandzeitZuDatum(plusTage(planTag, 1), b, BERLIN) // über Mitternacht (auch bei Zeitumstellung)
      const modus = val.trainee ? (MODUS[val.trainee_mode] || MODUS.anlernen) : null
      const basis = { beginn, ende: bisD, shift, planTag, model: modelName[modelId] || modelId, entwurf: w.status !== 'live' }
      sch.push({ ...basis, person: val.chatter, zusatz: val.trainee ? `${modus} mit ${val.trainee}` : '' })
      if (val.trainee) sch.push({ ...basis, person: val.trainee, zusatz: `${modus} bei ${val.chatter}` })
    }
  }
  return sch
}
// inkl. Schichtende: eine Folgeaufgabe genau um 22:00 gehört noch zur Spätschicht bis 22:00
const deckt = (x, t) => x.beginn.getTime() <= t && t <= (x.ende ? x.ende.getTime() : x.beginn.getTime() + 8 * 3600000)

// v4.66.0: Rückmeldung eines Empfängers an Chris und Rey (nicht an sich selbst)
export async function rueckmeldungMelden(e, text, wer) {
  const bezug = e.folge_titel ? `\n↳ Folgeaufgabe zu: ${e.folge_titel}` : ''
  const msg = `💬 <b>${wer || 'Jemand'}</b> – Rückmeldung (Kalender):\n\n<b>${e.titel}</b>${bezug}\n\n${text}`
  for (const [name, id] of Object.entries(ADMIN_TG)) {
    if (name === normName(wer)) continue
    try { await sendTelegramMessage(id, msg) } catch (err) { console.error('Telegram:', err) }
  }
}

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
  // v4.66.0
  const [modelle, setModelle] = useState([])          // [{ id, name }]
  const [modelFilter, setModelFilter] = useState('')  // '' = alle
  const [abwesenheiten, setAbwesenheiten] = useState([])
  const [offene, setOffene] = useState([])
  const [vorlagen, setVorlagen] = useState([])
  const [formSchichten, setFormSchichten] = useState(null) // Schichten rund ums Formular-Datum (null = noch nicht geladen)
  const [rueckmeldungen, setRueckmeldungen] = useState([])
  const [ziehen, setZiehen] = useState(null)          // { id, dx, dy, tage, minuten }
  const [verschieben, setVerschieben] = useState(null) // { e, beginn, ende, telegram }
  const zugRef = useRef(null)
  const gezogenRef = useRef(false)
  const rasterGridRef = useRef(null)
  // v4.67.0: Ansichten
  const [ansicht, setAnsichtRoh] = useState(() => {
    const m = typeof window !== 'undefined' && window.innerWidth < 900
    try { const v = localStorage.getItem(ANSICHT_KEY(m)); if (['woche', 'monat', 'liste'].includes(v)) return v } catch { /* egal */ }
    return m ? 'liste' : 'woche'
  })
  const setAnsicht = (v) => { setAnsichtRoh(v); try { localStorage.setItem(ANSICHT_KEY(mobil), v) } catch { /* egal */ } }
  const [monatAnker, setMonatAnker] = useState(() => monatErster(datumInZone(new Date(), meineZone()).tag))
  const [listeVon, setListeVon] = useState(() => datumInZone(new Date(), meineZone()).tag)
  const [listeTage, setListeTage] = useState(21)
  const [suche, setSuche] = useState('')
  const [sucheOffen, setSucheOffen] = useState(false)
  const [treffer, setTreffer] = useState(null) // null = keine Suche aktiv
  const [filterBlatt, setFilterBlatt] = useState(false)
  const [offenBlatt, setOffenBlatt] = useState(false)

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
  }, [mobil, ansicht])

  // Welcher Zeitraum wird gebraucht? (Woche / Monatsraster / Liste)
  const bereich = useMemo(() => {
    if (ansicht === 'monat') {
      const letzter = plusTage(monatPlus(monatAnker, 1), -1)
      return { von: montagVon(monatAnker), bis: plusTage(montagVon(letzter), 6) }
    }
    if (ansicht === 'liste') return { von: listeVon, bis: plusTage(listeVon, listeTage - 1) }
    return { von: woche, bis: plusTage(woche, 6) }
  }, [ansicht, monatAnker, listeVon, listeTage, woche])
  const bVon = bereich.von, bBis = bereich.bis

  const laden = useCallback(async () => {
    setFehler(null)
    const von = wandzeitZuDatum(plusTage(bVon, -1), '00:00', 'UTC').toISOString()
    const bis = wandzeitZuDatum(plusTage(bBis, 2), '23:59', 'UTC').toISOString()
    const [k, mc, mb, sc, mo] = await Promise.all([
      supabase.from('team_kalender').select('*').gte('beginn', von).lte('beginn', bis).order('beginn'),
      supabase.from('model_calendar').select('id, model_name, title, description, due_date, due_time, category')
        .in('category', ['termin', 'reise']).gte('due_date', plusTage(bVon, -1)).lte('due_date', plusTage(bBis, 1)),
      supabase.from('model_board').select('id, model_name, category, title, date, date_from, date_to')
        .in('category', ['reise', 'termine']),
      supabase.from('schedule').select('week_start, status, assignments, shift_times')
        .gte('week_start', plusTage(montagVon(bVon), -7)).lte('week_start', bBis),
      supabase.from('models_contact').select('id, name'),
    ])
    if (k.error) { setFehler(k.error.message.includes('team_kalender') ? 'Die Kalender-Tabelle fehlt noch — bitte das SQL „team-kalender.sql" in Supabase ausführen.' : k.error.message); return }
    setEintraege(k.data || [])
    const ms = []
    for (const r of mc.data || []) ms.push({ key: 'mc' + r.id, model: r.model_name, titel: r.title, von: r.due_date, bis: r.due_date, art: r.category === 'reise' ? 'Reise' : 'Termin' })
    for (const r of mb.data || []) {
      const von = r.date_from || r.date, bis = r.date_to || r.date_from || r.date
      if (!von || bis < bVon || von > bBis) continue
      ms.push({ key: 'mb' + r.id, model: r.model_name, titel: r.title, von, bis, art: r.category === 'reise' ? 'Reise/Urlaub' : 'Termin' })
    }
    setModelSachen(ms)

    // Schichten (Plan in deutscher Zeit) → feste Zeitpunkte; gefiltert aufs Team im Memo
    const modelName = Object.fromEntries((mo.data || []).map(m => [String(m.id), m.name]))
    setModelle((mo.data || []).map(m => ({ id: m.id, name: m.name })).filter(m => m.name).sort((x, y) => x.name.localeCompare(y.name, 'de')))
    const sch = schichtenAus(sc.data, modelName, plusTage(bVon, -1), plusTage(bBis, 1))
    setSchichten(sch)
  }, [bVon, bBis])

  // v4.67.0: Suche über alle Einträge (1 Jahr zurück, 1 Jahr voraus)
  useEffect(() => {
    const q = suche.trim().toLowerCase()
    if (q.length < 2) { setTreffer(null); return }
    let ab = false
    const t = setTimeout(async () => {
      const { data } = await supabase.from('team_kalender').select('*')
        .gte('beginn', new Date(Date.now() - 365 * 86400000).toISOString())
        .lte('beginn', new Date(Date.now() + 365 * 86400000).toISOString())
        .order('beginn').limit(2000)
      if (ab) return
      const passt = (e) => [e.titel, e.notiz, e.model_name, e.erstellt_von, e.folge_titel, artInfo(e.art).label, ...(e.fuer || []), e.fuer_alle ? 'ganzes team' : '']
        .some(x => String(x || '').toLowerCase().includes(q))
      setTreffer((data || []).filter(passt))
    }, 300)
    return () => { ab = true; clearTimeout(t) }
  }, [suche])

  useEffect(() => { laden() }, [laden])

  // v4.66.0: offene / überfällige Aufgaben (letzte 14 Tage) — unabhängig von der Woche
  const ladeOffene = useCallback(async () => {
    const { data, error } = await supabase.from('team_kalender').select('*')
      .eq('art', 'aufgabe').eq('fuer_alle', false)
      .gte('beginn', new Date(Date.now() - 14 * 86400000).toISOString())
      .lte('beginn', new Date().toISOString())
      .order('beginn', { ascending: false })
    if (error) { setOffene([]); return }
    setOffene((data || []).map(e => ({ ...e, offen: (e.fuer || []).filter(n => !(e.erledigt_von || []).some(x => normName(x) === normName(n))) })).filter(e => e.offen.length))
  }, [])
  useEffect(() => { ladeOffene() }, [ladeOffene])
  useEffect(() => { const t = setInterval(ladeOffene, 5 * 60000); return () => clearInterval(t) }, [ladeOffene])

  // Abwesenheiten (Dienstplan) + Vorlagen — einmal laden
  const ladeZusatz = useCallback(async () => {
    const [ab, vl] = await Promise.all([
      supabase.from('absences').select('chatter_name, date_from, date_to, reason, available_shifts').gte('date_to', plusTage(datumInZone(new Date(), BERLIN).tag, -1)),
      supabase.from('kalender_vorlagen').select('*').order('name'),
    ])
    setAbwesenheiten(ab.data || [])
    setVorlagen(vl.error ? [] : (vl.data || []))
  }, [])
  useEffect(() => { ladeZusatz() }, [ladeZusatz])

  // Schichten rund ums Formular-Datum (für Hinweise + Empfänger nach Model)
  const formTag = form ? form.tag : null
  useEffect(() => {
    if (!formTag) { setFormSchichten(null); return }
    let ab = false
    const mo = montagVon(formTag)
    ;(async () => {
      const [sc, mc] = await Promise.all([
        supabase.from('schedule').select('week_start, status, assignments, shift_times').gte('week_start', plusTage(mo, -7)).lte('week_start', mo),
        supabase.from('models_contact').select('id, name'),
      ])
      if (ab) return
      const modelName = Object.fromEntries((mc.data || []).map(m => [String(m.id), m.name]))
      setFormSchichten({ tag: formTag, planDa: (sc.data || []).some(w => w.week_start === mo), liste: schichtenAus(sc.data, modelName, plusTage(formTag, -1), plusTage(formTag, 1)) })
    })()
    return () => { ab = true }
  }, [formTag])

  // Rückmeldungen zum ausgewählten Eintrag
  const auswahlId = auswahl && auswahl.typ === 'eintrag' ? auswahl.daten.id : null
  useEffect(() => {
    if (!auswahlId) { setRueckmeldungen([]); return }
    let ab = false
    supabase.from('kalender_rueckmeldungen').select('*').eq('kalender_id', auswahlId).order('am').then(({ data }) => { if (!ab) setRueckmeldungen(data || []) })
    return () => { ab = true }
  }, [auswahlId])

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

  // Sichtbare Einträge (Ebenen + Model-Filter) und Schicht-Gruppen — für alle Ansichten
  const sichtbar = useMemo(() => {
    const mf = normName(modelFilter)
    return eintraege.filter(e => ebenen[e.art] && (!mf || normName(e.model_name) === mf))
  }, [eintraege, ebenen, modelFilter])
  const schichtGruppen = useMemo(() => {
    if (!ebenen.schichten) return []
    const mf = normName(modelFilter)
    const team = new Set(teamNamen.map(normName))
    const ich = normName(userDisplayName)
    const gruppen = {}
    for (const x of schichten) {
      const p = normName(x.person)
      // Mit Model-Filter: ALLE Schichten auf diesem Model (wer betreut es wann?)
      if (mf) { if (normName(x.model) !== mf) continue } else if (!team.has(p) && p !== ich) continue
      const s = x.beginn.getTime(), en = x.ende ? x.ende.getTime() : s + 8 * 3600000
      const k = `${p}|${x.shift}|${s}|${en}`
      if (!gruppen[k]) gruppen[k] = { k, s, en, person: x.person, ich: p === ich, shift: x.shift, entwurf: false, zeilen: [] }
      gruppen[k].zeilen.push(x.zusatz ? `${x.model} · ${x.zusatz}` : x.model)
      if (x.entwurf) gruppen[k].entwurf = true
    }
    return Object.values(gruppen)
  }, [schichten, ebenen, modelFilter, teamNamen, userDisplayName])

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
    for (const e of sichtbar) {
      const s = new Date(e.beginn).getTime()
      const en = e.ende ? new Date(e.ende).getTime() : s + OHNE_ENDE_MIN * 60000
      eintragen(s, en, { typ: 'eintrag', id: e.id, daten: e, farbe: artInfo(e.art).farbe })
    }
    for (const g of schichtGruppen) eintragen(g.s, g.en, { typ: 'schicht', id: 'sch' + g.k, daten: g, farbe: SCHICHT_FARBE })
    for (const t of tage) m[t] = spaltenVerteilen(m[t])
    return m
  }, [sichtbar, schichtGruppen, tage, tagesGrenzen])

  // v4.67.0: Einträge nach Starttag (Anzeige-Zone) — für Monat und Liste
  const proTag = useMemo(() => {
    const m = {}
    const rein = (tag, it) => { (m[tag] = m[tag] || []).push(it) }
    for (const e of sichtbar) rein(datumInZone(e.beginn, anzeigeZone).tag, { typ: 'eintrag', t: new Date(e.beginn).getTime(), daten: e })
    for (const g of schichtGruppen) rein(datumInZone(new Date(g.s), anzeigeZone).tag, { typ: 'schicht', t: g.s, daten: g })
    for (const k of Object.keys(m)) m[k].sort((a, b) => a.t - b.t)
    return m
  }, [sichtbar, schichtGruppen, anzeigeZone])
  const modelAmTag = useCallback((t) => (ebenen.models ? modelSachen.filter(s => t >= s.von && t <= s.bis && (!modelFilter || normName(s.model) === normName(modelFilter))) : []), [ebenen, modelSachen, modelFilter])

  const modelProTag = useMemo(() => {
    const m = Object.fromEntries(tage.map(t => [t, []]))
    if (!ebenen.models) return m
    for (const s of modelSachen) {
      if (modelFilter && normName(s.model) !== normName(modelFilter)) continue
      for (const t of tage) if (t >= s.von && t <= s.bis) m[t].push(s)
    }
    return m
  }, [modelSachen, tage, ebenen, modelFilter])

  // ── Formular ──────────────────────────────────────────────────────────────
  const oeffneNeu = (tag, stunde) => {
    const f = leer()
    if (tag) {
      // Klick ins Raster: Zeitpunkt in der Anzeige-Zone → deutsche Zeit fürs Formular
      const zeitpunkt = wandzeitZuDatum(tag, `${String(stunde ?? 9).padStart(2, '0')}:00`, anzeigeZone)
      const de = datumInZone(zeitpunkt, BERLIN)
      f.tag = de.tag; if (stunde != null) f.von = de.zeit
    }
    if (modelFilter) f.model_name = modelFilter
    setForm(f); setAuswahl(null)
  }
  const oeffneBearbeiten = (e) => {
    const b = datumInZone(e.beginn, BERLIN)
    const folgenAlt = eintraege.filter(x => x.folge_von === e.id)
    setForm({ id: e.id, titel: e.titel, art: e.art, tag: b.tag, von: b.zeit, bis: e.ende ? zeitIn(e.ende, BERLIN) : '', notiz: e.notiz || '', fuer: e.fuer || [], fuer_alle: !!e.fuer_alle, erinnern_min: e.erinnern_min ?? null, telegram: false, folgen: [], folgenAlt, wiederholung: e.wiederholung || '', wdhBis: '', serie_id: e.serie_id || null, umfang: 'diesen', folge_von: e.folge_von || null, altBeginn: e.beginn, model_name: e.model_name || '' })
    setAuswahl(null)
  }
  const formBeginn = form && form.tag && form.von ? wandzeitZuDatum(form.tag, form.von, BERLIN) : null
  const formEnde = (() => {
    if (!formBeginn || !form.bis) return null
    let e = wandzeitZuDatum(form.tag, form.bis, BERLIN)
    if (e <= formBeginn) e = new Date(e.getTime() + 24 * 3600 * 1000)
    return e
  })()

  // ── v4.66.0: Hinweise zu den Empfängern (nachts / abwesend / keine Schicht) ──
  const zoneVon = (n) => zonenListe.find(z => normName(z.name) === normName(n))?.zone || BERLIN
  const istTeam = (n) => teamNamen.some(t => normName(t) === normName(n))
  const hinweiseFuer = (namen, zeitpunkt, wofuer) => {
    const out = []
    if (!zeitpunkt) return out
    const t = zeitpunkt.getTime()
    const tagDe = datumInZone(zeitpunkt, BERLIN).tag
    const liste = formSchichten && formSchichten.tag === form?.tag ? formSchichten.liste : null
    for (const n of namen) {
      if (normName(n) === normName(userDisplayName)) continue
      const zone = zoneVon(n)
      const std = Number(zeitIn(zeitpunkt, zone).slice(0, 2))
      if (std < NACHT_BIS || std >= NACHT_AB) out.push({ stufe: 'nacht', name: n, text: `🌙 ${n}: ${zeitIn(zeitpunkt, zone)} Uhr bei ihm/ihr (${ortAus(zone)})${wofuer}` })
      const ab = abwesenheiten.find(a => normName(a.chatter_name) === normName(n) && a.date_from <= tagDe && tagDe <= a.date_to)
      if (ab) {
        const teil = (ab.available_shifts || []).length ? ` – nur ${ab.available_shifts.join('/')} verfügbar` : ''
        out.push({ stufe: 'abwesend', name: n, text: `🚫 ${n} ist abgemeldet (${ab.reason || 'abwesend'}${teil})${wofuer}` })
      } else if (liste && formSchichten.planDa && !istTeam(n) && !liste.some(x => normName(x.person) === normName(n) && deckt(x, t))) {
        out.push({ stufe: 'schicht', name: n, text: `○ ${n} hat zu der Zeit keine Schicht${wofuer}` })
      }
    }
    return out
  }
  const formHinweise = (() => {
    if (!form || !formBeginn) return []
    const namen = form.fuer_alle ? [] : form.fuer // „Ganzes Team": keine Einzelprüfung
    const h = hinweiseFuer(namen, formBeginn, '')
    for (const f of form.folgen || []) {
      if (!f.titel.trim()) continue
      h.push(...hinweiseFuer(f.fuer, folgeBeginn(formBeginn, formEnde, f.bezug, f.offset), ` · Folgeaufgabe „${f.titel.trim()}"`))
    }
    return h
  })()

  // Wer hat zum Zeitpunkt Schicht auf dem Model? (sonst: wer an dem Tag)
  const inSchicht = (model, zeitpunkt) => {
    if (!model || !zeitpunkt || !formSchichten || formSchichten.tag !== form?.tag) return null
    const t = zeitpunkt.getTime()
    const aufModel = formSchichten.liste.filter(x => normName(x.model) === normName(model))
    const jetztDa = [...new Set(aufModel.filter(x => deckt(x, t)).map(x => x.person))]
    const tagDe = datumInZone(zeitpunkt, BERLIN).tag
    const amTag = [...new Set(aufModel.filter(x => x.planTag === tagDe).map(x => `${x.person} (${x.shift})`))]
    return { jetztDa, amTag }
  }

  // ── Vorlagen ──
  const vorlageAnwenden = (v) => {
    const d = v.daten || {}
    setForm(f => ({
      ...f, titel: d.titel ?? f.titel, art: d.art || f.art, von: d.von ?? f.von, bis: d.bis ?? '', notiz: d.notiz ?? '',
      fuer: d.fuer_alle ? [] : (d.fuer || f.fuer), fuer_alle: !!d.fuer_alle, erinnern_min: d.erinnern_min ?? null,
      model_name: d.model_name || f.model_name || '',
      folgen: (d.folgen || []).map(x => ({ ...neueFolge(x.fuer || []), titel: x.titel || '', bezug: x.bezug || 'ende', offset: x.offset ?? 0 })),
    }))
  }
  const alsVorlageSpeichern = async () => {
    const name = window.prompt('Name der Vorlage (z. B. „Stream Chiara"):', form.titel || '')
    if (!name || !name.trim()) return
    const daten = {
      titel: form.titel.trim(), art: form.art, von: form.von, bis: form.bis, notiz: form.notiz, fuer: form.fuer_alle ? [] : form.fuer,
      fuer_alle: form.fuer_alle, erinnern_min: form.erinnern_min, model_name: form.model_name || null,
      folgen: [...(form.folgen || []).filter(f => f.titel.trim()).map(f => ({ titel: f.titel.trim(), bezug: f.bezug, offset: f.offset, fuer: f.fuer })),
        ...(form.folgenAlt || []).filter(f => f.folge_offset_min != null).map(f => ({ titel: f.titel, bezug: f.folge_bezug, offset: f.folge_offset_min, fuer: f.fuer || [] }))],
    }
    const { error } = await supabase.from('kalender_vorlagen').insert({ name: name.trim(), daten, erstellt_von: userDisplayName || null })
    if (error) { alert('⚠ Vorlage nicht gespeichert: ' + (error.message.includes('kalender_vorlagen') ? 'Tabelle fehlt — SQL „team-kalender-ausbau.sql" ausführen.' : error.message)); return }
    ladeZusatz()
    alert(`Vorlage „${name.trim()}" gespeichert.`)
  }
  const vorlageLoeschen = async (v) => {
    if (!confirm(`Vorlage „${v.name}" löschen?`)) return
    const { error } = await supabase.from('kalender_vorlagen').delete().eq('id', v.id)
    if (error) { alert('⚠ ' + error.message); return }
    ladeZusatz()
  }

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
      const bezug = (e.model_name && !normName(e.titel).includes(normName(e.model_name)) ? `\nModel: ${e.model_name}` : '') + (e.folge_titel ? `\nFolgeaufgabe zu: ${e.folge_titel}` : '') + (e.serie_hinweis ? `\n🔁 ${e.serie_hinweis}` : '')
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
    // Folgeaufgabe ohne Personen → dieselben Personen wie das Event (z. B. aus einer Vorlage)
    const folgenNeu = form.folgen.filter(f => f.titel.trim()).map(f => ({ ...f, fuer: f.fuer.length ? f.fuer : (form.fuer_alle ? [] : form.fuer) }))
    if (folgenNeu.some(f => f.fuer.length === 0)) { alert('Jede Folgeaufgabe braucht mindestens eine Person (bei „Ganzes Team" bitte Personen für die Folgeaufgabe wählen).'); return }
    if (neueSerie && (!form.wdhBis || form.wdhBis <= form.tag)) { alert('Bis wann soll wiederholt werden? Bitte ein Datum nach dem ersten Termin wählen.'); return }
    const tageListe = neueSerie ? serienTage(form.tag, form.wiederholung, form.wdhBis) : [form.tag]
    if (tageListe.length >= MAX_SERIE && !confirm(`Es werden höchstens ${MAX_SERIE} Termine angelegt (bis ${kurzTag(tageListe[tageListe.length - 1])}). Weiter?`)) return

    const beginn = formBeginn, ende = formEnde
    const basis = {
      titel: form.titel.trim(), art: form.art,
      notiz: form.notiz.trim() || null, fuer: form.fuer_alle ? [] : form.fuer, fuer_alle: form.fuer_alle,
      erinnern_min: form.erinnern_min ?? null, geaendert_am: new Date().toISOString(),
      model_name: form.model_name || null,
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
        if ((f.model_name || null) !== (p.model_name || null)) upd.model_name = p.model_name || null
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
        model_name: z.model_name || null,
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
    laden(); ladeOffene()
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
    setAuswahl(null); laden(); ladeOffene()
  }

  // v4.65.0: Aufgaben, in denen ich stehe, direkt hier abhaken
  const abhaken = async (e, wert) => {
    const { data, error } = await supabase.rpc('kalender_erledigt', { p_id: e.id, p_erledigt: wert })
    if (error) { alert('⚠ Nicht gespeichert: ' + error.message); return }
    if (wert) erledigtMelden(e, data, userDisplayName)
    setAuswahl({ typ: 'eintrag', daten: { ...e, erledigt_von: data || [] } })
    laden(); ladeOffene()
  }

  // ── v4.66.0: Verschieben per Ziehen (nur am Computer) ────────────────────
  const verschobenUm = (e, tageD, minuten) => {
    const d = datumInZone(e.beginn, anzeigeZone)
    const b = new Date(wandzeitZuDatum(plusTage(d.tag, tageD), d.zeit, anzeigeZone).getTime() + minuten * 60000)
    const dauer = e.ende ? new Date(e.ende).getTime() - new Date(e.beginn).getTime() : null
    return { beginn: b, ende: dauer != null ? new Date(b.getTime() + dauer) : null }
  }
  const zugStart = (ev, b) => {
    if (mobil || b.typ !== 'eintrag' || ev.button !== 0) return
    const grid = rasterGridRef.current
    if (!grid) return
    const r = grid.getBoundingClientRect()
    const spalte = (r.width - zeitSpalte) / sichtbareTage.length
    zugRef.current = { id: b.id, e: b.daten, x0: ev.clientX, y0: ev.clientY, spalte, aktiv: false, tage: 0, minuten: 0 }
    const move = (m) => {
      const z = zugRef.current
      if (!z) return
      const dx = m.clientX - z.x0, dy = m.clientY - z.y0
      if (!z.aktiv && Math.abs(dx) + Math.abs(dy) < 6) return
      z.aktiv = true
      z.tage = Math.round(dx / z.spalte)
      z.minuten = Math.round(((dy / STUNDE_PX) * 60) / 15) * 15
      setZiehen({ id: z.id, tage: z.tage, minuten: z.minuten, spalte: z.spalte })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const z = zugRef.current
      zugRef.current = null
      setZiehen(null)
      if (!z || !z.aktiv) return
      gezogenRef.current = true // den folgenden Klick nicht als „Auswählen" werten
      if (!z.tage && !z.minuten) return
      setVerschieben({ e: z.e, ...verschobenUm(z.e, z.tage, z.minuten), telegram: false })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const verschiebenSpeichern = async () => {
    const { e, beginn, ende, telegram } = verschieben
    const upd = { beginn: beginn.toISOString(), ende: ende ? ende.toISOString() : null, erinnerung_gesendet: false, geaendert_am: new Date().toISOString() }
    // Folgeaufgabe von Hand verschoben → neuen Abstand zum Event merken, damit sie weiter mitwandert
    const haupt = e.folge_von ? eintraege.find(x => x.id === e.folge_von) : null
    if (haupt && e.folge_offset_min != null) {
      const basis = e.folge_bezug === 'beginn' || !haupt.ende ? new Date(haupt.beginn) : new Date(haupt.ende)
      upd.folge_offset_min = Math.round((beginn.getTime() - basis.getTime()) / 60000)
    }
    setSpeichert(true)
    const { data, error } = await supabase.from('team_kalender').update(upd).eq('id', e.id).select().single()
    if (error) { setSpeichert(false); alert('⚠ Nicht verschoben: ' + error.message); return }
    const meldungen = []
    const { data: folgen } = await supabase.from('team_kalender').select('*').eq('folge_von', e.id)
    for (const f of folgen || []) {
      if (f.folge_offset_min == null) continue
      const neu = folgeBeginn(beginn, ende, f.folge_bezug, f.folge_offset_min)
      const { error: e2 } = await supabase.from('team_kalender').update({ beginn: neu.toISOString(), erinnerung_gesendet: false, geaendert_am: new Date().toISOString() }).eq('id', f.id)
      if (e2) meldungen.push(`Folgeaufgabe „${f.titel}" nicht verschoben: ${e2.message}`)
    }
    if (telegram) {
      const r = await benachrichtigen(data, true)
      if (r.fehlt.length) meldungen.push(`Ohne Telegram-ID: ${r.fehlt.join(', ')}`)
      if (r.fehler.length) meldungen.push(`Telegram NICHT angekommen: ${r.fehler.join(', ')}`)
    }
    const de = datumInZone(beginn, BERLIN)
    logActivity('kalender.edit', { entity: e.titel, detail: `verschoben auf ${de.tag} ${de.zeit} (DE)` })
    setSpeichert(false); setVerschieben(null)
    if (meldungen.length) alert('Verschoben.\n\n' + meldungen.join('\n'))
    laden(); ladeOffene()
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12 }
  const inp = { background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }
  const lbl = { fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }
  const btn = (aktiv) => ({ padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: aktiv ? '#7c3aed' : 'transparent', color: aktiv ? '#fff' : 'var(--text-secondary)', border: `1px solid ${aktiv ? '#7c3aed' : 'var(--border)'}`, whiteSpace: 'nowrap' })
  // v4.84.0: Auswahl-Chips im Formular
  const chipK = (aktiv, farbe = '#7c3aed') => ({ padding: '7px 12px', borderRadius: 20, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: aktiv ? farbe + '2a' : 'transparent', color: aktiv ? farbe : 'var(--text-secondary)', border: `1px solid ${aktiv ? farbe : 'var(--border)'}`, whiteSpace: 'nowrap' })
  const kopfLabel = { fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }
  const kw = (() => { const d = new Date(woche + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 3); const j = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); return 1 + Math.round(((d - j) / 864e5 - 3 + ((j.getUTCDay() + 6) % 7)) / 7) })()

  const EBENEN = [...ARTEN.map(a => ({ key: a.key, label: a.label, farbe: a.farbe })), { key: 'models', label: 'Models: Termine & Urlaub', farbe: MODEL_FARBE }, { key: 'schichten', label: 'Schichten Team', farbe: SCHICHT_FARBE }]
  const ebenenListe = (
    <div style={{ display: 'flex', flexDirection: mobil ? 'row' : 'column', gap: 6, flexWrap: 'wrap', alignItems: mobil ? 'center' : 'flex-start' }}>
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
          {e.model_name && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ton-gruen)', background: 'rgba(16,185,129,0.14)', padding: '3px 8px', borderRadius: 5 }}>{e.model_name}</span>}
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>angelegt von {e.erstellt_von || '—'}</span>
        </div>
        <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.25 }}>{e.titel}</div>
        {hauptEvent ? <button onClick={() => setAuswahl({ typ: 'eintrag', daten: hauptEvent })} style={{ ...btn(false), alignSelf: 'flex-start', fontSize: 11 }}>↩ Folgeaufgabe zu „{hauptEvent.titel}"</button>
          : e.folge_titel ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>↳ Folgeaufgabe zu „{e.folge_titel}"</div> : null}
        {e.serie_id && <div style={{ fontSize: 12, color: 'var(--ton-lila)' }}>🔁 Wiederholt sich {wdhLabel(e.wiederholung)}</div>}
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
                return <span key={n} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, background: fertig ? 'rgba(16,185,129,0.15)' : 'rgba(124,58,237,0.15)', color: fertig ? 'var(--ton-gruen)' : 'var(--ton-lila2)' }}>{fertig ? '✓ ' : ''}{n}</span>
              })}
          </div>
          {e.fuer_alle && (e.erledigt_von || []).length > 0 && <div style={{ fontSize: 12, color: '#10b981' }}>✓ erledigt von {(e.erledigt_von || []).join(', ')}</div>}
          {e.erinnern_min ? <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>⏰ Erinnerung {ERINNERUNGEN.find(r => r.min === e.erinnern_min)?.label || `${e.erinnern_min} Min vorher`}{e.erinnerung_gesendet ? ' · verschickt' : ''}</div> : null}
          {e.nachgehakt_am && <div style={{ fontSize: 12, color: '#f59e0b' }}>⏳ Nachgehakt {new Date(e.nachgehakt_am).toLocaleString('de-DE', { timeZone: anzeigeZone, weekday: 'short', hour: '2-digit', minute: '2-digit' })}{e.eskaliert_am ? ' · an Chris/Rey gemeldet' : ''}</div>}
        </div>
        {rueckmeldungen.length > 0 && (
          <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={kopfLabel}>💬 Rückmeldungen</div>
            {rueckmeldungen.map(r => (
              <div key={r.id} style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                <b>{r.von}</b> <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{new Date(r.am).toLocaleString('de-DE', { timeZone: anzeigeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-secondary)', marginTop: 2 }}>{r.text}</div>
              </div>
            ))}
          </div>
        )}
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
                <span style={{ fontSize: 12, fontWeight: 700, color: istHeute ? 'var(--ton-lila)' : 'var(--text-secondary)' }}>{TAGE[wochentag(t)]} {kurzTag(t)}{istHeute ? ' · heute' : ''}</span>
                <button onClick={() => oeffneNeu(t)} title="Eintrag an diesem Tag" aria-label={`Eintrag am ${kurzTag(t)}`} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 15, padding: '0 2px' }}>+</button>
              </div>
              {modelProTag[t].map(s => (
                <div key={s.key + t} title={`${s.model} · ${s.art}: ${s.titel}`} style={{ marginTop: 4, fontSize: 10.5, padding: '2px 6px', borderRadius: 5, background: 'rgba(16,185,129,0.14)', color: 'var(--ton-gruen)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.model} · {s.art}: {s.titel}
                </div>
              ))}
            </div>
          )
        })}
      </div>
      {/* Stunden */}
      <div ref={rasterRef} style={{ overflowY: 'auto', maxHeight: mobil ? 'calc(100vh - 330px)' : 640, minHeight: 320 }}>
        <div ref={rasterGridRef} style={{ display: 'grid', gridTemplateColumns: `${zeitSpalte}px repeat(${sichtbareTage.length}, minmax(0, 1fr))`, position: 'relative', height: 24 * STUNDE_PX }}>
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
                  const gezogen = !!(ziehen && ziehen.id === b.id)
                  const ueberfaellig = !schicht && e.art === 'aufgabe' && !e.fuer_alle && new Date(e.beginn).getTime() < jetzt && (e.fuer || []).some(n => !(e.erledigt_von || []).some(x => normName(x) === normName(n)))
                  return (
                    <button key={b.id + '|' + b.start}
                      onPointerDown={ev => zugStart(ev, b)}
                      onClick={() => { if (gezogenRef.current) { gezogenRef.current = false; return } setAuswahl({ typ: b.typ, daten: e }) }}
                      style={{
                        position: 'absolute', top: top + 1, height: hoehe, left: `calc(${b.spalte * breiteP}% + 2px)`, width: `calc(${breiteP}% - 4px)`,
                        boxSizing: 'border-box', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', overflow: 'hidden', padding: '3px 6px',
                        background: schicht ? 'rgba(100,116,139,0.14)' : b.farbe + '26',
                        border: `1px ${schicht && e.entwurf ? 'dashed' : 'solid'} ${b.farbe}66`, borderLeft: `3px solid ${b.farbe}`, borderRadius: 6,
                        borderTopLeftRadius: b.fortsetzung ? 0 : 6, borderBottomLeftRadius: b.abgeschnitten ? 0 : 6,
                        outline: aktiv ? `2px solid ${b.farbe}` : 'none', outlineOffset: 1, color: 'var(--text-primary)', zIndex: gezogen ? 6 : aktiv ? 3 : schicht ? 1 : 2,
                        cursor: !mobil && !schicht ? (gezogen ? 'grabbing' : 'grab') : 'pointer', userSelect: 'none', touchAction: mobil ? 'auto' : 'none',
                        transform: gezogen ? `translate(${ziehen.tage * ziehen.spalte}px, ${(ziehen.minuten / 60) * STUNDE_PX}px)` : 'none',
                        opacity: gezogen ? 0.85 : 1, boxShadow: gezogen ? '0 8px 24px rgba(0,0,0,0.45)' : 'none',
                      }}>
                      {schicht ? (
                        <>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#cbd5e1', lineHeight: 1.25 }}>{e.ich ? 'Ich' : e.person} · {e.shift}</div>
                          {hoehe > 34 && <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.3 }}>{e.zeilen.join(' · ')}</div>}
                        </>
                      ) : (
                        <>
                          <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.25, color: 'var(--text-primary)', whiteSpace: hoehe < 30 ? 'nowrap' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {ueberfaellig ? '⏳ ' : ''}{e.folge_von ? '↳ ' : ''}{e.serie_id ? '🔁 ' : ''}{e.titel}
                          </div>
                          {gezogen && <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ton-gelb2)' }}>→ {(() => { const n = verschobenUm(e, ziehen.tage, ziehen.minuten); return `${TAGE[wochentag(datumInZone(n.beginn, anzeigeZone).tag)]} ${zeitIn(n.beginn, anzeigeZone)}` })()}</div>}
                          {hoehe > 30 && !gezogen && <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.3 }}>{e.model_name && !normName(e.titel).includes(normName(e.model_name)) ? `${e.model_name} · ` : ''}{zeitIn(e.beginn, anzeigeZone)}{e.ende ? '–' + zeitIn(e.ende, anzeigeZone) : ''} · {e.fuer_alle ? 'Team' : (e.fuer || []).join(', ')}{(e.erledigt_von || []).length ? ` · ✓${e.erledigt_von.length}` : ''}</div>}
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
            <span style={{ color: z.team ? 'var(--ton-lila)' : 'var(--text-primary)' }}>{z.name}</span>
            <span style={{ color: z.zone ? (z.bestaetigt ? '#10b981' : 'var(--text-secondary)') : 'var(--text-muted)', textAlign: 'right' }}>
              {z.zone ? `${ortAus(z.zone)} ${utcLabel(z.zone)}${z.bestaetigt ? ' ✓' : ''}` : 'unbekannt'}
            </span>
          </div>
        ))}
      </div>
    </details>
  )

  // v4.66.0: Model-Filter + Liste „Offen"
  const modelWahl = (
    <select value={modelFilter} onChange={e => setModelFilter(e.target.value)} aria-label="Nach Model filtern" style={{ ...inp, padding: '6px 8px', fontSize: 12, width: mobil ? 'auto' : '100%' }}>
      <option value="">Alle Models</option>
      {modelle.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
    </select>
  )
  const seitText = (iso) => {
    const min = Math.floor((jetzt - new Date(iso).getTime()) / 60000)
    if (min < 60) return `seit ${min} Min`
    const h = Math.floor(min / 60)
    return h < 48 ? `seit ${h} Std` : `seit ${Math.floor(h / 24)} Tagen`
  }
  const offeneGefiltert = modelFilter ? offene.filter(e => normName(e.model_name) === normName(modelFilter)) : offene
  const offenListe = (
    <details open={!mobil && offeneGefiltert.length > 0 && offeneGefiltert.length <= 6}>
      <summary style={{ cursor: 'pointer', ...kopfLabel, marginBottom: 0, listStyle: 'none', color: offeneGefiltert.length ? '#f59e0b' : 'var(--text-muted)' }}>⏳ Offen · {offeneGefiltert.length} überfällig ▾</summary>
      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
        {offeneGefiltert.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Nichts überfällig.</div>}
        {offeneGefiltert.map(e => (
          <button key={e.id} onClick={() => { const t = datumInZone(e.beginn, anzeigeZone).tag; setWoche(montagVon(t)); setMobilTag(t); setAuswahl({ typ: 'eintrag', daten: e }) }}
            style={{ textAlign: 'left', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 7, padding: '6px 8px', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-primary)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>{e.titel}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{seitText(e.beginn)} · offen: {e.offen.join(', ')}</div>
          </button>
        ))}
      </div>
    </details>
  )

  // ── v4.67.0: Liste (Agenda) ───────────────────────────────────────────────
  const zeile = (it, vergangen) => {
    if (it.typ === 'schicht') {
      const g = it.daten
      return (
        <button key={'s' + g.k} onClick={() => setAuswahl({ typ: 'schicht', daten: g })} style={{ display: 'flex', gap: 10, alignItems: 'stretch', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '6px 0', cursor: 'pointer', fontFamily: 'inherit', opacity: vergangen ? 0.55 : 1 }}>
          <span style={{ width: 44, flexShrink: 0, fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)', paddingTop: 1 }}>{zeitIn(new Date(g.s), anzeigeZone)}</span>
          <span style={{ width: 3, borderRadius: 2, background: SCHICHT_FARBE, flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 12.5, color: '#cbd5e1', fontWeight: 600 }}>{g.ich ? 'Meine Schicht' : g.person} · {g.shift}{g.entwurf ? ' (Entwurf)' : ''}</span>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>bis {zeitIn(new Date(g.en), anzeigeZone)} · {g.zeilen.join(' · ')}</span>
          </span>
        </button>
      )
    }
    const e = it.daten, a = artInfo(e.art)
    const offen = e.art === 'aufgabe' && !e.fuer_alle ? (e.fuer || []).filter(n => !(e.erledigt_von || []).some(x => normName(x) === normName(n))) : []
    const ueber = offen.length > 0 && new Date(e.beginn).getTime() < jetzt
    const fertig = e.art === 'aufgabe' && !e.fuer_alle && (e.fuer || []).length > 0 && offen.length === 0
    return (
      <button key={e.id} onClick={() => setAuswahl({ typ: 'eintrag', daten: e })} style={{ display: 'flex', gap: 10, alignItems: 'stretch', width: '100%', textAlign: 'left', background: auswahl?.daten?.id === e.id ? 'rgba(124,58,237,0.10)' : 'transparent', border: 'none', borderRadius: 8, padding: '7px 4px', cursor: 'pointer', fontFamily: 'inherit', opacity: vergangen || fertig ? 0.6 : 1 }}>
        <span style={{ width: 44, flexShrink: 0, fontFamily: 'monospace', fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', paddingTop: 1 }}>{zeitIn(e.beginn, anzeigeZone)}</span>
        <span style={{ width: 3, borderRadius: 2, background: a.farbe, flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, textDecoration: fertig ? 'line-through' : 'none' }}>
            {ueber ? '⏳ ' : ''}{e.folge_von ? '↳ ' : ''}{e.serie_id ? '🔁 ' : ''}{e.titel}
          </span>
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginTop: 1 }}>
            {a.label}{e.ende ? ` · bis ${zeitIn(e.ende, anzeigeZone)}` : ''}{e.model_name ? ` · ${e.model_name}` : ''} · {e.fuer_alle ? 'Ganzes Team' : (e.fuer || []).join(', ')}{(e.erledigt_von || []).length && !e.fuer_alle ? ` · ✓${e.erledigt_von.length}/${(e.fuer || []).length}` : ''}
          </span>
        </span>
      </button>
    )
  }
  const tagKopf = (t, extra) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '10px 0 4px', borderBottom: '1px solid var(--border)', marginBottom: 2 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: t === heute ? 'var(--ton-lila)' : 'var(--text-primary)' }}>
        {t === heute ? 'Heute · ' : t === plusTage(heute, 1) ? 'Morgen · ' : ''}{new Date(t + 'T12:00:00Z').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' })}
      </span>
      {extra}
    </div>
  )
  const modelZeilen = (t) => modelAmTag(t).map(m => (
    <div key={m.key + t} style={{ display: 'flex', gap: 10, padding: '4px 0', fontSize: 11.5, color: 'var(--ton-gruen)' }}>
      <span style={{ width: 44, flexShrink: 0, fontSize: 10.5, color: 'var(--text-muted)' }}>ganztags</span>
      <span style={{ width: 3, borderRadius: 2, background: MODEL_FARBE, flexShrink: 0 }} />
      <span>{m.model} · {m.art}: {m.titel}</span>
    </div>
  ))
  const listenAnsicht = (() => {
    if (treffer) {
      const kommend = treffer.filter(e => new Date(e.ende || e.beginn).getTime() >= jetzt)
      const vorbei = treffer.filter(e => new Date(e.ende || e.beginn).getTime() < jetzt).reverse()
      const gruppiert = (liste) => {
        const g = []
        for (const e of liste) { const t = datumInZone(e.beginn, anzeigeZone).tag; let x = g.find(y => y.t === t); if (!x) { x = { t, items: [] }; g.push(x) } x.items.push({ typ: 'eintrag', daten: e }) }
        return g
      }
      return (
        <div style={{ ...card, padding: mobil ? '4px 12px 12px' : '6px 16px 16px', flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>{treffer.length} Treffer für „{suche.trim()}"{treffer.length ? '' : ' — nichts gefunden (gesucht in Titel, Notiz, Model, Personen)'}</div>
          {gruppiert(kommend).map(g => <div key={g.t}>{tagKopf(g.t)}{g.items.map(it => zeile(it, false))}</div>)}
          {vorbei.length > 0 && <div style={{ ...kopfLabel, marginTop: 16 }}>Vergangen</div>}
          {gruppiert(vorbei).map(g => <div key={'v' + g.t}>{tagKopf(g.t)}{g.items.map(it => zeile(it, true))}</div>)}
        </div>
      )
    }
    const tageListe = Array.from({ length: listeTage }, (_, i) => plusTage(listeVon, i))
    const mitInhalt = tageListe.filter(t => (proTag[t] || []).length || modelAmTag(t).length)
    return (
      <div style={{ ...card, padding: mobil ? '4px 12px 12px' : '6px 16px 16px', flex: 1, minWidth: 0 }}>
        {mitInhalt.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '18px 0' }}>Keine Einträge vom {kurzTag(listeVon)} bis {kurzTag(plusTage(listeVon, listeTage - 1))}.</div>}
        {tageListe.map(t => {
          const items = proTag[t] || [], ms = modelAmTag(t)
          if (!items.length && !ms.length && t !== heute) return null
          return (
            <div key={t}>
              {tagKopf(t, <button onClick={() => oeffneNeu(t)} aria-label={`Eintrag am ${kurzTag(t)}`} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}>+</button>)}
              {modelZeilen(t)}
              {items.map(it => zeile(it, false))}
              {!items.length && !ms.length && <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0 6px 54px' }}>Nichts eingetragen.</div>}
            </div>
          )
        })}
        <button onClick={() => setListeTage(n => n + 21)} style={{ ...btn(false), width: '100%', marginTop: 12 }}>Weitere 3 Wochen laden</button>
      </div>
    )
  })()

  // ── v4.67.0: Monat ────────────────────────────────────────────────────────
  const monatsAnsicht = (() => {
    const start = bereich.von
    const wochen = Math.round((tageZwischen(bereich.von, bereich.bis) + 1) / 7)
    const monat = monatAnker.slice(0, 7)
    return (
      <div style={{ ...card, overflow: 'hidden', flex: 1, minWidth: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: '1px solid var(--border)' }}>
          {TAGE.map(d => <div key={d} style={{ padding: '6px 8px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>{d}</div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
          {Array.from({ length: wochen * 7 }, (_, i) => {
            const t = plusTage(start, i)
            const items = proTag[t] || [], ms = modelAmTag(t)
            const eintr = items.filter(x => x.typ === 'eintrag')
            const imMonat = t.slice(0, 7) === monat
            const istHeute = t === heute
            return (
              <div key={t} onClick={() => { if (mobil) { setListeVon(t); setListeTage(21); setAnsicht('liste') } else { setWoche(montagVon(t)); setAnsicht('woche') } }}
                style={{ minHeight: mobil ? 58 : 104, borderRight: (i % 7) < 6 ? '1px solid var(--border)' : 'none', borderBottom: '1px solid var(--border)', padding: mobil ? '4px 3px' : '5px 6px', cursor: 'pointer', background: istHeute ? 'rgba(124,58,237,0.08)' : 'transparent', opacity: imMonat ? 1 : 0.45, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: istHeute ? 800 : 600, color: istHeute ? 'var(--ton-lila)' : 'var(--text-secondary)', textAlign: mobil ? 'center' : 'left' }}>{Number(t.slice(8))}</div>
                {mobil ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, justifyContent: 'center', marginTop: 4 }}>
                    {ms.length > 0 && <span style={{ width: 6, height: 6, borderRadius: '50%', background: MODEL_FARBE }} />}
                    {eintr.slice(0, 5).map(x => <span key={x.daten.id} style={{ width: 6, height: 6, borderRadius: '50%', background: artInfo(x.daten.art).farbe }} />)}
                    {eintr.length > 5 && <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>+{eintr.length - 5}</span>}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 3 }}>
                    {ms.slice(0, 1).map(m => <div key={m.key} style={{ fontSize: 10, color: 'var(--ton-gruen)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.model}: {m.titel}</div>)}
                    {eintr.slice(0, 3).map(x => {
                      const e = x.daten
                      return (
                        <div key={e.id} onClick={ev => { ev.stopPropagation(); setAuswahl({ typ: 'eintrag', daten: e }) }} title={e.titel}
                          style={{ fontSize: 10.5, padding: '1px 4px', borderRadius: 4, borderLeft: `2px solid ${artInfo(e.art).farbe}`, background: artInfo(e.art).farbe + '1f', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{zeitIn(e.beginn, anzeigeZone)}</span> {e.titel}
                        </div>
                      )
                    })}
                    {eintr.length > 3 && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>+{eintr.length - 3} weitere</div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  })()

  // ── v4.67.0: Kopf / Navigation je Ansicht ─────────────────────────────────
  const blaettern = (richtung) => {
    if (ansicht === 'monat') setMonatAnker(monatPlus(monatAnker, richtung))
    else if (ansicht === 'liste') { setListeVon(plusTage(listeVon, richtung * 7)) }
    else setWoche(plusTage(woche, richtung * 7))
  }
  const zuHeute = () => { setWoche(montagVon(heute)); setMobilTag(heute); setMonatAnker(monatErster(heute)); setListeVon(heute); setListeTage(21) }
  const kopfTitel = treffer ? 'Suche'
    : ansicht === 'monat' ? monatName(monatAnker, mobil)
    : ansicht === 'liste' ? (listeVon === heute ? (mobil ? 'Ab heute' : 'Liste · ab heute') : `ab ${TAGE[wochentag(listeVon)]} ${kurzTag(listeVon)}`)
    : mobil ? `KW ${kw}` : `KW ${kw} · ${kurzTag(woche)} – ${kurzTag(plusTage(woche, 6))}`
  const ANSICHTEN = [{ key: 'liste', label: 'Liste' }, { key: 'woche', label: mobil ? 'Tag' : 'Woche' }, { key: 'monat', label: 'Monat' }]
  const umschalter = (
    <div style={{ display: 'inline-flex', background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 9, padding: 2, flex: mobil ? 1 : 'none' }}>
      {(mobil ? ANSICHTEN : [ANSICHTEN[1], ANSICHTEN[2], ANSICHTEN[0]]).map(a => (
        <button key={a.key} onClick={() => { setAnsicht(a.key); if (a.key !== 'liste') { setSuche(''); setSucheOffen(false) } }}
          style={{ flex: 1, padding: mobil ? '7px 0' : '5px 14px', borderRadius: 7, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', border: 'none', background: ansicht === a.key ? '#7c3aed' : 'transparent', color: ansicht === a.key ? '#fff' : 'var(--text-secondary)' }}>{a.label}</button>
      ))}
    </div>
  )
  const suchfeld = (
    <div style={{ position: 'relative', flex: mobil ? 1 : '0 1 280px' }}>
      <input value={suche} onChange={e => { setSuche(e.target.value); if (ansicht !== 'liste') setAnsicht('liste') }} autoFocus={mobil && sucheOffen}
        placeholder="Suchen: Titel, Person, Model …" aria-label="Kalender durchsuchen" style={{ ...inp, paddingRight: 30 }} />
      {suche && <button onClick={() => setSuche('')} aria-label="Suche leeren" style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14 }}>✕</button>}
    </div>
  )
  const filterAktiv = !!modelFilter || Object.values(ebenen).some(v => !v) || zoneModus === 'berlin'

  // Formular: Vorschlag „wer hat dann Schicht auf dem Model"
  const schichtVorschlag = (zeitpunkt, gewaehlt, uebernehmen) => {
    if (!form || !form.model_name) return null
    if (!zeitpunkt) return <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Uhrzeit eingeben — dann schlage ich vor, wer auf {form.model_name} Schicht hat.</div>
    const v = inSchicht(form.model_name, zeitpunkt)
    if (!v) return <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Dienstplan wird geladen …</div>
    if (!formSchichten.planDa && !v.jetztDa.length) return <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Für diese Woche gibt es noch keinen Dienstplan.</div>
    const fehlen = v.jetztDa.filter(n => !gewaehlt.some(g => normName(g) === normName(n)))
    return (
      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {v.jetztDa.length
          ? <>🧑‍💻 Um {zeitIn(zeitpunkt, BERLIN)} (DE) auf {form.model_name}: <b style={{ color: 'var(--text-primary)' }}>{v.jetztDa.join(', ')}</b>
              {fehlen.length > 0 && <button type="button" onClick={() => uebernehmen([...gewaehlt, ...fehlen])} style={{ ...btn(false), padding: '3px 8px', fontSize: 11 }}>+ übernehmen</button>}</>
          : <>Um {zeitIn(zeitpunkt, BERLIN)} (DE) hat niemand Schicht auf {form.model_name}.{v.amTag.length ? ` Am Tag: ${v.amTag.join(', ')}` : ''}</>}
      </div>
    )
  }
  const hinweisBox = form && formHinweise.length > 0 && (
    <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 9, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ ...kopfLabel, color: '#f59e0b', marginBottom: 2 }}>Bitte prüfen</div>
      {formHinweise.map((h, i) => <div key={i} style={{ fontSize: 12, color: h.stufe === 'schicht' ? 'var(--text-secondary)' : 'var(--text-primary)' }}>{h.text}</div>)}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* eigene Zeitzone bestätigen — wie im Portal */}
      {userDisplayName && <ZeitzonenHinweis displayName={userDisplayName} onZone={() => { setZonenStand(n => n + 1); ladePersonen() }} />}

      {/* Kopfzeile */}
      {!mobil ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => blaettern(-1)} style={btn(false)} aria-label="Zurück">‹</button>
          <button onClick={zuHeute} style={btn(false)}>Heute</button>
          <button onClick={() => blaettern(1)} style={btn(false)} aria-label="Weiter">›</button>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', marginLeft: 4 }}>{kopfTitel}</div>
          <div style={{ flex: 1 }} />
          {umschalter}
          {suchfeld}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
            Zeiten in:
            <button onClick={() => setZoneModus('lokal')} style={btn(zoneModus === 'lokal')}>{`meiner Zeit (${ortAus(meineZone())}, ${utcLabel(meineZone())})`}</button>
            <button onClick={() => setZoneModus('berlin')} style={btn(zoneModus === 'berlin')}>deutscher Zeit</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => blaettern(-1)} style={{ ...btn(false), padding: '7px 11px' }} aria-label="Zurück">‹</button>
            <button onClick={zuHeute} style={{ ...btn(false), padding: '7px 10px' }}>Heute</button>
            <button onClick={() => blaettern(1)} style={{ ...btn(false), padding: '7px 11px' }} aria-label="Weiter">›</button>
            <div style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginLeft: 2 }}>{kopfTitel}</div>
            <button onClick={() => oeffneNeu(ansicht === 'woche' ? mobilTag : ansicht === 'liste' ? (listeVon < heute ? heute : listeVon) : heute)} style={{ ...btn(true), padding: '6px 13px', fontSize: 18, lineHeight: 1 }} aria-label="Neuer Eintrag">+</button>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {umschalter}
            <button onClick={() => { if (sucheOffen || suche) { setSucheOffen(false); setSuche('') } else { setSucheOffen(true); setAnsicht('liste') } }} style={{ ...btn(sucheOffen || !!suche), padding: '7px 10px' }} aria-label="Suchen">🔍</button>
            <button onClick={() => setFilterBlatt(true)} style={{ ...btn(filterAktiv), padding: '7px 10px' }} aria-label="Filter und Einstellungen">☰{filterAktiv ? ' •' : ''}</button>
          </div>
          {(sucheOffen || suche) && suchfeld}
          {modelFilter && (
            <button onClick={() => setModelFilter('')} style={{ ...btn(false), alignSelf: 'flex-start', fontSize: 11, color: 'var(--ton-gruen)', borderColor: 'rgba(16,185,129,0.4)' }}>Nur {modelFilter} ✕</button>
          )}
          {offeneGefiltert.length > 0 && !treffer && (
            <button onClick={() => setOffenBlatt(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 9, padding: '8px 12px', cursor: 'pointer', fontFamily: 'inherit', color: '#fbbf24', fontSize: 12.5, fontWeight: 600 }}>
              ⏳ {offeneGefiltert.length} Aufgabe{offeneGefiltert.length > 1 ? 'n' : ''} überfällig <span style={{ marginLeft: 'auto' }}>›</span>
            </button>
          )}
          {ansicht === 'woche' && !treffer && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
              {tage.map(t => {
                const an = t === mobilTag, istHeute = t === heute
                const anzahl = (bloeckeProTag[t] || []).length + (modelProTag[t] || []).length
                return (
                  <button key={t} onClick={() => setMobilTag(t)} style={{ padding: '6px 0', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', background: an ? '#7c3aed' : 'var(--bg-card)', color: an ? '#fff' : istHeute ? 'var(--ton-lila)' : 'var(--text-secondary)', border: `1px solid ${an ? '#7c3aed' : 'var(--border)'}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                    <span style={{ fontSize: 11, fontWeight: 700 }}>{TAGE[wochentag(t)]}</span>
                    <span style={{ fontSize: 10 }}>{kurzTag(t).slice(0, 2)}</span>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: anzahl ? (an ? '#fff' : '#a78bfa') : 'transparent' }} />
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {fehler && <div style={{ ...card, padding: 12, color: '#ef4444', fontSize: 13 }}>⚠ {fehler}</div>}

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        {/* Seitenleiste links (Desktop) */}
        {!mobil && (
          <aside style={{ width: 210, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 12 }}>
            <button onClick={() => oeffneNeu()} style={{ ...btn(true), padding: '10px 14px', fontSize: 13 }}>+ Neuer Eintrag</button>
            <div><div style={kopfLabel}>Model</div>{modelWahl}</div>
            <div><div style={kopfLabel}>Ebenen</div>{ebenenListe}</div>
            {offenListe}
            {ansicht === 'woche' && <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>Doppelklick ins Raster legt einen Eintrag an. Einträge lassen sich mit der Maus verschieben.</div>}
            <KalenderAbo voll />
            {zonenUebersicht}
          </aside>
        )}

        {treffer || ansicht === 'liste' ? listenAnsicht : ansicht === 'monat' ? monatsAnsicht : raster}

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

      {/* Mobil: Filter & Einstellungen als Blatt von unten */}
      {mobil && filterBlatt && (
        <div onClick={() => setFilterBlatt(false)} style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ ...card, borderRadius: '16px 16px 0 0', width: '100%', maxHeight: '88vh', overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>Anzeige & Filter</div>
              <button onClick={() => setFilterBlatt(false)} style={{ ...btn(true), padding: '6px 14px' }}>Fertig</button>
            </div>
            <div>
              <div style={kopfLabel}>Zeiten anzeigen in</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setZoneModus('lokal')} style={{ ...btn(zoneModus === 'lokal'), flex: 1 }}>meiner Zeit ({ortAus(meineZone())})</button>
                <button onClick={() => setZoneModus('berlin')} style={{ ...btn(zoneModus === 'berlin'), flex: 1 }}>deutscher Zeit</button>
              </div>
            </div>
            <div><div style={kopfLabel}>Model</div>{modelWahl}</div>
            <div><div style={kopfLabel}>Ebenen</div>{ebenenListe}</div>
            <KalenderAbo voll />
            {zonenUebersicht}
          </div>
        </div>
      )}

      {/* Mobil: überfällige Aufgaben */}
      {mobil && offenBlatt && (
        <div onClick={() => setOffenBlatt(false)} style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ ...card, borderRadius: '16px 16px 0 0', width: '100%', maxHeight: '80vh', overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#fbbf24', flex: 1 }}>⏳ Überfällig</div>
              <button onClick={() => setOffenBlatt(false)} style={btn(false)}>Schließen</button>
            </div>
            {offeneGefiltert.map(e => (
              <button key={e.id} onClick={() => { setOffenBlatt(false); setAuswahl({ typ: 'eintrag', daten: e }) }}
                style={{ textAlign: 'left', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 9, padding: '9px 11px', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-primary)' }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{e.titel}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{seitText(e.beginn)} · offen: {e.offen.join(', ')}{e.model_name ? ` · ${e.model_name}` : ''}</div>
              </button>
            ))}
          </div>
        </div>
      )}

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
          <div className="kal-form" onClick={e => e.stopPropagation()} style={{ ...card, width: mobil ? '100%' : 'min(900px, 100%)', maxHeight: mobil ? '92vh' : '90vh', overflowY: 'auto', padding: mobil ? 18 : 22, borderRadius: mobil ? '22px 22px 0 0' : 22, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 380px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
              <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--text-primary)' }}>{form.id ? 'Eintrag bearbeiten' : 'Neuer Eintrag'}</div>
              {!form.id && (
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ ...lbl, marginBottom: 0, marginRight: 2 }}>Vorlage:</span>
                  {[...STANDARD_VORLAGEN, ...vorlagen].map(v => (
                    <span key={v.id} style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 999, border: '1px solid var(--border)', overflow: 'hidden' }}>
                      <button type="button" onClick={() => vorlageAnwenden(v)} style={{ background: v.fest ? 'transparent' : 'rgba(124,58,237,0.12)', border: 'none', color: 'var(--text-secondary)', padding: '4px 9px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{v.name}</button>
                      {!v.fest && <button type="button" onClick={() => vorlageLoeschen(v)} aria-label={`Vorlage ${v.name} löschen`} style={{ background: 'transparent', border: 'none', borderLeft: '1px solid var(--border)', color: 'var(--text-muted)', padding: '4px 6px', fontSize: 10, cursor: 'pointer' }}>✕</button>}
                    </span>
                  ))}
                </div>
              )}
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
              {/* v4.84.0: Schnellwahl für Tag und Uhrzeit */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: -4 }}>
                {[['Heute', heute], ['Morgen', plusTage(heute, 1)]].map(([t, d]) => (
                  <button key={t} type="button" className="kal-chip" onClick={() => setForm({ ...form, tag: d })} style={chipK(form.tag === d, '#06b6d4')}>{t}</button>
                ))}
                <span style={{ width: 6 }} />
                {['10:00', '12:00', '15:00', '18:00', '20:00', '21:00'].map(z => (
                  <button key={z} type="button" className="kal-chip" onClick={() => setForm({ ...form, von: z })} style={{ ...chipK(form.von === z), fontFamily: 'monospace' }}>{z}</button>
                ))}
              </div>
              {/* v4.65.0: Wiederholung */}
              {form.serie_id ? (
                <div style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 9, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 12, color: 'var(--ton-lila2)' }}>🔁 Teil einer Serie ({wdhLabel(form.wiederholung)}). Änderung gilt für:</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => setForm({ ...form, umfang: 'diesen' })} style={btn(form.umfang === 'diesen')}>nur diesen Termin</button>
                    <button type="button" onClick={() => setForm({ ...form, umfang: 'folgende' })} style={btn(form.umfang === 'folgende')}>diesen + alle folgenden</button>
                  </div>
                  {form.umfang === 'folgende' && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Titel, Uhrzeit, Personen, Notiz und Erinnerung werden übernommen. Verschiebst du das Datum, rücken alle folgenden um genauso viele Tage.</div>}
                </div>
              ) : !form.folge_von && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'end' }}>
                  <div style={{ gridColumn: '1 / -1' }}><span style={lbl}>Wiederholen</span>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {WIEDERHOLUNGEN.map(w => (
                        <button key={w.key} type="button" className="kal-chip" onClick={() => setForm({ ...form, wiederholung: w.key, wdhBis: form.wdhBis || (form.tag ? plusTage(form.tag, 56) : '') })} style={chipK(form.wiederholung === w.key)}>{w.key ? w.label : 'einmalig'}</button>
                      ))}
                    </div>
                  </div>
                  {form.wiederholung && <label><span style={lbl}>bis einschließlich</span><input type="date" min={form.tag} value={form.wdhBis} onChange={e => setForm({ ...form, wdhBis: e.target.value })} style={inp} /></label>}
                  {serienVorschau && (
                    <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--text-secondary)' }}>
                      → {serienVorschau.length} Termine{serienVorschau.length >= MAX_SERIE ? ' (Maximum)' : ''}: {serienVorschau.slice(0, 4).map(kurzTag).join(', ')}{serienVorschau.length > 4 ? ` … ${kurzTag(serienVorschau[serienVorschau.length - 1])}` : ''}{form.id ? ' — dieser Eintrag wird der erste' : ''}
                    </div>
                  )}
                </div>
              )}
              <div><span style={lbl}>Model (optional)</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" className="kal-chip" onClick={() => setForm({ ...form, model_name: '' })} style={chipK(!form.model_name, '#8888aa')}>kein Model</button>
                  {modelle.map(m => <button key={m.id} type="button" className="kal-chip" onClick={() => setForm({ ...form, model_name: m.name })} style={chipK(form.model_name === m.name, '#ec4899')}>{m.name}</button>)}
                  {form.model_name && !modelle.some(m => m.name === form.model_name) && <button type="button" className="kal-chip" style={chipK(true, '#ec4899')}>{form.model_name}</button>}
                </div>
              </div>
              <div><span style={lbl}>Für wen</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                  <button type="button" className="kal-chip" onClick={() => setForm({ ...form, fuer_alle: true })} style={chipK(form.fuer_alle, '#10b981')}>👥 Ganzes Team</button>
                  <button type="button" className="kal-chip" onClick={() => setForm({ ...form, fuer_alle: false })} style={chipK(!form.fuer_alle)}>Bestimmte Personen</button>
                </div>
                {!form.fuer_alle && form.model_name && <div style={{ marginBottom: 6 }}>{schichtVorschlag(formBeginn, form.fuer, fuer => setForm(f => ({ ...f, fuer })))}</div>}
                {!form.fuer_alle && <PersonenChips personen={personen} team={teamNamen} gewaehlt={form.fuer} onChange={fuer => setForm({ ...form, fuer })} />}
              </div>
              <div><span style={lbl}>Erinnerung per Telegram</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {ERINNERUNGEN.map(r => (
                    <button key={r.label} type="button" className="kal-chip" onClick={() => setForm({ ...form, erinnern_min: r.min })} style={chipK((form.erinnern_min ?? null) === r.min, '#06b6d4')}>{r.label}</button>
                  ))}
                </div>
              </div>
              <button type="button" className="kal-chip" onClick={() => setForm({ ...form, telegram: !form.telegram })} style={{ ...chipK(!!form.telegram, '#06b6d4'), alignSelf: 'flex-start' }}>
                {form.telegram ? '✓ ' : ''}{form.id ? 'Änderung per Telegram melden' : 'Jetzt per Telegram benachrichtigen'}
              </button>
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
                    <div style={{ fontSize: 11, color: 'var(--ton-lila)' }}>🔁 Neue Folgeaufgaben werden bei jedem Termin der Serie angelegt.</div>
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
                        {form.model_name && schichtVorschlag(vorschau, f.fuer, fuer => setF({ fuer }))}
                        {f.fuer.length === 0 && !form.fuer_alle && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Niemand gewählt = dieselben Personen wie beim Event.</div>}
                        <PersonenChips personen={personen} team={teamNamen} gewaehlt={f.fuer} onChange={fuer => setF({ fuer })} klein />
                      </div>
                    )
                  })}
                </div>
              )}

              {mobil && hinweisBox}
              {!mobil && <button type="button" onClick={alsVorlageSpeichern} disabled={speichert || !form.titel.trim()} style={{ ...btn(false), alignSelf: 'flex-start', fontSize: 11 }}>☆ Als Vorlage speichern</button>}
              <div style={{ display: 'flex', gap: 8, position: mobil ? 'sticky' : 'static', bottom: 0, background: 'var(--bg-card)', paddingTop: mobil ? 8 : 0 }}>
                <button onClick={() => setForm(null)} disabled={speichert} style={{ ...btn(false), flex: mobil ? 1 : 'none' }}>Abbrechen</button>
                <button onClick={speichern} disabled={speichert} style={{ ...btn(true), padding: '8px 18px', flex: mobil ? 2 : 'none' }}>{speichert ? 'Speichert…' : form.id ? 'Speichern' : 'Eintragen'}</button>
              </div>
            </div>
            <div style={{ flex: '0 1 260px', minWidth: 0 }}>
              <div style={kopfLabel}>So sieht es bei den anderen aus</div>
              {formBeginn ? <ZonenTabelle beginn={formBeginn} /> : <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Datum und Uhrzeit eingeben — hier erscheint dann die Uhrzeit in jeder Zeitzone.</div>}
              {!mobil && hinweisBox && <div style={{ marginTop: 12 }}>{hinweisBox}</div>}
              {mobil && <button type="button" onClick={alsVorlageSpeichern} disabled={speichert || !form.titel.trim()} style={{ ...btn(false), marginTop: 10, fontSize: 11 }}>☆ Als Vorlage speichern</button>}
            </div>
          </div>
        </div>
      )}

      {/* v4.66.0: Verschieben bestätigen */}
      {verschieben && (() => {
        const v = verschieben
        const alt = datumInZone(v.e.beginn, BERLIN), neu = datumInZone(v.beginn, BERLIN)
        const nFolgen = eintraege.filter(x => x.folge_von === v.e.id).length
        const wann = (d) => `${TAGE[wochentag(d.tag)]} ${kurzTag(d.tag)} ${d.zeit}`
        return (
          <div onClick={() => !speichert && setVerschieben(null)} style={{ position: 'fixed', inset: 0, zIndex: 9002, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div onClick={ev => ev.stopPropagation()} style={{ ...card, width: 'min(420px, 100%)', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Verschieben?</div>
              <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>„{v.e.titel}"</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{wann(alt)} → <b style={{ color: 'var(--ton-lila)' }}>{wann(neu)}</b> (DE)</div>
              {anzeigeZone !== BERLIN && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>bei dir: {zeitIn(v.beginn, anzeigeZone)} Uhr</div>}
              {v.e.serie_id && <div style={{ fontSize: 12, color: 'var(--ton-lila)' }}>🔁 Nur dieser Termin der Serie wird verschoben.</div>}
              {nFolgen > 0 && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>↳ {nFolgen} Folgeaufgabe(n) wandern mit.</div>}
              {v.e.folge_von && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>↳ Der neue Abstand zum Event wird gemerkt.</div>}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-primary)' }}>
                <input type="checkbox" checked={v.telegram} onChange={ev => setVerschieben({ ...v, telegram: ev.target.checked })} style={{ accentColor: '#7c3aed' }} /> Änderung per Telegram melden
              </label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setVerschieben(null)} disabled={speichert} style={btn(false)}>Abbrechen</button>
                <button onClick={verschiebenSpeichern} disabled={speichert} style={{ ...btn(true), padding: '6px 16px' }}>{speichert ? 'Speichert…' : 'Verschieben'}</button>
              </div>
            </div>
          </div>
        )
      })()}
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
          style={{ padding: klein ? '3px 8px' : '4px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: an ? 'rgba(124,58,237,0.2)' : 'transparent', color: an ? 'var(--ton-lila2)' : teamSet.has(p) ? 'var(--ton-lila)' : 'var(--text-secondary)', border: `1px solid ${an ? '#7c3aed' : 'var(--border)'}` }}>{an ? '✓ ' : ''}{p}</button>
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
            <div style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700, color: z.zone === eigene ? 'var(--ton-lila)' : 'var(--text-primary)' }}>{d.zeit}</div>
          </div>
        )
      })}
    </div>
  )
}
