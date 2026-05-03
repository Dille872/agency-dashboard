import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'

/**
 * SwapModal v2 - 3 Reaktionen pro offene Schicht.
 * - "Übernehmen" / "Vielleicht" / "Ablehnen"
 * - Schicht bleibt status='offen' egal welche Reaktion → Admin entscheidet
 * - Sobald Chatter reagiert hat, taucht die Schicht für ihn nicht mehr im Popup auf
 * - Bei status != 'offen' (vergeben) sieht ohnehin niemand mehr was
 */
export default function SwapModal({ displayName }) {
  const [offers, setOffers] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!displayName) { setLoading(false); return }
    load()
  }, [displayName])

  const load = async () => {
    setLoading(true)
    const today = new Date().toISOString().slice(0, 10)
    const { data: swaps } = await supabase
      .from('shift_swaps')
      .select('*')
      .eq('status', 'offen')
      .gte('shift_date', today)
      .order('shift_date', { ascending: true })

    if (!swaps || swaps.length === 0) {
      setOffers([]); setLoading(false); return
    }

    const ids = swaps.map(s => s.id)
    const { data: myReactions } = await supabase
      .from('swap_reactions')
      .select('swap_id')
      .in('swap_id', ids)
      .eq('chatter_name', displayName)
    const reactedSet = new Set((myReactions || []).map(r => r.swap_id))

    // Filtern: eigene Anfrage raus + bereits reagiert raus
    const filtered = swaps.filter(s =>
      s.requester_name !== displayName &&
      !reactedSet.has(s.id)
    )
    setOffers(filtered)
    setLoading(false)
  }

  const react = async (swapId, reaction) => {
    if (submitting) return // Double-Click-Schutz
    setSubmitting(true)
    const { error } = await supabase.from('swap_reactions').insert({
      swap_id: swapId,
      chatter_name: displayName,
      reaction,
    })
    if (error) {
      const isDuplicate = error.code === '23505' || /duplicate|unique/i.test(error.message || '')
      if (!isDuplicate) {
        alert('Fehler: ' + error.message + '\nBitte erneut versuchen.')
        setSubmitting(false)
        return
      }
      // Falls Duplicate: Reaktion existiert schon, einfach aus Liste entfernen
    }
    setOffers(prev => prev.filter(o => o.id !== swapId))
    setSubmitting(false)
  }

  if (loading || dismissed || offers.length === 0) return null

  const fmtDate = (iso) => {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
        padding: 20, maxWidth: 480, width: '100%',
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5,
            background: 'rgba(245,158,11,0.18)', color: '#f59e0b',
          }}>
            🔄 OFFENE SCHICHTEN
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {offers.length} Angebot{offers.length !== 1 ? 'e' : ''}
          </span>
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: '6px 0 14px' }}>
          Schicht-Tausch verfügbar
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
          {offers.map(o => (
            <div key={o.id} style={{
              padding: '10px 12px', background: 'var(--bg-card2)', borderRadius: 8,
              border: '1px solid rgba(245,158,11,0.25)',
            }}>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {fmtDate(o.shift_date)} · {o.shift}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                  Model: {o.model_name}
                  {o.requester_name && <> · von <span style={{ color: '#a78bfa' }}>{o.requester_name}</span></>}
                  {!o.requester_name && <> · <span style={{ color: '#06b6d4' }}>vom Admin</span></>}
                </div>
                {o.reason && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, fontStyle: 'italic' }}>{o.reason}</div>}
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => react(o.id, 'uebernehmen')} disabled={submitting} style={{
                  flex: 1, padding: '7px 4px', borderRadius: 6,
                  background: 'rgba(16,185,129,0.15)', color: '#10b981',
                  border: '1px solid rgba(16,185,129,0.4)',
                  fontSize: 11, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                }}>✓ Übernehmen</button>
                <button onClick={() => react(o.id, 'vielleicht')} disabled={submitting} style={{
                  flex: 1, padding: '7px 4px', borderRadius: 6,
                  background: 'rgba(245,158,11,0.12)', color: '#f59e0b',
                  border: '1px solid rgba(245,158,11,0.35)',
                  fontSize: 11, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                }}>? Vielleicht</button>
                <button onClick={() => react(o.id, 'abgelehnt')} disabled={submitting} style={{
                  flex: 1, padding: '7px 4px', borderRadius: 6,
                  background: 'transparent', color: 'rgba(239,68,68,0.7)',
                  border: '1px solid rgba(239,68,68,0.3)',
                  fontSize: 11, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                }}>✕ Ablehnen</button>
              </div>
            </div>
          ))}
        </div>

        <button onClick={() => setDismissed(true)} disabled={submitting} style={{
          width: '100%', padding: '9px', borderRadius: 7,
          background: 'transparent', border: '1px solid var(--border)',
          color: 'var(--text-muted)', fontSize: 12, fontFamily: 'inherit', fontWeight: 600,
          cursor: 'pointer',
        }}>Später</button>

        <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', marginTop: 8, fontStyle: 'italic' }}>
          Der Admin entscheidet final, wer die Schicht übernimmt.
        </div>
      </div>
    </div>
  )
}
