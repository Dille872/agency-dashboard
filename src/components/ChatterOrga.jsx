import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'

// ── Chatter-Portal: Tab „Organisation“ im neuen Look (v4.82.0) ──────────────
//
// Vorher zwei aufklappbare Formulare untereinander (Abwesenheit, Schicht-Tausch).
// Jetzt:
//   • oben „Meine nächsten 7 Tage“ — nächste Schicht groß, darunter ein
//     Wochenstreifen: Schichten als Farbpunkte, 🌴 = eingetragen weg,
//     ↔ = Tausch läuft. Tag antippen → was an dem Tag ansteht + Knöpfe.
//   • zwei große Knöpfe: „Ich kann nicht“ und „Schicht abgeben“ — beide öffnen
//     ein Fenster von unten (am Rechner mittig), wie die Custom-Anfrage.
//   • darunter die eigenen Einträge und Tausch-Anfragen als Karten.
//
// Gespeichert wird genau wie vorher: Abwesenheit über onAbwesenheit (addAbsence
// im ChatterPortal → Tabelle absences), Tausch direkt in shift_swaps.
// Neu: Im Abwesenheits-Fenster steht, welche eingeteilten Schichten der
// Eintrag betrifft — so sieht man vor dem Speichern, was man absagt.

const TUERKIS = '#06b6d4'
const ROT = '#ef4444'
const GELB = '#f59e0b'
const GRUEN = '#10b981'
const KURZ = { Vorschicht: 'V', 'Früh': 'F', 'Spät': 'S', Nacht: 'N' }
const GRUENDE_WEG = [['Krank', '🤒'], ['Urlaub', '✈️'], ['Privat', '🏠'], ['Uni/Schule', '🎓'], ['Termin', '📅']]
const GRUENDE_TAUSCH = [['Termin', '📅'], ['Krank', '🤒'], ['Privat', '🏠'], ['Uni/Schule', '🎓']]

const isoPlus = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const tageBis = (von, bis) => Math.round((new Date(bis + 'T12:00:00') - new Date(von + 'T12:00:00')) / 86400000)
const wtag = (iso, lang = false) => new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { weekday: lang ? 'long' : 'short' })
const datum = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
const imZeitraum = (iso, a) => iso >= a.date_from && iso <= (a.date_to || a.date_from)

const lbl = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 7, display: 'block' }
const feld = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '11px 12px', borderRadius: 12, fontSize: 14, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box', minWidth: 0 }
const chipSt = (an, farbe) => ({
  fontSize: 13, padding: '8px 13px', borderRadius: 20, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  background: an ? farbe + '2a' : 'transparent', border: `1px solid ${an ? farbe : 'var(--border)'}`, color: an ? farbe : 'var(--text-secondary)',
})
const grossSt = (ok, farbe) => ({ background: farbe, color: '#fff', border: 'none', borderRadius: 14, padding: 14, fontSize: 15, fontWeight: 800, cursor: ok ? 'pointer' : 'default', fontFamily: 'inherit', opacity: ok ? 1 : 0.45, width: '100%' })
const karte = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 15px', marginBottom: 12 }

// Wann beginnt die Schicht — „in 3 Std“, „läuft“, „morgen“
function bisStart(s) {
  if (!s.window) return ''
  const ms = s.window.start.getTime() - Date.now()
  if (ms <= 0) return Date.now() < s.window.end.getTime() ? 'läuft gerade' : ''
  const std = ms / 3600000
  if (std < 1) return `in ${Math.max(1, Math.round(ms / 60000))} Min`
  if (std < 24) return `in ${Math.round(std)} Std`
  const t = Math.round(std / 24)
  return t === 1 ? 'in 1 Tag' : `in ${t} Tagen`
}
const zeitVon = (s) => (s.models[0]?.localTime || s.models[0]?.timeStr || '').replace(/\s/g, '')
const modelNamen = (s) => [...new Set(s.models.map(m => m.modelName))].join(', ')

// ── Fenster-Rahmen (von unten, am Rechner mittig) ──
function Fenster({ titel, unter, onZu, children, fuss }) {
  return (
    <div className="steckbrief-huelle" onClick={onZu} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div className="steckbrief-fenster" onClick={e => e.stopPropagation()} role="dialog" aria-label={titel} style={{
        width: 'min(520px, 100%)', maxHeight: 'min(92vh, 860px)', boxSizing: 'border-box', background: 'var(--bg-card)',
        border: '1px solid var(--border)', borderRadius: '22px 22px 0 0', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '14px 18px 10px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button type="button" onClick={onZu} aria-label="Schließen" style={{ width: 36, height: 36, borderRadius: 11, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 17, cursor: 'pointer', flexShrink: 0 }}>×</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            {unter && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{unter}</div>}
            <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--text-primary)' }}>{titel}</div>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 18px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>
        {fuss && <div style={{ padding: '10px 18px 18px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>{fuss}</div>}
      </div>
    </div>
  )
}

// Eine Schicht als Zeile (Farbbalken, Tag, Schicht, Models, Zeit)
function SchichtZeile({ s, farben, rechts, gewaehlt, onClick, gesperrt }) {
  const farbe = farben[s.shift] || '#7c3aed'
  return (
    <div onClick={gesperrt ? undefined : onClick} style={{
      display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 13, cursor: onClick && !gesperrt ? 'pointer' : 'default',
      background: gewaehlt ? farbe + '1f' : 'var(--bg-card2)', border: `1px solid ${gewaehlt ? farbe : 'var(--border)'}`, opacity: gesperrt ? 0.5 : 1,
    }}>
      <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: farbe, flexShrink: 0 }} />
      <div style={{ textAlign: 'center', minWidth: 38 }}>
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{wtag(s.dayIso)}</div>
        <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{datum(s.dayIso).slice(0, 5)}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{s.shift}{zeitVon(s) ? <span style={{ fontWeight: 500, color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 12 }}> · {zeitVon(s)}</span> : null}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{modelNamen(s)}</div>
      </div>
      {rechts}
    </div>
  )
}

export default function ChatterOrga({ heuteIso, schichten = [], abwesenheiten = [], onAbwesenheit, onAbwesenheitLoeschen, displayName, SHIFTS, farben = {} }) {
  const [tausche, setTausche] = useState([])
  const [fenster, setFenster] = useState(null) // null | 'weg' | 'tausch' | { tag }
  const [vorlaufAuf, setVorlaufAuf] = useState(false)

  // Formular „Ich kann nicht“
  const [von, setVon] = useState('')
  const [bis, setBis] = useState('')
  const [wegAn, setWegAn] = useState([]) // leer = ganzer Tag
  const [grund, setGrund] = useState('')
  const [grundText, setGrundText] = useState('')
  const [speichert, setSpeichert] = useState(false)

  // Formular „Schicht abgeben“
  const [tauschSchicht, setTauschSchicht] = useState('')
  const [tauschGrund, setTauschGrund] = useState('')
  const [tauschText, setTauschText] = useState('')
  const [sendet, setSendet] = useState(false)

  // ── Tausch-Anfragen (Logik unverändert aus SwapRequestForm) ──
  const ladeTausche = async () => {
    if (!displayName) return
    // v4.22.0: 'abgelaufen' ist für den Chatter Rauschen — die Schicht bleibt bei ihm.
    const { data } = await supabase.from('shift_swaps').select('*')
      .eq('requester_name', displayName)
      .neq('status', 'abgelaufen')
      .order('shift_date', { ascending: true })
      .limit(10)
    setTausche(data || [])
  }
  useEffect(() => { ladeTausche() }, [displayName]) // eslint-disable-line react-hooks/exhaustive-deps

  const tauschWert = (s) => `${s.berlinDate || s.dayIso}__${s.shift}__${s.models[0]?.modelName || '?'}`
  const offenerTausch = (s) => tausche.find(t => t.status === 'offen' && t.shift_date === (s.berlinDate || s.dayIso) && t.shift === s.shift)

  const tauschSenden = async () => {
    if (!tauschSchicht || sendet) return
    const [shift_date, shift, model_name] = tauschSchicht.split('__')
    const reason = [tauschGrund, tauschText.trim()].filter(Boolean).join(': ') || null
    setSendet(true)
    try {
      const { error } = await supabase.from('shift_swaps').insert({
        requester_name: displayName, shift_date, shift, model_name: model_name || '?', reason, status: 'offen',
      })
      // v4.53.0: vorher immer „✓ gesendet“, auch wenn nichts gespeichert war
      if (error) { alert('⚠ Tausch-Anfrage NICHT gesendet: ' + error.message); return }
      setTauschSchicht(''); setTauschGrund(''); setTauschText('')
      setFenster(null)
      await ladeTausche()
      alert('✓ Tausch-Anfrage gesendet!')
    } catch (e) {
      alert('⚠ Tausch-Anfrage NICHT gesendet: ' + (e?.message || e))
    } finally {
      setSendet(false)
    }
  }

  const tauschStornieren = async (t) => {
    if (!confirm('Tausch-Anfrage stornieren?')) return
    const { error, count } = await supabase.from('shift_swaps').delete({ count: 'exact' }).eq('id', t.id).eq('status', 'offen')
    if (error) { alert('Fehler beim Stornieren: ' + error.message); return }
    if (count === 0) alert('Stornieren nicht möglich — die Schicht wurde inzwischen bereits vom Admin bearbeitet.')
    await ladeTausche()
  }

  // ── Abwesenheit ──
  const wegOeffnen = (tag) => {
    setVon(tag || ''); setBis(tag || ''); setWegAn([]); setGrund(''); setGrundText('')
    setFenster('weg')
  }
  const tauschOeffnen = (s) => {
    setTauschSchicht(s ? tauschWert(s) : ''); setTauschGrund(''); setTauschText('')
    setFenster('tausch')
  }
  const wegSpeichern = async () => {
    if (!von || speichert) return
    setSpeichert(true)
    const ok = await onAbwesenheit({
      von, bis: bis && bis >= von ? bis : von,
      grund: [grund, grundText.trim()].filter(Boolean).join(': '),
      wegSchichten: wegAn,
    })
    setSpeichert(false)
    if (ok) setFenster(null)
  }
  const loeschen = (a) => {
    if (!confirm('Eintrag löschen? Dann giltst du an dem Tag wieder als verfügbar.')) return
    onAbwesenheitLoeschen(a.id)
  }

  // Schnellwahl
  const wt = new Date(heuteIso + 'T12:00:00').getDay() // 0 = So
  const bisSa = (6 - wt + 7) % 7
  const SCHNELL = [
    ['Heute', heuteIso, heuteIso],
    ['Morgen', isoPlus(heuteIso, 1), isoPlus(heuteIso, 1)],
    ['Wochenende', wt === 0 ? heuteIso : isoPlus(heuteIso, bisSa), wt === 0 ? heuteIso : isoPlus(heuteIso, bisSa + 1)],
    ['Nächste Woche', isoPlus(heuteIso, ((8 - wt) % 7) || 7), isoPlus(heuteIso, (((8 - wt) % 7) || 7) + 6)],
  ]

  // Was betrifft der Eintrag?
  const bisEff = bis && bis >= von ? bis : von
  const betroffen = von ? schichten.filter(s => {
    const d = s.berlinDate || s.dayIso
    return d >= von && d <= bisEff && (wegAn.length === 0 || wegAn.includes(s.shift))
  }) : []
  const vorlaufTage = von ? tageBis(heuteIso, von) : null
  const dauer = von ? tageBis(von, bisEff) + 1 : 0
  const kurzfristig = von && grund !== 'Krank' && vorlaufTage !== null && vorlaufTage < 7

  // ── Wochenstreifen ──
  const tage = useMemo(() => Array.from({ length: 7 }, (_, i) => isoPlus(heuteIso, i)), [heuteIso])
  const schichtenAm = (iso) => schichten.filter(s => s.dayIso === iso)
  const wegAm = (iso) => abwesenheiten.find(a => imZeitraum(iso, a))
  const naechste = schichten.find(s => !s.window || s.window.end.getTime() > Date.now())
  const offeneTausche = tausche.filter(t => t.status === 'offen').length
  const wegTage = tage.filter(t => wegAm(t)).length

  return (
    <div className="orga-neu">
      {/* ── Meine nächsten 7 Tage ── */}
      <div style={{ ...karte, padding: 0, overflow: 'hidden', borderColor: 'rgba(124,58,237,0.4)', background: 'linear-gradient(155deg, rgba(124,58,237,0.20), var(--bg-card) 62%)' }}>
        <div style={{ padding: '15px 16px 12px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#a78bfa' }}>Nächste Schicht</div>
          {naechste ? (
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, marginTop: 4 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 21, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                  {naechste.dayIso === heuteIso ? 'Heute' : naechste.dayIso === isoPlus(heuteIso, 1) ? 'Morgen' : wtag(naechste.dayIso, true)}
                  <span style={{ color: farben[naechste.shift] || '#a78bfa' }}> · {naechste.shift}</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {zeitVon(naechste) && <span style={{ fontFamily: 'monospace' }}>{zeitVon(naechste)} · </span>}{modelNamen(naechste)}
                </div>
                {wegAm(naechste.berlinDate || naechste.dayIso) && (
                  <div style={{ fontSize: 11.5, color: 'var(--ton-rot)', marginTop: 3 }}>🌴 Du bist an dem Tag eingetragen — die Schicht steht aber noch auf dir.</div>
                )}
              </div>
              {bisStart(naechste) && (
                <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 800, padding: '6px 11px', borderRadius: 20, background: 'rgba(124,58,237,0.22)', color: 'var(--ton-lila)' }}>{bisStart(naechste)}</span>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-secondary)', marginTop: 4 }}>In den nächsten 7 Tagen keine Schicht</div>
          )}
        </div>

        <div className="raster-7" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 5, padding: '0 10px 12px' }}>
          {tage.map(iso => {
            const ss = schichtenAm(iso)
            const weg = wegAm(iso)
            const tausch = ss.some(s => offenerTausch(s))
            const heute = iso === heuteIso
            return (
              <button key={iso} type="button" className="tag-btn" onClick={() => setFenster({ tag: iso })} aria-label={`${wtag(iso, true)} ${datum(iso)}`} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 2px 9px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', minWidth: 0,
                background: weg ? 'repeating-linear-gradient(135deg, rgba(239,68,68,0.16) 0 6px, rgba(239,68,68,0.06) 6px 12px)' : heute ? 'rgba(124,58,237,0.22)' : 'var(--ton-dunkel)',
                border: `1px solid ${weg ? 'rgba(239,68,68,0.45)' : heute ? '#7c3aed' : 'var(--border)'}`,
              }}>
                <span style={{ fontSize: 10, color: heute ? 'var(--ton-lila)' : 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>{heute ? 'Heute' : wtag(iso)}</span>
                <span style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>{Number(iso.slice(8, 10))}</span>
                <span style={{ display: 'flex', gap: 2, minHeight: 16, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
                  {weg && <span style={{ fontSize: 12 }}>🌴</span>}
                  {ss.map(s => (
                    <span key={s.shift} style={{ fontSize: 9.5, fontWeight: 800, width: 15, height: 15, borderRadius: 5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: farben[s.shift] || '#7c3aed', color: '#fff', opacity: weg ? 0.55 : 1 }}>{KURZ[s.shift] || '•'}</span>
                  ))}
                  {!weg && !ss.length && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>frei</span>}
                </span>
                {tausch && <span style={{ fontSize: 9.5, color: GELB, fontWeight: 800, lineHeight: 1 }}>↔</span>}
              </button>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', padding: '9px 16px 12px', borderTop: '1px solid rgba(124,58,237,0.2)', fontSize: 11.5, color: 'var(--text-muted)' }}>
          <span><b style={{ color: 'var(--text-primary)' }}>{schichten.length}</b> {schichten.length === 1 ? 'Schicht' : 'Schichten'}</span>
          {wegTage > 0 && <span>🌴 <b style={{ color: 'var(--ton-rot)' }}>{wegTage}</b> {wegTage === 1 ? 'Tag' : 'Tage'} weg</span>}
          {offeneTausche > 0 && <span>↔ <b style={{ color: 'var(--ton-gelb)' }}>{offeneTausche}</b> Tausch offen</span>}
          <span style={{ marginLeft: 'auto' }}>Tag antippen für Details</span>
        </div>
      </div>

      {/* ── Zwei große Knöpfe ── */}
      <div className="raster-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <button type="button" className="aktion-btn" onClick={() => wegOeffnen('')} style={{
          textAlign: 'left', padding: '15px 14px', borderRadius: 16, cursor: 'pointer', fontFamily: 'inherit',
          background: 'linear-gradient(150deg, rgba(8,145,178,0.22), var(--bg-card) 75%)', border: '1px solid rgba(8,145,178,0.5)',
        }}>
          <div style={{ fontSize: 22 }}>🌴</div>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--text-primary)', marginTop: 6 }}>Ich kann nicht</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>Urlaub, krank, Termin</div>
        </button>
        <button type="button" className="aktion-btn" onClick={() => tauschOeffnen(null)} disabled={schichten.length === 0} style={{
          textAlign: 'left', padding: '15px 14px', borderRadius: 16, cursor: schichten.length ? 'pointer' : 'default', fontFamily: 'inherit', opacity: schichten.length ? 1 : 0.5,
          background: 'linear-gradient(150deg, rgba(245,158,11,0.2), var(--bg-card) 75%)', border: '1px solid rgba(245,158,11,0.45)',
        }}>
          <div style={{ fontSize: 22 }}>↔️</div>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--text-primary)', marginTop: 6 }}>Schicht abgeben</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{schichten.length ? 'zum Tausch anbieten' : 'keine Schicht geplant'}</div>
        </button>
      </div>

      {/* ── Eingetragen ── */}
      <div data-help="absence" style={karte}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)' }}>🌴 Da bin ich nicht da</span>
          <button type="button" onClick={() => setVorlaufAuf(v => !v)} style={{ background: 'transparent', border: 'none', color: '#a78bfa', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>{vorlaufAuf ? 'Schließen' : 'Wie früh eintragen?'}</button>
        </div>
        {vorlaufAuf && (
          <div style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--text-secondary)', background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.25)', borderRadius: 12, padding: '10px 12px', marginBottom: 10 }}>
            <div className="raster-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 8 }}>
              {[['4+ Tage/Wo', '2 Wochen'], ['3 Tage/Wo', '10 Tage'], ['1–2 Tage/Wo', '1 Woche']].map(([a, b]) => (
                <div key={a} style={{ textAlign: 'center', padding: '8px 4px', borderRadius: 10, background: 'var(--bg-card2)' }}>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{a}</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{b}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>vorher</div>
                </div>
              ))}
            </div>
            Je mehr du bei uns arbeitest, desto mehr zählen wir auf dich. Krank geworden? Kein Stress — das geht natürlich auch kurzfristig.
          </div>
        )}
        {abwesenheiten.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '6px 0' }}>Nichts eingetragen — du giltst überall als verfügbar.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {abwesenheiten.map(a => {
              const bisA = a.date_to || a.date_from
              const mehr = bisA !== a.date_from
              const nurSchichten = (a.available_shifts && a.available_shifts.length) ? SHIFTS.filter(s => !a.available_shifts.includes(s)) : null
              const laeuft = imZeitraum(heuteIso, a)
              return (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 11px', borderRadius: 13, background: laeuft ? 'rgba(239,68,68,0.09)' : 'var(--bg-card2)', border: `1px solid ${laeuft ? 'rgba(239,68,68,0.4)' : 'var(--border)'}` }}>
                  <div style={{ textAlign: 'center', minWidth: 50, padding: '4px 0', borderRadius: 9, background: 'var(--ton-dunkel)' }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{Number(a.date_from.slice(8, 10))}.{mehr ? `–${Number(bisA.slice(8, 10))}.` : ''}</div>
                    <div style={{ fontSize: 10, color: 'var(--ton-rot)' }}>{new Date(a.date_from + 'T12:00:00').toLocaleDateString('de-DE', { month: 'short' })}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.reason || 'Nicht verfügbar'}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                      {laeuft ? 'läuft gerade · ' : ''}{mehr ? `${wtag(a.date_from)}–${wtag(bisA)} · ${tageBis(a.date_from, bisA) + 1} Tage` : wtag(a.date_from, true)}{nurSchichten ? ` · nur ${nurSchichten.join('/')}` : ' · ganzer Tag'}
                    </div>
                  </div>
                  <button type="button" onClick={() => loeschen(a)} aria-label="Eintrag löschen" style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, width: 30, height: 30, flexShrink: 0 }}>✕</button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Tausch-Anfragen ── */}
      <div data-help="swap" style={karte}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>↔️ Meine Tausch-Anfragen</div>
        {tausche.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '6px 0' }}>Keine offenen Anfragen.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {tausche.map(t => {
              const st = t.status === 'offen' ? ['Wartet aufs Team', GELB] : t.status === 'angenommen' ? [`✓ ${t.accepted_by || 'übernommen'}`, GRUEN] : ['Abgeschlossen', ROT]
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 11px', borderRadius: 13, background: 'var(--bg-card2)', border: '1px solid var(--border)' }}>
                  <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: farben[t.shift] || GELB }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{wtag(t.shift_date)} {datum(t.shift_date)} · {t.shift}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.model_name}{t.reason ? ` · ${t.reason}` : ''}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 800, padding: '4px 9px', borderRadius: 20, background: st[1] + '22', color: st[1], whiteSpace: 'nowrap' }}>{st[0]}</span>
                  {t.status === 'offen' && (
                    <button type="button" onClick={() => tauschStornieren(t)} aria-label="Stornieren" style={{ background: 'transparent', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 9, color: 'rgba(239,68,68,0.8)', cursor: 'pointer', fontSize: 12, width: 30, height: 30, flexShrink: 0 }}>✕</button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Fenster: Tag ── */}
      {fenster?.tag && (() => {
        const iso = fenster.tag
        const ss = schichtenAm(iso)
        const weg = wegAm(iso)
        return (
          <Fenster titel={`${wtag(iso, true)}, ${datum(iso)}`} unter={iso === heuteIso ? 'Heute' : iso === isoPlus(heuteIso, 1) ? 'Morgen' : 'Dein Tag'} onZu={() => setFenster(null)}>
            {weg && (
              <div style={{ padding: '11px 13px', borderRadius: 13, background: 'rgba(239,68,68,0.09)', border: '1px solid rgba(239,68,68,0.4)', fontSize: 13, color: 'var(--ton-rot2)' }}>
                🌴 Eingetragen: <b>{weg.reason || 'Nicht verfügbar'}</b>{(weg.available_shifts && weg.available_shifts.length) ? ` · nur ${SHIFTS.filter(s => !weg.available_shifts.includes(s)).join('/')}` : ' · ganzer Tag'}
              </div>
            )}
            {weg && ss.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--ton-gelb2)', lineHeight: 1.5, padding: '9px 12px', borderRadius: 12, background: 'rgba(245,158,11,0.07)', border: '1px dashed rgba(245,158,11,0.4)' }}>
                Du bist eingetragen, hast aber trotzdem eine Schicht. Das Team plant noch um — bis dahin gehört sie dir. Im Zweifel: „↔ abgeben“ oder kurz schreiben.
              </div>
            )}
            <div>
              <span style={lbl}>Deine Schichten</span>
              {ss.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '4px 0' }}>Frei — keine Schicht eingeteilt.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {ss.map(s => {
                    const t = offenerTausch(s)
                    return (
                      <SchichtZeile key={s.shift} s={s} farben={farben} rechts={t
                        ? <span style={{ fontSize: 11, fontWeight: 800, color: GELB, whiteSpace: 'nowrap' }}>↔ läuft</span>
                        : <button type="button" className="chip-btn" onClick={() => tauschOeffnen(s)} style={chipSt(false, GELB)}>↔ abgeben</button>} />
                    )
                  })}
                </div>
              )}
            </div>
            {!weg && (
              <button type="button" className="gross-btn" onClick={() => wegOeffnen(iso)} style={{ ...grossSt(true, '#0e7490') }}>🌴 An diesem Tag kann ich nicht</button>
            )}
          </Fenster>
        )
      })()}

      {/* ── Fenster: Ich kann nicht ── */}
      {fenster === 'weg' && (
        <Fenster titel="Ich kann nicht" unter="Abwesenheit eintragen" onZu={() => { if (!speichert) setFenster(null) }}
          fuss={<button type="button" className="gross-btn" disabled={!von || speichert} onClick={wegSpeichern} style={grossSt(!!von && !speichert, '#0e7490')}>{speichert ? 'Speichere …' : von ? `🌴 Eintragen${dauer > 1 ? ` · ${dauer} Tage` : ''}` : 'Erst Datum wählen'}</button>}>
          <div>
            <span style={lbl}>Wann?</span>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 10 }}>
              {SCHNELL.map(([name, a, b]) => (
                <button key={name} type="button" className="chip-btn" onClick={() => { setVon(a); setBis(b) }} style={chipSt(von === a && bisEff === b, TUERKIS)}>{name}</button>
              ))}
            </div>
            <div className="raster-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ minWidth: 0 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Von</span>
                <input type="date" value={von} min={heuteIso} onChange={e => { const v = e.target.value; setVon(v); if (!bis || bis < v) setBis(v) }} style={{ ...feld, fontFamily: 'monospace', marginTop: 3 }} />
              </label>
              <label style={{ minWidth: 0 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Bis</span>
                <input type="date" value={bis} min={von || heuteIso} onChange={e => setBis(e.target.value)} style={{ ...feld, fontFamily: 'monospace', marginTop: 3 }} />
              </label>
            </div>
          </div>

          <div>
            <span style={lbl}>Weg an</span>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              <button type="button" className="chip-btn" onClick={() => setWegAn([])} style={chipSt(wegAn.length === 0, ROT)}>Ganzer Tag</button>
              {SHIFTS.map(s => {
                const an = wegAn.includes(s)
                return <button key={s} type="button" className="chip-btn" onClick={() => setWegAn(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s])} style={chipSt(an, farben[s] || ROT)}>{an ? '✕ ' : ''}{s}</button>
              })}
            </div>
          </div>

          <div>
            <span style={lbl}>Grund <span style={{ textTransform: 'none', fontWeight: 500, letterSpacing: 0 }}>(hilft bei der Planung)</span></span>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 8 }}>
              {GRUENDE_WEG.map(([g, i]) => (
                <button key={g} type="button" className="chip-btn" onClick={() => setGrund(p => p === g ? '' : g)} style={chipSt(grund === g, '#a78bfa')}>{i} {g}</button>
              ))}
            </div>
            <input value={grundText} onChange={e => setGrundText(e.target.value)} placeholder={grund ? 'Noch was dazu? (optional)' : 'oder eigener Grund'} style={feld} />
          </div>

          {von && (
            <div style={{ padding: '11px 13px', borderRadius: 13, background: betroffen.length ? 'rgba(245,158,11,0.08)' : 'rgba(16,185,129,0.07)', border: `1px solid ${betroffen.length ? 'rgba(245,158,11,0.4)' : 'rgba(16,185,129,0.3)'}` }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: betroffen.length ? 'var(--ton-gelb)' : 'var(--ton-gruen)', marginBottom: betroffen.length ? 7 : 0 }}>
                {betroffen.length ? `Betrifft ${betroffen.length} eingeteilte ${betroffen.length === 1 ? 'Schicht' : 'Schichten'}` : '✓ Keine eingeteilte Schicht betroffen'}
              </div>
              {betroffen.map(s => (
                <div key={s.dayIso + s.shift} style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 7, alignItems: 'center', marginTop: 3 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 3, background: farben[s.shift] || GELB, flexShrink: 0 }} />
                  {wtag(s.dayIso)} {datum(s.dayIso)} · {s.shift} · {modelNamen(s)}
                </div>
              ))}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                Bekannt sind nur die Schichten der nächsten 7 Tage.
              </div>
            </div>
          )}
          {kurzfristig && (
            <div style={{ fontSize: 12, color: 'var(--ton-gelb2)', lineHeight: 1.5, padding: '9px 12px', borderRadius: 12, background: 'rgba(245,158,11,0.07)', border: '1px dashed rgba(245,158,11,0.4)' }}>
              ⏰ Ziemlich kurzfristig ({vorlaufTage === 0 ? 'heute' : vorlaufTage === 1 ? 'morgen' : `in ${vorlaufTage} Tagen`}). Geht trotzdem — schreib dem Team am besten zusätzlich kurz im Chat.
            </div>
          )}
        </Fenster>
      )}

      {/* ── Fenster: Schicht abgeben ── */}
      {fenster === 'tausch' && (
        <Fenster titel="Schicht abgeben" unter="Zum Tausch anbieten" onZu={() => { if (!sendet) setFenster(null) }}
          fuss={<button type="button" className="gross-btn" disabled={!tauschSchicht || sendet} onClick={tauschSenden} style={grossSt(!!tauschSchicht && !sendet, '#d97706')}>{sendet ? 'Sende …' : tauschSchicht ? '↔ Anfrage senden' : 'Erst Schicht wählen'}</button>}>
          <div>
            <span style={lbl}>Welche Schicht?</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {schichten.map(s => {
                const wert = tauschWert(s)
                const laeuft = !!offenerTausch(s)
                return (
                  <SchichtZeile key={wert + s.dayIso} s={s} farben={farben} gewaehlt={tauschSchicht === wert} gesperrt={laeuft}
                    onClick={() => setTauschSchicht(wert)}
                    rechts={laeuft ? <span style={{ fontSize: 11, fontWeight: 800, color: GELB }}>läuft schon</span> : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{bisStart(s)}</span>} />
                )
              })}
            </div>
          </div>
          <div>
            <span style={lbl}>Grund <span style={{ textTransform: 'none', fontWeight: 500, letterSpacing: 0 }}>(optional)</span></span>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 8 }}>
              {GRUENDE_TAUSCH.map(([g, i]) => (
                <button key={g} type="button" className="chip-btn" onClick={() => setTauschGrund(p => p === g ? '' : g)} style={chipSt(tauschGrund === g, GELB)}>{i} {g}</button>
              ))}
            </div>
            <input value={tauschText} onChange={e => setTauschText(e.target.value)} placeholder="Noch was dazu? (optional)" style={feld} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, padding: '9px 12px', borderRadius: 12, background: 'var(--bg-card2)' }}>
            Die Schicht bleibt deine, bis das Team sie jemand anderem gibt — bitte nicht einfach wegbleiben. Eilt es, schreib zusätzlich kurz im Chat.
          </div>
        </Fenster>
      )}
    </div>
  )
}
