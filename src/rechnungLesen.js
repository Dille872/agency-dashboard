// ── Rechnung lesen: Summe, Währung, IBAN (v5.38.0) ─────────────────────────
// Ohne KI und ohne fremden Dienst: Der Text einer PDF wird im Browser mit
// pdf.js gelesen (wie beim Skript-Import) und nach festen Regeln durchsucht.
// Fotos/Scans haben keinen Text → dort gibt es keinen Vorschlag.
// Ergebnis ist immer nur ein VORSCHLAG — ihr bestätigt oder korrigiert.

import { pdfZeilen, SEITE } from './pdfSkripte'

const STARK = /(gesamt|endsumme|summe|total|zu\s*zahlen|zahlbetrag|rechnungsbetrag|endbetrag|amount\s*due|auszahlung)/i
const SCHWACH = /(betrag|brutto|amount)/i
// Betrag mit genau 2 Nachkommastellen; nicht Teil eines Datums (03.10.2026)
const BETRAG = /(€|eur|usd|us\$|\$)?\s*(?<![\d.,])(-?\d{1,3}(?:[.,\s']\d{3})+[.,]\d{2}|-?\d+[.,]\d{2})(?![\d]|[.,]\d)\s*(€|eur|euro|usd|\$|dollar)?/gi

function zahl(t) {
  let s = String(t).replace(/[\s']/g, '')
  const letzt = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'))
  s = s.slice(0, letzt).replace(/[.,]/g, '') + '.' + s.slice(letzt + 1)
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const waehrungVon = (a, b) => {
  const t = `${a || ''}${b || ''}`.toLowerCase()
  if (/\$|usd|dollar/.test(t)) return 'USD'
  if (/€|eur/.test(t)) return 'EUR'
  return null
}

function betraegeIn(zeile) {
  const out = []
  for (const m of String(zeile).matchAll(BETRAG)) {
    const wert = zahl(m[2])
    if (wert != null && wert > 0) out.push({ wert, waehrung: waehrungVon(m[1], m[3]) })
  }
  return out
}

// IBAN prüfen (Modulo 97)
function ibanGueltig(iban) {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const umgestellt = iban.slice(4) + iban.slice(0, 4)
  let rest = 0
  for (const ch of umgestellt) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch
    for (const d of v) rest = (rest * 10 + Number(d)) % 97
  }
  return rest === 1
}
export const ibanSchoen = (iban) => String(iban || '').replace(/(.{4})/g, '$1 ').trim()

function ibanFinden(text) {
  const roh = String(text).toUpperCase()
  for (const m of roh.matchAll(/[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,34}/g)) {
    const ohne = m[0].replace(/\s/g, '')
    for (let len = Math.min(34, ohne.length); len >= 15; len--) {
      const k = ohne.slice(0, len)
      if (ibanGueltig(k)) return k
    }
  }
  return null
}

export function ausText(zeilen) {
  const z = zeilen.filter(x => x && x !== SEITE)
  const ganz = z.join('\n')
  // Währung im ganzen Dokument (für Beträge ohne Zeichen)
  const usd = (ganz.match(/\$|usd|dollar/gi) || []).length
  const eur = (ganz.match(/€|eur(?!o?pa)/gi) || []).length
  const dokWaehrung = usd > eur ? 'USD' : eur > 0 ? 'EUR' : null

  const kandidaten = []
  z.forEach((zeile, i) => {
    const stark = STARK.test(zeile), schwach = !stark && SCHWACH.test(zeile)
    if (!stark && !schwach) return
    let b = betraegeIn(zeile)
    // Betrag steht manchmal in der nächsten Zeile
    if (!b.length) for (let j = i + 1; j <= i + 2 && j < z.length && !b.length; j++) b = betraegeIn(z[j])
    for (const x of b) kandidaten.push({ ...x, gewicht: stark ? 2 : 1, pos: i })
  })
  let wahl = null
  if (kandidaten.length) {
    const top = Math.max(...kandidaten.map(k => k.gewicht))
    const beste = kandidaten.filter(k => k.gewicht === top)
    wahl = beste.reduce((a, b) => (b.wert > a.wert || (b.wert === a.wert && b.pos > a.pos) ? b : a))
  } else {
    // Rückfall: größter Betrag mit Währungszeichen
    const alle = z.flatMap(betraegeIn).filter(x => x.waehrung)
    if (alle.length) wahl = alle.reduce((a, b) => (b.wert > a.wert ? b : a))
  }
  return {
    betrag: wahl ? Math.round(wahl.wert * 100) / 100 : null,
    waehrung: wahl?.waehrung || dokWaehrung,
    iban: ibanFinden(ganz.replace(/\n/g, ' ')),
  }
}

// Datei → Vorschlag. Nur PDFs mit Text; sonst { leer: true }
export async function rechnungLesen(datei) {
  try {
    const istPdf = /pdf/i.test(datei?.type || '') || /\.pdf$/i.test(datei?.name || '')
    if (!istPdf) return { leer: true, grund: 'foto' }
    const zeilen = await pdfZeilen(datei)
    if (!zeilen.some(x => x && x !== SEITE)) return { leer: true, grund: 'scan' }
    const r = ausText(zeilen)
    return { ...r, leer: r.betrag == null && !r.iban }
  } catch {
    return { leer: true, grund: 'fehler' }
  }
}
