import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'

function formatMoney(v) {
  if (!v && v !== 0) return '$0.00'
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function BillingTab() {
  const [activeSection, setActiveSection] = useState('models')
  const [models, setModels] = useState([])
  const [chatters, setChatters] = useState([])
  const [billingSettings, setBillingSettings] = useState([])
  const [snapshots, setSnapshots] = useState([])
  const [chatterSnapshots, setChatterSnapshots] = useState([])
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [editingPerson, setEditingPerson] = useState(null)
  const [editValues, setEditValues] = useState({})
  const [saving, setSaving] = useState(false)
  const [aliases, setAliases] = useState([])

  useEffect(() => {
    loadAll()
  }, [selectedMonth])

  const loadAll = async () => {
    const [
      { data: modelsData },
      { data: chattersData },
      { data: billingData },
      { data: aliasData },
    ] = await Promise.all([
      supabase.from('models_contact').select('name').order('name'),
      supabase.from('chatters_contact').select('name').order('name'),
      supabase.from('billing_settings').select('*'),
      supabase.from('model_aliases').select('*'),
    ])
    setModels(modelsData || [])
    setChatters(chattersData || [])
    setBillingSettings(billingData || [])
    setAliases(aliasData || [])

    // Load snapshots for selected month
    const monthStart = selectedMonth + '-01'
    const [year, month] = selectedMonth.split('-')
    const monthEnd = `${year}-${month}-31`
    const { data: snapData } = await supabase.from('model_snapshots').select('rows, business_date')
      .gte('business_date', monthStart).lte('business_date', monthEnd)
    const { data: chatSnapData } = await supabase.from('chatter_snapshots').select('rows, business_date')
      .gte('business_date', monthStart).lte('business_date', monthEnd)
    setSnapshots(snapData || [])
    setChatterSnapshots(chatSnapData || [])
  }

  const getBillingSetting = (name, type) => billingSettings.find(b => b.person_name === name && b.person_type === type)

  const saveBilling = async () => {
    if (!editingPerson) return
    setSaving(true)
    const { name, type } = editingPerson
    const existing = getBillingSetting(name, type)
    if (existing) {
      await supabase.from('billing_settings').update({ ...editValues, updated_at: new Date().toISOString() }).eq('id', existing.id)
    } else {
      await supabase.from('billing_settings').insert({ person_name: name, person_type: type, ...editValues })
    }
    setEditingPerson(null)
    await loadAll()
    setSaving(false)
  }

  const startEdit = (name, type) => {
    const existing = getBillingSetting(name, type)
    setEditingPerson({ name, type })
    setEditValues({
      percentage: existing?.percentage || 0,
      include_subs: existing?.include_subs ?? true,
      include_chat: existing?.include_chat ?? true,
      include_tips: existing?.include_tips ?? true,
      include_ppv: existing?.include_ppv ?? true,
    })
  }

  const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

  const getModelRevenue = (modelName) => {
    const csvNames = aliases.filter(a => normalize(a.model_name) === normalize(modelName)).map(a => a.csv_name)
    if (csvNames.length === 0) csvNames.push(modelName)

    let subs = 0, chat = 0, tips = 0, total = 0
    for (const snap of snapshots) {
      for (const row of snap.rows || []) {
        const csvName = row.creator || row.name || ''
        if (csvNames.some(cn => normalize(cn) === normalize(csvName) || normalize(csvName).includes(normalize(cn)))) {
          subs += (row.newSubsRevenue || 0) + (row.recurringSubsRevenue || 0)
          chat += row.messageRevenue || 0
          tips += row.tipsRevenue || 0
          total += row.revenue || 0
        }
      }
    }
    return { subs, chat, tips, total }
  }

  const getChatterRevenue = (chatterName) => {
    let chat = 0, total = 0
    for (const snap of chatterSnapshots) {
      for (const row of snap.rows || []) {
        const name = row.name || row.chatter || ''
        if (normalize(name) === normalize(chatterName) || normalize(name).includes(normalize(chatterName))) {
          chat += row.messageRevenue || 0
          total += row.revenue || 0
        }
      }
    }
    return { chat, total }
  }

  const calcModelPayout = (modelName) => {
    const setting = getBillingSetting(modelName, 'model')
    if (!setting) return null
    const rev = getModelRevenue(modelName)
    let base = 0
    if (setting.include_subs) base += rev.subs
    if (setting.include_chat) base += rev.chat
    if (setting.include_tips) base += rev.tips
    const agencyShare = base * (setting.percentage / 100)
    const modelShare = base - agencyShare
    return { base, agencyShare, modelShare, rev, setting }
  }

  const calcChatterPayout = (chatterName) => {
    const setting = getBillingSetting(chatterName, 'chatter')
    if (!setting) return null
    const rev = getChatterRevenue(chatterName)
    const base = setting.include_chat ? rev.chat : rev.total
    const chatterShare = base * (setting.percentage / 100)
    const agencyShare = base - chatterShare
    return { base, chatterShare, agencyShare, rev, setting }
  }

  const monthName = new Date(selectedMonth + '-15').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })

  // Generate months for selector
  const months = []
  const now = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const cardS = { background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '16px 18px' }
  const inputS = { background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '6px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none' }
  const labelS = { fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 12 }

  const CheckBox = ({ checked, onChange, label }) => (
    <label onClick={onChange} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' }}>
      <div style={{ width: 14, height: 14, borderRadius: 3, border: `1px solid ${checked ? '#7c3aed' : '#2e2e5a'}`, background: checked ? '#7c3aed' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {checked && <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>✓</span>}
      </div>
      {label}
    </label>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {['models', 'chatters'].map(s => (
            <button key={s} onClick={() => setActiveSection(s)} style={{
              padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
              background: activeSection === s ? '#7c3aed' : 'var(--bg-card)',
              color: activeSection === s ? '#fff' : 'var(--text-secondary)',
              border: `1px solid ${activeSection === s ? '#7c3aed' : 'var(--border)'}`,
            }}>{s === 'models' ? '🎭 Models' : '💬 Chatters'}</button>
          ))}
        </div>
        <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
          style={{ ...inputS, marginLeft: 'auto' }}>
          {months.map(m => <option key={m} value={m}>{new Date(m + '-15').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</option>)}
        </select>
      </div>

      {/* MODELS */}
      {activeSection === 'models' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {models.map(model => {
            const setting = getBillingSetting(model.name, 'model')
            const payout = calcModelPayout(model.name)
            const rev = getModelRevenue(model.name)
            const isEditing = editingPerson?.name === model.name && editingPerson?.type === 'model'

            return (
              <div key={model.name} style={cardS}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(245,158,11,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#f59e0b' }}>{model.name[0]}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{model.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{monthName}</div>
                    </div>
                  </div>
                  <button onClick={() => isEditing ? setEditingPerson(null) : startEdit(model.name, 'model')}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: isEditing ? '#7c3aed' : 'transparent', border: `1px solid ${isEditing ? '#7c3aed' : 'var(--border)'}`, color: isEditing ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {isEditing ? 'Schließen' : setting ? '✎ Bearbeiten' : '+ Prozente einstellen'}
                  </button>
                </div>

                {/* Revenue breakdown */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: setting ? 14 : 0 }}>
                  {[
                    { label: 'Gesamt', val: rev.total, color: 'var(--text-primary)' },
                    { label: 'Subs', val: rev.subs, color: '#a78bfa' },
                    { label: 'Chat', val: rev.chat, color: '#06b6d4' },
                    { label: 'Tips', val: rev.tips, color: '#f59e0b' },
                  ].map(item => (
                    <div key={item.label} style={{ background: 'var(--bg-card2)', borderRadius: 7, padding: '8px 10px', border: '1px solid #1e1e3a' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>{item.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: item.color, fontFamily: 'monospace' }}>{formatMoney(item.val)}</div>
                    </div>
                  ))}
                </div>

                {/* Payout calculation */}
                {payout && (
                  <div style={{ borderTop: '1px solid #1e1e3a', paddingTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div style={{ background: 'rgba(16,185,129,0.08)', borderRadius: 7, padding: '10px 12px', border: '1px solid rgba(16,185,129,0.2)' }}>
                      <div style={{ fontSize: 10, color: '#10b981', marginBottom: 3 }}>Model bekommt ({100 - payout.setting.percentage}%)</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#10b981', fontFamily: 'monospace' }}>{formatMoney(payout.modelShare)}</div>
                    </div>
                    <div style={{ background: 'rgba(124,58,237,0.08)', borderRadius: 7, padding: '10px 12px', border: '1px solid rgba(124,58,237,0.2)' }}>
                      <div style={{ fontSize: 10, color: '#a78bfa', marginBottom: 3 }}>Agentur ({payout.setting.percentage}%)</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#a78bfa', fontFamily: 'monospace' }}>{formatMoney(payout.agencyShare)}</div>
                    </div>
                    <div style={{ gridColumn: '1 / -1', fontSize: 10, color: 'var(--text-muted)' }}>
                      Basis: {formatMoney(payout.base)} · {[payout.setting.include_subs && 'Subs', payout.setting.include_chat && 'Chat', payout.setting.include_tips && 'Tips'].filter(Boolean).join(' + ')}
                    </div>
                  </div>
                )}

                {/* Edit panel */}
                {isEditing && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #1e1e3a' }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
                      <div>
                        <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Agentur-Anteil %</label>
                        <input type="number" min="0" max="100" value={editValues.percentage}
                          onChange={e => setEditValues(p => ({ ...p, percentage: parseFloat(e.target.value) || 0 }))}
                          style={{ ...inputS, width: 80 }} />
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Model: {100 - (editValues.percentage || 0)}%
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>Einberechnen:</div>
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
                      <CheckBox checked={editValues.include_subs} onChange={() => setEditValues(p => ({ ...p, include_subs: !p.include_subs }))} label="Subs" />
                      <CheckBox checked={editValues.include_chat} onChange={() => setEditValues(p => ({ ...p, include_chat: !p.include_chat }))} label="Chat Revenue" />
                      <CheckBox checked={editValues.include_tips} onChange={() => setEditValues(p => ({ ...p, include_tips: !p.include_tips }))} label="Tips" />
                    </div>
                    <button onClick={saveBilling} disabled={saving}
                      style={{ padding: '7px 18px', borderRadius: 7, background: '#7c3aed', color: '#fff', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {saving ? '...' : '✓ Speichern'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* CHATTERS */}
      {activeSection === 'chatters' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {chatters.map(chatter => {
            const setting = getBillingSetting(chatter.name, 'chatter')
            const payout = calcChatterPayout(chatter.name)
            const rev = getChatterRevenue(chatter.name)
            const isEditing = editingPerson?.name === chatter.name && editingPerson?.type === 'chatter'

            return (
              <div key={chatter.name} style={cardS}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(6,182,212,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#06b6d4' }}>{chatter.name[0]}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{chatter.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{monthName}</div>
                    </div>
                  </div>
                  <button onClick={() => isEditing ? setEditingPerson(null) : startEdit(chatter.name, 'chatter')}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: isEditing ? '#7c3aed' : 'transparent', border: `1px solid ${isEditing ? '#7c3aed' : 'var(--border)'}`, color: isEditing ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {isEditing ? 'Schließen' : setting ? '✎ Bearbeiten' : '+ Prozente einstellen'}
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: setting ? 14 : 0 }}>
                  {[
                    { label: 'Chat Revenue', val: rev.chat, color: '#06b6d4' },
                    { label: 'Gesamt', val: rev.total, color: 'var(--text-primary)' },
                  ].map(item => (
                    <div key={item.label} style={{ background: 'var(--bg-card2)', borderRadius: 7, padding: '8px 10px', border: '1px solid #1e1e3a' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>{item.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: item.color, fontFamily: 'monospace' }}>{formatMoney(item.val)}</div>
                    </div>
                  ))}
                </div>

                {payout && (
                  <div style={{ borderTop: '1px solid #1e1e3a', paddingTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div style={{ background: 'rgba(6,182,212,0.08)', borderRadius: 7, padding: '10px 12px', border: '1px solid rgba(6,182,212,0.2)' }}>
                      <div style={{ fontSize: 10, color: '#06b6d4', marginBottom: 3 }}>Chatter bekommt ({payout.setting.percentage}%)</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#06b6d4', fontFamily: 'monospace' }}>{formatMoney(payout.chatterShare)}</div>
                    </div>
                    <div style={{ background: 'rgba(124,58,237,0.08)', borderRadius: 7, padding: '10px 12px', border: '1px solid rgba(124,58,237,0.2)' }}>
                      <div style={{ fontSize: 10, color: '#a78bfa', marginBottom: 3 }}>Agentur ({100 - payout.setting.percentage}%)</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#a78bfa', fontFamily: 'monospace' }}>{formatMoney(payout.agencyShare)}</div>
                    </div>
                    <div style={{ gridColumn: '1 / -1', fontSize: 10, color: 'var(--text-muted)' }}>
                      Basis: {formatMoney(payout.base)} · {payout.setting.include_chat ? 'Chat Revenue' : 'Gesamt'}
                    </div>
                  </div>
                )}

                {isEditing && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #1e1e3a' }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 12 }}>
                      <div>
                        <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Chatter-Anteil %</label>
                        <input type="number" min="0" max="100" value={editValues.percentage}
                          onChange={e => setEditValues(p => ({ ...p, percentage: parseFloat(e.target.value) || 0 }))}
                          style={{ ...inputS, width: 80 }} />
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Agentur: {100 - (editValues.percentage || 0)}%
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>Basis:</div>
                    <div style={{ display: 'flex', gap: 14, marginBottom: 12 }}>
                      <CheckBox checked={editValues.include_chat} onChange={() => setEditValues(p => ({ ...p, include_chat: !p.include_chat }))} label="Nur Chat Revenue" />
                    </div>
                    <button onClick={saveBilling} disabled={saving}
                      style={{ padding: '7px 18px', borderRadius: 7, background: '#7c3aed', color: '#fff', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {saving ? '...' : '✓ Speichern'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
