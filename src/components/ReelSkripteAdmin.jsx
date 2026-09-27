import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { sendTelegramMessage, zugestellt } from '../telegram'
import { logActivity } from '../activity'
import { resolvePlatform, SOCIAL_CATEGORY } from './SocialLinks'
import { STATUS, statusVon, skripteLaden, skriptAendern, drehzettelHochladen, linkOk, mitHttps, instaHandle, tagKurz } from '../reelSkripte'

// ── Admin: Reel-Skripte je Model (v4.101.0) ────────────────────────────────
// Sitzt in Kommunikation → Creator → Models, unter „Social Media“.
// Eine Karte je Skript, von links nach rechts:
//   📄 Drehzettel (PDF, hier hochladen → Nummer S-…)
//   🎬 Video (Link, den das Model im Portal hinterlegt — Dropbox o. Ä.)
//   ✅ Gepostet (Account aus den Instagram-Links im Board, Reel-Link, Datum)
// v4.102.0: Ziel-Account wird beim Anlegen festgelegt (Pflicht, sobald das
// Model Instagram-Links im Board hat) und ist auf der Karte änderbar.
// Später soll der Mitarbeiter, der postet, den rechten Teil selbst ausfüllen.

const R = '#06b6d4'
const knopf = (farbe, voll) => ({ padding: '7px 11px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', border: voll ? 'none' : `1px solid ${farbe}`, background: voll ? farbe : 'transparent', color: voll ? '#fff' : farbe, whiteSpace: 'nowrap' })
const eingabe = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 9, fontSize: 12.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', width: '100%' }
const spalte = { background: 'var(--bg-card2)', borderRadius: 11, padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }
const klein = { fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }
const heute = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
const TG_TEXT = 'Neuer Drehzettel {nr} 🎬 „{titel}“{fuer}. Du findest ihn in deinem Portal unter „Social“. Wenn das Video fertig ist, dort einfach den Link (z. B. Dropbox) einfügen. Danke! 💛'

function Pill({ s }) {
  const st = STATUS[statusVon(s)]
  return <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: st.f + '22', color: st.f, whiteSpace: 'nowrap' }}>{st.icon} {st.t}</span>
}

function Karte({ s, accounts, userName, onNeu }) {
  const status = statusVon(s)
  const [videoEdit, setVideoEdit] = useState(false)
  const [video, setVideo] = useState(s.video_link || '')
  const [postEdit, setPostEdit] = useState(false)
  const [reel, setReel] = useState(s.reel_url || '')
  const [account, setAccount] = useState(s.account || s.ziel_account || (accounts.length === 1 ? accounts[0] : ''))
  const [zielEdit, setZielEdit] = useState(false)
  const [datum, setDatum] = useState(s.gepostet_am || heute())
  const [fehler, setFehler] = useState('')
  const [arbeitet, setArbeitet] = useState(false)

  const speichere = async (felder, log) => {
    setArbeitet(true); setFehler('')
    const err = await skriptAendern(s.id, felder)
    setArbeitet(false)
    if (err) { setFehler('Nicht gespeichert: ' + err.message); return false }
    if (log) logActivity('reel.skript', { entity: `${s.model_name} ${s.nr}`, detail: log })
    onNeu()
    return true
  }

  const videoSpeichern = async () => {
    const v = mitHttps(video)
    if (v && !linkOk(v)) { setFehler('Das sieht nicht nach einem Link aus.'); return }
    if (await speichere(v ? { video_link: v, video_am: new Date().toISOString(), video_von: userName || null } : { video_link: null, video_am: null, video_von: null }, v ? 'Video-Link eingetragen' : 'Video-Link entfernt')) setVideoEdit(false)
  }

  const posten = async () => {
    const r = mitHttps(reel)
    if (!linkOk(r) || !/instagram\.com\//i.test(r)) { setFehler('Bitte den Instagram-Link zum Reel einfügen.'); return }
    if (!account) { setFehler('Bitte den Account wählen.'); return }
    if (await speichere({ reel_url: r, account, gepostet_am: datum || heute(), gepostet_von: userName || null }, `gepostet auf ${account}`)) setPostEdit(false)
  }

  const postenZurueck = async () => {
    if (!window.confirm(`„Gepostet“ bei ${s.nr} zurücknehmen? Reel-Link, Account und Datum werden geleert.`)) return
    speichere({ reel_url: null, account: null, gepostet_am: null, gepostet_von: null }, 'gepostet zurückgenommen')
  }

  const zielSetzen = async (neu) => {
    if (await speichere({ ziel_account: neu || null }, `Ziel-Account ${neu || 'entfernt'}`)) setZielEdit(false)
  }

  const verwerfen = async () => {
    if (!s.verworfen && !window.confirm(`${s.nr} „${s.titel}“ verwerfen? Es bleibt gespeichert und kann wiederhergestellt werden.`)) return
    speichere({ verworfen: !s.verworfen }, s.verworfen ? 'wiederhergestellt' : 'verworfen')
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 13, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, opacity: s.verworfen ? 0.55 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: R, fontFamily: 'ui-monospace, monospace' }}>{s.nr}</span>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', flex: 1, minWidth: 120 }}>{s.titel}</span>
        {s.ziel_account && <span style={{ fontSize: 11.5, fontWeight: 700, color: '#ec4899', background: 'rgba(236,72,153,0.12)', padding: '2px 8px', borderRadius: 10 }}>→ {s.ziel_account}</span>}
        <Pill s={s} />
        <button type="button" onClick={verwerfen} disabled={arbeitet} style={{ ...knopf('var(--text-muted)', false), padding: '4px 9px', fontSize: 11.5 }}>{s.verworfen ? 'Wiederherstellen' : 'Verwerfen'}</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
        {/* 1. Drehzettel */}
        <div style={spalte}>
          <span style={klein}>📄 Drehzettel</span>
          {s.drehzettel_url
            ? <a href={s.drehzettel_url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: R, fontWeight: 700 }}>PDF öffnen</a>
            : <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>keine Datei</span>}
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tagKurz(s.erstellt_am)}{s.erstellt_von ? ` · ${s.erstellt_von}` : ''}</span>
          {!s.reel_url && !s.verworfen && (zielEdit ? (
            <select autoFocus defaultValue={s.ziel_account || ''} onChange={e => zielSetzen(e.target.value)} onBlur={() => setZielEdit(false)} style={eingabe}>
              <option value="">— kein Ziel —</option>
              {accounts.map(a => <option key={a} value={a}>{a}</option>)}
              {s.ziel_account && !accounts.includes(s.ziel_account) && <option value={s.ziel_account}>{s.ziel_account}</option>}
            </select>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Ziel: {s.ziel_account || '—'} · <button type="button" onClick={() => setZielEdit(true)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>ändern</button></span>
          ))}
        </div>

        {/* 2. Video */}
        <div style={spalte}>
          <span style={klein}>🎬 Video</span>
          {s.video_link && !videoEdit ? (
            <>
              <a href={s.video_link} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: R, fontWeight: 700 }}>⬇ Video öffnen / laden</a>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tagKurz(s.video_am)}{s.video_von && s.video_von !== s.model_name ? ` · ${s.video_von}` : ''} · <button type="button" onClick={() => setVideoEdit(true)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>ändern</button></span>
            </>
          ) : videoEdit ? (
            <>
              <input value={video} onChange={e => setVideo(e.target.value.slice(0, 500))} placeholder="https://www.dropbox.com/…" style={eingabe} autoCapitalize="none" autoCorrect="off" />
              <span style={{ display: 'flex', gap: 6 }}>
                <button type="button" disabled={arbeitet} onClick={videoSpeichern} style={knopf(R, true)}>Speichern</button>
                <button type="button" onClick={() => { setVideoEdit(false); setVideo(s.video_link || '') }} style={knopf('var(--text-muted)', false)}>Abbrechen</button>
              </span>
            </>
          ) : (
            <>
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>wartet auf {s.model_name}</span>
              {!s.verworfen && <button type="button" onClick={() => setVideoEdit(true)} style={{ ...knopf('var(--text-muted)', false), alignSelf: 'flex-start', padding: '4px 9px', fontSize: 11.5 }}>Link selbst eintragen</button>}
            </>
          )}
        </div>

        {/* 3. Gepostet */}
        <div style={spalte}>
          <span style={klein}>✅ Gepostet</span>
          {s.reel_url && !postEdit ? (
            <>
              <a href={s.reel_url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: '#10b981', fontWeight: 700 }}>Reel ansehen</a>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.account} · {tagKurz(s.gepostet_am)}{s.gepostet_von ? ` · ${s.gepostet_von}` : ''}</span>
              {s.ziel_account && s.account && s.ziel_account !== s.account && <span style={{ fontSize: 11, color: 'var(--ton-amber)' }}>abweichend vom Ziel {s.ziel_account}</span>}
              <span style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setPostEdit(true)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>ändern</button>
                <button type="button" onClick={postenZurueck} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>zurücknehmen</button>
              </span>
            </>
          ) : s.verworfen ? (
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>—</span>
          ) : (
            <>
              {accounts.length
                ? <select value={account} onChange={e => setAccount(e.target.value)} style={eingabe}>
                    <option value="">Account wählen …</option>
                    {accounts.map(a => <option key={a} value={a}>{a}</option>)}
                    {account && !accounts.includes(account) && <option value={account}>{account}</option>}
                  </select>
                : <span style={{ fontSize: 11.5, color: 'var(--ton-amber)' }}>Kein Instagram-Link im Board.</span>}
              <input value={reel} onChange={e => setReel(e.target.value.slice(0, 500))} placeholder="https://www.instagram.com/reel/…" style={eingabe} autoCapitalize="none" autoCorrect="off" />
              <input type="date" value={datum} onChange={e => setDatum(e.target.value)} style={eingabe} />
              <span style={{ display: 'flex', gap: 6 }}>
                <button type="button" disabled={arbeitet || !accounts.length} onClick={posten} style={{ ...knopf('#10b981', true), opacity: accounts.length ? 1 : 0.5 }}>Gepostet ✓</button>
                {postEdit && <button type="button" onClick={() => { setPostEdit(false); setReel(s.reel_url || ''); setAccount(s.account || ''); setDatum(s.gepostet_am || heute()) }} style={knopf('var(--text-muted)', false)}>Abbrechen</button>}
              </span>
            </>
          )}
        </div>
      </div>
      {fehler && <div role="alert" style={{ fontSize: 12, color: 'var(--ton-rot)' }}>{fehler}</div>}
    </div>
  )
}

export default function ReelSkripteAdmin({ models = [], gewaehlt, userName }) {
  const [daten, setDaten] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [offen, setOffen] = useState(true)
  const [nurOffene, setNurOffene] = useState(true)
  const [neu, setNeu] = useState(false)
  const [titel, setTitel] = useState('')
  const [ziel, setZiel] = useState('')
  const [datei, setDatei] = useState(null)
  const [mitTelegram, setMitTelegram] = useState(true)
  const [arbeitet, setArbeitet] = useState(false)
  const [hinweis, setHinweis] = useState('')
  const dateiRef = useRef(null)

  const laden = async () => {
    if (!gewaehlt) return
    const [d, b] = await Promise.all([
      skripteLaden(gewaehlt),
      supabase.from('model_board').select('title, content').eq('model_name', gewaehlt).eq('category', SOCIAL_CATEGORY).order('sort_order'),
    ])
    setDaten(d)
    setAccounts([...new Set((b.data || []).filter(x => resolvePlatform(x.title).key === 'instagram' && String(x.content || '').trim()).map(x => instaHandle(x.content)))])
  }
  useEffect(() => { laden() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gewaehlt])

  if (!gewaehlt || !daten) return null
  if (daten.fehlt) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '10px 12px', borderRadius: 10, border: '1px dashed var(--border)' }}>
        Reel-Skripte: Tabelle fehlt noch. Einmal <code>sql/reel-skripte.sql</code> in Supabase ausführen.
      </div>
    )
  }

  const liste = daten.liste
  const zaehl = (st) => liste.filter(s => statusVon(s) === st).length
  const sichtbar = nurOffene ? liste.filter(s => !['gepostet', 'verworfen'].includes(statusVon(s))) : liste

  const anlegen = async () => {
    const t = titel.trim()
    if (!t) { setHinweis('Bitte einen kurzen Titel eingeben.'); return }
    if (!datei) { setHinweis('Bitte den Drehzettel (PDF) auswählen.'); return }
    const zielWert = ziel || (accounts.length === 1 ? accounts[0] : '')
    if (accounts.length && !zielWert) { setHinweis('Bitte wählen, auf welchem Account das Reel laufen soll.'); return }
    setArbeitet(true); setHinweis('')
    const up = await drehzettelHochladen(gewaehlt, datei)
    if (up.fehler) { setArbeitet(false); setHinweis('PDF ging nicht hoch: ' + up.fehler.message); return }
    const { data, error } = await supabase.from('reel_skripte')
      .insert({ model_name: gewaehlt, titel: t.slice(0, 120), drehzettel_url: up.url, ziel_account: zielWert || null, erstellt_von: userName || null })
      .select('nr').single()
    if (error) { setArbeitet(false); setHinweis('Nicht gespeichert: ' + error.message); return }
    logActivity('reel.skript', { entity: `${gewaehlt} ${data.nr}`, detail: `Drehzettel „${t}“` })
    let info = ''
    if (mitTelegram) {
      const m = models.find(x => x.name === gewaehlt)
      if (!m?.telegram_id) info = ' Keine Telegram-ID, kein Hinweis verschickt.'
      else {
        const text = TG_TEXT.replace('{nr}', data.nr).replace('{titel}', t).replace('{fuer}', zielWert ? ` für ${zielWert}` : '')
        try {
          const r = await sendTelegramMessage(m.telegram_id, text)
          const ok = zugestellt(r)
          await supabase.from('messages').insert({ model_name: gewaehlt, model_telegram_id: m.telegram_id, direction: 'out', contact_type: 'model', message_type: 'announcement', text, status: ok ? 'sent' : 'failed', sent_by: userName })
          if (!ok) info = ' ⚠ Telegram nicht angekommen.'
        } catch { info = ' ⚠ Telegram nicht angekommen.' }
      }
    }
    setArbeitet(false); setNeu(false); setTitel(''); setDatei(null); setZiel('')
    setHinweis(`✓ ${data.nr} angelegt.${info}`)
    laden()
  }

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setOffen(v => !v)} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 180, textAlign: 'left', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 18 }}>🎬</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Reels · {gewaehlt}</span>
          {['freigegeben', 'gedreht', 'gepostet'].map(st => zaehl(st) > 0 && (
            <span key={st} style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: STATUS[st].f + '22', color: STATUS[st].f }}>{zaehl(st)} {STATUS[st].t}</span>
          ))}
          {!liste.length && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>noch keine Skripte</span>}
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{offen ? '▲' : '▼'}</span>
        </button>
        <button type="button" onClick={() => { setNeu(v => !v); setHinweis('') }} style={knopf(R, !neu)}>{neu ? 'Abbrechen' : '📄 + Drehzettel'}</button>
      </div>

      {neu && (
        <div style={{ background: 'var(--bg-card2)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input value={titel} onChange={e => setTitel(e.target.value)} placeholder="Kurzer Titel, z. B. Küche, Outfit-Wechsel" style={{ ...eingabe, fontSize: 13.5, padding: '9px 10px' }} />
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Posten auf</div>
            {accounts.length ? (
              <select value={ziel || (accounts.length === 1 ? accounts[0] : '')} onChange={e => setZiel(e.target.value)} style={{ ...eingabe, fontSize: 13.5, padding: '9px 10px' }}>
                {accounts.length > 1 && <option value="">Account wählen …</option>}
                {accounts.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            ) : <div style={{ fontSize: 12, color: 'var(--ton-amber)' }}>{gewaehlt} hat noch keinen Instagram-Link im Board. Das Skript lässt sich trotzdem anlegen, der Poster wählt dann selbst.</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => dateiRef.current?.click()} style={knopf(R, false)}>{datei ? '📄 ' + datei.name : 'PDF auswählen'}</button>
            <input ref={dateiRef} type="file" accept="application/pdf,.pdf" hidden onChange={e => { setDatei(e.target.files?.[0] || null); e.target.value = '' }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={mitTelegram} onChange={e => setMitTelegram(e.target.checked)} /> {gewaehlt} per Telegram Bescheid geben
          </label>
          <button type="button" disabled={arbeitet} onClick={anlegen} style={{ ...knopf(R, true), alignSelf: 'flex-start', padding: '9px 14px' }}>{arbeitet ? 'Lädt hoch …' : 'Anlegen (Nummer wird vergeben)'}</button>
        </div>
      )}
      {hinweis && <div style={{ fontSize: 12.5, color: hinweis.startsWith('✓') ? '#10b981' : 'var(--ton-rot)' }}>{hinweis}</div>}

      {offen && liste.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => setNurOffene(true)} style={knopf('var(--text-secondary)', nurOffene)}>Offen</button>
            <button type="button" onClick={() => setNurOffene(false)} style={knopf('var(--text-secondary)', !nurOffene)}>Alle ({liste.length})</button>
          </div>
          {sichtbar.length
            ? sichtbar.map(s => <Karte key={s.id + ':' + (s.aktualisiert_am || '')} s={s} accounts={accounts} userName={userName} onNeu={laden} />)
            : <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Nichts offen, alles gepostet.</div>}
        </>
      )}
    </div>
  )
}

// v4.103.0: dieselbe Karte in der Social-Steuerung
export { Karte as SkriptKarte }
