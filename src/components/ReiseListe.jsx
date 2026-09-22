import React, { useState } from 'react'
import { teileReisen, reiseHeute } from '../modelLage'

// ── Urlaub & Reisen als Liste (v4.94.0) ────────────────────────────────────
// Für die Board-Ansichten im Chatter-Portal („Meine Models“) und im Admin
// (Kommunikation → Model-Boards). Vorher standen dort ALLE Reisen, auch
// längst vorbei (Fall Alina: Urlaub vom Vormonat stand noch vorne).
// Jetzt: nur laufende und kommende, mit Datum; Vergangenes unter „Archiv“.

const tag = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : ''
const spanne = (r) => {
  const von = r.date_from || r.date_to, bis = r.date_to || r.date_from
  if (!von) return ''
  return von === bis ? tag(von) : `${tag(von)} – ${tag(bis)}`
}

export default function ReiseListe({ items = [], farbe = '#06b6d4', gross = false }) {
  const [archiv, setArchiv] = useState(false)
  const { aktuell, alt } = teileReisen(items)
  const laeuft = reiseHeute(items)
  const zeile = (r, vergangen) => (
    <div key={r.id} style={{ padding: gross ? '7px 10px' : '6px 8px', background: 'var(--bg-card2)', borderRadius: 8, border: `1px solid ${laeuft?.id === r.id ? farbe : 'var(--border)'}`, marginBottom: 5, opacity: vergangen ? 0.6 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <span style={{ fontSize: gross ? 12 : 11, fontWeight: 700, color: 'var(--text-primary)', minWidth: 0 }}>{r.title}</span>
        {spanne(r) && <span style={{ fontSize: gross ? 11 : 10, fontFamily: 'monospace', fontWeight: 700, color: vergangen ? 'var(--text-muted)' : farbe, flexShrink: 0 }}>{spanne(r)}</span>}
      </div>
      {laeuft?.id === r.id && <div style={{ fontSize: 10, fontWeight: 700, color: farbe, marginTop: 2 }}>● gerade unterwegs</div>}
      {r.content && <div style={{ fontSize: gross ? 11 : 10, color: 'var(--text-secondary)', marginTop: 2 }}>{r.content}</div>}
      {!vergangen && r.reise_geht_nicht && <div style={{ fontSize: 10, color: 'var(--ton-rot)', marginTop: 2 }}>✕ geht nicht: {r.reise_geht_nicht}</div>}
      {!vergangen && r.reise_geht && <div style={{ fontSize: 10, color: 'var(--ton-gruen)', marginTop: 1 }}>✓ geht: {r.reise_geht}</div>}
    </div>
  )
  return (
    <>
      {aktuell.map(r => zeile(r, false))}
      {aktuell.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: alt.length ? 6 : 0 }}>Keine anstehenden Reisen</div>}
      {alt.length > 0 && (
        <>
          <button type="button" onClick={() => setArchiv(v => !v)} style={{ background: 'transparent', border: 'none', padding: 0, color: 'var(--text-muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', marginTop: 2 }}>
            {archiv ? '▾ Archiv ausblenden' : `▸ Archiv · ${alt.length} vergangene`}
          </button>
          {archiv && <div style={{ marginTop: 6 }}>{alt.map(r => zeile(r, true))}</div>}
        </>
      )}
    </>
  )
}
