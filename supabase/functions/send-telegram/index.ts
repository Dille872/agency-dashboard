// supabase/functions/send-telegram/index.ts
// v3.46.0: Auth-Gate ergänzt.
// Der Bot-Token liegt weiterhin ausschließlich im Secret TELEGRAM_BOT_TOKEN
// und wird nie an den Browser ausgeliefert.
// NEU: Es dürfen nur noch EINGELOGGTE Dashboard-User senden. Ein Aufruf mit
// nur dem öffentlichen Key (ohne echtes Login) wird abgewiesen. Es gibt bewusst
// KEINE Rollen-Beschränkung — Chatter, Models, Admins usw. funktionieren alle
// unverändert weiter.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
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
  } catch (_e) {
    return json({ ok: false, description: 'Auth-Prüfung fehlgeschlagen' }, 401)
  }
  // --- ab hier: Aufrufer ist ein eingeloggter Dashboard-User ---

  try {
    const payload = await req.json()
    const { action } = payload ?? {}

    switch (action) {
      case 'sendMessage': {
        const { chatId, text } = payload
        if (!chatId || !text) return json({ ok: false, description: 'chatId/text fehlt' }, 400)
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
