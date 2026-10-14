import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Upload, ImagePlus, Check, Circle, X, Play, Clapperboard, ListChecks, Unlink } from 'lucide-react'
import { supabase } from '../supabase'
import { skripteLaden, skriptAendern, statusVon, videoGilt, modusSetzen, postetModel, tagKurz, accountName } from '../reelSkripte'
import { videoHochladen, planDateiHochladen, inSkriptKopieren, istVideoDatei, istFotoDatei, istBild } from '../videoSpeicher'
import { VideoBild } from './VideoLink'

// ── Model-Portal: mehrere Videos auf einmal (v5.47.0) ──────────────────────
// Wunsch Chris (14.10.): Models drehen oft mehrere Reels am Stück.
//  1. „Videos hochladen“: mehrere Videos aus der Galerie wählen. Pro Video ein
//     kleines Vorschaubild und eine Auswahl aus den offenen Drehzetteln
//     (S-Nummer + Titel). Kein Raten über Dateinamen (IMG_1234.mov).
//  2. Ohne Auswahl wird das Video trotzdem gespeichert, als „ohne Skript“ in
//     der Content-Ablage (social_material, notiz = OHNE_SKRIPT). Es lässt sich
//     unten unter „Noch keinem Skript zugeordnet“ später zuordnen.
//  3. Liste mit Haken: welche Skripte gedreht sind und welche noch offen.
//  4. „Stories hochladen“: mehrere Fotos/Videos als Story (ohne Skript).
// Gespeichert wird beim Skript genau wie beim Einzel-Upload (video_link,
// video_am, video_von) → lyra.reel_skripte.gedreht_am bleibt richtig.

const R = '#06b6d4'
const P = '#ec4899'
const V = '#8b5cf6'
export const OHNE_SKRIPT = 'Ohne Skript hochgeladen. Bitte einem Drehzettel zuordnen.'

const knopf = (farbe, voll = true) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 12px', borderRadius: 11,
  border: `1px solid ${farbe}`, background: voll ? farbe : 'transparent', color: voll ? '#fff' : farbe,
  fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
})
const auswahlS = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '8px 9px', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', width: '100%', minWidth: 0, boxSizing: 'border-box' }
const klein = { fontSize: 10.5, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-muted)' }
const jetztText = () => new Date().toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const mb = (b) => b >= 1e9 ? (b / 1e9).toFixed(1).replace('.', ',') + ' GB' : Math.max(1, Math.round(b / 1e6)) + ' MB'

// Skripte, denen das Model ein Video geben kann: zu drehen und nicht „postet selbst“
const offenFuerVideo = (s) => statusVon(s) === 'freigegeben' && !postetModel(s)
// Haken: gedreht = Video da (oder bei „postet selbst“: gepostet)
const gedreht = (s) => postetModel(s) ? !!s.reel_url : (statusVon(s) !== 'freigegeben' || videoGilt(s))
const skriptText = (s) => `${s.nr} · ${s.titel}`

// v5.49.0: Auswahl nach Account gruppiert (Sandra hat mehrere Accounts)
function SkriptOptionen({ liste, service }) {
  const gruppen = new Map()
  for (const s of liste) {
    const k = s.ziel_account || ''
    if (!gruppen.has(k)) gruppen.set(k, [])
    gruppen.get(k).push(s)
  }
  if (gruppen.size <= 1) return liste.map(s => <option key={s.id} value={String(s.id)}>{skriptText(s)}</option>)
  return [...gruppen.entries()].sort((a, b) => (a[0] === '') - (b[0] === '') || a[0].localeCompare(b[0])).map(([k, l]) => (
    <optgroup key={k || '-'} label={k ? accountName(service, k) : 'Ohne Account'}>
      {l.map(s => <option key={s.id} value={String(s.id)}>{skriptText(s)}</option>)}
    </optgroup>
  ))
}

// ── Vorschaubild einer gewählten Datei (vor dem Hochladen) ─────────────────
function DateiVorschau({ eintrag }) {
  const ref = useRef(null)
  const [spielt, setSpielt] = useState(false)
  const box = { width: 54, height: 96, borderRadius: 9, background: 'var(--bg-card2)', objectFit: 'cover', display: 'block', flexShrink: 0 }
  if (!eintrag.video) return <img src={eintrag.url} alt="" style={box} />
  const umschalten = () => {
    const v = ref.current; if (!v) return
    if (v.paused) { v.play().then(() => setSpielt(true)).catch(() => {}) } else { v.pause(); setSpielt(false) }
  }
  return (
    <span onClick={umschalten} style={{ position: 'relative', display: 'inline-block', cursor: 'pointer', flexShrink: 0 }} title="Antippen zum Abspielen">
      {/* #t=0.5 → iPhone zeigt ein Standbild statt Schwarz */}
      <video ref={ref} src={eintrag.url + '#t=0.5'} muted playsInline preload="metadata" loop style={box} />
      {!spielt && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', pointerEvents: 'none' }}><Play size={18} fill="#fff" strokeWidth={0} style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.7))' }} /></span>}
    </span>
  )
}

// ── Fenster: gewählte Dateien zuordnen und hochladen ───────────────────────
function SammelFenster({ start, modus, skripte, name, logActivity, onZu, service = null }) {
  const [liste, setListe] = useState(() => start)
  const [laeuft, setLaeuft] = useState(false)
  const [fertigText, setFertigText] = useState('')
  const story = modus === 'story'

  // Objekt-URLs beim Schließen freigeben
  useEffect(() => () => { for (const e of start) try { URL.revokeObjectURL(e.url) } catch { /* egal */ } }, [start])
  // Während des Hochladens nicht versehentlich die Seite verlassen
  useEffect(() => {
    if (!laeuft) return
    const warnen = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warnen)
    return () => window.removeEventListener('beforeunload', warnen)
  }, [laeuft])

  const setze = (id, felder) => setListe(l => l.map(e => e.id === id ? { ...e, ...felder } : e))
  const vergeben = new Set(liste.filter(e => /^\d+$/.test(e.ziel)).map(e => e.ziel))
  const offen = liste.filter(e => !e.fertig)
  const mitSkript = offen.filter(e => /^\d+$/.test(e.ziel)).length

  const hochladen = async () => {
    setLaeuft(true); setFertigText('')
    let ok = 0
    for (const e of liste) {
      if (e.fertig) continue
      setze(e.id, { stand: 0, fehler: '' })
      const fortschritt = (x) => setze(e.id, { stand: x })
      try {
        if (/^\d+$/.test(e.ziel)) {
          const s = skripte.find(x => String(x.id) === e.ziel)
          const r = await videoHochladen({ datei: e.datei, skriptId: e.ziel, art: 'roh', onFortschritt: fortschritt })
          if (r.fehler) { setze(e.id, { stand: null, fehler: r.fehler }); continue }
          const err = await skriptAendern(Number(e.ziel), { video_link: r.link, video_am: new Date().toISOString(), video_von: name })
          if (err) { setze(e.id, { stand: null, fehler: 'Hochgeladen, aber nicht gespeichert: ' + err.message }); continue }
          try { await logActivity?.('Video hochgeladen', 'reels', s ? skriptText(s) : e.ziel) } catch { /* nur Protokoll */ }
        } else {
          const r = await planDateiHochladen({ datei: e.datei, model: name, onFortschritt: fortschritt })
          if (r.fehler) { setze(e.id, { stand: null, fehler: r.fehler }); continue }
          const foto = istBild(r.link)
          const alsStory = e.ziel === 'story'
          const art = alsStory ? 'story' : (foto ? 'foto' : 'reel')
          const titel = alsStory ? `Story · ${foto ? 'Foto' : 'Video'} ${jetztText()}` : `Ohne Skript · ${foto ? 'Foto' : 'Video'} ${jetztText()}`
          const { error } = await supabase.from('social_material').insert({ model_name: name, art, titel, link: r.link, notiz: !alsStory && !foto ? OHNE_SKRIPT : null, erstellt_von: name })
          if (error) { setze(e.id, { stand: null, fehler: 'Hochgeladen, aber nicht gespeichert: ' + error.message }); continue }
          try { await logActivity?.(alsStory ? 'Story hochgeladen' : 'Video ohne Skript hochgeladen', 'reels', titel) } catch { /* nur Protokoll */ }
        }
        setze(e.id, { stand: null, fertig: true }); ok++
      } catch (x) {
        setze(e.id, { stand: null, fehler: 'Hochladen hat nicht geklappt: ' + (x?.message || x) })
      }
    }
    setLaeuft(false)
    setFertigText(ok ? `${ok} ${ok === 1 ? 'Datei' : 'Dateien'} hochgeladen.` : '')
  }

  const zu = () => {
    if (laeuft && !window.confirm('Es wird noch hochgeladen. Wirklich schließen? Was noch nicht fertig ist, fehlt dann.')) return
    onZu(liste.some(e => e.fertig))
  }
  const alleFertig = liste.length > 0 && liste.every(e => e.fertig)

  return createPortal(
    <div onClick={(e) => { if (e.target === e.currentTarget && !laeuft) zu() }}
      style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg-card)', width: '100%', maxWidth: 560, maxHeight: '92vh', borderRadius: '18px 18px 0 0', display: 'flex', flexDirection: 'column', boxShadow: '0 -8px 30px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '14px 15px 10px', borderBottom: '1px solid var(--border)' }}>
          {story ? <ImagePlus size={19} color={V} /> : <Clapperboard size={19} color={R} />}
          <b style={{ flex: 1, fontSize: 15.5, color: 'var(--text-primary)' }}>{story ? 'Stories hochladen' : 'Videos zuordnen'} ({liste.length})</b>
          <button type="button" onClick={zu} aria-label="Schließen" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex' }}><X size={20} /></button>
        </div>
        <div style={{ padding: '10px 15px', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
          {story ? 'Alles wird als Story gespeichert. Einzelne Teile kannst du auch als Beitrag ablegen.'
            : 'Wähle bei jedem Video, zu welchem Drehzettel es gehört. Antippen des Bildes spielt das Video ab. Ohne Auswahl wird es trotzdem gespeichert und du ordnest es später zu.'}
        </div>
        <div style={{ overflowY: 'auto', padding: '0 15px 10px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          {liste.map(e => (
            <div key={e.id} style={{ display: 'flex', gap: 10, alignItems: 'center', border: `1px solid ${e.fertig ? 'rgba(16,185,129,0.5)' : e.fehler ? 'rgba(239,68,68,0.5)' : 'var(--border)'}`, borderRadius: 13, padding: 8 }}>
              <DateiVorschau eintrag={e} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {e.video ? 'Video' : 'Foto'} · {mb(e.datei.size || 0)}
                </div>
                {e.fertig ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 700, color: '#10b981' }}>
                    <Check size={16} /> {/^\d+$/.test(e.ziel) ? (skripte.find(s => String(s.id) === e.ziel) ? skriptText(skripte.find(s => String(s.id) === e.ziel)) : 'hochgeladen') : e.ziel === 'story' ? 'als Story hochgeladen' : 'gespeichert, noch ohne Skript'}
                  </div>
                ) : (
                  <select value={e.ziel} disabled={laeuft} onChange={ev => setze(e.id, { ziel: ev.target.value })} style={auswahlS}>
                    {e.video && <option value="">Noch kein Skript (später zuordnen)</option>}
                    {e.video && <SkriptOptionen service={service} liste={skripte.filter(offenFuerVideo).filter(s => !vergeben.has(String(s.id)) || e.ziel === String(s.id))} />}
                    {!e.video && <option value="">Beitrag (Foto)</option>}
                    <option value="story">Story (kein Skript)</option>
                  </select>
                )}
                {e.stand != null && (
                  <div style={{ height: 6, borderRadius: 4, background: 'var(--bg-card2)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.round(e.stand * 100)}%`, height: '100%', background: e.ziel === 'story' ? V : R, transition: 'width .3s' }} />
                  </div>
                )}
                {e.fehler && <div role="alert" style={{ fontSize: 12, color: '#ef4444' }}>{e.fehler}</div>}
              </div>
              {!e.fertig && !laeuft && (
                <button type="button" onClick={() => setListe(l => l.filter(x => x.id !== e.id))} aria-label="Aus der Liste nehmen" title="Aus der Liste nehmen"
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex', alignSelf: 'flex-start' }}><X size={16} /></button>
              )}
            </div>
          ))}
        </div>
        <div style={{ padding: '10px 15px calc(14px + env(safe-area-inset-bottom, 0px))', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {laeuft && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Bitte die Seite offen lassen. Bricht das Netz ab, geht es beim nächsten Versuch an derselben Stelle weiter.</div>}
          {fertigText && <div style={{ fontSize: 13, fontWeight: 700, color: '#10b981' }}>{fertigText}</div>}
          {alleFertig ? (
            <button type="button" onClick={() => onZu(true)} style={knopf('#10b981')}><Check size={17} /> Fertig</button>
          ) : (
            <button type="button" disabled={laeuft || !offen.length} onClick={hochladen} style={{ ...knopf(story ? V : R), opacity: laeuft || !offen.length ? 0.6 : 1, cursor: laeuft ? 'not-allowed' : 'pointer' }}>
              <Upload size={17} />
              {laeuft ? 'Lädt hoch …'
                : liste.some(e => e.fehler) ? 'Nochmal versuchen'
                : story ? `${offen.length} hochladen`
                : `${offen.length} hochladen${mitSkript < offen.length ? ` (${offen.length - mitSkript} ohne Skript)` : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Ein ohne Skript hochgeladenes Video später zuordnen ────────────────────
function OhneSkriptZeile({ m, skripte, name, logActivity, isPreview, onNeu, service = null }) {
  const [ziel, setZiel] = useState('')
  const [arbeitet, setArbeitet] = useState(false)
  const [fehler, setFehler] = useState('')
  const zuordnen = async () => {
    if (!ziel) return
    setArbeitet(true); setFehler('')
    if (ziel === 'story') {
      const { error } = await supabase.from('social_material').update({ art: 'story', notiz: null, titel: String(m.titel || '').replace(/^Ohne Skript · /, 'Story · ') }).eq('id', m.id)
      setArbeitet(false)
      if (error) { setFehler('Nicht gespeichert: ' + error.message); return }
      onNeu(); return
    }
    const s = skripte.find(x => String(x.id) === ziel)
    const r = await inSkriptKopieren({ link: m.link, skriptId: ziel })
    if (r.fehler) { setArbeitet(false); setFehler(r.fehler); return }
    const err = await skriptAendern(Number(ziel), { video_link: r.link, video_am: new Date().toISOString(), video_von: name })
    if (err) { setArbeitet(false); setFehler('Nicht gespeichert: ' + err.message); return }
    // aus der Ablage nehmen, sonst steht dasselbe Video doppelt zum Einplanen da
    await supabase.from('social_material').update({ verworfen: true }).eq('id', m.id)
    try { await logActivity?.('Video zugeordnet', 'reels', s ? skriptText(s) : ziel) } catch { /* nur Protokoll */ }
    setArbeitet(false); onNeu()
  }
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 13, padding: 8 }}>
      <VideoBild href={m.link} hoehe={80} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>hochgeladen {tagKurz(m.erstellt_am)}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={ziel} disabled={arbeitet || isPreview} onChange={e => setZiel(e.target.value)} style={auswahlS}>
            <option value="">Skript wählen …</option>
            <SkriptOptionen service={service} liste={skripte.filter(offenFuerVideo)} />
            <option value="story">Ist eine Story</option>
          </select>
          <button type="button" disabled={!ziel || arbeitet || isPreview} onClick={zuordnen}
            style={{ ...knopf(R), padding: '8px 11px', fontSize: 13, opacity: !ziel || arbeitet || isPreview ? 0.5 : 1, flexShrink: 0 }}>{arbeitet ? '…' : 'Zuordnen'}</button>
        </div>
        {fehler && <div role="alert" style={{ fontSize: 12, color: '#ef4444' }}>{fehler}</div>}
      </div>
    </div>
  )
}

// ── Karte im Drehzettel-Reiter ─────────────────────────────────────────────
// stand: Zähler aus ModelSocial; ändert er sich, wird neu geladen.
// onGeaendert: meldet nach oben, dass sich Skripte geändert haben (Drehzettel neu laden).
export default function ModelSammelUpload({ displayName, logActivity, isPreview, cardS = {}, service = null, stand = 0, onGeaendert, konto = null }) {
  const [skripte, setSkripte] = useState(null)
  const [ohne, setOhne] = useState([])
  const [auswahl, setAuswahl] = useState(null)   // { modus, liste }
  const [hinweis, setHinweis] = useState('')
  const [listeAuf, setListeAuf] = useState(true)
  const inVideo = useRef(null)
  const inStory = useRef(null)

  const laden = useCallback(async () => {
    if (!displayName) return
    modusSetzen(service ? [service] : [])
    const [d, m, p] = await Promise.all([
      skripteLaden(displayName, { mitVerworfenen: false }),
      supabase.from('social_material').select('*').eq('model_name', displayName).eq('verworfen', false).eq('notiz', OHNE_SKRIPT).order('erstellt_am', { ascending: false }).limit(60),
      supabase.from('social_plan').select('material_id, video_link, frames').eq('model_name', displayName),
    ])
    setSkripte(d.fehlt ? [] : d.liste)
    // schon vom Team eingeplant → nicht mehr zum Zuordnen anbieten (sonst doppelt gepostet)
    const plan = p.error ? [] : (p.data || [])
    const ids = new Set(plan.map(z => z.material_id).filter(Boolean))
    const links = plan.map(z => (z.video_link || '') + ' ' + JSON.stringify(z.frames || '')).join(' ')
    setOhne((m.error ? [] : (m.data || [])).filter(x => x.link && !ids.has(x.id) && !links.includes(x.link)))
  }, [displayName, service])
  useEffect(() => { laden() }, [laden, stand])

  const geaendert = () => { if (onGeaendert) onGeaendert(); else laden() }

  const gewaehlt = (dateien, modus) => {
    const roh = [...(dateien || [])]
    const ok = roh.filter(d => modus === 'story' ? (istVideoDatei(d) || istFotoDatei(d)) : istVideoDatei(d))
    setHinweis(roh.length > ok.length ? `${roh.length - ok.length} ${roh.length - ok.length === 1 ? 'Datei passt' : 'Dateien passen'} nicht und ${roh.length - ok.length === 1 ? 'wurde' : 'wurden'} weggelassen.` : '')
    if (!ok.length) return
    setAuswahl({
      modus,
      liste: ok.map((datei, i) => ({ id: `${Date.now()}-${i}`, datei, video: istVideoDatei(datei), url: URL.createObjectURL(datei), ziel: modus === 'story' ? 'story' : '', stand: null, fehler: '', fertig: false })),
    })
  }

  if (skripte === null) return null
  // v5.49.0: Überblick nur für den gewählten Account-Reiter
  const imKonto = konto === null ? skripte : skripte.filter(s => (s.ziel_account || '') === konto)
  const aktiv = imKonto.filter(s => statusVon(s) !== 'gepostet')
  const gepostetN = imKonto.length - aktiv.length
  const gedrehtN = aktiv.filter(gedreht).length
  const offenN = skripte.filter(offenFuerVideo).length

  return (
    <div data-help="drehzettel" style={{ ...cardS, padding: '14px 15px', display: 'flex', flexDirection: 'column', gap: 11 }}>
      {/* Hochladen */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Upload size={19} color={R} />
          <b style={{ flex: 1, fontSize: 14.5, color: 'var(--text-primary)' }}>Mehrere auf einmal hochladen</b>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>
          Mehrere Reels gedreht? Alle auf einmal aus der Galerie wählen und danach jedem Video seinen Drehzettel geben. In voller Qualität, nicht über WhatsApp.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input ref={inVideo} type="file" accept="video/*" multiple hidden onChange={e => { const d = e.target.files; gewaehlt(d, 'video'); e.target.value = '' }} />
        <input ref={inStory} type="file" accept="image/*,video/*" multiple hidden onChange={e => { const d = e.target.files; gewaehlt(d, 'story'); e.target.value = '' }} />
        <button type="button" disabled={isPreview} onClick={() => inVideo.current?.click()} title={isPreview ? 'Vorschau: nur das Model selbst kann hochladen' : undefined}
          style={{ ...knopf(R), flex: '1 1 160px', opacity: isPreview ? 0.45 : 1, cursor: isPreview ? 'not-allowed' : 'pointer' }}>
          <Clapperboard size={17} /> Videos hochladen
        </button>
        <button type="button" disabled={isPreview} onClick={() => inStory.current?.click()} title={isPreview ? 'Vorschau: nur das Model selbst kann hochladen' : undefined}
          style={{ ...knopf(V, false), flex: '1 1 160px', opacity: isPreview ? 0.45 : 1, cursor: isPreview ? 'not-allowed' : 'pointer' }}>
          <ImagePlus size={17} /> Stories hochladen
        </button>
      </div>
      {hinweis && <div style={{ fontSize: 12, color: 'var(--ton-amber, #f59e0b)' }}>{hinweis}</div>}

      {/* Ohne Skript */}
      {ohne.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ ...klein, display: 'flex', alignItems: 'center', gap: 6 }}><Unlink size={13} /> Noch keinem Skript zugeordnet ({ohne.length})</div>
          {ohne.map(m => <OhneSkriptZeile key={m.id} m={m} skripte={skripte} name={displayName} logActivity={logActivity} isPreview={isPreview} onNeu={geaendert} service={service} />)}
          {!offenN && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Gerade ist kein Drehzettel offen. Die Videos bleiben gespeichert.</div>}
        </div>
      )}

      {/* Liste mit Haken */}
      {aktiv.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <button type="button" onClick={() => setListeAuf(v => !v)} style={{ ...klein, display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
            <ListChecks size={13} /> Überblick · {gedrehtN} von {aktiv.length} gedreht
            <span style={{ marginLeft: 'auto', transform: listeAuf ? 'rotate(90deg)' : 'none', transition: 'transform .15s', fontSize: 13 }}>›</span>
          </button>
          {listeAuf && aktiv.map(s => {
            const ja = gedreht(s)
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, padding: '4px 0' }}>
                {ja ? <Check size={17} color="#10b981" strokeWidth={3} style={{ flexShrink: 0 }} /> : <Circle size={17} color="var(--text-muted)" style={{ flexShrink: 0 }} />}
                <span style={{ fontSize: 11.5, fontWeight: 800, color: R, fontFamily: 'ui-monospace, monospace', flexShrink: 0 }}>{s.nr}</span>
                <span style={{ flex: 1, minWidth: 0, color: ja ? 'var(--text-muted)' : 'var(--text-primary)', fontWeight: ja ? 500 : 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.titel}</span>
                <span style={{ fontSize: 11.5, color: ja ? '#10b981' : 'var(--ton-amber, #f59e0b)', whiteSpace: 'nowrap' }}>{ja ? (s.video_am ? `gedreht ${tagKurz(s.video_am)}` : 'gedreht') : 'offen'}</span>
              </div>
            )
          })}
          {gepostetN > 0 && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Dazu {gepostetN} schon gepostet.</div>}
        </div>
      )}

      {auswahl && <SammelFenster start={auswahl.liste} modus={auswahl.modus} skripte={skripte} name={displayName} logActivity={logActivity} service={service}
        onZu={(neu) => { setAuswahl(null); if (neu) geaendert() }} />}
    </div>
  )
}
