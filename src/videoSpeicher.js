import * as tus from 'tus-js-client'
import { supabase } from './supabase'

// ── Videos im eigenen Speicher (v5.7.0) ────────────────────────────────────
// Privater Bucket reel-videos (sql/reel-videos.sql). Hochladen „fortsetzbar“
// (TUS): bricht das Netz ab, geht es an derselben Stelle weiter. Beim
// Hochladen macht das Gerät selbst ein Vorschaubild (Standbild aus dem Video)
// und legt es als „<datei>.jpg“ daneben.
//
// In reel_skripte.video_link / schnitt_link steht danach
//   speicher://reel-videos/skript/<id>/roh-<zeit>.mp4
// Alte Dropbox-/Drive-Links funktionieren weiter wie bisher.

export const BUCKET = 'reel-videos'
const PROJEKT = 'xdchyruasjxvrjduchoc'
const PRAEFIX = `speicher://${BUCKET}/`

export const istSpeicher = (link) => String(link || '').startsWith(PRAEFIX)
export const pfadVon = (link) => istSpeicher(link) ? String(link).slice(PRAEFIX.length) : null
export const istBild = (link) => /\.(jpe?g|png|webp)$/i.test(String(link || '')) && !/\.[a-z0-9]{2,5}\.jpg$/i.test(String(link || ''))
// Vorschau: Fotos sind ihr eigenes Vorschaubild, Videos haben „<datei>.jpg“ daneben
export const vorschauPfad = (link) => istSpeicher(link) ? (istBild(link) ? pfadVon(link) : pfadVon(link) + '.jpg') : null
const hex = (t) => Array.from(new TextEncoder().encode(String(t))).map(b => b.toString(16).padStart(2, '0')).join('')
const zufall = () => Math.random().toString(36).slice(2, 8).padEnd(4, '0')

const endung = (datei) => {
  const e = String(datei?.name || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '')
  if (e && e.length <= 5 && e !== String(datei?.name || '').toLowerCase()) return e
  return /quicktime/.test(datei?.type || '') ? 'mov' : 'mp4'
}
const typVon = (datei) => datei?.type && datei.type.startsWith('video/') ? datei.type : (endung(datei) === 'mov' ? 'video/quicktime' : 'video/mp4')

// Standbild aus dem Video (bei Sekunde 1, sonst Anfang). Klappt es nicht
// (z. B. Format, das der Browser nicht abspielt), gibt es eben kein Bild.
export function vorschauMachen(datei, breite = 360) {
  return new Promise((fertig) => {
    let erledigt = false
    const ende = (blob) => { if (erledigt) return; erledigt = true; try { URL.revokeObjectURL(v.src) } catch { /* egal */ } fertig(blob) }
    const v = document.createElement('video')
    v.muted = true; v.playsInline = true; v.preload = 'metadata'
    v.src = URL.createObjectURL(datei)
    const zeit = setTimeout(() => ende(null), 10000)
    v.onloadedmetadata = () => { try { v.currentTime = Math.min(1, (v.duration || 2) / 2) } catch { ende(null) } }
    v.onseeked = () => {
      try {
        const h = Math.round(breite * (v.videoHeight / v.videoWidth || 16 / 9))
        const c = document.createElement('canvas'); c.width = breite; c.height = h
        c.getContext('2d').drawImage(v, 0, 0, breite, h)
        c.toBlob(b => { clearTimeout(zeit); ende(b) }, 'image/jpeg', 0.75)
      } catch { clearTimeout(zeit); ende(null) }
    }
    v.onerror = () => { clearTimeout(zeit); ende(null) }
  })
}

const istVideo = (d) => /^video\//.test(d?.type || '') || /\.(mp4|mov|m4v|webm|3gp)$/i.test(d?.name || '')
const istFoto = (d) => /^image\//.test(d?.type || '') || /\.(jpe?g|png|webp|heic|heif)$/i.test(d?.name || '')

// Hochladen eines Skript-Videos. art: 'roh' (Model) oder 'schnitt' (Cutter).
// onFortschritt(0…1). Liefert { link } oder { fehler }.
export async function videoHochladen({ datei, skriptId, art = 'roh', onFortschritt }) {
  if (!datei) return { fehler: 'Keine Datei gewählt.' }
  if (!istVideo(datei)) return { fehler: 'Bitte ein Video auswählen.' }
  return speicherHochladen({ datei, pfad: `skript/${skriptId}/${art}-${Date.now()}.${endung(datei)}`, onFortschritt })
}

// v5.9.0: Foto oder Video für den Posting-Plan (Reel/Story) bzw. fürs Material.
// Mit account → Ablage für den Plan-Eintrag, ohne → Material des Models.
export async function planDateiHochladen({ datei, model, account = null, onFortschritt }) {
  if (!datei) return { fehler: 'Keine Datei gewählt.' }
  if (!istVideo(datei) && !istFoto(datei)) return { fehler: 'Bitte ein Foto oder Video auswählen.' }
  let d = datei
  if (!istVideo(d)) {   // iPhone-Fotos (HEIC) → JPG
    try { const { convertHeicIfNeeded } = await import('./imageUtils'); d = await convertHeicIfNeeded(d) } catch { /* Original versuchen */ }
    if (/hei[cf]/i.test(d.type || '') || /\.hei[cf]$/i.test(d.name || '')) return { fehler: 'Dieses Foto-Format geht nicht. Bitte als JPG speichern.' }
  }
  const ext = istVideo(d) ? endung(d) : (/png/.test(d.type) ? 'png' : /webp/.test(d.type) ? 'webp' : 'jpg')
  const name = `${Date.now()}-${zufall()}.${ext}`
  const pfad = account ? `plan/${hex(model)}/${hex(account)}/${name}` : `material/${hex(model)}/${name}`
  return speicherHochladen({ datei: d, pfad, onFortschritt, bildTyp: istVideo(d) ? null : (d.type || 'image/jpeg') })
}

async function speicherHochladen({ datei, pfad, onFortschritt, bildTyp = null }) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { fehler: 'Nicht angemeldet.' }

  const ergebnis = await new Promise((fertig) => {
    const up = new tus.Upload(datei, {
      endpoint: `https://${PROJEKT}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000, 30000],
      headers: { authorization: `Bearer ${session.access_token}`, 'x-upsert': 'false' },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: { bucketName: BUCKET, objectName: pfad, contentType: bildTyp || typVon(datei), cacheControl: '3600' },
      chunkSize: 6 * 1024 * 1024, // von Supabase so vorgegeben
      onError: (e) => fertig({ fehler: meldung(e) }),
      onProgress: (gesendet, gesamt) => onFortschritt && onFortschritt(gesamt ? gesendet / gesamt : 0),
      onSuccess: () => fertig({ ok: true }),
    })
    up.findPreviousUploads().then(alt => { if (alt.length) up.resumeFromPreviousUpload(alt[0]); up.start() })
  })
  if (ergebnis.fehler) return ergebnis

  // Vorschaubild für Videos (darf fehlen); Fotos sind selbst das Bild
  if (!bildTyp) try {
    const bild = await vorschauMachen(datei)
    if (bild) await supabase.storage.from(BUCKET).upload(pfad + '.jpg', bild, { contentType: 'image/jpeg', upsert: false })
  } catch { /* ohne Bild weiter */ }
  return { link: PRAEFIX + pfad }
}

function meldung(e) {
  const t = String(e?.originalResponse?.getBody?.() || e?.message || e || '')
  if (/row-level security|403|Unauthorized/i.test(t)) return 'Keine Berechtigung, hier hochzuladen.'
  if (/413|too large|maximum allowed size|exceeded/i.test(t)) return 'Die Datei ist zu groß.'
  if (/mime|content type/i.test(t)) return 'Dieses Dateiformat geht nicht (Video: MP4 oder MOV, Foto: JPG oder PNG).'
  return 'Hochladen hat nicht geklappt: ' + t.slice(0, 160)
}

// Zeitlich begrenzter Link zum Ansehen oder Laden (4 Stunden)
const cache = new Map()
export async function speicherUrl(link, { laden = false, bild = false } = {}) {
  const pfad = bild ? vorschauPfad(link) : pfadVon(link)
  if (!pfad) return null
  const schluessel = pfad + (laden ? '|dl' : '')
  const alt = cache.get(schluessel)
  if (alt && alt.bis > Date.now()) return alt.url
  const name = pfad.split('/').slice(1).join('-')
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(pfad, 4 * 3600, laden ? { download: name } : undefined)
  if (error || !data?.signedUrl) { if (!bild) console.warn('Video-Link:', error?.message); return null }
  cache.set(schluessel, { url: data.signedUrl, bis: Date.now() + 3.5 * 3600 * 1000 })
  return data.signedUrl
}
