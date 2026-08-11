/**
 * v4.28.0 — Beobachtungsliste: Rechenkern und Datenzugriff.
 *
 * "Beobachten" heißt: ein Model oder Chatter wird für eine gewählte Zahl von
 * Tagen markiert, und in der Admin-Glocke steht ab dann einmal täglich, wie es
 * sich seit dem Markieren entwickelt hat — auch bei guter Entwicklung. Läuft die
 * Frist ab, kommt genau eine Abschlussmeldung: besser oder nicht besser.
 *
 * Kein Rendering hier. Wie bei den Chatter-Zielen liegt die Rechnung in einer
 * eigenen Datei, damit Model-Ansicht, Chatter-Ansicht und Glocke nicht
 * auseinanderlaufen können.
 */

import { supabase } from './supabase'

// v4.29.0: Die Zahl meint GEARBEITETE Tage, nicht Kalendertage.
export const BEOBACHTUNG_DAUERN = [3, 7, 14]

// Notbremse: nach so vielen Kalendertagen endet eine Beobachtung auch dann,
// wenn die gearbeiteten Tage nie zusammenkommen (Chatter ist weg, Model pausiert).
// Ohne das läge ein Eintrag ewig auf der Liste.
export const NOTBREMSE_TAGE = 90

// Chatter-Tage darunter gelten als nicht gearbeitet und verzerren den Schnitt.
const MIN_AKTIVMINUTEN = 90

const norm = (s) => (s || '').trim().toLowerCase()

export function heuteIso() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
}

export function plusTage(iso, n) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Laufende Beobachtungen. Rückgabe: Array der Einträge. */
export async function ladeBeobachtungen() {
  const { data, error } = await supabase
    .from('watchlist').select('*').is('beendet_am', null)
    .order('start_datum', { ascending: false })
  if (error) { console.warn('watchlist laden fehlgeschlagen:', error.message); return [] }
  return data || []
}

/** Map für die schnelle Prüfung "steht der schon drauf?" */
export function beobachtungsMap(eintraege) {
  const map = {}
  for (const e of eintraege || []) map[`${e.subjekt_typ}::${norm(e.subjekt_name)}`] = e
  return map
}

export async function starteBeobachtung({ typ, name, tage, notiz = null, startDatum = null }) {
  const start = startDatum || heuteIso()
  let actor = null
  try {
    const { data } = await supabase.auth.getUser()
    actor = data?.user?.user_metadata?.full_name || data?.user?.email || null
  } catch { /* Urheber ist nice-to-have */ }
  const { error } = await supabase.from('watchlist').insert({
    subjekt_typ: typ,
    subjekt_name: name,
    start_datum: start,
    // v4.29.0: `dauer_tage` zählt gearbeitete Tage — das ist die eigentliche
    // Laufzeit. `bis_datum` ist nur noch die Notbremse.
    dauer_tage: tage,
    bis_datum: plusTage(start, NOTBREMSE_TAGE),
    notiz,
    erstellt_von: actor,
  })
  if (error) {
    // Der Partial-Unique-Index greift, wenn schon eine Beobachtung läuft.
    console.warn('Beobachtung anlegen fehlgeschlagen:', error.message)
    return { ok: false, fehler: error.message }
  }
  return { ok: true }
}

export async function beendeBeobachtung(id) {
  const { error } = await supabase.from('watchlist')
    .update({ beendet_am: new Date().toISOString() }).eq('id', id)
  if (error) { console.warn('Beobachtung beenden fehlgeschlagen:', error.message); return false }
  return true
}

/** Merkt, dass die Abschlussmeldung raus ist — damit sie nicht täglich wiederkommt. */
export async function quittiereAbschluss(id, datum) {
  const { error } = await supabase.from('watchlist')
    .update({ abschluss_gemeldet_am: datum }).eq('id', id)
  if (error) console.warn('Abschluss quittieren fehlgeschlagen:', error.message)
}

export async function ladeModelAliase() {
  const { data, error } = await supabase.from('model_aliases').select('csv_name, model_name')
  if (error) { console.warn('model_aliases laden fehlgeschlagen:', error.message); return {} }
  const map = {}
  for (const a of data || []) map[a.csv_name] = a.model_name
  return map
}

export const modelGruppe = (aliase, csvName) => aliase?.[csvName] || csvName

/**
 * Tageswerte eines Subjekts.
 *
 * Model:   Messages + Tips pro Tag — dieselbe Grundlage wie das Tagesziel.
 *          Subs bleiben außen vor, die kommen monatlich rein und würden einen
 *          einzelnen Tag völlig verzerren.
 * Chatter: Umsatz und $/Std, nur an Tagen mit echter Aktivität.
 */
function tageswerte({ typ, name, modelSnapshots = [], chatterSnapshots = [], aliase = {} }) {
  const werte = []
  if (typ === 'model') {
    for (const s of modelSnapshots) {
      let summe = 0, treffer = false
      for (const r of s.rows || []) {
        if (modelGruppe(aliase, r.creator) !== name) continue
        treffer = true
        summe += (r.messageRevenue || 0) + (r.tipsRevenue || 0)
      }
      if (treffer) werte.push({ datum: s.businessDate, wert: summe, rph: null })
    }
  } else {
    for (const s of chatterSnapshots) {
      const r = (s.rows || []).find(rr => norm(rr.name) === norm(name))
      if (!r) continue
      if ((r.activeMinutes || 0) < MIN_AKTIVMINUTEN) continue
      werte.push({ datum: s.businessDate, wert: r.revenue || 0, rph: r.revenuePerHour || 0 })
    }
  }
  return werte.sort((a, b) => a.datum.localeCompare(b.datum))
}

const mittel = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/**
 * Entwicklung seit Beobachtungsbeginn.
 *
 * v4.29.0: Gezählt werden **gearbeitete Tage**, nicht Kalendertage.
 *
 * Vorher lief eine 7-Tage-Beobachtung nach einer Kalenderwoche ab. Wer dreimal
 * die Woche arbeitet, bekam dadurch eine "Auswertung" über drei gearbeitete
 * Tage — und an den Tagen ohne Schicht eine Meldung, obwohl es nichts Neues
 * gab. Jetzt zählt nur, was auch Zahlen geliefert hat.
 *
 * Der Vergleichszeitraum davor ist aus demselben Grund gleich lang gewählt:
 * die letzten `dauer_tage` gearbeiteten Tage VOR dem Start gegen die
 * gearbeiteten Tage seit Start. Gleiches gegen Gleiches.
 *
 * Solange seit dem Start noch kein Tag mit Daten vorliegt, gibt es bewusst kein
 * Urteil (`richtung: 'zu-frueh'`) statt einer Zahl, die nichts aussagt.
 */
export function beobachtungsFortschritt(eintrag, { modelSnapshots, chatterSnapshots, aliase, bis = null }) {
  const bisTag = bis || heuteIso()
  const werte = tageswerte({
    typ: eintrag.subjekt_typ, name: eintrag.subjekt_name, modelSnapshots, chatterSnapshots, aliase,
  })
  // Altbestand ohne dauer_tage: aus der ursprünglichen Kalenderspanne ableiten.
  const dauer = Number(eintrag.dauer_tage) > 0
    ? Number(eintrag.dauer_tage)
    : Math.max(1, Math.round(
        (new Date(eintrag.bis_datum + 'T12:00:00') - new Date(eintrag.start_datum + 'T12:00:00')) / 86400000
      ))
  const vorher = werte.filter(w => w.datum < eintrag.start_datum).slice(-dauer)
  const seither = werte.filter(w => w.datum >= eintrag.start_datum && w.datum <= bisTag)

  const vorherWert = mittel(vorher.map(w => w.wert))
  const seitherWert = mittel(seither.map(w => w.wert))
  const vorherRph = mittel(vorher.filter(w => w.rph != null).map(w => w.rph))
  const seitherRph = mittel(seither.filter(w => w.rph != null).map(w => w.rph))

  let deltaPct = null
  if (vorherWert != null && seitherWert != null && vorherWert > 0) {
    deltaPct = ((seitherWert - vorherWert) / vorherWert) * 100
  }

  let richtung = 'unklar'
  if (seither.length === 0) richtung = 'zu-frueh'
  else if (vorherWert == null || vorherWert === 0) richtung = 'kein-vergleich'
  else if (deltaPct >= 10) richtung = 'besser'
  else if (deltaPct <= -10) richtung = 'schlechter'
  else richtung = 'gleich'

  // Abgelaufen ist die Beobachtung, wenn die gearbeiteten Tage voll sind — oder
  // wenn die Notbremse greift, weil seit Wochen nichts mehr kommt.
  const notbremse = !!eintrag.bis_datum && bisTag > eintrag.bis_datum

  return {
    vorherWert, seitherWert, vorherRph, seitherRph, deltaPct, richtung,
    tageMitDaten: seither.length,
    tageGesamt: dauer,
    tageVergangen: Math.min(seither.length, dauer),
    vergleichsTage: vorher.length,
    letzterDatentag: werte.length ? werte[werte.length - 1].datum : null,
    abgelaufen: seither.length >= dauer || notbremse,
    perNotbremse: notbremse && seither.length < dauer,
  }
}

const geld = (v) => (v == null ? '—' : `$${Math.round(v)}`)

/** Ein Satz für die Glocke. */
export function fortschrittsText(eintrag, f) {
  const wer = eintrag.subjekt_typ === 'model' ? 'Msg+Tips/Tag' : 'Umsatz/Tag'
  if (f.richtung === 'zu-frueh') return `Seit ${eintrag.start_datum} noch kein gearbeiteter Tag mit Zahlen.`
  if (f.richtung === 'kein-vergleich') return `${wer} aktuell ${geld(f.seitherWert)} · kein Vergleichszeitraum davor vorhanden.`
  const pfeil = f.richtung === 'besser' ? '▲' : f.richtung === 'schlechter' ? '▼' : '▬'
  const rphText = (eintrag.subjekt_typ === 'chatter' && f.vorherRph != null && f.seitherRph != null)
    ? ` · ${Math.round(f.vorherRph)} → ${Math.round(f.seitherRph)} $/Std`
    : ''
  return `${pfeil} ${wer} ${geld(f.vorherWert)} → ${geld(f.seitherWert)} (${f.deltaPct >= 0 ? '+' : ''}${f.deltaPct.toFixed(0)}%)${rphText}`
}

export const RICHTUNG_FARBE = {
  besser: '#10b981',
  schlechter: '#ef4444',
  gleich: '#f59e0b',
  'zu-frueh': '#8888aa',
  'kein-vergleich': '#8888aa',
  unklar: '#8888aa',
}

/**
 * Tagesmeldungen für die Glocke.
 *
 * Der Zeitstempel ist der heutige Tag um 08:00 Berliner Zeit — dadurch ist jede
 * Meldung genau einmal pro Tag ungelesen. Ein `new Date()` hier würde die Glocke
 * bei jedem Neuladen wieder rot machen.
 */
export function beobachtungsMeldungen(eintraege, { modelSnapshots, chatterSnapshots, aliase, heute = null }) {
  const tag = heute || heuteIso()
  const when = new Date(tag + 'T08:00:00').toISOString()

  // Jüngster Datenstand je Typ. Maßstab ist NICHT das Kalenderheute: die CSVs
  // werden nachträglich hochgeladen, "heute" hat also fast nie schon Zahlen.
  const letzterTag = (snaps) => (snaps || []).reduce(
    (max, s) => (!max || s.businessDate > max ? s.businessDate : max), null)
  const datenStand = {
    model: letzterTag(modelSnapshots),
    chatter: letzterTag(chatterSnapshots),
  }

  const meldungen = []
  for (const e of eintraege || []) {
    const f = beobachtungsFortschritt(e, { modelSnapshots, chatterSnapshots, aliase, bis: tag })
    const abschluss = f.abgelaufen && e.abschluss_gemeldet_am !== tag
    const label = e.subjekt_typ === 'model' ? 'Model' : 'Chatter'

    // v4.29.0: Keine Meldung an Tagen ohne neue Zahlen. Wer zweimal die Woche
    // arbeitet, bekam sonst fünfmal die Woche dieselbe Zeile — und genau so
    // gewöhnt man sich ab, hinzuschauen. Ein fälliger Abschluss geht trotzdem
    // raus, sonst bliebe der Eintrag unbemerkt liegen.
    const stand = datenStand[e.subjekt_typ]
    const neueZahlen = !!f.letzterDatentag && f.letzterDatentag === stand
    if (!neueZahlen && !abschluss) continue

    meldungen.push({
      eintrag: e,
      fortschritt: f,
      abschluss,
      when,
      severity: f.richtung === 'schlechter' ? 'warning' : 'info',
      titel: abschluss
        ? (f.perNotbremse
            ? `Beobachtung beendet — keine neuen Zahlen · ${e.subjekt_name} (${label})`
            : `Beobachtung beendet · ${e.subjekt_name} (${label})`)
        : `Beobachtung · ${f.tageVergangen}/${f.tageGesamt} gearbeitete Tage · ${e.subjekt_name} (${label})`,
      text: [fortschrittsText(e, f), e.notiz].filter(Boolean).join(' · '),
    })
  }
  return meldungen
}
