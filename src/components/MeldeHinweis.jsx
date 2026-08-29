/**
 * v4.43.0 — Der Balken, der zwischen Abhaken und Melden steht.
 *
 * Bewusst fest am unteren Rand statt in der Zeile der Aufgabe: sobald abgehakt
 * ist, verschwindet die Aufgabe aus der Ansicht „Offen" bzw. rutscht ans Ende
 * der Liste. Ein „Nicht melden" an der Zeile wäre damit genau in dem Moment
 * weg, in dem man es braucht.
 */
import React from 'react'

export default function MeldeHinweis({ wartend, onNichtMelden }) {
  if (!wartend || wartend.length === 0) return null
  return (
    <div style={{
      position: 'fixed', left: 0, right: 0, bottom: 18, zIndex: 900,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
      pointerEvents: 'none', padding: '0 12px',
    }}>
      {wartend.map(w => (
        <div key={w.id} style={{
          pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 10,
          width: 'min(94vw, 460px)', padding: '9px 12px', borderRadius: 10,
          background: 'var(--bg-card)', border: '1px solid var(--border-bright)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>✅</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{w.titel || 'Aufgabe'}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 1 }}>
              Team wird in {w.sekunden}s informiert
            </div>
          </div>
          <button onClick={() => onNichtMelden(w.id)} style={{
            flexShrink: 0, fontSize: 11, fontWeight: 600, padding: '5px 11px',
            borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
            background: 'transparent', border: '1px solid var(--border-bright)',
            color: 'var(--text-secondary)',
          }}>Nicht melden</button>
        </div>
      ))}
    </div>
  )
}
