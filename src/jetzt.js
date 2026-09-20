// ── Jetzt: wer arbeitet gerade, was ist schief ──────────────────────────────
//
// v4.71.0. Reine Rechenlogik für den Jetzt-Screen (JetztView.jsx), ohne React.
// Liegt getrennt, damit sich die Regeln lesen lassen, ohne durch JSX zu scrollen.
//
// DIENSTPLAN IST DEUTSCHE ZEIT
// Schichtzeiten im Plan sind Berliner Wandzeit ("08:00-14:00"). Umgerechnet
// wird in echte Zeitpunkte (wandzeitZuDatum), angezeigt in der Zeit des
// Betrachters — dieselbe Regel wie im Team-Kalender.
//
// WER GILT ALS "IN DER SCHICHT"
// Dieselben Regeln wie shift-alert (supabase/functions/shift-alert), damit der
// Screen und die Telegram-Warnung sich nicht widersprechen:
//   - Freischicht (__FREI__) = niemand
//   - geteilte Schicht: die zweite Person mit eigenem Abschnitt
//   - Zell-Override schlägt Standardzeit
//   - wer laut absences abgemeldet ist, fehlt nicht
//   - Check-in zählt ab 60 min vor Schichtbeginn
//   - "fehlt" erst ab Beginn + 10 min (wie die Meldung)
// Anders als shift-alert: Nachtschichten über Mitternacht bleiben bis zu ihrem
// echten Ende sichtbar. Der Alarm braucht das nicht (der Beginn ist längst
// geprüft), wer um 01:00 draufschaut, will die Nachtschicht aber sehen.

import { wandzeitZuDatum, BERLIN } from './zeit'

// Bewusst nicht aus watchlist.js: die Datei zieht den Supabase-Client mit,
// und diese Regeln sollen sich ohne Datenbank pruefen lassen.
export function plusTage(iso, n) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const MELDUNG_AB_MIN = 10
export const CHECKIN_VORLAUF_MIN = 60
const FALLBACK_DAUER_MIN = 240

const lc = (s) => String(s || '').trim().toLowerCase()

// Montag der Woche eines Berliner Kalendertags ("YYYY-MM-DD")
export function montagVon(tag) {
  const d = new Date(tag + 'T12:00:00Z')
  const wt = (d.getUTCDay() + 6) % 7   // Mo = 0
  return plusTage(tag, -wt)
}

const UHR = /^(\d{1,2})(?::(\d{1,2}))?$/
function uhr(raw) {
  if (!raw) return null
  const m = String(raw).trim().replace(/\./g, ':').match(UHR)
  if (!m) return null
  const h = Number(m[1]), min = m[2] ? Number(m[2]) : 0
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

// "08:00-14:00" (auch "21:00-01.00", "20", " (DE)") → { beginn: Date, ende: Date }
export function spanneAlsZeit(raw, tag) {
  if (!raw) return null
  const s = String(raw).replace(/\s*\(DE\)/gi, '').trim()
  if (!s) return null
  const [a, b] = s.split('-')
  const von = uhr(a)
  if (!von) return null
  const beginn = wandzeitZuDatum(tag, von, BERLIN)
  const bis = uhr(b)
  let ende = bis ? wandzeitZuDatum(tag, bis, BERLIN) : new Date(beginn.getTime() + FALLBACK_DAUER_MIN * 60000)
  if (ende <= beginn) ende = wandzeitZuDatum(plusTage(tag, 1), bis, BERLIN) // über Mitternacht
  return { beginn, ende }
}

function abwesend(absences, name, tag, shift) {
  return (absences || []).some(a => {
    if (lc(a.chatter_name) !== lc(name)) return false
    if (tag < a.date_from || tag > a.date_to) return false
    const avail = a.available_shifts
    if (!avail || avail.length === 0) return true
    return !avail.includes(shift)
  })
}

// Alle Schichten aus den übergebenen Dienstplan-Wochen, die zwischen vonTag und
// bisTag (Berliner Plantage) liegen — eine Zeile je arbeitender Person.
export function planSchichten({ wochen, modelName, sichtbar, absences, vonTag, bisTag }) {
  const liste = []
  for (const w of wochen || []) {
    const zeiten = w.shift_times || {}
    for (const [key, val] of Object.entries(w.assignments || {})) {
      if (!val) continue
      const [modelId, tag, shift] = key.split('__')
      if (!tag || !shift || tag < vonTag || tag > bisTag) continue
      if (val.chatter === '__FREI__') continue
      if (sichtbar && !sichtbar.has(String(modelId))) continue
      const standard = spanneAlsZeit(val.time_override, tag) || spanneAlsZeit(zeiten[`${modelId}__${shift}`], tag)
      const personen = []
      if (val.chatter) personen.push({ name: val.chatter, seite: 'a' })
      if (val.trainee_mode === 'split' && val.trainee) personen.push({ name: val.trainee, seite: 'b' })
      for (const p of personen) {
        let spanne = standard
        if (val.trainee_mode === 'split') {
          const von = val[`split_${p.seite}_von`], bis = val[`split_${p.seite}_bis`]
          if (von) spanne = spanneAlsZeit(bis ? `${von}-${bis}` : von, tag) || standard
        }
        if (!spanne) continue
        if (abwesend(absences, p.name, tag, shift)) continue
        liste.push({
          key: `${key}__${p.seite}`,
          person: p.name, shift, tag,
          model: modelName[modelId] || modelId,
          geteilt: val.trainee_mode === 'split',
          ...spanne,
        })
      }
    }
  }
  return liste
}

// Check-in-Stand einer Schicht aus shift_logs
export function checkinStand(schicht, logs, jetzt = new Date()) {
  const ab = schicht.beginn.getTime() - CHECKIN_VORLAUF_MIN * 60000
  const bis = schicht.ende.getTime()
  const passend = (logs || [])
    .filter(l => lc(l.display_name) === lc(schicht.person) && l.checked_in_at)
    .map(l => ({ ...l, t: new Date(l.checked_in_at).getTime() }))
    .filter(l => l.t >= ab && l.t <= bis)
    .sort((a, b) => b.t - a.t)
  const log = passend[0]
  if (log && !log.checked_out_at) return { stand: 'drin', seit: new Date(log.checked_in_at) }
  if (log) return { stand: 'raus', um: new Date(log.checked_out_at) }
  const ueberfaellig = Math.floor((jetzt.getTime() - schicht.beginn.getTime()) / 60000)
  if (ueberfaellig >= MELDUNG_AB_MIN) return { stand: 'fehlt', minuten: ueberfaellig }
  return { stand: 'gleich' }
}

// Letzte n erfasste Tage (Msg+Tips) je Model-Gruppe und daraus: wer liegt
// mindestens drei erfasste Tage in Folge unter Tagesziel. Dieselbe Groesse und
// dieselbe Schwelle wie die roten Tagesbalken (TagesBalken.jsx, v4.70.0).
export function unterZiel({ modelSnapshots, aliasMap, targets, mindestens = 3 }) {
  const tage = [...(modelSnapshots || [])]
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate))
    .slice(-14)
  if (tage.length < mindestens) return []
  const gruppe = (csv) => aliasMap[csv] || csv
  const verlauf = {}
  for (const snap of tage) {
    const pro = {}
    for (const r of snap.rows || []) {
      const g = gruppe(r.creator)
      pro[g] = (pro[g] || 0) + (r.messageRevenue || 0) + (r.tipsRevenue || 0)
    }
    for (const [g, ziel] of Object.entries(targets)) {
      if (!(ziel > 0)) continue
      ;(verlauf[g] ||= []).push(pro[g] || 0)
    }
  }
  const treffer = []
  for (const [g, werte] of Object.entries(verlauf)) {
    const ziel = targets[g]
    let folge = 0
    for (let i = werte.length - 1; i >= 0 && werte[i] < ziel; i--) folge++
    // Ein Model ganz ohne Umsatz ist eher nicht mehr aktiv als "schwach" —
    // das gehört in die Pflege der Ziele, nicht auf den Startscreen.
    if (folge >= mindestens && werte.slice(-folge).some(w => w > 0)) {
      treffer.push({ model: g, tage: folge, letzter: werte[werte.length - 1], ziel })
    }
  }
  return treffer.sort((a, b) => b.tage - a.tage || a.letzter / a.ziel - b.letzter / b.ziel)
}
