import React from 'react'
import Logo from './Logo'

// ── Platzhalter-Karten beim Laden (v4.92.0) ────────────────────────────────
// Statt „Daten werden geladen…“ oder leerer Fläche erscheinen graue Karten in
// der Form des späteren Inhalts, mit sanftem Schimmer. Die Seite springt dann
// beim Eintreffen der Daten nicht mehr so stark.
// Animation: .skel in index.css (respektiert „Bewegung reduzieren“).

export function Balken({ w = '100%', h = 12, r = 6, style }) {
  return <span className="skel" aria-hidden="true" style={{ display: 'block', width: w, height: h, borderRadius: r, ...style }} />
}

export function SkelKarte({ zeilen = 3, hoehe, kopf = true, style }) {
  return (
    <div aria-hidden="true" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 11, minHeight: hoehe, boxSizing: 'border-box', ...style }}>
      {kopf && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Balken w={28} h={28} r={9} />
          <Balken w="42%" h={14} />
        </div>
      )}
      {Array.from({ length: zeilen }).map((_, i) => (
        <Balken key={i} w={['92%', '76%', '84%', '60%', '70%'][i % 5]} h={11} />
      ))}
    </div>
  )
}

// Liste mit runden Punkten links (z. B. „In der Schicht“)
export function SkelZeilen({ anzahl = 3 }) {
  return (
    <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column' }}>
      {Array.from({ length: anzahl }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderTop: i ? '1px solid var(--border)' : 'none' }}>
          <Balken w={8} h={8} r={4} />
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Balken w={['38%', '30%', '44%'][i % 3]} h={11} />
            <Balken w={['64%', '52%', '58%'][i % 3]} h={9} />
          </span>
          <Balken w={46} h={10} />
        </div>
      ))}
    </div>
  )
}

// Model-Karten nebeneinander (Chatter „Heute“)
export function SkelModels({ anzahl = 2 }) {
  return (
    <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Array.from({ length: anzahl }).map((_, i) => (
        <div key={i} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 18, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Balken w={44} h={44} r={22} />
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
              <Balken w="40%" h={15} />
              <Balken w="62%" h={10} />
            </span>
          </div>
          <div style={{ display: 'flex', gap: 7 }}>
            <Balken w={70} h={26} r={13} /><Balken w={90} h={26} r={13} /><Balken w={60} h={26} r={13} />
          </div>
          <Balken w="88%" h={10} />
          <Balken w="70%" h={10} />
        </div>
      ))}
    </div>
  )
}

// Ganze Seite beim Start (Anmeldung wird geprüft, Rollen geladen)
export function SkelSeite() {
  return (
    <div role="status" aria-label="Lädt" style={{ minHeight: '100vh', background: 'var(--bg-base)', fontFamily: 'var(--font-sans)' }}>
      <div style={{ height: 56, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', background: 'var(--bg-card)' }}>
        <span className="skel-puls" style={{ display: 'flex' }}><Logo size={26} /></span>
        <Balken w={150} h={13} />
        <span style={{ flex: 1 }} />
        <Balken w={34} h={30} r={9} />
        <Balken w={34} h={30} r={9} />
      </div>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Balken w={120} h={11} />
        <Balken w={200} h={22} r={8} />
        <SkelAdmin />
      </div>
    </div>
  )
}

// Admin-Hauptbereich (Kennzahlen + zwei Karten)
export function SkelAdmin() {
  return (
    <div role="status" aria-label="Daten werden geladen" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="kpi-mini-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} aria-hidden="true" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>
            <Balken w="50%" h={10} />
            <Balken w="70%" h={22} r={8} />
            <Balken w="40%" h={9} />
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        <SkelKarte zeilen={4} hoehe={170} />
        <SkelKarte zeilen={4} hoehe={170} />
      </div>
    </div>
  )
}
