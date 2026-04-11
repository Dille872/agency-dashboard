import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { sendTelegramMessage } from '../telegram'

const CHRIS_TG = '1538601588'
const REY_TG = '528328429'
const ADMIN_TZ = 'Europe/Berlin'

// Convert time string "HH:MM" from Berlin to local browser timezone
function convertTimeToLocal(timeStr) {
  if (!timeStr) return timeStr
  // Parse "HH:MM-HH:MM" or "HH:MM"
  const parts = timeStr.split('-').map(t => t.trim())
  const converted = parts.map(t => {
    const [h, m] = t.split(':').map(Number)
    if (isNaN(h)) return t
    // Create a date in Berlin timezone
    const now = new Date()
    const berlinStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(h).padStart(2,'0')}:${String(m||0).padStart(2,'0')}:00`
    // Get offset difference
    const berlinOffset = getTimezoneOffset(berlinStr, ADMIN_TZ)
    const localOffset = getTimezoneOffset(berlinStr, Intl.DateTimeFormat().resolvedOptions().timeZone)
    const diffMins = localOffset - berlinOffset
    const totalMins = h * 60 + (m || 0) + diffMins
    const localH = ((Math.floor(totalMins / 60) % 24) + 24) % 24
    const localM = ((totalMins % 60) + 60) % 60
    return `${String(localH).padStart(2,'0')}:${String(localM).padStart(2,'0')}`
  })
  return converted.join('-')
}

function getTimezoneOffset(dateStr, tz) {
  try {
    const d = new Date(dateStr)
    const utcMs = d.getTime()
    const tzMs = new Date(d.toLocaleString('en-US', { timeZone: tz })).getTime()
    return Math.round((tzMs - utcMs) / 60000)
  } catch { return 0 }
}

const SHIFTS = ['Früh', 'Spät', 'Nacht']
const SHIFT_COLORS = { 'Früh': '#10b981', 'Spät': '#f59e0b', 'Nacht': '#7c3aed' }
const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

function getWeekStart(date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}
function getWeekDays(ws) {
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(ws); d.setDate(d.getDate() + i); return d })
}
function isoDate(date) { return date.toISOString().slice(0, 10) }
function formatDate(date) { return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) }
function isToday(date) { return isoDate(date) === isoDate(new Date()) }
function getKW(date) {
  const d = new Date(date)
  const onejan = new Date(d.getFullYear(), 0, 1)
  return Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7)
}

export default function ScheduleTab({ session }) {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()))
  const [models, setModels] = useState([])
  const [chatters, setChatters] = useState([])
  const [schedule, setSchedule] = useState({})
  const [recurring, setRecurring] = useState({}) // modelId__dayOfWeek__shift → {chatter, note}
  const [dayNotes, setDayNotes] = useState({})
  const [shiftTimes, setShiftTimes] = useState({})
  const [editingCell, setEditingCell] = useState(null)
  const [editingNote, setEditingNote] = useState(null)
  const [editingShiftTime, setEditingShiftTime] = useState(null)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [hasSavedData, setHasSavedData] = useState(false)
  const [conflictsOpen, setConflictsOpen] = useState(false)
  const [reminderCell, setReminderCell] = useState(null)
  const [sendingReminder, setSendingReminder] = useState(false)
  const [activeReminders, setActiveReminders] = useState({}) // cellKey → true
  const [absences, setAbsences] = useState([]) // [{id, chatter_name, date_from, date_to, reason}]
  const [showAbsences, setShowAbsences] = useState(false)
  const [newAbsenceName, setNewAbsenceName] = useState('')
  const [newAbsenceFrom, setNewAbsenceFrom] = useState('')
  const [newAbsenceTo, setNewAbsenceTo] = useState('')
  const [newAbsenceReason, setNewAbsenceReason] = useState('')
  const [scheduleStatus, setScheduleStatus] = useState('draft')
  const [publishing, setPublishing] = useState(false)

  const weekDays = getWeekDays(weekStart)
  const weekKey = isoDate(weekStart)
  const kw = getKW(weekStart)

  useEffect(() => { loadModels(); loadChatters(); loadRecurring(); checkShiftAlerts(); loadAbsences(); loadActiveReminders() }, [])
  useEffect(() => { if (weekKey) loadSchedule() }, [weekKey])

  const loadAbsences = async () => {
    const { data } = await supabase.from('absences').select('*').order('date_from')
    setAbsences(data || [])
  }

  const loadActiveReminders = async () => {
    const { data } = await supabase.from('reminders').select('shift_date, shift, chatter_name').eq('sent', false)
    const map = {}
    for (const r of data || []) {
      map[`${r.chatter_name}__${r.shift_date}__${r.shift}`] = true
    }
    setActiveReminders(map)
  }

  const addAbsence = async () => {
    if (!newAbsenceName || !newAbsenceFrom || !newAbsenceTo) return
    await supabase.from('absences').insert({
      chatter_name: newAbsenceName,
      date_from: newAbsenceFrom,
      date_to: newAbsenceTo,
      reason: newAbsenceReason || 'Abwesend',
    })
    setNewAbsenceName(''); setNewAbsenceFrom(''); setNewAbsenceTo(''); setNewAbsenceReason('')
    loadAbsences()
  }

  const deleteAbsence = async (id) => {
    await supabase.from('absences').delete().eq('id', id)
    loadAbsences()
  }

  const isAbsent = (chatterName, dayIso) => {
    return absences.some(a => a.chatter_name === chatterName && dayIso >= a.date_from && dayIso <= a.date_to)
  }

  const checkShiftAlerts = async () => {
    // Check every 5 minutes if a shift started 15 min ago and chatter is not online
    const now = new Date()
    const todayIso = now.toISOString().slice(0, 10)
    const currentHour = now.getHours()
    const currentMin = now.getMinutes()

    // Load today's schedule
    const weekS = getWeekStart(now)
    const { data: schedData } = await supabase.from('schedule').select('*').eq('week_start', isoDate(weekS)).single()
    if (!schedData) return

    // Load online statuses
    const { data: onlineData } = await supabase.from('online_status').select('*')
    const onlineMap = {}
    const cutoff = new Date(Date.now() - 60000)
    for (const s of onlineData || []) {
      if (new Date(s.last_seen) > cutoff) onlineMap[s.display_name] = s.shift_online
    }

    // Load shift times
    const shiftTimesData = schedData.shift_times || {}
    const assignments = schedData.assignments || {}

    // Get all chatters scheduled today
    const alerted = new Set()
    for (const [key, val] of Object.entries(assignments)) {
      const parts = key.split('__')
      if (parts[1] !== todayIso || !val.chatter) continue
      const chatterName = val.chatter
      if (alerted.has(chatterName)) continue

      // Find shift start time
      const modelId = parts[0]
      const shift = parts[2]
      const timeStr = (shiftTimesData[`${modelId}__${shift}`] || '').replace(' (DE)', '').replace('(DE)', '')
      if (!timeStr) continue

      // Parse time like "08:00-14:00" or "08:00"
      const startTime = timeStr.split('-')[0].trim()
      const [shiftHour, shiftMin] = startTime.split(':').map(Number)
      if (isNaN(shiftHour)) continue

      // Check if 15 minutes after shift start
      const shiftStartMins = shiftHour * 60 + shiftMin
      const nowMins = currentHour * 60 + currentMin
      if (nowMins >= shiftStartMins + 15 && nowMins < shiftStartMins + 20) {
        // Shift started 15-20 min ago
        if (!onlineMap[chatterName]) {
          alerted.add(chatterName)
          const msg = `⚠️ ${chatterName} hat ${shift}schicht aber ist noch nicht online! (${startTime} Uhr)`
          await sendTelegramMessage(CHRIS_TG, msg)
          await sendTelegramMessage(REY_TG, msg)
        }
      }
    }
  }

  const loadModels = async () => {
    const { data } = await supabase.from('models_contact').select('*').order('name')
    setModels(data || [])
  }
  const loadChatters = async () => {
    const { data } = await supabase.from('chatters_contact').select('*').order('name')
    setChatters(data || [])
  }
  const loadRecurring = async () => {
    const { data } = await supabase.from('recurring_shifts').select('*')
    const map = {}
    for (const r of data || []) map[r.shift_key] = { chatter: r.chatter, note: r.note }
    setRecurring(map)
  }

  const loadSchedule = async () => {
    const { data } = await supabase.from('schedule').select('*').eq('week_start', weekKey)
    if (data && data.length > 0) {
      const rawTimes = data[0].shift_times || {}
      const cleanTimes = {}
      for (const [k, v] of Object.entries(rawTimes)) {
        cleanTimes[k] = String(v).replace(' (DE)', '').replace('(DE)', '')
      }
      setSchedule(data[0].assignments || {})
      setDayNotes(data[0].day_notes || {})
      setShiftTimes(cleanTimes)
      setScheduleStatus(data[0].status || 'draft')
      setHasSavedData(true)
    } else {
      // Auto-fill from recurring shifts
      const autoSchedule = {}
      for (const day of weekDays) {
        const dayOfWeek = day.getDay() === 0 ? 6 : day.getDay() - 1 // 0=Mo..6=So
        for (const [key, val] of Object.entries(recurring)) {
          const parts = key.split('__')
          if (parseInt(parts[1]) === dayOfWeek) {
            autoSchedule[`${parts[0]}__${isoDate(day)}__${parts[2]}`] = { ...val, isRecurring: true }
          }
        }
      }
      setSchedule(autoSchedule)
      setDayNotes({})
      setShiftTimes({})
      setHasSavedData(false)
    }
  }

  const saveSchedule = async () => {
    setSaving(true)
    const { data: existing } = await supabase.from('schedule').select('id').eq('week_start', weekKey).single()
    if (existing) {
      await supabase.from('schedule').update({ assignments: schedule, day_notes: dayNotes, shift_times: shiftTimes }).eq('week_start', weekKey)
    } else {
      await supabase.from('schedule').insert({ week_start: weekKey, assignments: schedule, day_notes: dayNotes, shift_times: shiftTimes, status: 'draft' })
    }
    setHasSavedData(true)
    setSaving(false)
  }

  const togglePublish = async () => {
    setPublishing(true)
    const newStatus = scheduleStatus === 'live' ? 'draft' : 'live'
    const { data: existing } = await supabase.from('schedule').select('id').eq('week_start', weekKey).single()
    if (existing) {
      await supabase.from('schedule').update({ status: newStatus, assignments: schedule, day_notes: dayNotes, shift_times: shiftTimes }).eq('week_start', weekKey)
    } else {
      await supabase.from('schedule').insert({ week_start: weekKey, assignments: schedule, day_notes: dayNotes, shift_times: shiftTimes, status: newStatus })
    }
    setScheduleStatus(newStatus)
    setHasSavedData(true)
    setPublishing(false)
  }

  const getCellKey = (modelId, dayIso, shift) => `${modelId}__${dayIso}__${shift}`
  const getRecurringKey = (modelId, dayOfWeek, shift) => `${modelId}__${dayOfWeek}__${shift}`

  const setCell = (modelId, dayIso, shift, value) => {
    const key = getCellKey(modelId, dayIso, shift)
    setSchedule(prev => ({ ...prev, [key]: value }))
  }

  const getCell = (modelId, dayIso, shift) => {
    return schedule[getCellKey(modelId, dayIso, shift)] || { chatter: '', note: '' }
  }

  const saveRecurring = async (modelId, dayOfWeek, shift, value) => {
    const key = getRecurringKey(modelId, dayOfWeek, shift)
    if (!value.chatter) {
      // Delete recurring
      await supabase.from('recurring_shifts').delete().eq('shift_key', key)
      setRecurring(prev => { const n = { ...prev }; delete n[key]; return n })
    } else {
      await supabase.from('recurring_shifts').upsert({ shift_key: key, model_id: modelId, day_of_week: dayOfWeek, shift, chatter: value.chatter, note: value.note || '' }, { onConflict: 'shift_key' })
      setRecurring(prev => ({ ...prev, [key]: { chatter: value.chatter, note: value.note || '' } }))
    }
  }

  const sendReminder = async (modelId, dayIso, shift, chatterName, hoursBeforeStr) => {
    const hoursBefore = parseInt(hoursBeforeStr)
    setSendingReminder(true)
    const chatter = chatters.find(c => c.name === chatterName)
    if (!chatter?.telegram_id) {
      alert(`Kein Telegram für ${chatterName}`)
      setSendingReminder(false)
      setReminderCell(null)
      return
    }
    const model = models.find(m => String(m.id) === String(modelId))
    const modelName = model?.name || 'Unbekannt'
    const berlinTime = (shiftTimes[`${modelId}__${shift}`] || '').replace(' (DE)', '').replace('(DE)', '')
    const startTime = berlinTime ? berlinTime.split('-')[0].trim() : ''

    // Calculate send_at: shift start time minus hoursBefore
    // Berlin is UTC+2 in summer (CEST), UTC+1 in winter (CET)
    let sendAt
    if (startTime) {
      const [h, m] = startTime.split(':').map(Number)
      // Get Berlin offset for this specific date
      const testDate = new Date(`${dayIso}T12:00:00Z`)
      const berlinFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hour: 'numeric', hour12: false })
      const utcFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', hour12: false })
      const berlinHour = parseInt(berlinFormatter.format(testDate))
      const utcHour = parseInt(utcFormatter.format(testDate))
      const berlinOffsetHours = berlinHour - utcHour // e.g. +2 for CEST
      // Shift time in UTC = shift time in Berlin minus offset
      const shiftUtcHour = h - berlinOffsetHours
      const shiftUtc = new Date(`${dayIso}T${String(((shiftUtcHour % 24) + 24) % 24).padStart(2,'0')}:${String(m||0).padStart(2,'0')}:00Z`)
      sendAt = new Date(shiftUtc.getTime() - hoursBefore * 3600000).toISOString()
    } else {
      sendAt = new Date(Date.now() + hoursBefore * 3600000).toISOString()
    }

    await supabase.from('reminders').insert({
      chatter_name: chatterName,
      chatter_telegram_id: chatter.telegram_id,
      model_name: modelName,
      shift,
      shift_date: reminderCell.dayIso,
      shift_start_time: startTime || '?',
      send_at: sendAt,
      sent: false,
    })

    // Mark reminder as active in UI
    setActiveReminders(prev => ({ ...prev, [`${chatterName}__${reminderCell.dayIso}__${shift}`]: true }))

    setSendingReminder(false)
    setReminderCell(null)
    alert(`✓ Erinnerung eingestellt – ${chatterName} wird ${hoursBefore} Stunde${hoursBefore !== 1 ? 'n' : ''} vorher benachrichtigt`)
  }

  // Conflict detection
  const conflicts = []
  for (const model of models) {
    for (const day of weekDays) {
      const dayIso = isoDate(day)
      for (const shift of SHIFTS) {
        const cell = getCell(model.id, dayIso, shift)
        if (!cell.chatter) conflicts.push({ type: 'unbesetzt', msg: `${model.name} · ${DAYS[weekDays.indexOf(day)]} ${formatDate(day)} · ${shift}`, dayIso, shift, modelId: model.id })
      }
    }
  }
  for (const day of weekDays) {
    const dayIso = isoDate(day)
    for (const shift of SHIFTS) {
      const chatterCount = {}
      for (const model of models) {
        const cell = getCell(model.id, dayIso, shift)
        if (cell.chatter) chatterCount[cell.chatter] = (chatterCount[cell.chatter] || 0) + 1
      }
      for (const [name, count] of Object.entries(chatterCount)) {
        if (count >= 4) conflicts.push({ type: 'ueberlastet', msg: `${name} hat ${count} Models am ${DAYS[weekDays.indexOf(day)]} ${formatDate(day)} · ${shift}`, dayIso, shift })
      }
    }
  }

  const sendPlanToAll = async () => {
    setSending(true)
    for (const chatter of chatters) {
      if (!chatter.telegram_id) continue
      const lines = [`📋 Dienstplan KW ${kw} (${formatDate(weekDays[0])} – ${formatDate(weekDays[6])})\n`]
      for (const day of weekDays) {
        const dayIso = isoDate(day)
        const dayNote = dayNotes[dayIso]
        const dayShifts = []
        for (const shift of SHIFTS) {
          for (const model of models) {
            const cell = getCell(model.id, dayIso, shift)
            if (cell.chatter === chatter.name) {
              const berlinTime = (shiftTimes[`${model.id}__${shift}`] || '').replace(' (DE)', '').replace('(DE)', '')
              const localTime = berlinTime ? convertTimeToLocal(berlinTime) : ''
              const timeDisplay = localTime ? ` (${localTime} Ortszeit)` : ''
              dayShifts.push(`  ${shift}${timeDisplay}: ${model.name}${cell.note ? ` – ${cell.note}` : ''}`)
            }
          }
        }
        if (dayShifts.length > 0) {
          lines.push(`${DAYS[weekDays.indexOf(day)]} ${formatDate(day)}${dayNote ? ` ⚠ ${dayNote}` : ''}`)
          lines.push(...dayShifts)
          lines.push('')
        }
      }
      if (lines.length > 1) await sendTelegramMessage(chatter.telegram_id, lines.join('\n'))
    }
    setSending(false)
    alert('✓ Dienstplan versendet!')
  }

  const prevWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d) }
  const nextWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d) }

  const cellStyleBase = (dayIso) => ({
    border: `1px solid ${weekDays.some(d => isoDate(d) === dayIso && isToday(d)) ? 'rgba(124,58,237,0.2)' : 'var(--border)'}`,
    background: weekDays.some(d => isoDate(d) === dayIso && isToday(d)) ? 'rgba(124,58,237,0.04)' : 'transparent',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={prevWeek} style={{ background: 'var(--bg-card)', border: '1px solid #1e1e3a', color: 'var(--text-secondary)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 14 }}>‹</button>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
            KW {kw} · {formatDate(weekDays[0])} – {formatDate(weekDays[6])} {weekDays[0].getFullYear()}
          </span>
          <button onClick={nextWeek} style={{ background: 'var(--bg-card)', border: '1px solid #1e1e3a', color: 'var(--text-secondary)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 14 }}>›</button>
          {/* Status Badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, background: scheduleStatus === 'live' ? 'rgba(16,185,129,0.12)' : 'rgba(100,100,120,0.12)', border: `1px solid ${scheduleStatus === 'live' ? 'rgba(16,185,129,0.3)' : 'rgba(100,100,120,0.3)'}` }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: scheduleStatus === 'live' ? '#10b981' : '#888', display: 'inline-block' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: scheduleStatus === 'live' ? '#10b981' : 'var(--text-muted)' }}>
              {scheduleStatus === 'live' ? 'Live' : 'Entwurf'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={sendPlanToAll} disabled={sending} style={{ background: 'rgba(6,182,212,0.12)', color: '#06b6d4', border: '1px solid rgba(6,182,212,0.3)', borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            {sending ? 'Sende...' : '✈ Plan versenden'}
          </button>
          <button onClick={togglePublish} disabled={publishing} style={{
            background: scheduleStatus === 'live' ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
            color: scheduleStatus === 'live' ? '#ef4444' : '#10b981',
            border: `1px solid ${scheduleStatus === 'live' ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}`,
            borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
          }}>
            {publishing ? '...' : scheduleStatus === 'live' ? '⏸ Entwurf' : '▶ Veröffentlichen'}
          </button>
          <button onClick={saveSchedule} disabled={saving} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </div>

      {/* Schedule Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 700, width: '100%' }}>
          <thead>
            <tr>
              <th style={{ background: 'var(--bg-input)', border: '1px solid #1e1e3a', padding: '8px 12px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, minWidth: 130 }}>Model / Schicht</th>
              {weekDays.map((day, di) => (
                <th key={di} style={{
                  background: isToday(day) ? 'rgba(124,58,237,0.15)' : 'var(--bg-card)',
                  border: `1px solid ${isToday(day) ? 'rgba(124,58,237,0.3)' : 'var(--border)'}`,
                  padding: '6px 8px', textAlign: 'center', fontSize: 11,
                  color: isToday(day) ? '#a78bfa' : 'var(--text-muted)', fontWeight: 700, whiteSpace: 'nowrap', minWidth: 90,
                }}>
                  {DAYS[di]} {formatDate(day)}{isToday(day) ? ' ●' : ''}
                </th>
              ))}
            </tr>
            <tr>
              <td style={{ background: 'var(--bg-input)', border: '1px solid #1e1e3a', padding: '4px 12px', fontSize: 10, color: 'var(--text-muted)' }}>Tages-Notiz</td>
              {weekDays.map((day, di) => {
                const dayIso = isoDate(day)
                return (
                  <td key={di} style={{ ...cellStyleBase(dayIso), padding: '4px 6px', cursor: 'text', border: '1px solid #1e1e3a' }}
                    onClick={() => setEditingNote(editingNote === dayIso ? null : dayIso)}>
                    {editingNote === dayIso ? (
                      <input autoFocus value={dayNotes[dayIso] || ''}
                        onChange={e => setDayNotes(prev => ({ ...prev, [dayIso]: e.target.value }))}
                        onBlur={() => setEditingNote(null)}
                        onKeyDown={e => e.key === 'Enter' && setEditingNote(null)}
                        style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #7c3aed', color: '#f59e0b', padding: '2px 4px', borderRadius: 4, fontSize: 10, fontFamily: 'inherit', outline: 'none' }}
                      />
                    ) : (
                      <span style={{ color: dayNotes[dayIso] ? '#f59e0b' : 'var(--border-bright)', fontSize: 10 }}>{dayNotes[dayIso] || '+ Notiz'}</span>
                    )}
                  </td>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {models.map((model, mi) => (
              <React.Fragment key={model.id}>
                {SHIFTS.map((shift, si) => (
                  <tr key={shift}>
                    {si === 0 && (
                      <td rowSpan={3} style={{ background: 'var(--bg-input)', border: '1px solid #1e1e3a', borderLeft: '3px solid #7c3aed', padding: '8px 10px', verticalAlign: 'middle' }}>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 12, marginBottom: 5 }}>{model.name}</div>
                        {SHIFTS.map(s => (
                          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                            <span style={{ width: 6, height: 6, borderRadius: 2, background: SHIFT_COLORS[s], flexShrink: 0, display: 'inline-block' }} />
                            {editingShiftTime === `${model.id}__${s}` ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }} onClick={e => e.stopPropagation()}>
                                <input type="time"
                                  value={shiftTimes[`${model.id}__${s}`]?.split('-')[0]?.trim().replace(' (DE)','') || ''}
                                  onChange={e => {
                                    const end = shiftTimes[`${model.id}__${s}`]?.split('-')[1]?.trim().replace(' (DE)','') || ''
                                    setShiftTimes(prev => ({ ...prev, [`${model.id}__${s}`]: `${e.target.value}-${end}` }))
                                  }}
                                  style={{ width: 70, background: 'var(--bg-input)', border: '1px solid #7c3aed', color: 'var(--text-primary)', padding: '1px 2px', borderRadius: 3, fontSize: 9, fontFamily: 'monospace', outline: 'none' }}
                                />
                                <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>–</span>
                                <input type="time"
                                  value={shiftTimes[`${model.id}__${s}`]?.split('-')[1]?.trim().replace(' (DE)','') || ''}
                                  onChange={e => {
                                    const start = shiftTimes[`${model.id}__${s}`]?.split('-')[0]?.trim().replace(' (DE)','') || ''
                                    setShiftTimes(prev => ({ ...prev, [`${model.id}__${s}`]: `${start}-${e.target.value}` }))
                                  }}
                                  onBlur={() => setEditingShiftTime(null)}
                                  style={{ width: 70, background: 'var(--bg-input)', border: '1px solid #7c3aed', color: 'var(--text-primary)', padding: '1px 2px', borderRadius: 3, fontSize: 9, fontFamily: 'monospace', outline: 'none' }}
                                />
                              </div>
                            ) : (
                              <span onClick={() => setEditingShiftTime(`${model.id}__${s}`)}
                                style={{ fontSize: 9, color: shiftTimes[`${model.id}__${s}`] ? 'var(--text-secondary)' : 'var(--border-bright)', cursor: 'text', fontFamily: 'monospace' }}>
                                {shiftTimes[`${model.id}__${s}`] ? `${shiftTimes[`${model.id}__${s}`].replace(' (DE)','')} (DE)` : `${s} +Zeit`}
                              </span>
                            )}
                          </div>
                        ))}
                      </td>
                    )}
                    {weekDays.map((day, di) => {
                      const dayIso = isoDate(day)
                      const cell = getCell(model.id, dayIso, shift)
                      const cellId = getCellKey(model.id, dayIso, shift)
                      const isEditing = editingCell === cellId
                      const hasConflict = conflicts.some(c => c.type === 'unbesetzt' && c.modelId === model.id && c.dayIso === dayIso && c.shift === shift)
                      const dayOfWeek = day.getDay() === 0 ? 6 : day.getDay() - 1
                      const recurringKey = getRecurringKey(model.id, dayOfWeek, shift)
                      const isRecurring = !!recurring[recurringKey]

                      const isChatterAbsent = cell.chatter ? isAbsent(cell.chatter, dayIso) : false

                      return (
                        <td key={di} onClick={() => setEditingCell(isEditing ? null : cellId)} style={{
                          border: `1px solid ${isChatterAbsent ? 'rgba(239,68,68,0.5)' : hasConflict ? 'rgba(239,68,68,0.3)' : isToday(day) ? 'rgba(124,58,237,0.2)' : 'var(--border)'}`,
                          background: isChatterAbsent ? 'rgba(239,68,68,0.08)' : hasConflict ? 'rgba(239,68,68,0.05)' : isToday(day) ? 'rgba(124,58,237,0.04)' : 'transparent',
                          padding: '5px 6px', textAlign: 'center', cursor: 'pointer',
                          borderLeft: `2px solid ${SHIFT_COLORS[shift]}`,
                          minWidth: 90, verticalAlign: 'middle',
                        }}>
                          {isEditing ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} onClick={e => e.stopPropagation()}>
                              <select autoFocus value={cell.chatter || ''}
                                onChange={e => setCell(model.id, dayIso, shift, { ...cell, chatter: e.target.value })}
                                style={{ background: 'var(--bg-input)', border: '1px solid #7c3aed', color: 'var(--text-primary)', padding: '2px 4px', borderRadius: 4, fontSize: 11, fontFamily: 'inherit', outline: 'none', width: '100%' }}>
                                <option value="">— leer —</option>
                                {chatters.map(c => {
                                  const absent = isAbsent(c.name, dayIso)
                                  return <option key={c.id} value={c.name} disabled={absent} style={{ color: absent ? '#4a4a6a' : 'inherit' }}>{c.name}{absent ? ' (abwesend)' : ''}</option>
                                })}
                              </select>
                              <input value={cell.note || ''}
                                onChange={e => setCell(model.id, dayIso, shift, { ...cell, note: e.target.value })}
                                placeholder="Notiz (optional)"
                                onKeyDown={e => e.key === 'Enter' && setEditingCell(null)}
                                style={{ background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: '#f59e0b', padding: '2px 4px', borderRadius: 4, fontSize: 10, fontFamily: 'inherit', outline: 'none', width: '100%' }}
                              />
                              {/* Recurring toggle */}
                              <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 10 }} onClick={e => e.stopPropagation()}>
                                <input type="checkbox" checked={isRecurring}
                                  onChange={async e => {
                                    if (e.target.checked && cell.chatter) {
                                      await saveRecurring(model.id, dayOfWeek, shift, cell)
                                    } else {
                                      await saveRecurring(model.id, dayOfWeek, shift, { chatter: '' })
                                    }
                                  }}
                                  style={{ accentColor: '#7c3aed' }}
                                />
                                <span style={{ color: isRecurring ? '#a78bfa' : 'var(--text-muted)' }}>
                                  {isRecurring ? '↻ Wöchentlich (aktiv)' : '↻ Wöchentlich wiederholen'}
                                </span>
                              </label>
                              <button onClick={() => setEditingCell(null)} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 3, padding: '3px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>✓ Fertig</button>
                            </div>
                          ) : cell.chatter ? (
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>{cell.chatter}</div>
                              <div style={{ display: 'flex', gap: 4, marginTop: 1 }}>
                                {isRecurring && <span style={{ fontSize: 8, color: '#a78bfa' }}>↻</span>}
                                {activeReminders[`${cell.chatter}__${dayIso}__${shift}`] && <span style={{ fontSize: 8, color: '#06b6d4' }}>🔔</span>}
                              </div>
                              {cell.note && <div style={{ fontSize: 9, color: '#f59e0b', marginTop: 1 }}>{cell.note}</div>}
                              {/* Reminder button */}
                              {reminderCell?.cellId === cellId ? (
                                <div onClick={e => e.stopPropagation()} style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
                                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 2 }}>Erinnerung senden:</div>
                                  {['1', '3', '12', '24'].map(h => (
                                    <button key={h} onClick={() => sendReminder(reminderCell.modelId, reminderCell.dayIso, reminderCell.shift, reminderCell.chatterName, h)}
                                      disabled={sendingReminder}
                                      style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(6,182,212,0.12)', color: '#06b6d4', border: '1px solid rgba(6,182,212,0.3)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                                      {h}h vorher
                                    </button>
                                  ))}
                                  <button onClick={e => { e.stopPropagation(); setReminderCell(null) }}
                                    style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>
                                    Abbrechen
                                  </button>
                                </div>
                              ) : (
                                <button onClick={e => { e.stopPropagation(); setReminderCell({ cellId, modelId: model.id, dayIso, shift, chatterName: cell.chatter }) }}
                                  style={{ marginTop: 3, fontSize: 9, padding: '1px 5px', borderRadius: 4, background: 'transparent', color: activeReminders[`${cell.chatter}__${dayIso}__${shift}`] ? '#06b6d4' : 'var(--text-muted)', border: `1px solid ${activeReminders[`${cell.chatter}__${dayIso}__${shift}`] ? '#06b6d4' : 'var(--border)'}`, cursor: 'pointer', fontFamily: 'inherit' }}>
                                  🔔
                                </button>
                              )}
                            </div>
                          ) : (
                            <span style={{ fontSize: 10, color: hasConflict ? 'rgba(239,68,68,0.5)' : 'var(--border-bright)' }}>
                              {hasConflict ? '⚠ leer' : '+ eintragen'}
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {mi < models.length - 1 && (
                  <tr><td colSpan={9} style={{ height: 6, background: 'var(--bg-base)', border: 'none' }} /></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Conflicts below – einklappbar */}
      {hasSavedData && conflicts.length > 0 && (
        <div style={{ border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, overflow: 'hidden' }}>
          <div onClick={() => setConflictsOpen(!conflictsOpen)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'rgba(239,68,68,0.06)', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#ef4444' }}>⚠ Konflikte gefunden</span>
              <span style={{ fontSize: 10, background: 'rgba(239,68,68,0.2)', color: '#ef4444', padding: '1px 8px', borderRadius: 10, fontWeight: 700 }}>{conflicts.length}</span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{conflictsOpen ? '▲ zuklappen' : '▼ aufklappen'}</span>
          </div>
          {conflictsOpen && (
            <div style={{ padding: '10px 16px', background: 'rgba(239,68,68,0.03)', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {conflicts.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                  <span style={{ padding: '1px 7px', borderRadius: 4, fontWeight: 700, fontSize: 10, background: c.type === 'unbesetzt' ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)', color: c.type === 'unbesetzt' ? '#f59e0b' : '#ef4444' }}>
                    {c.type === 'unbesetzt' ? 'Unbesetzt' : 'Überlastet'}
                  </span>
                  <span style={{ color: 'var(--text-secondary)' }}>{c.msg}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {hasSavedData && conflicts.length === 0 && Object.keys(schedule).length > 0 && (
        <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 10, padding: '10px 16px', fontSize: 12, color: '#10b981', fontWeight: 600 }}>
          ✓ Keine Konflikte – Plan ist vollständig
        </div>
      )}

      {/* Absence Panel */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <div onClick={() => setShowAbsences(!showAbsences)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', cursor: 'pointer', background: 'var(--bg-card2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>🚫 Abwesenheiten</span>
            {absences.length > 0 && <span style={{ fontSize: 10, background: 'rgba(239,68,68,0.15)', color: '#ef4444', padding: '1px 7px', borderRadius: 10, fontWeight: 700 }}>{absences.length}</span>}
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{showAbsences ? '▲' : '▼'}</span>
        </div>
        {showAbsences && (
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Chatter</label>
                <select value={newAbsenceName} onChange={e => setNewAbsenceName(e.target.value)}
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border-bright)', color: 'var(--text-primary)', padding: '6px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}>
                  <option value="">— wählen —</option>
                  {chatters.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Von</label>
                <input type="date" value={newAbsenceFrom} onChange={e => setNewAbsenceFrom(e.target.value)}
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border-bright)', color: 'var(--text-primary)', padding: '6px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'monospace', outline: 'none' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Bis</label>
                <input type="date" value={newAbsenceTo} onChange={e => setNewAbsenceTo(e.target.value)}
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border-bright)', color: 'var(--text-primary)', padding: '6px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'monospace', outline: 'none' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 120 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Grund (optional)</label>
                <input value={newAbsenceReason} onChange={e => setNewAbsenceReason(e.target.value)}
                  placeholder="z.B. Urlaub, Krank..."
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border-bright)', color: 'var(--text-primary)', padding: '6px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none' }} />
              </div>
              <button onClick={addAbsence} disabled={!newAbsenceName || !newAbsenceFrom || !newAbsenceTo}
                style={{ background: newAbsenceName && newAbsenceFrom && newAbsenceTo ? '#ef4444' : 'var(--border)', color: newAbsenceName && newAbsenceFrom && newAbsenceTo ? '#fff' : 'var(--text-muted)', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                + Eintragen
              </button>
            </div>
            {absences.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Keine Abwesenheiten eingetragen</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {absences.map(a => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-card2)', borderRadius: 8, borderLeft: '3px solid #ef4444' }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#ef4444' }}>{a.chatter_name}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {new Date(a.date_from + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} – {new Date(a.date_to + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
                      </span>
                      {a.reason && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{a.reason}</span>}
                    </div>
                    <button onClick={() => deleteAbsence(a.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}
                      onMouseEnter={e => e.target.style.color = '#ef4444'}
                      onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Legend + Recurring + Next week */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--text-secondary)', flexWrap: 'wrap', alignItems: 'center' }}>
          {SHIFTS.map(s => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: SHIFT_COLORS[s] }} />{s}
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ color: '#a78bfa', fontSize: 12 }}>↻</span> Wiederkehrend
          </div>
          <span style={{ color: 'var(--text-muted)' }}>· Klick auf Zelle zum Bearbeiten</span>
        </div>
        <button onClick={async () => {
          if (!window.confirm(`Plan auf KW ${kw + 1} übertragen?`)) return
          const next = new Date(weekStart); next.setDate(next.getDate() + 7)
          const nextKey = isoDate(next)
          const newA = {}
          for (const [key, val] of Object.entries(schedule)) {
            const parts = key.split('__')
            const d = new Date(parts[1] + 'T00:00:00'); d.setDate(d.getDate() + 7)
            newA[`${parts[0]}__${isoDate(d)}__${parts[2]}`] = val
          }
          const { data: ex } = await supabase.from('schedule').select('id').eq('week_start', nextKey).single()
          if (ex) await supabase.from('schedule').update({ assignments: newA, shift_times: shiftTimes }).eq('week_start', nextKey)
          else await supabase.from('schedule').insert({ week_start: nextKey, assignments: newA, shift_times: shiftTimes })
          setWeekStart(next)
          alert(`✓ Plan auf KW ${kw + 1} übertragen!`)
        }} style={{ background: 'rgba(124,58,237,0.12)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          ↻ Als Vorlage für nächste Woche
        </button>
      </div>
    </div>
  )
}
