import React, { useState } from 'react'

// ── Pinnwand: neue Ankündigung als Fenster von unten (v4.84.0) ─────────────
// Gleiche Felder, gleiche Speicherung (postAnnouncement im CommTab). Neu:
// Ablauf als Chips statt Datumsfeld („Kein Ablauf“, „Heute Abend“, „24 Std“ …),
// eigenes Datum nur noch auf Wunsch.

const EMOJIS = ['📌', '📢', '🚨', '🎯', '⚡', '🎬', '⚽', '🎉', '📋']
const lbl = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 7, display: 'block' }
const feld = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '11px 12px', borderRadius: 12, fontSize: 14, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }
const chipSt = (an, farbe = '#7c3aed') => ({
  fontSize: 13, padding: '8px 13px', borderRadius: 20, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  background: an ? farbe + '2a' : 'transparent', border: `1px solid ${an ? farbe : 'var(--border)'}`, color: an ? farbe : 'var(--text-secondary)',
})
// datetime-local-Wert in Ortszeit ('YYYY-MM-DDTHH:mm')
const lokal = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const ABLAUF = [
  ['kein', 'Kein Ablauf', () => ''],
  ['abend', 'Heute Abend', () => { const d = new Date(); d.setHours(23, 59, 0, 0); return lokal(d) }],
  ['24h', '24 Std', () => lokal(new Date(Date.now() + 24 * 3600e3))],
  ['3t', '3 Tage', () => lokal(new Date(Date.now() + 3 * 24 * 3600e3))],
  ['1w', '1 Woche', () => lokal(new Date(Date.now() + 7 * 24 * 3600e3))],
]

export default function AnkuendigungFenster({ emoji, setEmoji, text, setText, ablauf, setAblauf, fuer, onPosten, onZu }) {
  const [ablaufArt, setAblaufArt] = useState(ablauf ? 'eigen' : 'kein')
  const ok = !!text.trim()
  return (
    <div className="steckbrief-huelle" onClick={onZu} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div className="steckbrief-fenster" onClick={e => e.stopPropagation()} role="dialog" aria-label="Neue Ankündigung" style={{
        width: 'min(520px, 100%)', maxHeight: 'min(92vh, 820px)', boxSizing: 'border-box', background: 'var(--bg-card)',
        border: '1px solid var(--border)', borderRadius: '22px 22px 0 0', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '14px 18px 10px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Pinnwand · {fuer || 'für alle Chatter'}, oben im Chatter-Portal</div>
            <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--text-primary)' }}>Neue Ankündigung</div>
          </div>
          <button type="button" onClick={onZu} aria-label="Schließen" style={{ width: 36, height: 36, borderRadius: 11, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 17, cursor: 'pointer', flexShrink: 0 }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 18px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <span style={lbl}>Was gibt's?</span>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={4} autoFocus
              placeholder="z. B. Heute 20:30 Zoom-Call · Neue PPV-Preise ab Montag"
              style={{ ...feld, resize: 'vertical', lineHeight: 1.45 }} />
          </div>
          <div>
            <span style={lbl}>Symbol</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {EMOJIS.map(e => (
                <button key={e} type="button" className="chip-btn" onClick={() => setEmoji(e)} aria-label={`Symbol ${e}`}
                  style={{ ...chipSt(emoji === e), fontSize: 17, padding: '6px 10px' }}>{e}</button>
              ))}
            </div>
          </div>
          <div>
            <span style={lbl}>Wie lange oben?</span>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {ABLAUF.map(([k, t, fn]) => (
                <button key={k} type="button" className="chip-btn" onClick={() => { setAblaufArt(k); setAblauf(fn()) }} style={chipSt(ablaufArt === k, '#06b6d4')}>{t}</button>
              ))}
              <button type="button" className="chip-btn" onClick={() => setAblaufArt('eigen')} style={chipSt(ablaufArt === 'eigen', '#06b6d4')}>Datum …</button>
            </div>
            {ablaufArt === 'eigen' && (
              <input type="datetime-local" value={ablauf} onChange={e => setAblauf(e.target.value)} style={{ ...feld, marginTop: 8, fontFamily: 'monospace' }} />
            )}
            {ablauf && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>Läuft ab: {new Date(ablauf).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} — danach verschwindet sie von oben, bleibt aber im Verlauf.</div>}
          </div>
          {ok && (
            <div>
              <span style={lbl}>So sieht es aus</span>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 13px', borderRadius: 13, background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.4)' }}>
                <span style={{ fontSize: 18 }}>{emoji || '📌'}</span>
                <span style={{ fontSize: 13.5, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text}</span>
              </div>
            </div>
          )}
        </div>
        <div style={{ padding: '10px 18px 18px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button type="button" className="gross-btn" disabled={!ok} onClick={onPosten} style={{ width: '100%', padding: 14, borderRadius: 14, border: 'none', background: '#7c3aed', color: '#fff', fontSize: 15, fontWeight: 800, cursor: ok ? 'pointer' : 'default', opacity: ok ? 1 : 0.45, fontFamily: 'inherit' }}>
            {ok ? '📌 Posten' : 'Erst Text schreiben'}
          </button>
        </div>
      </div>
    </div>
  )
}
