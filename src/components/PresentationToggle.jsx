import React, { useState, useEffect, useRef } from 'react'

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

  return (
    <button
      onClick={() => setOn(v => !v)}
      title={on ? 'Zahlen wieder anzeigen' : 'Alle Zahlen für eine Präsentation ausblenden'}
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
