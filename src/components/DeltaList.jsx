import React from 'react'
import { formatMoney, formatDeltaPct } from '../utils'

export default function DeltaList({ items, nameKey }) {
  if (!items || items.length === 0) return (
    <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0' }}>Kein Vergleichstag vorhanden</div>
  )
  const sorted = [...items].sort((a, b) => b.delta - a.delta)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {sorted.map((item, idx) => {
        const isPos = item.delta > 0
        const isNeg = item.delta < 0
        return (
          <div key={item[nameKey] + idx} style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            background: 'var(--bg-card2)',
            borderRadius: 8,
            border: `1px solid ${isPos ? 'rgba(16,185,129,0.2)' : isNeg ? 'rgba(239,68,68,0.2)' : 'var(--border)'}`,
          }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{item[nameKey]}</span>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-primary)' }}>{formatMoney(item.current)}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: isPos ? 'var(--green)' : isNeg ? 'var(--red)' : 'var(--text-muted)', minWidth: 60, textAlign: 'right' }}>
                {item.deltaPct === null ? (isPos ? '▲' : isNeg ? '▼' : '—') : `${isPos ? '▲' : isNeg ? '▼' : '—'} ${formatDeltaPct(item.deltaPct)}`}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
