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
  const [modelsContact, setModelsContact] = useState([])
  const [editingTarget, setEditingTarget] = useState(null) // creator-name being edited
  const [targetInput, setTargetInput] = useState('')

  useEffect(() => {
    loadModelsContact()
  }, [])

  const loadModelsContact = async () => {
    const { data } = await supabase.from('models_contact').select('id, name, daily_revenue_target')
    setModelsContact(data || [])
  }

  const getModelTarget = (creator) => {
    // Match per Name (case-insensitive, ohne Emoji-Sonderzeichen)
    const normalized = (s) => (s || '').toLowerCase().replace(/[^\w\s]/g, '').trim()
    const target = normalized(creator)
    const m = modelsContact.find(mc => normalized(mc.name) === target)
    return m?.daily_revenue_target || null
  }

  const saveTarget = async (creator, value) => {
    const normalized = (s) => (s || '').toLowerCase().replace(/[^\w\s]/g, '').trim()
    const target = normalized(creator)
    const m = modelsContact.find(mc => normalized(mc.name) === target)
    if (!m) return
    const num = parseFloat(value) || null
    await supabase.from('models_contact').update({ daily_revenue_target: num }).eq('id', m.id)
    setModelsContact(prev => prev.map(x => x.id === m.id ? { ...x, daily_revenue_target: num } : x))
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
    const dailyTarget = getModelTarget(r.creator)
    const dailyRev = (r.messageRevenue || 0) + (r.tipsRevenue || 0)
    const targetRatio = dailyTarget > 0 ? dailyRev / dailyTarget : null
    const { status, recommendation } = computeModelStatus(r, trend, dailyTarget)
    return { ...r, revDeltaRow, subsDelta, chatsDelta, avgChatDelta, rev7, subs7, chats7, avgChat7, trend, status, recommendation, dailyTarget, dailyRev, targetRatio }
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
        <Heatmap snapshots={modelSnapshots} nameKey="creator" topNames={heatmapNames} title="" />
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
                  {['Model','Revenue','Δ Rev','7T Rev','Δ Subs','7T Subs','Δ Chats','7T Chats','Δ AvgChat','7T AvgChat','Trend','Tagesziel','Heute (Msg+Tips)','Status','Empfehlung'].map(h => (
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
                    <td style={tdStyle}>
                      {editingTarget === r.creator ? (
                        <input
                          type="number"
                          value={targetInput}
                          autoFocus
                          onChange={e => setTargetInput(e.target.value)}
                          onBlur={() => saveTarget(r.creator, targetInput)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveTarget(r.creator, targetInput)
                            if (e.key === 'Escape') setEditingTarget(null)
                          }}
                          style={{ width: 70, padding: '3px 6px', background: 'var(--bg-input)', border: '1px solid var(--border-bright)', borderRadius: 4, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 11 }}
                        />
                      ) : (
                        <button
                          onClick={() => { setEditingTarget(r.creator); setTargetInput(r.dailyTarget || '') }}
                          style={{ background: 'transparent', border: '1px dashed var(--border)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, color: r.dailyTarget ? 'var(--text-primary)' : 'var(--text-muted)' }}
                          title="Klicken um Tagesziel zu setzen"
                        >
                          {r.dailyTarget ? formatMoney(r.dailyTarget) : '— setzen'}
                        </button>
                      )}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: r.targetRatio === null ? 'var(--text-muted)' : r.targetRatio >= 1 ? 'var(--green)' : r.targetRatio >= 0.7 ? 'var(--yellow)' : 'var(--red)' }}>
                      {formatMoney(r.dailyRev)}
                      {r.targetRatio !== null && <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.7 }}>{(r.targetRatio * 100).toFixed(0)}%</span>}
                    </td>
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
