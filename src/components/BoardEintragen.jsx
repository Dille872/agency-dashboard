import React, { useState } from 'react'
import { CalendarPlus, CheckSquare, X } from 'lucide-react'
import { datumInZone, BERLIN } from '../zeit'
import { ARTEN_KURZ, kalenderEintragen, todoEintragen } from '../eintragen'

// ── Aus dem Board eintragen (v4.74.0) ───────────────────────────────────────
//
// Ein Fenster, zwei Wege: Kalender oder ToDo. Titel, Notiz und Personen kommen
// aus dem, was auf dem Board ausgewählt war (Notiz-Text, Person-Karte, Rahmen
// mit Leuten). Gespeichert wird direkt — der Kalender muss nicht offen sein.
// Die Logik liegt in src/eintragen.js.

const ERINNERUNGEN = [
  { min: null, label: 'keine' }, { min: 30, label: '30 Min vorher' },
  { min: 60, label: '1 Std vorher' }, { min: 1440, label: '1 Tag vorher' },
]

const feld = {
  background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 8,
  color: 'var(--text-primary)', padding: '8px 9px', fontFamily: 'inherit', fontSize: 13, width: '100%', boxSizing: 'border-box',
}
const label = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }

export default function BoardEintragen({ vorschlag = {}, team, ich, start = 'kalender', onFertig, onAbbrechen }) {
  const [wohin, setWohin] = useState(start)
  const [titel, setTitel] = useState(vorschlag.titel || '')
  const [notiz, setNotiz] = useState(vorschlag.notiz || '')
  const [art, setArt] = useState('aufgabe')
  const [tag, setTag] = useState(() => datumInZone(new Date(), BERLIN).tag)
  const [von, setVon] = useState('18:00')
  const [bis, setBis] = useState('')
  const [personen, setPersonen] = useState(vorschlag.personen || [])
  const [alle, setAlle] = useState(false)
  const [erinnern, setErinnern] = useState(60)
  const [telegram, setTelegram] = useState(true)
  const [an, setAn] = useState(vorschlag.personen?.length === 1 ? vorschlag.personen[0] : '')
  const [speichert, setSpeichert] = useState(false)
  const [fehler, setFehler] = useState(null)

  const alleNamen = [...new Set([...(team?.leitung || []), ...(team?.chatter || [])].map(p => p.name).filter(Boolean))]
  const umschalten = (n) => setPersonen(p => p.includes(n) ? p.filter(x => x !== n) : [...p, n])

  const kannSpeichern = titel.trim() && (wohin === 'todo' || (tag && von && (alle || personen.length)))

  const speichern = async () => {
    if (!kannSpeichern || speichert) return
    setSpeichert(true); setFehler(null)
    try {
      if (wohin === 'kalender') {
        const r = await kalenderEintragen({ titel, art, tag, von, bis, notiz, fuer: personen, fuerAlle: alle, erinnernMin: erinnern, telegram, alleNamen }, ich)
        onFertig({ wohin, titel: titel.trim(), beginn: r.eintrag.beginn, telegram: r.telegram })
      } else {
        const r = await todoEintragen({ titel, beschreibung: notiz, an, telegram }, ich)
        onFertig({ wohin, titel: titel.trim(), an: an.trim() || null, telegram: r.telegram })
      }
    } catch (e) {
      setFehler(/team_kalender/.test(e.message || '') ? 'Kalender-Tabelle nicht erreichbar: ' + e.message : 'Nicht gespeichert: ' + e.message)
      setSpeichert(false)
    }
  }

  const reiter = (key, Icon, text) => (
    <button type="button" className="board-text-knopf" onClick={() => setWohin(key)} aria-pressed={wohin === key}
      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, background: wohin === key ? '#7c3aed' : 'transparent', color: wohin === key ? '#fff' : 'var(--text-secondary)' }}>
      <Icon size={15} /> {text}
    </button>
  )

  return (
    <div onClick={onAbbrechen} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Eintragen"
        style={{ width: 'min(460px, 100%)', maxHeight: '90vh', overflowY: 'auto', background: 'var(--bg-card)', border: '1px solid var(--border-bright)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>Eintragen</span>
          <button type="button" onClick={onAbbrechen} aria-label="Schließen" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex' }}><X size={16} /></button>
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, padding: 3 }}>
          {reiter('kalender', CalendarPlus, 'Kalender')}
          {reiter('todo', CheckSquare, 'ToDo')}
        </div>

        <label style={label}>
          {wohin === 'kalender' ? 'Titel' : 'Aufgabe'}
          <input autoFocus value={titel} onChange={e => setTitel(e.target.value.slice(0, 200))} style={feld} />
        </label>

        {wohin === 'kalender' ? (<>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ARTEN_KURZ.map(a => (
              <button key={a.key} type="button" className="board-text-knopf" onClick={() => setArt(a.key)} aria-pressed={art === a.key}
                style={{ padding: '5px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${art === a.key ? a.farbe : 'var(--border)'}`, background: art === a.key ? `${a.farbe}22` : 'transparent', color: art === a.key ? a.farbe : 'var(--text-secondary)' }}>
                {a.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 8 }} className="eintragen-zeit">
            <label style={label}>Tag<input type="date" value={tag} onChange={e => setTag(e.target.value)} style={feld} /></label>
            <label style={label}>Von (DE)<input type="time" value={von} onChange={e => setVon(e.target.value)} style={feld} /></label>
            <label style={label}>Bis<input type="time" value={bis} onChange={e => setBis(e.target.value)} style={feld} /></label>
          </div>
          <div style={label}>
            Für wen
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', maxHeight: 110, overflowY: 'auto' }}>
              <button type="button" className="board-text-knopf" onClick={() => setAlle(a => !a)} aria-pressed={alle}
                style={{ padding: '4px 9px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${alle ? '#7c3aed' : 'var(--border)'}`, background: alle ? 'rgba(124,58,237,0.18)' : 'transparent', color: alle ? 'var(--ton-lila)' : 'var(--text-secondary)' }}>
                Ganzes Team
              </button>
              {!alle && alleNamen.map(n => (
                <button key={n} type="button" className="board-text-knopf" onClick={() => umschalten(n)} aria-pressed={personen.includes(n)}
                  style={{ padding: '4px 9px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${personen.includes(n) ? '#0891b2' : 'var(--border)'}`, background: personen.includes(n) ? 'rgba(8,145,178,0.18)' : 'transparent', color: personen.includes(n) ? 'var(--ton-cyan)' : 'var(--text-secondary)' }}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <label style={label}>
            Erinnerung
            <select value={erinnern ?? ''} onChange={e => setErinnern(e.target.value === '' ? null : Number(e.target.value))} style={feld}>
              {ERINNERUNGEN.map(r => <option key={r.label} value={r.min ?? ''}>{r.label}</option>)}
            </select>
          </label>
        </>) : (
          <label style={label}>
            Für wen (leer = an die Admins)
            <input list="eintragen-namen" value={an} onChange={e => setAn(e.target.value)} style={feld} />
            <datalist id="eintragen-namen">{alleNamen.map(n => <option key={n} value={n} />)}</datalist>
          </label>
        )}

        <label style={label}>
          Notiz
          <textarea value={notiz} onChange={e => setNotiz(e.target.value)} rows={2} style={{ ...feld, resize: 'vertical' }} />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-primary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={telegram} onChange={e => setTelegram(e.target.checked)} style={{ width: 16, height: 16 }} />
          Per Telegram Bescheid geben
        </label>

        {fehler && <div style={{ fontSize: 12, color: 'var(--ton-rot)' }}>{fehler}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="board-text-knopf" onClick={onAbbrechen} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 14px', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>Abbrechen</button>
          <button type="button" className="board-text-knopf" onClick={speichern} disabled={!kannSpeichern || speichert}
            style={{ background: '#7c3aed', border: 'none', borderRadius: 9, padding: '8px 14px', color: '#fff', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, opacity: kannSpeichern && !speichert ? 1 : 0.5 }}>
            {speichert ? 'Speichert …' : wohin === 'kalender' ? 'In den Kalender' : 'ToDo anlegen'}
          </button>
        </div>
      </div>
    </div>
  )
}
