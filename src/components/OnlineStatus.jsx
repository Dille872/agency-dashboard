// Helper component - two dots per chatter
import React from 'react'

export default function OnlineStatus({ dashboardOnline, shiftOnline }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <div style={{ width: 11, height: 11, borderRadius: '50%', background: dashboardOnline ? '#10b981' : '#2e2e5a', flexShrink: 0, boxShadow: dashboardOnline ? '0 0 6px rgba(16,185,129,0.5)' : 'none' }} />
        <span style={{ fontSize: 9, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Dashboard</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <div style={{ width: 11, height: 11, borderRadius: '50%', background: shiftOnline ? '#10b981' : '#2e2e5a', flexShrink: 0, boxShadow: shiftOnline ? '0 0 6px rgba(16,185,129,0.5)' : 'none' }} />
        <span style={{ fontSize: 9, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Schicht</span>
      </div>
    </div>
  )
}
