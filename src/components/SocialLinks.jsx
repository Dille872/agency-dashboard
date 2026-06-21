import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'

// v3.37.0: Social-Media-Kanäle im Model-Board.
// ----------------------------------------------------------------------------
// Speicherung OHNE neue Tabelle/Spalten: Einträge liegen in `model_board`
// mit category = 'social_media'. Dabei gilt:
//   - title   = Plattform-Key (z.B. 'instagram') ODER freier Name bei "Andere"
//   - content = der Link / die URL
//   - sort_order = Reihenfolge
// Dadurch greifen RLS/Backups/Export wie beim restlichen Board, und es ist
// keine SQL-Migration nötig.
//
// Exporte:
//   SOCIAL_CATEGORY        – Konstante für die category
//   SOCIAL_PLATFORMS       – Plattform-Definitionen
//   resolvePlatform(title) – Plattform-Def zu einem gespeicherten Eintrag
//   SocialLinksView        – read-only Anzeige (Chatter, Übersichten)
//   SocialLinksEditor      – Editor (Model selbst + Admin/Manager)
// ----------------------------------------------------------------------------

export const SOCIAL_CATEGORY = 'social_media'

// Die 5 gängigsten zuerst (als Schnellauswahl-Chips), danach weitere bekannte.
export const SOCIAL_PLATFORMS = [
  { key: 'instagram', label: 'Instagram', color: '#E1306C', placeholder: 'https://instagram.com/username' },
  { key: 'facebook',  label: 'Facebook',  color: '#1877F2', placeholder: 'https://facebook.com/username' },
  { key: 'tiktok',    label: 'TikTok',    color: '#ff2d55', placeholder: 'https://tiktok.com/@username' },
  { key: 'youtube',   label: 'YouTube',   color: '#FF0000', placeholder: 'https://youtube.com/@channel' },
  { key: 'twitch',    label: 'Twitch',    color: '#9146FF', placeholder: 'https://twitch.tv/username' },
  { key: 'x',         label: 'X',         color: '#e7e9ea', placeholder: 'https://x.com/username' },
  { key: 'onlyfans',  label: 'OnlyFans',  color: '#00AFF0', placeholder: 'https://onlyfans.com/username' },
  { key: 'snapchat',  label: 'Snapchat',  color: '#FFFC00', placeholder: 'https://snapchat.com/add/username' },
  { key: 'reddit',    label: 'Reddit',    color: '#FF4500', placeholder: 'https://reddit.com/user/username' },
  { key: 'telegram',  label: 'Telegram',  color: '#26A5E4', placeholder: 'https://t.me/username' },
]

const CUSTOM_PLATFORM = { key: 'custom', label: 'Andere', color: '#94a3b8', placeholder: 'https://...' }

// Plattform-Def zu einem gespeicherten title finden (matcht key oder label).
// Unbekannte => Custom (generisches Icon, freier Name).
export function resolvePlatform(title) {
  const t = (title || '').trim().toLowerCase()
  const found = SOCIAL_PLATFORMS.find(p => p.key === t || p.label.toLowerCase() === t)
  if (found) return found
  return { ...CUSTOM_PLATFORM, label: (title || '').trim() || 'Link' }
}

// --- Marken-Icons (Inline-SVG, dependency-frei) ------------------------------
// fill=true => mit currentColor gefüllt; sonst Stroke-Stil.
const ICONS = {
  instagram: { fill: false, body: <><rect x="2" y="2" width="20" height="20" rx="5.5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" stroke="none" /></> },
  facebook:  { fill: true,  body: <path d="M24 12.073c0-6.627-5.373-12-12-12S0 5.446 0 12.073c0 5.99 4.388 10.954 10.125 11.854V15.56H7.078v-3.487h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.487h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /> },
  tiktok:    { fill: true,  body: <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" /> },
  youtube:   { fill: true,  body: <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" /> },
  twitch:    { fill: true,  body: <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" /> },
  x:         { fill: true,  body: <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932zM17.61 20.644h2.039L6.486 3.24H4.298z" /> },
  onlyfans:  { fill: false, body: <><circle cx="12" cy="12" r="9.5" /><circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none" /></> },
  reddit:    { fill: true,  body: <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-6.991 4.87-3.862 0-6.99-2.176-6.99-4.87 0-.183.016-.366.046-.547-.534-.293-.919-.914-.919-1.586 0-.967.787-1.754 1.754-1.754.484 0 .92.196 1.234.514 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12c-.689 0-1.25.561-1.25 1.25 0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" /> },
  telegram:  { fill: true,  body: <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212-.07-.062-.174-.041-.249-.024-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" /> },
  // Fallback: generisches Link-Symbol (Stroke)
  custom:    { fill: false, body: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></> },
}

function SocialIcon({ platformKey, size = 18 }) {
  const def = ICONS[platformKey] || ICONS.custom
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill={def.fill ? 'currentColor' : 'none'}
      stroke={def.fill ? 'none' : 'currentColor'}
      strokeWidth={def.fill ? 0 : 2}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, display: 'block' }}
    >
      {def.body}
    </svg>
  )
}

function normalizeUrl(raw) {
  const v = (raw || '').trim()
  if (!v) return ''
  if (/^https?:\/\//i.test(v)) return v
  return 'https://' + v.replace(/^\/+/, '')
}

// ===========================================================================
// Read-only Anzeige – für Chatter & Übersichten.
// Props: links = Array von model_board-Rows ({ id, title, content }).
//        accent (optional) = Akzentfarbe der Karte.
//        embedded (optional) = nur die Buttons rendern (ohne eigene Karte).
// ===========================================================================
export function SocialLinksView({ links = [], accent = '#ec4899', embedded = false }) {
  const sorted = [...links].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  const buttons = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {sorted.length === 0 && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Keine Kanäle hinterlegt</span>
      )}
      {sorted.map(item => {
        const p = resolvePlatform(item.title)
        const href = normalizeUrl(item.content)
        const inner = (
          <>
            <span style={{ color: p.color, display: 'flex' }}><SocialIcon platformKey={p.key} size={15} /></span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>{p.label}</span>
          </>
        )
        const style = {
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '5px 10px', borderRadius: 7,
          background: 'var(--bg-card2)', border: `1px solid ${p.color}55`,
          textDecoration: 'none', cursor: href ? 'pointer' : 'default',
        }
        return href
          ? <a key={item.id} href={href} target="_blank" rel="noopener noreferrer" style={style} title={href}>{inner}</a>
          : <span key={item.id} style={style}>{inner}</span>
      })}
    </div>
  )

  if (embedded) return buttons

  return (
    <div style={{ background: 'var(--bg-card)', border: `1px solid ${accent}33`, borderLeft: `3px solid ${accent}`, borderRadius: '0 9px 9px 0', padding: '10px 12px' }}>
      <div style={{ fontSize: 9, color: accent, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 8 }}>Social Media</div>
      {buttons}
    </div>
  )
}

// ===========================================================================
// Editor – für das Model selbst (ModelPortal) und Admin/Manager (CommTab).
// Props:
//   modelName  (string, required) – model_board.model_name
//   accent     (optional)         – Akzentfarbe
//   onChanged  (optional)         – Callback nach jeder Änderung
//   compact    (optional)         – etwas kompaktere Karte
// ===========================================================================
export function SocialLinksEditor({ modelName, accent = '#ec4899', onChanged, compact = false }) {
  const [links, setLinks] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [selKey, setSelKey] = useState(null)
  const [customName, setCustomName] = useState('')
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState(null)
  const [editUrl, setEditUrl] = useState('')

  const load = async () => {
    if (!modelName) { setLinks([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from('model_board')
      .select('*')
      .eq('model_name', modelName)
      .eq('category', SOCIAL_CATEGORY)
      .order('sort_order')
    setLinks(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [modelName])

  const logActivity = async (action, details) => {
    try {
      await supabase.from('model_board_activity').insert({ model_name: modelName, action, category: SOCIAL_CATEGORY, details })
    } catch (_) { /* Logging ist optional */ }
  }

  const resetAdd = () => { setSelKey(null); setCustomName(''); setUrl(''); setAdding(false) }

  const addLink = async () => {
    if (!selKey) return
    const isCustom = selKey === 'custom'
    const title = isCustom ? customName.trim() : selKey
    const link = normalizeUrl(url)
    if (isCustom && !title) return
    if (!link) return
    setSaving(true)
    const { error } = await supabase.from('model_board').insert({
      model_name: modelName,
      category: SOCIAL_CATEGORY,
      title,
      content: link,
      sort_order: links.length,
    })
    if (!error) {
      await logActivity('hinzugefügt', resolvePlatform(title).label)
      resetAdd()
      await load()
      if (onChanged) onChanged()
    }
    setSaving(false)
  }

  const saveEdit = async (item) => {
    const link = normalizeUrl(editUrl)
    if (!link || link === item.content) { setEditId(null); return }
    await supabase.from('model_board').update({ content: link }).eq('id', item.id)
    await logActivity('bearbeitet', resolvePlatform(item.title).label)
    setEditId(null)
    await load()
    if (onChanged) onChanged()
  }

  const removeLink = async (item) => {
    await supabase.from('model_board').delete().eq('id', item.id)
    await logActivity('gelöscht', resolvePlatform(item.title).label)
    await load()
    if (onChanged) onChanged()
  }

  const inputS = { background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '7px 9px', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }
  const selectedPlatform = selKey ? (selKey === 'custom' ? CUSTOM_PLATFORM : SOCIAL_PLATFORMS.find(p => p.key === selKey)) : null

  return (
    <div style={{ background: 'var(--bg-card)', border: `1px solid ${accent}33`, borderLeft: `3px solid ${accent}`, borderRadius: '0 10px 10px 0', padding: compact ? '12px 14px' : '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 3, height: 14, background: accent, borderRadius: 2, display: 'inline-block' }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Social Media Kanäle</span>
          <span style={{ fontSize: 10, background: 'var(--bg-card2)', color: 'var(--text-muted)', padding: '1px 7px', borderRadius: 10, border: '1px solid var(--border)' }}>{links.length}</span>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: `${accent}26`, color: accent, border: `1px solid ${accent}55`, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>+ Kanal</button>
        )}
      </div>

      {/* Add-Formular */}
      {adding && (
        <div style={{ padding: 12, background: 'var(--bg-card2)', borderRadius: 8, border: `1px solid ${accent}55`, marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Plattform wählen</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {[...SOCIAL_PLATFORMS, CUSTOM_PLATFORM].map(p => {
              const active = selKey === p.key
              return (
                <button key={p.key} onClick={() => { setSelKey(p.key); if (p.key !== 'custom') setCustomName('') }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 11,
                    background: active ? `${p.color}26` : 'var(--bg-input)', color: active ? p.color : 'var(--text-secondary)', border: `1px solid ${active ? p.color : 'var(--border)'}` }}>
                  <span style={{ color: p.color, display: 'flex' }}><SocialIcon platformKey={p.key} size={14} /></span>
                  {p.label}
                </button>
              )
            })}
          </div>

          {selKey && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {selKey === 'custom' && (
                <input value={customName} onChange={e => setCustomName(e.target.value)} style={inputS} placeholder="Name der Plattform *" autoFocus />
              )}
              <input value={url} onChange={e => setUrl(e.target.value)} style={inputS}
                placeholder={(selectedPlatform && selectedPlatform.placeholder) || 'https://...'}
                onKeyDown={e => { if (e.key === 'Enter') addLink() }} autoFocus={selKey !== 'custom'} />
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={addLink} disabled={saving} style={{ flex: 1, fontSize: 12, padding: '7px 10px', borderRadius: 7, background: accent, color: '#fff', border: 'none', cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 700, opacity: saving ? 0.6 : 1 }}>{saving ? 'Speichert…' : 'Hinzufügen'}</button>
                <button onClick={resetAdd} style={{ fontSize: 12, padding: '7px 14px', borderRadius: 7, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>Abbrechen</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Liste */}
      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Lädt…</div>
      ) : links.length === 0 && !adding ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Noch keine Kanäle hinterlegt. Mit „+ Kanal" hinzufügen.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {links.map(item => {
            const p = resolvePlatform(item.title)
            const href = normalizeUrl(item.content)
            const isEditing = editId === item.id
            return (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--bg-card2)', borderRadius: 7, border: '1px solid var(--border)' }}>
                <span style={{ color: p.color, display: 'flex' }}><SocialIcon platformKey={p.key} size={18} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{p.label}</div>
                  {isEditing ? (
                    <input value={editUrl} onChange={e => setEditUrl(e.target.value)} style={{ ...inputS, fontSize: 11, padding: '4px 7px', marginTop: 3 }}
                      onKeyDown={e => { if (e.key === 'Enter') saveEdit(item) }} autoFocus />
                  ) : (
                    <a href={href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: 'var(--text-secondary)', textDecoration: 'none', wordBreak: 'break-all' }}>{item.content}</a>
                  )}
                </div>
                {isEditing ? (
                  <>
                    <button onClick={() => saveEdit(item)} style={{ fontSize: 11, padding: '4px 9px', borderRadius: 6, background: 'rgba(16,185,129,0.18)', color: '#10b981', border: '1px solid rgba(16,185,129,0.4)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>OK</button>
                    <button onClick={() => setEditId(null)} style={{ fontSize: 11, padding: '4px 9px', borderRadius: 6, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>×</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => { setEditId(item.id); setEditUrl(item.content || '') }} title="Link bearbeiten" style={{ fontSize: 11, padding: '4px 9px', borderRadius: 6, background: 'var(--bg-input)', color: 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>✎</button>
                    <button onClick={() => removeLink(item)} title="Entfernen" style={{ fontSize: 11, padding: '4px 9px', borderRadius: 6, background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer', fontFamily: 'inherit' }}>×</button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
