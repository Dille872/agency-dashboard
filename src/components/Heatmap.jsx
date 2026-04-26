import React, { useState, useMemo } from 'react'
import {
  formatShortDate,
  formatMoney,
  getHeatmapBaseline,
  computeHeatmapCell,
  isActiveDay,
  getWeekdayIdx,
} from '../utils'

const WEEKDAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

/**
 * Heatmap der letzten 7 Tage.
 *
 * Props:
 *   snapshots: Array<{ businessDate, rows }>
 *   topNames:  Array<string>           — welche Namen anzeigen
 *   mode:      'chatter' | 'model'     — bestimmt Off-Day-Logik & Name-Field
 *   title?:    string
 *   nameKey?:  legacy, ignoriert (mode entscheidet)
 */
export default function Heatmap({ snapshots, topNames, mode = 'chatter', title }) {
  const [tooltip, setTooltip] = useState(null) // { x, y, lines: [string[]] }

  const visibleDays = useMemo(
    () => [...snapshots].sort((a, b) => a.businessDate.localeCompare(b.businessDate)).slice(-7),
    [snapshots]
  )

  // Pre-compute alle Zelldaten, einmal pro Render.
  const grid = useMemo(() => {
    if (!visibleDays.length || !topNames.length) return []
    const isModel = mode === 'model'
    return topNames.map(name => {
      const cells = visibleDays.map(snap => {
        const row = snap.rows.find(r => (isModel ? r.creator : r.name) === name) || null
        const active = isActiveDay(row, mode)
        const baseline = getHeatmapBaseline(snapshots, name, snap.businessDate, mode)
        const cell = computeHeatmapCell(row, baseline, active, mode)
        return { date: snap.businessDate, cell, row }
      })
      return { name, cells }
    })
  }, [snapshots, topNames, visibleDays, mode])

  if (visibleDays.length === 0 || topNames.length === 0) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0' }}>Keine Daten</div>
  }

  const showTooltip = (e, name, dateStr, cell, row) => {
    const lines = []
    lines.push(`${name} · ${formatShortDate(dateStr)} (${WEEKDAY_SHORT[getWeekdayIdx(dateStr)]})`)
    if (cell.kind === 'off') {
      lines.push(mode === 'chatter' ? 'Off-Day (nicht aktiv gearbeitet)' : 'Kein Revenue')
      if (mode === 'chatter' && row) {
        lines.push(`${row.sentMessages || 0} Msg · ${(row.activeMinutes || 0).toFixed(0)} min aktiv`)
      }
    } else if (cell.kind === 'missing') {
      lines.push('Keine Daten')
    } else {
      lines.push(`Revenue: ${formatMoney(row?.revenue || 0)}`)
      if (cell.baseline !== null && cell.baseline !== undefined) {
        const srcLabel = cell.baselineSource === 'weekday'
          ? 'Wochentags-Median'
          : '14-Tage-Median'
        lines.push(`Baseline: ${formatMoney(cell.baseline)} (${srcLabel})`)
      }
      if (cell.pct !== null && cell.pct !== undefined) {
        const sign = cell.pct > 0 ? '+' : ''
        lines.push(`Δ: ${sign}${cell.pct.toFixed(1)}%`)
      } else if (cell.kind === 'no-baseline') {
        lines.push('Baseline: noch zu wenig Historie')
      }
    }
    setTooltip({ x: e.clientX, y: e.clientY, lines })
  }

  return (
    <div style={{ position: 'relative' }}>
      {title && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
          {title}
        </div>
      )}
      {tooltip && (
        <div style={{
          position: 'fixed', left: tooltip.x + 12, top: tooltip.y - 10, zIndex: 9999,
          background: 'var(--bg-card)', border: '1px solid var(--border-bright)', borderRadius: 7,
          padding: '7px 10px', fontSize: 11, color: 'var(--text-primary)',
          pointerEvents: 'none', whiteSpace: 'nowrap',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          fontFamily: 'var(--font-mono)',
        }}>
          {tooltip.lines.map((l, i) => (
            <div key={i} style={{
              fontWeight: i === 0 ? 700 : 500,
              color: i === 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
              marginTop: i === 0 ? 0 : 2,
            }}>{l}</div>
          ))}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ fontSize: 12, minWidth: 480 }}>
          <thead>
            <tr>
              <th style={{ color: 'var(--text-muted)', fontWeight: 600, padding: '4px 12px 4px 0', textAlign: 'left', minWidth: 120 }}>Name</th>
              {visibleDays.map(s => (
                <th key={s.businessDate} style={{ color: 'var(--text-muted)', fontWeight: 600, padding: '4px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <div style={{ fontFamily: 'var(--font-mono)' }}>{formatShortDate(s.businessDate)}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                    {WEEKDAY_SHORT[getWeekdayIdx(s.businessDate)]}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map(({ name, cells }) => (
              <tr key={name}>
                <td style={{ color: 'var(--text-secondary)', padding: '6px 12px 6px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
                  {name}
                </td>
                {cells.map(({ date, cell, row }) => {
                  const isSymbol = cell.kind === 'off' || cell.kind === 'missing'
                  return (
                    <td key={date} style={{ padding: '4px 4px', textAlign: 'center' }}>
                      <div
                        onMouseEnter={e => showTooltip(e, name, date, cell, row)}
                        onMouseMove={e => setTooltip(t => t ? ({ ...t, x: e.clientX, y: e.clientY }) : null)}
                        onMouseLeave={() => setTooltip(null)}
                        style={{
                          display: 'inline-flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          minWidth: 52,
                          height: 38,
                          borderRadius: 6,
                          padding: '2px 6px',
                          background: cell.bg,
                          border: cell.kind === 'no-baseline' ? '1px dashed var(--border)' : '1px solid transparent',
                          cursor: 'default',
                          transition: 'transform 0.1s',
                        }}
                        onMouseDown={e => e.currentTarget.style.transform = 'scale(0.97)'}
                        onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
                      >
                        <div style={{
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 700,
                          fontSize: isSymbol ? 16 : 12,
                          color: cell.color,
                          lineHeight: 1.1,
                        }}>
                          {cell.label}
                        </div>
                        {cell.sublabel && (
                          <div style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 9,
                            fontWeight: 600,
                            color: cell.color,
                            opacity: 0.85,
                            marginTop: 1,
                            lineHeight: 1,
                          }}>
                            {cell.sublabel}
                          </div>
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 14, marginTop: 12, fontSize: 10, color: 'var(--text-muted)', flexWrap: 'wrap', alignItems: 'center' }}>
        <LegendDot color="#10b981" label="≥ +50%" />
        <LegendDot color="#34d399" label="+15 bis +50%" />
        <LegendDot color="var(--text-secondary)" label="±15%" />
        <LegendDot color="#f59e0b" label="−15 bis −40%" />
        <LegendDot color="#ef4444" label="< −40%" />
        <span style={{ marginLeft: 'auto', fontStyle: 'italic' }}>
          vs. Median gleicher Wochentage
        </span>
      </div>
    </div>
  )
}

function LegendDot({ color, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }} />
      <span>{label}</span>
    </span>
  )
}
