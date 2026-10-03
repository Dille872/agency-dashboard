import React, { useEffect, useRef, useState } from 'react'
import { MImg, MA } from './Medien' // v5.33.0: private Dateien
import { supabase } from '../supabase'
import { sendTelegramMessage, zugestellt } from '../telegram'
import { logActivity } from '../activity'
import { resolvePlatform, SOCIAL_CATEGORY } from './SocialLinks'
import { FRAGEN, BOARD_CHECK, socialLaden, serviceSpeichern, stand, hatWert, wertText, datumKurz } from '../socialProfil'
import { agenturAccountAnlegen } from '../reelSkripte' // v4.104.0
import SocialFragebogen from './SocialFragebogen'

// ── Admin: Social-Media-Fragebogen & Service je Model (v4.100.0) ───────────
// Sitzt in Kommunikation → Creator → Models, unter dem Steckbrief.
//   • „Social-Media-Fragebogen schicken“ → Status 'offen' (und Service an,
//     v4.102.0: den Fragebogen gibt es nur für Models im Service). Beim nächsten Öffnen des Portals
//     startet der Fragebogen. Optional Telegram-Hinweis. Nie automatisch.
//   • Zurücknehmen, solange nicht fertig (Antworten bleiben).
//   • Antworten lesen (mit „geändert am“), selbst nachtragen.
//   • Nur Agentur: Service aktiv, „Posting ab“ (Start der Erfolgsmessung).
//     Die Accounts werden NICHT hier gepflegt: Es gelten die Instagram-Links,
//     die das Model selbst im Board einträgt (model_board, category
//     social_media) — hier nur angezeigt. Der Social-Tab (social_accounts)
//     ist für eigene Mitarbeiter-Accounts und hat damit nichts zu tun.

const P = '#ec4899'
const STATUS = {
  offen: { t: 'geschickt', f: '#f59e0b' },
  laeuft: { t: 'läuft', f: '#06b6d4' },
  fertig: { t: 'fertig', f: '#10b981' },
}
const knopf = (farbe, voll) => ({ padding: '8px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', border: voll ? 'none' : `1px solid ${farbe}`, background: voll ? farbe : 'transparent', color: voll ? '#fff' : farbe, whiteSpace: 'nowrap' })
const eingabe = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }
// @handle aus einem Instagram-Link (Tracking-Anhänge wie ?igsh=… fallen weg)
const instaHandle = (url) => {
  const m = String(url || '').match(/instagram\.com\/([^/?#]+)/i)
  return m ? '@' + m[1] : String(url || '').trim()
}
const TG_TEXT = 'Hey {name} 👋 Wir starten mit Reels für dich! Bitte öffne einmal dein Portal und füll den kurzen Social-Media-Fragebogen aus, dauert ca. 10 Minuten. Danke! 💛'

export function SocialStatusPill({ service, antworten }) {
  const st = STATUS[service?.fragebogen_status]
  const s = stand(antworten)
  if (!st) return <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'var(--bg-card2)', color: 'var(--text-muted)' }}>{s.voll ? `Fragebogen ${s.voll}/${s.gesamt}` : 'nicht geschickt'}</span>
  const wann = service.fragebogen_status === 'fertig' ? datumKurz(service.fertig_am) : service.fragebogen_status === 'offen' ? datumKurz(service.angefordert_am) : `${s.voll}/${s.gesamt}`
  return <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: st.f + '22', color: st.f }}>{st.t}{wann ? ` · ${wann}` : ''}</span>
}

function Antwort({ wert, typ }) {
  if (!hatWert(wert)) return <span style={{ color: 'var(--text-muted)' }}>—</span>
  if (typ === 'bilder') return (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {wert.map(u => <MA key={u} href={u} target="_blank" rel="noreferrer"><MImg src={u} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} /></MA>)}
    </span>
  )
  if (typ === 'links') return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {wert.filter(x => String(x || '').trim()).map((u, i) => <a key={i} href={/^https?:\/\//i.test(u) ? u : `https://${u}`} target="_blank" rel="noreferrer" style={{ color: P, wordBreak: 'break-all' }}>{u}</a>)}
    </span>
  )
  if (typ === 'skala') return <span>{wert} / 5</span>
  return <span style={{ whiteSpace: 'pre-wrap' }}>{wertText(wert)}</span>
}

export default function SocialFragebogenAdmin({ models = [], gewaehlt, userName, startOffen = false, onGeaendert }) {
  const ersteLadung = useRef(true) // v4.108.0: Liste links erst nach Änderungen neu laden
  const [daten, setDaten] = useState(null)
  const [offen, setOffen] = useState(startOffen)
  const [schicken, setSchicken] = useState(false)
  const [mitTelegram, setMitTelegram] = useState(true)
  const [tgText, setTgText] = useState(TG_TEXT)
  const [arbeitet, setArbeitet] = useState(false)
  const [bearbeiten, setBearbeiten] = useState(false)
  // Agentur-Felder (Entwurf, gespeichert per Knopf)
  const [aktiv, setAktiv] = useState(false)
  const [accounts, setAccounts] = useState([])   // Instagram-Links aus dem Board, nur Anzeige
  const [postingAb, setPostingAb] = useState('')
  const [notizen, setNotizen] = useState({})     // v4.102.0: @handle → „DE · Hauptaccount“
  const [neuAcc, setNeuAcc] = useState(null)     // v4.104.0: „+ Account“ (null = zu)
  const [neuHinweis, setNeuHinweis] = useState('')
  const [agenturHinweis, setAgenturHinweis] = useState('')

  const laden = async () => {
    if (!gewaehlt) { setDaten(null); return }
    const [d, acc] = await Promise.all([
      socialLaden(gewaehlt),
      supabase.from('model_board').select('title, content').eq('model_name', gewaehlt).eq('category', SOCIAL_CATEGORY).order('sort_order'),
    ])
    setDaten(d)
    setAktiv(!!d.service?.service_aktiv)
    setAccounts((acc.data || []).filter(a => resolvePlatform(a.title).key === 'instagram' && String(a.content || '').trim()))
    setPostingAb(d.service?.posting_ab || '')
    setNotizen({ ...(d.service?.account_notizen || {}) })
    setAgenturHinweis('')
    if (ersteLadung.current) ersteLadung.current = false; else onGeaendert?.()
  }
  useEffect(() => { laden() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gewaehlt])

  if (!gewaehlt || !daten) return null
  if (daten.fehlt) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '10px 12px', borderRadius: 10, border: '1px dashed var(--border)' }}>
        Social-Media-Fragebogen: Tabellen fehlen noch. Einmal <code>sql/model-social-profil.sql</code> in Supabase ausführen.
      </div>
    )
  }

  const service = daten.service
  const status = service?.fragebogen_status
  const laeuft = status === 'offen' || status === 'laeuft'
  const s = stand(daten.antworten)

  const anfordern = async () => {
    setArbeitet(true)
    // v4.102.0: Fragebogen gibt es nur im Service — wer noch nicht drin ist, wird dabei aufgenommen.
    const err = await serviceSpeichern(gewaehlt, { fragebogen_status: 'offen', angefordert_am: new Date().toISOString(), angefordert_von: userName || null, ...(service?.service_aktiv ? {} : { service_aktiv: true }) }, userName)
    let info = ''
    if (err) info = '⚠ Nicht gespeichert: ' + err.message
    else if (mitTelegram) {
      const m = models.find(x => x.name === gewaehlt)
      if (!m?.telegram_id) info = 'ℹ Keine Telegram-ID, Hinweis nicht verschickt.'
      else {
        const text = tgText.replace(/\{name\}/g, gewaehlt)
        try {
          const r = await sendTelegramMessage(m.telegram_id, text)
          const ok = zugestellt(r)
          await supabase.from('messages').insert({ model_name: gewaehlt, model_telegram_id: m.telegram_id, direction: 'out', contact_type: 'model', message_type: 'announcement', text, status: ok ? 'sent' : 'failed', sent_by: userName })
          if (!ok) info = '⚠ Telegram nicht angekommen.'
        } catch { info = '⚠ Telegram nicht angekommen.' }
      }
    }
    if (!err) logActivity('model.social_fragebogen', { entity: gewaehlt, detail: mitTelegram ? 'mit Telegram' : 'ohne Telegram' })
    setArbeitet(false); setSchicken(false)
    await laden()
    alert([err ? '' : `✓ Social-Media-Fragebogen an ${gewaehlt} geschickt. Er startet beim nächsten Öffnen des Portals.`, info].filter(Boolean).join('\n\n'))
  }

  const zuruecknehmen = async () => {
    if (!window.confirm(`Fragebogen für ${gewaehlt} zurücknehmen? Bereits eingetragene Antworten bleiben erhalten.`)) return
    const err = await serviceSpeichern(gewaehlt, { fragebogen_status: null }, userName)
    if (err) alert('Nicht gespeichert: ' + err.message)
    laden()
  }

  const instagram = accounts
  const notizenSauber = () => Object.fromEntries(Object.entries(notizen).map(([k, v]) => [k, String(v || '').trim().slice(0, 60)]).filter(([, v]) => v))
  const agenturSpeichern = async () => {
    if (aktiv && !instagram.length && !window.confirm('Service aktiv, aber im Board steht noch kein Instagram-Link. Trotzdem speichern?')) return
    if (!aktiv && service?.service_aktiv && laeuft && !window.confirm(`${gewaehlt} aus dem Service nehmen? Der offene Fragebogen wird dann nicht mehr angezeigt (Antworten bleiben).`)) return
    const err = await serviceSpeichern(gewaehlt, { service_aktiv: aktiv, posting_ab: postingAb || null, account_notizen: notizenSauber(), ...(!aktiv && laeuft ? { fragebogen_status: null } : {}) }, userName)
    if (err) { setAgenturHinweis('⚠ Nicht gespeichert: ' + err.message); return }
    logActivity('model.social_service', { entity: gewaehlt, detail: `${aktiv ? 'aktiv' : 'inaktiv'}${postingAb ? ' · ab ' + postingAb : ''}` })
    await laden()
    setAgenturHinweis('✓ Gespeichert')
  }
  const agenturGeaendert = aktiv !== !!service?.service_aktiv
    || (postingAb || '') !== (service?.posting_ab || '')
    || JSON.stringify(notizenSauber()) !== JSON.stringify(Object.fromEntries(Object.entries(service?.account_notizen || {}).filter(([, v]) => String(v || '').trim())))

  return (
    <div style={{ background: 'var(--bg-card)', border: `1px solid ${service?.service_aktiv ? 'rgba(236,72,153,0.45)' : 'var(--border)'}`, borderRadius: 14, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setOffen(v => !v)} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 180, textAlign: 'left' }}>
          <span style={{ fontSize: 18 }}>📱</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Social Media · {gewaehlt}</span>
          {service?.service_aktiv && <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: 'rgba(236,72,153,0.15)', color: P }}>im Service</span>}
          <SocialStatusPill service={service} antworten={daten.antworten} />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{offen ? '▲' : '▼'}</span>
        </button>
        {laeuft
          ? <button type="button" onClick={zuruecknehmen} style={knopf('#ef4444', false)}>Zurücknehmen</button>
          : <button type="button" onClick={() => setSchicken(true)} style={knopf(P, false)}>📱 Social-Media-Fragebogen schicken</button>}
        <button type="button" onClick={() => setBearbeiten(true)} style={knopf('var(--text-secondary)', false)}>✏️ Nachtragen</button>
      </div>

      {offen && (
        <>
          {/* Agentur-Felder */}
          <div style={{ background: 'var(--bg-card2)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Nur Agentur · liest die Reels-Pipeline</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--text-primary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={aktiv} onChange={e => setAktiv(e.target.checked)} /> Im Social-Media-Service (Pipeline schreibt Skripte)
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Instagram (trägt das Model im Board ein)</div>
                {accounts.length ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {accounts.map((a, i) => {
                      const h = instaHandle(a.content)
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <a href={/^https?:\/\//i.test(a.content) ? a.content : `https://${a.content}`} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: P, fontWeight: 700, minWidth: 110 }}>{h}</a>
                          <input value={notizen[h] || ''} onChange={e => setNotizen(n => ({ ...n, [h]: e.target.value }))} placeholder="z. B. DE · Hauptaccount" style={{ ...eingabe, flex: 1, minWidth: 140, padding: '6px 9px', fontSize: 12.5 }} />
                        </div>
                      )
                    })}
                  </div>
                ) : <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Noch kein Instagram-Link im Board.</div>}
                {/* v4.104.0: eigenen Account anlegen (z. B. US) — landet im Board, markiert als „Agentur“ */}
                {neuAcc === null ? (
                  <button type="button" onClick={() => { setNeuAcc(''); setNeuHinweis('') }} style={{ ...knopf(P, false), marginTop: 6, padding: '4px 10px', fontSize: 12 }}>+ Account</button>
                ) : (
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    <input autoFocus value={neuAcc} onChange={e => setNeuAcc(e.target.value.slice(0, 200))} placeholder="@name oder Instagram-Link" style={{ ...eingabe, flex: 1, minWidth: 160, padding: '6px 9px', fontSize: 12.5 }}
                      onKeyDown={e => { if (e.key === 'Escape') setNeuAcc(null) }} />
                    <button type="button" onClick={async () => {
                      const r = await agenturAccountAnlegen(gewaehlt, neuAcc, userName)
                      if (r.fehler) { setNeuHinweis(r.fehler); return }
                      const entwurf = notizen; await laden(); setNotizen(n => ({ ...n, ...entwurf })); setNeuAcc(null); setNeuHinweis(`✓ ${r.handle} angelegt. Kurzbeschreibung eintragen und speichern.`)
                    }} style={{ ...knopf(P, true), padding: '6px 11px', fontSize: 12 }}>Anlegen</button>
                    <button type="button" onClick={() => setNeuAcc(null)} style={{ ...knopf('var(--text-muted)', false), padding: '6px 11px', fontSize: 12 }}>Abbrechen</button>
                  </div>
                )}
                {neuHinweis && <div style={{ fontSize: 11.5, marginTop: 4, color: neuHinweis.startsWith('✓') ? '#10b981' : 'var(--ton-rot)' }}>{neuHinweis}</div>}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Links pflegt das Model im Board unter „Social Media Kanäle“. Mit „+ Account“ legst du selbst einen an (z. B. US), er steht dann auch im Board, markiert als „Agentur“, und nur ihr könnt ihn ändern. Die Kurzbeschreibung sehen Poster und Model beim Drehzettel.</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Posting ab (Start der Erfolgsmessung)</div>
                <input type="date" value={postingAb} onChange={e => setPostingAb(e.target.value)} style={{ ...eingabe, width: '100%' }} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button type="button" disabled={!agenturGeaendert} onClick={agenturSpeichern} style={{ ...knopf(P, true), opacity: agenturGeaendert ? 1 : 0.5 }}>Speichern</button>
              {agenturHinweis && <span style={{ fontSize: 12, color: agenturHinweis.startsWith('✓') ? '#10b981' : 'var(--ton-rot)' }}>{agenturHinweis}</span>}
              {service?.aktualisiert_am && !agenturHinweis && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>zuletzt {datumKurz(service.aktualisiert_am)}{service.aktualisiert_von ? ` · ${service.aktualisiert_von}` : ''}</span>}
            </div>
          </div>

          {/* Antworten */}
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.voll} von {s.gesamt} Fragen beantwortet</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[{ key: BOARD_CHECK.key, label: 'Board (No Gos, Instagram) aktuell?', typ: 'text' }, ...FRAGEN].map(f => {
              const z = daten.antworten[f.key]
              return (
                <div key={f.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 220px) 1fr', gap: 10, fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ color: 'var(--text-muted)' }}>
                    {f.label}
                    {z?.geaendert_am && hatWert(z.antwort) && <div style={{ fontSize: 10.5, marginTop: 2 }}>{datumKurz(z.geaendert_am)}{z.geaendert_von && z.geaendert_von !== gewaehlt ? ` · ${z.geaendert_von}` : ''}</div>}
                  </div>
                  <div style={{ color: 'var(--text-primary)', minWidth: 0 }}><Antwort wert={z?.antwort} typ={f.typ} /></div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {schicken && (
        <div onClick={() => !arbeitet && setSchicken(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Social-Media-Fragebogen schicken" style={{ width: 'min(460px, 100%)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 20, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>Social-Media-Fragebogen schicken</div>
            <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              An: <b style={{ color: 'var(--text-primary)' }}>{gewaehlt}</b><br />
              Beim nächsten Öffnen des Portals startet der Fragebogen. Was schon beantwortet ist, steht dann schon drin.
              {!service?.service_aktiv && <><br /><span style={{ color: P, fontWeight: 700 }}>{gewaehlt} wird dabei in den Social-Media-Service aufgenommen.</span></>}
              {status === 'fertig' && <><br /><span style={{ color: 'var(--ton-amber)' }}>Hinweis: {gewaehlt} hat schon einmal abgeschlossen. Die Antworten bleiben, es geht nur nochmal durch.</span></>}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--text-primary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={mitTelegram} onChange={e => setMitTelegram(e.target.checked)} /> Zusätzlich per Telegram Bescheid geben
            </label>
            {mitTelegram && <textarea value={tgText} onChange={e => setTgText(e.target.value)} rows={4} style={{ ...eingabe, fontSize: 13, resize: 'vertical', lineHeight: 1.45 }} />}
            {mitTelegram && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -6 }}>{'{name}'} wird durch den Namen ersetzt.</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" disabled={arbeitet} onClick={() => setSchicken(false)} style={{ ...knopf('var(--text-muted)', false), flex: 1, padding: 12 }}>Abbrechen</button>
              <button type="button" disabled={arbeitet} onClick={anfordern} style={{ ...knopf(P, true), flex: 2, padding: 12, fontSize: 14 }}>{arbeitet ? 'Schickt …' : '📱 Schicken'}</button>
            </div>
          </div>
        </div>
      )}

      {bearbeiten && (
        <SocialFragebogen name={gewaehlt} daten={daten} art="admin" wer={userName}
          onZu={() => { setBearbeiten(false); laden() }} />
      )}
    </div>
  )
}
