import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { getTheme, setTheme } from '../theme'

const APP_VERSION = 'v1.6.4'

const CATEGORIES = [
  { key: 'preise', label: 'Preisstruktur', color: '#10b981' },
  { key: 'nogos', label: 'No Gos', color: '#ef4444' },
  { key: 'regeln', label: 'Content Regeln', color: '#a78bfa' },
  { key: 'services', label: 'Services / Pakete', color: '#f59e0b' },
  { key: 'einschraenkungen', label: 'Einschränkungen', color: '#06b6d4' },
  { key: 'reise', label: 'Reiseplan', color: '#06b6d4' },
  { key: 'termine', label: 'Termine', color: '#7c3aed' },
]

const CAL_CATEGORIES = [
  { key: 'aufgabe', label: 'Aufgabe', color: '#a78bfa' },
  { key: 'content', label: 'Content', color: '#f59e0b' },
  { key: 'termin', label: 'Termin', color: '#7c3aed' },
  { key: 'reise', label: 'Reise', color: '#06b6d4' },
]

function formatMoney(v) {
  if (!v && v !== 0) return '—'
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ModelPortal({ session, displayName: initialDisplayName, onSwitchToAdmin, isPreview }) {
  const [theme, setThemeState] = useState(() => getTheme())
  const [previewModel, setPreviewModel] = useState('')
  const [allModels, setAllModels] = useState([])
  const displayName = isPreview ? (previewModel || '') : initialDisplayName

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next); setThemeState(next)
  }

  // Board state
  const [board, setBoard] = useState({})
  const [editingBoard, setEditingBoard] = useState(false)
  const [addingCat, setAddingCat] = useState(null)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [editingItem, setEditingItem] = useState(null)
  const [saving, setSaving] = useState(false)

  const [modelStatus, setModelStatus] = useState(null) // full models_contact row
  const [settingStatus, setSettingStatus] = useState(false)
  const [statusNote, setStatusNote] = useState('')
  const [statusUntil, setStatusUntil] = useState('')

  // Heartbeat – update last_seen every 60s
  useEffect(() => {
    if (!displayName) return
    const heartbeat = async () => {
      await supabase.from('models_contact').update({ last_seen: new Date().toISOString() }).eq('name', displayName)
    }
    heartbeat()
    const interval = setInterval(heartbeat, 60000)
    return () => clearInterval(interval)
  }, [displayName])

  const loadModelStatus = async () => {
    const { data } = await supabase.from('models_contact').select('*').eq('name', displayName).single()
    setModelStatus(data)
    // Auto-clear expired pause/unavailable
    if (data?.status_until && new Date(data.status_until) < new Date()) {
      await supabase.from('models_contact').update({ status: 'available', status_until: null, status_note: null }).eq('name', displayName)
      setModelStatus(prev => ({ ...prev, status: 'available', status_until: null, status_note: null }))
    }
  }

  const setStatus = async (status) => {
    setSaving(true)
    const until = statusUntil ? (() => {
      const [h, m] = statusUntil.split(':')
      const d = new Date(); d.setHours(parseInt(h), parseInt(m), 0, 0)
      return d.toISOString()
    })() : null
    await supabase.from('models_contact').update({
      status,
      status_until: status === 'available' ? null : until,
      status_note: status === 'available' ? null : statusNote || null,
      availability: status === 'available' ? 'available' : 'unavailable',
    }).eq('name', displayName)
    setStatusNote(''); setStatusUntil(''); setSettingStatus(false)
    await loadModelStatus()
    setSaving(false)
  }
  const [calItems, setCalItems] = useState([])
  const [showAddCal, setShowAddCal] = useState(false)
  const [calTitle, setCalTitle] = useState('')
  const [calDesc, setCalDesc] = useState('')
  const [calDate, setCalDate] = useState('')
  const [calCategory, setCalCategory] = useState('aufgabe')
  const [calReminder, setCalReminder] = useState('')

  // Other state
  const [contentRequests, setContentRequests] = useState([])
  const [messages, setMessages] = useState([])
  const [aliases, setAliases] = useState([])
  const [revenue, setRevenue] = useState({})
  const [dailySubs, setDailySubs] = useState([])
  const [subsCalMonth, setSubsCalMonth] = useState(() => {
    const n = new Date()
    return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0')
  })
  const [activeSection, setActiveSection] = useState('home') // home | board | kalender | umsatz | anfragen

  useEffect(() => {
    if (isPreview) {
      supabase.from('models_contact').select('name').order('name').then(({ data }) => {
        setAllModels(data || [])
        if (data && data.length > 0) setPreviewModel(data[0].name)
      })
    }
  }, [isPreview])

  useEffect(() => {
    if (displayName) {
      loadAll()
    }
  }, [displayName])

  const loadAll = async () => {
    loadBoard(); loadCalendar(); loadContentRequests(); loadMessages(); loadAliasesAndRevenue(); loadModelStatus(); loadVideos()
  }

  const loadBoard = async () => {
    const { data } = await supabase.from('model_board').select('*').eq('model_name', displayName).order('sort_order')
    const map = {}
    for (const item of data || []) {
      if (!map[item.category]) map[item.category] = []
      map[item.category].push(item)
    }
    setBoard(map)
  }

  const loadCalendar = async () => {
    const { data } = await supabase.from('model_calendar').select('*').eq('model_name', displayName).order('due_date')
    setCalItems(data || [])
  }

  const loadContentRequests = async () => {
    const { data } = await supabase.from('content_requests').select('*').eq('model_name', displayName).order('created_at', { ascending: false }).limit(20)
    setContentRequests(data || [])
  }

  const loadMessages = async () => {
    const { data } = await supabase.from('messages').select('*').eq('direction', 'out').order('created_at', { ascending: false }).limit(8)
    setMessages(data || [])
  }

  const loadAliasesAndRevenue = async () => {
    const { data: aliasData } = await supabase.from('model_aliases').select('*').eq('model_name', displayName)
    const myAliases = aliasData || []
    setAliases(myAliases)
    const now = new Date()
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    // Load last 14 days for chart
    const { data: snaps } = await supabase.from('model_snapshots').select('rows, business_date').gte('business_date', monthStart)
    const { data: snapsAll } = await supabase.from('model_snapshots').select('rows, business_date').order('business_date')
    const csvNames = myAliases.length > 0 ? myAliases.map(a => a.csv_name) : [displayName]
    const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const revenueMap = {}
    for (const csvName of csvNames) {
      revenueMap[csvName] = 0
      const normCsvName = normalize(csvName)
      for (const snap of snaps || []) {
        const row = snap.rows?.find(r => {
          const rowName = r.creator || r.name || ''
          return normalize(rowName) === normCsvName
        })
        if (row) revenueMap[csvName] += row.revenue || 0
      }
    }
    setRevenue(revenueMap)
    // Build daily subs data for chart
    const dailySubs = []
    for (const snap of snapsAll || []) {
      let subs = 0
      for (const csvName of csvNames) {
        const normCsvName = normalize(csvName)
        const row = snap.rows?.find(r => {
          const rowName = r.creator || r.name || ''
          return normalize(rowName) === normCsvName || normalize(rowName).includes(normCsvName) || normCsvName.includes(normalize(rowName))
        })
        if (row) subs += row.subs || 0
      }
      dailySubs.push({ date: snap.business_date, subs })
    }
    setDailySubs(dailySubs)
  }

  const logActivity = async (action, category, details) => {
    await supabase.from('model_board_activity').insert({ model_name: displayName, action, category, details })
  }

  const addBoardItem = async (category) => {
    if (!newTitle.trim()) return
    setSaving(true)
    const items = board[category] || []
    await supabase.from('model_board').insert({ model_name: displayName, category, title: newTitle.trim(), content: newContent.trim() || null, price: newPrice.trim() || null, sort_order: items.length })
    await logActivity('hinzugefügt', category, newTitle.trim())
    setNewTitle(''); setNewContent(''); setNewPrice(''); setAddingCat(null)
    await loadBoard(); setSaving(false)
  }

  const deleteBoardItem = async (item) => {
    await supabase.from('model_board').delete().eq('id', item.id)
    await logActivity('gelöscht', item.category, item.title)
    loadBoard()
  }

  const saveBoardEdit = async () => {
    if (!editingItem) return
    setSaving(true)
    await supabase.from('model_board').update({ title: newTitle.trim(), content: newContent.trim() || null, price: newPrice.trim() || null }).eq('id', editingItem.id)
    await logActivity('bearbeitet', editingItem.category, newTitle.trim())
    setEditingItem(null); setNewTitle(''); setNewContent(''); setNewPrice('')
    await loadBoard(); setSaving(false)
  }

  const addCalItem = async () => {
    if (!calTitle.trim() || !calDate) return
    setSaving(true)
    await supabase.from('model_calendar').insert({
      model_name: displayName,
      title: calTitle.trim(),
      description: calDesc.trim() || null,
      due_date: calDate,
      category: calCategory,
      reminder_hours: calReminder ? parseInt(calReminder) : null,
      reminder_sent: false,
    })
    setCalTitle(''); setCalDesc(''); setCalDate(''); setCalReminder(''); setShowAddCal(false)
    await loadCalendar(); setSaving(false)
  }

  const deleteCalItem = async (id) => {
    await supabase.from('model_calendar').delete().eq('id', id)
    loadCalendar()
  }

  const updateRequestStatus = async (id, status) => {
    await supabase.from('content_requests').update({ status }).eq('id', id)
    loadContentRequests()
  }

  // Videos
  const [videos, setVideos] = useState([])
  const [showAddVideo, setShowAddVideo] = useState(false)
  const [videoTitle, setVideoTitle] = useState('')
  const [videoDesc, setVideoDesc] = useState('')
  const [videoDate, setVideoDate] = useState('')
  const [videoFile, setVideoFile] = useState(null)
  const [videoPreview, setVideoPreview] = useState(null)
  const [uploadingVideo, setUploadingVideo] = useState(false)

  const loadVideos = async () => {
    const { data } = await supabase.from('model_videos').select('*').eq('model_name', displayName).order('release_date')
    setVideos(data || [])
  }

  const addVideo = async () => {
    if (!videoTitle.trim()) return
    setUploadingVideo(true)
    let thumbnailUrl = null
    if (videoFile) {
      const ext = videoFile.name.split('.').pop()
      const path = `${displayName}/${Date.now()}.${ext}`
      const { data: uploadData } = await supabase.storage.from('model-media').upload(path, videoFile)
      if (uploadData) {
        const { data: urlData } = supabase.storage.from('model-media').getPublicUrl(path)
        thumbnailUrl = urlData.publicUrl
      }
    }
    await supabase.from('model_videos').insert({
      model_name: displayName,
      title: videoTitle.trim(),
      description: videoDesc.trim() || null,
      release_date: videoDate || null,
      thumbnail_url: thumbnailUrl,
    })
    await logActivity('Video hinzugefügt', 'videos', videoTitle.trim())
    setVideoTitle(''); setVideoDesc(''); setVideoDate(''); setVideoFile(null); setVideoPreview(null); setShowAddVideo(false)
    await loadVideos()
    setUploadingVideo(false)
  }

  const deleteVideo = async (id) => {
    await supabase.from('model_videos').delete().eq('id', id)
    loadVideos()
  }

  const totalRevenue = Object.values(revenue).reduce((s, v) => s + v, 0)
  const csvNames = aliases.length > 0 ? aliases.map(a => a.csv_name) : [displayName]
  const multiAccount = csvNames.length > 1
  const monthName = new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
  const openRequests = contentRequests.filter(r => r.status === 'neu' || r.status === 'angefragt')
  const today = new Date().toISOString().slice(0, 10)
  const upcomingCal = calItems.filter(c => c.due_date >= today).slice(0, 5)

  const cardS = { background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '16px 18px' }
  const inputS = { background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none', width: '100%' }
  const itemS = { padding: '9px 11px', background: 'var(--bg-card2)', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 6 }
  const labelS = { fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', fontFamily: 'var(--font-sans)', color: 'var(--text-primary)' }}>
      {/* Header */}
      <header style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(7,7,16,0.97)', backdropFilter: 'blur(12px)', borderBottom: '1px solid #1e1e3a', padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 56 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #f59e0b, #ef4444)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: '#fff' }}>T</div>
          <div>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Thirteen 87</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 6 }}>Model Portal</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{APP_VERSION}</span>
          {isPreview ? (
            <select value={previewModel} onChange={e => setPreviewModel(e.target.value)} style={{ background: 'var(--bg-input)', border: '1px solid rgba(245,158,11,0.4)', color: '#f59e0b', padding: '4px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}>
              {allModels.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
            </select>
          ) : (
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{displayName}</span>
          )}
          {onSwitchToAdmin && <button onClick={onSwitchToAdmin} style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>⚙ Admin</button>}
          <button onClick={() => supabase.auth.signOut()} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, background: 'transparent', border: '1px solid #1e1e3a', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>↩</button>
          <button onClick={toggleTheme} style={{ fontSize: 14, padding: '5px 8px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}>{theme === 'dark' ? '☀' : '☾'}</button>
        </div>
      </header>

      <main style={{ padding: '20px', maxWidth: 1100, margin: '0 auto' }}>

        {/* Nav */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {[
            { key: 'home', label: '🏠 Übersicht' },
            { key: 'board', label: '📋 Mein Board' },
            { key: 'videos', label: `🎬 Videos${videos.length > 0 ? ` (${videos.length})` : ''}` },
            { key: 'kalender', label: `📅 Kalender${upcomingCal.length > 0 ? ` (${upcomingCal.length})` : ''}` },
            { key: 'anfragen', label: `✉ Anfragen${openRequests.length > 0 ? ` (${openRequests.length})` : ''}` },
            { key: 'umsatz', label: '💰 Umsatz' },
          ].map(t => (
            <button key={t.key} onClick={() => setActiveSection(t.key)} style={{
              padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
              background: activeSection === t.key ? '#f59e0b' : 'var(--bg-card)',
              color: activeSection === t.key ? '#000' : 'var(--text-secondary)',
              border: `1px solid ${activeSection === t.key ? '#f59e0b' : 'var(--border)'}`,
            }}>{t.label}</button>
          ))}
        </div>

        {/* HOME */}
        {activeSection === 'home' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Status Banner */}
        {(() => {
          const s = modelStatus?.status || 'unknown'
          const until = modelStatus?.status_until ? new Date(modelStatus.status_until) : null
          const untilStr = until ? until.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : null
          const color = s === 'available' ? '#10b981' : s === 'pause' ? '#f59e0b' : s === 'unavailable' ? '#ef4444' : '#555580'
          const bg = s === 'available' ? 'rgba(16,185,129,0.08)' : s === 'pause' ? 'rgba(245,158,11,0.08)' : s === 'unavailable' ? 'rgba(239,68,68,0.06)' : 'rgba(100,100,100,0.06)'
          const border = s === 'available' ? 'rgba(16,185,129,0.25)' : s === 'pause' ? 'rgba(245,158,11,0.25)' : s === 'unavailable' ? 'rgba(239,68,68,0.2)' : '#1e1e3a'
          const label = s === 'available' ? 'Ich bin verfügbar' : s === 'pause' ? `Pause${untilStr ? ` bis ${untilStr}` : ''}` : s === 'unavailable' ? `Nicht verfügbar${untilStr ? ` bis ${untilStr}` : ''}` : 'Status nicht gesetzt'
          return (
            <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '14px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color }}>{label}</div>
                    {modelStatus?.status_note && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{modelStatus.status_note}</div>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {s !== 'available' && <button onClick={() => setStatus('available')} style={{ padding: '7px 16px', borderRadius: 7, background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Wieder verfügbar</button>}
                  {s === 'available' && <button onClick={() => setSettingStatus('pause')} style={{ padding: '7px 16px', borderRadius: 7, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Pause</button>}
                  {s === 'available' && <button onClick={() => setSettingStatus('unavailable')} style={{ padding: '7px 16px', borderRadius: 7, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Nicht verfügbar</button>}
                </div>
              </div>
              {settingStatus && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${border}`, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input type="time" value={statusUntil} onChange={e => setStatusUntil(e.target.value)}
                    style={{ background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '6px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'monospace', outline: 'none' }} />
                  <input value={statusNote} onChange={e => setStatusNote(e.target.value)} placeholder="Notiz (optional, nur für Admins)"
                    style={{ background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '6px 10px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none', flex: 1, minWidth: 180 }} />
                  <button onClick={() => setStatus(settingStatus)} disabled={saving}
                    style={{ padding: '6px 16px', borderRadius: 6, background: settingStatus === 'pause' ? '#f59e0b' : '#ef4444', color: '#000', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {settingStatus === 'pause' ? 'Pause setzen' : 'Nicht verfügbar setzen'}
                  </button>
                  <button onClick={() => setSettingStatus(false)} style={{ padding: '6px 12px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Abbrechen</button>
                </div>
              )}
            </div>
          )
        })()}

        {/* Welcome banner for new models */}
        {activeSection === 'home' && Object.keys(board).length === 0 && !isPreview && (
          <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 10, padding: '16px 20px', marginBottom: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#f59e0b', marginBottom: 6 }}>👋 Willkommen!</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 12 }}>
              Dein Board ist noch leer. Trage deine Preise, No Gos und Content-Regeln ein damit dein Chatter-Team weiß was sie anbieten können.
            </div>
            <button onClick={() => setActiveSection('board')} style={{ padding: '7px 16px', borderRadius: 7, background: '#f59e0b', color: '#000', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              Board jetzt aufbauen →
            </button>
          </div>
        )}

        {/* Banner offene Anfragen */}
            {openRequests.length > 0 && (
              <div onClick={() => setActiveSection('anfragen')} style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', marginBottom: 2 }}>{openRequests.length} offene Content-Anfrage{openRequests.length !== 1 ? 'n' : ''}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{openRequests.slice(0, 2).map(r => r.chatter_name).join(' · ')}</div>
                </div>
                <span style={{ fontSize: 12, padding: '5px 12px', borderRadius: 7, background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', fontWeight: 700 }}>Ansehen →</span>
              </div>
            )}

            {/* Subs Kalender */}
            {dailySubs.length > 0 && (() => {
              const subsMap = {}
              for (const d of dailySubs) subsMap[d.date] = d.subs
              const maxSubs = Math.max(...dailySubs.map(d => d.subs), 1)
              const now2 = new Date()
              const calYear = subsCalMonth.split('-')[0]
              const calMonth = parseInt(subsCalMonth.split('-')[1]) - 1
              const firstDay = new Date(calYear, calMonth, 1)
              const lastDay = new Date(calYear, calMonth + 1, 0)
              const startDow = (firstDay.getDay() + 6) % 7
              const totalSubs = dailySubs.reduce((s, d) => s + d.subs, 0)
              const monthSubs = dailySubs.filter(d => d.date.startsWith(subsCalMonth)).reduce((s, d) => s + d.subs, 0)
              const maxMonth = Math.max(...dailySubs.filter(d => d.date.startsWith(subsCalMonth)).map(d => d.subs), 1)
              const cells = []
              for (let i = 0; i < startDow; i++) cells.push(null)
              for (let d = 1; d <= lastDay.getDate(); d++) cells.push(d)
              const monthLabel2 = firstDay.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
              const getColor = (subs) => {
                if (!subs) return 'var(--bg-card2)'
                const intensity = subs / maxMonth
                if (intensity >= 0.8) return 'rgba(245,158,11,0.9)'
                if (intensity >= 0.6) return 'rgba(245,158,11,0.65)'
                if (intensity >= 0.4) return 'rgba(245,158,11,0.4)'
                if (intensity >= 0.2) return 'rgba(245,158,11,0.2)'
                return 'rgba(245,158,11,0.08)'
              }
              return (
                <div style={{ background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '16px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Neue Subs Tracker</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <button onClick={() => {
                        const [y, m] = subsCalMonth.split('-').map(Number)
                        const prev = m === 1 ? (y-1) + '-12' : y + '-' + String(m-1).padStart(2,'0')
                        setSubsCalMonth(prev)
                      }} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 5, padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>{'<'}</button>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', minWidth: 110, textAlign: 'center' }}>{monthLabel2}</span>
                      <button onClick={() => {
                        const [y, m] = subsCalMonth.split('-').map(Number)
                        const next = m === 12 ? (y+1) + '-01' : y + '-' + String(m+1).padStart(2,'0')
                        setSubsCalMonth(next)
                      }} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 5, padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>{'>'}</button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                    <div><div style={{ fontSize: 18, fontWeight: 700, color: '#f59e0b', fontFamily: 'monospace' }}>{monthSubs}</div><div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Diesen Monat</div></div>
                    <div><div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{totalSubs}</div><div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Gesamt</div></div>
                    <div><div style={{ fontSize: 18, fontWeight: 700, color: '#10b981', fontFamily: 'monospace' }}>{maxMonth}</div><div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Bester Tag</div></div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
                    {['Mo','Di','Mi','Do','Fr','Sa','So'].map(d => (
                      <div key={d} style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', paddingBottom: 4, fontWeight: 700 }}>{d}</div>
                    ))}
                    {cells.map((day, i) => {
                      if (!day) return <div key={'e'+i} />
                      const dateStr = calYear + '-' + String(calMonth+1).padStart(2,'0') + '-' + String(day).padStart(2,'0')
                      const subs = subsMap[dateStr] || 0
                      const isToday2 = dateStr === new Date().toISOString().slice(0,10)
                      return (
                        <div key={day} style={{ borderRadius: 5, padding: '4px 2px', textAlign: 'center', background: getColor(subs), border: isToday2 ? '1px solid #f59e0b' : '1px solid transparent', cursor: subs > 0 ? 'default' : 'default' }}>
                          <div style={{ fontSize: 8, color: subs > 0 ? '#000' : 'var(--text-muted)', fontWeight: subs > 0 ? 700 : 400, opacity: subs > 0 ? 0.6 : 0.4 }}>{day}</div>
                          {subs > 0 && <div style={{ fontSize: 10, fontWeight: 700, color: subs / maxMonth >= 0.6 ? '#000' : '#f59e0b', lineHeight: 1 }}>{subs}</div>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>

              {/* Kalender / Anstehendes */}
              <div style={cardS}>
                <div style={labelS}><span style={{ width: 3, height: 11, background: '#7c3aed', borderRadius: 2, display: 'inline-block' }} />Anstehendes</div>
                {upcomingCal.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>Noch keine Einträge</div>
                ) : upcomingCal.map(item => {
                  const cat = CAL_CATEGORIES.find(c => c.key === item.category)
                  const isOverdue = item.due_date < today
                  const isToday = item.due_date === today
                  return (
                    <div key={item.id} style={{ ...itemS, borderLeft: `3px solid ${cat?.color || '#7c3aed'}`, borderRadius: '0 8px 8px 0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: isOverdue ? '#ef4444' : 'var(--text-primary)' }}>{item.title}</div>
                          {item.description && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{item.description}</div>}
                          <div style={{ fontSize: 10, color: isOverdue ? '#ef4444' : isToday ? '#10b981' : 'var(--text-muted)', marginTop: 3, fontFamily: 'monospace' }}>
                            {isOverdue ? '⚠ Überfällig · ' : isToday ? '● Heute · ' : ''}{new Date(item.due_date + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                            {item.reminder_hours && <span style={{ color: '#06b6d4' }}> · 🔔 {item.reminder_hours}h vorher</span>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <span style={{ fontSize: 10, background: `${cat?.color}20`, color: cat?.color, padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>{cat?.label}</span>
                          <button onClick={() => deleteCalItem(item.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}
                            onMouseEnter={e => e.target.style.color = '#ef4444'} onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
                        </div>
                      </div>
                    </div>
                  )
                })}
                <button onClick={() => setActiveSection('kalender')} style={{ width: '100%', background: 'transparent', border: '1px dashed #2e2e5a', color: 'var(--text-muted)', borderRadius: 8, padding: '7px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 }}>+ Eintrag hinzufügen</button>
              </div>

              {/* Nachrichten */}
              <div style={cardS}>
                <div style={labelS}><span style={{ width: 3, height: 11, background: '#7c3aed', borderRadius: 2, display: 'inline-block' }} />Nachrichten vom Team</div>
                {messages.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>Keine Nachrichten</div>
                ) : messages.slice(0, 4).map(msg => (
                  <div key={msg.id} style={itemS}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa' }}>{msg.sent_by || 'Team'}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {new Date(msg.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{msg.text}</div>
                  </div>
                ))}
              </div>

              {/* Board Übersicht */}
              <div style={cardS}>
                <div style={labelS}><span style={{ width: 3, height: 11, background: '#f59e0b', borderRadius: 2, display: 'inline-block' }} />Mein Board</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {CATEGORIES.filter(c => c.key !== 'termine' && c.key !== 'reise' && c.key !== 'einschraenkungen').map(cat => (
                    <div key={cat.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--bg-card2)', borderRadius: 7, border: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ width: 3, height: 10, background: cat.color, borderRadius: 2, display: 'inline-block' }} />
                        <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{cat.label}</span>
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-card)', padding: '1px 7px', borderRadius: 10, border: '1px solid var(--border)' }}>{(board[cat.key] || []).length}</span>
                    </div>
                  ))}
                </div>
                <button onClick={() => setActiveSection('board')} style={{ width: '100%', background: 'transparent', border: '1px dashed #2e2e5a', color: 'var(--text-muted)', borderRadius: 8, padding: '7px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', marginTop: 8 }}>Board bearbeiten →</button>
              </div>

              {/* Umsatz */}
              <div style={{ ...cardS, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={labelS}><span style={{ width: 3, height: 11, background: '#10b981', borderRadius: 2, display: 'inline-block' }} />Umsatz {monthName}</div>
                <div>
                  <div style={{ fontSize: 32, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)', marginBottom: 2 }}>{formatMoney(totalRevenue)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Laufender Monat</div>
                </div>
                {multiAccount && (
                  <div style={{ borderTop: '1px solid #1e1e3a', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {csvNames.map(name => {
                      const alias = aliases.find(a => a.csv_name === name)
                      return (
                        <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg-card2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{name}</div>
                            {alias?.alias_label && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{alias.alias_label}</div>}
                          </div>
                          <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)' }}>{formatMoney(revenue[name] || 0)}</div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Bot Commands */}
              <div style={cardS}>
                <div style={{ ...labelS, marginBottom: 12 }}><span style={{ width: 3, height: 11, background: '#a78bfa', borderRadius: 2, display: 'inline-block', marginRight: 6 }} />Bot-Befehle · @thirteen87agency_bot</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    { cmd: 'verfügbar', desc: 'Status auf verfügbar setzen', color: '#10b981' },
                    { cmd: 'nicht verfügbar', desc: 'Status auf nicht verfügbar', color: '#ef4444' },
                    { cmd: 'pause bis 18', desc: 'Pause bis 18:00 Uhr', color: '#f59e0b' },
                    { cmd: 'zurück', desc: 'Pause beenden', color: '#06b6d4' },
                    { cmd: '/start', desc: 'Telegram ID anzeigen', color: '#a78bfa' },
                  ].map(b => (
                    <div key={b.cmd} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: 'var(--bg-card2)', borderRadius: 7, border: '1px solid var(--border)' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: b.color, background: b.color + '20', padding: '2px 8px', borderRadius: 4, flexShrink: 0 }}>{b.cmd}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{b.desc}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        )}

        {/* BOARD */}
        {activeSection === 'board' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {CATEGORIES.map(cat => (
              <div key={cat.key} style={cardS}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 3, height: 14, background: cat.color, borderRadius: 2, display: 'inline-block' }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{cat.label}</span>
                    <span style={{ fontSize: 10, background: 'var(--bg-card2)', color: 'var(--text-muted)', padding: '1px 7px', borderRadius: 10, border: '1px solid var(--border)' }}>{(board[cat.key] || []).length}</span>
                  </div>
                </div>
                {(board[cat.key] || []).map(item => (
                  <div key={item.id}>
                    {editingItem?.id === item.id ? (
                      <div style={{ ...itemS, border: '1px solid #7c3aed' }}>
                        <input value={newTitle} onChange={e => setNewTitle(e.target.value)} style={{ ...inputS, marginBottom: 6 }} placeholder="Titel" />
                        <input value={newContent} onChange={e => setNewContent(e.target.value)} style={{ ...inputS, marginBottom: 6 }} placeholder="Beschreibung" />
                        <input value={newPrice} onChange={e => setNewPrice(e.target.value)} style={{ ...inputS, marginBottom: 8 }} placeholder="Preis" />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={saveBoardEdit} disabled={saving} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>✓ Speichern</button>
                          <button onClick={() => setEditingItem(null)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Abbrechen</button>
                        </div>
                      </div>
                    ) : (
                      <div style={itemS}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{item.title}</div>
                            {item.content && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.4 }}>{item.content}</div>}
                            {item.price && <div style={{ fontSize: 12, fontWeight: 700, color: cat.color, marginTop: 4 }}>{item.price}</div>}
                          </div>
                          <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
                            <button onClick={() => { setEditingItem(item); setNewTitle(item.title); setNewContent(item.content || ''); setNewPrice(item.price || '') }} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>✎</button>
                            <button onClick={() => deleteBoardItem(item)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}
                              onMouseEnter={e => e.target.style.color = '#ef4444'} onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {addingCat === cat.key ? (
                  <div style={{ ...itemS, border: '1px solid #7c3aed' }}>
                    <input value={newTitle} onChange={e => setNewTitle(e.target.value)} style={{ ...inputS, marginBottom: 6 }} placeholder="Titel *" autoFocus />
                    <input value={newContent} onChange={e => setNewContent(e.target.value)} style={{ ...inputS, marginBottom: 6 }} placeholder="Beschreibung (optional)" />
                    <input value={newPrice} onChange={e => setNewPrice(e.target.value)} style={{ ...inputS, marginBottom: 8 }} placeholder="Preis (optional)" />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => addBoardItem(cat.key)} disabled={saving || !newTitle.trim()} style={{ background: newTitle.trim() ? '#7c3aed' : 'var(--border)', color: newTitle.trim() ? '#fff' : 'var(--text-muted)', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>+ Hinzufügen</button>
                      <button onClick={() => { setAddingCat(null); setNewTitle(''); setNewContent(''); setNewPrice('') }} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Abbrechen</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setAddingCat(cat.key); setEditingItem(null); setNewTitle(''); setNewContent(''); setNewPrice('') }}
                    style={{ width: '100%', background: 'transparent', border: '1px dashed #2e2e5a', color: 'var(--text-muted)', borderRadius: 8, padding: '7px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 }}>
                    + Hinzufügen
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* KALENDER */}
        {activeSection === 'kalender' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={cardS}>
              <div style={{ ...labelS, marginBottom: 16 }}><span style={{ width: 3, height: 11, background: '#7c3aed', borderRadius: 2, display: 'inline-block' }} />Neuer Eintrag</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Titel *</label>
                  <input value={calTitle} onChange={e => setCalTitle(e.target.value)} style={inputS} placeholder="z.B. Content-Anfrage erledigen" />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Kategorie</label>
                  <select value={calCategory} onChange={e => setCalCategory(e.target.value)} style={{ ...inputS }}>
                    {CAL_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Fällig am *</label>
                  <input type="date" value={calDate} onChange={e => setCalDate(e.target.value)} style={inputS} />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Erinnerung</label>
                  <select value={calReminder} onChange={e => setCalReminder(e.target.value)} style={inputS}>
                    <option value="">Keine Erinnerung</option>
                    <option value="1">1 Stunde vorher</option>
                    <option value="3">3 Stunden vorher</option>
                    <option value="12">12 Stunden vorher</option>
                    <option value="24">24 Stunden vorher</option>
                    <option value="48">2 Tage vorher</option>
                  </select>
                </div>
              </div>
              <input value={calDesc} onChange={e => setCalDesc(e.target.value)} style={{ ...inputS, marginBottom: 10 }} placeholder="Beschreibung (optional)" />
              <button onClick={addCalItem} disabled={saving || !calTitle.trim() || !calDate}
                style={{ background: calTitle.trim() && calDate ? '#7c3aed' : 'var(--border)', color: calTitle.trim() && calDate ? '#fff' : 'var(--text-muted)', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                + Eintrag speichern
              </button>
            </div>

            {calItems.length === 0 ? (
              <div style={{ ...cardS, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 30 }}>Noch keine Kalender-Einträge</div>
            ) : calItems.map(item => {
              const cat = CAL_CATEGORIES.find(c => c.key === item.category)
              const isOverdue = item.due_date < today
              const isToday = item.due_date === today
              return (
                <div key={item.id} style={{ ...cardS, borderLeft: `4px solid ${isOverdue ? '#ef4444' : cat?.color || '#7c3aed'}`, borderRadius: '0 10px 10px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: isOverdue ? '#ef4444' : 'var(--text-primary)' }}>{item.title}</span>
                        <span style={{ fontSize: 10, background: `${cat?.color}20`, color: cat?.color, padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>{cat?.label}</span>
                        {item.reminder_hours && <span style={{ fontSize: 10, color: '#06b6d4', background: 'rgba(6,182,212,0.1)', padding: '1px 7px', borderRadius: 4 }}>🔔 {item.reminder_hours}h vorher</span>}
                      </div>
                      {item.description && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{item.description}</div>}
                      <div style={{ fontSize: 11, fontFamily: 'monospace', color: isOverdue ? '#ef4444' : isToday ? '#10b981' : 'var(--text-muted)' }}>
                        {isOverdue ? '⚠ Überfällig · ' : isToday ? '● Heute · ' : ''}
                        {new Date(item.due_date + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </div>
                    </div>
                    <button onClick={() => deleteCalItem(item.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}
                      onMouseEnter={e => e.target.style.color = '#ef4444'} onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* VIDEOS */}
        {activeSection === 'videos' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {!showAddVideo ? (
              <button onClick={() => setShowAddVideo(true)} style={{ padding: '10px', borderRadius: 8, background: 'var(--bg-card)', border: '1px dashed #2e2e5a', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                + Neues Video eintragen
              </button>
            ) : (
              <div style={cardS}>
                <div style={{ ...labelS, marginBottom: 14 }}><span style={{ width: 3, height: 11, background: '#ef4444', borderRadius: 2, display: 'inline-block', marginRight: 6 }} />Neues Video</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input value={videoTitle} onChange={e => setVideoTitle(e.target.value)} style={inputS} placeholder="Titel *" autoFocus />
                  <textarea value={videoDesc} onChange={e => setVideoDesc(e.target.value)} style={{ ...inputS, resize: 'vertical' }} rows={2} placeholder="Beschreibung (optional)" />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Release Datum</label>
                      <input type="date" value={videoDate} onChange={e => setVideoDate(e.target.value)} style={inputS} />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Vorschaubild (JPG/PNG)</label>
                    <input type="file" accept="image/*" onChange={e => {
                      const f = e.target.files[0]
                      if (f) { setVideoFile(f); setVideoPreview(URL.createObjectURL(f)) }
                    }} style={{ ...inputS, padding: '4px' }} />
                    {videoPreview && <img src={videoPreview} alt="Vorschau" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 8, marginTop: 8, border: '1px solid #1e1e3a' }} />}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button onClick={addVideo} disabled={uploadingVideo || !videoTitle.trim()} style={{ flex: 1, padding: '9px', borderRadius: 7, background: videoTitle.trim() ? '#ef4444' : 'var(--border)', color: videoTitle.trim() ? '#fff' : 'var(--text-muted)', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {uploadingVideo ? '⏳ Wird hochgeladen...' : '+ Speichern'}
                    </button>
                    <button onClick={() => { setShowAddVideo(false); setVideoTitle(''); setVideoDesc(''); setVideoDate(''); setVideoFile(null); setVideoPreview(null) }} style={{ padding: '9px 16px', borderRadius: 7, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Abbrechen</button>
                  </div>
                </div>
              </div>
            )}

            {videos.length === 0 ? (
              <div style={{ ...cardS, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 30 }}>Noch keine Videos eingetragen</div>
            ) : videos.map(video => (
              <div key={video.id} style={{ ...cardS, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                {video.thumbnail_url ? (
                  <img src={video.thumbnail_url} alt={video.title} style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 7, flexShrink: 0, border: '1px solid #1e1e3a' }} />
                ) : (
                  <div style={{ width: 80, height: 60, borderRadius: 7, background: 'var(--bg-card2)', border: '1px solid #1e1e3a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>🎬</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>{video.title}</div>
                  {video.description && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, lineHeight: 1.4 }}>{video.description}</div>}
                  {video.release_date && <div style={{ fontSize: 11, color: '#f59e0b', fontFamily: 'monospace' }}>📅 {new Date(video.release_date + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}</div>}
                </div>
                <button onClick={() => deleteVideo(video.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, padding: 0, flexShrink: 0 }}
                  onMouseEnter={e => e.target.style.color = '#ef4444'} onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* ANFRAGEN */}
        {activeSection === 'anfragen' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {contentRequests.length === 0 ? (
              <div style={{ ...cardS, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 30 }}>Keine Anfragen</div>
            ) : contentRequests.map(req => {
              const statusColor = req.status === 'erledigt' ? '#10b981' : req.status === 'abgelehnt' ? '#ef4444' : '#f59e0b'
              return (
                <div key={req.id} style={{ ...cardS, borderLeft: `4px solid ${statusColor}`, borderRadius: '0 10px 10px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{req.chatter_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{req.request_text}</div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: statusColor, background: `${statusColor}20`, padding: '2px 8px', borderRadius: 4, flexShrink: 0, marginLeft: 10 }}>
                      {req.status === 'erledigt' ? '✓ Erledigt' : req.status === 'abgelehnt' ? '✕ Abgelehnt' : '⏳ Offen'}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: (req.status === 'neu' || req.status === 'angefragt') ? 10 : 0 }}>
                    {new Date(req.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </div>
                  {(req.status === 'neu' || req.status === 'angefragt') && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => updateRequestStatus(req.id, 'erledigt')} style={{ fontSize: 12, padding: '5px 14px', borderRadius: 6, background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>✓ Erledigt</button>
                      <button onClick={() => updateRequestStatus(req.id, 'abgelehnt')} style={{ fontSize: 12, padding: '5px 14px', borderRadius: 6, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>✕ Ablehnen</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* UMSATZ */}
        {activeSection === 'umsatz' && (
          <div style={cardS}>
            <div style={{ ...labelS, marginBottom: 16 }}><span style={{ width: 3, height: 11, background: '#10b981', borderRadius: 2, display: 'inline-block' }} />Umsatz {monthName}</div>
            <div style={{ fontSize: 36, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)', marginBottom: 4 }}>{formatMoney(totalRevenue)}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 20 }}>Laufender Monat</div>
            {multiAccount && (
              <div style={{ borderTop: '1px solid #1e1e3a', paddingTop: 14 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Aufschlüsselung nach Account</div>
                {csvNames.map(name => {
                  const alias = aliases.find(a => a.csv_name === name)
                  return (
                    <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'var(--bg-card2)', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{name}</div>
                        {alias?.alias_label && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{alias.alias_label}</div>}
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)' }}>{formatMoney(revenue[name] || 0)}</div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  )
}
