import React, { useEffect, useState, useCallback } from 'react'
import { RefreshCw, MessageCircle, CheckSquare, Palette, FileText, AlertTriangle, Database, ChevronRight, Clock } from 'lucide-react'
import { supabase } from '../supabase'
import { formatMoneyShort } from '../utils'
import { ladeInaktiveNamen, ohneInaktive } from '../people'
import { datumInZone, meineZone, BERLIN, ortAus } from '../zeit'
import { montagVon, plusTage, planSchichten, checkinStand, unterZiel } from '../jetzt'
import { SkelZeilen } from './Skeleton' // v4.92.0

// ── Jetzt-Screen ────────────────────────────────────────────────────────────
//
// v4.71.0. Startseite am Handy für Admin/Manager. Beantwortet drei Fragen, in
// dieser Reihenfolge:
//   1. Wer arbeitet gerade (und wer fehlt)?
//   2. Was wartet auf mich?
//   3. Was ist auffällig?
// Zahlen stehen nur als drei Kacheln oben. Alles darunter ist etwas zum
// Antippen, nicht zum Lesen — die Auswertung bleibt in Analyse.
//
// Die Kachel heißt bewusst "letzter Tag" und nicht "heute": Umsätze kommen als
// CSV am Morgen danach (siehe Datenstand in App.jsx). Eine Kachel "Heute" stünde
// den ganzen Tag auf null.
//
// Die Regeln, wer als "in der Schicht" gilt, stehen in src/jetzt.js.

const NEU_LADEN_MS = 60000

const karte = {
  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden',
}
const kopf = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)',
}
const zeileBtn = {
  width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '12px', minHeight: 48,
  border: 'none', borderTop: '1px solid var(--border)', background: 'transparent',
  color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
}

function Kachel({ titel, wert, farbe, unter }) {
  return (
    <div style={{ flex: 1, minWidth: 0, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 11, padding: '10px 11px' }}>
      <div style={{ ...kopf, fontSize: 9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{titel}</div>
      <div style={{ fontFamily: 'monospace', fontSize: 17, fontWeight: 700, marginTop: 3, color: farbe || 'var(--text-primary)' }}>{wert}</div>
      {unter && <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 1 }}>{unter}</div>}
    </div>
  )
}

export default function JetztView({ modelSnapshots = [], zaehler = {}, canAccess = () => true, onOpen, datenOk = true, fehlenderTag = null }) {
  const [plan, setPlan] = useState(null)       // { schichten, logs } | null = lädt
  const [fehler, setFehler] = useState(null)
  const [ziele, setZiele] = useState({ targets: {}, aliasMap: {} })
  const [jetzt, setJetzt] = useState(() => new Date())
  const zone = meineZone()

  const laden = useCallback(async () => {
    const heute = datumInZone(new Date(), BERLIN).tag
    const gestern = plusTage(heute, -1)
    // Nachtschichten von gestern können noch laufen, und gestern kann in der
    // Vorwoche liegen (Montag früh) — deshalb beide Wochen.
    const wochen = [...new Set([montagVon(gestern), montagVon(heute)])]
    const [schedRes, modelRes, inaktive, logRes, absRes, tRes, aRes] = await Promise.all([
      supabase.from('schedule').select('week_start, assignments, shift_times').in('week_start', wochen).eq('status', 'live'),
      supabase.from('models_contact').select('id, name, active'),
      ladeInaktiveNamen(),
      supabase.from('shift_logs').select('display_name, checked_in_at, checked_out_at')
        .gte('checked_in_at', new Date(Date.now() - 36 * 3600000).toISOString()),
      supabase.from('absences').select('chatter_name, date_from, date_to, available_shifts').gte('date_to', gestern),
      supabase.from('model_revenue_targets').select('model_name, daily_target'),
      supabase.from('model_aliases').select('csv_name, model_name'),
    ])
    const ersterFehler = [schedRes, modelRes, logRes, absRes].find(r => r.error)
    if (ersterFehler) {
      console.warn('Jetzt: Laden fehlgeschlagen', ersterFehler.error.message)
      setFehler('Dienstplan konnte nicht geladen werden.')
      return
    }
    // Wie shift-alert: lässt sich die Model-Liste nicht laden, wird nicht gefiltert.
    const models = modelRes.data || []
    const sichtbar = models.length ? new Set(ohneInaktive(models, inaktive).map(m => String(m.id))) : null
    const modelName = Object.fromEntries(models.map(m => [String(m.id), m.name]))
    const schichten = planSchichten({
      wochen: schedRes.data, modelName, sichtbar, absences: absRes.data, vonTag: gestern, bisTag: heute,
    })
    setPlan({ schichten, logs: logRes.data || [] })
    setFehler(null)
    const targets = {}
    for (const t of tRes.data || []) targets[t.model_name] = Number(t.daily_target) || 0
    setZiele({ targets, aliasMap: Object.fromEntries((aRes.data || []).map(a => [a.csv_name, a.model_name])) })
    setJetzt(new Date())
  }, [])

  useEffect(() => {
    laden()
    const iv = setInterval(laden, NEU_LADEN_MS)
    // Handy aus der Tasche: beim Zurückkommen sofort frisch, nicht erst nach einer Minute
    const sichtbarWieder = () => { if (document.visibilityState === 'visible') laden() }
    document.addEventListener('visibilitychange', sichtbarWieder)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', sichtbarWieder) }
  }, [laden])

  const uhrzeit = (d) => datumInZone(d, zone).zeit
  const t = jetzt.getTime()

  // ── 1. Wer arbeitet ──
  // Eine Zeile pro Person und Schicht, nicht pro Model: wer drei Models
  // gleichzeitig betreut, checkt einmal ein — drei Zeilen "fehlt" waeren
  // dreifacher Alarm fuer ein einziges Versaeumnis (so im ersten Test, v4.71.0).
  const gruppiert = {}
  for (const s of (plan?.schichten || []).filter(s => s.beginn.getTime() <= t && t < s.ende.getTime())) {
    const k = `${s.person.trim().toLowerCase()}|${s.beginn.getTime()}|${s.ende.getTime()}`
    if (gruppiert[k]) { if (!gruppiert[k].models.includes(s.model)) gruppiert[k].models.push(s.model) }
    else gruppiert[k] = { ...s, key: k, models: [s.model] }
  }
  const laufend = Object.values(gruppiert)
    .map(s => ({ ...s, ...checkinStand(s, plan.logs, jetzt) }))
    .sort((a, b) => (a.stand === 'fehlt' ? -1 : 0) - (b.stand === 'fehlt' ? -1 : 0) || a.beginn - b.beginn)
  const naechste = (plan?.schichten || [])
    .filter(s => s.beginn.getTime() > t && s.beginn.getTime() - t <= 3 * 3600000)
    .sort((a, b) => a.beginn - b.beginn)
    .filter((s, i, alle) => alle.findIndex(x => x.person === s.person && +x.beginn === +s.beginn) === i)
    .slice(0, 3)
  const besetzt = laufend.filter(s => s.stand === 'drin').length

  // ── Kacheln: letzter erfasster Tag gegen den davor ──
  const tage = [...modelSnapshots].sort((a, b) => a.businessDate.localeCompare(b.businessDate))
  const summe = (snap) => (snap?.rows || []).reduce((acc, r) => acc + (r.revenue || 0), 0)
  const letzter = tage[tage.length - 1]
  const davor = tage[tage.length - 2]
  const umsatz = letzter ? summe(letzter) : null
  const delta = letzter && davor && summe(davor) > 0 ? (umsatz / summe(davor) - 1) * 100 : null
  const tagKurz = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) : ''

  // ── 2. Was wartet ──
  const warten = [
    { tab: 'chatters-comm', ziel: 'swaps', label: 'Schichttausch', Icon: RefreshCw, zahl: zaehler.openSwaps, warn: true },
    { tab: 'chat', label: 'Ungelesene Chats', Icon: MessageCircle, zahl: zaehler.unreadChat },
    { tab: 'todos', label: 'ToDos', Icon: CheckSquare, zahl: zaehler.openTodos },
    { tab: 'models-comm', label: 'Creator: Neues', Icon: Palette, zahl: zaehler.unreadModelChanges },
    { tab: 'notes', label: 'Notizen', Icon: FileText, zahl: zaehler.unreadNotes },
  ].filter(w => (w.zahl || 0) > 0 && canAccess(w.tab))

  // ── 3. Auffällig ──
  const schwach = unterZiel({ modelSnapshots, aliasMap: ziele.aliasMap, targets: ziele.targets })
  const auffaellig = []
  if (!datenOk && fehlenderTag && canAccess('datenstand')) {
    auffaellig.push({
      key: 'daten', farbe: 'var(--yellow)', Icon: Database, tab: 'datenstand',
      titel: `Zahlen für ${tagKurz(fehlenderTag)} fehlen`, text: 'CSV-Upload unter Verwaltung → Daten',
    })
  }
  for (const s of schwach.slice(0, 4)) {
    auffaellig.push({
      key: 'ziel-' + s.model, farbe: 'var(--red)', Icon: AlertTriangle, tab: 'models',
      // 14 ist das Fenster, nicht die echte Dauer — dann nur "seit 14+ Tagen"
      titel: s.tage >= 14 ? `${s.model} liegt seit 14+ erfassten Tagen unter Ziel` : `${s.model} liegt den ${s.tage}. Tag unter Ziel`,
      text: `${formatMoneyShort(s.letzter)} statt ${formatMoneyShort(s.ziel)} (Msg+Tips, letzter Tag)`,
    })
  }

  const zoneHinweis = zone !== BERLIN ? `Zeiten: ${ortAus(zone)}` : 'Zeiten: DE'

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

      <div style={{ display: 'flex', gap: 8 }}>
        <Kachel titel={letzter ? `Umsatz ${letzter.businessDate.slice(8, 10)}.${letzter.businessDate.slice(5, 7)}.` : 'Umsatz'} wert={umsatz != null ? formatMoneyShort(umsatz) : '—'} />
        <Kachel titel="vs. Vortag" wert={delta != null ? `${delta > 0 ? '+' : ''}${Math.round(delta)}%` : '—'}
          farbe={delta == null ? undefined : delta >= 0 ? 'var(--green)' : 'var(--red)'} />
        <Kachel titel="Eingecheckt" wert={plan ? `${besetzt}/${laufend.length}` : '…'}
          farbe={plan && laufend.length > 0 && besetzt < laufend.length ? 'var(--yellow)' : undefined} />
      </div>

      {/* 1 — In der Schicht */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={kopf}>In der Schicht</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{zoneHinweis} · {uhrzeit(jetzt)}</span>
        </div>
        <div style={karte}>
          {fehler ? (
            <div style={{ padding: 12, fontSize: 12.5, color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1 }}>{fehler}</span>
              <button onClick={laden} style={{ ...zeileBtn, width: 'auto', minHeight: 0, borderTop: 'none', padding: '6px 10px', border: '1px solid var(--border-bright)', borderRadius: 8, fontSize: 12, fontWeight: 700 }}>Neu laden</button>
            </div>
          ) : !plan ? (
            <SkelZeilen anzahl={3} />
          ) : laufend.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12.5, color: 'var(--text-secondary)' }}>Gerade ist laut Dienstplan niemand eingeteilt.</div>
          ) : laufend.map((s, i) => {
            const farbe = s.stand === 'drin' ? 'var(--green)' : s.stand === 'fehlt' ? 'var(--yellow)' : 'var(--text-muted)'
            const status = s.stand === 'drin' ? `eingecheckt ${uhrzeit(s.seit)}`
              : s.stand === 'raus' ? `ausgecheckt ${uhrzeit(s.um)}`
              : s.stand === 'fehlt' ? `nicht eingecheckt · seit ${s.minuten} min`
              : 'beginnt gerade'
            return (
              <button key={s.key} onClick={() => onOpen('schedule')} className="jetzt-zeile" style={{ ...zeileBtn, borderTop: i === 0 ? 'none' : zeileBtn.borderTop, padding: '10px 12px' }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: farbe, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{s.person}</span>
                  <span style={{ display: 'block', fontSize: 11, color: s.stand === 'fehlt' ? 'var(--yellow)' : 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {s.models.join(', ')} · {status}
                  </span>
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace', flexShrink: 0 }}>bis {uhrzeit(s.ende)}</span>
              </button>
            )
          })}
        </div>
        {naechste.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <Clock size={12} color="var(--text-muted)" aria-hidden="true" />
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              Als Nächstes: {naechste.map(s => `${s.person} ${uhrzeit(s.beginn)}`).join(' · ')}
            </span>
          </div>
        )}
      </section>

      {/* 2 — Wartet auf dich */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <span style={kopf}>Wartet auf dich</span>
        <div style={karte}>
          {warten.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12.5, color: 'var(--text-secondary)' }}>Nichts offen.</div>
          ) : warten.map((w, i) => (
            <button key={w.tab} onClick={() => onOpen(w.tab, w.ziel ? { section: w.ziel } : null)} className="jetzt-zeile" style={{ ...zeileBtn, borderTop: i === 0 ? 'none' : zeileBtn.borderTop }}>
              <w.Icon size={16} color="var(--text-secondary)" aria-hidden="true" />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{w.label}</span>
              <span style={{
                minWidth: 20, height: 20, padding: '0 6px', boxSizing: 'border-box', borderRadius: 10,
                background: w.warn ? '#f59e0b' : 'var(--accent)', color: w.warn ? '#000' : '#fff',
                fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{w.zahl}</span>
              <ChevronRight size={15} color="var(--text-muted)" aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>

      {/* 3 — Auffällig */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <span style={kopf}>Auffällig</span>
        <div style={karte}>
          {auffaellig.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12.5, color: 'var(--text-secondary)' }}>Nichts auffällig.</div>
          ) : auffaellig.map((a, i) => (
            <button key={a.key} onClick={() => onOpen(a.tab)} className="jetzt-zeile" style={{ ...zeileBtn, alignItems: 'flex-start', borderTop: i === 0 ? 'none' : zeileBtn.borderTop }}>
              <a.Icon size={16} color={a.farbe} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, lineHeight: 1.35 }}>{a.titel}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{a.text}</span>
              </span>
              <ChevronRight size={15} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
