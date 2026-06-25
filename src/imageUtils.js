// v3.42.0: HEIC/HEIF-Fotos (iPhone-Standard) vor dem Upload zu JPEG wandeln.
// Hintergrund: Desktop-Browser (Chrome/Firefox/Edge) können HEIC nicht anzeigen
// und Telegram akzeptiert HEIC nicht beim Versand per URL. Ergebnis waren
// "manchmal" nicht angezeigte Bilder – nämlich immer dann, wenn ein HEIC kam.
//
// heic2any wird per dynamischem Import geladen, damit die Library nur dann ins
// Spiel kommt, wenn wirklich ein HEIC verarbeitet wird (kein Bundle-Ballast sonst).

const HEIC_RE = /\.(heic|heif)$/i

export function isHeic(file) {
  if (!file) return false
  return HEIC_RE.test(file.name || '') || file.type === 'image/heic' || file.type === 'image/heif'
}

// Gibt bei HEIC ein neues JPEG-File zurück, sonst die Originaldatei unverändert.
// Bei Konvertierungsfehler wird die Originaldatei zurückgegeben (der aufrufende
// Upload-Code behandelt einen evtl. folgenden Fehler dann wie gehabt).
export async function convertHeicIfNeeded(file) {
  if (!isHeic(file)) return file
  try {
    const heic2any = (await import('heic2any')).default
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 })
    const blob = Array.isArray(out) ? out[0] : out
    const baseName = (file.name || 'foto').replace(HEIC_RE, '')
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' })
  } catch (e) {
    console.error('HEIC-Konvertierung fehlgeschlagen:', e)
    return file
  }
}
