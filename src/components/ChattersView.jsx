import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import Card from './Card'
import Icon from './Icon'
import RevenueTrendChart from './RevenueTrendChart'
import RankingBar from './RankingBar'
import DeltaList from './DeltaList'
import Heatmap from './Heatmap'
import FallingAlert from './FallingAlert'
import { formatMoney, pctChange, safeDivide, getLast7Snapshots, getPreviousSnapshot, computeChatterStatus, computeChatterTrendFromSnapshots } from '../utils'
// v4.27.0: Zielwerte je Chatter (Mindest-$/Std je Schicht + Monats-Verdienstziel).
// Die Rechnung liegt bewusst in einer eigenen Datei, damit Chatter-Ansicht und
// Admin-Glocke garantiert dieselben Zahlen zeigen.
import {
  ladeChatterZiele, ladeSchichtstunden, berechneChatterZiele, berechneZielAlerts,
  minRphFuerSchicht, ZIEL_SCHICHTEN, STANDARD_ZIEL,
} from '../chatterTargets'

const statusColors = {
  'Strong': 'var(--green)',
  'Stabil': 'var(--cyan)',
  'Unter Minimum': 'var(--yellow)',
  'Schwach': 'var(--red)',
  'Price Drop': 'var(--yellow)',
  'Activity Issue': 'var(--orange)',
  'Quality Issue': 'var(--red)',
  'Kurze Schicht': 'var(--text-muted)',
  'Inaktiv': 'var(--text-muted)',
  'Instabil': 'var(--orange)',
}
const trendColors = {
  'Steigend': 'var(--green)',
  'Fallend': 'var(--red)',
  'Seitwärts': 'var(--text-secondary)',
  'Instabil': 'var(--orange)',
}

function isDeletedUser(name) {
  if (!name) return true
  // Match any name containing stars – deleted users
  return name.includes('*')
}

function computeChatterTrend(snapshots, name) {
  return computeChatterTrendFromSnapshots(snapshots, name)
}

// ============================================================
// v3.4.0: Health Scores
// Erkennt nachhaltige Chatter vs. aggressive Kurzfrist-Seller
// Basis: chatter_snapshots.rows mit buyRate, sentPPVs, boughtPPVs,
//        revenue, avgResponseSeconds, avgRevenuePerBoughtPPV
// ============================================================

// Hole letzte 14 Tage aktive Snapshots eines Chatters (≥50 msg + ≥60 active min)
function getActiveDaysForChatter(snapshots, name, selectedDate, days = 14) {
  const sortedDesc = [...snapshots].sort((a, b) => b.businessDate.localeCompare(a.businessDate))
  const cutoffIdx = sortedDesc.findIndex(s => s.businessDate === selectedDate)
  if (cutoffIdx === -1) return []
  const window = sortedDesc.slice(cutoffIdx, cutoffIdx + days)
  return window
    .map(s => s.rows.find(rr => rr.name === name))
    .filter(r => r && (r.sentMessages || 0) >= 50 && (r.activeMinutes || 0) >= 60)
}

// Spam Score: Sent/Bought Ratio (0–100, höher = besser/gesünder)
function computeSpamScore(rows) {
  if (rows.length === 0) return { score: null, color: 'gray', ratio: null }
  const totalSent = rows.reduce((s, r) => s + (r.sentPPVs || 0), 0)
  const totalBought = rows.reduce((s, r) => s + (r.boughtPPVs || 0), 0)
  if (totalBought === 0) return { score: 0, color: 'red', ratio: null }
  const ratio = totalSent / totalBought
  // < 2.5 grün, 2.5–4.0 gelb, > 4.0 rot
  let score, color
  if (ratio < 2.5) { score = 100 - (ratio / 2.5) * 30; color = 'green' }
  else if (ratio < 4.0) { score = 70 - ((ratio - 2.5) / 1.5) * 30; color = 'yellow' }
  else { score = Math.max(0, 40 - (ratio - 4.0) * 8); color = 'red' }
  return { score: Math.round(score), color, ratio: parseFloat(ratio.toFixed(2)) }
}

// Consistency Score: niedrige Standardabweichung relativ zu Durchschnitt (Std/Avg)
function computeConsistencyScore(rows) {
  if (rows.length < 3) return { score: null, color: 'gray', cv: null }
  const revs = rows.map(r => r.revenue || 0)
  const avg = revs.reduce((s, v) => s + v, 0) / revs.length
  if (avg === 0) return { score: 0, color: 'red', cv: null }
  const variance = revs.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / revs.length
  const std = Math.sqrt(variance)
  const cv = std / avg // coefficient of variation
  // < 0.30 grün, 0.30–0.60 gelb, > 0.60 rot
  let score, color
  if (cv < 0.30) { score = 100 - (cv / 0.30) * 30; color = 'green' }
  else if (cv < 0.60) { score = 70 - ((cv - 0.30) / 0.30) * 30; color = 'yellow' }
  else { score = Math.max(0, 40 - (cv - 0.60) * 50); color = 'red' }
  return { score: Math.round(score), color, cv: parseFloat(cv.toFixed(2)) }
}

// Buy Rate Score: User-Schwellen: >40 grün, >30 gelb, drunter rot
function computeBuyRateScore(rows) {
  if (rows.length === 0) return { score: null, color: 'gray', avg: null }
  const avg = rows.reduce((s, r) => s + (r.buyRate || 0), 0) / rows.length
  let score, color
  if (avg > 40) { score = Math.min(100, 70 + (avg - 40) * 1.5); color = 'green' }
  else if (avg > 30) { score = 40 + (avg - 30) * 3; color = 'yellow' }
  else { score = Math.max(0, avg * 1.3); color = 'red' }
  return { score: Math.round(score), color, avg: parseFloat(avg.toFixed(1)) }
}

// Response Time Score: <60s grün, 60–180s gelb, >180s rot
function computeResponseScore(rows) {
  const validRows = rows.filter(r => (r.avgResponseSeconds || 0) > 0)
  if (validRows.length === 0) return { score: null, color: 'gray', avg: null }
  const avg = validRows.reduce((s, r) => s + (r.avgResponseSeconds || 0), 0) / validRows.length
  let score, color
  if (avg < 60) { score = 100 - (avg / 60) * 20; color = 'green' }
  else if (avg < 180) { score = 80 - ((avg - 60) / 120) * 40; color = 'yellow' }
  else { score = Math.max(0, 40 - (avg - 180) / 10); color = 'red' }
  return { score: Math.round(score), color, avg: Math.round(avg) }
}

// Whale Dependency: avgPPV > 80 UND wenig bought → rote Flagge
function computeWhaleScore(rows) {
  if (rows.length === 0) return { score: null, color: 'gray', avgPPV: null, avgBought: null }
  const avgPPV = rows.reduce((s, r) => s + (r.avgRevenuePerBoughtPPV || 0), 0) / rows.length
  const avgBought = rows.reduce((s, r) => s + (r.boughtPPVs || 0), 0) / rows.length
  // Whale-Pattern: hohe avgPPV mit niedriger Stückzahl
  let score, color
  if (avgPPV > 80 && avgBought < 5) { score = 25; color = 'red' }
  else if (avgPPV > 80) { score = 50; color = 'yellow' }
  else if (avgPPV > 40) { score = 75; color = 'yellow' }
  else { score = 95; color = 'green' }
  return { score, color, avgPPV: parseFloat(avgPPV.toFixed(1)), avgBought: parseFloat(avgBought.toFixed(1)) }
}

// Silent Decline: 5-Tage gleitender Durchschnitt seit ≥7 Tagen rückläufig
function computeSilentDecline(rows) {
  if (rows.length < 8) return false
  const revs = rows.map(r => r.revenue || 0).reverse() // chronologisch
  // 5-Tage MA für die letzten Tage
  const ma5 = []
  for (let i = 4; i < revs.length; i++) {
    const slice = revs.slice(i - 4, i + 1)
    ma5.push(slice.reduce((s, v) => s + v, 0) / 5)
  }
  if (ma5.length < 3) return false
  // Sinkend wenn letzte 3 MA-Punkte monoton fallend
  return ma5[ma5.length - 1] < ma5[ma5.length - 2] && ma5[ma5.length - 2] < ma5[ma5.length - 3]
}

// Sustainability Score (Master): gewichtete Kombination
// 25% Buy Rate · 25% Consistency · 20% Spam-Inverse · 15% Response · 15% Whale-Inverse
function computeSustainabilityScore(buyRate, consistency, spam, response, whale) {
  const sub = [
    { val: buyRate.score, w: 0.25 },
    { val: consistency.score, w: 0.25 },
    { val: spam.score, w: 0.20 },
    { val: response.score, w: 0.15 },
    { val: whale.score, w: 0.15 },
  ].filter(s => s.val !== null)
  if (sub.length === 0) return { score: null, color: 'gray' }
  const totalW = sub.reduce((s, x) => s + x.w, 0)
  const weighted = sub.reduce((s, x) => s + x.val * x.w, 0) / totalW
  const score = Math.round(weighted)
  let color
  if (score >= 75) color = 'green'
  else if (score >= 55) color = 'yellow'
  else color = 'red'
  return { score, color }
}

// Master-Funktion pro Chatter
function computeChatterHealth(snapshots, name, selectedDate) {
  const rows = getActiveDaysForChatter(snapshots, name, selectedDate, 14)
  // Defensive: min 5 aktive Tage für aussagekräftige Scores
  const hasEnoughData = rows.length >= 5
  if (!hasEnoughData) {
    return {
      hasEnoughData: false,
      activeDays: rows.length,
      sustainability: { score: null, color: 'gray' },
      spam: { score: null, color: 'gray', ratio: null },
      consistency: { score: null, color: 'gray', cv: null },
      buyRate: { score: null, color: 'gray', avg: null },
      response: { score: null, color: 'gray', avg: null },
      whale: { score: null, color: 'gray', avgPPV: null, avgBought: null },
      silentDecline: false,
      warnings: [],
    }
  }

  const spam = computeSpamScore(rows)
  const consistency = computeConsistencyScore(rows)
  const buyRate = computeBuyRateScore(rows)
  const response = computeResponseScore(rows)
  const whale = computeWhaleScore(rows)
  const silentDecline = computeSilentDecline(rows)
  const sustainability = computeSustainabilityScore(buyRate, consistency, spam, response, whale)

  // Relationship Health = Sustainability minus Penalty bei Silent Decline
  const relationship = {
    score: sustainability.score !== null
      ? Math.max(0, sustainability.score - (silentDecline ? 25 : 0))
      : null,
    color: 'green',
  }
  if (relationship.score !== null) {
    relationship.color = relationship.score >= 75 ? 'green' : relationship.score >= 55 ? 'yellow' : 'red'
  }

  // Warnungen ableiten
  const warnings = []

  // 1. Possible Fan Burnout: Sent steigt stark + Buy Rate fällt (letzte 7 vs erste 7 Tage)
  if (rows.length >= 8) {
    const recent = rows.slice(0, Math.floor(rows.length / 2))
    const older = rows.slice(Math.floor(rows.length / 2))
    const recentSent = recent.reduce((s, r) => s + (r.sentPPVs || 0), 0) / recent.length
    const olderSent = older.reduce((s, r) => s + (r.sentPPVs || 0), 0) / older.length
    const recentBR = recent.reduce((s, r) => s + (r.buyRate || 0), 0) / recent.length
    const olderBR = older.reduce((s, r) => s + (r.buyRate || 0), 0) / older.length
    if (recentSent > olderSent * 1.3 && recentBR < olderBR * 0.85) {
      warnings.push({ type: 'fan_burnout', severity: 'critical', label: 'Possible Fan Burnout' })
    }
  }

  // 2. Whale Carry Risk: hohe avgPPV + wenig Käufe
  if (whale.avgPPV !== null && whale.avgPPV > 80 && whale.avgBought < 5) {
    warnings.push({ type: 'whale_carry', severity: 'warning', label: 'Whale Carry Risk' })
  }

  // 3. Unstable Performance: hohe Schwankung
  if (consistency.cv !== null && consistency.cv > 0.60) {
    warnings.push({ type: 'unstable', severity: 'warning', label: 'Unstable Performance' })
  }

  // 4. Healthy Long-Term Chatter (positiv): alles grün
  if (sustainability.score !== null && sustainability.score >= 80
      && spam.color === 'green' && consistency.color === 'green'
      && buyRate.color === 'green' && !silentDecline) {
    warnings.push({ type: 'healthy', severity: 'positive', label: 'Healthy Long-Term Chatter' })
  }

  // 5. Spam Risk: Sent/Bought zu hoch
  if (spam.ratio !== null && spam.ratio > 4.0) {
    warnings.push({ type: 'spam_risk', severity: 'critical', label: 'Spam Risk' })
  }

  // 6. Silent Decline
  if (silentDecline) {
    warnings.push({ type: 'silent_decline', severity: 'warning', label: 'Silent Decline' })
  }

  return {
    hasEnoughData: true,
    activeDays: rows.length,
    sustainability,
    relationship,
    spam,
    consistency,
    buyRate,
    response,
    whale,
    silentDecline,
    warnings,
  }
}

// Color-Mapper für Score-Visualisierung
function scoreColor(color) {
  switch (color) {
    case 'green': return 'var(--green)'
    case 'yellow': return 'var(--yellow)'
    case 'red': return 'var(--red)'
    default: return 'var(--text-muted)'
  }
}
function scoreBg(color) {
  switch (color) {
    case 'green': return 'rgba(16,185,129,0.12)'
    case 'yellow': return 'rgba(245,158,11,0.12)'
    case 'red': return 'rgba(239,68,68,0.12)'
    default: return 'rgba(255,255,255,0.03)'
  }
}


// ============================================================================
// v4.27.0 — Ziele & Verdienst
//
// Das Chatter-Gegenstück zur Tagesziel-Tabelle der Models. Zwei Dinge stehen
// hier bewusst nebeneinander:
//   $/Aktivstd   — wie gut jemand arbeitet
//   $/Schichtstd — was die bezahlte Schicht tatsächlich einbringt
// und darunter die Hochrechnung, was am Monatsende an Provision rauskommt.
// Ohne diese dritte Zahl sieht man einen Chatter mit ordentlichen Stundenwerten
// und zu wenigen Schichten nicht — genau der Fall, der hier gefehlt hat.
// ============================================================================
function ChatterZieleCard({ zielDaten, ziele, onZielGespeichert, isMobile }) {
  const [offen, setOffen] = useState(null)      // Chatter mit aufgeklappten Schicht-Zielen
  const [speichert, setSpeichert] = useState(null)

  const speichereFeld = async (chatterName, feld, rohWert) => {
    const leer = rohWert === '' || rohWert === null || rohWert === undefined
    const wert = leer ? null : Number(String(rohWert).replace(',', '.'))
    if (!leer && (isNaN(wert) || wert < 0)) return
    setSpeichert(chatterName + feld)
    let actor = null
    try {
      const { data } = await supabase.auth.getUser()
      actor = data?.user?.user_metadata?.full_name || data?.user?.email || null
    } catch { /* Urheber ist nice-to-have, darf das Speichern nicht blockieren */ }
    // Bewusst nur das eine Feld schreiben: ein Upsert mit allen Spalten würde
    // Werte überschreiben, die jemand anderes zwischenzeitlich gesetzt hat.
    const { error } = await supabase.from('chatter_targets').upsert({
      chatter_name: chatterName,
      [feld]: wert,
      updated_at: new Date().toISOString(),
      updated_by: actor,
    }, { onConflict: 'chatter_name' })
    setSpeichert(null)
    if (error) { console.warn('chatter_targets speichern fehlgeschlagen:', error.message); return }
    onZielGespeichert?.()
  }

  const zeilen = zielDaten?.zeilen || []
  const mitZiel = zeilen.filter(z => z.monatsziel > 0).length

  const th = { padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border-bright)', whiteSpace: 'nowrap', textAlign: 'left' }
  const td = { padding: '9px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12, whiteSpace: 'nowrap' }
  const inputStyle = {
    width: 62, background: 'var(--bg-input)', border: '1px solid var(--border-bright)',
    color: 'var(--text-primary)', borderRadius: 5, padding: '4px 6px', fontSize: 12,
    fontFamily: 'var(--font-mono)', outline: 'none',
  }

  // Bewusst eine Funktion und keine eigene Komponente: als <Komponente/> würde
  // React das Feld bei jedem Render der Karte neu einhängen und der Cursor
  // spränge beim Tippen heraus.
  const zahlFeld = (z, feld, platzhalter) => (
    <input
      key={z.name + feld}
      type="text"
      inputMode="decimal"
      defaultValue={z.ziel?.[feld] ?? ''}
      placeholder={platzhalter}
      disabled={speichert === z.name + feld}
      onBlur={e => {
        const alt = z.ziel?.[feld]
        const neu = e.target.value.trim()
        if (String(alt ?? '') === neu) return   // nichts geändert → kein Schreibzugriff
        speichereFeld(z.name, feld, neu)
      }}
      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
      style={inputStyle}
    />
  )

  return (
    <Card title={<><Icon name="target" /> Ziele & Verdienst ({zielDaten?.tagImMonat || 0}. von {zielDaten?.tageImMonat || 0} Tagen)</>}>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
        Hochrechnung = Umsatz bis heute, linear auf den ganzen Monat gerechnet, mal Provisionssatz.
        Leere Felder bedeuten Standard ({STANDARD_ZIEL.min_rph} $/Std, Nacht {STANDARD_ZIEL.min_rph_nacht} $/Std, {STANDARD_ZIEL.provision_pct}% Provision).
        Ohne Monatsziel gibt es keine Verdienst-Warnung — aktuell für {mitZiel} von {zeilen.length} Chattern gesetzt.
      </div>

      {zeilen.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '6px 0' }}>
          Für diesen Monat liegen noch keine Chatter-Daten vor.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: isMobile ? 720 : 0 }}>
            <thead>
              <tr>
                <th style={th}>Chatter</th>
                <th style={th}>Ziel $/Std</th>
                <th style={th}>Monatsziel $</th>
                <th style={th}>%</th>
                <th style={th} title="Umsatz geteilt durch Aktivminuten aus der CSV">Ø $/Aktivstd</th>
                <th style={th} title="Umsatz geteilt durch die Zeit zwischen Check-in und Check-out">Ø $/Schichtstd</th>
                <th style={th}>Umsatz Monat</th>
                <th style={th}>Verdienst bisher</th>
                <th style={th}>Hochrechnung</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map(z => (
                <React.Fragment key={z.name}>
                  <tr>
                    <td style={{ ...td, fontWeight: 700 }}>
                      {z.name}
                      <button
                        onClick={() => setOffen(offen === z.name ? null : z.name)}
                        title="Ziele je Schicht"
                        style={{
                          marginLeft: 7, background: 'transparent', border: '1px solid var(--border-bright)',
                          color: 'var(--text-muted)', borderRadius: 4, padding: '0 6px',
                          fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                        }}>{offen === z.name ? '−' : '+'}</button>
                      {z.offeneCheckouts > 0 && (
                        <span title={`${z.offeneCheckouts} Schicht(en) ohne Check-out — diese Stunden fehlen in $/Schichtstd`}
                          style={{ marginLeft: 6, fontSize: 10, color: 'var(--orange)' }}>⚠</span>
                      )}
                    </td>
                    <td style={td}>{zahlFeld(z, 'min_rph', String(STANDARD_ZIEL.min_rph))}</td>
                    <td style={td}>{zahlFeld(z, 'monatsziel_verdienst', '—')}</td>
                    <td style={td}>{zahlFeld(z, 'provision_pct', String(STANDARD_ZIEL.provision_pct))}</td>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)', color: z.rphAktivMonat > 0 && z.rphAktivMonat < z.schwelleMonat ? 'var(--red)' : 'var(--text-primary)' }}>
                      ${z.rphAktivMonat.toFixed(0)}
                    </td>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                      {z.rphSchichtMonat != null ? `$${z.rphSchichtMonat.toFixed(0)}` : '—'}
                      {z.monatSchichtH > 0 && (
                        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}> · {z.monatSchichtH.toFixed(0)}h</span>
                      )}
                    </td>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>{formatMoney(z.monatUmsatz)}</td>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>${z.verdienstBisher.toFixed(0)}</td>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)', fontWeight: 700, color: z.statusFarbe }}>
                      ${z.hochrechnungVerdienst.toFixed(0)}
                      {z.zielVerhaeltnis !== null && (
                        <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11 }}> · {Math.round(z.zielVerhaeltnis * 100)}%</span>
                      )}
                    </td>
                    <td style={{ ...td, color: z.statusFarbe, fontWeight: 600 }}>
                      {z.status}
                      {z.ursache && (
                        <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)' }}>
                          {z.ursache === 'stunden' ? 'zu wenig Schichten' : z.ursache === 'leistung' ? 'Stundenleistung' : 'beides'}
                        </div>
                      )}
                    </td>
                  </tr>
                  {offen === z.name && (
                    <tr>
                      <td colSpan={10} style={{ ...td, background: 'var(--bg-card2)', whiteSpace: 'normal' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            Mindest-$/Std je Schicht — leer heißt: es gilt der Grundwert links.
                          </span>
                          {ZIEL_SCHICHTEN.map(s => {
                            const feld = { 'Vorschicht': 'min_rph_vorschicht', 'Früh': 'min_rph_frueh', 'Spät': 'min_rph_spaet', 'Nacht': 'min_rph_nacht' }[s]
                            return (
                              <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                                <span style={{ color: 'var(--text-secondary)' }}>{s}</span>
                                {zahlFeld(z, feld, String(minRphFuerSchicht(z.ziel, s)))}
                              </label>
                            )
                          })}
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {z.aktiveTage} Tage gearbeitet · {(z.monatAktivMin / 60).toFixed(0)}h aktiv
                            {z.monatSchichtH > 0 ? ` · ${z.monatSchichtH.toFixed(0)}h eingecheckt` : ''}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

export default function ChattersView({ selectedDate, chatterSnapshots, onDateChange }) {
  // v3.4.0: aufgeklappte Health-Detail-Row
  const [expandedHealth, setExpandedHealth] = useState(null)
  // v3.61.5: stillgelegte/offboardete Chatter (aus user_roles) — werden aus der Heatmap ausgeblendet
  const [inactiveNames, setInactiveNames] = useState(() => new Set())
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('user_roles').select('display_name, status').in('status', ['suspended', 'offboarded'])
      setInactiveNames(new Set((data || []).map(r => r.display_name).filter(Boolean)))
    })()
  }, [])
  // v4.27.0: Zielwerte + tatsächlich geleistete Schichtstunden.
  // Die Schichtstunden werden für den laufenden Monat bis zum gewählten Tag
  // geladen — mehr braucht die Hochrechnung nicht.
  const [ziele, setZiele] = useState({})
  const [schichtStunden, setSchichtStunden] = useState({})
  const [zielVersion, setZielVersion] = useState(0)
  useEffect(() => {
    let abgebrochen = false
    ;(async () => {
      const z = await ladeChatterZiele()
      if (!abgebrochen) setZiele(z)
    })()
    return () => { abgebrochen = true }
  }, [zielVersion])
  useEffect(() => {
    if (!selectedDate) return
    let abgebrochen = false
    ;(async () => {
      const monatsStart = selectedDate.slice(0, 8) + '01'
      const s = await ladeSchichtstunden(monatsStart, selectedDate)
      if (!abgebrochen) setSchichtStunden(s)
    })()
    return () => { abgebrochen = true }
  }, [selectedDate])
  // v3.31.0: kompakte/gestapelte Alert-Zeilen auf Mobile
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const currentSnap = chatterSnapshots.find(s => s.businessDate === selectedDate)
  const allRows = currentSnap?.rows || []
  // Only chatters who sent messages and are not deleted users
  const rows = allRows.filter(r => r.sentMessages > 0 && !isDeletedUser(r.name))
  const prevSnap = getPreviousSnapshot(chatterSnapshots, selectedDate)
  const prevRows = prevSnap?.rows.filter(r => !isDeletedUser(r.name)) || []
  const last7 = getLast7Snapshots(chatterSnapshots, selectedDate)

  // All chatter names: active (50+ messages), not deleted, across history
  const allChatterNames = [...new Set(
    chatterSnapshots.flatMap(s =>
      s.rows.filter(r => r.sentMessages >= 50 && !isDeletedUser(r.name)).map(r => r.name)
    )
  )].sort((a, b) => {
    const aRev = rows.find(r => r.name === a)?.revenue || 0
    const bRev = rows.find(r => r.name === b)?.revenue || 0
    return bRev - aRev
  })

  const top6Names = allChatterNames.slice(0, 6)

  // Delta list – nur Chatters mit 50+ Nachrichten heute
  // Vergleich mit letztem Tag wo sie 50+ Nachrichten hatten (nicht zwingend direkter Vortag)
  const deltaItems = rows
    .filter(r => r.sentMessages >= 50)
    .map(r => {
      const lastActiveSnap = [...chatterSnapshots]
        .sort((a, b) => b.businessDate.localeCompare(a.businessDate))
        .find(s => s.businessDate < selectedDate && s.rows.find(rr => rr.name === r.name && rr.sentMessages >= 50))
      const prev = lastActiveSnap?.rows.find(p => p.name === r.name)
      const deltaPct = (prev && prev.revenue > 0) ? pctChange(r.revenue, prev.revenue) : null
      return { name: r.name, current: r.revenue, delta: prev ? r.revenue - prev.revenue : 0, deltaPct }
    })

  const heatmapNames = allChatterNames.filter(n => !inactiveNames.has(n)) // v3.61.5: nur aktive Chatter

  // Big table
  const tableRows = rows.filter(r => !inactiveNames.has(r.name)).map(r => {
    // Δ vs. Wochentag: vergleicht jetzt $/Std (Volumen-unabhängig)
    // Vorher: Revenue → schlecht für kurze Schichten mit hoher Effizienz
    const targetWeekday = (() => {
      const d = new Date(selectedDate + 'T12:00:00')
      return d.getDay() === 0 ? 6 : d.getDay() - 1
    })()
    const sameWeekdayActive = [...chatterSnapshots]
      .filter(s => s.businessDate < selectedDate)
      .sort((a, b) => b.businessDate.localeCompare(a.businessDate))
      .map(s => {
        const sd = new Date(s.businessDate + 'T12:00:00')
        const wd = sd.getDay() === 0 ? 6 : sd.getDay() - 1
        if (wd !== targetWeekday) return null
        const row = s.rows.find(rr => rr.name === r.name)
        if (!row || row.sentMessages < 50 || row.activeMinutes < 60) return null
        return row
      })
      .filter(Boolean)
      .slice(0, 4)
    const baselineRph = sameWeekdayActive.length >= 3
      ? (() => {
          const sorted = [...sameWeekdayActive].map(rr => rr.revenuePerHour || 0).sort((a, b) => a - b)
          return sorted[Math.floor(sorted.length / 2)]
        })()
      : null
    const rphDelta = (baselineRph && baselineRph > 0)
      ? pctChange(r.revenuePerHour || 0, baselineRph)
      : null

    // PPV-Deltas weiterhin gegen letzten aktiven Tag (kurzfristig sinnvoller)
    const lastActivePrev = [...chatterSnapshots]
      .sort((a, b) => b.businessDate.localeCompare(a.businessDate))
      .find(s => s.businessDate < selectedDate && s.rows.find(rr => rr.name === r.name && rr.sentMessages >= 50))
    const prev = lastActivePrev?.rows.find(p => p.name === r.name)
    const sentPPVsDelta = prev ? r.sentPPVs - prev.sentPPVs : 0
    const boughtPPVsDelta = prev ? r.boughtPPVs - prev.boughtPPVs : 0
    const buyRateDelta = prev ? r.buyRate - prev.buyRate : 0

    // 7T Rev / 7T $/Std: nur aktive Tage berücksichtigen
    const activeSnapsLast7 = last7.filter(s => {
      const rr = s.rows.find(x => x.name === r.name)
      return rr && rr.sentMessages >= 50 && rr.activeMinutes >= 60
    })
    const rev7 = activeSnapsLast7.length > 0
      ? activeSnapsLast7.reduce((s, snap) => s + (snap.rows.find(rr => rr.name === r.name)?.revenue || 0), 0) / activeSnapsLast7.length
      : 0
    const rph7 = activeSnapsLast7.length > 0
      ? activeSnapsLast7.reduce((s, snap) => s + (snap.rows.find(rr => rr.name === r.name)?.revenuePerHour || 0), 0) / activeSnapsLast7.length
      : 0
    const trend = computeChatterTrend(chatterSnapshots, r.name)
    const { status, recommendation } = computeChatterStatus(r, trend)
    // v3.4.0: Health Scores
    const health = computeChatterHealth(chatterSnapshots, r.name, selectedDate)
    return { ...r, revDelta: rphDelta, sentPPVsDelta, boughtPPVsDelta, buyRateDelta, rev7, rph7, trend, status, recommendation, activeDays7: activeSnapsLast7.length, health }
  }).sort((a, b) => b.revenue - a.revenue)

  const tdStyle = { padding: '10px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12 }
  const thStyle = { padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border-bright)', whiteSpace: 'nowrap' }
  const deltaStyle = (v) => ({ fontFamily: 'var(--font-mono)', fontSize: 11, color: v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text-muted)' })

  // ── v4.27.0: Zielwerte, Monats-Hochrechnung, Schichtstunden ──
  // Ersetzt die früher hier hartcodierten $100/$60 pro Stunde. Die Schwelle ist
  // jetzt der Wert des jeweiligen Chatters, gewichtet nach den Schichten, die er
  // an dem Tag tatsächlich gearbeitet hat.
  const zielDaten = berechneChatterZiele({
    chatterSnapshots, selectedDate, ziele, schichtStunden, inaktiveNamen: inactiveNames,
  })

  // ── Unified Alerts: Verdienst-Hochrechnung + $/Std unter Ziel + Trend + Health ──
  const chatterAlerts = (() => {
    const alerts = []
    const sortedDesc = [...chatterSnapshots].sort((a, b) => b.businessDate.localeCompare(a.businessDate))
    const cutoffIdx = sortedDesc.findIndex(s => s.businessDate === selectedDate)
    if (cutoffIdx === -1) return []

    // Ziel-basierte Meldungen (Verdienst-Hochrechnung, Stundenleistung,
    // Schicht-ohne-Aktivität) kommen aus dem gemeinsamen Rechenkern.
    alerts.push(...berechneZielAlerts(zielDaten.zeilen))

    // Trend-basierte Alerts: 3-Tage-Abwärtstrend
    for (const r of (rows || [])) {
      if (alerts.find(a => a.name === r.name)) continue // schon drin
      const trend = computeChatterTrend(chatterSnapshots, r.name)
      if (trend === 'Fallend' && (r.revenue || 0) >= 100) {
        alerts.push({
          severity: 'warning',
          name: r.name,
          headline: `Revenue $${(r.revenue || 0).toFixed(0)} · $${(r.revenuePerHour || 0).toFixed(0)}/Std`,
          tag: '3-Tage-Abwärtstrend',
        })
      }
    }

    // v3.4.0: Health-Score basierte Warnungen (kommen nach den klassischen Alerts)
    for (const r of (rows || [])) {
      const health = computeChatterHealth(chatterSnapshots, r.name, selectedDate)
      if (!health.hasEnoughData) continue
      for (const w of health.warnings) {
        // Dedup: gleicher Chatter + gleicher Warning-Typ nicht doppelt
        let labelDe = '', explain = '', group = 'stability', headline = ''
        if (w.type === 'fan_burnout') {
          labelDe = 'Fan-Burnout'
          group = 'critical_health'
          explain = 'Sent PPVs steigen stark, aber Buy Rate fällt. Hinweis dass Fans genervt sind und weniger kaufen.'
          headline = `Sent PPVs steigen, Buy Rate fällt · ${health.spam.ratio} Sent/Bought · ${health.buyRate.avg}% Buy Rate`
        }
        else if (w.type === 'whale_carry') {
          labelDe = 'Whale-Abhängigkeit'
          group = 'stability'
          explain = 'Hohe Umsätze nur von wenigen Großkäufern. Ø über $80/PPV bei <5 Käufen/Tag — Risiko wenn der Whale weg ist.'
          headline = `Ø $${health.whale.avgPPV}/PPV · nur ${health.whale.avgBought} Bought/Tag`
        }
        else if (w.type === 'unstable') {
          labelDe = 'Instabile Performance'
          group = 'stability'
          explain = 'Revenue schwankt stark zwischen den Tagen (Standardabweichung > 60% vom Durchschnitt).'
          headline = `Revenue-Schwankung ${(health.consistency.cv * 100).toFixed(0)}% (Std/Avg)`
        }
        else if (w.type === 'healthy') {
          labelDe = 'Gesunder Top-Chatter'
          group = 'positive'
          explain = 'Stabile Werte über mehrere Tage: gute Buy Rate, konstante Revenue, gesunde Sent/Bought-Ratio. Vorbild-Performance.'
          headline = `Sustainability ${health.sustainability.score} · stabil über ${health.activeDays} Tage`
        }
        else if (w.type === 'spam_risk') {
          labelDe = 'Spam-Risiko'
          group = 'critical_health'
          explain = 'Verhältnis Sent zu Bought über 4. Chatter sendet viel mehr PPVs als gekauft werden — Fans könnten genervt sein.'
          headline = `${health.spam.ratio} Sent/Bought Ratio · nur ${health.buyRate.avg}% Buy Rate`
        }
        else if (w.type === 'silent_decline') {
          labelDe = 'Schleichender Rückgang'
          group = 'trend'
          explain = 'Revenue 5-Tage-Durchschnitt seit mehreren Tagen rückläufig — trotz konstanter Aktivität.'
          headline = `Revenue rückläufig (5-Tage MA) trotz ${health.activeDays}d Aktivität`
        }
        if (alerts.find(a => a.name === r.name && a.tag === labelDe)) continue

        alerts.push({
          severity: w.severity,
          name: r.name,
          headline,
          tag: labelDe,
          group,
          explain,
        })
      }
    }

    // Auch bestehende Alerts mit group + explain anreichern (damit Gruppierung funktioniert)
    // v4.27.0: Ziel- und Health-Alerts bringen ihre Gruppe schon mit; hier bleiben
    // nur noch die Trend-Meldungen übrig.
    for (const a of alerts) {
      if (a.group) continue
      if (a.tag === '3-Tage-Abwärtstrend') {
        a.group = 'trend'
        a.explain = 'Revenue ist über die letzten 3 Tage rückläufig. Beobachten ob es weitergeht.'
      } else {
        a.group = 'stability'
        a.explain = ''
      }
    }

    // Sortierung: positive zuletzt, sonst kritisch zuerst
    alerts.sort((a, b) => {
      // positive ans Ende
      if (a.severity === 'positive' && b.severity !== 'positive') return 1
      if (b.severity === 'positive' && a.severity !== 'positive') return -1
      if (a.severity === b.severity) return 0
      return a.severity === 'critical' ? -1 : 1
    })

    return alerts
  })()

  const criticalCount = chatterAlerts.filter(a => a.severity === 'critical').length
  const warningCount = chatterAlerts.filter(a => a.severity === 'warning').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ═══════════════ OBEN: Unified Alerts ═══════════════ */}
      <Card title={(criticalCount + warningCount) > 0
        ? <><Icon name="alert" /> Aufmerksamkeit nötig ({criticalCount + warningCount})</>
        : <><Icon name="check" /> Alle Chatter auf Kurs</>}>
        {(criticalCount + warningCount) === 0 ? (
          <div style={{ color: 'var(--green)', fontSize: 13, padding: '4px 0' }}>
            Keine Chatter mit kritisch niedriger Effizienz oder Abwärtstrend.
          </div>
        ) : (
          <>
            {(criticalCount > 0 || warningCount > 0) && (
              <div style={{ display: 'flex', gap: 6, fontSize: 11, marginBottom: 10 }}>
                {criticalCount > 0 && (
                  <span style={{ padding: '2px 8px', background: 'rgba(239,68,68,0.12)', color: 'var(--red)', borderRadius: 4, fontWeight: 600 }}>
                    Kritisch {criticalCount}
                  </span>
                )}
                {warningCount > 0 && (
                  <span style={{ padding: '2px 8px', background: 'rgba(245,158,11,0.12)', color: 'var(--yellow)', borderRadius: 4, fontWeight: 600 }}>
                    Achtung {warningCount}
                  </span>
                )}
              </div>
            )}
            {/* v3.5.0: Gruppierte Alert-Anzeige (Option A) */}
            {(() => {
              const groupConfig = [
                // v4.27.0: Verdienst steht bewusst ganz oben. Das ist der Fall, der
                // monatelang unsichtbar war, weil nur auf Gesamtumsätze geschaut wurde.
                { key: 'verdienst', label: <><Icon name="alert" /> Verdienst unter Ziel (Monat)</>, color: 'var(--red)', bg: 'rgba(239,68,68,0.06)', defaultOpen: true,
                  desc: 'Hochrechnung auf den ganzen Monat liegt unter dem hinterlegten Verdienstziel des Chatters.' },
                { key: 'critical_health', label: <><Icon name="alert" /> Kritisch (Health)</>, color: 'var(--red)', bg: 'rgba(239,68,68,0.06)', defaultOpen: true,
                  desc: 'Fan-Burnout und Spam-Risiko – Chatter-Verhalten gefährdet Fan-Beziehung.' },
                { key: 'under_min', label: <><Icon name="alert" /> Stundenleistung unter Ziel</>, color: 'var(--yellow)', bg: 'rgba(245,158,11,0.06)', defaultOpen: true,
                  desc: 'Chatter unter seinem eigenen Mindest-$/Std — gewichtet nach den Schichten, die er an dem Tag hatte.' },
                { key: 'trend', label: <><Icon name="trending-down" /> Abwärtstrend</>, color: 'var(--yellow)', bg: 'rgba(245,158,11,0.06)', defaultOpen: false,
                  desc: 'Revenue rückläufig — 3-Tage Trend oder schleichender Rückgang (5-Tage MA).' },
                { key: 'stability', label: <><Icon name="activity" /> Stabilität & Abhängigkeit</>, color: 'var(--yellow)', bg: 'rgba(245,158,11,0.06)', defaultOpen: false,
                  desc: 'Instabile Performance oder zu starke Whale-Abhängigkeit.' },
              ]
              const byGroup = {}
              for (const a of chatterAlerts) {
                const g = a.group || 'stability'
                if (!byGroup[g]) byGroup[g] = []
                byGroup[g].push(a)
              }
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {groupConfig.map(cfg => {
                    const items = byGroup[cfg.key] || []
                    if (items.length === 0) return null
                    // Namen-Vorschau im Header
                    const namePreview = [...new Set(items.map(i => i.name))].slice(0, 4).join(' · ')
                    const moreCount = [...new Set(items.map(i => i.name))].length - 4
                    return (
                      <details key={cfg.key} open={cfg.defaultOpen} style={{
                        border: `1px solid ${cfg.color}33`,
                        borderLeft: `3px solid ${cfg.color}`,
                        borderRadius: 6,
                        background: cfg.bg,
                      }}>
                        <summary title={cfg.desc} style={{
                          cursor: 'pointer',
                          padding: '8px 12px',
                          listStyle: 'none',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 10,
                          fontSize: 12,
                          fontWeight: 700,
                          color: cfg.color,
                        }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {cfg.label}
                            <span style={{
                              background: `${cfg.color}22`, color: cfg.color,
                              padding: '1px 8px', borderRadius: 10,
                              fontSize: 11, fontWeight: 700,
                            }}>{items.length}</span>
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, fontFamily: 'var(--font-mono)' }}>
                            {namePreview}{moreCount > 0 ? ` +${moreCount}` : ''}
                          </span>
                        </summary>
                        <div style={{ padding: '4px 12px 10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {items.map((a, idx) => {
                            if (isMobile) {
                              return (
                                <div key={a.name + a.tag + idx} title={a.explain || ''} style={{
                                  display: 'flex', flexDirection: 'column', gap: 3,
                                  padding: '7px 10px',
                                  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 5,
                                }}>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{a.name}</span>
                                    <span style={{
                                      fontSize: 10, color: cfg.color, background: `${cfg.color}15`,
                                      border: `1px solid ${cfg.color}33`, padding: '1px 7px', borderRadius: 4,
                                      whiteSpace: 'nowrap', fontWeight: 600, flexShrink: 0,
                                    }}>{a.tag}</span>
                                  </div>
                                  <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.35 }}>{a.headline}</span>
                                </div>
                              )
                            }
                            return (
                            <div key={a.name + a.tag + idx}
                              title={a.explain || ''}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 12,
                                padding: '6px 10px',
                                background: 'var(--bg-card)',
                                border: '1px solid var(--border)',
                                borderRadius: 5,
                                cursor: a.explain ? 'help' : 'default',
                              }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', minWidth: 90, flexShrink: 0 }}>
                                {a.name}
                              </span>
                              <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1, minWidth: 0 }}>
                                {a.headline}
                              </span>
                              <span style={{
                                fontSize: 11, color: cfg.color,
                                background: `${cfg.color}15`,
                                border: `1px solid ${cfg.color}33`,
                                padding: '2px 8px', borderRadius: 4,
                                whiteSpace: 'nowrap', fontWeight: 600, flexShrink: 0,
                              }}>
                                {a.tag}
                              </span>
                            </div>
                            )
                          })}
                        </div>
                      </details>
                    )
                  })}
                </div>
              )
            })()}
          </>
        )}
      </Card>

      {/* ═══════════ v4.27.0: Ziele & Verdienst ═══════════ */}
      <ChatterZieleCard
        zielDaten={zielDaten}
        ziele={ziele}
        onZielGespeichert={() => setZielVersion(v => v + 1)}
        isMobile={isMobile}
      />

      {/* v3.6.0: Top-Performer-Karte (positives Gegenstück zur Alert-Sektion) */}
      <Card title={<><Icon name="star" /> Top-Performer</>}>
        {(() => {
          // Helper: Chatter mit health berechnen
          const enriched = rows.map(r => ({
            ...r,
            _health: computeChatterHealth(chatterSnapshots, r.name, selectedDate),
          }))

          // 1. Top Revenue heute (≥50 msg)
          const topRevenue = enriched
            .filter(r => (r.sentMessages || 0) >= 50)
            .sort((a, b) => (b.revenue || 0) - (a.revenue || 0))
            .slice(0, 3)

          // 2. Effizienz-Champions: ≥$200/Std bei ≥90 min aktiv
          const efficiency = enriched
            .filter(r => (r.activeMinutes || 0) >= 90 && (r.revenuePerHour || 0) >= 200)
            .sort((a, b) => (b.revenuePerHour || 0) - (a.revenuePerHour || 0))
            .slice(0, 3)

          // 3. Konstante Performer: Sustainability ≥75 + Consistency grün + ≥7 aktive Tage
          const consistent = enriched
            .filter(r => r._health.hasEnoughData
              && r._health.sustainability.score !== null
              && r._health.sustainability.score >= 75
              && r._health.consistency.color === 'green'
              && r._health.activeDays >= 7)
            .sort((a, b) => (b._health.sustainability.score || 0) - (a._health.sustainability.score || 0))
            .slice(0, 3)

          // 4. Gesunde Top-Chatter: aus den health-warnings type === 'healthy'
          const healthyChatters = enriched
            .filter(r => r._health.hasEnoughData && r._health.warnings.some(w => w.type === 'healthy'))
            .sort((a, b) => (b._health.sustainability.score || 0) - (a._health.sustainability.score || 0))
            .slice(0, 3)

          const groupCfg = [
            {
              key: 'top_revenue',
              label: <><Icon name="star" /> Top Revenue heute</>,
              desc: 'Die 3 Chatter mit dem höchsten Umsatz heute (mindestens 50 Nachrichten).',
              items: topRevenue,
              valueLabel: 'Revenue',
              valueFn: (r) => formatMoney(r.revenue),
              metaFn: (r) => `${(r.activeMinutes/60).toFixed(1)}h aktiv · ${formatMoney(r.revenuePerHour)}/Std`,
            },
            {
              key: 'efficiency',
              label: <><Icon name="zap" /> Effizienz-Champions</>,
              desc: 'Höchste Stundenleistung ab $200/Std bei mindestens 90 Min Aktivität.',
              items: efficiency,
              valueLabel: '$/Std',
              valueFn: (r) => formatMoney(r.revenuePerHour),
              metaFn: (r) => `${formatMoney(r.revenue)} · ${(r.activeMinutes/60).toFixed(1)}h aktiv`,
            },
            {
              key: 'consistent',
              label: <><Icon name="target" /> Konstante Performer</>,
              desc: 'Stabile Werte über 14 Tage: Sustainability ≥75, geringe Schwankung, mindestens 7 aktive Tage im Fenster.',
              items: consistent,
              valueLabel: 'Sustainability',
              valueFn: (r) => r._health.sustainability.score + '/100',
              metaFn: (r) => `${r._health.activeDays} aktive Tage · CV ${(r._health.consistency.cv * 100).toFixed(0)}%`,
            },
            {
              key: 'healthy',
              label: <><Icon name="check" /> Gesunde Top-Chatter</>,
              desc: 'Alles grün: gute Buy Rate, konstante Revenue, gesunde Sent/Bought-Ratio, kein Decline. Vorbild-Performance.',
              items: healthyChatters,
              valueLabel: 'Sustainability',
              valueFn: (r) => r._health.sustainability.score + '/100',
              metaFn: (r) => `Buy Rate ${r._health.buyRate.avg}% · Spam ${r._health.spam.ratio}`,
            },
          ]

          const greenColor = 'var(--green)'
          const greenBg = 'rgba(16,185,129,0.06)'

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {groupCfg.map(cfg => {
                const items = cfg.items
                const namePreview = items.slice(0, 3).map(i => i.name).join(' · ')
                return (
                  <details key={cfg.key} style={{
                    border: `1px solid ${greenColor}33`,
                    borderLeft: `3px solid ${greenColor}`,
                    borderRadius: 6,
                    background: greenBg,
                  }}>
                    <summary title={cfg.desc} style={{
                      cursor: 'pointer',
                      padding: '8px 12px',
                      listStyle: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      fontSize: 12,
                      fontWeight: 700,
                      color: greenColor,
                    }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {cfg.label}
                        <span style={{
                          background: `${greenColor}22`, color: greenColor,
                          padding: '1px 8px', borderRadius: 10,
                          fontSize: 11, fontWeight: 700,
                        }}>{items.length}</span>
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, fontFamily: 'var(--font-mono)' }}>
                        {items.length === 0 ? 'keine heute' : namePreview}
                      </span>
                    </summary>
                    <div style={{ padding: '4px 12px 10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {items.length === 0 ? (
                        <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '6px 10px', fontStyle: 'italic' }}>
                          Heute kein Chatter in dieser Kategorie.
                        </div>
                      ) : items.map((r, idx) => (
                        <div key={r.name + idx}
                          title={cfg.desc}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            padding: '6px 10px',
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border)',
                            borderRadius: 5,
                          }}>
                          <span style={{
                            fontSize: 11, fontWeight: 700, color: greenColor,
                            minWidth: 26, textAlign: 'center',
                            background: `${greenColor}15`, borderRadius: 4,
                            padding: '2px 0',
                          }}>
                            #{idx + 1}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', minWidth: 90 }}>
                            {r.name}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>
                            {cfg.metaFn(r)}
                          </span>
                          <span style={{
                            fontSize: 12, color: greenColor,
                            background: `${greenColor}15`,
                            border: `1px solid ${greenColor}33`,
                            padding: '2px 10px', borderRadius: 4,
                            whiteSpace: 'nowrap', fontWeight: 700,
                            fontFamily: 'var(--font-mono)',
                          }}>
                            {cfg.valueFn(r)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )
              })}
            </div>
          )
        })()}
      </Card>

      {/* ═══════════════ UNTEN: Kollabierbar ═══════════════ */}

      <Collapsible title={<><Icon name="trending-up" /> Revenue-Trend & Ranking</>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Revenue-Trend</div>
            <RevenueTrendChart allSnapshots={chatterSnapshots} allNames={allChatterNames} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Revenue-Ranking heute</div>
            <RankingBar items={tableRows} nameKey="name" valueKey="revenue" />
          </div>
        </div>
      </Collapsible>

      <Collapsible title={<><Icon name="dollar" /> Revenue heute vs. Vortag & Heatmap</>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Revenue heute vs. Vortag</div>
            <DeltaList items={deltaItems} nameKey="name" />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Chatter-Heatmap – letzte Tage</div>
            <Heatmap snapshots={chatterSnapshots} mode="chatter" topNames={heatmapNames} title="" />
          </div>
        </div>
      </Collapsible>

      <Collapsible title={<><Icon name="clipboard" /> Chatter-Übersicht heute (Detail-Tabelle)</>}>
        {/* Date switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Tag:</span>
          {[...chatterSnapshots].sort((a,b) => b.businessDate.localeCompare(a.businessDate)).slice(0,10).map(s => (
            <button key={s.businessDate} onClick={() => onDateChange(s.businessDate)} style={{
              fontSize: 11, padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
              background: s.businessDate === selectedDate ? 'var(--accent)' : 'transparent',
              border: `1px solid ${s.businessDate === selectedDate ? 'var(--accent)' : 'var(--border)'}`,
              color: s.businessDate === selectedDate ? '#fff' : 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)', fontWeight: 600,
            }}>{s.businessDate.slice(5)}</button>
          ))}
        </div>
        {tableRows.length === 0
          ? <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0' }}>Keine Chatter-Daten mit Nachrichten für diesen Tag</div>
          : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  {['Name','Revenue','Δ $/Std vs. Wochentag','Aktiv (Min)','$/Std','7T Rev (aktiv)','7T $/Std (aktiv)','Trend','Antwortzeit','Sent PPVs Δ','Bought PPVs Δ','Buy Rate','Δ Buy Rate','Avg Rev/PPV','Health','Status','Empfehlung'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((r, i) => {
                  const secs = r.avgResponseSeconds || 0
                  const mins = Math.floor(secs / 60)
                  const remSecs = Math.round(secs % 60)
                  const responseFormatted = secs > 0 ? `${mins}:${remSecs.toString().padStart(2, '0')}` : '—'
                  const responseColor = secs === 0 ? 'var(--text-muted)'
                    : secs <= 120 ? '#10b981'
                    : secs <= 210 ? '#f59e0b'
                    : '#ef4444'
                  const responseBg = secs === 0 ? 'transparent'
                    : secs <= 120 ? 'rgba(16,185,129,0.1)'
                    : secs <= 210 ? 'rgba(245,158,11,0.1)'
                    : 'rgba(239,68,68,0.1)'
                  return (
                  <React.Fragment key={r.name + i}>
                  <tr style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                    <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.name}</td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{formatMoney(r.revenue)}</td>
                    <td style={tdStyle}><span style={deltaStyle(r.revDelta)}>{r.revDelta ? (r.revDelta > 0 ? '+' : '') + r.revDelta.toFixed(1) + '%' : '—'}</span></td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{r.activeMinutes.toFixed(0)}</td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>{formatMoney(r.revenuePerHour)}</td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{formatMoney(r.rev7)}</td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{formatMoney(r.rph7)}</td>
                    <td style={tdStyle}><span style={{ color: trendColors[r.trend] || 'var(--text-secondary)', fontWeight: 600, fontSize: 11 }}>{r.trend}</span></td>
                    <td style={tdStyle}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, color: responseColor, background: responseBg, padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap' }}>
                        {responseFormatted}
                      </span>
                    </td>
                    <td style={tdStyle}><span style={deltaStyle(r.sentPPVsDelta)}>{r.sentPPVsDelta > 0 ? '+' : ''}{r.sentPPVsDelta || '—'}</span></td>
                    <td style={tdStyle}><span style={deltaStyle(r.boughtPPVsDelta)}>{r.boughtPPVsDelta > 0 ? '+' : ''}{r.boughtPPVsDelta || '—'}</span></td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>{r.buyRate.toFixed(1)}%</td>
                    <td style={tdStyle}><span style={deltaStyle(r.buyRateDelta)}>{r.buyRateDelta ? (r.buyRateDelta > 0 ? '+' : '') + r.buyRateDelta.toFixed(1) + '%' : '—'}</span></td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>{formatMoney(r.avgRevenuePerBoughtPPV)}</td>
                    {/* v3.4.0: Health Score Spalte */}
                    <td style={tdStyle}>
                      {r.health.hasEnoughData ? (
                        <button
                          onClick={() => setExpandedHealth(expandedHealth === r.name ? null : r.name)}
                          title={`Klick für Details · ${r.health.activeDays} aktive Tage`}
                          style={{
                            background: scoreBg(r.health.sustainability.color),
                            color: scoreColor(r.health.sustainability.color),
                            border: `1px solid ${scoreColor(r.health.sustainability.color)}55`,
                            padding: '2px 10px', borderRadius: 4,
                            fontSize: 12, fontWeight: 700,
                            fontFamily: 'var(--font-mono)',
                            cursor: 'pointer',
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}
                        >
                          {r.health.sustainability.score}
                          <span style={{ fontSize: 9, opacity: 0.6 }}>{expandedHealth === r.name ? '▲' : '▼'}</span>
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: 11 }} title={`Nur ${r.health.activeDays} aktive Tage`}>—</span>
                      )}
                    </td>
                    <td style={tdStyle}><span style={{ background: `${statusColors[r.status]}22`, color: statusColors[r.status] || 'var(--text-secondary)', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', letterSpacing: '0.02em' }}>{r.status}</span></td>
                    <td style={{ ...tdStyle, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{r.recommendation}</td>
                  </tr>
                  {/* v3.4.0: Expandable Health-Detail-Row */}
                  {expandedHealth === r.name && r.health.hasEnoughData && (
                    <tr style={{ background: 'rgba(124,58,237,0.04)' }}>
                      <td colSpan={17} style={{ padding: '14px 16px', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
                            <Icon name="chart" /> Health-Breakdown · {r.health.activeDays} aktive Tage (letzte 14)
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                            <HealthSubScore label="Sustainability" score={r.health.sustainability.score} color={r.health.sustainability.color}
                              detail="Gesamt-Bewertung: 25% Buy Rate, 25% Konsistenz, 20% Spam-Inverse, 15% Response, 15% Whale-Inverse" />
                            <HealthSubScore label="Buy Rate" score={r.health.buyRate.score} color={r.health.buyRate.color}
                              detail={`Ø ${r.health.buyRate.avg}% (>40 grün, >30 gelb, drunter rot)`} />
                            <HealthSubScore label="Spam Risk (Sent/Bought)" score={r.health.spam.score} color={r.health.spam.color}
                              detail={`Ratio ${r.health.spam.ratio} · <2.5 grün, 2.5-4 gelb, >4 rot`} />
                            <HealthSubScore label="Consistency" score={r.health.consistency.score} color={r.health.consistency.color}
                              detail={`Schwankung ${r.health.consistency.cv !== null ? (r.health.consistency.cv * 100).toFixed(0) + '%' : '—'} (Std/Avg) · <30% grün, 30-60% gelb, >60% rot`} />
                            <HealthSubScore label="Antwortzeit" score={r.health.response.score} color={r.health.response.color}
                              detail={r.health.response.avg !== null ? `Ø ${r.health.response.avg}s (<60 grün, 60-180 gelb, >180 rot)` : 'Keine Daten'} />
                            <HealthSubScore label="Whale Dependency" score={r.health.whale.score} color={r.health.whale.color}
                              detail={`Ø $${r.health.whale.avgPPV}/PPV · ${r.health.whale.avgBought} Bought/Tag · >$80 + <5 = rot`} />
                            <HealthSubScore label="Relationship Health" score={r.health.relationship.score} color={r.health.relationship.color}
                              detail={r.health.silentDecline ? 'Silent Decline erkannt — Penalty -25' : 'Auf Basis Sustainability + Silent-Decline-Check'} />
                          </div>
                          {r.health.warnings.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                              {r.health.warnings.map((w, wi) => {
                                const wColor = w.severity === 'positive' ? 'var(--green)' : w.severity === 'critical' ? 'var(--red)' : 'var(--yellow)'
                                const wBg = w.severity === 'positive' ? 'rgba(16,185,129,0.12)' : w.severity === 'critical' ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)'
                                return (
                                  <span key={wi} style={{
                                    fontSize: 11, fontWeight: 700,
                                    color: wColor, background: wBg,
                                    border: `1px solid ${wColor}55`,
                                    padding: '3px 10px', borderRadius: 4,
                                  }}>
                                    {w.severity === 'positive' ? '✓' : w.severity === 'critical' ? '⚠' : '⚠'} {w.label}
                                  </span>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Collapsible>
    </div>
  )
}

// v3.4.0: Sub-Score-Card im Expand-Bereich
function HealthSubScore({ label, score, color, detail }) {
  const c = scoreColor(color)
  const bg = scoreBg(color)
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${c}33`,
      borderRadius: 8,
      padding: '10px 12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>{label}</span>
        <span style={{
          background: bg, color: c,
          padding: '2px 8px', borderRadius: 4,
          fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)',
        }}>
          {score !== null ? score : '—'}
        </span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>{detail}</div>
    </div>
  )
}

// v3.4.0 fix: Collapsible NICHT innerhalb der Main-Component definieren
// (sonst wird der State bei jedem Parent-Re-Render zurückgesetzt = zugeklappt
// wenn expandedHealth in einer Health-Zelle aktiviert wird)
function Collapsible({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
        padding: '12px 16px', cursor: 'pointer', color: 'var(--text-muted)',
        fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontFamily: 'inherit'
      }}>
        <span>{title}</span>
        <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{open ? '▼' : '▶'}</span>
      </button>
      {open && <div style={{ padding: '0 16px 16px 16px' }}>{children}</div>}
    </div>
  )
}
