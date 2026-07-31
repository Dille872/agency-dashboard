import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// v4.11.0 — Selbst-Registrierung für freigeschaltete E-Mail-Adressen.
//
// Ablauf: Admin schaltet eine Adresse in `signup_invites` frei. Die Person geht
// auf die Anmeldeseite, wählt „Konto erstellen", gibt dieselbe Adresse und ein
// selbst gewähltes Passwort ein. Diese Funktion prüft die Freischaltung und legt
// den Account an — inklusive user_roles und Kontakt-Eintrag.
//
// Warum eine Edge Function und nicht direkt aus dem Browser:
//   - Die Liste der freigeschalteten Adressen darf niemand von aussen lesen.
//   - `user_roles` ist per RLS admin-only; ein frisch registrierter User darf
//     sich seine Rolle nicht selbst setzen.
// Beides löst nur der Service-Role-Key, und der gehört ausschliesslich hierher.
//
// Kein Mailversand: Der Account wird mit email_confirm gleich bestätigt, damit
// die Person sich sofort anmelden kann. Supabase-Mails sind gedrosselt und
// landen im Spam — genau daran ist der bisherige Einladungsweg gescheitert.
//
// Deploy (NICHT über git):
//   supabase functions deploy self-signup

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('DB_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('DB_SERVICE_KEY')!

const MIN_PASSWORT = 10

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

const rest = (pfad: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${pfad}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      ...(init.headers || {}),
    },
  })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')

    if (!email || !password) return json({ error: 'E-Mail und Passwort fehlen.' }, 400)
    if (password.length < MIN_PASSWORT) {
      return json({ error: `Das Passwort muss mindestens ${MIN_PASSWORT} Zeichen haben.` }, 400)
    }

    // 1) Freischaltung suchen — offen und nicht abgelaufen
    const invResp = await rest(
      `signup_invites?email=eq.${encodeURIComponent(email)}&used_at=is.null&select=*&order=created_at.desc&limit=1`,
    )
    const invRows = await invResp.json()
    const invite = Array.isArray(invRows) ? invRows[0] : null

    if (!invite) {
      return json({
        error: 'Diese E-Mail-Adresse ist nicht freigeschaltet. Melde dich beim Team, dann schalten wir sie frei.',
      }, 403)
    }
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return json({
        error: 'Die Freischaltung für diese Adresse ist abgelaufen. Melde dich beim Team, dann verlängern wir sie.',
      }, 403)
    }

    // 2) Account anlegen. email_confirm: true -> sofort anmeldbar, keine Mail.
    //    Der Anzeigename wandert zusätzlich in die Metadaten, weil einige
    //    Supabase-Ansichten und der Telegram-Bot dort nachsehen.
    const createResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: invite.display_name },
      }),
    })
    const created = await createResp.json()

    if (!createResp.ok) {
      const msg = String(created?.msg || created?.message || '')
      if (/already|registered|exists/i.test(msg)) {
        return json({
          error: 'Für diese Adresse gibt es schon ein Konto. Melde dich mit deinem Passwort an — oder frag beim Team nach, wenn du es nicht mehr weisst.',
        }, 409)
      }
      return json({ error: msg || 'Konto konnte nicht angelegt werden.' }, 400)
    }

    const userId = created?.id
    if (!userId) return json({ error: 'Konto konnte nicht angelegt werden.' }, 400)

    // 3) Rolle setzen. Schlägt das fehl, wäre der Account gesperrt (App.jsx
    //    behandelt fehlende user_roles als not_setup) — dann lieber den frisch
    //    angelegten Account wieder entfernen, als eine halbe Leiche zu hinterlassen.
    const rollen = invite.roles?.length ? invite.roles : [invite.role]
    const roleResp = await rest('user_roles', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        user_id: userId,
        role: rollen[0],
        roles: rollen,
        display_name: invite.display_name,
        status: 'active',
      }),
    })
    if (!roleResp.ok) {
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
      })
      return json({ error: 'Rolle konnte nicht gesetzt werden. Bitte beim Team melden.' }, 500)
    }

    // 4) Kontakt-Eintrag anlegen — dieselbe Logik wie beim Einladen aus den
    //    Einstellungen. Fehler hier sind nicht schlimm: der Login funktioniert,
    //    der Eintrag lässt sich nachtragen.
    const tabelle = rollen.includes('chatter') ? 'chatters_contact'
      : rollen.includes('model') ? 'models_contact' : null
    if (tabelle) {
      await rest(`${tabelle}?on_conflict=name`, {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ name: invite.display_name }),
      }).catch(() => {})
    }

    // 5) Freischaltung als verbraucht markieren
    await rest(`signup_invites?id=eq.${invite.id}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ used_at: new Date().toISOString(), user_id: userId }),
    })

    // 6) Protokoll — damit in der Admin-Glocke steht, wer dazugekommen ist.
    await rest('activity_log', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        actor: invite.display_name,
        action: 'user.selfsignup',
        entity: invite.display_name,
        detail: `hat sich registriert (${rollen.join(', ')})`,
      }),
    }).catch(() => {})

    return json({ ok: true, display_name: invite.display_name })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
