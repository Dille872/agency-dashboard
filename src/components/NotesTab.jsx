import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import Card from './Card'

export default function NotesTab({ session }) {
  const [notes, setNotes] = useState([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadNotes()
    // Realtime subscription
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 800 }}>
      <Card title="Neue Notiz">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) addNote() }}
            placeholder="Notiz schreiben... (Cmd+Enter zum Speichern)"
            rows={3}
            style={{
              width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a',
              color: 'var(--text-primary)', padding: '10px 12px', borderRadius: 8,
              fontSize: 13, resize: 'vertical', fontFamily: 'inherit', outline: 'none',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={addNote} disabled={loading || !text.trim()} style={{
              background: text.trim() ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : 'var(--border)',
              color: text.trim() ? '#fff' : 'var(--text-muted)',
              border: 'none', borderRadius: 8, padding: '9px 20px',
              fontSize: 13, fontWeight: 700, cursor: text.trim() ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit', transition: 'all 0.15s',
            }}>
              {loading ? 'Speichern...' : '+ Notiz speichern'}
            </button>
          </div>
        </div>
      </Card>

      <Card title={`Notizen (${notes.length})`}>
        {notes.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
            Noch keine Notizen vorhanden
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {notes.map(note => (
              <div key={note.id} style={{
                padding: '12px 14px', background: 'var(--bg-card2)',
                borderRadius: 8, borderLeft: '3px solid #7c3aed',
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 5, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#a78bfa' }}>{note.author}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{formatTime(note.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{note.text}</div>
                </div>
                <button onClick={() => deleteNote(note.id)} style={{
                  background: 'transparent', border: 'none', color: 'var(--text-muted)',
                  cursor: 'pointer', fontSize: 14, padding: '0 4px', flexShrink: 0,
                  transition: 'color 0.15s',
                }}
                  onMouseEnter={e => e.target.style.color = '#ef4444'}
                  onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}
                >✕</button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
