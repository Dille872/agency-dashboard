import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'

const ROLES = [
  { key: 'chatter', label: 'Chatter', color: '#06b6d4' },
  { key: 'model', label: 'Model', color: '#f59e0b' },
  { key: 'admin', label: 'Admin', color: '#7c3aed' },
]

export default function OnboardingTab() {
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState('chatter')
  const [sending, setSending] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')
  const [users, setUsers] = useState([])

  useEffect(() => { loadUsers() }, [])

  const loadUsers = async () => {
    const { data } = await supabase.from('user_roles').select('*').order('role')
    setUsers(data || [])
  }

  const sendInvite = async () => {
    if (!email.trim() || !displayName.trim()) return
    setSending(true); setError(''); setSuccess('')
    try {
      // Invite via Supabase Auth
      const { data, error: inviteError } = await supabase.auth.admin?.inviteUserByEmail
        ? await supabase.auth.admin.inviteUserByEmail(email.trim())
        : { data: null, error: { message: 'Admin API nicht verfügbar – bitte manuell einladen über Supabase Dashboard' } }

      if (inviteError) {
        // Fallback – show manual instructions
        setError(`Manuell einladen: Supabase Dashboard → Authentication → Invite User → ${email.trim()}\n\nDann in SQL:\ninsert into user_roles (user_id, role, display_name) values ('<UUID>', '${role}', '${displayName.trim()}');`)
        setSending(false)
        return
      }

      if (data?.user) {
        await supabase.from('user_roles').insert({
          user_id: data.user.id,
          role,
          display_name: displayName.trim(),
        })
        setSuccess(`✓ Einladung an ${email} gesendet!`)
        setEmail(''); setDisplayName('')
        loadUsers()
      }
    } catch (e) {
      setError(`Manuell einladen:\n1. Supabase Dashboard → Auth → Invite User → ${email.trim()}\n2. Nach Registrierung in SQL:\ninsert into user_roles (user_id, role, display_name)\nvalues ('<UUID aus Auth>', '${role}', '${displayName.trim()}');`)
    }
    setSending(false)
  }

  const deleteUser = async (userId, displayName) => {
    if (!confirm(`${displayName} wirklich entfernen?`)) return
    await supabase.from('user_roles').delete().eq('user_id', userId)
    loadUsers()
  }

  const cardS = { background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '16px 18px' }
  const inputS = { background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%' }
  const labelS = { fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 10 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 700 }}>

      {/* Neues Mitglied einladen */}
      <div style={cardS}>
        <div style={labelS}>Neues Mitglied einladen</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Name (wird im Dashboard angezeigt)</label>
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="z.B. Kaan" style={inputS} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>E-Mail</label>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="kaan@example.com" type="email" style={inputS} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>Rolle</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {ROLES.map(r => (
                <button key={r.key} onClick={() => setRole(r.key)} style={{
                  flex: 1, padding: '8px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
                  background: role === r.key ? r.color + '22' : 'transparent',
                  color: role === r.key ? r.color : 'var(--text-muted)',
                  border: `1px solid ${role === r.key ? r.color : 'var(--border)'}`,
                }}>{r.label}</button>
              ))}
            </div>
          </div>
          <button onClick={sendInvite} disabled={sending || !email.trim() || !displayName.trim()}
            style={{ padding: '10px', borderRadius: 8, background: email.trim() && displayName.trim() ? '#7c3aed' : 'var(--border)', color: email.trim() && displayName.trim() ? '#fff' : 'var(--text-muted)', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 }}>
            {sending ? '⏳ Wird gesendet...' : '✉ Einladung senden'}
          </button>
          {success && <div style={{ fontSize: 12, color: '#10b981', padding: '8px 12px', background: 'rgba(16,185,129,0.1)', borderRadius: 7, border: '1px solid rgba(16,185,129,0.3)' }}>{success}</div>}
          {error && (
            <div style={{ fontSize: 11, color: '#f59e0b', padding: '10px 12px', background: 'rgba(245,158,11,0.08)', borderRadius: 7, border: '1px solid rgba(245,158,11,0.3)', fontFamily: 'monospace', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              ⚠ {error}
            </div>
          )}
        </div>
      </div>

      {/* Anleitung */}
      <div style={cardS}>
        <div style={labelS}>Schritt-für-Schritt Anleitung</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { num: '1', title: 'Einladung senden', desc: 'E-Mail + Name + Rolle eingeben → Einladung senden. Die Person bekommt eine E-Mail mit einem Link.' },
            { num: '2', title: 'Passwort setzen', desc: 'Person klickt den Link und setzt ihr Passwort. Fertig – sie können sich einloggen.' },
            { num: '3', title: 'Telegram verknüpfen', desc: 'Person schreibt @thirteen87agency_bot → bekommt ihre Telegram ID → du trägst sie im Creator/Crew Tab ein.' },
            { num: '4', title: 'Model: Board aufbauen', desc: 'Model loggt sich ein und trägt Preise, No Gos, Content Regeln etc. im "Mein Board" Tab ein.' },
          ].map(step => (
            <div key={step.num} style={{ display: 'flex', gap: 12, padding: '10px 12px', background: 'var(--bg-card2)', borderRadius: 8, border: '1px solid #1e1e3a' }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#a78bfa', flexShrink: 0 }}>{step.num}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>{step.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{step.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Aktuelle Mitglieder */}
      <div style={cardS}>
        <div style={labelS}>Aktuelle Mitglieder ({users.length})</div>
        {users.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>Noch keine Mitglieder</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {users.map(u => {
              const roleColor = u.role === 'admin' ? '#7c3aed' : u.role === 'model' ? '#f59e0b' : '#06b6d4'
              return (
                <div key={u.user_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', background: 'var(--bg-card2)', borderRadius: 8, border: '1px solid #1e1e3a' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: roleColor + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: roleColor, flexShrink: 0 }}>
                      {(u.display_name || '?')[0]}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{u.display_name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{u.user_id.slice(0, 8)}...</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: roleColor, background: roleColor + '22', padding: '2px 8px', borderRadius: 4 }}>{u.role}</span>
                    <button onClick={() => deleteUser(u.user_id, u.display_name)}
                      style={{ background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', color: 'rgba(239,68,68,0.6)', borderRadius: 5, padding: '3px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                      ✕
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
