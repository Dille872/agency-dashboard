import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabase'
import { parseCSV, parseChatterRow, formatMoney } from '../utils'
import { ordneDateienZu, setzeZuordnung, abgleich, TOL_EXAKT } from '../modelChatterMatch'
import UploadBox from './UploadBox'

// ─── MODEL-EINZELDATEIEN · UPLOAD MIT VORSCHAU ───────────────────────────────
//
// v4.31.0 · Dritte Upload-Box neben "Daily Model" und "Daily Chatter".
//
// WARUM MIT VORSCHAU STATT DIREKT
// Geschrieben wird erst, wenn jede Datei einem Account zugeordnet ist und der
// Abgleich sichtbar aufgeht. Vorher ist der Speichern-Knopf gesperrt. Grund:
// eine still falsch zugeordnete Datei faellt nirgends auf — genau so lief der
// Doppelzaehlungs-Fehler bei den zwei Chiara-Accounts wochenlang mit.
//
// Die bestehenden Tabellen werden dabei NICHT angefasst. model_snapshots und
// chatter_snapshots bleiben unveraendert; schlimmstenfalls stehen falsche Zeilen
// in model_chatter_daily und der Tag wird neu hochgeladen.

const ZELLE = { padding: '7px 10px', fontSize: 12, borderBottom: '1px solid var(--border)' }
const KOPF = { ...ZELLE, fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, textAlign: 'left' }

// Ein Chatter kommt je Datei genau einmal vor. Falls das Tool doch einmal zwei
// Zeilen liefert, werden sie hier zusammengefasst — sonst wuerde der
// Unique-Index den ganzen Upload ablehnen.
function fasseChatterZusammen(rows) {
  const map = new Map()
  for (const r of rows) {
    const vorhanden = map.get(r.name)
    if (!vorhanden) { map.set(r.name, { ...r }); continue }
    vorhanden.revenue += r.revenue
    vorhanden.sentMessages += r.sentMessages
    vorhanden.sentPPVs += r.sentPPVs
    vorhanden.boughtPPVs += r.boughtPPVs
    vorhanden.activeMinutes = Math.max(vorhanden.activeMinutes, r.activeMinutes)
    vorhanden.inactiveMinutes = Math.max(vorhanden.inactiveMinutes, r.inactiveMinutes)
    vorhanden.avgResponseSeconds = Math.max(vorhanden.avgResponseSeconds, r.avgResponseSeconds)
  }
  return [...map.values()]
}

export default function ModelChatterUpload({ businessDate, modelRows, session, onSaved }) {
  const [offen, setOffen] = useState(false)
  const [ergebnis, setErgebnis] = useState([])
  const [speichert, setSpeichert] = useState(false)
  const [fehler, setFehler] = useState(null)
  const [erfasst, setErfasst] = useState(null)   // {accounts, umsatz} fuer den gewaehlten Tag

  const ladeStand = useCallback(async () => {
    if (!businessDate) return
    const { data, error } = await supabase
      .from('model_chatter_daily').select('creator, revenue')
      .eq('business_date', businessDate)
    if (error) { console.error('model_chatter_daily laden:', error); return }
    const accounts = new Set((data || []).map(r => r.creator))
    setErfasst({
      accounts: accounts.size,
      umsatz: (data || []).reduce((s, r) => s + (Number(r.revenue) || 0), 0),
    })
  }, [businessDate])

  useEffect(() => { ladeStand() }, [ladeStand])

  const handleFiles = (dateien) => {
    if (!modelRows || modelRows.length === 0) {
      alert(
        'Für diesen Tag liegt noch keine Vergleichsdatei vor.\n\n' +
        'Lade zuerst "Daily Model" hoch — daraus kommen die Umsätze, an denen die ' +
        'Einzeldateien erkannt werden.'
      )
      return
    }
    const geparst = dateien.map(d => {
      const { headers, rows: rawRows } = parseCSV(d.text)
      const rows = fasseChatterZusammen(rawRows.map(r => parseChatterRow(r, headers)).filter(Boolean))
      return { fileName: d.fileName, rows }
    }).filter(d => d.rows.length > 0)

    if (geparst.length === 0) {
      alert('Keine gültigen Chatter-Zeilen in den gewählten Dateien gefunden.')
      return
    }
    setErgebnis(ordneDateienZu(geparst, modelRows))
    setFehler(null)
    setOffen(true)
  }

  const speichern = async () => {
    setSpeichert(true)
    setFehler(null)
    try {
      const jetzt = new Date().toISOString()
      const creators = [...new Set(ergebnis.map(e => e.creator).filter(Boolean))]
      const zeilen = []
      for (const e of ergebnis) {
        if (!e.creator) continue
        for (const r of e.rows) {
          zeilen.push({
            business_date: businessDate,
            creator: e.creator,
            of_name: e.ofName,
            chatter_name: r.name,
            revenue: r.revenue,
            sent_messages: r.sentMessages,
            sent_ppvs: r.sentPPVs,
            bought_ppvs: r.boughtPPVs,
            avg_response_seconds: r.avgResponseSeconds,
            active_minutes: r.activeMinutes,
            inactive_minutes: r.inactiveMinutes,
            file_name: e.fileName,
            uploaded_at: jetzt,
            user_id: session?.user?.id || null,
          })
        }
      }

      // Erst die betroffenen Accounts dieses Tages leeren, dann neu schreiben.
      // Ein erneuter Upload korrigiert damit sauber, auch wenn diesmal weniger
      // Chatter in der Datei stehen als beim letzten Mal.
      const { error: delErr } = await supabase
        .from('model_chatter_daily').delete()
        .eq('business_date', businessDate).in('creator', creators)
      if (delErr) throw delErr

      const { error: insErr } = await supabase.from('model_chatter_daily').insert(zeilen)
      if (insErr) throw insErr

      setOffen(false)
      setErgebnis([])
      await ladeStand()
      onSaved && onSaved()
    } catch (err) {
      console.error('model_chatter_daily speichern:', err)
      setFehler(err.message || 'Unbekannter Fehler beim Speichern.')
    }
    setSpeichert(false)
  }

  const pruefung = abgleich(ergebnis, modelRows)
  const kannSpeichern = ergebnis.length > 0 && pruefung.ohneZuordnung === 0 && !speichert

  const status = erfasst && erfasst.accounts > 0
    ? `✓ ${erfasst.accounts} Account${erfasst.accounts === 1 ? '' : 'e'} · ${formatMoney(erfasst.umsatz)}`
    : null

  return (
    <>
      <UploadBox
        label="Model-Einzeldateien"
        multiple
        onFiles={handleFiles}
        status={status}
        hint={status ? null : 'mehrere auf einmal'}
      />

      {offen && (
        <div
          onClick={() => !speichert && setOffen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', width: 'min(860px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow)' }}
          >
            {/* Kopf */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                Model-Einzeldateien zuordnen
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                {businessDate} · {ergebnis.length} Datei{ergebnis.length === 1 ? '' : 'en'} ·
                erkannt über die Summe gegen den Message Revenue der Vergleichsdatei
              </div>
            </div>

            {/* Tabelle */}
            <div style={{ overflow: 'auto', flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={KOPF}>Datei</th>
                    <th style={{ ...KOPF, textAlign: 'right' }}>Summe</th>
                    <th style={KOPF}>Account</th>
                    <th style={KOPF}>Erkennung</th>
                  </tr>
                </thead>
                <tbody>
                  {ergebnis.map((e, i) => {
                    const farbe = e.treffer === 'exakt' ? 'var(--green)'
                      : e.treffer === 'manuell' ? 'var(--cyan)'
                        : e.treffer === 'ungefaehr' ? 'var(--yellow)' : 'var(--red)'
                    return (
                      <tr key={i}>
                        <td style={{ ...ZELLE, color: 'var(--text-secondary)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.fileName}>
                          {e.fileName}
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                            {e.rows.length} Chatter
                          </div>
                        </td>
                        <td style={{ ...ZELLE, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                          {formatMoney(e.summe)}
                        </td>
                        <td style={ZELLE}>
                          <select
                            value={e.creator || ''}
                            onChange={ev => setErgebnis(setzeZuordnung(ergebnis, i, ev.target.value || null, modelRows))}
                            style={{
                              background: 'var(--bg-input)', border: `1px solid ${e.creator ? 'var(--border)' : 'var(--red)'}`,
                              color: 'var(--text-primary)', padding: '5px 7px', borderRadius: 6,
                              fontSize: 12, outline: 'none', maxWidth: 240, fontFamily: 'inherit',
                            }}
                          >
                            <option value="">— bitte wählen —</option>
                            {[...modelRows]
                              .sort((a, b) => (b.messageRevenue || 0) - (a.messageRevenue || 0))
                              .map(r => (
                                <option key={r.creator} value={r.creator}>
                                  {r.creator} · {formatMoney(r.messageRevenue || 0)}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td style={{ ...ZELLE, color: farbe, fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {e.treffer === 'exakt' && '✓ auf den Cent'}
                          {e.treffer === 'manuell' && '✎ von Hand'}
                          {e.treffer === 'ungefaehr' && `≈ ${formatMoney(e.abweichung)} Abweichung`}
                          {!e.treffer && '⚠ kein Treffer'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {/* Abgleich */}
              <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>
                    {pruefung.kontenErfasst} von {pruefung.kontenGesamt}
                  </strong>{' '}
                  Accounts mit Umsatz erfasst
                  {pruefung.fehlenderUmsatz > TOL_EXAKT && (
                    <> · nicht erfasst: <span style={{ color: 'var(--yellow)', fontFamily: 'var(--font-mono)' }}>{formatMoney(pruefung.fehlenderUmsatz)}</span></>
                  )}
                </div>
                {pruefung.offen.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    ohne Datei: {pruefung.offen.map(k => k.creator).join(' · ')}
                  </div>
                )}
                {pruefung.abweichungen.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--yellow)' }}>
                    ⚠ Summe passt nicht exakt: {pruefung.abweichungen.map(a => `${a.creator} (${formatMoney(a.differenz)})`).join(' · ')}
                  </div>
                )}
                {pruefung.ohneZuordnung > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--red)' }}>
                    {pruefung.ohneZuordnung} Datei{pruefung.ohneZuordnung === 1 ? '' : 'en'} ohne Zuordnung — Speichern ist gesperrt, bis jede Datei einem Account zugeordnet ist.
                  </div>
                )}
                {fehler && (
                  <div style={{ fontSize: 11, color: 'var(--red)' }}>Fehler beim Speichern: {fehler}</div>
                )}
              </div>
            </div>

            {/* Fuss */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setOffen(false)} disabled={speichert} style={{
                padding: '8px 16px', borderRadius: 8, background: 'transparent',
                border: '1px solid var(--border)', color: 'var(--text-muted)',
                fontSize: 13, fontWeight: 600, cursor: speichert ? 'default' : 'pointer', fontFamily: 'inherit',
              }}>Abbrechen</button>
              <button onClick={speichern} disabled={!kannSpeichern} style={{
                padding: '8px 18px', borderRadius: 8,
                background: kannSpeichern ? 'var(--accent)' : 'var(--bg-card2)',
                border: `1px solid ${kannSpeichern ? 'var(--accent)' : 'var(--border)'}`,
                color: kannSpeichern ? '#fff' : 'var(--text-muted)',
                fontSize: 13, fontWeight: 700, cursor: kannSpeichern ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
              }}>{speichert ? 'Speichert…' : 'Speichern'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
