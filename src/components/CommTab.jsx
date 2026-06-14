import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { sendTelegramMessage, sendTelegramPhoto, sendTelegramMediaGroup, notifyOwner } from '../telegram'
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
            {models.filter(m => m.active !== false).map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
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
  // v3.12.0: Single-Select für Detail-Ansicht im Chatters-Sub-Tab (separat vom Multi-Select-Set)
  const [selectedChatter, setSelectedChatter] = useState(null)
  const [chatterMsgType, setChatterMsgType] = useState('announcement')
  const [chatterMsgText, setChatterMsgText] = useState('')
  const [sendingChatter, setSendingChatter] = useState(false)
  const [showAddChatter, setShowAddChatter] = useState(false)
  const [zoomDate, setZoomDate] = useState('')
  const [zoomTime, setZoomTime] = useState('')
  // v3.22.0: Custom-Content Karten ein-/ausklappen. null = Default (ASAP/Neu offen).
  const [expandedReqs, setExpandedReqs] = useState(null)
  const toggleReqExpanded = (id) => setExpandedReqs(prev => {
    const base = prev === null
      ? new Set(contentRequests.filter(r => r.deadline === 'asap' || r.status === 'neu').map(r => r.id))
      : new Set(prev)
    base.has(id) ? base.delete(id) : base.add(id)
    return base
  })

  const [messages, setMessages] = useState([])
  // Chat-Thread State (v2.8.3)
  const [activeThreadName, setActiveThreadName] = useState(null) // ausgewählter Person-Name
  const [activeThreadType, setActiveThreadType] = useState(null) // 'model' | 'chatter' (für unified chat)
  const [chatInputText, setChatInputText] = useState('')
  const [chatSendingTo, setChatSendingTo] = useState(false)
  // v2.9.8: Bild-Anhänge im Chat
  const [chatAttachments, setChatAttachments] = useState([]) // [{file, previewUrl, resizing, uploadedUrl}]
  const [lightboxImage, setLightboxImage] = useState(null) // URL des aktuell vergrößerten Bildes
  const [chatSearch, setChatSearch] = useState('')
  const chatScrollRef = useRef(null)
  const [showNewChatPicker, setShowNewChatPicker] = useState(false)
  // v3.10.0: Massennachrichten im Chat-Tab
  const [newChatMode, setNewChatMode] = useState('single') // 'single' | 'broadcast'
  const [broadcastRecipientType, setBroadcastRecipientType] = useState('chatter') // 'chatter' | 'model'
  const [broadcastSelected, setBroadcastSelected] = useState(new Set()) // Set of contact ids
  const [broadcastMsgType, setBroadcastMsgType] = useState('announcement')
  const [broadcastText, setBroadcastText] = useState('')
  const [broadcastZoomDate, setBroadcastZoomDate] = useState('')
  const [broadcastZoomTime, setBroadcastZoomTime] = useState('')
  const [broadcastSending, setBroadcastSending] = useState(false)
  const [isMobileChat, setIsMobileChat] = useState(typeof window !== 'undefined' && window.innerWidth < 768)
  const [chatTypeFilter, setChatTypeFilter] = useState('all') // 'all' | 'chatter' | 'model'
  const [expandedMonths, setExpandedMonths] = useState({}) // {'2026-04': true} für Custom Verlauf Akkordeon
  const [editingRequest, setEditingRequest] = useState(null) // {...request} - öffnet Edit-Modal
  const [unreadCount, setUnreadCount] = useState(0)
  const [replyingTo, setReplyingTo] = useState(null) // msg.id
  const [replyText, setReplyText] = useState('')
  const [sendingReply, setSendingReply] = useState(false)
  const [activeSection, setActiveSection] = useState(() => {
    if (section === 'chat') return 'chat-unified'
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
  const [contentModelFilter, setContentModelFilter] = useState('all')
  const [contentChatterFilter, setContentChatterFilter] = useState('all')
  const [contentSearch, setContentSearch] = useState('')
  const [boardsModelFilter, setBoardsModelFilter] = useState('all')
  const [historySearch, setHistorySearch] = useState('')
  // Pinnwand
  const [announcements, setAnnouncements] = useState([])
  const [newAnnText, setNewAnnText] = useState('')
  const [newAnnEmoji, setNewAnnEmoji] = useState('📌')
  const [newAnnExpiresAt, setNewAnnExpiresAt] = useState('')
  const [showAnnForm, setShowAnnForm] = useState(false)
  // Content-Ideen Admin
  const [contentIdeas, setContentIdeas] = useState([])
  const [editingIdeaId, setEditingIdeaId] = useState(null)
  const [editingIdeaText, setEditingIdeaText] = useState('')
  const [editingAdminNote, setEditingAdminNote] = useState('')
  const [ideasFilter, setIdeasFilter] = useState('open')
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
    if (section === 'models') { loadContentRequests(); loadModelBoardActivity(); loadContentIdeas() }
    if (section === 'chatters') { loadShiftLogs(); loadSwaps(); loadNewAbsences() }
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

  // Auto-scroll im Chat-Thread bei neuer Nachricht
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
  }, [activeThreadName, messages])

  // Mobile-Detection für Chat-Layout
  useEffect(() => {
    const onResize = () => setIsMobileChat(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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

  const loadContentIdeas = async () => {
    const { data } = await supabase
      .from('content_ideas')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    setContentIdeas(data || [])
  }

  const updateIdeaStatus = async (id, newStatus) => {
    const updates = { status: newStatus, reviewed_by: displayName, reviewed_at: new Date().toISOString() }
    await supabase.from('content_ideas').update(updates).eq('id', id)
    loadContentIdeas()
  }

  const saveIdeaEdit = async (id) => {
    const updates = {
      edited_text: editingIdeaText.trim() || null,
      admin_note: editingAdminNote.trim() || null,
      reviewed_by: displayName,
      reviewed_at: new Date().toISOString(),
    }
    await supabase.from('content_ideas').update(updates).eq('id', id)
    setEditingIdeaId(null)
    setEditingIdeaText('')
    setEditingAdminNote('')
    loadContentIdeas()
  }

  const sendIdeaToModel = async (idea) => {
    const text = idea.edited_text || idea.idea_text
    const prioMap = { urgent: '🔥 DRINGEND', normal: '📅 Normal', nice: '💭 Wenn Zeit' }
    const catMap = { bilder: '📸 Bilder', videos: '🎬 Videos', audio: '🎙 Audio', sonstiges: '💭 Sonstiges' }
    const tgMsg = `<b>💡 Content-Idee vom Team</b>\n\n${catMap[idea.category] || ''} · ${prioMap[idea.priority] || ''}\n\n${text}${idea.admin_note ? '\n\n💬 Hinweis: ' + idea.admin_note : ''}\n\n– Thirteen 87`
    // Telegram an Model
    const { data: modelData } = await supabase.from('models_contact').select('telegram_id').eq('name', idea.model_name).maybeSingle()
    if (modelData?.telegram_id) {
      try {
        await sendTelegramMessage(modelData.telegram_id, tgMsg)
      } catch (err) {
        alert('Telegram-Fehler: ' + err.message)
        return
      }
    }
    // Auch in messages-Tabelle speichern
    await supabase.from('messages').insert({
      model_name: idea.model_name,
      contact_type: 'model',
      direction: 'out',
      text: text,
      sent_by: displayName,
      type: 'content_idea',
    })
    // Status updaten
    await supabase.from('content_ideas').update({
      sent_to_model_at: new Date().toISOString(),
      status: idea.status === 'offen' ? 'in_arbeit' : idea.status,
    }).eq('id', idea.id)
    loadContentIdeas()
  }

  const deleteIdea = async (id) => {
    if (!confirm('Idee wirklich löschen?')) return
    await supabase.from('content_ideas').delete().eq('id', id)
    loadContentIdeas()
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

  // v3.12.0: Helper für Pinnwand-Item-Darstellung (wiederverwendet im Chatters-Sub-Tab)
  const renderAnnouncementItem = (ann, now, onDelete) => {
    const isExpired = ann.expires_at && new Date(ann.expires_at) < now
    const archivedFor = Array.isArray(ann.archived_for) ? ann.archived_for : []
    return (
      <div key={ann.id} style={{
        padding: '9px 11px',
        background: 'var(--bg-card2)',
        borderRadius: 7,
        border: `1px solid ${isExpired ? 'var(--border)' : 'rgba(124,58,237,0.3)'}`,
        opacity: isExpired ? 0.5 : 1,
        display: 'flex', alignItems: 'flex-start', gap: 10,
      }}>
        <span style={{ fontSize: 17, flexShrink: 0 }}>{ann.emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.4 }}>{ann.text}</div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'monospace', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
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
        <button onClick={() => onDelete(ann.id)} title="Löschen" style={{
          fontSize: 10, padding: '3px 8px', borderRadius: 5,
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
          color: '#ef4444', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
        }}>✕</button>
      </div>
    )
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

  // v3.23.0: Stillgelegte/offboardete Personen aus AUSWAHL-Listen ausblenden.
  // active === false  -> ausgeblendet (offboarded/suspended). NULL/true -> aktiv.
  // WICHTIG: Nur für die Auswahl neuer Chats/Empfänger. Bestehende Threads &
  // History bleiben über die vollen Listen (models/chatters) erhalten.
  const activeModels = models.filter(m => m.active !== false)
  const activeChatters = chatters.filter(c => c.active !== false)


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
      ? activeChatters.filter(c => selectedChatters.has(c.id))
      : activeChatters.filter(c => c.telegram_id)

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

  // v3.10.0: Massennachricht aus dem Chat-Tab
  // Sendet an alle/ausgewählte Chatter ODER Models (nie gemischt)
  // - Schreibt in messages mit is_broadcast=true und sent_by=userName
  // - Sendet via Telegram an jeden Empfänger
  // - Bei bestehender Konversation → wird automatisch in den existierenden Chat-Thread eingehängt
  //   (weil Chat-Logik nach model_name + contact_type gruppiert)
  const sendBroadcast = async () => {
    if (!broadcastText.trim()) return
    setBroadcastSending(true)

    const contactList = broadcastRecipientType === 'chatter' ? activeChatters : activeModels
    const targets = broadcastSelected.size > 0
      ? contactList.filter(c => broadcastSelected.has(c.id))
      : contactList.filter(c => c.telegram_id)

    // Build calendar link for zoom
    let calLink = ''
    if (broadcastMsgType === 'zoom' && broadcastZoomDate && broadcastZoomTime) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      const d = broadcastZoomDate.replace(/-/g, '')
      const t = broadcastZoomTime.replace(':', '') + '00'
      calLink = `\n\n📅 Zum Kalender hinzufügen:\nhttps://calendar.google.com/calendar/render?action=TEMPLATE&text=Zoom+Call+Thirteen+87&dates=${d}T${t}/${d}T${t}&ctz=${encodeURIComponent(tz)}&details=Team+Zoom+Call`
    }

    let sent = 0
    for (const recipient of targets) {
      if (!recipient.telegram_id) continue
      const personalText = broadcastText.replace('{name}', recipient.name) + calLink
      try {
        await sendTelegramMessage(recipient.telegram_id, personalText)
        await supabase.from('messages').insert({
          model_name: recipient.name,
          model_telegram_id: recipient.telegram_id,
          direction: 'out',
          contact_type: broadcastRecipientType,
          message_type: broadcastMsgType,
          text: personalText,
          status: 'sent',
          sent_by: userName,
          is_broadcast: true,
        })
        // last_contacted aktualisieren
        const tableName = broadcastRecipientType === 'chatter' ? 'chatters_contact' : 'models_contact'
        await supabase.from(tableName).update({ last_contacted: new Date().toISOString() }).eq('id', recipient.id)
        sent++
      } catch (e) {
        console.error('Broadcast send failed for', recipient.name, e)
      }
    }
    // Reset
    setBroadcastText('')
    setBroadcastSelected(new Set())
    setBroadcastZoomDate('')
    setBroadcastZoomTime('')
    setBroadcastMsgType('announcement')
    setShowNewChatPicker(false)
    setNewChatMode('single')
    loadMessages()
    if (broadcastRecipientType === 'chatter') loadChatters()
    else loadModels()
    setBroadcastSending(false)
    alert(`✓ Massennachricht an ${sent} ${broadcastRecipientType === 'chatter' ? 'Chatter' : 'Models'} gesendet`)
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

  // v2.8.8: Custom Verlauf Edit nur für Admins (Chris + Rey)
  const isAdminUser = displayName === 'Chris' || displayName === 'Rey'
  const inputS = { background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '6px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none' }

  const saveEditedRequest = async (updates) => {
    if (!editingRequest) return
    if (!isAdminUser) { alert('Nur Admins dürfen editieren.'); return }
    const payload = {
      ...updates,
      edited_by: displayName,
      edited_at: new Date().toISOString(),
    }
    // deposit_paid_at / remainder_paid_at automatisch setzen wenn Status auf "bezahlt" toggelt
    if (updates.deposit_paid === true && !editingRequest.deposit_paid) {
      payload.deposit_paid_at = new Date().toISOString()
    }
    if (updates.remainder_paid === true && !editingRequest.remainder_paid) {
      payload.remainder_paid_at = new Date().toISOString()
    }
    const { error } = await supabase.from('content_requests').update(payload).eq('id', editingRequest.id)
    if (error) { alert('Fehler: ' + error.message); return }
    setEditingRequest(null)
    loadContentRequests()
  }

  const markAllRead = async () => {
    await supabase.from('messages').update({ read: true }).eq('direction', 'in').eq('read', false)
    loadMessages()
  }

  const markSingleInboxRead = async (msgId) => {
    await supabase.from('messages').update({ read: true }).eq('id', msgId)
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, read: true } : m))
  }

  const markFilteredInboxRead = async (msgIds) => {
    if (!msgIds || msgIds.length === 0) return
    await supabase.from('messages').update({ read: true }).in('id', msgIds)
    setMessages(prev => prev.map(m => msgIds.includes(m.id) ? { ...m, read: true } : m))
  }

  // Thread-spezifisch: alle eingehenden Nachrichten dieser Person als gelesen markieren
  const openChatThread = async (personName, contactType) => {
    setActiveThreadName(personName)
    setActiveThreadType(contactType)
    setChatInputText('')
    // Alle in-messages dieser Person die ungelesen sind: read=true
    const unreadIds = messages
      .filter(m => m.model_name === personName && m.contact_type === contactType
        && m.direction === 'in' && !m.read
        && (m.message_type === null || m.message_type === undefined))
      .map(m => m.id)
    if (unreadIds.length > 0) {
      await supabase.from('messages').update({ read: true }).in('id', unreadIds)
      setMessages(prev => prev.map(m => unreadIds.includes(m.id) ? { ...m, read: true } : m))
    }
  }

  // Senden im aktiven Thread
  // v2.9.8: Bild auf max 1920px Kantenlänge runterskalieren (Canvas) — gibt Blob zurück
  const resizeImage = (file, maxSize = 1920, quality = 0.85) => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        let { width, height } = img
        if (width <= maxSize && height <= maxSize) {
          // Schon klein genug — original zurückgeben
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
        canvas.toBlob(blob => {
          if (blob) resolve(blob)
          else reject(new Error('Canvas toBlob fehlgeschlagen'))
        }, 'image/jpeg', quality)
      }
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht geladen werden')) }
      img.src = url
    })
  }

  // v2.9.8: Bilder zur Chat-Eingabe hinzufügen (mit lokaler Preview)
  const handleChatImageSelect = async (fileList) => {
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'))
    if (files.length === 0) return
    const newAttachments = files.map(f => ({
      file: f,
      previewUrl: URL.createObjectURL(f),
      resizing: false,
      uploadedUrl: null,
    }))
    setChatAttachments(prev => [...prev, ...newAttachments])
  }

  const removeChatAttachment = (idx) => {
    setChatAttachments(prev => {
      const att = prev[idx]
      if (att?.previewUrl) URL.revokeObjectURL(att.previewUrl)
      return prev.filter((_, i) => i !== idx)
    })
  }

  // v2.9.8: Bilder zu Supabase Storage hochladen, Public-URLs zurückgeben
  const uploadChatAttachments = async () => {
    if (chatAttachments.length === 0) return []
    const urls = []
    for (const att of chatAttachments) {
      try {
        const blob = await resizeImage(att.file, 1920, 0.85)
        const ext = (att.file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
        const path = `chat/${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${ext}`
        const { error: uploadErr } = await supabase.storage.from('chat-attachments').upload(path, blob, {
          contentType: 'image/jpeg',
          cacheControl: '31536000',
        })
        if (uploadErr) {
          console.error('Upload-Fehler:', uploadErr)
          continue
        }
        const { data: pub } = supabase.storage.from('chat-attachments').getPublicUrl(path)
        if (pub?.publicUrl) urls.push(pub.publicUrl)
      } catch (e) {
        console.error('Resize/Upload fehlgeschlagen:', e)
      }
    }
    return urls
  }

  const sendChatThreadMessage = async (contactType) => {
    const text = chatInputText.trim()
    const hasImages = chatAttachments.length > 0
    if (!activeThreadName || (!text && !hasImages) || chatSendingTo) return
    // Telegram-ID lookup
    const contactsTable = contactType === 'model' ? 'models_contact' : 'chatters_contact'
    const { data: contact } = await supabase.from(contactsTable)
      .select('telegram_id, id').eq('name', activeThreadName).maybeSingle()
    if (!contact?.telegram_id) {
      alert(`${activeThreadName} hat keine Telegram-ID hinterlegt.`)
      return
    }
    setChatSendingTo(true)
    try {
      // Bilder hochladen falls vorhanden
      let imageUrls = []
      if (hasImages) {
        imageUrls = await uploadChatAttachments()
        if (imageUrls.length === 0) {
          alert('⚠ Bild-Upload fehlgeschlagen. Bitte erneut versuchen.')
          setChatSendingTo(false)
          return
        }
      }

      // Telegram-Versand
      let tgResult
      if (imageUrls.length > 0) {
        // Mit Bildern → sendPhoto (1) oder sendMediaGroup (mehrere)
        tgResult = await sendTelegramMediaGroup(contact.telegram_id, imageUrls, text)
      } else {
        tgResult = await sendTelegramMessage(contact.telegram_id, text)
      }
      const telegramOk = tgResult?.ok === true
      const errorReason = telegramOk ? null : (tgResult?.description || 'Unbekannter Fehler')
      // DB-Eintrag mit korrektem Status + image_urls
      await supabase.from('messages').insert({
        model_name: activeThreadName,
        model_telegram_id: contact.telegram_id,
        direction: 'out',
        contact_type: contactType,
        message_type: null,
        text: text || null,
        image_urls: imageUrls.length > 0 ? imageUrls : null,
        status: telegramOk ? 'sent' : 'failed',
        sent_by: userName,
      })
      const lastContactedTable = contactType === 'model' ? 'models_contact' : 'chatters_contact'
      await supabase.from(lastContactedTable)
        .update({ last_contacted: new Date().toISOString() })
        .eq('id', contact.id)
      // Aufräumen
      setChatInputText('')
      // Preview-URLs revoken um Memory-Leak zu vermeiden
      chatAttachments.forEach(a => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl) })
      setChatAttachments([])
      await loadMessages()
      if (!telegramOk) {
        const friendly = errorReason.toLowerCase().includes('chat not found')
          ? `${activeThreadName} hat den Bot vermutlich blockiert oder gelöscht. Bitte um /start an @thirteen87agency_bot bitten.`
          : errorReason.toLowerCase().includes('blocked')
          ? `${activeThreadName} hat den Bot blockiert.`
          : `Telegram-Fehler: ${errorReason}`
        alert(`⚠ Nachricht NICHT angekommen!\n\n${friendly}`)
      }
    } catch (e) {
      alert('Netzwerk-Fehler: ' + e.message)
    }
    setChatSendingTo(false)
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

  const [swapReactions, setSwapReactions] = useState([]) // [{swap_id, chatter_name, reaction, created_at}]

  // v3.30.0: neue Abwesenheiten von Chattern (für "Zu erledigen"-Chip)
  const [newAbsences, setNewAbsences] = useState([])
  const [showOldSwaps, setShowOldSwaps] = useState(false) // v3.30.1: alte/erledigte Tausch-Einträge ausblenden
  const loadNewAbsences = async () => {
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await supabase.from('absences')
      .select('*')
      .eq('source', 'chatter')
      .eq('seen_by_admin', false)
      .gte('date_to', today)
      .order('date_from')
    setNewAbsences(data || [])
  }
  const ackNewAbsences = async () => {
    if (newAbsences.length === 0) return
    const SH = ['Früh', 'Spät', 'Nacht']
    const lines = newAbsences.map(a => {
      const f = new Date(a.date_from + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
      const t = a.date_to !== a.date_from ? '–' + new Date(a.date_to + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : ''
      const scope = (a.available_shifts && a.available_shifts.length)
        ? ' (' + SH.filter(s => !a.available_shifts.includes(s)).join('/') + ' weg)'
        : ' (ganzer Tag)'
      return `• ${a.chatter_name}: ${f}${t}${scope}${a.reason ? ' – ' + a.reason : ''}`
    }).join('\n')
    alert('Neue Abwesenheiten von Chattern:\n\n' + lines + '\n\nDetails im Dienstplan unter "Abwesenheiten".')
    const ids = newAbsences.map(a => a.id)
    await supabase.from('absences').update({ seen_by_admin: true }).in('id', ids)
    loadNewAbsences()
  }

  const loadSwaps = async () => {
    const { data } = await supabase.from('shift_swaps').select('*').order('created_at', { ascending: false })
    setSwaps(data || [])
    const ids = (data || []).map(s => s.id)
    if (ids.length > 0) {
      const { data: reacts } = await supabase
        .from('swap_reactions').select('*').in('swap_id', ids)
        .order('created_at', { ascending: true })
      setSwapReactions(reacts || [])
    } else {
      setSwapReactions([])
    }
  }

  // Hilfs-Funktion: Telegram an einen Chatter
  const tgToChatter = async (chatterName, msg) => {
    if (!chatterName) return
    const { data: c } = await supabase.from('chatters_contact')
      .select('telegram_id').eq('name', chatterName).maybeSingle()
    if (c?.telegram_id) await sendTelegramMessage(c.telegram_id, msg)
  }

  // Race-safe Update: nur wenn Status noch 'offen' ist
  const safeUpdateSwapStatus = async (id, patch) => {
    const { error, count } = await supabase
      .from('shift_swaps').update(patch, { count: 'exact' })
      .eq('id', id).eq('status', 'offen')
    return { error, count }
  }

  // Admin weist die Schicht einem Chatter zu (final)
  const assignSwapTo = async (swap, chatterName) => {
    if (!swap || !chatterName) return
    if (!confirm(`Schicht an ${chatterName} vergeben?`)) return

    // Race-safe: nur wenn Status noch offen ist
    const { error, count } = await safeUpdateSwapStatus(swap.id, {
      status: 'angenommen',
      accepted_by: chatterName,
    })
    if (error) { alert('Fehler: ' + error.message); return }
    if (count === 0) {
      alert('Diese Schicht wurde inzwischen schon vergeben oder abgeschlossen.\nLade neu.')
      loadSwaps()
      return
    }

    const dateLabel = new Date(swap.shift_date + 'T00:00:00').toLocaleDateString('de-DE', {
      weekday: 'short', day: '2-digit', month: '2-digit',
    })
    const shiftLabel = `${dateLabel} · ${swap.shift} · ${swap.model_name}`

    // 1. Gewählter: bekommt Bestätigung
    await tgToChatter(chatterName, `✓ Du übernimmst die Schicht: ${shiftLabel}`)

    // 2. Anfragender (falls Chatter-Anfrage, nicht Admin-Angebot): bekommt Bestätigung
    if (swap.requester_name && swap.requester_name !== chatterName) {
      await tgToChatter(swap.requester_name, `✓ Deine Schicht-Anfrage wurde geklärt: ${shiftLabel}\nDie Schicht wird übernommen.`)
    }

    // 3. Andere Reagierer (uebernehmen/vielleicht), die NICHT gewählt wurden: anonyme Absage
    const reactionsForSwap = swapReactions.filter(r => r.swap_id === swap.id)
    const otherInterested = reactionsForSwap
      .filter(r => r.reaction !== 'abgelehnt' && r.chatter_name !== chatterName)
    for (const r of otherInterested) {
      await tgToChatter(r.chatter_name, `Die Schicht wurde an jemand anderen vergeben. Danke fürs Angebot.\n${shiftLabel}`)
    }

    loadSwaps()
  }

  // Admin setzt Schicht zurück auf 'offen' (nach Ablehnung oder versehentlich vergeben)
  // Behält 'abgelehnt'-Reaktionen, löscht 'uebernehmen'/'vielleicht' damit Chatter neu reagieren können
  const resetSwapToOpen = async (swapId) => {
    if (!confirm('Schicht wieder als offen ausschreiben?')) return
    await supabase.from('shift_swaps').update({
      status: 'offen', accepted_by: null,
    }).eq('id', swapId)
    await supabase.from('swap_reactions').delete()
      .eq('swap_id', swapId)
      .in('reaction', ['uebernehmen', 'vielleicht'])
    loadSwaps()
  }

  // Admin schließt Anfrage ab ohne Vergabe
  const closeSwap = async (swap) => {
    if (!confirm('Schicht-Anfrage abschließen ohne Vergabe?')) return
    const { error, count } = await safeUpdateSwapStatus(swap.id, { status: 'abgelehnt' })
    if (error) { alert('Fehler: ' + error.message); return }
    if (count === 0) {
      alert('Diese Schicht wurde inzwischen schon vergeben.')
      loadSwaps()
      return
    }
    const dateLabel = new Date(swap.shift_date + 'T00:00:00').toLocaleDateString('de-DE', {
      weekday: 'short', day: '2-digit', month: '2-digit',
    })
    const shiftLabel = `${dateLabel} · ${swap.shift} · ${swap.model_name}`

    // Anfragenden + alle Reagierer benachrichtigen
    if (swap.requester_name) {
      await tgToChatter(swap.requester_name, `✕ Schicht-Tausch nicht zustande gekommen.\n${shiftLabel}`)
    }
    const reactionsForSwap = swapReactions.filter(r => r.swap_id === swap.id && r.reaction !== 'abgelehnt')
    for (const r of reactionsForSwap) {
      if (r.chatter_name === swap.requester_name) continue // schon benachrichtigt
      await tgToChatter(r.chatter_name, `ℹ Schicht-Angebot wurde geschlossen.\n${shiftLabel}`)
    }
    loadSwaps()
  }

  // Top-Nav Badge zurücksetzen: alle offenen Schichten als gesehen markieren
  const markAllSwapsSeen = async () => {
    await supabase.from('shift_swaps')
      .update({ seen_by_admin: true })
      .eq('status', 'offen')
      .eq('seen_by_admin', false)
    loadSwaps()
  }

  // Admin-eigene Stornierung (nur eigener Admin-Angebote, also requester_name=NULL)
  const cancelAdminOffer = async (id) => {
    if (!confirm('Schicht-Angebot zurücknehmen?')) return

    // Vor dem Delete: Reagierer ermitteln, um sie zu benachrichtigen
    const { data: swap } = await supabase.from('shift_swaps').select('*').eq('id', id).maybeSingle()
    const reactionsForSwap = swapReactions.filter(r => r.swap_id === id && r.reaction !== 'abgelehnt')

    const { error } = await supabase.from('shift_swaps').delete()
      .eq('id', id).is('requester_name', null).eq('status', 'offen')
    if (error) { alert('Fehler: ' + error.message); return }

    // Telegram an alle die Interesse hatten
    if (swap && reactionsForSwap.length > 0) {
      const dateLabel = new Date(swap.shift_date + 'T00:00:00').toLocaleDateString('de-DE', {
        weekday: 'short', day: '2-digit', month: '2-digit',
      })
      const shiftLabel = `${dateLabel} · ${swap.shift} · ${swap.model_name}`
      for (const r of reactionsForSwap) {
        await tgToChatter(r.chatter_name, `ℹ Schicht-Angebot wurde zurückgezogen.\n${shiftLabel}`)
      }
    }
    loadSwaps()
  }

  // ---- v3.27.0: Block-Aktionen (mehrere shift_swaps-Zeilen mit gemeinsamer block_id) ----
  const blockModelsLabel = (rows) => rows.map(r => r.model_name).join(' + ')

  // Interessenten über alle Block-Zeilen, dedupliziert pro Chatter (außer abgelehnt)
  const blockInterested = (rows, exclude) => {
    const idSet = new Set(rows.map(r => r.id))
    const seen = new Map()
    for (const r of swapReactions) {
      if (!idSet.has(r.swap_id)) continue
      if (r.reaction === 'abgelehnt') continue
      if (exclude && r.chatter_name === exclude) continue
      if (!seen.has(r.chatter_name)) seen.set(r.chatter_name, r)
    }
    return [...seen.values()]
  }

  const blockShiftLabel = (rows) => {
    const first = rows[0]
    const dateLabel = new Date(first.shift_date + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
    return `${dateLabel} · ${first.shift} · ${blockModelsLabel(rows)}`
  }

  const assignSwapBlockTo = async (rows, chatterName) => {
    if (!rows.length || !chatterName) return
    if (!confirm(`Block an ${chatterName} vergeben (${blockModelsLabel(rows)})?`)) return
    let ok = 0
    for (const r of rows) {
      const { count } = await safeUpdateSwapStatus(r.id, { status: 'angenommen', accepted_by: chatterName })
      if (count) ok++
    }
    if (ok === 0) { alert('Dieser Block wurde inzwischen schon vergeben oder abgeschlossen.\nLade neu.'); loadSwaps(); return }
    const shiftLabel = blockShiftLabel(rows)
    await tgToChatter(chatterName, `✓ Du übernimmst den Block: ${shiftLabel}`)
    for (const r of blockInterested(rows, chatterName)) {
      await tgToChatter(r.chatter_name, `Der Block wurde an jemand anderen vergeben. Danke fürs Angebot.\n${shiftLabel}`)
    }
    loadSwaps()
  }

  const resetSwapBlockToOpen = async (rows) => {
    if (!rows.length) return
    if (!confirm('Block wieder als offen ausschreiben?')) return
    const ids = rows.map(r => r.id)
    await supabase.from('shift_swaps').update({ status: 'offen', accepted_by: null }).in('id', ids)
    await supabase.from('swap_reactions').delete().in('swap_id', ids).in('reaction', ['uebernehmen', 'vielleicht'])
    loadSwaps()
  }

  const cancelAdminOfferBlock = async (rows) => {
    if (!rows.length) return
    if (!confirm(`Block-Angebot zurücknehmen (${blockModelsLabel(rows)})?`)) return
    const ids = rows.map(r => r.id)
    const interested = blockInterested(rows, null)
    const { error } = await supabase.from('shift_swaps').delete()
      .in('id', ids).is('requester_name', null).eq('status', 'offen')
    if (error) { alert('Fehler: ' + error.message); return }
    if (interested.length > 0) {
      const shiftLabel = blockShiftLabel(rows)
      for (const r of interested) {
        await tgToChatter(r.chatter_name, `ℹ Block-Angebot wurde zurückgezogen.\n${shiftLabel}`)
      }
    }
    loadSwaps()
  }

  // Swaps in Anzeige-Einträge gruppieren: Block-Zeilen (gleiche block_id) zusammen
  const groupSwaps = (list) => {
    const blocks = new Map()
    const entries = []
    for (const swap of list) {
      if (swap.block_id) {
        if (!blocks.has(swap.block_id)) {
          const entry = { key: 'block-' + swap.block_id, isBlock: true, rows: [], rep: swap }
          blocks.set(swap.block_id, entry)
          entries.push(entry)
        }
        blocks.get(swap.block_id).rows.push(swap)
      } else {
        entries.push({ key: 'swap-' + swap.id, isBlock: false, rows: [swap], rep: swap })
      }
    }
    // Pro Eintrag: modelsLabel + (deduplizierte) Reaktionen berechnen
    for (const e of entries) {
      e.modelsLabel = e.isBlock ? blockModelsLabel(e.rows) : e.rep.model_name
      if (e.isBlock) {
        const idSet = new Set(e.rows.map(r => r.id))
        const seen = new Map()
        for (const r of swapReactions) {
          if (!idSet.has(r.swap_id)) continue
          if (!seen.has(r.chatter_name)) seen.set(r.chatter_name, r)
        }
        e.reactions = [...seen.values()]
      } else {
        e.reactions = swapReactions.filter(r => r.swap_id === e.rep.id)
      }
    }
    // v3.28.1: nach Datum sortieren — offene zuerst, dann chronologisch
    entries.sort((a, b) => {
      const aOpen = a.rep.status === 'offen' ? 0 : 1
      const bOpen = b.rep.status === 'offen' ? 0 : 1
      if (aOpen !== bOpen) return aOpen - bOpen
      return (a.rep.shift_date || '').localeCompare(b.rep.shift_date || '')
    })
    return entries
  }

  // v3.28.3: Swaps als Einheiten zählen — ein Block (gleiche block_id) zählt als 1
  const swapUnitKey = (s) => s.block_id || ('id:' + s.id)
  const openSwapUnitCount = () => {
    const open = swaps.filter(s => s.status === 'offen')
    return new Set(open.map(swapUnitKey)).size
  }
  const reactedSwapUnitCount = () => {
    const open = swaps.filter(s => s.status === 'offen')
    const byId = new Map(open.map(s => [s.id, s]))
    const units = new Set()
    for (const r of swapReactions) {
      if (r.reaction === 'abgelehnt') continue
      const s = byId.get(r.swap_id)
      if (s) units.add(swapUnitKey(s))
    }
    return units.size
  }

  const [contentRequests, setContentRequests] = useState([])
  const [unreadRequests, setUnreadRequests] = useState(0)
  const [editingPayment, setEditingPayment] = useState(null) // req.id
  const [editPrice, setEditPrice] = useState('')
  const [editDeposit, setEditDeposit] = useState('')
  // Datums-Picker für Mark-Paid + Rest-Fälligkeit
  const [showDatePicker, setShowDatePicker] = useState(null) // { reqId, type: 'deposit'|'remainder'|'due' }
  const [pickerDate, setPickerDate] = useState('')

  const todayIso = () => new Date().toISOString().slice(0, 10)

  const markPaymentPaid = async (req, type, dateStr) => {
    const date = dateStr || new Date().toISOString()
    if (type === 'deposit') {
      await supabase.from('content_requests').update({ deposit_paid: true, deposit_paid_at: date }).eq('id', req.id)
    } else if (type === 'remainder') {
      await supabase.from('content_requests').update({ remainder_paid: true, remainder_paid_at: date }).eq('id', req.id)
    }
    loadContentRequests()
  }

  const setRemainderDueDate = async (reqId, dateStr) => {
    await supabase.from('content_requests').update({ remainder_due_at: dateStr || null }).eq('id', reqId)
    loadContentRequests()
  }
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

  // Helper: TG-Notification an Chatter über Status-Wechsel seiner Custom-Content-Anfrage
  const notifyChatterStatusChange = async (req, newStatus) => {
    if (!req?.chatter_name) return
    try {
      // Telegram-ID des Chatters holen
      const { data: chatterData } = await supabase.from('chatters_contact').select('telegram_id').eq('name', req.chatter_name).maybeSingle()
      if (!chatterData?.telegram_id) return

      const customer = req.customer_id ? `\n👤 Kunde: ${req.customer_id}` : ''
      const price = req.price ? `\n💰 $${req.price}` : ''
      const header = `${req.model_name} · Custom Content`

      let body = ''
      if (newStatus === 'angefragt') {
        body = `📥 <b>Deine Anfrage ist beim Model eingereicht</b>\n\nWir warten auf Antwort.\n\n${header}${customer}${price}`
      } else if (newStatus === 'bestaetigt') {
        body = `✓ <b>${req.model_name} hat Anfrage angenommen</b>\n\n${header}${customer}${price}\n\n– Thirteen 87`
      } else if (newStatus === 'erledigt') {
        const remainder = (req.price || 0) - (req.deposit || 0)
        const restLine = (remainder > 0 && !req.remainder_paid) ? `\n⚠ Rest noch offen: $${remainder}` : ''
        body = `✅ <b>${req.model_name} hat fertig</b>\n\nDu kannst raussenden.\n\n${header}${customer}${price}${restLine}\n\n– Thirteen 87`
      } else if (newStatus === 'abgelehnt') {
        body = `❌ <b>${req.model_name} hat abgelehnt</b>\n\n${header}${customer}${price}`
      } else {
        return
      }
      await sendTelegramMessage(chatterData.telegram_id, body)
    } catch (e) {
      console.error('notifyChatterStatusChange failed:', e)
    }
  }

  const updateRequestStatus = async (id, status) => {
    const req = contentRequests.find(r => r.id === id)
    await supabase.from('content_requests').update({ status }).eq('id', id)

    // Telegram an Chatter über Status-Wechsel (egal welcher Status)
    if (req && (status === 'angefragt' || status === 'bestaetigt' || status === 'erledigt' || status === 'abgelehnt')) {
      await notifyChatterStatusChange(req, status)
    }

    // v3.21.0: Bei "Angefragt" das Model per Telegram fragen, ob es den Content macht
    if (status === 'angefragt' && req) {
      const { data: modelData } = await supabase.from('models_contact').select('telegram_id, name').eq('name', req.model_name).maybeSingle()
      if (modelData?.telegram_id) {
        const deadlineText = req.deadline === 'asap' ? 'So schnell wie möglich' : req.deadline === 'hours' ? 'In den nächsten Stunden' : req.deadline === 'days' ? '1-2 Tage' : req.deadline === 'week' ? 'Diese Woche' : ''
        const remainder = (req.price || 0) - (req.deposit || 0)
        let payLine = ''
        if (req.price > 0) {
          if (req.deposit > 0 && remainder > 0) {
            const depTxt = req.deposit_paid ? `${req.deposit}$ ✓` : `${req.deposit}$ (offen)`
            const restTxt = req.remainder_paid ? `${remainder}$ ✓` : `${remainder}$ nach Lieferung`
            payLine = `\n💰 Gesamt: ${req.price}$ — Anzahlung ${depTxt} · Rest ${restTxt}`
          } else if (req.deposit_paid || req.remainder_paid) {
            payLine = `\n💰 ${req.price}$ ✓ vollständig bezahlt`
          } else {
            payLine = `\n💰 ${req.price}$ — offen`
          }
        }
        const customerLine = req.customer_id ? `\n👤 Kunde: ${req.customer_id}` : ''
        const text = req.edited_text || req.request_text
        const msg = `<b>📥 Neue Content-Anfrage für dich</b>\n\n${text}${customerLine}${req.content_type ? '\n🎬 Typ: ' + req.content_type : ''}${req.duration ? '\n⏱ Länge: ' + req.duration : ''}${payLine}${deadlineText ? '\n📅 Bis: ' + deadlineText : ''}\n\nMagst du das übernehmen? Antworte einfach hier — das Team bekommt deine Rückmeldung.\n\n– Thirteen 87`
        await sendTelegramMessage(modelData.telegram_id, msg)
      }
    }

    if (status === 'bestaetigt' && req) {
      // Telegram ans Model schicken (KEIN doppel-Insert in custom_content mehr — content_requests ist die source of truth)
      const { data: modelData } = await supabase.from('models_contact').select('telegram_id, name').eq('name', req.model_name).maybeSingle()
      if (modelData?.telegram_id) {
        const deadlineText = req.deadline === 'asap' ? 'So schnell wie möglich' : req.deadline === 'hours' ? 'In den nächsten Stunden' : req.deadline === 'days' ? '1-2 Tage' : req.deadline === 'week' ? 'Diese Woche' : ''
        const remainder = (req.price || 0) - (req.deposit || 0)
        let payLine = ''
        if (req.price > 0) {
          if (req.deposit > 0 && remainder > 0) {
            const depTxt = req.deposit_paid ? `${req.deposit}$ ✓` : `${req.deposit}$ (offen)`
            const restTxt = req.remainder_paid ? `${remainder}$ ✓` : `${remainder}$ nach Lieferung`
            payLine = `\n💰 Gesamt: ${req.price}$ — Anzahlung ${depTxt} · Rest ${restTxt}`
          } else if (req.deposit_paid || req.remainder_paid) {
            payLine = `\n💰 ${req.price}$ ✓ vollständig bezahlt`
          } else {
            payLine = `\n💰 ${req.price}$ — offen`
          }
        }
        const customerLine = req.customer_id ? `\n👤 Kunde: ${req.customer_id}` : ''
        const text = req.edited_text || req.request_text
        const msg = `<b>📸 Custom Content — Auftrag</b>\n\n${text}${customerLine}${req.content_type ? '\n🎬 Typ: ' + req.content_type : ''}${req.duration ? '\n⏱ Länge: ' + req.duration : ''}${payLine}${deadlineText ? '\n📅 Bis: ' + deadlineText : ''}\n\n– Thirteen 87`
        await sendTelegramMessage(modelData.telegram_id, msg)
      }
    }

    loadContentRequests()
  }

  // v2.8.3: Tickets = Nachrichten MIT message_type (announcement, content_request, zoom, free, ...)
  //         Chat    = Nachrichten OHNE message_type (reine Konversation)
  const isTicket = (m) => m.message_type !== null && m.message_type !== undefined
  const isChat = (m) => !isTicket(m)

  const inboxMessages = messages.filter(m => {
    if (m.direction !== 'in') return false
    if (m.contact_type === 'unknown') return false
    if (!isTicket(m)) return false
    if (section === 'models') return m.contact_type === 'model'
    if (section === 'chatters') return m.contact_type === 'chatter'
    return true
  })
  const historyMessages = messages.filter(m => {
    if (m.contact_type === 'unknown') return false
    if (!isTicket(m)) return false
    if (section === 'models') return m.contact_type === 'model'
    if (section === 'chatters') return m.contact_type === 'chatter'
    return true
  })
  const tdS = { padding: '10px 10px', borderBottom: '1px solid #1e1e3a', color: 'var(--text-secondary)', fontSize: 12 }
  const thS = { padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #2e2e5a', whiteSpace: 'nowrap' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Tabs (nur in models/chatters Sections, NICHT im zentralen Chat) */}
      {section !== 'chat' && (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[
          (section === 'models' || !section) && { key: 'models', label: 'Models', badge: (unreadRequests > 0 || modelBoardActivity.filter(a => !a.read).length > 0) ? 1 : 0 },
          section === 'models' && { key: 'content-requests', label: `Custom Content${unreadRequests > 0 ? ` (${unreadRequests})` : ''}` },
          section === 'models' && { key: 'content-verlauf', label: 'Custom Verlauf' },
          section === 'models' && { key: 'content-ideas', label: `💡 Content-Ideen${contentIdeas.filter(i => i.status === 'offen').length > 0 ? ` (${contentIdeas.filter(i => i.status === 'offen').length})` : ''}` },
          section === 'models' && { key: 'nachrichten', label: 'Tickets', badge: messages.filter(m => m.direction === 'in' && !m.read && m.contact_type === 'model' && m.message_type !== null && m.message_type !== undefined).length },
          (section === 'chatters' || !section) && { key: 'chatters', label: 'Chatters', badge: reactedSwapUnitCount() },
          section === 'chatters' && { key: 'swaps', label: (() => {
            const cnt = reactedSwapUnitCount()
            return `Schicht-Tausch${cnt > 0 ? ` (${cnt})` : ''}`
          })() },
          section === 'chatters' && { key: 'stats', label: 'Statistik' },
          section === 'chatters' && { key: 'shiftlog', label: 'Schicht-Log' },
          section === 'chatters' && { key: 'nachrichten', label: 'Tickets', badge: messages.filter(m => m.direction === 'in' && !m.read && m.contact_type === 'chatter' && m.message_type !== null && m.message_type !== undefined).length },
        ].filter(Boolean).map(s => (
          <button key={s.key} onClick={() => {
            setActiveSection(s.key)
            if (s.key === 'models') { loadModelBoardActivity() }
            if (s.key === 'modelboards') { loadModelBoardActivity(); models.forEach(m => loadModelBoard(m.name)) }
            if (s.key === 'content-requests') loadContentRequests()
            if (s.key === 'content-verlauf') loadContentRequests()
            if (s.key === 'content-ideas') loadContentIdeas()
            if (s.key === 'chatters') { loadAnnouncements() }
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
      )}

      {/* MODELS */}
      {activeSection === 'models' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>
          <Card title="Models">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {activeModels.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '8px 0' }}>Noch keine Models angelegt</div>}
              {activeModels.map(model => {
                // v3.11.0: Board-Activity Counts
                const modelActivities = modelBoardActivity.filter(a => a.model_name === model.name)
                const unreadBoardCount = modelActivities.filter(a => !a.read).length
                return (
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
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {model.name}
                        {unreadBoardCount > 0 && (
                          <span title={`${unreadBoardCount} ungelesene Board-Änderungen`} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 3,
                            background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
                            border: '1px solid rgba(245,158,11,0.35)',
                            fontSize: 10, fontWeight: 700,
                            padding: '1px 6px', borderRadius: 4,
                          }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#f59e0b' }} />
                            {unreadBoardCount}
                          </span>
                        )}
                      </div>
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
                )
              })}
            </div>
            {showAddModel
              ? <AddContactForm type="model" onSave={addModel} onCancel={() => setShowAddModel(false)} isOwner={isOwner} />
              : <button onClick={() => setShowAddModel(true)} style={{ width: '100%', background: 'transparent', border: '1px dashed #2e2e5a', color: 'var(--text-muted)', borderRadius: 8, padding: '9px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>+ Model hinzufügen</button>
            }
          </Card>

          {/* v3.11.0: Board-Activity Feed (ersetzt "Nachricht senden") */}
          <Card title={selectedModel ? `Board-Aktivität · ${selectedModel.name}` : 'Letzte Board-Änderungen'}>
            {(() => {
              const filtered = selectedModel
                ? modelBoardActivity.filter(a => a.model_name === selectedModel.name)
                : modelBoardActivity
              const sorted = [...filtered].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
              const displayed = sorted.slice(0, 20)
              const unreadInList = sorted.filter(a => !a.read).length

              if (modelBoardActivity.length === 0) {
                return (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>
                    Noch keine Board-Änderungen.<br />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', opacity: 0.7 }}>
                      Hier erscheinen Änderungen die Models in ihrem Board machen (Videos, Einschränkungen, NoGos, Reisen, Regeln).
                    </span>
                  </div>
                )
              }
              if (filtered.length === 0) {
                return (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>
                    Keine Änderungen für {selectedModel?.name}.
                  </div>
                )
              }
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {/* Header-Aktionen */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, gap: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {selectedModel ? (
                        <>
                          {filtered.length} Änderung{filtered.length === 1 ? '' : 'en'}
                          {unreadInList > 0 && <span style={{ color: '#f59e0b', fontWeight: 700 }}> · {unreadInList} ungelesen</span>}
                          {' · '}
                          <button onClick={() => setSelectedModel(null)} style={{
                            background: 'transparent', border: 'none', color: 'var(--text-muted)',
                            fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline',
                            padding: 0,
                          }}>Alle Models anzeigen</button>
                        </>
                      ) : (
                        <>
                          {modelBoardActivity.length} Änderungen gesamt
                          {unreadInList > 0 && <span style={{ color: '#f59e0b', fontWeight: 700 }}> · {unreadInList} ungelesen</span>}
                        </>
                      )}
                    </div>
                    {unreadInList > 0 && (
                      <button onClick={async () => {
                        const ids = displayed.filter(a => !a.read).map(a => a.id)
                        if (ids.length === 0) return
                        if (selectedModel) {
                          await supabase.from('model_board_activity').update({ read: true }).eq('model_name', selectedModel.name).eq('read', false)
                        } else {
                          await supabase.from('model_board_activity').update({ read: true }).eq('read', false)
                        }
                        setModelBoardActivity(prev => prev.map(a =>
                          selectedModel ? (a.model_name === selectedModel.name ? { ...a, read: true } : a) : { ...a, read: true }
                        ))
                      }} style={{
                        background: 'transparent', border: '1px solid var(--border)',
                        color: 'var(--text-muted)', borderRadius: 5, padding: '3px 9px',
                        fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                        whiteSpace: 'nowrap',
                      }}>Als gelesen</button>
                    )}
                  </div>
                  {/* Liste */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 480, overflowY: 'auto' }}>
                    {displayed.map(a => (
                      <div key={a.id} style={{
                        display: 'flex', alignItems: 'flex-start', gap: 8,
                        padding: '8px 10px',
                        background: a.read ? 'var(--bg-card2)' : 'rgba(245,158,11,0.06)',
                        borderRadius: 7,
                        border: `1px solid ${a.read ? 'var(--border)' : 'rgba(245,158,11,0.2)'}`,
                      }}>
                        {!selectedModel && (
                          <div style={{
                            width: 22, height: 22, borderRadius: '50%',
                            background: 'rgba(245,158,11,0.15)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, fontWeight: 700, color: '#f59e0b', flexShrink: 0,
                          }}>{a.model_name[0]}</div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, lineHeight: 1.4 }}>
                            {!selectedModel && (
                              <span style={{ fontWeight: 700, color: '#f59e0b' }}>{a.model_name} </span>
                            )}
                            <span style={{ color: 'var(--text-secondary)' }}>
                              hat <b style={{ color: 'var(--text-primary)' }}>{a.category}</b> {a.action}
                            </span>
                          </div>
                          {a.details && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, wordBreak: 'break-word' }}>
                              {a.details}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                          {!a.read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />}
                          <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                            {new Date(a.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {sorted.length > 20 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0 4px', fontStyle: 'italic' }}>
                      {sorted.length - 20} weitere ältere Änderungen…
                    </div>
                  )}
                </div>
              )
            })()}
          </Card>
        </div>
      )}

      {/* CHATTERS */}
      {activeSection === 'chatters' && (() => {
        // Aufmerksamkeits-Items berechnen
        const now = new Date()
        const activeAnnCount = announcements.filter(a => !a.expires_at || new Date(a.expires_at) > now).length
        const openSwapsCount = openSwapUnitCount()
        const reactedSwapsCount = reactedSwapUnitCount()
        const attentionItems = []
        if (reactedSwapsCount > 0) attentionItems.push({ icon: '↻', text: `${reactedSwapsCount} Schicht${reactedSwapsCount === 1 ? '' : 'en'} mit Reaktionen — du musst zuweisen`, color: '#a78bfa', action: 'swaps' })
        if (openSwapsCount > 0) attentionItems.push({ icon: '🔄', text: `${openSwapsCount} offene Schicht-Tausch-Angebote`, color: '#f59e0b', action: 'swaps' })
        if (newAbsences.length > 0) attentionItems.push({ icon: '📅', text: `${newAbsences.length} neue Abwesenheit${newAbsences.length === 1 ? '' : 'en'} von Chattern`, color: '#ef4444', onClick: ackNewAbsences })

        // v3.28.2: Hex -> rgba für dezente Chip-Akzente
        const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})` }

        return (
        <div>
          {/* Aufmerksamkeits-Chips (v3.28.2) */}
          {attentionItems.length > 0 && (
            <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Zu erledigen</span>
              {attentionItems.map((item, i) => (
                <button key={i} onClick={() => item.onClick ? item.onClick() : setActiveSection(item.action)} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  padding: '6px 12px', borderRadius: 999,
                  background: hexA(item.color, 0.10), border: `1px solid ${hexA(item.color, 0.30)}`,
                  cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'background 0.12s',
                }} onMouseEnter={e => e.currentTarget.style.background = hexA(item.color, 0.18)}
                   onMouseLeave={e => e.currentTarget.style.background = hexA(item.color, 0.10)}>
                  <span style={{ fontSize: 13 }}>{item.icon}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--text-primary)', fontWeight: 600 }}>{item.text}</span>
                  <span style={{ fontSize: 11, color: item.color, marginLeft: 1 }}>→</span>
                </button>
              ))}
            </div>
          )}

          {/* Quick-Info Pinnwand */}
          {/* v3.12.0: "Verwalten →" Hinweis entfernt — Pinnwand ist jetzt direkt rechts integriert */}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>
          <Card title="Chatters">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {activeChatters.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '8px 0' }}>Noch keine Chatters angelegt</div>}
              {activeChatters.map(chatter => {
                const isSelected = selectedChatter?.id === chatter.id
                return (
                  <div key={chatter.id} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    <div onClick={() => setSelectedChatter(isSelected ? null : chatter)} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 12px', background: 'var(--bg-card2)', borderRadius: showAvailability === chatter.name ? '8px 8px 0 0' : 8,
                      border: `1px solid ${isSelected ? '#06b6d4' : 'var(--border)'}`,
                      cursor: 'pointer', transition: 'border-color 0.15s',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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

          {/* v3.12.0: Pinnwand (ersetzt "Nachricht senden" Card, war vorher eigener Sub-Tab) */}
          <Card title={selectedChatter ? `📌 Pinnwand · ${selectedChatter.name}` : '📌 Pinnwand'}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Ankündigungen für alle Chatter — werden im ChatterPortal oben angezeigt.
                Max. 2 aktive Posts gleichzeitig oben. Chatter können einzelne Posts archivieren.
              </div>

              {/* Neue Ankündigung */}
              {!showAnnForm ? (
                <button onClick={() => setShowAnnForm(true)} style={{
                  alignSelf: 'flex-start', fontSize: 12, padding: '6px 14px', borderRadius: 7,
                  background: '#7c3aed', border: 'none', color: '#fff',
                  cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                }}>
                  + Neue Ankündigung
                </button>
              ) : (
                <div style={{ background: 'var(--bg-card2)', border: '1px solid #7c3aed', borderRadius: 10, padding: 12 }}>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Emoji:</label>
                    <input type="text" value={newAnnEmoji} onChange={e => setNewAnnEmoji(e.target.value)} maxLength={2}
                      style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '4px 8px', borderRadius: 5, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: 44, textAlign: 'center' }} />
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                      {['📌', '⚽', '📢', '🎯', '⚡', '🎬', '🚨', '🎉', '📋'].map(e => (
                        <button key={e} type="button" onClick={() => setNewAnnEmoji(e)} style={{
                          fontSize: 14, padding: '3px 7px', borderRadius: 5, cursor: 'pointer',
                          background: newAnnEmoji === e ? 'rgba(124,58,237,0.2)' : 'transparent',
                          border: `1px solid ${newAnnEmoji === e ? '#7c3aed' : 'var(--border)'}`,
                        }}>{e}</button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    value={newAnnText}
                    onChange={e => setNewAnnText(e.target.value)}
                    placeholder="z.B. 'Heute 20:30 Zoom Call' oder 'Fußball heute Abend 😄'"
                    style={{
                      width: '100%', minHeight: 70, background: 'var(--bg-input)', border: '1px solid var(--border)',
                      color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 6, fontSize: 12,
                      fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>Läuft ab:</label>
                    <input type="datetime-local" value={newAnnExpiresAt} onChange={e => setNewAnnExpiresAt(e.target.value)}
                      style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '4px 8px', borderRadius: 5, fontSize: 11, fontFamily: 'inherit', outline: 'none' }} />
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>(optional)</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button onClick={postAnnouncement} disabled={!newAnnText.trim()} style={{
                      fontSize: 12, padding: '6px 14px', borderRadius: 6,
                      background: newAnnText.trim() ? '#7c3aed' : 'var(--border)',
                      border: 'none', color: '#fff', cursor: newAnnText.trim() ? 'pointer' : 'not-allowed',
                      fontFamily: 'inherit', fontWeight: 600,
                    }}>
                      Posten
                    </button>
                    <button onClick={() => { setShowAnnForm(false); setNewAnnText(''); setNewAnnEmoji('📌'); setNewAnnExpiresAt('') }} style={{
                      fontSize: 12, padding: '6px 14px', borderRadius: 6,
                      background: 'transparent', border: '1px solid var(--border)',
                      color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                      Abbrechen
                    </button>
                  </div>
                </div>
              )}

              {/* Liste der Ankündigungen */}
              {(() => {
                if (announcements.length === 0) {
                  return (
                    <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
                      Noch keine Ankündigungen
                    </div>
                  )
                }
                const now = new Date()
                // Falls Chatter ausgewählt → zwei Sektionen, sonst alle
                if (selectedChatter) {
                  const ungeleseneAktive = announcements.filter(a => {
                    const isExpired = a.expires_at && new Date(a.expires_at) < now
                    if (isExpired) return false
                    const archivedFor = Array.isArray(a.archived_for) ? a.archived_for : []
                    return !archivedFor.includes(selectedChatter.name)
                  })
                  const gelesene = announcements.filter(a => {
                    const archivedFor = Array.isArray(a.archived_for) ? a.archived_for : []
                    return archivedFor.includes(selectedChatter.name)
                  })
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {/* Reset-Link */}
                      <button onClick={() => setSelectedChatter(null)} style={{
                        alignSelf: 'flex-start',
                        background: 'transparent', border: 'none', color: 'var(--text-muted)',
                        fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline',
                        padding: 0,
                      }}>← Alle Ankündigungen anzeigen</button>

                      {/* Ungelesene */}
                      <div>
                        <div style={{ fontSize: 10, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: 6 }}>
                          ⚪ Ungelesen für {selectedChatter.name} ({ungeleseneAktive.length})
                        </div>
                        {ungeleseneAktive.length === 0 ? (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '6px 0', fontStyle: 'italic' }}>
                            {selectedChatter.name} hat alle aktiven Ankündigungen gelesen.
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {ungeleseneAktive.map(ann => renderAnnouncementItem(ann, now, deleteAnnouncement))}
                          </div>
                        )}
                      </div>

                      {/* Gelesene */}
                      {gelesene.length > 0 && (
                        <div>
                          <div style={{ fontSize: 10, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: 6 }}>
                            ✓ Gelesen von {selectedChatter.name} ({gelesene.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {gelesene.map(ann => renderAnnouncementItem(ann, now, deleteAnnouncement))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                }
                // Default-Modus: Alle anzeigen
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: 2 }}>
                      Alle Ankündigungen ({announcements.length})
                    </div>
                    {announcements.map(ann => renderAnnouncementItem(ann, now, deleteAnnouncement))}
                  </div>
                )
              })()}
            </div>
          </Card>
        </div>
        </div>
        )
      })()}

      {/* CHAT (WhatsApp-Style) — nur reine Konversation, kein message_type */}
      {(activeSection === 'chat-models' || activeSection === 'chat-chatters' || activeSection === 'chat-unified') && (() => {
        const isUnified = activeSection === 'chat-unified'
        const contactType = activeSection === 'chat-models' ? 'model'
                          : activeSection === 'chat-chatters' ? 'chatter'
                          : (activeThreadType || 'chatter') // unified: nutze type vom aktiven Thread (für Senden)
        // Welche contact_types in der Thread-Liste anzeigen?
        const allowedContactTypes = isUnified
          ? (chatTypeFilter === 'all' ? ['model', 'chatter'] : [chatTypeFilter])
          : [contactType]
        // Alle Chat-Nachrichten passend
        const chatMsgs = messages.filter(m =>
          allowedContactTypes.includes(m.contact_type) && isChat(m) && m.contact_type !== 'unknown'
        )
        // Threads gruppieren nach `${contact_type}:${model_name}` für unified, sonst nur model_name
        const threadsMap = {}
        for (const msg of chatMsgs) {
          const name = msg.model_name
          if (!name) continue
          const key = isUnified ? `${msg.contact_type}:${name}` : name
          if (!threadsMap[key]) threadsMap[key] = { msgs: [], name, contactType: msg.contact_type }
          threadsMap[key].msgs.push(msg)
        }
        // Liste sortieren nach jüngster Nachricht
        const threadList = Object.entries(threadsMap)
          .map(([key, val]) => {
            const sorted = val.msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
            const last = sorted[sorted.length - 1]
            const unreadCount = sorted.filter(m => m.direction === 'in' && !m.read).length
            return { key, name: val.name, contactType: val.contactType, last, sorted, unreadCount }
          })
          .filter(t => !chatSearch || t.name.toLowerCase().includes(chatSearch.toLowerCase()))
          .sort((a, b) => new Date(b.last.created_at) - new Date(a.last.created_at))

        // Aktiver Thread: in unified per name+type matchen, sonst per name
        const activeKey = activeThreadName
          ? (isUnified ? `${activeThreadType}:${activeThreadName}` : activeThreadName)
          : null
        const activeThread = activeKey && threadsMap[activeKey]
          ? threadsMap[activeKey].msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
          : []

        const formatRelative = (ts) => {
          const d = new Date(ts)
          const now = new Date()
          const diffMs = now - d
          const today = now.toDateString() === d.toDateString()
          const yest = new Date(now); yest.setDate(yest.getDate() - 1)
          const isYest = yest.toDateString() === d.toDateString()
          if (today) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
          if (isYest) return 'Gestern'
          if (diffMs < 7 * 86400000) return d.toLocaleDateString('de-DE', { weekday: 'short' })
          return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
        }
        const fullDateTime = (ts) => new Date(ts).toLocaleString('de-DE', {
          day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
        })

        return (
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden',
            display: 'grid',
            gridTemplateColumns: isMobileChat ? '1fr' : '260px 1fr',
            height: isMobileChat ? '80vh' : 680,
          }}>

            {/* Linke Spalte: Thread-Liste (auf Mobile nur wenn KEIN Thread aktiv) */}
            {(!isMobileChat || !activeThreadName) && (
            <div style={{ borderRight: isMobileChat ? 'none' : '1px solid var(--border)', display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
              {/* Such-Header + Neuer-Chat */}
              <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    value={chatSearch}
                    onChange={e => setChatSearch(e.target.value)}
                    placeholder="Suchen…"
                    style={{ flex: 1, boxSizing: 'border-box', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '7px 10px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
                  />
                  <button onClick={() => setShowNewChatPicker(true)} title="Neuer Chat" style={{
                    padding: '7px 11px', borderRadius: 7,
                    background: 'rgba(124,58,237,0.15)', color: '#a78bfa',
                    border: '1px solid rgba(124,58,237,0.3)',
                    fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
                  }}>＋</button>
                </div>
                {isUnified && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[
                      { key: 'all', label: 'Alle' },
                      { key: 'chatter', label: 'Chatters' },
                      { key: 'model', label: 'Models' },
                    ].map(opt => (
                      <button key={opt.key} onClick={() => setChatTypeFilter(opt.key)} style={{
                        flex: 1, padding: '4px 6px', borderRadius: 5, fontSize: 10, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                        background: chatTypeFilter === opt.key ? 'rgba(124,58,237,0.18)' : 'transparent',
                        color: chatTypeFilter === opt.key ? '#a78bfa' : 'var(--text-muted)',
                        border: `1px solid ${chatTypeFilter === opt.key ? '#7c3aed' : 'var(--border)'}`,
                      }}>{opt.label}</button>
                    ))}
                  </div>
                )}
              </div>

              {/* Thread-Liste */}
              <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                {threadList.length === 0 && (
                  <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                    {chatSearch ? 'Keine Treffer' : 'Noch keine Konversationen'}
                  </div>
                )}
                {threadList.map(thread => {
                  const isActive = activeThreadName === thread.name && (!isUnified || activeThreadType === thread.contactType)
                  return (
                    <div
                      key={thread.key}
                      onClick={() => openChatThread(thread.name, thread.contactType)}
                      style={{
                        padding: '10px 12px',
                        borderBottom: '1px solid var(--border)',
                        cursor: 'pointer',
                        background: isActive ? 'rgba(124,58,237,0.08)' : 'transparent',
                        borderLeft: isActive ? '3px solid #7c3aed' : '3px solid transparent',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                        <span style={{ fontSize: 12, fontWeight: thread.unreadCount > 0 ? 700 : 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {isUnified && (
                            <span style={{
                              fontSize: 8, padding: '1px 5px', borderRadius: 3,
                              background: thread.contactType === 'model' ? 'rgba(245,158,11,0.18)' : 'rgba(6,182,212,0.18)',
                              color: thread.contactType === 'model' ? '#f59e0b' : '#06b6d4',
                              fontWeight: 700, letterSpacing: 0.3,
                            }}>{thread.contactType === 'model' ? 'M' : 'C'}</span>
                          )}
                          {thread.name}
                        </span>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{formatRelative(thread.last.created_at)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          fontSize: 11,
                          color: thread.unreadCount > 0 ? 'var(--text-primary)' : 'var(--text-muted)',
                          fontWeight: thread.unreadCount > 0 ? 600 : 400,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1,
                        }}>
                          {thread.last.direction === 'out' ? 'Du: ' : ''}{thread.last.text}
                        </span>
                        {thread.unreadCount > 0 && (
                          <span style={{
                            fontSize: 9, padding: '1px 6px', borderRadius: 4,
                            background: '#7c3aed', color: '#fff', fontWeight: 700, flexShrink: 0,
                          }}>{thread.unreadCount}</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            )}

            {/* Rechte Spalte: Aktiver Thread (auf Mobile nur wenn Thread aktiv) */}
            {!activeThreadName ? (
              !isMobileChat && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 20 }}>
                Wähle eine Konversation links aus
              </div>
              )
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
                {/* Thread-Header */}
                <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {isMobileChat && (
                      <button onClick={() => { setActiveThreadName(null); setActiveThreadType(null) }} style={{
                        background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer', padding: 0,
                      }}>←</button>
                    )}
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{activeThreadName}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {(isUnified ? activeThreadType : contactType) === 'model' ? 'Model' : 'Chatter'}
                      </div>
                    </div>
                  </div>
                  <button onClick={() => { setActiveThreadName(null); setActiveThreadType(null) }} style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 6,
                    background: 'transparent', border: '1px solid var(--border)',
                    color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit',
                  }}>✕ Schließen</button>
                </div>

                {/* Verlauf */}
                <div ref={chatScrollRef} style={{ flex: 1, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', minHeight: 0 }}>
                  {activeThread.length === 0 && (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: 20 }}>
                      Noch keine Nachrichten in diesem Thread.
                    </div>
                  )}
                  {activeThread.map((msg, idx) => {
                    const isOut = msg.direction === 'out'
                    const prevMsg = idx > 0 ? activeThread[idx - 1] : null
                    const showDateSeparator = !prevMsg ||
                      new Date(prevMsg.created_at).toDateString() !== new Date(msg.created_at).toDateString()
                    const dateSep = new Date(msg.created_at).toLocaleDateString('de-DE', {
                      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
                    })
                    return (
                      <React.Fragment key={msg.id}>
                        {showDateSeparator && (
                          <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-tertiary)', margin: '8px 0 4px' }}>
                            {dateSep}
                          </div>
                        )}
                        <div style={{
                          alignSelf: isOut ? 'flex-end' : 'flex-start',
                          maxWidth: '70%',
                        }}>
                          <div style={{
                            padding: msg.image_urls && msg.image_urls.length > 0 ? '6px 6px 7px 6px' : '7px 11px',
                            borderRadius: isOut ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
                            background: isOut ? 'rgba(124,58,237,0.18)' : 'var(--bg-card2)',
                            color: isOut ? '#a78bfa' : 'var(--text-primary)',
                            fontSize: 12, lineHeight: 1.4,
                            border: isOut ? '1px solid rgba(124,58,237,0.3)' : '1px solid var(--border)',
                            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          }}>
                            {/* v3.25.0: Anhänge anzeigen — Bild/Video/Audio/Datei je nach Typ */}
                            {msg.image_urls && msg.image_urls.length > 0 && (
                              <div style={{
                                display: 'flex',
                                flexDirection: isMobileChat ? 'column' : 'row',
                                flexWrap: 'wrap',
                                gap: 4,
                                marginBottom: msg.text ? 6 : 0,
                              }}>
                                {msg.image_urls.map((url, ii) => {
                                  const cleanUrl = (url || '').split('?')[0].toLowerCase()
                                  const isVideo = /\.(mp4|mov|webm|m4v)$/.test(cleanUrl)
                                  const isAudio = /\.(ogg|oga|mp3|m4a|wav)$/.test(cleanUrl)
                                  const isImage = /\.(jpg|jpeg|png|webp|gif|heic)$/.test(cleanUrl)
                                  if (isVideo) {
                                    return (
                                      <video key={ii} src={url} controls
                                        style={{
                                          width: isMobileChat ? '100%' : 180,
                                          maxHeight: isMobileChat ? 280 : 180,
                                          borderRadius: 6,
                                          display: 'block',
                                          background: '#000',
                                        }}
                                      />
                                    )
                                  }
                                  if (isAudio) {
                                    return (
                                      <audio key={ii} src={url} controls
                                        style={{ width: isMobileChat ? '100%' : 220, display: 'block' }}
                                      />
                                    )
                                  }
                                  if (isImage) {
                                    return (
                                      <img key={ii} src={url} alt="Anhang"
                                        onClick={() => setLightboxImage(url)}
                                        style={{
                                          width: isMobileChat ? '100%' : 130,
                                          height: isMobileChat ? 'auto' : 130,
                                          maxHeight: isMobileChat ? 240 : 130,
                                          objectFit: 'cover',
                                          borderRadius: 6,
                                          cursor: 'pointer',
                                          display: 'block',
                                        }}
                                      />
                                    )
                                  }
                                  // Sonstige Datei (z.B. PDF) → Download-Chip
                                  const fileName = decodeURIComponent((cleanUrl.split('/').pop() || 'Datei'))
                                  return (
                                    <a key={ii} href={url} target="_blank" rel="noopener noreferrer"
                                      style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 6,
                                        padding: '8px 10px', borderRadius: 6,
                                        background: 'var(--bg-card)', border: '1px solid var(--border)',
                                        color: 'var(--text-primary)', textDecoration: 'none', fontSize: 11,
                                      }}
                                    >
                                      📎 {fileName}
                                    </a>
                                  )
                                })}
                              </div>
                            )}
                            {msg.text && (
                              <div style={{ padding: msg.image_urls && msg.image_urls.length > 0 ? '0 5px' : 0 }}>
                                {msg.text}
                              </div>
                            )}
                          </div>
                          <div style={{
                            fontSize: 9, color: msg.status === 'failed' ? '#ef4444' : 'var(--text-muted)',
                            textAlign: isOut ? 'right' : 'left',
                            marginTop: 2,
                          }}>
                            {msg.status === 'failed' && '❌ NICHT angekommen · '}
                            {fullDateTime(msg.created_at)}
                            {isOut && msg.sent_by ? ` · ${msg.sent_by}` : ''}
                          </div>
                          {/* v3.10.0: Broadcast-Marker */}
                          {msg.is_broadcast && (
                            <div style={{
                              fontSize: 9, color: '#f59e0b', fontWeight: 600,
                              textAlign: isOut ? 'right' : 'left',
                              marginTop: 1,
                              display: 'flex', alignItems: 'center', gap: 3,
                              justifyContent: isOut ? 'flex-end' : 'flex-start',
                            }}>
                              📢 Massennachricht · Admin
                            </div>
                          )}
                        </div>
                      </React.Fragment>
                    )
                  })}
                </div>

                {/* v2.9.8: Bild-Preview-Reihe wenn Bilder ausgewählt */}
                {chatAttachments.length > 0 && (
                  <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', background: 'rgba(124,58,237,0.04)' }}>
                    {chatAttachments.map((att, idx) => (
                      <div key={idx} style={{ position: 'relative', width: 64, height: 64, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                        <img src={att.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <button onClick={() => removeChatAttachment(idx)} title="Entfernen" style={{
                          position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%',
                          background: 'rgba(0,0,0,0.7)', color: '#fff', border: 'none', cursor: 'pointer',
                          fontSize: 11, lineHeight: 1, padding: 0, fontFamily: 'inherit',
                        }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Eingabefeld */}
                <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  {/* v2.9.8: Anhang-Button */}
                  <label style={{
                    padding: '9px 11px', borderRadius: 7,
                    background: 'transparent', border: '1px solid var(--border)',
                    color: 'var(--text-muted)', fontSize: 16, cursor: chatSendingTo ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    opacity: chatSendingTo ? 0.5 : 1,
                  }} title="Bilder anhängen">
                    📎
                    <input type="file" accept="image/*" multiple
                      disabled={chatSendingTo}
                      onChange={e => { handleChatImageSelect(e.target.files); e.target.value = '' }}
                      style={{ display: 'none' }}
                    />
                  </label>
                  <textarea
                    value={chatInputText}
                    onChange={e => setChatInputText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        sendChatThreadMessage(contactType)
                      }
                    }}
                    placeholder={chatAttachments.length > 0 ? `Bildbeschreibung (optional)…` : `Nachricht an ${activeThreadName}…`}
                    style={{
                      flex: 1, minHeight: 38, maxHeight: 120, resize: 'none',
                      background: 'var(--bg-input)', border: '1px solid var(--border)',
                      color: 'var(--text-primary)', padding: '9px 11px', borderRadius: 7,
                      fontSize: 12, fontFamily: 'inherit', outline: 'none',
                    }}
                  />
                  <button
                    onClick={() => sendChatThreadMessage(contactType)}
                    disabled={chatSendingTo || (!chatInputText.trim() && chatAttachments.length === 0)}
                    style={{
                      padding: '10px 18px', borderRadius: 7,
                      background: (chatSendingTo || (!chatInputText.trim() && chatAttachments.length === 0)) ? 'var(--border)' : '#7c3aed',
                      color: '#fff', border: 'none', fontSize: 12, fontWeight: 700,
                      cursor: (chatSendingTo || (!chatInputText.trim() && chatAttachments.length === 0)) ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit', whiteSpace: 'nowrap',
                    }}
                  >
                    {chatSendingTo ? '…' : '✈ Senden'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* Neuer-Chat Picker Modal */}
      {showNewChatPicker && (activeSection === 'chat-models' || activeSection === 'chat-chatters' || activeSection === 'chat-unified') && (() => {
        const isUnifiedPicker = activeSection === 'chat-unified'
        const pickerContactType = activeSection === 'chat-models' ? 'model' : activeSection === 'chat-chatters' ? 'chatter' : null
        // Liste für Single-Chat: in unified beide, sonst nur einer
        const pickerEntries = isUnifiedPicker
          ? [
              ...activeChatters.filter(c => c.telegram_id).map(c => ({ ...c, _type: 'chatter' })),
              ...activeModels.filter(c => c.telegram_id).map(c => ({ ...c, _type: 'model' })),
            ].sort((a, b) => a.name.localeCompare(b.name))
          : (pickerContactType === 'model' ? activeModels : activeChatters).filter(c => c.telegram_id).map(c => ({ ...c, _type: pickerContactType }))

        // Empfängerliste für Broadcast (basierend auf broadcastRecipientType)
        // v3.23.0: nur aktive Empfänger (offboardete/stillgelegte raus)
        const broadcastContactList = broadcastRecipientType === 'chatter'
          ? activeChatters.filter(c => c.telegram_id)
          : activeModels.filter(c => c.telegram_id)
        const broadcastTargetCount = broadcastSelected.size > 0 ? broadcastSelected.size : broadcastContactList.length

        const closeModal = () => {
          setShowNewChatPicker(false)
          setNewChatMode('single')
          setBroadcastText('')
          setBroadcastSelected(new Set())
          setBroadcastZoomDate('')
          setBroadcastZoomTime('')
        }

        return (
          <div onClick={closeModal} style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}>
            <div onClick={e => e.stopPropagation()} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
              padding: 18, maxWidth: newChatMode === 'broadcast' ? 560 : 420, width: '100%', maxHeight: '85vh', overflowY: 'auto',
              boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {newChatMode === 'broadcast' ? 'Neue Massennachricht' : (isUnifiedPicker ? 'Neuer Chat' : `Neuer Chat mit ${pickerContactType === 'model' ? 'Model' : 'Chatter'}`)}
                </div>
                <button onClick={closeModal} style={{
                  background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', padding: 0,
                }}>✕</button>
              </div>

              {/* Mode-Tabs */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 14, padding: 3, background: 'var(--bg-input)', borderRadius: 8 }}>
                <button onClick={() => setNewChatMode('single')} style={{
                  flex: 1, padding: '7px 10px', borderRadius: 5,
                  background: newChatMode === 'single' ? 'rgba(124,58,237,0.18)' : 'transparent',
                  color: newChatMode === 'single' ? '#a78bfa' : 'var(--text-muted)',
                  border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}>💬 Neuer Chat</button>
                <button onClick={() => setNewChatMode('broadcast')} style={{
                  flex: 1, padding: '7px 10px', borderRadius: 5,
                  background: newChatMode === 'broadcast' ? 'rgba(245,158,11,0.18)' : 'transparent',
                  color: newChatMode === 'broadcast' ? '#f59e0b' : 'var(--text-muted)',
                  border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}>📢 Massennachricht</button>
              </div>

              {/* SINGLE CHAT MODE */}
              {newChatMode === 'single' && (
                pickerEntries.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>
                    Keine Kontakte mit Telegram-ID hinterlegt.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {pickerEntries.map(c => (
                      <button key={`${c._type}-${c.id}`} onClick={() => {
                        openChatThread(c.name, c._type)
                        closeModal()
                      }} style={{
                        padding: '10px 12px', borderRadius: 7,
                        background: 'transparent', border: '1px solid var(--border)',
                        color: 'var(--text-primary)', fontSize: 12, fontWeight: 600,
                        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                        display: 'flex', alignItems: 'center', gap: 8,
                      }}>
                        {isUnifiedPicker && (
                          <span style={{
                            fontSize: 8, padding: '1px 5px', borderRadius: 3,
                            background: c._type === 'model' ? 'rgba(245,158,11,0.18)' : 'rgba(6,182,212,0.18)',
                            color: c._type === 'model' ? '#f59e0b' : '#06b6d4',
                            fontWeight: 700, letterSpacing: 0.3,
                          }}>{c._type === 'model' ? 'M' : 'C'}</span>
                        )}
                        {c.name}
                      </button>
                    ))}
                  </div>
                )
              )}

              {/* BROADCAST MODE */}
              {newChatMode === 'broadcast' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {/* Empfänger-Typ */}
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, display: 'block', marginBottom: 6 }}>An:</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => { setBroadcastRecipientType('chatter'); setBroadcastSelected(new Set()) }} style={{
                        flex: 1, padding: '8px 12px', borderRadius: 6,
                        background: broadcastRecipientType === 'chatter' ? 'rgba(6,182,212,0.18)' : 'transparent',
                        color: broadcastRecipientType === 'chatter' ? '#06b6d4' : 'var(--text-muted)',
                        border: `1px solid ${broadcastRecipientType === 'chatter' ? '#06b6d4' : 'var(--border)'}`,
                        fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                      }}>Chatter ({activeChatters.filter(c => c.telegram_id).length})</button>
                      <button onClick={() => { setBroadcastRecipientType('model'); setBroadcastSelected(new Set()) }} style={{
                        flex: 1, padding: '8px 12px', borderRadius: 6,
                        background: broadcastRecipientType === 'model' ? 'rgba(245,158,11,0.18)' : 'transparent',
                        color: broadcastRecipientType === 'model' ? '#f59e0b' : 'var(--text-muted)',
                        border: `1px solid ${broadcastRecipientType === 'model' ? '#f59e0b' : 'var(--border)'}`,
                        fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                      }}>Models ({activeModels.filter(c => c.telegram_id).length})</button>
                    </div>
                  </div>

                  {/* Empfänger-Auswahl: Alle vs. Auswahl */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
                        Empfänger ({broadcastTargetCount})
                      </label>
                      {broadcastSelected.size > 0 && (
                        <button onClick={() => setBroadcastSelected(new Set())} style={{
                          background: 'transparent', border: '1px solid var(--border)',
                          color: 'var(--text-muted)', borderRadius: 5, padding: '2px 8px',
                          fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
                        }}>Alle</button>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: broadcastSelected.size === 0 ? '#10b981' : '#f59e0b', fontWeight: 600, marginBottom: 6 }}>
                      {broadcastSelected.size === 0
                        ? `→ Sendet an alle ${broadcastContactList.length} ${broadcastRecipientType === 'chatter' ? 'Chatter' : 'Models'}`
                        : `→ Sendet an ${broadcastSelected.size} ausgewählte`}
                    </div>
                    <div style={{
                      maxHeight: 140, overflowY: 'auto',
                      border: '1px solid var(--border)', borderRadius: 6, padding: 6,
                      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 3,
                    }}>
                      {broadcastContactList.map(c => {
                        const checked = broadcastSelected.has(c.id)
                        return (
                          <label key={c.id} style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '4px 6px', borderRadius: 4,
                            background: checked ? 'rgba(124,58,237,0.1)' : 'transparent',
                            cursor: 'pointer', fontSize: 11,
                          }}>
                            <input type="checkbox" checked={checked} onChange={(e) => {
                              const next = new Set(broadcastSelected)
                              if (e.target.checked) next.add(c.id)
                              else next.delete(c.id)
                              setBroadcastSelected(next)
                            }} style={{ cursor: 'pointer' }} />
                            <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  {/* Nachrichtentyp */}
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, display: 'block', marginBottom: 6 }}>Typ:</label>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {CHATTER_MSG_TYPES.map(t => (
                        <button key={t.key} onClick={() => setBroadcastMsgType(t.key)} style={{
                          fontSize: 11, padding: '6px 12px', borderRadius: 5, cursor: 'pointer',
                          background: broadcastMsgType === t.key ? 'rgba(124,58,237,0.18)' : 'transparent',
                          border: `1px solid ${broadcastMsgType === t.key ? '#7c3aed' : 'var(--border)'}`,
                          color: broadcastMsgType === t.key ? '#a78bfa' : 'var(--text-muted)',
                          fontFamily: 'inherit', fontWeight: 600,
                        }}>{t.label}</button>
                      ))}
                    </div>
                  </div>

                  {/* Zoom: Datum + Zeit */}
                  {broadcastMsgType === 'zoom' && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Datum</label>
                        <input type="date" value={broadcastZoomDate} onChange={e => setBroadcastZoomDate(e.target.value)}
                          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '6px 9px', borderRadius: 6, fontSize: 12, fontFamily: 'monospace', outline: 'none' }} />
                      </div>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Uhrzeit</label>
                        <input type="time" value={broadcastZoomTime} onChange={e => setBroadcastZoomTime(e.target.value)}
                          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '6px 9px', borderRadius: 6, fontSize: 12, fontFamily: 'monospace', outline: 'none' }} />
                      </div>
                    </div>
                  )}

                  {/* Text */}
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, display: 'block', marginBottom: 6 }}>Nachricht:</label>
                    <textarea value={broadcastText} onChange={e => setBroadcastText(e.target.value)}
                      placeholder={`Hi {name}, kurze Info vom Team:\n\n…`}
                      rows={4}
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        background: 'var(--bg-input)', border: '1px solid var(--border)',
                        color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 6,
                        fontSize: 12, fontFamily: 'inherit', outline: 'none', resize: 'vertical',
                      }} />
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                      Tipp: <code style={{ background: 'var(--bg-card2)', padding: '1px 4px', borderRadius: 3 }}>{'{name}'}</code> wird durch den jeweiligen Empfänger-Namen ersetzt.
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
                    <button onClick={closeModal} style={{
                      background: 'transparent', border: '1px solid var(--border)',
                      color: 'var(--text-muted)', borderRadius: 6, padding: '8px 16px',
                      fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    }}>Abbrechen</button>
                    <button onClick={sendBroadcast} disabled={broadcastSending || !broadcastText.trim() || broadcastTargetCount === 0} style={{
                      background: broadcastSending || !broadcastText.trim() ? 'var(--border)' : '#7c3aed',
                      color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px',
                      fontSize: 12, fontWeight: 700, cursor: broadcastSending || !broadcastText.trim() ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit', opacity: broadcastSending || !broadcastText.trim() ? 0.6 : 1,
                    }}>
                      {broadcastSending ? '⏳ Sende…' : `📢 An ${broadcastTargetCount} senden`}
                    </button>
                  </div>
                </div>
              )}
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
            {(() => {
              const filteredUnreadIds = filtered.filter(m => !m.read).map(m => m.id)
              const isFilterActive = inboxFilter !== 'all' || inboxPersonFilter !== 'all' || inboxUnreadOnly
              if (isFilterActive && filteredUnreadIds.length > 0) {
                return (
                  <button onClick={() => markFilteredInboxRead(filteredUnreadIds)} style={{
                    marginLeft: 'auto', fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                    background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)',
                    color: '#10b981', fontFamily: 'inherit', fontWeight: 600
                  }}>✓ Gefilterte als gelesen ({filteredUnreadIds.length})</button>
                )
              }
              return null
            })()}
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
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {msg.model_telegram_id && (
                    replyingTo === msg.id ? (
                      <div style={{ display: 'flex', gap: 6, marginTop: 4, flex: 1 }}>
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
                  {!msg.read && replyingTo !== msg.id && (
                    <button onClick={() => markSingleInboxRead(msg.id)} style={{
                      fontSize: 10, padding: '3px 10px', borderRadius: 5, cursor: 'pointer',
                      background: 'transparent', border: '1px solid rgba(16,185,129,0.3)',
                      color: '#10b981', fontFamily: 'inherit', fontWeight: 600
                    }}>✓ Gelesen</button>
                  )}
                  </div>
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

      {/* CUSTOM CONTENT */}
      {activeSection === 'content-requests' && (() => {
        // Unique Models und Chatter aus allen Requests
        const uniqueModels = [...new Set(contentRequests.map(r => r.model_name).filter(Boolean))].sort()
        const uniqueChatters = [...new Set(contentRequests.map(r => r.chatter_name).filter(Boolean))].sort()

        // Status-basierte Listen für Counts
        const offeneRequests = contentRequests.filter(r => r.status !== 'erledigt' && r.status !== 'abgelehnt')
        const erledigteRequests = contentRequests.filter(r => r.status === 'erledigt' || r.status === 'abgelehnt')

        // Combined Filter
        const filteredRequests = contentRequests.filter(r => {
          // Status-Filter
          if (contentFilter === 'offen' && (r.status === 'erledigt' || r.status === 'abgelehnt')) return false
          if (contentFilter === 'erledigt' && r.status !== 'erledigt' && r.status !== 'abgelehnt') return false
          // Model
          if (contentModelFilter !== 'all' && r.model_name !== contentModelFilter) return false
          // Chatter
          if (contentChatterFilter !== 'all' && r.chatter_name !== contentChatterFilter) return false
          // Search (Kunde, Beschreibung)
          if (contentSearch.trim()) {
            const q = contentSearch.trim().toLowerCase()
            const haystack = [
              r.customer_id || '',
              r.request_text || '',
              r.edited_text || '',
              r.model_name || '',
              r.chatter_name || ''
            ].join(' ').toLowerCase()
            if (!haystack.includes(q)) return false
          }
          return true
        })

        const isFiltered = contentModelFilter !== 'all' || contentChatterFilter !== 'all' || contentSearch.trim() !== ''
        return (
        <Card title={`Custom Content (${filteredRequests.length}${isFiltered ? ` von ${contentRequests.length}` : ''})`}>
          {/* Status-Filter Buttons */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
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

          {/* Model + Chatter + Search Filter */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
            <select value={contentModelFilter} onChange={e => setContentModelFilter(e.target.value)} style={{
              fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
              background: contentModelFilter !== 'all' ? 'rgba(236,72,153,0.15)' : 'var(--bg-input)',
              border: `1px solid ${contentModelFilter !== 'all' ? '#ec4899' : 'var(--border)'}`,
              color: contentModelFilter !== 'all' ? '#ec4899' : 'var(--text-secondary)',
              fontWeight: 600, fontFamily: 'inherit', outline: 'none'
            }}>
              <option value="all">Alle Models</option>
              {uniqueModels.map(m => <option key={m} value={m}>{m}</option>)}
            </select>

            <select value={contentChatterFilter} onChange={e => setContentChatterFilter(e.target.value)} style={{
              fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
              background: contentChatterFilter !== 'all' ? 'rgba(6,182,212,0.15)' : 'var(--bg-input)',
              border: `1px solid ${contentChatterFilter !== 'all' ? '#06b6d4' : 'var(--border)'}`,
              color: contentChatterFilter !== 'all' ? '#06b6d4' : 'var(--text-secondary)',
              fontWeight: 600, fontFamily: 'inherit', outline: 'none'
            }}>
              <option value="all">Alle Chatter</option>
              {uniqueChatters.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <input
              type="text"
              value={contentSearch}
              onChange={e => setContentSearch(e.target.value)}
              placeholder="Suche Kunde / Text..."
              style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 6,
                background: contentSearch ? 'rgba(245,158,11,0.1)' : 'var(--bg-input)',
                border: `1px solid ${contentSearch ? '#f59e0b' : 'var(--border)'}`,
                color: 'var(--text-primary)',
                fontFamily: 'inherit', outline: 'none', flex: 1, minWidth: 140
              }}
            />

            {isFiltered && (
              <button onClick={() => { setContentModelFilter('all'); setContentChatterFilter('all'); setContentSearch('') }}
                style={{ fontSize: 10, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', fontFamily: 'inherit' }}>✕ Filter zurücksetzen</button>
            )}
          </div>

          {filteredRequests.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
              {isFiltered ? 'Keine Treffer mit diesen Filtern' : contentFilter === 'offen' ? 'Keine offenen Anfragen 🎉' : contentFilter === 'erledigt' ? 'Noch keine erledigten Anfragen' : 'Noch keine Anfragen'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredRequests.map(req => {
                const statusColor = req.status === 'erledigt' ? '#10b981' : req.status === 'bestaetigt' ? '#06b6d4' : req.status === 'angefragt' ? '#f59e0b' : req.status === 'abgelehnt' ? '#ef4444' : '#a78bfa'
                const statusLabel = req.status === 'erledigt' ? '✓ Erledigt' : req.status === 'bestaetigt' ? '✓ Bestätigt' : req.status === 'angefragt' ? '⏳ Angefragt' : req.status === 'abgelehnt' ? '✕ Abgelehnt' : '● Neu'
                const remainder = (req.price || 0) - (req.deposit || 0)
                // Bezahl-Status berechnen
                const totalPaid = (req.deposit_paid ? (req.deposit || 0) : 0) + (req.remainder_paid ? remainder : 0)
                const fullyPaid = req.price > 0 && totalPaid >= req.price
                const partiallyPaid = totalPaid > 0 && !fullyPaid
                const nothingPaid = req.price > 0 && totalPaid === 0
                const paidPct = req.price > 0 ? Math.round((totalPaid / req.price) * 100) : 0
                const barTrackColor = nothingPaid ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)'
                // v3.22.0: Default offen nur bei ASAP oder Neu; manuelles Set hat Vorrang.
                const defaultOpen = req.deadline === 'asap' || req.status === 'neu'
                const isExpanded = expandedReqs === null ? defaultOpen : expandedReqs.has(req.id)
                const payDot = req.price > 0 ? (fullyPaid ? '#10b981' : partiallyPaid ? '#f59e0b' : '#ef4444') : null
                const payDotLabel = fullyPaid ? '✓ bezahlt' : partiallyPaid ? paidPct + '% bezahlt' : 'offen'
                return (
                  <div key={req.id} style={{ padding: '14px 16px', background: 'var(--bg-card2)', borderRadius: 10, borderLeft: `3px solid ${statusColor}`, border: `1px solid ${req.status === 'neu' ? 'rgba(167,139,250,0.3)' : 'var(--border)'}` }}>
                    {/* Header: Model + Kunde + Chatter | Preis + Datum — v3.22.0 klickbar */}
                    <div onClick={() => toggleReqExpanded(req.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: isExpanded ? 10 : 0, cursor: 'pointer' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* Badges */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' }}>
                          {req.content_type && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: 'rgba(124,58,237,0.15)', color: '#a78bfa' }}>{req.content_type}</span>}
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: statusColor + '22', color: statusColor }}>{statusLabel}</span>
                          {req.status === 'neu' && <span style={{ fontSize: 9, background: '#7c3aed', color: '#fff', padding: '2px 7px', borderRadius: 4, fontWeight: 700 }}>NEU</span>}
                        </div>
                        {/* Model groß + pink */}
                        <div style={{ fontSize: 17, fontWeight: 700, color: '#ec4899', marginBottom: 3 }}>{req.model_name}</div>
                        {/* Kunde */}
                        {req.customer_id && (
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'monospace', marginBottom: 2 }}>
                            <span style={{ color: 'var(--text-muted)' }}>Kunde: </span>{req.customer_id}
                          </div>
                        )}
                        {/* Chatter */}
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          Chatter: <span style={{ color: 'var(--text-secondary)' }}>{req.chatter_name}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexShrink: 0 }}>
                        <div style={{ textAlign: 'right' }}>
                          {req.price > 0 && <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>${req.price}</div>}
                          {payDot && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end', marginTop: 2 }}>
                              <span style={{ width: 8, height: 8, borderRadius: '50%', background: payDot, display: 'inline-block' }} />
                              <span style={{ fontSize: 10, color: payDot, fontWeight: 600 }}>{payDotLabel}</span>
                            </div>
                          )}
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 2 }}>
                            {new Date(req.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} {new Date(req.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                        <span style={{ color: 'var(--text-muted)', fontSize: 13, transition: 'transform 0.2s', display: 'inline-block', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', marginTop: 2 }}>▼</span>
                      </div>
                    </div>

                    {isExpanded && (<>
                    {/* Beschreibung */}
                    {editingText === req.id ? (
                      <div style={{ marginBottom: 10 }}>
                        <textarea value={editTextValue} onChange={e => setEditTextValue(e.target.value)} rows={3}
                          style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #7c3aed', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 6, fontSize: 12, resize: 'vertical', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
                        {/* v3.13.0: Preis + Anzahlung gleich mit-editierbar */}
                        <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'flex-end', flexWrap: 'wrap', padding: '8px 10px', background: 'var(--bg-card)', borderRadius: 6 }}>
                          <div>
                            <label style={{ fontSize: 9, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Gesamt $</label>
                            <input type="number" step="any" value={editPrice} onChange={e => setEditPrice(e.target.value)}
                              placeholder="0"
                              style={{ width: 90, background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '4px 6px', borderRadius: 5, fontSize: 11, fontFamily: 'inherit', outline: 'none' }} />
                          </div>
                          <div>
                            <label style={{ fontSize: 9, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Anzahlung $</label>
                            <input type="number" step="any" value={editDeposit} onChange={e => setEditDeposit(e.target.value)}
                              placeholder="0"
                              style={{ width: 90, background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '4px 6px', borderRadius: 5, fontSize: 11, fontFamily: 'inherit', outline: 'none' }} />
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', alignSelf: 'center' }}>
                            (leer = nichts ändern)
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                          <button onClick={async () => {
                            const updatePayload = {
                              edited_text: editTextValue.trim(),
                              edited_by: displayName || session?.user?.email?.split('@')[0] || 'Admin',
                              edited_at: new Date().toISOString(),
                            }
                            // v3.13.0: nur überschreiben wenn auch was eingetragen wurde
                            if (editPrice !== '' && editPrice !== null && editPrice !== undefined) {
                              updatePayload.price = parseFloat(editPrice) || 0
                            }
                            if (editDeposit !== '' && editDeposit !== null && editDeposit !== undefined) {
                              updatePayload.deposit = parseFloat(editDeposit) || 0
                            }
                            await supabase.from('content_requests').update(updatePayload).eq('id', req.id)
                            setEditingText(null); loadContentRequests()
                          }} style={{ fontSize: 10, padding: '3px 10px', borderRadius: 4, background: '#7c3aed', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>✓ Speichern</button>
                          <button onClick={() => setEditingText(null)} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>Abbrechen</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ marginBottom: 10, padding: '8px 10px', background: 'var(--bg-card)', borderRadius: 6 }}>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                          {req.edited_text || req.request_text}
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                          {req.duration && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>⏱ {req.duration}</span>}
                          {req.quantity > 1 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>×{req.quantity}</span>}
                          {req.deadline && <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 3, background: req.deadline === 'asap' ? 'rgba(239,68,68,0.15)' : req.deadline === 'hours' ? 'rgba(249,115,22,0.15)' : req.deadline === 'days' ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)', color: req.deadline === 'asap' ? '#ef4444' : req.deadline === 'hours' ? '#f97316' : req.deadline === 'days' ? '#f59e0b' : '#10b981' }}>
                            {req.deadline === 'asap' ? '⚡ ASAP' : req.deadline === 'hours' ? '⏰ Heute' : req.deadline === 'days' ? '📅 1-2 Tage' : '🗓 Diese Woche'}
                          </span>}
                          <button onClick={() => {
                            setEditingText(req.id)
                            setEditTextValue(req.edited_text || req.request_text)
                            // v3.13.0: vorhandene Beträge in Edit-Felder vorausfüllen
                            setEditPrice(req.price ? String(req.price) : '')
                            setEditDeposit(req.deposit ? String(req.deposit) : '')
                          }}
                            style={{ marginLeft: 'auto', fontSize: 9, padding: '2px 7px', borderRadius: 3, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>✎ Text bearbeiten</button>
                        </div>
                        {req.edited_text && (
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 4 }}>
                            ✎ Geändert von {req.edited_by}
                          </div>
                        )}
                      </div>
                    )}

                    {req.image_urls?.length > 0 && (
                      <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap' }}>
                        {req.image_urls.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noreferrer">
                            <img src={url} alt="" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 5, border: '1px solid #2e2e5a' }} />
                          </a>
                        ))}
                      </div>
                    )}

                    {/* Bezahl-Block */}
                    {req.price > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        {editingPayment === req.id ? (
                          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', padding: '8px 10px', background: 'var(--bg-card)', borderRadius: 6 }}>
                            <div>
                              <label style={{ fontSize: 9, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Gesamt</label>
                              <input type="number" value={editPrice} onChange={e => setEditPrice(e.target.value)}
                                style={{ width: 80, background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '4px 6px', borderRadius: 5, fontSize: 11, fontFamily: 'inherit' }} />
                            </div>
                            <div>
                              <label style={{ fontSize: 9, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Anzahlung</label>
                              <input type="number" value={editDeposit} onChange={e => setEditDeposit(e.target.value)}
                                style={{ width: 80, background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '4px 6px', borderRadius: 5, fontSize: 11, fontFamily: 'inherit' }} />
                            </div>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button onClick={async () => {
                                await supabase.from('content_requests').update({ price: parseFloat(editPrice) || 0, deposit: parseFloat(editDeposit) || 0 }).eq('id', req.id)
                                setEditingPayment(null); loadContentRequests()
                              }} style={{ fontSize: 10, padding: '4px 10px', borderRadius: 4, background: '#10b981', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>✓</button>
                              <button onClick={() => setEditingPayment(null)} style={{ fontSize: 10, padding: '4px 8px', borderRadius: 4, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {/* Fortschrittsbalken */}
                            <div style={{ display: 'flex', height: 5, background: barTrackColor, borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
                              <div style={{ width: `${paidPct}%`, background: '#10b981', transition: 'width 0.3s' }} />
                            </div>
                            {/* Bezahl-Status Zeilen */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
                              {req.deposit > 0 && remainder > 0 ? (
                                <>
                                  {/* Anzahlung-Zeile */}
                                  <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                      <span style={{ color: req.deposit_paid ? '#10b981' : '#f59e0b' }}>
                                        {req.deposit_paid ? '✓' : '⏳'} Anzahlung ${req.deposit}
                                        {req.deposit_paid && req.deposit_paid_at && (
                                          <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 10 }}>
                                            am {new Date(req.deposit_paid_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                                          </span>
                                        )}
                                      </span>
                                      {!req.deposit_paid && (
                                        <div style={{ display: 'flex', gap: 4 }}>
                                          <button onClick={() => markPaymentPaid(req, 'deposit')}
                                            style={{ fontSize: 9, padding: '2px 8px', borderRadius: 3, background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', cursor: 'pointer', fontFamily: 'inherit' }}>✓ Anzahlung heute</button>
                                          <button onClick={() => { setShowDatePicker({ reqId: req.id, type: 'deposit' }); setPickerDate(todayIso()) }}
                                            style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }} title="Anderes Datum">📅</button>
                                        </div>
                                      )}
                                    </div>
                                    {showDatePicker?.reqId === req.id && showDatePicker?.type === 'deposit' && (
                                      <div style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center' }}>
                                        <input type="date" value={pickerDate} onChange={e => setPickerDate(e.target.value)}
                                          style={{ fontSize: 11, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', fontFamily: 'inherit' }} />
                                        <button onClick={() => { markPaymentPaid(req, 'deposit', pickerDate); setShowDatePicker(null) }}
                                          style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: '#10b981', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>✓ Speichern</button>
                                        <button onClick={() => setShowDatePicker(null)}
                                          style={{ fontSize: 10, padding: '3px 6px', borderRadius: 4, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                                      </div>
                                    )}
                                  </div>

                                  {/* Rest-Zeile mit Fälligkeitsdatum */}
                                  <div>
                                    {(() => {
                                      const overdue = !req.remainder_paid && req.remainder_due_at && new Date(req.remainder_due_at) < new Date(todayIso())
                                      const daysOverdue = overdue ? Math.floor((new Date(todayIso()) - new Date(req.remainder_due_at)) / (86400 * 1000)) : 0
                                      return (
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                          <span style={{ color: req.remainder_paid ? '#10b981' : overdue ? '#ef4444' : '#f59e0b' }}>
                                            {req.remainder_paid ? '✓' : overdue ? '⚠' : '⏳'} Rest ${remainder}
                                            {req.remainder_paid && req.remainder_paid_at && (
                                              <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 10 }}>
                                                am {new Date(req.remainder_paid_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                                              </span>
                                            )}
                                            {!req.remainder_paid && req.remainder_due_at && (
                                              <span style={{ color: overdue ? '#ef4444' : 'var(--text-muted)', marginLeft: 6, fontSize: 10, fontWeight: overdue ? 700 : 400 }}>
                                                {overdue ? `· überfällig seit ${daysOverdue} Tag${daysOverdue !== 1 ? 'en' : ''}` : `· fällig bis ${new Date(req.remainder_due_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })}`}
                                              </span>
                                            )}
                                          </span>
                                          {!req.remainder_paid && (
                                            <div style={{ display: 'flex', gap: 4 }}>
                                              <button onClick={() => markPaymentPaid(req, 'remainder')}
                                                style={{ fontSize: 9, padding: '2px 8px', borderRadius: 3, background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', cursor: 'pointer', fontFamily: 'inherit' }}>✓ Rest heute</button>
                                              <button onClick={() => { setShowDatePicker({ reqId: req.id, type: 'remainder' }); setPickerDate(todayIso()) }}
                                                style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }} title="Anderes Datum">📅</button>
                                              <button onClick={() => { setShowDatePicker({ reqId: req.id, type: 'due' }); setPickerDate(req.remainder_due_at || todayIso()) }}
                                                style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: req.remainder_due_at ? 'rgba(245,158,11,0.1)' : 'transparent', color: req.remainder_due_at ? '#f59e0b' : 'var(--text-muted)', border: `1px solid ${req.remainder_due_at ? 'rgba(245,158,11,0.3)' : 'var(--border)'}`, cursor: 'pointer', fontFamily: 'inherit' }} title="Fälligkeitsdatum setzen">⏰</button>
                                            </div>
                                          )}
                                        </div>
                                      )
                                    })()}
                                    {showDatePicker?.reqId === req.id && showDatePicker?.type === 'remainder' && (
                                      <div style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center' }}>
                                        <input type="date" value={pickerDate} onChange={e => setPickerDate(e.target.value)}
                                          style={{ fontSize: 11, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', fontFamily: 'inherit' }} />
                                        <button onClick={() => { markPaymentPaid(req, 'remainder', pickerDate); setShowDatePicker(null) }}
                                          style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: '#10b981', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>✓ Rest erhalten</button>
                                        <button onClick={() => setShowDatePicker(null)}
                                          style={{ fontSize: 10, padding: '3px 6px', borderRadius: 4, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                                      </div>
                                    )}
                                    {showDatePicker?.reqId === req.id && showDatePicker?.type === 'due' && (
                                      <div style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center' }}>
                                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Rest fällig bis:</span>
                                        <input type="date" value={pickerDate} onChange={e => setPickerDate(e.target.value)}
                                          style={{ fontSize: 11, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', fontFamily: 'inherit' }} />
                                        <button onClick={() => { setRemainderDueDate(req.id, pickerDate); setShowDatePicker(null) }}
                                          style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: '#f59e0b', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>⏰ Setzen</button>
                                        {req.remainder_due_at && (
                                          <button onClick={() => { setRemainderDueDate(req.id, null); setShowDatePicker(null) }}
                                            style={{ fontSize: 10, padding: '3px 6px', borderRadius: 4, background: 'transparent', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer', fontFamily: 'inherit' }}>✕ Entfernen</button>
                                        )}
                                        <button onClick={() => setShowDatePicker(null)}
                                          style={{ fontSize: 10, padding: '3px 6px', borderRadius: 4, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>Abbrechen</button>
                                      </div>
                                    )}
                                  </div>
                                </>
                              ) : (
                                <div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                    <span style={{ color: req.deposit_paid ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                                      {req.deposit_paid ? `✓ Vollständig bezahlt $${req.price}` : `⊗ Nichts bezahlt — $${req.price} offen`}
                                      {req.deposit_paid && req.deposit_paid_at && (
                                        <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 10, fontWeight: 400 }}>
                                          am {new Date(req.deposit_paid_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                                        </span>
                                      )}
                                    </span>
                                    {!req.deposit_paid && (
                                      <div style={{ display: 'flex', gap: 4 }}>
                                        <button onClick={() => markPaymentPaid(req, 'deposit')}
                                          style={{ fontSize: 9, padding: '2px 8px', borderRadius: 3, background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', cursor: 'pointer', fontFamily: 'inherit' }}>✓ Bezahlt heute</button>
                                        <button onClick={() => { setShowDatePicker({ reqId: req.id, type: 'deposit' }); setPickerDate(todayIso()) }}
                                          style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }} title="Anderes Datum">📅</button>
                                      </div>
                                    )}
                                  </div>
                                  {showDatePicker?.reqId === req.id && showDatePicker?.type === 'deposit' && (
                                    <div style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center' }}>
                                      <input type="date" value={pickerDate} onChange={e => setPickerDate(e.target.value)}
                                        style={{ fontSize: 11, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', fontFamily: 'inherit' }} />
                                      <button onClick={() => { markPaymentPaid(req, 'deposit', pickerDate); setShowDatePicker(null) }}
                                        style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: '#10b981', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>✓ Speichern</button>
                                      <button onClick={() => setShowDatePicker(null)}
                                        style={{ fontSize: 10, padding: '3px 6px', borderRadius: 4, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            <button onClick={() => { setEditingPayment(req.id); setEditPrice(String(req.price || '')); setEditDeposit(String(req.deposit || '')) }}
                              style={{ marginTop: 4, fontSize: 9, padding: '2px 7px', borderRadius: 3, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>✎ Beträge bearbeiten</button>
                          </>
                        )}
                      </div>
                    )}

                    {/* Action-Buttons */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' }}>
                      {req.status !== 'angefragt' && req.status !== 'bestaetigt' && req.status !== 'erledigt' && (
                        <button onClick={() => updateRequestStatus(req.id, 'angefragt')} style={{ fontSize: 10, padding: '5px 12px', borderRadius: 5, background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>⏳ Anfragen + TG</button>
                      )}
                      {req.status !== 'bestaetigt' && req.status !== 'erledigt' && (
                        <button onClick={() => updateRequestStatus(req.id, 'bestaetigt')} style={{ fontSize: 11, padding: '5px 14px', borderRadius: 5, background: '#06b6d4', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>✓ Bestätigen + TG</button>
                      )}
                      {req.status !== 'erledigt' && req.status !== 'abgelehnt' && (
                        <button onClick={() => updateRequestStatus(req.id, 'erledigt')} style={{ fontSize: 10, padding: '5px 12px', borderRadius: 5, background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>✓ Erledigt</button>
                      )}
                      {req.status !== 'abgelehnt' && req.status !== 'erledigt' && (
                        <button onClick={() => updateRequestStatus(req.id, 'abgelehnt')} style={{ fontSize: 10, padding: '5px 12px', borderRadius: 5, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>✕ Ablehnen</button>
                      )}
                    </div>
                    </>)}
                  </div>
                )
              })}
            </div>
          )}
        </Card>
        )
      })()}

      {/* CONTENT-IDEEN ADMIN */}
      {activeSection === 'content-ideas' && (() => {
        const filteredIdeas = ideasFilter === 'all' ? contentIdeas
          : ideasFilter === 'open' ? contentIdeas.filter(i => i.status === 'offen' || i.status === 'in_arbeit')
          : ideasFilter === 'done' ? contentIdeas.filter(i => i.status === 'erledigt' || i.status === 'abgelehnt')
          : contentIdeas
        return (
        <Card title={`💡 Content-Ideen (${filteredIdeas.length})`}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
            Wünsche & Ideen die Chatter eingereicht haben. Du kannst editieren, an Model schicken, Status ändern.
          </div>

          {/* Filter */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {[
              { key: 'open', label: `⏳ Offen (${contentIdeas.filter(i => i.status === 'offen' || i.status === 'in_arbeit').length})` },
              { key: 'done', label: `✓ Erledigt (${contentIdeas.filter(i => i.status === 'erledigt' || i.status === 'abgelehnt').length})` },
              { key: 'all', label: `Alle (${contentIdeas.length})` },
            ].map(f => (
              <button key={f.key} onClick={() => setIdeasFilter(f.key)} style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                background: ideasFilter === f.key ? 'rgba(167,139,250,0.2)' : 'transparent',
                border: `1px solid ${ideasFilter === f.key ? '#a78bfa' : 'var(--border)'}`,
                color: ideasFilter === f.key ? '#a78bfa' : 'var(--text-secondary)',
                fontWeight: 600, fontFamily: 'inherit'
              }}>{f.label}</button>
            ))}
          </div>

          {filteredIdeas.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
              Keine Ideen in dieser Kategorie
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredIdeas.map(idea => {
                const statusColor = idea.status === 'erledigt' ? '#10b981' : idea.status === 'in_arbeit' ? '#06b6d4' : idea.status === 'abgelehnt' ? '#ef4444' : '#a78bfa'
                const statusLabel = idea.status === 'erledigt' ? '✓ Erledigt' : idea.status === 'in_arbeit' ? '⚙ In Arbeit' : idea.status === 'abgelehnt' ? '✕ Abgelehnt' : '● Offen'
                const prioIcon = idea.priority === 'urgent' ? '🔥' : idea.priority === 'nice' ? '💭' : '📅'
                const prioColor = idea.priority === 'urgent' ? '#ef4444' : idea.priority === 'nice' ? '#06b6d4' : '#f59e0b'
                const catIcon = idea.category === 'videos' ? '🎬' : idea.category === 'audio' ? '🎙' : idea.category === 'sonstiges' ? '💭' : '📸'
                const isEditing = editingIdeaId === idea.id
                const displayText = idea.edited_text || idea.idea_text
                return (
                  <div key={idea.id} style={{
                    padding: '12px 14px', background: 'var(--bg-card2)', borderRadius: 8,
                    borderLeft: `3px solid ${statusColor}`, border: `1px solid ${idea.status === 'offen' ? 'rgba(167,139,250,0.3)' : 'var(--border)'}`
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 16 }}>{catIcon}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#a78bfa' }}>{idea.model_name}</span>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: prioColor + '22', color: prioColor, fontWeight: 600 }}>
                          {prioIcon} {idea.priority === 'urgent' ? 'Dringend' : idea.priority === 'nice' ? 'Wenn Zeit' : 'Normal'}
                        </span>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: statusColor + '22', color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', textAlign: 'right' }}>
                        Von {idea.created_by}<br/>
                        {new Date(idea.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>

                    {!isEditing ? (
                      <>
                        <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: 8, whiteSpace: 'pre-wrap' }}>
                          {displayText}
                        </div>
                        {idea.edited_text && idea.edited_text !== idea.idea_text && (
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8, padding: '4px 8px', background: 'rgba(124,58,237,0.05)', borderRadius: 5 }}>
                            <strong>Original:</strong> {idea.idea_text}
                          </div>
                        )}
                        {idea.admin_note && (
                          <div style={{ fontSize: 11, color: '#06b6d4', marginBottom: 8, padding: '4px 8px', background: 'rgba(6,182,212,0.08)', borderRadius: 5 }}>
                            💬 Admin-Hinweis: {idea.admin_note}
                          </div>
                        )}
                        {idea.sent_to_model_at && (
                          <div style={{ fontSize: 10, color: '#10b981', marginBottom: 8 }}>
                            ✓ An {idea.model_name} gesendet am {new Date(idea.sent_to_model_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ marginBottom: 8 }}>
                        <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Idee (editieren)</label>
                        <textarea value={editingIdeaText} onChange={e => setEditingIdeaText(e.target.value)} rows={3}
                          style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #7c3aed', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box', marginBottom: 6 }} />
                        <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Admin-Hinweis (optional)</label>
                        <textarea value={editingAdminNote} onChange={e => setEditingAdminNote(e.target.value)} rows={2}
                          placeholder="z.B. 'Bitte mit Outdoor-Setting' oder 'Eilig wegen Promo'"
                          style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {!isEditing ? (
                        <>
                          <button onClick={() => { setEditingIdeaId(idea.id); setEditingIdeaText(idea.edited_text || idea.idea_text); setEditingAdminNote(idea.admin_note || '') }} style={{
                            fontSize: 11, padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
                            background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontFamily: 'inherit', fontWeight: 600
                          }}>✎ Bearbeiten</button>
                          {!idea.sent_to_model_at && (
                            <button onClick={() => sendIdeaToModel(idea)} style={{
                              fontSize: 11, padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
                              background: '#06b6d4', border: 'none', color: '#fff', fontFamily: 'inherit', fontWeight: 700
                            }}>📤 An {idea.model_name} schicken</button>
                          )}
                          {idea.sent_to_model_at && (
                            <button onClick={() => sendIdeaToModel(idea)} style={{
                              fontSize: 11, padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
                              background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.3)', color: '#06b6d4', fontFamily: 'inherit', fontWeight: 600
                            }}>📤 Nochmal schicken</button>
                          )}
                          {idea.status !== 'erledigt' && (
                            <button onClick={() => updateIdeaStatus(idea.id, 'erledigt')} style={{
                              fontSize: 11, padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
                              background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', fontFamily: 'inherit', fontWeight: 600
                            }}>✓ Erledigt</button>
                          )}
                          {idea.status !== 'abgelehnt' && (
                            <button onClick={() => updateIdeaStatus(idea.id, 'abgelehnt')} style={{
                              fontSize: 11, padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
                              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', fontFamily: 'inherit', fontWeight: 600
                            }}>✕ Ablehnen</button>
                          )}
                          <button onClick={() => deleteIdea(idea.id)} style={{
                            marginLeft: 'auto', fontSize: 11, padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
                            background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', fontFamily: 'inherit'
                          }}>🗑 Löschen</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => saveIdeaEdit(idea.id)} style={{
                            fontSize: 11, padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
                            background: '#7c3aed', border: 'none', color: '#fff', fontFamily: 'inherit', fontWeight: 700
                          }}>💾 Speichern</button>
                          <button onClick={() => { setEditingIdeaId(null); setEditingIdeaText(''); setEditingAdminNote('') }} style={{
                            fontSize: 11, padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
                            background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', fontFamily: 'inherit'
                          }}>Abbrechen</button>
                        </>
                      )}
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

        // Gruppieren nach Monat: Schlüssel "YYYY-MM"
        const byMonth = {}
        for (const r of erledigte) {
          if (!r.created_at) continue
          const d = new Date(r.created_at)
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
          if (!byMonth[key]) byMonth[key] = []
          byMonth[key].push(r)
        }

        // Aktueller Monat
        const now = new Date()
        const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

        // Sortiere Monatsschlüssel absteigend (neuester zuerst)
        const monthKeys = Object.keys(byMonth).sort((a, b) => b.localeCompare(a))
        const currentItems = byMonth[currentKey] || []
        const pastKeys = monthKeys.filter(k => k !== currentKey)

        const monthLabel = (key) => {
          const [y, m] = key.split('-')
          const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
          return `${months[parseInt(m, 10) - 1]} ${y}`
        }

        const calcStats = (items) => {
          const total = items.reduce((s, r) => s + (r.price || 0), 0)
          const byModel = {}
          const byChatter = {}
          for (const r of items) {
            const m = r.model_name || '—'
            const c = r.chatter_name || '—'
            if (!byModel[m]) byModel[m] = { count: 0, revenue: 0 }
            byModel[m].count += 1
            byModel[m].revenue += r.price || 0
            if (!byChatter[c]) byChatter[c] = { count: 0, revenue: 0 }
            byChatter[c].count += 1
            byChatter[c].revenue += r.price || 0
          }
          const topModel = Object.entries(byModel).sort((a, b) => b[1].revenue - a[1].revenue)[0]
          const topChatter = Object.entries(byChatter).sort((a, b) => b[1].revenue - a[1].revenue)[0]
          return { total, byModel, byChatter, topModel, topChatter }
        }

        const renderTable = (items) => (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  {['Datum', 'Chatter', 'Model', 'Typ', 'Kunde', 'Wunsch', 'Dringlichkeit', 'Preis', 'Anzahlung', 'Rest'].map(h => <th key={h} style={thS}>{h}</th>)}
                  {isAdminUser && <th style={thS}></th>}
                </tr>
              </thead>
              <tbody>
                {items.map(req => {
                  const remainder = (req.price || 0) - (req.deposit || 0)
                  const deadlineLabel = req.deadline === 'asap' ? '⚡ ASAP' : req.deadline === 'hours' ? '⏰ Heute' : req.deadline === 'days' ? '📅 1-2 Tage' : req.deadline === 'week' ? '🗓 Diese Woche' : '—'
                  const deadlineColor = req.deadline === 'asap' ? '#ef4444' : req.deadline === 'hours' ? '#f97316' : req.deadline === 'days' ? '#f59e0b' : '#10b981'
                  const editedInfo = req.edited_by && req.edited_at
                    ? `bearbeitet ${new Date(req.edited_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${req.edited_by}`
                    : null
                  return (
                    <React.Fragment key={req.id}>
                      <tr>
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
                        {isAdminUser && (
                          <td style={{ ...tdS, padding: '4px 8px' }}>
                            <button onClick={() => setEditingRequest(req)} title="Bearbeiten" style={{
                              background: 'transparent', border: '1px solid var(--border)',
                              color: 'var(--text-muted)', borderRadius: 5,
                              padding: '3px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                            }}>✏</button>
                          </td>
                        )}
                      </tr>
                      {editedInfo && (
                        <tr>
                          <td colSpan={isAdminUser ? 11 : 10} style={{ padding: '0 10px 6px', borderBottom: '1px solid #1e1e3a', color: 'var(--text-muted)', fontSize: 9, fontStyle: 'italic' }}>
                            ↳ {editedInfo}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )

        const renderStatsRow = (stats) => (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {Object.entries(stats.byModel).sort((a, b) => b[1].revenue - a[1].revenue).map(([name, v]) => (
              <div key={`m-${name}`} style={{ padding: '4px 10px', background: 'rgba(167,139,250,0.1)', borderRadius: 6, border: '1px solid rgba(167,139,250,0.25)' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#a78bfa' }}>{name}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 5 }}>{v.count}×</span>
                <span style={{ fontSize: 11, color: '#10b981', marginLeft: 6, fontFamily: 'monospace' }}>${v.revenue.toFixed(0)}</span>
              </div>
            ))}
            {Object.entries(stats.byChatter).sort((a, b) => b[1].revenue - a[1].revenue).map(([name, v]) => (
              <div key={`c-${name}`} style={{ padding: '4px 10px', background: 'rgba(6,182,212,0.08)', borderRadius: 6, border: '1px solid rgba(6,182,212,0.25)' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#06b6d4' }}>{name}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 5 }}>{v.count}×</span>
                <span style={{ fontSize: 11, color: '#10b981', marginLeft: 6, fontFamily: 'monospace' }}>${v.revenue.toFixed(0)}</span>
              </div>
            ))}
          </div>
        )

        return (
          <Card title={`Custom Content Verlauf (${erledigte.length})`}>
            {erledigte.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>Noch keine erledigten Anfragen</div>
            ) : (
              <>
                {/* Aktueller Monat — ausgeklappt */}
                {currentItems.length > 0 && (() => {
                  const stats = calcStats(currentItems)
                  return (
                    <div style={{ marginBottom: 24, padding: 14, background: 'rgba(124,58,237,0.06)', borderRadius: 10, border: '1px solid rgba(124,58,237,0.25)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#a78bfa' }}>🟣 {monthLabel(currentKey)}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>laufender Monat</span>
                        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
                          {currentItems.length} Customs · <span style={{ color: '#10b981', fontFamily: 'monospace', fontWeight: 700 }}>${stats.total.toFixed(0)}</span>
                        </span>
                      </div>
                      {renderStatsRow(stats)}
                      {renderTable(currentItems)}
                    </div>
                  )
                })()}

                {/* Vergangene Monate — Akkordeon */}
                {pastKeys.map(key => {
                  const items = byMonth[key]
                  const stats = calcStats(items)
                  const isOpen = !!expandedMonths[key]
                  return (
                    <div key={key} style={{ marginBottom: 10, background: 'var(--bg-card2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div onClick={() => setExpandedMonths(prev => ({ ...prev, [key]: !prev[key] }))} style={{
                        padding: '12px 14px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                      }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>📅 {monthLabel(key)}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{items.length} Customs</span>
                        <span style={{ fontSize: 12, color: '#10b981', fontFamily: 'monospace', fontWeight: 700 }}>${stats.total.toFixed(0)}</span>
                        {stats.topModel && (
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 6 }}>
                            🥇 Model: <span style={{ color: '#a78bfa', fontWeight: 600 }}>{stats.topModel[0]}</span> (${stats.topModel[1].revenue.toFixed(0)})
                          </span>
                        )}
                        {stats.topChatter && (
                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                            🥇 Chatter: <span style={{ color: '#06b6d4', fontWeight: 600 }}>{stats.topChatter[0]}</span> (${stats.topChatter[1].revenue.toFixed(0)})
                          </span>
                        )}
                        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{isOpen ? '▲' : '▼'}</span>
                      </div>
                      {isOpen && (
                        <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border)' }}>
                          <div style={{ marginTop: 12 }}>
                            {renderStatsRow(stats)}
                            {renderTable(items)}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            )}
          </Card>
        )
      })()}

      {/* v2.9.8: Lightbox für Bild-Anhänge */}
      {lightboxImage && (
        <div onClick={() => setLightboxImage(null)} style={{
          position: 'fixed', inset: 0, zIndex: 10001,
          background: 'rgba(0,0,0,0.9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', padding: 20,
        }}>
          <img src={lightboxImage} alt="Vergrößert" style={{
            maxWidth: '95%', maxHeight: '95%', objectFit: 'contain',
            borderRadius: 8, boxShadow: '0 0 40px rgba(0,0,0,0.5)',
          }} />
          <button onClick={(e) => { e.stopPropagation(); setLightboxImage(null) }} style={{
            position: 'absolute', top: 16, right: 16, width: 36, height: 36, borderRadius: '50%',
            background: 'rgba(0,0,0,0.7)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)',
            fontSize: 18, cursor: 'pointer', fontFamily: 'inherit',
          }}>✕</button>
        </div>
      )}

      {/* EDIT-MODAL für Custom Content (nur Admins) */}
      {editingRequest && isAdminUser && (() => {
        const r = editingRequest
        return (
          <div onClick={() => setEditingRequest(null)} style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}>
            <div onClick={e => e.stopPropagation()} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
              padding: 20, maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto',
              boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Custom Content bearbeiten</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.model_name} · {r.chatter_name} · {new Date(r.created_at).toLocaleDateString('de-DE')}</div>
                </div>
                <button onClick={() => setEditingRequest(null)} style={{
                  background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 22, cursor: 'pointer', padding: 0,
                }}>✕</button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                {/* Preis */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Preis ($)</span>
                  <input type="number" step="0.01" defaultValue={r.price ?? ''} id="edit-price" style={inputS} />
                </label>
                {/* Anzahlung Betrag */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Anzahlung ($)</span>
                  <input type="number" step="0.01" defaultValue={r.deposit ?? ''} id="edit-deposit" style={inputS} />
                </label>
                {/* Typ */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Typ</span>
                  <select defaultValue={r.content_type || ''} id="edit-type" style={inputS}>
                    <option value="">—</option>
                    <option value="audio">audio</option>
                    <option value="video">video</option>
                    <option value="foto">foto</option>
                    <option value="other">other</option>
                  </select>
                </label>
                {/* Dringlichkeit */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Dringlichkeit</span>
                  <select defaultValue={r.deadline || ''} id="edit-deadline" style={inputS}>
                    <option value="">—</option>
                    <option value="asap">⚡ ASAP</option>
                    <option value="hours">⏰ Heute</option>
                    <option value="days">📅 1-2 Tage</option>
                    <option value="week">🗓 Diese Woche</option>
                  </select>
                </label>
                {/* Kunde */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Kunden-ID</span>
                  <input type="text" defaultValue={r.customer_id || ''} id="edit-customer" style={inputS} />
                </label>
                {/* Status */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Status</span>
                  <select defaultValue={r.status || ''} id="edit-status" style={inputS}>
                    <option value="neu">neu</option>
                    <option value="bestätigt">bestätigt</option>
                    <option value="erledigt">erledigt</option>
                    <option value="abgelehnt">abgelehnt</option>
                  </select>
                </label>
              </div>

              {/* Wunsch */}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Wunsch</span>
                <textarea defaultValue={r.request_text || ''} id="edit-request-text" rows={3} style={{ ...inputS, resize: 'vertical' }} />
              </label>

              {/* Zahl-Status Toggles */}
              <div style={{ display: 'flex', gap: 14, marginBottom: 18, padding: 10, background: 'var(--bg-card2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" defaultChecked={!!r.deposit_paid} id="edit-deposit-paid" style={{ width: 16, height: 16, cursor: 'pointer' }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>Anzahlung bezahlt</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" defaultChecked={!!r.remainder_paid} id="edit-remainder-paid" style={{ width: 16, height: 16, cursor: 'pointer' }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>Rest bezahlt</span>
                </label>
              </div>

              {r.edited_by && r.edited_at && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 12 }}>
                  Zuletzt bearbeitet {new Date(r.edited_at).toLocaleString('de-DE')} · {r.edited_by}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setEditingRequest(null)} style={{
                  flex: 1, padding: '10px', borderRadius: 7,
                  background: 'transparent', border: '1px solid var(--border)',
                  color: 'var(--text-muted)', fontSize: 12, fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>Abbrechen</button>
                <button onClick={() => {
                  const updates = {
                    price: parseFloat(document.getElementById('edit-price').value) || null,
                    deposit: parseFloat(document.getElementById('edit-deposit').value) || null,
                    content_type: document.getElementById('edit-type').value || null,
                    deadline: document.getElementById('edit-deadline').value || null,
                    customer_id: document.getElementById('edit-customer').value || null,
                    status: document.getElementById('edit-status').value || null,
                    request_text: document.getElementById('edit-request-text').value || null,
                    deposit_paid: document.getElementById('edit-deposit-paid').checked,
                    remainder_paid: document.getElementById('edit-remainder-paid').checked,
                  }
                  saveEditedRequest(updates)
                }} style={{
                  flex: 2, padding: '10px', borderRadius: 7,
                  background: '#7c3aed', color: '#fff', border: 'none', fontSize: 13, fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>💾 Speichern</button>
              </div>
            </div>
          </div>
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
                    // v2.9.4: Berlin-Zeit fix für alle Admins (egal wo sie sitzen)
                    const fmt = (d) => d.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
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
      {activeSection === 'swaps' && (() => {
        const unseenOpenCount = swaps.filter(s => s.status === 'offen' && !s.seen_by_admin).length
        return (
        <Card title="Schicht-Tausch Anfragen">
          {unseenOpenCount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
              <button onClick={markAllSwapsSeen} style={{
                fontSize: 11, padding: '5px 12px', borderRadius: 6,
                background: 'transparent', border: '1px solid var(--border)',
                color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit',
              }}>✓ Alle als gelesen markieren ({unseenOpenCount})</button>
            </div>
          )}
          {swaps.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Keine Tausch-Anfragen</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(() => {
                const today = new Date().toISOString().slice(0, 10)
                const allEntries = groupSwaps(swaps)
                const isOld = (e) => e.rep.status !== 'offen' && e.rep.shift_date < today
                const oldCount = allEntries.filter(isOld).length
                const visible = showOldSwaps ? allEntries : allEntries.filter(e => !isOld(e))
                return (<>
              {visible.map(entry => {
                const swap = entry.rep
                const blockRows = entry.rows
                const isAdminOffer = !swap.requester_name
                const dateLabel = new Date(swap.shift_date + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
                const reactions = entry.reactions
                const wantTake = reactions.filter(r => r.reaction === 'uebernehmen')
                const maybe = reactions.filter(r => r.reaction === 'vielleicht')
                const declined = reactions.filter(r => r.reaction === 'abgelehnt')

                const borderColor =
                  swap.status === 'offen' ? 'rgba(245,158,11,0.3)'
                  : swap.status === 'angenommen' ? 'rgba(16,185,129,0.3)'
                  : 'var(--border)'

                return (
                  <div key={entry.key} style={{ padding: '11px 14px', background: 'var(--bg-card2)', borderRadius: 10, border: `1px solid ${borderColor}` }}>
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: reactions.length > 0 || swap.status !== 'offen' ? 12 : 0 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                          {isAdminOffer ? (
                            <span style={{ color: '#06b6d4' }}>📢 Admin-Angebot</span>
                          ) : (
                            <span style={{ color: '#a78bfa' }}>{swap.requester_name}</span>
                          )}
                          {entry.isBlock && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(124,58,237,0.2)', color: '#a78bfa' }}>📦 BLOCK · {blockRows.length}</span>}
                          {' · '}{swap.shift}schicht · {dateLabel}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {entry.isBlock ? 'Models' : 'Model'}: {entry.modelsLabel}{entry.isBlock && swap.block_label ? ` · ${swap.block_label}` : ''}{swap.reason ? ` · ${swap.reason}` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 700,
                          background: swap.status === 'offen' ? 'rgba(245,158,11,0.15)' : swap.status === 'angenommen' ? 'rgba(16,185,129,0.15)' : 'rgba(100,100,120,0.15)',
                          color: swap.status === 'offen' ? '#f59e0b' : swap.status === 'angenommen' ? '#10b981' : 'var(--text-muted)',
                        }}>
                          {swap.status === 'offen' ? 'Offen' : swap.status === 'angenommen' ? `✓ ${swap.accepted_by}` : 'Abgeschlossen'}
                        </span>

                        {swap.status === 'offen' && isAdminOffer && (
                          <button onClick={() => entry.isBlock ? cancelAdminOfferBlock(blockRows) : cancelAdminOffer(swap.id)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: 'transparent', color: 'rgba(239,68,68,0.7)', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>✕ Zurücknehmen</button>
                        )}
                        {swap.status === 'offen' && !isAdminOffer && (
                          <button onClick={() => closeSwap(swap)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>✕ Abschließen</button>
                        )}
                        {swap.status === 'angenommen' && (
                          <button onClick={() => entry.isBlock ? resetSwapBlockToOpen(blockRows) : resetSwapToOpen(swap.id)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>↺ Wieder offen</button>
                        )}
                      </div>
                    </div>

                    {/* Reaktionen */}
                    {swap.status === 'offen' && reactions.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.5, marginBottom: 2 }}>
                          REAKTIONEN ({reactions.length})
                        </div>

                        {wantTake.length > 0 && (
                          <div>
                            <div style={{ fontSize: 10, color: '#10b981', fontWeight: 700, marginBottom: 4 }}>✓ Wollen übernehmen ({wantTake.length})</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                              {wantTake.map(r => (
                                <button key={r.id} onClick={() => entry.isBlock ? assignSwapBlockTo(blockRows, r.chatter_name) : assignSwapTo(swap, r.chatter_name)} style={{
                                  fontSize: 11, padding: '4px 10px', borderRadius: 5,
                                  background: 'rgba(16,185,129,0.12)', color: '#10b981',
                                  border: '1px solid rgba(16,185,129,0.35)',
                                  fontFamily: 'inherit', fontWeight: 600, cursor: 'pointer',
                                }} title="Klick zum Vergeben">{r.chatter_name} → vergeben</button>
                              ))}
                            </div>
                          </div>
                        )}

                        {maybe.length > 0 && (
                          <div>
                            <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700, marginBottom: 4 }}>? Vielleicht ({maybe.length})</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                              {maybe.map(r => (
                                <button key={r.id} onClick={() => entry.isBlock ? assignSwapBlockTo(blockRows, r.chatter_name) : assignSwapTo(swap, r.chatter_name)} style={{
                                  fontSize: 11, padding: '4px 10px', borderRadius: 5,
                                  background: 'rgba(245,158,11,0.1)', color: '#f59e0b',
                                  border: '1px solid rgba(245,158,11,0.3)',
                                  fontFamily: 'inherit', fontWeight: 600, cursor: 'pointer',
                                }} title="Klick zum Vergeben">{r.chatter_name} → vergeben</button>
                              ))}
                            </div>
                          </div>
                        )}

                        {declined.length > 0 && (
                          <div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4 }}>✕ Abgelehnt ({declined.length})</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                              {declined.map(r => (
                                <span key={r.id} style={{
                                  fontSize: 11, padding: '3px 9px', borderRadius: 5,
                                  background: 'transparent', color: 'var(--text-muted)',
                                  border: '1px solid var(--border)',
                                }}>{r.chatter_name}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
                {oldCount > 0 && (
                  <button onClick={() => setShowOldSwaps(!showOldSwaps)} style={{ background: 'transparent', border: '1px dashed #2e2e5a', color: 'var(--text-muted)', borderRadius: 7, padding: '7px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', marginTop: 2 }}>
                    {showOldSwaps ? '▲ Ältere/abgeschlossene ausblenden' : `▼ ${oldCount} ältere/abgeschlossene anzeigen`}
                  </button>
                )}
                </>)
              })()}
            </div>
          )}
        </Card>
        )
      })()}

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
            {activeModels.map(m => (
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
