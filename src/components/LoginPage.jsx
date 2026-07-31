import React, { useState } from 'react'
import { supabase, FUNCTIONS_URL } from '../supabase'
import Logo from './Logo'

// v4.11.0: Zweiter Modus „Konto erstellen".
// Wer sein Konto selbst anlegt, muss vorher freigeschaltet sein — die Prüfung
// macht die Edge Function `self-signup`, nicht der Browser. Danach wird direkt
// angemeldet, damit niemand sein frisch gesetztes Passwort noch einmal eintippen
// muss. Kein Mailversand: Supabase-Mails sind gedrosselt und landen im Spam,
// genau daran ist der bisherige Einladungsweg gescheitert.

const MIN_PASSWORT = 10

const inputS = {
  width: '100%',
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  padding: '10px 14px',
  borderRadius: 8,
  fontSize: 14,
  outline: 'none',
  fontFamily: 'var(--font-sans)',
  transition: 'border-color 0.2s',
}
const labelS = {
  fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase',
  letterSpacing: '0.08em', fontWeight: 600, display: 'block', marginBottom: 6,
}
const fokus = {
  onFocus: e => { e.target.style.borderColor = '#7c3aed' },
  onBlur: e => { e.target.style.borderColor = 'var(--border)' },
}

export default function LoginPage() {
  const [modus, setModus] = useState('login')   // 'login' | 'registrieren'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState('')
  const [hinweis, setHinweis] = useState('')
  const [loading, setLoading] = useState(false)

  const wechseln = (m) => { setModus(m); setError(''); setHinweis(''); setPassword(''); setPassword2('') }

  const handleLogin = async (e) => {
    e.preventDefault()
    setError(''); setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setError('Login fehlgeschlagen. E-Mail oder Passwort falsch.')
    setLoading(false)
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    setError(''); setHinweis('')
    if (password.length < MIN_PASSWORT) {
      setError(`Das Passwort muss mindestens ${MIN_PASSWORT} Zeichen haben.`)
      return
    }
    if (password !== password2) {
      setError('Die beiden Passwörter sind nicht gleich.')
      return
    }
    setLoading(true)
    try {
      const resp = await fetch(`${FUNCTIONS_URL}/self-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!data.ok) {
        setError(data.error || 'Konto konnte nicht angelegt werden.')
        setLoading(false)
        return
      }
      // Direkt anmelden — der Account ist bereits bestätigt.
      setHinweis(`Konto angelegt. Willkommen, ${data.display_name || ''}!`)
      const { error: loginErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(), password,
      })
      if (loginErr) {
        setHinweis('')
        setError('Konto angelegt, aber die Anmeldung hat nicht geklappt. Bitte oben mit E-Mail und Passwort anmelden.')
        setModus('login')
      }
    } catch (err) {
      setError(`Es hat nicht geklappt: ${err.message}`)
    }
    setLoading(false)
  }

  const registrieren = modus === 'registrieren'

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-base)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-sans)',
      padding: 16,
    }}>
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: '40px 44px',
        width: '100%',
        maxWidth: 400,
        boxShadow: '0 0 60px rgba(124,58,237,0.1)',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          {/* v4.7.0: gleiches Logo wie im Admin-Dashboard (vorher "A" in Lila/Cyan) */}
          <div style={{ width: 36, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Logo size={36} />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Thirteen 87 Collective</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Agency Dashboard</div>
          </div>
        </div>

        {/* Umschalter */}
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-input)', padding: 4, borderRadius: 10, marginBottom: 22 }}>
          {[['login', 'Anmelden'], ['registrieren', 'Konto erstellen']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => wechseln(k)} style={{
              flex: 1, padding: '8px', borderRadius: 7, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700,
              background: modus === k ? '#7c3aed' : 'transparent',
              color: modus === k ? '#fff' : 'var(--text-muted)',
            }}>{l}</button>
          ))}
        </div>

        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
          {registrieren ? 'Konto erstellen' : 'Anmelden'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.5 }}>
          {registrieren
            ? 'Nimm die E-Mail-Adresse, die das Team für dich freigeschaltet hat, und wähl dir ein Passwort.'
            : 'Zugang nur für autorisierte Benutzer'}
        </div>

        <form onSubmit={registrieren ? handleRegister : handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelS}>E-Mail</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="name@agency.com" required autoComplete="email" style={inputS} {...fokus} />
          </div>

          <div>
            <label style={labelS}>{registrieren ? 'Neues Passwort' : 'Passwort'}</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required
              autoComplete={registrieren ? 'new-password' : 'current-password'}
              style={inputS} {...fokus} />
            {registrieren && (
              <div style={{ fontSize: 11, color: password && password.length < MIN_PASSWORT ? '#f59e0b' : 'var(--text-muted)', marginTop: 5 }}>
                Mindestens {MIN_PASSWORT} Zeichen{password ? ` · aktuell ${password.length}` : ''}
              </div>
            )}
          </div>

          {registrieren && (
            <div>
              <label style={labelS}>Passwort wiederholen</label>
              <input type="password" value={password2} onChange={e => setPassword2(e.target.value)}
                placeholder="••••••••" required autoComplete="new-password" style={inputS} {...fokus} />
            </div>
          )}

          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#ef4444', borderRadius: 8, padding: '10px 14px', fontSize: 13, lineHeight: 1.5,
            }}>{error}</div>
          )}
          {hinweis && (
            <div style={{
              background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)',
              color: '#10b981', borderRadius: 8, padding: '10px 14px', fontSize: 13,
            }}>{hinweis}</div>
          )}

          <button type="submit" disabled={loading} style={{
            background: loading ? '#4a4a6a' : 'linear-gradient(135deg, #7c3aed, #4f46e5)',
            color: '#fff', border: 'none', borderRadius: 8, padding: '12px',
            fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font-sans)', marginTop: 4,
          }}>
            {loading
              ? (registrieren ? 'Konto wird angelegt…' : 'Anmelden…')
              : (registrieren ? 'Konto erstellen' : 'Anmelden')}
          </button>
        </form>

        {registrieren && (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 16, lineHeight: 1.55 }}>
            Kommt „nicht freigeschaltet"? Dann melde dich beim Team — wir schalten
            deine Adresse frei, danach klappt es sofort.
          </div>
        )}
      </div>
    </div>
  )
}
