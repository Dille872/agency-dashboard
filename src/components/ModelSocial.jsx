import React, { useEffect, useRef, useState } from 'react'
import ModelDrehzettel from './ModelDrehzettel'
import { PlanModel } from './SocialPlan'
import { WirkungModel } from './WirkungKurven'

// ── Social im Model-Portal mit Reitern (v5.26.0) ───────────────────────────
// Vorher standen Drehzettel, Plan, Wirkung und Fragebogen untereinander.
// Jetzt vier kleine Reiter. Beim Öffnen: Ist etwas zu drehen → Drehzettel,
// sonst der zuletzt gewählte Reiter (Standard: Plan). Am Handy klebt die
// Reiterleiste beim Scrollen oben.
//
// Drehzettel bleibt immer geladen (nur versteckt), damit die Zahl am Reiter
// stimmt. Plan und Wirkung werden erst beim Antippen geladen.

const SPEICHER = 'model_social_reiter_v1'
const lies = () => { try { return localStorage.getItem(SPEICHER) } catch { return null } }
const merke = (r) => { try { localStorage.setItem(SPEICHER, r) } catch { /* egal */ } }
const GUELTIG = ['dz', 'plan', 'wk', 'pf']

export default function ModelSocial({ displayName, logActivity, isPreview, cardS = {}, HelpDot, service = null, fragebogen = null, fragebogenOffen = false, onKanaele }) {
  const [zuDrehen, setZuDrehen] = useState(null)   // null = lädt noch
  const [reiter, setReiter] = useState(null)
  const gewaehlt = useRef(false)

  // Start-Reiter festlegen, sobald die Drehzettel geladen sind
  useEffect(() => {
    if (gewaehlt.current || zuDrehen === null) return
    gewaehlt.current = true
    const alt = lies()
    setReiter(zuDrehen > 0 ? 'dz' : (GUELTIG.includes(alt) ? alt : 'plan'))
  }, [zuDrehen])
  // Falls die Drehzettel gar nicht laden (Fehler), nach kurzer Zeit trotzdem etwas zeigen
  useEffect(() => {
    const t = setTimeout(() => { if (!gewaehlt.current) { gewaehlt.current = true; const alt = lies(); setReiter(GUELTIG.includes(alt) ? alt : 'dz') } }, 2500)
    return () => clearTimeout(t)
  }, [])

  const waehle = (r) => {
    setReiter(r); merke(r)
    // am Handy nach oben zum Reiter springen, damit man nicht mitten im Inhalt landet
    try { document.querySelector('.ms-reiter')?.scrollIntoView({ block: 'nearest' }) } catch { /* egal */ }
  }

  const liste = [
    { k: 'dz', ico: '🎬', t: 'Drehzettel', badge: zuDrehen > 0 ? zuDrehen : null },
    { k: 'plan', ico: '📅', t: 'Plan' },
    { k: 'wk', ico: '📈', t: 'Wirkung' },
    { k: 'pf', ico: '📝', t: 'Profil', punkt: fragebogenOffen },
  ]
  const akt = reiter || 'dz'

  return (
    <div className="ms-wrap">
      <div className="ms-reiter" role="tablist">
        {liste.map(r => (
          <button key={r.k} type="button" role="tab" aria-selected={akt === r.k}
            className={'ms-knopf' + (akt === r.k ? ' an' : '')} onClick={() => waehle(r.k)}>
            <span className="ms-ico">{r.ico}</span>
            <span className="ms-text">{r.t}</span>
            {r.badge ? <span className="ms-badge">{r.badge}</span> : null}
            {r.punkt ? <span className="ms-punkt" /> : null}
          </button>
        ))}
      </div>

      {/* Drehzettel: immer geladen, damit die Zahl am Reiter stimmt */}
      <div style={{ display: akt === 'dz' ? 'flex' : 'none', flexDirection: 'column', gap: 10 }}>
        {zuDrehen > 0 && (
          <div style={{ ...cardS, padding: '10px 14px', fontSize: 13, color: 'var(--text-secondary)', background: 'linear-gradient(135deg, rgba(245,158,11,0.12), var(--bg-card) 70%)', borderColor: 'rgba(245,158,11,0.4)' }}>
            🎬 <b style={{ color: 'var(--text-primary)' }}>{zuDrehen === 1 ? '1 Skript wartet' : `${zuDrehen} Skripte warten`} auf dich.</b> Drehen, hochladen, fertig. Das Video landet automatisch im Plan.
          </div>
        )}
        <ModelDrehzettel displayName={displayName} logActivity={logActivity} isPreview={isPreview} cardS={cardS} HelpDot={HelpDot}
          notizen={service?.account_notizen || {}} service={service} imReiter onZahl={setZuDrehen}
          leerText="Noch keine Drehzettel. Sobald wir ein Reel für dich geschrieben haben, erscheint es hier." />
      </div>

      {akt === 'plan' && <PlanModel displayName={displayName} isPreview={isPreview} cardS={cardS} service={service} />}

      {akt === 'wk' && <WirkungModel displayName={displayName} service={service} cardS={cardS}
        leerText="Sobald wir für dich Reels posten, siehst du hier, wie viele Aufrufe sie bekommen." />}

      {akt === 'pf' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {fragebogen}
          <div style={{ ...cardS, padding: '14px 15px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24 }}>🔗</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)' }}>Deine Kanäle</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Instagram, TikTok und Co. trägst du in deinem Board ein.</div>
            </div>
            {onKanaele && (
              <button type="button" onClick={onKanaele} style={{ padding: '9px 13px', borderRadius: 11, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>Zum Board</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
