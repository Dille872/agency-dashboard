// v4.67.0: Kalender-Abo (iCalendar / .ics) für Apple- und Google-Kalender.
//
// Aufruf: GET /functions/v1/kalender-ics?t=<token>
// Kalender-Apps schicken keinen Login mit → Deploy mit --no-verify-jwt.
// Der Token (kalender_abos) ist der einzige Schlüssel. Geliefert werden NUR:
//   - team_kalender-Einträge für diese Person oder „Ganzes Team"
//   - die eigenen Schichten aus Live-Wochen des Dienstplans
// Bei unbekanntem Token oder gesperrtem/offboardetem Account: 404, ohne Details.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const ART: Record<string, string> = { aufgabe: 'Aufgabe', event: 'Event', termin: 'Team-Termin', erinnerung: 'Erinnerung' }
const MODUS: Record<string, string> = { anlernen: 'Anlernen', co: 'Co-Schicht', split: 'geteilt' }
const norm = (x: unknown) => String(x ?? '').trim().toLowerCase()

// ── Zeit-Helfer (Dienstplan ist deutsche Wandzeit) ──────────────────────────
function versatzMin(d: Date, zone: string): number {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const p: Record<string, number> = {}
  for (const x of f.formatToParts(d)) if (x.type !== 'literal') p[x.type] = Number(x.value)
  const alsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((alsUtc - d.getTime()) / 60000)
}
function berlinWandzeit(tag: string, zeit: string): Date {
  const [h, m] = zeit.split(':').map(Number)
  const [y, mo, d] = tag.split('-').map(Number)
  const naiv = Date.UTC(y, mo - 1, d, h, m)
  let t = naiv - versatzMin(new Date(naiv), 'Europe/Berlin') * 60000
  t = naiv - versatzMin(new Date(t), 'Europe/Berlin') * 60000 // Zeitumstellung sauber treffen
  return new Date(t)
}
const plusTage = (tag: string, n: number) => { const d = new Date(tag + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const montagVon = (tag: string) => { const d = new Date(tag + 'T12:00:00Z'); return plusTage(tag, -((d.getUTCDay() + 6) % 7)) }

// ── iCalendar-Helfer ────────────────────────────────────────────────────────
const icsZeit = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const icsText = (s: unknown) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
// Zeilen > 75 Bytes falten (RFC 5545), UTF-8-sicher
function falten(zeile: string): string {
  const enc = new TextEncoder()
  if (enc.encode(zeile).length <= 75) return zeile
  const teile: string[] = []
  let akt = '', len = 0, grenze = 75
  for (const ch of zeile) {
    const b = enc.encode(ch).length
    if (len + b > grenze) { teile.push(akt); akt = ''; len = 0; grenze = 74 }
    akt += ch; len += b
  }
  if (akt) teile.push(akt)
  return teile.join('\r\n ')
}

serve(async (req) => {
  const url = new URL(req.url)
  const token = url.searchParams.get('t') || ''
  const nichts = () => new Response('Nicht gefunden', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  if (!/^[0-9a-f]{64}$/.test(token)) return nichts()

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { data: abo } = await sb.from('kalender_abos').select('user_id, display_name').eq('token', token).maybeSingle()
    if (!abo) return nichts()
    const { data: rolle } = await sb.from('user_roles').select('display_name, status').eq('user_id', abo.user_id).maybeSingle()
    if (!rolle || rolle.status === 'suspended' || rolle.status === 'offboarded') return nichts()
    const name = rolle.display_name || abo.display_name
    const ich = norm(name)

    const jetzt = new Date()
    const von = new Date(jetzt.getTime() - 30 * 86400000)
    const bis = new Date(jetzt.getTime() + 180 * 86400000)

    // 1) Kalender-Einträge
    const { data: kal } = await sb.from('team_kalender').select('*')
      .gte('beginn', von.toISOString()).lte('beginn', bis.toISOString()).order('beginn')
    const meine = (kal || []).filter((e: any) => e.fuer_alle || (e.fuer || []).some((n: string) => norm(n) === ich))

    // 2) Eigene Schichten (nur Live-Wochen)
    const heuteTag = jetzt.toISOString().slice(0, 10)
    const { data: wochen } = await sb.from('schedule').select('week_start, status, assignments, shift_times')
      .eq('status', 'live').gte('week_start', montagVon(plusTage(heuteTag, -30))).lte('week_start', plusTage(heuteTag, 90))
    const { data: models } = await sb.from('models_contact').select('id, name')
    const modelName: Record<string, string> = {}
    for (const m of models || []) modelName[String(m.id)] = m.name

    const zeilen: string[] = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Thirteen 87 Collective//Team-Kalender//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      `X-WR-CALNAME:${icsText('Thirteen 87 – ' + name)}`, 'X-WR-TIMEZONE:Europe/Berlin',
      'REFRESH-INTERVAL;VALUE=DURATION:PT15M', 'X-PUBLISHED-TTL:PT15M',
    ]
    const stamp = icsZeit(jetzt)
    const event = (uid: string, beginn: Date, ende: Date, titel: string, beschreibung: string, extra: string[] = []) => {
      zeilen.push('BEGIN:VEVENT', `UID:${uid}@thirteen87`, `DTSTAMP:${stamp}`, `DTSTART:${icsZeit(beginn)}`, `DTEND:${icsZeit(ende)}`,
        `SUMMARY:${icsText(titel)}`, ...(beschreibung ? [`DESCRIPTION:${icsText(beschreibung)}`] : []), ...extra, 'END:VEVENT')
    }

    for (const e of meine) {
      const b = new Date(e.beginn)
      const en = e.ende ? new Date(e.ende) : new Date(b.getTime() + 30 * 60000)
      const fertig = (e.erledigt_von || []).some((n: string) => norm(n) === ich)
      const prefix = e.art === 'aufgabe' ? (fertig ? '✓ ' : '☐ ') : ''
      const teile = [
        `${ART[e.art] || 'Termin'}${e.model_name ? ' · ' + e.model_name : ''}`,
        e.folge_titel ? `Folgeaufgabe zu: ${e.folge_titel}` : '',
        e.notiz || '',
        e.fuer_alle ? 'Für: Ganzes Team' : `Für: ${(e.fuer || []).join(', ')}`,
        e.erstellt_von ? `Eingetragen von ${e.erstellt_von}` : '',
        e.art === 'aufgabe' ? 'Abhaken im Dashboard bzw. Portal (Mein Kalender).' : '',
      ].filter(Boolean)
      event(`kal-${e.id}`, b, en, prefix + e.titel, teile.join('\n'), [`CATEGORIES:${icsText(ART[e.art] || 'Termin')}`])
    }

    for (const w of wochen || []) {
      const zeiten = w.shift_times || {}
      for (const [key, val] of Object.entries<any>(w.assignments || {})) {
        if (!val || !val.chatter || val.chatter === '__FREI__') continue
        const [modelId, planTag, shift] = key.split('__')
        if (!planTag) continue
        const istChatter = norm(val.chatter) === ich, istTrainee = norm(val.trainee) === ich
        if (!istChatter && !istTrainee) continue
        const spanne = String(val.time_override || zeiten[`${modelId}__${shift}`] || '').replace(/\s*\(DE\)/g, '')
        const [a, z] = spanne.split('-').map((x: string) => x && x.trim())
        if (!a || !/^\d{1,2}:\d{2}$/.test(a)) continue
        const beginn = berlinWandzeit(planTag, a)
        if (beginn < von || beginn > bis) continue
        let ende = z && /^\d{1,2}:\d{2}$/.test(z) ? berlinWandzeit(planTag, z) : new Date(beginn.getTime() + 8 * 3600000)
        // über Mitternacht: Ende am Folgetag als Wandzeit (stimmt auch in der Nacht der Zeitumstellung)
        if (ende <= beginn) ende = berlinWandzeit(plusTage(planTag, 1), z)
        const model = modelName[modelId] || modelId
        const schicht = /schicht$/i.test(shift) ? shift : shift + 'schicht'
        const modus = val.trainee ? (MODUS[val.trainee_mode] || MODUS.anlernen) : ''
        const zusatz = val.trainee ? (istChatter ? `${modus} mit ${val.trainee}` : `${modus} bei ${val.chatter}`) : ''
        event(`schicht-${planTag}-${modelId}-${norm(shift).replace(/[^a-z0-9]/g, '')}-${ich.replace(/[^a-z0-9]/g, '')}`, beginn, ende,
          `Schicht: ${model} (${shift})`, [schicht + ' laut Dienstplan', zusatz, 'Änderungen nur im Dienstplan.'].filter(Boolean).join('\n'),
          ['CATEGORIES:Schicht'])
      }
    }
    zeilen.push('END:VCALENDAR')

    // Abruf merken (für „läuft seit …" in der App) — Fehler hier ignorieren
    sb.from('kalender_abos').update({ zuletzt_abgerufen: jetzt.toISOString() }).eq('token', token).then(() => {}, () => {})

    return new Response(zeilen.map(falten).join('\r\n') + '\r\n', {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="thirteen87.ics"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('kalender-ics:', err)
    return new Response('Fehler', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }
})
