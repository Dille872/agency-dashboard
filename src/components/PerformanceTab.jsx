import React, { useMemo } from 'react'
import { supabase } from '../supabase'

const cardS = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }
const labelS = { fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginBottom: 10 }

export default function PerformanceTab({ modelSnapshots, chatterSnapshots }) {
  const analysis = useMemo(() => {
    if (!chatterSnapshots.length) return null

    // Build chatter × model × day data from schedule + snapshots
    // For each day, find chatter revenue from chatter snapshots
    const chatterDailyRevenue = {}
    for (const snap of chatterSnapshots) {
      const date = snap.businessDate
      for (const row of (snap.rows || [])) {
        if (!row.name || !row.revenue) continue
        if (!chatterDailyRevenue[row.name]) chatterDailyRevenue[row.name] = {}
        chatterDailyRevenue[row.name][date] = (chatterDailyRevenue[row.name][date] || 0) + row.revenue
      }
    }

    // Model daily revenue from model snapshots
    const modelDailyRevenue = {}
    for (const snap of modelSnapshots) {
      const date = snap.businessDate
      for (const row of (snap.rows || [])) {
        if (!row.name || !row.revenue) continue
        if (!modelDailyRevenue[row.name]) modelDailyRevenue[row.name] = {}
        modelDailyRevenue[row.name][date] = (modelDailyRevenue[row.name] || {})[date] || row.revenue
      }
    }

    // Revenue by weekday
    const byWeekday = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }
    for (const snap of chatterSnapshots) {
      const date = new Date(snap.businessDate + 'T12:00:00')
      const dow = date.getDay()
      const total = (snap.rows || []).reduce((s, r) => s + (r.revenue || 0), 0)
      if (total > 0) byWeekday[dow].push(total)
    }
    const weekdayAvg = Object.entries(byWeekday).map(([dow, vals]) => ({
      day: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][parseInt(dow)],
      avg: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0,
      dow: parseInt(dow)
    })).sort((a, b) => a.dow - b.dow)

    const bestDay = [...weekdayAvg].sort((a, b) => b.avg - a.avg)[0]
    const worstDay = [...weekdayAvg].filter(d => d.avg > 0).sort((a, b) => a.avg - b.avg)[0]

    // Chatter stats
    const chatters = Object.keys(chatterDailyRevenue)
    const chatterAvg = chatters.map(name => {
      const vals = Object.values(chatterDailyRevenue[name])
      return { name, avg: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0, days: vals.length }
    }).sort((a, b) => b.avg - a.avg)

    // Model stats
    const models = Object.keys(modelDailyRevenue)
    const modelAvg = models.map(name => {
      const vals = Object.values(modelDailyRevenue[name])
      return { name, avg: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0, days: vals.length }
    }).sort((a, b) => b.avg - a.avg)

    return { weekdayAvg, bestDay, worstDay, chatterAvg, modelAvg, chatters, models }
  }, [modelSnapshots, chatterSnapshots])

  if (!analysis) return (
    <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 60, fontSize: 14 }}>Noch keine Daten für Performance-Analyse</div>
  )

  const { weekdayAvg, bestDay, worstDay, chatterAvg, modelAvg } = analysis
  const maxWeekday = Math.max(...weekdayAvg.map(d => d.avg))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        {[
          { label: 'Stärkster Tag', value: bestDay?.day || '—', sub: bestDay ? `Ø $${Math.round(bestDay.avg).toLocaleString()}` : '', color: '#10b981' },
          { label: 'Schwächster Tag', value: worstDay?.day || '—', sub: worstDay ? `Ø $${Math.round(worstDay.avg).toLocaleString()}` : '', color: '#ef4444' },
          { label: 'Bester Chatter', value: chatterAvg[0]?.name || '—', sub: chatterAvg[0] ? `Ø $${Math.round(chatterAvg[0].avg).toLocaleString()}/Tag` : '', color: '#06b6d4' },
          { label: 'Bestes Model', value: modelAvg[0]?.name || '—', sub: modelAvg[0] ? `Ø $${Math.round(modelAvg[0].avg).toLocaleString()}/Tag` : '', color: '#a78bfa' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--bg-card2)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: k.color, fontFamily: 'monospace' }}>{k.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Weekday Chart */}
      <div style={cardS}>
        <div style={labelS}>Umsatz nach Wochentag</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {weekdayAvg.map(d => {
            const pct = maxWeekday > 0 ? (d.avg / maxWeekday) * 100 : 0
            const isBest = d.day === bestDay?.day
            const isWorst = d.day === worstDay?.day && d.avg > 0
            return (
              <div key={d.day} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 24, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right', flexShrink: 0 }}>{d.day}</div>
                <div style={{ flex: 1, background: 'var(--bg-card2)', borderRadius: 4, height: 20, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 4, width: `${pct}%`,
                    background: isBest ? '#10b981' : isWorst ? '#ef4444' : '#7c3aed',
                    transition: 'width .3s',
                    minWidth: d.avg > 0 ? 4 : 0,
                  }} />
                </div>
                <div style={{ width: 70, fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace', flexShrink: 0 }}>
                  {d.avg > 0 ? `$${Math.round(d.avg).toLocaleString()}` : '—'}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* Chatter Ranking */}
        <div style={cardS}>
          <div style={labelS}>Chatter Ranking</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {chatterAvg.slice(0, 8).map((c, i) => {
              const maxAvg = chatterAvg[0]?.avg || 1
              const pct = (c.avg / maxAvg) * 100
              return (
                <div key={c.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: i === 0 ? 700 : 400 }}>
                      {i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : `${i+1}. `}{c.name}
                    </span>
                    <span style={{ fontSize: 11, color: '#06b6d4', fontFamily: 'monospace' }}>${Math.round(c.avg).toLocaleString()}</span>
                  </div>
                  <div style={{ background: 'var(--bg-card2)', borderRadius: 3, height: 4 }}>
                    <div style={{ height: '100%', borderRadius: 3, width: `${pct}%`, background: i === 0 ? '#10b981' : '#06b6d4' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Model Ranking */}
        <div style={cardS}>
          <div style={labelS}>Model Ranking</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {modelAvg.slice(0, 8).map((m, i) => {
              const maxAvg = modelAvg[0]?.avg || 1
              const pct = (m.avg / maxAvg) * 100
              return (
                <div key={m.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: i === 0 ? 700 : 400 }}>
                      {i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : `${i+1}. `}{m.name}
                    </span>
                    <span style={{ fontSize: 11, color: '#a78bfa', fontFamily: 'monospace' }}>${Math.round(m.avg).toLocaleString()}</span>
                  </div>
                  <div style={{ background: 'var(--bg-card2)', borderRadius: 3, height: 4 }}>
                    <div style={{ height: '100%', borderRadius: 3, width: `${pct}%`, background: i === 0 ? '#10b981' : '#a78bfa' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Insights */}
      <div style={cardS}>
        <div style={labelS}>Insights</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {bestDay && (
            <div style={{ padding: '8px 10px', background: 'rgba(16,185,129,0.07)', borderRadius: 7, borderLeft: '3px solid #10b981' }}>
              <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                <span style={{ fontWeight: 700 }}>{bestDay.day}</span> ist euer stärkster Tag mit Ø ${Math.round(bestDay.avg).toLocaleString()} — Schichten hier priorisieren.
              </div>
            </div>
          )}
          {worstDay && (
            <div style={{ padding: '8px 10px', background: 'rgba(239,68,68,0.07)', borderRadius: 7, borderLeft: '3px solid #ef4444' }}>
              <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                <span style={{ fontWeight: 700 }}>{worstDay.day}</span> läuft am schwächsten mit Ø ${Math.round(worstDay.avg).toLocaleString()} — weniger Schichten oder gezielte Aktionen.
              </div>
            </div>
          )}
          {chatterAvg.length > 1 && (
            <div style={{ padding: '8px 10px', background: 'rgba(124,58,237,0.07)', borderRadius: 7, borderLeft: '3px solid #7c3aed' }}>
              <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                <span style={{ fontWeight: 700 }}>{chatterAvg[0].name}</span> ist euer stärkster Chatter mit Ø ${Math.round(chatterAvg[0].avg).toLocaleString()}/Tag –{' '}
                {chatterAvg[chatterAvg.length - 1].name} liegt bei Ø ${Math.round(chatterAvg[chatterAvg.length - 1].avg).toLocaleString()}/Tag.
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
