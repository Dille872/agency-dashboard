import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { useGelesen } from '../gelesen'
import { heuteBerlin } from '../utils'

// ── Model-Portal: der neue Steckbrief oben im Board (v4.77.0) ───────────────
//
// Wunsch Christoph: Das Board wird von den Models selten genutzt — also so
// einfach wie möglich, am Handy gut bedienbar, und optisch so, dass man es
// gern aufmacht. Statt sieben leerer Listen:
//
//   Stimmt noch alles?   einmal im Monat, "Ja, passt" (gelesen_stand pro Login)
//   Urlaub & Reisen      ein Fenster: wohin, von–bis, Chips geht / geht nicht
//   Was ich anbiete      Kacheln antippen (service_flags, wie bisher)
//   Preise               Leistung + ab-Preis (model_board 'preise')
//   No Gos               zum Antippen aus einer Liste, plus eigene ('nogos')
//
// Es bleiben dieselben Tabellen und Kategorien wie vorher. Bestehende
// Einträge werden NICHT umgeschrieben — alte, lange Preis-Sätze stehen weiter
// da und lassen sich hier bearbeiten. Jede Änderung landet wie bisher in
// model_board_activity, damit die Chatter sie als "Neu" sehen.
//
// Regeln, Pakete, Einschränkungen und Termine stehen darunter unverändert
// unter "Weitere Angaben" (ModelPortal.jsx).

export const ANGEBOT = [
  { key: 'audios', label: 'Audios', icon: '🎙' },
  { key: 'video_chat', label: 'Video-Call', icon: '📹' },
  { key: 'telefonieren', label: 'Telefon', icon: '📞' },
  { key: 'custom', label: 'Custom', icon: '🎬' },
  { key: 'sexting', label: 'Sexting', icon: '💬' },
  { key: 'bewertungen', label: 'Bewertungen', icon: '⭐' },
]
// Die ersten vier gab es schon vorher — die zählen für "Angebot vollständig"
const ANGEBOT_ALT = ['bewertungen', 'audios', 'video_chat', 'telefonieren']

const NOGO_VORSCHLAEGE = ['Treffen', 'Gesicht zeigen', 'Echter Name', 'Anal', 'Füße', 'Dildo', 'Rollenspiele', 'Andere Personen', 'Toilette', 'Schmerzen']
const REISE_VORSCHLAEGE = ['Pool & Strand', 'Bikini', 'Outdoor', 'Audios', 'Sexting', 'Neue Videos', 'Video-Call', 'Custom', 'Studio-Sets']

const ORANGE = '#f59e0b'
const lc = (s) => String(s || '').trim().toLowerCase()
const liste = (t) => String(t || '').split(/[,;\n]+/).map(x => x.trim()).filter(Boolean)
const tag = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : ''
const MONAT_MS = 30 * 864e5

const karte = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 15px' }
const kopf = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 10 }
const titel = { fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)' }
const klein = { fontSize: 11, color: 'var(--text-muted)' }
const feld = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '10px 11px', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }
const linkKnopf = (farbe) => ({ background: 'transparent', border: 'none', padding: 0, color: farbe, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' })
const knopf = (farbe, voll = true) => ({ background: voll ? farbe : 'transparent', color: voll ? '#1a1205' : 'var(--text-secondary)', border: voll ? 'none' : '1px solid var(--border)', borderRadius: 11, padding: '10px 14px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' })

// ── Schreiben ──
// Reise-Zusatzfelder (reise_geht …) gibt es erst nach sql/model-reise-und-zeitzone.sql.
// Fehlen sie, wird ohne sie gespeichert statt gar nicht.
async function schreiben({ id, zeile }) {
  const lauf = (z) => id ? supabase.from('model_board').update(z).eq('id', id) : supabase.from('model_board').insert(z)
  let { error } = await lauf(zeile)
  if (error && /reise_/.test(error.message || '')) {
    const ohne = { ...zeile }
    delete ohne.reise_geht; delete ohne.reise_geht_nicht; delete ohne.reise_fans
    ;({ error } = await lauf(ohne))
    if (!error) alert('Gespeichert — aber „Was geht / geht nicht" ist noch nicht freigeschaltet. Bitte dem Team Bescheid geben.')
  }
  if (error) { alert('Nicht gespeichert: ' + error.message); return false }
  return true
}

// ── Urlaub & Reisen: Fenster ──
function ReiseFenster({ reise, onSpeichern, onLoeschen, onZu }) {
  const [wohin, setWohin] = useState(reise?.title || '')
  const [von, setVon] = useState(reise?.date_from || '')
  const [bis, setBis] = useState(reise?.date_to || '')
  const [notiz, setNotiz] = useState(reise?.content || '')
  const [fans, setFans] = useState(reise?.reise_fans || '')
  // Chip-Zustand: 'ja' | 'nein' | undefined — bestehende Werte zuerst
  const [wahl, setWahl] = useState(() => {
    const w = {}
    for (const t of liste(reise?.reise_geht)) w[t] = 'ja'
    for (const t of liste(reise?.reise_geht_nicht)) w[t] = 'nein'
    return w
  })
  const [eigenes, setEigenes] = useState('')
  const [speichert, setSpeichert] = useState(false)

  const chips = [...new Set([...REISE_VORSCHLAEGE, ...Object.keys(wahl)])]
  const tippen = (t) => setWahl(w => {
    const n = { ...w }
    n[t] = w[t] === undefined ? 'ja' : w[t] === 'ja' ? 'nein' : undefined
    if (n[t] === undefined) delete n[t]
    return n
  })
  const dazu = () => {
    const t = eigenes.trim()
    if (!t) return
    setWahl(w => ({ ...w, [t]: 'ja' })); setEigenes('')
  }
  const ok = wohin.trim() && von && (!bis || bis >= von)

  const speichern = async () => {
    if (!ok || speichert) return
    setSpeichert(true)
    const erfolgreich = await onSpeichern({
      title: wohin.trim(), date_from: von, date_to: bis || von, content: notiz.trim() || null,
      reise_geht: Object.keys(wahl).filter(t => wahl[t] === 'ja').join(', ') || null,
      reise_geht_nicht: Object.keys(wahl).filter(t => wahl[t] === 'nein').join(', ') || null,
      reise_fans: fans.trim() || null,
    })
    setSpeichert(false)
    if (erfolgreich) onZu()
  }

  const lbl = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, display: 'block' }
  return (
    <div className="steckbrief-huelle" onClick={onZu} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div className="steckbrief-fenster" onClick={e => e.stopPropagation()} role="dialog" aria-label="Reise eintragen" style={{
        width: 'min(480px, 100%)', maxHeight: '92vh', overflowY: 'auto', boxSizing: 'border-box', background: 'var(--bg-card)',
        border: '1px solid var(--border)', borderRadius: '22px 22px 0 0', padding: '14px 18px 22px', display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 19, fontWeight: 700, color: 'var(--text-primary)' }}>✈ {reise ? 'Reise bearbeiten' : 'Reise eintragen'}</span>
          <button type="button" onClick={onZu} aria-label="Schließen" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        <label><span style={lbl}>Wohin?</span><input autoFocus={!reise} value={wohin} onChange={e => setWohin(e.target.value.slice(0, 80))} placeholder="z. B. Zypern" style={feld} /></label>
        <div className="raster-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
          <label><span style={lbl}>Von</span><input type="date" value={von} onChange={e => setVon(e.target.value)} style={feld} /></label>
          <label><span style={lbl}>Bis</span><input type="date" value={bis} min={von || undefined} onChange={e => setBis(e.target.value)} style={feld} /></label>
        </div>
        <div>
          <span style={lbl}>Was geht während der Reise?</span>
          <div style={{ ...klein, fontSize: 11.5, margin: '-2px 0 9px' }}>1× tippen = geht · 2× = geht nicht · 3× = weg</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {chips.map(t => {
              const w = wahl[t]
              const f = w === 'ja' ? '#10b981' : w === 'nein' ? '#ef4444' : null
              return (
                <button key={t} type="button" className="chip-btn" onClick={() => tippen(t)} style={{
                  fontSize: 13, padding: '8px 12px', borderRadius: 20, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  background: f ? f + '22' : 'transparent', border: `1px solid ${f || 'var(--border)'}`, color: f || 'var(--text-secondary)',
                }}>{w === 'ja' ? '✓ ' : w === 'nein' ? '✕ ' : ''}{t}</button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <input value={eigenes} onChange={e => setEigenes(e.target.value.slice(0, 40))} onKeyDown={e => { if (e.key === 'Enter') dazu() }} placeholder="Eigenes dazu …" style={{ ...feld, padding: '8px 10px', fontSize: 13 }} />
            <button type="button" onClick={dazu} disabled={!eigenes.trim()} style={{ ...knopf(ORANGE, false), padding: '8px 12px', opacity: eigenes.trim() ? 1 : 0.5 }}>+</button>
          </div>
        </div>
        <label><span style={lbl}>Satz für Fans <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>(optional)</span></span>
          <input value={fans} onChange={e => setFans(e.target.value.slice(0, 200))} placeholder="z. B. bin grad im Urlaub ☀️" style={feld} /></label>
        <label><span style={lbl}>Notiz fürs Team <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>(optional)</span></span>
          <input value={notiz} onChange={e => setNotiz(e.target.value.slice(0, 300))} placeholder="z. B. mit Freundin unterwegs, abends erreichbar" style={feld} /></label>
        <div style={{ ...klein, textAlign: 'center' }}>Deine Chatter sehen das sofort auf ihrer Startseite.</div>
        <button type="button" className="gross-btn" onClick={speichern} disabled={!ok || speichert} style={{ ...knopf(ORANGE), padding: 14, fontSize: 15, opacity: ok && !speichert ? 1 : 0.5 }}>
          {speichert ? 'Speichert …' : 'Speichern'}
        </button>
        {reise && (
          <button type="button" onClick={async () => { if (window.confirm(`Reise „${reise.title}" löschen?`)) { if (await onLoeschen()) onZu() } }}
            style={{ background: 'transparent', border: 'none', color: '#ef4444', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>Reise löschen</button>
        )}
      </div>
    </div>
  )
}

// ── Preise: eine Zeile, zum Bearbeiten antippen ──
function PreisZeile({ item, onSpeichern, onLoeschen, onAbbrechen, neu, griff, zieht }) {
  const [offen, setOffen] = useState(!!neu)
  const [leistung, setLeistung] = useState(item?.title || '')
  const [preis, setPreis] = useState(item?.price || '')
  const [details, setDetails] = useState(item?.content || '')
  if (!offen) {
    return (
      <div style={{
        display: 'flex', alignItems: 'stretch', borderRadius: 11, background: zieht ? 'rgba(124,58,237,0.16)' : 'var(--bg-card2)',
        border: `1px solid ${zieht ? '#7c3aed' : 'transparent'}`, boxShadow: zieht ? '0 8px 22px rgba(0,0,0,0.45)' : 'none',
        transform: zieht ? 'scale(1.015)' : 'none', transition: 'transform .12s, box-shadow .12s', position: 'relative', zIndex: zieht ? 2 : 'auto',
      }}>
      {/* v4.89.0: Griff zum Verschieben — gedrückt halten und hoch/runter ziehen */}
      {griff && (
        <span {...griff} role="button" aria-label="Zum Verschieben ziehen" title="Gedrückt halten und ziehen, um die Reihenfolge zu ändern"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, flexShrink: 0, cursor: zieht ? 'grabbing' : 'grab', touchAction: 'none', userSelect: 'none', color: zieht ? 'var(--ton-lila)' : 'var(--text-muted)', fontSize: 15, letterSpacing: -2 }}>⋮⋮</span>
      )}
      <button type="button" onClick={() => setOffen(true)} title="Antippen zum Bearbeiten" style={{
        display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, textAlign: 'left', padding: griff ? '10px 12px 10px 2px' : '10px 12px', borderRadius: 11,
        background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
      }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.35 }}>{item.title}</span>
          {item.content && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{item.content}</span>}
        </span>
        {item.price
          ? <><span style={{ ...klein, flexShrink: 0 }}>ab</span><b style={{ fontFamily: 'monospace', fontSize: 14.5, color: '#10b981', flexShrink: 0 }}>{item.price}</b></>
          : <span style={{ fontSize: 11, color: ORANGE, flexShrink: 0 }}>Preis fehlt</span>}
      </button>
      </div>
    )
  }
  const ok = leistung.trim()
  return (
    <div style={{ padding: 11, borderRadius: 12, background: 'var(--bg-card2)', border: `1px solid ${ORANGE}66`, display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div className="raster-preis" style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 7 }}>
        <input autoFocus value={leistung} onChange={e => setLeistung(e.target.value.slice(0, 120))} placeholder="Leistung, z. B. Video" style={feld} />
        <input value={preis} onChange={e => setPreis(e.target.value.slice(0, 20))} placeholder="ab $40" style={{ ...feld, fontFamily: 'monospace' }} />
      </div>
      <input value={details} onChange={e => setDetails(e.target.value.slice(0, 200))} placeholder="Details (optional), z. B. 5 Min, mit Gesicht +$20" style={{ ...feld, fontSize: 13 }} />
      <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
        <button type="button" disabled={!ok} onClick={async () => { if (await onSpeichern({ title: leistung.trim(), price: preis.trim() || null, content: details.trim() || null }) && !neu) setOffen(false) }}
          style={{ ...knopf(ORANGE), padding: '8px 14px', opacity: ok ? 1 : 0.5 }}>Speichern</button>
        <button type="button" onClick={() => { if (neu) onAbbrechen(); else { setOffen(false); setLeistung(item.title); setPreis(item.price || ''); setDetails(item.content || '') } }} style={{ ...knopf(ORANGE, false), padding: '8px 12px' }}>Abbrechen</button>
        <div style={{ flex: 1 }} />
        {!neu && <button type="button" onClick={() => { if (window.confirm(`„${item.title}" löschen?`)) onLoeschen() }} style={linkKnopf('#ef4444')}>Löschen</button>}
      </div>
    </div>
  )
}

export default function ModelSteckbrief({ displayName, board, services, isPreview, logActivity, onGeaendert }) {
  const heute = heuteBerlin()
  const [reiseFenster, setReiseFenster] = useState(null)   // null | 'neu' | item
  const [alteReisen, setAlteReisen] = useState(false)
  const [neuerPreis, setNeuerPreis] = useState(false)
  const [eigenesNogo, setEigenesNogo] = useState(null)       // null | '' | text
  const [details, setDetails] = useState(false)
  const [geprueft, pruefen] = useGelesen('modelboard_geprueft', { lokalKey: `modelboard_geprueft_${displayName || 'x'}` })

  const preiseBoard = board.preise || []
  // v4.89.0: Reihenfolge der Preise per Ziehen ändern. Während des Ziehens und
  // bis das Board neu geladen ist, gilt die lokale Reihenfolge (ids).
  const [preisOrdnung, setPreisOrdnung] = useState(null)
  const [ziehtId, setZiehtId] = useState(null)
  const [sortiertSpeichert, setSortiertSpeichert] = useState(false)
  const preisListeRef = useRef(null)
  const preise = preisOrdnung ? preisOrdnung.map(id => preiseBoard.find(p => p.id === id)).filter(Boolean) : preiseBoard
  const nogos = board.nogos || []
  const reisen = [...(board.reise || [])].sort((a, b) => String(a.date_from || a.date_to || '').localeCompare(String(b.date_from || b.date_to || '')))
  const reisenAktuell = reisen.filter(r => !(r.date_to || r.date_from) || (r.date_to || r.date_from) >= heute)
  const reisenAlt = reisen.filter(r => (r.date_to || r.date_from) && (r.date_to || r.date_from) < heute)

  // Fortschritt: vier Dinge, die die Chatter wirklich brauchen
  const pruefAlt = !geprueft || Date.now() - new Date(geprueft).getTime() > MONAT_MS
  const schritte = [
    ANGEBOT_ALT.every(k => services[k]?.enabled === true || services[k]?.enabled === false),
    preise.some(p => p.price),
    nogos.length > 0,
    !pruefAlt,
  ]
  const fertig = schritte.filter(Boolean).length

  const fertigMelden = async (aktion, kategorie, text) => { await logActivity(aktion, kategorie, text); onGeaendert() }

  // ── Board-Zeilen ──
  // v4.93.1: waren in v4.89.0 versehentlich mit weggefallen → Speichern/Löschen
  // von Preisen, No Gos und Reisen ging nicht mehr (ReferenceError).
  const anlegen = async (kategorie, felder) => {
    const ok = await schreiben({ zeile: { model_name: displayName, category: kategorie, sort_order: (board[kategorie] || []).length, ...felder } })
    if (ok) await fertigMelden('hinzugefügt', kategorie, felder.title)
    return ok
  }
  const aendern = async (item, felder) => {
    const ok = await schreiben({ id: item.id, zeile: felder })
    if (ok) await fertigMelden('bearbeitet', item.category, felder.title || item.title)
    return ok
  }
  const loeschen = async (item) => {
    const { error } = await supabase.from('model_board').delete().eq('id', item.id)
    if (error) { alert('Nicht gelöscht: ' + error.message); return false }
    await fertigMelden('gelöscht', item.category, item.title)
    return true
  }

  // ── Preise sortieren (Ziehen am Griff ⋮⋮, Maus und Touch) ──
  // Bewegung und Loslassen hören auf window — beim Umsortieren verschiebt React
  // die Zeilen im DOM, ein Pointer-Capture am Griff ginge dabei verloren.
  const ordnungRef = useRef(null)
  ordnungRef.current = preisOrdnung
  const preisGriff = (id) => ({
    onPointerDown: (e) => {
      if (e.button !== undefined && e.button !== 0) return
      e.preventDefault()
      setPreisOrdnung(preise.map(p => p.id))
      setZiehtId(id)
    },
  })
  useEffect(() => {
    if (!ziehtId) return
    // Am Handy sonst: Seite scrollt mit bzw. der Browser bricht die Geste ab
    const nichtScrollen = (e) => { if (e.cancelable) e.preventDefault() }
    const bewegen = (e) => {
      if (!preisListeRef.current) return
      // Zeilen nach ihrer sichtbaren Position sortieren (CSS order, siehe unten)
      const zeilen = [...preisListeRef.current.querySelectorAll('[data-preis-id]')]
        .map(el => el.getBoundingClientRect()).sort((a, b) => a.top - b.top)
      let ziel = zeilen.length - 1
      for (let i = 0; i < zeilen.length; i++) {
        if (e.clientY < zeilen[i].top + zeilen[i].height / 2) { ziel = i; break }
      }
      setPreisOrdnung(prev => {
        if (!prev) return prev
        const von = prev.indexOf(ziehtId)
        if (von === -1 || von === ziel) return prev
        const neu = prev.filter(x => x !== ziehtId)
        neu.splice(ziel, 0, ziehtId)
        return neu
      })
    }
    const loslassen = async () => {
      window.removeEventListener('touchmove', nichtScrollen)
      window.removeEventListener('pointermove', bewegen)
      window.removeEventListener('pointerup', loslassen)
      window.removeEventListener('pointercancel', loslassen)
      setZiehtId(null)
      const ordnung = ordnungRef.current || []
      const aenderungen = ordnung.map((pid, i) => ({ pid, i })).filter(({ pid, i }) => preiseBoard.find(p => p.id === pid)?.sort_order !== i)
      if (!aenderungen.length) { setPreisOrdnung(null); return }
      setSortiertSpeichert(true)
      const ergebnisse = await Promise.all(aenderungen.map(({ pid, i }) => supabase.from('model_board').update({ sort_order: i }).eq('id', pid)))
      const fehler = ergebnisse.find(r => r.error)
      if (fehler) alert('Reihenfolge NICHT (ganz) gespeichert: ' + fehler.error.message)
      await onGeaendert()
      setSortiertSpeichert(false)
      setPreisOrdnung(null)
    }
    window.addEventListener('touchmove', nichtScrollen, { passive: false })
    window.addEventListener('pointermove', bewegen)
    window.addEventListener('pointerup', loslassen)
    window.addEventListener('pointercancel', loslassen)
    return () => {
      window.removeEventListener('touchmove', nichtScrollen)
      window.removeEventListener('pointermove', bewegen)
      window.removeEventListener('pointerup', loslassen)
      window.removeEventListener('pointercancel', loslassen)
    }
  }, [ziehtId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Angebot: antippen = ja / nein ──
  const angebotTippen = async (a) => {
    const s = services[a.key]
    const neu = s?.enabled === true ? false : true
    const vorhanden = await supabase.from('model_board').select('id').eq('model_name', displayName).eq('category', 'service_flags').eq('title', a.key).maybeSingle()
    const { error } = vorhanden.data
      ? await supabase.from('model_board').update({ yes_no: neu }).eq('id', vorhanden.data.id)
      : await supabase.from('model_board').insert({ model_name: displayName, category: 'service_flags', title: a.key, yes_no: neu, content: null, sort_order: 0 })
    if (error) { alert('Nicht gespeichert: ' + error.message); return }
    await fertigMelden('bearbeitet', 'service_flags', `${a.label}: ${neu ? 'ja' : 'nein'}`)
  }
  const angebotNotiz = async (a, text) => {
    const s = services[a.key]
    if ((s?.note || '') === text.trim()) return
    const vorhanden = await supabase.from('model_board').select('id').eq('model_name', displayName).eq('category', 'service_flags').eq('title', a.key).maybeSingle()
    if (!vorhanden.data) return
    const { error } = await supabase.from('model_board').update({ content: text.trim() || null }).eq('id', vorhanden.data.id)
    if (error) { alert('Nicht gespeichert: ' + error.message); return }
    await fertigMelden('bearbeitet', 'service_flags', `${a.label}: ${text.trim() || 'Details entfernt'}`)
  }

  // ── No Gos ──
  const nogoAktiv = (t) => nogos.find(n => lc(n.title) === lc(t))
  const nogoTippen = async (t) => {
    const da = nogoAktiv(t)
    if (da) { if (window.confirm(`„${da.title}" aus deinen No Gos entfernen?`)) await loeschen(da) }
    else await anlegen('nogos', { title: t })
  }
  const vorschlaege = NOGO_VORSCHLAEGE.filter(t => !nogoAktiv(t))

  return (
    <div className="steckbrief" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Fortschritt + monatliche Frage */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 7, borderRadius: 4, background: 'var(--bg-card2)', overflow: 'hidden' }}>
          <div style={{ width: `${fertig * 25}%`, height: '100%', background: fertig === 4 ? '#10b981' : ORANGE, transition: 'width .3s' }} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: fertig === 4 ? '#10b981' : ORANGE, whiteSpace: 'nowrap' }}>{fertig === 4 ? '✓ Board komplett' : `${fertig} von 4 erledigt`}</span>
      </div>
      {pruefAlt && !isPreview && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', borderRadius: 14, background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)' }}>
          <div style={{ flex: 1, fontSize: 13, lineHeight: 1.4, color: 'var(--text-primary)' }}>
            <b>Stimmt noch alles?</b>
            <div style={{ ...klein, fontSize: 11.5 }}>{geprueft ? `Zuletzt bestätigt am ${new Date(geprueft).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}` : 'Einmal im Monat kurz drüberschauen'}</div>
          </div>
          <button type="button" onClick={pruefen} style={{ ...knopf(ORANGE), padding: '9px 13px', fontSize: 12.5 }}>Ja, passt</button>
        </div>
      )}

      {/* Urlaub & Reisen */}
      <div data-help="reise" style={{ ...karte, borderColor: 'rgba(8,145,178,0.45)', background: 'linear-gradient(150deg, rgba(8,145,178,0.14), var(--bg-card) 70%)' }}>
        <div style={kopf}>
          <span style={titel}>✈ Urlaub &amp; Reisen</span>
          <button type="button" onClick={() => setReiseFenster('neu')} style={linkKnopf('#0891b2')}>+ Reise</button>
        </div>
        {reisenAktuell.length === 0 && <div style={{ ...klein, fontSize: 12 }}>Keine Reise geplant. Wenn du wegfährst: kurz eintragen — dein Team sieht es sofort.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {reisenAktuell.map(r => {
            const laeuft = (r.date_from || r.date_to) <= heute
            const geht = liste(r.reise_geht), nicht = liste(r.reise_geht_nicht)
            return (
              <button key={r.id} type="button" onClick={() => setReiseFenster(r)} style={{
                display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
                background: 'var(--bg-base)', border: `1px solid ${laeuft ? 'rgba(8,145,178,0.6)' : 'rgba(8,145,178,0.25)'}`,
              }}>
                <span style={{ textAlign: 'center', minWidth: 58, flexShrink: 0 }}>
                  <span style={{ display: 'block', fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{tag(r.date_from || r.date_to)}</span>
                  {r.date_to && r.date_to !== r.date_from && <span style={{ display: 'block', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>– {tag(r.date_to)}</span>}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{r.title}{laeuft && <span style={{ fontSize: 10.5, color: '#0891b2', marginLeft: 6 }}>● läuft</span>}</span>
                  {(geht.length > 0 || nicht.length > 0) && (
                    <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {geht.length > 0 && <span style={{ color: '#10b981' }}>✓ {geht.join(', ')}</span>}
                      {geht.length > 0 && nicht.length > 0 && ' · '}
                      {nicht.length > 0 && <span style={{ color: '#ef4444' }}>✕ {nicht.join(', ')}</span>}
                    </span>
                  )}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: 16 }}>›</span>
              </button>
            )
          })}
        </div>
        {reisenAlt.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <button type="button" onClick={() => setAlteReisen(v => !v)} style={{ ...linkKnopf('var(--text-muted)'), fontWeight: 500, fontSize: 11.5 }}>
              {alteReisen ? 'Vergangene ausblenden' : `${reisenAlt.length} vergangene anzeigen`}
            </button>
            {alteReisen && reisenAlt.map(r => (
              <button key={r.id} type="button" onClick={() => setReiseFenster(r)} style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 5, padding: '7px 10px', borderRadius: 9, background: 'transparent', border: '1px dashed var(--border)', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                {tag(r.date_from || r.date_to)}{r.date_to && r.date_to !== r.date_from ? `–${tag(r.date_to)}` : ''} · {r.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Was ich anbiete */}
      <div data-help="services" style={karte}>
        <div style={kopf}>
          <span style={titel}>Was ich anbiete</span>
          <span style={klein}>antippen = an / aus</span>
        </div>
        <div className="raster-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
          {ANGEBOT.map(a => {
            const e = services[a.key]?.enabled
            const an = e === true, aus = e === false
            return (
              <button key={a.key} type="button" className="kachel" onClick={() => angebotTippen(a)} aria-pressed={an} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '11px 4px', borderRadius: 13, cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12, fontWeight: 700,
                background: an ? 'rgba(16,185,129,0.12)' : 'var(--bg-card2)',
                border: `1px ${e === undefined ? 'dashed' : 'solid'} ${an ? '#10b981' : 'var(--border)'}`,
                color: an ? '#10b981' : aus ? 'var(--text-muted)' : 'var(--text-secondary)',
              }}>
                <span style={{ fontSize: 18, filter: an ? 'none' : 'grayscale(1)', opacity: an ? 1 : 0.5 }}>{a.icon}</span>
                <span style={{ textDecoration: aus ? 'line-through' : 'none' }}>{a.label}</span>
                {e === undefined && <span style={{ fontSize: 9.5, fontWeight: 600, color: ORANGE }}>noch offen</span>}
              </button>
            )
          })}
        </div>
        <button type="button" onClick={() => setDetails(v => !v)} style={{ ...linkKnopf('var(--text-muted)'), fontWeight: 500, fontSize: 11.5, marginTop: 9 }}>
          {details ? 'Details schließen' : 'Details zu deinem Angebot (Preis, Dauer …)'}
        </button>
        {details && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {ANGEBOT.filter(a => services[a.key]?.enabled === true).map(a => (
              <label key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', minWidth: 92 }}>{a.icon} {a.label}</span>
                <input defaultValue={services[a.key]?.note || ''} onBlur={e => angebotNotiz(a, e.target.value)} placeholder="z. B. 10 Min $30" style={{ ...feld, padding: '8px 10px', fontSize: 13 }} />
              </label>
            ))}
            {!ANGEBOT.some(a => services[a.key]?.enabled === true) && <div style={klein}>Erst oben etwas anschalten.</div>}
          </div>
        )}
      </div>

      {/* Preise */}
      <div data-help="preise" style={karte}>
        <div style={kopf}>
          <span style={titel}>Preise</span>
          {!neuerPreis && <button type="button" onClick={() => setNeuerPreis(true)} style={linkKnopf('#a78bfa')}>+ Preis</button>}
        </div>
        <div ref={preisListeRef} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {preise.length === 0 && !neuerPreis && <div style={{ ...klein, fontSize: 12 }}>Noch keine Preise. Leistung + ab-Preis reicht, z. B. „Video — ab $40".</div>}
          {/* Die DOM-Reihenfolge bleibt beim Ziehen gleich (sonst bricht der
              Browser die Touch-Geste ab); sichtbar umsortiert wird per CSS order. */}
          {preiseBoard.map(p => (
            <div key={p.id} data-preis-id={p.id} style={{ order: Math.max(0, preise.findIndex(x => x.id === p.id)) }}>
              <PreisZeile key={`${p.id}|${p.title}|${p.price || ''}|${p.content || ''}`} item={p}
                griff={preise.length > 1 ? preisGriff(p.id) : null} zieht={ziehtId === p.id}
                onSpeichern={(f) => aendern(p, f)} onLoeschen={() => loeschen(p)} />
            </div>
          ))}
          {preise.length > 1 && (
            <div style={{ ...klein, fontSize: 11, order: 9999 }}>{sortiertSpeichert ? 'Reihenfolge wird gespeichert …' : '⋮⋮ gedrückt halten und ziehen, um die Reihenfolge zu ändern — so sehen es auch die Chatter.'}</div>
          )}
          {neuerPreis && (
            <div style={{ order: 9998 }}><PreisZeile neu onAbbrechen={() => setNeuerPreis(false)}
              onSpeichern={async (f) => { const ok = await anlegen('preise', f); if (ok) setNeuerPreis(false); return ok }} /></div>
          )}
        </div>
      </div>

      {/* No Gos */}
      <div data-help="nogos" style={karte}>
        <div style={kopf}>
          <span style={titel}>No Gos</span>
          <span style={klein}>antippen = an / aus</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {nogos.map(n => (
            <button key={n.id} type="button" className="chip-btn" onClick={() => nogoTippen(n.title)} title={n.content || 'Antippen zum Entfernen'} style={{
              fontSize: 13, padding: '7px 12px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, textAlign: 'left',
              background: 'rgba(239,68,68,0.13)', border: '1px solid #ef4444', color: '#ef4444',
            }}>{n.title}</button>
          ))}
          {vorschlaege.map(t => (
            <button key={t} type="button" className="chip-btn" onClick={() => nogoTippen(t)} style={{
              fontSize: 13, padding: '7px 12px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit',
              background: 'transparent', border: '1px dashed var(--border)', color: 'var(--text-muted)',
            }}>{t}</button>
          ))}
          {eigenesNogo === null && (
            <button type="button" className="chip-btn" onClick={() => setEigenesNogo('')} style={{ fontSize: 13, padding: '7px 12px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit', background: 'transparent', border: '1px solid rgba(124,58,237,0.5)', color: '#a78bfa' }}>+ eigenes</button>
          )}
        </div>
        {eigenesNogo !== null && (
          <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
            <input autoFocus value={eigenesNogo} onChange={e => setEigenesNogo(e.target.value.slice(0, 80))}
              onKeyDown={async e => { if (e.key === 'Enter' && eigenesNogo.trim()) { if (await anlegen('nogos', { title: eigenesNogo.trim() })) setEigenesNogo(null) } if (e.key === 'Escape') setEigenesNogo(null) }}
              placeholder="z. B. Keine Fotos vom Zuhause" style={{ ...feld, padding: '9px 11px', fontSize: 13.5 }} />
            <button type="button" disabled={!eigenesNogo.trim()} onClick={async () => { if (await anlegen('nogos', { title: eigenesNogo.trim() })) setEigenesNogo(null) }} style={{ ...knopf(ORANGE), padding: '8px 13px', opacity: eigenesNogo.trim() ? 1 : 0.5 }}>OK</button>
            <button type="button" onClick={() => setEigenesNogo(null)} style={{ ...knopf(ORANGE, false), padding: '8px 11px' }}>×</button>
          </div>
        )}
        <div style={{ ...klein, marginTop: 9 }}>Rot = gilt für dich. Gestrichelt = Vorschlag, antippen zum Übernehmen.</div>
      </div>

      {reiseFenster && (
        <ReiseFenster
          reise={reiseFenster === 'neu' ? null : reiseFenster}
          onZu={() => setReiseFenster(null)}
          onSpeichern={(f) => reiseFenster === 'neu' ? anlegen('reise', f) : aendern(reiseFenster, f)}
          onLoeschen={() => loeschen(reiseFenster)}
        />
      )}
    </div>
  )
}
