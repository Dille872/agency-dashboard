import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { sendTelegramMessage } from '../telegram'
import Card from './Card'

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

function getKW(date) {
  const d = new Date(date)
  const onejan = new Date(d.getFullYear(), 0, 1)
  return Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7)
}

function formatDate(date) {
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
}

function isoDate(date) {
  return date.toISOString().slice(0, 10)
}

function isToday(date) {
  return isoDate(date) === isoDate(new Date())
}

export default function ScheduleTab({ session }) {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()))
  const [models, setModels] = useState([])
  const [chatters, setChatters] = useState([])
  const [schedule, setSchedule] = useState({})
  const [dayNotes, setDayNotes] = useState({})
  const [shiftTimes, setShiftTimes] = useState({})
  const [editingCell, setEditingCell] = useState(null)
  const [editingNote, setEditingNote] = useState(null)
  const [editingShiftTime, setEditingShiftTime] = useState(null)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [hasSavedData, setHasSavedData] = useState(false)

  const weekDays = getWeekDays(weekStart)
  const weekKey = isoDate(weekStart)
  const kw = getKW(weekStart)

  useEffect(() => {
    loadModels()
    loadChatters()
  }, [])

  useEffect(() => {
    if (weekKey) loadSchedule()
  }, [weekKey])

  const loadModels = async () => {
    const { data, error } = await supabase.from('models_contact').select('*').order('name')
    if (error) console.error('loadModels error:', error)
    setModels(data || [])
  }

  const loadChatters = async () => {
    const { data, error } = await supabase.from('chatters_contact').select('*').order('name')
    if (error) console.error('loadChatters error:', error)
    setChatters(data || [])
  }

  const loadSchedule = async () => {
    const { data } = await supabase.from('schedule').select('*').eq('week_start', weekKey)
    if (data && data.length > 0) {
      setSchedule(data[0].assignments || {})
      setDayNotes(data[0].day_notes || {})
      setShiftTimes(data[0].shift_times || {})
      setHasSavedData(true)
    } else {
      setSchedule({})
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
      await supabase.from('schedule').insert({ week_start: weekKey, assignments: schedule, day_notes: dayNotes, shift_times: shiftTimes })
    }
    setHasSavedData(true)
    setSaving(false)
  }

  const getCellKey = (modelId, dayIso, shift) => `${modelId}__${dayIso}__${shift}`

  const setCell = (modelId, dayIso, shift, value) => {
    const key = getCellKey(modelId, dayIso, shift)
    setSchedule(prev => ({ ...prev, [key]: value }))
  }

  const getCell = (modelId, dayIso, shift) => {
    return schedule[getCellKey(modelId, dayIso, shift)] || { chatter: '', note: '' }
  }

  // ── Conflict detection ─────────────────────────────────────────────────────
  const conflicts = []

  // 1. Unbesetzt
  for (const model of models) {
    for (const day of weekDays) {
      const dayIso = isoDate(day)
      for (const shift of SHIFTS) {
        const cell = getCell(model.id, dayIso, shift)
        if (!cell.chatter) {
          conflicts.push({
            type: 'unbesetzt',
            msg: `${model.name} · ${DAYS[weekDays.indexOf(day)]} ${formatDate(day)} · ${shift} nicht besetzt`,
            dayIso, shift, modelId: model.id,
          })
        }
      }
    }
  }

  // 2. Chatter überlastet (4+ Models gleichzeitig)
  for (const day of weekDays) {
    const dayIso = isoDate(day)
    for (const shift of SHIFTS) {
      const chatterCount = {}
      for (const model of models) {
        const cell = getCell(model.id, dayIso, shift)
        if (cell.chatter) {
          chatterCount[cell.chatter] = (chatterCount[cell.chatter] || 0) + 1
        }
      }
      for (const [chatterName, count] of Object.entries(chatterCount)) {
        if (count >= 4) {
          conflicts.push({
            type: 'ueberlastet',
            msg: `${chatterName} hat ${count} Models am ${DAYS[weekDays.indexOf(day)]} ${formatDate(day)} · ${shift}`,
            dayIso, shift,
          })
        }
      }
    }
  }

  const sendPlanToAll = async () => {
    setSending(true)
    const chatterSchedules = {}
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
              const time = shiftTimes[`${model.id}__${shift}`] || ''
              dayShifts.push(`  ${shift}${time ? ` (${time})` : ''}: ${model.name}${cell.note ? ` – ${cell.note}` : ''}`)
            }
          }
        }
        if (dayShifts.length > 0) {
          lines.push(`${DAYS[weekDays.indexOf(day)]} ${formatDate(day)}${dayNote ? ` ⚠ ${dayNote}` : ''}`)
          lines.push(...dayShifts)
          lines.push('')
        }
      }
      if (lines.length > 1) {
        await sendTelegramMessage(chatter.telegram_id, lines.join('\n'))
      }
    }
    setSending(false)
    alert('✓ Dienstplan versendet!')
  }

  const prevWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d) }
  const nextWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d) }

  const cellStyle = (dayIso, isHeader) => ({
    border: `1px solid ${isHeader && weekDays.some(d => isoDate(d) === dayIso && isToday(d)) ? 'rgba(124,58,237,0.3)' : '#1e1e3a'}`,
    background: weekDays.some(d => isoDate(d) === dayIso && isToday(d)) ? 'rgba(124,58,237,0.06)' : '#0e0e1c',
    padding: '6px 8px',
    textAlign: 'center',
    minWidth: 90,
    fontSize: 12,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={prevWeek} style={{ background: '#0e0e1c', border: '1px solid #1e1e3a', color: '#8888aa', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 14 }}>‹</button>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14, color: '#f0f0ff' }}>
            KW {kw} · {formatDate(weekDays[0])} – {formatDate(weekDays[6])} {weekDays[0].getFullYear()}
          </span>
          <button onClick={nextWeek} style={{ background: '#0e0e1c', border: '1px solid #1e1e3a', color: '#8888aa', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 14 }}>›</button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={sendPlanToAll} disabled={sending} style={{ background: 'rgba(6,182,212,0.12)', color: '#06b6d4', border: '1px solid rgba(6,182,212,0.3)', borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            {sending ? 'Sende...' : '✈ Plan versenden'}
          </button>
          <button onClick={saveSchedule} disabled={saving} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </div>

      {/* Conflicts – nur nach erstem Speichern */}
      {hasSavedData && conflicts.length > 0 && (
        <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', marginBottom: 8 }}>
            ⚠ {conflicts.length} Konflikt{conflicts.length !== 1 ? 'e' : ''} gefunden
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {conflicts.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                <span style={{ padding: '1px 7px', borderRadius: 4, fontWeight: 700, fontSize: 10,
                  background: c.type === 'unbesetzt' ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)',
                  color: c.type === 'unbesetzt' ? '#f59e0b' : '#ef4444',
                }}>
                  {c.type === 'unbesetzt' ? 'Unbesetzt' : 'Überlastet'}
                </span>
                <span style={{ color: '#c0c0e0' }}>{c.msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {hasSavedData && conflicts.length === 0 && Object.keys(schedule).length > 0 && (
        <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 10, padding: '10px 16px', fontSize: 12, color: '#10b981', fontWeight: 600 }}>
          ✓ Keine Konflikte – Plan ist vollständig
        </div>
      )}

      {/* Schedule Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 700, width: '100%' }}>
          <thead>
            <tr>
              <th style={{ background: '#0b0b1a', border: '1px solid #1e1e3a', padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#4a4a6a', fontWeight: 700, minWidth: 120 }}>Model / Schicht</th>
              {weekDays.map((day, di) => (
                <th key={di} style={{
                  background: isToday(day) ? 'rgba(124,58,237,0.15)' : '#0e0e1c',
                  border: `1px solid ${isToday(day) ? 'rgba(124,58,237,0.3)' : '#1e1e3a'}`,
                  padding: '6px 8px', textAlign: 'center', fontSize: 11,
                  color: isToday(day) ? '#a78bfa' : '#4a4a6a', fontWeight: 700, whiteSpace: 'nowrap', minWidth: 90,
                }}>
                  {DAYS[di]} {formatDate(day)}{isToday(day) ? ' ●' : ''}
                </th>
              ))}
            </tr>
            {/* Day notes row */}
            <tr>
              <td style={{ background: '#0b0b1a', border: '1px solid #1e1e3a', padding: '4px 12px', fontSize: 10, color: '#4a4a6a' }}>Tages-Notiz</td>
              {weekDays.map((day, di) => {
                const dayIso = isoDate(day)
                return (
                  <td key={di} style={{ ...cellStyle(dayIso), padding: '4px 6px', cursor: 'text' }}
                    onClick={() => setEditingNote(editingNote === dayIso ? null : dayIso)}>
                    {editingNote === dayIso ? (
                      <input
                        autoFocus
                        value={dayNotes[dayIso] || ''}
                        onChange={e => setDayNotes(prev => ({ ...prev, [dayIso]: e.target.value }))}
                        onBlur={() => setEditingNote(null)}
                        onKeyDown={e => e.key === 'Enter' && setEditingNote(null)}
                        style={{ width: '100%', background: '#0b0b1a', border: '1px solid #7c3aed', color: '#f59e0b', padding: '2px 4px', borderRadius: 4, fontSize: 10, fontFamily: 'inherit', outline: 'none' }}
                      />
                    ) : (
                      <span style={{ color: dayNotes[dayIso] ? '#f59e0b' : '#2e2e5a', fontSize: 10 }}>
                        {dayNotes[dayIso] || '+ Notiz'}
                      </span>
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
                      <td rowSpan={3} style={{ background: '#0b0b1a', border: '1px solid #1e1e3a', borderLeft: `3px solid #7c3aed`, padding: '8px 12px', verticalAlign: 'middle' }}>
                        <div style={{ fontWeight: 700, color: '#f0f0ff', fontSize: 13, marginBottom: 4 }}>{model.name}</div>
                        {SHIFTS.map(s => (
                          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                            <span style={{ width: 6, height: 6, borderRadius: 2, background: SHIFT_COLORS[s], flexShrink: 0, display: 'inline-block' }} />
                            {editingShiftTime === `${model.id}__${s}` ? (
                              <input
                                autoFocus
                                value={shiftTimes[`${model.id}__${s}`] || ''}
                                onChange={e => setShiftTimes(prev => ({ ...prev, [`${model.id}__${s}`]: e.target.value }))}
                                onBlur={() => setEditingShiftTime(null)}
                                onKeyDown={e => e.key === 'Enter' && setEditingShiftTime(null)}
                                placeholder={`${s} Zeiten`}
                                style={{ width: 80, background: '#0b0b1a', border: '1px solid #7c3aed', color: '#f0f0ff', padding: '1px 4px', borderRadius: 3, fontSize: 9, fontFamily: 'monospace', outline: 'none' }}
                              />
                            ) : (
                              <span
                                onClick={() => setEditingShiftTime(`${model.id}__${s}`)}
                                style={{ fontSize: 10, color: shiftTimes[`${model.id}__${s}`] ? '#8888aa' : '#2e2e5a', cursor: 'text', fontFamily: 'monospace' }}
                              >
                                {shiftTimes[`${model.id}__${s}`] || `${s} +Zeit`}
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

                      return (
                        <td key={di} onClick={() => setEditingCell(isEditing ? null : cellId)} style={{
                          border: `1px solid ${hasConflict ? 'rgba(239,68,68,0.3)' : isToday(day) ? 'rgba(124,58,237,0.2)' : '#1e1e3a'}`,
                          background: hasConflict ? 'rgba(239,68,68,0.05)' : isToday(day) ? 'rgba(124,58,237,0.04)' : 'transparent',
                          padding: '5px 6px', textAlign: 'center', cursor: 'pointer',
                          borderLeft: `2px solid ${SHIFT_COLORS[shift]}`,
                          minWidth: 90, verticalAlign: 'middle',
                        }}>
                          {isEditing ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }} onClick={e => e.stopPropagation()}>
                              <select
                                autoFocus
                                value={cell.chatter || ''}
                                onChange={e => setCell(model.id, dayIso, shift, { ...cell, chatter: e.target.value })}
                                style={{ background: '#0b0b1a', border: '1px solid #7c3aed', color: '#f0f0ff', padding: '2px 4px', borderRadius: 4, fontSize: 11, fontFamily: 'inherit', outline: 'none', width: '100%' }}
                              >
                                <option value="">— leer —</option>
                                {chatters.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                              </select>
                              <input
                                value={cell.note || ''}
                                onChange={e => setCell(model.id, dayIso, shift, { ...cell, note: e.target.value })}
                                placeholder="Notiz (optional)"
                                onKeyDown={e => e.key === 'Enter' && setEditingCell(null)}
                                style={{ background: '#0b0b1a', border: '1px solid #2e2e5a', color: '#f59e0b', padding: '2px 4px', borderRadius: 4, fontSize: 10, fontFamily: 'inherit', outline: 'none', width: '100%' }}
                              />
                              <button onClick={() => setEditingCell(null)} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 3, padding: '2px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>✓</button>
                            </div>
                          ) : cell.chatter ? (
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#f0f0ff' }}>{cell.chatter}</div>
                              {cell.note && <div style={{ fontSize: 9, color: '#f59e0b', marginTop: 1 }}>{cell.note}</div>}
                            </div>
                          ) : (
                            <span style={{ fontSize: 10, color: hasConflict ? 'rgba(239,68,68,0.5)' : '#2e2e5a' }}>
                              {hasConflict ? '⚠ leer' : '+ eintragen'}
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {mi < models.length - 1 && (
                  <tr><td colSpan={9} style={{ height: 6, background: '#070710', border: 'none' }} /></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#8888aa', flexWrap: 'wrap' }}>
        {SHIFTS.map(s => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: SHIFT_COLORS[s] }} />
            {s}
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(239,68,68,0.3)' }} />
          Konflikt
        </div>
        <span style={{ color: '#4a4a6a' }}>· Klick auf Zelle zum Bearbeiten · Zeiten links beim Model eintragen</span>
      </div>
    </div>
  )
}
