import React, { useEffect, useState } from 'react'
import { datumInZone, BERLIN, meineZone, versatzMinuten, zeitIn } from '../zeit'
import { plusTage } from '../jetzt'
import { reiseHeute, reiseBald, zustand, listeAus } from '../modelLage'

// ── Chatter-Portal, Tab „Heute": Deine Models (v4.75.0) ─────────────────────
//
// Vorher musste man für „Luna ist auf Reise" in den Tab Models, dort „Meine
// Models" aufklappen, den Namen antippen und die Kachel Reiseplan lesen. Jetzt
// steht jedes Model der Schicht als Karte ganz oben: Zustand, Reise, was diese
// Woche ansteht, offene Customs, Preise, No Gos, Services — und was sich seit
// der letzten eigenen Schicht am Board geändert hat.
//
// Nur Anzeige. Das volle Board bleibt im Tab Models („Ganzes Board").
// Daten: Board-Maps aus ChatterPortal (loadAssignedModelData), Zustand und
// Änderungen aus useModelLage (src/modelLage.js).

const KATEGORIE = {
  preise: 'Preise', nogos: 'No Gos', regeln: 'Regeln', services: 'Services',
  einschraenkungen: 'Einschränkungen', reise: 'Reiseplan', termine: 'Termine',
  videos: 'Videos', service_flags: 'Services', social_links: 'Social',
}
const SERVICE = { bewertungen: 'Bewertungen', audios: 'Audios', video_chat: 'Video-Call', telefonieren: 'Telefon', custom: 'Custom', sexting: 'Sexting' }
const AVATAR = ['#0891b2', '#db2777', '#7c3aed', '#059669', '#d97706', '#4f46e5', '#be123c']

const lc = (s) => String(s || '').trim().toLowerCase()
const farbeVon = (name) => AVATAR[Math.abs([...String(name)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % AVATAR.length]
const heuteBerlin = () => datumInZone(new Date(), BERLIN).tag
const tagKurz = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
const tagName = (iso, heute) => iso === heute ? 'Heute' : iso === plusTage(heute, 1) ? 'Morgen' : tagKurz(iso)

function useSchmal(grenze = 700) {
  const [schmal, setSchmal] = useState(() => typeof window !== 'undefined' && window.innerWidth < grenze)
  useEffect(() => {
    const f = () => setSchmal(window.innerWidth < grenze)
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [grenze])
  return schmal
}

const label = { fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }
const chip = (farbe, stark) => ({
  fontSize: 11.5, padding: '3px 8px', borderRadius: 7, lineHeight: 1.35,
  background: farbe + (stark ? '2e' : '17'), border: `1px solid ${farbe}${stark ? 'aa' : '55'}`,
  color: farbe, fontWeight: stark ? 700 : 500,
})

// v4.76.0: Uhrzeit beim Model (models_contact.zeitzone, setzt das Model-Portal
// automatisch aus dem Gerät des Models) — mit Abstand zur eigenen Zeit.
function ortszeit(zone) {
  if (!zone) return null
  try {
    const jetzt = new Date()
    const ich = meineZone()
    const diff = Math.round((versatzMinuten(zone, jetzt) - versatzMinuten(ich, jetzt)) / 30) / 2
    if (diff === 0) return null   // gleiche Zeit wie ich — keine neue Information
    const abstand = `${diff > 0 ? '+' : '−'}${String(Math.abs(diff)).replace('.', ',')} h zu dir`
    return { uhr: zeitIn(jetzt, zone), abstand }
  } catch { return null }
}

function Neu() {
  return <span style={{ fontSize: 9, fontWeight: 800, color: '#f59e0b', marginLeft: 5, letterSpacing: '0.04em' }}>NEU</span>
}

function ModelKarte({ name, board = {}, services = {}, custom = [], videos = [], kontakt, kalender = [], aenderungen = [], onBoard }) {
  const heute = heuteBerlin()
  const reise = reiseHeute(board.reise, heute)
  const z = zustand(kontakt, reise)
  const oz = ortszeit(kontakt?.zeitzone)
  const geht = listeAus(reise?.reise_geht)
  const gehtNicht = listeAus(reise?.reise_geht_nicht)
  const neuTitel = new Set(aenderungen.filter(a => a.action !== 'gelöscht').map(a => lc(a.details)))
  const istNeu = (t) => neuTitel.has(lc(t))

  // Was diese Woche ansteht — Kalender des Models, Board-Termine, Videos, Reisen
  const bis = plusTage(heute, 7)
  const woche = [
    ...kalender.map(c => ({ key: 'c' + c.id, tag: c.due_date, zeit: c.due_time ? String(c.due_time).slice(0, 5) : null, text: c.title, reise: c.category === 'reise' })),
    ...(board.termine || []).filter(t => t.date && t.date >= heute && t.date <= bis).map(t => ({ key: 't' + t.id, tag: t.date, text: t.title, neu: istNeu(t.title) })),
    ...videos.filter(v => v.release_date && v.release_date >= heute && v.release_date <= bis).map(v => ({ key: 'v' + v.id, tag: v.release_date, text: `Video: ${v.title}` })),
    ...reiseBald(board.reise, heute).map(r => ({ key: 'r' + r.id, tag: r.date_from || r.date_to, text: r.title, reise: true, bis: r.date_to })),
  ].sort((a, b) => a.tag.localeCompare(b.tag) || String(a.zeit || '').localeCompare(String(b.zeit || '')))
    // Dieselbe Reise steht oft im Kalender UND im Board-Reiseplan — einmal reicht.
    // Der Board-Eintrag (mit Bis-Datum) gewinnt, er steht in der Liste hinten.
    .filter((w, i, alle) => !alle.some((x, j) => j > i && x.tag === w.tag && lc(x.text) === lc(w.text)))

  const preise = board.preise || []
  const nogos = board.nogos || []
  const einschr = board.einschraenkungen || []
  const svc = Object.entries(services)

  // Reise-Balken: wie weit die Reise schon ist
  let reiseAnteil = null, reiseRest = null
  if (reise) {
    const von = new Date((reise.date_from || reise.date_to) + 'T12:00:00')
    const zu = new Date((reise.date_to || reise.date_from) + 'T12:00:00')
    const jetzt = new Date(heute + 'T12:00:00')
    const tage = Math.round((zu - von) / 864e5) + 1
    const vorbei = Math.round((jetzt - von) / 864e5) + 1
    reiseAnteil = Math.min(1, Math.max(0.04, vorbei / tage))
    reiseRest = Math.round((zu - jetzt) / 864e5)
  }

  return (
    <div style={{
      background: 'var(--bg-card)', borderRadius: 14, overflow: 'hidden', minWidth: 0,
      border: `1px solid ${reise ? 'rgba(8,145,178,0.45)' : 'var(--border)'}`,
    }}>
      {/* Kopf */}
      <div style={{
        padding: '13px 14px', borderBottom: reise ? 'none' : '1px solid var(--border)',
        background: reise ? 'linear-gradient(135deg, rgba(8,145,178,0.20), rgba(124,58,237,0.10) 70%, transparent)' : 'transparent',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ position: 'relative', width: 38, height: 38, borderRadius: 19, background: farbeVon(name), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, flexShrink: 0 }}>
            {String(name).charAt(0).toUpperCase()}
            {z.art === 'online' && <span style={{ position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: 6, background: '#10b981', border: '2.5px solid var(--bg-card)' }} />}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
            {oz && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>bei ihr <b style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>{oz.uhr}</b> · {oz.abstand}</div>}
            {z.zeile && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{z.zeile}</div>}
          </div>
          <span style={{ ...chip(z.farbe), borderRadius: 20, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>{z.text}</span>
        </div>
        {kontakt?.status_note && z.art !== 'online' && z.art !== 'offline' && (
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 8 }}>„{kontakt.status_note}“</div>
        )}

        {reise && (
          <div style={{ marginTop: 11, background: 'var(--bg-base)', border: '1px solid rgba(8,145,178,0.35)', borderRadius: 10, padding: '9px 11px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>📍 {reise.title}{istNeu(reise.title) && <Neu />}</span>
              {reise.date_to && <span style={{ fontSize: 11, fontWeight: 700, color: '#0891b2', whiteSpace: 'nowrap' }}>bis {tagKurz(reise.date_to)}</span>}
            </div>
            {reiseAnteil != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7 }}>
                <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'rgba(8,145,178,0.18)', overflow: 'hidden' }}>
                  <div style={{ width: `${reiseAnteil * 100}%`, height: '100%', background: '#06b6d4', borderRadius: 3 }} />
                </div>
                <span style={{ fontSize: 10.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {reiseRest > 1 ? `noch ${reiseRest} Tage` : reiseRest === 1 ? 'morgen zurück' : 'letzter Tag'}
                </span>
              </div>
            )}
            {reise.content && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 7, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{reise.content}</div>}
          </div>
        )}
        {reise && (geht.length > 0 || gehtNicht.length > 0) && (
          <div style={{ marginTop: 10 }}>
            <div style={label}>Während der Reise</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {geht.map(t => <span key={'g' + t} style={chip('#10b981')}>✓ {t}</span>)}
              {gehtNicht.map(t => <span key={'n' + t} style={chip('#ef4444')}>✕ {t}</span>)}
            </div>
          </div>
        )}
        {reise?.reise_fans && (
          <div style={{ marginTop: 10, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 9, padding: '8px 10px', fontSize: 12, lineHeight: 1.45, color: 'var(--text-primary)' }}>
            <b style={{ color: '#f59e0b' }}>So sagst du's Fans:</b> {reise.reise_fans}
          </div>
        )}
      </div>

      <div style={{ padding: '11px 14px 13px', display: 'flex', flexDirection: 'column', gap: 11 }}>
        {/* Neu seit der letzten Schicht */}
        {aenderungen.length > 0 && (
          <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 9, padding: '8px 10px' }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#f59e0b', letterSpacing: '0.06em', marginBottom: 4 }}>
              NEU SEIT DEINER LETZTEN SCHICHT · {aenderungen.length}
            </div>
            {aenderungen.slice(0, 3).map(a => (
              <div key={a.id} style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                <b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{KATEGORIE[a.category] || a.category}</b> {a.action}: {a.details}
              </div>
            ))}
            {aenderungen.length > 3 && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>+ {aenderungen.length - 3} weitere</div>}
          </div>
        )}

        {/* Diese Woche */}
        {woche.length > 0 && (
          <div>
            <div style={label}>Diese Woche</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {woche.slice(0, 4).map(w => {
                const heuteIst = w.tag === heute
                return (
                  <div key={w.key} style={{ display: 'flex', gap: 9, alignItems: 'baseline', fontSize: 12, padding: '5px 8px', borderRadius: 7, background: heuteIst ? 'rgba(236,72,153,0.10)' : 'var(--bg-card2)', border: `1px solid ${heuteIst ? 'rgba(236,72,153,0.35)' : 'transparent'}` }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: heuteIst ? '#ec4899' : 'var(--text-muted)', fontWeight: heuteIst ? 700 : 400, minWidth: 64, flexShrink: 0 }}>
                      {tagName(w.tag, heute)}{w.zeit ? ` ${w.zeit}` : ''}
                    </span>
                    <span style={{ color: w.reise ? '#0891b2' : 'var(--text-primary)', minWidth: 0 }}>
                      {w.reise ? '✈ ' : ''}{w.text}{w.bis ? ` (bis ${tagKurz(w.bis)})` : ''}{w.neu && <Neu />}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Offene Customs */}
        {custom.length > 0 && (
          <div>
            <div style={label}>Custom offen · {custom.length}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {custom.slice(0, 3).map(cc => {
                const drueber = cc.due_date && cc.due_date < heute
                const f = drueber ? '#ef4444' : '#f59e0b'
                return (
                  <div key={cc.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 7, background: 'var(--bg-card2)', border: `1px solid ${f}44`, fontSize: 12 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 3, background: f, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cc.title}</span>
                    {cc.due_date && <span style={{ fontSize: 11, fontWeight: 700, color: f, whiteSpace: 'nowrap' }}>{drueber ? 'überfällig' : tagName(cc.due_date, heute)}</span>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Preise */}
        {preise.length > 0 && (
          <div>
            <div style={label}>Preise</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 4 }}>
              {preise.slice(0, 6).map(p => {
                const neu = istNeu(p.title)
                return (
                  <div key={p.id} title={p.content || ''} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 11.5, padding: '5px 8px', borderRadius: 7, background: neu ? 'rgba(245,158,11,0.10)' : 'var(--bg-card2)', border: `1px solid ${neu ? 'rgba(245,158,11,0.4)' : 'transparent'}` }}>
                    <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                    {p.price && <b style={{ color: neu ? '#f59e0b' : 'var(--text-primary)', whiteSpace: 'nowrap' }}>{p.price}</b>}
                  </div>
                )
              })}
            </div>
            {preise.length > 6 && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>+ {preise.length - 6} im Board</div>}
          </div>
        )}

        {/* No Gos und Einschränkungen */}
        {(nogos.length > 0 || einschr.length > 0) && (
          <div>
            <div style={label}>No Gos{einschr.length > 0 ? ' & Einschränkungen' : ''}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {nogos.slice(0, 8).map(n => <span key={n.id} title={n.content || ''} style={chip('#ef4444', istNeu(n.title))}>{n.title}{istNeu(n.title) ? ' · NEU' : ''}</span>)}
              {einschr.slice(0, 4).map(n => <span key={n.id} title={n.content || ''} style={chip('#f59e0b', istNeu(n.title))}>{n.title}{istNeu(n.title) ? ' · NEU' : ''}</span>)}
            </div>
          </div>
        )}

        {/* Services */}
        {svc.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {svc.map(([k, s]) => (
              <span key={k} title={s.note || ''} style={{ fontSize: 11, padding: '3px 7px', borderRadius: 6, background: 'var(--bg-card2)', color: s.enabled ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                {s.enabled ? '✓' : '✕'} {SERVICE[k] || k}
              </span>
            ))}
          </div>
        )}

        <button type="button" onClick={() => onBoard(name)} style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', padding: 0, color: '#a78bfa', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          Ganzes Board →
        </button>
      </div>
    </div>
  )
}

export default function HeuteModels({ namen, titel, lage, boards, services, custom, videos, onBoard }) {
  const schmal = useSchmal()
  const [gewaehlt, setGewaehlt] = useState(null)
  if (!namen.length) return null
  const aktiv = namen.includes(gewaehlt) ? gewaehlt : namen[0]
  const summe = namen.reduce((s, n) => s + (lage.aenderungen[n]?.length || 0), 0)

  const karte = (n) => (
    <ModelKarte key={n} name={n} board={boards[n]} services={services[n]} custom={custom[n]} videos={videos[n]}
      kontakt={lage.kontakte[n]} kalender={lage.kalender[n]} aenderungen={lage.aenderungen[n]} onBoard={onBoard} />
  )

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{titel}</span>
        {summe > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b' }}>{summe} {summe === 1 ? 'Änderung' : 'Änderungen'} seit deiner letzten Schicht</span>}
      </div>

      {schmal && namen.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {namen.map(n => {
            const z = zustand(lage.kontakte[n], reiseHeute(boards[n]?.reise))
            const an = n === aktiv
            const neu = lage.aenderungen[n]?.length || 0
            return (
              <button key={n} type="button" onClick={() => setGewaehlt(n)} style={{
                position: 'relative', flex: '1 0 96px', padding: '8px 8px', borderRadius: 11, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center',
                background: an ? z.farbe + '1f' : 'var(--bg-card)', border: `1.5px solid ${an ? z.farbe : 'var(--border)'}`,
              }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{n}</div>
                <div style={{ fontSize: 10.5, color: z.farbe, marginTop: 1, whiteSpace: 'nowrap' }}>{z.text}</div>
                {neu > 0 && <span style={{ position: 'absolute', top: -5, right: -3, minWidth: 16, height: 16, borderRadius: 8, background: '#f59e0b', color: '#1a1205', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{neu}</span>}
              </button>
            )
          })}
        </div>
      )}

      {schmal
        ? karte(aktiv)
        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, alignItems: 'start' }}>{namen.map(karte)}</div>}
    </div>
  )
}

// ── Beim Einloggen: was ist neu? (v4.76.0) ──────────────────────────────────
//
// Erscheint einmal, wenn sich seit der letzten eigenen Schicht etwas an den
// Boards der heutigen Models geändert hat, das dieser Login noch nicht
// bestätigt hat. „Gelesen" merkt sich den Zeitpunkt pro Login
// (gelesen_stand, Schlüssel 'chattermodels') — am Handy ist es dann auch weg.
// Laufende Reisen stehen immer oben mit dabei, weil sie die ganze Schicht prägen.
// zIndex über den runden Knöpfen unten rechts (Hilfe/Glocke/Chat liegen bei 99999).
export function ModelNeuFenster({ namen, lage, boards, gesehenBis, onGelesen }) {
  const heute = heuteBerlin()
  const neu = namen.flatMap(n => (lage.aenderungen[n] || [])
    .filter(a => !gesehenBis || new Date(a.created_at) > new Date(gesehenBis))
    .map(a => ({ ...a, model: n })))
  if (!neu.length) return null
  const reisen = namen.map(n => ({ n, r: reiseHeute(boards[n]?.reise, heute) })).filter(x => x.r)
  const FARBE = { reise: '#0891b2', nogos: '#ef4444', einschraenkungen: '#f59e0b', preise: '#f59e0b', termine: '#ec4899' }

  return (
    <div className="model-neu-huelle" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 0 }}>
      <div role="dialog" aria-label="Neu seit deiner letzten Schicht" style={{
        width: 'min(520px, 100%)', maxHeight: '88vh', overflowY: 'auto', boxSizing: 'border-box',
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '18px 18px 0 0',
        padding: '16px 18px 22px', display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 0,
      }} className="model-neu-fenster">
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#f59e0b', letterSpacing: '0.06em' }}>BEVOR DU LOSLEGST</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginTop: 3 }}>
            {neu.length === 1 ? '1 Sache hat sich' : `${neu.length} Sachen haben sich`} seit deiner letzten Schicht geändert
          </div>
        </div>

        {reisen.map(({ n, r }) => (
          <div key={'r' + n} style={{ display: 'flex', gap: 11, padding: '10px 12px', borderRadius: 11, background: 'rgba(8,145,178,0.12)', border: '1px solid rgba(8,145,178,0.4)' }}>
            <span style={{ fontSize: 20 }}>✈</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{n} ist auf Reise: {r.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.4 }}>
                {r.date_to ? `bis ${tagKurz(r.date_to)}` : ''}
                {listeAus(r.reise_geht_nicht).length > 0 ? ` · geht nicht: ${listeAus(r.reise_geht_nicht).join(', ')}` : ''}
              </div>
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {neu.slice(0, 12).map(a => {
            const f = FARBE[a.category] || '#a78bfa'
            return (
              <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '8px 11px', borderRadius: 9, background: f + '12', border: `1px solid ${f}44`, fontSize: 12.5 }}>
                <b style={{ color: 'var(--text-primary)', minWidth: 56 }}>{a.model}</b>
                <span style={{ color: 'var(--text-secondary)', minWidth: 0 }}>
                  <span style={{ color: f, fontWeight: 600 }}>{KATEGORIE[a.category] || a.category}</span> {a.action}: {a.details}
                </span>
              </div>
            )
          })}
          {neu.length > 12 && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>+ {neu.length - 12} weitere — stehen auf den Karten</div>}
        </div>

        <button type="button" onClick={onGelesen} style={{ background: '#7c3aed', border: 'none', borderRadius: 12, padding: '13px', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          Gelesen — Schicht kann kommen
        </button>
      </div>
    </div>
  )
}
