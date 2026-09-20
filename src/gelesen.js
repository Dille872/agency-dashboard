import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

// ── Gelesen-Stand pro Login (v4.72.0) ──────────────────────────────────────
//
// Die Glocken merkten sich bis v4.71 im localStorage, bis wann alles gelesen
// ist — also pro Gerät. Wer am Rechner "Alles gelesen" drückte, sah am Handy
// trotzdem 99+. Jetzt liegt der Zeitpunkt in der Datenbank, pro Login
// (Tabelle gelesen_stand, sql/gelesen-stand.sql).
//
// WIE ES LÄUFT
// - Sofort beim Rendern gilt der Wert aus dem localStorage — kein Flackern,
//   kein Warten aufs Netz.
// - Dann kommt der Stand aus der Datenbank. Es gilt der SPÄTERE der beiden.
// - "Gelesen" schreibt beides. Den Zeitpunkt setzt der Server (now()), nicht
//   die Geräte-Uhr.
// - Neu geholt wird jede Minute und sobald die App wieder sichtbar wird —
//   so verschwindet die Zahl am Handy, kurz nachdem man am Rechner gelesen hat.
// - Fehlt die Tabelle (SQL noch nicht ausgeführt) oder ist das Netz weg,
//   bleibt alles wie vorher: localStorage allein.
//
// Ein gemeinsamer Speicher für alle Glocken: eine Abfrage pro Minute, nicht vier.

const NEU_HOLEN_MS = 60000

let stand = null            // { schluessel: ISO-Zeit } aus der Datenbank
let laufend = null          // laufende Abfrage (Promise), damit nicht doppelt geholt wird
let zuletzt = 0
let aus = false             // true, wenn die Funktionen fehlen — dann nicht weiter fragen
const hoerer = new Set()
const nachgereicht = new Set()

const spaeter = (a, b) => {
  if (!a) return b || ''
  if (!b) return a
  return new Date(a) >= new Date(b) ? a : b
}

function lokal(key) {
  try { return localStorage.getItem(key) || '' } catch { return '' }
}
function lokalSetzen(key, wert) {
  try { localStorage.setItem(key, wert) } catch { /* egal */ }
}

async function holen(erzwingen = false) {
  if (aus) return stand
  if (laufend) return laufend
  if (!erzwingen && stand && Date.now() - zuletzt < 5000) return stand
  laufend = (async () => {
    const { data, error } = await supabase.rpc('gelesen_laden')
    if (error) {
      // PGRST202 = Funktion unbekannt → SQL noch nicht gelaufen. Nicht jede Minute neu fragen.
      if (error.code === 'PGRST202' || /gelesen_laden/.test(error.message || '')) aus = true
      console.warn('Gelesen-Stand nicht geladen — bleibt pro Gerät:', error.message)
      return stand
    }
    stand = Object.fromEntries((data || []).map(r => [r.schluessel, r.gesehen_bis]))
    zuletzt = Date.now()
    hoerer.forEach(f => f())
    return stand
  })()
  try { return await laufend } finally { laufend = null }
}

async function setzen(schluessel, bis = null) {
  if (aus) return null
  const { data, error } = await supabase.rpc('gelesen_setzen', { p_schluessel: schluessel, p_bis: bis })
  if (error) { console.warn('Gelesen-Stand nicht gespeichert:', error.message); return null }
  stand = { ...(stand || {}), [schluessel]: spaeter(stand?.[schluessel], data) }
  hoerer.forEach(f => f())
  return data
}

// Laufzeit-Takt einmal für alle Glocken
let taktAn = false
function taktStarten() {
  if (taktAn || typeof window === 'undefined') return
  taktAn = true
  setInterval(() => { if (hoerer.size && document.visibilityState === 'visible') holen(true) }, NEU_HOLEN_MS)
  document.addEventListener('visibilitychange', () => {
    if (hoerer.size && document.visibilityState === 'visible') holen(true)
  })
}

/**
 * [gesehenBis, alsGelesenMarkieren]
 *
 * schluessel   — Name in der Datenbank ('adminbell', 'teamfeed', …), gilt pro Login
 * lokalKey     — bisheriger localStorage-Schlüssel (bleibt als schneller Zwischenspeicher)
 * startJetzt   — gibt es noch gar keinen Stand, gilt "ab jetzt" statt "alles ungelesen"
 *                (so verhielten sich ChatterBell und ModelBell schon bisher)
 */
export function useGelesen(schluessel, { lokalKey, startJetzt = false } = {}) {
  const lokalerWert = lokal(lokalKey)
  // Vorläufig = nur geraten ("ab jetzt"), weil weder Gerät noch Datenbank etwas wussten.
  // Ein echter Wert aus der Datenbank schlägt ihn dann auch, wenn er älter ist.
  const vorlaeufig = useRef(!lokalerWert && startJetzt)
  const [wert, setWert] = useState(() => {
    if (lokalerWert) return lokalerWert
    if (startJetzt) { const jetzt = new Date().toISOString(); lokalSetzen(lokalKey, jetzt); return jetzt }
    return ''
  })

  useEffect(() => {
    let aktiv = true
    const abgleichen = () => {
      if (!aktiv || !stand) return
      const entfernt = stand[schluessel] || ''
      if (vorlaeufig.current) {
        vorlaeufig.current = false
        if (entfernt) { lokalSetzen(lokalKey, entfernt); setWert(entfernt) }
        else setzen(schluessel)   // noch nirgends ein Stand: "ab jetzt" gilt dann für alle Geräte
        return
      }
      const hier = lokal(lokalKey)
      const neu = spaeter(hier, entfernt)
      if (neu && neu !== hier) lokalSetzen(lokalKey, neu)
      setWert(v => spaeter(v, neu))
      // Gerät weiß mehr als die Datenbank (erster Start nach dem Update, oder
      // ein "Gelesen" ohne Netz): nachreichen — höchstens einmal je Seitenaufruf,
      // denn der Server kappt auf seine eigene Uhr. Liefe die Geräte-Uhr vor,
      // bliebe der Server-Wert immer kleiner und es würde endlos nachgereicht.
      if (hier && (!entfernt || new Date(hier) > new Date(entfernt)) && !nachgereicht.has(schluessel)) {
        nachgereicht.add(schluessel)
        setzen(schluessel, hier)
      }
    }
    hoerer.add(abgleichen)
    taktStarten()
    holen().then(() => abgleichen())
    return () => { aktiv = false; hoerer.delete(abgleichen) }
  }, [schluessel, lokalKey, startJetzt])

  const markieren = useCallback(() => {
    const jetzt = new Date().toISOString()
    vorlaeufig.current = false
    setWert(jetzt)
    lokalSetzen(lokalKey, jetzt)
    // Die Server-Zeit kann ein paar Sekunden hinter der Geräte-Uhr liegen; der
    // Abgleich nimmt den späteren Wert, das Badge springt also nicht zurück.
    setzen(schluessel)
    return jetzt
  }, [schluessel, lokalKey])

  return [wert, markieren]
}
