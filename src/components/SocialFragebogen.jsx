import React, { useEffect, useRef, useState } from 'react'
import { MImg, MA } from './Medien' // v5.33.0: private Dateien
import { supabase } from '../supabase'
import { FRAGEN, BOARD_CHECK, hatWert, antwortenSpeichern, serviceSpeichern, fotoHochladen, datumKurz } from '../socialProfil'
import { resolvePlatform, SOCIAL_CATEGORY } from './SocialLinks'

// ── Social-Media-Fragebogen ausfüllen (v4.100.0) ───────────────────────────
// Vollbild über dem Model-Portal (oder im Admin zum Nachtragen), eine Seite,
// ca. 10 Minuten. Automatisch gespeichert: 1,5 s nach dem Tippen, und zwar
// nur die geänderten Antworten — jede mit eigenem Zeitpunkt.
//
//   art='model'  Model selbst. Erste Eingabe → Status 'laeuft',
//                „Fertig“ → Status 'fertig'. Danach jederzeit änderbar.
//   art='admin'  Agentur trägt nach. Status bleibt, wie er ist.
//
// No Gos, Einschränkungen und Instagram werden NICHT gefragt, sondern aus dem
// Board angezeigt („Stimmt das noch?“) — geändert wird im Board.

const O = '#ec4899'
const lbl = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6, display: 'block' }
const feld = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '11px 12px', borderRadius: 12, fontSize: 15, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }
const chip = (an) => ({
  fontSize: 13.5, padding: '8px 13px', borderRadius: 20, fontWeight: an ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit',
  background: an ? 'rgba(236,72,153,0.16)' : 'transparent', border: `1px solid ${an ? O : 'var(--border)'}`, color: an ? O : 'var(--text-secondary)',
})

function Chips({ f, wert, setWert }) {
  const [eigen, setEigen] = useState(null)
  const liste = Array.isArray(wert) ? wert : []
  const eigene = liste.filter(x => !f.optionen.includes(x))
  const an = (o) => liste.includes(o)
  const uebernehmen = () => {
    const t = (eigen || '').trim()
    if (t && !liste.includes(t)) setWert([...liste, t])
    setEigen(null)
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {[...f.optionen, ...eigene].map(o => (
        <button key={o} type="button" className="chip-btn" onClick={() => setWert(an(o) ? liste.filter(x => x !== o) : [...liste, o])} style={chip(an(o))}>{an(o) ? '✓ ' : ''}{o}</button>
      ))}
      {eigen === null
        ? <button type="button" className="chip-btn" onClick={() => setEigen('')} style={{ ...chip(false), borderStyle: 'dashed', color: 'var(--ton-lila)' }}>+ eigenes</button>
        : (
          <span style={{ display: 'flex', gap: 6, flex: '1 1 200px' }}>
            <input autoFocus value={eigen} onChange={e => setEigen(e.target.value.slice(0, 60))} onKeyDown={e => { if (e.key === 'Enter') uebernehmen(); if (e.key === 'Escape') setEigen(null) }}
              placeholder="eigene Antwort" className="einf-feld" style={{ ...feld, padding: '8px 11px', fontSize: 14 }} />
            <button type="button" className="chip-btn" onClick={uebernehmen} style={{ ...chip(true), flexShrink: 0 }}>OK</button>
          </span>
        )}
    </div>
  )
}

function Bilder({ f, wert, setWert, name }) {
  const liste = Array.isArray(wert) ? wert : []
  const [laedt, setLaedt] = useState(false)
  const [fehler, setFehler] = useState('')
  const input = useRef(null)
  const hinzu = async (files) => {
    const frei = Math.max(0, (f.max || 4) - liste.length)
    const auswahl = [...(files || [])].slice(0, frei)
    if (!auswahl.length) return
    setLaedt(true); setFehler('')
    const neu = []
    for (const file of auswahl) {
      const r = await fotoHochladen(name, file)
      if (r.url) neu.push(r.url)
      else setFehler('Ein Foto ging nicht hoch: ' + (r.fehler?.message || 'unbekannt'))
    }
    setLaedt(false)
    if (neu.length) setWert([...liste, ...neu])
  }
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {liste.map(url => (
          <div key={url} style={{ position: 'relative', width: 88, height: 88, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
            <MA href={url} target="_blank" rel="noreferrer"><MImg src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></MA>
            <button type="button" aria-label="Foto entfernen" onClick={() => window.confirm('Foto aus dem Fragebogen entfernen?') && setWert(liste.filter(x => x !== url))}
              style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12, border: 'none', background: 'rgba(0,0,0,0.65)', color: '#fff', cursor: 'pointer', fontSize: 13, lineHeight: '24px', padding: 0 }}>✕</button>
          </div>
        ))}
        {liste.length < (f.max || 4) && (
          <button type="button" disabled={laedt} onClick={() => input.current?.click()}
            style={{ width: 88, height: 88, borderRadius: 12, border: '1px dashed var(--border)', background: 'transparent', color: 'var(--ton-lila)', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit' }}>
            {laedt ? 'Lädt …' : '+ Foto'}
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={e => { hinzu(e.target.files); e.target.value = '' }} />
      {fehler && <div style={{ fontSize: 12, color: 'var(--ton-rot)', marginTop: 6 }}>{fehler}</div>}
    </div>
  )
}

function Mehrfach({ f, wert, setWert }) {
  const liste = Array.from({ length: f.anzahl || 3 }, (_, i) => (Array.isArray(wert) ? wert[i] : '') || '')
  const setze = (i, v) => { const n = [...liste]; n[i] = v.slice(0, 300); setWert(n) }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {liste.map((v, i) => (
        <input key={i} value={v} onChange={e => setze(i, e.target.value)} placeholder={f.ph || ''} className="einf-feld"
          inputMode={f.typ === 'links' ? 'url' : 'text'} autoCapitalize="none" autoCorrect="off" style={feld} />
      ))}
    </div>
  )
}

function Skala({ f, wert, setWert }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 6 }}>
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} type="button" className="chip-btn" onClick={() => setWert(wert === n ? null : n)}
            style={{ ...chip(wert === n), flex: 1, borderRadius: 12, padding: '10px 0', fontSize: 15 }}>{n}</button>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
        <span>1 = {f.unten}</span><span>5 = {f.oben}</span>
      </div>
    </div>
  )
}

function Frage({ f, wert, setWert, geaendert, name }) {
  let inhalt
  if (f.typ === 'multi') inhalt = <Chips f={f} wert={wert} setWert={setWert} />
  else if (f.typ === 'bilder') inhalt = <Bilder f={f} wert={wert} setWert={setWert} name={name} />
  else if (f.typ === 'links' || f.typ === 'handles') inhalt = <Mehrfach f={f} wert={wert} setWert={setWert} />
  else if (f.typ === 'skala') inhalt = <Skala f={f} wert={wert} setWert={setWert} />
  else {
    const Tag = f.typ === 'lang' ? 'textarea' : 'input'
    inhalt = <Tag value={wert || ''} onChange={e => setWert(e.target.value.slice(0, f.typ === 'lang' ? 1000 : 200))} placeholder={f.ph || ''}
      rows={f.typ === 'lang' ? 3 : undefined} className="einf-feld" style={{ ...feld, ...(f.typ === 'lang' ? { resize: 'vertical', lineHeight: 1.45 } : {}) }} />
  }
  return (
    <div>
      <span style={lbl}>{f.label}</span>
      {inhalt}
      {f.tipp && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>{f.tipp}</div>}
      {geaendert && <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4, opacity: 0.8 }}>zuletzt geändert {datumKurz(geaendert)}</div>}
    </div>
  )
}

function BoardListe({ titel, eintraege, farbe, leer }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: farbe, marginBottom: 4 }}>{titel}</div>
      {eintraege.length
        ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{eintraege.map((t, i) => <span key={i} style={{ fontSize: 12.5, padding: '4px 10px', borderRadius: 14, background: farbe + '1f', color: 'var(--text-primary)' }}>{t}</span>)}</div>
        : <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{leer}</div>}
    </div>
  )
}

export default function SocialFragebogen({ name, daten, art = 'model', wer, logActivity, onGespeichert, onZu }) {
  const start = Object.fromEntries(Object.entries(daten?.antworten || {}).map(([k, z]) => [k, z.antwort]))
  const [werte, setWerte] = useState(start)
  const [geaendert, setGeaendert] = useState(() => Object.fromEntries(Object.entries(daten?.antworten || {}).map(([k, z]) => [k, z.geaendert_am])))
  const [board, setBoard] = useState(null)
  const [speichert, setSpeichert] = useState(false)
  const [gespeichertUm, setGespeichertUm] = useState(null)
  const [hinweis, setHinweis] = useState('')
  const schmutzig = useRef(new Set())
  const timer = useRef(null)
  const status = daten?.service?.fragebogen_status || null

  // Board-Daten nur anzeigen (No Gos, Einschränkungen, Instagram)
  useEffect(() => {
    supabase.from('model_board').select('category, title, content').eq('model_name', name)
      .in('category', ['nogos', 'einschraenkungen', SOCIAL_CATEGORY]).order('sort_order')
      .then(({ data }) => {
        const d = data || []
        setBoard({
          nogos: d.filter(x => x.category === 'nogos').map(x => x.title),
          einschraenkungen: d.filter(x => x.category === 'einschraenkungen').map(x => [x.title, x.content].filter(Boolean).join(': ')),
          instagram: d.filter(x => x.category === SOCIAL_CATEGORY && resolvePlatform(x.title).key === 'instagram').map(x => x.content),
        })
      })
  }, [name])

  const speichern = async (extraService) => {
    clearTimeout(timer.current)
    const keys = [...schmutzig.current]
    if (!keys.length && !extraService) return true
    setSpeichert(true)
    const aenderung = Object.fromEntries(keys.map(k => [k, werte[k]]))
    const fehler = await antwortenSpeichern(name, aenderung, wer)
    let fehler2 = null
    if (!fehler && art === 'model') {
      const felder = extraService || (status === 'fertig' || status === 'laeuft' ? null : { fragebogen_status: 'laeuft' })
      if (felder) fehler2 = await serviceSpeichern(name, felder, wer)
    }
    setSpeichert(false)
    if (fehler || fehler2) { setHinweis('Nicht gespeichert: ' + (fehler || fehler2).message); return false }
    keys.forEach(k => schmutzig.current.delete(k))
    const jetzt = new Date().toISOString()
    setGeaendert(g => ({ ...g, ...Object.fromEntries(keys.map(k => [k, jetzt])) }))
    setGespeichertUm(new Date())
    onGespeichert?.()
    return true
  }

  useEffect(() => {
    if (!schmutzig.current.size) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => speichern(), 1500)
    return () => clearTimeout(timer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [werte])

  const setze = (key, wert) => { schmutzig.current.add(key); setHinweis(''); setWerte(w => ({ ...w, [key]: wert })) }

  const fertig = async () => {
    const leer = FRAGEN.filter(f => f.key !== 'drehorte_fotos' && !hatWert(werte[f.key]))
    if (art === 'model' && leer.length > 4 && !window.confirm(`Noch ${leer.length} Fragen offen. Trotzdem abschließen? Du kannst später jederzeit ergänzen.`)) return
    if (art === 'model') {
      const ok = await speichern(status === 'fertig' ? null : { fragebogen_status: 'fertig', fertig_am: new Date().toISOString() })
      if (!ok) return
      try { await logActivity?.(status === 'fertig' ? 'bearbeitet' : 'abgeschlossen', 'Social Media', 'Fragebogen Social Media') } catch { /* nur Hinweis */ }
    } else {
      const ok = await speichern()
      if (!ok) return
    }
    onZu?.(true)
  }

  const schliessen = async () => { await speichern(); onZu?.(false) }

  return (
    <div role="dialog" aria-label="Social-Media-Fragebogen" className="einfuehrung" style={{ position: 'fixed', inset: 0, zIndex: 100001, background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-card)', flexShrink: 0 }}>
        <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: O }}>
              Social Media{art === 'admin' ? ` · ${name}` : ''}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {speichert ? 'Speichert …' : gespeichertUm ? `✓ gespeichert ${gespeichertUm.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : 'Wird automatisch gespeichert'}
            </div>
          </div>
          <button type="button" onClick={schliessen} className="einf-klein" style={{ padding: '8px 12px', borderRadius: 11, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            {art === 'model' && status !== 'fertig' ? 'Später weitermachen' : 'Schließen'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 16px 24px' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <div style={{ fontSize: 23, fontWeight: 800, color: 'var(--text-primary)' }}>📱 Deine Reels</div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.55 }}>
              Damit wir Reel-Ideen schreiben, die zu dir passen. Dauert etwa 10 Minuten, alles ist freiwillig und du kannst es später jederzeit ändern.
              Das bleibt im Team, Fans und Chatter sehen es nicht.
            </div>
          </div>

          {/* Stimmt das noch? — aus dem Board */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 15px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)' }}>Das wissen wir schon aus deinem Board</div>
            {!board ? <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Lädt …</div> : (
              <>
                <BoardListe titel="No Gos" farbe="#ef4444" eintraege={board.nogos} leer="noch keine eingetragen" />
                <BoardListe titel="Einschränkungen" farbe="#06b6d4" eintraege={board.einschraenkungen} leer="keine" />
                <BoardListe titel="Instagram" farbe={O} eintraege={board.instagram} leer="kein Instagram-Link im Board" />
              </>
            )}
            <div>
              <span style={lbl}>Stimmt das noch?</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {BOARD_CHECK.optionen.map(o => (
                  <button key={o} type="button" className="chip-btn" onClick={() => setze(BOARD_CHECK.key, werte[BOARD_CHECK.key] === o ? null : o)} style={chip(werte[BOARD_CHECK.key] === o)}>{werte[BOARD_CHECK.key] === o ? '✓ ' : ''}{o}</button>
                ))}
              </div>
              {werte[BOARD_CHECK.key] === BOARD_CHECK.optionen[1] && (
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 6 }}>
                  {art === 'model' ? 'Kein Problem: Nach dem Fragebogen im Board unter „No Gos“ bzw. „Social Media Kanäle“ ändern.' : 'Das Model hat angegeben, dass das Board angepasst werden muss.'}
                </div>
              )}
            </div>
          </div>

          {FRAGEN.map(f => (
            <Frage key={f.key} f={f} name={name} wert={werte[f.key]} setWert={(w) => setze(f.key, w)} geaendert={geaendert[f.key]} />
          ))}
        </div>
      </div>

      <div style={{ padding: '10px 16px calc(14px + env(safe-area-inset-bottom, 0px))', borderTop: '1px solid var(--border)', background: 'var(--bg-card)', flexShrink: 0 }}>
        <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {hinweis && <div role="alert" style={{ fontSize: 13, color: 'var(--ton-rot)', fontWeight: 600 }}>{hinweis}</div>}
          <button type="button" onClick={fertig} disabled={speichert} className="gross-btn einf-knopf" style={{ padding: 14, borderRadius: 14, border: 'none', background: O, color: '#fff', fontSize: 15.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
            {art === 'model' && status !== 'fertig' ? 'Fertig ✓' : 'Speichern & schließen'}
          </button>
        </div>
      </div>
    </div>
  )
}
