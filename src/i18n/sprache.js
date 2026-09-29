import { useEffect, useState } from 'react'

// ── Sprache der Oberfläche, DE / EN (v4.110.0) ─────────────────────────────
// Eine Stelle für alle zweisprachigen Teile: Anmeldeseite, Social Media
// Manager, Rahmen für Social-Rollen, Hinweis „Neue Version“.
//
// Reihenfolge:
//   1. Pro Person in den Einstellungen gesetzt (user_roles.sprache) — wird
//      beim Anmelden übernommen und gilt dann auf jedem Gerät.
//   2. Sonst, was auf diesem Gerät zuletzt umgeschaltet wurde.
//   3. Sonst Deutsch. Nur die Anmeldeseite schaut zusätzlich auf die
//      Handy-Sprache (vor dem Login kennen wir die Person noch nicht).
//
// Chatter- und Model-Portal bleiben Deutsch.

const SPEICHER = 'sm_sprache' // derselbe Schlüssel wie seit v4.102.0 im Social Media Manager
const EREIGNIS = 'sprache-geaendert'

export function spracheJetzt() {
  try { const s = localStorage.getItem(SPEICHER); return s === 'en' ? 'en' : 'de' } catch { return 'de' }
}

export function spracheSetzen(s) {
  const neu = s === 'en' ? 'en' : 'de'
  try { localStorage.setItem(SPEICHER, neu) } catch { /* egal */ }
  try { window.dispatchEvent(new CustomEvent(EREIGNIS, { detail: neu })) } catch { /* egal */ }
}

// Anmeldeseite: gespeichert → sonst Handy-/Browser-Sprache
export function loginSprache() {
  try { const s = localStorage.getItem(SPEICHER); if (s === 'en' || s === 'de') return s } catch { /* egal */ }
  try { const l = (navigator.languages?.[0] || navigator.language || '').toLowerCase(); if (l && !l.startsWith('de')) return 'en' } catch { /* egal */ }
  return 'de'
}

export function useSprache(start = spracheJetzt) {
  const [s, setS] = useState(start)
  useEffect(() => {
    const f = (e) => setS(e.detail === 'en' ? 'en' : 'de')
    window.addEventListener(EREIGNIS, f)
    return () => window.removeEventListener(EREIGNIS, f)
  }, [])
  return s
}

// Antworten der Edge Functions (self-signup, password-reset) kommen auf
// Deutsch. Für EN hier übersetzt — so muss keine Function neu deployt werden.
// Unbekannte Texte bleiben, wie sie sind.
const SERVER_EN = [
  [/^E-Mail und Passwort fehlen\.$/, 'Email and password are missing.'],
  [/^Das Passwort muss mindestens (\d+) Zeichen haben\.$/, 'The password must have at least $1 characters.'],
  [/^Diese E-Mail-Adresse ist nicht freigeschaltet\./, 'This email address has not been activated yet. Please contact the team and we will activate it.'],
  [/^Die Freischaltung für diese Adresse ist abgelaufen\./, 'The activation for this address has expired. Please contact the team and we will renew it.'],
  [/^Für diese Adresse gibt es schon ein Konto\./, 'There is already an account for this address. Sign in with your password, or ask the team if you forgot it.'],
  [/^Konto konnte nicht angelegt werden\.$/, 'The account could not be created.'],
  [/^Rolle konnte nicht gesetzt werden\./, 'Your role could not be set. Please contact the team.'],
  [/^E-Mail fehlt\.$/, 'Email is missing.'],
  [/^Die Anfrage ist beim Team\./, 'Your request has been sent to the team. Once it is approved you will get a code, then you can set your new password here.'],
  [/^E-Mail, Code und Passwort werden gebraucht\.$/, 'Email, code and password are required.'],
  [/^Für diese Adresse ist gerade nichts freigegeben\./, 'Nothing has been approved for this address yet. Please send a request first, or ask the team.'],
  [/^Der Code ist abgelaufen\./, 'The code has expired. Please send a new request.'],
  [/^Der Code stimmt nicht\. Die Freigabe ist gesperrt/, 'The code is wrong. The approval is now locked, please send a new request.'],
  [/^Der Code war (\d+)× falsch\./, 'The code was wrong $1 times. The approval is now locked, please send a new request.'],
  [/^Der Code stimmt nicht\. Noch (\d+) Versuch/, 'The code is wrong. $1 attempt(s) left.'],
  [/^Passwort konnte nicht gesetzt werden\.$/, 'The password could not be set.'],
]
export function serverText(text, sprache) {
  if (sprache !== 'en' || !text) return text
  const s = String(text)
  for (const [re, en] of SERVER_EN) {
    const m = s.match(re)
    if (m) return en.replace(/\$(\d)/g, (_, n) => m[Number(n)] ?? '')
  }
  return s
}
