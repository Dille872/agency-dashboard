import React, { useState } from 'react'
import { supabase, FUNCTIONS_URL } from '../supabase'
import Logo from './Logo'
import { APP_VERSION } from '../version'

// v4.11.0: Modus „Konto erstellen" — freigeschaltete Adresse + selbst gewähltes Passwort.
// v4.12.0: Modus „Passwort vergessen" — Anfrage, Freigabe durch einen Admin, Code, neues Passwort.
//
// Beides läuft über Edge Functions mit Service-Role, nicht über den Browser:
// Weder die Liste der freigeschalteten Adressen noch die Codes dürfen von aussen
// lesbar sein. Kein Mailversand — Supabase-Mails sind gedrosselt und landen im
// Spam, genau daran ist der frühere Einladungsweg gescheitert.

const MIN_PASSWORT = 10

// v4.91.0: Login im neuen Stil — großes Logo, weiche Farbflächen im Hintergrund,
// runde Felder, Auge zum Passwort-Anzeigen, großer Knopf. Logik unverändert.
const inputS = {
  width: '100%', boxSizing: 'border-box',
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  padding: '13px 14px',
  borderRadius: 12,
  fontSize: 15,
  outline: 'none',
  fontFamily: 'var(--font-sans)',
  transition: 'border-color 0.2s, box-shadow 0.2s',
}
const labelS = {
  fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase',
  letterSpacing: '0.08em', fontWeight: 700, display: 'block', marginBottom: 7,
}
const fokus = {
  onFocus: e => { e.target.style.borderColor = '#7c3aed'; e.target.style.boxShadow = '0 0 0 3px rgba(124,58,237,0.18)' },
  onBlur: e => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none' },
}
const knopfS = (loading) => ({
  background: loading ? '#4a4a6a' : 'linear-gradient(135deg, #7c3aed, #4f46e5)',
  color: '#fff', border: 'none', borderRadius: 14, padding: '14px',
  fontSize: 15, fontWeight: 800, cursor: loading ? 'not-allowed' : 'pointer',
  fontFamily: 'var(--font-sans)', marginTop: 6, width: '100%',
  boxShadow: loading ? 'none' : '0 8px 24px rgba(124,58,237,0.35)',
})
const linkS = {
  background: 'transparent', border: 'none', color: 'var(--ton-lila)', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 13, padding: 0, fontWeight: 600,
}

// Passwortfeld mit Auge (anzeigen/verbergen)
function PasswortFeld({ value, onChange, autoComplete, required }) {
  const [sichtbar, setSichtbar] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <input type={sichtbar ? 'text' : 'password'} value={value} onChange={onChange}
        placeholder="••••••••" required={required} autoComplete={autoComplete}
        style={{ ...inputS, paddingRight: 48 }} {...fokus} />
      <button type="button" className="login-auge" onClick={() => setSichtbar(v => !v)}
        aria-label={sichtbar ? 'Passwort verbergen' : 'Passwort anzeigen'}
        style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', width: 38, height: 38, borderRadius: 10, border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
        {sichtbar ? '🙈' : '👁'}
      </button>
    </div>
  )
}

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
      color: 'var(--ton-rot)', borderRadius: 12, padding: '11px 14px', fontSize: 13, lineHeight: 1.5,
    }}>{error}</div>
  )
  const hinweisKasten = hinweis && (
    <div style={{
      background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)',
      color: 'var(--ton-gruen)', borderRadius: 12, padding: '11px 14px', fontSize: 13, lineHeight: 1.5,
    }}>{hinweis}</div>
  )
  const laengeHinweis = (
    <div style={{ fontSize: 11.5, color: password && password.length < MIN_PASSWORT ? 'var(--ton-amber)' : 'var(--text-muted)', marginTop: 6 }}>
      Mindestens {MIN_PASSWORT} Zeichen{password ? ` · aktuell ${password.length}` : ''}
    </div>
  )

  return (
    <div className="login-seite" style={{
      minHeight: '100vh', boxSizing: 'border-box',
      background: 'radial-gradient(circle at 12% 8%, rgba(124,58,237,0.22), transparent 42%), radial-gradient(circle at 92% 95%, rgba(6,182,212,0.16), transparent 45%), var(--bg-base)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-sans)', padding: '32px 16px',
    }}>
      {/* Marke */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 22, textAlign: 'center' }}>
        <div style={{
          width: 72, height: 72, borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(145deg, rgba(139,140,249,0.16), rgba(201,139,255,0.08))',
          border: '1px solid rgba(139,140,249,0.35)', boxShadow: '0 12px 40px rgba(124,58,237,0.28)', marginBottom: 14,
        }}>
          <Logo size={44} />
        </div>
        <div style={{ fontSize: 21, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Thirteen 87 Collective</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3 }}>Agency Dashboard</div>
      </div>

      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 22,
        padding: 'clamp(22px, 5vw, 32px)', width: '100%', maxWidth: 410, boxSizing: 'border-box',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }}>
        {!vergessen && (
          <div style={{ display: 'flex', gap: 4, background: 'var(--bg-input)', padding: 4, borderRadius: 13, marginBottom: 22, border: '1px solid var(--border)' }}>
            {[['login', 'Anmelden'], ['registrieren', 'Konto erstellen']].map(([k, l]) => (
              <button key={k} type="button" className="login-tab" onClick={() => wechseln(k)} style={{
                flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700,
                background: modus === k ? '#7c3aed' : 'transparent',
                color: modus === k ? '#fff' : 'var(--text-muted)',
                boxShadow: modus === k ? '0 4px 14px rgba(124,58,237,0.35)' : 'none',
              }}>{l}</button>
            ))}
          </div>
        )}

        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6, letterSpacing: '-0.01em' }}>
          {vergessen ? 'Passwort vergessen' : registrieren ? 'Konto erstellen' : 'Willkommen zurück 👋'}
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 22, lineHeight: 1.55 }}>
          {vergessen
            ? 'Trag deine E-Mail ein und frag ein neues Passwort an. Das Team gibt es frei, dann bekommst du einen Code.'
            : registrieren
              ? 'Nimm die E-Mail-Adresse, die das Team für dich freigeschaltet hat, und wähl dir ein Passwort.'
              : 'Melde dich mit deiner E-Mail und deinem Passwort an.'}
        </div>

        {/* ── Anmelden / Konto erstellen ───────────────────────────────── */}
        {!vergessen && (
          <form onSubmit={registrieren ? handleRegister : handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
            <div>
              <label style={labelS}>E-Mail</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="name@agency.com" required autoComplete="email" style={inputS} {...fokus} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <label style={labelS}>{registrieren ? 'Neues Passwort' : 'Passwort'}</label>
                {!registrieren && (
                  <button type="button" className="login-link" onClick={() => wechseln('vergessen')} style={{ ...linkS, fontSize: 12 }}>Vergessen?</button>
                )}
              </div>
              <PasswortFeld value={password} onChange={e => setPassword(e.target.value)} required
                autoComplete={registrieren ? 'new-password' : 'current-password'} />
              {registrieren && laengeHinweis}
            </div>
            {registrieren && (
              <div>
                <label style={labelS}>Passwort wiederholen</label>
                <PasswortFeld value={password2} onChange={e => setPassword2(e.target.value)} required autoComplete="new-password" />
              </div>
            )}
            {fehlerKasten}
            {hinweisKasten}
            <button type="submit" className="login-knopf" disabled={loading} style={knopfS(loading)}>
              {loading ? (registrieren ? 'Konto wird angelegt…' : 'Anmelden…') : (registrieren ? 'Konto erstellen' : 'Anmelden →')}
            </button>
          </form>
        )}

        {/* ── Passwort vergessen ───────────────────────────────────────── */}
        {vergessen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
            <div>
              <label style={labelS}>E-Mail</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="name@agency.com" autoComplete="email" style={inputS} {...fokus} />
            </div>
            {fehlerKasten}
            {hinweisKasten}
            <button type="button" className="login-knopf" onClick={handleAnfrage} disabled={loading} style={knopfS(loading)}>
              {loading ? 'Moment…' : 'Neues Passwort anfragen'}
            </button>

            <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 16, padding: 16, marginTop: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                🔑 Code schon bekommen?
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
                Dann trag ihn hier mit deinem neuen Passwort ein. Der Code gilt 60 Minuten.
              </div>
              <form onSubmit={handleNeuesPasswort} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                <div>
                  <label style={labelS}>Code</label>
                  <input value={code} onChange={e => setCode(e.target.value)} placeholder="123456"
                    inputMode="numeric" maxLength={6}
                    style={{ ...inputS, background: 'var(--bg-card)', fontFamily: 'monospace', letterSpacing: '0.35em', fontSize: 18, textAlign: 'center' }} {...fokus} />
                </div>
                <div>
                  <label style={labelS}>Neues Passwort</label>
                  <PasswortFeld value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
                  {laengeHinweis}
                </div>
                <div>
                  <label style={labelS}>Wiederholen</label>
                  <PasswortFeld value={password2} onChange={e => setPassword2(e.target.value)} autoComplete="new-password" />
                </div>
                <button type="submit" className="login-knopf" disabled={loading} style={knopfS(loading)}>
                  {loading ? 'Moment…' : 'Neues Passwort setzen'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ── Fusszeile ────────────────────────────────────────────────── */}
        {(vergessen || registrieren) && (
          <div style={{ marginTop: 18, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6, textAlign: vergessen ? 'center' : 'left' }}>
            {vergessen ? (
              <button type="button" className="login-link" onClick={() => wechseln('login')} style={linkS}>← Zurück zum Anmelden</button>
            ) : (
              <>Kommt „nicht freigeschaltet"? Dann melde dich beim Team — wir schalten deine Adresse frei, danach klappt es sofort.</>
            )}
          </div>
        )}
      </div>

      <div style={{ marginTop: 18, fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center' }}>
        Zugang nur für das Team · {APP_VERSION}
      </div>
    </div>
  )
}
