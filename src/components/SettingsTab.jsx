import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import BillingTab from './BillingTab'
import ExportTab from './ExportTab'

const SECTIONS = [
  { key: 'team', label: 'Team' },
  { key: 'guidelines', label: 'Guidelines' },
  { key: 'surveys', label: 'Umfragen' },
  { key: 'billing', label: 'Billing' },
  { key: 'export', label: 'Export' },
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
  { key: 'social_media', label: 'Social Media', color: '#ec4899', desc: 'Social Portal (Zusatzrolle)' },
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
  const [newMA, setNewMA] = useState({ model_name: '', csv_name: '', alias_label: '', telegram_id: '' })
  const [newCA, setNewCA] = useState({ chatter_name: '', csv_name: '', telegram_id: '' })

  // Surveys (v2.7.33: multi-question + recipient selection)
  const [surveys, setSurveys] = useState([])
  const [surveyQuestions, setSurveyQuestions] = useState([]) // alle Fragen aller Surveys (für Anzeige)
  const [surveyRecipients, setSurveyRecipients] = useState([]) // alle Recipients aller Surveys
  const [surveyResponses, setSurveyResponses] = useState([])
  const [newSurveyTitle, setNewSurveyTitle] = useState('')
  const [newSurveyQuestions, setNewSurveyQuestions] = useState([
    { question: '', answer_type: 'choice', options: ['', '', ''] },
  ])
  const [activeQIdx, setActiveQIdx] = useState(0)
  const [newRecipientNames, setNewRecipientNames] = useState([]) // ["Lukas", "Sandra", ...]
  const [creatingSurvey, setCreatingSurvey] = useState(false)
  const [expandedSurvey, setExpandedSurvey] = useState(null)

  useEffect(() => {
    loadUsers(); loadModels(); loadChatters()
    loadModelAliases(); loadChatterAliases(); loadBotMessages()
    loadSurveys()
  }, [])

  const loadUsers = async () => { const { data } = await supabase.from('user_roles').select('*').order('role'); setUsers(data || []) }
  const loadModels = async () => { const { data } = await supabase.from('models_contact').select('name, telegram_id, in_schedule').order('name'); setModels(data || []) }
  const loadChatters = async () => { const { data } = await supabase.from('chatters_contact').select('name').order('name'); setChatters(data || []) }
  const loadModelAliases = async () => { const { data } = await supabase.from('model_aliases').select('*').order('model_name'); setModelAliases(data || []) }
  const loadModelTelegramIds = async () => { const { data } = await supabase.from('models_contact').select('name, telegram_id'); return data || [] }
  const loadChatterAliases = async () => { const { data } = await supabase.from('chatter_aliases').select('*').order('chatter_name'); setChatterAliases(data || []) }

  const loadSurveys = async () => {
    const { data } = await supabase.from('surveys').select('*').order('created_at', { ascending: false })
    setSurveys(data || [])
    const ids = (data || []).map(s => s.id)
    if (ids.length === 0) {
      setSurveyQuestions([]); setSurveyRecipients([]); setSurveyResponses([])
      return
    }
    const [{ data: qs }, { data: recs }, { data: resp }] = await Promise.all([
      supabase.from('survey_questions').select('*').in('survey_id', ids).order('position'),
      supabase.from('survey_recipients').select('*').in('survey_id', ids),
      supabase.from('survey_responses').select('*').in('survey_id', ids).order('created_at', { ascending: false }),
    ])
    setSurveyQuestions(qs || [])
    setSurveyRecipients(recs || [])
    setSurveyResponses(resp || [])
  }

  // Helpers für Frage-Editor
  const addQuestion = () => {
    setNewSurveyQuestions(prev => [...prev, { question: '', answer_type: 'choice', options: ['', '', ''] }])
    setActiveQIdx(newSurveyQuestions.length)
  }
  const removeQuestion = (idx) => {
    if (newSurveyQuestions.length === 1) return
    const next = newSurveyQuestions.filter((_, i) => i !== idx)
    setNewSurveyQuestions(next)
    setActiveQIdx(Math.max(0, Math.min(activeQIdx, next.length - 1)))
  }
  const updateQuestion = (idx, patch) => {
    setNewSurveyQuestions(prev => prev.map((q, i) => i === idx ? { ...q, ...patch } : q))
  }
  const updateOption = (qIdx, oIdx, val) => {
    setNewSurveyQuestions(prev => prev.map((q, i) => {
      if (i !== qIdx) return q
      const opts = [...(q.options || [])]
      opts[oIdx] = val
      return { ...q, options: opts }
    }))
  }
  const addOption = (qIdx) => {
    setNewSurveyQuestions(prev => prev.map((q, i) =>
      i === qIdx ? { ...q, options: [...(q.options || []), ''] } : q))
  }

  // Empfänger-Helpers
  const toggleRecipient = (name) => {
    setNewRecipientNames(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name])
  }
  const selectAllChatters = () => {
    const names = chatters.map(c => c.name)
    setNewRecipientNames(prev => Array.from(new Set([...prev, ...names])))
  }
  const selectAllModels = () => {
    const names = models.map(m => m.name)
    setNewRecipientNames(prev => Array.from(new Set([...prev, ...names])))
  }
  const clearRecipients = () => setNewRecipientNames([])

  const createSurvey = async () => {
    if (creatingSurvey) return // Double-Click-Schutz
    const validQuestions = newSurveyQuestions.filter(q => q.question.trim())
    if (validQuestions.length === 0 || newRecipientNames.length === 0) return
    setCreatingSurvey(true)

    // 1. Survey anlegen (title als Hauptbezeichner; question = erste Frage für Rückwärtskompat.)
    const title = newSurveyTitle.trim() || validQuestions[0].question.trim().slice(0, 60)
    const { data: created, error } = await supabase.from('surveys').insert({
      title,
      question: validQuestions[0].question.trim(),
      answer_type: validQuestions[0].answer_type,
      options: validQuestions[0].answer_type === 'choice'
        ? validQuestions[0].options.filter(o => o.trim()) : [],
      target_roles: [],
      active: true,
      created_by: 'Admin',
    }).select().single()

    if (error || !created) { setCreatingSurvey(false); alert('Fehler beim Anlegen: ' + (error?.message || 'unbekannt')); return }

    // 2. Fragen
    const qRows = validQuestions.map((q, idx) => ({
      survey_id: created.id,
      question: q.question.trim(),
      answer_type: q.answer_type,
      options: q.answer_type === 'choice' ? q.options.filter(o => o.trim()) : [],
      position: idx,
    }))
    const { error: qErr } = await supabase.from('survey_questions').insert(qRows)
    if (qErr) {
      // Rollback: Survey wieder löschen damit nicht halb-fertige Umfragen rumliegen
      await supabase.from('surveys').delete().eq('id', created.id)
      setCreatingSurvey(false)
      alert('Fehler beim Speichern der Fragen: ' + qErr.message)
      return
    }

    // 3. Empfänger
    const chatterSet = new Set(chatters.map(c => c.name))
    const recRows = newRecipientNames.map(name => ({
      survey_id: created.id,
      recipient_name: name,
      recipient_role: chatterSet.has(name) ? 'chatter' : 'model',
    }))
    const { error: rErr } = await supabase.from('survey_recipients').insert(recRows)
    if (rErr) {
      // Rollback survey + questions (questions per cascade)
      await supabase.from('surveys').delete().eq('id', created.id)
      setCreatingSurvey(false)
      alert('Fehler beim Speichern der Empfänger: ' + rErr.message)
      return
    }

    // Reset
    setNewSurveyTitle('')
    setNewSurveyQuestions([{ question: '', answer_type: 'choice', options: ['', '', ''] }])
    setActiveQIdx(0)
    setNewRecipientNames([])
    await loadSurveys()
    setCreatingSurvey(false)
  }

  const closeSurvey = async (id) => { await supabase.from('surveys').update({ active: false }).eq('id', id); loadSurveys() }
  const reopenSurvey = async (id) => { await supabase.from('surveys').update({ active: true }).eq('id', id); loadSurveys() }
  const deleteSurvey = async (id) => {
    if (!confirm('Umfrage und alle Antworten löschen?')) return
    // CASCADE kümmert sich um questions, recipients, responses (FK ON DELETE CASCADE)
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
    await supabase.from('model_aliases').insert({ model_name: newMA.model_name, csv_name: newMA.csv_name, alias_label: newMA.alias_label })
    if (newMA.telegram_id) await supabase.from('models_contact').update({ telegram_id: newMA.telegram_id.trim() }).eq('name', newMA.model_name)
    setNewMA({ model_name: '', csv_name: '', alias_label: '', telegram_id: '' }); loadModelAliases()
  }

  const createNewModel = async () => {
    const name = prompt('Name des neuen Models (so wie er in models_contact stehen soll, z.B. "Sophi"):')
    if (!name || !name.trim()) return
    const trimmed = name.trim()
    const { error } = await supabase.from('models_contact').upsert({ name: trimmed, in_schedule: true }, { onConflict: 'name' })
    if (error) {
      alert('Fehler beim Anlegen: ' + error.message)
      return
    }
    await loadModels()
    alert(`Model "${trimmed}" wurde angelegt. Du kannst jetzt CSV-Aliases zuordnen.`)
  }

  const toggleInSchedule = async (modelName, current) => {
    await supabase.from('models_contact').update({ in_schedule: !current }).eq('name', modelName)
    await loadModels()
  }

  const addChatterAlias = async () => {
    if (!newCA.chatter_name || !newCA.csv_name.trim()) return
    await supabase.from('chatter_aliases').insert(newCA)
    if (newCA.telegram_id) await supabase.from('chatters_contact').update({ telegram_id: newCA.telegram_id.trim() }).eq('name', newCA.chatter_name)
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
      {activeSection === 'export' && <ExportTab />}

      {/* GUIDELINES — Admin-Editor (v3.2.0) */}
      {activeSection === 'guidelines' && <GuidelinesEditor cardS={cardS} inputS={inputS} labelS={labelS} />}

      {/* SURVEYS */}
      {activeSection === 'surveys' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 }}>

          {/* Create new */}
          <div style={cardS}>
            <div style={labelS}>Neue Umfrage erstellen</div>

            {/* Titel */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Titel der Umfrage</label>
              <input value={newSurveyTitle} onChange={e => setNewSurveyTitle(e.target.value)} placeholder="z.B. Wochen-Feedback KW 18" style={inputS} />
            </div>

            {/* Fragen-Tabs */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              {newSurveyQuestions.map((q, i) => {
                const active = activeQIdx === i
                const filled = (q.question || '').trim().length > 0
                return (
                  <button key={i} onClick={() => setActiveQIdx(i)} style={{
                    padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 12,
                    background: active ? '#7c3aed22' : 'transparent',
                    color: active ? '#a78bfa' : (filled ? 'var(--text-secondary)' : 'var(--text-muted)'),
                    border: `1px solid ${active ? '#7c3aed' : 'var(--border)'}`,
                  }}>Frage {i + 1}{!filled && ' …'}</button>
                )
              })}
              <button onClick={addQuestion} style={{
                padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 12,
                background: 'transparent', color: '#a78bfa', border: '1px dashed rgba(124,58,237,0.5)',
              }}>+ Frage</button>
            </div>

            {/* Aktive Frage */}
            <div style={{ background: 'var(--bg-card2)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 10 }}>
                <input
                  value={newSurveyQuestions[activeQIdx]?.question || ''}
                  onChange={e => updateQuestion(activeQIdx, { question: e.target.value })}
                  placeholder={`Frage ${activeQIdx + 1} eingeben…`}
                  style={{ ...inputS, flex: 1 }}
                />
                {newSurveyQuestions.length > 1 && (
                  <button onClick={() => removeQuestion(activeQIdx)} style={{
                    fontSize: 11, padding: '6px 10px', borderRadius: 6,
                    background: 'transparent', border: '1px solid rgba(239,68,68,0.3)',
                    color: 'rgba(239,68,68,0.8)', cursor: 'pointer', fontFamily: 'inherit',
                  }}>✕ Löschen</button>
                )}
              </div>

              <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Antworttyp</label>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                {[['choice', 'Auswahl'], ['scale', 'Skala 1-5'], ['text', 'Freitext']].map(([k, l]) => {
                  const active = newSurveyQuestions[activeQIdx]?.answer_type === k
                  return (
                    <button key={k} onClick={() => updateQuestion(activeQIdx, { answer_type: k })} style={{
                      padding: '5px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 12,
                      background: active ? '#7c3aed22' : 'transparent',
                      color: active ? '#a78bfa' : 'var(--text-muted)',
                      border: `1px solid ${active ? '#7c3aed' : 'var(--border)'}`,
                    }}>{l}</button>
                  )
                })}
              </div>

              {newSurveyQuestions[activeQIdx]?.answer_type === 'choice' && (
                <div>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Antwortoptionen</label>
                  {(newSurveyQuestions[activeQIdx]?.options || []).map((opt, i) => (
                    <input key={i} value={opt} onChange={e => updateOption(activeQIdx, i, e.target.value)}
                      placeholder={`Option ${i + 1}`} style={{ ...inputS, marginBottom: 6 }} />
                  ))}
                  <button onClick={() => addOption(activeQIdx)} style={{ fontSize: 11, color: 'var(--text-muted)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>+ Option</button>
                </div>
              )}
              {newSurveyQuestions[activeQIdx]?.answer_type === 'scale' && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>User wählt eine Zahl von 1 bis 5.</div>
              )}
              {newSurveyQuestions[activeQIdx]?.answer_type === 'text' && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>User schreibt frei. Optional (keine Pflicht).</div>
              )}
            </div>

            {/* Empfänger */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  Empfänger {newRecipientNames.length > 0 && <span style={{ color: '#a78bfa', fontWeight: 700 }}>· {newRecipientNames.length} ausgewählt</span>}
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={selectAllChatters} style={{
                    fontSize: 10, padding: '3px 8px', borderRadius: 5,
                    background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.3)',
                    color: '#06b6d4', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                  }}>+ Alle Chatters</button>
                  <button onClick={selectAllModels} style={{
                    fontSize: 10, padding: '3px 8px', borderRadius: 5,
                    background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)',
                    color: '#f59e0b', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                  }}>+ Alle Models</button>
                  {newRecipientNames.length > 0 && (
                    <button onClick={clearRecipients} style={{
                      fontSize: 10, padding: '3px 8px', borderRadius: 5,
                      background: 'transparent', border: '1px solid var(--border)',
                      color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit',
                    }}>Zurücksetzen</button>
                  )}
                </div>
              </div>

              {/* Chatter-Liste */}
              {chatters.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 700, letterSpacing: 0.5 }}>CHATTERS</div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {chatters.map(c => {
                      const active = newRecipientNames.includes(c.name)
                      return (
                        <button key={c.name} onClick={() => toggleRecipient(c.name)} style={{
                          padding: '4px 10px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
                          fontWeight: 600, fontSize: 11,
                          background: active ? 'rgba(6,182,212,0.18)' : 'transparent',
                          color: active ? '#06b6d4' : 'var(--text-muted)',
                          border: `1px solid ${active ? '#06b6d4' : 'var(--border)'}`,
                        }}>{active ? '✓ ' : ''}{c.name}</button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Model-Liste */}
              {models.length > 0 && (
                <div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 700, letterSpacing: 0.5 }}>MODELS</div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {models.map(m => {
                      const active = newRecipientNames.includes(m.name)
                      return (
                        <button key={m.name} onClick={() => toggleRecipient(m.name)} style={{
                          padding: '4px 10px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
                          fontWeight: 600, fontSize: 11,
                          background: active ? 'rgba(245,158,11,0.18)' : 'transparent',
                          color: active ? '#f59e0b' : 'var(--text-muted)',
                          border: `1px solid ${active ? '#f59e0b' : 'var(--border)'}`,
                        }}>{active ? '✓ ' : ''}{m.name}</button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Submit */}
            {(() => {
              const validQs = newSurveyQuestions.filter(q => q.question.trim()).length
              const ready = validQs > 0 && newRecipientNames.length > 0
              return (
                <button onClick={createSurvey} disabled={creatingSurvey || !ready} style={{
                  padding: '10px', borderRadius: 7,
                  background: ready ? '#7c3aed' : 'var(--border)',
                  color: ready ? '#fff' : 'var(--text-muted)',
                  border: 'none', fontSize: 13, fontWeight: 700,
                  cursor: ready ? 'pointer' : 'not-allowed', fontFamily: 'inherit', width: '100%',
                }}>
                  {creatingSurvey ? '…' : `Umfrage erstellen (${validQs} Frage${validQs !== 1 ? 'n' : ''} · ${newRecipientNames.length} Empfänger)`}
                </button>
              )
            })()}
          </div>

          {/* Existing surveys */}
          {surveys.map(s => {
            const sQuestions = surveyQuestions.filter(q => q.survey_id === s.id)
            const sRecipients = surveyRecipients.filter(r => r.survey_id === s.id)
            const responses = surveyResponses.filter(r => r.survey_id === s.id)
            const isExpanded = expandedSurvey === s.id
            // Wer hat geantwortet (= mind. eine Antwort gegeben)?
            const responderSet = new Set(responses.map(r => r.responder_name))
            const completionPct = sRecipients.length > 0
              ? Math.round((responderSet.size / sRecipients.length) * 100)
              : 0
            return (
              <div key={s.id} style={{ ...cardS, borderLeft: `3px solid ${s.active ? '#10b981' : '#555580'}`, borderRadius: '0 10px 10px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: s.active ? 'rgba(16,185,129,0.15)' : 'rgba(100,100,120,0.15)', color: s.active ? '#10b981' : 'var(--text-muted)' }}>
                        {s.active ? 'AKTIV' : 'GESCHLOSSEN'}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {sQuestions.length} Frage{sQuestions.length !== 1 ? 'n' : ''} · {sRecipients.length} Empfänger
                      </span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{s.title || s.question}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {responderSet.size} von {sRecipients.length} geantwortet ({completionPct}%)
                    </div>
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

                {isExpanded && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #1e1e3a' }}>
                    {/* Empfänger-Liste mit Status */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: 0.5, marginBottom: 6 }}>EMPFÄNGER</div>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {sRecipients.map(r => {
                          const done = responderSet.has(r.recipient_name)
                          return (
                            <span key={r.id} style={{
                              fontSize: 10, padding: '3px 8px', borderRadius: 5,
                              background: done ? 'rgba(16,185,129,0.15)' : 'rgba(100,100,120,0.1)',
                              color: done ? '#10b981' : 'var(--text-muted)',
                              border: `1px solid ${done ? 'rgba(16,185,129,0.3)' : 'var(--border)'}`,
                              fontWeight: 600,
                            }}>{done ? '✓ ' : '○ '}{r.recipient_name}</span>
                          )
                        })}
                      </div>
                    </div>

                    {/* Antworten gruppiert pro Frage */}
                    {sQuestions.map((q, qIdx) => {
                      const qResponses = responses.filter(r => r.question_id === q.id)
                      return (
                        <div key={q.id} style={{ marginBottom: 14, padding: 10, background: 'var(--bg-card2)', borderRadius: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
                            <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>{qIdx + 1}.</span>
                            {q.question}
                            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 6, fontWeight: 400 }}>
                              · {q.answer_type === 'choice' ? 'Auswahl' : q.answer_type === 'scale' ? 'Skala' : 'Freitext'}
                            </span>
                          </div>
                          {qResponses.length === 0 ? (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>Noch keine Antworten</div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {qResponses.map(r => (
                                <div key={r.id} style={{ display: 'flex', gap: 8, padding: '5px 8px', background: 'var(--bg-card)', borderRadius: 6 }}>
                                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'rgba(124,58,237,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#a78bfa', flexShrink: 0 }}>{(r.responder_name || '?')[0]}</div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 1, flexWrap: 'wrap' }}>
                                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>{r.responder_name}</span>
                                      <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                                        {new Date(r.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                      </span>
                                    </div>
                                    <div style={{ fontSize: 12, color: '#a78bfa', fontWeight: 600 }}>{r.answer || '(leer)'}</div>
                                    {r.comment && <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{r.comment}</div>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={labelS}>Models verwalten</div>
              <button onClick={createNewModel} style={{ padding: '6px 14px', borderRadius: 7, background: '#10b981', color: '#fff', border: 'none', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                + Neues Model anlegen
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Lege ein neues Model an bevor du CSV-Aliases zuordnest. Mit dem 📋-Toggle steuerst du ob es im Dienstplan auftaucht.
            </div>
          </div>
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
              <div style={{ flex: 1, minWidth: 100 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Telegram ID</label>
                <input value={newMA.telegram_id} onChange={e => setNewMA(p => ({ ...p, telegram_id: e.target.value }))} placeholder="123456789" style={inputS} />
              </div>
              <button onClick={addModelAlias} disabled={!newMA.model_name || !newMA.csv_name}
                style={{ padding: '7px 14px', borderRadius: 7, background: newMA.model_name && newMA.csv_name ? '#f59e0b' : 'var(--border)', color: newMA.model_name && newMA.csv_name ? '#000' : 'var(--text-muted)', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                + Hinzufügen
              </button>
            </div>
          </div>
          <div style={cardS}>
            <div style={labelS}>Bestehende Zuordnungen</div>
            {models.map(m => (
              <div key={m.name} style={{ marginBottom: 12, opacity: m.in_schedule === false ? 0.55 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b' }}>{m.name}</span>
                  {m.telegram_id && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>· TG: {m.telegram_id}</span>}
                  <button onClick={async () => {
                    const id = prompt(`Telegram ID für ${m.name}:`, m.telegram_id || '')
                    if (id !== null) { await supabase.from('models_contact').update({ telegram_id: id.trim() || null }).eq('name', m.name); loadModels() }
                  }} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>✎ TG</button>
                  <button onClick={() => toggleInSchedule(m.name, m.in_schedule !== false)}
                    title={m.in_schedule === false ? 'Aktivieren: Model wird wieder im Dienstplan angezeigt' : 'Deaktivieren: Model verschwindet aus dem Dienstplan'}
                    style={{
                      fontSize: 9, padding: '2px 8px', borderRadius: 3,
                      background: m.in_schedule === false ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)',
                      color: m.in_schedule === false ? 'var(--red)' : 'var(--green)',
                      border: `1px solid ${m.in_schedule === false ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}`,
                      cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700
                    }}>
                    {m.in_schedule === false ? '📋 Nicht im Plan' : '📋 Im Plan'}
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {modelAliases.filter(a => a.model_name === m.name).map(a => (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{a.csv_name}</span>
                      {a.alias_label && <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>· {a.alias_label}</span>}
                      <button onClick={() => { supabase.from('model_aliases').delete().eq('id', a.id).then(loadModelAliases) }} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: 0 }}>✕</button>
                    </div>
                  ))}
                  {modelAliases.filter(a => a.model_name === m.name).length === 0 && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>Keine CSV-Zuordnungen</span>
                  )}
                </div>
              </div>
            ))}
            {models.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>Noch keine Models</div>}
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


// ============================================================
// v3.2.0: Guidelines Editor (Admin-Pflege)
// Schwesterkomponente im ChatterPortal: Read-Only-Anzeige
// ============================================================

function GuidelinesEditor({ cardS, inputS, labelS }) {
  const [guidelines, setGuidelines] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [savingOrder, setSavingOrder] = useState(false)

  const loadGuidelines = async () => {
    const { data } = await supabase.from('guidelines').select('*').order('order_index', { ascending: true })
    setGuidelines(data || [])
    setLoading(false)
  }

  useEffect(() => { loadGuidelines() }, [])

  const createGuideline = async () => {
    if (!newTitle.trim() || creating) return
    setCreating(true)
    const maxOrder = guidelines.reduce((m, g) => Math.max(m, g.order_index || 0), 0)
    const { data: user } = await supabase.auth.getUser()
    await supabase.from('guidelines').insert({
      title: newTitle.trim(),
      content: '',
      order_index: maxOrder + 1,
      updated_by: user?.user?.email || 'admin',
    })
    setNewTitle('')
    await loadGuidelines()
    setCreating(false)
  }

  const updateGuideline = async (id, patch) => {
    const { data: user } = await supabase.auth.getUser()
    await supabase.from('guidelines').update({
      ...patch,
      updated_at: new Date().toISOString(),
      updated_by: user?.user?.email || 'admin',
    }).eq('id', id)
    setGuidelines(prev => prev.map(g => g.id === id ? { ...g, ...patch } : g))
  }

  const deleteGuideline = async (id) => {
    if (!confirm('Diese Guideline wirklich löschen?')) return
    await supabase.from('guidelines').delete().eq('id', id)
    await loadGuidelines()
  }

  const moveGuideline = async (id, direction) => {
    if (savingOrder) return
    const idx = guidelines.findIndex(g => g.id === id)
    if (idx === -1) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= guidelines.length) return
    setSavingOrder(true)
    const a = guidelines[idx]
    const b = guidelines[swapIdx]
    // Order indizes tauschen
    await supabase.from('guidelines').update({ order_index: b.order_index }).eq('id', a.id)
    await supabase.from('guidelines').update({ order_index: a.order_index }).eq('id', b.id)
    await loadGuidelines()
    setSavingOrder(false)
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: 20, textAlign: 'center' }}>Laden…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 780 }}>
      <div style={cardS}>
        <div style={labelS}>📖 Neue Guideline</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createGuideline()}
            placeholder="Titel (z.B. 'Listen erstellen bei OnlyFans')"
            style={{ ...inputS, flex: 1 }}
          />
          <button onClick={createGuideline} disabled={creating || !newTitle.trim()} style={{
            background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 7,
            padding: '7px 16px', fontSize: 12, fontWeight: 700,
            cursor: (creating || !newTitle.trim()) ? 'not-allowed' : 'pointer',
            opacity: (creating || !newTitle.trim()) ? 0.5 : 1,
            fontFamily: 'inherit', whiteSpace: 'nowrap',
          }}>+ Erstellen</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
          Nach dem Erstellen kannst du Inhalt + Bilder bearbeiten. Reihenfolge mit Pfeilen anpassen.
          Markdown wird unterstützt: **fett**, *kursiv*, `code`, Listen mit - oder 1.
        </div>
      </div>

      {guidelines.length === 0 && (
        <div style={{ ...cardS, textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
          Noch keine Guidelines. Erstelle die erste oben.
        </div>
      )}

      {guidelines.map((g, idx) => (
        <GuidelineCard
          key={g.id}
          guideline={g}
          isFirst={idx === 0}
          isLast={idx === guidelines.length - 1}
          onUpdate={(patch) => updateGuideline(g.id, patch)}
          onDelete={() => deleteGuideline(g.id)}
          onMoveUp={() => moveGuideline(g.id, 'up')}
          onMoveDown={() => moveGuideline(g.id, 'down')}
          cardS={cardS}
          inputS={inputS}
        />
      ))}
    </div>
  )
}

function GuidelineCard({ guideline, isFirst, isLast, onUpdate, onDelete, onMoveUp, onMoveDown, cardS, inputS }) {
  const [expanded, setExpanded] = useState(false)
  const [title, setTitle] = useState(guideline.title)
  const [content, setContent] = useState(guideline.content || '')
  const [savingText, setSavingText] = useState(false)
  const [uploadingImages, setUploadingImages] = useState(false)

  const imageUrls = guideline.image_urls || []
  const MAX_IMAGES = 8

  const saveText = async () => {
    if (savingText) return
    if (title === guideline.title && content === (guideline.content || '')) return
    setSavingText(true)
    await onUpdate({ title: title.trim() || 'Ohne Titel', content })
    setSavingText(false)
  }

  // Resize-Helper (gleich wie im Chat-Modul)
  const resizeImage = (file, maxSize = 1920, quality = 0.85) => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        let { width, height } = img
        if (width <= maxSize && height <= maxSize) {
          fetch(URL.createObjectURL(file)).then(r => r.blob()).then(resolve).catch(reject)
          return
        }
        const ratio = Math.min(maxSize / width, maxSize / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas fail')), 'image/jpeg', quality)
      }
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img load')) }
      img.src = url
    })
  }

  const handleImageSelect = async (fileList) => {
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'))
    if (files.length === 0) return
    const available = MAX_IMAGES - imageUrls.length
    if (available <= 0) {
      alert(`Maximal ${MAX_IMAGES} Bilder pro Guideline. Lösche eines zuerst.`)
      return
    }
    const toProcess = files.slice(0, available)
    if (files.length > available) {
      alert(`Nur die ersten ${available} Bilder werden hochgeladen (Limit: ${MAX_IMAGES}).`)
    }
    setUploadingImages(true)
    const uploadedUrls = []
    for (const file of toProcess) {
      try {
        const blob = await resizeImage(file, 1920, 0.85)
        const path = `guideline_${guideline.id}/${Date.now()}_${Math.random().toString(36).slice(2, 9)}.jpg`
        const { error: uploadErr } = await supabase.storage.from('guideline-images').upload(path, blob, {
          contentType: 'image/jpeg',
          cacheControl: '31536000',
        })
        if (uploadErr) { console.error('upload fail:', uploadErr); continue }
        const { data: pub } = supabase.storage.from('guideline-images').getPublicUrl(path)
        if (pub?.publicUrl) uploadedUrls.push(pub.publicUrl)
      } catch (e) {
        console.error('resize/upload error:', e)
      }
    }
    if (uploadedUrls.length > 0) {
      const newUrls = [...imageUrls, ...uploadedUrls]
      await onUpdate({ image_urls: newUrls })
    }
    setUploadingImages(false)
  }

  const removeImage = async (idx) => {
    if (!confirm('Bild aus Guideline entfernen?')) return
    const newUrls = imageUrls.filter((_, i) => i !== idx)
    await onUpdate({ image_urls: newUrls.length > 0 ? newUrls : null })
  }

  return (
    <div style={{ ...cardS, padding: 0, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px',
        background: 'rgba(124,58,237,0.04)',
        borderBottom: expanded ? '1px solid var(--border)' : 'none',
        cursor: 'pointer',
      }} onClick={() => setExpanded(!expanded)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <button onClick={(e) => { e.stopPropagation(); onMoveUp() }} disabled={isFirst} style={{
            background: 'transparent', border: 'none',
            color: isFirst ? 'var(--border)' : 'var(--text-muted)',
            cursor: isFirst ? 'not-allowed' : 'pointer',
            fontSize: 10, padding: 0, lineHeight: 1,
          }}>▲</button>
          <button onClick={(e) => { e.stopPropagation(); onMoveDown() }} disabled={isLast} style={{
            background: 'transparent', border: 'none',
            color: isLast ? 'var(--border)' : 'var(--text-muted)',
            cursor: isLast ? 'not-allowed' : 'pointer',
            fontSize: 10, padding: 0, lineHeight: 1,
          }}>▼</button>
        </div>
        <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
          📖 {guideline.title || 'Ohne Titel'}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {imageUrls.length > 0 && `📎 ${imageUrls.length}`}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{expanded ? '▼' : '▶'}</div>
      </div>

      {expanded && (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Titel */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 5 }}>Titel</div>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={saveText}
              style={inputS}
            />
          </div>

          {/* Content */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 5 }}>
              Inhalt (Markdown: **fett**, *kursiv*, `code`, - Listen)
            </div>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              onBlur={saveText}
              placeholder="Schreib hier die Guideline-Inhalte. Beispiel:&#10;&#10;**Schritt 1:** Öffne die Lists-Übersicht&#10;**Schritt 2:** Klicke auf 'Neue Liste'&#10;&#10;- Punkt eins&#10;- Punkt zwei"
              rows={8}
              style={{ ...inputS, fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5 }}
            />
          </div>

          {/* Bilder */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 5 }}>
              Bilder ({imageUrls.length} / {MAX_IMAGES})
            </div>
            {imageUrls.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                {imageUrls.map((url, i) => (
                  <div key={i} style={{ position: 'relative', width: 84, height: 84, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                    <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button onClick={() => removeImage(i)} title="Entfernen" style={{
                      position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: '50%',
                      background: 'rgba(0,0,0,0.7)', color: '#fff', border: 'none', cursor: 'pointer',
                      fontSize: 11, lineHeight: 1, padding: 0, fontFamily: 'inherit',
                    }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {imageUrls.length < MAX_IMAGES && (
              <label style={{
                display: 'inline-block', padding: '8px 14px', borderRadius: 7,
                background: 'rgba(6,182,212,0.12)', color: '#06b6d4',
                border: '1px solid rgba(6,182,212,0.3)', fontSize: 12, fontWeight: 700,
                cursor: uploadingImages ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                opacity: uploadingImages ? 0.5 : 1,
              }}>
                {uploadingImages ? '⏳ Hochladen…' : '📎 Bilder hinzufügen'}
                <input type="file" accept="image/*" multiple
                  disabled={uploadingImages}
                  onChange={e => { handleImageSelect(e.target.files); e.target.value = '' }}
                  style={{ display: 'none' }}
                />
              </label>
            )}
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {guideline.updated_at && `Zuletzt bearbeitet: ${new Date(guideline.updated_at).toLocaleString('de-DE')}`}
              {guideline.updated_by && ` von ${guideline.updated_by}`}
            </div>
            <button onClick={onDelete} style={{
              background: 'rgba(239,68,68,0.1)', color: '#ef4444',
              border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6,
              padding: '6px 12px', fontSize: 11, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>🗑 Löschen</button>
          </div>
        </div>
      )}
    </div>
  )
}
