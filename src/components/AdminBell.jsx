import React, { useState, useEffect, useCallback } from 'react'
import { Users, ChevronDown, CalendarCog, Send, ClipboardList, Megaphone, BookOpen, Settings, ShieldCheck, Sparkles, Bot, Inbox, Euro, Bell } from 'lucide-react'
import { supabase } from '../supabase'
import { ACTION_LABELS } from '../activity'
import { useFabOpen } from '../fabPanel'
// v4.27.0: Chatter-Ziele — dieselbe Rechnung wie in der Chatter-Ansicht.
import { ladeChatterZiele, ladeSchichtstunden, berechneChatterZiele, berechneZielAlerts } from '../chatterTargets'

/**
 * AdminBell v3.97.0 — dritte Glocke: was die ANDEREN Admins gemacht haben.
 *
 * Abgrenzung zu ActivityWidget: das zeigt, was das TEAM macht (Notizen, Boards,
 * Anfragen, Check-ins). Hier geht es ausschließlich um Admin-Aktionen.
 *
 * Zwei Quellen:
 *   1. `activity_log` — für alles, was beim Speichern überschrieben wird und
 *      sonst spurlos wäre: Dienstplan, Guidelines, Rollen, Steckbriefe, Bot-Texte.
 *   2. Ableitungen aus bestehenden Tabellen, wo der Urheber schon mitgespeichert wird:
 *      messages.sent_by, todos.created_by, announcements.created_by, shift_swaps.
 *      Dafür braucht es kein Protokoll — die Information ist bereits da.
 *
 * Eigene Aktionen werden gedämpft dargestellt und zählen nicht im Badge — es geht
 * darum, zu sehen was die anderen tun.
 */

const SEEN_KEY = 'adminbell_last_seen'
const norm = (s) => (s || '').trim().toLowerCase()

const CHIPS = [
  { key: 'all', label: 'Alle' },
  { key: 'umsatz', label: 'Umsatz' },
  { key: 'schedule', label: 'Dienstplan' },
  { key: 'messages', label: 'Nachrichten' },
  { key: 'tasks', label: 'Aufgaben' },
  { key: 'content', label: 'Custom Content' },
  { key: 'settings', label: 'Einstellungen' },
]

// action-Präfix → Filtergruppe + Icon + Farbe
const ACTION_META = {
  schedule: { cat: 'schedule', Icon: CalendarCog, color: '#06b6d4' },
  guideline: { cat: 'settings', Icon: BookOpen, color: '#a78bfa' },
  user: { cat: 'settings', Icon: ShieldCheck, color: '#ef4444' },
  bot: { cat: 'settings', Icon: Bot, color: '#8b5cf6' },
  suggestions: { cat: 'settings', Icon: Sparkles, color: '#f59e0b' },
  persona: { cat: 'settings', Icon: Sparkles, color: '#f59e0b' },
  occasion: { cat: 'settings', Icon: Sparkles, color: '#f59e0b' },
  customcontent: { cat: 'content', Icon: Inbox, color: '#f59e0b' },
}
// Feinere Icons je nach konkreter Aktion (überschreibt ACTION_META)
const ICON_BY_ACTION = {
  'customcontent.payment': { Icon: Euro, color: '#10b981' },
  'customcontent.reminder': { Icon: Bell, color: '#a78bfa' },
}

function relTime(iso) {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'gerade eben'
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min`
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std`
  if (diff < 172800) return 'gestern'
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function dayBucket(iso) {
  if (!iso) return 'Älter'
  const d = new Date(iso), now = new Date()
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const y0 = new Date(t0); y0.setDate(y0.getDate() - 1)
  const w0 = new Date(t0); w0.setDate(w0.getDate() - 7)
  if (d >= t0) return 'Heute'
  if (d >= y0) return 'Gestern'
  if (d >= w0) return 'Diese Woche'
  return 'Älter'
}
const short = (s, n = 90) => {
  const t = (s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

export default function AdminBell({ me, onNavigate , isOpen, onToggle, chatterSnapshots = [] }) {
  const [open, setOpen] = useFabOpen(isOpen, onToggle)
  const [filter, setFilter] = useState('all')
  const [items, setItems] = useState([])
  const [lastSeen, setLastSeen] = useState(() => {
    try { return localStorage.getItem(SEEN_KEY) || '' } catch { return '' }
  })

  const load = useCallback(async () => {
    const since = new Date(); since.setDate(since.getDate() - 14)
    const sinceIso = since.toISOString()

    const [logRes, msgRes, todoRes, annRes, swapRes, ccRes] = await Promise.allSettled([
      supabase.from('activity_log').select('*').gte('created_at', sinceIso)
        .order('created_at', { ascending: false }).limit(80),
      supabase.from('messages').select('id, created_at, model_name, contact_type, sent_by, text, message_type')
        .eq('direction', 'out').gte('created_at', sinceIso)
        .order('created_at', { ascending: false }).limit(60),
      supabase.from('todos').select('*').gte('created_at', sinceIso)
        .order('created_at', { ascending: false }).limit(40),
      supabase.from('announcements').select('*').gte('created_at', sinceIso)
        .order('created_at', { ascending: false }).limit(20),
      supabase.from('shift_swaps').select('*').gte('created_at', sinceIso)
        .order('created_at', { ascending: false }).limit(40),
      // Bearbeitete Content-Anfragen: content_requests führt edited_by/edited_at
      // bereits mit — dafür braucht es kein Protokoll, das geht rückwirkend.
      supabase.from('content_requests').select('id, model_name, chatter_name, request_text, edited_text, status, edited_by, edited_at')
        .not('edited_at', 'is', null).gte('edited_at', sinceIso)
        .order('edited_at', { ascending: false }).limit(40),
    ])
    const rows = (r) => (r.status === 'fulfilled' ? (r.value.data || []) : [])
    const out = []

    // 1) Protokollierte Aktionen
    for (const l of rows(logRes)) {
      const prefix = String(l.action || '').split('.')[0]
      const base = ACTION_META[prefix] || { cat: 'settings', Icon: Settings, color: '#8888aa' }
      const meta = { ...base, ...(ICON_BY_ACTION[l.action] || {}) }
      out.push({
        id: 'log-' + l.id, when: l.created_at, actor: l.actor, cat: meta.cat,
        Icon: meta.Icon, color: meta.color,
        title: `${l.actor} ${ACTION_LABELS[l.action] || l.action}`,
        text: [l.entity, l.detail].filter(Boolean).join(' · '),
        nav: meta.cat === 'schedule' ? { tab: 'schedule' }
          : meta.cat === 'content' ? { tab: 'models-comm' }
          : { tab: 'settings' },
      })
    }

    // 2) Ausgehende Nachrichten — Urheber steht in sent_by
    for (const m of rows(msgRes)) {
      if (!m.sent_by) continue   // vom System/Cron verschickt, kein Admin
      const who = m.contact_type === 'model' ? 'Model' : 'Chatter'
      out.push({
        id: 'msg-' + m.id, when: m.created_at, actor: m.sent_by, cat: 'messages',
        Icon: Send, color: '#10b981',
        title: `${m.sent_by} hat an ${m.model_name} geschrieben`,
        text: `${who}${m.text ? ' · ' + short(m.text) : ''}`,
        nav: { tab: 'chat' },
      })
    }

    // 3) Aufgaben verteilt
    for (const t of rows(todoRes)) {
      out.push({
        id: 'todo-' + t.id, when: t.created_at, actor: t.created_by, cat: 'tasks',
        Icon: ClipboardList, color: '#ef4444',
        title: `${t.created_by || 'Jemand'} hat eine Aufgabe verteilt${t.assigned_to ? ` an ${t.assigned_to}` : ''}`,
        text: short(t.title),
        nav: { tab: 'todos' },
      })
    }

    // 4) Ankündigungen
    for (const a of rows(annRes)) {
      out.push({
        id: 'ann-' + a.id, when: a.created_at, actor: a.created_by, cat: 'messages',
        Icon: Megaphone, color: '#7c3aed',
        title: `${a.created_by || 'Jemand'} hat eine Ankündigung gepostet`,
        text: short(a.text),
        nav: { tab: 'chatters-comm' },
      })
    }

    // 5) Schichten ausgeschrieben (Admin-Aktion; Tausch-Anfragen von Chattern raus)
    for (const s of rows(swapRes)) {
      if (!s.block_label && !s.target) continue
      out.push({
        id: 'swap-' + s.id, when: s.created_at, actor: s.created_by || null, cat: 'schedule',
        Icon: Megaphone, color: '#f59e0b',
        title: `Schicht ausgeschrieben${s.created_by ? ` · ${s.created_by}` : ''}`,
        text: `${s.block_label || `${s.shift_date || ''} ${s.shift || ''}`}${s.model_name ? ' · ' + s.model_name : ''}`,
        nav: { tab: 'chatters-comm' },
      })
    }

    // 6) Content-Anfragen bearbeitet — ableitbar über edited_by/edited_at
    for (const r of rows(ccRes)) {
      out.push({
        id: 'cc-' + r.id, when: r.edited_at, actor: r.edited_by, cat: 'content',
        Icon: Inbox, color: '#f59e0b',
        title: `${r.edited_by || 'Jemand'} hat eine Content-Anfrage bearbeitet`,
        text: [r.model_name, r.status, short(r.edited_text || r.request_text, 60)].filter(Boolean).join(' · '),
        nav: { tab: 'models-comm' },
      })
    }

    out.sort((a, b) => new Date(b.when) - new Date(a.when))
    setItems(out.slice(0, 150))
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [load])

  // Live nachladen, sobald eine der Quellen sich ändert
  useEffect(() => {
    let t = 0
    const kick = () => { clearTimeout(t); t = setTimeout(load, 500) }
    let ch = supabase.channel('adminbell-live')
    for (const table of ['activity_log', 'messages', 'todos', 'announcements', 'shift_swaps', 'content_requests']) {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, kick)
    }
    ch.subscribe()
    return () => { clearTimeout(t); supabase.removeChannel(ch) }
  }, [load])

  // ── v4.27.0: Chatter unter Ziel ──
  // Keine Admin-Aktion, sondern ein Zustand — steht trotzdem hier, weil diese
  // Glocke der Ort ist, an dem ihr ohnehin nachschaut. Der Zeitstempel ist der
  // Tag des jüngsten Snapshots: dadurch ist die Meldung genau einmal pro
  // Datenstand ungelesen und nicht dauerhaft rot.
  const [zielItems, setZielItems] = useState([])
  useEffect(() => {
    let abgebrochen = false
    ;(async () => {
      if (!chatterSnapshots || chatterSnapshots.length === 0) { setZielItems([]); return }
      const letzterTag = [...chatterSnapshots]
        .sort((a, b) => b.businessDate.localeCompare(a.businessDate))[0]?.businessDate
      if (!letzterTag) { setZielItems([]); return }
      let inaktiv = new Set()
      try {
        const { data } = await supabase.from('user_roles').select('display_name, status').in('status', ['suspended', 'offboarded'])
        inaktiv = new Set((data || []).map(r => r.display_name).filter(Boolean))
      } catch { /* fail-open: lieber eine Meldung zu viel als keine */ }
      const [ziele, schichtStunden] = await Promise.all([
        ladeChatterZiele(),
        ladeSchichtstunden(letzterTag.slice(0, 8) + '01', letzterTag),
      ])
      if (abgebrochen) return
      const { zeilen } = berechneChatterZiele({
        chatterSnapshots, selectedDate: letzterTag, ziele, schichtStunden, inaktiveNamen: inaktiv,
      })
      const when = new Date(letzterTag + 'T12:00:00').toISOString()
      setZielItems(berechneZielAlerts(zeilen).map((a, i) => ({
        id: `ziel-${letzterTag}-${i}`,
        when, actor: null, cat: 'umsatz',
        Icon: Euro,
        color: a.severity === 'critical' ? '#ef4444' : '#f59e0b',
        title: `${a.name} · ${a.tag}`,
        text: a.headline,
        nav: { tab: 'chatters' },
      })))
    })()
    return () => { abgebrochen = true }
  }, [chatterSnapshots])

  // Eigene Aktionen zählen nicht — es geht um die anderen
  const isOther = (it) => !me || !it.actor || norm(it.actor) !== norm(me)
  const isNew = (it) => it.when && (!lastSeen || new Date(it.when) > new Date(lastSeen))
  const alleItems = React.useMemo(
    () => [...items, ...zielItems].sort((a, b) => new Date(b.when) - new Date(a.when)),
    [items, zielItems]
  )
  const unread = alleItems.filter(it => isOther(it) && isNew(it)).length
  const visible = alleItems.filter(it => filter === 'all' || it.cat === filter)

  const markSeen = () => {
    const now = new Date().toISOString()
    setLastSeen(now)
    try { localStorage.setItem(SEEN_KEY, now) } catch {}
  }
  const toggle = () => {
    setOpen(o => {
      if (!o) load()
      else markSeen()
      return !o
    })
  }

  let bucket = null

  return (
    <>
      {open && (
        <div style={{
          // dritte Ebene: über Chat (20) und Team-Glocke (86) sitzt diese bei 152
          position: 'fixed', right: 20, bottom: 216, zIndex: 99998,
          width: 'min(430px, calc(100vw - 40px))',
          height: 'min(540px, calc(100vh - 256px))',
          background: 'var(--bg-base)', border: '1px solid var(--border-bright)',
          borderRadius: 16, boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
              <Users size={16} /> Team-intern
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {unread > 0 && (
                <button onClick={markSeen} style={{
                  fontSize: 11, padding: '5px 10px', borderRadius: 6, background: 'transparent',
                  border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit',
                }}>Alles gelesen</button>
              )}
              <button onClick={toggle} title="Schließen" style={{
                background: 'transparent', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', padding: 4, display: 'flex',
              }}><ChevronDown size={20} /></button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '10px 14px 0', flexShrink: 0 }}>
            {CHIPS.map(c => (
              <button key={c.key} onClick={() => setFilter(c.key)} style={{
                padding: '4px 11px', borderRadius: 999, fontSize: 11, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                background: filter === c.key ? 'rgba(124,58,237,0.18)' : 'rgba(255,255,255,0.04)',
                color: filter === c.key ? '#a78bfa' : 'var(--text-muted)',
                border: `1px solid ${filter === c.key ? 'rgba(124,58,237,0.45)' : 'var(--border)'}`,
              }}>{c.label}</button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
            {visible.length === 0 && (
              <div style={{ padding: '28px 10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                Keine Aktivität in den letzten 14 Tagen.
              </div>
            )}
            {visible.map(it => {
              const b = dayBucket(it.when)
              const sep = b !== bucket ? (bucket = b) : null
              const mine = !isOther(it)
              const fresh = isOther(it) && isNew(it)
              const Icon = it.Icon || Settings
              return (
                <React.Fragment key={it.id}>
                  {sep && (
                    <div style={{
                      fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase',
                      letterSpacing: '0.09em', margin: '14px 0 8px',
                    }}>{sep}</div>
                  )}
                  <div
                    onClick={() => { if (it.nav && onNavigate) { onNavigate(it.nav.tab); setOpen(false); markSeen() } }}
                    style={{
                      display: 'flex', gap: 11, padding: '10px 12px', borderRadius: 10, marginBottom: 8,
                      cursor: it.nav ? 'pointer' : 'default',
                      opacity: mine ? 0.55 : 1,
                      background: fresh ? 'rgba(124,58,237,0.06)' : 'var(--bg-card)',
                      border: `1px solid ${fresh ? 'rgba(124,58,237,0.4)' : 'var(--border)'}`,
                    }}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: it.color + '22', color: it.color,
                    }}><Icon size={15} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.45, color: 'var(--text-primary)' }}>
                        {it.title}{mine && <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}> · du</span>}
                      </div>
                      {it.text && (
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.5, wordBreak: 'break-word' }}>{it.text}</div>
                      )}
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 5 }}>{relTime(it.when)}</div>
                    </div>
                  </div>
                </React.Fragment>
              )
            })}
          </div>
        </div>
      )}

      <button
        onClick={toggle}
        title="Was die anderen Admins gemacht haben"
        className="fab-btn"
        style={{
          position: 'fixed', right: 20, bottom: 152, zIndex: 99999,
          width: 54, height: 54, borderRadius: '50%',
          background: open ? 'rgba(6,182,212,0.18)' : 'rgba(255,255,255,0.06)',
          color: '#06b6d4',
          border: `1px solid ${open ? 'rgba(6,182,212,0.5)' : 'rgba(255,255,255,0.12)'}`,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.16s ease, border-color 0.16s ease',
        }}
      >
        {open ? <ChevronDown size={23} strokeWidth={2.6} /> : <Users size={21} strokeWidth={2.2} />}
        {!open && unread > 0 && (
          <span style={{
            position: 'absolute', top: -3, right: -3,
            minWidth: 20, height: 20, padding: '0 5px', borderRadius: 999,
            background: '#06b6d4', color: '#04222a', fontSize: 11, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid var(--bg-base)', lineHeight: 1,
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>
    </>
  )
}
