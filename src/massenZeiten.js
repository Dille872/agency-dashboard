// ── Schichtzeiten für Massennachrichten (v5.51.0) ──────────────────────────
// Reine Rechenlogik zu MassenSchichten.jsx, ohne React und ohne Datenbank.
// Die Zeilen kommen aus der Funktion massen_schichtzeiten() (sql/massen-
// schichtzeiten.sql): eine Zeile je Account × Tag × Schicht, Zeit als Text
// wie im Dienstplan („10:00-16:00“, auch „21:00-01.00“ oder „20“).
// Alles in deutscher Zeit, so wie der Dienstplan.

export const SCHICHTEN = ['Vorschicht', 'Früh', 'Spät', 'Nacht']
export const SCHICHT_FARBE = { Vorschicht: '#3b82f6', 'Früh': '#10b981', 'Spät': '#f59e0b', Nacht: '#7c3aed' }
const FALLBACK_MIN = 240   // ohne Ende: 4 Stunden (wie im Jetzt-Screen)

export function plusTage(iso, n) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export function montagVon(tag) {
  const d = new Date(tag + 'T12:00:00Z')
  return plusTage(tag, -((d.getUTCDay() + 6) % 7))
}
export const heuteBerlin = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
export function jetztMinBerlin() {
  const t = new Date().toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false })
  const [h, m] = t.split(':').map(Number)
  return (h % 24) * 60 + m
}
export function kwVon(montag) {
  const d = new Date(montag + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 3)
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  return 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7)
}
export const tagKurz = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('de-DE', { weekday: 'short', timeZone: 'UTC' }).replace('.', '')
export const tagDatum = (iso) => iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.'

const UHR = /^(\d{1,2})(?::(\d{1,2}))?$/
function minuten(raw) {
  const m = String(raw || '').trim().replace(/\./g, ':').match(UHR)
  if (!m) return null
  const h = Number(m[1]), min = m[2] ? Number(m[2]) : 0
  if (h > 24 || min > 59) return null
  return (h % 24) * 60 + min
}
export const uhrText = (min) => {
  const x = ((min % 1440) + 1440) % 1440
  return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0')
}

// „10:00-16:00“ → { von: 600, bis: 960 } (Minuten ab Mitternacht des Plantags;
// bis > 1440 = über Mitternacht). Unlesbar → null, dann zeigen wir den Text.
export function spanne(zeit) {
  const s = String(zeit || '').replace(/\s*\(DE\)/gi, '').trim()
  if (!s) return null
  const [a, b] = s.split(/\s*[-–]\s*/)
  const von = minuten(a)
  if (von === null) return null
  let bis = b !== undefined && b !== '' ? minuten(b) : null
  if (bis === null) bis = von + FALLBACK_MIN
  else if (bis <= von) bis += 1440
  return { von, bis, ohneEnde: !(b !== undefined && b !== '' && minuten(b) !== null) }
}

// Zeilen (je Account) → je Tag die Models mit ihren Schichten und Accounts.
// { '2026-10-14': [ { model, accounts: ['sandra wayne VIP', …], schichten: [{ schicht, zeit, von, bis }] } ] }
export function nachTagen(zeilen = []) {
  const tage = {}
  for (const z of zeilen) {
    const tag = String(z.datum).slice(0, 10)
    const liste = tage[tag] || (tage[tag] = [])
    let m = liste.find(x => x.model === z.model)
    if (!m) { m = { model: z.model, accounts: [], schichten: [] }; liste.push(m) }
    if (!m.accounts.includes(z.account)) m.accounts.push(z.account)
    if (!m.schichten.some(s => s.schicht === z.schicht)) {
      const sp = spanne(z.zeit)
      m.schichten.push({ schicht: z.schicht, zeit: z.zeit, von: sp?.von ?? null, bis: sp?.bis ?? null, ohneEnde: !!sp?.ohneEnde })
    }
  }
  for (const liste of Object.values(tage)) {
    liste.sort((a, b) => a.model.localeCompare(b.model, 'de'))
    for (const m of liste) {
      m.schichten.sort((a, b) => SCHICHTEN.indexOf(a.schicht) - SCHICHTEN.indexOf(b.schicht))
      m.accounts.sort((a, b) => a.localeCompare(b, 'de'))
    }
  }
  return tage
}

// Beginn und Ende aller Schichten eines Tages, nach Uhrzeit
export function wechselVon(models = []) {
  const w = []
  for (const m of models) for (const s of m.schichten) {
    if (s.von === null) continue
    w.push({ min: s.von, model: m.model, schicht: s.schicht, art: 'beginnt' })
    if (!s.ohneEnde) w.push({ min: s.bis, model: m.model, schicht: s.schicht, art: 'endet' })
  }
  return w.sort((a, b) => a.min - b.min || (a.art === 'endet' ? -1 : 1) || a.model.localeCompare(b.model, 'de'))
}

// Achse des Tages: ab der vollen Stunde des frühesten Beginns, 24 Stunden lang
export function achseVon(models = []) {
  const starts = models.flatMap(m => m.schichten.map(s => s.von)).filter(v => v !== null)
  const ab = starts.length ? Math.floor(Math.min(...starts) / 60) * 60 : 6 * 60
  return { ab, bis: ab + 1440 }
}

// Woche als Text zum Kopieren
export function wocheAlsText(montag, tage) {
  const zeilen = [`Schichtzeiten KW ${kwVon(montag)} (${tagDatum(montag)}–${tagDatum(plusTage(montag, 6))}) · deutsche Zeit`]
  for (let i = 0; i < 7; i++) {
    const tag = plusTage(montag, i)
    const models = tage[tag] || []
    zeilen.push('', `${tagKurz(tag)} ${tagDatum(tag)}`)
    if (!models.length) { zeilen.push('  keine Schichten'); continue }
    for (const m of models) {
      zeilen.push(`  ${m.model} (${m.accounts.join(', ')}): ` + m.schichten.map(s => `${s.schicht} ${s.von !== null ? uhrText(s.von) + '–' + (s.ohneEnde ? '?' : uhrText(s.bis)) : s.zeit}`).join(' · '))
    }
  }
  return zeilen.join('\n')
}
