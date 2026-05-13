import React, { useState } from 'react'
import { supabase } from '../supabase'

const PERIODS = [
  { key: '7', label: '7 Tage' },
  { key: '30', label: '30 Tage' },
  { key: '90', label: '90 Tage' },
  { key: 'month', label: 'Dieser Monat' },
  { key: 'all', label: 'Alle Zeiten' },
  { key: 'custom', label: 'Frei wählen' },
]

// v3.3.0: Erweiterte Kategorien für vollständige Trend-Analyse
const CONTENT_ITEMS = [
  { key: 'revenue', label: 'Revenue (Models + Chatter)', desc: 'Tägliche Umsätze, Tips, Subs', color: '#10b981' },
  { key: 'shifts', label: 'Schichten', desc: 'Wer wann eingecheckt, Dauer, Auto-Logouts', color: '#06b6d4' },
  { key: 'schedule', label: 'Dienstplan', desc: 'Geplante Schichten pro Model+Chatter', color: '#a78bfa' },
  { key: 'absences', label: 'Abwesenheiten', desc: 'Wer wann krank/abwesend war', color: '#ef4444' },
  { key: 'swaps', label: 'Schicht-Tausche', desc: 'Engpässe und Vertretungen', color: '#f59e0b' },
  { key: 'content', label: 'Content (Anfragen + Ideen)', desc: 'Custom Requests, Content-Ideen', color: '#f59e0b' },
  { key: 'calendar', label: 'Content-Kalender', desc: 'Geplante Posts/Events pro Model', color: '#a78bfa' },
  { key: 'boards', label: 'Model Boards', desc: 'Aktuelle Profile + Änderungs-Verlauf', color: '#a78bfa' },
  { key: 'notes', label: 'Schichtnotizen', desc: 'Was während Schichten passiert ist', color: '#7c3aed' },
  { key: 'targets', label: 'Revenue-Ziele', desc: 'Monatsziele pro Model', color: '#10b981' },
  { key: 'chat_stats', label: 'Chat-Volumen (Statistik)', desc: 'Anzahl Nachrichten pro Tag/Chatter (keine Texte!)', color: '#06b6d4' },
  { key: 'people', label: 'Stammdaten (Namen)', desc: 'Model + Chatter-Liste mit Aliases', color: '#7c3aed' },
]

export default function ExportTab() {
  const [period, setPeriod] = useState('30')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [format, setFormat] = useState('json')
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [include, setInclude] = useState(() =>
    Object.fromEntries(CONTENT_ITEMS.map(i => [i.key, true]))
  )

  const getDateRange = () => {
    const now = new Date()
    const to = now.toISOString().slice(0, 10)
    if (period === 'all') return { from: '2020-01-01', to } // weit genug zurück
    if (period === 'custom') return { from: dateFrom, to: dateTo || to }
    if (period === 'month') {
      const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
      return { from, to }
    }
    const from = new Date(now - parseInt(period) * 86400000).toISOString().slice(0, 10)
    return { from, to }
  }

  const validate = () => {
    if (period === 'custom') {
      if (!dateFrom) return 'Bitte Start-Datum wählen.'
      if (dateTo && dateTo < dateFrom) return 'End-Datum muss nach Start-Datum liegen.'
    }
    if (!Object.values(include).some(v => v)) return 'Bitte mindestens eine Kategorie auswählen.'
    return null
  }

  // Hilfs-Funktion: führt eine Query aus und liefert {data, error}
  // Schluckt Fehler nicht — wir wollen wissen wenn was fehlschlägt
  const safeQuery = async (label, queryFn) => {
    try {
      const result = await queryFn()
      if (result.error) {
        console.warn(`Export ${label} hatte Fehler:`, result.error.message)
        return { data: [], error: result.error.message }
      }
      return { data: result.data || [], error: null }
    } catch (e) {
      console.warn(`Export ${label} crashte:`, e)
      return { data: [], error: String(e) }
    }
  }

  const buildExport = async () => {
    const err = validate()
    if (err) { setError(err); setPreview(null); return }
    setError(null)
    setLoading(true)

    const { from, to } = getDateRange()
    const fromTs = from + 'T00:00:00'
    const toTs = to + 'T23:59:59'

    const result = {
      _readme: {
        agentur: 'Thirteen 87 Collective',
        export_erstellt: new Date().toISOString(),
        zeitraum_von: from,
        zeitraum_bis: to,
        zweck: 'Analyse-Export für ChatGPT/Claude. Enthält Revenue, Schichten, Content und Stammdaten.',
        hinweis: 'Personennamen sind im Klartext. Sensible Daten (Tokens, Telegram-IDs, Auth) sind nicht enthalten.',
        struktur: {
          revenue: 'Tägliche Snapshots pro Model und Chatter (model_snapshots, chatter_snapshots)',
          shifts: 'shift_logs: einzelne Check-in/Check-out Einträge mit Dauer',
          schedule: 'Wer war geplant für welches Model an welchem Tag/Schicht',
          chat_stats: 'Tägliches Nachrichten-Volumen pro Chatter (keine Texte enthalten)',
        },
      },
    }
    const errors = {}

    // === STAMMDATEN: Models + Chatter ===
    if (include.people) {
      const models = await safeQuery('models_contact', () =>
        supabase.from('models_contact').select('id, name, status, daily_revenue_target').order('name')
      )
      const chatters = await safeQuery('chatters_contact', () =>
        supabase.from('chatters_contact').select('id, name, availability').order('name')
      )
      const modelAliases = await safeQuery('model_aliases', () =>
        supabase.from('model_aliases').select('model_name, csv_name, alias_label')
      )
      const chatterAliases = await safeQuery('chatter_aliases', () =>
        supabase.from('chatter_aliases').select('chatter_name, csv_name')
      )
      result.stammdaten = {
        models: models.data,
        chatters: chatters.data,
        model_aliases: modelAliases.data,
        chatter_aliases: chatterAliases.data,
      }
      if (models.error || chatters.error) errors.people = models.error || chatters.error
    }

    // === REVENUE: Model + Chatter Snapshots ===
    if (include.revenue) {
      const modelSnaps = await safeQuery('model_snapshots', () =>
        supabase.from('model_snapshots').select('business_date, file_name, rows')
          .gte('business_date', from).lte('business_date', to)
          .order('business_date')
      )
      const chatterSnaps = await safeQuery('chatter_snapshots', () =>
        supabase.from('chatter_snapshots').select('business_date, file_name, rows')
          .gte('business_date', from).lte('business_date', to)
          .order('business_date')
      )
      result.revenue = {
        model_snapshots: modelSnaps.data,
        chatter_snapshots: chatterSnaps.data,
      }
      if (modelSnaps.error) errors.revenue_models = modelSnaps.error
      if (chatterSnaps.error) errors.revenue_chatters = chatterSnaps.error
    }

    // === SCHICHTEN ===
    if (include.shifts) {
      const logs = await safeQuery('shift_logs', () =>
        supabase.from('shift_logs').select('display_name, shift, checked_in_at, checked_out_at, auto_checkout, model_names')
          .gte('checked_in_at', fromTs).lte('checked_in_at', toTs)
          .order('checked_in_at')
      )
      // Dauer pro Eintrag berechnen
      const enriched = (logs.data || []).map(l => {
        const inT = l.checked_in_at ? new Date(l.checked_in_at) : null
        const outT = l.checked_out_at ? new Date(l.checked_out_at) : null
        const durationMin = inT && outT ? Math.round((outT - inT) / 60000) : null
        const dow = inT ? ['So','Mo','Di','Mi','Do','Fr','Sa'][inT.getDay()] : null
        return { ...l, dauer_minuten: durationMin, wochentag: dow }
      })
      const recurring = await safeQuery('recurring_shifts', () =>
        supabase.from('recurring_shifts').select('*')
      )
      result.schichten = {
        einzelne_logs: enriched,
        wiederkehrende_schichten: recurring.data,
      }
      if (logs.error) errors.shifts = logs.error
    }

    // === ABWESENHEITEN ===
    if (include.absences) {
      // absences hat date_from + date_to (Zeitraum), nicht single date
      // Filter: alle Abwesenheiten deren Zeitraum sich mit unserem überschneidet
      const abs = await safeQuery('absences', () =>
        supabase.from('absences').select('*')
          .lte('date_from', to)
          .gte('date_to', from)
          .order('date_from')
      )
      result.abwesenheiten = abs.data
      if (abs.error) errors.absences = abs.error
    }

    // === SCHICHT-TAUSCHE ===
    if (include.swaps) {
      const swaps = await safeQuery('shift_swaps', () =>
        supabase.from('shift_swaps').select('*')
          .gte('shift_date', from).lte('shift_date', to)
          .order('shift_date')
      )
      const reactions = await safeQuery('swap_reactions', () =>
        supabase.from('swap_reactions').select('*')
      )
      result.schicht_tausche = {
        anfragen: swaps.data,
        reaktionen: reactions.data,
      }
      if (swaps.error) errors.swaps = swaps.error
    }

    // === DIENSTPLAN (Schedule) ===
    if (include.schedule) {
      const sched = await safeQuery('schedule', () =>
        supabase.from('schedule').select('week_start, status, assignments, shift_times, day_notes')
          .gte('week_start', from).lte('week_start', to)
          .order('week_start')
      )
      // assignments aufbereiten: jeden Eintrag flach machen für ChatGPT-Verständnis
      const flat = []
      for (const week of sched.data || []) {
        for (const [key, val] of Object.entries(week.assignments || {})) {
          const parts = key.split('__')
          if (parts.length < 3) continue
          flat.push({
            week_start: week.week_start,
            status: week.status,
            model_id: parts[0],
            tag: parts[1],
            schicht: parts[2],
            chatter: val?.chatter || null,
            trainee: val?.trainee || null,
            trainee_mode: val?.trainee_mode || null,
            zeit: val?.time_override || week.shift_times?.[`${parts[0]}__${parts[2]}`] || null,
            note: val?.note || null,
            confirmed: val?.confirmed || false,
          })
        }
      }
      result.dienstplan = {
        wochen: sched.data,
        flach: flat,
      }
      if (sched.error) errors.schedule = sched.error
    }

    // === CONTENT (Anfragen + Ideen) ===
    if (include.content) {
      const reqs = await safeQuery('content_requests', () =>
        supabase.from('content_requests').select('*')
          .gte('created_at', fromTs).lte('created_at', toTs)
          .order('created_at')
      )
      const ideas = await safeQuery('content_ideas', () =>
        supabase.from('content_ideas').select('*')
          .gte('created_at', fromTs).lte('created_at', toTs)
          .order('created_at')
      )
      const custom = await safeQuery('custom_content', () =>
        supabase.from('custom_content').select('*')
          .gte('created_at', fromTs).lte('created_at', toTs)
          .order('created_at')
      )
      result.content = {
        anfragen: reqs.data,
        ideen: ideas.data,
        custom_content: custom.data,
      }
      if (reqs.error) errors.content = reqs.error
    }

    // === CONTENT-KALENDER (Model Calendar) ===
    if (include.calendar) {
      const cal = await safeQuery('model_calendar', () =>
        supabase.from('model_calendar').select('*')
          .gte('due_date', from).lte('due_date', to)
          .order('due_date')
      )
      result.content_kalender = cal.data
      if (cal.error) errors.calendar = cal.error
    }

    // === MODEL BOARDS ===
    if (include.boards) {
      const boards = await safeQuery('model_board', () =>
        supabase.from('model_board').select('*').order('model_name')
      )
      const activity = await safeQuery('model_board_activity', () =>
        supabase.from('model_board_activity').select('*')
          .gte('created_at', fromTs).lte('created_at', toTs)
          .order('created_at')
      )
      const videos = await safeQuery('model_videos', () =>
        supabase.from('model_videos').select('*')
      )
      result.model_boards = {
        aktuell: boards.data,
        aenderungen_im_zeitraum: activity.data,
        videos: videos.data,
      }
      if (boards.error) errors.boards = boards.error
    }

    // === SCHICHTNOTIZEN ===
    if (include.notes) {
      const notes = await safeQuery('notes', () =>
        supabase.from('notes').select('*')
          .gte('created_at', fromTs).lte('created_at', toTs)
          .order('created_at')
      )
      result.notizen = notes.data
      if (notes.error) errors.notes = notes.error
    }

    // === REVENUE-ZIELE ===
    if (include.targets) {
      const targets = await safeQuery('model_revenue_targets', () =>
        supabase.from('model_revenue_targets').select('*')
      )
      result.revenue_ziele = targets.data
      if (targets.error) errors.targets = targets.error
    }

    // === CHAT-VOLUMEN (Statistiken, keine Texte) ===
    if (include.chat_stats) {
      // Lade nur Metadaten: count, direction, contact_type, sent_by, model_name, created_at
      // Nicht: text, image_urls, payload
      const msgs = await safeQuery('messages', () =>
        supabase.from('messages').select('direction, contact_type, sent_by, model_name, created_at')
          .gte('created_at', fromTs).lte('created_at', toTs)
      )
      // Aggregate pro Tag pro Chatter+Direction
      const byDay = {} // {date: {incoming: 0, outgoing: 0, by_chatter: {...}}}
      const byChatterTotal = {} // {chatter_name: {sent: 0, received_for: {model: count}}}
      const byModelTotal = {} // {model_name: total_messages}
      for (const m of msgs.data || []) {
        const date = (m.created_at || '').slice(0, 10)
        if (!date) continue
        if (!byDay[date]) byDay[date] = { incoming: 0, outgoing: 0, by_chatter: {} }
        if (m.direction === 'in') byDay[date].incoming++
        else if (m.direction === 'out') byDay[date].outgoing++

        const chatter = m.sent_by || '(unbekannt)'
        if (m.direction === 'out') {
          byDay[date].by_chatter[chatter] = (byDay[date].by_chatter[chatter] || 0) + 1
          if (!byChatterTotal[chatter]) byChatterTotal[chatter] = { gesendet_gesamt: 0, gesendet_pro_model: {} }
          byChatterTotal[chatter].gesendet_gesamt++
          if (m.model_name) {
            byChatterTotal[chatter].gesendet_pro_model[m.model_name] =
              (byChatterTotal[chatter].gesendet_pro_model[m.model_name] || 0) + 1
          }
        }
        if (m.model_name) {
          byModelTotal[m.model_name] = (byModelTotal[m.model_name] || 0) + 1
        }
      }
      result.chat_volumen = {
        hinweis: 'Nur Anzahl-Statistiken, keine Nachrichten-Texte. direction: in = von Chatter/Model an Bot, out = vom Dashboard an Chatter/Model.',
        nach_tag: byDay,
        nach_chatter_gesamt: byChatterTotal,
        nach_model_gesamt: byModelTotal,
        gesamt_anzahl: (msgs.data || []).length,
      }
      if (msgs.error) errors.chat_stats = msgs.error
    }

    // Errors mitloggen wenn welche da
    if (Object.keys(errors).length > 0) {
      result._fehler = errors
    }

    // Stats für die Vorschau
    const totalRev = (result.revenue?.model_snapshots || []).reduce((sum, s) =>
      sum + (s.rows || []).reduce((r, row) => r + (row.revenue || 0), 0), 0)

    setPreview({
      result,
      from, to,
      totalRevenue: totalRev,
      counts: {
        revenue_days: result.revenue?.model_snapshots?.length || 0,
        shifts: result.schichten?.einzelne_logs?.length || 0,
        schedule_entries: result.dienstplan?.flach?.length || 0,
        absences: result.abwesenheiten?.length || 0,
        swaps: result.schicht_tausche?.anfragen?.length || 0,
        content_reqs: result.content?.anfragen?.length || 0,
        content_ideas: result.content?.ideen?.length || 0,
        calendar: result.content_kalender?.length || 0,
        board_changes: result.model_boards?.aenderungen_im_zeitraum?.length || 0,
        notes: result.notizen?.length || 0,
        targets: result.revenue_ziele?.length || 0,
        chat_messages: result.chat_volumen?.gesamt_anzahl || 0,
        models: result.stammdaten?.models?.length || 0,
        chatters: result.stammdaten?.chatters?.length || 0,
      },
      errors,
    })
    setLoading(false)
  }

  const doExport = () => {
    if (!preview) return
    const filename = `thirteen87_export_${preview.from}_${preview.to}`
    if (format === 'json') {
      const blob = new Blob([JSON.stringify(preview.result, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = filename + '.json'
      a.click()
      URL.revokeObjectURL(a.href)
    } else {
      // CSV: Pro Datenkategorie einzelne Sektion (alles in einer Datei für Excel-Import)
      const lines = []
      const addSection = (title, rows) => {
        if (!rows || rows.length === 0) return
        lines.push('')
        lines.push(`## ${title}`)
        const keys = Object.keys(rows[0])
        lines.push(keys.join(','))
        for (const r of rows) {
          lines.push(keys.map(k => csvEscape(r[k])).join(','))
        }
      }
      // Revenue Models (flach gezogen)
      const revRows = []
      for (const snap of preview.result.revenue?.model_snapshots || []) {
        for (const row of snap.rows || []) {
          revRows.push({
            datum: snap.business_date,
            wochentag: ['So','Mo','Di','Mi','Do','Fr','Sa'][new Date(snap.business_date).getDay()],
            creator: row.creator || row.name || '',
            revenue: row.revenue || 0,
            message_revenue: row.messageRevenue || 0,
            subs: row.subs || 0,
            subs_revenue: row.subsRevenue || 0,
            tips_revenue: row.tipsRevenue || 0,
            new_subs_revenue: row.newSubsRevenue || 0,
            avg_spend: row.avgSpend || 0,
            avg_chat_value: row.avgChatValue || 0,
            selling_chats: row.sellingChats || 0,
          })
        }
      }
      addSection('Revenue_Models', revRows)
      // Chatter Snapshots flach
      const chatterRevRows = []
      for (const snap of preview.result.revenue?.chatter_snapshots || []) {
        for (const row of snap.rows || []) {
          chatterRevRows.push({ datum: snap.business_date, ...row })
        }
      }
      addSection('Revenue_Chatter', chatterRevRows)
      addSection('Schichten', preview.result.schichten?.einzelne_logs)
      addSection('Dienstplan', preview.result.dienstplan?.flach)
      addSection('Abwesenheiten', preview.result.abwesenheiten)
      addSection('Schicht_Tausche', preview.result.schicht_tausche?.anfragen)
      addSection('Content_Anfragen', preview.result.content?.anfragen)
      addSection('Content_Ideen', preview.result.content?.ideen)
      addSection('Content_Kalender', preview.result.content_kalender)
      addSection('Notizen', preview.result.notizen)
      addSection('Revenue_Ziele', preview.result.revenue_ziele)

      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = filename + '.csv'
      a.click()
      URL.revokeObjectURL(a.href)
    }
  }

  const csvEscape = (val) => {
    if (val === null || val === undefined) return ''
    let s = typeof val === 'object' ? JSON.stringify(val) : String(val)
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      s = '"' + s.replace(/"/g, '""') + '"'
    }
    return s
  }

  const toggleAll = (val) => setInclude(Object.fromEntries(CONTENT_ITEMS.map(i => [i.key, val])))

  const cardS = { background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '16px 18px' }
  const labelS = { fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 10 }
  const btnS = (active) => ({ fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, background: active ? 'rgba(124,58,237,0.2)' : 'transparent', color: active ? '#a78bfa' : 'var(--text-muted)', border: `1px solid ${active ? '#7c3aed' : 'var(--border)'}` })

  const selectedCount = Object.values(include).filter(v => v).length

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={labelS}>Inhalt ({selectedCount} von {CONTENT_ITEMS.length})</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => toggleAll(true)} style={btnS(false)}>Alle</button>
            <button onClick={() => toggleAll(false)} style={btnS(false)}>Keine</button>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {CONTENT_ITEMS.map(item => (
            <label key={item.key} onClick={() => setInclude(prev => ({ ...prev, [item.key]: !prev[item.key] }))} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '4px 0' }}>
              <div style={{ width: 16, height: 16, borderRadius: 4, border: `1px solid ${include[item.key] ? item.color : '#2e2e5a'}`, background: include[item.key] ? item.color + '33' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                {include[item.key] && <span style={{ color: item.color, fontSize: 10, fontWeight: 700 }}>✓</span>}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>{item.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{item.desc}</div>
              </div>
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
          {format === 'json'
            ? 'JSON enthält alle Daten strukturiert mit README – ideal für Claude oder ChatGPT.'
            : 'CSV enthält alle gewählten Kategorien als Sektionen (jeweils mit ## Überschrift) – ideal für Excel.'}
        </div>
        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', padding: 10, borderRadius: 6, fontSize: 12, marginBottom: 10 }}>
            ⚠ {error}
          </div>
        )}
        <button onClick={buildExport} disabled={loading} style={{ padding: '9px 24px', borderRadius: 8, background: '#7c3aed', color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1, fontFamily: 'inherit' }}>
          {loading ? '⏳ Lade Daten...' : '🔍 Vorschau erstellen'}
        </button>
      </div>

      {preview && (
        <div style={cardS}>
          <div style={labelS}>Vorschau</div>
          <div style={{ background: 'var(--bg-card2)', borderRadius: 8, border: '1px solid #1e1e3a', padding: '12px 14px', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.8, marginBottom: 14 }}>
            <span style={{ color: '#a78bfa' }}>thirteen87_export_{preview.from}_{preview.to}.{format}</span><br />
            <span style={{ color: 'var(--text-muted)' }}>Zeitraum: {preview.from} → {preview.to}</span><br /><br />
            {include.people && <><span style={{ color: '#7c3aed' }}>stammdaten</span><span style={{ color: 'var(--text-muted)' }}>: {preview.counts.models} Models, {preview.counts.chatters} Chatter</span><br /></>}
            {include.revenue && <><span style={{ color: '#10b981' }}>revenue</span><span style={{ color: 'var(--text-muted)' }}>: {preview.counts.revenue_days} Tage · ${preview.totalRevenue.toFixed(2)} Gesamt-Umsatz</span><br /></>}
            {include.shifts && <><span style={{ color: '#06b6d4' }}>schichten</span><span style={{ color: 'var(--text-muted)' }}>: {preview.counts.shifts} Logs</span><br /></>}
            {include.schedule && <><span style={{ color: '#a78bfa' }}>dienstplan</span><span style={{ color: 'var(--text-muted)' }}>: {preview.counts.schedule_entries} Zuordnungen</span><br /></>}
            {include.absences && <><span style={{ color: '#ef4444' }}>abwesenheiten</span><span style={{ color: 'var(--text-muted)' }}>: {preview.counts.absences}</span><br /></>}
            {include.swaps && <><span style={{ color: '#f59e0b' }}>tausche</span><span style={{ color: 'var(--text-muted)' }}>: {preview.counts.swaps}</span><br /></>}
            {include.content && <><span style={{ color: '#f59e0b' }}>content</span><span style={{ color: 'var(--text-muted)' }}>: {preview.counts.content_reqs} Anfragen, {preview.counts.content_ideas} Ideen</span><br /></>}
            {include.calendar && <><span style={{ color: '#a78bfa' }}>kalender</span><span style={{ color: 'var(--text-muted)' }}>: {preview.counts.calendar}</span><br /></>}
            {include.boards && <><span style={{ color: '#a78bfa' }}>boards</span><span style={{ color: 'var(--text-muted)' }}>: {preview.counts.board_changes} Änderungen</span><br /></>}
            {include.notes && <><span style={{ color: '#7c3aed' }}>notizen</span><span style={{ color: 'var(--text-muted)' }}>: {preview.counts.notes}</span><br /></>}
            {include.targets && <><span style={{ color: '#10b981' }}>ziele</span><span style={{ color: 'var(--text-muted)' }}>: {preview.counts.targets}</span><br /></>}
            {include.chat_stats && <><span style={{ color: '#06b6d4' }}>chat_volumen</span><span style={{ color: 'var(--text-muted)' }}>: {preview.counts.chat_messages} Nachrichten (nur Anzahl, keine Texte)</span><br /></>}
          </div>

          {Object.keys(preview.errors).length > 0 && (
            <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', padding: 10, borderRadius: 6, fontSize: 11, marginBottom: 12 }}>
              ⚠ Einige Daten konnten nicht geladen werden:<br />
              {Object.entries(preview.errors).map(([k, v]) => <div key={k}>• {k}: {v}</div>)}
            </div>
          )}

          <button onClick={doExport} style={{ padding: '9px 24px', borderRadius: 8, background: '#10b981', color: '#000', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            ↓ Herunterladen
          </button>
        </div>
      )}
    </div>
  )
}
