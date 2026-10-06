import React, { useEffect, useRef, useState } from 'react'
import { Receipt, Upload, FileText, Clock, CircleCheck, MessageCircleWarning } from 'lucide-react'
import { STATUS, datum, datumZeit, monatName, abrechnungenLaden, rechnungHochladen, meineZeile } from '../buchhaltung'
import { oeffnen } from '../medien'
import { supabase } from '../supabase'

// ── Rechnungen im Chatter-Portal (v5.37.0 · v5.37.2 · v5.39.0) ──────────────
// v5.39.0: Kein „Bescheid“ mehr nötig. Der Chatter hat immer einen Knopf
// „Rechnung hochladen“ (Monat wählen → Datei). Keine Beträge, kein PDF.
// modus 'karte' (Startseite): in den ersten 15 Tagen des Monats, solange die
//                             Rechnung für den Vormonat fehlt — oder bei Rückfrage.
// modus 'liste' (Mehr):       immer: Upload-Knopf + welche Rechnung ist da/bezahlt.
// v5.43.0: Gemeinsame Rechnung (z. B. Alessia & Pascal): Hinweis „einer von euch
// reicht“; hat der Partner schon hochgeladen, steht das da statt der Erinnerung.

const monate = (n) => {
  const d = new Date(); const out = []
  for (let i = 1; i <= n; i++) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0')) }
  return out
}
const tagHeute = () => Number(new Date().toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: 'numeric' }))

export default function ChatterRechnungen({ displayName, isPreview, modus = 'karte' }) {
  const [liste, setListe] = useState(null)
  const [busy, setBusy] = useState(null)
  const [meldung, setMeldung] = useState({})
  const [monat, setMonat] = useState(monate(1)[0])   // Vormonat
  const [gruppe, setGruppe] = useState(null)         // v5.43.0: { name, mitglieder, rechnungen: [{ wer, monat, status, rechnung_am }] }
  const datei = useRef(null)
  const ziel = useRef(null)                          // { row } oder { monat }

  const lade = async () => {
    if (!displayName) { setListe([]); return }
    const { data, error } = await abrechnungenLaden(displayName)
    setListe(error ? [] : (data || []).filter(a => !a.art || a.art === 'chatter'))
    const g = await supabase.rpc('meine_rechnungsgruppe').then(r => r.error ? null : r.data).catch(() => null)
    setGruppe(g && g.name ? g : null)
  }
  useEffect(() => { lade() }, [displayName]) // eslint-disable-line react-hooks/exhaustive-deps

  const start = (z) => { if (isPreview) return; ziel.current = z; datei.current?.click() }
  const hoch = async (ev) => {
    const f = ev.target.files?.[0]; ev.target.value = ''
    const z = ziel.current; if (!f || !z) return
    const k = z.row ? z.row.id : 'm-' + z.monat
    setBusy(k); setMeldung(m => ({ ...m, [k]: '' }))
    let row = z.row
    if (!row) {
      const r = await meineZeile(displayName, z.monat)
      if (r.error) { setBusy(null); setMeldung(m => ({ ...m, [k]: 'Hat nicht geklappt: ' + r.error.message })); return }
      row = r.row
    }
    const r = await rechnungHochladen(row, f)
    setBusy(null)
    if (r.error) { setMeldung(m => ({ ...m, [k]: 'Hat nicht geklappt: ' + r.error.message })); return }
    setMeldung(m => ({ ...m, [k]: 'Danke! Deine Rechnung ist angekommen.' }))
    lade()
  }

  if (!liste) return null
  const zeileVon = (m) => liste.find(a => a.monat === m && !a.frei)
  // Partner aus der Gruppe hat für diesen Monat schon hochgeladen (neueste zuerst)
  const partnerVon = (m) => (gruppe?.rechnungen || []).filter(r => r.monat === m && r.rechnung_am).sort((a, b) => String(b.rechnung_am).localeCompare(String(a.rechnung_am)))[0] || null
  const gruppenText = gruppe ? `Ihr schreibt eine gemeinsame Rechnung (${gruppe.name}). Einer von euch lädt sie hoch – das reicht.` : ''
  const input = <input ref={datei} type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={hoch} />

  // ── Startseite: nur wenn es etwas zu tun gibt ──────────────────────────────
  if (modus === 'karte') {
    const vormonat = monate(1)[0]
    const vm = zeileVon(vormonat)
    // Rückfrage erledigt, wenn der Partner danach eine neue gemeinsame Rechnung hochgeladen hat
    const karten = liste.filter(a => a.status === 'klaerung' && !(partnerVon(a.monat) && String(partnerVon(a.monat).rechnung_am) > String(a.klaerung_am || '')))
      .map(a => ({ row: a, monat: a.monat, titel: a.bezeichnung || monatName(a.monat), klaerung: true }))
    if (tagHeute() <= 15 && !(vm && (vm.rechnung_url || vm.status === 'bezahlt')) && !karten.some(k => k.monat === vormonat)) {
      const p = partnerVon(vormonat)
      karten.unshift({ row: vm || null, monat: vormonat, titel: monatName(vormonat), klaerung: false, partner: p })
    }
    if (!karten.length) return null
    return (
      <div className="cr-karten">
        {input}
        {karten.map(k => {
          const key = k.row ? k.row.id : 'm-' + k.monat
          return (
            <div key={key} className="cr-karte">
              <div className="cr-kopf">
                <span className="cr-ic"><Receipt size={18} strokeWidth={2.3} /></span>
                <div>
                  <b>Rechnung für {k.titel}</b>
                  <span>{k.klaerung ? 'Es gibt eine Rückfrage zu deiner Rechnung. Bitte lad eine neue hoch.' : k.partner ? '' : gruppe ? gruppenText : 'Hier kannst du deine Rechnung hochladen.'}</span>
                </div>
              </div>
              {k.klaerung && k.row.klaerung_notiz && <div className="cr-klaerung"><MessageCircleWarning size={15} strokeWidth={2.3} /> {k.row.klaerung_notiz}</div>}
              {k.partner ? <div className="cr-partner"><CircleCheck size={15} strokeWidth={2.4} /> {k.partner.wer} hat eure gemeinsame Rechnung hochgeladen ({datumZeit(k.partner.rechnung_am)}).</div> : <button className="cr-hoch" disabled={isPreview || busy === key} onClick={() => start(k.row ? { row: k.row } : { monat: k.monat })}>
                <Upload size={17} strokeWidth={2.4} /> {busy === key ? 'Lädt hoch …' : k.klaerung ? 'Neue Rechnung hochladen' : 'Rechnung hochladen'}
                <small>PDF oder Foto</small>
              </button>}
              {meldung[key] && <div className="cr-meldung">{meldung[key]}</div>}
            </div>
          )
        })}
      </div>
    )
  }

  // ── Mehr: immer ein Upload-Knopf + Liste ───────────────────────────────────
  const gewaehlt = zeileVon(monat)
  const keyNeu = gewaehlt ? gewaehlt.id : 'm-' + monat
  const gesperrt = gewaehlt?.status === 'bezahlt'
  return (
    <div className="cr-liste">
      {input}
      <div className="cr-box">
        <div className="cr-box-titel"><Receipt size={16} strokeWidth={2.3} /> Meine Rechnungen</div>
        {gruppe && <div className="cr-hinweis">{gruppenText}</div>}
        <div className="cr-neu">
          <select value={monat} onChange={e => setMonat(e.target.value)}>
            {monate(3).map(m => <option key={m} value={m}>{monatName(m)}</option>)}
          </select>
          <button className="cr-neu-knopf" disabled={isPreview || gesperrt || busy === keyNeu} onClick={() => start(gewaehlt ? { row: gewaehlt } : { monat })}>
            <Upload size={15} strokeWidth={2.4} /> {busy === keyNeu ? 'Lädt hoch …' : gewaehlt?.rechnung_url ? 'Andere Datei hochladen' : 'Rechnung hochladen'}
          </button>
        </div>
        {gesperrt && <div className="cr-hinweis">Für {monatName(monat)} ist schon alles bezahlt.</div>}
        {!gesperrt && !gewaehlt?.rechnung_url && partnerVon(monat) && <div className="cr-partner"><CircleCheck size={14} strokeWidth={2.4} /> {partnerVon(monat).wer} hat eure gemeinsame Rechnung für {monatName(monat)} hochgeladen.</div>}
        {meldung[keyNeu] && <div className="cr-meldung">{meldung[keyNeu]}</div>}
        {liste.filter(a => a.rechnung_url || a.status !== 'offen').map(a => {
          const st = STATUS[a.status] || STATUS.offen
          const Sym = a.status === 'bezahlt' ? CircleCheck : a.status === 'klaerung' ? MessageCircleWarning : a.status === 'rechnung' ? Clock : Upload
          return (
            <div key={a.id} className="cr-zeile">
              <span className="cr-st" style={{ color: st.farbe, background: st.bg }}><Sym size={13} strokeWidth={2.4} /> {a.status === 'bezahlt' ? `Bezahlt ${datum(a.bezahlt_am)}` : a.status === 'rechnung' ? 'Hochgeladen' : st.label}</span>
              <span className="cr-zeile-was">{a.bezeichnung || monatName(a.monat)}<small>{a.rechnung_am ? `hochgeladen ${datumZeit(a.rechnung_am)}` : ''}{a.status === 'klaerung' && a.klaerung_notiz ? ` · „${a.klaerung_notiz}“` : ''}</small></span>
              <span className="cr-zeile-knoepfe">
                {a.rechnung_url && <button title="Meine Rechnung öffnen" onClick={() => oeffnen(a.rechnung_url)}><FileText size={15} strokeWidth={2.2} /></button>}
                {a.status !== 'bezahlt' && !isPreview && <button title={a.rechnung_url ? 'Andere Datei hochladen' : 'Rechnung hochladen'} disabled={busy === a.id} onClick={() => start({ row: a })}><Upload size={15} strokeWidth={2.2} /></button>}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
