import { supabase } from './supabase'

// ── Private Dateien: signierte Links (v5.33.0) ─────────────────────────────
// Bis v5.32 waren die Buckets model-media, content-requests, chat-attachments
// und guideline-images öffentlich: Wer einen Link hatte, sah die Datei ohne
// Login, für immer. Seit sql/medien-privat.sql sind sie privat.
//
// In der Datenbank bleiben die alten Links stehen (…/object/public/<bucket>/<pfad>).
// Beim Anzeigen wird daraus ein signierter Link gemacht, der nach einer Stunde
// abläuft und nur für Eingeloggte erzeugt werden kann. Fremde Links
// (Instagram, Dropbox …) bleiben unverändert.

export const PRIVATE_BUCKETS = ['model-media', 'content-requests', 'chat-attachments', 'guideline-images', 'rechnungen'] // v5.37.0: + rechnungen
const MUSTER = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?#]+)\/([^?#]+)/

export function zerlege(url) {
  const m = String(url || '').match(MUSTER)
  if (!m || !PRIVATE_BUCKETS.includes(m[1])) return null
  let pfad = m[2]
  try { pfad = pfad.split('/').map(decodeURIComponent).join('/') } catch { /* so lassen */ }
  return { bucket: m[1], pfad }
}
export const istPrivat = (url) => !!zerlege(url)

const DAUER = 3600
const cache = new Map()      // url → { url, bis }
const laufend = new Map()    // url → Promise

export function sofort(url) {
  if (!istPrivat(url)) return url || null
  const c = cache.get(url)
  return c && c.bis > Date.now() ? c.url : null
}

export async function signiert(url, sek = DAUER) {
  const z = zerlege(url)
  if (!z) return url
  if (sek === DAUER) {
    const fertig = sofort(url)
    if (fertig) return fertig
    if (laufend.has(url)) return laufend.get(url)
  }
  const p = (async () => {
    const { data, error } = await supabase.storage.from(z.bucket).createSignedUrl(z.pfad, sek)
    if (error || !data?.signedUrl) return url   // Fallback: alter Link (klappt, solange der Bucket noch öffentlich ist)
    if (sek === DAUER) cache.set(url, { url: data.signedUrl, bis: Date.now() + (sek - 120) * 1000 })
    return data.signedUrl
  })()
  if (sek === DAUER) { laufend.set(url, p); p.finally(() => laufend.delete(url)) }
  return p
}

// Für Telegram (Telegram holt das Bild selbst ab): einen Tag gültig
export async function signiertListe(urls, sek = 86400) {
  return Promise.all((urls || []).map(u => signiert(u, sek)))
}

// Öffnen in neuem Tab (z. B. PDF)
export async function oeffnen(url) {
  const w = window.open('', '_blank')
  const ziel = await signiert(url)
  if (w) w.location.href = ziel; else window.location.href = ziel
}
