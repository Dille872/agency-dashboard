import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const CHRIS_TG = '1538601588'
const REY_TG = '528328429'

async function sendTelegram(chatId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}

function getWeekStart(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    const now = new Date()
    const berlinStr = now.toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' })
    const berlinDate = new Date(berlinStr)
    const currentHour = berlinDate.getHours()
    const currentMin = berlinDate.getMinutes()
    const todayIso = berlinStr.slice(0, 10)
    const weekStartIso = getWeekStart(berlinDate)

    const { data: schedData } = await supabase
      .from('schedule')
      .select('*')
      .eq('week_start', weekStartIso)
      .eq('status', 'live')
      .single()

    if (!schedData) {
      return new Response(JSON.stringify({ message: 'No live schedule found' }), { status: 200 })
    }

    // 5 Min Cutoff statt 2 Min - Frontend pingt nicht jede Minute
    const { data: onlineData } = await supabase.from('online_status').select('*')
    const shiftOnlineMap: Record<string, boolean> = {}
    const cutoff = new Date(Date.now() - 5 * 60 * 1000)
    for (const s of onlineData || []) {
      if (s.display_name?.startsWith('ALERTED_')) continue
      if (s.shift_online && s.last_seen && new Date(s.last_seen) > cutoff) {
        shiftOnlineMap[s.display_name] = true
      }
    }

    const { data: alertedData } = await supabase
      .from('online_status')
      .select('display_name')
      .like('display_name', `ALERTED_${todayIso}_%`)
    const alreadyAlerted = new Set((alertedData || []).map((a: any) =>
      a.display_name.replace(`ALERTED_${todayIso}_`, '')
    ))

    const assignments = schedData.assignments || {}
    const shiftTimes = schedData.shift_times || {}
    const alerted: string[] = []
    const skippedAlreadyOnline: string[] = []

    for (const [key, val] of Object.entries(assignments) as [string, any][]) {
      const parts = key.split('__')
      if (parts.length < 3) continue
      const dayIso = parts[1]
      const shift = parts[2]
      const chatterName = val?.chatter

      if (dayIso !== todayIso || !chatterName) continue

      const alertKey = `${chatterName}_${shift}`
      if (alreadyAlerted.has(alertKey)) continue

      const modelId = parts[0]
      const timeStr = (shiftTimes[`${modelId}__${shift}`] || '').replace(/\s*\(DE\)/g, '').trim()
      if (!timeStr) continue

      const startTime = timeStr.split('-')[0].trim()
      const timeParts = startTime.split(':').map(Number)
      if (timeParts.length < 2 || isNaN(timeParts[0])) continue

      const shiftStartMins = timeParts[0] * 60 + timeParts[1]
      const nowMins = currentHour * 60 + currentMin

      if (nowMins >= shiftStartMins + 15 && nowMins <= shiftStartMins + 25) {
        // FIX 1: Online check FIRST
        if (shiftOnlineMap[chatterName]) {
          skippedAlreadyOnline.push(alertKey)
          continue
        }

        // FIX 2: Insert marker FIRST (insert, not upsert!) - bei concurrent run failed der zweite
        const markerKey = `ALERTED_${todayIso}_${alertKey}`
        const { error: markerErr } = await supabase
          .from('online_status')
          .insert({
            display_name: markerKey,
            last_seen: new Date().toISOString(),
            shift_online: false,
          })

        if (markerErr) {
          console.log(`Skipping ${alertKey}: marker exists`, markerErr.message)
          continue
        }

        alerted.push(alertKey)
        const msg = `⚠️ <b>${chatterName}</b> hat ${shift}schicht aber ist noch nicht eingecheckt!\n\nSchichtbeginn: ${startTime} Uhr (DE-Zeit)`
        await sendTelegram(CHRIS_TG, msg)
        await sendTelegram(REY_TG, msg)
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      checked: todayIso,
      alerted,
      skipped_already_online: skippedAlreadyOnline,
    }), { status: 200 })
  } catch (err) {
    console.error('shift-alert error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
