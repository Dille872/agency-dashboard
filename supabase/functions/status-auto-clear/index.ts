import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const SUPABASE_URL = Deno.env.get('DB_URL') || Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('DB_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const ADMIN_IDS = ['1538601588', '528328429']

const H = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'Accept-Profile': 'public',
  'Content-Profile': 'public',
}

async function tg(chatId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}

serve(async () => {
  try {
    // Hole alle Models mit status_until in der Vergangenheit und Status pause/unavailable
    const nowIso = new Date().toISOString()
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/models_contact?select=*&status_until=lt.${nowIso}&status=in.(pause,unavailable)`,
      { headers: H }
    )
    const expired = await r.json()

    if (!Array.isArray(expired) || expired.length === 0) {
      return new Response(JSON.stringify({ ok: true, cleared: 0 }), { status: 200 })
    }

    const cleared: string[] = []
    for (const m of expired) {
      // Auto auf available setzen
      await fetch(`${SUPABASE_URL}/rest/v1/models_contact?id=eq.${m.id}`, {
        method: 'PATCH',
        headers: { ...H, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          status: 'available',
          status_until: null,
          status_note: null,
          availability: 'available',
        }),
      })

      // Eintrag in messages für Dashboard-Inbox
      await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
        method: 'POST',
        headers: { ...H, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          model_name: m.name,
          model_telegram_id: m.telegram_id,
          direction: 'in',
          contact_type: 'model',
          text: `[STATUS_AVAILABLE_AUTO]`,
          status: 'received',
          read: false,
        }),
      })

      cleared.push(m.name)
    }

    // Optional: Admin-Notify wenn was gecleared wurde
    if (cleared.length > 0) {
      for (const adminId of ADMIN_IDS) {
        await tg(adminId, `🔄 Auto-Clear: ${cleared.length} Model${cleared.length > 1 ? 's' : ''} zurück auf "Verfügbar"\n\n${cleared.map(n => `● ${n}`).join('\n')}`)
      }
    }

    return new Response(JSON.stringify({ ok: true, cleared, count: cleared.length }), { status: 200 })
  } catch (err) {
    console.error('status-auto-clear error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
