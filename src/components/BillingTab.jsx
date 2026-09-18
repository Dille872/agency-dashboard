import React, { useState, useEffect, useMemo } from 'react'
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

  useEffect(() => { load() }, [month])

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
      supabase.from('chatters_contact').select('name, active').order('name'),
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
    })
  }

  const save = async () => {
    if (!editing) return
    setSaving(true)
    const ex = getSetting(editing.name, editing.type)
    const payload = { person_name: editing.name, person_type: editing.type, ...editVals, updated_at: new Date().toISOString() }
    const { error } = ex
      ? await supabase.from('billing_settings').update(payload).eq('id', ex.id)
      : await supabase.from('billing_settings').insert(payload)
    if (error) {
      // v4.49.0: vorher wurde der Fehler verschluckt und das Formular geschlossen
      alert('⚠ Prozente NICHT gespeichert: ' + error.message)
      setSaving(false)
      return
    }
    setEditing(null)
    await load()
    setSaving(false)
  }

  // v4.49.0: einmal pro Monat alle Zeilen verteilen, statt je Person zu suchen.
  const modelAuswertung = useMemo(() => {
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
  }, [models, aliases, snaps])

  const chatterAuswertung = useMemo(() => {
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
  }, [chatters, chatterAliases, chatSnaps])

  const modelRev = (modelName) => modelAuswertung.proPerson[modelName] || { subs: 0, chat: 0, tips: 0, total: 0 }
  const chatterRev = (chatterName) => chatterAuswertung.proPerson[chatterName] || { chat: 0, total: 0 }

  const monthLabel = new Date(month + '-15').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
  const months = []
  const now = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'))
  }

  const card = { background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '16px 18px' }
  const inp = { background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '6px 8px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {['models', 'chatters'].map(s => (
            <button key={s} onClick={() => setSection(s)} style={{
              padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
              background: section === s ? '#7c3aed' : 'var(--bg-card)',
              color: section === s ? '#fff' : 'var(--text-secondary)',
              border: '1px solid ' + (section === s ? '#7c3aed' : 'var(--border)'),
            }}>{s === 'models' ? 'Models' : 'Chatters'}</button>
          ))}
        </div>
        <select value={month} onChange={e => setMonth(e.target.value)} style={{ ...inp, marginLeft: 'auto' }}>
          {months.map(m => (
            <option key={m} value={m}>{new Date(m + '-15').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</option>
          ))}
        </select>
      </div>

      {(() => {
        // v4.49.0: Umsatz, der niemandem eindeutig gehört, sichtbar machen
        const offen = section === 'models' ? modelAuswertung.offen : chatterAuswertung.offen
        const liste = Object.entries(offen).filter(([, v]) => Math.abs(v.total) > 0.004).sort((a, b) => b[1].total - a[1].total)
        if (!liste.length) return null
        const summe = liste.reduce((t, [, v]) => t + v.total, 0)
        return (
          <div style={{ ...card, border: '1px solid rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.06)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', marginBottom: 4 }}>
              ⚠ Nicht zugeordnet: {money(summe)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
              Diese CSV-Namen gehören keiner {section === 'models' ? 'Model' : 'Chatter'}-Abrechnung eindeutig und sind oben NICHT enthalten.
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
          </div>
        )
      })()}

      {section === 'models' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {models.filter(model => model.active !== false || modelRev(model.name).total > 0).map(model => {
            const s = getSetting(model.name, 'model')
            const rev = modelRev(model.name)
            const isEdit = editing && editing.name === model.name && editing.type === 'model'
            let base = 0
            if (s) {
              if (s.include_subs) base += rev.subs
              if (s.include_chat) base += rev.chat
              if (s.include_tips) base += rev.tips
            }
            const agencyShare = s ? base * (s.percentage / 100) : 0
            const modelShare = base - agencyShare

            return (
              <div key={model.name} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(245,158,11,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#f59e0b' }}>{model.name[0]}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{model.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{monthLabel}</div>
                    </div>
                  </div>
                  <button onClick={() => isEdit ? setEditing(null) : startEdit(model.name, 'model')} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: isEdit ? '#7c3aed' : 'transparent', border: '1px solid ' + (isEdit ? '#7c3aed' : 'var(--border)'), color: isEdit ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {isEdit ? 'Schliessen' : s ? 'Bearbeiten' : '+ Prozente'}
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: s ? 14 : 0 }}>
                  {[['Gesamt', rev.total, 'var(--text-primary)'], ['Subs', rev.subs, '#a78bfa'], ['Chat', rev.chat, '#06b6d4'], ['Tips', rev.tips, '#f59e0b']].map(item => (
                    <div key={item[0]} style={{ background: 'var(--bg-card2)', borderRadius: 7, padding: '8px 10px', border: '1px solid #1e1e3a' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>{item[0]}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: item[2], fontFamily: 'monospace' }}>{money(item[1])}</div>
                    </div>
                  ))}
                </div>

                {s && (
                  <div style={{ borderTop: '1px solid #1e1e3a', paddingTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: isEdit ? 14 : 0 }}>
                    <div style={{ background: 'rgba(16,185,129,0.08)', borderRadius: 7, padding: '10px 12px', border: '1px solid rgba(16,185,129,0.2)' }}>
                      <div style={{ fontSize: 10, color: '#10b981', marginBottom: 3 }}>Model ({100 - s.percentage}%)</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#10b981', fontFamily: 'monospace' }}>{money(modelShare)}</div>
                    </div>
                    <div style={{ background: 'rgba(124,58,237,0.08)', borderRadius: 7, padding: '10px 12px', border: '1px solid rgba(124,58,237,0.2)' }}>
                      <div style={{ fontSize: 10, color: '#a78bfa', marginBottom: 3 }}>Agentur ({s.percentage}%)</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#a78bfa', fontFamily: 'monospace' }}>{money(agencyShare)}</div>
                    </div>
                    <div style={{ gridColumn: '1 / -1', fontSize: 10, color: 'var(--text-muted)' }}>
                      Basis: {money(base)} · {[s.include_subs && 'Subs', s.include_chat && 'Chat', s.include_tips && 'Tips'].filter(Boolean).join(' + ')}
                    </div>
                  </div>
                )}

                {isEdit && (
                  <div style={{ marginTop: s ? 0 : 14, paddingTop: 14, borderTop: '1px solid #1e1e3a' }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Agentur-Anteil %</div>
                        <input type="number" min="0" max="100" value={editVals.percentage} onChange={e => setEditVals(p => ({ ...p, percentage: parseFloat(e.target.value) || 0 }))} style={{ ...inp, width: 80 }} />
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Model: {100 - (editVals.percentage || 0)}%</div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>Einberechnen:</div>
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
                      <CheckBox checked={editVals.include_subs} onChange={() => setEditVals(p => ({ ...p, include_subs: !p.include_subs }))} label="Subs" />
                      <CheckBox checked={editVals.include_chat} onChange={() => setEditVals(p => ({ ...p, include_chat: !p.include_chat }))} label="Chat Revenue" />
                      <CheckBox checked={editVals.include_tips} onChange={() => setEditVals(p => ({ ...p, include_tips: !p.include_tips }))} label="Tips" />
                    </div>
                    <button onClick={save} disabled={saving} style={{ padding: '7px 18px', borderRadius: 7, background: '#7c3aed', color: '#fff', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {saving ? '...' : 'Speichern'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {section === 'chatters' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {chatters.filter(chatter => chatter.active !== false || chatterRev(chatter.name).total > 0).map(chatter => {
            const s = getSetting(chatter.name, 'chatter')
            const rev = chatterRev(chatter.name)
            const isEdit = editing && editing.name === chatter.name && editing.type === 'chatter'
            const base = s && s.include_chat ? rev.chat : rev.total
            const chatterShare = s ? base * (s.percentage / 100) : 0

            return (
              <div key={chatter.name} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(6,182,212,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#06b6d4' }}>{chatter.name[0]}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{chatter.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{monthLabel}</div>
                    </div>
                  </div>
                  <button onClick={() => isEdit ? setEditing(null) : startEdit(chatter.name, 'chatter')} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: isEdit ? '#7c3aed' : 'transparent', border: '1px solid ' + (isEdit ? '#7c3aed' : 'var(--border)'), color: isEdit ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {isEdit ? 'Schliessen' : s ? 'Bearbeiten' : '+ Prozente'}
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: s ? 14 : 0 }}>
                  {[['Chat Revenue', rev.chat, '#06b6d4'], ['Gesamt', rev.total, 'var(--text-primary)']].map(item => (
                    <div key={item[0]} style={{ background: 'var(--bg-card2)', borderRadius: 7, padding: '8px 10px', border: '1px solid #1e1e3a' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>{item[0]}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: item[2], fontFamily: 'monospace' }}>{money(item[1])}</div>
                    </div>
                  ))}
                </div>

                {s && (
                  <div style={{ borderTop: '1px solid #1e1e3a', paddingTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: isEdit ? 14 : 0 }}>
                    <div style={{ background: 'rgba(6,182,212,0.08)', borderRadius: 7, padding: '10px 12px', border: '1px solid rgba(6,182,212,0.2)' }}>
                      <div style={{ fontSize: 10, color: '#06b6d4', marginBottom: 3 }}>Chatter ({s.percentage}%)</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#06b6d4', fontFamily: 'monospace' }}>{money(chatterShare)}</div>
                    </div>
                    <div style={{ background: 'rgba(16,185,129,0.06)', borderRadius: 7, padding: '10px 12px', border: '1px solid rgba(16,185,129,0.2)' }}>
                      <div style={{ fontSize: 10, color: '#10b981', marginBottom: 3 }}>Basis</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#10b981', fontFamily: 'monospace' }}>{money(base)}</div>
                    </div>
                    <div style={{ gridColumn: '1 / -1', fontSize: 10, color: 'var(--text-muted)' }}>
                      {s.include_chat ? 'Basis: Chat Revenue' : 'Basis: Gesamt'}
                    </div>
                  </div>
                )}

                {!s && !isEdit && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>Noch keine Prozente eingestellt</div>
                )}

                {isEdit && (
                  <div style={{ marginTop: s ? 0 : 14, paddingTop: 14, borderTop: '1px solid #1e1e3a' }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Chatter-Anteil %</div>
                        <input type="number" min="0" max="100" value={editVals.percentage} onChange={e => setEditVals(p => ({ ...p, percentage: parseFloat(e.target.value) || 0 }))} style={{ ...inp, width: 80 }} />
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>Basis:</div>
                    <div style={{ display: 'flex', gap: 14, marginBottom: 12 }}>
                      <CheckBox checked={editVals.include_chat} onChange={() => setEditVals(p => ({ ...p, include_chat: !p.include_chat }))} label="Nur Chat Revenue" />
                    </div>
                    <button onClick={save} disabled={saving} style={{ padding: '7px 18px', borderRadius: 7, background: '#7c3aed', color: '#fff', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {saving ? '...' : 'Speichern'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

    </div>
  )
}
