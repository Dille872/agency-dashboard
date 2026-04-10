import React, { useRef, useState } from 'react'

export default function UploadBox({ label, onFile, lastFileName, lastDate }) {
  const ref = useRef()
  const [dragging, setDragging] = useState(false)

  const handleFile = (file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => onFile(file.name, e.target.result)
    reader.readAsText(file, 'utf-8')
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  return (
    <div
      onClick={() => ref.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      style={{
        border: `1px dashed ${dragging ? 'var(--accent)' : lastFileName ? 'rgba(16,185,129,0.4)' : 'var(--border-bright)'}`,
        borderRadius: 'var(--radius)',
        padding: '10px 16px',
        cursor: 'pointer',
        background: dragging ? 'rgba(124,58,237,0.08)' : lastFileName ? 'rgba(16,185,129,0.04)' : 'var(--bg-card)',
        transition: 'all 0.2s',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        minWidth: 160,
        flex: 1,
      }}
    >
      <input ref={ref} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{label}</div>
      {lastFileName ? (
        <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>
          ✓ Last update: {lastDate}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>+ CSV hochladen</div>
      )}
    </div>
  )
}
