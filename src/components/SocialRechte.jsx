import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { logActivity } from '../activity'
import { resolvePlatform, SOCIAL_CATEGORY } from './SocialLinks'
import { instaHandle, platzhalterListe } from '../reelSkripte'

// ── Rechte im Social-Team (v5.21.0) ────────────────────────────────────────
// Eine Stelle, an der man sieht und zuteilt, wer auf welchem Account was darf.
//   Posten     = social_account_poster  (braucht die Rolle Poster)
//   Schneiden  = social_account_cutter  (braucht die Rolle Cutter)
//   Hochladen  = social_rechte 'hochladen'  Content in die Ablage des Models
//   Planen     = social_rechte 'planen'     Beiträge anlegen/ändern/löschen (inkl. Hochladen)
//   Freigeben  = social_rechte 'freigeben'  Reels dieses Accounts freigeben
// Social-Leitung (und Admins) dürfen ohnehin alles — nur zur Info angezeigt.
// Datenbank: sql/social-rechte.sql

const P = '#ec4899', C = '#06b6d4', G = '#10b981', A = '#f59e0b', V = '#8b5cf6', L = '#7c3aed', ROT = '#ef4444'
const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 15px' }
const pill = (f) => ({ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: f + '22', color: f, whiteSpace: 'nowrap' })
const th = { fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', textAlign: 'center', padding: '6px 6px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td = { padding: '8px 6px', borderBottom: '1px solid var(--border)', verticalAlign: 'middle', fontSize: 13, textAlign: 'center' }

const RECHTE = [
  { k: 'posten', t: 'Posten', f: G, info: 'Sieht den Plan des Accounts, lädt Dateien herunter und markiert als gepostet.' },
  { k: 'schneiden', t: 'Schneiden', f: '#a855f7', info: 'Bekommt die Rohvideos dieses Accounts zum Schneiden.' },
  { k: 'hochladen', t: 'Hochladen', f: C, info: 'Lädt Content in die Ablage des Models (Fotos, Videos).' },
  { k: 'planen', t: 'Planen', f: P, info: 'Legt Beiträge im Kalender an, ändert, verschiebt, kopiert und löscht sie. Enthält Hochladen.' },
  { k: 'freigeben', t: 'Freigeben', f: A, info: 'Gibt Reels dieses Accounts frei oder schickt sie zurück.' },
]
const ROLLEN_NAME = { social_media: 'Poster', cutter: 'Cutter', social_leitung: 'Social-Leitung', social_freigabe: 'Freigabe' }
const gleich = (x, m, h) => x.model_name === m && String(x.account).toLowerCase() === String(h).toLowerCase()

export default function SocialRechte({ userDisplayName }) {
  const [d, setD] = useState(null)
  const [person, setPerson] = useState('')
  const [hinweis, setHinweis] = useState('')
  const [arbeitet, setArbeitet] = useState('')

  const laden = useCallback(async () => {
    let s = await supabase.from('model_social_service').select('model_name, nicht_betreut, account_modus, platzhalter').eq('service_aktiv', true).order('model_name')
    if (s.error) s = await supabase.from('model_social_service').select('model_name, nicht_betreut, account_modus').eq('service_aktiv', true).order('model_name')
    const namen = (s.data || []).map(x => x.model_name)
    const [b, team, po, cu, re] = await Promise.all([
      namen.length ? supabase.from('model_board').select('model_name, title, content, sort_order').in('model_name', namen).eq('category', SOCIAL_CATEGORY).order('sort_order') : Promise.resolve({ data: [] }),
      supabase.rpc('social_team_liste'),
      supabase.from('social_account_poster').select('model_name, account, poster_name'),
      supabase.from('social_account_cutter').select('model_name, account, cutter_name'),
      supabase.from('social_rechte').select('id, person, model_name, account, recht'),
    ])
    if (re.error) { setD({ fehlt: true }); return }
    const accounts = []
    for (const m of s.data || []) {
      const aus = m.nicht_betreut || []
      for (const x of (b.data || []).filter(x => x.model_name === m.model_name)) {
        if (resolvePlatform(x.title).key !== 'instagram' || !String(x.content || '').trim()) continue
        const h = instaHandle(x.content)
        if (aus.includes(h) || accounts.some(a => a.model === m.model_name && a.handle === h)) continue
        accounts.push({ model: m.model_name, handle: h, selbst: m.account_modus?.[h]?.posten === 'model' })
      }
      for (const p of platzhalterListe(m)) accounts.push({ model: m.model_name, handle: p.handle, name: p.name, platzhalter: true })
    }
    const leute = (team.error ? [] : (team.data || []))
      .filter(x => x.display_name && !['suspended', 'offboarded'].includes(x.status))
      .map(x => ({ name: x.display_name, rollen: (x.roles || []).filter(r => ROLLEN_NAME[r]) }))
      .filter(x => x.rollen.length)
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))
    setD({ fehlt: false, accounts, leute, poster: po.data || [], cutter: cu.data || [], rechte: re.data || [], cutterFehlt: !!cu.error })
  }, [])
  useEffect(() => { laden() }, [laden])

  if (!d) return <div style={{ color: 'var(--text-muted)', padding: 20 }}>Lädt …</div>
  if (d.fehlt) return <div style={{ ...card, color: 'var(--text-muted)', fontSize: 13 }}>Rechte: Datenbank noch nicht eingerichtet. Einmal <code>sql/social-rechte.sql</code> ausführen.</div>

  const { accounts, leute, poster, cutter, rechte } = d
  const istLeitung = (p) => p.rollen.includes('social_leitung')
  const hat = (p, a, k) => {
    if (k === 'posten') return poster.some(x => gleich(x, a.model, a.handle) && x.poster_name === p.name)
    if (k === 'schneiden') return cutter.some(x => gleich(x, a.model, a.handle) && x.cutter_name === p.name)
    return rechte.some(x => gleich(x, a.model, a.handle) && x.person === p.name && x.recht === k)
  }
  const zusammenfassung = (p) => accounts.map(a => ({ a, r: RECHTE.filter(r => hat(p, a, r.k)) })).filter(x => x.r.length)
  const gewaehlt = leute.find(p => p.name === person) || null

  // Grund, warum ein Häkchen nicht gesetzt werden kann
  const gesperrt = (p, a, k) => {
    if (k === 'posten' && !p.rollen.includes('social_media')) return 'Braucht die Rolle „Poster“ (in den Einstellungen bei der Person).'
    if (k === 'schneiden' && !p.rollen.includes('cutter')) return 'Braucht die Rolle „Cutter“ (in den Einstellungen bei der Person).'
    if ((k === 'posten' || k === 'schneiden') && a.platzhalter) return 'Erst beim echten Account (Platzhalter).'
    if ((k === 'posten' || k === 'schneiden') && a.selbst) return `${a.model} postet diesen Account selbst.`
    if (k === 'schneiden' && d.cutterFehlt) return 'Schnitt ist noch nicht eingerichtet.'
    return ''
  }

  const umschalten = async (p, a, k) => {
    const an = hat(p, a, k)
    const key = p.name + a.model + a.handle + k
    setArbeitet(key); setHinweis('')
    let error = null
    if (k === 'posten') {
      ;({ error } = an ? await supabase.from('social_account_poster').delete().eq('model_name', a.model).eq('account', a.handle).eq('poster_name', p.name)
        : await supabase.from('social_account_poster').insert({ model_name: a.model, account: a.handle, poster_name: p.name, erstellt_von: userDisplayName || null }))
    } else if (k === 'schneiden') {
      ;({ error } = an ? await supabase.from('social_account_cutter').delete().eq('model_name', a.model).eq('account', a.handle).eq('cutter_name', p.name)
        : await supabase.from('social_account_cutter').insert({ model_name: a.model, account: a.handle, cutter_name: p.name, erstellt_von: userDisplayName || null }))
    } else {
      ;({ error } = an ? await supabase.from('social_rechte').delete().eq('person', p.name).eq('model_name', a.model).eq('account', a.handle).eq('recht', k)
        : await supabase.from('social_rechte').insert({ person: p.name, model_name: a.model, account: a.handle, recht: k, erstellt_von: userDisplayName || null }))
    }
    setArbeitet('')
    if (error) { setHinweis('Nicht gespeichert: ' + error.message); return }
    logActivity('social.rechte', { entity: `${a.model} ${a.handle}`, detail: `${p.name}: ${RECHTE.find(r => r.k === k).t} ${an ? 'entzogen' : 'gegeben'}` })
    laden()
  }

  const modelle = [...new Set(accounts.map(a => a.model))]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <style>{`.rechte-raster { display: grid; grid-template-columns: minmax(230px, 300px) minmax(0, 1fr); gap: 14px; align-items: start; } @media (max-width: 860px) { .rechte-raster { grid-template-columns: minmax(0, 1fr) !important; } } .rechte-raster input[type=checkbox] { width: 18px !important; height: 18px; cursor: pointer; }`}</style>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Wer im Social-Team auf welchem Account was darf. Links eine Person wählen, rechts per Häkchen zuteilen. Die Social-Leitung darf überall alles.
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {RECHTE.map(r => <span key={r.k} title={r.info} style={{ ...pill(r.f), cursor: 'help' }}>{r.t}</span>)}
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>(Maus drauf = Erklärung)</span>
      </div>
      {hinweis && <div style={{ fontSize: 12.5, color: ROT }}>{hinweis}</div>}

      <div className="rechte-raster">
        {/* Personen mit Zusammenfassung */}
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>Team</div>
          {!leute.length && <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Noch niemand mit einer Social-Rolle.</div>}
          {leute.map(p => {
            const an = p.name === person
            const z = zusammenfassung(p)
            return (
              <button key={p.name} type="button" onClick={() => setPerson(an ? '' : p.name)}
                style={{ textAlign: 'left', padding: '9px 10px', borderRadius: 11, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${an ? P : 'var(--border)'}`, background: an ? P + '14' : 'transparent', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <b style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>{p.name}</b>
                  {p.rollen.map(r => <span key={r} style={pill(r === 'social_leitung' ? L : r === 'cutter' ? '#a855f7' : r === 'social_freigabe' ? A : G)}>{ROLLEN_NAME[r]}</span>)}
                </span>
                {istLeitung(p) ? <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>darf überall alles</span>
                  : !z.length ? <span style={{ fontSize: 11.5, color: A }}>noch keinem Account zugeteilt</span>
                  : z.map(({ a, r }) => (
                    <span key={a.model + a.handle} style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                      <span style={{ color: P, fontWeight: 700 }}>{a.name || a.handle}</span> · {r.map(x => x.t).join(', ')}
                    </span>
                  ))}
              </button>
            )
          })}
        </div>

        {/* Häkchen für die gewählte Person */}
        <div style={{ ...card, minWidth: 0 }}>
          {!gewaehlt ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Links eine Person wählen.</div>
          ) : istLeitung(gewaehlt) ? (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}><b>{gewaehlt.name}</b> ist Social-Leitung und darf auf allen Accounts alles. Einzelne Häkchen sind nicht nötig.</div>
          ) : (
            <>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>{gewaehlt.name}</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                  <thead><tr>
                    <th style={{ ...th, textAlign: 'left' }}>Account</th>
                    {RECHTE.map(r => <th key={r.k} style={{ ...th, color: r.f }} title={r.info}>{r.t}</th>)}
                  </tr></thead>
                  <tbody>
                    {modelle.map(m => (
                      <React.Fragment key={m}>
                        <tr><td colSpan={RECHTE.length + 1} style={{ ...td, textAlign: 'left', fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', paddingTop: 12 }}>{m}</td></tr>
                        {accounts.filter(a => a.model === m).map(a => (
                          <tr key={a.handle}>
                            <td style={{ ...td, textAlign: 'left' }}>
                              <span style={{ color: P, fontWeight: 700 }}>{a.name || a.handle}</span>
                              {a.platzhalter && <span style={{ fontSize: 10.5, color: A, fontWeight: 700 }}> 🚧</span>}
                              {a.selbst && <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}> · postet selbst</span>}
                            </td>
                            {RECHTE.map(r => {
                              const an = hat(gewaehlt, a, r.k)
                              const grund = !an ? gesperrt(gewaehlt, a, r.k) : ''
                              const durchPlanen = r.k === 'hochladen' && !an && hat(gewaehlt, a, 'planen')
                              const key = gewaehlt.name + a.model + a.handle + r.k
                              return (
                                <td key={r.k} style={td} title={grund || (durchPlanen ? 'Durch „Planen“ schon enthalten' : r.info)}>
                                  <input type="checkbox" checked={an || durchPlanen} disabled={!!grund || durchPlanen || arbeitet === key}
                                    onChange={() => umschalten(gewaehlt, a, r.k)} style={{ accentColor: r.f, opacity: grund ? 0.35 : 1 }} />
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                    {!accounts.length && <tr><td colSpan={RECHTE.length + 1} style={{ ...td, color: 'var(--text-muted)' }}>Noch kein Account im Service.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
                Ausgegraute Häkchen: Rolle fehlt (Poster/Cutter vergibst du in den Einstellungen bei der Person) oder der Account ist noch ein Platzhalter.
                Hochladen landet immer in der Ablage des Models; Planen enthält Hochladen.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
