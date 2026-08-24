import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const SUPABASE_URL = Deno.env.get('DB_URL') || Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('DB_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const CHRIS_ID = '1538601588'
const REY_ID = '528328429'
const ADMIN_IDS = [CHRIS_ID, REY_ID]
// v3.79.0: Webhook-Absicherung. Wenn gesetzt, muss jeder Webhook-Aufruf den
// passenden X-Telegram-Bot-Api-Secret-Token mitschicken (per setWebhook konfiguriert).
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') || ''

const H = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Accept': 'application/json', 'Accept-Profile': 'public', 'Content-Profile': 'public' }

async function q(table: string, params = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, { headers: H })
  return r.json()
}
// v4.26.0: Schreibende Aufrufe haben ihren Response-Status nie geprueft. Ein
// abgelehnter Insert in `messages` — RLS, Constraint, Tippfehler im Spaltennamen —
// verschwand spurlos: der Absender bekam trotzdem "Danke, weitergeleitet", die
// Nachricht war aber nirgends. Jetzt landet der Fehlertext in den Function-Logs
// (Supabase -> Edge Functions -> telegram-bot -> Logs).
async function chk(r: Response, table: string, op: string) {
  if (!r.ok) {
    const body = await r.text().catch(() => '<keine Antwort lesbar>')
    console.error(`[db] ${op} auf ${table} fehlgeschlagen: ${r.status} ${r.statusText} — ${body}`)
  }
  return r.ok
}
async function ins(table: string, data: object) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: 'POST', headers: { ...H, 'Prefer': 'return=minimal' }, body: JSON.stringify(data) })
  return chk(r, table, 'insert')
}
async function upd(table: string, params: string, data: object) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, { method: 'PATCH', headers: { ...H, 'Prefer': 'return=minimal' }, body: JSON.stringify(data) })
  return chk(r, table, 'update')
}
async function ups(table: string, data: object, conflict: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflict}`, { method: 'POST', headers: { ...H, 'Prefer': 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(data) })
  return chk(r, table, 'upsert')
}
async function tg(chatId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }) })
}
function money(v: number) { return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function norm(s: string) { return s.toLowerCase().replace(/[^a-z0-9]/g, '') }

// ── v4.35.0: Schichtübergabe im Bot ──────────────────────────────────────────
// Ein Teil des Teams arbeitet ausschließlich über Telegram und öffnet das
// Dashboard nie. Ohne diesen Abschnitt wäre die Übergabe für diese Leute
// unsichtbar — sie würden weder gefragt noch informiert, und die Kette risse
// genau dort, wo sie am nötigsten ist.

const escHtml = (s: string) =>
  String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Wie lange nach dem Auschecken eine Antwort noch als Übergabe gilt.
const UEBERGABE_FENSTER_MIN = 15
// Wie weit zurück Übergaben anderer noch gezeigt werden — wie im Portal.
const UEBERGABE_RUECKBLICK_H = 16

// Ruft die Function auf, die ermittelt, wer übernimmt, und die Nachricht
// verschickt. Schlägt sie fehl, ist nichts verloren: die Übergabe steht in der
// Datenbank und im Dashboard — nur die Telegram-Zustellung fehlt.
async function benachrichtigeUebergabe(logId: string | number) {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/handover-notify`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_id: logId }),
    })
    if (!r.ok) console.error(`[uebergabe] Versand fehlgeschlagen: ${r.status} — ${await r.text().catch(() => '')}`)
    return r.ok
  } catch (e) {
    console.error('[uebergabe] handover-notify nicht erreichbar:', e)
    return false
  }
}

// Das zuletzt beendete Log dieser Person, sofern es noch im Antwortfenster liegt
// und noch keine Übergabe trägt. `handover_at` OHNE `handover_text` ist dabei der
// Merker „der Bot hat gefragt und wartet auf die Antwort" — so braucht der Ablauf
// keinen eigenen Zustand und übersteht auch einen Neustart der Function.
async function wartendeUebergabe(name: string) {
  const seit = new Date(Date.now() - UEBERGABE_FENSTER_MIN * 60000).toISOString()
  const logs = await q('shift_logs',
    `?display_name=eq.${encodeURIComponent(name)}` +
    `&checked_out_at=gte.${seit}&handover_text=is.null&handover_at=not.is.null` +
    `&order=checked_out_at.desc&limit=1`)
  return Array.isArray(logs) ? logs[0] : null
}

// Offene Übergaben ANDERER, die diese Person noch nicht bestätigt hat.
async function offeneUebergaben(name: string) {
  const seit = new Date(Date.now() - UEBERGABE_RUECKBLICK_H * 3600000).toISOString()
  // Zeitgrenze über `handover_at`, nicht über `checked_out_at`: eine per
  // /uebergabe während der laufenden Schicht geschriebene Übergabe hat noch gar
  // kein Check-out und wäre sonst unsichtbar — obwohl die Telegram-Nachricht
  // schon draußen ist und zu /gelesen auffordert.
  //
  // Großzügiges Limit, weil erst danach in JS gefiltert wird (eigene Übergaben
  // und bereits bestätigte fallen dort weg). Mit einem knappen Limit würden im
  // Betrieb offene Übergaben still hinten herausfallen.
  const logs = await q('shift_logs',
    `?handover_text=not.is.null&handover_at=gte.${seit}` +
    `&order=handover_at.desc&limit=100`)
  if (!Array.isArray(logs)) return []
  return logs.filter((l: any) =>
    norm(l.display_name || '') !== norm(name) &&
    !(l.handover_ack || []).some((a: string) => norm(a) === norm(name))
  )
}

function uebergabeText(l: any) {
  const wann = l.handover_at || l.checked_out_at
  const zeit = wann
    ? new Date(wann).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : ''
  return `🤝 <b>${escHtml(l.display_name)}</b>${l.shift ? ` · ${escHtml(l.shift)}` : ''}${zeit ? ` · ${zeit}` : ''}\n${escHtml(l.handover_text)}`
}

// ── Welcome-Messages ──
const WELCOME_MODEL = `👋 Hi und willkommen bei Thirteen 87 Collective!

Ich bin der Agency-Bot 🤖 und mach dir den Alltag leichter.

🎯 <b>WANN BESCHEID GEBEN?</b>

Du musst nicht jedes kleine Auf und Ab melden. Aber wenn:
  → du heute gar nicht erreichbar bist
  → du längere Zeit (mehr als 1-2h) wegmusst
  → du krank wirst oder deine Tage hast

…dann gib uns kurz Bescheid, damit das Team Bescheid weiß
und nicht ins Leere arbeitet.

So einfach geht's:
  <code>nicht verfügbar</code> → heute nicht erreichbar
  <code>pause bis 16 uhr</code> → längere Pause mit Endzeit
  <code>verfügbar</code> → wieder am Start

📸 <b>CONTENT HOCHGELADEN?</b>

Du lädst Content wie immer in deinen OF-Tresor.

Wenn du neuen Content reingestellt hast, schreib uns kurz:
  <code>/content</code> → Du hast neuen Content im Tresor

⚡ Besonders wichtig bei Memos oder Custom-Anfragen, wo
es schnell gehen muss — sobald du <code>/content</code> schickst, kriegt
das Team sofort eine Benachrichtigung und kann den Content
direkt verwenden statt zu warten.

❓ <b>HILFE</b>
  <code>/hilfe</code> → diese Übersicht jederzeit erneut

💬 <b>FRAGEN?</b>
Schreib mir einfach normal — das Team wird informiert
und meldet sich bei dir.`

const WELCOME_CHATTER = `👋 Hey, willkommen im Thirteen 87 Team!

Ich bin der Agency-Bot 🤖 — hier ist was ich für dich kann.

📲 <b>EIN- UND AUSCHECKEN</b>

  <code>/on</code> → Wenn du deine Schicht startest. So weiß das
       Team dass du am Start bist und du erscheinst
       im Dienstplan als aktiv.

  <code>/off</code> → Wenn deine Schicht zu Ende ist. Sonst läufst
       du im System weiter als „online" und das
       verfälscht die Auswertungen.

🤝 <b>SCHICHTÜBERGABE</b>

Wenn etwas läuft, das die nächste Schicht wissen muss —
ein angefangenes Gespräch, ein offener Custom, eine
Besonderheit bei einem Model — gib es weiter:

  <code>/off Kunde bei Lyra meldet sich heute Abend</code>
       → beendet die Schicht UND übergibt in einem Rutsch

  <code>/off</code> allein → ich frage nach, du antwortest
       einfach mit deinem Text (oder <code>/nichts</code>)

  <code>/uebergabe TEXT</code> → nachträglich, bis 12h danach
  <code>/gelesen</code> → bestätigt, was für dich hinterlegt wurde

Beim <code>/on</code> bekommst du automatisch, was die
Vorschicht hinterlassen hat.

📅 <b>DEIN PLAN</b>

  <code>/heute</code> → Schichten von heute (welche Models, welche Zeit)
  <code>/woche</code> → Übersicht deiner ganzen Woche
  <code>/wer</code>   → Wer chattet gerade gleichzeitig mit dir

❓ <b>HILFE</b>
  <code>/hilfe</code> → diese Übersicht jederzeit erneut

💬 <b>FRAGEN?</b>
Schreib einfach normal rein — das Team wird informiert
und meldet sich bei dir.

Lass uns Geld machen 💰`

const WELCOME_UNKNOWN = `👋 Hi! Du bist noch nicht im System angelegt.

Damit das Team dich findet, schick mir bitte:
  <b>1.</b> Deinen Namen
  <b>2.</b> Ob du Model oder Chatter bist

Ich leite das direkt ans Team weiter und du wirst angelegt.

Deine Telegram-ID zur Sicherheit: <code>{ID}</code>`

const ADMIN_HELP = `ℹ️ <b>Admin Befehle:</b>

<code>wer online</code> – Wer ist gerade aktiv
<code>schichten heute</code> – Heutiger Plan
<code>umsatz</code> – Monatsumsatz Übersicht
<code>umsatz elina</code> – Umsatz pro Model
<code>status models</code> – Verfügbarkeitsstatus aller Models
<code>offene anfragen</code> – Content-Anfragen mit Status "neu"`

// ── Helper: Forward an Admins ──
async function forwardToAdmins(senderName: string, senderType: string, text: string, fromId: string) {
  const tag = senderType === 'model' ? '📨 Model' : senderType === 'chatter' ? '📨 Chatter' : '📨 Unbekannt'
  const msg = `${tag}: <b>${senderName}</b>\n\n<i>${text}</i>\n\n<a href="tg://user?id=${fromId}">→ Direkt antworten</a>`
  for (const adminId of ADMIN_IDS) await tg(adminId, msg)
}

// ── Helper: eingehende Medien aus Telegram-Message extrahieren (v3.25.0) ──
function extractMedia(m: any): { fileId: string; kind: string } | null {
  if (Array.isArray(m.photo) && m.photo.length > 0) {
    // höchste Auflösung = letztes Element des photo-Arrays
    return { fileId: m.photo[m.photo.length - 1].file_id, kind: 'photo' }
  }
  if (m.video) return { fileId: m.video.file_id, kind: 'video' }
  if (m.animation) return { fileId: m.animation.file_id, kind: 'gif' }
  if (m.video_note) return { fileId: m.video_note.file_id, kind: 'video_note' }
  if (m.voice) return { fileId: m.voice.file_id, kind: 'voice' }
  if (m.audio) return { fileId: m.audio.file_id, kind: 'audio' }
  if (m.document) return { fileId: m.document.file_id, kind: 'document' }
  return null
}

// ── Helper: Telegram-Datei herunterladen + dauerhaft in Supabase Storage ablegen (v3.25.0) ──
// Gibt eine permanente Public-URL zurück (oder null bei Fehler).
// Achtung: Telegram Bot-API kann nur Dateien bis ~20 MB herunterladen.
async function downloadTelegramFile(fileId: string): Promise<string | null> {
  try {
    const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    })
    const fileJson = await fileRes.json()
    const filePath = fileJson?.result?.file_path
    if (!filePath) { console.error('getFile ohne file_path (evtl. >20MB):', JSON.stringify(fileJson)); return null }

    const dl = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`)
    if (!dl.ok) { console.error('Telegram-Download fehlgeschlagen:', dl.status); return null }
    const bytes = new Uint8Array(await dl.arrayBuffer())

    const ext = (filePath.split('.').pop() || 'bin').toLowerCase()
    const ctMap: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic',
      mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/mp4',
      ogg: 'audio/ogg', oga: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav',
      pdf: 'application/pdf',
    }
    const contentType = ctMap[ext] || 'application/octet-stream'

    const storagePath = `inbound/${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${ext}`
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/chat-attachments/${storagePath}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': contentType,
        'cache-control': 'max-age=31536000',
      },
      body: bytes,
    })
    if (!up.ok) { console.error('Storage-Upload fehlgeschlagen:', up.status, await up.text()); return null }

    return `${SUPABASE_URL}/storage/v1/object/public/chat-attachments/${storagePath}`
  } catch (e) {
    console.error('downloadTelegramFile error:', e)
    return null
  }
}

// ── Helper: Absender (Model / Chatter / Unbekannt) auflösen (v3.25.0) ──
async function resolveSender(fromId: string, m: any): Promise<{ type: 'model' | 'chatter' | 'unknown'; name: string }> {
  const modelArr = await q('models_contact', `?telegram_id=eq.${fromId}&limit=1`)
  const modelData = Array.isArray(modelArr) ? modelArr[0] : null
  if (modelData) return { type: 'model', name: modelData.name }
  const chatterArr = await q('chatters_contact', `?telegram_id=eq.${fromId}&limit=1`)
  const chatterData = Array.isArray(chatterArr) ? chatterArr[0] : null
  if (chatterData) return { type: 'chatter', name: chatterData.name }
  return { type: 'unknown', name: m.from.first_name || m.from.username || `Unknown_${fromId}` }
}

// ── Helper: Schichten heute für Chatter ──
async function getChatterShiftsToday(chatterName: string, todayIso: string) {
  const scheds = await q('schedule', '?status=eq.live&order=week_start.desc&limit=1')
  const sched = Array.isArray(scheds) ? scheds[0] : null
  if (!sched?.assignments) return []
  const result: Array<{ shift: string; model: string; time: string }> = []
  for (const [key, val] of Object.entries(sched.assignments as Record<string, { chatter: string }>)) {
    if (key.includes(todayIso) && val.chatter === chatterName) {
      const parts = key.split('__')
      const shiftTimes = sched.shift_times || {}
      const timeKey = `${parts[0]}__${parts[2]}`
      const time = shiftTimes[timeKey] || ''
      result.push({ shift: parts[2], model: parts[0], time })
    }
  }
  return result
}

// ── Helper: ganze Woche für Chatter ──
async function getChatterShiftsWeek(chatterName: string) {
  const scheds = await q('schedule', '?status=eq.live&order=week_start.desc&limit=1')
  const sched = Array.isArray(scheds) ? scheds[0] : null
  if (!sched?.assignments) return []
  const result: Array<{ date: string; shift: string; model: string; time: string }> = []
  for (const [key, val] of Object.entries(sched.assignments as Record<string, { chatter: string }>)) {
    if (val.chatter === chatterName) {
      const parts = key.split('__')
      const shiftTimes = sched.shift_times || {}
      const timeKey = `${parts[0]}__${parts[2]}`
      const time = shiftTimes[timeKey] || ''
      result.push({ date: parts[1], shift: parts[2], model: parts[0], time })
    }
  }
  result.sort((a, b) => a.date.localeCompare(b.date))
  return result
}

// ── Helper: parallel arbeitende Chatter ──
async function getParallelChatters(currentChatterName: string) {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000)
  const online = await q('online_status', '?select=*')
  const arr = Array.isArray(online) ? online : []
  return arr
    .filter((s: any) =>
      s.shift_online &&
      s.last_seen && new Date(s.last_seen) > cutoff &&
      s.display_name !== currentChatterName &&
      !s.display_name?.startsWith('ALERTED_')
    )
    .map((s: any) => s.display_name)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  // v3.79.0: Nur echte Telegram-Webhooks zulassen. Rückwärtskompatibel — solange
  // TELEGRAM_WEBHOOK_SECRET nicht gesetzt ist, wird (noch) nicht erzwungen.
  if (WEBHOOK_SECRET && req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 })
  }
  try {
    const body = await req.json()
    const msg = body.message
    if (!msg) return new Response('ok')

    const fromId = String(msg.from.id)
    const text = (msg.text || '').trim()
    const lower = text.toLowerCase()

    // ── EINGEHENDE MEDIEN (Foto/Video/GIF/Datei/Sprachnachricht) — v3.25.0 ──
    // Muss VOR der /start-Prüfung stehen, da Medien-Nachrichten kein msg.text haben
    // und sonst als leere Nachricht behandelt + verworfen würden.
    const media = extractMedia(msg)
    if (media) {
      const sender = await resolveSender(fromId, msg)
      const caption = (msg.caption || '').trim()
      const kindLabel: Record<string, string> = {
        photo: '📷 Bild', video: '🎬 Video', gif: '🎬 GIF', video_note: '🎬 Videonachricht',
        voice: '🎤 Sprachnachricht', audio: '🎵 Audio', document: '📎 Datei',
      }
      const label = kindLabel[media.kind] || '📎 Anhang'
      const url = await downloadTelegramFile(media.fileId)

      if (!url) {
        // Download fehlgeschlagen (z.B. Datei >20 MB) → Platzhalter speichern statt lautlos verwerfen
        await ins('messages', {
          model_name: sender.name,
          model_telegram_id: fromId,
          direction: 'in',
          contact_type: sender.type,
          text: caption ? `[${label} konnte nicht geladen werden] ${caption}` : `[${label} konnte nicht geladen werden]`,
          status: 'received',
          read: false,
        })
        for (const adminId of ADMIN_IDS) await tg(adminId, `⚠️ ${label} von <b>${sender.name}</b> konnte nicht geladen werden (evtl. größer als 20 MB).`)
        await tg(fromId, '⚠️ Dein Anhang konnte leider nicht verarbeitet werden (max. 20 MB pro Datei). Bitte kleiner senden.')
        return new Response('ok')
      }

      await ins('messages', {
        model_name: sender.name,
        model_telegram_id: fromId,
        direction: 'in',
        contact_type: sender.type,
        text: caption || null,
        image_urls: [url],
        status: 'received',
        read: false,
      })
      await forwardToAdmins(sender.name, sender.type, `${label}${caption ? `: ${caption}` : ''}`, fromId)
      await tg(fromId, '✅ Danke! Dein Anhang wurde an das Team weitergeleitet — wir melden uns bei dir.')
      return new Response('ok')
    }

    // ── /start: rolle erkennen + welcome ──
    if (!text || text === '/start') {
      // Admin → Admin Help (zuerst, falls Admin auch in chatters/models ist)
      if (ADMIN_IDS.includes(fromId)) {
        await tg(fromId, ADMIN_HELP)
        return new Response('ok')
      }
      const modelArr = await q('models_contact', `?telegram_id=eq.${fromId}&limit=1`)
      const modelData = Array.isArray(modelArr) ? modelArr[0] : null
      if (modelData) {
        await tg(fromId, WELCOME_MODEL)
        return new Response('ok')
      }
      const chatterArr = await q('chatters_contact', `?telegram_id=eq.${fromId}&limit=1`)
      const chatterData = Array.isArray(chatterArr) ? chatterArr[0] : null
      if (chatterData) {
        await tg(fromId, WELCOME_CHATTER)
        return new Response('ok')
      }
      // Unbekannt → Welcome + Forward
      await tg(fromId, WELCOME_UNKNOWN.replace('{ID}', fromId))
      const senderName = msg.from.first_name || msg.from.username || 'Unbekannt'
      await forwardToAdmins(senderName, 'unknown', `Neue Person hat /start geschickt. Telegram-ID: ${fromId}`, fromId)
      return new Response('ok')
    }

    // ── /hilfe: rollen-passend ──
    if (lower === '/hilfe' || lower === '/help') {
      if (ADMIN_IDS.includes(fromId)) {
        await tg(fromId, ADMIN_HELP)
        return new Response('ok')
      }
      const modelArr = await q('models_contact', `?telegram_id=eq.${fromId}&limit=1`)
      if (Array.isArray(modelArr) && modelArr[0]) {
        await tg(fromId, WELCOME_MODEL)
        return new Response('ok')
      }
      const chatterArr = await q('chatters_contact', `?telegram_id=eq.${fromId}&limit=1`)
      if (Array.isArray(chatterArr) && chatterArr[0]) {
        await tg(fromId, WELCOME_CHATTER)
        return new Response('ok')
      }
      await tg(fromId, WELCOME_UNKNOWN.replace('{ID}', fromId))
      return new Response('ok')
    }

    // ── ADMIN ──
    if (ADMIN_IDS.includes(fromId)) {
      const now = new Date()
      const todayIso = now.toISOString().slice(0, 10)
      const cutoff = new Date(Date.now() - 120000)

      if (lower.includes('wer online') || lower.includes('wer ist da') || lower === 'online') {
        const online = await q('online_status', '?select=*')
        const activeLogs = await q('shift_logs', '?select=*&checked_out_at=is.null')
        const onlineNow = (Array.isArray(online) ? online : []).filter((s: any) =>
          new Date(s.last_seen) > cutoff && !s.display_name?.startsWith('ALERTED_')
        )
        if (onlineNow.length === 0) {
          await tg(fromId, '📊 Gerade niemand online.')
        } else {
          let m = '📊 <b>Gerade online:</b>\n\n'
          for (const s of onlineNow) {
            const log = (Array.isArray(activeLogs) ? activeLogs : []).find((l: any) => l.display_name === s.display_name)
            const since = log ? ` · seit ${new Date(log.checked_in_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : ''
            m += `● ${s.display_name}${since}\n`
          }
          await tg(fromId, m)
        }
        return new Response('ok')
      }

      if (lower.includes('schichten') || lower.includes('plan heute')) {
        const scheds = await q('schedule', '?status=eq.live&order=week_start.desc&limit=1')
        const sched = Array.isArray(scheds) ? scheds[0] : null
        if (!sched?.assignments) { await tg(fromId, '📅 Kein aktiver Dienstplan.'); return new Response('ok') }
        const entries: string[] = []
        for (const [key, val] of Object.entries(sched.assignments as Record<string, { chatter: string }>)) {
          if (key.includes(todayIso) && val.chatter) {
            const parts = key.split('__')
            entries.push(`${parts[2]} · ${parts[0]} → ${val.chatter}`)
          }
        }
        await tg(fromId, entries.length > 0 ? `📅 <b>Schichten heute:</b>\n\n${entries.join('\n')}` : `📅 Keine Schichten heute.`)
        return new Response('ok')
      }

      if (lower.startsWith('umsatz')) {
        const modelQuery = text.slice(6).trim()
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
        const snaps = await q('model_snapshots', `?select=business_date,rows&business_date=gte.${monthStart}&order=business_date`)
        const snapArr = Array.isArray(snaps) ? snaps : []

        if (!modelQuery) {
          const byModel: Record<string, number> = {}
          for (const snap of snapArr) {
            for (const row of (snap.rows as any[]) || []) {
              const csvName = row.creator || row.name || ''
              const key = csvName.split(' ')[0].replace(/[^a-zA-Z0-9_]/g, '') || csvName
              byModel[key] = (byModel[key] || 0) + (row.revenue || 0)
            }
          }
          const total = Object.values(byModel).reduce((s, v) => s + v, 0)
          const lines = Object.entries(byModel).sort((a, b) => b[1] - a[1]).map(([n, v]) => `${n}: ${money(v)}`).join('\n')
          await tg(fromId, `💰 <b>Umsatz ${now.toLocaleDateString('de-DE', { month: 'long' })}:</b>\n\n${lines || 'Keine Daten'}\n\n<b>Gesamt: ${money(total)}</b>`)
        } else {
          let total = 0
          const byAccount: Record<string, number> = {}
          for (const snap of snapArr) {
            for (const row of (snap.rows as any[]) || []) {
              const csvName = row.creator || row.name || ''
              if (norm(csvName).includes(norm(modelQuery))) {
                total += row.revenue || 0
                byAccount[csvName] = (byAccount[csvName] || 0) + (row.revenue || 0)
              }
            }
          }
          let m = `💰 <b>Umsatz ${modelQuery} (${now.toLocaleDateString('de-DE', { month: 'long' })}):</b>\n\n`
          if (Object.keys(byAccount).length > 1) {
            for (const [acc, rev] of Object.entries(byAccount)) m += `${acc}: ${money(rev)}\n`
            m += `\n<b>Gesamt: ${money(total)}</b>`
          } else if (total > 0) {
            m += money(total)
          } else {
            m += 'Keine Daten.\nTipp: exakter CSV-Name z.B. "umsatz Elina_mj"'
          }
          await tg(fromId, m)
        }
        return new Response('ok')
      }

      if (lower.includes('status') || lower.includes('models status')) {
        const models = await q('models_contact', '?select=name,status,status_until,last_seen&order=name')
        let m = '📊 <b>Model Status:</b>\n\n'
        for (const model of (Array.isArray(models) ? models : [])) {
          const s = model.status || 'unknown'
          const emoji = s === 'available' ? '🟢' : s === 'pause' ? '🟡' : s === 'unavailable' ? '🔴' : '⚪'
          const until = model.status_until ? ` bis ${new Date(model.status_until).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : ''
          const seen = model.last_seen ? ` · ${new Date(model.last_seen).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : ''
          m += `${emoji} ${model.name}${until}${seen}\n`
        }
        await tg(fromId, m)
        return new Response('ok')
      }

      if (lower.includes('anfragen')) {
        const reqs = await q('content_requests', '?status=eq.neu&order=created_at.desc')
        const arr = Array.isArray(reqs) ? reqs : []
        if (arr.length === 0) { await tg(fromId, '✅ Keine offenen Anfragen.'); return new Response('ok') }
        let m = `📋 <b>${arr.length} offene Anfragen:</b>\n\n`
        for (const r of arr) m += `● ${r.chatter_name} → ${r.model_name}\n  ${r.request_text}\n\n`
        await tg(fromId, m)
        return new Response('ok')
      }

      // Default Admin: Hilfe
      await tg(fromId, ADMIN_HELP)
      return new Response('ok')
    }

    // ── MODEL ──
    const modelArr = await q('models_contact', `?telegram_id=eq.${fromId}&limit=1`)
    const modelData = Array.isArray(modelArr) ? modelArr[0] : null
    if (modelData) {
      // /content
      if (lower === '/content') {
        await ins('messages', {
          model_name: modelData.name,
          model_telegram_id: fromId,
          direction: 'in',
          contact_type: 'model',
          text: '[CONTENT_NOTIFY]',
          status: 'received',
          read: false,
        })
        await tg(fromId, '✅ Danke! Das Team wurde informiert dass du neuen Content im Tresor hast.')
        for (const adminId of ADMIN_IDS) {
          await tg(adminId, `📸 <b>${modelData.name}</b> hat neuen Content im OF-Tresor hochgeladen.\n\n⚡ Bei dringenden Anfragen direkt rein und verwenden.`)
        }
        return new Response('ok')
      }

      // Status-Updates (unverändert)
      let update: Record<string, unknown> = {}
      let confirmMsg = ''
      const untilMatch = lower.match(/bis\s+(\d{1,2})(?::(\d{2}))?\s*(uhr)?/)
      const getUntil = () => {
        if (!untilMatch) return null
        const d = new Date(); d.setHours(parseInt(untilMatch[1]), parseInt(untilMatch[2] || '0'), 0, 0)
        return d.toISOString()
      }
      if (lower.includes('nicht verfügbar') || lower.includes('busy') || lower.includes('nicht da') || lower.includes('beschäftigt')) {
        const until = getUntil()
        update = { status: 'unavailable', status_until: until, status_note: text, availability: 'unavailable' }
        confirmMsg = `✓ Status: <b>Nicht verfügbar</b>${until ? ` bis ${new Date(until).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr` : ''}`
      } else if (lower.includes('pause')) {
        const until = getUntil() || new Date(Date.now() + 3600000).toISOString()
        update = { status: 'pause', status_until: until, status_note: text, availability: 'unavailable' }
        confirmMsg = `✓ Status: <b>Pause</b> bis ${new Date(until as string).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`
      } else if (lower.includes('verfügbar') || lower.includes('bin da') || lower.includes('zurück') || lower.includes('back')) {
        update = { status: 'available', status_until: null, status_note: null, availability: 'available' }
        confirmMsg = `✓ Status: <b>Verfügbar</b> ✓`
      }
      if (Object.keys(update).length > 0) {
        await upd('models_contact', `?id=eq.${modelData.id}`, update)
        // Status-Update auch in messages speichern für Dashboard-Inbox
        const statusLabel = (update as any).status as string
        const statusUntilStr = (update as any).status_until
          ? ` bis ${new Date((update as any).status_until).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
          : ''
        await ins('messages', {
          model_name: modelData.name,
          model_telegram_id: fromId,
          direction: 'in',
          contact_type: 'model',
          text: `[STATUS_${statusLabel.toUpperCase()}${statusUntilStr}]`,
          status: 'received',
          read: false,
        })
        await tg(fromId, confirmMsg)
        for (const adminId of ADMIN_IDS) await tg(adminId, `📊 <b>${modelData.name}</b> → ${confirmMsg.replace('✓ Status: ', '')}`)
      } else {
        // FREITEXT von Model
        await ins('messages', {
          model_name: modelData.name,
          model_telegram_id: fromId,
          direction: 'in',
          contact_type: 'model',
          text,
          status: 'received',
          read: false,
        })
        await forwardToAdmins(modelData.name, 'model', text, fromId)
        await tg(fromId, '✅ Danke! Deine Nachricht wurde an das Team weitergeleitet — wir melden uns bei dir.')
      }
      return new Response('ok')
    }

    // ── CHATTER ──
    const chatterArr = await q('chatters_contact', `?telegram_id=eq.${fromId}&limit=1`)
    const chatterData = Array.isArray(chatterArr) ? chatterArr[0] : null
    if (chatterData) {
      // v4.35.0: Berliner Datum statt UTC. Der Dienstplan ist auf Berliner Tage
      // geschlüsselt — zwischen Mitternacht und 01:00 bzw. 02:00 Berlin stand hier
      // der Vortag. Ein Check-in in diesem Fenster fand seine Zuweisung nicht,
      // landete als 'Schicht' im Log und fiel damit aus der Zuordnung der
      // Schichtübergabe heraus.
      const todayIso = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })

      if (lower === '/on' || lower === '/an') {
        // v4.35.0: Eine noch offene Übergabe-Rückfrage vom letzten /off verfällt
        // hiermit. Sonst würde die erste Nachricht in der neuen Schicht als
        // Übergabe zur alten verbucht.
        const nochOffen = await wartendeUebergabe(chatterData.name)
        if (nochOffen) await upd('shift_logs', `?id=eq.${nochOffen.id}`, { handover_at: null })

        const existing = await q('shift_logs', `?display_name=eq.${encodeURIComponent(chatterData.name)}&checked_out_at=is.null&limit=1`)
        if (Array.isArray(existing) && existing.length > 0) {
          await tg(fromId, '⚠ Du bist bereits eingecheckt.')
        } else {
          const scheds = await q('schedule', '?status=eq.live&order=week_start.desc&limit=1')
          const sched = Array.isArray(scheds) ? scheds[0] : null
          let shiftName = 'Schicht'; const modelNames: string[] = []
          if (sched?.assignments) {
            for (const [key, val] of Object.entries(sched.assignments as Record<string, { chatter: string }>)) {
              if (key.includes(todayIso) && val.chatter === chatterData.name) {
                shiftName = key.split('__')[2] || 'Schicht'; modelNames.push(key.split('__')[0])
              }
            }
          }
          await ins('shift_logs', { display_name: chatterData.name, checked_in_at: new Date().toISOString(), shift: shiftName, model_names: modelNames })
          await ups('online_status', { display_name: chatterData.name, last_seen: new Date().toISOString(), shift_online: true }, 'display_name')
          await tg(fromId, `✅ Schicht gestartet!\n${shiftName}${modelNames.length > 0 ? ` · ${modelNames.join(', ')}` : ''}\n\nSende /off wenn fertig.`)
          for (const adminId of ADMIN_IDS) await tg(adminId, `✅ <b>${chatterData.name}</b> hat Schicht gestartet`)

          // v4.35.0: Was hat die Vorschicht hinterlassen? Kommt direkt hinter der
          // Startbestätigung — das ist der Moment, in dem es gelesen wird.
          const offen = await offeneUebergaben(chatterData.name)
          if (offen.length > 0) {
            const kopf = offen.length === 1
              ? '📋 <b>Übergabe der Vorschicht:</b>'
              : `📋 <b>${offen.length} Übergaben für dich:</b>`
            await tg(fromId, `${kopf}\n\n${offen.map(uebergabeText).join('\n\n')}\n\n` +
              'Bestätige mit /gelesen, wenn du es gesehen hast.')
          }
        }
        return new Response('ok')
      }

      // v4.35.0: Offene Übergaben bestätigen — das Gegenstück zu
      // „Gelesen & verstanden" im Portal. Bestätigt alles, was gerade offen ist;
      // einzeln abzuhaken wäre über Telegram mehr Aufwand als Nutzen.
      if (lower === '/gelesen') {
        const offen = await offeneUebergaben(chatterData.name)
        if (offen.length === 0) {
          await tg(fromId, '✅ Für dich ist gerade keine Übergabe offen.')
        } else {
          for (const l of offen) {
            // Stand direkt vorher frisch holen — sonst überschreibt diese
            // Bestätigung die eines Kollegen, der im selben Moment quittiert.
            const frisch = await q('shift_logs', `?id=eq.${l.id}&select=handover_ack&limit=1`)
            const ack = Array.isArray(frisch) && Array.isArray(frisch[0]?.handover_ack)
              ? frisch[0].handover_ack
              : (Array.isArray(l.handover_ack) ? l.handover_ack : [])
            if (ack.some((a: string) => norm(a) === norm(chatterData.name))) continue
            await upd('shift_logs', `?id=eq.${l.id}`, { handover_ack: [...ack, chatterData.name] })
          }
          await tg(fromId, `✅ ${offen.length === 1 ? 'Übergabe' : `${offen.length} Übergaben`} bestätigt. Danke!`)
          const von = [...new Set(offen.map((l: any) => l.display_name))].join(', ')
          for (const adminId of ADMIN_IDS) {
            await tg(adminId, `✅ <b>${escHtml(chatterData.name)}</b> hat die Übergabe von ${escHtml(von)} gelesen`)
          }
        }
        return new Response('ok')
      }

      // v4.35.0: Übergabe nachreichen — auch lange nach dem Auschecken.
      // Wer beim /off nichts geschrieben hat und es zehn Minuten später doch weiß,
      // soll nicht erst ins Dashboard müssen.
      if (lower === '/uebergabe' || lower === '/übergabe'
          || lower.startsWith('/uebergabe ') || lower.startsWith('/übergabe ')) {
        const inhalt = text.replace(/^\/(uebergabe|übergabe)\s*/i, '').trim()
        if (!inhalt) {
          await tg(fromId, 'Schreib den Text direkt dahinter, z. B.:\n<code>/uebergabe Bei Lyra läuft ein Gespräch, Kunde meldet sich heute Abend</code>')
          return new Response('ok')
        }
        // Läuft gerade eine Schicht, gehört die Übergabe an DIESE — sonst hinge
        // sie an der vorherigen und würde deren Text nochmal mitverschicken.
        // Sonst: das jüngste beendete Log der letzten 12 Stunden.
        const laufend = await q('shift_logs',
          `?display_name=eq.${encodeURIComponent(chatterData.name)}&checked_out_at=is.null&limit=1`)
        let log = Array.isArray(laufend) ? laufend[0] : null
        if (!log) {
          const seit12 = new Date(Date.now() - 12 * 3600000).toISOString()
          const letzte = await q('shift_logs',
            `?display_name=eq.${encodeURIComponent(chatterData.name)}` +
            `&checked_out_at=gte.${seit12}&order=checked_out_at.desc&limit=1`)
          log = Array.isArray(letzte) ? letzte[0] : null
        }
        if (!log) {
          await tg(fromId, '⚠ Ich finde keine Schicht der letzten 12 Stunden, an die ich das hängen könnte.\n\nSchick es einfach als normale Nachricht — dann geht es ans Team.')
          return new Response('ok')
        }
        const bisher = log.handover_text ? `${log.handover_text}\n\n` : ''
        await upd('shift_logs', `?id=eq.${log.id}`, {
          handover_text: bisher + inhalt,
          handover_at: new Date().toISOString(),
        })
        const raus = await benachrichtigeUebergabe(log.id)
        await tg(fromId, raus
          ? (log.handover_text ? '✅ An deine Übergabe angehängt und weitergeleitet.' : '✅ Übergabe gespeichert und weitergeleitet.')
          : '✅ Übergabe gespeichert.\n\n⚠ Die Weiterleitung per Telegram hat nicht geklappt — sie steht aber im Dashboard und wird beim Einchecken angezeigt.')
        return new Response('ok')
      }

      // v4.35.0: /nichts hat zwei Aufgaben.
      //   a) die Rückfrage nach nacktem /off abwinken
      //   b) eine gerade eben eingetragene Übergabe zurücknehmen
      // (b) ist der Notausgang für den Fall, dass jemand nach dem /off etwas
      // ganz anderes geschrieben hat und es als Übergabe verbucht wurde. Der Text
      // geht dann als normale Nachricht ans Team — verloren ist er nie.
      if (lower === '/nichts' || lower === '/keine') {
        const wartend = await wartendeUebergabe(chatterData.name)
        if (wartend) {
          await upd('shift_logs', `?id=eq.${wartend.id}`, { handover_at: null })
          await tg(fromId, '👍 Alles klar, keine Übergabe. Schönen Feierabend!')
          return new Response('ok')
        }
        const seit = new Date(Date.now() - UEBERGABE_FENSTER_MIN * 60000).toISOString()
        const frisch = await q('shift_logs',
          `?display_name=eq.${encodeURIComponent(chatterData.name)}` +
          `&handover_at=gte.${seit}&handover_text=not.is.null` +
          `&order=handover_at.desc&limit=1`)
        const log = Array.isArray(frisch) ? frisch[0] : null
        // Nur zurücknehmen, solange sie noch NIEMAND gelesen hat. Ist sie
        // bestätigt, wäre das Löschen doppelt falsch: die Telegram-Nachricht ist
        // ohnehin draußen, und im Schicht-Log stünde danach ein „gelesen von …"
        // ohne den Text, auf den es sich bezieht.
        const schonGelesen = Array.isArray(log?.handover_ack) && log.handover_ack.length > 0
        if (log && !schonGelesen) {
          const zurueck = String(log.handover_text)
          await upd('shift_logs', `?id=eq.${log.id}`, { handover_text: null, handover_at: null })
          await ins('messages', {
            model_name: chatterData.name, model_telegram_id: fromId,
            direction: 'in', contact_type: 'chatter', text: zurueck,
            status: 'received', read: false,
          })
          await forwardToAdmins(chatterData.name, 'chatter', zurueck, fromId)
          await tg(fromId, '↩️ Zurückgenommen. Ich habe deinen Text stattdessen als normale Nachricht ans Team weitergeleitet.\n\n' +
            '<i>Hinweis: Verschickte Telegram-Nachrichten lassen sich nicht zurückholen — wer sie schon bekommen hat, hat sie gesehen.</i>')
        } else if (log && schonGelesen) {
          await tg(fromId, `⚠ Die Übergabe wurde schon gelesen (${escHtml((log.handover_ack || []).join(', '))}) — ich lasse sie deshalb stehen.\n\n` +
            'Wenn etwas daran falsch war, schreib es einfach als normale Nachricht, dann klärt das Team es.')
        } else {
          await tg(fromId, 'Da wartet gerade nichts auf eine Antwort.')
        }
        return new Response('ok')
      }

      // v4.35.0: /off nimmt jetzt eine Übergabe entgegen.
      //   „/off Kunde XY meldet sich heute Abend"  → direkt gespeichert
      //   „/off"                                    → der Bot fragt nach
      // Ausschecken passiert in beiden Fällen sofort. Es darf nie daran hängen,
      // ob jemand etwas zu übergeben hat — sonst bleibt eine Schicht offen stehen.
      if (lower === '/off' || lower === '/ab' || lower.startsWith('/off ') || lower.startsWith('/ab ')) {
        const mitgegeben = text.replace(/^\/(off|ab)\s*/i, '').trim()
        const existing = await q('shift_logs', `?display_name=eq.${encodeURIComponent(chatterData.name)}&checked_out_at=is.null&limit=1`)
        const log = Array.isArray(existing) ? existing[0] : null
        if (!log) {
          await tg(fromId, '⚠ Keine aktive Schicht.')
        } else {
          const duration = Math.round((Date.now() - new Date(log.checked_in_at).getTime()) / 60000)
          const hours = Math.floor(duration / 60); const mins = duration % 60
          const jetzt = new Date().toISOString()
          // Ein bereits per /uebergabe geschriebener Text darf hier NICHT
          // verlorengehen. Früher stand hier `handover_text: mitgegeben || null` —
          // ein nacktes /off hätte damit eine Viertelstunde vorher verschickte
          // Übergabe wieder aus der Datenbank gelöscht.
          const schonText = log.handover_text ? String(log.handover_text) : ''
          const felder: Record<string, unknown> = { checked_out_at: jetzt }
          if (mitgegeben) {
            felder.handover_text = schonText ? `${schonText}\n\n${mitgegeben}` : mitgegeben
            felder.handover_at = jetzt
          } else if (!schonText) {
            // `handover_at` ohne Text ist der Merker für die offene Rückfrage.
            felder.handover_at = jetzt
          }
          await upd('shift_logs', `?id=eq.${log.id}`, felder)
          await ups('online_status', { display_name: chatterData.name, last_seen: new Date().toISOString(), shift_online: false }, 'display_name')
          const dauerText = `${hours > 0 ? `${hours}h ` : ''}${mins}min`
          if (mitgegeben) {
            const raus = await benachrichtigeUebergabe(log.id)
            await tg(fromId, `👋 Schicht beendet!\nDauer: ${dauerText}\n\n` + (raus
              ? '✅ Deine Übergabe ist raus. Gute Arbeit!'
              : '✅ Übergabe gespeichert.\n⚠ Die Weiterleitung per Telegram hat nicht geklappt — sie steht aber im Dashboard und wird beim Einchecken angezeigt.'))
          } else if (schonText) {
            // Übergabe steht schon — dann nicht nochmal danach fragen.
            await tg(fromId, `👋 Schicht beendet!\nDauer: ${dauerText}\n\n✅ Deine Übergabe ist bereits hinterlegt. Gute Arbeit!`)
          } else {
            await tg(fromId,
              `👋 Schicht beendet!\nDauer: ${dauerText}\n\n` +
              '🤝 <b>Gibt es etwas für die nächste Schicht?</b>\n' +
              'Ein angefangenes Gespräch, ein offener Custom, eine Besonderheit bei einem Model.\n\n' +
              'Antworte einfach mit deinem Text — oder schick <code>/nichts</code>, wenn alles glatt lief.')
          }
          for (const adminId of ADMIN_IDS) await tg(adminId, `👋 <b>${escHtml(chatterData.name)}</b> Schicht beendet (${dauerText})`)
        }
        return new Response('ok')
      }

      // /heute
      if (lower === '/heute') {
        const shifts = await getChatterShiftsToday(chatterData.name, todayIso)
        if (shifts.length === 0) {
          await tg(fromId, '📅 Du hast heute keine Schicht eingeplant.')
        } else {
          let m = '📅 <b>Deine Schichten heute:</b>\n\n'
          for (const s of shifts) {
            m += `<b>${s.shift}</b>${s.time ? ` · ${s.time}` : ''} · ${s.model}\n`
          }
          await tg(fromId, m)
        }
        return new Response('ok')
      }

      // /woche
      if (lower === '/woche') {
        const shifts = await getChatterShiftsWeek(chatterData.name)
        if (shifts.length === 0) {
          await tg(fromId, '📅 Du hast diese Woche keine Schichten.')
        } else {
          let m = '📅 <b>Deine Schichten diese Woche:</b>\n\n'
          let lastDate = ''
          for (const s of shifts) {
            if (s.date !== lastDate) {
              const d = new Date(s.date + 'T12:00:00')
              const weekday = d.toLocaleDateString('de-DE', { weekday: 'short' })
              m += `\n<b>${weekday} ${s.date.slice(5)}</b>\n`
              lastDate = s.date
            }
            m += `  ${s.shift}${s.time ? ` · ${s.time}` : ''} · ${s.model}\n`
          }
          await tg(fromId, m)
        }
        return new Response('ok')
      }

      // /wer
      if (lower === '/wer') {
        const others = await getParallelChatters(chatterData.name)
        if (others.length === 0) {
          await tg(fromId, '👤 Aktuell ist niemand sonst online.')
        } else {
          await tg(fromId, `👥 <b>Gerade parallel online:</b>\n\n${others.map(n => `● ${n}`).join('\n')}`)
        }
        return new Response('ok')
      }

      // v4.35.0: Antwort auf die Übergabe-Rückfrage nach /off.
      // Greift nur, wenn der Bot wirklich gefragt hat (`handover_at` gesetzt,
      // `handover_text` noch leer) und das innerhalb der letzten 15 Minuten war.
      // Sonst würde eine ganz normale Nachricht ans Team als Übergabe verbucht.
      if (!text.startsWith('/')) {
        const wartend = await wartendeUebergabe(chatterData.name)
        if (wartend) {
          await upd('shift_logs', `?id=eq.${wartend.id}`, {
            handover_text: text.trim(),
            handover_at: new Date().toISOString(),
          })
          const raus = await benachrichtigeUebergabe(wartend.id)
          await tg(fromId, (raus
            ? '✅ Übergabe gespeichert und an die nächste Schicht weitergeleitet. Danke!'
            : '✅ Übergabe gespeichert.\n\n⚠ Die Weiterleitung per Telegram hat nicht geklappt — sie steht aber im Dashboard.') +
            '\n\nWar das gar keine Übergabe? Schick <code>/nichts</code>, dann nehme ich es zurück und leite deinen Text ans Team weiter.')
          return new Response('ok')
        }
      }

      // FREITEXT von Chatter: speichern + Forward
      await ins('messages', {
        model_name: chatterData.name,
        model_telegram_id: fromId,
        direction: 'in',
        contact_type: 'chatter',
        text,
        status: 'received',
        read: false,
      })
      await forwardToAdmins(chatterData.name, 'chatter', text, fromId)
      await tg(fromId, '✅ Danke! Deine Nachricht wurde an das Team weitergeleitet — wir melden uns bei dir.')
      return new Response('ok')
    }

    // ── UNBEKANNT ──
    await ins('messages', {
      model_name: msg.from.first_name || msg.from.username || `Unknown_${fromId}`,
      model_telegram_id: fromId,
      direction: 'in',
      contact_type: 'unknown',
      text,
      status: 'received',
      read: false,
    })
    const senderName = msg.from.first_name || msg.from.username || 'Unbekannt'
    await forwardToAdmins(senderName, 'unknown', text, fromId)
    await tg(fromId, `Danke für deine Nachricht. Ich habe sie weitergeleitet — das Team meldet sich bei dir.\n\nDeine Telegram-ID: <code>${fromId}</code>`)
    return new Response('ok')
  } catch (err) {
    // v3.79.0: Immer 200 zurückgeben — sonst wiederholt Telegram die Zustellung
    // und dieselbe Nachricht wird doppelt verarbeitet (Doppel-Forward/Insert).
    console.error('telegram-bot error:', err)
    return new Response('ok')
  }
})
