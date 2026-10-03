import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Receipt, Send, Check, Upload, FileText, MessageCircleWarning, Undo2, Bell, X, Download, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import {
  STATUS, euro, dollar, datum, datumZeit, heuteIso, monatName, fehltTabelle,
  abrechnungenLaden, vorschauRechnen, freigeben, rechnungHochladen, alsBezahlt, bezahltZurueck,
  klaerung, erinnern, zurueckziehen, abrechnungPdf,
} from '../buchhaltung'
import { oeffnen } from '../medien'

// ── Buchhaltung (v5.37.0) ──────────────────────────────────────────────────
// Verwaltung → Buchhaltung. Abrechnung freigeben → Chatter lädt Rechnung hoch
// → „Bezahlt“ mit Datum. Rechnet wie Billing (gleiche Funktionen).
// Für ehemalige Chatter oder wenn jemand per Mail schickt: „Selbst hochladen“.

const letzteMonate = (n = 6) => {
  const out = []; const d = new Date()
  for (let i = 0; i < n; i++) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0')) }
  return out
}
const vorMonat = () => letzteMonate(2)[1]

export default function BuchhaltungTab({ userDisplayName }) {
  const [liste, setListe] = useState(null)
  const [fehler, setFehler] = useState('')
  const [ansicht, setAnsicht] = useState('offen')       // 'offen' | 'alle' | 'von|bis'
  const [filter, setFilter] = useState('alle')          // Status
  const [meldung, setMeldung] = useState('')
  const [busy, setBusy] = useState(null)
  const [bezahlt, setBezahlt] = useState(null)          // { a, am, betrag, telegram }
  const [klaer, setKlaer] = useState(null)              // { a, notiz }
  const [freigabe, setFreigabe] = useState(false)
  const datei = useRef(null)
  const ziel = useRef(null)

  const lade = async () => {
    const { data, error } = await abrechnungenLaden()
    if (error) { setFehler(fehltTabelle(error) ? 'Die Datenbank für die Buchhaltung fehlt noch: einmal sql/buchhaltung.sql in Supabase ausführen.' : error.message); setListe([]); return }
    setFehler(''); setListe(data || [])
  }
  useEffect(() => { lade() }, [])

  const zeitraeume = useMemo(() => {
    const m = new Map()
    for (const a of liste || []) { const k = `${a.von}|${a.bis}`; if (!m.has(k)) m.set(k, a.bezeichnung || `${datum(a.von)}–${datum(a.bis)}`) }
    return [...m.entries()]
  }, [liste])

  const inAnsicht = useMemo(() => (liste || []).filter(a =>
    ansicht === 'alle' ? true : ansicht === 'offen' ? a.status !== 'bezahlt' : `${a.von}|${a.bis}` === ansicht), [liste, ansicht])
  const sichtbar = inAnsicht.filter(a => filter === 'alle' || a.status === filter)
  const zahl = (st) => inAnsicht.filter(a => a.status === st)
  const summe = (l, f) => l.reduce((t, a) => t + Number(f(a) || 0), 0)
  const fehlen = zahl('offen')

  const melde = (t) => { setMeldung(t); if (t) setTimeout(() => setMeldung(m => (m === t ? '' : m)), 6000) }

  // ── Aktionen ─────────────────────────────────────────────────────────────
  const hochladenStart = (a) => { ziel.current = a; datei.current?.click() }
  const hochladen = async (ev) => {
    const f = ev.target.files?.[0]; ev.target.value = ''
    const a = ziel.current; if (!f || !a) return
    setBusy(a.id)
    const r = await rechnungHochladen(a, f, { durchAdmin: true, wer: userDisplayName })
    setBusy(null)
    if (r.error) { alert('Rechnung NICHT hochgeladen: ' + r.error.message); return }
    melde(`Rechnung für ${a.chatter_name} hochgeladen.`); lade()
  }
  const bezahltSpeichern = async () => {
    const { a, am, betrag, telegram } = bezahlt
    setBusy(a.id)
    const r = await alsBezahlt(a, { am, betrag, telegram })
    setBusy(null)
    if (r.error) { alert('Nicht gespeichert: ' + r.error.message); return }
    setBezahlt(null); melde(`${a.chatter_name}: bezahlt am ${datum(am)}${r.info ? ' · ' + r.info : ''}`); lade()
  }
  const zurueck = async (a) => {
    if (!confirm(`„Bezahlt“ bei ${a.chatter_name} wieder entfernen?`)) return
    const { error } = await bezahltZurueck(a)
    if (error) { alert(error.message); return }
    lade()
  }
  const klaerSenden = async () => {
    const { a, notiz } = klaer
    if (!notiz.trim()) return
    setBusy(a.id)
    const r = await klaerung(a, notiz)
    setBusy(null)
    if (r.error) { alert('Nicht gespeichert: ' + r.error.message); return }
    setKlaer(null); melde(`${a.chatter_name}: Rückfrage gespeichert${r.info ? ' · ' + r.info : ''}`); lade()
  }
  const erinnereAlle = async (l) => {
    if (!l.length) return
    if (!confirm(l.length === 1 ? `${l[0].chatter_name} per Telegram an die Rechnung erinnern?` : `${l.length} Chatter per Telegram an die Rechnung erinnern?`)) return
    setBusy('erinnern')
    const r = await erinnern(l)
    setBusy(null)
    melde(`${r.gesendet} erinnert${r.ohne ? ` · ${r.ohne} ohne Telegram-ID` : ''}`); lade()
  }
  const loeschen = async (a) => {
    if (!confirm(`Abrechnung ${a.bezeichnung || ''} für ${a.chatter_name} zurückziehen?\n\nDer Chatter sieht sie dann nicht mehr.`)) return
    const { error } = await zurueckziehen(a)
    if (error) { alert(error.message); return }
    lade()
  }

  if (liste === null) return <div className="bh-leer">Lädt …</div>

  return (
    <div className="bh">
      <input ref={datei} type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={hochladen} />

      <div className="bh-kopf">
        <div className="bh-titel"><span className="bh-titel-ic"><Receipt size={18} strokeWidth={2.4} /></span><b>Buchhaltung</b></div>
        <select className="bh-sel" value={ansicht} onChange={e => { setAnsicht(e.target.value); setFilter('alle') }}>
          <option value="offen">Alles Offene</option>
          {zeitraeume.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          <option value="alle">Alles (auch bezahlt)</option>
        </select>
        <div className="bh-kopf-rechts">
          {fehlen.length > 0 && <button className="bh-k" disabled={busy === 'erinnern'} onClick={() => erinnereAlle(fehlen)}><Bell size={14} strokeWidth={2.4} /> Alle erinnern ({fehlen.length})</button>}
          <button className="bh-k bh-p" onClick={() => setFreigabe(v => !v)}>{freigabe ? <ChevronUp size={15} /> : <Send size={14} strokeWidth={2.4} />} Abrechnung freigeben</button>
        </div>
      </div>

      {fehler && <div className="bh-warn">{fehler}</div>}
      {meldung && <div className="bh-ok"><Check size={15} strokeWidth={2.6} /> {meldung}</div>}

      {freigabe && <Freigabe wer={userDisplayName} onFertig={(t) => { setFreigabe(false); melde(t); lade() }} />}

      <div className="bh-kpis">
        <Kpi farbe={STATUS.offen.farbe} wert={zahl('offen').length} label="Rechnung fehlt" />
        <Kpi farbe={STATUS.rechnung.farbe} wert={zahl('rechnung').length} sub={euro(summe(zahl('rechnung'), a => a.rechnung_betrag ?? a.betrag_eur))} label="Rechnung da · zu bezahlen" />
        <Kpi farbe={STATUS.klaerung.farbe} wert={zahl('klaerung').length} label="Klärung" />
        <Kpi farbe={STATUS.bezahlt.farbe} wert={zahl('bezahlt').length} sub={euro(summe(zahl('bezahlt'), a => a.bezahlt_betrag ?? a.betrag_eur))} label="Bezahlt" />
      </div>

      <div className="bh-chips">
        {[['alle', `Alle ${inAnsicht.length}`], ['offen', 'Rechnung fehlt'], ['rechnung', 'Zu bezahlen'], ['klaerung', 'Klärung'], ['bezahlt', 'Bezahlt']].map(([k, t]) => (
          <button key={k} className={'bh-chip' + (filter === k ? ' an' : '')} onClick={() => setFilter(k)}>{t}{k !== 'alle' && zahl(k).length ? ` · ${zahl(k).length}` : ''}</button>
        ))}
      </div>

      {!sichtbar.length && !fehler && (
        <div className="bh-leer">{liste.length ? 'Hier ist nichts.' : 'Noch keine Abrechnung freigegeben. Oben auf „Abrechnung freigeben“ — dann bekommen die Chatter Bescheid.'}</div>
      )}

      <div className="bh-liste">
        {sichtbar.map(a => {
          const st = STATUS[a.status] || STATUS.offen
          const abw = a.rechnung_betrag != null && a.betrag_eur != null && Math.abs(Number(a.rechnung_betrag) - Number(a.betrag_eur)) >= 0.01
          const b = busy === a.id
          return (
            <div key={a.id} className="bh-zeile" style={{ borderLeftColor: st.farbe }}>
              <div className="bh-wer">
                <b>{a.chatter_name}</b>
                <span>{a.bezeichnung || `${datum(a.von)}–${datum(a.bis)}`}{a.frei ? <em className="bh-tag">Zeitraum</em> : null}</span>
              </div>
              <div className="bh-betrag">
                <b>{a.betrag_eur != null ? euro(a.betrag_eur) : dollar(a.auszahlung_usd)}</b>
                <span>{a.prozent != null ? `${String(a.prozent).replace('.', ',')} % von ${dollar(a.basis_usd)}` : ''}{a.betrag_eur == null ? ' · Kurs fehlte' : ''}</span>
              </div>
              <div className="bh-rechnung">
                {a.rechnung_url ? (
                  <>
                    <button className="bh-link" onClick={() => oeffnen(a.rechnung_url)}><FileText size={14} strokeWidth={2.2} /> {a.rechnung_name || 'Rechnung'}</button>
                    <span>{a.rechnung_von && a.rechnung_von !== a.chatter_name ? `von ${a.rechnung_von} · ` : ''}hochgeladen {datumZeit(a.rechnung_am)}{a.rechnung_betrag != null ? ' · ' : ''}{a.rechnung_betrag != null && <span style={{ color: abw ? '#f59e0b' : undefined }}>{euro(a.rechnung_betrag)}{abw ? ' ≠ Dashboard' : ''}</span>}</span>
                  </>
                ) : (
                  <span>noch keine · freigegeben {datum(a.freigegeben_am)}{a.erinnert_am ? ` · erinnert ${datum(a.erinnert_am)}` : ''}</span>
                )}
              </div>
              <div className="bh-status">
                <span className="bh-st" style={{ color: st.farbe, background: st.bg }}>{a.status === 'bezahlt' ? `Bezahlt ${datum(a.bezahlt_am)}` : st.label}</span>
                {a.status === 'bezahlt' && <span>{a.bezahlt_betrag != null ? euro(a.bezahlt_betrag) + ' · ' : ''}{a.bezahlt_von || ''}</span>}
                {a.status === 'klaerung' && a.klaerung_notiz && <span className="bh-notiz">„{a.klaerung_notiz}“</span>}
              </div>
              <div className="bh-aktion">
                {a.status !== 'bezahlt' && (
                  <button className="bh-k bh-gruen" disabled={b} onClick={() => setBezahlt({ a, am: heuteIso(), betrag: String(a.rechnung_betrag ?? a.betrag_eur ?? '').replace('.', ','), telegram: true })}><Check size={14} strokeWidth={2.6} /> Bezahlt</button>
                )}
                {a.status === 'rechnung' && <button className="bh-k" disabled={b} onClick={() => setKlaer({ a, notiz: a.klaerung_notiz || '' })}><MessageCircleWarning size={14} strokeWidth={2.2} /> Klärung</button>}
                {a.status === 'offen' && <button className="bh-k" disabled={b || busy === 'erinnern'} onClick={() => erinnereAlle([a])}><Bell size={14} strokeWidth={2.2} /> Erinnern</button>}
                {a.status !== 'bezahlt' && <button className="bh-k" disabled={b} onClick={() => hochladenStart(a)} title="Rechnung selbst hochladen (z. B. per Mail bekommen oder Chatter nicht mehr aktiv)"><Upload size={14} strokeWidth={2.2} /> {b ? '…' : a.rechnung_url ? 'Neue Datei' : 'Selbst hochladen'}</button>}
                {a.status === 'bezahlt' && <button className="bh-k" onClick={() => zurueck(a)} title="Bezahlt rückgängig"><Undo2 size={14} strokeWidth={2.2} /></button>}
                <button className="bh-k" onClick={() => abrechnungPdf(a)} title="Abrechnung als PDF"><Download size={14} strokeWidth={2.2} /></button>
                {a.status === 'offen' && !a.rechnung_url && <button className="bh-k bh-leise" onClick={() => loeschen(a)} title="Abrechnung zurückziehen"><Trash2 size={14} strokeWidth={2.2} /></button>}
              </div>
            </div>
          )
        })}
      </div>

      {bezahlt && createPortal(
        <div className="bh-ov" onClick={e => { if (e.target === e.currentTarget) setBezahlt(null) }}>
          <div className="bh-fenster">
            <div className="bh-fenster-kopf"><b>Bezahlt · {bezahlt.a.chatter_name}</b><button className="bh-x" onClick={() => setBezahlt(null)}><X size={18} /></button></div>
            <div className="bh-fenster-text">{bezahlt.a.bezeichnung} · laut Dashboard {euro(bezahlt.a.betrag_eur)}</div>
            <label className="bh-feld"><span>Überwiesen am</span><input type="date" value={bezahlt.am} onChange={e => setBezahlt({ ...bezahlt, am: e.target.value })} /></label>
            <label className="bh-feld"><span>Betrag (€)</span><input inputMode="decimal" value={bezahlt.betrag} onChange={e => setBezahlt({ ...bezahlt, betrag: e.target.value })} /></label>
            <label className="bh-haken"><input type="checkbox" checked={bezahlt.telegram} onChange={e => setBezahlt({ ...bezahlt, telegram: e.target.checked })} /> Chatter per Telegram Bescheid geben</label>
            <div className="bh-fenster-fuss"><button className="bh-k" onClick={() => setBezahlt(null)}>Abbrechen</button><button className="bh-k bh-gruen" disabled={busy === bezahlt.a.id || !bezahlt.am} onClick={bezahltSpeichern}><Check size={14} strokeWidth={2.6} /> Speichern</button></div>
          </div>
        </div>, document.body)}

      {klaer && createPortal(
        <div className="bh-ov" onClick={e => { if (e.target === e.currentTarget) setKlaer(null) }}>
          <div className="bh-fenster">
            <div className="bh-fenster-kopf"><b>Rückfrage an {klaer.a.chatter_name}</b><button className="bh-x" onClick={() => setKlaer(null)}><X size={18} /></button></div>
            <div className="bh-fenster-text">Geht per Telegram raus und steht bei ihm im Portal. Er kann danach eine neue Rechnung hochladen.</div>
            <textarea className="bh-text" rows={3} autoFocus placeholder="z. B. Bitte Steuernummer ergänzen" value={klaer.notiz} onChange={e => setKlaer({ ...klaer, notiz: e.target.value })} />
            <div className="bh-fenster-fuss"><button className="bh-k" onClick={() => setKlaer(null)}>Abbrechen</button><button className="bh-k bh-p" disabled={busy === klaer.a.id || !klaer.notiz.trim()} onClick={klaerSenden}><Send size={14} strokeWidth={2.4} /> Senden</button></div>
          </div>
        </div>, document.body)}
    </div>
  )
}

function Kpi({ wert, sub, label, farbe }) {
  return <div className="bh-kpi"><div style={{ color: farbe }}>{wert}{sub && <small>{sub}</small>}</div><span>{label}</span></div>
}

// ── Freigabe: Zeitraum wählen, Vorschau, an wen ────────────────────────────
function Freigabe({ wer, onFertig }) {
  const [frei, setFrei] = useState(false)
  const [monat, setMonat] = useState(vorMonat())
  const [von, setVon] = useState(''); const [bis, setBis] = useState('')
  const [v, setV] = useState(null)
  const [auswahl, setAuswahl] = useState(new Set())
  const [telegram, setTelegram] = useState(true)
  const [laeuft, setLaeuft] = useState(false)
  const [zu, setZu] = useState(false)

  useEffect(() => {
    let weg = false
    if (frei && !(von && bis && von <= bis)) { setV(null); return }
    setV('laedt')
    vorschauRechnen({ monat, von, bis, frei }).then(r => {
      if (weg) return
      setV(r)
      setAuswahl(new Set((r.zeilen || []).filter(z => !z.schon).map(z => z.name)))
    })
    return () => { weg = true }
  }, [frei, monat, von, bis])

  const los = async () => {
    const n = [...auswahl].length
    if (!n) return
    if (!confirm(`Abrechnung für ${n} Chatter freigeben${telegram ? ' und per Telegram Bescheid geben' : ''}?`)) return
    setLaeuft(true)
    const r = await freigeben({ vorschau: v, auswahl, frei, wer, telegram })
    setLaeuft(false)
    if (r.error) { alert('Nicht freigegeben: ' + r.error.message); return }
    onFertig(`${r.anzahl} Abrechnung${r.anzahl === 1 ? '' : 'en'} freigegeben${telegram ? ` · ${r.gesendet} per Telegram` : ''}.`)
  }

  const zeilen = v && v !== 'laedt' ? (v.zeilen || []) : []
  const neu = zeilen.filter(z => !z.schon)
  const summeEur = v && v.kurs ? neu.filter(z => auswahl.has(z.name)).reduce((t, z) => t + z.x.auszahlung * v.kurs, 0) : null

  return (
    <div className="bh-freigabe">
      <div className="bh-freigabe-kopf">
        <div className="bh-umschalter">
          <button className={!frei ? 'an' : ''} onClick={() => setFrei(false)}>Monat</button>
          <button className={frei ? 'an' : ''} onClick={() => setFrei(true)}>Zeitraum</button>
        </div>
        {!frei ? (
          <select className="bh-sel" value={monat} onChange={e => setMonat(e.target.value)}>
            {letzteMonate(6).map(m => <option key={m} value={m}>{monatName(m)}</option>)}
          </select>
        ) : (
          <div className="bh-datum"><input type="date" value={von} onChange={e => setVon(e.target.value)} /><span>bis</span><input type="date" value={bis} onChange={e => setBis(e.target.value)} /></div>
        )}
      </div>
      {v === 'laedt' && <div className="bh-leer">Rechnet …</div>}
      {v && v.fehler && <div className="bh-warn">{v.fehler}</div>}
      {v && v !== 'laedt' && !v.fehler && (
        <>
          <div className="bh-freigabe-info">
            {v.tage} Tag{v.tage === 1 ? '' : 'e'} mit Daten · {v.kurs ? `Kurs 1 $ = ${String(v.kurs).replace('.', ',')} €` : <b style={{ color: '#f59e0b' }}>Kein Euro-Kurs für {monatName(v.bezug)} — erst in Billing eintragen, sonst steht nur der $-Betrag drin</b>}
          </div>
          {!zeilen.length && <div className="bh-leer">Für diesen Zeitraum hat niemand eine Auszahlung (oder es fehlt der Satz in Billing).</div>}
          {zeilen.length > 0 && (
            <div className="bh-vorschau">
              {(zu ? zeilen : zeilen.slice(0, 12)).map(z => (
                <label key={z.name} className={'bh-vz' + (z.schon ? ' schon' : '')}>
                  <input type="checkbox" disabled={z.schon} checked={z.schon || auswahl.has(z.name)} onChange={e => { const n = new Set(auswahl); e.target.checked ? n.add(z.name) : n.delete(z.name); setAuswahl(n) }} />
                  <b>{z.name}</b>
                  <span>{dollar(z.x.auszahlung)}</span>
                  <span className="bh-vz-eur">{v.kurs ? euro(z.x.auszahlung * v.kurs) : ''}</span>
                  <em>{z.schon ? 'schon freigegeben' : !z.telegram ? 'keine Telegram-ID' : ''}</em>
                </label>
              ))}
              {zeilen.length > 12 && <button className="bh-link" onClick={() => setZu(x => !x)}>{zu ? <><ChevronUp size={14} /> weniger</> : <><ChevronDown size={14} /> alle {zeilen.length} zeigen</>}</button>}
            </div>
          )}
          {neu.length > 0 && (
            <div className="bh-freigabe-fuss">
              <label className="bh-haken"><input type="checkbox" checked={telegram} onChange={e => setTelegram(e.target.checked)} /> Per Telegram Bescheid geben (Abrechnung + „bitte Rechnung hochladen“)</label>
              <button className="bh-k bh-p" disabled={laeuft || !auswahl.size} onClick={los}><Send size={14} strokeWidth={2.4} /> {laeuft ? 'Läuft …' : `${auswahl.size} freigeben${summeEur != null ? ` · ${euro(summeEur)}` : ''}`}</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
