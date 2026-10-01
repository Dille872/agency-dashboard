// ── videos-aufraeumen (v5.8.0) ─────────────────────────────────────────────
//
// Löscht Videos nach der Aufräumregel (sql/speicher-aufraeumen.sql):
// Rohvideos von Skripten, die vor mehr als 30 Tagen gepostet wurden — nur
// wenn es eine geschnittene Fassung gibt — und alte, ersetzte Uploads.
// Die geschnittene Fassung bleibt immer.
//
// Aufrufer: das Dashboard, wenn Admin oder Social-Leitung die Steuerung
// öffnet (höchstens einmal am Tag) oder auf „Jetzt aufräumen“ tippt.
// Mit Login (verify_jwt bleibt an). Die Function prüft selbst, dass der
// Aufrufer Admin/Pfleger/Social-Leitung ist, und löscht dann mit der
// Service-Rolle über die Storage-API (nicht per SQL, sonst blieben die
// Dateien im Speicher liegen).
//
// Deploy: supabase functions deploy videos-aufraeumen

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const URL_ = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, error: 'Nur POST' }, 405)

  // Wer ruft? Mit dem Login des Aufrufers prüfen
  const nutzer = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } }, auth: { persistSession: false } })
  const { data: stand, error: e1 } = await nutzer.rpc('speicher_stand')
  if (e1) return json({ ok: false, error: e1.message }, 500)
  if (!stand) return json({ ok: false, error: 'forbidden' }, 403)   // speicher_stand liefert null für alle außer Leitung

  const db = createClient(URL_, SERVICE, { auth: { persistSession: false } })
  const { data: liste, error: e2 } = await db.rpc('videos_zum_aufraeumen', { p_tage: 30 })
  if (e2) return json({ ok: false, error: e2.message }, 500)
  const namen = (liste || []).map((x: { name: string }) => x.name)
  const bytes = (liste || []).reduce((s: number, x: { bytes: number }) => s + Number(x.bytes || 0), 0)
  if (!namen.length) return json({ ok: true, geloescht: 0, bytes: 0 })

  let geloescht = 0
  const fehler: string[] = []
  for (let i = 0; i < namen.length; i += 100) {
    const teil = namen.slice(i, i + 100)
    const { data, error } = await db.storage.from('reel-videos').remove(teil)
    if (error) fehler.push(error.message); else geloescht += (data || []).length
  }
  return json({ ok: !fehler.length, geloescht, bytes, fehler })
})
