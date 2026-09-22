import React from 'react'

export default function Card({ title, children, style = {}, accent }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${accent ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 16, // v4.84.0: neuer Look
      padding: '20px 22px',
      boxShadow: accent ? 'var(--shadow-glow)' : 'var(--shadow)',
      ...style,
    }}>
      {title && (
        // v4.84.0: Titel im neuen Stil — normal geschrieben, fett, ohne lila Strich
        <div style={{
          fontSize: 15,
          color: 'var(--text-primary)',
          fontWeight: 700,
          marginBottom: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          {title}
        </div>
      )}
      {children}
    </div>
  )
}
