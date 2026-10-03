import React, { useEffect, useRef, useState } from 'react'
import { Receipt, Upload, FileText, Clock, CircleCheck, MessageCircleWarning } from 'lucide-react'
import { STATUS, datum, datumZeit, abrechnungenLaden, rechnungHochladen } from '../buchhaltung'
import { oeffnen } from '../medien'

// ── Rechnungen im Chatter-Portal (v5.37.0 · v5.37.2) ───────────────────────
// v5.37.2: Nur noch hochladen — keine Beträge, kein PDF. Die Zahlen bekommt
// der Chatter per Telegram; hier legt er nur seine Rechnung ab, sie landet
// bei euch in der Buchhaltung.
// modus 'karte' (Startseite): Rechnung fehlt / Rückfrage → Upload-Knopf.
// modus 'liste' (Mehr):       welche Rechnung ist da, welche bezahlt.

export default function ChatterRechnungen({ displayName, isPreview, modus = 'karte' }) {
  const [liste, setListe] = useState(null)
  const [busy, setBusy] = useState(null)
  const [meldung, setMeldung] = useState({})
  const datei = useRef(null)
  const ziel = useRef(null)

  const lade = async () => {
    if (!displayName) { setListe([]); return }
    const { data, error } = await abrechnungenLaden(displayName)
    // nur mitgeteilte (in der Admin-Vorschau sieht man sonst Entwürfe)
    setListe(error ? [] : (data || []).filter(a => a.mitgeteilt_am))
  }
  useEffect(() => { lade() }, [displayName]) // eslint-disable-line react-hooks/exhaustive-deps

  const start = (a) => { if (isPreview) return; ziel.current = a; datei.current?.click() }
  const hoch = async (ev) => {
    const f = ev.target.files?.[0]; ev.target.value = ''
    const a = ziel.current; if (!f || !a) return
    setBusy(a.id); setMeldung(m => ({ ...m, [a.id]: '' }))
    const r = await rechnungHochladen(a, f)
    setBusy(null)
    if (r.error) { setMeldung(m => ({ ...m, [a.id]: 'Hat nicht geklappt: ' + r.error.message })); return }
    setMeldung(m => ({ ...m, [a.id]: 'Danke! Deine Rechnung ist angekommen.' }))
    lade()
  }

  if (!liste) return null
  const offen = liste.filter(a => a.status === 'offen' || a.status === 'klaerung')
  if (modus === 'karte' && !offen.length) return null
  if (modus === 'liste' && !liste.length) return null

  return (
    <div className={modus === 'karte' ? 'cr-karten' : 'cr-liste'}>
      <input ref={datei} type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={hoch} />

      {modus === 'karte' && offen.map(a => (
        <div key={a.id} className="cr-karte">
          <div className="cr-kopf">
            <span className="cr-ic"><Receipt size={18} strokeWidth={2.3} /></span>
            <div>
              <b>Rechnung für {a.bezeichnung || a.monat}</b>
              <span>{a.status === 'klaerung' ? 'Es gibt eine Rückfrage zu deiner Rechnung. Bitte lad eine neue hoch.' : 'Bitte lad hier deine Rechnung hoch.'}</span>
            </div>
          </div>
          {a.status === 'klaerung' && a.klaerung_notiz && (
            <div className="cr-klaerung"><MessageCircleWarning size={15} strokeWidth={2.3} /> {a.klaerung_notiz}</div>
          )}
          <button className="cr-hoch" disabled={isPreview || busy === a.id} onClick={() => start(a)}>
            <Upload size={17} strokeWidth={2.4} /> {busy === a.id ? 'Lädt hoch …' : a.status === 'klaerung' ? 'Neue Rechnung hochladen' : 'Rechnung hochladen'}
            <small>PDF oder Foto</small>
          </button>
          {meldung[a.id] && <div className="cr-meldung">{meldung[a.id]}</div>}
        </div>
      ))}

      {modus === 'liste' && (
        <div className="cr-box">
          <div className="cr-box-titel"><Receipt size={16} strokeWidth={2.3} /> Meine Rechnungen</div>
          {liste.map(a => {
            const st = STATUS[a.status] || STATUS.offen
            const Sym = a.status === 'bezahlt' ? CircleCheck : a.status === 'klaerung' ? MessageCircleWarning : a.status === 'rechnung' ? Clock : Upload
            return (
              <div key={a.id} className="cr-zeile">
                <span className="cr-st" style={{ color: st.farbe, background: st.bg }}><Sym size={13} strokeWidth={2.4} /> {a.status === 'bezahlt' ? `Bezahlt ${datum(a.bezahlt_am)}` : a.status === 'rechnung' ? 'Hochgeladen' : st.label}</span>
                <span className="cr-zeile-was">{a.bezeichnung || a.monat}<small>{a.rechnung_am ? `hochgeladen ${datumZeit(a.rechnung_am)}` : ''}{a.status === 'klaerung' && a.klaerung_notiz ? ` · „${a.klaerung_notiz}“` : ''}</small></span>
                <span className="cr-zeile-knoepfe">
                  {a.rechnung_url && <button title="Meine Rechnung öffnen" onClick={() => oeffnen(a.rechnung_url)}><FileText size={15} strokeWidth={2.2} /></button>}
                  {(a.status === 'offen' || a.status === 'klaerung' || a.status === 'rechnung') && !isPreview && <button title={a.rechnung_url ? 'Andere Datei hochladen' : 'Rechnung hochladen'} disabled={busy === a.id} onClick={() => start(a)}><Upload size={15} strokeWidth={2.2} /></button>}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
