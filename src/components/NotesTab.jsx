import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'

function Card({ title, children }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '16px 18px' }}>
      {title && <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 14 }}>{title}</div>}
      {children}
    </div>
  )
}

export default function NotesTab({ session }) {
  const [notes, setNotes] = useState([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [openModels, setOpenModels] = useState({})
  const [openMonths, setOpenMonths] = useState({})
  const [openDays, setOpenDays] = useState({})
  const author = session?.user?.email?.split('@')[0] || 'Admin'

  useEffect(() => {
    loadNotes()
    const channel = supabase.channel('notes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, () => loadNotes())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  const loadNotes = async () => {
    const { data } = await supabase.from('notes').select('*').order('created_at', { ascending: false })
    setNotes(data || [])
  }

  const addNote = async () => {
    if (!text.trim()) return
    setLoading(true)
    await supabase.from('notes').insert({ text: text.trim(), author, read: true })
    setText('')
    setLoading(false)
  }

  const deleteNote = async (id) => {
    await supabase.from('notes').delete().eq('id', id)
    loadNotes()
  }

  const markDayRead = async (dayNoteIds) => {
    await supabase.from('notes').update({ read: true }).in('id', dayNoteIds)
    setNotes(prev => prev.map(n => dayNoteIds.includes(n.id) ? { ...n, read: true } : n))
  }

  const formatTime = (ts) => {
    const d = new Date(ts)
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  }

  const formatDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
  }

  const formatMonth = (monthStr) => {
    const [y, m] = monthStr.split('-')
    return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
  }

  const parseShiftNote = (note) => {
    const t = note.text
    const authorMatch = t.match(/Schichtnotiz von ([^·]+)/)
    const shiftMatch = t.match(/\[([^\]]+)\]\s*\[([^\]]+)\]/)
    const contentMatch = t.match(/:\s*(.+)$/s)
    return {
      model: shiftMatch ? shiftMatch[1] : 'Unbekannt',
      shift: shiftMatch ? shiftMatch[2] : '',
      author: authorMatch ? authorMatch[1].trim() : note.author,
      content: contentMatch ? contentMatch[1].trim() : t,
    }
  }

  const shiftNotes = notes.filter(n => n.text?.startsWith('Schichtnotiz von '))
  const regularNotes = notes.filter(n => !n.text?.startsWith('Schichtnotiz von '))

  // Build model → month → day → notes structure
  const tree = {}
  for (const note of shiftNotes) {
    const parsed = parseShiftNote(note)
    const model = parsed.model
    const dateStr = note.created_at.slice(0, 10)
    const monthStr = dateStr.slice(0, 7)
    if (!tree[model]) tree[model] = {}
    if (!tree[model][monthStr]) tree[model][monthStr] = {}
    if (!tree[model][monthStr][dateStr]) tree[model][monthStr][dateStr] = []
    tree[model][monthStr][dateStr].push({ ...note, parsed })
  }

  const modelNames = Object.keys(tree).sort()

  const toggleModel = (model) => {
    setOpenModels(p => ({ ...p, [model]: !p[model] }))
  }
  const toggleMonth = (key) => {
    setOpenMonths(p => ({ ...p, [key]: !p[key] }))
  }
  const toggleDay = async (key, noteIds, hasUnread) => {
    setOpenDays(p => ({ ...p, [key]: !p[key] }))
    if (!openDays[key] && hasUnread) {
      await markDayRead(noteIds)
    }
  }

  const modelColors = ['#f59e0b', '#10b981', '#a78bfa', '#ef4444', '#06b6d4', '#f97316']
  const getModelColor = (i) => modelColors[i % modelColors.length]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900 }}>

      {/* New note */}
      <Card title="Neue Notiz">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) addNote() }}
            placeholder="Notiz schreiben... (Cmd+Enter zum Speichern)"
            rows={3}
            style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '10px 12px', borderRadius: 8, fontSize: 13, resize: 'vertical', fontFamily: 'inherit', outline: 'none' }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={addNote} disabled={loading || !text.trim()} style={{
              background: text.trim() ? '#7c3aed' : 'var(--border)', color: text.trim() ? '#fff' : 'var(--text-muted)',
              border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 700,
              cursor: text.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
            }}>{loading ? 'Speichern...' : '+ Notiz speichern'}</button>
          </div>
        </div>
      </Card>

      {/* Shift notes archive */}
      {modelNames.length > 0 && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e1e3a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
              Schichtnotizen · {shiftNotes.length} Einträge
            </div>
            {shiftNotes.filter(n => !n.read).length > 0 && (
              <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700 }}>
                {shiftNotes.filter(n => !n.read).length} ungelesen
              </div>
            )}
          </div>

          {modelNames.map((model, mi) => {
            const color = getModelColor(mi)
            const allModelNotes = shiftNotes.filter(n => parseShiftNote(n).model === model)
            const unreadCount = allModelNotes.filter(n => !n.read).length
            const isOpen = openModels[model]
            const months = Object.keys(tree[model]).sort().reverse()

            return (
              <div key={model} style={{ borderBottom: '1px solid #1e1e3a' }}>
                {/* Model row */}
                <div onClick={() => toggleModel(model)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', cursor: 'pointer', background: isOpen ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', transition: 'transform .2s', display: 'inline-block', transform: isOpen ? 'rotate(90deg)' : 'rotate(0)' }}>▶</span>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color, flexShrink: 0 }}>{model[0]}</div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>{model}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color, background: color + '22', padding: '2px 8px', borderRadius: 4 }}>{allModelNotes.length}</span>
                  {unreadCount > 0 && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', background: 'rgba(245,158,11,0.15)', padding: '2px 8px', borderRadius: 4 }}>{unreadCount} neu</span>
                  )}
                </div>

                {isOpen && (
                  <div style={{ paddingLeft: 18, paddingBottom: 8 }}>
                    {months.map(month => {
                      const monthKey = model + '-' + month
                      const isMonthOpen = openMonths[monthKey]
                      const days = Object.keys(tree[model][month]).sort().reverse()
                      const monthUnread = days.reduce((s, d) => s + tree[model][month][d].filter(n => !n.read).length, 0)
                      const monthTotal = days.reduce((s, d) => s + tree[model][month][d].length, 0)

                      return (
                        <div key={month} style={{ borderLeft: '2px solid ' + color + '33', paddingLeft: 12, marginBottom: 4 }}>
                          {/* Month row */}
                          <div onClick={() => toggleMonth(monthKey)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer', borderRadius: 7 }}>
                            <span style={{ fontSize: 9, color: 'var(--text-muted)', transition: 'transform .2s', display: 'inline-block', transform: isMonthOpen ? 'rotate(90deg)' : 'rotate(0)' }}>▶</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>{formatMonth(month)}</span>
                            <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-card2)', padding: '1px 7px', borderRadius: 4 }}>{monthTotal}</span>
                            {monthUnread > 0 && <span style={{ fontSize: 10, color: '#f59e0b', background: 'rgba(245,158,11,0.12)', padding: '1px 7px', borderRadius: 4 }}>{monthUnread} neu</span>}
                          </div>

                          {isMonthOpen && days.map(day => {
                            const dayKey = model + '-' + day
                            const isDayOpen = openDays[dayKey]
                            const dayNotes = tree[model][month][day]
                            const dayUnread = dayNotes.filter(n => !n.read).length
                            const dayNoteIds = dayNotes.map(n => n.id)

                            return (
                              <div key={day} style={{ paddingLeft: 12 }}>
                                {/* Day row */}
                                <div onClick={() => toggleDay(dayKey, dayNoteIds, dayUnread > 0)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer', borderRadius: 6 }}>
                                  <span style={{ fontSize: 9, color: 'var(--text-muted)', transition: 'transform .2s', display: 'inline-block', transform: isDayOpen ? 'rotate(90deg)' : 'rotate(0)' }}>▶</span>
                                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', flex: 1 }}>{formatDate(day)}</span>
                                  <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-card2)', padding: '1px 6px', borderRadius: 4 }}>{dayNotes.length}</span>
                                  {dayUnread > 0 && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', display: 'inline-block', flexShrink: 0 }} />}
                                </div>

                                {isDayOpen && (
                                  <div style={{ padding: '4px 8px 8px' }}>
                                    {dayNotes.map(note => (
                                      <div key={note.id} style={{ background: note.read ? 'var(--bg-card2)' : 'rgba(245,158,11,0.05)', border: '1px solid ' + (note.read ? '#1e1e3a' : 'rgba(245,158,11,0.2)'), borderLeft: '3px solid #06b6d4', borderRadius: 8, padding: '10px 12px', marginBottom: 6 }}>
                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 5, flexWrap: 'wrap' }}>
                                          <span style={{ fontSize: 12, fontWeight: 700, color: '#06b6d4' }}>{note.parsed.author}</span>
                                          {note.parsed.shift && <span style={{ fontSize: 10, background: 'rgba(124,58,237,0.15)', color: '#a78bfa', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>{note.parsed.shift}</span>}
                                          {!note.read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />}
                                          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', marginLeft: 'auto' }}>{formatTime(note.created_at)}</span>
                                          <button onClick={() => deleteNote(note.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, padding: 0 }}
                                            onMouseEnter={e => e.target.style.color = '#ef4444'}
                                            onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
                                        </div>
                                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{note.parsed.content}</div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Regular notes */}
      <Card title={'Notizen (' + regularNotes.length + ')'}>
        {regularNotes.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Noch keine Notizen vorhanden</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {regularNotes.map(note => (
              <div key={note.id} style={{ padding: '10px 12px', background: 'var(--bg-card2)', borderRadius: 8, borderLeft: '3px solid #7c3aed', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 5, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#a78bfa' }}>{note.author}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {new Date(note.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} {new Date(note.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{note.text}</div>
                </div>
                <button onClick={() => deleteNote(note.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, padding: '0 4px', flexShrink: 0 }}
                  onMouseEnter={e => e.target.style.color = '#ef4444'}
                  onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
