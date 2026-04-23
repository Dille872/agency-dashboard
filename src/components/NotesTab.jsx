import React, { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'

const cardS = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }
const badgeS = (bg, color) => ({ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: bg, color, display: 'inline-block' })

function initials(name) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function parseNote(text) {
  // Format: "Schichtnotiz von NAME · [MODEL] [SHIFT]: TEXT"
  // or just free text
  const match = text?.match(/^Schichtnotiz von ([^·:]+?)(?:\s*·\s*\[([^\]]*)\])?(?:\s*\[([^\]]*)\])?:\s*(.+)$/s)
  if (match) {
    return {
      author: match[1]?.trim(),
      model: match[2]?.trim() || null,
      shift: match[3]?.trim() || null,
      text: match[4]?.trim(),
      isShiftNote: true,
    }
  }
  // Try "Schichtnotiz von NAME: TEXT"
  const simple = text?.match(/^Schichtnotiz von ([^:]+):\s*(.+)$/s)
  if (simple) {
    return { author: simple[1]?.trim(), model: null, shift: null, text: simple[2]?.trim(), isShiftNote: true }
  }
  return { author: null, model: null, shift: null, text, isShiftNote: false }
}

function formatTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
}

function formatDayLabel(dateStr) {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
  if (dateStr === today) return 'Heute'
  if (dateStr === yesterday) return 'Gestern'
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
}

const AVATAR_COLORS = [
  ['rgba(6,182,212,0.15)', '#0e7490'],
  ['rgba(167,139,250,0.15)', '#6d28d9'],
  ['rgba(16,185,129,0.15)', '#065f46'],
  ['rgba(245,158,11,0.15)', '#92400e'],
  ['rgba(239,68,68,0.15)', '#991b1b'],
  ['rgba(99,102,241,0.15)', '#3730a3'],
]
const authorColors = {}
let colorIdx = 0
function getAuthorColor(name) {
  if (!name) return AVATAR_COLORS[0]
  if (!authorColors[name]) {
    authorColors[name] = AVATAR_COLORS[colorIdx % AVATAR_COLORS.length]
    colorIdx++
  }
  return authorColors[name]
}

export default function NotesTab({ session }) {
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterAuthor, setFilterAuthor] = useState('')
  const [filterModel, setFilterModel] = useState('')
  const [openDays, setOpenDays] = useState({})
  const [newNote, setNewNote] = useState('')
  const [sending, setSending] = useState(false)
  const displayName = session?.user?.email?.split('@')[0] || 'Admin'

  useEffect(() => { loadNotes() }, [])

  const loadNotes = async () => {
    setLoading(true)
    const { data } = await supabase.from('notes').select('*').order('created_at', { ascending: false }).limit(300)
    setNotes(data || [])
    setLoading(false)
    // Auto-open today
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
    setOpenDays(prev => ({ ...prev, [today]: true }))
  }

  const sendNote = async () => {
    if (!newNote.trim()) return
    setSending(true)
    await supabase.from('notes').insert({ text: newNote.trim(), author: displayName })
    setNewNote('')
    setSending(false)
    loadNotes()
  }

  const parsed = useMemo(() => notes.map(n => ({ ...n, parsed: parseNote(n.text) })), [notes])

  const authors = useMemo(() => [...new Set(parsed.map(n => n.parsed.author).filter(Boolean))].sort(), [parsed])
  const models = useMemo(() => [...new Set(parsed.map(n => n.parsed.model).filter(Boolean))].sort(), [parsed])

  const filtered = useMemo(() => parsed.filter(n => {
    if (filterAuthor && n.parsed.author !== filterAuthor) return false
    if (filterModel && n.parsed.model !== filterModel) return false
    return true
  }), [parsed, filterAuthor, filterModel])

  // Group by date
  const grouped = useMemo(() => {
    const groups = {}
    for (const note of filtered) {
      const date = new Date(note.created_at).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
      if (!groups[date]) groups[date] = []
      groups[date].push(note)
    }
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]))
  }, [filtered])

  const toggleDay = (date) => setOpenDays(prev => ({ ...prev, [date]: !prev[date] }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* New note */}
      <div style={{ ...cardS, padding: '12px 14px' }}>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 700, marginBottom: 8 }}>Neue Notiz</div>
        <textarea
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
          placeholder="Notiz schreiben..."
          rows={2}
          style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 7, fontSize: 12, resize: 'none', fontFamily: 'inherit', outline: 'none', marginBottom: 8 }}
          onKeyDown={e => e.key === 'Enter' && e.ctrlKey && sendNote()}
        />
        <button onClick={sendNote} disabled={sending || !newNote.trim()}
          style={{ background: newNote.trim() ? '#7c3aed' : 'var(--border)', color: newNote.trim() ? '#fff' : 'var(--text-muted)', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          {sending ? 'Senden...' : '+ Notiz senden'}
        </button>
      </div>

      {/* Filters */}
      {(authors.length > 0 || models.length > 0) && (
        <div style={{ display: 'flex', gap: 8 }}>
          {authors.length > 0 && (
            <select value={filterAuthor} onChange={e => setFilterAuthor(e.target.value)}
              style={{ flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '6px 10px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none', cursor: 'pointer' }}>
              <option value="">Alle Chatter</option>
              {authors.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          {models.length > 0 && (
            <select value={filterModel} onChange={e => setFilterModel(e.target.value)}
              style={{ flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '6px 10px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none', cursor: 'pointer' }}>
              <option value="">Alle Models</option>
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
        </div>
      )}

      {loading && <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 30, fontSize: 13 }}>Laden...</div>}

      {!loading && grouped.length === 0 && (
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 30, fontSize: 13 }}>Noch keine Notizen</div>
      )}

      {grouped.map(([date, dayNotes]) => {
        const isOpen = openDays[date]
        const label = formatDayLabel(date)
        const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
        const isToday = date === today

        return (
          <div key={date} style={cardS}>
            {/* Day header */}
            <div onClick={() => toggleDay(date)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: isOpen ? 'var(--bg-card)' : 'var(--bg-card2)', cursor: 'pointer', borderBottom: isOpen ? '1px solid var(--border)' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
                <span style={{ ...badgeS(isToday ? 'rgba(124,58,237,0.12)' : 'var(--bg-card2)', isToday ? '#7c3aed' : 'var(--text-muted)') }}>
                  {dayNotes.length} {dayNotes.length === 1 ? 'Notiz' : 'Notizen'}
                </span>
              </div>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{isOpen ? '▲' : '▼'}</span>
            </div>

            {/* Notes */}
            {isOpen && dayNotes.map((note, i) => {
              const p = note.parsed
              const [avatarBg, avatarColor] = getAuthorColor(p.author || note.author)
              const name = p.author || note.author || 'Admin'
              return (
                <div key={note.id} style={{ display: 'flex', gap: 10, padding: '10px 14px', borderBottom: i < dayNotes.length - 1 ? '1px solid var(--border)' : 'none', alignItems: 'flex-start' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: avatarBg, color: avatarColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>
                    {initials(name)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{name}</span>
                      {p.shift && <span style={badgeS('rgba(6,182,212,0.12)', '#0e7490')}>{p.shift}</span>}
                      {p.model && <span style={badgeS('rgba(167,139,250,0.12)', '#6d28d9')}>{p.model}</span>}
                      {!p.isShiftNote && <span style={badgeS('rgba(245,158,11,0.12)', '#92400e')}>Allgemein</span>}
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>{formatTime(note.created_at)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{p.text}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
