import React, { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { logActivity } from '../activity'
import { resolvePlatform, SOCIAL_CATEGORY } from './SocialLinks'
import { SkriptKarte } from './ReelSkripteAdmin'
import { statusVon, instaHandle, skriptAnlegen, dateinameLesen, agenturAccountAnlegen } from '../reelSkripte'
import { serviceSpeichern } from '../socialProfil'

// ── Social-Steuerung (v4.103.0) — nur für Admins/Manager ──────────────────
// Reiter im Social Media Manager. Hier läuft alles zusammen:
//   • Accounts & Poster: jede Zeile = ein Instagram-Account eines Models im
//     Service. Poster zuteilen/entfernen (social_account_poster), Zahlen je
//     Account, Drehzettel direkt für diesen Account hochladen, Skripte
//     aufklappen und bearbeiten (dieselbe Karte wie unter Kommunikation).
//   • Poster: Auslastung je Person.
//   • Zuletzt gepostet: alles, was raus ist.
//   • „Drehzettel hochladen“: mehrere PDFs auf einmal; Model, Account und
//     Titel werden aus dem Dateinamen vorgeschlagen.
// Ein Account ohne Poster ist für Poster unsichtbar (sql/social-steuerung.sql).
// Nur Deutsch — die Steuerung sehen nur Admins.

const P = '#ec4899', C = '#06b6d4', G = '#10b981', A = '#f59e0b', ROT = '#ef4444', L = '#7c3aed'
const ALT_TAGE = 5
const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 15px' }
const th = { fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td = { padding: '9px 8px', borderBottom: '1px solid var(--border)', verticalAlign: 'middle', fontSize: 13 }
const pill = (f) => ({ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: f + '22', color: f, whiteSpace: 'nowrap' })
const knopf = (f, voll) => ({ padding: '7px 11px', borderRadius: 10, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', border: voll ? 'none' : `1px solid ${f}`, background: voll ? f : 'transparent', color: voll ? '#fff' : f, whiteSpace: 'nowrap' })
const eingabe = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 9, fontSize: 12.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', width: '100%' }
const tageSeit = (iso) => iso ? Math.max(0, Math.floor((Date.now() - new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).getTime()) / 86400000)) : null
const seitText = (n) => n === null ? '—' : n === 0 ? 'heute' : n === 1 ? 'gestern' : `vor ${n} Tagen`
const datum = (iso) => iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : '—'
const schluessel = (m, a) => m + '|' + a

export default function SocialSteuerung({ userDisplayName }) {
  const [d, setD] = useState(null)
  const [offenZeile, setOffenZeile] = useState(null)       // Skripte aufgeklappt
  const [alleSkripte, setAlleSkripte] = useState(false)
  const [upload, setUpload] = useState(null)               // null | { model, account }
  const [ausOffen, setAusOffen] = useState(false)          // v4.105.0
  const [neuAccount, setNeuAccount] = useState(null)       // v4.104.0: null | '' | Model-Name (vorbelegt)
  const [hinweis, setHinweis] = useState('')

  const laden = useCallback(async () => {
    const s = await supabase.from('model_social_service').select('model_name, service_aktiv, posting_ab, account_notizen, nicht_betreut').eq('service_aktiv', true).order('model_name')
    const z = await supabase.from('social_account_poster').select('*')
    if (s.error || z.error) { setD({ fehlt: true }); return }
    const namen = (s.data || []).map(x => x.model_name)
    const [b, sk, r] = await Promise.all([
      namen.length ? supabase.from('model_board').select('model_name, title, content, sort_order, von_agentur').in('model_name', namen).eq('category', SOCIAL_CATEGORY).order('sort_order') : Promise.resolve({ data: [] }),
      supabase.from('reel_skripte').select('*').order('erstellt_am', { ascending: false }).limit(1000),
      supabase.from('user_roles').select('display_name, roles, status').contains('roles', ['social_media']),
    ])
    const models = {}
    for (const m of s.data || []) models[m.model_name] = { ...m, accounts: [] }
    for (const x of b.data || []) {
      const m = models[x.model_name]
      if (!m || resolvePlatform(x.title).key !== 'instagram' || !String(x.content || '').trim()) continue
      const h = instaHandle(x.content)
      if (!m.accounts.some(a => a.handle === h)) m.accounts.push({ handle: h, url: /^https?:\/\//i.test(x.content) ? x.content : `https://${x.content}`, imBoard: true, agentur: !!x.von_agentur })
    }
    const skripte = (sk.data || [])
    // Accounts, die nur noch in Skripten oder Zuteilungen stehen (Link aus dem Board entfernt)
    const nachtragen = (model, h) => { const m = models[model]; if (m && h && !m.accounts.some(a => a.handle === h)) m.accounts.push({ handle: h, url: null, imBoard: false }) }
    skripte.forEach(x => nachtragen(x.model_name, x.ziel_account))
    ;(z.data || []).forEach(x => nachtragen(x.model_name, x.account))
    // v4.105.0: nicht betreute Accounts markieren
    for (const m of Object.values(models)) for (const a of m.accounts) a.betreut = !(m.nicht_betreut || []).includes(a.handle)
    const poster = (r.data || []).filter(x => !['suspended', 'offboarded'].includes(x.status) && x.display_name).map(x => x.display_name).sort((a, b) => a.localeCompare(b))
    setD({ fehlt: false, models, zuteilung: z.data || [], skripte, poster })
  }, [])
  useEffect(() => { laden() }, [laden])

  if (!d) return <div style={{ color: 'var(--text-muted)', padding: 20 }}>Lädt …</div>
  if (d.fehlt) return <div style={{ ...card, color: 'var(--text-muted)', fontSize: 13 }}>Steuerung: Datenbank noch nicht eingerichtet. Einmal <code>sql/social-steuerung.sql</code> ausführen.</div>

  const { models, zuteilung, skripte, poster } = d
  const aktiv = skripte.filter(s => !s.verworfen && models[s.model_name])
  const posterVon = (m, a) => zuteilung.filter(z => z.model_name === m && z.account === a).map(z => z.poster_name)
  const zeilen = Object.values(models).flatMap(m => m.accounts.filter(a => a.betreut).map(a => ({ model: m, acc: a })))
  const zeilenAus = Object.values(models).flatMap(m => m.accounts.filter(a => !a.betreut).map(a => ({ model: m, acc: a })))
  const ohneZiel = aktiv.filter(s => !s.ziel_account && statusVon(s) !== 'gepostet')

  const zuPosten = aktiv.filter(s => statusVon(s) === 'gedreht')
  const fehlt = aktiv.filter(s => statusVon(s) === 'freigegeben')
  const gepostet7 = aktiv.filter(s => statusVon(s) === 'gepostet' && tageSeit(s.gepostet_am) <= 7)
  const ohnePoster = zeilen.filter(z => !posterVon(z.model.model_name, z.acc.handle).length)

  const zuteilen = async (model, account, name) => {
    if (!name) return
    setHinweis('')
    const { error } = await supabase.from('social_account_poster').insert({ model_name: model, account, poster_name: name, erstellt_von: userDisplayName || null })
    if (error) { setHinweis('Nicht gespeichert: ' + error.message); return }
    logActivity('social.poster', { entity: `${model} ${account}`, detail: `${name} zugeteilt` })
    laden()
  }
  // v4.105.0: Account (nicht) betreuen
  const betreuen = async (m, account, ja) => {
    setHinweis('')
    const ps = posterVon(m.model_name, account)
    const offen = aktiv.filter(s => s.model_name === m.model_name && s.ziel_account === account && ['freigegeben', 'gedreht'].includes(statusVon(s)))
    if (!ja) {
      const teile = [`${account} (${m.model_name}) als „nicht betreut“ markieren?`, 'Er verschwindet aus der Liste, zählt nicht mehr als „ohne Poster“, steht beim Hochladen nicht mehr zur Auswahl und geht nicht mehr an Lyra. Im Board bleibt er.']
      if (ps.length) teile.push(`Zugeteilte Poster (${ps.join(', ')}) werden dabei entfernt.`)
      if (offen.length) teile.push(`Achtung: ${offen.length} offene${offen.length === 1 ? 's Skript läuft' : ' Skripte laufen'} noch auf diesen Account (${offen.map(s => s.nr).join(', ')}).`)
      if (!window.confirm(teile.join('\n\n'))) return
    }
    const liste = new Set(m.nicht_betreut || [])
    if (ja) liste.delete(account); else liste.add(account)
    const err = await serviceSpeichern(m.model_name, { nicht_betreut: [...liste] }, userDisplayName)
    if (err) { setHinweis('Nicht gespeichert: ' + err.message); return }
    if (!ja && ps.length) await supabase.from('social_account_poster').delete().eq('model_name', m.model_name).eq('account', account)
    logActivity('social.account', { entity: `${m.model_name} ${account}`, detail: ja ? 'wieder betreut' : 'nicht betreut' })
    laden()
  }

  const entfernen = async (model, account, name) => {
    if (!window.confirm(`${name} von ${account} (${model}) entfernen? ${name} sieht die Skripte dieses Accounts dann nicht mehr.`)) return
    const { error } = await supabase.from('social_account_poster').delete().eq('model_name', model).eq('account', account).eq('poster_name', name)
    if (error) { setHinweis('Nicht gespeichert: ' + error.message); return }
    logActivity('social.poster', { entity: `${model} ${account}`, detail: `${name} entfernt` })
    laden()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200, fontSize: 13, color: 'var(--text-muted)' }}>Alle Accounts, alle Poster, alles Gepostete. Nur für Admins sichtbar.</div>
        <button type="button" onClick={() => setNeuAccount('')} style={{ ...knopf(P, false), padding: '9px 14px' }}>+ Account</button>
        <button type="button" onClick={() => setUpload({ model: '', account: '' })} style={{ ...knopf(C, true), color: '#04212a', padding: '9px 14px' }}>📄 Drehzettel hochladen</button>
      </div>
      {hinweis && <div style={{ fontSize: 12.5, color: hinweis.startsWith('✓') ? G : ROT }}>{hinweis}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        {[[zeilen.length, 'var(--text-primary)', 'Accounts im Service'], [zuPosten.length, C, 'Video da, zu posten'], [fehlt.length, A, 'Video fehlt'], [gepostet7.length, G, 'gepostet, letzte 7 Tage'], [ohnePoster.length, ohnePoster.length ? ROT : 'var(--text-muted)', 'Account ohne Poster']].map(([n, f, l]) => (
          <div key={l} style={{ ...card, padding: '12px 14px' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: f }}>{n}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Accounts & Poster */}
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>Accounts & Poster</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Die Accounts kommen aus den Instagram-Links im Board der Models im Service. Kurzbeschreibung und „Im Service“ pflegst du unter Kommunikation → Creator → Model → „Social Media“.</div>
        {!Object.keys(models).length && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Noch kein Model im Service. Beim Model unter Kommunikation → Creator → „Social Media“ das Häkchen „Im Social-Media-Service“ setzen und speichern.</div>}
        {/* v4.104.1: Models im Service ohne Instagram-Link waren vorher unsichtbar */}
        {Object.values(models).filter(m => !m.accounts.some(a => a.betreut)).map(m => (
          <div key={'ohne:' + m.model_name} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 8px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
            <span style={{ minWidth: 80, color: 'var(--text-primary)' }}>{m.model_name}</span>
            <span style={{ flex: 1, minWidth: 200, color: A, fontSize: 12.5 }}>{m.accounts.length ? '⚠ im Service, aber alle Accounts sind „nicht betreut“.' : '⚠ im Service, aber noch kein Instagram-Account im Board. Deshalb gibt es hier noch keine Zeile zum Zuteilen.'}</span>
            <button type="button" onClick={() => setNeuAccount(m.model_name)} style={{ ...knopf(P, false), padding: '5px 10px', fontSize: 12 }}>+ Account für {m.model_name}</button>
          </div>
        ))}
        {zeilen.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 960 }}>
              <thead><tr>{['Model', 'Account', 'Poster', 'Drehzettel offen', 'Video da', 'Gepostet 7 T / gesamt', 'Letzter Post', 'Posting ab', ''].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {zeilen.map(({ model: m, acc }) => {
                  const k = schluessel(m.model_name, acc.handle)
                  const eig = aktiv.filter(s => s.model_name === m.model_name && s.ziel_account === acc.handle)
                  const offen = eig.filter(s => statusVon(s) === 'freigegeben')
                  const alt = offen.filter(s => tageSeit(s.erstellt_am) > ALT_TAGE)
                  const da = eig.filter(s => statusVon(s) === 'gedreht')
                  const gp = aktiv.filter(s => s.model_name === m.model_name && s.account === acc.handle && statusVon(s) === 'gepostet')
                  const gp7 = gp.filter(s => tageSeit(s.gepostet_am) <= 7)
                  const letzter = gp.map(s => s.gepostet_am).sort().pop()
                  const ps = posterVon(m.model_name, acc.handle)
                  const frei = poster.filter(p => !ps.includes(p))
                  const notiz = m.account_notizen?.[acc.handle]
                  const auf = offenZeile === k
                  return (
                    <React.Fragment key={k}>
                      <tr>
                        <td style={td}>{m.model_name}</td>
                        <td style={td}>
                          {acc.url ? <a href={acc.url} target="_blank" rel="noreferrer" style={{ color: P, fontWeight: 700 }}>{acc.handle}</a> : <span style={{ color: P, fontWeight: 700 }}>{acc.handle}</span>}
                          {acc.agentur && <span style={{ ...pill(L), marginLeft: 6 }}>Agentur</span>}
                          {notiz && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{notiz}</div>}
                          {!acc.imBoard && <div style={{ fontSize: 11, color: A }}>nicht mehr im Board</div>}
                        </td>
                        <td style={td}>
                          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                            {ps.map(p => (
                              <button key={p} type="button" onClick={() => entfernen(m.model_name, acc.handle, p)} title="Entfernen"
                                style={{ fontSize: 12, fontWeight: 700, padding: '3px 9px', borderRadius: 12, background: 'rgba(124,58,237,0.18)', color: '#c4b5fd', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>{p} ✕</button>
                            ))}
                            {!ps.length && <span style={{ fontSize: 11.5, fontWeight: 800, color: ROT }}>⚠ kein Poster</span>}
                            {frei.length > 0 && (
                              <select value="" onChange={e => zuteilen(m.model_name, acc.handle, e.target.value)} style={{ ...eingabe, width: 'auto', padding: '3px 6px', fontSize: 12 }} aria-label="Poster zuteilen">
                                <option value="">+</option>
                                {frei.map(p => <option key={p} value={p}>{p}</option>)}
                              </select>
                            )}
                            {!poster.length && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>niemand hat die Rolle Social Media</span>}
                          </span>
                        </td>
                        <td style={{ ...td, fontWeight: 800, color: alt.length ? ROT : offen.length ? A : 'var(--text-muted)' }}>
                          {offen.length}{alt.length > 0 && <span style={{ ...pill(ROT), marginLeft: 6 }}>{alt.length} über {ALT_TAGE} Tage</span>}
                        </td>
                        <td style={{ ...td, fontWeight: 800, color: da.length ? C : 'var(--text-muted)' }}>{da.length}</td>
                        <td style={td}><b style={{ color: G }}>{gp7.length}</b> <span style={{ color: 'var(--text-muted)' }}>/ {gp.length}</span></td>
                        <td style={td}>{letzter ? seitText(tageSeit(letzter)) : '—'}</td>
                        <td style={td}>{datum(m.posting_ab)}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          <button type="button" onClick={() => setUpload({ model: m.model_name, account: acc.handle })} style={{ ...knopf(C, false), padding: '4px 9px', fontSize: 12 }}>📄 +</button>{' '}
                          <button type="button" title="Als „nicht betreut“ markieren" onClick={() => betreuen(m, acc.handle, false)} style={{ ...knopf('var(--text-muted)', false), padding: '4px 8px', fontSize: 11.5 }}>ausblenden</button>{' '}
                          <button type="button" onClick={() => setOffenZeile(auf ? null : k)} style={{ ...knopf('var(--text-secondary)', false), padding: '4px 9px', fontSize: 12 }}>{auf ? '▴' : '▾'} {eig.length + gp.filter(s => s.ziel_account !== acc.handle).length}</button>
                        </td>
                      </tr>
                      {auf && (
                        <tr><td colSpan={9} style={{ padding: '8px 0 14px', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                            <button type="button" onClick={() => setAlleSkripte(false)} style={knopf('var(--text-secondary)', !alleSkripte)}>Offen</button>
                            <button type="button" onClick={() => setAlleSkripte(true)} style={knopf('var(--text-secondary)', alleSkripte)}>Alle (inkl. gepostet & verworfen)</button>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {skripte.filter(s => s.model_name === m.model_name && (s.ziel_account === acc.handle || s.account === acc.handle))
                              .filter(s => alleSkripte || !['gepostet', 'verworfen'].includes(statusVon(s)))
                              .map(s => <SkriptKarte key={s.id + ':' + s.aktualisiert_am} s={s} accounts={m.accounts.filter(a => a.betreut).map(a => a.handle)} userName={userDisplayName} onNeu={laden} />)}
                            {!skripte.some(s => s.model_name === m.model_name && (s.ziel_account === acc.handle || s.account === acc.handle) && (alleSkripte || !['gepostet', 'verworfen'].includes(statusVon(s)))) &&
                              <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Nichts {alleSkripte ? '' : 'Offenes '}für diesen Account.</div>}
                          </div>
                        </td></tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {/* v4.105.0: nicht betreute Accounts, eingeklappt */}
        {zeilenAus.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <button type="button" onClick={() => setAusOffen(v => !v)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 700 }}>
              {ausOffen ? '▴' : '▾'} Nicht betreut ({zeilenAus.length})
            </button>
            {ausOffen && (
              <div style={{ display: 'flex', flexDirection: 'column', marginTop: 6 }}>
                {zeilenAus.map(({ model: m, acc }) => (
                  <div key={'aus:' + m.model_name + acc.handle} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '7px 8px', borderBottom: '1px solid var(--border)', fontSize: 13, opacity: 0.75 }}>
                    <span style={{ minWidth: 80, color: 'var(--text-primary)' }}>{m.model_name}</span>
                    <span style={{ flex: 1, minWidth: 160 }}>{acc.url ? <a href={acc.url} target="_blank" rel="noreferrer" style={{ color: P, fontWeight: 700 }}>{acc.handle}</a> : <span style={{ color: P, fontWeight: 700 }}>{acc.handle}</span>}{acc.agentur && <span style={{ ...pill(L), marginLeft: 6 }}>Agentur</span>}</span>
                    <button type="button" onClick={() => betreuen(m, acc.handle, true)} style={{ ...knopf(P, false), padding: '4px 10px', fontSize: 12 }}>wieder betreuen</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {ohneZiel.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: A }}>
            ⚠ {ohneZiel.length} {ohneZiel.length === 1 ? 'Skript hat' : 'Skripte haben'} keinen Ziel-Account und {ohneZiel.length === 1 ? 'ist' : 'sind'} für Poster unsichtbar: {ohneZiel.map(s => `${s.nr} (${s.model_name})`).join(', ')}. Ziel im Block „Reels“ beim Model setzen.
          </div>
        )}
      </div>

      {/* Poster */}
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 10 }}>Poster</div>
        {!poster.length && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Noch niemand hat die Rolle Social Media. Unter Einstellungen → Team vergeben.</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12 }}>
          {poster.map(p => {
            const accs = zuteilung.filter(z => z.poster_name === p)
            const meins = (s) => accs.some(z => z.model_name === s.model_name && z.account === s.ziel_account)
            const zp = aktiv.filter(s => statusVon(s) === 'gedreht' && meins(s))
            const wartet = aktiv.filter(s => statusVon(s) === 'freigegeben' && meins(s))
            const g7 = aktiv.filter(s => statusVon(s) === 'gepostet' && s.gepostet_von === p && tageSeit(s.gepostet_am) <= 7)
            const aeltestes = zp.map(s => s.video_am).sort()[0]
            const zeile = (l, w, f) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, color: 'var(--text-secondary)' }}><span>{l}</span><span style={{ color: f || 'var(--text-primary)', fontWeight: f ? 800 : 500, textAlign: 'right' }}>{w}</span></div>
            return (
              <div key={p} style={{ background: 'var(--bg-card2)', borderRadius: 14, padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 30, height: 30, borderRadius: 15, background: 'rgba(124,58,237,0.25)', color: '#c4b5fd', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{p[0]?.toUpperCase()}</span>
                  <b style={{ flex: 1, color: 'var(--text-primary)' }}>{p}</b>
                </div>
                {zeile('Accounts', accs.length ? accs.map(z => z.account).join(', ') : '— keine —', accs.length ? null : A)}
                {zeile('Zu posten', zp.length, zp.length ? C : 'var(--text-muted)')}
                {zeile('Gepostet, 7 Tage', g7.length, G)}
                {aeltestes ? zeile('Ältestes wartendes Video', seitText(tageSeit(aeltestes)), tageSeit(aeltestes) > 2 ? ROT : null) : zeile('Wartet auf Videos', wartet.length ? `${wartet.length} Drehzettel` : '—', wartet.length ? A : null)}
              </div>
            )
          })}
        </div>
      </div>

      {/* Zuletzt gepostet */}
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>Zuletzt gepostet</div>
        {(() => {
          const liste = skripte.filter(s => statusVon(s) === 'gepostet').sort((a, b) => String(b.gepostet_am).localeCompare(String(a.gepostet_am)) || String(b.aktualisiert_am).localeCompare(String(a.aktualisiert_am))).slice(0, 30)
          if (!liste.length) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Noch nichts gepostet.</div>
          return (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead><tr>{['Datum', 'Nr', 'Titel', 'Model', 'Account', 'Poster', 'Reel'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {liste.map(s => (
                    <tr key={s.id}>
                      <td style={td}>{datum(s.gepostet_am)}</td>
                      <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontWeight: 800, color: C }}>{s.nr}</td>
                      <td style={td}>{s.titel}</td>
                      <td style={td}>{s.model_name}</td>
                      <td style={td}><span style={{ color: P, fontWeight: 700 }}>{s.account}</span>{s.ziel_account && s.account !== s.ziel_account && <span style={{ ...pill(A), marginLeft: 6 }}>Ziel war {s.ziel_account}</span>}</td>
                      <td style={td}>{s.gepostet_von || '—'}</td>
                      <td style={td}><a href={s.reel_url} target="_blank" rel="noreferrer" style={{ color: C, fontWeight: 700 }}>ansehen</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })()}
        <div style={{ marginTop: 10, border: '1px dashed var(--border)', borderRadius: 10, padding: '8px 10px', color: 'var(--text-muted)', fontSize: 12 }}>Später: Aufrufe, Likes und Follower-Zuwachs pro Reel, sobald Lyra misst.</div>
      </div>

      {neuAccount !== null && <AccountFenster models={models} startModel={neuAccount} wer={userDisplayName} onZu={(neu) => { setNeuAccount(null); if (neu) { setHinweis(`✓ ${neu} angelegt. Jetzt einen Poster zuteilen.`); laden() } }} />}
      {upload && <UploadFenster start={upload} models={models} wer={userDisplayName} onZu={(neu) => { setUpload(null); if (neu) { setHinweis(`✓ ${neu} Drehzettel angelegt.`); laden() } }} />}
    </div>
  )
}

// ── Drehzettel hochladen: eine oder mehrere PDFs ──────────────────────────
function UploadFenster({ start, models, wer, onZu }) {
  const namen = Object.keys(models)
  const [zeilen, setZeilen] = useState([])
  const [telegram, setTelegram] = useState(true)
  const [arbeitet, setArbeitet] = useState(false)
  const input = useRef(null)
  const angelegt = useRef(0)   // wie viele in diesem Fenster angelegt wurden
  const accountsVon = (m) => (models[m]?.accounts || []).filter(a => a.betreut).map(a => a.handle)

  const dateienDazu = (files) => {
    const neu = [...(files || [])].filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf').map((f, i) => {
      const v = dateinameLesen(f.name, namen)
      const model = v.model || start.model || ''
      const accs = accountsVon(model)
      const account = (v.account && accs.includes(v.account) ? v.account : '') || (start.model === model ? start.account : '') || (accs.length === 1 ? accs[0] : '')
      return { id: Date.now() + '-' + i + '-' + f.name, datei: f, model, account, titel: v.titel, ergebnis: null }
    })
    setZeilen(z => [...z, ...neu])
  }
  const setze = (id, felder) => setZeilen(z => z.map(r => r.id === id ? { ...r, ...felder } : r))
  const fehlerVon = (r) => !r.model ? 'Model wählen' : !r.titel.trim() ? 'Titel fehlt' : (accountsVon(r.model).length && !r.account) ? 'Account wählen' : ''
  const offen = zeilen.filter(r => !r.ergebnis?.nr)
  const bereit = offen.length > 0 && offen.every(r => !fehlerVon(r))

  const anlegen = async () => {
    setArbeitet(true)
    let alleOk = true
    for (const r of offen) {
      const e = await skriptAnlegen({ model: r.model, titel: r.titel, datei: r.datei, ziel: r.account, wer, telegram })
      setze(r.id, { ergebnis: e })
      if (e.nr) angelegt.current++
      else alleOk = false
    }
    setArbeitet(false)
    // Alles geklappt → zu. Sonst offen lassen, damit die Fehler sichtbar bleiben.
    if (alleOk) onZu(angelegt.current)
  }

  return (
    <div onClick={() => !arbeitet && onZu(angelegt.current)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Drehzettel hochladen" style={{ width: 'min(860px, 100%)', maxHeight: '90vh', overflowY: 'auto', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 20, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, boxSizing: 'border-box' }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>📄 Drehzettel hochladen</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Eine oder mehrere PDFs. Model, Account und Titel werden aus dem Dateinamen vorgeschlagen, z. B. <code>Sandra_@sandra.wayneee_Gym-Transition.pdf</code>. Jede Datei bekommt eine eigene Nummer.
          {start.model && <><br />Vorbelegt: <b style={{ color: P }}>{start.model}{start.account ? ` · ${start.account}` : ''}</b></>}
        </div>
        <div
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); dateienDazu(e.dataTransfer.files) }}
          onClick={() => input.current?.click()}
          style={{ border: `1px dashed ${C}`, borderRadius: 12, padding: 16, textAlign: 'center', cursor: 'pointer', background: 'rgba(6,182,212,0.06)', color: C, fontWeight: 700, fontSize: 13.5 }}>
          PDFs hierher ziehen oder klicken zum Auswählen
        </div>
        <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={e => { dateienDazu(e.target.files); e.target.value = '' }} />

        {zeilen.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {zeilen.map(r => {
              const accs = accountsVon(r.model)
              const f = fehlerVon(r)
              const fertig = r.ergebnis?.nr
              return (
                <div key={r.id} style={{ border: `1px solid ${fertig ? 'rgba(16,185,129,0.5)' : r.ergebnis?.fehler ? 'rgba(239,68,68,0.5)' : 'var(--border)'}`, borderRadius: 12, padding: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, alignItems: 'center' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-all' }}>📄 {r.datei.name}</div>
                  <select disabled={!!fertig} value={r.model} onChange={e => { const m = e.target.value; const a = accountsVon(m); setze(r.id, { model: m, account: a.length === 1 ? a[0] : '' }) }} style={eingabe}>
                    <option value="">Model …</option>
                    {namen.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  {accs.length ? (
                    <select disabled={!!fertig} value={r.account} onChange={e => setze(r.id, { account: e.target.value })} style={eingabe}>
                      <option value="">Account …</option>
                      {accs.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  ) : <span style={{ fontSize: 11.5, color: A }}>{r.model ? 'kein Instagram im Board' : ''}</span>}
                  <input disabled={!!fertig} value={r.titel} onChange={e => setze(r.id, { titel: e.target.value.slice(0, 120) })} placeholder="Titel" style={eingabe} />
                  <div style={{ fontSize: 12, fontWeight: 700, color: fertig ? G : r.ergebnis?.fehler ? ROT : f ? A : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {fertig ? `✓ ${r.ergebnis.nr}${r.ergebnis.info ? ` · ${r.ergebnis.info}` : ''}` : r.ergebnis?.fehler || f || 'bereit'}
                    {!fertig && !arbeitet && <button type="button" onClick={() => setZeilen(z => z.filter(x => x.id !== r.id))} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }} aria-label="Entfernen">✕</button>}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={telegram} onChange={e => setTelegram(e.target.checked)} /> Models per Telegram Bescheid geben
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" disabled={arbeitet} onClick={() => onZu(angelegt.current)} style={{ ...knopf('var(--text-muted)', false), flex: 1, padding: 11 }}>{zeilen.some(r => r.ergebnis?.nr) ? 'Schließen' : 'Abbrechen'}</button>
          <button type="button" disabled={arbeitet || !bereit} onClick={anlegen} style={{ ...knopf(C, true), color: '#04212a', flex: 2, padding: 11, fontSize: 14, opacity: bereit ? 1 : 0.5 }}>
            {arbeitet ? 'Lädt hoch …' : `${offen.length || ''} anlegen (Nummern werden vergeben)`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── v4.104.0: eigenen Instagram-Account anlegen (z. B. US) ─────────────────
// Landet im Board des Models (markiert „Agentur“, nur Staff darf ändern),
// optional gleich mit Kurzbeschreibung.
function AccountFenster({ models, startModel = '', wer, onZu }) {
  const namen = Object.keys(models)
  const [model, setModel] = useState(startModel || (namen.length === 1 ? namen[0] : ''))
  const [handle, setHandle] = useState('')
  const [notiz, setNotiz] = useState('')
  const [fehler, setFehler] = useState('')
  const [arbeitet, setArbeitet] = useState(false)
  const anlegen = async () => {
    setArbeitet(true); setFehler('')
    const r = await agenturAccountAnlegen(model, handle, wer)
    if (r.fehler) { setArbeitet(false); setFehler(r.fehler); return }
    if (notiz.trim()) {
      const alt = models[model]?.account_notizen || {}
      const err = await serviceSpeichern(model, { account_notizen: { ...alt, [r.handle]: notiz.trim().slice(0, 60) } }, wer)
      if (err) { setArbeitet(false); setFehler(`${r.handle} angelegt, aber Kurzbeschreibung nicht gespeichert: ${err.message}`); return }
    }
    setArbeitet(false)
    onZu(r.handle)
  }
  return (
    <div onClick={() => !arbeitet && onZu(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Account anlegen" style={{ width: 'min(440px, 100%)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 20, padding: 18, display: 'flex', flexDirection: 'column', gap: 10, boxSizing: 'border-box' }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>+ Instagram-Account</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>Für Accounts, die ihr selbst anlegt (z. B. US). Er steht danach im Board des Models unter „Social Media Kanäle“, markiert als „Agentur“. Chatter und Model sehen ihn, ändern können ihn nur Admins.</div>
        <select value={model} onChange={e => setModel(e.target.value)} style={{ ...eingabe, fontSize: 13.5, padding: '9px 10px' }}>
          <option value="">Model wählen …</option>
          {namen.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <input value={handle} onChange={e => setHandle(e.target.value.slice(0, 200))} placeholder="@name oder Instagram-Link" style={{ ...eingabe, fontSize: 13.5, padding: '9px 10px' }} autoCapitalize="none" autoCorrect="off" />
        <input value={notiz} onChange={e => setNotiz(e.target.value.slice(0, 60))} placeholder="Kurzbeschreibung, z. B. US · bitte Englisch" style={{ ...eingabe, fontSize: 13.5, padding: '9px 10px' }} />
        {fehler && <div role="alert" style={{ fontSize: 12.5, color: ROT }}>{fehler}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" disabled={arbeitet} onClick={() => onZu(null)} style={{ ...knopf('var(--text-muted)', false), flex: 1, padding: 11 }}>Abbrechen</button>
          <button type="button" disabled={arbeitet || !model || !handle.trim()} onClick={anlegen} style={{ ...knopf(P, true), flex: 2, padding: 11, fontSize: 14, opacity: model && handle.trim() ? 1 : 0.5 }}>{arbeitet ? 'Legt an …' : 'Anlegen'}</button>
        </div>
        {!namen.length && <div style={{ fontSize: 12, color: A }}>Noch kein Model im Service. Erst beim Model „Im Social-Media-Service“ setzen.</div>}
      </div>
    </div>
  )
}
