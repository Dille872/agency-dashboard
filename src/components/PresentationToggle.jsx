import React, { useState, useEffect } from 'react'

// v3.59.0: Präsentationsmodus — ein globaler Schalter, der als .private markierte
// Werte (v.a. Beträge/Umsatz/Stats) unkenntlich macht. Zustand liegt in localStorage,
// die Klasse hängt an <html> — dadurch wirkt es auf JEDER Seite und übersteht
// Tab-Wechsel wie auch einen Reload. Bewusst außerhalb von App gemountet (main.jsx),
// damit der Knopf in allen Ansichten (Admin, Model-Portal, Chatter-Portal) sichtbar ist.
const KEY = 'presentation_mode'

export default function PresentationToggle() {
  const [on, setOn] = useState(() => {
    try { return localStorage.getItem(KEY) === '1' } catch { return false }
  })

  useEffect(() => {
    document.documentElement.classList.toggle('presentation-mode', on)
    try { localStorage.setItem(KEY, on ? '1' : '0') } catch {}
  }, [on])

  return (
    <button
      onClick={() => setOn(v => !v)}
      title={on ? 'Zahlen wieder anzeigen' : 'Zahlen für eine Präsentation ausblenden'}
      style={{
        position: 'fixed', left: 16, bottom: 16, zIndex: 99999,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '9px 14px', borderRadius: 999,
        background: on ? '#7c3aed' : 'rgba(18,18,32,0.82)',
        color: on ? '#fff' : '#cbd5e1',
        border: `1px solid ${on ? '#7c3aed' : 'rgba(255,255,255,0.15)'}`,
        boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
        userSelect: 'none',
      }}
    >
      <span style={{ fontSize: 14, lineHeight: 1 }}>{on ? '🙈' : '👁'}</span>
      {on ? 'Zahlen versteckt' : 'Präsentationsmodus'}
    </button>
  )
}
