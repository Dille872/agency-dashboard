import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { logActivity } from '../activity'
import { macheT } from '../i18n/socialManager'
import { useVorschau, vorschauSperre } from '../vorschau' // v5.2.0

// ── Reels ohne Skript (v4.109.0) ───────────────────────────────────────────
// Reels, die wir posten, ohne dass ein Drehzettel vorausging (z. B. alter
// Content). Link einfügen, fertig: Das Sammel-Skript misst sie nachts mit,
// und sie zählen als „ohne Skript“ statt als eigener Content des Models.
//
// Eintragen: Admins/Pfleger und der Poster, der dem Account zugeteilt ist
// (sql/reel-ohne-skript.sql). Entfernen: Agentur immer, Poster nur eigene.
// Die Datenbank prüft Link, Account und dass das Reel an keinem Skript hängt.
//
// accounts: [{ model, handle, notiz }] — nur die, auf die man eintragen darf.

const P = '#ec4899', C = '#06b6d4', G = '#10b981', ROT = '#ef4444'
const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 15px' }
const eingabe = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }
const heuteISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
const codeVon = (url) => String(url || '').match(/instagram\.com\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/i)?.[1] || null

export default function ReelsOhneSkript({ accounts = [], t: tAussen, userDisplayName, istAdmin = false, sprache = 'de' }) {
  const t = useMemo(() => tAussen || macheT(sprache), [tAussen, sprache])
  const vorschau = useVorschau()
  const loc = sprache === 'en' ? 'en-US' : 'de-DE'
  const schluessel = accounts.map(a => a.model + '|' + a.handle).join(',')
  const [wahl, setWahl] = useState(accounts.length === 1 ? schluessel : '')
  const [link, setLink] = useState('')
  const [tag, setTag] = useState(heuteISO())
  const [meldung, setMeldung] = useState(null) // { ok, text }
  const [arbeitet, setArbeitet] = useState(false)
  const [liste, setListe] = useState(null)
  const [mw, setMw] = useState({})
  const [fehltDb, setFehltDb] = useState(false)
  useEffect(() => { if (accounts.length === 1) setWahl(schluessel) }, [schluessel]) // eslint-disable-line react-hooks/exhaustive-deps

  const laden = useCallback(async () => {
    const { data, error } = await supabase.from('reel_ohne_skript').select('*').order('eingetragen_am', { ascending: false }).limit(200)
    if (error) { setFehltDb(true); setListe([]); return }
    const eig = (data || []).filter(x => accounts.some(a => a.model === x.model_name && a.handle.toLowerCase() === x.account))
      .sort((a, b) => String(b.gepostet_am || b.eingetragen_am).localeCompare(String(a.gepostet_am || a.eingetragen_am)))
    setListe(eig.slice(0, 15))
    const codes = eig.slice(0, 15).map(x => x.shortcode)
    if (codes.length) {
      const m = await supabase.from('reel_messwerte').select('shortcode, plays, faktor, gemessen_am').in('shortcode', codes).order('gemessen_am', { ascending: false })
      const neu = {}
      for (const x of (m.error ? [] : (m.data || []))) if (!neu[x.shortcode]) neu[x.shortcode] = x
      setMw(neu)
    }
  }, [schluessel]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { laden() }, [laden])

  const eintragen = async () => {
    if (vorschau) return vorschauSperre()
    setMeldung(null)
    const url = String(link || '').trim()
    if (!codeVon(url)) { setMeldung({ ok: false, text: t('os_fehler_link') }); return }
    const acc = accounts.find(a => a.model + '|' + a.handle === wahl)
    if (!acc) return
    setArbeitet(true)
    const { error } = await supabase.from('reel_ohne_skript').insert({ reel_url: /^https?:\/\//i.test(url) ? url : `https://${url}`, model_name: acc.model, account: acc.handle, gepostet_am: tag || null })
    setArbeitet(false)
    if (error) {
      const doppelt = error.code === '23505'
      setMeldung({ ok: false, text: doppelt ? (sprache === 'en' ? 'This reel is already on the list.' : 'Dieses Reel steht schon in der Liste.') : error.message })
      return
    }
    try { logActivity('reel.ohne_skript', { entity: `${acc.model} ${acc.handle}`, detail: codeVon(url) }) } catch { /* nur Protokoll */ }
    setLink(''); setMeldung({ ok: true, text: t('os_ok') })
    laden()
  }

  const entfernen = async (x) => {
    if (vorschau) return vorschauSperre()
    if (!window.confirm(t('os_entfernen_frage'))) return
    const { error } = await supabase.from('reel_ohne_skript').delete().eq('shortcode', x.shortcode)
    if (error) { setMeldung({ ok: false, text: error.message }); return }
    laden()
  }

  if (fehltDb) return <div style={{ ...card, color: 'var(--text-muted)', fontSize: 12.5 }}>{t('os_fehlt_db')}</div>
  const datum = (iso) => iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString(loc, { day: '2-digit', month: '2-digit' }) : ''
  const zahl = (n) => Number(n).toLocaleString(loc)
  const bereit = !!wahl && !!String(link).trim() && !arbeitet

  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{t('os_titel')}</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>{t('os_text')}</div>
      </div>
      {!accounts.length ? <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{t('os_keine_accounts')}</div> : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {accounts.length > 1 && (
            <select value={wahl} onChange={e => setWahl(e.target.value)} style={{ ...eingabe, minWidth: 190 }}>
              <option value="">Account …</option>
              {accounts.map(a => <option key={a.model + '|' + a.handle} value={a.model + '|' + a.handle}>{a.handle} · {a.model}{a.notiz ? ` · ${a.notiz}` : ''}</option>)}
            </select>
          )}
          {accounts.length === 1 && <span style={{ color: P, fontWeight: 800, fontSize: 13.5 }}>{accounts[0].handle}</span>}
          <input value={link} onChange={e => setLink(e.target.value.slice(0, 500))} onKeyDown={e => { if (e.key === 'Enter' && bereit) eintragen() }}
            placeholder="https://www.instagram.com/reel/…" inputMode="url" autoCapitalize="none" autoCorrect="off" style={{ ...eingabe, flex: 1, minWidth: 220 }} />
          <input type="date" value={tag} onChange={e => setTag(e.target.value)} style={{ ...eingabe, width: 150 }} />
          <button type="button" disabled={!bereit} onClick={eintragen}
            style={{ padding: '8px 14px', borderRadius: 10, border: 'none', background: P, color: '#fff', fontSize: 13, fontWeight: 800, cursor: bereit ? 'pointer' : 'not-allowed', opacity: bereit ? 1 : 0.5, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            {arbeitet ? '…' : t('os_eintragen')}
          </button>
        </div>
      )}
      {meldung && <div style={{ fontSize: 12.5, color: meldung.ok ? G : ROT }}>{meldung.text}</div>}
      {liste && liste.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>{t('os_zuletzt')}</div>
          {liste.map(x => {
            const m = mw[x.shortcode]
            const darf = istAdmin || x.eingetragen_von === userDisplayName
            return (
              <div key={x.shortcode} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '7px 0', borderTop: '1px solid var(--border)', fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)', minWidth: 44 }}>{datum(x.gepostet_am || x.eingetragen_am)}</span>
                <span style={{ color: P, fontWeight: 700 }}>{x.account}</span>
                <a href={x.reel_url} target="_blank" rel="noreferrer" style={{ color: C, fontWeight: 700 }}>Reel</a>
                <span style={{ color: m ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {m ? <>{t('os_aufrufe', { n: zahl(m.plays ?? 0) })}{m.faktor !== null && m.faktor !== undefined ? ` · ${Number(m.faktor).toFixed(1)}×` : ''}</> : t('os_nicht_gemessen')}
                </span>
                <span style={{ flex: 1, textAlign: 'right', fontSize: 11.5, color: 'var(--text-muted)' }}>{x.eingetragen_von ? t('os_von', { wer: x.eingetragen_von }) : ''}</span>
                {darf && <button type="button" onClick={() => entfernen(x)} title={t('os_entfernen')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}>✕</button>}
              </div>
            )
          })}
        </div>
      )}
      {liste && !liste.length && accounts.length > 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('os_leer')}</div>}
    </div>
  )
}
