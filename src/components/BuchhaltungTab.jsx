import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Receipt, Send, Check, Upload, FileText, MessageCircleWarning, Undo2, Bell, X, Download, Plus, Trash2, RefreshCw, TriangleAlert, CircleCheck, FolderDown, FileSpreadsheet, UserPlus, Pencil, Copy, Eye, ExternalLink, Sparkles, HandCoins, Search, Link2, Users, Repeat, ChevronLeft, ChevronRight, Landmark, BookUser, ShieldAlert,
} from 'lucide-react'
import {
  STATUS, ART, euro, dollar, geld, datum, datumZeit, heuteIso, monatName, fehltTabelle, zahlAus,
  abrechnungenLaden, periode, zeitraumLaden, anzeige, statusVon, extrasVon, gesamtEur, gesamt, istManuell,
  manuellSpeichern, letzterEintrag, namenVorschlaege, eintragLoeschen, rechnungNeuLesen, rechnungsangabenSpeichern, rechnungEntfernen, erkanntNachtragen, anzahlungenVon, anzahlungSumme, anzahlungenSpeichern,
  zeileSichern, extrasSpeichern, zahlenAktualisieren,
  rechnungHochladen, alsBezahlt, bezahltZurueck, klaerung, erinnern, abrechnungPdf, exportZip, exportCsv,
  gruppenLaden, gruppeAnlegen, gruppeAufloesen, gruppieren,
  empfaengerLaden, empfaengerSpeichern, empfaengerLoeschen, rechnungNrSpeichern, wiseHerunterladen, ibanVergleich, nameVergleich,
  rhythmusLaden, rhythmusSpeichern, istWoechentlich, wochenUebersicht, letzteWoche, plusTage, wocheStartVon, wocheText, WOCHENTAG,
} from '../buchhaltung'
import { oeffnen, signiert } from '../medien'
import { supabase } from '../supabase'
import { rechnungLesen, ibanSchoen, ibanGueltig } from '../rechnungLesen'

// ── Buchhaltung (v5.37.0 · v5.37.1) ────────────────────────────────────────
// Verwaltung → Buchhaltung. Die Zahlen stehen automatisch drin (wie Billing).
// Pro Chatter: Anteil + Extras (z. B. Skripte, Bonus, Abzug) = Gesamt, daneben
// Rechnung da / fehlt und „Bezahlt“. (v5.39.0: kein „Bescheid geben“ mehr —
// Chatter laden ihre Rechnung jederzeit selbst im Portal hoch.) Früher: Mit „Bescheid geben“ sah der Chatter
// seine Abrechnung und bekommt Telegram; vorher ist alles euer Entwurf.
// v5.38.0: „+ Team / ohne Profil“ (z. B. Alina in $, ehemalige Chatter wie Joel),
// Summe + IBAN aus PDF-Rechnungen vorgeschlagen, Rechnung im Fenster ansehen.
// v5.43.0: „Zusammenlegen“ — mehrere Chatter mit EINER Rechnung (z. B. Paar mit
// Firma) als eine Zeile: Summe, eine Rechnung, ein Bezahlt; Anteile darunter.
// v5.44.0: Reiter „Woche“ + „Rhythmus“: Chatter, die wöchentlich bezahlt werden
// (z. B. Etienne, So–Sa), mit den Zahlen der Woche; im Monat als Wochen-Übersicht.
// v5.45.0: „Für Wise“: Datei für Wise-Sammelüberweisungen (Name wie auf dem Konto,
// Privat/Firma, IBAN, Rest-Betrag) — danach auf Wunsch alle als bezahlt eintragen.
// v5.46.0: Adressbuch (Name/Firma, Privat/Firma, IBAN je Person). Jede Rechnung
// wird abgeglichen; überwiesen wird an die IBAN aus dem Adressbuch. Betreff bei
// Wise = Rechnungsnummer (aus der PDF gelesen oder eingetippt).

const letzteMonate = (n = 12) => {
  const out = []; const d = new Date()
  for (let i = 0; i < n; i++) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0')) }
  return out
}
const SPEICHER = 'buchhaltung_ansicht_v1'
const lies = () => { try { return JSON.parse(localStorage.getItem(SPEICHER) || 'null') } catch { return null } }

export default function BuchhaltungTab({ userDisplayName }) {
  const start = lies()
  const [modus, setModus] = useState(start?.modus || 'monat')            // 'monat' | 'woche' | 'frei' | 'offen'
  const [woche, setWoche] = useState(start?.woche || null)                // Beginn der Woche (YYYY-MM-DD)
  const [rh, setRh] = useState({ liste: [], woechentlich: [], start: 0 })  // v5.44.0: Rhythmus je Chatter
  const [rhFenster, setRhFenster] = useState(null)                        // { alle, woche: Set, start }
  const [wochenBox, setWochenBox] = useState([])
  const [buch, setBuch] = useState({ map: {} })                            // v5.46.0: Adressbuch { map, fehlt }
  const [buchFenster, setBuchFenster] = useState(null)                     // { zeilen: [...] }
  const [wise, setWise] = useState(null)                                   // v5.45.0: { zeilen: [...], fehlt, geladen, am }                           // Monat: Wochen der wöchentlichen Chatter
  const [monat, setMonat] = useState(start?.monat || letzteMonate(2)[1])  // Standard: letzter abgeschlossener Monat
  const [von, setVon] = useState(start?.von || '')
  const [bis, setBis] = useState(start?.bis || '')
  const [daten, setDaten] = useState(null)        // Zeitraum: { items, kurs, tage, tageSoll, letzterTag } · offen: { items }
  const [filter, setFilter] = useState('alle')
  const [meldung, setMeldung] = useState('')
  const [busy, setBusy] = useState(null)
  const [bezahlt, setBezahlt] = useState(null)
  const [klaer, setKlaer] = useState(null)
  const [extras, setExtras] = useState(null)       // { item, p, liste }
  const [exp, setExp] = useState(null)             // { ab, bis, nurBezahlt, laeuft, text }
  const [suche, setSuche] = useState('')
  const [anz, setAnz] = useState(null)             // Anzahlung: { i, liste, betrag, am, notiz }
  const [hand, setHand] = useState(null)           // Team / ohne Profil: { row?, name, art, monat, betrag, waehrung, notiz, iban, datei, erkannt }
  const [ansehen, setAnsehen] = useState(null)     // { url, name, iban, betrag, waehrung }
  const [namen, setNamen] = useState([])
  const [gruppen, setGruppen] = useState({ liste: [] })   // v5.43.0: aktive Gruppen
  const [grp, setGrp] = useState(null)                     // Fenster „Zusammenlegen“: { name, mitglieder, alle }
  useEffect(() => { namenVorschlaege().then(setNamen).catch(() => {}) }, [])
  const datei = useRef(null)
  const ziel = useRef(null)

  useEffect(() => { try { localStorage.setItem(SPEICHER, JSON.stringify({ modus, monat, von, bis, woche })) } catch { /* egal */ } }, [modus, monat, von, bis, woche])
  useEffect(() => { rhythmusLaden().then(r => { setRh(r); setWoche(w => w ? wocheStartVon(w, r.start) : letzteWoche(r.start)) }) }, [])

  const p = useMemo(() => {
    if (modus === 'offen') return null
    if (modus === 'woche') return woche ? periode({ frei: true, von: woche, bis: plusTage(woche, 6) }) : null
    if (modus === 'frei' && !(von && bis && von <= bis)) return null
    return periode({ monat, von, bis, frei: modus === 'frei' })
  }, [modus, monat, von, bis, woche])

  const lade = async () => {
    const [gr, ab] = await Promise.all([gruppenLaden(), empfaengerLaden()])
    setGruppen(gr); setBuch(ab)
    if (modus === 'offen') {
      const { data, error } = await abrechnungenLaden()
      if (error) { setDaten({ fehler: fehltTabelle(error) ? 'Die Datenbank für die Buchhaltung fehlt noch: sql/buchhaltung.sql und sql/buchhaltung-entwurf.sql ausführen.' : error.message, items: [] }); return }
      const items = (data || []).filter(r => r.status !== 'bezahlt')
        .map(r => ({ key: 'r' + r.id, name: r.chatter_name, row: r, live: null, telegram: null, manuell: istManuell(r), p: { ab: r.von, ende: r.bis, bezug: r.monat, frei: r.frei, bezeichnung: r.bezeichnung } }))
      setDaten({ items: gruppieren(items, gr.liste) }); return
    }
    if (!p) { setDaten({ items: [] }); return }
    const rhy = await rhythmusLaden()
    setRh(rhy)
    const namenW = rhy.woechentlich.map(x => x.chatter_name)
    if (modus === 'woche' && !namenW.length) { setDaten({ items: [], ohneWoechentliche: true }); return }
    if (modus === 'monat') wochenUebersicht(p.bezug, rhy).then(setWochenBox).catch(() => setWochenBox([]))
    else setWochenBox([])
    const r = await zeitraumLaden(p, modus === 'woche' ? { nur: namenW } : modus === 'monat' ? { ohneLive: namenW } : {})
    if (r.fehler) { setDaten({ fehler: r.fehler, items: [] }); return }
    setDaten({ ...r, items: gruppieren(r.items.map(i => ({ ...i, p, key: i.manuell ? 'r' + i.row.id : 'c-' + i.name })), gr.liste) })
  }
  useEffect(() => { setDaten(null); lade() }, [modus, p?.ab, p?.ende]) // eslint-disable-line react-hooks/exhaustive-deps

  // v5.39.2: Rechnungen ohne Betrag (z. B. vor der Erkennung hochgeladen) im
  // Hintergrund einmal lesen und Summe/IBAN nachtragen — nur leere Felder.
  const gelesenSchon = useRef(new Set())
  const [liestNach, setLiestNach] = useState(0)
  useEffect(() => {
    const offen = (daten?.items || []).flatMap(i => i.gruppe ? i.mitglieder.map(m => m.row) : [i.row])
      .filter(r => r && r.rechnung_url && (r.rechnung_betrag == null || ('rechnung_nr' in r && !r.rechnung_nr)) && !gelesenSchon.current.has(r.id) && /\.pdf(\?|$)/i.test(r.rechnung_name || r.rechnung_url))
    if (!offen.length) return
    let weg = false
    ;(async () => {
      let neu = 0
      setLiestNach(offen.length)
      for (const r of offen.slice(0, 25)) {
        if (weg) return
        gelesenSchon.current.add(r.id)
        const g = await rechnungNeuLesen(r)
        if (!g.leer && (g.betrag != null || g.iban || g.nummer)) { const x = await erkanntNachtragen(r, g); if (!x.error && !x.leer) neu++ }
      }
      if (!weg) { setLiestNach(0); if (neu) lade() }
    })()
    return () => { weg = true }
  }, [daten]) // eslint-disable-line react-hooks/exhaustive-deps

  const items = daten?.items || []
  const statusZahl = (st) => items.filter(i => statusVon(i.row) === st).length
  const q = suche.trim().toLowerCase()
  const sichtbar = items.filter(i => (filter === 'alle' || statusVon(i.row) === filter)
    && (!q || i.name.toLowerCase().includes(q) || String(i.row?.notiz || '').toLowerCase().includes(q) || (i.mitglieder || []).some(m => m.name.toLowerCase().includes(q))))
  const summe = (l) => l.reduce((t, i) => { const G = gesamtVon(i); return t + (G.waehrung === 'EUR' ? (G.wert || 0) : 0) }, 0)
  const summeUsd = (l) => l.filter(i => istManuell(i.row) && i.row.waehrung === 'USD').reduce((t, i) => t + (gesamt(i.row).wert || 0), 0)
  const fehlen = items.filter(i => statusVon(i.row) === 'offen' && !i.manuell)
  const bezahltListe = items.filter(i => statusVon(i.row) === 'bezahlt')
  const anzOffen = items.filter(i => statusVon(i.row) !== 'bezahlt' && !(istManuell(i.row) && i.row.waehrung === 'USD')).reduce((t, i) => t + anzahlungSumme(i.row), 0)

  const melde = (t) => { setMeldung(t); if (t) setTimeout(() => setMeldung(m => (m === t ? '' : m)), 7000) }
  const sichern = async (item) => {
    const r = await zeileSichern(item, item.p, userDisplayName)
    if (r.error) { alert('Nicht gespeichert: ' + (fehltTabelle(r.error) ? 'Datenbank fehlt noch (sql/buchhaltung-entwurf.sql).' : r.error.message)); return null }
    return r.row
  }

  // ── Aktionen ─────────────────────────────────────────────────────────────
  // Gruppe: die Rechnung hängt an dem Mitglied, das schon eine hat (sonst am ersten)
  const zielMitglied = (i) => i.gruppe ? (i.mitglieder.find(m => m.row && m.row === i.row.halter) || i.mitglieder[0]) : i
  const hochladenStart = (i) => { ziel.current = { ...zielMitglied(i), anzeigeName: i.name, key: i.key }; datei.current?.click() }
  const hochladen = async (ev) => {
    const f = ev.target.files?.[0]; ev.target.value = ''
    const i = ziel.current; if (!f || !i) return
    setBusy(i.key)
    const row = await sichern(i)
    if (!row) { setBusy(null); return }
    const r = await rechnungHochladen(row, f, { durchAdmin: true })
    setBusy(null)
    if (r.error) { alert('Rechnung NICHT hochgeladen: ' + r.error.message); return }
    melde(`Rechnung für ${i.anzeigeName || i.name} hochgeladen. Summe und IBAN (falls in der PDF) sind vorgeschlagen — bitte prüfen.`); lade()
  }
  const gesamtVon = (i) => {
    if (i.gruppe) {   // v5.43.0: Summe aller Anteile + Extras
      const w = i.mitglieder.map(m => gesamtEur(anzeige(m))).filter(x => x != null)
      return { wert: w.length ? Math.round(w.reduce((t, x) => t + x, 0) * 100) / 100 : null, waehrung: 'EUR' }
    }
    return istManuell(i.row) ? gesamt(i.row) : { wert: gesamtEur(anzeige(i)), waehrung: 'EUR' }
  }
  const bezahltOeffnen = (i) => {
    const soll = i.row?.rechnung_betrag ?? gesamtVon(i).wert
    const rest = soll != null ? Math.round((Number(soll) - anzahlungSumme(i.row)) * 100) / 100 : null
    setBezahlt({ i, am: heuteIso(), betrag: rest != null ? String(rest).replace('.', ',') : '' })
  }
  // ── Anzahlung ────────────────────────────────────────────────────────────
  const anzOeffnen = (i) => setAnz({ i, liste: i.gruppe ? i.mitglieder.flatMap(m => anzahlungenVon(m.row).map(e => ({ ...e, _m: m.name }))) : anzahlungenVon(i.row), betrag: '', am: heuteIso(), notiz: '' })
  const anzSpeichern = async (liste) => {
    const { i } = anz
    if (i.gruppe) {   // v5.43.0: jede Anzahlung bleibt bei ihrem Mitglied, neue beim Rechnungs-Mitglied
      const haupt = zielMitglied(i)
      setBusy(i.key)
      for (const m of i.mitglieder) {
        const eigene = liste.filter(e => (e._m || haupt.name) === m.name).map(({ _m, ...e }) => e) // eslint-disable-line no-unused-vars
        if (!eigene.length && !anzahlungenVon(m.row).length) continue
        const row = await sichern(m)
        if (!row) { setBusy(null); return }
        const { error } = await anzahlungenSpeichern(row, eigene, userDisplayName)
        if (error) { setBusy(null); alert('Nicht gespeichert: ' + error.message); return }
      }
      setBusy(null); setAnz(null); melde(`${i.name}: Anzahlung gespeichert (nur intern).`); lade(); return
    }
    setBusy(i.key)
    const row = await sichern(i)
    if (!row) { setBusy(null); return }
    const { error } = await anzahlungenSpeichern(row, liste, userDisplayName)
    setBusy(null)
    if (error) { alert('Nicht gespeichert: ' + (fehltTabelle(error) ? 'Datenbank fehlt noch (sql/buchhaltung-anzahlung.sql ausführen).' : error.message)); return }
    setAnz(null); melde(`${i.name}: Anzahlung gespeichert (nur intern).`); lade()
  }
  const anzHinzu = () => {
    const b = zahlAus(anz.betrag)
    if (b == null || b === 0) { alert('Bitte einen Betrag eintragen, z. B. 300.'); return }
    anzSpeichern([...anz.liste, { betrag: b, am: anz.am, notiz: anz.notiz, von: userDisplayName }])
  }
  // v5.45.0: als eigene Funktion (auch für „Nach Wise-Zahlung als bezahlt eintragen“).
  // Gibt null zurück oder einen Fehlertext.
  const bezahltEintragen = async (i, am, betrag) => {
    if (i.gruppe) {   // v5.43.0: alle Mitglieder bezahlt; Betrag anteilig nach ihrem Gesamt verteilt
      const b = typeof betrag === 'number' ? betrag : zahlAus(betrag)
      const teile = i.mitglieder.map(m => gesamtEur(anzeige(m)) || 0)
      const summe = teile.reduce((t, x) => t + x, 0)
      let rest = b
      for (let n = 0; n < i.mitglieder.length; n++) {
        const m = i.mitglieder[n]
        const row = await sichern(m)
        if (!row) return `${m.name}: Zeile nicht angelegt`
        if (m.live) await zahlenAktualisieren({ ...m, row })
        let anteil = null
        if (b != null) {
          anteil = n === i.mitglieder.length - 1 ? rest : Math.round((summe ? b * teile[n] / summe : b / i.mitglieder.length) * 100) / 100
          rest = Math.round((rest - anteil) * 100) / 100
        }
        const r = await alsBezahlt({ ...anzeige(m), ...row }, { am, betrag: anteil, gruppe: i.name })
        if (r.error) return `${m.name}: ` + (/gruppe/.test(r.error.message || '') ? 'Datenbank fehlt noch (sql/buchhaltung-gruppen.sql ausführen).' : r.error.message)
      }
      return null
    }
    const row = await sichern(i)
    if (!row) return `${i.name}: Zeile nicht angelegt`
    // Zahlen in dem Moment festhalten (für Export & spätere Nachfragen)
    if (i.live && !istManuell(row)) await zahlenAktualisieren({ ...i, row })
    const r = await alsBezahlt({ ...anzeige(i), ...row }, { am, betrag })
    return r.error ? `${i.name}: ${r.error.message}` : null
  }
  const bezahltSpeichern = async () => {
    const { i, am, betrag } = bezahlt
    setBusy(i.key)
    const f = await bezahltEintragen(i, am, betrag)
    setBusy(null)
    if (f) { alert('Nicht gespeichert: ' + f); lade(); return }
    setBezahlt(null); melde(`${i.name}: bezahlt am ${datum(am)} (nur intern gespeichert).`); lade()
  }
  const zurueck = async (i) => {
    if (!confirm(`„Bezahlt“ bei ${i.name} wieder entfernen?`)) return
    if (i.gruppe) {
      for (const m of i.mitglieder.filter(m => m.row?.status === 'bezahlt')) {
        const { error } = await bezahltZurueck(m.row)
        if (error) { alert(error.message); break }
      }
      lade(); return
    }
    const { error } = await bezahltZurueck(i.row)
    if (error) { alert(error.message); return }
    lade()
  }
  const klaerSenden = async () => {
    const { i, notiz } = klaer
    if (!notiz.trim()) return
    if (i.gruppe) {   // v5.43.0: Rückfrage an alle Mitglieder
      setBusy(i.key)
      const infos = []
      for (const m of i.mitglieder) {
        const row = await sichern(m)
        if (!row) { setBusy(null); return }
        const r = await klaerung({ ...anzeige(m), ...row }, notiz)
        if (r.error) { setBusy(null); alert('Nicht gespeichert: ' + r.error.message); return }
        if (r.info) infos.push(`${m.name}: ${r.info}`)
      }
      setBusy(null); setKlaer(null); melde(`${i.name}: Rückfrage gespeichert${infos.length ? ' · ' + infos.join(' · ') : ''}`); lade(); return
    }
    setBusy(i.key)
    const r = await klaerung({ ...anzeige(i), ...i.row }, notiz)
    setBusy(null)
    if (r.error) { alert('Nicht gespeichert: ' + r.error.message); return }
    setKlaer(null); melde(`${i.name}: Rückfrage gespeichert${r.info ? ' · ' + r.info : ''}`); lade()
  }
  const erinnereAlle = async (liste) => {
    if (!liste.length) return
    if (!confirm(liste.length === 1 ? `${liste[0].name} per Telegram an die Rechnung erinnern?` : `${liste.length} Chatter per Telegram an die Rechnung erinnern?`)) return
    setBusy('erinnern')
    const r = await erinnern(liste.flatMap(i => i.gruppe ? i.mitglieder.map(m => ({ ...anzeige(m), gruppe_name: i.name, gruppe_gesamt: gesamtVon(i).wert })) : [anzeige(i)]))
    setBusy(null)
    melde(`${r.gesendet} erinnert${r.ohne ? ` · ${r.ohne} ohne Telegram-ID` : ''}`); lade()
  }
  const extrasSpeichernKlick = async () => {
    const { i, liste } = extras
    const sauber = liste.map(e => ({ text: e.text, betrag: zahlAus(e.betrag) })).filter(e => String(e.text || '').trim() && e.betrag != null)
    if (liste.some(e => String(e.text || '').trim() && zahlAus(e.betrag) == null)) { alert('Bitte bei jedem Extra einen Betrag eintragen (z. B. 120 oder -50).'); return }
    setBusy(i.key)
    const row = await sichern(i)
    if (!row) { setBusy(null); return }
    const { error } = await extrasSpeichern(row, sauber)
    setBusy(null)
    if (error) { alert('Nicht gespeichert: ' + (fehltTabelle(error) ? 'Datenbank fehlt noch (sql/buchhaltung-entwurf.sql).' : error.message)); return }
    setExtras(null); melde(`${i.name}: Extras gespeichert.`); lade()
  }
  // ── Team / ohne Profil ───────────────────────────────────────────────────
  const handOeffnen = (row) => {
    if (row) setHand({ row, name: row.chatter_name, art: row.art, monat: row.monat, betrag: row.betrag_manuell != null ? String(row.betrag_manuell).replace('.', ',') : '', waehrung: row.waehrung || 'EUR', notiz: row.notiz || '', iban: row.rechnung_iban || '', datei: null, erkannt: null })
    else setHand({ row: null, name: '', art: 'extern', monat: p ? p.bezug : letzteMonate(2)[1], betrag: '', waehrung: 'EUR', notiz: '', iban: '', datei: null, erkannt: null })
  }
  const handName = async (name) => {
    setHand(h => ({ ...h, name }))
    if (hand?.row) return
    const l = await letzterEintrag(name)
    if (l) setHand(h => h && h.name === name ? { ...h, art: ['team', 'extern'].includes(l.art) ? l.art : h.art, waehrung: l.waehrung || h.waehrung, betrag: h.betrag || (l.betrag_manuell != null ? String(l.betrag_manuell).replace('.', ',') : ''), notiz: h.notiz || '', vorschlag: true } : h)
  }
  const handDatei = async (f) => {
    setHand(h => ({ ...h, datei: f, erkannt: f ? 'liest' : null }))
    if (!f) return
    const g = await rechnungLesen(f)
    setHand(h => {
      if (!h || h.datei !== f) return h
      if (g.leer) return { ...h, erkannt: g.grund === 'foto' ? 'foto' : 'nichts' }
      return { ...h, erkannt: 'ok', betrag: g.betrag != null ? String(g.betrag).replace('.', ',') : h.betrag, waehrung: g.waehrung || h.waehrung, iban: g.iban ? ibanSchoen(g.iban) : h.iban }
    })
  }
  const handSpeichern = async () => {
    const h = hand
    if (!h.name.trim()) { alert('Bitte einen Namen eintragen.'); return }
    if (h.betrag && zahlAus(h.betrag) == null) { alert('Betrag bitte als Zahl, z. B. 66 oder 66,50.'); return }
    setBusy('hand')
    const r = await manuellSpeichern(h.row, { name: h.name, art: h.art, monat: h.monat, betrag: h.betrag, waehrung: h.waehrung, notiz: h.notiz, iban: h.iban.trim() || null, wer: userDisplayName })
    if (r.error) { setBusy(null); alert('Nicht gespeichert: ' + (fehltTabelle(r.error) ? 'Datenbank fehlt noch (sql/buchhaltung-team.sql ausführen).' : r.error.message)); return }
    if (h.datei) {
      const u = await rechnungHochladen(r.row, h.datei, { durchAdmin: true, betrag: h.betrag, iban: h.iban.trim() || null })
      if (u.error) { setBusy(null); alert('Eintrag gespeichert, aber die Datei NICHT: ' + u.error.message); setHand(null); lade(); return }
    }
    setBusy(null); setHand(null)
    melde(`${h.name.trim()} gespeichert${h.row ? '' : ` (${monatName(h.monat)})`}.`)
    if (!h.row && p && h.monat !== p.bezug && modus === 'monat') setMonat(h.monat); else lade()
  }
  const handLoeschen = async () => {
    const h = hand
    if (!h.row || !confirm(`Eintrag ${h.name} (${monatName(h.monat)}) löschen?`)) return
    const { error } = await eintragLoeschen(h.row)
    if (error) { alert(error.message); return }
    setHand(null); lade()
  }
  const kopieren = async (t) => {
    try { await navigator.clipboard.writeText(String(t).replace(/\s/g, '')); melde('IBAN kopiert.') } catch { prompt('IBAN:', t) }
  }

  // ── v5.43.0: Gruppen-Zeile (z. B. Alessia & Pascal) ─────────────────────
  const GruppenZeile = ({ i }) => {
    const r = i.row
    const stKey = r.status
    const st = STATUS[stKey]
    const G = gesamtVon(i); const g = G.wert
    const az = i.mitglieder.map(m => anzeige(m))
    const sum = (f) => az.some(a => f(a) != null) ? az.reduce((t, a) => t + Number(f(a) || 0), 0) : null
    const umsatz = sum(a => (a.nur_chat === false ? a.umsatz_gesamt_usd : a.umsatz_chat_usd))
    const anteilEur = sum(a => a.betrag_eur)
    const anteilUsd = sum(a => a.auszahlung_usd)
    const exSumme = i.mitglieder.reduce((t, m) => t + extrasVon(m.row).reduce((x, e) => x + Number(e.betrag || 0), 0), 0)
    const abw = r.rechnung_betrag != null && g != null && Math.abs(Number(r.rechnung_betrag) - g) >= 0.01
    const b = busy === i.key
    const halter = r.halter
    const ansehenAuf = () => setAnsehen({ row: halter, url: r.rechnung_url, name: r.rechnung_name, iban: r.rechnung_iban, betrag: r.rechnung_betrag, waehrung: 'EUR', gesamt: g, wer: i.name })
    return (
      <div className="bh-zeile bh-gruppe" style={{ borderLeftColor: st.farbe }}>
        <div className="bh-wer">
          <b>{i.name}</b>
          <span className="bh-gruppe-badge" title={`${i.mitglieder.map(m => m.name).join(' und ')} schreiben eine gemeinsame Rechnung`}><Users size={11} strokeWidth={2.6} /> Gemeinsame Rechnung</span>
          {modus === 'offen' && <span>{i.p?.bezeichnung}</span>}
        </div>
        <div className="bh-zahl"><span className="bh-mobil">Umsatz</span>{umsatz != null ? dollar(umsatz) : '—'}</div>
        <div className="bh-zahl"><span className="bh-mobil">Anteil</span>{anteilEur != null ? euro(anteilEur) : anteilUsd != null ? dollar(anteilUsd) : '—'}<small>{anteilEur != null && anteilUsd != null ? dollar(anteilUsd) : ''}</small></div>
        <div className="bh-extras">{exSumme !== 0 && <span className={'bh-extra' + (exSumme < 0 ? ' minus' : '')}>{exSumme < 0 ? '−' : '+'}{euro(Math.abs(exSumme))} <em>Extras</em></span>}</div>
        <div className="bh-gesamt"><span className="bh-mobil">Gesamt</span>{g != null ? euro(g) : '—'}
          {anzahlungSumme(r) !== 0 && (
            <button className="bh-anz" onClick={() => anzOeffnen(i)} title={anzahlungenVon(r).map(e => `${euro(e.betrag)}${e.am ? ' am ' + datum(e.am) : ''}${e.notiz ? ' · ' + e.notiz : ''}`).join('\n')}>
              − {euro(anzahlungSumme(r))} angezahlt
              {stKey !== 'bezahlt' && g != null && <b>Rest {euro(g - anzahlungSumme(r))}</b>}
            </button>
          )}
        </div>
        <div className="bh-rechnung">
          {r.rechnung_url ? (
            <>
              <button className="bh-link" onClick={ansehenAuf} title={`Rechnung ansehen: ${r.rechnung_name || 'Rechnung'}`}><FileText size={14} strokeWidth={2.2} /> <span className="bh-dateiname">{r.rechnung_name || 'Rechnung'}</span></button>
              <small>{r.rechnung_von ? `von ${r.rechnung_von} · ` : ''}{datumZeit(r.rechnung_am)}{r.rechnung_betrag != null && <span style={{ color: abw ? '#f59e0b' : undefined }} title={r.betrag_erkannt ? 'Aus der PDF erkannt — bitte prüfen' : undefined}> · {euro(r.rechnung_betrag)}{r.betrag_erkannt ? ' (erkannt)' : ''}{abw ? ' ≠ Gesamt' : ''}</span>}</small>
              {r.rechnung_betrag == null && <button className="bh-link warn" onClick={ansehenAuf}><Pencil size={12} strokeWidth={2.4} /> Betrag fehlt — prüfen</button>}
              {r.rechnung_nr && <small className="bh-renr">Nr. {r.rechnung_nr}</small>}
              {r.rechnung_iban && (() => { const v = ibanVergleich(r.rechnung_iban, buch.map[i.name.toLowerCase()]); return <button className={'bh-iban' + (v === 'anders' ? ' rot' : v === 'gleich' ? ' gut' : '')} onClick={() => kopieren(r.rechnung_iban)} title={v === 'anders' ? 'ACHTUNG: IBAN anders als im Adressbuch — Rechnung ansehen' : v === 'gleich' ? 'IBAN wie im Adressbuch · kopieren' : 'IBAN kopieren (noch nicht im Adressbuch)'}>{v === 'anders' ? <ShieldAlert size={12} strokeWidth={2.4} /> : <Copy size={12} strokeWidth={2.4} />} {ibanSchoen(r.rechnung_iban)}</button> })()}
            </>
          ) : <small>{`fehlt${r.erinnert_am ? ` · erinnert ${datum(r.erinnert_am)}` : ''}`}</small>}
        </div>
        <div className="bh-status">
          <span className="bh-st" style={{ color: st.farbe, background: st.bg }}>{stKey === 'bezahlt' ? `Bezahlt ${datum(r.bezahlt_am)}` : st.label}</span>
          {stKey === 'bezahlt' && <small>{r.bezahlt_betrag != null ? euro(r.bezahlt_betrag) + ' · ' : ''}{r.bezahlt_von || ''}</small>}
          {stKey === 'klaerung' && r.klaerung_notiz && <small className="bh-notiz">„{r.klaerung_notiz}“</small>}
        </div>
        <div className="bh-aktion">
          {stKey !== 'bezahlt' && <button className="bh-k bh-gruen" disabled={b} onClick={() => bezahltOeffnen(i)}><Check size={14} strokeWidth={2.6} /> Bezahlt</button>}
          {stKey !== 'bezahlt' && <button className="bh-k" disabled={b} onClick={() => anzOeffnen(i)} title="Anzahlung eintragen (schon überwiesen, bevor die Rechnung da ist)"><HandCoins size={14} strokeWidth={2.2} /></button>}
          {stKey === 'rechnung' && <button className="bh-k" disabled={b} onClick={() => setKlaer({ i, notiz: r.klaerung_notiz || '' })} title="Rückfrage an beide"><MessageCircleWarning size={14} strokeWidth={2.2} /></button>}
          {stKey === 'offen' && <button className="bh-k" disabled={busy === 'erinnern'} onClick={() => erinnereAlle([i])} title="Per Telegram erinnern (alle aus der Gruppe)"><Bell size={14} strokeWidth={2.2} /></button>}
          {stKey !== 'bezahlt' && <button className="bh-k" disabled={b} onClick={() => hochladenStart(i)} title={r.rechnung_url ? 'Andere Rechnung hochladen' : 'Gemeinsame Rechnung selbst hochladen'}><Upload size={14} strokeWidth={2.2} />{b ? '…' : ''}</button>}
          {stKey === 'bezahlt' && <button className="bh-k" onClick={() => zurueck(i)} title="Bezahlt rückgängig"><Undo2 size={14} strokeWidth={2.2} /></button>}
        </div>
        <div className="bh-gruppe-teile">
          {i.mitglieder.map(m => {
            const a = anzeige(m)
            const mBez = m.row?.status === 'bezahlt'
            return (
              <div key={m.key} className="bh-gruppe-teil">
                <span className="bh-gt-name">↳ {m.name}</span>
                <span className="bh-gt-zahl">{a.auszahlung_usd == null ? '—' : dollar(a.nur_chat === false ? a.umsatz_gesamt_usd : a.umsatz_chat_usd)}</span>
                <span className="bh-gt-zahl">{a.auszahlung_usd == null ? <em title="Keine Zahlen in Billing für diesen Namen">keine Zahlen</em> : a.betrag_eur != null ? euro(a.betrag_eur) : dollar(a.auszahlung_usd)}</span>
                <span className="bh-extras">
                  {extrasVon(m.row).map((e, n) => <span key={n} className={'bh-extra' + (Number(e.betrag) < 0 ? ' minus' : '')} title={e.text}>{Number(e.betrag) < 0 ? '−' : '+'}{euro(Math.abs(e.betrag))} <em>{e.text}</em></span>)}
                  {!mBez && <button className="bh-plus" onClick={() => setExtras({ i: m, liste: extrasVon(m.row).length ? extrasVon(m.row).map(e => ({ text: e.text, betrag: String(e.betrag).replace('.', ',') })) : [{ text: '', betrag: '' }] })}><Plus size={13} strokeWidth={2.6} /> {extrasVon(m.row).length ? 'ändern' : 'Extra'}</button>}
                </span>
                <span className="bh-gt-zahl">{gesamtEur(a) != null ? euro(gesamtEur(a)) : ''}{mBez && m.row.bezahlt_betrag != null ? <small> · bezahlt {euro(m.row.bezahlt_betrag)}</small> : null}</span>
                <span className="bh-gt-knopf"><button className="bh-k" onClick={() => abrechnungPdf(a)} title={`Abrechnung ${m.name} als PDF`}><Download size={13} strokeWidth={2.2} /></button></span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── v5.45.0: Für Wise exportieren ────────────────────────────────────────
  const restVon = (i) => {
    const soll = i.row?.rechnung_betrag ?? gesamtVon(i).wert
    return soll != null ? Math.round((Number(soll) - anzahlungSumme(i.row)) * 100) / 100 : null
  }
  const wiseOeffnen = async () => {
    const em = await empfaengerLaden()
    setBuch(em)
    const zeilen = items
      .filter(i => statusVon(i.row) !== 'bezahlt' && gesamtVon(i).waehrung === 'EUR')
      .map(i => {
        const e = em.map[i.name.toLowerCase()] || null
        const rIban = String(i.row?.rechnung_iban || '').replace(/\s/g, '').toUpperCase()
        const vgl = ibanVergleich(rIban, e)          // gleich | neu | anders | null
        // Überwiesen wird an die IBAN aus dem Adressbuch; nur ohne Eintrag die von der Rechnung
        const iban = e?.iban || rIban
        const betrag = restVon(i)
        const soll = gesamtVon(i).wert
        const betragAbw = i.row?.rechnung_betrag != null && soll != null && Math.abs(Number(i.row.rechnung_betrag) - soll) >= 0.01
        const ok = ibanGueltig(iban) && betrag > 0 && vgl !== 'anders'
        return {
          i, key: i.key, name: i.name, status: statusVon(i.row), betrag: betrag != null ? String(betrag).replace('.', ',') : '',
          kontoinhaber: e?.kontoinhaber || i.row?.rechnung_inhaber || '', typ: e?.typ || (i.gruppe ? 'INSTITUTION' : 'PRIVATE'), iban: iban ? ibanSchoen(iban) : '',
          neu: !e, vgl, rIban, betragAbw, angezahlt: anzahlungSumme(i.row),
          nr: i.row?.rechnung_nr || '', nrVorher: i.row?.rechnung_nr || '', zweck: `Rechnung ${i.p?.bezeichnung || ''}`.trim(),
          an: ok && statusVon(i.row) === 'rechnung',
        }
      })
    setWise({ zeilen, fehlt: em.fehlt, geladen: false, am: heuteIso() })
  }
  const neueIbanUebernehmen = (key) => setWise(w => ({ ...w, zeilen: w.zeilen.map(z => z.key === key ? { ...z, iban: ibanSchoen(z.rIban), vgl: 'uebernommen', an: true } : z) }))
  const wiseZeile = (key, feld, wert) => setWise(w => ({ ...w, zeilen: w.zeilen.map(z => z.key === key ? { ...z, [feld]: wert } : z) }))
  const wiseProblem = (z) => {
    const iban = z.iban.replace(/\s/g, '').toUpperCase()
    if (z.vgl === 'anders') return 'IBAN auf der Rechnung ist anders als im Adressbuch'
    if (!z.kontoinhaber.trim()) return 'Name wie auf dem Konto fehlt'
    if (!ibanGueltig(iban)) return iban ? 'IBAN ungültig' : 'IBAN fehlt'
    const b = zahlAus(z.betrag)
    if (!(b > 0)) return 'Betrag fehlt'
    return null
  }
  const wiseLaden = async () => {
    const gewaehlt = wise.zeilen.filter(z => z.an)
    const fehler = gewaehlt.map(z => [z, wiseProblem(z)]).filter(x => x[1])
    if (fehler.length) { alert('Bitte erst ergänzen:\n\n' + fehler.map(([z, f]) => `${z.name}: ${f}`).join('\n')); return }
    setBusy('wise')
    const { error } = await empfaengerSpeichern(gewaehlt.map(z => ({ name: z.name, kontoinhaber: z.kontoinhaber, typ: z.typ, iban: z.iban })), userDisplayName)
    setBusy(null)
    if (error && !/zahlungsempfaenger/.test(error.message || '')) { alert('Empfänger nicht gespeichert: ' + error.message); return }
    // eingetippte Rechnungsnummern an der Rechnung speichern
    for (const z of gewaehlt.filter(z => z.nr.trim() !== z.nrVorher && (z.i.row?.halter || z.i.row)?.id)) await rechnungNrSpeichern(z.i.row.halter || z.i.row, z.nr)
    wiseHerunterladen(gewaehlt.map(z => ({ kontoinhaber: z.kontoinhaber.trim(), typ: z.typ, iban: z.iban, betrag: zahlAus(z.betrag), zweck: z.nr.trim() || z.zweck })), heuteIso())
    setWise(w => ({ ...w, geladen: true, fehlt: w.fehlt || !!error }))
  }
  const wiseBezahlt = async () => {
    const gewaehlt = wise.zeilen.filter(z => z.an)
    if (!confirm(`Erst in Wise bezahlt?\n\nDann jetzt ${gewaehlt.length} ${gewaehlt.length === 1 ? 'Eintrag' : 'Einträge'} als bezahlt am ${datum(wise.am)} eintragen (nur intern, keine Nachricht).`)) return
    setBusy('wise')
    const fehler = []
    for (const z of gewaehlt) { const f = await bezahltEintragen(z.i, wise.am, zahlAus(z.betrag)); if (f) fehler.push(f) }
    setBusy(null)
    if (fehler.length) alert('Nicht alles gespeichert:\n' + fehler.join('\n'))
    setWise(null); melde(`${gewaehlt.length - fehler.length} als bezahlt eingetragen (${datum(wise.am)}).`); lade()
  }

  // ── v5.46.0: Adressbuch ──────────────────────────────────────────────────
  const buchOeffnen = async () => {
    const em = await empfaengerLaden()
    setBuch(em)
    const ausListe = new Map()
    for (const i of items) {
      if (istManuell(i.row) && i.row.waehrung === 'USD') continue
      const r = i.row?.halter || i.row
      ausListe.set(i.name.toLowerCase(), { name: i.name, vorschlagName: r?.rechnung_inhaber || '', vorschlagIban: r?.rechnung_iban || '' })
    }
    const namen = [...new Set([...Object.values(em.map).map(e => e.name), ...[...ausListe.values()].map(x => x.name)])].sort((a, b) => a.localeCompare(b, 'de'))
    const zeilen = namen.map(n => {
      const e = em.map[n.toLowerCase()] || null
      const v = ausListe.get(n.toLowerCase()) || {}
      const kontoinhaber = e?.kontoinhaber || v.vorschlagName || ''
      const iban = e?.iban || v.vorschlagIban || ''
      return { name: n, e, kontoinhaber, typ: e?.typ || 'PRIVATE', iban: iban ? ibanSchoen(iban) : '', vorschlag: !e && !!(v.vorschlagName || v.vorschlagIban), geaendert: false }
    })
    setBuchFenster({ zeilen, filter: '', fehlt: em.fehlt })
  }
  const buchZeile = (name, feld, wert) => setBuchFenster(b => ({ ...b, zeilen: b.zeilen.map(z => z.name === name ? { ...z, [feld]: wert, geaendert: true } : z) }))
  const buchSpeichern = async () => {
    const zu = buchFenster.zeilen.filter(z => (z.geaendert || (z.vorschlag && z.uebernehmen)) && (z.kontoinhaber.trim() || z.iban.trim()))
    const falsch = zu.filter(z => z.iban.trim() && !ibanGueltig(z.iban.replace(/\s/g, '').toUpperCase()))
    if (falsch.length) { alert('IBAN ungültig bei: ' + falsch.map(z => z.name).join(', ')); return }
    const ibanNeu = zu.filter(z => z.e?.iban && z.e.iban !== z.iban.replace(/\s/g, '').toUpperCase())
    if (ibanNeu.length && !confirm(`IBAN geändert bei: ${ibanNeu.map(z => z.name).join(', ')}.\n\nWirklich speichern? Geänderte Bankdaten am besten kurz nachfragen.`)) return
    setBusy('buch')
    const { error } = await empfaengerSpeichern(zu, userDisplayName)
    setBusy(null)
    if (error) { alert('Nicht gespeichert: ' + (/zahlungsempfaenger/.test(error.message || '') ? 'Datenbank fehlt noch (sql/zahlungsempfaenger.sql + sql/adressbuch.sql).' : error.message)); return }
    setBuchFenster(null); setBuch(await empfaengerLaden()); melde(`Adressbuch: ${zu.length} ${zu.length === 1 ? 'Eintrag' : 'Einträge'} gespeichert.`)
  }
  const buchLoeschen = async (z) => {
    if (!z.e || !confirm(`${z.name} aus dem Adressbuch löschen?`)) return
    const { error } = await empfaengerLoeschen(z.e.name)
    if (error) { alert(error.message); return }
    setBuchFenster(b => ({ ...b, zeilen: b.zeilen.map(x => x.name === z.name ? { ...x, e: null, kontoinhaber: '', iban: '', geaendert: false } : x) }))
    setBuch(await empfaengerLaden())
  }

  // ── v5.44.0: Fenster „Rhythmus“ ──────────────────────────────────────────
  const rhOeffnen = async () => {
    const { data } = await supabase.from('chatters_contact').select('name, active').order('name')
    const w = rh.woechentlich.map(x => x.chatter_name)
    const alle = [...new Set([...(data || []).filter(c => c.active !== false).map(c => c.name), ...w])].sort((a, b) => a.localeCompare(b, 'de'))
    setRhFenster({ alle, woche: new Set(w), start: rh.start ?? 0, filter: '' })
  }
  const rhSpeichern = async () => {
    setBusy('rh')
    const { error } = await rhythmusSpeichern([...rhFenster.woche], rhFenster.start, userDisplayName, rh.liste)
    setBusy(null)
    if (error) { alert('Nicht gespeichert: ' + (/abrechnung_rhythmus/.test(error.message || '') ? 'Datenbank fehlt noch (sql/buchhaltung-rhythmus.sql ausführen).' : error.message)); return }
    const n = rhFenster.woche.size
    setRhFenster(null)
    const r = await rhythmusLaden(); setRh(r)
    if (woche) setWoche(wocheStartVon(woche, r.start))
    melde(n ? `Gespeichert: ${n} ${n === 1 ? 'Chatter wird' : 'Chatter werden'} wöchentlich abgerechnet (${WOCHENTAG[r.start]}–${WOCHENTAG[(r.start + 6) % 7]}).` : 'Gespeichert: alle monatlich.')
    lade()
  }

  // ── v5.43.0: Fenster „Zusammenlegen“ ─────────────────────────────────────
  const grpOeffnen = async () => {
    const { data } = await supabase.from('chatters_contact').select('name, active').order('name')
    const alle = [...new Set([...(data || []).filter(c => c.active !== false).map(c => c.name), ...items.filter(i => !i.manuell && !i.gruppe).map(i => i.name)])].sort((a, b) => a.localeCompare(b, 'de'))
    setGrp({ name: '', mitglieder: [], alle, filter: '' })
  }
  const grpSpeichern = async () => {
    setBusy('grp')
    const r = await gruppeAnlegen({ name: grp.name || grp.mitglieder.join(' & '), mitglieder: grp.mitglieder, wer: userDisplayName })
    setBusy(null)
    if (r.error) { alert('Nicht gespeichert: ' + (fehltTabelle(r.error) || /abrechnung_gruppen/.test(r.error.message || '') ? 'Datenbank fehlt noch (sql/buchhaltung-gruppen.sql ausführen).' : r.error.message)); return }
    melde(`${grp.name || grp.mitglieder.join(' & ')}: zusammengelegt.`); setGrp(null); lade()
  }
  const grpAufloesen = async (g) => {
    if (!confirm(`„${g.name}“ auflösen?\n\nAb dann stehen ${g.mitglieder.join(' und ')} wieder einzeln in der Buchhaltung. Schon bezahlte Monate bleiben zusammen.`)) return
    const { error } = await gruppeAufloesen(g, userDisplayName)
    if (error) { alert(error.message); return }
    melde(`${g.name}: aufgelöst.`); lade()
  }

  // ── Ansicht ──────────────────────────────────────────────────────────────
  const voll = daten && daten.tageSoll && daten.tage >= daten.tageSoll
  const zeitraumZukunft = p && p.ende >= heuteIso()

  return (
    <div className="bh">
      <input ref={datei} type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={hochladen} />

      <div className="bh-kopf">
        <div className="bh-titel"><span className="bh-titel-ic"><Receipt size={18} strokeWidth={2.4} /></span><b>Buchhaltung</b></div>
        <div className="bh-umschalter">
          <button className={modus === 'monat' ? 'an' : ''} onClick={() => setModus('monat')}>Monat</button>
          <button className={modus === 'woche' ? 'an' : ''} onClick={() => setModus('woche')} title="Chatter, die wöchentlich bezahlt werden">Woche</button>
          <button className={modus === 'frei' ? 'an' : ''} onClick={() => setModus('frei')}>Zeitraum</button>
          <button className={modus === 'offen' ? 'an' : ''} onClick={() => setModus('offen')}>Alles Offene</button>
        </div>
        {modus === 'monat' && (
          <select className="bh-sel" value={monat} onChange={e => setMonat(e.target.value)}>
            {letzteMonate(12).map(m => <option key={m} value={m}>{monatName(m)}</option>)}
          </select>
        )}
        {modus === 'woche' && woche && (
          <div className="bh-woche">
            <button onClick={() => setWoche(plusTage(woche, -7))} title="Woche davor"><ChevronLeft size={16} strokeWidth={2.4} /></button>
            <span>{wocheText(woche)}</span>
            <button onClick={() => setWoche(plusTage(woche, 7))} title="Woche danach"><ChevronRight size={16} strokeWidth={2.4} /></button>
          </div>
        )}
        {modus === 'frei' && (
          <div className="bh-datum"><input type="date" value={von} onChange={e => setVon(e.target.value)} /><span>bis</span><input type="date" value={bis} onChange={e => setBis(e.target.value)} /></div>
        )}
        <label className="bh-suche"><Search size={14} strokeWidth={2.4} /><input value={suche} placeholder="Name suchen" onChange={e => setSuche(e.target.value)} />{suche && <button onClick={() => setSuche('')} title="Leeren"><X size={13} /></button>}</label>
        <div className="bh-kopf-rechts">
          <button className="bh-k" onClick={buchOeffnen} title="Bankdaten je Person: Name/Firma, Privat/Firma, IBAN — dahin wird überwiesen"><BookUser size={14} strokeWidth={2.4} /> Adressbuch</button>
          {items.length > 0 && modus !== 'frei' && <button className="bh-k" onClick={wiseOeffnen} title="Datei für Wise-Sammelüberweisungen (Zahlungen → Sammelüberweisungen)"><Landmark size={14} strokeWidth={2.4} /> Für Wise</button>}
          <button className="bh-k" onClick={rhOeffnen} title="Wer wird wöchentlich statt monatlich bezahlt?"><Repeat size={14} strokeWidth={2.4} /> Rhythmus{rh.woechentlich.length ? ` (${rh.woechentlich.length} wöchentlich)` : ''}</button>
          <button className="bh-k" onClick={grpOeffnen} title="Mehrere Chatter mit EINER gemeinsamen Rechnung (z. B. Paar mit Firma)"><Link2 size={14} strokeWidth={2.4} /> Zusammenlegen{gruppen.liste.length ? ` (${gruppen.liste.length})` : ''}</button>
          <button className="bh-k" onClick={() => handOeffnen(null)} title="Team (z. B. Alina) oder Rechnung ohne Profil (z. B. ehemalige Chatter)"><UserPlus size={14} strokeWidth={2.4} /> Team / ohne Profil</button>
          <button className="bh-k" onClick={() => { const m = p ? p.bezug : letzteMonate(2)[1]; setExp({ ab: m, bis: m, nurBezahlt: false, laeuft: false, text: '' }) }} title="Rechnungen und Übersicht für eure Buchhaltung herunterladen"><FolderDown size={14} strokeWidth={2.4} /> Export</button>
          {fehlen.length > 0 && <button className="bh-k" disabled={busy === 'erinnern'} onClick={() => erinnereAlle(fehlen)}><Bell size={14} strokeWidth={2.4} /> Erinnern ({fehlen.length})</button>}
        </div>
      </div>

      {daten && modus !== 'offen' && p && !daten.fehler && (
        <div className="bh-info">
          <span className={voll ? 'gut' : 'warn'}>{voll ? <CircleCheck size={14} strokeWidth={2.4} /> : <TriangleAlert size={14} strokeWidth={2.4} />} Daten {daten.tage} von {daten.tageSoll} Tagen{!voll && daten.letzterTag ? ` · bis ${datum(daten.letzterTag)}` : ''}{zeitraumZukunft ? ' · Zeitraum läuft noch' : ''}</span>
          <span className={daten.kurs ? '' : 'warn'}>{daten.kurs ? `Kurs 1 $ = ${String(daten.kurs).replace('.', ',')} €` : `Kein Euro-Kurs für ${monatName(p.bezug)} — in Billing eintragen`}</span>
          {modus === 'woche' ? <span>Wöchentlich: {rh.woechentlich.map(x => x.chatter_name).join(', ')}</span> : <span>{p.bezeichnung} · {datum(p.ab)}–{datum(p.ende)}</span>}
        </div>
      )}
      {modus === 'frei' && !p && <div className="bh-leer">Von und bis wählen, z. B. Samstag bis Freitag.</div>}
      {daten?.fehler && <div className="bh-warn">{daten.fehler}</div>}
      {liestNach > 0 && <div className="bh-info"><span><Sparkles size={14} strokeWidth={2.4} /> Lese {liestNach} Rechnung{liestNach === 1 ? '' : 'en'} ohne Betrag …</span></div>}
      {meldung && <div className="bh-ok"><Check size={15} strokeWidth={2.6} /> {meldung}</div>}

      {daten && items.length > 0 && (
        <>
          <div className="bh-kpis">
            <Kpi farbe="#e5e7eb" wert={euro(summe(items))} sub={[summeUsd(items) ? `+ ${dollar(summeUsd(items))}` : '', anzOffen ? `${euro(anzOffen)} angezahlt` : ''].filter(Boolean).join(' · ')} label={`Gesamt · ${items.length} ${items.length === 1 ? 'Eintrag' : 'Einträge'}`} />
            <Kpi farbe={STATUS.offen.farbe} wert={statusZahl('offen')} label="Rechnung fehlt" />
            <Kpi farbe={STATUS.rechnung.farbe} wert={statusZahl('rechnung')} sub={statusZahl('klaerung') ? `${statusZahl('klaerung')} in Klärung` : ''} label="Rechnung da · zu bezahlen" />
            <Kpi farbe={STATUS.bezahlt.farbe} wert={bezahltListe.length} sub={euro(bezahltListe.filter(i => !(istManuell(i.row) && i.row.waehrung === 'USD')).reduce((t, i) => t + Number(i.row?.bezahlt_betrag ?? 0) + anzahlungSumme(i.row), 0))} label="Bezahlt" />
          </div>
          <div className="bh-chips">
            {['alle', 'offen', 'rechnung', 'klaerung', 'bezahlt'].filter(k => k === 'alle' || statusZahl(k)).map(k => (
              <button key={k} className={'bh-chip' + (filter === k ? ' an' : '')} onClick={() => setFilter(k)}>{k === 'alle' ? `Alle ${items.length}` : `${STATUS[k].label} · ${statusZahl(k)}`}</button>
            ))}
          </div>
        </>
      )}

      {!daten && <div className="bh-leer">Rechnet …</div>}
      {daten && !daten.fehler && !items.length && (modus !== 'frei' || p) && (
        <div className="bh-leer">{modus === 'offen' ? 'Nichts offen — alles bezahlt.' : daten.ohneWoechentliche ? <>Noch niemand wird wöchentlich abgerechnet. Über <b>„Rhythmus“</b> oben einstellen (z. B. Etienne).</> : modus === 'woche' ? 'In dieser Woche gibt es für die wöchentlichen Chatter keine Auszahlung (keine Daten oder kein Satz in Billing).' : 'Für diesen Zeitraum gibt es keine Auszahlung (keine Daten oder kein Satz in Billing).'}</div>
      )}

      {sichtbar.length > 0 && (
        <div className="bh-tabelle">
          <div className="bh-tkopf"><span>Name</span><span>Umsatz</span><span>Anteil / Betrag</span><span>Extras</span><span>Gesamt</span><span>Rechnung</span><span>Status</span><span /></div>
          {sichtbar.map(i => {
            if (i.gruppe) return <React.Fragment key={i.key}>{GruppenZeile({ i })}</React.Fragment>
            const a = anzeige(i)
            const stKey = statusVon(i.row)
            const st = STATUS[stKey]
            const r = i.row
            const man = istManuell(r)
            const G = man ? gesamt(r) : { wert: gesamtEur(a), waehrung: 'EUR' }
            const g = G.wert
            const abw = r?.rechnung_betrag != null && g != null && Math.abs(Number(r.rechnung_betrag) - g) >= 0.01
            const b = busy === i.key
            return (
              <div key={i.name + (r?.id || '')} className="bh-zeile" style={{ borderLeftColor: st.farbe }}>
                <div className="bh-wer">
                  <b>{i.name}{man && <em className="bh-art" style={{ color: ART[r.art]?.farbe, borderColor: ART[r.art]?.farbe }}>{ART[r.art]?.label}</em>}{!man && istWoechentlich(i.name, rh) && <em className="bh-art bh-art-woche" title="Wird wöchentlich abgerechnet">wöchentlich</em>}</b>
                  {modus === 'offen' && <span>{r?.bezeichnung}</span>}
                  {man && r.notiz && <span className="bh-notiz-text" title={r.notiz}>{r.notiz}</span>}
                </div>
                {man ? <div className="bh-zahl"><span className="bh-mobil">Umsatz</span>—</div>
                  : <div className="bh-zahl"><span className="bh-mobil">Umsatz</span>{dollar(a.nur_chat === false ? a.umsatz_gesamt_usd : a.umsatz_chat_usd)}<small>{a.prozent != null ? `${String(a.prozent).replace('.', ',')} % ${a.nur_chat === false ? 'gesamt' : 'Chat'}` : ''}</small></div>}
                {man ? <div className="bh-zahl"><span className="bh-mobil">Betrag</span>{r.betrag_manuell != null ? geld(r.betrag_manuell, r.waehrung) : '—'}<small>{r.waehrung === 'USD' ? 'in Dollar' : ''}</small></div>
                  : <div className="bh-zahl"><span className="bh-mobil">Anteil</span>{a.auszahlung_usd == null ? '—' : a.betrag_eur != null ? euro(a.betrag_eur) : dollar(a.auszahlung_usd)}<small className={a.auszahlung_usd == null ? 'bh-hinweis-klein' : undefined} title={a.auszahlung_usd == null ? 'Für diesen Namen gibt es in diesem Zeitraum keine Zahlen aus Billing — Satz oder Namen (Alias) in Billing prüfen' : undefined}>{a.auszahlung_usd == null ? 'keine Zahlen in Billing' : a.betrag_eur != null ? dollar(a.auszahlung_usd) : 'Kurs fehlt'}</small></div>}
                <div className="bh-extras">
                  {extrasVon(r).map((e, n) => <span key={n} className={'bh-extra' + (Number(e.betrag) < 0 ? ' minus' : '')} title={e.text}>{Number(e.betrag) < 0 ? '−' : '+'}{geld(Math.abs(e.betrag), G.waehrung)} <em>{e.text}</em></span>)}
                  {stKey !== 'bezahlt' && <button className="bh-plus" onClick={() => setExtras({ i, liste: extrasVon(r).length ? extrasVon(r).map(e => ({ text: e.text, betrag: String(e.betrag).replace('.', ',') })) : [{ text: '', betrag: '' }] })}><Plus size={13} strokeWidth={2.6} /> {extrasVon(r).length ? 'ändern' : 'Extra'}</button>}
                </div>
                <div className="bh-gesamt"><span className="bh-mobil">Gesamt</span>{g != null ? geld(g, G.waehrung) : '—'}
                  {anzahlungSumme(r) !== 0 && (
                    <button className="bh-anz" onClick={() => anzOeffnen(i)} title={anzahlungenVon(r).map(e => `${geld(e.betrag, G.waehrung)}${e.am ? ' am ' + datum(e.am) : ''}${e.notiz ? ' · ' + e.notiz : ''}`).join('\n')}>
                      − {geld(anzahlungSumme(r), G.waehrung)} angezahlt
                      {stKey !== 'bezahlt' && g != null && <b>Rest {geld(g - anzahlungSumme(r), G.waehrung)}</b>}
                    </button>
                  )}
                </div>
                <div className="bh-rechnung">
                  {r?.rechnung_url ? (
                    <>
                      <button className="bh-link" onClick={() => setAnsehen({ row: r, url: r.rechnung_url, name: r.rechnung_name, iban: r.rechnung_iban, betrag: r.rechnung_betrag, waehrung: G.waehrung, gesamt: g, wer: i.name })} title={`Rechnung ansehen: ${r.rechnung_name || 'Rechnung'}`}><FileText size={14} strokeWidth={2.2} /> <span className="bh-dateiname">{r.rechnung_name || 'Rechnung'}</span></button>
                      <small>{r.rechnung_von && r.rechnung_von !== i.name ? `von ${r.rechnung_von} · ` : ''}{datumZeit(r.rechnung_am)}{r.rechnung_betrag != null && <span style={{ color: abw ? '#f59e0b' : undefined }} title={r.betrag_erkannt ? 'Aus der PDF erkannt — bitte prüfen' : undefined}> · {geld(r.rechnung_betrag, G.waehrung)}{r.betrag_erkannt ? ' (erkannt)' : ''}{abw ? ' ≠ Gesamt' : ''}</span>}</small>
                      {r.rechnung_betrag == null && <button className="bh-link warn" onClick={() => setAnsehen({ row: r, url: r.rechnung_url, name: r.rechnung_name, iban: r.rechnung_iban, betrag: null, waehrung: G.waehrung, gesamt: g, wer: i.name })}><Pencil size={12} strokeWidth={2.4} /> Betrag fehlt — prüfen</button>}
                      {r.rechnung_nr && <small className="bh-renr">Nr. {r.rechnung_nr}</small>}
              {r.rechnung_iban && (() => { const v = ibanVergleich(r.rechnung_iban, buch.map[i.name.toLowerCase()]); return <button className={'bh-iban' + (v === 'anders' ? ' rot' : v === 'gleich' ? ' gut' : '')} onClick={() => kopieren(r.rechnung_iban)} title={v === 'anders' ? 'ACHTUNG: IBAN anders als im Adressbuch — Rechnung ansehen' : v === 'gleich' ? 'IBAN wie im Adressbuch · kopieren' : 'IBAN kopieren (noch nicht im Adressbuch)'}>{v === 'anders' ? <ShieldAlert size={12} strokeWidth={2.4} /> : <Copy size={12} strokeWidth={2.4} />} {ibanSchoen(r.rechnung_iban)}</button> })()}
                    </>
                  ) : <small>{`fehlt${r?.erinnert_am ? ` · erinnert ${datum(r.erinnert_am)}` : ''}`}</small>}
                </div>
                <div className="bh-status">
                  <span className="bh-st" style={{ color: st.farbe, background: st.bg }}>{stKey === 'bezahlt' ? `Bezahlt ${datum(r.bezahlt_am)}` : st.label}</span>
                  {stKey === 'bezahlt' && <small>{r.bezahlt_betrag != null ? euro(r.bezahlt_betrag) + ' · ' : ''}{r.bezahlt_von || ''}</small>}
                  {stKey === 'klaerung' && r.klaerung_notiz && <small className="bh-notiz">„{r.klaerung_notiz}“</small>}
                </div>
                <div className="bh-aktion">
                  {stKey !== 'bezahlt' && <button className="bh-k bh-gruen" disabled={b} onClick={() => bezahltOeffnen(i)}><Check size={14} strokeWidth={2.6} /> Bezahlt</button>}
                  {stKey !== 'bezahlt' && <button className="bh-k" disabled={b} onClick={() => anzOeffnen(i)} title="Anzahlung eintragen (schon überwiesen, bevor die Rechnung da ist)"><HandCoins size={14} strokeWidth={2.2} /></button>}
                  {stKey === 'rechnung' && !man && <button className="bh-k" disabled={b} onClick={() => setKlaer({ i, notiz: r.klaerung_notiz || '' })} title="Rückfrage an den Chatter"><MessageCircleWarning size={14} strokeWidth={2.2} /></button>}
                  {man && <button className="bh-k" onClick={() => handOeffnen(r)} title="Bearbeiten"><Pencil size={14} strokeWidth={2.2} /></button>}
                  {stKey === 'offen' && !man && <button className="bh-k" disabled={busy === 'erinnern'} onClick={() => erinnereAlle([i])} title="Per Telegram erinnern"><Bell size={14} strokeWidth={2.2} /></button>}
                  {stKey !== 'bezahlt' && <button className="bh-k" disabled={b} onClick={() => hochladenStart(i)} title={r?.rechnung_url ? 'Andere Rechnung hochladen' : 'Rechnung selbst hochladen (per Mail bekommen, Chatter nicht mehr aktiv …)'}><Upload size={14} strokeWidth={2.2} />{b ? '…' : ''}</button>}
                  {stKey === 'bezahlt' && <button className="bh-k" onClick={() => zurueck(i)} title="Bezahlt rückgängig"><Undo2 size={14} strokeWidth={2.2} /></button>}
                  {!man && <button className="bh-k" onClick={() => abrechnungPdf(a)} title="Abrechnung als PDF"><Download size={14} strokeWidth={2.2} /></button>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {modus === 'monat' && wochenBox.length > 0 && (
        <div className="bh-wochenbox">
          <div className="bh-wochenbox-kopf"><Repeat size={15} strokeWidth={2.4} /> <b>Wöchentlich abgerechnet · {p ? monatName(p.bezug) : ''}</b></div>
          <div className="bh-fenster-text">Die Wochen, die in diesem Monat enden. Klick auf eine Woche öffnet sie im Reiter „Woche“.</div>
          {wochenBox.map(w => (
            <div key={w.name} className="bh-wochenbox-zeile">
              <div><b>{w.name}</b><small>{WOCHENTAG[rh.woechentlich.find(x => x.chatter_name === w.name)?.wochenstart ?? 0].slice(0, 2)} – {WOCHENTAG[((rh.woechentlich.find(x => x.chatter_name === w.name)?.wochenstart ?? 0) + 6) % 7].slice(0, 2)}</small></div>
              <div className="bh-wochen">
                {w.wochen.map(x => (
                  <button key={x.ab} className={'bh-wchip ' + x.status} onClick={() => { setWoche(x.ab); setModus('woche') }}>
                    <b>{x.status === 'laeuft' ? 'läuft noch' : x.status === 'bezahlt' ? '✓ bezahlt' : STATUS[x.status]?.label}</b>
                    <span>{wocheText(x.ab, false)}{x.gesamt != null && x.status !== 'laeuft' ? ` · ${euro(x.gesamt)}` : ''}</span>
                  </button>
                ))}
              </div>
              <div className="bh-wochenbox-summe"><b>{euro(w.summe)}</b><small>{euro(w.bezahlt)} bezahlt</small></div>
            </div>
          ))}
        </div>
      )}

      {buchFenster && createPortal(
        <div className="bh-ov" onClick={e => { if (e.target === e.currentTarget && busy !== 'buch') setBuchFenster(null) }}>
          <div className="bh-fenster bh-wise">
            <div className="bh-fenster-kopf"><b><BookUser size={16} strokeWidth={2.4} /> Adressbuch</b><button className="bh-x" onClick={() => setBuchFenster(null)}><X size={18} /></button></div>
            <div className="bh-fenster-text">Hierhin wird überwiesen (auch bei „Für Wise“). Steht auf einer neuen Rechnung eine andere IBAN, wird das rot markiert und nicht automatisch übernommen. Lila = Vorschlag aus der Rechnung, noch nicht gespeichert.</div>
            {buchFenster.fehlt && <div className="bh-warn">Datenbank fehlt noch: sql/zahlungsempfaenger.sql und sql/adressbuch.sql in Supabase ausführen.</div>}
            <input className="bh-grp-suche" value={buchFenster.filter} placeholder="Name suchen" onChange={e => setBuchFenster({ ...buchFenster, filter: e.target.value })} />
            <div className="bh-wise-liste">
              {buchFenster.zeilen.filter(z => !buchFenster.filter.trim() || (z.name + ' ' + z.kontoinhaber).toLowerCase().includes(buchFenster.filter.trim().toLowerCase())).map(z => (
                <div key={z.name} className={'bh-wise-zeile bh-buch-zeile an' + (z.vorschlag && !z.geaendert ? ' vorschlag' : '')}>
                  <div className="bh-wise-wer"><b>{z.name}</b>{z.e ? <small className="leise">{z.e.bestaetigt_am ? `bestätigt ${datum(z.e.bestaetigt_am)}` : z.e.geaendert_am ? `gespeichert ${datum(z.e.geaendert_am)}` : ''}</small> : <small className="lila">{z.vorschlag ? 'Vorschlag aus Rechnung' : 'noch leer'}</small>}</div>
                  <input className="bh-wise-name" value={z.kontoinhaber} placeholder="Name / Firma wie auf dem Konto" onChange={e => buchZeile(z.name, 'kontoinhaber', e.target.value)} />
                  <div className="bh-umschalter bh-wise-typ">
                    <button className={z.typ === 'PRIVATE' ? 'an' : ''} onClick={() => buchZeile(z.name, 'typ', 'PRIVATE')}>Privat</button>
                    <button className={z.typ === 'INSTITUTION' ? 'an' : ''} onClick={() => buchZeile(z.name, 'typ', 'INSTITUTION')}>Firma</button>
                  </div>
                  <input className="bh-wise-iban" value={z.iban} placeholder="IBAN" onChange={e => buchZeile(z.name, 'iban', e.target.value)} />
                  <div className="bh-wise-betrag bh-buch-aktion">
                    {z.vorschlag && !z.geaendert && <button className="bh-k" title="Vorschlag übernehmen" onClick={() => buchZeile(z.name, 'kontoinhaber', z.kontoinhaber)}><Check size={13} strokeWidth={2.6} /></button>}
                    {z.e && <button className="bh-x" title="Aus dem Adressbuch löschen" onClick={() => buchLoeschen(z)}><Trash2 size={14} /></button>}
                  </div>
                  {z.iban.trim() && !ibanGueltig(z.iban.replace(/\s/g, '').toUpperCase()) && <small className="warn">IBAN ungültig</small>}
                </div>
              ))}
            </div>
            <div className="bh-fenster-fuss"><button className="bh-k" onClick={() => setBuchFenster(null)}>Abbrechen</button><button className="bh-k bh-p" disabled={busy === 'buch' || !buchFenster.zeilen.some(z => z.geaendert)} onClick={buchSpeichern}><Check size={14} strokeWidth={2.6} /> Speichern</button></div>
          </div>
        </div>, document.body)}

      {wise && createPortal(
        <div className="bh-ov" onClick={e => { if (e.target === e.currentTarget && busy !== 'wise') setWise(null) }}>
          <div className="bh-fenster bh-wise">
            <div className="bh-fenster-kopf"><b><Landmark size={16} strokeWidth={2.4} /> Für Wise exportieren</b><button className="bh-x" onClick={() => setWise(null)}><X size={18} /></button></div>
            <div className="bh-fenster-text">Datei für Wise → Zahlungen → <b>Sammelüberweisungen</b> (EUR an Bankkonten). Wise bezahlt nichts von selbst: hochladen, prüfen, dort bezahlen. Betrag = Rechnung bzw. Gesamt minus Anzahlungen.</div>
            {wise.fehlt && <div className="bh-warn">Namen/IBANs werden noch nicht gemerkt: sql/zahlungsempfaenger.sql in Supabase ausführen. Die Datei funktioniert trotzdem.</div>}
            {!wise.zeilen.length && <div className="bh-leer">Hier ist nichts offen in Euro.</div>}
            <div className="bh-wise-liste">
              {wise.zeilen.map(z => {
                const prob = wiseProblem(z)
                return (
                  <div key={z.key} className={'bh-wise-zeile' + (z.an ? ' an' : '')}>
                    <div className="bh-wise-wer">
                      <label><input type="checkbox" checked={z.an} onChange={e => wiseZeile(z.key, 'an', e.target.checked)} /> <b>{z.name}</b></label>
                      <span className="bh-st" style={{ color: STATUS[z.status]?.farbe, background: STATUS[z.status]?.bg }}>{STATUS[z.status]?.label}</span>
                      {z.i.row?.rechnung_url && (
                        <button className="bh-link bh-wise-rechnung" title="Rechnung ansehen (z. B. Namen kopieren)" onClick={() => {
                          const r = z.i.row.halter || z.i.row
                          setAnsehen({ row: r, url: r.rechnung_url, name: r.rechnung_name, iban: r.rechnung_iban, betrag: r.rechnung_betrag, waehrung: 'EUR', gesamt: gesamtVon(z.i).wert, wer: z.name, buchName: z.name })
                        }}><FileText size={13} strokeWidth={2.2} /> <span className="bh-dateiname">{z.i.row.rechnung_name || 'Rechnung'}</span></button>
                      )}
                    </div>
                    <input className="bh-wise-name" value={z.kontoinhaber} placeholder="Vor- und Nachname wie auf dem Konto" onChange={e => wiseZeile(z.key, 'kontoinhaber', e.target.value)} />
                    <div className="bh-umschalter bh-wise-typ">
                      <button className={z.typ === 'PRIVATE' ? 'an' : ''} onClick={() => wiseZeile(z.key, 'typ', 'PRIVATE')}>Privat</button>
                      <button className={z.typ === 'INSTITUTION' ? 'an' : ''} onClick={() => wiseZeile(z.key, 'typ', 'INSTITUTION')}>Firma</button>
                    </div>
                    <input className="bh-wise-iban" value={z.iban} placeholder="IBAN" title={z.neu ? 'aus der Rechnung — wird ins Adressbuch übernommen' : 'aus dem Adressbuch'} onChange={e => wiseZeile(z.key, 'iban', e.target.value)} />
                    <input className="bh-wise-betrag" inputMode="decimal" value={z.betrag} onChange={e => wiseZeile(z.key, 'betrag', e.target.value)} />
                    <label className="bh-wise-nr"><span>Betreff</span><input value={z.nr} placeholder={`fehlt → „${z.zweck}“`} onChange={e => wiseZeile(z.key, 'nr', e.target.value)} /></label>
                    <div className="bh-wise-checks">
                      {z.i.row?.rechnung_url ? (z.nr.trim() ? <span className="gut">✓ Rechnungsnr.</span> : <span className="warn">Rechnungsnr. fehlt</span>) : <span className="leise">keine Rechnung</span>}
                      {z.i.row?.rechnung_betrag != null && (z.betragAbw ? <span className="warn">⚠ Betrag weicht ab</span> : <span className="gut">✓ Betrag passt</span>)}
                      {z.angezahlt ? <span className="warn">{euro(z.angezahlt)} angezahlt → Rest</span> : null}
                      {z.vgl === 'gleich' && <span className="gut">✓ IBAN wie Adressbuch</span>}
                      {z.vgl === 'neu' && <span className="lila">neu – kommt ins Adressbuch</span>}
                      {z.vgl === 'uebernommen' && <span className="lila">neue IBAN übernommen</span>}
                      {z.vgl === null && z.neu && <span className="warn">IBAN fehlt auf der Rechnung</span>}
                      {z.vgl === null && !z.neu && <span className="leise">IBAN aus dem Adressbuch</span>}
                      {prob && z.an && z.vgl !== 'anders' && <span className="warn">⚠ {prob}</span>}
                    </div>
                    {z.vgl === 'anders' && (
                      <div className="bh-wise-alarm">
                        <span><ShieldAlert size={14} strokeWidth={2.4} /> IBAN auf der Rechnung (<b>{ibanSchoen(z.rIban)}</b>) ist <b>anders</b> als im Adressbuch. Erst klären — geänderte Bankdaten kurz beim Chatter nachfragen.</span>
                        <button className="bh-k" onClick={() => { if (confirm(`${z.name}: neue IBAN ${ibanSchoen(z.rIban)} übernehmen?\n\nBeim Herunterladen wird sie auch ins Adressbuch geschrieben.`)) neueIbanUebernehmen(z.key) }}>Neue IBAN übernehmen</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {(() => {
              const g = wise.zeilen.filter(z => z.an)
              return <div className="bh-fenster-text"><b style={{ color: 'var(--text-primary)' }}>{g.length} Überweisung{g.length === 1 ? '' : 'en'} · {euro(g.reduce((t, z) => t + (zahlAus(z.betrag) || 0), 0))}</b>{g.some(z => z.neu) ? ' · Neue Einträge (lila) werden beim Herunterladen ins Adressbuch übernommen' : ''}</div>
            })()}
            {wise.geladen && (
              <div className="bh-ok"><Check size={15} strokeWidth={2.6} /> Datei heruntergeladen. In Wise: Zahlungen → Sammelüberweisungen → Datei hochladen → prüfen → bezahlen. Danach hier eintragen:</div>
            )}
            <div className="bh-fenster-fuss">
              <button className="bh-k" onClick={() => setWise(null)}>Schließen</button>
              {wise.geladen && <label className="bh-feld bh-wise-am"><span>bezahlt am</span><input type="date" value={wise.am} onChange={e => setWise({ ...wise, am: e.target.value })} /></label>}
              {wise.geladen && <button className="bh-k bh-gruen" disabled={busy === 'wise'} onClick={wiseBezahlt}><Check size={14} strokeWidth={2.6} /> Als bezahlt eintragen</button>}
              <button className="bh-k bh-p" disabled={busy === 'wise' || !wise.zeilen.some(z => z.an)} onClick={wiseLaden}><Download size={14} strokeWidth={2.4} /> {wise.geladen ? 'Nochmal herunterladen' : 'Datei für Wise'}</button>
            </div>
          </div>
        </div>, document.body)}

      {rhFenster && createPortal(
        <div className="bh-ov" onClick={e => { if (e.target === e.currentTarget && busy !== 'rh') setRhFenster(null) }}>
          <div className="bh-fenster">
            <div className="bh-fenster-kopf"><b>Abrechnungs-Rhythmus</b><button className="bh-x" onClick={() => setRhFenster(null)}><X size={18} /></button></div>
            <div className="bh-fenster-text">Wer wird nicht monatlich, sondern jede Woche bezahlt? Gilt ab sofort; schon Bezahltes bleibt, wie es ist.</div>
            {rh.fehlt && <div className="bh-warn">Datenbank fehlt noch: sql/buchhaltung-rhythmus.sql in Supabase ausführen.</div>}
            <input className="bh-grp-suche" value={rhFenster.filter} placeholder="Name suchen" onChange={e => setRhFenster({ ...rhFenster, filter: e.target.value })} />
            <div className="bh-rh-liste">
              {rhFenster.alle.filter(n => rhFenster.woche.has(n) || !rhFenster.filter.trim() || n.toLowerCase().includes(rhFenster.filter.trim().toLowerCase())).map(n => {
                const w = rhFenster.woche.has(n)
                const setze = (an) => { const x = new Set(rhFenster.woche); if (an) x.add(n); else x.delete(n); setRhFenster({ ...rhFenster, woche: x }) }
                return (
                  <div key={n} className="bh-rh-zeile">
                    <span className={w ? 'an' : ''}>{n}</span>
                    <div className="bh-umschalter">
                      <button className={!w ? 'an' : ''} onClick={() => setze(false)}>Monatlich</button>
                      <button className={w ? 'an' : ''} onClick={() => setze(true)}>Wöchentlich</button>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="bh-feld"><span>Woche beginnt am</span></div>
            <div className="bh-umschalter" style={{ alignSelf: 'flex-start' }}>
              {[0, 1, 6].map(t => <button key={t} className={rhFenster.start === t ? 'an' : ''} onClick={() => setRhFenster({ ...rhFenster, start: t })}>{WOCHENTAG[t]}</button>)}
            </div>
            <div className="bh-fenster-text">→ Woche = {WOCHENTAG[rhFenster.start]} bis {WOCHENTAG[(rhFenster.start + 6) % 7]} (7 Tage)</div>
            <div className="bh-fenster-fuss"><button className="bh-k" onClick={() => setRhFenster(null)}>Abbrechen</button><button className="bh-k bh-p" disabled={busy === 'rh'} onClick={rhSpeichern}><Check size={14} strokeWidth={2.6} /> Speichern</button></div>
          </div>
        </div>, document.body)}

      {bezahlt && createPortal(
        <div className="bh-ov" onClick={e => { if (e.target === e.currentTarget) setBezahlt(null) }}>
          <div className="bh-fenster">
            <div className="bh-fenster-kopf"><b>Bezahlt · {bezahlt.i.name}</b><button className="bh-x" onClick={() => setBezahlt(null)}><X size={18} /></button></div>
            <div className="bh-fenster-text">{bezahlt.i.p?.bezeichnung} · Gesamt {geld(gesamtVon(bezahlt.i).wert, gesamtVon(bezahlt.i).waehrung)}{bezahlt.i.row?.rechnung_betrag != null ? ` · Rechnung ${geld(bezahlt.i.row.rechnung_betrag, gesamtVon(bezahlt.i).waehrung)}` : ''}{anzahlungSumme(bezahlt.i.row) ? ` · schon angezahlt ${geld(anzahlungSumme(bezahlt.i.row), gesamtVon(bezahlt.i).waehrung)} → Betrag ist der Rest` : ''}</div>
            <label className="bh-feld"><span>Überwiesen am</span><input type="date" value={bezahlt.am} onChange={e => setBezahlt({ ...bezahlt, am: e.target.value })} /></label>
            <label className="bh-feld"><span>Betrag ({istManuell(bezahlt.i.row) && bezahlt.i.row.waehrung === 'USD' ? '$' : '€'})</span><input inputMode="decimal" value={bezahlt.betrag} onChange={e => setBezahlt({ ...bezahlt, betrag: e.target.value })} /></label>
            <div className="bh-fenster-text">Nur für euch intern — der Chatter bekommt keine Nachricht.</div>
            <div className="bh-fenster-fuss"><button className="bh-k" onClick={() => setBezahlt(null)}>Abbrechen</button><button className="bh-k bh-gruen" disabled={busy === bezahlt.i.key || !bezahlt.am} onClick={bezahltSpeichern}><Check size={14} strokeWidth={2.6} /> Speichern</button></div>
          </div>
        </div>, document.body)}

      {klaer && createPortal(
        <div className="bh-ov" onClick={e => { if (e.target === e.currentTarget) setKlaer(null) }}>
          <div className="bh-fenster">
            <div className="bh-fenster-kopf"><b>Rückfrage an {klaer.i.name}</b><button className="bh-x" onClick={() => setKlaer(null)}><X size={18} /></button></div>
            <div className="bh-fenster-text">Geht per Telegram raus und steht bei ihm im Portal. Er kann danach eine neue Rechnung hochladen.</div>
            <textarea className="bh-text" rows={3} autoFocus placeholder="z. B. Bitte Steuernummer ergänzen" value={klaer.notiz} onChange={e => setKlaer({ ...klaer, notiz: e.target.value })} />
            <div className="bh-fenster-fuss"><button className="bh-k" onClick={() => setKlaer(null)}>Abbrechen</button><button className="bh-k bh-p" disabled={busy === klaer.i.key || !klaer.notiz.trim()} onClick={klaerSenden}><Send size={14} strokeWidth={2.4} /> Senden</button></div>
          </div>
        </div>, document.body)}

      {hand && createPortal(
        <div className="bh-ov" onClick={e => { if (e.target === e.currentTarget && busy !== 'hand') setHand(null) }}>
          <div className="bh-fenster">
            <div className="bh-fenster-kopf"><b>{hand.row ? 'Eintrag bearbeiten' : 'Team / ohne Profil'}</b><button className="bh-x" onClick={() => setHand(null)}><X size={18} /></button></div>
            <div className="bh-fenster-text">Für alle, die nicht über die Chatter-Zahlen laufen: Team (z. B. Alina) oder Rechnungen von Leuten ohne Profil (z. B. ehemalige Chatter).</div>
            <label className="bh-feld"><span>Name</span><input list="bh-namen" value={hand.name} autoFocus={!hand.row} placeholder="z. B. Joel" onChange={e => handName(e.target.value)} /></label>
            <datalist id="bh-namen">{namen.map(n => <option key={n} value={n} />)}</datalist>
            <div className="bh-umschalter bh-voll">
              <button className={hand.art === 'team' ? 'an' : ''} onClick={() => setHand({ ...hand, art: 'team' })}>Team</button>
              <button className={hand.art === 'extern' ? 'an' : ''} onClick={() => setHand({ ...hand, art: 'extern' })}>Ohne Profil / ehemalig</button>
            </div>
            {!hand.row && <label className="bh-feld"><span>Monat</span><select className="bh-sel" value={hand.monat} onChange={e => setHand({ ...hand, monat: e.target.value })}>{letzteMonate(18).map(m => <option key={m} value={m}>{monatName(m)}</option>)}</select></label>}
            <div className="bh-betrag-zeile">
              <label className="bh-feld"><span>Betrag</span><input inputMode="decimal" value={hand.betrag} placeholder="z. B. 66" onChange={e => setHand({ ...hand, betrag: e.target.value })} /></label>
              <div className="bh-umschalter">
                <button className={hand.waehrung === 'EUR' ? 'an' : ''} onClick={() => setHand({ ...hand, waehrung: 'EUR' })}>€</button>
                <button className={hand.waehrung === 'USD' ? 'an' : ''} onClick={() => setHand({ ...hand, waehrung: 'USD' })}>$</button>
              </div>
            </div>
            {hand.vorschlag && !hand.row && <div className="bh-fenster-text">Art und Währung vom letzten Eintrag übernommen.</div>}
            <label className="bh-feld"><span>Notiz</span><input value={hand.notiz} placeholder="z. B. letzte Schichten September, Rechnung per Mail" onChange={e => setHand({ ...hand, notiz: e.target.value })} /></label>
            <label className="bh-feld"><span>Rechnung (PDF oder Foto, optional)</span><input type="file" accept="application/pdf,image/*" onChange={e => handDatei(e.target.files?.[0] || null)} /></label>
            {hand.erkannt === 'liest' && <div className="bh-fenster-text">Liest die Rechnung …</div>}
            {hand.erkannt === 'ok' && <div className="bh-erkannt"><Sparkles size={14} strokeWidth={2.4} /> Aus der PDF vorgeschlagen — bitte prüfen.</div>}
            {hand.erkannt === 'foto' && <div className="bh-fenster-text">Foto: Summe bitte selbst eintragen (nur bei PDFs wird sie erkannt).</div>}
            {hand.erkannt === 'nichts' && <div className="bh-fenster-text">In der PDF wurde keine Summe gefunden — bitte selbst eintragen.</div>}
            <label className="bh-feld"><span>IBAN (optional)</span><input value={hand.iban} placeholder="DE…" onChange={e => setHand({ ...hand, iban: e.target.value })} /></label>
            {hand.row?.rechnung_url && !hand.datei && <div className="bh-fenster-text">Rechnung ist schon hochgeladen ({hand.row.rechnung_name}). Neue Datei wählen, um sie zu ersetzen.</div>}
            <div className="bh-fenster-fuss">
              {hand.row && hand.row.status !== 'bezahlt' && <button className="bh-k bh-leise" onClick={handLoeschen} style={{ marginRight: 'auto' }}><Trash2 size={14} /> Löschen</button>}
              <button className="bh-k" onClick={() => setHand(null)}>Abbrechen</button>
              <button className="bh-k bh-p" disabled={busy === 'hand' || hand.erkannt === 'liest'} onClick={handSpeichern}><Check size={14} strokeWidth={2.6} /> {busy === 'hand' ? 'Speichert …' : 'Speichern'}</button>
            </div>
          </div>
        </div>, document.body)}

      {grp && createPortal(
        <div className="bh-ov" onClick={e => { if (e.target === e.currentTarget && busy !== 'grp') setGrp(null) }}>
          <div className="bh-fenster">
            <div className="bh-fenster-kopf"><b>Rechnungen zusammenlegen</b><button className="bh-x" onClick={() => setGrp(null)}><X size={18} /></button></div>
            <div className="bh-fenster-text">Für Leute, die gemeinsam eine Rechnung schreiben (z. B. Paar mit Firma). Jeder wird weiter einzeln berechnet — in der Buchhaltung steht dann eine Zeile mit der Summe, einer Rechnung und einem „Bezahlt“. Gilt jeden Monat, bis ihr es auflöst.</div>
            {gruppen.fehlt && <div className="bh-warn">Datenbank fehlt noch: sql/buchhaltung-gruppen.sql in Supabase ausführen.</div>}
            <label className="bh-feld"><span>Name der Gruppe (steht in der Liste und im Export)</span><input value={grp.name} placeholder={grp.mitglieder.length ? grp.mitglieder.join(' & ') : 'z. B. Alessia & Pascal'} onChange={e => setGrp({ ...grp, name: e.target.value })} /></label>
            <div className="bh-feld"><span>Wer gehört dazu? (mindestens 2)</span></div>
            <input className="bh-grp-suche" value={grp.filter} placeholder="Name suchen" onChange={e => setGrp({ ...grp, filter: e.target.value })} />
            <div className="bh-grp-chips">
              {grp.alle.filter(n => grp.mitglieder.includes(n) || !grp.filter.trim() || n.toLowerCase().includes(grp.filter.trim().toLowerCase())).map(n => {
                const an = grp.mitglieder.includes(n)
                const schon = gruppen.liste.find(g => g.mitglieder.some(m => m.toLowerCase() === n.toLowerCase()))
                return <button key={n} className={'bh-chip' + (an ? ' an' : '')} disabled={!!schon && !an} title={schon ? `schon in „${schon.name}“` : undefined}
                  onClick={() => setGrp({ ...grp, mitglieder: an ? grp.mitglieder.filter(x => x !== n) : [...grp.mitglieder, n] })}>{an ? '✓ ' : ''}{n}</button>
              })}
            </div>
            <div className="bh-fenster-fuss"><button className="bh-k" onClick={() => setGrp(null)}>Abbrechen</button><button className="bh-k bh-p" disabled={busy === 'grp' || grp.mitglieder.length < 2} onClick={grpSpeichern}><Link2 size={14} strokeWidth={2.4} /> Zusammenlegen</button></div>
            {gruppen.liste.length > 0 && (
              <div className="bh-grp-liste">
                <div className="bh-feld"><span>Bestehende Gruppen</span></div>
                {gruppen.liste.map(g => (
                  <div key={g.id} className="bh-anz-zeile">
                    <b>{g.name}</b>
                    <span>{g.mitglieder.join(', ')} · seit {datum(g.erstellt_am)}</span>
                    <button className="bh-k" onClick={() => grpAufloesen(g)}>Auflösen</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>, document.body)}

      {ansehen && <Ansehen a={ansehen} eintrag={buch.map[String(ansehen.buchName || ansehen.wer || '').toLowerCase()] || null} buchFehlt={buch.fehlt} wer={userDisplayName}
        onZu={() => setAnsehen(null)} onKopieren={kopieren} onGespeichert={(t) => { setAnsehen(null); melde(t); lade() }}
        onBuch={async () => setBuch(await empfaengerLaden())} />}

      {anz && createPortal(
        <div className="bh-ov" onClick={e => { if (e.target === e.currentTarget) setAnz(null) }}>
          <div className="bh-fenster">
            <div className="bh-fenster-kopf"><b>Anzahlung · {anz.i.name}</b><button className="bh-x" onClick={() => setAnz(null)}><X size={18} /></button></div>
            <div className="bh-fenster-text">Was ihr schon überwiesen habt, bevor die Rechnung da ist. Nur für euch intern — der Chatter bekommt keine Nachricht.</div>
            {anz.liste.length > 0 && (
              <div className="bh-anz-liste">
                {anz.liste.map((e, n) => (
                  <div key={n} className="bh-anz-zeile">
                    <b>{geld(e.betrag, gesamtVon(anz.i).waehrung)}</b>
                    <span>{e.am ? datum(e.am) : ''}{e.notiz ? ` · ${e.notiz}` : ''}{e.von ? ` · ${e.von}` : ''}</span>
                    <button className="bh-x" disabled={busy === anz.i.key} title="Entfernen" onClick={() => { if (confirm('Diese Anzahlung entfernen?')) anzSpeichern(anz.liste.filter((_, j) => j !== n)) }}><Trash2 size={14} /></button>
                  </div>
                ))}
                <div className="bh-fenster-text">Gesamt {geld(gesamtVon(anz.i).wert, gesamtVon(anz.i).waehrung)} − angezahlt {geld(anzahlungSumme({ anzahlungen: anz.liste }), gesamtVon(anz.i).waehrung)} = <b style={{ color: '#34d399' }}>Rest {geld((gesamtVon(anz.i).wert || 0) - anzahlungSumme({ anzahlungen: anz.liste }), gesamtVon(anz.i).waehrung)}</b></div>
              </div>
            )}
            <div className="bh-betrag-zeile">
              <label className="bh-feld"><span>Neue Anzahlung ({gesamtVon(anz.i).waehrung === 'USD' ? '$' : '€'})</span><input inputMode="decimal" autoFocus value={anz.betrag} placeholder="z. B. 300" onChange={e => setAnz({ ...anz, betrag: e.target.value })} /></label>
              <label className="bh-feld"><span>Überwiesen am</span><input type="date" value={anz.am} onChange={e => setAnz({ ...anz, am: e.target.value })} /></label>
            </div>
            <label className="bh-feld"><span>Notiz (optional)</span><input value={anz.notiz} placeholder="z. B. Vorschuss per PayPal" onChange={e => setAnz({ ...anz, notiz: e.target.value })} /></label>
            <div className="bh-fenster-fuss"><button className="bh-k" onClick={() => setAnz(null)}>Schließen</button><button className="bh-k bh-p" disabled={busy === anz.i.key || !anz.betrag.trim()} onClick={anzHinzu}><Plus size={14} strokeWidth={2.6} /> Anzahlung speichern</button></div>
          </div>
        </div>, document.body)}

      {exp && createPortal(
        <div className="bh-ov" onClick={e => { if (e.target === e.currentTarget && !exp.laeuft) setExp(null) }}>
          <div className="bh-fenster">
            <div className="bh-fenster-kopf"><b>Export für die Buchhaltung</b><button className="bh-x" disabled={exp.laeuft} onClick={() => setExp(null)}><X size={18} /></button></div>
            <div className="bh-fenster-text">ZIP mit allen hochgeladenen Rechnungen (ein Ordner je Monat) und einer Übersicht als Excel-Datei: Chatter, Beträge, Extras, Gesamt, Rechnung, bezahlt am.</div>
            <div className="bh-export-monate">
              <label className="bh-feld"><span>Von Monat</span><select className="bh-sel" value={exp.ab} onChange={e => setExp({ ...exp, ab: e.target.value, bis: e.target.value > exp.bis ? e.target.value : exp.bis })}>{letzteMonate(24).map(m => <option key={m} value={m}>{monatName(m)}</option>)}</select></label>
              <label className="bh-feld"><span>Bis Monat</span><select className="bh-sel" value={exp.bis} onChange={e => setExp({ ...exp, bis: e.target.value, ab: e.target.value < exp.ab ? e.target.value : exp.ab })}>{letzteMonate(24).map(m => <option key={m} value={m}>{monatName(m)}</option>)}</select></label>
            </div>
            <label className="bh-haken"><input type="checkbox" checked={exp.nurBezahlt} onChange={e => setExp({ ...exp, nurBezahlt: e.target.checked })} /> Nur bezahlte</label>
            {exp.text && <div className="bh-fenster-text" style={{ color: '#34d399' }}>{exp.text}</div>}
            <div className="bh-fenster-fuss">
              <button className="bh-k" disabled={exp.laeuft} onClick={async () => {
                setExp(x => ({ ...x, laeuft: true, text: '' }))
                const r = await exportCsv({ abMonat: exp.ab, bisMonat: exp.bis, nurBezahlt: exp.nurBezahlt })
                setExp(x => ({ ...x, laeuft: false, text: r.error ? '⚠ ' + r.error.message : `Übersicht mit ${r.anzahl} Zeilen heruntergeladen.` }))
              }}><FileSpreadsheet size={14} strokeWidth={2.4} /> Nur Übersicht</button>
              <button className="bh-k bh-p" disabled={exp.laeuft} onClick={async () => {
                setExp(x => ({ ...x, laeuft: true, text: 'Lädt Rechnungen …' }))
                const r = await exportZip({ abMonat: exp.ab, bisMonat: exp.bis, nurBezahlt: exp.nurBezahlt }, (n, von) => setExp(x => ({ ...x, text: `Lädt Rechnung ${n} von ${von} …` })))
                setExp(x => ({ ...x, laeuft: false, text: r.error ? '⚠ ' + r.error.message : `ZIP heruntergeladen: ${r.dateien} Rechnung${r.dateien === 1 ? '' : 'en'}, ${r.anzahl} Zeilen in der Übersicht${r.fehlen?.length ? ` · ${r.fehlen.length} nicht geladen (steht in der ZIP)` : ''}.` }))
              }}><FolderDown size={14} strokeWidth={2.4} /> {exp.laeuft ? 'Läuft …' : 'ZIP mit Rechnungen'}</button>
            </div>
          </div>
        </div>, document.body)}

      {extras && createPortal(
        <div className="bh-ov" onClick={e => { if (e.target === e.currentTarget) setExtras(null) }}>
          <div className="bh-fenster">
            <div className="bh-fenster-kopf"><b>Extras · {extras.i.name}</b><button className="bh-x" onClick={() => setExtras(null)}><X size={18} /></button></div>
            <div className="bh-fenster-text">Kommt zum Betrag dazu, z. B. Skripte, Bonus, Vorschuss. Abzug mit Minus (−50).</div>
            {extras.liste.map((e, n) => (
              <div key={n} className="bh-extra-zeile">
                <input placeholder="wofür, z. B. Skripte September" value={e.text} onChange={ev => setExtras({ ...extras, liste: extras.liste.map((x, j) => j === n ? { ...x, text: ev.target.value } : x) })} />
                <input inputMode="decimal" placeholder="€" value={e.betrag} onChange={ev => setExtras({ ...extras, liste: extras.liste.map((x, j) => j === n ? { ...x, betrag: ev.target.value } : x) })} />
                <button className="bh-x" onClick={() => setExtras({ ...extras, liste: extras.liste.filter((_, j) => j !== n) })} title="Weg"><Trash2 size={15} /></button>
              </div>
            ))}
            <button className="bh-link" onClick={() => setExtras({ ...extras, liste: [...extras.liste, { text: '', betrag: '' }] })}><Plus size={14} strokeWidth={2.6} /> Weiteres Extra</button>
            <div className="bh-fenster-text">
              {(() => {
                const man = istManuell(extras.i.row)
                const w = man ? extras.i.row.waehrung : 'EUR'
                const basis = Number(man ? extras.i.row.betrag_manuell : anzeige(extras.i).betrag_eur) || 0
                const ex = extras.liste.reduce((t, e) => t + (zahlAus(e.betrag) || 0), 0)
                return <>{man ? 'Betrag' : 'Anteil'} {geld(basis, w)} + Extras {geld(ex, w)} = <b style={{ color: '#34d399' }}>{geld(basis + ex, w)}</b></>
              })()}
            </div>
            <div className="bh-fenster-fuss"><button className="bh-k" onClick={() => setExtras(null)}>Abbrechen</button><button className="bh-k bh-p" disabled={busy === extras.i.key} onClick={extrasSpeichernKlick}><Check size={14} strokeWidth={2.6} /> Speichern</button></div>
          </div>
        </div>, document.body)}
    </div>
  )
}

// Rechnung direkt in der Buchhaltung ansehen (PDF im Fenster, Foto als Bild)
// v5.38.1: unten Betrag + IBAN prüfen/eintragen, „Aus PDF lesen“, Vergleich mit Gesamt
function Ansehen({ a, eintrag, buchFehlt, wer, onZu, onKopieren, onGespeichert, onBuch }) {
  const [url, setUrl] = useState(null)
  const [betrag, setBetrag] = useState(a.betrag != null ? String(a.betrag).replace('.', ',') : '')
  const [iban, setIban] = useState(a.iban ? ibanSchoen(a.iban) : '')
  const [nummer, setNummer] = useState(a.row?.rechnung_nr || '')          // v5.46.0
  const [inhaber, setInhaber] = useState(a.row?.rechnung_inhaber || '')
  const [typ, setTyp] = useState(eintrag?.typ || 'PRIVATE')
  const [buchOk, setBuchOk] = useState('')
  const [lesen, setLesen] = useState('')
  const [speichert, setSpeichert] = useState(false)
  const [gelesen, setGelesen] = useState(null)      // { text: [...], fehler } — was in der PDF steht
  useEffect(() => { let weg = false; signiert(a.url).then(u => { if (!weg) setUrl(u) }); return () => { weg = true } }, [a.url])
  const istBild = /\.(jpe?g|png|webp|gif|heic|heif)(\?|$)/i.test(a.name || a.url)
  const ausPdf = async () => {
    if (!a.row) return
    setLesen('liest')
    const g = await rechnungNeuLesen(a.row)
    setGelesen({ text: g.text || [], fehler: g.fehler || '' })
    if (g.leer) { setLesen(g.grund === 'foto' ? 'foto' : g.grund === 'scan' ? 'scan' : g.grund === 'fehler' ? 'fehler' : 'nichts'); return }
    if (g.betrag != null) setBetrag(String(g.betrag).replace('.', ','))
    if (g.iban) setIban(ibanSchoen(g.iban))
    if (g.nummer && !nummer) setNummer(g.nummer)
    if (g.inhaber && !inhaber) setInhaber(g.inhaber)
    setLesen(g.betrag != null ? 'ok' : 'ohne-summe')
  }
  // Fehlt der Betrag noch: beim Öffnen einmal automatisch aus der PDF lesen
  useEffect(() => { if (a.row && a.betrag == null && !istBild) ausPdf() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const b = zahlAus(betrag)
  const diff = b != null && a.gesamt != null ? Math.round((b - a.gesamt) * 100) / 100 : null
  const entfernen = async () => {
    if (!confirm(`Rechnung „${a.name || 'Rechnung'}“ von ${a.wer} wirklich entfernen?\n\nDie Datei wird gelöscht. Der Eintrag bleibt und steht wieder auf „Rechnung fehlt“${a.row?.status === 'bezahlt' ? ' (bezahlt bleibt bezahlt)' : ''}.`)) return
    setSpeichert(true)
    const r = await rechnungEntfernen(a.row)
    setSpeichert(false)
    if (r.error) { alert('Nicht entfernt: ' + r.error.message); return }
    onGespeichert(`${a.wer}: Rechnung entfernt.`)
  }
  const speichern = async () => {
    setSpeichert(true)
    const r = await rechnungsangabenSpeichern(a.row, { betrag, iban, nummer, inhaber })
    setSpeichert(false)
    if (r.error) { alert('Nicht gespeichert: ' + r.error.message); return }
    onGespeichert(`${a.wer}: Rechnungsbetrag ${b != null ? geld(b, a.waehrung) : 'entfernt'} gespeichert.`)
  }
  return createPortal(
    <div className="bh-ov bh-ov-gross" onClick={e => { if (e.target === e.currentTarget) onZu() }}>
      <div className="bh-ansehen">
        <div className="bh-fenster-kopf">
          <b><Eye size={16} strokeWidth={2.4} /> {a.wer} · {a.name || 'Rechnung'}</b>
          <span className="bh-ansehen-knoepfe">
            <button className="bh-k" onClick={() => oeffnen(a.url)} title="In neuem Tab öffnen"><ExternalLink size={14} strokeWidth={2.2} /></button>
            <button className="bh-x" onClick={onZu}><X size={18} /></button>
          </span>
        </div>
        <div className="bh-ansehen-inhalt">
          {!url ? <div className="bh-leer">Lädt …</div>
            : istBild ? <img src={url} alt={a.name || 'Rechnung'} />
              : <iframe src={url} title={a.name || 'Rechnung'} />}
        </div>
        {a.row && gelesen && gelesen.text.length > 0 && lesen !== 'ok' && (
          <details className="bh-gelesen">
            <summary>Was das Dashboard in der PDF lesen kann ({gelesen.text.length} Zeilen)</summary>
            <pre>{gelesen.text.slice(0, 120).join('\n')}</pre>
          </details>
        )}
        {a.row && (
          <div className="bh-pruefen">
            <label className="bh-feld"><span>Betrag auf der Rechnung ({a.waehrung === 'USD' ? '$' : '€'})</span><input inputMode="decimal" value={betrag} placeholder="z. B. 447,48" onChange={e => setBetrag(e.target.value)} /></label>
            <label className="bh-feld bh-pruefen-iban"><span>IBAN</span><input value={iban} placeholder="DE…" onChange={e => setIban(e.target.value)} /></label>
            {iban.trim() && <button className="bh-k" onClick={() => onKopieren(iban)} title="IBAN kopieren"><Copy size={14} strokeWidth={2.2} /></button>}
            <label className="bh-feld"><span title="wird bei Wise als Betreff benutzt">Rechnungsnummer</span><input value={nummer} placeholder="z. B. RE-2026-017" onChange={e => setNummer(e.target.value)} /></label>
            <label className="bh-feld bh-pruefen-iban"><span>Name / Firma auf der Rechnung</span><input value={inhaber} placeholder="wie auf dem Bankkonto" onChange={e => setInhaber(e.target.value)} /></label>
            {(() => {
              const vI = ibanVergleich(iban, eintrag), vN = nameVergleich(inhaber, eintrag)
              const uebernehmen = async () => {
                const i = iban.replace(/\s/g, '').toUpperCase()
                if (!inhaber.trim() || !ibanGueltig(i)) { alert('Für das Adressbuch bitte Name/Firma und eine gültige IBAN eintragen.'); return }
                if (eintrag?.iban && eintrag.iban !== i && !confirm(`Im Adressbuch steht für ${a.wer} eine andere IBAN (${ibanSchoen(eintrag.iban)}).\n\nWirklich durch ${ibanSchoen(i)} ersetzen? Geänderte Bankdaten am besten kurz beim Chatter nachfragen.`)) return
                const { error } = await empfaengerSpeichern([{ name: a.wer, kontoinhaber: inhaber, typ, iban: i }], wer)
                if (error) { alert('Nicht gespeichert: ' + (/zahlungsempfaenger/.test(error.message || '') ? 'Datenbank fehlt noch (sql/zahlungsempfaenger.sql + sql/adressbuch.sql).' : error.message)); return }
                setBuchOk('Ins Adressbuch übernommen.'); onBuch?.()
              }
              return (
                <div className="bh-buch-abgleich">
                  <b><BookUser size={14} strokeWidth={2.4} /> Adressbuch</b>
                  {buchFehlt ? <span className="warn">Datenbank fehlt noch (sql/zahlungsempfaenger.sql)</span> : !eintrag ? <span className="lila">noch kein Eintrag für {a.wer}</span> : <>
                    {vN === 'gleich' && <span className="gut">✓ Name wie Adressbuch</span>}
                    {vN === 'anders' && <span className="warn">⚠ Name anders als Adressbuch ({eintrag.kontoinhaber})</span>}
                    {vI === 'gleich' && <span className="gut">✓ IBAN wie Adressbuch</span>}
                    {vI === 'anders' && <span className="rot"><ShieldAlert size={13} strokeWidth={2.4} /> IBAN anders als Adressbuch ({ibanSchoen(eintrag.iban)})</span>}
                  </>}
                  {!buchFehlt && (!eintrag || vI === 'anders' || vN === 'anders' || (eintrag && !eintrag.kontoinhaber)) && (
                    <span className="bh-buch-knopf">
                      <span className="bh-umschalter"><button className={typ === 'PRIVATE' ? 'an' : ''} onClick={() => setTyp('PRIVATE')}>Privat</button><button className={typ === 'INSTITUTION' ? 'an' : ''} onClick={() => setTyp('INSTITUTION')}>Firma</button></span>
                      <button className="bh-k" onClick={uebernehmen}><BookUser size={14} strokeWidth={2.2} /> {eintrag ? 'Adressbuch aktualisieren' : 'Ins Adressbuch'}</button>
                    </span>
                  )}
                  {buchOk && <span className="gut">{buchOk}</span>}
                </div>
              )
            })()}
            <div className="bh-pruefen-info">
              {a.gesamt != null && <span>Gesamt laut Dashboard: <b>{geld(a.gesamt, a.waehrung)}</b></span>}
              {diff != null && (diff === 0
                ? <span className="gut"><CircleCheck size={13} strokeWidth={2.4} /> passt</span>
                : <span className="warn"><TriangleAlert size={13} strokeWidth={2.4} /> {diff > 0 ? '+' : '−'}{geld(Math.abs(diff), a.waehrung)} Abweichung</span>)}
              {lesen === 'liest' && <span>liest PDF …</span>}
              {lesen === 'ok' && <span className="lila"><Sparkles size={13} strokeWidth={2.4} /> aus der PDF vorgeschlagen</span>}
              {lesen === 'ohne-summe' && <span>In der PDF keine Summe gefunden</span>}
              {lesen === 'nichts' && <span>In der PDF nichts gefunden — bitte abtippen</span>}
              {lesen === 'scan' && <span>PDF ohne Text (Scan/Bild) — bitte abtippen</span>}
              {lesen === 'foto' && <span>Foto — bitte abtippen</span>}
              {lesen === 'fehler' && <span className="warn">PDF konnte nicht gelesen werden{gelesen?.fehler ? `: ${gelesen.fehler}` : ''}</span>}
            </div>
            <div className="bh-pruefen-knoepfe">
              <button className="bh-k bh-leise" onClick={entfernen} title="Falsche Datei? Rechnung wieder entfernen"><Trash2 size={14} strokeWidth={2.2} /> Rechnung entfernen</button>
              {!istBild && <button className="bh-k" disabled={lesen === 'liest'} onClick={ausPdf}><Sparkles size={14} strokeWidth={2.2} /> Aus PDF lesen</button>}
              <button className="bh-k bh-p" disabled={speichert} onClick={speichern}><Check size={14} strokeWidth={2.6} /> Speichern</button>
            </div>
          </div>
        )}
      </div>
    </div>, document.body)
}

function Kpi({ wert, sub, label, farbe }) {
  return <div className="bh-kpi"><div style={{ color: farbe }}>{wert}{sub ? <small>{sub}</small> : null}</div><span>{label}</span></div>
}
