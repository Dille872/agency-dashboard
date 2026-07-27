import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { Lightbulb, Trash2, Plus, Save } from 'lucide-react'
import { logActivity } from '../activity'

// v3.83.0: Admin-Bereich für die Nachrichten-Vorschläge.
// Steckbriefe pflegen, Anlässe verwalten, Freigabe pro Chatter, Auswertung, History.

const TABS = [
  { k: 'basics', label: '⚙️ Basics' },
  { k: 'steck', label: '🎭 Steckbriefe' },
  { k: 'occ', label: '🗂️ Anlässe' },
  { k: 'frei', label: '✅ Freigabe' },
  { k: 'stats', label: '📊 Auswertung' },
  { k: 'hist', label: '🕑 History' },
]
const card = { background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 12, padding: '18px 20px' }
const lbl = { fontSize: 10, fontWeight: 700, letterSpacing: '.5px', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 7 }
const inp = { width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', borderRadius: 8, padding: '9px 11px', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }
const ACC = '#7c3aed', ACC2 = '#a78bfa'

function Seg({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', background: 'var(--bg-input)', border: '1px solid #2e2e5a', borderRadius: 9, padding: 3, gap: 3 }}>
      {options.map(o => (
        <button key={o} onClick={() => onChange(o)} style={{
          flex: 1, border: 'none', background: value === o ? 'rgba(124,58,237,0.18)' : 'transparent',
          color: value === o ? ACC2 : 'var(--text-secondary)', padding: '7px 6px', borderRadius: 6,
          fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
        }}>{o}</button>
      ))}
    </div>
  )
}
function Tags({ items, onAdd, onRemove, color }) {
  const [v, setV] = useState('')
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
      {items.map((t, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, background: color || 'rgba(167,139,250,0.1)', border: '1px solid #2e2e5a', color: color ? '#fca5a5' : ACC2, padding: '5px 10px', borderRadius: 8, fontWeight: 600 }}>
          {t} <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => onRemove(i)}>✕</span>
        </span>
      ))}
      <input value={v} onChange={e => setV(e.target.value)} placeholder="+ neu, Enter"
        onKeyDown={e => { if (e.key === 'Enter' && v.trim()) { onAdd(v.trim()); setV('') } }}
        style={{ ...inp, width: 130, padding: '5px 9px', fontSize: 12 }} />
    </div>
  )
}

export default function SuggestionsAdmin() {
  const [tab, setTab] = useState('steck')
  const [models, setModels] = useState([])
  const [personas, setPersonas] = useState({})
  const [sel, setSel] = useState('')
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [occasions, setOccasions] = useState([])
  const [chatters, setChatters] = useState([])
  const [statModel, setStatModel] = useState('alle')
  const [statOcc, setStatOcc] = useState('alle')
  const [lib, setLib] = useState([])
  const [hist, setHist] = useState([])
  const [basics, setBasics] = useState('')
  const [basicsSaving, setBasicsSaving] = useState(false)

  useEffect(() => { loadAll() }, [])

  const saveBasics = async () => {
    setBasicsSaving(true)
    const { error } = await supabase.from('suggestion_settings').upsert({ id: 1, global_rules: basics, updated_at: new Date().toISOString() }, { onConflict: 'id' })
    setBasicsSaving(false)
    if (error) { alert('Fehler: ' + error.message); return }
    logActivity('suggestions.basics', {})
    alert('Basics gespeichert ✓')
  }

  const loadAll = async () => {
    const { data: m } = await supabase.from('models_contact').select('name, active').order('name')
    const active = (m || []).filter(x => x.active !== false).map(x => x.name).filter(Boolean)
    setModels(active)
    const { data: p } = await supabase.from('model_personas').select('*')
    const map = {}; for (const row of p || []) map[row.model_name] = row
    setPersonas(map)
    if (active.length && !sel) selectModel(active[0], map)
    const { data: o } = await supabase.from('message_occasions').select('*').order('sort')
    setOccasions(o || [])
    const { data: c } = await supabase.from('user_roles').select('user_id, display_name, roles, role, can_suggest')
    setChatters((c || []).filter(u => (u.roles || []).includes('chatter') || u.role === 'chatter').filter(u => u.display_name))
    const { data: s } = await supabase.from('suggestion_settings').select('global_rules').eq('id', 1).maybeSingle()
    setBasics(s?.global_rules || '')
  }

  const emptyForm = (name) => ({ model_name: name, description: '', extra: '', persona_tags: [], anrede: 'du', dialekt: 'hochdeutsch', laenge: 'kurz', emoji: 'mittel', direktheit: 'normal', anzahl: 8, nogos: [], emojis: [], examples: [] })
  const selectModel = (name, map = personas) => { setSel(name); setForm(map[name] ? { ...emptyForm(name), ...map[name] } : emptyForm(name)) }

  const savePersona = async () => {
    setSaving(true)
    const { error } = await supabase.from('model_personas').upsert({ ...form, updated_at: new Date().toISOString(), active: true }, { onConflict: 'model_name' })
    setSaving(false)
    if (error) { alert('Fehler: ' + error.message); return }
    setPersonas(prev => ({ ...prev, [form.model_name]: { ...form } }))
    logActivity('persona.edit', { entity: form.model_name })
    alert('Steckbrief gespeichert ✓')
  }

  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Anlässe
  const addOcc = async () => {
    const key = prompt('Kurz-Schlüssel (z.B. bday)'); if (!key) return
    const label = prompt('Anzeigename (z.B. Geburtstag)') || key
    const { data } = await supabase.from('message_occasions').insert({ key, label, icon: '💬', sort: occasions.length + 1 }).select()
    if (data) setOccasions([...occasions, ...data])
    logActivity('occasion.edit', { entity: label, detail: 'angelegt' })
  }
  const delOcc = async (id) => {
    const label = occasions.find(o => o.id === id)?.label || `#${id}`
    await supabase.from('message_occasions').delete().eq('id', id)
    setOccasions(occasions.filter(o => o.id !== id))
    logActivity('occasion.edit', { entity: label, detail: 'gelöscht' })
  }
  const saveOccField = async (id, field, val) => {
    setOccasions(occasions.map(o => o.id === id ? { ...o, [field]: val } : o))
    await supabase.from('message_occasions').update({ [field]: val }).eq('id', id)
  }

  // Freigabe
  const toggleSuggest = async (u) => {
    const next = !u.can_suggest
    setChatters(chatters.map(c => c.user_id === u.user_id ? { ...c, can_suggest: next } : c))
    const { error } = await supabase.from('user_roles').update({ can_suggest: next }).eq('user_id', u.user_id)
    if (error) alert('Fehler: ' + error.message)
  }

  // Auswertung
  useEffect(() => { if (statModel && statOcc) loadLib() }, [statModel, statOcc])
  const loadLib = async () => {
    let q = supabase.from('message_library').select('*')
    if (statModel && statModel !== 'alle') q = q.eq('model_name', statModel)
    if (statOcc && statOcc !== 'alle') q = q.eq('occasion', statOcc)
    const { data } = await q.order('up', { ascending: false }).limit(80)
    setLib(data || [])
  }
  // History
  useEffect(() => { if (tab === 'hist') loadHist() }, [tab])
  const loadHist = async () => {
    const { data } = await supabase.from('message_suggestions').select('*').order('created_at', { ascending: false }).limit(120)
    setHist(data || [])
  }

  const missing = models.filter(m => !personas[m])
  const occMap = Object.fromEntries(occasions.map(o => [o.key, o.label]))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
        <Lightbulb size={19} color={ACC2} /><span style={{ fontSize: 17, fontWeight: 800 }}>Vorschläge – Verwaltung</span>
      </div>
      <div style={{ display: 'flex', gap: 6, background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 12, padding: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            border: 'none', background: tab === t.k ? 'rgba(124,58,237,0.18)' : 'transparent',
            color: tab === t.k ? ACC2 : 'var(--text-muted)', padding: '9px 14px', borderRadius: 8,
            fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>{t.label}</button>
        ))}
      </div>

      {/* BASICS */}
      {tab === 'basics' && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}><span style={{ fontSize: 16 }}>⚙️</span><span style={{ fontSize: 14, fontWeight: 800 }}>Basics – Grundregeln für ALLE Models</span></div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 16 }}>Diese Regeln gelten bei jeder Nachricht und jedem Model. Einmal hier festlegen – das Modelspezifische kommt zusätzlich im Steckbrief obendrauf.</div>
          <textarea value={basics} onChange={e => setBasics(e.target.value)} placeholder="z.B. Klinge nie wie ein Bot oder KI. Keine Gedankenstriche (– oder —). Keine KI-Floskeln. Schreib locker, natürlich und persönlich." style={{ ...inp, minHeight: 150, resize: 'vertical', lineHeight: 1.6, marginBottom: 14 }} />
          <button onClick={saveBasics} disabled={basicsSaving} style={{ background: `linear-gradient(135deg,#8b5cf6,${ACC})`, color: '#fff', border: 'none', borderRadius: 9, padding: '10px 18px', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>{basicsSaving ? 'Speichere…' : 'Basics speichern'}</button>
        </div>
      )}

      {/* STECKBRIEFE */}
      {tab === 'steck' && form && (
        <div style={card}>
          {missing.length > 0 && (
            <div style={{ background: 'rgba(245,158,11,0.09)', border: '1px solid rgba(245,158,11,0.28)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12.5, color: '#fbbf24', fontWeight: 600 }}>
              ⚠ {missing.length} Model(s) ohne Steckbrief ({missing.join(', ')}) – bis dahin keine Vorschläge dafür.
            </div>
          )}
          <span style={lbl}>Model</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
            {models.map(m => (
              <button key={m} onClick={() => selectModel(m)} style={{
                display: 'flex', alignItems: 'center', gap: 6, border: `1px solid ${sel === m ? ACC : (personas[m] ? '#2e2e5a' : 'rgba(245,158,11,0.4)')}`,
                background: sel === m ? 'rgba(124,58,237,0.14)' : 'var(--bg-input)', color: sel === m ? ACC2 : 'var(--text-primary)',
                borderRadius: 9, padding: '7px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                borderStyle: personas[m] ? 'solid' : 'dashed',
              }}>{m}{!personas[m] && <span style={{ fontSize: 9, color: '#fbbf24', fontWeight: 800 }}>⚠ FEHLT</span>}</button>
            ))}
          </div>

          <span style={lbl}>Beschreibung (Freitext)</span>
          <textarea value={form.description} onChange={e => upd('description', e.target.value)} style={{ ...inp, minHeight: 58, resize: 'vertical', marginBottom: 18, lineHeight: 1.5 }} />

          <span style={lbl}>Extra-Anweisungen an die KI (Freitext, wird 1:1 befolgt)</span>
          <textarea value={form.extra || ''} onChange={e => upd('extra', e.target.value)} placeholder="z.B. klingt nie wie ein Bot · keine Gedankenstriche – · locker & natürlich schreiben · ruhig mal umgangssprachlich" style={{ ...inp, minHeight: 54, resize: 'vertical', marginBottom: 18, lineHeight: 1.5 }} />

          <span style={lbl}>Persona</span>
          <div style={{ marginBottom: 18 }}>
            <Tags items={form.persona_tags} onAdd={t => upd('persona_tags', [...form.persona_tags, t])} onRemove={i => upd('persona_tags', form.persona_tags.filter((_, x) => x !== i))} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px', marginBottom: 18 }}>
            <div><span style={lbl}>Anrede</span><Seg options={['du', 'sie']} value={form.anrede} onChange={v => upd('anrede', v)} /></div>
            <div><span style={lbl}>Dialekt</span><input value={form.dialekt} onChange={e => upd('dialekt', e.target.value)} style={inp} placeholder="hochdeutsch / bairisch …" /></div>
            <div><span style={lbl}>Länge</span><Seg options={['kurz', 'mittel', 'lang']} value={form.laenge} onChange={v => upd('laenge', v)} /></div>
            <div><span style={lbl}>Emoji</span><Seg options={['wenig', 'mittel', 'viel']} value={form.emoji} onChange={v => upd('emoji', v)} /></div>
            <div><span style={lbl}>Direktheit</span><Seg options={['zahm', 'normal', 'direkt']} value={form.direktheit} onChange={v => upd('direktheit', v)} /></div>
            <div><span style={lbl}>Anzahl</span><Seg options={[5, 8, 10]} value={form.anzahl} onChange={v => upd('anzahl', v)} /></div>
          </div>

          <span style={lbl}>No-Gos / Grenzen</span>
          <div style={{ marginBottom: 18 }}>
            <Tags items={form.nogos} color="rgba(239,68,68,0.08)" onAdd={t => upd('nogos', [...form.nogos, t])} onRemove={i => upd('nogos', form.nogos.filter((_, x) => x !== i))} />
          </div>

          <span style={lbl}>Erlaubte Emojis (leer = alle erlaubt · sonst nutzt die KI nur diese)</span>
          <div style={{ marginBottom: 18 }}>
            <Tags items={form.emojis || []} onAdd={t => upd('emojis', [...(form.emojis || []), t])} onRemove={i => upd('emojis', (form.emojis || []).filter((_, x) => x !== i))} />
          </div>

          <span style={lbl}>Beispiel-Nachrichten (Ton-Vorlage)</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {form.examples.map((ex, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--bg-input)', border: '1px solid #1e1e3a', borderLeft: `3px solid ${ACC}`, borderRadius: 8, padding: '2px 6px 2px 12px' }}>
                <input value={ex} onChange={e => upd('examples', form.examples.map((x, j) => j === i ? e.target.value : x))} style={{ ...inp, border: 'none', background: 'transparent', padding: '8px 0' }} />
                <button onClick={() => upd('examples', form.examples.filter((_, j) => j !== i))} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 6 }}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
          <button onClick={() => upd('examples', [...form.examples, ''])} style={{ background: 'transparent', border: '1px solid #2e2e5a', color: 'var(--text-muted)', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 18 }}><Plus size={13} style={{ verticalAlign: -2 }} /> Beispiel</button>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button onClick={savePersona} disabled={saving} style={{ background: `linear-gradient(135deg,#8b5cf6,${ACC})`, color: '#fff', border: 'none', borderRadius: 9, padding: '10px 18px', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 7 }}><Save size={15} />{saving ? 'Speichere…' : 'Steckbrief speichern'}</button>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>Greift beim nächsten Knopfdruck der Chatter.</span>
          </div>
        </div>
      )}

      {/* ANLÄSSE */}
      {tab === 'occ' && (
        <div style={card}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {occasions.map(o => (
              <div key={o.id} style={{ display: 'flex', gap: 10, alignItems: 'center', background: 'var(--bg-input)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '10px 12px' }}>
                <input value={o.icon || ''} onChange={e => saveOccField(o.id, 'icon', e.target.value)} style={{ ...inp, width: 46, textAlign: 'center' }} />
                <input value={o.label} onChange={e => saveOccField(o.id, 'label', e.target.value)} style={{ ...inp, width: 160, fontWeight: 700 }} />
                <input value={o.guardrail || ''} onChange={e => saveOccField(o.id, 'guardrail', e.target.value)} placeholder="Leitplanke (was soll die KI beachten?)" style={{ ...inp, flex: 1 }} />
                <button onClick={() => delOcc(o.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 8 }}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          <button onClick={addOcc} style={{ marginTop: 14, background: 'transparent', border: '1px solid #2e2e5a', color: 'var(--text-muted)', borderRadius: 9, padding: '9px 15px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}><Plus size={14} style={{ verticalAlign: -2 }} /> Anlass hinzufügen</button>
        </div>
      )}

      {/* FREIGABE */}
      {tab === 'frei' && (
        <div style={card}>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 16 }}>Wer darf die Vorschläge nutzen? Standard: aus. Nur freigeschaltete Chatter sehen das Panel.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {chatters.map(u => (
              <div key={u.user_id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-input)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '10px 14px' }}>
                <span style={{ fontWeight: 700, fontSize: 13.5 }}>{u.display_name}</span>
                <button onClick={() => toggleSuggest(u)} style={{
                  marginLeft: 'auto', border: `1px solid ${u.can_suggest ? '#22c55e' : '#2e2e5a'}`,
                  background: u.can_suggest ? 'rgba(34,197,94,0.12)' : 'transparent', color: u.can_suggest ? '#22c55e' : 'var(--text-muted)',
                  borderRadius: 20, padding: '6px 16px', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
                }}>{u.can_suggest ? '● AN' : '○ AUS'}</button>
              </div>
            ))}
            {chatters.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Keine Chatter gefunden.</div>}
          </div>
        </div>
      )}

      {/* AUSWERTUNG */}
      {tab === 'stats' && (
        <div style={card}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
            <select value={statModel} onChange={e => setStatModel(e.target.value)} style={{ ...inp, width: 'auto', fontWeight: 600 }}><option value="alle">Alle Models</option>{models.map(m => <option key={m} value={m}>{m}</option>)}</select>
            <select value={statOcc} onChange={e => setStatOcc(e.target.value)} style={{ ...inp, width: 'auto', fontWeight: 600 }}><option value="alle">Alle Anlässe</option>{occasions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <span style={{ ...lbl, color: '#22c55e' }}>Läuft gut 👍</span>
              {lib.filter(r => (r.up || 0) > (r.down || 0)).slice(0, 12).map(r => (
                <div key={r.id} style={{ background: 'var(--bg-input)', borderRadius: 7, padding: '8px 11px', marginBottom: 7 }}>
                  <div style={{ fontSize: 9.5, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.3px' }}>{r.model_name} · {occMap[r.occasion] || r.occasion}</div>
                  <div style={{ fontSize: 12.5, display: 'flex', gap: 8 }}><span style={{ flex: 1 }}>{r.text}</span><b style={{ color: '#22c55e' }}>{r.up}×</b></div>
                </div>
              ))}
            </div>
            <div>
              <span style={{ ...lbl, color: '#ef4444' }}>Floppt 👎</span>
              {lib.filter(r => (r.down || 0) > 0).sort((a, b) => b.down - a.down).slice(0, 12).map(r => (
                <div key={r.id} style={{ background: 'var(--bg-input)', borderRadius: 7, padding: '8px 11px', marginBottom: 7 }}>
                  <div style={{ fontSize: 9.5, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.3px' }}>{r.model_name} · {occMap[r.occasion] || r.occasion}</div>
                  <div style={{ fontSize: 12.5, display: 'flex', gap: 8 }}><span style={{ flex: 1 }}>{r.text}</span><b style={{ color: '#ef4444' }}>{r.down}×</b></div>
                </div>
              ))}
            </div>
          </div>
          {lib.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 8 }}>Noch keine Bewertungen für diese Auswahl.</div>}
        </div>
      )}

      {/* HISTORY */}
      {tab === 'hist' && (
        <div style={card}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>Wer hat wann was geholt/bewertet. Löscht sich automatisch nach 7 Tagen.</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['Zeit', 'Chatter', 'Model', 'Schicht', 'Anlass', 'Nachricht', 'Bew.'].map(h => <th key={h} style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', padding: '8px 10px', borderBottom: '1px solid #1e1e3a' }}>{h}</th>)}</tr></thead>
              <tbody>
                {hist.map(r => (
                  <tr key={r.id}>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid #1e1e3a', whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid #1e1e3a', fontWeight: 700 }}>{r.chatter || '—'}</td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid #1e1e3a' }}>{r.model_name}</td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid #1e1e3a' }}>{r.shift || '—'}</td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid #1e1e3a' }}>{r.occasion}</td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid #1e1e3a', color: 'var(--text-muted)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.text}</td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid #1e1e3a' }}>{r.rating === 'up' ? '👍' : r.rating === 'down' ? '👎' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hist.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 8 }}>Noch keine Aktivität.</div>}
        </div>
      )}
    </div>
  )
}
