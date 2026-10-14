import React, { useRef, useState } from 'react'
import { Upload, Check, CircleAlert, CircleHelp } from 'lucide-react'
import { supabase } from '../supabase'
import { parseCSV, parseModelRow, formatShortDate } from '../utils'
import Card from './Card'

// ── Open Chats nachtragen (v5.48.0) ────────────────────────────────────────
// Bis v5.47.0 hat der Import der Vergleichsdatei („Detailed Comparison“) die
// Spalte „Open Chats“ nicht übernommen. Ab v5.48.0 steht sie in jeder neuen
// Zeile (model_snapshots.rows[].openChats). Für die alten Tage gilt:
//
//   Die alten Exporte hier noch einmal einspielen. Es wird NUR der Wert
//   openChats in die schon gespeicherten Zeilen geschrieben. Umsatz, Subs,
//   Dateiname, Upload-Zeit und alles andere bleiben genau, wie sie sind.
//
// Den Tag muss niemand angeben: Jede Datei wird über ihren Inhalt erkannt.
// Ein Tag passt nur, wenn ALLE Accounts mit genau demselben Umsatz (auf den
// Cent) gespeichert sind. Passt keiner oder mehr als einer, wird nichts
// geschrieben und die Datei als Rückfrage angezeigt.

const schluessel = (r) => `${String(r.creator || '').trim()}|${(Number(r.revenue) || 0).toFixed(2)}`

function fingerabdruck(rows) {
  return rows.map(schluessel).sort().join('\n')
}

async function alleTageLaden() {
  const alle = []
  for (let seite = 0; seite < 50; seite++) {
    const { data, error } = await supabase.from('model_snapshots')
      .select('business_date, rows').order('business_date').range(seite * 500, seite * 500 + 499)
    if (error) throw error
    alle.push(...(data || []))
    if (!data || data.length < 500) break
  }
  return alle
}

export default function OpenChatsNachtragen() {
  const input = useRef(null)
  const [liste, setListe] = useState(null)   // [{ datei, status, tag?, text, neu? }]
  const [arbeitet, setArbeitet] = useState(false)
  const [fertig, setFertig] = useState('')

  const pruefen = async (dateien) => {
    const files = [...(dateien || [])]
    if (!files.length) return
    setArbeitet(true); setFertig('')
    try {
      const tage = await alleTageLaden()
      const proAbdruck = new Map()
      for (const t of tage) {
        const k = fingerabdruck(t.rows || [])
        if (!proAbdruck.has(k)) proAbdruck.set(k, [])
        proAbdruck.get(k).push(t)
      }
      const ergebnis = []
      const vergeben = new Set()
      for (const datei of files) {
        const text = await datei.text()
        const { headers, rows: roh } = parseCSV(text)
        const rows = roh.map(r => parseModelRow(r, headers)).filter(Boolean)
        if (!rows.length) { ergebnis.push({ datei: datei.name, status: 'fehler', text: 'Keine gültigen Zeilen, ist das die Vergleichsdatei?' }); continue }
        if (rows.every(r => r.openChats === null)) { ergebnis.push({ datei: datei.name, status: 'fehler', text: 'Diese Datei hat keine Spalte „Open Chats“.' }); continue }
        const treffer = proAbdruck.get(fingerabdruck(rows)) || []
        if (!treffer.length) { ergebnis.push({ datei: datei.name, status: 'frage', text: 'Kein gespeicherter Tag hat genau diese Umsätze. Nichts geändert.' }); continue }
        if (treffer.length > 1) { ergebnis.push({ datei: datei.name, status: 'frage', text: `Passt zu mehreren Tagen (${treffer.map(t => formatShortDate(t.business_date)).join(', ')}). Nichts geändert.` }); continue }
        const tag = treffer[0]
        if (vergeben.has(tag.business_date)) { ergebnis.push({ datei: datei.name, status: 'frage', text: `Tag ${formatShortDate(tag.business_date)} kam schon mit einer anderen Datei. Doppelt gewählt?` }); continue }
        vergeben.add(tag.business_date)
        // Werte je Account (bei gleichem Schlüssel in Reihenfolge der Datei)
        const warteschlange = new Map()
        for (const r of rows) {
          const k = schluessel(r)
          if (!warteschlange.has(k)) warteschlange.set(k, [])
          warteschlange.get(k).push(r.openChats)
        }
        let geaendert = 0, schonDa = 0
        const neu = (tag.rows || []).map(r => {
          const wert = warteschlange.get(schluessel(r))?.shift() ?? null
          if (r.openChats != null && r.openChats === wert) { schonDa++; return r }
          if (wert === null) return r
          geaendert++
          return { ...r, openChats: wert }
        })
        const summe = rows.reduce((a, r) => a + (Number(r.openChats) || 0), 0)
        ergebnis.push({
          datei: datei.name, tag: tag.business_date, neu, status: geaendert ? 'bereit' : 'nichts',
          text: geaendert ? `${geaendert} Accounts, zusammen ${summe} offene Chats` : (schonDa ? 'Schon eingetragen.' : 'Keine Werte in der Datei.'),
        })
      }
      ergebnis.sort((a, b) => String(a.tag || '9').localeCompare(String(b.tag || '9')))
      setListe(ergebnis)
    } catch (e) {
      setListe([{ datei: '', status: 'fehler', text: 'Gespeicherte Tage konnten nicht geladen werden: ' + (e?.message || e) }])
    }
    setArbeitet(false)
  }

  const speichern = async () => {
    setArbeitet(true)
    let ok = 0
    const neu = [...liste]
    for (let i = 0; i < neu.length; i++) {
      const e = neu[i]
      if (e.status !== 'bereit') continue
      // Nur die Spalte rows wird geschrieben, und nur für genau diesen Tag
      const { error } = await supabase.from('model_snapshots').update({ rows: e.neu }).eq('business_date', e.tag)
      neu[i] = error ? { ...e, status: 'fehler', text: 'Nicht gespeichert: ' + error.message } : { ...e, status: 'gespeichert' }
      if (!error) ok++
      setListe([...neu])
    }
    setArbeitet(false)
    setFertig(`${ok} ${ok === 1 ? 'Tag' : 'Tage'} ergänzt.`)
  }

  const bereit = (liste || []).filter(e => e.status === 'bereit').length
  const farbe = { bereit: 'var(--text-primary)', gespeichert: 'var(--green)', nichts: 'var(--text-muted)', frage: 'var(--yellow)', fehler: 'var(--red)' }
  const Symbol = ({ s }) => s === 'gespeichert' || s === 'nichts' ? <Check size={14} />
    : s === 'frage' ? <CircleHelp size={14} /> : s === 'fehler' ? <CircleAlert size={14} /> : <Upload size={14} />

  return (
    <Card title="Open Chats nachtragen">
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 12 }}>
        Neue Vergleichsdateien bringen „Open Chats“ ab jetzt automatisch mit. Für ältere Tage hier die alten Exporte
        (Detailed Comparison) einspielen, gern alle auf einmal. Der Tag wird am Inhalt erkannt. Geschrieben wird nur
        der Wert „Open Chats“, alles andere bleibt unverändert.
      </div>
      <input ref={input} type="file" accept=".csv,text/csv" multiple hidden onChange={e => { const d = e.target.files; pruefen(d); e.target.value = '' }} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" disabled={arbeitet} onClick={() => input.current?.click()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: 13, fontWeight: 700, cursor: arbeitet ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
          <Upload size={15} /> {arbeitet && !liste ? 'Prüft …' : 'Exporte wählen'}
        </button>
        {bereit > 0 && (
          <button type="button" disabled={arbeitet} onClick={speichern}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 9, border: 'none', background: 'var(--accent, #06b6d4)', color: '#fff', fontSize: 13, fontWeight: 800, cursor: arbeitet ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
            <Check size={15} /> {arbeitet ? 'Speichert …' : `${bereit} ${bereit === 1 ? 'Tag' : 'Tage'} ergänzen`}
          </button>
        )}
      </div>
      {fertig && <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: 'var(--green)' }}>{fertig}</div>}
      {liste && liste.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {liste.map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: farbe[e.status] || 'var(--text-primary)', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
              <Symbol s={e.status} />
              <span style={{ width: 62, fontWeight: 700 }}>{e.tag ? formatShortDate(e.tag) : '–'}</span>
              <span style={{ flex: 1, minWidth: 0 }}>{e.text}</span>
              <span style={{ color: 'var(--text-muted)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.datei}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
