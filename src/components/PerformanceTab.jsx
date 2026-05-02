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

// Farb-Palette für Models (warm/feminin) und Chatter (kühl/technisch)
const MODEL_COLORS = [
  { name: 'pink',   bg: 'rgba(236,72,153,0.10)', border: '#ec4899', text: '#ec4899', bgSoft: 'rgba(236,72,153,0.05)' },
  { name: 'purple', bg: 'rgba(167,139,250,0.10)', border: '#a78bfa', text: '#a78bfa', bgSoft: 'rgba(167,139,250,0.05)' },
  { name: 'coral',  bg: 'rgba(251,113,133,0.10)', border: '#fb7185', text: '#fb7185', bgSoft: 'rgba(251,113,133,0.05)' },
  { name: 'amber',  bg: 'rgba(245,158,11,0.10)', border: '#f59e0b', text: '#f59e0b', bgSoft: 'rgba(245,158,11,0.05)' },
  { name: 'rose',   bg: 'rgba(244,114,182,0.10)', border: '#f472b6', text: '#f472b6', bgSoft: 'rgba(244,114,182,0.05)' },
  { name: 'fuchsia',bg: 'rgba(217,70,239,0.10)', border: '#d946ef', text: '#d946ef', bgSoft: 'rgba(217,70,239,0.05)' },
  { name: 'orange', bg: 'rgba(249,115,22,0.10)', border: '#f97316', text: '#f97316', bgSoft: 'rgba(249,115,22,0.05)' },
  { name: 'lime',   bg: 'rgba(132,204,22,0.10)', border: '#84cc16', text: '#84cc16', bgSoft: 'rgba(132,204,22,0.05)' },
]
const CHATTER_COLORS = [
  { name: 'cyan',   bg: 'rgba(6,182,212,0.10)', border: '#06b6d4', text: '#06b6d4', bgSoft: 'rgba(6,182,212,0.05)' },
  { name: 'teal',   bg: 'rgba(20,184,166,0.10)', border: '#14b8a6', text: '#14b8a6', bgSoft: 'rgba(20,184,166,0.05)' },
  { name: 'indigo', bg: 'rgba(99,102,241,0.10)', border: '#6366f1', text: '#6366f1', bgSoft: 'rgba(99,102,241,0.05)' },
  { name: 'sky',    bg: 'rgba(56,189,248,0.10)', border: '#38bdf8', text: '#38bdf8', bgSoft: 'rgba(56,189,248,0.05)' },
  { name: 'violet', bg: 'rgba(139,92,246,0.10)', border: '#8b5cf6', text: '#8b5cf6', bgSoft: 'rgba(139,92,246,0.05)' },
  { name: 'green',  bg: 'rgba(34,197,94,0.10)', border: '#22c55e', text: '#22c55e', bgSoft: 'rgba(34,197,94,0.05)' },
  { name: 'emerald',bg: 'rgba(16,185,129,0.10)', border: '#10b981', text: '#10b981', bgSoft: 'rgba(16,185,129,0.05)' },
  { name: 'blue',   bg: 'rgba(59,130,246,0.10)', border: '#3b82f6', text: '#3b82f6', bgSoft: 'rgba(59,130,246,0.05)' },
]

function getColorForEntity(entity, allEntities, palette) {
  const idx = allEntities.indexOf(entity)
  if (idx < 0) return palette[0]
  return palette[idx % palette.length]
}

// ─── Datum-Helpers ───
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
function isCurrentMonth(mKey) { return mKey === monthKey(new Date()) }
function elapsedDaysInMonth(mKey) {
  if (!isCurrentMonth(mKey)) return daysInMonth(mKey)
  return new Date().getDate()
}

// ─── Trend & Sparkline ───
function TrendIndicator({ current, previous, isInverse = false, big = false }) {
  if (previous === 0 || previous == null) {
    if (current > 0) return <span style={{ fontSize: big ? 12 : 10, color: '#10b981', fontWeight: 600 }}>neu</span>
    return <span style={{ fontSize: big ? 12 : 10, color: 'var(--text-muted)' }}>—</span>
  }
  const diff = current - previous
  const pct = (diff / Math.abs(previous)) * 100
  const isPositive = isInverse ? diff < 0 : diff > 0
  const closeToZero = Math.abs(pct) < 0.5
  const color = closeToZero ? 'var(--text-muted)' : (isPositive ? '#10b981' : '#ef4444')
  const arrow = closeToZero ? '·' : (diff > 0 ? '▲' : '▼')
  return (
    <span style={{ fontSize: big ? 12 : 11, color, fontWeight: 600, fontFamily: 'monospace' }}>
      {arrow} {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
    </span>
  )
}

function Sparkline({ data, color = '#7c3aed', width = 60, height = 18 }) {
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

// ─── Aggregation ───
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

// ─── Collapsible Card ───
function CollapsibleEntityCard({ entity, agg, periodA, periodB, metrics, sparklineData, color, isOpen, onToggle }) {
  const periodADays = periodA?.daysCount || 1
  const periodBDays = periodB?.daysCount || 1
  // Header-Werte (Umsatz + Trend)
  const revB = getMetricValue(agg, entity, periodB.key, 'revenue', false) / periodBDays
  const revA = getMetricValue(agg, entity, periodA.key, 'revenue', false) / periodADays

  return (
    <div style={{ background: 'var(--bg-card)', border: `1px solid ${color.border}55`, borderRadius: 10, overflow: 'hidden', transition: 'all 0.2s' }}>
      {/* Header — klickbar */}
      <div onClick={onToggle} style={{
        background: color.bgSoft,
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        cursor: 'pointer',
        userSelect: 'none',
      }}>
        <div style={{ fontSize: 11, color: color.text, transition: 'transform 0.2s', display: 'inline-block', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: color.text, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entity}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
          ${Math.round(revB).toLocaleString()}
        </div>
        <div style={{ minWidth: 70, textAlign: 'right' }}>
          <TrendIndicator current={revB} previous={revA} big />
        </div>
      </div>

      {/* Inhalt — nur wenn aufgeklappt */}
      {isOpen && (
        <div style={{ padding: 12, background: 'var(--bg-card)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: 8 }}>
            {metrics.map(m => {
              const valA = getMetricValue(agg, entity, periodA.key, m.key, m.useAvg)
              const valB = getMetricValue(agg, entity, periodB.key, m.key, m.useAvg)
              const valAnorm = m.useAvg ? valA : (valA / periodADays)
              const valBnorm = m.useAvg ? valB : (valB / periodBDays)
              const sparkData = sparklineData?.[entity]?.[m.key] || []
              return (
                <div key={m.key} style={{ background: color.bg, borderRadius: 7, padding: '8px 10px' }}>
                  <div style={{ fontSize: 9, color: color.text, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700, opacity: 0.8 }}>{m.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace', lineHeight: 1.1 }}>
                    {m.format(valBnorm)}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 2 }}>
                    vs {m.format(valAnorm)}
                  </div>
                  <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                    <TrendIndicator current={valBnorm} previous={valAnorm} isInverse={m.inverse} />
                    <Sparkline data={sparkData} color={color.text} width={50} height={14} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── HAUPTKOMPONENTE ───
export default function PerformanceTab({ modelSnapshots = [], chatterSnapshots = [] }) {
  const [tab, setTab] = useState('models')
  const [periodMode, setPeriodMode] = useState('week')
  const [selectedWeekA, setSelectedWeekA] = useState('')
  const [selectedWeekB, setSelectedWeekB] = useState('')
  const [selectedMonthA, setSelectedMonthA] = useState('')
  const [selectedMonthB, setSelectedMonthB] = useState('')
  const [openCards, setOpenCards] = useState(new Set())
  const [filterModels, setFilterModels] = useState(new Set()) // empty = alle, sonst nur diese
  const [filterChatters, setFilterChatters] = useState(new Set())

  const modelMetricKeys = ['revenue', 'subs', 'tipsRevenue', 'messageRevenue', 'subsRevenue']
  const chatterMetricKeys = ['revenue', 'buyRate', 'sentMessages', 'activeHours', 'avgResponseSeconds', 'revenuePerHour']

  const modelByWeek = useMemo(() => aggregateSnapshots(modelSnapshots, 'creator', modelMetricKeys, d => isoWeekKey(d)), [modelSnapshots])
  const modelByMonth = useMemo(() => aggregateSnapshots(modelSnapshots, 'creator', modelMetricKeys, d => monthKey(d)), [modelSnapshots])
  const chatterByWeek = useMemo(() => aggregateSnapshots(chatterSnapshots, 'name', chatterMetricKeys, d => isoWeekKey(d)), [chatterSnapshots])
  const chatterByMonth = useMemo(() => aggregateSnapshots(chatterSnapshots, 'name', chatterMetricKeys, d => monthKey(d)), [chatterSnapshots])

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

  useEffect(() => {
    if (allWeeks.length >= 2 && !selectedWeekA && !selectedWeekB) {
      setSelectedWeekB(allWeeks[allWeeks.length - 1])
      setSelectedWeekA(allWeeks[allWeeks.length - 2])
    } else if (allWeeks.length === 1 && !selectedWeekB) {
      setSelectedWeekB(allWeeks[0]); setSelectedWeekA(allWeeks[0])
    }
  }, [allWeeks])

  useEffect(() => {
    if (allMonths.length >= 2 && !selectedMonthA && !selectedMonthB) {
      setSelectedMonthB(allMonths[allMonths.length - 1])
      setSelectedMonthA(allMonths[allMonths.length - 2])
    } else if (allMonths.length === 1 && !selectedMonthB) {
      setSelectedMonthB(allMonths[0]); setSelectedMonthA(allMonths[0])
    }
  }, [allMonths])

  const periodA = periodMode === 'week'
    ? { key: selectedWeekA, label: isoWeekLabel(selectedWeekA), daysCount: periodDayCount.week[selectedWeekA]?.size || 7 }
    : { key: selectedMonthA, label: monthLabel(selectedMonthA), daysCount: elapsedDaysInMonth(selectedMonthA || monthKey(new Date())) }
  const periodB = periodMode === 'week'
    ? { key: selectedWeekB, label: isoWeekLabel(selectedWeekB), daysCount: periodDayCount.week[selectedWeekB]?.size || 7 }
    : { key: selectedMonthB, label: monthLabel(selectedMonthB), daysCount: elapsedDaysInMonth(selectedMonthB || monthKey(new Date())) }

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
  const allEntities = useMemo(() => getEntities(currentAgg, periodB?.key), [currentAgg, periodB?.key])

  // Filter anwenden
  const activeFilter = tab === 'models' ? filterModels : filterChatters
  const setActiveFilter = tab === 'models' ? setFilterModels : setFilterChatters
  const visibleEntities = activeFilter.size === 0 ? allEntities : allEntities.filter(e => activeFilter.has(e))

  const palette = tab === 'models' ? MODEL_COLORS : CHATTER_COLORS
  const tabColor = tab === 'models' ? '#ec4899' : '#06b6d4'

  // Toggle Card
  const toggleCard = (entity) => {
    setOpenCards(prev => {
      const next = new Set(prev)
      if (next.has(entity)) next.delete(entity)
      else next.add(entity)
      return next
    })
  }
  const expandAll = () => setOpenCards(new Set(visibleEntities))
  const collapseAll = () => setOpenCards(new Set())

  // Filter-Toggle
  const toggleFilter = (entity) => {
    setActiveFilter(prev => {
      const next = new Set(prev)
      if (next.has(entity)) next.delete(entity)
      else next.add(entity)
      return next
    })
  }
  const clearFilter = () => setActiveFilter(new Set())

  // Insights (alt)
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Tab-Switcher */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
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

        {(tab === 'models' || tab === 'chatters') && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button onClick={expandAll} style={{ fontSize: 10, padding: '5px 10px', borderRadius: 5, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>▼ Alle auf</button>
            <button onClick={collapseAll} style={{ fontSize: 10, padding: '5px 10px', borderRadius: 5, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>▶ Alle zu</button>
          </div>
        )}
      </div>

      {/* MODELS / CHATTERS */}
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

          {/* Filter-Chips */}
          {allEntities.length > 1 && (
            <div style={{ ...cardS, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>
                  {activeFilter.size === 0 ? 'Alle anzeigen' : `${activeFilter.size} ausgewählt`}
                </span>
                {activeFilter.size > 0 && (
                  <button onClick={clearFilter} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                    ✕ Filter zurücksetzen
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {allEntities.map(entity => {
                  const c = getColorForEntity(entity, allEntities, palette)
                  const isActive = activeFilter.size === 0 || activeFilter.has(entity)
                  return (
                    <button key={entity} onClick={() => toggleFilter(entity)} style={{
                      fontSize: 11,
                      padding: '4px 10px',
                      borderRadius: 5,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontWeight: 600,
                      background: isActive ? c.bg : 'transparent',
                      border: `1px solid ${isActive ? c.border : 'var(--border)'}`,
                      color: isActive ? c.text : 'var(--text-muted)',
                      opacity: isActive ? 1 : 0.55,
                      transition: 'all 0.15s',
                    }}>{entity}</button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Liste */}
          {visibleEntities.length === 0 ? (
            <div style={{ ...cardS, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              {allEntities.length === 0 ? 'Keine Daten für die ausgewählten Perioden' : 'Keine Auswahl — alle Filter aktiv aber keine Daten'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {visibleEntities.map(entity => {
                const c = getColorForEntity(entity, allEntities, palette)
                return (
                  <CollapsibleEntityCard key={entity}
                    entity={entity}
                    agg={currentAgg}
                    periodA={periodA}
                    periodB={periodB}
                    metrics={tab === 'models' ? modelMetrics : chatterMetrics}
                    sparklineData={sparklineData}
                    color={c}
                    isOpen={openCards.has(entity)}
                    onToggle={() => toggleCard(entity)}
                  />
                )
              })}
            </div>
          )}

          <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', padding: '4px 0' }}>
            Sparklines: letzte {periodMode === 'week' ? '8 Wochen' : '6 Monate'} · Monatsvergleich auf Tagesschnitt normiert · Klick auf Header zum Ein-/Ausklappen
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
