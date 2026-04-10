import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BOT_TOKEN = '8396910457:AAEeZdCISpbNDfS00uy-EI-SBy1MsY0ztZ8'
const CHRIS_TG = '1538601588'
const REY_TG = '528328429'
const ADMIN_TZ = 'Europe/Berlin'
async function sendTelegram(chatId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }) })
}
function getWeekStart(date: Date): Date {
  const d = new Date(date); const day = d.getDay(); const diff = day === 0 ? -6 : 1 - day; d.setDate(d.getDate() + diff); d.setHours(0,0,0,0); return d
}
function isoDate(date: Date): string { return date.toISOString().slice(0, 10) }
serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const now = new Date()
    const berlinTime = new Date(now.toLocaleString('en-US', { timeZone: ADMIN_TZ }))
    const currentHour = berlinTime.getHours(); const currentMin = berlinTime.getMinutes()
    const todayIso = isoDate(now)
    const { data: schedData } = await supabase.from('schedule').select('*').eq('week_start', isoDate(getWeekStart(now))).single()
    if (!schedData) return new Response('no schedule', { status: 200 })
    const { data: onlineData } = await supabase.from('online_status').select('*')
    const onlineMap: Record<string, boolean> = {}
    const cutoff = new Date(Date.now() - 120000)
    for (const s of onlineData || []) { if (new Date(s.last_seen) > cutoff) onlineMap[s.display_name] = s.shift_online }
    const { data: alertedData } = await supabase.from('online_status').select('display_name').like('display_name', `ALERTED_${todayIso}_%`)
    const alreadyAlerted = new Set((alertedData || []).map((a: any) => a.display_name.replace(`ALERTED_${todayIso}_`, '')))
    const assignments = schedData.assignments || {}; const shiftTimes = schedData.shift_times || {}
    const alerted = new Set<string>()
    for (const [key, val] of Object.entries(assignments) as [string, any][]) {
      const parts = key.split('__')
      if (parts[1] !== todayIso || !val.chatter) continue
      const chatterName = val.chatter; const alertKey = `${chatterName}_${parts[2]}`
      if (alerted.has(alertKey) || alreadyAlerted.has(alertKey)) continue
      const timeStr = shiftTimes[`${parts[0]}__${parts[2]}`] || ''; if (!timeStr) continue
      const startTime = timeStr.split('-')[0].trim()
      const [shiftHour, shiftMin] = startTime.split(':').map(Number); if (isNaN(shiftHour)) continue
      const nowMins = currentHour * 60 + currentMin; const shiftStartMins = shiftHour * 60 + shiftMin
      if (nowMins >= shiftStartMins + 15 && nowMins < shiftStartMins + 20) {
        if (!onlineMap[chatterName]) {
          alerted.add(alertKey)
          const msg = `⚠️ <b>${chatterName}</b> hat ${parts[2]}schicht aber ist noch nicht online!\n\nSchichtbeginn: ${startTime} Uhr (DE-Zeit)`
          await sendTelegram(CHRIS_TG, msg); await sendTelegram(REY_TG, msg)
          await supabase.from('online_status').upsert({ display_name: `ALERTED_${todayIso}_${alertKey}`, last_seen: new Date().toISOString(), shift_online: false }, { onConflict: 'display_name' })
        }
      }
    }
    return new Response(JSON.stringify({ ok: true, alerted: [...alerted] }), { status: 200 })
  } catch (err) { return new Response(String(err), { status: 500 }) }
})
