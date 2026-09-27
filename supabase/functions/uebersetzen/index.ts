// ── uebersetzen (v4.102.0) ─────────────────────────────────────────────────
//
// Übersetzt kurze Model-Texte (No Gos, Stil, Drehorte …) für die englische
// Ansicht des Social Media Managers. Deutsch → Englisch.
//
// Ablauf: Hash je Text → im Speicher public.social_uebersetzung nachsehen →
// nur Fehlendes in EINEM Aufruf an Haiku → speichern → alles zurückgeben.
// Jeder Text wird also nur ein einziges Mal übersetzt.
//
// Zugang: nur eingeloggte Nutzer mit Rolle admin/manager/creator_manager oder
// Zusatzrolle social_media. Token-Prüfung bleibt an (nicht in config.toml).
//
// Secrets: ANTHROPIC_API_KEY (gibt es schon für generate-messages).
// Deploy:  supabase functions deploy uebersetzen

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const MODELL = 'claude-haiku-4-5'

const MAX_TEXTE = 80
const MAX_LAENGE = 1000

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

async function hash(t: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    // --- Auth + Rolle ---
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
    if (!token) return json({ ok: false, error: 'Nicht eingeloggt' }, 401)
    const auth = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
    const { data: u, error: authErr } = await auth.auth.getUser(token)
    if (authErr || !u?.user) return json({ ok: false, error: 'Nicht autorisiert' }, 401)
    const { data: r } = await db.from('user_roles').select('role, roles, status').eq('user_id', u.user.id).maybeSingle()
    const rollen: string[] = [r?.role, ...(Array.isArray(r?.roles) ? r.roles : [])].filter(Boolean)
    const erlaubt = rollen.some((x) => ['admin', 'manager', 'creator_manager', 'social_media', 'cutter', 'social_freigabe'].includes(x))
    if (!erlaubt || ['suspended', 'offboarded'].includes(r?.status)) return json({ ok: false, error: 'Keine Berechtigung' }, 403)

    // --- Eingabe ---
    const body = await req.json().catch(() => ({}))
    const sprache = body?.sprache === 'en' ? 'en' : null
    if (!sprache) return json({ ok: false, error: 'Nur sprache=en wird unterstützt' }, 400)
    const texte: string[] = [...new Set(
      (Array.isArray(body?.texte) ? body.texte : [])
        .map((t: unknown) => String(t ?? '').trim())
        .filter((t: string) => t && t.length <= MAX_LAENGE),
    )].slice(0, MAX_TEXTE) as string[]
    if (!texte.length) return json({ ok: true, uebersetzungen: {} })

    // --- Speicher ---
    const keys = await Promise.all(texte.map(async (t) => (await hash(t)) + ':' + sprache))
    const { data: vorhanden } = await db.from('social_uebersetzung').select('schluessel, text').in('schluessel', keys)
    const ausSpeicher = new Map((vorhanden || []).map((z: { schluessel: string; text: string }) => [z.schluessel, z.text]))
    const ergebnis: Record<string, string> = {}
    const fehlend: { text: string; key: string }[] = []
    texte.forEach((t, i) => {
      const hit = ausSpeicher.get(keys[i])
      if (hit) ergebnis[t] = hit
      else fehlend.push({ text: t, key: keys[i] })
    })

    // --- Haiku für den Rest ---
    if (fehlend.length) {
      const system = [
        'You translate short German notes from a talent agency dashboard into natural, concise English.',
        'Context: instructions for a social media manager who posts Instagram Reels for content creators (e.g. filming locations, style, things the creator does not want shown).',
        'Keep names, @handles, emojis and numbers unchanged. Do not add explanations.',
        'Answer ONLY with JSON: {"t":["…","…"]} — same order and same number of items as the input.',
      ].join('\n')
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODELL, max_tokens: 4000, temperature: 0, system,
          messages: [{ role: 'user', content: JSON.stringify({ t: fehlend.map((f) => f.text) }) }],
        }),
      })
      if (!res.ok) {
        const t = await res.text()
        return json({ ok: true, uebersetzungen: ergebnis, fehler: `Anthropic ${res.status}: ${t.slice(0, 200)}` })
      }
      const j = await res.json()
      const raw = j?.content?.[0]?.text || ''
      let liste: string[] = []
      try { const m = raw.match(/\{[\s\S]*\}/); liste = JSON.parse(m ? m[0] : raw).t || [] } catch { liste = [] }
      if (liste.length === fehlend.length) {
        const zeilen = fehlend.map((f, i) => ({ schluessel: f.key, original: f.text, sprache, text: String(liste[i] ?? '').trim() || f.text }))
        zeilen.forEach((z) => { ergebnis[z.original] = z.text })
        await db.from('social_uebersetzung').upsert(zeilen, { onConflict: 'schluessel' })
      } else {
        return json({ ok: true, uebersetzungen: ergebnis, fehler: 'Antwort passte nicht zur Eingabe' })
      }
    }
    return json({ ok: true, uebersetzungen: ergebnis })
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500)
  }
})
