import React, { useMemo, useEffect, useState } from 'react'
import { supabase } from '../supabase'

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

// ─── Farb-Palette ───
// bgPastel: heller Pastel-Background für Tile
// textDark: dunkle satte Variante für die Hauptzahl drüber
// border/text: Akzentfarbe
const MODEL_COLORS = [
  { bgPastel: '#FBEAF0', textDark: '#993556', border: '#ec4899', text: '#ec4899' },
  { bgPastel: '#EEEDFE', textDark: '#3C3489', border: '#a78bfa', text: '#a78bfa' },
  { bgPastel: '#FAECE7', textDark: '#993C1D', border: '#fb7185', text: '#fb7185' },
  { bgPastel: '#FAEEDA', textDark: '#854F0B', border: '#f59e0b', text: '#f59e0b' },
  { bgPastel: '#FBE6F0', textDark: '#9F2D5F', border: '#f472b6', text: '#f472b6' },
  { bgPastel: '#FAE8FF', textDark: '#86198F', border: '#d946ef', text: '#d946ef' },
  { bgPastel: '#FFEDD5', textDark: '#9A3412', border: '#f97316', text: '#f97316' },
  { bgPastel: '#EAF3DE', textDark: '#3B6D11', border: '#84cc16', text: '#84cc16' },
]
const CHATTER_COLORS = [
  { bgPastel: '#CFFAFE', textDark: '#155E75', border: '#06b6d4', text: '#06b6d4' },
  { bgPastel: '#CCFBF1', textDark: '#0F766E', border: '#14b8a6', text: '#14b8a6' },
  { bgPastel: '#E0E7FF', textDark: '#3730A3', border: '#6366f1', text: '#6366f1' },
  { bgPastel: '#E0F2FE', textDark: '#075985', border: '#38bdf8', text: '#38bdf8' },
  { bgPastel: '#EDE9FE', textDark: '#5B21B6', border: '#8b5cf6', text: '#8b5cf6' },
  { bgPastel: '#DCFCE7', textDark: '#166534', border: '#22c55e', text: '#22c55e' },
  { bgPastel: '#D1FAE5', textDark: '#065F46', border: '#10b981', text: '#10b981' },
  { bgPastel: '#DBEAFE', textDark: '#1E40AF', border: '#3b82f6', text: '#3b82f6' },
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

// ─── Aggregation pro raw Account ───
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

// Summe mehrerer Accounts in einer Periode/Metrik
function getMetricValueForGroup(agg, accounts, period, metric, useAvg) {
  let sum = 0, count = 0
  for (const acc of accounts) {
    const e = agg[acc]?.[period]?.[metric]
    if (!e || e.count === 0) continue
    sum += e.sum
    count += e.count
  }
  if (count === 0) return 0
  return useAvg ? sum / count : sum
}

// ─── Sub-Account Zeile beim Aufklappen ───
function SubAccountRow({ accountName, aliasLabel, agg, periodA, periodB, metrics, sparklineData, color }) {
  const periodADays = periodA?.daysCount || 1
  const periodBDays = periodB?.daysCount || 1
  const revBtotal = getMetricValue(agg, accountName, periodB.key, 'revenue', false)
  const revAtotal = getMetricValue(agg, accountName, periodA.key, 'revenue', false)
  const revBperDay = revBtotal / periodBDays
  const revAperDay = revAtotal / periodADays
  return (
    <div style={{
      borderLeft: `3px solid ${color.border}55`,
      paddingLeft: 12,
      marginLeft: 12,
      marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {aliasLabel && (
          <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 3, background: color.bgPastel, color: color.textDark, letterSpacing: '.04em' }}>
            {aliasLabel}
          </span>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'monospace', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {accountName}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
          ${Math.round(revBtotal).toLocaleString()}
        </span>
        <span style={{ minWidth: 65, textAlign: 'right' }}>
          <TrendIndicator current={revBperDay} previous={revAperDay} />
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: 6 }}>
        {metrics.map(m => {
          const valBraw = getMetricValue(agg, accountName, periodB.key, m.key, m.useAvg)
          const valAraw = getMetricValue(agg, accountName, periodA.key, m.key, m.useAvg)
          const isSum = !m.useAvg
          const valBcompare = isSum ? (valBraw / periodBDays) : valBraw
          const valAcompare = isSum ? (valAraw / periodADays) : valAraw
          const valBperDay = isSum ? (valBraw / periodBDays) : null
          const sparkData = sparklineData?.[accountName]?.[m.key] || []
          return (
            <div key={m.key} style={{
              background: color.bgPastel,
              borderRadius: 7,
              padding: '7px 10px',
              border: `1px solid ${color.border}33`,
            }}>
              <div style={{ fontSize: 9, color: color.textDark, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700, opacity: 0.7 }}>
                {m.label}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: color.textDark, fontFamily: 'monospace', lineHeight: 1.1 }}>
                {m.format(valBraw)}
              </div>
              {valBperDay != null && (
                <div style={{ fontSize: 9, color: color.textDark, opacity: 0.6, fontFamily: 'monospace' }}>
                  ⌀ {m.format(valBperDay)}/Tag
                </div>
              )}
              <div style={{ marginTop: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                <TrendIndicator current={valBcompare} previous={valAcompare} isInverse={m.inverse} />
                <Sparkline data={sparkData} color={color.text} width={40} height={12} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Collapsible Card (Group oder Solo) ───
function CollapsibleEntityCard({ entity, accounts, agg, periodA, periodB, metrics, sparklineData, sparklineGroupData, color, isOpen, onToggle, isGroup, aliasLabels }) {
  const periodADays = periodA?.daysCount || 1
  const periodBDays = periodB?.daysCount || 1
  // Header-Werte: Summe über alle Accounts der Gruppe
  const revBtotal = getMetricValueForGroup(agg, accounts, periodB.key, 'revenue', false)
  const revAtotal = getMetricValueForGroup(agg, accounts, periodA.key, 'revenue', false)
  const revBperDay = revBtotal / periodBDays
  const revAperDay = revAtotal / periodADays

  return (
    <div style={{ background: 'var(--bg-card)', border: `1px solid ${color.border}55`, borderRadius: 10, overflow: 'hidden' }}>
      {/* Header — klickbar */}
      <div onClick={onToggle} style={{
        background: color.bgPastel + '22',
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
          {isGroup && accounts.length > 1 && (
            <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6, fontFamily: 'monospace' }}>
              ({accounts.length} Accounts)
            </span>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 100 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
            ${Math.round(revBtotal).toLocaleString()}
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            ⌀ ${Math.round(revBperDay).toLocaleString()}/Tag
          </div>
        </div>
        <div style={{ minWidth: 70, textAlign: 'right' }}>
          <TrendIndicator current={revBperDay} previous={revAperDay} big />
        </div>
      </div>

      {/* Inhalt — nur wenn aufgeklappt */}
      {isOpen && (
        <div style={{ padding: 12, background: 'var(--bg-card)' }}>

          {/* GROUP-AGGREGAT (alle Accounts zusammen) */}
          <div style={{ marginBottom: isGroup && accounts.length > 1 ? 14 : 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
              {metrics.map(m => {
                const valBraw = getMetricValueForGroup(agg, accounts, periodB.key, m.key, m.useAvg)
                const valAraw = getMetricValueForGroup(agg, accounts, periodA.key, m.key, m.useAvg)
                const isSum = !m.useAvg
                const valBcompare = isSum ? (valBraw / periodBDays) : valBraw
                const valAcompare = isSum ? (valAraw / periodADays) : valAraw
                const valBperDay = isSum ? (valBraw / periodBDays) : null
                const sparkData = sparklineGroupData?.[entity]?.[m.key] || []
                return (
                  <div key={m.key} style={{
                    background: color.bgPastel,
                    borderRadius: 8,
                    padding: '10px 12px',
                    border: `1px solid ${color.border}44`,
                  }}>
                    <div style={{ fontSize: 9, color: color.textDark, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700, opacity: 0.75 }}>
                      {m.label}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: color.textDark, fontFamily: 'monospace', lineHeight: 1.1 }}>
                      {m.format(valBraw)}
                    </div>
                    {valBperDay != null && (
                      <div style={{ fontSize: 9, color: color.textDark, opacity: 0.65, fontFamily: 'monospace', marginTop: 2 }}>
                        ⌀ {m.format(valBperDay)}/Tag
                      </div>
                    )}
                    <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                      <TrendIndicator current={valBcompare} previous={valAcompare} isInverse={m.inverse} />
                      <Sparkline data={sparkData} color={color.text} width={50} height={14} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Sub-Accounts wenn Gruppe mit >1 Account */}
          {isGroup && accounts.length > 1 && (
            <>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, marginBottom: 8, marginTop: 4 }}>
                Pro Account
              </div>
              {accounts.map(acc => (
                <SubAccountRow key={acc}
                  accountName={acc}
                  aliasLabel={aliasLabels[acc] || ''}
                  agg={agg}
                  periodA={periodA}
                  periodB={periodB}
                  metrics={metrics}
                  sparklineData={sparklineData}
                  color={color}
                />
              ))}
            </>
          )}
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
  const [filterModels, setFilterModels] = useState(new Set())
  const [filterChatters, setFilterChatters] = useState(new Set())

  // Model-Aliases aus DB laden für Account-Gruppierung
  const [modelAliases, setModelAliases] = useState([])
  useEffect(() => {
    supabase.from('model_aliases').select('model_name, csv_name, alias_label').then(({ data }) => {
      setModelAliases(data || [])
    })
  }, [])

  // Lookup: csv_name → display group name
  const accountToGroup = useMemo(() => {
    const map = {}
    for (const a of modelAliases) {
      if (a.csv_name && a.model_name) map[a.csv_name] = a.model_name
    }
    return map
  }, [modelAliases])

  // Lookup: csv_name → alias_label (FREE/VIP/MAIN)
  const accountToLabel = useMemo(() => {
    const map = {}
    for (const a of modelAliases) {
      if (a.csv_name) map[a.csv_name] = a.alias_label || ''
    }
    return map
  }, [modelAliases])

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

  // Chatter Entities (flat, nur Sternchen-Filter)
  const chatterEntities = useMemo(() => {
    const agg = periodMode === 'week' ? chatterByWeek : chatterByMonth
    return Object.keys(agg)
      .filter(name => !/\*/.test(name))
      .sort((a, b) => {
        const aRev = agg[a]?.[periodB?.key]?.revenue?.sum || 0
        const bRev = agg[b]?.[periodB?.key]?.revenue?.sum || 0
        return bRev - aRev
      })
  }, [chatterByWeek, chatterByMonth, periodMode, periodB?.key])

  // Model-Gruppen (display name + accounts list)
  const modelGroupedEntities = useMemo(() => {
    const agg = periodMode === 'week' ? modelByWeek : modelByMonth
    const groups = {} // display_name → { accounts: [], totalRev: 0 }
    for (const account of Object.keys(agg)) {
      if (/\*/.test(account)) continue // Sternchen raus
      const groupName = accountToGroup[account] || account
      if (!groups[groupName]) groups[groupName] = { accounts: [], totalRev: 0 }
      groups[groupName].accounts.push(account)
      groups[groupName].totalRev += (agg[account]?.[periodB?.key]?.revenue?.sum || 0)
    }
    // Sortiere nach Total-Revenue
    return Object.entries(groups)
      .sort((a, b) => b[1].totalRev - a[1].totalRev)
      .map(([name, info]) => ({
        name,
        accounts: info.accounts,
        isGroup: info.accounts.length > 1 || !!accountToGroup[info.accounts[0]],
      }))
  }, [modelByWeek, modelByMonth, periodMode, periodB?.key, accountToGroup])

  // Sparkline-Daten pro Account (für Sub-Accounts) und pro Gruppe (für Header-Tile)
  const sparklineData = useMemo(() => {
    // pro Account
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

  // Sparkline-Daten pro Gruppe (Summe der Accounts)
  const sparklineGroupData = useMemo(() => {
    if (tab !== 'models') return {}
    const periods = periodMode === 'week' ? allWeeks.slice(-8) : allMonths.slice(-6)
    const agg = periodMode === 'week' ? modelByWeek : modelByMonth
    const result = {}
    for (const grp of modelGroupedEntities) {
      result[grp.name] = {}
      for (const m of modelMetricKeys) {
        result[grp.name][m] = periods.map(p => {
          let sum = 0, count = 0
          for (const acc of grp.accounts) {
            const e = agg[acc]?.[p]?.[m]
            if (!e || e.count === 0) continue
            sum += e.sum
            count += e.count
          }
          if (count === 0) return 0
          const isAvg = ['avgResponseSeconds', 'buyRate', 'revenuePerHour'].includes(m)
          return isAvg ? sum / count : sum
        })
      }
    }
    return result
  }, [tab, periodMode, modelByWeek, modelByMonth, allWeeks, allMonths, modelGroupedEntities])

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

  // Aktuelle Listen + Filter
  const currentAgg = tab === 'models'
    ? (periodMode === 'week' ? modelByWeek : modelByMonth)
    : (periodMode === 'week' ? chatterByWeek : chatterByMonth)

  const allEntityNames = tab === 'models'
    ? modelGroupedEntities.map(g => g.name)
    : chatterEntities

  const activeFilter = tab === 'models' ? filterModels : filterChatters
  const setActiveFilter = tab === 'models' ? setFilterModels : setFilterChatters
  const visibleEntityNames = activeFilter.size === 0 ? allEntityNames : allEntityNames.filter(e => activeFilter.has(e))

  const palette = tab === 'models' ? MODEL_COLORS : CHATTER_COLORS

  const toggleCard = (entity) => {
    setOpenCards(prev => {
      const next = new Set(prev)
      if (next.has(entity)) next.delete(entity); else next.add(entity)
      return next
    })
  }
  const expandAll = () => setOpenCards(new Set(visibleEntityNames))
  const collapseAll = () => setOpenCards(new Set())

  const toggleFilter = (entity) => {
    setActiveFilter(prev => {
      const next = new Set(prev)
      if (next.has(entity)) next.delete(entity); else next.add(entity)
      return next
    })
  }
  const clearFilter = () => setActiveFilter(new Set())

  // Insights
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
                    {periodA.daysCount}d · {periodB.daysCount}d
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Filter-Chips */}
          {allEntityNames.length > 1 && (
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
                {allEntityNames.map(entity => {
                  const c = getColorForEntity(entity, allEntityNames, palette)
                  const isActive = activeFilter.size === 0 || activeFilter.has(entity)
                  return (
                    <button key={entity} onClick={() => toggleFilter(entity)} style={{
                      fontSize: 11, padding: '4px 10px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                      background: isActive ? c.bgPastel : 'transparent',
                      border: `1px solid ${isActive ? c.border : 'var(--border)'}`,
                      color: isActive ? c.textDark : 'var(--text-muted)',
                      opacity: isActive ? 1 : 0.55,
                    }}>{entity}</button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Liste */}
          {visibleEntityNames.length === 0 ? (
            <div style={{ ...cardS, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Keine Daten für die ausgewählten Perioden
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {visibleEntityNames.map(entity => {
                const c = getColorForEntity(entity, allEntityNames, palette)
                let accounts, isGroupCard
                if (tab === 'models') {
                  const grp = modelGroupedEntities.find(g => g.name === entity)
                  accounts = grp?.accounts || [entity]
                  isGroupCard = grp?.isGroup || false
                } else {
                  accounts = [entity]
                  isGroupCard = false
                }
                return (
                  <CollapsibleEntityCard key={entity}
                    entity={entity}
                    accounts={accounts}
                    isGroup={isGroupCard}
                    aliasLabels={accountToLabel}
                    agg={currentAgg}
                    periodA={periodA}
                    periodB={periodB}
                    metrics={tab === 'models' ? modelMetrics : chatterMetrics}
                    sparklineData={sparklineData}
                    sparklineGroupData={sparklineGroupData}
                    color={c}
                    isOpen={openCards.has(entity)}
                    onToggle={() => toggleCard(entity)}
                  />
                )
              })}
            </div>
          )}

          <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', padding: '4px 0' }}>
            Hauptzahl = Gesamt · ⌀ pro Tag drunter · Trends auf Tagesbasis berechnet · Bei Models mit mehreren Accounts: aufklappen für Details
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
        </>
      )}

    </div>
  )
}
