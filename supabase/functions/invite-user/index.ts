import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('DB_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('DB_SERVICE_KEY')!

// Rollen, die neue User einladen dürfen. Bei Bedarf anpassen.
const ALLOWED_INVITER_ROLES = ['admin', 'manager']

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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    // 1) Caller-Token aus dem Authorization-Header lesen
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) return json({ error: 'Nicht authentifiziert' }, 401)

    // 2) Token validieren -> Caller-User-ID ermitteln
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${token}` },
    })
    if (!userResp.ok) return json({ error: 'Ungültiges oder abgelaufenes Token' }, 401)
    const caller = await userResp.json()
    const callerId = caller?.id
    if (!callerId) return json({ error: 'Caller nicht gefunden' }, 401)

    // 3) Rolle des Callers prüfen (gleiche Logik wie App.jsx: roles-Array, sonst [role])
    const roleResp = await fetch(
      `${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${callerId}&select=role,roles`,
      { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } },
    )
    const roleRows = await roleResp.json()
    const callerRow = Array.isArray(roleRows) ? roleRows[0] : null
    const effectiveRoles: string[] = callerRow?.roles?.length
      ? callerRow.roles
      : (callerRow?.role ? [callerRow.role] : [])
    const allowed = effectiveRoles.some((r) => ALLOWED_INVITER_ROLES.includes(r))
    if (!allowed) return json({ error: 'Keine Berechtigung zum Einladen von Usern' }, 403)

    // ----- Ab hier: bestehende Einladungs-Logik (unverändert) -----
    const { email, display_name, role } = await req.json()
    if (!email || !display_name || !role) return json({ error: 'Missing fields' }, 400)

    // Invite user via Supabase Auth Admin API
    const inviteResp = await fetch(`${SUPABASE_URL}/auth/v1/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ email }),
    })

    const inviteData = await inviteResp.json()
    if (!inviteResp.ok) return json({ error: inviteData.message || inviteData.msg || JSON.stringify(inviteData) }, 400)

    const userId = inviteData.id
    if (!userId) return json({ error: 'No user ID returned' }, 400)

    // Insert into user_roles
    const rolesResp = await fetch(`${SUPABASE_URL}/rest/v1/user_roles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ user_id: userId, role, display_name }),
    })

    if (!rolesResp.ok) return json({ error: 'Role insert failed' }, 400)

    return json({ ok: true, user_id: userId })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
