import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  STATUS, ARTEN, artText, schritteSauber, skripteLaden, modelsLaden, speichern,
  zurFreigabeGemeldet, freischalten, zurueckSchicken, alsGebaut, builderVideosLaden, videoErledigt,
  auftragGeben, storytellerErinnern, builderAnstupsen,
  vorlagenLaden, skriptAlsVorlage, builderAuftrag, QUELLE,
} from '../ofSkripte'
import { supabase } from '../supabase'
import { nimmStartZiel } from '../route'
import { P, LILA, C, G, AMB, ROT, card, eingabe, label, knopf, pill, datumKurz, vorZeit, SchritteEditor, SchritteAnzeige } from './skriptUi'
import SkriptBibliothek from './SkriptBibliothek' // v5.30.0
export { SchritteEditor, SchritteAnzeige }

// ── Skripte: Storyteller · Freigabe · Script Builder (v5.27.0) ─────────────
// Ein Bereich für drei Sichten, je nach Rolle:
//   ✍️ Schreiben       Storyteller (und Admins): Skript mit Schritten anlegen, eigene Liste
//   🔓 Freigabe        Admins: alles sehen, freischalten, zurückschicken, bearbeiten
//   🧩 Script Builder  Noa & Co.: was in CreatorHero zu bauen ist (Skripte + Model-Videos)
// Benutzt im Admin (Kommunikation → Skripte) und im Chatter-Portal (Reiter Skripte).

const leer = () => ({ model_name: '', titel: '', art: 'video', schritte: [{ text: '' }], outfit: '', laenge: '', notiz_builder: '', faellig: '' })

// ── Formular (neu oder bearbeiten) ─────────────────────────────────────────
function SkriptFormular({ vorlage, models, wer, istAdmin, onFertig, onAbbrechen }) {
  const [s, setS] = useState(() => vorlage ? { ...leer(), ...vorlage, schritte: (vorlage.schritte || []).length ? vorlage.schritte.map(x => ({ ...x })) : [{ text: '' }], faellig: vorlage.faellig || '' } : leer())
  const [arbeitet, setArbeitet] = useState(false)
  const [fehler, setFehler] = useState('')
  const setze = (patch) => setS(x => ({ ...x, ...patch }))
  const anzahl = schritteSauber(s.schritte).length
  const bereit = !!s.model_name && !!String(s.titel).trim() && anzahl > 0

  const sichern = async (status) => {
    setFehler('')
    if (!s.model_name || !String(s.titel).trim()) { setFehler('Bitte Model und Titel angeben.'); return }
    if (status !== 'entwurf' && !anzahl) { setFehler('Mindestens ein Schritt, bevor es zur Freigabe geht.'); return }
    setArbeitet(true)
    const { data, error } = await speichern({ ...s, titel: String(s.titel).trim().slice(0, 200), status }, wer)
    setArbeitet(false)
    if (error) { setFehler(error.message); return }
    if (status === 'freigabe' && !istAdmin) await zurFreigabeGemeldet(data || s, wer)
    onFertig?.(data, status)
  }

  const neu = !s.id
  const darfEntwurf = !s.status || ['auftrag', 'entwurf', 'freigabe', 'zurueck'].includes(s.status)
  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ flex: 1, fontSize: 16, color: 'var(--text-primary)' }}>{neu ? 'Neues Skript' : 'Skript bearbeiten'}</b>
        {s.status && <span style={pill(STATUS[s.status]?.f || '#999')}>{STATUS[s.status]?.t || s.status}</span>}
      </div>
      {s.status === 'auftrag' && (
        <div style={{ fontSize: 12.5, color: '#c4b5fd', background: '#8b5cf61a', border: '1px solid #8b5cf655', borderRadius: 10, padding: '8px 11px' }}>
          📋 Auftrag{s.auftrag_von ? ` von ${s.auftrag_von}` : ''}{s.faellig ? ` · bis ${datumKurz(s.faellig)}` : ''}{s.auftrag_notiz ? <><br />{s.auftrag_notiz}</> : null}
        </div>
      )}
      {s.status === 'zurueck' && s.zurueck_notiz && (
        <div style={{ fontSize: 12.5, color: ROT, background: ROT + '14', border: `1px solid ${ROT}44`, borderRadius: 10, padding: '8px 11px' }}>↩ Notiz: {s.zurueck_notiz}</div>
      )}
      <div className="sk-zwei" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 10 }}>
        <div><span style={label}>Für Model</span>
          <select value={s.model_name} onChange={e => setze({ model_name: e.target.value })} style={eingabe}>
            <option value="">Model wählen …</option>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
            {s.model_name && !models.includes(s.model_name) && <option value={s.model_name}>{s.model_name}</option>}
          </select>
        </div>
        <div><span style={label}>Art</span>
          <select value={s.art} onChange={e => setze({ art: e.target.value })} style={eingabe}>
            {ARTEN.map(a => <option key={a.k} value={a.k}>{a.t}</option>)}
          </select>
        </div>
      </div>
      <div><span style={label}>Titel</span>
        <input value={s.titel} onChange={e => setze({ titel: e.target.value.slice(0, 200) })} placeholder="z. B. Nach dem Gym – Duschszene" style={eingabe} />
      </div>
      <div><span style={label}>Ablauf · Schritt für Schritt</span>
        <SchritteEditor schritte={s.schritte} onChange={v => setze({ schritte: v })} />
      </div>
      <div className="sk-zwei" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 10 }}>
        <div><span style={label}>Outfit / Ort</span><input value={s.outfit || ''} onChange={e => setze({ outfit: e.target.value.slice(0, 300) })} placeholder="z. B. Sport-BH grau, Bad" style={eingabe} /></div>
        <div><span style={label}>Länge</span><input value={s.laenge || ''} onChange={e => setze({ laenge: e.target.value.slice(0, 100) })} placeholder="z. B. ca. 4–6 Min." style={eingabe} /></div>
      </div>
      <div className="sk-zwei" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 10 }}>
        <div><span style={label}>Notiz für den Script Builder (CreatorHero)</span><input value={s.notiz_builder || ''} onChange={e => setze({ notiz_builder: e.target.value.slice(0, 500) })} placeholder="z. B. als 3er-Bundle aufteilen" style={eingabe} /></div>
        <div><span style={label}>Fällig bis (optional)</span><input type="date" value={s.faellig || ''} onChange={e => setze({ faellig: e.target.value })} style={eingabe} /></div>
      </div>
      {fehler && <div style={{ fontSize: 12.5, color: ROT }}>{fehler}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {onAbbrechen && <button type="button" onClick={onAbbrechen} style={knopf('', false)}>Abbrechen</button>}
        {darfEntwurf && <button type="button" disabled={arbeitet} onClick={() => sichern('entwurf')} style={knopf('', false)}>Als Entwurf speichern</button>}
        {istAdmin && !darfEntwurf
          ? <button type="button" disabled={arbeitet || !bereit} onClick={() => sichern(s.status)} style={{ ...knopf(LILA), opacity: bereit ? 1 : 0.5 }}>{arbeitet ? '…' : 'Speichern'}</button>
          : <button type="button" disabled={arbeitet || !bereit} onClick={() => sichern('freigabe')} style={{ ...knopf(P), opacity: bereit ? 1 : 0.5 }}>{arbeitet ? '…' : istAdmin ? 'Speichern (zur Freigabe)' : 'Zur Freigabe schicken'}</button>}
      </div>
    </div>
  )
}

// ── Zeile in Listen ────────────────────────────────────────────────────────
function Zeile({ s, rechts, onClick }) {
  return (
    <div onClick={onClick} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap', cursor: onClick ? 'pointer' : 'default' }}>
      <span style={{ fontWeight: 800, color: P, fontSize: 13, minWidth: 64 }}>{s.model_name}</span>
      <span style={{ flex: 1, minWidth: 150, fontSize: 13.5, color: 'var(--text-primary)' }}>{s.titel}
        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)' }}>{artText(s.art)} · {schritteSauber(s.schritte).length} Schritte{s.faellig ? ` · bis ${datumKurz(s.faellig)}` : ''}</span>
      </span>
      {rechts || <span style={pill(STATUS[s.status]?.f || '#999')}>{STATUS[s.status]?.t || s.status}</span>}
    </div>
  )
}

// ── ✍️ Storyteller ─────────────────────────────────────────────────────────
function Schreiben({ liste, models, wer, istAdmin, neuLaden }) {
  const [bearbeite, setBearbeite] = useState(null) // null = neues Formular, sonst Skript
  const [formKey, setFormKey] = useState(0)
  const [meldung, setMeldung] = useState('')
  const eigene = liste.filter(s => s.erstellt_von === wer && s.status !== 'auftrag')
  const auftraege = liste.filter(s => s.erstellt_von === wer && s.status === 'auftrag')
    .sort((a, b) => String(a.faellig || '9999').localeCompare(String(b.faellig || '9999')))
  const fertig = (data, status) => {
    setMeldung(status === 'freigabe' ? '✓ Zur Freigabe geschickt. Du siehst hier, wenn es beim Model ist.' : '✓ Gespeichert.')
    setBearbeite(null); setFormKey(k => k + 1); neuLaden()
    setTimeout(() => setMeldung(''), 5000)
  }
  return (
    <div className="sk-schreiben" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.35fr) minmax(0,1fr)', gap: 12, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {meldung && <div style={{ fontSize: 13, color: G, fontWeight: 700 }}>{meldung}</div>}
        {auftraege.length > 0 && (
          <div style={{ ...card, borderColor: '#8b5cf677', background: 'linear-gradient(135deg, rgba(139,92,246,0.10), var(--bg-card) 70%)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <b style={{ fontSize: 14.5, color: 'var(--text-primary)' }}>📋 Aufträge für dich ({auftraege.length})</b>
            {auftraege.map(a => (
              <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderTop: '1px solid var(--border)', background: bearbeite?.id === a.id ? '#8b5cf614' : 'transparent' }}>
                <span style={{ fontWeight: 800, color: P, fontSize: 13, minWidth: 60 }}>{a.model_name}</span>
                <span style={{ flex: 1, minWidth: 150, fontSize: 13.5, color: 'var(--text-primary)' }}>{a.titel}
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)' }}>{a.auftrag_von ? `von ${a.auftrag_von}` : ''}{a.faellig ? ` · bis ${datumKurz(a.faellig)}` : ''}{a.auftrag_notiz ? ` · ${a.auftrag_notiz}` : ''}</span>
                </span>
                <button type="button" onClick={() => { setBearbeite(a); window.scrollTo?.({ top: 0, behavior: 'smooth' }) }} style={knopf('#8b5cf6')}>{bearbeite?.id === a.id ? 'wird bearbeitet …' : '✍️ Jetzt schreiben'}</button>
              </div>
            ))}
          </div>
        )}
        <SkriptFormular key={bearbeite ? 'b' + bearbeite.id : 'n' + formKey} vorlage={bearbeite} models={models} wer={wer} istAdmin={istAdmin}
          onFertig={fertig} onAbbrechen={bearbeite ? () => setBearbeite(null) : null} />
      </div>
      <div style={card}>
        <b style={{ fontSize: 14.5, color: 'var(--text-primary)' }}>Meine Skripte</b>
        {!eigene.length && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 8 }}>Noch keine. Links das erste schreiben.</div>}
        {eigene.map(s => {
          const editierbar = ['entwurf', 'freigabe', 'zurueck'].includes(s.status)
          return <Zeile key={s.id} s={s} onClick={editierbar ? () => { setBearbeite(s); window.scrollTo?.({ top: 0, behavior: 'smooth' }) } : null} />
        })}
        {eigene.some(s => ['entwurf', 'freigabe', 'zurueck'].includes(s.status)) && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8 }}>Antippen zum Bearbeiten (geht, bis es freigeschaltet ist).</div>}
      </div>
    </div>
  )
}

// ── 📋 Auftrag an die Storytellerin (Admin) ──────────────────────────────
function AuftragFormular({ models, wer, onFertig }) {
  const [leute, setLeute] = useState(null)
  const [a, setA] = useState({ storyteller: '', model: '', anzahl: 1, thema: '', notiz: '', faellig: '' })
  const [arbeitet, setArbeitet] = useState(false)
  const [fehler, setFehler] = useState('')
  useEffect(() => {
    supabase.from('user_roles').select('display_name, roles, status').contains('roles', ['storyteller']).then(({ data }) => {
      const n = [...new Set((data || []).filter(x => (x.status || 'active') === 'active').map(x => x.display_name).filter(Boolean))]
      setLeute(n)
      if (n.length === 1) setA(x => ({ ...x, storyteller: n[0] }))
    })
  }, [])
  const setze = (p) => setA(x => ({ ...x, ...p }))
  const los = async () => {
    setFehler('')
    if (!a.storyteller || !a.model) { setFehler('Bitte Storyteller und Model wählen.'); return }
    setArbeitet(true)
    const r = await auftragGeben({ ...a, wer })
    setArbeitet(false)
    if (r.error) { setFehler(r.error.message); return }
    onFertig(r.info)
  }
  return (
    <div style={{ ...card, borderColor: '#8b5cf677', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <b style={{ fontSize: 15, color: 'var(--text-primary)' }}>📋 Auftrag an Storyteller</b>
      {leute && !leute.length && <div style={{ fontSize: 12.5, color: AMB }}>Noch niemand hat die Rolle Storyteller (Einstellungen → Team & Rechte).</div>}
      <div className="sk-zwei" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,90px)', gap: 10 }}>
        <div><span style={label}>Storyteller</span>
          <select value={a.storyteller} onChange={e => setze({ storyteller: e.target.value })} style={eingabe}>
            <option value="">wählen …</option>{(leute || []).map(n => <option key={n} value={n}>{n}</option>)}
          </select></div>
        <div><span style={label}>Für Model</span>
          <select value={a.model} onChange={e => setze({ model: e.target.value })} style={eingabe}>
            <option value="">wählen …</option>{models.map(m => <option key={m} value={m}>{m}</option>)}
          </select></div>
        <div><span style={label}>Anzahl</span>
          <select value={a.anzahl} onChange={e => setze({ anzahl: Number(e.target.value) })} style={eingabe}>
            {[1, 2, 3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>{n}</option>)}
          </select></div>
      </div>
      <div><span style={label}>Thema / Idee (optional)</span><input value={a.thema} onChange={e => setze({ thema: e.target.value.slice(0, 150) })} placeholder="z. B. Gym, Morgenroutine, Rollenspiel …" style={eingabe} /></div>
      <div className="sk-zwei" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 10 }}>
        <div><span style={label}>Hinweis (optional)</span><input value={a.notiz} onChange={e => setze({ notiz: e.target.value.slice(0, 400) })} placeholder="z. B. Es fehlen Videos mit Dessous, eher kurz halten" style={eingabe} /></div>
        <div><span style={label}>Bis wann (optional)</span><input type="date" value={a.faellig} onChange={e => setze({ faellig: e.target.value })} style={eingabe} /></div>
      </div>
      {fehler && <div style={{ fontSize: 12.5, color: ROT }}>{fehler}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" disabled={arbeitet} onClick={los} style={knopf('#8b5cf6')}>{arbeitet ? '…' : `Auftrag geben${a.anzahl > 1 ? ` (${a.anzahl} Skripte)` : ''} + Telegram`}</button>
      </div>
    </div>
  )
}

// ── 🔓 Freigabe (Admin) ────────────────────────────────────────────────────
const FILTER = [
  { k: 'freigabe', t: 'Zur Freigabe', st: ['freigabe'] },
  { k: 'auftrag', t: 'Aufträge offen', st: ['auftrag'] },
  { k: 'model', t: 'Bei Models', st: ['beim_model'] },
  { k: 'ch', t: 'Warten auf CH', st: ['hochgeladen'] },
  { k: 'fertig', t: 'Fertig', st: ['gebaut'] },
  { k: 'entwurf', t: 'Entwürfe & zurück', st: ['entwurf', 'zurueck'] },
  { k: 'alle', t: 'Alle', st: null },
]
function Freigabe({ liste, models, wer, neuLaden, vorlagen = [] }) {
  const [filter, setFilter] = useState('freigabe')
  const [auftragAuf, setAuftragAuf] = useState(false)
  const [offen, setOffen] = useState(null)
  const [bearbeite, setBearbeite] = useState(null)
  const [meldung, setMeldung] = useState('')
  const [arbeitet, setArbeitet] = useState(null)
  const zahl = (st) => liste.filter(s => st.includes(s.status)).length
  const f = FILTER.find(x => x.k === filter)
  const sicht = liste.filter(s => f.st ? f.st.includes(s.status) : s.status !== 'verworfen')
  const melde = (t) => { setMeldung(t); setTimeout(() => setMeldung(''), 6000) }

  const schalteFrei = async (s) => {
    if (!window.confirm(`„${s.titel}“ für ${s.model_name} freischalten? Sie bekommt es dann in ihre Aufgaben.`)) return
    setArbeitet(s.id)
    const r = await freischalten(s)
    setArbeitet(null)
    if (r.error) return melde('⚠ ' + r.error.message)
    melde('✓ Freigeschaltet. ' + (r.info || ''))
    neuLaden()
  }
  const zurueck = async (s) => {
    const notiz = window.prompt('Was soll geändert werden? (geht an die Storytellerin)', s.zurueck_notiz || '')
    if (notiz === null) return
    const { error } = await zurueckSchicken(s, notiz)
    if (error) return melde('⚠ ' + error.message)
    melde('✓ Zurückgeschickt.'); neuLaden()
  }
  const verwerfen = async (s) => {
    if (!window.confirm(`„${s.titel}“ verwerfen? Es bleibt gespeichert, taucht aber nirgends mehr auf.`)) return
    const { error } = await speichern({ id: s.id, status: 'verworfen', schritte: s.schritte }, wer)
    if (error) return melde('⚠ ' + error.message)
    neuLaden()
  }

  const inBibliothek = (s) => !!s.vorlage_id || vorlagen.some(v => v.titel.trim().toLowerCase() === String(s.titel).trim().toLowerCase())
  const zurBibliothek = async (s) => {
    const { error } = await skriptAlsVorlage(s, wer)
    if (error) return melde('⚠ ' + (/of_vorlagen/i.test(error.message) ? 'Bibliothek fehlt noch: sql/skript-bibliothek.sql ausführen.' : error.message))
    melde('✓ In der Bibliothek gespeichert.'); neuLaden()
  }
  const erinnern = async (s) => {
    const r = await storytellerErinnern(s, wer)
    melde((r.info || '').startsWith('Erinnerung') ? '✓ ' + r.info : '⚠ ' + r.info)
  }

  if (bearbeite) return <SkriptFormular vorlage={bearbeite} models={models} wer={wer} istAdmin onFertig={() => { setBearbeite(null); neuLaden() }} onAbbrechen={() => setBearbeite(null)} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" onClick={() => setAuftragAuf(v => !v)} style={auftragAuf ? knopf('', false) : knopf('#8b5cf6')}>{auftragAuf ? 'Schließen' : '📋 Auftrag an Storyteller'}</button>
      </div>
      {auftragAuf && <AuftragFormular models={models} wer={wer} onFertig={(info) => { setAuftragAuf(false); melde('✓ Auftrag gegeben. ' + (info || '')); setFilter('auftrag'); neuLaden() }} />}
      <div className="sk-kpis raster-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8 }}>
        {[['freigabe', AMB, 'warten auf Freigabe'], ['model', P, 'bei Models'], ['ch', C, 'warten auf CH']].map(([k, farbe, t]) => (
          <div key={k} onClick={() => setFilter(k)} style={{ ...card, padding: '11px 13px', cursor: 'pointer', borderColor: filter === k ? farbe : 'var(--border)' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: farbe }}>{zahl(FILTER.find(x => x.k === k).st)}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{t}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {FILTER.map(x => (
          <button key={x.k} type="button" onClick={() => setFilter(x.k)} style={{ fontSize: 12, padding: '6px 11px', borderRadius: 20, border: `1px solid ${filter === x.k ? LILA : 'var(--border)'}`, background: filter === x.k ? LILA + '22' : 'transparent', color: filter === x.k ? '#d8b4fe' : 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>
            {x.t}{x.st ? ` (${zahl(x.st)})` : ''}
          </button>
        ))}
      </div>
      {meldung && <div style={{ fontSize: 13, color: meldung.startsWith('⚠') ? ROT : G, fontWeight: 700 }}>{meldung}</div>}
      {!sicht.length && <div style={{ ...card, fontSize: 13, color: 'var(--text-muted)' }}>Hier ist gerade nichts.</div>}
      {sicht.map(s => {
        const auf = offen === s.id || (filter === 'freigabe' && offen === null)
        return (
          <div key={s.id} style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10, borderColor: s.status === 'freigabe' ? AMB + '66' : 'var(--border)' }}>
            <div onClick={() => setOffen(auf ? -1 : s.id)} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', cursor: 'pointer' }}>
              <span style={{ fontWeight: 800, color: P, fontSize: 13 }}>{s.model_name}</span>
              <b style={{ flex: 1, minWidth: 150, fontSize: 14.5, color: 'var(--text-primary)' }}>{s.titel}</b>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.erstellt_von ? `von ${s.erstellt_von} · ` : ''}{vorZeit(s.aktualisiert_am)}</span>
              <span style={pill(STATUS[s.status]?.f || '#999')}>{STATUS[s.status]?.t || s.status}</span>
            </div>
            {auf && <>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{artText(s.art)}{s.outfit ? ` · ${s.outfit}` : ''}{s.laenge ? ` · ${s.laenge}` : ''}{s.faellig ? ` · bis ${datumKurz(s.faellig)}` : ''}</div>
              <SchritteAnzeige schritte={s.schritte} erledigt={s.schritte_erledigt || []} />
              {s.status === 'auftrag' && <div style={{ fontSize: 12.5, color: '#c4b5fd' }}>📋 Auftrag an {s.erstellt_von}{s.auftrag_von ? ` von ${s.auftrag_von}` : ''}{s.auftrag_notiz ? ` · ${s.auftrag_notiz}` : ''}</div>}
              {s.notiz_builder && <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>🧩 Notiz für CH: {s.notiz_builder}</div>}
              {s.model_frage && <div style={{ fontSize: 12.5, color: AMB }}>❓ Frage vom Model: {s.model_frage}</div>}
              {s.of_titel && <div style={{ fontSize: 12.5, color: C }}>Titel auf OF: {s.of_titel}</div>}
              {s.status === 'gebaut' && <div style={{ fontSize: 12, color: G }}>✓ in CH gebaut von {s.gebaut_von || '—'} · {vorZeit(s.gebaut_am)}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                {s.status !== 'verworfen' && s.status !== 'gebaut' && <button type="button" onClick={() => verwerfen(s)} style={{ ...knopf('', false), color: 'var(--text-muted)' }}>Verwerfen</button>}
                {s.status === 'auftrag' && <button type="button" onClick={() => erinnern(s)} style={knopf('', false)}>🔔 Erinnern</button>}
                {['freigabe', 'entwurf'].includes(s.status) && <button type="button" onClick={() => zurueck(s)} style={knopf('', false)}>↩ Zurück mit Notiz</button>}
                {schritteSauber(s.schritte).length > 0 && s.status !== 'verworfen' && (inBibliothek(s)
                  ? <span style={{ fontSize: 12, color: G, alignSelf: 'center' }}>📚 in Bibliothek ✓</span>
                  : <button type="button" onClick={() => zurBibliothek(s)} style={knopf('', false)}>📚 In Bibliothek</button>)}
                <button type="button" onClick={() => setBearbeite(s)} style={knopf('', false)}>Bearbeiten</button>
                {['freigabe', 'entwurf', 'zurueck'].includes(s.status) && schritteSauber(s.schritte).length > 0 && (
                  <button type="button" disabled={arbeitet === s.id} onClick={() => schalteFrei(s)} style={knopf(G)}>{arbeitet === s.id ? '…' : '🔓 Freischalten → Model'}</button>
                )}
              </div>
            </>}
          </div>
        )
      })}
    </div>
  )
}

// ── 🧩 Script Builder ──────────────────────────────────────────────────────
function BuilderAuftragFormular({ models, wer, onFertig, onAbbrechen }) {
  const [a, setA] = useState({ model: '', titel: '', notiz: '', art: 'video' })
  const [arbeitet, setArbeitet] = useState(false)
  const [fehler, setFehler] = useState('')
  const setze = (p) => setA(x => ({ ...x, ...p }))
  const bereit = a.model && String(a.titel).trim()
  const los = async () => {
    setFehler(''); setArbeitet(true)
    const r = await builderAuftrag({ ...a, wer })
    setArbeitet(false)
    if (r.error) { setFehler(/quelle/i.test(r.error.message) ? 'Einmal sql/skript-bibliothek.sql ausführen.' : r.error.message); return }
    onFertig(r.info)
  }
  return (
    <div style={{ ...card, borderColor: AMB + '88', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
      <b style={{ fontSize: 15, color: 'var(--text-primary)' }}>📋 Auftrag an Script Builder</b>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Für alles ohne Storyteller, z. B. ein Model hat selbst etwas online gestellt oder es gibt neuen Content, aus dem ein Skript werden soll.</div>
      <div className="sk-zwei" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,2fr) minmax(0,1fr)', gap: 10 }}>
        <div><span style={label}>Model</span><select value={a.model} onChange={e => setze({ model: e.target.value })} style={eingabe}><option value="">wählen …</option>{models.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
        <div><span style={label}>Was?</span><input value={a.titel} onChange={e => setze({ titel: e.target.value.slice(0, 200) })} placeholder="z. B. Neues Duschvideo (selbst gepostet)" style={eingabe} /></div>
        <div><span style={label}>Art</span><select value={a.art} onChange={e => setze({ art: e.target.value })} style={eingabe}>{ARTEN.map(x => <option key={x.k} value={x.k}>{x.t}</option>)}</select></div>
      </div>
      <div><span style={label}>Hinweis / Titel auf OF / Link (optional)</span><input value={a.notiz} onChange={e => setze({ notiz: e.target.value.slice(0, 500) })} placeholder="z. B. Titel auf OF „Shower time“, als PPV 25 $" style={eingabe} /></div>
      {fehler && <div style={{ fontSize: 12.5, color: ROT }}>{fehler}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button type="button" onClick={onAbbrechen} style={knopf('', false)}>Abbrechen</button>
        <button type="button" disabled={!bereit || arbeitet} onClick={los} style={{ ...knopf(AMB), opacity: bereit ? 1 : 0.5 }}>{arbeitet ? '…' : 'Auftrag geben + Telegram'}</button>
      </div>
    </div>
  )
}

function Builder({ liste, wer, neuLaden, onZahl, istAdmin, models = [] }) {
  const [stups, setStups] = useState('')
  const [auftragAuf, setAuftragAuf] = useState(false)
  const [videos, setVideos] = useState(null)
  const [alleFertig, setAlleFertig] = useState(false)
  const [arbeitet, setArbeitet] = useState(null)
  const [fehler, setFehler] = useState('')
  const ladeVideos = useCallback(async () => { const r = await builderVideosLaden(); setVideos(r.liste) }, [])
  useEffect(() => { ladeVideos() }, [ladeVideos])

  const eintraege = useMemo(() => {
    const sk = liste.filter(s => ['hochgeladen', 'gebaut'].includes(s.status)).map(s => ({
      key: 's' + s.id, quelle: 'skript', herkunft: s.quelle, model: s.model_name, titel: s.titel, offen: s.status === 'hochgeladen',
      zeit: s.status === 'gebaut' ? s.gebaut_am : s.hochgeladen_am, von: s.gebaut_von, s,
      unter: [s.of_titel ? `„${s.of_titel}“` : null, s.notiz_builder ? `Notiz: ${s.notiz_builder}` : null].filter(Boolean).join(' · '),
    }))
    const vi = (videos || []).map(v => ({
      key: 'v' + v.id, quelle: 'video', model: v.model_name, titel: v.title, offen: !v.erledigt_am,
      zeit: v.erledigt_am || v.created_at, von: v.erledigt_von, v,
      unter: ['selbst eingetragen', v.release_date ? `VÖ ${datumKurz(v.release_date)}` : null, v.description ? String(v.description).slice(0, 120) : null].filter(Boolean).join(' · '),
    }))
    return [...sk, ...vi].sort((a, b) => String(b.zeit || '').localeCompare(String(a.zeit || '')))
  }, [liste, videos])
  const offen = eintraege.filter(e => e.offen)
  const fertig = eintraege.filter(e => !e.offen)
  useEffect(() => { onZahl?.(offen.length) }, [offen.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const umschalten = async (e, an) => {
    setFehler(''); setArbeitet(e.key)
    const { error } = e.quelle === 'skript' ? await alsGebaut(e.s, an) : await videoErledigt(e.v, wer, an)
    setArbeitet(null)
    if (error) { setFehler(error.message); return }
    if (e.quelle === 'skript') neuLaden(); else ladeVideos()
  }
  const anstupsen = async (auswahl) => {
    if (!auswahl.length) return
    const notiz = window.prompt(auswahl.length === 1 ? `Script Builder Bescheid geben: „${auswahl[0].titel}“ (${auswahl[0].model})\n\nOptional noch ein Satz dazu:` : `Script Builder Bescheid geben (${auswahl.length} offen).\n\nOptional noch ein Satz dazu:`, '')
    if (notiz === null) return
    setStups('…')
    const r = await builderAnstupsen(auswahl, notiz, wer)
    setStups(r.ziele ? `✓ Telegram an ${r.gesendet} von ${r.ziele} Script Builder${r.ziele === 1 ? '' : 'n'} raus.` : '⚠ Kein Script Builder mit Telegram-ID gefunden (Team & Rechte).')
    setTimeout(() => setStups(''), 7000)
  }
  const zeile = (e) => (
    <div key={e.key} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '11px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap', opacity: e.offen ? 1 : 0.65 }}>
      <span style={{ fontWeight: 800, color: P, fontSize: 13, minWidth: 64 }}>{e.model}</span>
      <span style={{ flex: 1, minWidth: 160, fontSize: 13.5, color: 'var(--text-primary)' }}>{e.titel}
        {e.unter && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)' }}>{e.unter}</span>}
        {e.quelle === 'skript' && e.offen && schritteSauber(e.s.schritte).length > 0 && (
          <details style={{ marginTop: 6 }}><summary style={{ fontSize: 12, color: C, cursor: 'pointer' }}>Schritte ansehen</summary><div style={{ marginTop: 6 }}><SchritteAnzeige schritte={e.s.schritte} /></div></details>
        )}
      </span>
      {(() => {
        const qu = e.quelle === 'video' ? { t: 'Model-Video', f: '#3b82f6' } : (QUELLE[e.herkunft] || QUELLE.storyteller)
        return <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 6, background: qu.f + '33', color: qu.f }}>{qu.t}</span>
      })()}
      {e.offen && istAdmin && <button type="button" title="Script Builder per Telegram Bescheid geben" onClick={() => anstupsen([e])} style={{ ...knopf('', false), padding: '9px 10px' }}>📣</button>}
      {e.offen
        ? <button type="button" disabled={arbeitet === e.key} onClick={() => umschalten(e, true)} style={knopf(C)}>{arbeitet === e.key ? '…' : '🧩 In CH gebaut'}</button>
        : <span style={{ fontSize: 11.5, color: G, display: 'flex', gap: 8, alignItems: 'center' }}>✓ {e.von || ''} · {vorZeit(e.zeit)}
            <button type="button" onClick={() => umschalten(e, false)} title="Wieder offen" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, textDecoration: 'underline', fontFamily: 'inherit', padding: 0 }}>rückgängig</button></span>}
    </div>
  )
  return (
    <>
    {istAdmin && (auftragAuf
      ? <BuilderAuftragFormular models={models} wer={wer} onAbbrechen={() => setAuftragAuf(false)} onFertig={(info) => { setAuftragAuf(false); setStups('✓ Auftrag gegeben. ' + (info || '')); setTimeout(() => setStups(''), 7000); neuLaden() }} />
      : <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}><button type="button" onClick={() => setAuftragAuf(true)} style={knopf(AMB)}>📋 Auftrag an Script Builder</button></div>)}
    <div style={{ ...card, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <b style={{ flex: 1, fontSize: 15, color: 'var(--text-primary)' }}>Zu skripten in CreatorHero</b>
        <span style={pill(offen.length ? AMB : G)}>{offen.length ? `${offen.length} offen` : 'alles erledigt'}</span>
        {istAdmin && offen.length > 0 && <button type="button" onClick={() => anstupsen(offen)} style={{ ...knopf('', false), padding: '6px 11px', fontSize: 12.5 }}>📣 Bescheid geben</button>}
      </div>
      {stups && <div style={{ fontSize: 12.5, fontWeight: 700, color: stups.startsWith('⚠') ? ROT : G, marginBottom: 4 }}>{stups}</div>}
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Hochgeladene Skripte und Videos, die Models selbst eintragen. Bei Neuem kommt eine Telegram-Nachricht.</div>
      {fehler && <div style={{ fontSize: 12.5, color: ROT, margin: '6px 0' }}>{fehler}</div>}
      {videos === null && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '10px 0' }}>Lädt …</div>}
      {videos !== null && !offen.length && <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '10px 0', borderTop: '1px solid var(--border)' }}>Gerade nichts zu tun. 🎉</div>}
      {offen.map(zeile)}
      {fertig.length > 0 && (
        <button type="button" onClick={() => setAlleFertig(v => !v)} style={{ alignSelf: 'flex-start', marginTop: 10, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit', padding: 0 }}>
          {alleFertig ? '▾ Erledigte ausblenden' : `▸ ${fertig.length} erledigt anzeigen`}
        </button>
      )}
      {alleFertig && fertig.slice(0, 40).map(zeile)}
    </div>
    </>
  )
}

// ── Hauptbereich ───────────────────────────────────────────────────────────
export default function SkripteBereich({ userDisplayName, istAdmin = false, storyteller = false, builder = false }) {
  const reiterListe = [
    ...(istAdmin ? [{ k: 'freigabe', t: '🔓 Freigabe', kurz: 'Freigabe' }] : []),
    ...(istAdmin || storyteller ? [{ k: 'schreiben', t: '✍️ Schreiben', kurz: 'Schreiben' }] : []),
    ...(istAdmin || builder ? [{ k: 'builder', t: '🧩 Script Builder', kurz: 'Builder' }] : []),
    ...(istAdmin || storyteller ? [{ k: 'bibliothek', t: '📚 Bibliothek', kurz: 'Bibliothek' }] : []),
  ]
  // v5.28.0: Telegram-Links (?tab=skripte&ziel=builder) öffnen gleich den richtigen Reiter
  const [reiter, setReiter] = useState(() => {
    const z = nimmStartZiel('skripte')
    return reiterListe.some(r => r.k === z) ? z : (reiterListe[0]?.k || 'schreiben')
  })
  const [liste, setListe] = useState(null)
  const [fehlt, setFehlt] = useState(false)
  const [models, setModels] = useState([])
  const [builderZahl, setBuilderZahl] = useState(0)
  const [vorlagen, setVorlagen] = useState([])
  const laden = useCallback(async () => {
    const r = await skripteLaden()
    setFehlt(r.fehlt); setListe(r.liste)
    if (istAdmin || storyteller) { const v = await vorlagenLaden(); setVorlagen(v.liste) }
  }, [istAdmin, storyteller])
  useEffect(() => { laden() }, [laden])
  useEffect(() => { if (istAdmin || storyteller) modelsLaden().then(setModels) }, [istAdmin, storyteller])

  if (fehlt) return <div style={{ ...card, color: 'var(--text-muted)', fontSize: 13 }}>Skripte sind noch nicht eingerichtet: einmal <code>sql/storyteller-script-builder.sql</code> in Supabase ausführen.</div>
  if (!liste) return <div style={{ ...card, color: 'var(--text-muted)', fontSize: 13 }}>Lädt …</div>
  if (!reiterListe.length) return <div style={{ ...card, color: 'var(--text-muted)', fontSize: 13 }}>Für Skripte brauchst du die Rolle Storyteller oder Script Builder.</div>
  const zahlFreigabe = liste.filter(s => s.status === 'freigabe').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {reiterListe.length > 1 && (
        <div className="ms-reiter sk-reiter" role="tablist">
          {reiterListe.map(r => {
            const badge = r.k === 'freigabe' ? zahlFreigabe : r.k === 'builder' ? builderZahl : r.k === 'schreiben' ? liste.filter(s => s.status === 'auftrag' && s.erstellt_von === userDisplayName).length : 0
            return (
              <button key={r.k} type="button" className={'ms-knopf' + (reiter === r.k ? ' an' : '')} onClick={() => setReiter(r.k)}>
                <span className="ms-text"><span className="sk-lang">{r.t}</span><span className="sk-kurz">{r.kurz}</span></span>{badge > 0 && <span className="ms-badge">{badge}</span>}
              </button>
            )
          })}
        </div>
      )}
      {reiter === 'freigabe' && <Freigabe liste={liste} models={models} wer={userDisplayName} neuLaden={laden} vorlagen={vorlagen} />}
      {reiter === 'bibliothek' && <SkriptBibliothek liste={liste} vorlagen={vorlagen} models={models} wer={userDisplayName} istAdmin={istAdmin} neuLaden={laden} />}
      {reiter === 'schreiben' && <Schreiben liste={liste} models={models} wer={userDisplayName} istAdmin={istAdmin} neuLaden={laden} />}
      {/* Builder bleibt geladen (versteckt), damit die Zahl am Reiter stimmt */}
      {(istAdmin || builder) && <div style={{ display: reiter === 'builder' ? 'block' : 'none' }}><Builder liste={liste} wer={userDisplayName} neuLaden={laden} onZahl={setBuilderZahl} istAdmin={istAdmin} models={models} /></div>}
    </div>
  )
}
