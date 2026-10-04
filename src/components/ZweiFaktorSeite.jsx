// ── Zwei-Faktor: Einrichten bzw. Code eingeben (v5.42.0) ───────────────────
// Erscheint nach dem Passwort für Admin und Manager, bevor irgendwelche Daten
// geladen werden. Nach erfolgreichem Code wird die Seite neu geladen — dann
// hat die Anmeldung „aal2“ und die Datenbank gibt die Daten frei.
import React, { useEffect, useRef, useState } from 'react'
import { ShieldCheck, Smartphone, Copy, Check } from 'lucide-react'
import { einrichtungStarten, meineApp, codePruefen, geheimSchoen, fehlerText } from '../zweiFaktor'

export default function ZweiFaktorSeite({ modus, name, onAbmelden }) {
  const einrichten = modus === 'einrichten'
  const [faktor, setFaktor] = useState(null)     // { id, qr?, secret? }
  const [ladeFehler, setLadeFehler] = useState('')
  const [code, setCode] = useState('')
  const [fehler, setFehler] = useState('')
  const [busy, setBusy] = useState(false)
  const [kopiert, setKopiert] = useState(false)
  const eingabe = useRef(null)
  const gestartet = useRef(false)

  useEffect(() => {
    if (gestartet.current) return
    gestartet.current = true
    ;(async () => {
      try {
        if (einrichten) setFaktor(await einrichtungStarten())
        else {
          const f = await meineApp()
          if (!f) throw new Error('Keine eingerichtete App gefunden. Bitte neu laden.')
          setFaktor({ id: f.id })
        }
      } catch (e) { setLadeFehler(fehlerText(e)) }
    })()
  }, [einrichten])

  useEffect(() => { if (faktor) setTimeout(() => eingabe.current?.focus(), 50) }, [faktor])

  const absenden = async (wert = code) => {
    if (!faktor || busy || wert.length !== 6) return
    setBusy(true); setFehler('')
    try {
      await codePruefen(faktor.id, wert)
      window.location.reload()
    } catch (e) {
      setFehler(fehlerText(e)); setCode(''); setBusy(false)
      setTimeout(() => eingabe.current?.focus(), 30)
    }
  }

  const tippen = (v) => {
    const nur = v.replace(/\D/g, '').slice(0, 6)
    setCode(nur); setFehler('')
    if (nur.length === 6) absenden(nur)
  }

  const kopieren = async () => {
    try { await navigator.clipboard.writeText(faktor?.secret || ''); setKopiert(true); setTimeout(() => setKopiert(false), 1500) } catch { /* egal */ }
  }

  return (
    <div className="zf-seite">
      <div className="zf-box">
        <div className="zf-ico">{einrichten ? <ShieldCheck size={22} /> : <Smartphone size={22} />}</div>
        <h2>{einrichten ? 'Zwei-Faktor einrichten' : 'Code eingeben'}</h2>
        {einrichten ? (
          <>
            <p>{name ? `${name}, dein` : 'Dein'} Konto sieht Umsätze und Rechnungen. Deshalb braucht es ab jetzt einen zweiten Schutz.</p>
            <ol className="zf-schritte">
              <li><span>1</span><div>Öffne eine <b>Authenticator-App</b> (Google Authenticator, Microsoft Authenticator oder iPhone-Passwörter)</div></li>
              <li><span>2</span><div>Scanne diesen <b>QR-Code</b></div></li>
              <li><span>3</span><div>Gib den <b>6-stelligen Code</b> aus der App ein</div></li>
            </ol>
            <div className="zf-qr">
              {faktor?.qr ? <img src={faktor.qr} alt="QR-Code für die Authenticator-App" /> : <div className="zf-qr-leer">{ladeFehler ? '–' : 'lädt …'}</div>}
            </div>
            {faktor?.secret && (
              <button type="button" className="zf-geheim" onClick={kopieren} title="Kopieren">
                <span>Kein Scan möglich? Code abtippen:</span>
                <b>{geheimSchoen(faktor.secret)}</b>
                <i>{kopiert ? <><Check size={12} /> kopiert</> : <><Copy size={12} /> kopieren</>}</i>
              </button>
            )}
          </>
        ) : (
          <p>Passwort stimmt. Öffne deine Authenticator-App und gib den Code für <b>Thirteen 87</b> ein.</p>
        )}

        {ladeFehler ? (
          <div className="zf-fehler">{ladeFehler}</div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); absenden() }}>
            <input ref={eingabe} className="zf-code" value={code} onChange={(e) => tippen(e.target.value)}
              inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6}
              placeholder="000000" disabled={!faktor || busy} aria-label="6-stelliger Code" />
            {fehler && <div className="zf-fehler">{fehler}</div>}
            <button type="submit" className="zf-btn" disabled={!faktor || busy || code.length !== 6}>
              {busy ? 'Prüfe …' : einrichten ? 'Bestätigen' : 'Anmelden'}
            </button>
          </form>
        )}
        <button type="button" className="zf-btn2" onClick={onAbmelden}>{einrichten ? 'Abmelden' : 'Anderes Konto · Abmelden'}</button>
        {!einrichten && <div className="zf-hint">Handy verloren? Ein anderer Admin kann deinen Zwei-Faktor unter Einstellungen → Team zurücksetzen.</div>}
        {ladeFehler && <button type="button" className="zf-btn2" onClick={() => window.location.reload()}>Neu laden</button>}
      </div>
    </div>
  )
}
