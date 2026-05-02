import React, { useMemo, useEffect, useState } from 'react'

const cardS = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }
const labelS = { fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginBottom: 12 }

const selectS = {
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  padding: '5px 9px',
  borderRadius: 6,
  fontSize: 11,
  fontFamily: 'inherit',
  outline: 'none',
  cursor: 'pointer',
}

// ─── Helpers für Datum/Woche/Monat ───
function isoWeekKey(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil((((date - yearStart) / 86400000) + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}
function isoWeekLabel(weekKey) {
  if (!weekKey) return ''
  const parts = weekKey.split('-W')
  if (parts.length !== 2) return weekKey
  return `KW${parts[1]} '${parts[0].slice(2)}`
}
function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthLabel(mKey) {
  if (!mKey) return ''
  const [y, m] = mKey.split('-')
  const months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
  return `${months[parseInt(m) - 1]} '${y.slice(2)}`
}
function daysInMonth(mKey) {
  const [y, m] = mKey.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}
function isCurrentMonth(mKey) {
  return mKey === monthKey(new Date())
}
function elapsedDaysInMonth(mKey) {
  if (!isCurrentMonth(mKey)) return daysInMonth(mKey)
  return new Date().getDate()
}

// Trend-Pfeil + Farbe + Format
function TrendIndicator({ current, previous, isInverse = false }) {
  if (previous === 0 || previous == null) {
    if (current > 0) return <span style={{ fontSize: 10, color: '#10b981', fontWeight: 600 }}>neu</span>
    return <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>—</span>
  }
  const diff = current - previous
  const pct = (diff / Math.abs(previous)) * 100
  const isPositive = isInverse ? diff < 0 : diff > 0
  const closeToZero = Math.abs(pct) < 0.5
  const color = closeToZero ? 'var(--text-muted)' : (isPositive ? '#10b981' : '#ef4444')
  const arrow = closeToZero ? '·' : (diff > 0 ? '▲' : '▼')
  return (
    <span style={{ fontSize: 11, color, fontWeight: 600, fontFamily: 'monospace' }}>
      {arrow} {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
    </span>
  )
}

// Sparkline mit polyline
function Sparkline({ data, color = '#7c3aed', width = 60, height = 20 }) {
  if (!data || data.length < 2) return <div style={{ width, height }} />
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const points = data.map((v, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * (width - 2) + 1
    const y = height - ((v - min) / range) * (height - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const lastY = height - ((data[data.length - 1] - min) / range) * (height - 4) - 2
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={width - 1} cy={lastY} r="2" fill={color} />
    </svg>
  )
}

// Aggregation: Snapshots → pro Entity / pro Periode
function aggregateSnapshots(snapshots, entityKey, metricKeys, periodFn) {
  const result = {}
  for (const snap of snapshots) {
    if (!snap.businessDate) continue
    const period = periodFn(new Date(snap.businessDate + 'T12:00:00'))
    for (const row of (snap.rows || [])) {
      const entity = row[entityKey] || row.name
      if (!entity) continue
      if (!result[entity]) result[entity] = {}
      if (!result[entity][period]) {
        result[entity][period] = {}
        for (const k of metricKeys) result[entity][period][k] = { sum: 0, count: 0 }
      }
      for (const m of metricKeys) {
        if (row[m] != null && !isNaN(row[m])) {
          result[entity][period][m].sum += row[m]
          result[entity][period][m].count += 1
        }
      }
    }
  }
  return result
}

function getMetricValue(agg, entity, period, metric, useAvg) {
  const e = agg[entity]?.[period]?.[metric]
  if (!e || e.count === 0) return 0
  return useAvg ? e.sum / e.count : e.sum
}

function getEntities(agg, latestPeriod) {
  return Object.keys(agg).sort((a, b) => {
    const aRev = agg[a]?.[latestPeriod]?.revenue?.sum || 0
    const bRev = agg[b]?.[latestPeriod]?.revenue?.sum || 0
    return bRev - aRev
  })
}

// Vergleichs-Karte für eine Entity
function ComparisonCard({ entity, agg, periodA, periodB, metrics, sparklineData, headerColor }) {
  const periodADays = periodA?.daysCount || 1
  const periodBDays = periodB?.daysCount || 1
  return (
    <div style={cardS}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ width: 8, height: 8, borderRadius: 2, background: headerColor }} />
        <div style={{ fontSize: 14, fontWeight: 700, color: headerColor, flex: 1 }}>{entity}</div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
          {periodA.label} → {periodB.label}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: 8 }}>
        {metrics.map(m => {
          const valA = getMetricValue(agg, entity, periodA.key, m.key, m.useAvg)
          const valB = getMetricValue(agg, entity, periodB.key, m.key, m.useAvg)
          // Bei Sums: für Monatsvergleich auf Tagesschnitt normalisieren
          const valAnorm = m.useAvg ? valA : (valA / periodADays)
          const valBnorm = m.useAvg ? valB : (valB / periodBDays)
          const sparkData = sparklineData?.[entity]?.[m.key] || []
          return (
            <div key={m.key} style={{ background: 'var(--bg-card2)', borderRadius: 7, padding: '8px 10px' }}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.04em' }}>{m.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace', lineHeight: 1.1 }}>
                {m.format(valBnorm)}
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 2 }}>
                vs {m.format(valAnorm)}
              </div>
              <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                <TrendIndicator current={valBnorm} previous={valAnorm} isInverse={m.inverse} />
                <Sparkline data={sparkData} color={headerColor} width={50} height={14} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// HAUPTKOMPONENTE
export default function PerformanceTab({ modelSnapshots = [], chatterSnapshots = [] }) {
  const [tab, setTab] = useState('models')
  const [periodMode, setPeriodMode] = useState('week')
  const [selectedWeekA, setSelectedWeekA] = useState('')
  const [selectedWeekB, setSelectedWeekB] = useState('')
  const [selectedMonthA, setSelectedMonthA] = useState('')
  const [selectedMonthB, setSelectedMonthB] = useState('')

  const modelMetricKeys = ['revenue', 'subs', 'tipsRevenue', 'messageRevenue', 'subsRevenue']
  const chatterMetricKeys = ['revenue', 'buyRate', 'sentMessages', 'activeHours', 'avgResponseSeconds', 'revenuePerHour']

  // Aggregationen
  const modelByWeek = useMemo(() => aggregateSnapshots(modelSnapshots, 'creator', modelMetricKeys, d => isoWeekKey(d)), [modelSnapshots])
  const modelByMonth = useMemo(() => aggregateSnapshots(modelSnapshots, 'creator', modelMetricKeys, d => monthKey(d)), [modelSnapshots])
  const chatterByWeek = useMemo(() => aggregateSnapshots(chatterSnapshots, 'name', chatterMetricKeys, d => isoWeekKey(d)), [chatterSnapshots])
  const chatterByMonth = useMemo(() => aggregateSnapshots(chatterSnapshots, 'name', chatterMetricKeys, d => monthKey(d)), [chatterSnapshots])

  // Tag-Counts pro Periode
  const periodDayCount = useMemo(() => {
    const result = { week: {}, month: {} }
    for (const snap of [...modelSnapshots, ...chatterSnapshots]) {
      if (!snap.businessDate) continue
      const d = new Date(snap.businessDate + 'T12:00:00')
      const wKey = isoWeekKey(d)
      const mKey = monthKey(d)
      if (!result.week[wKey]) result.week[wKey] = new Set()
      if (!result.month[mKey]) result.month[mKey] = new Set()
      result.week[wKey].add(snap.businessDate)
      result.month[mKey].add(snap.businessDate)
    }
    return result
  }, [modelSnapshots, chatterSnapshots])

  // Verfügbare Wochen/Monate
  const allWeeks = useMemo(() => {
    const set = new Set()
    for (const snap of [...modelSnapshots, ...chatterSnapshots]) {
      if (snap.businessDate) set.add(isoWeekKey(new Date(snap.businessDate + 'T12:00:00')))
    }
    return [...set].sort()
  }, [modelSnapshots, chatterSnapshots])

  const allMonths = useMemo(() => {
    const set = new Set()
    for (const snap of [...modelSnapshots, ...chatterSnapshots]) {
      if (snap.businessDate) set.add(monthKey(new Date(snap.businessDate + 'T12:00:00')))
    }
    return [...set].sort()
  }, [modelSnapshots, chatterSnapshots])

  // Default-Auswahl
  useEffect(() => {
    if (allWeeks.length >= 2 && !selectedWeekA && !selectedWeekB) {
      setSelectedWeekB(allWeeks[allWeeks.length - 1])
      setSelectedWeekA(allWeeks[allWeeks.length - 2])
    } else if (allWeeks.length === 1 && !selectedWeekB) {
      setSelectedWeekB(allWeeks[0])
      setSelectedWeekA(allWeeks[0])
    }
  }, [allWeeks])

  useEffect(() => {
    if (allMonths.length >= 2 && !selectedMonthA && !selectedMonthB) {
      setSelectedMonthB(allMonths[allMonths.length - 1])
      setSelectedMonthA(allMonths[allMonths.length - 2])
    } else if (allMonths.length === 1 && !selectedMonthB) {
      setSelectedMonthB(allMonths[0])
      setSelectedMonthA(allMonths[0])
    }
  }, [allMonths])

  // Aktuelle Periodenobjekte
  const periodA = periodMode === 'week'
    ? { key: selectedWeekA, label: isoWeekLabel(selectedWeekA), daysCount: periodDayCount.week[selectedWeekA]?.size || 7 }
    : { key: selectedMonthA, label: monthLabel(selectedMonthA), daysCount: elapsedDaysInMonth(selectedMonthA || monthKey(new Date())) }
  const periodB = periodMode === 'week'
    ? { key: selectedWeekB, label: isoWeekLabel(selectedWeekB), daysCount: periodDayCount.week[selectedWeekB]?.size || 7 }
    : { key: selectedMonthB, label: monthLabel(selectedMonthB), daysCount: elapsedDaysInMonth(selectedMonthB || monthKey(new Date())) }

  // Sparkline-Daten
  const sparklineData = useMemo(() => {
    const periods = periodMode === 'week' ? allWeeks.slice(-8) : allMonths.slice(-6)
    const agg = tab === 'models' ? (periodMode === 'week' ? modelByWeek : modelByMonth) : (periodMode === 'week' ? chatterByWeek : chatterByMonth)
    const metricKeys = tab === 'models' ? modelMetricKeys : chatterMetricKeys
    const result = {}
    for (const entity of Object.keys(agg)) {
      result[entity] = {}
      for (const m of metricKeys) {
        result[entity][m] = periods.map(p => {
          const e = agg[entity]?.[p]?.[m]
          if (!e || e.count === 0) return 0
          const isAvg = ['avgResponseSeconds', 'buyRate', 'revenuePerHour'].includes(m)
          return isAvg ? e.sum / e.count : e.sum
        })
      }
    }
    return result
  }, [tab, periodMode, modelByWeek, modelByMonth, chatterByWeek, chatterByMonth, allWeeks, allMonths])

  // Metric-Konfigurationen
  const modelMetrics = [
    { key: 'revenue', label: 'Umsatz', format: v => '$' + Math.round(v).toLocaleString() },
    { key: 'tipsRevenue', label: 'Tips', format: v => '$' + Math.round(v).toLocaleString() },
    { key: 'messageRevenue', label: 'Msg Revenue', format: v => '$' + Math.round(v).toLocaleString() },
    { key: 'subsRevenue', label: 'Subs Revenue', format: v => '$' + Math.round(v).toLocaleString() },
    { key: 'subs', label: 'Subs', format: v => Math.round(v).toString() },
  ]

  const chatterMetrics = [
    { key: 'revenue', label: 'Umsatz', format: v => '$' + Math.round(v).toLocaleString() },
    { key: 'revenuePerHour', label: 'Umsatz/h', useAvg: true, format: v => '$' + v.toFixed(0) },
    { key: 'buyRate', label: 'Buy Rate', useAvg: true, format: v => v.toFixed(1) + '%' },
    { key: 'avgResponseSeconds', label: '⌀ Antw.', useAvg: true, inverse: true, format: v => v < 60 ? Math.round(v) + 's' : Math.floor(v/60) + 'm ' + Math.round(v%60) + 's' },
    { key: 'activeHours', label: 'Online h', format: v => v.toFixed(1) + 'h' },
    { key: 'sentMessages', label: 'Nachrichten', format: v => Math.round(v).toLocaleString() },
  ]

  const currentAgg = tab === 'models'
    ? (periodMode === 'week' ? modelByWeek : modelByMonth)
    : (periodMode === 'week' ? chatterByWeek : chatterByMonth)
  const entities = useMemo(() => getEntities(currentAgg, periodB?.key), [currentAgg, periodB?.key])

  // Insights (für 3. Tab)
  const insights = useMemo(() => {
    if (!chatterSnapshots.length) return null
    const byWeekday = [[], [], [], [], [], [], []]
    for (const snap of chatterSnapshots) {
      const d = new Date(snap.businessDate + 'T12:00:00')
      const dow = d.getDay() === 0 ? 6 : d.getDay() - 1
      const total = (snap.rows || []).reduce((s, r) => s + (r.revenue || 0), 0)
      if (total > 0) byWeekday[dow].push(total)
    }
    const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
    const weekdayAvg = byWeekday.map((vals, i) => ({
      day: DAYS[i],
      avg: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
    }))
    const bestDay = [...weekdayAvg].sort((a, b) => b.avg - a.avg)[0]
    const worstDay = [...weekdayAvg].filter(d => d.avg > 0).sort((a, b) => a.avg - b.avg)[0]
    return { weekdayAvg, bestDay, worstDay }
  }, [chatterSnapshots])

  if (!chatterSnapshots.length && !modelSnapshots.length) {
    return <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 60, fontSize: 14 }}>Noch keine Daten für Performance-Analyse</div>
  }

  const headerColor = tab === 'models' ? '#ec4899' : '#06b6d4'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Tab-Switcher */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[
          { key: 'models', label: '📸 Models', color: '#ec4899' },
          { key: 'chatters', label: '💬 Chatters', color: '#06b6d4' },
          { key: 'insights', label: '✨ Insights', color: '#a78bfa' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            fontSize: 12, padding: '6px 14px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700,
            background: tab === t.key ? `${t.color}22` : 'transparent',
            border: `1px solid ${tab === t.key ? t.color : 'var(--border)'}`,
            color: tab === t.key ? t.color : 'var(--text-secondary)',
          }}>{t.label}</button>
        ))}
      </div>

      {/* MODELS / CHATTERS – Vergleichs-Ansicht */}
      {(tab === 'models' || tab === 'chatters') && (
        <>
          {/* Periodenwahl */}
          <div style={cardS}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 4 }}>Vergleich:</span>
                {[
                  { key: 'week', label: 'Woche zu Woche' },
                  { key: 'month', label: 'Monat zu Monat' },
                ].map(p => (
                  <button key={p.key} onClick={() => setPeriodMode(p.key)} style={{
                    fontSize: 11, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                    background: periodMode === p.key ? 'rgba(124,58,237,0.15)' : 'transparent',
                    border: `1px solid ${periodMode === p.key ? '#7c3aed' : 'var(--border)'}`,
                    color: periodMode === p.key ? '#a78bfa' : 'var(--text-secondary)',
                  }}>{p.label}</button>
                ))}
              </div>

              {periodMode === 'week' ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Von</span>
                  <select value={selectedWeekA} onChange={e => setSelectedWeekA(e.target.value)} style={selectS}>
                    {allWeeks.map(w => <option key={w} value={w}>{isoWeekLabel(w)}</option>)}
                  </select>
                  <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>→</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Bis</span>
                  <select value={selectedWeekB} onChange={e => setSelectedWeekB(e.target.value)} style={selectS}>
                    {allWeeks.map(w => <option key={w} value={w}>{isoWeekLabel(w)}</option>)}
                  </select>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', marginLeft: 'auto' }}>
                    {periodA.daysCount}d · {periodB.daysCount}d
                  </span>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Von</span>
                  <select value={selectedMonthA} onChange={e => setSelectedMonthA(e.target.value)} style={selectS}>
                    {allMonths.map(m => <option key={m} value={m}>{monthLabel(m)}{isCurrentMonth(m) ? ' (läuft)' : ''}</option>)}
                  </select>
                  <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>→</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Bis</span>
                  <select value={selectedMonthB} onChange={e => setSelectedMonthB(e.target.value)} style={selectS}>
                    {allMonths.map(m => <option key={m} value={m}>{monthLabel(m)}{isCurrentMonth(m) ? ' (läuft)' : ''}</option>)}
                  </select>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', marginLeft: 'auto' }}>
                    {periodA.daysCount}d · {periodB.daysCount}d (auf Tag normiert)
                  </span>
                </div>
              )}
            </div>
          </div>

          {entities.length === 0 ? (
            <div style={{ ...cardS, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Keine Daten für die ausgewählten Perioden
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {entities.map(entity => (
                <ComparisonCard key={entity}
                  entity={entity}
                  agg={currentAgg}
                  periodA={periodA}
                  periodB={periodB}
                  metrics={tab === 'models' ? modelMetrics : chatterMetrics}
                  sparklineData={sparklineData}
                  headerColor={headerColor}
                />
              ))}
            </div>
          )}

          <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', padding: '4px 0' }}>
            Sparklines zeigen letzte {periodMode === 'week' ? '8 Wochen' : '6 Monate'} · Bei Monatsvergleich werden Werte auf Tagesschnitt normalisiert
          </div>
        </>
      )}

      {/* INSIGHTS */}
      {tab === 'insights' && insights && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            {[
              { label: 'Stärkster Tag', value: insights.bestDay?.day || '—', sub: insights.bestDay ? `Ø $${Math.round(insights.bestDay.avg).toLocaleString()}` : '', color: '#10b981' },
              { label: 'Schwächster Tag', value: insights.worstDay?.day || '—', sub: insights.worstDay ? `Ø $${Math.round(insights.worstDay.avg).toLocaleString()}` : '', color: '#ef4444' },
            ].map(k => (
              <div key={k.label} style={{ background: 'var(--bg-card2)', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>{k.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: k.color, fontFamily: 'monospace' }}>{k.value}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{k.sub}</div>
              </div>
            ))}
          </div>

          <div style={cardS}>
            <div style={labelS}>Umsatz nach Wochentag (Ø)</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 120, padding: '8px 0' }}>
              {insights.weekdayAvg.map(d => {
                const max = Math.max(...insights.weekdayAvg.map(x => x.avg), 1)
                const h = (d.avg / max) * 100
                const isBest = d.day === insights.bestDay?.day
                const isWorst = d.day === insights.worstDay?.day
                return (
                  <div key={d.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>${Math.round(d.avg).toLocaleString()}</div>
                    <div style={{ width: '100%', height: `${h}%`, minHeight: 4, background: isBest ? '#10b981' : isWorst ? '#ef4444' : '#7c3aed', borderRadius: 3, opacity: 0.7 }} />
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>{d.day}</div>
                  </div>
                )
              })}
            </div>
          </div>

          <div style={cardS}>
            <div style={labelS}>Insights</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {insights.bestDay && <div style={{ padding: '8px 10px', background: 'rgba(16,185,129,0.07)', borderLeft: '3px solid #10b981', borderRadius: '0 7px 7px 0' }}>
                <div style={{ fontSize: 12, color: 'var(--text-primary)' }}><span style={{ fontWeight: 700 }}>{insights.bestDay.day}</span> ist euer stärkster Tag mit Ø ${Math.round(insights.bestDay.avg).toLocaleString()} — Schichten hier priorisieren.</div>
              </div>}
              {insights.worstDay && <div style={{ padding: '8px 10px', background: 'rgba(239,68,68,0.07)', borderLeft: '3px solid #ef4444', borderRadius: '0 7px 7px 0' }}>
                <div style={{ fontSize: 12, color: 'var(--text-primary)' }}><span style={{ fontWeight: 700 }}>{insights.worstDay.day}</span> läuft am schwächsten mit Ø ${Math.round(insights.worstDay.avg).toLocaleString()} — gezielte Aktionen oder weniger Schichten.</div>
              </div>}
            </div>
          </div>
        </>
      )}

    </div>
  )
}
