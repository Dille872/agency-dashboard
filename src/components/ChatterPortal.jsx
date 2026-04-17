import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { formatMoney, pctChange, getLast7Snapshots } from '../utils'
import SocialTab from './SocialTab'
import { getTheme, setTheme } from '../theme'

const APP_VERSION = 'v2.0.1'

const ADMIN_TZ = 'Europe/Berlin'

function getTimezoneOffset(dateStr, tz) {
  try {
    const d = new Date(dateStr)
    const utcMs = d.getTime()
    const tzMs = new Date(d.toLocaleString('en-US', { timeZone: tz })).getTime()
    return Math.round((tzMs - utcMs) / 60000)
  } catch { return 0 }
}

function convertTimeToLocal(timeStr) {
  if (!timeStr) return timeStr
  const parts = timeStr.split('-').map(t => t.trim())
  const now = new Date()
  const converted = parts.map(t => {
    const [h, m] = t.split(':').map(Number)
    if (isNaN(h)) return t
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(h).padStart(2,'0')}:${String(m||0).padStart(2,'0')}:00`
    const berlinOffset = getTimezoneOffset(dateStr, ADMIN_TZ)
    const localOffset = getTimezoneOffset(dateStr, Intl.DateTimeFormat().resolvedOptions().timeZone)
    const diffMins = localOffset - berlinOffset
    const totalMins = h * 60 + (m || 0) + diffMins
    const localH = ((Math.floor(totalMins / 60) % 24) + 24) % 24
    const localM = ((totalMins % 60) + 60) % 60
    return `${String(localH).padStart(2,'0')}:${String(localM).padStart(2,'0')}`
  })
  return converted.join('-')
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

function getWeekDays(weekStart) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d
  })
}

function isoDate(date) {
  return date.toISOString().slice(0, 10)
}

function formatDate(date) {
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
}

function isToday(date) {
  return isoDate(date) === isoDate(new Date())
}

function getKW(date) {
  const d = new Date(date)
  const onejan = new Date(d.getFullYear(), 0, 1)
  return Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7)
}

function SwapRequestForm({ displayName, myNext7Shifts }) {
  const [swapShift, setSwapShift] = useState('')
  const [swapReason, setSwapReason] = useState('')
  const [sending, setSending] = useState(false)
  const [mySwaps, setMySwaps] = useState([])

  useEffect(() => {
    loadMySwaps()
  }, [])

  const loadMySwaps = async () => {
    const { data } = await supabase.from('shift_swaps').select('*')
      .eq('requester_name', displayName)
      .order('created_at', { ascending: false })
      .limit(10)
    setMySwaps(data || [])
  }

  const submitSwap = async () => {
    if (!swapShift) return
    setSending(true)
    const parts = swapShift.split('__')
    await supabase.from('shift_swaps').insert({
      requester_name: displayName,
      shift_date: parts[0],
      shift: parts[1],
      model_name: parts[2] || '?',
      reason: swapReason || null,
      status: 'offen',
    })
    setSwapShift('')
    setSwapReason('')
    await loadMySwaps()
    setSending(false)
    alert('✓ Tausch-Anfrage gesendet!')
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <select value={swapShift} onChange={e => setSwapShift(e.target.value)}
          style={{ flex: 1, minWidth: 160, background: 'var(--bg-input)', border: '1px solid var(--border-bright)', color: swapShift ? 'var(--text-primary)' : 'var(--text-muted)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}>
          <option value="">— Schicht wählen —</option>
          {myNext7Shifts.map((s, i) => {
            const dayLabel = s.day.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
            const modelName = s.models[0]?.modelName || '?'
            const val = `${s.dayIso}__${s.shift}__${modelName}`
            return <option key={i} value={val}>{dayLabel} · {s.shift} · {modelName}</option>
          })}
        </select>
        <input value={swapReason} onChange={e => setSwapReason(e.target.value)}
          placeholder="Grund (optional)"
          style={{ flex: 1, minWidth: 120, background: 'var(--bg-input)', border: '1px solid var(--border-bright)', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }} />
        <button onClick={submitSwap} disabled={!swapShift || sending}
          style={{ background: swapShift ? 'rgba(245,158,11,0.15)' : 'var(--border)', color: swapShift ? '#f59e0b' : 'var(--text-muted)', border: `1px solid ${swapShift ? 'rgba(245,158,11,0.3)' : 'var(--border)'}`, borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
          {sending ? '...' : '↔ Anfragen'}
        </button>
      </div>
      {mySwaps.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {mySwaps.map(s => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: 'var(--bg-card2)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12 }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                {new Date(s.shift_date + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })} · {s.shift} · {s.model_name}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, color: s.status === 'offen' ? '#f59e0b' : s.status === 'angenommen' ? '#10b981' : '#ef4444' }}>
                {s.status === 'offen' ? 'Offen' : s.status === 'angenommen' ? `✓ ${s.accepted_by}` : 'Abgelehnt'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ChatterPortal({ session, displayName: initialDisplayName, onSwitchToAdmin, isSocialMedia, isPreview }) {
  const [theme, setThemeState] = useState(() => getTheme())
  const [showSocialPortal, setShowSocialPortal] = useState(false)
  const [previewChatter, setPreviewChatter] = useState('')
  const [allChatters, setAllChatters] = useState([])
  const displayName = isPreview ? (previewChatter || '') : initialDisplayName

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setThemeState(next)
  }
  const [isOnline, setIsOnline] = useState(false)
  const [selectedShift, setSelectedShift] = useState('')
  const [currentLogId, setCurrentLogId] = useState(null)
  const [checkInTime, setCheckInTime] = useState(null)
  const [messages, setMessages] = useState([])
  const [models, setModels] = useState([])
  const [noteText, setNoteText] = useState('')
  const [noteModel, setNoteModel] = useState('')
  const [noteShift, setNoteShift] = useState('')
  const [sendingNote, setSendingNote] = useState(false)
  const [scheduleData, setScheduleData] = useState({})
  const [shiftTimes, setShiftTimes] = useState({})
  const [chatterStats, setChatterStats] = useState(null)
  const [chatterSnapshots, setChatterSnapshots] = useState([])
  const [weekStart] = useState(() => getWeekStart(new Date()))
  const [myReminders, setMyReminders] = useState([])
  const [myAbsences, setMyAbsences] = useState([])
  const [newAbsenceDate, setNewAbsenceDate] = useState('')
  const [newAbsenceReason, setNewAbsenceReason] = useState('')
  const [next7Schedules, setNext7Schedules] = useState([])
  const [absentLoading, setAbsentLoading] = useState(false)

  const weekDays = getWeekDays(weekStart)
  const weekKey = isoDate(weekStart)
  const kw = getKW(weekStart)
  const todayIso = isoDate(new Date())

  const [contentRequests, setContentRequests] = useState([])
  const [newRequestModel, setNewRequestModel] = useState('')
  const [newRequestText, setNewRequestText] = useState('')
  const [newRequestType, setNewRequestType] = useState('video')
  const [newRequestPrice, setNewRequestPrice] = useState('')
  const [newRequestDeposit, setNewRequestDeposit] = useState('')
  const [newRequestDuration, setNewRequestDuration] = useState('')
  const [newRequestQuantity, setNewRequestQuantity] = useState('1')
  const [newRequestCustomerId, setNewRequestCustomerId] = useState('')
  const [sendingRequest, setSendingRequest] = useState(false)
  const [assignedModelBoards, setAssignedModelBoards] = useState({}) // modelName → board map
  const [assignedModelVideos, setAssignedModelVideos] = useState({}) // modelName → videos
  const [assignedServices, setAssignedServices] = useState({}) // modelName → services
  const [assignedCustomContent, setAssignedCustomContent] = useState({}) // modelName → custom content
  const [selectedModelInfo, setSelectedModelInfo] = useState(null)

  const loadAssignedModelData = async (modelNames) => {
    if (!modelNames || modelNames.length === 0) return
    const boards = {}
    const vids = {}
    const svcs = {}
    const customContents = {}
    for (const name of modelNames) {
      const { data: boardData } = await supabase.from('model_board').select('*').eq('model_name', name).order('sort_order')
      const map = {}
      for (const item of boardData || []) {
        if (item.category === 'service_flags') {
          if (!svcs[name]) svcs[name] = {}
          svcs[name][item.title] = { enabled: item.yes_no, note: item.content }
        } else {
          if (!map[item.category]) map[item.category] = []
          map[item.category].push(item)
        }
      }
      boards[name] = map
      const { data: videoData } = await supabase.from('model_videos').select('*').eq('model_name', name).order('release_date')
      vids[name] = videoData || []
      const { data: ccData } = await supabase.from('custom_content').select('*').eq('model_name', name).eq('completed', false).order('due_date')
      customContents[name] = ccData || []
    }
    setAssignedModelBoards(boards)
    setAssignedModelVideos(vids)
    setAssignedServices(svcs)
    setAssignedCustomContent(customContents)
  }

  const loadContentRequests = async () => {
    const twoWeeksAgo = new Date()
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)
    const { data } = await supabase.from('content_requests')
      .select('*')
      .eq('chatter_name', displayName)
      .gte('created_at', twoWeeksAgo.toISOString())
      .order('created_at', { ascending: false })
    setContentRequests(data || [])
  }

  const submitContentRequest = async () => {
    if (!newRequestModel || !newRequestText.trim() || !newRequestPrice) return
    setSendingRequest(true)
    await supabase.from('content_requests').insert({
      chatter_name: displayName,
      model_name: newRequestModel,
      request_text: newRequestText.trim(),
      content_type: newRequestType,
      price: parseFloat(newRequestPrice) || 0,
      deposit: parseFloat(newRequestDeposit) || 0,
      duration: newRequestDuration.trim() || null,
      quantity: parseInt(newRequestQuantity) || 1,
      customer_id: newRequestCustomerId.trim() || null,
      status: 'neu',
    })
    setNewRequestModel(''); setNewRequestText(''); setNewRequestType('video')
    setNewRequestPrice(''); setNewRequestDeposit(''); setNewRequestDuration('')
    setNewRequestQuantity('1'); setNewRequestCustomerId('')
    await loadContentRequests()
    setSendingRequest(false)
    alert('✓ Anfrage gesendet!')
  }

  const sendHeartbeat = async (shiftOnline) => {
    await supabase.from('online_status').upsert({
      display_name: displayName,
      last_seen: new Date().toISOString(),
      shift_online: shiftOnline,
    }, { onConflict: 'display_name' })
  }

  const checkIn = async (shiftName) => {
    const shiftToLog = shiftName || selectedShift || todayShifts.map(s => s.shift).join(', ') || 'Manuell'
    const { data } = await supabase.from('shift_logs').insert({
      display_name: displayName,
      checked_in_at: new Date().toISOString(),
      shift: shiftToLog,
    }).select().single()
    if (data) {
      setCurrentLogId(data.id)
      setCheckInTime(new Date())
    }
    setIsOnline(true)
    setSelectedShift('')
    await sendHeartbeat(true)
  }

  const checkOut = async () => {
    if (currentLogId) {
      await supabase.from('shift_logs').update({
        checked_out_at: new Date().toISOString(),
      }).eq('id', currentLogId)
    }
    setIsOnline(false)
    setCurrentLogId(null)
    setCheckInTime(null)
    await sendHeartbeat(false)
  }

  useEffect(() => {
    if (isPreview) {
      supabase.from('chatters_contact').select('name').order('name').then(({ data }) => {
        setAllChatters(data || [])
        if (data && data.length > 0) setPreviewChatter(data[0].name)
      })
    }
  }, [isPreview])

  // Reload stats when chatter changes in preview
  useEffect(() => {
    if (isPreview && displayName) {
      loadStats()
      loadSchedule()
      loadContentRequests()
      loadModels()
    }
  }, [displayName])

  useEffect(() => {
    loadMessages()
    loadSchedule()
    loadStats()
    loadModels()
    loadContentRequests()
    loadMyReminders()
    loadMyAbsences()
    loadOnlineStatus()
    const interval = setInterval(() => {
      loadMessages()
      sendHeartbeat(isOnline)
    }, 30000)
    return () => {
      clearInterval(interval)
    }
  }, [])

  // Update heartbeat when online status changes
  useEffect(() => {
    sendHeartbeat(isOnline)
  }, [isOnline])

  const loadOnlineStatus = async () => {
    // Check if there's an open shift log (checked in but not checked out)
    const { data: openLog } = await supabase
      .from('shift_logs')
      .select('*')
      .eq('display_name', displayName)
      .is('checked_out_at', null)
      .order('checked_in_at', { ascending: false })
      .limit(1)
      .single()
    if (openLog) {
      setIsOnline(true)
      setCurrentLogId(openLog.id)
      setCheckInTime(new Date(openLog.checked_in_at))
      await sendHeartbeat(true)
    }
  }

  const loadMessages = async () => {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('direction', 'out')
      .order('created_at', { ascending: false })
      .limit(10)
    setMessages(data || [])
  }

  const loadModels = async () => {
    const { data } = await supabase.from('models_contact').select('*').order('name')
    setModels(data || [])
  }

  const loadSchedule = async () => {
    const { data } = await supabase.from('schedule').select('*').eq('week_start', weekKey).single()
    if (data) {
      setScheduleData(data.assignments || {})
      setShiftTimes(data.shift_times || {})
    }
    // Also load next 7 days schedules
    await loadNext7Days()
  }

  const loadNext7Days = async () => {
    const today = new Date()
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today)
      d.setDate(today.getDate() + i)
      return d
    })
    // Get both Monday-based and Sunday-based week starts to cover all schedule formats
    const weekStartsSet = new Set()
    for (const d of days) {
      const mondayStart = isoDate(getWeekStart(d))
      weekStartsSet.add(mondayStart)
      // Also add Sunday-based (one day before Monday)
      const sundayStart = new Date(getWeekStart(d))
      sundayStart.setDate(sundayStart.getDate() - 1)
      weekStartsSet.add(isoDate(sundayStart))
    }
    const weekStarts = [...weekStartsSet]
    const { data } = await supabase.from('schedule').select('*').in('week_start', weekStarts).eq('status', 'live')
    setNext7Schedules(data || [])
    // Extract model names assigned to this chatter
    const todayIso = isoDate(new Date())
    const assignedNames = new Set()
    for (const sched of data || []) {
      for (const [key, val] of Object.entries(sched.assignments || {})) {
        if (val.chatter === displayName) {
          assignedNames.add(key.split('__')[0])
        }
      }
    }
    // Also get model names from models_contact
    const { data: modelsData } = await supabase.from('models_contact').select('name, id')
    const modelNameMap = {}
    for (const m of modelsData || []) modelNameMap[String(m.id)] = m.name
    const resolvedNames = [...assignedNames].map(id => modelNameMap[id] || id).filter(Boolean)
    if (resolvedNames.length > 0) loadAssignedModelData(resolvedNames)
  }

  const loadMyReminders = async () => {
    const { data } = await supabase.from('reminders')
      .select('*')
      .eq('chatter_name', displayName)
      .eq('sent', false)
      .order('send_at')
    setMyReminders(data || [])
  }

  const loadMyAbsences = async () => {
    const today = isoDate(new Date())
    const { data } = await supabase.from('absences')
      .select('*')
      .eq('chatter_name', displayName)
      .gte('date_to', today)
      .order('date_from')
    setMyAbsences(data || [])
  }

  const addAbsence = async () => {
    if (!newAbsenceDate) return
    setAbsentLoading(true)
    await supabase.from('absences').insert({
      chatter_name: displayName,
      date_from: newAbsenceDate,
      date_to: newAbsenceDate,
      reason: newAbsenceReason || 'Nicht verfügbar',
    })
    setNewAbsenceDate('')
    setNewAbsenceReason('')
    await loadMyAbsences()
    setAbsentLoading(false)
    alert('✓ Abwesenheit eingetragen!')
  }

  const deleteAbsence = async (id) => {
    await supabase.from('absences').delete().eq('id', id)
    loadMyAbsences()
  }

  const [lastStatDate, setLastStatDate] = useState(null)

  const loadStats = async () => {
    const { data } = await supabase
      .from('chatter_snapshots')
      .select('*')
      .order('business_date', { ascending: true })
    const snapshots = (data || []).map(s => ({
      businessDate: s.business_date,
      rows: s.rows,
    }))
    setChatterSnapshots(snapshots)

    // Find last day this chatter has data
    const mySnaps = snapshots.filter(s =>
      s.rows?.some(r => r.name?.toLowerCase() === displayName?.toLowerCase())
    )
    if (mySnaps.length === 0) return
    const lastSnap = mySnaps[mySnaps.length - 1]
    const myRow = lastSnap.rows.find(r => r.name?.toLowerCase() === displayName?.toLowerCase())
    if (myRow) {
      setChatterStats(myRow)
      setLastStatDate(lastSnap.businessDate)
    }
  }

  const sendNote = async () => {
    if (!noteText.trim()) return
    setSendingNote(true)
    const modelPart = noteModel ? `[${noteModel}]` : ''
    const shiftPart = noteShift ? `[${noteShift}]` : ''
    const prefix = [modelPart, shiftPart].filter(Boolean).join(' ')
    await supabase.from('notes').insert({
      text: `Schichtnotiz von ${displayName}${prefix ? ' · ' + prefix : ''}: ${noteText.trim()}`,
      author: displayName,
    })
    setNoteText('')
    setNoteModel('')
    setNoteShift('')
    setSendingNote(false)
    alert('✓ Notiz gesendet!')
  }

  // Get my shifts this week
  const myShifts = []
  for (const day of weekDays) {
    const dayIso = isoDate(day)
    for (const shift of SHIFTS) {
      const modelsInShift = []
      for (const [key, val] of Object.entries(scheduleData)) {
        const parts = key.split('__')
        if (parts[1] === dayIso && parts[2] === shift && val.chatter === displayName) {
          modelsInShift.push(val)
        }
      }
      if (modelsInShift.length > 0) {
        myShifts.push({ day, dayIso, shift, models: modelsInShift })
      }
    }
  }

  // Get my shifts next 7 days from all loaded schedules
  const next7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() + i)
    return d
  })
  const myNext7Shifts = []
  for (const day of next7Days) {
    const dayIso = isoDate(day)
    for (const sched of next7Schedules) {
      const assignments = sched.assignments || {}
      const times = sched.shift_times || {}
      for (const shift of SHIFTS) {
        const modelsInShift = []
        for (const [key, val] of Object.entries(assignments)) {
          const parts = key.split('__')
          if (parts[1] === dayIso && parts[2] === shift && val.chatter === displayName) {
            const modelId = parts[0]
            const modelObj = models.find(m => String(m.id) === String(modelId))
            const timeStr = (times[`${modelId}__${shift}`] || '').replace(/\s*\(DE\)/g, '')
            const localTime = timeStr ? convertTimeToLocal(timeStr) : ''
            modelsInShift.push({ modelId, modelName: modelObj?.name || modelId, timeStr, localTime })
          }
        }
        if (modelsInShift.length > 0) {
          const reminder = myReminders.find(r => r.shift_date === dayIso && r.shift === shift)
          // Check if shift end time has passed for today
          const firstModel = modelsInShift[0]
          const timeStr = firstModel.timeStr || ''
          const endTimeStr = timeStr.split('-')[1]?.trim()
          let isExpired = false
          if (dayIso === todayIso && endTimeStr) {
            const [endH, endM] = endTimeStr.split(':').map(Number)
            const now = new Date()
            const endTime = new Date()
            endTime.setHours(endH, endM, 0, 0)
            // Handle overnight shifts (end time < start time means next day)
            const startTimeStr = timeStr.split('-')[0]?.trim()
            const [startH] = startTimeStr ? startTimeStr.split(':').map(Number) : [0]
            if (endH < startH) endTime.setDate(endTime.getDate() + 1)
            isExpired = now > endTime
          }
          if (!isExpired) {
            myNext7Shifts.push({ day, dayIso, shift, models: modelsInShift, reminder })
          }
        }
      }
    }
  }

  // Monthly revenue
  const currentMonth = new Date().toISOString().slice(0, 7)
  const monthSnaps = chatterSnapshots.filter(s => s.businessDate.startsWith(currentMonth))
  const monthRevenue = monthSnaps.reduce((sum, snap) => {
    const row = snap.rows?.find(r => r.name?.toLowerCase() === displayName?.toLowerCase())
    return sum + (row?.revenue || 0)
  }, 0)

  // Week stats from snapshots
  const weekSnaps = chatterSnapshots.filter(s => {
    const d = new Date(s.businessDate + 'T00:00:00')
    return d >= weekStart && d <= weekDays[6]
  })
  const weekRevenue = weekSnaps.reduce((sum, snap) => {
    const row = snap.rows?.find(r => r.name?.toLowerCase() === displayName?.toLowerCase())
    return sum + (row?.revenue || 0)
  }, 0)
  const weekMessages = weekSnaps.reduce((sum, snap) => {
    const row = snap.rows?.find(r => r.name?.toLowerCase() === displayName?.toLowerCase())
    return sum + (row?.sentMessages || 0)
  }, 0)
  const weekSentPPVs = weekSnaps.reduce((sum, snap) => {
    const row = snap.rows?.find(r => r.name?.toLowerCase() === displayName?.toLowerCase())
    return sum + (row?.sentPPVs || 0)
  }, 0)
  const weekBoughtPPVs = weekSnaps.reduce((sum, snap) => {
    const row = snap.rows?.find(r => r.name?.toLowerCase() === displayName?.toLowerCase())
    return sum + (row?.boughtPPVs || 0)
  }, 0)
  const weekBuyRate = weekSentPPVs > 0 ? (weekBoughtPPVs / weekSentPPVs * 100) : 0
  const weekActiveMinutes = weekSnaps.reduce((sum, snap) => {
    const row = snap.rows?.find(r => r.name?.toLowerCase() === displayName?.toLowerCase())
    return sum + (row?.activeMinutes || 0)
  }, 0)
  const weekRPH = weekActiveMinutes > 0 ? weekRevenue / (weekActiveMinutes / 60) : 0

  // Yesterday stats for delta
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  const yesterdaySnap = chatterSnapshots.find(s => s.businessDate === isoDate(yesterday))
  const yesterdayRow = yesterdaySnap?.rows?.find(r => r.name?.toLowerCase() === displayName?.toLowerCase())
  const revDelta = yesterdayRow ? pctChange(chatterStats?.revenue || 0, yesterdayRow.revenue) : 0

  const sR = { padding: '6px 0', borderBottom: '1px solid #1e1e3a', display: 'flex', justifyContent: 'space-between', fontSize: 12 }

  const formatResponseTime = (secs) => {
    if (!secs) return '—'
    const m = Math.floor(secs / 60)
    const s = Math.round(secs % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }

  const formatTime = (ts) => {
    const d = new Date(ts)
    const now = new Date()
    const diffH = (now - d) / 3600000
    if (diffH < 24) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', fontFamily: 'var(--font-sans)', color: 'var(--text-primary)' }}>
      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(7,7,16,0.97)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid #1e1e3a', padding: '0 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        minHeight: 56, flexWrap: 'wrap', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #06b6d4, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: '#fff', fontFamily: 'monospace' }}>T</div>
          <div>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Thirteen 87</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 6 }}>Chatter Portal</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{APP_VERSION}</span>
          {isPreview ? (
            <select value={previewChatter} onChange={e => setPreviewChatter(e.target.value)}
              style={{ background: 'var(--bg-input)', border: '1px solid rgba(6,182,212,0.4)', color: '#06b6d4', padding: '4px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}>
              {allChatters.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{displayName}</span>
          )}
          {isSocialMedia && (
            <button onClick={() => setShowSocialPortal(!showSocialPortal)} style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, background: showSocialPortal ? '#ec4899' : 'rgba(236,72,153,0.12)', border: '1px solid rgba(236,72,153,0.3)', color: showSocialPortal ? '#fff' : '#ec4899', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
              Social
            </button>
          )}
          {onSwitchToAdmin && (
            <button onClick={onSwitchToAdmin} style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
              ⚙ Admin
            </button>
          )}
          <button onClick={() => supabase.auth.signOut()} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, background: 'transparent', border: '1px solid #1e1e3a', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>↩</button>
          <button onClick={toggleTheme} style={{ fontSize: 14, padding: '5px 8px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }} title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <main style={{ padding: '16px 20px', maxWidth: 1200, margin: '0 auto' }}>
        {showSocialPortal ? (
          <SocialTab session={session} userDisplayName={displayName} userRole="social_media" />
        ) : (
        <div>

        {/* Today Banner */}
        {todayShifts.length > 0 && (
          <div style={{ background: isOnline ? 'rgba(16,185,129,0.08)' : 'rgba(124,58,237,0.06)', border: `1px solid ${isOnline ? 'rgba(16,185,129,0.25)' : 'rgba(124,58,237,0.2)'}`, borderRadius: 10, padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: isOnline ? '#10b981' : 'var(--text-primary)', marginBottom: 3 }}>
                {isOnline ? '🟢 Schicht aktiv' : '⚪ Schicht noch nicht gestartet'}
                {isOnline
                  ? ` · ${selectedShift || todayShifts.map(s => s.shift).join(' + ')}`
                  : todayShifts.length === 1 ? ` · ${todayShifts[0].shift}` : ''}
              </div>
              {isOnline && todayShifts.length > 0 && (
                <div style={{ fontSize: 11, color: '#10b981', marginBottom: 2 }}>
                  Models: {[...new Set(todayShifts.flatMap(s => s.models.map(m => m.modelName || m)))].join(', ')}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {new Date(todayIso + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                {checkInTime && ` · Eingecheckt: ${checkInTime.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {!isOnline ? (
                <>
                  {todayShifts.length > 1 && (
                    <select value={selectedShift} onChange={e => setSelectedShift(e.target.value)}
                      style={{ background: 'var(--bg-input)', border: '1px solid #7c3aed', color: 'var(--text-primary)', padding: '6px 10px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none', cursor: 'pointer' }}>
                      <option value="">Schicht wählen...</option>
                      {todayShifts.map(s => <option key={s.shift} value={s.shift}>{s.shift} · {s.models.map(m => m.modelName || m).join(', ')}</option>)}
                    </select>
                  )}
                  <button onClick={() => checkIn()} disabled={todayShifts.length > 1 && !selectedShift}
                    style={{ background: todayShifts.length > 1 && !selectedShift ? 'var(--border)' : '#10b981', color: todayShifts.length > 1 && !selectedShift ? 'var(--text-muted)' : '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: todayShifts.length > 1 && !selectedShift ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                    ✓ {todayShifts.length === 1 ? `${todayShifts[0].shift} starten` : 'Schicht starten'}
                  </button>
                </>
              ) : (
                <button onClick={checkOut} style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  ✕ Schicht beenden
                </button>
              )}
            </div>
          </div>
        )}

        {/* KPIs */}
        {/* Last day label */}
        {lastStatDate && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontFamily: 'monospace' }}>
            Letzter Tag mit Daten: <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{new Date(lastStatDate + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'Revenue', val: formatMoney(chatterStats?.revenue || 0), sub: revDelta !== 0 ? `${revDelta > 0 ? '▲' : '▼'} ${Math.abs(revDelta).toFixed(1)}% vs Vortag` : lastStatDate ? new Date(lastStatDate + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : 'Noch keine Daten', good: revDelta >= 0 },
            { label: 'PPV Buy Rate', val: chatterStats ? `${(chatterStats.buyRate || 0).toFixed(1)}%` : '—', sub: lastStatDate ? new Date(lastStatDate + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : 'Keine Daten', good: (chatterStats?.buyRate || 0) >= 25 },
            { label: 'Ø Antwortzeit', val: formatResponseTime(chatterStats?.avgResponseSeconds), sub: (chatterStats?.avgResponseSeconds || 0) <= 120 ? 'Gut ✓' : (chatterStats?.avgResponseSeconds || 0) <= 210 ? 'Ok' : 'Zu langsam', good: (chatterStats?.avgResponseSeconds || 0) <= 120 },
            { label: 'Nachrichten', val: (chatterStats?.sentMessages || 0).toString(), sub: lastStatDate ? new Date(lastStatDate + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : 'Keine Daten', good: (chatterStats?.sentMessages || 0) > 50 },
          ].map(kpi => (
            <div key={kpi.label} style={{ background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 4 }}>{kpi.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)', lineHeight: 1.2 }}>{kpi.val}</div>
              <div style={{ fontSize: 11, color: kpi.good ? '#10b981' : '#ef4444', marginTop: 2 }}>{kpi.sub}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 16 }}>
          {/* My Shifts – next 7 days */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '16px 18px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 3, height: 11, background: '#06b6d4', borderRadius: 2, display: 'inline-block' }} />
              Meine Schichten – nächste 7 Tage
            </div>
            {myNext7Shifts.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0', textAlign: 'center' }}>Kein veröffentlichter Plan für die nächsten 7 Tage</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {myNext7Shifts.map((s, i) => {
                  const today = isToday(s.day)
                  const past = s.day < new Date() && !today
                  const dayLabel = s.day.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
                  return (
                    <div key={i} style={{
                      padding: '10px 12px', background: today ? 'rgba(16,185,129,0.05)' : 'var(--bg-card2)',
                      borderRadius: 8, border: `1px solid ${today ? 'rgba(16,185,129,0.3)' : 'var(--border)'}`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: s.models.length > 1 ? 8 : 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 4, height: 32, borderRadius: 2, background: SHIFT_COLORS[s.shift], flexShrink: 0 }} />
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: today ? '#10b981' : 'var(--text-primary)' }}>
                              {dayLabel}{today ? ' · Heute' : ''}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 1 }}>
                              {s.shift}{s.models[0]?.localTime ? ` · ${s.models[0].localTime} (lokal)` : s.models[0]?.timeStr ? ` · ${s.models[0].timeStr} (DE)` : ''}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {s.reminder && (
                            <span style={{ fontSize: 10, color: '#06b6d4', background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.3)', padding: '2px 7px', borderRadius: 4 }}>🔔</span>
                          )}
                          <span style={{
                            fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 700,
                            background: today ? 'rgba(16,185,129,0.15)' : past ? 'rgba(255,255,255,0.04)' : 'rgba(124,58,237,0.15)',
                            color: today ? '#10b981' : past ? 'var(--text-muted)' : '#a78bfa',
                          }}>
                            {today ? 'Heute' : past ? 'Erledigt' : 'Geplant'}
                          </span>
                        </div>
                      </div>
                      {/* Model list */}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: 14 }}>
                        {s.models.map((m, mi) => (
                          <span key={mi} style={{ fontSize: 10, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 7px', color: 'var(--text-secondary)' }}>
                            {m.modelName}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Abwesenheit eintragen */}
            <div style={{ marginTop: 16, borderTop: '1px solid #1e1e3a', paddingTop: 14 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 10 }}>Ich bin nicht verfügbar am</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <input type="date" value={newAbsenceDate} onChange={e => setNewAbsenceDate(e.target.value)}
                  style={{ background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '6px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'monospace', outline: 'none', flex: 1 }} />
                <input value={newAbsenceReason} onChange={e => setNewAbsenceReason(e.target.value)}
                  placeholder="Grund (optional)"
                  style={{ background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '6px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none', flex: 1 }} />
                <button onClick={addAbsence} disabled={!newAbsenceDate || absentLoading}
                  style={{ background: newAbsenceDate ? 'rgba(239,68,68,0.15)' : 'var(--border)', color: newAbsenceDate ? '#ef4444' : 'var(--text-muted)', border: `1px solid ${newAbsenceDate ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`, borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                  + Eintragen
                </button>
              </div>
              {myAbsences.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {myAbsences.map(a => (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'rgba(239,68,68,0.06)', borderRadius: 6, border: '1px solid rgba(239,68,68,0.2)', fontSize: 12 }}>
                      <span style={{ color: '#ef4444' }}>{new Date(a.date_from + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })} · {a.reason}</span>
                      <button onClick={() => deleteAbsence(a.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Messages + Note */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '16px 18px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 3, height: 11, background: '#7c3aed', borderRadius: 2, display: 'inline-block' }} />
              Nachrichten vom Team
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
              {messages.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '8px 0' }}>Noch keine Nachrichten</div>
              ) : messages.slice(0, 4).map(msg => (
                <div key={msg.id} style={{ padding: '9px 12px', background: 'var(--bg-card2)', borderRadius: 8, border: '1px solid rgba(124,58,237,0.2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: msg.sent_by === 'Chris' ? '#a78bfa' : '#06b6d4' }}>{msg.sent_by || 'Team'}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{formatTime(msg.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{msg.text}</div>
                </div>
              ))}
            </div>
            <div style={{ borderTop: '1px solid #1e1e3a', paddingTop: 12 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 10 }}>Schichtnotiz hinterlassen</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 120 }}>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Model</label>
                  <select
                    value={noteModel}
                    onChange={e => setNoteModel(e.target.value)}
                    style={{ background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: noteModel ? 'var(--text-primary)' : 'var(--text-muted)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
                  >
                    <option value="">— Model wählen —</option>
                    {myShifts.filter(s => s.dayIso === todayIso).flatMap(s => Object.values(s.models)).map((_, i) => null)}
                    {[...new Set(myShifts.map(s => s.dayIso === todayIso ? s.shift : null).filter(Boolean))].length > 0
                      ? myShifts.filter(s => s.dayIso === todayIso).map((s, i) => (
                          <option key={i} value={s.shift}>{s.shift}</option>
                        ))
                      : null
                    }
                    {models.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Schicht</label>
                  <select
                    value={noteShift}
                    onChange={e => setNoteShift(e.target.value)}
                    style={{ background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: noteShift ? 'var(--text-primary)' : 'var(--text-muted)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
                  >
                    <option value="">— Schicht —</option>
                    {['Früh', 'Spät', 'Nacht'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                rows={2}
                placeholder="z.B. Sehr aktiv heute, viele PPVs verkauft..."
                style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 7, fontSize: 12, resize: 'none', fontFamily: 'inherit', outline: 'none', marginBottom: 8 }}
              />
              <button onClick={sendNote} disabled={sendingNote || !noteText.trim()} style={{
                background: noteText.trim() ? '#7c3aed' : 'var(--border)', color: noteText.trim() ? '#fff' : 'var(--text-muted)',
                border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 700, cursor: noteText.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
              }}>{sendingNote ? 'Senden...' : 'Notiz senden'}</button>
            </div>
          </div>
        </div>

        {/* Meine Models – Board & Videos */}
        {Object.keys(assignedModelBoards).length > 0 && (
          <div style={{ background: 'rgba(245,158,11,0.06)', border: '1.5px solid rgba(245,158,11,0.25)', borderRadius: 12, padding: '16px 18px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
              <span style={{ width: 3, height: 13, background: '#f59e0b', borderRadius: 2, display: 'inline-block' }} />
              <span style={{ fontSize: 10, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Meine Models</span>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {Object.keys(assignedModelBoards).map(name => (
                <button key={name} onClick={() => setSelectedModelInfo(selectedModelInfo === name ? null : name)}
                  style={{ padding: '5px 14px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 12,
                    background: selectedModelInfo === name ? '#f59e0b' : 'var(--bg-card)',
                    color: selectedModelInfo === name ? '#000' : 'var(--text-secondary)',
                    border: `1px solid ${selectedModelInfo === name ? '#f59e0b' : '#2e2e5a'}` }}>
                  {name}
                </button>
              ))}
            </div>

            {selectedModelInfo && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
                {/* Board categories */}
                {Object.entries(assignedModelBoards[selectedModelInfo] || {}).map(([cat, items]) => {
                  const catColors = { preise: '#10b981', nogos: '#ef4444', regeln: '#a78bfa', services: '#f59e0b', einschraenkungen: '#06b6d4', reise: '#06b6d4', termine: '#7c3aed' }
                  const catLabels = { preise: 'Preisstruktur', nogos: 'No Gos', regeln: 'Content Regeln', services: 'Services', einschraenkungen: 'Einschränkungen', reise: 'Reiseplan', termine: 'Termine' }
                  const color = catColors[cat] || '#a78bfa'
                  return (
                    <div key={cat} style={{ background: 'var(--bg-card)', border: `1px solid ${color}33`, borderLeft: `3px solid ${color}`, borderRadius: '0 9px 9px 0', padding: '10px 12px' }}>
                      <div style={{ fontSize: 9, color, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 8 }}>{catLabels[cat] || cat}</div>
                      {items.map(item => (
                        <div key={item.id} style={{ padding: '6px 8px', background: 'var(--bg-card2)', borderRadius: 6, border: '1px solid #1e1e3a', marginBottom: 5 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>{item.title}</div>
                          {item.content && <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 1 }}>{item.content}</div>}
                          {item.price && <div style={{ fontSize: 11, fontWeight: 700, color, marginTop: 2 }}>{item.price}</div>}
                        </div>
                      ))}
                    </div>
                  )
                })}

                {/* Services */}
                {Object.keys(assignedServices[selectedModelInfo] || {}).length > 0 && (
                  <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(249,115,22,0.3)', borderLeft: '3px solid #f97316', borderRadius: '0 9px 9px 0', padding: '10px 12px' }}>
                    <div style={{ fontSize: 9, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 8 }}>Services</div>
                    {Object.entries(assignedServices[selectedModelInfo] || {}).map(([key, svc]) => {
                      const labels = { bewertungen: 'Bewertungen', audios: 'Audios', video_chat: 'Video Chat (VC)', telefonieren: 'Telefonieren' }
                      return (
                        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', background: 'var(--bg-card2)', borderRadius: 6, border: '1px solid #1e1e3a', marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{labels[key] || key}</span>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: svc.enabled ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)', color: svc.enabled ? '#10b981' : '#ef4444' }}>
                              {svc.enabled ? 'Ja' : 'Nein'}
                            </span>
                            {svc.enabled && svc.note && <span style={{ fontSize: 10, color: '#f59e0b' }}>{svc.note}</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Custom Content */}
                {(assignedCustomContent[selectedModelInfo] || []).length > 0 && (
                  <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(124,58,237,0.3)', borderLeft: '3px solid #7c3aed', borderRadius: '0 9px 9px 0', padding: '10px 12px' }}>
                    <div style={{ fontSize: 9, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 8 }}>
                      Custom Content · {(assignedCustomContent[selectedModelInfo] || []).length}
                    </div>
                    {(assignedCustomContent[selectedModelInfo] || []).map(cc => {
                      const isOverdue = cc.due_date && cc.due_date < new Date().toISOString().slice(0, 10)
                      const color = isOverdue ? '#ef4444' : '#f59e0b'
                      return (
                        <div key={cc.id} style={{ padding: '6px 8px', background: isOverdue ? 'rgba(239,68,68,0.05)' : 'rgba(245,158,11,0.04)', borderRadius: 6, border: `1px solid ${color}33`, marginBottom: 5 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>{cc.title}</span>
                            {cc.due_date && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: color + '22', color, flexShrink: 0 }}>
                              {isOverdue ? '! ' : ''}{new Date(cc.due_date + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
                            </span>}
                          </div>
                          {cc.description && <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{cc.description}</div>}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Videos */}
                {(assignedModelVideos[selectedModelInfo] || []).length > 0 && (
                  <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(239,68,68,0.3)', borderLeft: '3px solid #ef4444', borderRadius: '0 9px 9px 0', padding: '10px 12px' }}>
                    <div style={{ fontSize: 9, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 8 }}>Bevorstehende Videos</div>
                    {(assignedModelVideos[selectedModelInfo] || []).map(video => (
                      <div key={video.id} style={{ display: 'flex', gap: 10, padding: '6px 8px', background: 'var(--bg-card2)', borderRadius: 6, border: '1px solid #1e1e3a', marginBottom: 5, alignItems: 'flex-start' }}>
                        {video.thumbnail_url ? (
                          <img src={video.thumbnail_url} alt={video.title} style={{ width: 50, height: 38, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                        ) : (
                          <div style={{ width: 50, height: 38, borderRadius: 4, background: '#1e1e3a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>🎬</div>
                        )}
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>{video.title}</div>
                          {video.release_date && <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 2, fontFamily: 'monospace' }}>{new Date(video.release_date + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}



        {/* Content Requests */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '16px 18px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 3, height: 11, background: '#06b6d4', borderRadius: 2, display: 'inline-block' }} />
            Content-Anfragen
          </div>

          {/* New request form */}
          <div style={{ background: 'var(--bg-card2)', borderRadius: 8, padding: '12px', marginBottom: 12, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, fontWeight: 600 }}>Neue Anfrage</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Model *</label>
                <select value={newRequestModel} onChange={e => setNewRequestModel(e.target.value)}
                  style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}>
                  <option value="">— wählen —</option>
                  {models.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Typ *</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[['video','Video'],['bild','Bild'],['audio','Audio']].map(([k,l]) => (
                    <button key={k} onClick={() => setNewRequestType(k)} style={{
                      flex: 1, padding: '6px 4px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, fontWeight: 600,
                      background: newRequestType === k ? 'rgba(124,58,237,0.2)' : 'transparent',
                      color: newRequestType === k ? '#a78bfa' : 'var(--text-muted)',
                      border: `1px solid ${newRequestType === k ? '#7c3aed' : 'var(--border)'}`,
                    }}>{l}</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Kundennummer</label>
                <input value={newRequestCustomerId} onChange={e => setNewRequestCustomerId(e.target.value)}
                  style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
                  placeholder="#FAN-xxxx" />
              </div>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Gesamtpreis *</label>
                <input type="number" value={newRequestPrice} onChange={e => setNewRequestPrice(e.target.value)}
                  style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
                  placeholder="$0" />
              </div>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Anzahlung</label>
                <input type="number" value={newRequestDeposit} onChange={e => setNewRequestDeposit(e.target.value)}
                  style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
                  placeholder="$0 (optional)" />
              </div>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Länge / Anzahl</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input value={newRequestDuration} onChange={e => setNewRequestDuration(e.target.value)}
                    style={{ flex: 1, background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
                    placeholder="5 Min" />
                  <input type="number" value={newRequestQuantity} onChange={e => setNewRequestQuantity(e.target.value)} min="1"
                    style={{ width: 60, background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
                    placeholder="1" />
                </div>
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Wunsch des Kunden *</label>
              <textarea value={newRequestText} onChange={e => setNewRequestText(e.target.value)} rows={2}
                placeholder="Was möchte der Kunde genau?"
                style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 7, fontSize: 12, resize: 'none', fontFamily: 'inherit', outline: 'none' }} />
            </div>
            <button onClick={submitContentRequest} disabled={sendingRequest || !newRequestModel || !newRequestText.trim() || !newRequestPrice} style={{
              width: '100%', background: (newRequestModel && newRequestText.trim() && newRequestPrice) ? '#06b6d4' : 'var(--border)',
              color: (newRequestModel && newRequestText.trim() && newRequestPrice) ? '#fff' : 'var(--text-muted)',
              border: 'none', borderRadius: 7, padding: '8px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}>{sendingRequest ? 'Senden...' : '+ Anfrage senden'}</button>
          </div>

          {/* Request history */}
          {contentRequests.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 0' }}>Keine Anfragen in den letzten 2 Wochen</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {contentRequests.map(req => {
                const statusColor = req.status === 'erledigt' ? '#10b981' : req.status === 'bestaetigt' ? '#06b6d4' : req.status === 'angefragt' ? '#f59e0b' : req.status === 'abgelehnt' ? '#ef4444' : '#a78bfa'
                const statusLabel = req.status === 'erledigt' ? '✓ Erledigt' : req.status === 'bestaetigt' ? '✓ Bestätigt' : req.status === 'angefragt' ? '⏳ Angefragt' : req.status === 'abgelehnt' ? '✕ Abgelehnt' : '● Neu'
                const remainder = (req.price || 0) - (req.deposit || 0)
                return (
                  <div key={req.id} style={{ padding: '10px 12px', background: 'var(--bg-card2)', borderRadius: 8, borderLeft: `3px solid ${statusColor}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa' }}>{req.model_name}</span>
                        {req.content_type && <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: 'rgba(124,58,237,0.15)', color: '#a78bfa' }}>{req.content_type}</span>}
                        {req.customer_id && <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{req.customer_id}</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: statusColor }}>{statusLabel}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{new Date(req.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{req.request_text}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {req.price > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: '#10b981' }}>${req.price}</span>}
                      {req.deposit > 0 && <span style={{ fontSize: 10, color: '#f59e0b' }}>Anzahlung: ${req.deposit}{!req.deposit_paid ? ' (offen)' : ' ✓'}</span>}
                      {req.deposit > 0 && remainder > 0 && <span style={{ fontSize: 10, color: remainder > 0 && !req.remainder_paid ? '#ef4444' : '#10b981' }}>Rest: ${remainder}{!req.remainder_paid ? ' (offen)' : ' ✓'}</span>}
                      {req.duration && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{req.duration}</span>}
                      {req.quantity > 1 && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>×{req.quantity}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Schicht-Tausch */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '16px 18px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 3, height: 11, background: '#f59e0b', borderRadius: 2, display: 'inline-block' }} />
            Schicht-Tausch anfragen
          </div>
          <SwapRequestForm displayName={displayName} myNext7Shifts={myNext7Shifts} />
        </div>

        {/* Week Stats */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '16px 18px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 3, height: 11, background: '#f59e0b', borderRadius: 2, display: 'inline-block' }} />
            Meine Stats – KW {kw}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
            {[
              { label: `Revenue ${new Date().toLocaleString('de-DE', { month: 'long' })}`, val: formatMoney(monthRevenue), good: monthRevenue > 2000 },
              { label: 'Nachrichten KW', val: weekMessages.toString(), good: weekMessages > 200 },
              { label: 'Sent PPVs KW', val: weekSentPPVs.toString(), good: weekSentPPVs > 50 },
              { label: 'Buy Rate KW', val: `${weekBuyRate.toFixed(1)}%`, good: weekBuyRate >= 25 },
              { label: 'Aktiv (Std) KW', val: (weekActiveMinutes / 60).toFixed(1) + 'h', good: weekActiveMinutes > 300 },
            ].map(stat => (
              <div key={stat.label} style={{ ...sR, flexDirection: 'column', borderBottom: 'none', padding: '10px 14px', background: 'var(--bg-card2)', borderRadius: 8, border: '1px solid #1e1e3a' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>{stat.label}</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 18, color: stat.good ? '#10b981' : 'var(--text-primary)' }}>{stat.val}</div>
              </div>
            ))}
          </div>
        </div>


        {/* Bot Commands */}
        <div style={{ margin: '0 0 16px 0', background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '14px 18px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 12 }}>Bot-Befehle · @thirteen87agency_bot</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { cmd: '/on', desc: 'Schicht starten', color: '#10b981' },
              { cmd: '/off', desc: 'Schicht beenden', color: '#ef4444' },
              { cmd: '/start', desc: 'Telegram ID anzeigen', color: '#a78bfa' },
            ].map(b => (
              <div key={b.cmd} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--bg-card2)', borderRadius: 7, border: '1px solid #1e1e3a' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: b.color, background: b.color + '20', padding: '2px 7px', borderRadius: 4 }}>{b.cmd}</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{b.desc}</span>
              </div>
            ))}
          </div>
        </div>
        </div>
        )}
      </main>
    </div>
  )
}
