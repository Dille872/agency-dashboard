import React, { useEffect, useState } from 'react'
import { istPrivat, signiert, sofort } from '../medien'

// ── Bild/Video/Audio/Link mit signierter Adresse (v5.33.0) ─────────────────
// Ersatz für <img>, <video>, <audio>, <a> bei Dateien aus unseren privaten
// Buckets. Gleiche Props wie das Original; src/href darf der alte öffentliche
// Link sein, die Komponente holt den signierten. Fremde Links gehen unverändert durch.

export function useMedien(url) {
  const [u, setU] = useState(() => sofort(url))
  useEffect(() => {
    let weg = false
    const s = sofort(url)
    if (s) { setU(s); return }
    setU(null)
    if (!url) return
    signiert(url).then(x => { if (!weg) setU(x) })
    return () => { weg = true }
  }, [url])
  return u
}

export function MImg({ src, style, ...rest }) {
  const u = useMedien(src)
  if (!u) return <span aria-hidden style={{ display: 'inline-block', background: 'var(--bg-card2)', ...style }} />
  return <img src={u} style={style} {...rest} />
}

export function MVideo({ src, ...rest }) {
  const u = useMedien(src)
  return <video src={u || undefined} {...rest} />
}

export function MAudio({ src, ...rest }) {
  const u = useMedien(src)
  return <audio src={u || undefined} {...rest} />
}

export function MA({ href, onClick, children, ...rest }) {
  const u = useMedien(href)
  const klick = (e) => {
    if (onClick) onClick(e)
    if (e.defaultPrevented) return
    if (!u && istPrivat(href)) {
      e.preventDefault()
      const w = window.open('', '_blank')
      signiert(href).then(x => { if (w) w.location.href = x; else window.location.href = x })
    }
  }
  return <a href={u || (istPrivat(href) ? '#' : href)} onClick={klick} {...rest}>{children}</a>
}
