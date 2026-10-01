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
// Hilfe: FAQ für Social-Rollen. v5.18.0: komplett neu (Kalender, Richtwert-Zeiten, „up to you“,
//   Abspielen, Platzhalter) + Einführungsfenster beim ersten Login als Poster.
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
    einf_nochmal: '📖 Einführung nochmal ansehen',
    einf_titel: 'Willkommen! So funktioniert das Posten',
    einf_los: 'Alles klar, los geht’s',
    einf_hilfe: 'Alles steht auch jederzeit unten rechts unter ❓ Hilfe.',
    einf: [
      ['📅', 'Der Kalender', 'Reiter „Plan“: Oben wählst du den Account, dann siehst du nur dessen Woche. Jeder Eintrag ist ein Beitrag: Reel, Foto, Karussell oder Story.'],
      ['👆', 'Beitrag öffnen', 'Antippen zeigt alles: Video oder Fotos (▶ ansehen, ⬇ laden), Caption, Hashtags, Text-Overlays und Musik/Hinweis. Beim Karussell gilt die Reihenfolge von links nach rechts.'],
      ['⏰', 'Zeiten sind Richtwerte', 'Die Uhrzeit ist eine Empfehlung. Passt etwas früher oder später besser, ist das völlig okay. Wichtig sind der richtige Tag und der richtige Account.'],
      ['✨', '„up to you“ = deine Entscheidung', 'Steht bei Musik, Caption, Sticker o. Ä. „up to you“, such dir gern selbst etwas Passendes aus, z. B. einen Sound, der gerade trendet.'],
      ['✅', 'Nach dem Posten', 'Beitrag öffnen, bei Reels den Instagram-Link einfügen (⋯ → Link kopieren) und „Gepostet ✓“ tippen. Bei Stories reicht „Story gepostet ✓“. Reels werden danach automatisch gemessen.'],
      ['💬', 'Fragen?', 'Unten rechts: 💬 Chat mit dem Team, 🔔 Neuigkeiten, ❓ Hilfe.'],
    ],
    faq: [
      ['📅 Wo sehe ich, was ich posten soll?', 'Im Reiter „Plan“. Oben den Account wählen, dann siehst du die Woche nur für diesen Account. Am Handy oben den Tag antippen. Jeder Eintrag ist ein Beitrag (Reel, Foto, Karussell, Story). Antippen öffnet alles, was du brauchst.'],
      ['⏰ Muss ich die Uhrzeit genau einhalten?', 'Nein, die Zeiten sind Richtwerte. Etwas früher oder später ist völlig okay, wenn es besser passt. Wichtig: richtiger Tag, richtiger Account. Bei US-Accounts steht die Zeit des Accounts (z. B. LA), daneben klein die deutsche Zeit.'],
      ['✨ Was heißt „up to you“?', 'Dann entscheidest du selbst, z. B. bei Musik, Caption oder Sticker. Such dir gern etwas aus, das gerade gut läuft und zum Model passt.'],
      ['▶ Video oder Fotos ansehen und laden', 'Im Beitrag aufs Vorschaubild oder „▶ ansehen“ tippen, dann läuft es direkt. „⬇ laden“ speichert die Datei. Story: jeder Frame einzeln. Karussell: Reihenfolge von links nach rechts.'],
      ['⏳ „wartet auf Video“', 'Der Beitrag ist schon eingeplant, aber das Model hat das Video noch nicht hochgeladen. Sobald es da ist, steht es automatisch im Beitrag.'],
      ['✅ Als gepostet markieren', 'Beitrag öffnen. Reel: in Instagram „⋯ → Link kopieren“, Link einfügen, „Gepostet ✓“. Foto/Karussell: Link ist freiwillig. Story: „Story gepostet ✓“. Reels werden danach automatisch gemessen.'],
      ['🎬 Reiter „Zu posten“', 'Dort stehen die freigegebenen Skript-Reels mit Drehzettel, „Worauf achten“ (No Gos, Stil) und dem festen Account. Unten: „Reels ohne Skript“ für Reels ohne Drehzettel.'],
      ['📋 Überblick und 👤 Models', '„Überblick“ zeigt alle Reels deiner Accounts und wo sie stehen. „Models“ zeigt Accounts, No Gos, Stil und Englisch-Level.'],
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
    einf_nochmal: '📖 Show the introduction again',
    einf_titel: 'Welcome! Here’s how posting works',
    einf_los: 'Got it, let’s go',
    einf_hilfe: 'You can find all of this anytime under ❓ Help at the bottom right.',
    einf: [
      ['📅', 'The calendar', '"Calendar" tab: pick the account at the top and you only see that account’s week. Each entry is one post: Reel, Photo, Carousel or Story.'],
      ['👆', 'Open a post', 'Tap it to see everything: video or photos (▶ view, ⬇ download), caption, hashtags, text overlays and music/notes. For carousels the order is left to right.'],
      ['⏰', 'Times are guidelines', 'The time is a suggestion. If a bit earlier or later works better, that’s totally fine. What matters is the right day and the right account.'],
      ['✨', '"up to you" = your call', 'If it says "up to you" for music, caption, stickers etc., feel free to pick something yourself, e.g. a sound that’s trending right now.'],
      ['✅', 'After posting', 'Open the post, for reels paste the Instagram link (⋯ → Copy link) and tap "Posted ✓". For stories, "Story posted ✓" is enough. Reels are then measured automatically.'],
      ['💬', 'Questions?', 'Bottom right: 💬 chat with the team, 🔔 updates, ❓ help.'],
    ],
    faq: [
      ['📅 Where do I see what to post?', 'In the "Calendar" tab. Pick the account at the top and you see the week for that account only. On the phone, tap the day at the top. Each entry is one post (Reel, Photo, Carousel, Story). Tap it to open everything you need.'],
      ['⏰ Do I have to stick to the exact time?', 'No, times are guidelines. A bit earlier or later is totally fine if it works better. What matters: right day, right account. For US accounts the account’s time is shown (e.g. LA) with German time next to it.'],
      ['✨ What does "up to you" mean?', 'It’s your call, e.g. for music, caption or stickers. Feel free to pick something that’s doing well right now and fits the creator.'],
      ['▶ Viewing and downloading videos or photos', 'In the post, tap the thumbnail or "▶ view" and it plays right away. "⬇ download" saves the file. Stories: every frame separately. Carousel: order from left to right.'],
      ['⏳ "waiting for video"', 'The post is already scheduled, but the creator hasn’t uploaded the video yet. As soon as it’s there, it shows up in the post automatically.'],
      ['✅ Marking as posted', 'Open the post. Reel: in Instagram "⋯ → Copy link", paste it, tap "Posted ✓". Photo/carousel: link is optional. Story: "Story posted ✓". Reels are then measured automatically.'],
      ['🎬 "To post" tab', 'Approved script reels with the shooting script, "Keep in mind" (no-gos, style) and the fixed account. At the bottom: "Reels without a script" for reels without a shooting script.'],
      ['📋 Overview and 👤 Creators', '"Overview" shows all reels of your accounts and their status. "Creators" shows accounts, no-gos, style and English level.'],
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

  // v5.18.0: Einführung beim ersten Login als Poster (einmal pro Person und Gerät), nicht in der Vorschau
  const vorschau = useVorschau()
  const istPoster = (rollen || []).includes('social_media')
  const EINF_KEY = `social_einfuehrung_v1_${displayName || ''}`
  const [einf, setEinf] = useState(false)
  useEffect(() => {
    if (!displayName || vorschau || !istPoster) return
    let gesehen = null
    try { gesehen = localStorage.getItem(EINF_KEY) } catch { /* egal */ }
    if (!gesehen) { const t = setTimeout(() => setEinf(true), 900); return () => clearTimeout(t) }
  }, [displayName, vorschau, istPoster, EINF_KEY])
  const einfZu = () => { setEinf(false); if (!vorschau) try { localStorage.setItem(EINF_KEY, new Date().toISOString()) } catch { /* egal */ } }

  if (!displayName) return null
  return (
    <>
      <SocialChat T={T} loc={loc} displayName={displayName} msgs={msgs} setMsgs={setMsgs} neu={ladenChat}
        isOpen={panels.active === 'chat'} onToggle={(v) => panels.set('chat', v)} />
      <SocialGlocke T={T} loc={loc} displayName={displayName} rollen={rollen} msgs={msgs}
        oeffneChat={() => panels.set('chat', true)}
        isOpen={panels.active === 'glocke'} onToggle={(v) => panels.set('glocke', v)} />
      <SocialHilfe T={T} isOpen={panels.active === 'hilfe'} onToggle={(v) => panels.set('hilfe', v)} onEinfuehrung={() => { panels.set('hilfe', false); setEinf(true) }} />
      {einf && <Einfuehrung T={T} onZu={einfZu} />}
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

// v5.18.0: Einführungsfenster (Schritte), auch über die Hilfe wieder aufrufbar
function Einfuehrung({ T, onZu }) {
  return (
    <div onClick={onZu} style={{ position: 'fixed', inset: 0, zIndex: 100200, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
      <div onClick={e => e.stopPropagation()} className="social-einf" style={{ width: 'min(520px, 100%)', maxHeight: 'calc(100vh - 28px)', overflowY: 'auto', background: 'var(--bg-base)', border: '1px solid var(--border-bright, var(--border))', borderRadius: 18, boxShadow: '0 24px 70px rgba(0,0,0,0.6)', padding: '18px 18px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <style>{`.social-einf .einf-los { padding: 12px 16px !important; font-size: 15px !important; }`}</style>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>{T.einf_titel}</div>
        {T.einf.map(([icon, titel, text], i) => (
          <div key={i} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 20, width: 28, flexShrink: 0, textAlign: 'center' }}>{icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>{titel}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{text}</div>
            </div>
          </div>
        ))}
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{T.einf_hilfe}</div>
        <button type="button" onClick={onZu} className="einf-los" style={{ padding: '12px 16px', borderRadius: 12, border: 'none', background: '#ec4899', color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>{T.einf_los}</button>
      </div>
    </div>
  )
}

function SocialHilfe({ T, isOpen, onToggle, onEinfuehrung }) {
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
            {onEinfuehrung && <button type="button" onClick={onEinfuehrung} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(236,72,153,0.45)', background: 'rgba(236,72,153,0.1)', color: '#ec4899', fontFamily: 'inherit', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>{T.einf_nochmal}</button>}
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
