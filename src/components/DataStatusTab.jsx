import React, { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { formatMoney, formatShortDate } from '../utils'
import { TOL_EXAKT, kandidatenAusSnapshot, bestesZiel } from '../modelChatterMatch'
import Card from './Card'

// ─── DATENSTAND ──────────────────────────────────────────────────────────────
//
// v4.31.0 · Welche Daten sind je Tag da, welche fehlen.
//
// WARUM DIE SEITE
// Bis hierher gab es fuer KEINEN der Uploads eine Uebersicht. Ob die Model-CSV
// vom 14. je hochgeladen wurde, liess sich nur pruefen, indem man das Datum
// anwaehlt und nachsieht. Die Seite deckt deshalb bewusst alle drei Quellen ab,
// nicht nur die neuen Einzeldateien.
//
// Die Spalte "Abgleich" ist das eigentliche Vertrauenssignal: Summe der
// Einzeldateien gegen den Message Revenue der Vergleichsdatei. Steht dort 0,00 $,
// ist der Tag nachweislich vollstaendig. Steht dort ein Betrag, IST dieser Betrag
// der fehlende Account.

const ZELLE = { padding: '8px 10px', fontSize: 12, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const KOPF = { ...ZELLE, fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, textAlign: 'left' }

function Haken({ da }) {
  return da
    ? <span style={{ color: 'var(--green)', fontWeight: 700 }}>✓</span>
    : <span style={{ color: 'var(--red)', fontWeight: 700 }}>✗</span>
}

export default function DataStatusTab({ modelSnapshots = [], chatterSnapshots = [] }) {
  const [einzel, setEinzel] = useState([])
  const [laedt, setLaedt] = useState(true)
  const [alleTage, setAlleTage] = useState(false)

  useEffect(() => {
    let abgebrochen = false
    ;(async () => {
      const { data, error } = await supabase
        .from('model_chatter_daily').select('business_date, creator, revenue')
      if (error) console.error('Datenstand laden:', error)
      if (!abgebrochen) { setEinzel(data || []); setLaedt(false) }
    })()
    return () => { abgebrochen = true }
  }, [])

  const zeilen = useMemo(() => {
    // Einzeldaten nach Tag → Account → Summe
    const proTag = new Map()
    for (const r of einzel) {
      if (!proTag.has(r.business_date)) proTag.set(r.business_date, new Map())
      const m = proTag.get(r.business_date)
      m.set(r.creator, (m.get(r.creator) || 0) + (Number(r.revenue) || 0))
    }

    const modelMap = new Map(modelSnapshots.map(s => [s.businessDate, s]))
    const chatterMap = new Map(chatterSnapshots.map(s => [s.businessDate, s]))
    const tage = [...new Set([
      ...modelMap.keys(), ...chatterMap.keys(), ...proTag.keys(),
    ])].sort().reverse()

    return tage.map(tag => {
      const modelSnap = modelMap.get(tag)
      // Dieselben Kandidaten und dieselben zwei Bezugsgroessen wie beim Upload —
      // sonst meldet der Datenstand Abweichungen, die die Erkennung gar nicht hat.
      const erwartet = kandidatenAusSnapshot(modelSnap?.rows || [])
      const erfasstMap = proTag.get(tag) || new Map()

      const offen = erwartet.filter(k => !erfasstMap.has(k.creator))
      const abweichungen = erwartet
        .filter(k => erfasstMap.has(k.creator))
        .map(k => {
          const summe = erfasstMap.get(k.creator)
          const z = bestesZiel(k, summe)
          return { creator: k.creator, differenz: summe - z.wert }
        })
        .filter(x => Math.abs(x.differenz) > TOL_EXAKT)

      // Erfasste Accounts, die es in der Vergleichsdatei gar nicht gibt —
      // deutet auf eine Zuordnung von Hand auf den falschen Account hin.
      // v4.31.1: gegen ALLE Accounts der Vergleichsdatei pruefen, nicht nur gegen
      // die mit Umsatz. Vorher wurde jeder korrekt erfasste 0-$-Account als
      // "nicht in der Vergleichsdatei" gemeldet — ein Fehlalarm.
      const alleNamen = new Set((modelSnap?.rows || []).map(r => r?.creator).filter(Boolean))
      const verwaist = [...erfasstMap.keys()].filter(c => !alleNamen.has(c))

      // v4.31.2 · Zwei grundverschiedene Faelle, vorher in einen Topf geworfen:
      //
      //   unterdeckung (negativ) — in der Einzeldatei steht WENIGER als der
      //     Account an Message Revenue hatte. Das ist NORMAL: das OF-Tool
      //     schreibt nicht jeden Umsatz einem Chatter zu (Julia am 22.08.:
      //     46,15 Message Revenue, 9,60 in der Datei). Kein Erfassungsfehler,
      //     sondern eine Eigenschaft der Quelle. Nur zur Kenntnis.
      //
      //   ueberdeckung (positiv) — es wurde MEHR erfasst, als der Account
      //     ueberhaupt hatte. Das kann nur eine Fehlzuordnung sein und muss
      //     auffallen.
      const unterdeckung = abweichungen.filter(x => x.differenz < 0)
      const ueberdeckung = abweichungen.filter(x => x.differenz > 0)

      return {
        tag,
        model: !!modelSnap,
        chatter: chatterMap.has(tag),
        erwartet: erwartet.length,
        erfasst: erwartet.length - offen.length,
        hatEinzel: erfasstMap.size > 0,
        fehlenderUmsatz: offen.reduce((s, k) => s + k.nachrichten, 0),
        nichtZugeordnet: unterdeckung.reduce((s, x) => s + x.differenz, 0),
        ueberdeckungSumme: ueberdeckung.reduce((s, x) => s + x.differenz, 0),
        offen,
        unterdeckung,
        ueberdeckung,
        verwaist,
      }
    })
  }, [einzel, modelSnapshots, chatterSnapshots])

  const sichtbar = alleTage ? zeilen : zeilen.slice(0, 30)

  // Kopfzahlen ueber die letzten 7 Tage mit Einzeldateien
  // v4.31.2: "sauber" heisst VOLLSTAENDIG ERFASST — jeder Account mit Umsatz hat
  // eine Datei, nichts ist falsch zugeordnet. Nicht zugeordneter Umsatz (§
  // unterdeckung) zaehlt bewusst NICHT dagegen; sonst waere jeder Tag rot, an
  // dem das OF-Tool Umsatz keinem Chatter zuschreibt — und das ist der Normalfall.
  const letzte7 = zeilen.filter(z => z.hatEinzel).slice(0, 7)
  const istSauber = (z) =>
    z.erwartet > 0 && z.erfasst === z.erwartet && z.ueberdeckung.length === 0 && z.verwaist.length === 0
  const sauber = letzte7.filter(istSauber).length

  if (laedt) return (
    <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '60px 0', fontSize: 14 }}>
      Datenstand wird geladen…
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="Datenstand">
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 14 }}>
          {letzte7.length === 0 ? (
            <>Für die Model-Einzeldateien liegen noch keine Tage vor. Sobald du sie hochlädst, steht hier
              der tägliche Abgleich gegen die Vergleichsdatei.</>
          ) : (
            <>
              <strong style={{ color: sauber === letzte7.length ? 'var(--green)' : 'var(--yellow)' }}>
                {sauber} von {letzte7.length}
              </strong>{' '}
              der letzten Tage mit Einzeldateien sind vollständig erfasst.{' '}
              <span style={{ color: 'var(--text-muted)' }}>
                Abgleich = Umsatz der Accounts, für die keine Einzeldatei vorliegt. Bei $0.00 ist der
                Tag vollständig. „Nicht zugeordnet" ist etwas anderes: Umsatz, den das OF-Tool keinem
                Chatter zuschreibt — normal, kein Erfassungsfehler.
              </span>
            </>
          )}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
            <thead>
              <tr>
                <th style={KOPF}>Datum</th>
                <th style={{ ...KOPF, textAlign: 'center' }}>Model</th>
                <th style={{ ...KOPF, textAlign: 'center' }}>Chatter</th>
                <th style={{ ...KOPF, textAlign: 'center' }}>Einzeldateien</th>
                <th style={{ ...KOPF, textAlign: 'right' }}>Abgleich</th>
                <th style={KOPF}>Hinweis</th>
              </tr>
            </thead>
            <tbody>
              {sichtbar.map(z => {
                const vollstaendig = z.erwartet > 0 && z.erfasst === z.erwartet
                const sauberTag = istSauber(z)
                return (
                  <tr key={z.tag}>
                    <td style={{ ...ZELLE, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                      {formatShortDate(z.tag)}
                      <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 10 }}>{z.tag.slice(0, 4)}</span>
                    </td>
                    <td style={{ ...ZELLE, textAlign: 'center' }}><Haken da={z.model} /></td>
                    <td style={{ ...ZELLE, textAlign: 'center' }}><Haken da={z.chatter} /></td>
                    <td style={{
                      ...ZELLE, textAlign: 'center', fontFamily: 'var(--font-mono)',
                      color: !z.hatEinzel ? 'var(--text-muted)' : vollstaendig ? 'var(--green)' : 'var(--yellow)',
                    }}>
                      {z.hatEinzel ? `${z.erfasst} / ${z.erwartet}` : '—'}
                    </td>
                    <td style={{
                      ...ZELLE, textAlign: 'right', fontFamily: 'var(--font-mono)',
                      color: !z.hatEinzel ? 'var(--text-muted)' : sauberTag ? 'var(--green)' : 'var(--yellow)',
                    }}>
                      {!z.hatEinzel ? '—'
                        : z.fehlenderUmsatz > TOL_EXAKT ? `−${formatMoney(z.fehlenderUmsatz)}`
                          : z.ueberdeckung.length > 0 ? `+${formatMoney(z.ueberdeckungSumme)}`
                            : '$0.00'}
                    </td>
                    <td style={{ ...ZELLE, fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'normal', maxWidth: 320 }}>
                      {!z.model && z.chatter && <span style={{ color: 'var(--yellow)' }}>Model-CSV fehlt</span>}
                      {z.model && !z.chatter && <span style={{ color: 'var(--yellow)' }}>Chatter-CSV fehlt</span>}
                      {z.hatEinzel && z.offen.length > 0 && (
                        <div style={{ color: 'var(--yellow)' }}>ohne Datei: {z.offen.map(r => r.creator).join(' · ')}</div>
                      )}
                      {z.unterdeckung.length > 0 && (
                        <div>
                          nicht zugeordnet ({formatMoney(Math.abs(z.nichtZugeordnet))}):{' '}
                          {z.unterdeckung.map(a => `${a.creator} (${formatMoney(a.differenz)})`).join(' · ')}
                        </div>
                      )}
                      {z.ueberdeckung.length > 0 && (
                        <div style={{ color: 'var(--red)' }}>
                          ⚠ mehr erfasst als vorhanden: {z.ueberdeckung.map(a => `${a.creator} (+${formatMoney(a.differenz)})`).join(' · ')}
                        </div>
                      )}
                      {z.verwaist.length > 0 && (
                        <div style={{ color: 'var(--red)' }}>
                          ⚠ nicht in der Vergleichsdatei: {z.verwaist.join(' · ')}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {zeilen.length > 30 && (
          <button onClick={() => setAlleTage(v => !v)} style={{
            marginTop: 12, padding: '6px 12px', borderRadius: 6, background: 'transparent',
            border: '1px solid var(--border)', color: 'var(--text-secondary)',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            {alleTage ? 'Nur letzte 30 Tage' : `Alle ${zeilen.length} Tage zeigen`}
          </button>
        )}
      </Card>

      <Card title="Was hier womit verglichen wird">
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <p style={{ margin: '0 0 10px' }}>
            <strong style={{ color: 'var(--text-primary)' }}>Einzeldateien</strong> zählt Accounts, für die
            eine Model-Einzeldatei vorliegt, gegen alle Accounts, die an dem Tag überhaupt Message Revenue
            hatten. Accounts mit 0,00 $ bleiben außen vor — für die gibt es nichts zu erfassen.
          </p>
          <p style={{ margin: '0 0 10px' }}>
            <strong style={{ color: 'var(--text-primary)' }}>Abgleich</strong> ist der Umsatz der Accounts
            ohne Einzeldatei. Bei $0.00 ist der Tag vollständig erfasst. Ein <strong>+Betrag</strong> ist
            dagegen ein echter Fehler: da wurde mehr erfasst, als der Account überhaupt hatte — das kann
            nur eine falsche Zuordnung sein.
          </p>
          <p style={{ margin: '0 0 10px' }}>
            <strong style={{ color: 'var(--text-primary)' }}>Nicht zugeordnet</strong> ist etwas anderes und
            <strong> kein Fehler</strong>: Message Revenue, den das OF-Tool keinem Chatter zuschreibt. Am
            22.08.2026 waren das 43,75 $ bei Leoni und Julia. Die Summe der Chatter-Umsätze eines Models
            kann deshalb kleiner sein als dessen Message Revenue.
          </p>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>
            ⚠️ Verglichen wird gegen <strong>Message Revenue</strong> (bei manchen Accounts zzgl. Trinkgeld),
            nicht gegen den Gesamtumsatz. Subs sind im Chatter-Leaderboard nie enthalten — am 22.08.2026
            waren das rund 19 % des Umsatzes.
          </p>
        </div>
      </Card>
    </div>
  )
}
