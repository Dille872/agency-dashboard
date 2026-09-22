import React, { useEffect, useState } from 'react'

// ── Als App aufs Handy (v4.91.0) ───────────────────────────────────────────
// Das Dashboard hat jetzt ein Web-App-Manifest (public/manifest.webmanifest)
// samt Icons. Damit lässt es sich wie eine App auf den Home-Bildschirm legen:
// eigenes Icon, Vollbild ohne Browserleiste.
//
// - Android/Chrome: der Browser schickt „beforeinstallprompt“ — den fangen wir
//   ab und zeigen einen echten „Installieren“-Knopf.
// - iPhone/Safari: kein Knopf möglich, nur die Anleitung (Teilen → Zum Home-Bildschirm).
// - Läuft es schon als App (display-mode: standalone), zeigen wir nichts an.
//
// Bewusst KEIN Service Worker: der würde alte Versionen zwischenspeichern, und
// nach jedem Deploy müsste man die App erst neu laden. So bleibt alles live.

let gemerkterPrompt = null
const hoerer = new Set()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    gemerkterPrompt = e
    hoerer.forEach(f => f(e))
  })
  window.addEventListener('appinstalled', () => {
    gemerkterPrompt = null
    hoerer.forEach(f => f(null))
  })
}

export function laeuftAlsApp() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
}

function geraet() {
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}

function useInstallPrompt() {
  const [prompt, setPrompt] = useState(gemerkterPrompt)
  useEffect(() => { hoerer.add(setPrompt); return () => hoerer.delete(setPrompt) }, [])
  return prompt
}

const schritt = (nr, text, farbe) => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
    <span style={{ width: 26, height: 26, borderRadius: 13, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, background: farbe + '22', color: farbe, border: `1px solid ${farbe}66` }}>{nr}</span>
    <span style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.5, paddingTop: 2 }}>{text}</span>
  </div>
)

export function AppFenster({ onZu, farbe = '#7c3aed' }) {
  const prompt = useInstallPrompt()
  const [art, setArt] = useState(geraet() === 'android' ? 'android' : 'ios')
  const [fertig, setFertig] = useState(false)

  const installieren = async () => {
    if (!prompt) return
    prompt.prompt()
    const { outcome } = await prompt.userChoice.catch(() => ({}))
    if (outcome === 'accepted') setFertig(true)
    gemerkterPrompt = null
  }

  return (
    <div className="steckbrief-huelle" onClick={onZu} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div className="steckbrief-fenster" onClick={e => e.stopPropagation()} role="dialog" aria-label="Als App aufs Handy" style={{
        width: 'min(480px, 100%)', maxHeight: 'min(92vh, 760px)', boxSizing: 'border-box', background: 'var(--bg-card)',
        border: '1px solid var(--border)', borderRadius: '22px 22px 0 0', display: 'flex', flexDirection: 'column',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}>
        <div style={{ padding: '14px 18px 10px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <img src="/icon-192.png" alt="" width="44" height="44" style={{ borderRadius: 12, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--text-primary)' }}>Als App aufs Handy</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Eigenes Icon, Vollbild, ein Tipp zum Öffnen</div>
          </div>
          <button type="button" onClick={onZu} aria-label="Schließen" style={{ width: 36, height: 36, borderRadius: 11, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 17, cursor: 'pointer', flexShrink: 0 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {laeuftAlsApp() || fertig ? (
            <div style={{ padding: '14px 15px', borderRadius: 14, background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.4)', color: 'var(--ton-gruen)', fontSize: 14, fontWeight: 600 }}>
              ✓ {fertig ? 'Installiert — das Icon liegt jetzt auf deinem Home-Bildschirm.' : 'Läuft schon als App. Alles erledigt.'}
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 6 }}>
                {[['ios', '📱 iPhone'], ['android', '🤖 Android']].map(([k, t]) => (
                  <button key={k} type="button" className="chip-btn" onClick={() => setArt(k)} style={{
                    flex: 1, fontSize: 13, padding: '9px 12px', borderRadius: 20, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                    background: art === k ? farbe + '2a' : 'transparent', border: `1px solid ${art === k ? farbe : 'var(--border)'}`, color: art === k ? farbe : 'var(--text-secondary)',
                  }}>{t}</button>
                ))}
              </div>

              {art === 'android' && prompt && (
                <button type="button" className="gross-btn" onClick={installieren} style={{ width: '100%', padding: 14, borderRadius: 14, border: 'none', background: farbe, color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                  📲 Jetzt installieren
                </button>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {art === 'ios' ? (
                  <>
                    {schritt(1, <>Die Seite in <b>Safari</b> öffnen (nicht in Instagram, Telegram o. ä.).</>, farbe)}
                    {schritt(2, <>Unten auf <b>Teilen</b> tippen — das Quadrat mit dem Pfeil nach oben <span style={{ fontSize: 15 }}>⬆︎</span>.</>, farbe)}
                    {schritt(3, <>Runterscrollen und <b>„Zum Home-Bildschirm“</b> wählen.</>, farbe)}
                    {schritt(4, <>Oben rechts <b>„Hinzufügen“</b> — fertig. Ab jetzt über das Icon öffnen.</>, farbe)}
                  </>
                ) : (
                  <>
                    {schritt(1, <>Die Seite in <b>Chrome</b> öffnen.</>, farbe)}
                    {schritt(2, <>Oben rechts auf <b>⋮</b> tippen.</>, farbe)}
                    {schritt(3, <><b>„App installieren“</b> oder <b>„Zum Startbildschirm hinzufügen“</b> wählen.</>, farbe)}
                    {schritt(4, <>Bestätigen — das Icon liegt jetzt auf dem Startbildschirm.</>, farbe)}
                  </>
                )}
              </div>

              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55, padding: '11px 13px', borderRadius: 12, background: 'var(--ton-dunkel)', border: '1px solid var(--border)' }}>
                Beim ersten Öffnen der App meldest du dich einmal an, danach bleibst du angemeldet. Updates kommen automatisch — kein Neuinstallieren nötig.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Kachel für „Mehr“ — blendet sich aus, wenn es schon als App läuft.
export function AppKachel({ onOeffnen, farbe = '#7c3aed', style }) {
  if (laeuftAlsApp()) return null
  return (
    <button type="button" onClick={onOeffnen} data-help="app" style={{
      display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '13px 15px', borderRadius: 16, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
      background: `linear-gradient(135deg, ${farbe}1f, var(--bg-card) 70%)`, border: `1px solid ${farbe}55`, color: 'var(--text-primary)', ...style,
    }} className="app-kachel">
      <img src="/icon-192.png" alt="" width="38" height="38" style={{ borderRadius: 10, flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700 }}>Als App aufs Handy</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Icon auf den Home-Bildschirm legen</span>
      </span>
      <span style={{ fontSize: 18, color: 'var(--text-muted)' }}>›</span>
    </button>
  )
}
