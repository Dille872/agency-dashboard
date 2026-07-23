// src/telegram.js
// v3.45.0: SICHERHEIT — Bot-Token komplett aus dem Frontend entfernt.
// Alle Telegram-Aufrufe laufen jetzt serverseitig über die Edge Function
// "send-telegram". Der Token liegt nur noch als Supabase-Secret TELEGRAM_BOT_TOKEN.
// Die exportierten Funktionsnamen/-signaturen sind unverändert — die Komponenten
// (ChatterPortal, ScheduleTab, ModelPortal, TodoTab, CommTab) müssen NICHT angepasst werden.
import { supabase } from './supabase'

const OWNER_ID = '1538601588'
const REY_TELEGRAM_ID = '528328429'

// Zentraler Aufruf der Edge Function. Gibt die Telegram-Antwort (JSON) zurück,
// damit sich der Rückgabewert wie vorher (res.json()) verhält.
async function callTelegram(payload) {
  const { data, error } = await supabase.functions.invoke('send-telegram', {
    body: payload,
  })
  if (error) {
    console.error('send-telegram Fehler:', error)
    return { ok: false, description: error.message || 'send-telegram fehlgeschlagen' }
  }
  return data
}

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

export { OWNER_ID }
