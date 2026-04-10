import React, { useState, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { formatMoney, formatShortDate } from '../utils'

const COLORS = [
  '#7c3aed','#06b6d4','#10b981','#f59e0b','#ef4444','#f97316',
  '#a78bfa','#34d399','#fbbf24','#f87171','#60a5fa','#e879f9',
  '#2dd4bf','#fb923c','#a3e635','#38bdf8',
]

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const sorted = [...payload].filter(p => p.value > 0).sort((a, b) => b.value - a.value)
  return (
    <div style={{ background: '#0e0e1c', border: '1px solid #2e2e5a', borderRadius: 8, padding: '10px 14px', fontSize: 12, maxWidth: 240 }}>
      <div style={{ color: '#4a4a6a', marginBottom: 6, fontFamily: 'monospace' }}>{label}</div>
      {sorted.map(p => (
        <div key={p.name} style={{ color: p.color, display: 'flex', justifyContent: 'space-between', gap: 16, padding: '1px 0' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>{p.name}</span>
          <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{formatMoney(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function RevenueTrendChart({ allSnapshots, allNames, defaultWindowDays = 7 }) {
  const [hidden, setHidden] = useState(new Set())
  const [windowDays, setWindowDays] = useState(defaultWindowDays)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [mode, setMode] = useState('window') // 'window' | 'custom'

  const toggle = (name) => {
    setHidden(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }
  const showAll = () => setHidden(new Set())
  const hideAll = () => setHidden(new Set(allNames))

  // Build data from snapshots with date filtering
  const data = useMemo(() => {
    if (!allSnapshots || allSnapshots.length === 0) return []
    const sorted = [...allSnapshots].sort((a, b) => a.businessDate.localeCompare(b.businessDate))

    let filtered
    if (mode === 'custom' && customFrom && customTo) {
      filtered = sorted.filter(s => s.businessDate >= customFrom && s.businessDate <= customTo)
    } else {
      filtered = sorted.slice(-windowDays)
    }

    return filtered.map(snap => {
      const obj = { date: formatShortDate(snap.businessDate), _date: snap.businessDate }
      allNames.forEach(name => {
        const row = snap.rows.find(r => (r.creator || r.name) === name)
        obj[name] = row ? row.revenue : 0
      })
      return obj
    })
  }, [allSnapshots, allNames, windowDays, customFrom, customTo, mode])

  if (!data || data.length === 0) return (
    <div style={{ color: '#4a4a6a', textAlign: 'center', padding: '40px 0', fontSize: 13 }}>Keine Daten vorhanden</div>
  )

  const visibleCount = allNames.length - hidden.size
  const windowOptions = [7, 14, 30, 60, 90]

  return (
    <div>
      {/* Date range controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {windowOptions.map(d => (
            <button key={d} onClick={() => { setWindowDays(d); setMode('window') }} style={{
              fontSize: 11, padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
              background: mode === 'window' && windowDays === d ? 'var(--accent)' : 'transparent',
              border: `1px solid ${mode === 'window' && windowDays === d ? 'var(--accent)' : '#2e2e5a'}`,
              color: mode === 'window' && windowDays === d ? '#fff' : '#8888aa',
              fontFamily: 'inherit', fontWeight: 600,
            }}>{d}T</button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
          <span style={{ fontSize: 11, color: '#4a4a6a' }}>Von</span>
          <input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setMode('custom') }}
            style={{ fontSize: 11, padding: '3px 7px', background: '#0b0b1a', border: `1px solid ${mode === 'custom' ? 'var(--accent)' : '#2e2e5a'}`, color: '#f0f0ff', borderRadius: 5, fontFamily: 'monospace' }} />
          <span style={{ fontSize: 11, color: '#4a4a6a' }}>Bis</span>
          <input type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setMode('custom') }}
            style={{ fontSize: 11, padding: '3px 7px', background: '#0b0b1a', border: `1px solid ${mode === 'custom' ? 'var(--accent)' : '#2e2e5a'}`, color: '#f0f0ff', borderRadius: 5, fontFamily: 'monospace' }} />
          {mode === 'custom' && (
            <button onClick={() => { setMode('window'); setCustomFrom(''); setCustomTo('') }} style={{
              fontSize: 11, padding: '3px 7px', borderRadius: 5, cursor: 'pointer',
              background: 'transparent', border: '1px solid #2e2e5a', color: '#8888aa', fontFamily: 'inherit',
            }}>✕</button>
          )}
        </div>
      </div>

      {/* Toggle buttons */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 7, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={showAll} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: '1px solid #2e2e5a', color: '#8888aa', fontFamily: 'inherit' }}>Alle</button>
          <button onClick={hideAll} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: '1px solid #2e2e5a', color: '#8888aa', fontFamily: 'inherit' }}>Keine</button>
          <span style={{ fontSize: 10, color: '#4a4a6a', marginLeft: 2 }}>{visibleCount}/{allNames.length} sichtbar</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {allNames.map((name, i) => {
            const isHidden = hidden.has(name)
            const color = COLORS[i % COLORS.length]
            return (
              <button key={name} onClick={() => toggle(name)} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
                border: `1px solid ${isHidden ? '#1e1e3a' : color}`,
                background: isHidden ? 'transparent' : `${color}18`,
                color: isHidden ? '#4a4a6a' : color,
                fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
                transition: 'all 0.15s', opacity: isHidden ? 0.5 : 1,
              }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: isHidden ? '#2e2e5a' : color, flexShrink: 0 }} />
                {name}
              </button>
            )
          })}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#1e1e3a" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: '#4a4a6a', fontSize: 11, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={v => formatMoney(v)} tick={{ fill: '#4a4a6a', fontSize: 11, fontFamily: 'monospace' }} axisLine={false} tickLine={false} width={64} />
          <Tooltip content={<CustomTooltip />} />
          {allNames.map((name, i) => (
            <Line key={name} type="monotone" dataKey={name}
              stroke={COLORS[i % COLORS.length]} strokeWidth={hidden.has(name) ? 0 : 2}
              dot={hidden.has(name) ? false : { r: 3, fill: COLORS[i % COLORS.length] }}
              activeDot={hidden.has(name) ? false : { r: 5 }}
              hide={hidden.has(name)}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
