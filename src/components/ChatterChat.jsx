import React, { useState, useEffect, useRef, useCallback } from 'react'
import { MessageCircle, ChevronDown, Send } from 'lucide-react'
import { supabase } from '../supabase'
import { notifyAdmins } from '../telegram'

/**
 * ChatterChat v3.96.0 — schwebender Chat für das Chatter-Portal.
 *
 * Bewusst NICHT die Admin-Variante (<CommTab section="chat">): die zeigt ALLE Threads.
 * Ein Chatter hat genau einen Gesprächspartner — das Team. Also ein Thread, keine Liste.
 *
 * Wichtig: schreibt in dieselbe `messages`-Tabelle wie der Telegram-Bot, mit exakt
 * denselben Feldern (direction='in', contact_type='chatter', model_name=Anzeigename).
 * Dadurch sehen Admins im Chat-Tab EINEN durchgehenden Verlauf, egal ob der Chatter
 * über Telegram oder übers Dashboard geschrieben hat. Und der Weg funktioniert auch
 * dann, wenn der Telegram-Webhook mal ausfällt.
 */

const fmtTime = (iso) => {
  const d = new Date(iso), now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const yest = new Date(now); yest.setDate(yest.getDate() - 1)
  if (sameDay) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === yest.toDateString()) return `gestern ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function ChatterChat({ displayName, onUnreadChange }) {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [myTelegramId, setMyTelegramId] = useState(null)
  const bodyRef = useRef(null)

  // Eigene Telegram-ID mitschreiben — dasselbe Feld, das der Bot setzt. So bleibt
  // der Thread auf Admin-Seite eindeutig einem Telegram-Kontakt zugeordnet.
  useEffect(() => {
    if (!displayName) return
    supabase.from('chatters_contact').select('telegram_id').eq('name', displayName).maybeSingle()
      .then(({ data }) => setMyTelegramId(data?.telegram_id || null))
  }, [displayName])

  const load = useCallback(async () => {
    if (!displayName) return
    const { data } = await supabase
      .from('messages').select('*')
      .eq('contact_type', 'chatter').eq('model_name', displayName)
      .order('created_at', { ascending: false })
      .limit(80)
    setMsgs((data || []).slice().reverse())
  }, [displayName])

  useEffect(() => {
    if (!displayName) return
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [displayName, load])

  const unread = msgs.filter(m => m.direction === 'out' && !m.read_at).length
  useEffect(() => { onUnreadChange?.(unread) }, [unread, onUnreadChange])

  // Beim Öffnen ans Ende springen und eingehende Team-Nachrichten als gelesen markieren
  useEffect(() => {
    if (!open) return
    setTimeout(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight }, 60)
    const unreadIds = msgs.filter(m => m.direction === 'out' && !m.read_at).map(m => m.id)
    if (unreadIds.length === 0) return
    supabase.from('messages')
      .update({ read_at: new Date().toISOString(), read_by: displayName })
      .in('id', unreadIds).is('read_at', null)
      .then(() => setMsgs(prev => prev.map(m =>
        unreadIds.includes(m.id) ? { ...m, read_at: new Date().toISOString() } : m
      )))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const send = async () => {
    const t = text.trim()
    if (!t || sending || !displayName) return
    setSending(true)
    // Identisch zum Telegram-Bot, damit beide Wege im selben Thread landen
    const { data, error } = await supabase.from('messages').insert({
      model_name: displayName,
      model_telegram_id: myTelegramId,
      direction: 'in',
      contact_type: 'chatter',
      text: t,
      status: 'received',
      read: false,
    }).select().single()

    if (error) {
      alert('Nachricht konnte nicht gesendet werden: ' + error.message)
      setSending(false)
      return
    }
    setMsgs(prev => [...prev, data])
    setText('')
    setSending(false)
    setTimeout(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight }, 40)

    // Admins anpingen — wie der Bot es bei Telegram-Nachrichten tut.
    // Schlägt das fehl, ist die Nachricht trotzdem gespeichert.
    try {
      await notifyAdmins(`💬 <b>${displayName}</b> (Dashboard)\n\n<i>${t}</i>`)
    } catch (e) {
      console.error('notifyAdmins fehlgeschlagen (Nachricht ist gespeichert):', e)
    }
  }

  return (
    <>
      {open && (
        <div style={{
          // bottom 150 = oberhalb BEIDER Bubbles (Chat 20, Glocke 86), sonst
          // liegen die Buttons (z-index 99999) über dem Fenster.
          position: 'fixed', right: 20, bottom: 150, zIndex: 99998,
          width: 'min(420px, calc(100vw - 40px))',
          height: 'min(580px, calc(100vh - 190px))',
          background: 'var(--bg-base)', border: '1px solid var(--border-bright)',
          borderRadius: 16, boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
              <MessageCircle size={16} /> Chat mit dem Team
            </div>
            <button onClick={() => setOpen(false)} title="Minimieren" style={{
              background: 'transparent', border: 'none', color: 'var(--text-muted)',
              cursor: 'pointer', padding: 4, display: 'flex',
            }}><ChevronDown size={20} /></button>
          </div>

          <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textAlign: 'center', margin: '2px 0 12px' }}>
              Telegram und Dashboard laufen im selben Verlauf
            </div>
            {msgs.length === 0 && (
              <div style={{ padding: '28px 10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                Noch keine Nachrichten. Schreib dem Team einfach.
              </div>
            )}
            {msgs.map(m => {
              const mine = m.direction === 'in'
              return (
                <div key={m.id} style={{
                  maxWidth: '82%', marginLeft: mine ? 'auto' : 0, marginBottom: 9,
                  padding: '9px 13px', fontSize: 13, lineHeight: 1.5,
                  borderRadius: 14,
                  borderBottomRightRadius: mine ? 5 : 14,
                  borderBottomLeftRadius: mine ? 14 : 5,
                  background: mine ? 'rgba(124,58,237,0.22)' : 'var(--bg-card2)',
                  border: `1px solid ${mine ? 'rgba(124,58,237,0.4)' : 'var(--border)'}`,
                  color: 'var(--text-primary)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {Array.isArray(m.image_urls) && m.image_urls.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: m.text ? 7 : 0 }}>
                      {m.image_urls.map((u, i) => (
                        <a key={i} href={u} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
                          <img src={u} alt="" style={{ width: '100%', borderRadius: 8, display: 'block', border: '1px solid var(--border)' }} />
                        </a>
                      ))}
                    </div>
                  )}
                  {m.text}
                  <div style={{ fontSize: 9.5, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 5 }}>
                    {!mine && m.sent_by ? `${m.sent_by} · ` : ''}{fmtTime(m.created_at)}
                  </div>
                </div>
              )
            })}
          </div>

          <div style={{ display: 'flex', gap: 8, padding: '11px 13px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            <input
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Nachricht an das Team…"
              style={{
                flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)',
                color: 'var(--text-primary)', padding: '10px 13px', borderRadius: 9,
                fontSize: 13, fontFamily: 'inherit', outline: 'none',
              }}
            />
            <button onClick={send} disabled={sending || !text.trim()} style={{
              background: sending || !text.trim() ? 'var(--border)' : '#7c3aed',
              color: sending || !text.trim() ? 'var(--text-muted)' : '#fff',
              borderRadius: 9, padding: '0 15px', fontWeight: 700, fontSize: 13,
              border: 'none', cursor: sending || !text.trim() ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
            }}><Send size={15} /></button>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(o => !o)}
        title="Chat mit dem Team"
        className="fab-btn"
        style={{
          position: 'fixed', right: 20, bottom: 20, zIndex: 99999,
          width: 54, height: 54, borderRadius: '50%',
          background: open ? 'rgba(124,58,237,0.18)' : 'rgba(255,255,255,0.06)',
          color: '#a78bfa',
          border: `1px solid ${open ? 'rgba(124,58,237,0.5)' : 'rgba(255,255,255,0.12)'}`,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.16s ease, border-color 0.16s ease',
        }}
      >
        {open ? <ChevronDown size={23} strokeWidth={2.6} /> : <MessageCircle size={22} fill="currentColor" strokeWidth={0} />}
        {!open && unread > 0 && (
          <span style={{
            position: 'absolute', top: -3, right: -3,
            minWidth: 20, height: 20, padding: '0 5px', borderRadius: 999,
            background: '#ef4444', color: '#fff', fontSize: 11, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid var(--bg-base)', lineHeight: 1,
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>
    </>
  )
}
