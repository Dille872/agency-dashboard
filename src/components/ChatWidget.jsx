import React, { useState } from 'react'
import { MessageCircle, ChevronDown } from 'lucide-react'
import CommTab from './CommTab'
import { useFabOpen } from '../fabPanel'

// v3.61.0: Chat als schwebende Bubble (wie bei Support-/KI-Bots) statt fester Seite.
// Wiederverwendet die bestehende Chat-Ansicht (<CommTab section="chat">) — Thread
// auswählen + chatten funktioniert damit genau wie im Chat-Tab. Der Chat wird ERST
// beim Öffnen gemountet (kein Dauerladen im Hintergrund). Ungelesen-Badge über `unread`.
export default function ChatWidget({ session, displayName, unread = 0 , isOpen, onToggle }) {
  const [open, setOpen] = useFabOpen(isOpen, onToggle)

  return (
    <>
      {open && (
        <div
          style={{
            position: 'fixed', right: 20, bottom: 150, zIndex: 99998,
            width: 'min(460px, calc(100vw - 40px))',
            height: 'min(660px, calc(100vh - 140px))',
            background: 'var(--bg-base)',
            border: '1px solid var(--border)',
            borderRadius: 16,
            boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
            overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
              <MessageCircle size={16} /> Chat
            </div>
            <button onClick={() => setOpen(false)} title="Minimieren"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex' }}>
              <ChevronDown size={20} />
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '10px 12px' }}>
            <CommTab session={session} section="chat" displayName={displayName} compact />
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(o => !o)}
        title="Chat"
        className="fab-btn"
        style={{
          position: 'fixed', right: 20, bottom: 20, zIndex: 99999,
          width: 54, height: 54, borderRadius: '50%',
          background: open ? 'rgba(124,58,237,0.18)' : 'rgba(255,255,255,0.06)',
          color: '#a78bfa',
          border: `1px solid ${open ? 'rgba(124,58,237,0.5)' : 'rgba(255,255,255,0.12)'}`,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.16s ease, border-color 0.16s ease',
        }}
      >
        {open
          ? <ChevronDown size={23} strokeWidth={2.6} />
          : <MessageCircle size={22} fill="currentColor" strokeWidth={0} />}
        {!open && unread > 0 && (
          <span style={{
            position: 'absolute', top: -3, right: -3,
            minWidth: 20, height: 20, padding: '0 5px', borderRadius: 999,
            background: '#ef4444', color: '#fff', fontSize: 11, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid var(--bg-base)', lineHeight: 1,
          }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    </>
  )
}
