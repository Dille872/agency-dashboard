import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'
import LoginPage from './components/LoginPage'
import ModelsView from './components/ModelsView'
import ChattersView from './components/ChattersView'
import NotesTab from './components/NotesTab'
import CommTab from './components/CommTab'
import ScheduleTab from './components/ScheduleTab'
import UploadBox from './components/UploadBox'
import { parseCSV, parseModelRow, parseChatterRow, todayISO } from './utils'

export default function App() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)

  const [activeTab, setActiveTab] = useState('models')
  const [businessDate, setBusinessDate] = useState(todayISO())
  const [modelSnapshots, setModelSnapshots] = useState([])
  const [chatterSnapshots, setChatterSnapshots] = useState([])
  const [dataLoading, setDataLoading] = useState(false)
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [unreadNotes, setUnreadNotes] = useState(0)
  const lastNoteCheck = React.useRef(null)

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  // ── Load data from Supabase ───────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    loadAllData()
    loadBadgeCounts()
    // Poll badge counts every 15 seconds
    const interval = setInterval(loadBadgeCounts, 15000)
    return () => clearInterval(interval)
  }, [session])

  const loadBadgeCounts = async () => {
    // Unread messages
    const { count: msgCount } = await supabase
      .from('messages').select('*', { count: 'exact', head: true })
      .eq('direction', 'in').eq('read', false)
    setUnreadMessages(msgCount || 0)

    // Unread notes – notes newer than last time we visited notes tab
    const lastVisit = lastNoteCheck.current
    if (lastVisit) {
      const { count: noteCount } = await supabase
        .from('notes').select('*', { count: 'exact', head: true })
        .gt('created_at', lastVisit)
        .neq('author', session?.user?.email?.split('@')[0])
      setUnreadNotes(noteCount || 0)
    }
  }

  const loadAllData = async () => {
    setDataLoading(true)
    try {
      const [{ data: models }, { data: chatters }] = await Promise.all([
        supabase.from('model_snapshots').select('*').order('business_date', { ascending: true }),
        supabase.from('chatter_snapshots').select('*').order('business_date', { ascending: true }),
      ])

      const parsedModels = (models || []).map(s => ({
        businessDate: s.business_date,
        fileName: s.file_name,
        uploadedAt: s.uploaded_at,
        rows: s.rows,
      }))
      const parsedChatters = (chatters || []).map(s => ({
        businessDate: s.business_date,
        fileName: s.file_name,
        uploadedAt: s.uploaded_at,
        rows: s.rows,
      }))

      setModelSnapshots(parsedModels)
      setChatterSnapshots(parsedChatters)

      // Auto-select latest date
      const allDates = [
        ...parsedModels.map(s => s.businessDate),
        ...parsedChatters.map(s => s.businessDate),
      ].sort()
      if (allDates.length > 0) setBusinessDate(allDates[allDates.length - 1])
    } catch (err) {
      console.error('Fehler beim Laden:', err)
    }
    setDataLoading(false)
  }

  // ── Upsert snapshot to Supabase ───────────────────────────────────────────
  const upsertModelSnapshot = async (snap) => {
    const { error } = await supabase.from('model_snapshots').upsert({
      business_date: snap.businessDate,
      file_name: snap.fileName,
      uploaded_at: snap.uploadedAt,
      rows: snap.rows,
      user_id: session.user.id,
    }, { onConflict: 'business_date' })
    if (error) console.error('Upsert model error:', error)
  }

  const upsertChatterSnapshot = async (snap) => {
    const { error } = await supabase.from('chatter_snapshots').upsert({
      business_date: snap.businessDate,
      file_name: snap.fileName,
      uploaded_at: snap.uploadedAt,
      rows: snap.rows,
      user_id: session.user.id,
    }, { onConflict: 'business_date' })
    if (error) console.error('Upsert chatter error:', error)
  }

  const handleModelUpload = useCallback(async (fileName, text) => {
    const { headers, rows: rawRows } = parseCSV(text)
    const rows = rawRows.map(r => parseModelRow(r, headers)).filter(Boolean)
    if (rows.length === 0) {
      alert('Keine gültigen Daten in der Model-CSV gefunden.')
      return
    }
    const snap = { businessDate, fileName, uploadedAt: new Date().toISOString(), rows }
    await upsertModelSnapshot(snap)
    setModelSnapshots(prev => {
      const updated = prev.filter(s => s.businessDate !== businessDate)
      return [...updated, snap].sort((a, b) => a.businessDate.localeCompare(b.businessDate))
    })
  }, [businessDate, session])

  const handleChatterUpload = useCallback(async (fileName, text) => {
    const { headers, rows: rawRows } = parseCSV(text)
    const rows = rawRows.map(r => parseChatterRow(r, headers)).filter(Boolean)
    if (rows.length === 0) {
      alert('Keine gültigen Daten in der Chatter-CSV gefunden.')
      return
    }
    const snap = { businessDate, fileName, uploadedAt: new Date().toISOString(), rows }
    await upsertChatterSnapshot(snap)
    setChatterSnapshots(prev => {
      const updated = prev.filter(s => s.businessDate !== businessDate)
      return [...updated, snap].sort((a, b) => a.businessDate.localeCompare(b.businessDate))
    })
  }, [businessDate, session])

  const clearAllData = async () => {
    if (!window.confirm('Alle Daten löschen? Kann nicht rückgängig gemacht werden.')) return
    await Promise.all([
      supabase.from('model_snapshots').delete().neq('id', 0),
      supabase.from('chatter_snapshots').delete().neq('id', 0),
    ])
    setModelSnapshots([])
    setChatterSnapshots([])
    setBusinessDate(todayISO())
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (authLoading) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
      Laden...
    </div>
  )

  if (!session) return <LoginPage />

  const currentModelSnap = modelSnapshots.find(s => s.businessDate === businessDate)
  const currentChatterSnap = chatterSnapshots.find(s => s.businessDate === businessDate)
  const allDates = [...new Set([
    ...modelSnapshots.map(s => s.businessDate),
    ...chatterSnapshots.map(s => s.businessDate),
  ])].sort().reverse()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      {/* ── HEADER ── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(7,7,16,0.97)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: '0 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 8,
        minHeight: 56,
      }}>
        {/* Left */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
            background: 'linear-gradient(135deg, #7c3aed, #06b6d4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 800, color: '#fff', fontFamily: 'monospace',
            boxShadow: '0 0 16px rgba(124,58,237,0.4)',
          }}>A</div>
          <div style={{ minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Agency Dashboard</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 6, letterSpacing: '0.05em', display: 'inline' }} className="hide-mobile">Thirteen 87 Collective</span>
          </div>
          {allDates.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', background: 'var(--bg-card)', padding: '2px 7px', borderRadius: 4, border: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
              {allDates.length}T
            </span>
          )}
        </div>
        {/* Right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {[
              { key: 'models', label: 'Models' },
              { key: 'chatters', label: 'Chatters' },
              { key: 'notes', label: 'Notizen', badge: unreadNotes },
              { key: 'comm', label: 'Kommunikation', badge: unreadMessages },
              { key: 'schedule', label: 'Dienstplan' },
            ].map(tab => (
              <button key={tab.key} onClick={() => {
                setActiveTab(tab.key)
                if (tab.key === 'comm') setUnreadMessages(0)
                if (tab.key === 'notes') { lastNoteCheck.current = new Date().toISOString(); setUnreadNotes(0) }
              }} style={{
                padding: '6px 14px', borderRadius: 8,
                background: activeTab === tab.key ? '#7c3aed' : 'transparent',
                color: activeTab === tab.key ? '#fff' : tab.badge > 0 ? '#f59e0b' : 'var(--text-secondary)',
                fontWeight: 600, fontSize: 13, transition: 'all 0.15s',
                border: `1px solid ${activeTab === tab.key ? '#7c3aed' : tab.badge > 0 ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              }}>
                {tab.label}
                {tab.badge > 0 && activeTab !== tab.key && (
                  <span style={{
                    background: '#f59e0b', color: '#000', fontSize: 10,
                    fontWeight: 800, borderRadius: 10, padding: '1px 6px', lineHeight: 1.4,
                  }}>{tab.badge}</span>
                )}
              </button>
            ))}
          </div>
          <button onClick={handleLogout} style={{
            fontSize: 12, padding: '5px 10px', borderRadius: 6,
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
          }}>↩</button>
        </div>
      </header>

      {/* ── TOOLBAR ── */}
      <div style={{
        background: 'var(--bg-card)', borderBottom: '1px solid var(--border)',
        padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap',
      }}>
        {/* Date controls */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Business Date</label>
            <input type="date" value={businessDate} onChange={e => setBusinessDate(e.target.value)} />
          </div>
          {allDates.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Gespeicherte Tage</label>
              <select value={businessDate} onChange={e => setBusinessDate(e.target.value)} style={{
                background: 'var(--bg-input)', border: '1px solid var(--border)',
                color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 8,
                fontFamily: 'monospace', fontSize: 12, cursor: 'pointer', outline: 'none', maxWidth: 140,
              }}>
                {allDates.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}
        </div>
        {/* Uploads */}
        <div style={{ display: 'flex', gap: 8, flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
          <UploadBox
            label="Daily Model CSV"
            onFile={handleModelUpload}
            lastFileName={currentModelSnap?.fileName}
            lastDate={currentModelSnap?.uploadedAt ? new Date(currentModelSnap.uploadedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : null}
          />
          <UploadBox
            label="Daily Chatter CSV"
            onFile={handleChatterUpload}
            lastFileName={currentChatterSnap?.fileName}
            lastDate={currentChatterSnap?.uploadedAt ? new Date(currentChatterSnap.uploadedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : null}
          />
        </div>
        {/* Version + Delete */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginLeft: 'auto' }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>v1.2.3</span>
          <button onClick={clearAllData} style={{
            padding: '7px 12px', background: 'transparent',
            border: '1px solid rgba(239,68,68,0.3)', color: 'rgba(239,68,68,0.7)',
            borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
          }}>Daten löschen</button>
        </div>
      </div>

      {/* ── MAIN ── */}
      <main style={{ padding: '16px', maxWidth: 1600, margin: '0 auto' }}>
        {dataLoading ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '80px 0', fontSize: 14 }}>Daten werden geladen...</div>
        ) : modelSnapshots.length === 0 && chatterSnapshots.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 16, color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 48, opacity: 0.3 }}>📊</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-secondary)' }}>Noch keine Daten vorhanden</div>
            <div style={{ fontSize: 14, textAlign: 'center' }}>Wähle ein Business Date und lade CSV-Dateien hoch.</div>
          </div>
        ) : activeTab === 'models' ? (
          <ModelsView selectedDate={businessDate} modelSnapshots={modelSnapshots} chatterSnapshots={chatterSnapshots} />
        ) : activeTab === 'chatters' ? (
          <ChattersView selectedDate={businessDate} chatterSnapshots={chatterSnapshots} />
        ) : activeTab === 'notes' ? (
          <NotesTab session={session} />
        ) : activeTab === 'comm' ? (
          <CommTab session={session} />
        ) : (
          <ScheduleTab session={session} />
        )}
      </main>
    </div>
  )
}
