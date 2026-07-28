// src/systemMessage.js
// v4.0.0 — System-Nachrichten lesbar machen.
//
// Der Telegram-Bot und die Edge Function `status-auto-clear` legen Statusmeldungen
// als Marker in `messages.text` ab: [STATUS_UNAVAILABLE bis 20:00], [CONTENT_NOTIFY],
// [STATUS_AVAILABLE_AUTO]. Im Chat standen die bisher roh drin und sahen aus wie
// versehentlich reingerutschter Code.
//
// Diese Datei übersetzt sie an EINER Stelle. Wer neue Marker einführt, ergänzt sie
// hier — Chat, Thread-Vorschau und Portale ziehen automatisch nach.

const STATUS_LABELS = {
  available: { icon: '🟢', label: 'Wieder verfügbar', tone: '#10b981' },
  available_auto: { icon: '🟢', label: 'Automatisch wieder verfügbar', tone: '#10b981' },
  pause: { icon: '🟡', label: 'Pause', tone: '#f59e0b' },
  unavailable: { icon: '🔴', label: 'Nicht verfügbar', tone: '#ef4444' },
  busy: { icon: '🔴', label: 'Beschäftigt', tone: '#ef4444' },
}

/**
 * Prüft, ob ein Nachrichtentext eine System-Meldung ist.
 * @returns {{icon:string,label:string,tone:string}|null} null = normale Nachricht
 */
export function parseSystemMessage(text) {
  const t = (text || '').trim()
  if (!t.startsWith('[') || !t.endsWith(']')) return null

  if (t === '[CONTENT_NOTIFY]') {
    return { icon: '📸', label: 'Neuer Content im OF-Tresor', tone: '#22c55e' }
  }

  const m = t.match(/^\[STATUS_([A-Z_]+)(?:\s+(.*?))?\]$/)
  if (m) {
    const key = m[1].toLowerCase()
    const suffix = (m[2] || '').trim()          // z.B. "bis 16:00"
    const known = STATUS_LABELS[key]
    if (known) {
      return { ...known, label: suffix ? `${known.label} ${suffix}` : known.label }
    }
    // Unbekannter Status — wenigstens nicht mehr wie Code aussehen lassen
    return {
      icon: 'ℹ️',
      label: `Status: ${key.replace(/_/g, ' ')}${suffix ? ' ' + suffix : ''}`,
      tone: '#8888aa',
    }
  }

  return null
}

/** Kurzform für Thread-Listen und Vorschauen: "🔴 Nicht verfügbar bis 20:00" */
export function systemMessagePreview(text) {
  const sys = parseSystemMessage(text)
  return sys ? `${sys.icon} ${sys.label}` : null
}
