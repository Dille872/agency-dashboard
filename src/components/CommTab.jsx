import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { sendTelegramMessage, notifyOwner, getUpdates } from '../telegram'
import Card from './Card'

const OWNER_EMAIL = 'dillemc@hotmail.com'
const DISPLAY_NAMES = {
  'dillemc@hotmail.com': 'Christoph',
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
    <div style={{ padding: '12px', background: '#13132a', borderRadius: 8, border: '1px solid #2e2e5a' }}>
      <div style={{ fontSize: 11, color: '#4a4a6a', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
        {type === 'model' ? 'Model' : 'Chatter'} hinzufügen
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          value={name} onChange={e => setName(e.target.value)}
          placeholder="Name" autoFocus
          style={{ background: '#0b0b1a', border: '1px solid #2e2e5a', color: '#f0f0ff', padding: '8px 10px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
        />
        <input
          value={tgId} onChange={e => setTgId(e.target.value)}
          placeholder="Telegram ID"
          style={{ background: '#0b0b1a', border: '1px solid #2e2e5a', color: '#f0f0ff', padding: '8px 10px', borderRadius: 7, fontSize: 12, fontFamily: 'monospace', outline: 'none' }}
        />
        <div style={{ fontSize: 10, color: '#4a4a6a' }}>Die ID wird nach dem Speichern nicht mehr angezeigt</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => onSave(name, tgId)} style={{ flex: 1, background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 7, padding: '8px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            Speichern
          </button>
          <button onClick={onCancel} style={{ background: 'transparent', border: '1px solid #2e2e5a', color: '#8888aa', borderRadius: 7, padding: '8px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CommTab({ session }) {
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
  const [activeSection, setActiveSection] = useState('models')
  const lastUpdateIdRef = React.useRef(0)

  useEffect(() => {
    loadModels(); loadChatters(); loadMessages()
    const interval = setInterval(pollTelegram, 10000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (selectedModel) setModelMsgText(MODEL_TEMPLATES[modelMsgType]?.replace('{name}', selectedModel.name) || '')
  }, [modelMsgType, selectedModel])

  useEffect(() => {
    const names = selectedChatters.size === 0 ? 'alle' : [...selectedChatters].join(', ')
    setChatterMsgText(CHATTER_TEMPLATES[chatterMsgType]?.replace('{name}', names) || '')
  }, [chatterMsgType])

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

  const pollTelegram = async () => {
    try {
      const data = await getUpdates(lastUpdateIdRef.current + 1)
      if (!data.result?.length) return
      for (const update of data.result) {
        lastUpdateIdRef.current = update.update_id
        const msg = update.message
        if (!msg) continue
        const fromId = String(msg.from.id)
        const text = msg.text || ''
        if (!text || text === '/start') continue

        const { data: modelData } = await supabase.from('models_contact').select('*').eq('telegram_id', fromId).single()
        if (modelData) {
          let availability = modelData.availability
          const lower = text.toLowerCase()
          if (lower.includes('nicht verfügbar') || lower.includes('not available') || lower.includes('busy') || lower.includes('nicht da')) availability = 'unavailable'
          else if (lower.includes('verfügbar') || lower.includes('available') || lower.includes('ok')) availability = 'available'
          await supabase.from('models_contact').update({ availability, availability_note: text }).eq('id', modelData.id)
          await supabase.from('messages').insert({ model_name: modelData.name, model_telegram_id: fromId, direction: 'in', contact_type: 'model', text, status: 'received', read: false })
          await notifyOwner(`📨 Antwort von Model <b>${modelData.name}</b>:\n${text}`)
          loadMessages(); loadModels()
          continue
        }
        const { data: chatterData } = await supabase.from('chatters_contact').select('*').eq('telegram_id', fromId).single()
        if (chatterData) {
          await supabase.from('messages').insert({ model_name: chatterData.name, model_telegram_id: fromId, direction: 'in', contact_type: 'chatter', text, status: 'received', read: false })
          await notifyOwner(`📨 Antwort von Chatter <b>${chatterData.name}</b>:\n${text}`)
          loadMessages()
          continue
        }
        await notifyOwner(`❓ Unbekannte Nachricht von ID ${fromId} (@${msg.from.username || '?'}):\n${text}`)
      }
    } catch (e) { console.error('Telegram poll error:', e) }
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

  const inboxMessages = messages.filter(m => m.direction === 'in')
  const tdS = { padding: '10px 10px', borderBottom: '1px solid #1e1e3a', color: '#c0c0e0', fontSize: 12 }
  const thS = { padding: '8px 10px', color: '#4a4a6a', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #2e2e5a', whiteSpace: 'nowrap' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[
          { key: 'models', label: 'Models' },
          { key: 'chatters', label: 'Chatters' },
          { key: 'inbox', label: `Posteingang${unreadCount > 0 ? ` (${unreadCount})` : ''}` },
          { key: 'history', label: 'Verlauf' },
        ].map(s => (
          <button key={s.key} onClick={() => setActiveSection(s.key)} style={{
            padding: '7px 16px', borderRadius: 8, cursor: 'pointer',
            background: activeSection === s.key ? '#7c3aed' : 'transparent',
            color: activeSection === s.key ? '#fff' : s.key === 'inbox' && unreadCount > 0 ? '#f59e0b' : '#8888aa',
            border: `1px solid ${activeSection === s.key ? '#7c3aed' : s.key === 'inbox' && unreadCount > 0 ? 'rgba(245,158,11,0.4)' : '#1e1e3a'}`,
            fontWeight: 600, fontSize: 13, fontFamily: 'inherit',
          }}>{s.label}</button>
        ))}
      </div>

      {/* MODELS */}
      {activeSection === 'models' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>
          <Card title="Models">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {models.length === 0 && <div style={{ color: '#4a4a6a', fontSize: 13, padding: '8px 0' }}>Noch keine Models angelegt</div>}
              {models.map(model => (
                <div key={model.id} onClick={() => setSelectedModel(model)} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 12px', background: '#13132a', borderRadius: 8,
                  border: `1px solid ${selectedModel?.id === model.id ? '#7c3aed' : '#1e1e3a'}`,
                  cursor: 'pointer', transition: 'border-color 0.15s',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #7c3aed33, #06b6d433)', border: '1px solid #2e2e5a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#a78bfa', flexShrink: 0 }}>
                      {model.name[0]}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#f0f0ff' }}>{model.name}</div>
                      <div style={{ fontSize: 10, color: '#4a4a6a', marginTop: 1 }}>
                        <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: AVAIL_COLORS[model.availability || 'unknown'], marginRight: 4, verticalAlign: 'middle' }} />
                        {AVAIL_LABELS[model.availability || 'unknown']}
                        {isOwner && model.telegram_id ? ` · TG: ${model.telegram_id}` : model.telegram_id ? ' · Telegram ✓' : ' · Kein Telegram'}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: '#4a4a6a' }}>{model.last_contacted ? formatTime(model.last_contacted) : '—'}</div>
                </div>
              ))}
            </div>
            {showAddModel
              ? <AddContactForm type="model" onSave={addModel} onCancel={() => setShowAddModel(false)} isOwner={isOwner} />
              : <button onClick={() => setShowAddModel(true)} style={{ width: '100%', background: 'transparent', border: '1px dashed #2e2e5a', color: '#4a4a6a', borderRadius: 8, padding: '9px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>+ Model hinzufügen</button>
            }
          </Card>

          <Card title="Nachricht senden">
            {!selectedModel ? (
              <div style={{ color: '#4a4a6a', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>← Model auswählen</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#f0f0ff' }}>An: {selectedModel.name}</div>
                  <button onClick={() => setSelectedModel(null)} style={{ background: 'transparent', border: 'none', color: '#4a4a6a', cursor: 'pointer', fontSize: 12 }}>✕</button>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {MODEL_MSG_TYPES.map(t => (
                    <button key={t.key} onClick={() => setModelMsgType(t.key)} style={{
                      fontSize: 11, padding: '4px 10px', borderRadius: 5, cursor: 'pointer',
                      background: modelMsgType === t.key ? 'rgba(124,58,237,0.2)' : 'transparent',
                      border: `1px solid ${modelMsgType === t.key ? '#7c3aed' : '#1e1e3a'}`,
                      color: modelMsgType === t.key ? '#a78bfa' : '#4a4a6a',
                      fontFamily: 'inherit', fontWeight: 600,
                    }}>{t.label}</button>
                  ))}
                </div>
                <textarea value={modelMsgText} onChange={e => setModelMsgText(e.target.value)} rows={4}
                  style={{ width: '100%', background: '#0b0b1a', border: '1px solid #2e2e5a', color: '#f0f0ff', padding: '10px 12px', borderRadius: 8, fontSize: 13, resize: 'vertical', fontFamily: 'inherit', outline: 'none' }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 11, color: '#4a4a6a' }}>
                    {selectedModel.telegram_id ? '✈ via Telegram' : <span style={{ color: '#ef4444' }}>Kein Telegram</span>}
                  </div>
                  <button onClick={sendModelMessage} disabled={sendingModel || !modelMsgText.trim() || !selectedModel.telegram_id} style={{
                    background: modelMsgText.trim() && selectedModel.telegram_id ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : '#1e1e3a',
                    color: modelMsgText.trim() && selectedModel.telegram_id ? '#fff' : '#4a4a6a',
                    border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  }}>{sendingModel ? 'Senden...' : 'Senden'}</button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* CHATTERS */}
      {activeSection === 'chatters' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>
          <Card title="Chatters">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {chatters.length === 0 && <div style={{ color: '#4a4a6a', fontSize: 13, padding: '8px 0' }}>Noch keine Chatters angelegt</div>}
              {chatters.map(chatter => {
                const isSelected = selectedChatters.has(chatter.id)
                return (
                  <div key={chatter.id} onClick={() => toggleChatter(chatter.id)} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px', background: '#13132a', borderRadius: 8,
                    border: `1px solid ${isSelected ? '#06b6d4' : '#1e1e3a'}`,
                    cursor: 'pointer', transition: 'border-color 0.15s',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${isSelected ? '#06b6d4' : '#2e2e5a'}`, background: isSelected ? '#06b6d4' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {isSelected && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
                      </div>
                      <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #06b6d433, #7c3aed33)', border: '1px solid #2e2e5a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#06b6d4', flexShrink: 0 }}>
                        {chatter.name[0]}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#f0f0ff' }}>{chatter.name}</div>
                        <div style={{ fontSize: 10, color: '#4a4a6a', marginTop: 1 }}>
                          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: AVAIL_COLORS[chatter.availability || 'unknown'], marginRight: 4, verticalAlign: 'middle' }} />
                          {AVAIL_LABELS[chatter.availability || 'unknown']}
                          {isOwner && chatter.telegram_id ? ` · TG: ${chatter.telegram_id}` : chatter.telegram_id ? ' · Telegram ✓' : ' · Kein Telegram'}
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: '#4a4a6a' }}>{chatter.last_contacted ? formatTime(chatter.last_contacted) : '—'}</div>
                  </div>
                )
              })}
            </div>
            {showAddChatter
              ? <AddContactForm type="chatter" onSave={addChatter} onCancel={() => setShowAddChatter(false)} isOwner={isOwner} />
              : <button onClick={() => setShowAddChatter(true)} style={{ width: '100%', background: 'transparent', border: '1px dashed #2e2e5a', color: '#4a4a6a', borderRadius: 8, padding: '9px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>+ Chatter hinzufügen</button>
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
                <button onClick={() => setSelectedChatters(new Set())} style={{ alignSelf: 'flex-start', background: 'transparent', border: '1px solid #2e2e5a', color: '#8888aa', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Auswahl aufheben
                </button>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {CHATTER_MSG_TYPES.map(t => (
                  <button key={t.key} onClick={() => setChatterMsgType(t.key)} style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 5, cursor: 'pointer',
                    background: chatterMsgType === t.key ? 'rgba(6,182,212,0.2)' : 'transparent',
                    border: `1px solid ${chatterMsgType === t.key ? '#06b6d4' : '#1e1e3a'}`,
                    color: chatterMsgType === t.key ? '#06b6d4' : '#4a4a6a',
                    fontFamily: 'inherit', fontWeight: 600,
                  }}>{t.label}</button>
                ))}
              </div>
              {/* Zoom date/time picker */}
              {chatterMsgType === 'zoom' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <label style={{ fontSize: 10, color: '#4a4a6a' }}>Datum</label>
                      <input type="date" value={zoomDate} onChange={e => setZoomDate(e.target.value)}
                        style={{ background: '#0b0b1a', border: '1px solid #2e2e5a', color: '#f0f0ff', padding: '6px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'monospace', outline: 'none' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <label style={{ fontSize: 10, color: '#4a4a6a' }}>
                        Uhrzeit
                        <span style={{ color: '#7c3aed', marginLeft: 4 }}>
                          ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                        </span>
                      </label>
                      <input type="time" value={zoomTime} onChange={e => setZoomTime(e.target.value)}
                        style={{ background: '#0b0b1a', border: '1px solid #2e2e5a', color: '#f0f0ff', padding: '6px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'monospace', outline: 'none' }} />
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
                        <span style={{ fontSize: 11, color: '#8888aa' }}>📅 Kalender-Link wird automatisch an die Nachricht angehängt</span>
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
                style={{ width: '100%', background: '#0b0b1a', border: '1px solid #2e2e5a', color: '#f0f0ff', padding: '10px 12px', borderRadius: 8, fontSize: 13, resize: 'vertical', fontFamily: 'inherit', outline: 'none' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 11, color: '#4a4a6a' }}>✈ Jeder bekommt eine separate Nachricht</div>
                <button onClick={sendChatterMessage} disabled={sendingChatter || !chatterMsgText.trim()} style={{
                  background: chatterMsgText.trim() ? 'linear-gradient(135deg, #06b6d4, #0891b2)' : '#1e1e3a',
                  color: chatterMsgText.trim() ? '#fff' : '#4a4a6a',
                  border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}>{sendingChatter ? 'Senden...' : `An ${selectedChatters.size === 0 ? 'alle' : selectedChatters.size} senden`}</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* POSTEINGANG */}
      {activeSection === 'inbox' && (
        <Card title={`Posteingang – Antworten (${inboxMessages.length})`}>
          {unreadCount > 0 && (
            <div style={{ marginBottom: 12 }}>
              <button onClick={markAllRead} style={{ background: 'transparent', border: '1px solid #2e2e5a', color: '#8888aa', borderRadius: 7, padding: '5px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                Alle als gelesen markieren
              </button>
            </div>
          )}
          {inboxMessages.length === 0 ? (
            <div style={{ color: '#4a4a6a', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Noch keine Antworten</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {inboxMessages.map(msg => (
                <div key={msg.id} style={{
                  padding: '12px 14px', borderRadius: 8,
                  background: msg.read ? '#0b0b18' : 'rgba(124,58,237,0.06)',
                  border: `1px solid ${msg.read ? '#1e1e3a' : 'rgba(124,58,237,0.3)'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: msg.contact_type === 'chatter' ? '#06b6d4' : '#a78bfa' }}>{msg.model_name}</span>
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: msg.contact_type === 'chatter' ? 'rgba(6,182,212,0.15)' : 'rgba(124,58,237,0.15)', color: msg.contact_type === 'chatter' ? '#06b6d4' : '#a78bfa', fontWeight: 600 }}>
                        {msg.contact_type === 'chatter' ? 'Chatter' : 'Model'}
                      </span>
                      {!msg.read && <span style={{ fontSize: 9, background: '#7c3aed', color: '#fff', padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>NEU</span>}
                    </div>
                    <span style={{ fontSize: 10, color: '#4a4a6a', fontFamily: 'monospace' }}>{formatTime(msg.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#c0c0e0', lineHeight: 1.5 }}>{msg.text}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* VERLAUF */}
      {activeSection === 'history' && (
        <Card title="Nachrichtenverlauf">
          {messages.length === 0 ? (
            <div style={{ color: '#4a4a6a', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Noch keine Nachrichten</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>{['Zeit', 'Name', 'Typ', 'Richtung', 'Von', 'Nachricht'].map(h => <th key={h} style={thS}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {messages.map(msg => (
                    <tr key={msg.id}>
                      <td style={{ ...tdS, fontFamily: 'monospace', color: '#4a4a6a', whiteSpace: 'nowrap' }}>{formatTime(msg.created_at)}</td>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
