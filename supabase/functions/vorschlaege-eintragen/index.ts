// ── vorschlaege-eintragen (v5.3.1) ─────────────────────────────────────────
//
// Einziger Weg, auf dem Lyras Caption-/Hashtag-Vorschläge in den Posting-Plan
// kommen. Aufrufer: ein Sende-Skript OHNE KI auf dem Mac mini (launchd), das
// Lyras lokale Vorschlagsdatei prüft und schickt — NICHT Lyra selbst.
//
// Absicherung:
//   • Header  x-vorschlaege-secret  = Secret VORSCHLAEGE_SECRET (eigenes
//     Geheimnis, nicht das der Messwerte — jedes einzeln sperrbar).
//   • Die Function ruft nur public.vorschlaege_eintragen() auf. Die schreibt
//     ausschließlich caption_vorschlag / hashtags_vorschlag, nur bei status
//     'geplant', und prüft Länge, Hashtag-Zahl, Links, @-Erwähnungen und
//     gesperrte Wörter.
//   • Höchstens 500 Zeilen und 1 MB pro Aufruf.
//
// Secrets:  VORSCHLAEGE_SECRET  (einmal setzen:
//             supabase secrets set VORSCHLAEGE_SECRET=$(openssl rand -hex 32)
//           und denselben Wert von Hand in ~/Lyra/reels/.env eintragen —
//           nie in einen Chat kopieren)
// Deploy:   supabase functions deploy vorschlaege-eintragen
//
// Anfrage:
//   POST https://xdchyruasjxvrjduchoc.supabase.co/functions/v1/vorschlaege-eintragen
//   Content-Type: application/json
//   x-vorschlaege-secret: <Geheimnis>
//   {"vorschlaege": [{"id": "123", "caption_vorschlag": "…", "hashtags_vorschlag": "#a #b"}]}
// Antwort:
//   {"ok": true, "uebernommen": n, "verworfen": [{"index": i, "id": "…", "grund": "…"}]}

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GEHEIMNIS = Deno.env.get('VORSCHLAEGE_SECRET') || ''

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

// Vergleich in konstanter Zeit, damit die Antwortzeit nichts verrät
function gleich(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  let d = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return d === 0
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'Nur POST' }, 405)
  if (GEHEIMNIS.length < 32) return json({ ok: false, error: 'VORSCHLAEGE_SECRET ist nicht gesetzt' }, 500)
  const kopf = req.headers.get('x-vorschlaege-secret') || ''
  if (!gleich(kopf, GEHEIMNIS)) return json({ ok: false, error: 'forbidden' }, 403)

  const roh = await req.text()
  if (roh.length > 1_000_000) return json({ ok: false, error: 'Anfrage zu groß (max. 1 MB)' }, 413)
  let body: { vorschlaege?: unknown }
  try { body = JSON.parse(roh) } catch { return json({ ok: false, error: 'Kein gültiges JSON' }, 400) }
  const zeilen = body?.vorschlaege
  if (!Array.isArray(zeilen)) return json({ ok: false, error: 'Feld „vorschlaege“ muss eine Liste sein' }, 400)
  if (zeilen.length > 500) return json({ ok: false, error: 'Höchstens 500 Zeilen pro Aufruf' }, 400)
  if (!zeilen.length) return json({ ok: true, uebernommen: 0, verworfen: [] })

  const { data, error } = await db.rpc('vorschlaege_eintragen', { p_zeilen: zeilen })
  if (error) return json({ ok: false, error: error.message }, 500)
  return json({ ok: true, ...(data as Record<string, unknown>) })
})
