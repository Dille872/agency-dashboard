import React from 'react'
import { formatMoney } from '../utils'

export default function RankingBar({ items, nameKey, valueKey, subItems, tagKey }) {
  if (!items || items.length === 0) return (
    <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0' }}>Keine Daten</div>
  )
  const max = Math.max(...items.map(i => i[valueKey] || 0))

  const tagColors = {
    'Msg-dominant': '#06b6d4',
    'Subs-dominant': '#7c3aed',
    'Tips-dominant': '#f59e0b',
    'Balanced': '#10b981',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((item, idx) => {
        const val = item[valueKey] || 0
        const pct = max > 0 ? (val / max) * 100 : 0
        const tag = tagKey ? item[tagKey] : null
        return (
          <div key={item[nameKey] + idx}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: 11, width: 20 }}>#{idx + 1}</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{item[nameKey]}</span>
                {tag && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: `${tagColors[tag]}22`, color: tagColors[tag], fontWeight: 600, whiteSpace: 'nowrap' }}>{tag}</span>}
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)', fontSize: 13 }}>{formatMoney(val)}</span>
            </div>
            <div style={{ background: 'var(--border)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent), var(--cyan))', borderRadius: 4, transition: 'width 0.4s' }} />
            </div>
            {subItems && (
              <div style={{ display: 'flex', gap: 16, marginTop: 4, fontSize: 11, color: 'var(--text-muted)', paddingLeft: 28 }}>
                {subItems.map(s => (
                  <span key={s.label}><span style={{ color: 'var(--text-muted)' }}>{s.label} </span><span style={{ color: s.color || 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{formatMoney(item[s.key] || 0)}</span></span>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
