// v4.63.0: „Meine Zeitzone" im Portal.
//
// Die Geräte-Uhr liefert die Zone (VPN egal). Sie wird einmal zur Bestätigung
// vorgeschlagen; eine bestätigte oder bewusst gewählte Zone gilt danach für
// Kalender und Telegram-Nachrichten und wird von der Erkennung NICHT mehr
// überschrieben. Weicht das Gerät später davon ab (Reise, falsch gestellte
// Uhr), fragt ein Hinweis, ob umgestellt werden soll.
//
// Gespeichert in online_status (zeitzone, zeitzone_bestaetigt) — die Zeile
// gehört dem Chatter selbst, dafür braucht es keine Admin-Rechte.
import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { geraeteZone, setzeMeineZone, alleZonen, utcLabel, ortAus } from '../zeit'

const IGNORIERT = (name, zone) => `tz_ignoriert_${name}_${zone}`

export default function ZeitzonenHinweis({ displayName, onZone }) {
  const [gespeichert, setGespeichert] = useState(null) // { zone, bestaetigt }
  const [waehlen, setWaehlen] = useState(false)
  const [auswahl, setAuswahl] = useState('')
  const [ignoriert, setIgnoriert] = useState(false)
  const geraet = geraeteZone()

  useEffect(() => {
    let weg = false
    ;(async () => {
      const { data, error } = await supabase.from('online_status')
        .select('zeitzone, zeitzone_bestaetigt').eq('display_name', displayName).maybeSingle()
      if (weg) return
      if (error) { setGespeichert({ zone: null, bestaetigt: false, fehler: true }); return }
      const g = { zone: data?.zeitzone || null, bestaetigt: !!data?.zeitzone_bestaetigt }
      setGespeichert(g)
      if (g.bestaetigt && g.zone) setzeMeineZone(g.zone)
      else {
        setzeMeineZone(null)
        // unbestätigt: Geräte-Zone still mitführen (für Telegram), wie bisher
        if (g.zone !== geraet) await supabase.from('online_status').upsert({ display_name: displayName, zeitzone: geraet }, { onConflict: 'display_name' })
      }
      try { setIgnoriert(sessionStorage.getItem(IGNORIERT(displayName, geraet)) === '1') } catch {}
      onZone?.()
    })()
    return () => { weg = true }
  }, [displayName]) // eslint-disable-line react-hooks/exhaustive-deps

  const festlegen = async (zone) => {
    // upsert: auch wenn es (noch) keine online_status-Zeile gibt
    const { error } = await supabase.from('online_status')
      .upsert({ display_name: displayName, zeitzone: zone, zeitzone_bestaetigt: true }, { onConflict: 'display_name' })
    if (error) { alert('⚠ Zeitzone nicht gespeichert: ' + error.message); return }
    setzeMeineZone(zone)
    setGespeichert({ zone, bestaetigt: true })
    setWaehlen(false)
    onZone?.()
  }
  const behalten = () => {
    try { sessionStorage.setItem(IGNORIERT(displayName, geraet), '1') } catch {}
    setIgnoriert(true)
  }

  if (!gespeichert || gespeichert.fehler) return null

  const box = { marginBottom: 12, padding: '10px 12px', borderRadius: 10, fontSize: 12.5, lineHeight: 1.5, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }
  const knopf = (primaer) => ({ padding: '5px 11px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: primaer ? '#7c3aed' : 'transparent', color: primaer ? '#fff' : 'var(--text-secondary)', border: `1px solid ${primaer ? '#7c3aed' : 'var(--border)'}` })
  const name = (z) => `${ortAus(z)} (${utcLabel(z)})`

  const auswahlFeld = waehlen && (
    <div style={{ display: 'flex', gap: 6, width: '100%', flexWrap: 'wrap' }}>
      <select value={auswahl || gespeichert.zone || geraet} onChange={e => setAuswahl(e.target.value)}
        style={{ flex: '1 1 220px', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '6px 8px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit' }}>
        {alleZonen().map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')} · {utcLabel(z)}</option>)}
      </select>
      <button onClick={() => festlegen(auswahl || gespeichert.zone || geraet)} style={knopf(true)}>Speichern</button>
      <button onClick={() => setWaehlen(false)} style={knopf(false)}>Abbrechen</button>
    </div>
  )

  // 1) Noch nie bestätigt → Vorschlag
  if (!gespeichert.bestaetigt) {
    return (
      <div style={{ ...box, background: 'rgba(124,58,237,0.10)', border: '1px solid rgba(124,58,237,0.35)', color: 'var(--ton-lila2)' }}>
        <span>🕒 Deine Zeitzone: <b>{name(geraet)}</b> — laut deinem Gerät. Stimmt das? Danach richten sich Kalender und Telegram-Erinnerungen.</span>
        {!waehlen && <><button onClick={() => festlegen(geraet)} style={knopf(true)}>Ja, stimmt</button><button onClick={() => setWaehlen(true)} style={knopf(false)}>Andere wählen</button></>}
        {auswahlFeld}
      </div>
    )
  }

  // 2) Bestätigt, aber Gerät steht woanders → nachfragen
  if (gespeichert.zone !== geraet && !ignoriert) {
    return (
      <div style={{ ...box, background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.4)', color: 'var(--ton-gelb2)' }}>
        <span>⚠ Dein Gerät steht auf <b>{name(geraet)}</b>, eingestellt ist <b>{name(gespeichert.zone)}</b>. Kalender und Erinnerungen laufen gerade in {ortAus(gespeichert.zone)}-Zeit.</span>
        {!waehlen && <>
          <button onClick={() => festlegen(geraet)} style={knopf(true)}>Auf {ortAus(geraet)} umstellen</button>
          <button onClick={behalten} style={knopf(false)}>{ortAus(gespeichert.zone)} behalten</button>
          <button onClick={() => setWaehlen(true)} style={knopf(false)}>Andere wählen</button>
        </>}
        {auswahlFeld}
      </div>
    )
  }

  // 3) Alles passt → nur ein kleiner Link zum Ändern
  return (
    <div style={{ marginBottom: 8, fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      🕒 Zeitzone: {name(gespeichert.zone)}
      {!waehlen && <button onClick={() => setWaehlen(true)} style={{ background: 'transparent', border: 'none', color: '#a78bfa', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', padding: 0, textDecoration: 'underline' }}>ändern</button>}
      {auswahlFeld}
    </div>
  )
}
