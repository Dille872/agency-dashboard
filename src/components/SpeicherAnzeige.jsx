import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { logActivity } from '../activity'

// ── Speicheranzeige + Aufräumen (v5.8.0) ───────────────────────────────────
// Zeigt, wie viel vom Supabase-Dateispeicher belegt ist (Pro-Plan: 100 GB).
// Gelb ab 70 %, rot ab 90 %. Läuft der Speicher bei eingeschaltetem Spend Cap
// voll, kann das ganze Dashboard auf „nur lesen“ gehen — deshalb die Warnung.
//
// Aufräumregel (sql/speicher-aufraeumen.sql, Function videos-aufraeumen):
// Rohvideos 30 Tage nach dem Posten löschen, wenn es eine geschnittene
// Fassung gibt; alte ersetzte Uploads ebenso. Läuft automatisch höchstens
// einmal am Tag, wenn Admin/Leitung die Steuerung öffnet, sonst per Knopf.
//
// Downloads (Egress, 250 GB/Monat) lassen sich nicht aus der Datenbank lesen,
// dafür nur der Hinweis auf Supabase → Usage.

const GRENZE = 100 * 1024 ** 3
const G = '#10b981', A = '#f59e0b', ROT = '#ef4444'
const gb = (b) => (Number(b || 0) / 1024 ** 3).toLocaleString('de-DE', { maximumFractionDigits: Number(b) < 10 * 1024 ** 3 ? 2 : 1 })
const MERK = 'videos_aufgeraeumt_am'

export default function SpeicherAnzeige({ userDisplayName }) {
  const [stand, setStand] = useState(null)
  const [fehlt, setFehlt] = useState(false)
  const [arbeitet, setArbeitet] = useState(false)
  const [meldung, setMeldung] = useState('')

  const laden = useCallback(async () => {
    const { data, error } = await supabase.rpc('speicher_stand')
    if (error) { setFehlt(true); return null }
    setStand(data)
    return data
  }, [])

  const aufraeumen = useCallback(async (still = false) => {
    setArbeitet(true); if (!still) setMeldung('')
    const { data, error } = await supabase.functions.invoke('videos-aufraeumen', { body: {} })
    setArbeitet(false)
    try { localStorage.setItem(MERK, new Date().toISOString().slice(0, 10)) } catch { /* egal */ }
    if (error || !data?.ok) { if (!still) setMeldung('Aufräumen hat nicht geklappt: ' + (error?.message || data?.error || (data?.fehler || []).join(', '))); return }
    if (data.geloescht) {
      setMeldung(`✓ ${data.geloescht} Datei${data.geloescht === 1 ? '' : 'en'} gelöscht, ${gb(data.bytes)} GB frei.`)
      try { logActivity('speicher.aufraeumen', { entity: 'reel-videos', detail: `${data.geloescht} Dateien, ${gb(data.bytes)} GB` }) } catch { /* nur Protokoll */ }
    } else if (!still) setMeldung('Nichts zum Aufräumen.')
    laden()
  }, [laden])

  useEffect(() => {
    laden().then(d => {
      if (!d || !d.aufraeumbar_anzahl) return
      let heute = false
      try { heute = localStorage.getItem(MERK) === new Date().toISOString().slice(0, 10) } catch { /* egal */ }
      if (!heute) aufraeumen(true)   // automatisch, höchstens einmal am Tag
    })
  }, [laden, aufraeumen])

  if (fehlt) return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Speicheranzeige: <code>sql/speicher-aufraeumen.sql</code> noch nicht ausgeführt.</div>
  if (!stand) return null
  const anteil = Math.min(1, Number(stand.gesamt_bytes || 0) / GRENZE)
  const farbe = anteil >= 0.9 ? ROT : anteil >= 0.7 ? A : G
  return (
    <div style={{ background: 'var(--bg-card)', border: `1px solid ${anteil >= 0.7 ? farbe : 'var(--border)'}`, borderRadius: 16, padding: '12px 15px', display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 14, color: 'var(--text-primary)' }}>💾 Speicher</b>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          <b style={{ color: farbe }}>{gb(stand.gesamt_bytes)} GB</b> von 100 GB belegt · davon Videos {gb(stand.video_bytes)} GB ({stand.video_anzahl})
        </span>
        <span style={{ flex: 1 }} />
        {stand.aufraeumbar_anzahl > 0 && (
          <button type="button" disabled={arbeitet} onClick={() => aufraeumen(false)}
            style={{ padding: '5px 11px', borderRadius: 9, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${A}`, background: 'transparent', color: A }}>
            {arbeitet ? 'Räumt auf …' : `Jetzt aufräumen (${gb(stand.aufraeumbar_bytes)} GB)`}
          </button>
        )}
      </div>
      <div style={{ height: 7, borderRadius: 5, background: 'var(--bg-card2)', overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(1, Math.round(anteil * 100))}%`, height: '100%', background: farbe }} />
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        {anteil >= 0.9 ? '⚠ Fast voll. Ist der Speicher voll, kann das ganze Dashboard auf „nur lesen“ gehen. Bitte aufräumen oder den Spend Cap prüfen. '
          : anteil >= 0.7 ? '⚠ Über 70 % belegt. Bitte im Blick behalten. ' : ''}
        Rohvideos werden 30 Tage nach dem Posten gelöscht, wenn es eine geschnittene Fassung gibt. Downloads (250 GB im Monat) siehst du bei Supabase unter Usage → Egress.
      </div>
      {meldung && <div style={{ fontSize: 12.5, color: meldung.startsWith('✓') || meldung.startsWith('Nichts') ? G : ROT }}>{meldung}</div>}
    </div>
  )
}
