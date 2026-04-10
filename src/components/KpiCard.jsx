import React from 'react'
import { formatMoney, formatDeltaPct } from '../utils'

export default function KpiCard({ label, value, delta, sub, accent }) {
  const isPos = delta > 0
  const isNeg = delta < 0
  const hasD = delta !== undefined && delta !== 0

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '16px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      minWidth: 0,
      boxShadow: accent ? 'var(--shadow-glow)' : 'var(--shadow)',
      borderColor: accent ? 'var(--accent)' : 'var(--border)',
      flex: 1,
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{sub}</div>}
      {hasD && (
        <div style={{
          fontSize: 12,
          fontWeight: 600,
          color: isPos ? 'var(--green)' : isNeg ? 'var(--red)' : 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          marginTop: 2,
        }}>
          <span>{isPos ? '▲' : isNeg ? '▼' : '—'}</span>
          <span>{formatDeltaPct(delta)} vs Vortag</span>
        </div>
      )}
    </div>
  )
}
