import React, { useState } from 'react'
import { pctChange, formatMoney, formatShortDate } from '../utils'

function isDeletedUser(name) {
  if (!name) return true
  return /^.{1,3}\*+$/.test(name.trim())
}

function getFallingDetails(snapshots, nameKey, minDays = 3, minMessages = 0) {
  const sorted = [...snapshots].sort((a, b) => a.businessDate.localeCompare(b.businessDate))
  const allNames = [...new Set(
    snapshots.flatMap(s => s.rows
      .filter(r => !isDeletedUser(r[nameKey]))
      .map(r => r[nameKey])
    )
  )]
  const results = []

  for (const name of allNames) {
    const vals = []
    for (const snap of sorted) {
      const row = snap.rows.find(r => r[nameKey] === name)
      if (row && (minMessages === 0 || (row.sentMessages || 0) >= minMessages)) {
        vals.push({ date: snap.businessDate, revenue: row.revenue, row })
      }
    }
    if (vals.length < minDays) continue

    const recent = vals.slice(-minDays)
    let falling = true
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].revenue >= recent[i - 1].revenue) { falling = false; break }
    }
    if (falling) {
      const totalDrop = pctChange(recent[recent.length - 1].revenue, recent[0].revenue)
      results.push({
        name,
        days: recent.length,
        totalDrop,
        recentRevenue: recent[recent.length - 1].revenue,
        firstRevenue: recent[0].revenue,
        history: recent, // day-by-day data
        isChatter: nameKey === 'name',
      })
    }
  }

  return results.sort((a, b) => a.totalDrop - b.totalDrop)
}

function AlertDetail({ item }) {
  const isChatter = item.isChatter
  return (
    <div style={{
      marginTop: 10, padding: '12px 14px',
      background: 'rgba(0,0,0,0.2)',
      borderRadius: 8, borderTop: '1px solid rgba(239,68,68,0.15)',
    }}>
      {/* Day-by-day revenue history */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: '#4a4a6a', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>Revenue-Verlauf</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {item.history.map((d, i) => {
            const delta = i > 0 ? pctChange(d.revenue, item.history[i - 1].revenue) : null
            return (
              <div key={d.date} style={{
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                borderRadius: 6, padding: '6px 10px', minWidth: 80,
              }}>
                <div style={{ fontSize: 10, color: '#4a4a6a', fontFamily: 'monospace' }}>{formatShortDate(d.date)}</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#f0f0ff', fontSize: 13 }}>{formatMoney(d.revenue)}</div>
                {delta !== null && (
                  <div style={{ fontSize: 10, color: '#ef4444', fontWeight: 600 }}>{delta.toFixed(1)}%</div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Chatter-specific detail */}
      {isChatter && item.history[item.history.length - 1].row && (() => {
        const r = item.history[item.history.length - 1].row
        return (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { label: 'Aktiv (Min)', val: r.activeMinutes?.toFixed(0) || '—' },
              { label: '$/Std', val: formatMoney(r.revenuePerHour || 0) },
              { label: 'Sent PPVs', val: r.sentPPVs || 0 },
              { label: 'Buy Rate', val: r.buyRate ? r.buyRate.toFixed(1) + '%' : '—' },
              { label: 'Avg Rev/PPV', val: formatMoney(r.avgRevenuePerBoughtPPV || 0) },
              { label: 'Nachrichten', val: r.sentMessages || 0 },
              { label: 'Ø Antwort', val: r.avgResponseSeconds ? `${Math.floor(r.avgResponseSeconds/60)}:${String(Math.round(r.avgResponseSeconds%60)).padStart(2,'0')}` : '—' },
            ].map(({ label, val }) => (
              <div key={label} style={{ background: '#13132a', borderRadius: 6, padding: '6px 10px', border: '1px solid #1e1e3a' }}>
                <div style={{ fontSize: 10, color: '#4a4a6a' }}>{label}</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#f0f0ff', fontSize: 12 }}>{val}</div>
              </div>
            ))}
          </div>
        )
      })()}

      {/* Model-specific detail */}
      {!isChatter && item.history[item.history.length - 1].row && (() => {
        const r = item.history[item.history.length - 1].row
        return (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { label: 'Subs Revenue', val: formatMoney(r.subsRevenue || 0) },
              { label: 'Tips Revenue', val: formatMoney(r.tipsRevenue || 0) },
              { label: 'Msg Revenue', val: formatMoney(r.messageRevenue || 0) },
              { label: 'Selling Chats', val: r.sellingChats || 0 },
              { label: 'Avg Chat Value', val: formatMoney(r.avgChatValue || 0) },
              { label: 'Subs', val: r.subs || 0 },
            ].map(({ label, val }) => (
              <div key={label} style={{ background: '#13132a', borderRadius: 6, padding: '6px 10px', border: '1px solid #1e1e3a' }}>
                <div style={{ fontSize: 10, color: '#4a4a6a' }}>{label}</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#f0f0ff', fontSize: 12 }}>{val}</div>
              </div>
            ))}
          </div>
        )
      })()}
    </div>
  )
}

export default function FallingAlert({ snapshots, nameKey, label, minMessages = 0 }) {
  const [openItems, setOpenItems] = useState(new Set())
  const falling = getFallingDetails(snapshots, nameKey, 3, minMessages)

  const toggleItem = (name) => {
    setOpenItems(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  if (falling.length === 0) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 8 }}>
      <span style={{ fontSize: 16 }}>✓</span>
      <span style={{ fontSize: 13, color: '#10b981' }}>Alle {label} stabil – kein 3-Tage-Abwärtstrend erkannt</span>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#ef4444', marginBottom: 2 }}>
        ⚠ {falling.length} {label} {falling.length === 1 ? 'fällt' : 'fallen'} seit 3+ Tagen
      </div>
      {falling.map(item => {
        const isOpen = openItems.has(item.name)
        return (
          <div key={item.name} style={{
            background: 'rgba(239,68,68,0.06)',
            border: `1px solid ${isOpen ? 'rgba(239,68,68,0.5)' : 'rgba(239,68,68,0.25)'}`,
            borderRadius: 8, overflow: 'hidden',
            transition: 'border-color 0.2s',
          }}>
            <div
              onClick={() => toggleItem(item.name)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <div>
                  <div style={{ fontWeight: 600, color: '#f0f0ff', fontSize: 13 }}>{item.name}</div>
                  <div style={{ fontSize: 11, color: '#8888aa', marginTop: 1 }}>
                    {item.days} Tage in Folge fallend · {formatMoney(item.firstRevenue)} → {formatMoney(item.recentRevenue)}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#ef4444', fontSize: 14 }}>
                    {item.totalDrop.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 10, color: '#8888aa' }}>Gesamtrückgang</div>
                </div>
                <span style={{ color: '#4a4a6a', fontSize: 14, transition: 'transform 0.2s', display: 'inline-block', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
              </div>
            </div>
            {isOpen && <AlertDetail item={item} />}
          </div>
        )
      })}
    </div>
  )
}
