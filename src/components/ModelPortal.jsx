import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { getTheme, setTheme } from '../theme'

const APP_VERSION = 'v1.6.2'

const CATEGORIES = [
  { key: 'preise', label: 'Preisstruktur', color: '#10b981' },
  { key: 'nogos', label: 'No Gos', color: '#ef4444' },
  { key: 'regeln', label: 'Content Regeln', color: '#a78bfa' },
  { key: 'services', label: 'Services / Pakete', color: '#f59e0b' },
  { key: 'einschraenkungen', label: 'Einschränkungen', color: '#06b6d4' },
  { key: 'reise', label: 'Reiseplan', color: '#06b6d4' },
  { key: 'termine', label: 'Termine', color: '#7c3aed' },
]

function formatMoney(v) {
  if (!v && v !== 0) return '—'
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function isoDate(date) { return date.toISOString().slice(0, 10) }

export default function ModelPortal({ session, displayName: initialDisplayName, onSwitchToAdmin, isPreview }) {
  const [theme, setThemeState] = useState(() => getTheme())
  const [previewModel, setPreviewModel] = useState('')
  const [allModels, setAllModels] = useState([])
  const displayName = isPreview ? (previewModel || '') : initialDisplayName

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next); setThemeState(next)
  }

  const [board, setBoard] = useState({})
  const [contentRequests, setContentRequests] = useState([])
  const [adding, setAdding] = useState(null)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [collapsed, setCollapsed] = useState({})
  const [saving, setSaving] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [aliases, setAliases] = useState([])
  const [revenue, setRevenue] = useState({}) // csvName → total
  const [activeTab, setActiveTab] = useState('board') // 'board' | 'kalender' | 'umsatz'

  const toggleCollapse = (key) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))

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
      loadBoard()
      loadContentRequests()
      loadAliasesAndRevenue()
    }
  }, [displayName])

  const loadBoard = async () => {
    const { data } = await supabase.from('model_board')
      .select('*').eq('model_name', displayName).order('sort_order')
    const map = {}
    for (const item of data || []) {
      if (!map[item.category]) map[item.category] = []
      map[item.category].push(item)
    }
    setBoard(map)
  }

  const loadContentRequests = async () => {
    const { data } = await supabase.from('content_requests')
      .select('*').eq('model_name', displayName)
      .order('created_at', { ascending: false }).limit(20)
    setContentRequests(data || [])
  }

  const loadAliasesAndRevenue = async () => {
    // Load aliases
    const { data: aliasData } = await supabase.from('model_aliases')
      .select('*').eq('model_name', displayName)
    const myAliases = aliasData || []
    setAliases(myAliases)

    // Load current month snapshots
    const now = new Date()
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const { data: snaps } = await supabase.from('model_snapshots')
      .select('rows, business_date')
      .gte('business_date', monthStart)

    // Calculate revenue per csv_name
    const csvNames = myAliases.length > 0
      ? myAliases.map(a => a.csv_name)
      : [displayName]

    const revenueMap = {}
    for (const csvName of csvNames) {
      revenueMap[csvName] = 0
      for (const snap of snaps || []) {
        const row = snap.rows?.find(r => r.name?.toLowerCase() === csvName.toLowerCase())
        if (row) revenueMap[csvName] += row.revenue || 0
      }
    }
    setRevenue(revenueMap)
  }

  const logActivity = async (action, category, details) => {
    await supabase.from('model_board_activity').insert({
      model_name: displayName, action, category, details,
    })
  }

  const addItem = async (category) => {
    if (!newTitle.trim()) return
    setSaving(true)
    const items = board[category] || []
    await supabase.from('model_board').insert({
      model_name: displayName, category,
      title: newTitle.trim(),
      content: newContent.trim() || null,
      price: newPrice.trim() || null,
      sort_order: items.length,
    })
    await logActivity('hinzugefügt', category, newTitle.trim())
    setNewTitle(''); setNewContent(''); setNewPrice('')
    setAdding(null)
    await loadBoard()
    setSaving(false)
  }

  const deleteItem = async (item) => {
    await supabase.from('model_board').delete().eq('id', item.id)
    await logActivity('gelöscht', item.category, item.title)
    loadBoard()
  }

  const saveEdit = async () => {
    if (!editingItem) return
    setSaving(true)
    await supabase.from('model_board').update({
      title: newTitle.trim(),
      content: newContent.trim() || null,
      price: newPrice.trim() || null,
    }).eq('id', editingItem.id)
    await logActivity('bearbeitet', editingItem.category, newTitle.trim())
    setEditingItem(null); setNewTitle(''); setNewContent(''); setNewPrice('')
    await loadBoard()
    setSaving(false)
  }

  const updateRequestStatus = async (id, status) => {
    await supabase.from('content_requests').update({ status }).eq('id', id)
    loadContentRequests()
  }

  const startEdit = (item) => {
    setEditingItem(item)
    setNewTitle(item.title)
    setNewContent(item.content || '')
    setNewPrice(item.price || '')
    setAdding(null)
  }

  // Upcoming items from board (termine + einschraenkungen + reise)
  const upcomingItems = []
  for (const cat of ['termine', 'einschraenkungen', 'reise']) {
    for (const item of board[cat] || []) {
      upcomingItems.push({ ...item, catLabel: CATEGORIES.find(c => c.key === cat)?.label, catColor: CATEGORIES.find(c => c.key === cat)?.color })
    }
  }

  // Revenue totals
  const totalRevenue = Object.values(revenue).reduce((s, v) => s + v, 0)
  const csvNames = aliases.length > 0 ? aliases.map(a => a.csv_name) : [displayName]
  const multiAccount = csvNames.length > 1

  const monthName = new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })

  const cardS = { background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '16px 18px' }
  const inputS = { background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none', width: '100%' }
  const itemS = { padding: '9px 11px', background: 'var(--bg-card2)', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 6 }

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
          <button onClick={toggleTheme} style={{ fontSize: 14, padding: '5px 8px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          {isPreview ? (
            <select value={previewModel} onChange={e => setPreviewModel(e.target.value)}
              style={{ background: 'var(--bg-input)', border: '1px solid rgba(245,158,11,0.4)', color: '#f59e0b', padding: '4px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}>
              {allModels.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
            </select>
          ) : (
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{displayName}</span>
          )}
          {onSwitchToAdmin && (
            <button onClick={onSwitchToAdmin} style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>⚙ Admin</button>
          )}
          <button onClick={() => supabase.auth.signOut()} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, background: 'transparent', border: '1px solid #1e1e3a', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>↩</button>
        </div>
      </header>

      <main style={{ padding: '20px', maxWidth: 900, margin: '0 auto' }}>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {[
            { key: 'board', label: '📋 Mein Board' },
            { key: 'kalender', label: '📅 Termine & Reisen' },
            { key: 'umsatz', label: '💰 Umsatz' },
            { key: 'anfragen', label: `✉ Anfragen${contentRequests.filter(r => r.status === 'neu' || r.status === 'angefragt').length > 0 ? ` (${contentRequests.filter(r => r.status === 'neu' || r.status === 'angefragt').length})` : ''}` },
          ].map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
              padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
              background: activeTab === t.key ? '#f59e0b' : 'var(--bg-card)',
              color: activeTab === t.key ? '#000' : 'var(--text-secondary)',
              border: `1px solid ${activeTab === t.key ? '#f59e0b' : 'var(--border)'}`,
            }}>{t.label}</button>
          ))}
        </div>

        {/* BOARD TAB */}
        {activeTab === 'board' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {CATEGORIES.filter(c => c.key !== 'termine' && c.key !== 'reise' && c.key !== 'einschraenkungen').map(cat => (
              <div key={cat.key} style={cardS}>
                <div onClick={() => toggleCollapse(cat.key)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: collapsed[cat.key] ? 0 : 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 3, height: 14, background: cat.color, borderRadius: 2, display: 'inline-block' }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{cat.label}</span>
                    <span style={{ fontSize: 10, background: 'var(--bg-card2)', color: 'var(--text-muted)', padding: '1px 7px', borderRadius: 10, border: '1px solid var(--border)' }}>{(board[cat.key] || []).length}</span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{collapsed[cat.key] ? '▼' : '▲'}</span>
                </div>
                {!collapsed[cat.key] && (
                  <>
                    {(board[cat.key] || []).map(item => (
                      <div key={item.id}>
                        {editingItem?.id === item.id ? (
                          <div style={{ ...itemS, border: '1px solid #7c3aed' }}>
                            <input value={newTitle} onChange={e => setNewTitle(e.target.value)} style={{ ...inputS, marginBottom: 6 }} placeholder="Titel" />
                            <input value={newContent} onChange={e => setNewContent(e.target.value)} style={{ ...inputS, marginBottom: 6 }} placeholder="Beschreibung" />
                            <input value={newPrice} onChange={e => setNewPrice(e.target.value)} style={{ ...inputS, marginBottom: 8 }} placeholder="Preis" />
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={saveEdit} disabled={saving} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>✓ Speichern</button>
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
                                <button onClick={() => startEdit(item)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: '2px' }}>✎</button>
                                <button onClick={() => deleteItem(item)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: '2px' }}
                                  onMouseEnter={e => e.target.style.color = '#ef4444'}
                                  onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    {adding === cat.key ? (
                      <div style={{ ...itemS, border: '1px solid #7c3aed' }}>
                        <input value={newTitle} onChange={e => setNewTitle(e.target.value)} style={{ ...inputS, marginBottom: 6 }} placeholder="Titel *" autoFocus />
                        <input value={newContent} onChange={e => setNewContent(e.target.value)} style={{ ...inputS, marginBottom: 6 }} placeholder="Beschreibung (optional)" />
                        <input value={newPrice} onChange={e => setNewPrice(e.target.value)} style={{ ...inputS, marginBottom: 8 }} placeholder="Preis (optional)" />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => addItem(cat.key)} disabled={saving || !newTitle.trim()} style={{ background: newTitle.trim() ? '#7c3aed' : 'var(--border)', color: newTitle.trim() ? '#fff' : 'var(--text-muted)', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>+ Hinzufügen</button>
                          <button onClick={() => { setAdding(null); setNewTitle(''); setNewContent(''); setNewPrice('') }} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Abbrechen</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => { setAdding(cat.key); setEditingItem(null); setNewTitle(''); setNewContent(''); setNewPrice('') }}
                        style={{ width: '100%', background: 'transparent', border: '1px dashed #2e2e5a', color: 'var(--text-muted)', borderRadius: 8, padding: '7px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 }}>
                        + Hinzufügen
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* KALENDER TAB */}
        {activeTab === 'kalender' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {['termine', 'reise', 'einschraenkungen'].map(catKey => {
              const cat = CATEGORIES.find(c => c.key === catKey)
              return (
                <div key={catKey} style={cardS}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <span style={{ width: 3, height: 14, background: cat.color, borderRadius: 2, display: 'inline-block' }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{cat.label}</span>
                    <span style={{ fontSize: 10, background: 'var(--bg-card2)', color: 'var(--text-muted)', padding: '1px 7px', borderRadius: 10, border: '1px solid var(--border)' }}>{(board[catKey] || []).length}</span>
                  </div>
                  {(board[catKey] || []).map(item => (
                    <div key={item.id} style={{ ...itemS, borderLeft: `3px solid ${cat.color}`, borderRadius: '0 8px 8px 0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{item.title}</div>
                          {item.content && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{item.content}</div>}
                          {item.price && <div style={{ fontSize: 11, color: cat.color, marginTop: 2, fontFamily: 'monospace' }}>{item.price}</div>}
                        </div>
                        <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
                          <button onClick={() => { startEdit(item); setActiveTab('kalender') }} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>✎</button>
                          <button onClick={() => deleteItem(item)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}
                            onMouseEnter={e => e.target.style.color = '#ef4444'}
                            onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {adding === catKey ? (
                    <div style={{ ...itemS, border: '1px solid #7c3aed' }}>
                      <input value={newTitle} onChange={e => setNewTitle(e.target.value)} style={{ ...inputS, marginBottom: 6 }} placeholder={catKey === 'termine' ? 'z.B. Zoom Call · 15. Apr · 15:00' : catKey === 'reise' ? 'z.B. Berlin' : 'z.B. Keine langen Videos'} autoFocus />
                      <input value={newContent} onChange={e => setNewContent(e.target.value)} style={{ ...inputS, marginBottom: 6 }} placeholder="Details (optional)" />
                      <input value={newPrice} onChange={e => setNewPrice(e.target.value)} style={{ ...inputS, marginBottom: 8 }} placeholder={catKey === 'reise' ? 'Zeitraum z.B. 15.–22. April' : 'Datum/Zeitraum'} />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => addItem(catKey)} disabled={saving || !newTitle.trim()} style={{ background: newTitle.trim() ? '#7c3aed' : 'var(--border)', color: newTitle.trim() ? '#fff' : 'var(--text-muted)', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>+ Hinzufügen</button>
                        <button onClick={() => { setAdding(null); setNewTitle(''); setNewContent(''); setNewPrice('') }} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Abbrechen</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => { setAdding(catKey); setEditingItem(null); setNewTitle(''); setNewContent(''); setNewPrice('') }}
                      style={{ width: '100%', background: 'transparent', border: '1px dashed #2e2e5a', color: 'var(--text-muted)', borderRadius: 8, padding: '7px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 }}>
                      + Hinzufügen
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* UMSATZ TAB */}
        {activeTab === 'umsatz' && (
          <div style={cardS}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 16 }}>Umsatz {monthName}</div>
            <div style={{ fontSize: 36, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)', marginBottom: 4 }}>{formatMoney(totalRevenue)}</div>
            {multiAccount && (
              <div style={{ marginTop: 16, borderTop: '1px solid #1e1e3a', paddingTop: 14 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Aufschlüsselung nach Account</div>
                {csvNames.map(name => {
                  const alias = aliases.find(a => a.csv_name === name)
                  return (
                    <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--bg-card2)', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 8 }}>
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

        {/* ANFRAGEN TAB */}
        {activeTab === 'anfragen' && (
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
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: req.status === 'neu' || req.status === 'angefragt' ? 10 : 0 }}>
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

      </main>
    </div>
  )
}
