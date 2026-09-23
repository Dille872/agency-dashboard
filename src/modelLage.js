import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { datumInZone, BERLIN, meineZone, zeitIn, wandzeitZuDatum } from './zeit'
import { plusTage } from './jetzt'

// ── Wie steht es um meine Models? (v4.75.0) ─────────────────────────────────
//
// Für das Chatter-Portal, Tab „Heute": pro Model der Schicht der Zustand
// (online, Pause, nicht da, auf Reise), die Termine der Woche und was sich
// seit der letzten eigenen Schicht am Board geändert hat.
//
// Woher die Daten kommen:
//   Zustand     models_contact.status / status_until / status_note / last_seen
//               (setzt das Model selbst im Model-Portal; last_seen = Heartbeat)
//   Reise       model_board, Kategorie 'reise', mit date_from / date_to
//               (kommt als Board-Map vom Portal rein, wird hier nur ausgewertet)
//   Termine     model_calendar (termin/reise) + model_board 'termine' (date)
//   Änderungen  model_board_activity seit dem letzten eigenen Auschecken
//
// Board-Inhalte selbst lädt ChatterPortal schon (loadAssignedModelData) —
// hier wird nichts doppelt geholt.

export const ONLINE_MS = 3 * 60 * 1000   // wie CommTab: Heartbeat jünger als 3 Min

const heuteBerlin = () => datumInZone(new Date(), BERLIN).tag

// Reise-Eintrag, der heute läuft. Nur ein Datum eingetragen = genau dieser Tag.
export function reiseHeute(items = [], heute = heuteBerlin()) {
  return items.find(r => {
    const von = r.date_from || r.date_to
    const bis = r.date_to || r.date_from
    return von && bis && von <= heute && bis >= heute
  }) || null
}

// v4.94.0: Reisen in anstehend/laufend und vergangen teilen. Vergangen = das
// letzte eingetragene Datum liegt vor heute. Ohne Datum gilt als anstehend.
// Gelöscht wird nichts — Vergangenes landet nur im „Archiv“ (ausgeklappt).
export function teileReisen(items = [], heute = heuteBerlin()) {
  const ende = (r) => r.date_to || r.date_from || ''
  const start = (r) => r.date_from || r.date_to || ''
  const aktuell = items.filter(r => !ende(r) || ende(r) >= heute).sort((a, b) => start(a).localeCompare(start(b)))
  const alt = items.filter(r => ende(r) && ende(r) < heute).sort((a, b) => ende(b).localeCompare(ende(a)))
  return { aktuell, alt }
}

// Reisen, die in den nächsten 7 Tagen beginnen
export function reiseBald(items = [], heute = heuteBerlin()) {
  const grenze = plusTage(heute, 7)
  return items.filter(r => {
    const von = r.date_from || r.date_to
    return von && von > heute && von <= grenze
  })
}

// ── Termine mit „nicht erreichbar" (v4.97.0) ────────────────────────────────
//
// Christoph, 23.09.: Trägt ein Model einen Termin von 15 bis 18 Uhr ein und
// hakt „nicht erreichbar" an, sollen die Chatter das sehen — sonst wird in dem
// Fenster ein Custom zugesagt, das keiner erfüllen kann.
//
// Die Zeiten in model_calendar sind deutsche Zeit (wie überall im Dashboard,
// siehe auch send-reminders). Hier werden sie zu echten Zeitpunkten gerechnet,
// damit sie jedem Chatter in SEINER Zeit angezeigt werden können.

export const TERMIN_OHNE_ENDE_MIN = 120   // kein „bis" eingetragen → 2 Stunden

const zeitpunkt = (tag, uhr, standard) => wandzeitZuDatum(tag, String(uhr || standard).slice(0, 5), BERLIN).getTime()

/** Anfang und Ende eines Kalender-Eintrags als Zeitstempel (null = kein Datum). */
export function terminZeitraum(e) {
  if (!e?.due_date) return null
  const ganzerTag = !e.due_time
  const von = zeitpunkt(e.due_date, e.due_time, '00:00')
  let bis
  if (ganzerTag && !e.end_time) bis = zeitpunkt(plusTage(e.due_date, 1), '00:00', '00:00')
  else if (e.end_time) {
    bis = zeitpunkt(e.due_date, e.end_time, '00:00')
    // 22:00–01:00 heißt: bis morgen früh.
    if (bis <= von) bis = zeitpunkt(plusTage(e.due_date, 1), e.end_time, '00:00')
  } else bis = von + TERMIN_OHNE_ENDE_MIN * 60000
  return { von, bis, ganzerTag }
}

/**
 * Läuft gerade ein Termin, in dem das Model nicht erreichbar ist?
 * → { eintrag, von, bis, ganzerTag } oder null.
 */
export function terminJetzt(eintraege = [], jetzt = Date.now()) {
  const t = jetzt instanceof Date ? jetzt.getTime() : jetzt
  let treffer = null
  for (const e of eintraege || []) {
    if (!e?.nicht_erreichbar) continue
    const z = terminZeitraum(e)
    if (!z || t < z.von || t >= z.bis) continue
    // Mehrere gleichzeitig: der, der am spätesten endet.
    if (!treffer || z.bis > treffer.bis) treffer = { eintrag: e, ...z }
  }
  return treffer
}

/** „bis 18:00" in der Zeit des Betrachters — ganztägig ohne Uhrzeit. */
export function terminText(termin, zone = meineZone()) {
  if (!termin) return ''
  if (termin.ganzerTag && !termin.eintrag.end_time) return '⛔ Heute verplant'
  return `⛔ Termin bis ${zeitIn(new Date(termin.bis), zone)}`
}

/**
 * Zustand eines Models als Anzeige: { art, text, farbe, zeile }.
 * art: 'termin' | 'reise' | 'online' | 'pause' | 'weg' | 'offline' | 'unbekannt'
 *
 * `termin` (v4.97.0) kommt aus terminJetzt() und geht allem anderen vor: dass
 * sie in zehn Minuten wieder da ist, ist wichtiger als der Online-Punkt.
 */
export function zustand(kontakt, reise, jetzt = Date.now(), termin = null) {
  const zuletzt = kontakt?.last_seen ? new Date(kontakt.last_seen) : null
  const online = !!zuletzt && jetzt - zuletzt.getTime() < ONLINE_MS
  const bis = kontakt?.status_until ? new Date(kontakt.status_until) : null
  // Abgelaufene Pause zählt nicht mehr — das Model-Portal räumt sie erst auf,
  // wenn das Model es wieder öffnet.
  const status = bis && bis.getTime() < jetzt ? 'available' : (kontakt?.status || null)
  const uhr = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  const wann = (d) => {
    const std = (jetzt - d.getTime()) / 3600000
    if (std < 1) return `vor ${Math.max(1, Math.round(std * 60))} Min`
    if (std < 20) return uhr(d)
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  }
  const zeile = online ? 'gerade im Dashboard' : zuletzt ? `zuletzt aktiv ${wann(zuletzt)}` : null

  // v4.97.0: laufender Termin mit „nicht erreichbar". Steht sie trotzdem im
  // Dashboard, sagt das die Zeile darunter („gerade im Dashboard") — der
  // Chatter sieht beides und kann es selbst einschätzen.
  if (termin) return { art: 'termin', text: terminText(termin), farbe: '#ef4444', zeile, titel: termin.eintrag.title || null }
  if (reise) return { art: 'reise', text: '✈ Auf Reise', farbe: '#0891b2', zeile }
  if (status === 'pause') return { art: 'pause', text: `Pause${bis ? ` bis ${uhr(bis)}` : ''}`, farbe: '#f59e0b', zeile }
  if (status === 'unavailable') return { art: 'weg', text: `Nicht da${bis ? ` bis ${uhr(bis)}` : ''}`, farbe: '#ef4444', zeile }
  if (online) return { art: 'online', text: '● Online', farbe: '#10b981', zeile }
  if (zuletzt) return { art: 'offline', text: 'Offline', farbe: '#8888aa', zeile }
  return { art: 'unbekannt', text: 'Kein Status', farbe: '#8888aa', zeile: null }
}

// v4.76.0: models_contact.zeitzone (sql/model-reise-und-zeitzone.sql). Solange
// das SQL nicht gelaufen ist, gibt es die Spalte nicht — dann ohne sie laden,
// sonst fiele der ganze Zustand weg.
// v4.97.0: dasselbe Spiel für end_time / nicht_erreichbar (sql/model-termin-
// erreichbar.sql). Ist das SQL noch nicht gelaufen, fehlen die Spalten — dann
// ohne sie laden, sonst stünde bei jedem Model „Kein Status".
let ohneErreichbar = false
async function kalenderLaden(liste, heute) {
  const basis = 'id, model_name, title, due_date, due_time, category'
  const abfrage = (spalten) => supabase.from('model_calendar').select(spalten)
    .in('model_name', liste).in('category', ['termin', 'reise'])
    .gte('due_date', plusTage(heute, -1)).lte('due_date', plusTage(heute, 7)).order('due_date')
  if (!ohneErreichbar) {
    const r = await abfrage(basis + ', end_time, nicht_erreichbar')
    if (!r.error) return r
    if (!/end_time|nicht_erreichbar/.test(r.error.message || '')) return r
    ohneErreichbar = true
  }
  return abfrage(basis)
}

let ohneZone = false
async function kontakteLaden(liste) {
  const basis = 'name, status, status_until, status_note, last_seen'
  if (!ohneZone) {
    const r = await supabase.from('models_contact').select(basis + ', zeitzone').in('name', liste)
    if (!r.error) return r
    if (!/zeitzone/.test(r.error.message || '')) return r
    ohneZone = true
  }
  return supabase.from('models_contact').select(basis).in('name', liste)
}

// Freitext-Liste ("Pool, Strand\nBikini") → ['Pool', 'Strand', 'Bikini']
export const listeAus = (text) => String(text || '').split(/[,;\n]+/).map(t => t.trim()).filter(Boolean)

const LEER = { kontakte: {}, kalender: {}, aenderungen: {}, seit: null, geladen: false }

/**
 * Lädt Zustand, Kalender und Board-Änderungen für die übergebenen Models.
 * Aktualisiert jede Minute (Online-Status ändert sich laufend).
 */
export function useModelLage(namen, ich) {
  const schluessel = [...new Set(namen)].sort().join('|')
  const [daten, setDaten] = useState(LEER)

  const laden = useCallback(async () => {
    const liste = schluessel ? schluessel.split('|') : []
    if (!liste.length) { setDaten({ ...LEER, geladen: true }); return }
    const heute = heuteBerlin()
    try {
      const [k, mc, log] = await Promise.all([
        kontakteLaden(liste),
        kalenderLaden(liste, heute),
        ich
          ? supabase.from('shift_logs').select('checked_out_at').eq('display_name', ich)
              .not('checked_out_at', 'is', null).order('checked_out_at', { ascending: false }).limit(1)
          : Promise.resolve({ data: [] }),
      ])
      // „Seit deiner letzten Schicht" = seit dem letzten Auschecken. Ohne
      // Schicht-Log die letzten 3 Tage, und nie weiter als 14 Tage zurück.
      const vor = (t) => new Date(Date.now() - t * 864e5).toISOString()
      let seit = log.data?.[0]?.checked_out_at || vor(3)
      if (seit < vor(14)) seit = vor(14)
      const akt = await supabase.from('model_board_activity')
        .select('id, model_name, action, category, details, created_at')
        .in('model_name', liste).gt('created_at', seit)
        .order('created_at', { ascending: false }).limit(100)

      const nachModel = (rows) => {
        const m = {}
        for (const r of rows || []) (m[r.model_name] ||= []).push(r)
        return m
      }
      setDaten({
        kontakte: Object.fromEntries((k.data || []).map(r => [r.name, r])),
        kalender: nachModel(mc.data),
        aenderungen: nachModel(akt.data),
        seit,
        geladen: true,
      })
    } catch (e) {
      console.error('useModelLage', e)
      setDaten(d => ({ ...d, geladen: true }))
    }
  }, [schluessel, ich])

  useEffect(() => {
    laden()
    const t = setInterval(laden, 60 * 1000)
    return () => clearInterval(t)
  }, [laden])

  return daten
}
