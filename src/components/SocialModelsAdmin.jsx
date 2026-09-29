import React, { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import SocialFragebogenAdmin from './SocialFragebogenAdmin'
import ReelSkripteAdmin from './ReelSkripteAdmin'

// ── Social Media → Models (v4.108.0, nur Admins) ──────────────────────────
// Vorher lagen diese Blöcke unter Kommunikation → Creator beim Model. Jetzt
// ist alles zu Social Media an einer Stelle:
//   links  alle aktiven Models, mit „im Service“ und Fragebogen-Stand
//   rechts für das gewählte Model: Service an/aus, Fragebogen, Antworten,
//          Accounts (+ Account, Kurzbeschreibung), Posting ab, und die Reels
// Aus Kommunikation → Creator kommt man über „Social Media öffnen“ hierher;
// das gewählte Model wird über sessionStorage „social_model_wahl“ übergeben.

const P = '#ec4899'
const pill = (f) => ({ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: f + '22', color: f, whiteSpace: 'nowrap' })
const FB = { offen: ['Fragebogen geschickt', '#f59e0b'], laeuft: ['Fragebogen läuft', '#06b6d4'], fertig: ['Fragebogen fertig', '#10b981'] }

export default function SocialModelsAdmin({ userDisplayName }) {
  const [models, setModels] = useState(null)
  const [service, setService] = useState({})
  const [gewaehlt, setGewaehlt] = useState(() => { try { return sessionStorage.getItem('social_model_wahl') || null } catch { return null } })
  const [nurService, setNurService] = useState(false)

  const laden = async () => {
    const [m, s] = await Promise.all([
      // v5.1.0: Admins lesen models_contact direkt (brauchen die Telegram-ID).
      // Die Social-Leitung darf das nicht — für sie kommt die Liste über eine Funktion.
      supabase.from('models_contact').select('*').order('name').then(x => (!x.error && (x.data || []).length) ? x
        : supabase.rpc('social_models_liste').then(y => y.error ? x : { ...y, data: (y.data || []).sort((a, b) => String(a.name).localeCompare(String(b.name))) })),
      supabase.from('model_social_service').select('model_name, service_aktiv, fragebogen_status'),
    ])
    setModels((m.data || []).filter(x => x.active !== false))
    setService(Object.fromEntries((s.data || []).map(x => [x.model_name, x])))
  }
  useEffect(() => { laden() }, [])
  useEffect(() => { try { sessionStorage.removeItem('social_model_wahl') } catch { /* egal */ } }, [])

  if (!models) return <div style={{ color: 'var(--text-muted)', padding: 20 }}>Lädt …</div>
  const liste = nurService ? models.filter(m => service[m.name]?.service_aktiv) : models
  const auswahl = models.find(m => m.name === gewaehlt)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) 1fr', gap: 16, alignItems: 'start' }} className="social-models-raster">
      <style>{`@media (max-width: 760px) { .social-models-raster { grid-template-columns: 1fr !important; } }`}</style>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <b style={{ flex: 1, color: 'var(--text-primary)' }}>Models</b>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={nurService} onChange={e => setNurService(e.target.checked)} /> nur im Service
          </label>
        </div>
        {liste.map(m => {
          const sv = service[m.name]
          const an = m.name === gewaehlt
          return (
            <button key={m.id || m.name} type="button" onClick={() => setGewaehlt(m.name)}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, padding: '9px 11px', borderRadius: 11, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', background: an ? 'rgba(236,72,153,0.12)' : 'var(--bg-card2)', border: `1px solid ${an ? P : 'var(--border)'}` }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{m.name}</span>
              <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {sv?.service_aktiv ? <span style={pill(P)}>im Service</span> : <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>nicht im Service</span>}
                {sv?.fragebogen_status && FB[sv.fragebogen_status] && <span style={pill(FB[sv.fragebogen_status][1])}>{FB[sv.fragebogen_status][0]}</span>}
              </span>
            </button>
          )
        })}
        {!liste.length && <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Keine Models.</div>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        {!auswahl && <div style={{ background: 'var(--bg-card)', border: '1px dashed var(--border)', borderRadius: 16, padding: 20, color: 'var(--text-muted)', fontSize: 13.5 }}>Links ein Model wählen. Dort: in den Service aufnehmen, Social-Media-Fragebogen schicken, Accounts pflegen und die Reels des Models.</div>}
        {auswahl && (
          <>
            <SocialFragebogenAdmin key={'fb:' + auswahl.name} models={models} gewaehlt={auswahl.name} userName={userDisplayName} startOffen onGeaendert={laden} />
            <ReelSkripteAdmin key={'reels:' + auswahl.name} models={models} gewaehlt={auswahl.name} userName={userDisplayName} />
          </>
        )}
      </div>
    </div>
  )
}

// Kleiner Hinweis unter Kommunikation → Creator beim Model: dort lagen die
// Social-Blöcke bis v4.107.0. Ein Klick öffnet Social Media → Models mit
// diesem Model.
export function SocialMediaHinweis({ modelName }) {
  const [sv, setSv] = useState(undefined)
  useEffect(() => {
    let weg = false
    supabase.from('model_social_service').select('service_aktiv, fragebogen_status').eq('model_name', modelName).maybeSingle()
      .then(({ data, error }) => { if (!weg) setSv(error ? null : (data || null)) })
    return () => { weg = true }
  }, [modelName])
  const oeffnen = async () => {
    try { sessionStorage.setItem('social_model_wahl', modelName) } catch { /* egal */ }
    const { routeSchreiben } = await import('../route')
    routeSchreiben({ tab: 'social-models' })
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'var(--bg-card)', border: `1px solid ${sv?.service_aktiv ? 'rgba(236,72,153,0.45)' : 'var(--border)'}`, borderRadius: 14, padding: '10px 14px' }}>
      <span style={{ fontSize: 18 }}>📱</span>
      <span style={{ flex: 1, minWidth: 180, fontSize: 13.5, color: 'var(--text-primary)' }}>
        <b>Social Media · {modelName}</b>{' '}
        {sv === undefined ? '' : sv?.service_aktiv ? <span style={pill(P)}>im Service</span> : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>nicht im Service</span>}
        {sv?.fragebogen_status && FB[sv.fragebogen_status] && <> <span style={pill(FB[sv.fragebogen_status][1])}>{FB[sv.fragebogen_status][0]}</span></>}
      </span>
      <button type="button" onClick={oeffnen} style={{ padding: '7px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${P}`, background: 'transparent', color: P }}>In Social Media öffnen →</button>
    </div>
  )
}
