// ── Links ins Dashboard ────────────────────────────────────────────────────
//
// v4.68.0. Bis hierher endete jede Bot-Meldung mit "schau im Dashboard nach".
// Wohin, stand nirgends — und konnte auch nicht dort stehen, weil die
// geoeffnete Ansicht nur im React-State lag und keine eigene Adresse hatte.
// Seit v4.68.0 steht sie in der Adresszeile (src/route.js), also kann eine
// Meldung jetzt direkt auf die Stelle zeigen, um die es geht.
//
// Die Basis kommt aus dem Secret DASHBOARD_URL, damit eine spaetere Domain
// nicht in jeder Function einzeln nachgezogen werden muss.

const BASIS = (Deno.env.get('DASHBOARD_URL') || 'https://dashboard.thirteen87collective.com')
  .replace(/\/+$/, '')

export function dashboardLink(tab: string, ziel?: string, id?: string | number): string {
  const p = new URLSearchParams()
  p.set('tab', tab)
  if (ziel) p.set('ziel', ziel)
  if (id !== undefined && id !== null && String(id) !== '') p.set('id', String(id))
  return `${BASIS}/?${p.toString()}`
}

// Fertige Schlusszeile fuer eine Telegram-Nachricht (parse_mode HTML).
// Beschriftung ist immer unser eigener, fester Text — nie Nutzereingabe.
export function linkZeile(beschriftung: string, tab: string, ziel?: string, id?: string | number): string {
  return `\n\n<a href="${dashboardLink(tab, ziel, id)}">${beschriftung}</a>`
}
