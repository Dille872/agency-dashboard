import React, { useState, useEffect, useCallback } from 'react'
import { Bell, ChevronDown } from 'lucide-react'
import { supabase } from '../supabase'

// v3.61.0: Aktivitäts-Feed — sammelt alle Aktualisierungen an einem Ort.
// Quellen: neue Notizen, Model-Board-Änderungen, neue Custom-Content-Anfragen,
// neue Content-Ideen. Reine Lese-Aggregation (schreibt nichts). Ungelesen-Zähler
// über einen "zuletzt gesehen"-Zeitstempel in localStorage; Öffnen setzt ihn zurück.
const SEEN_KEY = 'activity_last_seen'

function relTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'gerade eben'
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min`
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std`
  if (diff < 172800) return 'gestern'
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
}

export default function ActivityWidget() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [lastSeen, setLastSeen] = useState(() => {
    try { return localStorage.getItem(SEEN_KEY) || '' } catch { return '' }
  })

  const load = useCallback(async () => {
    const since = new Date()
    since.setDate(since.getDate() - 14)
    const sinceIso = since.toISOString()
    const q = (table, limit) =>
      supabase.from(table).select('*').gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(limit)

    const [notes, board, reqs, ideas] = await Promise.allSettled([
      q('notes', 40), q('model_board_activity', 60), q('content_requests', 40), q('content_ideas', 40),
    ])
    const rows = (r) => (r.status === 'fulfilled' ? (r.value.data || []) : [])
    const merged = []
    for (const n of rows(notes)) merged.push({ id: 'note-' + n.id, when: n.created_at, icon: '📝', color: '#a78bfa', title: 'Neue Notiz' + (n.author ? ` · ${n.author}` : ''), text: n.text })
    for (const a of rows(board)) merged.push({ id: 'board-' + a.id, when: a.created_at, icon: '🎬', color: '#06b6d4', title: `${a.model_name || 'Model'} · ${a.action || 'Board aktualisiert'}${a.category ? ` (${a.category})` : ''}`, text: a.details })
    for (const r of rows(reqs)) merged.push({ id: 'req-' + r.id, when: r.created_at, icon: '📥', color: '#f59e0b', title: `Neue Anfrage · ${r.model_name || ''}`, text: r.edited_text || r.request_text })
    for (const i of rows(ideas)) merged.push({ id: 'idea-' + i.id, when: i.created_at, icon: '💡', color: '#10b981', title: `Content-Idee · ${i.model_name || ''}`, text: i.idea_text })
    merged.sort((a, b) => new Date(b.when) - new Date(a.when))
    setItems(merged.slice(0, 80))
  }, [])

  useEffect(() => { load() }, [load])

  const unread = items.filter(i => i.when && (!lastSeen || new Date(i.when) > new Date(lastSeen))).length

  const toggle = () => {
    setOpen(o => {
      const next = !o
      if (next) {
        const now = new Date().toISOString()
        setLastSeen(now)
        try { localStorage.setItem(SEEN_KEY, now) } catch {}
        load()
      }
      return next
    })
  }

  return (
    <>
      {open && (
        <div style={{
          position: 'fixed', right: 20, bottom: 150, zIndex: 99998,
          width: 'min(420px, calc(100vw - 40px))',
          height: 'min(560px, calc(100vh - 160px))',
          background: 'var(--bg-base)', border: '1px solid var(--border)',
          borderRadius: 16, boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
              <Bell size={16} /> Aktivität
            </div>
            <button onClick={() => setOpen(false)} title="Minimieren" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex' }}>
              <ChevronDown size={20} />
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {items.length === 0 ? (
              <div style={{ padding: 20, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>Keine neuen Aktivitäten.</div>
            ) : items.map(it => (
              <div key={it.id} style={{ display: 'flex', gap: 10, padding: '11px 14px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 16, lineHeight: 1.3, flexShrink: 0 }}>{it.icon}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: it.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>{relTime(it.when)}</span>
                  </div>
                  {it.text && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45, marginTop: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' }}>{it.text}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={toggle}
        title="Aktivität"
        style={{
          position: 'fixed', right: 20, bottom: 86, zIndex: 99999,
          width: 56, height: 56, borderRadius: '50%',
          background: open
            ? 'linear-gradient(135deg, #0e7490 0%, #155e75 100%)'
            : 'linear-gradient(135deg, #22d3ee 0%, #0891b2 100%)',
          color: '#fff', border: '1px solid rgba(255,255,255,0.18)',
          boxShadow: '0 10px 30px rgba(8,145,178,0.45), inset 0 1px 0 rgba(255,255,255,0.28)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'transform 0.15s ease, box-shadow 0.15s ease',
        }}
      >
        {open
          ? <ChevronDown size={24} strokeWidth={2.6} />
          : <Bell size={22} fill="currentColor" strokeWidth={0} />}
        {!open && unread > 0 && (
          <span style={{
            position: 'absolute', top: -3, right: -3,
            minWidth: 20, height: 20, padding: '0 5px', borderRadius: 999,
            background: '#ef4444', color: '#fff', fontSize: 11, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid var(--bg-base)', lineHeight: 1,
          }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    </>
  )
}
