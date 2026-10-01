import React, { useEffect, useRef, useState } from 'react'
import { istSpeicher, speicherUrl, videoHochladen } from '../videoSpeicher'

// ── Video-Link + Vorschaubild + Hochladen (v5.7.0) ─────────────────────────
// VideoLink: wie <a href>, versteht aber auch „speicher://…“ (eigener
// Speicher). Dann wird beim Antippen ein zeitlich begrenzter Link geholt.
// Mit bild zeigt er zusätzlich das Vorschaubild.

export function VideoLink({ href, children, style, laden = false, bild = false, title }) {
  if (!href) return null
  if (!istSpeicher(href)) {
    return <a href={href} target="_blank" rel="noreferrer" style={style} title={title}>{children}</a>
  }
  const oeffnen = async (e) => {
    e.preventDefault(); e.stopPropagation()
    const fenster = window.open('', '_blank')   // sofort öffnen, sonst blockt der Browser das Fenster
    const url = await speicherUrl(href, { laden })
    if (!url) { if (fenster) fenster.close(); window.alert('Das Video ist nicht abrufbar. Entweder fehlt die Berechtigung, oder es wurde gelöscht (Rohvideos 30 Tage nach dem Posten, wenn es eine geschnittene Fassung gibt).'); return }
    if (fenster) fenster.location.href = url; else window.location.href = url
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {bild && <VideoBild href={href} onClick={oeffnen} />}
      <a href="#" onClick={oeffnen} style={style} title={title}>{children}</a>
    </span>
  )
}

export function VideoBild({ href, onClick, hoehe = 64 }) {
  const [url, setUrl] = useState(null)
  const [weg, setWeg] = useState(false)
  useEffect(() => {
    let aus = false
    if (istSpeicher(href)) speicherUrl(href, { bild: true }).then(u => { if (!aus) { setUrl(u); setWeg(!u) } })
    return () => { aus = true }
  }, [href])
  if (!istSpeicher(href) || weg) return null
  const box = { width: Math.round(hoehe * 9 / 16), height: hoehe, borderRadius: 8, background: 'var(--bg-card2)', flexShrink: 0, cursor: 'pointer', objectFit: 'cover', display: 'block' }
  if (!url) return <span style={box} />
  return (
    <span onClick={onClick} style={{ position: 'relative', display: 'inline-block', flexShrink: 0 }} title="Video ansehen">
      <img src={url} alt="" style={box} onError={() => setWeg(true)} />
      <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, textShadow: '0 1px 4px rgba(0,0,0,.7)', pointerEvents: 'none' }}>▶</span>
    </span>
  )
}

// Hochladen mit Fortschrittsbalken. onFertig(link) bekommt speicher://…
export function VideoHochladen({ skriptId, art = 'roh', onFertig, text = '🎬 Video hochladen', farbe = '#ec4899', gesperrt = false, gesperrtText }) {
  const input = useRef(null)
  const [stand, setStand] = useState(null)   // null | 0…1
  const [fehler, setFehler] = useState('')
  const los = async (datei) => {
    if (!datei) return
    setFehler(''); setStand(0)
    const r = await videoHochladen({ datei, skriptId, art, onFortschritt: setStand })
    setStand(null)
    if (r.fehler) { setFehler(r.fehler); return }
    const err = await onFertig(r.link)
    if (err) setFehler('Hochgeladen, aber nicht gespeichert: ' + (err.message || err))
  }
  const laeuft = stand !== null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input ref={input} type="file" accept="video/*" style={{ display: 'none' }} onChange={e => { const d = e.target.files?.[0]; e.target.value = ''; los(d) }} />
      <button type="button" disabled={laeuft || gesperrt} title={gesperrt ? gesperrtText : undefined}
        onClick={() => !gesperrt && input.current?.click()}
        style={{ padding: '10px 12px', borderRadius: 11, border: 'none', background: farbe, color: '#fff', fontSize: 14, fontWeight: 800, cursor: laeuft || gesperrt ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: gesperrt ? 0.45 : 1 }}>
        {laeuft ? `Lädt hoch … ${Math.round(stand * 100)} %` : text}
      </button>
      {laeuft && (
        <div style={{ height: 6, borderRadius: 4, background: 'var(--bg-card2)', overflow: 'hidden' }}>
          <div style={{ width: `${Math.round(stand * 100)}%`, height: '100%', background: farbe, transition: 'width .3s' }} />
        </div>
      )}
      {laeuft && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Bitte die Seite offen lassen. Bricht das Netz ab, geht es beim nächsten Versuch an derselben Stelle weiter.</div>}
      {fehler && <div style={{ fontSize: 12.5, color: '#ef4444' }}>{fehler}</div>}
    </div>
  )
}
