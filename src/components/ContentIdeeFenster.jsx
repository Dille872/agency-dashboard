import React from 'react'

// ── Chatter-Portal: neue Content-Idee als Fenster von unten (v4.82.0) ───────
// Gleiche Felder und gleiche Speicherung wie vorher (submitContentIdea im
// ChatterPortal → content_ideas). Nur die Eingabe ist neu: eigene Models als
// Chips, Kategorie als Kacheln, Priorität als Chips.

const LILA = '#a78bfa'
const KATEGORIEN = [['bilder', '📸', 'Bilder'], ['videos', '🎬', 'Videos'], ['audio', '🎙', 'Audio'], ['sonstiges', '💭', 'Sonstiges']]
const PRIO = [['urgent', '🔥 Dringend', '#ef4444'], ['normal', '📅 Normal', '#f59e0b'], ['nice', '💭 Wenn Zeit', '#06b6d4']]
const lbl = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 7, display: 'block' }
const feld = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '11px 12px', borderRadius: 12, fontSize: 14, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }
const chipSt = (an, farbe = LILA) => ({
  fontSize: 13, padding: '8px 13px', borderRadius: 20, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  background: an ? farbe + '2a' : 'transparent', border: `1px solid ${an ? farbe : 'var(--border)'}`, color: an ? farbe : 'var(--text-secondary)',
})

export default function ContentIdeeFenster({ model, setModel, kategorie, setKategorie, text, setText, prio, setPrio, meineModels = [], alleModels = [], sending, onSenden, onZu }) {
  const andere = alleModels.filter(n => !meineModels.includes(n))
  const ok = !!model && !!text.trim() && !sending
  return (
    <div className="steckbrief-huelle" onClick={() => { if (!sending) onZu() }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div className="steckbrief-fenster" onClick={e => e.stopPropagation()} role="dialog" aria-label="Neue Content-Idee" style={{
        width: 'min(520px, 100%)', maxHeight: 'min(92vh, 860px)', boxSizing: 'border-box', background: 'var(--bg-card)',
        border: '1px solid var(--border)', borderRadius: '22px 22px 0 0', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '14px 18px 10px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button type="button" onClick={() => { if (!sending) onZu() }} aria-label="Schließen" style={{ width: 36, height: 36, borderRadius: 11, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 17, cursor: 'pointer', flexShrink: 0 }}>×</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Geht ans Team, das leitet sie ans Model weiter</div>
            <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--text-primary)' }}>💡 Neue Content-Idee</div>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 18px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <span style={lbl}>Für welches Model?</span>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {meineModels.map(n => <button key={n} type="button" className="chip-btn" onClick={() => setModel(n)} style={chipSt(model === n)}>{n}</button>)}
              {andere.length > 0 && (
                <select value={andere.includes(model) ? model : ''} onChange={e => setModel(e.target.value)} style={{ ...feld, width: 'auto', padding: '8px 11px', fontSize: 13, borderRadius: 20, color: andere.includes(model) ? LILA : 'var(--text-muted)' }}>
                  <option value="">{meineModels.length ? 'Anderes Model …' : 'Model wählen …'}</option>
                  {andere.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              )}
            </div>
          </div>
          <div>
            <span style={lbl}>Was für Content?</span>
            <div className="raster-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {KATEGORIEN.map(([k, i, l]) => {
                const an = kategorie === k
                return (
                  <button key={k} type="button" className="chip-btn" onClick={() => setKategorie(k)} style={{
                    display: 'flex', alignItems: 'center', gap: 9, padding: '12px', borderRadius: 13, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
                    background: an ? 'rgba(167,139,250,0.16)' : 'var(--bg-card2)', border: `1px solid ${an ? LILA : 'var(--border)'}`, color: an ? 'var(--ton-lila2)' : 'var(--text-secondary)',
                  }}><span style={{ fontSize: 19 }}>{i}</span>{l}</button>
                )
              })}
            </div>
          </div>
          <div>
            <span style={lbl}>Was fehlt / Idee</span>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={4}
              placeholder="z.B. Brauchen neue Bikini-Bilder für Promo · Fans fragen oft nach Heels · Talking-Video zum Kennenlernen"
              style={{ ...feld, resize: 'vertical', lineHeight: 1.45 }} />
          </div>
          <div>
            <span style={lbl}>Wie dringend?</span>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {PRIO.map(([k, l, c]) => <button key={k} type="button" className="chip-btn" onClick={() => setPrio(k)} style={chipSt(prio === k, c)}>{l}</button>)}
            </div>
          </div>
        </div>
        <div style={{ padding: '10px 18px 18px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button type="button" className="gross-btn" disabled={!ok} onClick={onSenden} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 14, padding: 14, fontSize: 15, fontWeight: 800, cursor: ok ? 'pointer' : 'default', fontFamily: 'inherit', opacity: ok ? 1 : 0.45, width: '100%' }}>
            {sending ? 'Speichere …' : !model ? 'Erst Model wählen' : !text.trim() ? 'Idee beschreiben' : '💡 Idee einreichen'}
          </button>
        </div>
      </div>
    </div>
  )
}
