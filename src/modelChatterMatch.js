// ─── ERKENNUNG DER MODEL-EINZELDATEIEN ───────────────────────────────────────
//
// v4.31.0 · Ordnet Einzel-Exporte des OF-Tools ihrem Account zu.
//
// WARUM ES DIESE DATEI GIBT
// Die Einzeldateien heissen beim Export alle gleich ("Chatter Leaderboard
// <Datum>.csv") und enthalten im Inhalt keinerlei Hinweis auf das Model — nur
// Chatter-Namen und Zahlen. Der Dateiname taugt also nicht als Schluessel, und
// ihn von Hand zu vergeben waere genau die Fehlerquelle, die im August 2026 bei
// den zwei Chiara-Accounts zu wochenlang falschen Zahlen gefuehrt hat.
//
// Stattdessen dient die SUMME der Datei als Fingerabdruck: sie trifft den
// messageRevenue des Accounts in der Vergleichsdatei desselben Tages.
// Nachgerechnet am 22.08.2026:
//     671,20 (Max) + 380,00 (Mario) + 188,00 (Noa) = 1.239,20
//     model_snapshots · Elina_mj 🎮 · messageRevenue = 1.239,20   ✓
// Kein anderer Account des Tages hatte diesen Wert.
//
// GRUNDREGELN
// 1. Zugeordnet wird nur, was EINDEUTIG ist. Zwei Kandidaten → keine Zuordnung,
//    sondern Rueckfrage. Es wird nie geraten.
// 2. Jeder Account wird hoechstens einmal vergeben (claimed-Set). Dasselbe
//    Muster wie zeileJeAccount() in ModelPortal.jsx seit v4.30.1 — dort hatte
//    genau dessen Fehlen die Doppelzaehlung erzeugt.
// 3. Accounts ohne Umsatz sind untereinander nicht unterscheidbar (alle 0,00)
//    und nehmen an der automatischen Erkennung deshalb nicht teil.
//
// Diese Datei rechnet nur und rendert nichts — damit ist sie einzeln pruefbar.

// Cent-genau. Alles darueber ist keine Rundung mehr, sondern ein anderer Account.
export const TOL_EXAKT = 0.011

// Zweiter Durchgang: wenn Vergleichsdatei und Einzeldatei zu unterschiedlichen
// Uhrzeiten gezogen wurden, kann dazwischen noch eine Transaktion gelaufen sein.
// Solche Treffer werden als "ungefaehr" markiert und muessen bewusst bestaetigt
// werden — sie gelten nicht als sauber erkannt.
export const TOL_UNGEFAEHR_PCT = 0.005   // 0,5 % der Dateisumme
export const TOL_UNGEFAEHR_MIN = 1.0     // mindestens 1,00 $ Spielraum

// Summe einer Einzeldatei = Summe der Umsaetze aller Chatter darin.
export function summeDatei(rows) {
  return (rows || []).reduce((s, r) => s + (Number(r?.revenue) || 0), 0)
}

// Kandidaten-Konten aus dem Model-Snapshot des Tages.
// Nur Accounts mit Umsatz — 0,00 ist kein Fingerabdruck.
export function kandidatenAusSnapshot(modelRows) {
  return (modelRows || [])
    .filter(r => r && r.creator && Math.abs(Number(r.messageRevenue) || 0) > TOL_EXAKT)
    .map(r => ({
      creator: r.creator,
      ofName: r.ofName || null,
      messageRevenue: Number(r.messageRevenue) || 0,
    }))
}

// Kernstueck. dateien: [{ fileName, rows }] · modelRows: model_snapshots.rows des Tages.
// Liefert ein Ergebnis JE DATEI, in derselben Reihenfolge.
export function ordneDateienZu(dateien, modelRows) {
  const konten = kandidatenAusSnapshot(modelRows)
  const vergeben = new Set()          // Regel 2: ein Account nur einmal
  const ergebnis = (dateien || []).map(d => ({
    fileName: d.fileName,
    rows: d.rows || [],
    summe: summeDatei(d.rows),
    creator: null,
    ofName: null,
    treffer: null,                    // 'exakt' | 'ungefaehr' | null
    abweichung: 0,
    manuell: false,
  }))

  const passe = (toleranzFn) => {
    // Wiederholen, solange noch etwas eindeutig aufloesbar ist. Eine Zuordnung
    // kann eine zweite freischalten: faellt Account A weg, bleibt fuer die
    // naechste Datei womoeglich nur noch B uebrig.
    let fortschritt = true
    while (fortschritt) {
      fortschritt = false
      for (const e of ergebnis) {
        if (e.creator) continue
        const toleranz = toleranzFn(e.summe)
        const treffer = konten.filter(k =>
          !vergeben.has(k.creator) && Math.abs(e.summe - k.messageRevenue) <= toleranz
        )
        if (treffer.length === 1) {
          const k = treffer[0]
          // Gegenprobe: beansprucht eine ANDERE offene Datei denselben Account
          // ebenfalls als einzigen Kandidaten, ist nichts eindeutig — dann lieber
          // beide offen lassen und nachfragen.
          const konkurrenz = ergebnis.some(o =>
            o !== e && !o.creator &&
            Math.abs(o.summe - k.messageRevenue) <= toleranzFn(o.summe)
          )
          if (konkurrenz) continue
          e.creator = k.creator
          e.ofName = k.ofName
          e.abweichung = e.summe - k.messageRevenue
          vergeben.add(k.creator)
          fortschritt = true
        }
      }
    }
  }

  // Durchgang 1: auf den Cent.
  passe(() => TOL_EXAKT)
  for (const e of ergebnis) if (e.creator) e.treffer = 'exakt'

  // Durchgang 2: kleine Spanne, deutlich als unsicher gekennzeichnet.
  passe(summe => Math.max(Math.abs(summe) * TOL_UNGEFAEHR_PCT, TOL_UNGEFAEHR_MIN))
  for (const e of ergebnis) if (e.creator && !e.treffer) e.treffer = 'ungefaehr'

  return ergebnis
}

// Zuordnung von Hand setzen bzw. loesen. Gibt eine neue Liste zurueck und
// verhindert, dass derselbe Account zweimal vergeben wird.
export function setzeZuordnung(ergebnis, index, creator, modelRows) {
  const konten = (modelRows || []).filter(r => r && r.creator)
  return ergebnis.map((e, i) => {
    if (i !== index) {
      // Derselbe Account darf nicht zweimal dranhaengen — die andere Zeile
      // verliert ihn und muss neu bestimmt werden.
      if (creator && e.creator === creator) {
        return { ...e, creator: null, ofName: null, treffer: null, abweichung: 0, manuell: false }
      }
      return e
    }
    if (!creator) {
      return { ...e, creator: null, ofName: null, treffer: null, abweichung: 0, manuell: false }
    }
    const k = konten.find(r => r.creator === creator)
    const mr = Number(k?.messageRevenue) || 0
    return {
      ...e,
      creator,
      ofName: k?.ofName || null,
      treffer: 'manuell',
      abweichung: e.summe - mr,
      manuell: true,
    }
  })
}

// Abgleich fuer die Fusszeile der Vorschau und fuer die Seite "Datenstand".
// erfasst  = Accounts mit Umsatz, fuer die eine Datei vorliegt
// offen    = Accounts mit Umsatz ohne Datei, samt fehlender Summe
// abweichungen = zugeordnete Dateien, deren Summe nicht auf den Account passt
export function abgleich(ergebnis, modelRows) {
  const konten = kandidatenAusSnapshot(modelRows)
  const zugeordnet = new Map()
  for (const e of ergebnis || []) {
    if (!e.creator) continue
    zugeordnet.set(e.creator, (zugeordnet.get(e.creator) || 0) + e.summe)
  }
  const offen = konten.filter(k => !zugeordnet.has(k.creator))
  const abweichungen = konten
    .filter(k => zugeordnet.has(k.creator))
    .map(k => ({ creator: k.creator, differenz: zugeordnet.get(k.creator) - k.messageRevenue }))
    .filter(x => Math.abs(x.differenz) > TOL_EXAKT)

  return {
    kontenGesamt: konten.length,
    kontenErfasst: konten.length - offen.length,
    offen,
    fehlenderUmsatz: offen.reduce((s, k) => s + k.messageRevenue, 0),
    abweichungen,
    ohneZuordnung: (ergebnis || []).filter(e => !e.creator).length,
  }
}
