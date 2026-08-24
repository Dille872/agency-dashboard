/**
 * v4.30.0 — Dienstplan-Zellen von einer Person befreien.
 *
 * Reine Rechnung, ohne Datenbank: damit die Regeln testbar sind und nicht in
 * einem Datenbank-Aufruf mitten in SettingsTab versteckt liegen.
 *
 * Die Regeln, in einem Satz: Eine Zelle gehört dem MODEL, nicht dem Chatter.
 * Wird der Chatter offboardet, verschwindet die Person — die Schicht bleibt und
 * gilt als unbesetzt. Eine gelöschte Zelle würde die Schicht stillschweigend
 * verschwinden lassen, und niemand käme auf die Idee, sie neu zu besetzen.
 */

const norm = (s) => String(s || '').trim().toLowerCase()

/** Hat die Zelle außer dem Chatter-Feld noch Inhalt, der erhalten bleiben muss? */
function hatRestInhalt(zelle) {
  return Object.entries(zelle).some(([feld, wert]) => {
    if (feld === 'chatter') return false
    if (wert === '' || wert == null) return false
    if (Array.isArray(wert) && wert.length === 0) return false
    return true
  })
}

/**
 * Entfernt eine Person aus allen Zellen einer Wochen-JSON.
 *
 * - Hauptchatter → Feld wird geleert, die Zelle bleibt (= unbesetzt).
 * - Trainee      → Feld und `trainee_mode` fliegen raus.
 * - `time_override`, `note` usw. bleiben erhalten: die gehören zur Schicht,
 *   nicht zur Person.
 * - Bleibt danach nichts Sinnvolles übrig, fällt der Eintrag ganz weg.
 * - Ein Trainee rückt NICHT automatisch auf den Hauptplatz nach. Wer wen
 *   vertritt, ist eine Personalentscheidung und darf nicht still vom System
 *   getroffen werden.
 *
 * Rückgabe: { assignments, geaendert } — `geaendert` zählt betroffene Zellen.
 */
export function assignmentsOhnePerson(assignments, personName) {
  const gesucht = norm(personName)
  const neu = {}
  let geaendert = 0
  if (!gesucht) return { assignments: assignments || {}, geaendert: 0 }

  for (const [key, wert] of Object.entries(assignments || {})) {
    const zelle = { ...(wert || {}) }
    const istChatter = norm(zelle.chatter) === gesucht
    const istTrainee = norm(zelle.trainee) === gesucht
    if (!istChatter && !istTrainee) { neu[key] = wert; continue }
    geaendert++
    if (istChatter) zelle.chatter = ''
    if (istTrainee) { delete zelle.trainee; delete zelle.trainee_mode }
    // v4.34.0: Eine geteilte Schicht wird ganz aufgelöst, sobald eine der beiden
    // Personen geht. Nur ihre eigene Spanne zu löschen würde einen widersprüchlichen
    // Rest hinterlassen — eine Zelle, die als „geteilt" markiert ist, aber nur noch
    // eine Person hat, oder eine Zeitspanne ohne zugehörigen Namen. Beides ginge so
    // in den Export und damit in die Lohn-Auswertung.
    // Achtung: Geht der HAUPTchatter, bleibt die zweite Person als Eintrag stehen,
    // aber ohne Modus — sie gilt danach wie ein Trainee. Sie sieht die Schicht
    // weiterhin und kann einchecken, wird aber nicht mehr überwacht (kein
    // Telegram-Plan, kein Nicht-eingecheckt-Alarm, kein Auto-Checkout). Das ist
    // gewollt: Wer eine verwaiste Schicht übernimmt, ist eine Personalentscheidung
    // und darf nicht still vom System getroffen werden — die Zelle muss im
    // Dienstplan neu besetzt werden.
    if (istChatter || istTrainee) {
      delete zelle.split_a_von; delete zelle.split_a_bis
      delete zelle.split_b_von; delete zelle.split_b_bis
      if (zelle.trainee_mode === 'split') delete zelle.trainee_mode
    }
    // Der Chatter muss hier ausdrücklich mitgeprüft werden. Sonst fliegt eine
    // Zelle raus, in der die Person nur Trainee war — die Schicht des
    // Hauptchatters wäre gelöscht, obwohl sie mit dem Offboarding nichts zu tun
    // hat. Genau das hat der Test beim ersten Durchlauf aufgedeckt.
    if (zelle.chatter || hatRestInhalt(zelle)) neu[key] = zelle
  }
  return { assignments: neu, geaendert }
}

/**
 * Entfernt alle Zellen der angegebenen Model-IDs.
 * Hier wird die Zelle tatsächlich gelöscht — ohne Model gibt es keine Schicht,
 * die noch jemand besetzen könnte.
 */
export function assignmentsOhneModels(assignments, modelIds) {
  const ids = new Set((modelIds || []).map(String))
  const neu = {}
  let entfernt = 0
  for (const [key, wert] of Object.entries(assignments || {})) {
    if (ids.has(key.split('__')[0])) { entfernt++; continue }
    neu[key] = wert
  }
  return { assignments: neu, entfernt }
}
