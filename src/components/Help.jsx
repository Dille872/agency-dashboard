import React, { useState, useEffect, useCallback } from 'react'
import { HELP_BY_ID } from '../help/chatterHelp'

// v4.9.0 — Helpcenter-Bausteine.
//
//   HelpDot   Das kleine ? neben einer Überschrift. Öffnet die Erklärung.
//   HelpSheet Das Fenster mit der Erklärung. Auch einzeln nutzbar (Liste im
//             Tab „Mehr" öffnet damit dasselbe Fenster).
//
// Die Texte stehen in src/help/chatterHelp.js — hier steht nur die Darstellung.

const Z = 9000

// ── Das kleine Fragezeichen ────────────────────────────────────────────────
// Bewusst ein <span role="button"> und kein <button>: Die Überschrift der
// aufklappbaren Bereiche ist selbst schon ein <button>, und ein Button im Button
// ist ungültiges HTML — der Browser zerlegt dann das Markup.
export function HelpDot({ topic, size = 16 }) {
  const [open, setOpen] = useState(false)
  const t = HELP_BY_ID[topic]
  if (!t) return null
  const stop = (e) => { e.stopPropagation(); e.preventDefault() }
  return (
    <>
      <span
        role="button"
        tabIndex={0}
        title="Was ist das?"
        aria-label={`Hilfe zu ${t.title}`}
        onClick={(e) => { stop(e); setOpen(true) }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { stop(e); setOpen(true) } }}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: size, height: size, borderRadius: '50%', flexShrink: 0,
          border: '1px solid rgba(139,140,249,0.5)', color: '#a78bfa',
          background: 'rgba(139,140,249,0.12)',
          fontSize: Math.round(size * 0.68), fontWeight: 700, lineHeight: 1,
          cursor: 'pointer', userSelect: 'none',
        }}
      >?</span>
      {open && <HelpSheet topic={topic} onClose={() => setOpen(false)} />}
    </>
  )
}

// ── Das Erklär-Fenster ─────────────────────────────────────────────────────
export function HelpSheet({ topic, onClose }) {
  const t = HELP_BY_ID[topic]
  const esc = useCallback((e) => { if (e.key === 'Escape') onClose() }, [onClose])
  useEffect(() => {
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [esc])
  if (!t) return null
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: Z + 10,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
          width: '100%', maxWidth: 520, maxHeight: '82vh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px 12px',
          position: 'sticky', top: 0, background: 'var(--bg-card)', borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: 20 }}>{t.icon}</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>{t.title}</span>
          <button onClick={onClose} aria-label="Schließen" style={{
            background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
            borderRadius: 7, width: 28, height: 28, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
          }}>✕</button>
        </div>
        <div style={{ padding: '14px 18px 18px' }}>
          <HelpBody topic={t} />
        </div>
      </div>
    </div>
  )
}

// ── Inhalt eines Themas (auch von der Tour benutzt) ────────────────────────
export function HelpBody({ topic: t, compact = false }) {
  return (
    <div>
      <div style={{ fontSize: 13, color: '#a78bfa', fontWeight: 600, marginBottom: 12, lineHeight: 1.5 }}>
        {t.short}
      </div>
      {t.body?.map((p, i) => (
        <p key={i} style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.65, margin: '0 0 10px' }}>{p}</p>
      ))}
      {t.steps?.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            So geht's
          </div>
          <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {t.steps.map((s, i) => (
              <li key={i} style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{s}</li>
            ))}
          </ol>
        </div>
      )}
      {!compact && t.watch?.length > 0 && (
        <div style={{
          marginTop: 16, padding: '12px 14px', borderRadius: 10,
          background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Wichtig zu wissen
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {t.watch.map((w, i) => (
              <li key={i} style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
