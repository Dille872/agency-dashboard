// ── Adresszeile ⇄ Ansicht ──────────────────────────────────────────────────
//
// v4.68.0. Bis hierher lag die geoeffnete Ansicht ausschliesslich im React-
// State. Im Alltag hiess das: kein Screen war verlinkbar, der Zurueck-Button
// des Browsers tat nichts, jeder Reload landete wieder auf "Models" — und eine
// Telegram-Meldung konnte nur sagen "schau im Dashboard nach", nicht wohin.
//
// WARUM QUERY UND NICHT HASH
// Supabase legt seine Login- und Einladungslinks im Hash ab
// (#access_token=...&type=invite — siehe App.jsx und SetPasswordPage). Ein
// Hash-Router wuerde die beim ersten Schreiben ueberbuegeln und damit jede
// Einladung unbrauchbar machen. Die Ansicht steht deshalb in der Query.
//
// FORM
//   ?tab=chatters-comm                   → Tab oeffnen
//   ?tab=chatters-comm&ziel=swaps&id=412 → Tab oeffnen und dort hinspringen
//
// ziel/id sind ein EINMALIGER Sprungbefehl: sie werden beim Ankommen
// ausgewertet und danach aus der Adresszeile genommen, damit ein spaeterer
// Reload nicht wieder dorthin springt.

const MUSTER_TAB = /^[a-z][a-z-]{0,29}$/
const MUSTER_ZIEL = /^[a-z][a-z-]{0,29}$/
const MUSTER_ID = /^[A-Za-z0-9_-]{1,64}$/

// Fremde Werte aus der Adresszeile sind nichts weiter als Text von aussen:
// Was nicht ins Muster passt, wird verworfen statt weitergereicht.
export function routeLesen() {
  try {
    const p = new URLSearchParams(window.location.search)
    const nimm = (name, muster) => {
      const wert = p.get(name)
      return wert && muster.test(wert) ? wert : null
    }
    return {
      tab: nimm('tab', MUSTER_TAB),
      ziel: nimm('ziel', MUSTER_ZIEL),
      id: nimm('id', MUSTER_ID),
    }
  } catch {
    return { tab: null, ziel: null, id: null }
  }
}

// `ersetzen` heisst: den aktuellen History-Eintrag ueberschreiben statt einen
// neuen anzulegen. Das ist richtig fuer alles, was der Nutzer nicht selbst
// angeklickt hat (Startansicht, Rollen-Zwang, Zurueck-Button).
export function routeSchreiben({ tab = null, ziel = null, id = null }, { ersetzen = false } = {}) {
  try {
    const p = new URLSearchParams(window.location.search)
    // Fremde Parameter (utm_*, Rücklaeufer von Diensten) bleiben stehen.
    if (tab) p.set('tab', tab); else p.delete('tab')
    if (ziel) p.set('ziel', ziel); else p.delete('ziel')
    if (id) p.set('id', String(id)); else p.delete('id')
    const such = p.toString()
    const neu = window.location.pathname + (such ? '?' + such : '') + window.location.hash
    const jetzt = window.location.pathname + window.location.search + window.location.hash
    if (neu === jetzt) return
    window.history[ersetzen ? 'replaceState' : 'pushState'](null, '', neu)
  } catch (e) {
    // Eine Adresszeile, die sich nicht schreiben laesst, darf das Dashboard
    // nicht anhalten — die Ansicht steht ja trotzdem im State.
    console.warn('Route nicht geschrieben:', e)
  }
}

// Vollstaendiger Link auf eine bestimmte Stelle im Dashboard — fuer Telegram-
// Meldungen, Mails und alles andere, was von aussen hierher zeigen soll.
// `basis` ist die oeffentliche Adresse der App; ohne Angabe die laufende.
export function linkZu({ tab = null, ziel = null, id = null }, basis) {
  const wurzel = String(basis || (window.location.origin + window.location.pathname)).replace(/\/+$/, '')
  const p = new URLSearchParams()
  if (tab) p.set('tab', tab)
  if (ziel) p.set('ziel', ziel)
  if (id) p.set('id', String(id))
  const such = p.toString()
  return wurzel + '/' + (such ? '?' + such : '')
}
