import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { notifyAdmins } from '../telegram'
import { schritteSauber, alsHochgeladen, artText } from '../ofSkripte'

// ── Skripte für das Model (v5.27.0) ────────────────────────────────────────
// Auf der Startseite des Model-Portals, über „Meine Aufgaben“. Zeigt die
// freigeschalteten Skripte als Schritte zum Abhaken. Am Ende tippt sie
// „Gedreht & auf OF hochgeladen“ → der Script Builder bekommt Bescheid.
// Abhaken ist nur eine Hilfe für sie selbst.

const P = '#ec4899', G = '#10b981', AMB = '#f59e0b'
const datum = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) : ''

function Karte({ s, isPreview, onNeu, auf, onKlapp }) {
  const schritte = schritteSauber(s.schritte)
  const [erledigt, setErledigt] = useState(s.schritte_erledigt || [])
  const [ofTitel, setOfTitel] = useState(s.of_titel || '')
  const [arbeitet, setArbeitet] = useState(false)
  const [fehler, setFehler] = useState('')
  const anzahl = schritte.filter((_, i) => erledigt.includes(i)).length
  const ueberfaellig = s.faellig && s.faellig < new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })

  const haken = async (i) => {
    if (isPreview) return
    const neu = erledigt.includes(i) ? erledigt.filter(x => x !== i) : [...erledigt, i].sort((a, b) => a - b)
    setErledigt(neu)
    const { error } = await supabase.from('of_skripte').update({ schritte_erledigt: neu }).eq('id', s.id)
    if (error) { setErledigt(erledigt); setFehler(error.message) }
  }
  const frage = async () => {
    if (isPreview) return
    const t = window.prompt('Deine Frage zum Skript (geht ans Team):', s.model_frage || '')
    if (t === null || !t.trim()) return
    const { error } = await supabase.from('of_skripte').update({ model_frage: t.trim().slice(0, 500) }).eq('id', s.id)
    if (error) { setFehler(error.message); return }
    try { await notifyAdmins(`❓ <b>${s.model_name}</b> hat eine Frage zum Skript „${s.titel}“:\n\n${t.trim()}`) } catch { /* nur Hinweis */ }
    onNeu()
  }
  const fertig = async () => {
    if (isPreview) return
    if (!window.confirm('Hast du das Video gedreht und auf OnlyFans hochgeladen?')) return
    setArbeitet(true); setFehler('')
    const r = await alsHochgeladen(s, ofTitel)
    setArbeitet(false)
    if (r.error) { setFehler(r.error.message); return }
    onNeu()
  }

  return (
    <div style={{ border: `1px solid ${P}66`, background: `linear-gradient(135deg, ${P}14, var(--bg-card) 70%)`, borderRadius: 14, padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div onClick={onKlapp} style={{ display: 'flex', gap: 9, alignItems: 'center', cursor: 'pointer' }}>
        <span style={{ fontSize: 20 }}>✍️</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--text-primary)' }}>{s.titel}</div>
          <div style={{ fontSize: 12, color: ueberfaellig ? '#ef4444' : 'var(--text-muted)' }}>
            {artText(s.art)}{s.laenge ? ` · ${s.laenge}` : ''}{s.faellig ? ` · bis ${datum(s.faellig)}` : ''} · {anzahl}/{schritte.length} Schritte
          </div>
        </div>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{auf ? '▴' : '▾'}</span>
      </div>
      {auf && <>
        {schritte.length > 0 && (
          <div style={{ height: 6, borderRadius: 4, background: 'var(--bg-card2)', overflow: 'hidden' }}>
            <i style={{ display: 'block', height: '100%', width: `${Math.round(anzahl / schritte.length * 100)}%`, background: G, transition: 'width .2s' }} />
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {schritte.map((x, i) => {
            const ok = erledigt.includes(i)
            return (
              <div key={i} onClick={() => haken(i)} style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '10px 11px', borderRadius: 12, background: 'var(--bg-card2)', border: '1px solid var(--border)', opacity: ok ? 0.55 : 1, cursor: isPreview ? 'default' : 'pointer' }}>
                <span style={{ flex: '0 0 auto', width: 28, height: 28, borderRadius: 14, background: ok ? G : P, color: '#fff', fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{ok ? '✓' : i + 1}</span>
                <span style={{ flex: 1, fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.45, textDecoration: ok ? 'line-through' : 'none' }}>
                  {x.text}
                  {x.tipp && <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 2, textDecoration: 'none' }}>💡 {x.tipp}</span>}
                </span>
              </div>
            )
          })}
        </div>
        {s.outfit && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>👗 {s.outfit}</div>}
        {s.model_frage && <div style={{ fontSize: 12.5, color: AMB }}>❓ Deine Frage: {s.model_frage}</div>}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Titel auf OF (optional, hilft Noa)
          <input value={ofTitel} onChange={e => setOfTitel(e.target.value.slice(0, 200))} placeholder="z. B. „Sunday morning 🤍“" disabled={isPreview}
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '9px 11px', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', outline: 'none', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }} />
        </label>
        {fehler && <div style={{ fontSize: 12.5, color: '#ef4444' }}>{fehler}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" onClick={frage} disabled={isPreview} style={{ padding: '10px 14px', borderRadius: 11, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Frage stellen</button>
          <button type="button" onClick={fertig} disabled={isPreview || arbeitet} style={{ padding: '10px 16px', borderRadius: 11, border: 'none', background: G, color: '#fff', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>{arbeitet ? '…' : '✅ Gedreht & auf OF hochgeladen'}</button>
        </div>
      </>}
    </div>
  )
}

export default function ModelSkripte({ displayName, isPreview = false }) {
  const [liste, setListe] = useState([])
  const [offenId, setOffenId] = useState(null)
  const laden = useCallback(async () => {
    if (!displayName) return
    const { data, error } = await supabase.from('of_skripte').select('*').eq('model_name', displayName).eq('status', 'beim_model').order('faellig', { ascending: true, nullsFirst: false })
    setListe(error ? [] : (data || []))
  }, [displayName])
  useEffect(() => { laden() }, [laden])
  if (!liste.length) return null
  const aktiv = offenId === null ? liste[0].id : offenId
  return (
    <div data-help="skripte" style={{ background: 'var(--bg-card)', border: `1px solid ${P}55`, borderRadius: 16, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>✍️ Skripte für dich</span>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 10, background: P, color: '#fff' }}>{liste.length}</span>
      </div>
      {liste.map(s => <Karte key={s.id + ':' + s.aktualisiert_am} s={s} isPreview={isPreview} onNeu={laden}
        auf={aktiv === s.id} onKlapp={() => setOffenId(aktiv === s.id ? -1 : s.id)} />)}
    </div>
  )
}
