import React, { useState } from 'react'
import { reiseHeute, zustand, listeAus, terminJetzt } from '../modelLage'

// ── Chatter-Portal, Tab „Models": Wer macht was (v4.78.0) ───────────────────
//
// Für Chatter mit mehreren Models: alle eigenen Models nebeneinander —
// Angebot (✓/✕), Preise und No Gos. Eine laufende Reise überschreibt das
// Angebot („✕ Reise"), wenn das Model es unter „geht nicht" angetippt hat.
// Die Suche filtert quer über alle Zeilen, z. B. „Füße" oder „Video".
//
// Nur Anzeige, keine eigenen Abfragen: Board-Maps und Services kommen aus
// ChatterPortal (loadAssignedModelData), Zustand aus models_contact (models).

const ANGEBOT = [
  { key: 'audios', label: 'Audios' },
  { key: 'video_chat', label: 'Video-Call', auch: ['video call', 'videocall', 'vc'] },
  { key: 'telefonieren', label: 'Telefon', auch: ['telefonieren', 'anrufe'] },
  { key: 'custom', label: 'Custom', auch: ['customs'] },
  { key: 'sexting', label: 'Sexting' },
  { key: 'bewertungen', label: 'Bewertungen' },
]
const lc = (s) => String(s || '').trim().toLowerCase()

export default function WerMachtWas({ namen, boards, services, models, aenderungen = {}, kalender = {}, onBoard }) {
  const [suche, setSuche] = useState('')
  if (namen.length < 2) return null   // bei einem Model reicht das Board darunter

  const q = lc(suche)
  const passt = (t) => !q || lc(t).includes(q)
  const kontakt = (n) => models.find(m => m.name === n)
  const reise = Object.fromEntries(namen.map(n => [n, reiseHeute(boards[n]?.reise || [])]))
  const neuBei = (n, titel) => (aenderungen[n] || []).some(a => a.action !== 'gelöscht' && lc(a.details).startsWith(lc(titel)))

  // Angebot: nur Zeilen, die mindestens ein Model beantwortet hat
  const angebot = ANGEBOT.filter(a => namen.some(n => services[n]?.[a.key]) && passt(a.label))
  const zelleAngebot = (n, a) => {
    const r = reise[n]
    if (r) {
      const nicht = listeAus(r.reise_geht_nicht).map(lc)
      if ([lc(a.label), ...(a.auch || [])].some(x => nicht.includes(x))) return { t: '✕', f: '#ef4444', zusatz: 'Reise' }
    }
    const e = services[n]?.[a.key]?.enabled
    if (e === true) return { t: '✓', f: '#10b981', note: services[n][a.key].note }
    if (e === false) return { t: '✕', f: '#ef4444' }
    return { t: '–', f: 'var(--text-muted)' }
  }

  // No Gos: Vereinigung über alle Models (gleich geschrieben = eine Zeile)
  const nogoZeilen = []
  const gesehen = new Set()
  for (const n of namen) for (const it of boards[n]?.nogos || []) {
    const k = lc(it.title)
    if (!gesehen.has(k)) { gesehen.add(k); nogoZeilen.push(it.title) }
  }
  const nogos = nogoZeilen.filter(passt)
  const hatNogo = (n, t) => (boards[n]?.nogos || []).some(it => lc(it.title) === lc(t))

  const preiseVon = (n) => (boards[n]?.preise || []).filter(p => passt(p.title) || passt(p.price))
  const zeigPreise = namen.some(n => preiseVon(n).length > 0)

  const th = { padding: '10px 10px', fontSize: 13, fontWeight: 700, textAlign: 'center', verticalAlign: 'bottom', minWidth: 96 }
  const td = { padding: '8px 10px', fontSize: 12.5, textAlign: 'center', borderTop: '1px solid var(--border)', verticalAlign: 'top' }
  const tdL = { ...td, textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600, position: 'sticky', left: 0, background: 'var(--bg-card)', minWidth: 110, whiteSpace: 'normal' }
  const grp = (t) => (
    <tr><td colSpan={namen.length + 1} style={{ padding: '14px 10px 5px', fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.08em', position: 'sticky', left: 0 }}>{t}</td></tr>
  )
  const reiseSp = (n) => reise[n] ? { background: 'rgba(8,145,178,0.07)' } : null

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Wer macht was</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>deine {namen.length} Models nebeneinander · Name antippen = ganzes Board</span>
        <div style={{ flex: 1 }} />
        <input value={suche} onChange={e => setSuche(e.target.value)} placeholder="🔍 Suchen, z. B. „Füße“"
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '7px 11px', borderRadius: 9, fontSize: 12.5, fontFamily: 'inherit', outline: 'none', width: 200, maxWidth: '100%' }} />
      </div>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', whiteSpace: 'normal', display: 'table' }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg-card)', minWidth: 110 }} />
              {namen.map(n => {
                const r = reise[n]
                // v4.97.0: laufender Termin mit „nicht erreichbar" geht vor
                const z = zustand(kontakt(n), r, Date.now(), terminJetzt(kalender[n]))
                return (
                  <th key={n} style={{ ...th, ...reiseSp(n) }}>
                    <button type="button" onClick={() => onBoard(n)} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-primary)', fontSize: 13.5, fontWeight: 700 }}>{n}</button>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: z.farbe, marginTop: 2 }}>
                      {z.art === 'termin' ? z.text : r ? `✈ ${r.title}${r.date_to ? ` bis ${new Date(r.date_to + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}` : ''}` : z.text}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {angebot.length > 0 && grp('ANGEBOT')}
            {angebot.map(a => (
              <tr key={a.key}>
                <td style={tdL}>{a.label}</td>
                {namen.map(n => {
                  const c = zelleAngebot(n, a)
                  return (
                    <td key={n} title={c.note || ''} style={{ ...td, ...reiseSp(n), color: c.f, fontWeight: 700 }}>
                      {c.t}{c.zusatz && <span style={{ fontSize: 10.5, fontWeight: 500, color: '#0891b2' }}> ({c.zusatz})</span>}
                      {c.note && <div style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--text-muted)' }}>{c.note}</div>}
                    </td>
                  )
                })}
              </tr>
            ))}

            {zeigPreise && grp('PREISE')}
            {zeigPreise && (
              <tr>
                <td style={tdL}>Preise</td>
                {namen.map(n => (
                  <td key={n} style={{ ...td, ...reiseSp(n), textAlign: 'left' }}>
                    {preiseVon(n).length === 0 && <span style={{ color: 'var(--text-muted)' }}>–</span>}
                    {preiseVon(n).map(p => (
                      <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, padding: '2px 0', fontSize: 12 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{p.title}</span>
                        {p.price && <b style={{ fontFamily: 'monospace', color: neuBei(n, p.title) ? '#f59e0b' : 'var(--text-primary)', whiteSpace: 'nowrap' }}>{p.price}{neuBei(n, p.title) ? ' NEU' : ''}</b>}
                      </div>
                    ))}
                  </td>
                ))}
              </tr>
            )}

            {nogos.length > 0 && grp('NO GOS')}
            {nogos.map(t => (
              <tr key={t}>
                <td style={tdL}>{t}</td>
                {namen.map(n => {
                  const ja = hatNogo(n, t)
                  const neu = ja && neuBei(n, t)
                  return <td key={n} style={{ ...td, ...reiseSp(n), color: ja ? '#ef4444' : 'var(--text-muted)', fontWeight: 700 }}>{ja ? '✕' : '–'}{neu && <span style={{ fontSize: 10, color: '#f59e0b' }}> NEU</span>}</td>
                })}
              </tr>
            ))}

            {q && angebot.length === 0 && nogos.length === 0 && !zeigPreise && (
              <tr><td colSpan={namen.length + 1} style={{ ...td, color: 'var(--text-muted)' }}>Nichts gefunden für „{suche}".</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>✕ bei No Gos = gilt für dieses Model · – = nicht eingetragen. Verbindlich ist immer das ganze Board.</div>
    </div>
  )
}
