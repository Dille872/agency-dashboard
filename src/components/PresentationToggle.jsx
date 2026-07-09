import React, { useState, useEffect, useRef } from 'react'
import { Eye, EyeOff } from 'lucide-react'

// v3.60.0: Präsentationsmodus — EIN globaler Schalter, der automatisch ALLE Zahlen
// auf der gesamten Seite unkenntlich macht (kein Markieren pro Stelle nötig).
// Technik: Solange der Modus an ist, werden Textknoten mit Ziffern gesucht und ihr
// umschließendes Element bekommt die Klasse .pv-blur (nur eine Klasse setzen — es
// werden KEINE DOM-Knoten eingefügt/entfernt, damit React nicht durcheinanderkommt).
// Ein MutationObserver wendet das bei Tab-Wechsel/Nachladen erneut an. Läuft nur,
// während der Modus aktiv ist — im Normalbetrieb also ohne jede Last.

const KEY = 'presentation_mode'
const BLUR_CLASS = 'pv-blur'
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'SVG', 'PATH'])
const HAS_DIGIT = /[0-9]/

export default function PresentationToggle() {
  const [on, setOn] = useState(() => {
    try { return localStorage.getItem(KEY) === '1' } catch { return false }
  })
  const obsRef = useRef(null)
  const timerRef = useRef(0)

  useEffect(() => {
    try { localStorage.setItem(KEY, on ? '1' : '0') } catch {}
    document.documentElement.classList.toggle('presentation-mode', on)

    const cleanup = () => {
      if (obsRef.current) { obsRef.current.disconnect(); obsRef.current = null }
      clearTimeout(timerRef.current)
      document.querySelectorAll('.' + BLUR_CLASS).forEach(el => el.classList.remove(BLUR_CLASS))
    }

    if (!on) { cleanup(); return }

    const root = document.getElementById('root')
    if (!root) return

    const apply = () => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const v = node.nodeValue
          if (!v || !HAS_DIGIT.test(v)) return NodeFilter.FILTER_REJECT
          const p = node.parentElement
          if (!p || SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT
          return NodeFilter.FILTER_ACCEPT
        },
      })
      const parents = new Set()
      let n
      while ((n = walker.nextNode())) { if (n.parentElement) parents.add(n.parentElement) }
      parents.forEach(el => el.classList.add(BLUR_CLASS))
    }

    // gedrosselt neu anwenden (Tab-Wechsel, Nachladen, Re-Renders)
    const schedule = () => {
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(apply, 120)
    }

    apply()
    const obs = new MutationObserver(schedule)
    obs.observe(root, { childList: true, subtree: true, characterData: true })
    obsRef.current = obs

    return cleanup
  }, [on])

  // Knopf-Beschriftung — hier bei Bedarf einfach den Text ändern
  // (z.B. 'Privat', 'Discreet', 'Stealth', 'Zahlen aus', 'Demo', 'Vorschau').
  const LABEL = 'Inkognito'

  return (
    <button
      onClick={() => setOn(v => !v)}
      title={on ? 'Zahlen wieder anzeigen' : 'Zahlen ausblenden'}
      style={{
        position: 'fixed', left: 20, bottom: 20, zIndex: 99999,
        display: 'inline-flex', alignItems: 'center', gap: 8,
        height: 38, padding: '0 15px', borderRadius: 10,
        background: on ? 'rgba(124,58,237,0.16)' : 'rgba(255,255,255,0.05)',
        color: on ? '#a78bfa' : '#94a3b8',
        border: `1px solid ${on ? 'rgba(124,58,237,0.45)' : 'rgba(255,255,255,0.10)'}`,
        boxShadow: on
          ? '0 0 0 1px rgba(124,58,237,0.15), 0 8px 24px rgba(124,58,237,0.20)'
          : '0 4px 16px rgba(0,0,0,0.25)',
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        fontSize: 12.5, fontWeight: 600, letterSpacing: '0.01em',
        cursor: 'pointer', fontFamily: 'inherit', userSelect: 'none',
        transition: 'background 0.18s ease, color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease',
      }}
    >
      {on ? <EyeOff size={15} strokeWidth={2.2} /> : <Eye size={15} strokeWidth={2.2} />}
      {LABEL}
    </button>
  )
}
