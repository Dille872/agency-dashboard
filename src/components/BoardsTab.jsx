import React, { useEffect, useState } from 'react'
import { Plus, LayoutDashboard, Users, Megaphone, Square, Archive } from 'lucide-react'
import { VORLAGEN, ladeBoards, boardAnlegen, boardAendern, ladeTeam } from '../boards'
import BoardEditor from './BoardEditor'

// ── Boards: Übersicht (v4.73.0) ─────────────────────────────────────────────
//
// Gemeinsame Whiteboards für Admin/Manager — Brainstormen zu Team-Struktur,
// Massennachrichten, was gerade ansteht. Entwurf: Canvas "Agency Dashboard
// Mobile", Artboards Board*.dc.html.
//
// Ein Board wird nie gelöscht, nur archiviert (die Datenbank lässt Löschen gar
// nicht zu, sql/boards.sql). Was einmal besprochen wurde, soll wiederzufinden
// sein.
//
// Das Team (Personen-Karten, $/h, Schicht dieser Woche) wird hier einmal
// geladen und an den Editor gegeben — die Vorlage "Team-Struktur" braucht es
// schon beim Anlegen.

const VORLAGE_ICON = { team: Users, nachrichten: Megaphone, leer: Square }
const VORLAGE_NAME = Object.fromEntries(VORLAGEN.map(v => [v.key, v.titel]))

const wann = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  const min = Math.round((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'gerade eben'
  if (min < 60) return `vor ${min} min`
  if (min < 24 * 60) return `vor ${Math.round(min / 60)} h`
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
}

export default function BoardsTab({ userDisplayName, chatterSnapshots = [] }) {
  const [boards, setBoards] = useState(null)
  const [fehler, setFehler] = useState(null)
  const [offen, setOffen] = useState(null)
  const [team, setTeam] = useState(null)
  const [neu, setNeu] = useState(null)        // { vorlage, titel } während des Anlegens
  const [arbeitet, setArbeitet] = useState(false)
  const ich = userDisplayName || 'Ich'

  const neuLaden = () => ladeBoards().then(setBoards).catch(e => {
    // PGRST205 = Tabelle nicht im Schema-Cache → SQL noch nicht ausgeführt
    setFehler(['42P01', 'PGRST205'].includes(e.code) || /schema cache|does not exist/.test(e.message || '')
      ? 'Die Boards-Tabellen fehlen noch. Bitte sql/boards.sql im Supabase SQL-Editor ausführen.'
      : 'Boards konnten nicht geladen werden: ' + e.message)
    setBoards([])
  })

  useEffect(() => { neuLaden() }, [])
  useEffect(() => {
    ladeTeam(chatterSnapshots).then(setTeam).catch(e => console.warn('Boards: Team nicht geladen', e.message))
  }, [chatterSnapshots])

  const anlegen = async () => {
    if (!neu?.titel?.trim()) return
    setArbeitet(true)
    try {
      const board = await boardAnlegen({ titel: neu.titel.trim(), vorlage: neu.vorlage, ich, team })
      setNeu(null)
      setOffen(board)
      neuLaden()
    } catch (e) { setFehler('Board nicht angelegt: ' + e.message) }
    setArbeitet(false)
  }

  const archivieren = async (b) => {
    if (!window.confirm(`„${b.titel}“ archivieren? Es verschwindet aus der Liste, gelöscht wird nichts.`)) return
    try { await boardAendern(b.id, { archiviert: true }, ich); neuLaden() }
    catch (e) { setFehler('Archivieren fehlgeschlagen: ' + e.message) }
  }

  if (offen) {
    return <BoardEditor key={offen.id} board={offen} ich={ich} team={team} onZurueck={() => { setOffen(null); neuLaden() }} />
  }

  const karte = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14 }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}><LayoutDashboard size={18} /> Boards</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 3 }}>Gemeinsam brainstormen — live, mit dem echten Team. Nur für Admins und Manager sichtbar.</div>
        </div>
      </div>

      {fehler && <div style={{ ...karte, borderColor: '#7f1d1d', color: '#fca5a5', padding: '10px 14px', fontSize: 13 }}>{fehler}</div>}

      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 9 }}>Neues Board</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
          {VORLAGEN.map(v => {
            const Icon = VORLAGE_ICON[v.key] || Square
            return (
              <button key={v.key} type="button" onClick={() => setNeu({ vorlage: v.key, titel: v.key === 'leer' ? '' : v.titel })}
                style={{ ...karte, padding: 14, textAlign: 'left', cursor: 'pointer', color: 'var(--text-primary)', fontFamily: 'inherit', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bg-card2)', border: '1px solid var(--border-bright)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={17} /></span>
                <span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 700 }}>{v.titel} <Plus size={13} color="var(--text-muted)" /></span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.4 }}>{v.text}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 9 }}>Eure Boards</div>
        {boards === null ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Lädt …</div>
        ) : boards.length === 0 ? (
          <div style={{ ...karte, padding: 18, fontSize: 13, color: 'var(--text-secondary)' }}>Noch keine Boards. Oben eine Vorlage wählen.</div>
        ) : (
          <div style={{ ...karte, overflow: 'hidden' }}>
            {boards.map((b, i) => {
              const Icon = VORLAGE_ICON[b.vorlage] || Square
              return (
                <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                  <Icon size={16} color="var(--text-secondary)" />
                  <button type="button" onClick={() => setOffen(b)} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{b.titel}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {VORLAGE_NAME[b.vorlage] || 'Board'} · {b.aktualisiert_von ? `${b.aktualisiert_von}, ` : ''}{wann(b.aktualisiert_am)}
                    </span>
                  </button>
                  <button type="button" onClick={() => setOffen(b)} style={{ background: '#7c3aed', border: 'none', borderRadius: 9, padding: '7px 13px', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>Öffnen</button>
                  <button type="button" onClick={() => archivieren(b)} title="Archivieren" aria-label={`${b.titel} archivieren`} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 9, padding: '7px 9px', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex' }}><Archive size={14} /></button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {neu && (
        <div onClick={() => !arbeitet && setNeu(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ ...karte, width: 'min(420px, 100%)', padding: 18, display: 'flex', flexDirection: 'column', gap: 12, borderColor: 'var(--border-bright)' }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Neues Board · {VORLAGE_NAME[neu.vorlage]}</div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
              Name
              <input autoFocus value={neu.titel} onChange={e => setNeu(n => ({ ...n, titel: e.target.value.slice(0, 120) }))} onKeyDown={e => { if (e.key === 'Enter') anlegen() }}
                placeholder="z. B. Team-Struktur Q4"
                style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', padding: 9, fontFamily: 'inherit', fontSize: 14 }} />
            </label>
            {neu.vorlage === 'team' && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                {team ? `Legt Leitung und Schichten an und setzt ${team.chatter.filter(c => c.schicht).length} Leute aus dem Dienstplan dieser Woche in ihre Hauptschicht. Alles lässt sich danach umbenennen und verschieben.` : 'Team wird geladen …'}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => setNeu(null)} disabled={arbeitet} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 14px', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>Abbrechen</button>
              <button type="button" onClick={anlegen} disabled={arbeitet || !neu.titel.trim() || (neu.vorlage === 'team' && !team)}
                style={{ background: '#7c3aed', border: 'none', borderRadius: 9, padding: '8px 14px', color: '#fff', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, opacity: (arbeitet || !neu.titel.trim()) ? 0.5 : 1 }}>
                {arbeitet ? 'Legt an …' : 'Anlegen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
