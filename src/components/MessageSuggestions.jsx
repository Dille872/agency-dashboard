import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { Lightbulb, Copy, Check, ThumbsUp, ThumbsDown, Sparkles, Loader } from 'lucide-react'

// v3.81.0: KI-Nachrichten-Vorschläge (Chatter-Portal).
// Chatter wählt aus SEINEN Schichten + Models + einem Anlass und bekommt auf
// Knopfdruck Vorschläge (Edge Function generate-messages). Kein Freitext an die KI.

function normShift(label = '') {
  const l = label.toLowerCase()
  if (l.startsWith('früh') || l.startsWith('frueh')) return 'frueh'
  if (l.startsWith('spät') || l.startsWith('spaet') || l.startsWith('spat')) return 'spaet'
  if (l.startsWith('nacht')) return 'nacht'
  return l
}

const card = { background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 12, padding: '16px 18px', marginBottom: 14 }
const lbl = { fontSize: 10, fontWeight: 700, letterSpacing: '.5px', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 7 }
const sel = { background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', borderRadius: 8, padding: '8px 11px', fontSize: 13, fontFamily: 'inherit', outline: 'none' }

export default function MessageSuggestions({ displayName }) {
  const [pairs, setPairs] = useState([])        // [{model, shift}]
  const [occasions, setOccasions] = useState([])
  const [shift, setShift] = useState('')
  const [model, setModel] = useState('')
  const [occasion, setOccasion] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [items, setItems] = useState([])        // [{id, text, rating}]
  const [copiedId, setCopiedId] = useState(null)
  const [allowed, setAllowed] = useState(null) // v3.83.0: nur freigeschaltete Chatter
  const [language, setLanguage] = useState('Deutsch') // v3.90.0: Zielsprache der Vorschläge
  const [usedList, setUsedList] = useState([]) // v3.92.0: zuletzt verwendete Nachrichten

  useEffect(() => { if (displayName) loadContext() }, [displayName])

  // v3.84.0: Beim Öffnen/Wechsel den zuletzt generierten Satz wieder laden
  // (bleibt über Reloads stehen, bis der Chatter neu generiert). Inkl. Bewertungen.
  useEffect(() => {
    if (!allowed || !model || !occasion) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.from('message_suggestions')
        .select('id, text, rating, used, created_at')
        .eq('chatter', displayName).eq('model_name', model).eq('occasion', occasion)
        .order('created_at', { ascending: false }).limit(20)
      if (cancelled) return
      if (data && data.length) {
        const latest = data[0].created_at // alle Zeilen eines Batches teilen denselben created_at
        setItems(data.filter(r => r.created_at === latest).map(r => ({ id: r.id, text: r.text, rating: r.rating, used: r.used })))
      } else {
        setItems([])
      }
    })()
    return () => { cancelled = true }
  }, [allowed, model, occasion, displayName])

  const loadContext = async () => {
    // v3.83.0: Freigabe prüfen — nur wer can_suggest=true hat, sieht das Panel
    const { data: me } = await supabase.from('user_roles').select('can_suggest').eq('display_name', displayName).maybeSingle()
    if (!me?.can_suggest) { setAllowed(false); return }
    setAllowed(true)

    // Anlässe
    const { data: occ } = await supabase.from('message_occasions')
      .select('*').eq('active', true).order('sort')
    setOccasions(occ || [])
    if (occ && occ.length) setOccasion(occ[0].key)

    // Meine Schichten + Models aus dem Dienstplan (nächste ~2 Wochen, live)
    const today = new Date()
    const starts = new Set()
    for (let i = -1; i < 14; i++) {
      const d = new Date(today); d.setDate(today.getDate() + i)
      const day = d.getDay(); const diff = day === 0 ? -6 : 1 - day
      const mon = new Date(d); mon.setDate(d.getDate() + diff)
      starts.add(mon.toISOString().slice(0, 10))
    }
    const { data: scheds } = await supabase.from('schedule')
      .select('assignments').in('week_start', [...starts]).eq('status', 'live')
    const { data: models } = await supabase.from('models_contact').select('name, id')
    const idToName = {}; for (const m of models || []) idToName[String(m.id)] = m.name

    const set = new Map()
    for (const s of scheds || []) {
      for (const [key, val] of Object.entries(s.assignments || {})) {
        if (val && val.chatter === displayName) {
          const parts = key.split('__')
          const modelName = idToName[parts[0]] || parts[0]
          const sh = parts[2] || ''
          set.set(`${sh}|${modelName}`, { shift: sh, model: modelName })
        }
      }
    }
    const list = [...set.values()]
    setPairs(list)
    const shifts = [...new Set(list.map(p => p.shift))]
    if (shifts.length) { setShift(shifts[0]); const first = list.find(p => p.shift === shifts[0]); if (first) setModel(first.model) }
  }

  const shifts = [...new Set(pairs.map(p => p.shift))]
  const modelsForShift = [...new Set(pairs.filter(p => p.shift === shift).map(p => p.model))]

  const onShift = (s) => { setShift(s); const m = pairs.find(p => p.shift === s); setModel(m ? m.model : '') }

  const generate = async () => {
    if (!model || !occasion) return
    setLoading(true); setError(''); setItems([])
    try {
      const { data, error } = await supabase.functions.invoke('generate-messages', {
        body: { model, occasion, shift: normShift(shift), chatter: displayName, language },
      })
      if (error) {
        let msg = error.message || 'Fehler beim Generieren'
        try { const j = await error.context.json(); if (j?.error) msg = j.error } catch (_) {}
        setError(msg); return
      }
      if (!data?.ok) { setError(data?.error || 'Keine Vorschläge erhalten'); return }
      setItems((data.suggestions || []).map(s => ({ ...s, rating: null })))
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const copy = (it) => {
    try { navigator.clipboard.writeText(it.text) } catch (_) {}
    setCopiedId(it.id); setTimeout(() => setCopiedId(null), 1200)
  }

  const rate = async (it, rating) => {
    const next = it.rating === rating ? null : rating
    setItems(prev => prev.map(x => x.id === it.id ? { ...x, rating: next } : x))
    if (next) await supabase.from('message_suggestions').update({ rating: next }).eq('id', it.id)
  }

  // v3.92.0: "Nehm ich" – als verwendet markieren (+ kopieren), landet in "Zuletzt verwendet"
  const loadUsed = async () => {
    const { data } = await supabase.from('message_suggestions')
      .select('id, text, rating, model_name, occasion')
      .eq('chatter', displayName).eq('used', true)
      .order('created_at', { ascending: false }).limit(10)
    setUsedList(data || [])
  }
  useEffect(() => { if (allowed && displayName) loadUsed() }, [allowed, displayName])

  const markUsed = async (it) => {
    setItems(prev => prev.map(x => x.id === it.id ? { ...x, used: true } : x))
    try { navigator.clipboard.writeText(it.text) } catch (_) {}
    setCopiedId(it.id); setTimeout(() => setCopiedId(null), 1200)
    await supabase.from('message_suggestions').update({ used: true }).eq('id', it.id)
    loadUsed()
  }

  const rateUsed = async (it, rating) => {
    const next = it.rating === rating ? null : rating
    setUsedList(prev => prev.map(x => x.id === it.id ? { ...x, rating: next } : x))
    if (next) await supabase.from('message_suggestions').update({ rating: next }).eq('id', it.id)
  }

  const btn = (active) => ({
    background: active ? 'rgba(124,58,237,0.18)' : 'transparent',
    color: active ? '#a78bfa' : 'var(--text-secondary)',
    border: `1px solid ${active ? '#7c3aed' : '#2e2e5a'}`,
    borderRadius: 20, padding: '6px 13px', fontSize: 12, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  })

  if (!allowed) return null

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Lightbulb size={17} color="#a78bfa" />
        <span style={{ fontSize: 14, fontWeight: 800 }}>Nachrichten-Vorschläge</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
        Schicht &amp; Model wählen, Anlass antippen, Knopf drücken.
      </div>

      {pairs.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          Für dich sind aktuell keine Schichten mit Models im Dienstplan hinterlegt.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
            <div>
              <span style={lbl}>Schicht</span>
              <select style={sel} value={shift} onChange={e => onShift(e.target.value)}>
                {shifts.map(s => <option key={s} value={s}>{s || '—'}</option>)}
              </select>
            </div>
            <div>
              <span style={lbl}>Model</span>
              <select style={sel} value={model} onChange={e => setModel(e.target.value)}>
                {modelsForShift.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <span style={lbl}>Sprache</span>
              <select style={sel} value={language} onChange={e => setLanguage(e.target.value)}>
                {['Deutsch', 'Englisch', 'Französisch', 'Spanisch', 'Italienisch', 'Ungarisch', 'Tschechisch', 'Polnisch', 'Dänisch', 'Schwedisch', 'Norwegisch'].map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>

          <span style={lbl}>Anlass</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {occasions.map(o => (
              <button key={o.key} style={btn(occasion === o.key)} onClick={() => setOccasion(o.key)}>
                {o.icon} {o.label}
              </button>
            ))}
          </div>

          <button onClick={generate} disabled={loading || !model || !occasion}
            style={{
              background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)', color: '#fff', border: 'none',
              borderRadius: 9, padding: '10px 18px', fontSize: 13, fontWeight: 800,
              cursor: loading ? 'wait' : 'pointer', fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', gap: 8, opacity: (!model || !occasion) ? .6 : 1,
            }}>
            {loading ? <Loader size={15} className="spin" /> : <Sparkles size={15} />}
            {loading ? 'Generiere…' : 'Vorschläge holen'}
          </button>

          {error && <div style={{ marginTop: 12, fontSize: 12.5, color: '#f87171' }}>⚠ {error}</div>}

          {items.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10, marginTop: 16 }}>
              {items.map(it => (
                <div key={it.id} style={{ background: 'var(--bg-input)', border: '1px solid #1e1e3a', borderRadius: 10, padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-primary)' }}>{it.text}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button onClick={() => copy(it)} style={{ ...btn(false), borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <Copy size={12} /> {copiedId === it.id ? 'Kopiert!' : 'Kopieren'}
                    </button>
                    <button onClick={() => markUsed(it)} title="Diese nehm ich – wird gespeichert"
                      style={{ ...btn(!!it.used), borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 5, color: it.used ? '#22c55e' : 'var(--text-secondary)', borderColor: it.used ? '#22c55e' : '#2e2e5a' }}>
                      <Check size={12} /> {it.used ? 'Genommen' : 'Nehm ich'}
                    </button>
                    <button onClick={() => rate(it, 'up')} title="Gut"
                      style={{ ...btn(it.rating === 'up'), borderRadius: 8, marginLeft: 'auto', padding: '6px 9px', color: it.rating === 'up' ? '#22c55e' : 'var(--text-secondary)', borderColor: it.rating === 'up' ? '#22c55e' : '#2e2e5a' }}>
                      <ThumbsUp size={13} />
                    </button>
                    <button onClick={() => rate(it, 'down')} title="Passt nicht"
                      style={{ ...btn(it.rating === 'down'), borderRadius: 8, padding: '6px 9px', color: it.rating === 'down' ? '#ef4444' : 'var(--text-secondary)', borderColor: it.rating === 'down' ? '#ef4444' : '#2e2e5a' }}>
                      <ThumbsDown size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {usedList.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <span style={{ ...lbl, marginBottom: 10 }}>✓ Zuletzt verwendet — gern später noch bewerten</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {usedList.map(it => (
                  <div key={it.id} style={{ background: 'var(--bg-input)', border: '1px solid #1e1e3a', borderRadius: 9, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                      <span style={{ fontSize: 9.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.3px', marginRight: 6 }}>{it.model_name}</span>{it.text}
                    </div>
                    <button onClick={() => rateUsed(it, 'up')} title="Gut" style={{ ...btn(it.rating === 'up'), borderRadius: 8, padding: '5px 8px', color: it.rating === 'up' ? '#22c55e' : 'var(--text-secondary)', borderColor: it.rating === 'up' ? '#22c55e' : '#2e2e5a' }}><ThumbsUp size={12} /></button>
                    <button onClick={() => rateUsed(it, 'down')} title="Passt nicht" style={{ ...btn(it.rating === 'down'), borderRadius: 8, padding: '5px 8px', color: it.rating === 'down' ? '#ef4444' : 'var(--text-secondary)', borderColor: it.rating === 'down' ? '#ef4444' : '#2e2e5a' }}><ThumbsDown size={12} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
