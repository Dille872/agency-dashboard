import { BERLIN, wandzeitZuDatum } from './zeit'
import { plusTage } from './jetzt'

// ── Wann ist eine Schicht wirklich vorbei? (v4.99.0) ────────────────────────
//
// Fehler vom 24.09.2026: Etienne checkt um 18:01 per Telegram in seine
// Nachtschicht ein (20:01–01:00). 90 Sekunden später wirft ihn das Portal
// wieder raus, beim /off meldet der Bot „Keine aktive Schicht".
//
// Die alte Rechnung arbeitete mit Minuten ab Mitternacht. Für Schichten über
// Mitternacht gab es eine Korrektur: liegt die aktuelle Uhrzeit VOR dem
// Schichtstart, gilt sie als Uhrzeit des Folgetags (+24 Std) — damit 01:00 in
// einer 20:01–01:00-Schicht nicht als „lange vorbei" gilt.
//
// Die Bedingung traf aber auch den Abend DAVOR: 18:01 liegt ebenfalls vor
// 20:01 und wurde deshalb zu „42:01" hochgerechnet — weit hinter dem
// Schichtende „25:00". Ergebnis: sofortiger Auto-Checkout, bei jeder Schicht
// über Mitternacht, in die jemand vor Beginn eincheckt.
//
// Statt weiter mit Minuten zu jonglieren, rechnen wir hier mit echten
// Zeitpunkten: eine Schicht ist vorbei, wenn sie begonnen hat und ihr Ende
// hinter uns liegt. Sonst nicht.
//
// Zweiter, unabhängiger Fehler an derselben Stelle: geprüft wurden nur Zellen
// des HEUTIGEN Plantags. Wer um 00:30 in einer Nachtschicht steckt, steht im
// Plan aber unter gestern — für ihn fand sich keine Zelle, und sein Log lief
// bis zum nächsten Klick weiter. Dafür `plantage()` weiter unten.
//
// Zeiten im Dienstplan sind deutsche Zeit (wie überall im Dashboard).

export const NACH_ENDE_MIN = 1   // so lange nach Schichtende wird gewartet

/**
 * Zeitspanne einer Plan-Zelle als echte Zeitpunkte.
 * @param tagIso  Plantag der Zelle, z. B. '2026-09-24'
 * @param spanne  'HH:MM-HH:MM' (Ende vor Beginn = über Mitternacht)
 * @returns {{von:number, bis:number}} oder null, wenn unbrauchbar
 */
export function zellZeitraum(tagIso, spanne) {
  if (!tagIso || !spanne) return null
  const teile = String(spanne).replace(/\s*\(DE\)/gi, '').split('-').map(t => t.trim())
  if (teile.length < 2) return null
  const [vonStr, bisStr] = teile
  // Freitext wie „20" oder „abends" ist keine Spanne — dann lieber gar nichts,
  // sonst entstünde ein Fenster, das sofort abgelaufen wäre.
  if (!/^\d{1,2}:\d{2}$/.test(vonStr) || !/^\d{1,2}:\d{2}$/.test(bisStr)) return null
  const von = wandzeitZuDatum(tagIso, vonStr, BERLIN).getTime()
  let bis = wandzeitZuDatum(tagIso, bisStr, BERLIN).getTime()
  if (bis <= von) bis = wandzeitZuDatum(plusTage(tagIso, 1), bisStr, BERLIN).getTime()
  if (!isFinite(von) || !isFinite(bis)) return null
  return { von, bis }
}

/**
 * Soll automatisch ausgecheckt werden?
 *
 * Ja, wenn die Schicht begonnen HAT und ihr spätestes Ende vorbei ist.
 * Wer mehrere Models mit verschiedenen Zeiten hat, arbeitet bis zum letzten
 * Ende. Wer vor Schichtbeginn eincheckt, bleibt drin — das war der Fehler.
 *
 * @param zeitraeume  Liste aus zellZeitraum(), null-Einträge erlaubt
 */
export function schichtVorbei(zeitraeume = [], jetzt = Date.now()) {
  const gueltig = (zeitraeume || []).filter(z => z && isFinite(z.von) && isFinite(z.bis))
  if (!gueltig.length) return false          // keine verlässliche Zeit → nie automatisch auschecken
  const start = Math.min(...gueltig.map(z => z.von))
  const ende = Math.max(...gueltig.map(z => z.bis))
  if (jetzt < start) return false            // noch nicht angefangen
  return jetzt >= ende + NACH_ENDE_MIN * 60000
}

/**
 * Welche Plantage kommen für eine laufende Schicht in Frage?
 *
 * Heute — und für Nachtschichten auch gestern: eine Nachtschicht ist im Plan
 * auf ihren START-Tag geschlüsselt. Wer um 00:30 eingecheckt ist, hat als
 * deutsches „heute" schon den Folgetag, seine Zelle steht aber unter gestern.
 * Ohne den gestrigen Tag lief sein Log bis zum nächsten Klick weiter
 * (dieselbe Überlegung wie beim Check-in im Telegram-Bot, v4.37.0).
 */
export function plantage(heuteIso, schicht) {
  return schicht === 'Nacht' ? [heuteIso, plusTage(heuteIso, -1)] : [heuteIso]
}
