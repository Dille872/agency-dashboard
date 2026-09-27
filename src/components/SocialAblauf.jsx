import React, { useState } from 'react'
import { supabase } from '../supabase'
import { sendTelegramMessage, zugestellt } from '../telegram'
import { logActivity } from '../activity'
import { statusVon, hatCutter, endVideo, schnittGilt, seitVon, linkOk, mitHttps } from '../reelSkripte'

// ── Schnitt und Freigabe (v4.106.0) ────────────────────────────────────────
// Zwei Listen im Social Media Manager:
//   SchnittListe  — für Cutter (Zusatzrolle cutter) und Admins: Rohvideo laden,
//                   Link zur fertigen Fassung einfügen.
//   FreigabeListe — für Admins und Zusatzrolle social_freigabe: fertiges Video
//                   ansehen, freigeben oder mit Notiz zurück an Cutter/Model.
// Welche Skripte jemand sieht, regelt die Datenbank (sql/social-schnitt.sql).

const P = '#ec4899', C = '#06b6d4', G = '#10b981', A = '#f59e0b', ROT = '#ef4444', V = '#a855f7', O = '#f97316'
const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 15px' }
const spalte = { background: 'var(--bg-card2)', borderRadius: 12, padding: '10px 11px', display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }
const klein = { fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }
const eingabe = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', width: '100%' }
const pill = (f) => ({ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: f + '22', color: f, whiteSpace: 'nowrap' })
const knopf = (f, voll) => ({ padding: '8px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', border: voll ? 'none' : `1px solid ${f}`, background: voll ? f : 'transparent', color: voll ? '#fff' : f, whiteSpace: 'nowrap' })
const tageSeit = (iso) => iso ? Math.max(0, Math.floor((Date.now() - new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).getTime()) / 86400000)) : null

function Kopf({ s, t, tr, seitText, farbe, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
      <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 800, color: C, fontSize: 12.5 }}>{s.nr}</span>
      <span style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--text-primary)', flex: 1, minWidth: 140 }}>{tr(s.titel)}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: P, background: 'rgba(236,72,153,0.12)', padding: '2px 9px', borderRadius: 10 }}>{s.model_name}{s.ziel_account ? ` → ${s.ziel_account}` : ''}</span>
      <span style={pill(farbe)}>{label} · {seitText(tageSeit(seitVon(s)))}</span>
    </div>
  )
}

function ZurueckHinweis({ s, t, an }) {
  if (s.zurueck_an !== an || !s.zurueck_notiz) return null
  return (
    <div style={{ fontSize: 12.5, color: 'var(--text-primary)', background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.45)', borderRadius: 10, padding: '8px 10px' }}>
      ↩ <b style={{ color: O }}>{t('zurueck_von', { wer: s.zurueck_von || '—' })}</b> {s.zurueck_notiz}
    </div>
  )
}

// ── Schnitt ────────────────────────────────────────────────────────────────
export function SchnittListe({ skripte, t, tr, datum, seitText, userDisplayName, onNeu }) {
  const liste = skripte.filter(s => statusVon(s) === 'schnitt').sort((a, b) => String(a.video_am).localeCompare(String(b.video_am)))
  const erledigt = skripte.filter(s => s.schnitt_von === userDisplayName && s.schnitt_am && tageSeit(s.schnitt_am) <= 7).length
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <div style={{ ...card, padding: '12px 14px' }}><div style={{ fontSize: 24, fontWeight: 800, color: V }}>{liste.length}</div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('kpi_schnitt')}</div></div>
        <div style={{ ...card, padding: '12px 14px' }}><div style={{ fontSize: 24, fontWeight: 800, color: G }}>{erledigt}</div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('kpi_geschnitten')}</div></div>
      </div>
      {!liste.length && <div style={{ ...card, color: 'var(--text-muted)', fontSize: 13.5 }}>{t('nichts_zu_schneiden')}</div>}
      {liste.map(s => <SchnittKarte key={s.id + ':' + s.aktualisiert_am} s={s} t={t} tr={tr} datum={datum} seitText={seitText} userDisplayName={userDisplayName} onNeu={onNeu} />)}
    </div>
  )
}

function SchnittKarte({ s, t, tr, datum, seitText, userDisplayName, onNeu }) {
  const [link, setLink] = useState('')
  const [fehler, setFehler] = useState('')
  const [arbeitet, setArbeitet] = useState(false)
  const speichern = async () => {
    const v = mitHttps(link)
    if (!linkOk(v)) { setFehler(t('fehler_link')); return }
    setArbeitet(true); setFehler('')
    const { error } = await supabase.from('reel_skripte').update({ schnitt_link: v, schnitt_am: new Date().toISOString(), schnitt_von: userDisplayName || null }).eq('id', s.id)
    setArbeitet(false)
    if (error) { setFehler(t('nicht_gespeichert', { fehler: error.message })); return }
    logActivity('reel.skript', { entity: `${s.model_name} ${s.nr}`, detail: 'geschnitten' })
    onNeu()
  }
  return (
    <div style={card}>
      <Kopf s={s} t={t} tr={tr} seitText={seitText} farbe={V} label={t('st_schnitt')} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        <div style={spalte}>
          <span style={klein}>{t('sp_material')}</span>
          {s.drehzettel_url && <a href={s.drehzettel_url} target="_blank" rel="noreferrer" style={{ color: C, fontWeight: 700, fontSize: 13 }}>{t('drehzettel')}</a>}
          <a href={s.video_link} target="_blank" rel="noreferrer" style={{ color: C, fontWeight: 700, fontSize: 13 }}>{t('rohvideo_laden')}</a>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{t('hochgeladen', { wer: s.video_von || s.model_name, datum: datum(s.video_am) })}</span>
        </div>
        <div style={spalte}>
          <span style={klein}>{t('sp_fertig')}</span>
          <ZurueckHinweis s={s} t={t} an="cutter" />
          <input value={link} onChange={e => setLink(e.target.value.slice(0, 500))} placeholder="https://www.dropbox.com/…" style={eingabe} autoCapitalize="none" autoCorrect="off" inputMode="url" />
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{t('schnitt_hinweis')}</span>
          <button type="button" disabled={arbeitet} onClick={speichern} style={{ ...knopf(V, true), alignSelf: 'flex-start' }}>{arbeitet ? t('speichert') : t('schnitt_fertig')}</button>
          {fehler && <span role="alert" style={{ fontSize: 12, color: ROT }}>{fehler}</span>}
        </div>
      </div>
    </div>
  )
}

// ── Freigabe ───────────────────────────────────────────────────────────────
export function FreigabeListe({ skripte, t, tr, datum, seitText, userDisplayName, onNeu }) {
  const liste = skripte.filter(s => statusVon(s) === 'pruefung').sort((a, b) => String(seitVon(a)).localeCompare(String(seitVon(b))))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {!liste.length && <div style={{ ...card, color: 'var(--text-muted)', fontSize: 13.5 }}>{t('nichts_freizugeben')}</div>}
      {liste.map(s => <FreigabeKarte key={s.id + ':' + s.aktualisiert_am} s={s} t={t} tr={tr} datum={datum} seitText={seitText} userDisplayName={userDisplayName} onNeu={onNeu} />)}
    </div>
  )
}

function FreigabeKarte({ s, t, tr, datum, seitText, userDisplayName, onNeu }) {
  const mitCutter = hatCutter(s) || !!s.schnitt_link
  const [zurueck, setZurueck] = useState(false)
  const [an, setAn] = useState(mitCutter ? 'cutter' : 'model')
  const [notiz, setNotiz] = useState('')
  const [telegram, setTelegram] = useState(true)
  const [fehler, setFehler] = useState('')
  const [arbeitet, setArbeitet] = useState(false)
  const geschnitten = schnittGilt(s)

  const freigeben = async () => {
    setArbeitet(true); setFehler('')
    const { error } = await supabase.from('reel_skripte').update({ freigabe_am: new Date().toISOString(), freigabe_von: userDisplayName || null }).eq('id', s.id)
    setArbeitet(false)
    if (error) { setFehler(t('nicht_gespeichert', { fehler: error.message })); return }
    logActivity('reel.skript', { entity: `${s.model_name} ${s.nr}`, detail: 'freigegeben' })
    onNeu()
  }
  const zurueckGeben = async () => {
    if (!notiz.trim()) { setFehler(t('notiz_pflicht')); return }
    setArbeitet(true); setFehler('')
    const { error } = await supabase.from('reel_skripte').update({ zurueck_an: an, zurueck_am: new Date().toISOString(), zurueck_von: userDisplayName || null, zurueck_notiz: notiz.trim().slice(0, 500) }).eq('id', s.id)
    if (error) { setArbeitet(false); setFehler(t('nicht_gespeichert', { fehler: error.message })); return }
    logActivity('reel.skript', { entity: `${s.model_name} ${s.nr}`, detail: `zurück an ${an}: ${notiz.trim().slice(0, 80)}` })
    if (an === 'model' && telegram) {
      try {
        const { data: m } = await supabase.from('models_contact').select('telegram_id').eq('name', s.model_name).maybeSingle()
        if (m?.telegram_id) {
          const text = `Hey ${s.model_name} 👋 zu ${s.nr} „${s.titel}“: bitte nochmal drehen. ${notiz.trim()}\n\nDen neuen Link bitte im Portal unter „Social“ einfügen. Danke! 💛`
          const r = await sendTelegramMessage(m.telegram_id, text)
          await supabase.from('messages').insert({ model_name: s.model_name, model_telegram_id: m.telegram_id, direction: 'out', contact_type: 'model', message_type: 'announcement', text, status: zugestellt(r) ? 'sent' : 'failed', sent_by: userDisplayName })
        }
      } catch { /* Telegram ist nur ein Zusatz */ }
    }
    setArbeitet(false)
    onNeu()
  }

  return (
    <div style={card}>
      <Kopf s={s} t={t} tr={tr} seitText={seitText} farbe={O} label={t('st_pruefung')} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        <div style={spalte}>
          <span style={klein}>{t('sp_ansehen')}</span>
          <a href={endVideo(s)} target="_blank" rel="noreferrer" style={{ color: C, fontWeight: 800, fontSize: 14 }}>{t('fertiges_video')}</a>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            {geschnitten ? t('geschnitten_von', { wer: s.schnitt_von || '—', datum: datum(s.schnitt_am) }) : t('ungeschnitten', { wer: s.video_von || s.model_name, datum: datum(s.video_am) })}
          </span>
          {geschnitten && <a href={s.video_link} target="_blank" rel="noreferrer" style={{ color: 'var(--text-muted)', fontSize: 12 }}>{t('rohvideo_laden')}</a>}
          {s.drehzettel_url && <a href={s.drehzettel_url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-muted)', fontSize: 12 }}>{t('drehzettel')}</a>}
        </div>
        <div style={spalte}>
          <span style={klein}>{t('sp_entscheidung')}</span>
          {!zurueck ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" disabled={arbeitet} onClick={freigeben} style={{ ...knopf(G, true), color: '#04140e', padding: '10px 14px' }}>{t('freigeben')}</button>
              <button type="button" disabled={arbeitet} onClick={() => setZurueck(true)} style={{ ...knopf(O, false), padding: '10px 14px' }}>{t('zurueck')}</button>
            </div>
          ) : (
            <>
              {mitCutter ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {['cutter', 'model'].map(x => (
                    <button key={x} type="button" onClick={() => setAn(x)} style={{ ...knopf(O, an === x), padding: '6px 10px', fontSize: 12 }}>{t(x === 'cutter' ? 'zurueck_an_cutter' : 'zurueck_an_model')}</button>
                  ))}
                </div>
              ) : <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('zurueck_an_model')}</span>}
              <textarea value={notiz} onChange={e => setNotiz(e.target.value)} rows={3} placeholder={t('notiz_platzhalter')} style={{ ...eingabe, resize: 'vertical', lineHeight: 1.45 }} />
              {an === 'model' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-primary)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={telegram} onChange={e => setTelegram(e.target.checked)} /> {t('model_telegram')}
                </label>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" disabled={arbeitet} onClick={zurueckGeben} style={{ ...knopf(O, true) }}>{arbeitet ? t('speichert') : t('zurueck_senden')}</button>
                <button type="button" disabled={arbeitet} onClick={() => { setZurueck(false); setFehler('') }} style={knopf('var(--text-muted)', false)}>{t('abbrechen')}</button>
              </div>
            </>
          )}
          {fehler && <span role="alert" style={{ fontSize: 12, color: ROT }}>{fehler}</span>}
        </div>
      </div>
    </div>
  )
}
