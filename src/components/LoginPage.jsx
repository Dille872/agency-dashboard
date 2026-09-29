import React, { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react' // v5.2.0: Linien-Icon statt Emoji
import { supabase, FUNCTIONS_URL } from '../supabase'
import Logo from './Logo'
import { APP_VERSION } from '../version'
import { loginSprache, spracheSetzen, serverText } from '../i18n/sprache' // v4.110.0

// v4.110.0: Anmeldeseite zweisprachig (DE/EN). Start: gespeicherte Wahl, sonst
// Handy-Sprache. Umschalter oben rechts auf der Karte.
const TEXTE = {
  de: {
    anmelden: 'Anmelden', konto: 'Konto erstellen', vergessen_t: 'Passwort vergessen', willkommen: 'Willkommen zurück 👋',
    t_vergessen: 'Trag deine E-Mail ein und frag ein neues Passwort an. Das Team gibt es frei, dann bekommst du einen Code.',
    t_konto: 'Nimm die E-Mail-Adresse, die das Team für dich freigeschaltet hat, und wähl dir ein Passwort.',
    t_login: 'Melde dich mit deiner E-Mail und deinem Passwort an.',
    email: 'E-Mail', passwort: 'Passwort', neues_pw: 'Neues Passwort', pw_wdh: 'Passwort wiederholen', wdh: 'Wiederholen',
    vergessen_link: 'Vergessen?', laedt_konto: 'Konto wird angelegt…', laedt_login: 'Anmelden…', login_knopf: 'Anmelden →',
    moment: 'Moment…', anfragen: 'Neues Passwort anfragen', code_da: '🔑 Code schon bekommen?',
    code_text: 'Dann trag ihn hier mit deinem neuen Passwort ein. Der Code gilt 60 Minuten.', code: 'Code', pw_setzen: 'Neues Passwort setzen',
    zurueck: '← Zurück zum Anmelden', nicht_frei: 'Kommt „nicht freigeschaltet"? Dann melde dich beim Team — wir schalten deine Adresse frei, danach klappt es sofort.',
    fuss: 'Zugang nur für das Team', min: (n, akt) => `Mindestens ${n} Zeichen${akt ? ` · aktuell ${akt}` : ''}`,
    f_login: 'Login fehlgeschlagen. E-Mail oder Passwort falsch.', f_laenge: (n) => `Das Passwort muss mindestens ${n} Zeichen haben.`,
    f_gleich: 'Die beiden Passwörter sind nicht gleich.', f_konto: 'Konto konnte nicht angelegt werden.',
    ok_konto: (n) => `Konto angelegt. Willkommen, ${n}!`, f_konto_login: 'Konto angelegt, aber die Anmeldung hat nicht geklappt. Bitte oben normal anmelden.',
    f_allg: (m) => `Es hat nicht geklappt: ${m}`, f_email: 'Bitte deine E-Mail-Adresse eintragen.', f_anfrage: 'Die Anfrage hat nicht geklappt.',
    f_code: 'Bitte den Code eintragen, den du bekommen hast.', f_pw: 'Passwort konnte nicht gesetzt werden.',
    ok_pw: 'Passwort geändert. Bitte melde dich jetzt oben an.', zeigen: 'Passwort anzeigen', verbergen: 'Passwort verbergen',
  },
  en: {
    anmelden: 'Sign in', konto: 'Create account', vergessen_t: 'Forgot password', willkommen: 'Welcome back 👋',
    t_vergessen: 'Enter your email and request a new password. Once the team approves it, you will get a code.',
    t_konto: 'Use the email address the team activated for you and choose a password.',
    t_login: 'Sign in with your email and password.',
    email: 'Email', passwort: 'Password', neues_pw: 'New password', pw_wdh: 'Repeat password', wdh: 'Repeat',
    vergessen_link: 'Forgot?', laedt_konto: 'Creating account…', laedt_login: 'Signing in…', login_knopf: 'Sign in →',
    moment: 'One moment…', anfragen: 'Request new password', code_da: '🔑 Already got a code?',
    code_text: 'Enter it here together with your new password. The code is valid for 60 minutes.', code: 'Code', pw_setzen: 'Set new password',
    zurueck: '← Back to sign in', nicht_frei: 'Getting "not activated"? Contact the team, we will activate your address and it will work right away.',
    fuss: 'Team access only', min: (n, akt) => `At least ${n} characters${akt ? ` · currently ${akt}` : ''}`,
    f_login: 'Sign-in failed. Wrong email or password.', f_laenge: (n) => `The password must have at least ${n} characters.`,
    f_gleich: 'The two passwords do not match.', f_konto: 'The account could not be created.',
    ok_konto: (n) => `Account created. Welcome, ${n}!`, f_konto_login: 'Account created, but signing in did not work. Please sign in above.',
    f_allg: (m) => `Something went wrong: ${m}`, f_email: 'Please enter your email address.', f_anfrage: 'The request did not work.',
    f_code: 'Please enter the code you received.', f_pw: 'The password could not be set.',
    ok_pw: 'Password changed. Please sign in above.', zeigen: 'Show password', verbergen: 'Hide password',
  },
}

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
function PasswortFeld({ value, onChange, autoComplete, required, T = TEXTE.de }) {
  const [sichtbar, setSichtbar] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <input type={sichtbar ? 'text' : 'password'} value={value} onChange={onChange}
        placeholder="••••••••" required={required} autoComplete={autoComplete}
        style={{ ...inputS, paddingRight: 48 }} {...fokus} />
      <button type="button" className="login-auge" onClick={() => setSichtbar(v => !v)}
        aria-label={sichtbar ? T.verbergen : T.zeigen}
        style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', width: 38, height: 38, borderRadius: 10, border: 'none', background: 'transparent', color: sichtbar ? 'var(--ton-lila)' : 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, transition: 'color 0.15s' }}>
        {sichtbar ? <EyeOff size={18} strokeWidth={2} /> : <Eye size={18} strokeWidth={2} />}
      </button>
    </div>
  )
}

export default function LoginPage() {
  const [sprache, setSprache] = useState(loginSprache)
  const T = TEXTE[sprache]
  const umschalten = (s) => { setSprache(s); spracheSetzen(s) }
  const st = (x) => serverText(x, sprache)
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
    if (error) setError(T.f_login)
    setLoading(false)
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    setError(''); setHinweis('')
    if (password.length < MIN_PASSWORT) return setError(T.f_laenge(MIN_PASSWORT))
    if (password !== password2) return setError(T.f_gleich)
    setLoading(true)
    try {
      const resp = await fetch(`${FUNCTIONS_URL}/self-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!data.ok) { setError(st(data.error) || T.f_konto); setLoading(false); return }
      setHinweis(T.ok_konto(data.display_name || ''))
      const { error: loginErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(), password,
      })
      if (loginErr) {
        setHinweis('')
        setError(T.f_konto_login)
        setModus('login')
      }
    } catch (err) {
      setError(T.f_allg(err.message))
    }
    setLoading(false)
  }

  const handleAnfrage = async () => {
    if (!email.trim()) return setError(T.f_email)
    setError(''); setHinweis(''); setLoading(true)
    try {
      const data = await ruf('request')
      if (data.ok) setHinweis(st(data.message))
      else setError(st(data.error) || T.f_anfrage)
    } catch (err) {
      setError(T.f_allg(err.message))
    }
    setLoading(false)
  }

  const handleNeuesPasswort = async (e) => {
    e.preventDefault()
    setError(''); setHinweis('')
    if (!code.trim()) return setError(T.f_code)
    if (password.length < MIN_PASSWORT) return setError(T.f_laenge(MIN_PASSWORT))
    if (password !== password2) return setError(T.f_gleich)
    setLoading(true)
    try {
      const data = await ruf('set', { code: code.trim(), password })
      if (!data.ok) { setError(st(data.error) || T.f_pw); setLoading(false); return }
      const { error: loginErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(), password,
      })
      if (loginErr) {
        setHinweis(T.ok_pw)
        setModus('login')
      }
    } catch (err) {
      setError(T.f_allg(err.message))
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
      {T.min(MIN_PASSWORT, password ? password.length : 0)}
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
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)', position: 'relative',
      }}>
        {/* v4.110.0: Sprache */}
        <div role="group" aria-label="Sprache / Language" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -8, marginBottom: 12 }}>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 9, overflow: 'hidden' }}>
            {['de', 'en'].map(s => (
              <button key={s} type="button" onClick={() => umschalten(s)} aria-pressed={sprache === s}
                style={{ padding: '5px 10px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 800, background: sprache === s ? '#7c3aed' : 'transparent', color: sprache === s ? '#fff' : 'var(--text-muted)' }}>
                {s.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        {!vergessen && (
          <div style={{ display: 'flex', gap: 4, background: 'var(--bg-input)', padding: 4, borderRadius: 13, marginBottom: 22, border: '1px solid var(--border)' }}>
            {[['login', T.anmelden], ['registrieren', T.konto]].map(([k, l]) => (
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
          {vergessen ? T.vergessen_t : registrieren ? T.konto : T.willkommen}
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 22, lineHeight: 1.55 }}>
          {vergessen
            ? T.t_vergessen
            : registrieren
              ? T.t_konto
              : T.t_login}
        </div>

        {/* ── Anmelden / Konto erstellen ───────────────────────────────── */}
        {!vergessen && (
          <form onSubmit={registrieren ? handleRegister : handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
            <div>
              <label style={labelS}>{T.email}</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="name@agency.com" required autoComplete="email" style={inputS} {...fokus} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <label style={labelS}>{registrieren ? T.neues_pw : T.passwort}</label>
                {!registrieren && (
                  <button type="button" className="login-link" onClick={() => wechseln('vergessen')} style={{ ...linkS, fontSize: 12 }}>{T.vergessen_link}</button>
                )}
              </div>
              <PasswortFeld T={T} value={password} onChange={e => setPassword(e.target.value)} required
                autoComplete={registrieren ? 'new-password' : 'current-password'} />
              {registrieren && laengeHinweis}
            </div>
            {registrieren && (
              <div>
                <label style={labelS}>{T.pw_wdh}</label>
                <PasswortFeld T={T} value={password2} onChange={e => setPassword2(e.target.value)} required autoComplete="new-password" />
              </div>
            )}
            {fehlerKasten}
            {hinweisKasten}
            <button type="submit" className="login-knopf" disabled={loading} style={knopfS(loading)}>
              {loading ? (registrieren ? T.laedt_konto : T.laedt_login) : (registrieren ? T.konto : T.login_knopf)}
            </button>
          </form>
        )}

        {/* ── Passwort vergessen ───────────────────────────────────────── */}
        {vergessen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
            <div>
              <label style={labelS}>{T.email}</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="name@agency.com" autoComplete="email" style={inputS} {...fokus} />
            </div>
            {fehlerKasten}
            {hinweisKasten}
            <button type="button" className="login-knopf" onClick={handleAnfrage} disabled={loading} style={knopfS(loading)}>
              {loading ? T.moment : T.anfragen}
            </button>

            <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 16, padding: 16, marginTop: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                {T.code_da}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
                {T.code_text}
              </div>
              <form onSubmit={handleNeuesPasswort} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                <div>
                  <label style={labelS}>{T.code}</label>
                  <input value={code} onChange={e => setCode(e.target.value)} placeholder="123456"
                    inputMode="numeric" maxLength={6}
                    style={{ ...inputS, background: 'var(--bg-card)', fontFamily: 'monospace', letterSpacing: '0.35em', fontSize: 18, textAlign: 'center' }} {...fokus} />
                </div>
                <div>
                  <label style={labelS}>{T.neues_pw}</label>
                  <PasswortFeld T={T} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
                  {laengeHinweis}
                </div>
                <div>
                  <label style={labelS}>{T.wdh}</label>
                  <PasswortFeld T={T} value={password2} onChange={e => setPassword2(e.target.value)} autoComplete="new-password" />
                </div>
                <button type="submit" className="login-knopf" disabled={loading} style={knopfS(loading)}>
                  {loading ? T.moment : T.pw_setzen}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ── Fusszeile ────────────────────────────────────────────────── */}
        {(vergessen || registrieren) && (
          <div style={{ marginTop: 18, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6, textAlign: vergessen ? 'center' : 'left' }}>
            {vergessen ? (
              <button type="button" className="login-link" onClick={() => wechseln('login')} style={linkS}>{T.zurueck}</button>
            ) : (
              <>{T.nicht_frei}</>
            )}
          </div>
        )}
      </div>

      <div style={{ marginTop: 18, fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center' }}>
        {T.fuss} · {APP_VERSION}
      </div>
    </div>
  )
}
