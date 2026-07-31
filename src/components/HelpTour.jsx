import React, { useState, useEffect, useCallback, useRef } from 'react'
import { HELP_BY_ID, TOUR_IDS } from '../help/chatterHelp'
import { HelpBody } from './Help'

// v4.9.0 — Geführte Einführung für neue Chatter.
//
// Funktionsweise: Für jeden Schritt wird der passende Reiter umgeschaltet, das
// zugehörige Element über `data-help="<id>"` gesucht, in den sichtbaren Bereich
// gescrollt und ausgeleuchtet (Scheinwerfer über einen riesigen box-shadow).
// Findet sich kein Element — etwa weil der Bereich mangels Daten gar nicht
// gerendert wird, z.B. „Meine Aufgaben" ohne Aufgaben — läuft der Schritt ohne
// Scheinwerfer weiter, statt die Tour abzubrechen.
//
// Während der Tour liegt eine unsichtbare Sperrfläche über der Oberfläche, damit
// niemand versehentlich etwas auslöst.

const Z = 9500
const PAD = 6

export default function HelpTour({ ids = TOUR_IDS, onGoTab, onFinish }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState(null)
  const pollRef = useRef(null)

  const topic = HELP_BY_ID[ids[i]]
  const isFirst = i === 0
  const isLast = i === ids.length - 1

  const measure = useCallback(() => {
    if (!topic) return
    const el = document.querySelector(`[data-help="${topic.id}"]`)
    if (!el) { setRect(null); return }
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) { setRect(null); return }
    // Sehr hohe Bereiche nur oben anleuchten, sonst bleibt für die Erklärkarte
    // kein Platz mehr.
    const maxH = Math.max(120, window.innerHeight * 0.42)
    setRect({ top: r.top, left: r.left, width: r.width, height: Math.min(r.height, maxH) })
  }, [topic])

  // Schritt wechseln: Reiter umschalten, hinscrollen, dann kurz nachmessen —
  // das Layout braucht ein paar Frames, bis alles steht.
  useEffect(() => {
    if (!topic) return
    if (topic.tab && onGoTab) onGoTab(topic.tab)
    setRect(null)
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-help="${topic.id}"]`)
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      let ticks = 0
      clearInterval(pollRef.current)
      pollRef.current = setInterval(() => {
        measure()
        if (++ticks > 8) clearInterval(pollRef.current)
      }, 100)
    }, 180)
    return () => { clearTimeout(t); clearInterval(pollRef.current) }
  }, [i, topic, onGoTab, measure])

  useEffect(() => {
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [measure])

  const next = () => (isLast ? onFinish() : setI(n => n + 1))
  const prev = () => setI(n => Math.max(0, n - 1))

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onFinish()
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!topic) return null

  // Karte oben oder unten — je nachdem, wo das beleuchtete Element sitzt.
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const cardAtTop = rect ? (rect.top + rect.height / 2) > vh * 0.5 : false

  return (
    <>
      {/* Sperrfläche: verhindert versehentliche Klicks in die Oberfläche */}
      <div style={{ position: 'fixed', inset: 0, zIndex: Z, background: rect ? 'transparent' : 'rgba(0,0,0,0.68)' }} />

      {/* Scheinwerfer */}
      {rect && (
        <div style={{
          position: 'fixed', pointerEvents: 'none', zIndex: Z + 1,
          top: rect.top - PAD, left: rect.left - PAD,
          width: rect.width + PAD * 2, height: rect.height + PAD * 2,
          borderRadius: 12,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.68), 0 0 0 2px #a78bfa',
          transition: 'top .2s, left .2s, width .2s, height .2s',
        }} />
      )}

      {/* Erklärkarte */}
      <div style={{
        position: 'fixed', zIndex: Z + 2,
        left: 12, right: 12, [cardAtTop ? 'top' : 'bottom']: 12,
        margin: '0 auto', maxWidth: 480,
        background: 'var(--bg-card)', border: '1px solid rgba(139,140,249,0.45)',
        borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
        maxHeight: '52vh', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 10px' }}>
          <span style={{ fontSize: 18 }}>{topic.icon}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>{topic.title}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{i + 1}/{ids.length}</span>
        </div>

        <div style={{ padding: '0 16px', overflowY: 'auto', flex: 1 }}>
          <HelpBody topic={topic} compact />
        </div>

        {/* Fortschritt */}
        <div style={{ display: 'flex', gap: 3, padding: '10px 16px 0' }}>
          {ids.map((_, n) => (
            <div key={n} style={{
              flex: 1, height: 3, borderRadius: 2,
              background: n <= i ? '#a78bfa' : 'var(--border)',
            }} />
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px 14px' }}>
          <button onClick={onFinish} style={{
            background: 'transparent', border: 'none', color: 'var(--text-muted)',
            fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: '8px 4px',
          }}>Überspringen</button>
          <div style={{ flex: 1 }} />
          {!isFirst && (
            <button onClick={prev} style={{
              background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)',
              borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>Zurück</button>
          )}
          <button onClick={next} style={{
            background: '#7c3aed', border: 'none', color: '#fff',
            borderRadius: 8, padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>{isLast ? 'Fertig' : 'Weiter'}</button>
        </div>
      </div>
    </>
  )
}
