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
  // v5.27.0: Storyteller / Script Builder — Bereich Skripte (zusätzlich zu Social, falls vorhanden)
  if (tab === 'skripte' && ['storyteller', 'script_builder'].some(r => rollen.includes(r))) return true
  if (userRole === 'dienstplan') return ['schedule', 'chatters-comm', 'kalender'].includes(tab)
  if (userRole === 'creator_manager') return ['models-comm', 'kalender'].includes(tab)
  // v5.1.0: Social-Leitung — der ganze Bereich Social Media (alle Unterreiter), sonst nichts
  if (rollen.includes('social_leitung') || userRole === 'social_leitung') return tab === 'social' || tab.startsWith('social-')
  // v4.106.0: Poster und Cutter landen im Social Media Manager (nur ihre Accounts)
  if (['social_media', 'cutter', 'social_freigabe'].some(r => rollen.includes(r))) return ['social'].includes(tab)
  return false
}

// Startansicht, wenn die Adresszeile nichts Erlaubtes vorgibt.
export function startTab(userRole, userRoles) {
  const rollen = Array.isArray(userRoles) ? userRoles : []
  if (userRole === 'dienstplan') return 'schedule'
  if (userRole === 'creator_manager') return 'models-comm'
  if (userRole !== 'admin' && userRole !== 'manager' && ['social_media', 'cutter', 'social_leitung', 'social_freigabe'].some(r => rollen.includes(r))) return 'social'
  if (userRole !== 'admin' && userRole !== 'manager' && ['storyteller', 'script_builder'].some(r => rollen.includes(r))) return 'skripte'
  return 'models'
}
