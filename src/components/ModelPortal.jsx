import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { getTheme, setTheme } from '../theme'

const APP_VERSION = 'v1.6.0'

const CATEGORIES = [
  { key: 'preise', label: 'Preisstruktur', color: '#10b981' },
  { key: 'nogos', label: 'No Gos', color: '#ef4444' },
  { key: 'regeln', label: 'Content Regeln', color: '#a78bfa' },
  { key: 'services', label: 'Services / Pakete', color: '#f59e0b' },
  { key: 'einschraenkungen', label: 'Einschränkungen', color: '#f59e0b' },
  { key: 'reise', label: 'Reiseplan', color: '#06b6d4' },
  { key: 'termine', label: 'Termine', color: '#7c3aed' },
]

export default function ModelPortal({ session, displayName: initialDisplayName, onSwitchToAdmin, isPreview }) {
  const [theme, setThemeState] = useState(() => getTheme())
  const [previewModel, setPreviewModel] = useState('')
  const [allModels, setAllModels] = useState([])
  const displayName = isPreview ? (previewModel || '') : initialDisplayName

  useEffect(() => {
    if (isPreview) {
      supabase.from('models_contact').select('name').order('name').then(({ data }) => {
        setAllModels(data || [])
        if (data && data.length > 0) setPreviewModel(data[0].name)
      })
    }
  }, [isPreview])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next); setThemeState(next)
  }

  const [board, setBoard] = useState({}) // category → [{id, title, content, price}]
  const [contentRequests, setContentRequests] = useState([])
  const [adding, setAdding] = useState(null) // category key
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [newDateFrom, setNewDateFrom] = useState('')
  const [newDateTo, setNewDateTo] = useState('')
  const [collapsed, setCollapsed] = useState({})
  const toggleCollapse = (key) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))

  useEffect(() => {
    if (displayName) {
      loadBoard()
      loadContentRequests()
    }
  }, [displayName])

  const loadBoard = async () => {
    const { data } = await supabase.from('model_board')
      .select('*')
      .eq('model_name', displayName)
      .order('sort_order')
    const map = {}
    for (const item of data || []) {
      if (!map[item.category]) map[item.category] = []
      map[item.category].push(item)
    }
    setBoard(map)
  }

  const loadContentRequests = async () => {
    const { data } = await supabase.from('content_requests')
      .select('*')
      .eq('model_name', displayName)
      .order('created_at', { ascending: false })
      .limit(20)
    setContentRequests(data || [])
  }

  const logActivity = async (action, category, details) => {
    await supabase.from('model_board_activity').insert({
      model_name: displayName,
      action,
      category,
      details,
    })
  }

  const addItem = async (category) => {
    if (!newTitle.trim()) return
    setSaving(true)
    const items = board[category] || []
    const { data } = await supabase.from('model_board').insert({
      model_name: displayName,
      category,
      title: newTitle.trim(),
      content: newContent.trim() || null,
      price: newPrice.trim() || null,
      sort_order: items.length,
    }).select().single()
    await logActivity('hinzugefügt', category, newTitle.trim())
    setNewTitle(''); setNewContent(''); setNewPrice(''); setNewDateFrom(''); setNewDateTo('')
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
  }

  const cardStyle = {
    background: 'var(--bg-card)', border: '1px solid #1e1e3a',
    borderRadius: 10, padding: '16px 18px',
  }
  const itemStyle = {
    padding: '9px 11px', background: 'var(--bg-card2)', borderRadius: 8,
    border: '1px solid var(--border)', marginBottom: 6,
  }
  const inputStyle = {
    background: 'var(--bg-input)', border: '1px solid #2e2e5a',
    color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 7,
    fontSize: 12, fontFamily: 'inherit', outline: 'none', width: '100%',
  }
  const btnStyle = (active) => ({
    background: active ? '#7c3aed' : 'transparent',
    color: active ? '#fff' : 'var(--text-muted)',
    border: `1px solid ${active ? '#7c3aed' : 'var(--border)'}`,
    borderRadius: 6, padding: '5px 12px', fontSize: 12,
    fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', fontFamily: 'var(--font-sans)', color: 'var(--text-primary)' }}>
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
            <select value={previewModel} onChange={e => { setPreviewModel(e.target.value) }}
              style={{ background: 'var(--bg-input)', border: '1px solid rgba(245,158,11,0.4)', color: '#f59e0b', padding: '4px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}>
              {allModels.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
            </select>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{displayName}</span>
          )}
          {onSwitchToAdmin && (
            <button onClick={onSwitchToAdmin} style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>⚙ Admin</button>
          )}
          <button onClick={() => supabase.auth.signOut()} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, background: 'transparent', border: '1px solid #1e1e3a', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>↩</button>
        </div>
      </header>

      <main style={{ padding: '20px', maxWidth: 800, margin: '0 auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {CATEGORIES.map(cat => (
            <div key={cat.key} style={cardStyle}>
              <div onClick={() => toggleCollapse(cat.key)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: collapsed[cat.key] ? 0 : 14, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ width: 3, height: 12, background: cat.color, borderRadius: 2, display: 'inline-block' }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{cat.label}</span>
                  <span style={{ fontSize: 10, background: 'var(--bg-card2)', color: 'var(--text-muted)', padding: '1px 7px', borderRadius: 10, border: '1px solid var(--border)' }}>
                    {(board[cat.key] || []).length}
                  </span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{collapsed[cat.key] ? '▼' : '▲'}</span>
              </div>

              {!collapsed[cat.key] && (<>

              {(board[cat.key] || []).map(item => (
                <div key={item.id}>
                  {editingItem?.id === item.id ? (
                    <div style={{ ...itemStyle, border: '1px solid #7c3aed' }}>
                      <input value={newTitle} onChange={e => setNewTitle(e.target.value)} style={{ ...inputStyle, marginBottom: 6 }} placeholder="Titel" />
                      <input value={newContent} onChange={e => setNewContent(e.target.value)} style={{ ...inputStyle, marginBottom: 6 }} placeholder="Beschreibung (optional)" />
                      <input value={newPrice} onChange={e => setNewPrice(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} placeholder="Preis (optional)" />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={saveEdit} disabled={saving} style={btnStyle(true)}>✓ Speichern</button>
                        <button onClick={() => setEditingItem(null)} style={btnStyle(false)}>Abbrechen</button>
                      </div>
                    </div>
                  ) : (
                    <div style={itemStyle}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: item.content ? 3 : 0 }}>{item.title}</div>
                          {item.content && <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{item.content}</div>}
                          {item.price && <div style={{ fontSize: 12, fontWeight: 700, color: cat.color, marginTop: 4 }}>{item.price}</div>}
                        </div>
                        <div style={{ display: 'flex', gap: 4, marginLeft: 8, flexShrink: 0 }}>
                          <button onClick={() => startEdit(item)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>✎</button>
                          <button onClick={() => deleteItem(item)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}
                            onMouseEnter={e => e.target.style.color = '#ef4444'}
                            onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {adding === cat.key ? (
                <div style={{ ...itemStyle, border: '1px solid #7c3aed' }}>
                  <input value={newTitle} onChange={e => setNewTitle(e.target.value)} style={{ ...inputStyle, marginBottom: 6 }} placeholder="Titel *" autoFocus />
                  <input value={newContent} onChange={e => setNewContent(e.target.value)} style={{ ...inputStyle, marginBottom: 6 }} placeholder="Beschreibung (optional)" />
                  <input value={newPrice} onChange={e => setNewPrice(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} placeholder={cat.key === 'preise' || cat.key === 'services' ? 'Preis z.B. 100$/min' : 'Preis (optional)'} />
                  {(cat.key === 'reise' || cat.key === 'einschraenkungen' || cat.key === 'termine') && (
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                      <input type="date" value={newDateFrom} onChange={e => setNewDateFrom(e.target.value)} style={{ ...inputStyle }} />
                      <input type="date" value={newDateTo} onChange={e => setNewDateTo(e.target.value)} style={{ ...inputStyle }} />
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => addItem(cat.key)} disabled={saving || !newTitle.trim()} style={btnStyle(!!newTitle.trim())}>+ Hinzufügen</button>
                    <button onClick={() => { setAdding(null); setNewTitle(''); setNewContent(''); setNewPrice('') }} style={btnStyle(false)}>Abbrechen</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => { setAdding(cat.key); setEditingItem(null); setNewTitle(''); setNewContent(''); setNewPrice('') }}
                  style={{ width: '100%', background: 'transparent', border: '1px dashed #2e2e5a', color: 'var(--text-muted)', borderRadius: 8, padding: '7px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 }}>
                  + Hinzufügen
                </button>
              )}
              </>)}
            </div>
          ))}

          {/* Content Anfragen */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14 }}>
              <span style={{ width: 3, height: 12, background: '#06b6d4', borderRadius: 2, display: 'inline-block' }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Content-Anfragen</span>
            </div>
            {contentRequests.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '12px 0', textAlign: 'center' }}>Keine Anfragen</div>
            ) : contentRequests.map(req => {
              const statusColor = req.status === 'erledigt' ? '#10b981' : req.status === 'abgelehnt' ? '#ef4444' : req.status === 'angefragt' ? '#f59e0b' : '#a78bfa'
              return (
                <div key={req.id} style={{ ...itemStyle, borderLeft: `3px solid ${statusColor}`, borderRadius: '0 8px 8px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{req.chatter_name}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: statusColor }}>
                      {req.status === 'erledigt' ? '✓ Erledigt' : req.status === 'abgelehnt' ? '✕ Abgelehnt' : req.status === 'angefragt' ? '⏳ Offen' : '● Neu'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: req.status === 'neu' || req.status === 'angefragt' ? 8 : 0 }}>{req.request_text}</div>
                  {(req.status === 'neu' || req.status === 'angefragt') && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => updateRequestStatus(req.id, 'erledigt')} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', cursor: 'pointer', fontFamily: 'inherit' }}>✓ Erledigt</button>
                      <button onClick={() => updateRequestStatus(req.id, 'abgelehnt')} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer', fontFamily: 'inherit' }}>✕ Ablehnen</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

        </div>
      </main>
    </div>
  )
}
