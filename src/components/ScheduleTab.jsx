import React, { useState, useEffect, useRef } from 'react'
import { Sunrise, Sunset, Moon, Clock } from 'lucide-react'
import { supabase } from '../supabase'
import { sendTelegramMessage, zugestellt } from '../telegram'
import BlockOfferModal from './BlockOfferModal'
import SchichtFenster from './SchichtFenster' // v4.83.0
import { logActivity } from '../activity'
import { ladeInaktiveNamen, ohneInaktive } from '../people'

const CHRIS_TG = '1538601588'
const REY_TG = '528328429'
const ADMIN_TZ = 'Europe/Berlin'

// Convert time string "HH:MM" from Berlin to local browser timezone
function convertTimeToLocal(timeStr) {
  if (!timeStr) return timeStr
  // Parse "HH:MM-HH:MM" or "HH:MM"
  const parts = timeStr.split('-').map(t => t.trim())
  const converted = parts.map(t => {
    const [h, m] = t.split(':').map(Number)
    if (isNaN(h)) return t
    // Create a date in Berlin timezone
    const now = new Date()
    const berlinStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(h).padStart(2,'0')}:${String(m||0).padStart(2,'0')}:00`
    // Get offset difference
    const berlinOffset = getTimezoneOffset(berlinStr, ADMIN_TZ)
    const localOffset = getTimezoneOffset(berlinStr, Intl.DateTimeFormat().resolvedOptions().timeZone)
    const diffMins = localOffset - berlinOffset
    const totalMins = h * 60 + (m || 0) + diffMins
    const localH = ((Math.floor(totalMins / 60) % 24) + 24) % 24
    const localM = ((totalMins % 60) + 60) % 60
    return `${String(localH).padStart(2,'0')}:${String(localM).padStart(2,'0')}`
  })
  return converted.join('-')
}

function getTimezoneOffset(dateStr, tz) {
  try {
    const d = new Date(dateStr)
    const utcMs = d.getTime()
    const tzMs = new Date(d.toLocaleString('en-US', { timeZone: tz })).getTime()
    return Math.round((tzMs - utcMs) / 60000)
  } catch { return 0 }
}

const SHIFTS = ['Früh', 'Spät', 'Nacht']
// v3.74.0: "Vorschicht" — optionale Schicht VOR der Früh, pro Woche + pro Model zuschaltbar.
// Steht bewusst NICHT im festen SHIFTS-Array (sonst immer für alle sichtbar), sondern
// wird über extra_shifts (pro Model, pro Woche) aktiviert. ALL_SHIFTS = Vorschicht zuerst.
const EXTRA_SHIFT = 'Vorschicht'
const ALL_SHIFTS = [EXTRA_SHIFT, ...SHIFTS]
const SHIFT_COLORS = { 'Vorschicht': '#3b82f6', 'Früh': '#10b981', 'Spät': '#f59e0b', 'Nacht': '#7c3aed' }
// v3.69.0: Schicht-Icons statt Emojis (Früh/Spät/Nacht)
const SHIFT_ICON = { 'Vorschicht': Clock, 'Früh': Sunrise, 'Spät': Sunset, 'Nacht': Moon }
// v4.6.0: Zell-Farbtöne. Die Vorschicht wird in BLAU dargestellt statt grün/orange —
// eingeschaltet sah sie vorher exakt aus wie Früh/Spät/Nacht, was beim Planen irritiert hat.
// Bewusst NICHT angetastet: Rot (Abwesenheit, Doppelschicht), Gelb (Suchtreffer),
// Cyan (Anlernen) und Lila (ausgeschrieben) — das sind echte Warnungen und behalten Vorrang.
const CELL_TONES = {
  normal: {
    freiBg: 'rgba(16,185,129,0.06)', freiBorder: 'rgba(16,185,129,0.4)', freiText: '#10b981',
    takenBg: 'rgba(16,185,129,0.05)', takenBorder: 'rgba(16,185,129,0.35)',
    pendBg: 'rgba(245,158,11,0.06)', pendBorder: 'rgba(245,158,11,0.4)', pendDashed: false,
    okChipBg: 'rgba(16,185,129,0.15)', okChipText: '#10b981',
    pendChipBg: 'rgba(245,158,11,0.15)', pendChipText: '#f59e0b',
  },
  vorschicht: {
    freiBg: 'rgba(59,130,246,0.10)', freiBorder: 'rgba(59,130,246,0.45)', freiText: '#60a5fa',
    takenBg: 'rgba(59,130,246,0.10)', takenBorder: 'rgba(59,130,246,0.45)',
    // Unbestätigt bleibt blau, wird aber über einen gestrichelten Rahmen unterscheidbar
    // (kein Orange, damit die Zeile durchgängig als Vorschicht lesbar bleibt).
    pendBg: 'rgba(59,130,246,0.05)', pendBorder: 'rgba(96,165,250,0.6)', pendDashed: true,
    okChipBg: 'rgba(59,130,246,0.18)', okChipText: '#60a5fa',
    pendChipBg: 'rgba(96,165,250,0.18)', pendChipText: '#93c5fd',
  },
}
const cellTone = (shift) => shift === EXTRA_SHIFT ? CELL_TONES.vorschicht : CELL_TONES.normal
const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

// ── v4.34.0: Zweiter Chatter in einer Zelle — jetzt DREI Modi ────────────────
// 'anlernen' (Cyan)  — Trainee läuft mit, oft ohne eigenen Account.
// 'co'       (Orange)— zwei Leute arbeiten dieselbe Schicht gemeinsam, komplett.
// 'split'    (Pink)  — NEU: die Schicht wird geteilt, jeder übernimmt einen Abschnitt.
//
// Warum: geteilte Schichten kamen in der Praxis regelmäßig vor, wurden aber als
// Co-Schicht eingetragen. Für die Lohn-Auswertung war danach nicht mehr erkennbar,
// wer wie lange gearbeitet hat. Die vier Zeitfelder (split_a_von/bis, split_b_von/bis)
// sind BEWUSST optional: wer sie nicht ausfüllt, hält wenigstens fest, DASS geteilt
// wurde. Gespeichert wird alles im vorhandenen assignments-JSON — keine Migration.
const MODE_META = {
  anlernen: { icon: '🎓', label: 'Anlernen', color: '#06b6d4' },
  co: { icon: '👥', label: 'Co-Schicht', color: '#f59e0b' },
  split: { icon: '✂️', label: 'Geteilt', color: '#ec4899' },
}
const zellModus = (cell) => (MODE_META[cell?.trainee_mode] ? cell.trainee_mode : 'anlernen')
// Zeitspanne einer Seite ('a' = Hauptchatter, 'b' = zweiter Chatter) als Text.
// Leer, wenn nichts eingetragen ist — dann wird auch nichts angezeigt.
function splitSpanne(cell, seite, standard = '') {
  const von = cell?.[`split_${seite}_von`] || ''
  const bis = cell?.[`split_${seite}_bis`] || ''
  if (!von && !bis) return ''
  if (von && bis) return `${von}–${bis}`
  // Halb ausgefüllt: die fehlende Hälfte kommt aus der Schichtzeit, wenn die
  // eine hergibt. Sonst lieber „ab 20:00" als ein „20:00–?", das nach kaputtem
  // Datensatz aussieht und so auch im Telegram-Plan landen würde.
  const teile = (standard || '').split('-').map(t => t.trim()).filter(Boolean)
  if (teile.length >= 2) return `${von || teile[0]}–${bis || teile[1]}`
  return von ? `ab ${von}` : `bis ${bis}`
}

function berlinDate(date) {
  const str = (date || new Date()).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
  return new Date(str + 'T00:00:00')
}
function isoDate(date) {
  const d = date || new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function todayBerlin() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
}
function isToday(date) { return isoDate(date) === todayBerlin() }
function getWeekStart(date) {
  const d = berlinDate(date || new Date())
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}
function getWeekDays(ws) {
  if (!ws) return []
  const base = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate())
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base)
    d.setDate(d.getDate() + i)
    return d
  })
}
function formatDate(date) { return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) }
function getKW(date) {
  // v3.80.0: echte ISO-8601-Kalenderwoche (Montag-basiert, Woche 1 = Woche mit erstem Donnerstag).
  const src = new Date(date)
  const d = new Date(Date.UTC(src.getFullYear(), src.getMonth(), src.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}

// v4.50.0: Dreiwege-Abgleich beim Speichern.
// Vorher schrieb jeder Speichervorgang die KOMPLETTE Woche aus dem Browser
// zurück. Was inzwischen woanders geändert wurde (Tausch aus der Kommunikation,
// Offboarding, zweiter Admin), wurde dabei überschrieben.
// Jetzt: nur was ICH seit dem Laden geändert habe, wird auf den aktuellen
// Server-Stand gelegt. Fremde Änderungen bleiben erhalten und werden übernommen.
const PLAN_FELDER = ['assignments', 'day_notes', 'shift_times', 'extra_shifts']
// Reihenfolge-unabhängig vergleichen: Postgres (jsonb) sortiert Schlüssel um.
// Mit JSON.stringify allein sähe jede gespeicherte Zelle danach „fremd geändert"
// aus und der Auto-Save liefe in einer Endlosschleife.
const stabil = (v) => {
  if (Array.isArray(v)) return '[' + v.map(stabil).join(',') + ']'
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stabil(v[k])).join(',') + '}'
  }
  return JSON.stringify(v ?? null)
}
const gleich = (a, b) => stabil(a) === stabil(b)
const leererPlan = () => ({ assignments: {}, day_notes: {}, shift_times: {}, extra_shifts: {} })
const planAus = (row) => {
  const p = leererPlan()
  if (!row) return p
  for (const f of PLAN_FELDER) p[f] = row[f] || {}
  return p
}
function mischeFeld(basis = {}, lokal = {}, server = {}) {
  const out = {}
  let lokalGeaendert = false, fremdGeaendert = false, konflikte = 0
  const keys = new Set([...Object.keys(basis), ...Object.keys(lokal), ...Object.keys(server)])
  for (const k of keys) {
    const b = basis[k], l = lokal[k], sv = server[k]
    let ergebnis
    if (gleich(l, b)) {
      ergebnis = sv                      // von mir unverändert → Server-Stand
      if (!gleich(sv, b)) fremdGeaendert = true
    } else {
      ergebnis = l                       // von mir geändert → meine Änderung
      lokalGeaendert = true
      if (!gleich(sv, b) && !gleich(sv, l)) konflikte++
      if (!gleich(sv, b)) fremdGeaendert = true
    }
    if (ergebnis !== undefined) out[k] = ergebnis
  }
  return { out, lokalGeaendert, fremdGeaendert, konflikte }
}

export default function ScheduleTab({ session, userDisplayName }) {
  const [weekStart, setWeekStart] = useState(() => {
    // Restore last viewed week from sessionStorage
    const saved = sessionStorage.getItem('scheduleWeek')
    if (saved) {
      const d = new Date(saved + 'T00:00:00')
      if (!isNaN(d.getTime())) return d
    }
    return getWeekStart(new Date())
  })
  const [models, setModels] = useState([])
  const [blockOffer, setBlockOffer] = useState(null) // v3.27.0: { dayIso, shift, presetModelId } | null
  const [openSwaps, setOpenSwaps] = useState([]) // v3.28.0: offene Angebote/Anfragen für Dienstplan-Markierung
  const [chatters, setChatters] = useState([])
  const [admins, setAdmins] = useState([]) // v2.9.2: Admins für Co-Schicht-Dropdown
  const [schedule, setSchedule] = useState({})
  const [recurring, setRecurring] = useState({}) // modelId__dayOfWeek__shift → {chatter, note}
  const [dayNotes, setDayNotes] = useState({})
  const [shiftTimes, setShiftTimes] = useState({})
  // v3.74.0: pro Woche aktivierte Vorschicht-Zeilen — { [modelId]: true }
  const [extraShifts, setExtraShifts] = useState({})
  // v4.50.0: Speicher-Absicherung (siehe mischeFeld oben)
  const geladeneWocheRef = useRef(null)   // Woche, zu der der State gerade gehört (null = lädt noch)
  const basisRef = useRef(null)           // { plan, neu } — Server-Stand beim letzten Laden/Speichern; neu = Woche existiert noch nicht
  const wocheRef = useRef(null)           // aktuell angezeigte Woche
  const planRef = useRef(leererPlan())    // aktueller State, für Speichern aus alten Closures
  const speicherKetteRef = useRef(Promise.resolve())
  const recurringRef = useRef(null)
  const [speicherFehler, setSpeicherFehler] = useState(null)
  const [editingCell, setEditingCell] = useState(null)
  const [editingNote, setEditingNote] = useState(null)
  const [editingShiftTime, setEditingShiftTime] = useState(null)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [hasSavedData, setHasSavedData] = useState(false)
  const [openConflictGroups, setOpenConflictGroups] = useState({}) // v3.75.0: pro Konflikt-Gruppe auf/zu, z.B. { unbesetzt: true, doppel: false }
  // v3.1.0: Konflikt-Acknowledgements (gesehen) — persistiert in DB für alle Admins
  const [conflictAcks, setConflictAcks] = useState(new Set()) // set of conflict_keys
  // v3.1.0: Send-Modal für gezielte Chatter-Auswahl
  const [sendModalOpen, setSendModalOpen] = useState(false)
  // v3.15.0: Versand-Historie (Audit-Log)
  const [logModalOpen, setLogModalOpen] = useState(false)
  const [sendLog, setSendLog] = useState([])
  const [logExpandedId, setLogExpandedId] = useState(null)
  const [logLoading, setLogLoading] = useState(false)

  // v3.15.0: Sender-Namen aus Session ableiten (gleiches Mapping wie CommTab)
  // v3.20.0: echten Namen aus user_roles bevorzugen (Email-Fallback erzeugte Doubletten)
  const getSenderName = () => {
    const email = session?.user?.email || ''
    const map = { 'dillemc@hotmail.com': 'Chris' }
    return userDisplayName || map[email] || email.split('@')[0] || 'Admin'
  }

  // v3.15.0: Versand-Historie laden (neueste zuerst, max 50)
  const loadSendLog = async () => {
    setLogLoading(true)
    const { data, error } = await supabase
      .from('schedule_send_log')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(50)
    if (!error) setSendLog(data || [])
    setLogLoading(false)
  }
  const [sendSelection, setSendSelection] = useState(new Set()) // Set<chatter_id>
  // Collapse pro Model — persistiert in Localstorage
  const [collapsedModels, setCollapsedModels] = useState(() => {
    try {
      const saved = localStorage.getItem('schedule_collapsed_models')
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch { return new Set() }
  })

  const toggleModelCollapse = (modelId) => {
    setCollapsedModels(prev => {
      const next = new Set(prev)
      if (next.has(modelId)) next.delete(modelId)
      else next.add(modelId)
      try { localStorage.setItem('schedule_collapsed_models', JSON.stringify([...next])) } catch {}
      return next
    })
  }

  const collapseAllModels = () => {
    const all = new Set(models.map(m => m.id))
    setCollapsedModels(all)
    try { localStorage.setItem('schedule_collapsed_models', JSON.stringify([...all])) } catch {}
  }

  const expandAllModels = () => {
    setCollapsedModels(new Set())
    try { localStorage.setItem('schedule_collapsed_models', JSON.stringify([])) } catch {}
  }

  const [reminderCell, setReminderCell] = useState(null)
  const [sendingReminder, setSendingReminder] = useState(false)
  const [activeReminders, setActiveReminders] = useState({}) // cellKey → true
  const [absences, setAbsences] = useState([]) // [{id, chatter_name, date_from, date_to, reason}]
  const [showAbsences, setShowAbsences] = useState(false)
  const [showExpiredAbsences, setShowExpiredAbsences] = useState(false)
  const [openAbsenceWeeks, setOpenAbsenceWeeks] = useState({}) // v3.77.0: Abwesenheiten nach KW aufklappbar, {weekIso: bool}
  const [newAbsenceName, setNewAbsenceName] = useState('')
  const [newAbsenceFrom, setNewAbsenceFrom] = useState('')
  const [newAbsenceTo, setNewAbsenceTo] = useState('')
  const [newAbsenceReason, setNewAbsenceReason] = useState('')
  const [newAbsenceShifts, setNewAbsenceShifts] = useState([]) // v3.29.0: leer = ganzer Tag, sonst nur diese Schichten verfügbar

  // Mobile + Suche + Bottom-Sheet
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  const [chatterSearch, setChatterSearch] = useState('')
  const [mobileDay, setMobileDay] = useState(() => todayBerlin())
  const [editSheet, setEditSheet] = useState(null) // { modelId, dayIso, shift } or null
  // v4.83.0: neue Kopfzeile — „⋯ Mehr“-Fenster und Suche am Handy
  const [mehrOffen, setMehrOffen] = useState(false)
  const [sucheOffen, setSucheOffen] = useState(false)
  const konfliktRef = useRef(null)
  const abwesendRef = useRef(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const [scheduleStatus, setScheduleStatus] = useState('draft')
  const [publishing, setPublishing] = useState(false)

  const weekDays = getWeekDays(weekStart)
  const weekKey = isoDate(weekStart)
  const kw = getKW(weekStart)
  wocheRef.current = weekKey
  planRef.current = { assignments: schedule, day_notes: dayNotes, shift_times: shiftTimes, extra_shifts: extraShifts }

  // v3.44.2: mobileDay an die angezeigte Woche koppeln. Ohne das zeigt das Handy nach einem
  // Wochenwechsel weiter einen Tag aus der alten Woche -> alle Zellen leer, obwohl verplant.
  useEffect(() => {
    const weekIsos = weekDays.map(d => isoDate(d))
    if (!weekIsos.includes(mobileDay)) {
      const today = todayBerlin()
      setMobileDay(weekIsos.includes(today) ? today : weekIsos[0])
    }
  }, [weekKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadModels(); loadChatters(); loadAdmins(); loadRecurring(); loadAbsences(); loadActiveReminders(); loadConflictAcks(); loadOpenSwaps() }, [])

  // v3.1.0: Konflikt-Acks aus DB laden (welche Doppel-Schichten wurden als gesehen markiert)
  const loadConflictAcks = async () => {
    try {
      const { data } = await supabase.from('schedule_conflict_acks').select('conflict_key')
      setConflictAcks(new Set((data || []).map(a => a.conflict_key)))
    } catch (e) {
      console.warn('loadConflictAcks failed:', e)
    }
  }

  const toggleConflictAck = async (conflictKey) => {
    if (conflictAcks.has(conflictKey)) {
      // entacken: aus DB entfernen
      try {
        await supabase.from('schedule_conflict_acks').delete().eq('conflict_key', conflictKey)
      } catch (e) { console.warn('unack failed', e) }
      setConflictAcks(prev => {
        const next = new Set(prev)
        next.delete(conflictKey)
        return next
      })
    } else {
      // acken: in DB schreiben
      try {
        await supabase.from('schedule_conflict_acks').insert({ conflict_key: conflictKey, acked_by: session?.user?.email || 'admin' })
      } catch (e) { console.warn('ack failed', e) }
      setConflictAcks(prev => new Set([...prev, conflictKey]))
    }
  }
  useEffect(() => {
    if (weekKey) {
      loadSchedule()
      loadOpenSwaps()
      sessionStorage.setItem('scheduleWeek', weekKey)
    }
  }, [weekKey])

  // Auto-save after 2 seconds of inactivity
  useEffect(() => {
    if (!weekKey) return
    if (Object.keys(schedule).length === 0 && !hasSavedData) return
    // v4.17.0: still — kein Protokoll-Eintrag. Siehe Kommentar an saveSchedule.
    const timer = setTimeout(() => { saveSchedule({ protokollieren: false }) }, 2000)
    return () => clearTimeout(timer)
  }, [schedule, dayNotes, shiftTimes, extraShifts]) // v3.80.0: extraShifts ergänzt — nur Vorschicht-Umschalten wurde sonst nicht gespeichert

  const loadAbsences = async () => {
    const { data } = await supabase.from('absences').select('*').order('date_from')
    setAbsences(data || [])
  }

  const loadActiveReminders = async () => {
    const { data } = await supabase.from('reminders').select('shift_date, shift, chatter_name').eq('sent', false)
    const map = {}
    for (const r of data || []) {
      map[`${r.chatter_name}__${r.shift_date}__${r.shift}`] = true
    }
    setActiveReminders(map)
  }

  const addAbsence = async () => {
    if (!newAbsenceName || !newAbsenceFrom || !newAbsenceTo) return
    // newAbsenceShifts = Schichten, an denen die Person WEG ist.
    // Gespeichert wird die Verfügbarkeit = alle Schichten außer den abwesenden.
    const avail = newAbsenceShifts.length ? ALL_SHIFTS.filter(s => !newAbsenceShifts.includes(s)) : null
    if (newAbsenceTo < newAbsenceFrom) { alert('Das Bis-Datum liegt vor dem Von-Datum.'); return }
    const { error } = await supabase.from('absences').insert({
      chatter_name: newAbsenceName,
      date_from: newAbsenceFrom,
      date_to: newAbsenceTo,
      reason: newAbsenceReason || 'Abwesend',
      available_shifts: (avail && avail.length) ? avail : null,
      source: 'admin',
      seen_by_admin: true,
    })
    // v4.50.0: Fehler melden, Formular stehen lassen
    if (error) { alert('⚠ Abwesenheit NICHT gespeichert: ' + error.message); return }
    setNewAbsenceName(''); setNewAbsenceFrom(''); setNewAbsenceTo(''); setNewAbsenceReason(''); setNewAbsenceShifts([])
    loadAbsences()
  }

  const deleteAbsence = async (id) => {
    const { error } = await supabase.from('absences').delete().eq('id', id)
    if (error) alert('⚠ Abwesenheit NICHT gelöscht: ' + error.message)
    loadAbsences()
  }

  // v3.29.0: schicht-genau. available_shifts NULL/leer = ganzer Tag abwesend;
  // sonst nur verfügbar für die gelisteten Schichten (= abwesend für alle anderen).
  const isAbsent = (chatterName, dayIso, shift) => {
    return absences.some(a => {
      if (a.chatter_name !== chatterName) return false
      if (dayIso < a.date_from || dayIso > a.date_to) return false
      const avail = a.available_shifts
      if (!avail || avail.length === 0) return true   // ganzer Tag
      if (!shift) return false                         // ohne Schicht-Kontext zählt Teil-Abwesenheit nicht als ganztägig
      return !avail.includes(shift)
    })
  }

  // Label für den Umfang einer Abwesenheit
  const absenceScopeLabel = (a) => {
    const avail = a.available_shifts
    if (!avail || avail.length === 0) return 'ganzer Tag'
    return 'nur ' + avail.join('/')
  }

  const checkShiftAlerts = async () => {
    // v3.0.0: DEAKTIVIERT — Schicht-Alerts kommen jetzt ausschließlich aus der Edge Function
    // `shift-alert` (server-seitig, alle 5 Minuten via pg_cron).
    // 
    // Grund: Die Frontend-Version feuerte bei jedem Tab-Open jedes Admins. Mit mehreren
    // Browser-Tabs gleichzeitig offen gab's Race-Conditions zwischen "Marker laden" und
    // "Telegram senden" → Spam mit unterschiedlichem Wording ("noch nicht online!" vs
    // "noch nicht eingecheckt!"). Edge Function alleine reicht — eine zentrale Quelle.
    return
    // ---- Alter Code unten (nicht mehr ausgeführt) ----
    const now = new Date()
    const todayIso = todayBerlin()
    // Berlin-Stunde + Minute holen — nicht Browser-Zeit, sonst falscher Vergleich aus anderen Zeitzonen
    const berlinTimeStr = now.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false })
    const [currentHour, currentMin] = berlinTimeStr.split(':').map(Number)

    // Load today's schedule
    const weekS = getWeekStart(now)
    const { data: schedData } = await supabase.from('schedule').select('*').eq('week_start', isoDate(weekS)).single()
    if (!schedData) return

    // Load online statuses (Heartbeat-basiert, max 60s alt)
    const { data: onlineData } = await supabase.from('online_status').select('*')
    const onlineMap = {}
    const cutoff = new Date(Date.now() - 60000)
    for (const s of onlineData || []) {
      if (new Date(s.last_seen) > cutoff) onlineMap[s.display_name] = s.shift_online
    }

    // v2.9.3: Aktive Schicht-Logs (eingecheckt aber nicht ausgecheckt) — als Backup
    // Heißt: Wer eingecheckt ist gilt als anwesend, auch wenn Heartbeat veraltet ist
    // (z.B. Browser im Hintergrund, Tab-Throttling)
    const { data: activeLogs } = await supabase.from('shift_logs').select('display_name').is('checked_out_at', null)
    const checkedInLc = new Set((activeLogs || []).map(l => (l.display_name || '').trim().toLowerCase()))

    // v2.9.3: Bereits gefeuerte Alerts heute laden — Spam-Schutz über Tabellen-Grenzen hinweg
    const { data: alertMarkersToday } = await supabase
      .from('alert_markers')
      .select('alert_key')
      .eq('alert_date', todayIso)
      .eq('alert_type', 'no_show')
    const alreadyAlerted = new Set((alertMarkersToday || []).map(m => m.alert_key))

    // Load shift times
    const shiftTimesData = schedData.shift_times || {}
    const assignments = schedData.assignments || {}

    // Get all chatters scheduled today
    const alertedThisRun = new Set()
    for (const [key, val] of Object.entries(assignments)) {
      const parts = key.split('__')
      if (parts[1] !== todayIso || !val.chatter || val.chatter === '__FREI__') continue
      const chatterName = val.chatter
      const chatterLc = chatterName.trim().toLowerCase()
      if (alertedThisRun.has(chatterName)) continue

      // Find shift start time
      const modelId = parts[0]
      const shift = parts[2]
      // v2.9.7: Erst Cell-Override prüfen, dann Standard-Zeit
      const timeStr = (val.time_override || shiftTimesData[`${modelId}__${shift}`] || '').replace(' (DE)', '').replace('(DE)', '')
      if (!timeStr) continue

      // Parse time like "08:00-14:00" or "08:00"
      const startTime = timeStr.split('-')[0].trim()
      const [shiftHour, shiftMin] = startTime.split(':').map(Number)
      if (isNaN(shiftHour)) continue

      // Check if 15 minutes after shift start
      const shiftStartMins = shiftHour * 60 + shiftMin
      const nowMins = currentHour * 60 + currentMin
      if (nowMins >= shiftStartMins + 15 && nowMins < shiftStartMins + 20) {
        // v2.9.3: Mehrere Wege als anwesend zu zählen:
        const isOnlineHeartbeat = !!onlineMap[chatterName]
        const isCheckedIn = checkedInLc.has(chatterLc)
        // Trainee/Co-Chatter zählt auch — wenn der eingecheckt ist, ist die Schicht abgedeckt
        const traineeName = (val.trainee || '').trim().toLowerCase()
        const traineeIsCheckedIn = traineeName && (checkedInLc.has(traineeName) || onlineMap[val.trainee])

        if (isOnlineHeartbeat || isCheckedIn || traineeIsCheckedIn) continue

        // v2.9.3: Spam-Schutz — pro Chatter+Schicht+Tag nur 1x
        const alertKey = `${chatterName}_${shift}_${todayIso}`
        if (alreadyAlerted.has(alertKey)) continue

        alertedThisRun.add(chatterName)
        const msg = `⚠️ ${chatterName} hat ${shift}schicht aber ist noch nicht online! (${startTime} Uhr)`
        await sendTelegramMessage(CHRIS_TG, msg)
        await sendTelegramMessage(REY_TG, msg)

        // Marker schreiben damit's nicht nochmal feuert
        await supabase.from('alert_markers').insert({
          alert_key: alertKey,
          alert_date: todayIso,
          alert_type: 'no_show',
          alerted_at: new Date().toISOString(),
        })
      }
    }
  }

  const loadModels = async () => {
    // Nur Models laden die im Dienstplan auftauchen sollen (in_schedule != false)
    // Bestehende Models ohne den Flag (NULL) werden auch geladen — gilt als "an"
    // v3.23.0: zusätzlich offboardete/stillgelegte Models ausblenden (active != false).
    //   in_schedule = manueller "nicht im Plan"-Schalter, active = Offboarding — getrennt.
    // v4.16.0: zwei getrennte .or() auf derselben Query sind fragil (supabase-js
    //   hängt zweimal or=(…) an die URL). Jetzt nur noch in_schedule serverseitig,
    //   das Aussortieren erledigt ohneInaktive() — das prüft AUCH user_roles.status
    //   und fängt damit fehlgeschlagene Offboardings ab.
    const [{ data }, inaktive] = await Promise.all([
      supabase.from('models_contact').select('*')
        .or('in_schedule.is.null,in_schedule.eq.true')
        .order('name'),
      ladeInaktiveNamen(),
    ])
    setModels(ohneInaktive(data, inaktive))
  }
  const loadChatters = async () => {
    // v3.18.0: Nur aktive Chatter im Dienstplan (active != false).
    // Bestehende ohne Flag (NULL) gelten als aktiv. Stillgelegte/offboardete werden ausgeblendet.
    // v4.16.0: zusätzlich gegen user_roles.status — siehe src/people.js.
    const [{ data }, inaktive] = await Promise.all([
      supabase.from('chatters_contact').select('*').order('name'),
      ladeInaktiveNamen(),
    ])
    setChatters(ohneInaktive(data, inaktive))
  }
  const loadAdmins = async () => {
    // v2.9.2: Admins aus user_roles für Co-Schicht-Dropdown
    const { data } = await supabase.from('user_roles').select('display_name').eq('role', 'admin')
    setAdmins((data || []).map(r => r.display_name).filter(Boolean))
  }
  const loadRecurring = async () => {
    const { data } = await supabase.from('recurring_shifts').select('*')
    const map = {}
    for (const r of data || []) map[r.shift_key] = { chatter: r.chatter, note: r.note }
    recurringRef.current = map
    setRecurring(map)
    return map
  }

  // v3.28.0: offene Schicht-Angebote/-Anfragen laden (für Dienstplan-Markierung)
  const loadOpenSwaps = async () => {
    const { data } = await supabase
      .from('shift_swaps')
      .select('model_name, shift_date, shift, requester_name')
      .eq('status', 'offen')
    setOpenSwaps(data || [])
  }

  const loadSchedule = async () => {
    // v4.50.0: Antwort gehört zu genau dieser Woche. Blättert man weiter, bevor
    // sie ankommt, wird sie verworfen — vorher landeten die Zellen der alten
    // Woche im State und der Auto-Save schrieb sie in die neue.
    const wk = weekKey
    // Ungespeicherte Änderungen der bisher offenen Woche noch in DIESE Woche
    // schreiben (Auto-Save wartet 2 s — wer schneller blättert, verlor sie sonst).
    const alteWoche = geladeneWocheRef.current
    if (alteWoche && alteWoche !== wk && basisRef.current) {
      const ziel = { wk: alteWoche, lokal: planRef.current, basis: basisRef.current }
      const lauf = speicherKetteRef.current.then(() => speichereJetzt({ protokollieren: false, ziel }))
      speicherKetteRef.current = lauf.catch(() => {})
    }
    geladeneWocheRef.current = null      // bis zum Ende des Ladens nicht speichern
    const { data, error } = await supabase.from('schedule').select('*').eq('week_start', wk).order('id')
    if (wocheRef.current !== wk) return
    if (error) {
      console.error('Dienstplan laden fehlgeschlagen:', error)
      setSpeicherFehler('Dienstplan konnte nicht geladen werden — bitte neu laden. Änderungen werden erst danach gespeichert.')
      return
    }
    if (data && data.length > 1) console.warn(`schedule: ${data.length} Zeilen für ${wk} — es wird die erste verwendet`)
    if (data && data.length > 0) {
      const row = data[0]
      const rawTimes = row.shift_times || {}
      const cleanTimes = {}
      for (const [k, v] of Object.entries(rawTimes)) {
        cleanTimes[k] = String(v).replace(' (DE)', '').replace('(DE)', '')
      }
      basisRef.current = { plan: planAus(row), neu: false }
      geladeneWocheRef.current = wk
      setSchedule(row.assignments || {})
      setDayNotes(row.day_notes || {})
      setShiftTimes(cleanTimes)
      setExtraShifts(row.extra_shifts || {})
      setScheduleStatus(row.status || 'draft')
      setHasSavedData(true)
    } else {
      // Auto-fill from recurring shifts
      // v4.50.0: auf die wiederkehrenden Schichten warten — beim ersten Öffnen
      // war `recurring` sonst noch leer und die Woche blieb unvorbelegt.
      const rec = recurringRef.current || await loadRecurring()
      if (wocheRef.current !== wk) return
      const autoSchedule = {}
      for (const day of getWeekDays(new Date(wk + 'T00:00:00'))) {
        const dayOfWeek = day.getDay() === 0 ? 6 : day.getDay() - 1 // 0=Mo..6=So
        for (const [key, val] of Object.entries(rec || {})) {
          const parts = key.split('__')
          if (parseInt(parts[1]) === dayOfWeek) {
            autoSchedule[`${parts[0]}__${isoDate(day)}__${parts[2]}`] = { ...val, isRecurring: true }
          }
        }
      }

      // Load shift times from most recent previous week
      const { data: prevWeeks } = await supabase
        .from('schedule')
        .select('shift_times, week_start')
        .lt('week_start', wk)
        .order('week_start', { ascending: false })
        .limit(1)
      if (wocheRef.current !== wk) return
      const cleanTimes = {}
      if (prevWeeks && prevWeeks.length > 0 && prevWeeks[0].shift_times) {
        for (const [k, v] of Object.entries(prevWeeks[0].shift_times)) {
          // Key format: modelId__shift → keep as is since times are per model+shift not per day
          cleanTimes[k] = String(v).replace(' (DE)', '').replace('(DE)', '')
        }
      }
      // Es gibt noch keine Zeile: Basis = Vorbelegung, damit nur echte
      // Eingaben als „von mir geändert" zählen.
      basisRef.current = { plan: { assignments: autoSchedule, day_notes: {}, shift_times: cleanTimes, extra_shifts: {} }, neu: true }
      geladeneWocheRef.current = wk
      setSchedule(autoSchedule)
      setDayNotes({})
      setExtraShifts({}) // v3.74.0: neue Woche startet ohne Vorschicht
      setShiftTimes(cleanTimes)
      setScheduleStatus('draft')
      setHasSavedData(false)
    }
  }

  // v4.17.0: `protokollieren` trennt Speichern von Protokollieren.
  // Vorher schrieb JEDER Speichervorgang eine Zeile ins activity_log — und
  // gespeichert wird automatisch 2 Sekunden nach jeder Änderung. Dadurch stand
  // in der Glocke dutzendfach "hat den Dienstplan bearbeitet", und schon das
  // blosse Durchblättern einer Woche erzeugte einen Eintrag: loadSchedule setzt
  // die States, das löst den Auto-Save aus.
  // Jetzt protokollieren nur noch die beiden echten Knopfdrücke — Speichern und
  // Veröffentlichen. Der Auto-Save speichert weiter, aber still.
  // v4.50.0: Speichern läuft in einer Kette — nie zwei gleichzeitig.
  const saveSchedule = ({ protokollieren = true } = {}) => {
    const lauf = speicherKetteRef.current.then(() => speichereJetzt({ protokollieren }))
    speicherKetteRef.current = lauf.catch(() => {})
    return lauf
  }

  // ziel (optional): { wk, lokal, basis } — Nachspeichern einer Woche, die
  // gerade nicht mehr angezeigt wird (beim Wochenwechsel).
  const speichereJetzt = async ({ protokollieren, status, ziel } = {}, versuch = 0) => {
    const wk = ziel ? ziel.wk : geladeneWocheRef.current
    // State gehört (noch) nicht zur angezeigten Woche → nichts schreiben
    if (!wk || (!ziel && wk !== wocheRef.current)) return false
    const basisObj = ziel ? ziel.basis : basisRef.current
    if (!basisObj) return false
    setSaving(true)
    try {
      const lokal = ziel ? ziel.lokal : planRef.current
      const basis = basisObj.plan
      const { data: rows, error: ladeFehler } = await supabase.from('schedule').select('*').eq('week_start', wk).order('id')
      if (ladeFehler) throw ladeFehler
      const serverRow = rows && rows.length ? rows[0] : null
      // Existiert die Woche (noch) nicht, gilt die Vorbelegung als Server-Stand
      const server = serverRow ? planAus(serverRow) : basis

      const gemischt = {}
      let lokalGeaendert = false, fremdGeaendert = false, konflikte = 0
      for (const f of PLAN_FELDER) {
        const r = mischeFeld(basis[f], lokal[f], server[f])
        gemischt[f] = r.out
        lokalGeaendert ||= r.lokalGeaendert
        fremdGeaendert ||= r.fremdGeaendert
        konflikte += r.konflikte
      }
      const statusAenderung = status && status !== (serverRow?.status || 'draft')

      // Neue Woche wird beim Ansehen angelegt (wie bisher) — beim Nachspeichern nur mit echten Änderungen
      if (lokalGeaendert || statusAenderung || (!serverRow && !ziel)) {
        const payload = { ...gemischt }
        if (status) payload.status = status
        const { error } = serverRow
          ? await supabase.from('schedule').update(payload).eq('id', serverRow.id)
          : await supabase.from('schedule').insert({ week_start: wk, status: status || 'draft', ...payload })
        if (error) {
          // Jemand hat die Woche gerade parallel angelegt → einmal neu abgleichen
          if (error.code === '23505' && versuch === 0) return speichereJetzt({ protokollieren, status, ziel }, 1)
          throw error
        }
        if (!serverRow && !ziel) setHasSavedData(true)
      }

      // Nur anfassen, wenn diese Woche noch die offene ist
      const nochOffen = !ziel && geladeneWocheRef.current === wk && wocheRef.current === wk
      if (!nochOffen) {
        setSpeicherFehler(null)
        return true
      }
      basisRef.current = { plan: gemischt, neu: false }
      if (status) setScheduleStatus(status)
      else if (serverRow?.status) setScheduleStatus(serverRow.status)
      // Fremde Änderungen sichtbar machen (nur wenn noch dieselbe Woche offen ist)
      const stateWeicht = PLAN_FELDER.some(f => !gleich(gemischt[f], lokal[f]))
      if (fremdGeaendert && stateWeicht) {
        // Was ich WÄHREND des Speicherns noch getippt habe, obendrauf behalten
        const jetzt = planRef.current
        const neu = {}
        for (const f of PLAN_FELDER) neu[f] = mischeFeld(lokal[f], jetzt[f], gemischt[f]).out
        setSchedule(neu.assignments)
        setDayNotes(neu.day_notes)
        setShiftTimes(neu.shift_times)
        setExtraShifts(neu.extra_shifts)
      }
      if (konflikte > 0) {
        console.warn(`Dienstplan ${wk}: ${konflikte} Zelle(n) gleichzeitig woanders geändert — deine Änderung gilt.`)
      }
      setSpeicherFehler(null)
      // v3.97.0: protokollieren — ohne Protokoll wäre der Bearbeiter nicht rekonstruierbar.
      if (protokollieren && lokalGeaendert) {
        logActivity('schedule.edit', { entity: `KW ${getKW(new Date(wk + 'T00:00:00'))}`, detail: `Woche ab ${wk}` })
      }
      return true
    } catch (e) {
      console.error('Dienstplan speichern fehlgeschlagen:', e)
      setSpeicherFehler(`Dienstplan NICHT gespeichert: ${e?.message || e}. Seite nicht schließen — es wird bei der nächsten Änderung erneut versucht.`)
      return false
    } finally {
      setSaving(false)
    }
  }

  const togglePublish = async () => {
    setPublishing(true)
    const newStatus = scheduleStatus === 'live' ? 'draft' : 'live'
    // v4.50.0: über denselben Abgleich wie das Speichern — vorher schrieb auch
    // Veröffentlichen die komplette Woche aus dem Browser zurück.
    const lauf = speicherKetteRef.current.then(() => speichereJetzt({ protokollieren: false, status: newStatus }))
    speicherKetteRef.current = lauf.catch(() => {})
    const ok = await lauf
    setPublishing(false)
    if (!ok) { alert('⚠ Status wurde NICHT geändert — Speichern fehlgeschlagen.'); return }
    logActivity(newStatus === 'live' ? 'schedule.publish' : 'schedule.unpublish',
      { entity: `KW ${getKW(weekStart)}`, detail: `Woche ab ${weekKey}` })
  }

  // v4.50.0: „Als Vorlage für nächste Woche" — überschreibt eine schon
  // geplante Woche nicht mehr. Ist dort schon etwas eingetragen, werden nur
  // LEERE Zellen ergänzt; Bestehendes, Notizen, Vorschichten und Status bleiben.
  const alsVorlageUebertragen = async (aufKlaerung) => {
    const next = new Date(weekStart); next.setDate(next.getDate() + 7)
    const nextKey = isoDate(next)
    const nextKw = getKW(next)
    const newA = {}
    let woechentlichBestaetigt = 0
    for (const [key, val] of Object.entries(schedule)) {
      const parts = key.split('__')
      const d = new Date(parts[1] + 'T00:00:00'); d.setDate(d.getDate() + 7)
      const newKey = `${parts[0]}__${isoDate(d)}__${parts[2]}`
      // Freischichten unverändert lassen — die brauchen keine Klärung
      if (aufKlaerung && val && val.chatter && val.chatter !== '__FREI__') {
        // v4.86.0: Wer an genau diesem Wochentag, in dieser Schicht und bei diesem
        // Model als „wöchentlich“ eingetragen ist, bleibt bestätigt — das ist ja
        // schon fest abgesprochen. Alle anderen gehen auf „Klärung nötig“.
        const dow = d.getDay() === 0 ? 6 : d.getDay() - 1
        const wdh = recurring[getRecurringKey(parts[0], dow, parts[2])]
        const fest = !!wdh && wdh.chatter === val.chatter
        if (fest) woechentlichBestaetigt++
        newA[newKey] = fest ? { ...val, confirmed: true } : { ...val, confirmed: false }
      } else {
        newA[newKey] = val
      }
    }
    const { data: rows, error: ladeFehler } = await supabase.from('schedule').select('*').eq('week_start', nextKey).order('id')
    if (ladeFehler) { alert('⚠ KW ' + nextKw + ' konnte nicht geladen werden: ' + ladeFehler.message); return }
    const ex = rows && rows.length ? rows[0] : null
    const belegt = ex ? Object.values(ex.assignments || {}).filter(v => v && (v.chatter || v.note)).length : 0

    let assignments, shift_times, ergaenzt = 0
    if (ex && belegt > 0) {
      const ok = window.confirm(
        `KW ${nextKw} ist schon geplant: ${belegt} belegte Schicht(en)${ex.status === 'live' ? ', Status LIVE' : ''}.\n\n` +
        `OK = nur LEERE Schichten aus der Vorlage ergänzen. Alles Bestehende bleibt unverändert.\n` +
        `Abbrechen = nichts tun.`)
      if (!ok) return
      assignments = { ...(ex.assignments || {}) }
      for (const [k, v] of Object.entries(newA)) {
        const alt = assignments[k]
        if (!alt || (!alt.chatter && !alt.note)) { assignments[k] = v; ergaenzt++ }
      }
      shift_times = { ...shiftTimes, ...(ex.shift_times || {}) } // bestehende Zeiten haben Vorrang
    } else {
      if (!window.confirm(`Plan auf KW ${nextKw} übertragen${aufKlaerung ? ` und alle Schichten auf "Klärung nötig" setzen${woechentlichBestaetigt ? ` — außer ${woechentlichBestaetigt} wöchentlich feste, die bleiben bestätigt` : ''}` : ''}?`)) return
      assignments = newA
      shift_times = ex ? { ...shiftTimes, ...(ex.shift_times || {}) } : shiftTimes
      ergaenzt = Object.keys(newA).length
    }
    const { error } = ex
      ? await supabase.from('schedule').update({ assignments, shift_times }).eq('id', ex.id)
      : await supabase.from('schedule').insert({ week_start: nextKey, assignments, shift_times, status: 'draft' })
    if (error) { alert('⚠ Vorlage NICHT übertragen: ' + error.message); return }
    setWeekStart(next)
    alert(ex && belegt > 0
      ? `✓ ${ergaenzt} leere Schicht(en) in KW ${nextKw} ergänzt — Bestehendes unverändert.`
      : `✓ Plan auf KW ${nextKw} übertragen${aufKlaerung ? ` — Schichten auf "Klärung nötig"${woechentlichBestaetigt ? `, ${woechentlichBestaetigt} wöchentlich feste bleiben bestätigt` : ''}` : ''}!`)
  }

  const [autoPlanning, setAutoPlanning] = useState(false)

  const autoGeneratePlan = async () => {
    setAutoPlanning(true)
    // Load availabilities and absences
    const { data: availData } = await supabase.from('chatter_availability').select('*')
    const { data: absData } = await supabase.from('absences').select('*')

    // Build availability map: chatterName → [{day_of_week, time_from, time_to}]
    const availMap = {}
    for (const a of availData || []) {
      if (!availMap[a.chatter_name]) availMap[a.chatter_name] = []
      availMap[a.chatter_name].push(a)
    }

    const newSchedule = { ...schedule }

    for (const day of weekDays) {
      const dayIso = isoDate(day)
      const dayOfWeek = day.getDay() === 0 ? 6 : day.getDay() - 1 // 0=Mo..6=So

      for (const model of models) {
        for (const shift of SHIFTS) {
          const cellKey = getCellKey(model.id, dayIso, shift)
          // Skip if already filled
          if (newSchedule[cellKey]?.chatter) continue

          // Check recurring first
          const recurringKey = getRecurringKey(model.id, dayOfWeek, shift)
          if (recurring[recurringKey]?.chatter) {
            const chatterName = recurring[recurringKey].chatter
            // Check not absent
            const isAbsent = (absData || []).some(a => {
              if (a.chatter_name !== chatterName) return false
              if (dayIso < a.date_from || dayIso > a.date_to) return false
              const avail = a.available_shifts
              if (!avail || avail.length === 0) return true
              return !avail.includes(shift)
            })
            if (!isAbsent) {
              newSchedule[cellKey] = { chatter: chatterName, note: recurring[recurringKey].note || '', isRecurring: true }
              continue
            }
          }

          // Find available chatter based on shift time and availability profile
          const timeStr = (shiftTimes[`${model.id}__${shift}`] || '').replace(/\s*\(DE\)/g, '')
          const shiftStart = timeStr ? timeStr.split('-')[0].trim() : null
          const shiftEnd = timeStr ? timeStr.split('-')[1]?.trim() : null

          const candidates = chatters.filter(c => {
            // Check not absent — v3.80.0: schicht-genau (wie die Recurring-Prüfung oben),
            // damit teilweise abwesende Chatter nicht für ALLE Schichten ausgeschlossen werden
            const absent = (absData || []).some(a => {
              if (a.chatter_name !== c.name) return false
              if (dayIso < a.date_from || dayIso > a.date_to) return false
              const avail = a.available_shifts
              if (!avail || avail.length === 0) return true
              return !avail.includes(shift)
            })
            if (absent) return false
            // Check availability profile
            const avails = availMap[c.name] || []
            if (avails.length === 0) return true // No restrictions = always available
            return avails.some(a => {
              if (a.day_of_week !== dayOfWeek) return false
              if (!shiftStart) return true
              // v4.58.0: in Minuten rechnen, Schichten/Verfügbarkeiten über Mitternacht
              // korrekt behandeln. Vorher Stringvergleich: Nacht 22:00–06:00 passte
              // in eine Verfügbarkeit 08:00–23:00, weil "06:00" <= "23:00".
              const min = (t) => { const [h, m] = String(t || '').split(':').map(Number); return isNaN(h) ? null : h * 60 + (m || 0) }
              const sS = min(shiftStart), aS = min(a.time_from), aE0 = min(a.time_to)
              if (sS == null || aS == null || aE0 == null) return true
              let sE = shiftEnd ? min(shiftEnd) : null
              if (sE != null && sE <= sS) sE += 1440
              const aE = aE0 <= aS ? aE0 + 1440 : aE0
              // Beginnt die Schicht nach Mitternacht innerhalb einer Nacht-Verfügbarkeit
              const passt = (off) => sS + off >= aS && (sE == null || sE + off <= aE)
              return passt(0) || passt(1440)
            })
          })

          // Check not already double-booked this day/shift
          const alreadyBooked = new Set(
            Object.entries(newSchedule)
              .filter(([k, v]) => k.includes(`__${dayIso}__${shift}`) && v.chatter)
              .map(([_, v]) => v.chatter)
          )
          const available = candidates.filter(c => !alreadyBooked.has(c.name))

          if (available.length > 0) {
            // Pick the one with fewest shifts this week
            const shiftCounts = {}
            for (const [k, v] of Object.entries(newSchedule)) {
              if (k.includes(`__${dayIso.slice(0, 7)}`)) {
                if (v.chatter) shiftCounts[v.chatter] = (shiftCounts[v.chatter] || 0) + 1
              }
            }
            available.sort((a, b) => (shiftCounts[a.name] || 0) - (shiftCounts[b.name] || 0))
            newSchedule[cellKey] = { chatter: available[0].name, note: '' }
          }
        }
      }
    }

    setSchedule(newSchedule)
    setAutoPlanning(false)
    logActivity('schedule.autoplan', { entity: `KW ${getKW(weekStart)}`, detail: `Woche ab ${weekKey}` })
    alert('✓ Plan wurde automatisch ausgefüllt – bitte prüfen und anpassen!')
  }

  const getCellKey = (modelId, dayIso, shift) => `${modelId}__${dayIso}__${shift}`
  const getRecurringKey = (modelId, dayOfWeek, shift) => `${modelId}__${dayOfWeek}__${shift}`

  // Sucht nach Chatter in Hauptchatter ODER Trainee — case-insensitive partial match
  const cellMatchesSearch = (cell) => {
    if (!chatterSearch.trim()) return false
    const q = chatterSearch.trim().toLowerCase()
    const main = (cell.chatter || '').toLowerCase()
    const trainee = (cell.trainee || '').toLowerCase()
    return main.includes(q) || trainee.includes(q)
  }

  const setCell = (modelId, dayIso, shift, value) => {
    const key = getCellKey(modelId, dayIso, shift)
    setSchedule(prev => ({ ...prev, [key]: value }))
  }

  const getCell = (modelId, dayIso, shift) => {
    return schedule[getCellKey(modelId, dayIso, shift)] || { chatter: '', note: '' }
  }

  // v4.34.0: Eine Plan-Zeile für den Telegram-Versand, aus Sicht EINER Person.
  // Liefert null, wenn sie in dieser Zelle nicht eingeteilt ist.
  //
  // Neu: der zweite Chatter wird mitgeschickt, wenn er die Schicht wirklich
  // arbeitet (Co oder Geteilt). Beim Anlernen bleibt es beim alten Verhalten —
  // dort steht oft ein externer Name ohne Account und ohne Telegram.
  // Bei einer geteilten Schicht sieht jede Seite IHREN Abschnitt statt der
  // vollen Schichtzeit; ohne eingetragene Spanne fällt sie auf die Schichtzeit zurück.
  const planZeile = (cell, model, shift, name, mitOverride = true) => {
    if (!cell.chatter || cell.chatter === '__FREI__') return null
    const istHaupt = cell.chatter === name
    const istZweit = !istHaupt && cell.trainee === name
    if (!istHaupt && !istZweit) return null
    const modus = zellModus(cell)
    if (istZweit && modus === 'anlernen') return null
    const standard = ((mitOverride && cell.time_override) || shiftTimes[`${model.id}__${shift}`] || '')
      .replace(' (DE)', '').replace('(DE)', '')
    const spanne = modus === 'split' ? splitSpanne(cell, istHaupt ? 'a' : 'b', standard) : ''
    const zeit = spanne || standard
    const zeitText = zeit ? ` (${zeit} Uhr DE)` : ''
    const partner = istHaupt ? cell.trainee : cell.chatter
    const zusatz = modus === 'split' ? ` · geteilte Schicht${partner ? ` mit ${partner}` : ''}`
      : modus === 'co' && cell.trainee ? ` · Co-Schicht${partner ? ` mit ${partner}` : ''}`
      : ''
    return `  ${shift}${zeitText}: ${model.name}${zusatz}${cell.note ? ` – ${cell.note}` : ''}`
  }

  // v4.34.0: Hauptchatter setzen. Wird die Zelle geleert oder auf Freischicht
  // gestellt, müssen zweiter Chatter und Split-Zeiten mit raus.
  // Sonst bliebe ein zweiter Name mit eigener Zeitspanne in einer Zelle stehen,
  // deren Zweitchatter-Bedienung gar nicht mehr eingeblendet wird (die hängt an
  // `cell.chatter`) — im Plan nicht mehr korrigierbar, im Portal aber weiterhin
  // wirksam. Weil dabei Eingetragenes verloren geht, wird vorher gefragt.
  const setChatter = (modelId, dayIso, shift, cell, name) => {
    const leert = !name || name === '__FREI__'
    if (leert && cell.trainee) {
      const ok = window.confirm(
        `In dieser Schicht steht „${cell.trainee}" als zweite Person.\n\n` +
        'Wird der Hauptchatter entfernt, fällt der zweite Eintrag mit weg ' +
        '(inklusive eingetragener Zeiten einer geteilten Schicht).\n\nTrotzdem entfernen?'
      )
      if (!ok) return
    }
    if (leert) {
      const zelle = { ...cell, chatter: name, confirmed: true }
      delete zelle.trainee; delete zelle.trainee_mode
      delete zelle.split_a_von; delete zelle.split_a_bis
      delete zelle.split_b_von; delete zelle.split_b_bis
      setCell(modelId, dayIso, shift, zelle)
      return
    }
    setCell(modelId, dayIso, shift, { ...cell, chatter: name, confirmed: true })
  }

  // v4.34.0: Modus des zweiten Chatters umschalten.
  // Beim WECHSEL werden Name und Split-Zeiten geleert — sonst bliebe z.B. eine
  // Teilzeit von gestern an einer Co-Schicht hängen und ginge in die Lohn-Auswertung
  // ein. Ein Klick auf den bereits aktiven Modus lässt alles unangetastet.
  const setModus = (modelId, dayIso, shift, cell, neuerModus) => {
    if (zellModus(cell) === neuerModus) return
    const hatSplitZeiten = ['split_a_von', 'split_a_bis', 'split_b_von', 'split_b_bis'].some(f => cell?.[f])
    if (hatSplitZeiten && !window.confirm(
      'Für diese Schicht sind Zeiten einer geteilten Schicht eingetragen.\n\n' +
      'Beim Umschalten gehen sie verloren.\n\nTrotzdem umschalten?'
    )) return
    setCell(modelId, dayIso, shift, {
      ...cell,
      trainee_mode: neuerModus,
      trainee: null,
      split_a_von: null, split_a_bis: null,
      split_b_von: null, split_b_bis: null,
    })
  }

  // v3.74.0: Vorschicht-Logik — pro Model/Woche zuschaltbar.
  // Ein Model zeigt die Vorschicht-Zeile, wenn sie aktiviert ist ODER bereits Daten
  // (Belegung oder Zeit) für die Vorschicht existieren — so gehen bestehende Einträge
  // nie verloren, auch wenn das Flag mal fehlt.
  const modelHasVorschichtData = (modelId) => {
    if (shiftTimes[`${modelId}__${EXTRA_SHIFT}`]) return true
    for (const day of weekDays) {
      const c = schedule[getCellKey(modelId, isoDate(day), EXTRA_SHIFT)]
      if (c?.chatter) return true
    }
    return false
  }
  const getModelShifts = (modelId) =>
    (extraShifts[modelId] || modelHasVorschichtData(modelId)) ? ALL_SHIFTS : SHIFTS
  const toggleVorschicht = (modelId) => {
    const isOn = !!extraShifts[modelId] || modelHasVorschichtData(modelId)
    if (isOn) {
      // v3.78.0: Nur echte Belegung (Chatter) blockiert das Ausblenden. Eine übrig
      // gebliebene Vorschicht-Zeit ohne Chatter lässt sich schlecht in der Oberfläche
      // finden/leeren — daher bieten wir an, sie direkt mit zu entfernen.
      const hasChatter = weekDays.some(day => !!schedule[getCellKey(modelId, isoDate(day), EXTRA_SHIFT)]?.chatter)
      if (hasChatter) {
        alert('Vorschicht kann nicht ausgeblendet werden, solange noch Chatter eingetragen sind.\n\nBitte erst die Vorschicht-Zellen leeren.')
        return
      }
      const timeKey = `${modelId}__${EXTRA_SHIFT}`
      if (shiftTimes[timeKey]) {
        if (!window.confirm('Für die Vorschicht ist noch eine Zeit hinterlegt (aber keine Chatter). Zeit entfernen und Vorschicht ausblenden?')) return
        setShiftTimes(prev => { const n = { ...prev }; delete n[timeKey]; return n })
      }
      setExtraShifts(prev => { const n = { ...prev }; delete n[modelId]; return n })
    } else {
      setExtraShifts(prev => ({ ...prev, [modelId]: true }))
    }
  }

  const saveRecurring = async (modelId, dayOfWeek, shift, value) => {
    const key = getRecurringKey(modelId, dayOfWeek, shift)
    if (!value.chatter) {
      // Delete recurring
      await supabase.from('recurring_shifts').delete().eq('shift_key', key)
      setRecurring(prev => { const n = { ...prev }; delete n[key]; return n })
    } else {
      await supabase.from('recurring_shifts').upsert({ shift_key: key, model_id: modelId, day_of_week: dayOfWeek, shift, chatter: value.chatter, note: value.note || '' }, { onConflict: 'shift_key' })
      setRecurring(prev => ({ ...prev, [key]: { chatter: value.chatter, note: value.note || '' } }))
    }
  }

  // v3.27.0: Ausschreiben läuft jetzt über BlockOfferModal (Einzel- oder Block-Angebot
  // mit Zielgruppe). Die alte offerShift-Funktion wurde entfernt.

  const sendReminder = async (modelId, dayIso, shift, chatterName, hoursBeforeStr) => {
    const hoursBefore = parseInt(hoursBeforeStr)
    setSendingReminder(true)
    const chatter = chatters.find(c => c.name === chatterName)
    if (!chatter?.telegram_id) {
      alert(`Kein Telegram für ${chatterName}`)
      setSendingReminder(false)
      setReminderCell(null)
      return
    }
    const model = models.find(m => String(m.id) === String(modelId))
    const modelName = model?.name || 'Unbekannt'
    // v4.58.0: Zell-Override hat Vorrang (wie überall sonst) — vorher wurde er
    // hier ignoriert und die Erinnerung zur Standardzeit geplant.
    const zelle = schedule[`${modelId}__${dayIso}__${shift}`]
    const berlinTime = (zelle?.time_override || shiftTimes[`${modelId}__${shift}`] || '').replace(' (DE)', '').replace('(DE)', '')
    const startTime = berlinTime ? berlinTime.split('-')[0].trim() : ''

    // Calculate send_at: shift start time minus hoursBefore
    // Berlin is UTC+2 in summer (CEST), UTC+1 in winter (CET)
    let sendAt
    if (startTime) {
      const [h, m] = startTime.split(':').map(Number)
      // Get Berlin offset for this specific date
      const testDate = new Date(`${dayIso}T12:00:00Z`)
      const berlinFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hour: 'numeric', hour12: false })
      const utcFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', hour12: false })
      const berlinHour = parseInt(berlinFormatter.format(testDate))
      const utcHour = parseInt(utcFormatter.format(testDate))
      const berlinOffsetHours = berlinHour - utcHour // e.g. +2 for CEST
      // Shift time in UTC = shift time in Berlin minus offset
      // v4.58.0: Date.UTC rechnet den Tagesübertrag selbst. Vorher wurde nur die
      // Stunde per Modulo umgebrochen, das Datum aber nicht: Schicht 00:30 am 20.
      // ergab 22:30Z am 20. statt am 19. — die Erinnerung kam 22 h nach Beginn.
      const [yy, mo, dd] = dayIso.split('-').map(Number)
      const shiftUtc = new Date(Date.UTC(yy, mo - 1, dd, h - berlinOffsetHours, m || 0))
      sendAt = new Date(shiftUtc.getTime() - hoursBefore * 3600000).toISOString()
    } else {
      sendAt = new Date(Date.now() + hoursBefore * 3600000).toISOString()
    }

    await supabase.from('reminders').insert({
      chatter_name: chatterName,
      chatter_telegram_id: chatter.telegram_id,
      model_name: modelName,
      shift,
      shift_date: reminderCell.dayIso,
      shift_start_time: startTime || '?',
      send_at: sendAt,
      sent: false,
    })

    // Mark reminder as active in UI
    setActiveReminders(prev => ({ ...prev, [`${chatterName}__${dayIso}__${shift}`]: true }))

    setSendingReminder(false)
    setReminderCell(null)
    alert(`✓ Erinnerung eingestellt – ${chatterName} wird ${hoursBefore} Stunde${hoursBefore !== 1 ? 'n' : ''} vorher benachrichtigt`)
  }

  // Conflict detection
  const conflicts = []
  for (const model of models) {
    for (const day of weekDays) {
      const dayIso = isoDate(day)
      for (const shift of SHIFTS) {
        const cell = getCell(model.id, dayIso, shift)
        // Nur echt leere Zellen sind "unbesetzt". __FREI__ ist eine bewusste Freischicht
        // und wird NICHT besetzt → nie als Konflikt melden.
        if (!cell.chatter) conflicts.push({ type: 'unbesetzt', msg: `${model.name} · ${DAYS[weekDays.indexOf(day)]} ${formatDate(day)} · ${shift}`, dayIso, shift, modelId: model.id, modelName: model.name })
      }
    }
  }
  // v3.75.0: "Überlastet"-Erkennung (Chatter mit >=4 Models pro Schicht) auf Wunsch entfernt.
  // Es bleiben nur noch "Unbesetzt" und "Doppelschicht" als Konflikte.

  // v3.1.0: Doppel-Schicht-Detection — Chatter in 2+ verschiedenen Schichten am gleichen Tag
  // Mapping: chatter+date → Set of shifts (Früh/Spät/Nacht)
  const chatterShiftsByDay = {} // {"Max__2026-05-06": Set("Früh", "Spät")}
  for (const day of weekDays) {
    const dayIso = isoDate(day)
    for (const shift of ALL_SHIFTS) {
      for (const model of models) {
        const cell = getCell(model.id, dayIso, shift)
        if (!cell.chatter || cell.chatter === '__FREI__') continue
        // v4.34.0: Die zweite Person einer geteilten oder Co-Schicht zählt mit —
        // sie arbeitet die Schicht ja. Ohne sie blieb eine Doppelbelegung
        // (halbe Frühschicht plus volle Spätschicht) unbemerkt.
        const namen = [cell.chatter]
        if (cell.trainee && ['co', 'split'].includes(zellModus(cell))) namen.push(cell.trainee)
        for (const name of namen) {
          const key = `${name}__${dayIso}`
          if (!chatterShiftsByDay[key]) chatterShiftsByDay[key] = new Set()
          chatterShiftsByDay[key].add(shift)
        }
      }
    }
  }
  // Set für schnellen Lookup pro Zelle: welche (chatter, dayIso)-Kombis sind betroffen
  const doppelSchichtKeys = new Set() // "{chatter}__{dayIso}"
  for (const [key, shifts] of Object.entries(chatterShiftsByDay)) {
    if (shifts.size >= 2) {
      doppelSchichtKeys.add(key)
      const [chatterName, dayIso] = key.split('__')
      const dayObj = weekDays.find(d => isoDate(d) === dayIso)
      const dayLabel = dayObj ? `${DAYS[weekDays.indexOf(dayObj)]} ${formatDate(dayObj)}` : dayIso
      const conflictKey = `${chatterName}__${dayIso}` // identisch zu doppelSchichtKey-Format
      conflicts.push({
        type: 'doppel_schicht',
        msg: `${chatterName} hat ${[...shifts].join(' + ')} am ${dayLabel}`,
        chatterName,
        dayIso,
        shifts: [...shifts],
        conflictKey,
        acked: conflictAcks.has(conflictKey),
      })
    }
  }

  // v3.1.0: Sendet an die Chatter die im Modal ausgewählt sind
  const sendPlanToSelected = async () => {
    const selectedIds = sendSelection
    if (selectedIds.size === 0) {
      alert('Bitte mindestens einen Chatter auswählen.')
      return
    }
    setSending(true)
    let sent = 0
    let skipped = 0
    const sentToNames = []     // v3.15.0
    const nichtAngekommen = [] // v4.48.0
    let sampleMessage = ''     // v3.15.0
    for (const chatter of chatters) {
      if (!selectedIds.has(chatter.id)) continue
      if (!chatter.telegram_id) { skipped++; continue }
      const lines = [`📋 Dienstplan KW ${kw} (${formatDate(weekDays[0])} – ${formatDate(weekDays[6])})\n`]
      for (const day of weekDays) {
        const dayIso = isoDate(day)
        const dayShifts = []
        for (const shift of ALL_SHIFTS) {
          for (const model of models) {
            const cell = getCell(model.id, dayIso, shift)
            // v3.24.0: Zeit direkt in DE-Zeit anzeigen. KEIN convertTimeToLocal mehr —
            // das rechnete auf die Browser-Zeitzone des Senders um (Zypern = +1),
            // wodurch ALLE Chatter den Plan +1h verschoben bekamen.
            // v4.34.0: Zeilenbau steckt jetzt in planZeile() — auch für zweite Chatter.
            const zeile = planZeile(cell, model, shift, chatter.name, true)
            if (zeile) dayShifts.push(zeile)
          }
        }
        if (dayShifts.length > 0) {
          lines.push(`${DAYS[weekDays.indexOf(day)]} ${formatDate(day)}`)
          lines.push(...dayShifts)
          lines.push('')
        }
      }
      if (lines.length > 1) {
        const msgText = lines.join('\n')
        const r = await sendTelegramMessage(chatter.telegram_id, msgText)
        // v4.48.0: nur zählen, was wirklich angekommen ist
        if (!zugestellt(r)) { nichtAngekommen.push(chatter.name); continue }
        sent++
        sentToNames.push(chatter.name)
        if (!sampleMessage) sampleMessage = msgText
      }
    }
    // v3.15.0: Audit-Log
    if (sent > 0 || skipped > 0) {
      const allChattersWithTg = chatters.filter(c => c.telegram_id).length
      const actionType = selectedIds.size >= allChattersWithTg ? 'plan_full' : 'plan_partial'
      try {
        await supabase.from('schedule_send_log').insert({
          sent_by: getSenderName(),
          action_type: actionType,
          week_start: isoDate(weekDays[0]),
          kw: kw,
          recipients_count: sent,
          recipients_skipped: skipped,
          recipient_names: sentToNames,
          message_text: sampleMessage,
        })
      } catch (e) {
        console.error('Failed to log send:', e)
      }
    }
    setSending(false)
    setSendModalOpen(false)
    setSendSelection(new Set())
    alert(`${nichtAngekommen.length ? '⚠' : '✓'} Dienstplan an ${sent} Chatter versendet${skipped > 0 ? ` (${skipped} ohne Telegram-ID übersprungen)` : ''}${nichtAngekommen.length ? `\n\nNICHT angekommen bei: ${nichtAngekommen.join(', ')}` : ''}`)
  }

  const sendPlanToAll = async () => {
    setSending(true)
    let sent = 0
    let skipped = 0
    const sentToNames = []     // v3.15.0
    const nichtAngekommen = [] // v4.48.0
    let sampleMessage = ''     // v3.15.0
    for (const chatter of chatters) {
      if (!chatter.telegram_id) { skipped++; continue }
      const lines = [`📋 Dienstplan KW ${kw} (${formatDate(weekDays[0])} – ${formatDate(weekDays[6])})\n`]
      for (const day of weekDays) {
        const dayIso = isoDate(day)
        const dayShifts = []
        for (const shift of ALL_SHIFTS) {
          for (const model of models) {
            const cell = getCell(model.id, dayIso, shift)
            // v3.24.0: Zeit direkt in DE-Zeit anzeigen (siehe oben).
            // v4.34.0: gemeinsame planZeile(), hier ohne time_override wie bisher.
            const zeile = planZeile(cell, model, shift, chatter.name, false)
            if (zeile) dayShifts.push(zeile)
          }
        }
        if (dayShifts.length > 0) {
          lines.push(`${DAYS[weekDays.indexOf(day)]} ${formatDate(day)}`)
          lines.push(...dayShifts)
          lines.push('')
        }
      }
      if (lines.length > 1) {
        const msgText = lines.join('\n')
        const r = await sendTelegramMessage(chatter.telegram_id, msgText)
        // v4.48.0: nur zählen, was wirklich angekommen ist
        if (!zugestellt(r)) { nichtAngekommen.push(chatter.name); continue }
        sent++
        sentToNames.push(chatter.name)
        if (!sampleMessage) sampleMessage = msgText
      }
    }
    // v3.15.0: Audit-Log
    if (sent > 0 || skipped > 0) {
      try {
        await supabase.from('schedule_send_log').insert({
          sent_by: getSenderName(),
          action_type: 'plan_full',
          week_start: isoDate(weekDays[0]),
          kw: kw,
          recipients_count: sent,
          recipients_skipped: skipped,
          recipient_names: sentToNames,
          message_text: sampleMessage,
        })
      } catch (e) {
        console.error('Failed to log send:', e)
      }
    }
    setSending(false)
    alert(nichtAngekommen.length
      ? `⚠ Dienstplan an ${sent} Chatter versendet.\n\nNICHT angekommen bei: ${nichtAngekommen.join(', ')}`
      : '✓ Dienstplan versendet!')
  }

  const prevWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d) }
  const nextWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d) }

  const cellStyleBase = (dayIso) => ({
    border: `1px solid ${weekDays.some(d => isoDate(d) === dayIso && isToday(d)) ? 'rgba(124,58,237,0.2)' : 'var(--border)'}`,
    background: weekDays.some(d => isoDate(d) === dayIso && isToday(d)) ? 'rgba(124,58,237,0.04)' : 'transparent',
  })

  // v3.28.0: Lookup für Dienstplan-Markierung. Key: `${model_name}__${dayIso}__${shift}`
  // Admin-Angebot (requester_name=null) hat Vorrang in der Anzeige, falls beides existiert.
  // v4.16.0: Schichten dieser Woche je Chatter — EINE Berechnung für Vorauswahl,
  // Zähler und Liste im Sende-Modal. Vorher hat die Vorschau alle angehakt und der
  // Versand die ohne Schichten stillschweigend übersprungen: "An 12 senden" ->
  // "an 7 versendet".
  const zaehleSchichten = (chatterName) => {
    let n = 0
    for (const day of weekDays) {
      const dayIso = isoDate(day)
      for (const shift of ALL_SHIFTS) {
        for (const model of models) {
          const cell = getCell(model.id, dayIso, shift)
          if (cell.chatter === chatterName) { n++; continue }
          // v4.34.0: Wer die Schicht als zweite Person wirklich arbeitet (Co oder
          // Geteilt), zählt mit. Sonst galt er hier als „keine Schichten diese Woche":
          // Häkchen gesperrt, „Alle" übersprang ihn — und ausgerechnet ihm wurde
          // der Knopf „Ausblenden" (Karteileiche) angeboten.
          if (cell.trainee === chatterName && ['co', 'split'].includes(zellModus(cell))) n++
        }
      }
    }
    return n
  }
  // Wer tatsächlich etwas bekommen kann: Telegram-ID UND mindestens eine Schicht.
  const empfangsbereit = (c) => !!c.telegram_id && zaehleSchichten(c.name) > 0

  // v4.16.2: Karteileiche direkt aus der Versandliste entfernen.
  // Bisher musste man dafür in die Einstellungen (oder in Supabase) — genau da
  // fällt einem so ein Eintrag aber nie auf, sondern hier beim Verschicken.
  // Angeboten wird das NUR bei Leuten, die ohnehin nichts bekommen können,
  // damit niemand versehentlich einen aktiven Chatter entfernt.
  const chatterAusblenden = async (chatter) => {
    if (!window.confirm(
      `„${chatter.name}" aus allen Chatter-Listen ausblenden?\n\n` +
      'Danach verschwindet der Name aus dieser Liste, aus den Dropdowns im Dienstplan ' +
      'und aus den Umfrage-Empfängern.\n\n' +
      'Es wird nichts gelöscht — Schichtnotizen, Check-ins und Verläufe bleiben. ' +
      'Rückgängig geht es in den Einstellungen unter Team.',
    )) return
    await supabase.from('chatters_contact').update({ active: false }).eq('name', chatter.name)
    logActivity('user.status', { entity: chatter.name, detail: 'aus den Chatter-Listen ausgeblendet' })
    await loadChatters()
  }

  // Vorauswahl erst setzen, wenn das Modal aufgeht — dann sind Chatter und Plan da.
  useEffect(() => {
    if (!sendModalOpen) return
    setSendSelection(new Set(chatters.filter(empfangsbereit).map(c => c.id)))
  }, [sendModalOpen, chatters, schedule])

  // ── v4.83.0: Zahlen für Kopfzeile und Wochenstreifen ──
  const heuteIso = todayBerlin()
  const morgenIso = (() => { const d = new Date(heuteIso + 'T12:00:00'); d.setDate(d.getDate() + 1); return isoDate(d) })()
  const weekIsos = weekDays.map(d => isoDate(d))
  const offenAm = (dayIso) => conflicts.filter(c => c.type === 'unbesetzt' && c.dayIso === dayIso).length
  const offenAbHeute = conflicts.filter(c => c.type === 'unbesetzt' && c.dayIso >= heuteIso).length
  const doppelOffen = conflicts.filter(c => c.type === 'doppel_schicht' && !c.acked).length
  const abwesendWoche = absences.filter(a => a.date_from <= weekIsos[6] && a.date_to >= weekIsos[0]).length
  const tauschWoche = openSwaps.filter(s => s.shift_date >= weekIsos[0] && s.shift_date <= weekIsos[6]).length
  const zuKonflikt = (gruppe) => {
    setOpenConflictGroups(prev => ({ ...prev, [gruppe]: true }))
    setTimeout(() => konfliktRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }
  const zuAbwesenheit = () => {
    setShowAbsences(true)
    setTimeout(() => abwesendRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  // v4.87.0: Schichtzeit einer Zelle als Minuten (Start/Ende) relativ zu einem
  // festen Tag — für den Pausen-Hinweis. Ende vor Start = über Mitternacht.
  // null, wenn keine Zeit hinterlegt ist.
  const tagNr = (iso) => Math.round(Date.parse(iso + 'T12:00:00Z') / 86400000)
  const zellSpanne = (mId, dIso, sh, c) => {
    const txt = ((c && c.time_override) || shiftTimes[`${mId}__${sh}`] || '').replace(/\s*\(DE\)/g, '')
    const m = txt.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/)
    if (!m) return null
    const basis = tagNr(dIso) * 1440
    const start = basis + (+m[1]) * 60 + (+m[2])
    let ende = basis + (+m[3]) * 60 + (+m[4])
    if (ende <= start) ende += 1440
    return { start, ende }
  }
  const PAUSE_MIN_STD = 8 // weniger Ruhezeit zwischen zwei Schichten → Hinweis
  const kurzTag = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short' })

  // v4.83.0: Wer passt in diese Schicht? Für die Karten im Schicht-Fenster.
  const personenFuer = (modelId, dayIso, shift) => {
    const kennt = (name) => {
      for (const d of weekIsos) for (const sh of ALL_SHIFTS) {
        if (d === dayIso && sh === shift) continue
        const c = getCell(modelId, d, sh)
        if (c.chatter === name || c.trainee === name) return true
      }
      for (const [key, r] of Object.entries(recurring)) if (key.startsWith(`${modelId}__`) && r?.chatter === name) return true
      return false
    }
    return chatters.map(c => {
      const name = c.name
      const abwesend = absences.find(a => a.chatter_name === name && dayIso >= a.date_from && dayIso <= a.date_to &&
        (!a.available_shifts || a.available_shifts.length === 0 || !a.available_shifts.includes(shift))) || null
      const andere = [...(chatterShiftsByDay[`${name}__${dayIso}`] || [])].filter(sh => sh !== shift)
      const gleiche = models.filter(m => m.id !== modelId).filter(m => {
        const c2 = getCell(m.id, dayIso, shift)
        return c2.chatter === name || (c2.trainee === name && ['co', 'split'].includes(zellModus(c2)))
      }).map(m => m.name)
      // v4.87.0: Ruhezeit zur Schicht davor (Vortag) und danach (Folgetag).
      // Nur innerhalb der geladenen Woche — über den Wochenwechsel hinaus
      // sind die Nachbarschichten nicht bekannt.
      let pause = null
      const hier = zellSpanne(modelId, dayIso, shift, getCell(modelId, dayIso, shift))
      if (hier) {
        const nachbarn = []
        for (const off of [-1, 1]) {
          const d = new Date(dayIso + 'T12:00:00'); d.setDate(d.getDate() + off)
          const nIso = isoDate(d)
          if (!weekIsos.includes(nIso)) continue
          for (const sh of ALL_SHIFTS) for (const m of models) {
            const c2 = getCell(m.id, nIso, sh)
            const drin = c2.chatter === name || (c2.trainee === name && ['co', 'split'].includes(zellModus(c2)))
            if (!drin) continue
            const sp = zellSpanne(m.id, nIso, sh, c2)
            if (!sp) continue
            const luecke = off < 0 ? hier.start - sp.ende : sp.start - hier.ende
            nachbarn.push({ luecke, text: `${kurzTag(nIso)} ${sh}`, vorher: off < 0 })
          }
        }
        const knapp = nachbarn.filter(n => n.luecke < PAUSE_MIN_STD * 60).sort((a, b) => a.luecke - b.luecke)[0]
        if (knapp) pause = { std: Math.max(0, Math.round(knapp.luecke / 30) / 2), zu: knapp.text, vorher: knapp.vorher }
      }
      return { name, abwesend, woche: zaehleSchichten(name), andere, gleiche, kennt: kennt(name), pause }
    })
  }

  // v4.85.0: Belegung einer Zelle für weitere Models derselben Schicht übernehmen.
  // Kopiert Chatter, Modus, zweite Person, Split-Zeiten, Notiz und „Bestätigt“ —
  // NICHT die abweichende Zeit (time_override), weil jedes Model eigene
  // Schichtzeiten hat. Belegte Zellen werden nur nach Rückfrage überschrieben.
  // Gibt die Namen der tatsächlich geänderten Models zurück.
  const uebernehmeBelegung = (vonModelId, dayIso, shift, zielIds) => {
    const quelle = getCell(vonModelId, dayIso, shift)
    if (!quelle.chatter) return []
    const ziele = models.filter(m => zielIds.includes(m.id))
    const belegt = ziele.filter(m => { const c = getCell(m.id, dayIso, shift); return c.chatter && c.chatter !== quelle.chatter })
    let erlaubt = ziele
    if (belegt.length) {
      const liste = belegt.map(m => { const c = getCell(m.id, dayIso, shift); return `• ${m.name}: ${c.chatter === '__FREI__' ? 'Freischicht' : c.chatter}${c.trainee ? ` + ${c.trainee}` : ''}` }).join('\n')
      const ueberschreiben = window.confirm(`Bei ${belegt.length === 1 ? 'diesem Model' : 'diesen Models'} ist die Schicht schon belegt:\n\n${liste}\n\nÜberschreiben?`)
      if (!ueberschreiben) {
        erlaubt = ziele.filter(m => !belegt.includes(m))
        if (!erlaubt.length) return []
        if (!window.confirm(`Dann nur bei den freien übernehmen (${erlaubt.map(m => m.name).join(', ')})?`)) return []
      }
    }
    for (const m of erlaubt) {
      const alt = getCell(m.id, dayIso, shift)
      const neu = {
        ...alt,
        chatter: quelle.chatter,
        note: quelle.note || '',
        confirmed: quelle.confirmed !== false,
        trainee: quelle.trainee || null,
        trainee_mode: quelle.trainee_mode || null,
        split_a_von: quelle.split_a_von || null, split_a_bis: quelle.split_a_bis || null,
        split_b_von: quelle.split_b_von || null, split_b_bis: quelle.split_b_bis || null,
      }
      setCell(m.id, dayIso, shift, neu)
    }
    return erlaubt.map(m => m.name)
  }

  const openSwapMap = {}
  for (const s of openSwaps) {
    const key = `${s.model_name}__${s.shift_date}__${s.shift}`
    const isAdminOffer = !s.requester_name
    if (!openSwapMap[key] || isAdminOffer) openSwapMap[key] = { isAdminOffer }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingRight: (!isMobile && editSheet) ? 404 : 0, transition: 'padding-right .15s' }}>
      {/* v3.27.0: Ausschreiben-/Block-Modal */}
      {blockOffer && (
        <BlockOfferModal
          preset={blockOffer}
          models={models}
          shifts={[...SHIFTS, EXTRA_SHIFT]}
          onClose={() => setBlockOffer(null)}
          onDone={() => { setBlockOffer(null); loadOpenSwaps() }}
        />
      )}
      {/* v4.83.0: Kopfzeile neu — eine Zeile statt sechs bunter Knöpfe.
          Selten Gebrauchtes (Versenden, Auto-Plan, Vorlagen, Verlauf, Entwurf/Live)
          liegt hinter „⋯“. Konflikte stehen oben als Chips statt nur ganz unten. */}
      {(() => {
        const knopf = { height: 36, minWidth: 36, padding: '0 11px', borderRadius: 11, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }
        const pill = (farbe, hinter) => ({ fontSize: 11.5, fontWeight: 700, padding: '6px 10px', borderRadius: 20, background: hinter, color: farbe, border: 'none', fontFamily: 'inherit', whiteSpace: 'nowrap' })
        const live = scheduleStatus === 'live'
        const chips = (
          <>
            {offenAbHeute > 0
              ? <button type="button" className="dp-chip" onClick={() => zuKonflikt('unbesetzt')} style={{ ...pill('#fca5a5', 'rgba(239,68,68,0.12)'), cursor: 'pointer' }}>{offenAbHeute} offen</button>
              : <span style={pill('#6ee7b7', 'rgba(16,185,129,0.12)')}>✓ alles besetzt</span>}
            {doppelOffen > 0 && <button type="button" className="dp-chip" onClick={() => zuKonflikt('doppel')} style={{ ...pill('#f9a8d4', 'rgba(236,72,153,0.12)'), cursor: 'pointer' }}>⚠ {doppelOffen} Doppel</button>}
            {abwesendWoche > 0 && <button type="button" className="dp-chip" onClick={zuAbwesenheit} style={{ ...pill('#67e8f9', 'rgba(8,145,178,0.14)'), cursor: 'pointer' }}>🌴 {abwesendWoche} abwesend</button>}
            {tauschWoche > 0 && <button type="button" className="dp-chip" onClick={() => zuKonflikt('ausgeschrieben')} style={{ ...pill('#fcd34d', 'rgba(245,158,11,0.12)'), cursor: 'pointer' }}>↔ {tauschWoche} Tausch</button>}
          </>
        )
        const suchFeld = (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, boxSizing: 'border-box', padding: '0 11px', borderRadius: 11, border: `1px solid ${chatterSearch ? '#f59e0b' : 'var(--border)'}`, background: chatterSearch ? 'rgba(245,158,11,0.08)' : 'transparent', width: isMobile ? '100%' : 230 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--text-muted)', flexShrink: 0 }}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input value={chatterSearch} onChange={e => setChatterSearch(e.target.value)} placeholder="Chatter markieren" aria-label="Chatter markieren" autoFocus={isMobile && sucheOffen}
              style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit' }} />
            {chatterSearch && <button type="button" onClick={() => setChatterSearch('')} aria-label="Suche leeren" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, fontSize: 14 }}>×</button>}
          </label>
        )
        const woche = (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: isMobile ? 1 : 'none' }}>
            <button type="button" className="dp-knopf" onClick={prevWeek} aria-label="Woche zurück" style={knopf}>‹</button>
            <div style={{ textAlign: 'center', flex: isMobile ? 1 : 'none', minWidth: 96 }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.15 }}>KW {kw}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{formatDate(weekDays[0])} – {formatDate(weekDays[6])} {weekDays[0].getFullYear()}</div>
            </div>
            <button type="button" className="dp-knopf" onClick={nextWeek} aria-label="Woche vor" style={knopf}>›</button>
          </div>
        )
        const status = (
          <>
            <span style={pill(live ? '#6ee7b7' : 'var(--text-muted)', live ? 'rgba(16,185,129,0.14)' : 'rgba(136,136,170,0.14)')}>{live ? '● Live' : '○ Entwurf'}</span>
            <span style={{ fontSize: 11.5, color: saving ? '#fcd34d' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>{saving ? 'speichert …' : '✓ gespeichert'}</span>
          </>
        )
        const aktionen = (
          <>
            {isMobile && <button type="button" className="dp-knopf" onClick={() => setSucheOffen(v => !v)} aria-label="Chatter suchen" style={{ ...knopf, padding: 0, borderColor: chatterSearch ? '#f59e0b' : 'var(--border)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            </button>}
            {!isMobile && suchFeld}
            <button type="button" className="dp-knopf" onClick={() => setMehrOffen(true)} aria-label="Mehr Aktionen" style={knopf}>⋯{isMobile ? '' : ' Mehr'}</button>
            <button type="button" className="dp-knopf" onClick={() => saveSchedule()} disabled={saving} style={{ ...knopf, background: '#7c3aed', borderColor: '#7c3aed', color: '#fff' }}>{saving ? '…' : 'Speichern'}</button>
          </>
        )
        return (
          <div className="dp-kopf" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {isMobile ? (
              <>
                {woche}
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>{status}<span style={{ flex: 1 }} />{aktionen}</div>
                {(sucheOffen || chatterSearch) && suchFeld}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{chips}</div>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {woche}{status}<span style={{ width: 6 }} />{chips}<span style={{ flex: 1 }} />{aktionen}
              </div>
            )}
          </div>
        )
      })()}

      {/* v4.83.0: „⋯ Mehr“ — Fenster von unten (am Rechner mittig) */}
      {mehrOffen && (() => {
        const zeile = (icon, farbe, titel, unter, onClick, disabled) => (
          <button type="button" className="dp-aktion" disabled={disabled} onClick={() => { setMehrOffen(false); onClick() }} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, background: 'var(--bg-card2)', border: '1px solid var(--border)',
            cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%', opacity: disabled ? 0.5 : 1,
          }}>
            <span style={{ width: 38, height: 38, borderRadius: 11, background: farbe + '26', color: farbe, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>{icon}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{titel}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginTop: 1 }}>{unter}</span>
            </span>
            <span style={{ color: 'var(--text-muted)' }}>›</span>
          </button>
        )
        const lblM = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 6 }
        const live = scheduleStatus === 'live'
        return (
          <div className="steckbrief-huelle" onClick={() => setMehrOffen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <div className="steckbrief-fenster" onClick={e => e.stopPropagation()} role="dialog" aria-label="Dienstplan-Aktionen" style={{
              width: 'min(460px, 100%)', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box', background: 'var(--bg-card)',
              border: '1px solid var(--border)', borderRadius: '22px 22px 0 0', padding: '16px 18px 20px', display: 'flex', flexDirection: 'column', gap: 9,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, fontSize: 19, fontWeight: 700, color: 'var(--text-primary)' }}>Dienstplan KW {kw}</div>
                <button type="button" onClick={() => setMehrOffen(false)} aria-label="Schließen" style={{ width: 36, height: 36, borderRadius: 11, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 17, cursor: 'pointer' }}>×</button>
              </div>
              <div style={{ display: 'flex', padding: 4, borderRadius: 13, background: 'var(--bg-card2)', border: '1px solid var(--border)' }}>
                {[['draft', '○ Entwurf'], ['live', '● Live für Chatter']].map(([k, t]) => {
                  const an = (k === 'live') === live
                  return (
                    <button key={k} type="button" className="dp-seg" disabled={publishing} onClick={() => { if (!an) togglePublish() }} style={{
                      flex: 1, padding: 10, borderRadius: 10, border: 'none', cursor: an ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: an ? 800 : 700,
                      background: an ? (k === 'live' ? 'rgba(16,185,129,0.18)' : 'rgba(136,136,170,0.18)') : 'transparent',
                      color: an ? (k === 'live' ? '#6ee7b7' : 'var(--text-primary)') : 'var(--text-muted)',
                    }}>{publishing && !an ? '…' : t}</button>
                  )
                })}
              </div>
              <div style={lblM}>Verschicken &amp; planen</div>
              {zeile('✈', '#06b6d4', sending ? 'Sende …' : 'Plan versenden', 'an die Chatter per Telegram — du wählst, an wen', async () => { await loadChatters(); setSendModalOpen(true) }, sending)}
              {zeile('⚡', '#f59e0b', autoPlanning ? 'Plane …' : 'Auto-Plan', 'offene Schichten automatisch vorschlagen lassen', autoGeneratePlan, autoPlanning)}
              <div style={lblM}>Nächste Woche</div>
              {zeile('↻', '#a78bfa', 'Als Vorlage übernehmen', `KW ${kw + 1 > 53 ? 1 : kw + 1} startet mit diesem Plan (nur leere Zellen)`, () => alsVorlageUebertragen(false))}
              {zeile('↻', '#f59e0b', 'Vorlage + alles auf Klärung', 'wie oben, aber jeder muss neu bestätigen — wöchentlich feste bleiben bestätigt', () => alsVorlageUebertragen(true))}
              <div style={lblM}>Nachschauen</div>
              {zeile('🕑', '#8888aa', 'Verlauf', 'wann der Plan an wen verschickt wurde', () => { setLogModalOpen(true); loadSendLog() })}
            </div>
          </div>
        )
      })()}

      {/* v4.50.0: Speicherfehler sichtbar — vorher still verschluckt */}
      {speicherFehler && (
        <div role="alert" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.45)', color: '#ef4444', borderRadius: 8, padding: '10px 12px', fontSize: 12, fontWeight: 600, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span>⚠ {speicherFehler}</span>
          <button onClick={() => saveSchedule()} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid rgba(239,68,68,0.45)', color: '#ef4444', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Erneut speichern</button>
        </div>
      )}

      {/* ───────── MOBILE VIEW ───────── */}
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Tag-Switcher */}
          <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch' }}>
            {weekDays.map((day, di) => {
              const dayIso = isoDate(day)
              const isSelected = mobileDay === dayIso
              const today = isToday(day)
              return (
                <button key={di} onClick={() => setMobileDay(dayIso)} className="dp-tag" style={{
                  flex: '1 0 44px', // v4.83.0: alle 7 Tage passen nebeneinander
                  padding: '7px 2px',
                  borderRadius: 11,
                  background: isSelected ? '#7c3aed' : today ? 'rgba(56,130,246,0.1)' : 'var(--bg-card)',
                  border: `1px solid ${isSelected ? '#7c3aed' : today ? 'rgba(56,130,246,0.4)' : 'var(--border)'}`,
                  color: isSelected ? '#fff' : today ? '#378add' : 'var(--text-secondary)',
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  minWidth: 44,
                  gap: 2,
                }}>
                  <span style={{ fontSize: 10, opacity: 0.85 }}>{DAYS[di]}</span>
                  <span style={{ fontSize: 14 }}>{day.getDate()}.{String(day.getMonth() + 1).padStart(2, '0')}</span>
                  {/* v4.83.0: wie viel an dem Tag noch offen ist */}
                  {(() => { const n = offenAm(dayIso); const alt = dayIso < heuteIso; return (
                    <span style={{ fontSize: 9.5, fontWeight: 800, color: isSelected ? '#fff' : n === 0 ? '#6ee7b7' : alt ? 'var(--text-muted)' : dayIso <= morgenIso ? '#fca5a5' : '#fcd34d' }}>{n === 0 ? 'voll' : `${n} offen`}</span>
                  ) })()}
                </button>
              )
            })}
          </div>

          {/* Tages-Notiz */}
          <div onClick={() => setEditingNote(editingNote === mobileDay ? null : mobileDay)}
            style={{ background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 8, padding: '8px 12px', cursor: 'text' }}>
            {editingNote === mobileDay ? (
              <input autoFocus value={dayNotes[mobileDay] || ''}
                onChange={e => setDayNotes(prev => ({ ...prev, [mobileDay]: e.target.value }))}
                onBlur={() => setEditingNote(null)}
                onKeyDown={e => e.key === 'Enter' && setEditingNote(null)}
                placeholder="Tages-Notiz..."
                style={{ width: '100%', background: 'transparent', border: 'none', color: '#f59e0b', fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
              />
            ) : (
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                <span style={{ fontWeight: 700, marginRight: 6 }}>Tages-Notiz:</span>
                <span style={{ color: dayNotes[mobileDay] ? '#f59e0b' : 'var(--text-muted)' }}>
                  {dayNotes[mobileDay] || '+ tippen zum Hinzufügen'}
                </span>
              </div>
            )}
          </div>

          {/* Pro Model eine Karte */}
          {models.map(model => {
            const dayIso = mobileDay
            return (
              <div key={model.id} style={{ background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 7, background: model.avatar_url ? `url(${model.avatar_url}) center/cover` : 'rgba(167,139,250,0.15)', border: '1px solid var(--border)', flexShrink: 0 }} />
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{model.name}</span>
                  {(() => {
                    const vorOn = !!extraShifts[model.id] || modelHasVorschichtData(model.id)
                    return (
                      <button
                        onClick={() => toggleVorschicht(model.id)}
                        title={vorOn ? 'Vorschicht ausblenden (nur wenn leer)' : 'Vorschicht zuschalten'}
                        style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, fontWeight: 700,
                          background: vorOn ? 'rgba(59,130,246,0.15)' : 'transparent',
                          color: vorOn ? '#3b82f6' : 'var(--text-muted)',
                          border: `1px solid ${vorOn ? 'rgba(59,130,246,0.45)' : 'var(--border)'}` }}
                      >
                        <span style={{ width: 6, height: 6, borderRadius: 2, background: '#3b82f6', flexShrink: 0 }} />
                        {vorOn ? '✓ Vor' : '+ Vor'}
                      </button>
                    )
                  })()}
                </div>

                {getModelShifts(model.id).map(shift => {
                  const cell = getCell(model.id, dayIso, shift)
                  const cellId = getCellKey(model.id, dayIso, shift)
                  const isFrei = cell.chatter === '__FREI__'
                  const confirmed = cell.confirmed !== false
                  const isPending = cell.chatter && !isFrei && !confirmed
                  const isChatterAbsent = cell.chatter && !isFrei ? isAbsent(cell.chatter, dayIso, shift) : false
                  const isSearchMatch = cellMatchesSearch(cell)
                  const isTrainee = !!cell.trainee && !isFrei
                  // v4.34.0: Rahmenfarbe folgt jetzt dem Modus (Anlernen cyan, Co orange,
                  // Geteilt pink) — vorher war jede Zelle mit zweitem Chatter cyan und
                  // eine Co-Schicht sah aus wie ein Anlernen.
                  const zweitModus = zellModus(cell)
                  const zweitFarbe = MODE_META[zweitModus].color
                  // Standardzeit der Zelle — füllt bei halb eingetragener geteilter
                  // Schicht die fehlende Hälfte, damit Raster und Telegram-Plan
                  // dieselbe Spanne zeigen.
                  const zweitStandard = (cell.time_override || shiftTimes[`${model.id}__${shift}`] || '').replace(/\s*\(DE\)/g, '')
                  const timeStr = shiftTimes[`${model.id}__${shift}`]
                  const ShiftIcon = SHIFT_ICON[shift] || null
                  const shiftColor = SHIFT_COLORS[shift] || 'var(--text-muted)'

                  // v4.6.0: Farbton je Schicht — Vorschicht blau statt grün/orange
                  const tone = cellTone(shift)
                  const bgBase = isChatterAbsent ? 'rgba(239,68,68,0.08)' : isFrei ? tone.freiBg : isPending ? tone.pendBg : cell.chatter ? tone.takenBg : 'var(--bg-card2)'
                  const borderBase = isChatterAbsent ? 'rgba(239,68,68,0.4)' : isFrei ? tone.freiBorder : isPending ? tone.pendBorder : cell.chatter ? tone.takenBorder : 'var(--border)'
                  const bg = isTrainee ? `${zweitFarbe}1A` : bgBase
                  const border = isTrainee ? zweitFarbe : borderBase
                  const borderWidth = isTrainee ? 2 : 1
                  const boxShadow = isSearchMatch ? '0 0 0 2px #f59e0b, 0 0 12px rgba(245,158,11,0.6)' :
                                    isTrainee ? `0 0 8px ${zweitFarbe}59` : 'none'

                  // v3.28.1: ausgeschriebene Schicht dezent markieren (leichtes Lila, kein Leuchten)
                  const swapHere = openSwapMap[`${model.name}__${dayIso}__${shift}`]
                  const showSwap = swapHere && !isChatterAbsent && !isSearchMatch
                  const cellBgF = showSwap ? 'rgba(167,139,250,0.13)' : bg
                  const cellBorderF = showSwap ? 'rgba(167,139,250,0.55)' : border
                  const cellBorderWidthF = showSwap ? 1 : borderWidth
                  const cellBoxShadowF = boxShadow
                  // v4.6.0: unbestätigte Vorschicht = gestrichelter Rahmen (statt Orange)
                  const cellBorderStyleF = (tone.pendDashed && isPending && !isChatterAbsent && !isTrainee && !showSwap) ? 'dashed' : 'solid'

                  return (
                    <div key={shift} onClick={() => setEditSheet({ modelId: model.id, dayIso, shift })}
                      style={{ position: 'relative', marginBottom: 6, padding: '10px 12px', background: cellBgF, border: `${cellBorderWidthF}px ${cellBorderStyleF} ${cellBorderF}`, borderRadius: 8, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: cellBoxShadowF }}>
                      {showSwap && (
                        <div title={swapHere.isAdminOffer ? 'Ausgeschrieben (Admin-Angebot)' : 'Tausch angefragt'} style={{ position: 'absolute', top: -8, left: isTrainee ? 'auto' : 10, right: isTrainee ? 10 : 'auto', fontSize: 8, fontWeight: 700, padding: '2px 7px', borderRadius: 3, background: '#a78bfa', color: '#fff', letterSpacing: '0.04em', whiteSpace: 'nowrap', zIndex: 2 }}>
                          {swapHere.isAdminOffer ? '🔄 AUSGESCHRIEBEN' : '↔ TAUSCH'}
                        </div>
                      )}
                      {isTrainee && (
                        <div style={{ position: 'absolute', top: -8, left: 10, fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 3, background: zweitFarbe, color: '#fff', letterSpacing: '0.04em', zIndex: 2 }}>
                          {MODE_META[zweitModus].icon} {MODE_META[zweitModus].label.toUpperCase()}
                        </div>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: shiftColor, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>{ShiftIcon && <ShiftIcon size={12} strokeWidth={2.4} />}<span>{shift}{timeStr ? ` · ${timeStr}` : ''}</span></div>
                        {isFrei ? (
                          <div style={{ fontSize: 14, fontWeight: 700, color: tone.freiText }}>✓ Freischicht</div>
                        ) : cell.chatter ? (
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', gap: 6, alignItems: 'baseline' }}>
                              <span>{cell.chatter}</span>
                              {/* v4.34.0: bei geteilter Schicht steht die eigene Spanne direkt am Namen */}
                              {zweitModus === 'split' && splitSpanne(cell, 'a', zweitStandard) && (
                                <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', color: zweitFarbe }}>{splitSpanne(cell, 'a', zweitStandard)}</span>
                              )}
                            </div>
                            {cell.trainee && (
                              <div style={{ fontSize: 12, color: zweitFarbe, fontWeight: 600, display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                                <span>{MODE_META[zweitModus].icon} {zweitModus === 'split' ? '' : 'mit '}{cell.trainee}</span>
                                {zweitModus === 'split' && splitSpanne(cell, 'b', zweitStandard) && (
                                  <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>{splitSpanne(cell, 'b', zweitStandard)}</span>
                                )}
                              </div>
                            )}
                            {cell.time_override && (
                              <div style={{ fontSize: 10, color: '#f97316', marginTop: 2, fontFamily: 'monospace', fontWeight: 700 }}>⚠ {cell.time_override}</div>
                            )}
                            {cell.note && <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 2 }}>{cell.note}</div>}
                          </div>
                        ) : (
                          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>– offen –</div>
                        )}
                      </div>
                      <span style={{ fontSize: 18, color: 'var(--text-muted)', marginLeft: 8 }}>›</span>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      ) : (
      /* ───────── DESKTOP VIEW ───────── */
      <>
      {/* Schedule - Card Layout */}
      <div style={{ overflowX: 'auto' }}>
        {/* v4.83.0: Tageskopf mit „X offen“ und der Tages-Notiz (vorher eigene Zeile) */}
        <div style={{ display: 'grid', gridTemplateColumns: '120px repeat(7, minmax(90px, 1fr))', gap: 4, marginBottom: 12 }}>
          <div />
          {weekDays.map((day, di) => {
            const dayIso = isoDate(day)
            const n = offenAm(dayIso)
            const alt = dayIso < heuteIso
            const heute = isToday(day)
            return (
              <div key={di} style={{ textAlign: 'center', padding: '7px 4px', borderRadius: 11, background: heute ? 'rgba(124,58,237,0.14)' : 'transparent', border: `1px solid ${heute ? 'rgba(124,58,237,0.4)' : 'transparent'}` }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: heute ? '#c4b5fd' : 'var(--text-secondary)' }}>{DAYS[di]} {formatDate(day)}</div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: n === 0 ? '#6ee7b7' : alt ? 'var(--text-muted)' : dayIso <= morgenIso ? '#fca5a5' : '#fcd34d' }}>{n === 0 ? 'voll' : `${n} offen`}</div>
                {editingNote === dayIso ? (
                  <input autoFocus value={dayNotes[dayIso] || ''}
                    onChange={e => setDayNotes(prev => ({ ...prev, [dayIso]: e.target.value }))}
                    onBlur={() => setEditingNote(null)}
                    onKeyDown={e => e.key === 'Enter' && setEditingNote(null)}
                    placeholder="Tages-Notiz"
                    style={{ marginTop: 4, width: '100%', boxSizing: 'border-box', background: 'var(--bg-input)', border: '1px solid #7c3aed', borderRadius: 6, color: '#f59e0b', padding: '3px 6px', fontSize: 10.5, fontFamily: 'inherit', outline: 'none' }}
                  />
                ) : (
                  <div onClick={() => setEditingNote(dayIso)} title="Tages-Notiz bearbeiten"
                    style={{ marginTop: 3, fontSize: 10.5, color: dayNotes[dayIso] ? '#f59e0b' : 'var(--text-muted)', opacity: dayNotes[dayIso] ? 1 : 0.55, cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {dayNotes[dayIso] ? `📝 ${dayNotes[dayIso]}` : '+ Notiz'}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Collapse Controls + Models Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, padding: '0 4px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
            {models.length} Models · {collapsedModels.size > 0 ? `${collapsedModels.size} eingeklappt` : 'alle ausgeklappt'}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={collapseAllModels} style={{
              fontSize: 10, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', fontFamily: 'inherit', fontWeight: 600
            }}>▶ Alle einklappen</button>
            <button onClick={expandAllModels} style={{
              fontSize: 10, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', fontFamily: 'inherit', fontWeight: 600
            }}>▼ Alle ausklappen</button>
          </div>
        </div>

        {/* Models */}
        {models.map((model, mi) => {
          const modelColors = ['#f59e0b', '#10b981', '#a78bfa', '#06b6d4', '#ef4444', '#f97316', '#ec4899', '#14b8a6']
          const modelColor = modelColors[mi % modelColors.length]
          const isCollapsed = collapsedModels.has(model.id)

          // Mini-Stats für collapsed-Anzeige: wieviele Cells sind besetzt diese Woche
          let totalCells = 0
          let filledCells = 0
          let frei = 0
          let pending = 0
          for (const day of weekDays) {
            const dayIso = isoDate(day)
            for (const shift of getModelShifts(model.id)) {
              totalCells++
              const c = getCell(model.id, dayIso, shift)
              if (c.chatter === '__FREI__') frei++
              else if (c.chatter) {
                if (c.confirmed === false) pending++
                else filledCells++
              }
            }
          }

          return (
            <div key={model.id} style={{ background: modelColor + '08', border: `1px solid ${modelColor}30`, borderRadius: 12, padding: 10, marginBottom: 10 }}>
              {/* Model header — klickbar zum kollabieren */}
              <div
                onClick={() => toggleModelCollapse(model.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: isCollapsed ? 0 : 10, cursor: 'pointer', userSelect: 'none' }}
              >
                <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, width: 12 }}>{isCollapsed ? '▶' : '▼'}</span>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: modelColor + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: modelColor, flexShrink: 0 }}>{model.name[0]}</div>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{model.name}</span>
                {!isCollapsed && (() => {
                  const vorOn = !!extraShifts[model.id] || modelHasVorschichtData(model.id)
                  return (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleVorschicht(model.id) }}
                      title={vorOn ? 'Vorschicht ausblenden (nur wenn leer)' : 'Vorschicht für dieses Model diese Woche zuschalten'}
                      style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, fontWeight: 700,
                        background: vorOn ? 'rgba(59,130,246,0.15)' : 'transparent',
                        color: vorOn ? '#3b82f6' : 'var(--text-muted)',
                        border: `1px solid ${vorOn ? 'rgba(59,130,246,0.45)' : 'var(--border)'}` }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: 2, background: '#3b82f6', flexShrink: 0 }} />
                      {vorOn ? '✓ Vorschicht' : '+ Vorschicht'}
                    </button>
                  )
                })()}
                {isCollapsed && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', fontSize: 10, fontFamily: 'monospace' }}>
                    <span style={{ color: '#10b981' }}>✓ {filledCells}</span>
                    {pending > 0 && <span style={{ color: '#f59e0b' }}>⏳ {pending}</span>}
                    {frei > 0 && <span style={{ color: '#06b6d4' }}>frei {frei}</span>}
                    <span style={{ color: 'var(--text-muted)' }}>· {totalCells - filledCells - frei - pending} offen</span>
                  </div>
                )}
              </div>

              {/* Shifts — nur wenn nicht collapsed */}
              {!isCollapsed && getModelShifts(model.id).map(shift => (
                <div key={shift} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 2, background: SHIFT_COLORS[shift], flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>{shift}</span>
                    {editingShiftTime === `${model.id}__${shift}` ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }} onClick={e => e.stopPropagation()}>
                        <input type="time" value={shiftTimes[`${model.id}__${shift}`]?.split('-')[0]?.trim().replace(' (DE)','') || ''}
                          onChange={e => { const end = shiftTimes[`${model.id}__${shift}`]?.split('-')[1]?.trim().replace(' (DE)','') || ''; setShiftTimes(prev => ({ ...prev, [`${model.id}__${shift}`]: `${e.target.value}-${end}` })) }}
                          style={{ width: 68, background: 'var(--bg-input)', border: '1px solid #7c3aed', color: 'var(--text-primary)', padding: '1px 2px', borderRadius: 3, fontSize: 9, fontFamily: 'monospace', outline: 'none' }} />
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>–</span>
                        <input type="time" value={shiftTimes[`${model.id}__${shift}`]?.split('-')[1]?.trim().replace(' (DE)','') || ''}
                          onChange={e => { const start = shiftTimes[`${model.id}__${shift}`]?.split('-')[0]?.trim().replace(' (DE)','') || ''; setShiftTimes(prev => ({ ...prev, [`${model.id}__${shift}`]: `${start}-${e.target.value}` })) }}
                          onBlur={() => setEditingShiftTime(null)}
                          style={{ width: 68, background: 'var(--bg-input)', border: '1px solid #7c3aed', color: 'var(--text-primary)', padding: '1px 2px', borderRadius: 3, fontSize: 9, fontFamily: 'monospace', outline: 'none' }} />
                      </div>
                    ) : (
                      <span onClick={() => setEditingShiftTime(`${model.id}__${shift}`)} style={{ fontSize: 9, color: shiftTimes[`${model.id}__${shift}`] ? 'var(--text-secondary)' : '#2e2e5a', cursor: 'text', fontFamily: 'monospace' }}>
                        {shiftTimes[`${model.id}__${shift}`] ? `${shiftTimes[`${model.id}__${shift}`].replace(' (DE)','')} DE` : '+Zeit'}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '120px repeat(7, minmax(90px, 1fr))', gap: 4 }}>
                    <div />
                    {weekDays.map((day, di) => {
                      const dayIso = isoDate(day)
                      const cell = getCell(model.id, dayIso, shift)
                      const cellId = getCellKey(model.id, dayIso, shift)
                      const isEditing = editingCell === cellId
                      const hasConflict = conflicts.some(c => c.type === 'unbesetzt' && c.modelId === model.id && c.dayIso === dayIso && c.shift === shift)
                      // v3.1.0: Doppel-Schicht-Check für DIESE Zelle (Chatter hat 2+ Schichten am gleichen Tag)
                      const doppelKey = cell.chatter && cell.chatter !== '__FREI__' ? `${cell.chatter}__${dayIso}` : null
                      const isDoppelSchicht = doppelKey ? doppelSchichtKeys.has(doppelKey) : false
                      const isDoppelAcked = doppelKey ? conflictAcks.has(doppelKey) : false
                      const showDoppelWarn = isDoppelSchicht && !isDoppelAcked
                      const dayOfWeek = day.getDay() === 0 ? 6 : day.getDay() - 1
                      const recurringKey = getRecurringKey(model.id, dayOfWeek, shift)
                      const isRecurring = !!recurring[recurringKey]
                      const isChatterAbsent = cell.chatter ? isAbsent(cell.chatter, dayIso, shift) : false
                      const isFrei = cell.chatter === '__FREI__'
                      const confirmed = cell.confirmed !== false
                      const isPending = cell.chatter && !isFrei && !confirmed

                      // v4.6.0: Farbton je Schicht — Vorschicht blau statt grün/orange
                      const tone = cellTone(shift)
                      const cellBg = isChatterAbsent ? 'rgba(239,68,68,0.08)' : isFrei ? tone.freiBg : isPending ? tone.pendBg : cell.chatter ? tone.takenBg : isToday(day) ? 'rgba(56,130,246,0.04)' : 'var(--bg-card)'
                      const cellBorder = isChatterAbsent ? 'rgba(239,68,68,0.5)' : isFrei ? tone.freiBorder : isPending ? tone.pendBorder : cell.chatter ? tone.takenBorder : isToday(day) ? 'rgba(56,130,246,0.3)' : '#1e1e3a'
                      // Search-Highlight: gelb glühend wenn cell matched
                      const isSearchMatch = cellMatchesSearch(cell)
                      const isTrainee = !!cell.trainee && !isFrei
                      // v4.34.0: Farbe nach Modus — Anlernen cyan, Co orange, Geteilt pink.
                      const zweitModus = zellModus(cell)
                      const zweitFarbe = MODE_META[zweitModus].color
                      // Standardzeit der Zelle — siehe Kommentar im Mobil-Raster.
                      const zweitStandard = (cell.time_override || shiftTimes[`${model.id}__${shift}`] || '').replace(/\s*\(DE\)/g, '')
                      // Zweitchatter-Style: Farbe überlagert Background + Border + Glow
                      // Search hat Vorrang (gelb), aber wenn beides → Border in Modusfarbe + Schatten gelb
                      let finalBg = isTrainee ? `${zweitFarbe}1A` : cellBg
                      let finalBorder = isTrainee ? zweitFarbe : cellBorder
                      let finalBorderWidth = isTrainee ? 2 : 1
                      // v4.6.0: unbestätigte Vorschicht = gestrichelter Rahmen (statt Orange)
                      let finalBorderStyle = (tone.pendDashed && isPending && !isChatterAbsent && !isTrainee) ? 'dashed' : 'solid'
                      // v3.1.0: Doppel-Schicht-Warnung — rote Border + roter Hintergrund. Hat Vorrang vor Trainee-Style.
                      if (showDoppelWarn) {
                        finalBg = 'rgba(239,68,68,0.14)'
                        finalBorder = '#ef4444'
                        finalBorderWidth = 2
                        finalBorderStyle = 'solid'
                      }
                      const searchBoxShadow = isSearchMatch ? '0 0 0 2px #f59e0b, 0 0 12px rgba(245,158,11,0.6)' :
                                              showDoppelWarn ? '0 0 12px rgba(239,68,68,0.5)' :
                                              isTrainee ? `0 0 8px ${zweitFarbe}59` : 'none'

                      // v3.28.1: ausgeschriebene Schicht dezent markieren (leichtes Lila).
                      // Rote Warnungen (Abwesend/Doppel) und die Namens-Suche behalten Vorrang.
                      const swapHere = openSwapMap[`${model.name}__${dayIso}__${shift}`]
                      const showSwap = swapHere && !isChatterAbsent && !showDoppelWarn && !isSearchMatch
                      if (showSwap) {
                        finalBg = 'rgba(167,139,250,0.13)'
                        finalBorder = 'rgba(167,139,250,0.55)'
                        finalBorderStyle = 'solid'
                      }
                      // v4.83.0: leere Zellen leise („+“), rot nur heute/morgen
                      const dringend = !cell.chatter && hasConflict && (dayIso === heuteIso || dayIso === morgenIso)
                      if (dringend && !showSwap) {
                        finalBg = 'rgba(239,68,68,0.05)'
                        finalBorder = 'rgba(239,68,68,0.45)'
                        finalBorderStyle = 'dashed'
                      } else if (!cell.chatter && !showSwap) {
                        finalBorderStyle = 'dashed'
                      }
                      const istGewaehlt = !!editSheet && editSheet.modelId === model.id && editSheet.dayIso === dayIso && editSheet.shift === shift
                      const finalBoxShadow = istGewaehlt ? '0 0 0 2px #7c3aed, 0 0 14px rgba(124,58,237,0.45)' : searchBoxShadow

                      return (
                        <div key={di} onClick={() => setEditSheet({ modelId: model.id, dayIso, shift })}
                          style={{ position: 'relative', background: finalBg, border: `${finalBorderWidth}px ${finalBorderStyle} ${finalBorder}`, borderRadius: 8, padding: 7, minHeight: 70, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3, boxShadow: finalBoxShadow, transition: 'box-shadow 0.2s, background 0.2s' }}>
                          {showSwap && (
                            <div title={swapHere.isAdminOffer ? 'Ausgeschrieben (Admin-Angebot)' : 'Tausch angefragt'} style={{ position: 'absolute', top: -8, left: isTrainee ? 'auto' : 6, right: isTrainee ? 6 : 'auto', fontSize: 8, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: '#a78bfa', color: '#fff', letterSpacing: '0.04em', whiteSpace: 'nowrap', zIndex: 2 }}>
                              {swapHere.isAdminOffer ? '🔄 AUSGESCHRIEBEN' : '↔ TAUSCH'}
                            </div>
                          )}
                          {/* v3.1.0: Doppel-Schicht-Badge — klickbar zum als-gesehen-markieren */}
                          {showDoppelWarn && (
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleConflictAck(doppelKey) }}
                              title={`${cell.chatter} hat mehrere Schichten an diesem Tag — Klick zum Bestätigen`}
                              style={{
                                position: 'absolute', top: -8, right: 6, fontSize: 9, fontWeight: 700,
                                padding: '2px 7px', borderRadius: 3, background: '#ef4444', color: '#fff',
                                letterSpacing: '0.04em', zIndex: 3, border: 'none', cursor: 'pointer',
                                fontFamily: 'inherit', boxShadow: '0 2px 6px rgba(239,68,68,0.4)',
                              }}
                            >⚠ DOPPEL · ✓ gesehen</button>
                          )}
                          {isTrainee && (
                            <div style={{ position: 'absolute', top: -8, left: 6, fontSize: 8, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: zweitFarbe, color: '#fff', letterSpacing: '0.04em', zIndex: 2 }}>
                              {MODE_META[zweitModus].icon} {MODE_META[zweitModus].label.toUpperCase()}
                            </div>
                          )}
                          {cell.chatter ? (
                            <div style={{ flex: 1 }}>
                              {isFrei ? (
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontSize: 12, fontWeight: 700, color: tone.freiText }}>Freischicht</span>
                                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: tone.okChipBg, color: tone.okChipText }}>✓</span>
                                </div>
                              ) : (
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{cell.chatter}</span>
                                  {/* v4.34.0: bei geteilter Schicht die Spanne des Hauptchatters direkt darunter */}
                                  {zweitModus === 'split' && splitSpanne(cell, 'a', zweitStandard) && (
                                    <span style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 700, color: zweitFarbe }}>{splitSpanne(cell, 'a', zweitStandard)}</span>
                                  )}
                                  {isTrainee && (
                                    <span style={{ fontSize: 10, color: zweitFarbe, fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 3, minWidth: 0 }}>
                                      <span style={{ fontSize: 9 }}>{MODE_META[zweitModus].icon}</span>
                                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cell.trainee}</span>
                                    </span>
                                  )}
                                  {zweitModus === 'split' && splitSpanne(cell, 'b', zweitStandard) && (
                                    <span style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 700, color: zweitFarbe }}>{splitSpanne(cell, 'b', zweitStandard)}</span>
                                  )}
                                </div>
                                <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
                                  background: isPending ? tone.pendChipBg : tone.okChipBg,
                                  color: isPending ? tone.pendChipText : tone.okChipText }}>
                                  {isPending ? '! Klarung' : 'v'}
                                </span>
                              </div>
                              )}
                              {!isFrei && cell.time_override && (
                                <div style={{ fontSize: 9, color: '#f97316', marginTop: 2, fontFamily: 'monospace', fontWeight: 700 }}>⚠ {cell.time_override}</div>
                              )}
                              {!isFrei && cell.note && <div style={{ fontSize: 9, color: '#f59e0b', marginTop: 2, lineHeight: 1.3 }}>{cell.note}</div>}
                              {!isFrei && (
                              <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                                {isRecurring && <span style={{ fontSize: 8, color: '#a78bfa' }}>↻</span>}
                                {activeReminders[`${cell.chatter}__${dayIso}__${shift}`] && <span style={{ fontSize: 8, color: '#06b6d4' }}>R</span>}
                              </div>
                              )}
                            </div>
                          ) : (
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {(!cell.chatter && hasConflict && (dayIso === heuteIso || dayIso === morgenIso))
                                ? <span style={{ fontSize: 11.5, fontWeight: 700, color: '#fca5a5' }}>offen</span>
                                : <span style={{ fontSize: 18, color: dayIso < heuteIso ? '#1e1e3a' : '#3e3e6a' }}>+</span>}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
      </>
      )}

      {/* v4.83.0: Schicht belegen — Handy: Fenster von unten, Desktop: Seitenleiste */}
      {editSheet && (() => {
        const { modelId, dayIso, shift } = editSheet
        const cell = getCell(modelId, dayIso, shift)
        const day = new Date(dayIso + 'T00:00:00')
        const dayOfWeek = day.getDay() === 0 ? 6 : day.getDay() - 1
        const isRecurring = !!recurring[getRecurringKey(modelId, dayOfWeek, shift)]
        const model = models.find(m => m.id === modelId)
        if (!model) return null
        return (
          <SchichtFenster
            art={isMobile ? 'sheet' : 'panel'}
            model={model} dayIso={dayIso} shift={shift} schichtFarbe={SHIFT_COLORS[shift]}
            standardZeit={(shiftTimes[`${modelId}__${shift}`] || '').replace(/\s*\(DE\)/g, '')}
            cell={cell}
            personen={personenFuer(modelId, dayIso, shift)}
            admins={admins}
            MODE_META={MODE_META} zellModus={zellModus}
            isRecurring={isRecurring}
            onRecurring={async (an) => {
              if (an && cell.chatter) await saveRecurring(modelId, dayOfWeek, shift, cell)
              else await saveRecurring(modelId, dayOfWeek, shift, { chatter: '' })
            }}
            onChatter={(name) => setChatter(modelId, dayIso, shift, cell, name)}
            onCell={(neu) => setCell(modelId, dayIso, shift, neu)}
            onModus={(m) => setModus(modelId, dayIso, shift, cell, m)}
            onLeeren={() => {
              if (cell.trainee && !window.confirm(`In dieser Schicht steht „${cell.trainee}" als zweite Person — beide entfernen?`)) return
              setCell(modelId, dayIso, shift, { chatter: '', note: '', confirmed: true })
              setEditSheet(null)
            }}
            onAusschreiben={() => { setEditSheet(null); setBlockOffer({ dayIso, shift, presetModelId: modelId }) }}
            reminderAktiv={!!activeReminders[`${cell.chatter}__${dayIso}__${shift}`]}
            onReminder={(h) => sendReminder(modelId, dayIso, shift, cell.chatter, h)}
            sendingReminder={sendingReminder}
            swapHier={openSwapMap[`${model.name}__${dayIso}__${shift}`]}
            onZu={() => setEditSheet(null)}
            andereModels={models.filter(m => m.id !== modelId).map(m => ({ id: m.id, name: m.name, belegt: getCell(m.id, dayIso, shift).chatter || '' }))}
            onUebernehmen={(ids) => uebernehmeBelegung(modelId, dayIso, shift, ids)}
          />
        )
      })()}

      <div ref={konfliktRef} style={{ scrollMarginTop: 80 }} />
      {/* Conflicts below – v3.75.0: nach Typ gruppiert, jede Gruppe einzeln aufklappbar */}
      {hasSavedData && conflicts.length > 0 && (() => {
        // v3.76.0: unbesetzte Schichten, die bereits ausgeschrieben sind (Block-Angebot/Tausch),
        // gelten nicht als offenes "Unbesetzt"-Problem, sondern kommen in die Gruppe "Ausgeschrieben".
        const allUnbesetzt = conflicts.filter(c => c.type === 'unbesetzt')
        const isAusgeschrieben = c => !!openSwapMap[`${c.modelName}__${c.dayIso}__${c.shift}`]
        const ausgeschriebenList = allUnbesetzt.filter(isAusgeschrieben)
        const unbesetztList = allUnbesetzt.filter(c => !isAusgeschrieben(c))
        const doppelList = conflicts.filter(c => c.type === 'doppel_schicht')
        // Doppelschichten: noch offene (nicht quittierte) zuerst
        const doppelSorted = [...doppelList].sort((a, b) => (a.acked === b.acked ? 0 : a.acked ? 1 : -1))
        // v3.76.1: Zähler = Anzahl Einträge in der Gruppe (g.items.length) — identisch oben (Chip)
        // und unten (Gruppen-Header), damit es keine abweichenden Zahlen mehr gibt.
        const groups = [
          { key: 'unbesetzt', label: 'Unbesetzt', items: unbesetztList, accent: '#f59e0b' },
          { key: 'ausgeschrieben', label: 'Ausgeschrieben', items: ausgeschriebenList, accent: '#a78bfa' },
          { key: 'doppel', label: 'Doppelschicht', items: doppelSorted, accent: '#ec4899' },
        ].filter(g => g.items.length > 0)
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Zusammenfassung – Zähler auf einen Blick, ohne aufklappen zu müssen */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>⚠ Konflikte</span>
              {groups.map(g => (
                <span key={g.key} style={{ fontSize: 11, fontWeight: 700, color: g.accent, background: `${g.accent}22`, padding: '2px 10px', borderRadius: 10 }}>
                  {g.items.length} {g.label}
                </span>
              ))}
            </div>
            {/* Gruppen – standardmäßig zugeklappt, öffnen nur was gebraucht wird */}
            {groups.map(g => {
              const isOpen = !!openConflictGroups[g.key]
              return (
                <div key={g.key} style={{ border: `1px solid ${g.accent}55`, borderRadius: 10, overflow: 'hidden' }}>
                  <div onClick={() => setOpenConflictGroups(prev => ({ ...prev, [g.key]: !prev[g.key] }))}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: `${g.accent}18`, cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: g.accent }}>{g.label}</span>
                      <span style={{ fontSize: 10, background: `${g.accent}30`, color: g.accent, padding: '1px 8px', borderRadius: 10, fontWeight: 700 }}>{g.items.length}</span>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{isOpen ? '▲ zuklappen' : '▼ aufklappen'}</span>
                  </div>
                  {isOpen && (
                    <div style={{ padding: '8px 12px', background: `${g.accent}0a`, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {g.items.map((c, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '4px 6px', borderRadius: 6, opacity: c.acked ? 0.55 : 1 }}>
                          <span style={{ color: 'var(--text-secondary)' }}>{c.msg}</span>
                          {g.key === 'unbesetzt' && (
                            <button onClick={() => setBlockOffer({ dayIso: c.dayIso, shift: c.shift, presetModelId: c.modelId })}
                              title="Schicht zum Tausch ausschreiben — gleiches Block-Angebot wie im Dienstplan"
                              style={{ flexShrink: 0, background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.4)', color: '#a78bfa', borderRadius: 6, padding: '2px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                              🔄 Ausschreiben
                            </button>
                          )}
                          {g.key === 'doppel' && (
                            <button onClick={() => toggleConflictAck(c.conflictKey)}
                              style={{ flexShrink: 0, background: c.acked ? 'rgba(16,185,129,0.15)' : 'transparent', border: `1px solid ${c.acked ? 'rgba(16,185,129,0.4)' : 'var(--border-bright)'}`, color: c.acked ? '#10b981' : 'var(--text-muted)', borderRadius: 6, padding: '2px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                              {c.acked ? '✓ gesehen' : 'als gesehen'}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })()}
      {hasSavedData && conflicts.length === 0 && Object.keys(schedule).length > 0 && (
        <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 10, padding: '10px 16px', fontSize: 12, color: '#10b981', fontWeight: 600 }}>
          ✓ Keine Konflikte – Plan ist vollständig
        </div>
      )}

      <div ref={abwesendRef} style={{ scrollMarginTop: 80 }} />
      {/* Absence Panel */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <div onClick={() => setShowAbsences(!showAbsences)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', cursor: 'pointer', background: 'var(--bg-card2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>🚫 Abwesenheiten</span>
            {absences.filter(a => a.date_to >= todayBerlin()).length > 0 && <span style={{ fontSize: 10, background: 'rgba(239,68,68,0.15)', color: '#ef4444', padding: '1px 7px', borderRadius: 10, fontWeight: 700 }}>{absences.filter(a => a.date_to >= todayBerlin()).length}</span>}
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{showAbsences ? '▲' : '▼'}</span>
        </div>
        {showAbsences && (
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Chatter</label>
                <select value={newAbsenceName} onChange={e => setNewAbsenceName(e.target.value)}
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border-bright)', color: 'var(--text-primary)', padding: '6px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}>
                  <option value="">— wählen —</option>
                  {chatters.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Von</label>
                <input type="date" value={newAbsenceFrom} onChange={e => setNewAbsenceFrom(e.target.value)}
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border-bright)', color: 'var(--text-primary)', padding: '6px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'monospace', outline: 'none' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Bis</label>
                <input type="date" value={newAbsenceTo} onChange={e => setNewAbsenceTo(e.target.value)}
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border-bright)', color: 'var(--text-primary)', padding: '6px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'monospace', outline: 'none' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 120 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Grund (optional)</label>
                <input value={newAbsenceReason} onChange={e => setNewAbsenceReason(e.target.value)}
                  placeholder="z.B. Urlaub, Krank..."
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border-bright)', color: 'var(--text-primary)', padding: '6px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Weg an Schichten (nichts = ganzer Tag)</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button type="button" onClick={() => setNewAbsenceShifts([])}
                    style={{ padding: '6px 9px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                      background: newAbsenceShifts.length === 0 ? 'rgba(239,68,68,0.15)' : 'var(--bg-input)',
                      color: newAbsenceShifts.length === 0 ? '#ef4444' : 'var(--text-muted)',
                      border: `1px solid ${newAbsenceShifts.length === 0 ? 'rgba(239,68,68,0.4)' : 'var(--border)'}` }}>Ganzer Tag</button>
                  {ALL_SHIFTS.map(s => {
                    const on = newAbsenceShifts.includes(s)
                    return (
                      <button key={s} type="button"
                        onClick={() => setNewAbsenceShifts(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])}
                        style={{ padding: '6px 9px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                          background: on ? 'rgba(239,68,68,0.18)' : 'var(--bg-input)',
                          color: on ? '#ef4444' : 'var(--text-muted)',
                          border: `1px solid ${on ? 'rgba(239,68,68,0.45)' : 'var(--border)'}` }}>{on ? '✕ ' : ''}{s}</button>
                    )
                  })}
                </div>
              </div>
              <button onClick={addAbsence} disabled={!newAbsenceName || !newAbsenceFrom || !newAbsenceTo}
                style={{ background: newAbsenceName && newAbsenceFrom && newAbsenceTo ? '#ef4444' : 'var(--border)', color: newAbsenceName && newAbsenceFrom && newAbsenceTo ? '#fff' : 'var(--text-muted)', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                + Eintragen
              </button>
            </div>
            {absences.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Keine Abwesenheiten eingetragen</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(() => {
                  const today = todayBerlin()
                  const active = absences.filter(a => a.date_to >= today)
                  const expired = absences.filter(a => a.date_to < today)
                  const visible = showExpiredAbsences ? absences : active

                  // Einzelne Abwesenheits-Zeile (wiederverwendet in jeder KW-Gruppe)
                  const renderRow = (a) => {
                    const isExpired = a.date_to < today
                    return (
                      <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-card2)', borderRadius: 8, borderLeft: `3px solid ${isExpired ? '#6b7280' : '#ef4444'}`, opacity: isExpired ? 0.6 : 1 }}>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: isExpired ? 'var(--text-muted)' : '#ef4444' }}>{a.chatter_name}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                            {new Date(a.date_from + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} – {new Date(a.date_to + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
                          </span>
                          {isExpired && <span style={{ fontSize: 10, color: '#6b7280', background: 'rgba(107,114,128,0.15)', padding: '1px 7px', borderRadius: 4 }}>Abgelaufen</span>}
                          <span style={{ fontSize: 10, color: (!a.available_shifts || a.available_shifts.length === 0) ? '#ef4444' : '#10b981', background: (!a.available_shifts || a.available_shifts.length === 0) ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>{absenceScopeLabel(a)}</span>
                          {a.reason && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{a.reason}</span>}
                        </div>
                        <button onClick={() => deleteAbsence(a.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}
                          onMouseEnter={e => e.target.style.color = '#ef4444'}
                          onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
                      </div>
                    )
                  }

                  // v3.77.0: nach Kalenderwoche gruppieren. Laufende Abwesenheiten (schon gestartet,
                  // enden aber heute/später) landen in der aktuellen Woche; sonst nach Startdatum.
                  const currentWeekIso = isoDate(getWeekStart(new Date(today + 'T00:00:00')))
                  const weekMap = {}
                  for (const a of visible) {
                    const anchor = (a.date_to >= today && a.date_from < today) ? today : a.date_from
                    const ws = getWeekStart(new Date(anchor + 'T00:00:00'))
                    const wIso = isoDate(ws)
                    if (!weekMap[wIso]) {
                      const we = new Date(ws); we.setDate(we.getDate() + 6)
                      weekMap[wIso] = { ws, we, kw: getKW(ws), items: [] }
                    }
                    weekMap[wIso].items.push(a)
                  }
                  const weekKeys = Object.keys(weekMap).sort()
                  for (const k of weekKeys) weekMap[k].items.sort((x, y) => x.date_from.localeCompare(y.date_from))

                  return (
                    <>
                      {weekKeys.map(wIso => {
                        const g = weekMap[wIso]
                        const isCurrent = wIso === currentWeekIso
                        const isOpen = wIso in openAbsenceWeeks ? openAbsenceWeeks[wIso] : isCurrent
                        return (
                          <div key={wIso} style={{ border: `1px solid ${isCurrent ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`, borderRadius: 9, overflow: 'hidden' }}>
                            <div onClick={() => setOpenAbsenceWeeks(prev => ({ ...prev, [wIso]: !(wIso in prev ? prev[wIso] : isCurrent) }))}
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', background: isCurrent ? 'rgba(239,68,68,0.08)' : 'var(--bg-card2)', cursor: 'pointer' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 12, fontWeight: 700, color: isCurrent ? '#ef4444' : 'var(--text-primary)' }}>KW {g.kw}</span>
                                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{formatDate(g.ws)} – {formatDate(g.we)}</span>
                                {isCurrent && <span style={{ fontSize: 9, fontWeight: 700, color: '#ef4444', background: 'rgba(239,68,68,0.15)', padding: '1px 7px', borderRadius: 10 }}>diese Woche</span>}
                                <span style={{ fontSize: 10, background: 'var(--bg-input)', color: 'var(--text-muted)', padding: '1px 8px', borderRadius: 10, fontWeight: 700 }}>{g.items.length}</span>
                              </div>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{isOpen ? '▲' : '▼'}</span>
                            </div>
                            {isOpen && (
                              <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {g.items.map(renderRow)}
                              </div>
                            )}
                          </div>
                        )
                      })}
                      {expired.length > 0 && (
                        <button onClick={() => setShowExpiredAbsences(!showExpiredAbsences)}
                          style={{ background: 'transparent', border: '1px dashed #2e2e5a', color: 'var(--text-muted)', borderRadius: 7, padding: '5px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', marginTop: 2 }}>
                          {showExpiredAbsences ? '▲ Abgelaufene ausblenden' : `▼ ${expired.length} abgelaufene anzeigen`}
                        </button>
                      )}
                    </>
                  )
                })()}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Legend + Recurring + Next week */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--text-secondary)', flexWrap: 'wrap', alignItems: 'center' }}>
          {ALL_SHIFTS.map(s => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: SHIFT_COLORS[s] }} />{s}
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ color: '#a78bfa', fontSize: 12 }}>↻</span> Wiederkehrend
          </div>
          <span style={{ color: 'var(--text-muted)' }}>· Zelle antippen zum Belegen</span>
        </div>
        {/* v4.83.0: „Als Vorlage …“ liegt jetzt unter ⋯ Mehr */}
      </div>

      {/* v3.1.0: Send-Modal mit Checkbox-Auswahl der Chatter */}
      {sendModalOpen && (
        <div onClick={() => !sending && setSendModalOpen(false)} style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
            width: '100%', maxWidth: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Dienstplan versenden</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                KW {kw} ({formatDate(weekDays[0])} – {formatDate(weekDays[6])}) · An wen?
              </div>
            </div>

            {/* Aktions-Buttons oben: Alle / Keine */}
            <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {sendSelection.size} von {chatters.filter(empfangsbereit).length} ausgewählt
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setSendSelection(new Set(chatters.filter(empfangsbereit).map(c => c.id)))} style={{
                  background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
                  fontSize: 10, padding: '4px 9px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
                }}>Alle</button>
                <button onClick={() => setSendSelection(new Set())} style={{
                  background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
                  fontSize: 10, padding: '4px 9px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
                }}>Keine</button>
              </div>
            </div>

            {/* Chatter-Liste mit Checkbox */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
              {chatters.map(chatter => {
                const hasTg = !!chatter.telegram_id
                const isSelected = sendSelection.has(chatter.id)
                const shiftCount = zaehleSchichten(chatter.name)
                // v4.16.0: Ohne Schicht gibt es nichts zu senden — die Zeile wird
                // gesperrt statt beim Senden stillschweigend übersprungen.
                const kannEmpfangen = hasTg && shiftCount > 0
                return (
                  <label key={chatter.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 20px',
                    cursor: kannEmpfangen ? 'pointer' : 'not-allowed',
                    opacity: kannEmpfangen ? 1 : 0.4,
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                  }}>
                    <input
                      type="checkbox"
                      disabled={!kannEmpfangen}
                      checked={isSelected}
                      onChange={e => {
                        const next = new Set(sendSelection)
                        if (e.target.checked) next.add(chatter.id)
                        else next.delete(chatter.id)
                        setSendSelection(next)
                      }}
                      style={{ width: 16, height: 16, accentColor: '#06b6d4' }}
                    />
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {chatter.name}
                        {!hasTg && <span style={{ fontSize: 10, color: '#ef4444', marginLeft: 8 }}>· Keine Telegram-ID</span>}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {shiftCount === 0 ? 'Keine Schichten diese Woche' : `${shiftCount} Schicht${shiftCount !== 1 ? 'en' : ''} diese Woche`}
                      </div>
                    </div>
                    {/* v4.16.2: Nur bei Leuten, die ohnehin nichts bekommen können */}
                    {!kannEmpfangen && (
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); chatterAusblenden(chatter) }}
                        title="Aus allen Chatter-Listen ausblenden"
                        style={{
                          flexShrink: 0, fontSize: 10, padding: '4px 9px', borderRadius: 5,
                          background: 'transparent', border: '1px solid rgba(239,68,68,0.3)',
                          color: 'rgba(239,68,68,0.75)', cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >Ausblenden</button>
                    )}
                  </label>
                )
              })}
            </div>

            {/* Action-Buttons unten */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => !sending && setSendModalOpen(false)} disabled={sending} style={{
                background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
                fontSize: 12, padding: '8px 14px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
              }}>Abbrechen</button>
              <button onClick={sendPlanToSelected} disabled={sending || sendSelection.size === 0} style={{
                background: sendSelection.size === 0 ? 'var(--border)' : '#06b6d4',
                border: 'none', color: '#fff', fontSize: 12, fontWeight: 700,
                padding: '8px 16px', borderRadius: 7,
                cursor: (sending || sendSelection.size === 0) ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              }}>{sending ? 'Sende...' : `✈ An ${sendSelection.size} senden`}</button>
            </div>
          </div>
        </div>
      )}

      {/* v3.15.0: Versand-Verlauf Modal */}
      {logModalOpen && (
        <div onClick={() => { setLogModalOpen(false); setLogExpandedId(null) }} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
          zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
            maxWidth: 720, width: '100%', maxHeight: '85vh', overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
          }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Versand-Verlauf</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Letzte 50 Sendungen (neueste zuerst)</div>
              </div>
              <button onClick={() => { setLogModalOpen(false); setLogExpandedId(null) }} style={{
                background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', padding: 0,
              }}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: 12 }}>
              {logLoading ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: 30 }}>Lade…</div>
              ) : sendLog.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: 30, lineHeight: 1.6 }}>
                  Noch keine Sendungen geloggt.<br />
                  <span style={{ fontSize: 10, opacity: 0.7 }}>
                    Sobald jemand den Plan via Telegram verschickt, erscheint der Eintrag hier.
                  </span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {sendLog.map(log => {
                    const isExpanded = logExpandedId === log.id
                    const dt = new Date(log.sent_at)
                    const dateStr = dt.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
                    const timeStr = dt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
                    const typeLabel = log.action_type === 'plan_full' ? 'Plan an alle'
                      : log.action_type === 'plan_partial' ? 'Plan (Auswahl)'
                      : log.action_type === 'update' ? 'Update'
                      : 'Sendung'
                    const typeColor = log.action_type === 'plan_full' ? '#06b6d4'
                      : log.action_type === 'plan_partial' ? '#a78bfa'
                      : log.action_type === 'update' ? '#f59e0b'
                      : '#64748b'
                    return (
                      <div key={log.id} style={{
                        border: '1px solid var(--border)', borderRadius: 7,
                        background: isExpanded ? 'var(--bg-card2)' : 'transparent',
                      }}>
                        <div onClick={() => setLogExpandedId(isExpanded ? null : log.id)} style={{
                          padding: '8px 12px', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                        }}>
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                            background: `${typeColor}18`, color: typeColor, whiteSpace: 'nowrap',
                          }}>{typeLabel}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                            {dateStr} · {timeStr}
                          </span>
                          {log.kw && (
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>KW {log.kw}</span>
                          )}
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            an {log.recipients_count} {log.recipients_count === 1 ? 'Person' : 'Personen'}
                            {log.recipients_skipped > 0 && (
                              <span style={{ color: '#f59e0b' }}> · {log.recipients_skipped} ohne TG</span>
                            )}
                          </span>
                          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>
                            {log.sent_by}
                          </span>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{isExpanded ? '▲' : '▼'}</span>
                        </div>
                        {isExpanded && (
                          <div style={{ padding: '0 12px 12px', borderTop: '1px solid var(--border)' }}>
                            {log.recipient_names && log.recipient_names.length > 0 && (
                              <div style={{ marginTop: 10 }}>
                                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: 4 }}>
                                  Empfänger ({log.recipient_names.length})
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                                  {log.recipient_names.join(', ')}
                                </div>
                              </div>
                            )}
                            {log.message_text && (
                              <div style={{ marginTop: 12 }}>
                                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: 4 }}>
                                  Nachricht (Vorschau)
                                </div>
                                <pre style={{
                                  fontSize: 11, color: 'var(--text-primary)',
                                  background: 'var(--bg-card)', padding: '8px 10px',
                                  borderRadius: 5, border: '1px solid var(--border)',
                                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                  fontFamily: 'inherit', margin: 0, maxHeight: 240, overflowY: 'auto',
                                }}>{log.message_text}</pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <button onClick={loadSendLog} disabled={logLoading} style={{
                background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
                fontSize: 11, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
              }}>↻ Aktualisieren</button>
              <button onClick={() => { setLogModalOpen(false); setLogExpandedId(null) }} style={{
                background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
                fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
              }}>Schließen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
