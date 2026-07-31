import React, { useState } from 'react'
import { useFabOpen } from '../fabPanel'
import { HELP_TOPICS } from '../help/chatterHelp'
import { HelpSheet } from './Help'

// v4.10.0 — Der Hilfe-Knopf über der Glocke.
//
// Die ?-Symbole an den Überschriften helfen nur dem, der schon weiß, wo er ist.
// Wer nicht weiterweiß, sucht unten rechts — dort, wo auch Glocke und Chat sind.
// Reihenfolge der schwebenden Knöpfe (wie im Admin-Dashboard):
//   20 px  Chat · 86 px  Glocke · 152 px  Hilfe
//
// Nutzt useFabOpen/useFabPanels: Es ist immer nur EIN schwebendes Fenster offen,
// das Öffnen der Hilfe schließt Chat und Glocke.

const ACCENT = '#a78bfa'

export default function HelpFab({ isOpen, onToggle, onStartTour }) {
  const [open, setOpen] = useFabOpen(isOpen, onToggle)
  const [topic, setTopic] = useState(null)

  return (
    <>
      {open && (
        <div style={{
          position: 'fixed', right: 20, bottom: 216, zIndex: 99998,
          width: 'min(400px, calc(100vw - 40px))',
          maxHeight: 'min(560px, calc(100vh - 256px))',
          background: 'var(--bg-base)', border: '1px solid var(--border-bright)',
          borderRadius: 16, boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
              <span style={{ color: ACCENT }}>?</span> Hilfe
            </div>
            <button onClick={() => setOpen(false)} aria-label="Schließen" style={{
              background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
              borderRadius: 7, width: 26, height: 26, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
            }}>✕</button>
          </div>

          <div style={{ padding: '12px 14px', overflowY: 'auto' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 10 }}>
              Wonach suchst du? Jeder Bereich im Portal hat oben rechts auch ein{' '}
              <span style={{ color: ACCENT, fontWeight: 700 }}>?</span> mit derselben Erklärung.
            </div>
            {onStartTour && (
              <button
                onClick={() => { setOpen(false); onStartTour() }}
                style={{
                  width: '100%', marginBottom: 12, padding: '10px', borderRadius: 8,
                  background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.4)',
                  color: ACCENT, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >▶ Einführung noch einmal ansehen</button>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {HELP_TOPICS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTopic(t.id)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 9, textAlign: 'left', width: '100%',
                    padding: '9px 11px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                  }}
                >
                  <span style={{ fontSize: 14, lineHeight: 1.3 }}>{t.icon}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{t.title}</span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4, marginTop: 1 }}>{t.short}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(o => !o)}
        title="Hilfe"
        aria-label="Hilfe"
        style={{
          position: 'fixed', right: 20, bottom: 152, zIndex: 99999,
          width: 54, height: 54, borderRadius: '50%',
          background: open ? 'rgba(167,139,250,0.18)' : 'rgba(255,255,255,0.06)',
          color: ACCENT,
          border: `1px solid ${open ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.12)'}`,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          cursor: 'pointer', fontFamily: 'inherit', fontSize: 22, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >?</button>

      {topic && <HelpSheet topic={topic} onClose={() => setTopic(null)} />}
    </>
  )
}
