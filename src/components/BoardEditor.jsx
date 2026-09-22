import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, MousePointer2, StickyNote, Square, MoveUpRight, Type,
  Trash2, CheckSquare, Maximize, Minus, Plus, Undo2, Users, X, CalendarPlus,
} from 'lucide-react'
import { supabase } from '../supabase'
import { formatMoneyShort } from '../utils'
import {
  NOTIZ_FARBEN, RAHMEN_FARBEN, ladeElemente, elementSpeichern, elementLoeschen,
  boardAendern, neueId,
} from '../boards'
// v4.74.0: aus dem Board direkt in Kalender oder ToDos
import BoardEintragen from './BoardEintragen'

// ── Board-Editor (v4.73.0) ─────────────────────────────────────────────────
//
// Eine Fläche zum Verschieben und Zoomen, darauf Rahmen, Notizen, Personen,
// Text und Pfeile. Live für alle, die das Board offen haben:
//   - Elemente: Supabase Realtime auf board_elemente (sql/boards.sql)
//   - Cursor und "wer ist da": Realtime Broadcast/Presence, ohne Datenbank
//   - Beim Ziehen geht die Zwischenposition per Broadcast raus, gespeichert
//     wird erst beim Loslassen. Sonst schriebe jede Mausbewegung in die DB.
//
// KOORDINATEN
// Elemente liegen in Board-Koordinaten. Die Ansicht ist {x, y, k}:
//   Bildschirm = Board * k + (x, y)
// Alles, was von der Maus kommt, läuft durch zuBoard().
//
// Rahmen nehmen mit, was in ihnen liegt: Wer "Spätschicht" verschiebt,
// verschiebt die Leute darin mit (Mittelpunkt im Rahmen beim Anfassen).

const ZOOM_MIN = 0.25
const ZOOM_MAX = 2.5
const CURSOR_TAKT_MS = 50
const TEXT_SPEICHERN_MS = 500
const PERSONEN_FARBEN = ['#7c3aed', '#0891b2', '#db2777', '#059669', '#d97706', '#4f46e5']

const farbeVon = (name) => {
  let h = 0
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PERSONEN_FARBEN[h % PERSONEN_FARBEN.length]
}
const lc = (s) => String(s || '').trim().toLowerCase()
const mitte = (e) => ({ x: e.x + e.w / 2, y: e.y + e.h / 2 })

// Zeiger festhalten, damit das Ziehen auch außerhalb des Elements weiterläuft.
// Kann werfen (Zeiger schon weg, manche Stifte) — dann eben ohne.
const fangen = (ev) => { try { ev.currentTarget.setPointerCapture(ev.pointerId) } catch { /* egal */ } }

// Punkt am Rand eines Rechtecks in Richtung eines anderen Punkts — damit
// Pfeile an der Kante anfangen und nicht in der Mitte der Karte.
function randpunkt(e, ziel) {
  const m = mitte(e)
  const dx = ziel.x - m.x, dy = ziel.y - m.y
  if (!dx && !dy) return m
  const sx = dx ? (e.w / 2) / Math.abs(dx) : Infinity
  const sy = dy ? (e.h / 2) / Math.abs(dy) : Infinity
  const s = Math.min(sx, sy)
  return { x: m.x + dx * s, y: m.y + dy * s }
}

const istHandy = () => { try { return window.matchMedia('(max-width: 768px)').matches } catch { return false } }

export default function BoardEditor({ board, ich, team, onZurueck }) {
  const [els, setEls] = useState({})
  const [laden, setLaden] = useState(true)
  const [fehler, setFehler] = useState(null)
  const [view, setView] = useState({ x: 40, y: 80, k: 0.85 })
  const [werkzeug, setWerkzeug] = useState('auswahl')
  const [sel, setSel] = useState(null)
  const [bearbeiten, setBearbeiten] = useState(null)
  const [pfeilStart, setPfeilStart] = useState(null)
  const [andere, setAndere] = useState({})     // key → { name, farbe, cursor }
  const [geloescht, setGeloescht] = useState(null)
  const [eintragen, setEintragen] = useState(null)   // { el, start, vorschlag } — Fenster "Eintragen"
  const [meldung, setMeldung] = useState(null)       // kurze Bestätigung nach dem Eintragen
  const [teamOffen, setTeamOffen] = useState(() => !istHandy())
  const [titel, setTitel] = useState(board.titel)
  const [handy, setHandy] = useState(istHandy)
  const [zieht, setZieht] = useState(false)   // blendet die Auswahl-Leiste aus, solange etwas bewegt wird

  const flaecheRef = useRef(null)
  const elsRef = useRef(els)
  const viewRef = useRef(view)
  const dragRef = useRef(null)
  const pointerRef = useRef(new Map())
  const kanalRef = useRef(null)
  const cursorZeitRef = useRef(0)
  const textTimer = useRef({})
  // Ein Schlüssel pro geöffnetem Fenster — dieselbe Person an zwei Geräten
  // soll zwei Cursor haben, nicht einen springenden.
  const meinKey = useRef(ich + '-' + Math.random().toString(36).slice(2, 6))
  const ziehtRef = useRef(new Set())   // ids, die ich gerade ziehe — Realtime-Echo ignorieren
  useEffect(() => { elsRef.current = els }, [els])
  useEffect(() => { viewRef.current = view }, [view])
  // Was ich gerade tippe, darf der Realtime-Rücklauf meines eigenen letzten
  // Speicherns nicht zurückdrehen (sonst springt der Text beim Schreiben).
  const bearbeitenRef = useRef(null)
  useEffect(() => { bearbeitenRef.current = bearbeiten }, [bearbeiten])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const f = () => setHandy(mq.matches)
    mq.addEventListener?.('change', f)
    return () => mq.removeEventListener?.('change', f)
  }, [])

  const teamInfo = useMemo(() => {
    const m = {}
    for (const c of team?.chatter || []) m[lc(c.name)] = c
    for (const l of team?.leitung || []) m[lc(l.name)] = { ...(m[lc(l.name)] || {}), leitung: l.rolle }
    return m
  }, [team])

  // ── Laden + Live ──
  const alleZeigen = useCallback((liste) => {
    const f = flaecheRef.current
    const arr = Object.values(liste || elsRef.current).filter(e => e.typ !== 'pfeil')
    if (!f || !arr.length) return
    const minX = Math.min(...arr.map(e => e.x)), minY = Math.min(...arr.map(e => e.y))
    const maxX = Math.max(...arr.map(e => e.x + e.w)), maxY = Math.max(...arr.map(e => e.y + e.h))
    const r = f.getBoundingClientRect()
    const rand = 60
    const k = Math.max(ZOOM_MIN, Math.min(1.2, (r.width - rand * 2) / (maxX - minX || 1), (r.height - rand * 2 - 50) / (maxY - minY || 1)))
    // Am Handy wäre "alles zeigen" oft unlesbar klein — dann lieber lesbar
    // oben links anfangen und mit zwei Fingern weiter schieben.
    if (k < 0.45 && r.width < 700) {
      setView({ k: 0.45, x: 16 - minX * 0.45, y: 70 - minY * 0.45 })
      return
    }
    setView({ k, x: (r.width - (maxX - minX) * k) / 2 - minX * k, y: 50 + (r.height - 50 - (maxY - minY) * k) / 2 - minY * k })
  }, [])

  useEffect(() => {
    let aktiv = true
    ladeElemente(board.id).then(liste => {
      if (!aktiv) return
      const m = Object.fromEntries(liste.map(e => [e.id, e]))
      setEls(m)
      setLaden(false)
      requestAnimationFrame(() => alleZeigen(m))
    }).catch(e => { setFehler('Board konnte nicht geladen werden: ' + e.message); setLaden(false) })

    const kanal = supabase.channel(`board-${board.id}`, { config: { presence: { key: meinKey.current } } })
    kanal
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_elemente', filter: `board_id=eq.${board.id}` }, (p) => {
        if (p.eventType === 'DELETE') {
          const id = p.old?.id
          if (id) setEls(prev => { if (!prev[id]) return prev; const n = { ...prev }; delete n[id]; return n })
          return
        }
        const neu = p.new
        if (!neu?.id || ziehtRef.current.has(neu.id) || bearbeitenRef.current === neu.id) return
        setEls(prev => ({ ...prev, [neu.id]: { ...(prev[neu.id] || {}), ...neu } }))
      })
      .on('broadcast', { event: 'cursor' }, ({ payload }) => {
        setAndere(prev => ({ ...prev, [payload.key]: { ...(prev[payload.key] || {}), name: payload.name, cursor: { x: payload.x, y: payload.y } } }))
      })
      .on('broadcast', { event: 'bewegt' }, ({ payload }) => {
        setEls(prev => {
          const n = { ...prev }
          for (const [id, pos] of Object.entries(payload.pos || {})) if (n[id]) n[id] = { ...n[id], ...pos }
          return n
        })
      })
      .on('presence', { event: 'sync' }, () => {
        const st = kanal.presenceState()
        setAndere(prev => {
          const n = {}
          for (const [key, eintraege] of Object.entries(st)) {
            const e = eintraege[0]
            if (!e || key === meinKey.current) continue
            n[key] = { ...(prev[key] || {}), name: e.name }
          }
          return n
        })
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') kanal.track({ name: ich })
      })
    kanalRef.current = kanal
    return () => { aktiv = false; supabase.removeChannel(kanal) }
  }, [board.id, ich, alleZeigen])

  // ── Speichern ──
  // "Zuletzt geändert" in der Übersicht: höchstens einmal pro Minute am Board vermerken
  const beruehrtRef = useRef(0)
  const speichern = useCallback(async (el) => {
    try {
      await elementSpeichern({ ...el, board_id: board.id }, ich)
      if (Date.now() - beruehrtRef.current > 60000) {
        beruehrtRef.current = Date.now()
        boardAendern(board.id, {}, ich).catch(() => {})
      }
    } catch (e) { setFehler('Nicht gespeichert: ' + e.message) }
  }, [board.id, ich])

  const setzeEl = (id, aenderung, { sofort = false } = {}) => {
    const alt = elsRef.current[id]
    if (!alt) return
    const el = { ...alt, ...aenderung, daten: { ...alt.daten, ...(aenderung.daten || {}) } }
    elsRef.current = { ...elsRef.current, [id]: el }   // sofort, damit schnelles Tippen nichts verliert
    setEls(prev => ({ ...prev, [id]: el }))
    clearTimeout(textTimer.current[id])
    if (sofort) speichern(el)
    else textTimer.current[id] = setTimeout(() => speichern(elsRef.current[id] || el), TEXT_SPEICHERN_MS)
  }

  const hinzufuegen = (el) => {
    const zMax = Math.max(0, ...Object.values(elsRef.current).map(e => e.z || 0))
    const neu = { id: neueId(), board_id: board.id, x: 0, y: 0, w: 0, h: 0, daten: {}, ...el, z: zMax + 1 }
    setEls(prev => ({ ...prev, [neu.id]: neu }))
    speichern({ ...neu, neu: true })
    return neu
  }

  const loeschen = (id) => {
    const el = elsRef.current[id]
    if (!el) return
    // Pfeile, die an diesem Element hängen, gehen mit — sonst zeigen sie ins Leere
    const mit = Object.values(elsRef.current).filter(e => e.typ === 'pfeil' && (e.daten.von === id || e.daten.nach === id))
    setEls(prev => { const n = { ...prev }; delete n[id]; for (const p of mit) delete n[p.id]; return n })
    setSel(null); setBearbeiten(null)
    setGeloescht([el, ...mit])
    Promise.all([id, ...mit.map(p => p.id)].map(elementLoeschen)).catch(e => setFehler('Löschen fehlgeschlagen: ' + e.message))
  }

  const rueckgaengig = () => {
    if (!geloescht) return
    for (const el of geloescht) { setEls(prev => ({ ...prev, [el.id]: el })); speichern({ ...el, neu: true }) }
    setGeloescht(null)
  }

  // ── Umrechnung ──
  const zuBoard = (cx, cy) => {
    const r = flaecheRef.current.getBoundingClientRect()
    const v = viewRef.current
    return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k }
  }

  const zoomen = (faktor, cx, cy) => {
    const r = flaecheRef.current?.getBoundingClientRect()
    if (!r) return
    const px = cx ?? r.left + r.width / 2, py = cy ?? r.top + r.height / 2
    setView(v => {
      const k = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.k * faktor))
      const bx = (px - r.left - v.x) / v.k, by = (py - r.top - v.y) / v.k
      return { k, x: px - r.left - bx * k, y: py - r.top - by * k }
    })
  }

  // Mausrad: mit Strg/Pinch am Trackpad zoomen, sonst verschieben
  useEffect(() => {
    const f = flaecheRef.current
    if (!f) return
    const rad = (ev) => {
      ev.preventDefault()
      if (ev.ctrlKey || ev.metaKey) zoomen(Math.exp(-ev.deltaY * 0.01), ev.clientX, ev.clientY)
      else setView(v => ({ ...v, x: v.x - ev.deltaX, y: v.y - ev.deltaY }))
    }
    f.addEventListener('wheel', rad, { passive: false })
    return () => f.removeEventListener('wheel', rad)
  })

  // Tastatur: Entf löscht, Esc hebt Auswahl auf — nicht, während getippt wird
  useEffect(() => {
    const taste = (ev) => {
      const t = ev.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && sel) { ev.preventDefault(); loeschen(sel) }
      if (ev.key === 'Escape') { setSel(null); setPfeilStart(null); setWerkzeug('auswahl') }
    }
    window.addEventListener('keydown', taste)
    return () => window.removeEventListener('keydown', taste)
  })

  const cursorSenden = (cx, cy) => {
    const jetzt = Date.now()
    if (jetzt - cursorZeitRef.current < CURSOR_TAKT_MS || !kanalRef.current || !flaecheRef.current) return
    cursorZeitRef.current = jetzt
    const p = zuBoard(cx, cy)
    kanalRef.current.send({ type: 'broadcast', event: 'cursor', payload: { key: meinKey.current, name: ich, x: p.x, y: p.y } })
  }

  // ── Zeiger ──
  const aufFlaecheRunter = (ev) => {
    pointerRef.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
    if (pointerRef.current.size === 2) {
      const [a, b] = [...pointerRef.current.values()]
      dragRef.current = { art: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v: viewRef.current }
      return
    }
    if (ev.target !== ev.currentTarget && !ev.target.dataset?.flaeche) return
    const p = zuBoard(ev.clientX, ev.clientY)
    // Beim Anlegen den Fokus-Wechsel des Browsers unterdrücken — sonst nimmt
    // er dem frisch geöffneten Textfeld sofort den Fokus wieder weg.
    if (werkzeug !== 'auswahl' && werkzeug !== 'pfeil') ev.preventDefault()
    if (werkzeug === 'notiz') {
      const n = hinzufuegen({ typ: 'notiz', x: p.x - 90, y: p.y - 60, w: 180, h: 130, daten: { text: '', farbe: 'gelb', von: ich, punkte: [] } })
      setSel(n.id); setBearbeiten(n.id); setWerkzeug('auswahl'); return
    }
    if (werkzeug === 'rahmen') {
      const n = hinzufuegen({ typ: 'rahmen', x: p.x - 160, y: p.y - 110, w: 320, h: 220, daten: { titel: 'Neuer Rahmen', farbe: 'grau' } })
      setSel(n.id); setBearbeiten(n.id); setWerkzeug('auswahl'); return
    }
    if (werkzeug === 'text') {
      const n = hinzufuegen({ typ: 'text', x: p.x, y: p.y - 16, w: 240, h: 36, daten: { text: '', groesse: 22 } })
      setSel(n.id); setBearbeiten(n.id); setWerkzeug('auswahl'); return
    }
    setSel(null); setBearbeiten(null); setPfeilStart(null)
    dragRef.current = { art: 'pan', sx: ev.clientX, sy: ev.clientY, v: viewRef.current }
    fangen(ev)
  }

  const aufElementRunter = (ev, el) => {
    ev.stopPropagation()
    pointerRef.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
    if (werkzeug === 'pfeil') {
      if (el.typ === 'pfeil') return
      if (!pfeilStart) { setPfeilStart(el.id); setSel(el.id); return }
      if (pfeilStart !== el.id) {
        const n = hinzufuegen({ typ: 'pfeil', daten: { von: pfeilStart, nach: el.id } })
        setSel(n.id)
      }
      setPfeilStart(null); setWerkzeug('auswahl'); return
    }
    setSel(el.id)
    if (bearbeiten === el.id || el.typ === 'pfeil') return
    if (bearbeiten) setBearbeiten(null)
    // Rahmen: alles mitnehmen, dessen Mitte darin liegt
    const ids = [el.id]
    if (el.typ === 'rahmen') {
      for (const e of Object.values(elsRef.current)) {
        if (e.id === el.id || e.typ === 'pfeil' || e.typ === 'rahmen') continue
        const m = mitte(e)
        if (m.x > el.x && m.x < el.x + el.w && m.y > el.y && m.y < el.y + el.h) ids.push(e.id)
      }
    }
    const start = Object.fromEntries(ids.map(id => [id, { x: elsRef.current[id].x, y: elsRef.current[id].y }]))
    ids.forEach(id => ziehtRef.current.add(id))
    dragRef.current = { art: 'zieh', sx: ev.clientX, sy: ev.clientY, start, bewegt: false }
    fangen(ev)
  }

  const aufGriffRunter = (ev, el) => {
    ev.stopPropagation()
    ziehtRef.current.add(el.id)
    dragRef.current = { art: 'groesse', id: el.id, sx: ev.clientX, sy: ev.clientY, w: el.w, h: el.h }
    fangen(ev)
  }

  const bewegen = (ev) => {
    cursorSenden(ev.clientX, ev.clientY)
    if (pointerRef.current.has(ev.pointerId)) pointerRef.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
    const d = dragRef.current
    if (!d) return
    if (d.art === 'pinch' && pointerRef.current.size === 2) {
      const [a, b] = [...pointerRef.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const r = flaecheRef.current.getBoundingClientRect()
      const k = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, d.v.k * dist / d.d))
      const bx = (d.m.x - r.left - d.v.x) / d.v.k, by = (d.m.y - r.top - d.v.y) / d.v.k
      setView({ k, x: m.x - r.left - bx * k, y: m.y - r.top - by * k })
      return
    }
    if (d.art === 'pan') { setView({ ...d.v, x: d.v.x + ev.clientX - d.sx, y: d.v.y + ev.clientY - d.sy }); return }
    const k = viewRef.current.k
    const dx = (ev.clientX - d.sx) / k, dy = (ev.clientY - d.sy) / k
    if (d.art === 'zieh') {
      if (!d.bewegt && Math.hypot(dx, dy) * k < 3) return
      if (!d.bewegt) setZieht(true)
      d.bewegt = true
      const pos = {}
      for (const [id, s] of Object.entries(d.start)) pos[id] = { x: Math.round(s.x + dx), y: Math.round(s.y + dy) }
      setEls(prev => { const n = { ...prev }; for (const [id, p] of Object.entries(pos)) if (n[id]) n[id] = { ...n[id], ...p }; return n })
      const jetzt = Date.now()
      if (kanalRef.current && jetzt - (d.gesendet || 0) > CURSOR_TAKT_MS) {
        d.gesendet = jetzt
        kanalRef.current.send({ type: 'broadcast', event: 'bewegt', payload: { pos } })
      }
    }
    if (d.art === 'groesse') {
      const el = elsRef.current[d.id]
      const minW = el?.typ === 'rahmen' ? 160 : 120, minH = el?.typ === 'rahmen' ? 100 : 80
      setEls(prev => prev[d.id] ? { ...prev, [d.id]: { ...prev[d.id], w: Math.max(minW, Math.round(d.w + dx)), h: Math.max(minH, Math.round(d.h + dy)) } } : prev)
    }
  }

  const loslassen = (ev) => {
    pointerRef.current.delete(ev.pointerId)
    const d = dragRef.current
    if (!d) return
    if (d.art === 'pinch' && pointerRef.current.size < 2) { dragRef.current = null; return }
    dragRef.current = null
    setZieht(false)
    if (d.art === 'zieh') {
      const ids = Object.keys(d.start)
      if (d.bewegt) for (const id of ids) if (elsRef.current[id]) speichern(elsRef.current[id])
      setTimeout(() => ids.forEach(id => ziehtRef.current.delete(id)), 800)
    }
    if (d.art === 'groesse') {
      if (elsRef.current[d.id]) speichern(elsRef.current[d.id])
      setTimeout(() => ziehtRef.current.delete(d.id), 800)
    }
  }

  // Person aus der Team-Liste aufs Board (Ziehen am Desktop, Tippen überall)
  const personDazu = (name, cx, cy) => {
    let p
    if (cx != null) p = zuBoard(cx, cy)
    else {
      const r = flaecheRef.current.getBoundingClientRect()
      p = zuBoard(r.left + r.width / 2, r.top + r.height / 2)
    }
    const n = hinzufuegen({ typ: 'person', x: Math.round(p.x - 150), y: Math.round(p.y - 32), w: 298, h: 64, daten: { name, rolle: '' } })
    setSel(n.id)
  }

  const punktUmschalten = (el) => {
    const punkte = el.daten.punkte || []
    const neu = punkte.includes(ich) ? punkte.filter(p => p !== ich) : [...punkte, ich]
    setzeEl(el.id, { daten: { punkte: neu } }, { sofort: true })
  }

  // Was aus dem gewählten Element fürs Eintragen vorgeschlagen wird:
  // Notiz/Text → Titel; Person → diese Person; Rahmen → sein Titel und alle Leute darin.
  const vorschlagAus = (el) => {
    if (!el) return {}
    if (el.typ === 'notiz' || el.typ === 'text') return { titel: (el.daten.text || '').split('\n')[0].slice(0, 120), notiz: `Aus dem Board „${titel}“` }
    if (el.typ === 'person') return { titel: '', personen: [el.daten.name], notiz: `Aus dem Board „${titel}“` }
    if (el.typ === 'rahmen') {
      const drin = Object.values(elsRef.current).filter(e => e.typ === 'person' && (() => {
        const m = mitte(e); return m.x > el.x && m.x < el.x + el.w && m.y > el.y && m.y < el.y + el.h
      })()).map(e => e.daten.name)
      return { titel: el.daten.titel || '', personen: [...new Set(drin)], notiz: `Aus dem Board „${titel}“` }
    }
    return {}
  }

  const eingetragen = (erg) => {
    const el = eintragen?.el
    setEintragen(null)
    if (el && elsRef.current[el.id]) {
      const liste = [...(elsRef.current[el.id].daten.eingetragen || []), { wohin: erg.wohin, titel: erg.titel, beginn: erg.beginn || null, an: erg.an || null, von: ich }]
      setzeEl(el.id, { daten: { eingetragen: liste.slice(-5), ...(erg.wohin === 'todo' ? { todo: true } : {}) } }, { sofort: true })
    }
    const wann = erg.beginn ? new Date(erg.beginn).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' (DE)' : ''
    const t = erg.telegram || {}
    const zeilen = [erg.wohin === 'kalender' ? `Im Kalender: ${erg.titel} · ${wann}` : `ToDo angelegt: ${erg.titel}${erg.an ? ' → ' + erg.an : ''}`]
    if (t.ok?.length) zeilen.push(`Telegram an ${t.ok.join(', ')}`)
    if (t.fehlt?.length) zeilen.push(`Ohne Telegram-ID: ${t.fehlt.join(', ')}`)
    if (t.fehler?.length) zeilen.push(`Telegram NICHT angekommen: ${t.fehler.join(', ')}`)
    setMeldung({ text: zeilen.join('\n'), warn: !!(t.fehlt?.length || t.fehler?.length) })
    setTimeout(() => setMeldung(m => (m && !m.warn ? null : m)), 6000)
  }

  const titelSpeichern = async () => {
    const t = titel.trim()
    if (!t || t === board.titel) { setTitel(board.titel); return }
    try { await boardAendern(board.id, { titel: t }, ich); board.titel = t }
    catch (e) { setFehler('Titel nicht gespeichert: ' + e.message) }
  }

  // ── Darstellung ──
  const liste = Object.values(els).sort((a, b) => ((a.typ === 'rahmen' ? 0 : 1) - (b.typ === 'rahmen' ? 0 : 1)) || (a.z || 0) - (b.z || 0))
  const selEl = sel ? els[sel] : null
  const anwesend = Object.values(andere)
  const andereNamen = [...new Set(anwesend.map(a => a.name).filter(n => n && n !== ich))]
  const namenImBoard = new Set(Object.values(els).filter(e => e.typ === 'person').map(e => lc(e.daten.name)))

  const WERKZEUGE = [
    { key: 'auswahl', Icon: MousePointer2, label: 'Auswählen und verschieben' },
    { key: 'notiz', Icon: StickyNote, label: 'Notiz (auf die Fläche tippen)' },
    { key: 'rahmen', Icon: Square, label: 'Rahmen', desktop: true },
    { key: 'text', Icon: Type, label: 'Text', desktop: true },
    { key: 'pfeil', Icon: MoveUpRight, label: 'Pfeil: erst Start-, dann Zielkarte anklicken', desktop: true },
  ].filter(w => !handy || !w.desktop)

  const knopf = (aktiv) => ({
    width: 38, height: 38, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: `1px solid ${aktiv ? 'var(--border-bright)' : 'transparent'}`, background: aktiv ? 'var(--bg-card2)' : 'transparent',
    color: aktiv ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer', padding: 0,
  })

  // Auswahl-Leiste über dem gewählten Element (Bildschirm-Koordinaten)
  let leiste = null
  if (selEl && !zieht) {
    let bx, by
    if (selEl.typ === 'pfeil') {
      const a = els[selEl.daten.von], b = els[selEl.daten.nach]
      if (a && b) { const m1 = mitte(a), m2 = mitte(b); bx = (m1.x + m2.x) / 2; by = (m1.y + m2.y) / 2 - 20 }
    } else { bx = selEl.x + selEl.w / 2; by = selEl.y }
    // Mittig über dem Element, aber nie über den Rand der Fläche hinaus
    // (sonst sind am linken Rand die Farbknöpfe abgeschnitten)
    const breite = flaecheRef.current?.clientWidth || 0
    const halb = Math.min(265, breite / 2)
    if (bx != null) leiste = { x: Math.max(halb + 8, Math.min(breite - halb - 8, bx * view.k + view.x)), y: Math.max(56, by * view.k + view.y - 52) }
  }

  return (
    <div className="board-editor" style={{ display: 'flex', flexDirection: 'column', minHeight: 420, border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', background: 'var(--bg-card)' }}>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

        {/* Werkzeuge */}
        <div style={{ width: 52, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, paddingTop: 10 }}>
          {WERKZEUGE.map(w => (
            <button key={w.key} type="button" title={w.label} aria-label={w.label} aria-pressed={werkzeug === w.key}
              className="board-knopf" onClick={() => { setWerkzeug(w.key); setPfeilStart(null) }} style={knopf(werkzeug === w.key)}>
              <w.Icon size={18} />
            </button>
          ))}
          <div style={{ width: 24, height: 1, background: 'var(--border)', margin: '4px 0' }} />
          <button type="button" title="Team" aria-label="Team-Liste" className="board-knopf" onClick={() => setTeamOffen(o => !o)} style={knopf(teamOffen)}>
            <Users size={18} />
          </button>
        </div>

        {/* Fläche */}
        <div ref={flaecheRef} data-flaeche="1"
          onPointerDown={aufFlaecheRunter} onPointerMove={bewegen} onPointerUp={loslassen} onPointerCancel={loslassen}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const name = e.dataTransfer.getData('text/board-person'); if (name) personDazu(name, e.clientX, e.clientY) }}
          style={{
            flex: 1, position: 'relative', overflow: 'hidden', touchAction: 'none', userSelect: 'none',
            cursor: werkzeug === 'auswahl' ? (dragRef.current?.art === 'pan' ? 'grabbing' : 'default') : 'crosshair',
            backgroundColor: 'var(--bg-base)',
            backgroundImage: 'radial-gradient(var(--border-bright) 1px, transparent 1px)',
            backgroundSize: `${22 * view.k}px ${22 * view.k}px`,
            backgroundPosition: `${view.x}px ${view.y}px`,
          }}>

          <div data-flaeche="1" style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: '0 0' }}>
            {/* Pfeile unter allem außer Rahmen */}
            <svg style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible' }}>
              <defs>
                <marker id="board-spitze" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0L10 5L0 10z" fill="#6d6daa" />
                </marker>
              </defs>
              {liste.filter(e => e.typ === 'pfeil').map(p => {
                const a = els[p.daten.von], b = els[p.daten.nach]
                if (!a || !b) return null
                const s = randpunkt(a, mitte(b)), z = randpunkt(b, mitte(a))
                const gewaehlt = sel === p.id
                return (
                  <g key={p.id} onPointerDown={ev => aufElementRunter(ev, p)} style={{ cursor: 'pointer' }}>
                    <line x1={s.x} y1={s.y} x2={z.x} y2={z.y} stroke="transparent" strokeWidth={16} />
                    <line x1={s.x} y1={s.y} x2={z.x} y2={z.y} stroke={gewaehlt ? '#a78bfa' : '#6d6daa'} strokeWidth={gewaehlt ? 3 : 2} markerEnd="url(#board-spitze)" />
                  </g>
                )
              })}
            </svg>

            {liste.filter(e => e.typ !== 'pfeil').map(el => {
              const gewaehlt = sel === el.id
              const imEdit = bearbeiten === el.id
              const ring = gewaehlt ? '0 0 0 2px #a78bfa' : pfeilStart === el.id ? '0 0 0 2px #22d3ee' : 'none'
              const basis = { position: 'absolute', left: el.x, top: el.y, width: el.w, boxSizing: 'border-box' }
              const griff = gewaehlt && (el.typ === 'rahmen' || el.typ === 'notiz') && (
                <span onPointerDown={ev => aufGriffRunter(ev, el)} style={{ position: 'absolute', right: -7, bottom: -7, width: 14, height: 14, borderRadius: 4, background: '#a78bfa', border: '2px solid var(--bg-base)', cursor: 'nwse-resize' }} />
              )

              if (el.typ === 'rahmen') {
                const f = RAHMEN_FARBEN[el.daten.farbe] || RAHMEN_FARBEN.grau
                return (
                  <div key={el.id} onPointerDown={ev => aufElementRunter(ev, el)} onDoubleClick={() => setBearbeiten(el.id)}
                    style={{ ...basis, height: el.h, background: f.flaeche, border: `1px solid ${f.rand}`, borderRadius: 14, boxShadow: ring }}>
                    <div style={{ padding: '10px 12px' }}>
                      {imEdit ? (
                        <input autoFocus value={el.daten.titel || ''} onChange={e => setzeEl(el.id, { daten: { titel: e.target.value } })}
                          onBlur={() => setBearbeiten(null)} onKeyDown={e => { if (e.key === 'Enter') setBearbeiten(null) }}
                          onPointerDown={e => e.stopPropagation()}
                          style={{ width: '100%', background: 'var(--bg-card)', border: `1px solid ${f.rand}`, borderRadius: 6, color: f.titel, fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '4px 6px', fontFamily: 'inherit' }} />
                      ) : (
                        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: f.titel }}>{el.daten.titel || 'Rahmen'}</span>
                      )}
                    </div>
                    {griff}
                  </div>
                )
              }

              if (el.typ === 'notiz') {
                const f = NOTIZ_FARBEN[el.daten.farbe] || NOTIZ_FARBEN.gelb
                const punkte = el.daten.punkte || []
                return (
                  <div key={el.id} onPointerDown={ev => aufElementRunter(ev, el)} onDoubleClick={() => setBearbeiten(el.id)}
                    style={{ ...basis, minHeight: el.h, background: f.bg, color: f.fg, borderRadius: 3, padding: '10px 12px 8px', boxShadow: `0 10px 24px rgba(0,0,0,0.35)${gewaehlt ? ', 0 0 0 2px #a78bfa' : ''}`, display: 'flex', flexDirection: 'column' }}>
                    {imEdit ? (
                      <textarea autoFocus value={el.daten.text || ''} onChange={e => setzeEl(el.id, { daten: { text: e.target.value } })}
                        onBlur={() => setBearbeiten(null)} onPointerDown={e => e.stopPropagation()} placeholder="Idee …"
                        style={{ flex: 1, minHeight: el.h - 40, background: 'transparent', border: 'none', outline: 'none', resize: 'none', color: f.fg, fontFamily: "'Caveat', 'Segoe Print', 'Comic Sans MS', cursive", fontSize: 21, fontWeight: 700, lineHeight: 1.1, padding: 0, width: '100%' }} />
                    ) : (
                      <div style={{ flex: 1, fontFamily: "'Caveat', 'Segoe Print', 'Comic Sans MS', cursive", fontSize: 21, fontWeight: 700, lineHeight: 1.1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                        {el.daten.text || <span style={{ opacity: 0.45 }}>Doppelklick zum Schreiben</span>}
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, gap: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
                        {el.daten.von}
                        {el.daten.todo && <span title="Als ToDo angelegt" style={{ display: 'inline-flex' }}><CheckSquare size={11} /></span>}
                        {(el.daten.eingetragen || []).some(x => x.wohin === 'kalender') && (
                          <span title={'Im Kalender: ' + el.daten.eingetragen.filter(x => x.wohin === 'kalender').map(x => x.titel).join(', ')} style={{ display: 'inline-flex' }}><CalendarPlus size={11} /></span>
                        )}
                      </span>
                      <span style={{ display: 'flex', gap: 3 }} title={punkte.join(', ')}>
                        {punkte.map(p => <span key={p} style={{ width: 10, height: 10, borderRadius: 5, background: farbeVon(p), border: '1px solid rgba(0,0,0,0.15)' }} />)}
                      </span>
                    </div>
                    {griff}
                  </div>
                )
              }

              if (el.typ === 'person') {
                const info = teamInfo[lc(el.daten.name)] || {}
                const zeile = info.leitung ? info.leitung : info.models?.length ? info.models.join(', ') : ''
                return (
                  <div key={el.id} onPointerDown={ev => aufElementRunter(ev, el)} onDoubleClick={() => setBearbeiten(el.id)}
                    style={{ ...basis, height: el.h, background: 'var(--bg-card)', border: `1px solid ${el.daten.rolle ? '#0891b2' : 'var(--border-bright)'}`, borderRadius: 11, padding: '8px 11px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: ring, color: 'var(--text-primary)' }}>
                    <span style={{ width: 32, height: 32, borderRadius: 16, background: farbeVon(el.daten.name), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                      {String(el.daten.name || '?').slice(0, 1).toUpperCase()}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 700 }}>
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{el.daten.name}</span>
                        {imEdit ? (
                          <input autoFocus value={el.daten.rolle || ''} placeholder="Rolle, z. B. Lead" onChange={e => setzeEl(el.id, { daten: { rolle: e.target.value.slice(0, 24) } })}
                            onBlur={() => setBearbeiten(null)} onKeyDown={e => { if (e.key === 'Enter') setBearbeiten(null) }} onPointerDown={e => e.stopPropagation()}
                            style={{ width: 110, fontSize: 11, padding: '2px 6px', borderRadius: 5, border: '1px solid #0891b2', background: 'var(--bg-base)', color: 'var(--text-primary)', fontFamily: 'inherit' }} />
                        ) : el.daten.rolle ? (
                          <span style={{ fontSize: 9.5, fontWeight: 800, color: '#070710', background: '#22d3ee', borderRadius: 4, padding: '1px 6px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{el.daten.rolle}</span>
                        ) : null}
                      </div>
                      {zeile && <div style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{zeile}</div>}
                    </div>
                    {info.proStunde != null && <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>{formatMoneyShort(info.proStunde)}/h</span>}
                  </div>
                )
              }

              // text
              return (
                <div key={el.id} onPointerDown={ev => aufElementRunter(ev, el)} onDoubleClick={() => setBearbeiten(el.id)}
                  style={{ ...basis, minHeight: el.h, fontSize: el.daten.groesse || 22, fontWeight: 700, color: 'var(--text-primary)', boxShadow: ring, borderRadius: 6, padding: 2 }}>
                  {imEdit ? (
                    <textarea autoFocus value={el.daten.text || ''} onChange={e => setzeEl(el.id, { daten: { text: e.target.value } })}
                      onBlur={() => setBearbeiten(null)} onPointerDown={e => e.stopPropagation()} placeholder="Überschrift …" rows={2}
                      style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', resize: 'none', color: 'inherit', font: 'inherit', padding: 0 }} />
                  ) : (
                    <div style={{ whiteSpace: 'pre-wrap' }}>{el.daten.text || <span style={{ opacity: 0.4 }}>Text</span>}</div>
                  )}
                </div>
              )
            })}

            {/* Cursor der anderen */}
            {anwesend.filter(a => a.cursor).map(a => (
              <div key={a.name} style={{ position: 'absolute', left: a.cursor.x, top: a.cursor.y, pointerEvents: 'none', display: 'flex', alignItems: 'flex-start', gap: 2, transform: `scale(${1 / view.k})`, transformOrigin: '0 0' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill={farbeVon(a.name)} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round"><path d="M4 3l7 17 2.5-7.5L21 10z" /></svg>
                <span style={{ background: farbeVon(a.name), color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 7px', borderRadius: 6, marginTop: 12, whiteSpace: 'nowrap' }}>{a.name}</span>
              </div>
            ))}
          </div>

          {/* Kopfzeile */}
          <div style={{ position: 'absolute', left: 12, top: 10, right: 12, display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 11, padding: '4px 8px 4px 4px', pointerEvents: 'auto', minWidth: 0 }}>
              <button type="button" className="board-knopf" onClick={onZurueck} aria-label="Zurück zu allen Boards" title="Alle Boards" style={{ ...knopf(false), width: 32, height: 32 }}><ArrowLeft size={16} /></button>
              <input value={titel} onChange={e => setTitel(e.target.value.slice(0, 120))} onBlur={titelSpeichern} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                aria-label="Board-Titel" style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: 14, fontWeight: 700, fontFamily: 'inherit', width: handy ? 150 : 260, padding: '4px 2px', outline: 'none' }} />
            </div>
            <div style={{ flex: 1 }} />
            {/* Ohne Auswahl: leeres Formular. Mit Auswahl füllt die Leiste am Element vor. */}
            <button type="button" className="board-knopf board-text-knopf" onClick={() => setEintragen({ el: null, start: 'kalender', vorschlag: { notiz: `Aus dem Board „${titel}“` } })}
              title="Termin oder ToDo eintragen" style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 11, padding: '8px 11px', color: 'var(--text-primary)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', pointerEvents: 'auto' }}>
              <CalendarPlus size={15} /> {handy ? '' : 'Eintragen'}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 11, padding: '5px 10px 5px 6px', pointerEvents: 'auto' }}>
              <div style={{ display: 'flex' }}>
                {[ich, ...anwesend.map(a => a.name)].filter((n, i, a) => n && a.indexOf(n) === i).map((n, i) => (
                  <span key={n} title={n} style={{ width: 26, height: 26, borderRadius: 13, background: farbeVon(n), color: '#fff', border: '2px solid var(--bg-card)', marginLeft: i ? -7 : 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                    {String(n).slice(0, 1).toUpperCase()}
                  </span>
                ))}
              </div>
              {/* Gezählt werden Menschen, nicht Fenster: Chris am Rechner und am Handy ist einer */}
              <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{andereNamen.length ? `${andereNamen.length + 1} live` : 'nur du'}</span>
            </div>
          </div>

          {/* Auswahl-Leiste */}
          {leiste && selEl && (
            <div onPointerDown={e => e.stopPropagation()} style={{ position: 'absolute', left: leiste.x, top: leiste.y, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-card)', border: '1px solid var(--border-bright)', borderRadius: 11, padding: 5, boxShadow: '0 10px 30px rgba(0,0,0,0.4)', zIndex: 5, whiteSpace: 'nowrap' }}>
              {selEl.typ === 'notiz' && Object.entries(NOTIZ_FARBEN).map(([k, f]) => (
                <button key={k} type="button" className="board-knopf" aria-label={`Farbe ${k}`} onClick={() => setzeEl(selEl.id, { daten: { farbe: k } }, { sofort: true })}
                  style={{ width: 24, height: 24, borderRadius: 12, padding: 0, background: f.bg, border: selEl.daten.farbe === k ? '2px solid var(--text-primary)' : '1px solid rgba(0,0,0,0.2)', cursor: 'pointer' }} />
              ))}
              {selEl.typ === 'rahmen' && Object.entries(RAHMEN_FARBEN).map(([k, f]) => (
                <button key={k} type="button" className="board-knopf" aria-label={`Farbe ${k}`} onClick={() => setzeEl(selEl.id, { daten: { farbe: k } }, { sofort: true })}
                  style={{ width: 24, height: 24, borderRadius: 12, padding: 0, background: f.titel, border: selEl.daten.farbe === k ? '2px solid var(--text-primary)' : '1px solid transparent', cursor: 'pointer' }} />
              ))}
              {selEl.typ === 'notiz' && (<>
                <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 3px' }} />
                <button type="button" className="board-knopf board-text-knopf" onClick={() => punktUmschalten(selEl)} title="Punkt geben / zurücknehmen"
                  style={{ ...knopf((selEl.daten.punkte || []).includes(ich)), width: 'auto', height: 30, padding: '0 9px', fontSize: 12, fontWeight: 700, gap: 5 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 5, background: farbeVon(ich) }} /> Punkt
                </button>
              </>)}
              {selEl.typ !== 'pfeil' && (<>
                <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 3px' }} />
                <button type="button" className="board-knopf board-text-knopf" onClick={() => setEintragen({ el: selEl, start: 'kalender', vorschlag: vorschlagAus(selEl) })} title="In den Kalender eintragen"
                  style={{ ...knopf(false), width: 'auto', height: 30, padding: '0 9px', fontSize: 12, fontWeight: 700, gap: 5 }}>
                  <CalendarPlus size={14} /> Kalender
                </button>
                <button type="button" className="board-knopf board-text-knopf" onClick={() => setEintragen({ el: selEl, start: 'todo', vorschlag: vorschlagAus(selEl) })} title="Als ToDo anlegen"
                  style={{ ...knopf(false), width: 'auto', height: 30, padding: '0 9px', fontSize: 12, fontWeight: 700, gap: 5 }}>
                  <CheckSquare size={14} /> ToDo
                </button>
              </>)}
              {selEl.typ !== 'pfeil' && (
                <button type="button" className="board-knopf board-text-knopf" onClick={() => setBearbeiten(selEl.id)}
                  style={{ ...knopf(false), width: 'auto', height: 30, padding: '0 9px', fontSize: 12, fontWeight: 700 }}>
                  {selEl.typ === 'person' ? 'Rolle' : selEl.typ === 'rahmen' ? 'Umbenennen' : 'Schreiben'}
                </button>
              )}
              <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 3px' }} />
              <button type="button" className="board-knopf" onClick={() => loeschen(selEl.id)} aria-label="Löschen" title="Löschen (Entf)" style={{ ...knopf(false), width: 30, height: 30, color: '#f87171' }}>
                <Trash2 size={15} />
              </button>
            </div>
          )}

          {/* Unten: Zoom + Hinweise */}
          {/* Am Handy oben statt unten: unten links sitzt der Inkognito-Schalter,
              unten rechts sitzen Chat und Glocken */}
          <div style={{ position: 'absolute', left: 12, ...(handy ? { top: 108, flexWrap: 'wrap' } : { bottom: 12 }), display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 3 }}>
              <button type="button" className="board-knopf" aria-label="Verkleinern" onClick={() => zoomen(1 / 1.2)} style={{ ...knopf(false), width: 30, height: 30 }}><Minus size={14} /></button>
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)', minWidth: 38, textAlign: 'center' }}>{Math.round(view.k * 100)}%</span>
              <button type="button" className="board-knopf" aria-label="Vergrößern" onClick={() => zoomen(1.2)} style={{ ...knopf(false), width: 30, height: 30 }}><Plus size={14} /></button>
              <button type="button" className="board-knopf" aria-label="Alles zeigen" title="Alles zeigen" onClick={() => alleZeigen()} style={{ ...knopf(false), width: 30, height: 30 }}><Maximize size={14} /></button>
            </div>
            {werkzeug === 'pfeil' && <span style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 9, padding: '6px 10px' }}>{pfeilStart ? 'Jetzt die Zielkarte anklicken' : 'Startkarte anklicken'}</span>}
            {werkzeug === 'notiz' && <span style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 9, padding: '6px 10px' }}>Auf die Fläche tippen</span>}
            {geloescht && (
              <button type="button" className="board-knopf board-text-knopf" onClick={rueckgaengig} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-card)', border: '1px solid var(--border-bright)', borderRadius: 9, padding: '6px 10px', color: 'var(--text-primary)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                <Undo2 size={14} /> Gelöscht — rückgängig
              </button>
            )}
          </div>

          {laden && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Board wird geladen …</div>}
          {meldung && !fehler && (
            <div role="status" style={{ position: 'absolute', right: 12, bottom: 12, maxWidth: 380, display: 'flex', gap: 8, alignItems: 'flex-start', background: 'var(--bg-card)', border: `1px solid ${meldung.warn ? '#92400e' : '#14532d'}`, borderRadius: 10, padding: '9px 11px', fontSize: 12, color: meldung.warn ? 'var(--ton-gelb)' : 'var(--ton-gruen)', whiteSpace: 'pre-line', zIndex: 7 }}>
              <span style={{ flex: 1 }}>{meldung.text}</span>
              <button type="button" className="board-knopf" onClick={() => setMeldung(null)} aria-label="Meldung schließen" style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}><X size={14} /></button>
            </div>
          )}
          {fehler && (
            <div style={{ position: 'absolute', right: 12, bottom: 12, maxWidth: 360, display: 'flex', gap: 8, alignItems: 'flex-start', background: 'var(--bg-card)', border: '1px solid #7f1d1d', borderRadius: 10, padding: '8px 10px', fontSize: 12, color: 'var(--ton-rot)' }}>
              <span style={{ flex: 1 }}>{fehler}</span>
              <button type="button" className="board-knopf" onClick={() => setFehler(null)} aria-label="Meldung schließen" style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}><X size={14} /></button>
            </div>
          )}
        </div>

        {/* Team-Liste */}
        {teamOffen && (
          <div style={{ width: handy ? '100%' : 280, position: handy ? 'absolute' : 'relative', right: 0, top: handy ? 0 : undefined, bottom: handy ? 0 : undefined, zIndex: 6, flexShrink: 0, borderLeft: '1px solid var(--border)', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: '12px 14px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Team — {handy ? 'antippen' : 'aufs Board ziehen'}</span>
              <button type="button" className="board-knopf" onClick={() => setTeamOffen(false)} aria-label="Team-Liste schließen" style={{ ...knopf(false), width: 28, height: 28 }}><X size={14} /></button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[...(team?.leitung || []).map(l => ({ name: l.name, zeile: l.rolle })), ...(team?.chatter || []).map(c => ({ name: c.name, zeile: c.schicht ? `${c.schicht}${c.models.length ? ' · ' + c.models.join(', ') : ''}` : 'diese Woche nicht im Plan', proStunde: c.proStunde }))]
                .filter((p, i, a) => a.findIndex(x => lc(x.name) === lc(p.name)) === i)
                .map(p => {
                  const drauf = namenImBoard.has(lc(p.name))
                  return (
                    <button key={p.name} type="button" className="board-knopf board-zeile" draggable={!handy}
                      onDragStart={e => e.dataTransfer.setData('text/board-person', p.name)}
                      onClick={() => { personDazu(p.name); if (handy) setTeamOffen(false) }}
                      title={drauf ? 'Schon auf dem Board — noch einmal hinzufügen' : 'Aufs Board'}
                      style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, padding: '7px 9px', cursor: 'grab', opacity: drauf ? 0.5 : 1, color: 'var(--text-primary)', fontFamily: 'inherit' }}>
                      <span style={{ width: 26, height: 26, borderRadius: 13, background: farbeVon(p.name), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{String(p.name).slice(0, 1).toUpperCase()}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700 }}>{p.name}</span>
                        <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{drauf ? 'schon auf dem Board' : p.zeile}</span>
                      </span>
                      {p.proStunde != null && <span style={{ fontFamily: 'monospace', fontSize: 10.5, color: 'var(--text-secondary)' }}>{formatMoneyShort(p.proStunde)}/h</span>}
                    </button>
                  )
                })}
            </div>
            <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>
              $/h = letzte 14 erfasste Tage. Schicht und Models aus dem Dienstplan dieser Woche. Das Board ändert am Dienstplan nichts.
            </div>
          </div>
        )}
      </div>

      {/* v4.74.0: Kalender / ToDo direkt aus dem Board */}
      {eintragen && (
        <BoardEintragen vorschlag={eintragen.vorschlag} start={eintragen.start} team={team} ich={ich}
          onFertig={eingetragen} onAbbrechen={() => setEintragen(null)} />
      )}
    </div>
  )
}
