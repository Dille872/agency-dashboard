import React, { useEffect, useState } from 'react'
import { STATUS, statusVon, skripteLaden, skriptAendern, linkOk, mitHttps, tagKurz, modusSetzen, postetModel, cutterLaden, hatCutter, accountName } from '../reelSkripte'
import { VideoBild, VideoHochladen, VideoLink } from './VideoLink' // v5.7.0
import { istSpeicher } from '../videoSpeicher'

// ── Model-Portal: Drehzettel (v4.101.0) ────────────────────────────────────
// Liste der Reel-Skripte des Models. Pro Skript: Drehzettel (PDF) öffnen,
// nach dem Drehen den LINK zum Video einfügen (Dropbox, Google Drive,
// WeTransfer …). Keine Videodatei im Dashboard — so bleibt die volle Qualität
// und große Dateien brechen nicht ab. Posten macht die Agentur.
// v5.7.0: Standard ist jetzt „🎬 Video hochladen“ direkt ins Dashboard
// (eigener Speicher, mit Vorschaubild). Link einfügen bleibt als Ausweg.
// Erscheint nur, wenn es mindestens ein Skript gibt. Sitzt seit v4.102.0 im
// Bereich „Social“ (nicht mehr im Board) und zeigt den Ziel-Account.

const R = '#06b6d4'
const feld = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '10px 11px', borderRadius: 11, fontSize: 15, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }

// v4.108.0: Pro Account unterschiedlich —
//   Model postet selbst → nur Reel-Link eintragen (kein Video, kein Schnitt, keine Freigabe)
//   Account mit Cutter  → „Rohmaterial reicht, wir schneiden“
//   sonst               → „Bitte fertig geschnitten hochladen“
// v5.14.0: zugeklappt nur Kopfzeile + Account; antippen klappt auf/zu
function Zeile({ s, name, logActivity, onNeu, isPreview, notizen = {}, auf = true, onKlapp, service = null }) {
  const ziel = accountName(service, s.ziel_account)   // v5.20.0: Platzhalter mit Namen
  const selbst = postetModel(s)
  const [reel, setReel] = useState('')
  const [datum, setDatum] = useState(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }))
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

  // v5.7.0: Video im eigenen Speicher hochgeladen → wie ein Link eintragen
  const hochgeladen = async (v) => {
    const err = await skriptAendern(s.id, { video_link: v, video_am: new Date().toISOString(), video_von: name })
    if (err) return err
    try { await logActivity?.('Video hochgeladen', 'reels', `${s.nr} ${s.titel}`) } catch { /* nur Hinweis */ }
    setEdit(false); onNeu()
    return null
  }

  const gepostetSpeichern = async () => {
    const r = mitHttps(reel)
    if (!linkOk(r) || !/instagram\.com\//i.test(r)) { setFehler('Bitte den Instagram-Link zu deinem Reel einfügen (in Instagram: ⋯ → Link kopieren).'); return }
    setArbeitet(true); setFehler('')
    const err = await skriptAendern(s.id, { reel_url: r, account: s.ziel_account, gepostet_am: datum, gepostet_von: name })
    setArbeitet(false)
    if (err) { setFehler('Nicht gespeichert: ' + err.message); return }
    try { await logActivity?.('Reel gepostet', 'reels', `${s.nr} ${s.titel}`) } catch { /* nur Hinweis */ }
    setEdit(false); onNeu()
  }
  const hinweis = selbst ? 'Du drehst, schneidest und postest selbst. Danach hier nur den Link zum Reel einfügen.'
    : hatCutter(s) ? 'Rohmaterial reicht, wir schneiden das Video.'
    : 'Bitte das fertig geschnittene Video hochladen.'

  return (
    <div style={{ border: `1px solid ${status === 'freigegeben' ? 'rgba(245,158,11,0.45)' : 'var(--border)'}`, borderRadius: 14, padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div onClick={onKlapp} role="button" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: onKlapp ? 'pointer' : 'default' }}>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: R, fontFamily: 'ui-monospace, monospace' }}>{s.nr}</span>
        <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>{s.titel}</span>
        <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: st.f + '22', color: st.f, whiteSpace: 'nowrap' }}>{status === 'freigegeben' ? 'zu drehen' : st.t}</span>
        {onKlapp && <span style={{ color: 'var(--text-muted)', fontSize: 13, width: 14, textAlign: 'center', transform: auf ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>›</span>}
      </div>
      {!auf && s.ziel_account && status !== 'gepostet' && (
        <div onClick={onKlapp} style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -4, cursor: 'pointer' }}>für <b style={{ color: '#ec4899' }}>{ziel}</b></div>
      )}
      {auf && <>
      {s.ziel_account && status !== 'gepostet' && (
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', background: 'var(--bg-card2)', borderRadius: 10, padding: '7px 9px' }}>
          Für <b style={{ color: '#ec4899' }}>{ziel}</b>{notizen[s.ziel_account] ? ` · ${notizen[s.ziel_account]}` : ''}
          {status === 'freigegeben' && <div style={{ marginTop: 3, fontWeight: 700, color: 'var(--text-primary)' }}>{selbst ? '📱 ' : hatCutter(s) ? '✂️ ' : '🎬 '}{hinweis}</div>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {s.drehzettel_url && <a href={s.drehzettel_url} target="_blank" rel="noreferrer" style={{ fontSize: 13.5, fontWeight: 700, color: R, padding: '8px 12px', borderRadius: 11, border: `1px solid ${R}`, textDecoration: 'none' }}>📄 Drehzettel öffnen</a>}
        {s.video_link && !edit && status !== 'freigegeben' && (
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {istSpeicher(s.video_link) && <VideoLink href={s.video_link} bild style={{ color: 'var(--text-muted)' }}>ansehen</VideoLink>}
            ✓ {istSpeicher(s.video_link) ? 'Video hochgeladen' : 'Video-Link hinterlegt'} {tagKurz(s.video_am)}
            {status !== 'gepostet' && !isPreview && <> · <button type="button" onClick={() => setEdit(true)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit' }}>ändern</button></>}
          </span>
        )}
      </div>
      {/* v4.106.0: vom Team zurückgegeben → nochmal drehen */}
      {status === 'freigegeben' && s.zurueck_an === 'model' && s.zurueck_notiz && (
        <div style={{ fontSize: 13, color: 'var(--text-primary)', background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.45)', borderRadius: 11, padding: '8px 10px', lineHeight: 1.45 }}>
          ↩ <b style={{ color: '#f97316' }}>Bitte nochmal drehen:</b> {s.zurueck_notiz}
        </div>
      )}
      {/* v5.7.0: Video direkt hochladen (Link einfügen nur noch als Ausweg) */}
      {status === 'freigegeben' && !edit && !selbst && (
        <>
          <VideoHochladen skriptId={s.id} art="roh" onFertig={hochgeladen} farbe={R} text="🎬 Video fertig? Hochladen"
            gesperrt={isPreview} gesperrtText="Vorschau: nur das Model selbst kann hier hochladen" />
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: -2 }}>
            {hinweis} In voller Qualität aus der Galerie wählen, nicht über WhatsApp.
            {/* v5.9.1: Link nur noch für Rohmaterial an den Cutter */}
            {!isPreview && hatCutter(s) && <> · <button type="button" onClick={() => setEdit(true)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit' }}>viele Clips? Link einfügen</button></>}
          </div>
        </>
      )}
      {status === 'freigegeben' && !edit && selbst && (
        // v4.108.1: in der Admin-Vorschau sichtbar, aber ausgegraut
        <button type="button" disabled={isPreview} onClick={() => { if (!isPreview) setEdit(true) }} title={isPreview ? 'Vorschau: nur das Model selbst kann hier eintragen' : undefined}
          style={{ padding: '10px 12px', borderRadius: 11, border: 'none', background: selbst ? '#10b981' : R, color: '#04212a', fontSize: 14, fontWeight: 800, cursor: isPreview ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: isPreview ? 0.45 : 1 }}>📱 Gepostet? Reel-Link einfügen</button>
      )}
      {isPreview && status === 'freigegeben' && !edit && (
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: -4 }}>Vorschau: Diesen Knopf kann nur das Model selbst benutzen.</div>
      )}
      {edit && selbst && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input autoFocus value={reel} onChange={e => setReel(e.target.value.slice(0, 500))} placeholder="https://www.instagram.com/reel/…" style={feld} inputMode="url" autoCapitalize="none" autoCorrect="off" />
          <input type="date" value={datum} onChange={e => setDatum(e.target.value)} style={feld} />
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>In Instagram beim Reel auf „⋯“ → „Link kopieren“, dann hier einfügen. Bitte auf {s.ziel_account || 'dem richtigen Account'} posten.</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" disabled={arbeitet} onClick={gepostetSpeichern} style={{ flex: 1, padding: 10, borderRadius: 11, border: 'none', background: '#10b981', color: '#04140e', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>{arbeitet ? 'Speichert …' : 'Gepostet ✓'}</button>
            <button type="button" onClick={() => { setEdit(false); setReel(''); setFehler('') }} style={{ padding: '10px 14px', borderRadius: 11, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Abbrechen</button>
          </div>
        </div>
      )}
      {edit && !selbst && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {status !== 'freigegeben' && <VideoHochladen skriptId={s.id} art="roh" onFertig={hochgeladen} farbe={R} text="🎬 Neues Video hochladen" />}
          {status !== 'freigegeben' && hatCutter(s) && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>oder (viele Rohclips) einen Link einfügen:</div>}
          {hatCutter(s) && <>
          <input autoFocus value={link} onChange={e => setLink(e.target.value.slice(0, 500))} placeholder="https://www.dropbox.com/…" style={feld} inputMode="url" autoCapitalize="none" autoCorrect="off" />
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>Nur für Rohmaterial mit vielen Clips: Ordner in Dropbox (oder Google Drive, WeTransfer) teilen, „Link kopieren“ und hier einfügen. Ein einzelnes Video bitte oben hochladen.</div>
          </>}
          <div style={{ display: 'flex', gap: 6 }}>
            {hatCutter(s) && <button type="button" disabled={arbeitet} onClick={speichern} style={{ flex: 1, padding: 10, borderRadius: 11, border: 'none', background: R, color: '#04212a', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>{arbeitet ? 'Speichert …' : 'Speichern'}</button>}
            <button type="button" onClick={() => { setEdit(false); setLink(s.video_link || ''); setFehler('') }} style={{ padding: '10px 14px', borderRadius: 11, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Abbrechen</button>
          </div>
        </div>
      )}
      {fehler && <div role="alert" style={{ fontSize: 12.5, color: 'var(--ton-rot)' }}>{fehler}</div>}
      </>}
    </div>
  )
}

// v5.26.0: imReiter → im Social-Reiter ohne Einklappen, gruppiert nach „Zu drehen“ / „In Arbeit“;
// onZahl(n) meldet, wie viele Skripte zu drehen sind (für die Zahl am Reiter)
export default function ModelDrehzettel({ displayName, logActivity, isPreview, cardS = {}, HelpDot, notizen = {}, service = null, leerText = '', imReiter = false, onZahl = null }) {
  const [liste, setListe] = useState(null)
  const [alleGepostet, setAlleGepostet] = useState(false)
  // v5.14.0: aufklappbar. null = Standard (erstes „zu drehen“ offen), sonst die offene Skript-ID ('' = alle zu)
  const [offenId, setOffenId] = useState(null)
  const [zu, setZu] = useState(false)   // ganze Karte eingeklappt
  const laden = async () => {
    if (!displayName) return
    modusSetzen(service ? [service] : [])   // v4.108.0: postet das Model selbst?
    await cutterLaden()                      // v4.108.0: hat der Account einen Cutter?
    const d = await skripteLaden(displayName, { mitVerworfenen: false })
    setListe(d.fehlt ? [] : d.liste)
  }
  useEffect(() => {
    if (liste && onZahl) onZahl(liste.filter(s => statusVon(s) === 'freigegeben').length)
  }, [liste]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { laden() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [displayName, JSON.stringify(service?.account_modus || {})])
  if (!liste) return null
  if (!liste.length) {
    if (!leerText) return null
    return (
      <div data-help="drehzettel" style={{ ...cardS, padding: '14px 15px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 22 }}>🎬</span>
        <span style={{ fontSize: 13, color: 'var(--text-muted)', flex: 1 }}>{leerText}</span>
        {HelpDot && <HelpDot topic="drehzettel" />}
      </div>
    )
  }

  const offen = liste.filter(s => statusVon(s) !== 'gepostet')
  const gepostet = liste.filter(s => statusVon(s) === 'gepostet')
  const zuDrehen = liste.filter(s => statusVon(s) === 'freigegeben').length
  const standardOffen = (offen.find(s => statusVon(s) === 'freigegeben') || offen[0])?.id
  const aktiv = offenId === null ? standardOffen : offenId
  const gruppen = [
    { t: 'Zu drehen', l: offen.filter(s => statusVon(s) === 'freigegeben') },
    { t: 'In Arbeit', l: offen.filter(s => statusVon(s) !== 'freigegeben') },
  ].filter(g => g.l.length)

  return (
    <div data-help="drehzettel" style={{ ...cardS, padding: '14px 15px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 22 }}>🎬</span>
        <span onClick={() => { if (!imReiter) setZu(z => !z) }} style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)', flex: 1, cursor: imReiter ? 'default' : 'pointer' }}>Drehzettel{zu && !imReiter ? ` (${offen.length})` : ''}</span>
        {HelpDot && <HelpDot topic="drehzettel" />}
        {zuDrehen > 0 && <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: 'rgba(245,158,11,0.15)', color: 'var(--ton-amber)' }}>{zuDrehen} zu drehen</span>}
        {!imReiter && <button type="button" onClick={() => setZu(z => !z)} title={zu ? 'Aufklappen' : 'Einklappen'}
          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: '3px 8px', fontFamily: 'inherit' }}>{zu ? '▾' : '▴'}</button>}
      </div>
      {zu && !imReiter ? null : <>
      {(imReiter ? gruppen : [{ t: null, l: offen }]).map(g => (
        <React.Fragment key={g.t || 'alle'}>
          {g.t && <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-muted)', marginTop: 2 }}>{g.t} ({g.l.length})</div>}
          {g.l.map(s => <Zeile key={s.id + ':' + s.aktualisiert_am} s={s} name={displayName} logActivity={logActivity} onNeu={laden} isPreview={isPreview} notizen={notizen} service={service}
            auf={aktiv === s.id} onKlapp={() => setOffenId(aktiv === s.id ? '' : s.id)} />)}
        </React.Fragment>
      ))}
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
      </>}
    </div>
  )
}
