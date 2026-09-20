import { supabase } from './supabase'
import { datumInZone, BERLIN } from './zeit'
import { montagVon } from './jetzt'

// ── Boards: Daten und Vorlagen (v4.73.0) ────────────────────────────────────
//
// Ein Board ist eine Zeile in `boards`, alles darauf liegt als eigene Zeile in
// `board_elemente` (sql/boards.sql). Eine Zeile je Element, weil zwei Leute
// gleichzeitig daran arbeiten: Chris zieht Dylan in die Spätschicht, Rey
// schreibt eine Notiz — beides landet, keiner überschreibt den anderen.
// Bewegt zwei Leute DASSELBE Element, gewinnt der Letzte. Das ist bei einem
// Whiteboard verschmerzbar.
//
// Element-Typen und was in `daten` steht:
//   rahmen  { titel, farbe }
//   notiz   { text, farbe, von, punkte: [namen], todo: bool }
//   person  { name, rolle }
//   text    { text, groesse }
//   pfeil   { von: elementId, nach: elementId }   (x/y/w/h ungenutzt)

export const NOTIZ_FARBEN = {
  gelb:  { bg: '#fde68a', fg: '#3b2f05' },
  rosa:  { bg: '#fbcfe8', fg: '#4a0d2e' },
  tuerkis: { bg: '#a5f3fc', fg: '#083344' },
  gruen: { bg: '#bbf7d0', fg: '#052e16' },
  lila:  { bg: '#ddd6fe', fg: '#2e1065' },
}

// Rahmenfarben: Rand, Fläche, Titel. Dieselben Töne wie die Schichtfarben im
// Dienstplan (Vorschicht blau, Früh gelb, Spät türkis, Nacht lila).
export const RAHMEN_FARBEN = {
  lila:  { rand: '#3b2a6e', flaeche: 'rgba(124,58,237,0.07)', titel: '#a78bfa' },
  gelb:  { rand: '#4a3a1a', flaeche: 'rgba(245,158,11,0.06)', titel: '#fbbf24' },
  tuerkis: { rand: '#16404a', flaeche: 'rgba(6,182,212,0.06)', titel: '#22d3ee' },
  blau:  { rand: '#1e3a6e', flaeche: 'rgba(59,130,246,0.07)', titel: '#60a5fa' },
  gruen: { rand: '#14532d', flaeche: 'rgba(16,185,129,0.06)', titel: '#34d399' },
  grau:  { rand: '#2e2e5a', flaeche: 'rgba(255,255,255,0.02)', titel: '#8888aa' },
}

export const VORLAGEN = [
  { key: 'team', titel: 'Team-Struktur', text: 'Leitung und Schichten als Rahmen, das Team dieser Woche schon eingeteilt.' },
  { key: 'nachrichten', titel: 'Massennachrichten', text: 'Vier Spalten: Ideen → Entwurf → Freigabe → Geplant.' },
  { key: 'leer', titel: 'Leeres Board', text: 'Nur die Fläche. Alles selbst anlegen.' },
]

const lc = (s) => String(s || '').trim().toLowerCase()

// ── Laden / Speichern ──

export async function ladeBoards() {
  const { data, error } = await supabase.from('boards').select('*')
    .eq('archiviert', false).order('aktualisiert_am', { ascending: false })
  if (error) throw error
  return data || []
}

export async function ladeElemente(boardId) {
  const { data, error } = await supabase.from('board_elemente').select('*').eq('board_id', boardId)
  if (error) throw error
  return data || []
}

export async function boardAnlegen({ titel, vorlage, ich, team }) {
  const { data: board, error } = await supabase.from('boards')
    .insert({ titel, vorlage, erstellt_von: ich, aktualisiert_von: ich }).select().single()
  if (error) throw error
  const elemente = vorlageElemente(vorlage, team, ich).map(e => ({ ...e, board_id: board.id, erstellt_von: ich, aktualisiert_von: ich }))
  if (elemente.length) {
    const { error: e2 } = await supabase.from('board_elemente').insert(elemente)
    if (e2) throw e2
  }
  return board
}

export async function boardAendern(id, felder, ich) {
  const { error } = await supabase.from('boards')
    .update({ ...felder, aktualisiert_von: ich, aktualisiert_am: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

// Element anlegen oder ändern. Die id vergibt der Browser (crypto.randomUUID),
// damit das Element sofort auf dem Board steht und der Realtime-Rücklauf es
// wiedererkennt, statt es doppelt einzufügen.
export async function elementSpeichern(el, ich) {
  const zeile = {
    id: el.id, board_id: el.board_id, typ: el.typ,
    x: el.x, y: el.y, w: el.w, h: el.h, z: el.z || 0,
    daten: el.daten || {}, aktualisiert_von: ich, aktualisiert_am: new Date().toISOString(),
  }
  if (el.neu) zeile.erstellt_von = ich
  const { error } = await supabase.from('board_elemente').upsert(zeile)
  if (error) throw error
}

export async function elementLoeschen(id) {
  const { error } = await supabase.from('board_elemente').delete().eq('id', id)
  if (error) throw error
}

export const neueId = () => (crypto?.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  }))

// ── Team fürs Board ──
// Wer ist dabei, in welcher Schicht arbeitet er diese Woche meistens, auf
// welchen Models — und was bringt er pro Stunde (letzte 14 erfasste Tage).
// Der Stundenumsatz steht neben dem Namen, damit man beim Umbauen sieht, wen
// man verschiebt.
export async function ladeTeam(chatterSnapshots = []) {
  const heute = datumInZone(new Date(), BERLIN).tag
  const [chRes, rolRes, schedRes, modRes, aliasRes] = await Promise.all([
    supabase.from('chatters_contact').select('name, active').order('name'),
    supabase.from('user_roles').select('display_name, role, roles, status'),
    supabase.from('schedule').select('assignments').eq('week_start', montagVon(heute)).eq('status', 'live').maybeSingle(),
    supabase.from('models_contact').select('id, name'),
    supabase.from('chatter_aliases').select('chatter_name, csv_name'),
  ])
  const rollen = rolRes.data || []
  const inaktiv = new Set(rollen.filter(r => r.status && r.status !== 'active').map(r => lc(r.display_name)))
  const leitung = rollen
    .filter(r => r.status !== 'suspended' && r.status !== 'offboarded')
    .filter(r => [r.role, ...(r.roles || [])].some(x => x === 'admin' || x === 'manager'))
    .map(r => ({ name: r.display_name, rolle: [r.role, ...(r.roles || [])].includes('admin') ? 'Admin' : 'Manager' }))
    .filter(r => r.name)

  const modelName = Object.fromEntries((modRes.data || []).map(m => [String(m.id), m.name]))
  const plan = {}   // lc(name) → { schichten: {Früh: n}, models: Set }
  for (const [key, val] of Object.entries(schedRes.data?.assignments || {})) {
    const [modelId, , shift] = key.split('__')
    for (const name of [val?.chatter, val?.trainee]) {
      if (!name || name === '__FREI__') continue
      const p = (plan[lc(name)] ||= { schichten: {}, models: new Set() })
      p.schichten[shift] = (p.schichten[shift] || 0) + 1
      if (modelName[modelId]) p.models.add(modelName[modelId])
    }
  }

  // $/h: CSV-Namen über chatter_aliases auf den Kontakt-Namen abbilden
  const csvZuName = {}
  for (const a of aliasRes.data || []) if (a.csv_name && a.chatter_name) csvZuName[lc(a.csv_name)] = a.chatter_name
  const letzte = [...chatterSnapshots].sort((a, b) => a.businessDate.localeCompare(b.businessDate)).slice(-14)
  const summe = {}
  for (const snap of letzte) for (const r of snap.rows || []) {
    const name = lc(csvZuName[lc(r.name)] || r.name)
    const s = (summe[name] ||= { umsatz: 0, min: 0 })
    s.umsatz += r.revenue || 0
    s.min += r.activeMinutes || 0
  }

  const chatter = (chRes.data || [])
    .filter(c => c.active !== false && !inaktiv.has(lc(c.name)))
    .map(c => {
      const p = plan[lc(c.name)]
      const haupt = p ? Object.entries(p.schichten).sort((a, b) => b[1] - a[1])[0][0] : null
      const s = summe[lc(c.name)]
      return {
        name: c.name,
        schicht: haupt,
        models: p ? [...p.models] : [],
        proStunde: s && s.min >= 60 ? s.umsatz / (s.min / 60) : null,
      }
    })
  return { leitung, chatter }
}

// ── Vorlagen ──

const SCHICHT_RAHMEN = [
  { schicht: 'Vorschicht', titel: 'Vorschicht', farbe: 'blau' },
  { schicht: 'Früh', titel: 'Frühschicht', farbe: 'gelb' },
  { schicht: 'Spät', titel: 'Spätschicht', farbe: 'tuerkis' },
  { schicht: 'Nacht', titel: 'Nachtschicht', farbe: 'lila' },
]

function vorlageElemente(vorlage, team, ich) {
  const els = []
  const add = (e) => { const id = neueId(); els.push({ id, z: els.length, daten: {}, ...e }); return id }

  if (vorlage === 'team') {
    const leitung = team?.leitung || []
    // Vorschicht nur, wenn diese Woche jemand dort hauptsächlich arbeitet
    const spalten = SCHICHT_RAHMEN.filter(s => s.schicht !== 'Vorschicht' || (team?.chatter || []).some(c => c.schicht === 'Vorschicht'))
    // Leitung mittig über den Schicht-Rahmen. Die Rolle (Admin) steht als
    // Infozeile auf der Karte; das Schild bleibt frei für "Lead", "Pate" …
    const lw = Math.max(320, leitung.length * 170 + 30)
    const lx = (spalten.length * 360 - 30) / 2 - lw / 2
    add({ typ: 'rahmen', x: lx, y: 40, w: lw, h: 130, daten: { titel: 'Leitung', farbe: 'lila' } })
    leitung.forEach((p, i) => add({ typ: 'person', x: lx + 15 + i * 170, y: 82, w: 155, h: 64, daten: { name: p.name, rolle: '' } }))
    spalten.forEach((s, i) => {
      const leute = (team?.chatter || []).filter(c => c.schicht === s.schicht)
      const h = Math.max(200, 60 + leute.length * 74)
      const x = i * 360
      add({ typ: 'rahmen', x, y: 240, w: 330, h, daten: { titel: s.titel, farbe: s.farbe } })
      leute.forEach((c, j) => add({ typ: 'person', x: x + 16, y: 290 + j * 74, w: 298, h: 64, daten: { name: c.name, rolle: '' } }))
    })
    add({ typ: 'notiz', x: spalten.length * 360 + 20, y: 250, w: 190, h: 150, daten: { text: 'Personen ziehen, Rahmen umbenennen (Doppelklick), Notizen dazu …', farbe: 'gelb', von: ich, punkte: [] } })
  } else if (vorlage === 'nachrichten') {
    const spalten = [['Ideen', 'gelb'], ['Entwurf', 'lila'], ['Freigabe', 'tuerkis'], ['Geplant', 'gruen']]
    spalten.forEach(([titel, farbe], i) => add({ typ: 'rahmen', x: i * 300, y: 40, w: 280, h: 560, daten: { titel, farbe } }))
    add({ typ: 'notiz', x: 20, y: 100, w: 240, h: 130, daten: { text: 'Idee als Notiz hier rein, dann nach rechts weiterschieben', farbe: 'gelb', von: ich, punkte: [] } })
  }
  return els
}
