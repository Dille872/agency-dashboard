import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { sendTelegramMessage } from '../telegram'

const PRIORITY_COLORS = { wichtig: '#ef4444', normal: '#f59e0b', niedrig: '#06b6d4' }
const PRIORITY_LABELS = { wichtig: 'Wichtig', normal: 'Normal', niedrig: 'Niedrig' }

export default function TodoTab({ session, userDisplayName }) {
  const [todos, setTodos] = useState([])
  const [filter, setFilter] = useState('offen')
  const [filterPerson, setFilterPerson] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newPriority, setNewPriority] = useState('normal')
  const [newAssignedTo, setNewAssignedTo] = useState('')
  const [saving, setSaving] = useState(false)
  const [adminNames, setAdminNames] = useState([])
  const [chatterNames, setChatterNames] = useState([])
  const [modelNames, setModelNames] = useState([])
  const [adminTelegramMap, setAdminTelegramMap] = useState({})
  const [assigneeTelegramMap, setAssigneeTelegramMap] = useState({})
  const channelRef = useRef(null)

  useEffect(() => {
    loadTodos()
    loadAdmins()
    // Eindeutiger Channel-Name pro Mount um Doppel-Subscriptions zu vermeiden
    const channelName = `todos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const channel = supabase.channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, () => loadTodos())
      .subscribe()
    channelRef.current = channel
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [])

  const loadTodos = async () => {
    const { data } = await supabase.from('todos').select('*').order('created_at', { ascending: false })
    setTodos(data || [])
  }

  const loadAdmins = async () => {
    const { data: roleData } = await supabase.from('user_roles').select('display_name, role, status').order('display_name')
    // v3.23.0: stillgelegte/offboardete Personen nicht mehr zuweisbar (bestehende Todos behalten den Namen)
    const active = (roleData || []).filter(u => u.display_name && u.status !== 'suspended' && u.status !== 'offboarded')
    const adminList = [...new Set(active.filter(u => ['admin', 'manager'].includes(u.role)).map(u => u.display_name))]
    // v3.38.0: Chatter, v3.40.0: Models ebenfalls zuweisbar (sehen die Aufgabe in ihrem Portal)
    const chatterList = [...new Set(active.filter(u => u.role === 'chatter').map(u => u.display_name))]
    const modelList = [...new Set(active.filter(u => u.role === 'model').map(u => u.display_name))]
    setAdminNames(adminList)
    setChatterNames(chatterList)
    setModelNames(modelList)

    const adminMap = {}
    const allMap = {}
    const staffNames = [...new Set([...adminList, ...chatterList])]
    if (staffNames.length > 0) {
      const { data: contactData } = await supabase
        .from('chatters_contact')
        .select('name, telegram_id')
        .in('name', staffNames)
      ;(contactData || []).forEach(c => {
        if (c.telegram_id) {
          allMap[c.name] = c.telegram_id
          if (adminList.includes(c.name)) adminMap[c.name] = c.telegram_id
        }
      })
    }
    // Model-Telegram-IDs liegen in models_contact
    if (modelList.length > 0) {
      const { data: modelContact } = await supabase
        .from('models_contact')
        .select('name, telegram_id')
        .in('name', modelList)
      ;(modelContact || []).forEach(c => {
        if (c.telegram_id) allMap[c.name] = c.telegram_id
      })
    }
    setAdminTelegramMap(adminMap)
    setAssigneeTelegramMap(allMap)
  }

  const notifyOtherAdmins = async (msg) => {
    const targets = Object.entries(adminTelegramMap)
      .filter(([name]) => name !== userDisplayName)
      .map(([, tgId]) => tgId)
    for (const tgId of targets) {
      try {
        await sendTelegramMessage(tgId, msg)
      } catch (err) {
        console.error('Telegram-Fehler:', err)
      }
    }
  }

  const addTodo = async () => {
    if (!newTitle.trim()) return
    setSaving(true)
    const { error } = await supabase.from('todos').insert({
      title: newTitle.trim(),
      description: newDesc.trim() || null,
      priority: newPriority,
      created_by: userDisplayName,
      assigned_to: newAssignedTo || null,
      read_by: [userDisplayName],
    })
    if (error) {
      alert('Fehler: ' + error.message)
      setSaving(false)
      return
    }
    await notifyOtherAdmins(`📋 <b>Neue Aufgabe von ${userDisplayName}</b>\n\n${newTitle.trim()}${newDesc ? '\n' + newDesc.trim() : ''}\n\nPriorität: ${PRIORITY_LABELS[newPriority]}${newAssignedTo ? '\nFür: ' + newAssignedTo : ''}`)
    // v3.38.0/v3.40.0: zugewiesene Person (Chatter oder Model) direkt benachrichtigen; Admins erhalten die Info über notifyOtherAdmins
    if (newAssignedTo && !adminNames.includes(newAssignedTo) && assigneeTelegramMap[newAssignedTo]) {
      try {
        await sendTelegramMessage(assigneeTelegramMap[newAssignedTo], `📋 <b>Neue Aufgabe für dich</b>\n\n${newTitle.trim()}${newDesc ? '\n' + newDesc.trim() : ''}\n\nPriorität: ${PRIORITY_LABELS[newPriority]}\nVon: ${userDisplayName}`)
      } catch (err) { console.error('Telegram-Fehler:', err) }
    }
    setNewTitle(''); setNewDesc(''); setNewPriority('normal'); setNewAssignedTo(''); setShowAdd(false)
    setSaving(false)
  }

  const toggleTodo = async (todo) => {
    const completed = !todo.completed
    await supabase.from('todos').update({
      completed,
      completed_by: completed ? userDisplayName : null,
      completed_at: completed ? new Date().toISOString() : null,
    }).eq('id', todo.id)
    if (completed) {
      await notifyOtherAdmins(`✅ <b>${userDisplayName}</b> hat abgehakt:\n\n${todo.title}`)
    }
  }

  const markTodoRead = async (todo) => {
    const readBy = Array.isArray(todo.read_by) ? todo.read_by : []
    if (readBy.includes(userDisplayName)) return
    const newReadBy = [...readBy, userDisplayName]
    await supabase.from('todos').update({ read_by: newReadBy }).eq('id', todo.id)
    setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, read_by: newReadBy } : t))
  }

  const markAllTodosRead = async () => {
    const openTodos = todos.filter(t => !t.completed)
    if (openTodos.length === 0) return
    for (const todo of openTodos) {
      const readBy = Array.isArray(todo.read_by) ? todo.read_by : []
      const updated = Array.from(new Set([...readBy, 'Chris', 'Rey']))
      await supabase.from('todos').update({ read_by: updated }).eq('id', todo.id)
    }
    loadTodos()
  }

  const deleteTodo = async (id) => {
    await supabase.from('todos').delete().eq('id', id)
  }

  const formatDate = (ts) => {
    if (!ts) return '—'
    const d = new Date(ts)
    const today = new Date()
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
    if (d.toDateString() === today.toDateString()) return 'heute'
    if (d.toDateString() === yesterday.toDateString()) return 'gestern'
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  }

  const isUnread = (todo) => {
    const readBy = Array.isArray(todo.read_by) ? todo.read_by : []
    return !readBy.includes(userDisplayName)
  }

  const openTodos = todos.filter(t => !t.completed)
  const doneTodos = todos.filter(t => t.completed)
  const unreadOpenCount = openTodos.filter(isUnread).length
  const byStatus = filter === 'offen' ? openTodos : filter === 'erledigt' ? doneTodos : todos
  const displayed = filterPerson ? byStatus.filter(t => t.assigned_to === filterPerson || t.created_by === filterPerson) : byStatus

  const cardS = { background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '14px 16px', marginBottom: 10 }
  const inputS = { width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', outline: 'none' }

  return (
    <div style={{ maxWidth: 680 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {[['alle', 'Alle', todos.length], ['offen', 'Offen', openTodos.length], ['erledigt', 'Erledigt', doneTodos.length]].map(([key, label, count]) => (
            <button key={key} onClick={() => setFilter(key)} style={{
              padding: '5px 14px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 12,
              background: filter === key ? '#7c3aed' : 'transparent',
              color: filter === key ? '#fff' : 'var(--text-muted)',
              border: `1px solid ${filter === key ? '#7c3aed' : 'var(--border)'}`,
            }}>{label} {count > 0 && <span style={{ fontSize: 10, marginLeft: 4, opacity: .8 }}>{count}</span>}</button>
          ))}
          <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />
          {adminNames.map(name => (
            <button key={name} onClick={() => setFilterPerson(filterPerson === name ? '' : name)} style={{
              padding: '5px 14px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 12,
              background: filterPerson === name ? 'rgba(124,58,237,0.2)' : 'transparent',
              color: filterPerson === name ? '#a78bfa' : 'var(--text-muted)',
              border: `1px solid ${filterPerson === name ? '#7c3aed' : 'var(--border)'}`,
            }}>{name}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {todos.filter(t => !t.completed).length > 0 && (
            <button onClick={markAllTodosRead} style={{
              padding: '6px 12px', borderRadius: 7, background: 'rgba(245,158,11,0.12)', color: '#f59e0b',
              border: '1px solid rgba(245,158,11,0.3)', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}>✓ Alle als gelesen markieren</button>
          )}
          <button onClick={() => setShowAdd(!showAdd)} style={{
            padding: '6px 14px', borderRadius: 7, background: 'rgba(124,58,237,0.15)', color: '#a78bfa',
            border: '1px solid rgba(124,58,237,0.3)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>+ Neue Aufgabe</button>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{ ...cardS, border: '1px solid #7c3aed', marginBottom: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)} style={inputS} placeholder="Aufgabe *" autoFocus
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && addTodo()} />
            <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} style={{ ...inputS, resize: 'vertical' }} rows={2} placeholder="Beschreibung (optional)" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Zuständig</label>
                <select value={newAssignedTo} onChange={e => setNewAssignedTo(e.target.value)} style={inputS}>
                  <option value="">Alle / Offen</option>
                  {adminNames.length > 0 && (
                    <optgroup label="Team">
                      {adminNames.map(n => <option key={n} value={n}>{n}</option>)}
                    </optgroup>
                  )}
                  {chatterNames.length > 0 && (
                    <optgroup label="Chatter">
                      {chatterNames.map(n => <option key={n} value={n}>{n}</option>)}
                    </optgroup>
                  )}
                  {modelNames.length > 0 && (
                    <optgroup label="Models">
                      {modelNames.map(n => <option key={n} value={n}>{n}</option>)}
                    </optgroup>
                  )}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Priorität</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  {Object.entries(PRIORITY_LABELS).map(([k, l]) => (
                    <button key={k} onClick={() => setNewPriority(k)} style={{
                      flex: 1, padding: '6px 4px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, fontWeight: 600,
                      background: newPriority === k ? PRIORITY_COLORS[k] + '22' : 'transparent',
                      color: newPriority === k ? PRIORITY_COLORS[k] : 'var(--text-muted)',
                      border: `1px solid ${newPriority === k ? PRIORITY_COLORS[k] : 'var(--border)'}`,
                    }}>{l}</button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={addTodo} disabled={saving || !newTitle.trim()} style={{
                flex: 1, padding: '8px', borderRadius: 7, background: newTitle.trim() ? '#7c3aed' : 'var(--border)',
                color: newTitle.trim() ? '#fff' : 'var(--text-muted)', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}>{saving ? '...' : '+ Speichern & Benachrichtigen'}</button>
              <button onClick={() => setShowAdd(false)} style={{ padding: '8px 14px', borderRadius: 7, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Abbrechen</button>
            </div>
          </div>
        </div>
      )}

      {/* Open todos */}
      {(filter === 'alle' || filter === 'offen') && displayed.filter(t => !t.completed).length > 0 && (
        <div style={cardS}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 10 }}>Offen · {displayed.filter(t => !t.completed).length}</div>
          {displayed.filter(t => !t.completed).map(todo => {
            const color = PRIORITY_COLORS[todo.priority] || '#f59e0b'
            const unread = isUnread(todo)
            return (
              <div key={todo.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 8, marginBottom: 6,
                background: unread ? 'rgba(245,158,11,0.08)' : color + '06',
                border: unread ? '1px solid rgba(245,158,11,0.4)' : `0.5px solid ${color}33`
              }}>
                <div onClick={() => toggleTodo(todo)} style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 1, cursor: 'pointer', border: `1.5px solid ${color}`, background: 'transparent' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{todo.title}</span>
                    {unread && (
                      <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: 'rgba(245,158,11,0.25)', color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>NEU</span>
                    )}
                  </div>
                  {todo.description && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.4 }}>{todo.description}</div>}
                  {todo.assignee_note && (
                    <div style={{ marginTop: 6, padding: '6px 9px', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 6 }}>
                      <span style={{ fontSize: 10, color: '#a78bfa', fontWeight: 700 }}>💬 {todo.assigned_to}: </span>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{todo.assignee_note}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 4, background: color + '22', color }}>{PRIORITY_LABELS[todo.priority]}</span>
                    {todo.assigned_to && <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 4, background: 'rgba(124,58,237,0.15)', color: '#a78bfa' }}>→ {todo.assigned_to}</span>}
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>von {todo.created_by} · {formatDate(todo.created_at)}</span>
                    {unread && (
                      <button onClick={() => markTodoRead(todo)} style={{
                        marginLeft: 'auto', fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                        background: 'transparent', border: '1px solid rgba(245,158,11,0.4)',
                        color: '#f59e0b', fontFamily: 'inherit', fontWeight: 600
                      }}>👁 Gesehen</button>
                    )}
                  </div>
                </div>
                <button onClick={() => deleteTodo(todo.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, padding: '0 4px', flexShrink: 0 }}
                  onMouseEnter={e => e.target.style.color = '#ef4444'} onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
              </div>
            )
          })}
        </div>
      )}

      {/* Done todos */}
      {(filter === 'alle' || filter === 'erledigt') && displayed.filter(t => t.completed).length > 0 && (
        <div style={cardS}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 10 }}>Erledigt · {displayed.filter(t => t.completed).length}</div>
          {displayed.filter(t => t.completed).map(todo => (
            <div key={todo.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 8, marginBottom: 6, background: 'var(--bg-card2)', border: '0.5px solid var(--border)', opacity: 0.55 }}>
              <div onClick={() => toggleTodo(todo)} style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 1, cursor: 'pointer', background: '#10b981', border: '1.5px solid #10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>✓</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', textDecoration: 'line-through' }}>{todo.title}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                  erledigt von {todo.completed_by || '—'}{todo.completed_at ? ` · ${formatDate(todo.completed_at)}` : ''}
                </div>
                {todo.assignee_note && (
                  <div style={{ marginTop: 6, padding: '6px 9px', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 6 }}>
                    <span style={{ fontSize: 10, color: '#a78bfa', fontWeight: 700 }}>💬 {todo.assigned_to}: </span>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{todo.assignee_note}</span>
                  </div>
                )}
              </div>
              <button onClick={() => deleteTodo(todo.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, padding: '0 4px', flexShrink: 0 }}
                onMouseEnter={e => e.target.style.color = '#ef4444'} onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
            </div>
          ))}
        </div>
      )}

      {displayed.length === 0 && !showAdd && (
        <div style={{ ...cardS, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 30 }}>
          {filter === 'offen' ? 'Keine offenen Aufgaben' : filter === 'erledigt' ? 'Noch nichts erledigt' : 'Keine Aufgaben'}
        </div>
      )}
    </div>
  )
}
