// ── Einstellungen → Team: Zwei-Faktor-Übersicht & Notfall (v5.42.0) ───────
// Zeigt, welche Admins/Manager ihre Authenticator-App eingerichtet haben.
// „Zurücksetzen“ löscht nur die App-Verknüpfung (z. B. Handy verloren) — die
// Person richtet beim nächsten Login neu ein. Eigenes geht hier nicht.
import React, { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { supabase } from '../supabase'
import { teamStand, zuruecksetzen } from '../zweiFaktor'
import { logActivity } from '../activity'

const datum = (t) => (t ? new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '')

export default function ZweiFaktorTeam() {
  const [liste, setListe] = useState(null)
  const [fehler, setFehler] = useState('')
  const [ich, setIch] = useState(null)
  const [frage, setFrage] = useState(null)   // Zeile, die zurückgesetzt werden soll
  const [busy, setBusy] = useState(false)

  const laden = async () => {
    try { setListe(await teamStand()); setFehler('') }
    catch (e) {
      const m = String(e?.message || e)
      setFehler(/zwei_faktor_stand|function|schema cache/i.test(m) ? 'SQL „zwei-faktor.sql“ ist noch nicht ausgeführt.' : m)
      setListe([])
    }
  }
  useEffect(() => {
    laden()
    supabase.auth.getUser().then(({ data }) => setIch(data?.user?.id || null))
  }, [])

  const bestaetigen = async () => {
    if (!frage) return
    setBusy(true)
    try {
      await zuruecksetzen(frage.user_id)
      logActivity('user.2fa_reset', { entity: frage.display_name, detail: 'Zwei-Faktor zurückgesetzt' })
      setFrage(null); await laden()
    } catch (e) { setFehler(String(e?.message || e)) }
    setBusy(false)
  }

  return (
    <div className="zf-team">
      <div className="zf-team-kopf"><ShieldCheck size={16} /> Zwei-Faktor im Team</div>
      <div className="zf-warn">Pflicht für Admin &amp; Manager. Wer noch nicht eingerichtet hat, wird beim nächsten Login dazu aufgefordert.</div>
      {fehler && <div className="zf-fehler">{fehler}</div>}
      {liste === null && <div className="zf-leer">lädt …</div>}
      {liste?.map(z => (
        <div key={z.user_id} className="zf-zeile">
          <div>
            <div className="zf-name">{z.display_name || '—'}{z.user_id === ich && <span className="zf-du"> (du)</span>}</div>
            <div className="zf-rolle">{z.rolle === 'admin' ? 'Admin' : 'Manager'}{z.aktiv && z.seit ? ` · seit ${datum(z.seit)}` : ''}</div>
          </div>
          <div className="zf-rechts">
            <span className={`zf-pill ${z.aktiv ? 'ok' : 'no'}`}>{z.aktiv ? '✓ aktiv' : 'noch nicht'}</span>
            {z.aktiv && z.user_id !== ich && <button className="zf-mini" onClick={() => setFrage(z)}>Zurücksetzen</button>}
          </div>
        </div>
      ))}
      {liste && liste.length > 0 && (
        <div className="zf-zeile">
          <div><div className="zf-name">Chatter, Models, Social</div><div className="zf-rolle">nicht nötig</div></div>
          <span className="zf-pill aus">aus</span>
        </div>
      )}

      {frage && (
        <div className="zf-frage">
          <div><b>{frage.display_name}</b>: Zwei-Faktor zurücksetzen? Die App-Verknüpfung wird gelöscht; beim nächsten Login richtet {frage.display_name} neu ein.</div>
          <div className="zf-frage-knoepfe">
            <button className="zf-mini" onClick={() => setFrage(null)} disabled={busy}>Abbrechen</button>
            <button className="zf-mini rot" onClick={bestaetigen} disabled={busy}>{busy ? '…' : 'Zurücksetzen'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
