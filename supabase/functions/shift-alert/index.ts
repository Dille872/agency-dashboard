import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─────────────────────────────────────────────────────────────────────────────
// shift-alert v4.21.0 — neu gedacht
//
// Die Regel in einem Satz:
//   Der Dienstplan sagt, wer arbeitet. Ein Check-in ist ein Ereignis mit
//   Zeitstempel. Fehlt das Ereignis, kommt eine Meldung.
//
// Was dafür WEGGEFALLEN ist (v4.20.1 und früher):
//
//   - `online_status` als Anwesenheits-Quelle. Bei Chattern wird `shift_online`
//     ohnehin ausschließlich durch den Portal-Check-in gesetzt (App.jsx nimmt
//     Chatter vom Heartbeat aus) — die Tabelle sagte also nichts, was
//     `shift_logs` nicht auch sagt, nur unzuverlässiger: nach 5 Minuten ohne
//     Heartbeat galt jemand wieder als abwesend.
//
//   - Die Frage, ob ein shift_log OFFEN ist. `checked_out_at` spielt keine
//     Rolle mehr. Damit ist das Karteileichen-Problem nicht entschärft, sondern
//     weg: Ein vergessener Check-out kann niemanden mehr stumm schalten, weil
//     ein Zeitstempel von gestern schlicht nicht in das Zeitfenster von heute
//     fällt. `CHECKIN_MAX_AGE_H` ist ersatzlos gestrichen.
//
//   - Der 10-Minuten-Schlitz. Gemeldet wird ab Start +10 bis Schichtende;
//     dass es trotzdem bei genau EINER Meldung bleibt, sichert der Marker.
//     Vorher konnte ein einzelner ausgefallener Cron-Lauf die Meldung
//     dauerhaft verschlucken.
//
//   - Marker als Pseudo-Zeilen in `online_status`. Sie liegen jetzt in
//     `alert_markers` (siehe sql/alert-markers.sql).
//
// Aufruf: pg_cron, alle 5 Minuten.
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const CHRIS_TG = '1538601588'
const REY_TG = '528328429'

// Ab wie vielen Minuten nach Schichtbeginn gemeldet wird.
const MELDUNG_AB_MIN = 10
// Wie lange vor Schichtbeginn ein Check-in schon für diese Schicht zählt.
// Nötig, damit die zweite Schicht am selben Tag nicht durch den Check-in der
// ersten stillgelegt wird — wer Früh UND Nacht hat, checkt zweimal ein.
const CHECKIN_VORLAUF_MIN = 60
// Fallback-Schichtlänge, wenn im Zeit-String kein Ende steht.
const FALLBACK_DAUER_MIN = 240

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

// Berliner Datum + Uhrzeit eines Zeitstempels, ohne Zeitzonen-Bibliothek.
// 'sv-SE' liefert "YYYY-MM-DD HH:MM:SS" — daraus lassen sich Tag und Minute
// direkt ablesen, egal in welcher Zeitzone die Funktion läuft.
function berlinParts(d: Date): { day: string; mins: number } {
  const s = d.toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' })
  const day = s.slice(0, 10)
  const h = Number(s.slice(11, 13))
  const m = Number(s.slice(14, 16))
  return { day, mins: h * 60 + m }
}

// Eine Uhrzeit aus einem Zeit-String lesen. Verkraftet: "08:00-14:00",
// "08:00 - 12:00", "21:00-01.00" (Punkt statt Doppelpunkt), "20" (nur Stunde),
// " (DE)"-Anhängsel. null = nichts Brauchbares ("manuella", "Fernando", leer).
function parseClock(raw: string | undefined | null): number | null {
  if (!raw) return null
  const t = raw.trim().replace(/\./g, ':')
  const m = t.match(/^(\d{1,2})(?::(\d{1,2}))?$/)
  if (!m) return null
  const h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  if (isNaN(h) || h > 23 || isNaN(min) || min > 59) return null
  return h * 60 + min
}

function parseSpanne(raw: unknown): { start: number; ende: number } | null {
  if (!raw) return null
  const s = String(raw).replace(/\s*\(DE\)/gi, '').trim()
  if (!s) return null
  const teile = s.split('-')
  const start = parseClock(teile[0])
  if (start == null) return null
  let ende = parseClock(teile[1])
  // Kein Ende oder Ende vor Beginn (Nachtschicht über Mitternacht):
  // Das Fenster endet spätestens um 23:59 — nach Mitternacht ist die Zelle
  // ohnehin die von gestern und fällt aus der Tagesprüfung.
  if (ende == null) ende = Math.min(start + FALLBACK_DAUER_MIN, 1439)
  if (ende <= start) ende = 1439
  return { start, ende }
}

function shiftLabel(shift: string): string {
  return shift === 'Vorschicht' ? 'Vorschicht' : `${shift}schicht`
}

function minsToClock(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

const lc = (s: unknown) => String(s || '').trim().toLowerCase()

serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    const jetzt = berlinParts(new Date())
    const todayIso = jetzt.day
    const nowMins = jetzt.mins
    const weekStartIso = getWeekStart(new Date(todayIso + 'T12:00:00Z'))

    // ── 1. Der Dienstplan. Ohne live geschalteten Plan gibt es keine Wahrheit,
    //       über die sich reden ließe.
    const { data: schedData, error: schedErr } = await supabase
      .from('schedule').select('assignments, shift_times')
      .eq('week_start', weekStartIso).eq('status', 'live').maybeSingle()

    if (schedErr) {
      console.error('shift-alert: schedule-Abfrage fehlgeschlagen', schedErr.message)
      return new Response(JSON.stringify({ error: 'schedule query failed', detail: schedErr.message }), { status: 200 })
    }
    if (!schedData) {
      console.log(`shift-alert: kein live-Dienstplan für ${weekStartIso}`)
      return new Response(JSON.stringify({ message: 'No live schedule found', week_start: weekStartIso }), { status: 200 })
    }

    // ── 2. Welche Models sind im Dienstplan überhaupt sichtbar?
    //       Zwei Gründe für unsichtbar, beide müssen greifen — sonst meldet der
    //       Alarm Schichten, die im Dienstplan niemand sehen und damit auch
    //       niemand korrigieren kann (Vorfall 04.08.2026: Toni auf Sophi):
    //         a) models_contact.active === false
    //         b) Name steht in user_roles mit status != 'active'
    //       Das ist exakt die Logik von `ohneInaktive` in src/people.js.
    //       Fail-open: Lässt sich die Liste nicht laden, wird NICHT gefiltert.
    const [{ data: modelData, error: modelErr }, { data: roleData }] = await Promise.all([
      supabase.from('models_contact').select('id, name, active'),
      supabase.from('user_roles').select('display_name, status'),
    ])
    const inaktiveNamen = new Set(
      (roleData || []).filter((u: any) => u.status && u.status !== 'active').map((u: any) => lc(u.display_name)).filter(Boolean),
    )
    let sichtbareModelIds: Set<string> | null = null
    if (modelErr || !modelData || modelData.length === 0) {
      console.error('shift-alert: models_contact nicht ladbar — Model-Filter aus', modelErr?.message || 'leer')
    } else {
      sichtbareModelIds = new Set(
        modelData
          .filter((m: any) => m.active !== false && !inaktiveNamen.has(lc(m.name)))
          .map((m: any) => String(m.id)),
      )
    }

    // ── 3. Die Check-ins von heute. Ein Zeitstempel, mehr nicht.
    //       `checked_out_at` interessiert bewusst nicht: Wer eingecheckt und den
    //       Check-out vergessen hat, HAT sich gemeldet — das war die Frage.
    const seit = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString()
    const { data: logData } = await supabase
      .from('shift_logs').select('display_name, checked_in_at')
      .gte('checked_in_at', seit)
    // name -> [Minute seit Berliner Mitternacht] (nur Check-ins von heute)
    const checkinsHeute: Record<string, number[]> = {}
    for (const l of logData || []) {
      if (!l.checked_in_at) continue
      const p = berlinParts(new Date(l.checked_in_at))
      if (p.day !== todayIso) continue
      const k = lc(l.display_name)
      if (!k) continue
      ;(checkinsHeute[k] ||= []).push(p.mins)
    }

    // ── 4. Wer heute abgemeldet ist, wird nicht alarmiert.
    const { data: absData } = await supabase.from('absences').select('*')
    const istAbwesend = (name: string, sh: string) =>
      (absData || []).some((a: any) => {
        if (lc(a.chatter_name) !== lc(name)) return false
        if (todayIso < a.date_from || todayIso > a.date_to) return false
        const avail = a.available_shifts
        if (!avail || avail.length === 0) return true
        return !avail.includes(sh)
      })

    // ── 5. Wofür heute schon gemeldet wurde.
    const { data: markerData } = await supabase
      .from('alert_markers').select('alert_key')
      .eq('alert_date', todayIso).eq('alert_type', 'no_show')
    const schonGemeldet = new Set((markerData || []).map((m: any) => m.alert_key))

    // ── 6. Durch den Plan gehen.
    const assignments = schedData.assignments || {}
    const shiftTimes = schedData.shift_times || {}

    const gemeldet: string[] = []
    const eingecheckt: string[] = []
    const ohneZeit: string[] = []
    const modelUnsichtbar: string[] = []

    for (const [key, val] of Object.entries(assignments) as [string, any][]) {
      const parts = key.split('__')
      if (parts.length < 3) continue
      const [modelId, dayIso, shift] = parts
      const chatter = val?.chatter

      if (dayIso !== todayIso || !chatter || chatter === '__FREI__') continue

      const alertKey = `${chatter}_${shift}`
      if (schonGemeldet.has(alertKey)) continue

      if (sichtbareModelIds && !sichtbareModelIds.has(modelId)) {
        modelUnsichtbar.push(`${alertKey} (Model ${modelId})`)
        continue
      }
      if (istAbwesend(chatter, shift)) continue

      // Zell-Override schlägt Standardzeit — wie im Portal und im Dienstplan.
      // Ohne diesen Vorrang wären Vorschichten unsichtbar (für sie gibt es gar
      // keine Standardzeit) und Nachtschichten würden zu früh gemeldet.
      const spanne = parseSpanne(val?.time_override) ?? parseSpanne(shiftTimes[`${modelId}__${shift}`])
      if (!spanne) { ohneZeit.push(`${alertKey} (Model ${modelId})`); continue }

      const faelligAb = spanne.start + MELDUNG_AB_MIN
      if (nowMins < faelligAb || nowMins > spanne.ende) continue

      // Hat er sich für DIESE Schicht gemeldet?
      const meine = checkinsHeute[lc(chatter)] || []
      if (meine.some(m => m >= spanne.start - CHECKIN_VORLAUF_MIN)) {
        eingecheckt.push(alertKey)
        continue
      }

      // Der Marker-Insert IST die Sperre — schlägt er fehl (Unique-Verletzung),
      // hat ein paralleler Lauf die Meldung schon verschickt.
      const { error: markerErr } = await supabase.from('alert_markers').insert({
        alert_key: alertKey, alert_date: todayIso, alert_type: 'no_show',
      })
      if (markerErr) { console.log(`shift-alert: ${alertKey} schon gemeldet`, markerErr.message); continue }

      gemeldet.push(alertKey)
      const verspaetung = nowMins - spanne.start
      const msg = `⚠️ <b>${chatter}</b> hat ${shiftLabel(shift)}, aber nicht eingecheckt.\n\n` +
        `Schichtbeginn: ${minsToClock(spanne.start)} Uhr (DE-Zeit) — seit ${verspaetung} Minuten überfällig.`
      await sendTelegram(CHRIS_TG, msg)
      await sendTelegram(REY_TG, msg)
    }

    // ── 7. Tages-Hausputz, einmal um 9 Uhr Berlin. Die Sperre ist wieder der
    //       Marker-Insert und nicht das Zeitfenster: Ein Minutenfenster hinge
    //       davon ab, auf welcher Minute der pg_cron-Job sitzt.
    let hausputz: Record<string, unknown> | null = null
    if (jetzt.mins >= 540 && jetzt.mins < 600) {
      const { error: hkErr } = await supabase.from('alert_markers').insert({
        alert_key: 'HAUSPUTZ', alert_date: todayIso, alert_type: 'housekeeping',
      })
      if (!hkErr) {
        // Hängende Check-ins melden. Für den Alarm sind sie egal geworden, für
        // Schicht-Statistik und Export sind sie es nicht.
        const grenze = new Date(Date.now() - 16 * 60 * 60 * 1000).toISOString()
        const { data: offen } = await supabase
          .from('shift_logs').select('display_name, shift, checked_in_at')
          .is('checked_out_at', null).lt('checked_in_at', grenze)
          .order('checked_in_at')
        if (offen && offen.length > 0) {
          const zeilen = offen.map((l: any) => `● ${l.display_name} — ${l.shift || 'Schicht'}, seit ${l.checked_in_at?.slice(0, 16).replace('T', ' ')}`)
          const msg = `🧹 <b>Hängende Check-ins</b> (kein Check-out, älter als 16 Stunden):\n\n${zeilen.join('\n')}\n\nSie verfälschen Schicht-Dauer und Export.`
          await sendTelegram(CHRIS_TG, msg)
          await sendTelegram(REY_TG, msg)
        }
        // Alte Marker wegräumen — als Sperre nur am selben Tag nötig.
        const markerGrenze = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        await supabase.from('alert_markers').delete().lt('alert_date', markerGrenze)
        hausputz = { haengende_checkins: offen?.length || 0 }
      }
    }

    if (ohneZeit.length > 0) console.log('shift-alert: ohne verwertbare Zeit', ohneZeit)

    return new Response(JSON.stringify({
      ok: true,
      stand: `${todayIso} ${minsToClock(nowMins)} (DE)`,
      week_start: weekStartIso,
      gemeldet,
      eingecheckt,
      uebersprungen_model_unsichtbar: modelUnsichtbar,
      uebersprungen_ohne_zeit: ohneZeit,
      hausputz,
    }), { status: 200 })
  } catch (err) {
    console.error('shift-alert error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
