import React from 'react'
import { formatShortDate, computeHeatmapStatus } from '../utils'

export default function Heatmap({ snapshots, nameKey, topNames, title }) {
  const sorted = [...snapshots].sort((a, b) => a.businessDate.localeCompare(b.businessDate)).slice(-7)
  if (sorted.length === 0 || topNames.length === 0) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0' }}>Keine Daten</div>
  }

  const getValue = (snap, name) => {
    const row = snap.rows.find(r => (r.creator || r.name) === name)
    return row ? row.revenue : null
  }

  return (
    <div>
      {title && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{title}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ fontSize: 12, minWidth: 400 }}>
          <thead>
            <tr>
              <th style={{ color: 'var(--text-muted)', fontWeight: 600, padding: '4px 12px 4px 0', textAlign: 'left', minWidth: 120 }}>Name</th>
              {sorted.map(s => (
                <th key={s.businessDate} style={{ color: 'var(--text-muted)', fontWeight: 600, padding: '4px 8px', textAlign: 'center', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                  {formatShortDate(s.businessDate)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topNames.map(name => (
              <tr key={name}>
                <td style={{ color: 'var(--text-secondary)', padding: '6px 12px 6px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{name}</td>
                {sorted.map((snap, i) => {
                  const current = getValue(snap, name)
                  const previous = i > 0 ? getValue(sorted[i - 1], name) : null
                  const { label, color } = computeHeatmapStatus(current, previous)
                  return (
                    <td key={snap.businessDate} style={{ padding: '6px 8px', textAlign: 'center' }}>
                      <div style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 28, height: 28, borderRadius: 6,
                        background: `${color}22`,
                        color: current !== null ? color : 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13,
                      }}>
                        {current !== null ? label : '·'}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
        <span style={{ color: '#10b981' }}>■ S</span><span>Steigend</span>
        <span style={{ color: '#f59e0b' }}>■ B</span><span>Balanced</span>
        <span style={{ color: '#ef4444' }}>■ K</span><span>Kritisch</span>
      </div>
    </div>
  )
}
