import React, { useMemo, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'

const cardS = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }
const labelS = { fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginBottom: 12 }

function BarChart({ labels, data, colors, ready }) {
  const ref = useRef(null)
  const chartRef = useRef(null)
  useEffect(() => {
    if (!window.Chart || !ready || !ref.current) return
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null }
    chartRef.current = new window.Chart(ref.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ data, backgroundColor: colors, borderColor: colors.map(c => c.replace('55','cc')), borderWidth: 1.5, borderRadius: 4 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { ticks: { callback: v => '$' + (v >= 1000 ? (v/1000).toFixed(0)+'k' : v), font: { size: 10 }, color: '#888' }, grid: { color: 'rgba(128,128,128,0.1)' } },
          x: { ticks: { font: { size: 11 }, color: '#888' }, grid: { display: false } }
        }
      }
    })
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null } }
  }, [ready, labels.join('|'), data.join('|')])
  return <canvas ref={ref} role="img" aria-label="Chart" />
}

export default function PerformanceTab({ modelSnapshots, chatterSnapshots }) {
  const [chartReady, setChartReady] = useState(!!window.Chart)

  useEffect(() => {
    if (window.Chart) { setChartReady(true); return }
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js'
    s.onload = () => setChartReady(true)
    document.head.appendChild(s)
  }, [])

  const analysis = useMemo(() => {
    if (!chatterSnapshots.length) return null

    const chatterDailyRevenue = {}
    for (const snap of chatterSnapshots) {
      const date = snap.businessDate
      for (const row of (snap.rows || [])) {
        if (!row.name || !row.revenue) continue
        if (!chatterDailyRevenue[row.name]) chatterDailyRevenue[row.name] = {}
        chatterDailyRevenue[row.name][date] = (chatterDailyRevenue[row.name][date] || 0) + row.revenue
      }
    }

    const modelDailyRevenue = {}
    for (const snap of modelSnapshots) {
      const date = snap.businessDate
      for (const row of (snap.rows || [])) {
        const modelName = row.creator || row.name
        if (!modelName || !row.revenue) continue
        if (!modelDailyRevenue[modelName]) modelDailyRevenue[modelName] = {}
        modelDailyRevenue[modelName][date] = row.revenue
      }
    }

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

    const chatterAvg = Object.keys(chatterDailyRevenue).map(name => {
      const vals = Object.values(chatterDailyRevenue[name])
      return { name, avg: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0 }
    }).sort((a, b) => b.avg - a.avg)

    const modelAvg = Object.keys(modelDailyRevenue).map(name => {
      const vals = Object.values(modelDailyRevenue[name])
      return { name, avg: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0 }
    }).sort((a, b) => b.avg - a.avg)

    return { weekdayAvg, bestDay, worstDay, chatterAvg, modelAvg }
  }, [modelSnapshots, chatterSnapshots])

  if (!analysis) return (
    <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 60, fontSize: 14 }}>Noch keine Daten für Performance-Analyse</div>
  )

  const { weekdayAvg, bestDay, worstDay, chatterAvg, modelAvg } = analysis

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={cardS}>
          <div style={labelS}>Umsatz nach Wochentag</div>
          <div style={{ position: 'relative', height: 180 }}>
            <BarChart ready={chartReady}
              labels={weekdayAvg.map(d => d.day)}
              data={weekdayAvg.map(d => Math.round(d.avg))}
              colors={weekdayAvg.map(d => d.day === bestDay?.day ? '#10b98155' : d.day === worstDay?.day ? '#ef444455' : '#7c3aed55')}
            />
          </div>
        </div>
        <div style={cardS}>
          <div style={labelS}>Chatter Ranking</div>
          <div style={{ position: 'relative', height: 180 }}>
            <BarChart ready={chartReady}
              labels={chatterAvg.slice(0, 6).map(c => c.name)}
              data={chatterAvg.slice(0, 6).map(c => Math.round(c.avg))}
              colors={chatterAvg.slice(0, 6).map((_, i) => i === 0 ? '#10b98155' : '#06b6d455')}
            />
          </div>
        </div>
      </div>

      <div style={cardS}>
        <div style={labelS}>Insights</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {bestDay && <div style={{ padding: '8px 10px', background: 'rgba(16,185,129,0.07)', borderLeft: '3px solid #10b981', borderRadius: '0 7px 7px 0' }}>
            <div style={{ fontSize: 12, color: 'var(--text-primary)' }}><span style={{ fontWeight: 700 }}>{bestDay.day}</span> ist euer stärkster Tag mit Ø ${Math.round(bestDay.avg).toLocaleString()} — Schichten hier priorisieren.</div>
          </div>}
          {worstDay && <div style={{ padding: '8px 10px', background: 'rgba(239,68,68,0.07)', borderLeft: '3px solid #ef4444', borderRadius: '0 7px 7px 0' }}>
            <div style={{ fontSize: 12, color: 'var(--text-primary)' }}><span style={{ fontWeight: 700 }}>{worstDay.day}</span> läuft am schwächsten mit Ø ${Math.round(worstDay.avg).toLocaleString()} — weniger Schichten oder gezielte Aktionen.</div>
          </div>}
          {chatterAvg.length > 1 && <div style={{ padding: '8px 10px', background: 'rgba(124,58,237,0.07)', borderLeft: '3px solid #7c3aed', borderRadius: '0 7px 7px 0' }}>
            <div style={{ fontSize: 12, color: 'var(--text-primary)' }}><span style={{ fontWeight: 700 }}>{chatterAvg[0].name}</span> ist euer stärkster Chatter mit Ø ${Math.round(chatterAvg[0].avg).toLocaleString()}/Tag. <span style={{ fontWeight: 700 }}>{chatterAvg[chatterAvg.length-1].name}</span> liegt bei Ø ${Math.round(chatterAvg[chatterAvg.length-1].avg).toLocaleString()}/Tag.</div>
          </div>}
        </div>
      </div>

    </div>
  )
}
