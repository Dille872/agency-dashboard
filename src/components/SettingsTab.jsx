import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import BillingTab from './BillingTab'

const SECTIONS = [
  { key: 'team', label: 'Team' },
  { key: 'surveys', label: 'Umfragen' },
  { key: 'billing', label: 'Billing' },
  { key: 'bot', label: 'Bot Nachrichten' },
  { key: 'model-aliases', label: 'Model CSV' },
  { key: 'chatter-aliases', label: 'Chatter CSV' },
]

const ROLES = [
  { key: 'admin', label: 'Admin', color: '#7c3aed', desc: 'Alles' },
  { key: 'manager', label: 'Manager', color: '#06b6d4', desc: 'Alles außer Einstellungen & Export' },
  { key: 'dienstplan', label: 'Dienstplan', color: '#10b981', desc: 'Nur Dienstplan & Crew' },
  { key: 'creator_manager', label: 'Creator Mgr', color: '#f59e0b', desc: 'Nur Creator Tab' },
  { key: 'chatter', label: 'Chatter', color: '#a78bfa', desc: 'Nur Chatter Portal' },
  { key: 'model', label: 'Model', color: '#ef4444', desc: 'Nur Model Portal' },
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

const BOT_LABELS = {
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

  // Team
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState('chatter')
  const [sending, setSending] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')
  const [users, setUsers] = useState([])
  const [editingRole, setEditingRole] = useState(null)
  const [offboarding, setOffboarding] = useState(null)

  // Bot
  const [botMessages, setBotMessages] = useState({ ...DEFAULT_BOT_MESSAGES })
  const [editingMsg, setEditingMsg] = useState(null)
  const [savingMsg, setSavingMsg] = useState(false)

  // Aliases
  const [modelAliases, setModelAliases] = useState([])
  const [chatterAliases, setChatterAliases] = useState([])
  const [models, setModels] = useState([])
  const [chatters, setChatters] = useState([])
  const [newMA, setNewMA] = useState({ model_name: '', csv_name: '', alias_label: '' })
  const [newCA, setNewCA] = useState({ chatter_name: '', csv_name: '', telegram_id: '' })

  // Surveys
  const [surveys, setSurveys] = useState([])
  const [surveyResponses, setSurveyResponses] = useState([])
  const [newQuestion, setNewQuestion] = useState('')
  const [newAnswerType, setNewAnswerType] = useState('choice')
  const [newOptions, setNewOptions] = useState(['', '', ''])
  const [newTargetRoles, setNewTargetRoles] = useState([])
  const [creatingsurvey, setCreatingSurvey] = useState(false)
  const [expandedSurvey, setExpandedSurvey] = useState(null)

  useEffect(() => {
    loadUsers(); loadModels(); loadChatters()
    loadModelAliases(); loadChatterAliases(); loadBotMessages()
    loadSurveys()
  }, [])

  const loadUsers = async () => { const { data } = await supabase.from('user_roles').select('*').order('role'); setUsers(data || []) }
  const loadModels = async () => { const { data } = await supabase.from('models_contact').select('name').order('name'); setModels(data || []) }
  const loadChatters = async () => { const { data } = await supabase.from('chatters_contact').select('name').order('name'); setChatters(data || []) }
  const loadModelAliases = async () => { const { data } = await supabase.from('model_aliases').select('*').order('model_name'); setModelAliases(data || []) }
  const loadChatterAliases = async () => { const { data } = await supabase.from('chatter_aliases').select('*').order('chatter_name'); setChatterAliases(data || []) }

  const loadSurveys = async () => {
    const { data } = await supabase.from('surveys').select('*').order('created_at', { ascending: false })
    setSurveys(data || [])
    const { data: resp } = await supabase.from('survey_responses').select('*').order('created_at', { ascending: false })
    setSurveyResponses(resp || [])
  }

  const createSurvey = async () => {
    if (!newQuestion.trim()) return
    setCreatingSurvey(true)
    const opts = newAnswerType === 'choice' ? newOptions.filter(o => o.trim()) : []
    await supabase.from('surveys').insert({
      question: newQuestion.trim(), answer_type: newAnswerType, options: opts,
      target_roles: newTargetRoles, active: true, created_by: 'Admin',
    })
    setNewQuestion(''); setNewOptions(['', '', '']); setNewTargetRoles([])
    await loadSurveys(); setCreatingSurvey(false)
  }

  const closeSurvey = async (id) => { await supabase.from('surveys').update({ active: false }).eq('id', id); loadSurveys() }
  const reopenSurvey = async (id) => { await supabase.from('surveys').update({ active: true }).eq('id', id); loadSurveys() }
  const deleteSurvey = async (id) => {
    if (!confirm('Umfrage und alle Antworten löschen?')) return
    await supabase.from('survey_responses').delete().eq('survey_id', id)
    await supabase.from('surveys').delete().eq('id', id)
    loadSurveys()
  }
  const [offboardingUser, setOffboardingUser] = useState(null)
  const [offboardStep, setOffboardStep] = useState('confirm') // confirm | exporting | done

  const startOffboarding = (user) => {
    setOffboardingUser(user)
    setOffboardStep('confirm')
  }

  const exportUserData = async (user) => {
    setOffboardStep('exporting')
    const name = user.display_name
    const role = user.role
    const exportData = { name, role, exported_at: new Date().toISOString() }

    if (role === 'model') {
      const [{ data: board }, { data: snaps }, { data: calendar }, { data: videos }, { data: cc }] = await Promise.all([
        supabase.from('model_board').select('*').eq('model_name', name),
        supabase.from('model_snapshots').select('business_date, rows').order('business_date'),
        supabase.from('model_calendar').select('*').eq('model_name', name),
        supabase.from('model_videos').select('*').eq('model_name', name),
        supabase.from('custom_content').select('*').eq('model_name', name),
      ])
      // Filter snapshots for this model
      const modelSnaps = (snaps || []).map(s => ({
        date: s.business_date,
        rows: (s.rows || []).filter(r => (r.creator || r.name || '').toLowerCase().includes(name.toLowerCase()))
      })).filter(s => s.rows.length > 0)
      exportData.board = board || []
      exportData.revenue_snapshots = modelSnaps
      exportData.calendar = calendar || []
      exportData.videos = videos || []
      exportData.custom_content = cc || []
    } else if (role === 'chatter') {
      const [{ data: contact }, { data: snaps }, { data: shiftLogs }] = await Promise.all([
        supabase.from('chatters_contact').select('*').eq('name', name),
        supabase.from('chatter_snapshots').select('business_date, rows').order('business_date'),
        supabase.from('shift_logs').select('*').eq('display_name', name),
      ])
      const chatterSnaps = (snaps || []).map(s => ({
        date: s.business_date,
        rows: (s.rows || []).filter(r => (r.name || '').toLowerCase().includes(name.toLowerCase()))
      })).filter(s => s.rows.length > 0)
      exportData.contact = contact?.[0] || {}
      exportData.revenue_snapshots = chatterSnaps
      exportData.shift_logs = shiftLogs || []
    }

    // Download JSON
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}_export_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setOffboardStep('done')
  }

  const deleteUserData = async (user) => {
    const name = user.display_name
    const role = user.role
    if (!confirm(`ACHTUNG: Alle Daten von "${name}" werden unwiderruflich gelöscht. Fortfahren?`)) return

    if (role === 'model') {
      await Promise.all([
        supabase.from('model_board').delete().eq('model_name', name),
        supabase.from('model_board_activity').delete().eq('model_name', name),
        supabase.from('model_calendar').delete().eq('model_name', name),
        supabase.from('model_videos').delete().eq('model_name', name),
        supabase.from('custom_content').delete().eq('model_name', name),
        supabase.from('content_requests').delete().eq('model_name', name),
        supabase.from('model_aliases').delete().eq('model_name', name),
        supabase.from('models_contact').delete().eq('name', name),
        supabase.from('online_status').delete().eq('display_name', name),
      ])
    } else if (role === 'chatter') {
      await Promise.all([
        supabase.from('chatters_contact').delete().eq('name', name),
        supabase.from('shift_logs').delete().eq('display_name', name),
        supabase.from('online_status').delete().eq('display_name', name),
        supabase.from('reminders').delete().eq('chatter_name', name),
        supabase.from('absences').delete().eq('chatter_name', name),
        supabase.from('chatter_aliases').delete().eq('chatter_name', name),
        supabase.from('content_requests').delete().eq('chatter_name', name),
        supabase.from('notes').delete().ilike('text', `%${name}%`),
      ])
    }

    // Remove from user_roles
    await supabase.from('user_roles').delete().eq('user_id', user.user_id)
    setOffboardingUser(null)
    loadUsers()
  }

  const loadBotMessages = async () => {
    const { data } = await supabase.from('bot_settings').select('*')
    if (data?.length > 0) {
      const map = { ...DEFAULT_BOT_MESSAGES }
      for (const item of data) map[item.key] = item.value
      setBotMessages(map)
    }
  }

  const sendInvite = async () => {
    if (!email.trim() || !displayName.trim()) return
    setSending(true); setError(''); setSuccess('')
    try {
      const resp = await fetch(`https://xdchyruasjxvrjduchoc.supabase.co/functions/v1/invite-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), display_name: displayName.trim(), role }),
      })
      const data = await resp.json()
      if (data.ok) {
        // Auto-create contact entry based on role
        if (role === 'chatter') {
          await supabase.from('chatters_contact').upsert({ name: displayName.trim() }, { onConflict: 'name' })
        } else if (role === 'model') {
          await supabase.from('models_contact').upsert({ name: displayName.trim() }, { onConflict: 'name' })
        }
        setSuccess(`Einladung an ${email} gesendet!`)
        setEmail(''); setDisplayName('')
        loadUsers()
      } else {
        setError(data.error || 'Fehler beim Einladen')
      }
    } catch (e) {
      setError(`Fehler: ${e.message}`)
    }
    setSending(false)
  }

  const toggleRole = async (userId, currentRole, newRole) => {
    // Get current roles array
    const user = users.find(u => u.user_id === userId)
    const currentRoles = user?.roles || [currentRole]
    let updatedRoles
    if (currentRoles.includes(newRole)) {
      updatedRoles = currentRoles.filter(r => r !== newRole)
      if (updatedRoles.length === 0) updatedRoles = ['chatter'] // min 1 role
    } else {
      updatedRoles = [...currentRoles, newRole]
    }
    // Primary role = first in array
    const primaryRole = updatedRoles[0]
    await supabase.from('user_roles').update({ role: primaryRole, roles: updatedRoles }).eq('user_id', userId)
    setEditingRole(null)
    loadUsers()
  }

  const deleteUser = async (userId, name) => {
    if (!confirm(`${name} wirklich entfernen?`)) return
    await supabase.from('user_roles').delete().eq('user_id', userId)
    loadUsers()
  }

  const offboardUser = async (userId, name, role) => {
    if (!confirm(`Offboarding für ${name} starten?\n\nDies exportiert alle Daten und löscht dann alles aus dem System.`)) return

    setOffboarding(name)

    try {
      // Collect all data for export
      const exportData = { name, role, exportedAt: new Date().toISOString() }

      if (role === 'model') {
        const [{ data: board }, { data: snaps }, { data: videos }, { data: calendar }, { data: cc }] = await Promise.all([
          supabase.from('model_board').select('*').eq('model_name', name),
          supabase.from('model_snapshots').select('business_date, rows').order('business_date'),
          supabase.from('model_videos').select('*').eq('model_name', name),
          supabase.from('model_calendar').select('*').eq('model_name', name),
          supabase.from('custom_content').select('*').eq('model_name', name),
        ])
        // Filter snapshots for this model
        const modelSnaps = (snaps || []).map(s => ({
          date: s.business_date,
          data: (s.rows || []).filter(r => (r.creator || r.name || '').toLowerCase().includes(name.toLowerCase()))
        })).filter(s => s.data.length > 0)

        exportData.board = board || []
        exportData.snapshots = modelSnaps
        exportData.videos = videos || []
        exportData.calendar = calendar || []
        exportData.customContent = cc || []
      } else if (role === 'chatter') {
        const [{ data: snaps }, { data: shiftLogs }, { data: notes }] = await Promise.all([
          supabase.from('chatter_snapshots').select('business_date, rows').order('business_date'),
          supabase.from('shift_logs').select('*').eq('display_name', name),
          supabase.from('notes').select('*').ilike('text', `%${name}%`),
        ])
        const chatterSnaps = (snaps || []).map(s => ({
          date: s.business_date,
          data: (s.rows || []).filter(r => (r.name || '').toLowerCase() === name.toLowerCase())
        })).filter(s => s.data.length > 0)

        exportData.snapshots = chatterSnaps
        exportData.shiftLogs = shiftLogs || []
        exportData.notes = notes || []
      }

      // Download JSON
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `offboarding_${name.replace(/\s/g, '_')}_${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)

      // Wait a moment then delete
      await new Promise(r => setTimeout(r, 1000))

      if (confirm(`Export fertig! Jetzt alle Daten von ${name} löschen?`)) {
        if (role === 'model') {
          await Promise.all([
            supabase.from('model_board').delete().eq('model_name', name),
            supabase.from('model_videos').delete().eq('model_name', name),
            supabase.from('model_calendar').delete().eq('model_name', name),
            supabase.from('custom_content').delete().eq('model_name', name),
            supabase.from('model_board_activity').delete().eq('model_name', name),
            supabase.from('models_contact').delete().eq('name', name),
            supabase.from('model_aliases').delete().eq('model_name', name),
            supabase.from('content_requests').delete().eq('model_name', name),
          ])
        } else if (role === 'chatter') {
          await Promise.all([
            supabase.from('shift_logs').delete().eq('display_name', name),
            supabase.from('online_status').delete().eq('display_name', name),
            supabase.from('chatters_contact').delete().eq('name', name),
            supabase.from('chatter_aliases').delete().eq('chatter_name', name),
            supabase.from('reminders').delete().eq('chatter_name', name),
            supabase.from('absences').delete().eq('chatter_name', name),
            supabase.from('content_requests').delete().eq('chatter_name', name),
          ])
        }
        // Remove from user_roles
        await supabase.from('user_roles').delete().eq('user_id', userId)
        alert(`${name} wurde vollständig aus dem System entfernt.`)
        loadUsers()
      }
    } catch (e) {
      alert('Fehler beim Offboarding: ' + e.message)
    }
    setOffboarding(null)
  }

  const saveBotMessage = async (key, value) => {
    setSavingMsg(true)
    await supabase.from('bot_settings').upsert({ key, value }, { onConflict: 'key' })
    setBotMessages(prev => ({ ...prev, [key]: value }))
    setEditingMsg(null); setSavingMsg(false)
  }

  const resetBotMessage = async (key) => {
    await supabase.from('bot_settings').delete().eq('key', key)
    setBotMessages(prev => ({ ...prev, [key]: DEFAULT_BOT_MESSAGES[key] }))
    setEditingMsg(null)
  }

  const addModelAlias = async () => {
    if (!newMA.model_name || !newMA.csv_name.trim()) return
    await supabase.from('model_aliases').insert(newMA)
    setNewMA({ model_name: '', csv_name: '', alias_label: '' }); loadModelAliases()
  }

  const addChatterAlias = async () => {
    if (!newCA.chatter_name || !newCA.csv_name.trim()) return
    await supabase.from('chatter_aliases').insert(newCA)
    if (newCA.telegram_id) await supabase.from('chatters_contact').update({ telegram_id: newCA.telegram_id }).eq('name', newCA.chatter_name)
    setNewCA({ chatter_name: '', csv_name: '', telegram_id: '' }); loadChatterAliases()
  }

  const cardS = { background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '16px 18px' }
  const inputS = { background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none', width: '100%' }
  const labelS = { fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 10 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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

      {activeSection === 'billing' && <BillingTab />}

      {/* SURVEYS */}
      {activeSection === 'surveys' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 680 }}>

          {/* Create new */}
          <div style={cardS}>
            <div style={labelS}>Neue Umfrage erstellen</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Frage</label>
                <input value={newQuestion} onChange={e => setNewQuestion(e.target.value)} placeholder="z.B. Wie war der Traffic heute um 22 Uhr?" style={inputS} />
              </div>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Antworttyp</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[['choice', 'Auswahl'], ['scale', 'Skala 1-5'], ['text', 'Freitext']].map(([k, l]) => (
                    <button key={k} onClick={() => setNewAnswerType(k)} style={{
                      padding: '5px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 12,
                      background: newAnswerType === k ? '#7c3aed22' : 'transparent',
                      color: newAnswerType === k ? '#a78bfa' : 'var(--text-muted)',
                      border: `1px solid ${newAnswerType === k ? '#7c3aed' : 'var(--border)'}`,
                    }}>{l}</button>
                  ))}
                </div>
              </div>
              {newAnswerType === 'choice' && (
                <div>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Antwortoptionen</label>
                  {newOptions.map((opt, i) => (
                    <input key={i} value={opt} onChange={e => { const o = [...newOptions]; o[i] = e.target.value; setNewOptions(o) }}
                      placeholder={`Option ${i + 1}`} style={{ ...inputS, marginBottom: 6 }} />
                  ))}
                  <button onClick={() => setNewOptions([...newOptions, ''])} style={{ fontSize: 11, color: 'var(--text-muted)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>+ Option</button>
                </div>
              )}
              <div>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Empfänger</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {[['chatter', 'Alle Chatters', '#06b6d4'], ['model', 'Alle Models', '#f59e0b']].map(([k, l, c]) => {
                    const active = newTargetRoles.includes(k)
                    return (
                      <button key={k} onClick={() => setNewTargetRoles(prev => active ? prev.filter(r => r !== k) : [...prev, k])} style={{
                        padding: '5px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 12,
                        background: active ? c + '22' : 'transparent', color: active ? c : 'var(--text-muted)',
                        border: `1px solid ${active ? c : 'var(--border)'}`,
                      }}>{active ? '✓ ' : ''}{l}</button>
                    )
                  })}
                </div>
              </div>
              <button onClick={createSurvey} disabled={creatingsurvey || !newQuestion.trim() || newTargetRoles.length === 0}
                style={{ padding: '9px', borderRadius: 7, background: newQuestion && newTargetRoles.length > 0 ? '#7c3aed' : 'var(--border)', color: newQuestion && newTargetRoles.length > 0 ? '#fff' : 'var(--text-muted)', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                {creatingsurvey ? '...' : '+ Umfrage erstellen'}
              </button>
            </div>
          </div>

          {/* Existing surveys */}
          {surveys.map(s => {
            const responses = surveyResponses.filter(r => r.survey_id === s.id)
            const isExpanded = expandedSurvey === s.id
            return (
              <div key={s.id} style={{ ...cardS, borderLeft: `3px solid ${s.active ? '#10b981' : '#555580'}`, borderRadius: '0 10px 10px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: s.active ? 'rgba(16,185,129,0.15)' : 'rgba(100,100,120,0.15)', color: s.active ? '#10b981' : 'var(--text-muted)' }}>
                        {s.active ? 'AKTIV' : 'GESCHLOSSEN'}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{s.answer_type} · {(s.target_roles || []).join(', ')}</span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{s.question}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{responses.length} Antwort{responses.length !== 1 ? 'en' : ''}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button onClick={() => setExpandedSurvey(isExpanded ? null : s.id)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                      {isExpanded ? 'Schliessen' : 'Antworten'}
                    </button>
                    {s.active ? (
                      <button onClick={() => closeSurvey(s.id)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', color: 'rgba(239,68,68,0.7)', cursor: 'pointer', fontFamily: 'inherit' }}>Beenden</button>
                    ) : (
                      <button onClick={() => reopenSurvey(s.id)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: 'transparent', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', cursor: 'pointer', fontFamily: 'inherit' }}>Reaktivieren</button>
                    )}
                    <button onClick={() => deleteSurvey(s.id)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: 'transparent', border: '1px solid rgba(239,68,68,0.2)', color: 'rgba(239,68,68,0.4)', cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                  </div>
                </div>
                {isExpanded && responses.length > 0 && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #1e1e3a', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {responses.map(r => (
                      <div key={r.id} style={{ display: 'flex', gap: 10, padding: '7px 10px', background: 'var(--bg-card2)', borderRadius: 7 }}>
                        <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(124,58,237,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#a78bfa', flexShrink: 0 }}>{r.responder_name[0]}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{r.responder_name}</span>
                            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{new Date(r.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <div style={{ fontSize: 12, color: '#a78bfa', fontWeight: 600 }}>{r.answer}</div>
                          {r.comment && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{r.comment}</div>}
                        </div>
                      </div>
                    ))}
                    {isExpanded && responses.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 12 }}>Noch keine Antworten</div>}
                  </div>
                )}
              </div>
            )
          })}
          {surveys.length === 0 && <div style={{ ...cardS, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 30 }}>Noch keine Umfragen</div>}
        </div>
      )}

      {/* TEAM */}
      {activeSection === 'team' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 680 }}>

          {/* Rollen-Übersicht */}
          <div style={cardS}>
            <div style={labelS}>Rollen & Zugriffe</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {ROLES.map(r => (
                <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'var(--bg-card2)', borderRadius: 7, border: '1px solid #1e1e3a' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: r.color, background: r.color + '22', padding: '2px 8px', borderRadius: 4, minWidth: 90, textAlign: 'center' }}>{r.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Einladen */}
          <div style={cardS}>
            <div style={labelS}>Neues Mitglied einladen</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Name</label>
                  <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="z.B. Noa" style={inputS} />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>E-Mail</label>
                  <input value={email} onChange={e => setEmail(e.target.value)} placeholder="noa@example.com" type="email" style={inputS} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {ROLES.map(r => (
                  <button key={r.key} onClick={() => setRole(r.key)} style={{
                    padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 11,
                    background: role === r.key ? r.color + '22' : 'transparent',
                    color: role === r.key ? r.color : 'var(--text-muted)',
                    border: `1px solid ${role === r.key ? r.color : 'var(--border)'}`,
                  }}>{r.label}</button>
                ))}
              </div>
              <button onClick={sendInvite} disabled={sending || !email || !displayName}
                style={{ padding: '9px', borderRadius: 7, background: email && displayName ? '#7c3aed' : 'var(--border)', color: email && displayName ? '#fff' : 'var(--text-muted)', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                {sending ? '⏳ Wird gesendet...' : '✉ Einladung senden'}
              </button>
              {success && <div style={{ fontSize: 12, color: '#10b981', padding: '8px 12px', background: 'rgba(16,185,129,0.1)', borderRadius: 7, border: '1px solid rgba(16,185,129,0.3)' }}>{success}</div>}
              {error && <div style={{ fontSize: 12, color: '#ef4444', padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 7, border: '1px solid rgba(239,68,68,0.3)' }}>{error}</div>}
            </div>
          </div>

          {/* Mitglieder */}
          <div style={cardS}>
            <div style={labelS}>Aktuelle Mitglieder ({users.length})</div>
            {users.map(u => {
              const rc = ROLES.find(r => r.key === u.role)
              const color = rc?.color || '#555580'
              return (
                <div key={u.user_id} style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', background: 'var(--bg-card2)', borderRadius: editingRole === u.user_id ? '8px 8px 0 0' : 8, border: `1px solid ${editingRole === u.user_id ? color : '#1e1e3a'}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color }}>{(u.display_name || '?')[0]}</div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{u.display_name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{u.user_id.slice(0, 10)}...</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                      {(u.roles && u.roles.length > 0 ? u.roles : [u.role]).map(r => {
                        const rc2 = ROLES.find(x => x.key === r)
                        return <span key={r} style={{ fontSize: 10, fontWeight: 700, color: rc2?.color || color, background: (rc2?.color || color) + '22', padding: '2px 8px', borderRadius: 4 }}>{rc2?.label || r}</span>
                      })}
                      <button onClick={() => setEditingRole(editingRole === u.user_id ? null : u.user_id)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>✎</button>
                      <button onClick={() => startOffboarding(u)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', color: 'rgba(239,68,68,0.6)', cursor: 'pointer', fontFamily: 'inherit' }}>Offboard</button>
                    </div>
                  </div>
                  {editingRole === u.user_id && (
                    <div style={{ background: 'var(--bg-card)', border: `1px solid ${color}`, borderTop: 'none', borderRadius: '0 0 8px 8px', padding: '10px 12px' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>Mehrere Rollen möglich – klicken zum an/abwählen</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {ROLES.map(r => {
                          const userRoles = u.roles || [u.role]
                          const active = userRoles.includes(r.key)
                          return (
                            <button key={r.key} onClick={() => toggleRole(u.user_id, u.role, r.key)} style={{
                              padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 11,
                              background: active ? r.color + '22' : 'transparent',
                              color: active ? r.color : 'var(--text-muted)',
                              border: `1px solid ${active ? r.color : 'var(--border)'}`,
                            }}>{active ? '✓ ' : ''}{r.label}</button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* OFFBOARDING MODAL */}
      {offboardingUser && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 14, padding: '28px 32px', width: '100%', maxWidth: 420 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(239,68,68,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#ef4444' }}>{offboardingUser.display_name[0]}</div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{offboardingUser.display_name} offboarden</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{offboardingUser.role}</div>
              </div>
            </div>

            {offboardStep === 'confirm' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  Empfohlen: Erst Daten exportieren, dann löschen.
                </div>
                <button onClick={() => exportUserData(offboardingUser)} style={{ padding: '10px', borderRadius: 8, background: '#7c3aed', color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  1. Daten exportieren (JSON)
                </button>
                <button onClick={() => deleteUserData(offboardingUser)} style={{ padding: '10px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  2. Alle Daten löschen
                </button>
                <button onClick={() => setOffboardingUser(null)} style={{ padding: '8px', borderRadius: 8, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Abbrechen
                </button>
              </div>
            )}

            {offboardStep === 'exporting' && (
              <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-secondary)', fontSize: 13 }}>
                Export wird vorbereitet...
              </div>
            )}

            {offboardStep === 'done' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 13, color: '#10b981', textAlign: 'center', padding: '10px 0' }}>
                  Export erfolgreich heruntergeladen!
                </div>
                <button onClick={() => deleteUserData(offboardingUser)} style={{ padding: '10px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Jetzt alle Daten löschen
                </button>
                <button onClick={() => setOffboardingUser(null)} style={{ padding: '8px', borderRadius: 8, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Später löschen
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* BOT */}
      {activeSection === 'bot' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 700 }}>
          <div style={{ ...cardS, marginBottom: 4 }}>
            <div style={labelS}>Verfügbare Variablen</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 2, fontFamily: 'monospace' }}>
              {['{name}','{shift}','{models}','{duration}','{date}','{time}','{until}','{kw}','{shifts}','{id}'].map(v => (
                <span key={v} style={{ marginRight: 8, background: 'var(--bg-card2)', padding: '1px 6px', borderRadius: 4, border: '1px solid #1e1e3a' }}>{v}</span>
              ))}
            </div>
          </div>
          {Object.entries(BOT_LABELS).map(([key, label]) => {
            const isEditing = editingMsg === key
            const isCustom = botMessages[key] !== DEFAULT_BOT_MESSAGES[key]
            return (
              <div key={key} style={cardS}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isEditing ? 10 : 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{label}</span>
                    {isCustom && <span style={{ fontSize: 9, color: '#f59e0b', background: 'rgba(245,158,11,0.15)', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>ANGEPASST</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {isCustom && <button onClick={() => resetBotMessage(key)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>↺</button>}
                    <button onClick={() => setEditingMsg(isEditing ? null : key)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, background: isEditing ? '#7c3aed' : 'transparent', border: `1px solid ${isEditing ? '#7c3aed' : 'var(--border)'}`, color: isEditing ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                      {isEditing ? 'Schließen' : '✎'}
                    </button>
                  </div>
                </div>
                {isEditing ? (
                  <div>
                    <textarea defaultValue={botMessages[key]} id={`msg-${key}`} rows={4}
                      style={{ ...inputS, resize: 'vertical', lineHeight: 1.6, marginBottom: 8 }} />
                    <button onClick={() => saveBotMessage(key, document.getElementById(`msg-${key}`).value)} disabled={savingMsg}
                      style={{ padding: '6px 14px', borderRadius: 6, background: '#7c3aed', color: '#fff', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {savingMsg ? '...' : '✓ Speichern'}
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace', background: 'var(--bg-card2)', padding: '8px 10px', borderRadius: 7, border: '1px solid #1e1e3a', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
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
                <select value={newMA.model_name} onChange={e => setNewMA(p => ({ ...p, model_name: e.target.value }))} style={inputS}>
                  <option value="">— wählen —</option>
                  {models.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>CSV-Name (exakt)</label>
                <input value={newMA.csv_name} onChange={e => setNewMA(p => ({ ...p, csv_name: e.target.value }))} placeholder="z.B. Elina_mj 🎮" style={inputS} />
              </div>
              <div style={{ flex: 1, minWidth: 80 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Label</label>
                <input value={newMA.alias_label} onChange={e => setNewMA(p => ({ ...p, alias_label: e.target.value }))} placeholder="MAIN" style={inputS} />
              </div>
              <button onClick={addModelAlias} disabled={!newMA.model_name || !newMA.csv_name}
                style={{ padding: '7px 14px', borderRadius: 7, background: newMA.model_name && newMA.csv_name ? '#f59e0b' : 'var(--border)', color: newMA.model_name && newMA.csv_name ? '#000' : 'var(--text-muted)', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
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
                      <button onClick={() => { supabase.from('model_aliases').delete().eq('id', a.id).then(loadModelAliases) }} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: 0 }}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {modelAliases.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>Noch keine Zuordnungen</div>}
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
                <select value={newCA.chatter_name} onChange={e => setNewCA(p => ({ ...p, chatter_name: e.target.value }))} style={inputS}>
                  <option value="">— wählen —</option>
                  {chatters.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>CSV-Name (exakt)</label>
                <input value={newCA.csv_name} onChange={e => setNewCA(p => ({ ...p, csv_name: e.target.value }))} placeholder="z.B. Kaan" style={inputS} />
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Telegram ID</label>
                <input value={newCA.telegram_id} onChange={e => setNewCA(p => ({ ...p, telegram_id: e.target.value }))} placeholder="123456789" style={inputS} />
              </div>
              <button onClick={addChatterAlias} disabled={!newCA.chatter_name || !newCA.csv_name}
                style={{ padding: '7px 14px', borderRadius: 7, background: newCA.chatter_name && newCA.csv_name ? '#06b6d4' : 'var(--border)', color: newCA.chatter_name && newCA.csv_name ? '#000' : 'var(--text-muted)', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
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
                      <button onClick={() => { supabase.from('chatter_aliases').delete().eq('id', a.id).then(loadChatterAliases) }} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: 0 }}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {chatterAliases.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>Noch keine Zuordnungen</div>}
          </div>
        </div>
      )}
    </div>
  )
}
