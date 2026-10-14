import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSprache } from '../i18n/sprache'
// v5.18.0: Texte zweisprachig (Poster mit Englisch)
const VT = {
  de: { ansehen: '▶ ansehen', laden: '⬇ Laden', zu: '✕ Schließen', laedt: 'Lädt …', weg: 'Nicht abrufbar. Entweder fehlt die Berechtigung, oder die Datei wurde gelöscht.', codec: 'Dieses Video kann der Browser nicht abspielen (z. B. iPhone-Format HEVC in Chrome). Mit „⬇ Laden“ herunterladen und am Gerät ansehen.', titel: 'Im Dashboard abspielen',
    sp_laedt: 'Video wird geladen …', sp_offen: 'Bitte offen lassen, bis 100 % erreicht sind.', sp_bereit: 'Fertig geladen.',
    sp_fotos: 'In Fotos sichern', sp_fotos_hilfe: 'Im nächsten Fenster „Video sichern“ wählen. Dann ist es in deiner Galerie und du kannst es in Instagram posten.',
    sp_datei: 'Stattdessen als Datei laden', sp_fehler: 'Laden hat nicht geklappt.', sp_nochmal: 'Nochmal versuchen', sp_mac: 'Download gestartet. Die Datei liegt gleich in deinem Download-Ordner.',
    sp_gross: 'Das Video ist sehr groß. Es wird als Datei geladen (Dateien-App → Downloads), dort antippen und „Video sichern“ wählen.' },
  en: { ansehen: '▶ view', laden: '⬇ Download', zu: '✕ Close', laedt: 'Loading …', weg: 'Not available. Either you lack permission or the file was deleted.', codec: 'Your browser can’t play this video (e.g. iPhone HEVC format in Chrome). Use “⬇ Download” and watch it on your device.', titel: 'Play in the dashboard',
    sp_laedt: 'Loading video …', sp_offen: 'Keep this open until it reaches 100 %.', sp_bereit: 'Ready.',
    sp_fotos: 'Save to Photos', sp_fotos_hilfe: 'In the next window choose “Save Video”. It will then be in your gallery and you can post it on Instagram.',
    sp_datei: 'Download as a file instead', sp_fehler: 'Download failed.', sp_nochmal: 'Try again', sp_mac: 'Download started. The file will be in your Downloads folder.',
    sp_gross: 'This video is very large. It is downloaded as a file (Files app → Downloads); tap it there and choose “Save Video”.' },
}
import { istSpeicher, istBild, speicherUrl, videoHochladen, planDateiHochladen } from '../videoSpeicher'

// ── Video-Link + Vorschaubild + Hochladen (v5.7.0) ─────────────────────────
// VideoLink: wie <a href>, versteht aber auch „speicher://…“ (eigener
// Speicher). Dann wird beim Antippen ein zeitlich begrenzter Link geholt.
// Mit bild zeigt er zusätzlich das Vorschaubild.

// v5.15.0: Abspielen direkt im Dashboard. Antippen von Vorschaubild oder
// „ansehen“ öffnet einen Player über der Seite (Video läuft sofort, Fotos
// groß). „⬇ Laden“ im Player lädt die Datei herunter. Mit liste (Story-Frames,
// Karussell) kann man mit ‹ › blättern.
// ── Speichern aufs Gerät (v5.50.0) ────────────────────────────────────────
// Vorher: „⬇ Laden“ öffnete einen leeren neuen Tab und leitete den Download
// dorthin. Ergebnis: weißer Bildschirm (Mac: Datei lag trotzdem im Download-
// Ordner; iPhone: bestenfalls in der Dateien-App, nie in den Fotos).
// Jetzt:
//  • Computer (Maus): Download direkt im selben Tab über einen <a download>,
//    die Seite bleibt stehen, kein leerer Tab.
//  • Handy/Tablet (Touch, Teilen mit Dateien möglich): Video mit Fortschritt
//    laden, dann „In Fotos sichern“ → Teilen-Fenster → „Video sichern“.
//    Zwei Schritte, weil iOS das Teilen nur direkt nach einem Antippen erlaubt.
//  • Sehr große Dateien (> 1,5 GB) am Handy: als Datei laden (Speicher).
const GROSS = 1.5 * 1024 * 1024 * 1024
const mimeVon = (name) => /\.mov$/i.test(name) ? 'video/quicktime' : /\.(jpe?g)$/i.test(name) ? 'image/jpeg' : /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : /\.(m4v|mp4)$/i.test(name) ? 'video/mp4' : 'application/octet-stream'
function kannInFotos() {
  try {
    const touch = window.matchMedia?.('(pointer: coarse)')?.matches
    return !!(touch && navigator.canShare && navigator.canShare({ files: [new File([''], 'x.mp4', { type: 'video/mp4' })] }))
  } catch { return false }
}
async function alsDateiLaden(link) {
  const u = await speicherUrl(link, { laden: true })
  if (!u) return false
  const a = document.createElement('a')
  a.href = u; a.rel = 'noopener'; a.setAttribute('download', '')
  document.body.appendChild(a); a.click(); a.remove()
  return true
}
export function aufsGeraet(link, oeffneFenster) {
  if (kannInFotos()) { oeffneFenster(); return }
  alsDateiLaden(link).then(ok => {
    const V = VT[document.documentElement.lang === 'en' ? 'en' : 'de']
    if (!ok) window.alert(V.weg)
  })
}

function SpeichernFenster({ link, onZu }) {
  const V = VT[useSprache()] || VT.de
  const [stand, setStand] = useState(0)
  const [datei, setDatei] = useState(null)
  const [fehler, setFehler] = useState('')
  const [hinweis, setHinweis] = useState('')
  const [versuch, setVersuch] = useState(0)
  useEffect(() => {
    let aus = false
    const ctrl = new AbortController()
    ;(async () => {
      setStand(0); setFehler(''); setDatei(null)
      const u = await speicherUrl(link)
      if (!u) { if (!aus) setFehler(V.weg); return }
      try {
        const r = await fetch(u, { signal: ctrl.signal })
        if (!r.ok) throw new Error('HTTP ' + r.status)
        const gesamt = Number(r.headers.get('content-length')) || 0
        if (gesamt > GROSS) { setHinweis(V.sp_gross); await alsDateiLaden(link); return }
        const name = (link.split('/').pop() || 'video.mp4').replace(/[^A-Za-z0-9._-]/g, '')
        let blob
        if (r.body && gesamt) {
          const leser = r.body.getReader(); const teile = []; let da = 0
          for (;;) {
            const { done, value } = await leser.read()
            if (done) break
            teile.push(value); da += value.length
            if (!aus) setStand(da / gesamt)
          }
          blob = new Blob(teile, { type: mimeVon(name) })
        } else {
          blob = await r.blob()
        }
        if (!aus) { setStand(1); setDatei(new File([blob], name, { type: mimeVon(name) })) }
      } catch (e) {
        if (!aus && e?.name !== 'AbortError') setFehler(V.sp_fehler + ' ' + (e?.message || ''))
      }
    })()
    return () => { aus = true; ctrl.abort() }
  }, [link, versuch])
  const teilen = async () => {
    try { await navigator.share({ files: [datei] }); onZu() }
    catch (e) { if (e?.name !== 'AbortError') setFehler(V.sp_fehler + ' ' + (e?.message || '')) }
  }
  const k = { padding: '12px 14px', borderRadius: 12, border: 'none', fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', width: '100%' }
  return createPortal(
    <div onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onZu() }} onMouseDown={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}
      style={{ position: 'fixed', inset: 0, zIndex: 2147483001, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, background: 'var(--bg-card)', borderRadius: '18px 18px 0 0', padding: '18px 16px calc(18px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <VideoBild href={link} hoehe={64} onClick={() => {}} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{fehler ? V.sp_fehler : datei ? V.sp_bereit : V.sp_laedt}</div>
            {!datei && !fehler && !hinweis && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{V.sp_offen}</div>}
          </div>
          <button type="button" onClick={onZu} aria-label={V.zu} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer', padding: 4 }}>✕</button>
        </div>
        {!datei && !fehler && !hinweis && (
          <div style={{ height: 8, borderRadius: 5, background: 'var(--bg-card2)', overflow: 'hidden' }}>
            <div style={{ width: `${Math.round(stand * 100)}%`, height: '100%', background: '#06b6d4', transition: 'width .3s' }} />
          </div>
        )}
        {!datei && !fehler && !hinweis && <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', textAlign: 'right' }}>{Math.round(stand * 100)} %</div>}
        {hinweis && <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{hinweis}</div>}
        {datei && <>
          <button type="button" onClick={teilen} style={{ ...k, background: '#06b6d4', color: '#04212a' }}>{V.sp_fotos}</button>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{V.sp_fotos_hilfe}</div>
        </>}
        {fehler && <>
          <div role="alert" style={{ fontSize: 12.5, color: '#ef4444' }}>{fehler}</div>
          <button type="button" onClick={() => setVersuch(v => v + 1)} style={{ ...k, background: '#06b6d4', color: '#04212a' }}>{V.sp_nochmal}</button>
        </>}
        {!hinweis && <button type="button" onClick={() => { alsDateiLaden(link); onZu() }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', textDecoration: 'underline', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', padding: 2 }}>{V.sp_datei}</button>}
      </div>
    </div>,
    document.body
  )
}

export function Abspieler({ link, liste = null, onZu }) {
  const V = VT[useSprache()] || VT.de
  const alle = liste && liste.length ? liste : [link]
  const [nr, setNr] = useState(Math.max(0, alle.indexOf(link)))
  const [url, setUrl] = useState(null)
  const [fehler, setFehler] = useState('')
  const jetzt = alle[nr]
  const foto = istBild(jetzt)
  useEffect(() => {
    let aus = false
    setUrl(null); setFehler('')
    speicherUrl(jetzt).then(u => { if (aus) return; if (u) setUrl(u); else setFehler(V.weg) })
    return () => { aus = true }
  }, [jetzt])
  useEffect(() => {
    const taste = (e) => {
      // v5.15.1: Esc schließt nur den Player, nicht auch das Fenster dahinter
      if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); onZu() }
      if (e.key === 'ArrowRight' && nr < alle.length - 1) setNr(nr + 1)
      if (e.key === 'ArrowLeft' && nr > 0) setNr(nr - 1)
    }
    window.addEventListener('keydown', taste, true)
    const alt = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', taste, true); document.body.style.overflow = alt }
  }, [nr, alle.length, onZu])
  const [speichern, setSpeichern] = useState(false)   // v5.50.0
  const herunter = () => aufsGeraet(jetzt, () => setSpeichern(true))
  const k = { padding: '9px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }
  return createPortal(
    // v5.15.1: Klicks im Player gehen nicht mehr an die Fenster dahinter weiter
    // (React reicht Ereignisse aus einem Portal an die Eltern weiter → das Beitrags-
    // Fenster ging zu bzw. die Ablage-Kachel wurde markiert). Ganz oben über allem.
    <div onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onZu() }}
      onMouseDown={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}
      onDragStart={e => { e.preventDefault(); e.stopPropagation() }} draggable={false}
      className="abspieler" style={{ position: 'fixed', inset: 0, zIndex: 2147483000, background: 'rgba(0,0,0,0.88)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px 10px calc(12px + env(safe-area-inset-bottom, 0px))' }}>
      <style>{`.abspieler button { padding: 9px 14px !important; font-size: 14px !important; }`}</style>
      <div onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) onZu() }} style={{ position: 'relative', flex: 1, minHeight: 0, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {fehler ? <div style={{ color: '#fff', fontSize: 14, maxWidth: 320, textAlign: 'center', lineHeight: 1.5 }}>{fehler}</div>
          : !url ? <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14 }}>{V.laedt}</div>
          : foto ? <img src={url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 10 }} />
          : <video key={url} src={url} controls autoPlay playsInline
              onError={() => setFehler(V.codec)}
              style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 10, background: '#000' }} />}
      </div>
      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
        {alle.length > 1 && <button type="button" disabled={nr === 0} onClick={() => setNr(nr - 1)} style={{ ...k, opacity: nr === 0 ? 0.35 : 1 }}>‹</button>}
        {alle.length > 1 && <span style={{ color: '#fff', fontSize: 13, fontWeight: 700, minWidth: 44, textAlign: 'center' }}>{nr + 1} / {alle.length}</span>}
        {alle.length > 1 && <button type="button" disabled={nr === alle.length - 1} onClick={() => setNr(nr + 1)} style={{ ...k, opacity: nr === alle.length - 1 ? 0.35 : 1 }}>›</button>}
        <button type="button" onClick={herunter} style={k}>{V.laden}</button>
        <button type="button" onClick={onZu} style={{ ...k, background: '#fff', color: '#000' }}>{V.zu}</button>
      </div>
      {speichern && <SpeichernFenster link={jetzt} onZu={() => setSpeichern(false)} />}
    </div>,
    document.body
  )
}

export function VideoLink({ href, children, style, laden = false, bild = false, title }) {
  const [spielt, setSpielt] = useState(false)
  const [speichern, setSpeichern] = useState(false)   // v5.50.0 (vor den frühen returns)
  const V = VT[useSprache()] || VT.de
  if (!href) return null
  if (!istSpeicher(href)) {
    return <a href={href} target="_blank" rel="noreferrer" style={style} title={title}>{children}</a>
  }
  // v5.15.0: ohne laden → im Player abspielen statt neuen Tab öffnen
  const abspielen = (e) => { e.preventDefault(); e.stopPropagation(); setSpielt(true) }
  // v5.50.0: kein leerer neuer Tab mehr (weißer Bildschirm). Computer: Download im selben Tab,
  // Handy: laden mit Fortschritt und „In Fotos sichern“.
  const oeffnen = (e) => {
    e.preventDefault(); e.stopPropagation()
    aufsGeraet(href, () => setSpeichern(true))
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {bild && <VideoBild href={href} onClick={abspielen} />}
      <a href="#" onClick={laden ? oeffnen : abspielen} style={style} title={title}>{children}</a>
      {laden && <a href="#" onClick={abspielen} style={{ ...style, fontWeight: 700 }} title={V.titel}>{V.ansehen}</a>}
      {spielt && <Abspieler link={href} onZu={() => setSpielt(false)} />}
      {speichern && <SpeichernFenster link={href} onZu={() => setSpeichern(false)} />}
    </span>
  )
}

// v5.15.0: ohne onClick spielt Antippen ab. knopf → zusätzlich kleiner ▶-Knopf
// (für Kacheln, bei denen Antippen etwas anderes macht, z. B. markieren). liste → blättern im Player.
export function VideoBild({ href, onClick, hoehe = 64, knopf = false, liste = null }) {
  const [url, setUrl] = useState(null)
  const [weg, setWeg] = useState(false)
  const [spielt, setSpielt] = useState(false)
  const spielen = (e) => { e?.preventDefault?.(); e?.stopPropagation?.(); setSpielt(true) }
  useEffect(() => {
    let aus = false
    if (istSpeicher(href)) speicherUrl(href, { bild: true }).then(u => { if (!aus) { setUrl(u); setWeg(!u) } })
    return () => { aus = true }
  }, [href])
  if (!istSpeicher(href) || weg) return null
  const box = { width: Math.round(hoehe * 9 / 16), height: hoehe, borderRadius: 8, background: 'var(--bg-card2)', flexShrink: 0, cursor: 'pointer', objectFit: 'cover', display: 'block' }
  if (!url) return <span style={box} />
  return (
    <span onClick={onClick || spielen} style={{ position: 'relative', display: 'inline-block', flexShrink: 0 }} title={onClick && knopf ? undefined : 'Ansehen'}>
      <img src={url} alt="" style={box} onError={() => setWeg(true)} />
      {!istBild(href) && !knopf && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, textShadow: '0 1px 4px rgba(0,0,0,.7)', pointerEvents: 'none' }}>▶</span>}
      {knopf && <button type="button" onClick={spielen} title={istBild(href) ? 'Groß ansehen' : 'Abspielen'} className="abspiel-knopf"
        style={{ position: 'absolute', left: 'calc(100% - 8px)', top: '40%', width: 26, height: 26, borderRadius: 13, border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>{istBild(href) ? '🔍' : '▶'}</button>}
      {spielt && <Abspieler link={href} liste={liste} onZu={() => setSpielt(false)} />}
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

// v5.9.0: kleiner Knopf „⬆ Hochladen“ für Plan-Einträge (Reel-Video,
// Story-Frame) und Material. Fotos oder Videos. onFertig(link) setzt nur das
// Feld im Formular, gespeichert wird mit dem Eintrag.
// v5.10.1: mehrere → mehrere Dateien auf einmal, onFertig wird je Datei aufgerufen (Story: ein Frame pro Datei)
export function DateiHochladen({ model, account = null, onFertig, text = '⬆ Hochladen', nurVideo = false, nurFoto = false, farbe = '#06b6d4', gesperrt = false, mehrere = false, gross = false }) {
  const input = useRef(null)
  const [stand, setStand] = useState(null)
  const [fehler, setFehler] = useState('')
  const [nr, setNr] = useState('')
  const los = async (dateien) => {
    const liste = [...(dateien || [])]
    if (!liste.length) return
    setFehler('')
    for (let i = 0; i < liste.length; i++) {
      setNr(liste.length > 1 ? `${i + 1}/${liste.length} · ` : ''); setStand(0)
      const r = await planDateiHochladen({ datei: liste[i], model, account, onFortschritt: setStand })
      if (r.fehler) { setFehler(`${liste.length > 1 ? (liste[i].name || `Datei ${i + 1}`) + ': ' : ''}${r.fehler}`); continue }
      onFertig(r.link)
    }
    setStand(null); setNr('')
  }
  const laeuft = stand !== null
  return (
    <span style={{ display: gross ? 'flex' : 'inline-flex', flexDirection: 'column', gap: 3 }}>
      <input ref={input} type="file" multiple={mehrere} accept={nurVideo ? 'video/*' : nurFoto ? 'image/*' : 'image/*,video/*'} style={{ display: 'none' }} onChange={e => { const d = [...(e.target.files || [])]; e.target.value = ''; los(d) }} />
      {/* v5.14.0: gross → voller, gut sichtbarer Knopf (Content-Ablage) */}
      <button type="button" disabled={laeuft || gesperrt || !model} onClick={() => input.current?.click()} className={gross ? 'plan-gross' : undefined}
        style={{ padding: gross ? '11px 14px' : '6px 10px', borderRadius: gross ? 11 : 9, fontSize: gross ? 14 : 12, fontWeight: 800, cursor: laeuft || gesperrt ? 'not-allowed' : 'pointer', fontFamily: 'inherit', border: `1px solid ${farbe}`, background: gross ? farbe : 'transparent', color: gross ? '#fff' : farbe, whiteSpace: gross ? 'normal' : 'nowrap', opacity: gesperrt ? 0.45 : 1, width: gross ? '100%' : undefined }}>
        {laeuft ? `${nr}${Math.round(stand * 100)} %` : text}
      </button>
      {fehler && <span style={{ fontSize: 11.5, color: '#ef4444', maxWidth: 260 }}>{fehler}</span>}
    </span>
  )
}
