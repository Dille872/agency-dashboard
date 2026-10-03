// ── Skripte aus PDF lesen (v5.32.0) ────────────────────────────────────────
// Ganz ohne KI: Der Text wird im Browser mit pdf.js ausgelesen (geht an keinen
// Dienst) und nach festen Regeln in Skripte und Schritte zerlegt. Danach sieht
// man einen Vorschlag und korrigiert ihn, bevor etwas in die Bibliothek kommt.
//
// Regeln (passend zu euren PDFs):
//   • „Video 2“, „Skript 3“, „Clip 4“ … am Zeilenanfang = neues Skript
//     (der Rest der Zeile wird der Titel)
//   • „Schritt 1“, „Step 2“, „Szene 3“, „1.“, „2)“, „- …“, „• …“ = neuer Schritt;
//     Zeilen danach gehören zum selben Schritt
//   • gibt es keine solchen Marker: jeder Absatz (Leerzeile dazwischen) = ein Schritt
//   • „Outfit: …“, „Ort: …“, „Länge: …“, „Dauer: …“, „Notiz/Hinweis/Preis: …“ → eigene Felder

const LEER = ''
export const SEITE = '\f' // Seitenwechsel

// PDF → Zeilen ('' = Leerzeile/Absatz)
export async function pdfZeilen(datei) {
  const pdfjs = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const daten = new Uint8Array(await datei.arrayBuffer())
  const doc = await pdfjs.getDocument({ data: daten, isEvalSupported: false }).promise
  const zeilen = []
  for (let s = 1; s <= doc.numPages; s++) {
    const seite = await doc.getPage(s)
    const inhalt = await seite.getTextContent()
    // Textstücke zu Zeilen zusammensetzen (gleiche y-Position = gleiche Zeile)
    const roh = []
    let akt = null
    for (const it of inhalt.items) {
      if (!('str' in it)) continue
      const y = it.transform[5]
      const h = Math.abs(it.transform[3]) || it.height || 10
      if (!akt || Math.abs(akt.y - y) > h * 0.5) {
        if (akt) roh.push(akt)
        akt = { y, h, text: it.str }
      } else {
        akt.text += (akt.text && !akt.text.endsWith(' ') && it.str && !it.str.startsWith(' ') ? ' ' : '') + it.str
      }
      if (it.hasEOL) { roh.push(akt); akt = null }
    }
    if (akt) roh.push(akt)
    // Leerzeilen erkennen: Abstand deutlich größer als die Zeilenhöhe
    for (let i = 0; i < roh.length; i++) {
      const z = roh[i]
      const t = z.text.replace(/\s+/g, ' ').trim()
      if (i > 0) {
        const abstand = Math.abs(roh[i - 1].y - z.y)
        if (abstand > Math.max(z.h, roh[i - 1].h) * 1.9) zeilen.push(LEER)
      }
      zeilen.push(t)
    }
    zeilen.push(SEITE) // Seitenende
  }
  return zeilen
}

export async function textZeilen(datei) {
  const t = await datei.text()
  return t.replace(/\r/g, '').split('\n').map(z => z.replace(/\s+/g, ' ').trim())
}

const KOPF = /^(video|skript|script|clip|teil|idee|reel)\s*(nr\.?|nummer|#)?\s*(\d{1,3})\b\s*[:.\-–—)]*\s*(.*)$/i
const SCHRITT = /^(schritt|step|szene|scene)\s*(\d{1,2})\b\s*[:.\-–—)]*\s*(.*)$/i
const NUM = /^(\d{1,2})\s*[.)]\s+(.*)$/
const PUNKT = /^[-•*–·▪●]\s+(.*)$/
const FELD = /^(outfit\s*\/\s*ort|outfit|ort|location|look|länge|laenge|dauer|notiz|hinweis|preis|ch)\s*[:–—-]\s*(.*)$/i

const feldName = (k) => {
  k = k.toLowerCase()
  if (k.startsWith('outfit') || k === 'ort' || k === 'location' || k === 'look') return 'outfit'
  if (k.startsWith('l') || k === 'dauer') return 'laenge'
  return 'notiz_builder'
}
const markerText = (z) => {
  let m
  if ((m = z.match(SCHRITT))) return m[3]
  if ((m = z.match(NUM))) return m[2]
  if ((m = z.match(PUNKT))) return m[1]
  return null
}

function skriptAusZeilen(zeilen, titelVorgabe) {
  const s = { titel: titelVorgabe || '', schritte: [], outfit: '', laenge: '', notiz_builder: '' }
  const rest = []
  for (const z of zeilen) {
    const f = z && z.match(FELD)
    if (f && f[2]) {
      const k = feldName(f[1])
      const wert = k === 'notiz_builder' && /^(preis|ch)$/i.test(f[1]) ? `${f[1][0].toUpperCase()}${f[1].slice(1).toLowerCase()}: ${f[2]}` : f[2]
      s[k] = s[k] ? `${s[k]} · ${wert}` : wert
      continue
    }
    rest.push(z)
  }
  // Titel: erste kurze Zeile, wenn keiner vorgegeben ist und sie kein Schritt ist
  if (!s.titel) {
    const i = rest.findIndex(z => z)
    if (i >= 0 && rest[i].length <= 90 && markerText(rest[i]) === null) { s.titel = rest[i]; rest.splice(i, 1) }
  }
  const mitMarkern = rest.some(z => z && markerText(z) !== null)
  if (mitMarkern) {
    let akt = null
    for (const z of rest) {
      if (!z) continue
      const t = markerText(z)
      if (t !== null) { akt = { text: t }; s.schritte.push(akt) }
      else if (akt) akt.text = akt.text ? `${akt.text} ${z}` : z
      else { akt = { text: z }; s.schritte.push(akt) } // Text vor dem ersten Marker
    }
  } else {
    let absatz = []
    const fertig = () => { if (absatz.length) s.schritte.push({ text: absatz.join(' ') }); absatz = [] }
    for (const z of rest) { if (!z) fertig(); else absatz.push(z) }
    fertig()
  }
  s.schritte = s.schritte.map(x => ({ text: x.text.trim().slice(0, 500) })).filter(x => x.text)
  s.titel = String(s.titel || '').slice(0, 200)
  return s
}

// modus: 'auto'  = bei „Video 2“ usw. trennen, außerdem bei einer neuen Seite,
//                  die mit einer Überschrift (kurze Zeile, kein Schritt) beginnt
//        'seite' = jede PDF-Seite ist ein Skript
//        'eins'  = ganze Datei ist ein Skript
const istTitelZeile = (z) => z && z !== SEITE && z.length <= 70 && markerText(z) === null && !FELD.test(z) && !KOPF.test(z)

export function zerlegen(zeilenRoh, { modus = 'auto', dateiname = '' } = {}) {
  const name = String(dateiname || '').replace(/\.(pdf|txt)$/i, '').replace(/[_-]+/g, ' ').trim()
  const zeilen = modus === 'eins' ? zeilenRoh.map(z => (z === SEITE ? LEER : z)) : zeilenRoh

  // Abschnitte bestimmen: { start, ende, titel }
  const starts = []
  if (modus === 'seite') {
    let beginn = 0
    zeilen.forEach((z, i) => { if (z === SEITE) { starts.push({ start: beginn, ende: i, titel: '' }); beginn = i + 1 } })
    if (beginn < zeilen.length) starts.push({ start: beginn, ende: zeilen.length, titel: '' })
  } else if (modus === 'auto') {
    const koepfe = []
    zeilen.forEach((z, i) => {
      if (z && z !== SEITE && KOPF.test(z)) koepfe.push({ i, kopf: true })
      else if (z === SEITE) {
        // nächste nicht-leere Zeile nach dem Seitenwechsel
        let j = i + 1
        while (j < zeilen.length && (zeilen[j] === LEER || zeilen[j] === SEITE)) j++
        if (j < zeilen.length && istTitelZeile(zeilen[j]) && !KOPF.test(zeilen[j])) {
          // nur wenn die vorige Seite schon Schritte hatte und danach wieder Inhalt kommt
          const rest = zeilen.slice(j + 1).filter(x => x && x !== SEITE)
          if (rest.length) koepfe.push({ i: j, kopf: false })
        }
      }
    })
    if (koepfe.length) {
      const vorne = zeilen.slice(0, koepfe[0].i).filter(z => z && z !== SEITE)
      const gruppe = vorne.length && vorne[0].length <= 60 ? vorne[0] : name
      if (vorne.length > 1) starts.push({ start: 0, ende: koepfe[0].i, titel: '' })
      koepfe.forEach((k, n) => {
        const ende = n + 1 < koepfe.length ? koepfe[n + 1].i : zeilen.length
        if (k.kopf) {
          const m = zeilen[k.i].match(KOPF)
          const art = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()
          starts.push({ start: k.i + 1, ende, titel: (m[4] || '').trim() || `${gruppe ? gruppe + ' · ' : ''}${art} ${m[3]}` })
        } else {
          starts.push({ start: k.i + 1, ende, titel: zeilen[k.i] })
        }
      })
    }
  }
  if (!starts.length) starts.push({ start: 0, ende: zeilen.length, titel: '' })

  return starts
    .map(({ start, ende, titel }) => {
      const s = skriptAusZeilen(zeilen.slice(start, ende).map(z => (z === SEITE ? LEER : z)), titel)
      if (!s.titel) s.titel = name || 'Skript aus PDF'
      return s
    })
    .filter(s => s.schritte.length || s.outfit || s.laenge)
}
