import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { supabase } from '../supabase'
import { logActivity } from '../activity'

// ── Wirkung als Kurve (v5.5.0) ─────────────────────────────────────────────
// Pro Account: Aufrufe nach Tagen seit dem Posten. Jede Linie ist eines
// unserer Reels (Pink = mit Skript, Lila = ohne Skript). Dünn grau = die
// eigenen Reels des Models, jedes einzeln (v5.6.1: vorher Median — der war
// aus verschiedenen Reels zusammengestückelt und fiel teils wieder ab, weil
// es Verlauf erst seit dem 27.09. gibt). Reels mit nur einem Messpunkt
// erscheinen als Punkt. Ein Reel in der Liste antippen → hervorgehoben.
//
// Faktor (v5.6.0, rechnet das Dashboard selbst): Aufrufe des Reels an Tag 7
// geteilt durch den Median der früheren Reels desselben Accounts (60 Tage vor
// dem Posten, mind. 3) ebenfalls an Tag 7 — also bei gleichem Alter. Jüngere
// Reels: am heutigen Tag verglichen, grau mit * („vorläufig“). Fehlen
// Vergleichsreels mit Verlauf, steht der grobe Faktor der Pipeline da (~).
//
// Bereinigung Altdaten (Hinweis Pipeline 30.09.): bis einschließlich 30.09.
// kamen manche Reels mehrere Nächte mit altem Stand an. Aufeinanderfolgende
// Messpunkte mit exakt gleichen Aufrufen/Likes/Kommentaren zählen als einer.
//
// v5.24.0 Umbau (Wunsch Chris 02.10.: „unübersichtlich“): oben ein Urteil in
// einem Satz (unsere gegen die eigenen Reels des Models bei gleichem Alter),
// drei Zahlen, eine ruhige Kurve mit zwei Mittel-Linien (eigene Reels nur,
// wenn sie ab Tag 0/1 gemessen wurden — sonst schwebten Stücke im Bild), die
// Einzel-Linien eingeklappt. Eine Liste „Unsere Reels“ mit Filter Skript/ohne
// Skript und Sortierung Neueste/Beste/Schwächste ersetzt „Zuletzt gepostet“.
//
// Messfenster (sql/reel-messfenster.sql): 30 Tage ab Posten, danach
// abgeschlossen. „+30 Tage“ verlängert, beliebig oft. Die Pipeline misst nur,
// was in lyra.reel_messplan noch_messen = true hat.

const P = '#ec4899', V = '#8b5cf6', GR = '#8a8a99', G = '#10b981', ROT = '#ef4444', A = '#f59e0b', C = '#06b6d4'
const FENSTER = 30
const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 15px' }
const klein = { fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }
const knopf = (f, voll) => ({ padding: '5px 11px', borderRadius: 9, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', border: voll ? 'none' : `1px solid ${f}`, background: voll ? f : 'transparent', color: voll ? '#fff' : f, whiteSpace: 'nowrap' })
const farbe = (art) => art === 'skript' ? P : art === 'ohne_skript' ? V : GR
const faktorFarbe = (f) => f === null || f === undefined ? 'var(--text-muted)' : f >= 1.5 ? G : f < 0.7 ? ROT : 'var(--text-primary)'
const tagIso = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
const plusTage = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return tagIso(d) }
const tageZwischen = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000)
const median = (arr) => { const a = arr.filter(x => x !== null && x !== undefined).map(Number).sort((x, y) => x - y); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2 }
const kurz = (n) => n === null || n === undefined ? '—' : n >= 1000000 ? (n / 1000000).toFixed(1).replace('.', ',') + ' Mio' : n >= 10000 ? Math.round(n / 1000) + 'k' : Number(n).toLocaleString('de-DE')
const faktorText = (f) => f === null || f === undefined ? '—' : Number(f).toFixed(1).replace('.', ',') + '×'

// Tag seit Posten für eine Messung (Alter in Stunden, sonst Kalendertage)
const tagVon = (m) => m.alter_std !== null && m.alter_std !== undefined ? Math.floor(Number(m.alter_std) / 24) : (m.gepostet_am ? Math.max(0, tageZwischen(tagIso(m.gepostet_am), m.mess_tag || tagIso(m.gemessen_am))) : null)

const ALTDATEN_BIS = '2026-09-30'   // bis hierhin konnten alte Stände mehrfach ankommen

// Aufrufe an Tag t: gemessen oder zwischen zwei Messpunkten geschätzt (nie darüber hinaus)
function wertAm(r, t) {
  if (r.tage[t]) return r.tage[t].v
  const vor = r.ts.filter(x => x < t).pop(), nach = r.ts.find(x => x > t)
  if (vor === undefined || nach === undefined) return null
  const a = r.tage[vor].v, b = r.tage[nach].v
  return a + (b - a) * (t - vor) / (nach - vor)
}


// v5.25.0: Texte DE/EN (Poster mit Englisch) und eine Fassung fürs Model („deine eigenen“)
const TXT = {
  de: {
    loc: 'de-DE', besser: 'Unsere Reels laufen besser als die eigenen', schwaecher: 'Unsere Reels laufen schwächer als die eigenen', gleich: 'Unsere Reels laufen etwa so gut wie die eigenen',
    zu_wenig: 'Noch zu wenig Daten für einen Vergleich',
    zu_wenig_text: (n) => `Wir brauchen mindestens ein Reel von uns mit einem Tag Verlauf und zwei eigene Reels, die ab dem ersten Tag gemessen wurden (gerade: ${n}).`,
    verglichen: (t, u, e) => `Verglichen nach ${t} ${t === 1 ? 'Tag' : 'Tagen'}${t < 7 ? ' (mehr haben unsere Reels noch nicht, ab Tag 7 wird es genauer)' : ''}. Grundlage: ${u} ${u === 1 ? 'Reel' : 'Reels'} von uns, ${e} eigene.`,
    uns_mittel: 'Unsere (Mittel)', eigene: 'Model selbst', eigene_mittel: 'Model selbst (Mittel)', uns_mittel_k: 'unsere (Mittel)',
    reels30: 'Reels, 30 Tage', aufrufe_ges: 'Aufrufe gesamt', bestes: 'bestes Reel', ohne: 'ohne Skript', mit: 'mit Skript',
    kurve: 'So entwickeln sich die Aufrufe', hervor: 'hervorgehoben',
    einzeln_text: 'Jede Linie ist ein Reel. Ein Reel in der Liste antippen hebt es hervor.',
    mittel_text: 'Mittelwert pro Tag nach dem Posten. Eigene Reels zählen nur, wenn sie ab dem ersten Tag gemessen wurden.',
    tag: 'Tag', zurueck: '▴ zurück zum Mittel', einzeln: '▸ Alle Reels einzeln zeigen',
    liste: 'Unsere Reels', insgesamt: 'insgesamt', letzte30: 'in den letzten 30 Tagen',
    neueste: 'Neueste', beste: 'Beste', schwach: 'Schwächste', alle: 'Alle', chip_mit: 'Mit Skript', chip_ohne: 'Ohne Skript', aeltere: 'auch ältere',
    keine: (a) => `Keine Reels auf ${a}.`, tag_von: (a, b) => `Tag ${a} von ${b}`, fertig: 'abgeschlossen', von: (w) => `von ${w}`, verlaengert: 'verlängert',
    ansehen: 'ansehen', aufrufe: 'Aufrufe', waechst: '↗ wächst noch', alle_zeigen: (n) => `alle ${n} zeigen`, weniger: 'weniger zeigen',
    fuss: 'Faktor = Aufrufe im Vergleich zu den früheren Reels des Accounts bei gleichem Alter (Tag 7). Grün = besser, rot = schwächer, blass = noch keine 7 Tage alt (vorläufig), ~ = grob. Antippen hebt das Reel in der Kurve hervor.',
    fuss_fenster: 'Jedes Reel wird 30 Tage beobachtet, „+30 Tage“ verlängert.',
    keine_mess: (a) => `Für ${a} gibt es noch keine Messwerte. Sie werden jede Nacht eingetragen.`, db_fehlt: 'Messwerte: Datenbank noch nicht eingerichtet.',
    tip_grob: 'Grob: noch zu wenig Verlauf für den Vergleich bei gleichem Alter', tip_vorl: (t) => `Noch keine 7 Tage alt: verglichen an Tag ${t}, vorläufig`, tip_ok: 'An Tag 7 verglichen mit den früheren Reels des Accounts an Tag 7',
  },
  en: {
    loc: 'en-US', besser: 'Our reels are doing better than the creator’s own', schwaecher: 'Our reels are doing worse than the creator’s own', gleich: 'Our reels are doing about as well as the creator’s own',
    zu_wenig: 'Not enough data to compare yet',
    zu_wenig_text: (n) => `We need at least one of our reels with a day of history and two of the creator’s own reels measured from day one (currently: ${n}).`,
    verglichen: (t, u, e) => `Compared after ${t} ${t === 1 ? 'day' : 'days'}${t < 7 ? ' (our reels aren’t older yet, it gets more accurate from day 7)' : ''}. Based on ${u} ${u === 1 ? 'reel' : 'reels'} by us, ${e} own.`,
    uns_mittel: 'Ours (average)', eigene: 'Creator’s own', eigene_mittel: 'Creator’s own (average)', uns_mittel_k: 'ours (average)',
    reels30: 'Reels, 30 days', aufrufe_ges: 'Total views', bestes: 'best reel', ohne: 'no script', mit: 'with script',
    kurve: 'How the views develop', hervor: 'highlighted',
    einzeln_text: 'Each line is one reel. Tap a reel in the list to highlight it.',
    mittel_text: 'Average per day after posting. Own reels only count if they were measured from day one.',
    tag: 'Day', zurueck: '▴ back to average', einzeln: '▸ Show every reel',
    liste: 'Our reels', insgesamt: 'in total', letzte30: 'in the last 30 days',
    neueste: 'Newest', beste: 'Best', schwach: 'Weakest', alle: 'All', chip_mit: 'With script', chip_ohne: 'No script', aeltere: 'older ones too',
    keine: (a) => `No reels on ${a}.`, tag_von: (a, b) => `Day ${a} of ${b}`, fertig: 'finished', von: (w) => `by ${w}`, verlaengert: 'extended',
    ansehen: 'view', aufrufe: 'views', waechst: '↗ still growing', alle_zeigen: (n) => `show all ${n}`, weniger: 'show less',
    fuss: 'Factor = views compared to earlier reels of the account at the same age (day 7). Green = better, red = weaker, faded = not 7 days old yet (preliminary), ~ = rough. Tap to highlight the reel in the chart.',
    fuss_fenster: 'Every reel is tracked for 30 days.',
    keine_mess: (a) => `No measurements for ${a} yet. They are added every night.`, db_fehlt: 'Measurements: database not set up yet.',
    tip_grob: 'Rough: not enough history yet to compare at the same age', tip_vorl: (t) => `Not 7 days old yet: compared on day ${t}, preliminary`, tip_ok: 'Compared on day 7 with earlier reels of the account on day 7',
  },
}
// Fürs Model: „deine eigenen“ statt „Model selbst“
const MODEL_TXT = {
  besser: 'Unsere Reels laufen besser als deine eigenen', schwaecher: 'Unsere Reels laufen schwächer als deine eigenen', gleich: 'Unsere Reels laufen etwa so gut wie deine eigenen',
  eigene: 'Deine eigenen', eigene_mittel: 'Deine eigenen (Mittel)', liste: 'Unsere Reels für dich',
  mittel_text: 'Mittelwert pro Tag nach dem Posten. Deine eigenen Reels zählen nur, wenn sie ab dem ersten Tag gemessen wurden.',
  zu_wenig_text: (n) => `Wir brauchen mindestens ein Reel von uns mit einem Tag Verlauf und zwei deiner eigenen Reels, die ab dem ersten Tag gemessen wurden (gerade: ${n}).`,
}

function useSchmal(max = 768) {
  const q = `(max-width: ${max}px)`
  const [s, setS] = useState(() => { try { return window.matchMedia(q).matches } catch { return false } })
  useEffect(() => {
    let mq; try { mq = window.matchMedia(q) } catch { return }
    const f = () => setS(mq.matches)
    mq.addEventListener ? mq.addEventListener('change', f) : mq.addListener(f)
    return () => { mq.removeEventListener ? mq.removeEventListener('change', f) : mq.removeListener(f) }
  }, [q])
  return s
}

function Mini({ punkte, f }) {
  if (!punkte.length) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
  // x = Tag im Messfenster (0 … 30 bzw. länger), damit man auch das Alter sieht
  const w = 110, h = 26, mx = Math.max(...punkte.map(p => p.v), 1), md = Math.max(FENSTER, ...punkte.map(p => p.t))
  const xy = (p) => [(p.t / md * (w - 6) + 3).toFixed(1), (h - 3 - p.v / mx * (h - 6)).toFixed(1)]
  const d = punkte.map((p, i) => `${i ? 'L' : 'M'}${xy(p).join(',')}`).join(' ')
  const [lx, ly] = xy(punkte[punkte.length - 1])
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <line x1="3" y1={h - 2} x2={w - 3} y2={h - 2} stroke="var(--border)" strokeWidth="1" />
      {punkte.length > 1 && <path d={d} fill="none" stroke={f} strokeWidth="2" strokeLinejoin="round" />}
      <circle cx={lx} cy={ly} r="2.8" fill={f} />
    </svg>
  )
}

export default function WirkungKurven({ accounts = [], darfVerlaengern = true, userDisplayName, sprache = 'de', modelSicht = false, ohneRahmen = false }) {
  const T = { ...(TXT[sprache] || TXT.de), ...(modelSicht && sprache !== 'en' ? MODEL_TXT : {}) }
  // accounts: ['@handle', …] — betreute Accounts aus der Steuerung
  const liste = useMemo(() => [...new Set(accounts.map(a => String(a).toLowerCase()))].sort(), [accounts.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const [acc, setAcc] = useState(liste[0] || '')
  const [zeilen, setZeilen] = useState(null)
  const [fenster, setFenster] = useState({})
  const [fehlt, setFehlt] = useState({ mess: false, fenster: false })
  const [wahl, setWahl] = useState(null)       // shortcode, dessen Kurve dick gezeigt wird
  const [alle, setAlle] = useState(false)      // abgeschlossene zeigen
  const [hinweis, setHinweis] = useState('')
  const [einzeln, setEinzeln] = useState(false)  // v5.24.0: Einzel-Linien zeigen
  const [filterArt, setFilterArt] = useState('') // '' | 'skript' | 'ohne_skript'
  const [sortierung, setSortierung] = useState('neu') // 'neu' | 'beste' | 'schwach'
  const [mehr, setMehr] = useState(false)
  const [infos, setInfos] = useState({ skript: {}, ohne: {} }) // Titel / wer gepostet hat
  const schmal = useSchmal()
  useEffect(() => { if (!liste.includes(acc)) setAcc(liste[0] || '') }, [liste.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const laden = useCallback(async () => {
    if (!acc) { setZeilen([]); return }
    const seit = new Date(Date.now() - 180 * 86400000).toISOString()
    const m = await supabase.from('reel_messwerte')
      .select('shortcode, reel_url, art, skript_nr, gepostet_am, gemessen_am, mess_tag, alter_std, plays, likes, comments, faktor')
      .eq('account', acc).gte('gepostet_am', seit).order('gemessen_am').limit(8000)
    if (m.error) { setFehlt(x => ({ ...x, mess: true })); setZeilen([]); return }
    setZeilen(m.data || [])
    const codes = [...new Set((m.data || []).map(x => x.shortcode))]
    // v5.24.0: Titel und „von wem“ für die Liste
    const nrs = [...new Set((m.data || []).map(x => x.skript_nr).filter(Boolean))]
    const [sk, os] = await Promise.all([
      nrs.length ? supabase.from('reel_skripte').select('nr, titel, gepostet_von').in('nr', nrs) : Promise.resolve({ data: [] }),
      codes.length ? supabase.from('reel_ohne_skript').select('shortcode, eingetragen_von, notiz').in('shortcode', codes) : Promise.resolve({ data: [] }),
    ])
    setInfos({ skript: Object.fromEntries((sk.data || []).map(x => [x.nr, x])), ohne: Object.fromEntries((os.data || []).map(x => [x.shortcode, x])) })
    if (codes.length) {
      const f = await supabase.from('reel_messfenster').select('shortcode, messen_bis, verlaengert_von').in('shortcode', codes)
      if (f.error) setFehlt(x => ({ ...x, fenster: true }))
      else setFenster(Object.fromEntries((f.data || []).map(x => [x.shortcode, x])))
    }
  }, [acc])
  useEffect(() => { setWahl(null); laden() }, [laden])

  // Reels zusammenfassen: je Reel die Messreihe nach Tag
  const reels = useMemo(() => {
    const map = {}
    for (const z of zeilen || []) {
      const t = tagVon(z); if (t === null) continue
      const r = map[z.shortcode] || (map[z.shortcode] = { code: z.shortcode, url: z.reel_url, art: z.art, nr: z.skript_nr, gepostet: z.gepostet_am, tage: {}, zuletzt: null })
      r.art = z.art; r.nr = z.skript_nr || r.nr   // letzter Stand gewinnt (Skript hat Vorrang in der DB)
      const stand = `${z.plays}|${z.likes}|${z.comments}`
      const tag = z.mess_tag || tagIso(z.gemessen_am)
      if (tag <= ALTDATEN_BIS && stand === r.zuletzt) continue   // alter Stand erneut gesendet → kein neuer Messpunkt
      r.zuletzt = stand
      r.tage[t] = { v: Number(z.plays || 0), f: z.faktor === null || z.faktor === undefined ? null : Number(z.faktor) }
    }
    const heute = tagIso(new Date())
    const liste = Object.values(map).map(r => {
      const ts = Object.keys(r.tage).map(Number).sort((a, b) => a - b)
      const letzt = r.tage[ts[ts.length - 1]]
      const start = r.gepostet ? tagIso(r.gepostet) : heute
      const bis = fenster[r.code]?.messen_bis || plusTage(start, FENSTER)
      const alter = tageZwischen(start, heute)
      // wächst noch? letzte 3 Messtage > 10 % Zuwachs
      const vor = ts.filter(t => t <= ts[ts.length - 1] - 3).pop()
      const waechst = vor !== undefined && r.tage[vor].v > 0 && (letzt.v - r.tage[vor].v) / r.tage[vor].v > 0.1
      return {
        ...r, ts, plays: letzt.v, alter, bis, laenge: tageZwischen(start, bis), start,
        faktorPipeline: letzt.f,
        offen: heute <= bis, waechst, verlaengert: !!fenster[r.code],
        punkte: ts.map(t => ({ t, v: r.tage[t].v })),
      }
    }).sort((a, b) => String(b.gepostet).localeCompare(String(a.gepostet)))
    // Faktor bei gleichem Alter (Tag 7, bei jüngeren Reels: heute)
    for (const r of liste) {
      const t = Math.min(7, r.alter)
      const v = wertAm(r, t)
      const vor = liste.filter(o => o.code !== r.code && o.gepostet && r.gepostet && o.gepostet < r.gepostet
        && (new Date(r.gepostet) - new Date(o.gepostet)) <= 60 * 86400000)
      const basis = median(vor.map(o => wertAm(o, t)))
      const anzahl = vor.filter(o => wertAm(o, t) !== null).length
      if (v !== null && basis && anzahl >= 3) { r.faktor = v / basis; r.fArt = 'alter' }
      else { r.faktor = r.faktorPipeline; r.fArt = 'grob' }
      r.fTag = t; r.vorlaeufig = r.alter < 7
    }
    return liste
  }, [zeilen, fenster])

  const unsere = reels.filter(r => r.art !== 'vergleich')
  const eigene = reels.filter(r => r.art === 'vergleich')
  const letzte30 = (r) => r.alter <= 30

  // Kurven: Median je Tag und Gruppe
  const maxTag = Math.min(90, Math.max(FENSTER, ...reels.filter(r => r.offen || letzte30(r)).map(r => r.ts[r.ts.length - 1] || 0)))
  const gewaehlt = reels.find(r => r.code === wahl)
  const linien = useMemo(() => reels.filter(r => r.art !== 'vergleich' && (alle || r.offen || r.alter <= 30)), [reels, alle])
  const eigenLinien = useMemo(() => reels.filter(r => r.art === 'vergleich' && r.ts.some(t => t <= maxTag) && r.alter <= maxTag + 15), [reels, maxTag])
  const daten = useMemo(() => {
    return [...Array(maxTag + 1)].map((_, t) => {
      const zeile = { tag: t }
      for (const r of eigenLinien) if (r.tage[t]) zeile['e_' + r.code] = r.tage[t].v
      for (const r of linien) if (r.tage[t]) zeile['r_' + r.code] = r.tage[t].v
      return zeile
    })
  }, [linien, eigenLinien, maxTag])
  const hat = (k) => k === 'vergleich' ? eigenLinien.length > 0 : linien.some(r => r.art === k)

  const kpi = {
    anzahl: unsere.filter(letzte30).length,
    fUns: median(unsere.filter(r => letzte30(r) && !r.vorlaeufig && r.fArt === 'alter').map(r => r.faktor)),
    fEigen: median(eigene.filter(r => letzte30(r) && !r.vorlaeufig && r.fArt === 'alter').map(r => r.faktor)),
    bestes: [...unsere.filter(letzte30)].sort((a, b) => b.plays - a.plays)[0],
  }

  const verlaengern = async (r) => {
    setHinweis('')
    const neu = plusTage(r.offen ? r.bis : tagIso(new Date()), FENSTER)
    if (!window.confirm(`Reel ${r.nr || r.code} weitere 30 Tage beobachten?\n\nGemessen wird dann bis ${new Date(neu + 'T12:00:00').toLocaleDateString('de-DE')}.`)) return
    const { error } = await supabase.from('reel_messfenster').upsert({ shortcode: r.code, messen_bis: neu, verlaengert_von: userDisplayName || null }, { onConflict: 'shortcode' })
    if (error) { setHinweis('Nicht gespeichert: ' + error.message); return }
    try { logActivity('reel.messfenster', { entity: acc, detail: `${r.nr || r.code} bis ${neu}` }) } catch { /* nur Protokoll */ }
    laden()
  }

  // ── v5.24.0: Urteil, Mittel-Kurven, Liste ─────────────────────────────────
  const unsere30 = unsere.filter(r => r.offen || letzte30(r))
  // eigene nur, wenn ab dem Anfang gemessen (sonst fehlt der Anfang der Kurve)
  const eigeneSauber = eigene.filter(r => r.ts.length && r.ts[0] <= 1)
  // Vergleichstag: der späteste Tag (höchstens 7), den genug unserer Reels schon erreicht haben —
  // sonst hängt das Urteil an einem einzigen Reel
  const genugUns = Math.min(3, unsere30.length)
  const anzahlAm = (rs, t) => rs.filter(r => r.alter >= t && wertAm(r, t) !== null).length
  let tVgl = 0
  for (let t = 1; t <= 7; t++) if (genugUns && anzahlAm(unsere30, t) >= genugUns) tVgl = t
  const medUns = median(unsere30.filter(r => r.alter >= tVgl).map(r => wertAm(r, tVgl)))
  const medEig = median(eigeneSauber.map(r => wertAm(r, tVgl)))
  const nEig = eigeneSauber.filter(r => wertAm(r, tVgl) !== null).length
  const verhaeltnis = medUns && medEig && nEig >= 2 && tVgl >= 1 ? medUns / medEig : null
  const urteilText = verhaeltnis === null ? null : verhaeltnis >= 1.15 ? T.besser : verhaeltnis <= 0.85 ? T.schwaecher : T.gleich
  const urteilFarbe = verhaeltnis === null ? 'var(--text-muted)' : verhaeltnis >= 1.15 ? G : verhaeltnis <= 0.85 ? ROT : 'var(--text-primary)'
  const aufrufeSumme = unsere.filter(letzte30).reduce((t, r) => t + (r.plays || 0), 0)

  const mittelTage = Math.min(maxTag, Math.max(10, ...unsere30.map(r => r.ts[r.ts.length - 1] ?? 0)) + 2)
  // Mittel nur an Tagen zeigen, die genug Reels erreicht haben (sonst springt die Linie,
  // weil plötzlich nur noch ein, zwei Reels drin sind)
  const genugEig = Math.min(2, eigeneSauber.length)
  const mittelDaten = [...Array(mittelTage + 1)].map((_, t) => {
    const uw = unsere30.filter(r => (r.ts[r.ts.length - 1] ?? -1) >= t).map(r => wertAm(r, t)).filter(v => v !== null)
    const ew = eigeneSauber.filter(r => (r.ts[r.ts.length - 1] ?? -1) >= t).map(r => wertAm(r, t)).filter(v => v !== null)
    return { tag: t, u: t === 0 ? 0 : (genugUns && uw.length >= genugUns ? median(uw) : null), e: t === 0 ? 0 : (genugEig && ew.length >= genugEig ? median(ew) : null) }
  })

  const titelVon = (r) => r.nr ? (infos.skript[r.nr]?.titel || '') : (infos.ohne[r.code]?.notiz || '')
  const vonWem = (r) => r.nr ? infos.skript[r.nr]?.gepostet_von : infos.ohne[r.code]?.eingetragen_von
  const wann = (r) => {
    if (!r.gepostet) return ''
    const d = new Date(r.gepostet)
    const hatZeit = String(r.gepostet).length > 10 && !(d.getHours() === 0 && d.getMinutes() === 0)
    return d.toLocaleDateString(T.loc, { weekday: 'short', day: '2-digit', month: '2-digit' }) + (hatZeit ? ' · ' + d.toLocaleTimeString(T.loc, { hour: '2-digit', minute: '2-digit' }) : '')
  }
  let sichtbar = unsere.filter(r => (alle || r.offen || letzte30(r)) && (!filterArt || r.art === filterArt))
  if (sortierung === 'beste') sichtbar = [...sichtbar].sort((a, b) => (b.faktor ?? -1) - (a.faktor ?? -1) || b.plays - a.plays)
  if (sortierung === 'schwach') sichtbar = [...sichtbar].sort((a, b) => (a.faktor ?? 999) - (b.faktor ?? 999) || a.plays - b.plays)
  const gezeigt = mehr ? sichtbar : sichtbar.slice(0, 8)
  const pillFarbe = (r) => r.faktor === null || r.faktor === undefined ? ['var(--bg-card2)', 'var(--text-muted)'] : r.faktor >= 1.15 ? ['rgba(16,185,129,0.14)', G] : r.faktor <= 0.85 ? ['rgba(239,68,68,0.14)', ROT] : ['rgba(150,150,180,0.12)', 'var(--text-secondary)']
  const chip = (an, text, onClick, f = C) => (
    <button type="button" onClick={onClick} style={{ padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${an ? f : 'var(--border)'}`, background: an ? f + '1f' : 'transparent', color: an ? f : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{text}</button>
  )

  if (!liste.length) return null
  const tipp = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const namen = {}
    for (const r of linien) namen['r_' + r.code] = `${r.nr || T.ohne} · ${new Date(r.start + 'T12:00:00').toLocaleDateString(T.loc, { day: '2-digit', month: '2-digit' })}`
    namen.u = T.uns_mittel; namen.e = T.eigene_mittel
    return (
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 11px', fontSize: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 3 }}>{T.tag} {label}</div>
        {[...payload].filter(p => p.value !== null && p.value !== undefined && (String(p.dataKey).startsWith('r_') || p.dataKey === 'u' || p.dataKey === 'e')).sort((a, b) => b.value - a.value).slice(0, 8).map(p => <div key={p.dataKey} style={{ color: p.stroke }}>{namen[p.dataKey]}: {Math.round(Number(p.value)).toLocaleString(T.loc)} {T.aufrufe}</div>)}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Account wählen */}
      <div style={{ display: 'flex', gap: 6, flexWrap: schmal ? 'nowrap' : 'wrap', overflowX: schmal ? 'auto' : 'visible', paddingBottom: 2 }}>
        {liste.map(a => (
          <button key={a} type="button" onClick={() => { setAcc(a); setMehr(false) }}
            style={{ flexShrink: 0, padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${a === acc ? P : 'var(--border)'}`, background: a === acc ? P : 'transparent', color: a === acc ? '#fff' : 'var(--text-secondary)' }}>{a}</button>
        ))}
      </div>

      {fehlt.mess && <div style={{ ...card, fontSize: 12.5, color: 'var(--text-muted)' }}>{T.db_fehlt}</div>}
      {zeilen && !fehlt.mess && !reels.length && <div style={{ ...card, fontSize: 12.5, color: 'var(--text-muted)' }}>{T.keine_mess(acc)}</div>}

      {reels.length > 0 && (<>
        {/* 1. Urteil */}
        <div style={{ ...card, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: schmal ? 34 : 40, fontWeight: 800, color: urteilFarbe, fontFamily: 'ui-monospace, monospace', lineHeight: 1 }}>{verhaeltnis === null ? '—' : faktorText(verhaeltnis)}</div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: 'var(--text-primary)' }}>{urteilText || T.zu_wenig}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.45 }}>
              {verhaeltnis === null
                ? T.zu_wenig_text(nEig)
                : T.verglichen(tVgl, anzahlAm(unsere30, tVgl), nEig)}
            </div>
          </div>
          {verhaeltnis !== null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 240, flex: 1 }}>
              {[[T.uns_mittel, medUns, V], [T.eigene, medEig, GR]].map(([l, v, f]) => (
                <div key={l} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 56px', gap: 8, alignItems: 'center', fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  <span>{l}</span>
                  <div style={{ height: 12, borderRadius: 6, background: 'var(--bg-card2)', overflow: 'hidden' }}><div style={{ height: '100%', borderRadius: 6, background: f, width: `${Math.round(100 * v / Math.max(medUns, medEig))}%` }} /></div>
                  <b style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: 'var(--text-primary)' }}>{kurz(Math.round(v))}</b>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 2. Drei Zahlen */}
        <div className="wirkung-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: schmal ? 6 : 10 }}>
          {[
            [kpi.anzahl, T.reels30, 'var(--text-primary)'],
            [kurz(aufrufeSumme), T.aufrufe_ges, 'var(--text-primary)'],
            [kpi.bestes ? kurz(kpi.bestes.plays) : '—', kpi.bestes ? `${T.bestes} · ${kpi.bestes.nr || T.ohne}` : T.bestes, G],
          ].map(([v, l, f]) => (
            <div key={l} style={{ ...card, padding: '11px 13px' }}>
              <div style={{ fontSize: schmal ? 17 : 21, fontWeight: 800, color: f, fontFamily: 'ui-monospace, monospace' }}>{v}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{l}</div>
            </div>
          ))}
        </div>

        {/* 3. Kurve: zwei Mittel-Linien, Einzel-Linien auf Wunsch */}
        <div style={card}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, color: 'var(--text-secondary)' }}>
            <span style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--text-primary)', flex: 1, minWidth: 180 }}>{T.kurve}</span>
            {!einzeln && <><span><span style={{ display: 'inline-block', width: 14, height: 3, background: V, verticalAlign: 'middle', marginRight: 5 }} />{T.uns_mittel_k}</span>
              {eigeneSauber.length > 0 && <span><span style={{ display: 'inline-block', width: 14, height: 0, borderTop: `2px dashed ${GR}`, verticalAlign: 'middle', marginRight: 5 }} />{T.eigene_mittel}</span>}</>}
            {einzeln && <>{hat('skript') && <span><span style={{ display: 'inline-block', width: 12, height: 3, background: P, verticalAlign: 'middle' }} /> {T.mit}</span>}
              {hat('ohne_skript') && <span><span style={{ display: 'inline-block', width: 12, height: 3, background: V, verticalAlign: 'middle' }} /> {T.ohne}</span>}
              {hat('vergleich') && <span><span style={{ display: 'inline-block', width: 12, height: 2, background: GR, opacity: 0.6, verticalAlign: 'middle' }} /> {T.eigene}</span>}
              {gewaehlt && <span style={{ color: C }}>{gewaehlt.nr || T.ohne} {T.hervor} <button type="button" onClick={() => setWahl(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}>✕</button></span>}</>}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '3px 0 8px' }}>
            {einzeln ? T.einzeln_text : T.mittel_text}
          </div>
          <div style={{ height: schmal ? 180 : 230 }}>
            <ResponsiveContainer width="100%" height="100%">
              {einzeln ? (
                <LineChart data={daten} margin={{ top: 6, right: 12, left: 0, bottom: 2 }}>
                  <CartesianGrid stroke="rgba(128,128,160,0.15)" vertical={false} />
                  <XAxis dataKey="tag" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={t => `${T.tag} ${t}`} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={kurz} width={44} />
                  <Tooltip content={tipp} />
                  {eigenLinien.map(r => (
                    <Line key={'e' + r.code} type="monotone" dataKey={'e_' + r.code} stroke={GR} strokeWidth={1.2} strokeOpacity={0.4} connectNulls isAnimationActive={false}
                      dot={r.ts.length === 1 ? { r: 2, fill: GR, stroke: 'none', fillOpacity: 0.5 } : false} activeDot={false} />
                  ))}
                  {[...linien].sort((a, b) => (a.code === wahl) - (b.code === wahl)).map(r => (
                    <Line key={r.code} type="monotone" dataKey={'r_' + r.code} stroke={farbe(r.art)} dot={r.code === wahl || r.ts.length <= 2 ? { r: r.code === wahl ? 3.5 : 3, fill: farbe(r.art), stroke: 'none' } : false} connectNulls isAnimationActive={false}
                      strokeWidth={r.code === wahl ? 4 : 2} strokeOpacity={wahl && r.code !== wahl ? 0.25 : 0.9} />
                  ))}
                </LineChart>
              ) : (
                <LineChart data={mittelDaten} margin={{ top: 6, right: 12, left: 0, bottom: 2 }}>
                  <CartesianGrid stroke="rgba(128,128,160,0.15)" vertical={false} />
                  <XAxis dataKey="tag" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={t => `${T.tag} ${t}`} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={kurz} width={44} />
                  <Tooltip content={tipp} />
                  <Line type="monotone" dataKey="e" stroke={GR} strokeWidth={2.2} strokeDasharray="6 4" dot={false} connectNulls={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="u" stroke={V} strokeWidth={3.2} dot={false} connectNulls={false} isAnimationActive={false} />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
          <button type="button" onClick={() => setEinzeln(e => !e)} style={{ marginTop: 6, background: 'none', border: 'none', padding: 0, color: 'var(--text-secondary)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            {einzeln ? T.zurueck : T.einzeln}
          </button>
        </div>

        {/* 4. Unsere Reels */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--text-primary)' }}>{T.liste}</span>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{sichtbar.length} {alle ? T.insgesamt : T.letzte30}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 10px', alignItems: 'center' }}>
            {chip(sortierung === 'neu', T.neueste, () => setSortierung('neu'))}
            {chip(sortierung === 'beste', T.beste, () => setSortierung('beste'))}
            {chip(sortierung === 'schwach', T.schwach, () => setSortierung('schwach'))}
            <span style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
            {chip(!filterArt, T.alle, () => setFilterArt(''), P)}
            {chip(filterArt === 'skript', T.chip_mit, () => setFilterArt('skript'), P)}
            {chip(filterArt === 'ohne_skript', T.chip_ohne, () => setFilterArt('ohne_skript'), V)}
            <label style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }} className="wirkung-check">
              <input type="checkbox" checked={alle} onChange={e => setAlle(e.target.checked)} /> {T.aeltere}
            </label>
          </div>
          {!sichtbar.length && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '6px 0' }}>{T.keine(acc)}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {gezeigt.map(r => {
              const an = wahl === r.code
              const [pb, pf] = pillFarbe(r)
              const titel = titelVon(r)
              const wer = vonWem(r)
              return (
                <div key={r.code} onClick={() => { setWahl(an ? null : r.code); if (!an) setEinzeln(true) }}
                  style={{ display: 'grid', gridTemplateColumns: schmal ? '1fr auto' : 'minmax(0, 1fr) 120px 90px 76px auto', gap: schmal ? 6 : 12, alignItems: 'center', padding: '9px 11px', borderRadius: 12, cursor: 'pointer',
                    background: an ? 'rgba(6,182,212,0.08)' : 'var(--bg-card2)', border: `1px solid ${an ? C : 'var(--border)'}`, borderLeft: `4px solid ${farbe(r.art)}`, opacity: r.offen ? 1 : 0.7 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <span style={{ fontSize: 10.5, fontWeight: 800, padding: '1px 7px', borderRadius: 8, marginRight: 7, background: farbe(r.art) + '22', color: farbe(r.art) }}>{r.nr || T.ohne}</span>
                      {titel || wann(r)}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                      {titel ? wann(r) + ' · ' : ''}{r.offen ? T.tag_von(Math.min(r.alter, r.laenge), r.laenge) : T.fertig}{wer ? ` · ${T.von(wer)}` : ''}
                      {r.verlaengert && <span style={{ color: C }}> · {T.verlaengert}</span>}
                      {r.url && <> · <a href={r.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: C }}>{T.ansehen}</a></>}
                    </div>
                  </div>
                  {!schmal && <Mini punkte={r.punkte} f={farbe(r.art)} />}
                  <div style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: 15, color: kpi.bestes?.code === r.code ? G : 'var(--text-primary)', gridColumn: schmal ? 2 : undefined, gridRow: schmal ? 1 : undefined }}>
                    {kurz(r.plays)}<div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 500 }}>{T.aufrufe}</div>
                  </div>
                  <span title={r.fArt === 'grob' ? T.tip_grob : r.vorlaeufig ? T.tip_vorl(r.fTag) : T.tip_ok}
                    style={{ textAlign: 'center', fontSize: 12.5, fontWeight: 800, padding: '4px 8px', borderRadius: 10, fontFamily: 'ui-monospace, monospace', background: pb, color: pf, opacity: r.vorlaeufig || r.fArt === 'grob' ? 0.65 : 1, gridColumn: schmal ? 2 : undefined, justifySelf: schmal ? 'end' : undefined }}>
                    {r.fArt === 'grob' && r.faktor !== null && r.faktor !== undefined ? '~' : ''}{faktorText(r.faktor)}
                  </span>
                  {(r.waechst && (r.laenge - r.alter <= 5 || !r.offen)) || (darfVerlaengern && !fehlt.fenster && (r.laenge - r.alter <= 5 || !r.offen)) ? (
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', gridColumn: schmal ? '1 / -1' : undefined }}>
                      {r.waechst && (r.laenge - r.alter <= 5 || !r.offen) && <span style={{ fontSize: 11, fontWeight: 800, color: A }}>{T.waechst}</span>}
                      {darfVerlaengern && !fehlt.fenster && (r.laenge - r.alter <= 5 || !r.offen) && (
                        <button type="button" onClick={e => { e.stopPropagation(); verlaengern(r) }} style={knopf(C, false)}>+30 Tage</button>
                      )}
                    </span>
                  ) : (!schmal && <span />)}
                </div>
              )
            })}
          </div>
          {sichtbar.length > 8 && <button type="button" onClick={() => setMehr(m => !m)} style={{ marginTop: 8, background: 'none', border: 'none', padding: 0, color: C, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{mehr ? T.weniger : T.alle_zeigen(sichtbar.length)}</button>}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
            {T.fuss}{darfVerlaengern ? ' ' + T.fuss_fenster : ''}
          </div>
          {fehlt.fenster && darfVerlaengern && <div style={{ fontSize: 11.5, color: A, marginTop: 4 }}>Verlängern geht erst, wenn <code>sql/reel-messfenster.sql</code> ausgeführt ist.</div>}
          {hinweis && <div style={{ fontSize: 12.5, color: ROT, marginTop: 4 }}>{hinweis}</div>}
        </div>
      </>)}
      <style>{`.wirkung-check input { width: auto !important; } .wirkung-kpis.wirkung-kpis[style] { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }`}</style>
    </div>
  )
}

// ── v5.25.0: Wirkung im Model-Portal (Bereich „Social“) ────────────────────
// Dieselbe Ansicht, nur die eigenen betreuten Accounts, ohne Verlängern,
// Texte in der Du-Form („deine eigenen“).
export function WirkungModel({ displayName, service = null, cardS = {}, leerText = '' }) {
  const [accounts, setAccounts] = useState(null)
  const nb = (service?.nicht_betreut || []).join(',')
  useEffect(() => {
    if (!displayName) return
    let weg = false
    ;(async () => {
      const [{ resolvePlatform, SOCIAL_CATEGORY }, { instaHandle }] = await Promise.all([import('./SocialLinks'), import('../reelSkripte')])
      const { data } = await supabase.from('model_board').select('title, content').eq('model_name', displayName).eq('category', SOCIAL_CATEGORY)
      if (weg) return
      const aus = new Set(nb ? nb.split(',') : [])
      setAccounts([...new Set((data || []).filter(x => resolvePlatform(x.title).key === 'instagram' && String(x.content || '').trim()).map(x => instaHandle(x.content)))].filter(h => h && !aus.has(h)))
    })()
    return () => { weg = true }
  }, [displayName, nb])
  if (!accounts) return null
  // v5.26.0: im Reiter lieber ein Hinweis statt einer leeren Seite
  if (!accounts.length) return leerText ? <div style={{ ...cardS, padding: '14px 15px', fontSize: 13, color: 'var(--text-muted)' }}>📈 {leerText}</div> : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ ...cardS, padding: '12px 15px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 20 }}>📈</span>
        <div style={{ flex: 1 }}>
          <b style={{ fontSize: 14.5, color: 'var(--text-primary)' }}>Wie deine Reels laufen</b>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Aufrufe der Reels, die wir für dich posten, im Vergleich zu deinen eigenen. Jede Nacht aktualisiert.</div>
        </div>
      </div>
      <WirkungKurven accounts={accounts} darfVerlaengern={false} modelSicht userDisplayName={displayName} />
    </div>
  )
}
