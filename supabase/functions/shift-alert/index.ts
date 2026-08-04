import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const CHRIS_TG = '1538601588'
const REY_TG = '528328429'

// v4.19.0: Ein offener shift_log gilt nur noch so lange als "eingecheckt".
// Grund: Auto-Checkout und das Aufräumen alter Logs laufen NUR im Chatter-Portal
// im Browser. Wer per Telegram /on eincheckt und nie /off schickt, hatte vorher
// einen für immer offenen Log — und wurde nie wieder alarmiert.
const CHECKIN_MAX_AGE_H = 16

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

// v4.19.0: Startzeit robust aus einem Zeit-String lesen.
// Verkraftet: "08:00-14:00", "08:00 - 12:00", "21:00-01.00" (Punkt statt
// Doppelpunkt), "20" (nur Stunde), " (DE)"-Anhängsel.
// Gibt Minuten seit Mitternacht zurück — oder null, wenn nichts Brauchbares
// drinsteht ("manuella", "Fernando", leer).
function parseStartMins(raw: unknown): number | null {
  if (!raw) return null
  const s = String(raw).replace(/\s*\(DE\)/gi, '').trim()
  if (!s) return null
  const start = s.split('-')[0].trim().replace(/\./g, ':')
  const m = start.match(/^(\d{1,2})(?::(\d{1,2}))?$/)
  if (!m) return null
  const h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  if (isNaN(h) || h > 23 || isNaN(min) || min > 59) return null
  return h * 60 + min
}

// v4.19.0: "Vorschichtschicht" war unschön.
function shiftLabel(shift: string): string {
  return shift === 'Vorschicht' ? 'Vorschicht' : `${shift}schicht`
}

function minsToClock(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
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

    // v4.19.0: maybeSingle statt single. Bei .single() warf PostgREST einen
    // Fehler, sobald es KEINE oder ZWEI Zeilen für die Woche gab — dann kam
    // die ganze Woche kein einziger Alarm, ohne dass es jemand merkte.
    const { data: schedData, error: schedErr } = await supabase
      .from('schedule')
      .select('*')
      .eq('week_start', weekStartIso)
      .eq('status', 'live')
      .maybeSingle()

    if (schedErr) {
      console.error('shift-alert: schedule-Abfrage fehlgeschlagen', schedErr.message)
      return new Response(JSON.stringify({ error: 'schedule query failed', detail: schedErr.message }), { status: 200 })
    }
    if (!schedData) {
      console.log(`shift-alert: kein live-Dienstplan für ${weekStartIso}`)
      return new Response(JSON.stringify({ message: 'No live schedule found', week_start: weekStartIso }), { status: 200 })
    }

    // Online-Map case-insensitive aufbauen
    const { data: onlineData } = await supabase.from('online_status').select('*')
    const shiftOnlineMap: Record<string, boolean> = {}
    const cutoff = new Date(Date.now() - 5 * 60 * 1000)
    for (const s of onlineData || []) {
      if (s.display_name?.startsWith('ALERTED_')) continue
      if (!s.display_name) continue
      if (s.shift_online && s.last_seen && new Date(s.last_seen) > cutoff) {
        // KEY: lowercase damit Mario/mario gleich behandelt werden
        shiftOnlineMap[s.display_name.toLowerCase().trim()] = true
      }
    }

    const { data: alertedData } = await supabase
      .from('online_status')
      .select('display_name')
      .like('display_name', `ALERTED_${todayIso}_%`)
    const alreadyAlerted = new Set((alertedData || []).map((a: any) =>
      a.display_name.replace(`ALERTED_${todayIso}_`, '')
    ))

    // v3.95.0: ECHTES Eincheck-Signal — ein offener shift_log bedeutet "eingecheckt",
    // auch wenn der Browser/das Handy zu ist und online_status längst veraltet.
    // v4.19.0: aber nur, wenn der Check-in nicht älter als CHECKIN_MAX_AGE_H ist.
    // Ältere offene Logs sind Karteileichen (kein /off, Portal nie geöffnet) und
    // hätten den Chatter sonst dauerhaft vom Alarm ausgenommen.
    const { data: openLogs } = await supabase
      .from('shift_logs')
      .select('display_name, checked_in_at')
      .is('checked_out_at', null)
    const staleCutoff = Date.now() - CHECKIN_MAX_AGE_H * 60 * 60 * 1000
    const checkedIn = new Set<string>()
    const staleLogs: string[] = []
    for (const l of openLogs || []) {
      const name = (l.display_name || '').toLowerCase().trim()
      if (!name) continue
      const t = l.checked_in_at ? new Date(l.checked_in_at).getTime() : 0
      if (t >= staleCutoff) checkedIn.add(name)
      else staleLogs.push(`${l.display_name} (seit ${l.checked_in_at})`)
    }

    // v4.20.0: Zellen von inaktiven oder gelöschten Models überspringen.
    // Der Dienstplan blendet offboardete Models aus (`ohneInaktive`), die
    // Einträge bleiben aber in der assignments-JSON stehen. Der Alarm las die
    // JSON roh und meldete Schichten, die im Dienstplan gar nicht sichtbar sind
    // (Vorfall 04.08.2026: Toni auf Model 13/Sophi, active=false).
    // Fail-open: Kann die Model-Liste nicht geladen werden, wird NICHT gefiltert —
    // lieber eine Meldung zu viel als eine ganze Nacht ohne Alarm.
    const { data: modelData, error: modelErr } = await supabase
      .from('models_contact').select('id, active')
    let activeModelIds: Set<string> | null = null
    if (modelErr || !modelData || modelData.length === 0) {
      console.error('shift-alert: models_contact nicht ladbar — Filter aus', modelErr?.message || 'leer')
    } else {
      activeModelIds = new Set(
        modelData.filter((m: any) => m.active !== false).map((m: any) => String(m.id))
      )
    }

    // v3.95.0: abgemeldete (abwesende) Chatter nicht alarmieren
    const { data: absData } = await supabase.from('absences').select('*')
    const isAbsent = (name: string, iso: string, sh: string) =>
      (absData || []).some((a: any) => {
        if ((a.chatter_name || '').toLowerCase().trim() !== name.toLowerCase().trim()) return false
        if (iso < a.date_from || iso > a.date_to) return false
        const avail = a.available_shifts
        if (!avail || avail.length === 0) return true
        return !avail.includes(sh)
      })

    const assignments = schedData.assignments || {}
    const shiftTimes = schedData.shift_times || {}
    const alerted: string[] = []
    const skippedAlreadyOnline: string[] = []
    const skippedNoTime: string[] = []   // v4.19.0: sichtbar machen statt still schlucken
    const skippedInactiveModel: string[] = []  // v4.20.0

    for (const [key, val] of Object.entries(assignments) as [string, any][]) {
      const parts = key.split('__')
      if (parts.length < 3) continue
      const dayIso = parts[1]
      const shift = parts[2]
      const chatterName = val?.chatter

      // v3.89.0: Freischicht (__FREI__) ist keine echte Schicht -> kein Alert
      if (dayIso !== todayIso || !chatterName || chatterName === '__FREI__') continue
      // v3.95.0: abwesende Chatter nicht alarmieren
      if (isAbsent(chatterName, dayIso, shift)) continue

      const alertKey = `${chatterName}_${shift}`
      if (alreadyAlerted.has(alertKey)) continue

      const modelId = parts[0]

      // v4.20.0: inaktives/gelöschtes Model -> die Schicht ist im Dienstplan
      // unsichtbar, also auch kein Alarm.
      if (activeModelIds && !activeModelIds.has(modelId)) {
        skippedInactiveModel.push(`${alertKey} (Model ${modelId} inaktiv)`)
        continue
      }

      // v4.19.0: Zell-Override hat Vorrang vor der Standardzeit — genau wie im
      // Chatter-Portal und im Dienstplan. Vorher wurde NUR die Standardzeit
      // gelesen. Folge: Vorschichten (für die es gar keine Standardzeit gibt)
      // lösten nie einen Alarm aus, und Nacht-/Spätschichten mit abweichender
      // Startzeit feuerten bis zu zwei Stunden zu früh.
      const shiftStartMins =
        parseStartMins(val?.time_override) ??
        parseStartMins(shiftTimes[`${modelId}__${shift}`])

      if (shiftStartMins == null) {
        skippedNoTime.push(`${alertKey} (Model ${modelId}: keine verwertbare Zeit)`)
        continue
      }

      const nowMins = currentHour * 60 + currentMin

      if (nowMins >= shiftStartMins + 15 && nowMins <= shiftStartMins + 25) {
        const chatterKey = chatterName.toLowerCase().trim()
        // per Dashboard/Telegram eingecheckt (frischer offener shift_log) -> kein Alert,
        // egal ob online_status noch aktuell ist
        if (checkedIn.has(chatterKey)) { skippedAlreadyOnline.push(alertKey); continue }
        if (shiftOnlineMap[chatterKey]) {
          skippedAlreadyOnline.push(alertKey)
          continue
        }

        // Marker zuerst
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
        const startTime = minsToClock(shiftStartMins)
        const msg = `⚠️ <b>${chatterName}</b> hat ${shiftLabel(shift)} aber ist noch nicht eingecheckt!\n\nSchichtbeginn: ${startTime} Uhr (DE-Zeit)`
        await sendTelegram(CHRIS_TG, msg)
        await sendTelegram(REY_TG, msg)
      }
    }

    // v4.19.0: Karteileichen einmal täglich melden — sonst merkt es niemand.
    // Fenster 09:00–09:05 Berlin, damit es genau einen Lauf trifft.
    if (staleLogs.length > 0 && currentHour === 9 && currentMin < 5) {
      const msg = `🧹 <b>Hängende Check-ins</b> (älter als ${CHECKIN_MAX_AGE_H}h, gelten nicht mehr als eingecheckt):\n\n${staleLogs.map(s => `● ${s}`).join('\n')}`
      await sendTelegram(CHRIS_TG, msg)
      await sendTelegram(REY_TG, msg)
    }

    if (skippedNoTime.length > 0) console.log('shift-alert: ohne Zeit übersprungen', skippedNoTime)

    return new Response(JSON.stringify({
      ok: true,
      checked: todayIso,
      week_start: weekStartIso,
      alerted,
      skipped_already_online: skippedAlreadyOnline,
      skipped_no_time: skippedNoTime,
      skipped_inactive_model: skippedInactiveModel,
      stale_logs_ignored: staleLogs,
    }), { status: 200 })
  } catch (err) {
    console.error('shift-alert error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
