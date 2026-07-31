import React, { useId } from 'react'

// v4.7.0: EIN Logo für alle Oberflächen.
// Vorher hatte jede Ansicht ihr eigenes Zeichen — Admin: Raute mit Lila-Verlauf,
// Chatter-Portal: "T" in Cyan/Lila, Model-Portal: "T" in Orange/Rot,
// Login: "A" in Lila/Cyan, Passwort-Seite: "T" in Lila/Indigo. Das sah nach vier
// verschiedenen Produkten aus. Maßgeblich ist die Adminseite: Raute mit Verlauf
// #8b8cf9 → #c98bff.
//
// Wenn das Logo je geändert wird: NUR hier anfassen, nicht wieder in die Header kopieren.
export default function Logo({ size = 28 }) {
  // Die Verlaufs-ID muss pro Instanz eindeutig sein — liegen zwei Logos auf
  // derselben Seite, würden sie sich sonst dieselbe <linearGradient> teilen.
  // useId liefert Doppelpunkte (":r1:"), die in url(#…) nichts zu suchen haben.
  const gradId = `logoGrad-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Thirteen 87 Collective">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b8cf9" />
          <stop offset="1" stopColor="#c98bff" />
        </linearGradient>
      </defs>
      <path d="M14 3 L24 13 L14 25 L4 13 Z" stroke={`url(#${gradId})`} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M7 13 L21 13" stroke={`url(#${gradId})`} strokeWidth="1" />
      <path d="M14 3 L7 13 L14 25 M14 3 L21 13 L14 25" stroke={`url(#${gradId})`} strokeWidth="1" strokeOpacity="0.55" />
    </svg>
  )
}
