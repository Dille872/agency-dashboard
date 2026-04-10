const BOT_TOKEN = '8396910457:AAEeZdCISpbNDfS00uy-EI-SBy1MsY0ztZ8'
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

export { OWNER_ID, BOT_TOKEN }

const REY_TELEGRAM_ID = '528328429'
const CHRIS_TELEGRAM_ID = '1538601588'

export async function notifyAdmins(text) {
  await notifyOwner(text)
  await sendTelegramMessage(REY_TELEGRAM_ID, text)
}
