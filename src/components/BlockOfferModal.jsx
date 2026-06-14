import React, { useState } from 'react'
import { supabase } from '../supabase'

/**
 * BlockOfferModal v3.27.0
 * Schicht ausschreiben — einzeln oder als Block (mehrere Models zusammen).
 * - Zielgruppe: "alle" oder "frei" (nur Chatter, die zu der Zeit NICHT eingeteilt sind)
 * - 1 Model  -> normales Angebot (block_id = null)
 * - >1 Model -> Block: alle Zeilen teilen sich eine block_id; ein Chatter übernimmt den ganzen Block
 *
 * Props:
 *   preset:  { dayIso, shift, presetModelId } | null
 *   models:  [{ id, name }]
 *   shifts:  string[]   z.B. ['Früh','Spät','Nacht']
 *   onClose: () => void
 *   onDone:  () => void
 */
export default function BlockOfferModal({ preset, models = [], shifts = [], onClose, onDone }) {
  const [dayIso, setDayIso] = useState(preset?.dayIso || new Date().toISOString().slice(0, 10))
  const [shift, setShift] = useState(preset?.shift || shifts[0] || '')
  const [selectedIds, setSelectedIds] = useState(() => {
    const s = new Set()
    if (preset?.presetModelId != null) s.add(preset.presetModelId)
    return s
  })
  const [target, setTarget] = useState('alle') // 'alle' | 'frei'
  const [label, setLabel] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const toggleModel = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectedNames = models.filter(m => selectedIds.has(m.id)).map(m => m.name)
  const isBlock = selectedNames.length > 1

  const submit = async () => {
    setErr('')
    if (!dayIso || !shift) { setErr('Datum und Schicht wählen.'); return }
    if (selectedNames.length === 0) { setErr('Mindestens ein Model auswählen.'); return }
    setSaving(true)

    // Schon ausgeschriebene (offen/vorgeschlagen) Models für diese Schicht herausfiltern
    const { data: existing } = await supabase
      .from('shift_swaps')
      .select('model_name')
      .eq('shift_date', dayIso)
      .eq('shift', shift)
      .in('status', ['offen', 'vorgeschlagen'])
      .in('model_name', selectedNames)
    const alreadyOpen = new Set((existing || []).map(e => e.model_name))
    const names = selectedNames.filter(n => !alreadyOpen.has(n))

    if (names.length === 0) {
      setSaving(false)
      setErr('Alle gewählten Models sind für diese Schicht bereits ausgeschrieben.')
      return
    }

    const blockId = names.length > 1 ? crypto.randomUUID() : null
    const blockLabel = names.length > 1 ? (label.trim() || `${shift}-Block`) : null

    const rows = names.map(name => ({
      requester_name: null, // = Admin-Angebot
      shift_date: dayIso,
      shift,
      model_name: name,
      reason: reason.trim() || null,
      status: 'offen',
      target,                // 'alle' | 'frei'
      block_id: blockId,
      block_label: blockLabel,
    }))

    const { error } = await supabase.from('shift_swaps').insert(rows)
    setSaving(false)
    if (error) { setErr('Fehler: ' + error.message); return }

    const skipped = selectedNames.length - names.length
    onDone && onDone()
    alert(
      `✓ ${names.length > 1 ? `Block (${names.length} Models)` : 'Schicht'} ausgeschrieben`
      + ` an ${target === 'frei' ? 'nur freie Chatter' : 'alle'}.`
      + (skipped > 0 ? `\n(${skipped} bereits ausgeschrieben — übersprungen.)` : '')
    )
  }

  const fmtDay = (iso) => {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
  }

  const inputStyle = {
    background: 'var(--bg-input)', border: '1px solid var(--border-bright)',
    color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 7,
    fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
        padding: 20, maxWidth: 460, width: '100%', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
            🔄 Schicht ausschreiben
          </span>
          {isBlock && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: 'rgba(124,58,237,0.18)', color: '#a78bfa' }}>
              📦 BLOCK · {selectedNames.length} Models
            </span>
          )}
        </div>

        {/* Datum + Schicht */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Datum</label>
            <input type="date" value={dayIso} onChange={e => setDayIso(e.target.value)} style={inputStyle} />
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{fmtDay(dayIso)}</div>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Schicht</label>
            <select value={shift} onChange={e => setShift(e.target.value)} style={inputStyle}>
              {shifts.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Models */}
        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
          Models (mehrere = Block, der zusammen übernommen wird)
        </label>
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12,
          maxHeight: 150, overflowY: 'auto', padding: 2,
        }}>
          {models.map(m => {
            const on = selectedIds.has(m.id)
            return (
              <button key={m.id} onClick={() => toggleModel(m.id)} style={{
                padding: '5px 10px', borderRadius: 14, fontSize: 12, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
                background: on ? 'rgba(124,58,237,0.2)' : 'var(--bg-card2)',
                color: on ? '#a78bfa' : 'var(--text-secondary)',
                border: `1px solid ${on ? 'rgba(124,58,237,0.5)' : 'var(--border)'}`,
              }}>
                {on ? '✓ ' : ''}{m.name}
              </button>
            )
          })}
        </div>

        {isBlock && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Block-Bezeichnung (optional)</label>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder={`${shift}-Block`} style={inputStyle} />
          </div>
        )}

        {/* Zielgruppe */}
        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Wer sieht das Angebot?</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {[
            { v: 'alle', t: '👥 Alle Chatter' },
            { v: 'frei', t: '🟢 Nur Freie (nicht in dieser Schicht eingeteilt)' },
          ].map(opt => (
            <button key={opt.v} onClick={() => setTarget(opt.v)} style={{
              flex: 1, padding: '8px 6px', borderRadius: 7, fontSize: 11, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.3,
              background: target === opt.v ? 'rgba(16,185,129,0.15)' : 'var(--bg-card2)',
              color: target === opt.v ? '#10b981' : 'var(--text-secondary)',
              border: `1px solid ${target === opt.v ? 'rgba(16,185,129,0.4)' : 'var(--border)'}`,
            }}>{opt.t}</button>
          ))}
        </div>

        {/* Grund */}
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Grund (optional, für Chatter sichtbar)" style={{ ...inputStyle, marginBottom: 12 }} />

        {err && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 10 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} disabled={saving} style={{
            flex: 1, padding: '10px', borderRadius: 8, background: 'transparent',
            border: '1px solid var(--border)', color: 'var(--text-muted)',
            fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>Abbrechen</button>
          <button onClick={submit} disabled={saving || selectedNames.length === 0} style={{
            flex: 2, padding: '10px', borderRadius: 8,
            background: selectedNames.length ? 'rgba(245,158,11,0.18)' : 'var(--border)',
            color: selectedNames.length ? '#f59e0b' : 'var(--text-muted)',
            border: `1px solid ${selectedNames.length ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`,
            fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
          }}>
            {saving ? '...' : isBlock ? `📦 Block ausschreiben (${selectedNames.length})` : '🔄 Ausschreiben'}
          </button>
        </div>
      </div>
    </div>
  )
}
