// v4.60.0: Team-Kalender im Chatter-Portal — „Mein Kalender".
// v4.65.0: „Erledigt" meldet sich bei Chris/Rey; Folgeaufgabe/Serie gekennzeichnet.
// v4.66.0: Rückmeldung schreiben (landet in kalender_rueckmeldungen + Telegram an
//          Chris/Rey). Jeder sieht nur SEINE Rückmeldungen (RLS).
// Zeigt die nächsten 7 Tage: Einträge für das ganze Team und die, in denen
// ich namentlich stehe (die Datenbank liefert nichts anderes aus).
// Alles in der Zeit MEINES Browsers, deutsche Zeit auf Tippen.
import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabase'
import { BERLIN, meineZone, datumInZone, zeitIn, ortAus, utcLabel } from '../zeit'
import { artInfo, erledigtMelden, wdhLabel, rueckmeldungMelden } from './CalendarTab'

const restText = (ms) => {
  if (ms <= 0) return 'jetzt fällig'
  const min = Math.floor(ms / 60000)
  const h = Math.floor(min / 60), m = min % 60
  if (h >= 24) return `in ${Math.floor(h / 24)} T ${h % 24} h`
  return h ? `in ${h} h ${String(m).padStart(2, '0')} min` : `in ${m} min`
}

export default function MeinKalender({ displayName, isPreview }) {
  const [eintraege, setEintraege] = useState([])
  const [jetzt, setJetzt] = useState(Date.now())
  const [berlinZeigen, setBerlinZeigen] = useState(null) // id, bei der deutsche Zeit aufgeklappt ist
  const [rmOffen, setRmOffen] = useState(null) // id, bei der das Rückmelde-Feld offen ist
  const [rmText, setRmText] = useState('')
  const [rmSendet, setRmSendet] = useState(false)
  const [meineRm, setMeineRm] = useState({}) // kalender_id → [{ text, am }]
  const zone = meineZone()

  const laden = useCallback(async () => {
    if (!displayName) return
    const von = new Date(Date.now() - 12 * 3600 * 1000).toISOString()
    const bis = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
    let q = supabase.from('team_kalender').select('*').gte('beginn', von).lte('beginn', bis).order('beginn')
    // In der Admin-Vorschau liefert die DB alles — dann wie beim Chatter filtern.
    const { data, error } = await q
    if (error) { setEintraege([]); return }
    const ich = (displayName || '').trim().toLowerCase()
    const liste = (data || []).filter(e => e.fuer_alle || (e.fuer || []).some(n => n.trim().toLowerCase() === ich))
    setEintraege(liste)
    if (liste.length) {
      const { data: rm } = await supabase.from('kalender_rueckmeldungen').select('kalender_id, von, text, am')
        .in('kalender_id', liste.map(e => e.id)).order('am')
      const m = {}
      for (const r of rm || []) { if ((r.von || '').trim().toLowerCase() !== ich) continue; if (!m[r.kalender_id]) m[r.kalender_id] = []; m[r.kalender_id].push(r) }
      setMeineRm(m)
    }
  }, [displayName])

  useEffect(() => { laden() }, [laden])
  useEffect(() => {
    const t = setInterval(() => { setJetzt(Date.now()) }, 30000)
    const l = setInterval(laden, 5 * 60000)
    return () => { clearInterval(t); clearInterval(l) }
  }, [laden])

  const erledigt = async (e, wert) => {
    if (isPreview) { alert('In der Vorschau wird nichts im Namen des Chatters abgehakt.'); return }
    const { data, error } = await supabase.rpc('kalender_erledigt', { p_id: e.id, p_erledigt: wert })
    if (error) { alert('⚠ Nicht gespeichert: ' + error.message); return }
    if (wert) erledigtMelden(e, data, displayName)
    laden()
  }

  const rueckmelden = async (e) => {
    const text = rmText.trim()
    if (!text) return
    if (isPreview) { alert('In der Vorschau wird nichts im Namen des Chatters gesendet.'); return }
    setRmSendet(true)
    const { error } = await supabase.from('kalender_rueckmeldungen').insert({ kalender_id: e.id, von: displayName, text })
    setRmSendet(false)
    if (error) { alert('⚠ Nicht gesendet: ' + error.message); return }
    rueckmeldungMelden(e, text, displayName)
    setRmText(''); setRmOffen(null)
    laden()
  }

  if (!eintraege.length) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 2px' }}>Keine Einträge in den nächsten 7 Tagen.</div>
  }

  // nach Tag (in meiner Zone) gruppieren
  const gruppen = []
  for (const e of eintraege) {
    const tag = datumInZone(e.beginn, zone).tag
    let g = gruppen.find(x => x.tag === tag)
    if (!g) { g = { tag, label: new Date(e.beginn).toLocaleDateString('de-DE', { timeZone: zone, weekday: 'long', day: '2-digit', month: '2-digit' }), liste: [] }; gruppen.push(g) }
    g.liste.push(e)
  }
  const ich = (displayName || '').trim().toLowerCase()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Alle Zeiten in deiner Zeit ({ortAus(zone)}, {utcLabel(zone)}).</div>
      {gruppen.map(g => (
        <div key={g.tag} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>{g.label}</div>
          {g.liste.map(e => {
            const a = artInfo(e.art)
            const binFertig = (e.erledigt_von || []).some(n => n.trim().toLowerCase() === ich)
            const rest = new Date(e.beginn).getTime() - jetzt
            return (
              <div key={e.id} style={{ display: 'flex', gap: 10, padding: '9px 10px', background: 'var(--bg-card2)', border: '1px solid var(--border)', borderLeft: `3px solid ${a.farbe}`, borderRadius: 8, opacity: binFertig ? 0.6 : 1 }}>
                <button onClick={() => setBerlinZeigen(berlinZeigen === e.id ? null : e.id)} title="Deutsche Zeit anzeigen"
                  style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', minWidth: 46, textAlign: 'left', alignSelf: 'flex-start' }}>
                  {zeitIn(e.beginn, zone)}
                  {berlinZeigen === e.id && <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-muted)' }}>DE {zeitIn(e.beginn, BERLIN)}</div>}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', textDecoration: binFertig ? 'line-through' : 'none' }}>{e.titel}</div>
                  {e.folge_titel && <div style={{ fontSize: 11, color: '#c4b5fd' }}>↳ Folgeaufgabe zu „{e.folge_titel}"</div>}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{e.serie_id ? `🔁 ${wdhLabel(e.wiederholung)} · ` : ''}{a.label}{e.ende ? ` · bis ${zeitIn(e.ende, zone)}` : ''}{e.erstellt_von ? ` · von ${e.erstellt_von}` : ''}</div>
                  {e.notiz && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3, whiteSpace: 'pre-wrap' }}>{e.notiz}</div>}
                  {(meineRm[e.id] || []).map((r, i) => (
                    <div key={i} style={{ fontSize: 11.5, color: '#93c5fd', marginTop: 4, whiteSpace: 'pre-wrap' }}>💬 Du: {r.text}</div>
                  ))}
                  {e.art === 'aufgabe' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      {!binFertig && <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, padding: '3px 7px', borderRadius: 6, background: rest <= 0 ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)', color: rest <= 0 ? '#ef4444' : '#f59e0b' }}>⏱ {restText(rest)}</span>}
                      <button onClick={() => { setRmOffen(rmOffen === e.id ? null : e.id); setRmText('') }} title="Rückmeldung an Chris/Rey" aria-label="Rückmeldung schreiben" style={{ marginLeft: 'auto', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>💬</button>
                      <button onClick={() => erledigt(e, !binFertig)} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: binFertig ? 'transparent' : 'rgba(16,185,129,0.15)', color: binFertig ? 'var(--text-muted)' : '#10b981', border: `1px solid ${binFertig ? 'var(--border)' : 'rgba(16,185,129,0.4)'}` }}>{binFertig ? '↺ doch nicht' : '✓ Erledigt'}</button>
                    </div>
                  )}
                  {e.art !== 'aufgabe' && rmOffen !== e.id && (
                    <button onClick={() => { setRmOffen(e.id); setRmText('') }} style={{ marginTop: 6, padding: '3px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>💬 Rückmeldung</button>
                  )}
                  {rmOffen === e.id && (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <textarea value={rmText} onChange={ev => setRmText(ev.target.value)} rows={2} maxLength={1000} autoFocus
                        placeholder="z. B. „Erledigt, aber nur 40 Fans erreicht“ oder „Schaffe ich erst um 23 Uhr“"
                        style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 7, fontSize: 12.5, fontFamily: 'inherit', resize: 'vertical' }} />
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button onClick={() => setRmOffen(null)} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>Abbrechen</button>
                        <button onClick={() => rueckmelden(e)} disabled={rmSendet || !rmText.trim()} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#7c3aed', color: '#fff', border: '1px solid #7c3aed', opacity: rmSendet || !rmText.trim() ? 0.5 : 1 }}>{rmSendet ? 'Sendet…' : 'An Chris & Rey senden'}</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
