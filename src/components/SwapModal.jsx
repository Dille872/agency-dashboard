import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'

/**
 * SwapModal - zeigt offene Tausch-Angebote im ChatterPortal als Popup.
 * Lädt alle shift_swaps mit status='offen' wo:
 *   - shift_date in Zukunft (oder heute)
 *   - requester_name != displayName (eigene Anfragen ausblenden)
 * Klick "Übernehmen" → status='vorgeschlagen', proposed_by=displayName.
 * "Später" → Modal weg, kommt beim nächsten Login wieder.
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
    const { data } = await supabase
      .from('shift_swaps')
      .select('*')
      .eq('status', 'offen')
      .gte('shift_date', today)
      .order('shift_date', { ascending: true })

    // eigene Anfragen rausfiltern
    const filtered = (data || []).filter(s => s.requester_name !== displayName)
    setOffers(filtered)
    setLoading(false)
  }

  const takeOver = async (id) => {
    setSubmitting(true)
    await supabase
      .from('shift_swaps')
      .update({
        status: 'vorgeschlagen',
        proposed_by: displayName,
        proposed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'offen') // Race-Schutz: nur wenn noch offen
    // entfernen aus Liste
    setOffers(prev => prev.filter(o => o.id !== id))
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {offers.map(o => (
            <div key={o.id} style={{
              padding: '10px 12px', background: 'var(--bg-card2)', borderRadius: 8,
              border: '1px solid rgba(245,158,11,0.25)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
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
              </div>
              <button onClick={() => takeOver(o.id)} disabled={submitting} style={{
                width: '100%', padding: '7px', borderRadius: 6,
                background: '#10b981', color: '#fff', border: 'none',
                fontSize: 12, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}>
                {submitting ? '…' : '✓ Übernehmen'}
              </button>
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
          Nach deiner Wahl bestätigt der Admin den Tausch.
        </div>
      </div>
    </div>
  )
}
