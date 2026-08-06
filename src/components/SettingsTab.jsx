import React, { useState, useEffect, useRef } from 'react'
import { BookOpen } from 'lucide-react'
import { supabase, FUNCTIONS_URL } from '../supabase'
import BillingTab from './BillingTab'
import ExportTab from './ExportTab'
import { logActivity } from '../activity'
import { ladeInaktiveNamen, ohneInaktive } from '../people'

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
  const [users, setUsers] = useState([])
  // v4.11.0: Freischaltungen für die Selbst-Registrierung
  const [invites, setInvites] = useState([])
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('chatter')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteMsg, setInviteMsg] = useState('')
  const [inviteErr, setInviteErr] = useState('')
  // v4.12.0: Passwort-Anfragen
  const [resets, setResets] = useState([])
  const [resetBusy, setResetBusy] = useState(null)
  const [resetCode, setResetCode] = useState(null)   // { id, code, per_telegram }
  // v4.16.0: Archiv standardmäßig zugeklappt — offboardete Leute sollen nicht
  // dauerhaft in einer Liste stehen.
  const [archivOffen, setArchivOffen] = useState(false)
  // v4.16.0: Altlasten aus fehlgeschlagenen Offboardings
  const [kontaktProbleme, setKontaktProbleme] = useState([])
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
    loadSurveys(); loadInvites(); loadResets(); loadKontaktCheck()
  }, [])

  const loadUsers = async () => { const { data } = await supabase.from('user_roles').select('*').order('role'); setUsers(data || []) }

  // ── v4.16.0: Altlasten finden ───────────────────────────────────────────
  // Sucht Leute, die als stillgelegt/offboardet in user_roles stehen, deren
  // Kontakt-Eintrag aber noch auf aktiv steht. Genau diese Kombination hat dafür
  // gesorgt, dass jemand aus der Mitgliederliste verschwindet, im Dienstplan und
  // beim Telegram-Versand aber weiterläuft. Ab v4.16.0 kann das nicht mehr neu
  // entstehen — bestehende Fälle müssen einmal aufgeräumt werden.
  const loadKontaktCheck = async () => {
    const norm = (x) => String(x || '').trim().toLowerCase()
    const [{ data: ur }, { data: ch }, { data: mo }] = await Promise.all([
      supabase.from('user_roles').select('display_name, status'),
      supabase.from('chatters_contact').select('name, active'),
      supabase.from('models_contact').select('name, active'),
    ])
    const inaktiv = new Set((ur || []).filter(u => u.status && u.status !== 'active').map(u => norm(u.display_name)))
    const bekannt = new Set((ur || []).map(u => norm(u.display_name)).filter(Boolean))
    const gefunden = []
    for (const [liste, tabelle, label] of [[ch, 'chatters_contact', 'Chatter'], [mo, 'models_contact', 'Model']]) {
      for (const k of liste || []) {
        if (k.active === false) continue
        const n = norm(k.name)
        if (inaktiv.has(n)) {
          gefunden.push({ tabelle, label, name: k.name, grund: 'offboardet' })
        } else if (tabelle === 'chatters_contact' && !bekannt.has(n)) {
          // Nur für Chatter: Wer chattet, braucht einen Login. Steht jemand in
          // der Kontaktliste, hat aber kein Konto, ist er entweder vom
          // Telegram-Bot angelegt worden oder aus user_roles verschwunden.
          // In beiden Fällen taucht er in Dienstplan und Versandliste auf, ohne
          // dass ein Offboarding je greifen könnte — das Feld active ist dann
          // der einzige Hebel.
          // Models sind hier ausgenommen: nicht jedes Model hat einen Zugang.
          gefunden.push({ tabelle, label, name: k.name, grund: 'kein Konto' })
        }
      }
    }
    setKontaktProbleme(gefunden)
  }

  const kontaktAusblenden = async (eintrag) => {
    await supabase.from(eintrag.tabelle).update({ active: false }).eq('name', eintrag.name)
    logActivity('user.status', { entity: eintrag.name, detail: 'Kontakt nachträglich ausgeblendet' })
    loadKontaktCheck(); loadModels(); loadChatters()
  }

  // ── v4.11.0: Selbst-Registrierung ───────────────────────────────────────
  // Statt selbst einen Login anzulegen, wird hier nur eine E-Mail-Adresse
  // freigeschaltet. Die Person legt ihr Passwort auf der Anmeldeseite selbst
  // fest; die Prüfung macht die Edge Function `self-signup`.
  const loadInvites = async () => {
    const { data } = await supabase.from('signup_invites').select('*').order('created_at', { ascending: false })
    setInvites(data || [])
  }

  const addInvite = async () => {
    const mail = inviteEmail.trim().toLowerCase()
    const name = inviteName.trim()
    if (!mail || !name) return
    setInviteBusy(true); setInviteErr(''); setInviteMsg('')

    // Doppelte Anzeigenamen führen zu Fehlzuordnungen (online_status, Dienstplan
    // und CSV-Aliase hängen am Namen) — deshalb hier abfangen statt hinterher suchen.
    if (users.some(u => (u.display_name || '').toLowerCase() === name.toLowerCase())) {
      setInviteErr(`„${name}" gibt es schon als Mitglied. Bitte einen eindeutigen Namen nehmen.`)
      setInviteBusy(false); return
    }
    const offen = invites.find(i => !i.used_at && i.email === mail)
    if (offen) {
      setInviteErr('Für diese Adresse ist schon eine Freischaltung offen.')
      setInviteBusy(false); return
    }

    // Wer freigeschaltet hat, kommt aus der Anmeldung — SettingsTab bekommt
    // keinen Namen als Prop übergeben.
    const { data: { user } } = await supabase.auth.getUser()
    const wer = user?.user_metadata?.full_name || user?.email?.split('@')[0] || null

    const { error } = await supabase.from('signup_invites').insert({
      email: mail, display_name: name, role: inviteRole, roles: [inviteRole],
      created_by: wer,
    })
    if (error) {
      setInviteErr(`Freischalten fehlgeschlagen: ${error.message}`)
      setInviteBusy(false); return
    }
    logActivity('user.invite', { entity: name, detail: `${mail} · ${inviteRole}` })
    setInviteMsg(`${mail} ist freigeschaltet. Die Person kann jetzt auf der Anmeldeseite „Konto erstellen" wählen.`)
    setInviteName(''); setInviteEmail('')
    setInviteBusy(false)
    loadInvites()
  }

  // ── v4.12.0: Passwort vergessen ─────────────────────────────────────────
  // Die Freigabe läuft über die Edge Function, weil dabei ein Code erzeugt und
  // per Telegram verschickt wird — beides gehört nicht in den Browser.
  const loadResets = async () => {
    const { data } = await supabase.from('password_resets').select('*').order('requested_at', { ascending: false })
    setResets(data || [])
  }

  const approveReset = async (r) => {
    if (!confirm(`Neues Passwort für ${r.display_name || r.email} freigeben?\n\nNur freigeben, wenn du weisst, dass diese Person gerade danach gefragt hat.`)) return
    setResetBusy(r.id); setResetCode(null)
    const { data: { session } } = await supabase.auth.getSession()
    const resp = await fetch(`${FUNCTIONS_URL}/password-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ action: 'approve', id: r.id }),
    })
    const data = await resp.json().catch(() => ({}))
    setResetBusy(null)
    if (!data.ok) { alert(data.error || 'Freigabe fehlgeschlagen.'); return }
    // Ging der Code per Telegram raus, muss ihn niemand abschreiben. Sonst
    // zeigen wir ihn hier — dann gibst du ihn selbst weiter.
    setResetCode({ id: r.id, code: data.code, per_telegram: data.per_telegram })
    loadResets()
  }

  const rejectReset = async (r) => {
    if (!confirm(`Anfrage von ${r.display_name || r.email} ablehnen?`)) return
    await supabase.from('password_resets').delete().eq('id', r.id)
    loadResets()
  }

  const revokeInvite = async (inv) => {
    if (!confirm(`Freischaltung für ${inv.email} zurückziehen?\n\nDie Person kann dann kein Konto mehr anlegen. Ein bereits angelegtes Konto bleibt bestehen.`)) return
    await supabase.from('signup_invites').delete().eq('id', inv.id)
    logActivity('user.invite.revoke', { entity: inv.display_name, detail: inv.email })
    loadInvites()
  }

  const extendInvite = async (inv) => {
    const neu = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString()
    await supabase.from('signup_invites').update({ expires_at: neu }).eq('id', inv.id)
    loadInvites()
  }
  // v4.16.0: `active` fehlte hier — dadurch standen offboardete Models weiter in
  // den Umfrage-Empfängern, im CSV-Alias-Dropdown und in der Model-Telegram-Liste.
  const loadModels = async () => {
    const [{ data }, inaktive] = await Promise.all([
      supabase.from('models_contact').select('name, telegram_id, in_schedule, active').order('name'),
      ladeInaktiveNamen(),
    ])
    setModels(ohneInaktive(data, inaktive))
  }
  // v3.24.1: stillgelegte Chatter (active === false) global ausblenden.
  // Wirkt auf alle Stellen, die `chatters` nutzen: Chatter-CSV-Liste, "Neue Zuordnung"-Dropdown
  // und Umfrage-Empfänger. active === null gilt weiterhin als aktiv (neu angelegte Chatter ohne Flag).
  const loadChatters = async () => {
    const [{ data }, inaktive] = await Promise.all([
      supabase.from('chatters_contact').select('name, active').order('name'),
      ladeInaktiveNamen(),
    ])
    setChatters(ohneInaktive(data, inaktive))
  }
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
  // v3.18.0: Status-Verwaltung (stilllegen / offboarden / reaktivieren) statt Hard-Delete
  const [statusNote, setStatusNote] = useState('')
  const [statusBusy, setStatusBusy] = useState(false)

  const startOffboarding = (user) => {
    setOffboardingUser(user)
    setStatusNote('')
    setOffboardStep('confirm')
  }

  const exportUserData = async (user) => {
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
  }

  // v4.21.0: Montag der laufenden Woche als ISO-Datum (lokale Zeit, wie im Dienstplan).
  const montagIso = () => {
    const x = new Date()
    const wd = x.getDay()
    x.setDate(x.getDate() + (wd === 0 ? -6 : 1 - wd))
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  }

  // v4.21.0: Ein stillgelegtes Model aus dem Dienstplan nehmen.
  //
  // Warum das nötig ist: Der Dienstplan blendet inaktive Models nur AUS, die
  // Zellen bleiben in der assignments-JSON stehen. Für alles, was die JSON roh
  // liest (z. B. der Schicht-Alarm), existiert die Schicht dann weiter — im
  // Dienstplan sieht sie aber niemand und kann sie folglich auch nicht
  // korrigieren. Genau so kam am 04.08.2026 eine Alarm-Meldung für Toni auf
  // einem längst offboardeten Model zustande.
  //
  // Bewusst nur ab der LAUFENDEN Woche: Vergangene Wochen sind Historie und
  // werden nicht angefasst.
  const modelAusDienstplanNehmen = async (modelName) => {
    const { data: treffer } = await supabase.from('models_contact').select('id').ilike('name', modelName)
    const ids = (treffer || []).map(m => String(m.id))
    if (ids.length === 0) return 0

    const { data: wochen } = await supabase
      .from('schedule').select('week_start, assignments').gte('week_start', montagIso())

    let entferntGesamt = 0
    for (const w of wochen || []) {
      const alt = w.assignments || {}
      const neu = {}
      let entfernt = 0
      for (const [k, v] of Object.entries(alt)) {
        if (ids.includes(k.split('__')[0])) { entfernt++; continue }
        neu[k] = v
      }
      if (entfernt === 0) continue
      const { error } = await supabase.from('schedule').update({ assignments: neu }).eq('week_start', w.week_start)
      if (error) { console.error('Dienstplan-Aufräumen fehlgeschlagen', w.week_start, error.message); continue }
      entferntGesamt += entfernt
    }
    return entferntGesamt
  }

  // v3.18.0: Status setzen (active | suspended | offboarded).
  // WICHTIG: Es werden KEINE Daten gelöscht. Wir markieren nur den Account-Status
  // (steuert Login) und blenden die Person aus der aktiven Dienstplan-Auswahl aus.
  // Alle historischen Daten (Schichtnotizen, Logs, Umsätze) bleiben vollständig erhalten.
  const setUserStatus = async (user, newStatus, note) => {
    const name = user.display_name
    const role = user.role
    setStatusBusy(true)
    try {
      // 1) Account-Status in user_roles (blockiert/erlaubt Login)
      const { error } = await supabase.from('user_roles').update({
        status: newStatus,
        status_note: note || null,
        status_changed_at: new Date().toISOString(),
      }).eq('user_id', user.user_id)
      if (error) throw error

      // 2) Aus aktiver Planung/Auswahl aus-/einblenden (NICHT löschen)
      //    v3.23.0: Models bekommen ein eigenes 'active'-Flag (analog zu chatters_contact).
      //    'in_schedule' bleibt davon unberührt — das ist weiterhin der manuelle
      //    "im Dienstplan / nicht im Plan"-Schalter und hat nichts mit Offboarding zu tun.
      //
      //    v4.16.0 — zwei stille Fehlschläge behoben:
      //    a) Bisher entschied `user.role`, also die EINZELNE Rolle. Bei jemandem mit
      //       roles = ['dienstplan','chatter'] ist role = 'dienstplan' — dann griff
      //       kein Zweig und der Kontakt blieb aktiv. Jetzt zählt das ganze Array.
      //    b) `.eq('name', display_name)` trifft bei abweichender Schreibweise NULL
      //       Zeilen — und Supabase meldet dabei keinen Fehler. Jetzt wird erst exakt,
      //       dann ohne Rücksicht auf Groß-/Kleinschreibung gesucht, und wenn immer
      //       noch nichts passt, sagt das Dashboard Bescheid statt so zu tun als wäre
      //       alles erledigt.
      const showInPlan = newStatus === 'active'
      const rollen = user.roles?.length ? user.roles : [user.role]
      const nichtGefunden = []
      for (const [rolle, tabelle] of [['model', 'models_contact'], ['chatter', 'chatters_contact']]) {
        if (!rollen.includes(rolle)) continue
        const { data: exakt } = await supabase.from(tabelle)
          .update({ active: showInPlan }).eq('name', name).select('name')
        if (exakt?.length) continue
        const { data: locker } = await supabase.from(tabelle)
          .update({ active: showInPlan }).ilike('name', name).select('name')
        if (!locker?.length) nichtGefunden.push(tabelle === 'models_contact' ? 'Models' : 'Chatter')
      }
      if (nichtGefunden.length > 0) {
        alert(
          `Achtung: Unter „${name}" gibt es keinen Eintrag in der ${nichtGefunden.join('- und ')}-Kontaktliste.\n\n` +
          'Der Login ist gesperrt, aber im Dienstplan und beim Telegram-Versand taucht die Person ' +
          'möglicherweise weiter auf, falls dort ein anderer Name hinterlegt ist.\n\n' +
          'Bitte die Schreibweise in den Kontakten prüfen.',
        )
      }

      // 3) Live-Status nicht mehr als "online" führen, wenn inaktiv
      if (!showInPlan) {
        await supabase.from('online_status').update({ shift_online: false }).eq('display_name', name)
      }

      // 4) v4.21.0: Beim Stilllegen eines Models dessen Einteilungen aus der
      //    laufenden und allen künftigen Wochen entfernen — sonst bleiben sie
      //    unsichtbar im Plan stehen (siehe modelAusDienstplanNehmen).
      if (!showInPlan && rollen.includes('model')) {
        const entfernt = await modelAusDienstplanNehmen(name)
        if (entfernt > 0) {
          logActivity('schedule.cleanup', { entity: name, detail: `${entfernt} Zelle(n) ab dieser Woche entfernt` })
          alert(`${name} wurde außerdem aus ${entfernt} Dienstplan-Zelle(n) ab dieser Woche entfernt.\n\nVergangene Wochen bleiben unverändert.`)
        }
      }
    } catch (e) {
      alert('Fehler beim Status-Update: ' + (e.message || e))
      setStatusBusy(false)
      return
    }
    setStatusBusy(false)
    setOffboardingUser(null)
    setStatusNote('')
    logActivity('user.status', { entity: name, detail: newStatus === 'active' ? 'wieder aktiviert' : `stillgelegt${note ? ': ' + note : ''}` })
    loadUsers(); loadModels(); loadChatters()
  }

  const reactivateUser = async (user) => {
    if (!confirm(`${user.display_name} wieder aktivieren?\n\nLogin wird wieder freigeschaltet und die Person erscheint wieder im Dienstplan. Daten bleiben unverändert.`)) return
    await setUserStatus(user, 'active', null)
  }

  const loadBotMessages = async () => {
    const { data } = await supabase.from('bot_settings').select('*')
    if (data?.length > 0) {
      const map = { ...DEFAULT_BOT_MESSAGES }
      for (const item of data) map[item.key] = item.value
      setBotMessages(map)
    }
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
    logActivity('user.roles', {
      entity: users.find(u => u.user_id === userId)?.display_name || userId,
      detail: updatedRoles.join(', '),
    })
    setEditingRole(null)
    loadUsers()
  }

  const saveBotMessage = async (key, value) => {
    setSavingMsg(true)
    await supabase.from('bot_settings').upsert({ key, value }, { onConflict: 'key' })
    logActivity('bot.message', { entity: key })
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
    const csvName = newMA.csv_name.trim()
    const { error } = await supabase.from('model_aliases').insert({ model_name: newMA.model_name, csv_name: csvName, alias_label: newMA.alias_label })
    if (error) {
      alert(error.code === '23505'
        ? `Der CSV-Name "${csvName}" ist bereits vergeben.`
        : 'Alias konnte nicht gespeichert werden: ' + error.message)
      return
    }
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
    const csvName = newCA.csv_name.trim()
    const { error } = await supabase.from('chatter_aliases').insert({ ...newCA, csv_name: csvName })
    if (error) {
      alert(error.code === '23505'
        ? `Der CSV-Name "${csvName}" ist bereits vergeben.`
        : 'Alias konnte nicht gespeichert werden: ' + error.message)
      return
    }
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

          {/* v4.16.0: Altlasten — erscheint nur, wenn es welche gibt */}
          {kontaktProbleme.length > 0 && (
            <div style={{ ...cardS, border: '1px solid rgba(239,68,68,0.45)' }}>
              <div style={{ ...labelS, color: '#ef4444' }}>⚠ Karteileichen ({kontaktProbleme.length})</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 12 }}>
                Diese Einträge stehen in der Kontaktliste auf aktiv und tauchen deshalb im{' '}
                <b style={{ color: 'var(--text-secondary)' }}>Dienstplan</b> und in der{' '}
                <b style={{ color: 'var(--text-secondary)' }}>Empfängerliste beim Telegram-Versand</b> auf,
                obwohl sie dort nicht hingehören.
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 12 }}>
                <b style={{ color: '#ef4444' }}>offboardet</b> — Account ist stillgelegt, der Kontakt-Eintrag
                wurde aber nicht mitgezogen. Ursache ist meist eine abweichende Schreibweise des Namens.<br />
                <b style={{ color: '#f59e0b' }}>kein Konto</b> — es gibt gar keinen Login unter diesem Namen.
                Entweder vom Telegram-Bot angelegt oder der Account wurde entfernt. Ein Offboarding
                kann hier nie greifen — nur Ausblenden hilft.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {kontaktProbleme.map(e => (
                  <div key={`${e.tabelle}-${e.name}`} style={{
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    padding: '8px 11px', background: 'var(--bg-card2)', borderRadius: 8,
                    border: `1px solid ${e.grund === 'offboardet' ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
                  }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#ef4444', background: 'rgba(239,68,68,0.15)', padding: '2px 7px', borderRadius: 4 }}>{e.label}</span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{e.name}</span>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap',
                      color: e.grund === 'offboardet' ? '#ef4444' : '#f59e0b',
                      background: (e.grund === 'offboardet' ? '#ef4444' : '#f59e0b') + '22',
                    }}>{e.grund}</span>
                    <button onClick={() => kontaktAusblenden(e)} style={{
                      fontSize: 11, padding: '5px 12px', borderRadius: 6, fontWeight: 700,
                      background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
                      color: '#ef4444', cursor: 'pointer', fontFamily: 'inherit',
                    }}>Jetzt ausblenden</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* v4.11.0: Freischalten — der empfohlene Weg.
              Kein Mailversand, kein Passwort das herumgeschickt wird: Die Person
              legt ihr Passwort auf der Anmeldeseite selbst fest. */}
          <div style={cardS}>
            <div style={labelS}>E-Mail zur Registrierung freischalten</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 12 }}>
              Adresse und Namen eintragen, Rolle wählen. Die Person geht dann auf die
              Anmeldeseite, wählt <b style={{ color: 'var(--text-secondary)' }}>„Konto erstellen"</b> und
              legt ihr Passwort selbst fest. Rolle und Name sind dabei schon hinterlegt —
              du musst hinterher nichts mehr in Supabase nachtragen.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Name (wie im Dienstplan)</label>
                  <input value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="z.B. Noa" style={inputS} />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>E-Mail</label>
                  <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="noa@example.com" type="email" style={inputS} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {ROLES.map(r => (
                  <button key={r.key} onClick={() => setInviteRole(r.key)} style={{
                    padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 11,
                    background: inviteRole === r.key ? r.color + '22' : 'transparent',
                    color: inviteRole === r.key ? r.color : 'var(--text-muted)',
                    border: `1px solid ${inviteRole === r.key ? r.color : 'var(--border)'}`,
                  }}>{r.label}</button>
                ))}
              </div>
              <button onClick={addInvite} disabled={inviteBusy || !inviteEmail || !inviteName}
                style={{ padding: '9px', borderRadius: 7, background: inviteEmail && inviteName ? '#10b981' : 'var(--border)', color: inviteEmail && inviteName ? '#04211a' : 'var(--text-muted)', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                {inviteBusy ? '⏳ Wird freigeschaltet…' : '✓ Freischalten'}
              </button>
              {inviteMsg && <div style={{ fontSize: 12, color: '#10b981', padding: '8px 12px', background: 'rgba(16,185,129,0.1)', borderRadius: 7, border: '1px solid rgba(16,185,129,0.3)', lineHeight: 1.5 }}>{inviteMsg}</div>}
              {inviteErr && <div style={{ fontSize: 12, color: '#ef4444', padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 7, border: '1px solid rgba(239,68,68,0.3)', lineHeight: 1.5 }}>{inviteErr}</div>}
            </div>

            {/* Offene und verbrauchte Freischaltungen */}
            {invites.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 8 }}>
                  Freischaltungen ({invites.filter(i => !i.used_at).length} offen)
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {invites.slice(0, 20).map(inv => {
                    const rc = ROLES.find(r => r.key === inv.role)
                    const abgelaufen = !inv.used_at && inv.expires_at && new Date(inv.expires_at) < new Date()
                    const tage = inv.expires_at ? Math.ceil((new Date(inv.expires_at) - new Date()) / 86400000) : null
                    const ton = inv.used_at ? '#10b981' : abgelaufen ? '#ef4444' : '#f59e0b'
                    return (
                      <div key={inv.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                        padding: '8px 11px', background: 'var(--bg-card2)', borderRadius: 8,
                        border: `1px solid ${ton}33`,
                      }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: ton, background: ton + '22', padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap' }}>
                          {inv.used_at ? '✓ REGISTRIERT' : abgelaufen ? 'ABGELAUFEN' : 'OFFEN'}
                        </span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>
                            {inv.display_name}
                            {rc && <span style={{ fontSize: 10, fontWeight: 700, color: rc.color, background: rc.color + '22', padding: '1px 6px', borderRadius: 4, marginLeft: 7 }}>{rc.label}</span>}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>{inv.email}</div>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {inv.used_at
                            ? new Date(inv.used_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
                            : abgelaufen ? 'abgelaufen' : `noch ${tage} T.`}
                        </div>
                        {!inv.used_at && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            {abgelaufen && (
                              <button onClick={() => extendInvite(inv)} title="Um 14 Tage verlängern"
                                style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>+14 T.</button>
                            )}
                            <button onClick={() => revokeInvite(inv)} title="Freischaltung zurückziehen"
                              style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', color: 'rgba(239,68,68,0.7)', cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* v4.12.0: Passwort-Anfragen — erscheint nur, wenn etwas offen ist */}
          {resets.filter(r => r.status !== 'verbraucht').length > 0 && (
            <div style={{ ...cardS, border: '1px solid rgba(245,158,11,0.4)' }}>
              <div style={{ ...labelS, color: '#f59e0b' }}>🔑 Passwort-Anfragen ({resets.filter(r => r.status !== 'verbraucht').length})</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 12 }}>
                Jemand hat auf der Anmeldeseite ein neues Passwort angefragt. Bei der Freigabe
                entsteht ein Code, der 60 Minuten gilt — er geht per Telegram an die Person,
                falls eine Telegram-ID hinterlegt ist. <b style={{ color: 'var(--text-secondary)' }}>Nur
                freigeben, wenn du weisst, dass diese Person gerade danach gefragt hat.</b>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {resets.filter(r => r.status !== 'verbraucht').map(r => {
                  const frei = r.status === 'freigegeben'
                  const abgelaufen = frei && r.expires_at && new Date(r.expires_at) < new Date()
                  const zeigeCode = resetCode?.id === r.id
                  return (
                    <div key={r.id} style={{ padding: '10px 12px', background: 'var(--bg-card2)', borderRadius: 8, border: `1px solid ${frei ? 'rgba(16,185,129,0.35)' : 'rgba(245,158,11,0.35)'}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap',
                          color: abgelaufen ? '#ef4444' : frei ? '#10b981' : '#f59e0b',
                          background: (abgelaufen ? '#ef4444' : frei ? '#10b981' : '#f59e0b') + '22' }}>
                          {abgelaufen ? 'ABGELAUFEN' : frei ? 'FREIGEGEBEN' : 'WARTET'}
                        </span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{r.display_name || '—'}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.email}</div>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {new Date(r.requested_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <div style={{ display: 'flex', gap: 5 }}>
                          {(!frei || abgelaufen) && (
                            <button onClick={() => approveReset(r)} disabled={resetBusy === r.id}
                              style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.45)', color: '#10b981', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>
                              {resetBusy === r.id ? '⏳' : '✓ Freigeben'}
                            </button>
                          )}
                          <button onClick={() => rejectReset(r)}
                            style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', color: 'rgba(239,68,68,0.7)', cursor: 'pointer', fontFamily: 'inherit' }}>Ablehnen</button>
                        </div>
                      </div>
                      {zeigeCode && (
                        <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 7, background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.35)' }}>
                          {resetCode.per_telegram ? (
                            <div style={{ fontSize: 12, color: '#a78bfa', lineHeight: 1.5 }}>
                              ✓ Der Code <b style={{ fontFamily: 'monospace', letterSpacing: '0.15em' }}>{resetCode.code}</b> ist per Telegram raus. Du musst nichts weiter tun.
                            </div>
                          ) : (
                            <div style={{ fontSize: 12, color: '#a78bfa', lineHeight: 1.5 }}>
                              Keine Telegram-ID hinterlegt — gib diesen Code selbst weiter:
                              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'monospace', letterSpacing: '0.25em', color: 'var(--text-primary)', margin: '8px 0 4px' }}>{resetCode.code}</div>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Gültig 60 Minuten.</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Mitglieder (aktiv) */}
          <div style={cardS}>
            <div style={labelS}>Aktuelle Mitglieder ({users.filter(u => (u.status || 'active') === 'active').length})</div>
            {users.filter(u => (u.status || 'active') === 'active').map(u => {
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
                      <button onClick={() => startOffboarding(u)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', color: 'rgba(239,68,68,0.6)', cursor: 'pointer', fontFamily: 'inherit' }}>Status…</button>
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

          {/* v3.18.0: History / Archiv — stillgelegte & offboardete Mitglieder. Daten bleiben erhalten. */}
          {users.some(u => u.status && u.status !== 'active') && (
            <div style={cardS}>
              <button
                onClick={() => setArchivOffen(o => !o)}
                style={{
                  width: '100%', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: 'inherit',
                  marginBottom: archivOffen ? 10 : 0,
                }}
              >
                <span style={{ ...labelS, marginBottom: 0 }}>
                  History / Archiv ({users.filter(u => u.status && u.status !== 'active').length})
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{archivOffen ? '▼' : '▶'}</span>
              </button>
              {archivOffen && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                Login gesperrt und aus dem Dienstplan ausgeblendet. Alle Daten (Schichtnotizen, Logs, Umsätze) bleiben erhalten und können jederzeit reaktiviert werden.
              </div>
              )}
              {archivOffen && users.filter(u => u.status && u.status !== 'active').map(u => {
                const rc = ROLES.find(r => r.key === u.role)
                const color = rc?.color || '#555580'
                const isSuspended = u.status === 'suspended'
                const stColor = isSuspended ? '#f59e0b' : '#ef4444'
                const stLabel = isSuspended ? 'Stillgelegt' : 'Offboarded'
                const changed = u.status_changed_at ? new Date(u.status_changed_at).toLocaleDateString('de-DE') : null
                return (
                  <div key={u.user_id} style={{ marginBottom: 6, padding: '9px 12px', background: 'var(--bg-card2)', borderRadius: 8, border: '1px solid #1e1e3a', opacity: 0.92 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color, filter: 'grayscale(0.4)' }}>{(u.display_name || '?')[0]}</div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{u.display_name}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                            {(u.roles && u.roles.length > 0 ? u.roles : [u.role]).map(r => ROLES.find(x => x.key === r)?.label || r).join(', ')}
                            {changed ? ` · seit ${changed}` : ''}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: stColor, background: stColor + '22', padding: '2px 8px', borderRadius: 4 }}>{stLabel}</span>
                        <button onClick={() => exportUserData(u)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>↓ Export</button>
                        <button onClick={() => reactivateUser(u)} disabled={statusBusy} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', cursor: statusBusy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>↺ Reaktivieren</button>
                      </div>
                    </div>
                    {u.status_note && (
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6, paddingLeft: 38, fontStyle: 'italic' }}>„{u.status_note}"</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* STATUS-VERWALTUNG MODAL (v3.18.0) — Stilllegen / Offboarden, kein Löschen */}
      {offboardingUser && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 14, padding: '28px 32px', width: '100%', maxWidth: 440 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(124,58,237,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#a78bfa' }}>{offboardingUser.display_name[0]}</div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{offboardingUser.display_name} verwalten</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{offboardingUser.role}</div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                Login wird gesperrt und die Person aus dem Dienstplan ausgeblendet. <strong style={{ color: 'var(--text-primary)' }}>Es werden keine Daten gelöscht</strong> — alles bleibt in der History und kann jederzeit reaktiviert werden.
              </div>

              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: 5 }}>Notiz (optional)</div>
                <input
                  type="text"
                  value={statusNote}
                  onChange={e => setStatusNote(e.target.value)}
                  placeholder="z.B. Pause bis September, Elternzeit, …"
                  style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              <button onClick={() => exportUserData(offboardingUser)} style={{ padding: '10px', borderRadius: 8, background: 'transparent', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.4)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                ↓ Daten-Backup exportieren (JSON)
              </button>

              <div style={{ height: 1, background: '#1e1e3a', margin: '2px 0' }} />

              <button onClick={() => setUserStatus(offboardingUser, 'suspended', statusNote)} disabled={statusBusy} style={{ padding: '10px', borderRadius: 8, background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.35)', fontSize: 13, fontWeight: 700, cursor: statusBusy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: statusBusy ? 0.5 : 1 }}>
                ⏸ Stilllegen (temporär)
              </button>
              <button onClick={() => setUserStatus(offboardingUser, 'offboarded', statusNote)} disabled={statusBusy} style={{ padding: '10px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', fontSize: 13, fontWeight: 700, cursor: statusBusy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: statusBusy ? 0.5 : 1 }}>
                📦 Offboarden (ins Archiv)
              </button>
              <button onClick={() => { setOffboardingUser(null); setStatusNote('') }} style={{ padding: '8px', borderRadius: 8, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                Abbrechen
              </button>
            </div>
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
// v3.51.0: Bilder per Drag & Drop hinzufügbar (Klick funktioniert weiterhin)
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
    logActivity('guideline.create', { entity: newTitle.trim() })
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
    logActivity('guideline.edit', { entity: patch.title || guidelines.find(g => g.id === id)?.title || `#${id}` })
  }

  const deleteGuideline = async (id) => {
    if (!confirm('Diese Guideline wirklich löschen?')) return
    const title = guidelines.find(g => g.id === id)?.title || `#${id}`
    await supabase.from('guidelines').delete().eq('id', id)
    logActivity('guideline.delete', { entity: title })
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
        <div style={labelS}><BookOpen size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Neue Guideline</div>
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
  const [dragOver, setDragOver] = useState(false) // v3.51.0: Drag & Drop für Bilder

  const imageUrls = guideline.image_urls || []
  const MAX_IMAGES = 20 // v3.52.0: von 8 auf 20 erhöht

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

  // v3.51.0: Drag & Drop — Bilder direkt auf die Drop-Zone ziehen
  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    if (uploadingImages) return
    const files = e.dataTransfer?.files
    if (files && files.length > 0) handleImageSelect(files)
  }

  // v3.53.0: Bild-Platzhalter [bildN] an Cursor-Position im Inhalt einfügen.
  // Der Chatter sieht das Bild dann genau an dieser Stelle (statt gesammelt unten).
  const textareaRef = useRef(null)
  const insertPlaceholder = (n) => {
    const token = `[bild${n}]`
    const ta = textareaRef.current
    let start = content.length
    let end = content.length
    if (ta && typeof ta.selectionStart === 'number') {
      start = ta.selectionStart
      end = ta.selectionEnd
    }
    const before = content.slice(0, start)
    const after = content.slice(end)
    const needNlBefore = before.length > 0 && !before.endsWith('\n')
    const needNlAfter = after.length > 0 && !after.startsWith('\n')
    const insert = `${needNlBefore ? '\n' : ''}${token}${needNlAfter ? '\n' : ''}`
    const newContent = before + insert + after
    setContent(newContent)
    onUpdate({ content: newContent }) // sofort speichern
    // Cursor hinter das eingefügte Token setzen
    requestAnimationFrame(() => {
      if (!ta) return
      ta.focus()
      const pos = (before + insert).length
      ta.setSelectionRange(pos, pos)
    })
  }

  const removeImage = async (idx) => {
    if (!confirm('Bild aus Guideline entfernen? Achtung: Nachfolgende Bild-Nummern verschieben sich — prüfe danach deine [bildN]-Platzhalter im Text.')) return
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
        <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <BookOpen size={14} /> {guideline.title || 'Ohne Titel'}
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
              Inhalt (Markdown: **fett**, *kursiv*, `code`, - Listen, 1. nummeriert)
            </div>
            <textarea
              ref={textareaRef}
              value={content}
              onChange={e => setContent(e.target.value)}
              onBlur={saveText}
              placeholder="Schreib hier die Guideline-Inhalte. Beispiel:&#10;&#10;1. Schichtbeginn im Dashboard anmelden&#10;[bild1]&#10;&#10;2. Aktuellen Schichtplan überprüfen&#10;[bild2]"
              rows={8}
              style={{ ...inputS, fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5 }}
            />
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
              💡 Tipp: Mit <code style={{ background: 'rgba(124,58,237,0.12)', color: '#a78bfa', padding: '1px 4px', borderRadius: 3 }}>[bild1]</code>, <code style={{ background: 'rgba(124,58,237,0.12)', color: '#a78bfa', padding: '1px 4px', borderRadius: 3 }}>[bild2]</code> … erscheint das jeweilige Bild genau an dieser Stelle im Text. Nutze die „einfügen"-Buttons unten bei den Bildern. Ohne Platzhalter werden Bilder gesammelt unten angezeigt.
            </div>
          </div>

          {/* Bilder */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 5 }}>
              Bilder ({imageUrls.length} / {MAX_IMAGES})
            </div>
            {imageUrls.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                {imageUrls.map((url, i) => (
                  <div key={i} style={{ position: 'relative', width: 96, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                    <div style={{ position: 'relative', width: 96, height: 84 }}>
                      <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      {/* v3.53.0: Nummer-Badge zeigt, welches [bildN] gemeint ist */}
                      <div style={{
                        position: 'absolute', bottom: 3, left: 3,
                        background: 'rgba(6,182,212,0.9)', color: '#001', borderRadius: 4,
                        fontSize: 10, fontWeight: 700, padding: '1px 5px', fontFamily: 'inherit',
                      }}>Bild {i + 1}</div>
                      <button onClick={() => removeImage(i)} title="Entfernen" style={{
                        position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: '50%',
                        background: 'rgba(0,0,0,0.7)', color: '#fff', border: 'none', cursor: 'pointer',
                        fontSize: 11, lineHeight: 1, padding: 0, fontFamily: 'inherit',
                      }}>✕</button>
                    </div>
                    {/* v3.53.0: Platzhalter an Cursor-Position im Inhalt einfügen */}
                    <button
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => insertPlaceholder(i + 1)}
                      title={`[bild${i + 1}] an Cursor-Position im Inhalt einfügen`}
                      style={{
                        width: '100%', border: 'none', borderTop: '1px solid var(--border)',
                        background: 'rgba(6,182,212,0.12)', color: '#06b6d4',
                        fontSize: 10, fontWeight: 700, padding: '4px 0', cursor: 'pointer', fontFamily: 'inherit',
                      }}>↥ in Text</button>
                  </div>
                ))}
              </div>
            )}
            {/* v3.51.0: Drop-Zone — Bilder hierher ziehen ODER klicken */}
            {imageUrls.length < MAX_IMAGES && (
              <label
                onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (!uploadingImages) setDragOver(true) }}
                onDragEnter={e => { e.preventDefault(); e.stopPropagation(); if (!uploadingImages) setDragOver(true) }}
                onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setDragOver(false) }}
                onDrop={handleDrop}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 4, padding: '18px 14px', borderRadius: 8, textAlign: 'center',
                  border: `2px dashed ${dragOver ? '#06b6d4' : 'var(--border)'}`,
                  background: dragOver ? 'rgba(6,182,212,0.12)' : 'rgba(6,182,212,0.04)',
                  color: '#06b6d4', fontSize: 12, fontWeight: 700,
                  cursor: uploadingImages ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                  opacity: uploadingImages ? 0.5 : 1, transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: 20, lineHeight: 1 }}>{uploadingImages ? '⏳' : '📎'}</div>
                <div>
                  {uploadingImages
                    ? 'Hochladen…'
                    : dragOver
                      ? 'Loslassen zum Hochladen'
                      : 'Bilder hierher ziehen oder klicken'}
                </div>
                <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)' }}>
                  JPG / PNG · noch {MAX_IMAGES - imageUrls.length} möglich
                </div>
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
