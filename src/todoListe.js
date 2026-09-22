// ── „Meine Aufgaben“: erledigte wegklappen (v4.96.0) ──────────────────────
// Für Chatter- und Model-Portal. Vorher standen alle erledigten Aufgaben für
// immer durchgestrichen in der Liste (Wunsch Chris, 22.09.).
//
// Jetzt:
//   • offene Aufgaben stehen oben
//   • gerade eben abgehakte bleiben sichtbar (durchgestrichen), bis die Seite
//     neu geladen wird — so kann man sich verklicken und zurückhaken
//   • erledigte der letzten 7 Tage liegen eingeklappt unter „Erledigt · N“
//   • älter als 7 Tage: im Portal nicht mehr zu sehen (im Admin weiter da,
//     gelöscht wird nichts)

export const ERLEDIGT_TAGE = 7

export function todoAnsicht(liste = [], frisch = new Set(), archivOffen = false, jetzt = Date.now()) {
  const grenze = jetzt - ERLEDIGT_TAGE * 864e5
  const wann = (t) => new Date(t.completed_at || t.created_at || 0).getTime()
  const offen = liste.filter(t => !t.completed)
  const gerade = liste.filter(t => t.completed && frisch.has(t.id))
  const erledigt = liste
    .filter(t => t.completed && !frisch.has(t.id) && wann(t) >= grenze)
    .sort((a, b) => wann(b) - wann(a))
  return {
    sichtbar: [...offen, ...gerade, ...(archivOffen ? erledigt : [])],
    offenZahl: offen.length,
    erledigtZahl: erledigt.length,
    leer: offen.length + gerade.length + erledigt.length === 0,
  }
}
