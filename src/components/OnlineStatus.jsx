// Helper component - two dots per chatter
import React from 'react'

export default function OnlineStatus({ dashboardOnline, shiftOnline }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: dashboardOnline ? '#10b981' : '#4a4a6a', flexShrink: 0 }} />
        <span style={{ fontSize: 8, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Dashboard</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: shiftOnline ? '#10b981' : '#4a4a6a', flexShrink: 0 }} />
        <span style={{ fontSize: 8, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Schicht</span>
      </div>
    </div>
  )
}
