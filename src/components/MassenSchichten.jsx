import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, Check, Eye, Users } from 'lucide-react'
import { supabase } from '../supabase'
import { ladeInaktiveNamen, ohneInaktive } from '../people'
import {
  SCHICHT_FARBE, plusTage, montagVon, heuteBerlin, jetztMinBerlin, kwVon, tagKurz, tagDatum,
  uhrText, nachTagen, wechselVon, achseVon, wocheAlsText,
} from '../massenZeiten'

// ── Schichtzeiten für Massennachrichten (v5.51.0) ──────────────────────────
// Wunsch Chris (15.10.2026): Wer die Massennachrichten vorplant, muss wissen,
// wann bei welchem Model Schichten beginnen und enden. Keine Namen.
//   • Rolle „massen“ sieht nur diese Seite, nur die Accounts, die ihr ihm
//     freigebt (massen_accounts), nur Live-Wochen, deutsche Zeit.
//   • Unbesetzte Schichten zählen als normale Schicht, Freischicht fällt weg.
//   • Admin/Manager sehen oben „Wer sieht was“: Person wählen, Accounts
//     anhaken, Vorschau „so sieht es …“.
//   • v5.53.1: „Wer sieht was“ zeigt keine offboardeten Models mehr (gleiche
//     Regel wie der Dienstplan: models_contact.active = false oder stillgelegter
//     Login gleichen Namens). Alte Freigaben bleiben gespeichert, werden aber
//     nicht mitgezählt.
// Daten nur über massen_schichtzeiten() — die gibt keine Chatter-Namen heraus.

const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16 }
const klein = { fontSize: 12, color: 'var(--text-muted)' }
const knopf = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 40, padding: '0 13px', borderRadius: 11, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }

function useBreit(px = 900) {
  const frage = `(min-width: ${px}px)`
  const [breit, setBreit] = useState(() => { try { return window.matchMedia(frage).matches } catch { return true } })
  useEffect(() => {
    let mq; try { mq = window.matchMedia(frage) } catch { return }
    const f = () => setBreit(mq.matches)
    mq.addEventListener?.('change', f)
    return () => mq.removeEventListener?.('change', f)
  }, [frage])
  return breit
}

// ── Admin: wer sieht welche Accounts ───────────────────────────────────────
function Zugaenge({ personId, setPersonId, vorschau, setVorschau, userDisplayName }) {
  const [personen, setPersonen] = useState(null)
  const [konten, setKonten] = useState([])
  const [versteckt, setVersteckt] = useState(new Set()) // Accounts offboardeter Models
  const [frei, setFrei] = useState(new Set())
  const [fehler, setFehler] = useState('')
  const [auf, setAuf] = useState(true)

  useEffect(() => {
    let weg = false
    ;(async () => {
      const [u, a, mc, inaktiv] = await Promise.all([
        supabase.from('user_roles').select('user_id, display_name, role, roles, status'),
        supabase.from('model_aliases').select('csv_name, model_name, alias_label').order('model_name'),
        supabase.from('models_contact').select('name, active'),
        ladeInaktiveNamen(),
      ])
      if (weg) return
      const p = (u.data || []).filter(x => [...(x.roles || []), x.role].includes('massen') && (x.status || 'active') === 'active')
        .sort((x, y) => String(x.display_name).localeCompare(String(y.display_name), 'de'))
      setPersonen(p)
      if (p.length && !personId) setPersonId(p[0].user_id)
      // v5.53.1: nur Models, die noch dabei sind. Ohne Antwort von models_contact
      // lieber alles zeigen als Accounts stillschweigend verschwinden lassen.
      const norm = (x) => String(x || '').trim().toLowerCase()
      const aktiv = mc.error ? null : new Set(ohneInaktive(mc.data || [], inaktiv).map(x => norm(x.name)))
      const gesehen = new Set()
      const alle = (a.data || []).filter(x => x.csv_name && x.model_name && !gesehen.has(x.csv_name) && gesehen.add(x.csv_name))
      const dabei = (x) => !aktiv || aktiv.has(norm(x.model_name))
      setKonten(alle.filter(dabei))
      setVersteckt(new Set(alle.filter(x => !dabei(x)).map(x => x.csv_name)))
    })()
    return () => { weg = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!personId) { setFrei(new Set()); return }
    let weg = false
    supabase.from('massen_accounts').select('account').eq('user_id', personId).then(({ data, error }) => {
      if (weg) return
      if (error) { setFehler(/massen_accounts/.test(error.message) ? 'Datenbank fehlt noch: sql/massen-schichtzeiten.sql ausführen.' : error.message); return }
      setFehler(''); setFrei(new Set((data || []).map(x => x.account)))
    })
    return () => { weg = true }
  }, [personId])

  const umschalten = async (konto, an) => {
    setFehler('')
    const neu = new Set(frei); if (an) neu.add(konto); else neu.delete(konto); setFrei(neu)
    const { error } = an
      ? await supabase.from('massen_accounts').insert({ user_id: personId, account: konto, erstellt_von: userDisplayName || null })
      : await supabase.from('massen_accounts').delete().eq('user_id', personId).eq('account', konto)
    if (error) {
      setFehler('Nicht gespeichert: ' + error.message)
      const zurueck = new Set(neu); if (an) zurueck.delete(konto); else zurueck.add(konto); setFrei(zurueck)
    }
  }
  const alleVonModel = async (liste, an) => { for (const k of liste) if (frei.has(k.csv_name) !== an) await umschalten(k.csv_name, an) }

  const gruppen = useMemo(() => {
    const m = new Map()
    for (const k of konten) { if (!m.has(k.model_name)) m.set(k.model_name, []); m.get(k.model_name).push(k) }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de'))
  }, [konten])

  if (personen === null) return null
  const person = personen.find(p => p.user_id === personId)
  const sichtbarFrei = [...frei].filter(k => !versteckt.has(k)).length
  const altFrei = [...frei].filter(k => versteckt.has(k)).length

  return (
    <div style={{ ...card, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Users size={18} color="var(--accent)" />
        <b style={{ fontSize: 15, flex: '1 1 auto' }}>Wer sieht was</b>
        {person && (
          <button type="button" onClick={() => setVorschau(!vorschau)} style={{ ...knopf, height: 36, borderColor: vorschau ? 'var(--accent)' : 'var(--border)', background: vorschau ? 'rgba(124,58,237,0.14)' : 'var(--bg-card)' }}>
            <Eye size={15} /> {vorschau ? `Vorschau: so sieht es ${person.display_name}` : `So sieht es ${person.display_name}`}
          </button>
        )}
        <button type="button" onClick={() => setAuf(!auf)} aria-expanded={auf} style={{ ...knopf, height: 36 }}>{auf ? 'Einklappen' : 'Bearbeiten'}</button>
      </div>
      {!personen.length && (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Noch niemand hat die Rolle „Massennachrichten“. Vergeben unter Einstellungen → Team &amp; Rechte. Danach hier die Accounts anhaken, die die Person sehen soll.
        </div>
      )}
      {auf && personen.length > 0 && <>
        <div role="tablist" aria-label="Person" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {personen.map(p => (
            <button key={p.user_id} type="button" role="tab" aria-selected={p.user_id === personId} onClick={() => setPersonId(p.user_id)}
              style={{ ...knopf, height: 36, borderColor: p.user_id === personId ? 'var(--accent)' : 'var(--border)', background: p.user_id === personId ? 'rgba(124,58,237,0.14)' : 'var(--bg-card)' }}>
              {p.display_name}
            </button>
          ))}
        </div>
        <div style={klein}>
          {sichtbarFrei ? `${sichtbarFrei} ${sichtbarFrei === 1 ? 'Account' : 'Accounts'} freigegeben.` : 'Noch kein Account freigegeben, die Person sieht also nichts.'} Antippen schaltet sofort um.
          {altFrei > 0 && ` Dazu ${altFrei} alte ${altFrei === 1 ? 'Freigabe' : 'Freigaben'} bei offboardeten Models, die nicht mehr angezeigt ${altFrei === 1 ? 'wird' : 'werden'}.`}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
          {gruppen.map(([model, liste]) => {
            const alle = liste.every(k => frei.has(k.csv_name))
            return (
              <div key={model} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--bg-card2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <b style={{ fontSize: 13.5, flex: 1 }}>{model}</b>
                  {liste.length > 1 && <button type="button" onClick={() => alleVonModel(liste, !alle)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11.5, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>{alle ? 'keine' : 'alle'}</button>}
                </div>
                {liste.map(k => (
                  <label key={k.csv_name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', minHeight: 28 }}>
                    <input type="checkbox" checked={frei.has(k.csv_name)} onChange={e => umschalten(k.csv_name, e.target.checked)} style={{ width: 17, height: 17, accentColor: '#7c3aed' }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.csv_name}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)' }}>{k.alias_label || 'MAIN'}</span>
                  </label>
                ))}
              </div>
            )
          })}
        </div>
      </>}
      {fehler && <div role="alert" style={{ fontSize: 12.5, color: 'var(--red)' }}>{fehler}</div>}
    </div>
  )
}

// ── Zeitleiste eines Tages (breiter Bildschirm) ────────────────────────────
function Zeitleiste({ models, istHeute }) {
  const { ab } = achseVon(models)
  const proz = (min) => Math.max(0, Math.min(100, ((min - ab) / 1440) * 100))
  const jetzt = jetztMinBerlin()
  const jetztPos = istHeute ? proz(jetzt < ab ? jetzt + 1440 : jetzt) : null
  const marken = Array.from({ length: 9 }, (_, i) => ab + i * 180)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px minmax(0, 1fr)', columnGap: 14 }}>
      <div />
      <div style={{ position: 'relative', height: 22, borderBottom: '1px solid var(--border)' }}>
        {marken.map((m, i) => (
          <span key={m} style={{ position: 'absolute', top: 2, left: `${proz(m)}%`, transform: `translateX(${i === 0 ? '0' : i === 8 ? '-100%' : '-50%'})`, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>{uhrText(m)}</span>
        ))}
      </div>
      {models.map(m => (
        <React.Fragment key={m.model}>
          <div style={{ minHeight: 62, display: 'flex', flexDirection: 'column', justifyContent: 'center', borderBottom: '1px solid var(--border)', padding: '6px 0' }}>
            <span style={{ fontSize: 14.5, fontWeight: 800 }}>{m.model}</span>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.accounts.join(', ')}</span>
          </div>
          <div style={{ position: 'relative', minHeight: 62, borderBottom: '1px solid var(--border)' }}>
            {m.schichten.filter(s => s.von !== null).map(s => {
              const von = s.von < ab ? s.von + 1440 : s.von
              const bis = s.bis + (s.von < ab ? 1440 : 0)
              const l = proz(von), r = proz(bis)
              return (
                <div key={s.schicht} title={`${s.schicht} ${uhrText(s.von)}–${s.ohneEnde ? '?' : uhrText(s.bis)}`}
                  style={{ position: 'absolute', top: 9, bottom: 9, left: `calc(${l}% + 1px)`, width: `calc(${Math.max(r - l, 1.5)}% - 3px)`, background: SCHICHT_FARBE[s.schicht], color: '#0b0b16', borderRadius: 9, padding: '4px 8px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'hidden', opacity: s.ohneEnde ? 0.75 : 1 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.schicht}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>{uhrText(s.von)}–{s.ohneEnde ? '?' : uhrText(s.bis)}</span>
                </div>
              )
            })}
            {m.schichten.filter(s => s.von === null).map(s => (
              <span key={s.schicht} style={{ position: 'absolute', right: 4, bottom: 4, fontSize: 11, color: 'var(--text-muted)' }}>{s.schicht}: {s.zeit}</span>
            ))}
            {jetztPos !== null && <div aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, left: `${jetztPos}%`, width: 2, background: 'var(--text-primary)', opacity: 0.8 }} />}
          </div>
        </React.Fragment>
      ))}
    </div>
  )
}

function Wechsel({ models }) {
  const liste = wechselVon(models)
  if (!liste.length) return <div style={klein}>Keine Wechsel.</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {liste.map((w, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, width: 64 }}>{uhrText(w.min)}{w.min >= 1440 ? <sup style={{ fontSize: 9, marginLeft: 2, color: 'var(--text-muted)' }}>+1</sup> : null}</span>
          <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 5, flex: '0 0 10px', background: SCHICHT_FARBE[w.schicht], opacity: w.art === 'endet' ? 0.45 : 1 }} />
          <span style={{ flex: 1, minWidth: 0, fontWeight: 700 }}>{w.model}</span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{w.schicht} {w.art}</span>
        </div>
      ))}
    </div>
  )
}

// ── Liste eines Tages (Handy) ──────────────────────────────────────────────
function TagesListe({ models, istHeute }) {
  const jetzt = jetztMinBerlin()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {models.map(m => (
        <div key={m.model} style={{ ...card, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <b style={{ fontSize: 15, flex: '1 1 auto' }}>{m.model}</b>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'right' }}>{m.accounts.join(', ')}</span>
          </div>
          {m.schichten.map(s => {
            const laeuft = istHeute && s.von !== null && ((jetzt >= s.von && jetzt < s.bis) || (jetzt + 1440 >= s.von && jetzt + 1440 < s.bis))
            const vorbei = istHeute && s.von !== null && !laeuft && jetzt >= s.bis
            return (
              <div key={s.schicht} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, opacity: vorbei ? 0.5 : 1 }}>
                <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 5, flex: '0 0 10px', background: SCHICHT_FARBE[s.schicht] }} />
                <span style={{ width: 84, fontWeight: 700 }}>{s.schicht}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, flex: 1 }}>{s.von !== null ? `${uhrText(s.von)}–${s.ohneEnde ? '?' : uhrText(s.bis)}` : s.zeit}</span>
                {laeuft && <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 9, background: 'rgba(124,58,237,0.18)', color: 'var(--text-primary)' }}>läuft</span>}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── Seite ──────────────────────────────────────────────────────────────────
export default function MassenSchichten({ istAdmin = false, userDisplayName }) {
  const breit = useBreit(900)
  const heute = heuteBerlin()
  const [montag, setMontag] = useState(() => montagVon(heute))
  const [tag, setTag] = useState(heute)
  const [zeilen, setZeilen] = useState(null)
  const [fehler, setFehler] = useState('')
  const [kopiert, setKopiert] = useState(false)
  const [personId, setPersonId] = useState(null)
  const [vorschau, setVorschau] = useState(false)

  const laden = useCallback(async () => {
    setZeilen(null); setFehler('')
    const args = { p_von: montag, p_bis: plusTage(montag, 6) }
    if (istAdmin && vorschau && personId) args.p_fuer = personId
    const { data, error } = await supabase.rpc('massen_schichtzeiten', args)
    if (error) {
      setFehler(/massen_schichtzeiten/.test(error.message) ? 'Datenbank fehlt noch: sql/massen-schichtzeiten.sql ausführen.' : 'Laden hat nicht geklappt: ' + error.message)
      setZeilen([]); return
    }
    setZeilen(data || [])
  }, [montag, istAdmin, vorschau, personId])
  useEffect(() => { laden() }, [laden])
  // „jetzt“-Linie und „läuft“ jede Minute neu zeichnen
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 60000); return () => clearInterval(t) }, [])

  const tage = useMemo(() => nachTagen(zeilen || []), [zeilen])
  const wocheTage = Array.from({ length: 7 }, (_, i) => plusTage(montag, i))
  const aktiverTag = wocheTage.includes(tag) ? tag : wocheTage[0]
  const models = tage[aktiverTag] || []
  const istHeute = aktiverTag === heute

  const woche = (n) => { const m = plusTage(montag, 7 * n); setMontag(m); setTag(m === montagVon(heute) ? heute : m) }
  const kopieren = async () => {
    try { await navigator.clipboard.writeText(wocheAlsText(montag, tage)); setKopiert(true); setTimeout(() => setKopiert(false), 2000) }
    catch { setFehler('Kopieren ging nicht. Bitte erneut versuchen.') }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 auto', minWidth: 160 }}>
          <div style={{ fontSize: 21, fontWeight: 800 }}>Schichtzeiten</div>
          <div style={klein}>Alle Zeiten in deutscher Zeit · nur veröffentlichte Wochen</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, ...card, borderRadius: 12, padding: 4 }}>
          <button type="button" onClick={() => woche(-1)} aria-label="Woche zurück" style={{ ...knopf, border: 'none', width: 40, padding: 0 }}><ChevronLeft size={18} /></button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, padding: '0 4px', whiteSpace: 'nowrap' }}>KW {kwVon(montag)} · {tagDatum(montag)}–{tagDatum(plusTage(montag, 6))}</span>
          <button type="button" onClick={() => woche(1)} aria-label="Woche vor" style={{ ...knopf, border: 'none', width: 40, padding: 0 }}><ChevronRight size={18} /></button>
        </div>
        <button type="button" onClick={kopieren} disabled={!zeilen} style={knopf}>
          {kopiert ? <Check size={16} /> : <Copy size={16} />} {kopiert ? 'Kopiert' : (breit ? 'Woche als Text kopieren' : 'Kopieren')}
        </button>
      </div>

      {istAdmin && <Zugaenge personId={personId} setPersonId={setPersonId} vorschau={vorschau} setVorschau={setVorschau} userDisplayName={userDisplayName} />}

      {/* raster-7: sonst macht die Handy-Regel in index.css aus jedem Raster eine Spalte */}
      <div role="tablist" aria-label="Tag" className="raster-7" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: breit ? 8 : 4 }}>
        {wocheTage.map(t => {
          const an = t === aktiverTag
          const n = (tage[t] || []).length
          return (
            <button key={t} type="button" role="tab" aria-selected={an} onClick={() => setTag(t)}
              style={{ height: breit ? 58 : 50, borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${an ? 'var(--accent)' : 'var(--border)'}`, background: an ? 'var(--accent)' : 'var(--bg-card)', color: an ? '#fff' : 'var(--text-primary)', opacity: n || an ? 1 : 0.55 }}>
              <span style={{ fontSize: breit ? 12 : 10.5, fontWeight: 700, opacity: 0.85 }}>{tagKurz(t)}{breit && t === heute ? ' · heute' : ''}</span>
              <span style={{ fontSize: breit ? 15 : 13.5, fontWeight: 800 }}>{breit ? tagDatum(t) : t.slice(8, 10)}</span>
            </button>
          )
        })}
      </div>

      {fehler && <div role="alert" style={{ ...card, padding: '12px 14px', fontSize: 13, color: 'var(--red)' }}>{fehler}</div>}
      {zeilen === null && <div style={{ ...klein, padding: '30px 0', textAlign: 'center' }}>Lädt …</div>}

      {zeilen !== null && !models.length && !fehler && (
        <div style={{ ...card, padding: '22px 18px', fontSize: 13.5, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.5 }}>
          {zeilen.length ? 'An diesem Tag sind keine Schichten eingetragen.' : 'Für diese Woche gibt es noch keine veröffentlichten Schichten' + (istAdmin && vorschau ? ' oder für diese Person noch keine freigegebenen Accounts.' : '.')}
        </div>
      )}

      {zeilen !== null && models.length > 0 && (breit ? (
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ ...card, padding: '16px 18px', flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <b style={{ fontSize: 15.5 }}>{new Date(aktiverTag + 'T12:00:00Z').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' })}</b>
              <span style={klein}>Nachtschichten stehen am Tag, an dem sie beginnen</span>
            </div>
            <Zeitleiste models={models} istHeute={istHeute} />
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-secondary)' }}>
              {Object.entries(SCHICHT_FARBE).map(([s, f]) => (
                <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 3, background: f }} />{s}</span>
              ))}
              {istHeute && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span aria-hidden="true" style={{ width: 2, height: 14, background: 'var(--text-primary)' }} />jetzt</span>}
            </div>
          </div>
          <div style={{ ...card, padding: '16px', width: 300, flex: '0 0 300px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <b style={{ fontSize: 15 }}>Wechsel</b>
            <div style={{ ...klein, marginBottom: 4 }}>Wann eine Schicht beginnt oder endet</div>
            <Wechsel models={models} />
          </div>
        </div>
      ) : (
        <TagesListe models={models} istHeute={istHeute} />
      ))}
    </div>
  )
}
