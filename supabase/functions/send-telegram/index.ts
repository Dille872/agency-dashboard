// supabase/functions/send-telegram/index.ts
// Proxy-Function: Frontend sendet Telegram-Nachrichten NUR noch hierüber.
// Der Bot-Token liegt ausschließlich als Supabase-Secret (TELEGRAM_BOT_TOKEN)
// und wird niemals an den Browser ausgeliefert.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
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
