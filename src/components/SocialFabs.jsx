import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageCircle, ChevronDown, Send, Bell } from 'lucide-react'
import { supabase } from '../supabase'
import { notifyAdmins } from '../telegram'
import { useFabPanels, useFabOpen } from '../fabPanel'
import { useGelesen } from '../gelesen'
import { useSprache } from '../i18n/sprache'
import { statusVon } from '../reelSkripte'
import { useVorschau, vorschauSperre } from '../vorschau' // v5.2.0

// ── Chat · Glocke · Hilfe für Social-Rollen (v5.0.0) ───────────────────────
// Poster, Cutter und Freigeber haben nur den Social Media Manager. Unten rechts
// bekommen sie dieselben drei runden Knöpfe wie die Chatter:
//   20 px  Chat · 86 px  Glocke · 152 px  Hilfe   (immer nur ein Fenster offen,
//   Fenster öffnen oberhalb aller drei Knöpfe, sonst liegt „?“ über dem Eingabefeld)
//
// Chat: Tabelle messages, contact_type 'social', model_name = eigener Name.
//   Gleiche Regeln wie beim Chatter-Chat (RLS: nur der eigene Verlauf). Beim
//   Team landet es im normalen Chat unter „Social“. Telegram braucht es nicht.
// Glocke: aus vorhandenen Daten abgeleitet, keine eigene Tabelle:
//   Reel bereit zum Posten / Video zum Schneiden / wartet auf Freigabe,
//   neu zugeteilter Account, Antwort im Chat. Gelesen-Stand pro Login (gelesen.js).
// Hilfe: kurze FAQ für Social-Rollen.
// Alles zweisprachig, folgt der Sprache der Person (i18n/sprache.js).

const TXT = {
  de: {
    chat: 'Chat mit dem Team', chat_leer: 'Noch keine Nachrichten. Schreib dem Team einfach.', chat_ph: 'Nachricht an das Team…',
    chat_hinweis: 'Deine Nachricht geht direkt an das Team im Dashboard.', chat_fehler: 'Nachricht konnte nicht gesendet werden: ',
    glocke: 'Neuigkeiten', alles_gelesen: 'Alles gelesen', nichts: 'Nichts Neues.',
    e_bereit: (s) => `${s.nr} „${s.titel}“ ist freigegeben, bitte posten`,
    e_schnitt: (s) => `${s.nr} „${s.titel}“: neues Video zum Schneiden`,
    e_pruefung: (s) => `${s.nr} „${s.titel}“ wartet auf Freigabe`,
    e_account: (z) => `Dir wurde ${z.account} (${z.model_name}) zugeteilt`,
    e_nachricht: (m) => `Neue Nachricht${m.sent_by ? ` von ${m.sent_by}` : ''}: ${String(m.text || '').slice(0, 80)}`,
    hilfe: 'Hilfe', schliessen: 'Schließen',
    faq: [
      ['🎬 Wie poste ich ein Reel?', 'Unter „Zu posten“ steht jedes freigegebene Reel. 1) Drehzettel ansehen und Video herunterladen. 2) Auf „Worauf achten“ schauen (No Gos, Stil). 3) Auf genau dem angezeigten Account posten. 4) In Instagram beim Reel „⋯ → Link kopieren“, Link einfügen, Datum prüfen, „Gepostet ✓“.'],
      ['📌 Auf welchen Account?', 'Der rosa Kasten „Posten auf“ zeigt den festen Account. Hast du doch woanders gepostet, tippe auf „Account ändern“ und wähle den richtigen, damit die Zahlen stimmen.'],
      ['⬇ Das Video lädt nicht', 'Der Link führt meist zu Dropbox oder Google Drive. Im Browser öffnen und dort herunterladen. Klappt es nicht, schreib uns im Chat mit der Nummer (S-…).'],
      ['📎 Reels ohne Skript', 'Postest du für uns etwas ohne Drehzettel (z. B. älteren Content), trag den Link unten in „Reels ohne Skript“ ein. Dann wird es nachts mitgemessen und zählt als unser Reel.'],
      ['📋 Überblick und 👤 Models', '„Überblick“ zeigt alle Reels deiner Accounts und wo sie stehen. „Models“ zeigt, was du zum Posten brauchst: Accounts, No Gos, Stil, Englisch-Level.'],
      ['🌐 Sprache', 'Oben rechts auf DE oder EN tippen. Deine feste Sprache stellt das Team in deinem Profil ein.'],
      ['💬 Fragen?', 'Unten rechts auf den Chat tippen. Die Nachricht geht direkt an das Team.'],
    ],
  },
  en: {
    chat: 'Chat with the team', chat_leer: 'No messages yet. Just write to the team.', chat_ph: 'Message to the team…',
    chat_hinweis: 'Your message goes straight to the team in the dashboard.', chat_fehler: 'The message could not be sent: ',
    glocke: 'Updates', alles_gelesen: 'Mark all read', nichts: 'Nothing new.',
    e_bereit: (s) => `${s.nr} "${s.titel}" is approved, please post it`,
    e_schnitt: (s) => `${s.nr} "${s.titel}": new video to edit`,
    e_pruefung: (s) => `${s.nr} "${s.titel}" is waiting for approval`,
    e_account: (z) => `You were assigned ${z.account} (${z.model_name})`,
    e_nachricht: (m) => `New message${m.sent_by ? ` from ${m.sent_by}` : ''}: ${String(m.text || '').slice(0, 80)}`,
    hilfe: 'Help', schliessen: 'Close',
    faq: [
      ['🎬 How do I post a reel?', 'Every approved reel is listed under "To post". 1) Open the script and download the video. 2) Check "Keep in mind" (no-gos, style). 3) Post on exactly the account shown. 4) In Instagram tap "⋯ → Copy link" on the reel, paste the link, check the date, tap "Posted ✓".'],
      ['📌 Which account?', 'The pink "Post to" box shows the fixed account. If you posted somewhere else after all, tap "Change account" and pick the right one so the numbers are correct.'],
      ['⬇ The video won\'t download', 'The link usually goes to Dropbox or Google Drive. Open it in the browser and download it there. If that doesn\'t work, message us in the chat with the number (S-…).'],
      ['📎 Reels without a script', 'If you post something for us without a shooting script (e.g. older content), add the link under "Reels without a script" at the bottom. It then gets measured overnight and counts as ours.'],
      ['📋 Overview and 👤 Creators', '"Overview" shows all reels of your accounts and their status. "Creators" shows what you need for posting: accounts, no-gos, style, English level.'],
      ['🌐 Language', 'Tap DE or EN at the top right. Your default language is set by the team in your profile.'],
      ['💬 Questions?', 'Tap the chat at the bottom right. Your message goes straight to the team.'],
    ],
  },
}

const fab = (bottom, aktiv, farbe) => ({
  position: 'fixed', right: 20, bottom: `calc(${bottom}px + var(--fab-lift, 0px))`, zIndex: 99999,
  width: 54, height: 54, borderRadius: '50%',
  background: aktiv ? farbe + '2e' : 'rgba(255,255,255,0.06)', color: farbe,
  border: `1px solid ${aktiv ? farbe + '80' : 'rgba(255,255,255,0.12)'}`,
  boxShadow: '0 8px 24px rgba(0,0,0,0.35)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit',
})
const fenster = (bottom) => ({
  position: 'fixed', right: 20, bottom: `calc(${bottom}px + var(--fab-lift, 0px))`, zIndex: 99998,
  width: 'min(420px, calc(100vw - 40px))', maxHeight: `min(580px, calc(100vh - ${bottom + 40}px))`,
  background: 'var(--bg-base)', border: '1px solid var(--border-bright)', borderRadius: 16,
  boxShadow: '0 24px 70px rgba(0,0,0,0.6)', overflow: 'hidden', display: 'flex', flexDirection: 'column',
})
const kopf = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }
const zu = { background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex' }
const zahlPunkt = (n) => n > 0 && (
  <span style={{ position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, padding: '0 5px', borderRadius: 999, background: '#ef4444', color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--bg-base)', lineHeight: 1 }}>{n > 99 ? '99+' : n}</span>
)
const zeit = (iso, loc) => { try { return new Date(iso).toLocaleString(loc, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

export default function SocialFabs({ displayName, rollen = [], spracheFest = null }) {
  const spracheGlobal = useSprache()
  const sprache = spracheFest || spracheGlobal // v5.2.0: in der Vorschau die Sprache der Person
  const T = TXT[sprache] || TXT.de
  const loc = sprache === 'en' ? 'en-US' : 'de-DE'
  const panels = useFabPanels()
  const [msgs, setMsgs] = useState([])

  // Chat-Verlauf (auch für die Glocke: Antworten des Teams)
  const ladenChat = useCallback(async () => {
    if (!displayName) return
    const { data } = await supabase.from('messages').select('*')
      .eq('contact_type', 'social').eq('model_name', displayName)
      .order('created_at', { ascending: false }).limit(80)
    setMsgs((data || []).slice().reverse())
  }, [displayName])
  useEffect(() => {
    ladenChat()
    const iv = setInterval(ladenChat, 30000)
    return () => clearInterval(iv)
  }, [ladenChat])

  if (!displayName) return null
  return (
    <>
      <SocialChat T={T} loc={loc} displayName={displayName} msgs={msgs} setMsgs={setMsgs} neu={ladenChat}
        isOpen={panels.active === 'chat'} onToggle={(v) => panels.set('chat', v)} />
      <SocialGlocke T={T} loc={loc} displayName={displayName} rollen={rollen} msgs={msgs}
        oeffneChat={() => panels.set('chat', true)}
        isOpen={panels.active === 'glocke'} onToggle={(v) => panels.set('glocke', v)} />
      <SocialHilfe T={T} isOpen={panels.active === 'hilfe'} onToggle={(v) => panels.set('hilfe', v)} />
    </>
  )
}

function SocialChat({ T, loc, displayName, msgs, setMsgs, neu, isOpen, onToggle }) {
  const vorschau = useVorschau()
  const [open, setOpen] = useFabOpen(isOpen, onToggle)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bodyRef = useRef(null)
  const unread = msgs.filter(m => m.direction === 'out' && !m.read_at).length

  useEffect(() => {
    if (!open || vorschau) return // v5.2.0: in der Vorschau nichts als gelesen markieren
    setTimeout(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight }, 60)
    const ids = msgs.filter(m => m.direction === 'out' && !m.read_at).map(m => m.id)
    if (!ids.length) return
    const jetzt = new Date().toISOString()
    supabase.from('messages').update({ read_at: jetzt, read_by: displayName }).in('id', ids).is('read_at', null)
      .then(() => setMsgs(prev => prev.map(m => ids.includes(m.id) ? { ...m, read_at: jetzt } : m)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, msgs.length])

  const senden = async () => {
    if (vorschau) return vorschauSperre()
    const t = text.trim()
    if (!t || sending) return
    setSending(true)
    const { data, error } = await supabase.from('messages').insert({
      model_name: displayName, model_telegram_id: null, direction: 'in', contact_type: 'social',
      text: t, status: 'received', read: false,
    }).select().single()
    setSending(false)
    if (error) { alert(T.chat_fehler + error.message); return }
    setMsgs(prev => [...prev, data]); setText('')
    setTimeout(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight }, 40)
    try { await notifyAdmins(`💬 <b>${displayName}</b> (Social, Dashboard)\n\n<i>${t}</i>`) } catch { /* gespeichert ist sie trotzdem */ }
    neu()
  }

  return (
    <>
      {open && (
        <div style={{ ...fenster(216), height: 'min(560px, calc(100vh - 256px))' }}>
          <div style={kopf}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}><MessageCircle size={16} /> {T.chat}</div>
            <button onClick={() => setOpen(false)} aria-label={T.schliessen} style={zu}><ChevronDown size={20} /></button>
          </div>
          <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textAlign: 'center', margin: '2px 0 12px' }}>{T.chat_hinweis}</div>
            {!msgs.length && <div style={{ padding: '28px 10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>{T.chat_leer}</div>}
            {msgs.map(m => {
              const mine = m.direction === 'in'
              return (
                <div key={m.id} style={{
                  maxWidth: '82%', marginLeft: mine ? 'auto' : 0, marginBottom: 9, padding: '9px 13px', fontSize: 13, lineHeight: 1.5,
                  borderRadius: 14, borderBottomRightRadius: mine ? 5 : 14, borderBottomLeftRadius: mine ? 14 : 5,
                  background: mine ? 'rgba(236,72,153,0.18)' : 'var(--bg-card2)', border: `1px solid ${mine ? 'rgba(236,72,153,0.4)' : 'var(--border)'}`,
                  color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {m.text}
                  <div style={{ fontSize: 9.5, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 5 }}>{!mine && m.sent_by ? `${m.sent_by} · ` : ''}{zeit(m.created_at, loc)}</div>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, padding: '11px 13px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            <input value={text} onChange={e => setText(e.target.value.slice(0, 2000))} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); senden() } }}
              placeholder={T.chat_ph} style={{ flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '10px 13px', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
            <button onClick={senden} disabled={sending || !text.trim()} aria-label="Send" style={{
              background: sending || !text.trim() ? 'var(--border)' : '#ec4899', color: sending || !text.trim() ? 'var(--text-muted)' : '#fff',
              borderRadius: 9, padding: '0 15px', border: 'none', cursor: sending || !text.trim() ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center',
            }}><Send size={15} /></button>
          </div>
        </div>
      )}
      <button onClick={() => setOpen(o => !o)} title={T.chat} aria-label={T.chat} style={fab(20, open, '#ec4899')}>
        {open ? <ChevronDown size={23} strokeWidth={2.6} /> : <MessageCircle size={22} fill="currentColor" strokeWidth={0} />}
        {!open && zahlPunkt(unread)}
      </button>
    </>
  )
}

function SocialGlocke({ T, loc, displayName, rollen, msgs, oeffneChat, isOpen, onToggle }) {
  const vorschau = useVorschau()
  const [open, setOpen] = useFabOpen(isOpen, onToggle)
  const [lastSeenEcht, markierenEcht] = useGelesen('socialbell', { lokalKey: 'socialbell_' + displayName, startJetzt: true })
  // v5.2.0: in der Vorschau nicht den Gelesen-Stand des Admins benutzen oder ändern
  const lastSeen = vorschau ? '' : lastSeenEcht
  const markieren = vorschau ? vorschauSperre : markierenEcht
  const [daten, setDaten] = useState({ skripte: [], poster: [], cutter: [] })
  const istPoster = rollen.includes('social_media'), istCutter = rollen.includes('cutter'), istFreigeber = rollen.includes('social_freigabe') || rollen.includes('social_leitung')

  const laden = useCallback(async () => {
    const [sk, p, c] = await Promise.all([
      supabase.from('reel_skripte').select('id, nr, titel, model_name, ziel_account, verworfen, reel_url, video_link, video_am, schnitt_link, schnitt_am, freigabe_am, zurueck_an, zurueck_am, erstellt_am').eq('verworfen', false).order('erstellt_am', { ascending: false }).limit(300),
      istPoster ? supabase.from('social_account_poster').select('*').eq('poster_name', displayName) : Promise.resolve({ data: [] }),
      istCutter ? supabase.from('social_account_cutter').select('*').eq('cutter_name', displayName) : Promise.resolve({ data: [] }),
    ])
    let skripte = sk.data || []
    if (vorschau) {
      // v5.2.0: Admin sieht alles — für die Vorschau auf die Accounts der Person filtern
      const z = [...(p.data || []), ...(c.data || [])]
      skripte = skripte.filter(s => z.some(x => x.model_name === s.model_name && x.account === s.ziel_account))
    }
    setDaten({ skripte, poster: p.data || [], cutter: c.data || [] })
  }, [displayName, istPoster, istCutter, vorschau])
  useEffect(() => {
    laden()
    const iv = setInterval(laden, 120000)
    const sicht = () => { if (document.visibilityState === 'visible') laden() }
    document.addEventListener('visibilitychange', sicht)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', sicht) }
  }, [laden])

  // Hinweis: statusVon kennt „Model postet selbst“/Cutter nur, wenn der Social
  // Media Manager die Register schon gefüllt hat — der ist bei diesen Rollen
  // immer offen. Sicherheitsnetz: nur Einträge mit passendem Zeitstempel.
  const ereignisse = useMemo(() => {
    const e = []
    for (const s of daten.skripte) {
      let st = 'freigegeben'
      try { st = statusVon(s) } catch { /* egal */ }
      if (istPoster && st === 'bereit' && s.freigabe_am) e.push({ id: 'b' + s.id, zeit: s.freigabe_am, text: T.e_bereit(s) })
      if (istCutter && st === 'schnitt' && s.video_am) e.push({ id: 's' + s.id, zeit: s.video_am, text: T.e_schnitt(s) })
      if (istFreigeber && st === 'pruefung') e.push({ id: 'p' + s.id, zeit: s.schnitt_am || s.video_am, text: T.e_pruefung(s) })
    }
    for (const z of [...daten.poster, ...daten.cutter]) if (z.erstellt_am) e.push({ id: 'a' + z.model_name + z.account, zeit: z.erstellt_am, text: T.e_account(z) })
    for (const m of msgs) if (m.direction === 'out') e.push({ id: 'm' + m.id, zeit: m.created_at, text: T.e_nachricht(m), chat: true })
    return e.filter(x => x.zeit).sort((a, b) => String(b.zeit).localeCompare(String(a.zeit))).slice(0, 30)
  }, [daten, msgs, T, istPoster, istCutter, istFreigeber])
  const neu = ereignisse.filter(x => !lastSeen || new Date(x.zeit) > new Date(lastSeen)).length

  return (
    <>
      {open && (
        <div style={fenster(216)}>
          <div style={kopf}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}><Bell size={16} /> {T.glocke}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {neu > 0 && <button onClick={markieren} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 7, padding: '4px 9px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{T.alles_gelesen}</button>}
              <button onClick={() => setOpen(false)} aria-label={T.schliessen} style={zu}><ChevronDown size={20} /></button>
            </div>
          </div>
          <div style={{ overflowY: 'auto', padding: '6px 0' }}>
            {!ereignisse.length && <div style={{ padding: '24px 14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}>{T.nichts}</div>}
            {ereignisse.map(x => {
              const ungelesen = !lastSeen || new Date(x.zeit) > new Date(lastSeen)
              return (
                <button key={x.id} type="button" onClick={() => { if (x.chat) oeffneChat(); else setOpen(false) }}
                  style={{ display: 'flex', gap: 10, alignItems: 'flex-start', width: '100%', textAlign: 'left', padding: '10px 14px', background: ungelesen ? 'rgba(236,72,153,0.07)' : 'transparent', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 6, flexShrink: 0, background: ungelesen ? '#ec4899' : 'transparent' }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.45, fontWeight: ungelesen ? 700 : 500 }}>{x.text}</span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{zeit(x.zeit, loc)}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      <button onClick={() => setOpen(o => !o)} title={T.glocke} aria-label={T.glocke} style={fab(86, open, '#f59e0b')}>
        <Bell size={21} fill={open ? 'none' : 'currentColor'} strokeWidth={open ? 2.4 : 0} />
        {!open && zahlPunkt(neu)}
      </button>
    </>
  )
}

function SocialHilfe({ T, isOpen, onToggle }) {
  const [open, setOpen] = useFabOpen(isOpen, onToggle)
  const [auf, setAuf] = useState(0)
  return (
    <>
      {open && (
        <div style={fenster(216)}>
          <div style={kopf}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}><span style={{ color: '#a78bfa' }}>?</span> {T.hilfe}</div>
            <button onClick={() => setOpen(false)} aria-label={T.schliessen} style={{ ...zu, border: '1px solid var(--border)', borderRadius: 7, width: 26, height: 26, justifyContent: 'center', padding: 0 }}>✕</button>
          </div>
          <div style={{ overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {T.faq.map(([frage, antwort], i) => (
              <div key={i} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10 }}>
                <button type="button" onClick={() => setAuf(auf === i ? -1 : i)} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>{frage}</span><span style={{ color: 'var(--text-muted)' }}>{auf === i ? '▴' : '▾'}</span>
                </button>
                {auf === i && <div style={{ padding: '0 12px 12px', fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{antwort}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
      <button onClick={() => setOpen(o => !o)} title={T.hilfe} aria-label={T.hilfe} style={{ ...fab(152, open, '#a78bfa'), fontSize: 22, fontWeight: 700 }}>?</button>
    </>
  )
}
