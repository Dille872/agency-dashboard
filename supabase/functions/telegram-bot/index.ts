import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const SUPABASE_URL = Deno.env.get('DB_URL') || Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('DB_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BOT_TOKEN = '8396910457:AAEeZdCISpbNDfS00uy-EI-SBy1MsY0ztZ8'
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  try {
    const body = await req.json()
    const msg = body.message
    if (!msg) return new Response('ok')

    const fromId = String(msg.from.id)
    const text = (msg.text || '').trim()
    const lower = text.toLowerCase()

    if (!text || text === '/start') {
      await tg(fromId, `👋 Hallo! Deine Telegram ID: <code>${fromId}</code>\n\nTeile diese ID deinem Team mit.`)
      return new Response('ok')
    }

    // ADMIN
    if (ADMIN_IDS.includes(fromId)) {
      const now = new Date()
      const todayIso = now.toISOString().slice(0, 10)
      const cutoff = new Date(Date.now() - 120000)

      // WER ONLINE
      if (lower.includes('wer online') || lower.includes('wer ist da') || lower === 'online') {
        const online = await q('online_status', '?select=*')
        const activeLogs = await q('shift_logs', '?select=*&checked_out_at=is.null')
        const onlineNow = (Array.isArray(online) ? online : []).filter((s: any) => new Date(s.last_seen) > cutoff)
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

      // SCHICHTEN HEUTE
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

      // UMSATZ
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

      // STATUS MODELS
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

      // OFFENE ANFRAGEN
      if (lower.includes('anfragen')) {
        const reqs = await q('content_requests', '?status=eq.neu&order=created_at.desc')
        const arr = Array.isArray(reqs) ? reqs : []
        if (arr.length === 0) { await tg(fromId, '✅ Keine offenen Anfragen.'); return new Response('ok') }
        let m = `📋 <b>${arr.length} offene Anfragen:</b>\n\n`
        for (const r of arr) m += `● ${r.chatter_name} → ${r.model_name}\n  ${r.request_text}\n\n`
        await tg(fromId, m)
        return new Response('ok')
      }

      // HILFE
      await tg(fromId, `ℹ️ <b>Admin Befehle:</b>\n\nwer online\nschichten heute\numsatz\numsatz elina\nstatus models\noffene anfragen`)
      return new Response('ok')
    }

    // MODEL
    const modelArr = await q('models_contact', `?telegram_id=eq.${fromId}&limit=1`)
    const modelData = Array.isArray(modelArr) ? modelArr[0] : null
    if (modelData) {
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
        await ins('messages', { model_name: modelData.name, model_telegram_id: fromId, direction: 'in', contact_type: 'model', text, status: 'received', read: false })
        await tg(fromId, `ℹ️ Befehle:\nverfügbar\nnicht verfügbar\npause bis 18\nzurück`)
      }
      return new Response('ok')
    }

    // CHATTER
    const chatterArr = await q('chatters_contact', `?telegram_id=eq.${fromId}&limit=1`)
    const chatterData = Array.isArray(chatterArr) ? chatterArr[0] : null
    if (chatterData) {
      if (lower === '/on' || lower === '/an') {
        const existing = await q('shift_logs', `?display_name=eq.${encodeURIComponent(chatterData.name)}&checked_out_at=is.null&limit=1`)
        if (Array.isArray(existing) && existing.length > 0) {
          await tg(fromId, '⚠ Du bist bereits eingecheckt.')
        } else {
          const scheds = await q('schedule', '?status=eq.live&order=week_start.desc&limit=1')
          const sched = Array.isArray(scheds) ? scheds[0] : null
          const todayIso = new Date().toISOString().slice(0, 10)
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
      } else if (lower === '/off' || lower === '/ab') {
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
      } else {
        await tg(fromId, `ℹ️ Befehle:\n/on – Schicht starten\n/off – Schicht beenden`)
      }
      return new Response('ok')
    }

    await tg(fromId, `👋 Deine Telegram ID: <code>${fromId}</code>`)
    return new Response('ok')
  } catch (err) {
    console.error(err)
    return new Response('error', { status: 500 })
  }
})
