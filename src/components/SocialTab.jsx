import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'

const PLATFORMS = ['TikTok', 'Instagram', 'YouTube', 'Twitter', 'Snapchat']
const STATUS_COLORS = { idee: '#a78bfa', in_arbeit: '#f59e0b', freigabe: '#06b6d4', fertig: '#10b981', gepostet: '#888', abgelehnt: '#ef4444' }
const STATUS_LABELS = { idee: 'Idee', in_arbeit: 'In Arbeit', freigabe: 'Freigabe', fertig: 'Fertig', gepostet: 'Gepostet', abgelehnt: 'Abgelehnt' }
const TREND_COLORS = { hoch: '#10b981', mittel: '#f59e0b', niedrig: '#06b6d4' }

export default function SocialTab({ session, userDisplayName, userRole }) {
  const [section, setSection] = useState('overview')
  const [models, setModels] = useState([])
  const [accounts, setAccounts] = useState([])
  const [posts, setPosts] = useState([])
  const [performance, setPerformance] = useState([])
  const [trends, setTrends] = useState([])
  const [brandings, setBrandings] = useState({})
  const [selectedModel, setSelectedModel] = useState(null)

  // Forms
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [showAddPost, setShowAddPost] = useState(false)
  const [showAddTrend, setShowAddTrend] = useState(false)
  const [showAddPerf, setShowAddPerf] = useState(null) // account_id
  const [saving, setSaving] = useState(false)

  const [newAccount, setNewAccount] = useState({ model_name: '', account_name: '', platform: 'TikTok', theme: '' })
  const [newPost, setNewPost] = useState({ model_name: '', account_id: '', title: '', platform: 'TikTok', scheduled_at: '', material_link: '', status: 'idee' })
  const [newTrend, setNewTrend] = useState({ title: '', description: '', platform: '', priority: 'hoch' })
  const [newPerf, setNewPerf] = useState({ week_start: '', follower_count: '', follower_delta: '', avg_views: '', posts_count: '' })

  const cardS = { background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '14px 16px', marginBottom: 10 }
  const inputS = { width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', outline: 'none' }
  const itemS = { background: 'var(--bg-card2)', borderRadius: 8, padding: '8px 10px', marginBottom: 6, border: '1px solid #1e1e3a' }

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    const [{ data: m }, { data: a }, { data: p }, { data: perf }, { data: t }, { data: b }] = await Promise.all([
      supabase.from('models_contact').select('name').order('name'),
      supabase.from('social_accounts').select('*').order('model_name'),
      supabase.from('social_posts').select('*').order('created_at', { ascending: false }),
      supabase.from('social_performance').select('*').order('week_start', { ascending: false }),
      supabase.from('social_trends').select('*').order('created_at', { ascending: false }),
      supabase.from('social_branding').select('*'),
    ])
    setModels(m || [])
    setAccounts(a || [])
    setPosts(p || [])
    setPerformance(perf || [])
    setTrends(t || [])
    const bMap = {}
    for (const br of b || []) bMap[br.model_name] = br
    setBrandings(bMap)
    if ((m || []).length > 0 && !selectedModel) setSelectedModel((m || [])[0]?.name)
  }

  const activeModels = models.filter(m => brandings[m.name]?.tracking_active)

  const toggleTracking = async (modelName, active) => {
    const existing = brandings[modelName]
    if (existing) {
      await supabase.from('social_branding').update({ tracking_active: active }).eq('model_name', modelName)
    } else {
      await supabase.from('social_branding').insert({ model_name: modelName, tracking_active: active })
    }
    loadAll()
  }

  const saveBranding = async (modelName, fields) => {
    const existing = brandings[modelName]
    if (existing) {
      await supabase.from('social_branding').update(fields).eq('model_name', modelName)
    } else {
      await supabase.from('social_branding').insert({ model_name: modelName, ...fields })
    }
    loadAll()
  }

  const addAccount = async () => {
    if (!newAccount.model_name || !newAccount.account_name) return
    setSaving(true)
    await supabase.from('social_accounts').insert(newAccount)
    setNewAccount({ model_name: '', account_name: '', platform: 'TikTok', theme: '' })
    setShowAddAccount(false)
    await loadAll(); setSaving(false)
  }

  const addPost = async () => {
    if (!newPost.title || !newPost.model_name) return
    setSaving(true)
    await supabase.from('social_posts').insert({ ...newPost, account_id: newPost.account_id || null, created_by: userDisplayName })
    setNewPost({ model_name: '', account_id: '', title: '', platform: 'TikTok', scheduled_at: '', material_link: '', status: 'idee' })
    setShowAddPost(false)
    await loadAll(); setSaving(false)
  }

  const addTrend = async () => {
    if (!newTrend.title) return
    setSaving(true)
    await supabase.from('social_trends').insert({ ...newTrend, created_by: userDisplayName })
    setNewTrend({ title: '', description: '', platform: '', priority: 'hoch' })
    setShowAddTrend(false)
    await loadAll(); setSaving(false)
  }

  const addPerformance = async (accountId, modelName) => {
    if (!newPerf.week_start) return
    setSaving(true)
    await supabase.from('social_performance').insert({
      account_id: accountId, model_name: modelName,
      week_start: newPerf.week_start,
      follower_count: parseInt(newPerf.follower_count) || 0,
      follower_delta: parseInt(newPerf.follower_delta) || 0,
      avg_views: parseInt(newPerf.avg_views) || 0,
      posts_count: parseInt(newPerf.posts_count) || 0,
    })
    setNewPerf({ week_start: '', follower_count: '', follower_delta: '', avg_views: '', posts_count: '' })
    setShowAddPerf(null)
    await loadAll(); setSaving(false)
  }

  const updatePostStatus = async (id, status) => {
    await supabase.from('social_posts').update({ status, ...(status === 'gepostet' ? { posted_at: new Date().toISOString() } : {}) }).eq('id', id)
    loadAll()
  }

  const deleteAccount = async (id) => { await supabase.from('social_accounts').delete().eq('id', id); loadAll() }
  const deletePost = async (id) => { await supabase.from('social_posts').delete().eq('id', id); loadAll() }
  const deleteTrend = async (id) => { await supabase.from('social_trends').delete().eq('id', id); loadAll() }

  const tabs = [
    { key: 'overview', label: 'Übersicht' },
    { key: 'queue', label: `Queue${posts.filter(p => ['idee','in_arbeit','freigabe'].includes(p.status)).length > 0 ? ` (${posts.filter(p => ['idee','in_arbeit','freigabe'].includes(p.status)).length})` : ''}` },
    { key: 'performance', label: 'Performance' },
    { key: 'trends', label: 'Trends' },
    { key: 'branding', label: 'Branding' },
    { key: 'settings', label: '⚙ Tracking' },
  ]

  const pendingApproval = posts.filter(p => p.status === 'freigabe')
  const latestPerf = (accountId) => performance.find(p => p.account_id === accountId)

  return (
    <div style={{ maxWidth: 900 }}>

      {/* Nav */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setSection(t.key)} style={{
            padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 12,
            background: section === t.key ? '#ec4899' : 'transparent',
            color: section === t.key ? '#fff' : 'var(--text-muted)',
            border: `1px solid ${section === t.key ? '#ec4899' : 'var(--border)'}`,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── ÜBERSICHT ── */}
      {section === 'overview' && (
        <div>
          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 12 }}>
            {[
              ['Accounts', activeModels.reduce((s, m) => s + accounts.filter(a => a.model_name === m.name && a.active).length, 0), '#ec4899'],
              ['Freigaben offen', pendingApproval.length, '#f59e0b'],
              ['Posts diese Woche', posts.filter(p => p.created_at > new Date(Date.now() - 7*86400000).toISOString()).length, '#10b981'],
              ['Trends gesammelt', trends.length, '#a78bfa'],
            ].map(([l, v, c]) => (
              <div key={l} style={{ background: 'var(--bg-card2)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{l}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: c }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Accounts per model */}
          <div style={cardS}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>Aktive Accounts</div>
              <button onClick={() => setShowAddAccount(!showAddAccount)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: 'rgba(236,72,153,0.12)', color: '#ec4899', border: '1px solid rgba(236,72,153,0.3)', cursor: 'pointer', fontFamily: 'inherit' }}>+ Account</button>
            </div>

            {showAddAccount && (
              <div style={{ ...itemS, border: '1px solid #ec4899', marginBottom: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Model</label>
                    <select value={newAccount.model_name} onChange={e => setNewAccount(p => ({ ...p, model_name: e.target.value }))} style={inputS}>
                      <option value="">Wählen...</option>
                      {activeModels.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Plattform</label>
                    <select value={newAccount.platform} onChange={e => setNewAccount(p => ({ ...p, platform: e.target.value }))} style={inputS}>
                      {PLATFORMS.map(pl => <option key={pl}>{pl}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Account-Name</label>
                    <input value={newAccount.account_name} onChange={e => setNewAccount(p => ({ ...p, account_name: e.target.value }))} style={inputS} placeholder="@username" />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Thema / Stil</label>
                    <input value={newAccount.theme} onChange={e => setNewAccount(p => ({ ...p, theme: e.target.value }))} style={inputS} placeholder="z.B. Lifestyle, OF-Promo" />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={addAccount} disabled={saving} style={{ flex: 1, padding: '7px', borderRadius: 7, background: '#ec4899', color: '#fff', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>+ Speichern</button>
                  <button onClick={() => setShowAddAccount(false)} style={{ padding: '7px 12px', borderRadius: 7, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Abbrechen</button>
                </div>
              </div>
            )}

            {activeModels.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>Kein Tracking aktiv – unter ⚙ Tracking aktivieren</div>}

            {activeModels.map((model, mi) => {
              const colors = ['#ec4899', '#10b981', '#a78bfa', '#f59e0b', '#06b6d4', '#ef4444']
              const color = colors[mi % colors.length]
              const modelAccounts = accounts.filter(a => a.model_name === model.name && a.active)
              if (modelAccounts.length === 0) return null
              return (
                <div key={model.name} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color }}>{model.name[0]}</div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{model.name}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6, paddingLeft: 30 }}>
                    {modelAccounts.map(acc => {
                      const perf = latestPerf(acc.id)
                      return (
                        <div key={acc.id} style={{ ...itemS }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{acc.account_name}</span>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>{acc.platform}</span>
                              <button onClick={() => deleteAccount(acc.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: 0 }}
                                onMouseEnter={e => e.target.style.color = '#ef4444'} onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
                            </div>
                          </div>
                          {acc.theme && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>{acc.theme}</div>}
                          {perf ? (
                            <div style={{ display: 'flex', gap: 8 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>{perf.follower_count?.toLocaleString()}</span>
                              <span style={{ fontSize: 11, color: perf.follower_delta >= 0 ? '#10b981' : '#ef4444' }}>{perf.follower_delta >= 0 ? '+' : ''}{perf.follower_delta}</span>
                              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Ø {perf.avg_views?.toLocaleString()} Views</span>
                            </div>
                          ) : (
                            <button onClick={() => setShowAddPerf(acc.id)} style={{ fontSize: 10, color: '#ec4899', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>+ Zahlen eintragen</button>
                          )}
                          {showAddPerf === acc.id && (
                            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }} onClick={e => e.stopPropagation()}>
                              <input type="date" value={newPerf.week_start} onChange={e => setNewPerf(p => ({ ...p, week_start: e.target.value }))} style={{ ...inputS, fontSize: 11, padding: '4px 6px' }} />
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                                <input value={newPerf.follower_count} onChange={e => setNewPerf(p => ({ ...p, follower_count: e.target.value }))} style={{ ...inputS, fontSize: 11, padding: '4px 6px' }} placeholder="Follower" />
                                <input value={newPerf.follower_delta} onChange={e => setNewPerf(p => ({ ...p, follower_delta: e.target.value }))} style={{ ...inputS, fontSize: 11, padding: '4px 6px' }} placeholder="+/- Woche" />
                                <input value={newPerf.avg_views} onChange={e => setNewPerf(p => ({ ...p, avg_views: e.target.value }))} style={{ ...inputS, fontSize: 11, padding: '4px 6px' }} placeholder="Ø Views" />
                                <input value={newPerf.posts_count} onChange={e => setNewPerf(p => ({ ...p, posts_count: e.target.value }))} style={{ ...inputS, fontSize: 11, padding: '4px 6px' }} placeholder="Posts" />
                              </div>
                              <button onClick={() => addPerformance(acc.id, acc.model_name)} disabled={saving} style={{ padding: '5px', borderRadius: 6, background: '#ec4899', color: '#fff', border: 'none', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>Speichern</button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Pending approvals */}
          {pendingApproval.length > 0 && (
            <div style={{ ...cardS, borderLeft: '3px solid #f59e0b', borderRadius: '0 10px 10px 0' }}>
              <div style={{ fontSize: 10, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginBottom: 10 }}>Freigaben ausstehend · {pendingApproval.length}</div>
              {pendingApproval.map(post => (
                <div key={post.id} style={{ ...itemS, border: '1px solid rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.04)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{post.model_name} · {post.title}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{post.platform}{post.scheduled_at ? ` · ${new Date(post.scheduled_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <button onClick={() => updatePostStatus(post.id, 'fertig')} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 5, background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', cursor: 'pointer', fontFamily: 'inherit' }}>✓ Freigeben</button>
                      <button onClick={() => updatePostStatus(post.id, 'abgelehnt')} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 5, background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── CONTENT QUEUE ── */}
      {section === 'queue' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button onClick={() => setShowAddPost(!showAddPost)} style={{ padding: '6px 14px', borderRadius: 7, background: 'rgba(236,72,153,0.15)', color: '#ec4899', border: '1px solid rgba(236,72,153,0.3)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>+ Neuer Post</button>
          </div>

          {showAddPost && (
            <div style={{ ...cardS, border: '1px solid #ec4899', marginBottom: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Model</label>
                  <select value={newPost.model_name} onChange={e => setNewPost(p => ({ ...p, model_name: e.target.value, account_id: '' }))} style={inputS}>
                    <option value="">Wählen...</option>
                    {activeModels.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Account</label>
                  <select value={newPost.account_id} onChange={e => setNewPost(p => ({ ...p, account_id: e.target.value }))} style={inputS}>
                    <option value="">Wählen...</option>
                    {accounts.filter(a => a.model_name === newPost.model_name).map(a => <option key={a.id} value={a.id}>{a.account_name} ({a.platform})</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Titel / Beschreibung</label>
                  <input value={newPost.title} onChange={e => setNewPost(p => ({ ...p, title: e.target.value }))} style={inputS} placeholder="z.B. Reel Outdoor Shooting" />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Geplant am</label>
                  <input type="datetime-local" value={newPost.scheduled_at} onChange={e => setNewPost(p => ({ ...p, scheduled_at: e.target.value }))} style={inputS} />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Status</label>
                  <select value={newPost.status} onChange={e => setNewPost(p => ({ ...p, status: e.target.value }))} style={inputS}>
                    {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Material-Link (iCloud/Drive)</label>
                  <input value={newPost.material_link} onChange={e => setNewPost(p => ({ ...p, material_link: e.target.value }))} style={inputS} placeholder="https://..." />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={addPost} disabled={saving || !newPost.title || !newPost.model_name} style={{ flex: 1, padding: '8px', borderRadius: 7, background: newPost.title && newPost.model_name ? '#ec4899' : 'var(--border)', color: newPost.title && newPost.model_name ? '#fff' : 'var(--text-muted)', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {saving ? '...' : '+ Speichern'}
                </button>
                <button onClick={() => setShowAddPost(false)} style={{ padding: '8px 14px', borderRadius: 7, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Abbrechen</button>
              </div>
            </div>
          )}

          <div style={cardS}>
            {posts.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>Noch keine Posts</div>}
            {posts.map(post => {
              const color = STATUS_COLORS[post.status] || '#888'
              return (
                <div key={post.id} style={{ ...itemS, borderLeft: `3px solid ${color}`, borderRadius: '0 8px 8px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{post.model_name} · {post.title}</span>
                        <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: color + '22', color }}>{STATUS_LABELS[post.status]}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 10, color: 'var(--text-muted)' }}>
                        {post.platform && <span>{post.platform}</span>}
                        {post.scheduled_at && <span>geplant {new Date(post.scheduled_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}
                        {post.material_link && <a href={post.material_link} target="_blank" rel="noreferrer" style={{ color: '#7c3aed', textDecoration: 'none' }}>Material-Link</a>}
                        {post.views > 0 && <span style={{ color: '#10b981' }}>{post.views.toLocaleString()} Views</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {post.status !== 'gepostet' && post.status !== 'abgelehnt' && (
                        <select value={post.status} onChange={e => updatePostStatus(post.id, e.target.value)}
                          style={{ fontSize: 10, padding: '2px 6px', borderRadius: 5, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontFamily: 'inherit', cursor: 'pointer' }}>
                          {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      )}
                      <button onClick={() => deletePost(post.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}
                        onMouseEnter={e => e.target.style.color = '#ef4444'} onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── PERFORMANCE ── */}
      {section === 'performance' && (
        <div style={cardS}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginBottom: 12 }}>Performance Übersicht</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e1e3a' }}>
                  {['Model', 'Account', 'Plattform', 'Follower', '+/- Woche', 'Ø Views', 'Posts', 'KW'].map(h => (
                    <th key={h} style={{ padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 600, textAlign: h === 'Model' || h === 'Account' || h === 'Plattform' ? 'left' : 'right', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accounts.filter(a => a.active).map(acc => {
                  const perf = latestPerf(acc.id)
                  return (
                    <tr key={acc.id} style={{ borderBottom: '1px solid #1e1e3a' }}>
                      <td style={{ padding: '8px', color: 'var(--text-primary)', fontWeight: 600 }}>{acc.model_name}</td>
                      <td style={{ padding: '8px', color: 'var(--text-primary)' }}>{acc.account_name}</td>
                      <td style={{ padding: '8px', color: 'var(--text-muted)' }}>{acc.platform}</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: 'var(--text-primary)' }}>{perf ? perf.follower_count?.toLocaleString() : '—'}</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: perf?.follower_delta >= 0 ? '#10b981' : '#ef4444' }}>{perf ? (perf.follower_delta >= 0 ? '+' : '') + perf.follower_delta : '—'}</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: 'var(--text-primary)' }}>{perf ? perf.avg_views?.toLocaleString() : '—'}</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: 'var(--text-muted)' }}>{perf ? perf.posts_count : '—'}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        <button onClick={() => setShowAddPerf(showAddPerf === acc.id ? null : acc.id)} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'rgba(236,72,153,0.12)', color: '#ec4899', border: '1px solid rgba(236,72,153,0.3)', cursor: 'pointer', fontFamily: 'inherit' }}>+ Eintragen</button>
                      </td>
                    </tr>
                  )
                })}
                {accounts.filter(a => a.active).length === 0 && (
                  <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Noch keine aktiven Accounts</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {showAddPerf && (
            <div style={{ ...itemS, border: '1px solid #ec4899', marginTop: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>Zahlen eintragen für {accounts.find(a => a.id === showAddPerf)?.account_name}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 6, marginBottom: 8 }}>
                <input type="date" value={newPerf.week_start} onChange={e => setNewPerf(p => ({ ...p, week_start: e.target.value }))} style={{ ...inputS, fontSize: 11, padding: '4px 6px' }} />
                <input value={newPerf.follower_count} onChange={e => setNewPerf(p => ({ ...p, follower_count: e.target.value }))} style={{ ...inputS, fontSize: 11, padding: '4px 6px' }} placeholder="Follower" />
                <input value={newPerf.follower_delta} onChange={e => setNewPerf(p => ({ ...p, follower_delta: e.target.value }))} style={{ ...inputS, fontSize: 11, padding: '4px 6px' }} placeholder="+/-" />
                <input value={newPerf.avg_views} onChange={e => setNewPerf(p => ({ ...p, avg_views: e.target.value }))} style={{ ...inputS, fontSize: 11, padding: '4px 6px' }} placeholder="Ø Views" />
                <input value={newPerf.posts_count} onChange={e => setNewPerf(p => ({ ...p, posts_count: e.target.value }))} style={{ ...inputS, fontSize: 11, padding: '4px 6px' }} placeholder="Posts" />
              </div>
              <button onClick={() => addPerformance(showAddPerf, accounts.find(a => a.id === showAddPerf)?.model_name)} disabled={saving} style={{ padding: '6px 16px', borderRadius: 6, background: '#ec4899', color: '#fff', border: 'none', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Speichern</button>
            </div>
          )}
        </div>
      )}

      {/* ── TRENDS ── */}
      {section === 'trends' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button onClick={() => setShowAddTrend(!showAddTrend)} style={{ padding: '6px 14px', borderRadius: 7, background: 'rgba(167,139,250,0.15)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.3)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>+ Trend hinzufügen</button>
          </div>

          {showAddTrend && (
            <div style={{ ...cardS, border: '1px solid #a78bfa', marginBottom: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input value={newTrend.title} onChange={e => setNewTrend(p => ({ ...p, title: e.target.value }))} style={inputS} placeholder="Trend-Titel *" autoFocus />
                <textarea value={newTrend.description} onChange={e => setNewTrend(p => ({ ...p, description: e.target.value }))} style={{ ...inputS, resize: 'vertical' }} rows={2} placeholder="Beschreibung, Beispiele..." />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Plattform</label>
                    <select value={newTrend.platform} onChange={e => setNewTrend(p => ({ ...p, platform: e.target.value }))} style={inputS}>
                      <option value="">Alle</option>
                      {PLATFORMS.map(pl => <option key={pl}>{pl}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Priorität</label>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[['hoch', '#10b981'], ['mittel', '#f59e0b'], ['niedrig', '#06b6d4']].map(([k, c]) => (
                        <button key={k} onClick={() => setNewTrend(p => ({ ...p, priority: k }))} style={{ flex: 1, padding: '6px 4px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, fontWeight: 600, background: newTrend.priority === k ? c + '22' : 'transparent', color: newTrend.priority === k ? c : 'var(--text-muted)', border: `1px solid ${newTrend.priority === k ? c : 'var(--border)'}` }}>{k.charAt(0).toUpperCase() + k.slice(1)}</button>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={addTrend} disabled={saving || !newTrend.title} style={{ flex: 1, padding: '8px', borderRadius: 7, background: newTrend.title ? '#a78bfa' : 'var(--border)', color: newTrend.title ? '#fff' : 'var(--text-muted)', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>+ Speichern</button>
                  <button onClick={() => setShowAddTrend(false)} style={{ padding: '8px 14px', borderRadius: 7, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Abbrechen</button>
                </div>
              </div>
            </div>
          )}

          <div style={cardS}>
            {trends.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>Noch keine Trends</div>}
            {trends.map(trend => {
              const color = TREND_COLORS[trend.priority] || '#a78bfa'
              return (
                <div key={trend.id} style={{ ...itemS, borderLeft: `3px solid ${color}`, borderRadius: '0 8px 8px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{trend.title}</span>
                        <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: color + '22', color }}>{trend.priority}</span>
                        {trend.platform && <span style={{ fontSize: 9, color: 'var(--text-muted)', background: 'var(--bg-card)', padding: '1px 5px', borderRadius: 3, border: '1px solid var(--border)' }}>{trend.platform}</span>}
                      </div>
                      {trend.description && <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{trend.description}</div>}
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>von {trend.created_by} · {new Date(trend.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</div>
                    </div>
                    <button onClick={() => deleteTrend(trend.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, padding: '0 4px' }}
                      onMouseEnter={e => e.target.style.color = '#ef4444'} onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── BRANDING ── */}
      {section === 'branding' && (
        <div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {activeModels.map((m, i) => {
              const colors = ['#ec4899', '#10b981', '#a78bfa', '#f59e0b']
              return (
                <button key={m.name} onClick={() => setSelectedModel(m.name)} style={{
                  padding: '5px 14px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 12,
                  background: selectedModel === m.name ? colors[i % colors.length] : 'transparent',
                  color: selectedModel === m.name ? '#fff' : 'var(--text-muted)',
                  border: `1px solid ${selectedModel === m.name ? colors[i % colors.length] : 'var(--border)'}`,
                }}>{m.name}</button>
              )
            })}
          </div>

          {selectedModel && activeModels.some(m => m.name === selectedModel) && (() => {
            const b = brandings[selectedModel] || {}
            const fields = [
              ['style', 'Stil / Persönlichkeit', b.style || ''],
              ['target_audience', 'Zielgruppe', b.target_audience || ''],
              ['posting_frequency', 'Posting-Frequenz', b.posting_frequency || ''],
              ['dos', 'Dos', b.dos || ''],
              ['donts', 'No Gos / Don\'ts', b.donts || ''],
              ['material_links', 'Material-Links (iCloud/Drive)', b.material_links || ''],
            ]
            return (
              <div style={cardS}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14 }}>{selectedModel} · Branding Guide</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {fields.map(([key, label, val]) => (
                    <div key={key}>
                      <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{label}</label>
                      <input defaultValue={val} onBlur={e => saveBranding(selectedModel, { [key]: e.target.value })} style={inputS} placeholder={label + '...'} />
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--bg-card2)', borderRadius: 7, fontSize: 11, color: 'var(--text-muted)' }}>
                  Felder werden automatisch gespeichert beim Verlassen
                </div>
              </div>
            )
          })()}

          {activeModels.length === 0 && <div style={{ ...cardS, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: 30 }}>Kein Tracking aktiv – unter ⚙ Tracking aktivieren</div>}
        </div>
      )}

      {/* ── TRACKING SETTINGS ── */}
      {section === 'settings' && (
        <div style={cardS}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginBottom: 14 }}>Social Tracking pro Model aktivieren</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {models.map(model => {
              const active = brandings[model.name]?.tracking_active || false
              return (
                <div key={model.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: active ? 'rgba(236,72,153,0.05)' : 'var(--bg-card2)', borderRadius: 8, border: `1px solid ${active ? 'rgba(236,72,153,0.25)' : 'var(--border)'}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: active ? 'rgba(236,72,153,0.15)' : 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: active ? '#ec4899' : 'var(--text-muted)' }}>{model.name[0]}</div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{model.name}</span>
                    {active && <span style={{ fontSize: 10, color: '#ec4899', background: 'rgba(236,72,153,0.12)', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>{accounts.filter(a => a.model_name === model.name).length} Accounts</span>}
                  </div>
                  <button onClick={() => toggleTracking(model.name, !active)} style={{
                    padding: '5px 14px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 12,
                    background: active ? 'rgba(236,72,153,0.15)' : 'transparent',
                    color: active ? '#ec4899' : 'var(--text-muted)',
                    border: `1px solid ${active ? '#ec4899' : 'var(--border)'}`,
                  }}>{active ? 'Aktiv ✓' : 'Aktivieren'}</button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
