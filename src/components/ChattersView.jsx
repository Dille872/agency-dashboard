import React from 'react'
import Card from './Card'
import RevenueTrendChart from './RevenueTrendChart'
import RankingBar from './RankingBar'
import DeltaList from './DeltaList'
import Heatmap from './Heatmap'
import FallingAlert from './FallingAlert'
import { formatMoney, pctChange, safeDivide, getLast7Snapshots, getPreviousSnapshot, computeChatterStatus } from '../utils'

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

function computeChatterTrend(snapshots, name) {
  const sorted = [...snapshots].sort((a, b) => a.businessDate.localeCompare(b.businessDate))
  const vals = sorted.map(s => s.rows.find(r => r.name === name)?.revenue).filter(v => v !== undefined)
  if (vals.length < 2) return 'Seitwärts'
  const pct = pctChange(vals[vals.length - 1], vals[vals.length - 2])
  if (pct > 10) return 'Steigend'
  if (pct < -10) return 'Fallend'
  return 'Seitwärts'
}

export default function ChattersView({ selectedDate, chatterSnapshots }) {
  const currentSnap = chatterSnapshots.find(s => s.businessDate === selectedDate)
  const allRows = currentSnap?.rows || []
  // Only chatters who sent messages
  const rows = allRows.filter(r => r.sentMessages > 0)
  const prevSnap = getPreviousSnapshot(chatterSnapshots, selectedDate)
  const prevRows = prevSnap?.rows || []
  const last7 = getLast7Snapshots(chatterSnapshots, selectedDate)

  // All chatter names with messages across history (sorted by today's revenue)
  const allChatterNames = [...new Set(
    chatterSnapshots.flatMap(s => s.rows.filter(r => r.sentMessages > 0).map(r => r.name))
  )].sort((a, b) => {
    const aRev = rows.find(r => r.name === a)?.revenue || 0
    const bRev = rows.find(r => r.name === b)?.revenue || 0
    return bRev - aRev
  })

  const top6Names = allChatterNames.slice(0, 6)

  // Delta list
  const deltaItems = rows.map(r => {
    const prev = prevRows.find(p => p.name === r.name)
    return { name: r.name, current: r.revenue, delta: r.revenue - (prev?.revenue || 0), deltaPct: prev ? pctChange(r.revenue, prev.revenue) : 0 }
  })

  const heatmapNames = allChatterNames

  // Big table
  const tableRows = rows.map(r => {
    const prev = prevRows.find(p => p.name === r.name)
    const revDelta = prev ? pctChange(r.revenue, prev.revenue) : 0
    const sentPPVsDelta = prev ? r.sentPPVs - prev.sentPPVs : 0
    const boughtPPVsDelta = prev ? r.boughtPPVs - prev.boughtPPVs : 0
    const buyRateDelta = prev ? r.buyRate - prev.buyRate : 0
    const snapsWith = last7.filter(s => s.rows.find(rr => rr.name === r.name && rr.sentMessages > 0))
    const rev7 = safeDivide(snapsWith.reduce((s, snap) => s + (snap.rows.find(rr => rr.name === r.name)?.revenue || 0), 0), snapsWith.length)
    const rph7 = safeDivide(snapsWith.reduce((s, snap) => s + (snap.rows.find(rr => rr.name === r.name)?.revenuePerHour || 0), 0), snapsWith.length)
    const trend = computeChatterTrend(chatterSnapshots, r.name)
    const { status, recommendation } = computeChatterStatus(r, trend)
    return { ...r, revDelta, sentPPVsDelta, boughtPPVsDelta, buyRateDelta, rev7, rph7, trend, status, recommendation }
  }).sort((a, b) => b.revenue - a.revenue)

  const tdStyle = { padding: '10px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12 }
  const thStyle = { padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border-bright)', whiteSpace: 'nowrap' }
  const deltaStyle = (v) => ({ fontFamily: 'var(--font-mono)', fontSize: 11, color: v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text-muted)' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Falling Alert ── */}
      <Card title="⚠ Trend-Alerts – Chatters">
        <FallingAlert snapshots={chatterSnapshots} nameKey="name" label="Chatters" />
      </Card>

      {/* ── ROW 1: Trend + Ranking ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <Card title="Revenue-Trend – Chatters">
          <RevenueTrendChart allSnapshots={chatterSnapshots} allNames={allChatterNames} />
        </Card>
        <Card title="Revenue-Ranking heute">
          <RankingBar items={tableRows} nameKey="name" valueKey="revenue" />
        </Card>
      </div>

      {/* ── ROW 2: Delta + Heatmap ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <Card title="Revenue heute vs. Vortag">
          <DeltaList items={deltaItems} nameKey="name" />
        </Card>
        <Card title="Chatter-Heatmap – letzte Tage">
          <Heatmap snapshots={chatterSnapshots} nameKey="name" topNames={heatmapNames} title="" />
        </Card>
      </div>

      {/* ── Big Table ── */}
      <Card title="Chatter-Übersicht heute">
        {tableRows.length === 0
          ? <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0' }}>Keine Chatter-Daten mit Nachrichten für diesen Tag</div>
          : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  {['Name','Revenue','Δ Rev','Aktiv (Min)','$/Std','7T Rev','7T $/Std','Trend','Sent PPVs Δ','Bought PPVs Δ','Buy Rate','Δ Buy Rate','Avg Rev/PPV','Status','Empfehlung'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((r, i) => (
                  <tr key={r.name + i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                    <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.name}</td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{formatMoney(r.revenue)}</td>
                    <td style={tdStyle}><span style={deltaStyle(r.revDelta)}>{r.revDelta ? (r.revDelta > 0 ? '+' : '') + r.revDelta.toFixed(1) + '%' : '—'}</span></td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{r.activeMinutes.toFixed(0)}</td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>{formatMoney(r.revenuePerHour)}</td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{formatMoney(r.rev7)}</td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{formatMoney(r.rph7)}</td>
                    <td style={tdStyle}><span style={{ color: trendColors[r.trend] || 'var(--text-secondary)', fontWeight: 600, fontSize: 11 }}>{r.trend}</span></td>
                    <td style={tdStyle}><span style={deltaStyle(r.sentPPVsDelta)}>{r.sentPPVsDelta > 0 ? '+' : ''}{r.sentPPVsDelta || '—'}</span></td>
                    <td style={tdStyle}><span style={deltaStyle(r.boughtPPVsDelta)}>{r.boughtPPVsDelta > 0 ? '+' : ''}{r.boughtPPVsDelta || '—'}</span></td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>{r.buyRate.toFixed(1)}%</td>
                    <td style={tdStyle}><span style={deltaStyle(r.buyRateDelta)}>{r.buyRateDelta ? (r.buyRateDelta > 0 ? '+' : '') + r.buyRateDelta.toFixed(1) + '%' : '—'}</span></td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>{formatMoney(r.avgRevenuePerBoughtPPV)}</td>
                    <td style={tdStyle}><span style={{ background: `${statusColors[r.status]}22`, color: statusColors[r.status] || 'var(--text-secondary)', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.status}</span></td>
                    <td style={{ ...tdStyle, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{r.recommendation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
