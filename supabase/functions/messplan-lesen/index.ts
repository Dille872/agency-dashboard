// ── messplan-lesen (v5.6.0) ────────────────────────────────────────────────
//
// Sagt dem Sammel-Skript auf dem Mac mini, welche Reels es noch messen soll
// (Messfenster 30 Tage, im Dashboard verlängerbar). Nur lesen.
//
// Absicherung: gleiches Geheimnis wie messwerte-eintragen
//   Header  x-messwerte-secret  = Secret MESSWERTE_SECRET (Vergleich in
//   konstanter Zeit). Die Function ruft nur public.messplan_lesen() auf.
//
// Ohne Supabase-Login erreichbar (steht in supabase/config.toml).
// Deploy:   supabase functions deploy messplan-lesen
//
// Anfrage:
//   GET https://xdchyruasjxvrjduchoc.supabase.co/functions/v1/messplan-lesen
//   x-messwerte-secret: <Geheimnis>
// Antwort:
//   {"messplan": [{"shortcode": "…", "account": "@…", "gepostet_am": "…" | null,
//                  "messen_bis": "YYYY-MM-DD", "noch_messen": true}]}

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GEHEIMNIS = Deno.env.get('MESSWERTE_SECRET') || ''

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

function gleich(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  let d = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return d === 0
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

serve(async (req) => {
  if (req.method !== 'GET') return json({ ok: false, error: 'Nur GET' }, 405)
  if (GEHEIMNIS.length < 32) return json({ ok: false, error: 'MESSWERTE_SECRET ist nicht gesetzt' }, 500)
  const kopf = req.headers.get('x-messwerte-secret') || ''
  if (!gleich(kopf, GEHEIMNIS)) return json({ ok: false, error: 'forbidden' }, 403)

  const { data, error } = await db.rpc('messplan_lesen')
  if (error) return json({ ok: false, error: error.message }, 500)
  return json({ messplan: data ?? [] })
})
