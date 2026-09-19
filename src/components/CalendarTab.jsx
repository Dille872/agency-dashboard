// v4.60.0: Team-Kalender (Stufe 1) — Admin-Ansicht.
//
// Eingabe in deutscher Zeit (wie im Dienstplan), Speicherung als fester
// Zeitpunkt, Anzeige wahlweise in der eigenen Zeit (Browser) oder in
// deutscher Zeit. Models bleiben getrennt: ihre eigenen Termine und Reisen
// (Model-Portal) erscheinen hier nur zum Lesen, damit niemand sie nachtragen muss.
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../supabase'
import { logActivity } from '../activity'
import { ladeInaktiveNamen, ohneInaktive } from '../people'
import {
  BERLIN, meineZone, wandzeitZuDatum, datumInZone, zeitIn, utcLabel, ortAus, TEAM_ZONEN,
} from '../zeit'

export const ARTEN = [
  { key: 'aufgabe', label: 'Aufgabe', farbe: '#f59e0b' },
  { key: 'event', label: 'Event', farbe: '#ec4899' },
  { key: 'termin', label: 'Team-Termin', farbe: '#8b5cf6' },
  { key: 'erinnerung', label: 'Erinnerung', farbe: '#06b6d4' },
]
export const artInfo = (k) => ARTEN.find(a => a.key === k) || ARTEN[0]
const MODEL_FARBE = '#10b981'
const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

// Kalendertag-Arithmetik auf "YYYY-MM-DD" (zeitzonenfrei, über 12:00 UTC)
const plusTage = (tag, n) => { const d = new Date(tag + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const wochentag = (tag) => (new Date(tag + 'T12:00:00Z').getUTCDay() + 6) % 7 // Mo=0
const montagVon = (tag) => plusTage(tag, -wochentag(tag))
const kurzTag = (tag) => new Date(tag + 'T12:00:00Z').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })

const leer = () => ({ id: null, titel: '', art: 'aufgabe', tag: datumInZone(new Date(), BERLIN).tag, von: '', bis: '', notiz: '', fuer: [], fuer_alle: false })

export default function CalendarTab({ userDisplayName }) {
  const [zoneModus, setZoneModus] = useState('lokal') // 'lokal' | 'berlin'
  const anzeigeZone = zoneModus === 'berlin' ? BERLIN : meineZone()
  const heute = datumInZone(new Date(), anzeigeZone).tag
  const [woche, setWoche] = useState(() => montagVon(datumInZone(new Date(), meineZone()).tag))
  const [eintraege, setEintraege] = useState([])
  const [modelSachen, setModelSachen] = useState([])
  const [personen, setPersonen] = useState([])
  const [ebenen, setEbenen] = useState({ aufgabe: true, event: true, termin: true, erinnerung: true, models: true })
  const [auswahl, setAuswahl] = useState(null)
  const [form, setForm] = useState(null)
  const [speichert, setSpeichert] = useState(false)
  const [fehler, setFehler] = useState(null)

  const tage = useMemo(() => Array.from({ length: 7 }, (_, i) => plusTage(woche, i)), [woche])

  const laden = useCallback(async () => {
    setFehler(null)
    // großzügig laden (±1 Tag), damit jede Zeitzone ihre Woche vollständig sieht
    const von = wandzeitZuDatum(plusTage(woche, -1), '00:00', 'UTC').toISOString()
    const bis = wandzeitZuDatum(plusTage(woche, 8), '23:59', 'UTC').toISOString()
    const [k, mc, mb] = await Promise.all([
      supabase.from('team_kalender').select('*').gte('beginn', von).lte('beginn', bis).order('beginn'),
      supabase.from('model_calendar').select('id, model_name, title, description, due_date, due_time, category')
        .in('category', ['termin', 'reise']).gte('due_date', plusTage(woche, -1)).lte('due_date', plusTage(woche, 7)),
      supabase.from('model_board').select('id, model_name, category, title, date, date_from, date_to')
        .in('category', ['reise', 'termine']),
    ])
    if (k.error) { setFehler(k.error.message.includes('team_kalender') ? 'Die Kalender-Tabelle fehlt noch — bitte das SQL „team-kalender.sql" in Supabase ausführen.' : k.error.message); return }
    setEintraege(k.data || [])
    const ende = plusTage(woche, 6)
    const ms = []
    for (const r of mc.data || []) {
      ms.push({ key: 'mc' + r.id, model: r.model_name, titel: r.title, von: r.due_date, bis: r.due_date, zeit: r.due_time, art: r.category === 'reise' ? 'Reise' : 'Termin' })
    }
    for (const r of mb.data || []) {
      const von = r.date_from || r.date, bis = r.date_to || r.date_from || r.date
      if (!von || bis < woche || von > ende) continue
      ms.push({ key: 'mb' + r.id, model: r.model_name, titel: r.title, von, bis, art: r.category === 'reise' ? 'Reise/Urlaub' : 'Termin' })
    }
    setModelSachen(ms)
  }, [woche])

  useEffect(() => { laden() }, [laden])

  useEffect(() => {
    ;(async () => {
      const [c, u, inaktiv] = await Promise.all([
        supabase.from('chatters_contact').select('name, active').order('name'),
        supabase.from('user_roles').select('display_name, roles, role, status'),
        ladeInaktiveNamen(),
      ])
      const chatter = ohneInaktive(c.data || [], inaktiv).map(x => x.name)
      const team = (u.data || [])
        .filter(x => x.status !== 'suspended' && x.status !== 'offboarded')
        .filter(x => [...(x.roles || []), x.role].some(r => ['admin', 'manager', 'dienstplan', 'creator_manager'].includes(r)))
        .map(x => x.display_name).filter(Boolean)
      setPersonen([...new Set([...team, ...chatter])].sort((a, b) => a.localeCompare(b, 'de')))
    })()
  }, [])

  const proTag = useMemo(() => {
    const m = Object.fromEntries(tage.map(t => [t, []]))
    for (const e of eintraege) {
      if (!ebenen[e.art]) continue
      const t = datumInZone(e.beginn, anzeigeZone).tag
      if (m[t]) m[t].push(e)
    }
    return m
  }, [eintraege, tage, anzeigeZone, ebenen])

  const modelProTag = useMemo(() => {
    const m = Object.fromEntries(tage.map(t => [t, []]))
    if (!ebenen.models) return m
    for (const s of modelSachen) for (const t of tage) if (t >= s.von && t <= s.bis) m[t].push(s)
    return m
  }, [modelSachen, tage, ebenen])

  // ── Formular ──────────────────────────────────────────────────────────────
  const oeffneNeu = (tag) => { setForm({ ...leer(), tag: tag || leer().tag }); setAuswahl(null) }
  const oeffneBearbeiten = (e) => {
    const b = datumInZone(e.beginn, BERLIN)
    setForm({ id: e.id, titel: e.titel, art: e.art, tag: b.tag, von: b.zeit, bis: e.ende ? zeitIn(e.ende, BERLIN) : '', notiz: e.notiz || '', fuer: e.fuer || [], fuer_alle: !!e.fuer_alle })
    setAuswahl(null)
  }
  const vorschauBeginn = form && form.tag && form.von ? wandzeitZuDatum(form.tag, form.von, BERLIN) : null

  const speichern = async () => {
    if (!form.titel.trim()) { alert('Titel fehlt.'); return }
    if (!form.tag || !form.von) { alert('Datum und Uhrzeit (deutsche Zeit) fehlen.'); return }
    if (!form.fuer_alle && form.fuer.length === 0) { alert('Für wen ist der Eintrag? Personen wählen oder „Ganzes Team".'); return }
    const beginn = wandzeitZuDatum(form.tag, form.von, BERLIN)
    let ende = null
    if (form.bis) {
      ende = wandzeitZuDatum(form.tag, form.bis, BERLIN)
      if (ende <= beginn) ende = new Date(ende.getTime() + 24 * 3600 * 1000) // über Mitternacht
    }
    const zeile = {
      titel: form.titel.trim(), art: form.art, beginn: beginn.toISOString(), ende: ende ? ende.toISOString() : null,
      notiz: form.notiz.trim() || null, fuer: form.fuer_alle ? [] : form.fuer, fuer_alle: form.fuer_alle,
      geaendert_am: new Date().toISOString(),
    }
    setSpeichert(true)
    const { error } = form.id
      ? await supabase.from('team_kalender').update(zeile).eq('id', form.id)
      : await supabase.from('team_kalender').insert({ ...zeile, erstellt_von: userDisplayName || null })
    setSpeichert(false)
    if (error) { alert('⚠ Nicht gespeichert: ' + error.message); return }
    logActivity(form.id ? 'kalender.edit' : 'kalender.neu', { entity: zeile.titel, detail: `${form.tag} ${form.von} (DE)` })
    setForm(null)
    // Woche des Eintrags anzeigen
    setWoche(montagVon(datumInZone(beginn, anzeigeZone).tag))
    laden()
  }

  const loeschen = async (e) => {
    if (!confirm(`„${e.titel}" löschen?`)) return
    const { error } = await supabase.from('team_kalender').delete().eq('id', e.id)
    if (error) { alert('⚠ Nicht gelöscht: ' + error.message); return }
    logActivity('kalender.loeschen', { entity: e.titel })
    setAuswahl(null); laden()
  }

  // ── Darstellung ───────────────────────────────────────────────────────────
  const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10 }
  const inp = { background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }
  const lbl = { fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }
  const btn = (aktiv) => ({ padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: aktiv ? '#7c3aed' : 'transparent', color: aktiv ? '#fff' : 'var(--text-secondary)', border: `1px solid ${aktiv ? '#7c3aed' : 'var(--border)'}` })
  const kw = (() => { const d = new Date(woche + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 3); const j = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); return 1 + Math.round(((d - j) / 864e5 - 3 + ((j.getUTCDay() + 6) % 7)) / 7) })()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Kopfzeile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => setWoche(plusTage(woche, -7))} style={btn(false)} aria-label="Vorige Woche">‹</button>
        <button onClick={() => setWoche(montagVon(heute))} style={btn(false)}>Heute</button>
        <button onClick={() => setWoche(plusTage(woche, 7))} style={btn(false)} aria-label="Nächste Woche">›</button>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginLeft: 4 }}>KW {kw} · {kurzTag(woche)} – {kurzTag(plusTage(woche, 6))}</div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
          Zeiten in:
          <button onClick={() => setZoneModus('lokal')} style={btn(zoneModus === 'lokal')}>meiner Zeit ({ortAus(meineZone())}, {utcLabel(meineZone())})</button>
          <button onClick={() => setZoneModus('berlin')} style={btn(zoneModus === 'berlin')}>deutscher Zeit</button>
        </div>
        <button onClick={() => oeffneNeu()} style={{ ...btn(true), padding: '7px 14px' }}>+ Neuer Eintrag</button>
      </div>

      {/* Ebenen */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[...ARTEN.map(a => ({ key: a.key, label: a.label, farbe: a.farbe })), { key: 'models', label: 'Models: Termine & Urlaub', farbe: MODEL_FARBE }].map(e => (
          <button key={e.key} onClick={() => setEbenen(p => ({ ...p, [e.key]: !p[e.key] }))}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: ebenen[e.key] ? 'rgba(255,255,255,0.04)' : 'transparent', color: ebenen[e.key] ? 'var(--text-primary)' : 'var(--text-muted)', border: `1px solid ${ebenen[e.key] ? '#2e2e5a' : 'var(--border)'}`, opacity: ebenen[e.key] ? 1 : 0.6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: e.farbe }} />{e.label}
          </button>
        ))}
      </div>

      {fehler && <div style={{ ...card, padding: 12, color: '#ef4444', fontSize: 13 }}>⚠ {fehler}</div>}

      {/* Woche */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(140px, 1fr))', gap: 8, overflowX: 'auto' }}>
        {tage.map((t, i) => {
          const istHeute = t === heute
          return (
            <div key={t} style={{ ...card, minHeight: 320, padding: 8, display: 'flex', flexDirection: 'column', gap: 6, background: istHeute ? 'rgba(124,58,237,0.06)' : 'var(--bg-card)', borderColor: istHeute ? 'rgba(124,58,237,0.4)' : 'var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: istHeute ? '#c4b5fd' : 'var(--text-secondary)' }}>{TAGE[i]} {kurzTag(t)}{istHeute ? ' · heute' : ''}</span>
                <button onClick={() => oeffneNeu(t)} title="Eintrag an diesem Tag" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14 }}>+</button>
              </div>
              {modelProTag[t].map(s => (
                <div key={s.key + t} title={`${s.model} · ${s.art}: ${s.titel}`} style={{ fontSize: 10.5, padding: '3px 6px', borderRadius: 5, background: 'rgba(16,185,129,0.12)', color: '#6ee7b7', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.model} · {s.art}: {s.titel}
                </div>
              ))}
              {proTag[t].map(e => {
                const a = artInfo(e.art)
                const erledigt = (e.erledigt_von || []).length
                return (
                  <button key={e.id} onClick={() => setAuswahl(e)}
                    style={{ textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', padding: '6px 8px', borderRadius: 7, background: a.farbe + '1f', border: `1px solid ${a.farbe}55`, borderLeft: `3px solid ${a.farbe}`, color: 'var(--text-primary)', outline: auswahl?.id === e.id ? `2px solid ${a.farbe}` : 'none' }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 11, color: a.farbe, fontWeight: 700 }}>{zeitIn(e.beginn, anzeigeZone)}{e.ende ? '–' + zeitIn(e.ende, anzeigeZone) : ''}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>{e.titel}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{e.fuer_alle ? 'Ganzes Team' : (e.fuer || []).join(', ')}{erledigt ? ` · ✓ ${erledigt}` : ''}</div>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* Detail */}
      {auswahl && (() => {
        const a = artInfo(auswahl.art)
        return (
          <div style={{ ...card, padding: 16, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ alignSelf: 'flex-start', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: a.farbe, background: a.farbe + '22', padding: '2px 8px', borderRadius: 4 }}>{a.label}</span>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{auswahl.titel}</div>
              {auswahl.notiz && <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{auswahl.notiz}</div>}
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Für: {auswahl.fuer_alle ? 'Ganzes Team' : (auswahl.fuer || []).join(', ')}</div>
              {(auswahl.erledigt_von || []).length > 0 && <div style={{ fontSize: 12, color: '#10b981' }}>✓ erledigt von {(auswahl.erledigt_von || []).join(', ')}</div>}
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>angelegt von {auswahl.erstellt_von || '—'}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => oeffneBearbeiten(auswahl)} style={btn(false)}>Bearbeiten</button>
                <button onClick={() => loeschen(auswahl)} style={{ ...btn(false), color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' }}>Löschen</button>
                <button onClick={() => setAuswahl(null)} style={btn(false)}>Schließen</button>
              </div>
            </div>
            <ZonenTabelle beginn={auswahl.beginn} />
          </div>
        )
      })()}

      {/* Formular */}
      {form && (
        <div onClick={() => !speichert && setForm(null)} style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ ...card, width: 'min(860px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: 20, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 380px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>{form.id ? 'Eintrag bearbeiten' : 'Neuer Eintrag'}</div>
              <label><span style={lbl}>Titel</span><input value={form.titel} onChange={e => setForm({ ...form, titel: e.target.value })} style={inp} placeholder="z. B. Massennachricht Chiara" /></label>
              <div><span style={lbl}>Art</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {ARTEN.map(a => <button key={a.key} type="button" onClick={() => setForm({ ...form, art: a.key })} style={{ ...btn(form.art === a.key), ...(form.art === a.key ? { background: a.farbe, borderColor: a.farbe } : {}) }}>{a.label}</button>)}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', gap: 10 }}>
                <label><span style={lbl}>Datum (deutsche Zeit)</span><input type="date" value={form.tag} onChange={e => setForm({ ...form, tag: e.target.value })} style={inp} /></label>
                <label><span style={lbl}>von</span><input type="time" value={form.von} onChange={e => setForm({ ...form, von: e.target.value })} style={inp} /></label>
                <label><span style={lbl}>bis (optional)</span><input type="time" value={form.bis} onChange={e => setForm({ ...form, bis: e.target.value })} style={inp} /></label>
              </div>
              <div><span style={lbl}>Für wen</span>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-primary)', marginBottom: 6 }}>
                  <input type="checkbox" checked={form.fuer_alle} onChange={e => setForm({ ...form, fuer_alle: e.target.checked })} style={{ accentColor: '#7c3aed' }} /> Ganzes Team
                </label>
                {!form.fuer_alle && (
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', maxHeight: 150, overflowY: 'auto' }}>
                    {personen.map(p => {
                      const an = form.fuer.includes(p)
                      return <button key={p} type="button" onClick={() => setForm({ ...form, fuer: an ? form.fuer.filter(x => x !== p) : [...form.fuer, p] })}
                        style={{ padding: '4px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: an ? 'rgba(124,58,237,0.2)' : 'transparent', color: an ? '#ddd6fe' : 'var(--text-secondary)', border: `1px solid ${an ? '#7c3aed' : 'var(--border)'}` }}>{an ? '✓ ' : ''}{p}</button>
                    })}
                  </div>
                )}
              </div>
              <label><span style={lbl}>Notiz</span><textarea value={form.notiz} onChange={e => setForm({ ...form, notiz: e.target.value })} rows={3} style={{ ...inp, resize: 'vertical' }} /></label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setForm(null)} disabled={speichert} style={btn(false)}>Abbrechen</button>
                <button onClick={speichern} disabled={speichert} style={{ ...btn(true), padding: '8px 18px' }}>{speichert ? 'Speichert…' : form.id ? 'Speichern' : 'Eintragen'}</button>
              </div>
            </div>
            <div style={{ flex: '0 1 260px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>So sieht es bei den anderen aus</div>
              {vorschauBeginn ? <ZonenTabelle beginn={vorschauBeginn} /> : <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Datum und Uhrzeit eingeben — hier erscheint dann die Uhrzeit in jeder Zeitzone.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Beginn eines Eintrags in der eigenen Zeit + den Team-Zonen
export function ZonenTabelle({ beginn }) {
  const eigene = meineZone()
  const zonen = [{ zone: eigene, ort: `Du (${ortAus(eigene)})` }, ...TEAM_ZONEN.filter(z => z.zone !== eigene)]
  const tagBerlin = datumInZone(beginn, BERLIN).tag
  return (
    <div style={{ minWidth: 240, background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 9, padding: '6px 12px' }}>
      {zonen.map(z => {
        const d = datumInZone(beginn, z.zone)
        const andererTag = d.tag !== tagBerlin
        return (
          <div key={z.zone} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0', borderTop: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>{z.ort}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{utcLabel(z.zone, new Date(beginn))}{andererTag ? ' · ' + new Date(beginn).toLocaleDateString('de-DE', { timeZone: z.zone, weekday: 'short', day: '2-digit', month: '2-digit' }) : ''}</div>
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700, color: z.zone === eigene ? '#c4b5fd' : 'var(--text-primary)' }}>{d.zeit}</div>
          </div>
        )
      })}
    </div>
  )
}
