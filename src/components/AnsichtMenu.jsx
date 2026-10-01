import React, { useEffect, useRef, useState } from 'react'
import { Eye, ChevronDown } from 'lucide-react'
import { supabase } from '../supabase'

// ── „👁 Ansicht ▾“ in der Kopfzeile (v5.3.0) ────────────────────────────────
// Ein Knopf statt „Chatter“ und „Model“ einzeln. Darin:
//   Chatter-Ansicht · Model-Ansicht · Social: jede Person aus dem Social-Team
// Die Social-Ansicht öffnet dieselbe Vollbild-Vorschau wie Steuerung → Team
// (nur ansehen, nichts wird gespeichert).

const ROLLEN_NAME = { social_media: 'Poster', cutter: 'Cutter', social_leitung: 'Social-Leitung', chatter: 'Chatter' }

export default function AnsichtMenu({ onChatter, onModel, onSocial }) {
  const [auf, setAuf] = useState(false)
  // v5.14.0: am Handy lief das Menü (rechtsbündig am Knopf, 250 px breit) links aus dem Bild.
  // Jetzt dort fest unter dem Knopf über die ganze Breite.
  const [lage, setLage] = useState(null)
  const [team, setTeam] = useState(null)
  const ref = useRef(null)
  useEffect(() => {
    if (!auf) return
    const zu = (e) => { if (ref.current && !ref.current.contains(e.target)) setAuf(false) }
    document.addEventListener('mousedown', zu)
    return () => document.removeEventListener('mousedown', zu)
  }, [auf])
  useEffect(() => {
    if (!auf || team) return
    ;(async () => {
      const r = await supabase.rpc('social_team_liste')
      const leute = (r.error ? [] : (r.data || [])).filter(x => !['suspended', 'offboarded'].includes(x.status))
        .filter(x => (x.roles || []).some(k => k === 'social_media' || k === 'cutter'))
      const sp = leute.length ? await supabase.from('user_roles').select('display_name, sprache').in('display_name', leute.map(x => x.display_name)) : { data: [] }
      const sprache = Object.fromEntries((sp.data || []).map(x => [x.display_name, x.sprache]))
      setTeam(leute.map(x => ({ name: x.display_name, rollen: (x.roles || []).filter(k => ['social_media', 'cutter', 'chatter'].includes(k)), sprache: sprache[x.display_name] || 'de' }))
        .sort((a, b) => a.name.localeCompare(b.name)))
    })()
  }, [auf, team])

  const eintrag = (farbe) => ({ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, borderLeft: `3px solid ${farbe}` })
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        const vw = window.innerWidth || 1000
        setLage(vw <= 768 || r.right < 260 ? { position: 'fixed', left: 10, right: 10, top: Math.round(r.bottom + 6), width: 'auto', maxHeight: `calc(100vh - ${Math.round(r.bottom + 20)}px)`, overflowY: 'auto' } : null)
        setAuf(a => !a)
      }} title="Ansicht anderer Rollen" style={{
        fontSize: 12, padding: '6px 10px', borderRadius: 6, background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.3)',
        color: '#06b6d4', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4,
      }}>
        <Eye size={13} /><span>Ansicht</span><ChevronDown size={12} />
      </button>
      {auf && (
        <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 2000, width: 250, background: 'var(--bg-card)', border: '1px solid var(--border-bright, var(--border))', borderRadius: 12, boxShadow: '0 16px 40px rgba(0,0,0,0.5)', padding: 6, display: 'flex', flexDirection: 'column', gap: 2, ...(lage || {}) }}>
          <button type="button" onClick={() => { setAuf(false); onChatter() }} style={eintrag('#06b6d4')}>💬 Chatter-Ansicht</button>
          <button type="button" onClick={() => { setAuf(false); onModel() }} style={eintrag('#f59e0b')}>⭐ Model-Ansicht</button>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-muted)', padding: '8px 12px 3px' }}>Social-Team</div>
          {team === null && <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 12px' }}>Lädt …</div>}
          {team && !team.length && <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 12px' }}>Noch niemand mit Poster/Cutter.</div>}
          {(team || []).map(p => (
            <button key={p.name} type="button" onClick={() => { setAuf(false); onSocial(p) }} style={eintrag('#ec4899')}>
              📱 <span style={{ flex: 1 }}>{p.name}</span>
              <span style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 500 }}>{p.rollen.filter(r => r !== 'chatter').map(r => ROLLEN_NAME[r]).join(' + ')}{p.sprache === 'en' ? ' · EN' : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
