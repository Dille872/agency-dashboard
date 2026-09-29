import { createContext, useContext } from 'react'

// ── Vorschau „als Social-Person ansehen“ (v5.2.0) ──────────────────────────
// Admins und Social-Leitung können unter Social Media → Steuerung → Team
// die Ansicht einer Person öffnen (Poster/Cutter). In der Vorschau wird
// NICHTS gespeichert: jede Aktion ruft vorschauSperre() und bricht ab.
// Welche Daten sichtbar sind, filtert SocialManager selbst nach Rolle und
// Zuteilung der Person (Admins sehen per RLS alles).

export const VorschauContext = createContext(false)
export const useVorschau = () => useContext(VorschauContext)
export function vorschauSperre() {
  try { window.alert('👁 Vorschau – hier wird nichts gespeichert.') } catch { /* egal */ }
  return true
}
