import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'

/**
 * SwapModal v3.33.0 — offene Schichten / Angebote für Chatter.
 * - 3 Reaktionen pro Angebot: "Übernehmen" / "Vielleicht" / "Ablehnen"
 * - Bleibt status='offen' egal welche Reaktion → Admin entscheidet final
 * - Sobald reagiert, verschwindet das Angebot für diesen Chatter
 * - NEU: target='frei' → nur Chatter, die an dem Tag NICHT in dieser Schicht
 *        eingeteilt sind, sehen das Angebot (Dienstplan-Abgleich)
 * - NEU: Blöcke (mehrere Models mit gemeinsamer block_id) erscheinen als EINE
 *        Karte; eine Reaktion gilt für den ganzen Block
 * - FIX v3.33.0: "frei"-Abgleich übersah den ZWEITEN Chatter (Co-Schicht /
 *        Anlernen, gespeichert als cell.trainee). Wer nur als zweiter Chatter
 *        eingeteilt war, galt fälschlich als frei und sah das Angebot trotzdem.
 *        Jetzt zählen Haupt- UND Zweit-Chatter als "eingeteilt". Zusätzlich wird
 *        der Namensvergleich normalisiert (trim + Groß/Kleinschreibung egal).
 */

// v3.33.0: Namen tolerant vergleichen (Leerzeichen / Groß-Kleinschreibung egal)
const normName = (s) => (s || '').trim().toLowerCase()

// Montag der Woche zu einem ISO-Datum (gleiche Logik wie ScheduleTab.getWeekStart)
function weekStartIso(dateIso) {
  const d = new Date(dateIso + 'T00:00:00')
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

export default function SwapModal({ displayName }) {
  const [offers, setOffers] = useState([]) // flache, bereits gefilterte Liste von shift_swaps
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

    // Eigene Reaktionen laden
    const ids = swaps.map(s => s.id)
    const { data: myReactions } = await supabase
      .from('swap_reactions')
      .select('swap_id')
      .in('swap_id', ids)
      .eq('chatter_name', displayName)
    const reactedSet = new Set((myReactions || []).map(r => r.swap_id))
    // Blöcke, in denen ich schon irgendeine Zeile beantwortet habe → komplett ausblenden
    const reactedBlockIds = new Set(
      swaps.filter(s => s.block_id && reactedSet.has(s.id)).map(s => s.block_id)
    )

    // "Frei"-Filter: für target='frei'-Angebote prüfen, ob ich in DIESER Schicht
    // an dem Tag schon im Dienstplan stehe → dann sehe ich das Angebot nicht.
    const freiOffers = swaps.filter(s => s.target === 'frei')
    const busySet = new Set() // `${dayIso}__${shift}` wo ICH eingeteilt bin
    if (freiOffers.length > 0) {
      const weeks = [...new Set(freiOffers.map(s => weekStartIso(s.shift_date)))]
      const { data: scheds } = await supabase
        .from('schedule')
        .select('week_start, assignments')
        .in('week_start', weeks)
      for (const row of scheds || []) {
        const assignments = row.assignments || {}
        for (const [key, val] of Object.entries(assignments)) {
          if (!val) continue
          const me = normName(displayName)
          // v3.33.0: Sowohl Haupt-Chatter ALS AUCH zweiter Chatter (Co-Schicht / Anlernen,
          // gespeichert als val.trainee) gelten als "eingeteilt" → nicht mehr frei.
          const isPrimary = val.chatter && val.chatter !== '__FREI__' && normName(val.chatter) === me
          const isSecond  = val.trainee && normName(val.trainee) === me
          if (!isPrimary && !isSecond) continue
          // key = `${modelId}__${dayIso}__${shift}`
          const parts = key.split('__')
          if (parts.length < 3) continue
          busySet.add(`${parts[1]}__${parts[2]}`)
        }
      }
    }

    const filtered = swaps.filter(s => {
      if (s.requester_name === displayName) return false          // eigene Anfrage
      if (reactedSet.has(s.id)) return false                       // schon reagiert (Einzel)
      if (s.block_id && reactedBlockIds.has(s.block_id)) return false // Block schon reagiert
      if (s.target === 'frei' && busySet.has(`${s.shift_date}__${s.shift}`)) return false // nicht frei
      return true
    })

    setOffers(filtered)
    setLoading(false)
  }

  // swapIds: ein oder mehrere (Block) IDs
  const react = async (swapIds, reaction) => {
    if (submitting) return
    setSubmitting(true)
    const rows = swapIds.map(id => ({ swap_id: id, chatter_name: displayName, reaction }))
    const { error } = await supabase.from('swap_reactions').insert(rows)
    if (error) {
      const isDuplicate = error.code === '23505' || /duplicate|unique/i.test(error.message || '')
      if (!isDuplicate) {
        alert('Fehler: ' + error.message + '\nBitte erneut versuchen.')
        setSubmitting(false)
        return
      }
    }
    const idSet = new Set(swapIds)
    setOffers(prev => prev.filter(o => !idSet.has(o.id)))
    setSubmitting(false)
  }

  if (loading || dismissed || offers.length === 0) return null

  // In Anzeige-Items gruppieren: Blöcke zusammen, Einzel-Angebote einzeln
  const blocks = new Map()
  const items = [] // { type:'single', offer } | { type:'block', id, rows }
  for (const o of offers) {
    if (o.block_id) {
      if (!blocks.has(o.block_id)) {
        const entry = { type: 'block', id: o.block_id, rows: [] }
        blocks.set(o.block_id, entry)
        items.push(entry)
      }
      blocks.get(o.block_id).rows.push(o)
    } else {
      items.push({ type: 'single', offer: o })
    }
  }

  const fmtDate = (iso) => {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
  }

  const ReactionButtons = ({ ids }) => (
    <div style={{ display: 'flex', gap: 6 }}>
      <button onClick={() => react(ids, 'uebernehmen')} disabled={submitting} style={{
        flex: 1, padding: '7px 4px', borderRadius: 6,
        background: 'rgba(16,185,129,0.15)', color: '#10b981',
        border: '1px solid rgba(16,185,129,0.4)',
        fontSize: 11, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
      }}>✓ Übernehmen</button>
      <button onClick={() => react(ids, 'vielleicht')} disabled={submitting} style={{
        flex: 1, padding: '7px 4px', borderRadius: 6,
        background: 'rgba(245,158,11,0.12)', color: '#f59e0b',
        border: '1px solid rgba(245,158,11,0.35)',
        fontSize: 11, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
      }}>? Vielleicht</button>
      <button onClick={() => react(ids, 'abgelehnt')} disabled={submitting} style={{
        flex: 1, padding: '7px 4px', borderRadius: 6,
        background: 'transparent', color: 'rgba(239,68,68,0.7)',
        border: '1px solid rgba(239,68,68,0.3)',
        fontSize: 11, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
      }}>✕ Ablehnen</button>
    </div>
  )

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
        padding: 20, maxWidth: 480, width: '100%', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: 'rgba(245,158,11,0.18)', color: '#f59e0b' }}>
            🔄 OFFENE SCHICHTEN
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {items.length} Angebot{items.length !== 1 ? 'e' : ''}
          </span>
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: '6px 0 14px' }}>
          Schicht-Tausch verfügbar
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
          {items.map(item => {
            if (item.type === 'block') {
              const first = item.rows[0]
              const names = item.rows.map(r => r.model_name)
              const ids = item.rows.map(r => r.id)
              return (
                <div key={item.id} style={{
                  padding: '10px 12px', background: 'var(--bg-card2)', borderRadius: 8,
                  border: '1px solid rgba(124,58,237,0.35)',
                }}>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(124,58,237,0.2)', color: '#a78bfa' }}>
                        📦 BLOCK
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {fmtDate(first.shift_date)} · {first.shift}
                      </span>
                    </div>
                    {first.block_label && (
                      <div style={{ fontSize: 11, color: '#a78bfa', marginTop: 2 }}>{first.block_label}</div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>
                      Models (zusammen): <strong>{names.join(' + ')}</strong>
                      <> · <span style={{ color: '#06b6d4' }}>vom Admin</span></>
                    </div>
                    {first.reason && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, fontStyle: 'italic' }}>{first.reason}</div>}
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                      Du übernimmst alle {names.length} Models zusammen.
                    </div>
                  </div>
                  <ReactionButtons ids={ids} />
                </div>
              )
            }
            const o = item.offer
            return (
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
                <ReactionButtons ids={[o.id]} />
              </div>
            )
          })}
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
