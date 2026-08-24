// ─────────────────────────────────────────────────────────────────────────────
// handover-notify · v4.35.0
//
// Verschickt eine Schichtübergabe per Telegram: an die Leute, die die Schicht
// übernehmen, und an Chris und Rey.
//
// WARUM eine eigene Function und nicht zweimal im Code:
// Sowohl das Portal (Auschecken im Browser) als auch der Telegram-Bot (`/off`)
// können eine Übergabe erzeugen. Die Frage „wer übernimmt eigentlich?" ist der
// aufwendigste Teil daran — Live-Plan lesen, Models abgleichen, Zeiten in
// Berliner Zeit vergleichen, geteilte Schichten berücksichtigen. Zweimal
// gepflegt (einmal JS, einmal TS) würde das garantiert auseinanderlaufen.
//
// Aufruf:  POST { log_id: <id aus shift_logs> }
// Antwort: { ok: true, an: [...], gefunden: <n> }
//
// Deploy:  supabase functions deploy handover-notify
//
// Secrets: TELEGRAM_BOT_TOKEN, Service-Role (DB_URL/DB_SERVICE_KEY)
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('DB_URL') || Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('DB_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const CHRIS_ID = '1538601588'
const REY_ID = '528328429'
const ADMIN_IDS = [CHRIS_ID, REY_ID]
const TZ = 'Europe/Berlin'

// Wie weit nach vorn wird nach einem Nachfolger gesucht. 14 Stunden decken
// Nacht → Früh ab, ohne dass eine Übergabe am nächsten Nachmittag noch jemanden
// erreicht, den sie nichts mehr angeht.
const HORIZONT_MIN = 14 * 60

const H = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'Accept-Profile': 'public',
  'Content-Profile': 'public',
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

async function q(table: string, params = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, { headers: H })
  if (!r.ok) {
    console.error(`[db] select auf ${table} fehlgeschlagen: ${r.status} — ${await r.text().catch(() => '')}`)
    return []
  }
  return r.json()
}

async function tg(chatId: string, text: string) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
  if (!r.ok) console.error(`[tg] Versand an ${chatId} fehlgeschlagen: ${r.status}`)
  return r.ok
}

// Namensvergleich wie im Telegram-Bot: alles außer Buchstaben und Ziffern raus.
// Bewusst die aggressive Variante — an diesem Vergleich hängt, ob eine Übergabe
// versehentlich an ihren eigenen Absender geht. Ein Bindestrich oder ein
// doppeltes Leerzeichen zwischen Plan-Name und `display_name` darf das nicht
// aushebeln.
const norm = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const escapeHtml = (s: unknown) =>
  String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ── Zeit ────────────────────────────────────────────────────────────────────
// Alles rechnet in Berliner Wandzeit, wie der Dienstplan selbst. Die Function
// läuft in UTC — `new Date().toISOString().slice(0,10)` wäre zwischen 22:00 und
// Mitternacht der falsche Tag und würde die Nachtschicht ins Leere schicken.
function berlinTag(offsetTage = 0): string {
  const d = new Date(Date.now() + offsetTage * 86400000)
  return d.toLocaleDateString('sv-SE', { timeZone: TZ })
}
function berlinMinuten(): number {
  const s = new Date().toLocaleTimeString('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}
function parseUhr(raw: unknown): number | null {
  const m = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}
// „HH:MM-HH:MM" → { start, ende }. Endet die Schicht vor ihrem Beginn, läuft sie
// über Mitternacht und das Ende wandert einen Tag weiter.
function parseSpanne(raw: unknown): { start: number; ende: number } | null {
  const s = String(raw || '').replace(/\s*\(DE\)/gi, '').trim()
  if (!s) return null
  const teile = s.split('-')
  const start = parseUhr(teile[0])
  if (start == null) return null
  let ende = parseUhr(teile[1])
  if (ende == null) ende = start + 8 * 60
  if (ende <= start) ende += 1440
  return { start, ende }
}
// Zeitabschnitt einer Seite einer geteilten Schicht.
function splitSpanne(val: any, seite: 'a' | 'b'): string | null {
  const von = val?.[`split_${seite}_von`] || ''
  const bis = val?.[`split_${seite}_bis`] || ''
  if (!von && !bis) return null
  return von && bis ? `${von}-${bis}` : String(von || bis)
}

type Person = { name: string; seite: 'a' | 'b' }

// Wer arbeitet in dieser Zelle? Der Hauptchatter immer; die zweite Person nur bei
// Co-Schicht und geteilter Schicht — beim Anlernen steht dort oft jemand ohne
// Account, der keine Übergabe bekommen kann und auch nicht verantwortlich ist.
function personenDerZelle(val: any): Person[] {
  const raus: Person[] = []
  const haupt = val?.chatter
  if (haupt === '__FREI__') return raus
  if (haupt) raus.push({ name: haupt, seite: 'a' })
  const modus = val?.trainee_mode
  if (val?.trainee && (modus === 'split' || modus === 'co')) {
    raus.push({ name: val.trainee, seite: 'b' })
  }
  return raus
}

// Spanne einer Person in einer Zelle — bei geteilter Schicht ihr Abschnitt,
// sonst die Zeit der Zelle.
function spanneVon(val: any, seite: 'a' | 'b', zeiten: any, modelId: string, sch: string) {
  const eigene = val?.trainee_mode === 'split' ? splitSpanne(val, seite) : null
  return parseSpanne(eigene)
    ?? parseSpanne(val?.time_override)
    ?? parseSpanne(zeiten?.[`${modelId}__${sch}`])
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // ── Auth-Gate ─────────────────────────────────────────────────────────────
  // Ohne diese Prüfung könnte jeder, der den öffentlichen Key aus dem
  // Frontend-Bundle liest, log_ids durchzählen und beliebige Übergaben erneut
  // verschicken lassen. Zwei zugelassene Aufrufer:
  //   1. der Telegram-Bot — schickt den Service-Role-Key mit
  //   2. ein eingeloggter Dashboard-User, dem das Log auch gehört
  // Der publishable Key allein reicht in beiden Fällen NICHT.
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ ok: false, error: 'Nicht eingeloggt' }, 401)
  const istBot = token === SUPABASE_KEY

  let userName = ''
  if (!istBot) {
    try {
      const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { data, error } = await authClient.auth.getUser(token)
      if (error || !data?.user) return json({ ok: false, error: 'Nicht autorisiert' }, 401)
      const rollen = await q('user_roles', `?user_id=eq.${data.user.id}&select=display_name&limit=1`)
      userName = (Array.isArray(rollen) ? rollen[0]?.display_name : '') || ''
      if (!userName) return json({ ok: false, error: 'Kein Anzeigename hinterlegt' }, 403)
    } catch (e) {
      console.error('Auth-Prüfung fehlgeschlagen:', e)
      return json({ ok: false, error: 'Auth-Prüfung fehlgeschlagen' }, 401)
    }
  }

  try {
    const body = await req.json().catch(() => ({}))
    const logId = body?.log_id
    if (!logId) return json({ ok: false, error: 'log_id fehlt' }, 400)

    const logs = await q('shift_logs', `?id=eq.${encodeURIComponent(String(logId))}&limit=1`)
    const log = Array.isArray(logs) ? logs[0] : null
    // Bewusst dieselbe Antwort wie bei „gehört dir nicht": sonst ließe sich über
    // 404 gegen 403 durchprobieren, welche Log-IDs es gibt.
    if (!log) return json({ ok: false, error: 'Nicht gefunden oder nicht deine Schicht' }, 404)

    const absender = String(log.display_name || '')
    const absenderLc = norm(absender)

    if (!istBot && norm(userName) !== absenderLc) {
      return json({ ok: false, error: 'Nicht gefunden oder nicht deine Schicht' }, 404)
    }
    if (!log.handover_text) {
      // Kein Fehler — nur nichts zu tun. Der Aufrufer soll deshalb nicht scheitern.
      return json({ ok: true, an: [], gefunden: 0, hinweis: 'keine Übergabe am Log' })
    }

    const schicht = log.shift ? String(log.shift) : ''
    const text = escapeHtml(log.handover_text)

    // ── Live-Plan laden ─────────────────────────────────────────────────────
    // Über `week_start` eingegrenzt statt über `limit`: sind mehrere künftige
    // Wochen schon live veröffentlicht, fiele die laufende Woche sonst hinten
    // raus und es gäbe nie Kandidaten.
    const gestern = berlinTag(-1)
    const heute = berlinTag(0)
    const morgen = berlinTag(1)
    const vorWoche = berlinTag(-9)
    const plaene = await q('schedule',
      `?status=eq.live&week_start=gte.${vorWoche}&order=week_start.asc&limit=4`)
    const planListe: any[] = Array.isArray(plaene) ? plaene : []

    // Tage, die betrachtet werden. GESTERN muss mit hinein: eine Nachtschicht ist
    // im Plan auf ihren START-Tag geschlüsselt und läuft in den Folgetag hinein.
    // Ohne diesen Zweig wäre sie ab Mitternacht weder als eigene Schicht noch als
    // Empfänger auffindbar.
    const TAGE: { tag: string; offset: number }[] = [
      { tag: gestern, offset: -1440 },
      { tag: heute, offset: 0 },
      { tag: morgen, offset: 1440 },
    ]
    const offsetVonTag = (t: string) => TAGE.find(x => x.tag === t)?.offset

    const jetzt = berlinMinuten()

    // ── Meine Models und mein Schichtbeginn ─────────────────────────────────
    // Daran hängt, wer als Nachfolger gilt: nur wer dieselben Models betreut und
    // später anfängt als ich.
    //
    // Maßgeblich ist der Tag, an dem MEINE Schicht im Plan steht — abgeleitet aus
    // dem Check-in. Ohne diese Eingrenzung würden Zellen von gestern und morgen
    // mitzählen; wer dieselbe Schicht an mehreren Tagen hat, bekäme Models in die
    // Liste, die er heute gar nicht betreut, und die Übergabe ginge an Leute, mit
    // denen die Schicht nichts zu tun hatte.
    const meinTag = log.checked_in_at
      ? new Date(log.checked_in_at).toLocaleDateString('sv-SE', { timeZone: TZ })
      : ''
    const meineModels = new Set<string>()
    let meinStart: number | null = null
    for (const sched of planListe) {
      const zeiten = sched?.shift_times || {}
      for (const [key, val] of Object.entries(sched?.assignments || {}) as [string, any][]) {
        const [modelId, tag, sch] = key.split('__')
        const off = offsetVonTag(tag)
        if (off === undefined) continue
        // Ohne verwertbaren Check-in-Tag bleibt es beim Drei-Tage-Fenster.
        if (meinTag && tag !== meinTag) continue
        if (schicht && sch !== schicht) continue
        const ich = personenDerZelle(val).find(p => norm(p.name) === absenderLc)
        if (!ich) continue
        meineModels.add(modelId)
        const sp = spanneVon(val, ich.seite, zeiten, modelId, sch)
        if (sp) {
          // Frühester eigener Beginn — konservativ: alles, was nicht später
          // anfängt, ist kein Nachfolger.
          const start = sp.start + off
          if (meinStart == null || start < meinStart) meinStart = start
        }
      }
    }
    // Rückfall, wenn im Plan keine eigene Zelle gefunden wurde — bei manuell
    // gestarteter Schicht ('Manuell'), bei abweichender Schreibweise des Namens
    // oder wenn kein Plan live ist. Ohne diesen Ersatz wäre `meinStart` null,
    // die Nachfolger-Regel unten liefe leer und die Übergabe ginge an die
    // früheste Schicht im Plan — also möglicherweise an jemanden, der längst
    // vor mir angefangen hat.
    if (meinStart == null && log.checked_in_at) {
      const off = meinTag ? offsetVonTag(meinTag) : 0
      if (off !== undefined) {
        const s = new Date(log.checked_in_at)
          .toLocaleTimeString('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
        const [h, m] = s.split(':').map(Number)
        if (!isNaN(h)) meinStart = h * 60 + (m || 0) + off
      }
    }

    // Hinweis: `shift_logs.model_names` wird bewusst NICHT als Rückfall benutzt.
    // Die Spalte ist Text (der Bot legt dort Model-IDs ab, das Portal gar nichts) —
    // sie als Liste zu lesen ergäbe eine Menge einzelner Zeichen und würde
    // anschließend jeden Kandidaten wegfiltern.

    // ── Nachfolger suchen ───────────────────────────────────────────────────
    // Kandidat ist jede Zelle, deren Schicht JETZT NOCH LÄUFT oder erst beginnt.
    // Die überlappende Schicht ist der Regelfall: wer um 08:00 angefangen hat,
    // während die Nacht um 08:05 auscheckt, ist genau der richtige Empfänger.
    type Kandidat = { name: string; start: number; schicht: string }
    const kandidaten: Kandidat[] = []

    for (const sched of planListe) {
      const zeiten = sched?.shift_times || {}
      for (const [key, val] of Object.entries(sched?.assignments || {}) as [string, any][]) {
        const [modelId, tag, sch] = key.split('__')
        const off = offsetVonTag(tag)
        if (off === undefined) continue
        // Ohne Model-Bezug (z.B. manuell eingecheckt) gilt jede Schicht als möglich.
        if (meineModels.size > 0 && !meineModels.has(modelId)) continue

        const personen = personenDerZelle(val)
        const ich = personen.find(p => norm(p.name) === absenderLc)

        for (const p of personen) {
          if (norm(p.name) === absenderLc) continue
          const sp = spanneVon(val, p.seite, zeiten, modelId, sch)
          if (!sp) continue
          const start = sp.start + off
          const ende = sp.ende + off
          if (ende <= jetzt) continue                 // schon vorbei
          if (start > jetzt + HORIZONT_MIN) continue  // zu weit weg

          // Sonderfall geteilte Schicht: Stehen wir beide in DERSELBEN Zelle, ist
          // die zweite Hälfte (Seite 'b') per Definition der Nachfolger der ersten
          // ('a') — auch wenn die Abschnitte noch nicht eingetragen sind und beide
          // deshalb dieselbe Zeit tragen. Die Zeitregel unten würde ihn sonst
          // wegwerfen, und ausgerechnet die Person, die direkt übernimmt,
          // bekäme nichts.
          if (ich && val?.trainee_mode === 'split') {
            if (ich.seite === 'a' && p.seite === 'b') {
              kandidaten.push({ name: p.name, start, schicht: sch })
            }
            continue
          }
          // Ein Nachfolger fängt später an als ich. Wer zur selben Zeit oder
          // früher begonnen hat, übernimmt nichts — er war schon da:
          //   · der Partner einer Co-Schicht (gleiche Zelle, gleiche Zeit)
          //   · eine noch laufende Vorschicht, die vor mir angefangen hat
          // Ohne diese Regel gewinnt „früheste Startzeit" genau die Falschen und
          // die tatsächlich übernehmende Schicht bekommt nichts.
          if (meinStart != null && start <= meinStart) continue
          kandidaten.push({ name: p.name, start, schicht: sch })
        }
      }
    }

    // Nur die früheste noch laufende oder anstehende Schicht bekommt sie — sonst
    // ginge die Übergabe an den halben Dienstplan. Bei geteilten Schichten stehen
    // beide Hälften mit derselben Startzeit drin und werden beide benachrichtigt.
    let empfaengerNamen: string[] = []
    let naechsteSchicht = ''
    if (kandidaten.length > 0) {
      const frueheste = Math.min(...kandidaten.map(k => k.start))
      const treffer = kandidaten.filter(k => k.start === frueheste)
      naechsteSchicht = treffer[0]?.schicht || ''
      const gesehen = new Set<string>()
      for (const k of treffer) {
        if (gesehen.has(norm(k.name))) continue
        gesehen.add(norm(k.name))
        empfaengerNamen.push(k.name)
      }
    }

    // ── Telegram-IDs holen ──────────────────────────────────────────────────
    const kontakte = await q('chatters_contact', '?select=name,telegram_id,active')
    const idVon = (name: string): string | null => {
      const treffer = (Array.isArray(kontakte) ? kontakte : []).find(
        (c: any) => norm(c.name) === norm(name) && c.active !== false
      )
      return treffer?.telegram_id ? String(treffer.telegram_id) : null
    }

    // ── Versand ─────────────────────────────────────────────────────────────
    const kopf = `🤝 <b>Schichtübergabe</b> von <b>${escapeHtml(absender)}</b>${schicht ? ` (${escapeHtml(schicht)})` : ''}`

    const zugestellt: string[] = []
    const ohneId: string[] = []
    const schonBenachrichtigt = new Set<string>()
    for (const name of empfaengerNamen) {
      const id = idVon(name)
      if (!id) { ohneId.push(name); continue }
      const msg = `${kopf}\n\n${text}\n\n` +
        `Das betrifft deine ${naechsteSchicht ? escapeHtml(naechsteSchicht) : 'nächste'}-Schicht. ` +
        `Bestätige mit /gelesen, sobald du es gesehen hast — oder im Portal mit „Gelesen &amp; verstanden".`
      if (await tg(id, msg)) { zugestellt.push(name); schonBenachrichtigt.add(id) }
      else ohneId.push(`${name} (Versand fehlgeschlagen)`)
    }

    // Chris und Rey immer, mit Angabe wer es bekommen hat. Sie sind die
    // Rückfallebene, wenn niemand eingeteilt ist oder die IDs fehlen.
    const zeilen: string[] = []
    if (zugestellt.length > 0) zeilen.push(`Weitergeleitet an: ${zugestellt.map(escapeHtml).join(', ')}`)
    if (ohneId.length > 0) zeilen.push(`⚠️ Nicht erreicht: ${ohneId.map(escapeHtml).join(', ')}`)
    if (empfaengerNamen.length === 0) {
      zeilen.push('⚠️ <b>Niemand gefunden, der übernimmt</b> — im Dienstplan steht für die nächsten Stunden keine passende Schicht.')
    }
    for (const adminId of ADMIN_IDS) {
      // Nicht doppelt: Chris oder Rey können selbst der Nachfolger sein.
      if (schonBenachrichtigt.has(adminId)) continue
      await tg(adminId, `${kopf}\n\n${text}\n\n${zeilen.join('\n')}`)
    }

    return json({
      ok: true,
      an: zugestellt,
      ohne_id: ohneId,
      gefunden: empfaengerNamen.length,
      // Für den Aufrufer: konnte überhaupt jemand erreicht werden?
      zugestellt: zugestellt.length > 0,
    })
  } catch (e) {
    console.error('handover-notify:', e)
    return json({ ok: false, error: String(e) }, 500)
  }
})
