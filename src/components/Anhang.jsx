import React from 'react'

// v4.82.1: Ein Anhang im Chat — Bild, Video oder Sprachnachricht.
// Vorher zeigte der Chatter-Chat jeden Anhang als <img>; eine Sprachnachricht
// war dort ein kaputtes Bild. Telegram-Sprachnachrichten sind .oga/.ogg —
// ältere Safari-Versionen (iPhone/Mac) spielen das nicht ab, deshalb steht
// unter Audio immer ein Link zum Herunterladen.

export function anhangArt(url) {
  const u = String(url || '').split('?')[0].toLowerCase()
  if (/\.(mp4|mov|webm|m4v)$/.test(u)) return 'video'
  if (/\.(ogg|oga|opus|mp3|m4a|wav|aac)$/.test(u)) return 'audio'
  if (/\.(jpg|jpeg|png|webp|gif|heic)$/.test(u)) return 'bild'
  return 'datei'
}

const link = { fontSize: 11, color: '#a78bfa', textDecoration: 'none', fontWeight: 600 }

export default function Anhang({ url, breite = '100%' }) {
  const art = anhangArt(url)
  if (art === 'video') {
    return <video src={url} controls playsInline preload="metadata" style={{ width: breite, maxHeight: 280, borderRadius: 8, display: 'block', background: '#000' }} />
  }
  if (art === 'audio') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: breite, maxWidth: '100%' }}>
        <audio src={url} controls preload="metadata" style={{ width: '100%', display: 'block' }} />
        <a href={url} target="_blank" rel="noreferrer" download style={link}>🎤 Sprachnachricht herunterladen</a>
      </div>
    )
  }
  if (art === 'bild') {
    return (
      <a href={url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
        <img src={url} alt="" style={{ width: breite, borderRadius: 8, display: 'block', border: '1px solid var(--border)' }} />
      </a>
    )
  }
  return <a href={url} target="_blank" rel="noreferrer" download style={{ ...link, fontSize: 12.5 }}>📎 Datei öffnen</a>
}
