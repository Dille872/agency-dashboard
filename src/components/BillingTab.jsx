import React, { useState, useEffect, useMemo } from 'react'
import { excelModels, excelChatter, abrechnungenPdf, chatterNachricht } from '../billingExport' // v5.33.0 · v5.34.0
import { sendTelegramMessage } from '../telegram'
import { supabase } from '../supabase'

function money(v) {
  return '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function norm(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// v4.49.0: Zeilengetriebene Zuordnung — jede CSV-Zeile geht an höchstens EINEN
// Empfänger. Vorher wurde je Person mit includes() in beide Richtungen gesucht:
// „Max" bekam den Umsatz von „Maximilian" dazu, „Lena" den von „Helena", und
// zwei Accounts, die sich nur im Emoji unterscheiden („Chiara Sophie 💓/🍒"),
// wurden nach norm() gleich. Siehe claude/model-portal-doppelzaehlung.md.
//
// Reihenfolge je Zeile:
//   1. exakter Alias (csv_name, nur getrimmt)
//   2. normalisierter Alias — nur wenn er genau EINER Person gehört
//   3. Personenname selbst (normalisiert) — nur wenn eindeutig
// Alles andere landet sichtbar unter „Nicht zugeordnet" statt still bei
// irgendwem oder nirgends.
function baueZuordnung(personen, aliasListe, aliasFeld) {
  const exakt = new Map()      // csv_name (trim) -> person
  const normMap = new Map()    // norm(csv_name) -> Set(person)
  const add = (m, k, v) => { if (!k) return; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v) }
  for (const a of aliasListe) {
    const csv = String(a.csv_name || '').trim()
    const person = a[aliasFeld]
    if (!csv || !person) continue
    exakt.set(csv, person)
    add(normMap, norm(csv), person)
  }
  const nameMap = new Map()    // norm(personenname) -> Set(person)
  for (const p of personen) add(nameMap, norm(p), p)

  return (rohName) => {
    const roh = String(rohName || '').trim()
    if (!roh) return { person: null, grund: 'leer' }
    if (exakt.has(roh)) return { person: exakt.get(roh) }
    const n = norm(roh)
    const perAlias = normMap.get(n)
    if (perAlias) {
      if (perAlias.size === 1) return { person: [...perAlias][0] }
      return { person: null, grund: 'mehrdeutig: ' + [...perAlias].join(' / ') }
    }
    const perName = nameMap.get(n)
    if (perName) {
      if (perName.size === 1) return { person: [...perName][0] }
      return { person: null, grund: 'mehrdeutig: ' + [...perName].join(' / ') }
    }
    return { person: null, grund: 'kein Alias' }
  }
}

// v5.22.0: Verteilung der CSV-Zeilen auf Personen (vorher inline im useMemo)
function modelVerteilen(models, aliases, snaps) {
  const finde = baueZuordnung(models.map(m => m.name), aliases, 'model_name')
  const proPerson = {}
  const offen = {}
  for (const snap of snaps) {
    for (const row of snap.rows || []) {
      const roh = row.creator || row.name || ''
      const werte = {
        subs: (row.newSubsRevenue || 0) + (row.recurringSubsRevenue || 0),
        chat: row.messageRevenue || 0,
        tips: row.tipsRevenue || 0,
        total: row.revenue || 0,
      }
      const { person, grund } = finde(roh)
      const ziel = person
        ? (proPerson[person] ||= { subs: 0, chat: 0, tips: 0, total: 0 })
        : (offen[String(roh).trim() || '(leer)'] ||= { subs: 0, chat: 0, tips: 0, total: 0, grund })
      for (const k of ['subs', 'chat', 'tips', 'total']) ziel[k] += werte[k]
    }
  }
  return { proPerson, offen }
}
function chatterVerteilen(chatters, chatterAliases, chatSnaps) {
  const finde = baueZuordnung(chatters.map(c => c.name), chatterAliases, 'chatter_name')
  const proPerson = {}
  const offen = {}
  for (const snap of chatSnaps) {
    for (const row of snap.rows || []) {
      const roh = row.name || row.chatter || ''
      // Summen-/Aggregatzeilen (Name enthält '*') nicht verteilen — wie in PerformanceTab
      if (String(roh).includes('*')) continue
      const rev = row.revenue || 0
      const { person, grund } = finde(roh)
      const ziel = person
        ? (proPerson[person] ||= { chat: 0, total: 0 })
        : (offen[String(roh).trim() || '(leer)'] ||= { chat: 0, total: 0, grund })
      ziel.chat += rev
      ziel.total += rev
    }
  }
  return { proPerson, offen }
}
// Anteile aus Einstellung + Umsatz
function modelRechnung(s, rev) {
  if (!s) return null
  let base = 0
  if (s.include_subs) base += rev.subs
  if (s.include_chat) base += rev.chat
  if (s.include_tips) base += rev.tips
  const agentur = base * (s.percentage / 100)
  return { base, agentur, model: rev.total - agentur }
}
// v5.23.0: Chatter „inaktiv ab Monat“ — ab dann keine Auszahlung (Umsatz läuft trotzdem auf den Namen)
const istInaktiv = (s, monat) => !!(s && s.inaktiv_ab && monat >= s.inaktiv_ab)
function chatterRechnung(s, rev, monat = null) {
  if (!s) return null
  if (monat && istInaktiv(s, monat)) return null
  const base = s.include_chat ? rev.chat : rev.total
  return { base, auszahlung: base * (s.percentage / 100) }
}
const monatGrenzen = (month) => {
  const [y, m] = month.split('-').map(Number)
  const nextY = m === 12 ? y + 1 : y
  const nextM = m === 12 ? 1 : m + 1
  return [month + '-01', nextY + '-' + String(nextM).padStart(2, '0') + '-01']
}
const euroText = (v) => Number(v || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const kurz = (v) => '$' + Math.round(Number(v || 0)).toLocaleString('de-DE')
const kurzEuro = (v) => Math.round(Number(v || 0)).toLocaleString('de-DE') + ' €'

function CheckBox({ checked, onChange, label }) {
  return (
    <label onClick={onChange} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' }}>
      <div style={{ width: 14, height: 14, borderRadius: 3, border: '1px solid ' + (checked ? '#7c3aed' : '#2e2e5a'), background: checked ? '#7c3aed' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {checked && <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>v</span>}
      </div>
      {label}
    </label>
  )
}

export default function BillingTab() {
  const [section, setSection] = useState('models')
  const [models, setModels] = useState([])
  const [chatters, setChatters] = useState([])
  const [settings, setSettings] = useState([])
  const [snaps, setSnaps] = useState([])
  const [chatSnaps, setChatSnaps] = useState([])
  const [aliases, setAliases] = useState([])
  const [chatterAliases, setChatterAliases] = useState([])
  const [month, setMonth] = useState(() => {
    const n = new Date()
    return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0')
  })
  const [editing, setEditing] = useState(null)
  const [editVals, setEditVals] = useState({})
  const [saving, setSaving] = useState(false)
  // v5.22.0: Kurs $→€ je Monat, Filter, Verdienst je Monat
  const [kurse, setKurse] = useState([])
  const [kursFehlt, setKursFehlt] = useState(false)
  const [kursEingabe, setKursEingabe] = useState('')
  const [filter, setFilter] = useState('umsatz')   // 'umsatz' | 'alle' | 'ohne'
  const [suche, setSuche] = useState('')
  const [verlauf, setVerlauf] = useState(null)
  const [nachricht, setNachricht] = useState(null) // v5.34.0: { name, text, telegram, status }

  useEffect(() => { load() }, [month])
  useEffect(() => { ladeKurse() }, [])
  useEffect(() => { setFilter('umsatz'); setSuche('') }, [section])

  const ladeKurse = async () => {
    const { data, error } = await supabase.from('billing_kurse').select('*').order('monat', { ascending: false })
    if (error) { setKursFehlt(true); return }
    setKurse(data || [])
  }
  const kursVon = (m) => kurse.find(k => k.monat === m) || null
  useEffect(() => { const k = kursVon(month); setKursEingabe(k ? String(k.usd_eur).replace('.', ',') : '') }, [month, kurse]) // eslint-disable-line react-hooks/exhaustive-deps
  const kursSpeichern = async () => {
    const wert = parseFloat(String(kursEingabe).replace(',', '.'))
    const alt = kursVon(month)
    if (!kursEingabe.trim()) return
    if (!(wert > 0 && wert < 10)) { alert('Bitte den Kurs als Zahl eingeben, z. B. 0,9184 (1 $ = … €).'); return }
    if (alt && Number(alt.usd_eur) === wert) return
    if (alt && !window.confirm(`Kurs für ${monthLabel} von ${String(alt.usd_eur).replace('.', ',')} auf ${String(wert).replace('.', ',')} ändern?`)) { setKursEingabe(String(alt.usd_eur).replace('.', ',')); return }
    const { data: u } = await supabase.auth.getUser()
    const { data: ur } = u?.user ? await supabase.from('user_roles').select('display_name').eq('user_id', u.user.id).maybeSingle() : { data: null }
    const { error } = await supabase.from('billing_kurse').upsert({ monat: month, usd_eur: wert, eingetragen_am: new Date().toISOString(), eingetragen_von: ur?.display_name || null }, { onConflict: 'monat' })
    if (error) { alert('Kurs NICHT gespeichert: ' + error.message); return }
    ladeKurse()
  }

  // Verdienst je Monat: die letzten 6 Monate mit denselben Einstellungen durchrechnen
  const ladeVerlauf = async () => {
    setVerlauf('laedt')
    const zeilen = []
    for (const m of months) {
      const [von, bis] = monatGrenzen(m)
      const [ms, cs] = await Promise.all([
        supabase.from('model_snapshots').select('rows,business_date').gte('business_date', von).lt('business_date', bis),
        supabase.from('chatter_snapshots').select('rows,business_date').gte('business_date', von).lt('business_date', bis),
      ])
      const ma = modelVerteilen(models, aliases, ms.data || [])
      const ca = chatterVerteilen(chatters, chatterAliases, cs.data || [])
      let agentur = 0, auszahlung = 0, umsatz = 0
      for (const [name, rev] of Object.entries(ma.proPerson)) { umsatz += rev.total; const x = modelRechnung(getSetting(name, 'model'), rev); if (x) agentur += x.agentur }
      for (const [name, rev] of Object.entries(ca.proPerson)) { const x = chatterRechnung(getSetting(name, 'chatter'), rev, m); if (x) auszahlung += x.auszahlung }
      zeilen.push({ monat: m, umsatz, agentur, auszahlung, tage: (ms.data || []).length })
    }
    setVerlauf(zeilen)
  }
  useEffect(() => { if (section === 'verlauf' && models.length) ladeVerlauf() }, [section, models.length, settings]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = async () => {
    const monthStart = month + '-01'
    const parts = month.split('-')
    const y = parseInt(parts[0])
    const m = parseInt(parts[1])
    const nextY = m === 12 ? y + 1 : y
    const nextM = m === 12 ? 1 : m + 1
    const monthEnd = nextY + '-' + String(nextM).padStart(2, '0') + '-01'

    const [r1, r2, r3, r4, r5, r6, r7] = await Promise.all([
      supabase.from('models_contact').select('name, active').order('name'),
      supabase.from('chatters_contact').select('name, active, telegram_id').order('name'),
      supabase.from('billing_settings').select('*'),
      supabase.from('model_aliases').select('*'),
      supabase.from('model_snapshots').select('rows,business_date').gte('business_date', monthStart).lt('business_date', monthEnd),
      supabase.from('chatter_snapshots').select('rows,business_date').gte('business_date', monthStart).lt('business_date', monthEnd),
      supabase.from('chatter_aliases').select('*'),
    ])
    setModels(r1.data || [])
    setChatters(r2.data || [])
    setSettings(r3.data || [])
    setAliases(r4.data || [])
    setSnaps(r5.data || [])
    setChatSnaps(r6.data || [])
    setChatterAliases(r7.data || [])
  }

  const getSetting = (name, type) => settings.find(s => s.person_name === name && s.person_type === type)

  const startEdit = (name, type) => {
    const s = getSetting(name, type)
    setEditing({ name, type })
    setEditVals({
      percentage: s ? s.percentage : 0,
      include_subs: s ? s.include_subs : true,
      include_chat: s ? s.include_chat : true,
      include_tips: s ? s.include_tips : true,
      ...(type === 'chatter' ? { inaktiv_ab: s?.inaktiv_ab || '' } : {}),
    })
  }

  const save = async () => {
    if (!editing) return
    setSaving(true)
    const ex = getSetting(editing.name, editing.type)
    const payload = { person_name: editing.name, person_type: editing.type, ...editVals, updated_at: new Date().toISOString() }
    if ('inaktiv_ab' in payload) payload.inaktiv_ab = payload.inaktiv_ab || null
    const { error } = ex
      ? await supabase.from('billing_settings').update(payload).eq('id', ex.id)
      : await supabase.from('billing_settings').insert(payload)
    if (error) {
      // v4.49.0: vorher wurde der Fehler verschluckt und das Formular geschlossen
      alert(/inaktiv_ab/.test(error.message) ? '⚠ Nicht gespeichert: Datenbank fehlt noch, einmal sql/billing-inaktiv.sql ausführen.' : '⚠ Prozente NICHT gespeichert: ' + error.message)
      setSaving(false)
      return
    }
    setEditing(null)
    await load()
    setSaving(false)
  }

  // v4.49.0: einmal pro Monat alle Zeilen verteilen, statt je Person zu suchen.
  // v5.22.0: als Funktion, damit „Verdienst je Monat“ dieselbe Rechnung für ältere Monate nutzt.
  const modelAuswertung = useMemo(() => modelVerteilen(models, aliases, snaps), [models, aliases, snaps])
  const chatterAuswertung = useMemo(() => chatterVerteilen(chatters, chatterAliases, chatSnaps), [chatters, chatterAliases, chatSnaps])

  const modelRev = (modelName) => modelAuswertung.proPerson[modelName] || { subs: 0, chat: 0, tips: 0, total: 0 }
  const chatterRev = (chatterName) => chatterAuswertung.proPerson[chatterName] || { chat: 0, total: 0 }

  const monthLabel = new Date(month + '-15').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
  const months = []
  const now = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'))
  }

  const card = { background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 16, padding: '16px 18px' } // v4.84.0
  const inp = { background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '6px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none' }
  // v5.22.0: kompakte Tabelle statt einer Karte pro Person
  const kurs = kursVon(month)
  const k = kurs ? Number(kurs.usd_eur) : null
  const eur = (v) => k ? <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{euroText(v * k)}</span> : null
  const th = { fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', textAlign: 'right', padding: '8px 12px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
  const td = { padding: '9px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, textAlign: 'right', fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap', verticalAlign: 'top' }
  const tdName = { ...td, textAlign: 'left', fontFamily: 'inherit', fontWeight: 700, color: 'var(--text-primary)' }
  const kpi = (wert, euro, label, farbe) => (
    <div style={{ ...card, padding: '12px 14px' }}>
      <div style={{ fontSize: 21, fontWeight: 800, fontFamily: 'ui-monospace, monospace', color: farbe }}>{wert}</div>
      {euro && <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', fontFamily: 'ui-monospace, monospace' }}>{euro}</div>}
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>{label}</div>
    </div>
  )
  const satzKnopf = (name, type, text, farbe) => (
    <button type="button" onClick={() => startEdit(name, type)}
      style={{ fontFamily: 'inherit', fontSize: 12, padding: '3px 9px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap',
        border: `1px ${text ? 'solid' : 'dashed'} ${text ? 'var(--border)' : 'rgba(245,158,11,0.5)'}`, background: 'transparent', color: text ? farbe : '#f59e0b', fontWeight: 700 }}>
      {text || '+ Satz festlegen'}
    </button>
  )
  const chip = (key, label) => (
    <button key={key} type="button" onClick={() => setFilter(key)}
      style={{ fontSize: 12, padding: '5px 11px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
        border: `1px solid ${filter === key ? '#06b6d4' : 'var(--border)'}`, background: filter === key ? 'rgba(6,182,212,0.1)' : 'transparent', color: filter === key ? '#06b6d4' : 'var(--text-secondary)' }}>{label}</button>
  )
  const passt = (name, umsatz, s) => {
    if (suche.trim() && !name.toLowerCase().includes(suche.trim().toLowerCase())) return false
    if (filter === 'umsatz') return umsatz > 0.004
    if (filter === 'ohne') return !s
    return true
  }

  // Zeilen der beiden Tabellen
  const modelZeilen = models.filter(m => m.active !== false || modelRev(m.name).total > 0).map(m => {
    const s = getSetting(m.name, 'model'); const rev = modelRev(m.name)
    return { name: m.name, s, rev, x: modelRechnung(s, rev) }
  })
  const chatterAlle = chatters.filter(c => c.active !== false || chatterRev(c.name).total > 0).map(c => {
    const s = getSetting(c.name, 'chatter'); const rev = chatterRev(c.name)
    return { name: c.name, s, rev, x: chatterRechnung(s, rev, month), inaktiv: istInaktiv(s, month), kontaktInaktiv: c.active === false }
  })
  const chatterZeilen = chatterAlle.filter(z => !z.inaktiv)
  const chatterInaktiv = chatterAlle.filter(z => z.inaktiv)
  const summe = (liste, f) => liste.reduce((t, z) => t + (f(z) || 0), 0)
  // v5.34.0: letzter Tag mit Daten im Monat (für „01.09.–30.09.“)
  const letzterTag = [...chatSnaps, ...snaps].map(x => x.business_date).filter(Boolean).sort().pop() || null
  const telegramVon = (name) => chatters.find(c => c.name === name)?.telegram_id || null
  const nachrichtOeffnen = (z) => setNachricht({ name: z.name, text: chatterNachricht(z, month, k, letzterTag), telegram: telegramVon(z.name), status: '' })
  const nachrichtSenden = async () => {
    if (!nachricht?.telegram) return
    setNachricht(n => ({ ...n, status: 'sendet' }))
    const r = await sendTelegramMessage(nachricht.telegram, nachricht.text)
    setNachricht(n => ({ ...n, status: r?.ok ? 'ok' : 'fehler' }))
  }
  const alleSenden = async (liste) => {
    const mitTg = liste.filter(z => z.x && telegramVon(z.name))
    const ohne = liste.filter(z => z.x && !telegramVon(z.name)).map(z => z.name)
    if (!mitTg.length) { alert('Kein Chatter mit Satz und Telegram-ID gefunden.'); return }
    if (!window.confirm(`Abrechnung ${monthLabel} per Telegram an ${mitTg.length} Chatter schicken?\n\n${mitTg.map(z => '• ' + z.name).join('\n')}${ohne.length ? `\n\nOhne Telegram-ID (bekommen nichts): ${ohne.join(', ')}` : ''}${k ? '' : '\n\n⚠ Für diesen Monat ist noch kein Euro-Kurs eingetragen.'}`)) return
    let ok = 0; const fehl = []
    for (const z of mitTg) {
      const r = await sendTelegramMessage(telegramVon(z.name), chatterNachricht(z, month, k, letzterTag))
      if (r?.ok) ok++; else fehl.push(z.name)
    }
    alert(`✓ ${ok} von ${mitTg.length} verschickt.${fehl.length ? `\nNicht angekommen: ${fehl.join(', ')}` : ''}`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[['models', 'Models'], ['chatters', 'Chatters'], ['verlauf', 'Verdienst je Monat']].map(([key, label]) => (
            <button key={key} onClick={() => setSection(key)} style={{
              padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
              background: section === key ? '#7c3aed' : 'var(--bg-card)',
              color: section === key ? '#fff' : 'var(--text-secondary)',
              border: '1px solid ' + (section === key ? '#7c3aed' : 'var(--border)'),
            }}>{label}</button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {section !== 'verlauf' && (
            <select value={month} onChange={e => setMonth(e.target.value)} style={inp}>
              {months.map(m => (
                <option key={m} value={m}>{new Date(m + '-15').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</option>
              ))}
            </select>
          )}
          {/* Kurs des Monats */}
          {section !== 'verlauf' && !kursFehlt && (
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)', padding: '4px 8px', borderRadius: 9,
              border: `1px solid ${kurs ? 'rgba(16,185,129,0.5)' : 'rgba(245,158,11,0.6)'}`, background: kurs ? 'transparent' : 'rgba(245,158,11,0.08)' }}>
              Kurs {new Date(month + '-15').toLocaleDateString('de-DE', { month: 'short' })}: 1 $ =
              <input value={kursEingabe} onChange={e => setKursEingabe(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 8))} onBlur={kursSpeichern}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} placeholder="0,92" inputMode="decimal"
                style={{ ...inp, width: 64, fontFamily: 'ui-monospace, monospace', fontSize: 13 }} /> €
              <span style={{ fontSize: 10.5, color: kurs ? 'var(--text-muted)' : '#f59e0b' }}>
                {kurs ? `${new Date(kurs.eingetragen_am).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}${kurs.eingetragen_von ? ' · ' + kurs.eingetragen_von : ''}` : 'fehlt'}
              </span>
            </span>
          )}
          {/* v5.33.0: Export */}
          {section !== 'verlauf' && (() => {
            const kursZahl = kurs ? Number(kurs.usd_eur) : null
            const exModels = modelZeilen.filter(z => z.rev.total > 0.004).sort((a, b) => b.rev.total - a.rev.total)
            const exChatter = chatterZeilen.filter(z => z.rev.total > 0.004).sort((a, b) => b.rev.total - a.rev.total)
            const liste = section === 'models' ? exModels : exChatter
            const punkt = { display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: 'var(--text-primary)', padding: '9px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }
            return (
              <details className="billing-export" style={{ position: 'relative' }}>
                <summary style={{ listStyle: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, padding: '6px 12px', borderRadius: 9, border: '1px solid var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-card)' }}>⬇ Export</summary>
                <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 30, width: 280, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 6, boxShadow: '0 14px 40px rgba(0,0,0,.45)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '6px 12px 4px' }}>{section === 'models' ? 'Models' : 'Chatter'} · {monthLabel} · {liste.length} mit Umsatz{kursZahl ? '' : ' · ohne €-Kurs'}</div>
                  <button type="button" style={punkt} onClick={e => { e.currentTarget.closest('details').open = false; section === 'models' ? excelModels(exModels, month, kursZahl) : excelChatter(exChatter, month, kursZahl) }}>📊 Excel-Tabelle (.csv)</button>
                  <button type="button" style={punkt} disabled={!liste.length} onClick={e => { e.currentTarget.closest('details').open = false; abrechnungenPdf({ bis: letzterTag,  art: section === 'models' ? 'model' : 'chatter', zeilen: liste, monat: month, kurs: kursZahl }) }}>📄 Alle Abrechnungen als PDF herunterladen ({liste.length})</button>
                  {section === 'chatters' && <button type="button" style={punkt} disabled={!liste.length} onClick={e => { e.currentTarget.closest('details').open = false; alleSenden(liste) }}>✉️ Allen per Telegram schicken</button>}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 12px 6px' }}>Einzeln: 📄 PDF{section === 'chatters' ? ' bzw. ✉️ Nachricht' : ''} neben dem Namen in der Tabelle.</div>
                </div>
              </details>
            )
          })()}
        </div>
      </div>
      {kursFehlt && <div style={{ fontSize: 12, color: '#f59e0b' }}>Euro-Kurs: Datenbank noch nicht eingerichtet (sql/billing-kurse.sql).</div>}

      {section !== 'verlauf' && (() => {
        // v4.49.0: Umsatz, der niemandem eindeutig gehört, sichtbar machen
        const offen = section === 'models' ? modelAuswertung.offen : chatterAuswertung.offen
        const liste = Object.entries(offen).filter(([, v]) => Math.abs(v.total) > 0.004).sort((a, b) => b[1].total - a[1].total)
        if (!liste.length) return null
        const summeOffen = liste.reduce((t, [, v]) => t + v.total, 0)
        return (
          <details style={{ ...card, padding: '10px 14px', border: '1px solid rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.06)' }}>
            <summary style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', cursor: 'pointer' }}>⚠ Nicht zugeordnet: {money(summeOffen)} ({liste.length})</summary>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0' }}>
              Diese CSV-Namen gehören keiner {section === 'models' ? 'Model' : 'Chatter'}-Abrechnung eindeutig und sind unten NICHT enthalten.
              In den Einstellungen einen Alias anlegen, dann zählen sie automatisch mit.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {liste.map(([name, v]) => (
                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12 }}>
                  <span style={{ color: 'var(--text-primary)' }}>{name} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>· {v.grund}</span></span>
                  <span style={{ fontFamily: 'monospace', color: '#f59e0b' }}>{money(v.total)}</span>
                </div>
              ))}
            </div>
          </details>
        )
      })()}

      {section === 'models' && (() => {
        const mitSatz = modelZeilen.filter(z => z.x)
        const gezeigt = modelZeilen.filter(z => passt(z.name, z.rev.total, z.s)).sort((a, b) => b.rev.total - a.rev.total)
        const umsatz = summe(modelZeilen, z => z.rev.total)
        const agentur = summe(mitSatz, z => z.x.agentur)
        const anModels = summe(mitSatz, z => z.x.model)
        return (<>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }} className="kpi-mini-grid">
            {kpi(money(umsatz), k ? euroText(umsatz * k) : null, 'Revenue gesamt (alle Models)', 'var(--text-primary)')}
            {kpi(money(agentur), k ? euroText(agentur * k) : null, 'Agentur-Anteil', '#a78bfa')}
            {kpi(money(anModels), k ? euroText(anModels * k) : null, 'an die Models', '#10b981')}
            {kpi(String(modelZeilen.filter(z => !z.s && z.rev.total > 0).length), null, 'Models mit Umsatz, ohne Satz', '#f59e0b')}
          </div>
          <div style={{ ...card, padding: '6px 0' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px 10px', flexWrap: 'wrap' }}>
              {chip('umsatz', 'nur mit Umsatz')}{chip('alle', `alle (${modelZeilen.length})`)}{chip('ohne', `ohne Satz (${modelZeilen.filter(z => !z.s).length})`)}
              <input value={suche} onChange={e => setSuche(e.target.value)} placeholder="Model suchen …" style={{ ...inp, flex: 1, minWidth: 150, fontSize: 13, padding: '7px 10px' }} />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="billing-tabelle" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820, display: 'table' }}>
                <thead><tr>{['Model', 'Satz (Agentur)', 'Subs', 'Chat', 'Tips', 'Gesamt', 'Basis', 'Agentur', 'Model'].map((h, i) => <th key={h + i} style={{ ...th, textAlign: i < 2 ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {gezeigt.map(z => (
                    <tr key={z.name}>
                      <td style={tdName}>{z.name}{z.rev.total > 0.004 && <button type="button" title="Abrechnung als PDF herunterladen" onClick={() => abrechnungenPdf({ bis: letzterTag,  art: 'model', zeilen: [z], monat: month, kurs: k })} className="billing-pdf">📄</button>}</td>
                      <td style={{ ...td, textAlign: 'left' }}>{satzKnopf(z.name, 'model', z.s ? `${z.s.percentage} % · ${[z.s.include_subs && 'S', z.s.include_chat && 'C', z.s.include_tips && 'T'].filter(Boolean).join('+') || '—'}` : '', '#a78bfa')}</td>
                      <td style={td}>{kurz(z.rev.subs)}</td>
                      <td style={td}>{kurz(z.rev.chat)}</td>
                      <td style={td}>{kurz(z.rev.tips)}</td>
                      <td style={td}>{kurz(z.rev.total)}</td>
                      <td style={{ ...td, color: z.x ? 'var(--text-primary)' : 'var(--text-muted)' }}>{z.x ? kurz(z.x.base) : '—'}</td>
                      <td style={{ ...td, color: '#a78bfa', fontWeight: 800 }}>{z.x ? <>{money(z.x.agentur)}{eur(z.x.agentur)}</> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                      <td style={{ ...td, color: '#10b981', fontWeight: 800 }}>{z.x ? <>{money(z.x.model)}{eur(z.x.model)}</> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                    </tr>
                  ))}
                  {!gezeigt.length && <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'inherit' }}>Keine Models für diesen Filter.</td></tr>}
                  {gezeigt.length > 0 && (() => {
                    const g = gezeigt.filter(z => z.x)
                    return (
                      <tr style={{ background: 'var(--bg-card2)' }}>
                        <td style={{ ...tdName, borderBottom: 'none' }}>Summe ({gezeigt.length})</td><td style={{ ...td, borderBottom: 'none' }} />
                        {[summe(gezeigt, z => z.rev.subs), summe(gezeigt, z => z.rev.chat), summe(gezeigt, z => z.rev.tips), summe(gezeigt, z => z.rev.total), summe(g, z => z.x.base)].map((v, i) => <td key={i} style={{ ...td, borderBottom: 'none', fontWeight: 800 }}>{kurz(v)}</td>)}
                        <td style={{ ...td, borderBottom: 'none', color: '#a78bfa', fontWeight: 800 }}>{money(summe(g, z => z.x.agentur))}{eur(summe(g, z => z.x.agentur))}</td>
                        <td style={{ ...td, borderBottom: 'none', color: '#10b981', fontWeight: 800 }}>{money(summe(g, z => z.x.model))}{eur(summe(g, z => z.x.model))}</td>
                      </tr>
                    )
                  })()}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', padding: '8px 12px 4px', lineHeight: 1.5 }}>
              Satz antippen = Agentur-Prozent und was zählt (S = Subs, C = Chat, T = Tips). Gilt dauerhaft für alle Monate. Was nicht zählt, geht voll ans Model.{k ? '' : ' Euro erscheint, sobald oben der Kurs des Monats eingetragen ist.'}
            </div>
          </div>
        </>)
      })()}

      {section === 'chatters' && chatterInaktiv.some(z => z.rev.total > 0.004) && (() => {
        const liste = chatterInaktiv.filter(z => z.rev.total > 0.004).sort((a, b) => b.rev.total - a.rev.total)
        return (
          <details style={{ ...card, padding: '10px 14px', border: '1px solid var(--border)', background: 'var(--bg-card2)' }}>
            <summary style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', cursor: 'pointer' }}>⏸ Nicht mit einberechnet (inaktiv): {money(summe(liste, z => z.rev.total))} · {liste.length} Chatter</summary>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0' }}>
              Diese Chatter sind inaktiv. Kunden kaufen trotzdem noch auf ihren Namen, das wird ihnen in der Datei zugerechnet, aber nicht ausgezahlt und zählt unten nicht mit.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {liste.map(z => (
                <div key={z.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{z.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11.5 }}>· inaktiv seit {new Date(z.s.inaktiv_ab + '-15').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</span></span>
                  <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{money(z.rev.total)}</span>
                    <button type="button" onClick={() => startEdit(z.name, 'chatter')} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>ändern</button>
                  </span>
                </div>
              ))}
            </div>
          </details>
        )
      })()}

      {section === 'chatters' && (() => {
        const mitSatz = chatterZeilen.filter(z => z.x)
        const gezeigt = chatterZeilen.filter(z => passt(z.name, z.rev.total, z.s)).sort((a, b) => b.rev.total - a.rev.total)
        const umsatz = summe(chatterZeilen, z => z.rev.total)
        const aus = summe(mitSatz, z => z.x.auszahlung)
        return (<>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }} className="kpi-mini-grid">
            {kpi(money(umsatz), k ? euroText(umsatz * k) : null, chatterInaktiv.length ? 'Umsatz aktiver Chatter' : 'Umsatz aller Chatter', '#06b6d4')}
            {kpi(money(aus), k ? euroText(aus * k) : null, 'Auszahlung Chatter', '#10b981')}
            {kpi(String(chatterZeilen.filter(z => z.rev.total > 0.004).length), null, 'Chatter mit Umsatz', 'var(--text-primary)')}
            {kpi(String(chatterZeilen.filter(z => !z.s && z.rev.total > 0).length), null, 'mit Umsatz, ohne Satz', '#f59e0b')}
          </div>
          <div style={{ ...card, padding: '6px 0' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px 10px', flexWrap: 'wrap' }}>
              {chip('umsatz', 'nur mit Umsatz')}{chip('alle', `alle (${chatterZeilen.length})`)}{chip('ohne', `ohne Satz (${chatterZeilen.filter(z => !z.s).length})`)}
              <input value={suche} onChange={e => setSuche(e.target.value)} placeholder="Chatter suchen …" style={{ ...inp, flex: 1, minWidth: 150, fontSize: 13, padding: '7px 10px' }} />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="billing-tabelle" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560, display: 'table' }}>
                <thead><tr>{['Chatter', 'Satz', 'Umsatz', 'Auszahlung'].map((h, i) => <th key={h} style={{ ...th, textAlign: i < 2 ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {gezeigt.map(z => (
                    <tr key={z.name}>
                      <td style={tdName}>{z.name}{z.rev.total > 0.004 && <button type="button" title="Abrechnung als PDF herunterladen" onClick={() => abrechnungenPdf({ bis: letzterTag,  art: 'chatter', zeilen: [z], monat: month, kurs: k })} className="billing-pdf">📄</button>}{z.x && <button type="button" title="Abrechnung als Nachricht schicken" onClick={() => nachrichtOeffnen(z)} className="billing-pdf">✉️</button>}{z.kontaktInaktiv && <span title="Im Kontakt als inaktiv markiert, im Billing aber noch aktiv" style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: '#f59e0b' }}>· Kontakt inaktiv</span>}</td>
                      <td style={{ ...td, textAlign: 'left' }}>{satzKnopf(z.name, 'chatter', z.s ? `${z.s.percentage} %` : '', '#06b6d4')}</td>
                      <td style={td}>{money(z.rev.total)}</td>
                      <td style={{ ...td, color: '#10b981', fontWeight: 800 }}>{z.x ? <>{money(z.x.auszahlung)}{eur(z.x.auszahlung)}</> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                    </tr>
                  ))}
                  {!gezeigt.length && <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'inherit' }}>Keine Chatter für diesen Filter.</td></tr>}
                  {gezeigt.length > 0 && (
                    <tr style={{ background: 'var(--bg-card2)' }}>
                      <td style={{ ...tdName, borderBottom: 'none' }}>Summe ({gezeigt.length})</td><td style={{ ...td, borderBottom: 'none' }} />
                      <td style={{ ...td, borderBottom: 'none', fontWeight: 800 }}>{money(summe(gezeigt, z => z.rev.total))}</td>
                      <td style={{ ...td, borderBottom: 'none', color: '#10b981', fontWeight: 800 }}>{money(summe(gezeigt.filter(z => z.x), z => z.x.auszahlung))}{eur(summe(gezeigt.filter(z => z.x), z => z.x.auszahlung))}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', padding: '8px 12px 4px', lineHeight: 1.5 }}>
              Satz antippen = Prozent ändern. Gilt dauerhaft für alle Monate. Umsatz = Revenue aus der Chatter-Datei.{k ? '' : ' Euro erscheint, sobald oben der Kurs des Monats eingetragen ist.'}
            </div>
          </div>
        </>)
      })()}

      {section === 'verlauf' && (
        <div style={{ ...card, padding: '6px 0' }}>
          <div style={{ padding: '10px 12px 2px', fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>Verdienst der Agentur je Monat</div>
          <div style={{ padding: '2px 12px 8px', fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Agentur-Anteil (Models) minus Auszahlung an die Chatter. Euro mit dem Kurs, der für den Monat eingetragen ist. Gerechnet mit den heutigen Sätzen.
          </div>
          {verlauf === null || verlauf === 'laedt' ? <div style={{ padding: 14, color: 'var(--text-muted)', fontSize: 13 }}>Rechnet …</div> : (() => {
            const max = Math.max(1, ...verlauf.map(z => z.agentur - z.auszahlung))
            return (
              <div style={{ overflowX: 'auto' }}>
                <table className="billing-tabelle" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760, display: 'table' }}>
                  <thead><tr>{['Monat', 'Kurs', 'Revenue', 'Agentur-Anteil', 'Chatter', 'Verdienst $', 'Verdienst €', ''].map((h, i) => <th key={h + i} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {verlauf.map((z, i) => {
                      const kk = kursVon(z.monat)
                      const v = z.agentur - z.auszahlung
                      return (
                        <tr key={z.monat}>
                          <td style={tdName}>{new Date(z.monat + '-15').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}{i === 0 && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> (läuft)</span>}</td>
                          <td style={td}>{kk ? String(kk.usd_eur).replace('.', ',') : (
                            <button type="button" onClick={() => { setMonth(z.monat); setSection('models') }} style={{ fontFamily: 'inherit', fontSize: 11.5, padding: '2px 8px', borderRadius: 7, border: '1px dashed rgba(245,158,11,0.6)', background: 'transparent', color: '#f59e0b', cursor: 'pointer' }}>fehlt ✎</button>)}</td>
                          <td style={td}>{kurz(z.umsatz)}</td>
                          <td style={{ ...td, color: '#a78bfa' }}>{kurz(z.agentur)}</td>
                          <td style={td}>{kurz(z.auszahlung)}</td>
                          <td style={{ ...td, color: '#10b981', fontWeight: 800 }}>{kurz(v)}</td>
                          <td style={{ ...td, color: '#10b981', fontWeight: 800 }}>{kk ? kurzEuro(v * Number(kk.usd_eur)) : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                          <td style={{ ...td, width: 130 }}><span style={{ display: 'inline-block', height: 8, borderRadius: 4, background: '#10b981', width: Math.max(0, Math.round(110 * v / max)) }} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })()}
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', padding: '8px 12px 4px' }}>„fehlt ✎“ antippen → Monat öffnet sich, oben den Kurs eintragen.</div>
        </div>
      )}

      {/* Satz ändern (Fenster) */}
      {editing && (
        <div onClick={() => !saving && setEditing(null)} style={{ position: 'fixed', inset: 0, zIndex: 100100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
          <div onClick={e => e.stopPropagation()} style={{ ...card, width: 'min(380px, 100%)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>{editing.name} · Satz</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{editing.type === 'model' ? 'Agentur-Anteil' : 'Chatter-Anteil'}</span>
              <input type="number" min="0" max="100" autoFocus value={editVals.percentage} onChange={e => setEditVals(p => ({ ...p, percentage: parseFloat(e.target.value) || 0 }))} style={{ ...inp, width: 80, fontSize: 14 }} />
              <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>%</span>
              {editing.type === 'model' && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Model: {100 - (editVals.percentage || 0)} %</span>}
            </div>
            {editing.type === 'model' ? (<>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Einberechnen:</div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <CheckBox checked={editVals.include_subs} onChange={() => setEditVals(p => ({ ...p, include_subs: !p.include_subs }))} label="Subs" />
                <CheckBox checked={editVals.include_chat} onChange={() => setEditVals(p => ({ ...p, include_chat: !p.include_chat }))} label="Chat Revenue" />
                <CheckBox checked={editVals.include_tips} onChange={() => setEditVals(p => ({ ...p, include_tips: !p.include_tips }))} label="Tips" />
              </div>
            </>) : (
              // v5.23.0: aktiv / inaktiv ab Monat
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[['', 'Aktiv'], [editVals.inaktiv_ab || month, 'Inaktiv']].map(([wert, label]) => {
                    const an = label === 'Aktiv' ? !editVals.inaktiv_ab : !!editVals.inaktiv_ab
                    return <button key={label} type="button" onClick={() => setEditVals(p => ({ ...p, inaktiv_ab: wert }))}
                      style={{ flex: 1, padding: '7px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700,
                        border: `1px solid ${an ? (label === 'Aktiv' ? '#10b981' : '#f59e0b') : 'var(--border)'}`, background: an ? (label === 'Aktiv' ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)') : 'transparent',
                        color: an ? (label === 'Aktiv' ? '#10b981' : '#f59e0b') : 'var(--text-secondary)' }}>{label}</button>
                  })}
                </div>
                {editVals.inaktiv_ab && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: 'var(--text-secondary)' }}>
                    inaktiv ab
                    <select value={editVals.inaktiv_ab} onChange={e => setEditVals(p => ({ ...p, inaktiv_ab: e.target.value }))} style={inp}>
                      {[...new Set([editVals.inaktiv_ab, ...months])].sort().reverse().map(m => <option key={m} value={m}>{new Date(m + '-15').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</option>)}
                    </select>
                  </div>
                )}
                {editVals.inaktiv_ab && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>Ab diesem Monat keine Auszahlung mehr. Was Kunden danach noch auf den Namen kaufen, steht oben unter „Nicht mit einberechnet“. Frühere Monate bleiben wie sie sind.</div>}
              </div>
            )}
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Der Satz gilt dauerhaft, für alle Monate.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setEditing(null)} disabled={saving} style={{ flex: 1, padding: '9px', borderRadius: 9, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Abbrechen</button>
              <button onClick={save} disabled={saving} style={{ flex: 2, padding: '9px', borderRadius: 9, background: '#7c3aed', color: '#fff', border: 'none', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>{saving ? '…' : 'Speichern'}</button>
            </div>
          </div>
        </div>
      )}

      {/* v5.34.0: Abrechnung als Nachricht */}
      {nachricht && (
        <div onClick={() => setNachricht(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ ...card, width: 460, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <b style={{ flex: 1, fontSize: 16, color: 'var(--text-primary)' }}>✉️ Abrechnung an {nachricht.name}</b>
              <button type="button" onClick={() => setNachricht(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Text kannst du vor dem Senden noch ändern.</div>
            <textarea value={nachricht.text} onChange={e => setNachricht(n => ({ ...n, text: e.target.value, status: '' }))} rows={14}
              style={{ ...inp, fontSize: 13.5, lineHeight: 1.5, padding: '10px 12px', resize: 'vertical', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }} />
            {nachricht.status === 'ok' && <div style={{ fontSize: 13, color: '#10b981', fontWeight: 700 }}>✓ Per Telegram verschickt.</div>}
            {nachricht.status === 'fehler' && <div style={{ fontSize: 13, color: '#ef4444', fontWeight: 700 }}>⚠ Ging nicht raus. Text kopieren und selbst schicken.</div>}
            {!nachricht.telegram && <div style={{ fontSize: 12.5, color: '#f59e0b' }}>Keine Telegram-ID hinterlegt, nur Kopieren möglich.</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(nachricht.text); setNachricht(n => ({ ...n, status: n.status || 'kopiert' })) } catch { /* egal */ } }}
                style={{ padding: '9px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{nachricht.status === 'kopiert' ? '✓ Kopiert' : '📋 Kopieren'}</button>
              <button type="button" disabled={!nachricht.telegram || nachricht.status === 'sendet' || nachricht.status === 'ok'} onClick={nachrichtSenden}
                style={{ padding: '9px 14px', borderRadius: 10, border: 'none', background: '#7c3aed', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', opacity: nachricht.telegram && nachricht.status !== 'ok' ? 1 : 0.5 }}>{nachricht.status === 'sendet' ? '…' : 'Per Telegram schicken'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
