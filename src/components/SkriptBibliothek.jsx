import React, { useMemo, useState } from 'react'
import { ARTEN, artText, schritteSauber, STATUS, vorlageSpeichern, vorlageLoeschen, vorlagenZuweisen } from '../ofSkripte'
import { P, G, AMB, ROT, card, eingabe, label, knopf, pill, SchritteEditor, SchritteAnzeige } from './skriptUi'

// ── 📚 Skript-Bibliothek (v5.30.0) ─────────────────────────────────────────
// Fertige Skripte als Vorlage, damit nichts zum hundertsten Mal geschrieben wird.
//   • Admins: Vorlagen anlegen/bearbeiten, Model wählen, Vorlagen ankreuzen und
//     auf einmal geben (z. B. Startpaket für ein neues Model). Die Zuweisung ist
//     sofort freigeschaltet — das Model hat sie in „Skripte für dich“, danach
//     läuft alles wie gewohnt (hochgeladen → Script Builder).
//   • Storyteller: nur lesen (Ideen, nichts doppelt schreiben).
// Woher man weiß, wer was schon hatte: of_skripte.vorlage_id.

const leer = () => ({ titel: '', art: 'video', stichworte: '', schritte: [{ text: '' }], outfit: '', laenge: '', notiz_builder: '' })

function VorlageFormular({ vorlage, wer, onFertig, onAbbrechen }) {
  const [v, setV] = useState(() => vorlage ? { ...leer(), ...vorlage, schritte: (vorlage.schritte || []).length ? vorlage.schritte.map(x => ({ ...x })) : [{ text: '' }] } : leer())
  const [arbeitet, setArbeitet] = useState(false)
  const [fehler, setFehler] = useState('')
  const setze = (p) => setV(x => ({ ...x, ...p }))
  const bereit = String(v.titel).trim() && schritteSauber(v.schritte).length > 0
  const sichern = async () => {
    setFehler(''); setArbeitet(true)
    const { error } = await vorlageSpeichern(v, wer)
    setArbeitet(false)
    if (error) { setFehler(error.message); return }
    onFertig()
  }
  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12, borderColor: G + '77' }}>
      <b style={{ fontSize: 16, color: 'var(--text-primary)' }}>{v.id ? 'Vorlage bearbeiten' : 'Neue Vorlage'}</b>
      <div className="sk-zwei" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 10 }}>
        <div><span style={label}>Titel</span><input value={v.titel} onChange={e => setze({ titel: e.target.value.slice(0, 200) })} placeholder="z. B. Morgenroutine im Bett" style={eingabe} /></div>
        <div><span style={label}>Art</span><select value={v.art} onChange={e => setze({ art: e.target.value })} style={eingabe}>{ARTEN.map(a => <option key={a.k} value={a.k}>{a.t}</option>)}</select></div>
      </div>
      <div><span style={label}>Stichworte (zum Suchen, optional)</span><input value={v.stichworte || ''} onChange={e => setze({ stichworte: e.target.value.slice(0, 200) })} placeholder="z. B. Start, Gym, soft, Dessous" style={eingabe} /></div>
      <div><span style={label}>Ablauf · Schritt für Schritt</span><SchritteEditor schritte={v.schritte} onChange={x => setze({ schritte: x })} /></div>
      <div className="sk-zwei" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 10 }}>
        <div><span style={label}>Outfit / Ort</span><input value={v.outfit || ''} onChange={e => setze({ outfit: e.target.value.slice(0, 300) })} style={eingabe} /></div>
        <div><span style={label}>Länge</span><input value={v.laenge || ''} onChange={e => setze({ laenge: e.target.value.slice(0, 100) })} style={eingabe} /></div>
      </div>
      <div><span style={label}>Notiz für den Script Builder</span><input value={v.notiz_builder || ''} onChange={e => setze({ notiz_builder: e.target.value.slice(0, 500) })} style={eingabe} /></div>
      {fehler && <div style={{ fontSize: 12.5, color: ROT }}>{fehler}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button type="button" onClick={onAbbrechen} style={knopf('', false)}>Abbrechen</button>
        <button type="button" disabled={!bereit || arbeitet} onClick={sichern} style={{ ...knopf(G), opacity: bereit ? 1 : 0.5 }}>{arbeitet ? '…' : 'In Bibliothek speichern'}</button>
      </div>
    </div>
  )
}

export default function SkriptBibliothek({ liste, vorlagen, models, wer, istAdmin, neuLaden }) {
  const [model, setModel] = useState('')
  const [suche, setSuche] = useState('')
  const [art, setArt] = useState('')
  const [gewaehlt, setGewaehlt] = useState(() => new Set())
  const [offen, setOffen] = useState(null)
  const [form, setForm] = useState(null) // null | 'neu' | vorlage
  const [faellig, setFaellig] = useState('')
  const [arbeitet, setArbeitet] = useState(false)
  const [meldung, setMeldung] = useState(null)

  // Wer hatte welche Vorlage schon? vorlage_id → [{ model, status }]
  const genutzt = useMemo(() => {
    const m = {}
    for (const s of liste) if (s.vorlage_id && s.status !== 'verworfen') (m[s.vorlage_id] ||= []).push({ model: s.model_name, status: s.status })
    return m
  }, [liste])
  const hatteSchon = (v) => model && (genutzt[v.id] || []).find(x => x.model === model)

  const q = suche.trim().toLowerCase()
  const sicht = vorlagen
    .filter(v => !art || v.art === art)
    .filter(v => !q || [v.titel, v.stichworte, v.outfit, ...(v.schritte || []).map(x => x.text)].some(t => String(t || '').toLowerCase().includes(q)))
  const umschalten = (id) => setGewaehlt(g => { const n = new Set(g); n.has(id) ? n.delete(id) : n.add(id); return n })
  const melde = (ok, text) => { setMeldung({ ok, text }); setTimeout(() => setMeldung(null), 7000) }

  const geben = async () => {
    const liste2 = vorlagen.filter(v => gewaehlt.has(v.id))
    if (!model || !liste2.length) return
    if (!window.confirm(`${liste2.length === 1 ? '1 Skript' : `${liste2.length} Skripte`} an ${model} geben?\n\n${liste2.map(v => '• ' + v.titel).join('\n')}\n\nSie sind sofort freigeschaltet, ${model} bekommt eine Telegram-Nachricht.`)) return
    setArbeitet(true)
    const r = await vorlagenZuweisen({ vorlagen: liste2, model, faellig, wer })
    setArbeitet(false)
    if (r.error) return melde(false, r.error.message)
    setGewaehlt(new Set()); setFaellig('')
    melde(true, `✓ ${liste2.length} an ${model} gegeben. ${r.info || ''}`)
    neuLaden()
  }
  const loeschen = async (v) => {
    if (!window.confirm(`Vorlage „${v.titel}“ aus der Bibliothek löschen? Skripte, die Models schon haben, bleiben.`)) return
    const { error } = await vorlageLoeschen(v.id)
    if (error) return melde(false, error.message)
    neuLaden()
  }

  if (form) return <VorlageFormular vorlage={form === 'neu' ? null : form} wer={wer} onAbbrechen={() => setForm(null)} onFertig={() => { setForm(null); neuLaden() }} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <b style={{ flex: 1, minWidth: 180, fontSize: 15, color: 'var(--text-primary)' }}>📚 Bibliothek <span style={{ fontWeight: 500, fontSize: 12.5, color: 'var(--text-muted)' }}>· {vorlagen.length} Vorlage{vorlagen.length === 1 ? '' : 'n'}</span></b>
          {istAdmin && <button type="button" onClick={() => setForm('neu')} style={knopf(G)}>+ Neue Vorlage</button>}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          {istAdmin ? 'Model wählen, Vorlagen ankreuzen, „an Model geben“. Gut als Startpaket für neue Models. Vorlagen entstehen hier oder über „📚 In Bibliothek“ bei einem fertigen Skript.' : 'Fertige Skripte zum Nachschauen, damit nichts doppelt geschrieben wird.'}
        </div>
        <div className="sk-zwei" style={{ display: 'grid', gridTemplateColumns: istAdmin ? 'minmax(0,1fr) minmax(0,1.3fr) minmax(0,0.8fr)' : 'minmax(0,1.3fr) minmax(0,0.8fr)', gap: 8 }}>
          {istAdmin && (
            <select value={model} onChange={e => { setModel(e.target.value); setGewaehlt(new Set()) }} style={{ ...eingabe, borderColor: model ? P : 'var(--border)' }}>
              <option value="">Für Model … (zum Zuweisen)</option>
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          <input value={suche} onChange={e => setSuche(e.target.value)} placeholder="🔍 Suchen (Titel, Stichwort, Schritt)" style={eingabe} />
          <select value={art} onChange={e => setArt(e.target.value)} style={eingabe}>
            <option value="">Alle Arten</option>{ARTEN.map(a => <option key={a.k} value={a.k}>{a.t}</option>)}
          </select>
        </div>
      </div>

      {meldung && <div style={{ fontSize: 13, fontWeight: 700, color: meldung.ok ? G : ROT }}>{meldung.text}</div>}
      {!vorlagen.length && <div style={{ ...card, fontSize: 13, color: 'var(--text-muted)' }}>Noch leer. {istAdmin ? 'Mit „+ Neue Vorlage“ anfangen oder bei einem fertigen Skript unter Freigabe „📚 In Bibliothek“ tippen.' : ''}</div>}
      {vorlagen.length > 0 && !sicht.length && <div style={{ ...card, fontSize: 13, color: 'var(--text-muted)' }}>Nichts gefunden.</div>}

      {sicht.map(v => {
        const hatte = hatteSchon(v)
        const an = gewaehlt.has(v.id)
        const wer2 = genutzt[v.id] || []
        const auf = offen === v.id
        return (
          <div key={v.id} style={{ ...card, padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 8, borderColor: an ? P : 'var(--border)', background: an ? P + '0f' : 'var(--bg-card)' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              {istAdmin && model && (
                <span onClick={() => !hatte && umschalten(v.id)} title={hatte ? `${model} hatte das schon` : 'ankreuzen'}
                  style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${an ? P : '#3a3a5a'}`, background: an ? P : 'transparent', color: '#fff', fontSize: 13, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: hatte ? 'not-allowed' : 'pointer', opacity: hatte ? 0.35 : 1, flex: '0 0 auto' }}>{an ? '✓' : ''}</span>
              )}
              <div onClick={() => setOffen(auf ? null : v.id)} style={{ flex: 1, minWidth: 170, cursor: 'pointer' }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>{v.titel}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{artText(v.art)} · {schritteSauber(v.schritte).length} Schritte{v.laenge ? ` · ${v.laenge}` : ''}{v.stichworte ? ` · ${v.stichworte}` : ''}</div>
              </div>
              {hatte && <span style={pill(STATUS[hatte.status]?.f || AMB)}>{model}: {STATUS[hatte.status]?.t || hatte.status}</span>}
              {!model && wer2.length > 0 && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>genutzt: {[...new Set(wer2.map(x => x.model))].join(', ')}</span>}
              <span onClick={() => setOffen(auf ? null : v.id)} style={{ color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}>{auf ? '▴' : '▾'}</span>
            </div>
            {auf && <>
              <SchritteAnzeige schritte={v.schritte} />
              {v.outfit && <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>👗 {v.outfit}</div>}
              {v.notiz_builder && <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>🧩 Notiz für CH: {v.notiz_builder}</div>}
              {wer2.length > 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Schon gegeben an: {wer2.map(x => `${x.model} (${STATUS[x.status]?.t || x.status})`).join(', ')}</div>}
              {istAdmin && (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => loeschen(v)} style={{ ...knopf('', false), color: 'var(--text-muted)' }}>Löschen</button>
                  <button type="button" onClick={() => setForm(v)} style={knopf('', false)}>Bearbeiten</button>
                </div>
              )}
            </>}
          </div>
        )
      })}

      {istAdmin && model && gewaehlt.size > 0 && (
        <div style={{ position: 'sticky', bottom: 12, zIndex: 20, ...card, padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderColor: P, boxShadow: '0 10px 30px rgba(0,0,0,.4)' }}>
          <span style={{ flex: 1, minWidth: 160, fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{gewaehlt.size} ausgewählt für <span style={{ color: P }}>{model}</span></span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>bis
            <input type="date" value={faellig} onChange={e => setFaellig(e.target.value)} style={{ ...eingabe, width: 150, padding: '7px 9px' }} /></label>
          <button type="button" onClick={() => setGewaehlt(new Set())} style={knopf('', false)}>Leeren</button>
          <button type="button" disabled={arbeitet} onClick={geben} style={knopf(P)}>{arbeitet ? '…' : `An ${model} geben`}</button>
        </div>
      )}
    </div>
  )
}
