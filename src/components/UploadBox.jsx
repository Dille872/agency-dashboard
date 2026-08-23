import React, { useRef, useState } from 'react'

// v4.31.0: optionale Mehrfachauswahl.
//   onFile(name, text)   — Einzeldatei, unveraendertes Verhalten der beiden
//                          bestehenden Upload-Boxen.
//   onFiles([{fileName, text}])
//                        — alle gewaehlten Dateien auf einmal. Nur wenn
//                          multiple gesetzt ist; die Model-Einzeldateien
//                          kommen zu 5–7 Stueck am Tag und sollen in einem
//                          Rutsch reingezogen werden koennen.
// status/statusColor ersetzen die "Last update"-Zeile, wenn eine Box etwas
// anderes melden will (z. B. "7 Accounts erfasst").
export default function UploadBox({
  label, onFile, onFiles, lastFileName, lastDate,
  multiple = false, status = null, statusColor = null, hint = null,
}) {
  const ref = useRef()
  const [dragging, setDragging] = useState(false)

  const lies = (file) => new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve({ fileName: file.name, text: e.target.result })
    reader.readAsText(file, 'utf-8')
  })

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter(Boolean)
    if (files.length === 0) return
    if (multiple && onFiles) {
      const gelesen = await Promise.all(files.map(lies))
      onFiles(gelesen)
      return
    }
    const { fileName, text } = await lies(files[0])
    onFile(fileName, text)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  const gefuellt = status ? true : !!lastFileName
  const rahmen = statusColor || (gefuellt ? 'rgba(16,185,129,0.4)' : null)

  return (
    <div
      onClick={() => ref.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      style={{
        border: `1px dashed ${dragging ? 'var(--accent)' : rahmen || 'var(--border-bright)'}`,
        borderRadius: 'var(--radius)',
        padding: '10px 16px',
        cursor: 'pointer',
        background: dragging ? 'rgba(124,58,237,0.08)' : gefuellt ? 'rgba(16,185,129,0.04)' : 'var(--bg-card)',
        transition: 'all 0.2s',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        minWidth: 160,
        flex: 1,
      }}
    >
      <input
        ref={ref} type="file" accept=".csv" multiple={multiple}
        style={{ display: 'none' }}
        onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
      />
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{label}</div>
      {status ? (
        <div style={{ fontSize: 12, color: statusColor || 'var(--green)', fontWeight: 600 }}>{status}</div>
      ) : lastFileName ? (
        <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>
          ✓ Last update: {lastDate}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {multiple ? '+ CSVs hochladen' : '+ CSV hochladen'}
        </div>
      )}
      {hint && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{hint}</div>
      )}
    </div>
  )
}
