import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { sendTelegramMessage } from '../telegram'

const PRIORITY_COLORS = { wichtig: '#ef4444', normal: '#f59e0b', niedrig: '#06b6d4' }
const PRIORITY_LABELS = { wichtig: 'Wichtig', normal: 'Normal', niedrig: 'Niedrig' }

export default function TodoTab({ session, userDisplayName }) {
  const [todos, setTodos] = useState([])
  const [filter, setFilter] = useState('offen')
  const [showAdd, setShowAdd] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newPriority, setNewPriority] = useState('normal')
  const [saving, setSaving] = useState(false)
  const [adminNames, setAdminNames] = useState([])

  useEffect(() => {
    loadTodos()
    loadAdmins()
    const channel = supabase.channel('todos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, () => loadTodos())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  const loadTodos = async () => {
    const { data } = await supabase.from('todos').select('*').order('created_at', { ascending: false })
    setTodos(data || [])
  }

  const loadAdmins = async () => {
    const { data } = await supabase.from('user_roles').select('display_name').order('display_name')
    setAdminNames([...new Set((data || []).filter(u => u.display_name).map(u => u.display_name))])
  }

  const notifyOtherAdmins = async (msg) => {
    // Get all admin telegram IDs except current user
    const { data: allAdmins } = await supabase.from('user_roles').select('display_name').eq('role', 'admin')
    const others = (allAdmins || []).filter(a => a.display_name !== userDisplayName)
    // Get their telegram IDs from models_contact or chatters_contact or bot_settings
    // Use hardcoded admin TG IDs from bot_settings
    const { data: settings } = await supabase.from('bot_settings').select('key, value')
    const tgMap = {}
    for (const s of settings || []) tgMap[s.key] = s.value
    // Try to find telegram IDs for other admins via chatters_contact or models_contact
    for (const admin of others) {
      const { data: contact } = await supabase.from('chatters_contact').select('telegram_id').eq('name', admin.display_name).single()
      if (contact?.telegram_id) {
        await sendTelegramMessage(contact.telegram_id, msg)
      }
    }
    // Also always notify both Chris and Rey via their known IDs
    const knownAdminTG = [1538601588, 528328429]
    for (const tgId of knownAdminTG) {
      await sendTelegramMessage(tgId, msg)
    }
  }

  const addTodo = async () => {
    if (!newTitle.trim()) return
    setSaving(true)
    await supabase.from('todos').insert({
      title: newTitle.trim(),
      description: newDesc.trim() || null,
      priority: newPriority,
      created_by: userDisplayName,
    })
    // Notify other admins
    await notifyOtherAdmins(`📋 <b>Neue Aufgabe von ${userDisplayName}</b>\n\n${newTitle.trim()}${newDesc ? '\n' + newDesc.trim() : ''}\n\nPriorität: ${PRIORITY_LABELS[newPriority]}`)
    setNewTitle(''); setNewDesc(''); setNewPriority('normal'); setShowAdd(false)
    setSaving(false)
  }

  const toggleTodo = async (todo) => {
    const completed = !todo.completed
    await supabase.from('todos').update({
      completed,
      completed_by: completed ? userDisplayName : null,
      completed_at: completed ? new Date().toISOString() : null,
    }).eq('id', todo.id)
    // Notify
    const msg = completed
      ? `✅ <b>${userDisplayName}</b> hat abgehakt:\n\n${todo.title}`
      : `↩️ <b>${userDisplayName}</b> hat reaktiviert:\n\n${todo.title}`
    await notifyOtherAdmins(msg)
  }

  const deleteTodo = async (id) => {
    await supabase.from('todos').delete().eq('id', id)
  }

  const formatDate = (ts) => {
    const d = new Date(ts)
    const today = new Date()
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
    if (d.toDateString() === today.toDateString()) return 'heute'
    if (d.toDateString() === yesterday.toDateString()) return 'gestern'
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  }

  const openTodos = todos.filter(t => !t.completed)
  const doneTodos = todos.filter(t => t.completed)
  const displayed = filter === 'offen' ? openTodos : filter === 'erledigt' ? doneTodos : todos

  const cardS = { background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '14px 16px', marginBottom: 10 }
  const inputS = { width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', outline: 'none' }

  return (
    <div style={{ maxWidth: 680 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['alle', 'Alle', todos.length], ['offen', 'Offen', openTodos.length], ['erledigt', 'Erledigt', doneTodos.length]].map(([key, label, count]) => (
            <button key={key} onClick={() => setFilter(key)} style={{
              padding: '5px 14px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 12,
              background: filter === key ? '#7c3aed' : 'transparent',
              color: filter === key ? '#fff' : 'var(--text-muted)',
              border: `1px solid ${filter === key ? '#7c3aed' : 'var(--border)'}`,
            }}>{label} {count > 0 && <span style={{ fontSize: 10, marginLeft: 4, opacity: .8 }}>{count}</span>}</button>
          ))}
        </div>
        <button onClick={() => setShowAdd(!showAdd)} style={{
          padding: '6px 14px', borderRadius: 7, background: 'rgba(124,58,237,0.15)', color: '#a78bfa',
          border: '1px solid rgba(124,58,237,0.3)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        }}>+ Neue Aufgabe</button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{ ...cardS, border: '1px solid #7c3aed', marginBottom: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)} style={inputS} placeholder="Aufgabe *" autoFocus
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && addTodo()} />
            <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} style={{ ...inputS, resize: 'vertical' }} rows={2} placeholder="Beschreibung (optional)" />
            <div style={{ display: 'flex', gap: 6 }}>
              {Object.entries(PRIORITY_LABELS).map(([k, l]) => (
                <button key={k} onClick={() => setNewPriority(k)} style={{
                  padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
                  background: newPriority === k ? PRIORITY_COLORS[k] + '22' : 'transparent',
                  color: newPriority === k ? PRIORITY_COLORS[k] : 'var(--text-muted)',
                  border: `1px solid ${newPriority === k ? PRIORITY_COLORS[k] : 'var(--border)'}`,
                }}>{l}</button>
              ))}
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
      {(filter === 'alle' || filter === 'offen') && openTodos.length > 0 && (
        <div style={cardS}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 10 }}>Offen · {openTodos.length}</div>
          {openTodos.map(todo => {
            const color = PRIORITY_COLORS[todo.priority] || '#f59e0b'
            return (
              <div key={todo.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 8, marginBottom: 6, background: color + '06', border: `0.5px solid ${color}33` }}>
                <div onClick={() => toggleTodo(todo)} style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 1, cursor: 'pointer', border: `1.5px solid ${color}`, background: 'transparent' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{todo.title}</div>
                  {todo.description && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.4 }}>{todo.description}</div>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 4, background: color + '22', color }}>{PRIORITY_LABELS[todo.priority]}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>von {todo.created_by} · {formatDate(todo.created_at)}</span>
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
      {(filter === 'alle' || filter === 'erledigt') && doneTodos.length > 0 && (
        <div style={cardS}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 10 }}>Erledigt · {doneTodos.length}</div>
          {doneTodos.map(todo => (
            <div key={todo.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 8, marginBottom: 6, background: 'var(--bg-card2)', border: '0.5px solid var(--border)', opacity: 0.55 }}>
              <div onClick={() => toggleTodo(todo)} style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 1, cursor: 'pointer', background: '#10b981', border: '1.5px solid #10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>v</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', textDecoration: 'line-through' }}>{todo.title}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                  erledigt von {todo.completed_by} · {formatDate(todo.completed_at)}
                </div>
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
