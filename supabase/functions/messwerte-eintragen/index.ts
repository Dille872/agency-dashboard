// ── messwerte-eintragen (v4.107.0) ─────────────────────────────────────────
//
// Einziger Weg, auf dem Reel-Messwerte (Aufrufe, Likes, Kommentare, Faktor)
// in die Datenbank kommen. Aufrufer: das Sammel-Skript auf dem Mac mini
// (~/Lyra/reels/reels_sammler.py), NICHT Lyra selbst.
//
// Absicherung:
//   • Header  x-messwerte-secret  muss dem Secret MESSWERTE_SECRET entsprechen
//     (eigenes Geheimnis, nicht der service_role-Schlüssel). Vergleich in
//     konstanter Zeit.
//   • Die Function darf nur public.messwerte_eintragen() aufrufen. Die prüft
//     jede Zeile (betreuter Account im Service, Zahlen ≥ 0, Shortcode) und
//     schreibt nur in reel_messwerte — nie löschen, keine anderen Tabellen.
//   • Höchstens 1000 Zeilen und 1 MB pro Aufruf.
//
// Ohne Supabase-Login erreichbar (steht in supabase/config.toml), weil das
// Skript keinen Login hat — die Absicherung ist das Geheimnis.
//
// Secrets:  MESSWERTE_SECRET  (einmal setzen:
//             supabase secrets set MESSWERTE_SECRET=$(openssl rand -hex 32)
//           und denselben Wert von Hand in ~/Lyra/reels/.env eintragen —
//           nie in einen Chat kopieren)
// Deploy:   supabase functions deploy messwerte-eintragen
//
// Anfrage:
//   POST https://xdchyruasjxvrjduchoc.supabase.co/functions/v1/messwerte-eintragen
//   Content-Type: application/json
//   x-messwerte-secret: <Geheimnis>
//   {"messwerte": [{"shortcode": "…", "account": "@…", "gepostet_am": "…Z",
//                   "gemessen_am": "…Z", "alter_std": 26.5, "plays": 1234,
//                   "likes": 56, "comments": 7, "faktor": 1.8}]}
// Antwort:
//   {"ok": true, "uebernommen": n, "verworfen": [{"index": i, "shortcode": "…", "grund": "…"}]}

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GEHEIMNIS = Deno.env.get('MESSWERTE_SECRET') || ''

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
  if (GEHEIMNIS.length < 32) return json({ ok: false, error: 'MESSWERTE_SECRET ist nicht gesetzt' }, 500)
  const kopf = req.headers.get('x-messwerte-secret') || ''
  if (!gleich(kopf, GEHEIMNIS)) return json({ ok: false, error: 'forbidden' }, 403)

  const roh = await req.text()
  if (roh.length > 1_000_000) return json({ ok: false, error: 'Anfrage zu groß (max. 1 MB)' }, 413)
  let body: { messwerte?: unknown }
  try { body = JSON.parse(roh) } catch { return json({ ok: false, error: 'Kein gültiges JSON' }, 400) }
  const zeilen = body?.messwerte
  if (!Array.isArray(zeilen)) return json({ ok: false, error: 'Feld „messwerte“ muss eine Liste sein' }, 400)
  if (zeilen.length > 1000) return json({ ok: false, error: 'Höchstens 1000 Zeilen pro Aufruf' }, 400)
  if (!zeilen.length) return json({ ok: true, uebernommen: 0, verworfen: [] })

  const { data, error } = await db.rpc('messwerte_eintragen', { p_zeilen: zeilen })
  if (error) return json({ ok: false, error: error.message }, 500)
  return json({ ok: true, ...(data as Record<string, unknown>) })
})
