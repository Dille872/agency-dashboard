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

  // Auto-save after 2 seconds of inactivity
  useEffect(() => {
    if (!weekKey) return
    const timer = setTimeout(() => { saveSchedule() }, 2000)
    return () => clearTimeout(timer)
  }, [schedule, dayNotes, shiftTimes])

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
    const todayIso = isoDate(now)
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
      const row = data[0]
      const rawTimes = row.shift_times || {}
      const cleanTimes = {}
      for (const [k, v] of Object.entries(rawTimes)) {
        cleanTimes[k] = String(v).replace(' (DE)', '').replace('(DE)', '')
      }
      setSchedule(row.assignments || {})
      setDayNotes(row.day_notes || {})
      setShiftTimes(cleanTimes)
      setScheduleStatus(row.status || 'draft')
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

  const [autoPlanning, setAutoPlanning] = useState(false)

  const autoGeneratePlan = async () => {
    setAutoPlanning(true)
    // Load availabilities and absences
    const { data: availData } = await supabase.from('chatter_availability').select('*')
    const { data: absData } = await supabase.from('absences').select('*')

    // Build availability map: chatterName → [{day_of_week, time_from, time_to}]
    const availMap = {}
    for (const a of availData || []) {
      if (!availMap[a.chatter_name]) availMap[a.chatter_name] = []
      availMap[a.chatter_name].push(a)
    }

    const newSchedule = { ...schedule }

    for (const day of weekDays) {
      const dayIso = isoDate(day)
      const dayOfWeek = day.getDay() === 0 ? 6 : day.getDay() - 1 // 0=Mo..6=So

      for (const model of models) {
        for (const shift of SHIFTS) {
          const cellKey = getCellKey(model.id, dayIso, shift)
          // Skip if already filled
          if (newSchedule[cellKey]?.chatter) continue

          // Check recurring first
          const recurringKey = getRecurringKey(model.id, dayOfWeek, shift)
          if (recurring[recurringKey]?.chatter) {
            const chatterName = recurring[recurringKey].chatter
            // Check not absent
            const isAbsent = (absData || []).some(a => a.chatter_name === chatterName && dayIso >= a.date_from && dayIso <= a.date_to)
            if (!isAbsent) {
              newSchedule[cellKey] = { chatter: chatterName, note: recurring[recurringKey].note || '', isRecurring: true }
              continue
            }
          }

          // Find available chatter based on shift time and availability profile
          const timeStr = (shiftTimes[`${model.id}__${shift}`] || '').replace(/\s*\(DE\)/g, '')
          const shiftStart = timeStr ? timeStr.split('-')[0].trim() : null
          const shiftEnd = timeStr ? timeStr.split('-')[1]?.trim() : null

          const candidates = chatters.filter(c => {
            // Check not absent
            const absent = (absData || []).some(a => a.chatter_name === c.name && dayIso >= a.date_from && dayIso <= a.date_to)
            if (absent) return false
            // Check availability profile
            const avails = availMap[c.name] || []
            if (avails.length === 0) return true // No restrictions = always available
            return avails.some(a => {
              if (a.day_of_week !== dayOfWeek) return false
              if (!shiftStart) return true
              // Check time overlap
              return shiftStart >= a.time_from && (!shiftEnd || shiftEnd <= a.time_to)
            })
          })

          // Check not already double-booked this day/shift
          const alreadyBooked = new Set(
            Object.entries(newSchedule)
              .filter(([k, v]) => k.includes(`__${dayIso}__${shift}`) && v.chatter)
              .map(([_, v]) => v.chatter)
          )
          const available = candidates.filter(c => !alreadyBooked.has(c.name))

          if (available.length > 0) {
            // Pick the one with fewest shifts this week
            const shiftCounts = {}
            for (const [k, v] of Object.entries(newSchedule)) {
              if (k.includes(`__${dayIso.slice(0, 7)}`)) {
                if (v.chatter) shiftCounts[v.chatter] = (shiftCounts[v.chatter] || 0) + 1
              }
            }
            available.sort((a, b) => (shiftCounts[a.name] || 0) - (shiftCounts[b.name] || 0))
            newSchedule[cellKey] = { chatter: available[0].name, note: '' }
          }
        }
      }
    }

    setSchedule(newSchedule)
    setAutoPlanning(false)
    alert('✓ Plan wurde automatisch ausgefüllt – bitte prüfen und anpassen!')
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
        if (!cell.chatter || cell.chatter === '__FREI__') { if (cell.chatter !== '__FREI__') conflicts.push({ type: 'unbesetzt', msg: `${model.name} · ${DAYS[weekDays.indexOf(day)]} ${formatDate(day)} · ${shift}`, dayIso, shift, modelId: model.id }) }
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
          <button onClick={autoGeneratePlan} disabled={autoPlanning} style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            {autoPlanning ? '⏳ Plane...' : '⚡ Auto-Plan'}
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
            {saving ? '↻ Speichert...' : '✓ Speichern'}
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </div>

      {/* Schedule - Card Layout */}
      <div style={{ overflowX: 'auto' }}>
        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '120px repeat(7, minmax(90px, 1fr))', gap: 4, marginBottom: 8 }}>
          <div />
          {weekDays.map((day, di) => (
            <div key={di} style={{
              textAlign: 'center', padding: '6px 4px', borderRadius: 7,
              background: isToday(day) ? 'rgba(56,130,246,0.08)' : 'transparent',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: isToday(day) ? '#378add' : 'var(--text-muted)' }}>{DAYS[di]}</div>
              <div style={{ fontSize: 10, color: isToday(day) ? '#378add' : 'var(--text-muted)', opacity: .7 }}>{formatDate(day)}</div>
            </div>
          ))}
        </div>

        {/* Day notes row */}
        <div style={{ display: 'grid', gridTemplateColumns: '120px repeat(7, minmax(90px, 1fr))', gap: 4, marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', paddingLeft: 4 }}>Tages-Notiz</div>
          {weekDays.map((day, di) => {
            const dayIso = isoDate(day)
            return (
              <div key={di} onClick={() => setEditingNote(editingNote === dayIso ? null : dayIso)}
                style={{ background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 6, padding: '4px 6px', cursor: 'text', minHeight: 26 }}>
                {editingNote === dayIso ? (
                  <input autoFocus value={dayNotes[dayIso] || ''}
                    onChange={e => setDayNotes(prev => ({ ...prev, [dayIso]: e.target.value }))}
                    onBlur={() => setEditingNote(null)}
                    onKeyDown={e => e.key === 'Enter' && setEditingNote(null)}
                    style={{ width: '100%', background: 'transparent', border: 'none', color: '#f59e0b', padding: 0, fontSize: 10, fontFamily: 'inherit', outline: 'none' }}
                  />
                ) : (
                  <span style={{ color: dayNotes[dayIso] ? '#f59e0b' : '#2e2e5a', fontSize: 10 }}>{dayNotes[dayIso] || '+'}</span>
                )}
              </div>
            )
          })}
        </div>

        {/* Models */}
        {models.map((model, mi) => {
          const modelColors = ['#f59e0b', '#10b981', '#a78bfa', '#06b6d4', '#ef4444', '#f97316', '#ec4899', '#14b8a6']
          const modelColor = modelColors[mi % modelColors.length]
          return (
            <div key={model.id} style={{ background: modelColor + '08', border: `1px solid ${modelColor}30`, borderRadius: 12, padding: 10, marginBottom: 10 }}>
              {/* Model header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: modelColor + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: modelColor, flexShrink: 0 }}>{model.name[0]}</div>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{model.name}</span>
              </div>

              {/* Shifts */}
              {SHIFTS.map(shift => (
                <div key={shift} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 2, background: SHIFT_COLORS[shift], flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>{shift}</span>
                    {editingShiftTime === `${model.id}__${shift}` ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }} onClick={e => e.stopPropagation()}>
                        <input type="time" value={shiftTimes[`${model.id}__${shift}`]?.split('-')[0]?.trim().replace(' (DE)','') || ''}
                          onChange={e => { const end = shiftTimes[`${model.id}__${shift}`]?.split('-')[1]?.trim().replace(' (DE)','') || ''; setShiftTimes(prev => ({ ...prev, [`${model.id}__${shift}`]: `${e.target.value}-${end}` })) }}
                          style={{ width: 68, background: 'var(--bg-input)', border: '1px solid #7c3aed', color: 'var(--text-primary)', padding: '1px 2px', borderRadius: 3, fontSize: 9, fontFamily: 'monospace', outline: 'none' }} />
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>–</span>
                        <input type="time" value={shiftTimes[`${model.id}__${shift}`]?.split('-')[1]?.trim().replace(' (DE)','') || ''}
                          onChange={e => { const start = shiftTimes[`${model.id}__${shift}`]?.split('-')[0]?.trim().replace(' (DE)','') || ''; setShiftTimes(prev => ({ ...prev, [`${model.id}__${shift}`]: `${start}-${e.target.value}` })) }}
                          onBlur={() => setEditingShiftTime(null)}
                          style={{ width: 68, background: 'var(--bg-input)', border: '1px solid #7c3aed', color: 'var(--text-primary)', padding: '1px 2px', borderRadius: 3, fontSize: 9, fontFamily: 'monospace', outline: 'none' }} />
                      </div>
                    ) : (
                      <span onClick={() => setEditingShiftTime(`${model.id}__${shift}`)} style={{ fontSize: 9, color: shiftTimes[`${model.id}__${shift}`] ? 'var(--text-secondary)' : '#2e2e5a', cursor: 'text', fontFamily: 'monospace' }}>
                        {shiftTimes[`${model.id}__${shift}`] ? `${shiftTimes[`${model.id}__${shift}`].replace(' (DE)','')} DE` : '+Zeit'}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '120px repeat(7, minmax(90px, 1fr))', gap: 4 }}>
                    <div />
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
                      const isFrei = cell.chatter === '__FREI__'
                      const confirmed = cell.confirmed !== false
                      const isPending = cell.chatter && !isFrei && !confirmed

                      const cellBg = isChatterAbsent ? 'rgba(239,68,68,0.08)' : isFrei ? 'rgba(16,185,129,0.05)' : isPending ? 'rgba(245,158,11,0.05)' : cell.chatter ? 'rgba(16,185,129,0.04)' : isToday(day) ? 'rgba(56,130,246,0.04)' : 'var(--bg-card)'
                      const cellBorder = isChatterAbsent ? 'rgba(239,68,68,0.5)' : isFrei ? 'rgba(16,185,129,0.4)' : isPending ? 'rgba(245,158,11,0.4)' : cell.chatter ? 'rgba(16,185,129,0.35)' : isToday(day) ? 'rgba(56,130,246,0.3)' : '#1e1e3a'

                      return (
                        <div key={di} onClick={() => setEditingCell(isEditing ? null : cellId)}
                          style={{ background: cellBg, border: `1px solid ${cellBorder}`, borderRadius: 8, padding: 7, minHeight: 70, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {isEditing ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} onClick={e => e.stopPropagation()}>
                              <select autoFocus value={cell.chatter || ''}
                                onChange={e => setCell(model.id, dayIso, shift, { ...cell, chatter: e.target.value, confirmed: true })}
                                style={{ background: 'var(--bg-input)', border: '1px solid #7c3aed', color: 'var(--text-primary)', padding: '2px 4px', borderRadius: 4, fontSize: 11, fontFamily: 'inherit', outline: 'none', width: '100%' }}>
                                <option value="">— leer —</option>
                                <option value="__FREI__">✓ Freischicht</option>
                                {chatters.map(c => {
                                  const absent = isAbsent(c.name, dayIso)
                                  return <option key={c.id} value={c.name} disabled={absent}>{c.name}{absent ? ' (abw.)' : ''}</option>
                                })}
                              </select>
                              <input value={cell.note || ''}
                                onChange={e => setCell(model.id, dayIso, shift, { ...cell, note: e.target.value })}
                                placeholder="Notiz (optional)"
                                onKeyDown={e => e.key === 'Enter' && setEditingCell(null)}
                                style={{ background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: '#f59e0b', padding: '2px 4px', borderRadius: 4, fontSize: 10, fontFamily: 'inherit', outline: 'none', width: '100%' }}
                              />
                              {cell.chatter && (
                                <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 10 }} onClick={e => e.stopPropagation()}>
                                  <input type="checkbox" checked={cell.confirmed !== false}
                                    onChange={e => setCell(model.id, dayIso, shift, { ...cell, confirmed: e.target.checked })}
                                    style={{ accentColor: '#10b981' }} />
                                  <span style={{ color: cell.confirmed !== false ? '#10b981' : '#f59e0b' }}>
                                    {cell.confirmed !== false ? 'Bestatigt' : 'Klarung notig'}
                                  </span>
                                </label>
                              )}
                              <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 10 }} onClick={e => e.stopPropagation()}>
                                <input type="checkbox" checked={isRecurring}
                                  onChange={async e => {
                                    if (e.target.checked && cell.chatter) { await saveRecurring(model.id, dayOfWeek, shift, cell) }
                                    else { await saveRecurring(model.id, dayOfWeek, shift, { chatter: '' }) }
                                  }}
                                  style={{ accentColor: '#7c3aed' }} />
                                <span style={{ color: isRecurring ? '#a78bfa' : 'var(--text-muted)' }}>{isRecurring ? '↻ Wochentlich (aktiv)' : '↻ Wochentlich'}</span>
                              </label>
                              <button onClick={() => setEditingCell(null)} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 4, padding: '4px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>Fertig</button>
                            </div>
                          ) : cell.chatter ? (
                            <div style={{ flex: 1 }}>
                              {isFrei ? (
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontSize: 12, fontWeight: 700, color: '#10b981' }}>Freischicht</span>
                                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(16,185,129,0.2)', color: '#10b981' }}>✓</span>
                                </div>
                              ) : (
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4 }}>
                                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{cell.chatter}</span>
                                <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
                                  background: isPending ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)',
                                  color: isPending ? '#f59e0b' : '#10b981' }}>
                                  {isPending ? '! Klarung' : 'v'}
                                </span>
                              </div>
                              )}
                              {!isFrei && cell.note && <div style={{ fontSize: 9, color: '#f59e0b', marginTop: 2, lineHeight: 1.3 }}>{cell.note}</div>}
                              {!isFrei && (
                              <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                                {isRecurring && <span style={{ fontSize: 8, color: '#a78bfa' }}>↻</span>}
                                {activeReminders[`${cell.chatter}__${dayIso}__${shift}`] && <span style={{ fontSize: 8, color: '#06b6d4' }}>R</span>}
                              </div>
                              )}
                              {!isFrei && (reminderCell?.cellId === cellId ? (
                                <div onClick={e => e.stopPropagation()} style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                  {['1', '3', '12', '24'].map(h => (
                                    <button key={h} onClick={() => sendReminder(reminderCell.modelId, reminderCell.dayIso, reminderCell.shift, reminderCell.chatterName, h)}
                                      disabled={sendingReminder}
                                      style={{ fontSize: 9, padding: '2px', borderRadius: 3, background: 'rgba(6,182,212,0.12)', color: '#06b6d4', border: '1px solid rgba(6,182,212,0.3)', cursor: 'pointer', fontFamily: 'inherit' }}>
                                      {h}h
                                    </button>
                                  ))}
                                  <button onClick={e => { e.stopPropagation(); setReminderCell(null) }}
                                    style={{ fontSize: 9, padding: '2px', borderRadius: 3, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>X</button>
                                </div>
                              ) : (
                                <button onClick={e => { e.stopPropagation(); setReminderCell({ cellId, modelId: model.id, dayIso, shift, chatterName: cell.chatter }) }}
                                  style={{ marginTop: 3, fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'transparent', color: activeReminders[`${cell.chatter}__${dayIso}__${shift}`] ? '#06b6d4' : '#2e2e5a', border: `1px solid ${activeReminders[`${cell.chatter}__${dayIso}__${shift}`] ? '#06b6d4' : '#2e2e5a'}`, cursor: 'pointer', fontFamily: 'inherit' }}>
                                  Erin
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <span style={{ fontSize: 18, color: hasConflict ? 'rgba(239,68,68,0.4)' : '#2e2e5a' }}>{hasConflict ? '!' : '+'}</span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )
        })}
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
