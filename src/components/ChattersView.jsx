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

export default function ChattersView({ selectedDate, chatterSnapshots, onDateChange }) {
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
    return { ...r, revDelta: rphDelta, sentPPVsDelta, boughtPPVsDelta, buyRateDelta, rev7, rph7, trend, status, recommendation, activeDays7: activeSnapsLast7.length }
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

    // Sortierung: kritisch zuerst
    alerts.sort((a, b) => {
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
                const bg = isCrit ? 'rgba(239,68,68,0.06)' : 'rgba(245,158,11,0.06)'
                const border = isCrit ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'
                const borderLeft = isCrit ? 'var(--red)' : 'var(--yellow)'
                return (
                  <div key={a.name} style={{
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
                  {['Name','Revenue','Δ $/Std vs. Wochentag','Aktiv (Min)','$/Std','7T Rev (aktiv)','7T $/Std (aktiv)','Trend','Antwortzeit','Sent PPVs Δ','Bought PPVs Δ','Buy Rate','Δ Buy Rate','Avg Rev/PPV','Status','Empfehlung'].map(h => (
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
                  <tr key={r.name + i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
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
                    <td style={tdStyle}><span style={{ background: `${statusColors[r.status]}22`, color: statusColors[r.status] || 'var(--text-secondary)', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.status}</span></td>
                    <td style={{ ...tdStyle, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{r.recommendation}</td>
                  </tr>
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
