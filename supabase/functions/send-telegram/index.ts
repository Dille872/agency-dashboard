// supabase/functions/send-telegram/index.ts
// v3.46.0: Auth-Gate ergänzt.
// Der Bot-Token liegt weiterhin ausschließlich im Secret TELEGRAM_BOT_TOKEN
// und wird nie an den Browser ausgeliefert.
// NEU: Es dürfen nur noch EINGELOGGTE Dashboard-User senden. Ein Aufruf mit
// nur dem öffentlichen Key (ohne echtes Login) wird abgewiesen. Es gibt bewusst
// KEINE Rollen-Beschränkung — Chatter, Models, Admins usw. funktionieren alle
// unverändert weiter.
//
// v5.42.0: Admin/Manager brauchen eine Anmeldung mit Zwei-Faktor (aal2).
// v5.41.0 (Sicherheit): Rollen-Prüfung serverseitig.
//   • stillgelegte/offboardete Accounts dürfen gar nichts
//   • Team (admin, manager, dienstplan, creator_manager): wie bisher an alle
//   • alle anderen (Chatter, Models, Social, Storyteller …): nur an Telegram-IDs,
//     die im Dashboard hinterlegt sind (Models, Chatter, Team-Kontakte, Admins)
//     — nicht mehr an beliebige fremde IDs
//   • getUpdates (eingehende Bot-Nachrichten lesen): nur admin/manager
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { zweiFaktorOk } from '../_shared/zweiFaktor.ts' // v5.42.0

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
// Admin-Telegram-IDs (wie in src/telegram.js) — dürfen immer angeschrieben werden
const ADMIN_IDS = (Deno.env.get('ADMIN_CHAT_IDS') || '1538601588,528328429').split(',').map((x) => x.trim()).filter(Boolean)
const TEAM_ROLLEN = ['admin', 'manager', 'dienstplan', 'creator_manager']
const LESEN_ROLLEN = ['admin', 'manager']

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
async function rest(pfad: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pfad}`, { headers: H })
  return r.ok ? await r.json() : []
}
// Alle im Dashboard hinterlegten Telegram-IDs (Models, Chatter, Team)
async function bekannteIds(): Promise<Set<string>> {
  const [m, c, u] = await Promise.all([
    rest('models_contact?select=telegram_id&telegram_id=not.is.null'),
    rest('chatters_contact?select=telegram_id&telegram_id=not.is.null'),
    rest('user_roles?select=kontakt_telegram&kontakt_telegram=not.is.null'),
  ])
  const ids = new Set<string>(ADMIN_IDS)
  for (const x of m) if (x.telegram_id) ids.add(String(x.telegram_id).trim())
  for (const x of c) if (x.telegram_id) ids.add(String(x.telegram_id).trim())
  for (const x of u) if (x.kontakt_telegram) ids.add(String(x.kontakt_telegram).trim())
  return ids
}
const API = `https://api.telegram.org/bot${BOT_TOKEN}`

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  // CORS-Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // --- Auth-Gate: nur echte, eingeloggte User dürfen senden ---
  // Ein Außenstehender hat höchstens den öffentlichen Key, aber kein Login-Token.
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  let userId = ''
  if (!token) {
    return json({ ok: false, description: 'Nicht eingeloggt' }, 401)
  }
  try {
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await authClient.auth.getUser(token)
    if (error || !data?.user) {
      // Kein gültiges User-Login (z.B. nur der öffentliche Key) -> abweisen
      return json({ ok: false, description: 'Nicht autorisiert' }, 401)
    }
    userId = data.user.id
  } catch (_e) {
    return json({ ok: false, description: 'Auth-Prüfung fehlgeschlagen' }, 401)
  }

  // v5.41.0: Rolle + Status des Aufrufers
  let rollen: string[] = []
  if (SERVICE_KEY) {
    const z = (await rest(`user_roles?user_id=eq.${userId}&select=role,roles,status`))?.[0]
    if (!z) return json({ ok: false, description: 'Kein Dashboard-Zugang' }, 403)
    if (z.status === 'suspended' || z.status === 'offboarded') return json({ ok: false, description: 'Zugang gesperrt' }, 403)
    rollen = [...(z.roles || []), z.role].filter(Boolean)
  } else {
    rollen = TEAM_ROLLEN // ohne Service-Key (sollte es nicht geben) wie bisher verhalten
  }
  // v5.42.0: Admin/Manager nur mit Code aus der Authenticator-App
  if (SERVICE_KEY && !zweiFaktorOk(rollen, token)) return json({ ok: false, description: 'Zwei-Faktor fehlt – bitte neu anmelden' }, 403)
  const istTeam = rollen.some((r) => TEAM_ROLLEN.includes(r))
  const darfLesen = rollen.some((r) => LESEN_ROLLEN.includes(r))
  let erlaubt: Set<string> | null = null
  const empfaengerOk = async (chatId: unknown) => {
    if (istTeam) return true
    if (!erlaubt) erlaubt = await bekannteIds()
    return erlaubt.has(String(chatId).trim())
  }
  const abgelehnt = () => json({ ok: false, description: 'Empfänger nicht erlaubt (nur im Dashboard hinterlegte Telegram-IDs)' }, 403)
  // --- ab hier: Aufrufer ist ein eingeloggter Dashboard-User ---

  try {
    const payload = await req.json()
    const { action } = payload ?? {}

    switch (action) {
      case 'sendMessage': {
        const { chatId, text } = payload
        if (!chatId || !text) return json({ ok: false, description: 'chatId/text fehlt' }, 400)
        if (!(await empfaengerOk(chatId))) return abgelehnt()
        const res = await fetch(`${API}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        })
        return json(await res.json(), res.status)
      }

      case 'sendPhoto': {
        const { chatId, photoUrl, caption } = payload
        if (!chatId || !photoUrl) return json({ ok: false, description: 'chatId/photoUrl fehlt' }, 400)
        if (!(await empfaengerOk(chatId))) return abgelehnt()
        const body: Record<string, unknown> = { chat_id: chatId, photo: photoUrl, parse_mode: 'HTML' }
        if (caption) body.caption = caption
        const res = await fetch(`${API}/sendPhoto`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        return json(await res.json(), res.status)
      }

      case 'sendMediaGroup': {
        const { chatId, photoUrls, caption } = payload
        if (!chatId || !photoUrls || photoUrls.length === 0)
          return json({ ok: false, description: 'chatId/photoUrls fehlt' }, 400)
        if (!(await empfaengerOk(chatId))) return abgelehnt()

        // Ein einzelnes Bild -> sendPhoto (Telegram erlaubt keine 1er-MediaGroup)
        if (photoUrls.length === 1) {
          const body: Record<string, unknown> = { chat_id: chatId, photo: photoUrls[0], parse_mode: 'HTML' }
          if (caption) body.caption = caption
          const res = await fetch(`${API}/sendPhoto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          return json(await res.json(), res.status)
        }

        // Caption nur am ersten Bild — Telegram-Konvention
        const media = photoUrls.slice(0, 10).map((url: string, idx: number) => {
          const item: Record<string, unknown> = { type: 'photo', media: url }
          if (idx === 0 && caption) {
            item.caption = caption
            item.parse_mode = 'HTML'
          }
          return item
        })
        const res = await fetch(`${API}/sendMediaGroup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, media }),
        })
        return json(await res.json(), res.status)
      }

      case 'getUpdates': {
        if (!darfLesen) return json({ ok: false, description: 'Nur für Admins' }, 403)
        const offset = payload.offset ?? 0
        const res = await fetch(`${API}/getUpdates?offset=${offset}&timeout=5`)
        return json(await res.json(), res.status)
      }

      default:
        return json({ ok: false, description: `Unbekannte action: ${action}` }, 400)
    }
  } catch (err) {
    return json({ ok: false, description: `send-telegram Fehler: ${err}` }, 500)
  }
})
