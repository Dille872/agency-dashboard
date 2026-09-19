import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// v4.57.0 — Login-Konto sperren/entsperren, passend zum Status in user_roles.
//
// Warum: `suspended`/`offboarded` in user_roles sperrt seit RLS-Stufe 4 zwar
// sämtliche Daten, das Supabase-Konto selbst bleibt aber gültig — wer den Tab
// offen hat, behält seine Sitzung, und ein Login ist weiter möglich (er sieht
// dann nur „Zugang gesperrt"). Mit dem Ban lehnt Supabase Anmeldung und
// Token-Erneuerung ab; eine laufende Sitzung endet spätestens mit Ablauf des
// Tokens (~1 h).
//
// Aktionen (nur Admin/Manager):
//   { action: 'sperren',   user_id }   → Ban (100 Jahre)
//   { action: 'entsperren', user_id }  → Ban aufheben
//   { action: 'abgleich' }             → alle suspended/offboarded sperren
//                                         (Altbestand; entsperrt NIEMANDEN)
//
// Deploy:  supabase functions deploy account-sperre --no-verify-jwt
// (prüft den Aufrufer selbst, wie password-reset)

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('DB_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('DB_SERVICE_KEY')!
const STAFF_ROLLEN = ['admin', 'manager']
const BAN = '876000h' // ~100 Jahre

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

const H = { 'Content-Type': 'application/json', 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
const rest = (pfad: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${pfad}`, { ...init, headers: { ...H, ...(init.headers || {}) } })
const authAdmin = (pfad: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/auth/v1/admin/${pfad}`, { ...init, headers: { ...H, ...(init.headers || {}) } })

async function aufrufer(token: string) {
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${token}` } })
  if (!u.ok) return null
  const caller = await u.json()
  if (!caller?.id) return null
  const r = await rest(`user_roles?user_id=eq.${caller.id}&select=role,roles,display_name,status`)
  const z = (await r.json())?.[0]
  const rollen: string[] = [...(z?.roles || []), z?.role].filter(Boolean)
  if (!rollen.some((x) => STAFF_ROLLEN.includes(x))) return null
  if (z?.status === 'suspended' || z?.status === 'offboarded') return null
  return { id: caller.id as string, name: (z?.display_name || caller.email || 'Admin') as string }
}

async function setzeBan(userId: string, dauer: string) {
  const r = await authAdmin(`users/${userId}`, { method: 'PUT', body: JSON.stringify({ ban_duration: dauer }) })
  return r.ok ? null : ((await r.json().catch(() => ({})))?.msg || `HTTP ${r.status}`)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)
  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
    const admin = token ? await aufrufer(token) : null
    if (!admin) return json({ ok: false, error: 'Keine Berechtigung' }, 403)

    const body = await req.json().catch(() => ({}))
    const aktion = String(body.action || '')

    if (aktion === 'sperren' || aktion === 'entsperren') {
      const userId = String(body.user_id || '')
      if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ ok: false, error: 'user_id fehlt' }, 400)
      if (userId === admin.id && aktion === 'sperren') return json({ ok: false, error: 'Eigenes Konto kann nicht gesperrt werden' }, 400)
      // Status muss zur Aktion passen — sonst ließe sich ein aktiver Account
      // an der Oberfläche vorbei aussperren.
      const r = await rest(`user_roles?user_id=eq.${userId}&select=status,display_name`)
      const z = (await r.json())?.[0]
      if (!z) return json({ ok: false, error: 'Account nicht gefunden' }, 404)
      const gesperrt = z.status === 'suspended' || z.status === 'offboarded'
      if (aktion === 'sperren' && !gesperrt) return json({ ok: false, error: 'Account ist nicht stillgelegt/offboardet' }, 409)
      if (aktion === 'entsperren' && gesperrt) return json({ ok: false, error: 'Account ist noch stillgelegt/offboardet' }, 409)
      const fehler = await setzeBan(userId, aktion === 'sperren' ? BAN : 'none')
      if (fehler) return json({ ok: false, error: fehler }, 500)
      return json({ ok: true })
    }

    if (aktion === 'abgleich') {
      const r = await rest(`user_roles?status=in.(suspended,offboarded)&select=user_id,display_name`)
      const liste = await r.json()
      const ok: string[] = [], fehler: string[] = []
      for (const z of Array.isArray(liste) ? liste : []) {
        if (!z.user_id || z.user_id === admin.id) continue
        const f = await setzeBan(z.user_id, BAN)
        if (f) fehler.push(`${z.display_name}: ${f}`); else ok.push(z.display_name)
      }
      return json({ ok: fehler.length === 0, gesperrt: ok, fehler })
    }

    return json({ ok: false, error: 'Unbekannte Aktion' }, 400)
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500)
  }
})
