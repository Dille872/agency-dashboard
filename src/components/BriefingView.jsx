import React, { useState } from 'react'
import Icon from './Icon'

// ═══════════════════════════════════════════════════════════════
// v3.8.0: BriefingView — Wochen- und Monats-Rückblick
// Live-Berechnung aus model_snapshots + chatter_snapshots
// Kein DB-Cron, kein Speichern. Immer aktuell.
// ═══════════════════════════════════════════════════════════════

function formatMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return '$0.00'
  return '$' + Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function pctChange(curr, prev) {
  if (!prev || prev === 0) return null
  return ((curr - prev) / prev) * 100
}

function fmtPct(p) {
  if (p === null) return '—'
  const sign = p > 0 ? '+' : ''
  return `${sign}${p.toFixed(1)}%`
}

// ISO-Wochennummer
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}

// Liefert Mo + So eines Wochen-Zeitfensters relativ zu Referenzdatum
// offset = 0 → aktuelle Woche, -1 → Vorwoche, -2 → 2 Wochen zurück
function getWeekRange(referenceDate, weekOffset = 0) {
  const ref = new Date(referenceDate)
  const day = ref.getDay() // 0=So, 1=Mo, ...
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(ref)
  monday.setDate(ref.getDate() + diffToMonday + weekOffset * 7)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return {
    from: monday.toISOString().slice(0, 10),
    to: sunday.toISOString().slice(0, 10),
    monday,
    sunday,
    weekNumber: getWeekNumber(monday),
    year: monday.getFullYear(),
  }
}

// Liefert ersten + letzten Tag eines Monats
function getMonthRange(year, monthIdx) {
  // monthIdx 0-11
  const first = new Date(year, monthIdx, 1)
  const last = new Date(year, monthIdx + 1, 0)
  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
    year,
    monthIdx,
    label: first.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }),
  }
}

// Aggregation: für einen Zeitraum aus snapshots Revenue + KPIs berechnen
function aggregateRange(modelSnapshots, chatterSnapshots, fromIso, toIso) {
  const modelInRange = modelSnapshots.filter(s => s.businessDate >= fromIso && s.businessDate <= toIso)
  const chatterInRange = chatterSnapshots.filter(s => s.businessDate >= fromIso && s.businessDate <= toIso)

  // Model-Aggregation
  const modelTotals = {} // { creator: { revenue, days, subs, sellingChats } }
  let totalRevenue = 0
  let totalSubs = 0
  let totalSellingChats = 0
  const dailyRevenue = {} // { date: total }
  for (const snap of modelInRange) {
    dailyRevenue[snap.businessDate] = 0
    for (const row of snap.rows || []) {
      const r = row.revenue || 0
      totalRevenue += r
      totalSubs += row.subs || 0
      totalSellingChats += row.sellingChats || 0
      dailyRevenue[snap.businessDate] += r
      if (!modelTotals[row.creator]) modelTotals[row.creator] = { revenue: 0, days: 0, subs: 0, sellingChats: 0, avgChatValue: [] }
      modelTotals[row.creator].revenue += r
      modelTotals[row.creator].days++
      modelTotals[row.creator].subs += row.subs || 0
      modelTotals[row.creator].sellingChats += row.sellingChats || 0
      if (row.avgChatValue) modelTotals[row.creator].avgChatValue.push(row.avgChatValue)
    }
  }
  // Avg chat value je Model mitteln
  for (const m of Object.values(modelTotals)) {
    m.avgChatValueMean = m.avgChatValue.length > 0 ? m.avgChatValue.reduce((s, v) => s + v, 0) / m.avgChatValue.length : 0
  }

  // Chatter-Aggregation
  const chatterTotals = {} // { name: { revenue, days, buyRates, sentPPVs, boughtPPVs, activeMins, responseSecs } }
  for (const snap of chatterInRange) {
    for (const row of snap.rows || []) {
      if (!row.name || row.name.includes('*')) continue
      if (!chatterTotals[row.name]) chatterTotals[row.name] = {
        revenue: 0, days: 0, sentPPVs: 0, boughtPPVs: 0, activeMins: 0, sentMessages: 0,
        buyRates: [], responseSecs: [], revPerHour: [],
      }
      const c = chatterTotals[row.name]
      c.revenue += row.revenue || 0
      c.days++
      c.sentPPVs += row.sentPPVs || 0
      c.boughtPPVs += row.boughtPPVs || 0
      c.activeMins += row.activeMinutes || 0
      c.sentMessages += row.sentMessages || 0
      if (row.buyRate) c.buyRates.push(row.buyRate)
      if (row.avgResponseSeconds > 0) c.responseSecs.push(row.avgResponseSeconds)
      if (row.revenuePerHour) c.revPerHour.push(row.revenuePerHour)
    }
  }
  // Mittelwerte
  for (const c of Object.values(chatterTotals)) {
    c.avgBuyRate = c.buyRates.length > 0 ? c.buyRates.reduce((s, v) => s + v, 0) / c.buyRates.length : 0
    c.avgResponseSec = c.responseSecs.length > 0 ? c.responseSecs.reduce((s, v) => s + v, 0) / c.responseSecs.length : 0
    c.avgRevPerHour = c.revPerHour.length > 0 ? c.revPerHour.reduce((s, v) => s + v, 0) / c.revPerHour.length : 0
    c.spamRatio = c.boughtPPVs > 0 ? c.sentPPVs / c.boughtPPVs : null
  }

  return {
    totalRevenue,
    totalSubs,
    totalSellingChats,
    modelTotals,
    chatterTotals,
    dailyRevenue,
    daysWithData: Object.keys(dailyRevenue).length,
  }
}

// Stärkster + schwächster Tag im Zeitraum
function findBestWorstDay(dailyRevenue) {
  const entries = Object.entries(dailyRevenue).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return { best: null, worst: null }
  const dayNames = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
  return {
    best: { date: entries[0][0], revenue: entries[0][1], dayName: dayNames[new Date(entries[0][0]).getDay()] },
    worst: { date: entries[entries.length - 1][0], revenue: entries[entries.length - 1][1], dayName: dayNames[new Date(entries[entries.length - 1][0]).getDay()] },
  }
}

// Smart Action Items aus Daten ableiten
function generateActionItems(current, previous) {
  const items = []

  // 1. Chatter mit hohem Spam-Risk
  for (const [name, c] of Object.entries(current.chatterTotals)) {
    if (c.spamRatio !== null && c.spamRatio > 4.0 && c.days >= 3) {
      items.push({
        severity: 'critical',
        text: `${name}: Spam-Risiko (${c.spamRatio.toFixed(1)} Sent/Bought) — Gespräch nötig`,
      })
    }
  }

  // 2. Models mit starkem Revenue-Einbruch
  for (const [creator, m] of Object.entries(current.modelTotals)) {
    const prev = previous.modelTotals[creator]
    if (prev && prev.revenue > 100) {
      const change = pctChange(m.revenue, prev.revenue)
      if (change !== null && change < -25) {
        items.push({
          severity: 'critical',
          text: `${creator}: Revenue ${fmtPct(change)} eingebrochen (${formatMoney(m.revenue)} vs. ${formatMoney(prev.revenue)})`,
        })
      }
    }
  }

  // 3. Chatter mit niedrigem $/Std
  for (const [name, c] of Object.entries(current.chatterTotals)) {
    if (c.days >= 3 && c.avgRevPerHour < 100 && c.activeMins > 180) {
      items.push({
        severity: 'warning',
        text: `${name}: ${formatMoney(c.avgRevPerHour)}/Std über ${c.days} Tage — unter Minimum`,
      })
    }
  }

  // 4. Whale-abhängige Models (avgChatValue extrem hoch + wenig sellingChats)
  for (const [creator, m] of Object.entries(current.modelTotals)) {
    const avgChats = m.sellingChats / m.days
    if (m.avgChatValueMean > 100 && avgChats < 5 && m.revenue > 200) {
      items.push({
        severity: 'warning',
        text: `${creator}: Whale-abhängig (Ø ${formatMoney(m.avgChatValueMean)}/Chat, nur ${avgChats.toFixed(1)} Käufer/Tag)`,
      })
    }
  }

  // 5. Top-Performer hervorheben (positiv)
  const topChatter = Object.entries(current.chatterTotals)
    .filter(([_, c]) => c.days >= 4 && c.avgRevPerHour > 200)
    .sort((a, b) => b[1].avgRevPerHour - a[1].avgRevPerHour)[0]
  if (topChatter) {
    items.push({
      severity: 'positive',
      text: `${topChatter[0]}: Top-Effizienz ${formatMoney(topChatter[1].avgRevPerHour)}/Std über ${topChatter[1].days} Tage`,
    })
  }

  return items.slice(0, 8) // max 8 Items
}

// ═══════════════════════════════════════════════════════════════
// Briefing-Karte (klappbar)
// ═══════════════════════════════════════════════════════════════

function BriefingCard({ briefing, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const { title, subtitle, isCurrent, type } = briefing

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${isCurrent ? '#7c3aed' : 'var(--border)'}`,
      borderRadius: 10,
      overflow: 'hidden',
      boxShadow: isCurrent ? '0 0 0 1px rgba(124,58,237,0.2)' : 'none',
    }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
        padding: '14px 18px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontFamily: 'inherit',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            background: type === 'month' ? 'rgba(245,158,11,0.15)' : 'rgba(124,58,237,0.15)',
            color: type === 'month' ? '#f59e0b' : '#a78bfa',
            padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 700,
          }}>
            {type === 'month' ? 'MONAT' : 'WOCHE'}
          </span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>
          </div>
          {isCurrent && (
            <span style={{
              background: 'rgba(124,58,237,0.2)', color: '#a78bfa',
              padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
            }}>AKTUELL</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {formatMoney(briefing.current.totalRevenue)}
          </span>
          {briefing.revenueChange !== null && (
            <span style={{
              fontSize: 12, fontWeight: 700,
              color: briefing.revenueChange >= 0 ? 'var(--green)' : 'var(--red)',
            }}>
              {fmtPct(briefing.revenueChange)}
            </span>
          )}
          <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{open ? '▼' : '▶'}</span>
        </div>
      </button>

      {open && (
        <div style={{ padding: '0 18px 18px 18px', borderTop: '1px solid var(--border)' }}>
          <BriefingContent briefing={briefing} />
        </div>
      )}
    </div>
  )
}

function BriefingContent({ briefing }) {
  const { current, previous, prevPrevious, dailyRange, type } = briefing

  // Top/Bottom Models
  const modelEntries = Object.entries(current.modelTotals)
    .map(([creator, m]) => {
      const prev = previous?.modelTotals[creator]
      const change = prev ? pctChange(m.revenue, prev.revenue) : null
      return { creator, ...m, prevRevenue: prev?.revenue || 0, change }
    })
    .filter(m => m.revenue > 10)
    .sort((a, b) => b.revenue - a.revenue)
  const top3Models = modelEntries.slice(0, 3)
  const bottom3Models = modelEntries.filter(m => m.change !== null && m.change < 0).sort((a, b) => a.change - b.change).slice(0, 3)

  // Top/Bottom Chatter
  const chatterEntries = Object.entries(current.chatterTotals)
    .map(([name, c]) => ({ name, ...c }))
    .filter(c => c.days >= 2)
  const topChatters = [...chatterEntries].sort((a, b) => b.avgRevPerHour - a.avgRevPerHour).slice(0, 3)
  const bottomChatters = [...chatterEntries]
    .filter(c => c.avgRevPerHour > 0)
    .sort((a, b) => a.avgRevPerHour - b.avgRevPerHour).slice(0, 3)

  const bestWorst = findBestWorstDay(current.dailyRevenue)
  const actionItems = generateActionItems(current, previous || { modelTotals: {}, chatterTotals: {} })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 16 }}>

      {/* Block 1: Revenue Trio (Vergleich) */}
      <div>
        <SectionLabel><Icon name="dollar" /> Revenue-Vergleich</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <StatBox label={type === 'month' ? 'Diese Monat' : 'Diese Woche'} value={formatMoney(current.totalRevenue)} highlight />
          <StatBox label={type === 'month' ? 'Vormonat' : 'Vorwoche'} value={previous ? formatMoney(previous.totalRevenue) : '—'} sub={briefing.revenueChange !== null ? fmtPct(briefing.revenueChange) : null} subColor={briefing.revenueChange >= 0 ? 'var(--green)' : 'var(--red)'} />
          <StatBox label={type === 'month' ? 'Vor-Vormonat' : 'Vor 2 Wochen'} value={prevPrevious ? formatMoney(prevPrevious.totalRevenue) : '—'} sub={briefing.revenueChangePrevPrev !== null ? fmtPct(briefing.revenueChangePrevPrev) : null} subColor={briefing.revenueChangePrevPrev >= 0 ? 'var(--green)' : 'var(--red)'} />
        </div>
        <div style={{ marginTop: 8, display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
          <span>Ø {formatMoney(current.totalRevenue / Math.max(1, current.daysWithData))}/Tag</span>
          <span>·</span>
          <span>{current.totalSubs} Subs gesamt</span>
          <span>·</span>
          <span>{current.totalSellingChats} Käufer-Chats</span>
        </div>
      </div>

      {/* Block 2: Models Top + Bottom */}
      <div>
        <SectionLabel><Icon name="crown" /> Models</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          <RankBox title="Top 3 nach Revenue" items={top3Models.map(m => ({
            name: m.creator,
            primary: formatMoney(m.revenue),
            secondary: m.change !== null ? fmtPct(m.change) + ' vs. vorher' : `${m.days} Tage aktiv`,
            secondaryColor: m.change !== null && m.change >= 0 ? 'var(--green)' : (m.change !== null && m.change < 0 ? 'var(--red)' : 'var(--text-muted)'),
          }))} positive />
          {bottom3Models.length > 0 && (
            <RankBox title="Stärkste Rückgänge" items={bottom3Models.map(m => ({
              name: m.creator,
              primary: formatMoney(m.revenue),
              secondary: fmtPct(m.change),
              secondaryColor: 'var(--red)',
            }))} />
          )}
        </div>
      </div>

      {/* Block 3: Chatter Top + Bottom */}
      <div>
        <SectionLabel><Icon name="users" /> Chatter</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          <RankBox title="Top 3 nach $/Std" items={topChatters.map(c => ({
            name: c.name,
            primary: formatMoney(c.avgRevPerHour) + '/Std',
            secondary: `${formatMoney(c.revenue)} · BR ${c.avgBuyRate.toFixed(1)}%`,
            secondaryColor: 'var(--text-muted)',
          }))} positive />
          {bottomChatters.length > 0 && (
            <RankBox title="Schwächste $/Std" items={bottomChatters.map(c => ({
              name: c.name,
              primary: formatMoney(c.avgRevPerHour) + '/Std',
              secondary: `${formatMoney(c.revenue)} · ${c.days} Tage`,
              secondaryColor: 'var(--text-muted)',
            }))} />
          )}
        </div>
      </div>

      {/* Block 4: Auffälligkeiten der Periode */}
      <div>
        <SectionLabel><Icon name="calendar" /> Periode-Insights</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
          <StatBox label="Stärkster Tag" value={bestWorst.best ? `${bestWorst.best.dayName} (${bestWorst.best.date.slice(5)})` : '—'} sub={bestWorst.best ? formatMoney(bestWorst.best.revenue) : null} subColor="var(--green)" />
          <StatBox label="Schwächster Tag" value={bestWorst.worst ? `${bestWorst.worst.dayName} (${bestWorst.worst.date.slice(5)})` : '—'} sub={bestWorst.worst ? formatMoney(bestWorst.worst.revenue) : null} subColor="var(--red)" />
          <StatBox label="Tage mit Daten" value={`${current.daysWithData}`} sub={type === 'month' ? `von ${dailyRange} Tagen` : 'von 7 Tagen'} />
          <StatBox label="Aktive Chatter" value={`${chatterEntries.length}`} sub={`${Object.keys(current.modelTotals).length} Models`} />
        </div>
      </div>

      {/* Block 5: Action Items */}
      {actionItems.length > 0 && (
        <div>
          <SectionLabel><Icon name="target" /> Empfohlene Aktionen</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {actionItems.map((item, i) => {
              const color = item.severity === 'positive' ? 'var(--green)' : item.severity === 'critical' ? 'var(--red)' : 'var(--yellow)'
              const bg = item.severity === 'positive' ? 'rgba(16,185,129,0.06)' : item.severity === 'critical' ? 'rgba(239,68,68,0.06)' : 'rgba(245,158,11,0.06)'
              const icon = item.severity === 'positive' ? '✓' : '⚠'
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', background: bg,
                  border: `1px solid ${color}33`, borderLeft: `3px solid ${color}`,
                  borderRadius: 5,
                }}>
                  <span style={{ color, fontSize: 13, fontWeight: 700 }}>{icon}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-primary)', flex: 1 }}>{item.text}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, color: 'var(--text-muted)', fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8,
    }}>{children}</div>
  )
}

function StatBox({ label, value, sub, subColor, highlight }) {
  return (
    <div style={{
      background: highlight ? 'rgba(124,58,237,0.06)' : 'var(--bg-card2)',
      border: `1px solid ${highlight ? 'rgba(124,58,237,0.3)' : 'var(--border)'}`,
      borderRadius: 8, padding: '10px 12px',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: subColor || 'var(--text-muted)', marginTop: 2, fontWeight: 600 }}>{sub}</div>}
    </div>
  )
}

function RankBox({ title, items, positive }) {
  const color = positive ? 'var(--green)' : 'var(--text-muted)'
  return (
    <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>{title}</div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>—</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {items.map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                fontSize: 10, fontWeight: 700, color, minWidth: 22, textAlign: 'center',
                background: positive ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)', borderRadius: 4, padding: '2px 0',
              }}>#{i + 1}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{item.primary}</span>
              <span style={{ fontSize: 10, color: item.secondaryColor || 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: 70, textAlign: 'right' }}>{item.secondary}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Haupt-Component
// ═══════════════════════════════════════════════════════════════

export default function BriefingView({ modelSnapshots, chatterSnapshots }) {
  const [filter, setFilter] = useState('all') // all | weeks | months

  // Today reference
  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)

  // ── WEEKLY BRIEFINGS (letzte 8 Wochen) ─────────────────────────
  const weeklyBriefings = []
  for (let i = 0; i < 8; i++) {
    // i=0 = letzte vollständige Woche (Mo-So vor heute)
    // also offset = -1, -2, ..., -8 ausgehend von "heutiger Woche"
    const range = getWeekRange(today, -(i + 1))
    const prevRange = getWeekRange(today, -(i + 2))
    const prevPrevRange = getWeekRange(today, -(i + 3))

    const current = aggregateRange(modelSnapshots, chatterSnapshots, range.from, range.to)
    if (current.totalRevenue === 0 && current.daysWithData === 0) continue // skip leere

    const previous = aggregateRange(modelSnapshots, chatterSnapshots, prevRange.from, prevRange.to)
    const prevPrevious = aggregateRange(modelSnapshots, chatterSnapshots, prevPrevRange.from, prevPrevRange.to)

    weeklyBriefings.push({
      type: 'week',
      title: `KW ${range.weekNumber} / ${range.year}`,
      subtitle: `${range.monday.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })} – ${range.sunday.toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })}`,
      isCurrent: i === 0,
      current,
      previous: previous.totalRevenue > 0 ? previous : null,
      prevPrevious: prevPrevious.totalRevenue > 0 ? prevPrevious : null,
      revenueChange: previous.totalRevenue > 0 ? pctChange(current.totalRevenue, previous.totalRevenue) : null,
      revenueChangePrevPrev: prevPrevious.totalRevenue > 0 ? pctChange(current.totalRevenue, prevPrevious.totalRevenue) : null,
      dailyRange: 7,
    })
  }

  // ── MONTHLY BRIEFINGS (letzte 6 Monate) ────────────────────────
  const monthlyBriefings = []
  // i=0 = letzter vollständiger Monat (z.B. wenn heute Mai, dann April)
  for (let i = 0; i < 6; i++) {
    const refDate = new Date(today.getFullYear(), today.getMonth() - (i + 1), 1)
    const range = getMonthRange(refDate.getFullYear(), refDate.getMonth())
    const prevDate = new Date(today.getFullYear(), today.getMonth() - (i + 2), 1)
    const prevRange = getMonthRange(prevDate.getFullYear(), prevDate.getMonth())
    const prevPrevDate = new Date(today.getFullYear(), today.getMonth() - (i + 3), 1)
    const prevPrevRange = getMonthRange(prevPrevDate.getFullYear(), prevPrevDate.getMonth())

    const current = aggregateRange(modelSnapshots, chatterSnapshots, range.from, range.to)
    if (current.totalRevenue === 0 && current.daysWithData === 0) continue

    const previous = aggregateRange(modelSnapshots, chatterSnapshots, prevRange.from, prevRange.to)
    const prevPrevious = aggregateRange(modelSnapshots, chatterSnapshots, prevPrevRange.from, prevPrevRange.to)

    const lastDay = new Date(range.year, range.monthIdx + 1, 0).getDate()
    monthlyBriefings.push({
      type: 'month',
      title: range.label,
      subtitle: `01.${(range.monthIdx + 1).toString().padStart(2, '0')} – ${lastDay}.${(range.monthIdx + 1).toString().padStart(2, '0')}.${range.year}`,
      isCurrent: i === 0,
      current,
      previous: previous.totalRevenue > 0 ? previous : null,
      prevPrevious: prevPrevious.totalRevenue > 0 ? prevPrevious : null,
      revenueChange: previous.totalRevenue > 0 ? pctChange(current.totalRevenue, previous.totalRevenue) : null,
      revenueChangePrevPrev: prevPrevious.totalRevenue > 0 ? pctChange(current.totalRevenue, prevPrevious.totalRevenue) : null,
      dailyRange: lastDay,
    })
  }

  // ── COMBINE + SORT ─────────────────────────────────────────────
  // Reihenfolge: aktuelles Wochen-Briefing zuerst, dann (falls Anfang Monat) Monat,
  // dann ältere Wochen, dann ältere Monate
  let displayed = []
  if (filter === 'weeks') displayed = weeklyBriefings
  else if (filter === 'months') displayed = monthlyBriefings
  else {
    // Alle: Wechselnd nach Datum sortiert
    const all = [
      ...weeklyBriefings.map((b, i) => ({ ...b, sortKey: b.current.dailyRevenue ? Object.keys(b.current.dailyRevenue).sort().pop() || '0' : '0', _weekIdx: i })),
      ...monthlyBriefings.map((b, i) => ({ ...b, sortKey: b.current.dailyRevenue ? Object.keys(b.current.dailyRevenue).sort().pop() || '0' : '0', _monthIdx: i })),
    ]
    all.sort((a, b) => b.sortKey.localeCompare(a.sortKey))
    displayed = all
  }

  // ── No Data Fallback ───────────────────────────────────────────
  if (displayed.length === 0) {
    return (
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
          Noch keine Briefing-Daten verfügbar.<br />
          Sobald Snapshots für eine abgeschlossene Woche vorliegen, erscheint hier der Rückblick.
        </div>
      </div>
    )
  }

  const btnS = (active) => ({
    fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
    fontFamily: 'inherit', fontWeight: 600,
    background: active ? 'rgba(124,58,237,0.2)' : 'transparent',
    color: active ? '#a78bfa' : 'var(--text-muted)',
    border: `1px solid ${active ? '#7c3aed' : 'var(--border)'}`,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}><Icon name="chart" size={18} /> Briefing & Rückblick</h2>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Live-Auswertung aus Daily Snapshots. Automatisch aktualisiert.</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setFilter('all')} style={btnS(filter === 'all')}>Alle</button>
          <button onClick={() => setFilter('weeks')} style={btnS(filter === 'weeks')}>Wochen</button>
          <button onClick={() => setFilter('months')} style={btnS(filter === 'months')}>Monate</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {displayed.map((b, idx) => (
          <BriefingCard key={`${b.type}_${b.title}_${idx}`} briefing={b} defaultOpen={b.isCurrent && idx === 0} />
        ))}
      </div>
    </div>
  )
}
