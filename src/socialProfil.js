import { useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'

// ── Social-Media-Fragebogen (v4.100.0) ─────────────────────────────────────
//
// Für den Social-Media-Service: Aus den Antworten schreibt die Reels-Pipeline
// (Lyra, Mac mini) das Model-Profil und damit passende Reel-Skripte.
// Lyra liest NUR die Ansicht lyra.model_social_profil (sql/model-social-profil.sql).
//
// Tabellen:
//   model_social_profil   eine Zeile je Model + schluessel, antwort jsonb,
//                         geaendert_am je Antwort
//   model_social_service  eine Zeile je Model: fragebogen_status
//                         (null | 'offen' | 'laeuft' | 'fertig') und die
//                         Agentur-Felder service_aktiv, posting_ab
//   Die Accounts selbst: Instagram-Links, die das Model im Board einträgt
//   (model_board, category social_media). Lyra bekommt sie als Schlüssel
//   service_accounts. NICHT der Social-Tab (social_accounts) — der ist für
//   eigene Mitarbeiter-Accounts.
//
// Nicht doppelt fragen: No Gos, Einschränkungen und Social-Links stehen im
// Board (model_board). Der Fragebogen zeigt sie nur zum Bestätigen an.
//
// Die SCHLÜSSEL sind mit dem Pipeline-Chat abgestimmt — nicht umbenennen,
// sonst findet Lyra die Antworten nicht mehr.
//
// Feldtypen: lang (mehrzeilig), multi (Chips + „eigenes“), bilder (Upload),
// links (mehrere URLs), handles (mehrere @-Namen), skala (1–5), chips (eins).

export const FRAGEN = [
  { key: 'drehorte', label: 'Wo kannst du zu Hause gut drehen?', typ: 'multi',
    optionen: ['Küche', 'Wohnzimmer', 'Schlafzimmer', 'Bad', 'Garten', 'Balkon', 'Pool', 'Auto', 'Draußen in der Nähe'] },
  { key: 'drehorte_fotos', label: '3–4 Handyfotos deiner Lieblingsecken', typ: 'bilder', max: 4,
    tipp: 'Freiwillig. Nur für unser Team, damit die Skripte zu deinen Räumen passen. Keine Fenster mit Blick auf Straßenschilder o. Ä.' },
  { key: 'wiedererkennung', label: 'Was hast du, das auffällt oder wiedererkannt wird?', typ: 'lang',
    ph: 'z. B. Haustier, Auto, Hobby, Tattoos, Dialekt …' },
  { key: 'stil', label: 'Welche 3 Worte beschreiben deinen Stil?', typ: 'text', ph: 'z. B. frech, sportlich, elegant' },
  { key: 'staerken', label: 'Was kannst du vor der Kamera gut?', typ: 'multi',
    optionen: ['Mimik', 'Reden', 'Tanzen', 'Witzig sein', 'Lip-Sync', 'Posen', 'Storytelling', 'Kochen', 'Sport'] },
  { key: 'ausprobieren', label: 'Was würdest du gern mal ausprobieren?', typ: 'lang' },
  { key: 'mitspieler', label: 'Wer kann mitmachen, und wie ist er/sie zu sehen?', typ: 'lang',
    ph: 'z. B. Freund, nur Stimme / nur Hände / von hinten' },
  { key: 'top_reels', label: 'Deine 3 besten Reels bisher (Links)', typ: 'links', anzahl: 3, ph: 'https://instagram.com/reel/…' },
  { key: 'lieblings_creator', label: '3 Creatorinnen, die du gut findest', typ: 'handles', anzahl: 3, ph: '@name' },
  { key: 'englisch', label: 'Wie wohl fühlst du dich auf Englisch?', typ: 'skala',
    unten: 'gar nicht', oben: 'kein Problem' },
  { key: 'technik', label: 'Welche Technik hast du?', typ: 'multi', optionen: ['Stativ', 'Ringlicht', 'Mikro', 'Nichts davon'] },
  { key: 'drehrhythmus', label: 'Wie oft kannst du drehen? Lieber mehrere Reels am Stück?', typ: 'lang',
    ph: 'z. B. 1× pro Woche, dann 4–5 Reels am Stück' },
]

// Bestätigung der Board-Daten (No Gos, Einschränkungen, Instagram)
export const BOARD_CHECK = { key: 'board_aktuell', optionen: ['Ja, stimmt so', 'Muss ich im Board anpassen'] }

export const ALLE_SCHLUESSEL = [...FRAGEN.map(f => f.key), BOARD_CHECK.key]

export const hatWert = (v) => Array.isArray(v) ? v.some(x => String(x ?? '').trim()) : v !== null && v !== undefined && String(v).trim() !== ''
export const wertText = (v) => Array.isArray(v) ? v.filter(x => String(x ?? '').trim()).join(', ') : String(v ?? '').trim()

export function stand(antworten = {}) {
  const voll = FRAGEN.filter(f => hatWert(antworten[f.key]?.antwort)).length
  return { voll, gesamt: FRAGEN.length }
}

// ── Laden ──
// Rückgabe: { fehlt, service, antworten: { schluessel: { antwort, geaendert_am, geaendert_von } } }
// fehlt = Tabelle noch nicht angelegt (SQL nicht gelaufen) → Oberfläche blendet aus.
export async function socialLaden(name) {
  const [s, p] = await Promise.all([
    supabase.from('model_social_service').select('*').eq('model_name', name).maybeSingle(),
    supabase.from('model_social_profil').select('*').eq('model_name', name),
  ])
  if (s.error || p.error) return { fehlt: true, service: null, antworten: {} }
  return { fehlt: false, service: s.data || null, antworten: Object.fromEntries((p.data || []).map(z => [z.schluessel, z])) }
}

// Nur die geänderten Antworten speichern — jede bekommt ihren eigenen Zeitpunkt.
// Leere Antwort = null (die Zeile bleibt, damit „geleert am“ sichtbar ist).
export async function antwortenSpeichern(name, geaendert, wer) {
  const jetzt = new Date().toISOString()
  const zeilen = Object.entries(geaendert).map(([schluessel, antwort]) => ({
    model_name: name, schluessel, antwort: hatWert(antwort) ? antwort : null, geaendert_am: jetzt, geaendert_von: wer || null,
  }))
  if (!zeilen.length) return null
  const { error } = await supabase.from('model_social_profil').upsert(zeilen, { onConflict: 'model_name,schluessel' })
  return error || null
}

export async function serviceSpeichern(name, felder, wer) {
  const { error } = await supabase.from('model_social_service').upsert({
    model_name: name, ...felder, aktualisiert_am: new Date().toISOString(), aktualisiert_von: wer || null,
  }, { onConflict: 'model_name' })
  return error || null
}

// Foto hochladen (HEIC wird vorher zu JPEG). Liefert die öffentliche URL.
// Pfad beginnt mit dem Model-Namen wie bei den Videos im Portal.
export async function fotoHochladen(name, file) {
  const { convertHeicIfNeeded } = await import('./imageUtils')
  const f = await convertHeicIfNeeded(file)
  const ext = ((f.name || '').split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${name}/social-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from('model-media').upload(path, f, { contentType: f.type || undefined })
  if (error) return { fehler: error }
  const { data } = supabase.storage.from('model-media').getPublicUrl(path)
  return { url: data.publicUrl }
}

// Für den Admin: Service-Zeilen aller Models (Status-Pillen)
export function useSocialServices(namen) {
  const [map, setMap] = useState({})
  const [fehlt, setFehlt] = useState(false)
  const schluessel = (namen || []).slice().sort().join('|')
  const laden = useCallback(async () => {
    if (!schluessel) { setMap({}); return }
    const { data, error } = await supabase.from('model_social_service').select('*').in('model_name', schluessel.split('|'))
    if (error) { setFehlt(true); return }
    setFehlt(false)
    setMap(Object.fromEntries((data || []).map(z => [z.model_name, z])))
  }, [schluessel])
  useEffect(() => { laden() }, [laden])
  return { map, fehlt, neuLaden: laden }
}

export const datumKurz = (iso) => iso ? new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) : ''
