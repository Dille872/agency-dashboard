import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'

const SECTIONS = [
  { key: 'team', label: 'Team' },
  { key: 'bot', label: 'Bot Nachrichten' },
  { key: 'model-aliases', label: 'Model CSV-Zuordnung' },
  { key: 'chatter-aliases', label: 'Chatter CSV-Zuordnung' },
]

const ROLES = [
  { key: 'chatter', label: 'Chatter', color: '#06b6d4' },
  { key: 'model', label: 'Model', color: '#f59e0b' },
  { key: 'admin', label: 'Admin', color: '#7c3aed' },
]

const DEFAULT_BOT_MESSAGES = {
  shift_start: '✅ Schicht gestartet!\n{shift} · {models}\n\nSende /off wenn fertig.',
  shift_end: '👋 Schicht beendet!\nDauer: {duration}\n\nGute Arbeit!',
  shift_reminder: '🔔 Schicht-Erinnerung!\n\nDu hast {shift}schicht bei {model}.\n📅 {date}\n⏰ {time} Uhr\n\n– Thirteen 87',
  dienstplan_live: '📅 Dienstplan KW {kw} ist jetzt live!\n\nDeine Schichten:\n{shifts}\n\n– Thirteen 87',
  status_available: '✓ Status: Verfügbar ✓',
  status_unavailable: '✓ Status: Nicht verfügbar{until}',
  status_pause: '✓ Status: Pause bis {until} Uhr',
  welcome: '👋 Hallo! Deine Telegram ID: {id}\n\nTeile diese ID deinem Team mit.',
}

const BOT_MESSAGE_LABELS = {
  shift_start: 'Schicht gestartet (/on)',
  shift_end: 'Schicht beendet (/off)',
  shift_reminder: 'Schicht-Erinnerung',
  dienstplan_live: 'Dienstplan Live',
  status_available: 'Model: Verfügbar',
  status_unavailable: 'Model: Nicht verfügbar',
  status_pause: 'Model: Pause',
  welcome: 'Willkommen (/start)',
}

export default function SettingsTab() {
  const [activeSection, setActiveSection] = useState('team')

  // Team state
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState('chatter')
  const [sending, setSending] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')
  const [users, setUsers] = useState([])

  // Bot messages state
  const [botMessages, setBotMessages] = useState({ ...DEFAULT_BOT_MESSAGES })
  const [editingMsg, setEditingMsg] = useState(null)
  const [savingMsg, setSavingMsg] = useState(false)

  // Model aliases state
  const [modelAliases, setModelAliases] = useState([])
  const [models, setModels] = useState([])
  const [newModelAlias, setNewModelAlias] = useState({ model_name: '', csv_name: '', alias_label: '' })

  // Chatter aliases state
  const [chatterAliases, setChatterAliases] = useState([])
  const [chatters, setChatters] = useState([])
  const [newChatterAlias, setNewChatterAlias] = useState({ chatter_name: '', csv_name: '', telegram_id: '' })

  useEffect(() => {
    loadUsers()
    loadModels()
    loadChatters()
    loadModelAliases()
    loadChatterAliases()
    loadBotMessages()
  }, [])

  const loadUsers = async () => {
    const { data } = await supabase.from('user_roles').select('*').order('role')
    setUsers(data || [])
  }
  const loadModels = async () => {
    const { data } = await supabase.from('models_contact').select('name').order('name')
    setModels(data || [])
  }
  const loadChatters = async () => {
    const { data } = await supabase.from('chatters_contact').select('name').order('name')
    setChatters(data || [])
  }
  const loadModelAliases = async () => {
    const { data } = await supabase.from('model_aliases').select('*').order('model_name')
    setModelAliases(data || [])
  }
  const loadChatterAliases = async () => {
    const { data } = await supabase.from('chatter_aliases').select('*').order('chatter_name')
    setChatterAliases(data || [])
  }
  const loadBotMessages = async () => {
    const { data } = await supabase.from('bot_settings').select('*')
    if (data && data.length > 0) {
      const map = { ...DEFAULT_BOT_MESSAGES }
      for (const item of data) map[item.key] = item.value
      setBotMessages(map)
    }
  }

  const saveBotMessage = async (key, value) => {
    setSavingMsg(true)
    await supabase.from('bot_settings').upsert({ key, value }, { onConflict: 'key' })
    setBotMessages(prev => ({ ...prev, [key]: value }))
    setEditingMsg(null)
    setSavingMsg(false)
  }

  const resetBotMessage = async (key) => {
    await supabase.from('bot_settings').delete().eq('key', key)
    setBotMessages(prev => ({ ...prev, [key]: DEFAULT_BOT_MESSAGES[key] }))
    setEditingMsg(null)
  }

  const sendInvite = async () => {
    if (!email.trim() || !displayName.trim()) return
    setSending(true); setError(''); setSuccess('')
    setError(`Manuell einladen:\n1. Supabase Dashboard → Authentication → Invite User → ${email.trim()}\n2. Nach Login in SQL:\ninsert into user_roles (user_id, role, display_name)\nvalues ('<UUID>', '${role}', '${displayName.trim()}');`)
    setSending(false)
  }

  const deleteUser = async (userId, name) => {
    if (!confirm(`${name} wirklich entfernen?`)) return
    await supabase.from('user_roles').delete().eq('user_id', userId)
    loadUsers()
  }

  const addModelAlias = async () => {
    if (!newModelAlias.model_name || !newModelAlias.csv_name.trim()) return
    await supabase.from('model_aliases').insert(newModelAlias)
    setNewModelAlias({ model_name: '', csv_name: '', alias_label: '' })
    loadModelAliases()
  }

  const deleteModelAlias = async (id) => {
    await supabase.from('model_aliases').delete().eq('id', id)
    loadModelAliases()
  }

  const addChatterAlias = async () => {
    if (!newChatterAlias.chatter_name || !newChatterAlias.csv_name.trim()) return
    await supabase.from('chatter_aliases').insert(newChatterAlias)
    // Also update telegram_id in chatters_contact if provided
    if (newChatterAlias.telegram_id) {
      await supabase.from('chatters_contact').update({ telegram_id: newChatterAlias.telegram_id }).eq('name', newChatterAlias.chatter_name)
    }
    setNewChatterAlias({ chatter_name: '', csv_name: '', telegram_id: '' })
    loadChatterAliases()
  }

  const deleteChatterAlias = async (id) => {
    await supabase.from('chatter_aliases').delete().eq('id', id)
    loadChatterAliases()
  }

  const cardS = { background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '16px 18px' }
  const inputS = { background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none', width: '100%' }
  const labelS = { fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 10 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Section tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {SECTIONS.map(s => (
          <button key={s.key} onClick={() => setActiveSection(s.key)} style={{
            padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
            background: activeSection === s.key ? '#7c3aed' : 'var(--bg-card)',
            color: activeSection === s.key ? '#fff' : 'var(--text-secondary)',
            border: `1px solid ${activeSection === s.key ? '#7c3aed' : 'var(--border)'}`,
          }}>{s.label}</button>
        ))}
      </div>

      {/* TEAM */}
      {activeSection === 'team' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 600 }}>
          <div style={cardS}>
            <div style={labelS}>Neues Mitglied einladen</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Name</label>
                <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="z.B. Kaan" style={inputS} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>E-Mail</label>
                <input value={email} onChange={e => setEmail(e.target.value)} placeholder="kaan@example.com" type="email" style={inputS} />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {ROLES.map(r => (
                  <button key={r.key} onClick={() => setRole(r.key)} style={{
                    flex: 1, padding: '7px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 12,
                    background: role === r.key ? r.color + '22' : 'transparent',
                    color: role === r.key ? r.color : 'var(--text-muted)',
                    border: `1px solid ${role === r.key ? r.color : 'var(--border)'}`,
                  }}>{r.label}</button>
                ))}
              </div>
              <button onClick={sendInvite} disabled={sending || !email.trim() || !displayName.trim()}
                style={{ padding: '9px', borderRadius: 7, background: email && displayName ? '#7c3aed' : 'var(--border)', color: email && displayName ? '#fff' : 'var(--text-muted)', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                ✉ Anleitung anzeigen
              </button>
              {error && <div style={{ fontSize: 11, color: '#f59e0b', padding: '10px 12px', background: 'rgba(245,158,11,0.08)', borderRadius: 7, border: '1px solid rgba(245,158,11,0.3)', fontFamily: 'monospace', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>⚠ {error}</div>}
            </div>
          </div>

          <div style={cardS}>
            <div style={labelS}>Aktuelle Mitglieder ({users.length})</div>
            {users.map(u => {
              const rc = u.role === 'admin' ? '#7c3aed' : u.role === 'model' ? '#f59e0b' : '#06b6d4'
              return (
                <div key={u.user_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--bg-card2)', borderRadius: 8, border: '1px solid #1e1e3a', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: rc + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: rc }}>{(u.display_name || '?')[0]}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{u.display_name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{u.user_id.slice(0, 12)}...</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: rc, background: rc + '22', padding: '2px 8px', borderRadius: 4 }}>{u.role}</span>
                    <button onClick={() => deleteUser(u.user_id, u.display_name)} style={{ background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', color: 'rgba(239,68,68,0.6)', borderRadius: 5, padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* BOT MESSAGES */}
      {activeSection === 'bot' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 700 }}>
          <div style={{ ...cardS, marginBottom: 4 }}>
            <div style={labelS}>Verfügbare Variablen</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.8, fontFamily: 'monospace' }}>
              {'{name}'} · {'{shift}'} · {'{models}'} · {'{duration}'} · {'{date}'} · {'{time}'} · {'{until}'} · {'{kw}'} · {'{shifts}'} · {'{id}'}
            </div>
          </div>
          {Object.entries(BOT_MESSAGE_LABELS).map(([key, label]) => {
            const isEditing = editingMsg === key
            const isCustom = botMessages[key] !== DEFAULT_BOT_MESSAGES[key]
            return (
              <div key={key} style={cardS}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{label}</span>
                    {isCustom && <span style={{ fontSize: 9, color: '#f59e0b', background: 'rgba(245,158,11,0.15)', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>ANGEPASST</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {isCustom && <button onClick={() => resetBotMessage(key)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>↺ Reset</button>}
                    <button onClick={() => setEditingMsg(isEditing ? null : key)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, background: isEditing ? '#7c3aed' : 'transparent', border: `1px solid ${isEditing ? '#7c3aed' : 'var(--border)'}`, color: isEditing ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                      {isEditing ? 'Schließen' : '✎ Bearbeiten'}
                    </button>
                  </div>
                </div>
                {isEditing ? (
                  <div>
                    <textarea
                      defaultValue={botMessages[key]}
                      id={`msg-${key}`}
                      rows={4}
                      style={{ ...inputS, resize: 'vertical', lineHeight: 1.6, marginBottom: 8 }}
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => saveBotMessage(key, document.getElementById(`msg-${key}`).value)} disabled={savingMsg}
                        style={{ padding: '6px 14px', borderRadius: 6, background: '#7c3aed', color: '#fff', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                        {savingMsg ? '...' : '✓ Speichern'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'monospace', background: 'var(--bg-card2)', padding: '8px 10px', borderRadius: 7, border: '1px solid #1e1e3a', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                    {botMessages[key]}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* MODEL CSV */}
      {activeSection === 'model-aliases' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 700 }}>
          <div style={cardS}>
            <div style={labelS}>Neue Zuordnung</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Model</label>
                <select value={newModelAlias.model_name} onChange={e => setNewModelAlias(p => ({ ...p, model_name: e.target.value }))} style={inputS}>
                  <option value="">— wählen —</option>
                  {models.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>CSV-Name (exakt)</label>
                <input value={newModelAlias.csv_name} onChange={e => setNewModelAlias(p => ({ ...p, csv_name: e.target.value }))} placeholder="z.B. Elina_mj 🎮" style={inputS} />
              </div>
              <div style={{ flex: 1, minWidth: 100 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Label</label>
                <input value={newModelAlias.alias_label} onChange={e => setNewModelAlias(p => ({ ...p, alias_label: e.target.value }))} placeholder="z.B. MAIN" style={inputS} />
              </div>
              <button onClick={addModelAlias} disabled={!newModelAlias.model_name || !newModelAlias.csv_name}
                style={{ padding: '7px 14px', borderRadius: 7, background: newModelAlias.model_name && newModelAlias.csv_name ? '#f59e0b' : 'var(--border)', color: newModelAlias.model_name && newModelAlias.csv_name ? '#000' : 'var(--text-muted)', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                + Hinzufügen
              </button>
            </div>
          </div>
          <div style={cardS}>
            <div style={labelS}>Bestehende Zuordnungen</div>
            {models.filter(m => modelAliases.some(a => a.model_name === m.name)).map(m => (
              <div key={m.name} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', marginBottom: 6 }}>{m.name}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {modelAliases.filter(a => a.model_name === m.name).map(a => (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{a.csv_name}</span>
                      {a.alias_label && <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>· {a.alias_label}</span>}
                      <button onClick={() => deleteModelAlias(a.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: 0 }}
                        onMouseEnter={e => e.target.style.color = '#ef4444'} onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {modelAliases.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>Noch keine Zuordnungen</div>}
          </div>
        </div>
      )}

      {/* CHATTER CSV */}
      {activeSection === 'chatter-aliases' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 700 }}>
          <div style={cardS}>
            <div style={labelS}>Neue Zuordnung</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Chatter</label>
                <select value={newChatterAlias.chatter_name} onChange={e => setNewChatterAlias(p => ({ ...p, chatter_name: e.target.value }))} style={inputS}>
                  <option value="">— wählen —</option>
                  {chatters.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>CSV-Name (exakt)</label>
                <input value={newChatterAlias.csv_name} onChange={e => setNewChatterAlias(p => ({ ...p, csv_name: e.target.value }))} placeholder="z.B. Kaan" style={inputS} />
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Telegram ID</label>
                <input value={newChatterAlias.telegram_id} onChange={e => setNewChatterAlias(p => ({ ...p, telegram_id: e.target.value }))} placeholder="z.B. 123456789" style={inputS} />
              </div>
              <button onClick={addChatterAlias} disabled={!newChatterAlias.chatter_name || !newChatterAlias.csv_name}
                style={{ padding: '7px 14px', borderRadius: 7, background: newChatterAlias.chatter_name && newChatterAlias.csv_name ? '#06b6d4' : 'var(--border)', color: newChatterAlias.chatter_name && newChatterAlias.csv_name ? '#000' : 'var(--text-muted)', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                + Hinzufügen
              </button>
            </div>
          </div>
          <div style={cardS}>
            <div style={labelS}>Bestehende Zuordnungen</div>
            {chatters.filter(c => chatterAliases.some(a => a.chatter_name === c.name)).map(c => (
              <div key={c.name} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#06b6d4', marginBottom: 6 }}>{c.name}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {chatterAliases.filter(a => a.chatter_name === c.name).map(a => (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.2)', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{a.csv_name}</span>
                      {a.telegram_id && <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>· TG: {a.telegram_id}</span>}
                      <button onClick={() => deleteChatterAlias(a.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: 0 }}
                        onMouseEnter={e => e.target.style.color = '#ef4444'} onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {chatterAliases.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>Noch keine Zuordnungen</div>}
          </div>
        </div>
      )}
    </div>
  )
}
