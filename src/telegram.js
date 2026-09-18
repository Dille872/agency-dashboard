// src/telegram.js
// v3.45.0: SICHERHEIT — Bot-Token komplett aus dem Frontend entfernt.
// Alle Telegram-Aufrufe laufen jetzt serverseitig über die Edge Function
// "send-telegram". Der Token liegt nur noch als Supabase-Secret TELEGRAM_BOT_TOKEN.
// Die exportierten Funktionsnamen/-signaturen sind unverändert — die Komponenten
// (ChatterPortal, ScheduleTab, ModelPortal, TodoTab, CommTab) müssen NICHT angepasst werden.
import { supabase } from './supabase'

const OWNER_ID = '1538601588'
const REY_TELEGRAM_ID = '528328429'

// v4.48.0: Telegram-Text absichern.
// Wir senden mit parse_mode HTML. Ein freies „<" oder „&" im Nutzertext
// („<3", „a<b", „M&M") lässt Telegram die ganze Nachricht mit 400 ablehnen.
// Erlaubte Telegram-Tags (<b>, <i>, <a href="…"> …) und fertige Entities
// bleiben stehen, alles andere wird escaped.
const ERLAUBT = /<\/?(?:b|strong|i|em|u|ins|s|strike|del|code|pre|blockquote|tg-spoiler)>|<a\s+href="[^"<>]*">|<\/a>|&(?:lt|gt|amp|quot|#\d+|#x[0-9a-fA-F]+);/g
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function sicheresTelegramHtml(text) {
  if (typeof text !== 'string' || !text) return text
  let out = '', last = 0, m
  ERLAUBT.lastIndex = 0
  while ((m = ERLAUBT.exec(text)) !== null) {
    out += esc(text.slice(last, m.index)) + m[0]
    last = m.index + m[0].length
  }
  return out + esc(text.slice(last))
}

// Notfall-Variante: alle Tags raus, alles escapen — für den Fall, dass die
// Tags selbst kaputt sind (z. B. ein <b> ohne </b> im Nutzertext).
function nurText(text) {
  if (typeof text !== 'string' || !text) return text
  return esc(text.replace(/<\/?[a-zA-Z][^<>]*>/g, ''))
}

// v4.48.0: Fehlschläge sichtbar machen. callTelegram wirft bewusst NICHT —
// über 20 Aufrufstellen verlassen sich darauf, dass danach noch gespeichert
// wird. Stattdessen geht ein Event raus, das App.jsx als Hinweis anzeigt.
function meldeFehler(payload, description) {
  const vorschau = String(payload?.text || payload?.caption || '')
    .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)
  try {
    window.dispatchEvent(new CustomEvent('telegram-fehler', {
      detail: { chatId: payload?.chatId, description, vorschau },
    }))
  } catch (_) { /* kein window */ }
}

// Die Function antwortet bei Telegram-Fehlern mit 4xx. supabase-js liefert dann
// nur „non-2xx status code" — die eigentliche Begründung steckt im Body.
async function fehlerText(error) {
  try {
    const body = await error?.context?.json?.()
    if (body?.description) return body.description
  } catch (_) { /* Body nicht lesbar */ }
  return error?.message || 'send-telegram fehlgeschlagen'
}

async function invoke(payload) {
  const { data, error } = await supabase.functions.invoke('send-telegram', { body: payload })
  if (error) return { ok: false, description: await fehlerText(error) }
  return data || { ok: false, description: 'Leere Antwort' }
}

// Zentraler Aufruf der Edge Function. Gibt die Telegram-Antwort (JSON) zurück,
// damit sich der Rückgabewert wie vorher (res.json()) verhält: { ok, description, … }.
async function callTelegram(payload) {
  const sicher = { ...payload }
  if (sicher.text) sicher.text = sicheresTelegramHtml(sicher.text)
  if (sicher.caption) sicher.caption = sicheresTelegramHtml(sicher.caption)

  let res = await invoke(sicher)
  // Formatierung kaputt → einmal als reiner Text nachschieben, statt die
  // Nachricht zu verlieren.
  if (!res?.ok && /can't parse entities/i.test(res?.description || '')) {
    const plain = { ...payload }
    if (plain.text) plain.text = nurText(plain.text)
    if (plain.caption) plain.caption = nurText(plain.caption)
    res = await invoke(plain)
  }
  if (!res?.ok) {
    console.error('Telegram nicht zugestellt:', res?.description, payload?.chatId)
    if (payload?.action !== 'getUpdates') meldeFehler(payload, res?.description || 'Unbekannter Fehler')
  }
  return res
}

// v4.48.0: Kurzform für Aufrufer, die den Zustellstatus speichern wollen.
export const zugestellt = (res) => res?.ok === true

export async function sendTelegramMessage(chatId, text) {
  return callTelegram({ action: 'sendMessage', chatId, text })
}

export async function notifyOwner(text) {
  return sendTelegramMessage(OWNER_ID, text)
}

export async function getUpdates(offset = 0) {
  return callTelegram({ action: 'getUpdates', offset })
}

// v2.9.8: Einzelnes Bild senden (mit optionaler Caption)
export async function sendTelegramPhoto(chatId, photoUrl, caption = '') {
  return callTelegram({ action: 'sendPhoto', chatId, photoUrl, caption })
}

// v2.9.8: Mehrere Bilder als Album senden (max 10 pro Album)
export async function sendTelegramMediaGroup(chatId, photoUrls, caption = '') {
  if (!photoUrls || photoUrls.length === 0) return { ok: false, description: 'Keine Bilder' }
  return callTelegram({ action: 'sendMediaGroup', chatId, photoUrls, caption })
}

export async function notifyAdmins(text) {
  await notifyOwner(text)
  await sendTelegramMessage(REY_TELEGRAM_ID, text)
}

// v4.35.0: Schichtübergabe verschicken.
// Die Function ermittelt selbst, wer die Schicht übernimmt, und schickt die
// Übergabe dorthin plus an Chris und Rey. Bewusst dieselbe Function, die auch
// der Telegram-Bot ruft — die Frage „wer übernimmt?" darf es nur einmal geben.
//
// Der Aufrufer wertet das Ergebnis aus: `ok` (Aufruf geklappt), `gefunden`
// (wie viele Nachfolger im Plan standen) und `zugestellt` (ob wenigstens einer
// per Telegram erreicht wurde). Eine Erfolgsmeldung, obwohl niemand erreicht
// wurde, wäre schlimmer als gar keine — dann verlässt sich jemand darauf, dass
// die nächste Schicht Bescheid weiß.
export async function sendeSchichtuebergabe(logId) {
  if (!logId) return { ok: false, error: 'log_id fehlt' }
  const { data, error } = await supabase.functions.invoke('handover-notify', {
    body: { log_id: logId },
  })
  if (error) {
    console.warn('handover-notify Fehler:', error)
    return { ok: false, error: error.message || 'handover-notify fehlgeschlagen' }
  }
  return data
}

export { OWNER_ID }
