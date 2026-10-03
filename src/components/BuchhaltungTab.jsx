import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Receipt, Send, Check, Upload, FileText, MessageCircleWarning, Undo2, Bell, X, Download, Plus, Trash2, RefreshCw, TriangleAlert, CircleCheck, FolderDown, FileSpreadsheet,
} from 'lucide-react'
import {
  STATUS, euro, dollar, datum, datumZeit, heuteIso, monatName, fehltTabelle, zahlAus,
  abrechnungenLaden, periode, zeitraumLaden, anzeige, veraltet, statusVon, extrasVon, gesamtEur,
  zeileSichern, extrasSpeichern, mitteilen, zahlenAktualisieren,
  rechnungHochladen, alsBezahlt, bezahltZurueck, klaerung, erinnern, abrechnungPdf, exportZip, exportCsv,
} from '../buchhaltung'
import { oeffnen } from '../medien'

// ── Buchhaltung (v5.37.0 · v5.37.1) ────────────────────────────────────────
// Verwaltung → Buchhaltung. Die Zahlen stehen automatisch drin (wie Billing).
// Pro Chatter: Anteil + Extras (z. B. Skripte, Bonus, Abzug) = Gesamt, daneben
// Rechnung da / fehlt und „Bezahlt“. Mit „Bescheid geben“ sieht der Chatter
// seine Abrechnung und bekommt Telegram; vorher ist alles euer Entwurf.

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
  const datei = useRef(null)
  const ziel = useRef(null)

  useEffect(() => { try { localStorage.setItem(SPEICHER, JSON.stringify({ modus, monat, von, bis })) } catch { /* egal */ } }, [modus, monat, von, bis])

  const p = useMemo(() => modus === 'offen' ? null : (modus === 'frei' && !(von && bis && von <= bis)) ? null : periode({ monat, von, bis, frei: modus === 'frei' }), [modus, monat, von, bis])

  const lade = async () => {
    if (modus === 'offen') {
      const { data, error } = await abrechnungenLaden()
      if (error) { setDaten({ fehler: fehltTabelle(error) ? 'Die Datenbank für die Buchhaltung fehlt noch: sql/buchhaltung.sql und sql/buchhaltung-entwurf.sql ausführen.' : error.message, items: [] }); return }
      const items = (data || []).filter(r => r.mitgeteilt_am && r.status !== 'bezahlt')
        .map(r => ({ name: r.chatter_name, row: r, live: null, telegram: null, p: { ab: r.von, ende: r.bis, bezug: r.monat, frei: r.frei, bezeichnung: r.bezeichnung } }))
      setDaten({ items }); return
    }
    if (!p) { setDaten({ items: [] }); return }
    const r = await zeitraumLaden(p)
    if (r.fehler) { setDaten({ fehler: r.fehler, items: [] }); return }
    setDaten({ ...r, items: r.items.map(i => ({ ...i, p })) })
  }
  useEffect(() => { setDaten(null); lade() }, [modus, p?.ab, p?.ende]) // eslint-disable-line react-hooks/exhaustive-deps

  const items = daten?.items || []
  const statusZahl = (st) => items.filter(i => statusVon(i.row) === st).length
  const sichtbar = items.filter(i => filter === 'alle' || statusVon(i.row) === filter)
  const summe = (l) => l.reduce((t, i) => t + (gesamtEur(anzeige(i)) || 0), 0)
  const entwuerfe = items.filter(i => statusVon(i.row) === 'entwurf')
  const fehlen = items.filter(i => statusVon(i.row) === 'offen')
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
    setBusy(i.name)
    const row = await sichern(i)
    if (!row) { setBusy(null); return }
    const r = await rechnungHochladen(row, f, { durchAdmin: true })
    setBusy(null)
    if (r.error) { alert('Rechnung NICHT hochgeladen: ' + r.error.message); return }
    melde(`Rechnung für ${i.name} hochgeladen.`); lade()
  }
  const bezahltOeffnen = (i) => {
    const a = anzeige(i)
    setBezahlt({ i, am: heuteIso(), betrag: String(i.row?.rechnung_betrag ?? gesamtEur(a) ?? '').replace('.', ',') })
  }
  const bezahltSpeichern = async () => {
    const { i, am, betrag } = bezahlt
    setBusy(i.name)
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
    setBusy(i.name)
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
    setBusy(i.name)
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
            <Kpi farbe="#e5e7eb" wert={euro(summe(items))} label={`Gesamt · ${items.length} Chatter`} />
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
          <div className="bh-tkopf"><span>Chatter</span><span>Umsatz</span><span>Anteil</span><span>Extras</span><span>Gesamt</span><span>Rechnung</span><span>Status</span><span /></div>
          {sichtbar.map(i => {
            const a = anzeige(i)
            const stKey = statusVon(i.row)
            const st = STATUS[stKey]
            const g = gesamtEur(a)
            const r = i.row
            const abw = r?.rechnung_betrag != null && g != null && Math.abs(Number(r.rechnung_betrag) - g) >= 0.01
            const b = busy === i.name
            const alt = veraltet(i)
            return (
              <div key={i.name + (r?.id || '')} className="bh-zeile" style={{ borderLeftColor: st.farbe }}>
                <div className="bh-wer"><b>{i.name}</b>{modus === 'offen' && <span>{r?.bezeichnung}</span>}</div>
                <div className="bh-zahl"><span className="bh-mobil">Umsatz</span>{dollar(a.nur_chat === false ? a.umsatz_gesamt_usd : a.umsatz_chat_usd)}<small>{a.prozent != null ? `${String(a.prozent).replace('.', ',')} % ${a.nur_chat === false ? 'gesamt' : 'Chat'}` : ''}</small></div>
                <div className="bh-zahl"><span className="bh-mobil">Anteil</span>{a.betrag_eur != null ? euro(a.betrag_eur) : dollar(a.auszahlung_usd)}<small>{a.betrag_eur != null ? dollar(a.auszahlung_usd) : 'Kurs fehlt'}</small></div>
                <div className="bh-extras">
                  {extrasVon(r).map((e, n) => <span key={n} className={'bh-extra' + (Number(e.betrag) < 0 ? ' minus' : '')} title={e.text}>{Number(e.betrag) < 0 ? '−' : '+'}{euro(Math.abs(e.betrag))} <em>{e.text}</em></span>)}
                  {stKey !== 'bezahlt' && <button className="bh-plus" onClick={() => setExtras({ i, liste: extrasVon(r).length ? extrasVon(r).map(e => ({ text: e.text, betrag: String(e.betrag).replace('.', ',') })) : [{ text: '', betrag: '' }] })}><Plus size={13} strokeWidth={2.6} /> {extrasVon(r).length ? 'ändern' : 'Extra'}</button>}
                </div>
                <div className="bh-gesamt"><span className="bh-mobil">Gesamt</span>{g != null ? euro(g) : '—'}</div>
                <div className="bh-rechnung">
                  {r?.rechnung_url ? (
                    <>
                      <button className="bh-link" onClick={() => oeffnen(r.rechnung_url)}><FileText size={14} strokeWidth={2.2} /> {r.rechnung_name || 'Rechnung'}</button>
                      <small>{r.rechnung_von && r.rechnung_von !== i.name ? `von ${r.rechnung_von} · ` : ''}{datumZeit(r.rechnung_am)}{r.rechnung_betrag != null && <span style={{ color: abw ? '#f59e0b' : undefined }}> · {euro(r.rechnung_betrag)}{abw ? ' ≠ Gesamt' : ''}</span>}</small>
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
                  {stKey === 'rechnung' && <button className="bh-k" disabled={b} onClick={() => setKlaer({ i, notiz: r.klaerung_notiz || '' })} title="Rückfrage an den Chatter"><MessageCircleWarning size={14} strokeWidth={2.2} /></button>}
                  {stKey === 'offen' && <button className="bh-k" disabled={busy === 'erinnern'} onClick={() => erinnereAlle([i])} title="Per Telegram erinnern"><Bell size={14} strokeWidth={2.2} /></button>}
                  {stKey !== 'bezahlt' && <button className="bh-k" disabled={b} onClick={() => hochladenStart(i)} title={r?.rechnung_url ? 'Andere Rechnung hochladen' : 'Rechnung selbst hochladen (per Mail bekommen, Chatter nicht mehr aktiv …)'}><Upload size={14} strokeWidth={2.2} />{b ? '…' : ''}</button>}
                  {stKey === 'bezahlt' && <button className="bh-k" onClick={() => zurueck(i)} title="Bezahlt rückgängig"><Undo2 size={14} strokeWidth={2.2} /></button>}
                  <button className="bh-k" onClick={() => abrechnungPdf(a)} title="Abrechnung als PDF"><Download size={14} strokeWidth={2.2} /></button>
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
            <div className="bh-fenster-text">{bezahlt.i.p?.bezeichnung} · Gesamt {euro(gesamtEur(anzeige(bezahlt.i)))}</div>
            <label className="bh-feld"><span>Überwiesen am</span><input type="date" value={bezahlt.am} onChange={e => setBezahlt({ ...bezahlt, am: e.target.value })} /></label>
            <label className="bh-feld"><span>Betrag (€)</span><input inputMode="decimal" value={bezahlt.betrag} onChange={e => setBezahlt({ ...bezahlt, betrag: e.target.value })} /></label>
            <div className="bh-fenster-text">Nur für euch intern — der Chatter bekommt keine Nachricht.</div>
            <div className="bh-fenster-fuss"><button className="bh-k" onClick={() => setBezahlt(null)}>Abbrechen</button><button className="bh-k bh-gruen" disabled={busy === bezahlt.i.name || !bezahlt.am} onClick={bezahltSpeichern}><Check size={14} strokeWidth={2.6} /> Speichern</button></div>
          </div>
        </div>, document.body)}

      {klaer && createPortal(
        <div className="bh-ov" onClick={e => { if (e.target === e.currentTarget) setKlaer(null) }}>
          <div className="bh-fenster">
            <div className="bh-fenster-kopf"><b>Rückfrage an {klaer.i.name}</b><button className="bh-x" onClick={() => setKlaer(null)}><X size={18} /></button></div>
            <div className="bh-fenster-text">Geht per Telegram raus und steht bei ihm im Portal. Er kann danach eine neue Rechnung hochladen.</div>
            <textarea className="bh-text" rows={3} autoFocus placeholder="z. B. Bitte Steuernummer ergänzen" value={klaer.notiz} onChange={e => setKlaer({ ...klaer, notiz: e.target.value })} />
            <div className="bh-fenster-fuss"><button className="bh-k" onClick={() => setKlaer(null)}>Abbrechen</button><button className="bh-k bh-p" disabled={busy === klaer.i.name || !klaer.notiz.trim()} onClick={klaerSenden}><Send size={14} strokeWidth={2.4} /> Senden</button></div>
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
            <div className="bh-fenster-text">Kommt zum Anteil dazu, z. B. Skripte, Bonus, Vorschuss. Abzug mit Minus (−50).</div>
            {extras.liste.map((e, n) => (
              <div key={n} className="bh-extra-zeile">
                <input placeholder="wofür, z. B. Skripte September" value={e.text} onChange={ev => setExtras({ ...extras, liste: extras.liste.map((x, j) => j === n ? { ...x, text: ev.target.value } : x) })} />
                <input inputMode="decimal" placeholder="€" value={e.betrag} onChange={ev => setExtras({ ...extras, liste: extras.liste.map((x, j) => j === n ? { ...x, betrag: ev.target.value } : x) })} />
                <button className="bh-x" onClick={() => setExtras({ ...extras, liste: extras.liste.filter((_, j) => j !== n) })} title="Weg"><Trash2 size={15} /></button>
              </div>
            ))}
            <button className="bh-link" onClick={() => setExtras({ ...extras, liste: [...extras.liste, { text: '', betrag: '' }] })}><Plus size={14} strokeWidth={2.6} /> Weiteres Extra</button>
            <div className="bh-fenster-text">
              Anteil {euro(anzeige(extras.i).betrag_eur)} + Extras {euro(extras.liste.reduce((t, e) => t + (zahlAus(e.betrag) || 0), 0))} = <b style={{ color: '#34d399' }}>{euro((Number(anzeige(extras.i).betrag_eur) || 0) + extras.liste.reduce((t, e) => t + (zahlAus(e.betrag) || 0), 0))}</b>
            </div>
            <div className="bh-fenster-fuss"><button className="bh-k" onClick={() => setExtras(null)}>Abbrechen</button><button className="bh-k bh-p" disabled={busy === extras.i.name} onClick={extrasSpeichernKlick}><Check size={14} strokeWidth={2.6} /> Speichern</button></div>
          </div>
        </div>, document.body)}
    </div>
  )
}

function Kpi({ wert, sub, label, farbe }) {
  return <div className="bh-kpi"><div style={{ color: farbe }}>{wert}{sub ? <small>{sub}</small> : null}</div><span>{label}</span></div>
}
