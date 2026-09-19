// v4.60.0: Zeitzonen-Helfer für den Team-Kalender.
//
// Grundregel wie im Dienstplan: EINGEGEBEN wird in deutscher Zeit
// (Europe/Berlin), GESPEICHERT als fester Zeitpunkt (timestamptz),
// ANGEZEIGT in der Zeit des Browsers — jeder sieht seine eigene Uhrzeit.

export const BERLIN = 'Europe/Berlin'

// Zeitzone laut Geräte-Uhr (Browser liest sie vom Betriebssystem, NICHT aus
// der IP — ein VPN ändert daran nichts), z. B. "Asia/Bangkok"
export const geraeteZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || BERLIN } catch { return BERLIN }
}

// v4.63.0: bewusst gewählte Zone (Portal „Meine Zeitzone") hat Vorrang vor
// der Geräte-Uhr. Gesetzt vom ZeitzonenHinweis.
let gewaehlteZone = null
export const setzeMeineZone = (zone) => { gewaehlteZone = zone || null }
export const meineZone = () => gewaehlteZone || geraeteZone()

// Alle Zonen für die Auswahl (moderne Browser), sonst eine kurze Liste
export const alleZonen = () => {
  try { if (Intl.supportedValuesOf) return Intl.supportedValuesOf('timeZone') } catch {}
  return ['Europe/Berlin', 'Asia/Nicosia', 'Asia/Bangkok', 'America/Argentina/Buenos_Aires', 'Europe/London', 'America/New_York', 'Asia/Dubai', 'Asia/Manila']
}

// Versatz einer Zone zu UTC in Minuten an einem bestimmten Zeitpunkt
export function versatzMinuten(zone, datum = new Date()) {
  const teile = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(datum).reduce((o, p) => (o[p.type] = p.value, o), {})
  const alsUtc = Date.UTC(+teile.year, +teile.month - 1, +teile.day, +teile.hour, +teile.minute, +teile.second)
  return Math.round((alsUtc - datum.getTime()) / 60000)
}

// "2026-09-19" + "22:15" in einer Zone → Date (echter Zeitpunkt).
// Zweimal angenähert, damit auch Tage mit Zeitumstellung stimmen.
export function wandzeitZuDatum(tagIso, uhrzeit, zone = BERLIN) {
  const [y, m, d] = tagIso.split('-').map(Number)
  const [h, min] = (uhrzeit || '00:00').split(':').map(Number)
  const naiv = Date.UTC(y, m - 1, d, h || 0, min || 0)
  let t = naiv - versatzMinuten(zone, new Date(naiv)) * 60000
  t = naiv - versatzMinuten(zone, new Date(t)) * 60000
  return new Date(t)
}

// Date → { tag: "2026-09-19", zeit: "22:15" } in einer Zone
export function datumInZone(datum, zone) {
  const d = datum instanceof Date ? datum : new Date(datum)
  return {
    tag: d.toLocaleDateString('sv-SE', { timeZone: zone }),
    zeit: d.toLocaleTimeString('de-DE', { timeZone: zone, hour: '2-digit', minute: '2-digit' }),
  }
}

export const zeitIn = (datum, zone) => datumInZone(datum, zone).zeit
export const tagLabel = (datum, zone) => new Date(datum).toLocaleDateString('de-DE', { timeZone: zone, weekday: 'short', day: '2-digit', month: '2-digit' })

// "UTC+3" für die Anzeige
export function utcLabel(zone, datum = new Date()) {
  const v = versatzMinuten(zone, datum)
  const h = Math.trunc(Math.abs(v) / 60), m = Math.abs(v) % 60
  return `UTC${v >= 0 ? '+' : '−'}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`
}

// Lesbarer Ortsname aus "America/Argentina/Buenos_Aires" → "Buenos Aires"
export const ortAus = (zone) => String(zone || '').split('/').pop().replace(/_/g, ' ')

// Zonen, die im Team vorkommen — nur für die Vorschau beim Anlegen.
export const TEAM_ZONEN = [
  { zone: 'Europe/Berlin', ort: 'Deutschland' },
  { zone: 'Asia/Nicosia', ort: 'Zypern' },
  { zone: 'Asia/Bangkok', ort: 'Thailand' },
  { zone: 'America/Argentina/Buenos_Aires', ort: 'Argentinien' },
]
