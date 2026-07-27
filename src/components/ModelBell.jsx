import React, { useState, useEffect, useCallback } from 'react'
import { Bell, ChevronDown } from 'lucide-react'
import { supabase } from '../supabase'

/**
 * ModelBell v3.99.0 — Benachrichtigungs-Glocke für das Model-Portal.
 *
 * Gegenstück zur ChatterBell. Sie lädt ihre Daten selbst (statt sie durchzureichen),
 * weil das Model-Portal die Quellen bereits pro Tab getrennt lädt und ein zentraler
 * Überblick sonst von der Tab-Auswahl abhinge.
 *
 * Quellen — alles vorhandene Tabellen, keine Migration nötig:
 *   content_requests     → offene Content-Anfragen vom Team
 *   custom_content       → neu hinterlegter Custom Content (read_by_model)
 *   todos                → zugewiesene Aufgaben
 *   model_calendar       → anstehende Termine (nächste 7 Tage)
 *   model_board_activity → Board-Änderungen durch das Team
 *
 * Gelesen-Zustand in localStorage. Offene Anfragen und heutige/morgige Termine
 * gelten immer als ungelesen — die sollen nicht durch "Alles gelesen" verschwinden.
 */

const SEEN_KEY = (name) => `modelbell_seen_${name || 'default'}`

function relTime(iso) {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 0) return 'demnächst'
  if (diff < 60) return 'gerade eben'
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min`
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std`
  if (diff < 172800) return 'gestern'
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
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
const fmtDay = (iso) => {
  if (!iso) return ''
  const d = new Date(String(iso).length <= 10 ? iso + 'T00:00:00' : iso)
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
}
const short = (s, n = 90) => {
  const t = (s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

const CHIPS = [
  { key: 'all', label: 'Alle' },
  { key: 'requests', label: 'Anfragen' },
  { key: 'tasks', label: 'Aufgaben' },
  { key: 'calendar', label: 'Termine' },
  { key: 'board', label: 'Board' },
]

export default function ModelBell({ displayName, onNavigate }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('all')
  const [items, setItems] = useState([])
  const [lastSeen, setLastSeen] = useState(() => {
    try {
      const stored = localStorage.getItem(SEEN_KEY(displayName))
      if (stored) return stored
      // Erster Aufruf: ab jetzt zählen, sonst wäre die ganze Historie ungelesen.
      const now = new Date().toISOString()
      localStorage.setItem(SEEN_KEY(displayName), now)
      return now
    } catch { return new Date().toISOString() }
  })

  const load = useCallback(async () => {
    if (!displayName) return
    const since = new Date(); since.setDate(since.getDate() - 14)
    const sinceIso = since.toISOString()
    const todayIso = new Date().toISOString().slice(0, 10)
    const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)

    const [reqRes, ccRes, todoRes, calRes, boardRes] = await Promise.allSettled([
      supabase.from('content_requests').select('*').eq('model_name', displayName)
        .gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(30),
      supabase.from('custom_content').select('*').eq('model_name', displayName)
        .gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(30),
      supabase.from('todos').select('*').eq('assigned_to', displayName)
        .gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(30),
      supabase.from('model_calendar').select('*').eq('model_name', displayName)
        .gte('due_date', todayIso).lte('due_date', in7).order('due_date').limit(20),
      supabase.from('model_board_activity').select('*').eq('model_name', displayName)
        .gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(30),
    ])
    const rows = (r) => (r.status === 'fulfilled' ? (r.value.data || []) : [])
    const out = []

    // 1) Content-Anfragen vom Team
    for (const r of rows(reqRes)) {
      const offen = r.status === 'angefragt' || r.status === 'neu' || r.status === 'bestaetigt'
      out.push({
        id: 'req-' + r.id, kind: 'requests', ts: r.created_at,
        icon: '📥', tone: offen ? '#f59e0b' : '#8888aa', forceUnread: offen,
        title: offen ? 'Neue Content-Anfrage' : `Anfrage · ${r.status}`,
        body: [short(r.edited_text || r.request_text, 110), r.chatter_name ? `von ${r.chatter_name}` : null,
               r.price ? `${r.price} $` : null, r.deadline ? `bis ${fmtDay(r.deadline)}` : null]
          .filter(Boolean).join(' · '),
        action: { label: 'Zu den Anfragen', tone: '#f59e0b', run: () => { onNavigate?.('anfragen'); setOpen(false) } },
      })
    }

    // 2) Custom Content, den das Team hinterlegt hat
    for (const c of rows(ccRes)) {
      const neu = c.read_by_model === false
      out.push({
        id: 'cc-' + c.id, kind: 'requests', ts: c.created_at,
        icon: '🎬', tone: neu ? '#06b6d4' : '#8888aa', forceUnread: neu,
        title: neu ? 'Neuer Custom Content für dich' : 'Custom Content',
        body: short(c.text || c.title || c.description, 110),
        action: { label: 'Im Board ansehen', tone: '#06b6d4', run: () => { onNavigate?.('board'); setOpen(false) } },
      })
    }

    // 3) Aufgaben
    for (const t of rows(todoRes)) {
      if (t.completed) continue
      out.push({
        id: 'todo-' + t.id, kind: 'tasks', ts: t.created_at,
        icon: '📋', tone: '#ef4444',
        title: `Neue Aufgabe${t.created_by ? ` von ${t.created_by}` : ''}`,
        body: [t.title, t.description, t.due_date ? `bis ${fmtDay(t.due_date)}` : null].filter(Boolean).join(' · '),
        action: { label: 'Zu den Aufgaben', tone: '#7c3aed', run: () => { onNavigate?.('home'); setOpen(false) } },
      })
    }

    // 4) Anstehende Termine (nächste 7 Tage) — heute und morgen immer hervorgehoben
    for (const c of rows(calRes)) {
      const days = Math.round((new Date(c.due_date + 'T00:00:00') - new Date(todayIso + 'T00:00:00')) / 86400000)
      out.push({
        id: 'cal-' + c.id, kind: 'calendar',
        ts: new Date(c.due_date + 'T09:00:00').toISOString(),
        icon: '📅', tone: days <= 1 ? '#10b981' : '#a78bfa', forceUnread: days <= 1,
        title: days === 0 ? `Heute: ${c.title}` : days === 1 ? `Morgen: ${c.title}` : c.title,
        body: [fmtDay(c.due_date), c.category, short(c.notes || c.content, 80)].filter(Boolean).join(' · '),
        action: { label: 'Kalender öffnen', tone: '#a78bfa', run: () => { onNavigate?.('kalender'); setOpen(false) } },
      })
    }

    // 5) Board-Änderungen durch das Team
    for (const b of rows(boardRes)) {
      out.push({
        id: 'board-' + b.id, kind: 'board', ts: b.created_at,
        icon: '📋', tone: '#f59e0b',
        title: `Board aktualisiert${b.category ? ` · ${b.category}` : ''}`,
        body: [b.action, short(b.details, 90)].filter(Boolean).join(' · '),
        action: { label: 'Board öffnen', tone: '#f59e0b', run: () => { onNavigate?.('board'); setOpen(false) } },
      })
    }

    out.sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0))
    setItems(out.slice(0, 120))
  }, [displayName, onNavigate])

  useEffect(() => {
    if (!displayName) return
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [displayName, load])

  const isUnread = (it) => it.forceUnread || !lastSeen || new Date(it.ts || 0) > new Date(lastSeen)
  const unreadCount = items.filter(isUnread).length
  const shown = filter === 'all' ? items : items.filter(it => it.kind === filter)

  const markAll = () => {
    const now = new Date().toISOString()
    setLastSeen(now)
    try { localStorage.setItem(SEEN_KEY(displayName), now) } catch {}
  }
  const close = () => { setOpen(false); markAll() }

  let bucket = null

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
                background: filter === c.key ? 'rgba(245,158,11,0.18)' : 'rgba(255,255,255,0.04)',
                color: filter === c.key ? '#f59e0b' : 'var(--text-muted)',
                border: `1px solid ${filter === c.key ? 'rgba(245,158,11,0.45)' : 'var(--border)'}`,
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
              const b = dayBucket(it.ts)
              const sep = b !== bucket ? (bucket = b) : null
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
                    background: unread ? 'rgba(245,158,11,0.06)' : 'var(--bg-card)',
                    border: `1px solid ${unread ? 'rgba(245,158,11,0.35)' : 'var(--border)'}`,
                  }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: 9, flexShrink: 0, fontSize: 15,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: it.tone + '26', color: it.tone,
                    }}>{it.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.45, color: 'var(--text-primary)' }}>{it.title}</div>
                      {it.body && (
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.5, wordBreak: 'break-word' }}>{it.body}</div>
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
