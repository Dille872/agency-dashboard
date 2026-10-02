import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { ROLLEN_GRUPPEN, rolle, rollenVon } from '../rollen'

// ── Team & Rechte (v5.27.0) ────────────────────────────────────────────────
// Ersetzt in den Einstellungen „Rollen & Zugriffe“, „Aktuelle Mitglieder“
// und „History / Archiv“. Drei Reiter:
//   👥 Personen       Liste mit Filtern, antippen → Seitenfenster mit Schaltern
//   ▦ Übersicht       alle Haken als Tabelle, sammeln und gemeinsam speichern
//   📖 Was darf wer?  jede Rolle erklärt + wer sie hat
// Gespeichert wird über rollenSetzen() aus SettingsTab (dieselben Schutzregeln
// wie vorher: mindestens eine Rolle, der letzte Admin bleibt Admin).
// Status (stilllegen/offboarden) läuft weiter über das bestehende Status-Fenster.

const LILA = '#7c3aed'
const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16 }
const klein = { fontSize: 12, color: 'var(--text-muted)' }
const aktivP = (u) => (u.status || 'active') === 'active'
const LEITUNG = ['admin', 'manager', 'dienstplan', 'creator_manager']
const ZUSATZ = ['social_media', 'cutter', 'social_leitung', 'storyteller', 'script_builder']

function Tag({ k }) {
  const r = rolle(k)
  const f = r?.color || '#888'
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 8, border: `1px solid ${f}55`, color: f, whiteSpace: 'nowrap' }}>{r?.label || k}</span>
}
function Ava({ u, gross }) {
  const r = rolle(u.role) || rolle(rollenVon(u)[0])
  const f = aktivP(u) ? (r?.color || '#888') : '#6e6e8a'
  const g = gross ? 44 : 34
  return <span style={{ width: g, height: g, borderRadius: g / 2, background: f + '33', color: f, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: gross ? 18 : 14, flex: '0 0 auto' }}>{(u.display_name || '?')[0].toUpperCase()}</span>
}
function Schalter({ an, onClick, titel, text, rechts, gesperrt }) {
  return (
    <div onClick={gesperrt ? undefined : onClick} className="tr-schalter" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 11px', border: `1px solid ${an ? LILA + '88' : 'var(--border)'}`, borderRadius: 11, background: an ? LILA + '14' : 'var(--bg-card2)', cursor: gesperrt ? 'not-allowed' : 'pointer', opacity: gesperrt ? 0.6 : 1 }}>
      <span style={{ width: 34, height: 20, borderRadius: 10, background: an ? LILA : '#2a2a45', position: 'relative', flex: '0 0 auto', marginTop: 1, transition: 'background .15s' }}>
        <span style={{ position: 'absolute', top: 2, left: an ? 16 : 2, width: 16, height: 16, borderRadius: 8, background: an ? '#fff' : '#8a8aa5', transition: 'left .15s' }} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <b style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>{titel}</b>
        <span style={{ display: 'block', ...klein, fontSize: 11.5, marginTop: 1, lineHeight: 1.35 }}>{text}</span>
      </div>
      {rechts}
    </div>
  )
}

// ── Seitenfenster für eine Person ──────────────────────────────────────────
function Fenster({ u, zuteilung, onZu, rollenSetzen, profilSpeichern, onStatus, onReaktivieren, onExport, statusBusy, onNeu }) {
  const [entwurf, setEntwurf] = useState(() => rollenVon(u))
  const [arbeitet, setArbeitet] = useState(false)
  const [fehler, setFehler] = useState('')
  useEffect(() => { setEntwurf(rollenVon(u)); setFehler('') }, [u.user_id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onZu() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onZu])
  const alt = rollenVon(u)
  const geaendert = alt.slice().sort().join() !== entwurf.slice().sort().join()
  const umschalten = (k) => setEntwurf(e => e.includes(k) ? e.filter(x => x !== k) : [...e, k])
  const speichern = async () => {
    setFehler('')
    const neuAdmin = entwurf.includes('admin') && !alt.includes('admin')
    const weg = alt.filter(k => !entwurf.includes(k))
    if (neuAdmin && !window.confirm(`${u.display_name} wird Admin und darf damit alles, auch Rechte vergeben. Sicher?`)) return
    if (weg.length && !window.confirm(`${u.display_name} verliert: ${weg.map(k => rolle(k)?.label || k).join(', ')}. Speichern?`)) return
    setArbeitet(true)
    const r = await rollenSetzen(u, entwurf)
    setArbeitet(false)
    if (r.fehler) { setFehler(r.fehler); return }
    onNeu(); onZu()
  }
  const status = u.status || 'active'
  return (
    <>
      <div onClick={onZu} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1990 }} />
      <div className="tr-fenster" role="dialog" aria-label={`Rechte von ${u.display_name}`} style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 440, maxWidth: '100%', background: 'var(--bg-card)', borderLeft: '1px solid var(--border)', boxShadow: '-20px 0 50px rgba(0,0,0,.5)', zIndex: 2000, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'center' }}>
          <Ava u={u} gross />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>{u.display_name}</div>
            <div style={{ ...klein, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{String(u.user_id).slice(0, 13)}…{u.sprache === 'en' ? ' · EN' : ''}</div>
          </div>
          <button type="button" onClick={onZu} aria-label="Schließen" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div className="tr-gruppe">Status</div>
            {status === 'active' ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: '#10b981', background: '#10b98118', border: '1px solid #10b98155', borderRadius: 9, padding: '7px 12px' }}>✓ Aktiv</span>
                <button type="button" onClick={() => { onZu(); onStatus(u) }} style={{ fontSize: 12.5, padding: '7px 12px', borderRadius: 9, background: 'transparent', border: '1px solid rgba(239,68,68,0.35)', color: '#ef4444', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>Stilllegen / Offboarden …</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: status === 'suspended' ? '#f59e0b' : '#ef4444' }}>{status === 'suspended' ? '⏸ Stillgelegt' : '⛔ Offboarded'}{u.status_changed_at ? ` seit ${new Date(u.status_changed_at).toLocaleDateString('de-DE')}` : ''}</span>
                <button type="button" disabled={statusBusy} onClick={() => onReaktivieren(u)} style={{ fontSize: 12.5, padding: '7px 12px', borderRadius: 9, background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)', color: '#10b981', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>↺ Reaktivieren</button>
                <button type="button" onClick={() => onExport(u)} style={{ fontSize: 12.5, padding: '7px 12px', borderRadius: 9, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit' }}>↓ Export</button>
                {u.status_note && <div style={{ ...klein, fontStyle: 'italic', width: '100%' }}>„{u.status_note}“</div>}
              </div>
            )}
          </div>
          {ROLLEN_GRUPPEN.map(g => (
            <div key={g.key}>
              <div className="tr-gruppe">{g.titel} <span>{g.hinweis}</span></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {g.keys.map(k => rolle(k)).filter(Boolean).map(r => {
                  const z = r.zuteilung ? (zuteilung[r.key]?.[u.display_name] || 0) : null
                  return (
                    <Schalter key={r.key} an={entwurf.includes(r.key)} onClick={() => umschalten(r.key)} titel={r.label} text={r.desc}
                      rechts={r.zuteilung && entwurf.includes(r.key) ? (
                        <a href="?tab=social-rechte" onClick={e => e.stopPropagation()} style={{ fontSize: 11.5, color: '#06b6d4', whiteSpace: 'nowrap', alignSelf: 'center', textDecoration: 'none' }}>{z ? `${z} Account${z === 1 ? '' : 's'}` : 'zuteilen'} →</a>
                      ) : null} />
                  )
                })}
              </div>
            </div>
          ))}
          {alt.includes('social_freigabe') && <div style={{ fontSize: 11.5, color: '#f97316' }}>Hat noch die alte Rolle „Social-Freigabe“, wird mit sql/social-leitung.sql zur Social-Leitung.</div>}
          <div>
            <div className="tr-gruppe">Sprache & Kontakt</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...klein, fontSize: 11, flex: 1, minWidth: 150 }}>
                Sprache
                <select value={u.sprache || ''} onChange={e => profilSpeichern(u, { sprache: e.target.value || null }, 'Sprache ' + (e.target.value || 'Gerät'))}
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '8px 9px', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }}>
                  <option value="">wie das Gerät</option>
                  <option value="de">Deutsch</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...klein, fontSize: 11, flex: 1, minWidth: 150 }}>
                Telegram-ID (falls nicht als Chatter/Model hinterlegt)
                <input key={'tg:' + u.user_id + ':' + (u.kontakt_telegram || '')} defaultValue={u.kontakt_telegram || ''} placeholder="z. B. 123456789" inputMode="numeric"
                  onBlur={e => { const v = e.target.value.trim(); if (v === (u.kontakt_telegram || '')) return; if (v && !/^-?\d{4,20}$/.test(v)) { alert('Telegram-ID besteht nur aus Ziffern.'); return } profilSpeichern(u, { kontakt_telegram: v || null }, v ? 'Telegram-ID gesetzt' : 'Telegram-ID entfernt') }}
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '8px 9px', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }} />
              </label>
            </div>
          </div>
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {fehler && <div style={{ fontSize: 12.5, color: '#ef4444' }}>⚠ {fehler}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onZu} style={{ flex: 1, padding: 11, borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{geaendert ? 'Abbrechen' : 'Schließen'}</button>
            <button type="button" onClick={speichern} disabled={!geaendert || arbeitet} style={{ flex: 1, padding: 11, borderRadius: 10, border: 'none', background: geaendert ? LILA : 'var(--bg-card2)', color: geaendert ? '#fff' : 'var(--text-muted)', fontWeight: 800, fontSize: 13, cursor: geaendert ? 'pointer' : 'default', fontFamily: 'inherit' }}>{arbeitet ? '…' : 'Rollen speichern'}</button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Hauptseite ─────────────────────────────────────────────────────────────
const FILTER = [
  { k: 'alle', t: 'Alle', f: u => aktivP(u) },
  { k: 'leitung', t: 'Leitung', f: u => aktivP(u) && rollenVon(u).some(r => LEITUNG.includes(r)) },
  { k: 'chatter', t: 'Chatter', f: u => aktivP(u) && rollenVon(u).includes('chatter') },
  { k: 'models', t: 'Models', f: u => aktivP(u) && rollenVon(u).includes('model') },
  { k: 'social', t: '📱 Social', f: u => aktivP(u) && rollenVon(u).some(r => ['social_media', 'cutter', 'social_leitung', 'social_freigabe'].includes(r)) },
  { k: 'content', t: '✍️ Content', f: u => aktivP(u) && rollenVon(u).some(r => ['storyteller', 'script_builder'].includes(r)) },
  { k: 'gesperrt', t: '⏸ Gesperrt', f: u => !aktivP(u) },
]

export default function TeamRechte({ users = [], onNeu, rollenSetzen, profilSpeichern, onStatus, onReaktivieren, onExport, statusBusy, onEinladen }) {
  const [reiter, setReiter] = useState('personen')
  const [filter, setFilter] = useState('alle')
  const [suche, setSuche] = useState('')
  const [offenId, setOffenId] = useState(null)
  const [aenderungen, setAenderungen] = useState({}) // Übersicht: user_id → Rollen
  const [speichert, setSpeichert] = useState(false)
  const [meldung, setMeldung] = useState(null)
  const [zuteilung, setZuteilung] = useState({})

  // Wie viele Social-Accounts jemand als Poster/Cutter hat (für „2 Accounts →“)
  useEffect(() => {
    let weg = false
    ;(async () => {
      const [p, c] = await Promise.all([
        supabase.from('social_account_poster').select('poster_name'),
        supabase.from('social_account_cutter').select('cutter_name'),
      ])
      if (weg) return
      const zaehl = (liste, feld) => { const m = {}; for (const x of liste || []) m[x[feld]] = (m[x[feld]] || 0) + 1; return m }
      setZuteilung({ social_media: zaehl(p.data, 'poster_name'), cutter: zaehl(c.data, 'cutter_name') })
    })()
    return () => { weg = true }
  }, [])

  const sortiert = useMemo(() => [...users].sort((a, b) => String(a.display_name || '').localeCompare(String(b.display_name || ''), 'de')), [users])
  const aktive = sortiert.filter(aktivP)
  const zahl = (k) => sortiert.filter(FILTER.find(f => f.k === k).f).length
  const q = suche.trim().toLowerCase()
  const liste = sortiert.filter(FILTER.find(f => f.k === filter).f).filter(u => !q || String(u.display_name || '').toLowerCase().includes(q))
  const offen = users.find(u => u.user_id === offenId)

  const zugangText = (u) => {
    const r = rollenVon(u)
    if (r.includes('admin')) return 'alles'
    if (r.includes('manager')) return 'alles außer Einstellungen'
    const teile = []
    if (r.includes('dienstplan')) teile.push('Dienstplan')
    if (r.includes('creator_manager')) teile.push('Creator')
    if (r.includes('chatter')) teile.push('Chatter-Portal')
    if (r.includes('model')) teile.push('Model-Portal')
    if (r.some(x => ['social_media', 'cutter', 'social_leitung', 'social_freigabe'].includes(x))) teile.push('Social')
    if (r.some(x => ['storyteller', 'script_builder'].includes(x))) teile.push('Skripte')
    return teile.join(' + ') || '—'
  }

  // Übersicht
  const rollenJetzt = (u) => aenderungen[u.user_id] || rollenVon(u)
  const matrixUmschalten = (u, k) => {
    const jetzt = rollenJetzt(u)
    const neu = jetzt.includes(k) ? jetzt.filter(x => x !== k) : [...jetzt, k]
    const alt = rollenVon(u)
    setAenderungen(a => {
      const n = { ...a }
      if (neu.slice().sort().join() === alt.slice().sort().join()) delete n[u.user_id]
      else n[u.user_id] = neu
      return n
    })
  }
  const offeneAenderungen = Object.keys(aenderungen)
  const alleSpeichern = async () => {
    const zeilen = offeneAenderungen.map(id => {
      const u = users.find(x => x.user_id === id)
      const alt = rollenVon(u), neu = aenderungen[id]
      const plus = neu.filter(k => !alt.includes(k)).map(k => '+' + (rolle(k)?.label || k))
      const minus = alt.filter(k => !neu.includes(k)).map(k => '−' + (rolle(k)?.label || k))
      return `${u.display_name}: ${[...plus, ...minus].join(', ')}`
    })
    const neuAdmin = offeneAenderungen.some(id => aenderungen[id].includes('admin') && !rollenVon(users.find(x => x.user_id === id)).includes('admin'))
    if (!window.confirm(`${zeilen.length} Änderung${zeilen.length === 1 ? '' : 'en'} speichern?\n\n${zeilen.join('\n')}${neuAdmin ? '\n\n⚠ Jemand wird Admin und darf damit alles.' : ''}`)) return
    setSpeichert(true)
    const fehler = []
    for (const id of offeneAenderungen) {
      const u = users.find(x => x.user_id === id)
      const r = await rollenSetzen(u, aenderungen[id])
      if (r.fehler) fehler.push(r.fehler)
    }
    setSpeichert(false)
    setAenderungen({})
    setMeldung(fehler.length ? { ok: false, text: fehler.join(' · ') } : { ok: true, text: '✓ Gespeichert.' })
    setTimeout(() => setMeldung(null), 7000)
    onNeu()
  }
  const matrixSpalten = ROLLEN_GRUPPEN.map(g => ({ ...g, rollen: g.keys.filter(k => k !== 'model').map(rolle).filter(Boolean) })).filter(g => g.rollen.length)
  const matrixPersonen = aktive.filter(u => !(rollenVon(u).length === 1 && rollenVon(u)[0] === 'model')).filter(u => !q || String(u.display_name || '').toLowerCase().includes(q))

  return (
    <div className="tr-seite" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>Team & Rechte</div>
        <div style={klein}>Wer hat Zugang, und was darf er im Dashboard</div>
      </div>
      <div className="ms-reiter tr-reiter" role="tablist">
        {[['personen', '👥', 'Personen'], ['uebersicht', '▦', 'Übersicht'], ['rollen', '📖', 'Was darf wer?']].map(([k, i, t]) => (
          <button key={k} type="button" className={'ms-knopf' + (reiter === k ? ' an' : '')} onClick={() => setReiter(k)}>
            <span className="ms-ico">{i}</span><span className="ms-text">{t}</span>
            {k === 'uebersicht' && offeneAenderungen.length > 0 && <span className="ms-badge">{offeneAenderungen.length}</span>}
          </button>
        ))}
      </div>

      {reiter === 'personen' && <>
        <div className="tr-kpis raster-tr" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 8 }}>
          {[['alle', 'aktiv', 'var(--text-primary)'], ['chatter', 'Chatter', '#c4b5fd'], ['models', 'Models', '#ef4444'], ['zusatz', 'mit Zusatzrollen', '#ec4899'], ['gesperrt', 'gesperrt', '#f59e0b']].map(([k, t, f]) => {
            const n = k === 'zusatz' ? aktive.filter(u => rollenVon(u).some(r => ZUSATZ.includes(r))).length : zahl(k)
            const fk = k === 'zusatz' ? null : k
            return (
              <div key={k} onClick={() => fk && setFilter(fk)} style={{ ...card, padding: '11px 13px', cursor: fk ? 'pointer' : 'default', borderColor: filter === fk ? LILA : 'var(--border)' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: f }}>{n}</div>
                <div style={{ ...klein, fontSize: 11.5 }}>{t}</div>
              </div>
            )
          })}
        </div>
        <div className="tr-leiste" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {FILTER.map(f => (
            <button key={f.k} type="button" onClick={() => setFilter(f.k)} className="tr-chip" style={{ fontSize: 12, padding: '6px 11px', borderRadius: 20, border: `1px solid ${filter === f.k ? LILA : 'var(--border)'}`, background: filter === f.k ? LILA + '22' : 'transparent', color: filter === f.k ? '#c4b5fd' : 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, whiteSpace: 'nowrap' }}>{f.t} ({zahl(f.k)})</button>
          ))}
          <input value={suche} onChange={e => setSuche(e.target.value)} placeholder="Name suchen …" className="tr-suche"
            style={{ flex: 1, minWidth: 160, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 10, padding: '8px 11px', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
          {onEinladen && <button type="button" onClick={onEinladen} style={{ padding: '8px 14px', borderRadius: 10, border: 'none', background: LILA, color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>+ Einladen</button>}
        </div>
        <div style={card}>
          {!liste.length && <div style={{ ...klein, padding: 16 }}>Niemand gefunden.</div>}
          {liste.map((u, i) => {
            const r = rollenVon(u)
            const zusatz = r.filter(k => ZUSATZ.includes(k)).length
            return (
              <div key={u.user_id} onClick={() => setOffenId(u.user_id)} className="tr-person" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '11px 15px', borderTop: i ? '1px solid var(--border)' : 'none', cursor: 'pointer', opacity: aktivP(u) ? 1 : 0.6 }}>
                <Ava u={u} />
                <div className="tr-name" style={{ minWidth: 140 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text-primary)' }}>{u.display_name}{u.sprache === 'en' && <span style={{ fontSize: 10, fontWeight: 800, color: '#06b6d4', marginLeft: 6 }}>EN</span>}</div>
                  <div style={{ ...klein, fontSize: 11.5 }}>{!aktivP(u) ? (u.status === 'suspended' ? 'stillgelegt' : 'offboarded') : (rolle(u.role)?.label || u.role || '—') + (zusatz ? ` · ${zusatz} Zusatzrolle${zusatz === 1 ? '' : 'n'}` : '')}</div>
                </div>
                <div className="tr-tags" style={{ flex: 1, display: 'flex', gap: 5, flexWrap: 'wrap', minWidth: 0 }}>{r.map(k => <Tag key={k} k={k} />)}</div>
                <div className="tr-zugang" style={{ ...klein, minWidth: 150, textAlign: 'right' }}>{aktivP(u) ? zugangText(u) : 'kein Zugang'}</div>
                <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>›</span>
              </div>
            )
          })}
        </div>
      </>}

      {reiter === 'uebersicht' && <>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ ...klein, flex: 1, minWidth: 220 }}>Haken direkt setzen, unten gemeinsam speichern. Models (nur Model-Rolle) stehen nicht drin.</div>
          <input value={suche} onChange={e => setSuche(e.target.value)} placeholder="Name suchen …" className="tr-suche"
            style={{ width: 200, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 10, padding: '8px 11px', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
        </div>
        <div className="tr-matrix" style={{ ...card, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', minWidth: 880 }}>
            <thead>
              <tr>
                <th className="tr-erste" />
                {matrixSpalten.map(g => <th key={g.key} colSpan={g.rollen.length} className="tr-gruppenkopf">{g.titel}</th>)}
              </tr>
              <tr>
                <th className="tr-erste" style={{ textAlign: 'left' }}>Person</th>
                {matrixSpalten.map(g => g.rollen.map((r, i) => <th key={r.key} className={i === 0 ? 'tr-trenn' : undefined} title={r.desc}>{r.label}</th>))}
              </tr>
            </thead>
            <tbody>
              {matrixPersonen.map(u => {
                const jetzt = rollenJetzt(u)
                const alt = rollenVon(u)
                return (
                  <tr key={u.user_id} style={aenderungen[u.user_id] ? { background: LILA + '10' } : undefined}>
                    <td className="tr-erste" style={{ fontWeight: 800 }}>{u.display_name}</td>
                    {matrixSpalten.map(g => g.rollen.map((r, i) => {
                      const an = jetzt.includes(r.key)
                      const neu = an !== alt.includes(r.key)
                      return (
                        <td key={r.key} className={i === 0 ? 'tr-trenn' : undefined} onClick={() => matrixUmschalten(u, r.key)} style={{ cursor: 'pointer' }}>
                          <span className={'tr-hk' + (an ? ' an' : '') + (neu ? ' neu' : '')} aria-label={an ? 'an' : 'aus'} />
                        </td>
                      )
                    }))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {(offeneAenderungen.length > 0 || meldung) && (
          <div className="tr-leiste-speichern" style={{ position: 'sticky', bottom: 12, zIndex: 20, ...card, padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderColor: LILA, boxShadow: '0 10px 30px rgba(0,0,0,.4)' }}>
            {meldung && <span style={{ fontSize: 13, fontWeight: 700, color: meldung.ok ? '#10b981' : '#ef4444', flex: 1 }}>{meldung.text}</span>}
            {offeneAenderungen.length > 0 && <>
              <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 700, flex: 1 }}>{offeneAenderungen.length} Person{offeneAenderungen.length === 1 ? '' : 'en'} geändert</span>
              <button type="button" onClick={() => setAenderungen({})} style={{ padding: '8px 13px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Verwerfen</button>
              <button type="button" disabled={speichert} onClick={alleSpeichern} style={{ padding: '8px 15px', borderRadius: 9, border: 'none', background: LILA, color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{speichert ? '…' : 'Speichern'}</button>
            </>}
          </div>
        )}
      </>}

      {reiter === 'rollen' && ROLLEN_GRUPPEN.map(g => (
        <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="tr-gruppe" style={{ marginBottom: 0 }}>{g.titel} <span>{g.hinweis}</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 10 }} className="tr-rollen">
            {g.keys.map(rolle).filter(Boolean).map(r => {
              const wer = aktive.filter(u => rollenVon(u).includes(r.key)).map(u => u.display_name)
              return (
                <div key={r.key} style={{ ...card, padding: '13px 14px' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <b style={{ flex: 1, fontSize: 14.5, color: 'var(--text-primary)' }}>{r.label}</b>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: r.color + '22', color: r.color }}>{wer.length}</span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 17, color: 'var(--text-secondary)', fontSize: 12.5, lineHeight: 1.55 }}>
                    {(r.punkte || [r.desc]).map((p, i) => <li key={i}>{p}</li>)}
                  </ul>
                  <div style={{ ...klein, marginTop: 8 }}>{wer.length ? (wer.length > 6 ? wer.slice(0, 6).join(', ') + ` … +${wer.length - 6}` : wer.join(', ')) : 'noch niemand'}</div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {offen && <Fenster u={offen} zuteilung={zuteilung} onZu={() => setOffenId(null)} rollenSetzen={rollenSetzen} profilSpeichern={profilSpeichern}
        onStatus={onStatus} onReaktivieren={onReaktivieren} onExport={onExport} statusBusy={statusBusy} onNeu={onNeu} />}
    </div>
  )
}

