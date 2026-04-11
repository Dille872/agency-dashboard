import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BOT_TOKEN = '8396910457:AAEeZdCISpbNDfS00uy-EI-SBy1MsY0ztZ8'

async function sendTelegram(chatId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}

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
      const msg = `🔔 <b>Schicht-Erinnerung!</b>\n\nDu hast ${reminder.shift}schicht bei <b>${reminder.model_name}</b>.\n📅 ${dayFormatted}\n⏰ ${reminder.shift_start_time} Uhr (DE-Zeit)\n\n– Thirteen 87`
      await sendTelegram(reminder.chatter_telegram_id, msg)
      await supabase.from('reminders').update({ sent: true }).eq('id', reminder.id)
    }

    // 2. Model calendar reminders
    const { data: calItems } = await supabase
      .from('model_calendar').select('*, models_contact!inner(telegram_id)')
      .eq('reminder_sent', false)
      .not('reminder_hours', 'is', null)

    for (const item of calItems || []) {
      if (!item.reminder_hours) continue
      const dueDate = new Date(item.due_date + 'T09:00:00') // assume 9am due
      const sendAt = new Date(dueDate.getTime() - item.reminder_hours * 3600000)
      if (now >= sendAt) {
        const tgId = item.models_contact?.telegram_id
        if (!tgId) continue
        const dueDateStr = new Date(item.due_date + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' })
        const msg = `🔔 <b>Erinnerung!</b>\n\n${item.title}\n📅 Fällig: ${dueDateStr}${item.description ? `\n${item.description}` : ''}\n\n– Thirteen 87`
        await sendTelegram(tgId, msg)
        await supabase.from('model_calendar').update({ reminder_sent: true }).eq('id', item.id)
      }
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
