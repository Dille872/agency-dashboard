import React, { useState } from 'react'
import { supabase } from '../supabase'

const PERIODS = [
  { key: '7', label: '7 Tage' },
  { key: '30', label: '30 Tage' },
  { key: 'month', label: 'Dieser Monat' },
  { key: 'custom', label: 'Frei wählen' },
]

const CONTENT_ITEMS = [
  { key: 'revenue', label: 'Revenue & Statistiken', color: '#10b981' },
  { key: 'shifts', label: 'Schicht-Logs & Zeiten', color: '#06b6d4' },
  { key: 'requests', label: 'Content-Anfragen', color: '#f59e0b' },
  { key: 'board', label: 'Model Boards & Änderungen', color: '#a78bfa' },
  { key: 'notes', label: 'Schichtnotizen', color: '#7c3aed' },
]

export default function ExportTab() {
  const [period, setPeriod] = useState('30')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [format, setFormat] = useState('json')
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState(null)
  const [include, setInclude] = useState({ revenue: true, shifts: true, requests: true, board: true, notes: true })

  const getDateRange = () => {
    const now = new Date()
    const to = now.toISOString().slice(0, 10)
    if (period === 'custom') return { from: dateFrom, to: dateTo || to }
    if (period === 'month') {
      const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
      return { from, to }
    }
    const from = new Date(now - parseInt(period) * 86400000).toISOString().slice(0, 10)
    return { from, to }
  }

  const buildExport = async () => {
    setLoading(true)
    const { from, to } = getDateRange()
    const result = { export_info: { erstellt: new Date().toISOString(), zeitraum_von: from, zeitraum_bis: to, agentur: 'Thirteen 87 Collective' } }

    if (include.revenue) {
      const { data: snaps } = await supabase.from('model_snapshots').select('*').gte('business_date', from).lte('business_date', to).order('business_date')
      const { data: chatSnaps } = await supabase.from('chatter_snapshots').select('*').gte('business_date', from).lte('business_date', to).order('business_date')
      result.revenue = { model_snapshots: snaps, chatter_snapshots: chatSnaps }
    }
    if (include.shifts) {
      const { data: logs } = await supabase.from('shift_logs').select('*').gte('checked_in_at', from + 'T00:00:00').lte('checked_in_at', to + 'T23:59:59').order('checked_in_at')
      result.schicht_logs = logs
    }
    if (include.requests) {
      const { data: reqs } = await supabase.from('content_requests').select('*').gte('created_at', from + 'T00:00:00').order('created_at')
      result.content_anfragen = reqs
    }
    if (include.board) {
      const { data: activity } = await supabase.from('model_board_activity').select('*').gte('created_at', from + 'T00:00:00').order('created_at')
      const { data: board } = await supabase.from('model_board').select('*').order('model_name')
      result.model_boards = { aktuell: board, aenderungen: activity }
    }
    if (include.notes) {
      const { data: notes } = await supabase.from('notes').select('*').gte('created_at', from + 'T00:00:00').order('created_at')
      result.notizen = notes
    }

    const snaps = result.revenue?.model_snapshots || []
    const totalRevenue = snaps.reduce((sum, s) => sum + (s.rows || []).reduce((r, row) => r + (row.revenue || 0), 0), 0)
    setPreview({ result, totalRevenue, shiftsCount: result.schicht_logs?.length || 0, reqsCount: result.content_anfragen?.length || 0, boardCount: result.model_boards?.aenderungen?.length || 0, from, to })
    setLoading(false)
  }

  const doExport = () => {
    if (!preview) return
    const filename = `thirteen87_export_${preview.from}_${preview.to}`
    if (format === 'json') {
      const blob = new Blob([JSON.stringify(preview.result, null, 2)], { type: 'application/json' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename + '.json'; a.click()
    } else {
      const snaps = preview.result.revenue?.model_snapshots || []
      const rows = ['Datum,Model,Umsatz,Nachrichten Revenue,Neue Subs']
      for (const snap of snaps) {
        for (const row of snap.rows || []) {
          rows.push(`${snap.business_date},${row.creator || row.name || ''},${row.revenue || 0},${row.messageRevenue || 0},${row.subs || 0}`)
        }
      }
      const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename + '.csv'; a.click()
    }
  }

  const cardS = { background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '16px 18px' }
  const labelS = { fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 10 }
  const btnS = (active) => ({ fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, background: active ? 'rgba(124,58,237,0.2)' : 'transparent', color: active ? '#a78bfa' : 'var(--text-muted)', border: `1px solid ${active ? '#7c3aed' : 'var(--border)'}` })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 800 }}>
      <div style={cardS}>
        <div style={labelS}>Zeitraum</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: period === 'custom' ? 12 : 0 }}>
          {PERIODS.map(p => <button key={p.key} onClick={() => setPeriod(p.key)} style={btnS(period === p.key)}>{p.label}</button>)}
        </div>
        {period === 'custom' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '6px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'monospace', outline: 'none' }} />
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>bis</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '6px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'monospace', outline: 'none' }} />
          </div>
        )}
      </div>

      <div style={cardS}>
        <div style={labelS}>Inhalt</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {CONTENT_ITEMS.map(item => (
            <label key={item.key} onClick={() => setInclude(prev => ({ ...prev, [item.key]: !prev[item.key] }))} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <div style={{ width: 16, height: 16, borderRadius: 4, border: `1px solid ${include[item.key] ? item.color : '#2e2e5a'}`, background: include[item.key] ? item.color + '33' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {include[item.key] && <span style={{ color: item.color, fontSize: 10, fontWeight: 700 }}>✓</span>}
              </div>
              <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{item.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div style={cardS}>
        <div style={labelS}>Format</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button onClick={() => setFormat('json')} style={btnS(format === 'json')}>JSON (für KI-Auswertung)</button>
          <button onClick={() => setFormat('csv')} style={btnS(format === 'csv')}>CSV (für Excel)</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>
          {format === 'json' ? 'JSON enthält alle Daten strukturiert – ideal für Claude oder ChatGPT.' : 'CSV enthält Revenue-Daten – ideal für Excel oder Google Sheets.'}
        </div>
        <button onClick={buildExport} disabled={loading} style={{ padding: '9px 24px', borderRadius: 8, background: '#7c3aed', color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          {loading ? '⏳ Lade Daten...' : '🔍 Vorschau erstellen'}
        </button>
      </div>

      {preview && (
        <div style={cardS}>
          <div style={labelS}>Vorschau</div>
          <div style={{ background: 'var(--bg-card2)', borderRadius: 8, border: '1px solid #1e1e3a', padding: '12px 14px', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.8, marginBottom: 14 }}>
            <span style={{ color: '#a78bfa' }}>export_{preview.from}_{preview.to}.{format}</span><br />
            {include.revenue && <><span style={{ color: '#10b981' }}>revenue</span><span style={{ color: 'var(--text-muted)' }}> {preview.from} → {preview.to} · ${preview.totalRevenue.toFixed(2)} gesamt</span><br /></>}
            {include.shifts && <><span style={{ color: '#06b6d4' }}>schichten</span><span style={{ color: 'var(--text-muted)' }}> {preview.shiftsCount} Einträge</span><br /></>}
            {include.requests && <><span style={{ color: '#f59e0b' }}>anfragen</span><span style={{ color: 'var(--text-muted)' }}> {preview.reqsCount} Einträge</span><br /></>}
            {include.board && <><span style={{ color: '#a78bfa' }}>board_änderungen</span><span style={{ color: 'var(--text-muted)' }}> {preview.boardCount} Einträge</span><br /></>}
          </div>
          <button onClick={doExport} style={{ padding: '9px 24px', borderRadius: 8, background: '#10b981', color: '#000', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            ↓ Herunterladen
          </button>
        </div>
      )}
    </div>
  )
}
