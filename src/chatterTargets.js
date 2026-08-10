/**
 * v4.27.0 — Chatter-Ziele: Rechenkern.
 *
 * Warum diese Datei existiert:
 * Bis v4.26.0 standen die Schwellen ($100/Std, $60/Std) als Zahlen mitten in
 * `ChattersView.jsx`. Sie galten für alle gleich, für jede Schicht gleich, und
 * sie schauten immer nur auf EINEN Tag. Dadurch war der Fall, um den es
 * eigentlich geht, unsichtbar: ein Chatter mit ordentlichen $/Std, der aber so
 * wenige Schichten hat, dass am Monatsende zu wenig Provision übrig bleibt.
 *
 * Hier liegt jetzt die gesamte Rechnung, damit Chatter-Ansicht und Admin-Glocke
 * garantiert dasselbe sagen. Kein Rendering in dieser Datei.
 *
 * Zwei Kennzahlen, bewusst nebeneinander:
 *   $/Aktivstunde   — Umsatz / Aktivminuten aus der CSV. Misst reine Chat-Zeit.
 *   $/Schichtstunde — Umsatz / Zeit zwischen Check-in und Check-out (shift_logs).
 * Klaffen die auseinander, ist genau das die Information: jemand ist in der
 * Schicht eingeloggt, aber nicht am Chatten.
 */

import { supabase } from './supabase'

export const ZIEL_SCHICHTEN = ['Vorschicht', 'Früh', 'Spät', 'Nacht']

// Fallback, solange für einen Chatter nichts in `chatter_targets` steht.
// Entspricht den bis v4.26.0 hartcodierten Werten — die Nacht bekommt einen
// niedrigeren Wert, weil sie sonst dauerhaft rot wäre.
export const STANDARD_ZIEL = {
  min_rph: 100,
  min_rph_vorschicht: null,
  min_rph_frueh: null,
  min_rph_spaet: null,
  min_rph_nacht: 70,
  monatsziel_verdienst: null,
  provision_pct: 15,
  _standard: true,
}

// Ab hier gilt ein Tag als "gearbeitet" — darunter ist die Datenlage zu dünn
// für ein Urteil (identisch zur bisherigen Logik in ChattersView).
export const MIN_AKTIVMINUTEN = 90

const SCHICHT_SPALTE = {
  'Vorschicht': 'min_rph_vorschicht',
  'Früh': 'min_rph_frueh',
  'Spät': 'min_rph_spaet',
  'Nacht': 'min_rph_nacht',
}

const norm = (s) => (s || '').trim().toLowerCase()

function berlinTag(iso) {
  try { return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }) }
  catch { return null }
}

/** Zielwerte laden. Rückgabe: Map (kleingeschriebener Name -> Zielobjekt). */
export async function ladeChatterZiele() {
  const { data, error } = await supabase.from('chatter_targets').select('*')
  if (error) { console.warn('chatter_targets laden fehlgeschlagen:', error.message); return {} }
  const map = {}
  for (const z of data || []) map[norm(z.chatter_name)] = z
  return map
}

export function zielFuer(ziele, name) {
  return ziele?.[norm(name)] || STANDARD_ZIEL
}

/** Mindest-$/Std einer einzelnen Schicht. Fällt auf den Grundwert zurück. */
export function minRphFuerSchicht(ziel, schicht) {
  const z = ziel || STANDARD_ZIEL
  const spezifisch = z[SCHICHT_SPALTE[schicht]]
  if (spezifisch != null && spezifisch !== '') return Number(spezifisch)
  if (z.min_rph != null && z.min_rph !== '') return Number(z.min_rph)
  return Number(STANDARD_ZIEL.min_rph)
}

/**
 * Schichtstunden aus `shift_logs`.
 *
 * Rückgabe: { [nameLc]: { [tagIso]: { stunden, proSchicht: {Nacht: 7.5, ...}, offen: bool } } }
 *
 * Der Tag ist das BERLINER Datum des Check-ins — eine Nachtschicht zählt also
 * auf den Tag, an dem sie begonnen hat, genau wie im Dienstplan.
 *
 * Offene Logs (kein Check-out) fließen NICHT in die Stunden ein, sondern setzen
 * nur `offen`. Ein vergessener Check-out würde sonst mit 30 Stunden in der
 * Rechnung landen und den $/Schichtstunde-Wert eines ganzen Monats ruinieren.
 * Aus demselben Grund wird jede Schicht bei 14 Stunden gekappt.
 */
export async function ladeSchichtstunden(vonIso, bisIso) {
  const von = new Date(vonIso + 'T00:00:00Z')
  von.setDate(von.getDate() - 1)          // Nachtschichten vom Vortag mitnehmen
  const bis = new Date(bisIso + 'T00:00:00Z')
  bis.setDate(bis.getDate() + 2)
  const { data, error } = await supabase
    .from('shift_logs')
    .select('display_name, shift, checked_in_at, checked_out_at')
    .gte('checked_in_at', von.toISOString())
    .lte('checked_in_at', bis.toISOString())
  if (error) { console.warn('shift_logs laden fehlgeschlagen:', error.message); return {} }

  const MAX_STUNDEN = 14
  const map = {}
  for (const l of data || []) {
    const name = norm(l.display_name)
    if (!name || !l.checked_in_at) continue
    const tag = berlinTag(l.checked_in_at)
    if (!tag) continue
    const eintrag = (map[name] ||= {})
    const tagEintrag = (eintrag[tag] ||= { stunden: 0, proSchicht: {}, offen: false })
    if (!l.checked_out_at) { tagEintrag.offen = true; continue }
    const dauerH = (new Date(l.checked_out_at).getTime() - new Date(l.checked_in_at).getTime()) / 3600000
    if (!(dauerH > 0)) continue
    const h = Math.min(dauerH, MAX_STUNDEN)
    const schicht = ZIEL_SCHICHTEN.includes(l.shift) ? l.shift : 'Sonstige'
    tagEintrag.stunden += h
    tagEintrag.proSchicht[schicht] = (tagEintrag.proSchicht[schicht] || 0) + h
  }
  return map
}

/**
 * Tagesschwelle: gewichteter Mittelwert der Schicht-Schwellen nach Stundenanteil.
 * Wer nachts 6 h und früh 2 h gearbeitet hat, wird zu 3/4 am Nacht-Ziel gemessen.
 * Ohne Schichtdaten gilt der Grundwert.
 */
export function tagesSchwelle(ziel, tagEintrag) {
  const proSchicht = tagEintrag?.proSchicht || {}
  let summeH = 0, summeGewichtet = 0
  for (const [schicht, h] of Object.entries(proSchicht)) {
    if (!(h > 0) || schicht === 'Sonstige') continue
    summeH += h
    summeGewichtet += h * minRphFuerSchicht(ziel, schicht)
  }
  if (summeH > 0) return summeGewichtet / summeH
  return minRphFuerSchicht(ziel, null)
}

/**
 * Kennzahlen je Chatter für den gewählten Tag + laufenden Monat.
 *
 * Die Monats-Hochrechnung läuft über KALENDERTAGE, nicht über gearbeitete Tage:
 * Grundlage ist die Annahme, dass jemand den Rest des Monats ungefähr so weiter
 * arbeitet wie bisher. Wer bewusst weniger Schichten hat, soll genau deshalb in
 * der Hochrechnung nach unten rutschen — das ist der Fall, den ihr sehen wollt.
 */
export function berechneChatterZiele({ chatterSnapshots = [], selectedDate, ziele = {}, schichtStunden = {}, inaktiveNamen = new Set() }) {
  if (!selectedDate) return { zeilen: [], tagImMonat: 0, tageImMonat: 0 }

  const selDate = new Date(selectedDate + 'T12:00:00')
  const tagImMonat = selDate.getDate()
  const tageImMonat = new Date(selDate.getFullYear(), selDate.getMonth() + 1, 0).getDate()
  const monatIso = selectedDate.slice(0, 7)

  const monatsSnaps = chatterSnapshots.filter(s => s.businessDate.startsWith(monatIso) && s.businessDate <= selectedDate)
  const heuteSnap = chatterSnapshots.find(s => s.businessDate === selectedDate)

  // Alle Namen, die im laufenden Monat überhaupt aufgetaucht sind
  const namen = new Set()
  for (const s of monatsSnaps) {
    for (const r of s.rows || []) {
      if (!r.name || r.name.includes('*')) continue
      if (inaktiveNamen.has(r.name)) continue
      namen.add(r.name)
    }
  }

  const zeilen = []
  for (const name of namen) {
    const ziel = zielFuer(ziele, name)
    const provisionPct = Number(ziel.provision_pct ?? STANDARD_ZIEL.provision_pct)
    const monatsziel = ziel.monatsziel_verdienst != null && ziel.monatsziel_verdienst !== ''
      ? Number(ziel.monatsziel_verdienst) : null

    let monatUmsatz = 0, monatAktivMin = 0, monatSchichtH = 0, aktiveTage = 0
    let offeneCheckouts = 0
    const tageMitSchwelle = []

    for (const snap of monatsSnaps) {
      const r = (snap.rows || []).find(rr => rr.name === name)
      const tagEintrag = schichtStunden[norm(name)]?.[snap.businessDate]
      if (tagEintrag?.offen) offeneCheckouts++
      if (!r) continue
      monatUmsatz += r.revenue || 0
      monatAktivMin += r.activeMinutes || 0
      monatSchichtH += tagEintrag?.stunden || 0
      if ((r.activeMinutes || 0) >= MIN_AKTIVMINUTEN) {
        aktiveTage++
        tageMitSchwelle.push({
          datum: snap.businessDate,
          rph: r.revenuePerHour || 0,
          schwelle: tagesSchwelle(ziel, tagEintrag),
        })
      }
    }

    const heuteRow = (heuteSnap?.rows || []).find(r => r.name === name) || null
    const heuteSchicht = schichtStunden[norm(name)]?.[selectedDate] || null
    const heuteRphAktiv = heuteRow?.revenuePerHour || 0
    const heuteRphSchicht = heuteSchicht?.stunden > 0 ? (heuteRow?.revenue || 0) / heuteSchicht.stunden : null
    const heuteSchwelle = tagesSchwelle(ziel, heuteSchicht)

    // Streak: aufeinanderfolgende gearbeitete Tage unter der jeweiligen Schwelle,
    // von hinten (heute) nach vorne. Nicht gearbeitete Tage brechen ihn nicht.
    const absteigend = [...tageMitSchwelle].sort((a, b) => b.datum.localeCompare(a.datum))
    let streak = 0
    for (const t of absteigend) {
      if (t.rph < t.schwelle) streak++
      else break
    }

    const rphAktivMonat = monatAktivMin > 0 ? monatUmsatz / (monatAktivMin / 60) : 0
    const rphSchichtMonat = monatSchichtH > 0 ? monatUmsatz / monatSchichtH : null
    const hochrechnungUmsatz = tagImMonat > 0 ? (monatUmsatz / tagImMonat) * tageImMonat : 0
    const verdienstBisher = monatUmsatz * provisionPct / 100
    const hochrechnungVerdienst = hochrechnungUmsatz * provisionPct / 100
    const zielVerhaeltnis = monatsziel > 0 ? hochrechnungVerdienst / monatsziel : null

    let status = 'Kein Ziel definiert', statusFarbe = 'var(--text-muted)'
    if (zielVerhaeltnis !== null) {
      if (zielVerhaeltnis >= 1.15) { status = 'Über Ziel'; statusFarbe = 'var(--green)' }
      else if (zielVerhaeltnis >= 1.0) { status = 'Auf Kurs'; statusFarbe = 'var(--green)' }
      else if (zielVerhaeltnis >= 0.85) { status = 'Knapp unter Ziel'; statusFarbe = 'var(--yellow)' }
      else if (zielVerhaeltnis >= 0.6) { status = 'Hinterher'; statusFarbe = 'var(--orange)' }
      else { status = 'Stark hinterher'; statusFarbe = 'var(--red)' }
    } else if (aktiveTage === 0) { status = 'Inaktiv' }

    // Die eigentlich wichtige Frage: liegt es an der Leistung oder an der Menge?
    // Ohne diese Unterscheidung redet man mit einem fleißigen Chatter über
    // Effizienz, obwohl ihm schlicht Schichten fehlen.
    const schwelleMonat = minRphFuerSchicht(ziel, null)
    const leistungSchwach = rphAktivMonat > 0 && rphAktivMonat < schwelleMonat
    const zuWenigStunden = zielVerhaeltnis !== null && zielVerhaeltnis < 1 && !leistungSchwach
    const ursache = zielVerhaeltnis !== null && zielVerhaeltnis < 1
      ? (leistungSchwach && aktiveTage >= 3 ? 'leistung' : zuWenigStunden ? 'stunden' : 'beides')
      : null

    zeilen.push({
      name, ziel, provisionPct, monatsziel, tagImMonat, tageImMonat,
      monatUmsatz, monatAktivMin, monatSchichtH, aktiveTage, offeneCheckouts,
      rphAktivMonat, rphSchichtMonat, schwelleMonat,
      hochrechnungUmsatz, verdienstBisher, hochrechnungVerdienst, zielVerhaeltnis,
      status, statusFarbe, ursache,
      heuteRow, heuteRphAktiv, heuteRphSchicht, heuteSchwelle,
      heuteSchichtStunden: heuteSchicht?.stunden || 0,
      heuteOffen: !!heuteSchicht?.offen,
      streak,
      hatEigenesZiel: !ziel._standard,
    })
  }

  zeilen.sort((a, b) => {
    const av = a.zielVerhaeltnis, bv = b.zielVerhaeltnis
    if (av !== null && bv !== null) return av - bv          // schlechteste zuerst
    if (av !== null) return -1
    if (bv !== null) return 1
    return b.monatUmsatz - a.monatUmsatz
  })

  return { zeilen, tagImMonat, tageImMonat }
}

/**
 * Meldungen aus den Kennzahlen. Ein Chatter erzeugt höchstens eine Verdienst-
 * und eine Stundenleistungs-Meldung — sonst steht dieselbe Person viermal da
 * und die Liste wird wieder ignoriert.
 */
export function berechneZielAlerts(zeilen, { minTagImMonat = 7 } = {}) {
  const alerts = []
  for (const z of zeilen) {
    // 1) Verdienst-Hochrechnung unter Ziel — der Fall, der euch gefehlt hat.
    //
    // Die Grenze hängt bewusst am Kalendertag, NICHT an der Zahl gearbeiteter
    // Tage. Eine Bedingung wie "mindestens 3 aktive Tage" würde genau den
    // Chatter ausblenden, um den es geht: wer zu wenige Schichten hat, hat auch
    // wenige aktive Tage und wäre nie gemeldet worden. Vor dem 7. eines Monats
    // ist die Hochrechnung dagegen zu wackelig für eine Meldung.
    if (z.zielVerhaeltnis !== null && z.tagImMonat >= minTagImMonat && z.aktiveTage >= 1) {
      const pct = Math.round(z.zielVerhaeltnis * 100)
      const fehlbetrag = Math.max(0, z.monatsziel - z.hochrechnungVerdienst)
      const ursacheText = z.ursache === 'stunden'
        ? `Leistung ist in Ordnung (${z.rphAktivMonat.toFixed(0)} $/Std) — es fehlen Schichten.`
        : z.ursache === 'leistung'
          ? `Stundenleistung unter Ziel (${z.rphAktivMonat.toFixed(0)} statt ${z.schwelleMonat.toFixed(0)} $/Std).`
          : `Leistung und Schichtmenge beide unter Plan.`
      if (z.zielVerhaeltnis < 0.6) {
        alerts.push({
          severity: 'critical', name: z.name, group: 'verdienst',
          tag: 'Verdienst stark unter Ziel',
          headline: `Hochrechnung $${z.hochrechnungVerdienst.toFixed(0)} statt $${z.monatsziel.toFixed(0)} (${pct}%) · ${z.aktiveTage} Tage gearbeitet`,
          explain: `Bei gleichbleibendem Tempo fehlen dem Chatter zum Monatsende rund $${fehlbetrag.toFixed(0)} Provision. ${ursacheText}`,
        })
        continue
      }
      if (z.zielVerhaeltnis < 0.85) {
        alerts.push({
          severity: 'warning', name: z.name, group: 'verdienst',
          tag: 'Verdienst unter Ziel',
          headline: `Hochrechnung $${z.hochrechnungVerdienst.toFixed(0)} statt $${z.monatsziel.toFixed(0)} (${pct}%) · ${z.aktiveTage} Tage gearbeitet`,
          explain: `Zum Monatsende fehlen voraussichtlich rund $${fehlbetrag.toFixed(0)} Provision. ${ursacheText}`,
        })
        continue
      }
    }

    // 2) Stundenleistung: mehrere Tage in Folge unter der eigenen Schwelle.
    if (z.streak >= 2 && z.heuteRow) {
      const schwelle = z.heuteSchwelle.toFixed(0)
      const rph = z.heuteRphAktiv.toFixed(0)
      const schichtText = z.heuteRphSchicht != null
        ? ` · ${z.heuteRphSchicht.toFixed(0)} $/Schichtstd`
        : ''
      alerts.push({
        severity: z.streak >= 3 ? 'critical' : 'warning',
        name: z.name, group: 'under_min',
        tag: `Tag ${z.streak} in Folge unter Ziel`,
        headline: `${rph} $/Aktivstd (Ziel ${schwelle})${schichtText}`,
        explain: `Schwelle ist der nach Schichtanteil gewichtete Zielwert dieses Chatters, nicht ein fester Wert für alle.`,
      })
      continue
    }

    // 3) Anwesend, aber nicht am Chatten. Fällt nur auf, weil beide Werte da sind.
    if (z.heuteRphSchicht != null && z.heuteSchichtStunden >= 3 && z.heuteRow) {
      const aktivH = (z.heuteRow.activeMinutes || 0) / 60
      const quote = z.heuteSchichtStunden > 0 ? aktivH / z.heuteSchichtStunden : 1
      if (quote < 0.5) {
        alerts.push({
          severity: 'warning', name: z.name, group: 'under_min',
          tag: 'Schicht läuft, Aktivität fehlt',
          headline: `${aktivH.toFixed(1)}h aktiv von ${z.heuteSchichtStunden.toFixed(1)}h Schicht (${Math.round(quote * 100)}%)`,
          explain: 'Eingecheckt, aber weniger als die Hälfte der Schicht tatsächlich am Chatten. Prüfen, ob Check-out vergessen wurde oder ob wirklich Leerlauf war.',
        })
      }
    }
  }
  return alerts
}
