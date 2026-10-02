import React, { useEffect, useState } from 'react'
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

// v5.29.0: Jedes Model bekommt eine feste Farbe (Reihenfolge der Liste),
// damit niemand Preise in der falschen Spalte liest.
const FARBEN = ['#ec4899', '#06b6d4', '#a78bfa', '#f59e0b', '#10b981', '#f97316', '#3b82f6', '#ef4444']
const farbe = (i) => FARBEN[i % FARBEN.length]
const hex = (f, a) => f + Math.round(a * 255).toString(16).padStart(2, '0')
function useSchmal() {
  const q = '(max-width: 768px)'
  const [s, setS] = useState(() => { try { return window.matchMedia(q).matches } catch { return false } })
  useEffect(() => {
    let m; try { m = window.matchMedia(q) } catch { return }
    const f = () => setS(m.matches)
    m.addEventListener?.('change', f)
    return () => m.removeEventListener?.('change', f)
  }, [])
  return s
}

export default function WerMachtWas({ namen, boards, services, models, aenderungen = {}, kalender = {}, onBoard }) {
  const [suche, setSuche] = useState('')
  const schmal = useSchmal()
  const [fokus, setFokus] = useState(null)      // Desktop: ein Model hervorheben
  const [mobilModel, setMobilModel] = useState(null)
  const [kopfHoehe, setKopfHoehe] = useState(56)
  useEffect(() => { try { const h = document.querySelector('header')?.offsetHeight; if (h) setKopfHoehe(h) } catch { /* egal */ } }, [schmal])
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

  const statusText = (n) => {
    const r = reise[n]
    // v4.97.0: laufender Termin mit „nicht erreichbar" geht vor
    const z = zustand(kontakt(n), r, Date.now(), terminJetzt(kalender[n]))
    return { farbe: z.farbe, text: z.art === 'termin' ? z.text : r ? `✈ ${r.title}${r.date_to ? ` bis ${new Date(r.date_to + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}` : ''}` : z.text }
  }
  const NeuSchild = () => <span style={{ fontSize: 9, fontWeight: 800, color: '#1a1200', background: '#f59e0b', borderRadius: 4, padding: '1px 4px', marginLeft: 5, verticalAlign: 1, letterSpacing: '0.03em' }}>NEU</span>
  const nichts = q && angebot.length === 0 && nogos.length === 0 && !zeigPreise

  const kopf = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
      <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Wer macht was</span>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>deine {namen.length} Models{schmal ? '' : ' nebeneinander'} · Name antippen = ganzes Board</span>
      <div style={{ flex: 1 }} />
      <input value={suche} onChange={e => setSuche(e.target.value)} placeholder="🔍 Suchen, z. B. „Füße“"
        style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '8px 11px', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: 230, maxWidth: '100%' }} />
    </div>
  )

  // ── Handy: ein Model nach dem anderen ────────────────────────────────────
  if (schmal) {
    const aktiv = namen.includes(mobilModel) ? mobilModel : namen[0]
    const i = namen.indexOf(aktiv)
    const f = farbe(i)
    const st = statusText(aktiv)
    const preise = preiseVon(aktiv)
    const meineNogos = (boards[aktiv]?.nogos || []).filter(it => passt(it.title))
    return (
      <div className="wmw" style={{ marginBottom: 14 }}>
        {kopf}
        <div className="wmw-reiter" style={{ position: 'sticky', top: kopfHoehe, zIndex: 20, background: 'var(--bg-base)', padding: '6px 0', display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {namen.map((n, j) => {
            const an = n === aktiv
            return (
              <button key={n} type="button" onClick={() => setMobilModel(n)}
                style={{ flex: '1 0 auto', minWidth: 80, padding: '9px 12px', borderRadius: 12, border: `1px solid ${an ? farbe(j) : 'var(--border)'}`, background: an ? farbe(j) : 'var(--bg-card)', color: an ? '#fff' : 'var(--text-secondary)', fontWeight: 800, fontSize: 13.5, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {n}{reise[n] ? ' ✈' : ''}
              </button>
            )
          })}
        </div>
        <div style={{ marginTop: 8, borderRadius: 16, border: `1px solid ${hex(f, 0.5)}`, overflow: 'hidden', background: 'var(--bg-card)' }}>
          <button type="button" onClick={() => onBoard(aktiv)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', background: `linear-gradient(135deg, ${hex(f, 0.75)}, ${hex(f, 0.3)})`, color: '#fff' }}>
            <b style={{ fontSize: 18, flex: 1 }}>{aktiv}</b>
            <span style={{ fontSize: 11.5, opacity: 0.92 }}>{st.text} · ganzes Board ›</span>
          </button>
          {nichts && <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--text-muted)' }}>Nichts gefunden für „{suche}“.</div>}
          {preise.length > 0 && (
            <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
              <div className="wmw-abschnitt">PREISE · {aktiv.toUpperCase()}</div>
              {preise.map((p, k) => (
                <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '7px 0', borderTop: k ? '1px solid var(--border)' : 'none', fontSize: 14 }}>
                  <span style={{ flex: 1, color: 'var(--text-secondary)', lineHeight: 1.35 }}>{p.title}{neuBei(aktiv, p.title) && <NeuSchild />}</span>
                  {p.price && <b style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{p.price}</b>}
                </div>
              ))}
            </div>
          )}
          {angebot.length > 0 && (
            <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
              <div className="wmw-abschnitt">ANGEBOT</div>
              <div className="raster-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {angebot.map(a => {
                  const c = zelleAngebot(aktiv, a)
                  return (
                    <div key={a.key} style={{ background: 'var(--bg-card2)', borderRadius: 10, padding: '7px 9px', fontSize: 13 }}>
                      <span style={{ color: c.f, fontWeight: 800 }}>{c.t}</span> <span style={{ color: 'var(--text-primary)' }}>{a.label}</span>
                      {c.zusatz && <span style={{ fontSize: 11, color: '#0891b2' }}> ({c.zusatz})</span>}
                      {c.note && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{c.note}</div>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {meineNogos.length > 0 && (
            <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
              <div className="wmw-abschnitt">NO GOS</div>
              <div>
                {meineNogos.map(it => (
                  <span key={it.id || it.title} style={{ display: 'inline-block', fontSize: 12.5, padding: '4px 10px', borderRadius: 20, background: 'rgba(239,68,68,0.13)', color: '#fca5a5', margin: '0 5px 6px 0' }}>✕ {it.title}{neuBei(aktiv, it.title) && <NeuSchild />}</span>
                ))}
              </div>
            </div>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>Oben tippen = nächstes Model. Verbindlich ist immer das ganze Board.</div>
      </div>
    )
  }

  // ── Desktop: Tabelle mit festen Spalten und Farben ───────────────────────
  const spalte = (n) => {
    const j = namen.indexOf(n)
    const blass = fokus && fokus !== n
    return { background: hex(farbe(j), 0.05), borderLeft: '2px solid var(--border)', opacity: blass ? 0.28 : 1, transition: 'opacity .15s', ...(reise[n] ? { backgroundImage: 'linear-gradient(rgba(8,145,178,0.07), rgba(8,145,178,0.07))' } : null) }
  }
  const td = { padding: '9px 10px', fontSize: 13, textAlign: 'center', borderTop: '1px solid var(--border)', verticalAlign: 'top' }
  const tdL = { ...td, textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600, position: 'sticky', left: 0, background: 'var(--bg-card)', zIndex: 1 }
  const grp = (t) => (
    <tr><td colSpan={namen.length + 1} style={{ padding: '8px 10px', fontSize: 10.5, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.08em', background: 'var(--bg-card2)', borderTop: '1px solid var(--border)' }}>{t}</td></tr>
  )
  const breit = namen.length > 4   // ab 5 Models darf seitlich gescrollt werden

  return (
    <div className="wmw" style={{ marginBottom: 14 }}>
      {kopf}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10, fontSize: 12, color: 'var(--text-muted)' }}>
        <span>Fokus:</span>
        <button type="button" onClick={() => setFokus(null)} className="wmw-chip" style={{ background: !fokus ? '#3a3a55' : 'transparent', color: !fokus ? '#fff' : 'var(--text-secondary)', borderColor: !fokus ? 'transparent' : 'var(--border)' }}>Alle</button>
        {namen.map((n, j) => (
          <button key={n} type="button" onClick={() => setFokus(fokus === n ? null : n)} className="wmw-chip" style={{ background: fokus === n ? farbe(j) : 'transparent', color: fokus === n ? '#fff' : 'var(--text-secondary)', borderColor: fokus === n ? 'transparent' : 'var(--border)' }}>{n}</button>
        ))}
        <span>· blendet die anderen blass</span>
      </div>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflowX: breit ? 'auto' : 'visible' }}>
        <table className="wmw-tabelle" style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', tableLayout: 'fixed', minWidth: breit ? 190 + namen.length * 220 : undefined, whiteSpace: 'normal', display: 'table' }}>
          <colgroup><col style={{ width: 190 }} />{namen.map(n => <col key={n} />)}</colgroup>
          <thead>
            <tr>
              <th style={{ position: 'sticky', top: breit ? undefined : kopfHoehe, left: 0, zIndex: 4, background: 'var(--bg-card)', borderTopLeftRadius: 16 }} />
              {namen.map((n, j) => {
                const st = statusText(n)
                return (
                  <th key={n} style={{ position: breit ? undefined : 'sticky', top: kopfHoehe, zIndex: 3, background: 'var(--bg-card)', padding: '12px 10px 10px', textAlign: 'center', borderLeft: '2px solid var(--border)', borderBottom: '1px solid var(--border)', boxShadow: `inset 0 3px 0 ${farbe(j)}`, opacity: fokus && fokus !== n ? 0.35 : 1 }}>
                    <button type="button" onClick={() => onBoard(n)} title="Ganzes Board öffnen" className="wmw-name" style={{ background: farbe(j) }}>{n}</button>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: st.farbe, marginTop: 4 }}>{st.text}</div>
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
                    <td key={n} style={{ ...td, ...spalte(n), color: c.f, fontWeight: 800 }}>
                      {c.t}{c.zusatz && <span style={{ fontSize: 10.5, fontWeight: 500, color: '#0891b2' }}> ({c.zusatz})</span>}
                      {c.note && <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', marginTop: 2 }}>{c.note}</div>}
                    </td>
                  )
                })}
              </tr>
            ))}

            {zeigPreise && grp('PREISE · jedes Model hat seine eigene Karte')}
            {zeigPreise && (
              <tr>
                <td style={tdL}>Preise</td>
                {namen.map((n, j) => {
                  const liste = preiseVon(n)
                  const f = farbe(j)
                  return (
                    <td key={n} style={{ ...td, ...spalte(n), textAlign: 'left' }}>
                      {liste.length === 0 ? <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>–</div> : (
                        <div style={{ borderRadius: 12, border: `1px solid ${hex(f, 0.45)}`, overflow: 'hidden' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 800, padding: '6px 10px', color: '#fff', background: hex(f, 0.55), letterSpacing: '0.03em' }}>
                            <span>{n.toUpperCase()} · PREISE</span><span>{liste.length}</span>
                          </div>
                          {liste.map(p => (
                            <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '6px 10px', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: 12.5 }}>
                              <span style={{ flex: 1, color: 'var(--text-secondary)', lineHeight: 1.35, minWidth: 0 }}>{p.title}{neuBei(n, p.title) && <NeuSchild />}</span>
                              {p.price && <b style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{p.price}</b>}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            )}

            {nogos.length > 0 && grp('NO GOS')}
            {nogos.map(t => (
              <tr key={t}>
                <td style={tdL}>{t}</td>
                {namen.map(n => {
                  const ja = hatNogo(n, t)
                  return <td key={n} style={{ ...td, ...spalte(n), color: ja ? '#ef4444' : '#3a3a55', fontWeight: 800 }}>{ja ? '✕' : '–'}{ja && neuBei(n, t) && <NeuSchild />}</td>
                })}
              </tr>
            ))}

            {nichts && (
              <tr><td colSpan={namen.length + 1} style={{ ...td, color: 'var(--text-muted)' }}>Nichts gefunden für „{suche}“.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>✕ bei No Gos = gilt für dieses Model · – = nicht eingetragen. Verbindlich ist immer das ganze Board.</div>
    </div>
  )
}
