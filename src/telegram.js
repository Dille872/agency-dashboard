const BOT_TOKEN = '8396910457:AAEVuNIlRGlNfa0_vUaONh6QGt7VCYpDAyE'
const OWNER_ID = '1538601588'
const API = `https://api.telegram.org/bot${BOT_TOKEN}`

export async function sendTelegramMessage(chatId, text) {
  const res = await fetch(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
  return res.json()
}

export async function notifyOwner(text) {
  return sendTelegramMessage(OWNER_ID, text)
}

export async function getUpdates(offset = 0) {
  const res = await fetch(`${API}/getUpdates?offset=${offset}&timeout=5`)
  return res.json()
}

// v2.9.8: Einzelnes Bild senden (mit optionaler Caption)
export async function sendTelegramPhoto(chatId, photoUrl, caption = '') {
  const body = { chat_id: chatId, photo: photoUrl, parse_mode: 'HTML' }
  if (caption) body.caption = caption
  const res = await fetch(`${API}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

// v2.9.8: Mehrere Bilder als Album senden (max 10 pro Album)
// Caption nur am ersten Bild — Telegram-Konvention
export async function sendTelegramMediaGroup(chatId, photoUrls, caption = '') {
  if (!photoUrls || photoUrls.length === 0) return { ok: false, description: 'Keine Bilder' }
  if (photoUrls.length === 1) return sendTelegramPhoto(chatId, photoUrls[0], caption)

  const media = photoUrls.slice(0, 10).map((url, idx) => {
    const item = { type: 'photo', media: url }
    if (idx === 0 && caption) {
      item.caption = caption
      item.parse_mode = 'HTML'
    }
    return item
  })
  const res = await fetch(`${API}/sendMediaGroup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, media }),
  })
  return res.json()
}

export { OWNER_ID, BOT_TOKEN }

const REY_TELEGRAM_ID = '528328429'
const CHRIS_TELEGRAM_ID = '1538601588'

export async function notifyAdmins(text) {
  await notifyOwner(text)
  await sendTelegramMessage(REY_TELEGRAM_ID, text)
}
