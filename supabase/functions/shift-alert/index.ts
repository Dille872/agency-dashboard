import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BOT_TOKEN = '8396910457:AAEeZdCISpbNDfS00uy-EI-SBy1MsY0ztZ8'
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

    // Get Berlin time
    const now = new Date()
    const berlinStr = now.toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' })
    const berlinDate = new Date(berlinStr)
    const currentHour = berlinDate.getHours()
    const currentMin = berlinDate.getMinutes()
    const todayIso = berlinStr.slice(0, 10)
    const weekStartIso = getWeekStart(berlinDate)

    // Load schedule - only if LIVE
    const { data: schedData } = await supabase
      .from('schedule')
      .select('*')
      .eq('week_start', weekStartIso)
      .eq('status', 'live')
      .single()

    if (!schedData) {
      return new Response(JSON.stringify({ message: 'No live schedule found' }), { status: 200 })
    }

    // Load online statuses - chatter is online if shift_online and last_seen < 2 min ago
    const { data: onlineData } = await supabase.from('online_status').select('*')
    const shiftOnlineMap: Record<string, boolean> = {}
    const cutoff = new Date(Date.now() - 120000)
    for (const s of onlineData || []) {
      if (new Date(s.last_seen) > cutoff && s.shift_online) {
        shiftOnlineMap[s.display_name] = true
      }
    }

    // Load already alerted today
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

    for (const [key, val] of Object.entries(assignments) as [string, any][]) {
      const parts = key.split('__')
      if (parts.length < 3) continue
      const dayIso = parts[1]
      const shift = parts[2]
      const chatterName = val?.chatter

      if (dayIso !== todayIso || !chatterName) continue

      const alertKey = `${chatterName}_${shift}`
      if (alreadyAlerted.has(alertKey)) continue

      // Get shift start time
      const modelId = parts[0]
      const timeStr = (shiftTimes[`${modelId}__${shift}`] || '').replace(/\s*\(DE\)/g, '').trim()
      if (!timeStr) continue

      const startTime = timeStr.split('-')[0].trim()
      const timeParts = startTime.split(':').map(Number)
      if (timeParts.length < 2 || isNaN(timeParts[0])) continue

      const shiftStartMins = timeParts[0] * 60 + timeParts[1]
      const nowMins = currentHour * 60 + currentMin

      // Alert between 15-25 minutes after shift start
      if (nowMins >= shiftStartMins + 15 && nowMins <= shiftStartMins + 25) {
        if (!shiftOnlineMap[chatterName]) {
          alerted.push(alertKey)
          const msg = `⚠️ <b>${chatterName}</b> hat ${shift}schicht aber ist noch nicht eingecheckt!\n\nSchichtbeginn: ${startTime} Uhr (DE-Zeit)`
          await sendTelegram(CHRIS_TG, msg)
          await sendTelegram(REY_TG, msg)

          // Mark as alerted
          await supabase.from('online_status').upsert({
            display_name: `ALERTED_${todayIso}_${alertKey}`,
            last_seen: new Date().toISOString(),
            shift_online: false,
          }, { onConflict: 'display_name' })
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, checked: todayIso, alerted }), { status: 200 })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
