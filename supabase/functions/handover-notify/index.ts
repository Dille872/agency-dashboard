// ─────────────────────────────────────────────────────────────────────────────
// handover-notify · v4.38.0
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

// Die echten Schichtnamen des Dienstplans. Alles andere in `shift_logs.shift`
// (z. B. „Manuell" oder „Schicht") heißt: beim Einchecken wurde keine Zuweisung
// gefunden — dann darf nicht danach gefiltert werden.
const SCHICHT_NAMEN = ['Vorschicht', 'Früh', 'Spät', 'Nacht']

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

async function upd(table: string, params: string, data: object) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
    method: 'PATCH',
    headers: { ...H, 'Prefer': 'return=minimal' },
    body: JSON.stringify(data),
  })
  if (!r.ok) {
    console.error(`[db] update auf ${table} fehlgeschlagen: ${r.status} — ${await r.text().catch(() => '')}`)
  }
  return r.ok
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

// ── v4.46.0: Den Text in Abschnitte pro Model zerlegen ──────────────────────
//
// Geschrieben wird zeilenweise, so wie man es ohnehin tippt:
//
//     Leonie: Kunde xym will morgen nochmal kaufen
//     Lina: nichts Besonderes, war ruhig
//
// Eine Zeile beginnt einen neuen Abschnitt, wenn vor dem Doppelpunkt EIN Model
// der eigenen Schicht steht (mehrere gehen auch: „Leonie und Lina: …"). Alles
// davor ist Vorspann und geht an alle. Folgezeilen ohne eigenen Kopf gehören zum
// laufenden Abschnitt.
//
// Wichtig: Nicht jede Zeile mit Doppelpunkt ist ein Kopf. „Preis: 120" bleibt
// Text, weil „Preis" kein Model ist. Diese Prüfung ist der ganze Trick — ohne sie
// würde die Zerlegung ständig mitten im Satz zuschlagen.
function modelTrifft(wort: string, name: string): boolean {
  const w = norm(wort.replace(/[.,;:!?]+$/g, ''))
  const nm = norm(name)
  if (!w || !nm) return false
  if (w === nm) return true
  const kurz = Math.min(w.length, nm.length)
  return kurz >= 4 && (nm.startsWith(w) || w.startsWith(nm))
}

type ModelRef = { id: string; name: string }

// „Leonie" → [13] · „Leonie und Lina" → [13,44] · „Preis" → []
// Alle Teile müssen treffen. Trifft einer nicht, ist es kein Kopf, sondern Text.
function kopfZuIds(kopf: string, meine: ModelRef[]): string[] {
  const stuecke = kopf.split(/\s*(?:\+|&|,|\bund\b)\s*/i).map(x => x.trim()).filter(Boolean)
  if (stuecke.length === 0 || stuecke.length > 4) return []
  const ids: string[] = []
  for (const st of stuecke) {
    if (st.split(/\s+/).length > 2) return []      // „Kunde meldet sich" ist kein Modelname
    const treffer = meine.filter(m => modelTrifft(st, m.name))
    if (treffer.length !== 1) return []            // nichts oder mehrdeutig → kein Kopf
    if (!ids.includes(treffer[0].id)) ids.push(treffer[0].id)
  }
  return ids
}

function zerlegeUebergabe(text: string, meine: ModelRef[]) {
  const vorspann: string[] = []
  const teile = new Map<string, string[]>()
  if (meine.length < 2) return { vorspann: '', teile }   // ein Model: nichts zu verteilen
  let aktuell: string[] = []
  for (const zeile of String(text || '').split(/\r?\n/)) {
    const m = zeile.match(/^\s*([^:]{1,60}):\s*(.*)$/)
    const ids = m ? kopfZuIds(m[1], meine) : []
    if (ids.length > 0) {
      aktuell = ids
      for (const id of ids) if (!teile.has(id)) teile.set(id, [])
      const rest = (m?.[2] || '').trim()
      if (rest) for (const id of ids) teile.get(id)!.push(rest)
    } else if (aktuell.length > 0) {
      if (zeile.trim()) for (const id of aktuell) teile.get(id)!.push(zeile.trim())
    } else if (zeile.trim()) {
      vorspann.push(zeile.trim())
    }
  }
  return { vorspann: vorspann.join('\n'), teile }
}
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
    // v4.38.0: Bei einer Nachtschicht zählt auch der Vortag als eigener Tag.
    // Die Zelle steht auf dem START-Tag — wer sich um 00:30 einbucht, hat als
    // Check-in-Tag schon den Folgetag. Ohne diesen Zusatz fände die Function
    // keine eigene Zelle: `meineModels` bliebe leer, der Model-Filter fiele weg
    // und die Übergabe ginge an alle gerade laufenden Schichten. Ausgerechnet im
    // Nacht-zu-Früh-Fall, für den das Ganze gebaut ist.
    const eigeneTage = new Set<string>(meinTag ? [meinTag] : [])
    if (meinTag && schicht === 'Nacht') {
      // Vortag aus MEINEM Check-in-Tag ableiten, nicht aus der aktuellen Uhrzeit.
      // Sonst käme bei einem Check-out noch vor Mitternacht die vorletzte Nacht
      // als „eigener Tag" hinzu, `meineModels` würde zu groß und `meinStart`
      // rutschte so weit zurück, dass der Nachfolger-Filter kaum noch greift.
      const d = new Date(`${meinTag}T12:00:00Z`)
      d.setUTCDate(d.getUTCDate() - 1)
      eigeneTage.add(d.toISOString().slice(0, 10))
    }
    const meineModels = new Set<string>()
    let meinStart: number | null = null
    for (const sched of planListe) {
      const zeiten = sched?.shift_times || {}
      for (const [key, val] of Object.entries(sched?.assignments || {}) as [string, any][]) {
        const [modelId, tag, sch] = key.split('__')
        const off = offsetVonTag(tag)
        if (off === undefined) continue
        // Ohne verwertbaren Check-in-Tag bleibt es beim Drei-Tage-Fenster.
        if (eigeneTage.size > 0 && !eigeneTage.has(tag)) continue
        // Nach der Schicht nur filtern, wenn im Log ein ECHTER Schichtname steht.
        // Findet der Bot beim Einchecken keine Zuweisung, trägt er das Wort
        // „Schicht" ein — danach zu filtern würde jede Zelle verwerfen, `meineModels`
        // bliebe leer, und weiter unten fiele damit auch der Model-Filter weg:
        // die Übergabe ginge an irgendeine fremde Schicht.
        if (schicht && SCHICHT_NAMEN.includes(schicht) && sch !== schicht) continue
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

    // ── v4.45.0: Worum geht es in dieser Übergabe? ──────────────────────────
    // `handover_about` nennt die Models, um die es geht. Ohne Angabe bleibt es
    // beim alten Verhalten: die Übergabe gehört der ganzen Schicht.
    //
    // Die Schnittmenge mit `meineModels` ist die Regel — man kann nur zu Models
    // übergeben, die man auch betreut hat. Bleibt die Schnittmenge leer, obwohl
    // etwas angegeben wurde, gewinnt die Angabe: dann wurde die eigene Zelle
    // nicht gefunden (manuell gestartete Schicht, abweichende Schreibweise),
    // und die ausdrückliche Auswahl des Absenders ist die bessere Quelle als
    // eine leere Menge, die den Model-Filter ganz abschalten würde.
    const genannt = new Set<string>(
      (Array.isArray(log.handover_about) ? log.handover_about : []).map((m: any) => String(m)).filter(Boolean)
    )
    let relevanteModels = meineModels
    if (genannt.size > 0) {
      const schnitt = [...genannt].filter(m => meineModels.has(m))
      relevanteModels = new Set(schnitt.length > 0 ? schnitt : [...genannt])
    }

    // Hinweis: `shift_logs.model_names` wird bewusst NICHT als Rückfall benutzt.
    // Die Spalte ist Text (der Bot legt dort Model-IDs ab, das Portal gar nichts) —
    // sie als Liste zu lesen ergäbe eine Menge einzelner Zeichen und würde
    // anschließend jeden Kandidaten wegfiltern.

    // ── Nachfolger suchen ───────────────────────────────────────────────────
    // Kandidat ist jede Zelle, deren Schicht JETZT NOCH LÄUFT oder erst beginnt.
    // Die überlappende Schicht ist der Regelfall: wer um 08:00 angefangen hat,
    // während die Nacht um 08:05 auscheckt, ist genau der richtige Empfänger.
    // v4.38.0: `model` bleibt am Kandidaten hängen — daran hängt die Meldung,
    // für welche Models gar niemand eingeteilt ist.
    type Kandidat = { name: string; start: number; schicht: string; model: string }
    const kandidaten: Kandidat[] = []
    // Models, um die sich in den nächsten Stunden überhaupt jemand kümmert —
    // lockerer gefasst als `kandidaten`, siehe Kommentar in der Schleife.
    const modelsMitBetreuung = new Set<string>()

    for (const sched of planListe) {
      const zeiten = sched?.shift_times || {}
      for (const [key, val] of Object.entries(sched?.assignments || {}) as [string, any][]) {
        const [modelId, tag, sch] = key.split('__')
        const off = offsetVonTag(tag)
        if (off === undefined) continue
        // Ohne Model-Bezug (z.B. manuell eingecheckt) gilt jede Schicht als möglich.
        // v4.45.0: `relevanteModels` statt `meineModels` — bei einer Übergabe zu
        // einem einzelnen Model fallen die Nachfolger der übrigen Models hier raus.
        if (relevanteModels.size > 0 && !relevanteModels.has(modelId)) continue

        const personen = personenDerZelle(val)
        const ich = personen.find(p => norm(p.name) === absenderLc)

        for (const p of personen) {
          // v4.38.0: Getrennt davon mitzählen, ob für dieses Model ÜBERHAUPT
          // jemand dran ist — für die Meldung „ohne Nachfolge".
          //
          // Bewusst lockerer als die Empfängersuche unten: hier zählt auch, wer
          // vor mir angefangen hat und noch weiterläuft (Co-Partner, überlappende
          // Vorschicht), und ich selbst, wenn ich das Model in der nächsten
          // Schicht weiterbetreue. Sonst käme ein Alarm für Models, um die sich
          // sehr wohl jemand kümmert.
          // Die eigene, gerade endende Zelle zählt nicht — ich gehe ja.
          // Steht im Log kein echter Schichtname („Manuell", „Schicht"), lässt
          // sich meine eigene Zelle nicht über die Schicht identifizieren — dann
          // zählt jede meiner Zellen des Tages als „meine endende", damit keine
          // falsche Entwarnung entsteht.
          const istMeineEndendeZelle = norm(p.name) === absenderLc
            && (eigeneTage.size === 0 || eigeneTage.has(tag))
            && (!SCHICHT_NAMEN.includes(schicht) || sch === schicht)
          const spAlle = istMeineEndendeZelle ? null : spanneVon(val, p.seite, zeiten, modelId, sch)
          if (spAlle) {
            const startAlle = spAlle.start + off
            const endeAlle = spAlle.ende + off
            if (endeAlle > jetzt && startAlle <= jetzt + HORIZONT_MIN) {
              modelsMitBetreuung.add(modelId)
            }
          }

          // Vorsicht bei Namen: `handover_for` enthält die Schreibweise aus dem
          // Dienstplan (also aus `chatters_contact`), verglichen wird sie im Portal
          // gegen `user_roles.display_name`. Dass beide übereinstimmen, ist keine
          // neue Annahme — das ganze Portal matcht seine Schichten so
          // (`ChatterPortal.myShifts`). Gingen sie auseinander, sähe der Chatter
          // schon seinen Dienstplan nicht, und das fällt sofort auf.
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
              kandidaten.push({ name: p.name, start, schicht: sch, model: modelId })
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
          kandidaten.push({ name: p.name, start, schicht: sch, model: modelId })
        }
      }
    }

    // v4.37.0: Empfänger sind ALLE, die gerade arbeiten — nicht nur die früheste
    // Schicht.
    //
    // Vorher gewann `min(start)`, und das ging schief, sobald mehr als eine
    // Schicht gleichzeitig läuft. Beispiel: eine Vorschicht 04:00–08:00 und die
    // Frühschicht 06:00–14:00. Checkt die Nacht um 06:05 aus, gewann die
    // Vorschicht mit Start 04:00 — und ausgerechnet die Frühschicht, die die
    // nächsten acht Stunden übernimmt, bekam nichts.
    //
    // Richtig ist die Frage „wer macht jetzt weiter?": alle Schichten, die in
    // diesem Moment laufen. Läuft keine (Lücke im Plan), geht sie an die, die als
    // nächste beginnt. Bei geteilten Schichten stehen beide Hälften drin und
    // werden beide benachrichtigt.
    let empfaengerNamen: string[] = []
    let naechsteSchicht = ''
    const schichtVon: Record<string, string> = {}
    const modelsJeEmpfaenger = new Map<string, Set<string>>()
    if (kandidaten.length > 0) {
      const laufend = kandidaten.filter(k => k.start <= jetzt)
      let treffer = laufend
      if (treffer.length === 0) {
        const frueheste = Math.min(...kandidaten.map(k => k.start))
        treffer = kandidaten.filter(k => k.start === frueheste)
      }
      naechsteSchicht = treffer[0]?.schicht || ''
      const gesehen = new Set<string>()
      for (const k of treffer) {
        // v4.46.0: Welche Models übernimmt diese Person? Vorher fiel das beim
        // Entdoppeln unter den Tisch — für „jeder bekommt nur seinen Abschnitt"
        // ist es aber genau die Information, auf die es ankommt.
        if (!modelsJeEmpfaenger.has(norm(k.name))) modelsJeEmpfaenger.set(norm(k.name), new Set())
        modelsJeEmpfaenger.get(norm(k.name))!.add(k.model)
        if (gesehen.has(norm(k.name))) continue
        gesehen.add(norm(k.name))
        empfaengerNamen.push(k.name)
        // Jede Person bekommt IHREN Schichtnamen genannt. Laufen mehrere
        // Schichten parallel, wäre ein gemeinsamer Name für die Hälfte falsch.
        schichtVon[norm(k.name)] = k.schicht
      }
    }

    // ── v4.46.0: Text in Abschnitte zerlegen ────────────────────────────────
    // Muss VOR dem Festschreiben von `handover_for` passieren: wer zu keinem der
    // genannten Models etwas bekommt, ist kein Empfänger — und darf dann auch
    // nicht in der Liste stehen, an die „tatsächlich verschickt wurde".
    const modelListe = (relevanteModels.size > 0 || genannt.size > 0)
      ? await q('models_contact', '?select=id,name')
      : []
    const modelArr: any[] = Array.isArray(modelListe) ? modelListe : []
    const nameVonId = (id: string) => {
      const t = modelArr.find((m: any) => String(m.id) === String(id))
      return t?.name ? String(t.name) : `Model ${id}`
    }
    const meineRefs: ModelRef[] = [...relevanteModels].map(id => ({ id, name: nameVonId(id) }))
    const { vorspann, teile } = zerlegeUebergabe(String(log.handover_text || ''), meineRefs)

    // Was bekommt diese Person zu lesen? `null` heißt: für sie ist nichts dabei.
    const textFuer = (name: string): string | null => {
      if (teile.size === 0) return text                    // keine Abschnitte → alles wie bisher
      const meine = [...(modelsJeEmpfaenger.get(norm(name)) || [])].filter(id => teile.has(id))
      const bloecke = meine.map(id =>
        `<b>${escapeHtml(nameVonId(id))}:</b> ${escapeHtml((teile.get(id) || []).join('\n'))}`)
      const kopfText = vorspann ? escapeHtml(vorspann) : ''
      if (bloecke.length === 0) return kopfText || null    // nur Vorspann, oder gar nichts
      return [kopfText, ...bloecke].filter(Boolean).join('\n\n')
    }

    // Empfänger ohne eigenen Anteil fallen raus. Genau dafür war die ganze
    // Übung: Wer in der Nacht nur Lina hat, bekommt die Leonie-Notiz nicht mehr.
    if (teile.size > 0) {
      empfaengerNamen = empfaengerNamen.filter(nm => textFuer(nm) !== null)
    }

    // Best effort — ohne die Spalte bleibt es beim vollen Text im Portal.
    if (teile.size > 0) {
      const alsObjekt: Record<string, string> = {}
      for (const [id, zeilen] of teile) alsObjekt[id] = zeilen.join('\n')
      await upd('shift_logs', `?id=eq.${encodeURIComponent(String(logId))}`,
        { handover_parts: { vorspann, teile: alsObjekt } })
    }

    // ── v4.36.0: Empfängerkreis festschreiben ───────────────────────────────
    // VOR dem Telegram-Versand, nicht danach: Portal und Bot entscheiden anhand
    // dieser Spalte, wem sie die Übergabe zeigen. Stünde sie noch auf NULL,
    // während die Nachrichten rausgehen, könnte ein 30-Sekunden-Tick sie in
    // diesem Moment noch jedem anzeigen.
    //
    // Ein LEERES Array ist eine Aussage („ermittelt, niemand gefunden") und
    // ausdrücklich etwas anderes als NULL („nie ermittelt"). Nur bei NULL bleibt
    // der Notnagel aktiv, der sie allen zeigt.
    //
    // Schlägt das Schreiben fehl (Migration noch nicht gelaufen, Schema-Cache
    // kalt), bleibt die Spalte auf NULL — die Übergabe ist dann zu großzügig
    // sichtbar statt gar nicht. Der richtige Ausfallmodus, aber der Aufrufer
    // erfährt es über das Antwortfeld, statt dass es nur in den Logs steht.
    //
    // v4.38.0: Zusätzlich die betroffenen Models. Daran erkennen Portal und Bot
    // beim Einchecken, dass eine Übergabe auch jemanden angeht, der beim
    // Auschecken des Absenders noch gar nicht arbeitete — die Frühschicht für ein
    // Model kann Stunden nach dem Ende der Nacht beginnen. `handover_for` wird
    // dafür bewusst NICHT nachträglich erweitert: es hält fest, an wen tatsächlich
    // etwas verschickt wurde, und das soll nachvollziehbar bleiben.
    //
    // ZWEI getrennte Aufrufe, bewusst. Lägen beide Spalten in einem PATCH und
    // wäre `handover_models` noch nicht migriert, lehnte PostgREST den ganzen
    // Aufruf ab — dann bliebe auch `handover_for` auf null, und der Notnagel
    // zeigte die Übergabe wieder jedem. Eine fehlende neue Spalte darf die
    // funktionierende alte nicht mitreißen.
    const empfaengerGespeichert = await upd(
      'shift_logs', `?id=eq.${encodeURIComponent(String(logId))}`,
      { handover_for: empfaengerNamen },
    )
    // Best effort: schlägt das fehl, greift nur der Nachzügler-Weg nicht.
    await upd(
      'shift_logs', `?id=eq.${encodeURIComponent(String(logId))}`,
      // v4.45.0: bewusst `relevanteModels`. Portal und Bot zeigen eine Übergabe
      // darüber auch jemandem, der später einsteigt — bei einer Übergabe zu
      // Leonie soll das die Leonie-Schicht sein und nicht jeder, der irgendeines
      // meiner Models übernimmt.
      { handover_models: [...relevanteModels] },
    )

    // ── v4.38.0: Models ohne jeden Nachfolger ───────────────────────────────
    // Ein Model, für das im Horizont überhaupt kein Kandidat auftaucht, ist
    // unbesetzt. Das ist etwas anderes als „Nachfolger kommt später" — dort gibt
    // es einen Kandidaten, er läuft nur noch nicht.
    //
    // Bisher fiel das durch: die Warnung hing am Gesamtergebnis. Wer drei Models
    // betreute und für zwei davon niemanden hatte, bekam trotzdem ein
    // „Übergabe ist raus an Noa" — die Lücke sah niemand.
    const unbesetzteIds = [...relevanteModels].filter(m => !modelsMitBetreuung.has(m))
    // v4.45.0: Namen werden auch für die Betreff-Zeile gebraucht, deshalb wird
    // die Liste geholt, sobald eines von beidem anfällt — statt zweimal.
    // v4.46.0: `modelListe` ist oben schon geladen — die Namen kommen von dort.
    const unbesetzteNamen: string[] = unbesetzteIds.map(nameVonId)
    const betreffNamen: string[] = genannt.size > 0 || teile.size > 0
      ? [...(teile.size > 0 ? teile.keys() : relevanteModels)].map(nameVonId)
      : []

    // ── Telegram-IDs holen ──────────────────────────────────────────────────
    const kontakte = await q('chatters_contact', '?select=name,telegram_id,active')
    const idVon = (name: string): string | null => {
      const treffer = (Array.isArray(kontakte) ? kontakte : []).find(
        (c: any) => norm(c.name) === norm(name) && c.active !== false
      )
      return treffer?.telegram_id ? String(treffer.telegram_id) : null
    }

    // ── Versand ─────────────────────────────────────────────────────────────
    // v4.45.0: Bei einer modellbezogenen Übergabe steht das Model im Kopf. Der
    // Empfänger soll auf den ersten Blick sehen, worauf sich der Text bezieht —
    // gerade weil er drei andere Models parallel betreut.
    const betreff = betreffNamen.length > 0
      ? `\n📌 Betrifft: <b>${betreffNamen.map(escapeHtml).join(', ')}</b>`
      : ''
    const kopf = `🤝 <b>Schichtübergabe</b> von <b>${escapeHtml(absender)}</b>${schicht ? ` (${escapeHtml(schicht)})` : ''}${betreff}`

    const zugestellt: string[] = []
    const ohneId: string[] = []
    const schonBenachrichtigt = new Set<string>()
    for (const name of empfaengerNamen) {
      const id = idVon(name)
      if (!id) { ohneId.push(name); continue }
      const meineSchicht = schichtVon[norm(name)] || naechsteSchicht
      // v4.46.0: nur der eigene Abschnitt (fällt auf den vollen Text zurück,
      // wenn der Text gar nicht nach Models gegliedert war).
      const meinText = textFuer(name) || text
      const msg = `${kopf}\n\n${meinText}\n\n` +
        `Das betrifft deine ${meineSchicht ? escapeHtml(meineSchicht) : 'nächste'}-Schicht. ` +
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
    // v4.38.0: Lücken pro Model benennen. Bei mehreren betreuten Models sagt ein
    // „ist raus an Noa" nichts darüber, ob für die anderen jemand da ist.
    if (unbesetzteNamen.length > 0) {
      zeilen.push(`⚠️ <b>Ohne Nachfolge:</b> ${unbesetzteNamen.map(escapeHtml).join(', ')} — für ${unbesetzteNamen.length === 1 ? 'dieses Model' : 'diese Models'} ist in den nächsten Stunden niemand eingeteilt.`)
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
      // false = Empfängerkreis konnte nicht festgeschrieben werden; die Übergabe
      // erscheint dann bei allen statt nur bei den Richtigen.
      empfaenger_gespeichert: empfaengerGespeichert,
      // v4.38.0: Models, für die im Horizont überhaupt niemand eingeteilt ist.
      // Der Absender soll das erfahren — sonst hält er die Übergabe für erledigt.
      ohne_nachfolge: unbesetzteNamen,
      // v4.45.0: Auf welche Models die Übergabe eingegrenzt wurde (leer = alle).
      betrifft: betreffNamen,
    })
  } catch (e) {
    console.error('handover-notify:', e)
    return json({ ok: false, error: String(e) }, 500)
  }
})
