import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { statusVon, endVideo, linkOk, mitHttps } from '../reelSkripte'
import { useVorschau, vorschauSperre } from '../vorschau'

// ── Posting-Plan (v5.3.0) ──────────────────────────────────────────────────
// Kalender pro Account und Tag für Reels und Stories. Links das Material
// (Models tragen es selbst ein oder das Team; freigegebene Skript-Reels
// kommen automatisch dazu), in der Mitte die Woche, Klick öffnet den Beitrag
// mit Video, Caption, Hashtags, Text-Overlays, Story-Frames, Hinweis.
//
// Wer darf was (sql/posting-plan.sql):
//   Admin / Social-Leitung: alles, alle Accounts (Filter oben)
//   Poster: plant und postet auf seinen zugeteilten Accounts
//   Model: sieht ihren Plan und trägt Material ein (PlanModel unten)
//
// Zeiten: gespeichert als Zeitpunkt, angezeigt in der Zeit des Geräts — die
// Posterin in New York sieht also automatisch ihre Uhrzeit.
// Posten eines Reels (Link eintragen) → automatisch gemessen (Trigger).

const TX = {
  de: {
    plan: 'Posting-Plan', woche: 'Woche', heute: 'Heute', alle: 'Alle Accounts', material: 'Material · noch nicht eingeplant',
    material_text: 'Tippen zum Einplanen.', material_neu: '+ Material eintragen', kein_material: 'Kein offenes Material.',
    aus_skript: 'aus Skript', ohne_skript: 'ohne Skript', reel: 'Reel', story: 'Story', geplant: 'geplant', gepostet: 'gepostet',
    neu: '+ Beitrag', einplanen: 'Einplanen', speichern: 'Speichern', abbrechen: 'Abbrechen', loeschen: 'Löschen',
    loeschen_frage: 'Diesen Eintrag aus dem Plan löschen?', art: 'Art', account: 'Account', wann: 'Wann', titel: 'Titel',
    video: 'Video-Link', caption: 'Caption', hashtags: 'Hashtags', overlays: 'Text-Overlays', overlay_neu: '+ Overlay',
    frames: 'Story-Frames', frame_neu: '+ Frame', frame_text: 'Text', frame_sticker: 'Sticker (Umfrage, Link …)', frame_link: 'Material-Link',
    hinweis: 'Musik / Hinweis', vorschlag: 'Vorschlag von Lyra', uebernehmen: 'übernehmen', kopieren: 'kopieren', kopiert: 'kopiert ✓',
    laden: '⬇ Video laden', posten_titel: 'Posten', reel_link: 'Link zum Reel (Instagram: ⋯ → Link kopieren)', gepostet_knopf: 'Gepostet ✓',
    story_gepostet: 'Story gepostet ✓', gemessen: 'Wird automatisch gemessen.', zurueck: 'Doch nicht gepostet',
    fehler_account: 'Bitte einen Account wählen.', fehler_zeit: 'Bitte Datum und Uhrzeit angeben.', fehler_reel: 'Bitte den Instagram-Link zum Reel einfügen.',
    nicht_gespeichert: 'Nicht gespeichert: ', leer_tag: '', deine_zeit: 'deine Zeit', heute_nichts: 'Heute ist nichts geplant.',
    heute_titel: '📅 Heute geplant', oeffnen: 'Öffnen', model: 'Model', notiz: 'Notiz', tabelle_fehlt: 'Posting-Plan: Datenbank noch nicht eingerichtet (sql/posting-plan.sql).',
    tage: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'], nur_lesen: 'Nur ansehen', frames_n: (n) => `Story · ${n} Frame${n === 1 ? '' : 's'}`,
  },
  en: {
    plan: 'Posting calendar', woche: 'Week', heute: 'Today', alle: 'All accounts', material: 'Material · not scheduled yet',
    material_text: 'Tap to schedule.', material_neu: '+ Add material', kein_material: 'No open material.',
    aus_skript: 'from script', ohne_skript: 'no script', reel: 'Reel', story: 'Story', geplant: 'scheduled', gepostet: 'posted',
    neu: '+ Post', einplanen: 'Schedule', speichern: 'Save', abbrechen: 'Cancel', loeschen: 'Delete',
    loeschen_frage: 'Delete this entry from the calendar?', art: 'Type', account: 'Account', wann: 'When', titel: 'Title',
    video: 'Video link', caption: 'Caption', hashtags: 'Hashtags', overlays: 'Text overlays', overlay_neu: '+ Overlay',
    frames: 'Story frames', frame_neu: '+ Frame', frame_text: 'Text', frame_sticker: 'Sticker (poll, link …)', frame_link: 'Material link',
    hinweis: 'Music / note', vorschlag: 'Suggestion from Lyra', uebernehmen: 'use', kopieren: 'copy', kopiert: 'copied ✓',
    laden: '⬇ Download video', posten_titel: 'Post', reel_link: 'Link to the reel (Instagram: ⋯ → Copy link)', gepostet_knopf: 'Posted ✓',
    story_gepostet: 'Story posted ✓', gemessen: 'Gets measured automatically.', zurueck: 'Not posted after all',
    fehler_account: 'Please choose an account.', fehler_zeit: 'Please set date and time.', fehler_reel: 'Please paste the Instagram link to the reel.',
    nicht_gespeichert: 'Not saved: ', leer_tag: '', deine_zeit: 'your time', heute_nichts: 'Nothing scheduled today.',
    heute_titel: '📅 Scheduled today', oeffnen: 'Open', model: 'Creator', notiz: 'Note', tabelle_fehlt: 'Posting calendar: database not set up yet.',
    tage: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], nur_lesen: 'View only', frames_n: (n) => `Story · ${n} frame${n === 1 ? '' : 's'}`,
  },
}

const P = '#ec4899', V = '#8b5cf6', C = '#06b6d4', G = '#10b981', A = '#f59e0b', ROT = '#ef4444'
const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 15px' }
const eingabe = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', width: '100%' }
const klein = { fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }
const pill = (f) => ({ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: f + '22', color: f, whiteSpace: 'nowrap' })
const knopf = (f, voll) => ({ padding: '7px 12px', borderRadius: 9, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', border: voll ? 'none' : `1px solid ${f}`, background: voll ? f : 'transparent', color: voll ? '#fff' : f, whiteSpace: 'nowrap' })
const artFarbe = (a) => a === 'story' ? V : P

// Datum-Helfer (lokale Zeit des Geräts)
const tagStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const wocheStart = (d) => { const x = tagStart(d); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x }
const plusTage = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const gleicherTag = (a, b) => tagStart(a).getTime() === tagStart(b).getTime()
const zuLokalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }
const uhr = (iso, loc) => new Date(iso).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })

async function kopiere(text) { try { await navigator.clipboard.writeText(text || ''); return true } catch { return false } }

function KopierKnopf({ text, T }) {
  const [ok, setOk] = useState(false)
  if (!text) return null
  return <button type="button" onClick={async () => { if (await kopiere(text)) { setOk(true); setTimeout(() => setOk(false), 1500) } }}
    style={{ background: 'none', border: 'none', color: ok ? G : C, fontWeight: 700, fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>📋 {ok ? T.kopiert : T.kopieren}</button>
}

// ── Daten laden (gemeinsam für Plan und „Heute“) ───────────────────────────
export function usePlan(accounts, von, bis) {
  const [zeilen, setZeilen] = useState(null)
  const [fehlt, setFehlt] = useState(false)
  const schluessel = accounts.map(a => a.model + '|' + a.handle.toLowerCase()).join(',')
  const laden = useCallback(async () => {
    const { data, error } = await supabase.from('social_plan').select('*')
      .gte('geplant_am', von.toISOString()).lt('geplant_am', bis.toISOString()).order('geplant_am')
    if (error) { setFehlt(true); setZeilen([]); return }
    const erlaubt = new Set(schluessel.split(','))
    setZeilen((data || []).filter(z => erlaubt.has(z.model_name + '|' + String(z.account).toLowerCase())))
  }, [schluessel, von.getTime(), bis.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { laden() }, [laden])
  return { zeilen, fehlt, laden }
}

// ── Hauptansicht ───────────────────────────────────────────────────────────
// accounts: [{ model, handle, notiz }] — schon gefiltert (Poster: nur eigene)
// skripte: Skripte aus dem Social Manager (für „aus Skript“-Material)
export default function SocialPlan({ accounts = [], skripte = [], sprache = 'de', darfPlanen = true, userDisplayName }) {
  const T = TX[sprache] || TX.de
  const loc = sprache === 'en' ? 'en-US' : 'de-DE'
  const [start, setStart] = useState(() => wocheStart(new Date()))
  const [filter, setFilter] = useState('')
  const [offen, setOffen] = useState(null) // Entwurf/Zeile im Fenster
  const [material, setMaterial] = useState([])
  const [verplant, setVerplant] = useState(new Set())
  const [neuMaterial, setNeuMaterial] = useState(false)
  const ende = useMemo(() => plusTage(start, 7), [start])
  const { zeilen, fehlt, laden } = usePlan(accounts, start, ende)
  const models = [...new Set(accounts.map(a => a.model))]

  const ladenMaterial = useCallback(async () => {
    if (!models.length) { setMaterial([]); return }
    const [m, v] = await Promise.all([
      supabase.from('social_material').select('*').eq('verworfen', false).in('model_name', models).order('erstellt_am', { ascending: false }).limit(200),
      supabase.from('social_plan').select('material_id, skript_id').in('model_name', models),
    ])
    const vp = new Set()
    for (const z of v.data || []) { if (z.material_id) vp.add('m' + z.material_id); if (z.skript_id) vp.add('s' + z.skript_id) }
    setVerplant(vp)
    setMaterial(m.error ? [] : (m.data || []))
  }, [models.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { ladenMaterial() }, [ladenMaterial])

  const neuLaden = () => { laden(); ladenMaterial() }
  const sichtbar = accounts.filter(a => !filter || (a.model + '|' + a.handle) === filter)
  const tage = [...Array(7)].map((_, i) => plusTage(start, i))

  // Material-Liste: eigenes Material + Skript-Reels, die noch nicht im Plan stehen und nicht gepostet sind
  const materialListe = [
    ...material.filter(m => !verplant.has('m' + m.id)).map(m => ({ key: 'm' + m.id, art: m.art, titel: m.titel, model: m.model_name, link: m.link, quelle: T.ohne_skript, material_id: m.id, notiz: m.notiz })),
    ...skripte.filter(s => !s.verworfen && !s.reel_url && !verplant.has('s' + s.id) && models.includes(s.model_name) && statusVon(s) !== 'gepostet')
      .map(s => ({ key: 's' + s.id, art: 'reel', titel: `${s.nr} ${s.titel}`, model: s.model_name, link: endVideo(s), quelle: `${T.aus_skript} · ${s.nr}`, skript_id: s.id, ziel: s.ziel_account })),
  ].filter(x => !filter || x.model === filter.split('|')[0])

  const einplanen = (x) => {
    const accs = accounts.filter(a => a.model === x.model)
    const acc = x.ziel ? accs.find(a => a.handle.toLowerCase() === String(x.ziel).toLowerCase()) : (accs.length === 1 ? accs[0] : null)
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(18, 0, 0, 0)
    setOffen({ model_name: x.model, account: acc?.handle || '', art: x.art, titel: x.titel, video_link: x.link || '', material_id: x.material_id || null, skript_id: x.skript_id || null, geplant_am: d.toISOString(), caption: '', hashtags: '', overlays: [], frames: [], hinweis: '', status: 'geplant' })
  }
  const neuInZelle = (acc, tag) => {
    const d = new Date(tag); d.setHours(18, 0, 0, 0)
    setOffen({ model_name: acc.model, account: acc.handle, art: 'reel', titel: '', video_link: '', geplant_am: d.toISOString(), caption: '', hashtags: '', overlays: [], frames: [], hinweis: '', status: 'geplant' })
  }

  if (fehlt) return <div style={{ ...card, color: 'var(--text-muted)', fontSize: 13 }}>{T.tabelle_fehlt}</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <style>{`.plan-raster { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 12px; align-items: start; } @media (max-width: 900px) { .plan-raster { grid-template-columns: 1fr; } .plan-material { order: 2; } }`}</style>
      <div className="plan-raster">
        {/* Material */}
        <div className="plan-material" style={{ ...card, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={klein}>🎞 {T.material}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{darfPlanen ? T.material_text : T.nur_lesen}</div>
          {!materialListe.length && <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{T.kein_material}</div>}
          {materialListe.slice(0, 40).map(x => (
            <button key={x.key} type="button" disabled={!darfPlanen} onClick={() => einplanen(x)}
              style={{ display: 'flex', gap: 8, alignItems: 'center', textAlign: 'left', padding: 8, borderRadius: 11, background: 'var(--bg-card2)', border: '1px solid var(--border)', cursor: darfPlanen ? 'pointer' : 'default', fontFamily: 'inherit', color: 'var(--text-primary)' }}>
              <span style={{ width: 30, height: 40, borderRadius: 7, background: artFarbe(x.art) + '33', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{x.art === 'story' ? '📷' : '🎬'}</span>
              <span style={{ minWidth: 0 }}>
                <b style={{ display: 'block', fontSize: 12.5 }}>{x.titel}</b>
                <span style={pill(artFarbe(x.art))}>{x.art === 'story' ? T.story : T.reel}</span> <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{x.model} · {x.quelle}</span>
              </span>
            </button>
          ))}
          <button type="button" onClick={() => setNeuMaterial(true)} style={{ ...knopf('var(--text-secondary)', false), marginTop: 2 }}>{T.material_neu}</button>
        </div>

        {/* Woche */}
        <div style={{ ...card, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <button type="button" onClick={() => setStart(plusTage(start, -7))} style={knopf('var(--text-secondary)', false)}>‹</button>
            <b style={{ color: 'var(--text-primary)' }}>{start.toLocaleDateString(loc, { day: '2-digit', month: '2-digit' })} – {plusTage(start, 6).toLocaleDateString(loc, { day: '2-digit', month: '2-digit' })}</b>
            <button type="button" onClick={() => setStart(plusTage(start, 7))} style={knopf('var(--text-secondary)', false)}>›</button>
            <button type="button" onClick={() => setStart(wocheStart(new Date()))} style={knopf(C, false)}>{T.heute}</button>
            <span style={{ flex: 1 }} />
            {accounts.length > 1 && (
              <select value={filter} onChange={e => setFilter(e.target.value)} style={{ ...eingabe, width: 'auto' }}>
                <option value="">{T.alle}</option>
                {accounts.map(a => <option key={a.model + a.handle} value={a.model + '|' + a.handle}>{a.handle} · {a.model}</option>)}
              </select>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: `110px repeat(7, minmax(92px, 1fr))`, gap: 5, minWidth: 760 }}>
              <div />
              {tage.map((d, i) => <div key={i} style={{ textAlign: 'center', fontSize: 11.5, fontWeight: 800, color: gleicherTag(d, new Date()) ? P : 'var(--text-secondary)', padding: '3px 0' }}>{T.tage[i]} {d.getDate()}.</div>)}
              {sichtbar.map(a => (
                <React.Fragment key={a.model + a.handle}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: P, padding: '6px 2px', wordBreak: 'break-all' }}>{a.handle}<div style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{a.model}</div></div>
                  {tage.map((d, i) => {
                    const drin = (zeilen || []).filter(z => z.model_name === a.model && String(z.account).toLowerCase() === a.handle.toLowerCase() && gleicherTag(z.geplant_am, d))
                    return (
                      <div key={i} style={{ minHeight: 84, background: 'var(--bg-input)', border: '1px dashed var(--border)', borderRadius: 10, padding: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {drin.map(z => (
                          <button key={z.id} type="button" onClick={() => setOffen(z)}
                            style={{ textAlign: 'left', borderRadius: 8, padding: '5px 6px', fontSize: 11, lineHeight: 1.3, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-primary)', background: artFarbe(z.art) + '1f', border: `1px solid ${artFarbe(z.art)}55`, opacity: z.status === 'gepostet' ? 0.6 : 1 }}>
                            <span style={{ color: 'var(--text-muted)' }}>{uhr(z.geplant_am, loc)}</span>
                            <b style={{ display: 'block', fontSize: 11.5 }}>{z.art === 'story' ? T.frames_n((z.frames || []).length) : (z.titel || T.reel)}</b>
                            {z.status === 'gepostet' && <span style={pill(G)}>{T.gepostet}</span>}
                          </button>
                        ))}
                        {darfPlanen && <button type="button" onClick={() => neuInZelle(a, d)} style={{ marginTop: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>+</button>}
                      </div>
                    )
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>
      {offen && <PlanFenster start={offen} accounts={accounts} T={T} loc={loc} darf={darfPlanen} userDisplayName={userDisplayName} onZu={(neu) => { setOffen(null); if (neu) neuLaden() }} />}
      {neuMaterial && <MaterialFenster models={models} T={T} userDisplayName={userDisplayName} onZu={(neu) => { setNeuMaterial(false); if (neu) ladenMaterial() }} />}
    </div>
  )
}

// ── „Heute geplant“ (oben unter „Zu posten“) ───────────────────────────────
export function PlanHeute({ accounts = [], sprache = 'de', userDisplayName }) {
  const T = TX[sprache] || TX.de
  const loc = sprache === 'en' ? 'en-US' : 'de-DE'
  const von = useMemo(() => tagStart(new Date()), [])
  const bis = useMemo(() => plusTage(von, 1), [von])
  const { zeilen, fehlt, laden } = usePlan(accounts, von, bis)
  const [offen, setOffen] = useState(null)
  if (fehlt || !zeilen) return null
  const liste = zeilen.filter(z => z.status !== 'gepostet')
  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{T.heute_titel}</div>
      {!liste.length && <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{T.heute_nichts}</div>}
      {liste.map(z => (
        <div key={z.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 10px', borderRadius: 11, background: 'var(--bg-card2)', border: `1px solid ${artFarbe(z.art)}44` }}>
          <span style={pill(artFarbe(z.art))}>{z.art === 'story' ? T.story : T.reel}</span>
          <b style={{ fontSize: 13, color: 'var(--text-primary)' }}>{uhr(z.geplant_am, loc)}</b>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({T.deine_zeit})</span>
          <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1, minWidth: 120 }}>{z.art === 'story' ? T.frames_n((z.frames || []).length) : (z.titel || '')} · <span style={{ color: P, fontWeight: 700 }}>{z.account}</span></span>
          {z.video_link && <a href={mitHttps(z.video_link)} target="_blank" rel="noreferrer" style={{ color: C, fontWeight: 700, fontSize: 12.5 }}>{T.laden}</a>}
          <KopierKnopf text={z.caption} T={{ ...T, kopieren: T.caption }} />
          <KopierKnopf text={z.hashtags} T={{ ...T, kopieren: T.hashtags }} />
          <button type="button" onClick={() => setOffen(z)} style={knopf(P, true)}>{T.oeffnen}</button>
        </div>
      ))}
      {offen && <PlanFenster start={offen} accounts={accounts} T={T} loc={loc} darf userDisplayName={userDisplayName} onZu={(neu) => { setOffen(null); if (neu) laden() }} />}
    </div>
  )
}

// ── Beitrag bearbeiten / posten ────────────────────────────────────────────
function PlanFenster({ start, accounts, T, loc, darf, userDisplayName, onZu }) {
  const vorschau = useVorschau()
  const [f, setF] = useState(() => ({ ...start, overlays: Array.isArray(start.overlays) ? start.overlays : [], frames: Array.isArray(start.frames) ? start.frames : [] }))
  const [zeit, setZeit] = useState(zuLokalInput(start.geplant_am))
  const [reel, setReel] = useState(start.reel_url || '')
  const [fehler, setFehler] = useState('')
  const [arbeitet, setArbeitet] = useState(false)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const accWert = f.model_name && f.account ? f.model_name + '|' + f.account : ''
  const nurLesen = !darf

  const felder = () => ({
    model_name: f.model_name, account: f.account, art: f.art, geplant_am: new Date(zeit).toISOString(),
    titel: (f.titel || '').trim() || null, video_link: (f.video_link || '').trim() ? mitHttps(f.video_link) : null,
    caption: f.caption || null, hashtags: f.hashtags || null, hinweis: f.hinweis || null,
    overlays: (f.overlays || []).filter(o => (o.text || '').trim()), frames: (f.frames || []).filter(x => (x.text || x.link || x.sticker || '').trim()),
    material_id: f.material_id || null, skript_id: f.skript_id || null,
  })
  const speichern = async (extra = {}) => {
    if (vorschau) return vorschauSperre()
    if (!f.model_name || !f.account) { setFehler(T.fehler_account); return false }
    if (!zeit || isNaN(new Date(zeit))) { setFehler(T.fehler_zeit); return false }
    setArbeitet(true); setFehler('')
    const daten = { ...felder(), ...extra }
    const r = f.id ? await supabase.from('social_plan').update(daten).eq('id', f.id) : await supabase.from('social_plan').insert(daten)
    setArbeitet(false)
    if (r.error) { setFehler(T.nicht_gespeichert + r.error.message); return false }
    onZu(true); return true
  }
  const loeschen = async () => {
    if (vorschau) return vorschauSperre()
    if (!window.confirm(T.loeschen_frage)) return
    const { error } = await supabase.from('social_plan').delete().eq('id', f.id)
    if (error) { setFehler(T.nicht_gespeichert + error.message); return }
    onZu(true)
  }
  const gepostet = async () => {
    if (f.art === 'reel') {
      const r = mitHttps(reel)
      if (!linkOk(r) || !/instagram\.com\//i.test(r)) { setFehler(T.fehler_reel); return }
      await speichern({ status: 'gepostet', reel_url: r, gepostet_von: userDisplayName || null })
    } else await speichern({ status: 'gepostet', gepostet_von: userDisplayName || null })
  }

  const zeile = (label, inhalt, rechts) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ ...klein, display: 'flex', justifyContent: 'space-between' }}><span>{label}</span>{rechts}</div>{inhalt}
    </div>
  )
  return (
    <div onClick={() => !arbeitet && onZu(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 12px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(560px, 100%)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 20, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {['reel', 'story'].map(a => (
            <button key={a} type="button" disabled={nurLesen} onClick={() => set('art', a)} style={{ ...knopf(artFarbe(a), f.art === a), padding: '5px 12px' }}>{a === 'story' ? T.story : T.reel}</button>
          ))}
          <span style={{ flex: 1 }} />
          <span style={pill(f.status === 'gepostet' ? G : A)}>{f.status === 'gepostet' ? T.gepostet : T.geplant}</span>
          <button type="button" onClick={() => onZu(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {zeile(T.account, <select disabled={nurLesen} value={accWert} onChange={e => { const [m, h] = e.target.value.split('|'); setF(x => ({ ...x, model_name: m, account: h })) }} style={eingabe}>
            <option value="">—</option>
            {accounts.map(a => <option key={a.model + a.handle} value={a.model + '|' + a.handle}>{a.handle} · {a.model}</option>)}
          </select>)}
          {zeile(`${T.wann} (${T.deine_zeit})`, <input disabled={nurLesen} type="datetime-local" value={zeit} onChange={e => setZeit(e.target.value)} style={eingabe} />)}
        </div>
        {zeile(T.titel, <input disabled={nurLesen} value={f.titel || ''} onChange={e => set('titel', e.target.value.slice(0, 120))} style={eingabe} />)}
        {zeile(T.video, <input disabled={nurLesen} value={f.video_link || ''} onChange={e => set('video_link', e.target.value.slice(0, 500))} placeholder="https://www.dropbox.com/…" style={eingabe} />,
          f.video_link ? <a href={mitHttps(f.video_link)} target="_blank" rel="noreferrer" style={{ color: C, textTransform: 'none', letterSpacing: 0 }}>{T.laden}</a> : null)}

        {f.art === 'reel' && (<>
          {zeile(T.caption, <textarea disabled={nurLesen} rows={3} value={f.caption || ''} onChange={e => set('caption', e.target.value.slice(0, 2200))} style={{ ...eingabe, resize: 'vertical' }} />,
            <KopierKnopf text={f.caption} T={T} />)}
          {f.caption_vorschlag && f.caption_vorschlag !== f.caption && (
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.35)', borderRadius: 10, padding: '7px 9px' }}>
              ✨ {T.vorschlag}: {f.caption_vorschlag} {!nurLesen && <button type="button" onClick={() => set('caption', f.caption_vorschlag)} style={{ ...knopf(V, false), padding: '2px 8px', fontSize: 11 }}>{T.uebernehmen}</button>}
            </div>
          )}
          {zeile(T.hashtags, <input disabled={nurLesen} value={f.hashtags || ''} onChange={e => set('hashtags', e.target.value.slice(0, 600))} placeholder="#…" style={eingabe} />, <KopierKnopf text={f.hashtags} T={T} />)}
          {f.hashtags_vorschlag && f.hashtags_vorschlag !== f.hashtags && (
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.35)', borderRadius: 10, padding: '7px 9px' }}>
              ✨ {T.vorschlag}: {f.hashtags_vorschlag} {!nurLesen && <button type="button" onClick={() => set('hashtags', f.hashtags_vorschlag)} style={{ ...knopf(V, false), padding: '2px 8px', fontSize: 11 }}>{T.uebernehmen}</button>}
            </div>
          )}
          {zeile(T.overlays, <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {(f.overlays || []).map((o, i) => (
              <div key={i} style={{ display: 'flex', gap: 6 }}>
                <input disabled={nurLesen} value={o.zeit || ''} onChange={e => set('overlays', f.overlays.map((x, j) => j === i ? { ...x, zeit: e.target.value.slice(0, 8) } : x))} placeholder="0:04" style={{ ...eingabe, width: 70, fontFamily: 'ui-monospace, monospace' }} />
                <input disabled={nurLesen} value={o.text || ''} onChange={e => set('overlays', f.overlays.map((x, j) => j === i ? { ...x, text: e.target.value.slice(0, 200) } : x))} style={eingabe} />
                {!nurLesen && <button type="button" onClick={() => set('overlays', f.overlays.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>}
              </div>
            ))}
            {!nurLesen && <button type="button" onClick={() => set('overlays', [...(f.overlays || []), { zeit: '', text: '' }])} style={{ ...knopf('var(--text-secondary)', false), alignSelf: 'flex-start', padding: '4px 10px' }}>{T.overlay_neu}</button>}
          </div>)}
        </>)}

        {f.art === 'story' && zeile(T.frames, <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(f.frames || []).map((x, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '26px 1fr', gap: 6, alignItems: 'start', background: 'var(--bg-card2)', borderRadius: 10, padding: 7 }}>
              <b style={{ color: V, textAlign: 'center', paddingTop: 7 }}>{i + 1}</b>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <input disabled={nurLesen} value={x.link || ''} onChange={e => set('frames', f.frames.map((y, j) => j === i ? { ...y, link: e.target.value.slice(0, 500) } : y))} placeholder={T.frame_link} style={eingabe} />
                <input disabled={nurLesen} value={x.text || ''} onChange={e => set('frames', f.frames.map((y, j) => j === i ? { ...y, text: e.target.value.slice(0, 200) } : y))} placeholder={T.frame_text} style={eingabe} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <input disabled={nurLesen} value={x.sticker || ''} onChange={e => set('frames', f.frames.map((y, j) => j === i ? { ...y, sticker: e.target.value.slice(0, 200) } : y))} placeholder={T.frame_sticker} style={eingabe} />
                  {!nurLesen && <button type="button" onClick={() => set('frames', f.frames.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>}
                </div>
              </div>
            </div>
          ))}
          {!nurLesen && <button type="button" onClick={() => set('frames', [...(f.frames || []), { link: '', text: '', sticker: '' }])} style={{ ...knopf('var(--text-secondary)', false), alignSelf: 'flex-start', padding: '4px 10px' }}>{T.frame_neu}</button>}
        </div>)}

        {zeile(T.hinweis, <input disabled={nurLesen} value={f.hinweis || ''} onChange={e => set('hinweis', e.target.value.slice(0, 300))} style={eingabe} />)}

        {/* Posten */}
        {f.id && darf && f.status !== 'gepostet' && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={klein}>{T.posten_titel}</div>
            {f.art === 'reel' && <input value={reel} onChange={e => setReel(e.target.value.slice(0, 500))} placeholder={T.reel_link} inputMode="url" autoCapitalize="none" style={eingabe} />}
            <button type="button" disabled={arbeitet} onClick={gepostet} style={{ ...knopf(G, true), color: '#04140e', padding: 10 }}>{f.art === 'reel' ? T.gepostet_knopf : T.story_gepostet}</button>
            {f.art === 'reel' && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{T.gemessen}</div>}
          </div>
        )}
        {f.id && darf && f.status === 'gepostet' && (
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
            ✓ {T.gepostet}{f.reel_url && <> · <a href={f.reel_url} target="_blank" rel="noreferrer" style={{ color: G, fontWeight: 700 }}>Reel</a></>}
            {' · '}<button type="button" onClick={() => speichern({ status: 'geplant', reel_url: null, gepostet_am: null, gepostet_von: null })} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}>{T.zurueck}</button>
          </div>
        )}

        {fehler && <div style={{ fontSize: 12.5, color: ROT }}>{fehler}</div>}
        {darf && (
          <div style={{ display: 'flex', gap: 8 }}>
            {f.id && <button type="button" onClick={loeschen} style={knopf(ROT, false)}>{T.loeschen}</button>}
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => onZu(false)} style={knopf('var(--text-secondary)', false)}>{T.abbrechen}</button>
            <button type="button" disabled={arbeitet} onClick={() => speichern()} style={knopf(P, true)}>{arbeitet ? '…' : (f.id ? T.speichern : T.einplanen)}</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Material eintragen (Team oder Model) ───────────────────────────────────
export function MaterialFenster({ models = [], T: Taus, sprache = 'de', userDisplayName, festesModel = null, onZu }) {
  const T = Taus || TX[sprache] || TX.de
  const vorschau = useVorschau()
  const [model, setModel] = useState(festesModel || (models.length === 1 ? models[0] : ''))
  const [art, setArt] = useState('reel')
  const [titel, setTitel] = useState('')
  const [link, setLink] = useState('')
  const [notiz, setNotiz] = useState('')
  const [fehler, setFehler] = useState('')
  const [arbeitet, setArbeitet] = useState(false)
  const speichern = async () => {
    if (vorschau) return vorschauSperre()
    if (!model || !titel.trim()) { setFehler(T.titel + ' ?'); return }
    setArbeitet(true)
    const { error } = await supabase.from('social_material').insert({ model_name: model, art, titel: titel.trim().slice(0, 120), link: link.trim() ? mitHttps(link) : null, notiz: notiz.trim() || null, erstellt_von: userDisplayName || null })
    setArbeitet(false)
    if (error) { setFehler(T.nicht_gespeichert + error.message); return }
    onZu(true)
  }
  return (
    <div onClick={() => !arbeitet && onZu(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(440px, 100%)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 20, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <b style={{ fontSize: 16, color: 'var(--text-primary)' }}>{T.material_neu.replace('+ ', '')}</b>
        {!festesModel && models.length > 1 && <select value={model} onChange={e => setModel(e.target.value)} style={eingabe}><option value="">{T.model} …</option>{models.map(m => <option key={m} value={m}>{m}</option>)}</select>}
        <div style={{ display: 'flex', gap: 6 }}>{['reel', 'story'].map(a => <button key={a} type="button" onClick={() => setArt(a)} style={{ ...knopf(artFarbe(a), art === a), padding: '5px 12px' }}>{a === 'story' ? T.story : T.reel}</button>)}</div>
        <input value={titel} onChange={e => setTitel(e.target.value)} placeholder={T.titel} style={eingabe} />
        <input value={link} onChange={e => setLink(e.target.value)} placeholder={T.video + ' (Dropbox, Google Drive …)'} inputMode="url" autoCapitalize="none" style={eingabe} />
        <input value={notiz} onChange={e => setNotiz(e.target.value)} placeholder={T.notiz} style={eingabe} />
        {fehler && <div style={{ fontSize: 12.5, color: ROT }}>{fehler}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => onZu(false)} style={knopf('var(--text-secondary)', false)}>{T.abbrechen}</button>
          <button type="button" disabled={arbeitet} onClick={speichern} style={knopf(P, true)}>{arbeitet ? '…' : T.speichern}</button>
        </div>
      </div>
    </div>
  )
}

// ── Model-Portal: eigener Plan (nur lesen) + Material eintragen ────────────
export function PlanModel({ displayName, isPreview = false, cardS = {} }) {
  const T = TX.de
  const [zeilen, setZeilen] = useState(null)
  const [material, setMaterial] = useState([])
  const [neu, setNeu] = useState(false)
  const laden = useCallback(async () => {
    if (!displayName) return
    const von = tagStart(new Date())
    const [p, m] = await Promise.all([
      supabase.from('social_plan').select('*').eq('model_name', displayName).gte('geplant_am', von.toISOString()).lt('geplant_am', plusTage(von, 14).toISOString()).order('geplant_am'),
      supabase.from('social_material').select('*').eq('model_name', displayName).eq('verworfen', false).order('erstellt_am', { ascending: false }).limit(10),
    ])
    setZeilen(p.error ? null : (p.data || []))
    setMaterial(m.error ? [] : (m.data || []))
  }, [displayName])
  useEffect(() => { laden() }, [laden])
  if (zeilen === null) return null
  const tage = [...new Set(zeilen.map(z => tagStart(z.geplant_am).getTime()))]
  return (
    <div style={{ ...cardS, padding: '14px 15px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 20 }}>📅</span>
        <b style={{ flex: 1, fontSize: 14.5, color: 'var(--text-primary)' }}>Dein Posting-Plan · 14 Tage</b>
        {!isPreview && <button type="button" onClick={() => setNeu(true)} style={knopf(P, false)}>+ Eigenes Material</button>}
      </div>
      {!zeilen.length && <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Noch nichts geplant.</div>}
      {tage.map(t => (
        <div key={t}>
          <div style={{ ...klein, marginBottom: 4 }}>{new Date(t).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' })}</div>
          {zeilen.filter(z => tagStart(z.geplant_am).getTime() === t).map(z => (
            <div key={z.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={pill(artFarbe(z.art))}>{z.art === 'story' ? 'Story' : 'Reel'}</span>
              <b style={{ color: 'var(--text-primary)' }}>{uhr(z.geplant_am, 'de-DE')}</b>
              <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{z.art === 'story' ? T.frames_n((z.frames || []).length) : (z.titel || '')}</span>
              <span style={{ color: P, fontSize: 12 }}>{z.account}</span>
              {z.status === 'gepostet' && <span style={pill(G)}>gepostet</span>}
            </div>
          ))}
        </div>
      ))}
      {material.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Dein Material: {material.map(m => `${m.art === 'story' ? '📷' : '🎬'} ${m.titel}`).join(' · ')}</div>
      )}
      {neu && <MaterialFenster festesModel={displayName} T={T} userDisplayName={displayName} onZu={(x) => { setNeu(false); if (x) laden() }} />}
    </div>
  )
}
