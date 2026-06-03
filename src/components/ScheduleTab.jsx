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

function berlinDate(date) {
  const str = (date || new Date()).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
  return new Date(str + 'T00:00:00')
}
function isoDate(date) {
  const d = date || new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function todayBerlin() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
}
function isToday(date) { return isoDate(date) === todayBerlin() }
function getWeekStart(date) {
  const d = berlinDate(date || new Date())
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}
function getWeekDays(ws) {
  if (!ws) return []
  const base = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate())
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base)
    d.setDate(d.getDate() + i)
    return d
  })
}
function formatDate(date) { return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) }
function getKW(date) {
  const d = new Date(date)
  const onejan = new Date(d.getFullYear(), 0, 1)
  return Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7)
}

export default function ScheduleTab({ session, userDisplayName }) {
  const [weekStart, setWeekStart] = useState(() => {
    // Restore last viewed week from sessionStorage
    const saved = sessionStorage.getItem('scheduleWeek')
    if (saved) {
      const d = new Date(saved + 'T00:00:00')
      if (!isNaN(d.getTime())) return d
    }
    return getWeekStart(new Date())
  })
  const [models, setModels] = useState([])
  const [chatters, setChatters] = useState([])
  const [admins, setAdmins] = useState([]) // v2.9.2: Admins für Co-Schicht-Dropdown
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
  // v3.1.0: Konflikt-Acknowledgements (gesehen) — persistiert in DB für alle Admins
  const [conflictAcks, setConflictAcks] = useState(new Set()) // set of conflict_keys
  // v3.1.0: Send-Modal für gezielte Chatter-Auswahl
  const [sendModalOpen, setSendModalOpen] = useState(false)
  // v3.15.0: Versand-Historie (Audit-Log)
  const [logModalOpen, setLogModalOpen] = useState(false)
  const [sendLog, setSendLog] = useState([])
  const [logExpandedId, setLogExpandedId] = useState(null)
  const [logLoading, setLogLoading] = useState(false)

  // v3.15.0: Sender-Namen aus Session ableiten (gleiches Mapping wie CommTab)
  // v3.20.0: echten Namen aus user_roles bevorzugen (Email-Fallback erzeugte Doubletten)
  const getSenderName = () => {
    const email = session?.user?.email || ''
    const map = { 'dillemc@hotmail.com': 'Chris' }
    return userDisplayName || map[email] || email.split('@')[0] || 'Admin'
  }

  // v3.15.0: Versand-Historie laden (neueste zuerst, max 50)
  const loadSendLog = async () => {
    setLogLoading(true)
    const { data, error } = await supabase
      .from('schedule_send_log')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(50)
    if (!error) setSendLog(data || [])
    setLogLoading(false)
  }
  const [sendSelection, setSendSelection] = useState(new Set()) // Set<chatter_id>
  // Collapse pro Model — persistiert in Localstorage
  const [collapsedModels, setCollapsedModels] = useState(() => {
    try {
      const saved = localStorage.getItem('schedule_collapsed_models')
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch { return new Set() }
  })

  const toggleModelCollapse = (modelId) => {
    setCollapsedModels(prev => {
      const next = new Set(prev)
      if (next.has(modelId)) next.delete(modelId)
      else next.add(modelId)
      try { localStorage.setItem('schedule_collapsed_models', JSON.stringify([...next])) } catch {}
      return next
    })
  }

  const collapseAllModels = () => {
    const all = new Set(models.map(m => m.id))
    setCollapsedModels(all)
    try { localStorage.setItem('schedule_collapsed_models', JSON.stringify([...all])) } catch {}
  }

  const expandAllModels = () => {
    setCollapsedModels(new Set())
    try { localStorage.setItem('schedule_collapsed_models', JSON.stringify([])) } catch {}
  }

  const [reminderCell, setReminderCell] = useState(null)
  const [sendingReminder, setSendingReminder] = useState(false)
  const [activeReminders, setActiveReminders] = useState({}) // cellKey → true
  const [absences, setAbsences] = useState([]) // [{id, chatter_name, date_from, date_to, reason}]
  const [showAbsences, setShowAbsences] = useState(false)
  const [showExpiredAbsences, setShowExpiredAbsences] = useState(false)
  const [newAbsenceName, setNewAbsenceName] = useState('')
  const [newAbsenceFrom, setNewAbsenceFrom] = useState('')
  const [newAbsenceTo, setNewAbsenceTo] = useState('')
  const [newAbsenceReason, setNewAbsenceReason] = useState('')

  // Mobile + Suche + Bottom-Sheet
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  const [chatterSearch, setChatterSearch] = useState('')
  const [mobileDay, setMobileDay] = useState(() => todayBerlin())
  const [editSheet, setEditSheet] = useState(null) // { modelId, dayIso, shift } or null

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const [scheduleStatus, setScheduleStatus] = useState('draft')
  const [publishing, setPublishing] = useState(false)

  const weekDays = getWeekDays(weekStart)
  const weekKey = isoDate(weekStart)
  const kw = getKW(weekStart)

  useEffect(() => { loadModels(); loadChatters(); loadAdmins(); loadRecurring(); loadAbsences(); loadActiveReminders(); loadConflictAcks() }, [])

  // v3.1.0: Konflikt-Acks aus DB laden (welche Doppel-Schichten wurden als gesehen markiert)
  const loadConflictAcks = async () => {
    try {
      const { data } = await supabase.from('schedule_conflict_acks').select('conflict_key')
      setConflictAcks(new Set((data || []).map(a => a.conflict_key)))
    } catch (e) {
      console.warn('loadConflictAcks failed:', e)
    }
  }

  const toggleConflictAck = async (conflictKey) => {
    if (conflictAcks.has(conflictKey)) {
      // entacken: aus DB entfernen
      try {
        await supabase.from('schedule_conflict_acks').delete().eq('conflict_key', conflictKey)
      } catch (e) { console.warn('unack failed', e) }
      setConflictAcks(prev => {
        const next = new Set(prev)
        next.delete(conflictKey)
        return next
      })
    } else {
      // acken: in DB schreiben
      try {
        await supabase.from('schedule_conflict_acks').insert({ conflict_key: conflictKey, acked_by: session?.user?.email || 'admin' })
      } catch (e) { console.warn('ack failed', e) }
      setConflictAcks(prev => new Set([...prev, conflictKey]))
    }
  }
  useEffect(() => {
    if (weekKey) {
      loadSchedule()
      sessionStorage.setItem('scheduleWeek', weekKey)
    }
  }, [weekKey])

  // Auto-save after 2 seconds of inactivity
  useEffect(() => {
    if (!weekKey) return
    if (Object.keys(schedule).length === 0 && !hasSavedData) return
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
    // v3.0.0: DEAKTIVIERT — Schicht-Alerts kommen jetzt ausschließlich aus der Edge Function
    // `shift-alert` (server-seitig, alle 5 Minuten via pg_cron).
    // 
    // Grund: Die Frontend-Version feuerte bei jedem Tab-Open jedes Admins. Mit mehreren
    // Browser-Tabs gleichzeitig offen gab's Race-Conditions zwischen "Marker laden" und
    // "Telegram senden" → Spam mit unterschiedlichem Wording ("noch nicht online!" vs
    // "noch nicht eingecheckt!"). Edge Function alleine reicht — eine zentrale Quelle.
    return
    // ---- Alter Code unten (nicht mehr ausgeführt) ----
    const now = new Date()
    const todayIso = todayBerlin()
    // Berlin-Stunde + Minute holen — nicht Browser-Zeit, sonst falscher Vergleich aus anderen Zeitzonen
    const berlinTimeStr = now.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false })
    const [currentHour, currentMin] = berlinTimeStr.split(':').map(Number)

    // Load today's schedule
    const weekS = getWeekStart(now)
    const { data: schedData } = await supabase.from('schedule').select('*').eq('week_start', isoDate(weekS)).single()
    if (!schedData) return

    // Load online statuses (Heartbeat-basiert, max 60s alt)
    const { data: onlineData } = await supabase.from('online_status').select('*')
    const onlineMap = {}
    const cutoff = new Date(Date.now() - 60000)
    for (const s of onlineData || []) {
      if (new Date(s.last_seen) > cutoff) onlineMap[s.display_name] = s.shift_online
    }

    // v2.9.3: Aktive Schicht-Logs (eingecheckt aber nicht ausgecheckt) — als Backup
    // Heißt: Wer eingecheckt ist gilt als anwesend, auch wenn Heartbeat veraltet ist
    // (z.B. Browser im Hintergrund, Tab-Throttling)
    const { data: activeLogs } = await supabase.from('shift_logs').select('display_name').is('checked_out_at', null)
    const checkedInLc = new Set((activeLogs || []).map(l => (l.display_name || '').trim().toLowerCase()))

    // v2.9.3: Bereits gefeuerte Alerts heute laden — Spam-Schutz über Tabellen-Grenzen hinweg
    const { data: alertMarkersToday } = await supabase
      .from('alert_markers')
      .select('alert_key')
      .eq('alert_date', todayIso)
      .eq('alert_type', 'no_show')
    const alreadyAlerted = new Set((alertMarkersToday || []).map(m => m.alert_key))

    // Load shift times
    const shiftTimesData = schedData.shift_times || {}
    const assignments = schedData.assignments || {}

    // Get all chatters scheduled today
    const alertedThisRun = new Set()
    for (const [key, val] of Object.entries(assignments)) {
      const parts = key.split('__')
      if (parts[1] !== todayIso || !val.chatter || val.chatter === '__FREI__') continue
      const chatterName = val.chatter
      const chatterLc = chatterName.trim().toLowerCase()
      if (alertedThisRun.has(chatterName)) continue

      // Find shift start time
      const modelId = parts[0]
      const shift = parts[2]
      // v2.9.7: Erst Cell-Override prüfen, dann Standard-Zeit
      const timeStr = (val.time_override || shiftTimesData[`${modelId}__${shift}`] || '').replace(' (DE)', '').replace('(DE)', '')
      if (!timeStr) continue

      // Parse time like "08:00-14:00" or "08:00"
      const startTime = timeStr.split('-')[0].trim()
      const [shiftHour, shiftMin] = startTime.split(':').map(Number)
      if (isNaN(shiftHour)) continue

      // Check if 15 minutes after shift start
      const shiftStartMins = shiftHour * 60 + shiftMin
      const nowMins = currentHour * 60 + currentMin
      if (nowMins >= shiftStartMins + 15 && nowMins < shiftStartMins + 20) {
        // v2.9.3: Mehrere Wege als anwesend zu zählen:
        const isOnlineHeartbeat = !!onlineMap[chatterName]
        const isCheckedIn = checkedInLc.has(chatterLc)
        // Trainee/Co-Chatter zählt auch — wenn der eingecheckt ist, ist die Schicht abgedeckt
        const traineeName = (val.trainee || '').trim().toLowerCase()
        const traineeIsCheckedIn = traineeName && (checkedInLc.has(traineeName) || onlineMap[val.trainee])

        if (isOnlineHeartbeat || isCheckedIn || traineeIsCheckedIn) continue

        // v2.9.3: Spam-Schutz — pro Chatter+Schicht+Tag nur 1x
        const alertKey = `${chatterName}_${shift}_${todayIso}`
        if (alreadyAlerted.has(alertKey)) continue

        alertedThisRun.add(chatterName)
        const msg = `⚠️ ${chatterName} hat ${shift}schicht aber ist noch nicht online! (${startTime} Uhr)`
        await sendTelegramMessage(CHRIS_TG, msg)
        await sendTelegramMessage(REY_TG, msg)

        // Marker schreiben damit's nicht nochmal feuert
        await supabase.from('alert_markers').insert({
          alert_key: alertKey,
          alert_date: todayIso,
          alert_type: 'no_show',
          alerted_at: new Date().toISOString(),
        })
      }
    }
  }

  const loadModels = async () => {
    // Nur Models laden die im Dienstplan auftauchen sollen (in_schedule != false)
    // Bestehende Models ohne den Flag (NULL) werden auch geladen — gilt als "an"
    // v3.23.0: zusätzlich offboardete/stillgelegte Models ausblenden (active != false).
    //   in_schedule = manueller "nicht im Plan"-Schalter, active = Offboarding — getrennt.
    const { data } = await supabase.from('models_contact').select('*')
      .or('in_schedule.is.null,in_schedule.eq.true')
      .or('active.is.null,active.eq.true')
      .order('name')
    setModels(data || [])
  }
  const loadChatters = async () => {
    // v3.18.0: Nur aktive Chatter im Dienstplan (active != false).
    // Bestehende ohne Flag (NULL) gelten als aktiv. Stillgelegte/offboardete werden ausgeblendet.
    const { data } = await supabase.from('chatters_contact').select('*').or('active.is.null,active.eq.true').order('name')
    setChatters(data || [])
  }
  const loadAdmins = async () => {
    // v2.9.2: Admins aus user_roles für Co-Schicht-Dropdown
    const { data } = await supabase.from('user_roles').select('display_name').eq('role', 'admin')
    setAdmins((data || []).map(r => r.display_name).filter(Boolean))
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

      // Load shift times from most recent previous week
      const { data: prevWeeks } = await supabase
        .from('schedule')
        .select('shift_times, week_start')
        .lt('week_start', weekKey)
        .order('week_start', { ascending: false })
        .limit(1)
      if (prevWeeks && prevWeeks.length > 0 && prevWeeks[0].shift_times) {
        const prevTimes = prevWeeks[0].shift_times
        const cleanTimes = {}
        for (const [k, v] of Object.entries(prevTimes)) {
          // Key format: modelId__shift → keep as is since times are per model+shift not per day
          cleanTimes[k] = String(v).replace(' (DE)', '').replace('(DE)', '')
        }
        setShiftTimes(cleanTimes)
      } else {
        setShiftTimes({})
      }
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

  // Sucht nach Chatter in Hauptchatter ODER Trainee — case-insensitive partial match
  const cellMatchesSearch = (cell) => {
    if (!chatterSearch.trim()) return false
    const q = chatterSearch.trim().toLowerCase()
    const main = (cell.chatter || '').toLowerCase()
    const trainee = (cell.trainee || '').toLowerCase()
    return main.includes(q) || trainee.includes(q)
  }

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

  // v3.1.1: Schicht zum Tausch ausschreiben (Admin-Anbot — wiederhergestellt aus v2.8.2)
  // requester_name = NULL als Marker für Admin-Anbot
  // Erscheint dann im ChatterPortal als Popup für andere Chatter zum Übernehmen
  const offerShift = async (modelId, dayIso, shift) => {
    const model = models.find(m => m.id === modelId)
    if (!model) return
    // Schon ausgeschrieben?
    const { data: existing } = await supabase
      .from('shift_swaps')
      .select('id')
      .eq('shift_date', dayIso)
      .eq('shift', shift)
      .eq('model_name', model.name)
      .in('status', ['offen', 'vorgeschlagen'])
    if (existing && existing.length > 0) {
      alert('Diese Schicht wurde bereits zum Tausch ausgeschrieben.')
      return
    }
    const reason = prompt('Grund (optional, sichtbar für Chatter):') || null
    const { error } = await supabase.from('shift_swaps').insert({
      requester_name: null, // = Admin-Anbot
      shift_date: dayIso,
      shift,
      model_name: model.name,
      reason,
      status: 'offen',
    })
    if (error) { alert('Fehler: ' + error.message); return }
    alert('✓ Schicht ausgeschrieben. Chatter sehen das beim nächsten Login.')
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

  // v3.1.0: Doppel-Schicht-Detection — Chatter in 2+ verschiedenen Schichten am gleichen Tag
  // Mapping: chatter+date → Set of shifts (Früh/Spät/Nacht)
  const chatterShiftsByDay = {} // {"Max__2026-05-06": Set("Früh", "Spät")}
  for (const day of weekDays) {
    const dayIso = isoDate(day)
    for (const shift of SHIFTS) {
      for (const model of models) {
        const cell = getCell(model.id, dayIso, shift)
        if (!cell.chatter || cell.chatter === '__FREI__') continue
        const key = `${cell.chatter}__${dayIso}`
        if (!chatterShiftsByDay[key]) chatterShiftsByDay[key] = new Set()
        chatterShiftsByDay[key].add(shift)
      }
    }
  }
  // Set für schnellen Lookup pro Zelle: welche (chatter, dayIso)-Kombis sind betroffen
  const doppelSchichtKeys = new Set() // "{chatter}__{dayIso}"
  for (const [key, shifts] of Object.entries(chatterShiftsByDay)) {
    if (shifts.size >= 2) {
      doppelSchichtKeys.add(key)
      const [chatterName, dayIso] = key.split('__')
      const dayObj = weekDays.find(d => isoDate(d) === dayIso)
      const dayLabel = dayObj ? `${DAYS[weekDays.indexOf(dayObj)]} ${formatDate(dayObj)}` : dayIso
      const conflictKey = `${chatterName}__${dayIso}` // identisch zu doppelSchichtKey-Format
      conflicts.push({
        type: 'doppel_schicht',
        msg: `${chatterName} hat ${[...shifts].join(' + ')} am ${dayLabel}`,
        chatterName,
        dayIso,
        shifts: [...shifts],
        conflictKey,
        acked: conflictAcks.has(conflictKey),
      })
    }
  }

  // v3.1.0: Sendet an die Chatter die im Modal ausgewählt sind
  const sendPlanToSelected = async () => {
    const selectedIds = sendSelection
    if (selectedIds.size === 0) {
      alert('Bitte mindestens einen Chatter auswählen.')
      return
    }
    setSending(true)
    let sent = 0
    let skipped = 0
    const sentToNames = []     // v3.15.0
    let sampleMessage = ''     // v3.15.0
    for (const chatter of chatters) {
      if (!selectedIds.has(chatter.id)) continue
      if (!chatter.telegram_id) { skipped++; continue }
      const lines = [`📋 Dienstplan KW ${kw} (${formatDate(weekDays[0])} – ${formatDate(weekDays[6])})\n`]
      for (const day of weekDays) {
        const dayIso = isoDate(day)
        const dayShifts = []
        for (const shift of SHIFTS) {
          for (const model of models) {
            const cell = getCell(model.id, dayIso, shift)
            if (cell.chatter === chatter.name) {
              const berlinTime = (cell.time_override || shiftTimes[`${model.id}__${shift}`] || '').replace(' (DE)', '').replace('(DE)', '')
              // v3.24.0: Zeit direkt in DE-Zeit anzeigen. KEIN convertTimeToLocal mehr —
              // das rechnete auf die Browser-Zeitzone des Senders um (Zypern = +1),
              // wodurch ALLE Chatter den Plan +1h verschoben bekamen.
              const timeDisplay = berlinTime ? ` (${berlinTime} Uhr DE)` : ''
              dayShifts.push(`  ${shift}${timeDisplay}: ${model.name}${cell.note ? ` – ${cell.note}` : ''}`)
            }
          }
        }
        if (dayShifts.length > 0) {
          lines.push(`${DAYS[weekDays.indexOf(day)]} ${formatDate(day)}`)
          lines.push(...dayShifts)
          lines.push('')
        }
      }
      if (lines.length > 1) {
        const msgText = lines.join('\n')
        await sendTelegramMessage(chatter.telegram_id, msgText)
        sent++
        sentToNames.push(chatter.name)
        if (!sampleMessage) sampleMessage = msgText
      }
    }
    // v3.15.0: Audit-Log
    if (sent > 0 || skipped > 0) {
      const allChattersWithTg = chatters.filter(c => c.telegram_id).length
      const actionType = selectedIds.size >= allChattersWithTg ? 'plan_full' : 'plan_partial'
      try {
        await supabase.from('schedule_send_log').insert({
          sent_by: getSenderName(),
          action_type: actionType,
          week_start: isoDate(weekDays[0]),
          kw: kw,
          recipients_count: sent,
          recipients_skipped: skipped,
          recipient_names: sentToNames,
          message_text: sampleMessage,
        })
      } catch (e) {
        console.error('Failed to log send:', e)
      }
    }
    setSending(false)
    setSendModalOpen(false)
    setSendSelection(new Set())
    alert(`✓ Dienstplan an ${sent} ${sent === 1 ? 'Chatter' : 'Chatter'} versendet${skipped > 0 ? ` (${skipped} ohne Telegram-ID übersprungen)` : ''}!`)
  }

  const sendPlanToAll = async () => {
    setSending(true)
    let sent = 0
    let skipped = 0
    const sentToNames = []     // v3.15.0
    let sampleMessage = ''     // v3.15.0
    for (const chatter of chatters) {
      if (!chatter.telegram_id) { skipped++; continue }
      const lines = [`📋 Dienstplan KW ${kw} (${formatDate(weekDays[0])} – ${formatDate(weekDays[6])})\n`]
      for (const day of weekDays) {
        const dayIso = isoDate(day)
        const dayShifts = []
        for (const shift of SHIFTS) {
          for (const model of models) {
            const cell = getCell(model.id, dayIso, shift)
            if (cell.chatter === chatter.name) {
              const berlinTime = (shiftTimes[`${model.id}__${shift}`] || '').replace(' (DE)', '').replace('(DE)', '')
              // v3.24.0: Zeit direkt in DE-Zeit anzeigen. KEIN convertTimeToLocal mehr —
              // das rechnete auf die Browser-Zeitzone des Senders um (Zypern = +1),
              // wodurch ALLE Chatter den Plan +1h verschoben bekamen.
              const timeDisplay = berlinTime ? ` (${berlinTime} Uhr DE)` : ''
              dayShifts.push(`  ${shift}${timeDisplay}: ${model.name}${cell.note ? ` – ${cell.note}` : ''}`)
            }
          }
        }
        if (dayShifts.length > 0) {
          lines.push(`${DAYS[weekDays.indexOf(day)]} ${formatDate(day)}`)
          lines.push(...dayShifts)
          lines.push('')
        }
      }
      if (lines.length > 1) {
        const msgText = lines.join('\n')
        await sendTelegramMessage(chatter.telegram_id, msgText)
        sent++
        sentToNames.push(chatter.name)
        if (!sampleMessage) sampleMessage = msgText
      }
    }
    // v3.15.0: Audit-Log
    if (sent > 0 || skipped > 0) {
      try {
        await supabase.from('schedule_send_log').insert({
          sent_by: getSenderName(),
          action_type: 'plan_full',
          week_start: isoDate(weekDays[0]),
          kw: kw,
          recipients_count: sent,
          recipients_skipped: skipped,
          recipient_names: sentToNames,
          message_text: sampleMessage,
        })
      } catch (e) {
        console.error('Failed to log send:', e)
      }
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
          {/* v3.15.3: Verlauf-Button — passend zu anderen Buttons (kein Emoji, nur Text) */}
          <button onClick={() => { setLogModalOpen(true); loadSendLog() }} title="Versand-Verlauf anzeigen" style={{
            background: 'rgba(6,182,212,0.06)',
            color: '#06b6d4',
            border: '1px solid rgba(6,182,212,0.2)',
            borderRadius: 7,
            padding: '7px 14px',
            fontSize: 12, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
            whiteSpace: 'nowrap',
          }}>Verlauf</button>
          <button onClick={() => { setSendSelection(new Set(chatters.filter(c => c.telegram_id).map(c => c.id))); setSendModalOpen(true) }} disabled={sending} style={{ background: 'rgba(6,182,212,0.12)', color: '#06b6d4', border: '1px solid rgba(6,182,212,0.3)', borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            {sending ? 'Sende...' : '✈ Plan versenden...'}
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
          </button>
        </div>
      </div>

      {/* Chatter-Suche */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={chatterSearch}
          onChange={e => setChatterSearch(e.target.value)}
          placeholder="🔍 Chatter suchen — markiert alle Schichten gelb..."
          style={{
            fontSize: 12,
            padding: '6px 12px',
            borderRadius: 7,
            background: chatterSearch ? 'rgba(245,158,11,0.1)' : 'var(--bg-input)',
            border: `1px solid ${chatterSearch ? '#f59e0b' : '#1e1e3a'}`,
            color: 'var(--text-primary)',
            fontFamily: 'inherit',
            outline: 'none',
            flex: '1 1 220px',
            minWidth: 0,
          }}
        />
        {chatterSearch && (
          <button onClick={() => setChatterSearch('')} style={{
            fontSize: 11, padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
            background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', fontFamily: 'inherit'
          }}>✕ Suche</button>
        )}
      </div>

      {/* ───────── MOBILE VIEW ───────── */}
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Tag-Switcher */}
          <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch' }}>
            {weekDays.map((day, di) => {
              const dayIso = isoDate(day)
              const isSelected = mobileDay === dayIso
              const today = isToday(day)
              return (
                <button key={di} onClick={() => setMobileDay(dayIso)} style={{
                  flexShrink: 0,
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: isSelected ? '#7c3aed' : today ? 'rgba(56,130,246,0.1)' : 'var(--bg-card)',
                  border: `1px solid ${isSelected ? '#7c3aed' : today ? 'rgba(56,130,246,0.4)' : 'var(--border)'}`,
                  color: isSelected ? '#fff' : today ? '#378add' : 'var(--text-secondary)',
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  minWidth: 56,
                  gap: 2,
                }}>
                  <span style={{ fontSize: 10, opacity: 0.85 }}>{DAYS[di]}</span>
                  <span style={{ fontSize: 14 }}>{day.getDate()}.{String(day.getMonth() + 1).padStart(2, '0')}</span>
                </button>
              )
            })}
          </div>

          {/* Tages-Notiz */}
          <div onClick={() => setEditingNote(editingNote === mobileDay ? null : mobileDay)}
            style={{ background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 8, padding: '8px 12px', cursor: 'text' }}>
            {editingNote === mobileDay ? (
              <input autoFocus value={dayNotes[mobileDay] || ''}
                onChange={e => setDayNotes(prev => ({ ...prev, [mobileDay]: e.target.value }))}
                onBlur={() => setEditingNote(null)}
                onKeyDown={e => e.key === 'Enter' && setEditingNote(null)}
                placeholder="Tages-Notiz..."
                style={{ width: '100%', background: 'transparent', border: 'none', color: '#f59e0b', fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
              />
            ) : (
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                <span style={{ fontWeight: 700, marginRight: 6 }}>Tages-Notiz:</span>
                <span style={{ color: dayNotes[mobileDay] ? '#f59e0b' : 'var(--text-muted)' }}>
                  {dayNotes[mobileDay] || '+ tippen zum Hinzufügen'}
                </span>
              </div>
            )}
          </div>

          {/* Pro Model eine Karte */}
          {models.map(model => {
            const dayIso = mobileDay
            return (
              <div key={model.id} style={{ background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 7, background: model.avatar_url ? `url(${model.avatar_url}) center/cover` : 'rgba(167,139,250,0.15)', border: '1px solid var(--border)', flexShrink: 0 }} />
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{model.name}</span>
                </div>

                {SHIFTS.map(shift => {
                  const cell = getCell(model.id, dayIso, shift)
                  const cellId = getCellKey(model.id, dayIso, shift)
                  const isFrei = cell.chatter === '__FREI__'
                  const confirmed = cell.confirmed !== false
                  const isPending = cell.chatter && !isFrei && !confirmed
                  const isChatterAbsent = cell.chatter && !isFrei ? isAbsent(cell.chatter, dayIso) : false
                  const isSearchMatch = cellMatchesSearch(cell)
                  const isTrainee = !!cell.trainee && !isFrei
                  const timeStr = shiftTimes[`${model.id}__${shift}`]
                  const shiftIcon = shift === 'Früh' ? '🌅' : shift === 'Spät' ? '🌃' : shift === 'Nacht' ? '🌙' : '•'
                  const shiftColor = SHIFT_COLORS[shift] || 'var(--text-muted)'

                  const bgBase = isChatterAbsent ? 'rgba(239,68,68,0.08)' : isFrei ? 'rgba(16,185,129,0.06)' : isPending ? 'rgba(245,158,11,0.06)' : cell.chatter ? 'rgba(16,185,129,0.04)' : 'var(--bg-card2)'
                  const borderBase = isChatterAbsent ? 'rgba(239,68,68,0.4)' : isFrei ? 'rgba(16,185,129,0.4)' : isPending ? 'rgba(245,158,11,0.4)' : cell.chatter ? 'rgba(16,185,129,0.3)' : 'var(--border)'
                  const bg = isTrainee ? 'rgba(6,182,212,0.10)' : bgBase
                  const border = isTrainee ? '#06b6d4' : borderBase
                  const borderWidth = isTrainee ? 2 : 1
                  const boxShadow = isSearchMatch ? '0 0 0 2px #f59e0b, 0 0 12px rgba(245,158,11,0.6)' :
                                    isTrainee ? '0 0 8px rgba(6,182,212,0.35)' : 'none'

                  return (
                    <div key={shift} onClick={() => setEditSheet({ modelId: model.id, dayIso, shift })}
                      style={{ position: 'relative', marginBottom: 6, padding: '10px 12px', background: bg, border: `${borderWidth}px solid ${border}`, borderRadius: 8, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow }}>
                      {isTrainee && (
                        <div style={{ position: 'absolute', top: -8, left: 10, fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 3, background: '#06b6d4', color: '#fff', letterSpacing: '0.04em', zIndex: 2 }}>🎓 ANLERNEN</div>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: shiftColor, fontWeight: 700 }}>{shiftIcon} {shift}{timeStr ? ` · ${timeStr}` : ''}</div>
                        {isFrei ? (
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#10b981' }}>✓ Freischicht</div>
                        ) : cell.chatter ? (
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{cell.chatter}</div>
                            {cell.trainee && (() => {
                              const isCo = cell.trainee_mode === 'co'
                              return (
                                <div style={{ fontSize: 12, color: isCo ? '#f59e0b' : '#06b6d4', fontWeight: 600 }}>{isCo ? '👥' : '🎓'} mit {cell.trainee}</div>
                              )
                            })()}
                            {cell.time_override && (
                              <div style={{ fontSize: 10, color: '#f97316', marginTop: 2, fontFamily: 'monospace', fontWeight: 700 }}>⚠ {cell.time_override}</div>
                            )}
                            {cell.note && <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 2 }}>{cell.note}</div>}
                          </div>
                        ) : (
                          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>– offen –</div>
                        )}
                      </div>
                      <span style={{ fontSize: 18, color: 'var(--text-muted)', marginLeft: 8 }}>›</span>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      ) : (
      /* ───────── DESKTOP VIEW ───────── */
      <>
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

        {/* Collapse Controls + Models Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, padding: '0 4px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
            {models.length} Models · {collapsedModels.size > 0 ? `${collapsedModels.size} eingeklappt` : 'alle ausgeklappt'}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={collapseAllModels} style={{
              fontSize: 10, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', fontFamily: 'inherit', fontWeight: 600
            }}>▶ Alle einklappen</button>
            <button onClick={expandAllModels} style={{
              fontSize: 10, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', fontFamily: 'inherit', fontWeight: 600
            }}>▼ Alle ausklappen</button>
          </div>
        </div>

        {/* Models */}
        {models.map((model, mi) => {
          const modelColors = ['#f59e0b', '#10b981', '#a78bfa', '#06b6d4', '#ef4444', '#f97316', '#ec4899', '#14b8a6']
          const modelColor = modelColors[mi % modelColors.length]
          const isCollapsed = collapsedModels.has(model.id)

          // Mini-Stats für collapsed-Anzeige: wieviele Cells sind besetzt diese Woche
          let totalCells = 0
          let filledCells = 0
          let frei = 0
          let pending = 0
          for (const day of weekDays) {
            const dayIso = isoDate(day)
            for (const shift of SHIFTS) {
              totalCells++
              const c = getCell(model.id, dayIso, shift)
              if (c.chatter === '__FREI__') frei++
              else if (c.chatter) {
                if (c.confirmed === false) pending++
                else filledCells++
              }
            }
          }

          return (
            <div key={model.id} style={{ background: modelColor + '08', border: `1px solid ${modelColor}30`, borderRadius: 12, padding: 10, marginBottom: 10 }}>
              {/* Model header — klickbar zum kollabieren */}
              <div
                onClick={() => toggleModelCollapse(model.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: isCollapsed ? 0 : 10, cursor: 'pointer', userSelect: 'none' }}
              >
                <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, width: 12 }}>{isCollapsed ? '▶' : '▼'}</span>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: modelColor + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: modelColor, flexShrink: 0 }}>{model.name[0]}</div>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{model.name}</span>
                {isCollapsed && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', fontSize: 10, fontFamily: 'monospace' }}>
                    <span style={{ color: '#10b981' }}>✓ {filledCells}</span>
                    {pending > 0 && <span style={{ color: '#f59e0b' }}>⏳ {pending}</span>}
                    {frei > 0 && <span style={{ color: '#06b6d4' }}>frei {frei}</span>}
                    <span style={{ color: 'var(--text-muted)' }}>· {totalCells - filledCells - frei - pending} offen</span>
                  </div>
                )}
              </div>

              {/* Shifts — nur wenn nicht collapsed */}
              {!isCollapsed && SHIFTS.map(shift => (
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
                      // v3.1.0: Doppel-Schicht-Check für DIESE Zelle (Chatter hat 2+ Schichten am gleichen Tag)
                      const doppelKey = cell.chatter && cell.chatter !== '__FREI__' ? `${cell.chatter}__${dayIso}` : null
                      const isDoppelSchicht = doppelKey ? doppelSchichtKeys.has(doppelKey) : false
                      const isDoppelAcked = doppelKey ? conflictAcks.has(doppelKey) : false
                      const showDoppelWarn = isDoppelSchicht && !isDoppelAcked
                      const dayOfWeek = day.getDay() === 0 ? 6 : day.getDay() - 1
                      const recurringKey = getRecurringKey(model.id, dayOfWeek, shift)
                      const isRecurring = !!recurring[recurringKey]
                      const isChatterAbsent = cell.chatter ? isAbsent(cell.chatter, dayIso) : false
                      const isFrei = cell.chatter === '__FREI__'
                      const confirmed = cell.confirmed !== false
                      const isPending = cell.chatter && !isFrei && !confirmed

                      const cellBg = isChatterAbsent ? 'rgba(239,68,68,0.08)' : isFrei ? 'rgba(16,185,129,0.05)' : isPending ? 'rgba(245,158,11,0.05)' : cell.chatter ? 'rgba(16,185,129,0.04)' : isToday(day) ? 'rgba(56,130,246,0.04)' : 'var(--bg-card)'
                      const cellBorder = isChatterAbsent ? 'rgba(239,68,68,0.5)' : isFrei ? 'rgba(16,185,129,0.4)' : isPending ? 'rgba(245,158,11,0.4)' : cell.chatter ? 'rgba(16,185,129,0.35)' : isToday(day) ? 'rgba(56,130,246,0.3)' : '#1e1e3a'
                      // Search-Highlight: gelb glühend wenn cell matched
                      const isSearchMatch = cellMatchesSearch(cell)
                      const isTrainee = !!cell.trainee && !isFrei
                      // Trainee-Style: cyan Background überlagert + cyan Border + cyan Glow
                      // Search hat Vorrang (gelb), aber wenn beides → kombinieren wir mit Border-cyan + Schatten-gelb
                      let finalBg = isTrainee ? 'rgba(6,182,212,0.10)' : cellBg
                      let finalBorder = isTrainee ? '#06b6d4' : cellBorder
                      let finalBorderWidth = isTrainee ? 2 : 1
                      // v3.1.0: Doppel-Schicht-Warnung — rote Border + roter Hintergrund. Hat Vorrang vor Trainee-Style.
                      if (showDoppelWarn) {
                        finalBg = 'rgba(239,68,68,0.14)'
                        finalBorder = '#ef4444'
                        finalBorderWidth = 2
                      }
                      const searchBoxShadow = isSearchMatch ? '0 0 0 2px #f59e0b, 0 0 12px rgba(245,158,11,0.6)' :
                                              showDoppelWarn ? '0 0 12px rgba(239,68,68,0.5)' :
                                              isTrainee ? '0 0 8px rgba(6,182,212,0.35)' : 'none'

                      return (
                        <div key={di} onClick={() => setEditingCell(isEditing ? null : cellId)}
                          style={{ position: 'relative', background: finalBg, border: `${finalBorderWidth}px solid ${finalBorder}`, borderRadius: 8, padding: 7, minHeight: 70, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3, boxShadow: searchBoxShadow, transition: 'box-shadow 0.2s, background 0.2s' }}>
                          {/* v3.1.0: Doppel-Schicht-Badge — klickbar zum als-gesehen-markieren */}
                          {showDoppelWarn && (
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleConflictAck(doppelKey) }}
                              title={`${cell.chatter} hat mehrere Schichten an diesem Tag — Klick zum Bestätigen`}
                              style={{
                                position: 'absolute', top: -8, right: 6, fontSize: 9, fontWeight: 700,
                                padding: '2px 7px', borderRadius: 3, background: '#ef4444', color: '#fff',
                                letterSpacing: '0.04em', zIndex: 3, border: 'none', cursor: 'pointer',
                                fontFamily: 'inherit', boxShadow: '0 2px 6px rgba(239,68,68,0.4)',
                              }}
                            >⚠ DOPPEL · ✓ gesehen</button>
                          )}
                          {isTrainee && (
                            <div style={{ position: 'absolute', top: -8, left: 6, fontSize: 8, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: '#06b6d4', color: '#fff', letterSpacing: '0.04em', zIndex: 2 }}>🎓 ANLERNEN</div>
                          )}
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
                              {cell.chatter && !isFrei && (() => {
                                const mode = cell.trainee_mode || 'anlernen'
                                return (
                                <>
                                  <div style={{ display: 'flex', gap: 3 }}>
                                    {[
                                      { val: 'anlernen', icon: '🎓', color: '#06b6d4' },
                                      { val: 'co', icon: '👥', color: '#f59e0b' },
                                    ].map(opt => {
                                      const active = mode === opt.val
                                      return (
                                        <button key={opt.val} type="button"
                                          onClick={ev => { ev.stopPropagation(); setCell(model.id, dayIso, shift, { ...cell, trainee_mode: opt.val, trainee: null }) }}
                                          style={{
                                            flex: 1, padding: '1px 3px', borderRadius: 3,
                                            background: active ? `${opt.color}22` : 'transparent',
                                            border: `1px solid ${active ? opt.color : '#2e2e5a'}`,
                                            color: active ? opt.color : 'var(--text-muted)',
                                            fontSize: 9, cursor: 'pointer', fontFamily: 'inherit',
                                          }}>{opt.icon}</button>
                                      )
                                    })}
                                  </div>
                                  {mode === 'co' ? (
                                    <select value={cell.trainee || ''}
                                      onChange={e => setCell(model.id, dayIso, shift, { ...cell, trainee: e.target.value || null })}
                                      style={{
                                        background: 'var(--bg-input)', border: '1px solid #f59e0b', color: '#f59e0b',
                                        padding: '2px 4px', borderRadius: 4, fontSize: 10, fontFamily: 'inherit', outline: 'none', width: '100%',
                                      }}>
                                      <option value="">— wählen —</option>
                                      {chatters.filter(c => c.name !== cell.chatter).map(c => {
                                        const absent = isAbsent(c.name, dayIso)
                                        return <option key={`c-${c.id}`} value={c.name} disabled={absent}>{c.name}{absent ? ' (abw.)' : ''}</option>
                                      })}
                                      {admins.filter(a => a !== cell.chatter).map(a => (
                                        <option key={`a-${a}`} value={a}>{a} (Admin)</option>
                                      ))}
                                    </select>
                                  ) : (
                                    <input value={cell.trainee || ''}
                                      onChange={e => setCell(model.id, dayIso, shift, { ...cell, trainee: e.target.value || null })}
                                      placeholder="Name (auch externe)"
                                      style={{
                                        background: 'var(--bg-input)', border: '1px solid #06b6d4', color: '#06b6d4',
                                        padding: '2px 4px', borderRadius: 4, fontSize: 10, fontFamily: 'inherit', outline: 'none', width: '100%',
                                      }}
                                    />
                                  )}
                                </>
                                )
                              })()}
                              {/* v2.9.7: Zeit überschreiben für diesen Tag */}
                              {cell.chatter && !isFrei && (
                                <input value={cell.time_override || ''}
                                  onChange={e => setCell(model.id, dayIso, shift, { ...cell, time_override: e.target.value || null })}
                                  placeholder={(shiftTimes[`${model.id}__${shift}`] || '').replace(/\s*\(DE\)/g, '') || 'Zeit'}
                                  onKeyDown={e => e.key === 'Enter' && setEditingCell(null)}
                                  style={{
                                    background: 'var(--bg-input)',
                                    border: `1px solid ${cell.time_override ? '#f97316' : '#2e2e5a'}`,
                                    color: cell.time_override ? '#f97316' : 'var(--text-muted)',
                                    padding: '2px 4px', borderRadius: 4, fontSize: 9, fontFamily: 'monospace', outline: 'none', width: '100%',
                                  }}
                                />
                              )}
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
                              {/* v3.1.3: Ausschreiben — auch bei leerer Zelle erlaubt (nur __FREI__ ausnehmen) */}
                              {!isFrei && (
                                <button onClick={(e) => { e.stopPropagation(); offerShift(model.id, dayIso, shift) }}
                                  title="Schicht zum Tausch ausschreiben — Chatter sehen sie als Pop-Up"
                                  style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 4, padding: '4px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                                  🔄 Ausschreiben
                                </button>
                              )}
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
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{cell.chatter}</span>
                                  {isTrainee && (() => {
                                    const isCo = cell.trainee_mode === 'co'
                                    return (
                                      <span style={{ fontSize: 10, color: isCo ? '#f59e0b' : '#06b6d4', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 3 }}>
                                        <span style={{ fontSize: 9 }}>{isCo ? '👥' : '🎓'}</span>{cell.trainee}
                                      </span>
                                    )
                                  })()}
                                </div>
                                <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
                                  background: isPending ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)',
                                  color: isPending ? '#f59e0b' : '#10b981' }}>
                                  {isPending ? '! Klarung' : 'v'}
                                </span>
                              </div>
                              )}
                              {!isFrei && cell.time_override && (
                                <div style={{ fontSize: 9, color: '#f97316', marginTop: 2, fontFamily: 'monospace', fontWeight: 700 }}>⚠ {cell.time_override}</div>
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
      </>
      )}

      {/* Mobile Edit Bottom-Sheet */}
      {editSheet && (() => {
        const cell = getCell(editSheet.modelId, editSheet.dayIso, editSheet.shift)
        const day = new Date(editSheet.dayIso + 'T00:00:00')
        const dayOfWeek = day.getDay() === 0 ? 6 : day.getDay() - 1
        const recurringKey = getRecurringKey(editSheet.modelId, dayOfWeek, editSheet.shift)
        const isRecurring = !!recurring[recurringKey]
        const isFrei = cell.chatter === '__FREI__'
        const model = models.find(m => m.id === editSheet.modelId)
        const shiftLabel = editSheet.shift === 'Früh' ? '🌅 Frühschicht' : editSheet.shift === 'Spät' ? '🌃 Spätschicht' : editSheet.shift === 'Nacht' ? '🌙 Nachtschicht' : editSheet.shift
        return (
          <div onClick={() => setEditSheet(null)} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
          }}>
            <div onClick={e => e.stopPropagation()} style={{
              width: '100%', maxWidth: 540, background: 'var(--bg-card)', borderRadius: '14px 14px 0 0',
              padding: 18, maxHeight: '85vh', overflowY: 'auto',
              border: '1px solid var(--border)', borderBottom: 'none'
            }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{model?.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {shiftLabel} · {new Date(editSheet.dayIso + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' })}
                  </div>
                </div>
                <button onClick={() => setEditSheet(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 22, cursor: 'pointer', padding: 4 }}>✕</button>
              </div>

              {/* Chatter-Auswahl */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Chatter</label>
                <select value={cell.chatter || ''}
                  onChange={e => setCell(editSheet.modelId, editSheet.dayIso, editSheet.shift, { ...cell, chatter: e.target.value, confirmed: true })}
                  style={{ background: 'var(--bg-input)', border: '1px solid #7c3aed', color: 'var(--text-primary)', padding: '10px 12px', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none', width: '100%' }}>
                  <option value="">— leer —</option>
                  <option value="__FREI__">✓ Freischicht</option>
                  {chatters.map(c => {
                    const absent = isAbsent(c.name, editSheet.dayIso)
                    return <option key={c.id} value={c.name} disabled={absent}>{c.name}{absent ? ' (abw.)' : ''}</option>
                  })}
                </select>
              </div>

              {/* Trainee / Co-Schicht */}
              {cell.chatter && !isFrei && (() => {
                const mode = cell.trainee_mode || 'anlernen'
                return (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Zweiter Chatter (optional)</label>
                  {/* Modus-Toggle */}
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    {[
                      { val: 'anlernen', icon: '🎓', label: 'Anlernen', color: '#06b6d4' },
                      { val: 'co', icon: '👥', label: 'Co-Schicht', color: '#f59e0b' },
                    ].map(opt => {
                      const active = mode === opt.val
                      return (
                        <button key={opt.val} type="button"
                          onClick={() => setCell(editSheet.modelId, editSheet.dayIso, editSheet.shift, { ...cell, trainee_mode: opt.val, trainee: null })}
                          style={{
                            flex: 1, padding: '6px 8px', borderRadius: 6,
                            background: active ? `${opt.color}22` : 'transparent',
                            border: `1px solid ${active ? opt.color : '#2e2e5a'}`,
                            color: active ? opt.color : 'var(--text-muted)',
                            fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                          }}>{opt.icon} {opt.label}</button>
                      )
                    })}
                  </div>
                  {mode === 'co' ? (
                    <select value={cell.trainee || ''}
                      onChange={e => setCell(editSheet.modelId, editSheet.dayIso, editSheet.shift, { ...cell, trainee: e.target.value || null })}
                      style={{
                        background: 'var(--bg-input)', border: '1px solid #f59e0b', color: '#f59e0b',
                        padding: '10px 12px', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box',
                      }}>
                      <option value="">— wählen —</option>
                      {chatters.filter(c => c.name !== cell.chatter).map(c => {
                        const absent = isAbsent(c.name, editSheet.dayIso)
                        return <option key={`c-${c.id}`} value={c.name} disabled={absent}>{c.name}{absent ? ' (abw.)' : ''}</option>
                      })}
                      {admins.filter(a => a !== cell.chatter).map(a => (
                        <option key={`a-${a}`} value={a}>{a} (Admin)</option>
                      ))}
                    </select>
                  ) : (
                    <input value={cell.trainee || ''}
                      onChange={e => setCell(editSheet.modelId, editSheet.dayIso, editSheet.shift, { ...cell, trainee: e.target.value || null })}
                      placeholder="Name eintragen — auch externe ohne Account"
                      style={{
                        background: 'var(--bg-input)', border: '1px solid #06b6d4', color: '#06b6d4',
                        padding: '10px 12px', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box',
                      }}
                    />
                  )}
                </div>
                )
              })()}

              {/* v2.9.7: Zeit überschreiben für diesen Tag */}
              {cell.chatter && !isFrei && (() => {
                const stdTime = (shiftTimes[`${editSheet.modelId}__${editSheet.shift}`] || '').replace(/\s*\(DE\)/g, '')
                const hasOverride = !!cell.time_override
                return (
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span>Zeit für diesen Tag</span>
                      {hasOverride && (
                        <button type="button" onClick={() => setCell(editSheet.modelId, editSheet.dayIso, editSheet.shift, { ...cell, time_override: null })}
                          style={{ background: 'transparent', border: 'none', color: '#ef4444', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                          ✕ zurücksetzen
                        </button>
                      )}
                    </label>
                    <input value={cell.time_override || ''}
                      onChange={e => setCell(editSheet.modelId, editSheet.dayIso, editSheet.shift, { ...cell, time_override: e.target.value || null })}
                      placeholder={stdTime ? `Standard: ${stdTime}` : '08:00-14:00'}
                      style={{
                        background: 'var(--bg-input)',
                        border: `1px solid ${hasOverride ? '#f97316' : '#2e2e5a'}`,
                        color: hasOverride ? '#f97316' : 'var(--text-primary)',
                        padding: '10px 12px', borderRadius: 8, fontSize: 13, fontFamily: 'monospace', outline: 'none', width: '100%', boxSizing: 'border-box',
                      }}
                    />
                    {hasOverride && (
                      <div style={{ fontSize: 10, color: '#f97316', marginTop: 4 }}>
                        ⚠ Diese Zeit gilt nur für diesen Tag. Standard: {stdTime || '—'}
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Notiz */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Notiz</label>
                <input value={cell.note || ''}
                  onChange={e => setCell(editSheet.modelId, editSheet.dayIso, editSheet.shift, { ...cell, note: e.target.value })}
                  placeholder="z.B. spezielle Anweisung..."
                  style={{ background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: '#f59e0b', padding: '10px 12px', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }}
                />
              </div>

              {/* Bestätigt-Toggle */}
              {cell.chatter && !isFrei && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', cursor: 'pointer' }}>
                  <input type="checkbox" checked={cell.confirmed !== false}
                    onChange={e => setCell(editSheet.modelId, editSheet.dayIso, editSheet.shift, { ...cell, confirmed: e.target.checked })}
                    style={{ accentColor: '#10b981', width: 18, height: 18 }} />
                  <span style={{ fontSize: 13, color: cell.confirmed !== false ? '#10b981' : '#f59e0b', fontWeight: 600 }}>
                    {cell.confirmed !== false ? '✓ Bestätigt' : '! Klärung nötig'}
                  </span>
                </label>
              )}

              {/* Wöchentlich-Toggle */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', cursor: 'pointer', borderTop: '1px solid var(--border)' }}>
                <input type="checkbox" checked={isRecurring}
                  onChange={async e => {
                    if (e.target.checked && cell.chatter) { await saveRecurring(editSheet.modelId, dayOfWeek, editSheet.shift, cell) }
                    else { await saveRecurring(editSheet.modelId, dayOfWeek, editSheet.shift, { chatter: '' }) }
                  }}
                  style={{ accentColor: '#7c3aed', width: 18, height: 18 }} />
                <span style={{ fontSize: 13, color: isRecurring ? '#a78bfa' : 'var(--text-muted)', fontWeight: 600 }}>
                  ↻ Wöchentlich {isRecurring ? '(aktiv)' : ''}
                </span>
              </label>

              {/* v3.1.3: Schicht ausschreiben (Mobile) — auch bei leerer Zelle, nur __FREI__ ausnehmen */}
              {(() => {
                const editCell = getCell(editSheet.modelId, editSheet.dayIso, editSheet.shift)
                if (editCell.chatter === '__FREI__') return null
                return (
                  <button onClick={() => offerShift(editSheet.modelId, editSheet.dayIso, editSheet.shift)}
                    style={{
                      width: '100%', marginTop: 10,
                      background: 'rgba(245,158,11,0.12)', color: '#f59e0b',
                      border: '1px solid rgba(245,158,11,0.35)', borderRadius: 8,
                      padding: '11px', fontSize: 13, fontWeight: 700,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >🔄 Ausschreiben (Schicht zum Tausch anbieten)</button>
                )
              })()}

              {/* Aktion */}
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button onClick={() => {
                  setCell(editSheet.modelId, editSheet.dayIso, editSheet.shift, { chatter: '', note: '', confirmed: true })
                  setEditSheet(null)
                }} style={{ flex: 1, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', borderRadius: 8, padding: '12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Leeren</button>
                <button onClick={() => setEditSheet(null)} style={{ flex: 2, background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '12px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>✓ Fertig</button>
              </div>
            </div>
          </div>
        )
      })()}

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
            {absences.filter(a => a.date_to >= new Date().toISOString().slice(0,10)).length > 0 && <span style={{ fontSize: 10, background: 'rgba(239,68,68,0.15)', color: '#ef4444', padding: '1px 7px', borderRadius: 10, fontWeight: 700 }}>{absences.filter(a => a.date_to >= new Date().toISOString().slice(0,10)).length}</span>}
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
                {(() => {
                  const today = new Date().toISOString().slice(0, 10)
                  const active = absences.filter(a => a.date_to >= today)
                  const expired = absences.filter(a => a.date_to < today)
                  const visible = showExpiredAbsences ? absences : active
                  return (
                    <>
                      {visible.map(a => {
                        const isExpired = a.date_to < today
                        return (
                          <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-card2)', borderRadius: 8, borderLeft: `3px solid ${isExpired ? '#6b7280' : '#ef4444'}`, opacity: isExpired ? 0.6 : 1 }}>
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: isExpired ? 'var(--text-muted)' : '#ef4444' }}>{a.chatter_name}</span>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                                {new Date(a.date_from + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} – {new Date(a.date_to + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
                              </span>
                              {isExpired && <span style={{ fontSize: 10, color: '#6b7280', background: 'rgba(107,114,128,0.15)', padding: '1px 7px', borderRadius: 4 }}>Abgelaufen</span>}
                              {a.reason && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{a.reason}</span>}
                            </div>
                            <button onClick={() => deleteAbsence(a.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}
                              onMouseEnter={e => e.target.style.color = '#ef4444'}
                              onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
                          </div>
                        )
                      })}
                      {expired.length > 0 && (
                        <button onClick={() => setShowExpiredAbsences(!showExpiredAbsences)}
                          style={{ background: 'transparent', border: '1px dashed #2e2e5a', color: 'var(--text-muted)', borderRadius: 7, padding: '5px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', marginTop: 2 }}>
                          {showExpiredAbsences ? '▲ Abgelaufene ausblenden' : `▼ ${expired.length} abgelaufene anzeigen`}
                        </button>
                      )}
                    </>
                  )
                })()}
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
        <div style={{ display: 'flex', gap: 8 }}>
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
          {/* v3.16.0: Vorlage übertragen + alle Schichten auf "Klärung nötig" setzen */}
          <button onClick={async () => {
            if (!window.confirm(`Plan auf KW ${kw + 1} übertragen und alle Schichten auf "Klärung nötig" setzen?`)) return
            const next = new Date(weekStart); next.setDate(next.getDate() + 7)
            const nextKey = isoDate(next)
            const newA = {}
            for (const [key, val] of Object.entries(schedule)) {
              const parts = key.split('__')
              const d = new Date(parts[1] + 'T00:00:00'); d.setDate(d.getDate() + 7)
              const newKey = `${parts[0]}__${isoDate(d)}__${parts[2]}`
              // Freischichten unverändert lassen — die brauchen keine Klärung
              if (val && val.chatter === '__FREI__') {
                newA[newKey] = val
              } else if (val && val.chatter) {
                // Besetzte Schicht: gleiche Zuweisung, aber confirmed: false
                newA[newKey] = { ...val, confirmed: false }
              } else {
                newA[newKey] = val
              }
            }
            const { data: ex } = await supabase.from('schedule').select('id').eq('week_start', nextKey).single()
            if (ex) await supabase.from('schedule').update({ assignments: newA, shift_times: shiftTimes }).eq('week_start', nextKey)
            else await supabase.from('schedule').insert({ week_start: nextKey, assignments: newA, shift_times: shiftTimes })
            setWeekStart(next)
            alert(`✓ Plan auf KW ${kw + 1} übertragen — alle Schichten auf "Klärung nötig"!`)
          }} style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            ↻ Vorlage + alles auf Klärung
          </button>
        </div>
      </div>

      {/* v3.1.0: Send-Modal mit Checkbox-Auswahl der Chatter */}
      {sendModalOpen && (
        <div onClick={() => !sending && setSendModalOpen(false)} style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
            width: '100%', maxWidth: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Dienstplan versenden</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                KW {kw} ({formatDate(weekDays[0])} – {formatDate(weekDays[6])}) · An wen?
              </div>
            </div>

            {/* Aktions-Buttons oben: Alle / Keine */}
            <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {sendSelection.size} von {chatters.filter(c => c.telegram_id).length} ausgewählt
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setSendSelection(new Set(chatters.filter(c => c.telegram_id).map(c => c.id)))} style={{
                  background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
                  fontSize: 10, padding: '4px 9px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
                }}>Alle</button>
                <button onClick={() => setSendSelection(new Set())} style={{
                  background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
                  fontSize: 10, padding: '4px 9px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
                }}>Keine</button>
              </div>
            </div>

            {/* Chatter-Liste mit Checkbox */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
              {chatters.map(chatter => {
                const hasTg = !!chatter.telegram_id
                const isSelected = sendSelection.has(chatter.id)
                // Wie viele Schichten hat dieser Chatter diese Woche?
                let shiftCount = 0
                for (const day of weekDays) {
                  const dayIso = isoDate(day)
                  for (const shift of SHIFTS) {
                    for (const model of models) {
                      const c = getCell(model.id, dayIso, shift)
                      if (c.chatter === chatter.name) shiftCount++
                    }
                  }
                }
                return (
                  <label key={chatter.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 20px',
                    cursor: hasTg ? 'pointer' : 'not-allowed',
                    opacity: hasTg ? 1 : 0.4,
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                  }}>
                    <input
                      type="checkbox"
                      disabled={!hasTg}
                      checked={isSelected}
                      onChange={e => {
                        const next = new Set(sendSelection)
                        if (e.target.checked) next.add(chatter.id)
                        else next.delete(chatter.id)
                        setSendSelection(next)
                      }}
                      style={{ width: 16, height: 16, accentColor: '#06b6d4' }}
                    />
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {chatter.name}
                        {!hasTg && <span style={{ fontSize: 10, color: '#ef4444', marginLeft: 8 }}>· Keine Telegram-ID</span>}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {shiftCount === 0 ? 'Keine Schichten diese Woche' : `${shiftCount} Schicht${shiftCount !== 1 ? 'en' : ''} diese Woche`}
                      </div>
                    </div>
                  </label>
                )
              })}
            </div>

            {/* Action-Buttons unten */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => !sending && setSendModalOpen(false)} disabled={sending} style={{
                background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
                fontSize: 12, padding: '8px 14px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
              }}>Abbrechen</button>
              <button onClick={sendPlanToSelected} disabled={sending || sendSelection.size === 0} style={{
                background: sendSelection.size === 0 ? 'var(--border)' : '#06b6d4',
                border: 'none', color: '#fff', fontSize: 12, fontWeight: 700,
                padding: '8px 16px', borderRadius: 7,
                cursor: (sending || sendSelection.size === 0) ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              }}>{sending ? 'Sende...' : `✈ An ${sendSelection.size} senden`}</button>
            </div>
          </div>
        </div>
      )}

      {/* v3.15.0: Versand-Verlauf Modal */}
      {logModalOpen && (
        <div onClick={() => { setLogModalOpen(false); setLogExpandedId(null) }} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
          zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
            maxWidth: 720, width: '100%', maxHeight: '85vh', overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
          }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Versand-Verlauf</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Letzte 50 Sendungen (neueste zuerst)</div>
              </div>
              <button onClick={() => { setLogModalOpen(false); setLogExpandedId(null) }} style={{
                background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', padding: 0,
              }}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: 12 }}>
              {logLoading ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: 30 }}>Lade…</div>
              ) : sendLog.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: 30, lineHeight: 1.6 }}>
                  Noch keine Sendungen geloggt.<br />
                  <span style={{ fontSize: 10, opacity: 0.7 }}>
                    Sobald jemand den Plan via Telegram verschickt, erscheint der Eintrag hier.
                  </span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {sendLog.map(log => {
                    const isExpanded = logExpandedId === log.id
                    const dt = new Date(log.sent_at)
                    const dateStr = dt.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
                    const timeStr = dt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
                    const typeLabel = log.action_type === 'plan_full' ? 'Plan an alle'
                      : log.action_type === 'plan_partial' ? 'Plan (Auswahl)'
                      : log.action_type === 'update' ? 'Update'
                      : 'Sendung'
                    const typeColor = log.action_type === 'plan_full' ? '#06b6d4'
                      : log.action_type === 'plan_partial' ? '#a78bfa'
                      : log.action_type === 'update' ? '#f59e0b'
                      : '#64748b'
                    return (
                      <div key={log.id} style={{
                        border: '1px solid var(--border)', borderRadius: 7,
                        background: isExpanded ? 'var(--bg-card2)' : 'transparent',
                      }}>
                        <div onClick={() => setLogExpandedId(isExpanded ? null : log.id)} style={{
                          padding: '8px 12px', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                        }}>
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                            background: `${typeColor}18`, color: typeColor, whiteSpace: 'nowrap',
                          }}>{typeLabel}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                            {dateStr} · {timeStr}
                          </span>
                          {log.kw && (
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>KW {log.kw}</span>
                          )}
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            an {log.recipients_count} {log.recipients_count === 1 ? 'Person' : 'Personen'}
                            {log.recipients_skipped > 0 && (
                              <span style={{ color: '#f59e0b' }}> · {log.recipients_skipped} ohne TG</span>
                            )}
                          </span>
                          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>
                            {log.sent_by}
                          </span>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{isExpanded ? '▲' : '▼'}</span>
                        </div>
                        {isExpanded && (
                          <div style={{ padding: '0 12px 12px', borderTop: '1px solid var(--border)' }}>
                            {log.recipient_names && log.recipient_names.length > 0 && (
                              <div style={{ marginTop: 10 }}>
                                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: 4 }}>
                                  Empfänger ({log.recipient_names.length})
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                                  {log.recipient_names.join(', ')}
                                </div>
                              </div>
                            )}
                            {log.message_text && (
                              <div style={{ marginTop: 12 }}>
                                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: 4 }}>
                                  Nachricht (Vorschau)
                                </div>
                                <pre style={{
                                  fontSize: 11, color: 'var(--text-primary)',
                                  background: 'var(--bg-card)', padding: '8px 10px',
                                  borderRadius: 5, border: '1px solid var(--border)',
                                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                  fontFamily: 'inherit', margin: 0, maxHeight: 240, overflowY: 'auto',
                                }}>{log.message_text}</pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <button onClick={loadSendLog} disabled={logLoading} style={{
                background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
                fontSize: 11, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
              }}>↻ Aktualisieren</button>
              <button onClick={() => { setLogModalOpen(false); setLogExpandedId(null) }} style={{
                background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
                fontSize: 12, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
              }}>Schließen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
