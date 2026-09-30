import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { supabase } from '../supabase'
import { logActivity } from '../activity'

// ── Wirkung als Kurve (v5.5.0) ─────────────────────────────────────────────
// Pro Account: Aufrufe nach Tagen seit dem Posten. Jede Linie ist eines
// unserer Reels (Pink = mit Skript, Lila = ohne Skript). Grau gestrichelt =
// typischer Verlauf der eigenen Reels des Models (Median, nur solange noch
// mindestens 3 Reels so alt sind — sonst springt die Linie). Ein Reel in der
// Liste antippen → seine Linie wird hervorgehoben.
//
// Faktor (v5.6.0, rechnet das Dashboard selbst): Aufrufe des Reels an Tag 7
// geteilt durch den Median der früheren Reels desselben Accounts (60 Tage vor
// dem Posten, mind. 3) ebenfalls an Tag 7 — also bei gleichem Alter. Jüngere
// Reels: am heutigen Tag verglichen, grau mit * („vorläufig“). Fehlen
// Vergleichsreels mit Verlauf, steht der grobe Faktor der Pipeline da (~).
//
// Bereinigung Altdaten (Hinweis Pipeline 30.09.): bis einschließlich 30.09.
// kamen manche Reels mehrere Nächte mit altem Stand an. Aufeinanderfolgende
// Messpunkte mit exakt gleichen Aufrufen/Likes/Kommentaren zählen als einer.
//
// Messfenster (sql/reel-messfenster.sql): 30 Tage ab Posten, danach
// abgeschlossen. „+30 Tage“ verlängert, beliebig oft. Die Pipeline misst nur,
// was in lyra.reel_messplan noch_messen = true hat.

const P = '#ec4899', V = '#8b5cf6', GR = '#8a8a99', G = '#10b981', ROT = '#ef4444', A = '#f59e0b', C = '#06b6d4'
const FENSTER = 30
const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 15px' }
const klein = { fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }
const knopf = (f, voll) => ({ padding: '5px 11px', borderRadius: 9, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', border: voll ? 'none' : `1px solid ${f}`, background: voll ? f : 'transparent', color: voll ? '#fff' : f, whiteSpace: 'nowrap' })
const farbe = (art) => art === 'skript' ? P : art === 'ohne_skript' ? V : GR
const faktorFarbe = (f) => f === null || f === undefined ? 'var(--text-muted)' : f >= 1.5 ? G : f < 0.7 ? ROT : 'var(--text-primary)'
const tagIso = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
const plusTage = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return tagIso(d) }
const tageZwischen = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000)
const median = (arr) => { const a = arr.filter(x => x !== null && x !== undefined).map(Number).sort((x, y) => x - y); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2 }
const kurz = (n) => n === null || n === undefined ? '—' : n >= 1000000 ? (n / 1000000).toFixed(1).replace('.', ',') + ' Mio' : n >= 10000 ? Math.round(n / 1000) + 'k' : Number(n).toLocaleString('de-DE')
const faktorText = (f) => f === null || f === undefined ? '—' : Number(f).toFixed(1).replace('.', ',') + '×'

// Tag seit Posten für eine Messung (Alter in Stunden, sonst Kalendertage)
const tagVon = (m) => m.alter_std !== null && m.alter_std !== undefined ? Math.floor(Number(m.alter_std) / 24) : (m.gepostet_am ? Math.max(0, tageZwischen(tagIso(m.gepostet_am), m.mess_tag || tagIso(m.gemessen_am))) : null)

const ALTDATEN_BIS = '2026-09-30'   // bis hierhin konnten alte Stände mehrfach ankommen

// Aufrufe an Tag t: gemessen oder zwischen zwei Messpunkten geschätzt (nie darüber hinaus)
function wertAm(r, t) {
  if (r.tage[t]) return r.tage[t].v
  const vor = r.ts.filter(x => x < t).pop(), nach = r.ts.find(x => x > t)
  if (vor === undefined || nach === undefined) return null
  const a = r.tage[vor].v, b = r.tage[nach].v
  return a + (b - a) * (t - vor) / (nach - vor)
}

function Mini({ punkte, f }) {
  if (!punkte.length) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
  const w = 110, h = 26, mx = Math.max(...punkte.map(p => p.v), 1), md = Math.max(...punkte.map(p => p.t), 1)
  const d = punkte.map((p, i) => `${i ? 'L' : 'M'}${(p.t / md * (w - 4) + 2).toFixed(1)},${(h - 2 - p.v / mx * (h - 4)).toFixed(1)}`).join(' ')
  return <svg width={w} height={h} style={{ display: 'block' }}><path d={d} fill="none" stroke={f} strokeWidth="2" strokeLinejoin="round" /></svg>
}

export default function WirkungKurven({ accounts = [], darfVerlaengern = true, userDisplayName }) {
  // accounts: ['@handle', …] — betreute Accounts aus der Steuerung
  const liste = useMemo(() => [...new Set(accounts.map(a => String(a).toLowerCase()))].sort(), [accounts.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const [acc, setAcc] = useState(liste[0] || '')
  const [zeilen, setZeilen] = useState(null)
  const [fenster, setFenster] = useState({})
  const [fehlt, setFehlt] = useState({ mess: false, fenster: false })
  const [wahl, setWahl] = useState(null)       // shortcode, dessen Kurve dick gezeigt wird
  const [alle, setAlle] = useState(false)      // abgeschlossene zeigen
  const [hinweis, setHinweis] = useState('')
  useEffect(() => { if (!liste.includes(acc)) setAcc(liste[0] || '') }, [liste.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const laden = useCallback(async () => {
    if (!acc) { setZeilen([]); return }
    const seit = new Date(Date.now() - 180 * 86400000).toISOString()
    const m = await supabase.from('reel_messwerte')
      .select('shortcode, reel_url, art, skript_nr, gepostet_am, gemessen_am, mess_tag, alter_std, plays, likes, comments, faktor')
      .eq('account', acc).gte('gepostet_am', seit).order('gemessen_am').limit(8000)
    if (m.error) { setFehlt(x => ({ ...x, mess: true })); setZeilen([]); return }
    setZeilen(m.data || [])
    const codes = [...new Set((m.data || []).map(x => x.shortcode))]
    if (codes.length) {
      const f = await supabase.from('reel_messfenster').select('shortcode, messen_bis, verlaengert_von').in('shortcode', codes)
      if (f.error) setFehlt(x => ({ ...x, fenster: true }))
      else setFenster(Object.fromEntries((f.data || []).map(x => [x.shortcode, x])))
    }
  }, [acc])
  useEffect(() => { setWahl(null); laden() }, [laden])

  // Reels zusammenfassen: je Reel die Messreihe nach Tag
  const reels = useMemo(() => {
    const map = {}
    for (const z of zeilen || []) {
      const t = tagVon(z); if (t === null) continue
      const r = map[z.shortcode] || (map[z.shortcode] = { code: z.shortcode, url: z.reel_url, art: z.art, nr: z.skript_nr, gepostet: z.gepostet_am, tage: {}, zuletzt: null })
      r.art = z.art; r.nr = z.skript_nr || r.nr   // letzter Stand gewinnt (Skript hat Vorrang in der DB)
      const stand = `${z.plays}|${z.likes}|${z.comments}`
      const tag = z.mess_tag || tagIso(z.gemessen_am)
      if (tag <= ALTDATEN_BIS && stand === r.zuletzt) continue   // alter Stand erneut gesendet → kein neuer Messpunkt
      r.zuletzt = stand
      r.tage[t] = { v: Number(z.plays || 0), f: z.faktor === null || z.faktor === undefined ? null : Number(z.faktor) }
    }
    const heute = tagIso(new Date())
    const liste = Object.values(map).map(r => {
      const ts = Object.keys(r.tage).map(Number).sort((a, b) => a - b)
      const letzt = r.tage[ts[ts.length - 1]]
      const start = r.gepostet ? tagIso(r.gepostet) : heute
      const bis = fenster[r.code]?.messen_bis || plusTage(start, FENSTER)
      const alter = tageZwischen(start, heute)
      // wächst noch? letzte 3 Messtage > 10 % Zuwachs
      const vor = ts.filter(t => t <= ts[ts.length - 1] - 3).pop()
      const waechst = vor !== undefined && r.tage[vor].v > 0 && (letzt.v - r.tage[vor].v) / r.tage[vor].v > 0.1
      return {
        ...r, ts, plays: letzt.v, alter, bis, laenge: tageZwischen(start, bis), start,
        faktorPipeline: letzt.f,
        offen: heute <= bis, waechst, verlaengert: !!fenster[r.code],
        punkte: ts.map(t => ({ t, v: r.tage[t].v })),
      }
    }).sort((a, b) => String(b.gepostet).localeCompare(String(a.gepostet)))
    // Faktor bei gleichem Alter (Tag 7, bei jüngeren Reels: heute)
    for (const r of liste) {
      const t = Math.min(7, r.alter)
      const v = wertAm(r, t)
      const vor = liste.filter(o => o.code !== r.code && o.gepostet && r.gepostet && o.gepostet < r.gepostet
        && (new Date(r.gepostet) - new Date(o.gepostet)) <= 60 * 86400000)
      const basis = median(vor.map(o => wertAm(o, t)))
      const anzahl = vor.filter(o => wertAm(o, t) !== null).length
      if (v !== null && basis && anzahl >= 3) { r.faktor = v / basis; r.fArt = 'alter' }
      else { r.faktor = r.faktorPipeline; r.fArt = 'grob' }
      r.fTag = t; r.vorlaeufig = r.alter < 7
    }
    return liste
  }, [zeilen, fenster])

  const unsere = reels.filter(r => r.art !== 'vergleich')
  const eigene = reels.filter(r => r.art === 'vergleich')
  const letzte30 = (r) => r.alter <= 30

  // Kurven: Median je Tag und Gruppe
  const maxTag = Math.min(90, Math.max(FENSTER, ...reels.filter(r => r.offen || letzte30(r)).map(r => r.ts[r.ts.length - 1] || 0)))
  const gewaehlt = reels.find(r => r.code === wahl)
  const linien = useMemo(() => reels.filter(r => r.art !== 'vergleich' && (alle || r.offen || r.alter <= 30)), [reels, alle])
  const daten = useMemo(() => {
    const eig = reels.filter(r => r.art === 'vergleich' && r.alter <= 90)
    return [...Array(maxTag + 1)].map((_, t) => {
      const zeile = { tag: t }
      const werte = eig.map(r => r.tage[t]?.v).filter(v => v !== undefined)
      if (werte.length >= 3) zeile.vergleich = Math.round(median(werte))
      for (const r of linien) if (r.tage[t]) zeile['r_' + r.code] = r.tage[t].v
      return zeile
    })
  }, [reels, linien, maxTag])
  const hat = (k) => k === 'vergleich' ? daten.some(d => d.vergleich !== undefined) : linien.some(r => r.art === k)

  const kpi = {
    anzahl: unsere.filter(letzte30).length,
    fUns: median(unsere.filter(r => letzte30(r) && !r.vorlaeufig && r.fArt === 'alter').map(r => r.faktor)),
    fEigen: median(eigene.filter(r => letzte30(r) && !r.vorlaeufig && r.fArt === 'alter').map(r => r.faktor)),
    bestes: [...unsere.filter(letzte30)].sort((a, b) => b.plays - a.plays)[0],
  }

  const verlaengern = async (r) => {
    setHinweis('')
    const neu = plusTage(r.offen ? r.bis : tagIso(new Date()), FENSTER)
    if (!window.confirm(`Reel ${r.nr || r.code} weitere 30 Tage beobachten?\n\nGemessen wird dann bis ${new Date(neu + 'T12:00:00').toLocaleDateString('de-DE')}.`)) return
    const { error } = await supabase.from('reel_messfenster').upsert({ shortcode: r.code, messen_bis: neu, verlaengert_von: userDisplayName || null }, { onConflict: 'shortcode' })
    if (error) { setHinweis('Nicht gespeichert: ' + error.message); return }
    try { logActivity('reel.messfenster', { entity: acc, detail: `${r.nr || r.code} bis ${neu}` }) } catch { /* nur Protokoll */ }
    laden()
  }

  if (!liste.length) return null
  const sichtbar = unsere.filter(r => alle || r.offen || letzte30(r))
  const tipp = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const namen = { vergleich: 'Model selbst (typisch)' }
    for (const r of linien) namen['r_' + r.code] = `${r.nr || 'ohne Skript'} · ${new Date(r.start + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`
    return (
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 11px', fontSize: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 3 }}>Tag {label}</div>
        {[...payload].sort((a, b) => b.value - a.value).slice(0, 8).map(p => <div key={p.dataKey} style={{ color: p.stroke }}>{namen[p.dataKey]}: {Number(p.value).toLocaleString('de-DE')} Aufrufe</div>)}
      </div>
    )
  }

  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', flex: 1 }}>Wirkung</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Jedes Reel wird {FENSTER} Tage beobachtet, verlängerbar um je {FENSTER} Tage.</div>
      </div>

      {/* Account wählen */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {liste.map(a => (
          <button key={a} type="button" onClick={() => setAcc(a)}
            style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${a === acc ? P : 'var(--border)'}`, background: a === acc ? 'rgba(236,72,153,0.14)' : 'transparent', color: a === acc ? P : 'var(--text-secondary)' }}>{a}</button>
        ))}
      </div>

      {fehlt.mess && <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Messwerte: Datenbank noch nicht eingerichtet.</div>}
      {zeilen && !fehlt.mess && !reels.length && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 10, padding: '9px 11px' }}>Für {acc} gibt es noch keine Messwerte. Das Sammel-Skript trägt sie jede Nacht ein.</div>}

      {reels.length > 0 && (<>
        {/* Kennzahlen */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {[
            ['Unsere Reels, 30 Tage', kpi.anzahl, 'var(--text-primary)'],
            ['Faktor an Tag 7 · unsere', faktorText(kpi.fUns), faktorFarbe(kpi.fUns)],
            ['Faktor an Tag 7 · Model selbst', faktorText(kpi.fEigen), faktorFarbe(kpi.fEigen)],
            ['Bestes Reel, 30 Tage', kpi.bestes ? `${kpi.bestes.nr || 'ohne Skript'} · ${kurz(kpi.bestes.plays)}` : '—', 'var(--text-primary)'],
          ].map(([l, v, f]) => (
            <div key={l} style={{ background: 'var(--bg-card2)', borderRadius: 12, padding: '10px 12px' }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{l}</div>
              <div style={{ fontSize: 21, fontWeight: 800, color: f, marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Kurve */}
        <div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 6 }}>
            <span style={{ fontWeight: 800, color: 'var(--text-primary)', flex: 1, minWidth: 200 }}>Aufrufe nach Tagen seit dem Posten</span>
            {hat('skript') && <span><span style={{ display: 'inline-block', width: 12, height: 3, background: P, verticalAlign: 'middle' }} /> Reel mit Skript</span>}
            {hat('ohne_skript') && <span><span style={{ display: 'inline-block', width: 12, height: 3, background: V, verticalAlign: 'middle' }} /> Reel ohne Skript (von uns)</span>}
            {hat('vergleich') && <span><span style={{ display: 'inline-block', width: 12, height: 0, borderTop: `2px dashed ${GR}`, verticalAlign: 'middle' }} /> Model selbst, typisch</span>}
            {gewaehlt && <span style={{ color: C }}>{gewaehlt.nr || 'ohne Skript'} hervorgehoben <button type="button" onClick={() => setWahl(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}>✕</button></span>}
          </div>
          <div style={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={daten} margin={{ top: 6, right: 12, left: 0, bottom: 2 }}>
                <CartesianGrid stroke="rgba(128,128,160,0.15)" vertical={false} />
                <XAxis dataKey="tag" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={t => `Tag ${t}`} interval="preserveStartEnd" minTickGap={24} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={kurz} width={48} />
                <Tooltip content={tipp} />
                {hat('vergleich') && <Line type="monotone" dataKey="vergleich" stroke={GR} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />}
                {[...linien].sort((a, b) => (a.code === wahl) - (b.code === wahl)).map(r => (
                  <Line key={r.code} type="monotone" dataKey={'r_' + r.code} stroke={farbe(r.art)} dot={r.code === wahl ? { r: 2.5 } : false} connectNulls isAnimationActive={false}
                    strokeWidth={r.code === wahl ? 4 : 2} strokeOpacity={wahl && r.code !== wahl ? 0.25 : 0.9} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Reels */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ ...klein, flex: 1 }}>Unsere Reels · antippen zeigt die Kurve</span>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={alle} onChange={e => setAlle(e.target.checked)} /> auch ältere abgeschlossene
            </label>
          </div>
          {!sichtbar.length && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '6px 0' }}>Noch keine Reels von uns auf {acc}.</div>}
          <div style={{ overflowX: 'auto' }}>
            {sichtbar.map(r => {
              const f = r.faktor
              const an = wahl === r.code
              return (
                <div key={r.code} onClick={() => setWahl(an ? null : r.code)}
                  style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 1.4fr) 120px 110px 80px 90px minmax(120px, auto)', gap: 10, alignItems: 'center', padding: '8px 6px', borderTop: '1px solid var(--border)', fontSize: 13, cursor: 'pointer', minWidth: 720, background: an ? 'rgba(6,182,212,0.08)' : 'transparent', borderRadius: an ? 8 : 0, opacity: r.offen ? 1 : 0.65 }}>
                  <span>
                    <b style={{ color: farbe(r.art) }}>{r.nr || 'ohne Skript'}</b>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}> · {new Date(r.start + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</span>
                    {r.url && <a href={r.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: C, fontSize: 11.5, marginLeft: 6 }}>ansehen</a>}
                  </span>
                  <Mini punkte={r.punkte} f={farbe(r.art)} />
                  <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                    {r.offen ? <>Tag {Math.min(r.alter, r.laenge)} / {r.laenge}</> : <span>abgeschlossen</span>}
                    {r.verlaengert && <span title={fenster[r.code]?.verlaengert_von ? `verlängert von ${fenster[r.code].verlaengert_von}` : ''} style={{ color: C }}> · verl.</span>}
                  </span>
                  <b>{kurz(r.plays)}</b>
                  <span title={r.fArt === 'grob' ? 'Grob (Pipeline): gegen den Endstand früherer Reels, noch zu wenig Verlauf für den Vergleich bei gleichem Alter' : r.vorlaeufig ? `Noch keine 7 Tage alt: verglichen an Tag ${r.fTag}, vorläufig` : 'An Tag 7 verglichen mit den früheren Reels des Accounts an Tag 7'}
                    style={{ fontWeight: 800, color: r.vorlaeufig || r.fArt === 'grob' ? 'var(--text-muted)' : faktorFarbe(f) }}>{r.fArt === 'grob' && f !== null && f !== undefined ? '~' : ''}{faktorText(f)}{r.vorlaeufig && f !== null && f !== undefined ? ' *' : ''}</span>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                    {r.waechst && (r.laenge - r.alter <= 5 || !r.offen) && <span style={{ fontSize: 11, fontWeight: 800, color: A }}>↗ wächst noch</span>}
                    {darfVerlaengern && !fehlt.fenster && (r.laenge - r.alter <= 5 || !r.offen) && (
                      <button type="button" onClick={e => { e.stopPropagation(); verlaengern(r) }} style={knopf(C, false)}>+30 Tage</button>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>Faktor = Aufrufe an Tag 7 im Vergleich zu den früheren Reels des Accounts an Tag 7. * noch keine 7 Tage alt, vorläufig. ~ grob, noch zu wenig Verlauf zum Vergleichen. „+30 Tage“ erscheint in den letzten 5 Tagen des Fensters und bei abgeschlossenen Reels.</div>
          {fehlt.fenster && <div style={{ fontSize: 11.5, color: A, marginTop: 4 }}>Verlängern geht erst, wenn <code>sql/reel-messfenster.sql</code> ausgeführt ist.</div>}
          {hinweis && <div style={{ fontSize: 12.5, color: ROT, marginTop: 4 }}>{hinweis}</div>}
        </div>
      </>)}
    </div>
  )
}
