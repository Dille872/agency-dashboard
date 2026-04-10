import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { formatMoney, pctChange, getLast7Snapshots } from '../utils'

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

export default function ChatterPortal({ session, displayName, onSwitchToAdmin }) {
  const [isOnline, setIsOnline] = useState(false)
  const [messages, setMessages] = useState([])
  const [models, setModels] = useState([])
  const [noteText, setNoteText] = useState('')
  const [noteModel, setNoteModel] = useState('')
  const [noteShift, setNoteShift] = useState('')
  const [sendingNote, setSendingNote] = useState(false)
  const [scheduleData, setScheduleData] = useState({})
  const [chatterStats, setChatterStats] = useState(null)
  const [chatterSnapshots, setChatterSnapshots] = useState([])
  const [weekStart] = useState(() => getWeekStart(new Date()))

  const weekDays = getWeekDays(weekStart)
  const weekKey = isoDate(weekStart)
  const kw = getKW(weekStart)
  const todayIso = isoDate(new Date())

  useEffect(() => {
    loadMessages()
    loadSchedule()
    loadStats()
    loadModels()
    const interval = setInterval(loadMessages, 30000)
    return () => clearInterval(interval)
  }, [])

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
    if (data) setScheduleData(data.assignments || {})
  }

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

    // Find this chatter's rows
    const todaySnap = snapshots.find(s => s.businessDate === todayIso)
    const myRow = todaySnap?.rows?.find(r =>
      r.name?.toLowerCase() === displayName?.toLowerCase()
    )
    if (myRow) setChatterStats(myRow)
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
      // Look through all models for this chatter
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

  // Today's shifts
  const todayShifts = myShifts.filter(s => s.dayIso === todayIso)

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
    <div style={{ minHeight: '100vh', background: '#070710', fontFamily: 'var(--font-sans)', color: '#f0f0ff' }}>
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
            <span style={{ fontSize: 14, fontWeight: 700, color: '#f0f0ff' }}>Thirteen 87</span>
            <span style={{ fontSize: 10, color: '#4a4a6a', marginLeft: 6 }}>Chatter Portal</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
          <button
            onClick={() => setIsOnline(!isOnline)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
              background: isOnline ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
              border: `1px solid ${isOnline ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
              color: isOnline ? '#10b981' : '#ef4444',
              fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
            }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: isOnline ? '#10b981' : '#ef4444', display: 'inline-block' }} />
            {isOnline ? 'Online' : 'Offline'}
          </button>
          <span style={{ fontSize: 12, color: '#8888aa' }}>{displayName}</span>
          {onSwitchToAdmin && (
            <button onClick={onSwitchToAdmin} style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
              ⚙ Admin
            </button>
          )}
          <button onClick={() => supabase.auth.signOut()} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, background: 'transparent', border: '1px solid #1e1e3a', color: '#4a4a6a', cursor: 'pointer', fontFamily: 'inherit' }}>↩</button>
        </div>
      </header>

      <main style={{ padding: '16px 20px', maxWidth: 1200, margin: '0 auto' }}>

        {/* Today Banner */}
        {todayShifts.length > 0 && (
          <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 10, padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#10b981', marginBottom: 3 }}>
                Heute: {todayShifts.map(s => s.shift).join(' + ')} · {todayIso}
              </div>
              <div style={{ fontSize: 11, color: '#8888aa' }}>
                {todayShifts.flatMap(s => Object.keys(s.models)).join(', ')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setIsOnline(true)}
                style={{ background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                ✓ Einchecken
              </button>
            </div>
          </div>
        )}

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'Revenue heute', val: formatMoney(chatterStats?.revenue || 0), sub: revDelta !== 0 ? `${revDelta > 0 ? '▲' : '▼'} ${Math.abs(revDelta).toFixed(1)}% vs gestern` : 'Kein Vortag', good: revDelta >= 0 },
            { label: '$/Stunde', val: formatMoney(chatterStats?.revenuePerHour || 0), sub: 'Heute', good: (chatterStats?.revenuePerHour || 0) > 20 },
            { label: 'PPV Buy Rate', val: chatterStats ? `${(chatterStats.buyRate || 0).toFixed(1)}%` : '—', sub: 'Heute', good: (chatterStats?.buyRate || 0) >= 25 },
            { label: 'Ø Antwortzeit', val: formatResponseTime(chatterStats?.avgResponseSeconds), sub: (chatterStats?.avgResponseSeconds || 0) <= 120 ? 'Gut ✓' : (chatterStats?.avgResponseSeconds || 0) <= 210 ? 'Ok' : 'Zu langsam', good: (chatterStats?.avgResponseSeconds || 0) <= 120 },
          ].map(kpi => (
            <div key={kpi.label} style={{ background: '#0e0e1c', border: '1px solid #1e1e3a', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 10, color: '#4a4a6a', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 4 }}>{kpi.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', color: '#f0f0ff', lineHeight: 1.2 }}>{kpi.val}</div>
              <div style={{ fontSize: 11, color: kpi.good ? '#10b981' : '#ef4444', marginTop: 2 }}>{kpi.sub}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 16 }}>
          {/* My Shifts */}
          <div style={{ background: '#0e0e1c', border: '1px solid #1e1e3a', borderRadius: 10, padding: '16px 18px' }}>
            <div style={{ fontSize: 11, color: '#4a4a6a', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 3, height: 11, background: '#06b6d4', borderRadius: 2, display: 'inline-block' }} />
              Meine Schichten – KW {kw}
            </div>
            {myShifts.length === 0 ? (
              <div style={{ color: '#4a4a6a', fontSize: 13, padding: '12px 0', textAlign: 'center' }}>Noch kein Dienstplan für diese Woche</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {myShifts.map((s, i) => {
                  const today = isToday(s.day)
                  const past = s.day < new Date() && !today
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 12px', background: today ? 'rgba(16,185,129,0.05)' : '#13132a',
                      borderRadius: 8, border: `1px solid ${today ? 'rgba(16,185,129,0.3)' : '#1e1e3a'}`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 4, height: 36, borderRadius: 2, background: SHIFT_COLORS[s.shift], flexShrink: 0 }} />
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: today ? '#10b981' : '#f0f0ff' }}>
                            {DAYS[weekDays.indexOf(weekDays.find(d => isoDate(d) === s.dayIso))]} {formatDate(s.day)}{today ? ' · Heute' : ''}
                          </div>
                          <div style={{ fontSize: 10, color: '#8888aa', marginTop: 1 }}>{s.shift}</div>
                        </div>
                      </div>
                      <span style={{
                        fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 700,
                        background: today ? 'rgba(16,185,129,0.15)' : past ? 'rgba(255,255,255,0.04)' : 'rgba(124,58,237,0.15)',
                        color: today ? '#10b981' : past ? '#4a4a6a' : '#a78bfa',
                      }}>
                        {today ? 'Aktiv' : past ? 'Erledigt' : 'Geplant'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Messages + Note */}
          <div style={{ background: '#0e0e1c', border: '1px solid #1e1e3a', borderRadius: 10, padding: '16px 18px' }}>
            <div style={{ fontSize: 11, color: '#4a4a6a', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 3, height: 11, background: '#7c3aed', borderRadius: 2, display: 'inline-block' }} />
              Nachrichten vom Team
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
              {messages.length === 0 ? (
                <div style={{ color: '#4a4a6a', fontSize: 13, padding: '8px 0' }}>Noch keine Nachrichten</div>
              ) : messages.slice(0, 4).map(msg => (
                <div key={msg.id} style={{ padding: '9px 12px', background: '#13132a', borderRadius: 8, border: '1px solid rgba(124,58,237,0.2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: msg.sent_by === 'Christoph' ? '#a78bfa' : '#06b6d4' }}>{msg.sent_by || 'Team'}</span>
                    <span style={{ fontSize: 10, color: '#4a4a6a', fontFamily: 'monospace' }}>{formatTime(msg.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#c0c0e0', lineHeight: 1.5 }}>{msg.text}</div>
                </div>
              ))}
            </div>
            <div style={{ borderTop: '1px solid #1e1e3a', paddingTop: 12 }}>
              <div style={{ fontSize: 10, color: '#4a4a6a', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 10 }}>Schichtnotiz hinterlassen</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 120 }}>
                  <label style={{ fontSize: 10, color: '#4a4a6a' }}>Model</label>
                  <select
                    value={noteModel}
                    onChange={e => setNoteModel(e.target.value)}
                    style={{ background: '#0b0b1a', border: '1px solid #2e2e5a', color: noteModel ? '#f0f0ff' : '#4a4a6a', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
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
                  <label style={{ fontSize: 10, color: '#4a4a6a' }}>Schicht</label>
                  <select
                    value={noteShift}
                    onChange={e => setNoteShift(e.target.value)}
                    style={{ background: '#0b0b1a', border: '1px solid #2e2e5a', color: noteShift ? '#f0f0ff' : '#4a4a6a', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
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
                style={{ width: '100%', background: '#0b0b1a', border: '1px solid #2e2e5a', color: '#f0f0ff', padding: '8px 10px', borderRadius: 7, fontSize: 12, resize: 'none', fontFamily: 'inherit', outline: 'none', marginBottom: 8 }}
              />
              <button onClick={sendNote} disabled={sendingNote || !noteText.trim()} style={{
                background: noteText.trim() ? '#7c3aed' : '#1e1e3a', color: noteText.trim() ? '#fff' : '#4a4a6a',
                border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 700, cursor: noteText.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
              }}>{sendingNote ? 'Senden...' : 'Notiz senden'}</button>
            </div>
          </div>
        </div>

        {/* Week Stats */}
        <div style={{ background: '#0e0e1c', border: '1px solid #1e1e3a', borderRadius: 10, padding: '16px 18px' }}>
          <div style={{ fontSize: 11, color: '#4a4a6a', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 3, height: 11, background: '#f59e0b', borderRadius: 2, display: 'inline-block' }} />
            Meine Stats – KW {kw}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
            {[
              { label: 'Revenue KW', val: formatMoney(weekRevenue), good: weekRevenue > 500 },
              { label: '$/Stunde KW', val: formatMoney(weekRPH), good: weekRPH > 20 },
              { label: 'Nachrichten KW', val: weekMessages.toString(), good: weekMessages > 200 },
              { label: 'Sent PPVs KW', val: weekSentPPVs.toString(), good: weekSentPPVs > 50 },
              { label: 'Buy Rate KW', val: `${weekBuyRate.toFixed(1)}%`, good: weekBuyRate >= 25 },
              { label: 'Aktiv (Std) KW', val: (weekActiveMinutes / 60).toFixed(1) + 'h', good: weekActiveMinutes > 300 },
            ].map(stat => (
              <div key={stat.label} style={{ ...sR, flexDirection: 'column', borderBottom: 'none', padding: '10px 14px', background: '#13132a', borderRadius: 8, border: '1px solid #1e1e3a' }}>
                <div style={{ fontSize: 10, color: '#4a4a6a', marginBottom: 4 }}>{stat.label}</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 18, color: stat.good ? '#10b981' : '#f0f0ff' }}>{stat.val}</div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
