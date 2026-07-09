import React, { useState, useEffect, useCallback } from 'react'
import { Bell, ChevronDown, StickyNote, Film, Inbox, Lightbulb, Palmtree, Megaphone, Repeat, Hand, LogIn, LogOut } from 'lucide-react'
import { supabase } from '../supabase'

// v3.61.0: Aktivitäts-Feed — sammelt alle Aktualisierungen an einem Ort.
// v3.61.4: Emojis raus → saubere lucide-Icons (Glas-/Icon-Design wie die Menüs),
//          [Tokens] werden als kleine Pills dargestellt.
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

// v3.61.5: Uhrzeit HH:MM + Schicht-Dauer
function clockTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}
function durationText(a, b) {
  if (!a || !b) return ''
  const mins = Math.round((new Date(b) - new Date(a)) / 60000)
  if (mins < 1) return ''
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

// Text mit [Tokens] als kleine Pills rendern (z.B. [Chiara] [Spät])
function renderBody(text) {
  if (!text) return null
  const parts = String(text).split(/(\[[^\]]+\])/g)
  return parts.map((p, i) => {
    const m = p.match(/^\[([^\]]+)\]$/)
    if (m) return (
      <span key={i} style={{
        display: 'inline-block', padding: '0 6px', margin: '0 3px', borderRadius: 5,
        background: 'rgba(255,255,255,0.08)', color: 'var(--text-secondary)',
        fontSize: 10, fontWeight: 700, lineHeight: '16px', verticalAlign: 'middle',
      }}>{m[1]}</span>
    )
    return <React.Fragment key={i}>{p}</React.Fragment>
  })
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

    const [notes, board, reqs, ideas, absences, swaps, reactions, logs] = await Promise.allSettled([
      q('notes', 40), q('model_board_activity', 60), q('content_requests', 40), q('content_ideas', 40),
      q('absences', 40), q('shift_swaps', 40), q('swap_reactions', 40),
      supabase.from('shift_logs').select('*').gte('checked_in_at', sinceIso).order('checked_in_at', { ascending: false }).limit(60),
    ])
    const rows = (r) => (r.status === 'fulfilled' ? (r.value.data || []) : [])
    const merged = []
    for (const n of rows(notes)) {
      const clean = (n.text || '').replace(/^Schichtnotiz von .+?\s·\s/, '') // redundanten Präfix entfernen
      merged.push({ id: 'note-' + n.id, when: n.created_at, Icon: StickyNote, color: '#a78bfa', title: 'Neue Notiz' + (n.author ? ` · ${n.author}` : ''), text: clean })
    }
    for (const a of rows(board)) merged.push({ id: 'board-' + a.id, when: a.created_at, Icon: Film, color: '#06b6d4', title: `${a.model_name || 'Model'} · ${a.action || 'Board aktualisiert'}${a.category ? ` (${a.category})` : ''}`, text: a.details })
    for (const r of rows(reqs)) merged.push({ id: 'req-' + r.id, when: r.created_at, Icon: Inbox, color: '#f59e0b', title: `Neue Anfrage · ${r.model_name || ''}`, text: r.edited_text || r.request_text })
    for (const i of rows(ideas)) merged.push({ id: 'idea-' + i.id, when: i.created_at, Icon: Lightbulb, color: '#10b981', title: `Content-Idee · ${i.model_name || ''}`, text: i.idea_text })
    for (const a of rows(absences)) merged.push({ id: 'abs-' + a.id, when: a.created_at, Icon: Palmtree, color: '#22d3ee', title: `Freie Tage · ${a.chatter_name || ''}`, text: `${a.date_from || ''}${a.date_to && a.date_to !== a.date_from ? '–' + a.date_to : ''}${a.reason ? ' · ' + a.reason : ''}` })
    for (const s of rows(swaps)) {
      if (s.block_label || s.target) {
        merged.push({ id: 'swap-' + s.id, when: s.created_at, Icon: Megaphone, color: '#f59e0b', title: 'Schicht ausgeschrieben', text: `${s.block_label || `${s.shift_date || ''} ${s.shift || ''}`}${s.model_name ? ' · ' + s.model_name : ''}` })
      } else {
        merged.push({ id: 'swap-' + s.id, when: s.created_at, Icon: Repeat, color: '#a78bfa', title: `Tausch-Anfrage · ${s.requester_name || ''}`, text: `${s.shift_date || ''} ${s.shift || ''}${s.model_name ? ' · ' + s.model_name : ''}${s.reason ? ' · ' + s.reason : ''}` })
      }
    }
    for (const r of rows(reactions)) merged.push({ id: 'react-' + r.id, when: r.created_at, Icon: Hand, color: '#10b981', title: `Schicht-Bewerbung · ${r.chatter_name || ''}`, text: r.reaction ? `Reaktion: ${r.reaction}` : 'hat sich auf eine Schicht beworben' })
    // v3.61.5: Schicht-Login / -Logout mit Uhrzeiten
    for (const l of rows(logs)) {
      merged.push({ id: 'login-' + l.id, when: l.checked_in_at, Icon: LogIn, color: '#10b981', title: `Schicht begonnen · ${l.display_name || ''}`, text: `${l.shift ? l.shift + ' · ' : ''}um ${clockTime(l.checked_in_at)} Uhr` })
      if (l.checked_out_at) {
        const dur = durationText(l.checked_in_at, l.checked_out_at)
        merged.push({ id: 'logout-' + l.id, when: l.checked_out_at, Icon: LogOut, color: '#94a3b8', title: `Schicht beendet · ${l.display_name || ''}`, text: `um ${clockTime(l.checked_out_at)} Uhr${dur ? ' · Dauer ' + dur : ''}` })
      }
    }

    merged.sort((a, b) => new Date(b.when) - new Date(a.when))
    setItems(merged.slice(0, 100))
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
              <div key={it.id} style={{ display: 'flex', gap: 11, padding: '11px 14px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: it.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                  <it.Icon size={15} color={it.color} strokeWidth={2} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: it.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>{relTime(it.when)}</span>
                  </div>
                  {it.text && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: 3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' }}>{renderBody(it.text)}</div>
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
          width: 54, height: 54, borderRadius: '50%',
          background: open ? 'rgba(34,211,238,0.18)' : 'rgba(255,255,255,0.06)',
          color: '#22d3ee',
          border: `1px solid ${open ? 'rgba(34,211,238,0.5)' : 'rgba(255,255,255,0.12)'}`,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.16s ease, border-color 0.16s ease',
        }}
      >
        {open ? <ChevronDown size={23} strokeWidth={2.6} /> : <Bell size={21} fill="currentColor" strokeWidth={0} />}
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
