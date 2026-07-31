#!/usr/bin/env node
// v4.9.1 — Prueft, ob das Helpcenter zum Chatter-Portal passt.
//   npm run check:help
import { readFileSync } from 'node:fs'

const PORTAL = 'src/components/ChatterPortal.jsx'
const HELP = 'src/help/chatterHelp.js'
const ANKERLOS = new Set(['ueberblick', 'angebote', 'bell', 'chat', 'pinnwand'])

const portal = readFileSync(PORTAL, 'utf8')
const help = readFileSync(HELP, 'utf8')

const themen = [...help.matchAll(/^\s{4}id:\s*'([\w-]+)'/gm)].map(m => m[1])
const tourBlock = help.match(/export const TOUR_IDS = \[([\s\S]*?)\]/)
const tour = tourBlock ? [...tourBlock[1].matchAll(/'([\w-]+)'/g)].map(m => m[1]) : []

function tags(src, name) {
  const out = []
  let i = 0
  while ((i = src.indexOf('<' + name, i)) !== -1) {
    let depth = 0, j = i + name.length + 1
    for (; j < src.length; j++) {
      const c = src[j]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    out.push({ text: src.slice(i, j + 1), zeile: src.slice(0, i).split('\n').length })
    i = j
  }
  return out
}

const panels = tags(portal, 'Collapsible')
const helpIds = new Set([...portal.matchAll(/helpId="([\w-]+)"/g)].map(m => m[1]))
const anker = new Set([
  ...[...portal.matchAll(/data-help="([\w-]+)"/g)].map(m => m[1]),
  ...helpIds,
])

const fehler = []
const hinweise = []

for (const p of panels) {
  if (/helpId=/.test(p.text)) continue
  const titel = p.text.match(/title=(?:"([^"]*)"|\{`([^`]*)`\})/)
  fehler.push(`${PORTAL}:${p.zeile} — <Collapsible> ohne helpId${titel ? `: "${titel[1] || titel[2]}"` : ''}`)
}
for (const id of [...helpIds, ...anker]) {
  if (!themen.includes(id)) fehler.push(`${PORTAL} — verweist auf Thema "${id}", das es in ${HELP} nicht gibt`)
}
for (const id of tour) {
  if (!themen.includes(id)) fehler.push(`${HELP} — TOUR_IDS enthaelt "${id}", aber kein Thema mit dieser id`)
}
for (const id of themen) {
  if (!anker.has(id) && !ANKERLOS.has(id)) {
    hinweise.push(`Thema "${id}" hat keinen data-help-Anker — die Tour kann es nicht ausleuchten`)
  }
}

console.log(`Helpcenter: ${themen.length} Themen · ${panels.length} Panels · ${tour.length} Tour-Schritte`)
for (const h of hinweise) console.log(`  Hinweis: ${h}`)
if (fehler.length === 0) {
  console.log('  Alles verdrahtet.')
  process.exit(0)
}
console.error('')
for (const f of fehler) console.error(`  FEHLT: ${f}`)
console.error('')
console.error(`${fehler.length} Problem(e). Neue Funktion gebaut? Dann gehoert ein Thema in ${HELP}`)
console.error('und ein helpId an das Panel.')
process.exit(1)
