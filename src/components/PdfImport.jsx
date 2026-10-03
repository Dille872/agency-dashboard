import React, { useState } from 'react'
import { ARTEN, schritteSauber, vorlageSpeichern } from '../ofSkripte'
import { pdfZeilen, textZeilen, zerlegen } from '../pdfSkripte'
import { P, G, AMB, ROT, card, eingabe, label, knopf, SchritteEditor } from './skriptUi'

// ── 📄 Skripte aus PDF in die Bibliothek (v5.32.0) ─────────────────────────
// Ohne KI: Text im Browser auslesen, nach festen Regeln zerlegen (pdfSkripte.js),
// Vorschlag ansehen und korrigieren, dann gesammelt speichern. Es geht nichts
// an einen fremden Dienst, gespeichert wird nur, was man hier abhakt.

export default function PdfImport({ vorlagen, wer, onFertig, onAbbrechen }) {
  const [modus, setModus] = useState('auto')
  const [dateien, setDateien] = useState([])
  const [vorschlag, setVorschlag] = useState(null) // [{ key, datei, an, offen, titel, art, schritte, outfit, laenge, notiz_builder, stichworte }]
  const [arbeitet, setArbeitet] = useState('')
  const [fehler, setFehler] = useState('')

  const lesen = async (liste = dateien, m = modus) => {
    setFehler(''); setArbeitet('Lese …')
    const neu = []
    for (const d of liste) {
      try {
        const zeilen = /\.txt$/i.test(d.name) ? await textZeilen(d) : await pdfZeilen(d)
        if (!zeilen.some(Boolean)) { setFehler(`„${d.name}“: kein Text gefunden. Ist das ein eingescanntes Bild? Dann geht es nur abtippen.`); continue }
        zerlegen(zeilen, { modus: m, dateiname: d.name }).forEach((s, i) => neu.push({
          ...s, key: d.name + ':' + i, datei: d.name, an: true, offen: false, art: 'video', stichworte: '',
          schritte: s.schritte.length ? s.schritte : [{ text: '' }],
        }))
      } catch (e) { setFehler(`„${d.name}“ ließ sich nicht lesen: ${e.message}`) }
    }
    setArbeitet('')
    setVorschlag(neu)
  }
  const waehlen = (e) => {
    const liste = [...(e.target.files || [])].filter(f => /\.(pdf|txt)$/i.test(f.name))
    setDateien(liste)
    if (liste.length) lesen(liste)
  }
  const setze = (key, p) => setVorschlag(v => v.map(x => x.key === key ? { ...x, ...p } : x))
  const gibt = (titel) => vorlagen.some(v => v.titel.trim().toLowerCase() === String(titel).trim().toLowerCase())
  const auswahl = (vorschlag || []).filter(x => x.an && String(x.titel).trim() && schritteSauber(x.schritte).length)

  const speichern = async () => {
    if (!auswahl.length) return
    const doppelt = auswahl.filter(x => gibt(x.titel)).length
    if (!window.confirm(`${auswahl.length} Vorlage${auswahl.length === 1 ? '' : 'n'} in die Bibliothek speichern?${doppelt ? `\n\n⚠ ${doppelt} davon gibt es mit gleichem Titel schon (werden zusätzlich angelegt, nichts wird überschrieben).` : ''}`)) return
    setArbeitet('Speichere …'); setFehler('')
    let ok = 0
    const fehlerListe = []
    for (const x of auswahl) {
      const { error } = await vorlageSpeichern({ titel: x.titel, art: x.art, schritte: x.schritte, outfit: x.outfit, laenge: x.laenge, notiz_builder: x.notiz_builder, stichworte: x.stichworte }, wer)
      if (error) fehlerListe.push(`${x.titel}: ${error.message}`); else ok++
    }
    setArbeitet('')
    if (fehlerListe.length) { setFehler(`${ok} gespeichert, ${fehlerListe.length} nicht: ${fehlerListe.slice(0, 3).join(' · ')}`); return }
    onFertig(ok)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10, borderColor: G + '77' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ flex: 1, fontSize: 16, color: 'var(--text-primary)' }}>📄 Skripte aus PDF importieren</b>
          <button type="button" onClick={onAbbrechen} style={knopf('', false)}>Schließen</button>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
          Der Text wird nur hier im Browser gelesen, ohne KI. Erkannt werden „Video 2“ / „Skript 3“ (neues Skript), „Schritt 1“ / „Step 2“ / „1.“ / „-“ (neuer Schritt) und „Outfit:“, „Länge:“, „Preis:“. Ohne Schritt-Marker wird jeder Absatz ein Schritt. Du siehst unten alles, bevor gespeichert wird.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: 1, minWidth: 220 }}>
            <span style={label}>PDF-Dateien (mehrere gehen)</span>
            <input type="file" accept=".pdf,.txt,application/pdf,text/plain" multiple onChange={waehlen} style={{ ...eingabe, padding: 7 }} />
          </label>
          <label style={{ minWidth: 220 }}>
            <span style={label}>Aufteilen</span>
            <select value={modus} onChange={e => { setModus(e.target.value); if (dateien.length) lesen(dateien, e.target.value) }} style={eingabe}>
              <option value="auto">automatisch („Video 2“, neue Seite mit Überschrift)</option>
              <option value="seite">jede Seite = ein Skript</option>
              <option value="eins">jede Datei = ein Skript</option>
            </select>
          </label>
        </div>
        {arbeitet && <div style={{ fontSize: 13, color: AMB, fontWeight: 700 }}>{arbeitet}</div>}
        {fehler && <div style={{ fontSize: 12.5, color: ROT }}>{fehler}</div>}
      </div>

      {vorschlag && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <b style={{ flex: 1, fontSize: 14.5, color: 'var(--text-primary)' }}>Vorschlag: {vorschlag.length} Skript{vorschlag.length === 1 ? '' : 'e'} erkannt</b>
            <button type="button" onClick={() => setVorschlag(v => v.map(x => ({ ...x, an: true })))} style={{ ...knopf('', false), padding: '6px 11px', fontSize: 12.5 }}>alle an</button>
            <button type="button" onClick={() => setVorschlag(v => v.map(x => ({ ...x, an: false })))} style={{ ...knopf('', false), padding: '6px 11px', fontSize: 12.5 }}>alle aus</button>
          </div>
          {!vorschlag.length && <div style={{ ...card, fontSize: 13, color: 'var(--text-muted)' }}>Nichts erkannt. Versuch oben eine andere Aufteilung.</div>}
          {vorschlag.map(x => {
            const n = schritteSauber(x.schritte).length
            return (
              <div key={x.key} style={{ ...card, padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 9, opacity: x.an ? 1 : 0.5, borderColor: x.an ? P + '66' : 'var(--border)' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span onClick={() => setze(x.key, { an: !x.an })} style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${x.an ? P : '#3a3a5a'}`, background: x.an ? P : 'transparent', color: '#fff', fontSize: 13, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: '0 0 auto' }}>{x.an ? '✓' : ''}</span>
                  <input value={x.titel} onChange={e => setze(x.key, { titel: e.target.value.slice(0, 200) })} style={{ ...eingabe, flex: 1, minWidth: 180, fontWeight: 700 }} />
                  <select value={x.art} onChange={e => setze(x.key, { art: e.target.value })} style={{ ...eingabe, width: 140 }}>{ARTEN.map(a => <option key={a.k} value={a.k}>{a.t}</option>)}</select>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)' }}>
                  <span>{n} Schritt{n === 1 ? '' : 'e'}{x.outfit ? ` · 👗 ${x.outfit}` : ''}{x.laenge ? ` · ${x.laenge}` : ''} · aus {x.datei}</span>
                  {gibt(x.titel) && <span style={{ color: AMB, fontWeight: 700 }}>⚠ Titel gibt es schon</span>}
                  {!n && <span style={{ color: ROT, fontWeight: 700 }}>keine Schritte, wird nicht gespeichert</span>}
                  <button type="button" onClick={() => setze(x.key, { offen: !x.offen })} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#06b6d4', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit', padding: 0 }}>{x.offen ? '▴ zuklappen' : '▾ ansehen & korrigieren'}</button>
                </div>
                {x.offen && (
                  <>
                    <SchritteEditor schritte={x.schritte} onChange={v => setze(x.key, { schritte: v })} />
                    <div className="sk-zwei" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 8 }}>
                      <div><span style={label}>Outfit / Ort</span><input value={x.outfit || ''} onChange={e => setze(x.key, { outfit: e.target.value.slice(0, 300) })} style={eingabe} /></div>
                      <div><span style={label}>Länge</span><input value={x.laenge || ''} onChange={e => setze(x.key, { laenge: e.target.value.slice(0, 100) })} style={eingabe} /></div>
                    </div>
                    <div className="sk-zwei" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 8 }}>
                      <div><span style={label}>Notiz für CH</span><input value={x.notiz_builder || ''} onChange={e => setze(x.key, { notiz_builder: e.target.value.slice(0, 500) })} style={eingabe} /></div>
                      <div><span style={label}>Stichworte</span><input value={x.stichworte || ''} onChange={e => setze(x.key, { stichworte: e.target.value.slice(0, 200) })} placeholder="z. B. Start, Gym" style={eingabe} /></div>
                    </div>
                  </>
                )}
              </div>
            )
          })}
          {vorschlag.length > 0 && (
            <div style={{ position: 'sticky', bottom: 12, zIndex: 20, ...card, padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderColor: G, boxShadow: '0 10px 30px rgba(0,0,0,.4)' }}>
              <span style={{ flex: 1, minWidth: 160, fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{auswahl.length} von {vorschlag.length} ausgewählt</span>
              <button type="button" disabled={!auswahl.length || !!arbeitet} onClick={speichern} style={{ ...knopf(G), opacity: auswahl.length ? 1 : 0.5 }}>{arbeitet || `In Bibliothek speichern (${auswahl.length})`}</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
