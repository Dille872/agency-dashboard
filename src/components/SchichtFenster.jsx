import React, { useEffect, useMemo, useState } from 'react'

// ── Dienstplan: „Schicht belegen“ (v4.83.0) ─────────────────────────────────
//
// Ersetzt das Auswahlfeld „— leer —“ (Handy-Fenster) und das Mini-Formular in
// der Zelle (Desktop). Dasselbe Innenleben an beiden Stellen:
//   • art="sheet"  → Fenster von unten (Handy)
//   • art="panel"  → Seitenleiste rechts (Desktop); das Raster bleibt sichtbar,
//                    ein Klick auf die nächste Zelle wechselt nur den Inhalt.
//
// Oben: Chatter als Karten, sortiert nach „passt“ — mit dem, was man zum
// Entscheiden braucht (abwesend, schon andere Schicht an dem Tag, Schichten
// diese Woche, kennt das Model). Darunter die Details: Modus (Allein /
// Anlernen / Co / Geteilt), Zeit, Notiz, Bestätigt, Jede Woche, Erinnerung.
//
// Gespeichert wird NICHTS hier drin: jede Änderung geht sofort über die
// Funktionen des ScheduleTab (setChatter, setModus, setCell, saveRecurring …)
// in den Plan — genau wie vorher. Die Autospeicherung dort übernimmt den Rest.

const LILA = '#7c3aed'
const lbl = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 7, display: 'block' }
const feld = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '10px 12px', borderRadius: 12, fontSize: 14, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box', minWidth: 0 }
const chipSt = (an, farbe = LILA) => ({
  fontSize: 13, padding: '8px 13px', borderRadius: 20, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  background: an ? farbe + '2a' : 'transparent', border: `1px solid ${an ? farbe : 'var(--border)'}`, color: an ? farbe : 'var(--text-secondary)',
})
const AVATAR = ['#0891b2', '#db2777', '#7c3aed', '#059669', '#d97706', '#4f46e5', '#be123c']
const farbeVon = (name) => AVATAR[Math.abs([...String(name)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % AVATAR.length]
const wtag = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })

function Schalter({ an, onClick, farbe = '#10b981', label }) {
  return (
    <button type="button" role="switch" aria-checked={an} aria-label={label} onClick={onClick} className="schalter-btn" style={{
      width: 44, height: 26, borderRadius: 13, border: 'none', position: 'relative', cursor: 'pointer', flexShrink: 0, padding: 0,
      background: an ? farbe : 'var(--border)', transition: 'background .15s',
    }}>
      <span style={{ position: 'absolute', top: 3, left: an ? 21 : 3, width: 20, height: 20, borderRadius: 10, background: '#fff', transition: 'left .15s' }} />
    </button>
  )
}

function PersonKarte({ p, gewaehlt, onClick }) {
  const gesperrt = !!p.abwesend
  const info = []
  if (p.abwesend) info.push(<span key="a" style={{ color: '#fca5a5' }}>🌴 abwesend{p.abwesend.reason ? ` · ${p.abwesend.reason}` : ''}</span>)
  else if (p.andere.length) info.push(<span key="d" style={{ color: '#fcd34d' }}>hat an dem Tag schon {p.andere.join(' + ')}</span>)
  else if (p.pause) info.push(<span key="p" style={{ color: '#fcd34d' }}>⏱ nur {String(p.pause.std).replace('.', ',')} Std Pause {p.pause.vorher ? 'nach' : 'vor'} {p.pause.zu}</span>)
  else info.push(<span key="f" style={{ color: '#6ee7b7' }}>frei</span>)
  info.push(<span key="w"> · {p.woche} {p.woche === 1 ? 'Schicht' : 'Schichten'} diese Woche</span>)
  if (p.gleiche.length) info.push(<span key="g"> · betreut dann auch {p.gleiche.join(', ')}</span>)
  else if (p.kennt) info.push(<span key="k"> · kennt das Model</span>)
  return (
    <button type="button" disabled={gesperrt} onClick={onClick} className="schicht-karte" style={{
      display: 'flex', alignItems: 'center', gap: 11, padding: '9px 11px', borderRadius: 13, textAlign: 'left', width: '100%',
      cursor: gesperrt ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: gesperrt ? 0.5 : 1,
      background: gewaehlt ? 'rgba(124,58,237,0.16)' : 'var(--bg-card2)', border: `1px solid ${gewaehlt ? LILA : 'var(--border)'}`,
    }}>
      <span style={{ width: 32, height: 32, borderRadius: 16, background: farbeVon(p.name), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{p.name[0]?.toUpperCase()}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{p.name}{p.admin ? <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}> · Admin</span> : null}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.35, marginTop: 1 }}>{info}</span>
      </span>
      {gewaehlt && <span style={{ color: '#c4b5fd', fontWeight: 800 }}>✓</span>}
    </button>
  )
}

export default function SchichtFenster({
  art = 'sheet', model, dayIso, shift, schichtFarbe, standardZeit = '', cell, personen = [], admins = [],
  MODE_META, zellModus, isRecurring, onRecurring, onChatter, onCell, onModus, onLeeren, onAusschreiben,
  reminderAktiv, onReminder, sendingReminder, swapHier, onZu,
  andereModels = [], onUebernehmen,
}) {
  const chatter = cell.chatter || ''
  const isFrei = chatter === '__FREI__'
  const hatChatter = !!chatter && !isFrei
  const [waehlen, setWaehlen] = useState(!chatter)
  const [suche, setSuche] = useState('')
  const [zweiteOffen, setZweiteOffen] = useState(!!cell.trainee)
  const [andereZeit, setAndereZeit] = useState(!!cell.time_override)
  // v4.85.0: dieselbe Belegung für weitere Models derselben Schicht
  const [kopieOffen, setKopieOffen] = useState(false)
  const [kopieZiele, setKopieZiele] = useState([])
  const [kopieFertig, setKopieFertig] = useState('')

  // Neue Zelle angeklickt (Desktop-Leiste bleibt offen) → Zustand zurücksetzen
  const zellKey = `${model?.id}__${dayIso}__${shift}`
  useEffect(() => {
    setWaehlen(!cell.chatter); setSuche(''); setZweiteOffen(!!cell.trainee); setAndereZeit(!!cell.time_override)
    setKopieOffen(false); setKopieZiele([]); setKopieFertig('')
  }, [zellKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const q = suche.trim().toLowerCase()
  const { passt, lieberNicht } = useMemo(() => {
    const liste = personen.filter(p => !q || p.name.toLowerCase().includes(q))
    const passt = liste.filter(p => !p.abwesend && !p.andere.length)
      .sort((a, b) => (Number(!!a.pause) - Number(!!b.pause)) || (Number(b.kennt || b.gleiche.length > 0) - Number(a.kennt || a.gleiche.length > 0)) || (a.woche - b.woche) || a.name.localeCompare(b.name))
    const lieberNicht = liste.filter(p => p.abwesend || p.andere.length)
      .sort((a, b) => Number(!!a.abwesend) - Number(!!b.abwesend) || a.name.localeCompare(b.name))
    return { passt, lieberNicht }
  }, [personen, q])

  const modus = zellModus(cell)
  const zweiteAktiv = !!cell.trainee || zweiteOffen
  const ichSelbst = personen.find(p => p.name === chatter)
  const waehle = (name) => { onChatter(name); if (name && name !== '__FREI__') setWaehlen(false) }

  const titel = !chatter || waehlen ? `${model?.name || ''} — wer übernimmt?` : isFrei ? `${model?.name || ''} · Freischicht` : `${chatter} übernimmt`
  const unter = (
    <>{wtag(dayIso)} · <span style={{ color: schichtFarbe, fontWeight: 700 }}>{shift}</span>{standardZeit ? <> · <span style={{ fontFamily: 'monospace' }}>{standardZeit}</span></> : null}{(!waehlen && chatter) ? ` · ${model?.name}` : ''}</>
  )

  const inhalt = (
    <>
      {/* ── Wer? ── */}
      {(waehlen || !chatter) ? (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, ...feld, padding: '9px 12px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--text-muted)', flexShrink: 0 }}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input value={suche} onChange={e => setSuche(e.target.value)} placeholder="Chatter suchen" aria-label="Chatter suchen"
              style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit' }} />
          </label>
          <div>
            <span style={lbl}>Frei · passt {passt.length ? `(${passt.length})` : ''}</span>
            {passt.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{q ? 'Niemand gefunden.' : 'Gerade ist niemand ohne Einschränkung frei.'}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {passt.map(p => <PersonKarte key={p.name} p={p} gewaehlt={p.name === chatter} onClick={() => waehle(p.name)} />)}
              </div>
            )}
          </div>
          {lieberNicht.length > 0 && (
            <div>
              <span style={lbl}>Lieber nicht</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {lieberNicht.map(p => <PersonKarte key={p.name} p={p} gewaehlt={p.name === chatter} onClick={() => waehle(p.name)} />)}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <button type="button" className="chip-btn" onClick={() => waehle('__FREI__')} style={chipSt(isFrei, '#06b6d4')}>{isFrei ? '✓ ' : ''}Bewusst frei (Freischicht)</button>
            {!isFrei && <button type="button" className="chip-btn" onClick={onAusschreiben} style={chipSt(!!swapHier, '#f59e0b')}>🔄 {swapHier ? 'Ist ausgeschrieben' : 'Ausschreiben'}</button>}
            {chatter && <button type="button" className="chip-btn" onClick={() => setWaehlen(false)} style={chipSt(false)}>Abbrechen</button>}
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 13, background: isFrei ? 'rgba(6,182,212,0.1)' : 'rgba(124,58,237,0.12)', border: `1px solid ${isFrei ? 'rgba(6,182,212,0.4)' : 'rgba(124,58,237,0.45)'}` }}>
          {isFrei ? <span style={{ fontSize: 20 }}>✓</span> : (
            <span style={{ width: 34, height: 34, borderRadius: 17, background: farbeVon(chatter), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{chatter[0]?.toUpperCase()}</span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)' }}>{isFrei ? 'Freischicht' : chatter}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              {isFrei ? 'bewusst nicht besetzt — zählt nicht als offen'
                : ichSelbst ? `${ichSelbst.woche} ${ichSelbst.woche === 1 ? 'Schicht' : 'Schichten'} diese Woche${ichSelbst.gleiche.length ? ` · betreut dann auch ${ichSelbst.gleiche.join(', ')}` : ''}` : ''}
            </div>
          </div>
          <button type="button" className="chip-btn" onClick={() => setWaehlen(true)} style={{ ...chipSt(false), padding: '7px 12px' }}>ändern</button>
        </div>
      )}

      {/* ── Details ── */}
      {hatChatter && !waehlen && (
        <>
          {ichSelbst?.abwesend && (
            <div style={{ fontSize: 12.5, color: '#fecaca', padding: '9px 12px', borderRadius: 12, background: 'rgba(239,68,68,0.09)', border: '1px solid rgba(239,68,68,0.4)' }}>
              🌴 {chatter} ist an dem Tag als abwesend eingetragen{ichSelbst.abwesend.reason ? ` (${ichSelbst.abwesend.reason})` : ''}.
            </div>
          )}
          {ichSelbst?.pause && !ichSelbst?.andere?.length && (
            <div style={{ fontSize: 12, color: '#fde68a', lineHeight: 1.45, padding: '9px 12px', borderRadius: 12, background: 'rgba(245,158,11,0.07)', border: '1px dashed rgba(245,158,11,0.4)' }}>
              ⏱ {chatter} hätte nur {String(ichSelbst.pause.std).replace('.', ',')} Std Pause {ichSelbst.pause.vorher ? 'nach' : 'vor'} der Schicht {ichSelbst.pause.zu}.
            </div>
          )}
          {ichSelbst?.andere?.length > 0 && (
            <div style={{ fontSize: 12, color: '#fde68a', lineHeight: 1.45, padding: '9px 12px', borderRadius: 12, background: 'rgba(245,158,11,0.07)', border: '1px dashed rgba(245,158,11,0.4)' }}>
              {chatter} hat an dem Tag auch {ichSelbst.andere.join(' + ')} — das wäre eine Doppelschicht.
            </div>
          )}

          <div>
            <span style={lbl}>Wie?</span>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              <button type="button" className="chip-btn" style={chipSt(!zweiteAktiv)} onClick={() => {
                if (cell.trainee && !window.confirm(`„${cell.trainee}" aus der Schicht nehmen?`)) return
                onCell({ ...cell, trainee: null, split_a_von: null, split_a_bis: null, split_b_von: null, split_b_bis: null })
                setZweiteOffen(false)
              }}>Allein</button>
              {['anlernen', 'co', 'split'].map(m => (
                <button key={m} type="button" className="chip-btn" style={chipSt(zweiteAktiv && modus === m, MODE_META[m].color)}
                  onClick={() => { onModus(m); setZweiteOffen(true) }}>{MODE_META[m].icon} {MODE_META[m].label}</button>
              ))}
            </div>
            {zweiteAktiv && (
              <div style={{ marginTop: 9 }}>
                {modus === 'anlernen' ? (
                  <input value={cell.trainee || ''} onChange={e => onCell({ ...cell, trainee: e.target.value || null })}
                    placeholder="Wer wird angelernt? (auch externe ohne Account)" style={{ ...feld, borderColor: MODE_META.anlernen.color }} />
                ) : (
                  <select value={cell.trainee || ''} onChange={e => onCell({ ...cell, trainee: e.target.value || null })}
                    style={{ ...feld, borderColor: MODE_META[modus].color, color: cell.trainee ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    <option value="">— zweite Person wählen —</option>
                    {personen.filter(p => p.name !== chatter).map(p => (
                      <option key={p.name} value={p.name} disabled={!!p.abwesend}>{p.name}{p.abwesend ? ' (abwesend)' : p.andere.length ? ' (hat schon Schicht)' : ''}</option>
                    ))}
                    {admins.filter(a => a !== chatter && !personen.some(p => p.name === a)).map(a => <option key={`a-${a}`} value={a}>{a} (Admin)</option>)}
                  </select>
                )}
                {modus === 'split' && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Zeiten optional — leer heißt nur: die Schicht wurde geteilt.</div>
                    {[{ seite: 'a', name: chatter }, { seite: 'b', name: cell.trainee || '2. Person' }].map(({ seite, name }) => (
                      <div key={seite} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, color: MODE_META.split.color, fontWeight: 700, width: 84, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                        <input type="time" value={cell[`split_${seite}_von`] || ''} onChange={e => onCell({ ...cell, [`split_${seite}_von`]: e.target.value || null })} style={{ ...feld, padding: '8px', fontFamily: 'monospace', fontSize: 13 }} />
                        <span style={{ color: 'var(--text-muted)' }}>–</span>
                        <input type="time" value={cell[`split_${seite}_bis`] || ''} onChange={e => onCell({ ...cell, [`split_${seite}_bis`]: e.target.value || null })} style={{ ...feld, padding: '8px', fontFamily: 'monospace', fontSize: 13 }} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <span style={lbl}>Zeit</span>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              <button type="button" className="chip-btn" style={{ ...chipSt(!cell.time_override && !andereZeit), fontFamily: 'monospace' }}
                onClick={() => { onCell({ ...cell, time_override: null }); setAndereZeit(false) }}>{standardZeit || 'ohne Zeit'} · Standard</button>
              <button type="button" className="chip-btn" style={chipSt(!!cell.time_override || andereZeit, '#f97316')} onClick={() => setAndereZeit(true)}>Andere Zeit …</button>
            </div>
            {(andereZeit || cell.time_override) && (
              <div style={{ marginTop: 8 }}>
                <input value={cell.time_override || ''} onChange={e => onCell({ ...cell, time_override: e.target.value || null })}
                  placeholder={standardZeit ? `z. B. ${standardZeit}` : '08:00-14:00'} style={{ ...feld, fontFamily: 'monospace', borderColor: cell.time_override ? '#f97316' : undefined, color: cell.time_override ? '#f97316' : undefined }} />
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>Gilt nur für diesen Tag (deutsche Zeit).</div>
              </div>
            )}
          </div>

          <div>
            <span style={lbl}>Notiz für den Chatter</span>
            <input value={cell.note || ''} onChange={e => onCell({ ...cell, note: e.target.value })} placeholder="z. B. spezielle Anweisung" style={{ ...feld, color: cell.note ? '#fbbf24' : undefined }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: cell.confirmed !== false ? 'var(--text-primary)' : '#fbbf24' }}>{cell.confirmed !== false ? 'Bestätigt' : '! Klärung nötig'}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>aus = „Klärung nötig“, erscheint gelb im Plan</div>
              </div>
              <Schalter label="Bestätigt" an={cell.confirmed !== false} onClick={() => onCell({ ...cell, confirmed: cell.confirmed === false })} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>↻ Jede Woche so</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>jeden {new Date(dayIso + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long' })} {shift} bei {model?.name}</div>
              </div>
              <Schalter label="Jede Woche" an={isRecurring} farbe={LILA} onClick={() => onRecurring(!isRecurring)} />
            </div>
            <div style={{ padding: '11px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 7 }}>
                Telegram-Erinnerung an {chatter}{reminderAktiv ? <span style={{ fontSize: 11.5, color: '#06b6d4', fontWeight: 600 }}> · eingestellt</span> : null}
              </div>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                {['1', '3', '12', '24'].map(h => (
                  <button key={h} type="button" className="chip-btn" disabled={sendingReminder} onClick={() => onReminder(h)} style={chipSt(false, '#06b6d4')}>{h} Std vorher</button>
                ))}
              </div>
            </div>
          </div>
          {/* v4.85.0: Gleiche Belegung für weitere Models (gleicher Tag, gleiche Schicht) */}
          {andereModels.length > 0 && (
            <div style={{ padding: '12px 13px', borderRadius: 14, background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Auch bei anderen Models</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{chatter}{zweiteAktiv && cell.trainee ? ` + ${cell.trainee}` : ''} · {shift} · gleiche Einstellungen</div>
                </div>
                {!kopieOffen && <button type="button" className="chip-btn" onClick={() => { setKopieOffen(true); setKopieFertig('') }} style={chipSt(false)}>+ Model</button>}
              </div>
              {kopieFertig && <div style={{ fontSize: 12, color: '#6ee7b7', marginTop: 8 }}>✓ Übernommen für {kopieFertig}</div>}
              {kopieOffen && (() => {
                const frei = andereModels.filter(m => !m.belegt)
                const ziele = andereModels.filter(m => kopieZiele.includes(m.id))
                return (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 9 }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {andereModels.map(m => {
                        const gleich = m.belegt === chatter
                        const an = kopieZiele.includes(m.id)
                        const fremd = !!m.belegt && !gleich
                        return (
                          <button key={m.id} type="button" className="chip-btn" disabled={gleich}
                            onClick={() => setKopieZiele(z => z.includes(m.id) ? z.filter(x => x !== m.id) : [...z, m.id])}
                            style={{ ...chipSt(an, fremd ? '#f59e0b' : LILA), opacity: gleich ? 0.55 : 1, cursor: gleich ? 'default' : 'pointer' }}>
                            {an ? '✓ ' : '+ '}{m.name}
                            <span style={{ fontWeight: 500, fontSize: 11.5, color: gleich ? '#6ee7b7' : fremd ? '#fcd34d' : 'var(--text-muted)' }}> · {gleich ? 'schon ' + chatter : m.belegt === '__FREI__' ? 'Freischicht' : m.belegt || 'frei'}</span>
                          </button>
                        )
                      })}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {frei.length > 1 && <button type="button" className="chip-btn" onClick={() => setKopieZiele(frei.map(m => m.id))} style={chipSt(false, '#10b981')}>Alle freien ({frei.length})</button>}
                      <button type="button" className="chip-btn" onClick={() => { setKopieOffen(false); setKopieZiele([]) }} style={chipSt(false)}>Abbrechen</button>
                    </div>
                    {ziele.some(m => m.belegt && m.belegt !== chatter) && (
                      <div style={{ fontSize: 11.5, color: '#fde68a' }}>⚠ Bei {ziele.filter(m => m.belegt && m.belegt !== chatter).map(m => m.name).join(', ')} steht schon jemand — du wirst vorm Überschreiben gefragt.</div>
                    )}
                    <button type="button" className="gross-btn" disabled={ziele.length === 0}
                      onClick={() => {
                        const erledigt = onUebernehmen(ziele.map(m => m.id))
                        if (erledigt && erledigt.length) { setKopieFertig(erledigt.join(', ')); setKopieOffen(false); setKopieZiele([]) }
                      }}
                      style={{ padding: 12, borderRadius: 12, border: 'none', background: LILA, color: '#fff', fontWeight: 800, fontSize: 14, fontFamily: 'inherit', cursor: ziele.length ? 'pointer' : 'default', opacity: ziele.length ? 1 : 0.45 }}>
                      {ziele.length ? `Für ${ziele.length} ${ziele.length === 1 ? 'Model' : 'Models'} übernehmen` : 'Models antippen'}
                    </button>
                  </div>
                )
              })()}
            </div>
          )}
          <button type="button" className="chip-btn" onClick={onAusschreiben} style={{ ...chipSt(!!swapHier, '#f59e0b'), alignSelf: 'flex-start' }}>🔄 {swapHier ? 'Ist ausgeschrieben — nochmal' : 'Ausschreiben (zum Tausch anbieten)'}</button>
        </>
      )}
    </>
  )

  const kopf = (
    <div style={{ padding: '14px 18px 10px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{unter}</div>
        <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--text-primary)' }}>{titel}</div>
      </div>
      <button type="button" onClick={onZu} aria-label="Schließen" style={{ width: 36, height: 36, borderRadius: 11, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 17, cursor: 'pointer', flexShrink: 0 }}>×</button>
    </div>
  )
  const fuss = (
    <div style={{ padding: '10px 18px 18px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
      {chatter && (
        <button type="button" className="gross-btn" onClick={onLeeren} style={{ flex: 1, padding: 13, borderRadius: 14, background: 'transparent', border: '1px solid rgba(239,68,68,0.45)', color: '#fca5a5', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>Leeren</button>
      )}
      <button type="button" className="gross-btn" onClick={onZu} style={{ flex: 2, padding: 13, borderRadius: 14, background: LILA, border: 'none', color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit' }}>✓ Fertig</button>
    </div>
  )
  const koerper = <div style={{ flex: 1, overflowY: 'auto', padding: '4px 18px 16px', display: 'flex', flexDirection: 'column', gap: 15 }}>{inhalt}</div>

  if (art === 'panel') {
    return (
      <aside className="schicht-panel" aria-label="Schicht belegen" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 400, zIndex: 1000, background: 'var(--bg-card)',
        borderLeft: '1px solid var(--border)', boxShadow: '-12px 0 32px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column',
      }}>
        {kopf}{koerper}{fuss}
      </aside>
    )
  }
  return (
    <div className="steckbrief-huelle" onClick={onZu} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div className="steckbrief-fenster" onClick={e => e.stopPropagation()} role="dialog" aria-label="Schicht belegen" style={{
        width: 'min(540px, 100%)', maxHeight: 'min(92vh, 900px)', boxSizing: 'border-box', background: 'var(--bg-card)',
        border: '1px solid var(--border)', borderRadius: '22px 22px 0 0', display: 'flex', flexDirection: 'column',
      }}>
        {kopf}{koerper}{fuss}
      </div>
    </div>
  )
}
