import React from 'react'
import { pctChange } from '../utils'

function isDeletedUser(name) {
  if (!name) return true
  return /^.{1,3}\*+$/.test(name.trim())
}

// Returns names that have been falling for 3+ consecutive days
function getFallingNames(snapshots, nameKey, minDays = 3, minMessages = 0) {
  const sorted = [...snapshots].sort((a, b) => a.businessDate.localeCompare(b.businessDate))
  const allNames = [...new Set(
    snapshots.flatMap(s => s.rows
      .filter(r => !isDeletedUser(r[nameKey]))
      .map(r => r[nameKey])
    )
  )]
  const results = []

  for (const name of allNames) {
    const vals = []
    for (const snap of sorted) {
      const row = snap.rows.find(r => r[nameKey] === name)
      // For chatters: only count days with enough messages
      if (row && (minMessages === 0 || (row.sentMessages || 0) >= minMessages)) {
        vals.push({ date: snap.businessDate, revenue: row.revenue })
      }
    }
    if (vals.length < minDays) continue

    const recent = vals.slice(-minDays)
    let falling = true
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].revenue >= recent[i - 1].revenue) { falling = false; break }
    }
    if (falling) {
      const totalDrop = pctChange(recent[recent.length - 1].revenue, recent[0].revenue)
      results.push({ name, days: minDays, totalDrop, recentRevenue: recent[recent.length - 1].revenue, firstRevenue: recent[0].revenue })
    }
  }

  return results.sort((a, b) => a.totalDrop - b.totalDrop)
}

export default function FallingAlert({ snapshots, nameKey, label, minMessages = 0 }) {
  const falling = getFallingNames(snapshots, nameKey, 3, minMessages)

  if (falling.length === 0) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 8 }}>
      <span style={{ fontSize: 16 }}>✓</span>
      <span style={{ fontSize: 13, color: '#10b981' }}>Alle {label} stabil – kein 3-Tage-Abwärtstrend erkannt</span>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#ef4444' }}>⚠ {falling.length} {label} {falling.length === 1 ? 'fällt' : 'fallen'} seit 3+ Tagen</span>
      </div>
      {falling.map(item => (
        <div key={item.name} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px',
          background: 'rgba(239,68,68,0.06)',
          border: '1px solid rgba(239,68,68,0.25)',
          borderRadius: 8,
        }}>
          <div>
            <div style={{ fontWeight: 600, color: '#f0f0ff', fontSize: 13 }}>{item.name}</div>
            <div style={{ fontSize: 11, color: '#8888aa', marginTop: 2 }}>
              {item.days} Tage in Folge fallend · Handlung empfohlen
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#ef4444', fontSize: 14 }}>
              {item.totalDrop.toFixed(1)}%
            </div>
            <div style={{ fontSize: 11, color: '#8888aa' }}>Gesamtrückgang</div>
          </div>
        </div>
      ))}
    </div>
  )
}
