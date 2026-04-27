import React from 'react'
import Card from './Card'
import RevenueTrendChart from './RevenueTrendChart'
import RankingBar from './RankingBar'
import DeltaList from './DeltaList'
import Heatmap from './Heatmap'
import FallingAlert from './FallingAlert'
import { formatMoney, pctChange, safeDivide, getLast7Snapshots, getPreviousSnapshot, computeChatterStatus, computeChatterTrendFromSnapshots } from '../utils'

const statusColors = {
  'Strong': 'var(--green)',
  'Price Drop': 'var(--yellow)',
  'Activity Issue': 'var(--orange)',
  'Quality Issue': 'var(--red)',
  'Stabil': 'var(--cyan)',
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
    // Δ Rev: vergleiche mit Median der letzten 4 gleichen Wochentage (nur aktive)
    // Konsistent zur Heatmap-Logik. Off-Days zählen nicht.
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
    const baselineRev = sameWeekdayActive.length >= 3
      ? (() => {
          const sorted = [...sameWeekdayActive].map(rr => rr.revenue).sort((a, b) => a - b)
          return sorted[Math.floor(sorted.length / 2)]
        })()
      : null
    const revDelta = (baselineRev && baselineRev > 0)
      ? pctChange(r.revenue, baselineRev)
      : null

    // PPV-Deltas weiterhin gegen letzten aktiven Tag (kurzfristig sinnvoller)
    const lastActivePrev = [...chatterSnapshots]
      .sort((a, b) => b.businessDate.localeCompare(a.businessDate))
      .find(s => s.businessDate < selectedDate && s.rows.find(rr => rr.name === r.name && rr.sentMessages >= 50))
    const prev = lastActivePrev?.rows.find(p => p.name === r.name)
    const sentPPVsDelta = prev ? r.sentPPVs - prev.sentPPVs : 0
    const boughtPPVsDelta = prev ? r.boughtPPVs - prev.boughtPPVs : 0
    const buyRateDelta = prev ? r.buyRate - prev.buyRate : 0

    // 7T Rev / 7T $/Std: nur aktive Tage (>=50 msg AND >=60 min) berücksichtigen
    // Vorher: alle Tage mit irgendeiner Nachricht — verzerrt durch Off-Days
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
    return { ...r, revDelta, sentPPVsDelta, boughtPPVsDelta, buyRateDelta, rev7, rph7, trend, status, recommendation, activeDays7: activeSnapsLast7.length }
  }).sort((a, b) => b.revenue - a.revenue)

  const tdStyle = { padding: '10px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12 }
  const thStyle = { padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border-bright)', whiteSpace: 'nowrap' }
  const deltaStyle = (v) => ({ fontFamily: 'var(--font-mono)', fontSize: 11, color: v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text-muted)' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Falling Alert ── */}
      <Card title="⚠ Trend-Alerts – Chatters">
        <FallingAlert snapshots={chatterSnapshots} nameKey="name" label="Chatters" minMessages={50} />
      </Card>

      {/* ── ROW 1: Trend + Ranking ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        <Card title="Revenue-Trend – Chatters">
          <RevenueTrendChart allSnapshots={chatterSnapshots} allNames={allChatterNames} />
        </Card>
        <Card title="Revenue-Ranking heute">
          <RankingBar items={tableRows} nameKey="name" valueKey="revenue" />
        </Card>
      </div>

      {/* ── ROW 2: Delta + Heatmap ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        <Card title="Revenue heute vs. Vortag">
          <DeltaList items={deltaItems} nameKey="name" />
        </Card>
        <Card title="Chatter-Heatmap – letzte Tage">
          <Heatmap snapshots={chatterSnapshots} mode="chatter" topNames={heatmapNames} title="" />
        </Card>
      </div>

      {/* ── Big Table ── */}
      <Card title="Chatter-Übersicht heute">
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
                  {['Name','Revenue','Δ vs. Wochentag','Aktiv (Min)','$/Std','7T Rev (aktiv)','7T $/Std (aktiv)','Trend','Antwortzeit','Sent PPVs Δ','Bought PPVs Δ','Buy Rate','Δ Buy Rate','Avg Rev/PPV','Status','Empfehlung'].map(h => (
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
      </Card>
    </div>
  )
}
