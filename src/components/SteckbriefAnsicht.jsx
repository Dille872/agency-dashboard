import React, { useState } from 'react'
import { FRAGE_SCHRITTE, hatWert, wertText, etikett } from '../steckbrief'

// ── „Über [Name]“ — Steckbrief zum Lesen (v4.95.0) ─────────────────────────
// Für Chatter (Meine Models, Heute-Karte) und Admin. Nach Themen, jedes
// Thema aufklappbar; das erste (Basics) ist offen. Leere Felder fehlen.

export default function SteckbriefAnsicht({ name, zeile, kompakt = false, rechts = null }) {
  const a = zeile?.antworten || {}
  const themen = FRAGE_SCHRITTE
    .map(s => ({ s, felder: s.felder.filter(f => hatWert(a[f.key])) }))
    .filter(x => x.felder.length)
  // null = noch nichts angetippt → das erste Thema ist offen (auch wenn die Daten später kommen)
  const [gewaehlt, setGewaehlt] = useState(null)
  const offen = gewaehlt ?? new Set(themen.length ? [themen[0].s.key] : [])
  const toggle = (k) => { const n = new Set(offen); n.has(k) ? n.delete(k) : n.add(k); setGewaehlt(n) }

  return (
    <div data-help="ueber" style={{ background: 'var(--bg-card)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 16, padding: kompakt ? '12px 13px' : '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: themen.length ? 10 : 0, flexWrap: 'wrap' }}>
        <span style={{ fontSize: kompakt ? 14 : 15, fontWeight: 700, color: 'var(--text-primary)' }}>👤 Über {a.fan_name || name}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Fan-Version, so erzählen</span>
        <span style={{ flex: 1 }} />
        {rechts}
      </div>
      {!themen.length && (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{name} hat den Steckbrief noch nicht ausgefüllt.</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {themen.map(({ s, felder }) => {
          const auf = offen.has(s.key)
          return (
            <div key={s.key} style={{ borderRadius: 12, background: 'var(--bg-card2)', border: '1px solid var(--border)' }}>
              <button type="button" onClick={() => toggle(s.key)} className="klapp-kopf" style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 11px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                <span style={{ fontSize: 15 }}>{s.icon}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{s.titel}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{felder.length}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{auf ? '▾' : '▸'}</span>
              </button>
              {auf && (
                <div style={{ padding: '0 11px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {felder.map(f => (
                    <div key={f.key} style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                      <span style={{ color: 'var(--text-muted)' }}>{etikett(f)}: </span>
                      <span style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{wertText(a[f.key])}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
