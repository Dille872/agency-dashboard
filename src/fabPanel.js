// src/fabPanel.js
// v4.1.0 — Ein gemeinsamer Schalter für die schwebenden Fenster unten rechts.
//
// Vorher hielt jedes Widget seinen eigenen offen/zu-Zustand. Dadurch konnten Chat,
// Glocke und Team-intern gleichzeitig offen sein und sich gegenseitig überdecken.
// Jetzt merkt sich der Eltern-Bildschirm, WELCHES Fenster offen ist — es kann immer
// nur eines sein, das Öffnen des einen schließt das andere.
//
// Die Widgets bleiben abwärtskompatibel: ohne `onToggle` benutzen sie weiter ihren
// eigenen Zustand (siehe useFabOpen).

import { useState, useEffect, useCallback } from 'react'

export function useFabPanels() {
  const [active, setActive] = useState(null)

  // Escape schließt das offene Fenster — an einer Stelle statt in jedem Widget.
  useEffect(() => {
    if (!active) return
    const onKey = (e) => { if (e.key === 'Escape') setActive(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  const set = useCallback((id, next) => {
    setActive(cur => (next ? id : (cur === id ? null : cur)))
  }, [])

  return { active, set, close: () => setActive(null) }
}

/**
 * Hilfsmittel für die Widgets selbst.
 * Mit `onToggle` läuft der Zustand über die Eltern (nur eines offen),
 * ohne bleibt das bisherige Verhalten erhalten.
 */
export function useFabOpen(isOpen, onToggle) {
  const [local, setLocal] = useState(false)
  const controlled = typeof onToggle === 'function'
  const open = controlled ? !!isOpen : local
  const setOpen = useCallback((v) => {
    const next = typeof v === 'function' ? v(controlled ? !!isOpen : local) : v
    if (controlled) onToggle(next)
    else setLocal(next)
  }, [controlled, isOpen, local, onToggle])
  return [open, setOpen]
}
