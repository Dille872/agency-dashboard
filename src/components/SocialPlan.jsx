import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { statusVon, endVideo, linkOk, mitHttps, instaHandle } from '../reelSkripte'
import { resolvePlatform, SOCIAL_CATEGORY } from './SocialLinks' // v5.4.0
import { useVorschau, vorschauSperre } from '../vorschau'
import { VideoLink, VideoBild, DateiHochladen } from './VideoLink' // v5.7.0 / v5.9.0
import { istSpeicher } from '../videoSpeicher'
import { STANDARD, zoneKurz, geraeteZone, tagIn, uhrIn, inputWert, vonInput, lokalerTag, wochentagIn } from '../planZeit' // v5.10.0

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
//   v5.4.0: Model mit Schalter „plant mit“ (sql/plan-model.sql) bekommt
//   denselben Kalender und darf auf ihren betreuten Accounts alles wie ein
//   Poster. Im Beitrag steht, wer ihn eingetragen hat (erstellt_von).
//
// Zeiten (v5.10.0): gespeichert als Zeitpunkt, angezeigt und eingegeben in
// der Zeit des ACCOUNTS (accounts[].zone, Standard Deutschland). US-Account
// → „18:00 LA“ für alle; daneben klein die deutsche Zeit (planZeit.js).
// Posten eines Reels (Link eintragen) → automatisch gemessen (Trigger).

const TX = {
  de: {
    plan: 'Posting-Plan', woche: 'Woche', heute: 'Heute', alle: 'Alle Accounts', material: 'Material · noch nicht eingeplant',
    material_text: 'Tippen zum Einplanen.', material_neu: '+ Material eintragen', kein_material: 'Kein offenes Material.',
    aus_skript: 'aus Skript', ohne_skript: 'ohne Skript', reel: 'Reel', story: 'Story', foto: 'Foto', karussell: 'Karussell', karussell_n: (n) => `Karussell · ${n}`, hoch_foto: '⬆ Foto hochladen', hoch_karussell: '⬆ Fotos/Videos hinzufügen (auch mehrere)', karussell_tipp: 'Reihenfolge = wie hier von links nach rechts (1 kommt zuerst). Mit ← → verschieben. Bis zu 20 Teile.', beitrag_link: 'Link zum Beitrag (optional)', beitrag_gepostet: 'Gepostet ✓', geplant: 'geplant', gepostet: 'gepostet',
    neu: '+ Beitrag', einplanen: 'Einplanen', speichern: 'Speichern', abbrechen: 'Abbrechen', loeschen: 'Löschen',
    loeschen_frage: 'Diesen Eintrag aus dem Plan löschen?', art: 'Art', account: 'Account', wann: 'Wann', titel: 'Titel',
    video: 'Video', hoch_video: '⬆ Video hochladen', hoch_datei: '⬆ Foto/Video hochladen', hoch_frames: '⬆ Fotos/Videos hinzufügen (auch mehrere)', story_tipp: 'Jede Datei wird ein eigener Frame, in der Reihenfolge der Auswahl.', caption: 'Caption', hashtags: 'Hashtags', overlays: 'Text-Overlays', overlay_neu: '+ Overlay',
    frames: 'Story-Frames', frame_neu: '+ Frame', frame_text: 'Text', frame_sticker: 'Sticker (Umfrage, Link …)', frame_link: 'Material-Link',
    hinweis: 'Musik / Hinweis', vorschlag: 'Vorschlag von Lyra', uebernehmen: 'übernehmen', kopieren: 'kopieren', kopiert: 'kopiert ✓',
    laden: '⬇ Video laden', posten_titel: 'Posten', reel_link: 'Link zum Reel (Instagram: ⋯ → Link kopieren)', gepostet_knopf: 'Gepostet ✓',
    story_gepostet: 'Story gepostet ✓', gemessen: 'Wird automatisch gemessen.', zurueck: 'Doch nicht gepostet',
    fehler_account: 'Bitte einen Account wählen.', fehler_zeit: 'Bitte Datum und Uhrzeit angeben.', fehler_reel: 'Bitte den Instagram-Link zum Reel einfügen.',
    nicht_gespeichert: 'Nicht gespeichert: ', leer_tag: '', deine_zeit: 'deine Zeit', zeit_von: (k) => `Zeit ${k}`, de_zeit: 'deutsche Zeit', heute_nichts: 'Heute ist nichts geplant.',
    heute_titel: '📅 Heute geplant', oeffnen: 'Öffnen', model: 'Model', notiz: 'Notiz', tabelle_fehlt: 'Posting-Plan: Datenbank noch nicht eingerichtet (sql/posting-plan.sql).',
    tage: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'], nur_lesen: 'Nur ansehen', frames_n: (n) => `Story · ${n} Frame${n === 1 ? '' : 's'}`,
    von: (w) => `von ${w}`, eingetragen: 'Eingetragen', dein_plan: 'Dein Posting-Plan', dein_plan_text: 'Hier planst du zusammen mit uns: Beiträge eintragen, ändern und als gepostet markieren.',
  },
  en: {
    plan: 'Posting calendar', woche: 'Week', heute: 'Today', alle: 'All accounts', material: 'Material · not scheduled yet',
    material_text: 'Tap to schedule.', material_neu: '+ Add material', kein_material: 'No open material.',
    aus_skript: 'from script', ohne_skript: 'no script', reel: 'Reel', story: 'Story', foto: 'Photo', karussell: 'Carousel', karussell_n: (n) => `Carousel · ${n}`, hoch_foto: '⬆ Upload photo', hoch_karussell: '⬆ Add photos/videos (several at once)', karussell_tipp: 'Order = left to right as shown (1 comes first). Move with ← →. Up to 20 items.', beitrag_link: 'Link to the post (optional)', beitrag_gepostet: 'Posted ✓', geplant: 'scheduled', gepostet: 'posted',
    neu: '+ Post', einplanen: 'Schedule', speichern: 'Save', abbrechen: 'Cancel', loeschen: 'Delete',
    loeschen_frage: 'Delete this entry from the calendar?', art: 'Type', account: 'Account', wann: 'When', titel: 'Title',
    video: 'Video', hoch_video: '⬆ Upload video', hoch_datei: '⬆ Upload photo/video', hoch_frames: '⬆ Add photos/videos (several at once)', story_tipp: 'Each file becomes its own frame, in the order selected.', caption: 'Caption', hashtags: 'Hashtags', overlays: 'Text overlays', overlay_neu: '+ Overlay',
    frames: 'Story frames', frame_neu: '+ Frame', frame_text: 'Text', frame_sticker: 'Sticker (poll, link …)', frame_link: 'Material link',
    hinweis: 'Music / note', vorschlag: 'Suggestion from Lyra', uebernehmen: 'use', kopieren: 'copy', kopiert: 'copied ✓',
    laden: '⬇ Download video', posten_titel: 'Post', reel_link: 'Link to the reel (Instagram: ⋯ → Copy link)', gepostet_knopf: 'Posted ✓',
    story_gepostet: 'Story posted ✓', gemessen: 'Gets measured automatically.', zurueck: 'Not posted after all',
    fehler_account: 'Please choose an account.', fehler_zeit: 'Please set date and time.', fehler_reel: 'Please paste the Instagram link to the reel.',
    nicht_gespeichert: 'Not saved: ', leer_tag: '', deine_zeit: 'your time', zeit_von: (k) => `${k} time`, de_zeit: 'German time', heute_nichts: 'Nothing scheduled today.',
    von: (w) => `by ${w}`, eingetragen: 'Added', dein_plan: 'Your posting calendar', dein_plan_text: 'Plan together with us: add posts, edit them and mark them as posted.',
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
const artFarbe = (a) => a === 'story' ? V : a === 'foto' ? A : a === 'karussell' ? C : P
// v5.11.0: Beitragsarten
const ARTEN = ['reel', 'foto', 'karussell', 'story']
const artName = (a, T) => T[a] || T.reel
const artText = (z, T) => z.art === 'story' ? T.frames_n((z.frames || []).length) : z.art === 'karussell' ? (z.titel || T.karussell_n((z.frames || []).length)) : (z.titel || artName(z.art, T))

// Datum-Helfer (lokale Zeit des Geräts)
const tagStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const wocheStart = (d) => { const x = tagStart(d); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x }
const plusTage = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const gleicherTag = (a, b) => tagStart(a).getTime() === tagStart(b).getTime()
const zuLokalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }
const uhr = (iso, loc) => new Date(iso).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })

// v5.9.0: Link-Feld mit „⬆ Hochladen“. Hochgeladene Datei → Vorschaubild statt
// „speicher://…“-Text. model/account bestimmen Ablage und Rechte (Material: ohne account).
function LinkFeld({ value, onChange, model, account = null, nurLesen, placeholder, material = false, nurFoto = false }) {
  if (istSpeicher(value)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <VideoLink href={value} bild laden style={{ color: C, fontWeight: 700, fontSize: 12.5 }}>⬇ laden</VideoLink>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>hochgeladen ✓</span>
        {!nurLesen && <button type="button" onClick={() => onChange('')} title="Datei aus dem Eintrag nehmen" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>}
      </div>
    )
  }
  // v5.9.1: keine Links mehr eintragen. Alte Links aus der Zeit davor bleiben sichtbar.
  if (value) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <VideoLink href={mitHttps(value)} laden style={{ color: C, fontWeight: 700, fontSize: 12.5 }}>⬇ laden</VideoLink>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>(alter Link)</span>
        {!nurLesen && <button type="button" onClick={() => onChange('')} title="Link entfernen" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>}
      </div>
    )
  }
  if (nurLesen) return <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <DateiHochladen model={model} account={material ? null : account} gesperrt={!model || (!material && !account)} onFertig={onChange} text={placeholder || '⬆ Hochladen'} nurFoto={nurFoto} />
      {!model || (!material && !account) ? <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>erst Account wählen</span> : null}
    </div>
  )
}

async function kopiere(text) { try { await navigator.clipboard.writeText(text || ''); return true } catch { return false } }

function KopierKnopf({ text, T }) {
  const [ok, setOk] = useState(false)
  if (!text) return null
  return <button type="button" onClick={async () => { if (await kopiere(text)) { setOk(true); setTimeout(() => setOk(false), 1500) } }}
    style={{ background: 'none', border: 'none', color: ok ? G : C, fontWeight: 700, fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>📋 {ok ? T.kopiert : T.kopieren}</button>
}

// v5.11.0: Karussell-Reihenfolge ändern
const verschieben = (liste, i, d) => { const l = [...liste]; const j = i + d; if (j < 0 || j >= l.length) return l; [l[i], l[j]] = [l[j], l[i]]; return l }
const pfeil = { background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11, padding: '1px 6px', fontFamily: 'inherit' }

// Zeitzone eines Plan-Eintrags/Accounts
const zoneVon = (accounts, model, handle) => accounts.find(a => a.model === model && String(a.handle).toLowerCase() === String(handle || '').toLowerCase())?.zone || STANDARD
// „18:00 LA“ (+ „· 03:00 DE“, wenn die Zone nicht Deutschland ist)
function ZeitText({ iso, zone, gross = false }) {
  const fremd = zone !== STANDARD
  return (
    <span>
      <b style={{ color: 'var(--text-primary)', fontSize: gross ? 13 : undefined }}>{uhrIn(iso, zone)}</b>
      {fremd && <span style={{ color: 'var(--text-muted)', fontSize: 10.5 }}> {zoneKurz(zone)} · {uhrIn(iso, STANDARD)} DE</span>}
    </span>
  )
}

// ── Daten laden (gemeinsam für Plan und „Heute“) ───────────────────────────
export function usePlan(accounts, von, bis) {
  const [zeilen, setZeilen] = useState(null)
  const [fehlt, setFehlt] = useState(false)
  const schluessel = accounts.map(a => a.model + '|' + a.handle.toLowerCase()).join(',')
  const laden = useCallback(async () => {
    // ±1 Tag mehr laden: Tage werden je Account in dessen Zeitzone gezählt
    const { data, error } = await supabase.from('social_plan').select('*')
      .gte('geplant_am', plusTage(von, -1).toISOString()).lt('geplant_am', plusTage(bis, 1).toISOString()).order('geplant_am')
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
    const zone = acc?.zone || STANDARD
    const morgen = plusTage(new Date(), 1)
    setOffen({ model_name: x.model, account: acc?.handle || '', art: x.art, titel: x.titel, video_link: x.link || '', material_id: x.material_id || null, skript_id: x.skript_id || null, geplant_am: vonInput(`${tagIn(morgen.toISOString(), zone)}T18:00`, zone), caption: '', hashtags: '', overlays: [], frames: [], hinweis: '', status: 'geplant' })
  }
  const neuInZelle = (acc, tag) => {
    setOffen({ model_name: acc.model, account: acc.handle, art: 'reel', titel: '', video_link: '', geplant_am: vonInput(`${lokalerTag(tag)}T18:00`, acc.zone || STANDARD), caption: '', hashtags: '', overlays: [], frames: [], hinweis: '', status: 'geplant' })
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
              {istSpeicher(x.link) ? <VideoBild href={x.link} hoehe={40} /> : <span style={{ width: 30, height: 40, borderRadius: 7, background: artFarbe(x.art) + '33', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{x.art === 'story' ? '📷' : '🎬'}</span>}
              <span style={{ minWidth: 0 }}>
                <b style={{ display: 'block', fontSize: 12.5 }}>{x.titel}</b>
                <span style={pill(artFarbe(x.art))}>{x.art === 'story' ? T.story : T.reel}</span> <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{x.model} · {x.quelle}</span>
              </span>
            </button>
          ))}
          {darfPlanen && <button type="button" onClick={() => setNeuMaterial(true)} style={{ ...knopf('var(--text-secondary)', false), marginTop: 2 }}>{T.material_neu}</button>}
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
                  <div style={{ fontSize: 12, fontWeight: 700, color: P, padding: '6px 2px', wordBreak: 'break-all' }}>{a.handle}<div style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{a.model}{(a.zone || STANDARD) !== STANDARD ? ` · 🕒 ${zoneKurz(a.zone)}` : ''}</div></div>
                  {tage.map((d, i) => {
                    const drin = (zeilen || []).filter(z => z.model_name === a.model && String(z.account).toLowerCase() === a.handle.toLowerCase() && tagIn(z.geplant_am, a.zone || STANDARD) === lokalerTag(d))
                    return (
                      <div key={i} style={{ minHeight: 84, background: 'var(--bg-input)', border: '1px dashed var(--border)', borderRadius: 10, padding: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {drin.map(z => (
                          <button key={z.id} type="button" onClick={() => setOffen(z)}
                            style={{ textAlign: 'left', borderRadius: 8, padding: '5px 6px', fontSize: 11, lineHeight: 1.3, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-primary)', background: artFarbe(z.art) + '1f', border: `1px solid ${artFarbe(z.art)}55`, opacity: z.status === 'gepostet' ? 0.6 : 1 }}>
                            <ZeitText iso={z.geplant_am} zone={a.zone || STANDARD} />
                            <b style={{ display: 'block', fontSize: 11.5 }}>{artText(z, T)}</b>
                            {z.erstellt_von && <span style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)' }}>{T.von(z.erstellt_von)}</span>}
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
  // „Heute“ = heute in der Zeit des jeweiligen Accounts
  const liste = zeilen.filter(z => { const zo = zoneVon(accounts, z.model_name, z.account); return z.status !== 'gepostet' && tagIn(z.geplant_am, zo) === tagIn(new Date().toISOString(), zo) })
  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{T.heute_titel}</div>
      {!liste.length && <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{T.heute_nichts}</div>}
      {liste.map(z => (
        <div key={z.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 10px', borderRadius: 11, background: 'var(--bg-card2)', border: `1px solid ${artFarbe(z.art)}44` }}>
          <span style={pill(artFarbe(z.art))}>{artName(z.art, T)}</span>
          <ZeitText iso={z.geplant_am} zone={zoneVon(accounts, z.model_name, z.account)} gross />
          <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1, minWidth: 120 }}>{artText(z, T)} · <span style={{ color: P, fontWeight: 700 }}>{z.account}</span></span>
          {z.video_link && <VideoLink href={mitHttps(z.video_link)} laden style={{ color: C, fontWeight: 700, fontSize: 12.5 }}>{T.laden}</VideoLink>}
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
  const zone = zoneVon(accounts, start.model_name, start.account)
  const [zeit, setZeit] = useState(inputWert(start.geplant_am, zone))
  const [reel, setReel] = useState(start.reel_url || '')
  const [fehler, setFehler] = useState('')
  const [arbeitet, setArbeitet] = useState(false)
  const [uebernommen, setUebernommen] = useState(start.vorschlag_uebernommen === 'geaendert') // v5.3.1: „übernehmen“ geklickt?
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const zoneJetzt = zoneVon(accounts, f.model_name, f.account) // Account gewechselt → Uhrzeit gilt in dessen Zone
  const accWert = f.model_name && f.account ? f.model_name + '|' + f.account : ''
  const nurLesen = !darf

  const felder = () => ({
    model_name: f.model_name, account: f.account, art: f.art, geplant_am: vonInput(zeit, zoneJetzt),
    titel: (f.titel || '').trim() || null, video_link: (f.video_link || '').trim() ? mitHttps(f.video_link) : null,
    caption: f.caption || null, hashtags: f.hashtags || null, hinweis: f.hinweis || null,
    overlays: (f.overlays || []).filter(o => (o.text || '').trim()), frames: (f.frames || []).filter(x => (x.text || x.link || x.sticker || '').trim()),
    material_id: f.material_id || null, skript_id: f.skript_id || null,
    // v5.3.1: für Lyras Auswertung — Vorschlag übernommen (ja), übernommen und geändert, oder nicht genutzt
    ...((f.caption_vorschlag || f.hashtags_vorschlag) ? { vorschlag_uebernommen: vorschlagStand() } : {}),
  })
  function vorschlagStand() {
    const gleich = (a, b) => String(a || '').trim() === String(b || '').trim()
    const capOk = !f.caption_vorschlag || gleich(f.caption, f.caption_vorschlag)
    const tagOk = !f.hashtags_vorschlag || gleich(f.hashtags, f.hashtags_vorschlag)
    return capOk && tagOk ? 'ja' : (uebernommen ? 'geaendert' : 'nein')
  }
  const speichern = async (extra = {}) => {
    if (vorschau) return vorschauSperre()
    if (!f.model_name || !f.account) { setFehler(T.fehler_account); return false }
    if (!zeit || !vonInput(zeit, zoneJetzt)) { setFehler(T.fehler_zeit); return false }
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
    } else if (f.art === 'foto' || f.art === 'karussell') {
      // v5.11.0: Link zum Beitrag ist freiwillig (wird nicht gemessen)
      const r = String(reel || '').trim() ? mitHttps(reel) : null
      if (r && (!linkOk(r) || !/instagram\.com\//i.test(r))) { setFehler(T.fehler_reel); return }
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
          {ARTEN.map(a => (
            <button key={a} type="button" disabled={nurLesen} onClick={() => set('art', a)} style={{ ...knopf(artFarbe(a), f.art === a), padding: '5px 10px' }}>{artName(a, T)}</button>
          ))}
          <span style={{ flex: 1 }} />
          {f.id && f.erstellt_von && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{T.von(f.erstellt_von)}</span>}
          <span style={pill(f.status === 'gepostet' ? G : A)}>{f.status === 'gepostet' ? T.gepostet : T.geplant}</span>
          <button type="button" onClick={() => onZu(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {zeile(T.account, <select disabled={nurLesen} value={accWert} onChange={e => { const [m, h] = e.target.value.split('|'); setF(x => ({ ...x, model_name: m, account: h })) }} style={eingabe}>
            <option value="">—</option>
            {accounts.map(a => <option key={a.model + a.handle} value={a.model + '|' + a.handle}>{a.handle} · {a.model}</option>)}
          </select>)}
          {zeile(`${T.wann} (${zoneJetzt === STANDARD ? T.de_zeit : T.zeit_von(zoneKurz(zoneJetzt))})`, <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <input disabled={nurLesen} type="datetime-local" value={zeit} onChange={e => setZeit(e.target.value)} style={eingabe} />
            {/* v5.10.0: Zeit des Accounts; zur Orientierung die deutsche Zeit bzw. die eigene */}
            {(() => {
              const iso = vonInput(zeit, zoneJetzt); if (!iso) return null
              const teile = []
              if (zoneJetzt !== STANDARD) teile.push(`= ${wochentagIn(iso, STANDARD, loc)} ${uhrIn(iso, STANDARD)} ${T.de_zeit}`)
              const g = geraeteZone()
              if (g !== zoneJetzt && g !== STANDARD) teile.push(`= ${wochentagIn(iso, g, loc)} ${uhrIn(iso, g)} ${T.deine_zeit}`)
              return teile.length ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{teile.join(' · ')}</span> : null
            })()}
          </div>)}
        </div>
        {zeile(T.titel, <input disabled={nurLesen} value={f.titel || ''} onChange={e => set('titel', e.target.value.slice(0, 120))} style={eingabe} />)}
        {/* v5.10.1: Bei Stories kommt das Material in die Frames (Foto oder Video), kein eigenes Video-Feld */}
        {(f.art === 'reel' || f.art === 'foto' || (f.video_link && f.art !== 'karussell')) && zeile(f.art === 'foto' ? T.foto : T.video, <LinkFeld value={f.video_link} onChange={v => set('video_link', v)} model={f.model_name} account={f.account} nurLesen={nurLesen} placeholder={f.art === 'foto' ? T.hoch_foto : T.hoch_video} nurFoto={f.art === 'foto'} />)}

        {/* v5.11.0: Karussell – mehrere Fotos/Videos in fester Reihenfolge (frames[].link) */}
        {f.art === 'karussell' && zeile(T.karussell, <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(f.frames || []).filter(x => x.link).length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 8 }}>
              {(f.frames || []).map((x, i) => x.link ? (
                <div key={i} style={{ background: 'var(--bg-card2)', borderRadius: 10, padding: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <b style={{ fontSize: 11, color: C }}>{i + 1}</b>
                  <VideoBild href={x.link} hoehe={96} />
                  {!nurLesen && (
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button type="button" disabled={i === 0} onClick={() => set('frames', verschieben(f.frames, i, -1))} title="nach vorne" style={pfeil}>←</button>
                      <button type="button" disabled={i === f.frames.length - 1} onClick={() => set('frames', verschieben(f.frames, i, 1))} title="nach hinten" style={pfeil}>→</button>
                      <button type="button" onClick={() => set('frames', f.frames.filter((_, j) => j !== i))} title="entfernen" style={pfeil}>✕</button>
                    </div>
                  )}
                </div>
              ) : null)}
            </div>
          )}
          {!nurLesen && (f.frames || []).length < 20 && (
            <DateiHochladen model={f.model_name} account={f.account} gesperrt={!f.model_name || !f.account} mehrere farbe={C} text={T.hoch_karussell}
              onFertig={(link) => setF(x => ({ ...x, frames: [...(x.frames || []).filter(y => y.link), { link }].slice(0, 20) }))} />
          )}
          {!nurLesen && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{T.karussell_tipp}</span>}
        </div>)}

        {f.art !== 'story' && (<>
          {zeile(T.caption, <textarea disabled={nurLesen} rows={3} value={f.caption || ''} onChange={e => set('caption', e.target.value.slice(0, 2200))} style={{ ...eingabe, resize: 'vertical' }} />,
            <KopierKnopf text={f.caption} T={T} />)}
          {f.caption_vorschlag && f.caption_vorschlag !== f.caption && (
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.35)', borderRadius: 10, padding: '7px 9px' }}>
              ✨ {T.vorschlag}: {f.caption_vorschlag} {!nurLesen && <button type="button" onClick={() => { set('caption', f.caption_vorschlag); setUebernommen(true) }} style={{ ...knopf(V, false), padding: '2px 8px', fontSize: 11 }}>{T.uebernehmen}</button>}
            </div>
          )}
          {zeile(T.hashtags, <input disabled={nurLesen} value={f.hashtags || ''} onChange={e => set('hashtags', e.target.value.slice(0, 600))} placeholder="#…" style={eingabe} />, <KopierKnopf text={f.hashtags} T={T} />)}
          {f.hashtags_vorschlag && f.hashtags_vorschlag !== f.hashtags && (
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.35)', borderRadius: 10, padding: '7px 9px' }}>
              ✨ {T.vorschlag}: {f.hashtags_vorschlag} {!nurLesen && <button type="button" onClick={() => { set('hashtags', f.hashtags_vorschlag); setUebernommen(true) }} style={{ ...knopf(V, false), padding: '2px 8px', fontSize: 11 }}>{T.uebernehmen}</button>}
            </div>
          )}
          {f.art === 'reel' && zeile(T.overlays, <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
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
                <LinkFeld value={x.link} onChange={v => set('frames', f.frames.map((y, j) => j === i ? { ...y, link: v } : y))} model={f.model_name} account={f.account} nurLesen={nurLesen} placeholder={T.hoch_datei} />
                <input disabled={nurLesen} value={x.text || ''} onChange={e => set('frames', f.frames.map((y, j) => j === i ? { ...y, text: e.target.value.slice(0, 200) } : y))} placeholder={T.frame_text} style={eingabe} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <input disabled={nurLesen} value={x.sticker || ''} onChange={e => set('frames', f.frames.map((y, j) => j === i ? { ...y, sticker: e.target.value.slice(0, 200) } : y))} placeholder={T.frame_sticker} style={eingabe} />
                  {!nurLesen && <button type="button" onClick={() => set('frames', f.frames.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>}
                </div>
              </div>
            </div>
          ))}
          {!nurLesen && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* v5.10.1: mehrere Fotos/Videos auf einmal → je ein Frame */}
              <DateiHochladen model={f.model_name} account={f.account} gesperrt={!f.model_name || !f.account} mehrere farbe={V} text={T.hoch_frames}
                onFertig={(link) => setF(x => ({ ...x, frames: [...(x.frames || []).filter(y => (y.link || y.text || y.sticker || '').trim()), { link, text: '', sticker: '' }] }))} />
              <button type="button" onClick={() => set('frames', [...(f.frames || []), { link: '', text: '', sticker: '' }])} style={{ ...knopf('var(--text-secondary)', false), padding: '4px 10px' }}>{T.frame_neu}</button>
            </div>
          )}
          {!nurLesen && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{T.story_tipp}</span>}
        </div>)}

        {zeile(T.hinweis, <input disabled={nurLesen} value={f.hinweis || ''} onChange={e => set('hinweis', e.target.value.slice(0, 300))} style={eingabe} />)}

        {/* Posten */}
        {f.id && darf && f.status !== 'gepostet' && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={klein}>{T.posten_titel}</div>
            {f.art !== 'story' && <input value={reel} onChange={e => setReel(e.target.value.slice(0, 500))} placeholder={f.art === 'reel' ? T.reel_link : T.beitrag_link} inputMode="url" autoCapitalize="none" style={eingabe} />}
            <button type="button" disabled={arbeitet} onClick={gepostet} style={{ ...knopf(G, true), color: '#04140e', padding: 10 }}>{f.art === 'reel' ? T.gepostet_knopf : f.art === 'story' ? T.story_gepostet : T.beitrag_gepostet}</button>
            {f.art === 'reel' && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{T.gemessen}</div>}
          </div>
        )}
        {f.id && darf && f.status === 'gepostet' && (
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
            ✓ {T.gepostet}{f.reel_url && <> · <a href={f.reel_url} target="_blank" rel="noreferrer" style={{ color: G, fontWeight: 700 }}>{artName(f.art, T)}</a></>}
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
        <LinkFeld value={link} onChange={setLink} model={model} material placeholder={T.hoch_datei} />
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
export function PlanModel({ displayName, isPreview = false, cardS = {}, service = null }) {
  // v5.4.0: Schalter „Model plant mit“ an → gemeinsamer Kalender
  if (service?.service_aktiv && service?.model_plant) return <PlanModelVoll displayName={displayName} isPreview={isPreview} cardS={cardS} service={service} />
  return <PlanModelLesen displayName={displayName} isPreview={isPreview} cardS={cardS} service={service} />
}

// v5.4.0: voller Kalender im Model-Portal — dieselbe Ansicht wie beim Team,
// nur mit den eigenen betreuten Instagram-Accounts aus dem Board.
function PlanModelVoll({ displayName, isPreview, cardS, service }) {
  const T = TX.de
  const [accounts, setAccounts] = useState(null)
  const [skripte, setSkripte] = useState([])
  const nb = (service?.nicht_betreut || []).join(',')
  useEffect(() => {
    if (!displayName) return
    let weg = false
    ;(async () => {
      const [b, s] = await Promise.all([
        supabase.from('model_board').select('title, content, sort_order').eq('model_name', displayName).eq('category', SOCIAL_CATEGORY).order('sort_order'),
        supabase.from('reel_skripte').select('*').eq('model_name', displayName).order('erstellt_am', { ascending: false }).limit(300),
      ])
      if (weg) return
      const aus = new Set(nb ? nb.split(',') : [])
      const acc = []
      for (const x of b.data || []) {
        if (resolvePlatform(x.title).key !== 'instagram' || !String(x.content || '').trim()) continue
        const h = instaHandle(x.content)
        if (!h || aus.has(h) || acc.some(a => a.handle === h)) continue
        acc.push({ model: displayName, handle: h, notiz: service?.account_notizen?.[h] || '', zone: service?.account_modus?.[h]?.zeitzone || null })
      }
      setAccounts(acc)
      setSkripte(s.error ? [] : (s.data || []))
    })()
    return () => { weg = true }
  }, [displayName, nb]) // eslint-disable-line react-hooks/exhaustive-deps
  if (accounts === null) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ ...cardS, padding: '12px 15px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 20 }}>📅</span>
        <div style={{ flex: 1 }}>
          <b style={{ fontSize: 14.5, color: 'var(--text-primary)' }}>{T.dein_plan}</b>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{T.dein_plan_text}</div>
        </div>
      </div>
      {accounts.length ? <SocialPlan accounts={accounts} skripte={skripte} sprache="de" darfPlanen={!isPreview} userDisplayName={displayName} />
        : <div style={{ ...cardS, padding: '12px 15px', fontSize: 12.5, color: 'var(--text-muted)' }}>Noch kein Instagram-Account in deinem Board.</div>}
    </div>
  )
}

function PlanModelLesen({ displayName, isPreview = false, cardS = {}, service = null }) {
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
              <span style={pill(artFarbe(z.art))}>{artName(z.art, T)}</span>
              <ZeitText iso={z.geplant_am} zone={service?.account_modus?.[z.account]?.zeitzone || STANDARD} />
              <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{artText(z, T)}</span>
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
