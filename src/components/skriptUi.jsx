import React, { useEffect, useRef, useState } from 'react'
import { schritteSauber } from '../ofSkripte'

// ── Gemeinsame Bausteine für Skripte & Bibliothek (v5.30.0, vorher in SkripteBereich.jsx) ──

export const P = '#ec4899', LILA = '#a855f7', C = '#06b6d4', G = '#10b981', AMB = '#f59e0b', ROT = '#ef4444'
export const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 15px' }
export const eingabe = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '9px 11px', borderRadius: 10, fontSize: 13.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', width: '100%' }
export const label = { display: 'block', fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 5 }
export const knopf = (farbe, voll = true) => ({ padding: '9px 14px', borderRadius: 10, border: voll ? 'none' : '1px solid var(--border)', background: voll ? farbe : 'transparent', color: voll ? (farbe === C ? '#04212a' : '#fff') : 'var(--text-secondary)', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' })
export const pill = (f) => ({ fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 20, background: f + '22', color: f, whiteSpace: 'nowrap' })
export const datumKurz = (iso) => iso ? new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) : ''
export const vorZeit = (iso) => {
  if (!iso) return ''
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 60) return `vor ${Math.max(1, min)} Min.`
  if (min < 60 * 24) return `vor ${Math.round(min / 60)} Std.`
  return datumKurz(iso)
}

// ── Schritte bearbeiten ────────────────────────────────────────────────────
// v5.32.0: Schritt-Felder wachsen mit (lange Schritte, z. B. aus dem PDF-Import)
const hoehe = (el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }

export function SchritteEditor({ schritte, onChange }) {
  const refs = useRef([])
  const [fokus, setFokus] = useState(null)
  useEffect(() => { if (fokus !== null) { refs.current[fokus]?.focus(); setFokus(null) } }, [fokus])
  const setze = (i, patch) => onChange(schritte.map((s, j) => j === i ? { ...s, ...patch } : s))
  const neuNach = (i) => { const n = [...schritte]; n.splice(i + 1, 0, { text: '' }); onChange(n); setFokus(i + 1) }
  const weg = (i) => { const n = schritte.filter((_, j) => j !== i); onChange(n.length ? n : [{ text: '' }]); setFokus(Math.max(0, i - 1)) }
  const schieben = (i, d) => { const j = i + d; if (j < 0 || j >= schritte.length) return; const n = [...schritte]; [n[i], n[j]] = [n[j], n[i]]; onChange(n) }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {schritte.map((s, i) => (
        <div key={i} className="sk-schritt" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 11, padding: '7px 8px' }}>
          <span style={{ flex: '0 0 auto', width: 24, height: 24, borderRadius: 12, background: P + '26', color: P, fontWeight: 800, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 6 }}>{i + 1}</span>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <textarea rows={1} ref={el => { refs.current[i] = el; hoehe(el) }} value={s.text} placeholder={i === 0 ? 'Erster Schritt, z. B. „Kommt zur Tür rein, Blick in die Kamera“' : 'Nächster Schritt … (Enter = noch einer)'}
              onChange={e => { hoehe(e.target); setze(i, { text: e.target.value.slice(0, 500) }) }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (String(s.text).trim()) neuNach(i) }
                if (e.key === 'Backspace' && !s.text && schritte.length > 1) { e.preventDefault(); weg(i) }
              }}
              style={{ ...eingabe, background: 'transparent', border: 'none', padding: '5px 4px', resize: 'none', overflow: 'hidden', lineHeight: 1.45, display: 'block' }} />
            {s.tipp !== undefined && (
              <input value={s.tipp} placeholder="💡 Tipp, z. B. „Kamera auf Hüfthöhe“" onChange={e => setze(i, { tipp: e.target.value.slice(0, 300) })}
                style={{ ...eingabe, background: 'transparent', border: 'none', borderTop: '1px dashed var(--border)', borderRadius: 0, padding: '5px 4px', fontSize: 12.5, color: 'var(--text-secondary)' }} />
            )}
          </div>
          <div className="sk-mini" style={{ display: 'flex', gap: 2, alignItems: 'center', marginTop: 3 }}>
            <button type="button" title="Tipp" onClick={() => setze(i, { tipp: s.tipp === undefined ? '' : undefined })} style={{ opacity: s.tipp !== undefined ? 1 : 0.55 }}>💡</button>
            <button type="button" title="nach oben" disabled={i === 0} onClick={() => schieben(i, -1)}>↑</button>
            <button type="button" title="nach unten" disabled={i === schritte.length - 1} onClick={() => schieben(i, 1)}>↓</button>
            <button type="button" title="Schritt löschen" onClick={() => weg(i)}>✕</button>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => neuNach(schritte.length - 1)}
        style={{ alignSelf: 'flex-start', padding: '7px 13px', borderRadius: 10, border: `1px dashed ${P}`, background: 'transparent', color: P, fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>+ Schritt</button>
    </div>
  )
}

// Schritte nur anzeigen (Admin-Vorschau, Builder)
export function SchritteAnzeige({ schritte, erledigt = [] }) {
  const liste = schritteSauber(schritte)
  if (!liste.length) return <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Keine Schritte.</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {liste.map((s, i) => {
        const fertig = erledigt.includes(i)
        return (
          <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 11, padding: '8px 10px', opacity: fertig ? 0.6 : 1 }}>
            <span style={{ flex: '0 0 auto', width: 22, height: 22, borderRadius: 11, background: fertig ? G : P + '26', color: fertig ? '#fff' : P, fontWeight: 800, fontSize: 11.5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{fertig ? '✓' : i + 1}</span>
            <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.45 }}>
              {s.text}
              {s.tipp && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>💡 {s.tipp}</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

