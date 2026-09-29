import React, { useEffect, useState } from 'react'
import { useSprache } from '../i18n/sprache' // v4.110.0

// ── Neue Version da? (v4.109.1) ────────────────────────────────────────────
// Am Handy (vor allem als App auf dem Homescreen) bleibt die Seite oft tagelang
// im Hintergrund offen und lädt nie neu. Dann fehlen neue Funktionen und
// Anfragen (Fall Julia, 28.09.: Steckbrief/Fragebogen am Laptop da, am Handy nicht).
//
// Beim Zurückholen der App (und alle 10 Minuten) fragen wir die Startseite ab
// und vergleichen die eingebundene Programmdatei (/assets/index-….js). Ist sie
// anders, gibt es eine neue Version → unten ein Hinweis „Tippen zum
// Aktualisieren“. Nie automatisch neu laden: jemand könnte gerade tippen.
// Im Entwicklungsmodus (keine /assets/-Datei) passiert nichts.

const dateiVon = (html) => (String(html).match(/\/assets\/index-[A-Za-z0-9_-]+\.js/) || [])[0] || null

export default function NeueVersionHinweis() {
  const [neu, setNeu] = useState(false)
  const sprache = useSprache()
  useEffect(() => {
    const aktuell = dateiVon([...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).join(' '))
    if (!aktuell) return
    let zuletzt = 0
    let weg = false
    const pruefen = async () => {
      if (weg || document.visibilityState !== 'visible' || Date.now() - zuletzt < 60000) return
      zuletzt = Date.now()
      try {
        const r = await fetch('/?v=' + Date.now(), { cache: 'no-store' })
        if (!r.ok) return
        const dort = dateiVon(await r.text())
        if (!weg && dort && dort !== aktuell) setNeu(true)
      } catch { /* offline: später nochmal */ }
    }
    const sichtbar = () => { if (document.visibilityState === 'visible') pruefen() }
    document.addEventListener('visibilitychange', sichtbar)
    window.addEventListener('focus', sichtbar)
    const iv = setInterval(pruefen, 10 * 60000)
    return () => { weg = true; document.removeEventListener('visibilitychange', sichtbar); window.removeEventListener('focus', sichtbar); clearInterval(iv) }
  }, [])
  if (!neu) return null
  return (
    <button type="button" onClick={() => window.location.reload()}
      style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(84px + env(safe-area-inset-bottom, 0px))', zIndex: 200000, display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', borderRadius: 14, border: 'none', background: '#8b5cf6', color: '#fff', fontSize: 14, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer', boxShadow: '0 8px 24px rgba(0,0,0,0.45)', whiteSpace: 'nowrap' }}>
      {sprache === 'en' ? '🔄 New version available · tap to update' : '🔄 Neue Version da · tippen zum Aktualisieren'}
    </button>
  )
}
