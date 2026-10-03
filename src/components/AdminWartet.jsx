import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase, FUNCTIONS_URL } from '../supabase'
import { heuteBerlin } from '../utils'
import { ROLES } from '../rollen'
import { frageBeantworten } from '../ofSkripte'
import {
  Zap, KeyRound, Ban, UserPlus, PenLine, MessageCircleQuestion, RefreshCw, TreePalm,
  MessageSquareText, AlarmClock, ChartColumn, Check, CheckCheck, ThumbsUp, BellOff, Bell, X,
} from 'lucide-react'

// ── Wartet auf euch (v5.36.0) ────────────────────────────────────────────
// Pop-up nur für Admins: Dinge, bei denen jemand auf euch WARTET und die sonst
// in langen Seiten untergehen (Passwort-Anfrage, gesperrtes Konto, Skript-
// Freigabe …). Wie das Schichttausch-Pop-up bei den Chattern:
//   • springt beim Öffnen auf und sobald etwas Neues dazukommt
//   • „Später“ = eine Stunde Ruhe (Neues holt es trotzdem wieder hoch)
//   • ein Eintrag verschwindet erst, wenn die Sache erledigt ist — bei allen
//     Admins gleichzeitig, weil alles direkt aus den Daten kommt
//   • oben in der Kopfzeile „Wartet N“, solange etwas offen ist
// v5.36.1: „Nicht mehr erinnern“ pro Eintrag (bleibt aus, bis die Sache weg ist
//   oder sich ändert, z. B. jemand will die Schicht doch übernehmen) · Lucide-
//   Symbole statt Emojis · „ausgeschrieben vor …“ statt „seit …“
// v5.36.2: „Gelesen“ pro Eintrag + „Alle gelesen“ unten: ab acta, kein
//   stündliches Erinnern mehr. Nur NEUE Sachen holen das Pop-up wieder hoch.
//   Der Knopf oben bleibt (gedämpft), damit man Gelesenes wiederfindet.
// Normale Nachrichten, Board, was andere Admins tun → bleibt in den Glocken.

const SPEICHER = 'admin_wartet_v1'
const AUS = 'admin_wartet_aus_v1'   // Einträge mit „Nicht mehr erinnern“ (pro Gerät)
const RUHE_MS = 60 * 60 * 1000
const TAKT_MS = 60 * 1000

const lies = () => { try { return JSON.parse(localStorage.getItem(SPEICHER) || '{}') || {} } catch { return {} } }
const schreib = (v) => { try { localStorage.setItem(SPEICHER, JSON.stringify(v)) } catch { /* egal */ } }

const plusTage = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const tagText = (iso) => { try { return new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) } catch { return iso } }
const alter = (ts) => {
  const min = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000))
  if (min < 60) return `${min || 1} Min.`
  const h = Math.round(min / 60)
  if (h < 48) return `${h} Std.`
  return `${Math.round(h / 24)} Tagen`
}
const zeitText = (e) => !e.zeit ? '' : e.zeitWort ? `${e.zeitWort} vor ${alter(e.zeit)}` : `seit ${alter(e.zeit)}`
const liesAus = () => { try { return new Set(JSON.parse(localStorage.getItem(AUS) || '[]')) } catch { return new Set() } }
const schreibAus = (set) => { try { localStorage.setItem(AUS, JSON.stringify([...set])) } catch { /* egal */ } }

// Lucide-Symbol je Art (statt Emoji)
const SYMBOL = {
  pw: KeyRound, ban: Ban, rolle: UserPlus, skripte: PenLine, frage: MessageCircleQuestion,
  swap: RefreshCw, abs: TreePalm, cr: MessageSquareText, crx: AlarmClock, csv: ChartColumn,
}
const kurz = (t, n = 70) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
const berlinStunde = () => Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }))

// Bis wann eine Custom-Anfrage fertig sein sollte (Tag, ab dem sie überfällig ist)
const anfrageFrist = (r) => {
  const tag = String(r.created_at || '').slice(0, 10)
  if (!tag) return null
  if (r.deadline === 'custom') return r.deadline_date ? plusTage(r.deadline_date, 1) : null
  const n = { asap: 1, hours: 1, days: 3, week: 8, nextweek: 15 }[r.deadline]
  return n ? plusTage(tag, n) : null
}

const ROLLEN_WAHL = ROLES.filter(r => !r.alt && !['admin', 'manager'].includes(r.key))

async function funktion(name, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const resp = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify(body),
  })
  const data = await resp.json().catch(() => ({}))
  return data?.ok ? data : { ok: false, error: data?.error || `HTTP ${resp.status}` }
}

const FARBE = { 1: '#ef4444', 2: '#f59e0b', 3: '#94a3b8' }

export default function AdminWartet({ onNavigate, daten }) {
  const [roh, setRoh] = useState(null)
  const [offen, setOffen] = useState(false)
  const [busy, setBusy] = useState(null)
  const [hinweis, setHinweis] = useState({})       // key → Text (Ergebnis/Fehler)
  const [eingabe, setEingabe] = useState({})       // key → { name, rolle, antwort }
  const [codes, setCodes] = useState([])          // freigegebene Passwort-Codes zum Weitergeben

  const lade = useCallback(async () => {
    const heute = heuteBerlin()
    const sicher = (p) => p.then(r => (r?.error ? [] : (r?.data || []))).catch(() => [])
    const [pw, konten, sk, swaps, abs, cr] = await Promise.all([
      sicher(supabase.from('password_resets').select('id,email,display_name,requested_at,status').eq('status', 'angefragt')),
      sicher(supabase.rpc('admin_konten_pruefen')),
      sicher(supabase.from('of_skripte').select('id,model_name,titel,erstellt_von,aktualisiert_am,status,model_frage').in('status', ['freigabe', 'beim_model'])),
      sicher(supabase.from('shift_swaps').select('*').eq('status', 'offen').gte('shift_date', heute).lte('shift_date', plusTage(heute, 2))),
      sicher(supabase.from('absences').select('id,chatter_name,date_from,date_to,reason,created_at').eq('source', 'chatter').eq('seen_by_admin', false).gte('date_to', heute)),
      sicher(supabase.from('content_requests').select('id,model_name,chatter_name,request_text,edited_text,status,deadline,deadline_date,created_at').in('status', ['neu', 'angefragt', 'bestaetigt'])),
    ])
    const ids = swaps.map(s => s.id)
    const reaktionen = ids.length ? await sicher(supabase.from('swap_reactions').select('swap_id,chatter_name,reaction').in('swap_id', ids)) : []
    setRoh({ heute, pw, konten, sk, swaps, reaktionen, abs, cr })
  }, [])

  useEffect(() => {
    lade()
    const t = setInterval(() => { if (document.visibilityState === 'visible') lade() }, TAKT_MS)
    const sichtbar = () => { if (document.visibilityState === 'visible') lade() }
    document.addEventListener('visibilitychange', sichtbar)
    window.addEventListener('focus', sichtbar)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', sichtbar); window.removeEventListener('focus', sichtbar) }
  }, [lade])

  // ── Einträge bauen ────────────────────────────────────────────────────────
  const alle = useMemo(() => {
    if (!roh) return []
    const liste = []
    const { heute } = roh

    for (const r of roh.pw) liste.push({
      key: 'pw-' + r.id, prio: 1, zeit: r.requested_at, art: 'pw', daten: r,
      titel: `${r.display_name || r.email} will ein neues Passwort`,
      text: 'Kann sich bis zur Freigabe nicht einloggen.',
    })
    for (const k of roh.konten) {
      if (k.art === 'gesperrt') liste.push({
        key: 'ban-' + k.user_id, prio: 1, zeit: null, art: 'ban', daten: k,
        titel: `${k.name || k.email} ist aktiv, aber gesperrt`,
        text: 'Status „aktiv“, der Login ist aber blockiert — kommt nicht rein.',
      })
      else if (k.art === 'ohne_rolle') liste.push({
        key: 'rolle-' + k.user_id, prio: 1, zeit: k.seit, art: 'rolle', daten: k,
        titel: `${k.email} hat noch keine Rolle`,
        text: 'Hat ein Konto, sieht aber nur „nicht eingerichtet“.',
      })
    }

    const freigabe = roh.sk.filter(s => s.status === 'freigabe')
    if (freigabe.length) {
      const aeltestes = freigabe.reduce((a, b) => (a.aktualisiert_am < b.aktualisiert_am ? a : b))
      liste.push({
        key: 'sk-' + freigabe.map(s => s.id).sort().join('.'), prio: 2, zeit: aeltestes.aktualisiert_am, art: 'skripte',
        titel: freigabe.length === 1 ? '1 Skript wartet auf Freigabe' : `${freigabe.length} Skripte warten auf Freigabe`,
        text: freigabe.slice(0, 3).map(s => `${s.model_name} „${kurz(s.titel, 30)}“${s.erstellt_von ? ' · ' + s.erstellt_von : ''}`).join(', ') + (freigabe.length > 3 ? ' …' : ''),
      })
    }
    for (const s of roh.sk.filter(x => x.status === 'beim_model' && x.model_frage)) liste.push({
      key: 'frage-' + s.id + '-' + kurz(s.model_frage, 20), prio: 2, zeit: s.aktualisiert_am, art: 'frage', daten: s,
      titel: `${s.model_name} hat eine Frage zum Skript`,
      text: `„${kurz(s.titel, 40)}“: ${kurz(s.model_frage, 160)}`,
    })

    // Schichten: Blöcke als eine Einheit
    const einheiten = new Map()
    for (const s of roh.swaps) {
      const k = s.block_id || 'id:' + s.id
      if (!einheiten.has(k)) einheiten.set(k, [])
      einheiten.get(k).push(s)
    }
    for (const [k, rows] of einheiten) {
      const ids = new Set(rows.map(r => r.id))
      const wollen = [...new Set(roh.reaktionen.filter(r => ids.has(r.swap_id) && r.reaction === 'uebernehmen').map(r => r.chatter_name))]
      const s = rows[0]
      const models = [...new Set(rows.map(r => r.model_name).filter(Boolean))].join(', ')
      const wann = `${s.shift_date === heute ? 'Heute' : tagText(s.shift_date)} · ${s.shift}`
      const von = s.requester_name ? `${s.requester_name} hat abgegeben` : 'von euch ausgeschrieben'
      const zeitWort = s.requester_name ? 'abgegeben' : 'ausgeschrieben'
      if (wollen.length) liste.push({
        key: 'swap-' + k + '-' + wollen.join('.'), prio: 2, zeit: s.created_at, zeitWort, art: 'swap',
        titel: `${wollen.join(', ')} ${wollen.length === 1 ? 'will' : 'wollen'} ${wann} übernehmen`,
        text: `${models} · ${von}. Bitte vergeben.`,
      })
      else liste.push({
        key: 'swap-' + k, prio: 2, zeit: s.created_at, zeitWort, art: 'swap',
        titel: `${wann} hat noch niemanden`,
        text: `${models} · ${von}, keiner hat sich gemeldet.`,
      })
    }

    if (roh.abs.length) liste.push({
      key: 'abs-' + roh.abs.map(a => a.id).sort().join('.'), prio: 2, zeit: roh.abs[0].created_at, art: 'abs', daten: roh.abs,
      titel: roh.abs.length === 1 ? 'Neue Abwesenheit' : `${roh.abs.length} neue Abwesenheiten`,
      text: roh.abs.slice(0, 4).map(a => `${a.chatter_name} ${tagText(a.date_from)}${a.date_to !== a.date_from ? '–' + tagText(a.date_to) : ''}`).join(', ') + (roh.abs.length > 4 ? ' …' : ''),
    })

    for (const r of roh.cr) {
      if (r.status === 'neu') liste.push({
        key: 'cr-' + r.id, prio: 2, zeit: r.created_at, art: 'cr', daten: r,
        titel: `Neue Custom-Anfrage für ${r.model_name}`,
        text: `${r.chatter_name ? r.chatter_name + ': ' : ''}${kurz(r.edited_text || r.request_text, 110)} — noch nicht ans Model weitergegeben.`,
      })
      else {
        const frist = anfrageFrist(r)
        if (frist && frist <= heute) liste.push({
          key: 'crx-' + r.id, prio: 3, zeit: r.created_at, art: 'cr', sym: 'crx', daten: r,
          titel: `Custom für ${r.model_name} ist überfällig`,
          text: `${r.status === 'bestaetigt' ? 'Zugesagt' : 'Angefragt'}, noch nicht erledigt: ${kurz(r.edited_text || r.request_text, 90)}`,
        })
      }
    }

    if (daten?.fehlt && daten.tag && daten.tag < heute && berlinStunde() >= 12) liste.push({
      key: 'csv-' + daten.tag, prio: 3, zeit: null, art: 'csv',
      titel: `Umsatz-Daten vom ${tagText(daten.tag)} fehlen`,
      text: 'Model- oder Chatter-Datei ist noch nicht hochgeladen — Zahlen und Billing stimmen sonst nicht.',
    })

    return liste.sort((a, b) => a.prio - b.prio || String(a.zeit || '').localeCompare(String(b.zeit || '')))
  }, [roh, daten?.fehlt, daten?.tag])

  // „Nicht mehr erinnern“: ausgeblendete Einträge. Ist die Sache weg, fliegt
  // auch der Merker raus — kommt sie wieder (oder ändert sich), meldet sie sich neu.
  const [aus, setAus] = useState(liesAus)
  const [zeigAus, setZeigAus] = useState(false)
  useEffect(() => {
    if (!roh) return
    const da = new Set(alle.map(e => e.key))
    const rest = new Set([...aus].filter(k => da.has(k)))
    if (rest.size !== aus.size) { setAus(rest); schreibAus(rest) }
  }, [roh, alle]) // eslint-disable-line react-hooks/exhaustive-deps
  const eintraege = useMemo(() => alle.filter(e => !aus.has(e.key)), [alle, aus])
  const ausgeblendet = useMemo(() => alle.filter(e => aus.has(e.key)), [alle, aus])
  const nichtMehr = (e) => { const n = new Set(aus); n.add(e.key); setAus(n); schreibAus(n) }
  const alleGelesen = () => {
    const n = new Set(aus); eintraege.forEach(e => n.add(e.key)); setAus(n); schreibAus(n)
    setOffen(false); setCodes([]); setZeigAus(false)
  }
  const wiederAn = (e) => { const n = new Set(aus); n.delete(e.key); setAus(n); schreibAus(n) }

  // ── Automatisch öffnen ───────────────────────────────────────────────────
  useEffect(() => {
    if (!roh || offen || !eintraege.length) return
    const s = lies()
    const bekannt = new Set(s.keys || [])
    const neu = eintraege.some(e => !bekannt.has(e.key))
    const ruhe = (s.bis || 0) > Date.now()
    if (neu || !ruhe) setOffen(true)
  }, [roh, eintraege, offen])

  const spaeter = () => {
    schreib({ bis: Date.now() + RUHE_MS, keys: eintraege.map(e => e.key) })
    setOffen(false); setCodes([])
  }

  const melde = (key, text) => setHinweis(h => ({ ...h, [key]: text }))
  const feld = (key, name, wert) => setEingabe(x => ({ ...x, [key]: { ...(x[key] || {}), [name]: wert } }))
  const geh = (tab, focus) => { spaeter(); onNavigate && onNavigate(tab, focus) }

  // ── Aktionen ─────────────────────────────────────────────────────────────
  const pwFreigeben = async (e) => {
    const r = e.daten
    if (!confirm(`Neues Passwort für ${r.display_name || r.email} freigeben?\n\nNur freigeben, wenn du weißt, dass diese Person gerade danach gefragt hat.`)) return
    setBusy(e.key)
    const d = await funktion('password-reset', { action: 'approve', id: r.id })
    setBusy(null)
    if (!d.ok) { melde(e.key, '⚠ ' + (d.error || 'Freigabe fehlgeschlagen.')); return }
    if (!d.per_telegram && d.code) setCodes(c => [...c, { name: r.display_name || r.email, code: d.code }])
    lade()
  }
  const pwAblehnen = async (e) => {
    const r = e.daten
    if (!confirm(`Anfrage von ${r.display_name || r.email} ablehnen?`)) return
    setBusy(e.key)
    const { error } = await supabase.from('password_resets').delete().eq('id', r.id)
    setBusy(null)
    if (error) { melde(e.key, '⚠ ' + error.message); return }
    lade()
  }
  const entsperren = async (e) => {
    if (!confirm(`Login für ${e.daten.name || e.daten.email} wieder freigeben?`)) return
    setBusy(e.key)
    const d = await funktion('account-sperre', { action: 'entsperren', user_id: e.daten.user_id })
    setBusy(null)
    if (!d.ok) { melde(e.key, '⚠ ' + d.error); return }
    lade()
  }
  const einrichten = async (e) => {
    const x = eingabe[e.key] || {}
    const name = String(x.name ?? e.daten.name ?? '').trim()
    const rolleKey = x.rolle || ''
    if (!name || !rolleKey) { melde(e.key, 'Bitte Name und Rolle wählen.'); return }
    if (!confirm(`${e.daten.email} als „${name}“ mit Rolle ${ROLES.find(r => r.key === rolleKey)?.label || rolleKey} einrichten?`)) return
    setBusy(e.key)
    const { error } = await supabase.rpc('admin_konto_einrichten', { p_user: e.daten.user_id, p_name: name, p_rolle: rolleKey })
    setBusy(null)
    if (error) { melde(e.key, '⚠ ' + error.message); return }
    lade()
  }
  const antworten = async (e, nurWeg) => {
    const text = nurWeg ? '' : String(eingabe[e.key]?.antwort || '').trim()
    if (!nurWeg && !text) { melde(e.key, 'Bitte eine Antwort schreiben.'); return }
    if (nurWeg && !confirm('Frage als geklärt entfernen? Das Model bekommt dann keine Nachricht.')) return
    setBusy(e.key)
    const r = await frageBeantworten(e.daten, text)
    setBusy(null)
    if (r.error) { melde(e.key, '⚠ ' + r.error.message); return }
    lade()
  }
  const absGesehen = async (e) => {
    setBusy(e.key)
    const { error } = await supabase.from('absences').update({ seen_by_admin: true }).in('id', e.daten.map(a => a.id))
    setBusy(null)
    if (error) { melde(e.key, '⚠ ' + error.message); return }
    lade()
  }

  const knoepfe = (e) => {
    const b = busy === e.key
    switch (e.art) {
      case 'pw': return <>
        <button className="aw-k aw-p" disabled={b} onClick={() => pwFreigeben(e)}>{b ? '…' : <><Check size={14} strokeWidth={2.6} /> Freigeben</>}</button>
        <button className="aw-k" disabled={b} onClick={() => pwAblehnen(e)}>Ablehnen</button>
      </>
      case 'ban': return <>
        <button className="aw-k aw-p" disabled={b} onClick={() => entsperren(e)}>{b ? '…' : 'Entsperren'}</button>
        <button className="aw-k" onClick={() => geh('settings')}>Team &amp; Rechte</button>
      </>
      case 'rolle': {
        const x = eingabe[e.key] || {}
        return <div className="aw-form">
          <input className="aw-in" placeholder="Name im Dashboard" value={x.name ?? e.daten.name ?? ''} onChange={ev => feld(e.key, 'name', ev.target.value)} />
          <select className="aw-in" value={x.rolle || ''} onChange={ev => feld(e.key, 'rolle', ev.target.value)}>
            <option value="">Rolle wählen …</option>
            {ROLLEN_WAHL.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <button className="aw-k aw-p" disabled={b} onClick={() => einrichten(e)}>{b ? '…' : 'Einrichten'}</button>
        </div>
      }
      case 'skripte': return <button className="aw-k aw-p" onClick={() => geh('skripte')}>Zur Freigabe</button>
      case 'frage': {
        const x = eingabe[e.key] || {}
        return <div className="aw-form">
          <textarea className="aw-in" rows={2} placeholder="Antwort ans Model (geht per Telegram)" value={x.antwort || ''} onChange={ev => feld(e.key, 'antwort', ev.target.value)} />
          <div className="aw-reihe">
            <button className="aw-k aw-p" disabled={b} onClick={() => antworten(e, false)}>{b ? '…' : 'Antworten'}</button>
            <button className="aw-k" disabled={b} onClick={() => antworten(e, true)}>Schon geklärt</button>
            <button className="aw-k" onClick={() => geh('skripte')}>Skript ansehen</button>
          </div>
        </div>
      }
      case 'swap': return <button className="aw-k aw-p" onClick={() => geh('chatters-comm')}>Zur Crew</button>
      case 'abs': return <>
        <button className="aw-k aw-p" disabled={b} onClick={() => absGesehen(e)}>{b ? '…' : <><ThumbsUp size={14} strokeWidth={2.4} /> Gesehen</>}</button>
        <button className="aw-k" onClick={() => geh('schedule')}>Zum Dienstplan</button>
      </>
      case 'cr': return <button className="aw-k aw-p" onClick={() => geh('models-comm', { section: 'content-requests', id: e.daten.id })}>Anfrage öffnen</button>
      case 'csv': return <button className="aw-k aw-p" onClick={() => { spaeter(); daten?.oeffnen && daten.oeffnen() }}>Hochladen</button>
      default: return null
    }
  }

  const zeile = (e, stumm) => {
    const Sym = SYMBOL[e.sym || e.art] || Zap
    return (
      <div key={e.key} className={'aw-it' + (stumm ? ' aw-stumm' : '')} style={{ borderLeftColor: stumm ? 'transparent' : FARBE[e.prio] }}>
        <div className="aw-ic" style={{ color: FARBE[e.prio], background: FARBE[e.prio] + '1f' }}><Sym size={18} strokeWidth={2.2} /></div>
        <div className="aw-t">
          <b>{e.titel}{e.zeit && <span className="aw-alt" style={{ color: FARBE[e.prio] }}>{zeitText(e)}</span>}</b>
          <span>{e.text}</span>
          {stumm ? (
            <div className="aw-knopf"><button className="aw-k" onClick={() => wiederAn(e)}><Bell size={14} strokeWidth={2.4} /> Wieder erinnern</button></div>
          ) : (
            <div className="aw-knopf">
              {knoepfe(e)}
              <button className="aw-k aw-leise" onClick={() => nichtMehr(e)} title="Ad acta: für diese Sache kein Pop-up und keine Erinnerung mehr">
                <Check size={14} strokeWidth={2.6} /> Gelesen
              </button>
            </div>
          )}
          {hinweis[e.key] && <div className="aw-hinweis">{hinweis[e.key]}</div>}
        </div>
      </div>
    )
  }

  if (!eintraege.length && !codes.length && !ausgeblendet.length && !offen) return null

  const knopf = eintraege.length ? (
    <button className="aw-pill" onClick={() => setOffen(true)} title="Dinge, bei denen jemand auf euch wartet">
      <Zap size={14} strokeWidth={2.6} /> <span className="hide-sm">Wartet</span> <span className="aw-zahl">{eintraege.length}</span>
    </button>
  ) : ausgeblendet.length ? (
    <button className="aw-pill aw-pill-ruhig" onClick={() => { setZeigAus(true); setOffen(true) }} title="Alles gelesen — hier findest du es wieder">
      <BellOff size={14} strokeWidth={2.4} /> <span className="aw-zahl-ruhig">{ausgeblendet.length}</span>
    </button>
  ) : null

  return <>
    {knopf}
    {(offen || codes.length > 0) && createPortal(
      <div className="aw-ov" onClick={(ev) => { if (ev.target === ev.currentTarget) spaeter() }}>
        <div className="aw-pop" role="dialog" aria-label="Wartet auf euch">
          <div className="aw-kopf">
            <span className="aw-kopf-ic"><Zap size={18} strokeWidth={2.6} /></span>
            <h3>Wartet auf euch <small>· {eintraege.length ? `${eintraege.length} ${eintraege.length === 1 ? 'Sache' : 'Dinge'}` : 'alles gelesen'}</small></h3>
            <button className="aw-x" onClick={spaeter} aria-label="Schließen"><X size={18} /></button>
          </div>
          <div className="aw-liste">
            {codes.map((c, i) => (
              <div key={'code' + i} className="aw-code">
                <KeyRound size={16} strokeWidth={2.4} /> Code für <b>{c.name}</b>: <code>{c.code}</code> — keine Telegram-ID, bitte selbst weitergeben.
                <button className="aw-x" onClick={() => setCodes(l => l.filter((_, j) => j !== i))} aria-label="Weg"><X size={16} /></button>
              </div>
            ))}
            {!eintraege.length && <div className="aw-leer"><Check size={16} strokeWidth={2.6} /> Nichts Neues — alles gelesen.</div>}
            {eintraege.map(e => zeile(e, false))}
            {zeigAus && ausgeblendet.map(e => zeile(e, true))}
          </div>
          <div className="aw-fuss">
            {ausgeblendet.length > 0
              ? <button className="aw-link" onClick={() => setZeigAus(v => !v)}>
                  {ausgeblendet.length} gelesen · {zeigAus ? 'ausblenden' : 'anzeigen'}
                </button>
              : <span className="aw-fuss-text">Neue Sachen melden sich wieder.</span>}
            <div className="aw-fuss-knoepfe">
              <button className="aw-k" onClick={spaeter}>{eintraege.length ? 'Später (1 Std.)' : 'Schließen'}</button>
              {eintraege.length > 0 && <button className="aw-k aw-p" onClick={alleGelesen} title="Alles ad acta — nur neue Sachen holen das Pop-up wieder hoch">
                <CheckCheck size={15} strokeWidth={2.6} /> Alle gelesen
              </button>}
            </div>
          </div>
        </div>
      </div>, document.body)}
  </>
}
