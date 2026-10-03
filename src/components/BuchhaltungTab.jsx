import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Receipt, Send, Check, Upload, FileText, MessageCircleWarning, Undo2, Bell, X, Download, Plus, Trash2, RefreshCw, TriangleAlert, CircleCheck, FolderDown, FileSpreadsheet, UserPlus, Pencil, Copy, Eye, ExternalLink, Sparkles,
} from 'lucide-react'
import {
  STATUS, ART, euro, dollar, geld, datum, datumZeit, heuteIso, monatName, fehltTabelle, zahlAus,
  abrechnungenLaden, periode, zeitraumLaden, anzeige, veraltet, statusVon, extrasVon, gesamtEur, gesamt, istManuell,
  manuellSpeichern, letzterEintrag, namenVorschlaege, eintragLoeschen, rechnungNeuLesen, rechnungsangabenSpeichern,
  zeileSichern, extrasSpeichern, mitteilen, zahlenAktualisieren,
  rechnungHochladen, alsBezahlt, bezahltZurueck, klaerung, erinnern, abrechnungPdf, exportZip, exportCsv,
} from '../buchhaltung'
import { oeffnen, signiert } from '../medien'
import { rechnungLesen, ibanSchoen } from '../rechnungLesen'

// ── Buchhaltung (v5.37.0 · v5.37.1) ────────────────────────────────────────
// Verwaltung → Buchhaltung. Die Zahlen stehen automatisch drin (wie Billing).
// Pro Chatter: Anteil + Extras (z. B. Skripte, Bonus, Abzug) = Gesamt, daneben
// Rechnung da / fehlt und „Bezahlt“. Mit „Bescheid geben“ sieht der Chatter
// seine Abrechnung und bekommt Telegram; vorher ist alles euer Entwurf.
// v5.38.0: „+ Team / ohne Profil“ (z. B. Alina in $, ehemalige Chatter wie Joel),
// Summe + IBAN aus PDF-Rechnungen vorgeschlagen, Rechnung im Fenster ansehen.

const letzteMonate = (n = 12) => {
  const out = []; const d = new Date()
  for (let i = 0; i < n; i++) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0')) }
  return out
}
const SPEICHER = 'buchhaltung_ansicht_v1'
const lies = () => { try { return JSON.parse(localStorage.getItem(SPEICHER) || 'null') } catch { return null } }

export default function BuchhaltungTab({ userDisplayName }) {
  const start = lies()
  const [modus, setModus] = useState(start?.modus || 'monat')            // 'monat' | 'frei' | 'offen'
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
  const [hand, setHand] = useState(null)           // Team / ohne Profil: { row?, name, art, monat, betrag, waehrung, notiz, iban, datei, erkannt }
  const [ansehen, setAnsehen] = useState(null)     // { url, name, iban, betrag, waehrung }
  const [namen, setNamen] = useState([])
  useEffect(() => { namenVorschlaege().then(setNamen).catch(() => {}) }, [])
  const datei = useRef(null)
  const ziel = useRef(null)

  useEffect(() => { try { localStorage.setItem(SPEICHER, JSON.stringify({ modus, monat, von, bis })) } catch { /* egal */ } }, [modus, monat, von, bis])

  const p = useMemo(() => modus === 'offen' ? null : (modus === 'frei' && !(von && bis && von <= bis)) ? null : periode({ monat, von, bis, frei: modus === 'frei' }), [modus, monat, von, bis])

  const lade = async () => {
    if (modus === 'offen') {
      const { data, error } = await abrechnungenLaden()
      if (error) { setDaten({ fehler: fehltTabelle(error) ? 'Die Datenbank für die Buchhaltung fehlt noch: sql/buchhaltung.sql und sql/buchhaltung-entwurf.sql ausführen.' : error.message, items: [] }); return }
      const items = (data || []).filter(r => (r.mitgeteilt_am || istManuell(r)) && r.status !== 'bezahlt')
        .map(r => ({ key: 'r' + r.id, name: r.chatter_name, row: r, live: null, telegram: null, manuell: istManuell(r), p: { ab: r.von, ende: r.bis, bezug: r.monat, frei: r.frei, bezeichnung: r.bezeichnung } }))
      setDaten({ items }); return
    }
    if (!p) { setDaten({ items: [] }); return }
    const r = await zeitraumLaden(p)
    if (r.fehler) { setDaten({ fehler: r.fehler, items: [] }); return }
    setDaten({ ...r, items: r.items.map(i => ({ ...i, p, key: i.manuell ? 'r' + i.row.id : 'c-' + i.name })) })
  }
  useEffect(() => { setDaten(null); lade() }, [modus, p?.ab, p?.ende]) // eslint-disable-line react-hooks/exhaustive-deps

  const items = daten?.items || []
  const statusZahl = (st) => items.filter(i => statusVon(i.row) === st).length
  const sichtbar = items.filter(i => filter === 'alle' || statusVon(i.row) === filter)
  const summe = (l) => l.reduce((t, i) => t + (gesamtEur(anzeige(i)) || 0), 0)
  const summeUsd = (l) => l.filter(i => istManuell(i.row) && i.row.waehrung === 'USD').reduce((t, i) => t + (gesamt(i.row).wert || 0), 0)
  const entwuerfe = items.filter(i => statusVon(i.row) === 'entwurf')
  const fehlen = items.filter(i => statusVon(i.row) === 'offen' && !i.manuell)
  const bezahltListe = items.filter(i => statusVon(i.row) === 'bezahlt')

  const melde = (t) => { setMeldung(t); if (t) setTimeout(() => setMeldung(m => (m === t ? '' : m)), 7000) }
  const sichern = async (item) => {
    const r = await zeileSichern(item, item.p, userDisplayName)
    if (r.error) { alert('Nicht gespeichert: ' + (fehltTabelle(r.error) ? 'Datenbank fehlt noch (sql/buchhaltung-entwurf.sql).' : r.error.message)); return null }
    return r.row
  }

  // ── Aktionen ─────────────────────────────────────────────────────────────
  const bescheid = async (liste) => {
    if (!liste.length) return
    const ohneKurs = liste.some(i => i.live && i.live.betrag_eur == null)
    if (!confirm(`${liste.length === 1 ? liste[0].name : liste.length + ' Chattern'} die Abrechnung mitteilen?\n\nDie Zahlen werden damit festgeschrieben, der Chatter sieht sie im Portal und bekommt eine Telegram-Nachricht.${ohneKurs ? '\n\n⚠ Für diesen Monat ist noch kein Euro-Kurs eingetragen — dann steht nur der $-Betrag drin.' : ''}`)) return
    setBusy('bescheid')
    let ok = 0, tg = 0, fehler = ''
    for (const i of liste) {
      const r = await mitteilen(i, i.p, { wer: userDisplayName })
      if (r.error) { fehler = r.error.message; continue }
      ok++; if (r.gesendet) tg++
    }
    setBusy(null)
    if (fehler) alert('Nicht alles ging durch: ' + fehler)
    melde(`${ok} mitgeteilt · ${tg} per Telegram${ok > tg ? ` · ${ok - tg} ohne Telegram` : ''}`); lade()
  }
  const hochladenStart = (i) => { ziel.current = i; datei.current?.click() }
  const hochladen = async (ev) => {
    const f = ev.target.files?.[0]; ev.target.value = ''
    const i = ziel.current; if (!f || !i) return
    setBusy(i.key)
    const row = await sichern(i)
    if (!row) { setBusy(null); return }
    const r = await rechnungHochladen(row, f, { durchAdmin: true })
    setBusy(null)
    if (r.error) { alert('Rechnung NICHT hochgeladen: ' + r.error.message); return }
    melde(`Rechnung für ${i.name} hochgeladen. Summe und IBAN (falls in der PDF) sind vorgeschlagen — bitte prüfen.`); lade()
  }
  const bezahltOeffnen = (i) => {
    const a = anzeige(i)
    setBezahlt({ i, am: heuteIso(), betrag: String(i.row?.rechnung_betrag ?? (istManuell(i.row) ? gesamt(i.row).wert : gesamtEur(a)) ?? '').replace('.', ',') })
  }
  const bezahltSpeichern = async () => {
    const { i, am, betrag } = bezahlt
    setBusy(i.key)
    const row = await sichern(i)
    if (!row) { setBusy(null); return }
    const r = await alsBezahlt({ ...anzeige(i), ...row }, { am, betrag })
    setBusy(null)
    if (r.error) { alert('Nicht gespeichert: ' + r.error.message); return }
    setBezahlt(null); melde(`${i.name}: bezahlt am ${datum(am)} (nur intern gespeichert).`); lade()
  }
  const zurueck = async (i) => {
    if (!confirm(`„Bezahlt“ bei ${i.name} wieder entfernen?`)) return
    const { error } = await bezahltZurueck(i.row)
    if (error) { alert(error.message); return }
    lade()
  }
  const klaerSenden = async () => {
    const { i, notiz } = klaer
    if (!notiz.trim()) return
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
    const r = await erinnern(liste.map(i => anzeige(i)))
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
    setExtras(null); melde(`${i.name}: Extras gespeichert${i.row?.mitgeteilt_am ? ' (der Chatter sieht den neuen Betrag im Portal)' : ''}.`); lade()
  }
  const aktualisieren = async (i) => {
    if (!confirm(`Die Zahlen für ${i.name} haben sich seit dem Mitteilen geändert (${dollar(i.row.auszahlung_usd)} → ${dollar(i.live.auszahlung_usd)}). Neue Zahlen übernehmen?`)) return
    const { error } = await zahlenAktualisieren(i)
    if (error) { alert(error.message); return }
    lade()
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
          <button className={modus === 'frei' ? 'an' : ''} onClick={() => setModus('frei')}>Zeitraum</button>
          <button className={modus === 'offen' ? 'an' : ''} onClick={() => setModus('offen')}>Alles Offene</button>
        </div>
        {modus === 'monat' && (
          <select className="bh-sel" value={monat} onChange={e => setMonat(e.target.value)}>
            {letzteMonate(12).map(m => <option key={m} value={m}>{monatName(m)}</option>)}
          </select>
        )}
        {modus === 'frei' && (
          <div className="bh-datum"><input type="date" value={von} onChange={e => setVon(e.target.value)} /><span>bis</span><input type="date" value={bis} onChange={e => setBis(e.target.value)} /></div>
        )}
        <div className="bh-kopf-rechts">
          <button className="bh-k" onClick={() => handOeffnen(null)} title="Team (z. B. Alina) oder Rechnung ohne Profil (z. B. ehemalige Chatter)"><UserPlus size={14} strokeWidth={2.4} /> Team / ohne Profil</button>
          <button className="bh-k" onClick={() => { const m = p ? p.bezug : letzteMonate(2)[1]; setExp({ ab: m, bis: m, nurBezahlt: false, laeuft: false, text: '' }) }} title="Rechnungen und Übersicht für eure Buchhaltung herunterladen"><FolderDown size={14} strokeWidth={2.4} /> Export</button>
          {fehlen.length > 0 && <button className="bh-k" disabled={busy === 'erinnern'} onClick={() => erinnereAlle(fehlen)}><Bell size={14} strokeWidth={2.4} /> Erinnern ({fehlen.length})</button>}
          {entwuerfe.length > 0 && <button className="bh-k bh-p" disabled={busy === 'bescheid'} onClick={() => bescheid(entwuerfe)}><Send size={14} strokeWidth={2.4} /> {busy === 'bescheid' ? 'Läuft …' : `Allen Bescheid geben (${entwuerfe.length})`}</button>}
        </div>
      </div>

      {daten && modus !== 'offen' && p && !daten.fehler && (
        <div className="bh-info">
          <span className={voll ? 'gut' : 'warn'}>{voll ? <CircleCheck size={14} strokeWidth={2.4} /> : <TriangleAlert size={14} strokeWidth={2.4} />} Daten {daten.tage} von {daten.tageSoll} Tagen{!voll && daten.letzterTag ? ` · bis ${datum(daten.letzterTag)}` : ''}{zeitraumZukunft ? ' · Zeitraum läuft noch' : ''}</span>
          <span className={daten.kurs ? '' : 'warn'}>{daten.kurs ? `Kurs 1 $ = ${String(daten.kurs).replace('.', ',')} €` : `Kein Euro-Kurs für ${monatName(p.bezug)} — in Billing eintragen`}</span>
          <span>{p.bezeichnung} · {datum(p.ab)}–{datum(p.ende)}</span>
        </div>
      )}
      {modus === 'frei' && !p && <div className="bh-leer">Von und bis wählen, z. B. Samstag bis Freitag.</div>}
      {daten?.fehler && <div className="bh-warn">{daten.fehler}</div>}
      {meldung && <div className="bh-ok"><Check size={15} strokeWidth={2.6} /> {meldung}</div>}

      {daten && items.length > 0 && (
        <>
          <div className="bh-kpis">
            <Kpi farbe="#e5e7eb" wert={euro(summe(items))} sub={summeUsd(items) ? `+ ${dollar(summeUsd(items))}` : ''} label={`Gesamt · ${items.length} ${items.length === 1 ? 'Eintrag' : 'Einträge'}`} />
            <Kpi farbe={STATUS.entwurf.farbe} wert={statusZahl('entwurf')} label="Noch nicht mitgeteilt" />
            <Kpi farbe={STATUS.rechnung.farbe} wert={statusZahl('rechnung')} sub={statusZahl('offen') ? `${statusZahl('offen')} fehlen` : ''} label="Rechnung da" />
            <Kpi farbe={STATUS.bezahlt.farbe} wert={bezahltListe.length} sub={euro(bezahltListe.reduce((t, i) => t + Number(i.row?.bezahlt_betrag ?? gesamtEur(anzeige(i)) ?? 0), 0))} label="Bezahlt" />
          </div>
          <div className="bh-chips">
            {['alle', 'entwurf', 'offen', 'rechnung', 'klaerung', 'bezahlt'].filter(k => k === 'alle' || statusZahl(k)).map(k => (
              <button key={k} className={'bh-chip' + (filter === k ? ' an' : '')} onClick={() => setFilter(k)}>{k === 'alle' ? `Alle ${items.length}` : `${STATUS[k].label} · ${statusZahl(k)}`}</button>
            ))}
          </div>
        </>
      )}

      {!daten && <div className="bh-leer">Rechnet …</div>}
      {daten && !daten.fehler && !items.length && (modus !== 'frei' || p) && (
        <div className="bh-leer">{modus === 'offen' ? 'Nichts offen — alles bezahlt.' : 'Für diesen Zeitraum gibt es keine Auszahlung (keine Daten oder kein Satz in Billing).'}</div>
      )}

      {sichtbar.length > 0 && (
        <div className="bh-tabelle">
          <div className="bh-tkopf"><span>Name</span><span>Umsatz</span><span>Anteil / Betrag</span><span>Extras</span><span>Gesamt</span><span>Rechnung</span><span>Status</span><span /></div>
          {sichtbar.map(i => {
            const a = anzeige(i)
            const stKey = statusVon(i.row)
            const st = STATUS[stKey]
            const r = i.row
            const man = istManuell(r)
            const G = man ? gesamt(r) : { wert: gesamtEur(a), waehrung: 'EUR' }
            const g = G.wert
            const abw = r?.rechnung_betrag != null && g != null && Math.abs(Number(r.rechnung_betrag) - g) >= 0.01
            const b = busy === i.key
            const alt = veraltet(i)
            return (
              <div key={i.name + (r?.id || '')} className="bh-zeile" style={{ borderLeftColor: st.farbe }}>
                <div className="bh-wer">
                  <b>{i.name}{man && <em className="bh-art" style={{ color: ART[r.art]?.farbe, borderColor: ART[r.art]?.farbe }}>{ART[r.art]?.label}</em>}</b>
                  {modus === 'offen' && <span>{r?.bezeichnung}</span>}
                  {man && r.notiz && <span className="bh-notiz-text" title={r.notiz}>{r.notiz}</span>}
                </div>
                {man ? <div className="bh-zahl"><span className="bh-mobil">Umsatz</span>—</div>
                  : <div className="bh-zahl"><span className="bh-mobil">Umsatz</span>{dollar(a.nur_chat === false ? a.umsatz_gesamt_usd : a.umsatz_chat_usd)}<small>{a.prozent != null ? `${String(a.prozent).replace('.', ',')} % ${a.nur_chat === false ? 'gesamt' : 'Chat'}` : ''}</small></div>}
                {man ? <div className="bh-zahl"><span className="bh-mobil">Betrag</span>{r.betrag_manuell != null ? geld(r.betrag_manuell, r.waehrung) : '—'}<small>{r.waehrung === 'USD' ? 'in Dollar' : ''}</small></div>
                  : <div className="bh-zahl"><span className="bh-mobil">Anteil</span>{a.betrag_eur != null ? euro(a.betrag_eur) : dollar(a.auszahlung_usd)}<small>{a.betrag_eur != null ? dollar(a.auszahlung_usd) : 'Kurs fehlt'}</small></div>}
                <div className="bh-extras">
                  {extrasVon(r).map((e, n) => <span key={n} className={'bh-extra' + (Number(e.betrag) < 0 ? ' minus' : '')} title={e.text}>{Number(e.betrag) < 0 ? '−' : '+'}{geld(Math.abs(e.betrag), G.waehrung)} <em>{e.text}</em></span>)}
                  {stKey !== 'bezahlt' && <button className="bh-plus" onClick={() => setExtras({ i, liste: extrasVon(r).length ? extrasVon(r).map(e => ({ text: e.text, betrag: String(e.betrag).replace('.', ',') })) : [{ text: '', betrag: '' }] })}><Plus size={13} strokeWidth={2.6} /> {extrasVon(r).length ? 'ändern' : 'Extra'}</button>}
                </div>
                <div className="bh-gesamt"><span className="bh-mobil">Gesamt</span>{g != null ? geld(g, G.waehrung) : '—'}</div>
                <div className="bh-rechnung">
                  {r?.rechnung_url ? (
                    <>
                      <button className="bh-link" onClick={() => setAnsehen({ row: r, url: r.rechnung_url, name: r.rechnung_name, iban: r.rechnung_iban, betrag: r.rechnung_betrag, waehrung: G.waehrung, gesamt: g, wer: i.name })} title="Rechnung ansehen"><FileText size={14} strokeWidth={2.2} /> {r.rechnung_name || 'Rechnung'}</button>
                      <small>{r.rechnung_von && r.rechnung_von !== i.name ? `von ${r.rechnung_von} · ` : ''}{datumZeit(r.rechnung_am)}{r.rechnung_betrag != null && <span style={{ color: abw ? '#f59e0b' : undefined }} title={r.betrag_erkannt ? 'Aus der PDF erkannt — bitte prüfen' : undefined}> · {geld(r.rechnung_betrag, G.waehrung)}{r.betrag_erkannt ? ' (erkannt)' : ''}{abw ? ' ≠ Gesamt' : ''}</span>}</small>
                      {r.rechnung_betrag == null && <button className="bh-link warn" onClick={() => setAnsehen({ row: r, url: r.rechnung_url, name: r.rechnung_name, iban: r.rechnung_iban, betrag: null, waehrung: G.waehrung, gesamt: g, wer: i.name })}><Pencil size={12} strokeWidth={2.4} /> Betrag fehlt — prüfen</button>}
                      {r.rechnung_iban && <button className="bh-iban" onClick={() => kopieren(r.rechnung_iban)} title="IBAN kopieren"><Copy size={12} strokeWidth={2.4} /> {ibanSchoen(r.rechnung_iban)}</button>}
                    </>
                  ) : <small>{stKey === 'entwurf' ? '—' : `fehlt${r?.erinnert_am ? ` · erinnert ${datum(r.erinnert_am)}` : ''}`}</small>}
                </div>
                <div className="bh-status">
                  <span className="bh-st" style={{ color: st.farbe, background: st.bg }}>{stKey === 'bezahlt' ? `Bezahlt ${datum(r.bezahlt_am)}` : st.label}</span>
                  {stKey === 'bezahlt' && <small>{r.bezahlt_betrag != null ? euro(r.bezahlt_betrag) + ' · ' : ''}{r.bezahlt_von || ''}</small>}
                  {stKey === 'klaerung' && r.klaerung_notiz && <small className="bh-notiz">„{r.klaerung_notiz}“</small>}
                  {r?.mitgeteilt_am && stKey !== 'bezahlt' && <small>mitgeteilt {datum(r.mitgeteilt_am)}</small>}
                  {alt && <button className="bh-link warn" onClick={() => aktualisieren(i)}><RefreshCw size={13} strokeWidth={2.4} /> Zahlen geändert: {dollar(i.live.auszahlung_usd)}</button>}
                </div>
                <div className="bh-aktion">
                  {stKey === 'entwurf' && <button className="bh-k bh-p" disabled={busy === 'bescheid'} onClick={() => bescheid([i])} title="Chatter sieht die Abrechnung und bekommt Telegram"><Send size={14} strokeWidth={2.4} /> Bescheid</button>}
                  {stKey !== 'bezahlt' && <button className="bh-k bh-gruen" disabled={b} onClick={() => bezahltOeffnen(i)}><Check size={14} strokeWidth={2.6} /> Bezahlt</button>}
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

      {bezahlt && createPortal(
        <div className="bh-ov" onClick={e => { if (e.target === e.currentTarget) setBezahlt(null) }}>
          <div className="bh-fenster">
            <div className="bh-fenster-kopf"><b>Bezahlt · {bezahlt.i.name}</b><button className="bh-x" onClick={() => setBezahlt(null)}><X size={18} /></button></div>
            <div className="bh-fenster-text">{bezahlt.i.p?.bezeichnung} · Gesamt {istManuell(bezahlt.i.row) ? geld(gesamt(bezahlt.i.row).wert, gesamt(bezahlt.i.row).waehrung) : euro(gesamtEur(anzeige(bezahlt.i)))}</div>
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

      {ansehen && <Ansehen a={ansehen} onZu={() => setAnsehen(null)} onKopieren={kopieren} onGespeichert={(t) => { setAnsehen(null); melde(t); lade() }} />}

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
function Ansehen({ a, onZu, onKopieren, onGespeichert }) {
  const [url, setUrl] = useState(null)
  const [betrag, setBetrag] = useState(a.betrag != null ? String(a.betrag).replace('.', ',') : '')
  const [iban, setIban] = useState(a.iban ? ibanSchoen(a.iban) : '')
  const [lesen, setLesen] = useState('')
  const [speichert, setSpeichert] = useState(false)
  useEffect(() => { let weg = false; signiert(a.url).then(u => { if (!weg) setUrl(u) }); return () => { weg = true } }, [a.url])
  const istBild = /\.(jpe?g|png|webp|gif|heic|heif)(\?|$)/i.test(a.name || a.url)
  const ausPdf = async () => {
    if (!a.row) return
    setLesen('liest')
    const g = await rechnungNeuLesen(a.row)
    if (g.leer) { setLesen(g.grund === 'foto' ? 'foto' : g.grund === 'scan' ? 'scan' : 'nichts'); return }
    if (g.betrag != null) setBetrag(String(g.betrag).replace('.', ','))
    if (g.iban) setIban(ibanSchoen(g.iban))
    setLesen(g.betrag != null ? 'ok' : 'ohne-summe')
  }
  // Fehlt der Betrag noch: beim Öffnen einmal automatisch aus der PDF lesen
  useEffect(() => { if (a.row && a.betrag == null && !istBild) ausPdf() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const b = zahlAus(betrag)
  const diff = b != null && a.gesamt != null ? Math.round((b - a.gesamt) * 100) / 100 : null
  const speichern = async () => {
    setSpeichert(true)
    const r = await rechnungsangabenSpeichern(a.row, { betrag, iban })
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
        {a.row && (
          <div className="bh-pruefen">
            <label className="bh-feld"><span>Betrag auf der Rechnung ({a.waehrung === 'USD' ? '$' : '€'})</span><input inputMode="decimal" value={betrag} placeholder="z. B. 447,48" onChange={e => setBetrag(e.target.value)} /></label>
            <label className="bh-feld bh-pruefen-iban"><span>IBAN</span><input value={iban} placeholder="DE…" onChange={e => setIban(e.target.value)} /></label>
            {iban.trim() && <button className="bh-k" onClick={() => onKopieren(iban)} title="IBAN kopieren"><Copy size={14} strokeWidth={2.2} /></button>}
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
            </div>
            <div className="bh-pruefen-knoepfe">
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
