import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { sendTelegramMessage, zugestellt } from '../telegram'
import { logActivity } from '../activity'
import { resolvePlatform, SOCIAL_CATEGORY } from './SocialLinks'
import { statusVon, linkOk, mitHttps, instaHandle, cutterLaden, endVideo, seitVon, modusSetzen } from '../reelSkripte'
import { VideoLink } from './VideoLink' // v5.7.0
import SocialModelsAdmin from './SocialModelsAdmin' // v4.108.0
import { SchnittListe, FreigabeListe } from './SocialAblauf' // v4.106.0
import { macheT, spracheLaden, spracheMerken, CHIPS_EN } from '../i18n/socialManager'
import SocialSteuerung from './SocialSteuerung' // v4.103.0: nur Admins
import SocialFabs from './SocialFabs' // v5.2.0: für die Vorschau
import SocialPlan, { PlanHeute } from './SocialPlan' // v5.3.0: Posting-Plan
import { VorschauContext, useVorschau, vorschauSperre } from '../vorschau' // v5.2.0
import ReelsOhneSkript from './ReelsOhneSkript' // v4.109.0

// ── Social Media Manager (v4.102.0) ────────────────────────────────────────
// Arbeitsplatz für die Leute, die Reels posten (Rolle social_media), und für
// Admins zum Reinschauen. Ersetzt den alten Social-Tab.
//
// Drei Reiter:
//   Zu posten  — Skripte mit Video, ältestes zuerst: Material laden, auf den
//                FESTEN Ziel-Account posten, Reel-Link eintragen.
//   Überblick  — alle Skripte über alle Models mit Stand und Wartezeit.
//   Models     — was man zum Posten braucht: Accounts, No Gos, Stil, Englisch …
//
// Zweisprachig (DE/EN, oben umschaltbar, pro Gerät gemerkt). Freitext der
// Models wird bei EN über die Edge Function „uebersetzen“ übersetzt.
//
// Rechte (sql/social-manager.sql): Poster sehen nur Models im Service und nur
// No Gos / Einschränkungen / Social-Links aus dem Board, keine Preise. Setzen
// dürfen sie nur die Posting-Felder.

const P = '#ec4899', C = '#06b6d4', G = '#10b981', A = '#f59e0b', ROT = '#ef4444'
const ALT_TAGE = 5
const PROFIL_KEYS = ['stil', 'englisch', 'drehorte', 'mitspieler', 'wiedererkennung', 'staerken', 'technik', 'drehrhythmus']

const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 15px' }
const spalte = { background: 'var(--bg-card2)', borderRadius: 12, padding: '10px 11px', display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }
const klein = { fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }
const eingabe = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', width: '100%' }
const pill = (f) => ({ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: f + '22', color: f, whiteSpace: 'nowrap' })
const chip = (f) => ({ fontSize: 12, padding: '3px 9px', borderRadius: 12, background: f ? f + '24' : 'var(--bg-card2)', color: 'var(--text-primary)' })
const knopf = (f, voll) => ({ padding: '8px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', border: voll ? 'none' : `1px solid ${f}`, background: voll ? f : 'transparent', color: voll ? '#fff' : f, whiteSpace: 'nowrap' })
const linkBtn = { background: 'none', border: 'none', padding: 0, color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit' }
const heuteISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
const tageSeit = (iso) => iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : null
const wertListe = (v) => Array.isArray(v) ? v.filter(x => String(x ?? '').trim()) : (String(v ?? '').trim() ? [String(v).trim()] : [])

// v4.108.0: festerReiter — Admins bekommen die Reiter als Unterreiter in der
// oberen Leiste (Bereich „Social Media“, App.jsx); dann hier keine eigene Reiterzeile.
// v5.2.0: vorschau = { name, rollen, sprache } — zeigt die Seite so, wie diese Person sie sieht (nur ansehen)
export default function SocialManager({ userDisplayName, kannErinnern = false, istAdmin = false, festerReiter = null, darfBoard = true, vorschau = null }) {
  const [sprache, setSprache] = useState(() => vorschau ? (vorschau.sprache === 'en' ? 'en' : 'de') : spracheLaden())
  const [vorschauAuf, setVorschauAuf] = useState(null) // v5.2.0: offene Vorschau (nur im echten Admin-Fenster)
  const t = useMemo(() => macheT(sprache), [sprache])
  const loc = sprache === 'en' ? 'en-US' : 'de-DE'
  const datum = (iso) => iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString(loc, { day: '2-digit', month: '2-digit' }) : ''
  const seitText = (n) => n === null ? '' : n === 0 ? t('heute') : n === 1 ? t('gestern') : t('tage', { n })

  const [reiter, setReiter] = useState(festerReiter || (istAdmin ? 'steuerung' : 'posten'))
  useEffect(() => { if (festerReiter) setReiter(festerReiter) }, [festerReiter])
  // v4.106.0: eigene Zusatzrollen (social_media = Poster, cutter; v5.1.0: social_leitung statt social_freigabe)
  const [rollen, setRollen] = useState(vorschau ? vorschau.rollen : null)
  useEffect(() => {
    if (vorschau) return
    let weg = false
    ;(async () => {
      const { data: u } = await supabase.auth.getUser()
      if (!u?.user) { if (!weg) setRollen([]); return }
      const { data } = await supabase.from('user_roles').select('role, roles').eq('user_id', u.user.id).maybeSingle()
      if (!weg) setRollen([data?.role, ...(Array.isArray(data?.roles) ? data.roles : [])].filter(Boolean))
    })()
    return () => { weg = true }
  }, [])
  const istPoster = istAdmin || (rollen || []).includes('social_media')
  const istCutter = istAdmin || (rollen || []).includes('cutter')
  const istFreigeber = istAdmin || (rollen || []).some(r => r === 'social_freigabe' || r === 'social_leitung') // v5.1.0
  useEffect(() => {
    if (!rollen || istAdmin) return
    if (reiter === 'posten' && !istPoster) setReiter(istFreigeber ? 'freigabe' : istCutter ? 'schnitt' : 'ueberblick')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollen])
  const [daten, setDaten] = useState(null)
  const [uebers, setUebers] = useState({})
  const [uebersFehler, setUebersFehler] = useState(false)
  const [erinnert, setErinnert] = useState({})

  const laden = useCallback(async () => {
    const s = await supabase.from('model_social_service').select('model_name, service_aktiv, posting_ab, account_notizen, account_modus, nicht_betreut').eq('service_aktiv', true).order('model_name')
    if (s.error) { setDaten({ fehlt: true }); return }
    await cutterLaden() // v4.106.0: für „Im Schnitt“ vs. „Zur Freigabe“
    modusSetzen(s.data || []) // v4.108.0: „Model postet selbst“
    const namen = (s.data || []).map(x => x.model_name)
    const [sk, b, p] = await Promise.all([
      supabase.from('reel_skripte').select('*').eq('verworfen', false).order('erstellt_am', { ascending: false }).limit(500),
      namen.length ? supabase.from('model_board').select('model_name, category, title, content').in('model_name', namen).in('category', ['nogos', 'einschraenkungen', SOCIAL_CATEGORY]).order('sort_order') : Promise.resolve({ data: [] }),
      namen.length ? supabase.from('model_social_profil').select('model_name, schluessel, antwort').in('model_name', namen).in('schluessel', PROFIL_KEYS) : Promise.resolve({ data: [] }),
    ])
    if (sk.error) { setDaten({ fehlt: true }); return }
    const models = {}
    for (const m of s.data || []) models[m.model_name] = { ...m, nogos: [], einschraenkungen: [], instagram: [], profil: {} }
    for (const z of b.data || []) {
      const m = models[z.model_name]; if (!m) continue
      if (z.category === 'nogos') m.nogos.push(z.title)
      else if (z.category === 'einschraenkungen') m.einschraenkungen.push([z.title, z.content].filter(Boolean).join(': '))
      else if (resolvePlatform(z.title).key === 'instagram' && String(z.content || '').trim()) {
        const h = instaHandle(z.content)
        if (!m.instagram.some(x => x.handle === h)) m.instagram.push({ handle: h, url: mitHttps(z.content) })
      }
    }
    for (const z of p.data || []) if (models[z.model_name]) models[z.model_name].profil[z.schluessel] = z.antwort
    let skripte = sk.data || []
    if (vorschau && !(vorschau.rollen || []).some(r => r === 'social_leitung' || r === 'social_freigabe')) {
      // v5.2.0: wie RLS für diese Person — nur zugeteilte Accounts (Poster- bzw. Cutter-Spalte)
      const [zp, zc] = await Promise.all([
        (vorschau.rollen || []).includes('social_media') ? supabase.from('social_account_poster').select('model_name, account').eq('poster_name', vorschau.name) : Promise.resolve({ data: [] }),
        (vorschau.rollen || []).includes('cutter') ? supabase.from('social_account_cutter').select('model_name, account').eq('cutter_name', vorschau.name) : Promise.resolve({ data: [] }),
      ])
      const z = [...(zp.data || []), ...(zc.data || [])]
      const hat = (m, a) => z.some(x => x.model_name === m && x.account === a)
      skripte = skripte.filter(s => hat(s.model_name, s.ziel_account))
      for (const name of Object.keys(models)) {
        if (!z.some(x => x.model_name === name)) { delete models[name]; continue }
        models[name].instagram = models[name].instagram.filter(a => hat(name, a.handle))
      }
    }
    setDaten({ fehlt: false, models, skripte })
  }, [vorschau])
  useEffect(() => { laden() }, [laden])

  // ── Übersetzen (nur EN) ──
  const tr = (text) => {
    const s = String(text ?? '')
    if (sprache !== 'en' || !s.trim()) return s
    return CHIPS_EN[s] || uebers[s] || s
  }
  useEffect(() => {
    if (sprache !== 'en' || !daten || daten.fehlt) return
    const texte = new Set()
    for (const m of Object.values(daten.models)) {
      m.nogos.forEach(x => texte.add(x)); m.einschraenkungen.forEach(x => texte.add(x))
      for (const k of PROFIL_KEYS) if (k !== 'englisch') wertListe(m.profil[k]).forEach(x => texte.add(x))
      Object.values(m.account_notizen || {}).forEach(x => texte.add(x))
    }
    daten.skripte.forEach(s => texte.add(s.titel))
    const offen = [...texte].filter(x => x && !CHIPS_EN[x] && !uebers[x])
    if (!offen.length) return
    let abbruch = false
    ;(async () => {
      const neu = {}
      let fehler = false
      for (let i = 0; i < offen.length; i += 80) {
        const { data, error } = await supabase.functions.invoke('uebersetzen', { body: { sprache: 'en', texte: offen.slice(i, i + 80) } })
        if (error || !data?.ok) { fehler = true; continue }
        Object.assign(neu, data.uebersetzungen || {})
        if (data.fehler) fehler = true
      }
      if (abbruch) return
      setUebers(u => ({ ...u, ...neu }))
      setUebersFehler(fehler)
    })()
    return () => { abbruch = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprache, daten])

  const umschalten = (s) => { setSprache(s); if (!vorschau) spracheMerken(s) } // Vorschau: Gerät nicht umstellen

  if (!daten) return <div style={{ color: 'var(--text-muted)', padding: 20 }}>{t('laedt')}</div>
  if (daten.fehlt) return <div style={{ ...card, color: 'var(--text-muted)', fontSize: 13 }}>{t('tabelle_fehlt')}</div>

  const { models, skripte } = daten
  const imService = (s) => !!models[s.model_name]
  const zuPosten = skripte.filter(s => imService(s) && statusVon(s) === 'bereit').sort((a, b) => String(a.freigabe_am).localeCompare(String(b.freigabe_am)))
  const zuSchneiden = skripte.filter(s => imService(s) && statusVon(s) === 'schnitt')
  const zurFreigabe = skripte.filter(s => imService(s) && statusVon(s) === 'pruefung')
  const fehlt = skripte.filter(s => imService(s) && statusVon(s) === 'freigegeben')
  const alt = fehlt.filter(s => tageSeit(s.erstellt_am) > ALT_TAGE)
  const woche = skripte.filter(s => s.gepostet_am && tageSeit(s.gepostet_am + 'T12:00:00') <= 7)
  const notiz = (m, h) => tr(m?.account_notizen?.[h] || '')
  // v5.3.0: Accounts für den Plan (Poster/Vorschau: schon auf die eigenen gefiltert)
  const planAccounts = Object.values(models).flatMap(m => m.instagram.filter(a => !(m.nicht_betreut || []).includes(a.handle)).map(a => ({ model: m.model_name, handle: a.handle, notiz: m.account_notizen?.[a.handle] || '', zone: m.account_modus?.[a.handle]?.zeitzone || null })))

  const erinnere = async (s) => {
    const { data: m } = await supabase.from('models_contact').select('telegram_id').eq('name', s.model_name).maybeSingle()
    if (!m?.telegram_id) { setErinnert(e => ({ ...e, [s.id]: t('erinnern_ohne_tg') })); return }
    const text = t('erinnern_text', { name: s.model_name, nr: s.nr, titel: s.titel })
    try {
      const r = await sendTelegramMessage(m.telegram_id, text)
      const ok = zugestellt(r)
      await supabase.from('messages').insert({ model_name: s.model_name, model_telegram_id: m.telegram_id, direction: 'out', contact_type: 'model', message_type: 'announcement', text, status: ok ? 'sent' : 'failed', sent_by: userDisplayName })
      setErinnert(e => ({ ...e, [s.id]: ok ? t('erinnert') : t('erinnern_fehler') }))
    } catch { setErinnert(e => ({ ...e, [s.id]: t('erinnern_fehler') })) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: istAdmin ? 0 : 150 /* v5.0.0: Platz für Chat/Glocke/Hilfe unten rechts */ }}>
      {/* Kopf + Sprache */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: P }}>📱 {t('titel')}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginTop: 2 }}>{t('hallo', { name: userDisplayName || '' })}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{t('zusammenfassung', { posten: zuPosten.length, fehlt: fehlt.length, alt: alt.length, tage: ALT_TAGE })}</div>
        </div>
        <div role="group" aria-label="Sprache / Language" style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          {['de', 'en'].map(s => (
            <button key={s} type="button" onClick={() => umschalten(s)} aria-pressed={sprache === s}
              style={{ padding: '7px 12px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 800, background: sprache === s ? P : 'transparent', color: sprache === s ? '#fff' : 'var(--text-secondary)' }}>
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      {sprache === 'en' && uebersFehler && <div style={{ fontSize: 12, color: A }}>{t('uebersetzung_fehlt')}</div>}

      {/* Reiter */}
      {!festerReiter && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[
          ...(istAdmin ? [{ k: 'steuerung', l: '🧭 ' + t('tab_steuerung') }] : []),
          ...(istFreigeber ? [{ k: 'freigabe', l: '👀 ' + t('tab_freigabe'), z: zurFreigabe.length }] : []),
          ...(istCutter ? [{ k: 'schnitt', l: '✂️ ' + t('tab_schnitt'), z: zuSchneiden.length }] : []),
          ...(istPoster ? [{ k: 'posten', l: '🎬 ' + t('tab_posten'), z: zuPosten.length }] : []),
          ...((istPoster || istAdmin) ? [{ k: 'plan', l: '📅 ' + t('tab_plan') }] : []), // v5.3.0
          { k: 'ueberblick', l: '📋 ' + t('tab_ueberblick') },
          { k: 'models', l: '👤 ' + t('tab_models') },
        ].map(x => (
          <button key={x.k} type="button" onClick={() => setReiter(x.k)}
            style={{ padding: '8px 14px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 13, background: reiter === x.k ? P : 'transparent', color: reiter === x.k ? '#fff' : 'var(--text-secondary)', border: `1px solid ${reiter === x.k ? P : 'var(--border)'}` }}>
            {x.l}{x.z > 0 && <span style={{ marginLeft: 6, background: A, color: '#1a1205', fontSize: 10.5, fontWeight: 800, padding: '1px 7px', borderRadius: 10 }}>{x.z}</span>}
          </button>
        ))}
      </div>}

      {reiter === 'steuerung' && istAdmin && <SocialSteuerung userDisplayName={userDisplayName} darfBoard={darfBoard} onVorschau={vorschau ? null : setVorschauAuf} />}
      {reiter === 'wirkung' && istAdmin && <SocialSteuerung userDisplayName={userDisplayName} ansicht="wirkung" />}
      {reiter === 'models-admin' && istAdmin && <SocialModelsAdmin userDisplayName={userDisplayName} />}

      {reiter === 'freigabe' && istFreigeber && <FreigabeListe skripte={skripte.filter(imService)} t={t} tr={tr} datum={datum} seitText={seitText} userDisplayName={userDisplayName} onNeu={laden} />}
      {reiter === 'schnitt' && istCutter && <SchnittListe skripte={skripte.filter(imService)} t={t} tr={tr} datum={datum} seitText={seitText} userDisplayName={userDisplayName} onNeu={laden} />}

      {/* v5.3.0: Posting-Plan */}
      {reiter === 'plan' && <SocialPlan accounts={planAccounts} skripte={skripte.filter(imService)} sprache={sprache} darfPlanen={istAdmin} darfPosten={istPoster} userDisplayName={userDisplayName} />}

      {reiter === 'posten' && (
        <>
          {istPoster && <PlanHeute accounts={planAccounts} sprache={sprache} userDisplayName={userDisplayName} darfPlanen={istAdmin} />}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {[[zuPosten.length, C, 'kpi_posten'], [fehlt.length, A, 'kpi_fehlt'], [woche.length, G, 'kpi_woche']].map(([n, f, k]) => (
              <div key={k} style={{ ...card, padding: '12px 14px' }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: f }}>{n}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t(k)}</div>
              </div>
            ))}
          </div>
          {!zuPosten.length && <div style={{ ...card, color: 'var(--text-muted)', fontSize: 13.5 }}>{t('nichts_zu_posten')}</div>}
          {zuPosten.map(s => <PostenKarte key={s.id + ':' + s.aktualisiert_am} s={s} m={models[s.model_name]} t={t} tr={tr} datum={datum} seitText={seitText} notiz={notiz} userDisplayName={userDisplayName} onNeu={laden} />)}
          {/* v4.109.0: Reels ohne Skript — Poster sehen hier nur ihre eigenen Accounts (RLS) */}
          <ReelsOhneSkript t={t} sprache={sprache} userDisplayName={userDisplayName} istAdmin={istAdmin}
            accounts={Object.values(models).flatMap(m => m.instagram.filter(a => !(m.nicht_betreut || []).includes(a.handle)).map(a => ({ model: m.model_name, handle: a.handle, notiz: notiz(m, a.handle) })))} />
        </>
      )}

      {/* v5.0.0: Überblick am Handy als Karten statt breiter Tabelle */}
      {reiter === 'ueberblick' && (
        <>
        <style>{`.ueb-karten { display: none; } @media (max-width: 640px) { .ueb-tabelle { display: none; } .ueb-karten { display: flex; } }`}</style>
        <div className="ueb-karten" style={{ flexDirection: 'column', gap: 8 }}>
          {[...skripte].filter(imService).sort((a, b) => {
            const o = { bereit: 0, pruefung: 1, schnitt: 2, freigegeben: 3, gepostet: 4 }
            return (o[statusVon(a)] - o[statusVon(b)]) || String(b.erstellt_am).localeCompare(String(a.erstellt_am))
          }).map(s => {
            const st = statusVon(s)
            const f = { bereit: C, pruefung: '#f97316', schnitt: '#a855f7', gepostet: G }[st] || A
            const seit = st === 'gepostet' ? null : tageSeit(seitVon(s))
            const zuAlt = st === 'freigegeben' && seit > ALT_TAGE
            return (
              <div key={s.id} style={{ ...card, padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 5, opacity: st === 'gepostet' ? 0.65 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 800, color: C, fontSize: 12.5 }}>{s.nr}</span>
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 700, color: 'var(--text-primary)', fontSize: 13.5 }}>{tr(s.titel)}</span>
                  <span style={pill(zuAlt ? ROT : f)}>{t('st_' + st)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{s.model_name}</span>
                  <span style={{ color: P, fontWeight: 700 }}>{s.account || s.ziel_account || '—'}</span>
                  <span style={{ marginLeft: 'auto', color: zuAlt ? ROT : 'var(--text-muted)', fontWeight: zuAlt ? 800 : 400 }}>{st === 'gepostet' ? datum(s.gepostet_am) : seitText(seit)}</span>
                  {st === 'bereit' && istPoster && <button type="button" style={{ ...linkBtn, color: C, fontWeight: 700, fontSize: 12.5, textDecoration: 'none' }} onClick={() => setReiter('posten')}>{t('posten')}</button>}
                  {st === 'gepostet' && s.reel_url && <a href={s.reel_url} target="_blank" rel="noreferrer" style={{ color: G, fontWeight: 700 }}>{t('reel')}</a>}
                </div>
              </div>
            )
          })}
        </div>
        <div className="ueb-tabelle" style={{ ...card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>{['sp_nr', 'sp_model', 'sp_ziel', 'sp_titel', 'sp_stand', 'sp_seit', ''].map((k, i) => <th key={i} style={{ ...klein, textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>{k ? t(k) : ''}</th>)}</tr>
            </thead>
            <tbody>
              {[...skripte].filter(imService).sort((a, b) => {
                const o = { bereit: 0, pruefung: 1, schnitt: 2, freigegeben: 3, gepostet: 4 }
                return (o[statusVon(a)] - o[statusVon(b)]) || String(b.erstellt_am).localeCompare(String(a.erstellt_am))
              }).map(s => {
                const st = statusVon(s)
                const f = { bereit: C, pruefung: '#f97316', schnitt: '#a855f7', gepostet: G }[st] || A
                const seit = st === 'gepostet' ? null : tageSeit(seitVon(s))
                const zuAlt = st === 'freigegeben' && seit > ALT_TAGE
                const td = { padding: '9px 8px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
                return (
                  <tr key={s.id} style={{ opacity: st === 'gepostet' ? 0.6 : 1 }}>
                    <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontWeight: 800, color: C }}>{s.nr}</td>
                    <td style={td}>{s.model_name}</td>
                    <td style={{ ...td, color: P, fontWeight: 700 }}>{s.account || s.ziel_account || '—'}</td>
                    <td style={td}>{tr(s.titel)}</td>
                    <td style={td}><span style={pill(zuAlt ? ROT : f)}>{t('st_' + st)}</span></td>
                    <td style={{ ...td, color: zuAlt ? ROT : 'var(--text-secondary)', fontWeight: zuAlt ? 800 : 400 }}>{st === 'gepostet' ? datum(s.gepostet_am) : seitText(seit)}</td>
                    <td style={td}>
                      {st === 'bereit' && istPoster && <button type="button" style={{ ...linkBtn, color: C, fontWeight: 700, fontSize: 12.5, textDecoration: 'none' }} onClick={() => setReiter('posten')}>{t('posten')}</button>}
                      {st === 'gepostet' && <a href={s.reel_url} target="_blank" rel="noreferrer" style={{ color: G, fontWeight: 700 }}>{t('reel')}</a>}
                      {st === 'freigegeben' && kannErinnern && (erinnert[s.id]
                        ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{erinnert[s.id]}</span>
                        : <button type="button" style={{ ...linkBtn, color: zuAlt ? ROT : C, fontWeight: 700, fontSize: 12.5, textDecoration: 'none' }} onClick={() => erinnere(s)}>{t('erinnern')}</button>)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8 }}>{t('rot_hinweis', { tage: ALT_TAGE })}{kannErinnern ? t('rot_hinweis_erinnern') : ''}</div>
        </div>
        </>
      )}

      {reiter === 'models' && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('models_hinweis')}</div>
          {!Object.keys(models).length && <div style={{ ...card, color: 'var(--text-muted)' }}>{t('keine_models')}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
            {Object.values(models).map(m => {
              const eig = skripte.filter(s => s.model_name === m.model_name)
              const z = (st) => eig.filter(s => statusVon(s) === st).length
              const zeile = (label, inhalt) => (
                <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8, fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ color: 'var(--text-muted)' }}>{label}</div><div style={{ color: 'var(--text-primary)', minWidth: 0 }}>{inhalt}</div>
                </div>
              )
              const text = (k) => wertListe(m.profil[k]).map(tr).join(', ') || '—'
              return (
                <div key={m.model_name} style={card}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', flex: 1 }}>{m.model_name}</span>
                    <span style={pill(G)}>{m.posting_ab ? t('im_service_seit', { datum: datum(m.posting_ab) }) : t('im_service')}</span>
                  </div>
                  {zeile(t('instagram'), m.instagram.length ? m.instagram.map(a => (
                    <div key={a.handle}><a href={a.url} target="_blank" rel="noreferrer" style={{ color: P, fontWeight: 700 }}>{a.handle}</a>{notiz(m, a.handle) && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}> · {notiz(m, a.handle)}</span>}</div>
                  )) : '—')}
                  {zeile(t('nogos'), m.nogos.length ? <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{m.nogos.map((x, i) => <span key={i} style={chip(ROT)}>{tr(x)}</span>)}</span> : t('keine_nogos'))}
                  {m.einschraenkungen.length > 0 && zeile(t('einschraenkungen'), <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{m.einschraenkungen.map((x, i) => <span key={i} style={chip(C)}>{tr(x)}</span>)}</span>)}
                  {zeile(t('stil'), text('stil'))}
                  {zeile(t('englisch'), m.profil.englisch ? `${m.profil.englisch} / 5` : '—')}
                  {zeile(t('drehorte'), text('drehorte'))}
                  {zeile(t('mitspieler'), text('mitspieler'))}
                  {wertListe(m.profil.wiedererkennung).length > 0 && zeile(t('wiedererkennung'), text('wiedererkennung'))}
                  {wertListe(m.profil.staerken).length > 0 && zeile(t('staerken'), text('staerken'))}
                  {zeile(t('reels'), <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {z('bereit') > 0 && <span style={pill(C)}>{t('n_posten', { n: z('bereit') })}</span>}
                    {(z('schnitt') + z('pruefung')) > 0 && <span style={pill('#a855f7')}>{t('st_schnitt')}/{t('st_pruefung')}: {z('schnitt') + z('pruefung')}</span>}
                    {z('freigegeben') > 0 && <span style={pill(A)}>{t('n_fehlt', { n: z('freigegeben') })}</span>}
                    {z('gepostet') > 0 && <span style={pill(G)}>{t('n_gepostet', { n: z('gepostet') })}</span>}
                    {!eig.length && '—'}
                  </span>)}
                </div>
              )
            })}
          </div>
        </>
      )}
      {sprache === 'en' && Object.keys(uebers).length > 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>ⓘ {t('uebersetzt')}</div>}
      {/* v5.2.0: Vorschau „als Person ansehen“ (v5.3.0: eigene Komponente, auch aus der Kopfzeile aufrufbar) */}
      {vorschauAuf && <SocialVorschauFenster v={vorschauAuf} onZu={() => setVorschauAuf(null)} />}
    </div>
  )
}

// v5.2.0/v5.3.0: Vollbild-Vorschau einer Social-Person (nur ansehen).
// Aufruf aus Steuerung → Team („👁 Ansicht“) und aus der Kopfzeile („👁 Ansicht ▾“).
export function SocialVorschauFenster({ v, onZu }) {
  return (
<div style={{ position: 'fixed', inset: 0, zIndex: 100050, background: 'var(--bg-base)', overflowY: 'auto' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 16px', background: '#f59e0b', color: '#1a1205', fontSize: 13.5, fontWeight: 700 }}>
          <span style={{ flex: 1, minWidth: 200 }}>👁 Vorschau als {v.name} · {(v.rollen || []).map(r => ({ social_media: 'Poster', cutter: 'Cutter', social_leitung: 'Social-Leitung', chatter: 'Chatter' }[r] || r)).join(' + ')} · {v.sprache === 'en' ? 'Englisch' : 'Deutsch'} · nur ansehen</span>
          <button type="button" onClick={onZu} style={{ padding: '6px 14px', borderRadius: 9, border: 'none', background: '#1a1205', color: '#fff', fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>Beenden</button>
        </div>
        <VorschauContext.Provider value={true}>
          <div style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>
            <SocialManager key={v.name} userDisplayName={v.name} vorschau={v} />
          </div>
          {!(v.rollen || []).includes('chatter') && <SocialFabs displayName={v.name} rollen={v.rollen} spracheFest={v.sprache === 'en' ? 'en' : 'de'} />}
        </VorschauContext.Provider>
      </div>
  )
}

function PostenKarte({ s, m, t, tr, datum, seitText, notiz, userDisplayName, onNeu }) {
  const vorschau = useVorschau()
  const ziel = s.ziel_account || ''
  const [reel, setReel] = useState('')
  const [datumWert, setDatumWert] = useState(heuteISO())
  const [account, setAccount] = useState(ziel)
  const [anders, setAnders] = useState(!ziel)
  const [fehler, setFehler] = useState('')
  const [arbeitet, setArbeitet] = useState(false)
  const accounts = (m?.instagram || []).map(a => a.handle)

  const posten = async () => {
    if (vorschau) return vorschauSperre()
    const r = mitHttps(reel)
    if (!linkOk(r) || !/instagram\.com\//i.test(r)) { setFehler(t('fehler_reel')); return }
    if (!account) { setFehler(t('fehler_account')); return }
    setArbeitet(true); setFehler('')
    const { error } = await supabase.from('reel_skripte').update({ reel_url: r, account, gepostet_am: datumWert || heuteISO(), gepostet_von: userDisplayName || null }).eq('id', s.id)
    setArbeitet(false)
    if (error) { setFehler(t('nicht_gespeichert', { fehler: error.message })); return }
    logActivity('reel.skript', { entity: `${s.model_name} ${s.nr}`, detail: `gepostet auf ${account}${ziel && account !== ziel ? ` (Ziel war ${ziel})` : ''}` })
    onNeu()
  }

  const nogos = m?.nogos || []
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 800, color: C, fontSize: 12.5 }}>{s.nr}</span>
        <span style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--text-primary)', flex: 1, minWidth: 140 }}>{tr(s.titel)}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: P, background: 'rgba(236,72,153,0.12)', padding: '2px 9px', borderRadius: 10 }}>{s.model_name}{ziel ? ` → ${ziel}` : ''}</span>
        <span style={pill(C)}>{t('video_da_seit', { seit: seitText(tageSeit(seitVon(s))) })}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
        <div style={spalte}>
          <span style={klein}>{t('sp_material')}</span>
          {s.drehzettel_url && <a href={s.drehzettel_url} target="_blank" rel="noreferrer" style={{ color: C, fontWeight: 700, fontSize: 13 }}>{t('drehzettel')}</a>}
          <VideoLink href={endVideo(s)} laden bild style={{ color: C, fontWeight: 700, fontSize: 13 }}>{t('video_laden')}</VideoLink>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{s.schnitt_link ? t('geschnitten_von', { wer: s.schnitt_von || '—', datum: datum(s.schnitt_am) }) : t('hochgeladen', { wer: s.video_von || s.model_name, datum: datum(s.video_am) })}</span>
        </div>
        <div style={spalte}>
          <span style={klein}>{t('sp_achten')}</span>
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {nogos.length ? nogos.map((x, i) => <span key={i} style={chip(ROT)}>{tr(x)}</span>) : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('nogos')}: {t('keine_nogos')}</span>}
            {(m?.einschraenkungen || []).map((x, i) => <span key={'e' + i} style={chip(C)}>{tr(x)}</span>)}
            {m?.profil?.englisch && <span style={chip(C)}>{t('englisch')} {m.profil.englisch}/5</span>}
          </span>
          {wertListe(m?.profil?.stil).length > 0 && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{t('stil')}: {wertListe(m.profil.stil).map(tr).join(', ')}</span>}
        </div>
        <div style={spalte}>
          <span style={klein}>{t('sp_posten')}</span>
          {ziel && !anders ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(236,72,153,0.1)', border: '1px solid rgba(236,72,153,0.45)', borderRadius: 11, padding: '8px 10px', flexWrap: 'wrap' }}>
              📌 <b style={{ color: P, fontSize: 14.5 }}>{ziel}</b>
              {notiz(m, ziel) && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{notiz(m, ziel)}</span>}
            </div>
          ) : (
            <>
              {!ziel && <span style={{ fontSize: 11.5, color: A }}>{t('kein_ziel')}</span>}
              <select value={account} onChange={e => setAccount(e.target.value)} style={eingabe}>
                <option value="">—</option>
                {accounts.map(a => <option key={a} value={a}>{a}</option>)}
                {ziel && !accounts.includes(ziel) && <option value={ziel}>{ziel}</option>}
              </select>
              {ziel && account && account !== ziel && <span style={{ fontSize: 11.5, color: A }}>{t('abweichend', { ziel })}</span>}
            </>
          )}
          <input value={reel} onChange={e => setReel(e.target.value.slice(0, 500))} placeholder={t('reel_link')} style={eingabe} autoCapitalize="none" autoCorrect="off" inputMode="url" />
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="date" value={datumWert} onChange={e => setDatumWert(e.target.value)} style={{ ...eingabe, flex: 1 }} />
            <button type="button" disabled={arbeitet} onClick={posten} style={{ ...knopf(G, true), color: '#04140e' }}>{arbeitet ? t('speichert') : t('gepostet_knopf')}</button>
          </div>
          {ziel && !anders && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{t('anderer_account')} <button type="button" style={linkBtn} onClick={() => setAnders(true)}>{t('account_aendern')}</button></span>}
          {fehler && <span role="alert" style={{ fontSize: 12, color: ROT }}>{fehler}</span>}
        </div>
      </div>
    </div>
  )
}
