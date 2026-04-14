import React, { useState } from 'react'
import { formatShortDate, computeHeatmapStatus } from '../utils'

export default function Heatmap({ snapshots, nameKey, topNames, title }) {
  const [tooltip, setTooltip] = useState(null) // { x, y, text }
  const sorted = [...snapshots].sort((a, b) => a.businessDate.localeCompare(b.businessDate)).slice(-7)
  if (sorted.length === 0 || topNames.length === 0) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0' }}>Keine Daten</div>
  }

  const getValue = (snap, name) => {
    const row = snap.rows.find(r => (r.creator || r.name) === name)
    return row ? row.revenue : null
  }

  return (
    <div style={{ position: 'relative' }}>
      {title && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{title}</div>}
      {tooltip && (
        <div style={{
          position: 'fixed', left: tooltip.x + 12, top: tooltip.y - 10, zIndex: 9999,
          background: 'var(--bg-card)', border: '1px solid #2e2e5a', borderRadius: 7,
          padding: '6px 10px', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)',
          pointerEvents: 'none', whiteSpace: 'nowrap', fontFamily: 'monospace',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          {tooltip.text}
        </div>
      )}
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
                  const revenueText = current !== null ? `$${Number(current).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : 'Keine Daten'
                  return (
                    <td key={snap.businessDate} style={{ padding: '6px 8px', textAlign: 'center' }}>
                      <div
                        onMouseEnter={e => setTooltip({ x: e.clientX, y: e.clientY, text: `${name} · ${formatShortDate(snap.businessDate)} · ${revenueText}` })}
                        onMouseMove={e => setTooltip(t => ({ ...t, x: e.clientX, y: e.clientY }))}
                        onMouseLeave={() => setTooltip(null)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 28, height: 28, borderRadius: 6, cursor: 'default',
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
