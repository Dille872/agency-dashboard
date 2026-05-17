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

// ============================================================
// v3.7.0: Account Health Scores für Models
// Erkennt nachhaltige Accounts vs. instabile Whale-Abhängigkeit
// Basis: model_snapshots.rows mit revenue, subs, avgSpend,
//        sellingChats, avgChatValue, newSubsRevenue, recurringSubsRevenue
// Chatter Dependency: aus shift_logs.model_names
// ============================================================

function colorFromScore(score) {
  if (score === null || score === undefined) return 'gray'
  if (score >= 75) return 'green'
  if (score >= 55) return 'yellow'
  return 'red'
}

function modelScoreColor(color) {
  switch (color) {
    case 'green': return 'var(--green)'
    case 'yellow': return 'var(--yellow)'
    case 'red': return 'var(--red)'
    default: return 'var(--text-muted)'
  }
}
function modelScoreBg(color) {
  switch (color) {
    case 'green': return 'rgba(16,185,129,0.12)'
    case 'yellow': return 'rgba(245,158,11,0.12)'
    case 'red': return 'rgba(239,68,68,0.12)'
    default: return 'rgba(255,255,255,0.03)'
  }
}

// Hole letzte N Tage Snapshots eines Models (mind. revenue>0)
function getActiveDaysForModel(snapshots, creatorName, selectedDate, days = 14) {
  const sortedDesc = [...snapshots].sort((a, b) => b.businessDate.localeCompare(a.businessDate))
  const cutoffIdx = sortedDesc.findIndex(s => s.businessDate === selectedDate)
  if (cutoffIdx === -1) return []
  const window = sortedDesc.slice(cutoffIdx, cutoffIdx + days)
  return window
    .map(s => s.rows.find(rr => rr.creator === creatorName))
    .filter(r => r && (r.revenue || 0) > 0)
}

// Revenue Stability: <25% grün, 25-50% gelb, >50% rot
function computeRevenueStability(rows) {
  if (rows.length < 3) return { score: null, color: 'gray', cv: null }
  const revs = rows.map(r => r.revenue || 0)
  const avg = revs.reduce((s, v) => s + v, 0) / revs.length
  if (avg === 0) return { score: 0, color: 'red', cv: null }
  const variance = revs.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / revs.length
  const std = Math.sqrt(variance)
  const cv = std / avg
  let score, color
  if (cv < 0.25) { score = 100 - (cv / 0.25) * 30; color = 'green' }
  else if (cv < 0.50) { score = 70 - ((cv - 0.25) / 0.25) * 30; color = 'yellow' }
  else { score = Math.max(0, 40 - (cv - 0.50) * 50); color = 'red' }
  return { score: Math.round(score), color, cv: parseFloat(cv.toFixed(2)) }
}

// Whale Dependency: hoher avgChatValue + wenige sellingChats = HIGH
function computeWhaleRisk(rows) {
  if (rows.length === 0) return { score: null, color: 'gray', avgChatValue: null, avgSellingChats: null, level: null }
  const avgChatValue = rows.reduce((s, r) => s + (r.avgChatValue || 0), 0) / rows.length
  const avgSellingChats = rows.reduce((s, r) => s + (r.sellingChats || 0), 0) / rows.length
  let level, color, score
  if (avgChatValue > 150 && avgSellingChats < 5) { level = 'HIGH'; color = 'red'; score = 25 }
  else if (avgChatValue > 100 && avgSellingChats < 8) { level = 'HIGH'; color = 'red'; score = 35 }
  else if (avgChatValue > 80) { level = 'MEDIUM'; color = 'yellow'; score = 55 }
  else if (avgChatValue > 50) { level = 'MEDIUM'; color = 'yellow'; score = 70 }
  else { level = 'LOW'; color = 'green'; score = 92 }
  return { score, color, level, avgChatValue: parseFloat(avgChatValue.toFixed(1)), avgSellingChats: parseFloat(avgSellingChats.toFixed(1)) }
}

// Fan Quality: Stabilität der Käuferbasis (sellingChats) + Subscription-Mix (recurring/new)
function computeFanQuality(rows) {
  if (rows.length < 3) return { score: null, color: 'gray', avgChats: null, chatsCv: null, recurringRatio: null }
  const sellingChats = rows.map(r => r.sellingChats || 0)
  const avgChats = sellingChats.reduce((s, v) => s + v, 0) / sellingChats.length
  if (avgChats === 0) return { score: 0, color: 'red', avgChats: 0, chatsCv: null, recurringRatio: null }
  const chatsVar = sellingChats.reduce((s, v) => s + Math.pow(v - avgChats, 2), 0) / sellingChats.length
  const chatsCv = Math.sqrt(chatsVar) / avgChats

  // Recurring/New Subs Ratio
  const totalRecurring = rows.reduce((s, r) => s + (r.recurringSubsRevenue || 0), 0)
  const totalNew = rows.reduce((s, r) => s + (r.newSubsRevenue || 0), 0)
  const totalSubsRev = totalRecurring + totalNew
  const recurringRatio = totalSubsRev > 0 ? totalRecurring / totalSubsRev : null

  // Score-Berechnung: 60% Käufer-Stabilität, 40% Recurring-Ratio
  let stabScore
  if (chatsCv < 0.30) stabScore = 100 - (chatsCv / 0.30) * 30
  else if (chatsCv < 0.60) stabScore = 70 - ((chatsCv - 0.30) / 0.30) * 30
  else stabScore = Math.max(0, 40 - (chatsCv - 0.60) * 50)

  let recScore = 50
  if (recurringRatio !== null) {
    // >50% recurring = grün, 30-50% gelb, <30% rot
    if (recurringRatio > 0.50) recScore = 100
    else if (recurringRatio > 0.30) recScore = 70
    else recScore = 40
  }

  // Bonus für breite Käuferbasis (Anzahl)
  const breadthBonus = Math.min(20, avgChats * 1.5)
  let combined = stabScore * 0.60 + recScore * 0.40 + breadthBonus * 0.1
  combined = Math.min(100, Math.max(0, combined))

  return {
    score: Math.round(combined),
    color: colorFromScore(Math.round(combined)),
    avgChats: parseFloat(avgChats.toFixed(1)),
    chatsCv: parseFloat(chatsCv.toFixed(2)),
    recurringRatio: recurringRatio !== null ? parseFloat(recurringRatio.toFixed(2)) : null,
  }
}

// Chatter Dependency: aus shift_logs.model_names
// Nimmt das vorgeladene chatterShifts-Mapping und berechnet pro Model
// shiftCountsPerChatter: { 'Chris': 5, 'Rey': 3, ... } für dieses Model
function computeChatterDependency(shiftCountsPerChatter) {
  if (!shiftCountsPerChatter || Object.keys(shiftCountsPerChatter).length === 0) {
    return { score: null, color: 'gray', topChatter: null, topPct: null, chatterCount: 0 }
  }
  const total = Object.values(shiftCountsPerChatter).reduce((s, v) => s + v, 0)
  if (total === 0) return { score: null, color: 'gray', topChatter: null, topPct: null, chatterCount: 0 }
  const entries = Object.entries(shiftCountsPerChatter).sort((a, b) => b[1] - a[1])
  const [topChatter, topCount] = entries[0]
  const topPct = topCount / total
  let score, color
  if (topPct < 0.40) { score = 95; color = 'green' }
  else if (topPct < 0.60) { score = 65; color = 'yellow' }
  else { score = Math.max(20, 50 - (topPct - 0.60) * 50); color = 'red' }
  return {
    score: Math.round(score),
    color,
    topChatter,
    topPct: parseFloat((topPct * 100).toFixed(0)),
    chatterCount: entries.length,
  }
}

// Funnel Efficiency: VIP/MAIN Revenue / (FREE + VIP/MAIN) Revenue
// Erwartet { freeRev, vipRev } pro Model-Gruppe
function computeFunnelEfficiency(freeRev, vipRev) {
  if (freeRev === null || vipRev === null) return { score: null, color: 'gray', pct: null }
  const total = freeRev + vipRev
  if (total === 0) return { score: 0, color: 'red', pct: 0 }
  const pct = vipRev / total
  // >60% VIP = grün, 40-60% gelb, <40% rot (FREE generiert zu wenig Conversion-Revenue)
  let score, color
  if (pct > 0.60) { score = 90; color = 'green' }
  else if (pct > 0.40) { score = 65; color = 'yellow' }
  else { score = Math.max(20, pct * 100); color = 'red' }
  return { score: Math.round(score), color, pct: parseFloat((pct * 100).toFixed(0)) }
}

// Sustainability Score (Master für Models): 5 Sub-Scores, je 20%
function computeModelSustainability(stability, fanQuality, whale, chatter, recurringRatio) {
  const subs = [
    { val: stability.score, w: 0.20 },
    { val: fanQuality.score, w: 0.20 },
    { val: whale.score, w: 0.20 },
    { val: chatter.score, w: 0.20 },
  ].filter(s => s.val !== null)
  // Recurring-Subs-Score zusätzlich
  let recScore = null
  if (recurringRatio !== null) {
    if (recurringRatio > 0.50) recScore = 100
    else if (recurringRatio > 0.30) recScore = 65
    else recScore = 40
    subs.push({ val: recScore, w: 0.20 })
  }
  if (subs.length === 0) return { score: null, color: 'gray' }
  const totalW = subs.reduce((s, x) => s + x.w, 0)
  const weighted = subs.reduce((s, x) => s + x.val * x.w, 0) / totalW
  const score = Math.round(weighted)
  return { score, color: colorFromScore(score) }
}

// Master: berechne komplette Model-Health
function computeModelHealth(modelSnapshots, creatorName, selectedDate, chatterShiftCounts) {
  const rows = getActiveDaysForModel(modelSnapshots, creatorName, selectedDate, 14)
  const hasEnoughData = rows.length >= 5

  if (!hasEnoughData) {
    return {
      hasEnoughData: false,
      activeDays: rows.length,
      stability: { score: null, color: 'gray' },
      sustainability: { score: null, color: 'gray' },
      whale: { score: null, color: 'gray' },
      chatterDep: { score: null, color: 'gray' },
      fanQuality: { score: null, color: 'gray' },
      accountHealth: { score: null, color: 'gray' },
      warnings: [],
    }
  }

  const stability = computeRevenueStability(rows)
  const whale = computeWhaleRisk(rows)
  const fanQuality = computeFanQuality(rows)
  const chatterDep = computeChatterDependency(chatterShiftCounts)
  const sustainability = computeModelSustainability(stability, fanQuality, whale, chatterDep, fanQuality.recurringRatio)

  // Account Health = Durchschnitt aller verfügbaren Sub-Scores
  const allScores = [stability.score, sustainability.score, fanQuality.score, whale.score, chatterDep.score]
    .filter(s => s !== null)
  const accountHealthScore = allScores.length > 0
    ? Math.round(allScores.reduce((s, v) => s + v, 0) / allScores.length)
    : null
  const accountHealth = {
    score: accountHealthScore,
    color: colorFromScore(accountHealthScore),
  }

  // Warnungen ableiten
  const warnings = []

  // 1. Possible Fan Burnout: messageRevenue steigt stark, aber sellingChats fällt
  if (rows.length >= 8) {
    const recent = rows.slice(0, Math.floor(rows.length / 2))
    const older = rows.slice(Math.floor(rows.length / 2))
    const recentMsgRev = recent.reduce((s, r) => s + (r.messageRevenue || 0), 0) / recent.length
    const olderMsgRev = older.reduce((s, r) => s + (r.messageRevenue || 0), 0) / older.length
    const recentChats = recent.reduce((s, r) => s + (r.sellingChats || 0), 0) / recent.length
    const olderChats = older.reduce((s, r) => s + (r.sellingChats || 0), 0) / older.length
    if (recentMsgRev > olderMsgRev * 1.3 && recentChats < olderChats * 0.85) {
      warnings.push({ type: 'fan_burnout', severity: 'critical', label: 'Fan-Burnout' })
    }
  }

  // 2. Whale Dependency Risk
  if (whale.level === 'HIGH') {
    warnings.push({ type: 'whale_risk', severity: 'critical', label: 'Whale-Abhängigkeit' })
  }

  // 3. High Chatter Dependency
  if (chatterDep.topPct !== null && chatterDep.topPct > 60) {
    warnings.push({ type: 'chatter_dep', severity: 'warning', label: 'Chatter-Abhängigkeit' })
  }

  // 4. Unstable Revenue
  if (stability.cv !== null && stability.cv > 0.50) {
    warnings.push({ type: 'unstable_rev', severity: 'warning', label: 'Instabile Revenue' })
  }

  // 5. Declining Fan Quality
  if (fanQuality.score !== null && fanQuality.score < 55) {
    warnings.push({ type: 'fan_quality', severity: 'warning', label: 'Schwache Fan-Qualität' })
  }

  // 6. Healthy Long-Term Account
  if (sustainability.score !== null && sustainability.score >= 75
      && stability.color === 'green' && fanQuality.color === 'green'
      && whale.color !== 'red') {
    warnings.push({ type: 'healthy', severity: 'positive', label: 'Gesunder Long-Term Account' })
  }

  return {
    hasEnoughData: true,
    activeDays: rows.length,
    stability,
    sustainability,
    whale,
    chatterDep,
    fanQuality,
    accountHealth,
    warnings,
  }
}


export default function ModelsView({ selectedDate, modelSnapshots, chatterSnapshots, onDateChange }) {
  const [aliases, setAliases] = useState([])
  const [targets, setTargets] = useState({}) // { model_name: daily_target }
  const [editingTarget, setEditingTarget] = useState(null)
  const [targetInput, setTargetInput] = useState('')
  // v3.7.0: shift_logs für Chatter Dependency + State für Health-Detail-Aufklappen
  const [shiftLogs, setShiftLogs] = useState([])
  const [expandedHealth, setExpandedHealth] = useState(null)

  useEffect(() => {
    loadAliasesAndTargets()
    loadRecentShiftLogs()
  }, [])

  // v3.7.0: 14 Tage shift_logs laden für Chatter-Dependency-Analyse
  // model_names ist text mit komma-getrennten Model-Namen (csv_name)
  const loadRecentShiftLogs = async () => {
    const fourteenDaysAgo = new Date()
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)
    const { data, error } = await supabase
      .from('shift_logs')
      .select('display_name, model_names, checked_in_at')
      .gte('checked_in_at', fourteenDaysAgo.toISOString())
    if (error) { console.warn('shift_logs load fail:', error.message); return }
    setShiftLogs(data || [])
  }

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

  // ── v3.7.0: Chatter-Shift-Counts pro Model aus shift_logs ──────────────────
  // Pro Model (csv_name) zählen wie viele Schichten welcher Chatter gemacht hat
  // Da model_names komma-separiert ist, splittet ein Eintrag in mehrere Models
  const chatterShiftCountsByModel = (() => {
    const map = {} // { creatorName: { 'Chris': 5, 'Rey': 3 } }
    for (const log of shiftLogs) {
      if (!log.model_names || !log.display_name) continue
      const models = log.model_names.split(',').map(s => s.trim()).filter(Boolean)
      const chatter = log.display_name.trim()
      for (const m of models) {
        if (!map[m]) map[m] = {}
        map[m][chatter] = (map[m][chatter] || 0) + 1
      }
    }
    return map
  })()

  // ── v3.7.0: Funnel-Pairs aus model_aliases ────────────────────────────────
  // { model_name (group): { FREE: csv_name, VIP: csv_name, MAIN: csv_name } }
  const funnelPairs = (() => {
    const groups = {}
    for (const a of aliases) {
      if (!a.model_name) continue
      if (!groups[a.model_name]) groups[a.model_name] = {}
      groups[a.model_name][a.alias_label || 'MAIN'] = a.csv_name
    }
    return groups
  })()

  // Helper: für ein creator (csv_name) das Funnel-Score-Objekt (oder null wenn Solo)
  const computeModelFunnelForCreator = (creator) => {
    // Finde welche group dieser creator gehört
    const aliasEntry = aliases.find(a => a.csv_name === creator)
    if (!aliasEntry) return null
    const group = funnelPairs[aliasEntry.model_name]
    if (!group) return null
    const freeName = group.FREE
    const vipName = group.VIP || group.MAIN // VIP bevorzugt, sonst MAIN
    // Nur Pair wenn beide vorhanden und unterschiedlich
    if (!freeName || !vipName || freeName === vipName) return null
    // Revenue beider Accounts über letzte 14 Tage summieren
    const freeRev14 = getActiveDaysForModel(modelSnapshots, freeName, selectedDate, 14)
      .reduce((s, r) => s + (r.revenue || 0), 0)
    const vipRev14 = getActiveDaysForModel(modelSnapshots, vipName, selectedDate, 14)
      .reduce((s, r) => s + (r.revenue || 0), 0)
    const funnel = computeFunnelEfficiency(freeRev14, vipRev14)
    funnel.freeName = freeName
    funnel.vipName = vipName
    funnel.freeRev = freeRev14
    funnel.vipRev = vipRev14
    funnel.isCurrentFree = (creator === freeName)
    return funnel
  }

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
    // v3.7.0: Health Scores
    const health = computeModelHealth(modelSnapshots, r.creator, selectedDate, chatterShiftCountsByModel[r.creator])
    const funnel = computeModelFunnelForCreator(r.creator)
    return { ...r, revDeltaRow, subsDelta, chatsDelta, avgChatDelta, rev7, subs7, chats7, avgChat7, trend, status, recommendation, health, funnel }
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
            group: 'target',
            explain: 'Model liegt unter 40% des Monatssolls (Soll bis heute / aktueller Stand).',
          })
          continue
        } else if (g.monthRatio < 0.6) {
          alerts.push({
            severity: 'warning',
            name: g.modelName,
            headline: `${(g.monthRatio * 100).toFixed(0)}% vom Monatssoll · Aufholbedarf ${formatMoney((g.sollBisHeute || 0) - g.monthMsgTips)}`,
            tag: 'Hinterher',
            group: 'target',
            explain: 'Model liegt unter 60% des Monatssolls — Aufholbedarf bis Monatsende.',
          })
          continue
        }
      }
      // Trend-basierter Alert (nur wenn nicht schon wegen Monatssoll alarmiert)
      const variant = g.variants[0]
      const trend = computeModelTrend(modelSnapshots, variant)
      if (trend === 'Fallend' && (g.totalRev || 0) >= 200) {
        alerts.push({
          severity: 'warning',
          name: g.modelName,
          headline: `Heute Total ${formatMoney(g.totalRev)} · Msg+Tips ${formatMoney(g.dailyRev)}`,
          tag: '3-Tage-Abwärtstrend',
          group: 'trend',
          explain: 'Revenue über die letzten 3 Tage rückläufig (bei mindestens $200 Tagesumsatz).',
        })
      }
    }

    // v3.7.0: Health-basierte Alerts pro creator (csv-Name) — nicht pro Group
    for (const r of tableRows) {
      if (!r.health.hasEnoughData) continue
      for (const w of r.health.warnings) {
        let group = 'stability', headline = '', explain = ''
        // v3.14.0: severityScore für Sortierung innerhalb der Gruppe (höher = kritischer)
        let severityScore = 0
        if (w.type === 'fan_burnout') {
          group = 'critical_health'
          explain = 'Message Revenue steigt stark, aber Käuferbasis schrumpft. Hinweis dass Fans genervt sind und weniger kaufen.'
          headline = `Message-Revenue steigt, Käuferzahl sinkt`
          severityScore = 1000 // Fan-Burnout = höchste Priorität in critical_health
        } else if (w.type === 'whale_risk') {
          group = 'critical_health'
          explain = 'Sehr hoher Avg Chat Value bei wenigen Käufen. Account ist von wenigen Whales abhängig — Risiko wenn ein Whale weg ist.'
          headline = `Ø $${r.health.whale.avgChatValue}/Chat · ${r.health.whale.avgSellingChats} Käufer/Tag`
          severityScore = r.health.whale.avgChatValue || 0 // höher = kritischer
        } else if (w.type === 'chatter_dep') {
          group = 'dependency'
          explain = 'Ein einzelner Chatter macht über 60% der Schichten für diesen Account. Risiko bei Ausfall/Wechsel.'
          headline = `${r.health.chatterDep.topChatter}: ${r.health.chatterDep.topPct}% aller Schichten`
          severityScore = r.health.chatterDep.topPct || 0 // höher % = kritischer
        } else if (w.type === 'unstable_rev') {
          group = 'stability'
          explain = 'Tagesrevenue schwankt stark (Standardabweichung > 50% vom Durchschnitt).'
          headline = `Schwankung ${(r.health.stability.cv * 100).toFixed(0)}% (Std/Avg)`
          severityScore = (r.health.stability.cv || 0) * 100 // höhere Schwankung = kritischer
        } else if (w.type === 'fan_quality') {
          group = 'fan_quality'
          explain = 'Käuferbasis schrumpft oder zu wenige Stammkäufer. Recurring/New-Ratio + sellingChats deuten auf schwache Fan-Bindung.'
          headline = `${r.health.fanQuality.avgChats} Käufer/Tag · Recurring ${r.health.fanQuality.recurringRatio !== null ? (r.health.fanQuality.recurringRatio * 100).toFixed(0) + '%' : '—'}`
          // Niedrigere Fan-Quality-Score = kritischer. Da Score 0-100, invertieren: 100 - score
          severityScore = 100 - (r.health.fanQuality.score || 0)
        } else if (w.type === 'healthy') {
          group = 'positive'
          explain = 'Stabile Revenue, gesunde Fan-Qualität, keine Whale-Abhängigkeit. Vorbild-Account.'
          headline = `Sustainability ${r.health.sustainability.score} · stabil über ${r.health.activeDays} Tage`
          severityScore = r.health.sustainability.score || 0
        }
        if (alerts.find(a => a.name === r.creator && a.tag === w.label)) continue
        alerts.push({
          severity: w.severity,
          name: r.creator,
          headline,
          tag: w.label,
          group,
          explain,
          severityScore,
        })
      }
    }

    alerts.sort((a, b) => {
      if (a.severity === 'positive' && b.severity !== 'positive') return 1
      if (b.severity === 'positive' && a.severity !== 'positive') return -1
      if (a.severity === b.severity) return 0
      return a.severity === 'critical' ? -1 : 1
    })
    return alerts
  })()

  const modelCriticalCount = modelAlerts.filter(a => a.severity === 'critical').length
  const modelWarningCount = modelAlerts.filter(a => a.severity === 'warning').length
  const modelProblemCount = modelCriticalCount + modelWarningCount

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ═══════════════ OBEN: BÄM-Block — immer sichtbar ═══════════════ */}

      {/* v3.9.0: KPI Row Redesigned — Revenue gross mit Sparkline links + 5 kleine Karten rechts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1.2fr) 2fr', gap: 12 }} className="kpi-redesigned">
        {/* Hero Card: Revenue heute + Sparkline */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(124,58,237,0.12), rgba(124,58,237,0.04))',
          border: '1px solid rgba(124,58,237,0.3)',
          borderRadius: 10, padding: '14px 16px',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          minHeight: 110,
        }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Revenue heute</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 6 }}>
              <span style={{ fontSize: 26, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                {formatMoney(totalRev)}
              </span>
              {revDelta !== null && revDelta !== 0 && (
                <span style={{ fontSize: 12, fontWeight: 700, color: revDelta > 0 ? 'var(--green)' : 'var(--red)' }}>
                  {revDelta > 0 ? '▲' : '▼'} {Math.abs(revDelta).toFixed(1)}%
                </span>
              )}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>vs. Vortag</div>
          </div>
          {/* Sparkline der letzten 7 Tage */}
          {(() => {
            const dailyTotals = last7.map(s => (s.rows || []).reduce((sum, r) => sum + (r.revenue || 0), 0))
            if (dailyTotals.length < 2) return null
            const max = Math.max(...dailyTotals, 1)
            const min = Math.min(...dailyTotals)
            const range = max - min || 1
            const points = dailyTotals.map((v, i) => {
              const x = (i / (dailyTotals.length - 1)) * 100
              const y = 100 - ((v - min) / range) * 80 - 10
              return `${x},${y}`
            }).join(' ')
            return (
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: 32, marginTop: 6 }}>
                <polyline points={points} fill="none" stroke="rgba(124,58,237,0.8)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points={`0,100 ${points} 100,100`} fill="rgba(124,58,237,0.12)" stroke="none" />
              </svg>
            )
          })()}
        </div>

        {/* 5 KPI Cards in 2x3 Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          <MiniKpi label="Top Model" value={topModel?.creator || '—'} sub={topModel ? formatMoney(topModel.revenue) : ''} color="#10b981" />
          <MiniKpi label="Worst Model" value={worstModel?.creator || '—'} sub={worstModel ? formatMoney(worstModel.revenue) : ''} color="#ef4444" />
          <MiniKpi label="Revenue Chatters" value={formatMoney(totalChatterRev)} sub={chatterRevDelta !== null && chatterRevDelta !== 0 ? `${chatterRevDelta > 0 ? '+' : ''}${chatterRevDelta.toFixed(1)}% vs. Vortag` : 'vs. Vortag'} subColor={chatterRevDelta > 0 ? 'var(--green)' : chatterRevDelta < 0 ? 'var(--red)' : 'var(--text-muted)'} />
          <MiniKpi label="Top Chatter" value={topChatter?.name || '—'} sub={topChatter ? formatMoney(topChatter.revenue) : ''} color="#06b6d4" />
          <MiniKpi label="Worst Chatter" value={worstChatter?.name || '—'} sub={worstChatter ? formatMoney(worstChatter.revenue) : ''} color="#f59e0b" />
        </div>
      </div>

      {/* v3.7.0: Aufmerksamkeit-Alert gruppiert mit Tooltips */}
      <Card title={modelProblemCount > 0
        ? `🚨 Aufmerksamkeit nötig (${modelProblemCount})`
        : '✓ Alle Models auf Kurs'}>
        {modelProblemCount === 0 ? (
          <div style={{ color: 'var(--green)', fontSize: 13, padding: '4px 0' }}>
            Keine Models mit kritischem Monatsrückstand, Abwärtstrend oder Health-Issues.
          </div>
        ) : (
          <>
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
            {(() => {
              const groupConfig = [
                { key: 'target', label: '🎯 Monatsziel-Risiko', color: 'var(--red)', bg: 'rgba(239,68,68,0.06)', defaultOpen: true,
                  desc: 'Models die deutlich unter ihrem Monatssoll liegen — Aufholbedarf vor Monatsende.' },
                { key: 'critical_health', label: '🚨 Kritisch (Health)', color: 'var(--red)', bg: 'rgba(239,68,68,0.06)', defaultOpen: true,
                  desc: 'Fan-Burnout oder hohe Whale-Abhängigkeit — Account-Gesundheit gefährdet.' },
                { key: 'trend', label: '📉 Abwärtstrend', color: 'var(--yellow)', bg: 'rgba(245,158,11,0.06)', defaultOpen: false,
                  desc: 'Revenue über 3 Tage rückläufig.' },
                { key: 'dependency', label: '👤 Chatter-Abhängigkeit', color: 'var(--yellow)', bg: 'rgba(245,158,11,0.06)', defaultOpen: false,
                  desc: 'Ein einzelner Chatter macht überproportional viele Schichten — Risiko bei Ausfall.' },
                { key: 'stability', label: '🌊 Instabile Revenue', color: 'var(--yellow)', bg: 'rgba(245,158,11,0.06)', defaultOpen: false,
                  desc: 'Tagesrevenue schwankt stark — keine konstante Performance.' },
                { key: 'fan_quality', label: '👥 Schwache Fan-Qualität', color: 'var(--yellow)', bg: 'rgba(245,158,11,0.06)', defaultOpen: false,
                  desc: 'Käuferbasis schrumpft oder zu wenige Stammkäufer.' },
              ]
              const byGroup = {}
              for (const a of modelAlerts) {
                if (a.severity === 'positive') continue
                const g = a.group || 'stability'
                if (!byGroup[g]) byGroup[g] = []
                byGroup[g].push(a)
              }
              // v3.14.0: Innerhalb jeder Gruppe nach severityScore sortieren (kritischste oben)
              Object.values(byGroup).forEach(arr => arr.sort((a, b) => (b.severityScore || 0) - (a.severityScore || 0)))
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {groupConfig.map(cfg => {
                    const items = byGroup[cfg.key] || []
                    if (items.length === 0) return null
                    const namePreview = [...new Set(items.map(i => i.name))].slice(0, 4).join(' · ')
                    const moreCount = [...new Set(items.map(i => i.name))].length - 4
                    return (
                      <details key={cfg.key} open={cfg.defaultOpen} style={{
                        border: `1px solid ${cfg.color}33`,
                        borderLeft: `3px solid ${cfg.color}`,
                        borderRadius: 6,
                        background: cfg.bg,
                      }}>
                        <summary title={cfg.desc} style={{
                          cursor: 'pointer', padding: '8px 12px', listStyle: 'none',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                          fontSize: 12, fontWeight: 700, color: cfg.color,
                        }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {cfg.label}
                            <span style={{ background: `${cfg.color}22`, color: cfg.color, padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700 }}>{items.length}</span>
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, fontFamily: 'var(--font-mono)' }}>
                            {namePreview}{moreCount > 0 ? ` +${moreCount}` : ''}
                          </span>
                        </summary>
                        <div style={{ padding: '4px 12px 10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {items.map((a, idx) => (
                            <div key={a.name + a.tag + idx} title={a.explain || ''} style={{
                              display: 'flex', alignItems: 'center', gap: 12, padding: '6px 10px',
                              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 5,
                              cursor: a.explain ? 'help' : 'default',
                            }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', minWidth: 130 }}>{a.name}</span>
                              <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>{a.headline}</span>
                              {/* v3.14.0: Tag-Label rechts entfernt — Kategorie ist schon im Gruppen-Header */}
                            </div>
                          ))}
                        </div>
                      </details>
                    )
                  })}
                </div>
              )
            })()}
          </>
        )}
      </Card>

      {/* v3.7.0: Top-Performer-Karte (positives Gegenstück) */}
      <Card title="⭐ Top-Performer (Models)">
        {(() => {
          // 1. Top Revenue heute (≥10 sellingChats)
          const topRevenue = tableRows
            .filter(r => (r.sellingChats || 0) >= 10)
            .sort((a, b) => (b.revenue || 0) - (a.revenue || 0))
            .slice(0, 3)
          // 2. Höchster Avg Chat Value heute (gesund, nicht whale-extrem)
          const topAvgChat = tableRows
            .filter(r => (r.sellingChats || 0) >= 10 && (r.avgChatValue || 0) > 30 && (r.avgChatValue || 0) < 150)
            .sort((a, b) => (b.avgChatValue || 0) - (a.avgChatValue || 0))
            .slice(0, 3)
          // 3. Konstante Accounts: Stability ≥75 + ≥7 aktive Tage
          const consistent = tableRows
            .filter(r => r.health.hasEnoughData
              && r.health.stability.score !== null && r.health.stability.score >= 75
              && r.health.activeDays >= 7)
            .sort((a, b) => (b.health.stability.score || 0) - (a.health.stability.score || 0))
            .slice(0, 3)
          // 4. Gesunde Long-Term Accounts (aus warnings 'healthy')
          const healthy = tableRows
            .filter(r => r.health.hasEnoughData && r.health.warnings.some(w => w.type === 'healthy'))
            .sort((a, b) => (b.health.sustainability.score || 0) - (a.health.sustainability.score || 0))
            .slice(0, 3)

          const groupCfg = [
            {
              key: 'top_revenue', label: '⭐ Top Revenue heute',
              desc: 'Die 3 Models mit dem höchsten Umsatz heute (mindestens 10 Käufer-Chats).',
              items: topRevenue, valueFn: (r) => formatMoney(r.revenue),
              metaFn: (r) => `${r.sellingChats} Käufer · Ø ${formatMoney(r.avgChatValue)}/Chat`,
            },
            {
              key: 'avg_chat', label: '💰 Beste Käufer-Qualität',
              desc: 'Höchster Avg Chat Value bei gesunder Käuferzahl ($30–$150 = solide Monetarisierung ohne Whale-Risiko).',
              items: topAvgChat, valueFn: (r) => formatMoney(r.avgChatValue),
              metaFn: (r) => `${formatMoney(r.revenue)} · ${r.sellingChats} Käufer`,
            },
            {
              key: 'consistent', label: '🎯 Konstante Accounts',
              desc: 'Revenue Stability ≥75 über 14 Tage, mindestens 7 aktive Tage. Wenig Schwankung.',
              items: consistent, valueFn: (r) => r.health.stability.score + '/100',
              metaFn: (r) => `${r.health.activeDays} aktive Tage · Schwankung ${(r.health.stability.cv * 100).toFixed(0)}%`,
            },
            {
              key: 'healthy', label: '✓ Gesunde Long-Term Accounts',
              desc: 'Stabile Revenue, gesunde Fan-Qualität, keine Whale-Abhängigkeit. Vorbild-Accounts.',
              items: healthy, valueFn: (r) => r.health.sustainability.score + '/100',
              metaFn: (r) => `Stability ${r.health.stability.score} · Fan Quality ${r.health.fanQuality.score}`,
            },
          ]
          const greenColor = 'var(--green)'
          const greenBg = 'rgba(16,185,129,0.06)'

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {groupCfg.map(cfg => {
                const items = cfg.items
                const namePreview = items.slice(0, 3).map(i => i.creator).join(' · ')
                return (
                  <details key={cfg.key} style={{
                    border: `1px solid ${greenColor}33`, borderLeft: `3px solid ${greenColor}`,
                    borderRadius: 6, background: greenBg,
                  }}>
                    <summary title={cfg.desc} style={{
                      cursor: 'pointer', padding: '8px 12px', listStyle: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                      fontSize: 12, fontWeight: 700, color: greenColor,
                    }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {cfg.label}
                        <span style={{ background: `${greenColor}22`, color: greenColor, padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700 }}>{items.length}</span>
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, fontFamily: 'var(--font-mono)' }}>
                        {items.length === 0 ? 'keine heute' : namePreview}
                      </span>
                    </summary>
                    <div style={{ padding: '4px 12px 10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {items.length === 0 ? (
                        <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '6px 10px', fontStyle: 'italic' }}>
                          Heute kein Model in dieser Kategorie.
                        </div>
                      ) : items.map((r, idx) => (
                        <div key={r.creator + idx} title={cfg.desc} style={{
                          display: 'flex', alignItems: 'center', gap: 12, padding: '6px 10px',
                          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 5,
                        }}>
                          <span style={{
                            fontSize: 11, fontWeight: 700, color: greenColor, minWidth: 26, textAlign: 'center',
                            background: `${greenColor}15`, borderRadius: 4, padding: '2px 0',
                          }}>#{idx + 1}</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', minWidth: 130 }}>{r.creator}</span>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>{cfg.metaFn(r)}</span>
                          <span style={{
                            fontSize: 12, color: greenColor, background: `${greenColor}15`,
                            border: `1px solid ${greenColor}33`, padding: '2px 10px', borderRadius: 4,
                            whiteSpace: 'nowrap', fontWeight: 700, fontFamily: 'var(--font-mono)',
                          }}>{cfg.valueFn(r)}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )
              })}
            </div>
          )
        })()}
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
                  {['Model','Revenue','Δ Rev','7T Rev','Δ Subs','7T Subs','Δ Chats','7T Chats','Δ AvgChat','7T AvgChat','Trend','Health','Status','Empfehlung'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((r, i) => (
                  <React.Fragment key={r.creator + i}>
                  <tr style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
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
                    {/* v3.7.0: Account Health Score */}
                    <td style={tdStyle}>
                      {r.health.hasEnoughData ? (
                        <button
                          onClick={() => setExpandedHealth(expandedHealth === r.creator ? null : r.creator)}
                          title={`Klick für Details · ${r.health.activeDays} aktive Tage`}
                          style={{
                            background: modelScoreBg(r.health.accountHealth.color),
                            color: modelScoreColor(r.health.accountHealth.color),
                            border: `1px solid ${modelScoreColor(r.health.accountHealth.color)}55`,
                            padding: '2px 10px', borderRadius: 4,
                            fontSize: 12, fontWeight: 700,
                            fontFamily: 'var(--font-mono)', cursor: 'pointer',
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}
                        >
                          {r.health.accountHealth.score}
                          <span style={{ fontSize: 9, opacity: 0.6 }}>{expandedHealth === r.creator ? '▲' : '▼'}</span>
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: 11 }} title={`Nur ${r.health.activeDays} aktive Tage`}>—</span>
                      )}
                    </td>
                    <td style={tdStyle}><span style={{ background: `${statusColors[r.status]}22`, color: statusColors[r.status] || 'var(--text-secondary)', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.status}</span></td>
                    <td style={{ ...tdStyle, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{r.recommendation}</td>
                  </tr>
                  {/* v3.7.0: Expandable Health-Detail-Row */}
                  {expandedHealth === r.creator && r.health.hasEnoughData && (
                    <tr style={{ background: 'rgba(124,58,237,0.04)' }}>
                      <td colSpan={14} style={{ padding: '14px 16px', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
                            📊 Account Health · {r.health.activeDays} aktive Tage (letzte 14)
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                            <ModelSubScore label="Account Health" score={r.health.accountHealth.score} color={r.health.accountHealth.color}
                              detail="Gesamt-Bewertung: Mittelwert aus allen Sub-Scores" />
                            <ModelSubScore label="Sustainability" score={r.health.sustainability.score} color={r.health.sustainability.color}
                              detail="20% Stability + 20% Fan Quality + 20% Whale + 20% Chatter Dep. + 20% Recurring-Subs" />
                            <ModelSubScore label="Revenue Stability" score={r.health.stability.score} color={r.health.stability.color}
                              detail={`Schwankung ${r.health.stability.cv !== null ? (r.health.stability.cv * 100).toFixed(0) + '%' : '—'} · <25% grün, 25-50% gelb, >50% rot`} />
                            <ModelSubScore label="Whale Risk" score={r.health.whale.score} color={r.health.whale.color}
                              detail={`${r.health.whale.level} · Ø $${r.health.whale.avgChatValue}/Chat · ${r.health.whale.avgSellingChats} Käufer/Tag`} />
                            <ModelSubScore label="Fan Quality" score={r.health.fanQuality.score} color={r.health.fanQuality.color}
                              detail={`${r.health.fanQuality.avgChats} Käufer/Tag · Recurring ${r.health.fanQuality.recurringRatio !== null ? (r.health.fanQuality.recurringRatio * 100).toFixed(0) + '%' : '—'} · Schwankung ${r.health.fanQuality.chatsCv !== null ? (r.health.fanQuality.chatsCv * 100).toFixed(0) + '%' : '—'}`} />
                            <ModelSubScore label="Chatter Dependency" score={r.health.chatterDep.score} color={r.health.chatterDep.color}
                              detail={r.health.chatterDep.topChatter !== null ? `Top-Chatter ${r.health.chatterDep.topChatter}: ${r.health.chatterDep.topPct}% aller Schichten · ${r.health.chatterDep.chatterCount} Chatter gesamt` : 'Keine Schicht-Daten verfügbar'} />
                            {r.funnel && (
                              <ModelSubScore label={r.funnel.isCurrentFree ? "Funnel Efficiency (FREE)" : "Funnel Efficiency (VIP)"} score={r.funnel.score} color={r.funnel.color}
                                detail={`VIP: ${r.funnel.pct}% des kombinierten Revenue · FREE ${formatMoney(r.funnel.freeRev)} · VIP ${formatMoney(r.funnel.vipRev)}`} />
                            )}
                          </div>
                          {r.health.warnings.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                              {r.health.warnings.map((w, wi) => {
                                const wColor = w.severity === 'positive' ? 'var(--green)' : w.severity === 'critical' ? 'var(--red)' : 'var(--yellow)'
                                const wBg = w.severity === 'positive' ? 'rgba(16,185,129,0.12)' : w.severity === 'critical' ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)'
                                return (
                                  <span key={wi} style={{
                                    fontSize: 11, fontWeight: 700, color: wColor, background: wBg,
                                    border: `1px solid ${wColor}55`, padding: '3px 10px', borderRadius: 4,
                                  }}>
                                    {w.severity === 'positive' ? '✓' : '⚠'} {w.label}
                                  </span>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Collapsible>
    </div>
  )
}

// v3.7.0: Collapsible NICHT in der Component (sonst State-Reset bei Re-Render)
function Collapsible({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
        padding: '12px 16px', cursor: 'pointer', color: 'var(--text-muted)',
        fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: 'inherit',
      }}>
        <span>{title}</span>
        <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{open ? '▼' : '▶'}</span>
      </button>
      {open && <div style={{ padding: '0 16px 16px 16px' }}>{children}</div>}
    </div>
  )
}

// v3.7.0: Sub-Score-Card im Health-Detail-Bereich
function ModelSubScore({ label, score, color, detail }) {
  const c = modelScoreColor(color)
  const bg = modelScoreBg(color)
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${c}33`,
      borderRadius: 8,
      padding: '10px 12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>{label}</span>
        <span style={{
          background: bg, color: c,
          padding: '2px 8px', borderRadius: 4,
          fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)',
        }}>
          {score !== null ? score : '—'}
        </span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>{detail}</div>
    </div>
  )
}

// v3.9.0: Kompaktes KPI-Card-Element für die Sekundär-Reihe
function MiniKpi({ label, value, sub, color, subColor }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${color ? color + '33' : 'var(--border)'}`,
      borderRadius: 8, padding: '8px 10px',
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      minHeight: 48,
    }}>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
        {label}
      </div>
      <div style={{
        fontSize: 13, fontWeight: 700, color: color || 'var(--text-primary)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        marginTop: 2,
      }} title={value}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: subColor || 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
          {sub}
        </div>
      )}
    </div>
  )
}
