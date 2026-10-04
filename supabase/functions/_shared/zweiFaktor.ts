// v5.42.0 — Zwei-Faktor-Stufe aus dem Login-Token lesen.
// Der Token wurde vorher über /auth/v1/user (bzw. auth.getUser) geprüft — hier
// wird nur noch der Inhalt gelesen. „aal2“ = Code aus der Authenticator-App
// wurde bei dieser Anmeldung eingegeben.
export const PFLICHT_ROLLEN = ['admin', 'manager']

export function aalVon(token: string): string | null {
  try {
    let teil = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    while (teil.length % 4) teil += '='
    return JSON.parse(atob(teil))?.aal ?? null
  } catch (_e) {
    return null
  }
}

// true = darf weiter; false = Admin/Manager ohne Code
export function zweiFaktorOk(rollen: string[], token: string): boolean {
  if (!rollen.some((r) => PFLICHT_ROLLEN.includes(r))) return true
  return aalVon(token) === 'aal2'
}
