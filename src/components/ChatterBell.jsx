import React, { useState, useEffect, useCallback } from 'react'
import { Bell, ChevronDown } from 'lucide-react'
import { supabase } from '../supabase'

/**
 * ChatterBell v3.96.0 — Benachrichtigungs-Glocke für das Chatter-Portal.
 *
 * Warum: Der SwapModal poppt bei einem Schichtangebot auf, aber einmal weggeklickt
 * ist das Angebot unauffindbar. Die Glocke ist der Ort, an dem alles liegen bleibt,
 * bis der Chatter reagiert hat. Das Popup bleibt bestehen — es stupst an, die Glocke
 * archiviert.
 *
 * Quellen (keine neue Tabelle nötig):
 *   - shift_swaps / swap_reactions / schedule → offene Schichtangebote (Logik wie SwapModal)
 *   - schedule (status='live')                → "Dienstplan KW xx ist online"
 *   - Props shifts                            → "Schicht startet bald" + Direkt-Check-in
 *   - Props todos                             → neu zugewiesene Aufgaben
 *   - Props announcements                     → neue Pinnwand-Einträge
 *
 * Gelesen-Zustand liegt in localStorage (Zeitstempel des letzten "Alles gelesen").
 * Angebote gelten IMMER als ungelesen, bis reagiert wurde — die sollen nicht verschwinden.
 */

const SEEN_KEY = (name) => `chatterbell_seen_${name || 'default'}`
const normName = (s) => (s || '').trim().toLowerCase()

function weekStartIso(dateIso) {
  const d = new Date(dateIso + 'T00:00:00')
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}
function isoWeek(dateIso) {
  const d = new Date(dateIso + 'T00:00:00')
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNr = (t.getUTCDay() + 6) % 7
  t.setUTCDate(t.getUTCDate() - dayNr + 3)
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  const fDayNr = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fDayNr + 3)
  return 1 + Math.round((t - firstThursday) / (7 * 24 * 3600 * 1000))
}
function relTime(iso) {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 0) return 'gleich'
  if (diff < 60) return 'gerade eben'
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min`
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std`
  if (diff < 172800) return 'gestern'
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
}
function dayBucket(iso) {
  if (!iso) return 'Älter'
  const d = new Date(iso), now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startYest = new Date(startToday); startYest.setDate(startYest.getDate() - 1)
  const startWeek = new Date(startToday); startWeek.setDate(startWeek.getDate() - 7)
  if (d >= startToday) return 'Heute'
  if (d >= startYest) return 'Gestern'
  if (d >= startWeek) return 'Diese Woche'
  return 'Älter'
}
const fmtDay = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })

const CHIPS = [
  { key: 'all', label: 'Alle' },
  { key: 'shifts', label: 'Schichten' },
  { key: 'todos', label: 'Aufgaben' },
  { key: 'team', label: 'Team' },
]
// Welcher Filter-Chip deckt welche Meldungsart ab
const CHIP_OF = {
  offer: 'shifts', schedule: 'shifts', soon: 'shifts',
  todo: 'todos', announcement: 'team',
}

export default function ChatterBell({
  displayName,
  shifts = [],          // myNext7Shifts aus dem Portal
  todos = [],           // myTodos
  announcements = [],
  isOnline = false,
  onCheckIn,            // (shiftName) => void
  onNavigate,           // (tab, panel) => void
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('all')
  const [offers, setOffers] = useState([])
  const [schedules, setSchedules] = useState([])
  const [busy, setBusy] = useState(false)
  const [lastSeen, setLastSeen] = useState(() => {
    try {
      const stored = localStorage.getItem(SEEN_KEY(displayName))
      if (stored) return stored
      // Erster Aufruf: ab jetzt zählen. Sonst wäre beim allerersten Öffnen alles
      // Alte (Aufgaben, Ankündigungen) auf einen Schlag "ungelesen".
      const now = new Date().toISOString()
      localStorage.setItem(SEEN_KEY(displayName), now)
      return now
    } catch { return new Date().toISOString() }
  })

  // ── Schichtangebote laden (gleiche Filterlogik wie SwapModal) ──
  const loadOffers = useCallback(async () => {
    if (!displayName) return
    const today = new Date().toISOString().slice(0, 10)
    const { data: swaps } = await supabase
      .from('shift_swaps').select('*')
      .eq('status', 'offen').gte('shift_date', today)
      .order('shift_date', { ascending: true })
    if (!swaps || swaps.length === 0) { setOffers([]); return }

    const { data: myReactions } = await supabase
      .from('swap_reactions').select('swap_id')
      .in('swap_id', swaps.map(s => s.id))
      .eq('chatter_name', displayName)
    const reacted = new Set((myReactions || []).map(r => r.swap_id))
    const reactedBlocks = new Set(swaps.filter(s => s.block_id && reacted.has(s.id)).map(s => s.block_id))

    // target='frei' nur zeigen, wenn ich in der Schicht NICHT eingeteilt bin
    const busySet = new Set()
    const frei = swaps.filter(s => s.target === 'frei')
    if (frei.length > 0) {
      const weeks = [...new Set(frei.map(s => weekStartIso(s.shift_date)))]
      const { data: scheds } = await supabase
        .from('schedule').select('week_start, assignments').in('week_start', weeks)
      for (const row of scheds || []) {
        for (const [key, val] of Object.entries(row.assignments || {})) {
          if (!val) continue
          const me = normName(displayName)
          const isPrimary = val.chatter && val.chatter !== '__FREI__' && normName(val.chatter) === me
          const isSecond = val.trainee && normName(val.trainee) === me
          if (!isPrimary && !isSecond) continue
          const parts = key.split('__')
          if (parts.length < 3) continue
          busySet.add(`${parts[1]}__${parts[2]}`)
        }
      }
    }

    setOffers(swaps.filter(s => {
      if (s.requester_name === displayName) return false
      if (reacted.has(s.id)) return false
      if (s.block_id && reactedBlocks.has(s.block_id)) return false
      if (s.target === 'frei' && busySet.has(`${s.shift_date}__${s.shift}`)) return false
      return true
    }))
  }, [displayName])

  // ── Veröffentlichte Dienstpläne (für "KW xx ist online") ──
  const loadSchedules = useCallback(async () => {
    const { data } = await supabase
      .from('schedule').select('*').eq('status', 'live')
      .order('week_start', { ascending: false }).limit(4)
    setSchedules(data || [])
  }, [])

  useEffect(() => {
    if (!displayName) return
    loadOffers(); loadSchedules()
    const t = setInterval(() => { loadOffers(); loadSchedules() }, 60000)
    return () => clearInterval(t)
  }, [displayName, loadOffers, loadSchedules])

  // ── Reaktion auf ein Angebot (identisch zum SwapModal, inkl. Block-Logik) ──
  const react = async (ids, reaction) => {
    if (busy) return
    setBusy(true)
    const { error } = await supabase.from('swap_reactions')
      .insert(ids.map(id => ({ swap_id: id, chatter_name: displayName, reaction })))
    if (error) {
      const dup = error.code === '23505' || /duplicate|unique/i.test(error.message || '')
      if (!dup) { alert('Fehler: ' + error.message); setBusy(false); return }
    }
    const set = new Set(ids)
    setOffers(prev => prev.filter(o => !set.has(o.id)))
    setBusy(false)
  }

  // ─────────────────────────────────────────────────────────────
  // Meldungen zusammenbauen
  // ─────────────────────────────────────────────────────────────
  const items = []

  // 1) Schichtangebote — Blöcke als EINE Karte
  const blocks = new Map()
  for (const o of offers) {
    if (o.block_id) {
      if (!blocks.has(o.block_id)) blocks.set(o.block_id, [])
      blocks.get(o.block_id).push(o)
    } else {
      items.push({
        id: `offer-${o.id}`, kind: 'offer', ts: o.created_at || new Date().toISOString(),
        icon: '🙋', tone: '#f59e0b', forceUnread: true,
        title: `Schicht frei: ${o.shift} bei ${o.model_name}`,
        body: `${fmtDay(o.shift_date)}${o.requester_name ? ` · von ${o.requester_name}` : ' · vom Admin'}${o.reason ? `\n${o.reason}` : ''}`,
        ids: [o.id],
      })
    }
  }
  for (const [blockId, rows] of blocks) {
    const first = rows[0]
    items.push({
      id: `offer-block-${blockId}`, kind: 'offer', ts: first.created_at || new Date().toISOString(),
      icon: '🙋', tone: '#f59e0b', forceUnread: true,
      title: `Block frei: ${rows.length} Schichten`,
      body: rows.map(r => `${fmtDay(r.shift_date)} · ${r.shift} · ${r.model_name}`).join('\n'),
      ids: rows.map(r => r.id),
    })
  }

  // 2) Schicht startet bald (nächste 90 Min, noch nicht eingecheckt)
  if (!isOnline) {
    const now = Date.now()
    for (const s of shifts) {
      const start = s.window ? s.window.start.getTime() : null
      if (!start) continue
      const mins = Math.round((start - now) / 60000)
      if (mins < -5 || mins > 90) continue
      items.push({
        id: `soon-${s.dayIso}-${s.shift}`, kind: 'soon',
        ts: new Date(start - 90 * 60000).toISOString(),
        icon: '⏰', tone: '#10b981', forceUnread: true,
        title: mins <= 0 ? `Deine ${s.shift}schicht läuft` : `Deine ${s.shift}schicht startet in ${mins} Min`,
        body: s.models.map(m => m.modelName).join(', '),
        action: { label: 'Jetzt einchecken', tone: '#10b981', run: () => { onCheckIn?.(s.shift); setOpen(false) } },
      })
    }
  }

  // 3) Dienstplan veröffentlicht (letzte 14 Tage, nur Wochen mit eigenen Schichten)
  const cutoff = Date.now() - 14 * 86400000
  for (const sched of schedules) {
    const ts = sched.updated_at || sched.published_at || sched.created_at || `${sched.week_start}T00:00:00`
    if (new Date(ts).getTime() < cutoff) continue
    let mine = 0
    for (const val of Object.values(sched.assignments || {})) {
      if (!val) continue
      const me = normName(displayName)
      if (normName(val.chatter) === me || normName(val.trainee) === me) mine++
    }
    if (mine === 0) continue
    items.push({
      id: `sched-${sched.week_start}`, kind: 'schedule', ts,
      icon: '📅', tone: '#06b6d4',
      title: `Dienstplan KW ${isoWeek(sched.week_start)} ist online`,
      body: `Du hast ${mine} ${mine === 1 ? 'Einteilung' : 'Einteilungen'} in dieser Woche`,
      action: { label: 'Plan ansehen', tone: '#7c3aed', run: () => { onNavigate?.('heute', 'shifts'); setOpen(false) } },
    })
  }

  // 4) Neue Aufgaben
  for (const t of todos) {
    if (t.completed) continue
    items.push({
      id: `todo-${t.id}`, kind: 'todo', ts: t.created_at,
      icon: '📋', tone: '#ef4444',
      title: `Neue Aufgabe${t.created_by ? ` von ${t.created_by}` : ''}`,
      body: [t.title, t.description, t.due_date ? `bis ${fmtDay(String(t.due_date).slice(0, 10))}` : null].filter(Boolean).join(' · '),
      action: { label: 'Zu den Aufgaben', tone: '#7c3aed', run: () => { onNavigate?.('heute', 'todos'); setOpen(false) } },
    })
  }

  // 5) Neue Ankündigungen (nicht abgelaufen, von mir nicht archiviert)
  const nowD = new Date()
  for (const a of announcements) {
    if (a.expires_at && new Date(a.expires_at) < nowD) continue
    if (Array.isArray(a.archived_for) && a.archived_for.includes(displayName)) continue
    items.push({
      id: `ann-${a.id}`, kind: 'announcement', ts: a.created_at,
      icon: a.emoji || '📌', tone: '#7c3aed',
      title: `Neue Ankündigung${a.created_by ? ` von ${a.created_by}` : ''}`,
      body: a.text,
    })
  }

  items.sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0))

  const isUnread = (it) => it.forceUnread || !lastSeen || new Date(it.ts || 0) > new Date(lastSeen)
  const unreadCount = items.filter(isUnread).length
  const shown = filter === 'all' ? items : items.filter(it => CHIP_OF[it.kind] === filter)

  const markAll = () => {
    const now = new Date().toISOString()
    setLastSeen(now)
    try { localStorage.setItem(SEEN_KEY(displayName), now) } catch {}
  }

  // Beim Öffnen NICHT sofort alles als gelesen markieren — sonst verschwinden
  // die Marker, bevor man sie gesehen hat. Erst beim Schließen.
  const close = () => { setOpen(false); markAll() }

  let lastBucket = null

  return (
    <>
      {open && (
        <div style={{
          position: 'fixed', right: 20, bottom: 150, zIndex: 99998,
          width: 'min(400px, calc(100vw - 40px))',
          maxHeight: 'min(620px, calc(100vh - 190px))',
          background: 'var(--bg-base)', border: '1px solid var(--border-bright)',
          borderRadius: 16, boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
              <Bell size={16} /> Benachrichtigungen
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {unreadCount > 0 && (
                <button onClick={markAll} style={{
                  fontSize: 11, padding: '5px 10px', borderRadius: 6, background: 'transparent',
                  border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit',
                }}>Alles gelesen</button>
              )}
              <button onClick={close} title="Schließen" style={{
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
            {shown.length === 0 && (
              <div style={{ padding: '28px 10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                Nichts Neues für dich.
              </div>
            )}
            {shown.map(it => {
              const bucket = dayBucket(it.ts)
              const sep = bucket !== lastBucket ? (lastBucket = bucket) : null
              const unread = isUnread(it)
              return (
                <React.Fragment key={it.id}>
                  {sep && (
                    <div style={{
                      fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase',
                      letterSpacing: '0.09em', margin: '14px 0 8px',
                    }}>{sep}</div>
                  )}
                  <div style={{
                    display: 'flex', gap: 11, padding: '11px 12px', borderRadius: 10, marginBottom: 8,
                    background: unread ? 'rgba(124,58,237,0.06)' : 'var(--bg-card)',
                    border: `1px solid ${unread ? 'rgba(124,58,237,0.4)' : 'var(--border)'}`,
                  }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: 9, flexShrink: 0, fontSize: 15,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: it.tone + '26', color: it.tone,
                    }}>{it.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.45, color: 'var(--text-primary)' }}>{it.title}</div>
                      {it.body && (
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{it.body}</div>
                      )}

                      {it.kind === 'offer' && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
                          <button disabled={busy} onClick={() => react(it.ids, 'uebernehmen')} style={{
                            padding: '6px 12px', borderRadius: 7, fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
                            background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.4)',
                            cursor: busy ? 'not-allowed' : 'pointer',
                          }}>✓ Übernehmen</button>
                          <button disabled={busy} onClick={() => react(it.ids, 'vielleicht')} style={{
                            padding: '6px 12px', borderRadius: 7, fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
                            background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.35)',
                            cursor: busy ? 'not-allowed' : 'pointer',
                          }}>? Vielleicht</button>
                          <button disabled={busy} onClick={() => react(it.ids, 'abgelehnt')} style={{
                            padding: '6px 12px', borderRadius: 7, fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
                            background: 'transparent', color: 'rgba(239,68,68,0.75)', border: '1px solid rgba(239,68,68,0.3)',
                            cursor: busy ? 'not-allowed' : 'pointer',
                          }}>✕ Ablehnen</button>
                        </div>
                      )}

                      {it.action && (
                        <div style={{ marginTop: 9 }}>
                          <button onClick={it.action.run} style={{
                            padding: '6px 12px', borderRadius: 7, fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
                            background: it.action.tone + '22', color: it.action.tone,
                            border: `1px solid ${it.action.tone}59`, cursor: 'pointer',
                          }}>{it.action.label}</button>
                        </div>
                      )}

                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 6 }}>{relTime(it.ts)}</div>
                    </div>
                  </div>
                </React.Fragment>
              )
            })}
          </div>
        </div>
      )}

      <button
        onClick={() => (open ? close() : setOpen(true))}
        title="Benachrichtigungen"
        className="fab-btn"
        style={{
          position: 'fixed', right: 20, bottom: 86, zIndex: 99999,
          width: 54, height: 54, borderRadius: '50%',
          background: open ? 'rgba(245,158,11,0.18)' : 'rgba(255,255,255,0.06)',
          color: '#f59e0b',
          border: `1px solid ${open ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.12)'}`,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.16s ease, border-color 0.16s ease',
        }}
      >
        {open ? <ChevronDown size={23} strokeWidth={2.6} /> : <Bell size={21} fill="currentColor" strokeWidth={0} />}
        {!open && unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: -3, right: -3,
            minWidth: 20, height: 20, padding: '0 5px', borderRadius: 999,
            background: '#ef4444', color: '#fff', fontSize: 11, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid var(--bg-base)', lineHeight: 1,
          }}>{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>
    </>
  )
}
