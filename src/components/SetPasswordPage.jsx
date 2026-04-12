import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'

export default function SetPasswordPage({ onDone }) {
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubmit = async () => {
    setError('')
    if (password.length < 8) { setError('Passwort muss mindestens 8 Zeichen lang sein.'); return }
    if (password !== password2) { setError('Passwörter stimmen nicht überein.'); return }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError('Fehler: ' + error.message)
    } else {
      setSuccess(true)
      setTimeout(() => onDone(), 2000)
    }
    setLoading(false)
  }

  const inp = { background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '10px 14px', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none', width: '100%' }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-sans)' }}>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '40px 44px', width: '100%', maxWidth: 400, boxShadow: '0 0 60px rgba(124,58,237,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800, color: '#fff' }}>T</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>Thirteen 87</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Passwort festlegen</div>
          </div>
        </div>

        {success ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#10b981' }}>Passwort gesetzt!</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>Du wirst weitergeleitet...</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Willkommen! Lege jetzt dein Passwort fest um das Dashboard zu nutzen.
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Neues Passwort</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mindestens 8 Zeichen" style={inp} autoFocus />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Passwort wiederholen</label>
              <input type="password" value={password2} onChange={e => setPassword2(e.target.value)} placeholder="Passwort wiederholen" style={inp}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
            </div>
            {error && <div style={{ fontSize: 12, color: '#ef4444', padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 7, border: '1px solid rgba(239,68,68,0.3)' }}>{error}</div>}
            <button onClick={handleSubmit} disabled={loading || !password || !password2}
              style={{ padding: '12px', borderRadius: 8, background: password && password2 ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : 'var(--border)', color: password && password2 ? '#fff' : 'var(--text-muted)', border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 }}>
              {loading ? 'Wird gespeichert...' : 'Passwort festlegen'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
