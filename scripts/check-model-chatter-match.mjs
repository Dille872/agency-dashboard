// Prueft die Erkennung der Model-Einzeldateien gegen echte Exporte.
//
// v4.31.0 · Aufruf:  node scripts/check-model-chatter-match.mjs <ordner>
// Der Ordner muss enthalten:
//   - genau eine Datei mit "Detailed_Comparison" im Namen (die Vergleichsdatei)
//   - beliebig viele Chatter-Leaderboard-Einzeldateien
// Eine Datei, deren Name "Komplett" enthaelt, wird als Komplett-Leaderboard
// erkannt und uebersprungen — die gehoert in den Chatter-Upload, nicht hierher.
//
// Der Test ist bewusst kein Unit-Test mit erfundenen Zahlen: die Erkennung haengt
// daran, dass echte Exporte auf den Cent aufgehen. Das laesst sich nur an echten
// Dateien zeigen.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseCSV, parseModelRow, parseChatterRow } from '../src/utils.js'
import { ordneDateienZu, abgleich } from '../src/modelChatterMatch.js'

const ordner = process.argv[2]
if (!ordner) {
  console.error('Aufruf: node scripts/check-model-chatter-match.mjs <ordner>')
  process.exit(2)
}

const dateien = readdirSync(ordner).filter(f => f.toLowerCase().endsWith('.csv'))
const vergleichName = dateien.find(f => /detailed[_ ]?comparison/i.test(f))
if (!vergleichName) {
  console.error('Keine Vergleichsdatei (Detailed Comparison) im Ordner gefunden.')
  process.exit(2)
}

const v = parseCSV(readFileSync(join(ordner, vergleichName), 'utf-8'))
const modelRows = v.rows.map(r => parseModelRow(r, v.headers)).filter(Boolean)

const einzelNamen = dateien.filter(f => f !== vergleichName && !/komplett/i.test(f))
const einzel = einzelNamen.map(f => {
  const p = parseCSV(readFileSync(join(ordner, f), 'utf-8'))
  return { fileName: f, rows: p.rows.map(r => parseChatterRow(r, p.headers)).filter(Boolean) }
})

console.log(`Vergleichsdatei : ${vergleichName}`)
console.log(`Accounts        : ${modelRows.length} (davon ${modelRows.filter(r => r.messageRevenue > 0).length} mit Message Revenue)`)
console.log(`ofName erkannt  : ${modelRows.filter(r => r.ofName).length} / ${modelRows.length}`)
console.log(`Einzeldateien   : ${einzel.length}`)
console.log('')

const LABEL = {
  exakt:     'exakt        ',
  trinkgeld: 'exakt +Tips  ',
  uebrig:    'durch Ausschl',
  ungefaehr: 'ungefaehr    ',
  manuell:   'von Hand     ',
}

const ergebnis = ordneDateienZu(einzel, modelRows)
let offen = 0
for (const e of ergebnis) {
  if (!e.creator) offen++
  const status = LABEL[e.treffer] || 'OFFEN        '
  console.log(`  ${status}  ${e.summe.toFixed(2).padStart(10)}  →  ${e.creator || '—'}${e.ofName ? `  (${e.ofName})` : ''}`)
  console.log(`               Datei: ${e.fileName}`)
}

const p = abgleich(ergebnis, modelRows)
console.log('')
console.log(`Erfasst         : ${p.kontenErfasst} / ${p.kontenGesamt} Accounts mit Umsatz`)
console.log(`Nicht erfasst   : ${p.fehlenderUmsatz.toFixed(2)} $`)
console.log(`Abweichungen    : ${p.abweichungen.length}`)
console.log(`Ohne Zuordnung  : ${p.ohneZuordnung}`)

// Abweichungen sind KEIN Fehler: Umsatz, der keinem Chatter zugeordnet ist,
// kommt real vor (Julia am 22.08.2026: 46,15 Message Revenue, 9,60 in der
// Einzeldatei). Sie werden gemeldet, lassen den Test aber bestehen.
for (const a of p.abweichungen) {
  console.log(`  ⚠ ${a.creator}: ${a.differenz > 0 ? '+' : ''}${a.differenz.toFixed(2)} gegen ${a.basis}`)
}

if (offen > 0) {
  console.log('\n❌ Nicht jede Datei konnte zugeordnet werden.')
  process.exit(1)
}
console.log('\n✅ Jede Einzeldatei wurde einem Account zugeordnet.')
