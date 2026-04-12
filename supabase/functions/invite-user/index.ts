import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('DB_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('DB_SERVICE_KEY')!

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
  
  try {
    const { email, display_name, role } = await req.json()
    if (!email || !display_name || !role) return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 })

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
    if (!inviteResp.ok) return new Response(JSON.stringify({ error: inviteData.message || inviteData.msg || JSON.stringify(inviteData) }), { status: 400 })

    const userId = inviteData.id
    if (!userId) return new Response(JSON.stringify({ error: 'No user ID returned' }), { status: 400 })

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

    if (!rolesResp.ok) return new Response(JSON.stringify({ error: 'Role insert failed' }), { status: 400 })

    return new Response(JSON.stringify({ ok: true, user_id: userId }), { 
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } 
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
