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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── KPI ROW ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <KpiCard label="Revenue heute" value={formatMoney(totalRev)} delta={revDelta} accent />
        <KpiCard label="Top Model" value={topModel?.creator || '—'} sub={topModel ? formatMoney(topModel.revenue) : ''} />
        <KpiCard label="Worst Model" value={worstModel?.creator || '—'} sub={worstModel ? formatMoney(worstModel.revenue) : ''} />
        <KpiCard label="Revenue Chatters" value={formatMoney(totalChatterRev)} delta={chatterRevDelta} />
        <KpiCard label="Top Chatter" value={topChatter?.name || '—'} sub={topChatter ? formatMoney(topChatter.revenue) : ''} />
        <KpiCard label="Worst Chatter" value={worstChatter?.name || '—'} sub={worstChatter ? formatMoney(worstChatter.revenue) : ''} />
      </div>

      {/* ── Falling Alert ── */}
      <Card title="⚠ Trend-Alerts – Models">
        <FallingAlert snapshots={modelSnapshots} nameKey="creator" label="Models" />
      </Card>

      {/* ── ROW 2: Trend + Ranking ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        <Card title="Revenue-Trend – Models">
          <RevenueTrendChart allSnapshots={modelSnapshots} allNames={allModelNames} />
        </Card>
        <Card title="Revenue-Ranking heute">
          <RankingBar items={rankedRows} nameKey="creator" valueKey="revenue" tagKey="monetization"
            subItems={[
              { label: 'Subs', key: 'subsRevenue', color: '#7c3aed' },
              { label: 'Tips', key: 'tipsRevenue', color: '#f59e0b' },
              { label: 'Msg', key: 'messageRevenue', color: '#06b6d4' },
            ]}
          />
        </Card>
      </div>

      {/* ── ROW 3: Delta + Quick Summary ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
        <Card title="Revenue heute vs. Vortag">
          <DeltaList items={deltaItems} nameKey="creator" />
        </Card>
        <Card title="Quick Summary">
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
        </Card>
      </div>

      {/* ── Heatmap ── */}
      <Card title="Status-Heatmap – letzte Tage">
        <Heatmap snapshots={modelSnapshots} mode="model" topNames={heatmapNames} title="" />
      </Card>

      {/* ── Tagesziel-Übersicht (gruppiert nach echtem Model) ── */}
      <Card title="🎯 Tagesziele heute · Monatsfortschritt">
        {(() => {
          // Aktueller Monat des selectedDate
          const selDateObj = new Date(selectedDate + 'T12:00:00')
          const monthYear = selDateObj.getFullYear()
          const monthNum = selDateObj.getMonth() // 0-indexed
          const dayOfMonth = selDateObj.getDate()
          const daysInMonth = new Date(monthYear, monthNum + 1, 0).getDate()
          const monthIso = `${monthYear}-${String(monthNum + 1).padStart(2, '0')}`

          // Alle Snapshots dieses Monats bis einschließlich selectedDate
          const monthSnapshots = modelSnapshots.filter(s =>
            s.businessDate.startsWith(monthIso) && s.businessDate <= selectedDate
          )

          // Gruppieren nach model_name (aus model_aliases) für heute
          const groups = {}
          for (const r of rows) {
            const groupName = getModelGroup(r.creator)
            if (!groups[groupName]) {
              groups[groupName] = {
                modelName: groupName,
                dailyRev: 0, // heute Msg+Tips
                totalRev: 0, // heute Total
                monthMsgTips: 0, // Monat kumuliert Msg+Tips
                monthTotal: 0, // Monat kumuliert Total
                variants: []
              }
            }
            groups[groupName].dailyRev += (r.messageRevenue || 0) + (r.tipsRevenue || 0)
            groups[groupName].totalRev += r.revenue || 0
            groups[groupName].variants.push(r.creator)
          }

          // Monats-Werte aufaddieren
          for (const snap of monthSnapshots) {
            for (const r of snap.rows) {
              const groupName = getModelGroup(r.creator)
              if (!groups[groupName]) continue // Nur Models die heute auch da sind
              groups[groupName].monthMsgTips += (r.messageRevenue || 0) + (r.tipsRevenue || 0)
              groups[groupName].monthTotal += r.revenue || 0
            }
          }

          const groupRows = Object.values(groups).sort((a, b) => {
            const aHasTarget = targets[a.modelName] > 0
            const bHasTarget = targets[b.modelName] > 0
            if (aHasTarget && !bHasTarget) return -1
            if (!aHasTarget && bHasTarget) return 1
            return b.totalRev - a.totalRev
          })

          if (groupRows.length === 0) {
            return <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0' }}>Keine Daten für diesen Tag</div>
          }

          return (
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
                  {groupRows.map((g, i) => {
                    const target = targets[g.modelName]
                    const dailyRatio = target > 0 ? g.dailyRev / target : null
                    const monthlyTarget = target > 0 ? target * daysInMonth : null
                    const sollBisHeute = target > 0 ? target * dayOfMonth : null
                    const monthRatio = sollBisHeute > 0 ? g.monthMsgTips / sollBisHeute : null

                    let status = '—'
                    let statusColor = 'var(--text-muted)'
                    // Status basiert auf MONATs-Fortschritt (Soll bis heute), nicht nur Tag
                    // Damit ein einzelner schwacher Tag nicht alarmierend wirkt
                    if (monthRatio !== null) {
                      if (monthRatio >= 1.2) { status = 'Über Plan'; statusColor = 'var(--green)' }
                      else if (monthRatio >= 1.0) { status = 'Auf Kurs'; statusColor = 'var(--green)' }
                      else if (monthRatio >= 0.85) { status = 'Knapp unter Plan'; statusColor = 'var(--yellow)' }
                      else if (monthRatio >= 0.6) { status = 'Hinterher'; statusColor = 'var(--orange)' }
                      else { status = 'Stark hinterher'; statusColor = 'var(--red)' }
                    } else if (g.totalRev < 5) {
                      status = 'Inaktiv'
                    } else {
                      status = 'Kein Ziel definiert'
                    }

                    // Progress-Bar Style für Monat-%
                    const barWidth = monthRatio !== null ? Math.min(monthRatio * 100, 150) : 0

                    return (
                      <tr key={g.modelName} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                        <td style={{ ...tdStyle, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{g.modelName}</td>
                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontWeight: 600, color: dailyRatio === null ? 'var(--text-muted)' : dailyRatio >= 1 ? 'var(--green)' : dailyRatio >= 0.7 ? 'var(--yellow)' : 'var(--red)' }}>
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
                              onClick={() => { setEditingTarget(g.modelName); setTargetInput(target || '') }}
                              style={{ background: 'transparent', border: '1px dashed var(--border)', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12, color: target ? 'var(--text-primary)' : 'var(--text-muted)', minWidth: 80 }}
                              title="Klicken um Tagesziel zu setzen oder zu ändern"
                            >
                              {target ? formatMoney(target) : '— setzen'}
                            </button>
                          )}
                        </td>
                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontWeight: 600, color: dailyRatio === null ? 'var(--text-muted)' : dailyRatio >= 1 ? 'var(--green)' : dailyRatio >= 0.7 ? 'var(--yellow)' : 'var(--red)' }}>
                          {dailyRatio !== null ? `${(dailyRatio * 100).toFixed(0)}%` : '—'}
                        </td>
                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatMoney(g.monthMsgTips)}</td>
                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{formatMoney(g.monthTotal)}</td>
                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                          {monthlyTarget ? formatMoney(monthlyTarget) : '—'}
                        </td>
                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                          {sollBisHeute ? formatMoney(sollBisHeute) : '—'}
                        </td>
                        <td style={tdStyle}>
                          {monthRatio !== null ? (
                            <div style={{ minWidth: 100 }}>
                              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: statusColor, marginBottom: 3 }}>
                                {(monthRatio * 100).toFixed(0)}%
                              </div>
                              <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                                <div style={{ width: `${Math.min(barWidth, 100)}%`, height: '100%', background: statusColor, transition: 'width 0.3s' }} />
                              </div>
                            </div>
                          ) : '—'}
                        </td>
                        <td style={tdStyle}>
                          <span style={{ background: `${statusColor}22`, color: statusColor, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{status}</span>
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
                Monatsziel = Tagesziel × {daysInMonth} Tage im Monat. Soll bis heute = Tagesziel × Tag {dayOfMonth}.<br />
                Status basiert auf Monatsfortschritt vs. Soll bis heute (einzelne schwache Tage werden nicht überbewertet).
              </div>
            </div>
          )
        })()}
      </Card>

      {/* ── Big Table ── */}
      <Card title="Model-Übersicht heute">
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
      </Card>
    </div>
  )
}
