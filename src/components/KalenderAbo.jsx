// v4.67.0: Kalender-Abo fürs Handy (Apple / Google / Android).
// Jede Person bekommt einen eigenen geheimen Link (RPC kalender_abo_link).
// Die Edge Function `kalender-ics` liefert darüber nur die eigenen Einträge
// und die eigenen Schichten — nur lesen, Änderungen kommen mit Verzögerung.
import React, { useState, useCallback } from 'react'
import { supabase, FUNCTIONS_URL } from '../supabase'

export default function KalenderAbo({ isPreview, voll }) {
  const [offen, setOffen] = useState(false)
  const [abo, setAbo] = useState(undefined) // undefined = lädt, null = keins, { token, zuletzt_abgerufen }
  const [laeuft, setLaeuft] = useState(false)
  const [kopiert, setKopiert] = useState(false)
  const [fehler, setFehler] = useState(null)

  const laden = useCallback(async () => {
    setFehler(null)
    const { data, error } = await supabase.from('kalender_abos').select('token, zuletzt_abgerufen, erstellt_am').maybeSingle()
    if (error) { setAbo(null); setFehler(error.message.includes('kalender_abos') ? 'Das Abo ist noch nicht eingerichtet (SQL „kalender-abo.sql" fehlt).' : error.message); return }
    setAbo(data || null)
  }, [])

  const umschalten = () => { const n = !offen; setOffen(n); if (n) laden() }

  const erzeugen = async (neu) => {
    if (isPreview) { alert('In der Vorschau wird kein Abo im Namen der Person angelegt.'); return }
    if (neu && !confirm('Neuen Link erzeugen?\n\nDer alte Link funktioniert sofort nicht mehr. Auf allen Handys, auf denen das Abo eingerichtet ist, muss es neu eingerichtet werden.')) return
    setLaeuft(true)
    const { error } = await supabase.rpc('kalender_abo_link', { p_neu: !!neu })
    setLaeuft(false)
    if (error) { alert('⚠ ' + error.message); return }
    laden()
  }
  const beenden = async () => {
    if (!confirm('Abo beenden?\n\nDer Link funktioniert danach nicht mehr. Im Handy-Kalender bleibt der Kalender leer stehen — dort bitte selbst entfernen.')) return
    const { error } = await supabase.rpc('kalender_abo_beenden')
    if (error) { alert('⚠ ' + error.message); return }
    laden()
  }

  const https = abo?.token ? `${FUNCTIONS_URL}/kalender-ics?t=${abo.token}` : ''
  const webcal = https.replace(/^https?:\/\//, 'webcal://')
  const kopieren = async () => {
    try { await navigator.clipboard.writeText(https); setKopiert(true); setTimeout(() => setKopiert(false), 2500) }
    catch { window.prompt('Link kopieren:', https) }
  }

  const btn = (primaer) => ({ padding: '8px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center', textDecoration: 'none', display: 'inline-block', background: primaer ? '#7c3aed' : 'transparent', color: primaer ? '#fff' : 'var(--text-secondary)', border: `1px solid ${primaer ? '#7c3aed' : 'var(--border)'}` })
  const schritt = { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }

  return (
    <div>
      <button onClick={umschalten} style={{ ...btn(false), width: voll ? '100%' : 'auto', fontWeight: 600 }}>📲 Im Handy-Kalender {offen ? '▴' : '▾'}</button>
      {offen && (
        <div style={{ marginTop: 8, background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Deine Einträge und deine Schichten erscheinen im Kalender deines Handys. <b>Nur lesen</b> — Änderungen macht ihr weiter hier. Neues kommt mit Verzögerung an (iPhone meist unter 1 Std., Google bis zu 1 Tag); Wichtiges kommt wie bisher per Telegram.
          </div>
          {fehler && <div style={{ fontSize: 12, color: '#ef4444' }}>⚠ {fehler}</div>}
          {abo === undefined && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Lädt …</div>}
          {abo === null && !fehler && (
            <button onClick={() => erzeugen(false)} disabled={laeuft} style={btn(true)}>{laeuft ? 'Einen Moment …' : 'Abo einrichten'}</button>
          )}
          {abo && abo.token && (
            <>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>iPhone · iPad · Mac</div>
                <a href={webcal} style={{ ...btn(true), display: 'block' }}>In Apple Kalender abonnieren</a>
                <div style={{ ...schritt, marginTop: 4 }}>Auf dem iPhone antippen → „Abonnieren" → „Hinzufügen".</div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Android · Google Kalender</div>
                <button onClick={kopieren} style={{ ...btn(false), width: '100%' }}>{kopiert ? '✓ Link kopiert' : 'Link kopieren'}</button>
                <ol style={{ ...schritt, margin: '6px 0 0', paddingLeft: 18 }}>
                  <li>Am <b>Computer</b> calendar.google.com öffnen (in der Handy-App geht das nicht).</li>
                  <li>Links bei „Weitere Kalender" auf <b>+</b> → „Per URL" → Link einfügen → „Kalender hinzufügen".</li>
                  <li>In der Google-Kalender-App erscheint er dann automatisch (sonst: Einstellungen → Kalender → „Synchronisieren" an).</li>
                </ol>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {abo.zuletzt_abgerufen ? `✓ Zuletzt vom Kalender abgerufen: ${new Date(abo.zuletzt_abgerufen).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Noch von keinem Kalender abgerufen.'}
              </div>
              <div style={{ fontSize: 11, color: '#f59e0b', lineHeight: 1.45 }}>🔒 Der Link ist persönlich. Wer ihn hat, sieht deine Einträge — nicht weitergeben.</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button onClick={() => erzeugen(true)} disabled={laeuft} style={{ ...btn(false), fontSize: 11, padding: '5px 9px' }}>Neuen Link erzeugen</button>
                <button onClick={beenden} style={{ ...btn(false), fontSize: 11, padding: '5px 9px', color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' }}>Abo beenden</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
