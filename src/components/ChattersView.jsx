import React, { useState } from 'react'
import Card from './Card'
import RevenueTrendChart from './RevenueTrendChart'
import RankingBar from './RankingBar'
import DeltaList from './DeltaList'
import Heatmap from './Heatmap'
import FallingAlert from './FallingAlert'
import { formatMoney, pctChange, safeDivide, getLast7Snapshots, getPreviousSnapshot, computeChatterStatus, computeChatterTrendFromSnapshots } from '../utils'

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


export default function ChattersView({ selectedDate, chatterSnapshots, onDateChange }) {
  // v3.4.0: aufgeklappte Health-Detail-Row
  const [expandedHealth, setExpandedHealth] = useState(null)
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

  const heatmapNames = allChatterNames

  // Big table
  const tableRows = rows.map(r => {
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

  // ── Unified Alerts: kombiniert Trend-Probleme + $/Std unter Minimum ──
  // Berechne pro Chatter: wieviele Tage in Folge unter $100/Std bei min 90 Min Aktivität
  const chatterAlerts = (() => {
    const alerts = []
    // Sortierte Snapshots ab heute zurück
    const sortedDesc = [...chatterSnapshots].sort((a, b) => b.businessDate.localeCompare(a.businessDate))
    const cutoffIdx = sortedDesc.findIndex(s => s.businessDate === selectedDate)
    if (cutoffIdx === -1) return []
    const lastSnaps = sortedDesc.slice(cutoffIdx, cutoffIdx + 14) // letzte 14 Tage Backwindow

    // Alle Chatter-Namen die heute aktiv sind
    const todayNames = (rows || []).filter(r => (r.activeMinutes || 0) >= 90).map(r => r.name)

    for (const name of todayNames) {
      // Streak: wieviele Tage am Stück (von heute zurück) unter $100/Std bei ≥90min?
      let streak = 0
      let totalActiveDays = 0
      let lastRph = null
      for (const snap of lastSnaps) {
        const r = snap.rows.find(rr => rr.name === name)
        if (!r || (r.activeMinutes || 0) < 90) {
          // Inaktiv-Tag bricht Streak nicht zwingend, aber wir zählen nur aktive Tage
          if (totalActiveDays === 0) continue // führende Off-Days vor dem ersten aktiven Tag → skip
          break
        }
        totalActiveDays++
        if (lastRph === null) lastRph = r.revenuePerHour || 0
        if ((r.revenuePerHour || 0) < 100) streak++
        else break
      }

      // Heute überhaupt aktiv?
      const todayRow = (rows || []).find(r => r.name === name)
      if (!todayRow) continue
      const rph = todayRow.revenuePerHour || 0
      const activeMin = todayRow.activeMinutes || 0

      if (streak >= 3) {
        alerts.push({
          severity: 'critical',
          name,
          headline: `$${rph.toFixed(0)}/Std · ${(activeMin / 60).toFixed(1)}h aktiv · weit unter Minimum`,
          tag: `Tag ${streak} in Folge < $100/Std`,
        })
      } else if (streak >= 2) {
        alerts.push({
          severity: 'warning',
          name,
          headline: `$${rph.toFixed(0)}/Std · ${(activeMin / 60).toFixed(1)}h aktiv · unter Minimum`,
          tag: `Tag ${streak} in Folge < $100/Std`,
        })
      } else if (rph > 0 && rph < 60 && activeMin >= 90) {
        // Heute alleine schon kritisch schwach (aber kein Streak)
        alerts.push({
          severity: 'warning',
          name,
          headline: `$${rph.toFixed(0)}/Std · ${(activeMin / 60).toFixed(1)}h aktiv · stark unter Minimum`,
          tag: 'Schwacher Tag',
        })
      }
    }

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
        if (alerts.find(a => a.name === r.name && a.tag === w.label)) continue
        let headline = ''
        if (w.type === 'fan_burnout') headline = `Sent PPVs steigen, Buy Rate fällt · ${health.spam.ratio} Sent/Bought · ${health.buyRate.avg}% Buy Rate`
        else if (w.type === 'whale_carry') headline = `Avg $${health.whale.avgPPV}/PPV · nur ${health.whale.avgBought} Bought/Tag`
        else if (w.type === 'unstable') headline = `Revenue-Schwankung ${(health.consistency.cv * 100).toFixed(0)}% (Std/Avg)`
        else if (w.type === 'healthy') headline = `Sustainability ${health.sustainability.score} · stabil über ${health.activeDays} Tage`
        else if (w.type === 'spam_risk') headline = `${health.spam.ratio} Sent/Bought Ratio · nur ${health.buyRate.avg}% Buy Rate`
        else if (w.type === 'silent_decline') headline = `Revenue rückläufig (5-Tage MA) trotz ${health.activeDays}d Aktivität`

        alerts.push({
          severity: w.severity,
          name: r.name,
          headline,
          tag: w.label,
        })
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

  // Inline Collapsible
  const Collapsible = ({ title, defaultOpen = false, children }) => {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ═══════════════ OBEN: Unified Alerts ═══════════════ */}
      <Card title={chatterAlerts.length > 0
        ? `🚨 Aufmerksamkeit nötig (${chatterAlerts.length})`
        : '✓ Alle Chatter auf Kurs'}>
        {chatterAlerts.length === 0 ? (
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {chatterAlerts.map(a => {
                const isCrit = a.severity === 'critical'
                const isPositive = a.severity === 'positive'
                const bg = isPositive ? 'rgba(16,185,129,0.06)' : isCrit ? 'rgba(239,68,68,0.06)' : 'rgba(245,158,11,0.06)'
                const border = isPositive ? 'rgba(16,185,129,0.25)' : isCrit ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'
                const borderLeft = isPositive ? 'var(--green)' : isCrit ? 'var(--red)' : 'var(--yellow)'
                return (
                  <div key={a.name + a.tag} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '8px 12px', background: bg,
                    border: `1px solid ${border}`, borderLeft: `3px solid ${borderLeft}`,
                    borderRadius: 6,
                  }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', minWidth: 90 }}>
                      {a.name}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>
                      {a.headline}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                      {a.tag}
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </Card>

      {/* ═══════════════ UNTEN: Kollabierbar ═══════════════ */}

      <Collapsible title="📈 Revenue-Trend & Ranking">
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

      <Collapsible title="💰 Revenue heute vs. Vortag & Heatmap">
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

      <Collapsible title="📋 Chatter-Übersicht heute (Detail-Tabelle)">
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
                    <td style={tdStyle}><span style={{ background: `${statusColors[r.status]}22`, color: statusColors[r.status] || 'var(--text-secondary)', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.status}</span></td>
                    <td style={{ ...tdStyle, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{r.recommendation}</td>
                  </tr>
                  {/* v3.4.0: Expandable Health-Detail-Row */}
                  {expandedHealth === r.name && r.health.hasEnoughData && (
                    <tr style={{ background: 'rgba(124,58,237,0.04)' }}>
                      <td colSpan={17} style={{ padding: '14px 16px', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
                            📊 Health-Breakdown · {r.health.activeDays} aktive Tage (letzte 14)
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
