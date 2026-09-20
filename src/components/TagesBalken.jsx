import React from 'react'

// ── Tagesverlauf als Balken ────────────────────────────────────────────────
//
// v4.70.0. In der Tagesziel-Tabelle stand bisher nur der heutige Wert und der
// Monatsstand. Beides sagt nichts darueber, ob ein Model gerade faellt: 62%
// vom Ziel kann ein Ausrutscher sein oder der vierte schwache Tag in Folge.
//
// WARUM 14 TAGE UND NICHT 7 ODER "DER LAUFENDE MONAT"
// Sieben Balken enthalten nur ein Wochenende — ein Einbruch am Samstag sieht
// dann aus wie ein Trend. Vierzehn enthalten zwei, also einen Vergleich.
// Der laufende Monat scheidet aus, weil das Bild am 2. aus zwei Balken
// besteht und am 30. aus dreissig: es bedeutet jeden Tag etwas anderes.
// Der Monatsstand steht ohnehin als Prozentzahl daneben.
//
// WAS DIE FARBEN SAGEN
// Grau = vergangener Tag, Violett = zuletzt erfasster Tag, Rot = die letzten
// drei Tage lagen alle unter dem Tagesziel. Rot ist bewusst selten: waere
// jeder Tag unter Ziel rot, schaut nach einer Woche niemand mehr hin. Die
// Farbe steht nie allein — die Prozentspalte daneben sagt dasselbe in Text.
//
// Die Hoehe ist je Zeile eigen skaliert. Zwei Models sind ueber die
// Balkenhoehe NICHT vergleichbar; es geht um die Form, nicht um die Groesse.
// Den Vergleich leisten die Zahlen in den anderen Spalten.

const RUHIG = '#5a5a96'   // geprueft gegen helle und dunkle Flaeche (>= 3:1)

export default function TagesBalken({ verlauf, ziel, hoehe = 30, breite = 10 }) {
  if (!Array.isArray(verlauf) || verlauf.length === 0) {
    return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
  }

  const werte = verlauf.map(v => v.wert || 0)
  // 6% Luft ueber dem hoechsten Wert, damit der groesste Balken nicht an die
  // Ziellinie stoesst. Ohne Ziel skaliert nur der Maximalwert.
  const max = Math.max(...werte, ziel > 0 ? ziel : 0) * 1.06 || 1
  const letzteDrei = werte.slice(-3)
  const schwach = ziel > 0 && letzteDrei.length === 3 && letzteDrei.every(w => w < ziel)
  const zielY = ziel > 0 ? Math.round((ziel / max) * hoehe) : null

  return (
    <span
      title={ziel > 0 ? `Tagesziel ${Math.round(ziel)} — Linie` : 'Kein Tagesziel gesetzt'}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: hoehe }}
    >
      {zielY !== null && (
        <span style={{
          position: 'absolute', left: 0, right: 0, bottom: zielY,
          height: 1, background: 'var(--text-secondary)', pointerEvents: 'none',
        }} />
      )}
      {verlauf.map((v, i) => {
        const wert = v.wert || 0
        const letzter = i === verlauf.length - 1
        const rot = schwach && i >= verlauf.length - 3
        const farbe = rot ? 'var(--red)' : letzter ? 'var(--accent)' : RUHIG
        return (
          <span
            key={v.datum || i}
            title={`${v.datum}: ${Math.round(wert).toLocaleString('de-DE')}`}
            style={{
              width: breite,
              height: Math.max(2, Math.round((wert / max) * hoehe)),
              background: farbe,
              borderRadius: '3px 3px 0 0',
              flexShrink: 0,
            }}
          />
        )
      })}
    </span>
  )
}
