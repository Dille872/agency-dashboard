import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import Card from './Card'

export default function NotesTab({ session }) {
  const [notes, setNotes] = useState([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadNotes()
    const channel = supabase
      .channel('notes')
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
    const author = session?.user?.email?.split('@')[0] || 'Unbekannt'
    await supabase.from('notes').insert({ text: text.trim(), author })
    setText('')
    setLoading(false)
  }

  const deleteNote = async (id) => {
    await supabase.from('notes').delete().eq('id', id)
  }

  const formatTime = (ts) => {
    const d = new Date(ts)
    const now = new Date()
    const diffH = (now - d) / 3600000
    if (diffH < 24) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  }

  // Separate shift notes from regular notes
  // Shift notes format: "Schichtnotiz von {chatter} · [{model}] [{shift}]: {text}"
  const shiftNotes = notes.filter(n => n.text?.startsWith('Schichtnotiz von '))
  const regularNotes = notes.filter(n => !n.text?.startsWith('Schichtnotiz von '))

  // Parse shift note
  const parseShiftNote = (note) => {
    const text = note.text
    const modelMatch = text.match(/\[([^\]]+)\]/)
    const shiftMatch = text.match(/\[([^\]]+)\]\s*\[([^\]]+)\]/)
    const authorMatch = text.match(/Schichtnotiz von ([^·]+)·/)
    const contentMatch = text.match(/\]: (.+)$/)
    return {
      model: modelMatch ? modelMatch[1] : 'Unbekannt',
      shift: shiftMatch ? shiftMatch[2] : '',
      author: authorMatch ? authorMatch[1].trim() : note.author,
      content: contentMatch ? contentMatch[1] : text,
    }
  }

  // Group shift notes by model
  const shiftNotesByModel = {}
  for (const note of shiftNotes) {
    const parsed = parseShiftNote(note)
    if (!shiftNotesByModel[parsed.model]) shiftNotesByModel[parsed.model] = []
    shiftNotesByModel[parsed.model].push({ ...note, parsed })
  }
  const modelNames = Object.keys(shiftNotesByModel).sort()

  const noteItemStyle = {
    padding: '10px 12px', background: 'var(--bg-card2)',
    borderRadius: 8, borderLeft: '3px solid #7c3aed',
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900 }}>
      {/* New note */}
      <Card title="Neue Notiz">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) addNote() }}
            placeholder="Notiz schreiben... (Cmd+Enter zum Speichern)"
            rows={3}
            style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-bright)', color: 'var(--text-primary)', padding: '10px 12px', borderRadius: 8, fontSize: 13, resize: 'vertical', fontFamily: 'inherit', outline: 'none' }}
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

      {/* Shift notes per model */}
      {modelNames.length > 0 && (
        <Card title={`Schichtnotizen (${shiftNotes.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {modelNames.map(model => (
              <div key={model}>
                {/* Model header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#a78bfa', flexShrink: 0 }}>
                    {model[0]}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#a78bfa' }}>{model}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-card2)', padding: '1px 7px', borderRadius: 10, border: '1px solid var(--border)' }}>
                    {shiftNotesByModel[model].length} Notiz{shiftNotesByModel[model].length !== 1 ? 'en' : ''}
                  </span>
                </div>
                {/* Notes for this model */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 8, borderLeft: '2px solid rgba(124,58,237,0.2)' }}>
                  {shiftNotesByModel[model].map(note => (
                    <div key={note.id} style={{ ...noteItemStyle, borderLeftColor: '#06b6d4' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#06b6d4' }}>{note.parsed.author}</span>
                          {note.parsed.shift && (
                            <span style={{ fontSize: 10, background: 'rgba(245,158,11,0.12)', color: '#f59e0b', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>{note.parsed.shift}</span>
                          )}
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{formatTime(note.created_at)}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{note.parsed.content}</div>
                      </div>
                      <button onClick={() => deleteNote(note.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, padding: '0 4px', flexShrink: 0 }}
                        onMouseEnter={e => e.target.style.color = '#ef4444'}
                        onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Regular notes */}
      <Card title={`Notizen (${regularNotes.length})`}>
        {regularNotes.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Noch keine Notizen vorhanden</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {regularNotes.map(note => (
              <div key={note.id} style={noteItemStyle}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 5, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#a78bfa' }}>{note.author}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{formatTime(note.created_at)}</span>
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
