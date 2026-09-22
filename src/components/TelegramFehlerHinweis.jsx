// v4.48.0: Sichtbarer Hinweis, wenn eine Telegram-Nachricht nicht ankommt.
//
// callTelegram (src/telegram.js) wirft bei Fehlern bewusst nicht, sondern
// schickt ein 'telegram-fehler'-Event. Vorher ging ein Fehlschlag an den
// meisten Stellen lautlos verloren — die Oberfläche meldete „✓ gesendet".
// Liegt global in main.jsx, damit der Hinweis auch im Chatter- und
// Model-Portal erscheint.
import React, { useEffect, useState } from 'react'

const FREUNDLICH = (d = '') => {
  const t = d.toLowerCase()
  if (t.includes('chat not found')) return 'Empfänger hat den Bot nie gestartet oder gelöscht (/start nötig).'
  if (t.includes('blocked')) return 'Empfänger hat den Bot blockiert.'
  if (t.includes('deactivated')) return 'Telegram-Konto des Empfängers ist gelöscht.'
  if (t.includes('too many requests')) return 'Telegram bremst gerade (zu viele Nachrichten). Gleich nochmal versuchen.'
  return d || 'Unbekannter Fehler'
}

export default function TelegramFehlerHinweis() {
  const [liste, setListe] = useState([])

  useEffect(() => {
    const onFehler = (e) => {
      const id = Date.now() + Math.random()
      setListe(prev => [...prev.slice(-3), { id, ...e.detail }])
      setTimeout(() => setListe(prev => prev.filter(x => x.id !== id)), 12000)
    }
    window.addEventListener('telegram-fehler', onFehler)
    return () => window.removeEventListener('telegram-fehler', onFehler)
  }, [])

  if (!liste.length) return null
  return (
    <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 10000, display: 'flex', flexDirection: 'column', gap: 8, width: 'min(440px, calc(100vw - 32px))' }}>
      {liste.map(f => (
        <div key={f.id} role="alert"
          style={{ background: '#2a0f14', border: '1px solid rgba(239,68,68,0.5)', color: '#fecaca', borderRadius: 10, padding: '10px 12px', fontSize: 12, lineHeight: 1.45, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 15 }}>⚠</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: '#f87171' }}>Telegram-Nachricht nicht angekommen</div>
            <div>{FREUNDLICH(f.description)}</div>
            {f.vorschau && <div style={{ marginTop: 3, color: 'var(--ton-rot)', opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>„{f.vorschau}"</div>}
          </div>
          <button onClick={() => setListe(prev => prev.filter(x => x.id !== f.id))}
            style={{ background: 'transparent', border: 'none', color: 'var(--ton-rot)', cursor: 'pointer', fontSize: 14, padding: 0 }}>✕</button>
        </div>
      ))}
    </div>
  )
}
