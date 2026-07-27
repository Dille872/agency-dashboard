// supabase/functions/generate-messages/index.ts
// Erzeugt Nachrichten-Vorschläge für ein Model + Anlass + Schicht via Anthropic (Claude).
// - Auth-Gate: nur eingeloggte Dashboard-User.
// - Steckbrief-Pflicht: fehlt der Steckbrief oder ist er inaktiv -> keine Vorschläge.
// - Nutzt gut bewertete Bibliotheks-Nachrichten als Vorlage, meidet kürzlich Gezeigtes.
// - Speichert jeden Vorschlag (mit Model/Anlass/Schicht/Chatter) und räumt >7 Tage auf.
//
// Nötige Secrets: ANTHROPIC_API_KEY  (optional: ANTHROPIC_MODEL)
// Vorhanden von Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
// Aktuelles günstiges Modell (Stand 2026). Per Env ANTHROPIC_MODEL überschreibbar:
const ANTHROPIC_MODEL = Deno.env.get('ANTHROPIC_MODEL') || 'claude-haiku-4-5'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

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

    // --- Gut bewertete Vorlagen + kürzlich Gezeigtes (Anti-Wiederholung) ---
    const { data: lib } = await db.from('message_library')
      .select('text, up, down').eq('model_name', model).eq('occasion', occasion)
      .order('up', { ascending: false }).limit(6)
    const goodOnes = (lib || []).filter((r) => (r.up || 0) > (r.down || 0)).map((r) => r.text)

    // v3.92.0: zuletzt "genommene" Nachrichten als zusätzliche Vorlage (starkes Signal)
    const { data: usedRows } = await db.from('message_suggestions')
      .select('text').eq('model_name', model).eq('occasion', occasion).eq('used', true)
      .order('created_at', { ascending: false }).limit(5)
    const usedOnes = (usedRows || []).map((r) => r.text)

    const since = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
    const { data: recent } = await db.from('message_suggestions')
      .select('text').eq('model_name', model).eq('occasion', occasion).gte('created_at', since).limit(60)
    const avoid = (recent || []).map((r) => r.text)

    // --- Prompt bauen ---
    const shiftText = shift === 'frueh' ? 'Frühschicht (Vormittag)'
      : shift === 'spaet' ? 'Spätschicht (Nachmittag/Abend)'
      : shift === 'nacht' ? 'Nachtschicht (spät nachts)' : 'unbestimmte Tageszeit'

    const examples = [...new Set([...(persona.examples || []), ...usedOnes, ...goodOnes])].slice(0, 10)

    const system = [
      `Du schreibst kurze Direktnachrichten im Namen des Models "${model}" für zahlende Fans auf einer Creator-Plattform.`,
      globalRules ? `GRUNDREGELN (gelten immer, für alle Models – unbedingt befolgen): ${globalRules}` : '',
      `Beschreibung: ${persona.description || '—'}`,
      persona.persona_tags?.length ? `Charakter: ${persona.persona_tags.join(', ')}.` : '',
      `Anrede: ${persona.anrede === 'sie' ? 'Sie' : 'Du'}. Sprache/Dialekt: ${persona.dialekt}. Emoji-Menge: ${persona.emoji}. Direktheit: ${persona.direktheit}.`,
      `Länge: ${laengeHint}. WICHTIG: Halte jede Nachricht knapp und natürlich – lieber zu kurz als zu lang. Keine langen Sätze, kein Gelaber, keine Aufzählungen.`,
      `ZIEL: Jede Nachricht ist ein GESPRÄCHSOPENER, der den Fan zum Antworten bringt – NICHT nur eine Aussage/Ansage. Nutze entweder eine proaktive, neugierig machende Frage ODER eine Entweder-oder-Wahl (z.B. "Kaffee oder lieber kuscheln?", "Netflix oder rausgehen?"). Variiere über die Vorschläge hinweg zwischen echten Fragen und Entweder-oder. Am Ende soll der Fan das Gefühl haben, dass er reagieren MUSS.`,
      persona.nogos?.length ? `Absolute No-Gos (niemals): ${persona.nogos.join('; ')}.` : '',
      persona.emojis?.length ? `Erlaubte Emojis – verwende AUSSCHLIESSLICH diese, KEINE anderen: ${persona.emojis.join(' ')}` : '',
      `Anlass: ${occLabel}. ${guardrail}`,
      `Kontext: ${shiftText}. Passe die Nachricht an die Tageszeit an.`,
      `Schreibe die Nachrichten auf ${language}. Kein Klarname, keine echten Treffen, keine Links.`,
      language !== 'Deutsch' ? `Hinweis: Die Dialekt-Einstellung ist deutschspezifisch. In ${language} den Charakter und Ton des Models beibehalten, aber natürlich und muttersprachlich in ${language} schreiben (kein deutscher Dialekt).` : '',
      persona.extra ? `WICHTIGE Extra-Anweisungen (unbedingt befolgen): ${persona.extra}` : '',
      examples.length ? `Ton-Vorlagen (Stil nachahmen, NICHT kopieren):\n- ${examples.join('\n- ')}` : '',
      avoid.length ? `Vermeide Nachrichten, die diesen zu ähnlich sind:\n- ${avoid.slice(0, 25).join('\n- ')}` : '',
      `Antworte AUSSCHLIESSLICH als JSON: {"messages":["...","..."]} mit genau ${count} unterschiedlichen Nachrichten. Kein weiterer Text.`,
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
        messages: [{ role: 'user', content: `Gib mir ${count} Vorschläge für "${occLabel}".` }],
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
