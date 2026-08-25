import React, { useState, useEffect } from 'react'
import { BookOpen, Library } from 'lucide-react'
import { supabase } from '../supabase'
import { formatMoney, pctChange, getLast7Snapshots } from '../utils'
import SocialTab from './SocialTab'
import SurveyModal from './SurveyModal'
import SwapModal from './SwapModal'
import ChatterBell from './ChatterBell'
import ChatterChat from './ChatterChat'
import MessageSuggestions from './MessageSuggestions'
import { getTheme, setTheme } from '../theme'
import { sendTelegramMessage, notifyAdmins, sendeSchichtuebergabe } from '../telegram'
import { APP_VERSION } from '../version'
import { SocialLinksView, SOCIAL_CATEGORY } from './SocialLinks'
import { convertHeicIfNeeded } from '../imageUtils'
import { useFabPanels } from '../fabPanel'
import Logo from './Logo'
import { HelpProvider, HelpDot, HelpSheet } from './Help'
import HelpTour from './HelpTour'
import HelpFab from './HelpFab'
import { HELP_TOPICS, TOUR_IDS } from '../help/chatterHelp'

const CHRIS_TG = '1538601588'
const REY_TG = '528328429'

// v3.50.0: Content-Typen inkl. Live-Leistungen (Videocall/Telefonat).
// WICHTIG: Der Key 'audio' bleibt erhalten (Bestandsdaten!) und heißt jetzt nur "Sprachnachricht".
// 'sonstiges' bleibt als Auffang-Typ. Felder werden je nach Typ ein-/ausgeblendet.
const CONTENT_TYPE_META = {
  videocall: { label: 'Videocall',       live: true,  showImages: false, showOutfit: true,  showQuantity: false, durLabel: 'Dauer',          durPlaceholder: 'z.B. 15 Min' },
  telefonat: { label: 'Telefonat',       live: true,  showImages: false, showOutfit: false, showQuantity: false, durLabel: 'Dauer',          durPlaceholder: 'z.B. 15 Min' },
  video:     { label: 'Video',           live: false, showImages: true,  showOutfit: true,  showQuantity: true,  durLabel: 'Länge / Anzahl', durPlaceholder: '5 Min' },
  audio:     { label: 'Sprachnachricht', live: false, showImages: false, showOutfit: false, showQuantity: true,  durLabel: 'Länge / Anzahl', durPlaceholder: '2 Min' },
  bild:      { label: 'Bild',            live: false, showImages: true,  showOutfit: true,  showQuantity: true,  durLabel: 'Anzahl',         durPlaceholder: '' },
  sonstiges: { label: 'Sonstiges',       live: false, showImages: true,  showOutfit: true,  showQuantity: true,  durLabel: 'Länge / Anzahl', durPlaceholder: '' },
}
// Label-Helfer (fällt auf den rohen Key zurück, falls ein alter/unbekannter Typ auftaucht)
const contentTypeLabel = (t) => (CONTENT_TYPE_META[t]?.label || t || '')
// v3.38.0: Prioritäts-Styles für "Meine Aufgaben"
const TODO_PRIORITY = {
  wichtig: { label: 'Wichtig', color: '#ef4444' },
  normal: { label: 'Normal', color: '#f59e0b' },
  niedrig: { label: 'Niedrig', color: '#06b6d4' },
}

const ADMIN_TZ = 'Europe/Berlin'
// v3.25.1: Lokale Zeitzone des Browsers (z.B. Asia/Bangkok bei Chattern im Ausland)
const LOCAL_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ADMIN_TZ } catch { return ADMIN_TZ } })()

function getTimezoneOffset(dateStr, tz) {
  try {
    const d = new Date(dateStr)
    const utcMs = d.getTime()
    const tzMs = new Date(d.toLocaleString('en-US', { timeZone: tz })).getTime()
    return Math.round((tzMs - utcMs) / 60000)
  } catch { return 0 }
}

// v3.25.1: Laufzeit-unabhängiger UTC-Offset (Minuten) einer Instant in einer Zeitzone.
// Nutzt Intl.formatToParts + Date.UTC, daher korrekt egal in welcher TZ der Browser läuft.
function tzOffsetMinutes(instant, tz) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    const p = Object.fromEntries(dtf.formatToParts(instant).map(x => [x.type, x.value]))
    return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second) - instant.getTime()) / 60000)
  } catch { return 0 }
}

// v3.25.1: Berliner Wanduhr (Plandatum + Stunde:Minute) -> echter UTC-Zeitpunkt
function berlinWallToInstant(dayIso, h, m) {
  const [y, mo, d] = (dayIso || '').split('-').map(Number)
  if (!y || !mo || !d) return null
  const naive = Date.UTC(y, mo - 1, d, h || 0, m || 0, 0)
  let inst = new Date(naive)
  for (let i = 0; i < 2; i++) inst = new Date(naive - tzOffsetMinutes(inst, ADMIN_TZ) * 60000)
  return inst
}

// v3.25.1: Reale Start/End-Instants einer Schicht aus Berlin-Plandatum + DE-Zeit ("HH:MM-HH:MM").
// Korrekt über Mitternacht und für jede Zeitzone -> Basis für zeitzonen-sicheren Check-in.
function shiftWindowInstants(dayIso, deTimeStr) {
  if (!dayIso || !deTimeStr) return null
  const [a, b] = deTimeStr.split('-').map(t => t && t.trim())
  if (!a || !b) return null
  const [sh, sm] = a.split(':').map(Number)
  const [eh, em] = b.split(':').map(Number)
  if (isNaN(sh) || isNaN(eh)) return null
  const start = berlinWallToInstant(dayIso, sh, sm)
  let end = berlinWallToInstant(dayIso, eh, em)
  if (!start || !end) return null
  if ((eh * 60 + (em || 0)) <= (sh * 60 + (sm || 0))) end = new Date(end.getTime() + 86400000)
  return { start, end }
}

function convertTimeToLocal(timeStr) {
  if (!timeStr) return timeStr
  const parts = timeStr.split('-').map(t => t.trim())
  const now = new Date()
  const converted = parts.map(t => {
    const [h, m] = t.split(':').map(Number)
    if (isNaN(h)) return t
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(h).padStart(2,'0')}:${String(m||0).padStart(2,'0')}:00`
    const berlinOffset = getTimezoneOffset(dateStr, ADMIN_TZ)
    const localOffset = getTimezoneOffset(dateStr, Intl.DateTimeFormat().resolvedOptions().timeZone)
    const diffMins = localOffset - berlinOffset
    const totalMins = h * 60 + (m || 0) + diffMins
    const localH = ((Math.floor(totalMins / 60) % 24) + 24) % 24
    const localM = ((totalMins % 60) + 60) % 60
    return `${String(localH).padStart(2,'0')}:${String(localM).padStart(2,'0')}`
  })
  return converted.join('-')
}

// v3.74.0: 'Vorschicht' (optionale Schicht vor der Früh) mit aufgenommen, damit Chatter
// ihre Vorschicht-Zuweisungen sehen und einchecken können. Die Schicht wird nur sichtbar,
// wenn im Dienstplan tatsächlich eine Vorschicht-Zuweisung existiert.
const SHIFTS = ['Vorschicht', 'Früh', 'Spät', 'Nacht']
const SHIFT_COLORS = { 'Vorschicht': '#3b82f6', 'Früh': '#10b981', 'Spät': '#f59e0b', 'Nacht': '#7c3aed' }
const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

// ── v4.34.0: geteilte Schicht ────────────────────────────────────────────────
// Der Dienstplan kennt neben 'anlernen' und 'co' jetzt den Modus 'split': zwei
// Leute teilen sich eine Schicht, jeder mit eigenem Abschnitt (split_a_* für den
// Hauptchatter, split_b_* für den zweiten). Beide Spannen sind optional.
const MODUS_META = {
  anlernen: { icon: '🎓', label: 'Anlernen', color: '#06b6d4' },
  co: { icon: '👥', label: 'Co', color: '#f59e0b' },
  split: { icon: '✂️', label: 'Geteilt', color: '#ec4899' },
}
const zellModus = (val) => (MODUS_META[val?.trainee_mode] ? val.trainee_mode : 'anlernen')

// v4.36.0: Namensvergleich wie im Telegram-Bot und in `handover-notify` — alles
// außer Buchstaben und Ziffern raus. Daran hängt, wem eine Schichtübergabe
// angezeigt wird; ein Bindestrich oder ein doppeltes Leerzeichen zwischen
// Plan-Name und `display_name` darf darüber nicht entscheiden.
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
// Zeitspanne aus Sicht EINER Person. Bindestrich-Format, weil der Rest der Datei
// (shiftWindowInstants, convertTimeToLocal) daran entlang parst.
// Ohne eigene Spanne fällt es auf die normale Schichtzeit zurück.
function meineSpanne(val, standardZeit, binIchZweit) {
  if (zellModus(val) !== 'split') return standardZeit
  const seite = binIchZweit ? 'b' : 'a'
  const von = val?.[`split_${seite}_von`] || ''
  const bis = val?.[`split_${seite}_bis`] || ''
  // Gleiche Zeit für Beginn und Ende ist eine Fehleingabe — als Fenster wäre sie
  // null Minuten lang und der Auto-Checkout griffe eine Minute nach Schichtbeginn.
  if (von && bis && von === bis) return standardZeit
  if (!von || !bis) {
    // Nur eine Hälfte eingetragen: die andere kommt aus der normalen Schichtzeit.
    // Taugt die nicht als Spanne (leer, kein Bindestrich, Freitext wie „20"),
    // bleibt es bei der Schichtzeit. Sonst entstünde „12:00-12:00" — ein Fenster
    // der Länge null, das den Auto-Checkout eine Minute nach Schichtbeginn
    // auslösen würde.
    const teile = (standardZeit || '').split('-').map(t => t.trim()).filter(Boolean)
    if (teile.length < 2) return standardZeit
    return `${von || teile[0]}-${bis || teile[1]}`
  }
  return `${von}-${bis}`
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
function getWeekStart(date) {
  const d = berlinDate(date || new Date())
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}
function getWeekDays(weekStart) {
  if (!weekStart) return []
  const base = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate())
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base)
    d.setDate(d.getDate() + i)
    return d
  })
}
function isToday(date) { return isoDate(date) === todayBerlin() }
function formatDate(date) { return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) }

function getKW(date) {
  const d = new Date(date)
  const onejan = new Date(d.getFullYear(), 0, 1)
  return Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7)
}

function SwapRequestForm({ displayName, myNext7Shifts }) {
  const [swapShift, setSwapShift] = useState('')
  const [swapReason, setSwapReason] = useState('')
  const [sending, setSending] = useState(false)
  const [mySwaps, setMySwaps] = useState([])

  const loadMySwaps = async () => {
    if (!displayName) return
    // v4.22.0: 'abgelaufen' ist für den Chatter kein Ergebnis, sondern Rauschen —
    // die Schicht hat begonnen und bleibt bei ihm. Für Admins bleibt der Eintrag
    // unter „Schicht-Anfragen" sichtbar, damit die Historie vollständig ist.
    const { data } = await supabase.from('shift_swaps').select('*')
      .eq('requester_name', displayName)
      .neq('status', 'abgelaufen')
      .order('shift_date', { ascending: true })
      .limit(10)
    setMySwaps(data || [])
  }

  useEffect(() => {
    loadMySwaps()
  }, [])

  const submitSwap = async () => {
    if (!swapShift) return
    setSending(true)
    const parts = swapShift.split('__')
    await supabase.from('shift_swaps').insert({
      requester_name: displayName,
      shift_date: parts[0],
      shift: parts[1],
      model_name: parts[2] || '?',
      reason: swapReason || null,
      status: 'offen',
    })
    setSwapShift('')
    setSwapReason('')
    await loadMySwaps()
    setSending(false)
    alert('✓ Tausch-Anfrage gesendet!')
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <select value={swapShift} onChange={e => setSwapShift(e.target.value)}
          style={{ flex: 1, minWidth: 160, background: 'var(--bg-input)', border: '1px solid var(--border-bright)', color: swapShift ? 'var(--text-primary)' : 'var(--text-muted)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}>
          <option value="">— Schicht wählen —</option>
          {myNext7Shifts.map((s, i) => {
            const dayLabel = s.day.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
            const modelName = s.models[0]?.modelName || '?'
            const val = `${s.dayIso}__${s.shift}__${modelName}`
            return <option key={i} value={val}>{dayLabel} · {s.shift} · {modelName}</option>
          })}
        </select>
        <input value={swapReason} onChange={e => setSwapReason(e.target.value)}
          placeholder="Grund (optional)"
          style={{ flex: 1, minWidth: 120, background: 'var(--bg-input)', border: '1px solid var(--border-bright)', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }} />
        <button onClick={submitSwap} disabled={!swapShift || sending}
          style={{ background: swapShift ? 'rgba(245,158,11,0.15)' : 'var(--border)', color: swapShift ? '#f59e0b' : 'var(--text-muted)', border: `1px solid ${swapShift ? 'rgba(245,158,11,0.3)' : 'var(--border)'}`, borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
          {sending ? '...' : '↔ Anfragen'}
        </button>
      </div>
      {mySwaps.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {mySwaps.map(s => {
            const cancel = async () => {
              if (!confirm('Tausch-Anfrage stornieren?')) return
              const { error, count } = await supabase
                .from('shift_swaps')
                .delete({ count: 'exact' })
                .eq('id', s.id)
                .eq('status', 'offen')
              if (error) {
                alert('Fehler beim Stornieren: ' + error.message)
                return
              }
              if (count === 0) {
                alert('Stornieren nicht möglich — die Schicht wurde inzwischen bereits vom Admin bearbeitet.')
              }
              await loadMySwaps()
            }
            const statusLabel =
              s.status === 'offen' ? 'Offen'
              : s.status === 'angenommen' ? `✓ ${s.accepted_by || 'übernommen'}`
              : 'Abgeschlossen'
            const statusColor =
              s.status === 'offen' ? '#f59e0b'
              : s.status === 'angenommen' ? '#10b981'
              : '#ef4444'
            return (
              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: 'var(--bg-card2)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, gap: 8 }}>
                <span style={{ color: 'var(--text-secondary)', flex: 1, minWidth: 0 }}>
                  {new Date(s.shift_date + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })} · {s.shift} · {s.model_name}
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, color: statusColor }}>
                  {statusLabel}
                </span>
                {s.status === 'offen' && (
                  <button onClick={cancel} style={{
                    fontSize: 10, padding: '2px 7px', borderRadius: 5,
                    background: 'transparent', border: '1px solid rgba(239,68,68,0.3)',
                    color: 'rgba(239,68,68,0.7)', cursor: 'pointer', fontFamily: 'inherit',
                  }}>✕</button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Helper: kollabierbare Sektion - außerhalb der Component definiert
// damit es nicht bei jedem Render neu erstellt wird (was Focus-Loss in Inputs verursacht)
// v3.95.0: `hidden` blendet das Panel aus, ohne es zu unmounten (display:none statt
// return null). So bleiben Zustand und bereits geladene Daten der Kinder beim
// Tab-Wechsel erhalten — wichtig z.B. für generierte Nachrichten-Vorschläge.
// v4.9.0: helpId — setzt das ?-Symbol neben die Überschrift und markiert den
// Bereich zugleich als Ziel für die Einführungs-Tour (data-help).
function Collapsible({ isCollapsed, onToggle, icon, title, badge, badgeColor = 'var(--text-muted)', children, hidden = false, helpId = null }) {
  return (
    <div data-help={helpId || undefined} style={{
      display: hidden ? 'none' : 'block',
      marginBottom: 12,
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      overflow: 'hidden'
    }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
      <button
        onClick={onToggle}
        style={{
          flex: 1, minWidth: 0,
          padding: '12px 16px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontFamily: 'inherit',
          color: 'var(--text-primary)',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 600 }}>
          <span style={{ fontSize: 16 }}>{icon}</span>
          <span>{title}</span>
          {badge != null && badge !== 0 && badge !== '' && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
              background: badgeColor === 'var(--text-muted)' ? 'rgba(124,58,237,0.15)' : badgeColor + '22',
              color: badgeColor === 'var(--text-muted)' ? '#a78bfa' : badgeColor,
            }}>{badge}</span>
          )}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{isCollapsed ? '▶' : '▼'}</span>
      </button>
      {helpId && <span style={{ paddingRight: 14, display: 'flex', alignItems: 'center' }}><HelpDot topic={helpId} /></span>}
      </div>
      {!isCollapsed && (
        <div style={{ padding: '0 16px 16px' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// v3.55.0: Kundennummer per Klick kopieren (Chatter-Ansicht)
function ChatterCopyId({ value }) {
  const [copied, setCopied] = useState(false)
  if (!value) return null
  return (
    <span
      onClick={(e) => { e.stopPropagation(); try { navigator.clipboard?.writeText(String(value)) } catch {} setCopied(true); setTimeout(() => setCopied(false), 1200) }}
      title="Kundennummer kopieren"
      style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
    >
      <span style={{ color: copied ? '#10b981' : 'var(--text-secondary)' }}>{value}</span>
      <span style={{ fontSize: 9, color: copied ? '#10b981' : 'var(--text-muted)' }}>{copied ? '✓' : '⧉'}</span>
    </span>
  )
}

// v3.55.0: Kunden-Historie / Bibliothek — gruppiert alle Anfragen pro Kunde
function CustomerHistorySection({ history }) {
  const [search, setSearch] = useState('')
  const [openKeys, setOpenKeys] = useState(() => new Set())

  const STATUS = {
    erledigt:   { label: '✓ Erledigt',  color: '#10b981' },
    bestaetigt: { label: '✓ Bestätigt', color: '#06b6d4' },
    angefragt:  { label: '⏳ Angefragt', color: '#f59e0b' },
    abgelehnt:  { label: '✕ Abgelehnt', color: '#ef4444' },
    neu:        { label: '● Neu',       color: '#a78bfa' },
  }
  const typeLabel = (t) => ({ video: 'Video', bild: 'Bild', audio: 'Sprachnachricht', sonstiges: 'Sonstiges' }[t] || t || '—')
  const isPaid = (r) => {
    if (!(r.price > 0)) return false
    const remainder = (r.price || 0) - (r.deposit || 0)
    const hasDeposit = (r.deposit || 0) > 0 && remainder > 0
    return hasDeposit ? (!!r.deposit_paid && !!r.remainder_paid) : !!r.deposit_paid
  }

  const groupsMap = new Map()
  for (const r of history || []) {
    const key = (r.customer_id && String(r.customer_id).trim()) || '— ohne Kundennummer'
    if (!groupsMap.has(key)) groupsMap.set(key, [])
    groupsMap.get(key).push(r)
  }
  let groups = [...groupsMap.entries()].map(([customer, items]) => ({
    customer, items,
    paidSum: items.reduce((s, r) => s + (isPaid(r) ? (r.price || 0) : 0), 0),
    latest: items.reduce((m, r) => Math.max(m, new Date(r.created_at).getTime() || 0), 0),
    models: [...new Set(items.map(i => i.model_name).filter(Boolean))],
  }))
  const q = search.trim().toLowerCase()
  if (q) {
    groups = groups.filter(g =>
      g.customer.toLowerCase().includes(q) ||
      g.models.some(m => (m || '').toLowerCase().includes(q)) ||
      g.items.some(r => (r.edited_text || r.request_text || '').toLowerCase().includes(q))
    )
  }
  groups.sort((a, b) => b.latest - a.latest)
  const toggle = (key) => setOpenKeys(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })

  if (!history || history.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>Noch keine Anfragen für deine zugeteilten Models vorhanden.</div>
  }

  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
        Alle bisherigen Anfragen (offen, bestätigt, erledigt, abgelehnt, bezahlt) für deine zugeteilten Models – als Nachschlagewerk pro Kunde.
      </div>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Kunde / Model / Text suchen…"
        style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none', marginBottom: 10, boxSizing: 'border-box' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {groups.map(g => {
          const open = openKeys.has(g.customer)
          return (
            <div key={g.customer} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <div onClick={() => toggle(g.customer)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '9px 11px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{open ? '▼' : '▶'}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 12 }}><ChatterCopyId value={g.customer} /></span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{g.items.length}×</span>
                  {g.paidSum > 0 && <span className="private" style={{ fontSize: 10, fontWeight: 700, color: '#10b981' }}>${g.paidSum} bezahlt</span>}
                </div>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }}>{g.models.slice(0, 2).join(', ')}{g.models.length > 2 ? '…' : ''}</span>
              </div>
              {open && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '8px 11px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {g.items.map(r => {
                    const st = STATUS[r.status] || { label: r.status || '—', color: 'var(--text-muted)' }
                    return (
                      <div key={r.id} style={{ borderLeft: `3px solid ${st.color}`, paddingLeft: 9 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: st.color + '22', color: st.color }}>{st.label}</span>
                          <span style={{ fontSize: 10, color: '#ec4899', fontWeight: 700 }}>{r.model_name}</span>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{typeLabel(r.content_type)}</span>
                          {r.price > 0 && <span className="private" style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 700 }}>${r.price}</span>}
                          {isPaid(r) ? <span style={{ fontSize: 9, color: '#10b981', fontWeight: 700 }}>✓ bezahlt</span> : (r.deposit_paid && <span style={{ fontSize: 9, color: '#f59e0b' }}>Anzahlung</span>)}
                          <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 'auto', fontFamily: 'monospace' }}>{new Date(r.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.45, wordBreak: 'break-word' }}>{r.edited_text || r.request_text}</div>
                        {r.chatter_name && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>Chatter: {r.chatter_name}</div>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        {groups.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>Keine Treffer für „{search}".</div>}
      </div>
    </div>
  )
}

export default function ChatterPortal({ session, displayName: initialDisplayName, onSwitchToAdmin, isSocialMedia, isPreview }) {
  const [theme, setThemeState] = useState(() => getTheme())
  const [showSocialPortal, setShowSocialPortal] = useState(false)
  const [previewChatter, setPreviewChatter] = useState('')
  const [allChatters, setAllChatters] = useState([])
  const displayName = isPreview ? (previewChatter || '') : initialDisplayName

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setThemeState(next)
  }
  const [isOnline, setIsOnline] = useState(false)
  const [selectedShift, setSelectedShift] = useState('')
  const [currentLogId, setCurrentLogId] = useState(null)
  const [currentShift, setCurrentShift] = useState(null) // v3.77.1: Schicht, in die eingecheckt wurde — für zielgenauen Auto-Checkout
  const [checkInTime, setCheckInTime] = useState(null)
  // ── v4.34.0: Schichtübergabe ───────────────────────────────────────────────
  // Beim Auschecken kann ein Text an die nächste Schicht hinterlassen werden;
  // wer danach eincheckt, sieht ihn und bestätigt ihn. Freiwillig, aber der
  // Chip in der Kachelzeile erinnert daran.
  const [uebergabeDialog, setUebergabeDialog] = useState(false)  // Auschecken-Fenster offen
  const [uebergabeText, setUebergabeText] = useState('')
  const [eingangUebergaben, setEingangUebergaben] = useState([]) // was auf mich wartet
  const [uebergabeEingangOffen, setUebergabeEingangOffen] = useState(false)
  const [uebergabeMoeglich, setUebergabeMoeglich] = useState(true) // false = SQL-Migration fehlt noch
  const [uebergabeLaedt, setUebergabeLaedt] = useState(false)
  // Welche Übergaben schon einmal angezeigt wurden — damit das Fenster nicht
  // bei jedem Takt erneut aufspringt, nachdem es weggeklickt wurde.
  const bekannteUebergabenRef = React.useRef(new Set())
  // Für das 30-Sekunden-Intervall: das liest aus Refs, nicht aus State
  // (Konvention im Repo — sonst hängt es auf dem Initialwert fest).
  const ladeUebergabenRef = React.useRef(null)
  const [messages, setMessages] = useState([])
  const [models, setModels] = useState([])
  const [aliases, setAliases] = useState([]) // v3.36.0: Profile/Export-Namen je Model
  const [noteText, setNoteText] = useState('')
  const [noteModel, setNoteModel] = useState('')
  const [noteShift, setNoteShift] = useState('')
  const [hasShiftNote, setHasShiftNote] = useState(false)
  const noteRef = React.useRef(null)
  const [sendingNote, setSendingNote] = useState(false)
  const [scheduleData, setScheduleData] = useState({})
  const [shiftTimes, setShiftTimes] = useState({})
  const [chatterStats, setChatterStats] = useState(null)
  const [chatterSnapshots, setChatterSnapshots] = useState([])
  const [weekStart] = useState(() => getWeekStart(new Date()))
  const [myReminders, setMyReminders] = useState([])
  const [myAbsences, setMyAbsences] = useState([])
  const [newAbsenceDate, setNewAbsenceDate] = useState('')
  const [newAbsenceReason, setNewAbsenceReason] = useState('')
  const [newAbsenceShifts, setNewAbsenceShifts] = useState([]) // v3.29.0: leer = ganzer Tag, sonst nur diese Schichten verfügbar
  const [next7Schedules, setNext7Schedules] = useState([])
  const [absentLoading, setAbsentLoading] = useState(false)
  // v3.98.0: In "Meine Schichten" ist nur die heutige Schicht offen. null = Standard
  // (heute offen, Rest zu); sonst der Index der manuell aufgeklappten Zeile.
  const [openShiftIdx, setOpenShiftIdx] = useState(null)
  const fab = useFabPanels()   // v4.1.0: Glocke und Chat schließen sich gegenseitig
  const [announcements, setAnnouncements] = useState([])
  const [showAnnArchive, setShowAnnArchive] = useState(false)
  const [showNewRequestForm, setShowNewRequestForm] = useState(false)
  // Content-Ideen
  const [contentIdeas, setContentIdeas] = useState([])
  // v3.2.0: Guidelines (von Admin gepflegt, hier nur lesen)
  const [guidelines, setGuidelines] = useState([])
  const [guidelineLightbox, setGuidelineLightbox] = useState(null) // {url, all_urls, current_idx}
  const [showNewIdeaForm, setShowNewIdeaForm] = useState(false)
  const [newIdeaModel, setNewIdeaModel] = useState('')
  const [newIdeaText, setNewIdeaText] = useState('')
  const [newIdeaCategory, setNewIdeaCategory] = useState('bilder')
  const [newIdeaPriority, setNewIdeaPriority] = useState('normal')
  const [sendingIdea, setSendingIdea] = useState(false)
  // Collapse-State pro Sektion mit Localstorage-Memory
  // v3.95.0: Key auf _v2 gehoben — durch die Tab-Aufteilung sind pro Tab nur noch
  // 3–5 Panels sichtbar, deshalb stehen die wichtigen jetzt standardmäßig OFFEN.
  // Der alte _collapse_-Key wird dadurch ignoriert (kein Migrations-Aufwand).
  const COLLAPSE_KEY = `chatterportal_collapse_v3_${displayName || 'default'}`
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(COLLAPSE_KEY)
      if (stored) return JSON.parse(stored)
    } catch {}
    return {
      todos: false,      // Heute: offen
      shifts: false,     // Heute: offen
      messages: false,   // Heute: offen (Schichtnotiz)
      note: true,
      absence: false,    // Organisation: offen (nur zwei Panels im Tab)
      swap: true,        // Organisation: zu (selten gebraucht)
      models: false,     // Models: offen
      content: false,    // Content: offen
      history: true,
      ideas: true,
      stats: false,      // Mehr: offen
      guidelines: true,
      bot: true,
      help: true,        // Mehr: zu (v4.9.0 — Nachschlagewerk, kein Dauerbegleiter)
    }
  })
  const toggleCollapse = (key) => {
    setCollapsed(prev => {
      const next = { ...prev, [key]: !prev[key] }
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }

  // v3.95.0: Tab-Navigation statt einer langen Panel-Liste.
  // heute = laufende Schicht · models = womit gechattet wird · content = Produktion
  // mehr  = Nachschlagewerk. Zuletzt gewählter Tab wird gemerkt.
  const TAB_KEY = `chatterportal_tab_${displayName || 'default'}`
  const [tab, setTab] = useState(() => {
    try {
      const stored = localStorage.getItem(TAB_KEY)
      if (stored && ['heute', 'models', 'content', 'orga', 'mehr'].includes(stored)) return stored
    } catch {}
    return 'heute'
  })
  const goTab = (key) => {
    setTab(key)
    try { localStorage.setItem(TAB_KEY, key) } catch {}
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  // v4.9.0: Tabwechsel OHNE Scroll — die Tour scrollt selbst zum erklärten
  // Element; ein zusätzlicher Sprung nach oben würde dagegen arbeiten.
  const setTabQuiet = React.useCallback((key) => {
    setTab(key)
    try { localStorage.setItem(TAB_KEY, key) } catch {}
  }, [TAB_KEY])

  // v4.9.0: Helpcenter — Einführungs-Tour beim ersten Öffnen, danach nie wieder
  // von allein. Der Merker hängt am Anzeigenamen, damit ein zweiter Account auf
  // demselben Gerät seine eigene Einführung bekommt.
  const TOUR_KEY = `chatterportal_tour_v1_${displayName || 'default'}`
  const [tourOpen, setTourOpen] = useState(false)
  const [helpTopic, setHelpTopic] = useState(null)
  useEffect(() => {
    if (!displayName) return
    let seen = null
    try { seen = localStorage.getItem(TOUR_KEY) } catch {}
    if (seen) return
    const t = setTimeout(() => setTourOpen(true), 1200)
    return () => clearTimeout(t)
  }, [displayName, TOUR_KEY])
  const finishTour = () => {
    setTourOpen(false)
    try { localStorage.setItem(TOUR_KEY, new Date().toISOString()) } catch {}
  }
  // v3.95.0: Panel gezielt aufklappen (für die Handlungs-Chips im Cockpit)
  const openPanel = (key) => {
    setCollapsed(prev => {
      const next = { ...prev, [key]: false }
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }

  // v3.95.0: Höhe des klebenden Kopfes messen, damit das Cockpit exakt darunter
  // andockt. Fest verdrahtete 56px würden auf dem Handy brechen, sobald der Kopf umbricht.
  const headerRef = React.useRef(null)
  const [headerH, setHeaderH] = useState(56)
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const update = () => setHeaderH(el.offsetHeight || 56)
    update()
    let ro
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(update); ro.observe(el) }
    window.addEventListener('resize', update)
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', update) }
  }, [])

  const weekDays = getWeekDays(weekStart)
  const weekKey = isoDate(weekStart)
  const kw = getKW(weekStart)
  const todayIso = todayBerlin()

  const [myTodos, setMyTodos] = useState([]) // v3.38.0: mir zugewiesene Aufgaben
  const [todoNoteDrafts, setTodoNoteDrafts] = useState({}) // todoId → Entwurf der Rückmeldung
  const [contentRequests, setContentRequests] = useState([])
  const [newRequestModel, setNewRequestModel] = useState('')
  const [newRequestProfile, setNewRequestProfile] = useState('') // v3.36.0: gewählter Export-Profilname (csv_name)
  const [newRequestText, setNewRequestText] = useState('')
  const [newRequestType, setNewRequestType] = useState('video')
  const [newRequestPrice, setNewRequestPrice] = useState('')
  const [newRequestDeposit, setNewRequestDeposit] = useState('')
  // v3.50.0: 3-Stufen-Umschalter statt zweier Checkboxen. 'anfrage' = nichts bezahlt.
  const [newRequestPayStatus, setNewRequestPayStatus] = useState('anfrage') // 'anfrage' | 'angezahlt' | 'bezahlt'
  const [newRequestOutfit, setNewRequestOutfit] = useState('')   // v3.50.0
  const [newRequestSpecial, setNewRequestSpecial] = useState('') // v3.50.0 Besonderheiten
  const [newRequestDuration, setNewRequestDuration] = useState('')
  const [newRequestQuantity, setNewRequestQuantity] = useState('1')
  const [newRequestCustomerId, setNewRequestCustomerId] = useState('')
  const [newRequestImages, setNewRequestImages] = useState([])
  const [newRequestDeadline, setNewRequestDeadline] = useState('asap')
  const [sendingRequest, setSendingRequest] = useState(false)
  const [assignedModelBoards, setAssignedModelBoards] = useState({}) // modelName → board map
  const [assignedModelSocials, setAssignedModelSocials] = useState({}) // modelName → social links[]
  const [assignedModelVideos, setAssignedModelVideos] = useState({}) // modelName → videos
  const [assignedServices, setAssignedServices] = useState({}) // modelName → services
  const [assignedCustomContent, setAssignedCustomContent] = useState({}) // modelName → custom content
  const [customerHistory, setCustomerHistory] = useState([]) // v3.55.0: alle Anfragen für zugeteilte Models (Kunden-Bibliothek)
  const [selectedModelInfo, setSelectedModelInfo] = useState(null)

  const loadAssignedModelData = async (modelNames) => {
    if (!modelNames || modelNames.length === 0) return
    const boards = {}
    const vids = {}
    const svcs = {}
    const customContents = {}
    const socials = {}
    for (const name of modelNames) {
      const { data: boardData } = await supabase.from('model_board').select('*').eq('model_name', name).order('sort_order')
      const map = {}
      for (const item of boardData || []) {
        if (item.category === 'service_flags') {
          if (!svcs[name]) svcs[name] = {}
          svcs[name][item.title] = { enabled: item.yes_no, note: item.content }
        } else if (item.category === SOCIAL_CATEGORY) {
          if (!socials[name]) socials[name] = []
          socials[name].push(item)
        } else {
          if (!map[item.category]) map[item.category] = []
          map[item.category].push(item)
        }
      }
      boards[name] = map
      const { data: videoData } = await supabase.from('model_videos').select('*').eq('model_name', name).order('release_date')
      vids[name] = videoData || []
      const { data: ccData } = await supabase.from('custom_content').select('*').eq('model_name', name).eq('completed', false).order('due_date')
      customContents[name] = ccData || []
    }
    setAssignedModelBoards(boards)
    setAssignedModelSocials(socials)
    setAssignedModelVideos(vids)
    setAssignedServices(svcs)
    setAssignedCustomContent(customContents)
  }

  const loadContentRequests = async () => {
    const twoWeeksAgo = new Date()
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)
    const { data } = await supabase.from('content_requests')
      .select('*')
      .eq('chatter_name', displayName)
      .gte('created_at', twoWeeksAgo.toISOString())
      .order('created_at', { ascending: false })
    setContentRequests(data || [])
  }

  // v3.55.0: Kunden-Historie — alle Anfragen (jeder Status, jeder Chatter) für die
  // Models, denen der Chatter zugeteilt ist, PLUS eigene Anfragen. Dient als
  // Bibliothek: "welcher Kunde hat schon was bestellt/bezahlt".
  // Hinweis: liefert nur fremde Zeilen, wenn die Supabase-RLS das erlaubt.
  // v3.58.0: STRIKT nur Anfragen für die Models, denen der Chatter zugeteilt ist
  // (gleiche Model-Liste wie die Boards / "Meine Models"). Keine fremden Models mehr,
  // auch nicht über selbst erstellte Anfragen.
  const loadCustomerHistory = async (modelNames) => {
    try {
      if (!modelNames || modelNames.length === 0) { setCustomerHistory([]); return }
      const { data } = await supabase.from('content_requests')
        .select('*')
        .in('model_name', modelNames)
        .order('created_at', { ascending: false })
        .limit(1000)
      setCustomerHistory(data || [])
    } catch (e) {
      console.error('loadCustomerHistory', e)
    }
  }

  const loadContentIdeas = async () => {
    const fourWeeksAgo = new Date()
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28)
    const { data } = await supabase.from('content_ideas')
      .select('*')
      .eq('created_by', displayName)
      .gte('created_at', fourWeeksAgo.toISOString())
      .order('created_at', { ascending: false })
    setContentIdeas(data || [])
  }

  // v3.2.0: Guidelines laden (von Admin in Einstellungen gepflegt)
  const loadGuidelines = async () => {
    const { data } = await supabase.from('guidelines').select('*').order('order_index', { ascending: true })
    setGuidelines(data || [])
  }

  const submitContentIdea = async () => {
    if (!newIdeaModel || !newIdeaText.trim()) return
    setSendingIdea(true)
    const { error } = await supabase.from('content_ideas').insert({
      model_name: newIdeaModel,
      idea_text: newIdeaText.trim(),
      category: newIdeaCategory,
      priority: newIdeaPriority,
      status: 'offen',
      created_by: displayName,
    })
    setSendingIdea(false)
    if (error) {
      alert('Fehler: ' + error.message)
      return
    }
    setNewIdeaText('')
    setNewIdeaModel('')
    setNewIdeaCategory('bilder')
    setNewIdeaPriority('normal')
    setShowNewIdeaForm(false)
    loadContentIdeas()
  }

  const submitContentRequest = async () => {
    if (!newRequestModel || !newRequestText.trim()) return
    // v3.73.0: Ohne gültigen Namen kann chatter_name (NOT NULL) nicht gesetzt werden ->
    // der Insert würde still abgelehnt, während Telegram trotzdem raus ginge. Deshalb hier
    // hart abbrechen und den User bitten, sich neu einzuloggen bzw. den Namen setzen zu lassen.
    if (!displayName || !displayName.trim()) {
      alert('⚠️ Dein Anzeigename fehlt – die Anfrage kann nicht gespeichert werden.\n\nBitte einmal ab- und wieder anmelden. Wenn das nicht hilft, meldet sich ein Admin (Name muss im Profil hinterlegt werden).')
      return
    }
    setSendingRequest(true)

    // Upload images first
    const uploadedUrls = []
    let failedUploads = 0
    for (const rawFile of newRequestImages) {
      // v3.42.0: HEIC (iPhone) → JPEG, sonst wird das Foto später nicht angezeigt
      const file = await convertHeicIfNeeded(rawFile)
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${displayName}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
      const { data: uploadData, error } = await supabase.storage
        .from('content-requests')
        .upload(path, file, { contentType: file.type || 'image/jpeg' })
      if (!error && uploadData) {
        const { data: urlData } = supabase.storage.from('content-requests').getPublicUrl(path)
        if (urlData?.publicUrl) uploadedUrls.push(urlData.publicUrl)
        else failedUploads++
      } else {
        console.error('Foto-Upload fehlgeschlagen:', error)
        failedUploads++
      }
    }
    if (failedUploads > 0) {
      alert(`${failedUploads} Foto${failedUploads === 1 ? '' : 's'} konnte${failedUploads === 1 ? '' : 'n'} nicht hochgeladen werden. Die Anfrage wird ohne diese Fotos gesendet.`)
    }

    // Bezahl-Status berechnen
    const priceVal = parseFloat(newRequestPrice) || 0
    const depositVal = parseFloat(newRequestDeposit) || 0
    const remainderVal = priceVal - depositVal
    const nowIso = new Date().toISOString()

    // v3.50.0: 3-Stufen-Bezahlstatus → gleiche DB-Felder wie zuvor (deposit_paid / remainder_paid),
    // damit CommTab / ModelPortal die Auswertung unverändert nutzen können.
    //   'bezahlt'   → deposit_paid + remainder_paid = true (komplett bezahlt)
    //   'angezahlt' → deposit_paid = true, Rest offen (braucht Anzahlungsbetrag > 0)
    //   'anfrage'   → nichts bezahlt
    let depositPaidNow = false
    let remainderPaidNow = false
    let depositPaidAt = null
    let remainderPaidAt = null

    if (newRequestPayStatus === 'bezahlt') {
      depositPaidNow = true
      remainderPaidNow = true
      depositPaidAt = nowIso
      remainderPaidAt = nowIso
    } else if (newRequestPayStatus === 'angezahlt' && depositVal > 0) {
      depositPaidNow = true
      depositPaidAt = nowIso
    }

    // Zusatzfelder nur senden, wenn für den Typ sinnvoll bzw. befüllt
    const typeMeta = CONTENT_TYPE_META[newRequestType] || {}
    const outfitVal = (typeMeta.showOutfit && newRequestOutfit.trim()) ? newRequestOutfit.trim() : null
    const specialVal = newRequestSpecial.trim() || null

    // v3.72.0: Insert-Fehler wird jetzt geprüft. Vorher lief die Telegram-Benachrichtigung
    // + "✓ Anfrage gesendet!" unabhängig davon, ob der DB-Insert geklappt hat. Ein
    // fehlgeschlagener Insert (z.B. fehlende Spalte, RLS, Constraint) erzeugte so eine
    // Telegram-Nachricht an die Admins, OBWOHL nie eine Zeile in content_requests landete
    // -> "kam bei TG, aber nicht im Dashboard sichtbar". Jetzt: erst Insert prüfen, und
    // NUR bei Erfolg benachrichtigen / Formular leeren / Erfolg melden.
    try {
      const { error: insertError } = await supabase.from('content_requests').insert({
        chatter_name: displayName,
        model_name: newRequestModel,
        account_csv: newRequestProfile || null,
        request_text: newRequestText.trim(),
        content_type: newRequestType,
        price: priceVal,
        deposit: depositVal,
        deposit_paid: depositPaidNow,
        deposit_paid_at: depositPaidAt,
        remainder_paid: remainderPaidNow,
        remainder_paid_at: remainderPaidAt,
        duration: newRequestDuration.trim() || null,
        quantity: parseInt(newRequestQuantity) || 1,
        customer_id: newRequestCustomerId.trim() || null,
        status: 'neu',
        image_urls: uploadedUrls,
        deadline: newRequestDeadline,
        outfit: outfitVal,               // v3.50.0
        special_notes: specialVal,       // v3.50.0 Besonderheiten
      })

      if (insertError) {
        console.error('content_requests-Insert fehlgeschlagen:', insertError)
        alert(
          '⚠️ Anfrage konnte NICHT gespeichert werden:\n' +
          (insertError.message || 'Unbekannter Fehler') +
          '\n\nEs wurde KEINE Telegram-Benachrichtigung gesendet und die Eingaben bleiben erhalten.' +
          '\nBitte einen Screenshot dieser Meldung an einen Admin schicken.'
        )
        return
      }

      // Ab hier: Insert war erfolgreich -> Admins per Telegram benachrichtigen
      const deadlineText = newRequestDeadline === 'asap' ? '⚡ ASAP' : newRequestDeadline === 'hours' ? '⏰ In den nächsten Stunden' : newRequestDeadline === 'days' ? '📅 1-2 Tage' : '🗓 Diese Woche'
      // Bezahl-Zeile im TG (v3.50.0)
      let payInfoTg = ''
      if (newRequestPayStatus === 'bezahlt') {
        payInfoTg = ` ✓ vollständig bezahlt`
      } else if (newRequestPayStatus === 'angezahlt' && depositVal > 0) {
        payInfoTg = ` (Anzahlung $${depositVal} ✓ erhalten · Rest $${remainderVal} offen)`
      } else {
        payInfoTg = ` (nur Anfrage – noch nichts bezahlt)`
      }
      const extraTg = `${outfitVal ? `\nOutfit: ${outfitVal}` : ''}${specialVal ? `\nBesonderheiten: ${specialVal}` : ''}`
      const tgMsg = `🎬 <b>Neue Content-Anfrage!</b>\n\nVon: ${displayName}\nModel: ${newRequestModel}${(newRequestProfile && newRequestProfile !== newRequestModel) ? `\nProfil: ${newRequestProfile}` : ''}\nTyp: ${contentTypeLabel(newRequestType)}\nPreis: $${newRequestPrice}${payInfoTg}\nDringlichkeit: ${deadlineText}${extraTg}\n\nWunsch: ${newRequestText.trim()}`
      // Telegram-Fehler dürfen den Erfolg nicht kippen — die Zeile ist bereits gespeichert.
      try {
        await Promise.all([
          sendTelegramMessage(CHRIS_TG, tgMsg),
          sendTelegramMessage(REY_TG, tgMsg),
        ])
      } catch (tgErr) {
        console.error('Telegram-Benachrichtigung fehlgeschlagen (Anfrage ist trotzdem gespeichert):', tgErr)
      }

      setNewRequestModel(''); setNewRequestProfile(''); setNewRequestText(''); setNewRequestType('video')
      setNewRequestPrice(''); setNewRequestDeposit(''); setNewRequestDuration('')
      setNewRequestPayStatus('anfrage'); setNewRequestOutfit(''); setNewRequestSpecial('')
      setNewRequestQuantity('1'); setNewRequestCustomerId(''); setNewRequestImages([]); setNewRequestDeadline('asap')
      await loadContentRequests()
      alert('✓ Anfrage gesendet!')
    } catch (e) {
      console.error('content_requests-Insert Ausnahme:', e)
      alert('⚠️ Anfrage konnte nicht gesendet werden (Netzwerk-/Serverfehler). Bitte erneut versuchen.')
    } finally {
      // v3.72.0: Button immer wieder freigeben — vorher blieb er bei Fehlern gesperrt.
      setSendingRequest(false)
    }
  }

  const sendHeartbeat = async (shiftOnline) => {
    await supabase.from('online_status').upsert({
      display_name: displayName,
      last_seen: new Date().toISOString(),
      shift_online: shiftOnline,
    }, { onConflict: 'display_name' })
  }

  const loadAnnouncements = async () => {
    const { data } = await supabase
      .from('announcements')
      .select('*')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
    setAnnouncements(data || [])
  }

  const archiveAnnouncement = async (annId) => {
    if (!displayName) return
    const ann = announcements.find(a => a.id === annId)
    if (!ann) return
    const archivedFor = Array.isArray(ann.archived_for) ? ann.archived_for : []
    if (archivedFor.includes(displayName)) return
    const newArchived = [...archivedFor, displayName]
    await supabase.from('announcements').update({ archived_for: newArchived }).eq('id', annId)
    setAnnouncements(prev => prev.map(a => a.id === annId ? { ...a, archived_for: newArchived } : a))
  }

  const markSingleMessageRead = async (msgId) => {
    if (!displayName) return
    await supabase.from('messages')
      .update({ read_at: new Date().toISOString(), read_by: displayName })
      .eq('id', msgId)
      .is('read_at', null)
    // Lokal updaten
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, read_at: new Date().toISOString(), read_by: displayName } : m))
  }

  const markAllMessagesRead = async () => {
    if (!displayName) return
    await supabase.from('messages')
      .update({ read_at: new Date().toISOString(), read_by: displayName })
      .eq('model_name', displayName)
      .eq('contact_type', 'chatter')
      .eq('direction', 'out')
      .is('read_at', null)
    setMessages(prev => prev.map(m =>
      m.contact_type === 'chatter' && m.direction === 'out' && m.model_name === displayName && !m.read_at
        ? { ...m, read_at: new Date().toISOString(), read_by: displayName }
        : m
    ))
  }

  // Backward-compat: alter Name wird beim Initial-Load referenziert
  const markMyMessagesRead = markAllMessagesRead

  const [isCheckingIn, setIsCheckingIn] = useState(false) // v2.9.6: Doppelklick-Schutz UI
  const checkInLockRef = React.useRef(false) // v2.9.6: Race-Lock damit parallele Calls nicht durchgehen

  const checkIn = async (shiftName) => {
    // v2.9.6: Race-Schutz — wenn schon ein Call läuft, abbrechen
    if (checkInLockRef.current) return
    checkInLockRef.current = true
    setIsCheckingIn(true)
    try {
      // Check if already logged in - prevent duplicate logs
      const { data: existingLog } = await supabase
        .from('shift_logs')
        .select('id, shift')
        .eq('display_name', displayName)
        .is('checked_out_at', null)
        .maybeSingle()
      // v4.18.0: Wechsel in eine ANDERE Schicht.
      // Vorher wurde bei offenem Log immer abgebrochen — dadurch übernahm die
      // zweite Schicht des Tages still den Namen der ersten, und in shift_logs,
      // Export und Stats wurden aus zwei Schichten buchstäblich eine.
      // Jetzt: gleiche Schicht -> nur Zustand herstellen (wie bisher).
      //        andere Schicht  -> die laufende sauber beenden und neu einchecken.
      const zielSchicht = shiftName || selectedShift || null
      if (existingLog) {
        const gleiche = !zielSchicht || (existingLog.shift || '') === zielSchicht
        if (gleiche) {
          setCurrentLogId(existingLog.id)
          setCurrentShift(existingLog.shift || null) // v3.77.1
          setIsOnline(true)
          await sendHeartbeat(true)
          ladeUebergaben() // v4.34.0
          return
        }
        await supabase.from('shift_logs')
          .update({ checked_out_at: new Date().toISOString() })
          .eq('id', existingLog.id)
      }

      // v2.9.5/6: Schicht aus Plan ermitteln statt 'Manuell'
      // - Daten direkt aus DB laden (vermeidet Race-Condition mit State der noch nicht geladen ist)
      // - Wenn mehrere Schichten heute, die nehmen deren Startzeit am nächsten zur jetzigen Zeit ist
      let shiftToLog = shiftName || selectedShift
      if (!shiftToLog) {
        const now = new Date()
        const todayBerlin = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
        const myNameLc = (displayName || '').trim().toLowerCase()
        const berlinTimeStr = now.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false })
        const [nowH, nowM] = berlinTimeStr.split(':').map(Number)
        const nowMins = nowH * 60 + nowM

        // Diese Woche aus DB laden (frische Daten, nicht aus State)
        const dt = new Date(todayBerlin)
        const day = dt.getDay()
        const diff = dt.getDate() - day + (day === 0 ? -6 : 1)
        const monday = new Date(dt.setDate(diff))
        const weekStart = monday.toISOString().split('T')[0]
        const { data: schedRow } = await supabase.from('schedule').select('*').eq('week_start', weekStart).maybeSingle()
        const assignments = schedRow?.assignments || {}
        const shiftTimes = schedRow?.shift_times || {}

        // Alle Schicht-Einträge für mich heute sammeln
        const myShiftsToday = []
        for (const [key, val] of Object.entries(assignments)) {
          const parts = key.split('__')
          if (parts[1] !== todayBerlin) continue
          const valChatterLc = (val.chatter || '').trim().toLowerCase()
          const valTraineeLc = (val.trainee || '').trim().toLowerCase()
          if (valChatterLc === myNameLc || valTraineeLc === myNameLc) {
            // v2.9.7: Cell-Override hat Vorrang vor Standard-Zeit
            const standard = (val.time_override || shiftTimes[`${parts[0]}__${parts[2]}`] || '').replace(/\s*\(DE\)/g, '')
            // v4.34.0: bei geteilter Schicht zählt MEIN Abschnitt — sonst würde die
            // Schichtwahl beim Check-in an der Startzeit der anderen Hälfte hängen.
            const timeStr = meineSpanne(val, standard, valTraineeLc === myNameLc && valChatterLc !== myNameLc)
            const startTimeStr = timeStr.split('-')[0]?.trim() || ''
            const [sh, sm] = startTimeStr.split(':').map(Number)
            const startMins = isNaN(sh) ? null : sh * 60 + (sm || 0)
            myShiftsToday.push({ shift: parts[2], modelId: parts[0], startMins })
          }
        }

        const uniqueShifts = [...new Set(myShiftsToday.map(s => s.shift))]
        if (uniqueShifts.length === 1) {
          shiftToLog = uniqueShifts[0]
        } else if (uniqueShifts.length > 1) {
          // Mehrere — Schicht mit Startzeit am nächsten zur jetzigen Uhrzeit (im Fenster -4h bis +8h)
          let best = null
          let bestDiff = Infinity
          for (const s of myShiftsToday) {
            if (s.startMins == null) continue
            const diff = nowMins - s.startMins
            if (diff >= -240 && diff <= 480) {
              if (Math.abs(diff) < bestDiff) {
                bestDiff = Math.abs(diff)
                best = s.shift
              }
            }
          }
          shiftToLog = best || 'Manuell'
        } else {
          shiftToLog = 'Manuell'
        }
      }

      const { data } = await supabase.from('shift_logs').insert({
        display_name: displayName,
        checked_in_at: new Date().toISOString(),
        shift: shiftToLog,
      }).select().single()
      if (data) {
        setCurrentLogId(data.id)
        setCheckInTime(new Date())
      }
      setCurrentShift(shiftToLog) // v3.77.1: eingecheckte Schicht merken
      setIsOnline(true)
      setSelectedShift('')
      await sendHeartbeat(true)
      // v4.34.0: direkt nach dem Einchecken zeigen, was die Vorschicht hinterlassen hat
      ladeUebergaben()
    } finally {
      checkInLockRef.current = false
      setIsCheckingIn(false)
    }
  }

  const [isCheckingOut, setIsCheckingOut] = useState(false) // v2.9.6: Doppelklick-Schutz
  const checkOutLockRef = React.useRef(false)

  // v4.34.0: `text` = Übergabe an die nächste Schicht. null/leer heißt: nichts zu übergeben.
  // Der Text landet am eigenen Schicht-Log, nicht am Cleanup-Update weiter unten —
  // sonst bekämen fremde Alt-Logs denselben Text angehängt.
  const checkOut = async (text = null) => {
    if (checkOutLockRef.current) return
    checkOutLockRef.current = true
    setIsCheckingOut(true)
    // v4.35.0: Log-ID, deren Übergabe nach dem Ausloggen zugestellt wird.
    let zustellenFuer = null
    try {
      const jetzt = new Date().toISOString()
      if (currentLogId) {
        const felder = { checked_out_at: jetzt }
        // Bewusst ohne Prüfung auf `uebergabeMoeglich`: kippt das Flag zwischen
        // Öffnen des Fensters und Absenden (das 30-Sekunden-Intervall kann das),
        // wäre ein geschriebener Text sonst kommentarlos verschwunden. Schlägt der
        // Schreibvorgang fehl, fängt das der Fehlerzweig unten ab.
        if (text && text.trim()) {
          felder.handover_text = text.trim()
          felder.handover_at = jetzt
          // v4.36.0: `handover_for` wird hier bewusst NICHT vorbelegt und bleibt
          // bis `handover-notify` es setzt auf null.
          //
          // Der Gedanke, es gleich auf [] zu setzen, war naheliegend — er hätte
          // die eine Sekunde geschlossen, in der die Übergabe noch ungefiltert
          // dasteht. Der Preis wäre aber zu hoch gewesen: Kommt die Function nicht
          // durch (Netzfehler, Auth, kalter Start), bliebe [] stehen und die
          // Übergabe wäre für IMMER für niemanden sichtbar. Mit null greift in
          // genau diesem Fall der Notnagel und alle sehen sie.
          // Eine Sekunde zu weit sichtbar ist besser als dauerhaft verloren.
        }
        const { error } = await supabase.from('shift_logs').update(felder).eq('id', currentLogId)
        // Fällt das Update wegen fehlender Spalten durch (Migration noch nicht
        // gelaufen), soll wenigstens das Auschecken klappen — sonst hinge jemand
        // in einer Schicht fest, die er nicht beenden kann.
        if (error && felder.handover_text) {
          console.warn('Übergabe konnte nicht gespeichert werden:', error.message)
          setUebergabeMoeglich(false)
          await supabase.from('shift_logs').update({ checked_out_at: jetzt }).eq('id', currentLogId)
          alert('⚠️ Die Schicht wurde beendet, aber die Übergabe konnte nicht gespeichert werden.\nBitte gib sie einem Admin durch.')
        } else if (felder.handover_text) {
          // v4.35.0: Zustellung erst NACH dem Ausloggen — siehe unten.
          zustellenFuer = currentLogId
        }
      } else if (text && text.trim()) {
        alert('⚠️ Zu dieser Schicht gibt es keinen Check-in-Eintrag — die Übergabe konnte nicht gespeichert werden.')
      }
      // v2.9.6: Cleanup — falls aus irgendeinem Grund noch andere offene Logs für diesen User existieren, alle schließen
      await supabase.from('shift_logs')
        .update({ checked_out_at: jetzt })
        .eq('display_name', displayName)
        .is('checked_out_at', null)
      setIsOnline(false)
      setCurrentLogId(null)
      setCurrentShift(null) // v3.77.1
      setCheckInTime(null)
      setUebergabeDialog(false)
      setUebergabeText('')
      await sendHeartbeat(false)

      // v4.35.0: Übergabe aktiv zustellen — an die Leute, die laut Dienstplan
      // übernehmen, plus Chris und Rey. Ohne das erreicht sie niemanden, der nur
      // über Telegram arbeitet und das Portal gar nicht öffnet.
      //
      // Bewusst ERST HIER, nach Cleanup und Heartbeat: der Aufruf kann in einen
      // Hinweis münden, und ein offener Dialog auf einem weggelegten Handy darf
      // nicht dazu führen, dass jemand im System weiter als „online" geführt wird.
      //
      // Das Ergebnis wird ausgewertet — eine Erfolgsmeldung, obwohl niemand
      // erreicht wurde, wäre schlimmer als gar keine: dann verlässt sich jemand
      // darauf, dass die nächste Schicht Bescheid weiß.
      if (zustellenFuer) {
        const zustellung = await sendeSchichtuebergabe(zustellenFuer)
        if (!zustellung?.ok) {
          alert('✅ Deine Übergabe ist gespeichert.\n\n⚠️ Die Weiterleitung per Telegram hat nicht geklappt. Sie steht im Dashboard und erscheint beim Einchecken — gib im Zweifel kurz selbst Bescheid.')
        } else if (zustellung.gefunden === 0) {
          // Nur wenn der Empfängerkreis auch wirklich festgeschrieben wurde, gilt
          // „erscheint bei keinem Chatter". Sonst steht die Spalte auf null und
          // der Notnagel zeigt sie allen — dann wäre die Aussage das Gegenteil.
          alert(zustellung.empfaenger_gespeichert === false
            ? '✅ Deine Übergabe ist gespeichert und ging an Chris und Rey.\n\nℹ️ Im Dienstplan steht für die nächsten Stunden niemand, der übernimmt.'
            : '✅ Deine Übergabe ist gespeichert und ging an Chris und Rey.\n\nℹ️ Im Dienstplan steht für die nächsten Stunden niemand, der übernimmt. Sie erscheint deshalb bei keinem Chatter im Portal — Chris und Rey haben sie und geben sie weiter.')
        } else if (!zustellung.zugestellt) {
          alert('✅ Deine Übergabe ist gespeichert und ging an Chris und Rey.\n\n⚠️ Die nächste Schicht konnte nicht per Telegram erreicht werden (fehlende Telegram-ID). Sie sieht die Übergabe beim Einchecken im Portal.')
        }
      }
    } finally {
      checkOutLockRef.current = false
      setIsCheckingOut(false)
    }
  }

  // ── v4.34.0: offene Übergaben laden ────────────────────────────────────────
  // Gesucht sind Übergaben von ANDEREN aus den letzten 16 Stunden, die ich noch
  // nicht bestätigt habe. 16 Stunden, weil damit auch eine Nachtschicht die
  // Übergabe an die Frühschicht sicher erreicht, aber nichts von vorgestern
  // wieder aufpoppt.
  // `autoOeffnen` steuert, ob das Fenster von selbst aufspringt. Nur direkt nach
  // dem Einchecken und im laufenden Betrieb — beim bloßen Öffnen des Portals
  // reicht der pinke Hinweis, sonst poppt es jeden an, der nur kurz reinschaut.
  const ladeUebergaben = React.useCallback(async (autoOeffnen = true) => {
    if (!displayName || !uebergabeMoeglich) return
    const seit = new Date(Date.now() - 16 * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabase
      .from('shift_logs')
      .select('id, display_name, shift, checked_out_at, handover_text, handover_at, handover_ack, handover_for')
      .not('handover_text', 'is', null)
      // Zeitgrenze über `handover_at`, nicht über `checked_out_at`: eine per
      // Telegram (/uebergabe) während der laufenden Schicht geschriebene Übergabe
      // hat noch kein Check-out und wäre sonst unsichtbar.
      .gte('handover_at', seit)
      // Großzügiges Limit, weil erst danach in JS gefiltert wird (eigene und
      // bereits bestätigte fallen dort weg) — mit einem knappen Limit würden
      // offene Übergaben still hinten herausfallen.
      .order('handover_at', { ascending: false })
      .limit(100)
    if (error) {
      // Fehlende Spalten = Migration noch nicht ausgeführt. Dann bleibt das
      // ganze Übergabe-Feature still aus, statt bei jedem Laden zu meckern.
      console.warn('Übergaben laden fehlgeschlagen:', error.message)
      setUebergabeMoeglich(false)
      return
    }
    // v4.36.0: Eine Übergabe sieht nur noch, wen sie angeht.
    //
    // Vorher galt nur „nicht von mir" und „noch nicht bestätigt" — dadurch bekam
    // sie jeder zu sehen, der binnen 16 Stunden ins Portal schaute, und konnte sie
    // abhaken, ohne mit der Schicht etwas zu tun zu haben. Das „✓ gelesen von …"
    // im Schicht-Log war damit wertlos.
    //
    // `handover_for` kommt aus `handover-notify` und enthält die, die laut
    // Dienstplan übernehmen. Drei Zustände:
    //   Namen     → nur diese Leute
    //   leer      → im Plan steht niemand; Chris und Rey haben sie per Telegram
    //   null      → nie ermittelt (Altbestand oder die Function war nicht
    //               erreichbar). Notnagel: allen zeigen. Eine verlorene Übergabe
    //               ist schlimmer als eine, die einer zu viel liest.
    const gehtMichAn = (l) => {
      if (l.handover_for == null) return true
      return l.handover_for.some(n => norm(n) === norm(displayName))
    }
    const offen = (data || []).filter(l =>
      norm(l.display_name) !== norm(displayName) &&
      !(l.handover_ack || []).some(a => norm(a) === norm(displayName)) &&
      gehtMichAn(l)
    )
    // Nur aufspringen, wenn wirklich etwas Neues dazugekommen ist — sonst ginge
    // das Fenster alle 30 Sekunden wieder auf, nachdem man es zugeklickt hat.
    // Die Merkliste wird NUR beim Aufspringen fortgeschrieben. Täte sie es auch
    // beim stillen Laden (Mount), gälte eine Übergabe schon als gezeigt, bevor
    // sie jemand gesehen hat — und beim Einchecken käme kein Fenster mehr.
    setEingangUebergaben(offen)
    if (!autoOeffnen) return
    const neu = offen.some(l => !bekannteUebergabenRef.current.has(l.id))
    bekannteUebergabenRef.current = new Set(offen.map(l => l.id))
    if (neu) setUebergabeEingangOffen(true)
  }, [displayName, uebergabeMoeglich])

  // Lesebestätigung. Der Stand wird direkt vorher frisch geholt — das verkleinert
  // das Fenster, in dem die Bestätigung eines Kollegen überschrieben wird, schließt
  // es aber nicht (zwischen Lesen und Schreiben liegt ein Roundtrip). Wirklich
  // atomar wäre nur ein `array_append` per RPC. Für ein Team dieser Größe, in dem
  // zwei Leute dieselbe Übergabe kaum in derselben Sekunde abhaken, bewusst so
  // gelassen — die Folge wäre lediglich ein zweites Aufpoppen, kein Datenverlust.
  const bestaetigeUebergabe = async (log) => {
    setUebergabeLaedt(true)
    try {
      const { data: frisch } = await supabase
        .from('shift_logs').select('handover_ack').eq('id', log.id).maybeSingle()
      const bisher = frisch?.handover_ack || log.handover_ack || []
      if (bisher.includes(displayName)) {
        setEingangUebergaben(prev => prev.filter(l => l.id !== log.id))
        return
      }
      const { error } = await supabase.from('shift_logs')
        .update({ handover_ack: [...bisher, displayName] })
        .eq('id', log.id)
      if (error) {
        alert('⚠️ Bestätigung konnte nicht gespeichert werden. Bitte nochmal versuchen.')
        return
      }
      // Updater-Form, nicht aus der Closure ableiten: zwischen Klick und hier
      // liegen zwei Roundtrips, in denen das 30-Sekunden-Intervall eine weitere
      // Übergabe nachgeladen haben kann. Aus der Closure gerechnet fiele die
      // wieder aus der Liste. Das Schließen des Fensters erledigt der Effect unten.
      setEingangUebergaben(prev => prev.filter(l => l.id !== log.id))
    } finally {
      setUebergabeLaedt(false)
    }
  }

  // v4.34.0: Ist nichts mehr offen, schließt sich das Fenster von selbst.
  // Als Effect und nicht im State-Updater — dort wäre es ein Seiteneffekt, den
  // React unter StrictMode doppelt ausführt.
  useEffect(() => {
    if (eingangUebergaben.length === 0) setUebergabeEingangOffen(false)
  }, [eingangUebergaben.length])

  // v4.34.0: Beim Öffnen des Portals einmal nachsehen, ob eine Übergabe wartet —
  // ohne Fenster, nur der Hinweis-Chip. Aufspringen soll es nach dem Einchecken.
  useEffect(() => {
    ladeUebergabenRef.current = ladeUebergaben
    if (!isPreview && displayName) ladeUebergaben(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayName, isPreview, ladeUebergaben])

  useEffect(() => {
    if (isPreview) {
      supabase.from('chatters_contact').select('name, active').order('name').then(({ data }) => {
        const list = (data || []).filter(c => c.active !== false)
        setAllChatters(list)
        if (list.length > 0) setPreviewChatter(list[0].name)
      })
    }
  }, [isPreview])

  // Refs to avoid stale closures in intervals
  const isOnlineRef = React.useRef(isOnline)
  const currentLogIdRef = React.useRef(currentLogId)
  const currentShiftRef = React.useRef(currentShift) // v3.77.1
  const next7SchedulesRef = React.useRef(next7Schedules)
  useEffect(() => { isOnlineRef.current = isOnline }, [isOnline])
  useEffect(() => { currentLogIdRef.current = currentLogId }, [currentLogId])
  useEffect(() => { currentShiftRef.current = currentShift }, [currentShift])
  useEffect(() => { next7SchedulesRef.current = next7Schedules }, [next7Schedules])

  // v3.38.0: Meine Aufgaben (vom Team zugewiesen)
  const loadMyTodos = async () => {
    if (!displayName) return
    const { data } = await supabase.from('todos').select('*').eq('assigned_to', displayName).order('created_at', { ascending: false })
    const list = data || []
    setMyTodos(list)
    // Ungelesene automatisch als "gesehen" markieren (read_by), damit das Team den Lesestatus sieht
    for (const t of list) {
      const readBy = Array.isArray(t.read_by) ? t.read_by : []
      if (!readBy.includes(displayName)) {
        await supabase.from('todos').update({ read_by: [...readBy, displayName] }).eq('id', t.id)
      }
    }
  }

  const toggleMyTodo = async (todo) => {
    const completed = !todo.completed
    await supabase.from('todos').update({
      completed,
      completed_by: completed ? displayName : null,
      completed_at: completed ? new Date().toISOString() : null,
    }).eq('id', todo.id)
    // v3.39.0: Team benachrichtigen, wenn abgehakt wird
    if (completed) {
      try { await notifyAdmins(`✅ <b>${displayName}</b> hat erledigt:\n\n${todo.title}`) } catch (err) { console.error('Telegram-Fehler:', err) }
    }
    loadMyTodos()
  }

  const saveTodoNote = async (todo) => {
    const note = (todoNoteDrafts[todo.id] ?? '').trim()
    await supabase.from('todos').update({ assignee_note: note || null }).eq('id', todo.id)
    // v3.39.0: Team benachrichtigen, wenn eine Rückmeldung hinterlassen wird
    if (note) {
      try { await notifyAdmins(`💬 <b>${displayName}</b> – Rückmeldung zu „${todo.title}":\n\n${note}`) } catch (err) { console.error('Telegram-Fehler:', err) }
    }
    setTodoNoteDrafts(prev => { const n = { ...prev }; delete n[todo.id]; return n })
    loadMyTodos()
  }

  useEffect(() => {
    if (!displayName) return
    loadMessages()
    loadSchedule()
    loadStats()
    loadModels()
    loadContentRequests()
    loadContentIdeas()
    loadGuidelines()
    loadMyReminders()
    loadMyAbsences()
    loadOnlineStatus()
    loadAnnouncements()
    checkTodayNote()
    loadMyTodos()
    const interval = setInterval(async () => {
      loadMessages()
      loadAnnouncements()
      loadMyTodos()
      sendHeartbeat(isOnlineRef.current)

      // v4.34.0: Übergaben mitziehen, solange die Schicht läuft. Der Normalfall ist
      // Überlappung — wer um 08:00 eincheckt, bekommt die Übergabe der Nachtschicht
      // erst um 08:05. Ohne diesen Takt erschiene sie erst nach einem Neuladen der
      // Seite, also meist gar nicht. Steht bewusst VOR den Auto-Checkout-Prüfungen:
      // sonst bekäme niemand mit manuell gestarteter Schicht ('Manuell') je eine.
      if (isOnlineRef.current && currentLogIdRef.current) ladeUebergabenRef.current?.()

      // Auto-checkout check
      if (!isOnlineRef.current || !currentLogIdRef.current) return
      // v3.77.1: Nur die Schicht prüfen, in die tatsächlich eingecheckt wurde. Ohne bekannte
      // Schicht (oder "Manuell") kein automatischer Checkout — sonst wirft eine früher am Tag
      // abgelaufene Schicht (z.B. Spät) beim Einchecken in eine spätere (z.B. Nacht) sofort raus.
      const myShift = currentShiftRef.current
      if (!myShift || myShift === 'Manuell') return
      const now = new Date()
      const berlinStr = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
      const todayIsoStr = berlinStr
      const nowMins = parseInt(now.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).replace(':', ''))
      const nowH = Math.floor(nowMins / 100)
      const nowM = nowMins % 100
      const nowTotal = nowH * 60 + nowM

      // v4.34.0: Erst ALLE Zellen der eingecheckten Schicht ansehen und das
      // SPÄTESTE Ende bestimmen — dann entscheiden.
      // Vorher wurde ausgecheckt, sobald die erste passende Zelle abgelaufen war.
      // Mit Zeiten pro Zelle (geteilte Schicht, time_override) ist das der Regelfall:
      // wer bei Model A bis 12:00 und bei Model B bis 16:00 eingeteilt ist, flog
      // um 12:01 raus, obwohl er noch vier Stunden Schicht hatte.
      let spaetestesEnde = null
      let nowAdjMax = nowTotal
      for (const sched of next7SchedulesRef.current) {
        const times = sched.shift_times || {}
        const assignments = sched.assignments || {}
        for (const [key, val] of Object.entries(assignments)) {
          const parts = key.split('__')
          if (parts[1] !== todayIsoStr) continue
          // Auch die zweite Hälfte einer geteilten Schicht wird automatisch
          // ausgecheckt — vorher lief deren Log bis zum nächsten manuellen Klick weiter.
          // Namen normalisiert vergleichen, wie beim Check-in und in der 7-Tage-Liste.
          const meLc = (displayName || '').trim().toLowerCase()
          const binHaupt = (val.chatter || '').trim().toLowerCase() === meLc
          const binZweit = !binHaupt && zellModus(val) === 'split'
            && (val.trainee || '').trim().toLowerCase() === meLc
          if (!binHaupt && !binZweit) continue
          const modelId = parts[0]
          const shift = parts[2]
          if (shift !== myShift) continue // v3.77.1: nur die eingecheckte Schicht kann auschecken
          // v2.9.7: Cell-Override hat Vorrang vor Standard-Zeit
          const standardZeit = (val.time_override || times[`${modelId}__${shift}`] || '').replace(/\s*\(DE\)/g, '')
          const timeStr = meineSpanne(val, standardZeit, binZweit)
          if (!timeStr) continue
          const endStr = timeStr.split('-')[1]?.trim()
          if (!endStr) continue
          const [endH, endM] = endStr.split(':').map(Number)
          if (isNaN(endH)) continue
          const startStr = timeStr.split('-')[0]?.trim()
          const [startH] = startStr ? startStr.split(':').map(Number) : [0]
          let endTotal = endH * 60 + endM
          const nowAdj = (endH < startH && nowTotal < startH * 60) ? nowTotal + 1440 : nowTotal
          if (endH < startH) endTotal += 1440
          if (spaetestesEnde == null || endTotal > spaetestesEnde) {
            spaetestesEnde = endTotal
            nowAdjMax = nowAdj
          }
        }
      }
      if (spaetestesEnde != null && nowAdjMax >= spaetestesEnde + 1) {
        await supabase.from('shift_logs').update({ checked_out_at: new Date().toISOString() }).eq('id', currentLogIdRef.current)
        setIsOnline(false)
        setCurrentLogId(null)
        setCurrentShift(null) // v3.77.1
        setCheckInTime(null)
        sendHeartbeat(false)
        return
      }
    }, 30000)
    return () => clearInterval(interval)
  }, [displayName])

  // Update heartbeat when online status changes
  useEffect(() => {
    sendHeartbeat(isOnline)
  }, [isOnline])

  // Sofort-Heartbeat wenn Tab wieder sichtbar wird (Backup gegen Browser-Throttling)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && isOnlineRef.current) {
        sendHeartbeat(true)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const loadOnlineStatus = async () => {
    if (!displayName) return
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data: openLogs, error } = await supabase
      .from('shift_logs')
      .select('*')
      .eq('display_name', displayName)
      .is('checked_out_at', null)
      .gte('checked_in_at', yesterday)
      .order('checked_in_at', { ascending: false })
    if (error) console.error('loadOnlineStatus error:', error)

    // Close all stale logs older than 24h
    await supabase.from('shift_logs')
      .update({ checked_out_at: new Date().toISOString() })
      .eq('display_name', displayName)
      .is('checked_out_at', null)
      .lt('checked_in_at', yesterday)

    if (!openLogs || openLogs.length === 0) return

    // Close duplicates
    if (openLogs.length > 1) {
      const toClose = openLogs.slice(1).map(l => l.id)
      await supabase.from('shift_logs')
        .update({ checked_out_at: new Date().toISOString() })
        .in('id', toClose)
    }

    const openLog = openLogs[0]
    setIsOnline(true)
    setCurrentLogId(openLog.id)
    setCurrentShift(openLog.shift || null) // v3.77.1
    setCheckInTime(new Date(openLog.checked_in_at))
    await sendHeartbeat(true)
  }

  const loadMessages = async () => {
    if (!displayName) return
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('direction', 'out')
      .eq('contact_type', 'chatter')
      .eq('model_name', displayName)
      .order('created_at', { ascending: false })
      .limit(10)
    setMessages(data || [])
  }

  const checkTodayNote = async () => {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
    const { data } = await supabase
      .from('notes')
      .select('id')
      .ilike('text', `Schichtnotiz von ${displayName}%`)
      .gte('created_at', today + 'T00:00:00')
      .limit(1)
    setHasShiftNote((data || []).length > 0)
  }

  const loadModels = async () => {
    const { data } = await supabase.from('models_contact').select('*').order('name')
    setModels(data || [])
    // v3.36.0: Profile/Export-Namen je Model laden (für Custom-Content-Auswahl)
    const { data: aliasData } = await supabase.from('model_aliases').select('*').order('model_name')
    setAliases(aliasData || [])
  }

  // v3.23.0: offboardete/stillgelegte Models nicht mehr in Auswahl-Dropdowns anbieten
  const activeModels = models.filter(m => m.active !== false)

  // v3.36.0: Auswahl-Optionen für Custom Content = echte Export-Profilnamen je Model.
  // Models mit Aliases → ein Eintrag pro Profil (csv_name). Models ohne Aliases → Fallback auf Model-Name.
  const profileOptions = (() => {
    const opts = []
    for (const m of activeModels) {
      const ma = aliases.filter(a => a.model_name === m.name && a.csv_name)
      if (ma.length > 0) {
        for (const a of ma) opts.push({ modelName: m.name, profileName: a.csv_name })
      } else {
        opts.push({ modelName: m.name, profileName: m.name })
      }
    }
    return opts
  })()
  // Gruppiert nach Model-Name für optgroup-Darstellung
  const profileOptionsByModel = profileOptions.reduce((acc, o) => {
    (acc[o.modelName] = acc[o.modelName] || []).push(o)
    return acc
  }, {})

  const loadSchedule = async () => {
    const { data } = await supabase.from('schedule').select('*').eq('week_start', weekKey).maybeSingle()
    if (data) {
      setScheduleData(data.assignments || {})
      setShiftTimes(data.shift_times || {})
    }
    // Also load next 7 days schedules
    await loadNext7Days()
  }

  const loadNext7Days = async () => {
    // v4.27.0: Wochenstarts aus dem BERLINER Tag ableiten, nicht aus dem lokalen.
    //
    // Vorher lief die Rechnung über `new Date()` in der Zeitzone des Browsers.
    // Für einen Chatter in Manila (+6 h) ist ab 18:00 deutscher Zeit schon der
    // nächste Kalendertag — Sonntagabend also bereits Montag. Dadurch wurde
    // ausgerechnet die Woche mit seiner Sonntag-Nachtschicht nicht mehr geladen:
    // die Schicht verschwand aus "Meine nächsten Schichten" UND aus der
    // Check-in-Leiste, tauchte am Montag aber wieder auf. Für Chatter in
    // Deutschland fiel das nie auf, weil dort lokaler Tag = Berliner Tag ist.
    //
    // Zusätzlich beginnt das Fenster jetzt bei -1 Tag: eine Nachtschicht, die
    // gestern (Berliner Zeit) begonnen hat, läuft real bis in den heutigen
    // Morgen und muss weiterhin ladbar sein.
    const basis = new Date(todayBerlin() + 'T12:00:00')  // Mittag = DST-sicher
    const weekStartsSet = new Set()
    for (let i = -1; i <= 7; i++) {
      const d = new Date(basis)
      d.setDate(basis.getDate() + i)
      const wd = d.getDay()
      const monday = new Date(d)
      monday.setDate(d.getDate() + (wd === 0 ? -6 : 1 - wd))
      weekStartsSet.add(isoDate(monday))
      // Sonntags-basierte Wochenstarts mitnehmen (Altbestand mit anderem Format)
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() - 1)
      weekStartsSet.add(isoDate(sunday))
    }
    const weekStarts = [...weekStartsSet]
    const { data } = await supabase.from('schedule').select('*').in('week_start', weekStarts).eq('status', 'live')
    setNext7Schedules(data || [])
    // Extract model names assigned to this chatter
    const todayIso = isoDate(new Date())
    const assignedNames = new Set()
    for (const sched of data || []) {
      for (const [key, val] of Object.entries(sched.assignments || {})) {
        if (val.chatter === displayName) {
          assignedNames.add(key.split('__')[0])
        }
      }
    }
    // Also get model names from models_contact
    const { data: modelsData } = await supabase.from('models_contact').select('name, id')
    const modelNameMap = {}
    for (const m of modelsData || []) modelNameMap[String(m.id)] = m.name
    const resolvedNames = [...assignedNames].map(id => modelNameMap[id] || id).filter(Boolean)
    if (resolvedNames.length > 0) loadAssignedModelData(resolvedNames)
    loadCustomerHistory(resolvedNames) // v3.58.0: Historie nur für zugeteilte Models (wie Boards)
  }

  const loadMyReminders = async () => {
    const { data } = await supabase.from('reminders')
      .select('*')
      .eq('chatter_name', displayName)
      .eq('sent', false)
      .order('send_at')
    setMyReminders(data || [])
  }

  const loadMyAbsences = async () => {
    const today = isoDate(new Date())
    const { data } = await supabase.from('absences')
      .select('*')
      .eq('chatter_name', displayName)
      .gte('date_to', today)
      .order('date_from')
    setMyAbsences(data || [])
  }

  const addAbsence = async () => {
    if (!newAbsenceDate) return
    setAbsentLoading(true)
    // newAbsenceShifts = Schichten, an denen man WEG ist.
    // Gespeichert wird die Verfügbarkeit = alle Schichten außer den abwesenden.
    const avail = newAbsenceShifts.length ? SHIFTS.filter(s => !newAbsenceShifts.includes(s)) : null
    await supabase.from('absences').insert({
      chatter_name: displayName,
      date_from: newAbsenceDate,
      date_to: newAbsenceDate,
      reason: newAbsenceReason || 'Nicht verfügbar',
      available_shifts: (avail && avail.length) ? avail : null,
      source: 'chatter',
    })
    setNewAbsenceDate('')
    setNewAbsenceReason('')
    setNewAbsenceShifts([])
    await loadMyAbsences()
    setAbsentLoading(false)
    alert('✓ Abwesenheit eingetragen!')
  }

  const deleteAbsence = async (id) => {
    await supabase.from('absences').delete().eq('id', id)
    loadMyAbsences()
  }

  const [lastStatDate, setLastStatDate] = useState(null)
  const [chatterCsvName, setChatterCsvName] = useState(null)

  const loadStats = async () => {
    // Load alias for this chatter
    const { data: aliasData } = await supabase
      .from('chatter_aliases')
      .select('csv_name')
      .eq('chatter_name', displayName)
      .maybeSingle()
    const csvName = aliasData?.csv_name || displayName
    setChatterCsvName(csvName)

    // v4.25.0: RPC statt select('*'). Vorher kamen 158 Tage mit den Zahlen aller
    // 67 Chatter in den Browser und wurden erst hier clientseitig gefiltert.
    // get_my_chatter_snapshots filtert serverseitig ueber
    // user_roles -> chatter_aliases -> csv_name und liefert dasselbe Format
    // (business_date + rows), deshalb bleibt die Auswertung unten unveraendert.
    const { data, error } = await supabase.rpc('get_my_chatter_snapshots')
    if (error) {
      // Nicht still scheitern: ohne Hinweis saehe eine fehlende oder kaputte RPC
      // exakt so aus wie "dieser Chatter hat noch keine Daten".
      console.error('get_my_chatter_snapshots fehlgeschlagen:', error)
      return
    }
    const snapshots = (data || []).map(s => ({
      businessDate: s.business_date,
      rows: s.rows,
    }))
    setChatterSnapshots(snapshots)

    // Find last day this chatter has data - match by csv_name
    const mySnaps = snapshots.filter(s =>
      s.rows?.some(r => r.name?.toLowerCase() === csvName?.toLowerCase())
    )
    if (mySnaps.length === 0) return
    const lastSnap = mySnaps[mySnaps.length - 1]
    const myRow = lastSnap.rows.find(r => r.name?.toLowerCase() === csvName?.toLowerCase())
    if (myRow) {
      setChatterStats(myRow)
      setLastStatDate(lastSnap.businessDate)
    }
  }

  const sendNote = async () => {
    if (!noteText.trim()) return
    setSendingNote(true)
    const modelPart = noteModel ? `[${noteModel}]` : ''
    const shiftPart = noteShift ? `[${noteShift}]` : ''
    const prefix = [modelPart, shiftPart].filter(Boolean).join(' ')
    try {
      // v3.71.0: Fehler abfangen + Button-Reset in finally.
      // Vorher blieb sendingNote bei einem Fehler auf true hängen -> Button dauerhaft deaktiviert
      // ("kann nicht drücken"), und ein RLS-/Serverfehler wurde faelschlich als Erfolg angezeigt.
      const { error } = await supabase.from('notes').insert({
        text: `Schichtnotiz von ${displayName}${prefix ? ' · ' + prefix : ''}: ${noteText.trim()}`,
        author: displayName,
      })
      if (error) {
        console.error('Notiz-Insert fehlgeschlagen:', error)
        alert('⚠️ Notiz konnte nicht gespeichert werden:\n' + (error.message || 'Unbekannter Fehler') + '\n\nBitte an einen Admin melden.')
        return
      }
      setNoteText('')
      setNoteModel('')
      setNoteShift('')
      setHasShiftNote(true)
      alert('✓ Notiz gesendet!')
    } catch (e) {
      console.error('Notiz-Insert Ausnahme:', e)
      alert('⚠️ Notiz konnte nicht gesendet werden (Netzwerk-/Serverfehler). Bitte erneut versuchen.')
    } finally {
      setSendingNote(false)
    }
  }

  // Reload when preview chatter changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (isPreview && displayName) { loadStats(); loadSchedule(); loadContentRequests(); loadModels(); loadGuidelines() } }, [previewChatter])

  // Get my shifts this week
  const myShifts = []
  const myNameLc = (displayName || '').trim().toLowerCase()
  for (const day of weekDays) {
    const dayIso = isoDate(day)
    for (const shift of SHIFTS) {
      const modelsInShift = []
      for (const [key, val] of Object.entries(scheduleData)) {
        const parts = key.split('__')
        const valChatterLc = (val.chatter || '').trim().toLowerCase()
        const valTraineeLc = (val.trainee || '').trim().toLowerCase()
        if (parts[1] === dayIso && parts[2] === shift && (valChatterLc === myNameLc || valTraineeLc === myNameLc)) {
          // Ich bin entweder Hauptchatter oder Trainee/Co-Chatter
          const asTrainee = valTraineeLc === myNameLc && valChatterLc !== myNameLc
          modelsInShift.push({ ...val, _asTrainee: asTrainee })
        }
      }
      if (modelsInShift.length > 0) {
        myShifts.push({ day, dayIso, shift, models: modelsInShift })
      }
    }
  }

  // v3.25.1: Schichten der nächsten 7 Tage INSTANT-basiert aufbauen (zeitzonen-korrekt,
  // auch über Mitternacht). Früher wurde nach String-Gleichheit von Berlin-Plandatum und
  // lokalem Kalendertag gebucket — dadurch fiel z.B. die Nachtschicht eines Chatters in
  // Thailand an seinem echten Schichttag aus der Liste und der Check-in war "weg".
  const nowMsN7 = Date.now()
  const horizonMsN7 = nowMsN7 + 7 * 24 * 60 * 60 * 1000
  const myNext7Shifts = []
  for (const sched of next7Schedules) {
    const assignments = sched.assignments || {}
    const times = sched.shift_times || {}
    // Meine Zuweisungen nach (Berlin-Plandatum + Schicht) gruppieren
    const groups = {}
    for (const [key, val] of Object.entries(assignments)) {
      const parts = key.split('__')
      const berlinDate = parts[1], shift = parts[2], modelId = parts[0]
      if (!SHIFTS.includes(shift)) continue
      const valChatterLc = (val.chatter || '').trim().toLowerCase()
      const valTraineeLc = (val.trainee || '').trim().toLowerCase()
      if (valChatterLc !== myNameLc && valTraineeLc !== myNameLc) continue
      const modelObj = models.find(m => String(m.id) === String(modelId))
      // v2.9.7: Cell-Override hat Vorrang
      const isOverridden = !!val.time_override
      const standardZeit = (val.time_override || times[`${modelId}__${shift}`] || '').replace(/\s*\(DE\)/g, '')
      const asTrainee = valTraineeLc === myNameLc && valChatterLc !== myNameLc
      const traineeMode = zellModus(val)
      // v4.34.0: Bei geteilter Schicht sieht jeder SEINEN Abschnitt — inklusive
      // Check-in-Fenster und Ablauf der Schicht in der 7-Tage-Liste.
      const timeStr = meineSpanne(val, standardZeit, asTrainee)
      const localTime = timeStr ? convertTimeToLocal(timeStr) : ''
      const partner = asTrainee ? val.chatter : val.trainee
      const gkey = `${berlinDate}__${shift}`
      const g = groups[gkey] || (groups[gkey] = { berlinDate, shift, timeStr, models: [] })
      if (!g.timeStr && timeStr) g.timeStr = timeStr
      g.models.push({ modelId, modelName: modelObj?.name || modelId, timeStr, localTime, asTrainee, traineeMode, mainChatter: val.chatter, partner, isOverridden })
    }
    for (const g of Object.values(groups)) {
      const window = shiftWindowInstants(g.berlinDate, g.timeStr)
      // v4.27.0: Fallback für Zellen OHNE hinterlegte Zeit (weder time_override
      // noch shift_times) auf Berliner Mitternacht umgestellt. Vorher stand hier
      // `new Date(berlinDate + 'T00:00:00')` — das ist Mitternacht im BROWSER.
      // In Manila lief eine solche Schicht dadurch sechs Stunden zu früh ab und
      // verschwand mitten in der Nachtschicht aus der Liste.
      const fallbackStart = berlinWallToInstant(g.berlinDate, 0, 0)
      const startMs = window ? window.start.getTime() : (fallbackStart ? fallbackStart.getTime() : Date.now())
      const endMs = window ? window.end.getTime() : startMs + 24 * 60 * 60 * 1000
      if (endMs < nowMsN7) continue            // schon vorbei -> raus (ersetzt altes isExpired)
      if (startMs > horizonMsN7) continue       // weiter als 7 Tage in der Zukunft -> raus
      const reminder = myReminders.find(r => r.shift_date === g.berlinDate && r.shift === g.shift)
      // Anzeige-Tag/Datum aus dem REALEN (lokalen) Start-Zeitpunkt ableiten
      const dayIso = window ? window.start.toLocaleDateString('sv-SE', { timeZone: LOCAL_TZ }) : g.berlinDate
      const dayObj = new Date(dayIso + 'T00:00:00')
      myNext7Shifts.push({ day: dayObj, dayIso, berlinDate: g.berlinDate, shift: g.shift, models: g.models, reminder, window })
    }
  }
  myNext7Shifts.sort((a, b) => (a.window ? a.window.start.getTime() : a.day.getTime()) - (b.window ? b.window.start.getTime() : b.day.getTime()))

  // v3.25.1: "Heute"/Check-in = lokaler Kalendertag ODER innerhalb des realen Schicht-Fensters
  // (-4h vor Start bis Ende). Für Berlin-Chatter unverändert (lokaler Tag = Berliner Tag),
  // fixt zusätzlich den Fall "über Berliner Mitternacht" (auch für Berlin-Nachtschichten).
  const localTodayIso = new Date().toLocaleDateString('sv-SE', { timeZone: LOCAL_TZ })
  const CHECKIN_PRE_MS = 4 * 60 * 60 * 1000
  const todayShifts = myNext7Shifts.filter(s => {
    if (s.dayIso === localTodayIso) return true
    if (s.window) {
      const n = Date.now()
      return n >= s.window.start.getTime() - CHECKIN_PRE_MS && n <= s.window.end.getTime()
    }
    return false
  })

  // Monthly revenue
  const currentMonth = new Date().toISOString().slice(0, 7)
  const monthSnaps = chatterSnapshots.filter(s => s.businessDate.startsWith(currentMonth))
  const monthRevenue = monthSnaps.reduce((sum, snap) => {
    const row = snap.rows?.find(r => r.name?.toLowerCase() === (chatterCsvName || displayName)?.toLowerCase())
    return sum + (row?.revenue || 0)
  }, 0)

  // Week stats from snapshots
  const weekSnaps = chatterSnapshots.filter(s => {
    const d = new Date(s.businessDate + 'T00:00:00')
    return d >= weekStart && d <= weekDays[6]
  })
  const weekRevenue = weekSnaps.reduce((sum, snap) => {
    const row = snap.rows?.find(r => r.name?.toLowerCase() === (chatterCsvName || displayName)?.toLowerCase())
    return sum + (row?.revenue || 0)
  }, 0)
  const weekMessages = weekSnaps.reduce((sum, snap) => {
    const row = snap.rows?.find(r => r.name?.toLowerCase() === (chatterCsvName || displayName)?.toLowerCase())
    return sum + (row?.sentMessages || 0)
  }, 0)
  const weekSentPPVs = weekSnaps.reduce((sum, snap) => {
    const row = snap.rows?.find(r => r.name?.toLowerCase() === (chatterCsvName || displayName)?.toLowerCase())
    return sum + (row?.sentPPVs || 0)
  }, 0)
  const weekBoughtPPVs = weekSnaps.reduce((sum, snap) => {
    const row = snap.rows?.find(r => r.name?.toLowerCase() === (chatterCsvName || displayName)?.toLowerCase())
    return sum + (row?.boughtPPVs || 0)
  }, 0)
  const weekBuyRate = weekSentPPVs > 0 ? (weekBoughtPPVs / weekSentPPVs * 100) : 0
  const weekActiveMinutes = weekSnaps.reduce((sum, snap) => {
    const row = snap.rows?.find(r => r.name?.toLowerCase() === (chatterCsvName || displayName)?.toLowerCase())
    return sum + (row?.activeMinutes || 0)
  }, 0)
  const weekRPH = weekActiveMinutes > 0 ? weekRevenue / (weekActiveMinutes / 60) : 0

  // Yesterday stats for delta
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  const yesterdaySnap = chatterSnapshots.find(s => s.businessDate === isoDate(yesterday))
  const yesterdayRow = yesterdaySnap?.rows?.find(r => r.name?.toLowerCase() === (chatterCsvName || displayName)?.toLowerCase())
  const revDelta = yesterdayRow ? pctChange(chatterStats?.revenue || 0, yesterdayRow.revenue) : 0

  const sR = { padding: '6px 0', borderBottom: '1px solid #1e1e3a', display: 'flex', justifyContent: 'space-between', fontSize: 12 }

  const formatResponseTime = (secs) => {
    if (!secs) return '—'
    const m = Math.floor(secs / 60)
    const s = Math.round(secs % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }

  const formatTime = (ts) => {
    const d = new Date(ts)
    const now = new Date()
    const diffH = (now - d) / 3600000
    if (diffH < 24) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  }

  // v4.18.0: Welche Schicht läuft gerade, und was steht heute sonst noch an?
  // `currentShift` kommt aus dem offenen shift_logs-Eintrag und ist damit die
  // Wahrheit — nicht die Liste aller Schichten des Tages.
  const laufendeSchicht = currentShift || selectedShift || (todayShifts.length === 1 ? todayShifts[0].shift : null)
  const laufenderEintrag = todayShifts.find(s => s.shift === laufendeSchicht)
  const laufendeModels = [...new Set((laufenderEintrag?.models || []).map(m => m.modelName || m))]
  const lokaleZeit = (d) => {
    try { return d.toLocaleTimeString('de-DE', { timeZone: LOCAL_TZ, hour: '2-digit', minute: '2-digit' }) }
    catch { return '' }
  }
  const jetztMs = Date.now()
  const weitereSchichten = todayShifts
    .filter(s => s.shift !== laufendeSchicht)
    .map(s => ({
      ...s,
      zeit: s.window ? `${lokaleZeit(s.window.start)}–${lokaleZeit(s.window.end)}` : '',
      // „läuft" = Fenster hat begonnen und ist noch nicht vorbei. Nur dann ist
      // ein Wechsel sinnvoll.
      laeuft: !!s.window && s.window.start.getTime() <= jetztMs && s.window.end.getTime() > jetztMs,
    }))

  return (
    <HelpProvider topics={HELP_TOPICS} tour={TOUR_IDS}>
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', fontFamily: 'var(--font-sans)', color: 'var(--text-primary)' }}>
      {/* Header */}
      <header ref={headerRef} style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(7,7,16,0.97)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid #1e1e3a', padding: '0 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        minHeight: 56, flexWrap: 'wrap', gap: 8,
      }}>
        {/* v4.8.0: Klick aufs Logo fuehrt zurueck auf die Startseite — wie im Admin-Dashboard.
            goTab() setzt den Tab, merkt ihn in localStorage und scrollt nach oben. */}
        <div
          onClick={() => goTab('heute')}
          title="Zur Startseite"
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', cursor: 'pointer' }}
        >
          {/* v4.7.0: gleiches Logo wie im Admin-Dashboard (vorher "T" in Cyan/Lila) */}
          <div style={{ width: 28, height: 28, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Logo size={28} />
          </div>
          <div style={{ minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Thirteen 87 Collective</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 6, letterSpacing: '0.05em' }}>Chatter Portal</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{APP_VERSION}</span>
          {isPreview ? (
            <select value={previewChatter} onChange={e => setPreviewChatter(e.target.value)}
              style={{ background: 'var(--bg-input)', border: '1px solid rgba(6,182,212,0.4)', color: '#06b6d4', padding: '4px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}>
              {allChatters.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{displayName}</span>
          )}
          {isSocialMedia && (
            <button onClick={() => setShowSocialPortal(!showSocialPortal)} style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, background: showSocialPortal ? '#ec4899' : 'rgba(236,72,153,0.12)', border: '1px solid rgba(236,72,153,0.3)', color: showSocialPortal ? '#fff' : '#ec4899', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
              Social
            </button>
          )}
          {onSwitchToAdmin && (
            <button onClick={onSwitchToAdmin} style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
              ⚙ Admin
            </button>
          )}
          <button onClick={() => supabase.auth.signOut()} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, background: 'transparent', border: '1px solid #1e1e3a', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>↩</button>
          <button onClick={toggleTheme} style={{ fontSize: 14, padding: '5px 8px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }} title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <main style={{ padding: '16px 20px', maxWidth: 1200, margin: '0 auto' }}>
        {showSocialPortal ? (
          <SocialTab session={session} userDisplayName={displayName} userRole="social_media" />
        ) : (
        <div>

        {/* PINNWAND - Aktive Ankündigungen oben */}
        {(() => {
          const now = new Date()
          const activeAnnouncements = announcements
            .filter(a => {
              if (a.expires_at && new Date(a.expires_at) < now) return false
              const archivedFor = Array.isArray(a.archived_for) ? a.archived_for : []
              if (archivedFor.includes(displayName)) return false
              return true
            })
            .slice(0, 2)
          if (activeAnnouncements.length === 0) return null
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {activeAnnouncements.map(ann => (
                <div key={ann.id} style={{
                  background: 'linear-gradient(135deg, rgba(124,58,237,0.12), rgba(6,182,212,0.08))',
                  border: '1px solid rgba(124,58,237,0.35)',
                  borderRadius: 12, padding: '14px 18px',
                  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                  gap: 12, flexWrap: 'wrap'
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 24, lineHeight: 1, flexShrink: 0,
                      width: 38, height: 38, borderRadius: 10,
                      background: 'rgba(124,58,237,0.2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>{ann.emoji || '📌'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {ann.text}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6, fontFamily: 'monospace' }}>
                        Von {ann.created_by} · {new Date(ann.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        {ann.expires_at && ` · läuft ab ${new Date(ann.expires_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
                      </div>
                    </div>
                  </div>
                  {displayName && (
                    <button onClick={() => archiveAnnouncement(ann.id)} title="Archivieren - bleibt im Verlauf" style={{
                      fontSize: 11, padding: '5px 10px', borderRadius: 6,
                      background: 'transparent', border: '1px solid rgba(124,58,237,0.3)',
                      color: '#a78bfa', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                      flexShrink: 0
                    }}>✓ Gelesen</button>
                  )}
                </div>
              ))}
            </div>
          )
        })()}

        {/* ================= v3.95.0: COCKPIT ================= */}
        {/* Die Schichtleiste klebt unter dem Kopf. Check-in/Check-out ist die
            wichtigste Aktion im Portal und darf beim Scrollen nie verschwinden. */}
        <div style={{
          position: 'sticky', top: headerH, zIndex: 40,
          margin: '0 -20px', padding: '0 20px',
          background: 'var(--bg-base)',
        }}>
        {/* Today Banner */}
        {/* v3.33.1: Auch anzeigen, wenn der Chatter ONLINE ist, aber keine heutige Plan-Schicht
            (mehr) erkannt wird — z. B. manueller Check-in, nur Co-Chatter/Trainee, Fenster vorbei
            oder Plan nachträglich geändert. Sonst gäbe es keinen "Schicht beenden"-Button. */}
        {(todayShifts.length > 0 || isOnline) && (
          <div data-help="schichtleiste" style={{ background: isOnline ? 'rgba(16,185,129,0.08)' : 'rgba(124,58,237,0.06)', border: `1px solid ${isOnline ? 'rgba(16,185,129,0.25)' : 'rgba(124,58,237,0.2)'}`, borderRadius: 12, padding: '11px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              {/* v4.18.0: Vorher wurden ALLE Schichten des Tages in eine Zeile
                  geklebt ("Spät + Nacht + Früh + Spät") und die Models aller
                  Schichten zusammengemischt. Wer in Asien sitzt, hat oft
                  Schichten aus zwei Berliner Tagen an einem lokalen Tag — dann
                  standen dort vier Schichten und es sah aus, als wäre alles eine.
                  Jetzt: nur die Schicht, in die tatsächlich eingecheckt wurde. */}
              <div style={{ fontSize: 14, fontWeight: 700, color: isOnline ? '#10b981' : 'var(--text-primary)', marginBottom: 3 }}>
                {isOnline ? '🟢 Schicht aktiv' : '⚪ Schicht noch nicht gestartet'}
                {isOnline
                  ? (laufendeSchicht ? ` · ${laufendeSchicht}` : '')
                  : todayShifts.length === 1 ? ` · ${todayShifts[0].shift}` : ''}
              </div>
              {isOnline && laufendeModels.length > 0 && (
                <div style={{ fontSize: 11, color: '#10b981', marginBottom: 2 }}>
                  Models: {laufendeModels.join(', ')}
                </div>
              )}
              {/* Weitere Schichten desselben lokalen Tages — einzeln, mit lokaler Zeit */}
              {weitereSchichten.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <span>Heute außerdem:</span>
                  {weitereSchichten.map(s => (
                    <span key={s.shift + s.dayIso} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '2px 8px', borderRadius: 5,
                      background: s.laeuft ? 'rgba(245,158,11,0.15)' : 'var(--bg-card2)',
                      border: `1px solid ${s.laeuft ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`,
                      color: s.laeuft ? '#f59e0b' : 'var(--text-secondary)',
                    }}>
                      <b>{s.shift}</b>
                      {s.zeit && <span style={{ fontFamily: 'monospace' }}>{s.zeit}</span>}
                      {isOnline && s.laeuft && (
                        <button
                          onClick={() => checkIn(s.shift)}
                          disabled={isCheckingIn}
                          title="Laufende Schicht beenden und diese starten"
                          style={{
                            background: 'transparent', border: 'none', color: '#f59e0b',
                            cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 700,
                            padding: 0, textDecoration: 'underline',
                          }}
                        >wechseln</button>
                      )}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {new Date().toLocaleDateString('de-DE', { timeZone: LOCAL_TZ, day: '2-digit', month: '2-digit', year: 'numeric' })}
                {checkInTime && ` · Eingecheckt: ${checkInTime.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {!isOnline ? (
                <>
                  {todayShifts.length > 1 && (
                    <select value={selectedShift} onChange={e => setSelectedShift(e.target.value)}
                      style={{ background: 'var(--bg-input)', border: '1px solid #7c3aed', color: 'var(--text-primary)', padding: '6px 10px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none', cursor: 'pointer' }}>
                      <option value="">Schicht wählen...</option>
                      {todayShifts.map(s => <option key={s.shift} value={s.shift}>{s.shift} · {s.models.map(m => m.modelName || m).join(', ')}</option>)}
                    </select>
                  )}
                  <button onClick={() => checkIn(todayShifts.length === 1 ? todayShifts[0].shift : selectedShift)} disabled={isCheckingIn || (todayShifts.length > 1 && !selectedShift)}
                    style={{ background: (isCheckingIn || (todayShifts.length > 1 && !selectedShift)) ? 'var(--border)' : '#10b981', color: (isCheckingIn || (todayShifts.length > 1 && !selectedShift)) ? 'var(--text-muted)' : '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: (isCheckingIn || (todayShifts.length > 1 && !selectedShift)) ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                    {isCheckingIn ? '⏳ ...' : `✓ ${todayShifts.length === 1 ? `${todayShifts[0].shift} starten` : 'Schicht starten'}`}
                  </button>
                </>
              ) : (
                /* v4.34.0: Auschecken geht jetzt über das Übergabe-Fenster.
                   Ohne die Migration (uebergabeMoeglich === false) bleibt es beim
                   direkten Auschecken wie bisher. */
                <button onClick={() => { if (!uebergabeMoeglich) { checkOut(); return } setUebergabeText(''); setUebergabeDialog(true) }} disabled={isCheckingOut} style={{ background: isCheckingOut ? 'rgba(239,68,68,0.05)' : 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: isCheckingOut ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                  {isCheckingOut ? '⏳ ...' : '✕ Schicht beenden'}
                </button>
              )}
            </div>
          </div>
        )}

        </div>{/* ── Ende klebende Schichtleiste ── */}

        {/* KPIs — v3.95.0: auto-fit statt fester 4 Spalten, damit sie auf dem Handy 2x2 stehen */}
        {lastStatDate && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, fontFamily: 'monospace' }}>
            Stats vom {new Date(lastStatDate + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
          </div>
        )}
        <div data-help="cockpit" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 12 }}>
          {[
            { label: 'Revenue', val: formatMoney(chatterStats?.revenue || 0), good: revDelta >= 0, accent: '#10b981' },
            { label: 'Buy Rate', val: chatterStats ? `${(chatterStats.buyRate || 0).toFixed(0)}%` : '—', good: (chatterStats?.buyRate || 0) >= 25, accent: '#06b6d4' },
            { label: 'Ø Antw.', val: formatResponseTime(chatterStats?.avgResponseSeconds), good: (chatterStats?.avgResponseSeconds || 0) <= 120, accent: '#f59e0b' },
            { label: 'Msgs', val: (chatterStats?.sentMessages || 0).toString(), good: (chatterStats?.sentMessages || 0) > 50, accent: '#a78bfa' },
          ].map(kpi => (
            <div key={kpi.label} style={{ background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 8, padding: '8px 10px', minWidth: 0 }}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 2 }}>{kpi.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', color: kpi.good ? kpi.accent : 'var(--text-primary)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{kpi.val}</div>
            </div>
          ))}
        </div>

        {/* ── v3.95.0: Handlungs-Chips ──
            Ersetzen die früheren Schichtnotiz-Banner. Zeigen NUR, was offen ist —
            gibt es nichts zu tun, erscheint hier auch nichts. Klick springt zur Stelle. */}
        {(() => {
          const openTodos = myTodos.filter(t => !t.completed).length
          const openContent = contentRequests.filter(r => r.status === 'angefragt' || r.status === 'bestaetigt').length
          const chips = []
          if (openTodos > 0) chips.push({
            key: 'todos', tone: '#ef4444', count: openTodos, label: openTodos === 1 ? 'Aufgabe offen' : 'Aufgaben offen',
            onClick: () => { goTab('heute'); openPanel('todos') },
          })
          if (isOnline && !hasShiftNote) chips.push({
            key: 'note', tone: '#f59e0b', icon: '📝', label: 'Schichtnotiz fehlt',
            onClick: () => {
              goTab('heute'); openPanel('messages')
              setTimeout(() => {
                noteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                setTimeout(() => noteRef.current?.querySelector('textarea')?.focus(), 400)
              }, 120)
            },
          })
          if (isOnline && hasShiftNote) chips.push({
            key: 'note-ok', tone: '#10b981', icon: '✅', label: 'Schichtnotiz erledigt', onClick: null,
          })
          // v4.34.0: Übergabe der Vorschicht — bleibt stehen, bis sie bestätigt ist.
          if (eingangUebergaben.length > 0) chips.push({
            key: 'uebergabe', tone: '#ec4899', icon: '🤝',
            count: eingangUebergaben.length > 1 ? eingangUebergaben.length : null,
            label: eingangUebergaben.length > 1 ? 'Übergaben lesen' : 'Übergabe der Vorschicht',
            onClick: () => setUebergabeEingangOffen(true),
          })
          if (openContent > 0) chips.push({
            key: 'content', tone: '#06b6d4', count: openContent, label: 'Custom offen',
            onClick: () => { goTab('content'); openPanel('content') },
          })
          if (chips.length === 0) return null
          return (
            <div data-help="chips" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              {chips.map(c => {
                const inner = (
                  <>
                    {c.count != null && (
                      <span style={{
                        minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999,
                        background: c.tone, color: '#fff', fontSize: 10, fontWeight: 800,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                      }}>{c.count}</span>
                    )}
                    {c.icon && <span style={{ fontSize: 13 }}>{c.icon}</span>}
                    <span>{c.label}</span>
                  </>
                )
                const st = {
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  padding: '7px 13px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                  fontFamily: 'inherit', background: c.tone + '18',
                  border: `1px solid ${c.tone}55`, color: c.tone,
                }
                return c.onClick
                  ? <button key={c.key} onClick={c.onClick} style={{ ...st, cursor: 'pointer' }}>{inner}</button>
                  : <span key={c.key} style={st}>{inner}</span>
              })}
            </div>
          )
        })()}

        {/* ── v3.95.0: Tab-Navigation ──
            Vier Arbeitsmomente statt einer Liste aus 13 Panels. Badge = etwas offen. */}
        {(() => {
          // v3.98.0: Team-Nachrichten zählen hier nicht mehr mit — dafür ist der
          // Zähler an der Chat-Bubble zuständig, sonst wird dieselbe Sache doppelt gemeldet.
          const openTodos = myTodos.filter(t => !t.completed).length
          const openContent = contentRequests.filter(r => r.status === 'angefragt' || r.status === 'bestaetigt').length
          const TABS = [
            { key: 'heute', icon: '📅', label: 'Heute', badge: openTodos, urgent: openTodos > 0 },
            { key: 'models', icon: '🎬', label: 'Models', badge: 0 },
            { key: 'content', icon: '📥', label: 'Content', badge: openContent },
            { key: 'orga', icon: '🗂️', label: 'Organisation', badge: 0 },
            { key: 'mehr', icon: '📚', label: 'Mehr', badge: 0 },
          ]
          return (
            <div data-help="tabs" style={{
              display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4,
              borderBottom: '1px solid var(--border)', marginBottom: 16,
              scrollbarWidth: 'none',
            }}>
              {TABS.map(t => {
                const on = tab === t.key
                return (
                  <button key={t.key} onClick={() => goTab(t.key)} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
                    padding: '9px 16px', borderRadius: '10px 10px 0 0', fontSize: 13, fontWeight: 600,
                    fontFamily: 'inherit', cursor: 'pointer', marginBottom: -5,
                    background: on ? 'rgba(124,58,237,0.12)' : 'transparent',
                    color: on ? 'var(--text-primary)' : 'var(--text-secondary)',
                    border: 'none', borderBottom: `2px solid ${on ? '#7c3aed' : 'transparent'}`,
                  }}>
                    <span style={{ fontSize: 15 }}>{t.icon}</span>
                    <span>{t.label}</span>
                    {t.badge > 0 && (
                      <span style={{
                        minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999,
                        background: t.urgent ? '#ef4444' : '#7c3aed', color: '#fff',
                        fontSize: 10, fontWeight: 800, display: 'inline-flex',
                        alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                      }}>{t.badge}</span>
                    )}
                  </button>
                )
              })}
            </div>
          )
        })()}

        <Collapsible helpId="todos" hidden={tab !== 'heute' || myTodos.length === 0} isCollapsed={collapsed.todos} onToggle={() => toggleCollapse('todos')} icon="📋" title="Meine Aufgaben" badge={myTodos.filter(t => !t.completed).length || null} badgeColor="#ef4444">
          {myTodos.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 2px' }}>Aktuell keine Aufgaben für dich.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[...myTodos].sort((a, b) => (a.completed ? 1 : 0) - (b.completed ? 1 : 0)).map(todo => {
                const prio = TODO_PRIORITY[todo.priority] || TODO_PRIORITY.normal
                const draft = todoNoteDrafts[todo.id]
                const noteEditing = draft !== undefined
                return (
                  <div key={todo.id} style={{ padding: '11px 13px', borderRadius: 9, background: todo.completed ? 'var(--bg-card2)' : prio.color + '0d', border: `1px solid ${todo.completed ? 'var(--border)' : prio.color + '40'}`, opacity: todo.completed ? 0.7 : 1 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <div onClick={() => toggleMyTodo(todo)} title={todo.completed ? 'Wieder öffnen' : 'Abhaken'} style={{ width: 20, height: 20, borderRadius: 5, flexShrink: 0, marginTop: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: todo.completed ? '#10b981' : 'transparent', border: `1.5px solid ${todo.completed ? '#10b981' : prio.color}` }}>
                        {todo.completed && <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>✓</span>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', textDecoration: todo.completed ? 'line-through' : 'none' }}>{todo.title}</div>
                        {todo.description && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.4 }}>{todo.description}</div>}
                        <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 4, background: prio.color + '22', color: prio.color }}>{prio.label}</span>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>von {todo.created_by || 'Team'}</span>
                        </div>

                        {noteEditing ? (
                          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <textarea value={draft} onChange={e => setTodoNoteDrafts(prev => ({ ...prev, [todo.id]: e.target.value }))} rows={2}
                              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none', resize: 'vertical' }}
                              placeholder="Kurze Rückmeldung ans Team…" autoFocus />
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={() => saveTodoNote(todo)} style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, background: '#7c3aed', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>Speichern</button>
                              <button onClick={() => setTodoNoteDrafts(prev => { const n = { ...prev }; delete n[todo.id]; return n })} style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>Abbrechen</button>
                            </div>
                          </div>
                        ) : todo.assignee_note ? (
                          <div style={{ marginTop: 8, padding: '7px 10px', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 7 }}>
                            <div style={{ fontSize: 10, color: '#a78bfa', fontWeight: 700, marginBottom: 2 }}>💬 Deine Rückmeldung</div>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{todo.assignee_note}</div>
                            <button onClick={() => setTodoNoteDrafts(prev => ({ ...prev, [todo.id]: todo.assignee_note || '' }))} style={{ marginTop: 5, fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>Bearbeiten</button>
                          </div>
                        ) : (
                          <button onClick={() => setTodoNoteDrafts(prev => ({ ...prev, [todo.id]: '' }))} style={{ marginTop: 8, fontSize: 11, padding: '4px 10px', borderRadius: 6, background: 'transparent', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.3)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>+ Rückmeldung</button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Collapsible>

        <Collapsible helpId="shifts" hidden={tab !== 'heute'} isCollapsed={collapsed.shifts} onToggle={() => toggleCollapse('shifts')} icon="📅" title="Meine Schichten – nächste 7 Tage" badge={todayShifts.length > 0 ? 'Heute' : myNext7Shifts.length} badgeColor="#06b6d4">
          {/* My Shifts – next 7 days */}
          <div>
            {myNext7Shifts.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0', textAlign: 'center' }}>Kein veröffentlichter Plan für die nächsten 7 Tage</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {myNext7Shifts.map((s, i) => {
                  // v3.25.1: Label/Heute aus realem (lokalem) Schicht-Zeitpunkt statt Berlin-Plandatum
                  const today = s.dayIso === localTodayIso
                  const past = s.window ? Date.now() > s.window.end.getTime() : (s.day < new Date() && !today)
                  const dayLabel = s.window
                    ? s.window.start.toLocaleDateString('de-DE', { timeZone: LOCAL_TZ, weekday: 'short', day: '2-digit', month: '2-digit' })
                    : s.day.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
                  // v2.9.0: Bin ich Trainee/Co bei mind. einem Model in dieser Schicht?
                  const traineeEntry = s.models.find(m => m.asTrainee)
                  // v4.34.0: geteilte Schicht auch aus Sicht des Hauptchatters erkennen
                  const splitEntry = s.models.find(m => m.traineeMode === 'split' && m.partner)
                  // Standard: nur heute offen. Klick auf eine Zeile klappt sie auf/zu.
                  const isOpen = openShiftIdx === i || (openShiftIdx === null && today)
                  return (
                    <div key={i}
                      onClick={() => setOpenShiftIdx(isOpen ? -1 : i)}
                      style={{
                        padding: '10px 12px', background: today ? 'rgba(16,185,129,0.05)' : 'var(--bg-card2)',
                        borderRadius: 8, border: `1px solid ${today ? 'rgba(16,185,129,0.3)' : 'var(--border)'}`,
                        cursor: 'pointer',
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isOpen ? 8 : 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 4, height: 32, borderRadius: 2, background: SHIFT_COLORS[s.shift], flexShrink: 0 }} />
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: today ? '#10b981' : 'var(--text-primary)' }}>
                              {dayLabel}{today ? ' · Heute' : ''}
                            </div>
                            <div style={{ fontSize: 10, color: s.models[0]?.isOverridden ? '#f97316' : 'var(--text-secondary)', marginTop: 1, fontWeight: s.models[0]?.isOverridden ? 700 : 400 }}>
                              {s.shift}{s.models[0]?.localTime ? ` · ${s.models[0].localTime} (lokal)` : s.models[0]?.timeStr ? ` · ${s.models[0].timeStr} (DE)` : ''}
                              {s.models[0]?.isOverridden && ' ⚠ abweichend'}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {/* v4.34.0: Kennzeichnung jetzt auch für den HAUPTchatter einer
                              geteilten Schicht — vorher sah nur die zweite Person, dass
                              sie sich die Schicht teilt. */}
                          {(traineeEntry || splitEntry) && (() => {
                            const eintrag = traineeEntry || splitEntry
                            const meta = MODUS_META[eintrag.traineeMode] || MODUS_META.anlernen
                            const gegenueber = eintrag.partner || eintrag.mainChatter
                            return (
                              <span style={{
                                fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 700,
                                background: `${meta.color}26`, color: meta.color,
                                border: `1px solid ${meta.color}4D`,
                              }}>{meta.icon} {meta.label}{gegenueber ? ` · mit ${gegenueber}` : ''}</span>
                            )
                          })()}
                          {s.reminder && (
                            <span style={{ fontSize: 10, color: '#06b6d4', background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.3)', padding: '2px 7px', borderRadius: 4 }}>🔔</span>
                          )}
                          <span style={{
                            fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 700,
                            background: today ? 'rgba(16,185,129,0.15)' : past ? 'rgba(255,255,255,0.04)' : 'rgba(124,58,237,0.15)',
                            color: today ? '#10b981' : past ? 'var(--text-muted)' : '#a78bfa',
                          }}>
                            {today ? 'Heute' : past ? 'Erledigt' : 'Geplant'}
                          </span>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 10, textAlign: 'center' }}>{isOpen ? '▼' : '▶'}</span>
                        </div>
                      </div>
                      {/* Model list — nur wenn aufgeklappt */}
                      {isOpen && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: 14 }}>
                          {s.models.map((m, mi) => (
                            <span key={mi} style={{ fontSize: 10, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 7px', color: 'var(--text-secondary)' }}>
                              {m.modelName}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

          </div>
        </Collapsible>

        {/* v3.98.0: Abwesenheit aus dem Schichten-Panel herausgelöst und in den
            Organisation-Tab verschoben — das Schichten-Panel war zu voll. */}
        <Collapsible helpId="absence" hidden={tab !== 'orga'} isCollapsed={collapsed.absence} onToggle={() => toggleCollapse('absence')} icon="🌴" title="Ich bin nicht verfügbar am" badge={myAbsences.length || null} badgeColor="#ef4444">
          <div>
              {/* v3.49.0: Info-Hinweis zur Vorlauf-Orientierung (nur Erklärtext, keine Sperre) */}
              <div style={{ fontSize: 11, lineHeight: 1.55, color: 'var(--text-muted)', background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.22)', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
                <div style={{ fontWeight: 700, color: '#a78bfa', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>ℹ️</span> Kurz zur Orientierung
                </div>
                Plane deine freien Tage bitte mit etwas Vorlauf – je mehr du bei uns arbeitest, desto mehr zählen wir auf dich:
                <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span>• <b style={{ color: 'var(--text-primary)' }}>4+ Tage/Woche</b> → ca. 2 Wochen vorher eintragen</span>
                  <span>• <b style={{ color: 'var(--text-primary)' }}>3 Tage/Woche</b> → ca. 10 Tage vorher</span>
                  <span>• <b style={{ color: 'var(--text-primary)' }}>1–2 Tage/Woche</b> → ca. 1 Woche vorher reicht</span>
                </div>
                <div style={{ marginTop: 7 }}>Krank geworden? Kein Stress – das geht natürlich auch kurzfristig, trag es dann einfach direkt hier ein.</div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <input type="date" value={newAbsenceDate} onChange={e => setNewAbsenceDate(e.target.value)}
                  style={{ background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '6px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'monospace', outline: 'none', flex: 1 }} />
                <input value={newAbsenceReason} onChange={e => setNewAbsenceReason(e.target.value)}
                  placeholder="Grund (optional)"
                  style={{ background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '6px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none', flex: 1 }} />
                <button onClick={addAbsence} disabled={!newAbsenceDate || absentLoading}
                  style={{ background: newAbsenceDate ? 'rgba(239,68,68,0.15)' : 'var(--border)', color: newAbsenceDate ? '#ef4444' : 'var(--text-muted)', border: `1px solid ${newAbsenceDate ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`, borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                  + Eintragen
                </button>
              </div>
              <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Weg an:</span>
                <button type="button" onClick={() => setNewAbsenceShifts([])}
                  style={{ padding: '5px 9px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    background: newAbsenceShifts.length === 0 ? 'rgba(239,68,68,0.15)' : 'var(--bg-input)',
                    color: newAbsenceShifts.length === 0 ? '#ef4444' : 'var(--text-muted)',
                    border: `1px solid ${newAbsenceShifts.length === 0 ? 'rgba(239,68,68,0.4)' : '#2e2e5a'}` }}>Ganzer Tag</button>
                {SHIFTS.map(s => {
                  const on = newAbsenceShifts.includes(s)
                  return (
                    <button key={s} type="button"
                      onClick={() => setNewAbsenceShifts(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])}
                      style={{ padding: '5px 9px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                        background: on ? 'rgba(239,68,68,0.18)' : 'var(--bg-input)',
                        color: on ? '#ef4444' : 'var(--text-muted)',
                        border: `1px solid ${on ? 'rgba(239,68,68,0.45)' : '#2e2e5a'}` }}>{on ? '✕ ' : ''}{s}</button>
                  )
                })}
              </div>
              {myAbsences.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {myAbsences.map(a => (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'rgba(239,68,68,0.06)', borderRadius: 6, border: '1px solid rgba(239,68,68,0.2)', fontSize: 12 }}>
                      <span style={{ color: '#ef4444' }}>{new Date(a.date_from + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })} · {a.reason}{(a.available_shifts && a.available_shifts.length) ? ` · ${SHIFTS.filter(s => !a.available_shifts.includes(s)).join('/')} weg` : ''}</span>
                      <button onClick={() => deleteAbsence(a.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
          </div>
        </Collapsible>

        {/* v3.98.0: Die Liste "Nachrichten vom Team" ist raus — die Chat-Bubble unten
            rechts zeigt denselben Verlauf, nur vollständig und in beide Richtungen.
            Übrig bleibt die Schichtnotiz, die hier ihren angestammten Platz hat. */}
        <Collapsible helpId="messages" hidden={tab !== 'heute'} isCollapsed={collapsed.messages} onToggle={() => toggleCollapse('messages')} icon="📝" title="Schichtnotiz" badge={isOnline && !hasShiftNote ? 'offen' : null} badgeColor="#f59e0b">
          <div>
            <div ref={noteRef}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 120 }}>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Model</label>
                  <select
                    value={noteModel}
                    onChange={e => setNoteModel(e.target.value)}
                    style={{ background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: noteModel ? 'var(--text-primary)' : 'var(--text-muted)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
                  >
                    <option value="">— Model wählen —</option>
                    {myShifts.filter(s => s.dayIso === todayIso).flatMap(s => Object.values(s.models)).map((_, i) => null)}
                    {[...new Set(myShifts.map(s => s.dayIso === todayIso ? s.shift : null).filter(Boolean))].length > 0
                      ? myShifts.filter(s => s.dayIso === todayIso).map((s, i) => (
                          <option key={i} value={s.shift}>{s.shift}</option>
                        ))
                      : null
                    }
                    {activeModels.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Schicht</label>
                  <select
                    value={noteShift}
                    onChange={e => setNoteShift(e.target.value)}
                    style={{ background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: noteShift ? 'var(--text-primary)' : 'var(--text-muted)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
                  >
                    <option value="">— Schicht —</option>
                    {['Vorschicht', 'Früh', 'Spät', 'Nacht'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                rows={2}
                placeholder="z.B. Sehr aktiv heute, viele PPVs verkauft..."
                style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 7, fontSize: 12, resize: 'none', fontFamily: 'inherit', outline: 'none', marginBottom: 8 }}
              />
              <button onClick={sendNote} disabled={sendingNote || !noteText.trim()} style={{
                background: noteText.trim() ? '#7c3aed' : 'var(--border)', color: noteText.trim() ? '#fff' : 'var(--text-muted)',
                border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 700, cursor: noteText.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
              }}>{sendingNote ? 'Senden...' : 'Notiz senden'}</button>
            </div>
          </div>
        </Collapsible>

        {/* v3.81.0: KI-Nachrichten-Vorschläge · v3.95.0: im Models-Tab.
            display:none statt Ausbau — sonst gingen erzeugte Vorschläge beim Tab-Wechsel verloren. */}
        <div data-help="suggestions" style={{ display: tab === 'models' ? 'block' : 'none' }}>
          <MessageSuggestions displayName={displayName} />
        </div>

        {/* Meine Models – Board & Videos */}
        {Object.keys(assignedModelBoards).length > 0 && (
          <Collapsible helpId="models" hidden={tab !== 'models'} isCollapsed={collapsed.models} onToggle={() => toggleCollapse('models')} icon="🎬" title="Meine Models" badge={Object.keys(assignedModelBoards).length} badgeColor="#f59e0b">
          <div>
            {/* v3.98.0: Ohne Hinweis war nicht erkennbar, dass die Namen anklickbar sind */}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 9, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>👆</span>
              <span>Tippe auf ein Model, um Board, Preise, Regeln und Videos zu sehen.</span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {Object.keys(assignedModelBoards).map(name => (
                <button key={name} onClick={() => setSelectedModelInfo(selectedModelInfo === name ? null : name)}
                  style={{ padding: '5px 14px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 12,
                    background: selectedModelInfo === name ? '#f59e0b' : 'var(--bg-card)',
                    color: selectedModelInfo === name ? '#000' : 'var(--text-secondary)',
                    border: `1px solid ${selectedModelInfo === name ? '#f59e0b' : '#2e2e5a'}` }}>
                  {name}
                </button>
              ))}
            </div>

            {selectedModelInfo && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
                {/* Board categories */}
                {Object.entries(assignedModelBoards[selectedModelInfo] || {}).map(([cat, items]) => {
                  const catColors = { preise: '#10b981', nogos: '#ef4444', regeln: '#a78bfa', services: '#f59e0b', einschraenkungen: '#06b6d4', reise: '#06b6d4', termine: '#7c3aed' }
                  const catLabels = { preise: 'Preisstruktur', nogos: 'No Gos', regeln: 'Content Regeln', services: 'Services', einschraenkungen: 'Einschränkungen', reise: 'Reiseplan', termine: 'Termine' }
                  const color = catColors[cat] || '#a78bfa'
                  return (
                    <div key={cat} style={{ background: 'var(--bg-card)', border: `1px solid ${color}33`, borderLeft: `3px solid ${color}`, borderRadius: '0 9px 9px 0', padding: '10px 12px' }}>
                      <div style={{ fontSize: 9, color, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 8 }}>{catLabels[cat] || cat}</div>
                      {items.map(item => (
                        <div key={item.id} style={{ padding: '6px 8px', background: 'var(--bg-card2)', borderRadius: 6, border: '1px solid #1e1e3a', marginBottom: 5 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>{item.title}</div>
                          {item.content && <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 1 }}>{item.content}</div>}
                          {item.price && <div style={{ fontSize: 11, fontWeight: 700, color, marginTop: 2 }}>{item.price}</div>}
                        </div>
                      ))}
                    </div>
                  )
                })}

                {/* Social Media Kanäle */}
                {(assignedModelSocials[selectedModelInfo] || []).length > 0 && (
                  <SocialLinksView links={assignedModelSocials[selectedModelInfo] || []} />
                )}

                {/* Services */}
                {Object.keys(assignedServices[selectedModelInfo] || {}).length > 0 && (
                  <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(249,115,22,0.3)', borderLeft: '3px solid #f97316', borderRadius: '0 9px 9px 0', padding: '10px 12px' }}>
                    <div style={{ fontSize: 9, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 8 }}>Services</div>
                    {Object.entries(assignedServices[selectedModelInfo] || {}).map(([key, svc]) => {
                      const labels = { bewertungen: 'Bewertungen', audios: 'Audios', video_chat: 'Video Chat (VC)', telefonieren: 'Telefonieren' }
                      return (
                        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', background: 'var(--bg-card2)', borderRadius: 6, border: '1px solid #1e1e3a', marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{labels[key] || key}</span>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: svc.enabled ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)', color: svc.enabled ? '#10b981' : '#ef4444' }}>
                              {svc.enabled ? 'Ja' : 'Nein'}
                            </span>
                            {svc.enabled && svc.note && <span style={{ fontSize: 10, color: '#f59e0b' }}>{svc.note}</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Custom Content */}
                {(assignedCustomContent[selectedModelInfo] || []).length > 0 && (
                  <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(124,58,237,0.3)', borderLeft: '3px solid #7c3aed', borderRadius: '0 9px 9px 0', padding: '10px 12px' }}>
                    <div style={{ fontSize: 9, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 8 }}>
                      Custom Content · {(assignedCustomContent[selectedModelInfo] || []).length}
                    </div>
                    {(assignedCustomContent[selectedModelInfo] || []).map(cc => {
                      const isOverdue = cc.due_date && cc.due_date < new Date().toISOString().slice(0, 10)
                      const color = isOverdue ? '#ef4444' : '#f59e0b'
                      return (
                        <div key={cc.id} style={{ padding: '6px 8px', background: isOverdue ? 'rgba(239,68,68,0.05)' : 'rgba(245,158,11,0.04)', borderRadius: 6, border: `1px solid ${color}33`, marginBottom: 5 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>{cc.title}</span>
                            {cc.due_date && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: color + '22', color, flexShrink: 0 }}>
                              {isOverdue ? '! ' : ''}{new Date(cc.due_date + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
                            </span>}
                          </div>
                          {cc.description && <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{cc.description}</div>}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Videos */}
                {(assignedModelVideos[selectedModelInfo] || []).length > 0 && (
                  <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(239,68,68,0.3)', borderLeft: '3px solid #ef4444', borderRadius: '0 9px 9px 0', padding: '10px 12px' }}>
                    <div style={{ fontSize: 9, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 8 }}>Bevorstehende Videos</div>
                    {(assignedModelVideos[selectedModelInfo] || []).map(video => (
                      <div key={video.id} style={{ display: 'flex', gap: 10, padding: '6px 8px', background: 'var(--bg-card2)', borderRadius: 6, border: '1px solid #1e1e3a', marginBottom: 5, alignItems: 'flex-start' }}>
                        {video.thumbnail_url ? (
                          <img src={video.thumbnail_url} alt={video.title} style={{ width: 50, height: 38, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                        ) : (
                          <div style={{ width: 50, height: 38, borderRadius: 4, background: '#1e1e3a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>🎬</div>
                        )}
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>{video.title}</div>
                          {video.release_date && <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 2, fontFamily: 'monospace' }}>{new Date(video.release_date + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          </Collapsible>
        )}

        {/* Content Requests */}
        <Collapsible helpId="content" hidden={tab !== 'content'} isCollapsed={collapsed.content} onToggle={() => toggleCollapse('content')} icon="🎬" title="Custom Content" badge={contentRequests.filter(r => r.status === 'angefragt' || r.status === 'bestaetigt').length || null} badgeColor="#06b6d4">
        <div>
            {!showNewRequestForm ? (
              <button onClick={() => setShowNewRequestForm(true)} style={{
                width: '100%', padding: '10px 14px', borderRadius: 8,
                background: 'rgba(124,58,237,0.1)', border: '1px dashed rgba(124,58,237,0.3)',
                color: '#a78bfa', cursor: 'pointer', fontFamily: 'inherit',
                fontWeight: 600, fontSize: 13, marginBottom: 12
              }}>+ Neue Content-Anfrage erstellen</button>
            ) : (
            <div style={{ background: 'var(--bg-card2)', borderRadius: 8, padding: '12px', marginBottom: 12, border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Neue Anfrage</div>
              <button onClick={() => setShowNewRequestForm(false)} style={{
                background: 'transparent', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', padding: 0
              }}>✕</button>
            </div>
            {/* v3.50.0: Typ-Auswahl (volle Breite, 6 Typen inkl. Live-Leistungen 🔴) */}
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Typ *</label>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {Object.entries(CONTENT_TYPE_META).map(([k, meta]) => (
                  <button key={k} onClick={() => setNewRequestType(k)} style={{
                    flex: '1 1 28%', minWidth: 88, padding: '6px 4px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, fontWeight: 600,
                    background: newRequestType === k ? 'rgba(124,58,237,0.2)' : 'transparent',
                    color: newRequestType === k ? '#a78bfa' : 'var(--text-muted)',
                    border: `1px solid ${newRequestType === k ? '#7c3aed' : 'var(--border)'}`,
                  }}>{meta.live ? '🔴 ' : ''}{meta.label}</button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Model / Profil *</label>
                <select value={newRequestProfile} onChange={e => {
                    const pn = e.target.value
                    const opt = profileOptions.find(o => o.profileName === pn)
                    setNewRequestProfile(pn)
                    setNewRequestModel(opt ? opt.modelName : '')
                  }}
                  style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}>
                  <option value="">— wählen —</option>
                  {Object.entries(profileOptionsByModel).map(([modelName, opts]) => (
                    (opts.length === 1 && opts[0].profileName === modelName)
                      ? <option key={modelName} value={opts[0].profileName}>{modelName}</option>
                      : <optgroup key={modelName} label={modelName}>
                          {opts.map(o => <option key={o.profileName} value={o.profileName}>{o.profileName}</option>)}
                        </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Kundennummer</label>
                <input value={newRequestCustomerId} onChange={e => setNewRequestCustomerId(e.target.value)}
                  style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
                  placeholder="#FAN-xxxx" />
              </div>
            </div>

            {/* v3.50.0: Bezahl-Status als 3-Stufen-Umschalter (mappt intern auf deposit_paid / remainder_paid) */}
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Bezahlung</label>
              <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                {[['anfrage','Anfrage','#a78bfa'],['angezahlt','Angezahlt','#f59e0b'],['bezahlt','Bezahlt','#10b981']].map(([k,l,c]) => (
                  <button key={k} onClick={() => setNewRequestPayStatus(k)} style={{
                    flex: 1, padding: '6px 4px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
                    background: newRequestPayStatus === k ? c + '22' : 'transparent',
                    color: newRequestPayStatus === k ? c : 'var(--text-muted)',
                    border: `1px solid ${newRequestPayStatus === k ? c : 'var(--border)'}`,
                  }}>{l}</button>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: newRequestPayStatus === 'angezahlt' ? '1fr 1fr' : '1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Gesamtpreis</label>
                  <input type="number" value={newRequestPrice} onChange={e => setNewRequestPrice(e.target.value)}
                    style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
                    placeholder="$0" />
                </div>
                {newRequestPayStatus === 'angezahlt' && (
                  <div>
                    <label style={{ fontSize: 10, color: '#f59e0b', display: 'block', marginBottom: 3 }}>Anzahlung erhalten</label>
                    <input type="number" value={newRequestDeposit} onChange={e => setNewRequestDeposit(e.target.value)}
                      style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #f59e0b55', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
                      placeholder="$0" />
                  </div>
                )}
              </div>
              {newRequestPayStatus === 'angezahlt' && !(parseFloat(newRequestDeposit) > 0) && (
                <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 4 }}>Bitte Anzahlungsbetrag eintragen, sonst wird nichts als bezahlt markiert.</div>
              )}
            </div>

            {/* Länge / Anzahl – Label & Felder je nach Typ */}
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>{(CONTENT_TYPE_META[newRequestType] || {}).durLabel || 'Länge / Anzahl'}</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <input value={newRequestDuration} onChange={e => setNewRequestDuration(e.target.value)}
                  style={{ flex: 1, background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
                  placeholder={(CONTENT_TYPE_META[newRequestType] || {}).durPlaceholder || ''} />
                {(CONTENT_TYPE_META[newRequestType] || {}).showQuantity && (
                  <input type="number" value={newRequestQuantity} onChange={e => setNewRequestQuantity(e.target.value)} min="1"
                    style={{ width: 60, background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
                    placeholder="1" />
                )}
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Wunsch des Kunden *</label>
              <textarea value={newRequestText} onChange={e => setNewRequestText(e.target.value)} rows={2}
                placeholder="Was möchte der Kunde genau?"
                style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 7, fontSize: 12, resize: 'none', fontFamily: 'inherit', outline: 'none' }} />
            </div>

            {/* v3.50.0: Outfit (nur bei sichtbaren/visuellen Typen) */}
            {(CONTENT_TYPE_META[newRequestType] || {}).showOutfit && (
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Outfit</label>
                <input value={newRequestOutfit} onChange={e => setNewRequestOutfit(e.target.value)}
                  placeholder="z.B. rotes Kleid, Dessous, casual …"
                  style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }} />
              </div>
            )}

            {/* v3.50.0: Besonderheiten (immer) */}
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Besonderheiten</label>
              <textarea value={newRequestSpecial} onChange={e => setNewRequestSpecial(e.target.value)} rows={2}
                placeholder="z.B. Name nennen, bestimmte Ansprache, No-Gos, Requisiten …"
                style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 7, fontSize: 12, resize: 'none', fontFamily: 'inherit', outline: 'none' }} />
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Dringlichkeit</label>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {[['asap','⚡ So schnell wie möglich','#ef4444'],['hours','⏰ In den nächsten Stunden','#f97316'],['days','📅 1-2 Tage','#f59e0b'],['week','🗓 Diese Woche','#10b981']].map(([k,l,c]) => (
                  <button key={k} onClick={() => setNewRequestDeadline(k)} style={{
                    padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, fontWeight: 600,
                    background: newRequestDeadline === k ? c + '22' : 'transparent',
                    color: newRequestDeadline === k ? c : 'var(--text-muted)',
                    border: `1px solid ${newRequestDeadline === k ? c : 'var(--border)'}`,
                  }}>{l}</button>
                ))}
              </div>
            </div>

            {/* Image upload – v3.50.0: nur bei Typen, wo Referenzbilder sinnvoll sind */}
            {(CONTENT_TYPE_META[newRequestType] || {}).showImages && (
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Referenzbilder (optional · max. 5)</label>
              <label style={{ display: 'block', border: '1.5px dashed #2e2e5a', borderRadius: 7, padding: '10px', textAlign: 'center', cursor: 'pointer', background: 'var(--bg-input)' }}>
                <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                  onChange={e => {
                    const files = Array.from(e.target.files).slice(0, 5)
                    setNewRequestImages(prev => [...prev, ...files].slice(0, 5))
                    e.target.value = ''
                  }} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>+ Bilder auswählen</span>
              </label>
              {newRequestImages.length > 0 && (
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  {newRequestImages.map((file, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      <img src={URL.createObjectURL(file)} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '1px solid #2e2e5a' }} />
                      <button onClick={() => setNewRequestImages(prev => prev.filter((_, j) => j !== i))}
                        style={{ position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: '50%', background: '#ef4444', border: 'none', color: '#fff', fontSize: 9, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}

            <button onClick={submitContentRequest} disabled={sendingRequest || !newRequestModel || !newRequestText.trim()} style={{
              width: '100%', background: (newRequestModel && newRequestText.trim()) ? '#06b6d4' : 'var(--border)',
              color: (newRequestModel && newRequestText.trim()) ? '#fff' : 'var(--text-muted)',
              border: 'none', borderRadius: 7, padding: '8px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}>{sendingRequest ? 'Bilder werden hochgeladen...' : '+ Anfrage senden'}</button>
          </div>
          )}

          {/* Request history */}
          {contentRequests.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 0' }}>Keine Anfragen in den letzten 2 Wochen</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {contentRequests.map(req => {
                const statusColor = req.status === 'erledigt' ? '#10b981' : req.status === 'bestaetigt' ? '#06b6d4' : req.status === 'angefragt' ? '#f59e0b' : req.status === 'abgelehnt' ? '#ef4444' : '#a78bfa'
                const statusLabel = req.status === 'erledigt' ? '✓ Erledigt' : req.status === 'bestaetigt' ? '✓ Bestätigt' : req.status === 'angefragt' ? '⏳ Angefragt' : req.status === 'abgelehnt' ? '✕ Abgelehnt' : '● Neu'
                const remainder = (req.price || 0) - (req.deposit || 0)
                // v3.20.1: Ohne Anzahlungs-Split (deposit = 0) gilt deposit_paid als KOMPLETT bezahlt
                // — gleiche Logik wie Admin-/Creator-Ansicht (CommTab) und ModelPortal.
                // Vorher: deposit_paid × deposit (=0) ergab fälschlich "Nichts bezahlt".
                const hasDeposit = (req.deposit || 0) > 0
                const totalPaid = hasDeposit
                  ? (req.deposit_paid ? (req.deposit || 0) : 0) + (req.remainder_paid ? remainder : 0)
                  : (req.deposit_paid ? (req.price || 0) : 0)
                const fullyPaid = req.price > 0 && totalPaid >= req.price
                const nothingPaid = req.price > 0 && totalPaid === 0
                const paidPct = req.price > 0 ? Math.round((totalPaid / req.price) * 100) : 0
                const barTrackColor = nothingPaid ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)'
                return (
                  <div key={req.id} style={{ padding: '12px 14px', background: 'var(--bg-card2)', borderRadius: 8, borderLeft: `3px solid ${statusColor}` }}>
                    {/* Header: Model groß + Kunde + Preis rechts */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                          {req.content_type && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: 'rgba(124,58,237,0.15)', color: '#a78bfa' }}>{contentTypeLabel(req.content_type)}</span>}
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: statusColor + '22', color: statusColor }}>{statusLabel}</span>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#ec4899', marginBottom: 2 }}>{req.model_name}</div>
                        {req.account_csv && req.account_csv !== req.model_name && (
                          <div style={{ fontSize: 11, color: '#c084fc', fontFamily: 'monospace', marginBottom: 2 }}>↳ {req.account_csv}</div>
                        )}
                        {req.customer_id && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                            Kunde: <span style={{ color: 'var(--text-secondary)' }}>{req.customer_id}</span>
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        {req.price > 0 && <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>${req.price}</div>}
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{new Date(req.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</div>
                      </div>
                    </div>

                    {/* Beschreibung */}
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.4 }}>{req.edited_text || req.request_text}</div>

                    {/* v3.50.0: Outfit / Besonderheiten */}
                    {(req.outfit || req.special_notes) && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                        {req.outfit && (
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                            👗 Outfit: <span style={{ color: 'var(--text-secondary)' }}>{req.outfit}</span>
                          </div>
                        )}
                        {req.special_notes && (
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                            ⭐ Besonderheiten: <span style={{ color: 'var(--text-secondary)' }}>{req.special_notes}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {req.image_urls?.length > 0 && (
                      <div style={{ display: 'flex', gap: 5, marginBottom: 8, flexWrap: 'wrap' }}>
                        {req.image_urls.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noreferrer">
                            <img src={url} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 5, border: '1px solid #2e2e5a' }} />
                          </a>
                        ))}
                      </div>
                    )}

                    {/* Bezahl-Block */}
                    {req.price > 0 && (
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ display: 'flex', height: 4, background: barTrackColor, borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
                          <div style={{ width: `${paidPct}%`, background: '#10b981' }} />
                        </div>
                        <div style={{ fontSize: 10, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                          {req.deposit > 0 && remainder > 0 ? (
                            <>
                              <span style={{ color: req.deposit_paid ? '#10b981' : '#f59e0b' }}>{req.deposit_paid ? '✓' : '⏳'} Anzahlung ${req.deposit}</span>
                              <span style={{ color: req.remainder_paid ? '#10b981' : '#ef4444' }}>{req.remainder_paid ? '✓' : '⏳'} Rest ${remainder}</span>
                            </>
                          ) : (
                            <span style={{ color: fullyPaid ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                              {fullyPaid ? '✓ Vollständig bezahlt' : `⊗ Nichts bezahlt — $${req.price} offen`}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Meta */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {req.duration && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>⏱ {req.duration}</span>}
                      {req.quantity > 1 && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>×{req.quantity}</span>}
                      {req.deadline && <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 3, background: req.deadline === 'asap' ? 'rgba(239,68,68,0.15)' : req.deadline === 'hours' ? 'rgba(249,115,22,0.15)' : req.deadline === 'days' ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)', color: req.deadline === 'asap' ? '#ef4444' : req.deadline === 'hours' ? '#f97316' : req.deadline === 'days' ? '#f59e0b' : '#10b981' }}>
                        {req.deadline === 'asap' ? '⚡ ASAP' : req.deadline === 'hours' ? '⏰ Heute' : req.deadline === 'days' ? '📅 1-2 Tage' : '🗓 Diese Woche'}
                      </span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        </Collapsible>

        {/* v3.55.0: Kunden-Historie / Bibliothek */}
        <Collapsible
          helpId="history"
          hidden={tab !== 'content'}
          isCollapsed={collapsed.history ?? true}
          onToggle={() => setCollapsed(prev => { const cur = prev.history ?? true; const next = { ...prev, history: !cur }; try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)) } catch {} return next })}
          icon={<Library size={16} />} title="Kunden-Historie"
          badge={new Set(customerHistory.map(r => r.customer_id).filter(Boolean)).size || null}
          badgeColor="#10b981">
          <CustomerHistorySection history={customerHistory} />
        </Collapsible>

        {/* Content-Ideen */}
        <Collapsible helpId="ideas" hidden={tab !== 'content'} isCollapsed={collapsed.ideas} onToggle={() => toggleCollapse('ideas')} icon="💡" title="Content-Ideen" badge={contentIdeas.filter(i => i.status === 'offen' || i.status === 'in_arbeit').length || null} badgeColor="#a78bfa">
          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12 }}>
            Wünsche & Ideen für Content der demnächst gemacht werden sollte. Wird vom Admin reviewed und ggf. ans Model weitergeleitet.
          </div>

          {!showNewIdeaForm ? (
            <button onClick={() => setShowNewIdeaForm(true)} style={{
              width: '100%', padding: '10px 14px', borderRadius: 8,
              background: 'rgba(167,139,250,0.1)', border: '1px dashed rgba(167,139,250,0.3)',
              color: '#a78bfa', cursor: 'pointer', fontFamily: 'inherit',
              fontWeight: 600, fontSize: 13, marginBottom: 12
            }}>+ Neue Content-Idee</button>
          ) : (
            <div style={{ background: 'var(--bg-card2)', borderRadius: 8, padding: 12, marginBottom: 12, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Neue Idee</div>
                <button onClick={() => setShowNewIdeaForm(false)} style={{
                  background: 'transparent', border: 'none', color: 'var(--text-muted)',
                  cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', padding: 0
                }}>✕</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Für Model *</label>
                  <select value={newIdeaModel} onChange={e => setNewIdeaModel(e.target.value)}
                    style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}>
                    <option value="">— wählen —</option>
                    {activeModels.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Kategorie</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[['bilder','📸 Bilder'],['videos','🎬 Videos'],['audio','🎙 Audio'],['sonstiges','💭 Sonst']].map(([k,l]) => (
                      <button key={k} type="button" onClick={() => setNewIdeaCategory(k)} style={{
                        flex: 1, fontSize: 11, padding: '6px 4px', borderRadius: 6, cursor: 'pointer',
                        background: newIdeaCategory === k ? 'rgba(167,139,250,0.2)' : 'var(--bg-input)',
                        border: `1px solid ${newIdeaCategory === k ? '#a78bfa' : '#2e2e5a'}`,
                        color: newIdeaCategory === k ? '#a78bfa' : 'var(--text-secondary)',
                        fontFamily: 'inherit', fontWeight: 600
                      }}>{l}</button>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Was fehlt / Idee *</label>
                <textarea value={newIdeaText} onChange={e => setNewIdeaText(e.target.value)} rows={3}
                  placeholder="z.B. Brauchen neue Bikini-Bilder für Promo / Fehlt Heels-Content / Neue Talking-Videos zum Kennenlernen wären gut"
                  style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Priorität</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[
                    ['urgent','🔥 Dringend','#ef4444'],
                    ['normal','📅 Normal','#f59e0b'],
                    ['nice','💭 Wenn Zeit','#06b6d4']
                  ].map(([k,l,c]) => (
                    <button key={k} type="button" onClick={() => setNewIdeaPriority(k)} style={{
                      flex: 1, fontSize: 11, padding: '7px 4px', borderRadius: 6, cursor: 'pointer',
                      background: newIdeaPriority === k ? c + '22' : 'var(--bg-input)',
                      border: `1px solid ${newIdeaPriority === k ? c : '#2e2e5a'}`,
                      color: newIdeaPriority === k ? c : 'var(--text-secondary)',
                      fontFamily: 'inherit', fontWeight: 600
                    }}>{l}</button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={submitContentIdea} disabled={sendingIdea || !newIdeaModel || !newIdeaText.trim()} style={{
                  flex: 1, fontSize: 13, padding: '8px 16px', borderRadius: 7,
                  background: (newIdeaModel && newIdeaText.trim()) ? '#a78bfa' : 'var(--border)',
                  color: (newIdeaModel && newIdeaText.trim()) ? '#fff' : 'var(--text-muted)',
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700
                }}>{sendingIdea ? 'Speichern...' : '+ Idee einreichen'}</button>
              </div>
            </div>
          )}

          {/* Eigene Ideen Liste */}
          {contentIdeas.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 0', textAlign: 'center' }}>Noch keine Ideen eingereicht</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {contentIdeas.map(idea => {
                const statusColor = idea.status === 'erledigt' ? '#10b981' : idea.status === 'in_arbeit' ? '#06b6d4' : idea.status === 'abgelehnt' ? '#ef4444' : '#a78bfa'
                const statusLabel = idea.status === 'erledigt' ? '✓ Erledigt' : idea.status === 'in_arbeit' ? '⚙ In Arbeit' : idea.status === 'abgelehnt' ? '✕ Abgelehnt' : '● Offen'
                const prioIcon = idea.priority === 'urgent' ? '🔥' : idea.priority === 'nice' ? '💭' : '📅'
                const catIcon = idea.category === 'videos' ? '🎬' : idea.category === 'audio' ? '🎙' : idea.category === 'sonstiges' ? '💭' : '📸'
                return (
                  <div key={idea.id} style={{ padding: '10px 12px', background: 'var(--bg-card2)', borderRadius: 8, borderLeft: `3px solid ${statusColor}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4, gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13 }}>{catIcon}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa' }}>{idea.model_name}</span>
                        <span style={{ fontSize: 10 }}>{prioIcon}</span>
                        <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 4, background: statusColor + '22', color: statusColor, fontWeight: 700 }}>{statusLabel}</span>
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', flexShrink: 0 }}>
                        {new Date(idea.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      {idea.edited_text || idea.idea_text}
                    </div>
                    {idea.edited_text && idea.edited_text !== idea.idea_text && (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>
                        ↳ vom Admin editiert
                      </div>
                    )}
                    {idea.admin_note && (
                      <div style={{ fontSize: 11, color: '#06b6d4', marginTop: 6, padding: '4px 8px', background: 'rgba(6,182,212,0.08)', borderRadius: 5 }}>
                        💬 Admin: {idea.admin_note}
                      </div>
                    )}
                    {idea.sent_to_model_at && (
                      <div style={{ fontSize: 10, color: '#10b981', marginTop: 4 }}>
                        ✓ An Model gesendet {new Date(idea.sent_to_model_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit' })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Collapsible>

        {/* v3.2.0: Guidelines (von Admin in Einstellungen gepflegt) */}
        <Collapsible helpId="guidelines" hidden={tab !== 'mehr'} isCollapsed={collapsed.guidelines} onToggle={() => toggleCollapse('guidelines')} icon={<BookOpen size={16} />} title="Guidelines" badge={guidelines.length || null} badgeColor="#06b6d4">
          {guidelines.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '12px 0', textAlign: 'center' }}>
              Noch keine Guidelines hinterlegt.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {guidelines.map((g, idx) => (
                <GuidelineView
                  key={g.id}
                  guideline={g}
                  number={idx + 1}
                  onImageClick={(url) => setGuidelineLightbox({ url, all_urls: g.image_urls || [], current_idx: (g.image_urls || []).indexOf(url) })}
                />
              ))}
            </div>
          )}
        </Collapsible>

        {/* Schicht-Tausch */}
        <Collapsible helpId="swap" hidden={tab !== 'orga'} isCollapsed={collapsed.swap} onToggle={() => toggleCollapse('swap')} icon="🔄" title="Schicht-Tausch anfragen" badgeColor="#f59e0b">
          <SwapRequestForm displayName={displayName} myNext7Shifts={myNext7Shifts} />
        </Collapsible>

        {/* Week Stats */}
        <Collapsible helpId="stats" hidden={tab !== 'mehr'} isCollapsed={collapsed.stats} onToggle={() => toggleCollapse('stats')} icon="📈" title={`Meine Stats – KW ${kw}`} badgeColor="#f59e0b">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
            {[
              { label: `Revenue ${new Date().toLocaleString('de-DE', { month: 'long' })}`, val: formatMoney(monthRevenue), good: monthRevenue > 2000 },
              { label: 'Nachrichten KW', val: weekMessages.toString(), good: weekMessages > 200 },
              { label: 'Sent PPVs KW', val: weekSentPPVs.toString(), good: weekSentPPVs > 50 },
              { label: 'Buy Rate KW', val: `${weekBuyRate.toFixed(1)}%`, good: weekBuyRate >= 25 },
              { label: 'Aktiv (Std) KW', val: (weekActiveMinutes / 60).toFixed(1) + 'h', good: weekActiveMinutes > 300 },
            ].map(stat => (
              <div key={stat.label} style={{ ...sR, flexDirection: 'column', borderBottom: 'none', padding: '10px 14px', background: 'var(--bg-card2)', borderRadius: 8, border: '1px solid #1e1e3a' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>{stat.label}</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 18, color: stat.good ? '#10b981' : 'var(--text-primary)' }}>{stat.val}</div>
              </div>
            ))}
          </div>
        </Collapsible>

        {/* Bot Commands */}
        <Collapsible helpId="bot" hidden={tab !== 'mehr'} isCollapsed={collapsed.bot} onToggle={() => toggleCollapse('bot')} icon="🤖" title="Bot-Befehle · @thirteen87agency_bot" badgeColor="#a78bfa">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { cmd: '/on', desc: 'Schicht starten', color: '#10b981' },
              { cmd: '/off', desc: 'Schicht beenden', color: '#ef4444' },
              { cmd: '/start', desc: 'Telegram ID anzeigen', color: '#a78bfa' },
            ].map(b => (
              <div key={b.cmd} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--bg-card2)', borderRadius: 7, border: '1px solid #1e1e3a' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: b.color, background: b.color + '20', padding: '2px 7px', borderRadius: 4 }}>{b.cmd}</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{b.desc}</span>
              </div>
            ))}
          </div>
        </Collapsible>

        {/* v4.9.0: HILFE — alle Erklärungen an einem Ort, plus Neustart der Tour. */}
        {/* helpId={null}: die Hilfe selbst braucht kein ?-Symbol — der Prüfer
            (npm run check:help) erkennt daran, dass das Absicht ist. */}
        <Collapsible helpId={null} hidden={tab !== 'mehr'} isCollapsed={collapsed.help} onToggle={() => toggleCollapse('help')} icon="❓" title="Hilfe & Einführung" badgeColor="#a78bfa">
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 12 }}>
            Jeder Bereich im Portal hat oben rechts ein <span style={{ color: '#a78bfa', fontWeight: 700 }}>?</span> — dort steht,
            wozu er da ist. Hier findest du alle Erklärungen auf einen Blick.
          </div>
          <button
            onClick={() => setTourOpen(true)}
            style={{
              width: '100%', marginBottom: 14, padding: '10px', borderRadius: 8,
              background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.4)',
              color: '#a78bfa', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >▶ Einführung noch einmal ansehen</button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {HELP_TOPICS.map(t => (
              <button
                key={t.id}
                onClick={() => setHelpTopic(t.id)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left',
                  padding: '10px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                  background: 'var(--bg-card2)', border: '1px solid var(--border)', width: '100%',
                }}
              >
                <span style={{ fontSize: 15, lineHeight: 1.3 }}>{t.icon}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{t.title}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45, marginTop: 2 }}>{t.short}</span>
                </span>
              </button>
            ))}
          </div>
        </Collapsible>

        {/* PINNWAND VERLAUF - kollabierbar · v3.95.0: im Mehr-Tab */}
        {tab === 'mehr' && announcements.length > 0 && (
          <div style={{ marginTop: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10 }}>
            <button
              onClick={() => setShowAnnArchive(!showAnnArchive)}
              style={{
                width: '100%', padding: '12px 16px', background: 'transparent', border: 'none',
                color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontFamily: 'inherit', textTransform: 'uppercase', letterSpacing: '0.08em'
              }}
            >
              <span>📋 Pinnwand-Verlauf ({announcements.length})</span>
              <span style={{ fontSize: 14 }}>{showAnnArchive ? '▼' : '▶'}</span>
            </button>
            {showAnnArchive && (
              <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {announcements.map(ann => {
                  const archivedFor = Array.isArray(ann.archived_for) ? ann.archived_for : []
                  const isArchived = archivedFor.includes(displayName)
                  const isExpired = ann.expires_at && new Date(ann.expires_at) < new Date()
                  return (
                    <div key={ann.id} style={{
                      padding: '10px 14px',
                      background: 'var(--bg-card2)',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      opacity: isExpired ? 0.5 : 1
                    }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <span style={{ fontSize: 16 }}>{ann.emoji || '📌'}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{ann.text}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'monospace' }}>
                            Von {ann.created_by} · {new Date(ann.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            {isExpired && ' · ABGELAUFEN'}
                            {isArchived && !isExpired && ' · gelesen'}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        </div>
        )}
      </main>
      {/* v3.2.0: Guideline-Bild Lightbox */}
      {guidelineLightbox && (
        <div onClick={() => setGuidelineLightbox(null)} style={{
          position: 'fixed', inset: 0, zIndex: 10001,
          background: 'rgba(0,0,0,0.92)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', padding: 20,
        }}>
          <img src={guidelineLightbox.url} alt="" style={{
            maxWidth: '95%', maxHeight: '95%', objectFit: 'contain',
            borderRadius: 8, boxShadow: '0 0 40px rgba(0,0,0,0.5)',
          }} />
          <button onClick={(e) => { e.stopPropagation(); setGuidelineLightbox(null) }} style={{
            position: 'absolute', top: 16, right: 16, width: 40, height: 40, borderRadius: '50%',
            background: 'rgba(0,0,0,0.7)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)',
            fontSize: 20, cursor: 'pointer', fontFamily: 'inherit',
          }}>✕</button>
          {guidelineLightbox.all_urls.length > 1 && (
            <div style={{
              position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '6px 14px', borderRadius: 14,
              fontSize: 12, fontWeight: 600,
            }}>
              {guidelineLightbox.current_idx + 1} / {guidelineLightbox.all_urls.length}
            </div>
          )}
        </div>
      )}
      {/* ── v4.34.0: Schichtübergabe — Fenster beim Auschecken ──────────────────
          Freiwillig: „Ohne Übergabe beenden" steht gleichberechtigt daneben.
          Ein Pflichtfeld würde nur dazu führen, dass „nix" eingetragen wird. */}
      {uebergabeDialog && (
        <div onClick={() => !isCheckingOut && setUebergabeDialog(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>🤝 Schichtübergabe</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
              Gibt es etwas, das die nächste Schicht wissen muss? Besonderheiten bei einem Model,
              ein angefangenes Gespräch, ein offener Custom. Wenn nichts ansteht, einfach ohne Übergabe beenden.
              <br />
              <span style={{ opacity: 0.75 }}>
                Geht automatisch per Telegram an die, die laut Dienstplan übernehmen — und an Chris und Rey.
              </span>
            </div>
            <textarea autoFocus value={uebergabeText} onChange={e => setUebergabeText(e.target.value)}
              placeholder="z. B. Lisa: Kunde XY will heute Abend nochmal schreiben, Preis steht bei 80 €."
              rows={5}
              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', borderRadius: 8, padding: 10, fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <button onClick={() => checkOut(uebergabeText)} disabled={isCheckingOut || !uebergabeText.trim()}
                style={{ flex: '1 1 190px', background: uebergabeText.trim() ? '#ec4899' : 'var(--border)', color: uebergabeText.trim() ? '#fff' : 'var(--text-muted)', border: 'none', borderRadius: 8, padding: '10px 14px', fontSize: 13, fontWeight: 700, cursor: (isCheckingOut || !uebergabeText.trim()) ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                {isCheckingOut ? '⏳ ...' : '🤝 Übergeben & beenden'}
              </button>
              <button onClick={() => checkOut(null)} disabled={isCheckingOut}
                style={{ flex: '1 1 160px', background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 13, fontWeight: 700, cursor: isCheckingOut ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                Ohne Übergabe beenden
              </button>
            </div>
            <button onClick={() => setUebergabeDialog(false)} disabled={isCheckingOut}
              style={{ width: '100%', marginTop: 8, background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: 6 }}>
              Abbrechen — Schicht läuft weiter
            </button>
          </div>
        </div>
      )}

      {/* ── v4.34.0: Übergaben der Vorschicht, beim Einchecken ───────────────── */}
      {uebergabeEingangOffen && eingangUebergaben.length > 0 && (
        <div onClick={() => setUebergabeEingangOffen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, width: '100%', maxWidth: 520, maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
              🤝 {eingangUebergaben.length === 1 ? 'Übergabe der Vorschicht' : `${eingangUebergaben.length} Übergaben`}
            </div>
            {eingangUebergaben.map(log => {
              const wann = log.handover_at || log.checked_out_at
              return (
                <div key={log.id} style={{ background: 'rgba(236,72,153,0.08)', border: '1px solid rgba(236,72,153,0.3)', borderRadius: 10, padding: 14, marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: '#ec4899', fontWeight: 700, marginBottom: 6 }}>
                    {log.display_name}{log.shift ? ` · ${log.shift}` : ''}
                    {wann ? ` · ${new Date(wann).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{log.handover_text}</div>
                  <button onClick={() => bestaetigeUebergabe(log)} disabled={uebergabeLaedt}
                    style={{ marginTop: 12, background: '#10b981', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: uebergabeLaedt ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                    ✓ Gelesen & verstanden
                  </button>
                </div>
              )
            })}
            <button onClick={() => setUebergabeEingangOffen(false)}
              style={{ width: '100%', marginTop: 4, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: 9, borderRadius: 8 }}>
              Später lesen
            </button>
          </div>
        </div>
      )}

      {!isPreview && displayName && <SurveyModal displayName={displayName} role="chatter" />}
      {/* Popup bleibt: es stupst bei neuen Angeboten an. Die Glocke daneben ist das
          Archiv — weggeklickte Angebote sind dort weiter erreichbar. */}
      {!isPreview && displayName && <SwapModal displayName={displayName} />}
      {/* v3.96.0: Glocke + Chat-Bubble für Chatter */}
      {!isPreview && displayName && !showSocialPortal && (
        <>
          <ChatterBell
            isOpen={fab.active === 'bell'} onToggle={(v) => fab.set('bell', v)}
            displayName={displayName}
            shifts={myNext7Shifts}
            todos={myTodos}
            announcements={announcements}
            isOnline={isOnline}
            onCheckIn={(shiftName) => checkIn(shiftName)}
            onNavigate={(t, panel) => { goTab(t); if (panel) openPanel(panel) }}
          />
          <ChatterChat displayName={displayName}
            isOpen={fab.active === 'chat'} onToggle={(v) => fab.set('chat', v)} />
          {/* v4.10.0: Hilfe-Knopf über der Glocke (20 Chat · 86 Glocke · 152 Hilfe) */}
          <HelpFab
            isOpen={fab.active === 'help'} onToggle={(v) => fab.set('help', v)}
            onStartTour={() => setTourOpen(true)}
          />
        </>
      )}

      {/* v4.9.0: Helpcenter — Einführungs-Tour und Einzel-Erklärungen */}
      {tourOpen && (
        <HelpTour onGoTab={setTabQuiet} onFinish={finishTour} />
      )}
      {helpTopic && <HelpSheet topic={helpTopic} onClose={() => setHelpTopic(null)} />}
    </div>
    </HelpProvider>
  )
}

// ============================================================
// v3.2.0: GuidelineView — Read-Only Anzeige für Chatter
// v3.53.0: Bilder inline via [bildN]-Platzhalter (volle Breite an ihrer Textstelle)
// (Editor ist in SettingsTab; hier nur Lesen)
// ============================================================

function GuidelineView({ guideline, number, onImageClick }) {
  const [expanded, setExpanded] = useState(false)
  const imageUrls = guideline.image_urls || []

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden',
    }}>
      <div onClick={() => setExpanded(!expanded)} style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
        cursor: 'pointer',
        background: expanded ? 'rgba(6,182,212,0.04)' : 'transparent',
        borderBottom: expanded ? '1px solid var(--border)' : 'none',
      }}>
        <div style={{
          width: 26, height: 26, borderRadius: '50%',
          background: 'rgba(6,182,212,0.15)', color: '#06b6d4',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700, flexShrink: 0,
        }}>{number}</div>
        <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
          {guideline.title || 'Ohne Titel'}
        </div>
        {imageUrls.length > 0 && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>📎 {imageUrls.length}</span>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (() => {
        // v3.53.0: Inhalt in Text-/Bild-Blöcke aufteilen — [bildN] erscheint inline
        // (volle Breite) genau an seiner Stelle. Nicht referenzierte Bilder kommen
        // gesammelt ans Ende (rückwärtskompatibel zu bestehenden Guidelines).
        const content = guideline.content || ''
        const usedIdx = new Set()
        const parts = []
        let textBuffer = []
        const flushText = () => {
          if (textBuffer.length > 0) {
            parts.push({ type: 'text', value: textBuffer.join('\n') })
            textBuffer = []
          }
        }
        for (const line of content.split('\n')) {
          const m = line.trim().match(/^\[bild(\d+)\]$/i)
          if (m) {
            const idx = parseInt(m[1], 10) - 1
            if (idx >= 0 && idx < imageUrls.length) {
              flushText()
              parts.push({ type: 'image', idx })
              usedIdx.add(idx)
              continue
            }
          }
          textBuffer.push(line)
        }
        flushText()
        const unusedUrls = imageUrls.filter((_, i) => !usedIdx.has(i))

        const InlineImg = ({ url }) => (
          <img src={url} alt="" onClick={() => onImageClick(url)}
            style={{
              width: '100%', maxHeight: 520, objectFit: 'contain', borderRadius: 8,
              cursor: 'pointer', border: '1px solid var(--border)',
              background: 'rgba(0,0,0,0.15)', display: 'block',
            }}
          />
        )

        return (
          <div style={{ padding: '12px 14px 14px 14px' }}>
            {parts.map((p, i) => (
              p.type === 'text' ? (
                p.value.trim() ? (
                  <div key={i} style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)', margin: '4px 0' }}>
                    <MarkdownText text={p.value} />
                  </div>
                ) : null
              ) : (
                <div key={i} style={{ margin: '10px 0' }}>
                  <InlineImg url={imageUrls[p.idx]} />
                </div>
              )
            ))}
            {unusedUrls.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: parts.length > 0 ? 12 : 0 }}>
                {unusedUrls.map((url, i) => (
                  <img key={i} src={url} alt={`Beispiel ${i + 1}`}
                    onClick={() => onImageClick(url)}
                    style={{
                      width: 110, height: 110, objectFit: 'cover', borderRadius: 6,
                      cursor: 'pointer', border: '1px solid var(--border)',
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

// Schlanker Markdown-Renderer ohne externe Lib.
// Unterstützt: **fett**, *kursiv*, `code`, unordered list (- oder *), ordered list (1.), Absätze.
function MarkdownText({ text }) {
  if (!text) return null

  // Inline: **bold**, *italic*, `code` → tokens
  const inlineRender = (line, lineKey) => {
    const out = []
    let remaining = line
    let pos = 0
    // Regex matched alle drei Patterns; wir gehen iterativ durch
    const re = /(\*\*([^*]+?)\*\*)|(\*([^*]+?)\*)|(`([^`]+?)`)/
    while (remaining.length > 0) {
      const m = remaining.match(re)
      if (!m) { out.push(<span key={`${lineKey}_${pos}`}>{remaining}</span>); break }
      if (m.index > 0) out.push(<span key={`${lineKey}_${pos}_t`}>{remaining.slice(0, m.index)}</span>)
      if (m[1]) out.push(<strong key={`${lineKey}_${pos}_b`}>{m[2]}</strong>)
      else if (m[3]) out.push(<em key={`${lineKey}_${pos}_i`}>{m[4]}</em>)
      else if (m[5]) out.push(<code key={`${lineKey}_${pos}_c`} style={{
        background: 'rgba(124,58,237,0.12)', color: '#a78bfa',
        padding: '1px 5px', borderRadius: 4, fontSize: 11,
        fontFamily: 'ui-monospace, monospace',
      }}>{m[6]}</code>)
      remaining = remaining.slice(m.index + m[0].length)
      pos++
    }
    return out
  }

  // Block-Parser
  const lines = text.split('\n')
  const blocks = []
  let listBuffer = []
  let listType = null // 'ul' | 'ol'

  const flushList = () => {
    if (listBuffer.length === 0) return
    const items = listBuffer.map((line, i) => (
      <li key={i} style={{ marginBottom: 3 }}>{inlineRender(line, `li_${blocks.length}_${i}`)}</li>
    ))
    blocks.push(listType === 'ol' ?
      <ol key={blocks.length} style={{ margin: '6px 0', paddingLeft: 22 }}>{items}</ol> :
      <ul key={blocks.length} style={{ margin: '6px 0', paddingLeft: 22 }}>{items}</ul>
    )
    listBuffer = []
    listType = null
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const ulMatch = line.match(/^[-*]\s+(.+)$/)
    const olMatch = line.match(/^\d+\.\s+(.+)$/)
    if (ulMatch) {
      if (listType !== null && listType !== 'ul') flushList()
      listType = 'ul'
      listBuffer.push(ulMatch[1])
    } else if (olMatch) {
      if (listType !== null && listType !== 'ol') flushList()
      listType = 'ol'
      listBuffer.push(olMatch[1])
    } else {
      flushList()
      if (line === '') {
        blocks.push(<div key={blocks.length} style={{ height: 6 }} />)
      } else {
        blocks.push(<p key={blocks.length} style={{ margin: '4px 0' }}>{inlineRender(line, `p_${blocks.length}`)}</p>)
      }
    }
  }
  flushList()
  return <>{blocks}</>
}
