// supabase/functions/generate-messages/index.ts
// Erzeugt Nachrichten-Vorschläge für ein Model + Anlass + Schicht via Anthropic (Claude).
// - Auth-Gate: nur eingeloggte Dashboard-User.
// - Steckbrief-Pflicht: fehlt der Steckbrief oder ist er inaktiv -> keine Vorschläge.
//
// v4.3.0 – Menschlicher + frischer:
//   * Prompt umgebaut: "Verankerung" + Anti-Bot-Verbotsliste statt Bauform-Regeln.
//   * FRISCHE: zuletzt verschickte Nachrichten als "NICHT wiederholen"-Liste.
//   * PFLICHT-MIX: feste Sorten (Einzelfrage / Entweder-oder / Moment / neckisch).
//
// v4.15.0 – Länge verbindlich: eigene Wortspanne je Vorschlag, harte Grenze im Code.
//
// v4.32.0 – WIEDERHOLUNG WIRKLICH ABSTELLEN. Warum:
//   Die Anti-Wiederholung war bis hier eine BITTE im Prompt. Nichts im Code hat
//   geprüft, ob ein Vorschlag schon mal so dastand — Haiku hat die Sperrliste
//   schlicht ignoriert. Dazu kamen drei Verstärker:
//     (a) Die Sorten-Beschreibungen enthielten wörtliche Beispielsätze
//         ("sitz hier mit chips… fehlt nur du"). Beispiele im Prompt werden
//         kopiert — deshalb kamen immer dieselben Szenen.
//     (b) Bei gleichem Model+Anlass+Schicht war der Prompt Byte für Byte
//         identisch. Gleicher Prompt -> gleiche Lieblingsantworten.
//     (c) Gut bewertete Nachrichten flossen als Stil-Vorlage zurück, immer
//         dieselben Top-6. Selbstverstärkende Schleife: gut bewertet -> wird
//         nachgeahmt -> wird wieder generiert -> wird wieder gut bewertet.
//   Fünf Gegenmaßnahmen (alle ohne DB-Änderung):
//     1. ÄHNLICHKEITS-FILTER IM CODE. Jeder Vorschlag wird gegen den Verlauf
//        UND gegen die anderen Vorschläge derselben Runde geprüft (Wort- und
//        Bigramm-Jaccard auf normalisiertem Text). Zu ähnlich = raus.
//     2. LÄNGERES GEDÄCHTNIS. Sperrbasis sind jetzt 21 Tage statt 48 h, über
//        ALLE Anlässe des Models, plus die dauerhafte `message_library`.
//        Das kostet keine Prompt-Tokens — die volle Liste prüft nur der Code.
//        Der Cleanup löscht deshalb erst nach 21 statt nach 7 Tagen.
//     3. STOFF-WÜRFEL. Jeder Vorschlag bekommt einen zufällig gezogenen Anker
//        (was sie gerade tut / hört / riecht / gleich vorhat …). Damit ist der
//        Prompt bei jedem Klick ein anderer und der Ideenraum wandert.
//     4. KEINE WÖRTLICHEN BEISPIELE mehr in den Sorten-Beschreibungen.
//     5. STIL-VORLAGEN ROTIEREN. Aus den Top 20 der Bibliothek werden je Aufruf
//        3 zufällig gezogen statt immer dieselben 6 — bricht die Schleife.
//   Außerdem: es werden count+3 Vorschläge angefordert, damit nach dem Filtern
//   noch genug übrig bleibt. Verworfene werden gezählt und zurückgemeldet.
//
// v4.40.0 – DIE ANTI-WIEDERHOLUNG HAT DAS FALSCHE GELÖSCHT. Messung 29.08.2026
//   (SQL: sql/analyse-massennachrichten.sql, Abfrage 9) über 10 Models:
//     * Auf den Verbotslisten von motive() standen die SIGNATUR-Wörter der
//       Models — zocken/setup (Elina), strand/sonne (Chiara), pole/nagel (Fari),
//       werkstatt (Julia), tanzen (Leoni), trainieren (Lina) — und bei Ursi
//       sogar ihre Dialekt-Marker isch/bisch/machsch.
//     * Bei ALLEN zehn Models war das Tageszeit-Vokabular gesperrt: kaffee 10x,
//       wach 7x, bett 4x, dazu morgen/morgens.
//     Grund: 3 Treffer in bis zu 400 Zeilen (0,75 %) reichten für eine Sperre.
//     Was ein Model ausmacht, wiederholt sich naturgemäß und flog zuerst raus.
//     Übrig blieb bei allen 15 Models dieselbe farblose Schnittmenge — genau
//     die Beschwerde der Chatter ("bei jedem Model dasselbe", "Früh/Spät/Nacht
//     macht keinen Unterschied").
//   Gegenmaßnahmen:
//     1. SCHUTZLISTE. Steckbrief (Beschreibung, Tags, Extra, Beispiele, Dialekt)
//        und ein festes Tageszeit-Vokabular werden NIE gesperrt. Schwelle jetzt
//        relativ (Wort in ~20 % der Nachrichten), Zählfenster 7 statt 21 Tage.
//        Die Duplikat-Sperre bleibt bei 21 Tagen — die war nie das Problem.
//     2. SATZFORMELN HART BEGRENZT. Ganz oben auf jeder Liste standen keine
//        Themen, sondern Bauteile: "lieber" (Elina 198x, Sandra 190x, Chiara
//        142x), "wette", "traust", "sitz" — die immer gleichen drei Formeln aus
//        dem Pflicht-Mix. "lieber" stand längst auf der Verbotsliste und kam
//        trotzdem 198x: bei strukturellen Wörtern wirkt eine Prompt-Bitte NICHT.
//        Deshalb derselbe Weg wie bei der Länge: Prüfung im Code + Nachforderung.
//     3. SCHICHT VERANKERT. Eigene Anker-Pools je Schicht (jeder zweite Vorschlag
//        bekommt einen), Tageszeit-Block direkt VOR die Längenregel gezogen
//        (zuletzt Gelesenes wiegt schwerer), echte Berliner Uhrzeit statt nur
//        Label, und "vorschicht" wird endlich erkannt statt als "unbestimmte
//        Tageszeit" zu landen.
//
// Nötige Secrets: ANTHROPIC_API_KEY  (optional: ANTHROPIC_MODEL)
// ⚠ ANTHROPIC_MODEL muss claude-haiku-4-5 bleiben. Test 2026-07-30: Sonnet lehnt
//   die Persona-Aufgabe ab und liefert bei allen Anlässen leere Antworten.
// Vorhanden von Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
// Modell per Env überschreibbar — aber bei Haiku bleiben (siehe Kopf).
const ANTHROPIC_MODEL = Deno.env.get('ANTHROPIC_MODEL') || 'claude-haiku-4-5'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// --- Helfer: Schicht-Label + Berliner Zeitstempel (Wochentag + HH:MM) ---
function shiftLabel(s: string | null | undefined): string {
  return s === 'vorschicht' ? 'Vorschicht'
    : s === 'frueh' ? 'Frühschicht'
    : s === 'spaet' ? 'Spätschicht'
    : s === 'nacht' ? 'Nachtschicht' : '—'
}
function berlinStamp(iso: string): string {
  try {
    const d = new Date(iso)
    const wd = d.toLocaleDateString('de-DE', { weekday: 'short', timeZone: 'Europe/Berlin' })
    const hm = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
    return `${wd} ${hm}`
  } catch { return '?' }
}

// Zählt echte Wörter: alles, was mindestens einen Buchstaben oder eine Ziffer
// enthält. Alleinstehende Emojis zählen damit nicht mit — sonst würde ein Model
// mit vielen Emojis künstlich als "zu lang" gelten.
function wortAnzahl(text: string): number {
  return String(text || '').trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

// ---------------------------------------------------------------------------
// v4.32.0 – Ähnlichkeit zweier Nachrichten messen
// ---------------------------------------------------------------------------
// Normalisiert wird hart: klein, Umlaute aufgelöst, Emojis und Satzzeichen weg.
// "Bist du da? 🙈" und "bist du noch da!!" sollen als dasselbe gelten — genau
// solche Varianten sind es, die den Chattern als Wiederholung auffallen.
function normalisiere(t: string): string {
  return String(t || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim()
}
function bigramme(w: string[]): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < w.length - 1; i++) out.add(`${w[i]} ${w[i + 1]}`)
  return out
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let schnitt = 0
  for (const x of a) if (b.has(x)) schnitt++
  return schnitt / (a.size + b.size - schnitt)
}
type Fp = { norm: string; woerter: Set<string>; bi: Set<string> }
function fingerprint(t: string): Fp {
  const w = normalisiere(t).split(' ').filter(Boolean)
  return { norm: w.join(' '), woerter: new Set(w), bi: bigramme(w) }
}
// Wort-Jaccard fängt umgestellte Sätze, Bigramm-Jaccard fängt gleiche Wendungen.
// Das Maximum von beiden ist streng genug, ohne bei kurzen Zeilen alles zu killen.
function aehnlichkeit(a: Fp, b: Fp): number {
  if (!a.norm || !b.norm) return 0
  if (a.norm === b.norm) return 1
  return Math.max(jaccard(a.woerter, b.woerter), jaccard(a.bi, b.bi))
}

// Schwellen. Absichtlich niedrig: Was einem Chatter als Wiederholung auffällt,
// ist selten wortgleich — meist derselbe Satz mit zwei getauschten Wörtern.
// Gegen die Stil-Bibliothek etwas lockerer, die soll den Ton ja prägen dürfen.
// Wer nachjustieren will: höher = mehr Karten, aber wieder mehr Ähnlichkeit.
const SCHWELLE_VERLAUF = 0.45
const SCHWELLE_BIBLIOTHEK = 0.55
const SCHWELLE_RUNDE = 0.45

// v4.32.0 – ABGENUTZTE MOTIVE.
// Der Ähnlichkeits-Filter erwischt nahe Formulierungen, aber nicht die immer
// gleiche SZENE mit anderen Worten ("Chips auf der Couch" vs. "Chipstüte im
// Bett"). Dafür zählen wir die Inhaltswörter des Verlaufs: Was ständig
// auftaucht, wird dem Modell namentlich verboten.
const STOPP = new Set([
  'aber', 'auch', 'auf', 'aus', 'bei', 'bin', 'bist', 'dann', 'dass', 'dein', 'deine', 'deinen',
  'dich', 'die', 'der', 'das', 'dir', 'doch', 'ein', 'eine', 'einen', 'einfach', 'euch', 'fuer',
  'ganz', 'gar', 'gerade', 'grad', 'hab', 'habe', 'hast', 'hier', 'ich', 'immer', 'ist', 'jetzt',
  'kann', 'kannst', 'lust', 'mal', 'man', 'mein', 'meine', 'mich', 'mir', 'mit', 'nach', 'nicht',
  'noch', 'nur', 'oder', 'ohne', 'schon', 'sehr', 'sein', 'sich', 'sind', 'soll', 'ueber', 'und',
  'viel', 'vielleicht', 'vom', 'von', 'war', 'was', 'wenn', 'wie', 'will', 'wir', 'wird', 'wirklich',
  'wieder', 'wo', 'zu', 'zum', 'zur',
])
// v4.40.0 – SCHUTZLISTE 1: Tageszeit. Diese Wörter dürfen NIE gesperrt werden.
// Sie sind der einzige Weg, wie sich Früh, Spät und Nacht sprachlich überhaupt
// unterscheiden können. Vorher war "kaffee" bei allen zehn gemessenen Models
// verboten — und die Chatter haben zu Recht gemeldet, dass die Schicht keinen
// Unterschied macht.
const TAGESZEIT_SCHUTZ = new Set([
  'morgen', 'morgens', 'mittag', 'mittags', 'nachmittag', 'abend', 'abends', 'nacht', 'nachts',
  'heute', 'heut', 'gestern', 'frueh', 'frueher', 'spaet', 'spaeter', 'uhrzeit',
  'aufgewacht', 'aufgestanden', 'wach', 'muede', 'schlaf', 'schlafen', 'einschlafen',
  'ausschlafen', 'bett', 'decke', 'kissen', 'kaffee', 'fruehstueck', 'duschen', 'dusche',
  'feierabend', 'abendessen', 'mitternacht', 'sonne', 'sonnenaufgang', 'sonnenuntergang',
  'dunkel', 'dunkelheit', 'hell', 'licht', 'wecker', 'nachtschicht',
])

// v4.40.0 – SCHUTZLISTE 2: alles, was DIESES Model ausmacht. Ein Model muss über
// sein Thema reden dürfen — verboten ist die immer gleiche Szene, nicht das
// Thema. Ohne diese Liste wurde Elina "zocken" verboten und Ursi ihr Dialekt.
function schutzWoerter(persona: Record<string, unknown>): Set<string> {
  const roh = [
    String(persona.description || ''),
    String(persona.extra || ''),
    String(persona.dialekt || ''),
    ...(Array.isArray(persona.persona_tags) ? persona.persona_tags as string[] : []),
    ...(Array.isArray(persona.examples) ? persona.examples as string[] : []),
  ].join(' ')
  const out = new Set<string>(TAGESZEIT_SCHUTZ)
  for (const w of normalisiere(roh).split(' ')) if (w.length >= 4) out.add(w)
  return out
}

// v4.40.0: Schwelle RELATIV statt absolut. Vorher reichten 3 Treffer in bis zu
// 400 Zeilen — 0,75 % — für eine dauerhafte Sperre. Jetzt muss ein Wort in
// ungefähr jeder fünften Nachricht stehen, um als abgenutzt zu gelten.
// Stellschraube: MOTIV_ANTEIL runter = mehr Verbote (Vorsicht, siehe Kopf).
const MOTIV_ANTEIL = 0.2
function motive(texte: string[], schutz: Set<string>, max = 12): string[] {
  const zaehler = new Map<string, number>()
  for (const t of texte) {
    // pro Nachricht jedes Wort nur einmal zählen
    for (const w of new Set(normalisiere(t).split(' '))) {
      if (w.length < 4 || STOPP.has(w) || /^\d+$/.test(w)) continue
      if (schutz.has(w)) continue
      zaehler.set(w, (zaehler.get(w) || 0) + 1)
    }
  }
  const minTreffer = Math.max(4, Math.ceil(texte.length * MOTIV_ANTEIL))
  return [...zaehler.entries()]
    .filter(([, n]) => n >= minTreffer)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w)
}

// ---------------------------------------------------------------------------
// v4.40.0 – SATZFORMELN. Siehe Kopf: das sind die Wörter, die bei JEDEM Model
// ganz oben standen. Sie kommen nicht vom Model, sondern vom Pflicht-Mix.
// Geprüft wird gegen den normalisierten Text (klein, ohne Umlaute/Satzzeichen).
// Stellschraube: kommen zu wenige Karten an, max auf 2 setzen.
// ---------------------------------------------------------------------------
const FORMELN: { name: string; re: RegExp; max: number }[] = [
  { name: 'lieber/eher-Konstruktion', re: /\b(lieber|eher)\b/, max: 1 },
  { name: '"ich wette ..."', re: /\bwette[nst]?\b/, max: 1 },
  { name: '"traust du dich ..."', re: /\btrau(st|e|en)?\b/, max: 1 },
  { name: '"ich sitz(e) hier ..."', re: /\bsitz[et]?\b/, max: 1 },
]

function mische<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Wortspannen je Stufe. Vier Stufen pro Set, damit sich bei 8 Vorschlägen
// jede Spanne genau zweimal wiederholt.
const LAENGEN: Record<string, [number, number][]> = {
  kurz:   [[4, 6], [6, 8], [8, 10], [10, 12]],
  mittel: [[6, 10], [10, 14], [14, 18], [18, 22]],
  lang:   [[12, 18], [16, 22], [20, 26], [24, 30]],
}

// v4.32.0 – STOFF-WÜRFEL: woran die Nachricht hängen soll. Bewusst nur die ART
// des Ankers, kein Thema und kein Beispielsatz — sonst wird genau der kopiert.
const STOFF_ANKER = [
  'was sie in diesem Moment mit den Händen tut',
  'ein Detail, das sie gerade sieht (Raum, Fenster, Bildschirm)',
  'etwas, das sie gerade hört',
  'ein Geruch, Geschmack oder eine Temperatur',
  'ein Gedanke, der ihr eben durch den Kopf ging',
  'eine winzige Sache, die heute nervig war',
  'etwas, worauf sie sich freut',
  'was sie gleich als Nächstes vorhat',
  'eine kleine Entscheidung, bei der sie gerade schwankt',
  'etwas, das sie an ihm vermisst hat',
  'wie sie gerade angezogen ist oder aussieht',
  'eine Beobachtung zur Uhrzeit oder zum Wetter',
  'etwas, das sie eben heimlich gemacht hat',
  'etwas, das gerade läuft (Serie, Musik, Spiel)',
  'eine Erinnerung an etwas Früheres zwischen den beiden',
  'wie müde, wach oder aufgedreht sie gerade ist',
  'etwas, das sie eigentlich tun müsste, aber aufschiebt',
  'ein Ort in ihrer Wohnung, an dem sie gerade ist',
]

// v4.40.0 – SCHICHT-ANKER. Die 18 Anker oben sind tageszeit-blind; der Prompt
// sagt aber ausdrücklich, der Anker bestimme, WORAN die Nachricht hängt. Damit
// gewann der neutrale Anker jedes Mal gegen die eine Tageszeit-Zeile. Jeder
// ZWEITE Vorschlag bekommt deshalb jetzt einen Anker aus DIESER Schicht.
const ANKER_SCHICHT: Record<string, string[]> = {
  vorschicht: [
    'dass sie vor dem Wecker wach geworden ist',
    'wie still es um diese Uhrzeit draußen noch ist',
    'der erste Kaffee und das erste Licht des Tages',
    'dass sie kaum geschlafen hat und trotzdem schon auf ist',
    'wie warm es im Bett war, verglichen mit jetzt',
    'was sie sich für heute vorgenommen hat, bevor der Tag losgeht',
  ],
  frueh: [
    'wie ihr Morgen bis jetzt gelaufen ist',
    'ob sie richtig wach ist oder noch nicht ganz',
    'wie das Vormittagslicht in ihren Raum fällt',
    'etwas, das sie heute Morgen schon hinter sich gebracht hat',
    'worauf sie sich im Lauf des Tages freut',
    'was sie zum Frühstück hatte oder eben nicht',
  ],
  spaet: [
    'wie ihr Tag bis hierher war',
    'dass der Tag kippt und der Abend anfängt',
    'was sie heute Abend noch vorhat',
    'wie sie gerade runterkommt nach dem Tag',
    'was sie sich für den Abend angezogen oder gemacht hat',
    'dass es draußen dunkel wird',
  ],
  nacht: [
    'dass es längst zu spät ist und sie trotzdem wach ist',
    'wie sie im Dunkeln liegt und nicht müde wird',
    'was ihr nachts durch den Kopf geht und tagsüber nie',
    'wie leise und anders alles um diese Uhrzeit ist',
    'dass sie morgen früh raus muss und es ihr gerade egal ist',
    'etwas, das sie tagsüber nie schreiben würde',
  ],
}

// v4.40.0 – Tageszeit-Rahmen je Schicht. Die konkreten Schichtzeiten stehen im
// Dienstplan pro Model und Woche; hier bewusst nur grobe Fenster ("ungefähr"),
// damit nichts Falsches behauptet wird.
const SCHICHT_INFO: Record<string, { label: string; von: number; bis: number; text: string }> = {
  vorschicht: { label: 'Vorschicht', von: 4, bis: 8, text: 'früher Morgen, ungefähr 4 bis 8 Uhr. Die Welt ist noch nicht wach: dämmrig, still, der Tag hat noch nicht angefangen.' },
  frueh: { label: 'Frühschicht', von: 8, bis: 14, text: 'Vormittag, ungefähr 8 bis 14 Uhr. Der Tag läuft gerade an: aufstehen, wach werden, die ersten Erledigungen, das meiste liegt noch vor ihr.' },
  spaet: { label: 'Spätschicht', von: 14, bis: 22, text: 'Nachmittag und Abend, ungefähr 14 bis 22 Uhr. Der Tag ist gelaufen oder läuft aus: Feierabend, Essen, Runterkommen, draußen wird es dunkel.' },
  nacht: { label: 'Nachtschicht', von: 22, bis: 6, text: 'tiefe Nacht, ungefähr 22 bis 6 Uhr. Alle anderen schlafen: dunkel, leise, wach obwohl man längst schlafen sollte, Gedanken die es tagsüber nicht gibt.' },
}

// Echte Berliner Uhrzeit. Wird nur dann in den Prompt geschrieben, wenn sie zur
// gewählten Schicht passt — im Panel steht die Schicht aus dem Dienstplan, und
// die muss nicht die gerade laufende sein.
function berlinJetzt(): { stunde: number; wochentag: string; hhmm: string } {
  const d = new Date()
  const wochentag = d.toLocaleDateString('de-DE', { weekday: 'long', timeZone: 'Europe/Berlin' })
  const hhmm = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
  // Stunde aus hhmm lesen. Intl.format() mit hour:'2-digit' liefert bei de-DE
  // "06 Uhr" — Number() darauf ergibt NaN. Beim Testen aufgefallen.
  const stunde = Number(hhmm.slice(0, 2))
  return { stunde: Number.isFinite(stunde) ? stunde : -1, wochentag, hhmm }
}

// Sorten OHNE wörtliche Beispiele (v4.32.0). Je Sorte drei Formulierungen,
// zufällig gezogen — auch das hält den Prompt in Bewegung.
const SORTEN: string[][] = [
  [
    'echte Einzelfrage: neugierig und konkret, eine einzige Frage',
    'echte Einzelfrage: fragt nach etwas Bestimmtem aus seinem Tag, nicht allgemein',
    'echte Einzelfrage: kurz, direkt, mit echtem Interesse an einer Sache',
  ],
  [
    'Entweder-oder MIT Inhalt: zwei konkrete Möglichkeiten zur Wahl, beide greifbar',
    'Entweder-oder MIT Inhalt: sie stellt zwei echte Alternativen gegenüber, keine Leerformel',
    'Entweder-oder MIT Inhalt: eine Wahl, bei der beide Seiten Bilder im Kopf machen',
  ],
  [
    'geteilter Moment / Aussage ohne Fragezeichen, die zum Reagieren einlädt',
    'geteilter Moment: sie erzählt etwas Kleines aus ihrem Jetzt, ohne zu fragen',
    'geteilter Moment: eine Feststellung über ihre Lage gerade, Fragezeichen verboten',
  ],
  [
    'spielerisch / neckisch: kleiner Tease',
    'spielerisch / neckisch: eine Mini-Herausforderung an ihn',
    'spielerisch / neckisch: eine freche Unterstellung mit Augenzwinkern',
  ],
]

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    // --- Auth-Gate ---
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) return json({ ok: false, error: 'Nicht eingeloggt' }, 401)
    const auth = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
    const { data: u, error: authErr } = await auth.auth.getUser(token)
    if (authErr || !u?.user) return json({ ok: false, error: 'Nicht autorisiert' }, 401)

    const body = await req.json().catch(() => ({}))
    const model = String(body.model || '').trim()
    const occasion = String(body.occasion || '').trim()
    const shift = String(body.shift || '').trim()   // frueh | spaet | nacht
    const chatter = String(body.chatter || '').trim()
    const language = String(body.language || 'Deutsch').trim()
    if (!model || !occasion) return json({ ok: false, error: 'model/occasion fehlt' }, 400)

    // --- Steckbrief laden (Pflicht) ---
    const { data: persona } = await db.from('model_personas').select('*').eq('model_name', model).maybeSingle()
    if (!persona || persona.active === false) {
      return json({ ok: false, error: `Für ${model} ist noch kein Steckbrief eingerichtet.` }, 409)
    }
    const count = Math.min(Math.max(Number(body.count || persona.anzahl || 8), 1), 12)
    // v4.32.0: bewusst mehr anfordern, als angezeigt wird — der Ähnlichkeits-
    // Filter wirft welche raus, und niemand soll dann vor drei Karten sitzen.
    const holen = Math.min(count + 3, 15)
    const stufe = persona.laenge === 'lang' ? 'lang' : persona.laenge === 'mittel' ? 'mittel' : 'kurz'
    const spannen = LAENGEN[stufe]
    // Obergrenze mit kleiner Toleranz — ein Wort drüber ist kein Drama, drei schon.
    const hartesMax = Math.max(...spannen.map((b) => b[1])) + 2

    // --- Anlass ---
    const { data: occ } = await db.from('message_occasions').select('*').eq('key', occasion).maybeSingle()
    const occLabel = occ?.label || occasion
    const guardrail = occ?.guardrail || ''

    // --- Globale Grundregeln (gelten für ALLE Models) ---
    const { data: settings } = await db.from('suggestion_settings').select('global_rules').eq('id', 1).maybeSingle()
    const globalRules = settings?.global_rules || ''

    // --- STIL-Vorlagen: nur Stimme/Ton, und ab v4.32.0 ROTIEREND ---
    // Vorher: immer die Top 6 nach Daumen hoch -> immer dieselbe Vorlage ->
    // immer dieselben Nachrichten. Jetzt: aus den Top 20 je Aufruf 3 gewürfelt,
    // dazu 3 gewürfelte Steckbrief-Beispiele.
    const { data: lib } = await db.from('message_library')
      .select('text, up, down').eq('model_name', model).eq('occasion', occasion)
      .order('up', { ascending: false }).limit(20)
    const goodOnes = (lib || []).filter((r) => (r.up || 0) > (r.down || 0)).map((r) => r.text)
    const examples = [...new Set([
      ...mische(persona.examples || []).slice(0, 3),
      ...mische(goodOnes).slice(0, 3),
    ])].slice(0, 6)

    // --- SPERRBASIS (v4.32.0): 21 Tage, ALLE Anlässe dieses Models ---
    // Der Prompt bekommt nur einen kompakten Auszug (Tokens!), der Code prüft
    // gegen die volle Liste. Anlassfremde Texte zählen mit: "immer dieselbe
    // Szene" passiert quer über die Anlässe.
    const since21 = new Date(Date.now() - 21 * 24 * 3600 * 1000).toISOString()
    const { data: recentRows } = await db.from('message_suggestions')
      .select('text, occasion, shift, created_at, used')
      .eq('model_name', model)
      .gte('created_at', since21)
      .order('created_at', { ascending: false }).limit(400)

    const gesehen = new Set<string>()
    const sperre: { fp: Fp; schwelle: number }[] = []
    const promptListe: string[] = []
    // v4.40.0: Die DUPLIKAT-Sperre bleibt bei 21 Tagen (die war nie das Problem),
    // die MOTIV-Zählung schaut nur noch 7 Tage zurück. Sonst schleppt ein Model
    // seine eigenen Themen drei Wochen lang als Verbot mit sich herum.
    const grenze7 = Date.now() - 7 * 24 * 3600 * 1000
    const texte7: string[] = []
    for (const r of recentRows || []) {
      if (r.text && new Date(r.created_at).getTime() >= grenze7) texte7.push(r.text)
      const fp = fingerprint(r.text || '')
      if (!fp.norm || gesehen.has(fp.norm)) continue
      gesehen.add(fp.norm)
      sperre.push({ fp, schwelle: SCHWELLE_VERLAUF })
      // In den Prompt kommen nur die jüngsten Treffer des AKTUELLEN Anlasses,
      // gekappt auf 25 Zeilen — mehr liest das Modell ohnehin nicht mit.
      if (r.occasion === occasion && promptListe.length < 25) {
        promptListe.push(`- [${berlinStamp(r.created_at)} · ${shiftLabel(r.shift)}${r.used ? ' · ✓ verschickt' : ''}] ${r.text}`)
      }
    }
    // Die Bibliothek überlebt den Cleanup — sie ist das eigentliche Langzeit-
    // gedächtnis. Ihre Texte dürfen den Ton prägen, aber nicht 1:1 zurückkommen.
    const { data: libAll } = await db.from('message_library')
      .select('text').eq('model_name', model).limit(200)
    for (const r of libAll || []) {
      const fp = fingerprint(r.text || '')
      if (!fp.norm || gesehen.has(fp.norm)) continue
      gesehen.add(fp.norm)
      sperre.push({ fp, schwelle: SCHWELLE_BIBLIOTHEK })
    }
    // Auch die Steckbrief-Beispiele sind Vorlagen für den TON, kein Textbaustein
    // zum Zurückgeben — sonst schickt der Chatter dem Fan den Beispielsatz.
    for (const t of persona.examples || []) {
      const fp = fingerprint(t || '')
      if (!fp.norm || gesehen.has(fp.norm)) continue
      gesehen.add(fp.norm)
      sperre.push({ fp, schwelle: SCHWELLE_BIBLIOTHEK })
    }
    const abgenutzt = motive(texte7, schutzWoerter(persona))

    // --- PFLICHT-MIX: Sorte, Wortspanne UND Stoff-Anker je Vorschlag ---
    // Der Versatz sorgt dafür, dass nicht immer dieselbe Sorte dieselbe Länge
    // bekommt (sonst wäre "Einzelfrage" für immer die kürzeste).
    // v4.40.0: "vorschicht" wird jetzt erkannt — vorher landete sie über den
    // Standardzweig bei "unbestimmte Tageszeit", obwohl das Frontend den Wert
    // sauber mitschickt.
    const schichtKey = SCHICHT_INFO[shift] ? shift : ''
    const ankerNeutral = mische(STOFF_ANKER)
    const ankerSchicht = mische(ANKER_SCHICHT[schichtKey] || [])
    const slots = Array.from({ length: holen }, (_, i) => ({
      nr: i + 1,
      kat: SORTEN[i % SORTEN.length][Math.floor(Math.random() * SORTEN[i % SORTEN.length].length)],
      spanne: spannen[(i + Math.floor(i / SORTEN.length)) % spannen.length],
      // Jeder zweite Slot bekommt einen Anker aus der Schicht. Ohne Schicht
      // (unbekannter Wert) bleibt es beim neutralen Pool wie bisher.
      anker: (i % 2 === 0 && ankerSchicht.length)
        ? ankerSchicht[Math.floor(i / 2) % ankerSchicht.length]
        : ankerNeutral[i % ankerNeutral.length],
    }))
    const mixLines = slots
      .map((sl) => `${sl.nr}. ${sl.spanne[0]}–${sl.spanne[1]} Wörter · ${sl.kat} · Anker: ${sl.anker}`)
      .join('\n')

    // --- Prompt bauen ---
    const info = SCHICHT_INFO[schichtKey]
    const jetzt = berlinJetzt()
    // Uhrzeit nur nennen, wenn sie im Fenster der gewählten Schicht liegt —
    // sonst behauptet der Prompt "es ist 14 Uhr" in einer Nachtschicht.
    const uhrzeitPasst = info
      ? (info.von < info.bis
          ? (jetzt.stunde >= info.von && jetzt.stunde < info.bis)
          : (jetzt.stunde >= info.von || jetzt.stunde < info.bis))
      : false
    const shiftText = info
      ? `${info.label}: ${info.text}${uhrzeitPasst ? ` Es ist gerade ${jetzt.wochentag}, ${jetzt.hhmm} Uhr.` : ''}`
      : 'unbestimmte Tageszeit'

    const system = [
      `Du bist NICHT ein Chatbot und schreibst NICHT wie einer. Du bist "${model}" – ein echter Mensch, der jemandem, den sie mag (ein zahlender Fan auf einer Creator-Plattform), spontan aufs Handy tippt.`,
      globalRules ? `GRUNDREGELN (gelten immer, für alle Models – unbedingt befolgen): ${globalRules}` : '',

      `GOLDENE REGEL – Verankerung: Jede Nachricht steckt in etwas KONKRETEM – was sie GERADE macht, ein echter Gedanke, ein Detail aus ihrem Tag, eine Mini-Szene. Nichts Austauschbares. Wenn man die Nachricht wortgleich an eine beliebige andere Person schicken könnte, ist sie falsch.`,

      `EINFACH IST GUT: Kurze, natürliche Zeilen sind völlig okay – so tippt ein echter Mensch. Der Fehler ist NICHT kurz/simpel, sondern BEMÜHT-clever.`,

      `VERBOTEN (klingt sofort nach Bot – NIE verwenden): aufgesetzte Themen-Gags oder Meta-Sprüche, die cool sein wollen ("bist du im AFK-Modus?", "lädt dein Akku noch?", gezwungene Gaming-/Tech-Wortspiele als Gimmick); Umfrage-/Callcenter-Ton; "Ich wollte nur mal...", "Ich hoffe es geht dir gut"; Marketing-Sprech; alles Generische, das nicht zu DIESEM Model und DIESEM Moment passt.`,

      `GESPRÄCHSOPENER richtig gedacht: Ziel ist, dass der Fan ANTWORTEN WILL – durch echten INHALT, nicht durch eine mechanische Frage. Erzähl kurz etwas Konkretes und lass daraus natürlich Raum für eine Antwort.`,

      `PFLICHT-LISTE der ${holen} Vorschläge – Nummer für Nummer, Reihenfolge, Wortzahl und Anker GENAU einhalten:\n${mixLines}`,

      // v4.32.0 – zentral: der Anker ist der Hebel gegen "immer dieselbe Szene".
      `ZU DEN ANKERN: Der Anker sagt, WORAN die Nachricht hängt – nicht, worüber sie redet. Bau ihn konkret aus, mit einem Detail, das nur zu diesem Moment passt. Zwei Nachrichten dürfen NICHT dieselbe Szene oder dasselbe Bild benutzen. Die Sorten-Beschreibungen oben sind Formvorgaben, KEINE Textvorlagen – übernimm daraus keine Formulierung.`,

      // v4.40.0: Damit das Modell die Chance hat, den Code-Filter gar nicht erst
      // auszulösen. Der Filter bleibt trotzdem — die Bitte allein hat nachweislich
      // nicht gewirkt (Elina: "lieber" 198x trotz Verbotsliste).
      `ABGENUTZTE SATZFORMELN – jedes dieser Muster darf HÖCHSTENS EINMAL in der ganzen Liste vorkommen, egal welche Sorte: "lieber X oder eher Y", "ich wette, du …", "traust du dich …", "ich sitz(e) hier …". Ein Entweder-oder geht auch ohne "lieber" und ohne "eher". Die übrigen Nachrichten bauen anders.`,

      `Beschreibung von "${model}": ${persona.description || '—'}`,
      persona.persona_tags?.length ? `Charakter: ${persona.persona_tags.join(', ')}. Nutze diese Details als echten STOFF für konkrete Nachrichten (z.B. bei einer Gamerin eine konkrete Szene im Match), nicht nur als Etikett.` : '',
      `Anrede: ${persona.anrede === 'sie' ? 'Sie' : 'Du'}. Sprache/Dialekt: ${persona.dialekt}. Emoji-Menge: ${persona.emoji}. Direktheit: ${persona.direktheit}.`,
      `Kein Gelaber, keine Aufzählungen, keine Einleitung.`,
      persona.nogos?.length ? `Absolute No-Gos (niemals): ${persona.nogos.join('; ')}.` : '',
      persona.emojis?.length ? `Erlaubte Emojis – verwende AUSSCHLIESSLICH diese, KEINE anderen: ${persona.emojis.join(' ')}` : '',
      `Anlass: ${occLabel}. ${guardrail}`,
      `Schreibe die Nachrichten auf ${language}. Kein Klarname, keine echten Treffen, keine Links.`,
      language !== 'Deutsch' ? `Hinweis: Die Dialekt-Einstellung ist deutschspezifisch. In ${language} den Charakter und Ton des Models beibehalten, aber natürlich und muttersprachlich in ${language} schreiben (kein deutscher Dialekt).` : '',
      persona.extra ? `WICHTIGE Extra-Anweisungen (unbedingt befolgen): ${persona.extra}` : '',

      examples.length ? `So KLINGT "${model}" (nur die STIMME/den Ton nachahmen – Inhalt, Szene und Wortwahl NICHT übernehmen):\n- ${examples.join('\n- ')}` : '',

      promptListe.length ? `ZULETZT GESCHICKT – Wortlaut UND Muster NICHT wiederholen, auch nicht in einer anderen Schicht und nicht leicht umformuliert:\n${promptListe.join('\n')}` : '',

      abgenutzt.length ? `ABGENUTZTE MOTIVE – diese Wörter und die Szenen dahinter kamen in den letzten Wochen zu oft vor. Vermeide sie in ALLEN Vorschlägen und such dir andere Bilder: ${abgenutzt.join(', ')}.` : '',

      `SELBSTCHECK vor der Ausgabe: Lies jede Nachricht und frag dich – "Würde ein echter Mensch das so tippen, oder klingt das nach Bot/Umfrage?" Und: "Steht so etwas oben schon in der Liste?" Wenn ja: neu schreiben, mit anderem Bild.`,

      // v4.40.0: Die Tageszeit stand vorher als eine schwache Zeile in der Mitte,
      // vor Selbstcheck und Längenregel — und ging dort unter. Jetzt steht sie
      // direkt vor der Längenregel, nach derselben Logik: was zuletzt gelesen
      // wird, wiegt schwerer.
      `TAGESZEIT – gilt für JEDE Nachricht: ${shiftText} Die Vorschläge müssen erkennbar aus DIESER Tageszeit kommen: was sie jetzt gerade tut, wie wach oder müde sie ist, was eben vorbei ist und was noch kommt. Eine Nachricht, die man genauso gut um 4 Uhr morgens wie um 20 Uhr abends schicken könnte, ist falsch — schreib sie neu. Mindestens die Hälfte der Vorschläge muss einen klaren Bezug zu dieser Tageszeit haben.`,

      // Bewusst als LETZTE Regel vor der Ausgabe-Anweisung: Alles davor drängt zu
      // mehr Inhalt ("konkrete Mini-Szene"), und genau daran ist die Länge bisher
      // gescheitert. Zuletzt Gelesenes wiegt schwerer.
      `LÄNGE – die wichtigste Regel, sie schlägt alle anderen: Zähle bei JEDER Nachricht die Wörter und halte die Spanne aus der Pflicht-Liste ein. Emojis zählen nicht mit. Lieber ein Wort zu wenig als eines zu viel. Passt eine Idee nicht in die Wortzahl, nimm eine kleinere Idee — kürze NICHT den Sinn weg.`,

      `Antworte AUSSCHLIESSLICH als JSON: {"messages":["...","..."]} mit genau ${holen} unterschiedlichen Nachrichten (in der Reihenfolge des Pflicht-Mix). Kein weiterer Text.`,
    ].filter(Boolean).join('\n')

    // --- Anthropic ---
    const frageKI = async (userText: string): Promise<string[] | { fehler: string }> => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: 1500,
          temperature: 1,
          system,
          messages: [{ role: 'user', content: userText }],
        }),
      })
      if (!res.ok) {
        const t = await res.text()
        return { fehler: `Anthropic-Fehler ${res.status}: ${t.slice(0, 300)}` }
      }
      const j = await res.json()
      const raw = j?.content?.[0]?.text || ''
      let out: string[] = []
      try {
        const m = raw.match(/\{[\s\S]*\}/)
        out = JSON.parse(m ? m[0] : raw).messages || []
      } catch {
        // Fallback: Zeilen extrahieren
        out = raw.split('\n').map((l: string) => l.replace(/^[-*\d.\s"]+/, '').replace(/"$/, '').trim()).filter(Boolean)
      }
      return out.filter((x) => typeof x === 'string' && x.trim().length > 0)
    }

    // v4.32.0: Variations-Nummer im User-Turn. Zwei Klicks hintereinander sollen
    // nicht denselben Text-Input haben — sonst liefert das Modell gern dasselbe.
    const variation = Math.floor(Math.random() * 100000)
    const ersteRunde = await frageKI(
      `Gib mir ${holen} Vorschläge für "${occLabel}". Halte die Pflicht-Liste samt Wortzahlen und Ankern ein. ` +
      `Wiederhole nichts aus der Liste "ZULETZT GESCHICKT" – auch nicht sinngemäß. ` +
      `Variations-Nr. ${variation}: nimm bewusst andere Bilder und Szenen als naheliegend wären.`,
    )
    if (!Array.isArray(ersteRunde)) return json({ ok: false, error: ersteRunde.fehler }, 502)
    const messages = ersteRunde.slice(0, holen)
    if (messages.length === 0) return json({ ok: false, error: 'Keine Vorschläge erhalten' }, 502)

    // --- Prüfung: Länge UND Wiederholung in einem Durchgang ---
    // Ein Vorschlag fällt durch, wenn er zu lang ist, dem Verlauf zu ähnlich
    // sieht oder einem bereits akzeptierten Vorschlag derselben Runde gleicht.
    // v4.40.0 – Zähler für die Satzformeln. Gezählt wird nur, was ANGENOMMEN
    // wurde; ein abgelehnter Vorschlag verbraucht das Kontingent nicht.
    const formelZaehler = new Map<string, number>()
    const merkeFormeln = (text: string) => {
      const norm = normalisiere(text)
      for (const f of FORMELN) if (f.re.test(norm)) formelZaehler.set(f.name, (formelZaehler.get(f.name) || 0) + 1)
    }

    const pruefe = (text: string, i: number, bisher: Fp[]): string | null => {
      const w = wortAnzahl(text)
      const sp = slots[i]?.spanne
      if (sp && w > sp[1] + 1) return `zu lang (${w} Wörter statt ${sp[0]}–${sp[1]})`
      const fp = fingerprint(text)
      if (!fp.norm) return 'leer'
      // v4.40.0: Satzformeln. Bewusst VOR der Ähnlichkeitsprüfung — "lieber X
      // oder eher Y" ist jedes Mal ein anderer Satz und fällt der Ähnlichkeit
      // deshalb nie auf, ist für den Chatter aber genau die Wiederholung.
      for (const f of FORMELN) {
        if (f.re.test(fp.norm) && (formelZaehler.get(f.name) || 0) >= f.max) {
          return `abgenutzte Satzformel (${f.name}) – steht in dieser Runde schon`
        }
      }
      for (const s of sperre) {
        if (aehnlichkeit(fp, s.fp) >= s.schwelle) return 'zu ähnlich zu einer Nachricht, die es schon gab'
      }
      for (const b of bisher) {
        if (aehnlichkeit(fp, b) >= SCHWELLE_RUNDE) return 'zu ähnlich zu einem anderen Vorschlag dieser Runde'
      }
      return null
    }

    const okFps: Fp[] = []
    const behalten = new Map<number, string>()   // Slot-Index -> Text
    const problem: { i: number; text: string; grund: string }[] = []
    messages.forEach((t, i) => {
      const grund = pruefe(t, i, okFps)
      if (grund) { problem.push({ i, text: t, grund }); return }
      behalten.set(i, t)
      okFps.push(fingerprint(t))
      merkeFormeln(t)
    })

    // --- Eine Nachforderung für alles, was durchgefallen ist ---
    if (problem.length > 0 && behalten.size < count) {
      const auftrag = problem.map((p) => {
        const sl = slots[p.i]
        return `${p.i + 1}. ${sl.spanne[0]}–${sl.spanne[1]} Wörter · ${sl.kat} · Anker: ${sl.anker}\n   Abgelehnt (${p.grund}): ${p.text}`
      }).join('\n')
      const stehen = [...behalten.values()]
      const nach = await frageKI(
        `Diese ${problem.length} Vorschläge wurden abgelehnt. Schreib GENAU ${problem.length} neue, ` +
        `in derselben Reihenfolge, jeder in seiner Wortspanne und mit seinem Anker — zähl die Wörter nach. ` +
        `Bei "zu ähnlich": nimm ein komplett ANDERES Bild, nicht dieselbe Szene mit anderen Worten. ` +
        `Bei "abgenutzte Satzformel": bau den Satz komplett anders und verwende das genannte Muster NICHT.\n\n${auftrag}\n\n` +
        (stehen.length ? `Diese bleiben stehen, nicht wiederholen:\n- ${stehen.join('\n- ')}\n\n` : '') +
        `Antworte als JSON: {"messages":[...]} mit genau ${problem.length} Nachrichten.`,
      )
      if (Array.isArray(nach)) {
        problem.forEach((p, n) => {
          const neu = nach[n]
          if (!neu) return
          const grund = pruefe(neu, p.i, okFps)
          if (grund) return              // zweiter Versuch daneben -> fällt raus
          behalten.set(p.i, neu)
          okFps.push(fingerprint(neu))
          merkeFormeln(neu)
        })
      }
    }

    // Reihenfolge des Pflicht-Mix wiederherstellen und auf count kürzen.
    let final = [...behalten.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]).slice(0, count)

    const verworfen = Math.max(0, Math.min(messages.length, count) - final.length)
    if (final.length === 0) {
      // Nie mit leeren Händen dastehen: dann doch die kürzesten drei durchlassen,
      // die wenigstens nicht wortgleich zueinander sind.
      const gesehenNot = new Set<string>()
      final = [...messages]
        .sort((a, b) => wortAnzahl(a) - wortAnzahl(b))
        .filter((t) => {
          const n = normalisiere(t)
          if (!n || gesehenNot.has(n)) return false
          gesehenNot.add(n); return true
        })
        .filter((t) => wortAnzahl(t) <= hartesMax)
        .slice(0, 3)
      if (final.length === 0) final = messages.slice(0, 3)
      console.log(`generate-messages: Notfall-Fallback (${model} / ${occasion}) – alle Vorschläge durchgefallen`)
    }
    if (verworfen > 0) {
      console.log(`generate-messages: ${verworfen} Vorschlag/Vorschläge verworfen (${model} / ${occasion} / Stufe ${stufe}) – Gründe: ${problem.map((p) => p.grund).join(' | ')}`)
    }

    // --- Speichern (mit Model/Anlass/Schicht/Chatter) ---
    const rows = final.map((text) => ({ model_name: model, occasion, shift: shift || null, chatter: chatter || null, text }))
    const { data: inserted } = await db.from('message_suggestions').insert(rows).select('id, text')

    // --- Opportunistischer Cleanup (kein Cron nötig) ---
    // v4.32.0: 21 statt 7 Tage. Diese Zeilen sind die Sperrbasis gegen
    // Wiederholung — je kürzer sie leben, desto schneller kommt alles zurück.
    const cutoff = new Date(Date.now() - 21 * 24 * 3600 * 1000).toISOString()
    await db.from('message_suggestions').delete().lt('created_at', cutoff)

    return json({ ok: true, model, occasion, shift, verworfen, suggestions: inserted || [] })
  } catch (err) {
    return json({ ok: false, error: `generate-messages: ${err}` }, 500)
  }
})
