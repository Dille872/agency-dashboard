import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { sendTelegramMessage, notifyOwner } from '../telegram'
import Card from './Card'
import OnlineStatus from './OnlineStatus'

const OWNER_EMAIL = 'dillemc@hotmail.com'
const DISPLAY_NAMES = {
  'dillemc@hotmail.com': 'Chris',
}
const getDisplayName = (email) => DISPLAY_NAMES[email] || email?.split('@')[0] || 'Unbekannt'

const MODEL_MSG_TYPES = [
  { key: 'content_request', label: 'Content anfragen' },
  { key: 'availability', label: 'Verfügbarkeit prüfen' },
  { key: 'free', label: 'Freie Nachricht' },
]
const CHATTER_MSG_TYPES = [
  { key: 'announcement', label: 'Ankündigung' },
  { key: 'zoom', label: 'Zoom Call' },
  { key: 'free', label: 'Freie Nachricht' },
]
const MODEL_TEMPLATES = {
  content_request: 'Hey {name}, kannst du bitte neuen Content hochladen? Danke! – Thirteen 87',
  availability: 'Hey {name}, bist du diese Woche verfügbar? – Thirteen 87',
  free: '',
}
const CHATTER_TEMPLATES = {
  announcement: 'Hi {name}, kurze Info vom Team: ',
  zoom: 'Hi {name}, heute Zoom Call um  Uhr. Bitte pünktlich sein! – Thirteen 87',
  free: '',
}
const AVAIL_COLORS = { available: '#10b981', unavailable: '#ef4444', unknown: '#f59e0b' }
const AVAIL_LABELS = { available: 'Verfügbar', unavailable: 'Nicht verfügbar', unknown: 'Unbekannt' }

// ── Extracted outside to prevent re-mount on parent re-render ───────────────
function AddContactForm({ type, onSave, onCancel, isOwner }) {
  const [name, setName] = useState('')
  const [tgId, setTgId] = useState('')
  return (
    <div style={{ padding: '12px', background: 'var(--bg-card2)', borderRadius: 8, border: '1px solid #2e2e5a' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
        {type === 'model' ? 'Model' : 'Chatter'} hinzufügen
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          value={name} onChange={e => setName(e.target.value)}
          placeholder="Name" autoFocus
          style={{ background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
        />
        <input
          value={tgId} onChange={e => setTgId(e.target.value)}
          placeholder="Telegram ID"
          style={{ background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 7, fontSize: 12, fontFamily: 'monospace', outline: 'none' }}
        />
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Die ID wird nach dem Speichern nicht mehr angezeigt</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => onSave(name, tgId)} style={{ flex: 1, background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 7, padding: '8px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            Speichern
          </button>
          <button onClick={onCancel} style={{ background: 'transparent', border: '1px solid #2e2e5a', color: 'var(--text-secondary)', borderRadius: 7, padding: '8px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  )
}

function ModelAliasManager({ models }) {
  const [aliases, setAliases] = useState([])
  const [newModel, setNewModel] = useState('')
  const [newCsvName, setNewCsvName] = useState('')
  const [newLabel, setNewLabel] = useState('')

  useEffect(() => { loadAliases() }, [])

  const loadAliases = async () => {
    const { data } = await supabase.from('model_aliases').select('*').order('model_name')
    setAliases(data || [])
  }

  const addAlias = async () => {
    if (!newModel || !newCsvName.trim()) return
    await supabase.from('model_aliases').insert({
      model_name: newModel,
      csv_name: newCsvName.trim(),
      alias_label: newLabel.trim() || null,
    })
    setNewModel(''); setNewCsvName(''); setNewLabel('')
    loadAliases()
  }

  const deleteAlias = async (id) => {
    await supabase.from('model_aliases').delete().eq('id', id)
    loadAliases()
  }

  const inputS = { background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '6px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none' }

  return (
    <Card title="CSV Account-Zuordnung">
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
        Hier kannst du mehrere CSV-Namen einem Model zuordnen – z.B. "Sandra VIP" gehört zu Sandra.
      </div>
      {/* Existing aliases grouped by model */}
      {models.filter(m => aliases.some(a => a.model_name === m.name)).map(m => (
        <div key={m.id} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{m.name}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {aliases.filter(a => a.model_name === m.name).map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{a.csv_name}</span>
                {a.alias_label && <span style={{ color: 'var(--text-muted)' }}>· {a.alias_label}</span>}
                <button onClick={() => deleteAlias(a.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 }}
                  onMouseEnter={e => e.target.style.color = '#ef4444'}
                  onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
              </div>
            ))}
          </div>
        </div>
      ))}
      {/* Add new */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Model</label>
          <select value={newModel} onChange={e => setNewModel(e.target.value)} style={{ ...inputS }}>
            <option value="">— wählen —</option>
            {models.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>CSV-Name (exakt)</label>
          <input value={newCsvName} onChange={e => setNewCsvName(e.target.value)} placeholder="z.B. Sandra VIP" style={{ ...inputS, width: 130 }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Label (optional)</label>
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="z.B. Hauptaccount" style={{ ...inputS, width: 120 }} />
        </div>
        <button onClick={addAlias} disabled={!newModel || !newCsvName.trim()}
          style={{ background: newModel && newCsvName.trim() ? '#f59e0b' : 'var(--border)', color: newModel && newCsvName.trim() ? '#000' : 'var(--text-muted)', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
          + Hinzufügen
        </button>
      </div>
    </Card>
  )
}

export default function CommTab({ session, section = 'nachrichten', displayName = '' }) {
  const isOwner = session?.user?.email === OWNER_EMAIL
  const userName = getDisplayName(session?.user?.email)

  const [models, setModels] = useState([])
  const [selectedModel, setSelectedModel] = useState(null)
  const [modelMsgType, setModelMsgType] = useState('content_request')
  const [modelMsgText, setModelMsgText] = useState('')
  const [sendingModel, setSendingModel] = useState(false)
  const [showAddModel, setShowAddModel] = useState(false)

  const [chatters, setChatters] = useState([])
  const [selectedChatters, setSelectedChatters] = useState(new Set())
  const [chatterMsgType, setChatterMsgType] = useState('announcement')
  const [chatterMsgText, setChatterMsgText] = useState('')
  const [sendingChatter, setSendingChatter] = useState(false)
  const [showAddChatter, setShowAddChatter] = useState(false)
  const [zoomDate, setZoomDate] = useState('')
  const [zoomTime, setZoomTime] = useState('')

  const [messages, setMessages] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [replyingTo, setReplyingTo] = useState(null) // msg.id
  const [replyText, setReplyText] = useState('')
  const [sendingReply, setSendingReply] = useState(false)
  const [activeSection, setActiveSection] = useState(() => {
    if (section === 'models') return 'models'
    if (section === 'chatters') return 'chatters'
    return 'nachrichten'
  })
  const [initialJumpDone, setInitialJumpDone] = useState(false)
  const [onlineStatuses, setOnlineStatuses] = useState({})
  const [inboxFilter, setInboxFilter] = useState('all')
  const [inboxUnreadOnly, setInboxUnreadOnly] = useState(false)
  const [inboxPersonFilter, setInboxPersonFilter] = useState('all')
  const [contentFilter, setContentFilter] = useState('offen')
  const [boardsModelFilter, setBoardsModelFilter] = useState('all')
  const [historySearch, setHistorySearch] = useState('')
  // Pinnwand
  const [announcements, setAnnouncements] = useState([])
  const [newAnnText, setNewAnnText] = useState('')
  const [newAnnEmoji, setNewAnnEmoji] = useState('📌')
  const [newAnnExpiresAt, setNewAnnExpiresAt] = useState('')
  const [showAnnForm, setShowAnnForm] = useState(false)
  // Crew-Tab Collapse
  const [crewCollapse, setCrewCollapse] = useState({
    chatters: false,    // sichtbar by default
    swaps: true,        // collapsed by default
    stats: true,
    shiftlog: true,
    pinnwand: false,    // sichtbar by default
  })

  useEffect(() => {
    loadModels(); loadChatters(); loadMessages(); loadOnlineStatuses()
    loadAnnouncements()
    // Load section-specific data
    if (section === 'models') { loadContentRequests(); loadModelBoardActivity() }
    if (section === 'chatters') { loadShiftLogs(); loadSwaps() }
    setTimeout(loadOnlineStatuses, 3000) // reload after heartbeat sent
    const interval = setInterval(() => {
      loadMessages()
      loadOnlineStatuses()
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (selectedModel) setModelMsgText(MODEL_TEMPLATES[modelMsgType]?.replace('{name}', selectedModel.name) || '')
  }, [modelMsgType, selectedModel])

  useEffect(() => {
    const names = selectedChatters.size === 0 ? 'alle' : [...selectedChatters].join(', ')
    setChatterMsgText(CHATTER_TEMPLATES[chatterMsgType]?.replace('{name}', names) || '')
  }, [chatterMsgType])

  const loadOnlineStatuses = async () => {
    const { data } = await supabase.from('online_status').select('*')
    const map = {}
    const cutoff = new Date(Date.now() - 120000)
    for (const s of data || []) {
      map[s.display_name] = {
        dashboardOnline: new Date(s.last_seen) > cutoff,
        shiftOnline: s.shift_online && new Date(s.last_seen) > cutoff,
        lastSeen: s.last_seen,
      }
    }
    setOnlineStatuses(map)
  }

  const loadAnnouncements = async () => {
    const { data } = await supabase
      .from('announcements')
      .select('*')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
    setAnnouncements(data || [])
  }

  const postAnnouncement = async () => {
    if (!newAnnText.trim()) return
    const payload = {
      text: newAnnText.trim(),
      emoji: newAnnEmoji || '📌',
      created_by: displayName || 'Admin',
      expires_at: newAnnExpiresAt ? new Date(newAnnExpiresAt).toISOString() : null,
      archived_for: [],
    }
    const { error } = await supabase.from('announcements').insert(payload)
    if (error) {
      alert('Fehler: ' + error.message)
      return
    }
    setNewAnnText('')
    setNewAnnEmoji('📌')
    setNewAnnExpiresAt('')
    setShowAnnForm(false)
    loadAnnouncements()
  }

  const deleteAnnouncement = async (id) => {
    if (!confirm('Ankündigung wirklich löschen?')) return
    await supabase.from('announcements').delete().eq('id', id)
    loadAnnouncements()
  }

  const loadModels = async () => {
    const { data } = await supabase.from('models_contact').select('*').order('name')
    setModels(data || [])
  }
  const loadChatters = async () => {
    const { data } = await supabase.from('chatters_contact').select('*').order('name')
    setChatters(data || [])
  }
  const loadMessages = async () => {
    const { data } = await supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(200)
    setMessages(data || [])
    setUnreadCount((data || []).filter(m => m.direction === 'in' && !m.read).length)
  }


  const sendModelMessage = async () => {
    if (!selectedModel || !modelMsgText.trim() || !selectedModel.telegram_id) return
    setSendingModel(true)
    try {
      await sendTelegramMessage(selectedModel.telegram_id, modelMsgText)
      await supabase.from('messages').insert({
        model_name: selectedModel.name, model_telegram_id: selectedModel.telegram_id,
        direction: 'out', contact_type: 'model', message_type: modelMsgType,
        text: modelMsgText, status: 'sent', sent_by: userName,
      })
      await supabase.from('models_contact').update({ last_contacted: new Date().toISOString() }).eq('id', selectedModel.id)
      setModelMsgText(''); setSelectedModel(null)
      loadMessages(); loadModels()
    } catch (e) { alert('Fehler: ' + e.message) }
    setSendingModel(false)
  }

  const sendChatterMessage = async () => {
    if (!chatterMsgText.trim()) return
    setSendingChatter(true)
    const targets = selectedChatters.size > 0
      ? chatters.filter(c => selectedChatters.has(c.id))
      : chatters.filter(c => c.telegram_id)

    // Build calendar link for zoom
    let calLink = ''
    console.log('zoom check:', chatterMsgType, zoomDate, zoomTime)
    if (chatterMsgType === 'zoom' && zoomDate && zoomTime) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      const d = zoomDate.replace(/-/g, '')
      const t = zoomTime.replace(':', '') + '00'
      calLink = `\n\n📅 Zum Kalender hinzufügen:\nhttps://calendar.google.com/calendar/render?action=TEMPLATE&text=Zoom+Call+Thirteen+87&dates=${d}T${t}/${d}T${t}&ctz=${encodeURIComponent(tz)}&details=Team+Zoom+Call`
      console.log('calLink generated:', calLink)
    }

    let sent = 0
    for (const chatter of targets) {
      if (!chatter.telegram_id) continue
      const personalText = chatterMsgText.replace('{name}', chatter.name) + calLink
      await sendTelegramMessage(chatter.telegram_id, personalText)
      await supabase.from('messages').insert({
        model_name: chatter.name, model_telegram_id: chatter.telegram_id,
        direction: 'out', contact_type: 'chatter', message_type: chatterMsgType,
        text: personalText, status: 'sent', sent_by: userName,
      })
      await supabase.from('chatters_contact').update({ last_contacted: new Date().toISOString() }).eq('id', chatter.id)
      sent++
    }
    setChatterMsgText(''); setSelectedChatters(new Set())
    setZoomDate(''); setZoomTime('')
    loadMessages(); loadChatters()
    setSendingChatter(false)
    alert(`✓ Nachricht an ${sent} Chatter gesendet`)
  }

  const addModel = async (name, tgId) => {
    if (!name.trim()) return
    await supabase.from('models_contact').insert({ name: name.trim(), telegram_id: tgId.trim() || null })
    setShowAddModel(false); loadModels()
  }
  const addChatter = async (name, tgId) => {
    if (!name.trim()) return
    await supabase.from('chatters_contact').insert({ name: name.trim(), telegram_id: tgId.trim() || null })
    setShowAddChatter(false); loadChatters()
  }

  const [editingChatter, setEditingChatter] = useState(null) // {id, name}
  const [editChatterName, setEditChatterName] = useState('')
  const [availabilities, setAvailabilities] = useState({}) // chatterName → [{day_of_week, time_from, time_to}]
  const [showAvailability, setShowAvailability] = useState(null) // chatterName
  const [newAvailDay, setNewAvailDay] = useState('')
  const [newAvailFrom, setNewAvailFrom] = useState('')
  const [newAvailTo, setNewAvailTo] = useState('')

  const DAY_NAMES = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

  const loadAvailabilities = async () => {
    const { data } = await supabase.from('chatter_availability').select('*')
    const map = {}
    for (const a of data || []) {
      if (!map[a.chatter_name]) map[a.chatter_name] = []
      map[a.chatter_name].push(a)
    }
    setAvailabilities(map)
  }

  const saveChatterName = async () => {
    if (!editChatterName.trim() || !editingChatter) return
    const oldName = editingChatter.name
    const newName = editChatterName.trim()
    await supabase.from('chatters_contact').update({ name: newName }).eq('id', editingChatter.id)
    // Update all references
    await supabase.from('chatter_availability').update({ chatter_name: newName }).eq('chatter_name', oldName)
    await supabase.from('absences').update({ chatter_name: newName }).eq('chatter_name', oldName)
    await supabase.from('reminders').update({ chatter_name: newName }).eq('chatter_name', oldName)
    await supabase.from('shift_swaps').update({ requester_name: newName }).eq('requester_name', oldName)
    // Update schedule assignments
    const { data: schedules } = await supabase.from('schedule').select('*')
    for (const sched of schedules || []) {
      const assignments = sched.assignments || {}
      let changed = false
      for (const [key, val] of Object.entries(assignments)) {
        if (val.chatter === oldName) { assignments[key].chatter = newName; changed = true }
      }
      if (changed) await supabase.from('schedule').update({ assignments }).eq('id', sched.id)
    }
    setEditingChatter(null)
    loadChatters()
  }

  const addAvailability = async (chatterName) => {
    if (!newAvailDay === '' || !newAvailFrom || !newAvailTo) return
    await supabase.from('chatter_availability').insert({
      chatter_name: chatterName,
      day_of_week: parseInt(newAvailDay),
      time_from: newAvailFrom,
      time_to: newAvailTo,
    })
    setNewAvailDay(''); setNewAvailFrom(''); setNewAvailTo('')
    loadAvailabilities()
  }

  const deleteAvailability = async (id) => {
    await supabase.from('chatter_availability').delete().eq('id', id)
    loadAvailabilities()
  }

  useEffect(() => { loadAvailabilities() }, [])

  const sendReply = async (msg) => {
    if (!replyText.trim() || !msg.model_telegram_id) return
    setSendingReply(true)
    await sendTelegramMessage(msg.model_telegram_id, replyText.trim())
    await supabase.from('messages').insert({
      model_name: msg.model_name,
      model_telegram_id: msg.model_telegram_id,
      direction: 'out',
      contact_type: msg.contact_type,
      text: replyText.trim(),
      status: 'sent',
      read: true,
    })
    setReplyText('')
    setReplyingTo(null)
    setSendingReply(false)
    loadMessages()
  }

  const markAllRead = async () => {
    await supabase.from('messages').update({ read: true }).eq('direction', 'in').eq('read', false)
    loadMessages()
  }

  const toggleChatter = (id) => {
    setSelectedChatters(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const formatTime = (ts) => {
    const d = new Date(ts)
    const now = new Date()
    const diffH = (now - d) / 3600000
    if (diffH < 24) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  }

  const [shiftLogs, setShiftLogs] = useState([])
  const [chatterStats, setChatterStats] = useState([])
  const [swaps, setSwaps] = useState([])
  const [modelBoardActivity, setModelBoardActivity] = useState([])
  const [unreadAdminCC, setUnreadAdminCC] = useState([])
  const [modelBoards, setModelBoards] = useState({})
  const [modelServices, setModelServices] = useState({})
  const [modelCustomContent, setModelCustomContent] = useState({})
  const [selectedBoardModel, setSelectedBoardModel] = useState(null)

  const loadModelBoardActivity = async () => {
    const { data } = await supabase.from('model_board_activity')
      .select('*').order('created_at', { ascending: false }).limit(50)
    setModelBoardActivity(data || [])

    // Also load unread custom content for admin
    const { data: ccData } = await supabase.from('custom_content')
      .select('*').eq('read_by_admin', false).order('created_at', { ascending: false })
    setUnreadAdminCC(ccData || [])
  }

  const markAdminCCRead = async () => {
    await supabase.from('custom_content').update({ read_by_admin: true }).eq('read_by_admin', false)
    setUnreadAdminCC([])
  }

  const loadModelBoard = async (modelName) => {
    const { data } = await supabase.from('model_board')
      .select('*').eq('model_name', modelName).order('sort_order')
    const map = {}
    const svcs = {}
    for (const item of data || []) {
      if (item.category === 'service_flags') {
        svcs[item.title] = { enabled: item.yes_no, note: item.content }
      } else {
        if (!map[item.category]) map[item.category] = []
        map[item.category].push(item)
      }
    }
    setModelBoards(prev => ({ ...prev, [modelName]: map }))
    setModelServices(prev => ({ ...prev, [modelName]: svcs }))
    const { data: ccData } = await supabase.from('custom_content').select('*').eq('model_name', modelName).order('created_at', { ascending: false })
    setModelCustomContent(prev => ({ ...prev, [modelName]: ccData || [] }))
  }

  const loadShiftLogs = async () => {
    const { data } = await supabase.from('shift_logs').select('*').order('checked_in_at', { ascending: false }).limit(100)
    setShiftLogs(data || [])
    // Calculate stats per chatter
    const logs = data || []
    const statsMap = {}
    for (const log of logs) {
      const name = log.display_name
      if (!statsMap[name]) statsMap[name] = { name, totalShifts: 0, lateShifts: 0, totalMinutes: 0 }
      statsMap[name].totalShifts++
      if (log.checked_in_at && log.checked_out_at) {
        const mins = (new Date(log.checked_out_at) - new Date(log.checked_in_at)) / 60000
        statsMap[name].totalMinutes += mins
      }
    }
    setChatterStats(Object.values(statsMap).sort((a, b) => b.totalShifts - a.totalShifts))
  }

  const loadSwaps = async () => {
    const { data } = await supabase.from('shift_swaps').select('*').order('created_at', { ascending: false })
    setSwaps(data || [])
  }

  const updateSwap = async (id, status, acceptedBy = null) => {
    await supabase.from('shift_swaps').update({ status, ...(acceptedBy ? { accepted_by: acceptedBy } : {}) }).eq('id', id)
    loadSwaps()
  }

  const [contentRequests, setContentRequests] = useState([])
  const [unreadRequests, setUnreadRequests] = useState(0)
  const [editingPayment, setEditingPayment] = useState(null) // req.id
  const [editPrice, setEditPrice] = useState('')
  const [editDeposit, setEditDeposit] = useState('')
  const [editingText, setEditingText] = useState(null) // req.id
  const [editTextValue, setEditTextValue] = useState('')

  // Jump to content-requests on first load if there are new ones
  useEffect(() => {
    if (section === 'models' && !initialJumpDone && unreadRequests > 0) {
      setActiveSection('content-requests')
      setInitialJumpDone(true)
    }
  }, [unreadRequests])

  const loadContentRequests = async () => {
    const { data } = await supabase.from('content_requests').select('*').order('created_at', { ascending: false })
    setContentRequests(data || [])
    setUnreadRequests((data || []).filter(r => r.status === 'neu').length)
  }

  const updateRequestStatus = async (id, status) => {
    await supabase.from('content_requests').update({ status }).eq('id', id)

    if (status === 'bestaetigt') {
      const req = contentRequests.find(r => r.id === id)
      if (req) {
        // Auto-create custom_content entry for the model
        await supabase.from('custom_content').insert({
          model_name: req.model_name,
          title: req.request_text,
          description: null,
          requested_by: req.chatter_name,
          created_date: new Date().toISOString().slice(0, 10),
        })

        // Send Telegram to model
        const { data: modelData } = await supabase.from('models_contact').select('telegram_id, name').eq('name', req.model_name).single()
        if (modelData?.telegram_id) {
          const deadlineText = req.deadline === 'asap' ? 'So schnell wie möglich' : req.deadline === 'hours' ? 'In den nächsten Stunden' : req.deadline === 'days' ? '1-2 Tage' : req.deadline === 'week' ? 'Diese Woche' : ''
          const msg = `<b>Neuer Custom Content Auftrag!</b>\n\n${req.request_text}${req.content_type ? '\nTyp: ' + req.content_type : ''}${req.price ? '\nPreis: $' + req.price : ''}${req.duration ? '\nLänge: ' + req.duration : ''}${deadlineText ? '\nDringlichkeit: ' + deadlineText : ''}\n\n– Thirteen 87`
          await sendTelegramMessage(modelData.telegram_id, msg)
        }
      }
    }

    loadContentRequests()
  }

  const inboxMessages = messages.filter(m => {
    if (m.direction !== 'in') return false
    if (section === 'models') return m.contact_type === 'model'
    if (section === 'chatters') return m.contact_type === 'chatter'
    return true
  })
  const historyMessages = messages.filter(m => {
    if (section === 'models') return m.contact_type === 'model'
    if (section === 'chatters') return m.contact_type === 'chatter'
    return true
  })
  const tdS = { padding: '10px 10px', borderBottom: '1px solid #1e1e3a', color: 'var(--text-secondary)', fontSize: 12 }
  const thS = { padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #2e2e5a', whiteSpace: 'nowrap' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[
          (section === 'models' || !section) && { key: 'models', label: 'Models', badge: (unreadRequests > 0 || modelBoardActivity.filter(a => !a.read).length > 0) ? 1 : 0 },
          section === 'models' && { key: 'modelboards', label: `Boards${modelBoardActivity.filter(a => !a.read).length > 0 ? ` (${modelBoardActivity.filter(a => !a.read).length})` : ''}` },
          section === 'models' && { key: 'content-requests', label: `Content-Anfragen${unreadRequests > 0 ? ` (${unreadRequests})` : ''}` },
          section === 'models' && { key: 'content-verlauf', label: 'Custom Verlauf' },
          section === 'models' && { key: 'nachrichten', label: 'Nachrichten', badge: messages.filter(m => m.direction === 'in' && !m.read && m.contact_type === 'model').length },
          section === 'models' && { key: 'history', label: 'Verlauf' },
          (section === 'chatters' || !section) && { key: 'chatters', label: 'Chatters', badge: swaps.filter(s => s.status === 'offen').length },
          section === 'chatters' && { key: 'pinnwand', label: `📌 Pinnwand${announcements.filter(a => !a.expires_at || new Date(a.expires_at) > new Date()).length > 0 ? ` (${announcements.filter(a => !a.expires_at || new Date(a.expires_at) > new Date()).length})` : ''}` },
          section === 'chatters' && { key: 'swaps', label: `Schicht-Tausch${swaps.filter(s => s.status === 'offen').length > 0 ? ` (${swaps.filter(s => s.status === 'offen').length})` : ''}` },
          section === 'chatters' && { key: 'stats', label: 'Statistik' },
          section === 'chatters' && { key: 'shiftlog', label: 'Schicht-Log' },
          section === 'chatters' && { key: 'nachrichten', label: 'Nachrichten', badge: messages.filter(m => m.direction === 'in' && !m.read && m.contact_type === 'chatter').length },
          section === 'chatters' && { key: 'history', label: 'Verlauf' },
        ].filter(Boolean).map(s => (
          <button key={s.key} onClick={() => {
            setActiveSection(s.key)
            if (s.key === 'models') { /* already loaded */ }
            if (s.key === 'modelboards') { loadModelBoardActivity(); models.forEach(m => loadModelBoard(m.name)) }
            if (s.key === 'content-requests') loadContentRequests()
            if (s.key === 'content-verlauf') loadContentRequests()
            if (s.key === 'chatters') { /* already loaded */ }
            if (s.key === 'swaps') loadSwaps()
            if (s.key === 'stats' || s.key === 'shiftlog') loadShiftLogs()
            if (s.key === 'pinnwand') loadAnnouncements()
            if (s.key === 'nachrichten') setUnreadCount(0)
          }} style={{
            padding: '7px 16px', borderRadius: 8, cursor: 'pointer',
            background: activeSection === s.key ? '#7c3aed' : 'transparent',
            color: activeSection === s.key ? '#fff' : s.badge > 0 ? '#f59e0b' : 'var(--text-secondary)',
            border: `1px solid ${activeSection === s.key ? '#7c3aed' : s.badge > 0 ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`,
            fontWeight: 600, fontSize: 13, fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {s.label}
            {s.badge > 0 && activeSection !== s.key && (
              <span style={{ background: '#f59e0b', color: '#000', fontSize: 10, fontWeight: 800, borderRadius: 10, padding: '1px 6px', lineHeight: 1.4 }}>{s.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* MODELS */}
      {activeSection === 'models' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>
          <Card title="Models">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {models.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '8px 0' }}>Noch keine Models angelegt</div>}
              {models.map(model => (
                <div key={model.id} onClick={() => setSelectedModel(model)} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 12px', background: 'var(--bg-card2)', borderRadius: 8,
                  border: `1px solid ${selectedModel?.id === model.id ? '#7c3aed' : 'var(--border)'}`,
                  cursor: 'pointer', transition: 'border-color 0.15s',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #7c3aed33, #06b6d433)', border: '1px solid #2e2e5a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#a78bfa', flexShrink: 0 }}>
                      {model.name[0]}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{model.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {(() => {
                          const s = model.status || 'unknown'
                          const until = model.status_until ? new Date(model.status_until) : null
                          const untilStr = until ? until.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : null
                          const color = s === 'available' ? '#10b981' : s === 'pause' ? '#f59e0b' : s === 'unavailable' ? '#ef4444' : '#555580'
                          const label = s === 'available' ? 'Verfügbar' : s === 'pause' ? `Pause${untilStr ? ` bis ${untilStr}` : ''}` : s === 'unavailable' ? `Nicht verfügbar${untilStr ? ` bis ${untilStr}` : ''}` : 'Unbekannt'
                          const isOnlineDash = model.last_seen && (Date.now() - new Date(model.last_seen)) < 180000
                          return <>
                            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: color, verticalAlign: 'middle' }} />
                            <span style={{ color }}>{label}</span>
                            {isOnlineDash && <span style={{ color: '#06b6d4', fontSize: 9, background: 'rgba(6,182,212,0.1)', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>ONLINE</span>}
                            {model.last_seen && <span style={{ color: 'var(--text-muted)' }}>· zuletzt {formatTime(model.last_seen)}</span>}
                          </>
                        })()}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{model.last_contacted ? formatTime(model.last_contacted) : '—'}</div>
                </div>
              ))}
            </div>
            {showAddModel
              ? <AddContactForm type="model" onSave={addModel} onCancel={() => setShowAddModel(false)} isOwner={isOwner} />
              : <button onClick={() => setShowAddModel(true)} style={{ width: '100%', background: 'transparent', border: '1px dashed #2e2e5a', color: 'var(--text-muted)', borderRadius: 8, padding: '9px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>+ Model hinzufügen</button>
            }
          </Card>

          <Card title="Nachricht senden">
            {!selectedModel ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>← Model auswählen</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>An: {selectedModel.name}</div>
                  <button onClick={() => setSelectedModel(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>✕</button>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {MODEL_MSG_TYPES.map(t => (
                    <button key={t.key} onClick={() => setModelMsgType(t.key)} style={{
                      fontSize: 11, padding: '4px 10px', borderRadius: 5, cursor: 'pointer',
                      background: modelMsgType === t.key ? 'rgba(124,58,237,0.2)' : 'transparent',
                      border: `1px solid ${modelMsgType === t.key ? '#7c3aed' : 'var(--border)'}`,
                      color: modelMsgType === t.key ? '#a78bfa' : 'var(--text-muted)',
                      fontFamily: 'inherit', fontWeight: 600,
                    }}>{t.label}</button>
                  ))}
                </div>
                <textarea value={modelMsgText} onChange={e => setModelMsgText(e.target.value)} rows={4}
                  style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '10px 12px', borderRadius: 8, fontSize: 13, resize: 'vertical', fontFamily: 'inherit', outline: 'none' }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {selectedModel.telegram_id ? '✈ via Telegram' : <span style={{ color: '#ef4444' }}>Kein Telegram</span>}
                  </div>
                  <button onClick={sendModelMessage} disabled={sendingModel || !modelMsgText.trim() || !selectedModel.telegram_id} style={{
                    background: modelMsgText.trim() && selectedModel.telegram_id ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : 'var(--border)',
                    color: modelMsgText.trim() && selectedModel.telegram_id ? '#fff' : 'var(--text-muted)',
                    border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  }}>{sendingModel ? 'Senden...' : 'Senden'}</button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* CHATTERS */}
      {activeSection === 'chatters' && (() => {
        // Aufmerksamkeits-Items berechnen
        const now = new Date()
        const activeAnnCount = announcements.filter(a => !a.expires_at || new Date(a.expires_at) > now).length
        const openSwapsCount = swaps.filter(s => s.status === 'offen').length
        const unreadOutMsgs = messages.filter(m => m.direction === 'out' && m.contact_type === 'chatter' && !m.read_at)
        // Out-Messages älter als 24h ungelesen = möglicherweise problematisch
        const oldUnreadOut = unreadOutMsgs.filter(m => new Date(m.created_at) < new Date(Date.now() - 24*60*60*1000))
        const attentionItems = []
        if (openSwapsCount > 0) attentionItems.push({ icon: '🔄', text: `${openSwapsCount} offene Schicht-Tausch-Anfragen`, color: '#f59e0b', action: 'swaps' })
        if (oldUnreadOut.length > 0) attentionItems.push({ icon: '⏳', text: `${oldUnreadOut.length} Nachrichten >24h ungelesen`, color: '#ef4444', action: 'history' })

        return (
        <div>
          {/* Aufmerksamkeits-Banner */}
          {attentionItems.length > 0 && (
            <div style={{ marginBottom: 16, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: 6 }}>
                🚨 Aufmerksamkeit
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {attentionItems.map((item, i) => (
                  <button key={i} onClick={() => setActiveSection(item.action)} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                    background: 'transparent', border: '1px solid transparent',
                    borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'background 0.1s'
                  }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(245,158,11,0.08)'}
                     onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <span style={{ fontSize: 14 }}>{item.icon}</span>
                    <span style={{ fontSize: 13, color: item.color, fontWeight: 600, flex: 1, textAlign: 'left' }}>{item.text}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>→</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quick-Info Pinnwand */}
          {activeAnnCount > 0 && (
            <div style={{ marginBottom: 16, background: 'rgba(124,58,237,0.05)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>📌</span>
                <span style={{ fontSize: 12, color: '#a78bfa', fontWeight: 600 }}>
                  {activeAnnCount} aktive Ankündigung{activeAnnCount !== 1 ? 'en' : ''} an alle Chatter
                </span>
              </div>
              <button onClick={() => setActiveSection('pinnwand')} style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 6,
                background: 'transparent', border: '1px solid rgba(124,58,237,0.3)',
                color: '#a78bfa', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600
              }}>Verwalten →</button>
            </div>
          )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>
          <Card title="Chatters">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {chatters.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '8px 0' }}>Noch keine Chatters angelegt</div>}
              {chatters.map(chatter => {
                const isSelected = selectedChatters.has(chatter.id)
                return (
                  <div key={chatter.id} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    <div onClick={() => toggleChatter(chatter.id)} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 12px', background: 'var(--bg-card2)', borderRadius: showAvailability === chatter.name ? '8px 8px 0 0' : 8,
                      border: `1px solid ${isSelected ? '#06b6d4' : 'var(--border)'}`,
                      cursor: 'pointer', transition: 'border-color 0.15s',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${isSelected ? '#06b6d4' : 'var(--border-bright)'}`, background: isSelected ? '#06b6d4' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {isSelected && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
                        </div>
                        <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #06b6d433, #7c3aed33)', border: '1px solid #2e2e5a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#06b6d4', flexShrink: 0 }}>
                          {chatter.name[0]}
                        </div>
                        <div>
                          {editingChatter?.id === chatter.id ? (
                            <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <input value={editChatterName} onChange={e => setEditChatterName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveChatterName(); if (e.key === 'Escape') setEditingChatter(null) }}
                                autoFocus
                                style={{ background: 'var(--bg-input)', border: '1px solid #7c3aed', color: 'var(--text-primary)', padding: '3px 7px', borderRadius: 5, fontSize: 12, fontFamily: 'inherit', outline: 'none', width: 100 }} />
                              <button onClick={saveChatterName} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: '#7c3aed', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>✓</button>
                              <button onClick={() => setEditingChatter(null)} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{chatter.name}</div>
                              <button onClick={e => { e.stopPropagation(); setEditingChatter(chatter); setEditChatterName(chatter.name) }} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>✎</button>
                            </div>
                          )}
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: AVAIL_COLORS[chatter.availability || 'unknown'], marginRight: 4, verticalAlign: 'middle' }} />
                            {AVAIL_LABELS[chatter.availability || 'unknown']}
                            {isOwner && chatter.telegram_id ? ` · TG: ${chatter.telegram_id}` : chatter.telegram_id ? ' · Telegram ✓' : ' · Kein Telegram'}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button onClick={e => { e.stopPropagation(); setShowAvailability(showAvailability === chatter.name ? null : chatter.name) }}
                          style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: availabilities[chatter.name]?.length ? 'rgba(6,182,212,0.1)' : 'transparent', color: availabilities[chatter.name]?.length ? '#06b6d4' : 'var(--text-muted)', border: `1px solid ${availabilities[chatter.name]?.length ? 'rgba(6,182,212,0.3)' : 'var(--border)'}`, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                          🗓 {availabilities[chatter.name]?.length ? availabilities[chatter.name].length : '+'}
                        </button>
                        <OnlineStatus
                          dashboardOnline={onlineStatuses[chatter.name]?.dashboardOnline || false}
                          shiftOnline={onlineStatuses[chatter.name]?.shiftOnline || false}
                        />
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                          {onlineStatuses[chatter.name]?.lastSeen && <span>zuletzt {formatTime(onlineStatuses[chatter.name].lastSeen)}</span>}
                          {chatter.last_contacted && <span>kontaktiert {formatTime(chatter.last_contacted)}</span>}
                        </div>
                      </div>
                    </div>
                    {/* Availability panel */}
                    {showAvailability === chatter.name && (
                      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-card)', border: '1px solid #06b6d4', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: '10px 12px' }}>
                        <div style={{ fontSize: 10, color: '#06b6d4', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Verfügbarkeit</div>
                        {/* Existing */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                          {(availabilities[chatter.name] || []).map(a => (
                            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.2)', borderRadius: 5, padding: '3px 8px', fontSize: 11 }}>
                              <span style={{ color: '#06b6d4', fontWeight: 700 }}>{DAY_NAMES[a.day_of_week]}</span>
                              <span style={{ color: 'var(--text-secondary)' }}>{a.time_from}–{a.time_to}</span>
                              <button onClick={() => deleteAvailability(a.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: 0, lineHeight: 1 }}>✕</button>
                            </div>
                          ))}
                          {(!availabilities[chatter.name] || availabilities[chatter.name].length === 0) && (
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Keine Verfügbarkeit eingetragen</span>
                          )}
                        </div>
                        {/* Add new */}
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <select value={newAvailDay} onChange={e => setNewAvailDay(e.target.value)}
                            style={{ background: 'var(--bg-input)', border: '1px solid var(--border-bright)', color: 'var(--text-primary)', padding: '4px 6px', borderRadius: 5, fontSize: 11, fontFamily: 'inherit', outline: 'none' }}>
                            <option value="">Tag</option>
                            {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
                          </select>
                          <input type="time" value={newAvailFrom} onChange={e => setNewAvailFrom(e.target.value)}
                            style={{ background: 'var(--bg-input)', border: '1px solid var(--border-bright)', color: 'var(--text-primary)', padding: '4px 6px', borderRadius: 5, fontSize: 11, fontFamily: 'monospace', outline: 'none' }} />
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>bis</span>
                          <input type="time" value={newAvailTo} onChange={e => setNewAvailTo(e.target.value)}
                            style={{ background: 'var(--bg-input)', border: '1px solid var(--border-bright)', color: 'var(--text-primary)', padding: '4px 6px', borderRadius: 5, fontSize: 11, fontFamily: 'monospace', outline: 'none' }} />
                          <button onClick={() => addAvailability(chatter.name)} disabled={newAvailDay === '' || !newAvailFrom || !newAvailTo}
                            style={{ background: 'rgba(6,182,212,0.12)', color: '#06b6d4', border: '1px solid rgba(6,182,212,0.3)', borderRadius: 5, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                            + Hinzufügen
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {showAddChatter
              ? <AddContactForm type="chatter" onSave={addChatter} onCancel={() => setShowAddChatter(false)} isOwner={isOwner} />
              : <button onClick={() => setShowAddChatter(true)} style={{ width: '100%', background: 'transparent', border: '1px dashed #2e2e5a', color: 'var(--text-muted)', borderRadius: 8, padding: '9px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>+ Chatter hinzufügen</button>
            }
          </Card>

          <Card title="Nachricht senden">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12, color: selectedChatters.size === 0 ? '#f59e0b' : '#10b981', fontWeight: 600 }}>
                {selectedChatters.size === 0
                  ? `An alle ${chatters.filter(c => c.telegram_id).length} Chatters`
                  : `An ${selectedChatters.size} ausgewählte Chatters`}
              </div>
              {selectedChatters.size > 0 && (
                <button onClick={() => setSelectedChatters(new Set())} style={{ alignSelf: 'flex-start', background: 'transparent', border: '1px solid #2e2e5a', color: 'var(--text-secondary)', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Auswahl aufheben
                </button>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {CHATTER_MSG_TYPES.map(t => (
                  <button key={t.key} onClick={() => setChatterMsgType(t.key)} style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 5, cursor: 'pointer',
                    background: chatterMsgType === t.key ? 'rgba(6,182,212,0.2)' : 'transparent',
                    border: `1px solid ${chatterMsgType === t.key ? '#06b6d4' : 'var(--border)'}`,
                    color: chatterMsgType === t.key ? '#06b6d4' : 'var(--text-muted)',
                    fontFamily: 'inherit', fontWeight: 600,
                  }}>{t.label}</button>
                ))}
              </div>
              {/* Zoom date/time picker */}
              {chatterMsgType === 'zoom' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Datum</label>
                      <input type="date" value={zoomDate} onChange={e => setZoomDate(e.target.value)}
                        style={{ background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '6px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'monospace', outline: 'none' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        Uhrzeit
                        <span style={{ color: '#7c3aed', marginLeft: 4 }}>
                          ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                        </span>
                      </label>
                      <input type="time" value={zoomTime} onChange={e => setZoomTime(e.target.value)}
                        style={{ background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '6px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'monospace', outline: 'none' }} />
                    </div>
                  </div>
                  {zoomDate && zoomTime && (() => {
                    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
                    const tzEncoded = encodeURIComponent(tz)
                    const d = zoomDate.replace(/-/g, '')
                    const t = zoomTime.replace(':', '') + '00'
                    const calUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=Zoom+Call+Thirteen+87&dates=${d}T${t}/${d}T${t}&ctz=${tzEncoded}&details=Team+Zoom+Call+Thirteen+87`
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 7 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>📅 Kalender-Link wird automatisch an die Nachricht angehängt</span>
                        <a href={calUrl} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 11, color: '#10b981', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}
                          onClick={e => e.stopPropagation()}>
                          Vorschau ↗
                        </a>
                      </div>
                    )
                  })()}
                </div>
              )}
              <textarea value={chatterMsgText} onChange={e => setChatterMsgText(e.target.value)} rows={4}
                style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '10px 12px', borderRadius: 8, fontSize: 13, resize: 'vertical', fontFamily: 'inherit', outline: 'none' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>✈ Jeder bekommt eine separate Nachricht</div>
                <button onClick={sendChatterMessage} disabled={sendingChatter || !chatterMsgText.trim()} style={{
                  background: chatterMsgText.trim() ? 'linear-gradient(135deg, #06b6d4, #0891b2)' : 'var(--border)',
                  color: chatterMsgText.trim() ? '#fff' : 'var(--text-muted)',
                  border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}>{sendingChatter ? 'Senden...' : `An ${selectedChatters.size === 0 ? 'alle' : selectedChatters.size} senden`}</button>
              </div>
            </div>
          </Card>
        </div>
        </div>
        )
      })()}

      {/* POSTEINGANG */}
      {activeSection === 'nachrichten' && (() => {
        // Type-Erkennung pro Message
        const getMsgType = (msg) => {
          if (msg.text === '[CONTENT_NOTIFY]') return 'content'
          if (msg.text?.startsWith('[STATUS_')) return 'status'
          return 'freitext'
        }
        // Multi-Filter
        const filtered = inboxMessages.filter(m => {
          if (inboxFilter !== 'all' && getMsgType(m) !== inboxFilter) return false
          if (inboxUnreadOnly && m.read) return false
          if (inboxPersonFilter !== 'all' && m.model_name !== inboxPersonFilter) return false
          return true
        })
        const counts = {
          all: inboxMessages.length,
          content: inboxMessages.filter(m => getMsgType(m) === 'content').length,
          status: inboxMessages.filter(m => getMsgType(m) === 'status').length,
          freitext: inboxMessages.filter(m => getMsgType(m) === 'freitext').length,
        }
        const uniquePersons = [...new Set(inboxMessages.map(m => m.model_name))].filter(Boolean).sort()
        const unreadCnt = inboxMessages.filter(m => !m.read).length
        const renderMsgText = (msg) => {
          const type = getMsgType(msg)
          if (type === 'content') return `📸 Hat neuen Content im OF-Tresor hochgeladen`
          if (type === 'status') {
            const inner = msg.text.replace(/^\[STATUS_/, '').replace(/\]$/, '').toLowerCase()
            return `🟡 Status: ${inner.replace(/_/g, ' ')}`
          }
          return msg.text
        }
        const typeBadge = (type) => {
          if (type === 'content') return { label: 'CONTENT', bg: 'rgba(34,197,94,0.15)', color: '#22c55e' }
          if (type === 'status') return { label: 'STATUS', bg: 'rgba(245,158,11,0.15)', color: '#f59e0b' }
          return { label: 'FREITEXT', bg: 'rgba(124,58,237,0.15)', color: '#a78bfa' }
        }
        return (
        <Card title={`Nachrichten (${filtered.length}${filtered.length !== counts.all ? ` von ${counts.all}` : ''})`}>
          {/* Type-Filter */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {[
              { key: 'all', label: `Alle (${counts.all})` },
              { key: 'content', label: `📸 Content (${counts.content})` },
              { key: 'status', label: `🟡 Status (${counts.status})` },
              { key: 'freitext', label: `💬 Freitext (${counts.freitext})` },
            ].map(f => (
              <button key={f.key} onClick={() => setInboxFilter(f.key)} style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                background: inboxFilter === f.key ? 'rgba(124,58,237,0.2)' : 'transparent',
                border: `1px solid ${inboxFilter === f.key ? '#7c3aed' : 'var(--border)'}`,
                color: inboxFilter === f.key ? '#a78bfa' : 'var(--text-secondary)',
                fontWeight: 600, fontFamily: 'inherit'
              }}>{f.label}</button>
            ))}
            {unreadCount > 0 && (
              <button onClick={markAllRead} style={{
                marginLeft: 'auto', background: 'transparent', border: '1px solid #2e2e5a',
                color: 'var(--text-secondary)', borderRadius: 6, padding: '4px 10px',
                fontSize: 11, cursor: 'pointer', fontFamily: 'inherit'
              }}>
                Alle als gelesen markieren
              </button>
            )}
          </div>

          {/* Person-Filter + Ungelesen-Toggle */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
            <button onClick={() => setInboxUnreadOnly(!inboxUnreadOnly)} style={{
              fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
              background: inboxUnreadOnly ? 'rgba(239,68,68,0.15)' : 'transparent',
              border: `1px solid ${inboxUnreadOnly ? '#ef4444' : 'var(--border)'}`,
              color: inboxUnreadOnly ? '#ef4444' : 'var(--text-secondary)',
              fontWeight: 600, fontFamily: 'inherit'
            }}>
              {inboxUnreadOnly ? '● Nur ungelesen' : `○ Nur ungelesen (${unreadCnt})`}
            </button>
            {uniquePersons.length > 1 && (
              <select value={inboxPersonFilter} onChange={e => setInboxPersonFilter(e.target.value)} style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                background: inboxPersonFilter !== 'all' ? 'rgba(124,58,237,0.15)' : 'var(--bg-input)',
                border: `1px solid ${inboxPersonFilter !== 'all' ? '#7c3aed' : 'var(--border)'}`,
                color: inboxPersonFilter !== 'all' ? '#a78bfa' : 'var(--text-secondary)',
                fontWeight: 600, fontFamily: 'inherit', outline: 'none'
              }}>
                <option value="all">Alle Personen</option>
                {uniquePersons.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
          </div>

          {filtered.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
              {inboxFilter === 'all' && !inboxUnreadOnly && inboxPersonFilter === 'all' ? 'Noch keine Nachrichten' : 'Keine Nachrichten passen zum Filter'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filtered.map(msg => {
                const tBadge = typeBadge(getMsgType(msg))
                return (
                <div key={msg.id} style={{
                  padding: '12px 14px', borderRadius: 8,
                  background: msg.read ? 'var(--bg-input)' : 'rgba(124,58,237,0.06)',
                  border: `1px solid ${msg.read ? 'var(--border)' : 'rgba(124,58,237,0.3)'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: msg.contact_type === 'chatter' ? '#06b6d4' : '#a78bfa' }}>{msg.model_name}</span>
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: msg.contact_type === 'chatter' ? 'rgba(6,182,212,0.15)' : 'rgba(124,58,237,0.15)', color: msg.contact_type === 'chatter' ? '#06b6d4' : '#a78bfa', fontWeight: 600 }}>
                        {msg.contact_type === 'chatter' ? 'Chatter' : 'Model'}
                      </span>
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: tBadge.bg, color: tBadge.color, fontWeight: 600 }}>
                        {tBadge.label}
                      </span>
                      {!msg.read && <span style={{ fontSize: 9, background: '#7c3aed', color: '#fff', padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>NEU</span>}
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{formatTime(msg.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 8 }}>{renderMsgText(msg)}</div>
                  {msg.model_telegram_id && (
                    replyingTo === msg.id ? (
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <input
                          autoFocus
                          value={replyText}
                          onChange={e => setReplyText(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendReply(msg)}
                          placeholder={`Antwort an ${msg.model_name}...`}
                          style={{ flex: 1, background: 'var(--bg-input)', border: '1px solid #7c3aed', color: 'var(--text-primary)', padding: '6px 10px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
                        />
                        <button onClick={() => sendReply(msg)} disabled={sendingReply || !replyText.trim()}
                          style={{ padding: '6px 12px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                          {sendingReply ? '...' : '↑ Senden'}
                        </button>
                        <button onClick={() => { setReplyingTo(null); setReplyText('') }}
                          style={{ padding: '6px 10px', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                      </div>
                    ) : (
                      <button onClick={() => { setReplyingTo(msg.id); setReplyText('') }}
                        style={{ fontSize: 10, padding: '3px 10px', borderRadius: 5, background: 'transparent', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.3)', cursor: 'pointer', fontFamily: 'inherit' }}>
                        ↩ Antworten
                      </button>
                    )
                  )}
                </div>
                )
              })}
            </div>
          )}
        </Card>
        )
      })()}

      {/* VERLAUF */}
      {activeSection === 'history' && (() => {
        const searchLower = historySearch.toLowerCase().trim()
        const filteredHistory = searchLower
          ? historyMessages.filter(m =>
              (m.text || '').toLowerCase().includes(searchLower) ||
              (m.model_name || '').toLowerCase().includes(searchLower) ||
              (m.sent_by || '').toLowerCase().includes(searchLower)
            )
          : historyMessages
        return (
        <Card title={`Nachrichtenverlauf${searchLower ? ` (${filteredHistory.length} von ${historyMessages.length})` : ''}`}>
          {messages.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Noch keine Nachrichten</div>
          ) : (
            <>
              {/* Such-Feld */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
                <input
                  type="text"
                  value={historySearch}
                  onChange={e => setHistorySearch(e.target.value)}
                  placeholder="🔍 Suche im Verlauf (Text, Name, Absender)..."
                  style={{
                    flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)',
                    color: 'var(--text-primary)', padding: '7px 12px', borderRadius: 7,
                    fontSize: 12, fontFamily: 'inherit', outline: 'none'
                  }}
                />
                {historySearch && (
                  <button onClick={() => setHistorySearch('')} style={{
                    fontSize: 11, padding: '6px 12px', borderRadius: 7, cursor: 'pointer',
                    background: 'transparent', border: '1px solid var(--border)',
                    color: 'var(--text-muted)', fontFamily: 'inherit'
                  }}>✕ Löschen</button>
                )}
              </div>
              {filteredHistory.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
                  Keine Treffer für "{historySearch}"
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>{['Zeit', 'Name', 'Typ', 'Richtung', 'Von', 'Nachricht', 'Status'].map(h => <th key={h} style={thS}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {filteredHistory.map(msg => (
                        <tr key={msg.id}>
                          <td style={{ ...tdS, fontFamily: 'monospace', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatTime(msg.created_at)}</td>
                          <td style={{ ...tdS, fontWeight: 600 }}>{msg.model_name}</td>
                          <td style={tdS}>
                            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 600, background: msg.contact_type === 'chatter' ? 'rgba(6,182,212,0.15)' : 'rgba(124,58,237,0.15)', color: msg.contact_type === 'chatter' ? '#06b6d4' : '#a78bfa' }}>
                              {msg.contact_type === 'chatter' ? 'Chatter' : 'Model'}
                            </span>
                          </td>
                          <td style={tdS}>
                            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 600, background: msg.direction === 'out' ? 'rgba(124,58,237,0.15)' : 'rgba(16,185,129,0.15)', color: msg.direction === 'out' ? '#a78bfa' : '#10b981' }}>
                              {msg.direction === 'out' ? '→ Gesendet' : '← Empfangen'}
                            </span>
                          </td>
                          <td style={{ ...tdS, fontWeight: 600, color: msg.direction === 'out' ? (msg.sent_by === 'Chris' ? '#a78bfa' : '#06b6d4') : '#10b981' }}>
                            {msg.direction === 'out' ? (msg.sent_by || '—') : msg.model_name}
                          </td>
                          <td style={{ ...tdS, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{msg.text}</td>
                          <td style={{ ...tdS, whiteSpace: 'nowrap' }}>
                            {msg.direction === 'out' ? (
                              msg.read_at ? (
                                <span title={`Gelesen ${new Date(msg.read_at).toLocaleString('de-DE')}`} style={{ fontSize: 10, color: '#10b981', fontWeight: 600 }}>
                                  ✓ {new Date(msg.read_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                </span>
                              ) : (
                                <span style={{ fontSize: 10, color: '#f59e0b', fontWeight: 600 }}>
                                  ⏳ ungelesen
                                </span>
                              )
                            ) : (
                              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Card>
        )
      })()}

      {/* CONTENT-ANFRAGEN */}
      {activeSection === 'content-requests' && (() => {
        const offeneRequests = contentRequests.filter(r => r.status !== 'erledigt' && r.status !== 'abgelehnt')
        const erledigteRequests = contentRequests.filter(r => r.status === 'erledigt' || r.status === 'abgelehnt')
        const filteredRequests = contentFilter === 'offen' ? offeneRequests
          : contentFilter === 'erledigt' ? erledigteRequests
          : contentRequests
        return (
        <Card title={`Content-Anfragen (${filteredRequests.length})`}>
          {/* Filter-Buttons */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {[
              { key: 'offen', label: `⏳ Offen (${offeneRequests.length})` },
              { key: 'erledigt', label: `✓ Erledigt (${erledigteRequests.length})` },
              { key: 'all', label: `Alle (${contentRequests.length})` },
            ].map(f => (
              <button key={f.key} onClick={() => setContentFilter(f.key)} style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                background: contentFilter === f.key ? 'rgba(124,58,237,0.2)' : 'transparent',
                border: `1px solid ${contentFilter === f.key ? '#7c3aed' : 'var(--border)'}`,
                color: contentFilter === f.key ? '#a78bfa' : 'var(--text-secondary)',
                fontWeight: 600, fontFamily: 'inherit'
              }}>{f.label}</button>
            ))}
          </div>
          {filteredRequests.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
              {contentFilter === 'offen' ? 'Keine offenen Anfragen 🎉' : contentFilter === 'erledigt' ? 'Noch keine erledigten Anfragen' : 'Noch keine Anfragen'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredRequests.map(req => {
                const statusColor = req.status === 'erledigt' ? '#10b981' : req.status === 'bestaetigt' ? '#06b6d4' : req.status === 'angefragt' ? '#f59e0b' : req.status === 'abgelehnt' ? '#ef4444' : '#a78bfa'
                const statusLabel = req.status === 'erledigt' ? '✓ Erledigt' : req.status === 'bestaetigt' ? '✓ Bestätigt' : req.status === 'angefragt' ? '⏳ Angefragt' : req.status === 'abgelehnt' ? '✕ Abgelehnt' : '● Neu'
                const remainder = (req.price || 0) - (req.deposit || 0)
                return (
                  <div key={req.id} style={{ padding: '12px 14px', background: 'var(--bg-card2)', borderRadius: 8, borderLeft: `3px solid ${statusColor}`, border: `1px solid ${req.status === 'neu' ? 'rgba(167,139,250,0.3)' : 'var(--border)'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#06b6d4' }}>{req.chatter_name}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>→</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa' }}>{req.model_name}</span>
                        {req.content_type && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: 'rgba(124,58,237,0.15)', color: '#a78bfa' }}>{req.content_type}</span>}
                        {req.customer_id && <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{req.customer_id}</span>}
                        {req.status === 'neu' && <span style={{ fontSize: 9, background: '#7c3aed', color: '#fff', padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>NEU</span>}
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', flexShrink: 0 }}>
                        {new Date(req.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} {new Date(req.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    {editingText === req.id ? (
                      <div style={{ marginBottom: 6 }}>
                        <textarea value={editTextValue} onChange={e => setEditTextValue(e.target.value)} rows={3}
                          style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #7c3aed', color: 'var(--text-primary)', padding: '6px 8px', borderRadius: 6, fontSize: 12, resize: 'vertical', fontFamily: 'inherit', outline: 'none' }} />
                        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                          <button onClick={async () => {
                            await supabase.from('content_requests').update({
                              edited_text: editTextValue.trim(),
                              edited_by: displayName || session?.user?.email?.split('@')[0] || 'Admin',
                              edited_at: new Date().toISOString(),
                            }).eq('id', req.id)
                            setEditingText(null); loadContentRequests()
                          }} style={{ fontSize: 10, padding: '3px 10px', borderRadius: 4, background: '#7c3aed', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>✓ Speichern</button>
                          <button onClick={() => setEditingText(null)} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>Abbrechen</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}>
                          {req.edited_text || req.request_text}
                        </div>
                        {req.edited_text && (
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            ✎ Geändert von {req.edited_by} · {new Date(req.edited_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} {new Date(req.edited_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                        <button onClick={() => { setEditingText(req.id); setEditTextValue(req.edited_text || req.request_text) }}
                          style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit', marginTop: 3 }}>✎ Text bearbeiten</button>
                      </div>
                    )}
                    {req.image_urls?.length > 0 && (
                      <div style={{ display: 'flex', gap: 5, marginBottom: 6, flexWrap: 'wrap' }}>
                        {req.image_urls.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noreferrer">
                            <img src={url} alt="" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 5, border: '1px solid #2e2e5a' }} />
                          </a>
                        ))}
                      </div>
                    )}
                    {req.price > 0 && (
                      <div style={{ marginBottom: 8, padding: '6px 8px', background: 'var(--bg-card)', borderRadius: 6 }}>
                        {editingPayment === req.id ? (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <div>
                              <label style={{ fontSize: 9, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Gesamtpreis</label>
                              <input type="number" value={editPrice} onChange={e => setEditPrice(e.target.value)}
                                style={{ width: 80, background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '3px 6px', borderRadius: 5, fontSize: 11, fontFamily: 'inherit' }} />
                            </div>
                            <div>
                              <label style={{ fontSize: 9, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Anzahlung</label>
                              <input type="number" value={editDeposit} onChange={e => setEditDeposit(e.target.value)}
                                style={{ width: 80, background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '3px 6px', borderRadius: 5, fontSize: 11, fontFamily: 'inherit' }} />
                            </div>
                            <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
                              <button onClick={async () => {
                                await supabase.from('content_requests').update({ price: parseFloat(editPrice) || 0, deposit: parseFloat(editDeposit) || 0 }).eq('id', req.id)
                                setEditingPayment(null); loadContentRequests()
                              }} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: '#10b981', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>✓</button>
                              <button onClick={() => setEditingPayment(null)} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#10b981' }}>Gesamt: ${req.price}</span>
                            {req.deposit > 0 ? (
                              <>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{ fontSize: 11, color: req.deposit_paid ? '#10b981' : '#f59e0b' }}>
                                    Anzahlung: ${req.deposit} {req.deposit_paid ? '✓' : '(offen)'}
                                  </span>
                                  {!req.deposit_paid && (
                                    <button onClick={async () => { await supabase.from('content_requests').update({ deposit_paid: true }).eq('id', req.id); loadContentRequests() }}
                                      style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', cursor: 'pointer', fontFamily: 'inherit' }}>✓ gezahlt</button>
                                  )}
                                </div>
                                {remainder > 0 && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ fontSize: 11, color: req.remainder_paid ? '#10b981' : '#ef4444' }}>
                                      Rest: ${remainder} {req.remainder_paid ? '✓' : '(offen)'}
                                    </span>
                                    {!req.remainder_paid && (
                                      <button onClick={async () => { await supabase.from('content_requests').update({ remainder_paid: true }).eq('id', req.id); loadContentRequests() }}
                                        style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', cursor: 'pointer', fontFamily: 'inherit' }}>✓ gezahlt</button>
                                    )}
                                  </div>
                                )}
                              </>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ fontSize: 11, color: req.deposit_paid ? '#10b981' : '#f59e0b' }}>
                                  Betrag {req.deposit_paid ? '✓ bezahlt' : '(offen)'}
                                </span>
                                {!req.deposit_paid && (
                                  <button onClick={async () => { await supabase.from('content_requests').update({ deposit_paid: true }).eq('id', req.id); loadContentRequests() }}
                                    style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', cursor: 'pointer', fontFamily: 'inherit' }}>✓ gezahlt</button>
                                )}
                              </div>
                            )}
                            <button onClick={() => { setEditingPayment(req.id); setEditPrice(String(req.price || '')); setEditDeposit(String(req.deposit || '')) }}
                              style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit', marginLeft: 'auto' }}>✎ Bearbeiten</button>
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                          {req.duration && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{req.duration}</span>}
                          {req.quantity > 1 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>×{req.quantity}</span>}
                          {req.deadline && <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: req.deadline === 'asap' ? 'rgba(239,68,68,0.15)' : req.deadline === 'hours' ? 'rgba(249,115,22,0.15)' : req.deadline === 'days' ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)', color: req.deadline === 'asap' ? '#ef4444' : req.deadline === 'hours' ? '#f97316' : req.deadline === 'days' ? '#f59e0b' : '#10b981' }}>
                            {req.deadline === 'asap' ? '⚡ ASAP' : req.deadline === 'hours' ? '⏰ Heute' : req.deadline === 'days' ? '📅 1-2 Tage' : '🗓 Diese Woche'}
                          </span>}
                        </div>
                      </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: statusColor }}>{statusLabel}</span>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {req.status !== 'angefragt' && req.status !== 'bestaetigt' && req.status !== 'erledigt' && (
                          <button onClick={() => updateRequestStatus(req.id, 'angefragt')} style={{ fontSize: 10, padding: '3px 10px', borderRadius: 5, background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>⏳ Angefragt</button>
                        )}
                        {req.status !== 'bestaetigt' && req.status !== 'erledigt' && (
                          <button onClick={() => updateRequestStatus(req.id, 'bestaetigt')} style={{ fontSize: 10, padding: '3px 10px', borderRadius: 5, background: 'rgba(6,182,212,0.12)', color: '#06b6d4', border: '1px solid rgba(6,182,212,0.3)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>✓ Bestätigen + TG</button>
                        )}
                        {req.status !== 'erledigt' && req.status !== 'abgelehnt' && (
                          <button onClick={() => updateRequestStatus(req.id, 'erledigt')} style={{ fontSize: 10, padding: '3px 10px', borderRadius: 5, background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>✓ Erledigt</button>
                        )}
                        {req.status !== 'abgelehnt' && req.status !== 'erledigt' && (
                          <button onClick={() => updateRequestStatus(req.id, 'abgelehnt')} style={{ fontSize: 10, padding: '3px 10px', borderRadius: 5, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>✕ Ablehnen</button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
        )
      })()}

      {/* CUSTOM VERLAUF */}
      {activeSection === 'content-verlauf' && (() => {
        const erledigte = contentRequests.filter(r => r.status === 'erledigt')
        const totalRevenue = erledigte.reduce((s, r) => s + (r.price || 0), 0)
        const byModel = erledigte.reduce((acc, r) => { acc[r.model_name] = (acc[r.model_name] || 0) + (r.price || 0); return acc }, {})
        const byChatter = erledigte.reduce((acc, r) => { acc[r.chatter_name] = (acc[r.chatter_name] || 0) + (r.price || 0); return acc }, {})
        return (
          <Card title={`Custom Content Verlauf (${erledigte.length})`}>
            {/* Totals */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 16 }}>
              <div style={{ background: 'var(--bg-card2)', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Gesamt Umsatz</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#10b981', fontFamily: 'monospace' }}>${totalRevenue.toFixed(2)}</div>
              </div>
              <div style={{ background: 'var(--bg-card2)', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Anzahl</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#a78bfa', fontFamily: 'monospace' }}>{erledigte.length}</div>
              </div>
            </div>

            {/* By Model */}
            {Object.keys(byModel).length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 700, marginBottom: 8 }}>Nach Model</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {Object.entries(byModel).sort((a, b) => b[1] - a[1]).map(([name, rev]) => (
                    <div key={name} style={{ padding: '4px 10px', background: 'rgba(167,139,250,0.1)', borderRadius: 6, border: '1px solid rgba(167,139,250,0.25)' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#a78bfa' }}>{name}</span>
                      <span style={{ fontSize: 11, color: '#10b981', marginLeft: 6, fontFamily: 'monospace' }}>${rev.toFixed(0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* By Chatter */}
            {Object.keys(byChatter).length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 700, marginBottom: 8 }}>Nach Chatter</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {Object.entries(byChatter).sort((a, b) => b[1] - a[1]).map(([name, rev]) => (
                    <div key={name} style={{ padding: '4px 10px', background: 'rgba(6,182,212,0.08)', borderRadius: 6, border: '1px solid rgba(6,182,212,0.25)' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#06b6d4' }}>{name}</span>
                      <span style={{ fontSize: 11, color: '#10b981', marginLeft: 6, fontFamily: 'monospace' }}>${rev.toFixed(0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Table */}
            {erledigte.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>Noch keine erledigten Anfragen</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>{['Datum', 'Chatter', 'Model', 'Typ', 'Kunde', 'Wunsch', 'Dringlichkeit', 'Preis', 'Anzahlung', 'Rest'].map(h => <th key={h} style={thS}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {erledigte.map(req => {
                      const remainder = (req.price || 0) - (req.deposit || 0)
                      const deadlineLabel = req.deadline === 'asap' ? '⚡ ASAP' : req.deadline === 'hours' ? '⏰ Heute' : req.deadline === 'days' ? '📅 1-2 Tage' : req.deadline === 'week' ? '🗓 Diese Woche' : '—'
                      const deadlineColor = req.deadline === 'asap' ? '#ef4444' : req.deadline === 'hours' ? '#f97316' : req.deadline === 'days' ? '#f59e0b' : '#10b981'
                      return (
                        <tr key={req.id}>
                          <td style={{ ...tdS, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{new Date(req.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</td>
                          <td style={{ ...tdS, fontWeight: 600, color: '#06b6d4' }}>{req.chatter_name}</td>
                          <td style={{ ...tdS, fontWeight: 600, color: '#a78bfa' }}>{req.model_name}</td>
                          <td style={tdS}>{req.content_type || '—'}</td>
                          <td style={{ ...tdS, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{req.customer_id || '—'}</td>
                          <td style={{ ...tdS, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={req.request_text}>{req.request_text || '—'}</td>
                          <td style={{ ...tdS, color: deadlineColor, fontWeight: 600, whiteSpace: 'nowrap' }}>{deadlineLabel}</td>
                          <td style={{ ...tdS, fontWeight: 700, color: '#10b981', fontFamily: 'monospace' }}>{req.price ? `$${req.price}` : '—'}</td>
                          <td style={{ ...tdS, color: req.deposit_paid ? '#10b981' : '#f59e0b', fontFamily: 'monospace' }}>{req.deposit ? `$${req.deposit}${req.deposit_paid ? ' ✓' : ' ⏳'}` : '—'}</td>
                          <td style={{ ...tdS, color: req.remainder_paid ? '#10b981' : remainder > 0 ? '#ef4444' : 'var(--text-muted)', fontFamily: 'monospace' }}>{req.deposit && remainder > 0 ? `$${remainder}${req.remainder_paid ? ' ✓' : ' ⏳'}` : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )
      })()}

      {/* SCHICHT-LOG */}
      {activeSection === 'shiftlog' && (
        <Card title="Schicht-Log">
          {shiftLogs.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Noch keine Schicht-Logs</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>{['Chatter', 'Schicht', 'Eingecheckt', 'Ausgecheckt', 'Dauer'].map(h => <th key={h} style={thS}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {shiftLogs.map(log => {
                    const inTime = new Date(log.checked_in_at)
                    const outTime = log.checked_out_at ? new Date(log.checked_out_at) : null
                    const diffMs = outTime ? outTime - inTime : null
                    const diffH = diffMs ? Math.floor(diffMs / 3600000) : null
                    const diffM = diffMs ? Math.floor((diffMs % 3600000) / 60000) : null
                    const dauer = diffH !== null ? `${diffH}h ${diffM}m` : '—'
                    const fmt = (d) => d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                    return (
                      <tr key={log.id}>
                        <td style={{ ...tdS, fontWeight: 700, color: 'var(--text-primary)' }}>{log.display_name}</td>
                        <td style={tdS}>
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(124,58,237,0.15)', color: '#a78bfa', fontWeight: 600 }}>
                            {log.shift || '—'}
                          </span>
                        </td>
                        <td style={{ ...tdS, fontFamily: 'monospace', color: '#10b981' }}>{fmt(inTime)}</td>
                        <td style={{ ...tdS, fontFamily: 'monospace', color: outTime ? '#ef4444' : 'var(--text-muted)' }}>
                          {outTime ? fmt(outTime) : <span style={{ color: '#10b981' }}>● Aktiv</span>}
                        </td>
                        <td style={{ ...tdS, fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-primary)' }}>{dauer}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* STATISTIK */}
      {activeSection === 'stats' && (
        <Card title="Chatter Statistik">
          {chatterStats.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Noch keine Daten</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {chatterStats.map(stat => {
                const avgH = stat.totalShifts > 0 ? (stat.totalMinutes / stat.totalShifts / 60).toFixed(1) : '—'
                const totalH = (stat.totalMinutes / 60).toFixed(0)
                return (
                  <div key={stat.name} style={{ padding: '14px 16px', background: 'var(--bg-card2)', borderRadius: 10, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(124,58,237,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#a78bfa', flexShrink: 0 }}>
                      {stat.name[0]}
                    </div>
                    <div style={{ flex: 1, minWidth: 120 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{stat.name}</div>
                    </div>
                    {[
                      { label: 'Schichten', val: stat.totalShifts },
                      { label: 'Gesamtstunden', val: `${totalH}h` },
                      { label: 'Ø pro Schicht', val: avgH !== '—' ? `${avgH}h` : '—' },
                    ].map(item => (
                      <div key={item.label} style={{ textAlign: 'center', minWidth: 80 }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{item.val}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{item.label}</div>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}

      {/* PINNWAND ADMIN */}
      {activeSection === 'pinnwand' && (
        <Card title="📌 Pinnwand für alle Chatter">
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
              Ankündigungen für alle Chatter — werden im ChatterPortal oben angezeigt.
              Maximal 2 aktive Posts gleichzeitig oben sichtbar (sortiert nach Priorität, dann Datum).
              Chatter können einzelne Posts archivieren — sie verschwinden dann von oben aber bleiben im Verlauf.
            </div>
            {!showAnnForm ? (
              <button onClick={() => setShowAnnForm(true)} style={{
                fontSize: 13, padding: '8px 16px', borderRadius: 8,
                background: '#7c3aed', border: 'none', color: '#fff',
                cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600
              }}>
                + Neue Ankündigung
              </button>
            ) : (
              <div style={{ background: 'var(--bg-card2)', border: '1px solid #7c3aed', borderRadius: 10, padding: 14 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Emoji:</label>
                  <input type="text" value={newAnnEmoji} onChange={e => setNewAnnEmoji(e.target.value)} maxLength={2}
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '5px 10px', borderRadius: 6, fontSize: 14, fontFamily: 'inherit', outline: 'none', width: 50, textAlign: 'center' }} />
                  <div style={{ display: 'flex', gap: 4 }}>
                    {['📌', '⚽', '📢', '🎯', '⚡', '🎬', '🚨', '🎉', '📋'].map(e => (
                      <button key={e} type="button" onClick={() => setNewAnnEmoji(e)} style={{
                        fontSize: 16, padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                        background: newAnnEmoji === e ? 'rgba(124,58,237,0.2)' : 'transparent',
                        border: `1px solid ${newAnnEmoji === e ? '#7c3aed' : 'var(--border)'}`,
                      }}>{e}</button>
                    ))}
                  </div>
                </div>
                <textarea
                  value={newAnnText}
                  onChange={e => setNewAnnText(e.target.value)}
                  placeholder="Was wollt ihr mitteilen? z.B. 'Heute 20:30 Zoom Call - Thema Q3 Goals' oder 'Fußball heute Abend nicht vergessen 😄'"
                  style={{
                    width: '100%', minHeight: 80, background: 'var(--bg-input)', border: '1px solid var(--border)',
                    color: 'var(--text-primary)', padding: '10px 12px', borderRadius: 7, fontSize: 13,
                    fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box'
                  }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Läuft ab:</label>
                  <input type="datetime-local" value={newAnnExpiresAt} onChange={e => setNewAnnExpiresAt(e.target.value)}
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '5px 10px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none' }} />
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>(optional - leer = kein Ablauf)</span>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button onClick={postAnnouncement} disabled={!newAnnText.trim()} style={{
                    fontSize: 13, padding: '8px 16px', borderRadius: 8,
                    background: newAnnText.trim() ? '#7c3aed' : 'var(--border)',
                    border: 'none', color: '#fff', cursor: newAnnText.trim() ? 'pointer' : 'not-allowed',
                    fontFamily: 'inherit', fontWeight: 600
                  }}>
                    Posten
                  </button>
                  <button onClick={() => { setShowAnnForm(false); setNewAnnText(''); setNewAnnEmoji('📌'); setNewAnnExpiresAt('') }} style={{
                    fontSize: 13, padding: '8px 16px', borderRadius: 8,
                    background: 'transparent', border: '1px solid var(--border)',
                    color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit'
                  }}>
                    Abbrechen
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: 10 }}>
              Alle Ankündigungen ({announcements.length})
            </div>
            {announcements.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Noch keine Ankündigungen</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {announcements.map(ann => {
                  const isExpired = ann.expires_at && new Date(ann.expires_at) < new Date()
                  const archivedFor = Array.isArray(ann.archived_for) ? ann.archived_for : []
                  return (
                    <div key={ann.id} style={{
                      padding: '12px 14px',
                      background: 'var(--bg-card2)',
                      borderRadius: 8,
                      border: `1px solid ${isExpired ? 'var(--border)' : 'rgba(124,58,237,0.3)'}`,
                      opacity: isExpired ? 0.5 : 1,
                      display: 'flex', alignItems: 'flex-start', gap: 12
                    }}>
                      <span style={{ fontSize: 20 }}>{ann.emoji}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{ann.text}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6, fontFamily: 'monospace', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          <span>Von {ann.created_by}</span>
                          <span>·</span>
                          <span>{new Date(ann.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                          {ann.expires_at && (
                            <>
                              <span>·</span>
                              <span style={{ color: isExpired ? '#ef4444' : 'var(--text-muted)' }}>
                                {isExpired ? 'Abgelaufen' : 'Läuft ab'}: {new Date(ann.expires_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </>
                          )}
                          {archivedFor.length > 0 && (
                            <>
                              <span>·</span>
                              <span title={archivedFor.join(', ')} style={{ color: '#10b981', cursor: 'help' }}>
                                ✓ Gelesen von {archivedFor.length}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <button onClick={() => deleteAnnouncement(ann.id)} title="Löschen" style={{
                        fontSize: 11, padding: '4px 10px', borderRadius: 6,
                        background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                        color: '#ef4444', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0
                      }}>✕ Löschen</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* SCHICHT-TAUSCH */}
      {activeSection === 'swaps' && (
        <Card title="Schicht-Tausch Anfragen">
          {swaps.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Keine Tausch-Anfragen</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {swaps.map(swap => (
                <div key={swap.id} style={{ padding: '14px 16px', background: 'var(--bg-card2)', borderRadius: 10, border: `1px solid ${swap.status === 'offen' ? 'rgba(245,158,11,0.3)' : swap.status === 'angenommen' ? 'rgba(16,185,129,0.3)' : 'var(--border)'}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                        <span style={{ color: '#a78bfa' }}>{swap.requester_name}</span> · {swap.shift}schicht · {new Date(swap.shift_date + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Model: {swap.model_name}{swap.reason ? ` · ${swap.reason}` : ''}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 700, background: swap.status === 'offen' ? 'rgba(245,158,11,0.15)' : swap.status === 'angenommen' ? 'rgba(16,185,129,0.15)' : 'rgba(100,100,120,0.15)', color: swap.status === 'offen' ? '#f59e0b' : swap.status === 'angenommen' ? '#10b981' : 'var(--text-muted)' }}>
                        {swap.status === 'offen' ? 'Offen' : swap.status === 'angenommen' ? `✓ ${swap.accepted_by}` : 'Abgelehnt'}
                      </span>
                      {swap.status === 'offen' && (
                        <>
                          <button onClick={() => updateSwap(swap.id, 'angenommen', 'Admin')} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>✓ Annehmen</button>
                          <button onClick={() => updateSwap(swap.id, 'abgelehnt')} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>✕ Ablehnen</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* MODEL BOARDS */}
      {activeSection === 'modelboards' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Unread Custom Content */}
          {unreadAdminCC.length > 0 && (
            <Card title={`Neue Custom Content Aufträge (${unreadAdminCC.length})`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                {unreadAdminCC.map(cc => (
                  <div key={cc.id} style={{ display: 'flex', gap: 10, padding: '9px 12px', background: 'rgba(124,58,237,0.05)', borderRadius: 8, border: '1px solid rgba(124,58,237,0.2)' }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(124,58,237,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#a78bfa', flexShrink: 0 }}>{cc.model_name[0]}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa' }}>{cc.model_name}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{new Date(cc.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{cc.title}</div>
                      {cc.requested_by && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>von {cc.requested_by}</div>}
                      {cc.due_date && <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 2 }}>fällig: {new Date(cc.due_date + 'T00:00:00').toLocaleDateString('de-DE')}</div>}
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={markAdminCCRead} style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, background: 'transparent', border: '1px solid #2e2e5a', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                Alle als gelesen markieren
              </button>
            </Card>
          )}

          <Card title="Letzte Änderungen">
            {modelBoardActivity.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0', textAlign: 'center' }}>Noch keine Änderungen</div>
            ) : (() => {
              const uniqueModels = [...new Set(modelBoardActivity.map(a => a.model_name))].sort()
              const filtered = boardsModelFilter === 'all'
                ? modelBoardActivity
                : modelBoardActivity.filter(a => a.model_name === boardsModelFilter)
              return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button onClick={() => setBoardsModelFilter('all')} style={{
                      fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                      background: boardsModelFilter === 'all' ? 'rgba(245,158,11,0.2)' : 'transparent',
                      border: `1px solid ${boardsModelFilter === 'all' ? '#f59e0b' : 'var(--border)'}`,
                      color: boardsModelFilter === 'all' ? '#f59e0b' : 'var(--text-secondary)',
                      fontWeight: 600, fontFamily: 'inherit'
                    }}>Alle ({modelBoardActivity.length})</button>
                    {uniqueModels.map(m => {
                      const cnt = modelBoardActivity.filter(a => a.model_name === m).length
                      return (
                        <button key={m} onClick={() => setBoardsModelFilter(m)} style={{
                          fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                          background: boardsModelFilter === m ? 'rgba(245,158,11,0.2)' : 'transparent',
                          border: `1px solid ${boardsModelFilter === m ? '#f59e0b' : 'var(--border)'}`,
                          color: boardsModelFilter === m ? '#f59e0b' : 'var(--text-secondary)',
                          fontWeight: 600, fontFamily: 'inherit'
                        }}>{m} ({cnt})</button>
                      )
                    })}
                  </div>
                  <button onClick={async () => {
                    await supabase.from('model_board_activity').update({ read: true }).eq('read', false)
                    setModelBoardActivity(prev => prev.map(a => ({ ...a, read: true })))
                  }} style={{ background: 'transparent', border: '1px solid #2e2e5a', color: 'var(--text-secondary)', borderRadius: 7, padding: '5px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Alle als gelesen markieren
                  </button>
                </div>
                {filtered.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0', textAlign: 'center' }}>Keine Änderungen für {boardsModelFilter}</div>
                ) : filtered.slice(0, 20).map(a => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: a.read ? 'var(--bg-card2)' : 'rgba(245,158,11,0.06)', borderRadius: 8, border: `1px solid ${a.read ? 'var(--border)' : 'rgba(245,158,11,0.2)'}` }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(245,158,11,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#f59e0b', flexShrink: 0 }}>
                      {a.model_name[0]}
                    </div>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b' }}>{a.model_name}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}> hat <b>{a.category}</b> {a.action}</span>
                      {a.details && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}> · {a.details}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {!a.read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />}
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {new Date(a.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              )
            })()}
          </Card>

          {/* Model buttons */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {models.map(m => (
              <button key={m.id} onClick={() => { setSelectedBoardModel(selectedBoardModel === m.name ? null : m.name); loadModelBoard(m.name) }}
                style={{ padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 12,
                  background: selectedBoardModel === m.name ? '#f59e0b' : 'transparent',
                  color: selectedBoardModel === m.name ? '#000' : 'var(--text-secondary)',
                  border: `1px solid ${selectedBoardModel === m.name ? '#f59e0b' : 'var(--border)'}` }}>
                {m.name}
              </button>
            ))}
          </div>
          {selectedBoardModel && modelBoards[selectedBoardModel] !== undefined && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Regular categories */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                {Object.entries(modelBoards[selectedBoardModel] || {}).map(([cat, items]) => {
                  const catColors = { preise: '#10b981', nogos: '#ef4444', regeln: '#a78bfa', services: '#f59e0b', einschraenkungen: '#06b6d4', reise: '#06b6d4', termine: '#7c3aed' }
                  const catLabels = { preise: 'Preisstruktur', nogos: 'No Gos', regeln: 'Content Regeln', services: 'Services', einschraenkungen: 'Einschränkungen', reise: 'Reiseplan', termine: 'Termine' }
                  const color = catColors[cat] || '#a78bfa'
                  return (
                    <div key={cat} style={{ background: 'var(--bg-card)', border: `1px solid #1e1e3a`, borderLeft: `3px solid ${color}`, borderRadius: '0 10px 10px 0', padding: '12px 14px' }}>
                      <div style={{ fontSize: 10, color, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 8 }}>{catLabels[cat] || cat}</div>
                      {items.map(item => (
                        <div key={item.id} style={{ padding: '7px 10px', background: 'var(--bg-card2)', borderRadius: 7, border: '1px solid var(--border)', marginBottom: 6 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{item.title}</div>
                          {item.content && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{item.content}</div>}
                          {item.price && <div style={{ fontSize: 12, fontWeight: 700, color, marginTop: 3 }}>{item.price}</div>}
                        </div>
                      ))}
                      {items.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Leer</div>}
                    </div>
                  )
                })}
              </div>

              {/* Services */}
              {modelServices[selectedBoardModel] && Object.keys(modelServices[selectedBoardModel]).length > 0 && (
                <div style={{ background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderLeft: '3px solid #f97316', borderRadius: '0 10px 10px 0', padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 8 }}>Services</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                    {Object.entries(modelServices[selectedBoardModel]).map(([key, svc]) => {
                      const labels = { bewertungen: 'Bewertungen', audios: 'Audios', video_chat: 'Video Chat (VC)', telefonieren: 'Telefonieren' }
                      return (
                        <div key={key} style={{ padding: '7px 10px', background: 'var(--bg-card2)', borderRadius: 7, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{labels[key] || key}</span>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: svc.enabled ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)', color: svc.enabled ? '#10b981' : '#ef4444' }}>
                              {svc.enabled ? 'Ja' : 'Nein'}
                            </span>
                          </div>
                          {svc.enabled && svc.note && <div style={{ fontSize: 11, color: '#f59e0b' }}>{svc.note}</div>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Custom Content */}
              {(modelCustomContent[selectedBoardModel] || []).length > 0 && (
                <div style={{ background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderLeft: '3px solid #7c3aed', borderRadius: '0 10px 10px 0', padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 8 }}>
                    Custom Content · {(modelCustomContent[selectedBoardModel] || []).filter(c => !c.completed).length} offen
                  </div>
                  {(modelCustomContent[selectedBoardModel] || []).map(cc => {
                    const isOverdue = cc.due_date && !cc.completed && cc.due_date < new Date().toISOString().slice(0, 10)
                    const color = cc.completed ? '#10b981' : isOverdue ? '#ef4444' : '#f59e0b'
                    return (
                      <div key={cc.id} style={{ padding: '7px 10px', background: 'var(--bg-card2)', borderRadius: 7, border: `1px solid ${color}33`, marginBottom: 6, opacity: cc.completed ? 0.6 : 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', textDecoration: cc.completed ? 'line-through' : 'none' }}>{cc.title}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: color + '22', color, flexShrink: 0 }}>
                            {cc.completed ? 'Erledigt' : isOverdue ? 'Überfällig' : 'Offen'}
                          </span>
                        </div>
                        {cc.requested_by && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>von {cc.requested_by}</div>}
                        {cc.due_date && <div style={{ fontSize: 10, color, marginTop: 2 }}>fällig: {new Date(cc.due_date + 'T00:00:00').toLocaleDateString('de-DE')}</div>}
                      </div>
                    )
                  })}
                </div>
              )}

              {Object.keys(modelBoards[selectedBoardModel] || {}).length === 0 && !modelServices[selectedBoardModel] && (
                <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>Noch kein Board für {selectedBoardModel}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
