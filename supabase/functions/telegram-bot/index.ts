import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BOT_TOKEN = '8396910457:AAEeZdCISpbNDfS00uy-EI-SBy1MsY0ztZ8'
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const CHRIS_ID = '1538601588'
const REY_ID = '528328429'
const ADMIN_IDS = [CHRIS_ID, REY_ID]

async function sendTelegram(chatId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}

async function askClaude(question: string, context: string): Promise<string> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: `Du bist ein interner Assistent für Thirteen 87 Collective, eine OnlyFans Chatter-Agentur.
Du hast Zugriff auf aktuelle Daten aus der Datenbank. Beantworte Fragen kurz, klar und auf Deutsch.
Verwende nur <b> für Fettschrift da die Antwort via Telegram gesendet wird. Kein Markdown.
Heute ist ${new Date().toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}.`,
      messages: [{ role: 'user', content: `Datenbankdaten:\n${context}\n\nFrage: ${question}` }],
    }),
  })
  const data = await resp.json()
  return data.content?.[0]?.text || 'Keine Antwort erhalten.'
}

serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const body = await req.json()
    const msg = body.message
    if (!msg) return new Response('ok')

    const fromId = String(msg.from.id)
    const text = (msg.text || '').trim()
    const lower = text.toLowerCase()

    if (!text || text === '/start') {
      await sendTelegram(fromId, `Hallo! Deine Telegram ID ist: <code>${fromId}</code>\n\nTeile diese ID deinem Team mit damit du verknüpft werden kannst.`)
      return new Response('ok')
    }

    // ADMIN
    if (ADMIN_IDS.includes(fromId)) {
      const now = new Date()
      const todayIso = now.toISOString().slice(0, 10)
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
      const cutoff = new Date(Date.now() - 120000)

      const [
        { data: onlineStatus },
        { data: shiftLogs },
        { data: models },
        { data: swaps },
        { data: contentRequests },
        { data: schedule },
        { data: recentSnaps },
      ] = await Promise.all([
        supabase.from('online_status').select('*'),
        supabase.from('shift_logs').select('*').order('checked_in_at', { ascending: false }).limit(50),
        supabase.from('models_contact').select('name, status, status_until, status_note, last_seen, availability'),
        supabase.from('shift_swaps').select('*').eq('status', 'offen'),
        supabase.from('content_requests').select('*').neq('status', 'erledigt').limit(20),
        supabase.from('schedule').select('*').order('week_start', { ascending: false }).limit(1),
        supabase.from('model_snapshots').select('business_date, rows').gte('business_date', monthStart).order('business_date', { ascending: false }).limit(14),
      ])

      const onlineNow = (onlineStatus || []).filter(s => new Date(s.last_seen) > cutoff).map(s => s.display_name)
      const activeShifts = (shiftLogs || []).filter(l => !l.checked_out_at)

      const context = JSON.stringify({
        jetzt: now.toISOString(),
        heute: todayIso,
        chatters_gerade_online: onlineNow,
        aktive_schichten: activeShifts,
        letzte_schichten: shiftLogs?.slice(0, 15),
        model_status: models,
        offene_tausch_anfragen: swaps,
        offene_content_anfragen: contentRequests,
        aktueller_dienstplan: schedule?.[0],
        umsatz_daten: recentSnaps?.map(s => ({
          datum: s.business_date,
          models: (s.rows as any[])?.map(r => ({ name: r.creator || r.name, umsatz: r.revenue, nachrichten: r.messageRevenue }))
        })),
      }, null, 2)

      const answer = await askClaude(text, context)
      await sendTelegram(fromId, answer)
      return new Response('ok')
    }

    // MODEL
    const { data: modelData } = await supabase.from('models_contact').select('*').eq('telegram_id', fromId).single()
    if (modelData) {
      let update: Record<string, unknown> = {}
      let confirmMsg = ''

      const untilMatch = lower.match(/bis\s+(\d{1,2})(?::(\d{2}))?\s*(uhr)?/)
      const getUntil = () => {
        if (!untilMatch) return null
        const d = new Date()
        d.setHours(parseInt(untilMatch[1]), parseInt(untilMatch[2] || '0'), 0, 0)
        return d.toISOString()
      }

      if (lower.includes('nicht verfügbar') || lower.includes('busy') || lower.includes('nicht da') || lower === '/ab' || lower.includes('beschäftigt')) {
        const until = getUntil()
        update = { status: 'unavailable', status_until: until, status_note: text, availability: 'unavailable' }
        confirmMsg = `✓ Status: <b>Nicht verfügbar</b>${until ? ` bis ${new Date(until).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr` : ''}`
      } else if (lower.includes('pause')) {
        const until = getUntil() || new Date(Date.now() + 3600000).toISOString()
        update = { status: 'pause', status_until: until, status_note: text, availability: 'unavailable' }
        confirmMsg = `✓ Status: <b>Pause</b> bis ${new Date(until as string).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`
      } else if (lower.includes('verfügbar') || lower.includes('available') || lower === '/an' || lower.includes('bin da') || lower.includes('zurück') || lower.includes('back')) {
        update = { status: 'available', status_until: null, status_note: null, availability: 'available' }
        confirmMsg = `✓ Status: <b>Verfügbar</b>`
      }

      if (Object.keys(update).length > 0) {
        await supabase.from('models_contact').update(update).eq('id', modelData.id)
        await sendTelegram(fromId, confirmMsg)
        for (const adminId of ADMIN_IDS) {
          await sendTelegram(adminId, `📊 <b>${modelData.name}</b> → ${confirmMsg.replace('✓ Status: ', '')}`)
        }
      }

      await supabase.from('messages').insert({
        model_name: modelData.name, model_telegram_id: fromId,
        direction: 'in', contact_type: 'model', text, status: 'received', read: false,
      })
      return new Response('ok')
    }

    // CHATTER
    const { data: chatterData } = await supabase.from('chatters_contact').select('*').eq('telegram_id', fromId).single()
    if (chatterData) {
      if (lower === '/an') {
        const { data: existing } = await supabase.from('shift_logs').select('*')
          .eq('display_name', chatterData.name).is('checked_out_at', null).single()
        if (existing) {
          await sendTelegram(fromId, '⚠ Du bist bereits eingecheckt.')
        } else {
          const { data: schedData } = await supabase.from('schedule').select('*')
            .eq('status', 'live').order('week_start', { ascending: false }).limit(1).single()
          const todayIso = new Date().toISOString().slice(0, 10)
          let shiftName = 'Schicht'
          const modelNames: string[] = []
          if (schedData?.assignments) {
            for (const [key, val] of Object.entries(schedData.assignments as Record<string, { chatter: string }>)) {
              if (key.includes(todayIso) && val.chatter === chatterData.name) {
                shiftName = key.split('__')[2] || 'Schicht'
                modelNames.push(key.split('__')[0])
              }
            }
          }
          await supabase.from('shift_logs').insert({
            display_name: chatterData.name,
            checked_in_at: new Date().toISOString(),
            shift: shiftName,
            model_names: modelNames,
          })
          await supabase.from('online_status').upsert({
            display_name: chatterData.name,
            last_seen: new Date().toISOString(),
            shift_online: true,
          }, { onConflict: 'display_name' })
          await sendTelegram(fromId, `✅ Schicht gestartet!\n${shiftName}${modelNames.length > 0 ? ` · ${modelNames.join(', ')}` : ''}\n\nSende /ab wenn du fertig bist.`)
          for (const adminId of ADMIN_IDS) {
            await sendTelegram(adminId, `✅ <b>${chatterData.name}</b> hat Schicht gestartet`)
          }
        }
      } else if (lower === '/ab') {
        const { data: existing } = await supabase.from('shift_logs').select('*')
          .eq('display_name', chatterData.name).is('checked_out_at', null).single()
        if (!existing) {
          await sendTelegram(fromId, '⚠ Keine aktive Schicht gefunden.')
        } else {
          const duration = Math.round((Date.now() - new Date(existing.checked_in_at).getTime()) / 60000)
          const hours = Math.floor(duration / 60)
          const mins = duration % 60
          await supabase.from('shift_logs').update({ checked_out_at: new Date().toISOString() }).eq('id', existing.id)
          await supabase.from('online_status').upsert({
            display_name: chatterData.name,
            last_seen: new Date().toISOString(),
            shift_online: false,
          }, { onConflict: 'display_name' })
          await sendTelegram(fromId, `👋 Schicht beendet!\nDauer: ${hours > 0 ? `${hours}h ` : ''}${mins}min\n\nGute Arbeit!`)
          for (const adminId of ADMIN_IDS) {
            await sendTelegram(adminId, `👋 <b>${chatterData.name}</b> hat Schicht beendet (${hours > 0 ? `${hours}h ` : ''}${mins}min)`)
          }
        }
      } else {
        await supabase.from('messages').insert({
          model_name: chatterData.name, model_telegram_id: fromId,
          direction: 'in', contact_type: 'chatter', text, status: 'received', read: false,
        })
      }
      return new Response('ok')
    }

    await sendTelegram(fromId, `Hallo! Deine Telegram ID: <code>${fromId}</code>\n\nBitte teile diese ID deinem Team mit.`)
    return new Response('ok')
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
