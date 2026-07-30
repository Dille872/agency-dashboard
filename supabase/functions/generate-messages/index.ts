// supabase/functions/generate-messages/index.ts
// Erzeugt Nachrichten-Vorschläge für ein Model + Anlass + Schicht via Anthropic (Claude).
// - Auth-Gate: nur eingeloggte Dashboard-User.
// - Steckbrief-Pflicht: fehlt der Steckbrief oder ist er inaktiv -> keine Vorschläge.
//
// v4.3.0 – Menschlicher + frischer:
//   * Prompt komplett umgebaut: weg von Bauform-Regeln, hin zu "Verankerung" +
//     Anti-Bot-Verbotsliste (aufgesetzte Meta-Gags), einfache echte Zeilen erlaubt.
//   * FRISCHE: zuletzt (letzte 48h, ÜBER ALLE Schichten) verschickte Nachrichten
//     werden mit Schicht + Uhrzeit gelabelt als "NICHT wiederholen"-Liste übergeben.
//   * WICHTIGER FIX: zuletzt genommene Nachrichten galten bisher als Vorlage zum
//     Nachahmen (verstärkte Wiederholung) -> jetzt gehören sie in die Frische-Sperre.
//   * PFLICHT-MIX: die N Vorschläge werden in feste Sorten aufgeteilt
//     (Einzelfrage / Entweder-oder / geteilter Moment / neckisch), skaliert mit N.
//
// Nötige Secrets: ANTHROPIC_API_KEY  (optional: ANTHROPIC_MODEL, empfohlen: claude-sonnet-5)
// Vorhanden von Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
// Modell per Env überschreibbar. Für menschlich klingende DMs empfohlen: claude-sonnet-5
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
  return s === 'frueh' ? 'Frühschicht'
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
    const laengeHint = persona.laenge === 'lang'
      ? 'etwas ausführlicher (2 bis 3 kurze Sätze), aber nie ein Roman'
      : persona.laenge === 'mittel'
      ? 'kurz gehalten (1 bis 2 knappe Sätze)'
      : 'SEHR KURZ: nur EIN knapper Satz (ca. 6 bis 14 Wörter), wie eine echte, schnell getippte DM'

    // --- Anlass ---
    const { data: occ } = await db.from('message_occasions').select('*').eq('key', occasion).maybeSingle()
    const occLabel = occ?.label || occasion
    const guardrail = occ?.guardrail || ''

    // --- Globale Grundregeln (gelten für ALLE Models) ---
    const { data: settings } = await db.from('suggestion_settings').select('global_rules').eq('id', 1).maybeSingle()
    const globalRules = settings?.global_rules || ''

    // --- STIL-Vorlagen: nur Stimme/Ton (Persona-Beispiele + gut bewertete Bibliothek) ---
    const { data: lib } = await db.from('message_library')
      .select('text, up, down').eq('model_name', model).eq('occasion', occasion)
      .order('up', { ascending: false }).limit(6)
    const goodOnes = (lib || []).filter((r) => (r.up || 0) > (r.down || 0)).map((r) => r.text)
    const examples = [...new Set([...(persona.examples || []), ...goodOnes])].slice(0, 10)

    // --- FRISCHE: was ging in den letzten 48h raus? (über ALLE Schichten) ---
    // Wird als "NICHT wiederholen"-Liste mit Schicht + Uhrzeit übergeben. Zuletzt
    // GENOMMENE (used) Nachrichten sind hier ebenfalls drin -> keine Wiederholung.
    const since48 = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
    const { data: recentRows } = await db.from('message_suggestions')
      .select('text, shift, created_at, used')
      .eq('model_name', model).eq('occasion', occasion)
      .gte('created_at', since48)
      .order('created_at', { ascending: false }).limit(60)
    const seenTexts = new Set<string>()
    const freshList: string[] = []
    for (const r of recentRows || []) {
      const key = String(r.text || '').trim().toLowerCase()
      if (!key || seenTexts.has(key)) continue
      seenTexts.add(key)
      freshList.push(`- [${berlinStamp(r.created_at)} · ${shiftLabel(r.shift)}${r.used ? ' · ✓ verschickt' : ''}] ${r.text}`)
      if (freshList.length >= 30) break
    }

    // --- PFLICHT-MIX: N Vorschläge in feste Sorten aufteilen (skaliert mit N) ---
    const cats = [
      { n: 0, label: 'echte Einzelfrage (neugierig, konkret – z.B. "was hört sich dein tag heute an?")' },
      { n: 0, label: 'Entweder-oder MIT echtem Inhalt (nie leer wie "da oder AFK?" – z.B. "noch ne runde oder film mit dir?")' },
      { n: 0, label: 'geteilter Moment / Aussage, die zum Reagieren einlädt (ohne Fragezeichen – z.B. "sitz hier mit chips… fehlt nur du")' },
      { n: 0, label: 'spielerisch / neckisch (kleiner Tease oder Mini-Herausforderung)' },
    ]
    const base = Math.floor(count / cats.length)
    let rem = count % cats.length
    for (let i = 0; i < cats.length; i++) cats[i].n = base + (i < rem ? 1 : 0)
    const mixLines = cats.filter((c) => c.n > 0).map((c) => `- ${c.n}× ${c.label}`).join('\n')

    // --- Prompt bauen ---
    const shiftText = shift === 'frueh' ? 'Frühschicht (Vormittag)'
      : shift === 'spaet' ? 'Spätschicht (Nachmittag/Abend)'
      : shift === 'nacht' ? 'Nachtschicht (spät nachts)' : 'unbestimmte Tageszeit'

    const system = [
      `Du bist NICHT ein Chatbot und schreibst NICHT wie einer. Du bist "${model}" – ein echter Mensch, der jemandem, den sie mag (ein zahlender Fan auf einer Creator-Plattform), spontan aufs Handy tippt.`,
      globalRules ? `GRUNDREGELN (gelten immer, für alle Models – unbedingt befolgen): ${globalRules}` : '',

      `GOLDENE REGEL – Verankerung: Jede Nachricht steckt in etwas KONKRETEM – was sie GERADE macht, ein echter Gedanke, ein Detail aus ihrem Tag, eine Mini-Szene. Nichts Austauschbares. Wenn man die Nachricht wortgleich an eine beliebige andere Person schicken könnte, ist sie falsch.`,

      `EINFACH IST GUT: Kurze, natürliche Zeilen wie "Bist du da? 🙈" sind völlig okay – so tippt ein echter Mensch. Der Fehler ist NICHT kurz/simpel, sondern BEMÜHT-clever.`,

      `VERBOTEN (klingt sofort nach Bot – NIE verwenden): aufgesetzte Themen-Gags oder Meta-Sprüche, die cool sein wollen ("bist du im AFK-Modus?", "lädt dein Akku noch?", gezwungene Gaming-/Tech-Wortspiele als Gimmick); Umfrage-/Callcenter-Ton; "Ich wollte nur mal...", "Ich hoffe es geht dir gut"; Marketing-Sprech; alles Generische, das nicht zu DIESEM Model und DIESEM Moment passt.`,

      `GESPRÄCHSOPENER richtig gedacht: Ziel ist, dass der Fan ANTWORTEN WILL – durch echten INHALT, nicht durch eine mechanische Frage. Erzähl kurz etwas Konkretes und lass daraus natürlich Raum für eine Antwort.`,

      `PFLICHT-MIX der ${count} Vorschläge – halte diese Verteilung GENAU ein:\n${mixLines}`,

      `Beschreibung von "${model}": ${persona.description || '—'}`,
      persona.persona_tags?.length ? `Charakter: ${persona.persona_tags.join(', ')}. Nutze diese Details als echten STOFF für konkrete Nachrichten (z.B. bei einer Gamerin eine konkrete Szene im Match), nicht nur als Etikett.` : '',
      `Anrede: ${persona.anrede === 'sie' ? 'Sie' : 'Du'}. Sprache/Dialekt: ${persona.dialekt}. Emoji-Menge: ${persona.emoji}. Direktheit: ${persona.direktheit}.`,
      `Länge: ${laengeHint}. Halte jede Nachricht knapp und natürlich – lieber zu kurz als zu lang. Kein Gelaber, keine Aufzählungen.`,
      persona.nogos?.length ? `Absolute No-Gos (niemals): ${persona.nogos.join('; ')}.` : '',
      persona.emojis?.length ? `Erlaubte Emojis – verwende AUSSCHLIESSLICH diese, KEINE anderen: ${persona.emojis.join(' ')}` : '',
      `Anlass: ${occLabel}. ${guardrail}`,
      `Kontext: ${shiftText}. Passe die Nachricht an die Tageszeit an.`,
      `Schreibe die Nachrichten auf ${language}. Kein Klarname, keine echten Treffen, keine Links.`,
      language !== 'Deutsch' ? `Hinweis: Die Dialekt-Einstellung ist deutschspezifisch. In ${language} den Charakter und Ton des Models beibehalten, aber natürlich und muttersprachlich in ${language} schreiben (kein deutscher Dialekt).` : '',
      persona.extra ? `WICHTIGE Extra-Anweisungen (unbedingt befolgen): ${persona.extra}` : '',

      examples.length ? `So KLINGT "${model}" (nur die STIMME/den Ton nachahmen, Inhalt NICHT kopieren):\n- ${examples.join('\n- ')}` : '',

      freshList.length ? `ZULETZT GESCHICKT (letzte 48h, über ALLE Schichten) – Wortlaut UND Muster NICHT wiederholen, auch nicht in einer anderen Schicht. Wenn ein Opener heute früh schon dran war, benutz ihn heute nicht nochmal:\n${freshList.join('\n')}` : '',

      `SELBSTCHECK vor der Ausgabe: Lies jede Nachricht und frag dich – "Würde ein echter Mensch das so tippen, oder klingt das nach Bot/Umfrage?" Klingt es nach Bot: neu schreiben, konkreter und persönlicher.`,

      `Antworte AUSSCHLIESSLICH als JSON: {"messages":["...","..."]} mit genau ${count} unterschiedlichen Nachrichten (in der Reihenfolge des Pflicht-Mix). Kein weiterer Text.`,
    ].filter(Boolean).join('\n')

    // --- Anthropic ---
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        temperature: 1,
        system,
        messages: [{ role: 'user', content: `Gib mir ${count} Vorschläge für "${occLabel}". Halte den Pflicht-Mix ein und wiederhole nichts aus der 48h-Liste.` }],
      }),
    })
    if (!aiRes.ok) {
      const t = await aiRes.text()
      return json({ ok: false, error: `Anthropic-Fehler ${aiRes.status}: ${t.slice(0, 300)}` }, 502)
    }
    const aiJson = await aiRes.json()
    const raw = aiJson?.content?.[0]?.text || ''
    let messages: string[] = []
    try {
      const m = raw.match(/\{[\s\S]*\}/)
      messages = JSON.parse(m ? m[0] : raw).messages || []
    } catch {
      // Fallback: Zeilen extrahieren
      messages = raw.split('\n').map((l: string) => l.replace(/^[-*\d.\s"]+/, '').replace(/"$/, '').trim()).filter(Boolean)
    }
    messages = messages.filter((x) => typeof x === 'string' && x.trim().length > 0).slice(0, count)
    if (messages.length === 0) return json({ ok: false, error: 'Keine Vorschläge erhalten' }, 502)

    // --- Speichern (mit Model/Anlass/Schicht/Chatter) ---
    const rows = messages.map((text) => ({ model_name: model, occasion, shift: shift || null, chatter: chatter || null, text }))
    const { data: inserted } = await db.from('message_suggestions').insert(rows).select('id, text')

    // --- Opportunistischer 7-Tage-Cleanup (kein Cron nötig) ---
    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
    await db.from('message_suggestions').delete().lt('created_at', cutoff)

    return json({ ok: true, model, occasion, shift, suggestions: inserted || [] })
  } catch (err) {
    return json({ ok: false, error: `generate-messages: ${err}` }, 500)
  }
})
