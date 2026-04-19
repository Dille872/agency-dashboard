import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './supabase'
import { getTheme, setTheme, initTheme } from './theme'
import LoginPage from './components/LoginPage'
import ModelsView from './components/ModelsView'
import ChattersView from './components/ChattersView'
import NotesTab from './components/NotesTab'
import CommTab from './components/CommTab'
import ScheduleTab from './components/ScheduleTab'
import ChatterPortal from './components/ChatterPortal'
import ModelPortal from './components/ModelPortal'
import ExportTab from './components/ExportTab'
import SettingsTab from './components/SettingsTab'
import TodoTab from './components/TodoTab'
import SocialTab from './components/SocialTab'
import SetPasswordPage from './components/SetPasswordPage'
import SurveyPopup from './components/SurveyPopup'
import UploadBox from './components/UploadBox'
import { parseCSV, parseModelRow, parseChatterRow, todayISO } from './utils'

export default function App() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [needsPassword, setNeedsPassword] = useState(false)

  const [activeTab, setActiveTab] = useState('models')
  const [businessDate, setBusinessDate] = useState(todayISO())
  const [modelSnapshots, setModelSnapshots] = useState([])
  const [chatterSnapshots, setChatterSnapshots] = useState([])
  const [dataLoading, setDataLoading] = useState(false)
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [unreadNotes, setUnreadNotes] = useState(0)
  const [unreadModelChanges, setUnreadModelChanges] = useState(0)
  const [openSwaps, setOpenSwaps] = useState(0)
  const [unreadCustomContent, setUnreadCustomContent] = useState(0)
  const [openTodos, setOpenTodos] = useState(0)
  const [userRole, setUserRole] = useState(null)
  const [userDisplayName, setUserDisplayName] = useState('')
  const [viewMode, setViewMode] = useState('auto')
  const [theme, setThemeState] = useState(() => initTheme())
  const lastNoteCheck = useRef(null)

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setThemeState(next)
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (event === 'PASSWORD_RECOVERY' || event === 'USER_UPDATED') {
        setNeedsPassword(event === 'PASSWORD_RECOVERY')
      }
      if (event === 'SIGNED_IN' && window.location.hash.includes('type=invite')) {
        setNeedsPassword(true)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  // ── Load data from Supabase ───────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    loadUserRole()
    loadAllData()
    loadBadgeCounts()
    const interval = setInterval(() => {
      loadBadgeCounts()
      // Send heartbeat so admin shows as online in chatter list
      if (session?.user) {
        supabase.from('online_status').upsert({
          display_name: userDisplayName || session.user.email?.split('@')[0],
          last_seen: new Date().toISOString(),
          shift_online: false,
        }, { onConflict: 'display_name' }).then(() => {})
      }
    }, 30000)
    return () => clearInterval(interval)
  }, [session])

  const [userRoles, setUserRoles] = useState([])

  const loadUserRole = async () => {
    try {
      const { data } = await supabase
        .from('user_roles').select('*').eq('user_id', session.user.id).single()
      const name = data?.display_name || session.user.email?.split('@')[0]
      if (data) {
        const roles = data.roles && data.roles.length > 0 ? data.roles : [data.role]
        setUserRole(data.role)
        setUserRoles(roles)
        setUserDisplayName(name)
      } else {
        setUserRole('chatter')
        setUserRoles(['chatter'])
        setUserDisplayName(name)
      }
      await supabase.from('online_status').upsert({
        display_name: name,
        last_seen: new Date().toISOString(),
        shift_online: false,
      }, { onConflict: 'display_name' })
    } catch {
      setUserRole('chatter')
      setUserRoles(['chatter'])
      setUserDisplayName(session.user.email?.split('@')[0] || 'Chatter')
    }
  }

  const loadBadgeCounts = async () => {
    const { count: msgCount } = await supabase
      .from('messages').select('*', { count: 'exact', head: true })
      .eq('direction', 'in').eq('read', false)
    setUnreadMessages(msgCount || 0)

    const lastVisit = lastNoteCheck.current
    if (lastVisit) {
      const { count: noteCount } = await supabase
        .from('notes').select('*', { count: 'exact', head: true })
        .gt('created_at', lastVisit)
        .neq('author', session?.user?.email?.split('@')[0])
      setUnreadNotes(noteCount || 0)
    }

    // Model board changes
    const { count: modelCount } = await supabase
      .from('model_board_activity').select('*', { count: 'exact', head: true })
      .eq('read', false)

    // Unread custom content for admin
    const { count: ccCount } = await supabase
      .from('custom_content').select('*', { count: 'exact', head: true })
      .eq('read_by_admin', false)

    setUnreadModelChanges((modelCount || 0) + (ccCount || 0))

    // Unread custom content for model portal
    if (userRole === 'model' && userDisplayName) {
      const { count: modelCcCount } = await supabase
        .from('custom_content').select('*', { count: 'exact', head: true })
        .eq('model_name', userDisplayName)
        .eq('read_by_model', false)
        .eq('completed', false)
      setUnreadCustomContent(modelCcCount || 0)
    }

    // Open todos
    const { count: todoCount } = await supabase
      .from('todos').select('*', { count: 'exact', head: true })
      .eq('completed', false)
    setOpenTodos(todoCount || 0)
      .from('shift_swaps').select('*', { count: 'exact', head: true })
      .eq('status', 'offen')
    setOpenSwaps(swapCount || 0)
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

  const deleteDay = async (date) => {
    if (!window.confirm(`Tag ${date} löschen? Beide CSVs (Model + Chatter) für diesen Tag werden gelöscht.`)) return
    await supabase.from('model_snapshots').delete().eq('business_date', date)
    await supabase.from('chatter_snapshots').delete().eq('business_date', date)
    setModelSnapshots(prev => prev.filter(s => s.businessDate !== date))
    setChatterSnapshots(prev => prev.filter(s => s.businessDate !== date))
    const remaining = allDates.filter(d => d !== date)
    if (remaining.length > 0) setBusinessDate(remaining[0])
    else setBusinessDate(todayISO())
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (authLoading || (session && userRole === null)) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
      Daten werden geladen...
    </div>
  )

  if (!session) return <LoginPage />

  if (needsPassword) return <SetPasswordPage onDone={() => setNeedsPassword(false)} />

  // Role permissions
  const showChatterPortal = userRole !== null && ((userRole === 'chatter' && viewMode !== 'admin') || viewMode === 'chatter')
  const showModelPortal = userRole !== null && ((userRole === 'model' && viewMode !== 'admin') || viewMode === 'model')
  const isAdmin = userRole === 'admin'
  const isManager = userRole === 'admin' || userRole === 'manager'

  // Tab access per role
  const isSocialMedia = userRoles.includes('social_media')
  const hasRole = (r) => userRole === r || userRole === 'admin'

  const canAccess = (tab) => {
    if (userRole === 'admin') return true
    if (userRole === 'manager') return !['settings'].includes(tab)
    if (userRole === 'dienstplan') return ['schedule', 'chatters-comm'].includes(tab)
    if (userRole === 'creator_manager') return ['models-comm'].includes(tab)
    if (isSocialMedia) return ['social'].includes(tab)
    return false
  }

  if (showModelPortal) return (
    <ModelPortal
      session={session}
      displayName={isAdmin || userRole === 'manager' ? 'Vorschau' : userDisplayName}
      onSwitchToAdmin={(isAdmin || isManager) ? () => setViewMode('admin') : null}
      isPreview={isAdmin || userRole === 'manager'}
      unreadCustomContent={unreadCustomContent}
      onMarkCustomContentRead={() => setUnreadCustomContent(0)}
    />
  )

  if (showChatterPortal) return (
    <ChatterPortal
      session={session}
      displayName={userDisplayName}
      onSwitchToAdmin={(isAdmin || isManager) ? () => setViewMode('admin') : null}
      isSocialMedia={isSocialMedia}
      isPreview={isAdmin || isManager}
    />
  )

  // Non-admin roles that work in dashboard
  if (userRole === 'dienstplan' && viewMode !== 'admin') {
    if (activeTab !== 'schedule' && activeTab !== 'chatters-comm') setActiveTab('schedule')
  }
  if (userRole === 'creator_manager' && viewMode !== 'admin') {
    if (activeTab !== 'models-comm') setActiveTab('models-comm')
  }

  const currentModelSnap = modelSnapshots.find(s => s.businessDate === businessDate)
  const currentChatterSnap = chatterSnapshots.find(s => s.businessDate === businessDate)
  const allDates = [...new Set([
    ...modelSnapshots.map(s => s.businessDate),
    ...chatterSnapshots.map(s => s.businessDate),
  ])].sort().reverse()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <SurveyPopup session={session} displayName={userDisplayName} userRole={userRole} />
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
        <div onClick={() => setActiveTab('models')} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', cursor: 'pointer' }}>
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
              { key: 'divider1' },
              { key: 'notes', label: 'Notizen', badge: unreadNotes },
              { key: 'nachrichten', label: 'Nachrichten', badge: unreadMessages },
              { key: 'todos', label: 'ToDos', badge: openTodos },
              { key: 'models-comm', label: 'Creator', badge: unreadModelChanges },
              { key: 'chatters-comm', label: 'Crew', badge: openSwaps },
              { key: 'divider2' },
              { key: 'schedule', label: 'Dienstplan' },
              { key: 'social', label: 'Social' },
              { key: 'divider3' },
              { key: 'settings', label: '⚙ Einstellungen' },
            ].filter(tab => tab.key.startsWith('divider') || canAccess(tab.key)).map(tab => {
              if (tab.key.startsWith('divider')) return (
                <div key={tab.key} style={{ width: 1.5, height: 28, background: 'linear-gradient(to bottom, transparent, #f59e0b, transparent)', margin: '0 2px' }} />
              )
              return (
              <button key={tab.key} onClick={() => {
                setActiveTab(tab.key)
                if (tab.key === 'nachrichten') setUnreadMessages(0)
                if (tab.key === 'models-comm') setUnreadModelChanges(0)
                if (tab.key === 'chatters-comm') setOpenSwaps(0)
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
            )})}
          </div>
          <button onClick={() => setViewMode('chatter')} style={{
            fontSize: 11, padding: '5px 10px', borderRadius: 6,
            background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.3)',
            color: '#06b6d4', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap',
          }}>Chatter-Ansicht</button>
          <button onClick={() => setViewMode('model')} style={{
            fontSize: 11, padding: '5px 10px', borderRadius: 6,
            background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
            color: '#f59e0b', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap',
          }}>Model-Ansicht</button>
          <button onClick={handleLogout} style={{
            fontSize: 12, padding: '5px 10px', borderRadius: 6,
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
          }}>↩</button>
          <button onClick={toggleTheme} style={{
            fontSize: 16, padding: '5px 10px', borderRadius: 6,
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
          }} title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
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
            <select value={businessDate} onChange={e => setBusinessDate(e.target.value)} style={{
              background: 'var(--bg-input)', border: '1px solid var(--border)',
              color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 8,
              fontFamily: 'monospace', fontSize: 12, cursor: 'pointer', outline: 'none', maxWidth: 140, marginTop: 18,
            }}>
              {allDates.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          {(currentModelSnap || currentChatterSnap) && (
            <button onClick={() => deleteDay(businessDate)} style={{
              padding: '7px 10px', background: 'transparent', marginTop: 18,
              border: '1px solid rgba(239,68,68,0.3)', color: 'rgba(239,68,68,0.7)',
              borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
            }} title={`Tag ${businessDate} löschen`}>🗑 Tag löschen</button>
          )}
        </div>
        {/* Uploads */}
        <div style={{ display: 'flex', gap: 8, flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
          <UploadBox
            label="Daily Model"
            onFile={handleModelUpload}
            lastFileName={currentModelSnap?.fileName}
            lastDate={currentModelSnap?.uploadedAt ? new Date(currentModelSnap.uploadedAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null}
          />
          <UploadBox
            label="Daily Chatter"
            onFile={handleChatterUpload}
            lastFileName={currentChatterSnap?.fileName}
            lastDate={currentChatterSnap?.uploadedAt ? new Date(currentChatterSnap.uploadedAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null}
          />
        </div>
        {/* Version only */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginLeft: 'auto' }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>v2.4.3</span>
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
          <ModelsView selectedDate={businessDate} modelSnapshots={modelSnapshots} chatterSnapshots={chatterSnapshots} onDateChange={setBusinessDate} />
        ) : activeTab === 'chatters' ? (
          <ChattersView selectedDate={businessDate} chatterSnapshots={chatterSnapshots} onDateChange={setBusinessDate} />
        ) : activeTab === 'notes' ? (
          <NotesTab session={session} />
        ) : activeTab === 'nachrichten' ? (
          <CommTab key="nachrichten" session={session} section="nachrichten" />
        ) : activeTab === 'models-comm' ? (
          <CommTab key="models-comm" session={session} section="models" />
        ) : activeTab === 'chatters-comm' ? (
          <CommTab key="chatters-comm" session={session} section="chatters" />
        ) : activeTab === 'todos' ? (
          <TodoTab session={session} userDisplayName={userDisplayName} />
        ) : activeTab === 'social' ? (
          <SocialTab session={session} userDisplayName={userDisplayName} userRole={userRole} />
        ) : activeTab === 'settings' ? (
          <SettingsTab />
        ) : (
          <ScheduleTab session={session} />
        )}
      </main>
    </div>
  )
}
