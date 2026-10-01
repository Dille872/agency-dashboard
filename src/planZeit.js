// ── Zeitzone pro Account (v5.10.0) ─────────────────────────────────────────
// Entscheidung Chris (01.10.): Der Posting-Plan zeigt und nimmt Zeiten in der
// Zeit des ACCOUNTS (Publikum), nicht in der Zeit des Geräts. US-Account
// @sandy.lane99 → Los Angeles. Alle sehen „18:00 LA“, klein daneben die
// deutsche Zeit. Gespeichert wird wie immer ein Zeitpunkt (timestamptz).
//
// Zeitzone steht in model_social_service.account_modus[@handle].zeitzone,
// fehlt sie: Europe/Berlin. Einstellbar in Social Media → Steuerung.

export const STANDARD = 'Europe/Berlin'
export const ZONEN = [
  { id: 'Europe/Berlin', kurz: 'DE', name: 'Deutschland', en: 'Germany' },
  { id: 'America/Los_Angeles', kurz: 'LA', name: 'Los Angeles (US-Westküste)', en: 'Los Angeles (US West)' },
  { id: 'America/Chicago', kurz: 'Chicago', name: 'Chicago (US-Mitte)', en: 'Chicago (US Central)' },
  { id: 'America/New_York', kurz: 'NY', name: 'New York (US-Ostküste)', en: 'New York (US East)' },
]
export const zoneKurz = (z) => ZONEN.find(x => x.id === z)?.kurz || z
export const geraeteZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || STANDARD } catch { return STANDARD } }

const p2 = (n) => String(n).padStart(2, '0')
const fmt = {}
function teile(ms, zone) {
  const f = fmt[zone] || (fmt[zone] = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }))
  const o = {}
  for (const t of f.formatToParts(new Date(ms))) o[t.type] = t.value
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour === 24 ? 0 : +o.hour, mi: +o.minute }
}
// Abstand der Zone zu UTC (ms) zum Zeitpunkt ms
function versatz(ms, zone) {
  const t = teile(ms, zone)
  return Date.UTC(t.y, t.m - 1, t.d, t.h, t.mi) - Math.floor(ms / 60000) * 60000
}

// 'YYYY-MM-DD' des Zeitpunkts in der Zone
export function tagIn(iso, zone = STANDARD) { const t = teile(new Date(iso).getTime(), zone); return `${t.y}-${p2(t.m)}-${p2(t.d)}` }
// 'HH:MM' in der Zone
export function uhrIn(iso, zone = STANDARD) { const t = teile(new Date(iso).getTime(), zone); return `${p2(t.h)}:${p2(t.mi)}` }
// Wert für <input type="datetime-local"> in der Zone
export function inputWert(iso, zone = STANDARD) {
  if (!iso) return ''
  const t = teile(new Date(iso).getTime(), zone)
  return `${t.y}-${p2(t.m)}-${p2(t.d)}T${p2(t.h)}:${p2(t.mi)}`
}
// 'YYYY-MM-DDTHH:MM' als Uhrzeit in der Zone → ISO-Zeitpunkt
export function vonInput(wert, zone = STANDARD) {
  const m = String(wert || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return null
  const geraten = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
  let utc = geraten - versatz(geraten, zone)
  const v2 = versatz(utc, zone)
  if (geraten - v2 !== utc) utc = geraten - v2   // Sommer-/Winterzeit-Grenze
  return new Date(utc).toISOString()
}
// Kalendertag eines lokalen Date (Raster im Plan)
export const lokalerTag = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
// Wochentag kurz in der Zone, z. B. „Do“
export function wochentagIn(iso, zone, loc = 'de-DE') {
  return new Date(iso).toLocaleDateString(loc, { timeZone: zone, weekday: 'short' }).replace('.', '')
}
