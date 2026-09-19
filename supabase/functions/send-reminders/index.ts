import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!

// v4.57.0: liefert zurück, ob Telegram die Nachricht angenommen hat.
async function sendTelegram(chatId: string, text: string): Promise<boolean> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    })
    const j = await r.json().catch(() => ({}))
    if (!j?.ok) console.error('Telegram abgelehnt:', chatId, j?.description)
    return j?.ok === true
  } catch (e) {
    console.error('Telegram nicht erreichbar:', e)
    return false
  }
}

const esc = (t: unknown) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// v4.57.0: 09:00 BERLINER Zeit am Tag `tag` als echter Zeitpunkt.
// Vorher `new Date(tag + 'T09:00:00')` — die Function läuft in UTC, das war
// 10 bzw. 11 Uhr in Berlin.
function berlinNeunUhr(tag: string): Date {
  const mittag = new Date(`${tag}T12:00:00Z`)
  const stunde = parseInt(mittag.toLocaleString('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }))
  const offset = stunde - 12 // 1 (Winter) oder 2 (Sommer)
  return new Date(`${tag}T${String(9 - offset).padStart(2, '0')}:00:00Z`)
}

// Nach so langer Zeit ohne erfolgreichen Versand wird aufgegeben — sonst
// versucht jeder Cron-Lauf es für immer (blockierter Bot, falsche ID).
const AUFGEBEN_NACH_MS = 24 * 3600 * 1000

serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const now = new Date()

    // 1. Chatter shift reminders
    const { data: reminders } = await supabase
      .from('reminders').select('*').eq('sent', false).lte('send_at', now.toISOString())

    for (const reminder of reminders || []) {
      const shiftDate = new Date(reminder.shift_date + 'T00:00:00Z')
      const day = shiftDate.getUTCDay()
      const diff = day === 0 ? -6 : 1 - day
      const weekStart = new Date(shiftDate)
      weekStart.setUTCDate(shiftDate.getUTCDate() + diff)
      const weekStartIso = weekStart.toISOString().slice(0, 10)
      const { data: schedData } = await supabase.from('schedule').select('status').eq('week_start', weekStartIso).single()
      if (schedData && schedData.status !== 'live') continue
      const dayFormatted = new Date(reminder.shift_date + 'T12:00:00Z').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' })
      const msg = `🔔 <b>Schicht-Erinnerung!</b>\n\nDu hast ${esc(reminder.shift)}schicht bei <b>${esc(reminder.model_name)}</b>.\n📅 ${dayFormatted}\n⏰ ${reminder.shift_start_time} Uhr (DE-Zeit)\n\n– Thirteen 87`
      const ok = await sendTelegram(reminder.chatter_telegram_id, msg)
      // v4.57.0: nur bei Erfolg als gesendet markieren (sonst nächster Lauf
      // nochmal) — nach 24 h ohne Erfolg aufgeben.
      const zuAlt = now.getTime() - new Date(reminder.send_at).getTime() > AUFGEBEN_NACH_MS
      if (ok || zuAlt) await supabase.from('reminders').update({ sent: true }).eq('id', reminder.id)
    }

    // 2. Model calendar reminders
    const { data: calItems } = await supabase
      .from('model_calendar').select('*, models_contact!inner(telegram_id)')
      .eq('reminder_sent', false)
      .not('reminder_hours', 'is', null)

    for (const item of calItems || []) {
      if (!item.reminder_hours) continue
      const dueDate = berlinNeunUhr(item.due_date) // v4.57.0: 09:00 Berlin, nicht UTC
      const sendAt = new Date(dueDate.getTime() - item.reminder_hours * 3600000)
      if (now >= sendAt) {
        const tgId = item.models_contact?.telegram_id
        if (!tgId) continue
        const dueDateStr = new Date(item.due_date + 'T12:00:00Z').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' })
        const msg = `🔔 <b>Erinnerung!</b>\n\n${esc(item.title)}\n📅 Fällig: ${dueDateStr}${item.description ? `\n${esc(item.description)}` : ''}\n\n– Thirteen 87`
        const ok = await sendTelegram(tgId, msg)
        const zuAlt = now.getTime() - sendAt.getTime() > AUFGEBEN_NACH_MS
        if (ok || zuAlt) await supabase.from('model_calendar').update({ reminder_sent: true }).eq('id', item.id)
      }
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
