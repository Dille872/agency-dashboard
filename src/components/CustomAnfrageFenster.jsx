import React, { useState } from 'react'
import { reiseHeute, zustand, listeAus } from '../modelLage'

// ── Chatter-Portal: Custom-Anfrage in 4 Schritten (v4.81.0) ─────────────────
//
// Vorher ein langes Formular mit rund zehn Feldern untereinander. Jetzt ein
// Fenster von unten, Schritt für Schritt: Was → Für wen → Was genau → Preis.
// Jeder Schritt passt auf einen Handy-Bildschirm.
//
// Wichtig: Die Werte liegen weiter im ChatterPortal (dieselben useStates wie
// vorher), gespeichert wird mit derselben Funktion submitContentRequest —
// gleiche Tabelle, gleiche Felder, gleiche Telegram-Nachricht an die Admins.
// Dieses Fenster ist nur die Eingabe.
//
// Neu in Schritt 2: Beim gewählten Model steht sofort, was gilt — laufende
// Reise (und was dann nicht geht), Angebot laut Board, ab-Preis, No Gos — und
// ob der Kunde schon bestellt hat (customerHistory).

const ART = {
  video:     { icon: '🎬', sub: 'Clip nach Wunsch',      laengen: ['1 Min', '3 Min', '5 Min', '10 Min'], preisWort: ['video', 'clip'] },
  bild:      { icon: '📸', sub: 'Set oder Einzelbilder', anzahl: [1, 3, 5, 10],                      preisWort: ['bild', 'foto', 'set', 'pic'] },
  audio:     { icon: '🎙', sub: 'Audio mit Namen …',     laengen: ['1 Min', '2 Min', '5 Min'],           preisWort: ['audio', 'sprach', 'voice'] },
  videocall: { icon: '📹', sub: 'live, mit Termin',      laengen: ['10 Min', '15 Min', '30 Min'],        preisWort: ['call', 'vc', 'videocall'], flag: 'video_chat', reiseWort: ['video-call', 'videocall', 'video call'] },
  telefonat: { icon: '📞', sub: 'live, mit Termin',      laengen: ['10 Min', '15 Min', '30 Min'],        preisWort: ['telefon', 'anruf', 'call'], flag: 'telefonieren', reiseWort: ['telefon', 'telefonieren'] },
  sonstiges: { icon: '✨', sub: 'alles andere',          laengen: [],                                     preisWort: ['custom'] },
}
// Reihenfolge der Kacheln: das Häufigste zuerst
const REIHENFOLGE = ['video', 'bild', 'audio', 'videocall', 'telefonat', 'sonstiges']
const OUTFITS = ['Bikini', 'Dessous', 'Casual', 'Kleid', 'Sportlich']
const BESONDERS = ['Namen sagen', 'Mit Gesicht', 'Bestimmte Anrede', 'Requisite']
const EILE = [['asap', '⚡ Sofort', '#ef4444'], ['hours', '⏰ Heute', '#f97316'], ['days', '📅 1–2 Tage', '#f59e0b'], ['week', '🗓 Diese Woche', '#10b981']]
const LILA = '#7c3aed'
const lc = (s) => String(s || '').trim().toLowerCase()
const AVATAR = ['#0891b2', '#db2777', '#7c3aed', '#059669', '#d97706', '#4f46e5', '#be123c']
const farbeVon = (name) => AVATAR[Math.abs([...String(name)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % AVATAR.length]

const lbl = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 7, display: 'block' }
const feld = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '11px 12px', borderRadius: 12, fontSize: 14, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }
const chipSt = (an, farbe = LILA) => ({
  fontSize: 13, padding: '8px 13px', borderRadius: 20, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  background: an ? farbe + '2a' : 'transparent', border: `1px solid ${an ? farbe : 'var(--border)'}`, color: an ? farbe : 'var(--text-secondary)',
})
const gross = (ok) => ({ background: LILA, color: '#fff', border: 'none', borderRadius: 14, padding: 14, fontSize: 15, fontWeight: 800, cursor: ok ? 'pointer' : 'default', fontFamily: 'inherit', opacity: ok ? 1 : 0.45, width: '100%' })

export default function CustomAnfrageFenster({
  f, set, typMeta, meineModels, profileOptionsByModel, boards = {}, services = {}, models = [], kundenHistorie = [],
  sending, onSenden, onZu,
}) {
  const [schritt, setSchritt] = useState(1)
  const [andereZeigen, setAndereZeigen] = useState(false)
  const art = ART[f.type] || ART.sonstiges
  const meta = typMeta[f.type] || {}

  // ── Schritt 2: Model-Hinweise ──
  const model = f.model
  const board = boards[model] || {}
  const reise = model ? reiseHeute(board.reise || []) : null
  const reiseNicht = listeAus(reise?.reise_geht_nicht).map(lc)
  const reiseSperrt = !!reise && (reiseNicht.includes('custom') || (art.reiseWort || []).some(w => reiseNicht.includes(w)))
  const flag = art.flag ? services[model]?.[art.flag]?.enabled : undefined
  const preisHinweis = (board.preise || []).find(p => p.price && art.preisWort.some(w => lc(p.title).includes(w)))
  const nogos = (board.nogos || []).map(n => n.title)
  const kunde = lc(f.customerId)
  const frueher = kunde && model ? kundenHistorie.filter(r => r.model_name === model && lc(r.customer_id) === kunde) : []
  const alleModels = Object.keys(profileOptionsByModel)
  const andere = alleModels.filter(m => !meineModels.includes(m))

  const modelWaehlen = (m) => {
    const opts = profileOptionsByModel[m] || []
    set.model(m)
    set.profile(opts.length === 1 ? opts[0].profileName : '')
  }

  // ── Schritt 3: Besonderheiten als Chips, die Zeilen in den Text setzen ──
  const hatBesonders = (t) => f.special.split('\n').some(z => lc(z).startsWith(lc(t)))
  const besondersTippen = (t) => {
    const zeilen = f.special.split('\n').filter(z => z.trim())
    const neu = hatBesonders(t) ? zeilen.filter(z => !lc(z).startsWith(lc(t))) : [...zeilen, t === 'Namen sagen' ? 'Namen sagen: ' : t]
    set.special(neu.join('\n'))
  }

  const ok = {
    1: !!f.type,
    2: !!f.model && !!f.profile,
    3: !!f.text.trim(),
    4: !!f.model && !!f.text.trim() && !(f.payStatus === 'angezahlt' && !(parseFloat(f.deposit) > 0)),
  }
  const weiter = () => { if (ok[schritt]) setSchritt(s => Math.min(4, s + 1)) }
  const zurueck = () => (schritt === 1 ? onZu() : setSchritt(s => s - 1))
  const titel = { 1: 'Was möchte der Kunde?', 2: 'Für wen?', 3: 'Was genau?', 4: 'Preis & Zeit' }[schritt]

  const preis = parseFloat(f.price) || 0
  const anz = parseFloat(f.deposit) || 0
  const eile = EILE.find(e => e[0] === f.deadline)

  return (
    <div className="steckbrief-huelle" onClick={onZu} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div className="steckbrief-fenster" onClick={e => e.stopPropagation()} role="dialog" aria-label="Neue Custom-Anfrage" style={{
        width: 'min(520px, 100%)', height: 'min(92vh, 860px)', boxSizing: 'border-box', background: 'var(--bg-card)',
        border: '1px solid var(--border)', borderRadius: '22px 22px 0 0', display: 'flex', flexDirection: 'column',
      }}>
        {/* Kopf */}
        <div style={{ padding: '14px 18px 10px', display: 'flex', flexDirection: 'column', gap: 11, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" onClick={zurueck} aria-label={schritt === 1 ? 'Schließen' : 'Zurück'} style={{ width: 36, height: 36, borderRadius: 11, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 17, cursor: 'pointer', flexShrink: 0 }}>{schritt === 1 ? '×' : '‹'}</button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Neue Custom-Anfrage · Schritt {schritt} von 4</div>
              <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--text-primary)' }}>{titel}</div>
            </div>
            {schritt > 1 && <button type="button" onClick={onZu} aria-label="Schließen" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}>×</button>}
          </div>
          <div style={{ display: 'flex', gap: 5 }}>
            {[1, 2, 3, 4].map(i => <span key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= schritt ? LILA : 'var(--bg-card2)' }} />)}
          </div>
        </div>

        {/* Inhalt */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 18px 12px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {schritt === 1 && (
            <>
              <div className="raster-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
                {[...REIHENFOLGE.filter(k => typMeta[k]), ...Object.keys(typMeta).filter(k => !REIHENFOLGE.includes(k))].map(k => [k, typMeta[k]]).map(([k, m]) => {
                  const a = ART[k] || ART.sonstiges
                  const an = f.type === k
                  return (
                    <button key={k} type="button" className="kachel" onClick={() => { set.type(k); setSchritt(2) }} style={{
                      padding: '16px 12px', borderRadius: 16, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                      background: an ? 'rgba(124,58,237,0.16)' : 'var(--bg-card2)', border: an ? `1.5px solid ${LILA}` : '1px solid var(--border)',
                      display: 'flex', flexDirection: 'column', gap: 5, color: 'var(--text-primary)',
                    }}>
                      <span style={{ fontSize: 26 }}>{a.icon}</span>
                      <span style={{ fontSize: 15, fontWeight: 700 }}>{m.label}{m.live && <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 800, marginLeft: 5 }}>● LIVE</span>}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 500 }}>{a.sub}</span>
                    </button>
                  )
                })}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>Antippen = weiter. Danach fragen wir nur, was zur Art passt.</div>
            </>
          )}

          {schritt === 2 && (
            <>
              <div>
                <span style={lbl}>Für welches Model?</span>
                {meineModels.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(3, meineModels.length)}, 1fr)`, gap: 8 }} className={meineModels.length >= 3 ? 'raster-3' : 'raster-2'}>
                    {meineModels.map(m => {
                      const r = reiseHeute(boards[m]?.reise || [])
                      const z = zustand(models.find(x => x.name === m), r)
                      const an = model === m
                      return (
                        <button key={m} type="button" className="kachel" onClick={() => modelWaehlen(m)} style={{
                          padding: '11px 6px', borderRadius: 14, textAlign: 'center', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-primary)',
                          background: an ? 'rgba(124,58,237,0.16)' : 'var(--bg-card2)', border: an ? `1.5px solid ${LILA}` : '1px solid var(--border)',
                        }}>
                          <div style={{ width: 34, height: 34, borderRadius: 17, background: farbeVon(m), color: '#fff', margin: '0 auto 5px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{String(m).charAt(0).toUpperCase()}</div>
                          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{m}</div>
                          <div style={{ fontSize: 10.5, color: z.farbe, fontWeight: 600 }}>{r ? `✈ ${r.title}` : z.text}</div>
                        </button>
                      )
                    })}
                  </div>
                )}
                {andere.length > 0 && (
                  <div style={{ marginTop: 9 }}>
                    {meineModels.length > 0 && !andereZeigen && !andere.includes(model)
                      ? <button type="button" onClick={() => setAndereZeigen(true)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Anderes Model …</button>
                      : (
                        <select value={andere.includes(model) ? model : ''} onChange={e => e.target.value && modelWaehlen(e.target.value)} style={feld}>
                          <option value="">{meineModels.length ? '— anderes Model wählen —' : '— Model wählen —'}</option>
                          {andere.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      )}
                  </div>
                )}
              </div>

              {model && (profileOptionsByModel[model] || []).length > 1 && (
                <div>
                  <span style={lbl}>Welcher Account?</span>
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                    {(profileOptionsByModel[model] || []).map(o => (
                      <button key={o.profileName} type="button" className="chip-btn" onClick={() => set.profile(o.profileName)} style={chipSt(f.profile === o.profileName)}>{o.profileName}</button>
                    ))}
                  </div>
                </div>
              )}

              {model && reise && (
                <div style={{ padding: '12px 13px', borderRadius: 13, background: reiseSperrt ? 'rgba(239,68,68,0.08)' : 'rgba(8,145,178,0.08)', border: `1px solid ${reiseSperrt ? 'rgba(239,68,68,0.4)' : 'rgba(8,145,178,0.4)'}` }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: reiseSperrt ? '#ef4444' : '#0891b2' }}>
                    ✈ {model} ist {reise.date_to ? `bis ${new Date(reise.date_to + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} ` : ''}auf Reise ({reise.title})
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.45 }}>
                    {reiseSperrt ? 'Das geht laut Reiseplan gerade nicht. Anfragen kannst du trotzdem — dann mit Fälligkeit nach der Rückkehr.' : 'Laut Reiseplan geht diese Art trotzdem.'}
                    {reise.reise_geht_nicht && <> Geht nicht: {reise.reise_geht_nicht}.</>}
                  </div>
                </div>
              )}
              {model && flag === false && (
                <div style={{ padding: '11px 13px', borderRadius: 13, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.4)', fontSize: 12.5, color: '#ef4444', fontWeight: 600 }}>
                  ✕ {model} bietet {meta.label} laut Board nicht an.
                </div>
              )}
              {model && (preisHinweis || nogos.length > 0) && (
                <div style={{ padding: '11px 13px', borderRadius: 13, background: 'var(--bg-card2)', border: '1px solid var(--border)', fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                  {preisHinweis && <div><b style={{ color: 'var(--text-primary)' }}>{preisHinweis.title}</b> <b style={{ fontFamily: 'monospace', color: '#10b981' }}>{preisHinweis.price}</b></div>}
                  {nogos.length > 0 && <div><span style={{ color: '#ef4444', fontWeight: 600 }}>No Gos:</span> {nogos.slice(0, 6).join(', ')}{nogos.length > 6 ? ' …' : ''}</div>}
                </div>
              )}

              <label>
                <span style={lbl}>Kunde <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>(Kundennummer, optional)</span></span>
                <input value={f.customerId} onChange={e => set.customerId(e.target.value)} placeholder="#FAN-xxxx" style={{ ...feld, fontFamily: 'monospace' }} />
              </label>
              {frueher.length > 0 && (
                <div style={{ fontSize: 12, color: '#f59e0b', marginTop: -8 }}>
                  ↺ hat schon {frueher.length}× bei {model} bestellt{frueher[0]?.price ? ` · zuletzt $${frueher[0].price}` : ''}
                </div>
              )}
            </>
          )}

          {schritt === 3 && (
            <>
              {(art.laengen?.length > 0 || art.anzahl) && (
                <div>
                  <span style={lbl}>{art.anzahl ? 'Wie viele?' : (meta.durLabel === 'Dauer' ? 'Wie lang?' : 'Wie lang?')}</span>
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
                    {art.anzahl
                      ? art.anzahl.map(n => <button key={n} type="button" className="chip-btn" onClick={() => set.quantity(String(n))} style={chipSt(String(f.quantity) === String(n))}>{n} {n === 1 ? 'Bild' : 'Bilder'}</button>)
                      : art.laengen.map(l => <button key={l} type="button" className="chip-btn" onClick={() => set.duration(l)} style={chipSt(f.duration === l)}>{l}</button>)}
                    <input value={art.anzahl ? (art.anzahl.map(String).includes(String(f.quantity)) ? '' : f.quantity) : (art.laengen.includes(f.duration) ? '' : f.duration)}
                      onChange={e => art.anzahl ? set.quantity(e.target.value) : set.duration(e.target.value)}
                      placeholder="eigene" style={{ ...feld, width: 96, padding: '8px 10px', fontSize: 13 }} />
                  </div>
                </div>
              )}
              {!art.anzahl && meta.showQuantity && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ ...lbl, marginBottom: 0 }}>Anzahl</span>
                  <button type="button" onClick={() => set.quantity(String(Math.max(1, (parseInt(f.quantity) || 1) - 1)))} style={{ ...chipSt(false), padding: '6px 12px' }}>−</button>
                  <b style={{ fontFamily: 'monospace', fontSize: 15, color: 'var(--text-primary)' }}>{parseInt(f.quantity) || 1}</b>
                  <button type="button" onClick={() => set.quantity(String((parseInt(f.quantity) || 1) + 1))} style={{ ...chipSt(false), padding: '6px 12px' }}>+</button>
                </div>
              )}
              <label>
                <span style={lbl}>Wunsch des Kunden *</span>
                <textarea autoFocus value={f.text} onChange={e => set.text(e.target.value)} rows={3} placeholder="Was möchte der Kunde genau?" style={{ ...feld, resize: 'vertical', lineHeight: 1.45 }} />
              </label>
              {meta.showOutfit && (
                <div>
                  <span style={lbl}>Outfit</span>
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                    {OUTFITS.map(o => <button key={o} type="button" className="chip-btn" onClick={() => set.outfit(lc(f.outfit) === lc(o) ? '' : o)} style={chipSt(lc(f.outfit) === lc(o))}>{o}</button>)}
                  </div>
                  <input value={OUTFITS.some(o => lc(o) === lc(f.outfit)) ? '' : f.outfit} onChange={e => set.outfit(e.target.value)} placeholder="oder selbst beschreiben, z. B. rotes Kleid" style={{ ...feld, marginTop: 8, fontSize: 13.5 }} />
                </div>
              )}
              <div>
                <span style={lbl}>Besonderheiten</span>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 8 }}>
                  {BESONDERS.map(b => <button key={b} type="button" className="chip-btn" onClick={() => besondersTippen(b)} style={chipSt(hatBesonders(b))}>{b}</button>)}
                </div>
                <textarea value={f.special} onChange={e => set.special(e.target.value)} rows={2} placeholder="z. B. Name: Max · bestimmte Ansprache · Requisiten …" style={{ ...feld, resize: 'vertical', fontSize: 13.5 }} />
              </div>
              {meta.showImages && (
                <div>
                  <span style={lbl}>Referenzbilder <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>(optional · max. 5)</span></span>
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                    {f.images.map((file, i) => (
                      <div key={i} style={{ position: 'relative' }}>
                        <img src={URL.createObjectURL(file)} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 11, border: '1px solid var(--border)' }} />
                        <button type="button" onClick={() => set.images(prev => prev.filter((_, j) => j !== i))} aria-label="Bild entfernen"
                          style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 9, background: '#ef4444', border: 'none', color: '#fff', fontSize: 10, cursor: 'pointer', padding: 0 }}>✕</button>
                      </div>
                    ))}
                    {f.images.length < 5 && (
                      <label style={{ width: 60, height: 60, borderRadius: 11, border: '1.5px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 22, cursor: 'pointer' }}>
                        +
                        <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => {
                          const files = Array.from(e.target.files || [])
                          set.images(prev => [...prev, ...files].slice(0, 5))
                        }} />
                      </label>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {schritt === 4 && (
            <>
              <div>
                <span style={lbl}>Preis</span>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input type="number" inputMode="decimal" value={f.price} onChange={e => set.price(e.target.value)} placeholder="$ 0" style={{ ...feld, flex: 1, fontFamily: 'monospace', fontSize: 20, fontWeight: 700 }} />
                  {preisHinweis && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.35 }}>{model}: {preisHinweis.title}<br /><b style={{ color: '#10b981' }}>{preisHinweis.price}</b></div>}
                </div>
              </div>
              <div>
                <span style={lbl}>Schon bezahlt?</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[['anfrage', 'Noch nichts', '#a78bfa'], ['angezahlt', 'Angezahlt', '#f59e0b'], ['bezahlt', 'Komplett', '#10b981']].map(([k, l, c]) => (
                    <button key={k} type="button" className="chip-btn" onClick={() => set.payStatus(k)} style={{ ...chipSt(f.payStatus === k, c), flex: 1, borderRadius: 12, padding: '10px 4px', fontWeight: 700 }}>{l}</button>
                  ))}
                </div>
                {f.payStatus === 'angezahlt' && (
                  <>
                    <input type="number" inputMode="decimal" value={f.deposit} onChange={e => set.deposit(e.target.value)} placeholder="Anzahlung in $" style={{ ...feld, marginTop: 8, fontFamily: 'monospace' }} />
                    <div style={{ fontSize: 11.5, color: anz > 0 ? 'var(--text-muted)' : '#f59e0b', marginTop: 5 }}>
                      {anz > 0 ? `Rest $${Math.max(0, preis - anz)} offen` : 'Bitte Anzahlung eintragen, sonst wird nichts als bezahlt markiert.'}
                    </div>
                  </>
                )}
              </div>
              <div>
                <span style={lbl}>Bis wann?</span>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  {EILE.map(([k, l, c]) => <button key={k} type="button" className="chip-btn" onClick={() => set.deadline(k)} style={chipSt(f.deadline === k, c)}>{l}</button>)}
                </div>
              </div>
              <div style={{ padding: 13, borderRadius: 14, background: 'var(--bg-card2)', border: '1px solid var(--border)' }}>
                <span style={{ ...lbl, marginBottom: 8 }}>Zusammenfassung</span>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {art.icon} {meta.label}{f.duration ? ` · ${f.duration}` : ''}{(parseInt(f.quantity) || 1) > 1 ? ` · ×${parseInt(f.quantity)}` : ''} · {f.profile || model || '—'}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.45 }}>
                  {f.text.trim() ? `„${f.text.trim()}"` : <span style={{ color: '#ef4444' }}>Wunsch fehlt (Schritt 3)</span>}
                  {meta.showOutfit && f.outfit ? ` · ${f.outfit}` : ''}
                  {f.special.trim() ? ` · ${f.special.trim().replace(/\n/g, ' · ')}` : ''}
                  {f.images.length ? ` · ${f.images.length} Bild${f.images.length > 1 ? 'er' : ''}` : ''}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 9, fontSize: 12.5, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{f.customerId || 'ohne Kundennummer'} · {eile ? eile[1] : ''}</span>
                  <span>
                    <b style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>${preis}</b>
                    {f.payStatus === 'bezahlt' && <span style={{ color: '#10b981' }}> · bezahlt</span>}
                    {f.payStatus === 'angezahlt' && anz > 0 && <span style={{ color: '#f59e0b' }}> · ${anz} angezahlt</span>}
                    {f.payStatus === 'anfrage' && <span style={{ color: 'var(--text-muted)' }}> · noch nichts bezahlt</span>}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Fuß */}
        {schritt > 1 && (
          <div style={{ padding: '10px 18px calc(16px + env(safe-area-inset-bottom, 0px))', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            {schritt < 4
              ? <button type="button" className="gross-btn" onClick={weiter} disabled={!ok[schritt]} style={gross(ok[schritt])}>
                  {ok[schritt] ? 'Weiter' : schritt === 2 ? (f.model ? 'Account wählen' : 'Model wählen') : 'Wunsch eintragen'}
                </button>
              : <button type="button" className="gross-btn" onClick={onSenden} disabled={!ok[4] || sending} style={gross(ok[4] && !sending)}>
                  {sending ? (f.images.length ? 'Bilder werden hochgeladen …' : 'Wird gesendet …') : 'Anfrage senden'}
                </button>}
          </div>
        )}
      </div>
    </div>
  )
}
