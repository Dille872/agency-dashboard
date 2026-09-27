import React, { useEffect, useState } from 'react'
import { STATUS, statusVon, skripteLaden, skriptAendern, linkOk, mitHttps, tagKurz } from '../reelSkripte'

// ── Model-Portal: Drehzettel (v4.101.0) ────────────────────────────────────
// Liste der Reel-Skripte des Models. Pro Skript: Drehzettel (PDF) öffnen,
// nach dem Drehen den LINK zum Video einfügen (Dropbox, Google Drive,
// WeTransfer …). Keine Videodatei im Dashboard — so bleibt die volle Qualität
// und große Dateien brechen nicht ab. Posten macht die Agentur.
// Erscheint nur, wenn es mindestens ein Skript gibt.

const R = '#06b6d4'
const feld = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '10px 11px', borderRadius: 11, fontSize: 15, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }

function Zeile({ s, name, logActivity, onNeu, isPreview }) {
  const [edit, setEdit] = useState(false)
  const [link, setLink] = useState(s.video_link || '')
  const [fehler, setFehler] = useState('')
  const [arbeitet, setArbeitet] = useState(false)
  const status = statusVon(s)
  const st = STATUS[status]

  const speichern = async () => {
    const v = mitHttps(link)
    if (!linkOk(v)) { setFehler('Bitte den kompletten Link einfügen, z. B. https://www.dropbox.com/…'); return }
    setArbeitet(true); setFehler('')
    const err = await skriptAendern(s.id, { video_link: v, video_am: new Date().toISOString(), video_von: name })
    setArbeitet(false)
    if (err) { setFehler('Nicht gespeichert: ' + err.message); return }
    try { await logActivity?.('Video hinterlegt', 'reels', `${s.nr} ${s.titel}`) } catch { /* nur Hinweis */ }
    setEdit(false); onNeu()
  }

  return (
    <div style={{ border: `1px solid ${status === 'freigegeben' ? 'rgba(245,158,11,0.45)' : 'var(--border)'}`, borderRadius: 14, padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: R, fontFamily: 'ui-monospace, monospace' }}>{s.nr}</span>
        <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>{s.titel}</span>
        <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: st.f + '22', color: st.f, whiteSpace: 'nowrap' }}>{status === 'freigegeben' ? 'zu drehen' : st.t}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {s.drehzettel_url && <a href={s.drehzettel_url} target="_blank" rel="noreferrer" style={{ fontSize: 13.5, fontWeight: 700, color: R, padding: '8px 12px', borderRadius: 11, border: `1px solid ${R}`, textDecoration: 'none' }}>📄 Drehzettel öffnen</a>}
        {s.video_link && !edit && (
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            ✓ Video-Link hinterlegt {tagKurz(s.video_am)}
            {status !== 'gepostet' && !isPreview && <> · <button type="button" onClick={() => setEdit(true)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit' }}>ändern</button></>}
          </span>
        )}
      </div>
      {!isPreview && status === 'freigegeben' && !edit && (
        <button type="button" onClick={() => setEdit(true)} style={{ padding: '10px 12px', borderRadius: 11, border: 'none', background: R, color: '#04212a', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>🎬 Video fertig? Link einfügen</button>
      )}
      {edit && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input autoFocus value={link} onChange={e => setLink(e.target.value.slice(0, 500))} placeholder="https://www.dropbox.com/…" style={feld} inputMode="url" autoCapitalize="none" autoCorrect="off" />
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>Video in deine Dropbox (oder Google Drive, WeTransfer) laden, dort „Teilen“ → „Link kopieren“ und hier einfügen. Bitte in voller Qualität, nicht über WhatsApp.</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" disabled={arbeitet} onClick={speichern} style={{ flex: 1, padding: 10, borderRadius: 11, border: 'none', background: R, color: '#04212a', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>{arbeitet ? 'Speichert …' : 'Speichern'}</button>
            <button type="button" onClick={() => { setEdit(false); setLink(s.video_link || ''); setFehler('') }} style={{ padding: '10px 14px', borderRadius: 11, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Abbrechen</button>
          </div>
        </div>
      )}
      {fehler && <div role="alert" style={{ fontSize: 12.5, color: 'var(--ton-rot)' }}>{fehler}</div>}
    </div>
  )
}

export default function ModelDrehzettel({ displayName, logActivity, isPreview, cardS = {}, HelpDot }) {
  const [liste, setListe] = useState(null)
  const [alleGepostet, setAlleGepostet] = useState(false)
  const laden = async () => {
    if (!displayName) return
    const d = await skripteLaden(displayName, { mitVerworfenen: false })
    setListe(d.fehlt ? [] : d.liste)
  }
  useEffect(() => { laden() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [displayName])
  if (!liste || !liste.length) return null

  const offen = liste.filter(s => statusVon(s) !== 'gepostet')
  const gepostet = liste.filter(s => statusVon(s) === 'gepostet')
  const zuDrehen = liste.filter(s => statusVon(s) === 'freigegeben').length

  return (
    <div data-help="drehzettel" style={{ ...cardS, padding: '14px 15px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 22 }}>🎬</span>
        <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>Drehzettel</span>
        {HelpDot && <HelpDot topic="drehzettel" />}
        {zuDrehen > 0 && <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: 'rgba(245,158,11,0.15)', color: 'var(--ton-amber)' }}>{zuDrehen} zu drehen</span>}
      </div>
      {offen.map(s => <Zeile key={s.id + ':' + s.aktualisiert_am} s={s} name={displayName} logActivity={logActivity} onNeu={laden} isPreview={isPreview} />)}
      {!offen.length && <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Alles gedreht und gepostet. Danke! 💛</div>}
      {gepostet.length > 0 && (
        <>
          <button type="button" onClick={() => setAlleGepostet(v => !v)} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit' }}>
            {alleGepostet ? 'Gepostete ausblenden' : `${gepostet.length} gepostet anzeigen`}
          </button>
          {alleGepostet && gepostet.map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: R, fontFamily: 'ui-monospace, monospace' }}>{s.nr}</span>
              <span style={{ flex: 1, color: 'var(--text-primary)', minWidth: 0 }}>{s.titel}</span>
              <a href={s.reel_url} target="_blank" rel="noreferrer" style={{ color: '#10b981', fontWeight: 700 }}>Reel</a>
              <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{tagKurz(s.gepostet_am)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
