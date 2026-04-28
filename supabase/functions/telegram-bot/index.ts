import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const SUPABASE_URL = Deno.env.get('DB_URL') || Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('DB_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const CHRIS_ID = '1538601588'
const REY_ID = '528328429'
const ADMIN_IDS = [CHRIS_ID, REY_ID]

const H = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Accept': 'application/json', 'Accept-Profile': 'public', 'Content-Profile': 'public' }

async function q(table: string, params = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, { headers: H })
  return r.json()
}
async function ins(table: string, data: object) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: 'POST', headers: { ...H, 'Prefer': 'return=minimal' }, body: JSON.stringify(data) })
}
async function upd(table: string, params: string, data: object) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, { method: 'PATCH', headers: { ...H, 'Prefer': 'return=minimal' }, body: JSON.stringify(data) })
}
async function ups(table: string, data: object, conflict: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflict}`, { method: 'POST', headers: { ...H, 'Prefer': 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(data) })
}
async function tg(chatId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }) })
}
function money(v: number) { return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function norm(s: string) { return s.toLowerCase().replace(/[^a-z0-9]/g, '') }

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
  try {
    const body = await req.json()
    const msg = body.message
    if (!msg) return new Response('ok')

    const fromId = String(msg.from.id)
    const text = (msg.text || '').trim()
    const lower = text.toLowerCase()

    // ── /start: rolle erkennen + welcome ──
    if (!text || text === '/start') {
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
      // Admin → Admin Help
      if (ADMIN_IDS.includes(fromId)) {
        await tg(fromId, ADMIN_HELP)
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
      const todayIso = new Date().toISOString().slice(0, 10)

      if (lower === '/on' || lower === '/an') {
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
        }
        return new Response('ok')
      }

      if (lower === '/off' || lower === '/ab') {
        const existing = await q('shift_logs', `?display_name=eq.${encodeURIComponent(chatterData.name)}&checked_out_at=is.null&limit=1`)
        const log = Array.isArray(existing) ? existing[0] : null
        if (!log) {
          await tg(fromId, '⚠ Keine aktive Schicht.')
        } else {
          const duration = Math.round((Date.now() - new Date(log.checked_in_at).getTime()) / 60000)
          const hours = Math.floor(duration / 60); const mins = duration % 60
          await upd('shift_logs', `?id=eq.${log.id}`, { checked_out_at: new Date().toISOString() })
          await ups('online_status', { display_name: chatterData.name, last_seen: new Date().toISOString(), shift_online: false }, 'display_name')
          await tg(fromId, `👋 Schicht beendet!\nDauer: ${hours > 0 ? `${hours}h ` : ''}${mins}min\n\nGute Arbeit!`)
          for (const adminId of ADMIN_IDS) await tg(adminId, `👋 <b>${chatterData.name}</b> Schicht beendet (${hours > 0 ? `${hours}h ` : ''}${mins}min)`)
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
    console.error('telegram-bot error:', err)
    return new Response('error', { status: 500 })
  }
})
