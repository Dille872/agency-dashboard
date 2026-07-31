#!/usr/bin/env node
// v4.13.0 — Prüft, ob das Helpcenter zu den Portalen passt (Chatter UND Model).
//   npm run check:help
// Was NICHT geprüft werden kann: ob der Text noch stimmt. Ändert sich ein
// Ablauf, muss der Text nachgezogen werden.

import { readFileSync } from 'node:fs'

const PORTALE = [
  {
    name: 'Chatter-Portal',
    portal: 'src/components/ChatterPortal.jsx',
    help: 'src/help/chatterHelp.js',
    collapsible: true,
    ankerlos: ['ueberblick', 'angebote', 'bell', 'chat', 'pinnwand'],
  },
  {
    name: 'Model-Portal',
    portal: 'src/components/ModelPortal.jsx',
    help: 'src/help/modelHelp.js',
    collapsible: false,
    ankerlos: ['ueberblick', 'bell', 'chat'],
  },
]

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

let fehlerGesamt = 0

for (const cfg of PORTALE) {
  const portal = readFileSync(cfg.portal, 'utf8')
  const help = readFileSync(cfg.help, 'utf8')
  const ankerlos = new Set(cfg.ankerlos)

  const themen = [...help.matchAll(/^\s{4}id:\s*'([\w-]+)'/gm)].map(m => m[1])
  const tourBlock = help.match(/export const TOUR_IDS = \[([\s\S]*?)\]/)
  const tour = tourBlock ? [...tourBlock[1].matchAll(/'([\w-]+)'/g)].map(m => m[1]) : []

  const helpIds = new Set([...portal.matchAll(/helpId="([\w-]+)"/g)].map(m => m[1]))
  const dots = new Set([...portal.matchAll(/topic="([\w-]+)"/g)].map(m => m[1]))
  const anker = new Set([
    ...[...portal.matchAll(/data-help="([\w-]+)"/g)].map(m => m[1]),
    ...[...portal.matchAll(/<SektionsKopf\s+id="([\w-]+)"/g)].map(m => m[1]),
    ...helpIds,
  ])

  const fehler = []
  const hinweise = []

  if (cfg.collapsible) {
    for (const p of tags(portal, 'Collapsible')) {
      if (/helpId=/.test(p.text)) continue
      const titel = p.text.match(/title=(?:"([^"]*)"|\{`([^`]*)`\})/)
      fehler.push(`${cfg.portal}:${p.zeile} — <Collapsible> ohne helpId${titel ? `: "${titel[1] || titel[2]}"` : ''}`)
    }
  }

  for (const id of new Set([...helpIds, ...anker, ...dots])) {
    if (!themen.includes(id)) fehler.push(`${cfg.portal} — verweist auf Thema "${id}", das es in ${cfg.help} nicht gibt`)
  }
  for (const id of tour) {
    if (!themen.includes(id)) fehler.push(`${cfg.help} — TOUR_IDS enthält "${id}", aber kein Thema mit dieser id`)
  }
  for (const id of themen) {
    if (!anker.has(id) && !dots.has(id) && !ankerlos.has(id)) {
      hinweise.push(`Thema "${id}" ist nirgends in der Oberfläche verlinkt — weder ?-Symbol noch Anker`)
    }
  }

  console.log(`${cfg.name}: ${themen.length} Themen · ${tour.length} Tour-Schritte`)
  for (const h of hinweise) console.log(`  Hinweis: ${h}`)
  if (fehler.length === 0) {
    console.log('  Alles verdrahtet.')
  } else {
    for (const f of fehler) console.error(`  FEHLT: ${f}`)
    fehlerGesamt += fehler.length
  }
}

if (fehlerGesamt > 0) {
  console.error('')
  console.error(`${fehlerGesamt} Problem(e). Neue Funktion gebaut? Dann gehört ein Thema in die`)
  console.error('passende Datei unter src/help/ und ein ?-Symbol bzw. helpId an den Bereich.')
  process.exit(1)
}
process.exit(0)
