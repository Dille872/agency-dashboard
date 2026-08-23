// ─── ERKENNUNG DER MODEL-EINZELDATEIEN ───────────────────────────────────────
//
// v4.31.0 · Ordnet Einzel-Exporte des OF-Tools ihrem Account zu.
// v4.31.1 · Trinkgeld als zweite Bezugsgroesse + Zuordnung durch Ausschluss.
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
// ⚠️ ZWEI BEZUGSGROESSEN (v4.31.1)
// Der erste Echtbetrieb am 22.08.2026 hat gezeigt: bei manchen Accounts ist das
// TRINKGELD im Chatter-Leaderboard mit drin, bei anderen nicht.
//     sandra wayne VIP · messageRevenue 170,00 · tipsRevenue 40,00
//     Summe der Einzeldatei                     210,00 = 170,00 + 40,00
// Auf den Cent. Deshalb wird jeder Account mit ZWEI Zielwerten gefuehrt —
// nachrichten und nachrichten+trinkgeld — und ein Treffer auf den zweiten wird
// als solcher gekennzeichnet. Vorher blieben solche Dateien unerkannt und
// mussten von Hand zugeordnet werden.
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
// Jedes Konto bekommt ein oder zwei Zielwerte (siehe Kopf). Accounts, bei denen
// beide Ziele 0,00 sind, fliegen raus — 0,00 ist kein Fingerabdruck.
export function kandidatenAusSnapshot(modelRows) {
  return (modelRows || [])
    .filter(r => r && r.creator)
    .map(r => {
      const nachrichten = Number(r.messageRevenue) || 0
      const trinkgeld = Number(r.tipsRevenue) || 0
      const ziele = [{ wert: nachrichten, basis: 'nachrichten' }]
      if (Math.abs(trinkgeld) > TOL_EXAKT) {
        ziele.push({ wert: nachrichten + trinkgeld, basis: 'nachrichten+trinkgeld' })
      }
      return { creator: r.creator, ofName: r.ofName || null, nachrichten, trinkgeld, ziele }
    })
    .filter(k => k.ziele.some(z => Math.abs(z.wert) > TOL_EXAKT))
}

// Bestes Ziel eines Kontos fuer eine gegebene Summe.
export function bestesZiel(konto, summe) {
  return konto.ziele.reduce((a, b) =>
    Math.abs(summe - a.wert) <= Math.abs(summe - b.wert) ? a : b
  )
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
    treffer: null,        // 'exakt' | 'trinkgeld' | 'ungefaehr' | 'uebrig' | 'manuell' | null
    basis: null,          // 'nachrichten' | 'nachrichten+trinkgeld'
    abweichung: 0,
    manuell: false,
  }))

  // Passt die Summe auf irgendeinen Zielwert des Kontos? Gibt das getroffene
  // Ziel zurueck, sonst null.
  const trefferZiel = (konto, summe, toleranz) => {
    const z = konto.ziele.find(z => Math.abs(summe - z.wert) <= toleranz)
    return z || null
  }

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
        const kandidaten = konten
          .filter(k => !vergeben.has(k.creator))
          .map(k => ({ k, z: trefferZiel(k, e.summe, toleranz) }))
          .filter(x => x.z)
        if (kandidaten.length !== 1) continue

        const { k, z } = kandidaten[0]
        // Gegenprobe: beansprucht eine ANDERE offene Datei denselben Account
        // ebenfalls, ist nichts eindeutig — dann lieber beide offen lassen.
        const konkurrenz = ergebnis.some(o =>
          o !== e && !o.creator && trefferZiel(k, o.summe, toleranzFn(o.summe))
        )
        if (konkurrenz) continue

        e.creator = k.creator
        e.ofName = k.ofName
        e.basis = z.basis
        e.abweichung = e.summe - z.wert
        vergeben.add(k.creator)
        fortschritt = true
      }
    }
  }

  // Durchgang 1: auf den Cent.
  passe(() => TOL_EXAKT)
  for (const e of ergebnis) {
    if (e.creator && !e.treffer) e.treffer = e.basis === 'nachrichten+trinkgeld' ? 'trinkgeld' : 'exakt'
  }

  // Durchgang 2: kleine Spanne, deutlich als unsicher gekennzeichnet.
  passe(summe => Math.max(Math.abs(summe) * TOL_UNGEFAEHR_PCT, TOL_UNGEFAEHR_MIN))
  for (const e of ergebnis) if (e.creator && !e.treffer) e.treffer = 'ungefaehr'

  // v4.31.1 · Durchgang 3: Zuordnung durch Ausschluss.
  // Bleibt genau EINE Datei und genau EIN Konto uebrig, ist die Zuordnung
  // zwingend — auch wenn die Summe nicht passt (kommt vor, wenn Umsatz keinem
  // Chatter zugeordnet ist: Julia hatte am 22.08. 46,15 Message Revenue, in der
  // Einzeldatei standen nur 9,60). Bewusst getrennt gekennzeichnet, weil hier
  // NICHT der Wert den Beweis liefert, sondern das Ausschlussverfahren.
  const offeneDateien = ergebnis.filter(e => !e.creator)
  const offeneKonten = konten.filter(k => !vergeben.has(k.creator))
  if (offeneDateien.length === 1 && offeneKonten.length === 1) {
    const e = offeneDateien[0]
    const k = offeneKonten[0]
    const z = bestesZiel(k, e.summe)
    e.creator = k.creator
    e.ofName = k.ofName
    e.basis = z.basis
    e.abweichung = e.summe - z.wert
    e.treffer = 'uebrig'
    vergeben.add(k.creator)
  }

  return ergebnis
}

// Zuordnung von Hand setzen bzw. loesen. Gibt eine neue Liste zurueck und
// verhindert, dass derselbe Account zweimal vergeben wird.
export function setzeZuordnung(ergebnis, index, creator, modelRows) {
  const leer = { creator: null, ofName: null, treffer: null, basis: null, abweichung: 0, manuell: false }
  const konten = kandidatenAusSnapshot(modelRows)
  const roh = (modelRows || []).filter(r => r && r.creator)
  return ergebnis.map((e, i) => {
    if (i !== index) {
      // Derselbe Account darf nicht zweimal dranhaengen — die andere Zeile
      // verliert ihn und muss neu bestimmt werden.
      if (creator && e.creator === creator) return { ...e, ...leer }
      return e
    }
    if (!creator) return { ...e, ...leer }

    const k = konten.find(x => x.creator === creator)
    const rohZeile = roh.find(x => x.creator === creator)
    const z = k ? bestesZiel(k, e.summe) : { wert: 0, basis: 'nachrichten' }
    return {
      ...e,
      creator,
      ofName: (k?.ofName ?? rohZeile?.ofName) || null,
      basis: z.basis,
      treffer: 'manuell',
      abweichung: e.summe - z.wert,
      manuell: true,
    }
  })
}

// Abgleich fuer die Fusszeile der Vorschau und fuer die Seite "Datenstand".
// erfasst      = Accounts mit Umsatz, fuer die eine Datei vorliegt
// offen        = Accounts mit Umsatz ohne Datei, samt fehlender Summe
// abweichungen = zugeordnete Dateien, deren Summe auf keinen der beiden
//                Zielwerte des Kontos passt
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
    .map(k => {
      const summe = zugeordnet.get(k.creator)
      const z = bestesZiel(k, summe)
      return { creator: k.creator, differenz: summe - z.wert, basis: z.basis }
    })
    .filter(x => Math.abs(x.differenz) > TOL_EXAKT)

  return {
    kontenGesamt: konten.length,
    kontenErfasst: konten.length - offen.length,
    offen,
    fehlenderUmsatz: offen.reduce((s, k) => s + k.nachrichten, 0),
    abweichungen,
    abweichungSumme: abweichungen.reduce((s, x) => s + x.differenz, 0),
    ohneZuordnung: (ergebnis || []).filter(e => !e.creator).length,
  }
}
