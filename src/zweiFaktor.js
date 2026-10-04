// ── Zwei-Faktor-Anmeldung (v5.42.0) ─────────────────────────────────────────
// Pflicht für Admin und Manager. Eingebaut in Supabase Auth (TOTP), kein
// fremder Dienst. Die Datenbank prüft mit (sql/zwei-faktor.sql): ein Admin-/
// Manager-Login ohne Code („aal1“) bekommt keine Daten.
import { supabase } from './supabase'

export const PFLICHT_ROLLEN = ['admin', 'manager']
export const zweiFaktorPflicht = (roles) => (roles || []).some(r => PFLICHT_ROLLEN.includes(r))

// 'ok' = Code für diese Anmeldung schon eingegeben
// 'code' = App ist eingerichtet, Code fehlt noch
// 'einrichten' = noch keine App verknüpft
export async function zweiFaktorStufe() {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error) throw error
  if (data?.currentLevel === 'aal2') return 'ok'
  if (data?.nextLevel === 'aal2') return 'code'
  return 'einrichten'
}

// Halb angefangene Einrichtungen (QR gezeigt, nie bestätigt) wegräumen —
// sonst lehnt Supabase eine neue Einrichtung mit gleichem Namen ab.
async function unfertigeWeg() {
  const { data } = await supabase.auth.mfa.listFactors()
  for (const f of data?.all || []) {
    if (f.factor_type === 'totp' && f.status !== 'verified') {
      await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => {})
    }
  }
}

// Neue App-Verknüpfung anlegen → { id, qr, secret }
export async function einrichtungStarten() {
  await unfertigeWeg()
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `Dashboard ${new Date().toISOString().slice(0, 16)}`,
    issuer: 'Thirteen 87',
  })
  if (error) throw error
  let qr = data?.totp?.qr_code || ''
  if (qr.trim().startsWith('<svg')) qr = `data:image/svg+xml;utf-8,${encodeURIComponent(qr)}`
  return { id: data.id, qr, secret: data?.totp?.secret || '' }
}

// Eingerichtete App (für die Code-Abfrage beim Login)
export async function meineApp() {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw error
  return (data?.totp || []).find(f => f.status === 'verified') || null
}

export async function codePruefen(factorId, code) {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: String(code).trim() })
  if (error) throw error
}

export const geheimSchoen = (s) => String(s || '').replace(/(.{4})/g, '$1 ').trim()

// Verständliche Fehlermeldung
export function fehlerText(e) {
  const m = String(e?.message || e || '')
  if (/invalid.*(totp|code)|code.*invalid|expired/i.test(m)) return 'Code stimmt nicht. Warte auf den nächsten Code in der App (wechselt alle 30 Sekunden).'
  if (/rate|too many/i.test(m)) return 'Zu viele Versuche. Bitte kurz warten.'
  if (/disabled|not enabled|mfa.*enroll/i.test(m)) return 'Zwei-Faktor ist in Supabase ausgeschaltet (Authentication → Multi-Factor → TOTP).'
  return m || 'Unbekannter Fehler'
}

// ── Team-Übersicht & Notfall (nur Admins) ──────────────────────────────────
export async function teamStand() {
  const { data, error } = await supabase.rpc('zwei_faktor_stand')
  if (error) throw error
  return data || []
}
export async function zuruecksetzen(userId) {
  const { error } = await supabase.rpc('zwei_faktor_zuruecksetzen', { p_user: userId })
  if (error) throw error
}
