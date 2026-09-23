import React, { useState } from 'react'
import { supabase } from '../supabase'
import { heuteBerlin } from '../utils'
import { plusTage, montagVon } from '../jetzt'
import { BERLIN, zeitIn, wandzeitZuDatum, ortAus } from '../zeit'

// ── Model-Portal: Kalender im neuen Look (v4.78.0) ──────────────────────────
//
// Christoph: Der Kalender bleibt, er soll nur übersichtlicher werden. Oben ein
// Wochenstreifen mit Punkten an den Tagen, an denen etwas ansteht (antippen =
// nur diesen Tag zeigen), darunter Überfällig / Heute / Demnächst als Karten.
// Neu anlegen über „+ Neu" statt eines Formulars, das immer über der Liste steht.
//
// Dieselbe Tabelle wie vorher (model_calendar), dieselben Felder, dieselbe
// Telegram-Erinnerung (reminder_hours / reminder_sent). Urlaub gehört ins Board
// (Reiseplan) — alte Reise-Einträge im Kalender werden weiter angezeigt.
//
// v4.97.0: Bei der Art „Termin" gibt es zusätzlich eine Bis-Uhrzeit und das
// Häkchen „In der Zeit bin ich nicht erreichbar" (sql/model-termin-
// erreichbar.sql). Ist es gesetzt, steht bei den Chattern auf der Model-Karte
// „⛔ Termin bis 18:00", solange der Termin läuft — damit in dem Fenster kein
// Custom zugesagt wird. Eintragen kann das nur das Model selbst (Wunsch
// Christoph), im Admin gibt es dafür bewusst keinen Knopf.

export const KAL_ARTEN = [
  { key: 'aufgabe', label: 'Aufgabe', color: '#a78bfa' },
  { key: 'content', label: 'Content', color: '#f59e0b' },
  { key: 'termin', label: 'Termin', color: '#ec4899' },
  { key: 'reise', label: 'Reise', color: '#06b6d4' },   // nur noch für alte Einträge
]
const ERINNERUNG = [
  { v: '', l: 'Keine' }, { v: '1', l: '1 Std vorher' }, { v: '3', l: '3 Std vorher' },
  { v: '12', l: '12 Std vorher' }, { v: '24', l: '1 Tag vorher' }, { v: '48', l: '2 Tage vorher' },
]
const ORANGE = '#f59e0b'
const WT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

const feld = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '10px 11px', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }
const lbl = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, display: 'block' }
const gruppe = { fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.07em', margin: '6px 2px 0' }
const tagLang = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })

function NeuFenster({ vorTag, displayName, zeitzone, onZu, onGespeichert }) {
  const [titel, setTitel] = useState('')
  const [art, setArt] = useState('aufgabe')
  const [tag, setTag] = useState(vorTag || heuteBerlin())
  const [zeit, setZeit] = useState('')
  const [bis, setBis] = useState('')
  const [nichtDa, setNichtDa] = useState(false)
  const [erinnern, setErinnern] = useState('')
  const [notiz, setNotiz] = useState('')
  const [speichert, setSpeichert] = useState(false)
  const ok = titel.trim() && tag
  const istTermin = art === 'termin'

  // Zeiten sind deutsche Zeit (wie im ganzen Dashboard). Sitzt sie gerade
  // woanders, steht darunter, was das in ihrer Zeit heißt — sonst trägt sie
  // „15:00" ein und meint ihre eigene Uhr.
  const andereZone = zeitzone && zeitzone !== BERLIN
  const inIhrerZeit = (() => {
    if (!andereZone || !zeit) return null
    const a = zeitIn(wandzeitZuDatum(tag, zeit, BERLIN), zeitzone)
    const b = bis ? zeitIn(wandzeitZuDatum(tag, bis, BERLIN), zeitzone) : null
    return `${a}${b ? `–${b}` : ''} bei dir in ${ortAus(zeitzone)}`
  })()

  const speichern = async () => {
    if (!ok || speichert) return
    setSpeichert(true)
    const { error } = await supabase.from('model_calendar').insert({
      model_name: displayName, title: titel.trim(), description: notiz.trim() || null,
      due_date: tag, due_time: zeit || null, category: art,
      end_time: istTermin && zeit && bis ? bis : null,
      nicht_erreichbar: istTermin && nichtDa,
      reminder_hours: erinnern ? parseInt(erinnern) : null, reminder_sent: false,
    })
    setSpeichert(false)
    if (error) {
      // Solange sql/model-termin-erreichbar.sql nicht gelaufen ist, fehlen die
      // beiden Spalten. Dann wenigstens den Termin selbst speichern.
      if (/end_time|nicht_erreichbar/.test(error.message || '')) {
        const { error: e2 } = await supabase.from('model_calendar').insert({
          model_name: displayName, title: titel.trim(), description: notiz.trim() || null,
          due_date: tag, due_time: zeit || null, category: art,
          reminder_hours: erinnern ? parseInt(erinnern) : null, reminder_sent: false,
        })
        if (!e2) { onGespeichert(); onZu(); return }
      }
      alert('Nicht gespeichert: ' + error.message); return
    }
    onGespeichert(); onZu()
  }

  return (
    <div className="steckbrief-huelle" onClick={onZu} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div className="steckbrief-fenster" onClick={e => e.stopPropagation()} role="dialog" aria-label="Neuer Eintrag" style={{
        width: 'min(480px, 100%)', maxHeight: '92vh', overflowY: 'auto', boxSizing: 'border-box', background: 'var(--bg-card)',
        border: '1px solid var(--border)', borderRadius: '22px 22px 0 0', padding: '14px 18px 22px', display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 19, fontWeight: 700, color: 'var(--text-primary)' }}>🗓 Neuer Eintrag</span>
          <button type="button" onClick={onZu} aria-label="Schließen" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        <label><span style={lbl}>Was?</span><input autoFocus value={titel} onChange={e => setTitel(e.target.value.slice(0, 120))} placeholder="z. B. Custom für @maxi fertig machen" style={feld} /></label>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {KAL_ARTEN.filter(a => a.key !== 'reise').map(a => (
            <button key={a.key} type="button" className="chip-btn" onClick={() => setArt(a.key)} aria-pressed={art === a.key} style={{
              fontSize: 13, padding: '8px 13px', borderRadius: 20, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              background: art === a.key ? a.color + '24' : 'transparent', border: `1px solid ${art === a.key ? a.color : 'var(--border)'}`,
              color: art === a.key ? a.color : 'var(--text-secondary)',
            }}>{a.label}</button>
          ))}
        </div>
        <div className="raster-2" style={{ display: 'grid', gridTemplateColumns: istTermin ? '1.2fr 1fr 1fr' : '1fr 1fr', gap: 9 }}>
          <label><span style={lbl}>Tag</span><input type="date" value={tag} onChange={e => setTag(e.target.value)} style={feld} /></label>
          <label><span style={lbl}>{istTermin ? 'Von' : 'Uhrzeit'}</span><input type="time" value={zeit} onChange={e => setZeit(e.target.value)} style={feld} /></label>
          {istTermin && <label><span style={lbl}>Bis</span><input type="time" value={bis} onChange={e => setBis(e.target.value)} style={feld} /></label>}
        </div>
        {inIhrerZeit && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: -6 }}>Zeiten in deutscher Zeit · {inIhrerZeit}</div>}

        {/* v4.97.0: Das Häkchen, das die Chatter sehen. Nur bei „Termin" — bei
            einer Aufgabe wäre „nicht erreichbar" sinnlos. */}
        {istTermin && (
          <button type="button" className="chip-btn" onClick={() => setNichtDa(v => !v)} aria-pressed={nichtDa} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left', width: '100%', padding: '12px 13px', borderRadius: 14,
            cursor: 'pointer', fontFamily: 'inherit', background: nichtDa ? 'rgba(239,68,68,0.12)' : 'var(--bg-card2)',
            border: `1px solid ${nichtDa ? '#ef4444' : 'var(--border)'}`,
          }}>
            <span style={{
              width: 21, height: 21, borderRadius: 6, flexShrink: 0, marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 800, background: nichtDa ? '#ef4444' : 'transparent', color: '#fff',
              border: `1.5px solid ${nichtDa ? '#ef4444' : 'var(--border)'}`,
            }}>{nichtDa ? '✓' : ''}</span>
            <span>
              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>In der Zeit bin ich nicht erreichbar</span>
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2, fontWeight: 400 }}>
                Deine Chatter sehen dann „⛔ Termin bis {bis ? bis.slice(0, 5) : '…'}" und sagen in der Zeit keine Customs zu.
              </span>
            </span>
          </button>
        )}
        <label><span style={lbl}>Erinnerung per Telegram</span>
          <select value={erinnern} onChange={e => setErinnern(e.target.value)} style={feld}>
            {ERINNERUNG.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
          </select>
        </label>
        <label><span style={lbl}>Notiz <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>(optional)</span></span>
          <input value={notiz} onChange={e => setNotiz(e.target.value.slice(0, 300))} style={feld} /></label>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center' }}>Urlaub trägst du im Board ein — dann sehen es auch deine Chatter.</div>
        <button type="button" className="gross-btn" onClick={speichern} disabled={!ok || speichert} style={{
          background: ORANGE, color: '#1a1205', border: 'none', borderRadius: 14, padding: 14, fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', opacity: ok && !speichert ? 1 : 0.5,
        }}>{speichert ? 'Speichert …' : 'Speichern'}</button>
      </div>
    </div>
  )
}

function Karte({ item, heute, onLoeschen }) {
  const art = KAL_ARTEN.find(a => a.key === item.category) || KAL_ARTEN[0]
  const drueber = item.due_date < heute
  const farbe = drueber ? '#ef4444' : art.color
  return (
    <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '11px 12px', borderRadius: 13, background: 'var(--bg-card)', border: '1px solid var(--border)', borderLeft: `4px solid ${farbe}` }}>
      <div style={{ minWidth: 52, flexShrink: 0 }}>
        <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: drueber ? '#ef4444' : 'var(--text-primary)' }}>
          {item.due_date === heute ? (item.due_time ? item.due_time.slice(0, 5) : 'Heute') : tagLang(item.due_date).replace(',', '')}
        </div>
        {item.due_date !== heute && item.due_time && <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>{item.due_time.slice(0, 5)}</div>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: drueber ? '#ef4444' : 'var(--text-primary)' }}>{item.title}</div>
        {item.description && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{item.description}</div>}
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>
          <span style={{ color: art.color, fontWeight: 600 }}>{art.label}</span>
          {item.due_time && item.end_time && <span> · {String(item.due_time).slice(0, 5)}–{String(item.end_time).slice(0, 5)}</span>}
          {drueber && <span style={{ color: '#ef4444' }}> · überfällig</span>}
          {item.reminder_hours && <span> · 🔔 {item.reminder_hours} h vorher</span>}
        </div>
        {/* v4.97.0: was die Chatter sehen */}
        {item.nicht_erreichbar && (
          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#ef4444', marginTop: 4 }}>
            ⛔ Deine Chatter sehen: nicht erreichbar{item.end_time ? ` bis ${String(item.end_time).slice(0, 5)}` : ''}
          </div>
        )}
      </div>
      <button type="button" onClick={() => { if (window.confirm(`„${item.title}" löschen?`)) onLoeschen(item) }} aria-label="Löschen"
        style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 15, padding: '0 2px' }}>✕</button>
    </div>
  )
}

export default function ModelKalender({ displayName, items, onGeaendert, zeitzone }) {
  const heute = heuteBerlin()
  const [montag, setMontag] = useState(() => montagVon(heute))
  const [tagWahl, setTagWahl] = useState(null)
  const [neu, setNeu] = useState(false)
  const [alteZeigen, setAlteZeigen] = useState(false)

  const loeschen = async (item) => {
    const { error } = await supabase.from('model_calendar').delete().eq('id', item.id)
    if (error) { alert('Nicht gelöscht: ' + error.message); return }
    onGeaendert()
  }

  const sortiert = [...items].sort((a, b) => a.due_date.localeCompare(b.due_date) || String(a.due_time || '').localeCompare(String(b.due_time || '')))
  const tage = Array.from({ length: 7 }, (_, i) => plusTage(montag, i))
  const monat = new Date(montag + 'T12:00:00').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })

  // Überfällig = gestern oder früher, aber nicht älter als 14 Tage — alles davor
  // unter „Vergangen", sonst füllt sich die Liste mit Altlasten.
  const grenze = plusTage(heute, -14)
  const gruppen = tagWahl
    ? [{ titel: tagLang(tagWahl).toUpperCase(), liste: sortiert.filter(i => i.due_date === tagWahl) }]
    : [
        { titel: 'ÜBERFÄLLIG', liste: sortiert.filter(i => i.due_date < heute && i.due_date >= grenze) },
        { titel: `HEUTE · ${tagLang(heute).toUpperCase()}`, liste: sortiert.filter(i => i.due_date === heute) },
        { titel: 'DEMNÄCHST', liste: sortiert.filter(i => i.due_date > heute) },
      ]
  const vergangen = sortiert.filter(i => i.due_date < grenze).reverse()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={() => setMontag(plusTage(montag, -7))} aria-label="Woche zurück" style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>‹</button>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', minWidth: 110, textAlign: 'center' }}>{monat}</span>
          <button type="button" onClick={() => setMontag(plusTage(montag, 7))} aria-label="Woche vor" style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>›</button>
        </div>
        <button type="button" onClick={() => setNeu(true)} style={{ background: ORANGE, color: '#1a1205', border: 'none', borderRadius: 12, padding: '9px 15px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>+ Neu</button>
      </div>

      {/* Wochenstreifen */}
      <div className="raster-7" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 5 }}>
        {tage.map((t, i) => {
          const anTag = items.filter(x => x.due_date === t)
          const gewaehlt = tagWahl === t
          const istHeute = t === heute
          return (
            <button key={t} type="button" onClick={() => setTagWahl(gewaehlt ? null : t)} aria-pressed={gewaehlt} style={{
              padding: '8px 0 6px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center',
              background: gewaehlt ? ORANGE : 'var(--bg-card)', color: gewaehlt ? '#1a1205' : 'var(--text-primary)',
              border: `1px solid ${gewaehlt ? ORANGE : istHeute ? ORANGE + '88' : 'var(--border)'}`,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.75 }}>{WT[i]}</div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{Number(t.slice(8, 10))}</div>
              <div style={{ height: 6, display: 'flex', justifyContent: 'center', gap: 2, marginTop: 2 }}>
                {anTag.slice(0, 3).map(x => {
                  const f = (KAL_ARTEN.find(a => a.key === x.category) || KAL_ARTEN[0]).color
                  return <span key={x.id} style={{ width: 5, height: 5, borderRadius: 3, background: gewaehlt ? '#1a1205' : f }} />
                })}
              </div>
            </button>
          )
        })}
      </div>
      {tagWahl && <button type="button" onClick={() => setTagWahl(null)} style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>← alle Einträge</button>}

      {gruppen.map(g => g.liste.length > 0 && (
        <div key={g.titel} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ ...gruppe, color: g.titel === 'ÜBERFÄLLIG' ? '#ef4444' : gruppe.color }}>{g.titel}</div>
          {g.liste.map(item => <Karte key={item.id} item={item} heute={heute} onLoeschen={loeschen} />)}
        </div>
      ))}
      {gruppen.every(g => g.liste.length === 0) && (
        <div style={{ padding: '22px 14px', borderRadius: 14, background: 'var(--bg-card)', border: '1px solid var(--border)', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
          {tagWahl ? 'An diesem Tag steht nichts an.' : 'Nichts geplant.'}{' '}
          <button type="button" onClick={() => setNeu(true)} style={{ background: 'transparent', border: 'none', color: ORANGE, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, padding: 0 }}>Eintrag anlegen</button>
        </div>
      )}

      {!tagWahl && vergangen.length > 0 && (
        <div>
          <button type="button" onClick={() => setAlteZeigen(v => !v)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
            {alteZeigen ? 'Vergangene ausblenden' : `${vergangen.length} vergangene anzeigen`}
          </button>
          {alteZeigen && <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, opacity: 0.7 }}>
            {vergangen.map(item => <Karte key={item.id} item={item} heute={heute} onLoeschen={loeschen} />)}
          </div>}
        </div>
      )}

      <div style={{ padding: 12, borderRadius: 13, border: '1px dashed var(--border)', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
        Urlaub trägst du im Board ein — dann sehen es auch deine Chatter.
      </div>

      {neu && <NeuFenster vorTag={tagWahl} displayName={displayName} zeitzone={zeitzone} onZu={() => setNeu(false)} onGespeichert={onGeaendert} />}
    </div>
  )
}
