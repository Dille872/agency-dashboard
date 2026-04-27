import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import Card from './Card'
import KpiCard from './KpiCard'
import RevenueTrendChart from './RevenueTrendChart'
import RankingBar from './RankingBar'
import DeltaList from './DeltaList'
import Heatmap from './Heatmap'
import FallingAlert from './FallingAlert'
import {
  formatMoney, pctChange, safeDivide,
  getLast7Snapshots, getPreviousSnapshot,
  getMonetizationType, computeModelTrend, computeModelStatus,
  getWeekNumber, getMonthStr
} from '../utils'

const statusColors = {
  'Skalieren': 'var(--green)',
  'Stark': 'var(--green)',
  'Stabil': 'var(--cyan)',
  'OK': 'var(--yellow)',
  'Unterm Soll': 'var(--red)',
  'Preisproblem': 'var(--red)',
  'Beobachten': 'var(--yellow)',
  'Instabil': 'var(--orange)',
  'Inaktiv': 'var(--text-muted)',
  'Gemischt': 'var(--cyan)',
}
const trendColors = {
  'Steigend': 'var(--green)',
  'Fallend': 'var(--red)',
  'Seitwärts': 'var(--text-secondary)',
  'Instabil': 'var(--orange)',
}

export default function ModelsView({ selectedDate, modelSnapshots, chatterSnapshots, onDateChange }) {
  const [aliases, setAliases] = useState([])
  const [targets, setTargets] = useState({}) // { model_name: daily_target }
  const [editingTarget, setEditingTarget] = useState(null)
  const [targetInput, setTargetInput] = useState('')

  useEffect(() => {
    loadAliasesAndTargets()
  }, [])

  const loadAliasesAndTargets = async () => {
    const [{ data: aliasData }, { data: targetData }] = await Promise.all([
      supabase.from('model_aliases').select('*'),
      supabase.from('model_revenue_targets').select('*'),
    ])
    setAliases(aliasData || [])
    const tMap = {}
    for (const t of targetData || []) tMap[t.model_name] = t.daily_target
    setTargets(tMap)
  }

  // Mapping: csv_name → model_name (Fallback: csv_name selbst)
  const getModelGroup = (csvName) => {
    const a = aliases.find(x => x.csv_name === csvName)
    return a?.model_name || csvName
  }

  const saveTarget = async (modelName, value) => {
    const num = parseFloat(value)
    if (!modelName) return
    if (isNaN(num) || num <= 0) {
      // Leer / ungültig → Eintrag löschen
      await supabase.from('model_revenue_targets').delete().eq('model_name', modelName)
      setTargets(prev => { const n = { ...prev }; delete n[modelName]; return n })
    } else {
      await supabase.from('model_revenue_targets').upsert({ model_name: modelName, daily_target: num, updated_at: new Date().toISOString() })
      setTargets(prev => ({ ...prev, [modelName]: num }))
    }
    setEditingTarget(null)
  }

  const currentSnap = modelSnapshots.find(s => s.businessDate === selectedDate)
  const rows = currentSnap?.rows || []
  const prevSnap = getPreviousSnapshot(modelSnapshots, selectedDate)
  const prevRows = prevSnap?.rows || []
  const last7 = getLast7Snapshots(modelSnapshots, selectedDate)

  const currentChatterSnap = chatterSnapshots.find(s => s.businessDate === selectedDate)
  const chatterRows = currentChatterSnap?.rows || []
  const prevChatterSnap = getPreviousSnapshot(chatterSnapshots, selectedDate)
  const prevChatterRows = prevChatterSnap?.rows || []

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const totalRev = rows.reduce((s, r) => s + r.revenue, 0)
  const prevTotalRev = prevRows.reduce((s, r) => s + r.revenue, 0)
  const revDelta = pctChange(totalRev, prevTotalRev)
  const topModel = rows.length > 0 ? rows.reduce((a, b) => a.revenue > b.revenue ? a : b) : null
  const qualifiedModels = rows.filter(r => r.revenue > 0)
  const worstModel = qualifiedModels.length > 0 ? qualifiedModels.reduce((a, b) => a.revenue < b.revenue ? a : b) : null
  const activeChatterRows = chatterRows.filter(r => r.sentMessages > 0)
  const totalChatterRev = activeChatterRows.reduce((s, r) => s + r.revenue, 0)
  const prevActiveChatterRows = prevChatterRows.filter(r => r.sentMessages > 0)
  const prevTotalChatterRev = prevActiveChatterRows.reduce((s, r) => s + r.revenue, 0)
  const chatterRevDelta = pctChange(totalChatterRev, prevTotalChatterRev)
  const topChatter = activeChatterRows.length > 0 ? activeChatterRows.reduce((a, b) => a.revenue > b.revenue ? a : b) : null
  const qualifiedChatters = activeChatterRows.filter(r => r.sentMessages >= 50 && r.revenue > 0)
  const worstChatter = qualifiedChatters.length > 0 ? qualifiedChatters.reduce((a, b) => a.revenue < b.revenue ? a : b) : null

  // ── All model names (sorted by today's revenue) ───────────────────────────
  const allModelNames = [...new Set(modelSnapshots.flatMap(s => s.rows.map(r => r.creator)))]
    .sort((a, b) => {
      const aRev = rows.find(r => r.creator === a)?.revenue || 0
      const bRev = rows.find(r => r.creator === b)?.revenue || 0
      return bRev - aRev
    })
  const top6Names = allModelNames.slice(0, 6)

  // ── Ranking ───────────────────────────────────────────────────────────────
  const rankedRows = [...rows].sort((a, b) => b.revenue - a.revenue)
    .map(r => ({ ...r, monetization: getMonetizationType(r) }))

  // ── Delta vs prev day ─────────────────────────────────────────────────────
  const deltaItems = rows.map(r => {
    const prev = prevRows.find(p => p.creator === r.creator)
    const deltaPct = (prev && prev.revenue > 0) ? pctChange(r.revenue, prev.revenue) : null
    return { creator: r.creator, current: r.revenue, delta: r.revenue - (prev?.revenue || 0), deltaPct }
  })

  // ── Quick Summary ─────────────────────────────────────────────────────────
  const kwNum = selectedDate ? getWeekNumber(selectedDate) : '-'
  const monthStr = selectedDate ? getMonthStr(selectedDate) : '-'
  const kwSnaps = modelSnapshots.filter(s => getWeekNumber(s.businessDate) === kwNum && s.businessDate.slice(0, 4) === selectedDate?.slice(0, 4))
  const monthSnaps = modelSnapshots.filter(s => getMonthStr(s.businessDate) === monthStr)
  const kwRevenue = kwSnaps.reduce((s, snap) => s + snap.rows.reduce((ss, r) => ss + r.revenue, 0), 0)
  const monthRevenue = monthSnaps.reduce((s, snap) => s + snap.rows.reduce((ss, r) => ss + r.revenue, 0), 0)
  const kwSubs = kwSnaps.reduce((s, snap) => s + snap.rows.reduce((ss, r) => ss + r.subs, 0), 0)
  const monthSubs = monthSnaps.reduce((s, snap) => s + snap.rows.reduce((ss, r) => ss + r.subs, 0), 0)
  const kwChats = kwSnaps.reduce((s, snap) => s + snap.rows.reduce((ss, r) => ss + r.sellingChats, 0), 0)
  const kwMsgRev = kwSnaps.reduce((s, snap) => s + snap.rows.reduce((ss, r) => ss + r.messageRevenue, 0), 0)
  const kwAvgChat = safeDivide(kwMsgRev, kwChats)
  const monthChats = monthSnaps.reduce((s, snap) => s + snap.rows.reduce((ss, r) => ss + r.sellingChats, 0), 0)
  const monthMsgRev = monthSnaps.reduce((s, snap) => s + snap.rows.reduce((ss, r) => ss + r.messageRevenue, 0), 0)
  const monthAvgChat = safeDivide(monthMsgRev, monthChats)
  const todaySentPPVs = chatterRows.reduce((s, r) => s + r.sentPPVs, 0)
  const todayBoughtPPVs = chatterRows.reduce((s, r) => s + r.boughtPPVs, 0)
  const ppvBuyRate = safeDivide(todayBoughtPPVs * 100, todaySentPPVs)

  const heatmapNames = allModelNames

  // ── Big table ─────────────────────────────────────────────────────────────
  const tableRows = rows.map(r => {
    const prev = prevRows.find(p => p.creator === r.creator)
    const revDeltaRow = prev ? pctChange(r.revenue, prev.revenue) : 0
    const subsDelta = prev ? r.subs - prev.subs : 0
    const chatsDelta = prev ? r.sellingChats - prev.sellingChats : 0
    const avgChatDelta = prev ? pctChange(r.avgChatValue, prev.avgChatValue) : 0
    const snapsWith = last7.filter(s => s.rows.find(rr => rr.creator === r.creator))
    const rev7 = safeDivide(snapsWith.reduce((s, snap) => s + (snap.rows.find(rr => rr.creator === r.creator)?.revenue || 0), 0), snapsWith.length)
    const subs7 = safeDivide(snapsWith.reduce((s, snap) => s + (snap.rows.find(rr => rr.creator === r.creator)?.subs || 0), 0), snapsWith.length)
    const chats7 = safeDivide(snapsWith.reduce((s, snap) => s + (snap.rows.find(rr => rr.creator === r.creator)?.sellingChats || 0), 0), snapsWith.length)
    const avgChat7 = safeDivide(snapsWith.reduce((s, snap) => s + (snap.rows.find(rr => rr.creator === r.creator)?.avgChatValue || 0), 0), snapsWith.length)
    const trend = computeModelTrend(modelSnapshots, r.creator)
    const { status, recommendation } = computeModelStatus(r, trend)
    return { ...r, revDeltaRow, subsDelta, chatsDelta, avgChatDelta, rev7, subs7, chats7, avgChat7, trend, status, recommendation }
  }).sort((a, b) => b.revenue - a.revenue)

  const tdStyle = { padding: '10px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12 }
  const thStyle = { padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border-bright)', whiteSpace: 'nowrap' }
  const deltaStyle = (v) => ({ fontFamily: 'var(--font-mono)', fontSize: 11, color: v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text-muted)' })

  // ── Tagesziel-Daten berechnen (vor Render damit Alert-Block die Daten nutzen kann) ──
  const targetData = (() => {
    const selDateObj = new Date(selectedDate + 'T12:00:00')
    const monthYear = selDateObj.getFullYear()
    const monthNum = selDateObj.getMonth()
    const dayOfMonth = selDateObj.getDate()
    const daysInMonth = new Date(monthYear, monthNum + 1, 0).getDate()
    const monthIso = `${monthYear}-${String(monthNum + 1).padStart(2, '0')}`
    const monthSnapshots = modelSnapshots.filter(s =>
      s.businessDate.startsWith(monthIso) && s.businessDate <= selectedDate
    )

    const groups = {}
    for (const r of rows) {
      const groupName = getModelGroup(r.creator)
      if (!groups[groupName]) {
        groups[groupName] = {
          modelName: groupName,
          dailyRev: 0, totalRev: 0,
          monthMsgTips: 0, monthTotal: 0,
          variants: []
        }
      }
      groups[groupName].dailyRev += (r.messageRevenue || 0) + (r.tipsRevenue || 0)
      groups[groupName].totalRev += r.revenue || 0
      groups[groupName].variants.push(r.creator)
    }
    for (const snap of monthSnapshots) {
      for (const r of snap.rows) {
        const groupName = getModelGroup(r.creator)
        if (!groups[groupName]) continue
        groups[groupName].monthMsgTips += (r.messageRevenue || 0) + (r.tipsRevenue || 0)
        groups[groupName].monthTotal += r.revenue || 0
      }
    }

    const enriched = Object.values(groups).map(g => {
      const target = targets[g.modelName]
      const dailyRatio = target > 0 ? g.dailyRev / target : null
      const monthlyTarget = target > 0 ? target * daysInMonth : null
      const sollBisHeute = target > 0 ? target * dayOfMonth : null
      const monthRatio = sollBisHeute > 0 ? g.monthMsgTips / sollBisHeute : null
      let status = '—', statusColor = 'var(--text-muted)'
      if (monthRatio !== null) {
        if (monthRatio >= 1.2) { status = 'Über Plan'; statusColor = 'var(--green)' }
        else if (monthRatio >= 1.0) { status = 'Auf Kurs'; statusColor = 'var(--green)' }
        else if (monthRatio >= 0.85) { status = 'Knapp unter Plan'; statusColor = 'var(--yellow)' }
        else if (monthRatio >= 0.6) { status = 'Hinterher'; statusColor = 'var(--orange)' }
        else { status = 'Stark hinterher'; statusColor = 'var(--red)' }
      } else if (g.totalRev < 5) { status = 'Inaktiv' }
      else { status = 'Kein Ziel definiert' }
      return { ...g, target, dailyRatio, monthlyTarget, sollBisHeute, monthRatio, status, statusColor }
    }).sort((a, b) => {
      const aHasTarget = a.target > 0
      const bHasTarget = b.target > 0
      if (aHasTarget && !bHasTarget) return -1
      if (!aHasTarget && bHasTarget) return 1
      return b.totalRev - a.totalRev
    })

    return { groupRows: enriched, dayOfMonth, daysInMonth }
  })()

  // ── Unified Model-Alerts: Monatsfortschritt + Trend-Probleme ──
  // Kritisch: < 40% Monatssoll bei aktiven Models
  // Achtung: 40-60% Monatssoll
  // Achtung: 3-Tage-Abwärtstrend bei aktiven Models (computeModelTrend)
  const modelAlerts = (() => {
    const alerts = []
    for (const g of targetData.groupRows) {
      if (g.totalRev < 5) continue // inaktiv überspringen
      if (g.monthRatio !== null) {
        if (g.monthRatio < 0.4) {
          alerts.push({
            severity: 'critical',
            name: g.modelName,
            headline: `${(g.monthRatio * 100).toFixed(0)}% vom Monatssoll · Aufholbedarf ${formatMoney((g.sollBisHeute || 0) - g.monthMsgTips)}`,
            tag: 'Stark hinterher',
          })
          continue
        } else if (g.monthRatio < 0.6) {
          alerts.push({
            severity: 'warning',
            name: g.modelName,
            headline: `${(g.monthRatio * 100).toFixed(0)}% vom Monatssoll · Aufholbedarf ${formatMoney((g.sollBisHeute || 0) - g.monthMsgTips)}`,
            tag: 'Hinterher',
          })
          continue
        }
      }
      // Trend-basierter Alert (nur wenn nicht schon wegen Monatssoll alarmiert)
      // Wir schauen auf den ersten Variant-Namen für Trend-Berechnung
      const variant = g.variants[0]
      const trend = computeModelTrend(modelSnapshots, variant)
      if (trend === 'Fallend' && (g.totalRev || 0) >= 200) {
        alerts.push({
          severity: 'warning',
          name: g.modelName,
          headline: `Heute Total ${formatMoney(g.totalRev)} · Msg+Tips ${formatMoney(g.dailyRev)}`,
          tag: '3-Tage-Abwärtstrend',
        })
      }
    }
    alerts.sort((a, b) => {
      if (a.severity === b.severity) return 0
      return a.severity === 'critical' ? -1 : 1
    })
    return alerts
  })()

  const modelCriticalCount = modelAlerts.filter(a => a.severity === 'critical').length
  const modelWarningCount = modelAlerts.filter(a => a.severity === 'warning').length

  // Inline Collapsible-Komponente
  const Collapsible = ({ title, defaultOpen = false, children }) => {
    const [open, setOpen] = useState(defaultOpen)
    return (
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
            padding: '12px 16px', cursor: 'pointer', color: 'var(--text-muted)',
            fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontFamily: 'inherit'
          }}
        >
          <span>{title}</span>
          <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{open ? '▼' : '▶'}</span>
        </button>
        {open && <div style={{ padding: '0 16px 16px 16px' }}>{children}</div>}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ═══════════════ OBEN: BÄM-Block — immer sichtbar ═══════════════ */}

      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <KpiCard label="Revenue heute" value={formatMoney(totalRev)} delta={revDelta} accent />
        <KpiCard label="Top Model" value={topModel?.creator || '—'} sub={topModel ? formatMoney(topModel.revenue) : ''} />
        <KpiCard label="Worst Model" value={worstModel?.creator || '—'} sub={worstModel ? formatMoney(worstModel.revenue) : ''} />
        <KpiCard label="Revenue Chatters" value={formatMoney(totalChatterRev)} delta={chatterRevDelta} />
        <KpiCard label="Top Chatter" value={topChatter?.name || '—'} sub={topChatter ? formatMoney(topChatter.revenue) : ''} />
        <KpiCard label="Worst Chatter" value={worstChatter?.name || '—'} sub={worstChatter ? formatMoney(worstChatter.revenue) : ''} />
      </div>

      {/* Aufmerksamkeit-Alert: Models mit Monatssoll-Problem oder Abwärtstrend */}
      <Card title={modelAlerts.length > 0
        ? `🚨 Aufmerksamkeit nötig (${modelAlerts.length})`
        : '✓ Alle Models auf Kurs'}>
        {modelAlerts.length === 0 ? (
          <div style={{ color: 'var(--green)', fontSize: 13, padding: '4px 0' }}>
            Keine Models mit kritischem Monatsrückstand oder Abwärtstrend.
          </div>
        ) : (
          <>
            {(modelCriticalCount > 0 || modelWarningCount > 0) && (
              <div style={{ display: 'flex', gap: 6, fontSize: 11, marginBottom: 10 }}>
                {modelCriticalCount > 0 && (
                  <span style={{ padding: '2px 8px', background: 'rgba(239,68,68,0.12)', color: 'var(--red)', borderRadius: 4, fontWeight: 600 }}>
                    Kritisch {modelCriticalCount}
                  </span>
                )}
                {modelWarningCount > 0 && (
                  <span style={{ padding: '2px 8px', background: 'rgba(245,158,11,0.12)', color: 'var(--yellow)', borderRadius: 4, fontWeight: 600 }}>
                    Achtung {modelWarningCount}
                  </span>
                )}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {modelAlerts.map(a => {
                const isCrit = a.severity === 'critical'
                const bg = isCrit ? 'rgba(239,68,68,0.06)' : 'rgba(245,158,11,0.06)'
                const border = isCrit ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'
                const borderLeft = isCrit ? 'var(--red)' : 'var(--yellow)'
                return (
                  <div key={a.name} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '8px 12px', background: bg,
                    border: `1px solid ${border}`, borderLeft: `3px solid ${borderLeft}`,
                    borderRadius: 6,
                  }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', minWidth: 90 }}>
                      {a.name}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>
                      {a.headline}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                      {a.tag}
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </Card>

      {/* Tagesziele · Monatsfortschritt — Hauptansicht prominent */}
      <Card title="🎯 Tagesziele heute · Monatsfortschritt">
        {targetData.groupRows.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0' }}>Keine Daten für diesen Tag</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  {['Model', 'Heute Msg+Tips', 'Heute Total', 'Tagesziel', 'Heute %', 'Monat Msg+Tips', 'Monat Total', 'Monatsziel', 'Soll bis heute', 'Monat %', 'Status', 'Varianten'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {targetData.groupRows.map((g, i) => {
                  const barWidth = g.monthRatio !== null ? Math.min(g.monthRatio * 100, 150) : 0
                  return (
                    <tr key={g.modelName} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                      <td style={{ ...tdStyle, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{g.modelName}</td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontWeight: 600, color: g.dailyRatio === null ? 'var(--text-muted)' : g.dailyRatio >= 1 ? 'var(--green)' : g.dailyRatio >= 0.7 ? 'var(--yellow)' : 'var(--red)' }}>
                        {formatMoney(g.dailyRev)}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{formatMoney(g.totalRev)}</td>
                      <td style={tdStyle}>
                        {editingTarget === g.modelName ? (
                          <input
                            type="number"
                            value={targetInput}
                            autoFocus
                            onChange={e => setTargetInput(e.target.value)}
                            onBlur={() => saveTarget(g.modelName, targetInput)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveTarget(g.modelName, targetInput)
                              if (e.key === 'Escape') setEditingTarget(null)
                            }}
                            style={{ width: 80, padding: '3px 6px', background: 'var(--bg-input)', border: '1px solid var(--border-bright)', borderRadius: 4, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 12 }}
                          />
                        ) : (
                          <button
                            onClick={() => { setEditingTarget(g.modelName); setTargetInput(g.target || '') }}
                            style={{ background: 'transparent', border: '1px dashed var(--border)', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12, color: g.target ? 'var(--text-primary)' : 'var(--text-muted)', minWidth: 80 }}
                            title="Klicken um Tagesziel zu setzen oder zu ändern"
                          >
                            {g.target ? formatMoney(g.target) : '— setzen'}
                          </button>
                        )}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontWeight: 600, color: g.dailyRatio === null ? 'var(--text-muted)' : g.dailyRatio >= 1 ? 'var(--green)' : g.dailyRatio >= 0.7 ? 'var(--yellow)' : 'var(--red)' }}>
                        {g.dailyRatio !== null ? `${(g.dailyRatio * 100).toFixed(0)}%` : '—'}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatMoney(g.monthMsgTips)}</td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{formatMoney(g.monthTotal)}</td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                        {g.monthlyTarget ? formatMoney(g.monthlyTarget) : '—'}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                        {g.sollBisHeute ? formatMoney(g.sollBisHeute) : '—'}
                      </td>
                      <td style={tdStyle}>
                        {g.monthRatio !== null ? (
                          <div style={{ minWidth: 100 }}>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: g.statusColor, marginBottom: 3 }}>
                              {(g.monthRatio * 100).toFixed(0)}%
                            </div>
                            <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ width: `${Math.min(barWidth, 100)}%`, height: '100%', background: g.statusColor, transition: 'width 0.3s' }} />
                            </div>
                          </div>
                        ) : '—'}
                      </td>
                      <td style={tdStyle}>
                        <span style={{ background: `${g.statusColor}22`, color: g.statusColor, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{g.status}</span>
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: 11 }}>
                        {g.variants.length > 1 ? g.variants.join(' + ') : g.variants[0]}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
              Tagesziel = Soll für Messages + Tips Revenue. Subs zählen nicht (kommen monatlich rein).<br />
              Monatsziel = Tagesziel × {targetData.daysInMonth} Tage. Soll bis heute = Tagesziel × Tag {targetData.dayOfMonth}.<br />
              Status basiert auf Monatsfortschritt vs. Soll bis heute (einzelne schwache Tage werden nicht überbewertet).
            </div>
          </div>
        )}
      </Card>

      {/* ═══════════════ UNTEN: alle kollabierbar ═══════════════ */}

      <Collapsible title="📈 Revenue-Trend & Ranking">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Revenue-Trend</div>
            <RevenueTrendChart allSnapshots={modelSnapshots} allNames={allModelNames} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Revenue-Ranking heute</div>
            <RankingBar items={rankedRows} nameKey="creator" valueKey="revenue" tagKey="monetization"
              subItems={[
                { label: 'Subs', key: 'subsRevenue', color: '#7c3aed' },
                { label: 'Tips', key: 'tipsRevenue', color: '#f59e0b' },
                { label: 'Msg', key: 'messageRevenue', color: '#06b6d4' },
              ]}
            />
          </div>
        </div>
      </Collapsible>

      <Collapsible title="💰 Revenue heute vs. Vortag & Quick Summary">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Revenue heute vs. Vortag</div>
            <DeltaList items={deltaItems} nameKey="creator" />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Quick Summary</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: 'var(--text-muted)' }}>KW {kwNum}</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{formatMoney(kwRevenue)}</span>
              </div>
              <div style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: 'var(--text-muted)' }}>Monat {monthStr?.slice(5)}</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{formatMoney(monthRevenue)}</span>
              </div>
              {[
                ['Subs KW', kwSubs.toFixed(0)],
                ['Subs Monat', monthSubs.toFixed(0)],
                ['Avg Chat KW', formatMoney(kwAvgChat)],
                ['Avg Chat Monat', formatMoney(monthAvgChat)],
                ['PPV Buy Rate', ppvBuyRate.toFixed(1) + '%'],
              ].map(([label, val]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Collapsible>

      <Collapsible title="🔥 Status-Heatmap – letzte Tage">
        <Heatmap snapshots={modelSnapshots} mode="model" topNames={heatmapNames} title="" />
      </Collapsible>

      <Collapsible title="📋 Model-Übersicht heute (Detail-Tabelle)">
        {/* Date switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Tag:</span>
          {[...modelSnapshots].sort((a,b) => b.businessDate.localeCompare(a.businessDate)).slice(0,10).map(s => (
            <button key={s.businessDate} onClick={() => onDateChange(s.businessDate)} style={{
              fontSize: 11, padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
              background: s.businessDate === selectedDate ? 'var(--accent)' : 'transparent',
              border: `1px solid ${s.businessDate === selectedDate ? 'var(--accent)' : 'var(--border)'}`,
              color: s.businessDate === selectedDate ? '#fff' : 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)', fontWeight: 600,
            }}>{s.businessDate.slice(5)}</button>
          ))}
        </div>
        {tableRows.length === 0
          ? <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0' }}>Keine Daten für diesen Tag</div>
          : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  {['Model','Revenue','Δ Rev','7T Rev','Δ Subs','7T Subs','Δ Chats','7T Chats','Δ AvgChat','7T AvgChat','Trend','Status','Empfehlung'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((r, i) => (
                  <tr key={r.creator + i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{r.creator}</td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{formatMoney(r.revenue)}</td>
                    <td style={tdStyle}><span style={deltaStyle(r.revDeltaRow)}>{r.revDeltaRow ? (r.revDeltaRow > 0 ? '+' : '') + r.revDeltaRow.toFixed(1) + '%' : '—'}</span></td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{formatMoney(r.rev7)}</td>
                    <td style={tdStyle}><span style={deltaStyle(r.subsDelta)}>{r.subsDelta ? (r.subsDelta > 0 ? '+' : '') + r.subsDelta : '—'}</span></td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{r.subs7.toFixed(1)}</td>
                    <td style={tdStyle}><span style={deltaStyle(r.chatsDelta)}>{r.chatsDelta ? (r.chatsDelta > 0 ? '+' : '') + r.chatsDelta : '—'}</span></td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{r.chats7.toFixed(1)}</td>
                    <td style={tdStyle}><span style={deltaStyle(r.avgChatDelta)}>{r.avgChatDelta ? (r.avgChatDelta > 0 ? '+' : '') + r.avgChatDelta.toFixed(1) + '%' : '—'}</span></td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{formatMoney(r.avgChat7)}</td>
                    <td style={tdStyle}><span style={{ color: trendColors[r.trend] || 'var(--text-secondary)', fontWeight: 600, fontSize: 11 }}>{r.trend}</span></td>
                    <td style={tdStyle}><span style={{ background: `${statusColors[r.status]}22`, color: statusColors[r.status] || 'var(--text-secondary)', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.status}</span></td>
                    <td style={{ ...tdStyle, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{r.recommendation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Collapsible>
    </div>
  )
}
