// ── Wer darf welchen Tab sehen ─────────────────────────────────────────────
//
// v4.68.0. Diese Regeln standen als canAccess() mitten im Render von App.jsx
// und waren damit erst nach mehreren fruehen returns erreichbar. Seit die
// Ansicht auch aus der Adresszeile kommen kann, braucht der Routing-Effekt
// dieselbe Pruefung — sonst oeffnet ein weitergeleiteter Link einem
// Dienstplaner die Billing-Seite. Deshalb eine Quelle, die beide benutzen.

export function darfAufTab(userRole, userRoles, tab) {
  const rollen = Array.isArray(userRoles) ? userRoles : []
  if (userRole === 'admin') return true
  if (userRole === 'manager') return !['settings', 'billing'].includes(tab)
  if (userRole === 'dienstplan') return ['schedule', 'chatters-comm', 'kalender'].includes(tab)
  if (userRole === 'creator_manager') return ['models-comm', 'kalender'].includes(tab)
  if (rollen.includes('social_media')) return ['social'].includes(tab)
  return false
}

// Startansicht, wenn die Adresszeile nichts Erlaubtes vorgibt.
export function startTab(userRole, userRoles) {
  const rollen = Array.isArray(userRoles) ? userRoles : []
  if (userRole === 'dienstplan') return 'schedule'
  if (userRole === 'creator_manager') return 'models-comm'
  if (userRole !== 'admin' && userRole !== 'manager' && rollen.includes('social_media')) return 'social'
  return 'models'
}
