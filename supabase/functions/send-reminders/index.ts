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

    // 3. v4.61.0: Team-Kalender — Erinnerung X Minuten vor Beginn
    //    Empfänger: namentlich eingetragene Personen, bei „Ganzes Team" alle
    //    aktiven Chatter + das Team. Uhrzeit in der Zeit des Empfängers, wenn
    //    das Portal sie kennt (online_status.zeitzone), sonst deutsche Zeit.
    const ADMIN_TG: Record<string, string> = { chris: '1538601588', rey: '528328429' }
    const { data: kal, error: kalErr } = await supabase.from('team_kalender').select('*')
      .eq('erinnerung_gesendet', false).not('erinnern_min', 'is', null)
      .gte('beginn', new Date(now.getTime() - 30 * 60000).toISOString())
      .lte('beginn', new Date(now.getTime() + 25 * 3600000).toISOString())
    if (kalErr) console.error('team_kalender:', kalErr.message)
    for (const e of kal || []) {
      const beginn = new Date(e.beginn)
      if (now.getTime() < beginn.getTime() - e.erinnern_min * 60000) continue
      let namen: string[] = e.fuer || []
      if (e.fuer_alle) {
        const { data: ch } = await supabase.from('chatters_contact').select('name, active')
        const { data: ur } = await supabase.from('user_roles').select('display_name, status')
        const gesperrt = new Set((ur || []).filter((u: any) => u.status === 'suspended' || u.status === 'offboarded').map((u: any) => String(u.display_name).toLowerCase()))
        namen = (ch || []).filter((c: any) => c.active !== false && !gesperrt.has(String(c.name).toLowerCase())).map((c: any) => c.name)
        namen.push('Chris', 'Rey')
      }
      const { data: kc } = await supabase.from('chatters_contact').select('name, telegram_id').in('name', namen)
      const { data: os } = await supabase.from('online_status').select('display_name, zeitzone').in('display_name', namen)
      const tg: Record<string, string> = {}
      for (const k of kc || []) if (k.telegram_id) tg[k.name] = k.telegram_id
      const zonen: Record<string, string> = {}
      for (const o of os || []) if (o.zeitzone) zonen[o.display_name] = o.zeitzone
      const art = ({ aufgabe: 'Aufgabe', event: 'Event', termin: 'Team-Termin', erinnerung: 'Erinnerung' } as Record<string, string>)[e.art] || 'Termin'
      const minuten = Math.max(0, Math.round((beginn.getTime() - now.getTime()) / 60000))
      for (const n of [...new Set(namen)]) {
        const id = tg[n] || ADMIN_TG[String(n).trim().toLowerCase()]
        if (!id) continue
        const zone = zonen[n] || 'Europe/Berlin'
        const uhr = beginn.toLocaleTimeString('de-DE', { timeZone: zone, hour: '2-digit', minute: '2-digit' })
        const de = beginn.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })
        const zusatz = zone === 'Europe/Berlin' ? ' (deutsche Zeit)' : ` (deine Zeit · DE ${de})`
        const bezug = e.folge_titel ? `\n↳ Folgeaufgabe zu: ${esc(e.folge_titel)}` : ''
        const msg = `⏰ <b>Gleich: ${esc(e.titel)}</b>\n\n${art} · ${minuten > 0 ? `in ${minuten} Min, ` : 'jetzt, '}${uhr} Uhr${zusatz}${bezug}${e.notiz ? `\n\n${esc(e.notiz)}` : ''}\n\n– Thirteen 87`
        await sendTelegram(id, msg)
      }
      // Einmal pro Eintrag — auch wenn einzelne Empfänger scheitern (sonst
      // bekämen die anderen die Erinnerung bei jedem Lauf erneut).
      await supabase.from('team_kalender').update({ erinnerung_gesendet: true }).eq('id', e.id)
    }

    // 4. v4.66.0: Nachhaken bei überfälligen Aufgaben (nur namentlich zugeteilte)
    //    - 2 Std nach Fälligkeit: einmal an die, die noch nicht abgehakt haben
    //    - 12 Std nach Fälligkeit: einmal an Chris + Rey
    //    Ältere Aufgaben (> 26 Std beim ersten Blick) werden NICHT mehr angeschrieben,
    //    damit beim ersten Deploy keine Flut alter Aufgaben rausgeht.
    const NACHHAKEN_MIN = 120, MELDEN_MIN = 720
    const norm = (x: unknown) => String(x ?? '').trim().toLowerCase()
    const { data: ueber, error: ueErr } = await supabase.from('team_kalender').select('*')
      .eq('art', 'aufgabe').eq('fuer_alle', false)
      .lte('beginn', new Date(now.getTime() - NACHHAKEN_MIN * 60000).toISOString())
      .gte('beginn', new Date(now.getTime() - 36 * 3600000).toISOString())
      .or('nachgehakt_am.is.null,eskaliert_am.is.null')
    if (ueErr) console.error('team_kalender nachhaken:', ueErr.message)
    for (const e of ueber || []) {
      const fertig = new Set((e.erledigt_von || []).map(norm))
      const offen: string[] = (e.fuer || []).filter((n: string) => !fertig.has(norm(n)))
      if (!offen.length) continue
      const beginn = new Date(e.beginn)
      const seitMin = (now.getTime() - beginn.getTime()) / 60000
      const bezug = e.folge_titel ? `\n↳ Folgeaufgabe zu: ${esc(e.folge_titel)}` : ''
      if (!e.nachgehakt_am) {
        if (seitMin > 26 * 60) continue
        const { data: kc } = await supabase.from('chatters_contact').select('name, telegram_id').in('name', offen)
        const { data: os } = await supabase.from('online_status').select('display_name, zeitzone').in('display_name', offen)
        const tg: Record<string, string> = {}
        for (const k of kc || []) if (k.telegram_id) tg[k.name] = k.telegram_id
        const zonen: Record<string, string> = {}
        for (const o of os || []) if (o.zeitzone) zonen[o.display_name] = o.zeitzone
        for (const n of offen) {
          const id = tg[n] || ADMIN_TG[norm(n)]
          if (!id) continue
          const zone = zonen[n] || 'Europe/Berlin'
          const uhr = beginn.toLocaleTimeString('de-DE', { timeZone: zone, hour: '2-digit', minute: '2-digit' })
          const zusatz = zone === 'Europe/Berlin' ? ' (deutsche Zeit)' : ' (deine Zeit)'
          const msg = `⏳ <b>Noch offen: ${esc(e.titel)}</b>\n\nFällig war ${uhr} Uhr${zusatz}.${bezug}\n\nWenn erledigt: im Portal unter „Heute → Mein Kalender“ abhaken. Klappt etwas nicht? Dort 💬 Rückmeldung schreiben.\n\n– Thirteen 87`
          await sendTelegram(id, msg)
        }
        await supabase.from('team_kalender').update({ nachgehakt_am: now.toISOString() }).eq('id', e.id)
      } else if (!e.eskaliert_am && seitMin >= MELDEN_MIN) {
        const std = Math.floor(seitMin / 60)
        const msg = `⚠️ <b>Seit ${std} Std offen: ${esc(e.titel)}</b>\n\nNoch nicht abgehakt: ${offen.map(esc).join(', ')}${bezug}\n\n– Thirteen 87`
        for (const id of Object.values(ADMIN_TG)) await sendTelegram(id, msg)
        await supabase.from('team_kalender').update({ eskaliert_am: now.toISOString() }).eq('id', e.id)
      }
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
