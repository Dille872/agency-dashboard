import React, { useEffect, useRef, useState } from 'react'
import { SCHRITTE, FRAGE_SCHRITTE, fehlendePflicht, hatWert, steckbriefSpeichern } from '../steckbrief'
import ModelSteckbrief from './ModelSteckbrief'

// ── Einführung / Steckbrief ausfüllen (v4.95.0) ────────────────────────────
// Vollbild über dem Model-Portal. Zwei Arten:
//   art='einfuehrung'  vom Team geschickt (oder neu angelegt) — startet mit
//                      „Willkommen“, am Ende „Fertig“ → Status fertig.
//   art='bearbeiten'   später aus dem Board oder vom Admin — gleiche Schritte,
//                      Status bleibt, wie er ist.
// Gespeichert wird automatisch (kurz nach dem Tippen und bei jedem Schritt),
// damit bei „Später weitermachen“ oder zugeklapptem Handy nichts verloren geht.
// Angebot, Preise und No Gos: hier läuft der normale Board-Steckbrief
// (ModelSteckbrief) — dieselben Daten wie im Board, nichts doppelt.
// Admin (ohne board-Props): der Board-Teil wird übersprungen.

const O = '#f59e0b'
const lbl = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6, display: 'block' }
const feld = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '11px 12px', borderRadius: 12, fontSize: 15, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }
const chip = (an) => ({
  fontSize: 13.5, padding: '8px 13px', borderRadius: 20, fontWeight: an ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit',
  background: an ? 'rgba(245,158,11,0.16)' : 'transparent', border: `1px solid ${an ? O : 'var(--border)'}`, color: an ? 'var(--ton-amber)' : 'var(--text-secondary)',
})

function Feld({ f, wert, setWert }) {
  const [eigen, setEigen] = useState(null)
  const multi = f.typ === 'multi'
  const liste = multi ? (Array.isArray(wert) ? wert : []) : []
  const eigene = f.optionen ? (multi ? liste.filter(x => !f.optionen.includes(x)) : (wert && !f.optionen.includes(wert) ? [wert] : [])) : []
  const kopf = (
    <span style={lbl}>{f.label}{f.pflicht && <span style={{ color: 'var(--ton-rot)', marginLeft: 4 }}>*</span>}</span>
  )
  if (f.typ === 'text' || f.typ === 'lang') {
    const Tag = f.typ === 'lang' ? 'textarea' : 'input'
    return (
      <div style={{ gridColumn: f.halb ? 'span 1' : '1 / -1' }}>
        {kopf}
        <Tag value={wert || ''} onChange={e => setWert(e.target.value.slice(0, f.typ === 'lang' ? 1000 : 200))} placeholder={f.ph || ''}
          rows={f.typ === 'lang' ? 3 : undefined} className="einf-feld" style={{ ...feld, ...(f.typ === 'lang' ? { resize: 'vertical', lineHeight: 1.45 } : {}) }} />
        {f.tipp && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>{f.tipp}</div>}
      </div>
    )
  }
  const an = (o) => multi ? liste.includes(o) : wert === o
  const tippen = (o) => {
    if (multi) setWert(an(o) ? liste.filter(x => x !== o) : [...liste, o])
    else setWert(an(o) ? '' : o)
  }
  const eigenesUebernehmen = () => {
    const t = (eigen || '').trim()
    if (t) { if (multi) { if (!liste.includes(t)) setWert([...liste, t]) } else setWert(t) }
    setEigen(null)
  }
  return (
    <div style={{ gridColumn: '1 / -1' }}>
      {kopf}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {[...f.optionen, ...eigene].map(o => (
          <button key={o} type="button" className="chip-btn" onClick={() => tippen(o)} style={chip(an(o))}>{an(o) ? '✓ ' : ''}{o}</button>
        ))}
        {eigen === null
          ? <button type="button" className="chip-btn" onClick={() => setEigen('')} style={{ ...chip(false), borderStyle: 'dashed', color: 'var(--ton-lila)' }}>+ eigenes</button>
          : (
            <span style={{ display: 'flex', gap: 6, flex: '1 1 200px' }}>
              <input autoFocus value={eigen} onChange={e => setEigen(e.target.value.slice(0, 60))} onKeyDown={e => { if (e.key === 'Enter') eigenesUebernehmen(); if (e.key === 'Escape') setEigen(null) }}
                placeholder="eigene Antwort" className="einf-feld" style={{ ...feld, padding: '8px 11px', fontSize: 14 }} />
              <button type="button" className="chip-btn" onClick={eigenesUebernehmen} style={{ ...chip(true), flexShrink: 0 }}>OK</button>
            </span>
          )}
      </div>
    </div>
  )
}

export default function ModelEinfuehrung({ name, zeile, art = 'einfuehrung', board, services, logActivity, onBoardGeaendert, onGespeichert, onZu, wer }) {
  const mitBoard = !!board
  const schritte = art === 'einfuehrung' ? SCHRITTE : FRAGE_SCHRITTE
  const startIdx = art === 'einfuehrung'
    ? Math.min(Math.max(0, schritte.findIndex(s => s.key === zeile?.einfuehrung_schritt)), schritte.length - 1)
    : 0
  const [idx, setIdx] = useState(startIdx)
  // v4.95.1: weitester erreichter Schritt — bis dahin darf man über den Balken
  // auch wieder VORWÄRTS springen. Vorher hing das am gespeicherten Schritt, der
  // sich beim Zurückspringen mit änderte (dann ging es per Balken nicht mehr vor).
  const [maxIdx, setMaxIdx] = useState(startIdx)
  const [antworten, setAntworten] = useState(() => ({ ...(zeile?.antworten || {}) }))
  const [hinweis, setHinweis] = useState('')
  const [speichert, setSpeichert] = useState(false)
  const [gespeichertUm, setGespeichertUm] = useState(null)
  const schmutzig = useRef(false)
  const timer = useRef(null)
  const koerper = useRef(null)
  const s = schritte[idx]

  const speichern = async (extra = {}) => {
    clearTimeout(timer.current)
    setSpeichert(true)
    const felder = { antworten, ...extra }
    if (art === 'einfuehrung' && !extra.einfuehrung_status && zeile?.einfuehrung_status !== 'fertig') felder.einfuehrung_status = 'laeuft'
    const fehler = await steckbriefSpeichern(name, felder, wer)
    setSpeichert(false)
    if (fehler) { setHinweis('Nicht gespeichert: ' + fehler.message); return false }
    schmutzig.current = false
    setGespeichertUm(new Date())
    onGespeichert?.()
    return true
  }

  // Automatisch speichern, 1,5 s nach der letzten Eingabe
  useEffect(() => {
    if (!schmutzig.current) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => speichern({ einfuehrung_schritt: s.key }), 1500)
    return () => clearTimeout(timer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [antworten])

  const setze = (key, wert) => { schmutzig.current = true; setHinweis(''); setAntworten(a => ({ ...a, [key]: wert })) }

  const gehe = async (neu) => {
    await speichern({ einfuehrung_schritt: schritte[neu].key })
    setIdx(neu); setMaxIdx(m => Math.max(m, neu)); setHinweis('')
    koerper.current?.scrollTo?.(0, 0)
  }

  const weiter = async () => {
    const fehlt = fehlendePflicht(s, antworten)
    if (fehlt.length) { setHinweis(`Bitte noch ausfüllen: ${fehlt.map(f => f.label).join(', ')}`); return }
    if (s.board && mitBoard && !(board.nogos || []).length) { setHinweis('Bitte mindestens ein No Go antippen oder eintragen.'); return }
    if (idx < schritte.length - 1) return gehe(idx + 1)
    // Letzter Schritt: alle Pflichtfelder prüfen
    const offen = schritte.findIndex(x => fehlendePflicht(x, antworten).length)
    if (offen !== -1) { await gehe(offen); setHinweis(`Hier fehlt noch etwas: ${fehlendePflicht(schritte[offen], antworten).map(f => f.label).join(', ')}`); return }
    if (art === 'einfuehrung') {
      const ok = await speichern({ einfuehrung_status: 'fertig', einfuehrung_schritt: null, fertig_am: new Date().toISOString() })
      if (!ok) return
      try { await logActivity?.('abgeschlossen', 'Einführung', 'Steckbrief „Über mich“ ausgefüllt') } catch { /* nur Hinweis */ }
    } else {
      const ok = await speichern({})
      if (!ok) return
      try { await logActivity?.('bearbeitet', 'Steckbrief', 'Über mich') } catch { /* nur Hinweis */ }
    }
    onZu?.(true)
  }

  const spaeter = async () => { await speichern({ einfuehrung_schritt: s.key }); onZu?.(false) }

  const fragen = FRAGE_SCHRITTE.indexOf(s)
  const letzter = idx === schritte.length - 1

  return (
    <div role="dialog" aria-label="Steckbrief ausfüllen" className="einfuehrung" style={{ position: 'fixed', inset: 0, zIndex: 100001, background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}>
      {/* Kopf */}
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-card)', flexShrink: 0 }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ton-amber)' }}>
                {art === 'einfuehrung' ? `Schritt ${idx + 1} von ${schritte.length}` : 'Steckbrief bearbeiten'}{art !== 'einfuehrung' && name ? ` · ${name}` : ''}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {speichert ? 'Speichert …' : gespeichertUm ? `✓ gespeichert ${gespeichertUm.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : 'Wird automatisch gespeichert'}
              </div>
            </div>
            <button type="button" onClick={spaeter} className="einf-klein" style={{ padding: '8px 12px', borderRadius: 11, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              {art === 'einfuehrung' ? 'Später weitermachen' : 'Schließen'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
            {schritte.map((x, i) => (
              <button key={x.key} type="button" title={x.titel} aria-label={x.titel} onClick={() => i !== idx && (art !== 'einfuehrung' || i <= maxIdx) && gehe(i)} className="einf-balken"
                style={{ flex: 1, height: 6, padding: 0, border: 'none', borderRadius: 3, cursor: 'pointer', background: i < idx ? O : i === idx ? 'rgba(245,158,11,0.55)' : 'var(--border)' }} />
            ))}
          </div>
        </div>
      </div>

      {/* Inhalt */}
      <div ref={koerper} style={{ flex: 1, overflowY: 'auto', padding: '18px 16px 24px' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {s.key === 'willkommen' ? (
            <>
              <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.2 }}>Willkommen bei Thirteen 87 👋</div>
              <div style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                Bevor es losgeht, lernen wir dich kurz kennen. Das dauert etwa 15 Minuten. Du kannst jederzeit aufhören und später weitermachen, alles wird automatisch gespeichert.
              </div>
              <div style={{ padding: '15px 16px', borderRadius: 16, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.45)', fontSize: 14.5, lineHeight: 1.6, color: 'var(--text-primary)' }}>
                <b style={{ color: 'var(--ton-amber)' }}>Wichtig:</b> Alles, was du hier einträgst, lesen deine Chatter und erzählen es <b>genau so</b> deinen Fans.
                <br /><br />
                Schreib also nur, was Fans wissen <b>dürfen</b>, also deine „Fan-Version“. Echter Wohnort, Nachname oder Arbeitgeber gehören nicht hier rein. Lieber „Süddeutschland“ als die Stadt.
                <br /><br />
                So erzählt jeder Chatter dasselbe über dich.
              </div>
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                {FRAGE_SCHRITTE.map(x => (
                  <div key={x.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--text-primary)' }}>
                    <span style={{ fontSize: 17, width: 24, textAlign: 'center' }}>{x.icon}</span>{x.titel}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Felder mit <span style={{ color: 'var(--ton-rot)' }}>*</span> sind Pflicht, alles andere ist freiwillig. Je mehr du ausfüllst, desto besser klingen die Chatter wie du.</div>
            </>
          ) : (
            <>
              <div>
                <div style={{ fontSize: 23, fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span>{s.icon}</span>{s.titel}
                </div>
                {s.unter && <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 4 }}>{s.unter}</div>}
                {fragen >= 0 && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>Thema {fragen + 1} von {FRAGE_SCHRITTE.length}</div>}
              </div>
              {s.board && mitBoard && (
                <ModelSteckbrief displayName={name} board={board} services={services} logActivity={logActivity} onGeaendert={onBoardGeaendert} />
              )}
              {s.board && !mitBoard && (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '10px 12px', borderRadius: 12, border: '1px dashed var(--border)' }}>
                  Angebot, Preise und No Gos pflegt das Model im Board (bzw. du unter Model-Boards). Hier nur die Zusatzfragen.
                </div>
              )}
              <div className="einf-raster" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 12px' }}>
                {s.felder.map(f => <Feld key={f.key} f={f} wert={antworten[f.key]} setWert={(w) => setze(f.key, w)} />)}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Fuß */}
      <div style={{ padding: '10px 16px calc(14px + env(safe-area-inset-bottom, 0px))', borderTop: '1px solid var(--border)', background: 'var(--bg-card)', flexShrink: 0 }}>
        <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {hinweis && <div role="alert" style={{ fontSize: 13, color: 'var(--ton-rot)', fontWeight: 600 }}>{hinweis}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            {idx > 0 && (
              <button type="button" onClick={() => gehe(idx - 1)} className="gross-btn einf-knopf" style={{ padding: 14, borderRadius: 14, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', minWidth: 100 }}>Zurück</button>
            )}
            <button type="button" onClick={weiter} disabled={speichert} className="gross-btn einf-knopf" style={{ flex: 1, padding: 14, borderRadius: 14, border: 'none', background: O, color: '#1a1205', fontSize: 15.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
              {s.key === 'willkommen' ? 'Los geht’s' : letzter ? (art === 'einfuehrung' ? 'Fertig ✓' : 'Speichern & schließen') : 'Weiter'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Kleiner Helfer für Anzeigen: wie viele Themen haben schon Antworten?
export function themenStand(antworten = {}) {
  const t = FRAGE_SCHRITTE.filter(s => s.felder.length)
  return { voll: t.filter(s => s.felder.some(f => hatWert(antworten[f.key]))).length, gesamt: t.length }
}
