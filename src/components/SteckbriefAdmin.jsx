import React, { useState } from 'react'
import { supabase } from '../supabase'
import { sendTelegramMessage, zugestellt } from '../telegram'
import { logActivity } from '../activity'
import { useSteckbriefe, creatorHeroText, steckbriefSpeichern } from '../steckbrief'
import SteckbriefAnsicht from './SteckbriefAnsicht'
import ModelEinfuehrung, { themenStand } from './ModelEinfuehrung'

// ── Admin: Steckbrief & Einführung je Model (v4.95.0) ──────────────────────
// Sitzt in Kommunikation → Model-Boards.
//   • Einführung schicken: einzeln (beim gewählten Model) oder „Mehrere auswählen“.
//     Schicken = Status 'offen' → beim nächsten Öffnen des Portals startet die
//     Einführung. Schon ausgefüllte Antworten bleiben stehen (vorbefüllt).
//     Optional Telegram-Hinweis. NIE automatisch an alle.
//   • Zurücknehmen, solange nicht fertig (Antworten bleiben).
//   • Für CreatorHero kopieren: Text aus Steckbrief + Angebot/No Gos, ohne Preise.
//   • Bearbeiten: dieselben Schritte wie beim Model (ohne Board-Teil).

const STATUS = {
  offen: { t: 'geschickt', f: '#f59e0b' },
  laeuft: { t: 'läuft', f: '#06b6d4' },
  fertig: { t: 'fertig', f: '#10b981' },
}
const knopf = (farbe, voll) => ({ padding: '8px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', border: voll ? 'none' : `1px solid ${farbe}`, background: voll ? farbe : 'transparent', color: voll ? '#fff' : farbe, whiteSpace: 'nowrap' })
const tag = (iso) => iso ? new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : ''
const TG_TEXT = 'Hey {name} 👋 Bitte öffne einmal dein Portal und füll deinen Steckbrief aus, dauert ca. 15 Minuten. Deine Chatter wissen dann, was sie über dich erzählen dürfen. Danke! 💛'

export function StatusPill({ zeile }) {
  const st = STATUS[zeile?.einfuehrung_status]
  const stand = themenStand(zeile?.antworten)
  if (!st) return <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'var(--bg-card2)', color: 'var(--text-muted)' }}>{stand.voll ? `Steckbrief ${stand.voll}/${stand.gesamt}` : 'kein Steckbrief'}</span>
  const wann = zeile.einfuehrung_status === 'fertig' ? tag(zeile.fertig_am) : zeile.einfuehrung_status === 'offen' ? tag(zeile.geschickt_am) : `${stand.voll}/${stand.gesamt}`
  return <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: st.f + '22', color: st.f }}>{st.t}{wann ? ` · ${wann}` : ''}</span>
}

export default function SteckbriefAdmin({ models = [], gewaehlt, board = {}, services = {}, userName }) {
  const namen = models.map(m => m.name)
  const { map, fehlt, neuLaden } = useSteckbriefe(namen)
  const [mehrere, setMehrere] = useState(false)
  const [auswahl, setAuswahl] = useState(new Set())
  const [schicken, setSchicken] = useState(null)     // [namen] → Fenster
  const [mitTelegram, setMitTelegram] = useState(true)
  const [tgText, setTgText] = useState(TG_TEXT)
  const [arbeitet, setArbeitet] = useState(false)
  const [bearbeiten, setBearbeiten] = useState(false)
  const [kopiert, setKopiert] = useState(false)

  if (fehlt) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '10px 12px', borderRadius: 10, border: '1px dashed var(--border)' }}>
        Steckbrief / Einführung: Tabelle fehlt noch. Einmal <code>sql/model-steckbrief.sql</code> in Supabase ausführen.
      </div>
    )
  }

  const zeile = gewaehlt ? map[gewaehlt] : null
  const laeuft = ['offen', 'laeuft'].includes(zeile?.einfuehrung_status)

  const abschicken = async () => {
    const liste = schicken || []
    if (!liste.length) return
    setArbeitet(true)
    const jetzt = new Date().toISOString()
    const fehler = [], ohneTg = [], tgFehler = []
    for (const n of liste) {
      const alt = map[n]
      const err = await steckbriefSpeichern(n, {
        einfuehrung_status: 'offen', geschickt_am: jetzt, geschickt_von: userName || null,
        einfuehrung_schritt: alt?.einfuehrung_status === 'fertig' ? null : (alt?.einfuehrung_schritt || null),
      }, userName)
      if (err) { fehler.push(`${n}: ${err.message}`); continue }
      if (mitTelegram) {
        const m = models.find(x => x.name === n)
        if (!m?.telegram_id) { ohneTg.push(n); continue }
        const text = tgText.replace(/\{name\}/g, n)
        try {
          const r = await sendTelegramMessage(m.telegram_id, text)
          const ok = zugestellt(r)
          await supabase.from('messages').insert({ model_name: n, model_telegram_id: m.telegram_id, direction: 'out', contact_type: 'model', message_type: 'announcement', text, status: ok ? 'sent' : 'failed', sent_by: userName })
          if (!ok) tgFehler.push(n)
        } catch { tgFehler.push(n) }
      }
    }
    logActivity('model.einfuehrung', { entity: liste.join(', '), detail: mitTelegram ? 'mit Telegram' : 'ohne Telegram' })
    setArbeitet(false); setSchicken(null); setMehrere(false); setAuswahl(new Set())
    neuLaden()
    const ok = liste.length - fehler.length
    alert([
      `✓ Einführung an ${ok} ${ok === 1 ? 'Model' : 'Models'} geschickt. Sie startet beim nächsten Öffnen des Portals.`,
      fehler.length ? `⚠ Nicht gespeichert: ${fehler.join('; ')}` : '',
      ohneTg.length ? `ℹ Ohne Telegram-ID (kein Hinweis verschickt): ${ohneTg.join(', ')}` : '',
      tgFehler.length ? `⚠ Telegram nicht angekommen: ${tgFehler.join(', ')}` : '',
    ].filter(Boolean).join('\n\n'))
  }

  const zuruecknehmen = async () => {
    if (!window.confirm(`Einführung für ${gewaehlt} zurücknehmen? Bereits eingetragene Antworten bleiben erhalten.`)) return
    const err = await steckbriefSpeichern(gewaehlt, { einfuehrung_status: null, einfuehrung_schritt: null }, userName)
    if (err) alert('Nicht gespeichert: ' + err.message)
    neuLaden()
  }

  const kopieren = async () => {
    const text = creatorHeroText(gewaehlt, zeile?.antworten, { services, nogos: board.nogos || [] })
    try { await navigator.clipboard.writeText(text); setKopiert(true); setTimeout(() => setKopiert(false), 2500) }
    catch { window.prompt('Kopieren ging nicht automatisch — hier markieren und kopieren:', text) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Mehrere auswählen */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Steckbrief-Einführung:</span>
        <button type="button" onClick={() => { setMehrere(v => !v); setAuswahl(new Set()) }} style={knopf('#7c3aed', mehrere)}>{mehrere ? 'Auswahl beenden' : '☑ Mehrere auswählen'}</button>
      </div>
      {mehrere && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(124,58,237,0.4)', borderRadius: 14, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 }}>
            {models.map(m => {
              const an = auswahl.has(m.name)
              return (
                <label key={m.id || m.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 10, cursor: 'pointer', background: an ? 'rgba(124,58,237,0.12)' : 'var(--bg-card2)', border: `1px solid ${an ? '#7c3aed' : 'var(--border)'}` }}>
                  <input type="checkbox" checked={an} onChange={() => setAuswahl(s => { const n = new Set(s); n.has(m.name) ? n.delete(m.name) : n.add(m.name); return n })} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                  <StatusPill zeile={map[m.name]} />
                </label>
              )
            })}
          </div>
          <button type="button" disabled={!auswahl.size} onClick={() => setSchicken([...auswahl])} style={{ ...knopf('#f59e0b', true), color: '#1a1205', alignSelf: 'flex-start', opacity: auswahl.size ? 1 : 0.5 }}>
            📝 Einführung an {auswahl.size || '…'} {auswahl.size === 1 ? 'Model' : 'Models'} schicken
          </button>
        </div>
      )}

      {/* Gewähltes Model */}
      {gewaehlt && !mehrere && (
        <SteckbriefAnsicht key={gewaehlt} name={gewaehlt} zeile={zeile} rechts={
          <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusPill zeile={zeile} />
            {laeuft
              ? <button type="button" onClick={zuruecknehmen} style={knopf('#ef4444', false)}>Zurücknehmen</button>
              : <button type="button" onClick={() => setSchicken([gewaehlt])} style={knopf('#f59e0b', false)}>📝 Einführung schicken</button>}
            <button type="button" onClick={() => setBearbeiten(true)} style={knopf('var(--text-secondary)', false)}>✏️ Bearbeiten</button>
            <button type="button" onClick={kopieren} style={knopf('#7c3aed', true)}>{kopiert ? '✓ Kopiert' : '📋 Für CreatorHero kopieren'}</button>
          </span>
        } />
      )}

      {/* Schicken-Fenster */}
      {schicken && (
        <div onClick={() => !arbeitet && setSchicken(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Einführung schicken" style={{ width: 'min(460px, 100%)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 20, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>Einführung schicken</div>
            <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              An: <b style={{ color: 'var(--text-primary)' }}>{schicken.join(', ')}</b><br />
              Beim nächsten Öffnen des Portals startet die Einführung. Was schon ausgefüllt ist, steht dann schon drin.
              {schicken.some(n => map[n]?.einfuehrung_status === 'fertig') && <><br /><span style={{ color: 'var(--ton-amber)' }}>Hinweis: {schicken.filter(n => map[n]?.einfuehrung_status === 'fertig').join(', ')} {schicken.filter(n => map[n]?.einfuehrung_status === 'fertig').length === 1 ? 'hat' : 'haben'} schon einmal abgeschlossen. Die Antworten bleiben, es geht nur nochmal durch.</span></>}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--text-primary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={mitTelegram} onChange={e => setMitTelegram(e.target.checked)} /> Zusätzlich per Telegram Bescheid geben
            </label>
            {mitTelegram && (
              <textarea value={tgText} onChange={e => setTgText(e.target.value)} rows={4} style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '10px 11px', borderRadius: 12, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.45 }} />
            )}
            {mitTelegram && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -6 }}>{'{name}'} wird durch den Namen ersetzt.</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" disabled={arbeitet} onClick={() => setSchicken(null)} style={{ ...knopf('var(--text-muted)', false), flex: 1, padding: 12 }}>Abbrechen</button>
              <button type="button" disabled={arbeitet} onClick={abschicken} style={{ ...knopf('#f59e0b', true), color: '#1a1205', flex: 2, padding: 12, fontSize: 14 }}>{arbeitet ? 'Schickt …' : `📝 An ${schicken.length} schicken`}</button>
            </div>
          </div>
        </div>
      )}

      {bearbeiten && gewaehlt && (
        <ModelEinfuehrung name={gewaehlt} zeile={zeile} art="bearbeiten" wer={userName}
          onGespeichert={neuLaden} onZu={() => { setBearbeiten(false); neuLaden() }} />
      )}
    </div>
  )
}
