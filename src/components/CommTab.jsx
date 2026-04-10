import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { sendTelegramMessage, notifyOwner, getUpdates } from '../telegram'
import Card from './Card'

const MSG_TYPES = [
  { key: 'content_request', label: 'Content anfragen' },
  { key: 'availability', label: 'Verfügbarkeit prüfen' },
  { key: 'free', label: 'Freie Nachricht' },
]

const TEMPLATES = {
  content_request: 'Hey {name}, kannst du bitte neuen Content hochladen? Danke! – Thirteen 87',
  availability: 'Hey {name}, bist du diese Woche verfügbar? – Thirteen 87',
  free: '',
}

const AVAILABILITY_COLORS = {
  available: '#10b981',
  unavailable: '#ef4444',
  unknown: '#f59e0b',
}
const AVAILABILITY_LABELS = {
  available: 'Verfügbar',
  unavailable: 'Nicht verfügbar',
  unknown: 'Unbekannt',
}

const OWNER_EMAIL = 'dillemc@hotmail.com'

export default function CommTab({ session }) {
  const isOwner = session?.user?.email === OWNER_EMAIL
  const [models, setModels] = useState([])
  const [messages, setMessages] = useState([])
  const [selectedModel, setSelectedModel] = useState(null)
  const [msgType, setMsgType] = useState('content_request')
  const [msgText, setMsgText] = useState('')
  const [sending, setSending] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [activeSection, setActiveSection] = useState('models') // 'models' | 'inbox'
  const [newModelName, setNewModelName] = useState('')
  const [newModelTgId, setNewModelTgId] = useState('')
  const [showAddModel, setShowAddModel] = useState(false)

  const lastUpdateIdRef = React.useRef(0)

  useEffect(() => {
    loadModels()
    loadMessages()
    const interval = setInterval(pollTelegram, 10000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (selectedModel) {
      setMsgText(TEMPLATES[msgType]?.replace('{name}', selectedModel.name) || '')
    }
  }, [msgType, selectedModel])

  const loadModels = async () => {
    const { data } = await supabase.from('models_contact').select('*').order('name')
    setModels(data || [])
  }

  const loadMessages = async () => {
    const { data } = await supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(100)
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

        // Ignore /start and empty messages
        if (!text || text === '/start') continue
        // Ignore own messages
        if (fromId === '1538601588') continue

        const { data: modelData } = await supabase
          .from('models_contact').select('*').eq('telegram_id', fromId).single()

        if (modelData) {
          let availability = modelData.availability
          const lower = text.toLowerCase()
          if (lower.includes('nicht verfügbar') || lower.includes('not available') || lower.includes('busy') || lower.includes('nicht da')) {
            availability = 'unavailable'
          } else if (lower.includes('verfügbar') || lower.includes('available') || lower.includes('ok')) {
            availability = 'available'
          }
          await supabase.from('models_contact').update({ availability, availability_note: text }).eq('id', modelData.id)
          await supabase.from('messages').insert({
            model_name: modelData.name,
            model_telegram_id: fromId,
            direction: 'in',
            text,
            status: 'received',
            read: false,
          })
          await notifyOwner(`📨 Antwort von <b>${modelData.name}</b>:\n${text}`)
        } else {
          await notifyOwner(`❓ Unbekannte Nachricht von ID ${fromId} (@${msg.from.username || '?'}):\n${text}`)
        }
      }
      loadMessages()
      loadModels()
    } catch (e) {
      console.error('Telegram poll error:', e)
    }
  }

  const sendMessage = async () => {
    if (!selectedModel || !msgText.trim()) return
    if (!selectedModel.telegram_id) {
      alert(`Kein Telegram-Account für ${selectedModel.name} hinterlegt.`)
      return
    }
    setSending(true)
    const senderName = session?.user?.email?.split('@')[0] || 'Unbekannt'
    try {
      await sendTelegramMessage(selectedModel.telegram_id, msgText)
      await supabase.from('messages').insert({
        model_name: selectedModel.name,
        model_telegram_id: selectedModel.telegram_id,
        direction: 'out',
        message_type: msgType,
        text: msgText,
        status: 'sent',
        sent_by: senderName,
      })
      await supabase.from('models_contact').update({ last_contacted: new Date().toISOString() }).eq('id', selectedModel.id)
      setMsgText('')
      setSelectedModel(null)
      loadMessages()
      loadModels()
    } catch (e) {
      alert('Fehler beim Senden: ' + e.message)
    }
    setSending(false)
  }

  const markAllRead = async () => {
    await supabase.from('messages').update({ read: true }).eq('direction', 'in').eq('read', false)
    loadMessages()
  }

  const addModel = async () => {
    if (!newModelName.trim()) return
    await supabase.from('models_contact').insert({
      name: newModelName.trim(),
      telegram_id: newModelTgId.trim() || null,
    })
    setNewModelName('')
    setNewModelTgId('')
    setShowAddModel(false)
    loadModels()
  }

  const formatTime = (ts) => {
    const d = new Date(ts)
    const now = new Date()
    const diffH = (now - d) / 3600000
    if (diffH < 24) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  }

  const inboxMessages = messages.filter(m => m.direction === 'in')
  const outboxMessages = messages.filter(m => m.direction === 'out')

  const tdS = { padding: '10px 10px', borderBottom: '1px solid #1e1e3a', color: '#c0c0e0', fontSize: 12 }
  const thS = { padding: '8px 10px', color: '#4a4a6a', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #2e2e5a', whiteSpace: 'nowrap' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Section Tabs */}
      <div style={{ display: 'flex', gap: 8 }}>
        {[
          { key: 'models', label: 'Models & Anfragen' },
          { key: 'inbox', label: `Posteingang ${unreadCount > 0 ? `(${unreadCount})` : ''}` },
          { key: 'history', label: 'Verlauf' },
        ].map(s => (
          <button key={s.key} onClick={() => setActiveSection(s.key)} style={{
            padding: '7px 16px', borderRadius: 8, cursor: 'pointer',
            background: activeSection === s.key ? '#7c3aed' : 'transparent',
            color: activeSection === s.key ? '#fff' : '#8888aa',
            border: `1px solid ${activeSection === s.key ? '#7c3aed' : '#1e1e3a'}`,
            fontWeight: 600, fontSize: 13, fontFamily: 'inherit',
            ...(s.key === 'inbox' && unreadCount > 0 ? { color: activeSection === s.key ? '#fff' : '#f59e0b', borderColor: activeSection === s.key ? '#7c3aed' : 'rgba(245,158,11,0.4)' } : {}),
          }}>{s.label}</button>
        ))}
      </div>

      {/* MODELS & ANFRAGEN */}
      {activeSection === 'models' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>
          <Card title="Models">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {models.length === 0 && (
                <div style={{ color: '#4a4a6a', fontSize: 13, padding: '12px 0' }}>Noch keine Models angelegt</div>
              )}
              {models.map(model => (
                <div key={model.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 12px', background: '#13132a', borderRadius: 8,
                  border: `1px solid ${selectedModel?.id === model.id ? '#7c3aed' : '#1e1e3a'}`,
                  cursor: 'pointer', transition: 'border-color 0.15s',
                }} onClick={() => setSelectedModel(model)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%',
                      background: 'linear-gradient(135deg, #7c3aed33, #06b6d433)',
                      border: '1px solid #2e2e5a', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#a78bfa', flexShrink: 0,
                    }}>{model.name[0]}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#f0f0ff' }}>{model.name}</div>
                      <div style={{ fontSize: 10, color: '#4a4a6a', marginTop: 1 }}>
                        <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: AVAILABILITY_COLORS[model.availability || 'unknown'], marginRight: 4, verticalAlign: 'middle' }} />
                        {AVAILABILITY_LABELS[model.availability || 'unknown']}
                        {isOwner
                          ? (model.telegram_id ? ` · TG: ${model.telegram_id}` : ' · Kein Telegram')
                          : (model.telegram_id ? ' · Telegram ✓' : ' · Kein Telegram')
                        }
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: '#4a4a6a' }}>
                    {model.last_contacted ? formatTime(model.last_contacted) : '—'}
                  </div>
                </div>
              ))}
            </div>

            {showAddModel ? (
              <div style={{ padding: '12px', background: '#13132a', borderRadius: 8, border: '1px solid #2e2e5a' }}>
                <div style={{ fontSize: 11, color: '#4a4a6a', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Model hinzufügen</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input value={newModelName} onChange={e => setNewModelName(e.target.value)}
                    placeholder="Model-Name" style={{ background: '#0b0b1a', border: '1px solid #2e2e5a', color: '#f0f0ff', padding: '8px 10px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }} />
                  {isOwner && (
                    <input value={newModelTgId} onChange={e => setNewModelTgId(e.target.value)}
                      placeholder="Telegram ID" style={{ background: '#0b0b1a', border: '1px solid #2e2e5a', color: '#f0f0ff', padding: '8px 10px', borderRadius: 7, fontSize: 12, fontFamily: 'monospace', outline: 'none' }} />
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={addModel} style={{ flex: 1, background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 7, padding: '8px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Speichern</button>
                    <button onClick={() => setShowAddModel(false)} style={{ background: 'transparent', border: '1px solid #2e2e5a', color: '#8888aa', borderRadius: 7, padding: '8px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Abbrechen</button>
                  </div>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowAddModel(true)} style={{
                width: '100%', background: 'transparent', border: '1px dashed #2e2e5a',
                color: '#4a4a6a', borderRadius: 8, padding: '9px', fontSize: 12,
                cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
              }}
                onMouseEnter={e => { e.target.style.borderColor = '#7c3aed'; e.target.style.color = '#a78bfa' }}
                onMouseLeave={e => { e.target.style.borderColor = '#2e2e5a'; e.target.style.color = '#4a4a6a' }}
              >+ Model hinzufügen</button>
            )}
          </Card>

          <Card title="Nachricht senden">
            {!selectedModel ? (
              <div style={{ color: '#4a4a6a', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
                ← Model auswählen
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#f0f0ff' }}>An: {selectedModel.name}</div>
                  <button onClick={() => setSelectedModel(null)} style={{ background: 'transparent', border: 'none', color: '#4a4a6a', cursor: 'pointer', fontSize: 12 }}>✕</button>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {MSG_TYPES.map(t => (
                    <button key={t.key} onClick={() => setMsgType(t.key)} style={{
                      fontSize: 11, padding: '4px 10px', borderRadius: 5, cursor: 'pointer',
                      background: msgType === t.key ? 'rgba(124,58,237,0.2)' : 'transparent',
                      border: `1px solid ${msgType === t.key ? '#7c3aed' : '#1e1e3a'}`,
                      color: msgType === t.key ? '#a78bfa' : '#4a4a6a',
                      fontFamily: 'inherit', fontWeight: 600, transition: 'all 0.15s',
                    }}>{t.label}</button>
                  ))}
                </div>
                <textarea
                  value={msgText}
                  onChange={e => setMsgText(e.target.value)}
                  rows={4}
                  style={{
                    width: '100%', background: '#0b0b1a', border: '1px solid #2e2e5a',
                    color: '#f0f0ff', padding: '10px 12px', borderRadius: 8,
                    fontSize: 13, resize: 'vertical', fontFamily: 'inherit', outline: 'none',
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 11, color: '#4a4a6a', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 14 }}>✈</span>
                    {selectedModel.telegram_id ? `Sendet via Telegram` : <span style={{ color: '#ef4444' }}>Kein Telegram hinterlegt</span>}
                  </div>
                  <button onClick={sendMessage} disabled={sending || !msgText.trim() || !selectedModel.telegram_id} style={{
                    background: msgText.trim() && selectedModel.telegram_id ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : '#1e1e3a',
                    color: msgText.trim() && selectedModel.telegram_id ? '#fff' : '#4a4a6a',
                    border: 'none', borderRadius: 8, padding: '9px 20px',
                    fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    {sending ? 'Senden...' : 'Jetzt senden'}
                  </button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* POSTEINGANG */}
      {activeSection === 'inbox' && (
        <Card title={`Posteingang – Antworten (${inboxMessages.length})`}>
          {inboxMessages.length > 0 && unreadCount > 0 && (
            <div style={{ marginBottom: 12 }}>
              <button onClick={markAllRead} style={{
                background: 'transparent', border: '1px solid #2e2e5a', color: '#8888aa',
                borderRadius: 7, padding: '5px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
              }}>Alle als gelesen markieren</button>
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa' }}>{msg.model_name}</span>
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
                  <tr>
                    {['Zeit', 'Model', 'Richtung', 'Von', 'Typ', 'Nachricht'].map(h => <th key={h} style={thS}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {messages.map(msg => (
                    <tr key={msg.id}>
                      <td style={{ ...tdS, fontFamily: 'monospace', whiteSpace: 'nowrap', color: '#4a4a6a' }}>{formatTime(msg.created_at)}</td>
                      <td style={{ ...tdS, fontWeight: 600 }}>{msg.model_name}</td>
                      <td style={tdS}>
                        <span style={{
                          fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                          background: msg.direction === 'out' ? 'rgba(124,58,237,0.15)' : 'rgba(16,185,129,0.15)',
                          color: msg.direction === 'out' ? '#a78bfa' : '#10b981',
                        }}>
                          {msg.direction === 'out' ? '→ Gesendet' : '← Empfangen'}
                        </span>
                      </td>
                      <td style={{ ...tdS, color: '#8888aa', fontWeight: 600 }}>
                        {msg.direction === 'out'
                          ? <span style={{ color: msg.sent_by === 'dillemc' ? '#a78bfa' : '#06b6d4' }}>{msg.sent_by || '—'}</span>
                          : <span style={{ color: '#10b981' }}>{msg.model_name}</span>
                        }
                      </td>
                      <td style={{ ...tdS, color: '#8888aa' }}>{msg.message_type || '—'}</td>
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
