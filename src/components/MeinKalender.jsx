// v4.60.0: Team-Kalender im Chatter-Portal — „Mein Kalender".
// Zeigt die nächsten 7 Tage: Einträge für das ganze Team und die, in denen
// ich namentlich stehe (die Datenbank liefert nichts anderes aus).
// Alles in der Zeit MEINES Browsers, deutsche Zeit auf Tippen.
import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabase'
import { BERLIN, meineZone, datumInZone, zeitIn, ortAus, utcLabel } from '../zeit'
import { artInfo } from './CalendarTab'

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
    setEintraege((data || []).filter(e => e.fuer_alle || (e.fuer || []).some(n => n.trim().toLowerCase() === ich)))
  }, [displayName])

  useEffect(() => { laden() }, [laden])
  useEffect(() => {
    const t = setInterval(() => { setJetzt(Date.now()) }, 30000)
    const l = setInterval(laden, 5 * 60000)
    return () => { clearInterval(t); clearInterval(l) }
  }, [laden])

  const erledigt = async (e, wert) => {
    if (isPreview) { alert('In der Vorschau wird nichts im Namen des Chatters abgehakt.'); return }
    const { error } = await supabase.rpc('kalender_erledigt', { p_id: e.id, p_erledigt: wert })
    if (error) { alert('⚠ Nicht gespeichert: ' + error.message); return }
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
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.label}{e.ende ? ` · bis ${zeitIn(e.ende, zone)}` : ''}{e.erstellt_von ? ` · von ${e.erstellt_von}` : ''}</div>
                  {e.notiz && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3, whiteSpace: 'pre-wrap' }}>{e.notiz}</div>}
                  {e.art === 'aufgabe' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      {!binFertig && <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, padding: '3px 7px', borderRadius: 6, background: rest <= 0 ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)', color: rest <= 0 ? '#ef4444' : '#f59e0b' }}>⏱ {restText(rest)}</span>}
                      <button onClick={() => erledigt(e, !binFertig)} style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: binFertig ? 'transparent' : 'rgba(16,185,129,0.15)', color: binFertig ? 'var(--text-muted)' : '#10b981', border: `1px solid ${binFertig ? 'var(--border)' : 'rgba(16,185,129,0.4)'}` }}>{binFertig ? '↺ doch nicht' : '✓ Erledigt'}</button>
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
