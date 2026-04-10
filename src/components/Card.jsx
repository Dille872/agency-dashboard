import React from 'react'

export default function Card({ title, children, style = {}, accent }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${accent ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 'var(--radius)',
      padding: '20px 22px',
      boxShadow: accent ? 'var(--shadow-glow)' : 'var(--shadow)',
      ...style,
    }}>
      {title && (
        <div style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontWeight: 700,
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span style={{ width: 3, height: 12, background: 'var(--accent)', borderRadius: 2, display: 'inline-block' }} />
          {title}
        </div>
      )}
      {children}
    </div>
  )
}
