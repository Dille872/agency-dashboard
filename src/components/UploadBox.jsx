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
    const file = e.dataTransfer.files[0]
    handleFile(file)
  }

  return (
    <div
      onClick={() => ref.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      style={{
        border: `1px dashed ${dragging ? 'var(--accent)' : 'var(--border-bright)'}`,
        borderRadius: 'var(--radius)',
        padding: '14px 20px',
        cursor: 'pointer',
        background: dragging ? 'rgba(124,58,237,0.08)' : 'var(--bg-card)',
        transition: 'all 0.2s',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minWidth: 200,
        flex: 1,
      }}
    >
      <input ref={ref} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{label}</div>
      <div style={{ color: lastFileName ? 'var(--green)' : 'var(--text-secondary)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>
        {lastFileName ? `✓ ${lastFileName}` : '+ CSV hochladen'}
      </div>
      {lastDate && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Letzter Upload: {lastDate}</div>}
    </div>
  )
}
