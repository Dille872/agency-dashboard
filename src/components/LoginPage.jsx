import React, { useState } from 'react'
import { supabase, FUNCTIONS_URL } from '../supabase'
import Logo from './Logo'

// v4.11.0: Modus „Konto erstellen" — freigeschaltete Adresse + selbst gewähltes Passwort.
// v4.12.0: Modus „Passwort vergessen" — Anfrage, Freigabe durch einen Admin, Code, neues Passwort.
//
// Beides läuft über Edge Functions mit Service-Role, nicht über den Browser:
// Weder die Liste der freigeschalteten Adressen noch die Codes dürfen von aussen
// lesbar sein. Kein Mailversand — Supabase-Mails sind gedrosselt und landen im
// Spam, genau daran ist der frühere Einladungsweg gescheitert.

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
const knopfS = (loading) => ({
  background: loading ? '#4a4a6a' : 'linear-gradient(135deg, #7c3aed, #4f46e5)',
  color: '#fff', border: 'none', borderRadius: 8, padding: '12px',
  fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
  fontFamily: 'var(--font-sans)', marginTop: 4,
})

export default function LoginPage() {
  const [modus, setModus] = useState('login')   // login | registrieren | vergessen
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [hinweis, setHinweis] = useState('')
  const [loading, setLoading] = useState(false)

  const zuruecksetzen = () => { setError(''); setHinweis(''); setPassword(''); setPassword2(''); setCode('') }
  const wechseln = (m) => { setModus(m); zuruecksetzen() }

  const ruf = async (aktion, extra = {}) => {
    const resp = await fetch(`${FUNCTIONS_URL}/password-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: aktion, email: email.trim().toLowerCase(), ...extra }),
    })
    return resp.json().catch(() => ({}))
  }

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
    if (password.length < MIN_PASSWORT) return setError(`Das Passwort muss mindestens ${MIN_PASSWORT} Zeichen haben.`)
    if (password !== password2) return setError('Die beiden Passwörter sind nicht gleich.')
    setLoading(true)
    try {
      const resp = await fetch(`${FUNCTIONS_URL}/self-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!data.ok) { setError(data.error || 'Konto konnte nicht angelegt werden.'); setLoading(false); return }
      setHinweis(`Konto angelegt. Willkommen, ${data.display_name || ''}!`)
      const { error: loginErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(), password,
      })
      if (loginErr) {
        setHinweis('')
        setError('Konto angelegt, aber die Anmeldung hat nicht geklappt. Bitte oben normal anmelden.')
        setModus('login')
      }
    } catch (err) {
      setError(`Es hat nicht geklappt: ${err.message}`)
    }
    setLoading(false)
  }

  const handleAnfrage = async () => {
    if (!email.trim()) return setError('Bitte deine E-Mail-Adresse eintragen.')
    setError(''); setHinweis(''); setLoading(true)
    try {
      const data = await ruf('request')
      if (data.ok) setHinweis(data.message)
      else setError(data.error || 'Die Anfrage hat nicht geklappt.')
    } catch (err) {
      setError(`Es hat nicht geklappt: ${err.message}`)
    }
    setLoading(false)
  }

  const handleNeuesPasswort = async (e) => {
    e.preventDefault()
    setError(''); setHinweis('')
    if (!code.trim()) return setError('Bitte den Code eintragen, den du bekommen hast.')
    if (password.length < MIN_PASSWORT) return setError(`Das Passwort muss mindestens ${MIN_PASSWORT} Zeichen haben.`)
    if (password !== password2) return setError('Die beiden Passwörter sind nicht gleich.')
    setLoading(true)
    try {
      const data = await ruf('set', { code: code.trim(), password })
      if (!data.ok) { setError(data.error || 'Passwort konnte nicht gesetzt werden.'); setLoading(false); return }
      const { error: loginErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(), password,
      })
      if (loginErr) {
        setHinweis('Passwort geändert. Bitte melde dich jetzt oben an.')
        setModus('login')
      }
    } catch (err) {
      setError(`Es hat nicht geklappt: ${err.message}`)
    }
    setLoading(false)
  }

  const registrieren = modus === 'registrieren'
  const vergessen = modus === 'vergessen'

  const fehlerKasten = error && (
    <div style={{
      background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
      color: '#ef4444', borderRadius: 8, padding: '10px 14px', fontSize: 13, lineHeight: 1.5,
    }}>{error}</div>
  )
  const hinweisKasten = hinweis && (
    <div style={{
      background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)',
      color: '#10b981', borderRadius: 8, padding: '10px 14px', fontSize: 13, lineHeight: 1.5,
    }}>{hinweis}</div>
  )

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg-base)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-sans)', padding: 16,
    }}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16,
        padding: '40px 44px', width: '100%', maxWidth: 400,
        boxShadow: '0 0 60px rgba(124,58,237,0.1)',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <div style={{ width: 36, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Logo size={36} />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Thirteen 87 Collective</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Agency Dashboard</div>
          </div>
        </div>

        {!vergessen && (
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
        )}

        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
          {vergessen ? 'Passwort vergessen' : registrieren ? 'Konto erstellen' : 'Anmelden'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.55 }}>
          {vergessen
            ? 'Trag deine E-Mail ein und frag ein neues Passwort an. Das Team gibt es frei, dann bekommst du einen Code.'
            : registrieren
              ? 'Nimm die E-Mail-Adresse, die das Team für dich freigeschaltet hat, und wähl dir ein Passwort.'
              : 'Zugang nur für autorisierte Benutzer'}
        </div>

        {/* ── Anmelden / Konto erstellen ───────────────────────────────── */}
        {!vergessen && (
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
            {fehlerKasten}
            {hinweisKasten}
            <button type="submit" disabled={loading} style={knopfS(loading)}>
              {loading ? (registrieren ? 'Konto wird angelegt…' : 'Anmelden…') : (registrieren ? 'Konto erstellen' : 'Anmelden')}
            </button>
          </form>
        )}

        {/* ── Passwort vergessen ───────────────────────────────────────── */}
        {vergessen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelS}>E-Mail</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="name@agency.com" autoComplete="email" style={inputS} {...fokus} />
            </div>
            {fehlerKasten}
            {hinweisKasten}
            <button type="button" onClick={handleAnfrage} disabled={loading} style={knopfS(loading)}>
              {loading ? 'Moment…' : 'Neues Passwort anfragen'}
            </button>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                Code schon bekommen?
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
                Dann trag ihn hier mit deinem neuen Passwort ein. Der Code gilt 60 Minuten.
              </div>
              <form onSubmit={handleNeuesPasswort} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={labelS}>Code</label>
                  <input value={code} onChange={e => setCode(e.target.value)} placeholder="123456"
                    inputMode="numeric" maxLength={6}
                    style={{ ...inputS, fontFamily: 'monospace', letterSpacing: '0.3em', fontSize: 16 }} {...fokus} />
                </div>
                <div>
                  <label style={labelS}>Neues Passwort</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••" autoComplete="new-password" style={inputS} {...fokus} />
                  <div style={{ fontSize: 11, color: password && password.length < MIN_PASSWORT ? '#f59e0b' : 'var(--text-muted)', marginTop: 5 }}>
                    Mindestens {MIN_PASSWORT} Zeichen{password ? ` · aktuell ${password.length}` : ''}
                  </div>
                </div>
                <div>
                  <label style={labelS}>Wiederholen</label>
                  <input type="password" value={password2} onChange={e => setPassword2(e.target.value)}
                    placeholder="••••••••" autoComplete="new-password" style={inputS} {...fokus} />
                </div>
                <button type="submit" disabled={loading} style={knopfS(loading)}>
                  {loading ? 'Moment…' : 'Neues Passwort setzen'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ── Fusszeile ────────────────────────────────────────────────── */}
        <div style={{ marginTop: 18, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          {vergessen ? (
            <button type="button" onClick={() => wechseln('login')} style={{
              background: 'transparent', border: 'none', color: '#a78bfa', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 12, padding: 0, textDecoration: 'underline',
            }}>← Zurück zum Anmelden</button>
          ) : registrieren ? (
            <>Kommt „nicht freigeschaltet"? Dann melde dich beim Team — wir schalten deine Adresse frei, danach klappt es sofort.</>
          ) : (
            <button type="button" onClick={() => wechseln('vergessen')} style={{
              background: 'transparent', border: 'none', color: '#a78bfa', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 12, padding: 0, textDecoration: 'underline',
            }}>Passwort vergessen?</button>
          )}
        </div>
      </div>
    </div>
  )
}
